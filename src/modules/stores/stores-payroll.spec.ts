import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StoresService, monthlyPayrollLockKey } from './stores.service';
import { AccountsService } from '../accounts/accounts.service';
import { FaceRecognitionService } from './face-recognition.service';
import { ShiftReminderService } from './shift-reminder.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentType } from './entities/employee-contract.entity';
import {
  PayrollRuleCategory,
  PayrollCalcType,
} from './entities/store-payroll-rule.entity';
import { computeEarnedBase } from './payroll-calculation.utils';
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
import {
  EmployeeLeaveRequest,
  LeaveRequestStatus,
  LeaveType,
} from './entities/employee-leave-request.entity';
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

/** A query builder whose SUM query resolves to `raw`. */
function sumQuery(raw: Record<string, string>) {
  const qb: any = {};
  for (const method of ['select', 'addSelect', 'where', 'andWhere']) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getRawOne = jest.fn().mockResolvedValue(raw);
  return qb;
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
    upsert: jest.fn().mockResolvedValue(undefined),
    restore: jest.fn().mockResolvedValue({ affected: 1 }),
    count: jest.fn().mockResolvedValue(0),
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
   * Pure unit tests of the payroll formulas. The earned-base cases call the
   * production `computeEarnedBase` (payroll-calculation.utils.ts), which every
   * payroll path now shares:
   * - HOURLY:  salaryAmount × hours worked            (no longer ÷ 176)
   * - SHIFT:   salaryAmount × completedShifts
   * - DAY:     salaryAmount × completedShifts
   * - WEEK:    salaryAmount × completedShifts ÷ 6
   * - MONTH:   salaryAmount × daysWorked ÷ standard working days
   *            (calendar days when the store has no days-off config)
   * Stored per-shift `shiftEarnings` are display figures and no longer
   * override the monthly total.
   *
   * Late/Early penalty (PERCENTAGE): (calculatedSalary * value/100) * count
   * Late/Early penalty (AMOUNT):     value * count
   * Absent penalty (AMOUNT):         value * absentCount
   *
   * netSalary = calculatedSalary + allowances + bonus - penalties
   * netSalary >= 0 (floored at zero)
   */
  describe('calculateBaseSalary (computeEarnedBase)', () => {
    function calculateBaseSalary(
      paymentType: PaymentType,
      baseSalary: number,
      workingHours: number,
      completedShifts: number,
      daysInMonth: number,
      daysWorked = completedShifts,
    ): number {
      return computeEarnedBase({
        paymentType,
        rate: baseSalary,
        facts: {
          completedShifts,
          workedMinutes: workingHours * 60,
          daysWorked,
        },
        standardWorkingDays: 0,
        calendarDays: daysInMonth,
      });
    }

    // Changed: stored shift earnings used to win over the formula. The
    // monthly figure is now always computed from monthly totals.
    it('ignores stored shift earnings and computes MONTH from days worked', () => {
      const result = calculateBaseSalary(PaymentType.MONTH, 10_000_000, 200, 22, 30);
      expect(result).toBe(7_333_333);
    });

    // Changed: HOURLY was salaryAmount × hours / 176 (a monthly salary
    // prorated by hours). Approved rule: hourly pay = rate × hours worked.
    it('should calculate HOURLY salary as rate × hours (88h)', () => {
      const result = calculateBaseSalary(PaymentType.HOUR, 100_000, 88, 0, 30);
      expect(result).toBe(8_800_000);
    });

    it('should calculate HOURLY salary as rate × hours (176h)', () => {
      const result = calculateBaseSalary(PaymentType.HOUR, 100_000, 176, 0, 30);
      expect(result).toBe(17_600_000);
    });

    it('should calculate SHIFT salary correctly', () => {
      const result = calculateBaseSalary(PaymentType.SHIFT, 500_000, 0, 22, 30);
      expect(result).toBe(11_000_000);
    });

    it('should calculate DAY salary correctly', () => {
      const result = calculateBaseSalary(PaymentType.DAY, 400_000, 0, 20, 30);
      expect(result).toBe(8_000_000);
    });

    it('should calculate MONTH salary (prorated, 30-day month)', () => {
      const result = calculateBaseSalary(PaymentType.MONTH, 10_000_000, 0, 10, 30);
      expect(result).toBe(3_333_333);
    });

    it('should calculate MONTH salary (prorated, 28-day February)', () => {
      const result = calculateBaseSalary(PaymentType.MONTH, 10_000_000, 0, 14, 28);
      expect(result).toBe(5_000_000);
    });

    it('should calculate MONTH salary (prorated, 29-day leap February)', () => {
      const result = calculateBaseSalary(PaymentType.MONTH, 10_000_000, 0, 15, 29);
      expect(result).toBe(5_172_414);
    });

    it('should calculate MONTH salary with 0 shifts = 0', () => {
      const result = calculateBaseSalary(PaymentType.MONTH, 10_000_000, 0, 0, 30);
      expect(result).toBe(0);
    });

    it('should use full MONTH salary when shifts >= daysInMonth', () => {
      const result = calculateBaseSalary(PaymentType.MONTH, 10_000_000, 0, 30, 30);
      expect(result).toBe(10_000_000);
    });

    it('counts distinct days, not shifts, for MONTH', () => {
      // 30 shifts over 15 days of a 30-day month = half the salary.
      const result = calculateBaseSalary(PaymentType.MONTH, 10_000_000, 0, 30, 30, 15);
      expect(result).toBe(5_000_000);
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
      // Stored shift earnings no longer override the monthly figure; the
      // earned base comes from the shared production formula.
      const calculatedSalary = computeEarnedBase({
        paymentType: params.paymentType,
        rate: params.baseSalary,
        facts: {
          completedShifts: params.completedShifts,
          workedMinutes: params.workingHours * 60,
          daysWorked: params.completedShifts,
        },
        standardWorkingDays: 0,
        calendarDays: params.daysInMonth,
      });

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
      // calculatedSalary = round(10M * 20/30) = 6,666,667
      expect(result.calculatedSalary).toBe(6_666_667);
      // penalty = (6,666,667 * 5% * 2) = 666,667
      expect(result.penalty).toBeCloseTo(666_667, 0);
      // net = 6,666,667 - 666,667 = 6,000,000
      expect(result.netSalary).toBeCloseTo(6_000_000, 0);
    });

    // Changed: stored shift earnings (20M) used to win; hourly pay is now
    // rate × hours = 100,000 × 176h = 17,600,000.
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
      expect(result.calculatedSalary).toBe(17_600_000);
      expect(result.bonus).toBe(200_000);
      expect(result.penalty).toBe(0);
      expect(result.netSalary).toBe(17_800_000);
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
          // Without a working transaction, `findOrCreateMonthlyPayroll` threw
          // and `createMonthlyPayrollsForAllStores` swallowed the error, so
          // these assertions passed against a failure path.
          provide: DataSource,
          useValue: {
            transaction: (callback: (manager: any) => unknown) =>
              Promise.resolve(
                callback({
                  query: jest.fn().mockResolvedValue([]),
                  getRepository: (entity: any) => repoMap.get(entity),
                }),
              ),
          },
        },
        {
          provide: ShiftReminderService,
          useValue: { scheduleReminder: jest.fn(), cancelReminder: jest.fn() },
        },
        {
          // Appended to the StoresService constructor so shift self-registration
          // can tell the owner. Stubbed here: these suites assert service logic,
          // not delivery.
          provide: NotificationsService,
          useValue: { create: jest.fn().mockResolvedValue({}) },
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
          // `findOrCreateMonthlyPayroll` opens its own transaction and takes a
          // per-(store, month) advisory lock when no manager is passed in. An
          // empty DataSource made every test through that path fail on
          // `this.dataSource.transaction is not a function`, so the suite never
          // reached the upsert-protection assertions it was written for.
          provide: DataSource,
          useValue: {
            transaction: (callback: (manager: any) => unknown) =>
              Promise.resolve(
                callback({
                  // pg_advisory_xact_lock is a no-op against mocked repos.
                  query: jest.fn().mockResolvedValue([]),
                  getRepository: (entity: any) => repoMap.get(entity),
                }),
              ),
          },
        },
        {
          provide: ShiftReminderService,
          useValue: { scheduleReminder: jest.fn(), cancelReminder: jest.fn() },
        },
        {
          provide: NotificationsService,
          useValue: { create: jest.fn().mockResolvedValue({}) },
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
      // Payroll totals are now a SQL SUM over the payslips linked to it
      // (previously accumulated in the loop); the mocked SUM returns the
      // protected payslip's net.
      employeeSalaryRepo.createQueryBuilder.mockReturnValue(
        sumQuery({ estimatedPayment: '9999999', totalBonus: '0', totalPenalty: '0' }),
      );

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
      // The cron now calls the shared rebuild with Vietnam months.
      const spy = jest.spyOn(service as any, 'rebuildStorePayrollForMonth');
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
      const calledMonths = spy.mock.calls.map((args: any[]) => args[1].key);
      expect(calledMonths).toEqual(['2026-06-01', '2026-07-01']);
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
  const ACCOUNT_ID = 'account-1';

  const baseAssignment = {
    id: 'assignment-1',
    employeeId: EMPLOYEE_ID,
    // Attendance is self-service, so the assignment must carry its owner.
    employee: {
      accountId: ACCOUNT_ID,
      employmentStatus: EmploymentStatus.ACTIVE,
    },
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
        {
          provide: NotificationsService,
          useValue: { create: jest.fn().mockResolvedValue({}) },
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
      ACCOUNT_ID,
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
      ACCOUNT_ID,
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
      ACCOUNT_ID,
    );

    expect(result).toEqual(expect.objectContaining({ matched: false }));
    expect(profileRepo.update).not.toHaveBeenCalled();
  });
});

