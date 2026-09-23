import { StoresService } from './stores.service';
import { AiReportsService } from '../ai-reports/ai-reports.service';
import { currentStintSql } from './employment-stint.utils';
import { PaymentType } from './entities/employee-contract.entity';
import { ShiftAssignmentStatus } from './entities/shift-management.entity';

/**
 * R7 rehire leaks: store-level lists and money views must show only the
 * current employment stint of a rehired employee (one profile row is kept,
 * the stint starts at `joined_at`, 60-second tolerance).
 */
const PROFILE = 'profile-1';
const JOINED = new Date('2026-09-10T03:00:00.000Z');
const FLOOR = '2026-09-10T02:59:00.000Z';
const STINT_SQL = (alias: string, column: string) =>
  `(${alias}.joined_at IS NULL OR ${column} >= ${alias}.joined_at - interval '60 seconds')`;

const isFloor = (operator: any) =>
  operator?.type === 'moreThanOrEqual' &&
  operator.value instanceof Date &&
  operator.value.toISOString() === FLOOR;

const chain = (rows: any[] = []) => {
  const qb: any = {};
  for (const m of [
    'leftJoinAndSelect',
    'leftJoin',
    'innerJoin',
    'select',
    'addSelect',
    'where',
    'andWhere',
    'orderBy',
    'groupBy',
    'addGroupBy',
    'setParameters',
  ]) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getMany = jest.fn().mockResolvedValue(rows);
  qb.getRawMany = jest.fn().mockResolvedValue(rows);
  return qb;
};

describe('currentStintSql', () => {
  it('keeps legacy/unjoined profiles and applies the 60 s tolerance', () => {
    expect(currentStintSql('profile', 'kpi.created_at')).toBe(
      STINT_SQL('profile', 'kpi.created_at'),
    );
  });
});

describe('B. KPI lists — current stint only', () => {
  it('getEmployeeKpis filters every row by its employee joined_at', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.getAccessibleStoreIds = jest.fn().mockResolvedValue(['store-1']);
    const qb = chain([]);
    service.employeeKpiRepository = { createQueryBuilder: jest.fn(() => qb) };
    service.storeRepository = { find: jest.fn().mockResolvedValue([]) };

    await service.getEmployeeKpis({ storeId: 'store-1' }, 'owner-1');

    expect(qb.andWhere).toHaveBeenCalledWith(STINT_SQL('profile', 'kpi.created_at'));
  });

  it('getKpiApprovalRequests hides requests on previous-stint KPIs', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.resolveStoreViewer = jest
      .fn()
      .mockResolvedValue({ isOwner: true, profileId: null });
    const qb = chain([]);
    service.kpiApprovalRequestRepository = { createQueryBuilder: jest.fn(() => qb) };
    service.storeRepository = { find: jest.fn().mockResolvedValue([]) };

    await service.getKpiApprovalRequests('store-1', undefined, 'owner-1');

    expect(qb.andWhere).toHaveBeenCalledWith(STINT_SQL('profile', 'kpi.created_at'));
  });
});

describe('C. salary advance requests — current stint only', () => {
  it('getSalaryAdvanceRequests floors requested_at per employee', async () => {
    const service = Object.create(StoresService.prototype) as any;
    const qb = chain([]);
    service.salaryAdvanceRequestRepository = { createQueryBuilder: jest.fn(() => qb) };

    await service.getSalaryAdvanceRequests({ storeId: 'store-1' });

    expect(qb.andWhere).toHaveBeenCalledWith(
      STINT_SQL('profile', 'request.requested_at'),
    );
  });
});

