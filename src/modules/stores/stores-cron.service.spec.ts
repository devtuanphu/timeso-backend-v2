import { STARTUP_REMINDER_RECONCILE_DELAY_MS, StoresCronService } from './stores-cron.service';

describe('StoresCronService read-only guards', () => {
  it('returns from every cron handler before locks, queries, or workflows', async () => {
    const storesService = {
      createDailyReportsForAllStores: jest.fn(),
      createMonthlyPayrollsForAllStores: jest.fn(),
      createMonthlySummariesForAllEmployees: jest.fn(),
      processExpiredCycles: jest.fn(),
      generateDailySlotsForAllCycles: jest.fn(),
      generateDailySlotsForIndefiniteCycles: jest.fn(),
      detectEndOfDayAttendanceIssues: jest.fn(),
    };
    const lockService = { withLock: jest.fn() };
    const shiftEndWorkflowService = { reconcileActiveAssignments: jest.fn() };
    const jobApplicationService = { redactStaleContactDetails: jest.fn() };
    const careerLadderService = { sweepEligibleEmployees: jest.fn() };
    const service = new StoresCronService(
      storesService as any,
      lockService as any,
      shiftEndWorkflowService as any,
      jobApplicationService as any,
      careerLadderService as any,
      { get: jest.fn().mockReturnValue('true') } as any,
    );

    await Promise.all([
      service.handleReconcileShiftEndWorkflows(),
      service.handleRedactStaleJobApplications(),
      service.handleCreateDailyReports(),
      service.handleCreateMonthlyPayrolls(),
      service.handleCreateMonthlySummaries(),
      service.handleProcessExpiredCycles(),
      service.handleGenerateDailySlots(),
      service.handleGenerateSlotsForIndefiniteCycles(),
      service.handleDetectAttendanceIssues(),
    ]);

    expect(lockService.withLock).not.toHaveBeenCalled();

    expect(jobApplicationService.redactStaleContactDetails).not.toHaveBeenCalled();
    expect(shiftEndWorkflowService.reconcileActiveAssignments).not.toHaveBeenCalled();
    Object.values(storesService).forEach((operation) => {
      expect(operation).not.toHaveBeenCalled();
    });
  });
});

describe('StoresCronService shift-end reconcile isolation', () => {
  const build = (shiftEndWorkflowService: Record<string, jest.Mock>) => {
    const lockService = {
      withLock: jest.fn(async (_key: string, _ttl: number, fn: () => any) => ({
        ran: true,
        result: await fn(),
      })),
    };
    const service = new StoresCronService(
      {} as any,
      lockService as any,
      shiftEndWorkflowService as any,
      {} as any,
      {} as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
    );
    (service as any).logger = { warn: jest.fn(), log: jest.fn() };
    return service;
  };

  it('still reconciles unstarted shifts when the active reconcile throws', async () => {
    const workflows = {
      reconcileActiveAssignments: jest.fn().mockRejectedValue(new Error('boom')),
      reconcileUnstartedAssignments: jest.fn().mockResolvedValue({}),
    };
    const service = build(workflows);
    await expect(service.handleReconcileShiftEndWorkflows()).resolves.toBeUndefined();
    expect(workflows.reconcileUnstartedAssignments).toHaveBeenCalledTimes(1);
    expect((service as any).logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('reconcileActiveAssignments failed'),
    );
  });

  it('a failing unstarted reconcile does not reject the cron tick', async () => {
    const workflows = {
      reconcileActiveAssignments: jest.fn().mockResolvedValue(0),
      reconcileUnstartedAssignments: jest.fn().mockRejectedValue(new Error('x')),
    };
    const service = build(workflows);
    await expect(service.handleReconcileShiftEndWorkflows()).resolves.toBeUndefined();
    expect(workflows.reconcileActiveAssignments).toHaveBeenCalledTimes(1);
  });
});

describe('StoresCronService upcoming reminder reconcile (R5)', () => {
  afterEach(() => jest.useRealTimers());

  const build = (readOnly = false) => {
    const lockService = {
      withLock: jest.fn(async (_key: string, _ttl: number, fn: () => any) => ({
        ran: true,
        result: await fn(),
      })),
    };
    const reminders = {
      reconcileUpcomingReminders: jest.fn().mockResolvedValue({ candidates: 3 }),
    };
    const service = new StoresCronService(
      {} as any,
      lockService as any,
      {} as any,
      {} as any,
      {} as any,
      { get: jest.fn().mockReturnValue(readOnly ? 'true' : undefined) } as any,
      reminders as any,
    );
    (service as any).logger = { warn: jest.fn(), log: jest.fn() };
    return { service, lockService, reminders };
  };

  it('runs hourly (minute 55, VN time) under a distributed lock', async () => {
    const { Reflector } = jest.requireActual('@nestjs/core');
    const { SCHEDULE_CRON_OPTIONS } = jest.requireActual(
      '@nestjs/schedule/dist/schedule.constants',
    );
    const handler = Object.getOwnPropertyDescriptor(
      StoresCronService.prototype,
      'handleBackfillDefaultShiftReminders',
    )?.value as object;
    const options = new Reflector().get(SCHEDULE_CRON_OPTIONS, handler);
    expect(options).toMatchObject({
      cronTime: '55 * * * *',
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    const { service, lockService, reminders } = build();
    await service.handleBackfillDefaultShiftReminders();
    expect(lockService.withLock).toHaveBeenCalledWith(
      'cron:backfill-default-shift-reminders',
      600,
      expect.any(Function),
    );
    expect(reminders.reconcileUpcomingReminders).toHaveBeenCalledTimes(1);
  });

  it('runs once shortly after start-up, and never in read-only mode', async () => {
    jest.useFakeTimers();
    const { service, reminders } = build();
    service.onApplicationBootstrap();
    expect(reminders.reconcileUpcomingReminders).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(STARTUP_REMINDER_RECONCILE_DELAY_MS);
    expect(reminders.reconcileUpcomingReminders).toHaveBeenCalledTimes(1);

    const readOnly = build(true);
    readOnly.service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(STARTUP_REMINDER_RECONCILE_DELAY_MS);
    expect(readOnly.reminders.reconcileUpcomingReminders).not.toHaveBeenCalled();

    const stopped = build();
    stopped.service.onApplicationBootstrap();
    stopped.service.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(STARTUP_REMINDER_RECONCILE_DELAY_MS);
    expect(stopped.reminders.reconcileUpcomingReminders).not.toHaveBeenCalled();
  });
});
