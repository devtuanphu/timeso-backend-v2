/**
 * Per-store auto-checkout window ("Cho phép check-out sau giờ làm"): reminders
 * and the automatic check-out follow the store's lateCheckoutMinutes instead
 * of a fixed 15 minutes, jobs queued under the old fixed time still work, and
 * auto-checkout worked time follows the store's late-arrival credit.
 */
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { NotificationsService } from '../notifications/notifications.service';
import { ShiftEndWorkflowService } from './shift-end-workflow.service';
import {
  BonusWorkRequest,
  BonusWorkRequestStatus,
} from './entities/bonus-work-request.entity';
import { DailyEmployeeReport } from './entities/daily-employee-report.entity';
import { EmployeeProfile } from './entities/employee-profile.entity';
import {
  ShiftEndWorkflow,
  ShiftEndWorkflowState,
} from './entities/shift-end-workflow.entity';
import {
  ShiftAssignment,
  ShiftAssignmentStatus,
} from './entities/shift-management.entity';
import { StoreTimekeepingSetting } from './entities/store-timekeeping-setting.entity';

// Shift 08:00–17:00 VN on 2026-07-12: ends 10:00 UTC.
const END = new Date('2026-07-12T10:00:00.000Z');
const plus = (minutes: number) => new Date(END.getTime() + minutes * 60_000);

const assignment = (over: Record<string, unknown> = {}) => ({
  id: 'assignment-1',
  employeeId: 'employee-1',
  checkInTime: new Date('2026-07-12T01:00:00.000Z'),
  checkOutTime: null,
  lateMinutes: 0,
  status: ShiftAssignmentStatus.CONFIRMED,
  shiftSlot: {
    workDate: '2026-07-12',
    startTime: null,
    endTime: null,
    workShift: { startTime: '08:00:00', endTime: '17:00:00' },
    cycle: { storeId: 'store-1' },
  },
  employee: { accountId: 'account-1' },
  ...over,
});