describe('D. salary history — current stint only', () => {
  const withProfile = (joinedAt: Date | null) => {
    const service = Object.create(StoresService.prototype) as any;
    service.profileRepository = {
      findOne: jest.fn().mockResolvedValue({ id: PROFILE, joinedAt }),
    };
    service.salaryAdjustmentRepository = { find: jest.fn().mockResolvedValue([]) };
    service.employeePaymentHistoryRepository = {
      find: jest.fn().mockResolvedValue([]),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    return service;
  };

  it('getSalaryAdjustments and payment history start at the rehire', async () => {
    const service = withProfile(JOINED);

    await service.getSalaryAdjustments(PROFILE);
    await service.getEmployeeSalaryHistory(PROFILE);

    const adjustWhere = service.salaryAdjustmentRepository.find.mock.calls[0][0].where;
    expect(adjustWhere.employeeProfileId).toBe(PROFILE);
    expect(isFloor(adjustWhere.createdAt)).toBe(true);
    const payWhere =
      service.employeePaymentHistoryRepository.findAndCount.mock.calls[0][0].where;
    expect(payWhere.employeeProfileId).toBe(PROFILE);
    expect(isFloor(payWhere.createdAt)).toBe(true);
  });

  it('legacy profiles are not filtered', async () => {
    const service = withProfile(null);

    await service.getSalaryAdjustments(PROFILE);
    await service.getEmployeeSalaryHistory(PROFILE);

    expect(service.salaryAdjustmentRepository.find.mock.calls[0][0].where).toEqual({
      employeeProfileId: PROFILE,
    });
    expect(
      service.employeePaymentHistoryRepository.findAndCount.mock.calls[0][0].where,
    ).toEqual({ employeeProfileId: PROFILE });
  });

  it('salary overview shows current-stint adjustments and contract', async () => {
    const service = withProfile(JOINED);
    service.profileRepository.findOne = jest.fn().mockResolvedValue({
      id: PROFILE,
      joinedAt: JOINED,
      account: { fullName: 'An' },
      contracts: [
        { id: 'old', isActive: false, salaryAmount: 9, createdAt: new Date('2026-01-01T00:00:00Z') },
        {
          id: 'new',
          isActive: true,
          salaryAmount: 25_000,
          paymentType: PaymentType.HOUR,
          createdAt: new Date('2026-09-10T02:59:59Z'),
        },
      ],
    });
    service.employeeSalaryRepository = { findOne: jest.fn().mockResolvedValue(null) };

    const result = await service.getEmployeeSalaryOverview(PROFILE);

    expect(
      isFloor(service.salaryAdjustmentRepository.find.mock.calls[0][0].where.createdAt),
    ).toBe(true);
    expect(JSON.stringify(result)).toContain('25000');
  });

  it('salary detail by month floors the payment history', async () => {
    const service = withProfile(JOINED);
    service.profileRepository.findOne = jest.fn().mockResolvedValue({
      id: PROFILE,
      joinedAt: JOINED,
      contracts: [],
    });
    service.employeeSalaryRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 's-1', paymentStatus: 'Đã thanh toán' }),
    };

    await service.getEmployeeSalaryDetailByMonth(PROFILE, '2026-09');

    const where = service.employeePaymentHistoryRepository.find.mock.calls[0][0].where;
    expect(isFloor(where.createdAt)).toBe(true);
  });
});

