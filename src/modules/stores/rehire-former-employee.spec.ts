import { StoresService } from './stores.service';
import { JobApplicationService } from './job-application.service';
import {
  EmploymentStatus,
  WorkingStatus,
} from './entities/employee-profile.entity';
import {
  EmployeeSalary,
  PaymentStatus,
} from './entities/employee-salary.entity';
import { EmployeeMonthlySummary } from './entities/employee-monthly-summary.entity';
import { EmployeeContract } from './entities/employee-contract.entity';
import { EmployeeFace } from './entities/employee-face.entity';
import { Asset } from './entities/asset.entity';
import {
  AssetAssignmentStatus,
  EmployeeAssetAssignment,
} from './entities/employee-asset-assignment.entity';
import { ChatGroupMember } from '../chat-groups/entities/chat-group-member.entity';

/**
 * Removing an employee soft-deletes their profile, which the owner sees in the
 * deleted list. That stint is over, so the person may apply again and accepting
 * revives the original row instead of creating a second one.
 */
const STORE = 'store-1';
const ACCOUNT = 'account-1';

describe('loadFormerEmployment', () => {
  const build = (profiles: unknown[], summaryRows: unknown[] = []) => {
    const service = Object.create(JobApplicationService.prototype) as any;
    const builder: any = {
      withDeleted: jest.fn(() => builder),
      leftJoinAndSelect: jest.fn(() => builder),
      where: jest.fn(() => builder),
      andWhere: jest.fn(() => builder),
      getMany: jest.fn().mockResolvedValue(profiles),
    };
    // The attendance roll-up runs through the profile repository's manager, so
    // the service needs no extra constructor argument.
    const summaryBuilder: any = {
      select: jest.fn(() => summaryBuilder),
      addSelect: jest.fn(() => summaryBuilder),
      where: jest.fn(() => summaryBuilder),
      groupBy: jest.fn(() => summaryBuilder),
      getRawMany: jest.fn().mockResolvedValue(summaryRows),
    };
    service.profileRepository = {
      createQueryBuilder: jest.fn(() => builder),
      manager: {
        getRepository: jest.fn(() => ({
          createQueryBuilder: jest.fn(() => summaryBuilder),
        })),
      },
    };
    return { service, builder, summaryBuilder };
  };

  const profile = (over: Record<string, unknown> = {}) => ({
    id: 'profile-1',
    accountId: ACCOUNT,
    storeId: STORE,
    employmentStatus: EmploymentStatus.TERMINATED,
    joinedAt: new Date('2026-01-05T00:00:00Z'),
    leftAt: new Date('2026-09-14T00:00:00Z'),
    deletedAt: null,
    ...over,
  });

  it('reports a terminated stint with its reason', async () => {
    const { service } = build([
      profile({ terminationReason: { name: 'Hết hạn hợp đồng' } }),
    ]);

    const found = await service.loadFormerEmployment(STORE, [ACCOUNT]);

    expect(found.get(ACCOUNT)).toMatchObject({
      joinedAt: '2026-01-05T00:00:00.000Z',
      leftAt: '2026-09-14T00:00:00.000Z',
      terminationReason: 'Hết hạn hợp đồng',
    });
  });

  // pg returns SUM as a string; printing "142" as "142" and not NaN depends
  // on coercing here.
  it('sums the past attendance across monthly rows', async () => {
    const { service } = build(
      [profile({ id: 'profile-1' })],
      [
        {
          profileId: 'profile-1',
          completedShifts: '142',
          lateArrivals: '3',
          unauthorizedLeaves: '0',
        },
      ],
    );

    const found = await service.loadFormerEmployment(STORE, [ACCOUNT]);

    expect(found.get(ACCOUNT)?.record).toEqual({
      completedShifts: 142,
      lateArrivals: 3,
      unauthorizedLeaves: 0,
    });
  });

  // No summary rows must not read as a perfect record of zeroes.
  it('leaves the record null when the stint produced no summaries', async () => {
    const { service } = build([profile({ id: 'profile-1' })], []);

    const found = await service.loadFormerEmployment(STORE, [ACCOUNT]);

    expect(found.get(ACCOUNT)?.record).toBeNull();
  });

  // Removing someone from the list only soft-deletes them; that still ends the
  // stint, and it is the case the owner's badge exists for.
  it('counts a soft-deleted profile as a finished stint', async () => {
    const { service } = build([
      profile({
        employmentStatus: EmploymentStatus.ACTIVE,
        leftAt: null,
        deletedAt: new Date('2026-09-14T00:00:00Z'),
      }),
    ]);

    const found = await service.loadFormerEmployment(STORE, [ACCOUNT]);

    expect(found.get(ACCOUNT)?.leftAt).toBe('2026-09-14T00:00:00.000Z');
  });

  it('ignores someone still employed', async () => {
    const { service } = build([
      profile({ employmentStatus: EmploymentStatus.ACTIVE, leftAt: null }),
    ]);

    expect((await service.loadFormerEmployment(STORE, [ACCOUNT])).size).toBe(0);
  });

  // One query per page, not one per applicant.
  it('does not query at all for an empty page', async () => {
    const { service } = build([]);

    await service.loadFormerEmployment(STORE, []);

    expect(service.profileRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('includes soft-deleted rows in the lookup', async () => {
    const { service, builder } = build([profile()]);

    await service.loadFormerEmployment(STORE, [ACCOUNT]);

    expect(builder.withDeleted).toHaveBeenCalled();
  });
});

describe('initializeEmployeeProfile — khôi phục hồ sơ cũ', () => {
  const build = () => {
    const service = Object.create(StoresService.prototype) as any;
    service.assertEmployeeReferences = jest.fn().mockResolvedValue(undefined);
    service.createContract = jest.fn().mockResolvedValue(undefined);
    const saved: Record<string, unknown>[] = [];
    // The method carries on past the profile save into payroll scaffolding;
    // those repositories are stubbed so the assertion above can be reached.
    const stubRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => data),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    const manager: any = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn(() => stubRepository),
      query: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      insert: jest.fn().mockResolvedValue({ identifiers: [] }),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
      save: jest.fn(async (_entity: unknown, data: Record<string, unknown>) => {
        saved.push(data);
        return { id: (data.id as string) ?? 'new-profile', ...data };
      }),
    };
    return { service, manager, saved };
  };

  // The bug this guards: saving the hire fields alone left `deleted_at` set, so
  // the rehired employee stayed in the deleted list and never reappeared in the
  // store's own employee list.
  it('clears the departure markers when reviving a profile', async () => {
    const { service, manager, saved } = build();

    await service.initializeEmployeeProfile(manager, STORE, ACCOUNT, {} as any, 'old-profile');

    expect(saved[0]).toMatchObject({
      id: 'old-profile',
      deletedAt: null,
      leftAt: null,
      terminationReasonId: null,
    });
  });

  it('does not touch those fields for a brand new hire', async () => {
    const { service, manager, saved } = build();

    await service.initializeEmployeeProfile(manager, STORE, ACCOUNT, {} as any);

    expect(saved[0]).not.toHaveProperty('deletedAt');
    expect(saved[0]).not.toHaveProperty('leftAt');
  });

  // C: tenure counts from the hire. A revived row gets its own entry event,
  // so days in rung no longer count from the previous stint (or stay 0).
  it('records an entry career event for a revived profile', async () => {
    const { service, manager, saved } = build();
    manager.find.mockImplementation(async (entity: any) =>
      entity?.name === 'StoreLadder'
        ? [{ id: 'ladder-type', dimension: 'employment_type' }]
        : [],
    );
    manager.findOne.mockImplementation(async (entity: any) =>
      entity?.name === 'StoreLadderRung' ? { id: 'rung-official' } : null,
    );

    await service.initializeEmployeeProfile(
      manager,
      STORE,
      ACCOUNT,
      { employeeTypeId: 'type-official' } as any,
      'old-profile',
    );

    const event = saved.find((row) => row.toRungId === 'rung-official');
    expect(event).toMatchObject({
      employeeProfileId: 'old-profile',
      ladderId: 'ladder-type',
      fromRungId: null,
      note: 'Vào làm',
      effectiveAt: expect.any(Date),
    });
  });
});

describe('initializeEmployeeProfile — nhận lại nhân viên cũ như người mới', () => {
  const build = (existingPayslip: Record<string, unknown> | null = null) => {
    const service = Object.create(StoresService.prototype) as any;
    service.assertEmployeeReferences = jest.fn().mockResolvedValue(undefined);
    service.createContract = jest.fn().mockResolvedValue(undefined);
    service.resetFormerStintForRehire = jest.fn().mockResolvedValue(undefined);
    service.assignInitialAssets = jest.fn().mockResolvedValue(undefined);
    const saved: Record<string, unknown>[] = [];
    const salaryRepository = {
      findOne: jest.fn().mockResolvedValue(existingPayslip),
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => data),
      update: jest.fn().mockResolvedValue({}),
      restore: jest.fn().mockResolvedValue({}),
    };
    const stubRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => data),
      upsert: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
      createQueryBuilder: jest.fn(),
    };
    const manager: any = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity: any) =>
        entity === EmployeeSalary ? salaryRepository : stubRepository,
      ),
      query: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      insert: jest.fn().mockResolvedValue({ identifiers: [] }),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
      save: jest.fn(async (_entity: unknown, data: Record<string, unknown>) => {
        saved.push(data);
        return { id: (data.id as string) ?? 'new-profile', ...data };
      }),
    };
    return { service, manager, saved, salaryRepository };
  };

  const revive = (service: any, manager: any, data: any = {}) =>
    service.initializeEmployeeProfile(
      manager,
      STORE,
      ACCOUNT,
      data,
      'old-profile',
      { revivesFormerStint: true },
    );

  it('resets the profile state left by the previous stint', async () => {
    const { service, manager, saved } = build();

    const result = await revive(service, manager);

    expect(saved[0]).toMatchObject({
      id: 'old-profile',
      capabilityPoints: 0,
      reminderSettings: null,
      preferredShiftTypes: null,
      shiftPreferenceNote: null,
      workingStatus: WorkingStatus.OFF,
      probationEndsAt: null,
      storeRoleId: null,
      workShiftId: null,
      skillId: null,
      employeeTypeId: null,
      deletedAt: null,
      leftAt: null,
      terminationReasonId: null,
    });
    expect(result).toEqual({
      profile: expect.objectContaining({ id: 'old-profile' }),
      currentMonthPayslipLocked: false,
    });
    expect(service.resetFormerStintForRehire).toHaveBeenCalledWith(
      manager,
      { id: 'old-profile', storeId: STORE, accountId: ACCOUNT },
      expect.any(Date),
    );
  });

  it('keeps the chosen role, shift and skill', async () => {
    const { service, manager, saved } = build();

    await revive(service, manager, {
      storeRoleId: 'role-1',
      workShiftId: 'shift-1',
      skillId: 'skill-1',
    });

    expect(saved[0]).toMatchObject({
      storeRoleId: 'role-1',
      workShiftId: 'shift-1',
      skillId: 'skill-1',
    });
  });

  it('keeps a computed probation end for a probation type', async () => {
    const { service, manager, saved } = build();
    const ends = new Date('2026-11-01T00:00:00Z');
    service.resolveHireEmploymentType = jest.fn().mockResolvedValue({
      employeeTypeId: 'type-probation',
      employmentStatus: EmploymentStatus.PROBATION,
      probationEndsAt: ends,
    });

    await revive(service, manager);

    expect(saved[0]).toMatchObject({
      employeeTypeId: 'type-probation',
      employmentStatus: EmploymentStatus.PROBATION,
      probationEndsAt: ends,
    });
  });

  it('closes the previous stint before the new contract and assets', async () => {
    const { service, manager } = build();

    await revive(service, manager, {
      contract: { salaryAmount: 5_000_000 },
      assetIds: ['asset-1'],
    });

    const reset = service.resetFormerStintForRehire.mock.invocationCallOrder[0];
    expect(reset).toBeLessThan(service.createContract.mock.invocationCallOrder[0]);
    expect(reset).toBeLessThan(
      service.assignInitialAssets.mock.invocationCallOrder[0],
    );
    expect(reset).toBeLessThan(manager.save.mock.invocationCallOrder[0]);
  });

  it('resets the current-month summary counters when reviving', async () => {
    const { service, manager } = build();

    await revive(service, manager, { contract: { salaryAmount: 6_000_000 } });

    expect(manager.update).toHaveBeenCalledWith(
      EmployeeMonthlySummary,
      { employeeProfileId: 'old-profile', month: expect.any(Date) },
      expect.objectContaining({
        totalShifts: 0,
        completedShifts: 0,
        lateArrivalsCount: 0,
        unauthorizedLeavesCount: 0,
        estimatedSalary: 0,
        baseSalary: 6_000_000,
      }),
    );
  });

  it('reports a locked payslip and does not rewrite it', async () => {
    const { service, manager, salaryRepository } = build({
      id: 'slip-1',
      paymentStatus: PaymentStatus.PAID,
      monthlyPayrollId: 'payroll-1',
      deletedAt: null,
    });

    const result = await revive(service, manager);

    expect(result.currentMonthPayslipLocked).toBe(true);
    expect(salaryRepository.save).not.toHaveBeenCalled();
    expect(salaryRepository.update).not.toHaveBeenCalled();
  });

  it('does not report a lock when the payslip is still pending', async () => {
    const { service, manager, salaryRepository } = build({
      id: 'slip-1',
      paymentStatus: PaymentStatus.PENDING,
      monthlyPayrollId: 'payroll-1',
      deletedAt: null,
    });

    const result = await revive(service, manager);

    expect(result.currentMonthPayslipLocked).toBe(false);
    expect(salaryRepository.update).toHaveBeenCalled();
  });

  it('leaves a PENDING applicant promotion as it was', async () => {
    const { service, manager, saved } = build({
      id: 'slip-1',
      paymentStatus: PaymentStatus.APPROVED,
      monthlyPayrollId: 'payroll-1',
      deletedAt: null,
    });

    const result = await service.initializeEmployeeProfile(
      manager,
      STORE,
      ACCOUNT,
      {} as any,
      'pending-profile',
    );

    expect(service.resetFormerStintForRehire).not.toHaveBeenCalled();
    expect(saved[0]).not.toHaveProperty('capabilityPoints');
    expect(saved[0]).not.toHaveProperty('reminderSettings');
    expect(saved[0]).not.toHaveProperty('workingStatus');
    expect(manager.update).not.toHaveBeenCalledWith(
      EmployeeMonthlySummary,
      expect.anything(),
      expect.anything(),
    );
    // Only a revived stint reports the lock.
    expect(result.currentMonthPayslipLocked).toBe(false);
  });
});

