import { StoresCronService } from './stores-cron.service';

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
