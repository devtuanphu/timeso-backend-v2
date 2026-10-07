import { StoresService } from '../../../../src/modules/stores/stores.service';
import {
  GENERATED_SLOT_ANNOUNCE_WINDOW_DAYS,
  selectGeneratedSlotAnnouncements,
} from '../../../../src/modules/stores/shift-assignment-notification';
import {
  CycleType,
  ShiftAssignmentStatus,
  ShiftSlot,
  WorkCycle,
  WorkCycleStatus,
} from '../../../../src/modules/stores/entities/shift-management.entity';
import {
  ShiftRecurrenceEndType,
  ShiftRecurrenceFrequency,
} from '../../../../src/modules/stores/shift-schedule.types';

/**
 * Days the nightly jobs generate are announced "Có ca mới để đăng ký" like
 * days created with a schedule: only slots this run created, with a free
 * seat, not started (VN time) and within the next 7 VN days (far horizon
 * days were announced at schedule creation), one aggregated notice per
 * account per store, never breaking generation.
 */
// 2026-09-22 00:25 in Vietnam (2026-09-21 17:25 UTC).
const NOW = new Date('2026-09-21T17:25:00Z');
// Today (VN) + 89 days: the unified schedule horizon.
const HORIZON = '2026-12-20';

describe('selectGeneratedSlotAnnouncements', () => {
  const now = new Date('2026-09-22T03:00:00Z'); // 10:00 VN
  const slot = (over: Record<string, unknown> = {}) => ({
    storeId: 'store-1',
    workDate: '2026-09-23',
    startTime: '08:00',
    endTime: '12:00',
    maxStaff: 2,
    shiftName: 'Ca sáng',
    holderProfileIds: ['p1'],
    ...over,
  });

  it('keeps free, not-started slots grouped by store', () => {
    const byStore = selectGeneratedSlotAnnouncements(
      [
        slot(),
        slot({ workDate: '2026-09-24' }),
        slot({ storeId: 'store-2', holderProfileIds: [] }),
        // full
        slot({ holderProfileIds: ['p1', 'p2'] }),
        // started today 08:00 VN
        slot({ workDate: '2026-09-22' }),
        // no store
        slot({ storeId: '' }),
      ],
      now,
    );
    expect([...byStore.keys()]).toEqual(['store-1', 'store-2']);
    expect(byStore.get('store-1')).toEqual([
      expect.objectContaining({
        workDate: '2026-09-23',
        assignedProfileIds: ['p1'],
      }),
      expect.objectContaining({
        workDate: '2026-09-24',
        assignedProfileIds: ['p1'],
      }),
    ]);
    expect(byStore.get('store-2')).toHaveLength(1);
  });

  it('announces only VN today .. today+6; day 7 and the far horizon are not', () => {
    expect(GENERATED_SLOT_ANNOUNCE_WINDOW_DAYS).toBe(7);
    const byStore = selectGeneratedSlotAnnouncements(
      [
        slot({ workDate: '2026-09-22', startTime: '18:00' }), // today, later
        slot({ workDate: '2026-09-28' }), // today + 6: last day in window
        slot({ workDate: '2026-09-29' }), // today + 7: excluded
        slot({ workDate: '2026-12-20' }), // horizon (+89): excluded
      ],
      now,
    );
    expect(byStore.get('store-1')?.map((s) => s.workDate)).toEqual([
      '2026-09-22',
      '2026-09-28',
    ]);
  });

  it('uses the VN calendar day just after VN midnight (still yesterday in UTC)', () => {
    const justAfterMidnight = new Date('2026-09-21T17:10:00Z'); // 00:10 VN on 22/09
    const byStore = selectGeneratedSlotAnnouncements(
      [slot({ workDate: '2026-09-28' }), slot({ workDate: '2026-09-29' })],
      justAfterMidnight,
    );
    expect(byStore.get('store-1')?.map((s) => s.workDate)).toEqual([
      '2026-09-28',
    ]);
  });

  it('0/null seats are unlimited, so always open', () => {
    const byStore = selectGeneratedSlotAnnouncements(
      [
        slot({ maxStaff: 0, holderProfileIds: ['p1', 'p2', 'p3'] }),
        slot({ maxStaff: null }),
      ],
      now,
    );
    expect(byStore.get('store-1')).toHaveLength(2);
  });
});

