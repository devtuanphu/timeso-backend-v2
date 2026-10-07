/**
 * X6: owner pre-shift / ending-soon alerts ride on the staff reminder
 * lifecycle (schedule, cancel, reconcile) without ever breaking it.
 */
import { ShiftReminderService } from '../../../../src/modules/stores/shift-reminder.service';

function build() {
  const service = Object.create(ShiftReminderService.prototype) as any;
  service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const owner = {
    syncAssignments: jest.fn().mockResolvedValue({ scheduled: 1 }),
    cancelAssignments: jest.fn().mockResolvedValue(undefined),
    reconcileUpcoming: jest.fn().mockResolvedValue({ candidates: 0 }),
  };
  service.ownerNotificationService = owner;
  return { service, owner };
}

describe('ShiftReminderService → owner alerts', () => {
  it('scheduling one assignment also syncs its owner alerts, even when the staff reminder fails', async () => {
    const { service, owner } = build();
    service.scheduleStaffAssignmentReminder = jest
      .fn()
      .mockRejectedValue(new Error('redis lock unavailable'));

    await expect(service.scheduleAssignmentReminder('as-1')).rejects.toThrow(
      'redis lock unavailable',
    );
    expect(owner.syncAssignments).toHaveBeenCalledWith(['as-1']);
  });

  it('batch scheduling syncs the de-duplicated ids', async () => {
    const { service, owner } = build();
    service.scheduleStaffAssignmentReminders = jest
      .fn()
      .mockResolvedValue({ requested: 2, loaded: 2, enqueued: 2 });

    await service.scheduleAssignmentReminders(['as-1', 'as-2', 'as-1', '']);
    expect(owner.syncAssignments).toHaveBeenCalledWith(['as-1', 'as-2']);
  });

  it('an owner-alert failure never fails the staff reminder', async () => {
    const { service, owner } = build();
    owner.syncAssignments.mockRejectedValue(new Error('boom'));
    service.scheduleStaffAssignmentReminder = jest.fn().mockResolvedValue(true);
    await expect(service.scheduleAssignmentReminder('as-1')).resolves.toBe(true);
  });

  it('cancelling reminders cancels the owner alerts too', async () => {
    const { service, owner } = build();
    service.assignmentRepository = { find: jest.fn().mockResolvedValue([]) };
    await service.cancelAssignmentReminders(['as-1', 'as-1']);
    expect(owner.cancelAssignments).toHaveBeenCalledWith(['as-1']);
  });

  it('the hourly reconcile also reconciles owner alerts', async () => {
    const { service, owner } = build();
    const qb: any = {};
    for (const m of ['innerJoin', 'select', 'where', 'andWhere', 'orderBy', 'addOrderBy', 'limit']) {
      qb[m] = jest.fn(() => qb);
    }
    qb.getRawMany = jest.fn().mockResolvedValue([]);
    service.assignmentRepository = { createQueryBuilder: jest.fn(() => qb) };
    const now = new Date('2026-09-21T05:00:00Z');
    await service.reconcileUpcomingReminders(now);
    expect(owner.reconcileUpcoming).toHaveBeenCalledWith(now, {
      extraAssignmentIds: [],
    });
  });

  it('the hourly reconcile syncs each assignment\'s owner alerts once (no double sync)', async () => {
    const { service, owner } = build();
    const qb: any = {};
    for (const m of ['innerJoin', 'select', 'where', 'andWhere', 'orderBy', 'addOrderBy', 'limit']) {
      qb[m] = jest.fn(() => qb);
    }
    qb.getRawMany = jest.fn().mockResolvedValue([{ id: 'as-1' }, { id: 'as-2' }]);
    service.assignmentRepository = { createQueryBuilder: jest.fn(() => qb) };
    service.scheduleStaffAssignmentReminders = jest
      .fn()
      .mockResolvedValue({ requested: 2, loaded: 2, enqueued: 2 });
    const now = new Date('2026-09-21T05:00:00Z');
    await service.reconcileUpcomingReminders(now, { windowHours: 24 });
    expect(service.scheduleStaffAssignmentReminders).toHaveBeenCalledWith(['as-1', 'as-2']);
    // The staff path did not sync owner alerts itself…
    expect(owner.syncAssignments).not.toHaveBeenCalled();
    // …the owner reconcile got the staff ids to merge into its own set.
    expect(owner.reconcileUpcoming).toHaveBeenCalledTimes(1);
    expect(owner.reconcileUpcoming).toHaveBeenCalledWith(now, {
      windowHours: 24,
      extraAssignmentIds: ['as-1', 'as-2'],
    });
  });
});
