import { randomUUID } from 'crypto';
import { join } from 'path';
import { DataSource } from 'typeorm';

import {
  Account,
  AccountStatus,
} from '../src/modules/accounts/entities/account.entity';
import { ChatGroup } from '../src/modules/chat-groups/entities/chat-group.entity';
import { ChatGroupMember } from '../src/modules/chat-groups/entities/chat-group-member.entity';
import { CareerLadderService } from '../src/modules/stores/career-ladder.service';
import { Asset } from '../src/modules/stores/entities/asset.entity';
import { EmployeeAssetAssignment } from '../src/modules/stores/entities/employee-asset-assignment.entity';
import { EmployeeCapabilityEntry } from '../src/modules/stores/entities/employee-capability-entry.entity';
import { EmployeeCareerEvent } from '../src/modules/stores/entities/employee-career-event.entity';
import {
  EmployeeContract,
  PaymentType,
} from '../src/modules/stores/entities/employee-contract.entity';
import { EmployeeFace } from '../src/modules/stores/entities/employee-face.entity';
import { EmployeeMonthlySummary } from '../src/modules/stores/entities/employee-monthly-summary.entity';
import {
  EmployeeProfile,
  EmploymentStatus,
} from '../src/modules/stores/entities/employee-profile.entity';
import { EmployeeSalary } from '../src/modules/stores/entities/employee-salary.entity';
import { EmployeeTerminationReason } from '../src/modules/stores/entities/employee-termination-reason.entity';
import {
  CycleType,
  ShiftAssignment,
  ShiftAssignmentStatus,
  ShiftSlot,
  WorkCycle,
} from '../src/modules/stores/entities/shift-management.entity';
import { Store } from '../src/modules/stores/entities/store.entity';
import { WorkShift } from '../src/modules/stores/entities/work-shift.entity';
import {
  addDays,
  getTodayDateString,
} from '../src/modules/stores/shift-schedule.utils';
import { StoresService } from '../src/modules/stores/stores.service';

/**
 * Real-Postgres check of the rehire flow, and in particular of the timestamp
 * semantics the stint floor relies on: rows written inside the hire
 * transaction get `created_at` from the transaction start, before the
 * app-clock `joined_at`, and must still count as the current stint.
 *
 * Skipped unless TIMESO_TEST_DATABASE_URL names a *_test / *-ci database.
 * Everything runs in a throwaway schema that is dropped afterwards.
 */
const connectionString = process.env.TIMESO_TEST_DATABASE_URL;
const isExplicitTestDatabase = (() => {
  if (!connectionString) return false;
  try {
    return /(^|[_-])(test|testing|ci)([_-]|$)/i.test(
      new URL(connectionString).pathname.slice(1),
    );
  } catch {
    return false;
  }
})();
const describeWithTestDatabase = isExplicitTestDatabase
  ? describe
  : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;