function build(opts: {
  lateCheckoutMinutes?: number | null;
  setting?: Record<string, unknown>;
  workflow?: Record<string, unknown>;
  assignment?: Record<string, unknown>;
  overtime?: any;
  workedTimeRules?: unknown[];
}) {
  const workflowQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const attendanceQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const workflow = {
    id: 'workflow-1',
    shiftAssignmentId: 'assignment-1',
    scheduledEndAt: END,
    effectiveEndAt: END,
    state: ShiftEndWorkflowState.ACTIVE,
    ...opts.workflow,
  };
  const markerBuilder: any = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const workflowRepository: any = {
    findOne: jest.fn().mockResolvedValue(workflow),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    save: jest.fn().mockResolvedValue(workflow),
    create: jest.fn((value: unknown) => value),
    createQueryBuilder: jest.fn(() => markerBuilder),
  };
  const row = assignment(opts.assignment);
  const assignmentRepository: any = {
    findOne: jest.fn().mockResolvedValue(row),
    find: jest.fn().mockResolvedValue([row]),
  };
  const bonusWorkRepository: any = {
    findOne: jest.fn().mockResolvedValue(opts.overtime ?? null),
  };
  const notificationsService: any = { create: jest.fn().mockResolvedValue({}) };
  const setting =
    opts.setting ??
    (opts.lateCheckoutMinutes === undefined
      ? null
      : { lateCheckoutMinutes: opts.lateCheckoutMinutes });
  const timekeepingSettingRepository: any = {
    findOne: jest.fn().mockResolvedValue(setting),
  };
  // Transaction for autoCheckout.
  const written: any[] = [];
  const closeBuilder: any = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn((values: unknown) => {
      written.push(values);
      return closeBuilder;
    }),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  // Worked-time rules are read on the auto-checkout transaction.
  const rulesOnManager = {
    find: jest.fn().mockResolvedValue(opts.workedTimeRules ?? []),
  };
  const manager: any = {
    getRepository: jest.fn(() => rulesOnManager),
    findOne: jest.fn().mockResolvedValue(row),
    find: jest.fn().mockResolvedValue(opts.overtime ? [opts.overtime] : []),
    createQueryBuilder: jest.fn(() => closeBuilder),
    create: jest.fn((_entity: unknown, value: unknown) => value),
    save: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const dataSource: any = { transaction: jest.fn(async (cb: any) => cb(manager)) };
  const service = new ShiftEndWorkflowService(
    workflowRepository,
    assignmentRepository,
    bonusWorkRepository,
    { update: jest.fn().mockResolvedValue({}) } as any,
    {} as any,
    dataSource,
    notificationsService,
    workflowQueue as any,
    attendanceQueue as any,
    undefined,
    timekeepingSettingRepository,
    { find: jest.fn().mockResolvedValue(opts.workedTimeRules ?? []) } as any,
  );
  jest
    .spyOn(service as any, 'appendForgotCheckout')
    .mockResolvedValue(undefined);
  const jobIds = () =>
    workflowQueue.add.mock.calls.map((call: any[]) => call[2].jobId as string);
  const autoJob = () =>
    workflowQueue.add.mock.calls.find((call: any[]) =>
      String(call[2].jobId).includes('-auto-'),
    );
  return {
    service,
    workflowQueue,
    notificationsService,
    jobIds,
    autoJob,
    written,
    rulesOnManager,
  };
}

describe('per-store auto-checkout window', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: END,
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
  });
  afterEach(() => jest.useRealTimers());

  it('closes at the store window (30 min) with reminders at +0/+5/+10', async () => {
    const { service, jobIds, autoJob } = build({ lateCheckoutMinutes: 30 });

    await service.scheduleForAssignment('assignment-1');

    const base = `shift-end-assignment-1-${END.getTime()}`;
    expect(jobIds()).toEqual([
      `${base}-0`,
      `${base}-5`,
      `${base}-10`,
      `${base}-auto-${plus(30).getTime()}`,
    ]);
    expect(autoJob()![1]).toMatchObject({ reminderMinute: 15 });
    expect(autoJob()![2].delay).toBe(30 * 60_000);
  });

  it('keeps the 15-minute close without a settings row', async () => {
    const { service, jobIds, autoJob } = build({});

    await service.scheduleForAssignment('assignment-1');

    expect(jobIds()).toHaveLength(4);
    expect(autoJob()![2].delay).toBe(15 * 60_000);
  });

  it('drops reminders the window no longer reaches (5 min)', async () => {
    const { service, jobIds, autoJob } = build({ lateCheckoutMinutes: 5 });

    await service.scheduleForAssignment('assignment-1');

    expect(jobIds()).toHaveLength(2);
    expect(jobIds()[0]).toMatch(/-0$/);
    expect(autoJob()![2].delay).toBe(5 * 60_000);
  });

  it('closes at the shift end with a 0-minute window, no reminders', async () => {
    const { service, jobIds, autoJob } = build({ lateCheckoutMinutes: 0 });

    await service.scheduleForAssignment('assignment-1');

    expect(jobIds()).toHaveLength(1);
    expect(autoJob()![2].delay).toBe(0);
  });

  it('re-queues an old fixed 15-minute job until the wider window closes', async () => {
    jest.setSystemTime(plus(15));
    const { service, autoJob } = build({ lateCheckoutMinutes: 30 });
    const autoCheckout = jest.spyOn(service, 'autoCheckout');

    await service.handleReminderJob({
      assignmentId: 'assignment-1',
      expectedEndAt: END.toISOString(),
      reminderMinute: 15,
    });

    expect(autoCheckout).not.toHaveBeenCalled();
    expect(autoJob()![2].jobId).toBe(
      `shift-end-assignment-1-${END.getTime()}-auto-${plus(30).getTime()}`,
    );
    expect(autoJob()![2].delay).toBe(15 * 60_000);
  });

  it('closes when the auto job runs at the window end', async () => {
    jest.setSystemTime(plus(30));
    const { service, written } = build({ lateCheckoutMinutes: 30 });

    await service.handleReminderJob({
      assignmentId: 'assignment-1',
      expectedEndAt: END.toISOString(),
      reminderMinute: 15,
    });

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ isAutoCheckout: true });
  });

  it('skips a reminder past a window the owner narrowed', async () => {
    jest.setSystemTime(plus(10));
    const { service, notificationsService } = build({ lateCheckoutMinutes: 5 });
    const autoCheckout = jest.spyOn(service, 'autoCheckout');

    await service.handleReminderJob({
      assignmentId: 'assignment-1',
      expectedEndAt: END.toISOString(),
      reminderMinute: 10,
    });

    expect(notificationsService.create).not.toHaveBeenCalled();
    expect(autoCheckout).not.toHaveBeenCalled();
  });

  it('schedules approved overtime with the store window', async () => {
    const { service, autoJob } = build({ lateCheckoutMinutes: 30 });

    await service.approveOvertime({
      id: 'overtime-1',
      shiftAssignmentId: 'assignment-1',
      storeId: 'store-1',
      requestDate: '2026-07-12',
      endTime: '19:00:00',
    } as any);

    const overtimeEnd = new Date('2026-07-12T12:00:00.000Z');
    expect(autoJob()![2].jobId).toBe(
      `shift-end-assignment-1-${overtimeEnd.getTime()}-auto-${
        overtimeEnd.getTime() + 30 * 60_000
      }`,
    );
  });

  it('does not close approved overtime before its end + store window', async () => {
    jest.setSystemTime(new Date('2026-07-12T12:20:00.000Z')); // overtime end + 20
    const overtime = {
      id: 'overtime-1',
      status: BonusWorkRequestStatus.APPROVED,
      requestDate: '2026-07-12',
      endTime: '19:00:00',
    };
    const { service, written } = build({ lateCheckoutMinutes: 30, overtime });

    expect(await service.autoCheckout('assignment-1', END)).toBe(false);
    expect(written).toHaveLength(0);
  });

  it('schedules the end after a resumed overtime with the store window', async () => {
    const { service, autoJob } = build({ lateCheckoutMinutes: 30 });

    await service.resumeAfterOvertime({
      id: 'overtime-1',
      shiftAssignmentId: 'assignment-1',
      storeId: 'store-1',
    } as any);

    expect(autoJob()![2].delay).toBe(30 * 60_000);
  });

  describe('reconcile', () => {
    it('does not close at +15 when the store allows 30 minutes', async () => {
      jest.setSystemTime(plus(15));
      const { service } = build({ lateCheckoutMinutes: 30 });
      const autoCheckout = jest.spyOn(service, 'autoCheckout');

      await service.reconcileActiveAssignments();

      expect(autoCheckout).not.toHaveBeenCalled();
    });

    it('closes a pending overtime at its requested end + the store window', async () => {
      const request = {
        id: 'overtime-1',
        status: BonusWorkRequestStatus.PENDING,
        requestDate: '2026-07-12',
        endTime: '18:00:00', // 11:00 UTC
      };
      const workflow = {
        state: ShiftEndWorkflowState.OVERTIME_PENDING,
        overtimeRequestId: 'overtime-1',
      };
      jest.setSystemTime(new Date('2026-07-12T11:20:00.000Z'));
      const early = build({ lateCheckoutMinutes: 30, workflow, overtime: request });
      const earlyClose = jest.spyOn(early.service, 'autoCheckout').mockResolvedValue(true);
      await early.service.reconcileActiveAssignments();
      expect(earlyClose).not.toHaveBeenCalled();

      jest.setSystemTime(new Date('2026-07-12T11:30:00.000Z'));
      const due = build({ lateCheckoutMinutes: 30, workflow, overtime: request });
      const dueClose = jest.spyOn(due.service, 'autoCheckout').mockResolvedValue(true);
      await due.service.reconcileActiveAssignments();
      expect(dueClose).toHaveBeenCalledWith(
        'assignment-1',
        END,
        expect.objectContaining({ pendingOvertimeDue: true }),
      );
    });

    it('closes at +30 when the store allows 30 minutes', async () => {
      jest.setSystemTime(plus(30));
      const { service, written } = build({ lateCheckoutMinutes: 30 });

      await service.reconcileActiveAssignments();

      expect(written).toHaveLength(1);
    });
  });
});

