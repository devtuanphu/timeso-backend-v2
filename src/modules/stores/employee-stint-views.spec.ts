import { StoresService } from './stores.service';
import { ShiftAssignmentStatus } from './entities/shift-management.entity';
import { PaymentType } from './entities/employee-contract.entity';
import {
  PayrollCalcType,
  PayrollRuleCategory,
} from './entities/store-payroll-rule.entity';

/**
 * A rehired employee keeps one profile row, so every "current" view has to
 * leave out what belonged to the previous stint. The stint starts at
 * `joinedAt`, with a 60-second tolerance (see employment-stint.utils).
 */
const PROFILE = 'profile-1';
const JOINED = new Date('2026-09-10T03:00:00.000Z');
const FLOOR = '2026-09-10T02:59:00.000Z';

const isFloor = (operator: any) =>
  operator?.type === 'moreThanOrEqual' &&
  operator.value instanceof Date &&
  operator.value.toISOString() === FLOOR;

describe('employee views — current stint only', () => {
  describe('getEmployeeById', () => {
    const build = (profile: any) => {
      const service = Object.create(StoresService.prototype) as any;
      service.profileRepository = { findOne: jest.fn().mockResolvedValue(profile) };
      service.monthlySummaryRepository = { findOne: jest.fn().mockResolvedValue(null) };
      service.shiftAssignmentRepository = { find: jest.fn().mockResolvedValue([]) };
      return service;
    };

    it('keeps only current-stint contracts, active first', async () => {
      const service = build({
        id: PROFILE,
        joinedAt: JOINED,
        contracts: [
          { id: 'old', isActive: false, createdAt: new Date('2026-01-01T00:00:00Z') },
          { id: 'renewed', isActive: false, createdAt: new Date('2026-09-15T00:00:00Z') },
          // Written by the hire transaction: before the app-clock joinedAt.
          { id: 'new', isActive: true, createdAt: new Date('2026-09-10T02:59:59Z') },
        ],
      });

      const result = await service.getEmployeeById(PROFILE);

      expect(result.profile.contracts.map((c: any) => c.id)).toEqual([
        'new',
        'renewed',
      ]);
      const where = service.shiftAssignmentRepository.find.mock.calls[0][0].where;
      expect(where.employeeId).toBe(PROFILE);
      expect(isFloor(where.createdAt)).toBe(true);
    });

    it('does not filter a legacy profile without joinedAt', async () => {
      const service = build({
        id: PROFILE,
        joinedAt: null,
        contracts: [
          { id: 'a', isActive: false, createdAt: new Date('2025-01-01T00:00:00Z') },
          { id: 'b', isActive: true, createdAt: new Date('2024-01-01T00:00:00Z') },
        ],
      });

      const result = await service.getEmployeeById(PROFILE);

      expect(result.profile.contracts.map((c: any) => c.id)).toEqual(['b', 'a']);
      expect(service.shiftAssignmentRepository.find.mock.calls[0][0].where).toEqual({
        employeeId: PROFILE,
      });
    });
  });

  it('getEmployeeAssets only lists assets issued in the current stint', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.profileRepository = {
      findOne: jest.fn().mockResolvedValue({ id: PROFILE, joinedAt: JOINED }),
    };
    service.assetAssignmentRepository = { find: jest.fn().mockResolvedValue([]) };

    await service.getEmployeeAssets(PROFILE);

    const where = service.assetAssignmentRepository.find.mock.calls[0][0].where;
    expect(where.employeeProfileId).toBe(PROFILE);
    expect(isFloor(where.assignedDate)).toBe(true);
  });

  it('getEmployeeScheduleDetails floors leave, swap and assignment queries', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.profileRepository = {
      findOne: jest.fn().mockResolvedValue({ id: PROFILE, joinedAt: JOINED }),
    };
    service.leaveRequestRepository = { find: jest.fn().mockResolvedValue([]) };
    service.shiftSwapRepository = { find: jest.fn().mockResolvedValue([]) };
    service.shiftAssignmentRepository = { find: jest.fn().mockResolvedValue([]) };

    await service.getEmployeeScheduleDetails(PROFILE, new Date(2026, 8, 1));

    expect(
      isFloor(service.leaveRequestRepository.find.mock.calls[0][0].where.createdAt),
    ).toBe(true);
    const swapWhere = service.shiftSwapRepository.find.mock.calls[0][0].where;
    expect(swapWhere).toHaveLength(2);
    for (const branch of swapWhere) expect(isFloor(branch.createdAt)).toBe(true);
    expect(
      isFloor(service.shiftAssignmentRepository.find.mock.calls[0][0].where.createdAt),
    ).toBe(true);
  });

  it('getEmployeePerformance drops assessments from the previous stint', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.profileRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: PROFILE,
        storeId: 'store-1',
        joinedAt: JOINED,
        capabilityPoints: 0,
      }),
      count: jest.fn().mockResolvedValue(1),
    };
    service.monthlySummaryRepository = {
      findOne: jest.fn().mockResolvedValue({
        performances: [
          { title: 'old', performanceDate: new Date('2026-09-02T00:00:00Z') },
          { title: 'new', performanceDate: new Date('2026-09-12T00:00:00Z') },
        ],
      }),
    };

    const result = await service.getEmployeePerformance(PROFILE);

    expect(result.assessments.map((a: any) => a.title)).toEqual(['new']);
  });

  describe('processCheckoutPayroll', () => {
    const monthAssignments = [
      // Previous stint, same month.
      { id: 'old-1', workDate: '2026-09-03', status: ShiftAssignmentStatus.COMPLETED, workedMinutes: 480, lateMinutes: 10 },
      { id: 'old-2', workDate: '2026-09-04', status: ShiftAssignmentStatus.COMPLETED, workedMinutes: 480 },
      // Current stint.
      { id: 'assignment-1', workDate: '2026-09-12', status: ShiftAssignmentStatus.COMPLETED, workedMinutes: 240 },
    ];
    const fullFacts = {
      totalAssignedShifts: 3,
      completedShifts: 3,
      workedMinutes: 1200,
      workingHours: 20,
      daysWorked: 3,
      lateCount: 1,
      earlyCount: 0,
      absentCount: 0,
      totalLateMinutes: 10,
      totalEarlyMinutes: 0,
    };

    const build = (joinedAt: Date | null) => {
      const service = Object.create(StoresService.prototype) as any;
      service.logger = { warn: jest.fn(), log: jest.fn() };
      const cumulativeQb: any = {};
      for (const m of ['select', 'addSelect', 'where', 'andWhere', 'innerJoin']) {
        cumulativeQb[m] = jest.fn(() => cumulativeQb);
      }
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
          shiftEarnings: null,
          shiftSlot: { workDate: '2026-09-12', cycle: { storeId: 'store-1' } },
          employee: {
            joinedAt,
            contracts: [
              {
                id: 'contract-new',
                isActive: true,
                salaryAmount: 6_000_000,
                paymentType: PaymentType.MONTH,
                allowances: null,
              },
            ],
          },
        }),
        createQueryBuilder: jest.fn(() => cumulativeQb),
      };
      service.getStandardWorkingDays = jest.fn().mockResolvedValue(26);
      service.resolveRateForMonth = jest.fn().mockResolvedValue({ rate: 6_000_000 });
      service.payrollRuleRepository = { find: jest.fn().mockResolvedValue([]) };
      service.computeEmployeePayslip = jest.fn().mockResolvedValue({
        facts: fullFacts,
        assignments: monthAssignments,
        payslip: { earnedBaseSalary: 4_000_000 },
      });
      service.findOrCreateMonthlyPayroll = jest.fn().mockResolvedValue({ id: 'payroll-1' });
      service.upsertEmployeePayslip = jest.fn().mockResolvedValue(undefined);
      service.refreshMonthlyPayrollTotals = jest.fn().mockResolvedValue(undefined);
      const manager = {
        getRepository: jest.fn(() => ({
          find: jest.fn().mockResolvedValue([]),
          update: jest.fn(),
        })),
      };
      service.dataSource = { transaction: jest.fn(async (cb: any) => cb(manager)) };
      service.monthlySummaryRepository = { upsert: jest.fn().mockResolvedValue(undefined) };
      return { service, cumulativeQb };
    };

    it('pays the full month but summarises only the current stint', async () => {
      const { service, cumulativeQb } = build(JOINED);

      await service.processCheckoutPayroll('assignment-1');

      // The payslip is written from the whole month's computation.
      expect(service.upsertEmployeePayslip).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ payslip: { earnedBaseSalary: 4_000_000 } }),
      );
      const [summary] = service.monthlySummaryRepository.upsert.mock.calls[0];
      expect(summary).toMatchObject({
        totalShifts: 1,
        completedShifts: 1,
        monthlyWorkHours: 4,
        lateArrivalsCount: 0,
        onTimeArrivalsCount: 1,
        performanceScore: 100,
        totalCompletedShifts: 1,
        totalWorkHours: 4,
      });
      expect(cumulativeQb.innerJoin).toHaveBeenCalledWith(
        'assignment.shiftSlot',
        'slot',
        'slot.workDate >= :since',
        { since: '2026-09-10' },
      );
    });

    it('keeps whole-month counters for a legacy profile without joinedAt', async () => {
      const { service, cumulativeQb } = build(null);

      await service.processCheckoutPayroll('assignment-1');

      const [summary] = service.monthlySummaryRepository.upsert.mock.calls[0];
      expect(summary).toMatchObject({
        totalShifts: 3,
        completedShifts: 3,
        lateArrivalsCount: 1,
      });
      expect(cumulativeQb.innerJoin).not.toHaveBeenCalled();
    });
  });
});

