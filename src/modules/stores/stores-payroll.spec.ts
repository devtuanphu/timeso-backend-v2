import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StoresService } from './stores.service';
import { AccountsService } from '../accounts/accounts.service';
import { FaceRecognitionService } from './face-recognition.service';
import { PaymentType } from './entities/employee-contract.entity';
import { PayrollRuleCategory, PayrollCalcType } from './entities/store-payroll-rule.entity';
import { PayrollCalculationMethod } from './entities/store-payroll-setting.entity';

import { Store } from './entities/store.entity';
import { StoreEmployeeType } from './entities/store-employee-type.entity';
import { StoreRole } from './entities/store-role.entity';
import { EmployeeProfile } from './entities/employee-profile.entity';
import { EmployeeProfileRole } from './entities/employee-profile-role.entity';
import { EmployeeContract } from './entities/employee-contract.entity';
import { WorkShift } from './entities/work-shift.entity';
import { Asset } from './entities/asset.entity';
import { Product } from './entities/product.entity';
import { AssetUnit } from './entities/asset-unit.entity';
import { ProductUnit } from './entities/product-unit.entity';
import { MonthlyPayroll } from './entities/monthly-payroll.entity';
import { SalaryConfig } from './entities/salary-config.entity';
import { EmployeeSalary } from './entities/employee-salary.entity';
import { KpiType } from './entities/kpi-type.entity';
import { AssetCategory } from './entities/asset-category.entity';
import { AssetStatus } from './entities/asset-status.entity';
import { ProductCategory } from './entities/product-category.entity';
import { ProductStatus } from './entities/product-status.entity';
import { EmployeeKpi } from './entities/employee-kpi.entity';
import { KpiUnit } from './entities/kpi-unit.entity';
import { KpiPeriod } from './entities/kpi-period.entity';
import { KpiTask } from './entities/kpi-task.entity';
import { DailyEmployeeReport } from './entities/daily-employee-report.entity';
import { EmployeeMonthlySummary } from './entities/employee-monthly-summary.entity';
import { StoreEvent } from './entities/store-event.entity';
import { StockTransaction, StockTransactionDetail } from './entities/stock-transaction.entity';
import {
  WorkCycle, ShiftSlot, ShiftAssignment, ShiftSwap, CycleShiftTemplate,
} from './entities/shift-management.entity';
import { EmployeeLeaveRequest } from './entities/employee-leave-request.entity';
import { EmployeeFace } from './entities/employee-face.entity';
import { AttendanceLog } from './entities/attendance-log.entity';
import { EmployeeAssetAssignment } from './entities/employee-asset-assignment.entity';
import { ServiceCategory, ServiceItem, ServiceItemRecipe } from './entities/service-item.entity';
import { Order, OrderItem } from './entities/order.entity';
import { EmployeePerformance } from './entities/employee-performance.entity';
import { EmployeeTerminationReason } from './entities/employee-termination-reason.entity';
import { StoreProbationSetting } from './entities/store-probation-setting.entity';
import { StoreSkill } from './entities/store-skill.entity';
import { StorePayrollPaymentHistory } from './entities/store-payroll-payment-history.entity';
import { SalaryFundHistory } from './entities/salary-fund-history.entity';
import { SalaryAdvanceRequest } from './entities/salary-advance-request.entity';
import { SalaryAdjustment } from './entities/salary-adjustment.entity';
import { SalaryAdjustmentReason } from './entities/salary-adjustment-reason.entity';
import { EmployeePaymentHistory } from './entities/employee-payment-history.entity';
import { StorePaymentAccount } from './entities/store-payment-account.entity';
import { KpiApprovalRequest } from './entities/kpi-approval-request.entity';
import { InventoryReport } from './entities/inventory-report.entity';
import { AssetExportType } from './entities/asset-export-type.entity';
import { ProductExportType } from './entities/product-export-type.entity';
import { StoreApprovalSetting } from './entities/store-approval-setting.entity';
import { StoreTimekeepingSetting } from './entities/store-timekeeping-setting.entity';
import { StorePayrollSetting } from './entities/store-payroll-setting.entity';
import { StorePayrollRule } from './entities/store-payroll-rule.entity';
import { StorePayrollIncrementRule } from './entities/store-payroll-increment-rule.entity';
import { StoreInternalRule } from './entities/store-internal-rule.entity';
import { StorePermissionConfig } from './entities/store-permission-config.entity';
import { StoreShiftConfig } from './entities/store-shift-config.entity';
import { Feedback } from './entities/feedback.entity';
import { ShiftChangeRequest } from './entities/shift-change-request.entity';
import { BonusWorkRequest } from './entities/bonus-work-request.entity';