describe('F. monthly summary after a same-month rehire', () => {
  const build = (currentStintEarned: number | null) => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = { warn: jest.fn(), log: jest.fn() };
    const cumulativeQb = chain();
    cumulativeQb.getRawOne = jest
      .fn()
      .mockResolvedValue({ completedShifts: '1', workedMinutes: '240' });
    service.shiftAssignmentRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'assignment-1',
        employeeId: PROFILE,
        status: ShiftAssignmentStatus.COMPLETED,
        checkOutTime: new Date('2026-09-12T10:00:00Z'),
        workedMinutes: 240,
        shiftSlot: { workDate: '2026-09-12', cycle: { storeId: 'store-1' } },
        employee: { joinedAt: JOINED, contracts: [] },
      }),
      createQueryBuilder: jest.fn(() => cumulativeQb),
    };
    service.getStandardWorkingDays = jest.fn().mockResolvedValue(26);
    service.computeEmployeePayslip = jest.fn().mockResolvedValue({
      facts: {
        totalAssignedShifts: 1,
        completedShifts: 1,
        workingHours: 4,
        lateCount: 0,
        earlyCount: 0,
        absentCount: 0,
      },
      assignments: [],
      payslip: { earnedBaseSalary: 4_000_000 },
      currentStintEarned,
    });
    service.monthlySummaryRepository = { upsert: jest.fn().mockResolvedValue(undefined) };
    return service;
  };

  it('estimatedSalary is the current stint earnings, not the whole payslip', async () => {
    const service = build(100_000);

    await service.processCheckoutPayroll('assignment-1');

    const [summary] = service.monthlySummaryRepository.upsert.mock.calls[0];
    expect(summary.estimatedSalary).toBe(100_000);
  });

  it('falls back to the payslip when the month has one stint', async () => {
    const service = build(null);

    await service.processCheckoutPayroll('assignment-1');

    const [summary] = service.monthlySummaryRepository.upsert.mock.calls[0];
    expect(summary.estimatedSalary).toBe(4_000_000);
  });

  it('computeEmployeePayslip reports the current-stint part of a split month', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.loadMonthlyAssignments = jest.fn().mockResolvedValue([
      // Previous stint: keeps the pay stored at its check-out.
      { id: 'old', workDate: '2026-09-03', status: ShiftAssignmentStatus.COMPLETED, workedMinutes: 480, shiftEarnings: 200_000 },
      // Current stint: 4 h at 25 000/h.
      { id: 'new', workDate: '2026-09-12', status: ShiftAssignmentStatus.COMPLETED, workedMinutes: 240 },
    ]);
    service.sumApprovedAdvances = jest.fn().mockResolvedValue(0);

    const result = await service.computeEmployeePayslip({
      employeeProfileId: PROFILE,
      storeId: 'store-1',
      month: { year: 2026, month: 9, calendarDays: 30 },
      contract: { paymentType: PaymentType.HOUR, allowances: null },
      rate: 25_000,
      rules: [],
      standardWorkingDays: 26,
      now: new Date('2026-09-20T05:00:00Z'),
      stint: { joinedAt: JOINED, contracts: [] },
    });

    expect(result.currentStintEarned).toBe(100_000);
    expect(result.payslip.earnedBaseSalary).toBe(300_000);
  });
});

describe('G. employee ranking report — current stint only', () => {
  it('drops orders and shifts from before the rehire', async () => {
    const service = Object.create(AiReportsService.prototype) as any;
    const orders = chain([
      {
        employeeId: 'e-1',
        fullName: 'An',
        totalOrders: '2',
        completedOrders: '2',
        cancelledOrders: '0',
        totalRevenue: '500000',
      },
    ]);
    const shifts = chain([
      // Previous stint (before the VN date 2026-09-10).
      { employeeId: 'e-1', joinedAt: JOINED, workDate: '2026-09-05', totalWorkMinutes: '600', completedShifts: '2' },
      { employeeId: 'e-1', joinedAt: JOINED, workDate: '2026-09-10', totalWorkMinutes: '120', completedShifts: '1' },
      { employeeId: 'e-1', joinedAt: JOINED, workDate: '2026-09-12', totalWorkMinutes: '60', completedShifts: '1' },
      // Legacy profile: nothing filtered.
      { employeeId: 'e-2', joinedAt: null, workDate: '2026-09-01', totalWorkMinutes: '60', completedShifts: '1' },
    ]);
    service.orderRepository = { createQueryBuilder: jest.fn(() => orders) };
    service.shiftAssignmentRepository = { createQueryBuilder: jest.fn(() => shifts) };

    const report = await service.getEmployeeRankingReport(
      'store-1',
      '2026-09-01',
      '2026-09-30',
    );

    expect(orders.andWhere).toHaveBeenCalledWith(STINT_SQL('e', 'o.created_at'));
    expect(shifts.addGroupBy).toHaveBeenCalledWith('slot.work_date');
    expect(report.employees[0]).toMatchObject({ employeeId: 'e-1', hours: 3 });
  });
});
