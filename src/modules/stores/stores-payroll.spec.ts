import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StoresService } from './stores.service';
import { AccountsService } from '../accounts/accounts.service';
import { FaceRecognitionService } from './face-recognition.service';
import { ShiftReminderService } from './shift-reminder.service';
import { PaymentType } from './entities/employee-contract.entity';
import {
  PayrollRuleCategory,
  PayrollCalcType,
} from './entities/store-payroll-rule.entity';
import { PayrollCalculationMethod } from './entities/store-payroll-setting.entity';
import { PaymentStatus } from './entities/employee-salary.entity';
import { EmploymentStatus } from './entities/employee-profile.entity';
import {
  ShiftAssignmentStatus,
  AttendanceStatus,
} from './entities/shift-management.entity';

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
import {
  StockTransaction,
  StockTransactionDetail,
} from './entities/stock-transaction.entity';
import {
  WorkCycle,
  ShiftSlot,
  ShiftAssignment,
  ShiftSwap,
  CycleShiftTemplate,
} from './entities/shift-management.entity';
import { EmployeeLeaveRequest } from './entities/employee-leave-request.entity';
import { EmployeeFace } from './entities/employee-face.entity';
import { AttendanceLog } from './entities/attendance-log.entity';
import { EmployeeAssetAssignment } from './entities/employee-asset-assignment.entity';
import {
  ServiceCategory,
  ServiceItem,
  ServiceItemRecipe,
} from './entities/service-item.entity';
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
import { ContractTemplate } from './entities/contract-template.entity';

let AccountIdentityDocument: any;
let AccountFinance: any;
try {
  AccountIdentityDocument =
    require('../accounts/entities/account-identity-document.entity').AccountIdentityDocument;
} catch {
  AccountIdentityDocument = class AccountIdentityDocument {};
}
try {
  AccountFinance =
    require('../accounts/entities/account-finance.entity').AccountFinance;
} catch {
  AccountFinance = class AccountFinance {};
}