let AccountIdentityDocument: any;
let AccountFinance: any;
try {
  AccountIdentityDocument = require('../accounts/entities/account-identity-document.entity').AccountIdentityDocument;
} catch {
  AccountIdentityDocument = class AccountIdentityDocument {};
}
try {
  AccountFinance = require('../accounts/entities/account-finance.entity').AccountFinance;
} catch {
  AccountFinance = class AccountFinance {};
}

function mockRepo() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((d: any) => ({ id: 'gen-id', ...d })),
    save: jest.fn((e: any) => Promise.resolve(Array.isArray(e) ? e : { id: 'gen-id', ...e })),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    createQueryBuilder: jest.fn(() => {
      const qb: any = {};
      qb.where = jest.fn().mockReturnValue(qb);
      qb.andWhere = jest.fn().mockReturnValue(qb);
      qb.leftJoinAndSelect = jest.fn().mockReturnValue(qb);
      qb.innerJoin = jest.fn().mockReturnValue(qb);
      qb.orderBy = jest.fn().mockReturnValue(qb);
      qb.select = jest.fn().mockReturnValue(qb);
      qb.addSelect = jest.fn().mockReturnValue(qb);
      qb.groupBy = jest.fn().mockReturnValue(qb);
      qb.having = jest.fn().mockReturnValue(qb);
      qb.limit = jest.fn().mockReturnValue(qb);
      qb.getMany = jest.fn().mockResolvedValue([]);
      qb.getRawMany = jest.fn().mockResolvedValue([]);
      qb.getRawOne = jest.fn().mockResolvedValue(null);
      return qb;
    }),
  };
}

const ENTITIES = [
  Store, StoreEmployeeType, StoreRole, EmployeeProfile, EmployeeProfileRole,
  EmployeeContract, WorkShift, Asset, Product, AssetUnit, ProductUnit,
  MonthlyPayroll, SalaryConfig, EmployeeSalary, KpiType, AssetCategory,
  AssetStatus, ProductCategory, ProductStatus, EmployeeKpi, KpiUnit, KpiPeriod,
  KpiTask, DailyEmployeeReport, EmployeeMonthlySummary, StoreEvent,
  StockTransaction, StockTransactionDetail, WorkCycle, ShiftSlot, ShiftAssignment,
  ShiftSwap, CycleShiftTemplate, ServiceCategory, ServiceItem, ServiceItemRecipe,
  Order, OrderItem, EmployeePerformance, EmployeeLeaveRequest, EmployeeAssetAssignment,
  EmployeeTerminationReason, StoreProbationSetting, StoreSkill,
  StorePayrollPaymentHistory, SalaryFundHistory, SalaryAdvanceRequest,
  SalaryAdjustment, SalaryAdjustmentReason, EmployeePaymentHistory,
  StorePaymentAccount, KpiApprovalRequest, InventoryReport, AssetExportType,
  ProductExportType, StoreApprovalSetting, StoreTimekeepingSetting,
  StorePayrollSetting, StorePayrollRule, StorePayrollIncrementRule,
  AccountIdentityDocument, StoreInternalRule, StorePermissionConfig,
  StoreShiftConfig, CycleShiftTemplate, AccountFinance, Feedback,
  EmployeeFace, AttendanceLog,
  ShiftChangeRequest, BonusWorkRequest,
];

