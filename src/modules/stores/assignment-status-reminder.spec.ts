/**
 * Phase 3 A4: the owner app approves and cancels shift registrations through
 * `PUT shift-assignments/:id/status`, which scheduled no reminder. Reminders
 * now follow the committed status.
 */
import { StoresService } from './stores.service';
import { ShiftAssignmentStatus } from './entities/shift-management.entity';

function build(previous: ShiftAssignmentStatus) {
  const service = Object.create(StoresService.prototype) as any;
  let committed = false;
  const events: string[] = [];
  service.notifyEmployeesOfNewShifts = jest.fn().mockResolvedValue(undefined);
  service.logger = { error: jest.fn() };
  service.shiftReminderService = {
    scheduleAssignmentReminder: jest.fn(async () => {
      events.push(committed ? 'schedule-after-commit' : 'schedule-before-commit');
    }),
    cancelAssignmentReminders: jest.fn(async () => {
      events.push(committed ? 'cancel-after-commit' : 'cancel-before-commit');
    }),
  };
  const assignment = {
    id: 'assignment-1',
    status: previous,
    shiftSlot: { cycle: { storeId: 'store-1' } },
  };
  service.shiftAssignmentRepository = {
    findOne: jest.fn().mockResolvedValue(assignment),
  };
  service.storeRepository = {
    findOne: jest.fn().mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
  };
  service.dataSource = {
    transaction: jest.fn(async (work: any) => {
      const result = await work({
        query: jest.fn(),
        findOne: jest
          .fn()
          .mockResolvedValueOnce({ id: 'store-1', ownerAccountId: 'owner-1' })
          .mockResolvedValueOnce({ id: 'assignment-1', status: previous }),
        save: jest.fn(async (_entity: unknown, value: any) => value),
      });
      committed = true;
      return result;
    }),
  };
  return { service, events };
}

describe('updateAssignmentStatus keeps reminders in step', () => {
  it('schedules exactly one reminder after commit for PENDING -> APPROVED', async () => {
    const { service, events } = build(ShiftAssignmentStatus.PENDING);
    await expect(
      service.updateAssignmentStatus(
        'assignment-1',
        ShiftAssignmentStatus.APPROVED,
        undefined,
        'owner-1',
      ),
    ).resolves.toMatchObject({ status: ShiftAssignmentStatus.APPROVED });
    expect(service.shiftReminderService.scheduleAssignmentReminder).toHaveBeenCalledTimes(1);
    expect(service.shiftReminderService.scheduleAssignmentReminder).toHaveBeenCalledWith(
      'assignment-1',
    );
    expect(events).toEqual(['schedule-after-commit']);
  });

  it('cancels the reminder for APPROVED -> CANCELLED', async () => {
    const { service, events } = build(ShiftAssignmentStatus.APPROVED);
    await service.updateAssignmentStatus(
      'assignment-1',
      ShiftAssignmentStatus.CANCELLED,
      undefined,
      'owner-1',
    );
    expect(service.shiftReminderService.cancelAssignmentReminders).toHaveBeenCalledWith([
      'assignment-1',
    ]);
    expect(events).toEqual(['cancel-after-commit']);
  });

  it('touches no reminder for PENDING -> CANCELLED', async () => {
    const { service, events } = build(ShiftAssignmentStatus.PENDING);
    await service.updateAssignmentStatus(
      'assignment-1',
      ShiftAssignmentStatus.CANCELLED,
      undefined,
      'owner-1',
    );
    expect(events).toEqual([]);
  });

  it('does not fail the request when the queue fails', async () => {
    const { service } = build(ShiftAssignmentStatus.PENDING);
    service.shiftReminderService.scheduleAssignmentReminder.mockRejectedValue(
      new Error('redis down'),
    );
    await expect(
      service.updateAssignmentStatus(
        'assignment-1',
        ShiftAssignmentStatus.APPROVED,
        undefined,
        'owner-1',
      ),
    ).resolves.toMatchObject({ status: ShiftAssignmentStatus.APPROVED });
    expect(service.logger.error).toHaveBeenCalledWith(
      'Failed to sync assignment reminder after status change',
    );
  });

  it('returns the saved assignment as before', async () => {
    const { service } = build(ShiftAssignmentStatus.PENDING);
    const saved = await service.updateAssignmentStatus(
      'assignment-1',
      ShiftAssignmentStatus.APPROVED,
      'ok',
      'owner-1',
    );
    expect(saved).toEqual({
      id: 'assignment-1',
      status: ShiftAssignmentStatus.APPROVED,
      note: 'ok',
    });
  });
});