describe('resetFormerStintForRehire', () => {
  const qb = (rows: any[] = [], sink: Record<string, any> = {}) => {
    const builder: any = {};
    for (const m of ['where', 'andWhere', 'orderBy', 'setLock', 'set', 'update']) {
      builder[m] = jest.fn((...args: any[]) => {
        (sink[m] ||= []).push(args);
        return builder;
      });
    }
    builder.getMany = jest.fn().mockResolvedValue(rows);
    builder.execute = jest.fn().mockResolvedValue({ affected: 2 });
    return builder;
  };

  const build = (held: any[] = [], assets: any[] = []) => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = { log: jest.fn() };
    service.cancelFutureShiftAssignments = jest
      .fn()
      .mockResolvedValue(['shift-1']);
    service.closePendingRequestsOfLeaver = jest.fn().mockResolvedValue(undefined);
    const assetSink: Record<string, any> = {};
    const chatSink: Record<string, any> = {};
    const heldSink: Record<string, any> = {};
    const chatQb = qb([], chatSink);
    const manager: any = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn(async (_e: unknown, v: unknown) => v),
      getRepository: jest.fn((entity: any) => ({
        createQueryBuilder: jest.fn(() =>
          entity === Asset ? qb(assets, assetSink) : qb(held, heldSink),
        ),
      })),
      createQueryBuilder: jest.fn(() => chatQb),
    };
    return { service, manager, assetSink, chatSink, heldSink };
  };

  const NOW = new Date('2026-09-22T05:00:00Z');
  const P = { id: 'old-profile', storeId: STORE, accountId: ACCOUNT };

  it('deactivates contracts and faces with exact criteria', async () => {
    const { service, manager } = build();

    await service.resetFormerStintForRehire(manager, P, NOW);

    expect(manager.update).toHaveBeenCalledWith(
      EmployeeContract,
      { employeeProfileId: 'old-profile', isActive: true },
      { isActive: false },
    );
    expect(manager.update).toHaveBeenCalledWith(
      EmployeeFace,
      { employeeProfileId: 'old-profile', isActive: true },
      { isActive: false },
    );
    expect(service.cancelFutureShiftAssignments).toHaveBeenCalledWith(
      manager,
      'old-profile',
      NOW,
    );
  });

  it('closes requests the previous stint left pending (backstop)', async () => {
    const { service, manager } = build();

    await service.resetFormerStintForRehire(manager, P, NOW);

    expect(service.closePendingRequestsOfLeaver).toHaveBeenCalledWith(
      manager,
      'old-profile',
    );
  });

  it('returns held assets to stock by quantity, locking assets in id order', async () => {
    const held = [
      { id: 'ea-1', assetId: 'asset-b', quantity: 1 },
      { id: 'ea-2', assetId: 'asset-a', quantity: 2 },
      { id: 'ea-3', assetId: 'asset-b', quantity: 3 },
    ];
    const assets = [
      { id: 'asset-a', currentStock: 4 },
      { id: 'asset-b', currentStock: '1' },
    ];
    const { service, manager, assetSink, heldSink } = build(held, assets);

    await service.resetFormerStintForRehire(manager, P, NOW);

    expect(heldSink.where[0][1]).toEqual({
      id: 'old-profile',
      status: AssetAssignmentStatus.ASSIGNED,
    });
    expect(heldSink.setLock[0][0]).toBe('pessimistic_write');
    expect(assetSink.where[0][1]).toEqual({ assetIds: ['asset-a', 'asset-b'] });
    expect(assetSink.andWhere[0][1]).toEqual({ storeId: STORE });
    expect(assetSink.orderBy[0]).toEqual(['asset.id', 'ASC']);
    expect(assetSink.setLock[0][0]).toBe('pessimistic_write');
    expect(manager.save).toHaveBeenCalledWith(Asset, { id: 'asset-a', currentStock: 6 });
    expect(manager.save).toHaveBeenCalledWith(Asset, { id: 'asset-b', currentStock: 5 });

    const returned = manager.update.mock.calls.find(
      ([entity]: any[]) => entity === EmployeeAssetAssignment,
    );
    expect(returned[1].id.value).toEqual(['ea-1', 'ea-2', 'ea-3']);
    expect(returned[2]).toEqual({
      status: AssetAssignmentStatus.RETURNED,
      returnedDate: NOW,
      returnNote: expect.stringContaining('Tự động thu hồi'),
    });
  });

  it('removes store group memberships but not direct chats or own groups', async () => {
    const { service, manager, chatSink } = build();

    await service.resetFormerStintForRehire(manager, P, NOW);

    expect(chatSink.update[0][0]).toBe(ChatGroupMember);
    expect(chatSink.set[0][0]).toEqual({ status: 'removed' });
    const sql = chatSink.andWhere.map((args: any[]) => args[0]).join(' ');
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain('g.direct_key IS NULL');
    expect(sql).toContain('g.created_by <> :accountId');
    expect(sql).toContain('g.store_id = :storeId');
    expect(chatSink.where[0][1]).toEqual({ accountId: ACCOUNT });
  });

  it('does nothing to assets when none are held', async () => {
    const { service, manager } = build([], []);

    await expect(
      service.resetFormerStintForRehire(manager, P, NOW),
    ).resolves.toBeUndefined();
    expect(manager.save).not.toHaveBeenCalled();
    expect(
      manager.update.mock.calls.some(
        ([entity]: any[]) => entity === EmployeeAssetAssignment,
      ),
    ).toBe(false);
  });

  it('logs counts only', async () => {
    const { service, manager } = build();

    await service.resetFormerStintForRehire(manager, P, NOW);

    expect(service.logger.log).toHaveBeenCalledWith(
      '[Rehire] profile=old-profile contracts=1 assets=0 faces=1 chats=2 shifts=1',
    );
  });
});