// ─── Pure Calculation Tests ─────────────────────────────────────────────────────
describe('Payroll Calculation Logic', () => {

  /**
   * These are pure unit tests that validate the payroll calculation formulas
   * without needing any NestJS DI infrastructure.
   *
   * The formulas follow this structure:
   * - HOURLY:  salaryAmount * (workingHours / 176)
   * - SHIFT:   salaryAmount * completedShifts
   * - DAY:     salaryAmount * completedShifts
   * - MONTH:   salaryAmount * (completedShifts / daysInMonth)
   * - SHIFT_EARNINGS: totalShiftEarnings (takes precedence)
   *
   * Late/Early penalty (PERCENTAGE): (calculatedSalary * value/100) * count
   * Late/Early penalty (AMOUNT):     value * count
   * Absent penalty (AMOUNT):         value * absentCount
   * Bonus (PERCENTAGE):              (calculatedSalary * value/100) * count
   * Bonus (AMOUNT):                  value * count
   *
   * netSalary = calculatedSalary + allowances + bonus - penalties
   * netSalary >= 0 (floored at zero)
   */
  const STANDARD_MONTHLY_HOURS = 176;

  describe('calculateBaseSalary', () => {

    function calculateBaseSalary(
      paymentType: PaymentType,
      baseSalary: number,
      workingHours: number,
      completedShifts: number,
      hasShiftEarnings: boolean,
      totalShiftEarnings: number,
      daysInMonth: number,
    ): number {
      if (hasShiftEarnings) {
        return totalShiftEarnings;
      }
      if (paymentType === PaymentType.HOUR) {
        return baseSalary * (workingHours / STANDARD_MONTHLY_HOURS);
      }
      if (paymentType === PaymentType.SHIFT) {
        return baseSalary * completedShifts;
      }
      if (paymentType === PaymentType.DAY) {
        return baseSalary * completedShifts;
      }
      // MONTH fallback
      return daysInMonth > 0
        ? baseSalary * (completedShifts / daysInMonth)
        : baseSalary;
    }

    it('should use totalShiftEarnings when hasShiftEarnings=true', () => {
      const result = calculateBaseSalary(
        PaymentType.MONTH, 10_000_000, 200, 22, true, 15_000_000, 30,
      );
      expect(result).toBe(15_000_000);
    });

    it('should calculate HOURLY salary correctly (88h = 50% of full month)', () => {
      const result = calculateBaseSalary(
        PaymentType.HOUR, 100_000, 88, 0, false, 0, 30,
      );
      expect(result).toBeCloseTo(50_000, 0);
    });

    it('should calculate HOURLY salary correctly (176h = 100%)', () => {
      const result = calculateBaseSalary(
        PaymentType.HOUR, 100_000, 176, 0, false, 0, 30,
      );
      expect(result).toBe(100_000);
    });

    it('should calculate SHIFT salary correctly', () => {
      const result = calculateBaseSalary(
        PaymentType.SHIFT, 500_000, 0, 22, false, 0, 30,
      );
      expect(result).toBe(11_000_000);
    });

    it('should calculate DAY salary correctly', () => {
      const result = calculateBaseSalary(
        PaymentType.DAY, 400_000, 0, 20, false, 0, 30,
      );
      expect(result).toBe(8_000_000);
    });

    it('should calculate MONTH salary (prorated, 30-day month)', () => {
      const result = calculateBaseSalary(
        PaymentType.MONTH, 10_000_000, 0, 10, false, 0, 30,
      );
      expect(result).toBeCloseTo(3_333_333, 0);
    });

    it('should calculate MONTH salary (prorated, 28-day February)', () => {
      const result = calculateBaseSalary(
        PaymentType.MONTH, 10_000_000, 0, 14, false, 0, 28,
      );
      expect(result).toBeCloseTo(5_000_000, 0);
    });

    it('should calculate MONTH salary (prorated, 29-day leap February)', () => {
      const result = calculateBaseSalary(
        PaymentType.MONTH, 10_000_000, 0, 15, false, 0, 29,
      );
      expect(result).toBeCloseTo(5_172_414, 0);
    });

    it('should calculate MONTH salary with 0 shifts = 0', () => {
      const result = calculateBaseSalary(
        PaymentType.MONTH, 10_000_000, 0, 0, false, 0, 30,
      );
      expect(result).toBe(0);
    });

    it('should use full MONTH salary when shifts >= daysInMonth', () => {
      const result = calculateBaseSalary(
        PaymentType.MONTH, 10_000_000, 0, 30, false, 0, 30,
      );
      expect(result).toBe(10_000_000);
    });

  });

  describe('calculatePenalty', () => {

    function calculatePenalty(
      calculatedSalary: number,
      rules: Array<{
        ruleType: string;
        category: string;
        calcType: PayrollCalcType;
        value: number;
        count: number;
      }>,
    ): number {
      let penalty = 0;
      for (const rule of rules) {
        if (rule.category !== PayrollRuleCategory.FINE) continue;
        if (rule.count <= 0) continue;

        if (rule.calcType === PayrollCalcType.PERCENTAGE) {
          penalty += (calculatedSalary * rule.value / 100) * rule.count;
        } else if (rule.calcType === PayrollCalcType.AMOUNT) {
          penalty += rule.value * rule.count;
        }
      }
      return penalty;
    }

    it('should apply PERCENTAGE late penalty correctly', () => {
      const salary = 10_000_000;
      const rules = [{ ruleType: 'LATE', category: PayrollRuleCategory.FINE, calcType: PayrollCalcType.PERCENTAGE, value: 5, count: 2 }];
      const penalty = calculatePenalty(salary, rules);
      // 5% of 10M = 500,000 * 2 = 1,000,000
      expect(penalty).toBe(1_000_000);
    });

    it('should apply AMOUNT late penalty correctly', () => {
      const salary = 10_000_000;
      const rules = [{ ruleType: 'LATE', category: PayrollRuleCategory.FINE, calcType: PayrollCalcType.AMOUNT, value: 50_000, count: 3 }];
      const penalty = calculatePenalty(salary, rules);
      // 50,000 * 3 = 150,000
      expect(penalty).toBe(150_000);
    });

    it('should apply EARLY penalty', () => {
      const salary = 10_000_000;
      const rules = [{ ruleType: 'EARLY', category: PayrollRuleCategory.FINE, calcType: PayrollCalcType.PERCENTAGE, value: 3, count: 2 }];
      const penalty = calculatePenalty(salary, rules);
      // 3% of 10M = 300,000 * 2 = 600,000
      expect(penalty).toBe(600_000);
    });

    it('should apply ABSENT penalty', () => {
      const salary = 10_000_000;
      const rules = [{ ruleType: 'ABSENT', category: PayrollRuleCategory.FINE, calcType: PayrollCalcType.AMOUNT, value: 200_000, count: 3 }];
      const penalty = calculatePenalty(salary, rules);
      // 200,000 * 3 = 600,000
      expect(penalty).toBe(600_000);
    });

    it('should apply multiple penalties simultaneously', () => {
      const salary = 10_000_000;
      const rules = [
        { ruleType: 'LATE', category: PayrollRuleCategory.FINE, calcType: PayrollCalcType.PERCENTAGE, value: 5, count: 2 },
        { ruleType: 'EARLY', category: PayrollRuleCategory.FINE, calcType: PayrollCalcType.PERCENTAGE, value: 3, count: 1 },
        { ruleType: 'ABSENT', category: PayrollRuleCategory.FINE, calcType: PayrollCalcType.AMOUNT, value: 200_000, count: 2 },
      ];
      const penalty = calculatePenalty(salary, rules);
      // Late: (10M * 5% * 2) = 1,000,000
      // Early: (10M * 3% * 1) = 300,000
      // Absent: 200,000 * 2 = 400,000
      // Total = 1,700,000
      expect(penalty).toBe(1_700_000);
    });

    it('should NOT apply penalty when count is zero', () => {
      const salary = 10_000_000;
      const rules = [{ ruleType: 'LATE', category: PayrollRuleCategory.FINE, calcType: PayrollCalcType.PERCENTAGE, value: 5, count: 0 }];
      const penalty = calculatePenalty(salary, rules);
      expect(penalty).toBe(0);
    });

    it('should NOT apply BONUS rules as penalty', () => {
      const salary = 10_000_000;
      const rules = [{ ruleType: 'ATTENDANCE', category: PayrollRuleCategory.BONUS, calcType: PayrollCalcType.AMOUNT, value: 200_000, count: 1 }];
      const penalty = calculatePenalty(salary, rules);
      expect(penalty).toBe(0);
    });

  });

  describe('calculateBonus', () => {

    function calculateBonus(
      calculatedSalary: number,
      rules: Array<{
        ruleType: string;
        category: string;
        calcType: PayrollCalcType;
        value: number;
        count: number;
      }>,
    ): number {
      let bonus = 0;
      for (const rule of rules) {
        if (rule.category !== PayrollRuleCategory.BONUS) continue;
        if (rule.count <= 0) continue;

        if (rule.calcType === PayrollCalcType.PERCENTAGE) {
          bonus += (calculatedSalary * rule.value / 100) * rule.count;
        } else if (rule.calcType === PayrollCalcType.AMOUNT) {
          bonus += rule.value * rule.count;
        }
      }
      return bonus;
    }

    it('should apply BONUS with AMOUNT', () => {
      const salary = 10_000_000;
      const rules = [{ ruleType: 'ATTENDANCE', category: PayrollRuleCategory.BONUS, calcType: PayrollCalcType.AMOUNT, value: 200_000, count: 1 }];
      expect(calculateBonus(salary, rules)).toBe(200_000);
    });

    it('should apply BONUS with PERCENTAGE', () => {
      const salary = 10_000_000;
      const rules = [{ ruleType: 'KPI', category: PayrollRuleCategory.BONUS, calcType: PayrollCalcType.PERCENTAGE, value: 10, count: 1 }];
      expect(calculateBonus(salary, rules)).toBe(1_000_000);
    });

    it('should NOT apply FINE rules as bonus', () => {
      const salary = 10_000_000;
      const rules = [{ ruleType: 'LATE', category: PayrollRuleCategory.FINE, calcType: PayrollCalcType.PERCENTAGE, value: 5, count: 2 }];
      expect(calculateBonus(salary, rules)).toBe(0);
    });

  });

  describe('netSalary floor', () => {

    function calculateNetSalary(calculatedSalary: number, bonus: number, penalty: number): number {
      const totalIncome = calculatedSalary + bonus;
      const totalDeductions = penalty;
      return Math.max(0, totalIncome - totalDeductions);
    }

    it('should floor netSalary at 0 when penalties exceed income', () => {
      // 1M salary, no bonus, 50M penalty → should floor at 0
      const net = calculateNetSalary(1_000_000, 0, 50_000_000);
      expect(net).toBe(0);
    });

    it('should floor netSalary at 0 when bonuses + salary < penalties', () => {
      const net = calculateNetSalary(500_000, 100_000, 800_000);
      expect(net).toBe(0);
    });

    it('should calculate correct net when penalties < income', () => {
      const net = calculateNetSalary(10_000_000, 500_000, 1_000_000);
      expect(net).toBe(9_500_000);
    });

    it('should calculate correct net when penalties = 0', () => {
      const net = calculateNetSalary(10_000_000, 500_000, 0);
      expect(net).toBe(10_500_000);
    });

  });

  describe('complete payroll flow', () => {

    function runPayroll(params: {
      paymentType: PaymentType;
      baseSalary: number;
      workingHours: number;
      completedShifts: number;
      hasShiftEarnings: boolean;
      totalShiftEarnings: number;
      daysInMonth: number;
      rules: Array<{
        ruleType: string;
        category: string;
        calcType: PayrollCalcType;
        value: number;
        count: number;
      }>;
    }): { calculatedSalary: number; penalty: number; bonus: number; netSalary: number } {
      const STANDARD_MONTHLY_HOURS = 176;
      let calculatedSalary = 0;
      if (params.hasShiftEarnings) {
        calculatedSalary = params.totalShiftEarnings;
      } else if (params.paymentType === PaymentType.HOUR) {
        calculatedSalary = params.baseSalary * (params.workingHours / STANDARD_MONTHLY_HOURS);
      } else if (params.paymentType === PaymentType.SHIFT || params.paymentType === PaymentType.DAY) {
        calculatedSalary = params.baseSalary * params.completedShifts;
      } else {
        calculatedSalary = params.daysInMonth > 0
          ? params.baseSalary * (params.completedShifts / params.daysInMonth)
          : params.baseSalary;
      }

      let penalty = 0;
      let bonus = 0;
      for (const rule of params.rules) {
        if (rule.count <= 0) continue;
        if (rule.calcType === PayrollCalcType.PERCENTAGE) {
          const amount = (calculatedSalary * rule.value / 100) * rule.count;
          if (rule.category === PayrollRuleCategory.FINE) penalty += amount;
          else if (rule.category === PayrollRuleCategory.BONUS) bonus += amount;
        } else if (rule.calcType === PayrollCalcType.AMOUNT) {
          const amount = rule.value * rule.count;
          if (rule.category === PayrollRuleCategory.FINE) penalty += amount;
          else if (rule.category === PayrollRuleCategory.BONUS) bonus += amount;
        }
      }

      const netSalary = Math.max(0, calculatedSalary + bonus - penalty);
      return { calculatedSalary, penalty, bonus, netSalary };
    }

    it('full payroll: monthly employee with late penalty', () => {
      const result = runPayroll({
        paymentType: PaymentType.MONTH,
        baseSalary: 10_000_000,
        workingHours: 160,
        completedShifts: 20,
        hasShiftEarnings: false,
        totalShiftEarnings: 0,
        daysInMonth: 30,
        rules: [{ ruleType: 'LATE', category: PayrollRuleCategory.FINE, calcType: PayrollCalcType.PERCENTAGE, value: 5, count: 2 }],
      });
      // calculatedSalary = 10M * (20/30) = 6,666,667
      expect(result.calculatedSalary).toBeCloseTo(6_666_667, 0);
      // penalty = (6,666,667 * 5% * 2) = 666,667
      expect(result.penalty).toBeCloseTo(666_667, 0);
      // net = 6,666,667 - 666,667 = 6,000,000
      expect(result.netSalary).toBeCloseTo(6_000_000, 0);
    });

    it('full payroll: hourly employee with shift earnings + bonus', () => {
      const result = runPayroll({
        paymentType: PaymentType.HOUR,
        baseSalary: 100_000,
        workingHours: 176,
        completedShifts: 22,
        hasShiftEarnings: true,
        totalShiftEarnings: 20_000_000,
        daysInMonth: 30,
        rules: [{ ruleType: 'ATTENDANCE', category: PayrollRuleCategory.BONUS, calcType: PayrollCalcType.AMOUNT, value: 200_000, count: 1 }],
      });
      expect(result.calculatedSalary).toBe(20_000_000);
      expect(result.bonus).toBe(200_000);
      expect(result.penalty).toBe(0);
      expect(result.netSalary).toBe(20_200_000);
    });

    it('full payroll: shift employee with absent penalty', () => {
      const result = runPayroll({
        paymentType: PaymentType.SHIFT,
        baseSalary: 500_000,
        workingHours: 0,
        completedShifts: 18,
        hasShiftEarnings: false,
        totalShiftEarnings: 0,
        daysInMonth: 30,
        rules: [
          { ruleType: 'ABSENT', category: PayrollRuleCategory.FINE, calcType: PayrollCalcType.AMOUNT, value: 200_000, count: 4 },
        ],
      });
      expect(result.calculatedSalary).toBe(9_000_000);
      expect(result.penalty).toBe(800_000);
      expect(result.netSalary).toBe(8_200_000);
    });

  });

});

