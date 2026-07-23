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
