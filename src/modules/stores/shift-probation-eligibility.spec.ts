/**
 * Phase 3 A3 (probation staff can take shifts) and B3 (a fixed shift with no
 * end date registers every slot already open, up to 366 days).
 */
import { In } from 'typeorm';

import { ForbiddenException } from '@nestjs/common';

import {
  FIXED_SHIFT_MAX_RANGE_DAYS,
  SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES,
  StoresService,
} from './stores.service';
import { ShiftAggregationService } from './shift-aggregation.service';
import {
  EMPLOYED_STATUSES,
  EmployeeProfile,
  EmploymentStatus,
} from './entities/employee-profile.entity';
import {
  ShiftAssignment,
  ShiftAssignmentStatus,
  WorkCycle,
  WorkCycleStatus,
} from './entities/shift-management.entity';
import { Store } from './entities/store.entity';
import { WorkShift } from './entities/work-shift.entity';

const STATUS_ERROR = 'Nhân viên không còn hoạt động, không thể đăng ký ca';

describe('shift eligibility includes probation', () => {
  it('lists ACTIVE and PROBATION, not ON_LEAVE', () => {
    expect([...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]).toEqual([
      EmploymentStatus.ACTIVE,
      EmploymentStatus.PROBATION,
    ]);
  });

  const registerService = (employmentStatus: EmploymentStatus) => {
    const service = Object.create(StoresService.prototype) as any;
    service.shiftSlotRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'slot-1',
        cycle: { storeId: 'store-1' },
      }),
    };
    service.storeRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
    };
    const manager = {
      query: jest.fn(),
      createQueryBuilder: jest.fn(() => {
        const qb: any = {
          setLock: jest.fn(() => qb),
          where: jest.fn(() => qb),
          getOne: jest.fn().mockResolvedValue({
            id: 'slot-1',
            cycleId: 'cycle-1',
            workShiftId: 'ws-1',
            maxStaff: 0,
          }),
        };
        return qb;
      }),
      findOne: jest.fn(async (entity: any) => {
        if (entity === WorkCycle) {
          return { id: 'cycle-1', storeId: 'store-1', status: WorkCycleStatus.ACTIVE };
        }
        if (entity === WorkShift) return { id: 'ws-1', defaultMaxStaff: 0 };
        if (entity === Store) return { id: 'store-1', ownerAccountId: 'owner-1' };
        if (entity === EmployeeProfile) {
          return { id: 'emp-1', storeId: 'store-1', accountId: 'acc-1', employmentStatus };
        }
        // Stop right after the status gate: "already registered".
        if (entity === ShiftAssignment) {
          return { id: 'existing', status: ShiftAssignmentStatus.APPROVED };
        }
        return null;
      }),
      find: jest.fn().mockResolvedValue([]),
    };
    service.dataSource = { transaction: jest.fn(async (work: any) => work(manager)) };
    return { service, manager };
  };

  it('lets the owner assign a probation employee past the status check', async () => {
    const { service, manager } = registerService(EmploymentStatus.PROBATION);
    const outcome = await service
      .registerToShiftSlot('slot-1', 'emp-1', undefined, true, 'owner-1')
      .catch((error: Error) => error);
    expect(outcome?.message).not.toBe(STATUS_ERROR);
    // Reached the duplicate-registration lookup that follows the gate.
    expect(manager.findOne).toHaveBeenCalledWith(
      ShiftAssignment,
      expect.objectContaining({
        where: expect.objectContaining({ employeeId: 'emp-1' }),
      }),
    );
  });

  it('still refuses an employee on leave', async () => {
    const { service } = registerService(EmploymentStatus.ON_LEAVE);
    await expect(
      service.registerToShiftSlot('slot-1', 'emp-1', undefined, true, 'owner-1'),
    ).rejects.toThrow(STATUS_ERROR);
  });

  const selfService = (employmentStatus: EmploymentStatus) => {
    const service = Object.create(StoresService.prototype) as any;
    service.profileRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'emp-1',
        storeId: 'store-1',
        accountId: 'acc-1',
        employmentStatus,
      }),
    };
    service.registerToShiftSlot = jest.fn().mockResolvedValue({ id: 'assignment-1' });
    return service;
  };

  it('lets a probation employee self-register (single slot)', async () => {
    const service = selfService(EmploymentStatus.PROBATION);
    await expect(
      service.createShiftRegistration('acc-1', {
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        slotId: 'slot-1',
      }),
    ).resolves.toEqual({ id: 'assignment-1' });
  });

  it('refuses self-registration while on leave', async () => {
    const service = selfService(EmploymentStatus.ON_LEAVE);
    await expect(
      service.createShiftRegistration('acc-1', {
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        slotId: 'slot-1',
      }),
    ).rejects.toThrow(STATUS_ERROR);
    expect(service.registerToShiftSlot).not.toHaveBeenCalled();
  });

  it('offers probation staff in the owner schedule picker', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.storeRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
    };
    service.profileRepository = { find: jest.fn().mockResolvedValue([]) };
    await service.getShiftEmployeeOptions('store-1', 'owner-1', {
      startDate: '2030-01-01',
      startTime: '07:00',
      endTime: '11:00',
      recurrence: {
        enabled: false,
        frequency: 'DAILY',
        interval: 1,
        endType: 'COUNT',
        occurrenceCount: 1,
      },
    });
    expect(service.profileRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storeId: 'store-1',
          employmentStatus: In([...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]),
        },
      }),
    );
  });

  it('accepts probation staff when a schedule commits', async () => {
    const service = Object.create(StoresService.prototype) as any;
    const manager = {
      find: jest.fn().mockResolvedValue([]),
    };
    // No eligible row comes back, so it refuses; the query is what matters.
    await expect(
      service.assertShiftScheduleAvailabilityAtCommit(
        manager,
        'store-1',
        [{ employeeIds: ['emp-1'] }],
        ['2030-01-01'],
      ),
    ).rejects.toThrow();
    expect(manager.find).toHaveBeenCalledWith(
      EmployeeProfile,
      expect.objectContaining({
        where: {
          id: In(['emp-1']),
          storeId: 'store-1',
          employmentStatus: In([...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]),
        },
      }),
    );
  });
});