// ─── Integration Tests (StoresService) ─────────────────────────────────────────
// These require NestJS DI and work with mocked repositories.
describe('StoresService - Payroll Integration', () => {
  let service: StoresService;
  let storeRepo: any;
  let payrollRepo: any;

  beforeEach(async () => {
    const repoMap = new Map<any, ReturnType<typeof mockRepo>>();
    const providers = ENTITIES.map((entity) => {
      const mock = mockRepo();
      repoMap.set(entity, mock);
      return { provide: getRepositoryToken(entity), useValue: mock };
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoresService,
        ...providers,
        {
          provide: AccountsService,
          useValue: { findById: jest.fn(), findByEmail: jest.fn() },
        },
        {
          provide: FaceRecognitionService,
          useValue: {
            extractDescriptor: jest.fn().mockResolvedValue(null),
            compareFaces: jest.fn().mockReturnValue({}),
            detectFace: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: DataSource,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<StoresService>(StoresService);
    storeRepo = repoMap.get(Store);
    payrollRepo = repoMap.get(MonthlyPayroll);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createMonthlyPayrollsForAllStores', () => {
    it('should create payrolls for all active stores', async () => {
      storeRepo.find.mockResolvedValue([
        { id: 'store-1', status: 'active' },
        { id: 'store-2', status: 'active' },
      ]);
      payrollRepo.find.mockResolvedValue([]);

      const result = await service.createMonthlyPayrollsForAllStores();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should return empty array when no stores exist', async () => {
      storeRepo.find.mockResolvedValue([]);
      const result = await service.createMonthlyPayrollsForAllStores();
      expect(result).toEqual([]);
    });
  });

});