// ─── Phase 2: payroll money correctness ─────────────────────────────────────
// Regressions for: recalculation deleting payslips (and, through the FK
// cascade, their salary advances); month/day boundaries read from the server
// clock; and the payroll paths disagreeing on the formula.

async function buildPayrollHarness() {
  const repoMap = new Map<any, ReturnType<typeof mockRepo>>();
  const providers = ENTITIES.map((entity) => {
    const mock = mockRepo();
    repoMap.set(entity, mock);
    return { provide: getRepositoryToken(entity), useValue: mock };
  });
  const managers: any[] = [];
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      StoresService,
      ...providers,
      {
        provide: AccountsService,
        useValue: { findById: jest.fn(), findByEmail: jest.fn() },
      },
      { provide: FaceRecognitionService, useValue: {} },
      {
        // Deliberately exposes only `query` and `getRepository`: any attempt
        // to run a raw DELETE through the manager fails the test.
        provide: DataSource,
        useValue: {
          transaction: (callback: (manager: any) => unknown) => {
            const manager = {
              query: jest.fn().mockResolvedValue([]),
              getRepository: (entity: any) => repoMap.get(entity),
            };
            managers.push(manager);
            return Promise.resolve(callback(manager));
          },
        },
      },
      {
        provide: ShiftReminderService,
        useValue: { scheduleReminder: jest.fn(), cancelReminder: jest.fn() },
      },
      {
        provide: NotificationsService,
        useValue: { create: jest.fn().mockResolvedValue({}) },
      },
    ],
  }).compile();
  return {
    service: module.get<StoresService>(StoresService),
    repo: (entity: any) => repoMap.get(entity)!,
    managers,
  };
}

/** Query builder whose getMany resolves to `rows` (records bound params). */
function listQuery(rows: any[]) {
  const qb: any = {};
  for (const method of [
    'leftJoinAndSelect',
    'innerJoin',
    'where',
    'andWhere',
    'select',
    'addSelect',
  ]) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getMany = jest.fn().mockResolvedValue(rows);
  qb.getRawOne = jest.fn().mockResolvedValue(null);
  return qb;
}

/** COMPLETED assignments, one per listed work date. */
function completedOn(dates: string[]) {
  return dates.map((workDate, i) => ({
    id: `sa-${i}`,
    status: ShiftAssignmentStatus.COMPLETED,
    checkInTime: new Date(`${workDate}T01:00:00Z`),
    workedMinutes: 480,
    lateMinutes: 0,
    earlyMinutes: 0,
    shiftSlot: { workDate },
  }));
}