function mockRepo() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((d: any) => ({ id: 'gen-id', ...d })),
    save: jest.fn((e: any) =>
      Promise.resolve(Array.isArray(e) ? e : { id: 'gen-id', ...e }),
    ),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
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
  Store,
  StoreEmployeeType,
  StoreRole,
  EmployeeProfile,
  EmployeeProfileRole,
  EmployeeContract,
  WorkShift,
  Asset,
  Product,
  AssetUnit,
  ProductUnit,
  MonthlyPayroll,
  SalaryConfig,
  EmployeeSalary,
  KpiType,
  AssetCategory,
  AssetStatus,
  ProductCategory,
  ProductStatus,
  EmployeeKpi,
  KpiUnit,
  KpiPeriod,
  KpiTask,
  DailyEmployeeReport,
  EmployeeMonthlySummary,
  StoreEvent,
  StockTransaction,
  StockTransactionDetail,
  WorkCycle,
  ShiftSlot,
  ShiftAssignment,
  ShiftSwap,
  CycleShiftTemplate,
  ContractTemplate,
  ServiceCategory,
  ServiceItem,
  ServiceItemRecipe,
  Order,
  OrderItem,
  EmployeePerformance,
  EmployeeLeaveRequest,
  EmployeeAssetAssignment,
  EmployeeTerminationReason,
  StoreProbationSetting,
  StoreSkill,
  StorePayrollPaymentHistory,
  SalaryFundHistory,
  SalaryAdvanceRequest,
  SalaryAdjustment,
  SalaryAdjustmentReason,
  EmployeePaymentHistory,
  StorePaymentAccount,
  KpiApprovalRequest,
  InventoryReport,
  AssetExportType,
  ProductExportType,
  StoreApprovalSetting,
  StoreTimekeepingSetting,
  StorePayrollSetting,
  StorePayrollRule,
  StorePayrollIncrementRule,
  AccountIdentityDocument,
  StoreInternalRule,
  StorePermissionConfig,
  StoreShiftConfig,
  CycleShiftTemplate,
  AccountFinance,
  Feedback,
  EmployeeFace,
  AttendanceLog,
  ShiftChangeRequest,
  BonusWorkRequest,
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
        PaymentType.MONTH,
        10_000_000,
        200,
        22,
        true,
        15_000_000,
        30,
      );
      expect(result).toBe(15_000_000);
    });

    it('should calculate HOURLY salary correctly (88h = 50% of full month)', () => {
      const result = calculateBaseSalary(
        PaymentType.HOUR,
        100_000,
        88,
        0,
        false,
        0,
        30,
      );
      expect(result).toBeCloseTo(50_000, 0);
    });

    it('should calculate HOURLY salary correctly (176h = 100%)', () => {
      const result = calculateBaseSalary(
        PaymentType.HOUR,
        100_000,
        176,
        0,
        false,
        0,
        30,
      );
      expect(result).toBe(100_000);
    });

    it('should calculate SHIFT salary correctly', () => {
      const result = calculateBaseSalary(
        PaymentType.SHIFT,
        500_000,
        0,
        22,
        false,
        0,
        30,
      );
      expect(result).toBe(11_000_000);
    });

    it('should calculate DAY salary correctly', () => {
      const result = calculateBaseSalary(
        PaymentType.DAY,
        400_000,
        0,
        20,
        false,
        0,
        30,
      );
      expect(result).toBe(8_000_000);
    });

    it('should calculate MONTH salary (prorated, 30-day month)', () => {
      const result = calculateBaseSalary(
        PaymentType.MONTH,
        10_000_000,
        0,
        10,
        false,
        0,
        30,
      );
      expect(result).toBeCloseTo(3_333_333, 0);
    });

    it('should calculate MONTH salary (prorated, 28-day February)', () => {
      const result = calculateBaseSalary(
        PaymentType.MONTH,
        10_000_000,
        0,
        14,
        false,
        0,
        28,
      );
      expect(result).toBeCloseTo(5_000_000, 0);
    });

    it('should calculate MONTH salary (prorated, 29-day leap February)', () => {
      const result = calculateBaseSalary(
        PaymentType.MONTH,
        10_000_000,
        0,
        15,
        false,
        0,
        29,
      );
      expect(result).toBeCloseTo(5_172_414, 0);
    });

    it('should calculate MONTH salary with 0 shifts = 0', () => {
      const result = calculateBaseSalary(
        PaymentType.MONTH,
        10_000_000,
        0,
        0,
        false,
        0,
        30,
      );
      expect(result).toBe(0);
    });

    it('should use full MONTH salary when shifts >= daysInMonth', () => {
      const result = calculateBaseSalary(
        PaymentType.MONTH,
        10_000_000,
        0,
        30,
        false,
        0,
        30,
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
          penalty += ((calculatedSalary * rule.value) / 100) * rule.count;
        } else if (rule.calcType === PayrollCalcType.AMOUNT) {
          penalty += rule.value * rule.count;
        }
      }
      return penalty;
    }

    it('should apply PERCENTAGE late penalty correctly', () => {
      const salary = 10_000_000;
      const rules = [
        {
          ruleType: 'LATE',
          category: PayrollRuleCategory.FINE,
          calcType: PayrollCalcType.PERCENTAGE,
          value: 5,
          count: 2,
        },
      ];
      const penalty = calculatePenalty(salary, rules);
      // 5% of 10M = 500,000 * 2 = 1,000,000
      expect(penalty).toBe(1_000_000);
    });

    it('should apply AMOUNT late penalty correctly', () => {
      const salary = 10_000_000;
      const rules = [
        {
          ruleType: 'LATE',
          category: PayrollRuleCategory.FINE,
          calcType: PayrollCalcType.AMOUNT,
          value: 50_000,
          count: 3,
        },
      ];
      const penalty = calculatePenalty(salary, rules);
      // 50,000 * 3 = 150,000
      expect(penalty).toBe(150_000);
    });

    it('should apply EARLY penalty', () => {
      const salary = 10_000_000;
      const rules = [
        {
          ruleType: 'EARLY',
          category: PayrollRuleCategory.FINE,
          calcType: PayrollCalcType.PERCENTAGE,
          value: 3,
          count: 2,
        },
      ];
      const penalty = calculatePenalty(salary, rules);
      // 3% of 10M = 300,000 * 2 = 600,000
      expect(penalty).toBe(600_000);
    });

    it('should apply ABSENT penalty', () => {
      const salary = 10_000_000;
      const rules = [
        {
          ruleType: 'ABSENT',
          category: PayrollRuleCategory.FINE,
          calcType: PayrollCalcType.AMOUNT,
          value: 200_000,
          count: 3,
        },
      ];
      const penalty = calculatePenalty(salary, rules);
      // 200,000 * 3 = 600,000
      expect(penalty).toBe(600_000);
    });

    it('should apply multiple penalties simultaneously', () => {
      const salary = 10_000_000;
      const rules = [
        {
          ruleType: 'LATE',
          category: PayrollRuleCategory.FINE,
          calcType: PayrollCalcType.PERCENTAGE,
          value: 5,
          count: 2,
        },
        {
          ruleType: 'EARLY',
          category: PayrollRuleCategory.FINE,
          calcType: PayrollCalcType.PERCENTAGE,
          value: 3,
          count: 1,
        },
        {
          ruleType: 'ABSENT',
          category: PayrollRuleCategory.FINE,
          calcType: PayrollCalcType.AMOUNT,
          value: 200_000,
          count: 2,
        },
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
      const rules = [
        {
          ruleType: 'LATE',
          category: PayrollRuleCategory.FINE,
          calcType: PayrollCalcType.PERCENTAGE,
          value: 5,
          count: 0,
        },
      ];
      const penalty = calculatePenalty(salary, rules);
      expect(penalty).toBe(0);
    });

    it('should NOT apply BONUS rules as penalty', () => {
      const salary = 10_000_000;
      const rules = [
        {
          ruleType: 'ATTENDANCE',
          category: PayrollRuleCategory.BONUS,
          calcType: PayrollCalcType.AMOUNT,
          value: 200_000,
          count: 1,
        },
      ];
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
          bonus += ((calculatedSalary * rule.value) / 100) * rule.count;
        } else if (rule.calcType === PayrollCalcType.AMOUNT) {
          bonus += rule.value * rule.count;
        }
      }
      return bonus;
    }

    it('should apply BONUS with AMOUNT', () => {
      const salary = 10_000_000;
      const rules = [
        {
          ruleType: 'ATTENDANCE',
          category: PayrollRuleCategory.BONUS,
          calcType: PayrollCalcType.AMOUNT,
          value: 200_000,
          count: 1,
        },
      ];
      expect(calculateBonus(salary, rules)).toBe(200_000);
    });

    it('should apply BONUS with PERCENTAGE', () => {
      const salary = 10_000_000;
      const rules = [
        {
          ruleType: 'KPI',
          category: PayrollRuleCategory.BONUS,
          calcType: PayrollCalcType.PERCENTAGE,
          value: 10,
          count: 1,
        },
      ];
      expect(calculateBonus(salary, rules)).toBe(1_000_000);
    });

    it('should NOT apply FINE rules as bonus', () => {
      const salary = 10_000_000;
      const rules = [
        {
          ruleType: 'LATE',
          category: PayrollRuleCategory.FINE,
          calcType: PayrollCalcType.PERCENTAGE,
          value: 5,
          count: 2,
        },
      ];
      expect(calculateBonus(salary, rules)).toBe(0);
    });
  });

  describe('netSalary floor', () => {
    function calculateNetSalary(
      calculatedSalary: number,
      bonus: number,
      penalty: number,
    ): number {
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
    }): {
      calculatedSalary: number;
      penalty: number;
      bonus: number;
      netSalary: number;
    } {
      const STANDARD_MONTHLY_HOURS = 176;
      let calculatedSalary = 0;
      if (params.hasShiftEarnings) {
        calculatedSalary = params.totalShiftEarnings;
      } else if (params.paymentType === PaymentType.HOUR) {
        calculatedSalary =
          params.baseSalary * (params.workingHours / STANDARD_MONTHLY_HOURS);
      } else if (
        params.paymentType === PaymentType.SHIFT ||
        params.paymentType === PaymentType.DAY
      ) {
        calculatedSalary = params.baseSalary * params.completedShifts;
      } else {
        calculatedSalary =
          params.daysInMonth > 0
            ? params.baseSalary * (params.completedShifts / params.daysInMonth)
            : params.baseSalary;
      }

      let penalty = 0;
      let bonus = 0;
      for (const rule of params.rules) {
        if (rule.count <= 0) continue;
        if (rule.calcType === PayrollCalcType.PERCENTAGE) {
          const amount = ((calculatedSalary * rule.value) / 100) * rule.count;
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
        rules: [
          {
            ruleType: 'LATE',
            category: PayrollRuleCategory.FINE,
            calcType: PayrollCalcType.PERCENTAGE,
            value: 5,
            count: 2,
          },
        ],
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
        rules: [
          {
            ruleType: 'ATTENDANCE',
            category: PayrollRuleCategory.BONUS,
            calcType: PayrollCalcType.AMOUNT,
            value: 200_000,
            count: 1,
          },
        ],
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
          {
            ruleType: 'ABSENT',
            category: PayrollRuleCategory.FINE,
            calcType: PayrollCalcType.AMOUNT,
            value: 200_000,
            count: 4,
          },
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
        {
          provide: ShiftReminderService,
          useValue: { scheduleReminder: jest.fn(), cancelReminder: jest.fn() },
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

// ─── Bug fix regression tests ───────────────────────────────────────────────
// createMonthlyPayrollForStore / recalculatePayroll / checkOutWithFace used to
// (1) skip recalculating an EmployeeSalary just because a row already
//     existed, regardless of paymentStatus, silently freezing salaries that
//     were never approved/paid, and
// (2) let the real-time check-out update create an EmployeeSalary with no
//     monthlyPayrollId if no MonthlyPayroll existed yet, making it invisible
//     to getEmployeeSalariesByStore/getPayrollSummary.
// These tests lock in the fix: PAID/APPROVED salaries are never touched, and
// every write path always ends up linked to a MonthlyPayroll.
describe('StoresService - Payroll upsert protection & orphan fix', () => {
  let service: StoresService;
  let payrollRepo: any;
  let employeeSalaryRepo: any;
  let profileRepo: any;

  const STORE_ID = 'store-1';
  const EMPLOYEE_ID = 'emp-1';
  const MONTH = new Date(2026, 6, 1); // July 2026 (month is 0-indexed)

  const activeEmployee = {
    id: EMPLOYEE_ID,
    storeId: STORE_ID,
    employmentStatus: EmploymentStatus.ACTIVE,
    contracts: [
      {
        id: 'contract-1',
        isActive: true,
        salaryAmount: 10_000_000,
        paymentType: PaymentType.MONTH,
        allowances: {},
      },
    ],
  };

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
        {
          provide: ShiftReminderService,
          useValue: { scheduleReminder: jest.fn(), cancelReminder: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<StoresService>(StoresService);
    payrollRepo = repoMap.get(MonthlyPayroll);
    employeeSalaryRepo = repoMap.get(EmployeeSalary);
    profileRepo = repoMap.get(EmployeeProfile);

    profileRepo.find.mockResolvedValue([activeEmployee]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createMonthlyPayrollForStore', () => {
    it('does NOT overwrite an EmployeeSalary that is already PAID', async () => {
      const paidSalary = {
        id: 'salary-1',
        employeeProfileId: EMPLOYEE_ID,
        month: MONTH,
        monthlyPayrollId: 'payroll-1',
        paymentStatus: PaymentStatus.PAID,
        netSalary: 9_999_999,
        bonus: 0,
        penalty: 0,
      };
      employeeSalaryRepo.findOne.mockResolvedValue(paidSalary);
      payrollRepo.findOne.mockResolvedValue({
        id: 'payroll-1',
        storeId: STORE_ID,
        month: MONTH,
      });

      const result = await service.createMonthlyPayrollForStore(
        STORE_ID,
        MONTH,
      );

      // Should never call update/create/save on the protected salary record.
      expect(employeeSalaryRepo.update).not.toHaveBeenCalled();
      expect(employeeSalaryRepo.create).not.toHaveBeenCalled();
      expect(employeeSalaryRepo.save).not.toHaveBeenCalled();
      // Its existing net salary is still folded into the payroll total.
      expect(result.estimatedPayment).toBe(9_999_999);
    });

    it('backfills monthlyPayrollId on an orphaned PAID salary without recalculating it', async () => {
      const orphanedPaidSalary = {
        id: 'salary-1',
        employeeProfileId: EMPLOYEE_ID,
        month: MONTH,
        monthlyPayrollId: null,
        paymentStatus: PaymentStatus.PAID,
        netSalary: 5_000_000,
        bonus: 0,
        penalty: 0,
      };
      employeeSalaryRepo.findOne.mockResolvedValue(orphanedPaidSalary);
      payrollRepo.findOne.mockResolvedValue({
        id: 'payroll-1',
        storeId: STORE_ID,
        month: MONTH,
      });

      await service.createMonthlyPayrollForStore(STORE_ID, MONTH);

      expect(employeeSalaryRepo.update).toHaveBeenCalledWith(
        'salary-1',
        expect.objectContaining({ monthlyPayrollId: 'payroll-1' }),
      );
      // update is only called with the backfill payload, no salary fields.
      expect(employeeSalaryRepo.update).toHaveBeenCalledTimes(1);
    });

    it('recalculates and updates in place a PENDING salary instead of skipping/duplicating it', async () => {
      const pendingSalary = {
        id: 'salary-1',
        employeeProfileId: EMPLOYEE_ID,
        month: MONTH,
        monthlyPayrollId: 'payroll-1',
        paymentStatus: PaymentStatus.PENDING,
        netSalary: 1_000_000, // stale low value from an earlier partial month
        bonus: 0,
        penalty: 0,
      };
      employeeSalaryRepo.findOne.mockResolvedValue(pendingSalary);
      payrollRepo.findOne.mockResolvedValue({
        id: 'payroll-1',
        storeId: STORE_ID,
        month: MONTH,
      });

      await service.createMonthlyPayrollForStore(STORE_ID, MONTH);

      // Must update the existing row (not insert a duplicate).
      expect(employeeSalaryRepo.create).not.toHaveBeenCalled();
      expect(employeeSalaryRepo.update).toHaveBeenCalledWith(
        'salary-1',
        expect.objectContaining({ monthlyPayrollId: 'payroll-1' }),
      );
    });

    it('creates a fresh EmployeeSalary when none exists yet, linked to the MonthlyPayroll', async () => {
      employeeSalaryRepo.findOne.mockResolvedValue(null);
      payrollRepo.findOne.mockResolvedValue(null); // no MonthlyPayroll yet either

      await service.createMonthlyPayrollForStore(STORE_ID, MONTH);

      expect(payrollRepo.create).toHaveBeenCalled();
      expect(employeeSalaryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeProfileId: EMPLOYEE_ID,
          monthlyPayrollId: 'gen-id',
        }),
      );
    });
  });

  describe('createMonthlyPayrollsForAllStores', () => {
    it('reconciles the previous month and scaffolds the current month for each store', async () => {
      const spy = jest.spyOn(service, 'createMonthlyPayrollForStore');
      (service as any).storeRepository.find = jest
        .fn()
        .mockResolvedValue([{ id: STORE_ID, status: 'active' }]);
      payrollRepo.findOne.mockResolvedValue({
        id: 'payroll-1',
        storeId: STORE_ID,
        month: MONTH,
      });

      const now = new Date(2026, 6, 1); // "now" = July 1st
      await service.createMonthlyPayrollsForAllStores(now);

      // Called twice per store: once for the previous month (June), once for "now" (July).
      expect(spy).toHaveBeenCalledTimes(2);
      const calledMonths = spy.mock.calls.map((args) =>
        (args[1] as Date).getMonth(),
      );
      expect(calledMonths).toEqual([5, 6]); // June (5), July (6)
    });
  });
});

describe('StoresService - deferred checkout payroll', () => {
  let service: StoresService;
  let shiftAssignmentRepo: any;
  let employeeFaceRepo: any;
  let payrollRepo: any;
  let employeeSalaryRepo: any;
  let profileRepo: any;
  let faceService: any;

  const STORE_ID = 'store-1';
  const EMPLOYEE_ID = 'emp-1';

  const baseAssignment = {
    id: 'assignment-1',
    employeeId: EMPLOYEE_ID,
    checkInTime: new Date('2026-07-01T08:00:00'),
    checkOutTime: null,
    status: ShiftAssignmentStatus.CONFIRMED,
    attendanceStatus: AttendanceStatus.ON_TIME,
    lateMinutes: 0,
    shiftSlot: {
      workDate: '2026-07-01',
      workShift: { startTime: '08:00', endTime: '17:00' },
      cycle: { storeId: STORE_ID },
    },
  };

  const activeEmployee = {
    id: EMPLOYEE_ID,
    contracts: [
      {
        id: 'contract-1',
        isActive: true,
        salaryAmount: 10_000_000,
        paymentType: PaymentType.MONTH,
        allowances: {},
      },
    ],
  };

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
            extractDescriptor: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
            compareFaces: jest
              .fn()
              .mockReturnValue({ matched: true, distance: 0.3 }),
          },
        },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(async (callback) => {
              const queryBuilder = {
                update: jest.fn().mockReturnThis(),
                set: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                execute: jest.fn().mockResolvedValue({ affected: 1 }),
              };
              return callback({
                createQueryBuilder: jest.fn(() => queryBuilder),
                create: jest.fn((_entity, value) => value),
                save: jest.fn().mockResolvedValue(undefined),
                findOne: jest.fn(),
              });
            }),
          },
        },
        {
          provide: ShiftReminderService,
          useValue: { scheduleReminder: jest.fn(), cancelReminder: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<StoresService>(StoresService);
    shiftAssignmentRepo = repoMap.get(ShiftAssignment);
    employeeFaceRepo = repoMap.get(EmployeeFace);
    payrollRepo = repoMap.get(MonthlyPayroll);
    employeeSalaryRepo = repoMap.get(EmployeeSalary);
    profileRepo = repoMap.get(EmployeeProfile);
    faceService = service['faceRecognitionService'];

    shiftAssignmentRepo.findOne.mockResolvedValue({ ...baseAssignment });
    employeeFaceRepo.findOne.mockResolvedValue({
      employeeProfileId: EMPLOYEE_ID,
      faceDescriptors: [[0.1, 0.2, 0.3]],
      isActive: true,
    });
    profileRepo.findOne.mockResolvedValue(activeEmployee);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns immediately without touching payroll repositories', async () => {
    const result = await service.checkOutWithFace(
      'assignment-1',
      Buffer.from('fake'),
    );

    expect(result).toEqual(
      expect.objectContaining({ matched: true, payrollProcessing: true }),
    );
    expect(payrollRepo.findOne).not.toHaveBeenCalled();
    expect(employeeSalaryRepo.findOne).not.toHaveBeenCalled();
    expect(employeeSalaryRepo.save).not.toHaveBeenCalled();
  });

  it('returns an idempotent success when checkout was already recorded', async () => {
    shiftAssignmentRepo.findOne.mockResolvedValue({
      ...baseAssignment,
      checkOutTime: new Date('2026-07-01T17:00:00'),
      workedMinutes: 540,
      status: ShiftAssignmentStatus.COMPLETED,
    });

    const result = await service.checkOutWithFace(
      'assignment-1',
      Buffer.from('fake'),
    );

    expect(result).toEqual(
      expect.objectContaining({ matched: true, alreadyRecorded: true }),
    );
    expect(faceService.extractDescriptor).not.toHaveBeenCalled();
  });

  it('does not persist attendance when the face does not match', async () => {
    faceService.compareFaces.mockReturnValue({ matched: false, distance: 0.9 });

    const result = await service.checkOutWithFace(
      'assignment-1',
      Buffer.from('fake'),
    );

    expect(result).toEqual(expect.objectContaining({ matched: false }));
    expect(profileRepo.update).not.toHaveBeenCalled();
  });
});
