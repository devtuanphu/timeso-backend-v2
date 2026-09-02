jest.mock('../../common/utils/multer-config', () => ({
  attendanceMulterConfig: {},
  multerConfig: {},
}));

import { StoresController } from './stores.controller';

describe('StoresController owner report forwarding', () => {
  const storesService = {
    getPayrollSummary: jest.fn(),
    getDailyReportByDateForOwner: jest.fn(),
    getRevenueReport: jest.fn(),
    getHomeRevenueSummary: jest.fn(),
    getShiftRegistrations: jest.fn(),
    getShiftChangeRequestsByStore: jest.fn(),
    getShiftChangeRequestsByEmployee: jest.fn(),
    createShiftChangeRequest: jest.fn(),
    approveShiftChangeRequest: jest.fn(),
    rejectShiftChangeRequest: jest.fn(),
    getEmployeeByAccountId: jest.fn(),
    cancelShiftChangeRequest: jest.fn(),
    getApprovalStats: jest.fn(),
  };
  const controller = new StoresController(
    storesService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forwards the authenticated owner to both shift-registration route handlers', async () => {
    storesService.getShiftRegistrations.mockResolvedValueOnce([]);

    await controller.getShiftRegistrationsEarly('store-1', undefined, 'PENDING', {
      userId: 'owner-1',
    });
    await controller.getShiftRegistrations('store-1', undefined, 'PENDING', {
      userId: 'owner-1',
    });

    expect(storesService.getShiftRegistrations).toHaveBeenNthCalledWith(
      1,
      { storeId: 'store-1', employeeProfileId: undefined, status: 'PENDING' },
      'owner-1',
    );
    expect(storesService.getShiftRegistrations).toHaveBeenNthCalledWith(
      2,
      { storeId: 'store-1', employeeProfileId: undefined, status: 'PENDING' },
      'owner-1',
    );
  });

  it('forwards owner and employee scope for shift-change request reads', async () => {
    storesService.getShiftChangeRequestsByStore.mockResolvedValueOnce([]);
    storesService.getShiftChangeRequestsByEmployee.mockResolvedValueOnce([]);

    await controller.getShiftChangeRequests(
      { storeId: 'store-1', status: 'PENDING' } as any,
      { userId: 'owner-1' },
    );
    await controller.getShiftChangeRequests(
      {
        storeId: 'store-1',
        employeeProfileId: 'employee-1',
        status: 'PENDING',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      } as any,
      { userId: 'staff-1' },
    );

    expect(storesService.getShiftChangeRequestsByStore).toHaveBeenCalledWith(
      'store-1',
      'PENDING',
      'owner-1',
      { page: undefined, limit: undefined, startDate: undefined, endDate: undefined },
    );
    expect(storesService.getShiftChangeRequestsByEmployee).toHaveBeenCalledWith(
      'employee-1',
      'staff-1',
      'store-1',
      { status: 'PENDING', startDate: '2026-08-01', endDate: '2026-08-31' },
    );
  });

  it('forwards JWT accounts to shift-change writes and approval statistics', async () => {
    storesService.createShiftChangeRequest.mockResolvedValue({});
    storesService.approveShiftChangeRequest.mockResolvedValue({});
    storesService.rejectShiftChangeRequest.mockResolvedValue({});
    storesService.getApprovalStats.mockResolvedValue({});
    const body = { storeId: 'store-1', employeeProfileId: 'employee-1' };

    await controller.createShiftChangeRequest(body as any, { userId: 'staff-1' });
    await controller.approveShiftChangeRequest('request-1', { userId: 'owner-1' });
    await controller.rejectShiftChangeRequest('request-1', { userId: 'owner-1' }, { reason: 'Không phù hợp' });
    await controller.getApprovalStats('store-1', { userId: 'owner-1' });

    expect(storesService.createShiftChangeRequest).toHaveBeenCalledWith(body, 'staff-1');
    expect(storesService.approveShiftChangeRequest).toHaveBeenCalledWith('request-1', 'owner-1');
    expect(storesService.rejectShiftChangeRequest).toHaveBeenCalledWith(
      'request-1',
      'owner-1',
      'Không phù hợp',
    );
    expect(storesService.getApprovalStats).toHaveBeenCalledWith('store-1', 'owner-1');
  });

  it('uses the JWT userId or legacy id when cancelling a shift-change request', async () => {
    storesService.getEmployeeByAccountId.mockResolvedValue({ id: 'employee-1' });
    storesService.cancelShiftChangeRequest.mockResolvedValue({});

    await controller.cancelShiftChangeRequest('request-1', { id: 'staff-1' });

    expect(storesService.getEmployeeByAccountId).toHaveBeenCalledWith('staff-1');
    expect(storesService.cancelShiftChangeRequest).toHaveBeenCalledWith(
      'request-1',
      'employee-1',
    );
  });

  it('forwards the authenticated owner to payroll summary', async () => {
    storesService.getPayrollSummary.mockResolvedValueOnce({});

    await controller.getPayrollSummary('store-1', '07/2026', {
      userId: 'owner-1',
    });

    expect(storesService.getPayrollSummary).toHaveBeenCalledWith(
      'store-1',
      '07/2026',
      'owner-1',
    );
  });

  it('forwards a validated raw daily date and owner id', async () => {
    storesService.getDailyReportByDateForOwner.mockResolvedValueOnce({
      id: 'report-1',
    });

    await controller.getDailyReportByDate('store-1', '2026-07-22', {
      userId: 'owner-1',
    });

    expect(storesService.getDailyReportByDateForOwner).toHaveBeenCalledWith(
      'store-1',
      '2026-07-22',
      'owner-1',
    );
  });

  it('forwards legacy revenue dates and the authenticated account id', async () => {
    storesService.getRevenueReport.mockResolvedValueOnce({});

    await controller.getRevenueReport('store-1', '2026-07-22', '2026-07-22', {
      userId: 'staff-1',
    });

    expect(storesService.getRevenueReport).toHaveBeenCalledWith(
      'store-1',
      new Date('2026-07-22'),
      new Date('2026-07-22'),
      'staff-1',
    );
  });

  it('forwards HCM half-open Home revenue bounds and owner id', async () => {
    storesService.getHomeRevenueSummary.mockResolvedValueOnce({});

    await controller.getHomeRevenueSummary('store-1', '2026-07-22', '2026-07-22', {
      userId: 'owner-1',
    });

    expect(storesService.getHomeRevenueSummary).toHaveBeenCalledWith(
      'store-1',
      new Date('2026-07-21T17:00:00.000Z'),
      new Date('2026-07-22T17:00:00.000Z'),
      'owner-1',
    );
  });
});