describe('attachExistingEmployee — cờ nhận lại', () => {
  const build = (profiles: any[], locked = false) => {
    const service = Object.create(StoresService.prototype) as any;
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue({});
    service.initializeEmployeeProfile = jest.fn(
      async (_m: unknown, _s: unknown, _a: unknown, _d: unknown, id?: string) => ({
        profile: { id: id ?? 'new-profile' },
        currentMonthPayslipLocked: locked,
      }),
    );
    service.getEmployeeById = jest.fn(async (id: string) => ({
      profile: { id },
      monthlySummary: null,
      recentActivities: [],
    }));
    const builder: any = {
      withDeleted: jest.fn(() => builder),
      where: jest.fn(() => builder),
      getMany: jest.fn().mockResolvedValue(profiles),
    };
    const manager: any = {
      findOne: jest.fn(async (entity: any) =>
        entity?.name === 'Account'
          ? { id: ACCOUNT, status: 'active' }
          : { id: STORE, ownerAccountId: 'owner-1' },
      ),
      getRepository: jest.fn(() => ({ createQueryBuilder: () => builder })),
    };
    service.dataSource = {
      transaction: jest.fn(async (cb: any) => cb(manager)),
    };
    return service;
  };

  it('revives a former employee as a new stint and reports the lock', async () => {
    const service = build(
      [
        {
          id: 'old-profile',
          storeId: STORE,
          accountId: ACCOUNT,
          employmentStatus: EmploymentStatus.TERMINATED,
          deletedAt: new Date('2026-09-01T00:00:00Z'),
        },
      ],
      true,
    );

    const result = await service.addEmployee(STORE, ACCOUNT, {}, 'owner-1');

    expect(service.initializeEmployeeProfile).toHaveBeenCalledWith(
      expect.anything(),
      STORE,
      ACCOUNT,
      {},
      'old-profile',
      { revivesFormerStint: true },
    );
    expect(result).toEqual({
      profile: { id: 'old-profile' },
      monthlySummary: null,
      recentActivities: [],
      rehire: { revived: true, currentMonthPayslipLocked: true },
    });
  });

  it('promotes a PENDING applicant without reviving', async () => {
    const service = build([
      {
        id: 'pending-profile',
        storeId: STORE,
        accountId: ACCOUNT,
        employmentStatus: EmploymentStatus.PENDING,
        deletedAt: null,
      },
    ]);

    const result = await service.addEmployee(STORE, ACCOUNT, {}, 'owner-1');

    expect(service.initializeEmployeeProfile).toHaveBeenCalledWith(
      expect.anything(),
      STORE,
      ACCOUNT,
      {},
      'pending-profile',
      { revivesFormerStint: false },
    );
    expect(result.rehire).toEqual({
      revived: false,
      currentMonthPayslipLocked: false,
    });
  });

  it('hires a brand-new person without reviving', async () => {
    const service = build([]);

    const result = await service.addEmployee(STORE, ACCOUNT, {}, 'owner-1');

    expect(service.initializeEmployeeProfile.mock.calls[0][5]).toEqual({
      revivesFormerStint: false,
    });
    expect(result.rehire.revived).toBe(false);
  });
});