describe('auto-checkout worked time', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: plus(15),
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
  });
  afterEach(() => jest.useRealTimers());

  it('counts from the shift start when the late arrival was forgiven', async () => {
    // Checked in 08:07 VN (late 7, forgiven by a 10-minute grace).
    const { service, written } = build({
      setting: { allowedLateMinutes: 10 },
      assignment: {
        checkInTime: new Date('2026-07-12T01:07:00.000Z'),
        lateMinutes: 0,
      },
    });

    await service.autoCheckout('assignment-1', END);

    expect(written[0]).toMatchObject({ workedMinutes: 540 });
  });

  it('pays to the shift end when overtime was rejected after it ended', async () => {
    // Rejected after the end: the workflow moved the close to later, but
    // nothing after 17:00 VN (END) is approved.
    jest.setSystemTime(plus(40));
    const { service, written } = build({ setting: null as any });

    await service.autoCheckout('assignment-1', plus(20));

    expect(written[0]).toMatchObject({ workedMinutes: 540 });
  });

  it('pays approved overtime up to its end', async () => {
    jest.setSystemTime(new Date('2026-07-12T11:20:00.000Z')); // overtime end + 20
    const overtime = {
      id: 'overtime-1',
      status: BonusWorkRequestStatus.APPROVED,
      requestDate: '2026-07-12',
      endTime: '18:00:00', // 11:00 UTC
    };
    const { service, written } = build({ setting: null as any, overtime });

    await service.autoCheckout('assignment-1', new Date('2026-07-12T11:00:00.000Z'));

    expect(written[0]).toMatchObject({ workedMinutes: 600 });
  });

  it('counts from the check-in when the late arrival was recorded', async () => {
    const { service, written } = build({
      setting: null as any,
      assignment: {
        checkInTime: new Date('2026-07-12T01:07:00.000Z'),
        lateMinutes: 7,
      },
    });

    await service.autoCheckout('assignment-1', END);

    expect(written[0]).toMatchObject({ workedMinutes: 533 });
  });
});

