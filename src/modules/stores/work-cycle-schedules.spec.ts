/**
 * Phase 3 A1/A2: several active schedules per store (only old-style cycles
 * keep the one-active rule) and the cycle stop date contract.
 */
import { BadRequestException } from '@nestjs/common';
import { IsNull, Not } from 'typeorm';

import {
  ONE_ACTIVE_CYCLE_CONSTRAINTS,
  StoresService,
  normalizeWorkCycleStopRequest,
} from './stores.service';
import {
  CycleType,
  WorkCycle,
  WorkCycleStatus,
} from './entities/shift-management.entity';
import { Store } from './entities/store.entity';
import {
  ShiftRecurrenceEndType,
  ShiftRecurrenceFrequency,
} from './shift-schedule.types';
import { addDays, getTodayDateString } from './shift-schedule.utils';

const TODAY = '2026-09-21';
// 2026-09-21 10:00 in Vietnam.
const NOW = new Date('2026-09-21T03:00:00.000Z');

describe('normalizeWorkCycleStopRequest (Vietnam dates on a UTC host)', () => {
  it('stops immediately by default and for the legacy immediate type', () => {
    expect(normalizeWorkCycleStopRequest(undefined, TODAY, NOW)).toEqual({
      immediate: true,
    });
    expect(normalizeWorkCycleStopRequest({}, TODAY, NOW)).toEqual({
      immediate: true,
    });
    expect(
      normalizeWorkCycleStopRequest({ stopType: 'immediate' }, TODAY, NOW),
    ).toEqual({ immediate: true });
    expect(
      normalizeWorkCycleStopRequest({ stopImmediately: true }, TODAY, NOW),
    ).toEqual({ immediate: true });
  });

  it('reads a date-only scheduledStopAt as 00:00 Vietnam time that day', () => {
    const plan = normalizeWorkCycleStopRequest(
      { stopImmediately: false, scheduledStopAt: '2026-09-25' },
      TODAY,
      NOW,
    );
    expect(plan).toEqual({
      immediate: false,
      stopAt: new Date('2026-09-24T17:00:00.000Z'),
    });
  });

  it('reads the legacy last working day S as a stop at 00:00 on S + 1', () => {
    const plan = normalizeWorkCycleStopRequest(
      { stopType: 'scheduled', stopDate: '2026-09-24' },
      TODAY,
      NOW,
    );
    expect(plan).toEqual({
      immediate: false,
      stopAt: new Date('2026-09-24T17:00:00.000Z'),
    });
  });

  it('stops now when the chosen day is today (legacy: yesterday as last day)', () => {
    expect(
      normalizeWorkCycleStopRequest(
        { stopImmediately: false, scheduledStopAt: TODAY },
        TODAY,
        NOW,
      ),
    ).toEqual({ immediate: true });
    expect(
      normalizeWorkCycleStopRequest(
        { stopType: 'scheduled', stopDate: '2026-09-20' },
        TODAY,
        NOW,
      ),
    ).toEqual({ immediate: true });
  });

  it('takes a full ISO instant as is', () => {
    expect(
      normalizeWorkCycleStopRequest(
        { stopImmediately: false, scheduledStopAt: '2026-10-01T05:00:00.000Z' },
        TODAY,
        NOW,
      ),
    ).toEqual({
      immediate: false,
      stopAt: new Date('2026-10-01T05:00:00.000Z'),
    });
  });

  it('rejects a past date with 400', () => {
    expect(() =>
      normalizeWorkCycleStopRequest(
        { stopImmediately: false, scheduledStopAt: '2026-09-20' },
        TODAY,
        NOW,
      ),
    ).toThrow('Ngày dừng không được ở trong quá khứ');
    expect(() =>
      normalizeWorkCycleStopRequest(
        { stopType: 'scheduled', stopDate: '2026-09-19' },
        TODAY,
        NOW,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects an unknown or missing date with 400', () => {
    for (const body of [
      { stopImmediately: false, scheduledStopAt: 'next week' },
      { stopImmediately: false, scheduledStopAt: '2026-02-30' },
      { stopImmediately: false },
      { stopType: 'scheduled', stopDate: 'soon' },
      { stopType: 'scheduled' },
    ]) {
      expect(() => normalizeWorkCycleStopRequest(body, TODAY, NOW)).toThrow(
        'Ngày dừng không hợp lệ',
      );
    }
  });
});

describe('stopWorkCycle applies the normalized stop', () => {
  const build = () => {
    const service = Object.create(StoresService.prototype) as any;
    const cycle = { id: 'c1', storeId: 'store-1', status: WorkCycleStatus.ACTIVE };
    service.workCycleRepository = { findOne: jest.fn().mockResolvedValue(cycle) };
    service.storeRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
    };
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    service.dataSource = {
      transaction: jest.fn(async (work: any) =>
        work({
          query: jest.fn(),
          findOne: jest.fn(async (entity: any) =>
            entity === Store ? { id: 'store-1', ownerAccountId: 'owner-1' } : cycle,
          ),
          update,
          find: jest.fn().mockResolvedValue([]),
        }),
      ),
    };
    service.getWorkCycleById = jest.fn().mockResolvedValue(cycle);
    service.shiftReminderService = { cancelAssignmentReminders: jest.fn() };
    return { service, update };
  };

  it('stores the legacy stopDate + 1 at 00:00 +07:00', async () => {
    const { service, update } = build();
    const lastWorkingDay = addDays(getTodayDateString(), 3);
    await service.stopWorkCycle(
      'c1',
      { stopType: 'scheduled', stopDate: lastWorkingDay },
      'owner-1',
    );
    expect(update).toHaveBeenCalledWith(WorkCycle, 'c1', {
      scheduledStopAt: new Date(`${addDays(lastWorkingDay, 1)}T00:00:00+07:00`),
    });
  });

  it('stops a cycle for the legacy immediate type', async () => {
    const { service, update } = build();
    await service.stopWorkCycle('c1', { stopType: 'immediate' }, 'owner-1');
    expect(update).toHaveBeenCalledWith(
      WorkCycle,
      'c1',
      expect.objectContaining({ status: WorkCycleStatus.STOPPED }),
    );
  });

  it('refuses a past date before touching the cycle', async () => {
    const { service, update } = build();
    await expect(
      service.stopWorkCycle(
        'c1',
        { stopImmediately: false, scheduledStopAt: addDays(getTodayDateString(), -1) },
        'owner-1',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('several active schedules per store', () => {
  const uniqueViolation = (constraint: string) =>
    Object.assign(new Error('duplicate key'), { code: '23505', constraint });

  const scheduleService = (error: unknown) => {
    const service = Object.create(StoresService.prototype) as any;
    service.storeRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
    };
    service.dataSource = { transaction: jest.fn().mockRejectedValue(error) };
    return service;
  };
  const schedule = {
    startDate: addDays(getTodayDateString(), 1),
    recurrence: {
      enabled: false,
      frequency: ShiftRecurrenceFrequency.DAILY,
      interval: 1,
      endType: ShiftRecurrenceEndType.COUNT,
      occurrenceCount: 1,
    },
    shifts: [
      { shiftName: 'Ca sáng', startTime: '07:00', endTime: '11:00', maxStaff: 1 },
    ],
  };

  it('matches both one-active index names while the SQL rolls out', () => {
    expect([...ONE_ACTIVE_CYCLE_CONSTRAINTS].sort()).toEqual([
      'uq_work_cycles_one_active_legacy_per_store',
      'uq_work_cycles_one_active_per_store',
    ]);
  });

  it.each([...ONE_ACTIVE_CYCLE_CONSTRAINTS])(
    'createShiftSchedule turns a %s violation into 400',
    async (constraint) => {
      const service = scheduleService(uniqueViolation(constraint));
      await expect(
        service.createShiftSchedule('store-1', 'owner-1', schedule),
      ).rejects.toThrow('Cửa hàng đã có chu kỳ đang hoạt động');
    },
  );

  it('createShiftSchedule rethrows any other unique violation', async () => {
    const error = uniqueViolation('uq_something_else');
    const service = scheduleService(error);
    await expect(
      service.createShiftSchedule('store-1', 'owner-1', schedule),
    ).rejects.toBe(error);
  });

  it('createWorkCycle is blocked only by an active old-style cycle', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.workCycleRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'legacy' }),
    };
    await expect(
      service.createWorkCycle('store-1', {
        name: 'Tuần',
        cycleType: CycleType.WEEKLY,
        startDate: '2026-10-01',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(service.workCycleRepository.findOne).toHaveBeenCalledWith({
      where: {
        storeId: 'store-1',
        status: WorkCycleStatus.ACTIVE,
        recurrenceRule: IsNull(),
      },
      select: ['id'],
    });
  });

  it('createWorkCycle proceeds when only a new-style schedule is active', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.workCycleRepository = {
      // The legacy-only query finds nothing even though a schedule is active.
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: any) => value),
      save: jest.fn(async (value: any) => ({ id: 'c-new', ...value })),
    };
    service.getWorkCycleById = jest.fn().mockResolvedValue({ id: 'c-new' });
    await expect(
      service.createWorkCycle('store-1', {
        name: 'Tuần',
        cycleType: CycleType.WEEKLY,
        startDate: '2026-10-01',
      }),
    ).resolves.toBeDefined();
    expect(service.workCycleRepository.save).toHaveBeenCalled();
  });

  const activateService = (target: any, otherActive: any) => {
    const service = Object.create(StoresService.prototype) as any;
    service.workCycleRepository = { findOne: jest.fn().mockResolvedValue(target) };
    service.storeRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
    };
    const manager = {
      query: jest.fn(),
      findOne: jest.fn(async (entity: any) =>
        entity === Store ? { id: 'store-1', ownerAccountId: 'owner-1' } : otherActive,
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    service.dataSource = { transaction: jest.fn(async (work: any) => work(manager)) };
    service.getWorkCycleById = jest.fn().mockResolvedValue(target);
    return { service, manager };
  };

  it('activateWorkCycle on a new-style schedule ignores other active cycles', async () => {
    const { service, manager } = activateService(
      { id: 'c2', storeId: 'store-1', recurrenceRule: { enabled: true } },
      { id: 'c1', status: WorkCycleStatus.ACTIVE },
    );
    await service.activateWorkCycle('c2', 'owner-1');
    expect(manager.findOne).not.toHaveBeenCalledWith(WorkCycle, expect.anything());
    expect(manager.update).toHaveBeenCalledWith(WorkCycle, 'c2', {
      status: WorkCycleStatus.ACTIVE,
    });
  });

  it('activateWorkCycle on an old-style cycle still refuses a second one', async () => {
    const { service, manager } = activateService(
      { id: 'c2', storeId: 'store-1', recurrenceRule: null },
      { id: 'c1', status: WorkCycleStatus.ACTIVE },
    );
    await expect(service.activateWorkCycle('c2', 'owner-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(manager.findOne).toHaveBeenCalledWith(WorkCycle, {
      where: {
        storeId: 'store-1',
        status: WorkCycleStatus.ACTIVE,
        recurrenceRule: IsNull(),
        id: Not('c2'),
      },
    });
  });
});

describe('createShiftSchedule announces open shifts to other staff', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const run = async (maxStaff: number, employeeIds: string[]) => {
    const service = Object.create(StoresService.prototype) as any;
    service.storeRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
    };
    service.dataSource = {
      transaction: jest.fn().mockResolvedValue({ id: 'cycle-1', assignmentIds: [] }),
    };
    service.notifyEmployeesOfCreatedShifts = jest.fn().mockResolvedValue(undefined);
    await service.createShiftSchedule('store-1', 'owner-1', {
      startDate: addDays(TODAY, 1),
      recurrence: {
        enabled: false,
        frequency: ShiftRecurrenceFrequency.DAILY,
        interval: 1,
        endType: ShiftRecurrenceEndType.COUNT,
        occurrenceCount: 1,
      },
      shifts: [
        {
          shiftName: 'Ca sáng',
          startTime: '07:00',
          endTime: '11:00',
          maxStaff,
          employeeIds,
        },
      ],
    });
    return service.notifyEmployeesOfCreatedShifts as jest.Mock;
  };

  it('excludes the people already picked for every open shift', async () => {
    const notify = await run(2, ['p1']);
    expect(notify).toHaveBeenCalledWith(
      'store-1',
      [
        {
          workDate: addDays(TODAY, 1),
          startTime: '07:00',
          endTime: '11:00',
          shiftName: 'Ca sáng',
          assignedProfileIds: ['p1'],
        },
      ],
      ['p1'],
    );
  });

  it('announces nothing when the shift is already full', async () => {
    const notify = await run(1, ['p1']);
    expect(notify).toHaveBeenCalledWith('store-1', [], []);
  });
});