describeWithTestDatabase('employee rehire (Postgres)', () => {
  const schema = `timeso_rehire_e2e_${randomUUID().replace(/-/g, '')}`;
  let dataSource: DataSource;
  let service: StoresService;
  let careerLadder: CareerLadderService;

  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const bootstrap = new DataSource({
      type: 'postgres',
      url: connectionString,
    });
    await bootstrap.initialize();
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    await bootstrap.destroy();

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    dataSource = new DataSource({
      type: 'postgres',
      url: connectionString,
      schema,
      entities: [join(__dirname, '../src/**/*.entity.ts')],
      synchronize: true,
      uuidExtension: 'pgcrypto',
      // Raw SQL in the service uses unqualified table names, and
      // `timestamp` columns must be read in the same zone Node writes them.
      extra: { options: `-c search_path=${schema},public -c TimeZone=${timeZone}` },
    });
    await dataSource.initialize();

    const repo = <T extends object>(entity: new () => T) =>
      dataSource.getRepository(entity);
    const logger = {
      log: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      verbose: jest.fn(),
    };
    service = Object.create(StoresService.prototype) as StoresService;
    Object.assign(service as any, {
      logger,
      dataSource,
      profileRepository: repo(EmployeeProfile),
      storeRepository: repo(Store),
      terminationReasonRepository: repo(EmployeeTerminationReason),
      monthlySummaryRepository: repo(EmployeeMonthlySummary),
      shiftAssignmentRepository: repo(ShiftAssignment),
      assetAssignmentRepository: repo(EmployeeAssetAssignment),
      contractRepository: repo(EmployeeContract),
    });
    careerLadder = Object.create(
      CareerLadderService.prototype,
    ) as CareerLadderService;
    Object.assign(careerLadder as any, {
      profileRepository: repo(EmployeeProfile),
      capabilityRepository: repo(EmployeeCapabilityEntry),
      eventRepository: repo(EmployeeCareerEvent),
    });

    // ── Seed the previous stint ────────────────────────────────────────────
    const long = new Date(Date.now() - 60 * DAY_MS);
    const owner = await repo(Account).save(
      repo(Account).create({
        phone: `09${Date.now().toString().slice(-8)}`,
        passwordHash: 'x',
        fullName: 'Owner',
        status: AccountStatus.ACTIVE,
      } as Partial<Account>),
    );
    const employee = await repo(Account).save(
      repo(Account).create({
        phone: `08${Date.now().toString().slice(-8)}`,
        passwordHash: 'x',
        fullName: 'Employee',
        status: AccountStatus.ACTIVE,
      } as Partial<Account>),
    );
    const store = await repo(Store).save(
      repo(Store).create({ name: 'Rehire store', ownerAccountId: owner.id }),
    );
    const reason = await repo(EmployeeTerminationReason).save(
      repo(EmployeeTerminationReason).create({
        storeId: store.id,
        name: 'Nghỉ việc',
      }),
    );
    const profile = await repo(EmployeeProfile).save(
      repo(EmployeeProfile).create({
        storeId: store.id,
        accountId: employee.id,
        employmentStatus: EmploymentStatus.ACTIVE,
        joinedAt: long,
        capabilityPoints: 5,
      } as any),
    );
    Object.assign(ids, {
      owner: owner.id,
      employee: employee.id,
      store: store.id,
      reason: reason.id,
      profile: (profile as any).id,
    });

    const oldContract = await repo(EmployeeContract).save(
      repo(EmployeeContract).create({
        employeeProfileId: ids.profile,
        salaryAmount: 4_000_000,
        paymentType: PaymentType.MONTH,
        isActive: true,
      } as any),
    );
    ids.oldContract = (oldContract as any).id;
    const asset = await repo(Asset).save(
      repo(Asset).create({ storeId: store.id, name: 'Áo', currentStock: 4 }),
    );
    ids.asset = asset.id;
    const held = await repo(EmployeeAssetAssignment).save(
      repo(EmployeeAssetAssignment).create({
        employeeProfileId: ids.profile,
        assetId: asset.id,
        quantity: 1,
      }),
    );
    ids.oldAssetAssignment = held.id;
    const face = await repo(EmployeeFace).save(
      repo(EmployeeFace).create({
        employeeProfileId: ids.profile,
        storeId: store.id,
        isActive: true,
      }),
    );
    ids.face = face.id;
    const group = await repo(ChatGroup).save(
      repo(ChatGroup).create({
        name: 'Nhóm cửa hàng',
        storeId: store.id,
        createdBy: owner.id,
      } as any),
    );
    const member = await repo(ChatGroupMember).save(
      repo(ChatGroupMember).create({
        groupId: (group as any).id,
        accountId: employee.id,
        status: 'active',
      }),
    );
    ids.member = member.id;
    await repo(EmployeeCapabilityEntry).save(
      repo(EmployeeCapabilityEntry).create({
        employeeProfileId: ids.profile,
        points: 5,
        awardedAt: new Date(Date.now() - 30 * DAY_MS),
      }),
    );

    const shift = await repo(WorkShift).save(
      repo(WorkShift).create({
        storeId: store.id,
        shiftName: 'Ca sáng',
        startTime: '08:00',
        endTime: '12:00',
      } as any),
    );
    const cycle = await repo(WorkCycle).save(
      repo(WorkCycle).create({
        storeId: store.id,
        name: 'Chu kỳ',
        cycleType: CycleType.INDEFINITE,
        startDate: getTodayDateString(),
      } as any),
    );
    const slot = await repo(ShiftSlot).save(
      repo(ShiftSlot).create({
        cycleId: (cycle as any).id,
        workShiftId: (shift as any).id,
        workDate: addDays(getTodayDateString(), 1),
      } as any),
    );
    const future = await repo(ShiftAssignment).save(
      repo(ShiftAssignment).create({
        shiftSlotId: (slot as any).id,
        employeeId: ids.profile,
        status: ShiftAssignmentStatus.APPROVED,
      } as any),
    );
    ids.future = (future as any).id;

    // The seeded rows belong to a stint that started long ago.
    await dataSource.query(
      `UPDATE employee_contracts SET created_at = $1 WHERE id = $2`,
      [long, ids.oldContract],
    );
    await dataSource.query(
      `UPDATE employee_asset_assignments SET assigned_date = $1, created_at = $1 WHERE id = $2`,
      [long, ids.oldAssetAssignment],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA "${schema}" CASCADE`);
      await dataSource.destroy();
    }
  });

  it('terminates, then rehires the same account as a fresh stint', async () => {
    await service.deleteEmployee(ids.profile, ids.reason, ids.owner);

    const cancelled = await dataSource
      .getRepository(ShiftAssignment)
      .findOneOrFail({ where: { id: ids.future } });
    expect(cancelled.status).toBe(ShiftAssignmentStatus.CANCELLED);

    const result: any = await service.addEmployee(
      ids.store,
      ids.employee,
      {
        contract: { salaryAmount: 6_000_000, paymentType: PaymentType.MONTH },
        assetIds: [ids.asset],
      } as any,
      ids.owner,
    );

    // One profile row, revived.
    expect(result.profile.id).toBe(ids.profile);
    expect(result.rehire).toEqual({
      revived: true,
      currentMonthPayslipLocked: false,
    });
    const profiles = await dataSource
      .getRepository(EmployeeProfile)
      .find({ where: { accountId: ids.employee }, withDeleted: true });
    expect(profiles).toHaveLength(1);
    expect(profiles[0].capabilityPoints).toBe(0);
    expect(profiles[0].deletedAt).toBeNull();

    // Old contract inactive; the view shows only the new one, which was
    // written inside the hire transaction (created_at before joined_at).
    const oldContract = await dataSource
      .getRepository(EmployeeContract)
      .findOneOrFail({ where: { id: ids.oldContract } });
    expect(oldContract.isActive).toBe(false);
    expect(result.profile.contracts).toHaveLength(1);
    expect(result.profile.contracts[0].id).not.toBe(ids.oldContract);
    expect(result.profile.contracts[0].isActive).toBe(true);

    // Old asset returned, same item re-issued: stock nets back to 4.
    const oldHeld = await dataSource
      .getRepository(EmployeeAssetAssignment)
      .findOneOrFail({ where: { id: ids.oldAssetAssignment } });
    expect(oldHeld.status).toBe('RETURNED');
    const asset = await dataSource
      .getRepository(Asset)
      .findOneOrFail({ where: { id: ids.asset } });
    expect(Number(asset.currentStock)).toBe(4);
    const assets = await service.getEmployeeAssets(ids.profile);
    expect(assets).toHaveLength(1);

    const face = await dataSource
      .getRepository(EmployeeFace)
      .findOneOrFail({ where: { id: ids.face } });
    expect(face.isActive).toBe(false);

    const member = await dataSource
      .getRepository(ChatGroupMember)
      .findOneOrFail({ where: { id: ids.member } });
    expect(member.status).toBe('removed');

    expect(await careerLadder.getCapabilityEntries(ids.profile)).toEqual([]);

    // Payslips are never deleted: exactly one row for this month.
    expect(
      await dataSource
        .getRepository(EmployeeSalary)
        .count({ where: { employeeProfileId: ids.profile }, withDeleted: true }),
    ).toBe(1);
  });
});