describe('employee views — current stint only (r6 repairs)', () => {
  it('getEmployees lists only current-stint contracts, active first', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue(undefined);
    service.employeeTypeRepository = { find: jest.fn().mockResolvedValue([]) };
    service.monthlySummaryRepository = { find: jest.fn().mockResolvedValue([]) };
    const profile = {
      id: PROFILE,
      joinedAt: JOINED,
      contracts: [
        // Previous stint, deactivated at the rehire.
        { id: 'old', isActive: false, endDate: '2026-12-31', createdAt: new Date('2026-01-01T00:00:00Z') },
        { id: 'new', isActive: true, endDate: '2027-09-10', createdAt: new Date('2026-09-10T02:59:59Z') },
      ],
    };
    const legacy = {
      id: 'legacy',
      joinedAt: null,
      contracts: [
        { id: 'l-old', isActive: false, createdAt: new Date('2025-01-01T00:00:00Z') },
        { id: 'l-active', isActive: true, createdAt: new Date('2024-01-01T00:00:00Z') },
      ],
    };
    service.profileRepository = {
      find: jest
        .fn()
        .mockResolvedValueOnce([{ id: PROFILE }, { id: 'legacy' }])
        .mockResolvedValueOnce([profile, legacy]),
    };

    const result = await service.getEmployees(
      'owner-1',
      '11111111-1111-4111-8111-111111111111',
    );

    const byId = new Map(result.employees.map((e: any) => [e.id, e]));
    expect((byId.get(PROFILE) as any).contracts.map((c: any) => c.id)).toEqual(['new']);
    expect((byId.get('legacy') as any).contracts.map((c: any) => c.id)).toEqual([
      'l-active',
      'l-old',
    ]);
  });

  it('getEmployees returns no contract for a rehire without a new contract', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue(undefined);
    service.employeeTypeRepository = { find: jest.fn().mockResolvedValue([]) };
    service.monthlySummaryRepository = { find: jest.fn().mockResolvedValue([]) };
    service.profileRepository = {
      find: jest
        .fn()
        .mockResolvedValueOnce([{ id: PROFILE }])
        .mockResolvedValueOnce([
          {
            id: PROFILE,
            joinedAt: JOINED,
            contracts: [
              { id: 'old', isActive: false, createdAt: new Date('2026-01-01T00:00:00Z') },
            ],
          },
        ]),
    };

    const result = await service.getEmployees(
      'owner-1',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(result.employees[0].contracts).toEqual([]);
  });

  it('getLatestContract ignores the previous stint and prefers the active contract', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.profileRepository = {
      findOne: jest.fn().mockResolvedValue({ id: PROFILE, joinedAt: JOINED }),
    };
    service.contractRepository = {
      find: jest.fn().mockResolvedValue([
        { id: 'renewal-draft', isActive: false, createdAt: new Date('2026-09-15T00:00:00Z') },
        { id: 'new', isActive: true, createdAt: new Date('2026-09-10T02:59:59Z') },
        { id: 'old', isActive: false, createdAt: new Date('2026-01-01T00:00:00Z') },
      ]),
    };
    expect((await service.getLatestContract(PROFILE)).id).toBe('new');

    service.contractRepository.find.mockResolvedValue([
      { id: 'old', isActive: false, createdAt: new Date('2026-01-01T00:00:00Z') },
    ]);
    expect(await service.getLatestContract(PROFILE)).toBeNull();
  });

  it('getEmployeePerformance keeps an assessment dated on the rehire day (date column)', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.profileRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: PROFILE,
        storeId: 'store-1',
        // 10:00 VN on 2026-09-10: the timestamp floor is later than the
        // date-only value of an assessment made that same day.
        joinedAt: JOINED,
        capabilityPoints: 0,
      }),
      count: jest.fn().mockResolvedValue(1),
    };
    service.monthlySummaryRepository = {
      findOne: jest.fn().mockResolvedValue({
        performances: [
          { title: 'previous-day', performanceDate: '2026-09-09' },
          { title: 'rehire-day', performanceDate: '2026-09-10' },
          { title: 'later', performanceDate: new Date('2026-09-12T00:00:00Z') },
        ],
      }),
    };

    const result = await service.getEmployeePerformance(PROFILE);

    expect(result.assessments.map((a: any) => a.title)).toEqual([
      'later',
      'rehire-day',
    ]);
  });

  describe('computeEmployeePayslip — same-month rehire pricing', () => {
    // Sept 2026, 26 standard working days. Previous stint: MONTH 5,200,000,
    // two completed shifts whose check-out stored 200,000 each. Rehired on
    // 2026-09-10 on HOUR 30,000; one 4 h shift since.
    const assignments = [
      { id: 'old-1', workDate: '2026-09-03', status: ShiftAssignmentStatus.COMPLETED, workedMinutes: 480, lateMinutes: 10, shiftEarnings: 200_000, checkInTime: '2026-09-03T01:00:00Z' },
      { id: 'old-2', workDate: '2026-09-04', status: ShiftAssignmentStatus.COMPLETED, workedMinutes: 480, shiftEarnings: 200_000, checkInTime: '2026-09-04T01:00:00Z' },
      { id: 'new-1', workDate: '2026-09-12', status: ShiftAssignmentStatus.COMPLETED, workedMinutes: 240, shiftEarnings: 120_000, checkInTime: '2026-09-12T01:00:00Z' },
    ];
    const month = {
      key: '2026-09-01',
      year: 2026,
      monthIndex: 8,
      calendarDays: 30,
    };
    const currentContract = {
      id: 'contract-new',
      isActive: true,
      paymentType: PaymentType.HOUR,
      salaryAmount: 30_000,
      allowances: null,
      createdAt: new Date('2026-09-10T02:59:59Z'),
    };
    const oldContract = {
      id: 'contract-old',
      isActive: false,
      paymentType: PaymentType.MONTH,
      salaryAmount: 5_200_000,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const lateFine = {
      category: PayrollRuleCategory.FINE,
      ruleType: 'LATE',
      calcType: PayrollCalcType.AMOUNT,
      value: 50_000,
    };
    const compute = (rows: any[], joinedAt: Date | null) => {
      const service = Object.create(StoresService.prototype) as any;
      service.loadMonthlyAssignments = jest.fn().mockResolvedValue(rows);
      service.sumApprovedAdvances = jest.fn().mockResolvedValue(0);
      return service.computeEmployeePayslip({
        employeeProfileId: PROFILE,
        storeId: 'store-1',
        month,
        contract: currentContract,
        rate: 30_000,
        rules: [lateFine],
        standardWorkingDays: 26,
        now: new Date('2026-09-22T05:00:00Z'),
        stint: { joinedAt, contracts: [currentContract, oldContract] },
      });
    };

    it('keeps the old stint priced as recorded and prices the new stint with the new contract', async () => {
      const { payslip } = await compute(assignments, JOINED);
      // 400,000 (stored, old MONTH contract) + 4 h × 30,000 = 520,000.
      // The late fine of the old stint still applies to the month.
      expect(payslip).toMatchObject({
        earnedBaseSalary: 520_000,
        penalty: 50_000,
        netSalary: 470_000,
        paymentType: PaymentType.HOUR,
        workingDays: 3,
      });
    });

    it('prices an old-stint shift with no stored figure with the old contract', async () => {
      const rows = assignments.map((a) =>
        a.id === 'old-2' ? { ...a, shiftEarnings: null } : a,
      );
      const { payslip } = await compute(rows, JOINED);
      // old-2: 5,200,000 ÷ 26 = 200,000.
      expect(payslip.earnedBaseSalary).toBe(520_000);
    });

    it('prices the whole month with the current contract for a legacy profile', async () => {
      const { payslip } = await compute(assignments, null);
      // 20 h × 30,000.
      expect(payslip.earnedBaseSalary).toBe(600_000);
    });
  });

  it('processCheckoutPayroll never reprices a previous-stint shift with the new contract', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = { warn: jest.fn(), log: jest.fn() };
    const cumulativeQb: any = {};
    for (const m of ['select', 'addSelect', 'where', 'andWhere', 'innerJoin']) {
      cumulativeQb[m] = jest.fn(() => cumulativeQb);
    }
    cumulativeQb.getRawOne = jest
      .fn()
      .mockResolvedValue({ completedShifts: '0', workedMinutes: '0' });
    const employee = {
      joinedAt: JOINED,
      contracts: [
        { id: 'contract-new', isActive: true, salaryAmount: 30_000, paymentType: PaymentType.HOUR, allowances: null },
      ],
    };
    service.shiftAssignmentRepository = {
      // A late check-out job for a shift of the previous stint.
      findOne: jest.fn().mockResolvedValue({
        id: 'old-2',
        employeeId: PROFILE,
        status: ShiftAssignmentStatus.COMPLETED,
        checkOutTime: new Date('2026-09-04T10:00:00Z'),
        workedMinutes: 480,
        shiftEarnings: 200_000,
        shiftSlot: { workDate: '2026-09-04', cycle: { storeId: 'store-1' } },
        employee,
      }),
      createQueryBuilder: jest.fn(() => cumulativeQb),
    };
    service.getStandardWorkingDays = jest.fn().mockResolvedValue(26);
    service.resolveRateForMonth = jest.fn().mockResolvedValue({ rate: 30_000 });
    const composed = {
      facts: {
        totalAssignedShifts: 1, completedShifts: 1, workedMinutes: 480, workingHours: 8,
        daysWorked: 1, lateCount: 0, earlyCount: 0, absentCount: 0,
        totalLateMinutes: 0, totalEarlyMinutes: 0,
      },
      assignments: [
        { id: 'old-2', workDate: '2026-09-04', status: ShiftAssignmentStatus.COMPLETED, workedMinutes: 480, shiftEarnings: 200_000 },
      ],
      payslip: { earnedBaseSalary: 200_000 },
    };
    service.computeEmployeePayslip = jest.fn().mockResolvedValue(composed);
    service.findOrCreateMonthlyPayroll = jest.fn().mockResolvedValue({ id: 'payroll-1' });
    service.upsertEmployeePayslip = jest.fn().mockResolvedValue('updated');
    service.refreshMonthlyPayrollTotals = jest.fn().mockResolvedValue(undefined);
    const update = jest.fn();
    const manager = {
      getRepository: jest.fn(() => ({
        find: jest.fn().mockResolvedValue([]),
        update,
      })),
    };
    service.dataSource = { transaction: jest.fn(async (cb: any) => cb(manager)) };
    service.monthlySummaryRepository = { upsert: jest.fn().mockResolvedValue(undefined) };

    await service.processCheckoutPayroll('old-2');

    expect(service.computeEmployeePayslip).toHaveBeenCalledWith(
      expect.objectContaining({ stint: employee }),
    );
    // 8 h × 30,000 = 240,000 would have overwritten the stored 200,000.
    expect(update).not.toHaveBeenCalled();
    expect(service.upsertEmployeePayslip).toHaveBeenCalled();
  });
});

