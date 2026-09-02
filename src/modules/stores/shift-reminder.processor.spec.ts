import { ShiftReminderProcessor } from './shift-reminder.processor';
import {
  NotificationPriority,
  NotificationType,
} from '../notifications/entities/notification.entity';
import {
  buildShiftReminderFingerprint,
  buildShiftReminderJobId,
  parseVietnamShiftStart,
} from './shift-reminder.utils';

describe('ShiftReminderProcessor identity checks', () => {
  it('notifies an exact assignment that passes the active/future-stop DB gate', async () => {
    const currentStart = parseVietnamShiftStart('2030-01-01', '09:00');
    const query = jest.fn().mockResolvedValue([
      {
        id: 'assignment-1',
        status: 'APPROVED',
        shiftSlotId: 'slot-1',
        workDate: '2030-01-01',
        startTime: '09:00:00',
        shiftId: 'shift-1',
      },
    ]);
    const notificationsService = {
      create: jest.fn().mockResolvedValue(undefined),
    };
    const employeeRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'employee-1',
        storeId: 'store-1',
        accountId: 'account-1',
        account: {},
        reminderSettings: { type: '15m' },
      }),
      manager: { query },
    };
    const processor = new ShiftReminderProcessor(
      notificationsService as any,
      employeeRepository as any,
      { getJob: jest.fn() } as any,
    );

    await processor.process({
      data: {
        employeeId: 'employee-1',
        storeId: 'store-1',
        shiftId: 'shift-1',
        shiftSlotId: 'slot-1',
        assignmentId: 'assignment-1',
        startTime: currentStart,
        scheduleFingerprint: buildShiftReminderFingerprint(
          { assignmentId: 'assignment-1', shiftSlotId: 'slot-1' },
          'shift-1',
          currentStart,
          { type: '15m' },
        ),
      },
    } as any);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('sa.id = $2::uuid'),
      ['employee-1', 'assignment-1', 'slot-1', 'shift-1', null, null, 'ACTIVE'],
    );
    expect(query.mock.calls[0][0]).toContain(
      'JOIN work_cycles wc ON ss.cycle_id = wc.id',
    );
    expect(query.mock.calls[0][0]).toContain('AND wc.status = $7');
    expect(query.mock.calls[0][0]).toContain('wc.scheduled_stop_at > NOW()');
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        storeId: 'store-1',
        type: NotificationType.SHIFT_REMINDER,
        priority: NotificationPriority.HIGH,
        metadata: expect.objectContaining({
          assignmentId: 'assignment-1',
          shiftSlotId: 'slot-1',
        }),
      }),
    );
  });

  it('skips legacy queued jobs after the employee opts out', async () => {
    const query = jest.fn();
    const notificationsService = { create: jest.fn() };
    const employeeRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'employee-1',
        storeId: 'store-1',
        accountId: 'account-1',
        account: {},
        reminderSettings: { type: 'off' },
      }),
      manager: { query },
    };
    const processor = new ShiftReminderProcessor(
      notificationsService as any,
      employeeRepository as any,
      { getJob: jest.fn() } as any,
    );

    await processor.process({
      data: {
        employeeId: 'employee-1',
        storeId: 'store-1',
        shiftId: 'shift-1',
        startTime: '2030-01-01T09:00:00.000Z',
      },
    } as any);

    expect(query).not.toHaveBeenCalled();
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('skips a superseded v2 job after the shift occurrence time changes', async () => {
    const oldStart = parseVietnamShiftStart('2030-01-01', '09:00');
    const employeeRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'employee-1',
        storeId: 'store-1',
        accountId: 'account-1',
        account: {},
        reminderSettings: { type: '15m' },
      }),
      manager: {
        query: jest.fn().mockResolvedValue([
          {
            id: 'assignment-1',
            status: 'APPROVED',
            shiftSlotId: 'slot-1',
            workDate: '2030-01-01',
            startTime: '10:00:00',
            shiftId: 'shift-1',
          },
        ]),
      },
    };
    const notificationsService = { create: jest.fn() };
    const processor = new ShiftReminderProcessor(
      notificationsService as any,
      employeeRepository as any,
      { getJob: jest.fn() } as any,
    );

    await processor.process({
      data: {
        employeeId: 'employee-1',
        storeId: 'store-1',
        shiftId: 'shift-1',
        shiftSlotId: 'slot-1',
        assignmentId: 'assignment-1',
        startTime: oldStart,
        scheduleFingerprint: buildShiftReminderFingerprint(
          { assignmentId: 'assignment-1', shiftSlotId: 'slot-1' },
          'shift-1',
          oldStart,
          { type: '15m' },
        ),
      },
    } as any);

    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('skips a legacy job when the retained current v2 occurrence exists', async () => {
    const currentStart = parseVietnamShiftStart('2030-01-01', '09:00');
    const currentIdentity = {
      assignmentId: 'assignment-1',
      shiftSlotId: 'slot-1',
    };
    const employeeRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'employee-1',
        storeId: 'store-1',
        accountId: 'account-1',
        account: {},
        reminderSettings: { type: '15m' },
      }),
      manager: {
        query: jest.fn().mockResolvedValue([
          {
            id: 'assignment-1',
            status: 'APPROVED',
            shiftSlotId: 'slot-1',
            workDate: '2030-01-01',
            startTime: '09:00:00',
            shiftId: 'shift-1',
          },
        ]),
      },
    };
    const notificationsService = { create: jest.fn() };
    const currentJobId = buildShiftReminderJobId(
      currentIdentity,
      'shift-1',
      'employee-1',
    );
    const queue = {
      getJob: jest.fn().mockResolvedValue({ id: currentJobId }),
    };
    const processor = new ShiftReminderProcessor(
      notificationsService as any,
      employeeRepository as any,
      queue as any,
    );

    await processor.process({
      id: 'reminder_assignment-1_employee-1',
      data: {
        employeeId: 'employee-1',
        storeId: 'store-1',
        shiftId: 'shift-1',
        shiftSlotId: 'slot-1',
        assignmentId: 'assignment-1',
        startTime: currentStart.toISOString(),
      },
    } as any);

    expect(queue.getJob).toHaveBeenCalledWith(currentJobId);
    expect(employeeRepository.manager.query.mock.calls[0][0]).toContain(
      'ss.work_date = $5::date',
    );
    expect(employeeRepository.manager.query.mock.calls[0][0]).toContain(
      'COALESCE(ss.start_time, ws.start_time) = $6::time',
    );
    expect(employeeRepository.manager.query.mock.calls[0][1]).toEqual([
      'employee-1',
      'assignment-1',
      'slot-1',
      'shift-1',
      '2030-01-01',
      '09:00:00',
      'ACTIVE',
    ]);
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('skips a racing v2 job after the reminder preference changes', async () => {
    const currentStart = parseVietnamShiftStart('2030-01-01', '09:00');
    const employeeRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'employee-1',
        storeId: 'store-1',
        accountId: 'account-1',
        account: {},
        reminderSettings: { type: '1h' },
      }),
      manager: {
        query: jest.fn().mockResolvedValue([
          {
            id: 'assignment-1',
            shiftSlotId: 'slot-1',
            workDate: '2030-01-01',
            startTime: '09:00:00',
            shiftId: 'shift-1',
          },
        ]),
      },
    };
    const notificationsService = { create: jest.fn() };
    const processor = new ShiftReminderProcessor(
      notificationsService as any,
      employeeRepository as any,
      { getJob: jest.fn() } as any,
    );

    await processor.process({
      data: {
        employeeId: 'employee-1',
        storeId: 'store-1',
        shiftId: 'shift-1',
        shiftSlotId: 'slot-1',
        assignmentId: 'assignment-1',
        startTime: currentStart,
        scheduleFingerprint: buildShiftReminderFingerprint(
          { assignmentId: 'assignment-1', shiftSlotId: 'slot-1' },
          'shift-1',
          currentStart,
          { type: '15m' },
        ),
      },
    } as any);

    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('skips when the DB gate filters an ACTIVE cycle whose stop is due', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const notificationsService = { create: jest.fn() };
    const employeeRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'employee-1',
        storeId: 'store-1',
        accountId: 'account-1',
        account: {},
        reminderSettings: { type: '15m' },
      }),
      manager: { query },
    };
    const processor = new ShiftReminderProcessor(
      notificationsService as any,
      employeeRepository as any,
      { getJob: jest.fn() } as any,
    );

    await processor.process({
      data: {
        employeeId: 'employee-1',
        storeId: 'store-1',
        shiftId: 'shift-1',
        assignmentId: 'assignment-1',
        startTime: parseVietnamShiftStart('2030-01-01', '09:00'),
        scheduleFingerprint: 'stale',
      },
    } as any);

    expect(query.mock.calls[0][0]).toContain('AND wc.status = $7');
    expect(query.mock.calls[0][0]).toContain(
      '(wc.scheduled_stop_at IS NULL OR wc.scheduled_stop_at > NOW())',
    );
    expect(notificationsService.create).not.toHaveBeenCalled();
  });
});
