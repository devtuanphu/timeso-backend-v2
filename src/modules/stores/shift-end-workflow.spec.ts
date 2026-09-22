import { In } from 'typeorm';
import {
  PENDING_OVERTIME_EXPIRED_NOTE,
  ShiftEndWorkflowService,
} from './shift-end-workflow.service';
import {
  BonusWorkRequest,
  BonusWorkRequestStatus,
} from './entities/bonus-work-request.entity';
import { ShiftEndWorkflowState } from './entities/shift-end-workflow.entity';
import { ShiftAssignmentStatus } from './entities/shift-management.entity';

describe('ShiftEndWorkflowService', () => {
  const workflow = {
    id: 'workflow-1',
    shiftAssignmentId: 'assignment-1',
    effectiveEndAt: new Date('2026-07-12T10:00:00.000Z'),
    state: ShiftEndWorkflowState.ACTIVE,
  } as any;
  const assignment = {
    id: 'assignment-1',
    shiftSlotId: 'slot-1',
    employeeId: 'employee-1',
    checkInTime: new Date('2026-07-12T01:00:00.000Z'),
    checkOutTime: null,
    status: ShiftAssignmentStatus.CONFIRMED,
    shiftSlot: { workDate: '2026-07-12', cycle: { storeId: 'store-1' } },
    employee: { accountId: 'account-1' },
  } as any;

  function createService(options?: { overtimeStatus?: BonusWorkRequestStatus }) {
    let markerWasSet = false;
    const queryBuilder: any = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn(async () => {
        if (markerWasSet) return { affected: 0 };
        markerWasSet = true;
        return { affected: 1 };
      }),
    };
    const workflowRepository: any = {
      findOne: jest.fn().mockResolvedValue({ ...workflow }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    const assignmentRepository: any = {
      findOne: jest.fn().mockResolvedValue({ ...assignment }),
    };
    const bonusWorkRepository: any = {
      findOne: jest.fn().mockResolvedValue(
        options?.overtimeStatus
          ? { id: 'overtime-1', status: options.overtimeStatus }
          : null,
      ),
    };
    const notificationsService: any = { create: jest.fn().mockResolvedValue({}) };
    const service = new ShiftEndWorkflowService(
      workflowRepository,
      assignmentRepository,
      bonusWorkRepository,
      {} as any,
      {} as any,
      {} as any,
      notificationsService,
      { add: jest.fn() } as any,
      { add: jest.fn() } as any,
    );
    return { service, workflowRepository, notificationsService };
  }

  it('tính đúng giờ kết thúc cho ca thường và ca qua đêm', () => {
    const { service } = createService();
    expect(service.calculateScheduledEnd('2026-07-12', '08:00:00', '17:00:00').toISOString())
      .toBe('2026-07-12T10:00:00.000Z');
    expect(service.calculateScheduledEnd('2026-07-12', '22:00:00', '06:00:00').toISOString())
      .toBe('2026-07-12T23:00:00.000Z');
  });

  it('chỉ gửi một thông báo khi hai worker xử lý cùng reminder', async () => {
    const { service, notificationsService } = createService();
    const data = {
      assignmentId: 'assignment-1',
      expectedEndAt: workflow.effectiveEndAt.toISOString(),
      reminderMinute: 0 as const,
    };
    await Promise.all([service.handleReminderJob(data), service.handleReminderJob(data)]);
    expect(notificationsService.create).toHaveBeenCalledTimes(1);
  });

  it('tạm dừng reminder và auto-checkout khi đơn tăng ca đang chờ duyệt', async () => {
    const { service, workflowRepository, notificationsService } = createService({
      overtimeStatus: BonusWorkRequestStatus.PENDING,
    });
    const autoCheckout = jest.spyOn(service, 'autoCheckout');
    await service.handleReminderJob({
      assignmentId: 'assignment-1',
      expectedEndAt: workflow.effectiveEndAt.toISOString(),
      reminderMinute: 15,
    });
    expect(workflowRepository.update).toHaveBeenCalledWith('workflow-1', {
      state: ShiftEndWorkflowState.OVERTIME_PENDING,
      overtimeRequestId: 'overtime-1',
    });
    expect(autoCheckout).not.toHaveBeenCalled();
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('gọi auto-checkout đúng mốc 15 phút', async () => {
    const { service } = createService();
    const autoCheckout = jest.spyOn(service, 'autoCheckout').mockResolvedValue(true);
    await service.handleReminderJob({
      assignmentId: 'assignment-1',
      expectedEndAt: workflow.effectiveEndAt.toISOString(),
      reminderMinute: 15,
    });
    expect(autoCheckout).toHaveBeenCalledWith('assignment-1', workflow.effectiveEndAt);
  });
});

describe('ShiftEndWorkflowService — overtime never blocks closing forever (R5)', () => {
  const END = new Date('2026-07-12T10:00:00.000Z'); // 17:00 VN
  const open = () =>
    ({
      id: 'assignment-1',
      shiftSlotId: 'slot-1',
      employeeId: 'employee-1',
      checkInTime: new Date('2026-07-12T01:00:00.000Z'),
      checkOutTime: null,
      status: ShiftAssignmentStatus.CONFIRMED,
      shiftSlot: {
        workDate: '2026-07-12',
        startTime: '08:00:00',
        endTime: '17:00:00',
        cycle: { storeId: 'store-1' },
      },
      employee: { accountId: 'account-1', reminderSettings: null },
    }) as any;

  function build(overtime: any[]) {
    const updates: any[] = [];
    const qb: any = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn((values: any) => {
        updates.push(values);
        return qb;
      }),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const manager: any = {
      findOne: jest.fn().mockResolvedValue(open()),
      find: jest.fn().mockResolvedValue(overtime),
      createQueryBuilder: jest.fn(() => qb),
      save: jest.fn().mockResolvedValue({}),
      create: jest.fn((_e: any, v: any) => v),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const dataSource: any = {
      transaction: jest.fn((cb: any) => cb(manager)),
    };
    const notificationsService: any = { create: jest.fn().mockResolvedValue({}) };
    const service = new ShiftEndWorkflowService(
      { update: jest.fn(), findOne: jest.fn() } as any,
      { find: jest.fn(), findOne: jest.fn() } as any,
      { findOne: jest.fn() } as any,
      { update: jest.fn().mockResolvedValue({}) } as any,
      {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((v: any) => v),
        save: jest.fn().mockResolvedValue({}),
      } as any,
      dataSource,
      notificationsService,
      { add: jest.fn() } as any,
      { add: jest.fn().mockResolvedValue({}) } as any,
    );
    return { service, updates, notificationsService, manager };
  }

  const approved = {
    id: 'ot-1',
    status: BonusWorkRequestStatus.APPROVED,
    requestDate: '2026-07-12',
    endTime: '19:00:00', // 12:00Z
  };

  it('closes a shift with APPROVED overtime at the approved end + grace, as FORGOT_CHECKOUT', async () => {
    const otEnd = new Date('2026-07-12T12:00:00.000Z');
    const early = build([approved]);
    // 19:10 VN: inside the grace, still open.
    await expect(
      early.service.autoCheckout('assignment-1', otEnd, {
        now: new Date('2026-07-12T12:10:00.000Z'),
      }),
    ).resolves.toBe(false);

    const due = build([approved]);
    await expect(
      due.service.autoCheckout('assignment-1', otEnd, {
        now: new Date('2026-07-12T12:15:00.000Z'),
      }),
    ).resolves.toBe(true);
    expect(due.updates[0]).toMatchObject({
      attendanceStatus: 'FORGOT_CHECKOUT',
      status: ShiftAssignmentStatus.COMPLETED,
      isAutoCheckout: true,
      scheduledCheckoutTime: otEnd,
      // 08:00 → 19:00 VN, overtime included.
      workedMinutes: 660,
    });
  });

  it('an APPROVED overtime still blocks an early call made with the original end', async () => {
    const { service } = build([approved]);
    await expect(
      service.autoCheckout('assignment-1', END, {
        now: new Date('2026-07-12T10:20:00.000Z'),
      }),
    ).resolves.toBe(false);
  });

  it('a PENDING overtime blocks unless its timeout is due, then pays to the scheduled end', async () => {
    const pending = {
      id: 'ot-2',
      status: BonusWorkRequestStatus.PENDING,
      requestDate: '2026-07-12',
      endTime: '19:00:00',
    };
    const blocked = build([pending]);
    await expect(blocked.service.autoCheckout('assignment-1', END)).resolves.toBe(false);

    const due = build([pending]);
    await expect(
      due.service.autoCheckout('assignment-1', END, { pendingOvertimeDue: true }),
    ).resolves.toBe(true);
    expect(due.updates[0]).toMatchObject({
      attendanceStatus: 'FORGOT_CHECKOUT',
      scheduledCheckoutTime: END,
      workedMinutes: 540,
    });
  });

  it('a timed-out PENDING overtime is cancelled with a note in the auto-close transaction (m4)', async () => {
    const pending = {
      id: 'ot-2',
      status: BonusWorkRequestStatus.PENDING,
      requestDate: '2026-07-12',
      endTime: '19:00:00',
    };
    const blocked = build([pending]);
    await blocked.service.autoCheckout('assignment-1', END);
    expect(blocked.manager.update).not.toHaveBeenCalledWith(
      BonusWorkRequest,
      expect.anything(),
      expect.anything(),
    );

    const due = build([pending]);
    await due.service.autoCheckout('assignment-1', END, { pendingOvertimeDue: true });
    expect(due.manager.update).toHaveBeenCalledWith(
      BonusWorkRequest,
      { id: In(['ot-2']), status: BonusWorkRequestStatus.PENDING },
      {
        status: BonusWorkRequestStatus.CANCELLED,
        rejectionReason: PENDING_OVERTIME_EXPIRED_NOTE,
      },
    );

    // Not touched when the close itself lost the race.
    const lost = build([pending]);
    lost.manager.createQueryBuilder().execute.mockResolvedValue({ affected: 0 });
    await expect(
      lost.service.autoCheckout('assignment-1', END, { pendingOvertimeDue: true }),
    ).resolves.toBe(false);
    expect(lost.manager.update).not.toHaveBeenCalled();
  });

  it('pendingOvertimeAutoCheckoutAt: later of shift end and requested end, plus grace', () => {
    const {
      pendingOvertimeAutoCheckoutAt,
    } = jest.requireActual('./shift-end-workflow.service');
    expect(
      pendingOvertimeAutoCheckoutAt(END, { requestDate: '2026-07-12', endTime: '19:00:00' }).toISOString(),
    ).toBe('2026-07-12T12:15:00.000Z');
    expect(pendingOvertimeAutoCheckoutAt(END, null).toISOString()).toBe(
      '2026-07-12T10:15:00.000Z',
    );
    // Overtime past midnight (end clock before the shift end) is the next day.
    expect(
      pendingOvertimeAutoCheckoutAt(END, { requestDate: '2026-07-12', endTime: '01:00:00' }).toISOString(),
    ).toBe('2026-07-12T18:15:00.000Z');
  });
});

describe('ShiftEndWorkflowService.reconcileActiveAssignments (R5)', () => {
  afterEach(() => jest.useRealTimers());

  const build = (workflow: any, request: any = null) => {
    const service = new ShiftEndWorkflowService(
      { findOne: jest.fn().mockResolvedValue(workflow) } as any,
      { find: jest.fn().mockResolvedValue([{ id: 'assignment-1' }]) } as any,
      { findOne: jest.fn().mockResolvedValue(request) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { add: jest.fn() } as any,
      { add: jest.fn() } as any,
    );
    jest.spyOn(service, 'scheduleForAssignment').mockResolvedValue();
    const autoCheckout = jest.spyOn(service, 'autoCheckout').mockResolvedValue(true);
    return { service, autoCheckout };
  };
  const end = new Date('2026-07-12T12:00:00.000Z');

  it('auto-checks-out an OVERTIME_APPROVED shift once its end + 15 min passed', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-12T12:15:00.000Z'));
    const { service, autoCheckout } = build({
      shiftAssignmentId: 'assignment-1',
      effectiveEndAt: end,
      state: ShiftEndWorkflowState.OVERTIME_APPROVED,
    });
    await service.reconcileActiveAssignments();
    expect(autoCheckout).toHaveBeenCalledWith('assignment-1', end);
  });

  it('waits for the pending overtime timeout, then closes with pendingOvertimeDue', async () => {
    const workflow = {
      shiftAssignmentId: 'assignment-1',
      effectiveEndAt: new Date('2026-07-12T10:00:00.000Z'),
      state: ShiftEndWorkflowState.OVERTIME_PENDING,
      overtimeRequestId: 'ot-2',
    };
    const request = { id: 'ot-2', requestDate: '2026-07-12', endTime: '19:00:00' };
    jest.useFakeTimers().setSystemTime(new Date('2026-07-12T12:14:00.000Z'));
    const early = build(workflow, request);
    await early.service.reconcileActiveAssignments();
    expect(early.autoCheckout).not.toHaveBeenCalled();

    jest.setSystemTime(new Date('2026-07-12T12:15:00.000Z'));
    const due = build(workflow, request);
    await due.service.reconcileActiveAssignments();
    expect(due.autoCheckout).toHaveBeenCalledWith(
      'assignment-1',
      workflow.effectiveEndAt,
      { pendingOvertimeDue: true },
    );
  });
});

describe('ShiftEndWorkflowService — end-of-shift reminders carry the date (R5)', () => {
  afterEach(() => jest.useRealTimers());

  it.each([0, 5, 10] as const)('+%i reminder says "hôm nay (dd/mm)" and stores workDates', async (minute) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-12T10:01:00.000Z'));
    const workflow = {
      id: 'workflow-1',
      shiftAssignmentId: 'assignment-1',
      effectiveEndAt: new Date('2026-07-12T10:00:00.000Z'),
      state: ShiftEndWorkflowState.ACTIVE,
    };
    const qb: any = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const notificationsService: any = { create: jest.fn().mockResolvedValue({}) };
    const service = new ShiftEndWorkflowService(
      {
        findOne: jest.fn().mockResolvedValue(workflow),
        createQueryBuilder: jest.fn(() => qb),
      } as any,
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'assignment-1',
          shiftSlotId: 'slot-1',
          checkInTime: new Date('2026-07-12T01:00:00.000Z'),
          checkOutTime: null,
          status: ShiftAssignmentStatus.CONFIRMED,
          shiftSlot: {
            workDate: '2026-07-12',
            cycle: { storeId: 'store-1' },
            workShift: { startTime: '08:00:00', endTime: '17:00:00' },
          },
          employee: { accountId: 'account-1' },
        }),
      } as any,
      { findOne: jest.fn().mockResolvedValue(null) } as any,
      {} as any,
      {} as any,
      {} as any,
      notificationsService,
      { add: jest.fn() } as any,
      { add: jest.fn() } as any,
    );
    await service.handleReminderJob({
      assignmentId: 'assignment-1',
      expectedEndAt: workflow.effectiveEndAt.toISOString(),
      reminderMinute: minute,
    });
    const [payload] = notificationsService.create.mock.calls[0];
    expect(payload.content).toContain('Ca 08:00-17:00 hôm nay (12/07)');
    expect(payload.actionUrl).toBe('/');
    expect(payload.metadata).toMatchObject({
      workDate: '2026-07-12',
      workDates: ['2026-07-12'],
      defaultRoute: '/',
    });
  });
});
