import { StoresService } from './stores.service';
import {
  selectFreeSeatAnnouncement,
  shiftsOpenTo,
  SlotAnnouncementThrottle,
} from './shift-assignment-notification';
import {
  ShiftAssignmentStatus,
  ShiftSlot,
  WorkCycleStatus,
} from './entities/shift-management.entity';
import { Store } from './entities/store.entity';

/**
 * New-shift notices (user decision R7): the picked person gets "Bạn có ca làm
 * mới"; other eligible staff get "Có ca mới để đăng ký" whenever a
 * not-yet-started shift has a free seat — at creation and when the owner
 * later raises maxStaff or cancels someone. Full shifts tell nobody else.
 */
// 2026-09-22 10:00 in Vietnam.
const NOW = new Date('2026-09-22T03:00:00Z');

describe('selectFreeSeatAnnouncement', () => {
  const slot = (over: Record<string, unknown> = {}) => ({
    workDate: '2026-09-23',
    startTime: null,
    endTime: null,
    templateStartTime: '08:00:00',
    templateEndTime: '12:00:00',
    shiftName: 'Ca sáng',
    maxStaff: 2,
    holderProfileIds: ['p1'],
    ...over,
  });

  it('announces a free seat with the template times and the holders', () => {
    expect(selectFreeSeatAnnouncement(slot(), NOW)).toEqual({
      workDate: '2026-09-23',
      startTime: '08:00:00',
      endTime: '12:00:00',
      shiftName: 'Ca sáng',
      assignedProfileIds: ['p1'],
    });
  });

  it('a full shift announces nothing', () => {
    expect(
      selectFreeSeatAnnouncement(slot({ holderProfileIds: ['p1', 'p2'] }), NOW),
    ).toBeNull();
  });

  it('a started or past shift announces nothing (VN time)', () => {
    // Today 08:00 VN already started at 10:00 VN.
    expect(
      selectFreeSeatAnnouncement(slot({ workDate: '2026-09-22' }), NOW),
    ).toBeNull();
    expect(
      selectFreeSeatAnnouncement(slot({ workDate: '2026-09-21' }), NOW),
    ).toBeNull();
    // Later today, slot override time.
    expect(
      selectFreeSeatAnnouncement(
        slot({ workDate: '2026-09-22', startTime: '18:00' }),
        NOW,
      ),
    ).not.toBeNull();
  });

  it('0/null seats mean unlimited', () => {
    expect(selectFreeSeatAnnouncement(slot({ maxStaff: 0 }), NOW)).not.toBeNull();
    expect(selectFreeSeatAnnouncement(slot({ maxStaff: null }), NOW)).not.toBeNull();
  });
});

describe('shiftsOpenTo', () => {
  it('drops shifts the employee already holds', () => {
    const a = { workDate: '2026-09-23', assignedProfileIds: ['p1'] };
    const b = { workDate: '2026-09-24', assignedProfileIds: [] };
    expect(shiftsOpenTo('p1', [a, b])).toEqual([b]);
    expect(shiftsOpenTo('p2', [a, b])).toEqual([a, b]);
  });
});

describe('SlotAnnouncementThrottle', () => {
  it('announces a slot at most once per window', () => {
    const throttle = new SlotAnnouncementThrottle(1_000, 10);
    expect(throttle.claim('s1', 0)).toBe(true);
    expect(throttle.claim('s1', 999)).toBe(false);
    expect(throttle.claim('s2', 999)).toBe(true);
    expect(throttle.claim('s1', 1_000)).toBe(true);
  });

  it('stays bounded', () => {
    const throttle = new SlotAnnouncementThrottle(60_000, 2);
    expect(throttle.claim('a', 0)).toBe(true);
    expect(throttle.claim('b', 1)).toBe(true);
    expect(throttle.claim('c', 2)).toBe(true);
    expect((throttle as any).last.size).toBe(2);
  });
});