describe('fixed-shift registration range (B3)', () => {
  const rangeService = (latest: unknown) => {
    const service = Object.create(StoresService.prototype) as any;
    const qb: any = {};
    for (const method of ['innerJoin', 'select', 'where', 'andWhere']) {
      qb[method] = jest.fn(() => qb);
    }
    qb.getRawOne = jest.fn().mockResolvedValue({ latest });
    service.shiftSlotRepository = { createQueryBuilder: jest.fn(() => qb) };
    return { service, qb };
  };

  it('uses the latest open slot when no end date is given', async () => {
    const { service, qb } = rangeService('2026-11-30');
    await expect(
      service.resolveFixedShiftRangeEnd('store-1', 'ws-1', '2026-10-01', undefined),
    ).resolves.toBe('2026-11-30');
    expect(qb.andWhere).toHaveBeenCalledWith('cycle.status = :activeStatus', {
      activeStatus: WorkCycleStatus.ACTIVE,
    });
    expect(qb.andWhere).toHaveBeenCalledWith('cycle.storeId = :storeId', {
      storeId: 'store-1',
    });
  });

  it('reads a pg Date for the latest slot on its local calendar day', async () => {
    const { service } = rangeService(new Date(2026, 10, 30));
    await expect(
      service.resolveFixedShiftRangeEnd('store-1', 'ws-1', '2026-10-01', undefined),
    ).resolves.toBe('2026-11-30');
  });

  it(`caps the range at ${FIXED_SHIFT_MAX_RANGE_DAYS} days`, async () => {
    const { service } = rangeService('2031-01-01');
    await expect(
      service.resolveFixedShiftRangeEnd('store-1', 'ws-1', '2026-10-01', undefined),
    ).resolves.toBe('2027-10-02');
  });

  it('falls back to the start date when nothing is open', async () => {
    const { service } = rangeService(null);
    await expect(
      service.resolveFixedShiftRangeEnd('store-1', 'ws-1', '2026-10-01', undefined),
    ).resolves.toBe('2026-10-01');
  });

  it('keeps an explicit end date and refuses one before the start', async () => {
    const { service, qb } = rangeService(null);
    await expect(
      service.resolveFixedShiftRangeEnd('store-1', 'ws-1', '2026-10-01', '2026-10-31'),
    ).resolves.toBe('2026-10-31');
    await expect(
      service.resolveFixedShiftRangeEnd('store-1', 'ws-1', '2026-10-01', '2026-09-30'),
    ).rejects.toThrow('Ngày kết thúc phải sau ngày bắt đầu');
    expect(qb.getRawOne).not.toHaveBeenCalled();
  });

  it('passes the resolved end to the batch slot query', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.profileRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'emp-1',
        storeId: 'store-1',
        accountId: 'acc-1',
        employmentStatus: EmploymentStatus.PROBATION,
      }),
    };
    const qb: any = {};
    for (const method of [
      'innerJoin',
      'leftJoinAndSelect',
      'select',
      'where',
      'andWhere',
    ]) {
      qb[method] = jest.fn(() => qb);
    }
    qb.getRawOne = jest.fn().mockResolvedValue({ latest: '2026-12-31' });
    qb.getMany = jest.fn().mockResolvedValue([]);
    service.shiftSlotRepository = { createQueryBuilder: jest.fn(() => qb) };

    await expect(
      service.createShiftRegistration('acc-1', {
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        workShiftId: 'ws-1',
        startDate: '2026-10-01',
        daysOfWeek: [1],
      }),
    ).rejects.toThrow('Không tìm thấy ca làm việc nào phù hợp');
    expect(qb.andWhere).toHaveBeenCalledWith('slot.workDate <= :endDate', {
      endDate: '2026-12-31',
    });
  });
});