describe('generateDailySlotsForIndefiniteCycles — horizon days are not announced', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  const rule = {
    enabled: true,
    frequency: ShiftRecurrenceFrequency.DAILY,
    interval: 1,
    endType: ShiftRecurrenceEndType.NEVER,
  };
  const cycle = (id: string, storeId: string, workShiftId: string) => ({
    id,
    storeId,
    cycleType: CycleType.INDEFINITE,
    status: WorkCycleStatus.ACTIVE,
    startDate: '2026-09-01',
    recurrenceRule: rule,
    workShiftId,
  });
  const shifts: Record<string, any> = {
    'ws-a': {
      id: 'ws-a',
      shiftName: 'Ca sáng',
      startTime: '08:00:00',
      endTime: '12:00:00',
      defaultMaxStaff: 1,
    },
    'ws-b': {
      id: 'ws-b',
      shiftName: 'Ca tối',
      startTime: '18:00:00',
      endTime: '22:00:00',
      defaultMaxStaff: 2,
    },
    'ws-c': {
      id: 'ws-c',
      shiftName: 'Ca chiều',
      startTime: '13:00:00',
      endTime: '17:00:00',
      defaultMaxStaff: 1,
    },
  };

  const build = (
    cycles: any[],
    existing: Set<string> = new Set(),
    employees: any[] = [],
  ) => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = {
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    };
    service.workCycleRepository = { find: jest.fn().mockResolvedValue(cycles) };
    const saved: any[] = [];
    service.shiftSlotRepository = {
      find: jest.fn(async ({ where }: any) =>
        where.workDate
          ? []
          : [
              {
                workShiftId: cycles.find((c) => c.id === where.cycleId)
                  ?.workShiftId,
              },
            ],
      ),
      findOne: jest.fn(async ({ where }: any) =>
        existing.has(`${where.cycleId}:${where.workShiftId}`)
          ? { id: 'old' }
          : null,
      ),
      create: jest.fn((value: any) => value),
      save: jest.fn(async (value: any) => {
        saved.push(value);
        return value;
      }),
    };
    service.workShiftRepository = {
      findOne: jest.fn(async ({ where }: any) => shifts[where.id] ?? null),
    };
    service.profileRepository = {
      find: jest.fn().mockResolvedValue(employees),
    };
    service.notificationsService = { create: jest.fn().mockResolvedValue({}) };
    return { service, saved };
  };

  it('a failing legacy cycle still announces the slots committed before it, then rethrows', async () => {
    const legacy = (id: string) => ({
      id,
      storeId: 'store-1',
      cycleType: CycleType.INDEFINITE,
      status: WorkCycleStatus.ACTIVE,
      startDate: '2026-09-01',
      recurrenceRule: null,
      workShiftId: null,
    });
    const { service } = build([legacy('L1'), legacy('L2')], new Set(), [
      { id: 'p1', accountId: 'acc-1', reminderSettings: null },
    ]);
    service.generateSlotsFromTemplate = jest
      .fn()
      .mockResolvedValueOnce([
        {
          slot: { workDate: '2026-09-23', maxStaff: 1 },
          template: {
            workShift: {
              shiftName: 'Ca sáng',
              startTime: '08:00',
              endTime: '12:00',
            },
          },
        },
      ])
      .mockRejectedValueOnce(new Error('cycle L2 failed'));

    await expect(
      service.generateDailySlotsForIndefiniteCycles(),
    ).rejects.toThrow('cycle L2 failed');

    const calls = service.notificationsService.create.mock.calls.map(
      (c: any[]) => c[0],
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ accountId: 'acc-1', storeId: 'store-1' });
  });

  it('far horizon days (today+89) are generated but never announced', async () => {
    const { service, saved } = build(
      [
        cycle('c1', 'store-1', 'ws-a'),
        cycle('c2', 'store-1', 'ws-b'),
        cycle('c3', 'store-2', 'ws-c'),
      ],
      new Set(),
      [{ id: 'p1', accountId: 'acc-1', reminderSettings: null }],
    );

    const result = await service.generateDailySlotsForIndefiniteCycles();

    expect(result.createdCount).toBe(3);
    expect(saved.map((s) => s.workDate)).toEqual([HORIZON, HORIZON, HORIZON]);
    expect(service.profileRepository.find).not.toHaveBeenCalled();
    expect(service.notificationsService.create).not.toHaveBeenCalled();
  });

  it('a retry or second run creates nothing and announces nothing', async () => {
    const { service } = build(
      [cycle('c1', 'store-1', 'ws-a')],
      new Set(['c1:ws-a']),
      [{ id: 'p1', accountId: 'acc-1', reminderSettings: null }],
    );

    const result = await service.generateDailySlotsForIndefiniteCycles();

    expect(result.createdCount).toBe(0);
    expect(service.profileRepository.find).not.toHaveBeenCalled();
    expect(service.notificationsService.create).not.toHaveBeenCalled();
  });
});