describe('notifyEmployeesOfCreatedShifts — per recipient', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it('tells each person only about the shifts they do not hold', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = { warn: jest.fn(), log: jest.fn(), debug: jest.fn() };
    service.profileRepository = {
      find: jest.fn().mockResolvedValue([
        { id: 'p1', accountId: 'acc-1', reminderSettings: null },
        { id: 'p2', accountId: 'acc-2', reminderSettings: null },
      ]),
    };
    service.notificationsService = { create: jest.fn().mockResolvedValue({}) };

    await service.notifyEmployeesOfCreatedShifts('store-1', [
      { workDate: '2026-09-23', startTime: '08:00', endTime: '12:00', shiftName: 'Sáng', assignedProfileIds: ['p1'] },
      { workDate: '2026-09-23', startTime: '18:00', endTime: '22:00', shiftName: 'Tối', assignedProfileIds: [] },
    ]);

    const calls = service.notificationsService.create.mock.calls.map((c: any[]) => c[0]);
    const p1 = calls.find((c: any) => c.accountId === 'acc-1');
    const p2 = calls.find((c: any) => c.accountId === 'acc-2');
    expect(p1.title).toBe('Có ca mới để đăng ký');
    expect(p1.content).toContain('Tối');
    expect(p1.content).not.toContain('Sáng');
    expect(p2.content).toContain('2 ca mới');
  });

  it('nobody is told when everyone eligible already holds the shift', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = { warn: jest.fn(), log: jest.fn(), debug: jest.fn() };
    service.profileRepository = {
      find: jest
        .fn()
        .mockResolvedValue([{ id: 'p1', accountId: 'acc-1', reminderSettings: null }]),
    };
    service.notificationsService = { create: jest.fn() };

    await service.notifyEmployeesOfCreatedShifts('store-1', [
      { workDate: '2026-09-23', startTime: '08:00', assignedProfileIds: ['p1'] },
    ]);

    expect(service.notificationsService.create).not.toHaveBeenCalled();
  });
});

describe('announceFreeSeatsOfSlot', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  const build = (slot: any) => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = { warn: jest.fn(), log: jest.fn(), debug: jest.fn() };
    service.shiftSlotRepository = { findOne: jest.fn().mockResolvedValue(slot) };
    service.notifyEmployeesOfCreatedShifts = jest.fn().mockResolvedValue(undefined);
    return service;
  };
  const slot = (over: Record<string, unknown> = {}) => ({
    id: 'slot-1',
    workDate: '2026-09-23',
    startTime: '08:00',
    endTime: '12:00',
    maxStaff: 2,
    cycle: { storeId: 'store-1', status: WorkCycleStatus.ACTIVE },
    workShift: { shiftName: 'Ca sáng', startTime: '08:00', endTime: '12:00', defaultMaxStaff: 1 },
    assignments: [
      { employeeId: 'p1', status: ShiftAssignmentStatus.APPROVED },
      { employeeId: 'p9', status: ShiftAssignmentStatus.CANCELLED },
    ],
    ...over,
  });

  it('announces a free seat, excluding holders and the removed person, once per window', async () => {
    const service = build(slot());

    await service.announceFreeSeatsOfSlot('slot-1', 'assignment_cancelled', ['p9']);
    await service.announceFreeSeatsOfSlot('slot-1', 'assignment_cancelled', ['p9']);

    expect(service.notifyEmployeesOfCreatedShifts).toHaveBeenCalledTimes(1);
    const [storeId, shifts, exclude] =
      service.notifyEmployeesOfCreatedShifts.mock.calls[0];
    expect(storeId).toBe('store-1');
    expect(shifts).toEqual([
      expect.objectContaining({ workDate: '2026-09-23', assignedProfileIds: ['p1'] }),
    ]);
    expect(exclude).toEqual(['p1', 'p9']);
    // Counts-only logging.
    for (const [line] of service.logger.debug.mock.calls) {
      expect(line).not.toMatch(/p1|p9|acc-/);
    }
  });

  it('a full slot, a started slot or an inactive cycle announces nothing', async () => {
    for (const s of [
      slot({ maxStaff: 1 }),
      slot({ workDate: '2026-09-22' }),
      slot({ cycle: { storeId: 'store-1', status: WorkCycleStatus.EXPIRED } }),
    ]) {
      const service = build(s);
      await service.announceFreeSeatsOfSlot('slot-1', 'max_staff_raised');
      expect(service.notifyEmployeesOfCreatedShifts).not.toHaveBeenCalled();
    }
  });

  it('a null slot override inherits the template seat count', async () => {
    const service = build(slot({ maxStaff: null }));
    await service.announceFreeSeatsOfSlot('slot-1', 'max_staff_raised');
    // Template default is 1 seat, already held by p1.
    expect(service.notifyEmployeesOfCreatedShifts).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    const service = build(null);
    service.shiftSlotRepository.findOne.mockRejectedValue(new Error('db'));
    await expect(
      service.announceFreeSeatsOfSlot('slot-1', 'max_staff_raised'),
    ).resolves.toBeUndefined();
  });
});