const julyDates = Array.from(
  { length: 31 },
  (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`,
);

describe('StoresService - payroll rebuild never deletes payslips', () => {
  const STORE_ID = 'store-1';
  const EMPLOYEE_ID = 'emp-1';
  const monthlyEmployee = {
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

  afterEach(() => jest.clearAllMocks());

  it('keeps an approved advance when recalculating', async () => {
    const h = await buildPayrollHarness();
    const salaryRepo = h.repo(EmployeeSalary);
    h.repo(EmployeeProfile).find.mockResolvedValue([monthlyEmployee]);
    h.repo(MonthlyPayroll).findOne.mockResolvedValue({ id: 'payroll-1' });
    salaryRepo.findOne.mockResolvedValue({
      id: 's1',
      employeeProfileId: EMPLOYEE_ID,
      monthlyPayrollId: 'payroll-1',
      paymentStatus: PaymentStatus.PENDING,
      otherDeductions: 0,
    });
    h.repo(SalaryAdvanceRequest).find.mockResolvedValue([
      { approvedAmount: 1_000_000, requestedAmount: 1_000_000 },
    ]);
    // Every day of July worked; no days-off config → 31 calendar days.
    h.repo(ShiftAssignment).createQueryBuilder.mockReturnValue(
      listQuery(completedOn(julyDates)),
    );

    await h.service.recalculatePayroll(STORE_ID, '2026-07-01');

    expect(salaryRepo.delete).not.toHaveBeenCalled();
    expect(salaryRepo.save).not.toHaveBeenCalled();
    expect(salaryRepo.update).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        earnedBaseSalary: 10_000_000,
        totalIncome: 10_000_000,
        advancePayment: 1_000_000,
        totalDeductions: 1_000_000,
        netSalary: 9_000_000,
        workingDays: 31,
      }),
    );
    // The row is loaded under lock, including soft-deleted rows.
    expect(salaryRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        withDeleted: true,
        lock: { mode: 'pessimistic_write' },
      }),
    );
    // The per-(store, month) advisory lock uses the Vietnam month.
    // C3: unpadded month, the pre-refactor key format, so old and new
    // instances contend on the same lock during a rolling deploy.
    expect(h.managers[0].query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      [`monthly-payroll:${STORE_ID}:2026-7`],
    );
  });

  // Regression: the no-contract branch always INSERTed, violating the unique
  // (employee, month) key when a PENDING row existed and rolling back the
  // whole recalculation.
  it('updates, not inserts, the payslip of an employee without a contract', async () => {
    const h = await buildPayrollHarness();
    const salaryRepo = h.repo(EmployeeSalary);
    h.repo(EmployeeProfile).find.mockResolvedValue([
      { ...monthlyEmployee, contracts: [] },
    ]);
    h.repo(MonthlyPayroll).findOne.mockResolvedValue({ id: 'payroll-1' });
    salaryRepo.findOne.mockResolvedValue({
      id: 's1',
      paymentStatus: PaymentStatus.PENDING,
    });

    await h.service.recalculatePayroll(STORE_ID, '2026-07-01');

    expect(salaryRepo.save).not.toHaveBeenCalled();
    expect(salaryRepo.update).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ earnedBaseSalary: 0, netSalary: 0 }),
    );
  });

  it('finds, updates and restores a soft-deleted PENDING payslip', async () => {
    const h = await buildPayrollHarness();
    const salaryRepo = h.repo(EmployeeSalary);
    h.repo(EmployeeProfile).find.mockResolvedValue([monthlyEmployee]);
    h.repo(MonthlyPayroll).findOne.mockResolvedValue({ id: 'payroll-1' });
    salaryRepo.findOne.mockResolvedValue({
      id: 's1',
      paymentStatus: PaymentStatus.PENDING,
      deletedAt: new Date('2026-07-10T00:00:00Z'),
    });

    await h.service.createMonthlyPayrollForStore(STORE_ID, '2026-07');

    expect(salaryRepo.save).not.toHaveBeenCalled();
    expect(salaryRepo.update).toHaveBeenCalledWith('s1', expect.any(Object));
    expect(salaryRepo.restore).toHaveBeenCalledWith('s1');
  });

  it('rejects an invalid month instead of guessing', async () => {
    const h = await buildPayrollHarness();
    await expect(
      h.service.recalculatePayroll(STORE_ID, '13/2026'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // Regression: on a UTC host the 00:10 VN cron on the 1st saw the previous
  // month, re-closed the month before last and never scaffolded the new one.
  it('uses Vietnam months at the cron boundary', async () => {
    const h = await buildPayrollHarness();
    h.repo(Store).find.mockResolvedValue([{ id: STORE_ID }]);
    const spy = jest
      .spyOn(h.service as any, 'rebuildStorePayrollForMonth')
      .mockResolvedValue({ id: 'payroll-1' });

    await h.service.createMonthlyPayrollsForAllStores(
      new Date('2026-08-31T17:10:00Z'), // 00:10 on 1 September in Vietnam
    );

    expect(spy.mock.calls.map((args: any[]) => args[1].key)).toEqual([
      '2026-08-01',
      '2026-09-01',
    ]);
  });

  it('refuses to delete a payslip or payroll that has advance requests', async () => {
    const h = await buildPayrollHarness();
    h.repo(SalaryAdvanceRequest).count.mockResolvedValue(1);
    await expect(h.service.deleteEmployeeSalary('s1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(h.repo(EmployeeSalary).delete).not.toHaveBeenCalled();

    const countQuery: any = {};
    for (const method of ['innerJoin', 'where', 'withDeleted']) {
      countQuery[method] = jest.fn().mockReturnValue(countQuery);
    }
    countQuery.getCount = jest.fn().mockResolvedValue(2);
    h.repo(SalaryAdvanceRequest).createQueryBuilder.mockReturnValue(countQuery);
    await expect(h.service.deletePayroll('payroll-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(h.repo(MonthlyPayroll).delete).not.toHaveBeenCalled();
    // C4: soft-deleted payslips and advances still hold the foreign key.
    expect(countQuery.withDeleted).toHaveBeenCalled();
    expect(h.repo(SalaryAdvanceRequest).count).toHaveBeenCalledWith({
      where: { employeeSalaryId: 's1' },
      withDeleted: true,
    });
  });
});

describe('StoresService - checkout payroll uses the shift work date', () => {
  afterEach(() => jest.clearAllMocks());

  // Regression: the payslip month came from the check-out instant's local
  // month, so an overnight shift on 31 August updated September.
  it('files an overnight shift under the month it started in', async () => {
    const h = await buildPayrollHarness();
    const assignmentRepo = h.repo(ShiftAssignment);
    assignmentRepo.findOne.mockResolvedValue({
      id: 'assignment-1',
      employeeId: 'emp-1',
      status: ShiftAssignmentStatus.COMPLETED,
      checkOutTime: new Date('2026-08-31T23:30:00Z'), // 06:30 on 1 Sep VN
      workedMinutes: 480,
      shiftEarnings: null,
      shiftSlot: { workDate: '2026-08-31', cycle: { storeId: 'store-1' } },
      employee: {
        contracts: [
          {
            id: 'contract-1',
            isActive: true,
            salaryAmount: 3_100_000,
            paymentType: PaymentType.MONTH,
            allowances: {},
          },
        ],
      },
    });
    h.repo(MonthlyPayroll).findOne.mockResolvedValue({ id: 'payroll-1' });

    await h.service.processCheckoutPayroll('assignment-1');

    const attendanceQuery = assignmentRepo.createQueryBuilder.mock.results[0].value;
    expect(attendanceQuery.andWhere).toHaveBeenCalledWith(
      'slot.workDate >= :monthStart',
      { monthStart: '2026-08-01' },
    );
    expect(attendanceQuery.andWhere).toHaveBeenCalledWith(
      'slot.workDate < :monthEnd',
      { monthEnd: '2026-09-01' },
    );

    const [summary] = h.repo(EmployeeMonthlySummary).upsert.mock.calls[0];
    expect(summary.month.getFullYear()).toBe(2026);
    expect(summary.month.getMonth()).toBe(7); // August

    const inserted = h.repo(EmployeeSalary).create.mock.calls[0][0];
    expect(inserted.month.getMonth()).toBe(7);
    expect(inserted.monthlyPayrollId).toBe('payroll-1');

    // Day rate over August's 31 calendar days (no days-off config).
    expect(assignmentRepo.update).toHaveBeenCalledWith('assignment-1', {
      shiftEarnings: 100_000,
    });
  });
});

describe('StoresService - checkout payroll reads under the payroll lock (C1)', () => {
  afterEach(() => jest.clearAllMocks());

  it('reads attendance and pay inputs on the transaction manager, after the lock', async () => {
    const h = await buildPayrollHarness();
    const assignmentRepo = h.repo(ShiftAssignment);
    assignmentRepo.findOne.mockResolvedValue({
      id: 'assignment-1',
      employeeId: 'emp-1',
      status: ShiftAssignmentStatus.COMPLETED,
      checkOutTime: new Date('2026-08-20T10:00:00Z'),
      workedMinutes: 480,
      shiftEarnings: null,
      shiftSlot: { workDate: '2026-08-20', cycle: { storeId: 'store-1' } },
      employee: {
        contracts: [
          {
            id: 'contract-1',
            isActive: true,
            salaryAmount: 3_100_000,
            paymentType: PaymentType.MONTH,
            allowances: {},
          },
        ],
      },
    });
    h.repo(MonthlyPayroll).findOne.mockResolvedValue({ id: 'payroll-1' });

    const order: string[] = [];
    const manager = {
      query: jest.fn(async () => {
        order.push('lock');
        return [];
      }),
      getRepository: jest.fn((entity: any) => {
        order.push(`manager:${entity.name}`);
        return h.repo(entity);
      }),
    };
    (h.service as any).dataSource = {
      transaction: (callback: (m: any) => unknown) =>
        Promise.resolve(callback(manager)),
    };

    await h.service.processCheckoutPayroll('assignment-1');

    const lock = order.indexOf('lock');
    expect(lock).toBeGreaterThanOrEqual(0);
    for (const entity of [
      'ShiftAssignment',
      'SalaryAdjustment',
      'StorePayrollRule',
      'StoreShiftConfig',
      'EmployeeSalary',
    ]) {
      expect(order.indexOf(`manager:${entity}`)).toBeGreaterThan(lock);
    }
    // The attendance query was built from the manager's repository.
    const attendanceQuery = assignmentRepo.createQueryBuilder.mock.results[0].value;
    expect(attendanceQuery.andWhere).toHaveBeenCalledWith(
      'slot.workDate >= :monthStart',
      { monthStart: '2026-08-01' },
    );
    // No pay input is read outside the transaction.
    expect(h.repo(StorePayrollRule).find).toHaveBeenCalledTimes(1);
    expect(h.repo(StoreShiftConfig).findOne).toHaveBeenCalledTimes(1);
  });

  it('keys the advisory lock as <year>-<unpadded month>', () => {
    expect(
      monthlyPayrollLockKey('store-1', {
        year: 2026,
        monthIndex: 8,
      } as any),
    ).toBe('monthly-payroll:store-1:2026-9');
  });
});

const FAKE_TIMER_KEEP_ASYNC = [
  'nextTick',
  'setImmediate',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'queueMicrotask',
] as const;

describe('StoresService - live estimate equals the persisted payslip', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('returns the same net salary that generation writes', async () => {
    // 25 July VN: July is the current month, shown live.
    jest.useFakeTimers({
      now: new Date('2026-07-25T03:00:00Z'),
      doNotFake: [...FAKE_TIMER_KEEP_ASYNC],
    });
    const h = await buildPayrollHarness();
    const employee = {
      id: 'emp-1',
      storeId: 'store-1',
      employmentStatus: EmploymentStatus.ACTIVE,
      contracts: [
        {
          id: 'contract-1',
          isActive: true,
          salaryAmount: 10_000_000,
          paymentType: PaymentType.MONTH,
          allowances: { an: 500_000 },
        },
      ],
    };
    h.repo(EmployeeProfile).find.mockResolvedValue([employee]);
    h.repo(EmployeeProfile).findOne.mockResolvedValue(employee);
    h.repo(MonthlyPayroll).findOne.mockResolvedValue({ id: 'payroll-1' });
    h.repo(EmployeeSalary).findOne.mockResolvedValue({
      id: 's1',
      paymentStatus: PaymentStatus.PENDING,
      otherDeductions: 0,
    });
    h.repo(SalaryAdvanceRequest).find.mockResolvedValue([
      { approvedAmount: 1_000_000 },
    ]);
    h.repo(StorePayrollRule).find.mockResolvedValue([
      {
        category: PayrollRuleCategory.FINE,
        ruleType: 'LATE',
        calcType: PayrollCalcType.PERCENTAGE,
        value: 1,
      },
    ]);
    h.repo(StoreShiftConfig).findOne.mockResolvedValue({ daysOff: ['SUNDAY'] });
    const facts = completedOn(julyDates.slice(0, 12)).map((row, i) => ({
      ...row,
      lateMinutes: i < 2 ? 5 : 0,
    }));
    h.repo(ShiftAssignment).createQueryBuilder.mockImplementation(() =>
      listQuery(facts),
    );

    await h.service.createMonthlyPayrollForStore('store-1', '2026-07');
    const [, written] = h.repo(EmployeeSalary).update.mock.calls[0];
    const estimate = await h.service.getEstimatedSalary(
      'emp-1',
      'store-1',
      '07/2026',
    );

    // July 2026 with Sundays off = 27 working days; 12 days worked.
    expect(estimate.standardWorkingDays).toBe(27);
    expect(estimate.daysWorked).toBe(12);
    expect(estimate.earnedBaseSalary).toBe(written.earnedBaseSalary);
    expect(estimate.earnedBaseSalary).toBe(Math.round((10_000_000 * 12) / 27));
    expect(estimate.estimatedSalary).toBe(written.netSalary);
    expect(estimate.month).toBe('2026-07');
    expect(estimate.isFinalized).toBe(false);

    // The salary screen shows the same live figures for the pending month,
    // with the rule lines that add up to the penalty, and writes nothing.
    h.repo(EmployeeSalary).find.mockResolvedValue([
      {
        id: 's1',
        employeeProfileId: 'emp-1',
        paymentStatus: PaymentStatus.PENDING,
        netSalary: 0,
        penalty: 0,
        otherDeductions: 0,
        employeeProfile: { storeId: 'store-1' },
      },
    ]);
    const updatesBefore = h.repo(EmployeeSalary).update.mock.calls.length;
    const [slip]: any[] = await h.service.getEmployeeSalaries('emp-1', '07/2026');
    expect(slip).toMatchObject({
      isEstimate: true,
      netSalary: estimate.estimatedSalary,
      earnedBaseSalary: estimate.earnedBaseSalary,
      penalty: written.penalty,
    });
    const fines = slip.adjustmentBreakdown.filter(
      (line: any) => line.kind === 'FINE',
    );
    expect(fines).toEqual([
      expect.objectContaining({ ruleType: 'LATE', count: 2 }),
    ]);
    expect(
      fines.reduce((sum: number, line: any) => sum + line.amount, 0),
    ).toBe(written.penalty);
    expect(h.repo(EmployeeSalary).update.mock.calls.length).toBe(updatesBefore);

    // A finalized payslip keeps its stored figures; the breakdown is only
    // shown when it adds up to them.
    h.repo(EmployeeSalary).find.mockResolvedValue([
      {
        id: 's1',
        employeeProfileId: 'emp-1',
        paymentStatus: PaymentStatus.APPROVED,
        netSalary: 123,
        earnedBaseSalary: written.earnedBaseSalary,
        bonus: 0,
        penalty: 999,
        employeeProfile: { storeId: 'store-1' },
      },
    ]);
    const [approved]: any[] = await h.service.getEmployeeSalaries('emp-1', '2026-07');
    expect(approved).toMatchObject({
      isEstimate: false,
      netSalary: 123,
      adjustmentBreakdown: null,
    });
  });
});

describe('StoresService - approved leave is never an absence in payroll (M1)', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  const LEAVE_DATE = '2026-07-20';
  const employee = {
    id: 'emp-1',
    storeId: 'store-1',
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
  const rules = [
    {
      category: PayrollRuleCategory.FINE,
      ruleType: 'ABSENT',
      calcType: PayrollCalcType.AMOUNT,
      value: 200_000,
    },
    {
      category: PayrollRuleCategory.BONUS,
      ruleType: 'ATTENDANCE',
      calcType: PayrollCalcType.AMOUNT,
      value: 300_000,
    },
  ];

  /** 10 worked days plus an APPROVED, never-checked-in shift on LEAVE_DATE. */
  async function run(leaves: any[]) {
    // 31 July, 17:00 VN: LEAVE_DATE is a past date and July is still the
    // current month (only the current month is shown live).
    jest.useFakeTimers({
      now: new Date('2026-07-31T10:00:00Z'),
      doNotFake: [
        'nextTick',
        'setImmediate',
        'setTimeout',
        'setInterval',
        'clearTimeout',
        'clearInterval',
        'queueMicrotask',
      ],
    });
    const h = await buildPayrollHarness();
    h.repo(EmployeeProfile).find.mockResolvedValue([employee]);
    h.repo(EmployeeProfile).findOne.mockResolvedValue(employee);
    h.repo(MonthlyPayroll).findOne.mockResolvedValue({ id: 'payroll-1' });
    h.repo(EmployeeSalary).findOne.mockResolvedValue({
      id: 's1',
      paymentStatus: PaymentStatus.PENDING,
      otherDeductions: 0,
    });
    h.repo(StorePayrollRule).find.mockResolvedValue(rules);
    h.repo(StoreShiftConfig).findOne.mockResolvedValue({ daysOff: ['SUNDAY'] });
    h.repo(EmployeeLeaveRequest).find.mockResolvedValue(leaves);
    const rows = [
      ...completedOn(julyDates.slice(0, 10)),
      {
        id: 'sa-leave',
        status: ShiftAssignmentStatus.APPROVED,
        checkInTime: null,
        attendanceStatus: AttendanceStatus.ABSENT,
        workedMinutes: null,
        lateMinutes: 0,
        earlyMinutes: 0,
        shiftSlot: { workDate: LEAVE_DATE },
      },
    ];
    h.repo(ShiftAssignment).createQueryBuilder.mockImplementation(() =>
      listQuery(rows),
    );

    await h.service.createMonthlyPayrollForStore('store-1', '2026-07');
    const [, written] = h.repo(EmployeeSalary).update.mock.calls[0];
    const estimate = await h.service.getEstimatedSalary(
      'emp-1',
      'store-1',
      '2026-07',
    );
    h.repo(EmployeeSalary).find.mockResolvedValue([
      {
        id: 's1',
        employeeProfileId: 'emp-1',
        paymentStatus: PaymentStatus.PENDING,
        netSalary: 0,
        penalty: 0,
        otherDeductions: 0,
        employeeProfile: { storeId: 'store-1' },
      },
    ]);
    const [slip]: any[] = await h.service.getEmployeeSalaries('emp-1', '2026-07');
    return { h, written, estimate, slip };
  }

  const leave = (over: Record<string, unknown> = {}) => ({
    id: 'leave-1',
    employeeProfileId: 'emp-1',
    storeId: 'store-1',
    status: LeaveRequestStatus.APPROVED,
    type: LeaveType.SICK,
    startDate: '2026-07-19',
    endDate: '2026-07-21',
    startTime: null,
    endTime: null,
    shiftAssignmentId: null,
    ...over,
  });

  it('approved full-day leave on a past date: no absence, no ABSENT fine, estimate and breakdown agree', async () => {
    const { h, written, estimate, slip } = await run([leave()]);

    expect(written.unauthorizedLeaveDays).toBe(0);
    expect(written.penalty).toBe(0);
    // No absence, no late arrival: the attendance bonus is earned.
    expect(written.bonus).toBe(300_000);
    expect(estimate.estimatedSalary).toBe(written.netSalary);
    expect(slip).toMatchObject({
      isEstimate: true,
      unauthorizedLeaveDays: 0,
      penalty: 0,
      bonus: 300_000,
      netSalary: written.netSalary,
    });
    expect(
      slip.adjustmentBreakdown.filter((line: any) => line.kind === 'FINE'),
    ).toEqual([]);
    expect(slip.adjustmentBreakdown).toEqual([
      expect.objectContaining({ kind: 'BONUS', ruleType: 'ATTENDANCE', amount: 300_000 }),
    ]);
    // The leave rows were read for the employee's month, approved only.
    expect(h.repo(EmployeeLeaveRequest).find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          employeeProfileId: 'emp-1',
          status: LeaveRequestStatus.APPROVED,
        }),
      }),
    );
  });

  it('a late/early request or a timed leave for another shift is not authorized leave', async () => {
    for (const leaves of [
      [leave({ type: LeaveType.LATE })],
      [
        leave({
          type: LeaveType.PERSONAL,
          startTime: '08:00',
          endTime: '12:00',
          shiftAssignmentId: 'another-shift',
        }),
      ],
      [leave({ startDate: '2026-07-21', endDate: '2026-07-22' })],
    ]) {
      const { written, slip } = await run(leaves);
      expect(written.unauthorizedLeaveDays).toBe(1);
      expect(written.penalty).toBe(200_000);
      expect(written.bonus).toBe(0);
      expect(slip).toMatchObject({ penalty: 200_000, unauthorizedLeaveDays: 1 });
      jest.useRealTimers();
      jest.clearAllMocks();
    }
  });

  it('a timed leave attached to that exact shift is authorized', async () => {
    const { written } = await run([
      leave({
        type: LeaveType.PERSONAL,
        startTime: '08:00',
        endTime: '12:00',
        shiftAssignmentId: 'sa-leave',
      }),
    ]);
    expect(written.unauthorizedLeaveDays).toBe(0);
    expect(written.penalty).toBe(0);
  });
});

describe('StoresService - daily report days are Vietnam days', () => {
  afterEach(() => jest.useRealTimers());

  function reportService() {
    const service = Object.create(StoresService.prototype) as any;
    service.dailyReportRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: any) => value),
      save: jest.fn(async (value: any) => value),
    };
    return service;
  }

  // Regression: `setHours(0,0,0,0)` on the server clock made the 00:05 VN
  // cron create yesterday's report on a UTC host.
  it('creates today in Vietnam by default', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-31T17:05:00Z'));
    const service = reportService();

    await service.createDailyReportForStore('store-1');

    const { reportDate } = service.dailyReportRepository.create.mock.calls[0][0];
    expect(reportDate.getFullYear()).toBe(2026);
    expect(reportDate.getMonth()).toBe(8);
    expect(reportDate.getDate()).toBe(1);
  });

  it('accepts an explicit Vietnam date string', async () => {
    const service = reportService();
    await service.createDailyReportForStore('store-1', '2026-12-31');
    const { reportDate } = service.dailyReportRepository.create.mock.calls[0][0];
    expect([reportDate.getFullYear(), reportDate.getMonth(), reportDate.getDate()]).toEqual([
      2026, 11, 31,
    ]);
  });

  // Regression: `shiftEnd.setHours(22, 0)` on a UTC host put the end at
  // 22:00 UTC (05:00 VN next day), so every shift ending after 16:30 VN was
  // skipped by the 23:30 VN cron.
  it('detects a shift that ended at 22:00 when the cron runs at 23:30 VN', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T16:30:00Z'));
    const service = Object.create(StoresService.prototype) as any;
    service.storeRepository = {
      find: jest.fn().mockResolvedValue([{ id: 'store-1' }]),
    };
    service.shiftSlotRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'evening',
          workDate: '2026-09-01',
          workShift: { startTime: '14:00', endTime: '22:00' },
        },
        {
          id: 'overnight',
          workDate: '2026-09-01',
          workShift: { startTime: '22:00', endTime: '06:00' },
        },
      ]),
    };
    service.shiftAssignmentRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'a-absent',
          shiftSlotId: 'evening',
          employeeId: 'absent',
          status: ShiftAssignmentStatus.APPROVED,
          attendanceStatus: 'ABSENT',
          checkInTime: null,
        },
        {
          id: 'a-forgot',
          shiftSlotId: 'evening',
          employeeId: 'forgot',
          status: ShiftAssignmentStatus.COMPLETED,
          attendanceStatus: 'FORGOT_CHECKOUT',
          checkInTime: new Date('2026-09-01T07:00:00Z'),
          checkOutTime: new Date('2026-09-01T15:15:00Z'),
        },
        {
          id: 'a-leave',
          shiftSlotId: 'evening',
          employeeId: 'on-leave',
          status: ShiftAssignmentStatus.APPROVED,
          attendanceStatus: null,
          checkInTime: null,
        },
        {
          id: 'a-overtime',
          shiftSlotId: 'evening',
          employeeId: 'overtime-pending',
          status: ShiftAssignmentStatus.CONFIRMED,
          attendanceStatus: null,
          checkInTime: new Date('2026-09-01T07:00:00Z'),
          checkOutTime: null,
        },
        {
          shiftSlotId: 'overnight',
          employeeId: 'still-working',
          status: ShiftAssignmentStatus.CONFIRMED,
          checkInTime: new Date('2026-09-01T15:00:00Z'),
          checkOutTime: null,
        },
      ]),
    };
    service.appendToDailyReport = jest.fn();
    service.dataSource = {
      query: jest.fn(async (_sql: string, params: unknown[]) => [
        { covered: params[2] === 'a-leave' },
      ]),
    };

    const result = await service.detectEndOfDayAttendanceIssues();

    expect(service.shiftSlotRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workDate: '2026-09-01' }),
      }),
    );
    // Report mirrors the per-minute truth (ABSENT / FORGOT_CHECKOUT) and the
    // approved full-day leave; an open shift waiting on overtime is neither.
    expect(result).toEqual({
      forgotCount: 1,
      unauthorizedCount: 1,
      authorizedCount: 1,
    });
    expect(service.appendToDailyReport).toHaveBeenCalledWith(
      'store-1',
      'authorizedLeaves',
      'on-leave',
    );
    expect(service.appendToDailyReport).not.toHaveBeenCalledWith(
      'store-1',
      expect.anything(),
      'overtime-pending',
    );
    expect(service.appendToDailyReport).toHaveBeenCalledWith(
      'store-1',
      'unauthorizedLeaves',
      'absent',
    );
    expect(service.appendToDailyReport).toHaveBeenCalledWith(
      'store-1',
      'forgotClockOut',
      'forgot',
    );
    expect(service.appendToDailyReport).not.toHaveBeenCalledWith(
      'store-1',
      'forgotClockOut',
      'still-working',
    );
  });
});

describe('StoresService - payslip recompute after a shift is marked ABSENT', () => {
  afterEach(() => jest.clearAllMocks());

  const employee = {
    id: 'emp-1',
    storeId: 'store-1',
    employmentStatus: EmploymentStatus.ACTIVE,
    contracts: [
      {
        id: 'contract-1',
        isActive: true,
        salaryAmount: 3_100_000,
        paymentType: PaymentType.MONTH,
        allowances: {},
      },
    ],
  };

  it('rewrites the pending payslip of the work-date month through the single writer', async () => {
    const h = await buildPayrollHarness();
    h.repo(EmployeeProfile).findOne.mockResolvedValue(employee);
    h.repo(MonthlyPayroll).findOne.mockResolvedValue({ id: 'payroll-1' });
    h.repo(EmployeeSalary).findOne.mockResolvedValue({
      id: 's1',
      paymentStatus: PaymentStatus.PENDING,
      otherDeductions: 0,
    });

    await expect(
      h.service.recomputeEmployeePayslipForWorkDate({
        employeeProfileId: 'emp-1',
        storeId: 'store-1',
        workDate: '2026-08-31',
      }),
    ).resolves.toBe('updated');

    const attendanceQuery =
      h.repo(ShiftAssignment).createQueryBuilder.mock.results[0].value;
    expect(attendanceQuery.andWhere).toHaveBeenCalledWith(
      'slot.workDate >= :monthStart',
      { monthStart: '2026-08-01' },
    );
    expect(h.repo(EmployeeSalary).update).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ monthlyPayrollId: 'payroll-1' }),
    );
    expect(h.repo(EmployeeSalary).delete).not.toHaveBeenCalled();
    expect(h.repo(MonthlyPayroll).update).toHaveBeenCalledWith(
      'payroll-1',
      expect.any(Object),
    );
  });

  it('leaves an APPROVED payslip untouched', async () => {
    const h = await buildPayrollHarness();
    h.repo(EmployeeProfile).findOne.mockResolvedValue(employee);
    h.repo(MonthlyPayroll).findOne.mockResolvedValue({ id: 'payroll-1' });
    h.repo(EmployeeSalary).findOne.mockResolvedValue({
      id: 's1',
      paymentStatus: PaymentStatus.APPROVED,
      monthlyPayrollId: 'payroll-1',
    });

    await expect(
      h.service.recomputeEmployeePayslipForWorkDate({
        employeeProfileId: 'emp-1',
        storeId: 'store-1',
        workDate: '2026-08-20',
      }),
    ).resolves.toBe('protected');
    expect(h.repo(EmployeeSalary).update).not.toHaveBeenCalled();
    expect(h.repo(EmployeeSalary).delete).not.toHaveBeenCalled();
  });

  it('skips staff who are not rostered, or an invalid date', async () => {
    const h = await buildPayrollHarness();
    h.repo(EmployeeProfile).findOne.mockResolvedValue({
      ...employee,
      employmentStatus: EmploymentStatus.TERMINATED,
    });
    await expect(
      h.service.recomputeEmployeePayslipForWorkDate({
        employeeProfileId: 'emp-1',
        storeId: 'store-1',
        workDate: '2026-08-20',
      }),
    ).resolves.toBe('skipped');
    await expect(
      h.service.recomputeEmployeePayslipForWorkDate({
        employeeProfileId: 'emp-1',
        storeId: 'store-1',
        workDate: 'junk',
      }),
    ).resolves.toBe('skipped');
    expect(h.repo(EmployeeSalary).update).not.toHaveBeenCalled();
  });
});

describe('StoresService - salary screen: current month live, past months stored (R5)', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  const employee = {
    id: 'emp-1',
    storeId: 'store-1',
    employmentStatus: EmploymentStatus.ACTIVE,
    account: { fullName: 'An' },
    contracts: [
      {
        id: 'contract-1',
        isActive: true,
        salaryAmount: 25_000,
        paymentType: PaymentType.HOUR,
        // Raised after the stored payslip was last written.
        allowances: { an: 800_000 },
      },
    ],
  };
  const bonusRule = {
    name: 'Thưởng chuyên cần',
    category: PayrollRuleCategory.BONUS,
    ruleType: 'ATTENDANCE',
    calcType: PayrollCalcType.AMOUNT,
    value: 200_000,
  };

  async function harness(nowIso: string, rows: any[]) {
    jest.useFakeTimers({
      now: new Date(nowIso),
      doNotFake: [
        'nextTick',
        'setImmediate',
        'setTimeout',
        'setInterval',
        'clearTimeout',
        'clearInterval',
        'queueMicrotask',
      ],
    });
    const h = await buildPayrollHarness();
    h.repo(EmployeeProfile).findOne.mockResolvedValue(employee);
    h.repo(StorePayrollRule).find.mockResolvedValue([bonusRule]);
    h.repo(StoreShiftConfig).findOne.mockResolvedValue({ daysOff: ['SUNDAY'] });
    h.repo(ShiftAssignment).createQueryBuilder.mockImplementation(() =>
      listQuery(rows),
    );
    return h;
  }

  const storedPending = {
    id: 's1',
    employeeProfileId: 'emp-1',
    paymentStatus: PaymentStatus.PENDING,
    earnedBaseSalary: 900_000,
    allowances: { an: 500_000 },
    bonus: 200_000,
    penalty: 0,
    advancePayment: 0,
    otherDeductions: 0,
    totalIncome: 1_600_000,
    totalDeductions: 0,
    netSalary: 1_600_000,
    employeeProfile: { storeId: 'store-1' },
  };

  it('current month: allowances rows add up to totalIncome (contract allowances, not the stale jsonb)', async () => {
    // 10 shifts × 240 min in September; today 22/09 VN.
    const h = await harness(
      '2026-09-22T03:00:00Z',
      completedOn(
        Array.from({ length: 10 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`),
      ).map((row) => ({ ...row, workedMinutes: 240 })),
    );
    h.repo(EmployeeSalary).find.mockResolvedValue([{ ...storedPending }]);
    const [slip]: any[] = await h.service.getEmployeeSalaries('emp-1', '2026-09');
    expect(slip.isEstimate).toBe(true);
    expect(slip.allowances).toEqual({ an: 800_000 });
    expect(slip.allowancesTotal).toBe(800_000);
    expect(slip.earnedBaseSalary).toBe(1_000_000);
    expect(slip.earnedBaseSalary + slip.allowancesTotal + slip.bonus).toBe(
      slip.totalIncome,
    );
    expect(slip.totalIncome).toBe(2_000_000);
  });

  it('past month: a PENDING payslip keeps its stored figures (no repricing with today\'s contract)', async () => {
    const h = await harness(
      '2026-09-22T03:00:00Z',
      completedOn(['2026-08-03', '2026-08-04']),
    );
    h.repo(EmployeeSalary).find.mockResolvedValue([{ ...storedPending }]);
    const [slip]: any[] = await h.service.getEmployeeSalaries('emp-1', '2026-08');
    expect(slip).toMatchObject({
      isEstimate: false,
      isFinalized: false,
      earnedBaseSalary: 900_000,
      allowances: { an: 500_000 },
      allowancesTotal: 500_000,
      netSalary: 1_600_000,
    });
    expect(h.repo(EmployeeSalary).update).not.toHaveBeenCalled();

    h.repo(EmployeeSalary).findOne.mockResolvedValue({ ...storedPending });
    const estimate = await h.service.getEstimatedSalary('emp-1', 'store-1', '2026-08');
    expect(estimate).toMatchObject({ estimatedSalary: 1_600_000, isFinalized: false });
  });

  it('current month with no payslip row: one live estimate row equal to the Home estimate', async () => {
    const h = await harness(
      '2026-09-02T03:00:00Z',
      completedOn(['2026-09-01']).map((row) => ({ ...row, workedMinutes: 240 })),
    );
    h.repo(EmployeeSalary).find.mockResolvedValue([]);
    const rows: any[] = await h.service.getEmployeeSalaries('emp-1', '09/2026');
    expect(rows).toHaveLength(1);
    const [row] = rows;
    const estimate = await h.service.getEstimatedSalary('emp-1', 'store-1', '2026-09');
    expect(row).toMatchObject({
      id: null,
      isEstimate: true,
      isFinalized: false,
      employeeProfileId: 'emp-1',
      paymentStatus: PaymentStatus.PENDING,
      earnedBaseSalary: 100_000,
      allowancesTotal: 800_000,
      bonus: 200_000,
      netSalary: estimate.estimatedSalary,
    });
    expect(row.employeeProfile).toMatchObject({ account: { fullName: 'An' } });
    expect(row.adjustmentBreakdown).toEqual([
      expect.objectContaining({ kind: 'BONUS', ruleType: 'ATTENDANCE', amount: 200_000 }),
    ]);
    // Nothing is written.
    expect(h.repo(EmployeeSalary).save).not.toHaveBeenCalled();
    expect(h.repo(EmployeeSalary).update).not.toHaveBeenCalled();
  });

  it('a past month with no payslip row stays empty', async () => {
    const h = await harness('2026-09-22T03:00:00Z', []);
    h.repo(EmployeeSalary).find.mockResolvedValue([]);
    await expect(h.service.getEmployeeSalaries('emp-1', '2026-08')).resolves.toEqual([]);
  });

  it('an empty month earns no attendance bonus', async () => {
    const h = await harness('2026-10-01T03:00:00Z', []);
    h.repo(EmployeeSalary).find.mockResolvedValue([]);
    const [row]: any[] = await h.service.getEmployeeSalaries('emp-1', '2026-10');
    expect(row).toMatchObject({ bonus: 0, earnedBaseSalary: 0, netSalary: 800_000 });
    expect(row.adjustmentBreakdown).toEqual([]);
  });
});

describe('StoresService - new stores get no default bonus/fine rules (R5)', () => {
  it('seeds only benefit rules', async () => {
    const h = await buildPayrollHarness();
    await h.service.createDefaultPayrollSetting('store-1');
    const created = h
      .repo(StorePayrollRule)
      .create.mock.calls.map(([rule]: any[]) => rule);
    expect(created.length).toBeGreaterThan(0);
    expect(
      created.filter(
        (rule: any) =>
          rule.category === PayrollRuleCategory.BONUS ||
          rule.category === PayrollRuleCategory.FINE,
      ),
    ).toEqual([]);
  });
});
