/**
 * "Cách tính giờ công": per-store / per-employee worked-time mode rules.
 * Check-out follows the rule in force on the shift's work date; adding or
 * removing a rule recomputes the completed shifts it covers, inside the month
 * lock, and never touches a month whose payslip is approved or paid.
 */
import {
  BadRequestException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';

import { CreateWorkedTimeRuleDto } from './dto/worked-time-rule.dto';
import { PaymentStatus } from './entities/employee-salary.entity';
import {
  AttendanceStatus,
  ShiftAssignment,
  ShiftAssignmentStatus,
} from './entities/shift-management.entity';
import { StoreTimekeepingSetting } from './entities/store-timekeeping-setting.entity';
import { StoreWorkedTimeRule } from './entities/store-worked-time-rule.entity';
import { StoresService } from './stores.service';

const STORE = 'store-1';
const OWNER = 'owner-1';
// Shift 05:00-10:00 VN on 2026-10-01.
const SLOT = {
  workDate: '2026-10-01',
  startTime: null,
  endTime: null,
  cycle: { storeId: STORE },
  workShift: { startTime: '05:00:00', endTime: '10:00:00' },
};
const vn = (clock: string, date = '2026-10-01') =>
  new Date(`${date}T${clock}:00+07:00`);

const rule = (over: Record<string, unknown> = {}) => ({
  id: 'rule-1',
  storeId: STORE,
  employeeProfileId: null,
  mode: 'ACTUAL',
  period: 'INDEFINITE',
  startDate: '2026-10-01',
  endDate: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

const completed = (over: Record<string, unknown> = {}) => ({
  id: 'as-1',
  employeeId: 'emp-a',
  status: ShiftAssignmentStatus.COMPLETED,
  checkInTime: vn('05:00'),
  checkOutTime: vn('12:00'),
  workedMinutes: 300,
  lateMinutes: 0,
  isAutoCheckout: false,
  autoCheckoutReason: null,
  scheduledCheckoutTime: null,
  shiftSlot: SLOT,
  ...over,
});

describe('check-out follows the worked-time rule', () => {
  afterEach(() => jest.useRealTimers());

  const buildCheckout = (rules: unknown[]) => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    service.activityLogService = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    service.shiftAssignmentRepository = {
      findOne: jest.fn().mockResolvedValue({
        ...completed(),
        status: ShiftAssignmentStatus.CONFIRMED,
        checkOutTime: null,
        attendanceStatus: AttendanceStatus.ON_TIME,
        employee: {
          id: 'emp-a',
          accountId: 'staff-1',
          employmentStatus: 'active',
        },
      }),
    };
    service.timekeepingSettingRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    service.shiftConfigRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    service.storeRepository = { findOne: jest.fn().mockResolvedValue(null) };
    service.employeeFaceRepository = {
      findOne: jest.fn().mockResolvedValue({ faceDescriptors: [[0.1]] }),
    };
    service.faceRecognitionService = {
      extractDescriptor: jest.fn().mockResolvedValue([0.1]),
      compareFaces: jest.fn().mockReturnValue({ matched: true, distance: 0.2 }),
    };
    service.bonusWorkRequestRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    service.workedTimeRuleRepository = {
      find: jest.fn().mockResolvedValue(rules),
    };
    const set = jest.fn().mockReturnThis();
    const builder: any = {
      update: jest.fn().mockReturnThis(),
      set,
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const manager = {
      create: jest.fn((_e: unknown, data: any) => ({ ...data })),
      save: jest.fn(async (_e: unknown, value: any) => value),
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(() => builder),
    };
    service.dataSource = {
      transaction: jest.fn(async (cb: any) => cb(manager)),
    };
    service.profileRepository = { update: jest.fn().mockResolvedValue({}) };
    service.appendToDailyReport = jest.fn();
    service.processCheckoutPayroll = jest.fn().mockResolvedValue(undefined);
    service.ownerNotificationService = {
      afterAttendance: jest.fn().mockResolvedValue(undefined),
    };
    return { service, written: () => set.mock.calls[0]?.[0] };
  };

  const checkOutAtNoon = async (rules: unknown[]) => {
    jest.useFakeTimers({
      now: vn('12:00'),
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    const { service, written } = buildCheckout(rules);
    await service.checkOutWithFace('as-1', Buffer.from('x'), 'staff-1');
    return written();
  };

  it('pays the 2 hours after the shift with "Làm bao nhiêu trả bấy nhiêu"', async () => {
    expect(await checkOutAtNoon([rule()])).toMatchObject({
      workedMinutes: 420,
    });
  });

  it('pays only the shift without a rule ("theo ca" by default)', async () => {
    expect(await checkOutAtNoon([])).toMatchObject({ workedMinutes: 300 });
  });

  it('lets the employee rule beat the store rule', async () => {
    const rules = [
      rule(),
      rule({ id: 'rule-2', employeeProfileId: 'emp-a', mode: 'SHIFT' }),
    ];
    expect(await checkOutAtNoon(rules)).toMatchObject({ workedMinutes: 300 });
  });

  it('counts "theo ca" when the rules cannot be read', async () => {
    jest.useFakeTimers({
      now: vn('12:00'),
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    const { service, written } = buildCheckout([]);
    service.workedTimeRuleRepository = {
      find: jest.fn().mockRejectedValue(new Error('no table')),
    };
    await service.checkOutWithFace('as-1', Buffer.from('x'), 'staff-1');
    expect(written()).toMatchObject({ workedMinutes: 300 });
  });
});

describe('recomputeWorkedTime', () => {
  const buildRecompute = (opts: {
    assignments: any[];
    rules?: unknown[];
    payslip?: Record<string, unknown> | null;
    affected?: number;
    failFor?: string;
  }) => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    const query: any = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(opts.assignments),
    };
    service.shiftAssignmentRepository = {
      createQueryBuilder: jest.fn(() => query),
    };
    const updates: any[] = [];
    const builder: any = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn((values: unknown) => {
        updates.push(values);
        return builder;
      }),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: opts.affected ?? 1 }),
    };
    // Rules and rows are re-read on the transaction.
    const manager = {
      createQueryBuilder: jest.fn(() => builder),
      getRepository: jest.fn((entity: unknown) => {
        if (entity === StoreWorkedTimeRule) {
          return { find: jest.fn().mockResolvedValue(opts.rules ?? [rule()]) };
        }
        if (entity === StoreTimekeepingSetting) {
          return { findOne: jest.fn().mockResolvedValue(null) };
        }
        if (entity === ShiftAssignment) {
          return {
            find: jest.fn(async ({ where }: any) => {
              const ids: string[] = where.id._value ?? where.id.value ?? [];
              return opts.assignments.filter((a) => ids.includes(a.id));
            }),
          };
        }
        return { find: jest.fn().mockResolvedValue([]) };
      }),
    };
    service.dataSource = {
      transaction: jest.fn(async (cb: any) => {
        return cb(manager);
      }),
    };
    service.findOrCreateMonthlyPayroll = jest.fn(
      async (_s: string, month: any) => {
        if (opts.failFor && month.label.includes(opts.failFor))
          throw new Error('lock timeout');
        return { id: 'payroll-1' };
      },
    );
    service.lockEmployeePayslip = jest
      .fn()
      .mockResolvedValue(opts.payslip ?? null);
    service.processCheckoutPayroll = jest.fn().mockResolvedValue(undefined);
    return { service, updates, manager, query };
  };

  it('re-prices shifts the new rule covers, then each touched date and the payslip', async () => {
    const { service, updates, manager } = buildRecompute({
      assignments: [
        completed(),
        completed({
          id: 'as-2',
          shiftSlot: { ...SLOT, workDate: '2026-10-02' },
          checkInTime: vn('05:00', '2026-10-02'),
          checkOutTime: vn('11:00', '2026-10-02'),
        }),
      ],
    });

    const result = await service.recomputeWorkedTime(STORE, {
      from: '2026-10-01',
      to: null,
    });

    expect(result).toEqual({
      updatedShifts: 2,
      skippedLockedShifts: 0,
      failedShifts: 0,
    });
    expect(updates).toEqual([{ workedMinutes: 420 }, { workedMinutes: 360 }]);
    // One transaction for the employee-month, holding the month lock.
    expect(service.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(service.findOrCreateMonthlyPayroll).toHaveBeenCalledWith(
      STORE,
      expect.objectContaining({ label: expect.stringContaining('2026') }),
      manager,
    );
    expect(service.processCheckoutPayroll).toHaveBeenCalledWith('as-1', {
      manager,
    });
    expect(service.processCheckoutPayroll).toHaveBeenCalledWith('as-2', {
      manager,
    });
    // The monthly summary is refreshed after commit, outside the lock.
    expect(service.processCheckoutPayroll).toHaveBeenLastCalledWith('as-2');
  });

  it('leaves a month with an approved or paid payslip untouched, even soft-deleted', async () => {
    for (const payslip of [
      { id: 'slip-1', paymentStatus: PaymentStatus.APPROVED, deletedAt: null },
      {
        id: 'slip-1',
        paymentStatus: PaymentStatus.PAID,
        deletedAt: new Date(),
      },
    ]) {
      const { service, updates } = buildRecompute({
        assignments: [completed()],
        payslip,
      });

      const result = await service.recomputeWorkedTime(STORE, {
        from: '2026-10-01',
        to: null,
      });

      expect(result).toEqual({
        updatedShifts: 0,
        skippedLockedShifts: 1,
        failedShifts: 0,
      });
      expect(updates).toHaveLength(0);
      expect(service.processCheckoutPayroll).not.toHaveBeenCalled();
    }
  });

  it('does nothing for shifts already priced with the rules in force (idempotent)', async () => {
    const { service, updates } = buildRecompute({
      assignments: [completed({ workedMinutes: 420 })],
    });

    const result = await service.recomputeWorkedTime(STORE, {
      from: '2026-10-01',
      to: null,
    });

    expect(result).toEqual({
      updatedShifts: 0,
      skippedLockedShifts: 0,
      failedShifts: 0,
    });
    expect(updates).toHaveLength(0);
    expect(service.processCheckoutPayroll).not.toHaveBeenCalled();
  });

  it('uses the rules read under the lock (a newer rule saved meanwhile wins)', async () => {
    const { service, updates } = buildRecompute({
      assignments: [completed({ workedMinutes: 420 })],
      rules: [
        rule(),
        rule({
          id: 'rule-2',
          mode: 'SHIFT',
          createdAt: new Date('2026-10-02'),
        }),
      ],
    });

    await service.recomputeWorkedTime(STORE, { from: '2026-10-01', to: null });

    expect(updates).toEqual([{ workedMinutes: 300 }]);
  });

  it('prices a forgotten check-out to the shift end, not to when the job ran', async () => {
    const { service, updates } = buildRecompute({
      assignments: [
        completed({
          checkInTime: vn('04:50'),
          checkOutTime: vn('10:20'),
          isAutoCheckout: true,
          scheduledCheckoutTime: null,
          workedMinutes: 300,
        }),
      ],
    });

    await service.recomputeWorkedTime(STORE, { from: '2026-10-01', to: null });

    // Early arrival counts in ACTUAL; the end stops at 10:00.
    expect(updates).toEqual([{ workedMinutes: 310 }]);
  });

  it('skips a shift changed meanwhile (guarded update)', async () => {
    const { service } = buildRecompute({
      assignments: [completed()],
      affected: 0,
    });

    const result = await service.recomputeWorkedTime(STORE, {
      from: '2026-10-01',
      to: null,
    });

    expect(result.updatedShifts).toBe(0);
    expect(service.processCheckoutPayroll).not.toHaveBeenCalled();
  });

  it('counts a failing month and still does the others', async () => {
    const { service } = buildRecompute({
      assignments: [
        completed(),
        completed({
          id: 'as-nov',
          shiftSlot: { ...SLOT, workDate: '2026-11-03' },
          checkInTime: vn('05:00', '2026-11-03'),
          checkOutTime: vn('12:00', '2026-11-03'),
        }),
      ],
      failFor: '11',
    });

    const result = await service.recomputeWorkedTime(STORE, {
      from: '2026-10-01',
      to: null,
    });

    expect(result).toEqual({
      updatedShifts: 1,
      skippedLockedShifts: 0,
      failedShifts: 1,
    });
  });

  it('limits the scan to the rule range and employees', async () => {
    const { service, query } = buildRecompute({ assignments: [] });

    await service.recomputeWorkedTime(STORE, {
      from: '2026-10-01',
      to: '2026-10-07',
      employeeProfileIds: ['emp-a', 'emp-b'],
    });

    expect(query.andWhere).toHaveBeenCalledWith('slot.workDate <= :to', {
      to: '2026-10-07',
    });
    expect(query.andWhere).toHaveBeenCalledWith(
      'a.employeeId IN (:...employeeIds)',
      { employeeIds: ['emp-a', 'emp-b'] },
    );
  });

  it('scans every employee for a store-wide range', async () => {
    const { service, query } = buildRecompute({ assignments: [] });

    await service.recomputeWorkedTime(STORE, {
      from: '2026-10-01',
      to: null,
      employeeProfileIds: null,
    });

    const clauses = query.andWhere.mock.calls.map((call: unknown[]) => call[0]);
    expect(clauses.some((c: string) => c.includes('employeeId'))).toBe(false);
  });
});

describe('worked-time rule CRUD', () => {
  const buildCrud = () => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue(undefined);
    service.profileRepository = {
      // Every asked employee belongs to the store unless a test says otherwise.
      find: jest.fn(async ({ where }: any) =>
        (where.id._value as string[]).map((id) => ({ id })),
      ),
    };
    service.workedTimeRuleRepository = {
      create: jest.fn((value: unknown) => value),
      save: jest.fn(async (values: any[]) =>
        values.map((value, index) => ({ id: `rule-${index + 9}`, ...value })),
      ),
      findOne: jest
        .fn()
        .mockResolvedValue(rule({ period: 'WEEK', endDate: '2026-10-07' })),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
    };
    service.recomputeWorkedTime = jest
      .fn()
      .mockResolvedValue({ updatedShifts: 3, skippedLockedShifts: 1 });
    return service;
  };

  it('saves one row per chosen employee in one group, then recomputes them', async () => {
    const service = buildCrud();

    const result = await service.createWorkedTimeRule(
      STORE,
      {
        mode: 'ACTUAL',
        period: 'WEEK',
        startDate: '2026-10-01',
        employeeProfileIds: ['emp-a', 'emp-b', 'emp-a'],
      },
      OWNER,
    );

    expect(service.assertOwnerStoreAccess).toHaveBeenCalledWith(STORE, OWNER);
    const [saved] = service.workedTimeRuleRepository.save.mock.calls[0];
    expect(saved).toHaveLength(2);
    expect(saved.map((r: any) => r.employeeProfileId)).toEqual([
      'emp-a',
      'emp-b',
    ]);
    expect(saved[0].groupId).toBeTruthy();
    expect(saved[1].groupId).toBe(saved[0].groupId);
    expect(saved[0]).toEqual(
      expect.objectContaining({
        storeId: STORE,
        mode: 'ACTUAL',
        startDate: '2026-10-01',
        endDate: '2026-10-07',
        createdByAccountId: OWNER,
      }),
    );
    expect(service.recomputeWorkedTime).toHaveBeenCalledWith(STORE, {
      from: '2026-10-01',
      to: '2026-10-07',
      employeeProfileIds: ['emp-a', 'emp-b'],
    });
    expect(result.rules).toHaveLength(2);
    expect(result.rule).toBe(result.rules[0]);
    expect(result.recompute).toEqual({
      updatedShifts: 3,
      skippedLockedShifts: 1,
    });
  });

  it('still takes a single employeeProfileId', async () => {
    const service = buildCrud();

    await service.createWorkedTimeRule(
      STORE,
      {
        mode: 'ACTUAL',
        period: 'DAY',
        startDate: '2026-10-01',
        employeeProfileId: 'emp-a',
      },
      OWNER,
    );

    const [saved] = service.workedTimeRuleRepository.save.mock.calls[0];
    expect(saved.map((r: any) => r.employeeProfileId)).toEqual(['emp-a']);
    expect(service.recomputeWorkedTime).toHaveBeenCalledWith(
      STORE,
      expect.objectContaining({ employeeProfileIds: ['emp-a'] }),
    );
  });

  it('saves one store-wide row without employees', async () => {
    const service = buildCrud();

    await service.createWorkedTimeRule(
      STORE,
      { mode: 'SHIFT', period: 'INDEFINITE', startDate: '2026-10-01' },
      OWNER,
    );

    const [saved] = service.workedTimeRuleRepository.save.mock.calls[0];
    expect(saved).toHaveLength(1);
    expect(saved[0].employeeProfileId).toBeNull();
    expect(service.profileRepository.find).not.toHaveBeenCalled();
    expect(service.recomputeWorkedTime).toHaveBeenCalledWith(STORE, {
      from: '2026-10-01',
      to: null,
      employeeProfileIds: null,
    });
  });

  it('refuses the whole list when one employee is of another store', async () => {
    const service = buildCrud();
    service.profileRepository.find.mockResolvedValue([{ id: 'emp-a' }]);

    await expect(
      service.createWorkedTimeRule(
        STORE,
        {
          mode: 'ACTUAL',
          period: 'DAY',
          startDate: '2026-10-01',
          employeeProfileIds: ['emp-a', 'emp-x'],
        },
        OWNER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.workedTimeRuleRepository.save).not.toHaveBeenCalled();
  });

  it('removes a store-wide rule and recomputes the shifts it covered', async () => {
    const service = buildCrud();

    const result = await service.deleteWorkedTimeRule(STORE, 'rule-1', OWNER);

    expect(service.workedTimeRuleRepository.softDelete).toHaveBeenCalledWith({
      id: expect.objectContaining({ _value: ['rule-1'] }),
      storeId: STORE,
    });
    expect(service.recomputeWorkedTime).toHaveBeenCalledWith(STORE, {
      from: '2026-10-01',
      to: '2026-10-07',
      employeeProfileIds: null,
    });
    expect(result.deletedIds).toEqual(['rule-1']);
  });

  it('removes every row of a several-employee rule together', async () => {
    const service = buildCrud();
    const group = [
      rule({
        id: 'rule-1',
        groupId: 'g-1',
        employeeProfileId: 'emp-a',
        endDate: '2026-10-07',
      }),
      rule({
        id: 'rule-2',
        groupId: 'g-1',
        employeeProfileId: 'emp-b',
        endDate: '2026-10-07',
      }),
    ];
    service.workedTimeRuleRepository.findOne.mockResolvedValue(group[0]);
    service.workedTimeRuleRepository.find.mockResolvedValue(group);

    const result = await service.deleteWorkedTimeRule(STORE, 'rule-1', OWNER);

    expect(service.workedTimeRuleRepository.find).toHaveBeenCalledWith({
      where: { storeId: STORE, groupId: 'g-1' },
      withDeleted: false,
    });
    expect(service.workedTimeRuleRepository.softDelete).toHaveBeenCalledWith({
      id: expect.objectContaining({ _value: ['rule-1', 'rule-2'] }),
      storeId: STORE,
    });
    expect(service.recomputeWorkedTime).toHaveBeenCalledWith(STORE, {
      from: '2026-10-01',
      to: '2026-10-07',
      employeeProfileIds: ['emp-a', 'emp-b'],
    });
    expect(result.deletedIds).toEqual(['rule-1', 'rule-2']);
  });

  it('refuses a date that does not exist', async () => {
    const service = buildCrud();

    await expect(
      service.createWorkedTimeRule(
        STORE,
        { mode: 'ACTUAL', period: 'DAY', startDate: '2026-02-30' },
        OWNER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.workedTimeRuleRepository.save).not.toHaveBeenCalled();
  });

  it('re-runs the recompute of a rule group, also a removed one', async () => {
    const service = buildCrud();
    const group = [
      rule({
        id: 'rule-1',
        groupId: 'g-1',
        employeeProfileId: 'emp-a',
        endDate: '2026-10-07',
      }),
      rule({
        id: 'rule-2',
        groupId: 'g-1',
        employeeProfileId: 'emp-b',
        endDate: '2026-10-07',
      }),
    ];
    service.workedTimeRuleRepository.findOne.mockResolvedValue(group[0]);
    service.workedTimeRuleRepository.find.mockResolvedValue(group);

    await service.recomputeWorkedTimeRule(STORE, 'rule-1', OWNER);

    expect(service.workedTimeRuleRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'rule-1', storeId: STORE },
      withDeleted: true,
    });
    expect(service.workedTimeRuleRepository.find).toHaveBeenCalledWith({
      where: { storeId: STORE, groupId: 'g-1' },
      withDeleted: true,
    });
    expect(service.recomputeWorkedTime).toHaveBeenCalledWith(STORE, {
      from: '2026-10-01',
      to: '2026-10-07',
      employeeProfileIds: ['emp-a', 'emp-b'],
    });
  });

  it('404s a rule of another store', async () => {
    const service = buildCrud();
    service.workedTimeRuleRepository.findOne.mockResolvedValue(null);

    await expect(
      service.deleteWorkedTimeRule(STORE, 'nope', OWNER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CreateWorkedTimeRuleDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const validate = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: CreateWorkedTimeRuleDto });

  it('accepts a store-wide or per-employee rule', async () => {
    await expect(
      validate({
        mode: 'SHIFT',
        period: 'INDEFINITE',
        startDate: '2026-10-01',
      }),
    ).resolves.toBeTruthy();
    await expect(
      validate({
        mode: 'ACTUAL',
        period: 'MONTH',
        startDate: '2026-10-01',
        employeeProfileId: '11111111-1111-4111-8111-111111111111',
      }),
    ).resolves.toBeTruthy();
    await expect(
      validate({
        mode: 'ACTUAL',
        period: 'MONTH',
        startDate: '2026-10-01',
        employeeProfileIds: [
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
      }),
    ).resolves.toBeTruthy();
  });

  it('rejects an empty or malformed employee list', async () => {
    await expect(
      validate({
        mode: 'ACTUAL',
        period: 'DAY',
        startDate: '2026-10-01',
        employeeProfileIds: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validate({
        mode: 'ACTUAL',
        period: 'DAY',
        startDate: '2026-10-01',
        employeeProfileIds: ['not-a-uuid'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown modes, periods and dates', async () => {
    await expect(
      validate({ mode: 'HOURLY', period: 'DAY', startDate: '2026-10-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validate({ mode: 'SHIFT', period: 'YEAR', startDate: '2026-10-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validate({ mode: 'SHIFT', period: 'DAY', startDate: '01/10/2026' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