describe('ShiftEndWorkflowService dependency injection', () => {
  it('receives the store timekeeping settings repository from Nest', async () => {
    const settings = { findOne: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ShiftEndWorkflowService,
        ...[
          ShiftEndWorkflow,
          ShiftAssignment,
          BonusWorkRequest,
          EmployeeProfile,
          DailyEmployeeReport,
        ].map((entity) => ({ provide: getRepositoryToken(entity), useValue: {} })),
        { provide: getRepositoryToken(StoreTimekeepingSetting), useValue: settings },
        { provide: DataSource, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: getQueueToken('shift-end-workflows'), useValue: {} },
        { provide: getQueueToken('attendance-background'), useValue: {} },
      ],
    }).compile();

    const service = moduleRef.get(ShiftEndWorkflowService);
    expect((service as any).timekeepingSettingRepository).toBe(settings);
  });
});

describe('auto-checkout with "Tính theo giờ chấm công"', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: plus(15),
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
  });
  afterEach(() => jest.useRealTimers());

  const actualRule = {
    mode: 'ACTUAL',
    startDate: '2026-07-01',
    endDate: null,
    employeeProfileId: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
  };

  it('pays the early arrival but still stops at the shift end', async () => {
    // Checked in 07:50 VN (10 min early), never checked out; shift ends 17:00.
    const { service, written } = build({
      setting: null as any,
      assignment: { checkInTime: new Date('2026-07-12T00:50:00.000Z'), lateMinutes: 0 },
      workedTimeRules: [actualRule],
    });

    await service.autoCheckout('assignment-1', END);

    expect(written[0]).toMatchObject({ workedMinutes: 550 });
  });

  it('keeps a rule removed after the shift started, reading removed rules', async () => {
    const { service, written, rulesOnManager } = build({
      setting: null as any,
      assignment: { checkInTime: new Date('2026-07-12T00:50:00.000Z'), lateMinutes: 0 },
      // Removed at 09:00 VN, the 08:00 shift was under way.
      workedTimeRules: [{ ...actualRule, deletedAt: new Date('2026-07-12T02:00:00.000Z') }],
    });

    await service.autoCheckout('assignment-1', END);

    expect(written[0]).toMatchObject({ workedMinutes: 550 });
    expect(rulesOnManager.find).toHaveBeenCalledWith({
      where: { storeId: expect.anything() },
      withDeleted: true,
    });
  });

  it('pays from the shift start "theo lịch làm" (default before the release)', async () => {
    const { service, written } = build({
      setting: null as any,
      assignment: { checkInTime: new Date('2026-07-12T00:50:00.000Z'), lateMinutes: 0 },
    });

    await service.autoCheckout('assignment-1', END);

    expect(written[0]).toMatchObject({ workedMinutes: 540 });
  });
});
