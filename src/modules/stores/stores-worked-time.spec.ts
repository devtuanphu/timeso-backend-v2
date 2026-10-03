/**
 * "Cách tính giờ công": per-store / per-employee worked-time mode rules.
 * Check-out follows the rule covering the shift's scheduled start (a removed
 * rule still covers the shifts started before its removal), else the default;
 * saving or removing a rule only affects shifts not started yet, and never
 * recomputes anything.
 */
import {
  BadRequestException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';

import { CreateWorkedTimeRuleDto } from './dto/worked-time-rule.dto';
import {
  AttendanceStatus,
  ShiftAssignmentStatus,
} from './entities/shift-management.entity';
import { StoresService } from './stores.service';

const STORE = 'store-1';
const OWNER = 'owner-1';
// Shift 05:00-10:00 VN; 2026-10-01 is before the default switch
// (ACTUAL_DEFAULT_FROM), 2026-10-05 after it.
const slotOn = (workDate: string) => ({
  workDate,
  startTime: null,
  endTime: null,
  cycle: { storeId: STORE },
  workShift: { startTime: '05:00:00', endTime: '10:00:00' },
});
const vn = (clock: string, date = '2026-10-01') =>
  new Date(`${date}T${clock}:00+07:00`);

const rule = (over: Record<string, unknown> = {}) => ({
  id: 'rule-1',
  storeId: STORE,
  employeeProfileId: null,
  groupId: null,
  mode: 'ACTUAL',
  period: 'INDEFINITE',
  startDate: '2026-10-01',
  startTime: '00:00',
  endDate: null,
  endTime: null,
  deletedAt: null,
  createdAt: new Date('2026-09-30T00:00:00Z'),
  ...over,
});

describe('check-out follows the worked-time rule', () => {
  afterEach(() => jest.useRealTimers());

  const buildCheckout = (rules: unknown[], workDate: string) => {
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
        id: 'as-1',
        employeeId: 'emp-a',
        status: ShiftAssignmentStatus.CONFIRMED,
        checkInTime: vn('05:00', workDate),
        checkOutTime: null,
        lateMinutes: 0,
        attendanceStatus: AttendanceStatus.ON_TIME,
        shiftSlot: slotOn(workDate),
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

  /** Checks in 05:00, out 12:00 (2h after the 10:00 end); worked minutes. */
  const checkOutAtNoon = async (
    rules: unknown[],
    workDate = '2026-10-01',
    tweak?: (service: any) => void,
  ) => {
    jest.useFakeTimers({
      now: vn('12:00', workDate),
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    const { service, written } = buildCheckout(rules, workDate);
    tweak?.(service);
    await service.checkOutWithFace('as-1', Buffer.from('x'), 'staff-1');
    return { minutes: written()?.workedMinutes, service };
  };

  it('pays check-in to check-out with "Tính theo giờ chấm công"', async () => {
    expect((await checkOutAtNoon([rule()])).minutes).toBe(420);
  });

  it('pays only the schedule with "Tính theo lịch làm"', async () => {
    expect((await checkOutAtNoon([rule({ mode: 'SHIFT' })])).minutes).toBe(300);
  });

  it('without a rule: "theo lịch làm" before the release, "theo giờ chấm công" after', async () => {
    expect((await checkOutAtNoon([], '2026-10-01')).minutes).toBe(300);
    expect((await checkOutAtNoon([], '2026-10-05')).minutes).toBe(420);
  });

  it('lets the employee rule beat the store rule', async () => {
    const rules = [
      rule(),
      rule({ id: 'rule-2', employeeProfileId: 'emp-a', mode: 'SHIFT' }),
    ];
    expect((await checkOutAtNoon(rules)).minutes).toBe(300);
  });

  it('decides by the shift start: a rule from 14:00 leaves the 05:00 shift alone', async () => {
    const afternoon = rule({
      mode: 'SHIFT',
      startDate: '2026-10-05',
      startTime: '14:00',
    });
    expect((await checkOutAtNoon([afternoon], '2026-10-05')).minutes).toBe(420);
    const early = rule({
      mode: 'SHIFT',
      startDate: '2026-10-05',
      startTime: '05:00',
    });
    expect((await checkOutAtNoon([early], '2026-10-05')).minutes).toBe(300);
  });

  it('keeps a rule removed during the shift for that shift, reading removed rules', async () => {
    // "Theo lịch làm" removed at 06:00, after the 05:00 shift started.
    const removed = rule({
      mode: 'SHIFT',
      startDate: '2026-10-05',
      deletedAt: vn('06:00', '2026-10-05'),
    });
    const { minutes, service } = await checkOutAtNoon([removed], '2026-10-05');
    expect(minutes).toBe(300);
    expect(service.workedTimeRuleRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: STORE }, withDeleted: true }),
    );
  });

  it('stops a removed rule for the shifts starting after its removal', async () => {
    // "Theo lịch làm" removed at 04:00, before the 05:00 shift started.
    const removed = rule({
      mode: 'SHIFT',
      startDate: '2026-10-05',
      deletedAt: vn('04:00', '2026-10-05'),
    });
    expect((await checkOutAtNoon([removed], '2026-10-05')).minutes).toBe(420);
  });

  it('uses the default when the rules cannot be read', async () => {
    const unreadable = (service: any) => {
      service.workedTimeRuleRepository = {
        find: jest.fn().mockRejectedValue(new Error('no table')),
      };
    };
    expect((await checkOutAtNoon([], '2026-10-01', unreadable)).minutes).toBe(
      300,
    );
    expect((await checkOutAtNoon([], '2026-10-05', unreadable)).minutes).toBe(
      420,
    );
  });
});

describe('overtime repricing follows the rule of the shift start', () => {
  // A completed 05:00-10:00 shift on 2026-10-05, checked out at 12:00.
  const buildReprice = (rules: unknown[]) => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service.shiftAssignmentRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'as-1',
        employeeId: 'emp-a',
        status: ShiftAssignmentStatus.COMPLETED,
        checkInTime: vn('05:00', '2026-10-05'),
        checkOutTime: vn('12:00', '2026-10-05'),
        workedMinutes: 0,
        lateMinutes: 0,
        isAutoCheckout: false,
        shiftSlot: slotOn('2026-10-05'),
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    service.timekeepingSettingRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    service.bonusWorkRequestRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    service.workedTimeRuleRepository = {
      find: jest.fn().mockResolvedValue(rules),
    };
    service.processCheckoutPayroll = jest.fn().mockResolvedValue(undefined);
    return service;
  };
  const reprice = async (rules: unknown[]) => {
    const service = buildReprice(rules);
    await service.repriceCheckedOutOvertime({ shiftAssignmentId: 'as-1' });
    return service.shiftAssignmentRepository.update.mock.calls[0]?.[1]
      ?.workedMinutes;
  };

  it('ignores a rule starting later that day (14:00) for the 05:00 shift', async () => {
    const afternoon = rule({
      mode: 'SHIFT',
      startDate: '2026-10-05',
      startTime: '14:00',
    });
    expect(await reprice([afternoon])).toBe(420);
  });

  it('applies a rule covering the shift start', async () => {
    const morning = rule({
      mode: 'SHIFT',
      startDate: '2026-10-05',
      startTime: '05:00',
    });
    expect(await reprice([morning])).toBe(300);
  });
});