describe('probation staff read their schedule and are paid', () => {
  /** A profile repository answering from rows, honouring `In(...)`. */
  const profilesRepo = (rows: any[]) => ({
    findOne: jest.fn(async ({ where }: any) =>
      rows.find((row) =>
        Object.entries(where).every(([key, value]: [string, any]) =>
          value && typeof value === 'object' && '_value' in value
            ? (value._value as unknown[]).includes(row[key])
            : row[key] === value,
        ),
      ) ?? null,
    ),
  });
  const probationer = (employmentStatus = EmploymentStatus.PROBATION) => ({
    id: 'emp-1',
    storeId: 'store-1',
    accountId: 'acc-1',
    employmentStatus,
  });

  it('GET :id/shift-slots lets a probation employee read their own slots', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.storeRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
    };
    service.profileRepository = profilesRepo([probationer()]);
    // Stop right after authorization.
    service.shiftSlotRepository = {
      createQueryBuilder: jest.fn(() => {
        throw new Error('authorized');
      }),
    };
    await expect(
      service.getStoreShiftSlots('store-1', undefined, undefined, 'emp-1', 'acc-1'),
    ).rejects.toThrow('authorized');
    expect(service.profileRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          employmentStatus: In([...EMPLOYED_STATUSES]),
        }),
      }),
    );

    service.profileRepository = profilesRepo([
      probationer(EmploymentStatus.TERMINATED),
    ]);
    await expect(
      service.getStoreShiftSlots('store-1', undefined, undefined, 'emp-1', 'acc-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('calendar access (aggregation and legacy) admits probation, refuses terminated', async () => {
    const aggregation = Object.create(ShiftAggregationService.prototype) as any;
    aggregation.storeRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
    };
    aggregation.employeeProfileRepo = profilesRepo([probationer()]);
    await expect(
      aggregation.assertEmployeeCalendarAccess('store-1', 'emp-1', 'acc-1'),
    ).resolves.toBeUndefined();
    aggregation.employeeProfileRepo = profilesRepo([
      probationer(EmploymentStatus.TERMINATED),
    ]);
    await expect(
      aggregation.assertEmployeeCalendarAccess('store-1', 'emp-1', 'acc-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const legacy = Object.create(StoresService.prototype) as any;
    legacy.storeRepository = aggregation.storeRepo;
    legacy.profileRepository = {
      findOne: jest.fn().mockResolvedValue(probationer()),
    };
    await expect(
      legacy.assertEmployeeCalendarAccess('emp-1', 'acc-1'),
    ).resolves.toBeTruthy();
    legacy.profileRepository.findOne.mockResolvedValue(
      probationer(EmploymentStatus.TERMINATED),
    );
    await expect(
      legacy.assertEmployeeCalendarAccess('emp-1', 'acc-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('POST shift-change-requests accepts a probation employee, not one on leave', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.profileRepository = profilesRepo([probationer()]);
    // Stop right after the employee check.
    service.resolveShiftChangeReferences = jest.fn(async () => {
      throw new Error('employee accepted');
    });
    const body = {
      storeId: 'store-1',
      employeeProfileId: 'emp-1',
      currentShiftId: 'slot-1',
      requestDate: '2030-01-01',
    };
    await expect(service.createShiftChangeRequest(body, 'acc-1')).rejects.toThrow(
      'employee accepted',
    );
    service.profileRepository = profilesRepo([
      probationer(EmploymentStatus.ON_LEAVE),
    ]);
    await expect(
      service.createShiftChangeRequest(body, 'acc-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('payroll generation covers active and probation staff (not on-leave)', async () => {
    const service = Object.create(StoresService.prototype) as any;
    const find = jest.fn().mockResolvedValue([]);
    const manager = { getRepository: jest.fn(() => ({ find })) };
    service.dataSource = { transaction: jest.fn(async (work: any) => work(manager)) };
    service.findOrCreateMonthlyPayroll = jest.fn().mockResolvedValue({ id: 'payroll-1' });
    service.getStandardWorkingDays = jest.fn().mockResolvedValue(26);
    service.refreshMonthlyPayrollTotals = jest.fn().mockResolvedValue({});
    service.logger = { log: jest.fn() };

    await service.createMonthlyPayrollForStore('store-1', '2030-01');

    expect(find).toHaveBeenCalledWith({
      where: {
        storeId: 'store-1',
        employmentStatus: In([...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]),
      },
      relations: ['contracts'],
    });
  });
});