describe('returnAsset — locked, conditional return', () => {
  const build = (opts: { status?: string; affected?: number } = {}) => {
    const service = Object.create(StoresService.prototype) as any;
    const calls: string[] = [];
    const lockedQb = (label: string, row: any) => {
      const qb: any = {};
      qb.where = jest.fn(() => qb);
      qb.setLock = jest.fn((mode: string) => {
        calls.push(`${label}:${mode}`);
        return qb;
      });
      qb.getOne = jest.fn().mockResolvedValue(row);
      return qb;
    };
    const assignmentQb = lockedQb('assignment', {
      id: 'ea-1',
      assetId: 'asset-1',
      quantity: 2,
      status: opts.status ?? 'ASSIGNED',
    });
    const asset = { id: 'asset-1', currentStock: 3 };
    const assetQb = lockedQb('asset', asset);
    const manager: any = {
      getRepository: jest.fn((entity: any) => ({
        createQueryBuilder: () =>
          entity.name === 'Asset' ? assetQb : assignmentQb,
      })),
      update: jest.fn(async () => {
        calls.push('update');
        return { affected: opts.affected ?? 1 };
      }),
      save: jest.fn(async (_entity: any, value: any) => {
        calls.push('save');
        return value;
      }),
    };
    service.dataSource = { transaction: jest.fn(async (cb: any) => cb(manager)) };
    return { service, manager, calls, asset };
  };

  it('locks the assignment, updates it only while ASSIGNED, then locks and restocks the asset', async () => {
    const { service, manager, calls, asset } = build();

    await service.returnAsset('ea-1', 'RETURNED', 'ok');

    expect(calls).toEqual([
      'assignment:pessimistic_write',
      'update',
      'asset:pessimistic_write',
      'save',
    ]);
    const [, criteria, changes] = manager.update.mock.calls[0];
    expect(criteria).toEqual({ id: 'ea-1', status: 'ASSIGNED' });
    expect(changes).toMatchObject({ status: 'RETURNED', returnNote: 'ok' });
    expect(asset.currentStock).toBe(5);
  });

  it('does not restock when a concurrent writer already closed the row', async () => {
    const { service, manager } = build({ affected: 0 });

    await expect(service.returnAsset('ea-1', 'RETURNED')).rejects.toThrow(
      'Tài sản này đã được thu hồi hoặc không còn hiệu lực',
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects an already returned row without writing', async () => {
    const { service, manager } = build({ status: 'RETURNED' });

    await expect(service.returnAsset('ea-1', 'RETURNED')).rejects.toThrow();
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('marks DAMAGED without touching stock', async () => {
    const { service, manager, calls } = build();

    await service.returnAsset('ea-1', 'DAMAGED');

    expect(calls).toEqual(['assignment:pessimistic_write', 'update']);
    expect(manager.save).not.toHaveBeenCalled();
  });
});