describe('worked-time rule CRUD', () => {
  // Now: 2026-10-05 10:00:20 Vietnam time.
  const NOW = new Date('2026-10-05T03:00:20Z');

  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
  });
  afterEach(() => jest.useRealTimers());

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
      findOne: jest.fn().mockResolvedValue(rule()),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
    };
    // Nothing worked is ever recomputed.
    service.recomputeWorkedTime = jest.fn();
    service.processCheckoutPayroll = jest.fn();
    return service;
  };

  const create = (service: any, body: Record<string, unknown>) =>
    service.createWorkedTimeRule(
      STORE,
      { mode: 'SHIFT', period: 'DAY', startDate: '2026-10-05', ...body },
      OWNER,
    );
  const saved = (service: any) =>
    service.workedTimeRuleRepository.save.mock.calls[0][0];

  it('saves the start date and time and the round end, without recomputing', async () => {
    const service = buildCrud();

    const result = await create(service, { startTime: '14:00' });

    expect(service.assertOwnerStoreAccess).toHaveBeenCalledWith(STORE, OWNER);
    expect(saved(service)).toEqual([
      expect.objectContaining({
        storeId: STORE,
        employeeProfileId: null,
        mode: 'SHIFT',
        period: 'DAY',
        startDate: '2026-10-05',
        startTime: '14:00',
        endDate: '2026-10-06',
        endTime: '14:00',
        createdByAccountId: OWNER,
      }),
    ]);
    expect(result.rules).toHaveLength(1);
    expect(result.rule).toBe(result.rules[0]);
    expect(result).not.toHaveProperty('recompute');
    expect(service.recomputeWorkedTime).not.toHaveBeenCalled();
    expect(service.processCheckoutPayroll).not.toHaveBeenCalled();
  });

  it('saves one row per chosen employee in one group', async () => {
    const service = buildCrud();

    await create(service, {
      startTime: '14:00',
      period: 'INDEFINITE',
      employeeProfileIds: ['emp-a', 'emp-b', 'emp-a'],
    });

    const rows = saved(service);
    expect(rows.map((r: any) => r.employeeProfileId)).toEqual([
      'emp-a',
      'emp-b',
    ]);
    expect(rows[0].groupId).toBeTruthy();
    expect(rows[1].groupId).toBe(rows[0].groupId);
    expect(rows[0]).toEqual(
      expect.objectContaining({ endDate: null, endTime: null }),
    );
  });

  it('refuses a start more than 15 minutes ago', async () => {
    const service = buildCrud();

    await expect(create(service, { startTime: '09:45' })).rejects.toMatchObject(
      {
        response: expect.objectContaining({
          code: 'WORKED_TIME_RULE_START_IN_PAST',
        }),
      },
    );
    await expect(
      create(service, { startDate: '2026-10-04', startTime: '23:00' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.workedTimeRuleRepository.save).not.toHaveBeenCalled();
  });

  it('starts from now (next minute) for a start picked moments ago', async () => {
    const service = buildCrud();

    // 15 minutes before 10:01 (now rounded up) is still accepted.
    await create(service, { startTime: '09:46', period: 'WEEK' });

    expect(saved(service)[0]).toEqual(
      expect.objectContaining({
        startDate: '2026-10-05',
        startTime: '10:01',
        endDate: '2026-10-12',
        endTime: '10:01',
      }),
    );
  });

  it('takes a date without time from older apps: today from now, later days from 00:00', async () => {
    const today = buildCrud();
    await create(today, {});
    expect(saved(today)[0]).toEqual(
      expect.objectContaining({ startTime: '10:01' }),
    );

    const later = buildCrud();
    await create(later, { startDate: '2026-10-07' });
    expect(saved(later)[0]).toEqual(
      expect.objectContaining({ startDate: '2026-10-07', startTime: '00:00' }),
    );

    const past = buildCrud();
    await expect(
      create(past, { startDate: '2026-10-04' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses the whole list when one employee is of another store', async () => {
    const service = buildCrud();
    service.profileRepository.find.mockResolvedValue([{ id: 'emp-a' }]);

    await expect(
      create(service, {
        startTime: '14:00',
        employeeProfileIds: ['emp-a', 'emp-x'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.workedTimeRuleRepository.save).not.toHaveBeenCalled();
  });

  it('refuses a date that does not exist', async () => {
    const service = buildCrud();

    await expect(
      create(service, { startDate: '2026-02-30' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.workedTimeRuleRepository.save).not.toHaveBeenCalled();
  });

  it('removes a rule without recomputing (shifts started before stay as they are)', async () => {
    const service = buildCrud();

    const result = await service.deleteWorkedTimeRule(STORE, 'rule-1', OWNER);

    expect(service.workedTimeRuleRepository.update).toHaveBeenCalledWith(
      { id: expect.objectContaining({ _value: ['rule-1'] }), storeId: STORE },
      { deletedAt: NOW },
    );
    expect(result).toEqual({
      id: 'rule-1',
      deletedIds: ['rule-1'],
      deleted: true,
    });
    expect(service.recomputeWorkedTime).not.toHaveBeenCalled();
    expect(service.processCheckoutPayroll).not.toHaveBeenCalled();
  });

  it('removes every row of a several-employee rule together', async () => {
    const service = buildCrud();
    const group = [
      rule({ id: 'rule-1', groupId: 'g-1', employeeProfileId: 'emp-a' }),
      rule({ id: 'rule-2', groupId: 'g-1', employeeProfileId: 'emp-b' }),
    ];
    service.workedTimeRuleRepository.findOne.mockResolvedValue(group[0]);
    service.workedTimeRuleRepository.find.mockResolvedValue(group);

    const result = await service.deleteWorkedTimeRule(STORE, 'rule-1', OWNER);

    expect(service.workedTimeRuleRepository.find).toHaveBeenCalledWith({
      where: { storeId: STORE, groupId: 'g-1' },
    });
    expect(result.deletedIds).toEqual(['rule-1', 'rule-2']);
  });

  it('404s a rule of another store', async () => {
    const service = buildCrud();
    service.workedTimeRuleRepository.findOne.mockResolvedValue(null);

    await expect(
      service.deleteWorkedTimeRule(STORE, 'nope', OWNER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists the rules in force, newest first, without removed ones', async () => {
    const service = buildCrud();

    await service.listWorkedTimeRules(STORE, OWNER);

    expect(service.workedTimeRuleRepository.find).toHaveBeenCalledWith({
      where: { storeId: STORE },
      order: { createdAt: 'DESC' },
    });
  });

  it('lists none when the rules cannot be read', async () => {
    const service = buildCrud();
    service.workedTimeRuleRepository.find.mockRejectedValue(
      new Error('no table'),
    );

    await expect(service.listWorkedTimeRules(STORE, OWNER)).resolves.toEqual(
      [],
    );
  });

  it('takes "today" from an older app at 23:59:30 as 00:00 the next day', async () => {
    jest.setSystemTime(new Date('2026-10-05T16:59:30Z'));
    const service = buildCrud();

    await create(service, { startDate: '2026-10-05' });

    expect(saved(service)[0]).toEqual(
      expect.objectContaining({ startDate: '2026-10-06', startTime: '00:00' }),
    );
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

  it('accepts a start time and refuses a malformed one', async () => {
    const base = { mode: 'SHIFT', period: 'DAY', startDate: '2026-10-01' };
    await expect(
      validate({ ...base, startTime: '14:05' }),
    ).resolves.toBeTruthy();
    await expect(
      validate({ ...base, startTime: '25:00' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validate({ ...base, startTime: '9:00' }),
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