describe('generateDailySlotsForAllCycles — announces free copied slots', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  const build = (firstDaySlots: any[], existingTomorrow: any[] = []) => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = {
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    };
    const builder: any = {};
    for (const m of ['leftJoinAndSelect', 'where', 'andWhere']) {
      builder[m] = jest.fn(() => builder);
    }
    builder.getMany = jest
      .fn()
      .mockResolvedValue([
        { id: 'c1', storeId: 'store-1', startDate: '2026-09-01' },
      ]);
    service.workCycleRepository = {
      createQueryBuilder: jest.fn(() => builder),
    };
    let n = 0;
    const manager = {
      query: jest.fn(async () => []),
      findOne: jest.fn(async (entity: unknown) =>
        entity === WorkCycle
          ? { id: 'c1', status: WorkCycleStatus.ACTIVE }
          : null,
      ),
      find: jest.fn(async (entity: unknown, options: any) => {
        if (entity !== ShiftSlot) return [];
        return options.relations ? firstDaySlots : existingTomorrow;
      }),
      create: jest.fn((_e: unknown, value: any) => ({ ...value })),
      save: jest.fn(async (_e: unknown, value: any) =>
        Array.isArray(value)
          ? value.map((v) =>
              v.id ? v : Object.assign(v, { id: `new-${++n}` }),
            )
          : value,
      ),
    };
    service.dataSource = {
      transaction: jest.fn(async (cb: any) => cb(manager)),
    };
    service.scheduleReminderForAssignment = jest
      .fn()
      .mockResolvedValue(undefined);
    service.notifyEmployeesOfCreatedShifts = jest
      .fn()
      .mockResolvedValue(undefined);
    return service;
  };
  /** Same, but with the real recipient rules behind a mocked profile list. */
  const buildReal = (firstDaySlots: any[], employees: any[]) => {
    const service = build(firstDaySlots);
    delete service.notifyEmployeesOfCreatedShifts; // back to the prototype
    service.profileRepository = {
      find: jest.fn().mockResolvedValue(employees),
    };
    service.notificationsService = { create: jest.fn().mockResolvedValue({}) };
    return service;
  };
  const template = (over: Record<string, unknown>) => ({
    id: 't',
    workShiftId: 'ws',
    startTime: '08:00',
    endTime: '12:00',
    maxStaff: 2,
    workShift: {
      shiftName: 'Ca sáng',
      startTime: '08:00',
      endTime: '12:00',
      defaultMaxStaff: 1,
    },
    assignments: [],
    ...over,
  });

  it('announces copied slots with a free seat, carrying their holders; full ones are not', async () => {
    const service = build([
      template({
        id: 't1',
        assignments: [
          { employeeId: 'p1', status: ShiftAssignmentStatus.APPROVED },
        ],
      }),
      template({
        id: 't2',
        maxStaff: 1,
        startTime: '18:00',
        endTime: '22:00',
        assignments: [
          { employeeId: 'p2', status: ShiftAssignmentStatus.APPROVED },
        ],
      }),
    ]);

    const result = await service.generateDailySlotsForAllCycles();

    expect(result).toEqual({ processedCycles: 1, createdSlots: 2 });
    expect(service.notifyEmployeesOfCreatedShifts).toHaveBeenCalledTimes(1);
    const [storeId, announced] =
      service.notifyEmployeesOfCreatedShifts.mock.calls[0];
    expect(storeId).toBe('store-1');
    expect(announced).toEqual([
      expect.objectContaining({
        startTime: '08:00',
        assignedProfileIds: ['p1'],
      }),
    ]);
  });

  it('already generated tomorrow: nothing created, nothing announced', async () => {
    const service = build([template({})], [{ id: 'existing' }]);

    const result = await service.generateDailySlotsForAllCycles();

    expect(result.createdSlots).toBe(0);
    expect(service.notifyEmployeesOfCreatedShifts).not.toHaveBeenCalled();
  });

  it('one aggregated notice per account per store; opted-out, account-less and holders are not told', async () => {
    const service = buildReal(
      [
        template({
          id: 't1',
          assignments: [
            { employeeId: 'p1', status: ShiftAssignmentStatus.APPROVED },
          ],
        }),
        template({ id: 't2', startTime: '18:00', endTime: '22:00' }),
      ],
      [
        { id: 'p1', accountId: 'acc-1', reminderSettings: null },
        { id: 'p2', accountId: 'acc-2', reminderSettings: null },
        {
          id: 'p3',
          accountId: 'acc-3',
          reminderSettings: { notifyNewShifts: false },
        },
        { id: 'p4', accountId: null, reminderSettings: null },
      ],
    );

    await service.generateDailySlotsForAllCycles();

    const calls = service.notificationsService.create.mock.calls.map(
      (c: any[]) => c[0],
    );
    expect(calls.map((c: any) => c.accountId)).toEqual(['acc-1', 'acc-2']);
    const [p1, p2] = calls;
    // p1 holds the morning seat: told only about the evening one.
    expect(p1.content).toBe(
      'Cửa hàng vừa mở Ca sáng hôm nay (22/09) (18:00–22:00). Vào đăng ký ngay nhé!',
    );
    expect(p2.title).toBe('Có ca mới để đăng ký');
    expect(p2.content).toBe(
      'Cửa hàng vừa mở 2 ca mới, hôm nay (22/09). Vào đăng ký ngay nhé!',
    );
    expect(p2.metadata).toEqual(
      expect.objectContaining({ type: 'SHIFT_CREATED', storeId: 'store-1' }),
    );
    for (const [line] of service.logger.log.mock.calls) {
      expect(line).not.toMatch(/acc-|p1|p2/);
    }
  });

  it('a notification failure never breaks generation', async () => {
    const failingLoad = buildReal([template({})], []);
    failingLoad.profileRepository.find.mockRejectedValue(new Error('db down'));
    await expect(failingLoad.generateDailySlotsForAllCycles()).resolves.toEqual(
      {
        processedCycles: 1,
        createdSlots: 1,
      },
    );

    const failingPush = buildReal(
      [template({})],
      [{ id: 'p9', accountId: 'acc-9', reminderSettings: null }],
    );
    failingPush.notificationsService.create.mockRejectedValue(
      new Error('push'),
    );
    await expect(failingPush.generateDailySlotsForAllCycles()).resolves.toEqual(
      {
        processedCycles: 1,
        createdSlots: 1,
      },
    );

    const failingStep = build([template({})]);
    failingStep.notifyEmployeesOfCreatedShifts.mockRejectedValue(
      new Error('boom'),
    );
    await expect(failingStep.generateDailySlotsForAllCycles()).resolves.toEqual(
      {
        processedCycles: 1,
        createdSlots: 1,
      },
    );
    expect(failingStep.logger.warn).toHaveBeenCalled();
  });

  it('a failing cycle still announces the slots committed before it, then rethrows', async () => {
    const service = build([template({})]);
    const builder = service.workCycleRepository.createQueryBuilder();
    builder.getMany.mockResolvedValue([
      { id: 'c1', storeId: 'store-1', startDate: '2026-09-01' },
      { id: 'c2', storeId: 'store-2', startDate: '2026-09-01' },
    ]);
    const first = service.dataSource.transaction.getMockImplementation();
    service.dataSource.transaction = jest
      .fn()
      .mockImplementationOnce(first)
      .mockRejectedValueOnce(new Error('cycle c2 failed'));

    await expect(service.generateDailySlotsForAllCycles()).rejects.toThrow(
      'cycle c2 failed',
    );

    expect(service.notifyEmployeesOfCreatedShifts).toHaveBeenCalledTimes(1);
    const [storeId, announced] =
      service.notifyEmployeesOfCreatedShifts.mock.calls[0];
    expect(storeId).toBe('store-1');
    expect(announced).toHaveLength(1);
  });
});