describe('owner triggers', () => {
  const managerFor = (lockedSlot: any, assignment?: any) => ({
    query: jest.fn(async () => []),
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === Store) return { id: 'store-1', ownerAccountId: 'owner-1' };
      if (entity === ShiftSlot) return lockedSlot;
      return assignment;
    }),
    update: jest.fn(async () => ({ affected: 1 })),
    save: jest.fn(async (_e: unknown, value: any) => value),
  });

  const slotService = (lockedSlot: any) => {
    const service = Object.create(StoresService.prototype) as any;
    service.shiftSlotRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'slot-1', cycle: { storeId: 'store-1' } }),
    };
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue(undefined);
    const manager = managerFor(lockedSlot);
    service.dataSource = { transaction: jest.fn(async (cb: any) => cb(manager)) };
    service.announceFreeSeatsOfSlot = jest.fn().mockResolvedValue(undefined);
    return service;
  };

  it('raising maxStaff announces the slot; lowering it does not', async () => {
    const raised = slotService({ id: 'slot-1', maxStaff: 1 });
    await raised.updateShiftSlot('slot-1', { maxStaff: 3 }, 'owner-1');
    expect(raised.announceFreeSeatsOfSlot).toHaveBeenCalledWith('slot-1', 'max_staff_raised');

    const lowered = slotService({ id: 'slot-1', maxStaff: 3 });
    await lowered.updateShiftSlot('slot-1', { maxStaff: 2 }, 'owner-1');
    expect(lowered.announceFreeSeatsOfSlot).not.toHaveBeenCalled();

    const note = slotService({ id: 'slot-1', maxStaff: 3 });
    await note.updateShiftSlot('slot-1', { note: 'x' }, 'owner-1');
    expect(note.announceFreeSeatsOfSlot).not.toHaveBeenCalled();
  });

  const statusService = (current: any) => {
    const service = Object.create(StoresService.prototype) as any;
    service.shiftAssignmentRepository = {
      findOne: jest.fn().mockResolvedValue({
        ...current,
        shiftSlot: { cycle: { storeId: 'store-1' } },
      }),
    };
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue(undefined);
    const manager = managerFor(null, { ...current });
    service.dataSource = { transaction: jest.fn(async (cb: any) => cb(manager)) };
    service.syncReminderAfterAssignmentStatusChange = jest.fn().mockResolvedValue(undefined);
    service.notifyEmployeesOfNewShifts = jest.fn().mockResolvedValue(undefined);
    service.announceFreeSeatsOfSlot = jest.fn().mockResolvedValue(undefined);
    return service;
  };

  it('cancelling a booked person announces the freed seat to others', async () => {
    const service = statusService({
      id: 'a-1',
      shiftSlotId: 'slot-1',
      employeeId: 'p1',
      status: ShiftAssignmentStatus.APPROVED,
    });

    await service.updateAssignmentStatus('a-1', 'CANCELLED', undefined, 'owner-1');

    expect(service.announceFreeSeatsOfSlot).toHaveBeenCalledWith(
      'slot-1',
      'assignment_cancelled',
      ['p1'],
    );
  });

  it('rejecting a pending registration is not announced', async () => {
    const service = statusService({
      id: 'a-1',
      shiftSlotId: 'slot-1',
      employeeId: 'p1',
      status: ShiftAssignmentStatus.PENDING,
    });

    await service.updateAssignmentStatus('a-1', 'CANCELLED', undefined, 'owner-1');

    expect(service.announceFreeSeatsOfSlot).not.toHaveBeenCalled();
  });
});
