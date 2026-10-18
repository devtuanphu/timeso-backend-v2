import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import {
  Between,
  In,
  MoreThanOrEqual,
  LessThanOrEqual,
  Not,
  EntityManager,
} from 'typeorm';
import { isUUID } from 'class-validator';
import {
  CreateEmployeeSalaryDto,
  UpdateEmployeeSalaryDto,
} from '../dto/employee-salary-write.dto';
import {
  CreateEmployeePaymentHistoryDto,
  UpdateEmployeePaymentHistoryDto,
} from '../dto/employee-payment-history.dto';
import { join } from 'path';
import {
  SalaryAdjustment,
  AdjustmentType,
  SalaryChangeType,
} from '../entities/salary-adjustment.entity';
import { EmployeePaymentHistory } from '../entities/employee-payment-history.entity';
import { StorePaymentAccount } from '../entities/store-payment-account.entity';
import { StoreStatus } from '../entities/store.entity';
import {
  EmployeeProfile,
  EmploymentStatus,
} from '../entities/employee-profile.entity';
import {
  EmployeeContract,
  PaymentType,
} from '../entities/employee-contract.entity';
import { MonthlyPayroll } from '../entities/monthly-payroll.entity';
import {
  PayslipBuiltinRow,
  PayslipRowSign,
  StorePayslipRow,
} from '../entities/store-payslip-row.entity';
import {
  countedPayslipDeductions,
  isBuiltinRemoved,
  PAYSLIP_BUILTIN_DEFAULT_LABELS,
  payslipExtraTotals,
  payslipRowsSnapshot,
  readPayslipRowsSnapshot,
  type PayslipRowsSnapshot,
} from '../payslip-rows.utils';
import { SavePayslipRowsDto } from '../dto/payslip-rows.dto';
import { SalaryConfig, ConfigStatus } from '../entities/salary-config.entity';
import {
  EmployeeSalary,
  PaymentStatus,
} from '../entities/employee-salary.entity';
import { FeedbackStatus } from '../entities/feedback.entity';
import { EmployeeMonthlySummary } from '../entities/employee-monthly-summary.entity';
import {
  EmployeeLeaveRequest,
  LeaveRequestStatus,
} from '../entities/employee-leave-request.entity';
import {
  currentStintContracts,
  currentStintSql,
  stintFloor,
  stintStartVnDate,
} from '../employment-stint.utils';
import {
  ShiftAssignment,
  ShiftAssignmentStatus,
} from '../entities/shift-management.entity';
import {
  CreateStorePayrollPaymentDto,
  UpdateStorePayrollPaymentDto,
  PayrollMonthlySummaryResponseDto,
} from '../dto/store-response.dto';
import { UpdatePayrollSettingDto } from '../dto/store-payroll-setting.dto';
import { leaveCoversShift } from '../leave-coverage.utils';
import {
  SalaryAdvanceRequest,
  AdvanceRequestStatus,
} from '../entities/salary-advance-request.entity';
import { PayrollCalculationMethod } from '../entities/store-payroll-setting.entity';
import {
  StorePayrollRule,
  PayrollRuleCategory,
  PayrollCalcType,
  PayrollRuleCode,
  MANUAL_PAYROLL_RULE_CODES,
  BONUS_PAYROLL_RULE_CODES,
  FINE_PAYROLL_RULE_CODES,
  legacyRuleCodeOf,
} from '../entities/store-payroll-rule.entity';
import { CreatePayrollRecordDto } from '../dto/payroll-record.dto';

/** Mã khoản tự thêm, dạng chuỗi (code của rule là string, không phải enum). */
const CUSTOM_RULE_CODE: string = PayrollRuleCode.CUSTOM;

/**
 * Cách tính v2 gần đúng của một cấu hình v3, ghi kèm vào calc_mode / value /
 * threshold: app cũ (v2) chỉ hiển thị được chừng đó, còn tiền luôn tính theo
 * calc_config. Không bao giờ dùng để tính lương.
 */
function fallbackCalcModeOf(config: RuleCalcConfig, code: string): {
  calcMode: string;
  value: number;
  threshold: number | null;
} {
  const amount = Number(config.amount) || 0;
  const raw = ((): { calcMode: string; value: number; threshold: number | null } => {
    switch (config.kind) {
      case 'UNIT_PRICE':
        if (config.unit === 'HOUR') return { calcMode: 'AMOUNT_PER_HOUR', value: amount, threshold: null };
        if (config.unit === 'MINUTE') {
          return { calcMode: 'AMOUNT_PER_HOUR', value: amount * 60, threshold: null };
        }
        return { calcMode: 'AMOUNT_PER_SHIFT', value: amount, threshold: null };
      case 'SALARY_COEF':
        return {
          calcMode: config.base === 'DAILY' ? 'COEF_PER_SHIFT' : 'COEF_PER_HOUR',
          // v2 đọc hệ số tăng ca / ca đêm là phần trả thêm.
          value: salaryCoefExtra(code, Number(config.coef) || 0),
          threshold: null,
        };
      case 'PERCENT':
        return { calcMode: 'COEF_PER_SHIFT', value: (Number(config.percent) || 0) / 100, threshold: null };
      case 'SALARY_BLOCK':
        return { calcMode: 'COEF_PER_SHIFT', value: Number(config.dayFraction) || 0, threshold: null };
      case 'TIERED': {
        const first = config.tiers?.[0];
        return first?.dayFraction
          ? { calcMode: 'COEF_PER_SHIFT', value: Number(first.dayFraction), threshold: null }
          : { calcMode: 'AMOUNT_PER_SHIFT', value: Number(first?.amount) || 0, threshold: null };
      }
      case 'MILESTONE':
        return {
          calcMode: config.metric === 'WORKED_HOURS' ? 'MILESTONE_HOURS' : 'MILESTONE_SHIFTS',
          value: amount,
          threshold: Math.max(1, Number(config.threshold) || 0),
        };
      default:
        // FIXED / PROGRESSIVE
        return { calcMode: 'AMOUNT_PER_SHIFT', value: amount, threshold: null };
    }
  })();
  // App v2 chặn lưu cả màn khi một khoản đang bật có số ≤ 0 (và hệ số > 100):
  // số gần đúng luôn nằm trong khoảng nó chấp nhận.
  const coef = raw.calcMode.startsWith('COEF_');
  const value = coef
    ? Math.min(100, Math.max(0.01, Math.round(raw.value * 100) / 100))
    : Math.min(100_000_000, Math.max(1, Math.round(raw.value)));
  return { ...raw, value };
}
/** Một dòng thưởng / vi phạm vừa đổi so với lần tính trước. */
export interface PayrollAdjustmentChange {
  kind: 'BONUS' | 'FINE';
  label: string;
  /** Chênh lệch (đồng, dương): số tiền vừa phát sinh thêm hoặc bớt đi. */
  delta: number;
  /** Tổng của dòng trong tháng sau lần tính này. */
  total: number;
}

type AdjustmentSnapshot = Record<
  string,
  { amount: number; label: string; kind: 'BONUS' | 'FINE'; count?: number }
>;

/**
 * Dòng thưởng / vi phạm thật sự được tính vào phiếu: mẫu phiếu bỏ hàng
 * "Thưởng" / "Khấu trừ" thì tổng tương ứng là 0 — không báo khoản không tính.
 */
const effectiveAdjustmentLines = (
  lines: PayslipAdjustmentLine[],
  payslip: Pick<PayslipComputation, 'bonus' | 'penalty'>,
) =>
  lines.filter((line) => (line.kind === 'BONUS' ? payslip.bonus : payslip.penalty) !== 0);

/** Khoá ổn định của một dòng (nhãn có thể đổi theo số giờ). */
const adjustmentKey = (line: PayslipAdjustmentLine) =>
  `${line.kind}:${line.ruleId ?? line.ruleType}`;

const vnMoney = (value: number) => Math.round(value).toLocaleString('vi-VN');
import {
  StorePayrollIncrementRule,
  IncrementRuleType,
} from '../entities/store-payroll-increment-rule.entity';
import { StoreShiftConfig } from '../entities/store-shift-config.entity';
import { ACTIVITY_ACTIONS, toActivityDate } from '../activity-log.summary';
import { calculateShiftEarnings } from '../shift-earnings.utils';
import { countWorkingDaysInMonth } from '../working-days.utils';
import {
  computeNetFromIncome,
  computePayslip,
  computeRuleAdjustmentBreakdown,
  sumAllowances,
  PayslipAdjustmentLine,
  computePayslipTotals,
  MonthlyAttendanceFacts,
  PayrollAssignmentFact,
  PayslipComputation,
  pickDayOwnerAssignmentIds,
  summarizeMonthlyAttendance,
  computeStintSplitEarnedBase,
  describeEarnedBase,
  describePayslipTotals,
  EarnedBreakdown,
  payRatesOf,
  rulesApplyingTo,
  scheduledMinutesByDate,
} from '../payroll-calculation.utils';
import { effectiveWindowOf } from '../attendance-time.utils';
import { EmployeePayrollRecord } from '../entities/employee-payroll-record.entity';
import { Order, OrderStatus } from '../entities/order.entity';
import {
  NotificationPriority,
  NotificationType,
} from '../../notifications/entities/notification.entity';
import type { NotificationsService } from '../../notifications/notifications.service';
import {
  normalizeRuleCalcConfig,
  salaryCoefExtra,
  type RuleCalcConfig,
  type RuleOccurrence,
} from '../payroll-rule-config.utils';
import {
  parseVnMonthInput,
  shiftVnMonth,
  toMonthMarker,
  vnDateString,
  vnMiddayInstant,
  VnMonth,
  vnMonthOf,
  vnMonthOfDateString,
} from '../../../common/utils/vn-calendar';
import { formatVnMoney } from '../../../common/utils/money';
import * as ExcelJS from 'exceljs';
import {
  pickDefined,
  monthlyPayrollLockKey,
  SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES,
  isShiftEligibleEmploymentStatus,
} from './shared';
import type { StoresService } from '../stores.service';

/** Payslip fields `POST/PUT employee-salaries` may write (see the DTO). */
const EMPLOYEE_SALARY_CLIENT_FIELDS = [
  'monthlyPayrollId',
  'baseSalary',
  'paymentType',
  'earnedBaseSalary',
  'allowances',
  'bonus',
  'penalty',
  'workingDays',
  'workingHours',
  'unauthorizedLeaveDays',
  'advancePayment',
  'otherDeductions',
  'totalIncome',
  'totalDeductions',
  'netSalary',
  'notes',
] as const;

/**
 * StoresPayrollPart: payroll methods of StoresService, split out of stores.service.ts.
 * They still live on StoresService.prototype (applyClassParts), so DI, callers
 * and routes are unchanged; `this` is the StoresService instance.
 */
export class StoresPayrollPart {
  async createDefaultPayrollSetting(this: StoresService, storeId: string) {
    const setting = this.payrollSettingRepository.create({
      storeId,
      calculationMethod: PayrollCalculationMethod.FLEXIBLE,
    });
    const savedSetting = await this.payrollSettingRepository.save(setting);

    // 1. Default rules: benefits only. Bonus and fine rules are no longer
    // seeded — they were paid/charged before the owner ever configured them
    // (a 200.000đ "Thưởng chuyên cần" on an empty month). Owners add their own
    // bonus/fine rules in the payroll settings.
    // scripts/deactivate_seeded_payroll_rules.sql retires the untouched
    // copies already seeded for existing stores.
    const defaultRules = [
      // Benefits
      {
        name: 'Làm việc ngày tết',
        category: PayrollRuleCategory.BENEFIT,
        ruleType: 'TET_WORK',
        calcType: PayrollCalcType.AMOUNT,
        value: 300000,
      },
      {
        name: 'Làm việc ngày lễ',
        category: PayrollRuleCategory.BENEFIT,
        ruleType: 'HOLIDAY_WORK',
        calcType: PayrollCalcType.AMOUNT,
        value: 300000,
      },
      {
        name: 'Làm việc ban đêm',
        category: PayrollRuleCategory.BENEFIT,
        ruleType: 'NIGHT_WORK',
        calcType: PayrollCalcType.AMOUNT,
        value: 300000,
      },
      {
        name: 'Sinh nhật/ kỷ nhiệm',
        category: PayrollRuleCategory.BENEFIT,
        ruleType: 'BIRTHDAY',
        calcType: PayrollCalcType.AMOUNT,
        value: 300000,
      },
    ];

    for (const rule of defaultRules) {
      await this.payrollRuleRepository.save(
        this.payrollRuleRepository.create({ ...rule, storeId }),
      );
    }

    // 2. Create Default Increment Rules
    const defaultIncrementRules = [
      {
        type: IncrementRuleType.PERIODIC,
        conditionType: 'DATE',
        conditionValue: '01/06',
        calcType: PayrollCalcType.PERCENTAGE,
        value: 5,
      },
      {
        type: IncrementRuleType.SENIORITY,
        conditionType: 'DAYS',
        conditionValue: '180',
        calcType: PayrollCalcType.PERCENTAGE,
        value: 5,
      },
      {
        type: IncrementRuleType.SENIORITY,
        conditionType: 'DAYS',
        conditionValue: '360',
        calcType: PayrollCalcType.AMOUNT,
        value: 300000,
      },
    ];

    for (const incRule of defaultIncrementRules) {
      await this.payrollIncrementRuleRepository.save(
        this.payrollIncrementRuleRepository.create({ ...incRule, storeId }),
      );
    }

    return savedSetting;
  }

  // --- Payroll Settings ---
  /**
   * `rulesVersion: 2` (màn thiết lập mới): mọi khoản thưởng / vi phạm chưa xoá,
   * kể cả khoản đang tắt, cùng các cột v2. Không có (app cũ): như trước, chỉ
   * khoản cũ đang bật — app cũ không biết đọc cách tính v2 (hệ số sẽ bị hiểu
   * là số tiền).
   */
  async getPayrollSetting(
    this: StoresService,
    storeId: string,
    options: { rulesVersion?: number } = {},
  ) {
    let setting = await this.payrollSettingRepository.findOne({
      where: { storeId },
    });
    if (!setting) {
      setting = this.payrollSettingRepository.create({
        storeId,
        calculationMethod: PayrollCalculationMethod.FLEXIBLE,
      });
      await this.payrollSettingRepository.save(setting);
    }

    const v2 = (options.rulesVersion ?? 0) >= 2;
    const rules = (
      await this.payrollRuleRepository.find({
        where: v2 ? { storeId } : { storeId, isActive: true },
        order: { createdAt: 'ASC' },
      })
    ).filter((rule) => v2 || !rule.calcMode);
    const incrementRules = await this.payrollIncrementRuleRepository.find({
      where: { storeId, isActive: true },
    });
    const roles = await this.roleRepository.find({
      where: { storeId, isActive: true },
    });

    return {
      ...setting,
      bonuses: rules.filter((r) => r.category === PayrollRuleCategory.BONUS),
      fines: rules.filter((r) => r.category === PayrollRuleCategory.FINE),
      benefits: rules.filter((r) => r.category === PayrollRuleCategory.BENEFIT),
      incrementRules,
      roles,
    };
  }

  async upsertPayrollSetting(
    this: StoresService,
    storeId: string,
    data: UpdatePayrollSettingDto,
  ) {
    // 1. Update main setting
    let setting = await this.payrollSettingRepository.findOne({
      where: { storeId },
    });
    const mainData = {
      calculationMethod: data.calculationMethod as PayrollCalculationMethod,
      priorityCalcType: data.priorityCalcType,
      priorityCalcValue: data.priorityCalcValue,
      alternativeCalcType: data.alternativeCalcType,
      alternativeCalcValue: data.alternativeCalcValue,
    };

    if (setting) {
      Object.assign(setting, mainData);
    } else {
      setting = this.payrollSettingRepository.create({ ...mainData, storeId });
    }
    await this.payrollSettingRepository.save(setting);

    // 2. Sync Rules (Bonuses, Fines, Benefits). One writer per store: two
    // saves at once would both insert a missing rule (and pay it twice).
    const rulesChanged = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `payroll-rules:${storeId}`,
      ]);
      return data.rulesVersion === 2 || data.rulesVersion === 3
        ? this.syncPayrollRulesV2(manager, storeId, data)
        : this.syncPayrollRulesLegacy(manager, storeId, data);
    });

    // 3. Sync Increment Rules
    if (data.incrementRules) {
      const currentIncRules = await this.payrollIncrementRuleRepository.find({
        where: { storeId },
      });
      const incToSave: StorePayrollIncrementRule[] = [];

      for (const incData of data.incrementRules) {
        let incRule: StorePayrollIncrementRule | undefined;

        if (incData.id) {
          incRule = currentIncRules.find((r) => r.id === incData.id);
        } else {
          incRule = currentIncRules.find(
            (r) =>
              r.type === (incData.type as IncrementRuleType) &&
              r.conditionType === incData.conditionType &&
              r.conditionValue === incData.conditionValue,
          );
        }

        const payload = {
          ...incData,
          type: incData.type as IncrementRuleType,
          calcType: incData.calcType as PayrollCalcType,
          storeId,
        };

        if (incRule) {
          Object.assign(incRule, payload);
        } else {
          incRule = this.payrollIncrementRuleRepository.create(payload);
        }
        incToSave.push(incRule);
      }

      const incomingIncIds = incToSave.map((r) => r.id).filter((id) => !!id);
      const incToRemoveIds = currentIncRules
        .filter((r) => !incomingIncIds.includes(r.id))
        .map((r) => r.id);

      if (incToRemoveIds.length > 0) {
        await this.payrollIncrementRuleRepository.delete({
          id: In(incToRemoveIds),
        });
      }
      if (incToSave.length > 0) {
        await this.payrollIncrementRuleRepository.save(incToSave);
      }
    }

    // 4. Update Role coefficients/allowances
    if (data.roles) {
      for (const roleData of data.roles) {
        await this.roleRepository.update(roleData.id, {
          coefficient: roleData.coefficient,
          allowance: roleData.allowance,
        });
      }
    }

    // Khoản thưởng / vi phạm đổi: phiếu lương tháng này (chưa chốt) tính lại
    // ngay, như khi lưu mẫu bảng lương.
    let recalculationFailed = false;
    if (rulesChanged) {
      const payroll = await this.dataSource
        .getRepository(MonthlyPayroll)
        .findOne({ where: { storeId, month: toMonthMarker(vnMonthOf()) } });
      if (payroll) {
        try {
          await this.recalculatePayroll(storeId);
        } catch (error) {
          recalculationFailed = true;
          this.logger?.warn(
            `Payroll rules saved but recalculation failed for ${storeId}: ${String(error)}`,
          );
        }
      }
    }
    const saved = await this.getPayrollSetting(storeId, {
      rulesVersion: data.rulesVersion,
    });
    return recalculationFailed ? { ...saved, recalculationFailed } : saved;
  }

  /**
   * App cũ: chỉ trong phạm vi khoản cũ ĐANG BẬT (calc_mode null) — đúng những
   * gì nó đọc được. Khoản v2 và khoản đang tắt không bao giờ bị nó sửa / xoá.
   */
  async syncPayrollRulesLegacy(
    this: StoresService,
    manager: EntityManager,
    storeId: string,
    data: UpdatePayrollSettingDto,
  ): Promise<boolean> {
    const repo = manager.getRepository(StorePayrollRule);
    const incomingRules = [
      ...(data.bonuses || []).map((r) => ({ ...r, category: PayrollRuleCategory.BONUS })),
      ...(data.fines || []).map((r) => ({ ...r, category: PayrollRuleCategory.FINE })),
      ...(data.benefits || []).map((r) => ({ ...r, category: PayrollRuleCategory.BENEFIT })),
    ];
    const currentRules = (await repo.find({ where: { storeId, isActive: true } })).filter(
      (rule) => !rule.calcMode,
    );
    // Khoản v2 đang bật (app cũ không thấy): app cũ thêm dòng cùng loại (vd.
    // một khoản phạt đi muộn nữa) sẽ phạt / thưởng hai lần — bỏ qua dòng đó.
    const activeV2 = (await repo.find({ where: { storeId, isActive: true } })).filter(
      (rule) => !!rule.calcMode,
    );
    const rulesToSave: StorePayrollRule[] = [];
    for (const ruleData of incomingRules) {
      const legacyCode = legacyRuleCodeOf(ruleData.ruleType);
      if (
        !ruleData.id &&
        legacyCode !== CUSTOM_RULE_CODE &&
        activeV2.some((r) => r.category === ruleData.category && r.code === legacyCode)
      ) {
        continue;
      }
      const rule = ruleData.id
        ? currentRules.find((r) => r.id === ruleData.id)
        : currentRules.find(
            (r) =>
              r.name === ruleData.name &&
              r.category === ruleData.category &&
              r.ruleType === ruleData.ruleType,
          );
      const payload = {
        name: ruleData.name,
        ruleType: ruleData.ruleType,
        calcType: ruleData.calcType as PayrollCalcType,
        value: ruleData.value,
        category: ruleData.category,
        storeId,
      };
      rulesToSave.push(rule ? Object.assign(rule, payload) : repo.create(payload));
    }
    const keep = new Set(rulesToSave.map((r) => r.id).filter(Boolean));
    const toRemove = currentRules.filter((r) => !keep.has(r.id)).map((r) => r.id);
    if (toRemove.length) await repo.delete({ id: In(toRemove) });
    if (rulesToSave.length) await repo.save(rulesToSave);
    return true;
  }

  /**
   * Màn thiết lập mới gửi đủ danh sách (cả khoản đang tắt). Khoản có sẵn (mã
   * khác CUSTOM) mỗi loại chỉ một dòng: dòng cũ cùng mã được sửa tại chỗ thành
   * v2 thay vì thêm dòng thứ hai (trả hai lần). Khoản không còn trong danh sách
   * xoá mềm, để ghi nhận cũ và phiếu lương đã chốt vẫn đọc được tên.
   */
  async syncPayrollRulesV2(
    this: StoresService,
    manager: EntityManager,
    storeId: string,
    data: UpdatePayrollSettingDto,
  ): Promise<boolean> {
    const repo = manager.getRepository(StorePayrollRule);
    const incoming = [
      ...(data.bonuses || []).map((r) => ({ ...r, category: PayrollRuleCategory.BONUS })),
      ...(data.fines || []).map((r) => ({ ...r, category: PayrollRuleCategory.FINE })),
      ...(data.benefits || []).map((r) => ({ ...r, category: PayrollRuleCategory.BENEFIT })),
    ];
    // Chỉ đối chiếu nhóm có trong body: thiếu mảng phúc lợi không được xoá hết
    // phúc lợi.
    const present = new Set<string>(
      [
        data.bonuses !== undefined ? PayrollRuleCategory.BONUS : null,
        data.fines !== undefined ? PayrollRuleCategory.FINE : null,
        data.benefits !== undefined ? PayrollRuleCategory.BENEFIT : null,
      ].filter((c): c is PayrollRuleCategory => c !== null),
    );
    const seenPresets = new Set<string>();
    const v3 = data.rulesVersion === 3;
    const configs = new Map<(typeof incoming)[number], RuleCalcConfig>();
    for (const r of incoming) {
      if (r.category === PayrollRuleCategory.BENEFIT) continue;
      const code = r.code || PayrollRuleCode.CUSTOM;
      const allowed =
        r.category === PayrollRuleCategory.BONUS
          ? BONUS_PAYROLL_RULE_CODES
          : FINE_PAYROLL_RULE_CODES;
      if (!allowed.has(code)) {
        throw new BadRequestException(`Khoản "${r.name}" không thuộc nhóm này`);
      }
      // Trùng chỉ tính giữa các khoản đang bật (dòng cũ đã tắt cùng loại vẫn
      // được giữ lại).
      if (code !== CUSTOM_RULE_CODE && r.isActive !== false) {
        const key = `${r.category}:${code}`;
        if (seenPresets.has(key)) {
          throw new BadRequestException(`Khoản "${r.name}" bị trùng`);
        }
        seenPresets.add(key);
      }
      if (v3 && r.calcConfig) {
        const config = normalizeRuleCalcConfig(r.calcConfig, r.name);
        // Khoản đang tắt nhập dở không chặn việc lưu: chỉ không giữ cấu hình.
        if (typeof config === 'string') {
          if (r.isActive !== false) throw new BadRequestException(config);
        } else {
          configs.set(r, config);
        }
        continue;
      }
      if (r.calcMode) {
        const coef = String(r.calcMode).startsWith('COEF_');
        if (coef && r.value > 100) {
          throw new BadRequestException(`Hệ số của "${r.name}" tối đa là 100`);
        }
        if (!coef && r.value > 100_000_000) {
          throw new BadRequestException(`Số tiền của "${r.name}" quá lớn`);
        }
        if (String(r.calcMode).startsWith('MILESTONE_') && !(Number(r.threshold) > 0)) {
          throw new BadRequestException(`Hãy nhập mốc giờ / ca cho "${r.name}"`);
        }
      }
    }

    // Phạm vi áp dụng (v3): chỉ nhân viên của chính cửa hàng này.
    const scopeIds = v3
      ? [...new Set(incoming.flatMap((r) => r.employeeProfileIds ?? []))]
      : [];
    if (scopeIds.length) {
      const found = await manager
        .getRepository(EmployeeProfile)
        .find({ where: { id: In(scopeIds), storeId }, select: ['id'], withDeleted: true });
      if (found.length !== scopeIds.length) {
        throw new BadRequestException('Có nhân viên trong phạm vi áp dụng không thuộc cửa hàng');
      }
    }
    const current = await repo.find({ where: { storeId } });
    const used = new Set<string>();
    const toSave: StorePayrollRule[] = [];
    for (const r of incoming) {
      const code =
        r.category === PayrollRuleCategory.BENEFIT ? null : r.code || PayrollRuleCode.CUSTOM;
      const free = (rule: StorePayrollRule) => !used.has(rule.id);
      let rule =
        (r.id && current.find((x) => x.id === r.id && free(x))) ||
        (!r.id && code && code !== CUSTOM_RULE_CODE
          ? current.find((x) => free(x) && x.category === r.category && x.code === code)
          : undefined) ||
        (!r.id
          ? current.find(
              (x) =>
                free(x) &&
                !x.calcMode &&
                x.name === r.name &&
                x.category === r.category &&
                x.ruleType === r.ruleType,
            )
          : undefined) ||
        undefined;
      const config = configs.get(r) ?? null;
      // v3: calc_mode / value / threshold mang cách tính gần đúng của config,
      // để app cũ (v2) vẫn thấy một khoản v2 và không coi là khoản cũ.
      const fallback = config ? fallbackCalcModeOf(config, code ?? CUSTOM_RULE_CODE) : null;
      const calcMode = fallback?.calcMode ?? r.calcMode ?? null;
      const value = fallback ? fallback.value : r.value;
      const threshold = fallback ? fallback.threshold : (r.threshold ?? null);
      // App v2 lưu lại: giữ config khi khoản không đổi cách tính; đổi thì
      // khoản theo cách tính v2 mới chọn (bỏ config).
      const keepConfig =
        !v3 &&
        !!rule?.calcConfig &&
        rule.calcMode === calcMode &&
        Number(rule.value) === Number(value) &&
        Number(rule.threshold ?? 0) === Number(threshold ?? 0);
      const payload: Partial<StorePayrollRule> = {
        storeId,
        category: r.category,
        name: r.name.trim(),
        ruleType: r.ruleType || code || 'CUSTOM',
        calcType: (r.calcType as PayrollCalcType) || PayrollCalcType.AMOUNT,
        value,
        isActive: r.isActive !== false,
        isCustom: code === PayrollRuleCode.CUSTOM,
        code,
        calcMode,
        threshold,
        description: r.description?.trim() || null,
        calcConfig: config
          ? (config as unknown as Record<string, unknown>)
          : keepConfig
            ? rule!.calcConfig
            : null,
        // Phạm vi: chỉ đổi khi body gửi trường này ([] = toàn cửa hàng). Thiếu
        // trường (app v2, và bản v3 đầu tiên — build 28 — chưa có phạm vi) thì
        // giữ phạm vi đang có: xoá đi sẽ biến khoản riêng thành khoản chung.
        employeeProfileIds:
          v3 && r.employeeProfileIds !== undefined
            ? r.employeeProfileIds?.length
              ? [...new Set(r.employeeProfileIds)]
              : null
            : (rule?.employeeProfileIds ?? null),
      };
      if (rule) Object.assign(rule, payload);
      else rule = repo.create(payload);
      if (rule.id) used.add(rule.id);
      toSave.push(rule);
    }
    const toRemove = current
      .filter((x) => !used.has(x.id) && present.has(x.category))
      .map((x) => x.id);
    if (toRemove.length) await repo.softDelete({ id: In(toRemove) });
    if (toSave.length) await repo.save(toSave);
    return true;
  }

  // --- Ghi nhận thưởng / vi phạm thủ công (employee_payroll_records) ---

  async listPayrollRecords(
    this: StoresService,
    profileId: string,
    monthKey?: string,
  ) {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      withDeleted: true,
    });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');
    const month =
      (monthKey && /^\d{4}-\d{2}$/.test(monthKey)
        ? vnMonthOfDateString(`${monthKey}-01`)
        : null) ?? vnMonthOf(new Date());
    const rows = await this.dataSource.getRepository(EmployeePayrollRecord).find({
      where: {
        employeeProfileId: profileId,
        workDate: Between(month.key, month.lastDate),
      },
      relations: ['rule'],
      withDeleted: false,
      order: { workDate: 'DESC', createdAt: 'DESC' },
    });
    return rows.map((r) => ({
      id: r.id,
      ruleId: r.ruleId,
      ruleName: r.rule?.name || r.ruleName,
      category: r.category,
      calcMode: r.rule?.calcMode ?? null,
      calcConfig: r.rule?.calcConfig ?? null,
      workDate: String(r.workDate).slice(0, 10),
      quantity: Number(r.quantity),
      note: r.note,
      createdAt: r.createdAt,
    }));
  }

  /** Phiếu lương tháng đó của nhân viên đã duyệt / đã trả thì không đổi được. */
  async assertPayslipOpen(
    this: StoresService,
    employeeProfileId: string,
    workDate: string,
  ) {
    const month = vnMonthOfDateString(workDate);
    if (!month) throw new BadRequestException('Ngày không hợp lệ');
    const payslip = await this.employeeSalaryRepository.findOne({
      where: { employeeProfileId, month: toMonthMarker(month) },
    });
    if (payslip && this.isProtectedPayslip(payslip)) {
      throw new ConflictException({
        code: 'PAYSLIP_FINALIZED',
        message: 'Phiếu lương tháng này đã chốt, không ghi nhận thêm được',
      });
    }
  }

  async createPayrollRecord(
    this: StoresService,
    profileId: string,
    dto: CreatePayrollRecordDto,
    ownerAccountId: string,
  ) {
    const profile = await this.profileRepository.findOne({ where: { id: profileId } });
    if (!profile?.storeId || !isShiftEligibleEmploymentStatus(profile.employmentStatus)) {
      throw new NotFoundException('Không tìm thấy nhân viên đang làm');
    }
    const rule = await this.payrollRuleRepository.findOne({
      where: { id: dto.ruleId, storeId: profile.storeId },
    });
    const revenueBased =
      rule?.calcConfig?.kind === 'PERCENT' && rule.calcConfig.base === 'REVENUE';
    if (
      !rule ||
      !rule.isActive ||
      !rule.calcMode ||
      // Theo % doanh số tháng: tự tính từ đơn hàng, ghi nhận tay không có tác dụng.
      revenueBased ||
      !MANUAL_PAYROLL_RULE_CODES.has(rule.code ?? '') ||
      (rule.category !== PayrollRuleCategory.BONUS &&
        rule.category !== PayrollRuleCategory.FINE)
    ) {
      throw new BadRequestException('Khoản này không ghi nhận thủ công được');
    }
    // Khoản chỉ áp dụng cho một số nhân viên: không ghi nhận cho người khác.
    if (rule.employeeProfileIds?.length && !rule.employeeProfileIds.includes(profile.id)) {
      throw new BadRequestException('Khoản này không áp dụng cho nhân viên này');
    }
    const workDate = dto.workDate;
    // Chỉ ngày có thật trong tháng này, không sau hôm nay: tháng trước tính lại
    // theo hợp đồng / khoản hiện tại sẽ làm đổi lương cũ; ngày tương lai tạo
    // bảng lương tháng sau.
    const parsed = new Date(`${workDate}T00:00:00Z`);
    const today = vnDateString();
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== workDate ||
      workDate.slice(0, 7) !== today.slice(0, 7) ||
      workDate > today
    ) {
      throw new BadRequestException('Chỉ ghi nhận được cho một ngày từ đầu tháng này đến hôm nay');
    }
    await this.assertPayslipOpen(profile.id, workDate);
    const repo = this.dataSource.getRepository(EmployeePayrollRecord);
    const saved = await repo.save(
      repo.create({
        storeId: profile.storeId,
        employeeProfileId: profile.id,
        ruleId: rule.id,
        ruleName: rule.name,
        category: rule.category,
        workDate,
        quantity: Math.round(Number(dto.quantity) * 100) / 100,
        note: dto.note?.trim() || null,
        createdByAccountId: ownerAccountId,
      }),
    );
    await this.recomputeEmployeePayslipForWorkDate({
      employeeProfileId: profile.id,
      storeId: profile.storeId,
      workDate,
    });
    return { id: saved.id };
  }

  async deletePayrollRecord(this: StoresService, recordId: string) {
    const repo = this.dataSource.getRepository(EmployeePayrollRecord);
    const record = await repo.findOne({ where: { id: recordId } });
    if (!record) throw new NotFoundException('Không tìm thấy ghi nhận');
    const workDate = String(record.workDate).slice(0, 10);
    await this.assertPayslipOpen(record.employeeProfileId, workDate);
    await repo.softDelete({ id: record.id });
    await this.recomputeEmployeePayslipForWorkDate({
      employeeProfileId: record.employeeProfileId,
      storeId: record.storeId,
      workDate,
    });
    return { deleted: true };
  }

  // Helper method to create or update monthly summary
  async createOrUpdateMonthlySummary(
    this: StoresService,
    employeeProfileId: string,
    baseSalary: number = 0,
    month?: Date,
    manager?: EntityManager,
  ) {
    // Default is the current Vietnam month, not the server clock's month.
    const targetMonth = month || toMonthMarker(vnMonthOf());

    const repository = manager
      ? manager.getRepository(EmployeeMonthlySummary)
      : this.monthlySummaryRepository;
    const existing = await repository.findOne({
      where: { employeeProfileId, month: targetMonth },
    });

    if (existing) {
      return existing;
    }

    const summary = repository.create({
      employeeProfileId,
      month: targetMonth,
      baseSalary,
      estimatedSalary: 0, // Sẽ được tính sau khi nhân viên checkin
    });

    return repository.save(summary);
  }

  // Monthly Payroll management
  async createPayroll(
    this: StoresService,
    storeId: string,
    data: Partial<MonthlyPayroll>,
  ) {
    const payroll = this.payrollRepository.create({
      ...this.creatableRow(this.payrollRepository, data),
      storeId,
    });
    return this.payrollRepository.save(payroll);
  }

  async getPayrolls(this: StoresService, storeId: string) {
    return this.payrollRepository.find({
      where: { storeId },
      order: { month: 'DESC' },
    });
  }

  async getPayrollById(this: StoresService, id: string) {
    return this.payrollRepository.findOne({ where: { id } });
  }

  async getPayrollByMonth(
    this: StoresService,
    storeId: string,
    date: Date | string,
  ) {
    return this.payrollRepository.findOne({
      where: { storeId, month: this.parsePayrollMonthMarker(date) },
    });
  }

  async updatePayroll(
    this: StoresService,
    id: string,
    data: Partial<MonthlyPayroll>,
  ) {
    await this.payrollRepository.update(id, data);
    return this.payrollRepository.findOne({ where: { id } });
  }

  async deletePayroll(this: StoresService, id: string) {
    // Deleting a payroll cascades to its payslips. Advances recorded against
    // those payslips are money records and must never be removed with them
    // (the FK is ON DELETE NO ACTION, so the database would refuse anyway).
    // Soft-deleted payslips and advance requests still hold the foreign key,
    // so they count: missing them turned the 409 into a 23503 500.
    const advances = await this.salaryAdvanceRequestRepository
      .createQueryBuilder('request')
      .withDeleted()
      .innerJoin('request.employeeSalary', 'salary')
      .where('salary.monthlyPayrollId = :payrollId', { payrollId: id })
      .getCount();
    if (advances > 0) {
      throw new ConflictException(
        'Không thể xoá phiếu lương đã có yêu cầu ứng lương',
      );
    }
    await this.payrollRepository.delete(id);
    return { message: 'Payroll deleted successfully' };
  }

  /**
   * Find or create the MonthlyPayroll scaffold row for a store+month.
   * Shared by payroll generation/recalculation, onboarding and the
   * real-time salary update on check-out, so every write path is guaranteed
   * a MonthlyPayroll to attach EmployeeSalary rows to (fixes orphaned
   * EmployeeSalary.monthlyPayrollId when check-out happens before the
   * monthly cron/generate endpoint has ever run for that month).
   *
   * Takes a per-(store, month) advisory lock that is held until the caller's
   * transaction ends, which serializes every payslip writer for that month.
   */
  async findOrCreateMonthlyPayroll(
    this: StoresService,
    storeId: string,
    month: VnMonth,
    manager?: EntityManager,
  ): Promise<MonthlyPayroll> {
    if (!manager) {
      return this.dataSource.transaction((transactionManager) =>
        this.findOrCreateMonthlyPayroll(storeId, month, transactionManager),
      );
    }
    // Key format must stay `<year>-<unpadded month>` (e.g. 2026-9), as before
    // the Vietnam-month refactor: during a rolling deploy old and new
    // instances must contend on the same lock.
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [monthlyPayrollLockKey(storeId, month)],
    );
    const monthMarker = toMonthMarker(month);
    const repo = manager.getRepository(MonthlyPayroll);
    let payroll = await repo.findOne({
      where: { storeId, month: monthMarker },
    });
    if (payroll) return payroll;

    payroll = repo.create({
      storeId,
      month: monthMarker,
      estimatedPayment: 0,
      salaryFund: 0,
      totalBonus: 0,
      totalPenalty: 0,
      totalOvertime: 0,
      totalPendingApproval: 0,
      totalApproved: 0,
      isFinalized: false,
    });
    return repo.save(payroll);
  }

  /**
   * Month argument of the generate/recalculate entry points: a raw API string
   * ('YYYY-MM-DD', 'YYYY-MM', 'MM/YYYY', ISO datetime) or an instant. Omitted
   * means the current Vietnam month.
   */
  resolveMonthArg(this: StoresService, date?: Date | string | null): VnMonth {
    if (date === undefined || date === null || date === '') return vnMonthOf();
    return this.parsePayrollMonth(date);
  }

  /**
   * Month parameter of the payroll read/write endpoints ('MM/YYYY', 'YYYY-MM',
   * 'YYYY-MM-DD', ISO datetime or Date), as a Vietnam month.
   */
  parsePayrollMonth(
    this: StoresService,
    input: string | Date | null | undefined,
  ): VnMonth {
    const month = parseVnMonthInput(input);
    if (!month) throw new BadRequestException('Tháng không hợp lệ');
    return month;
  }

  parsePayrollMonthMarker(
    this: StoresService,
    input: string | Date | null | undefined,
  ): Date {
    return toMonthMarker(this.parsePayrollMonth(input));
  }

  /**
   * Generates (or regenerates) the payroll for a store and month. Idempotent:
   * payslips are updated in place and never deleted, so salary advances
   * recorded against them survive. APPROVED and PAID payslips are only linked
   * to the payroll, never recomputed.
   */
  async createMonthlyPayrollForStore(
    this: StoresService,
    storeId: string,
    date?: Date | string,
  ) {
    return this.rebuildStorePayrollForMonth(
      storeId,
      this.resolveMonthArg(date),
    );
  }

  /**
   * Recalculates the payroll for a store and month from attendance, updating
   * PENDING/REJECTED payslips in place. Same routine as generation: it never
   * deletes payslips, so approved advances are preserved and re-applied.
   */
  async recalculatePayroll(
    this: StoresService,
    storeId: string,
    date?: Date | string,
  ) {
    return this.rebuildStorePayrollForMonth(
      storeId,
      this.resolveMonthArg(date),
    );
  }

  async rebuildStorePayrollForMonth(
    this: StoresService,
    storeId: string,
    month: VnMonth,
  ): Promise<MonthlyPayroll> {
    return this.dataSource.transaction(async (manager) => {
      // Takes the per-(store, month) advisory lock for the whole rebuild.
      const payroll = await this.findOrCreateMonthlyPayroll(
        storeId,
        month,
        manager,
      );
      const rules = await manager
        .getRepository(StorePayrollRule)
        .find({ where: { storeId, isActive: true } });
      const standardWorkingDays = await this.getStandardWorkingDays(
        storeId,
        month,
        manager,
      );
      // One template for the whole rebuild (not one query per employee).
      const payslipTemplate = await this.loadPayslipTemplate(storeId, manager);
      // Everyone who can work shifts is paid: active and probation staff.
      // ON_LEAVE staff are still skipped, as before: they are not rostered,
      // and a payslip they already have is left as it is (not rebuilt).
      const employees = await manager.getRepository(EmployeeProfile).find({
        where: {
          storeId,
          employmentStatus: In([...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]),
        },
        relations: ['contracts'],
      });

      const counts = { protected: 0, updated: 0, inserted: 0 };
      const now = new Date();
      for (const employee of employees) {
        const existing = await this.lockEmployeePayslip(
          manager,
          employee.id,
          month,
        );
        if (existing && this.isProtectedPayslip(existing)) {
          counts[
            await this.upsertEmployeePayslip(manager, {
              employeeProfileId: employee.id,
              month,
              monthlyPayrollId: payroll.id,
              payslip: null,
              allowances: null,
              existing,
            })
          ] += 1;
          continue;
        }

        const contract = employee.contracts?.find((c) => c.isActive) ?? null;
        let payslip: PayslipComputation | null = null;
        let rebuiltLines: PayslipAdjustmentLine[] = [];
        if (contract) {
          const { rate, adjustment } = await this.resolveRateForMonth(
            employee.id,
            contract,
            month,
            manager,
          );
          if (adjustment) {
            // Existing behaviour: an adjustment for the month is written back
            // to the active contract when payroll is generated.
            await manager
              .getRepository(EmployeeContract)
              .update(contract.id, { salaryAmount: rate });
          }
          const composed = await this.computeEmployeePayslip({
            manager,
            employeeProfileId: employee.id,
            storeId,
            month,
            contract,
            rate,
            rules,
            standardWorkingDays,
            existingSalaryId: existing?.id ?? null,
            otherDeductions: existing?.otherDeductions,
            now,
            stint: employee,
            payslipRows: payslipTemplate,
          });
          payslip = composed.payslip;
          rebuiltLines = effectiveAdjustmentLines(
            computeRuleAdjustmentBreakdown(
              composed.rules,
              composed.facts,
              composed.payslip.earnedBaseSalary,
            ),
            composed.payslip,
          );
        }

        counts[
          await this.upsertEmployeePayslip(manager, {
            employeeProfileId: employee.id,
            month,
            monthlyPayrollId: payroll.id,
            payslip,
            allowances: contract?.allowances ?? null,
            existing,
          })
        ] += 1;
        // Tính lại cả cửa hàng (chủ đổi thiết lập / mẫu phiếu): chỉ cập nhật
        // ảnh chụp, không báo — không phải nhân viên vừa phát sinh khoản nào.
        if (payslip) {
          await this.recordAdjustmentSnapshot(manager, employee.id, month, rebuiltLines);
        }
      }

      const totals = await this.refreshMonthlyPayrollTotals(
        manager,
        payroll.id,
      );
      // Counts only: per-employee amounts are not log material.
      this.logger.log(
        `[Payroll] store=${storeId} month=${month.label} employees=${employees.length} protected=${counts.protected} updated=${counts.updated} inserted=${counts.inserted}`,
      );
      return Object.assign(payroll, totals);
    });
  }

  isProtectedPayslip(
    this: StoresService,
    salary: Pick<EmployeeSalary, 'paymentStatus'>,
  ) {
    return (
      salary.paymentStatus === PaymentStatus.APPROVED ||
      salary.paymentStatus === PaymentStatus.PAID
    );
  }

  /**
   * Locks the employee's payslip row for the month, including a soft-deleted
   * one (it still occupies the unique (employee, month) key).
   */
  async lockEmployeePayslip(
    this: StoresService,
    manager: EntityManager,
    employeeProfileId: string,
    month: VnMonth,
  ): Promise<EmployeeSalary | null> {
    return manager.getRepository(EmployeeSalary).findOne({
      where: { employeeProfileId, month: toMonthMarker(month) },
      withDeleted: true,
      lock: { mode: 'pessimistic_write' },
    });
  }

  /**
   * The single payslip writer for generation, recalculation and check-out.
   *
   * Invariants: never deletes a payslip; never changes paymentStatus,
   * approvedAt or paidAt; APPROVED/PAID payslips are only linked to the
   * payroll. `advancePayment` is always re-derived from the APPROVED salary
   * advance requests, under the row lock, so it cannot be lost or doubled.
   *
   * `payslip: null` writes a zero payslip (employee without an active
   * contract) that still deducts approved advances.
   */
  async upsertEmployeePayslip(
    this: StoresService,
    manager: EntityManager,
    input: {
      employeeProfileId: string;
      month: VnMonth;
      monthlyPayrollId: string;
      payslip: PayslipComputation | null;
      allowances: Record<string, number> | null;
      /** Row already loaded under lock by the caller; omitted = load it here. */
      existing?: EmployeeSalary | null;
    },
  ): Promise<'protected' | 'updated' | 'inserted'> {
    const repository = manager.getRepository(EmployeeSalary);
    const existing =
      input.existing !== undefined
        ? input.existing
        : await this.lockEmployeePayslip(
            manager,
            input.employeeProfileId,
            input.month,
          );

    if (existing && this.isProtectedPayslip(existing)) {
      if (!existing.monthlyPayrollId) {
        await repository.update(existing.id, {
          monthlyPayrollId: input.monthlyPayrollId,
        });
      }
      return 'protected';
    }

    const advancePayment = await this.sumApprovedAdvances(
      existing?.id,
      manager,
    );
    // The owner's entered "khấu trừ khác" stays stored; the payslip takes it
    // unless the store's template removed the "Khấu trừ" row.
    const otherDeductions = Math.round(Number(existing?.otherDeductions) || 0);
    const payslip = input.payslip;
    const template = payslip?.payslipRows ?? null;
    const extras = payslipExtraTotals(template);
    const totals = computePayslipTotals({
      earnedBase: payslip?.earnedBaseSalary ?? 0,
      allowancesTotal: payslip?.allowancesTotal ?? 0,
      bonus: payslip?.bonus ?? 0,
      penalty: payslip?.penalty ?? 0,
      advancePayment,
      otherDeductions: isBuiltinRemoved(template, PayslipBuiltinRow.DEDUCTION)
        ? 0
        : otherDeductions,
      extraIncome: extras.additions,
      extraDeductions: extras.deductions,
    });

    const payload: Partial<EmployeeSalary> = {
      monthlyPayrollId: input.monthlyPayrollId,
      baseSalary: payslip?.baseSalary ?? 0,
      paymentType: payslip?.paymentType ?? PaymentType.MONTH,
      earnedBaseSalary: payslip?.earnedBaseSalary ?? 0,
      allowances: input.allowances ?? {},
      bonus: payslip?.bonus ?? 0,
      penalty: payslip?.penalty ?? 0,
      workingDays: payslip?.workingDays ?? 0,
      workingHours: payslip?.workingHours ?? 0,
      unauthorizedLeaveDays: payslip?.unauthorizedLeaveDays ?? 0,
      advancePayment: Math.round(advancePayment),
      otherDeductions,
      payslipRows: template,
      ...totals,
    };

    if (existing) {
      await repository.update(existing.id, payload);
      if (existing.deletedAt) await repository.restore(existing.id);
      return 'updated';
    }

    await repository.save(
      repository.create({
        ...payload,
        employeeProfileId: input.employeeProfileId,
        month: toMonthMarker(input.month),
      }),
    );
    return 'inserted';
  }

  /**
   * Payroll totals from the payslips actually linked to it (including rows of
   * employees who have since left), recomputed with SQL SUM.
   */
  async refreshMonthlyPayrollTotals(
    this: StoresService,
    manager: EntityManager,
    payrollId: string,
  ): Promise<{
    estimatedPayment: number;
    totalBonus: number;
    totalPenalty: number;
    totalPendingApproval: number;
  }> {
    const raw = await manager
      .getRepository(EmployeeSalary)
      .createQueryBuilder('salary')
      .select('COALESCE(SUM(salary.netSalary), 0)', 'estimatedPayment')
      .addSelect('COALESCE(SUM(salary.bonus), 0)', 'totalBonus')
      .addSelect('COALESCE(SUM(salary.penalty), 0)', 'totalPenalty')
      .where('salary.monthlyPayrollId = :payrollId', { payrollId })
      .getRawOne<{
        estimatedPayment: string;
        totalBonus: string;
        totalPenalty: string;
      }>();
    const totals = {
      estimatedPayment: Number(raw?.estimatedPayment || 0),
      totalBonus: Number(raw?.totalBonus || 0),
      totalPenalty: Number(raw?.totalPenalty || 0),
      totalPendingApproval: Number(raw?.estimatedPayment || 0),
    };
    await manager.getRepository(MonthlyPayroll).update(payrollId, totals);
    return totals;
  }

  /**
   * An employee's shift assignments whose slot work date is in the Vietnam
   * month, bound as 'YYYY-MM-DD' strings so the window never depends on the
   * server timezone.
   */
  async loadMonthlyAssignments(
    this: StoresService,
    employeeProfileId: string,
    storeId: string,
    month: VnMonth,
    manager?: EntityManager,
  ): Promise<PayrollAssignmentFact[]> {
    const repository = manager
      ? manager.getRepository(ShiftAssignment)
      : this.shiftAssignmentRepository;
    const assignments = await repository
      .createQueryBuilder('sa')
      .leftJoinAndSelect('sa.shiftSlot', 'slot')
      // Template times: a slot without its own start / end uses them (the
      // effective window of the v2 overtime / night / absent minutes).
      .leftJoinAndSelect('slot.workShift', 'slotWorkShift')
      .innerJoin('slot.cycle', 'cycle')
      .where('sa.employeeId = :employeeProfileId', { employeeProfileId })
      .andWhere('cycle.storeId = :storeId', { storeId })
      .andWhere('slot.workDate >= :monthStart', { monthStart: month.key })
      .andWhere('slot.workDate < :monthEnd', {
        monthEnd: month.endExclusiveDate,
      })
      .getMany();

    // Approved leave for the month, read on the same manager as the
    // attendance so both come from one snapshot under the payroll lock. A
    // shift covered by it (full-day leave types, or a timed leave attached to
    // that exact shift) is authorized leave and never counts as an absence.
    const leaveRepository = manager
      ? manager.getRepository(EmployeeLeaveRequest)
      : this.leaveRequestRepository;
    const approvedLeaves = assignments.length
      ? ((await leaveRepository.find({
          where: {
            employeeProfileId,
            status: LeaveRequestStatus.APPROVED,
            startDate: LessThanOrEqual(month.lastDate),
            endDate: MoreThanOrEqual(month.key),
          },
          take: 500,
        })) ?? [])
      : [];

    return assignments.map((a) => {
      const workDate = String(a.shiftSlot?.workDate ?? '').slice(0, 10);
      const window = effectiveWindowOf(a);
      return {
        id: a.id,
        workDate,
        status: a.status,
        attendanceStatus: a.attendanceStatus ?? null,
        checkInTime: a.checkInTime ?? null,
        checkOutTime: a.checkOutTime ?? null,
        windowStart: window.start,
        windowEnd: window.end,
        workedMinutes: a.workedMinutes ?? null,
        lateMinutes: a.lateMinutes ?? null,
        earlyMinutes: a.earlyMinutes ?? null,
        shiftEarnings: a.shiftEarnings ?? null,
        leaveCovered:
          workDate !== '' &&
          approvedLeaves.some((leave) =>
            leaveCoversShift(leave, workDate, a.id),
          ),
      };
    });
  }

  /**
   * Standard working days for a store in a Vietnam month, from its configured
   * weekly days off. Falls back to calendar days when the store has no shift
   * config (never returns 0).
   */
  async getStandardWorkingDays(
    this: StoresService,
    storeId: string,
    month: VnMonth,
    manager?: EntityManager,
  ): Promise<number> {
    const repository = manager
      ? manager.getRepository(StoreShiftConfig)
      : this.shiftConfigRepository;
    const config = await repository.findOne({
      where: { storeId },
      select: ['id', 'daysOff'],
    });
    return countWorkingDaysInMonth(
      month.year,
      month.monthIndex,
      config?.daysOff,
    );
  }

  /**
   * The contract rate for a month: the latest SalaryAdjustment effective that
   * month, else the contract's salary amount.
   */
  async resolveRateForMonth(
    this: StoresService,
    employeeProfileId: string,
    contract: EmployeeContract,
    month: VnMonth,
    manager?: EntityManager,
  ): Promise<{ rate: number; adjustment: SalaryAdjustment | null }> {
    const repository = manager
      ? manager.getRepository(SalaryAdjustment)
      : this.salaryAdjustmentRepository;
    const adjustment = await repository.findOne({
      where: { employeeProfileId, effectiveMonth: toMonthMarker(month) },
      order: { createdAt: 'DESC' },
    });
    const rate = Number(
      adjustment ? adjustment.newSalary : contract.salaryAmount,
    );
    return {
      rate: Number.isFinite(rate) ? rate : 0,
      adjustment: adjustment ?? null,
    };
  }

  // --- Payslip template ("Thiết lập tính lương" → bảng lương nhân viên) ---

  /** The store's payslip template (no stored rows: the default payslip). */
  async loadPayslipTemplate(
    this: StoresService,
    storeId: string,
    manager?: EntityManager,
  ): Promise<PayslipRowsSnapshot | null> {
    // Unit-test doubles may have no manager / repository for this table.
    const repository = (manager ?? this.dataSource?.manager)?.getRepository?.(
      StorePayslipRow,
    );
    if (!repository?.find) return null;
    const rows = await repository.find({
      where: { storeId },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return rows?.length ? payslipRowsSnapshot(rows) : null;
  }

  /**
   * Phụ cấp of a stored payslip: its allowances, or 0 when the template it
   * was computed with removed the row (the stored jsonb keeps the contract's).
   */
  storedAllowancesTotal(this: StoresService, row: EmployeeSalary): number {
    return isBuiltinRemoved(
      readPayslipRowsSnapshot(row.payslipRows),
      PayslipBuiltinRow.ALLOWANCE,
    )
      ? 0
      : sumAllowances(row.allowances);
  }

  /** Stored figures of rows the payslip's template removed, zeroed. */
  removedPayslipFigures(this: StoresService, row: EmployeeSalary) {
    const snapshot = readPayslipRowsSnapshot(row.payslipRows);
    return {
      ...(isBuiltinRemoved(snapshot, PayslipBuiltinRow.ALLOWANCE)
        ? { allowances: {} }
        : {}),
      ...(isBuiltinRemoved(snapshot, PayslipBuiltinRow.DEDUCTION)
        ? { otherDeductions: 0 }
        : {}),
    };
  }

  /** A payslip's stored snapshot as the apps read it (default when none). */
  payslipRowsOf(this: StoresService, value: unknown): PayslipRowsSnapshot {
    return readPayslipRowsSnapshot(value) ?? payslipRowsSnapshot([]);
  }

  async getPayslipRows(
    this: StoresService,
    storeId: string,
  ): Promise<PayslipRowsSnapshot> {
    return (await this.loadPayslipTemplate(storeId)) ?? payslipRowsSnapshot([]);
  }

  /**
   * Replaces the store's payslip template. Built-in rows: a label (renamed)
   * or `removed`; extra lines: label, PLUS / MINUS and an amount. The current
   * month's stored payslips are then recomputed with it (when that month's
   * payroll exists; the live salary screen always reads the template).
   * Finalized / approved payslips keep their own snapshot.
   */
  async savePayslipRows(
    this: StoresService,
    storeId: string,
    body: SavePayslipRowsDto,
  ): Promise<PayslipRowsSnapshot & { recalculationFailed?: boolean }> {
    const builtins = body?.builtins ?? {};
    const items = Array.isArray(body?.items) ? body.items : [];
    await this.dataSource.transaction(async (manager) => {
      // Saves of one store run one after the other: two concurrent
      // delete-then-insert would otherwise both insert their extra lines
      // (and pay them twice).
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `payslip-rows:${storeId}`,
      ]);
      const repository = manager.getRepository(StorePayslipRow);
      await repository.delete({ storeId });
      const rows: Partial<StorePayslipRow>[] = [];
      for (const key of Object.values(PayslipBuiltinRow)) {
        const builtin = builtins[key];
        if (!builtin) continue;
        const label = String(builtin.label ?? '').trim();
        const isDefault =
          !label || label === PAYSLIP_BUILTIN_DEFAULT_LABELS[key];
        if (!builtin.removed && isDefault) continue;
        rows.push({
          storeId,
          builtinKey: key,
          label: label || PAYSLIP_BUILTIN_DEFAULT_LABELS[key],
          sign:
            key === PayslipBuiltinRow.DEDUCTION
              ? PayslipRowSign.MINUS
              : PayslipRowSign.PLUS,
          amount: 0,
          sortOrder: 0,
          isActive: !builtin.removed,
        });
      }
      items.forEach((item, index) => {
        rows.push({
          storeId,
          builtinKey: null,
          label: String(item.label).trim(),
          sign:
            item.sign === PayslipRowSign.MINUS
              ? PayslipRowSign.MINUS
              : PayslipRowSign.PLUS,
          amount: Math.round(Number(item.amount) || 0),
          sortOrder: index + 1,
          isActive: true,
        });
      });
      if (rows.length)
        await repository.save(rows.map((row) => repository.create(row)));
    });

    const month = vnMonthOf();
    const payroll = await this.dataSource
      .getRepository(MonthlyPayroll)
      .findOne({ where: { storeId, month: toMonthMarker(month) } });
    let recalculationFailed = false;
    if (payroll) {
      try {
        await this.recalculatePayroll(storeId);
      } catch (error) {
        recalculationFailed = true;
        this.logger?.warn(
          `Payslip template saved but recalculation failed for ${storeId}: ${String(error)}`,
        );
      }
    }
    const saved = await this.getPayslipRows(storeId);
    // The app tells the owner: this month's stored payslips still show the
    // previous template until the next recalculation.
    return recalculationFailed ? { ...saved, recalculationFailed } : saved;
  }

  /**
   * The single payslip composer used by generation, recalculation, check-out
   * and the live estimate. Read-only: it performs no writes.
   */
  async computeEmployeePayslip(
    this: StoresService,
    p: {
      manager?: EntityManager;
      employeeProfileId: string;
      storeId: string;
      month: VnMonth;
      contract: EmployeeContract | null;
      rate: number;
      rules: StorePayrollRule[];
      standardWorkingDays: number;
      existingSalaryId?: string | null;
      otherDeductions?: number | null;
      now?: Date;
      /** The store's payslip template, when the caller already loaded it. */
      payslipRows?: PayslipRowsSnapshot | null;
      /**
       * The employee's current stint (`joinedAt`) and contracts. When the month
       * also holds shifts of a previous stint (a same-month rehire), those keep
       * the pay stored at their check-out; see computeStintSplitEarnedBase.
       * Omitted or a null `joinedAt` (legacy rows): one contract for the month.
       */
      stint?: {
        joinedAt?: Date | null;
        contracts?: EmployeeContract[] | null;
      };
    },
  ): Promise<{
    facts: MonthlyAttendanceFacts;
    assignments: PayrollAssignmentFact[];
    payslip: PayslipComputation;
    /** The rules that apply to this employee (scope filtered). */
    rules: StorePayrollRule[];
    /**
     * Earned base of the current stint only, when the month also holds a
     * previous stint's shifts (same-month rehire); null otherwise.
     */
    currentStintEarned: number | null;
  }> {
    const assignments = await this.loadMonthlyAssignments(
      p.employeeProfileId,
      p.storeId,
      p.month,
      p.manager,
    );
    const todayVn = vnDateString(p.now ?? new Date());
    const facts = summarizeMonthlyAttendance(assignments, todayVn);
    facts.monthComplete = todayVn >= p.month.endExclusiveDate;
    // Phạm vi áp dụng: khoản riêng của nhân viên khác không tính cho người này.
    const rules = rulesApplyingTo(p.rules, p.employeeProfileId);
    // v2 rules: the month's manual records ("ghi nhận") per rule, and the
    // employee's own pay per hour / shift for coefficient rules.
    if (p.contract && rules.some((rule) => rule.calcMode)) {
      const records = await this.loadPayrollRecordOccurrences(
        p.employeeProfileId,
        p.month,
        p.manager,
      );
      // "Giờ của ca hôm đó" của một ghi nhận: ca theo lịch ngày được ghi nhận;
      // ngày không có ca thì một ca trung bình của tháng.
      const byDate = scheduledMinutesByDate(assignments);
      const avgShift =
        facts.completedShifts > 0 && facts.workedMinutes > 0
          ? facts.workedMinutes / facts.completedShifts
          : 480;
      for (const list of Object.values(records)) {
        for (const o of list) o.shiftMinutes = byDate[o.date] || avgShift;
      }
      facts.recordOccurrences = records;
      facts.ruleQuantities = Object.fromEntries(
        Object.entries(records).map(([ruleId, list]) => [
          ruleId,
          list.reduce((sum, o) => sum + o.quantity, 0),
        ]),
      );
      if (rules.some((rule) => rule.calcConfig?.base === 'REVENUE')) {
        facts.revenue = await this.sumEmployeeMonthlyRevenue(
          p.employeeProfileId,
          p.storeId,
          p.month,
          p.manager,
        );
      }
      facts.payRates = payRatesOf({
        paymentType: p.contract.paymentType,
        rate: p.rate,
        standardWorkingDays: p.standardWorkingDays,
        facts,
      });
    }
    const advancePayment = await this.sumApprovedAdvances(
      p.existingSalaryId,
      p.manager,
    );
    // Same-month rehire: the previous stint's shifts keep their old pricing,
    // the current stint's shifts are priced with the current contract. Bonus
    // and fine rules still read the whole month's facts.
    const floor = stintFloor(p.stint?.joinedAt);
    const priorContract = floor
      ? ((p.stint?.contracts ?? [])
          .filter(
            (c) =>
              !c.isActive &&
              c.createdAt &&
              new Date(c.createdAt).getTime() < floor.getTime(),
          )
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )[0] ?? null)
      : null;
    const split = computeStintSplitEarnedBase({
      assignments,
      stintStartDate: stintStartVnDate(p.stint?.joinedAt),
      todayVn,
      current: {
        paymentType: p.contract?.paymentType ?? null,
        rate: p.contract ? p.rate : 0,
      },
      prior: priorContract
        ? {
            paymentType: priorContract.paymentType,
            rate: Number(priorContract.salaryAmount) || 0,
          }
        : null,
      standardWorkingDays: p.standardWorkingDays,
      calendarDays: p.month.calendarDays,
    });
    const payslip = computePayslip({
      earnedBaseSalary: split?.earnedBase ?? null,
      paymentType: p.contract?.paymentType ?? null,
      rate: p.contract ? p.rate : 0,
      allowances: p.contract?.allowances ?? null,
      rules: p.contract ? rules : [],
      facts,
      standardWorkingDays: p.standardWorkingDays,
      calendarDays: p.month.calendarDays,
      advancePayment,
      otherDeductions: Number(p.otherDeductions) || 0,
      // Like the bonus / fine rules, the template only applies with a contract:
      // without one the stored payslip is a zero payslip (upsertEmployeePayslip).
      payslipRows: !p.contract
        ? null
        : p.payslipRows !== undefined
          ? p.payslipRows
          : await this.loadPayslipTemplate(p.storeId, p.manager),
    });
    return {
      facts,
      assignments,
      payslip,
      rules: p.contract ? rules : [],
      currentStintEarned: split?.currentStintEarned ?? null,
    };
  }

  /**
   * Ghi ảnh chụp các dòng thưởng / vi phạm của phiếu lương tháng và trả về
   * các dòng vừa đổi so với lần trước. Gọi trong transaction đang giữ khoá
   * phiếu, ngay sau khi ghi phiếu. Phiếu đã chốt: không làm gì. Phiếu có từ
   * trước khi có tính năng (ảnh chụp NULL) chỉ ghi mốc, không trả thay đổi.
   */
  async recordAdjustmentSnapshot(
    this: StoresService,
    manager: EntityManager,
    employeeProfileId: string,
    month: VnMonth,
    lines: PayslipAdjustmentLine[],
  ): Promise<PayrollAdjustmentChange[]> {
    // Phần phụ (chỉ phục vụ thông báo): lỗi ở đây không được làm hỏng phiếu
    // lương vừa ghi trong cùng transaction — savepoint riêng, lỗi thì bỏ qua.
    const savepoint = 'payroll_adjustment_snapshot';
    try {
      await manager.query(`SAVEPOINT ${savepoint}`);
      const repo = manager.getRepository(EmployeeSalary);
      const row = await repo.findOne({
        where: { employeeProfileId, month: toMonthMarker(month) },
        withDeleted: true,
      });
      const changes: PayrollAdjustmentChange[] = [];
      if (row && !this.isProtectedPayslip(row)) {
        const next: AdjustmentSnapshot = {};
        for (const line of lines) {
          next[adjustmentKey(line)] = {
            amount: line.amount,
            label: line.label,
            kind: line.kind,
            count: line.count,
          };
        }
        const prev = row.adjustmentSnapshot as AdjustmentSnapshot | null;
        await repo.update(row.id, { adjustmentSnapshot: next });
        if (prev) {
          for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
            const before = prev[key];
            const after = next[key];
            const delta = (after?.amount ?? 0) - (Number(before?.amount) || 0);
            if (delta === 0) continue;
            // Chỉ báo khi có lần phát sinh mới / bớt (dòng mới, dòng mất, số
            // lần hoặc số giờ trong nhãn đổi). Số tiền trôi theo lương giờ
            // trung bình của tháng sau mỗi ca, hay ±1đ làm tròn: không báo.
            const occurrenceChanged =
              !before ||
              !after ||
              before.count !== after.count ||
              before.label !== after.label;
            if (!occurrenceChanged) continue;
            const ref = after ?? before!;
            changes.push({ kind: ref.kind, label: ref.label, delta, total: after?.amount ?? 0 });
          }
        }
      }
      await manager.query(`RELEASE SAVEPOINT ${savepoint}`);
      return changes;
    } catch (error) {
      try {
        await manager.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      } catch {
        // Không có savepoint (vd. manager giả trong test): không còn gì để huỷ.
      }
      this.logger?.warn(
        `[PayrollNotify] snapshot skipped for ${employeeProfileId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * Báo nhân viên và chủ từng dòng thưởng / vi phạm vừa đổi (đi muộn vừa ghi
   * nhận, nghỉ không phép vừa bị đánh dấu, chủ vừa ghi nhận thưởng…). Gọi
   * sau khi commit. Lỗi gửi chỉ ghi log: phiếu lương đã đúng.
   */
  async notifyAdjustmentChanges(
    this: StoresService,
    input: {
      employeeProfileId: string;
      storeId: string;
      month: VnMonth;
      workDate?: string | null;
      changes: PayrollAdjustmentChange[];
    },
  ): Promise<void> {
    if (!input.changes.length) return;
    try {
      const profile = await this.profileRepository.findOne({
        where: { id: input.employeeProfileId },
        relations: ['account'],
      });
      const store = await this.storeRepository.findOne({ where: { id: input.storeId } });
      const day = input.workDate
        ? `${input.workDate.slice(8, 10)}/${input.workDate.slice(5, 7)}`
        : null;
      const name = profile?.account?.fullName || 'Nhân viên';
      for (const change of input.changes) {
        const fine = change.kind === 'FINE';
        const head = fine ? 'Vi phạm' : 'Thưởng';
        const sign = fine ? '−' : '+';
        const added = change.delta > 0;
        const amount = `${added ? sign : fine ? '+' : '−'}${vnMoney(Math.abs(change.delta))}đ`;
        const total = change.total ? `${sign}${vnMoney(change.total)}đ` : '0đ';
        const content = `${added ? '' : 'Điều chỉnh '}${amount}${day ? ` · ngày ${day}` : ''}. Tạm tính tháng ${input.month.month}: ${total}.`;
        const metadata = {
          type: 'PAYROLL_ADJUSTMENT',
          employeeProfileId: input.employeeProfileId,
          month: input.month.label,
          ...(input.workDate ? { workDate: input.workDate } : {}),
        };
        const send = async (data: Parameters<NotificationsService['create']>[0]) => {
          try {
            await this.notificationsService.create(data);
          } catch (error) {
            // Một thông báo lỗi không chặn các thông báo còn lại (không log số tiền).
            this.logger.warn(
              `[PayrollNotify] send failed for ${input.employeeProfileId}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        };
        if (profile?.accountId) {
          await send({
            accountId: profile.accountId,
            storeId: input.storeId,
            title: `${head}: ${change.label}`,
            content,
            type: NotificationType.SYSTEM,
            priority: NotificationPriority.NORMAL,
            actionUrl: '/(salary)',
            metadata,
          });
        }
        if (store?.ownerAccountId && store.ownerAccountId !== profile?.accountId) {
          await send({
            accountId: store.ownerAccountId,
            storeId: input.storeId,
            title: `${name} · ${head}: ${change.label}`,
            content,
            type: NotificationType.SYSTEM,
            priority: NotificationPriority.NORMAL,
            actionUrl: `/(employee)/${input.employeeProfileId}`,
            metadata,
          });
        }
      }
    } catch (error) {
      // Không ghi số tiền vào log.
      this.logger.warn(
        `[PayrollNotify] failed for ${input.employeeProfileId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Các lần ghi nhận trong tháng của nhân viên, theo từng khoản. */
  async loadPayrollRecordOccurrences(
    this: StoresService,
    employeeProfileId: string,
    month: VnMonth,
    manager?: EntityManager,
  ): Promise<Record<string, RuleOccurrence[]>> {
    const rows: Array<{ ruleId: string; workDate: string; quantity: string }> =
      await (manager ?? this.dataSource.manager)
        .getRepository(EmployeePayrollRecord)
        .createQueryBuilder('r')
        .select('r.ruleId', 'ruleId')
        .addSelect(`to_char(r.workDate, 'YYYY-MM-DD')`, 'workDate')
        .addSelect('r.quantity', 'quantity')
        .where('r.employeeProfileId = :employeeProfileId', { employeeProfileId })
        .andWhere('r.ruleId IS NOT NULL')
        .andWhere('r.workDate >= :start', { start: month.key })
        .andWhere('r.workDate < :end', { end: month.endExclusiveDate })
        .getRawMany();
    const out: Record<string, RuleOccurrence[]> = {};
    for (const row of rows) {
      const quantity = Number(row.quantity) || 0;
      if (!(quantity > 0)) continue;
      (out[row.ruleId] ??= []).push({
        date: String(row.workDate).slice(0, 10),
        minutes: 0,
        quantity,
      });
    }
    return out;
  }

  /**
   * Doanh số tháng của nhân viên (Thưởng doanh số "Theo % doanh số tháng"):
   * tổng tiền các đơn HOÀN THÀNH của cửa hàng gắn với nhân viên, tạo trong
   * tháng (giờ VN).
   */
  async sumEmployeeMonthlyRevenue(
    this: StoresService,
    employeeProfileId: string,
    storeId: string,
    month: VnMonth,
    manager?: EntityManager,
  ): Promise<number> {
    const row: { total?: string } | undefined = await (manager ?? this.dataSource.manager)
      .getRepository(Order)
      .createQueryBuilder('o')
      .select('COALESCE(SUM(o."totalAmount"), 0)', 'total')
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.employee_id = :employeeProfileId', { employeeProfileId })
      .andWhere('o.status = :completed', { completed: OrderStatus.COMPLETED })
      .andWhere('o.created_at >= :start AND o.created_at < :end', {
        start: new Date(`${month.key}T00:00:00+07:00`),
        end: new Date(`${month.endExclusiveDate}T00:00:00+07:00`),
      })
      .getRawOne();
    return Number(row?.total) || 0;
  }

  // --- Store Payroll Payment History ---

  async createPaymentHistory(
    this: StoresService,
    storeId: string,
    data: CreateStorePayrollPaymentDto,
  ) {
    const payment = this.paymentHistoryRepository.create({
      ...data,
      storeId,
      month: this.parsePayrollMonthMarker(data.month), // First of the VN month
      paymentDate: data.paymentDate ? new Date(data.paymentDate) : new Date(),
    });
    return this.paymentHistoryRepository.save(payment);
  }

  async getPaymentHistories(this: StoresService, storeId: string) {
    return this.paymentHistoryRepository.find({
      where: { storeId },
      order: { paymentDate: 'DESC' },
    });
  }

  async updatePaymentHistory(
    this: StoresService,
    id: string,
    data: UpdateStorePayrollPaymentDto,
  ) {
    const payment = await this.paymentHistoryRepository.findOne({
      where: { id },
    });
    if (!payment)
      throw new NotFoundException('Không tìm thấy lịch sử thanh toán');

    Object.assign(payment, data);
    return this.paymentHistoryRepository.save(payment);
  }

  async deletePaymentHistory(this: StoresService, id: string) {
    const payment = await this.paymentHistoryRepository.findOne({
      where: { id },
    });
    if (!payment)
      throw new NotFoundException('Không tìm thấy lịch sử thanh toán');

    return this.paymentHistoryRepository.remove(payment);
  }

  async getPayrollSummary(
    this: StoresService,
    storeId: string,
    dateStr: string,
    ownerAccountId: string,
  ): Promise<PayrollMonthlySummaryResponseDto> {
    const authorizedStore = await this.assertOwnerStoreAccess(
      storeId,
      ownerAccountId,
    );
    const vnMonth = this.parsePayrollMonth(dateStr);
    const currentMonth = toMonthMarker(vnMonth);
    const prevMonth = toMonthMarker(shiftVnMonth(vnMonth, -1));

    // 1. Fetch current and previous payroll records
    const [currentPayroll, previousPayroll] = await Promise.all([
      this.payrollRepository.findOne({
        where: { storeId, month: currentMonth },
      }),
      this.payrollRepository.findOne({ where: { storeId, month: prevMonth } }),
    ]);

    // 1b. Tính salaryFundTotalStore (tổng tất cả stores cùng owner)
    let salaryFundTotalStore = 0;
    let estimatedPaymentTotalStore = 0;
    try {
      const allOwnerStores = await this.storeRepository.find({
        where: {
          ownerAccountId: authorizedStore.ownerAccountId,
          status: StoreStatus.ACTIVE,
        },
      });
      const storeIds = allOwnerStores.map((s) => s.id);
      const allPayrolls = storeIds.length
        ? await this.payrollRepository.find({
            where: { storeId: In(storeIds), month: currentMonth },
          })
        : [];
      salaryFundTotalStore = allPayrolls.reduce(
        (sum, p) => sum + Number(p.salaryFund || 0),
        0,
      );
      estimatedPaymentTotalStore = allPayrolls.reduce(
        (sum, p) => sum + Number(p.estimatedPayment || 0),
        0,
      );
    } catch (e) {
      console.warn(
        '[getPayrollSummary] Error calculating salaryFundTotalStore:',
        e,
      );
    }

    // 2. Fetch payment history for current month
    const paymentHistory = await this.paymentHistoryRepository.find({
      where: { storeId, month: currentMonth },
      order: { paymentDate: 'DESC' },
    });

    const calculateChange = (current: number, previous: number) => {
      if (!previous || previous === 0) return current > 0 ? 100 : 0;
      return parseFloat((((current - previous) / previous) * 100).toFixed(2));
    };

    const getSummaryValue = (current: number, previous: number) => ({
      value: current || 0,
      changePercent: calculateChange(current || 0, previous || 0),
    });

    // 3. Count approved and pending salaries
    const [totalApproved, totalPendingApproval] = await Promise.all([
      this.employeeSalaryRepository.count({
        where: {
          monthlyPayroll: { storeId, month: currentMonth },
          paymentStatus: In([PaymentStatus.APPROVED, PaymentStatus.PAID]),
        },
      }),
      this.employeeSalaryRepository.count({
        where: {
          monthlyPayroll: { storeId, month: currentMonth },
          paymentStatus: PaymentStatus.PENDING,
        },
      }),
    ]);

    return {
      estimatedPayment: Number(currentPayroll?.estimatedPayment || 0),
      totalBonus: getSummaryValue(
        Number(currentPayroll?.totalBonus),
        Number(previousPayroll?.totalBonus),
      ),
      totalPenalty: getSummaryValue(
        Number(currentPayroll?.totalPenalty),
        Number(previousPayroll?.totalPenalty),
      ),
      totalOvertime: getSummaryValue(
        Number(currentPayroll?.totalOvertime),
        Number(previousPayroll?.totalOvertime),
      ),
      totalApproved,
      totalPendingApproval,
      salaryFund: Number(currentPayroll?.salaryFund || 0),
      salaryFundTotalStore,
      estimatedPaymentTotalStore,
      paymentHistory,
    };
  }

  async getPayrollDetailsList(
    this: StoresService,
    storeId: string,
    monthStr: string,
  ) {
    const targetMonth = this.parsePayrollMonthMarker(monthStr);

    const payroll = await this.payrollRepository.findOne({
      where: { storeId, month: targetMonth },
    });

    if (!payroll) {
      return { bonuses: [], penalties: [], overtimes: [] };
    }

    const salaries = await this.employeeSalaryRepository.find({
      where: { monthlyPayrollId: payroll.id },
      relations: [
        'employeeProfile',
        'employeeProfile.account',
        'employeeProfile.employeeType',
        'employeeProfile.department',
        'employeeProfile.storeRole',
      ],
    });

    if (salaries.length === 0) {
      return { bonuses: [], penalties: [], overtimes: [] };
    }

    const summaries = await this.monthlySummaryRepository.find({
      where: {
        employeeProfileId: In(salaries.map((s) => s.employeeProfileId)),
        month: targetMonth,
      },
    });

    const summaryMap = new Map();
    summaries.forEach((s) => summaryMap.set(s.employeeProfileId, s));

    const bonuses: any[] = [];
    const penalties: any[] = [];
    const overtimes: any[] = [];

    salaries.forEach((salary) => {
      const profile = salary.employeeProfile;
      const summary = summaryMap.get(salary.employeeProfileId);

      const baseInfo = {
        id: profile?.id,
        name:
          (profile?.account as any)?.fullName ||
          (profile?.account as any)?.name ||
          'Unknown',
        position: profile?.storeRole?.name || '',
        type: profile?.employeeType?.name || '',
        avatar:
          (profile?.account as any)?.avatarUrl ||
          (profile?.account as any)?.avatar ||
          '',
      };

      if (Number(salary.penalty) > 0) {
        const reasons: string[] = [];
        if (summary) {
          if (summary.lateArrivalsCount > 0)
            reasons.push(`Muộn ${summary.lateArrivalsCount} lần`);
          if (summary.earlyDeparturesCount > 0)
            reasons.push(`Về sớm ${summary.earlyDeparturesCount} lần`);
          if (summary.unauthorizedLeavesCount > 0)
            reasons.push(`Nghỉ KP ${summary.unauthorizedLeavesCount} lần`);
          if (summary.forgotClockOutCount > 0)
            reasons.push(`Quên Check-out ${summary.forgotClockOutCount} lần`);
          if (summary.absentCount > 0)
            reasons.push(`Vắng ${summary.absentCount} ca`);
        }
        penalties.push({
          ...baseInfo,
          penaltyReason:
            reasons.length > 0 ? reasons.join(', ') : 'Vi phạm quy định',
          penaltyAmount: Number(salary.penalty),
        });
      }

      if (Number(salary.bonus) > 0) {
        bonuses.push({
          ...baseInfo,
          bonusReason: 'Thưởng chuyên cần / Thưởng chung',
          bonusAmount: Number(salary.bonus),
        });
      }

      if (summary && summary.extraShiftsCount > 0) {
        overtimes.push({
          ...baseInfo,
          overtimeReason: `Làm thêm ${summary.extraShiftsCount} ca`,
          overtimeAmount: Number(summary.overtimePay || 0),
        });
      }
    });

    return { bonuses, penalties, overtimes };
  }

  async downloadPayrollReport(
    this: StoresService,
    storeId: string,
    monthStr: string,
  ) {
    const workbook = new ExcelJS.Workbook();

    const targetMonth = this.parsePayrollMonthMarker(monthStr);

    const payroll = await this.payrollRepository.findOne({
      where: { storeId, month: targetMonth },
    });

    if (!payroll) {
      throw new BadRequestException('Chưa có thông tin dữ liệu cho tháng này');
    }

    const salaries = await this.employeeSalaryRepository.find({
      where: { monthlyPayrollId: payroll.id },
      relations: [
        'employeeProfile',
        'employeeProfile.account',
        'employeeProfile.employeeType',
        'employeeProfile.department',
        'employeeProfile.storeRole',
      ],
    });

    if (salaries.length === 0) {
      throw new BadRequestException(
        'Bảng lương tháng này chưa có nhân viên nào',
      );
    }

    const ws1 = workbook.addWorksheet('Ghi chú bảng lương');
    ws1.columns = [
      { header: 'STT', key: 'stt', width: 5 },
      { header: 'Tên nhân viên', key: 'name', width: 25 },
      { header: 'Vị trí', key: 'role', width: 20 },
      { header: 'Lương cơ bản', key: 'base', width: 15 },
      { header: 'Thưởng', key: 'bonus', width: 15 },
      { header: 'Khấu trừ (Phạt/Ứng)', key: 'deductions', width: 22 },
      { header: 'Tổng thu nhập', key: 'income', width: 15 },
      { header: 'Thực lãnh', key: 'net', width: 15 },
    ];

    ws1.getRow(1).font = { bold: true };
    salaries.forEach((salary, idx) => {
      const profile = salary.employeeProfile;
      ws1.addRow({
        stt: idx + 1,
        name:
          (profile?.account as any)?.fullName ||
          (profile?.account as any)?.name ||
          'Unknown',
        role: profile?.storeRole?.name || '',
        base: Number(salary.baseSalary || 0),
        bonus: Number(salary.bonus || 0),
        deductions: Number(salary.totalDeductions || salary.penalty || 0),
        income: Number(salary.totalIncome || 0),
        net: Number(salary.netSalary || 0),
      });
    });

    for (let i = 2; i <= salaries.length + 1; i++) {
      ['base', 'bonus', 'deductions', 'income', 'net'].forEach((col) => {
        const cell = ws1.getRow(i).getCell(col);
        if (cell.value) {
          cell.numFmt = '#,##0';
        }
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async updateSalaryFund(
    this: StoresService,
    storeId: string,
    dateStr: string,
    salaryFund: number,
    userId?: string,
  ) {
    if (!dateStr)
      throw new BadRequestException('Vui lòng cung cấp ngày tháng (date)');

    const month = this.parsePayrollMonthMarker(dateStr);

    let payroll = await this.payrollRepository.findOne({
      where: { storeId, month },
    });

    const oldValue = payroll ? Number(payroll.salaryFund) : 0;
    const isNew = !payroll;

    if (!payroll) {
      payroll = this.payrollRepository.create({
        storeId,
        month,
        salaryFund,
      });
    } else {
      payroll.salaryFund = salaryFund;
    }

    const savedPayroll = await this.payrollRepository.save(payroll);

    if (oldValue !== salaryFund) {
      const history = this.salaryFundHistoryRepository.create({
        storeId,
        month,
        oldValue,
        newValue: salaryFund,
        reason: isNew ? 'Khởi tạo quỹ lương' : 'Cập nhật quỹ lương',
        changedBy: userId,
      });
      await this.salaryFundHistoryRepository.save(history);
    }

    return savedPayroll;
  }

  /**
   * Lấy tổng quỹ lương và dự kiến cần trả của TẤT CẢ stores theo tháng.
   * Tự động tạo MonthlyPayroll nếu chưa có.
   */
  async getMonthlySalaryFund(
    this: StoresService,
    ownerAccountId: string,
    dateStr: string,
  ) {
    console.log(
      `[getMonthlySalaryFund] owner=${ownerAccountId}, dateStr=${dateStr}`,
    );

    const month = this.parsePayrollMonthMarker(dateStr);

    // Lấy tất cả stores của owner
    const stores = await this.storeRepository.find({
      where: { ownerAccountId, status: StoreStatus.ACTIVE },
    });

    console.log(`[getMonthlySalaryFund] found ${stores.length} stores`);

    if (stores.length === 0) {
      return {
        totalBudget: 0,
        totalExpectedPayroll: 0,
        totalRemainingBudget: 0,
        month: dateStr,
        storeCount: 0,
        stores: [],
      };
    }

    const storePayrolls: any[] = [];
    let totalBudget = 0;
    let totalExpectedPayroll = 0;

    for (const store of stores) {
      let payroll = await this.payrollRepository.findOne({
        where: { storeId: store.id, month },
      });

      // Auto-create MonthlyPayroll nếu chưa có (với salaryFund = 0)
      if (!payroll) {
        payroll = this.payrollRepository.create({
          storeId: store.id,
          month,
          salaryFund: 0,
          estimatedPayment: 0,
          totalBonus: 0,
          totalPenalty: 0,
          totalOvertime: 0,
          totalPendingApproval: 0,
          totalApproved: 0,
        });
        payroll = await this.payrollRepository.save(payroll);
      }

      const salaryFund = Number(payroll.salaryFund || 0);
      const estimatedPayment = Number(payroll.estimatedPayment || 0);
      const remainingBudget = salaryFund - estimatedPayment;

      totalBudget += salaryFund;
      totalExpectedPayroll += estimatedPayment;

      storePayrolls.push({
        storeId: store.id,
        storeName: store.name,
        salaryFund,
        estimatedPayment,
        remainingBudget,
      });
    }

    return {
      totalBudget,
      totalExpectedPayroll,
      totalRemainingBudget: totalBudget - totalExpectedPayroll,
      month: dateStr,
      storeCount: stores.length,
      stores: storePayrolls,
    };
  }

  async getSalaryFundHistory(
    this: StoresService,
    storeId: string,
    dateStr?: string,
  ) {
    const query = this.salaryFundHistoryRepository
      .createQueryBuilder('history')
      .where('history.storeId = :storeId', { storeId })
      .orderBy('history.createdAt', 'DESC');

    if (dateStr) {
      const monthDate = this.parsePayrollMonthMarker(dateStr);
      query.andWhere('history.month = :month', { month: monthDate });
    }

    return query.getMany();
  }

  async createMonthlyPayrollsForAllStores(this: StoresService, date?: Date) {
    const stores = await this.storeRepository.find({
      where: { status: StoreStatus.ACTIVE },
    });

    // Vietnam months: the cron fires at 00:10 VN on the 1st, which is still
    // the previous day on a UTC host.
    const currentMonth = vnMonthOf(date ?? new Date());
    // The previous month has just ended — run one reconciliation pass so any
    // shifts checked out late (or attendance corrected after month-end) are
    // folded in. Safe: the rebuild never touches APPROVED/PAID payslips and
    // never deletes, so this can never clobber a payment or an advance.
    const previousMonth = shiftVnMonth(currentMonth, -1);

    const results: MonthlyPayroll[] = [];
    for (const store of stores) {
      try {
        await this.rebuildStorePayrollForMonth(store.id, previousMonth);
        // Scaffold the new month so real-time check-out updates have a
        // MonthlyPayroll to attach to right away.
        const payroll = await this.rebuildStorePayrollForMonth(
          store.id,
          currentMonth,
        );
        results.push(payroll);
      } catch (error) {
        console.error(
          `Failed to create monthly payroll for store ${store.id}:`,
          error,
        );
      }
    }

    return results;
  }

  async createMonthlySummariesForAllEmployees(
    this: StoresService,
    date?: Date,
  ) {
    // Vietnam month of the given instant (default now), as a month marker.
    const targetMonth = toMonthMarker(vnMonthOf(date ?? new Date()));

    // Get all active employees across all stores
    const employees = await this.profileRepository.find({
      where: { employmentStatus: EmploymentStatus.ACTIVE },
      relations: ['contracts'],
    });

    const results: EmployeeMonthlySummary[] = [];
    for (const employee of employees) {
      try {
        // Get latest contract to determine base salary
        const latestContract = employee.contracts?.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )[0];

        const baseSalary = latestContract?.salaryAmount || 0;

        const summary = await this.createOrUpdateMonthlySummary(
          employee.id,
          baseSalary,
          targetMonth,
        );
        results.push(summary);
      } catch (error) {
        console.error(
          `Failed to create monthly summary for employee ${employee.id}:`,
          error,
        );
      }
    }

    return results;
  }

  // Salary Config management
  async createSalaryConfig(
    this: StoresService,
    ownerAccountId: string,
    data: Partial<SalaryConfig>,
  ) {
    const config = this.salaryConfigRepository.create({
      ...data,
      ownerAccountId,
    });
    return this.salaryConfigRepository.save(config);
  }

  async changeSalaryConfigStatus(
    this: StoresService,
    id: string,
    status: ConfigStatus,
  ) {
    const config = await this.salaryConfigRepository.findOne({ where: { id } });
    if (!config) throw new NotFoundException('Cấu hình không tồn tại');

    config.status = status;
    return this.salaryConfigRepository.save(config);
  }

  async getSalaryConfigsByStore(this: StoresService, storeId: string) {
    const configs = await this.salaryConfigRepository
      .createQueryBuilder('config')
      .where('"config"."storeIds"::jsonb ? :storeId', { storeId })
      .orderBy('config.createdAt', 'DESC')
      .getMany();

    // Map storeIds to full Store objects
    const configsWithStores = await Promise.all(
      configs.map(async (config) => {
        if (config.storeIds && config.storeIds.length > 0) {
          const stores = await this.storeRepository.find({
            where: { id: In(config.storeIds) },
            select: ['id', 'name', 'addressLine', 'phone'],
          });
          return { ...config, stores };
        }
        return { ...config, stores: [] };
      }),
    );

    return configsWithStores;
  }

  async getSalaryConfigs(this: StoresService, ownerAccountId: string) {
    return this.salaryConfigRepository.find({
      where: { ownerAccountId },
      order: { createdAt: 'DESC' },
    });
  }

  async getSalaryConfigById(this: StoresService, id: string) {
    return this.salaryConfigRepository.findOne({ where: { id } });
  }

  async updateSalaryConfig(
    this: StoresService,
    id: string,
    data: Partial<SalaryConfig>,
  ) {
    await this.salaryConfigRepository.update(id, data);
    return this.salaryConfigRepository.findOne({ where: { id } });
  }

  async deleteSalaryConfig(this: StoresService, id: string) {
    await this.salaryConfigRepository.softDelete(id);
    return { message: 'Xóa cấu hình lương thành công' };
  }

  // Employee Salary management
  /**
   * Phiếu lương tháng hiện tại khi nhận một nhân viên vào cửa hàng.
   *
   * Mỗi nhân viên chỉ được một phiếu cho mỗi tháng (unique employee_profile_id
   * + month). Xoá nhân viên khỏi cửa hàng chỉ xoá mềm hồ sơ và giữ nguyên
   * phiếu lương, nên nhận lại người đó trong cùng tháng sẽ đụng ràng buộc:
   * INSERT hỏng và cả giao dịch thêm nhân viên bị huỷ. Vì vậy dùng lại phiếu
   * đã có thay vì tạo phiếu thứ hai.
   *
   * Phiếu đã duyệt hoặc đã thanh toán là số tiền chủ đã chốt: không ghi đè.
   */
  async upsertInitialEmployeeSalary(
    this: StoresService,
    manager: EntityManager,
    data: {
      employeeProfileId: string;
      month: Date;
      monthlyPayrollId: string;
      baseSalary: number;
      paymentType?: PaymentType;
    },
  ): Promise<'inserted' | 'updated' | 'locked'> {
    // Same-month rehire: the single (profile, month) payslip is reused. While
    // it is PENDING/REJECTED, rebuild and checkout compute it from all of that
    // month's assignments: the earlier stint's shifts keep the pay stored at
    // their check-out (their old contract), and the new stint's shifts are
    // priced with the new contract (computeStintSplitEarnedBase). An APPROVED/PAID payslip is never
    // rewritten ('locked'): the new stint's shifts that month are then not
    // added automatically, which the rehire response reports as
    // `rehire.currentMonthPayslipLocked`.
    const repository = manager.getRepository(EmployeeSalary);
    const existing = await repository.findOne({
      where: {
        employeeProfileId: data.employeeProfileId,
        month: data.month,
      },
      // Phiếu của hồ sơ đã xoá mềm vẫn chiếm chỗ trong ràng buộc duy nhất.
      withDeleted: true,
    });

    if (!existing) {
      await repository.save(
        repository.create({
          ...data,
          workingHours: 0,
          earnedBaseSalary: 0,
        }),
      );
      return 'inserted';
    }

    if (
      existing.paymentStatus === PaymentStatus.APPROVED ||
      existing.paymentStatus === PaymentStatus.PAID
    ) {
      // Vẫn gắn vào bảng lương tháng đang mở nếu phiếu chưa thuộc bảng nào,
      // để nó không biến mất khỏi bảng lương của chủ.
      if (!existing.monthlyPayrollId) {
        await repository.update(existing.id, {
          monthlyPayrollId: data.monthlyPayrollId,
        });
      }
      if (existing.deletedAt) await repository.restore(existing.id);
      return 'locked';
    }

    await repository.update(existing.id, {
      monthlyPayrollId: data.monthlyPayrollId,
      baseSalary: data.baseSalary,
      ...(data.paymentType ? { paymentType: data.paymentType } : {}),
    });
    if (existing.deletedAt) await repository.restore(existing.id);
    return 'updated';
  }

  async createEmployeeSalary(
    this: StoresService,
    data: Partial<EmployeeSalary>,
    manager?: EntityManager,
  ) {
    const repository = manager
      ? manager.getRepository(EmployeeSalary)
      : this.employeeSalaryRepository;
    const salary = repository.create(data);
    return repository.save(salary);
  }

  /** Store of an employee profile, soft-deleted included (404 if none). */
  async profileStoreId(
    this: StoresService,
    employeeProfileId: string,
  ): Promise<string> {
    const profile =
      typeof employeeProfileId === 'string' && isUUID(employeeProfileId)
        ? await this.profileRepository.findOne({
            where: { id: employeeProfileId },
            select: ['id', 'storeId'],
            withDeleted: true,
          })
        : null;
    if (!profile?.storeId) {
      throw new NotFoundException('Không tìm thấy hồ sơ nhân viên');
    }
    return profile.storeId;
  }

  /**
   * `POST employee-salaries`: a manual payslip. Only whitelisted fields are
   * written, and the payroll it joins must be in the employee's store (the
   * guard proves the caller owns the employee's store).
   */
  async createEmployeeSalaryForStore(
    this: StoresService,
    dto: CreateEmployeeSalaryDto,
  ) {
    const storeId = await this.profileStoreId(dto.employeeProfileId);
    const month = parseVnMonthInput(dto.month);
    if (!month) throw new BadRequestException('Tháng lương không hợp lệ');
    await this.assertRowsInStore(storeId, [
      {
        repository: this.payrollRepository,
        id: dto.monthlyPayrollId,
        label: 'Bảng lương',
      },
    ]);
    try {
      return await this.createEmployeeSalary({
        ...(pickDefined(
          dto,
          EMPLOYEE_SALARY_CLIENT_FIELDS,
        ) as Partial<EmployeeSalary>),
        employeeProfileId: dto.employeeProfileId,
        month: toMonthMarker(month),
      });
    } catch (error: any) {
      if (error?.code === '23505' || error?.driverError?.code === '23505') {
        throw new ConflictException('Nhân viên đã có phiếu lương tháng này');
      }
      throw error;
    }
  }

  async getEmployeeSalaries(
    this: StoresService,
    employeeProfileId: string,
    month?: string,
  ) {
    const where: any = { employeeProfileId };
    let vnMonth: VnMonth | null = null;
    if (month) {
      // Accepts 'YYYY-MM' and the staff app's 'MM/YYYY'. The old split('-')
      // turned 'MM/YYYY' into an Invalid Date and a database error.
      vnMonth = parseVnMonthInput(month);
      if (!vnMonth) throw new BadRequestException('Tháng không hợp lệ');
      where.month = toMonthMarker(vnMonth);
    }
    const rows = await this.employeeSalaryRepository.find({
      where,
      order: { month: 'DESC' },
      // The staff payslip screen renders the employee's name, position and
      // employment type. Loading only `employeeProfile` left all three
      // undefined, so the screen showed "---" for every one of them.
      relations: [
        'employeeProfile',
        'employeeProfile.account',
        'employeeProfile.storeRole',
        'employeeProfile.employeeType',
        'employeeProfile.department',
        'monthlyPayroll',
      ],
    });
    if (!vnMonth) return rows;
    // One month = at most one payslip. Only the current VN month is shown
    // live; a past month keeps what was stored (never repriced with today's
    // contract, rate or rules).
    const selectedMonth = vnMonth;
    const isCurrentMonth = selectedMonth.key === vnMonthOf().key;
    if (!rows.length) {
      // No payslip row yet (e.g. the first days of the month, before any
      // check-out): the same live estimate as the Home card, so the salary
      // screen is not empty while Home shows a number. Never written.
      if (!isCurrentMonth) return [];
      const estimate = await this.buildEstimatePayslipRow(
        employeeProfileId,
        selectedMonth,
      );
      return estimate ? [estimate] : [];
    }
    return Promise.all(
      rows.map((row) =>
        this.presentPayslipForMonth(row, selectedMonth, isCurrentMonth),
      ),
    );
  }

  /**
   * A payslip as the salary screen shows it for one month.
   *
   * - Current VN month, not finalized (PENDING/REJECTED): the figures are
   *   recomputed live with the same composer as the Home estimate and
   *   recalculation, so both screens agree (for example an absence fine
   *   applied before the payslip is next rewritten). Read-only: nothing is
   *   written; `isEstimate: true`.
   * - APPROVED/PAID, or any month before the current VN month: the stored
   *   figures, `isEstimate: false`.
   *
   * `adjustmentBreakdown` lists the automatic bonus/fine lines; it is null
   * when it cannot be shown to add up to the payslip's bonus and penalty.
   * `allowancesTotal` is the sum of the returned `allowances`, which always
   * add up with earnedBaseSalary + bonus to totalIncome.
   */
  async presentPayslipForMonth(
    this: StoresService,
    row: EmployeeSalary,
    month: VnMonth,
    isCurrentMonth = true,
  ): Promise<
    EmployeeSalary & {
      isEstimate: boolean;
      isFinalized: boolean;
      allowancesTotal: number;
      adjustmentBreakdown: PayslipAdjustmentLine[] | null;
      earnedBreakdown: EarnedBreakdown | null;
      incomeAfterAdvance: number;
      deductionsExcludingAdvance: number;
      isNetClamped: boolean;
    }
  > {
    const isFinalized = this.isProtectedPayslip(row);
    const storeId = row.employeeProfile?.storeId;
    if (!storeId) {
      return Object.assign(row, {
        isEstimate: false,
        isFinalized,
        allowancesTotal: this.storedAllowancesTotal(row),
        adjustmentBreakdown: null,
        // No store: the attendance behind the stored amount cannot be read.
        earnedBreakdown: this.storedEarnedBreakdown(row, month, null),
        ...describePayslipTotals(row),
        payslipRows: this.payslipRowsOf(row.payslipRows),
      });
    }
    const live = await this.composeLivePayslip(
      row.employeeProfileId,
      storeId,
      month,
      row,
    );
    if (isFinalized || !isCurrentMonth) {
      const lines = computeRuleAdjustmentBreakdown(
        live.rules,
        live.facts,
        Number(row.earnedBaseSalary) || 0,
      );
      const sum = (kind: 'BONUS' | 'FINE') =>
        lines
          .filter((line) => line.kind === kind)
          .reduce((total, line) => total + line.amount, 0);
      const consistent =
        sum('BONUS') === Math.round(Number(row.bonus) || 0) &&
        sum('FINE') === Math.round(Number(row.penalty) || 0);
      return Object.assign(row, {
        isEstimate: false,
        isFinalized,
        allowancesTotal: this.storedAllowancesTotal(row),
        adjustmentBreakdown: consistent ? lines : null,
        earnedBreakdown: this.storedEarnedBreakdown(row, month, live),
        ...describePayslipTotals(row),
        payslipRows: this.payslipRowsOf(row.payslipRows),
      });
    }
    const payslip = live.payslip;
    return Object.assign(row, this.livePayslipFields(live), {
      isEstimate: true,
      isFinalized: false,
      allowancesTotal: payslip.allowancesTotal,
    });
  }

  /**
   * `earnedBreakdown` of a stored payslip (finalized, or a past month): its
   * stored earnedBaseSalary, baseSalary and paymentType described with the
   * live attendance facts. When those facts no longer give back the stored
   * amount (rate or attendance changed since, store unknown) `reproducible`
   * is false and `quantity`/`workedMinutes` are null: today's attendance is
   * never shown next to an amount it did not produce. Null when the stored
   * payment type is missing or unknown, or nothing was priced (no rate and
   * no amount).
   */
  storedEarnedBreakdown(
    this: StoresService,
    row: EmployeeSalary,
    month: VnMonth,
    live: Awaited<ReturnType<StoresService['composeLivePayslip']>> | null,
  ): EarnedBreakdown | null {
    const knownTypes = Object.values(PaymentType) as string[];
    if (!row.paymentType || !knownTypes.includes(row.paymentType)) return null;
    const rate = Number(row.baseSalary);
    const amount = Number(row.earnedBaseSalary);
    // Nothing priced: no rate and no earned amount.
    if (!(rate > 0) && !(amount > 0)) return null;
    const breakdown = describeEarnedBase({
      paymentType: row.paymentType,
      rate: row.baseSalary,
      facts: live?.facts ?? null,
      standardWorkingDays: live?.standardWorkingDays ?? 0,
      calendarDays: month.calendarDays,
      amount: row.earnedBaseSalary,
      mixedRates: live?.mixedRates ?? false,
    });
    return breakdown.reproducible
      ? breakdown
      : { ...breakdown, quantity: null, workedMinutes: null };
  }

  /** `earnedBreakdown` of a live payslip; null with no contract or no rate. */
  liveEarnedBreakdown(
    this: StoresService,
    live: Awaited<ReturnType<StoresService['composeLivePayslip']>>,
  ): EarnedBreakdown | null {
    const payslip = live.payslip;
    if (!live.contract) return null;
    if (!(payslip.baseSalary > 0) && payslip.earnedBaseSalary === 0) {
      return null;
    }
    return describeEarnedBase({
      paymentType: payslip.paymentType,
      rate: payslip.baseSalary,
      facts: live.facts,
      standardWorkingDays: live.standardWorkingDays,
      calendarDays: live.calendarDays,
      amount: payslip.earnedBaseSalary,
      mixedRates: live.mixedRates,
    });
  }

  /** The money/attendance fields of a live payslip, as the screen reads them. */
  livePayslipFields(
    this: StoresService,
    live: Awaited<ReturnType<StoresService['composeLivePayslip']>>,
  ) {
    const payslip = live.payslip;
    return {
      baseSalary: payslip.baseSalary,
      paymentType: payslip.paymentType,
      earnedBaseSalary: payslip.earnedBaseSalary,
      // The allowances the live income was computed from (the contract's),
      // not the stored jsonb, so Phụ cấp + earned + bonus = totalIncome.
      // (none when the store's template removed "Phụ cấp").
      allowances: (isBuiltinRemoved(
        payslip.payslipRows,
        PayslipBuiltinRow.ALLOWANCE,
      )
        ? {}
        : (live.contract?.allowances ?? {})) as Record<string, number>,
      bonus: payslip.bonus,
      penalty: payslip.penalty,
      workingDays: payslip.workingDays,
      workingHours: payslip.workingHours,
      unauthorizedLeaveDays: payslip.unauthorizedLeaveDays,
      advancePayment: payslip.advancePayment,
      otherDeductions: payslip.otherDeductions,
      totalIncome: payslip.totalIncome,
      totalDeductions: payslip.totalDeductions,
      netSalary: payslip.netSalary,
      adjustmentBreakdown: computeRuleAdjustmentBreakdown(
        live.rules,
        live.facts,
        payslip.earnedBaseSalary,
      ),
      earnedBreakdown: this.liveEarnedBreakdown(live),
      ...describePayslipTotals(payslip),
      payslipRows: this.payslipRowsOf(payslip.payslipRows),
    };
  }

  /**
   * A not-yet-stored payslip for the current month, built by the live
   * composer (`id: null`, `isEstimate: true`). Read-only.
   */
  async buildEstimatePayslipRow(
    this: StoresService,
    employeeProfileId: string,
    month: VnMonth,
  ) {
    const profile = await this.profileRepository.findOne({
      where: { id: employeeProfileId },
      relations: ['account', 'storeRole', 'employeeType'],
    });
    if (!profile?.storeId) return null;
    const live = await this.composeLivePayslip(
      employeeProfileId,
      profile.storeId,
      month,
      null,
    );
    return {
      id: null,
      employeeProfileId,
      employeeProfile: profile,
      monthlyPayrollId: null,
      monthlyPayroll: null,
      month: toMonthMarker(month),
      paymentStatus: PaymentStatus.PENDING,
      approvedBy: null,
      approvedAt: null,
      paidAt: null,
      notes: null,
      ...this.livePayslipFields(live),
      isEstimate: true,
      isFinalized: false,
      allowancesTotal: live.payslip.allowancesTotal,
    };
  }

  /**
   * The live payslip for a month from the active contract and attendance —
   * the one composer behind the Home estimate and the salary screen. Reads
   * only.
   */
  async composeLivePayslip(
    this: StoresService,
    employeeProfileId: string,
    storeId: string,
    month: VnMonth,
    existing: Pick<EmployeeSalary, 'id' | 'otherDeductions'> | null,
    standardWorkingDaysInput?: number,
  ) {
    const standardWorkingDays =
      standardWorkingDaysInput ??
      (await this.getStandardWorkingDays(storeId, month));
    const profile = await this.profileRepository.findOne({
      where: { id: employeeProfileId },
      relations: ['contracts'],
    });
    const activeContract = profile?.contracts?.find((c) => c.isActive) ?? null;
    const rate = activeContract
      ? (
          await this.resolveRateForMonth(
            employeeProfileId,
            activeContract,
            month,
          )
        ).rate
      : 0;
    const rules = activeContract
      ? await this.payrollRuleRepository.find({
          where: { storeId, isActive: true },
        })
      : [];
    const composed = await this.computeEmployeePayslip({
      employeeProfileId,
      storeId,
      month,
      contract: activeContract,
      rate,
      rules,
      standardWorkingDays,
      existingSalaryId: existing?.id ?? null,
      otherDeductions: existing?.otherDeductions,
      stint: profile ?? undefined,
    });
    const { facts, payslip, currentStintEarned } = composed;
    return {
      facts,
      payslip,
      // Chỉ khoản áp dụng cho nhân viên này (dòng chi tiết khớp tổng).
      rules: composed.rules,
      standardWorkingDays,
      calendarDays: month.calendarDays,
      // Same-month rehire: the earned base was priced per stint.
      mixedRates: currentStintEarned != null,
      contract: activeContract,
    };
  }

  async getEmployeeSalaryById(this: StoresService, id: string) {
    return this.employeeSalaryRepository.findOne({
      where: { id },
      relations: ['employeeProfile', 'monthlyPayroll'],
    });
  }

  /**
   * One payslip for a viewer: 404 when it does not exist, then the same
   * owner-or-self check as the other salary reads.
   */
  async getEmployeeSalaryByIdForViewer(
    this: StoresService,
    id: string,
    accountId: string,
  ) {
    const row = await this.getEmployeeSalaryById(id);
    if (!row) throw new NotFoundException('Không tìm thấy phiếu lương');
    await this.assertEmployeeSalaryAccess(row.employeeProfileId, accountId);
    return row;
  }

  /**
   * Live "lương tạm tính" for the employee Home screen.
   *
   * The finalized EmployeeSalary record only exists after the monthly payroll
   * is generated (typically month-end), so mid-month it returns nothing — which
   * is why the Home card showed empty. This computes an on-the-fly estimate from
   * the active contract + current-month attendance, mirroring the payroll
   * generation logic. If a finalized salary record already exists, that value
   * takes precedence.
   */
  async getEstimatedSalary(
    this: StoresService,
    employeeProfileId: string,
    storeId: string,
    monthStr?: string,
  ): Promise<{
    estimatedSalary: number;
    earnedBaseSalary: number;
    completedShifts: number;
    workingHours: number;
    daysWorked: number;
    standardWorkingDays: number;
    isFinalized: boolean;
    month: string;
    /** The shift under way (live estimate only): see inProgressShiftEstimate. */
    inProgress?: Awaited<ReturnType<StoresService['inProgressShiftEstimate']>>;
  }> {
    const month = parseVnMonthInput(monthStr) ?? vnMonthOf();
    const standardWorkingDays = await this.getStandardWorkingDays(
      storeId,
      month,
    );

    // Chỉ lấy số lưu khi phiếu lương đã chốt (duyệt / đã trả). Phiếu chờ duyệt
    // được tạo ngay lúc nhận nhân viên với thực lãnh 0, nên trước đây Home hiện
    // 0 hoặc số của lần check-out gần nhất thay vì số tạm tính hiện tại.
    const existing = await this.employeeSalaryRepository.findOne({
      where: { employeeProfileId, month: toMonthMarker(month) },
    });
    // A finalized payslip, or any stored payslip of a month before the
    // current VN month, is shown as stored (never repriced with today's
    // contract): only the current month is estimated live.
    const isCurrentMonth = month.key === vnMonthOf().key;
    if (existing && (this.isProtectedPayslip(existing) || !isCurrentMonth)) {
      const facts = summarizeMonthlyAttendance(
        await this.loadMonthlyAssignments(employeeProfileId, storeId, month),
        vnDateString(),
      );
      return {
        estimatedSalary: Number(existing.netSalary) || 0,
        earnedBaseSalary: Number(existing.earnedBaseSalary) || 0,
        completedShifts: facts.completedShifts,
        workingHours: facts.workingHours,
        daysWorked: facts.daysWorked,
        standardWorkingDays,
        isFinalized: this.isProtectedPayslip(existing),
        month: month.label,
      };
    }

    // Otherwise the live estimate, from the same composer as the payslip so
    // the Home card shows exactly what generating the payslip would store
    // (and what the salary screen shows for a month not yet finalized).
    const { facts, payslip } = await this.composeLivePayslip(
      employeeProfileId,
      storeId,
      month,
      existing ?? null,
      standardWorkingDays,
    );

    // Counted live by the app on top of the estimate (completed shifts only).
    const inProgress = isCurrentMonth
      ? await this.inProgressShiftEstimate(
          employeeProfileId,
          storeId,
          month,
        ).catch(() => null)
      : null;

    return {
      estimatedSalary: payslip.netSalary,
      earnedBaseSalary: payslip.earnedBaseSalary,
      completedShifts: facts.completedShifts,
      workingHours: facts.workingHours,
      daysWorked: facts.daysWorked,
      standardWorkingDays,
      isFinalized: false,
      month: month.label,
      inProgress,
    };
  }

  async getEmployeeSalariesByStore(
    this: StoresService,
    storeId: string,
    monthStr: string,
    filterType?: string,
  ) {
    const targetMonth = this.parsePayrollMonthMarker(monthStr);

    // 1. Find the MonthlyPayroll for this store and month
    const payroll = await this.payrollRepository.findOne({
      where: { storeId, month: targetMonth },
    });

    if (!payroll) {
      return {
        salaries: [],
        typeCounts: [],
      };
    }

    // 2. Find all employee salaries linked to this payroll
    const allSalaries = await this.employeeSalaryRepository.find({
      where: { monthlyPayrollId: payroll.id },
      relations: [
        'employeeProfile',
        'employeeProfile.account',
        'employeeProfile.employeeType',
        'employeeProfile.department',
        'employeeProfile.storeRole',
      ],
      order: {
        employeeProfile: {
          account: {
            fullName: 'ASC',
          },
        },
      },
    });

    // 3. Aggregate counts by Employee Type
    const typeMap = new Map<string, number>();
    let totalCount = 0;

    allSalaries.forEach((salary) => {
      totalCount++;
      const typeName = salary.employeeProfile?.employeeType?.name || 'Unknown';
      typeMap.set(typeName, (typeMap.get(typeName) || 0) + 1);
    });

    const typeCounts = [{ name: 'All', count: totalCount }];

    typeMap.forEach((count, name) => {
      typeCounts.push({ name, count });
    });

    // 4. Filter salaries if type is specified
    let filteredSalaries = allSalaries;
    if (filterType && filterType !== 'All') {
      filteredSalaries = allSalaries.filter((salary) => {
        const typeName =
          salary.employeeProfile?.employeeType?.name || 'Unknown';
        return typeName === filterType;
      });
    }

    return {
      salaries: filteredSalaries,
      typeCounts,
    };
  }

  async updateEmployeeSalary(
    this: StoresService,
    id: string,
    data: UpdateEmployeeSalaryDto,
  ) {
    const salary = await this.employeeSalaryRepository.findOne({
      where: { id },
      select: ['id', 'employeeProfileId'],
    });
    if (!salary) throw new NotFoundException('Không tìm thấy phiếu lương');
    // A payslip may only join a payroll of its own employee's store.
    const storeId = await this.profileStoreId(salary.employeeProfileId);
    await this.assertRowsInStore(storeId, [
      {
        repository: this.payrollRepository,
        id: data?.monthlyPayrollId,
        label: 'Bảng lương',
      },
    ]);
    const changes = pickDefined(
      data,
      EMPLOYEE_SALARY_CLIENT_FIELDS,
    ) as Partial<EmployeeSalary>;
    if (Object.keys(changes).length > 0) {
      await this.employeeSalaryRepository.update(id, changes);
    }
    return this.employeeSalaryRepository.findOne({
      where: { id },
      relations: ['employeeProfile', 'monthlyPayroll'],
    });
  }

  async deleteEmployeeSalary(this: StoresService, id: string) {
    // Advances recorded against a payslip are money records; refuse rather
    // than delete them with it (the FK is ON DELETE NO ACTION).
    // Soft-deleted advance requests still hold the foreign key.
    const advances = await this.salaryAdvanceRequestRepository.count({
      where: { employeeSalaryId: id },
      withDeleted: true,
    });
    if (advances > 0) {
      throw new ConflictException(
        'Không thể xoá phiếu lương đã có yêu cầu ứng lương',
      );
    }
    await this.employeeSalaryRepository.delete(id);
    return { message: 'Employee salary deleted successfully' };
  }

  // Salary Advance Request management
  async createSalaryAdvanceRequest(
    this: StoresService,
    employeeProfileId: string,
    data: {
      employeeSalaryId?: string;
      requestedAmount: number;
      requestReason?: string;
    },
    actorAccountId?: string,
  ) {
    // 1. Lấy thông tin phiếu lương. The staff app sends no payslip id: the
    // advance is on this month's payslip (written at each check-out). An
    // undefined id used to match an arbitrary payslip and fail.
    const employeeSalary = data.employeeSalaryId
      ? await this.employeeSalaryRepository.findOne({
          where: { id: data.employeeSalaryId },
          relations: ['employeeProfile'],
        })
      : await this.employeeSalaryRepository.findOne({
          where: {
            employeeProfileId,
            month: toMonthMarker(vnMonthOf()),
          } as any,
          relations: ['employeeProfile'],
        });

    if (!employeeSalary) {
      throw new NotFoundException(
        data.employeeSalaryId
          ? 'Không tìm thấy phiếu lương'
          : 'Chưa có lương tháng này để ứng. Vui lòng thử lại sau khi làm ca đầu tiên trong tháng.',
      );
    }

    if (employeeSalary.employeeProfileId !== employeeProfileId) {
      throw new BadRequestException('Phiếu lương không thuộc về nhân viên này');
    }

    // 2. Tính tổng số tiền đã ứng (bao gồm cả pending và approved)
    const existingAdvances = await this.salaryAdvanceRequestRepository.find({
      where: {
        employeeSalaryId: employeeSalary.id,
        status: In([
          AdvanceRequestStatus.PENDING,
          AdvanceRequestStatus.APPROVED,
        ]),
      },
    });

    const totalAdvanced = existingAdvances.reduce((sum, adv) => {
      const amount =
        adv.status === AdvanceRequestStatus.APPROVED
          ? adv.approvedAmount || adv.requestedAmount
          : adv.requestedAmount;
      return sum + Number(amount);
    }, 0);

    const totalAfterRequest = totalAdvanced + Number(data.requestedAmount);

    // 3. Kiểm tra điều kiện: Tổng tiền ứng không được vượt quá netSalary
    if (totalAfterRequest > Number(employeeSalary.netSalary)) {
      throw new BadRequestException(
        `Tổng số tiền ứng (${totalAfterRequest.toLocaleString()}đ) vượt quá lương thực nhận (${Number(employeeSalary.netSalary).toLocaleString()}đ)`,
      );
    }

    // 4. Tạo yêu cầu ứng lương
    const request = this.salaryAdvanceRequestRepository.create({
      employeeProfileId,
      employeeSalaryId: employeeSalary.id,
      requestedAmount: data.requestedAmount,
      requestReason: data.requestReason,
      status: AdvanceRequestStatus.PENDING,
      requestedAt: new Date(),
    });

    const saved = await this.salaryAdvanceRequestRepository.save(request);
    // Month only: amounts and the reason never go into the activity log.
    await this.logActivity(null, {
      storeId: employeeSalary.employeeProfile?.storeId ?? null,
      actorAccountId: actorAccountId ?? null,
      subjectEmployeeProfileId: employeeProfileId,
      action: ACTIVITY_ACTIONS.SALARY_ADVANCE_CREATED,
      resourceType: 'salary_advance',
      resourceId: saved.id,
      params: { month: this.activityMonth(employeeSalary.month) },
      idempotencyKey: `${ACTIVITY_ACTIONS.SALARY_ADVANCE_CREATED}:${saved.id}`,
    });
    const storeId = employeeSalary.employeeProfile?.storeId;
    if (storeId) {
      void this.notifyOwnerOfRequest({
        storeId,
        employeeProfileId,
        kind: 'SALARY_ADVANCE',
        requestId: saved.id,
        amount: Number(saved.requestedAmount),
        reason: saved.requestReason ?? null,
        actorAccountId: actorAccountId ?? null,
      });
    }
    return saved;
  }

  /** A payslip month marker → `YYYY-MM` (VN calendar). */
  activityMonth(this: StoresService, month: Date | string | null | undefined) {
    return toActivityDate(month ?? null)?.slice(0, 7);
  }

  async getSalaryAdvanceRequests(
    this: StoresService,
    filters: {
      storeId?: string;
      employeeProfileId?: string;
      status?: AdvanceRequestStatus;
      month?: Date;
    },
  ) {
    const queryBuilder = this.salaryAdvanceRequestRepository
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.employeeProfile', 'profile')
      .leftJoinAndSelect('profile.account', 'account')
      .leftJoinAndSelect('profile.storeRole', 'storeRole')
      .leftJoinAndSelect('profile.employeeType', 'employeeType')
      .leftJoinAndSelect('request.employeeSalary', 'salary')
      .leftJoinAndSelect('request.reviewedBy', 'reviewer')
      .orderBy('request.requestedAt', 'DESC');

    if (filters.storeId) {
      queryBuilder.andWhere('profile.storeId = :storeId', {
        storeId: filters.storeId,
      });
    }

    if (filters.employeeProfileId) {
      queryBuilder.andWhere('request.employeeProfileId = :employeeProfileId', {
        employeeProfileId: filters.employeeProfileId,
      });
    }

    if (filters.status) {
      queryBuilder.andWhere('request.status = :status', {
        status: filters.status,
      });
    }

    if (filters.month) {
      queryBuilder.andWhere('salary.month = :month', { month: filters.month });
    }

    // A rehired employee's advance requests from the previous stint are
    // kept (payroll history) but not listed.
    queryBuilder.andWhere(currentStintSql('profile', 'request.requested_at'));

    const requests = await queryBuilder.getMany();

    // Map to include UI specific fields
    return Promise.all(
      requests.map(async (request) => {
        // Tính tổng tiền đã ứng được DUYỆT cho phiếu lương này (không tính request hiện tại)
        const approvedAdvances = await this.salaryAdvanceRequestRepository.find(
          {
            where: {
              employeeSalaryId: request.employeeSalaryId,
              status: AdvanceRequestStatus.APPROVED,
              id: Not(request.id),
            },
          },
        );

        const totalApproved = approvedAdvances.reduce((sum, adv) => {
          return sum + Number(adv.approvedAmount || adv.requestedAmount);
        }, 0);

        const requestMonth =
          new Date(request.employeeSalary.month).getMonth() + 1;
        const nextMonth = (requestMonth % 12) + 1;

        let warningMessage: string | null = null;
        if (totalApproved > 0) {
          warningMessage = `Đã ứng lương tháng ${requestMonth}. Nếu tiếp tục sẽ cấn trừ qua tháng ${nextMonth}`;
        }

        return {
          ...request,
          employeeInfo: {
            fullName: request.employeeProfile.account?.fullName,
            avatar: request.employeeProfile.account?.avatar,
            employeeCode: `NV${request.employeeProfile.id.slice(0, 4)}`, // Giả lập mã NV
            roleName: request.employeeProfile.storeRole?.name,
            employeeTypeName: request.employeeProfile.employeeType?.name,
          },
          warningMessage,
          totalApprovedBefore: totalApproved,
        };
      }),
    );
  }

  async reviewSalaryAdvanceRequest(
    this: StoresService,
    requestId: string,
    reviewerId: string,
    data: {
      status: AdvanceRequestStatus;
      approvedAmount?: number;
      reviewNote?: string;
      paymentMethod?: string;
      paymentReference?: string;
    },
  ) {
    const request = await this.salaryAdvanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['employeeSalary'],
    });

    if (!request) {
      throw new NotFoundException('Không tìm thấy yêu cầu ứng lương');
    }

    if (request.status !== AdvanceRequestStatus.PENDING) {
      throw new BadRequestException('Yêu cầu này đã được xử lý');
    }

    let approvedAmount = 0;
    if (data.status === AdvanceRequestStatus.APPROVED) {
      // `||` treated a deliberate 0 as "not supplied" and granted the full
      // request. `??` distinguishes "omitted" from "approved for nothing".
      approvedAmount = Number(data.approvedAmount ?? request.requestedAmount);
      if (!Number.isFinite(approvedAmount) || approvedAmount < 0) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Số tiền duyệt không hợp lệ.',
        });
      }
    }

    // One transaction with the payslip row locked, so a concurrent payroll
    // recalculation or a second review cannot interleave. `advancePayment` is
    // re-derived from the APPROVED requests (the source of truth) instead of
    // being incremented, so it can be neither lost nor doubled.
    return this.dataSource.transaction(async (manager) => {
      const requestRepository = manager.getRepository(SalaryAdvanceRequest);
      const salaryRepository = manager.getRepository(EmployeeSalary);

      const lockedSalary = request.employeeSalaryId
        ? await salaryRepository.findOne({
            where: { id: request.employeeSalaryId },
            lock: { mode: 'pessimistic_write' },
          })
        : null;
      const current = await requestRepository.findOne({
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) {
        throw new NotFoundException('Không tìm thấy yêu cầu ứng lương');
      }
      if (current.status !== AdvanceRequestStatus.PENDING) {
        throw new BadRequestException('Yêu cầu này đã được xử lý');
      }

      const payslip = lockedSalary ?? request.employeeSalary;
      if (data.status === AdvanceRequestStatus.APPROVED) {
        if (!payslip) {
          throw new NotFoundException('Không tìm thấy phiếu lương');
        }
        // Kiểm tra lại điều kiện
        const totalAdvanced = await this.calculateTotalAdvanced(
          request.employeeSalaryId,
          requestId,
        );
        const totalAfterApproval = totalAdvanced + approvedAmount;

        if (totalAfterApproval > Number(payslip.netSalary)) {
          throw new BadRequestException(
            `Tổng tiền ứng sau khi duyệt (${totalAfterApproval.toLocaleString()}đ) vượt quá lương thực nhận`,
          );
        }
        request.approvedAmount = approvedAmount;
      }

      // Cập nhật trạng thái request
      request.status = data.status;
      request.reviewedAt = new Date();
      request.reviewedByAccountId = reviewerId;
      if (data.reviewNote) request.reviewNote = data.reviewNote;
      if (data.paymentMethod) request.paymentMethod = data.paymentMethod;
      if (data.paymentReference) {
        request.paymentReference = data.paymentReference;
      }
      const saved = await requestRepository.save(request);

      const reviewAction =
        data.status === AdvanceRequestStatus.APPROVED
          ? ACTIVITY_ACTIONS.SALARY_ADVANCE_APPROVED
          : data.status === AdvanceRequestStatus.REJECTED
            ? ACTIVITY_ACTIONS.SALARY_ADVANCE_REJECTED
            : null;
      if (reviewAction) {
        await this.logActivity(manager, {
          actorAccountId: reviewerId,
          subjectEmployeeProfileId: request.employeeProfileId,
          action: reviewAction,
          resourceType: 'salary_advance',
          resourceId: requestId,
          params: { month: this.activityMonth(payslip?.month) },
          idempotencyKey: `${reviewAction}:${requestId}`,
        });
      }

      if (data.status === AdvanceRequestStatus.APPROVED && payslip) {
        const advancePayment = await this.sumApprovedAdvances(
          request.employeeSalaryId,
          manager,
        );
        // Stored income, penalty, other deductions and the template's
        // MINUS lines are kept; net is floored at 0 like every other
        // net-salary computation.
        const counted = countedPayslipDeductions(payslip);
        const totals = computeNetFromIncome({
          totalIncome: Number(payslip.totalIncome) || 0,
          penalty: counted.penalty,
          advancePayment,
          otherDeductions: counted.otherDeductions,
          extraDeductions: counted.extraDeductions,
        });
        await salaryRepository.update(request.employeeSalaryId, {
          advancePayment: Math.round(advancePayment),
          totalDeductions: totals.totalDeductions,
          netSalary: totals.netSalary,
        });
      }

      return saved;
    });
  }

  /** Only the employee who filed the advance request may cancel it. */
  async cancelSalaryAdvanceRequest(
    this: StoresService,
    requestId: string,
    accountId: string,
  ) {
    if (!accountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    const request = await this.salaryAdvanceRequestRepository.findOne({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Không tìm thấy yêu cầu ứng lương');
    }

    const requester = await this.profileRepository.findOne({
      where: { id: request.employeeProfileId },
      select: ['id', 'accountId'],
      withDeleted: true,
    });
    if (!requester || requester.accountId !== accountId) {
      // Same answer as a missing request: do not confirm foreign ids exist.
      throw new NotFoundException('Không tìm thấy yêu cầu ứng lương');
    }

    if (request.status !== AdvanceRequestStatus.PENDING) {
      throw new BadRequestException('Chỉ có thể hủy yêu cầu đang chờ duyệt');
    }

    // Conditional on PENDING (and on the verified requester): saving the
    // whole entity read above could overwrite a concurrent approval with
    // CANCELLED and silently drop the payslip deduction.
    const result = await this.salaryAdvanceRequestRepository.update(
      {
        id: request.id,
        status: AdvanceRequestStatus.PENDING,
        employeeProfileId: requester.id,
      },
      { status: AdvanceRequestStatus.CANCELLED },
    );
    if (!result.affected) {
      throw new BadRequestException('Chỉ có thể hủy yêu cầu đang chờ duyệt');
    }
    request.status = AdvanceRequestStatus.CANCELLED;
    await this.logActivity(null, {
      actorAccountId: accountId,
      subjectEmployeeProfileId: requester.id,
      action: ACTIVITY_ACTIONS.SALARY_ADVANCE_CANCELLED,
      resourceType: 'salary_advance',
      resourceId: request.id,
      idempotencyKey: `${ACTIVITY_ACTIONS.SALARY_ADVANCE_CANCELLED}:${request.id}`,
    });
    return request;
  }

  /**
   * Advances already granted against a payslip.
   *
   * Distinct from `calculateTotalAdvanced`, which also counts PENDING requests
   * because it answers "how much is committed" for the approval cap. Only
   * APPROVED money has actually left the business, so only that is deducted.
   */
  async sumApprovedAdvances(
    this: StoresService,
    employeeSalaryId: string | undefined | null,
    manager?: EntityManager,
  ): Promise<number> {
    if (!employeeSalaryId) return 0;
    const repository = manager
      ? manager.getRepository(SalaryAdvanceRequest)
      : this.salaryAdvanceRequestRepository;
    const approved = await repository.find({
      where: {
        employeeSalaryId,
        status: AdvanceRequestStatus.APPROVED,
      },
      select: ['approvedAmount', 'requestedAmount'],
    });
    return approved.reduce(
      (sum, request) =>
        sum + Number(request.approvedAmount ?? request.requestedAmount ?? 0),
      0,
    );
  }

  async calculateTotalAdvanced(
    this: StoresService,
    employeeSalaryId: string,
    excludeRequestId?: string,
  ) {
    const queryBuilder = this.salaryAdvanceRequestRepository
      .createQueryBuilder('request')
      .where('request.employeeSalaryId = :employeeSalaryId', {
        employeeSalaryId,
      })
      .andWhere('request.status IN (:...statuses)', {
        statuses: [AdvanceRequestStatus.PENDING, AdvanceRequestStatus.APPROVED],
      });

    if (excludeRequestId) {
      queryBuilder.andWhere('request.id != :excludeRequestId', {
        excludeRequestId,
      });
    }

    const requests = await queryBuilder.getMany();

    return requests.reduce((sum, req) => {
      const amount =
        req.status === AdvanceRequestStatus.APPROVED
          ? req.approvedAmount || req.requestedAmount
          : req.requestedAmount;
      return sum + Number(amount);
    }, 0);
  }

  // Salary Adjustment Logic
  async createSalaryAdjustment(
    this: StoresService,
    createdByAccountId: string,
    data: any,
  ) {
    const profile = await this.profileRepository.findOne({
      where: { id: data.employeeProfileId },
      relations: ['contracts'],
    });

    if (!profile) {
      throw new NotFoundException('Không tìm thấy hồ sơ nhân viên');
    }
    // Changing pay is store administration: only the owner of the employee's
    // store may do it (the route addresses no store, so no guard can).
    await this.assertOwnerStoreAccess(profile.storeId, createdByAccountId);

    // Lấy hợp đồng đang hiệu lực (active)
    const activeContract = profile.contracts?.find((c) => c.isActive);
    if (!activeContract) {
      throw new BadRequestException(
        'Nhân viên hiện không có hợp đồng lao động nào đang hiệu lực',
      );
    }

    // Kiểm tra tháng hiệu lực (Không cho phép tháng quá khứ). So sánh theo
    // tháng Việt Nam: `new Date('YYYY-MM-01')` (nửa đêm UTC) không bao giờ
    // bằng mốc tháng giờ địa phương trên máy chủ +07.
    const effective = parseVnMonthInput(data.effectiveMonth);
    if (!effective) {
      throw new BadRequestException('Tháng hiệu lực không hợp lệ');
    }
    const current = vnMonthOf();
    const currentMonth = toMonthMarker(current);
    const effectiveMonth = toMonthMarker(effective);

    if (effective.key < current.key) {
      throw new BadRequestException(
        'Không thể điều chỉnh lương cho các tháng trong quá khứ',
      );
    }

    const previousSalary = Number(activeContract.salaryAmount);
    let adjustmentAmount = 0;

    // Tính toán số tiền điều chỉnh
    if (data.changeType === SalaryChangeType.PERCENTAGE) {
      adjustmentAmount = previousSalary * (Number(data.amountValue) / 100);
    } else {
      adjustmentAmount = Number(data.amountValue);
    }

    let newSalary = previousSalary;
    if (data.adjustmentType === AdjustmentType.INCREASE) {
      newSalary = previousSalary + adjustmentAmount;
    } else {
      newSalary = previousSalary - adjustmentAmount;
    }

    // Lấy lý do từ bảng reasons nếu có
    let reasonText = data.reasonText || '';
    if (data.reasonId) {
      const reason = await this.salaryAdjustmentReasonRepository.findOne({
        where: { id: data.reasonId, storeId: profile.storeId },
      });
      if (!reason) {
        throw new BadRequestException(
          'Lý do điều chỉnh không thuộc cửa hàng này',
        );
      }
      reasonText = reason.name;
    }

    // 1. Tạo bản ghi lịch sử điều chỉnh
    const adjustment = this.salaryAdjustmentRepository.create({
      ...data,
      previousSalary,
      adjustmentAmount,
      newSalary,
      createdByAccountId,
      effectiveMonth,
      reasonText,
      paymentType: activeContract.paymentType,
    });

    const savedAdjustment =
      await this.salaryAdjustmentRepository.save(adjustment);
    // Direction and month only — never the amounts or the reason.
    const savedAdjustmentId = (savedAdjustment as unknown as { id?: string })
      ?.id;
    await this.logActivity(null, {
      storeId: profile.storeId,
      actorAccountId: createdByAccountId,
      subjectEmployeeProfileId: profile.id,
      action: ACTIVITY_ACTIONS.SALARY_ADJUSTMENT_CREATED,
      resourceType: 'salary_adjustment',
      resourceId: savedAdjustmentId ?? null,
      params: {
        direction:
          data.adjustmentType === AdjustmentType.INCREASE
            ? 'increase'
            : 'decrease',
        month: effective.label,
      },
      idempotencyKey: savedAdjustmentId
        ? `${ACTIVITY_ACTIONS.SALARY_ADJUSTMENT_CREATED}:${savedAdjustmentId}`
        : null,
    });

    // 2. Nếu hiệu lực ngay tháng hiện tại -> Cập nhật Hợp đồng và Phiếu lương
    if (effective.key === current.key) {
      // Cập nhật Hợp đồng
      const updateData: any = { salaryAmount: newSalary };
      await this.contractRepository.update(activeContract.id, updateData);

      // Cập nhật Phiếu lương tháng hiện tại (nếu đã được tạo)
      const currentSalary = await this.employeeSalaryRepository.findOne({
        where: {
          employeeProfileId: profile.id,
          month: currentMonth,
        },
      });

      if (currentSalary) {
        await this.employeeSalaryRepository.update(currentSalary.id, {
          baseSalary: newSalary,
          // Note: NetSalary should be recalculated if there's a hook,
          // but usually it's calculated during final payroll processing.
        });
      }
    }

    return savedAdjustment;
  }

  /**
   * Floor of a profile's current employment stint (see
   * employment-stint.utils); null for a legacy or unknown profile, which
   * means "do not filter".
   */
  async currentStintFloorOf(
    this: StoresService,
    profileId: string,
  ): Promise<Date | null> {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      select: ['id', 'joinedAt'],
    });
    return stintFloor(profile?.joinedAt);
  }

  async getSalaryAdjustments(this: StoresService, employeeProfileId: string) {
    const floor = await this.currentStintFloorOf(employeeProfileId);
    return this.salaryAdjustmentRepository.find({
      where: {
        employeeProfileId,
        ...(floor ? { createdAt: MoreThanOrEqual(floor) } : {}),
      },
      relations: ['createdBy', 'reasonDetail'],
      order: { effectiveMonth: 'DESC', createdAt: 'DESC' },
    });
  }

  // Salary Adjustment Reasons
  async createSalaryAdjustmentReason(
    this: StoresService,
    storeId: string,
    name: string,
  ) {
    const reason = this.salaryAdjustmentReasonRepository.create({
      storeId,
      name,
      isActive: true,
    });
    return this.salaryAdjustmentReasonRepository.save(reason);
  }

  async getSalaryAdjustmentReasons(this: StoresService, storeId: string) {
    return this.salaryAdjustmentReasonRepository.find({
      where: { storeId, isActive: true },
      order: { name: 'ASC' },
    });
  }

  // Employee Payment History (Individual)
  /** Bank snapshot for a payment row, from an account of `storeId`. */
  async paymentAccountSnapshot(
    this: StoresService,
    storeId: string,
    paymentAccountId: string | undefined,
  ): Promise<string | undefined> {
    if (!paymentAccountId) return undefined;
    await this.assertRowsInStore(storeId, [
      {
        repository: this.storePaymentAccountRepository,
        id: paymentAccountId,
        label: 'Tài khoản thanh toán',
      },
    ]);
    const account = await this.storePaymentAccountRepository.findOne({
      where: { id: paymentAccountId, storeId },
    });
    return account
      ? `${account.bankName} - ****${String(account.accountNumber ?? '').slice(-4)}`
      : undefined;
  }

  // Employee Payment History (Individual)
  async createEmployeePaymentHistory(
    this: StoresService,
    dto: CreateEmployeePaymentHistoryDto,
  ) {
    // The store is the employee's; a different body storeId is refused.
    const storeId = await this.profileStoreId(dto.employeeProfileId);
    if (dto.storeId && dto.storeId !== storeId) {
      throw new BadRequestException('Nhân viên không thuộc cửa hàng này');
    }
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      select: ['id', 'name'],
    });
    const payment = this.employeePaymentHistoryRepository.create({
      ...pickDefined(dto, [
        'amount',
        'paymentMethod',
        'referenceNumber',
        'paymentAccountId',
        'notes',
      ] as const),
      employeeProfileId: dto.employeeProfileId,
      paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : undefined,
      salaryMonth: new Date(dto.salaryMonth),
      storeId,
      storeName: store?.name,
      paymentAccountInfo: await this.paymentAccountSnapshot(
        storeId,
        dto.paymentAccountId,
      ),
    } as Partial<EmployeePaymentHistory>);
    return this.employeePaymentHistoryRepository.save(payment);
  }

  async getEmployeePaymentHistories(
    this: StoresService,
    employeeProfileId: string,
  ) {
    return this.employeePaymentHistoryRepository.find({
      where: { employeeProfileId },
      order: { paymentDate: 'DESC' },
      relations: ['store'],
    });
  }

  async getEmployeeSalaryHistory(
    this: StoresService,
    profileId: string,
    page = 1,
    limit = 10,
  ) {
    const floor = await this.currentStintFloorOf(profileId);
    const [data, total] =
      await this.employeePaymentHistoryRepository.findAndCount({
        where: {
          employeeProfileId: profileId,
          ...(floor ? { createdAt: MoreThanOrEqual(floor) } : {}),
        },
        order: { paymentDate: 'DESC' },
        relations: ['store'],
        skip: (page - 1) * limit,
        take: limit,
      });
    return { data, total, page, limit };
  }

  async updateEmployeePaymentHistory(
    this: StoresService,
    id: string,
    data: UpdateEmployeePaymentHistoryDto,
  ) {
    const payment = await this.employeePaymentHistoryRepository.findOne({
      where: { id },
    });
    if (!payment)
      throw new NotFoundException('Không tìm thấy lịch sử thanh toán');

    // Whitelisted fields only; `id`, the employee and the store never move.
    const { paymentDate, salaryMonth, paymentAccountId } = data ?? {};
    for (const field of [
      'amount',
      'paymentMethod',
      'referenceNumber',
      'notes',
    ] as const) {
      if (data?.[field] !== undefined) {
        (payment as unknown as Record<string, unknown>)[field] = data[field];
      }
    }
    if (paymentDate !== undefined) payment.paymentDate = new Date(paymentDate);
    if (salaryMonth !== undefined) payment.salaryMonth = new Date(salaryMonth);
    if (paymentAccountId !== undefined) {
      payment.paymentAccountInfo = (await this.paymentAccountSnapshot(
        payment.storeId,
        paymentAccountId,
      )) as string;
      payment.paymentAccountId = paymentAccountId;
    }
    return this.employeePaymentHistoryRepository.save(payment);
  }

  async deleteEmployeePaymentHistory(this: StoresService, id: string) {
    const payment = await this.employeePaymentHistoryRepository.findOne({
      where: { id },
    });
    if (!payment)
      throw new NotFoundException('Không tìm thấy lịch sử thanh toán');

    return this.employeePaymentHistoryRepository.remove(payment);
  }

  // Store Payment Accounts
  async createStorePaymentAccount(
    this: StoresService,
    data: Partial<StorePaymentAccount>,
  ) {
    if (data.isDefault) {
      await this.storePaymentAccountRepository.update(
        { storeId: data.storeId },
        { isDefault: false },
      );
    }
    const account = this.storePaymentAccountRepository.create(data);
    return this.storePaymentAccountRepository.save(account);
  }

  async getStorePaymentAccounts(this: StoresService, storeId: string) {
    const accounts = await this.storePaymentAccountRepository.find({
      where: { storeId, isActive: true },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });

    return accounts.map((acc) => ({
      id: acc.id,
      bankName: acc.bankName,
      accountHolderName: acc.accountHolderName,
      accountNumberMasked:
        acc.accountNumber.length > 4
          ? `****${acc.accountNumber.slice(-4)}`
          : acc.accountNumber,
      isDefault: acc.isDefault,
    }));
  }

  async updateStorePaymentAccount(
    this: StoresService,
    id: string,
    data: Partial<StorePaymentAccount>,
  ) {
    const account = await this.storePaymentAccountRepository.findOne({
      where: { id },
    });
    if (!account)
      throw new NotFoundException('Không tìm thấy tài khoản thanh toán');

    if (data.isDefault) {
      await this.storePaymentAccountRepository.update(
        { storeId: account.storeId },
        { isDefault: false },
      );
    }

    Object.assign(account, data);
    return this.storePaymentAccountRepository.save(account);
  }

  async deleteStorePaymentAccount(this: StoresService, id: string) {
    const account = await this.storePaymentAccountRepository.findOne({
      where: { id },
    });
    if (!account)
      throw new NotFoundException('Không tìm thấy tài khoản thanh toán');

    return this.storePaymentAccountRepository.remove(account);
  }

  async payEmployeeSalary(
    this: StoresService,
    salaryId: string,
    data: {
      paymentAccountId: string;
      paymentMethod?: string;
      referenceNumber?: string;
      notes?: string;
    },
    actorAccountId?: string,
  ) {
    const salary = await this.employeeSalaryRepository.findOne({
      where: { id: salaryId },
      relations: ['employeeProfile', 'monthlyPayroll'],
    });

    if (!salary) {
      throw new NotFoundException('Không tìm thấy phiếu lương');
    }

    if (salary.paymentStatus === PaymentStatus.PAID) {
      throw new BadRequestException(
        'Phiếu lương này đã được thanh toán trước đó',
      );
    }

    // 1. Lấy thông tin tài khoản ngân hàng của Store
    const account = await this.storePaymentAccountRepository.findOne({
      where: { id: data.paymentAccountId },
    });

    if (!account) {
      throw new NotFoundException(
        'Không tìm thấy tài khoản thanh toán của cửa hàng',
      );
    }

    const store = await this.storeRepository.findOne({
      where: { id: salary.monthlyPayroll.storeId },
    });
    if (!store) {
      throw new NotFoundException('Không tìm thấy cửa hàng');
    }

    // 2. Cập nhật trạng thái phiếu lương
    salary.paymentStatus = PaymentStatus.PAID;
    salary.paidAt = new Date();
    salary.notes = data.notes || salary.notes;
    await this.employeeSalaryRepository.save(salary);

    // 3. Tạo bản ghi lịch sử thanh toán cho nhân viên
    const paymentHistory = this.employeePaymentHistoryRepository.create({
      employeeProfileId: salary.employeeProfileId,
      storeId: store.id,
      storeName: store.name,
      amount: salary.netSalary,
      salaryMonth: salary.month,
      paymentDate: new Date(),
      paymentMethod: data.paymentMethod || 'Chuyển khoản',
      referenceNumber: data.referenceNumber,
      paymentAccountId: account.id,
      paymentAccountInfo: `${account.bankName} - ****${account.accountNumber.slice(-4)}`,
      notes: data.notes,
    });

    await this.employeePaymentHistoryRepository.save(paymentHistory);

    await this.logActivity(null, {
      storeId: store.id,
      actorAccountId: actorAccountId ?? null,
      subjectEmployeeProfileId: salary.employeeProfileId,
      action: ACTIVITY_ACTIONS.PAYSLIP_PAID,
      resourceType: 'payslip',
      resourceId: salary.id,
      params: { month: this.activityMonth(salary.month) },
      idempotencyKey: `${ACTIVITY_ACTIONS.PAYSLIP_PAID}:${salary.id}`,
    });

    return {
      message: 'Thanh toán lương thành công',
      paymentHistory,
    };
  }

  async getEmployeeSalaryDetailByMonth(
    this: StoresService,
    employeeProfileId: string,
    monthStr: string,
  ) {
    const parsedMonth = parseVnMonthInput(monthStr);
    if (!parsedMonth) throw new BadRequestException('Tháng không hợp lệ');
    const monthStart = toMonthMarker(parsedMonth);

    const profile = await this.profileRepository.findOne({
      where: { id: employeeProfileId },
      relations: [
        'account',
        'storeRole',
        'employeeType',
        'contracts',
        'workShift',
      ],
    });

    if (!profile) {
      throw new NotFoundException('Không tìm thấy hồ sơ nhân viên');
    }

    // 1. Lấy phiếu lương của tháng yêu cầu
    const salaryRecord = await this.employeeSalaryRepository.findOne({
      where: { employeeProfileId, month: monthStart },
      relations: ['monthlyPayroll'],
    });

    if (!salaryRecord) {
      throw new NotFoundException(
        `Không tìm thấy phiếu lương cho tháng ${monthStart.getMonth() + 1}/${monthStart.getFullYear()}`,
      );
    }

    // 2. Lấy hợp đồng đang hiệu lực (chỉ trong đợt làm việc hiện tại)
    const floor = stintFloor(profile.joinedAt);
    const activeContract = currentStintContracts(profile.contracts, floor).find(
      (c) => c.isActive,
    );

    // Tính số ngày còn lại của hợp đồng
    let daysRemaining: number | null = null;
    const now = new Date();
    if (activeContract?.endDate) {
      const end = new Date(activeContract.endDate);
      const diffTime = end.getTime() - now.getTime();
      daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    // 3. Lấy lịch sử thanh toán (Mới tạo ở bước trước)
    const paymentHistory = await this.employeePaymentHistoryRepository.find({
      where: {
        employeeProfileId,
        ...(floor ? { createdAt: MoreThanOrEqual(floor) } : {}),
      },
      order: { paymentDate: 'DESC' },
    });

    // Format trạng thái
    const monthLabel = monthStart.getMonth() + 1;
    let payrollStatusText = `${salaryRecord.paymentStatus} tháng ${monthLabel}`;
    if (salaryRecord.paymentStatus === PaymentStatus.PENDING) {
      payrollStatusText = `Chưa chi trả lương tháng ${monthLabel}`;
    }

    return {
      employeeInfo: {
        fullName: profile.account?.fullName,
        avatar: profile.account?.avatar,
        employeeCode: profile.id.split('-')[0], // Lấy chuỗi đầu tiên của UUID
      },
      jobDetails: {
        roleStore: profile.storeRole?.name,
        typeStore: profile.employeeType?.name,
        shiftName: profile.workShift?.shiftName, // <--- Thêm Tên ca
        joinedAt: profile.joinedAt,
      },
      payrollStatus: payrollStatusText,
      daysRemaining: daysRemaining,
      currentSalary: {
        value: activeContract?.salaryAmount || 0,
        method: activeContract?.paymentType,
      },
      // Đổ toàn bộ dữ liệu từ EmployeeSalary
      ...salaryRecord,
      // A row the store's template removed is not paid / taken: its stored
      // figures (the contract's allowances, the owner's other deductions)
      // are not listed as if they were.
      ...this.removedPayslipFigures(salaryRecord),
      // Lịch sử thanh toán
      paymentHistory: paymentHistory,
    };
  }

  async getEmployeeSalaryOverview(
    this: StoresService,
    employeeProfileId: string,
  ) {
    const profile = await this.profileRepository.findOne({
      where: { id: employeeProfileId },
      relations: ['account', 'storeRole', 'employeeType', 'contracts'],
    });

    if (!profile) {
      throw new NotFoundException('Không tìm thấy hồ sơ nhân viên');
    }

    // Xác định ngày bắt đầu của tháng hiện tại (tháng Việt Nam)
    const now = new Date();
    const currentMonthStart = toMonthMarker(vnMonthOf(now));

    // 1. Tìm hợp đồng đang hiệu lực (chỉ trong đợt làm việc hiện tại)
    const floor = stintFloor(profile.joinedAt);
    const activeContract = currentStintContracts(profile.contracts, floor).find(
      (c) => c.isActive,
    );

    // 2. Lấy trạng thái trả lương tháng hiện tại
    const currentSalary = await this.employeeSalaryRepository.findOne({
      where: {
        employeeProfileId: profile.id,
        month: currentMonthStart,
      },
    });

    // 3. Lấy lịch sử điều chỉnh lương (đợt làm việc hiện tại)
    const adjustmentHistory = await this.salaryAdjustmentRepository.find({
      where: {
        employeeProfileId: profile.id,
        ...(floor ? { createdAt: MoreThanOrEqual(floor) } : {}),
      },
      relations: ['createdBy'],
      order: { effectiveMonth: 'DESC', createdAt: 'DESC' },
    });

    // Tính số ngày còn lại của hợp đồng
    let daysRemaining: number | null = null;
    if (activeContract?.endDate) {
      const end = new Date(activeContract.endDate);
      const diffTime = end.getTime() - now.getTime();
      daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    // Format trạng thái trả lương
    let payrollStatusText = 'Chưa tạo phiếu lương';
    if (currentSalary) {
      const monthLabel = currentMonthStart.getMonth() + 1;
      payrollStatusText = `${currentSalary.paymentStatus} tháng ${monthLabel}`;
      if (currentSalary.paymentStatus === PaymentStatus.PENDING) {
        payrollStatusText = `Chưa chi trả lương tháng ${monthLabel}`;
      }
    }

    return {
      id: profile.id,
      employeeInfo: {
        fullName: profile.account?.fullName,
        avatar: profile.account?.avatar,
        employeeCode: profile.id.split('-')[0],
      },
      jobDetails: {
        roleStore: profile.storeRole?.name,
        typeStore: profile.employeeType?.name,
        joinedAt: profile.joinedAt,
      },
      contractDetails: {
        id: activeContract?.id,
        expiryDate: activeContract?.endDate,
        daysRemaining: daysRemaining,
        currentSalary: {
          value: activeContract?.salaryAmount || 0,
          method: activeContract?.paymentType,
        },
        allowances: activeContract?.allowances || {},
      },
      payrollStatus: payrollStatusText,
      salaryAdjustments: {
        latest: adjustmentHistory[0] || null,
        history: adjustmentHistory,
      },
    };
  }

  async updateEmployeeSalaryStructure(
    this: StoresService,
    employeeProfileId: string,
    data: { salaryAmount?: number; allowances?: Record<string, number> },
  ) {
    const profile = await this.profileRepository.findOne({
      where: { id: employeeProfileId },
      relations: ['contracts'],
    });

    if (!profile) {
      throw new NotFoundException('Không tìm thấy hồ sơ nhân viên');
    }

    const activeContract = profile.contracts?.find((c) => c.isActive);
    if (!activeContract) {
      throw new BadRequestException(
        'Nhân viên không có hợp đồng lao động đang hoạt động',
      );
    }

    const updateData: any = {};
    if (data.salaryAmount !== undefined) {
      updateData.salaryAmount = data.salaryAmount;
    }
    if (data.allowances !== undefined) {
      updateData.allowances = data.allowances;
    }

    await this.contractRepository.update(activeContract.id, updateData);

    // Nếu cập nhật trong tháng này, cần kiểm tra và cập nhật phiếu lương tháng này nếu đã tạo
    const currentMonth = toMonthMarker(vnMonthOf());

    const currentSalary = await this.employeeSalaryRepository.findOne({
      where: { employeeProfileId, month: currentMonth },
    });

    if (currentSalary) {
      const salaryUpdate: any = {};
      if (data.salaryAmount !== undefined)
        salaryUpdate.baseSalary = data.salaryAmount;
      if (data.allowances !== undefined)
        salaryUpdate.allowances = data.allowances;

      await this.employeeSalaryRepository.update(
        currentSalary.id,
        salaryUpdate,
      );
    }

    return { message: 'Cập nhật bảng lương thành công' };
  }

  async getEmployeesSalaryOverview(this: StoresService, storeId: string) {
    const profiles = await this.profileRepository.find({
      where: { storeId },
      relations: ['account', 'storeRole', 'employeeType', 'contracts'],
      order: { joinedAt: 'DESC' },
    });

    // Xác định ngày bắt đầu của tháng hiện tại (tháng Việt Nam)
    const currentMonthStart = toMonthMarker(vnMonthOf());

    return Promise.all(
      profiles.map(async (profile) => {
        // 1. Tìm hợp đồng đang hiệu lực (chỉ trong đợt làm việc hiện tại)
        const floor = stintFloor(profile.joinedAt);
        const activeContract = currentStintContracts(
          profile.contracts,
          floor,
        ).find((c) => c.isActive);

        // 2. Lấy trạng thái trả lương tháng hiện tại
        const currentSalary = await this.employeeSalaryRepository.findOne({
          where: {
            employeeProfileId: profile.id,
            month: currentMonthStart,
          },
        });

        // 3. Lấy lịch sử điều chỉnh lương (đợt làm việc hiện tại)
        const adjustmentHistory = await this.salaryAdjustmentRepository.find({
          where: {
            employeeProfileId: profile.id,
            ...(floor ? { createdAt: MoreThanOrEqual(floor) } : {}),
          },
          relations: ['createdBy'],
          order: { effectiveMonth: 'DESC', createdAt: 'DESC' },
        });

        return {
          id: profile.id,
          employeeInfo: {
            fullName: profile.account?.fullName,
            avatar: profile.account?.avatar,
            employeeCode: profile.id.split('-')[0],
          },
          jobDetails: {
            roleStore: profile.storeRole?.name,
            typeStore: profile.employeeType?.name,
            joinedAt: profile.joinedAt,
          },
          contractDetails: {
            expiryDate: activeContract?.endDate,
            currentSalary: {
              value: activeContract?.salaryAmount || 0,
              method: activeContract?.paymentType,
            },
          },
          payrollStatus: currentSalary?.paymentStatus || 'Chưa tạo phiếu',
          salaryAdjustments: {
            latest: adjustmentHistory[0] || null,
            history: adjustmentHistory,
          },
        };
      }),
    );
  }

  /**
   * Recomputes one employee's payslip for the Vietnam month of `workDate`
   * after an attendance change without a check-out (a shift marked ABSENT at
   * its end). Same lock, composer and single writer as recalculation and
   * check-out: never deletes a payslip, APPROVED/PAID payslips stay as they
   * are, advances are re-derived under the row lock. Idempotent.
   */
  async recomputeEmployeePayslipForWorkDate(
    this: StoresService,
    input: {
      employeeProfileId: string;
      storeId: string;
      workDate: string;
    },
  ): Promise<'protected' | 'updated' | 'inserted' | 'skipped'> {
    const month = vnMonthOfDateString(input.workDate);
    if (!month) return 'skipped';
    const employee = await this.profileRepository.findOne({
      where: { id: input.employeeProfileId, storeId: input.storeId },
      relations: ['contracts'],
    });
    // Same population as a store recalculation: rostered staff only.
    if (
      !employee ||
      !isShiftEligibleEmploymentStatus(employee.employmentStatus)
    ) {
      return 'skipped';
    }
    let changes: PayrollAdjustmentChange[] = [];
    const outcome = await this.dataSource.transaction(async (manager) => {
      const payroll = await this.findOrCreateMonthlyPayroll(
        input.storeId,
        month,
        manager,
      );
      const existing = await this.lockEmployeePayslip(
        manager,
        employee.id,
        month,
      );
      const contract = employee.contracts?.find((c) => c.isActive) ?? null;
      let payslip: PayslipComputation | null = null;
      let lines: PayslipAdjustmentLine[] = [];
      if (contract && !(existing && this.isProtectedPayslip(existing))) {
        const { rate } = await this.resolveRateForMonth(
          employee.id,
          contract,
          month,
          manager,
        );
        const rules = await manager
          .getRepository(StorePayrollRule)
          .find({ where: { storeId: input.storeId, isActive: true } });
        const standardWorkingDays = await this.getStandardWorkingDays(
          input.storeId,
          month,
          manager,
        );
        let composedRules: StorePayrollRule[] = [];
        let composedFacts: MonthlyAttendanceFacts | null = null;
        ({ payslip, rules: composedRules, facts: composedFacts } = await this.computeEmployeePayslip({
          manager,
          employeeProfileId: employee.id,
          storeId: input.storeId,
          month,
          contract,
          rate,
          rules,
          standardWorkingDays,
          existingSalaryId: existing?.id ?? null,
          otherDeductions: existing?.otherDeductions,
          now: new Date(),
          stint: employee,
        }));
        lines = effectiveAdjustmentLines(
          computeRuleAdjustmentBreakdown(composedRules, composedFacts, payslip.earnedBaseSalary),
          payslip,
        );
      }
      const outcome = await this.upsertEmployeePayslip(manager, {
        employeeProfileId: employee.id,
        month,
        monthlyPayrollId: payroll.id,
        payslip,
        allowances: contract?.allowances ?? null,
        existing,
      });
      await this.refreshMonthlyPayrollTotals(manager, payroll.id);
      // Khoản thưởng / vi phạm vừa đổi (nghỉ không phép vừa đánh dấu, đi muộn
      // lúc chấm công vào, chủ vừa ghi nhận…): báo ngay sau khi commit.
      changes = payslip
        ? await this.recordAdjustmentSnapshot(manager, employee.id, month, lines)
        : [];
      return outcome;
    });
    await this.notifyAdjustmentChanges({
      employeeProfileId: employee.id,
      storeId: input.storeId,
      month,
      workDate: input.workDate,
      changes,
    });
    // Ca vừa bị đánh dấu nghỉ không phép: bảng tổng hợp của màn nhân viên
    // cũng phải đổi ngay (không đợi lần chấm công ra kế tiếp).
    await this.refreshEmployeeMonthlySummary(employee.id, month).catch((error) =>
      this.logger.error(
        `[MonthlySummary] refresh after recompute failed for ${employee.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    );
    return outcome;
  }

  /**
   * Chấm công vào: tính lại phiếu lương tháng của ca ngay (đi muộn bị trừ và
   * báo ngay, không đợi chấm công ra).
   */
  async recomputePayslipOfAssignment(
    this: StoresService,
    assignmentId: string,
  ): Promise<void> {
    const assignment = await this.shiftAssignmentRepository.findOne({
      where: { id: assignmentId },
      relations: ['shiftSlot', 'shiftSlot.cycle'],
    });
    const storeId = assignment?.shiftSlot?.cycle?.storeId;
    const workDate =
      typeof assignment?.shiftSlot?.workDate === 'string'
        ? assignment.shiftSlot.workDate.slice(0, 10)
        : null;
    if (!assignment?.employeeId || !storeId || !workDate) {
      await this.refreshMonthlySummaryOfAssignment(assignmentId);
      return;
    }
    const outcome = await this.recomputeEmployeePayslipForWorkDate({
      employeeProfileId: assignment.employeeId,
      storeId,
      workDate,
    });
    // Không tính phiếu (vd. hồ sơ không còn trong danh sách xếp ca): bảng tổng
    // hợp của màn nhân viên vẫn phải đổi như trước khi có bước này.
    if (outcome === 'skipped') await this.refreshMonthlySummaryOfAssignment(assignmentId);
  }

  /** Bảng tổng hợp tháng của người làm lượt ca này (tháng của ngày làm). */
  async refreshMonthlySummaryOfAssignment(
    this: StoresService,
    assignmentId: string,
  ): Promise<void> {
    const assignment = await this.shiftAssignmentRepository.findOne({
      where: { id: assignmentId },
      relations: ['shiftSlot'],
    });
    if (!assignment?.employeeId) return;
    const workDate =
      typeof assignment.shiftSlot?.workDate === 'string'
        ? assignment.shiftSlot.workDate.slice(0, 10)
        : null;
    await this.refreshEmployeeMonthlySummary(
      assignment.employeeId,
      vnMonthOfDateString(workDate) ?? vnMonthOf(new Date()),
    );
  }

  /**
   * Prices a completed shift's work date and the employee's month payslip,
   * then refreshes the employee's monthly summary.
   *
   * With `options.manager` it only prices, inside the caller's transaction
   * (which must already hold the month lock), so a worked-time recompute
   * updates minutes, per-shift pay and payslip atomically. It then touches no
   * other connection: the caller refreshes the summary after commit with a
   * plain call.
   */
  async processCheckoutPayroll(
    this: StoresService,
    assignmentId: string,
    options: { manager?: EntityManager } = {},
  ): Promise<void> {
    const outer = options.manager;
    const assignment = await (
      outer
        ? outer.getRepository(ShiftAssignment)
        : this.shiftAssignmentRepository
    ).findOne({
      where: { id: assignmentId },
      relations: [
        'shiftSlot',
        'shiftSlot.cycle',
        'employee',
        'employee.contracts',
      ],
    });

    if (
      !assignment ||
      assignment.status !== ShiftAssignmentStatus.COMPLETED ||
      !assignment.checkOutTime
    ) {
      this.logger.warn(
        `[CheckoutPayroll] Skipping incomplete assignment ${assignmentId}`,
      );
      return;
    }

    const storeId = assignment.shiftSlot?.cycle?.storeId;
    if (!storeId) {
      this.logger.warn(
        `[CheckoutPayroll] Assignment ${assignmentId} has no store`,
      );
      return;
    }

    const checkoutTime = new Date(assignment.checkOutTime);
    const workDate =
      typeof assignment.shiftSlot?.workDate === 'string'
        ? assignment.shiftSlot.workDate.slice(0, 10)
        : null;
    // The payslip month is the Vietnam month of the shift's work date, the
    // same window the attendance query uses. An overnight shift on the 31st
    // that checks out on the 1st belongs to the month it started in.
    const month = vnMonthOfDateString(workDate) ?? vnMonthOf(checkoutTime);
    const activeContract =
      assignment.employee?.contracts?.find((contract) => contract.isActive) ??
      null;

    // The payslip and its inputs (rate, rules, working days, attendance) are
    // read by `composeCheckoutPayslip`. With a contract that runs inside the
    // payslip transaction, after the per-(store, month) advisory lock taken by
    // findOrCreateMonthlyPayroll, so a stale checkout job cannot overwrite a
    // payslip written by a newer one or by a recalculation.
    const composeCheckoutPayslip = async (manager?: EntityManager) => {
      const standardWorkingDays = await this.getStandardWorkingDays(
        storeId,
        month,
        manager,
      );
      const rate = activeContract
        ? (
            await this.resolveRateForMonth(
              assignment.employeeId,
              activeContract,
              month,
              manager,
            )
          ).rate
        : 0;
      const payrollRules = activeContract
        ? await (
            manager
              ? manager.getRepository(StorePayrollRule)
              : this.payrollRuleRepository
          ).find({
            where: { storeId, isActive: true },
          })
        : [];
      // Read-only: facts and the month's payslip from the shared composer.
      const composed = await this.computeEmployeePayslip({
        manager,
        employeeProfileId: assignment.employeeId,
        storeId,
        month,
        contract: activeContract,
        rate,
        rules: payrollRules,
        standardWorkingDays,
        now: new Date(),
        stint: assignment.employee ?? undefined,
      });
      return { ...composed, rate, standardWorkingDays };
    };

    let facts: MonthlyAttendanceFacts;
    let payslip: PayslipComputation;
    let monthAssignments: PayrollAssignmentFact[];
    let currentStintEarned: number | null | undefined;
    let checkoutChanges: PayrollAdjustmentChange[] = [];
    // Nothing to price without a contract; the summary is the caller's.
    if (outer && !activeContract) return;
    if (!activeContract) {
      ({
        facts,
        payslip,
        assignments: monthAssignments,
        currentStintEarned,
      } = await composeCheckoutPayslip());
    } else {
      // Same writer and lock as generation/recalculation, so a checkout job
      // and a recalculation for the same store and month serialize.
      ({
        facts,
        payslip,
        assignments: monthAssignments,
        currentStintEarned,
      } = await (async () => {
        const priceInTransaction = async (manager: EntityManager) => {
          const payroll = await this.findOrCreateMonthlyPayroll(
            storeId,
            month,
            manager,
          );
          const composed = await composeCheckoutPayslip(manager);
          const { assignments, rate, standardWorkingDays } = composed;

          // Per-shift display figures for every completed shift on this work
          // date. A monthly salary is paid per distinct day, so only the day's
          // owner shift carries the day rate. Recomputing the whole day makes
          // the result independent of the order checkout jobs run in, and
          // idempotent.
          const owners = pickDayOwnerAssignmentIds(assignments);
          const loadedIds = new Set(assignments.map((a) => a.id));
          const targets: PayrollAssignmentFact[] = assignments.filter(
            (a) =>
              a.status === ShiftAssignmentStatus.COMPLETED &&
              workDate !== null &&
              a.workDate === workDate,
          );
          // A shift of a previous stint (before a same-month rehire) keeps the
          // figure priced with its own contract; the new contract never
          // reprices it (see computeStintSplitEarnedBase).
          const stintStart = stintStartVnDate(assignment.employee?.joinedAt);
          if (stintStart && workDate !== null && workDate < stintStart) {
            targets.length = 0;
          } else if (!loadedIds.has(assignment.id)) {
            targets.push({
              id: assignment.id,
              workDate: workDate ?? '',
              status: assignment.status,
              workedMinutes: assignment.workedMinutes,
              shiftEarnings: assignment.shiftEarnings,
            });
          }

          for (const target of targets) {
            // Shared with the shift-estimate path. A null result means no rule
            // covers this payment type; the stored figure is then left
            // untouched.
            const shiftEarnings = calculateShiftEarnings({
              paymentType: activeContract.paymentType,
              baseSalary: rate,
              hours: Number(target.workedMinutes || 0) / 60,
              referenceDate: workDate
                ? vnMiddayInstant(workDate)
                : checkoutTime,
              workingDaysInMonth: standardWorkingDays,
              countsAsWorkedDay:
                owners.has(target.id) || !loadedIds.has(target.id),
            });
            const previous =
              target.shiftEarnings == null
                ? null
                : Number(target.shiftEarnings);
            if (shiftEarnings != null && previous !== shiftEarnings) {
              await manager.getRepository(ShiftAssignment).update(target.id, {
                shiftEarnings,
              });
            }
          }

          await this.upsertEmployeePayslip(manager, {
            employeeProfileId: assignment.employeeId,
            month,
            monthlyPayrollId: payroll.id,
            payslip: composed.payslip,
            allowances: activeContract.allowances ?? null,
          });
          await this.refreshMonthlyPayrollTotals(manager, payroll.id);
          // Trong transaction của người gọi (outer) thì không ghi ảnh chụp: thông
          // báo chỉ gửi được sau commit, lần tính kế tiếp sẽ báo phần chênh.
          if (!outer) {
            checkoutChanges = await this.recordAdjustmentSnapshot(
              manager,
              assignment.employeeId,
              month,
              effectiveAdjustmentLines(
                computeRuleAdjustmentBreakdown(
                  composed.rules,
                  composed.facts,
                  composed.payslip.earnedBaseSalary,
                ),
                composed.payslip,
              ),
            );
          }
          return composed;
        };
        return outer
          ? priceInTransaction(outer)
          : this.dataSource.transaction(priceInTransaction);
      })());
    }
    if (outer) return;

    // Tăng ca / ca đêm / về sớm / quên chấm công… của ca vừa kết thúc.
    await this.notifyAdjustmentChanges({
      employeeProfileId: assignment.employeeId,
      storeId,
      month,
      workDate,
      changes: checkoutChanges,
    });

    await this.writeEmployeeMonthlySummary({
      employeeProfileId: assignment.employeeId,
      joinedAt: assignment.employee?.joinedAt ?? null,
      month,
      facts,
      monthAssignments,
      earnedBaseSalary: payslip.earnedBaseSalary,
      currentStintEarned,
      activeContract,
    });
  }

  /**
   * Bảng tổng hợp tháng của danh sách nhân viên (ca / đi trễ / về sớm / nghỉ
   * không phép / lương tạm tính) tính lại từ chấm công hiện tại, không đụng
   * phiếu lương. Trước đây chỉ job sau chấm công RA ghi bảng này, nên ngay
   * sau chấm công VÀO hay khi ca bị đánh dấu nghỉ không phép, màn nhân viên
   * của chủ vẫn hiện số cũ.
   */
  async refreshEmployeeMonthlySummary(
    this: StoresService,
    employeeProfileId: string,
    month?: VnMonth | null,
  ): Promise<void> {
    const employee = await this.profileRepository.findOne({
      where: { id: employeeProfileId },
      relations: ['contracts'],
    });
    if (!employee?.storeId) return;
    const targetMonth = month ?? vnMonthOf(new Date());
    const activeContract =
      employee.contracts?.find((contract) => contract.isActive) ?? null;
    const standardWorkingDays = await this.getStandardWorkingDays(
      employee.storeId,
      targetMonth,
    );
    const rate = activeContract
      ? (await this.resolveRateForMonth(employee.id, activeContract, targetMonth))
          .rate
      : 0;
    const rules = activeContract
      ? await this.payrollRuleRepository.find({
          where: { storeId: employee.storeId, isActive: true },
        })
      : [];
    const composed = await this.computeEmployeePayslip({
      employeeProfileId: employee.id,
      storeId: employee.storeId,
      month: targetMonth,
      contract: activeContract,
      rate,
      rules,
      standardWorkingDays,
      now: new Date(),
      stint: employee,
    });
    await this.writeEmployeeMonthlySummary({
      employeeProfileId: employee.id,
      joinedAt: employee.joinedAt ?? null,
      month: targetMonth,
      facts: composed.facts,
      monthAssignments: composed.assignments,
      earnedBaseSalary: composed.payslip.earnedBaseSalary,
      currentStintEarned: composed.currentStintEarned,
      activeContract,
    });
  }

  private async writeEmployeeMonthlySummary(
    this: StoresService,
    p: {
      employeeProfileId: string;
      joinedAt: Date | null;
      month: VnMonth;
      facts: MonthlyAttendanceFacts;
      monthAssignments: PayrollAssignmentFact[];
      earnedBaseSalary: number;
      currentStintEarned: number | null | undefined;
      activeContract: EmployeeContract | null;
    },
  ): Promise<void> {
    const { facts, monthAssignments, month, activeContract } = p;

    // The payslip above keeps every assignment of the month, so a same-month
    // rehire is paid for both stints, each at its own contract's pricing. The display summary below covers only
    // the current stint (from the VN date of `joinedAt`). Known edge: a shift
    // worked earlier on the rehire day itself is counted in the new stint.
    const since = stintStartVnDate(p.joinedAt);
    const stintFacts = since
      ? summarizeMonthlyAttendance(
          monthAssignments.filter(
            (a) => String(a.workDate).slice(0, 10) >= since,
          ),
          vnDateString(),
        )
      : facts;

    const cumulativeQuery = this.shiftAssignmentRepository
      .createQueryBuilder('assignment')
      .select('COUNT(assignment.id)', 'completedShifts')
      .addSelect('COALESCE(SUM(assignment.workedMinutes), 0)', 'workedMinutes')
      .where('assignment.employeeId = :employeeId', {
        employeeId: p.employeeProfileId,
      })
      .andWhere('assignment.status = :status', {
        status: ShiftAssignmentStatus.COMPLETED,
      });
    if (since) {
      cumulativeQuery.innerJoin(
        'assignment.shiftSlot',
        'slot',
        'slot.workDate >= :since',
        { since },
      );
    }
    const cumulative = await cumulativeQuery.getRawOne<{
      completedShifts: string;
      workedMinutes: string;
    }>();

    const onTimeArrivalsCount = Math.max(
      0,
      stintFacts.completedShifts - stintFacts.lateCount,
    );
    const performanceScore = stintFacts.completedShifts
      ? Math.round((onTimeArrivalsCount / stintFacts.completedShifts) * 100)
      : 0;
    await this.monthlySummaryRepository.upsert(
      {
        employeeProfileId: p.employeeProfileId,
        month: toMonthMarker(month),
        totalShifts: stintFacts.totalAssignedShifts,
        completedShifts: stintFacts.completedShifts,
        monthlyWorkHours: stintFacts.workingHours,
        lateArrivalsCount: stintFacts.lateCount,
        onTimeArrivalsCount,
        earlyDeparturesCount: stintFacts.earlyCount,
        unauthorizedLeavesCount: stintFacts.absentCount,
        // After a same-month rehire the payslip pays both stints, but the
        // employee list shows what the current stint earned.
        estimatedSalary: p.currentStintEarned ?? p.earnedBaseSalary,
        baseSalary: Number(activeContract?.salaryAmount) || 0,
        performanceScore,
        totalCompletedShifts: Number(cumulative?.completedShifts || 0),
        totalWorkHours: Number(cumulative?.workedMinutes || 0) / 60,
      },
      ['employeeProfileId', 'month'],
    );
  }

  /**
   * `employeeProfileId`, when given, limits the history to that employee —
   * used for non-owner callers, who may only see their own rows.
   */
  async getBonusHistory(
    this: StoresService,
    storeId: string,
    month?: string,
    employeeProfileId?: string,
  ) {
    const query = this.salaryAdjustmentRepository
      .createQueryBuilder('sa')
      .innerJoinAndSelect('sa.employeeProfile', 'ep')
      .leftJoinAndSelect('ep.account', 'acc')
      .leftJoinAndSelect('ep.storeRole', 'role')
      .leftJoinAndSelect('ep.employeeType', 'etype')
      .where('ep.storeId = :storeId', { storeId })
      .andWhere('sa.adjustmentType = :type', { type: AdjustmentType.INCREASE })
      .orderBy('sa.createdAt', 'DESC');

    if (employeeProfileId) {
      query.andWhere('ep.id = :employeeProfileId', { employeeProfileId });
    }

    if (month) {
      query.andWhere("TO_CHAR(sa.effective_month, 'MM/YYYY') = :month", {
        month,
      });
    }

    const adjustments = await query.take(50).getMany();

    // Group by date
    const grouped: Record<string, any[]> = {};
    for (const adj of adjustments) {
      const dateKey = new Date(adj.createdAt).toLocaleDateString('vi-VN');
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push({
        id: adj.id,
        employeeName: (adj.employeeProfile as any)?.account?.name || '',
        position: (adj.employeeProfile as any)?.storeRole?.name || '',
        employmentType: (adj.employeeProfile as any)?.employeeType?.name || '',
        performance: adj.reasonText || '',
        bonusAmount: `+${formatVnMoney(Number(adj.adjustmentAmount), 'vnđ')}`,
      });
    }

    return Object.entries(grouped).map(([date, records]) => ({
      date,
      records,
    }));
  }

  /**
   * `employeeProfileId`, when given, limits the history to that employee —
   * used for non-owner callers, who may only see their own rows.
   */
  async getPenaltyHistory(
    this: StoresService,
    storeId: string,
    month?: string,
    employeeProfileId?: string,
  ) {
    const query = this.salaryAdjustmentRepository
      .createQueryBuilder('sa')
      .innerJoinAndSelect('sa.employeeProfile', 'ep')
      .leftJoinAndSelect('ep.account', 'acc2')
      .leftJoinAndSelect('ep.storeRole', 'role2')
      .leftJoinAndSelect('ep.employeeType', 'etype2')
      .where('ep.storeId = :storeId', { storeId })
      .andWhere('sa.adjustmentType = :type', { type: AdjustmentType.DECREASE })
      .orderBy('sa.createdAt', 'DESC');

    if (employeeProfileId) {
      query.andWhere('ep.id = :employeeProfileId', { employeeProfileId });
    }

    if (month) {
      query.andWhere("TO_CHAR(sa.effective_month, 'MM/YYYY') = :month", {
        month,
      });
    }

    const adjustments = await query.take(50).getMany();

    // Group by date
    const grouped: Record<string, any[]> = {};
    for (const adj of adjustments) {
      const dateKey = new Date(adj.createdAt).toLocaleDateString('vi-VN');
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push({
        id: adj.id,
        employeeName: (adj.employeeProfile as any)?.account?.name || '',
        position: (adj.employeeProfile as any)?.storeRole?.name || '',
        employmentType: (adj.employeeProfile as any)?.employeeType?.name || '',
        reason: adj.reasonText || '',
        penaltyAmount: `-${formatVnMoney(Number(adj.adjustmentAmount), 'vnđ')}`,
      });
    }

    return Object.entries(grouped).map(([date, records]) => ({
      date,
      records,
    }));
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SALARY INQUIRIES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Nhân viên gửi câu hỏi về lương tới quản lý.
   * Tái dụng bảng Feedback để lưu trữ, type = 'SALARY_INQUIRY'.
   */
  async createSalaryInquiry(
    this: StoresService,
    profileId: string,
    question: string,
    month?: string,
    actorAccountId?: string,
  ) {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      relations: ['account'],
    });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');

    const feedbackData = this.feedbackRepository.create({
      employeeProfileId: profileId,
      storeId: profile.storeId,
      accountId: profile.accountId,
      content: month ? `[Tháng ${month}] ${question}` : question,
      categories: ['SALARY_INQUIRY'],
      status: FeedbackStatus.PENDING,
    });
    const saved = await this.feedbackRepository.save(feedbackData);
    if (profile.storeId) {
      void this.notifyOwnerOfRequest({
        storeId: profile.storeId,
        employeeProfileId: profileId,
        kind: 'SALARY_INQUIRY',
        requestId: saved.id,
        question: saved.content,
        actorAccountId: actorAccountId ?? null,
      });
    }

    return {
      id: saved.id,
      message:
        'Câu hỏi của bạn đã được gửi thành công. Quản lý sẽ phản hồi trong thời gian sớm nhất.',
      status: 'PENDING',
      createdAt: saved.createdAt,
    };
  }

  /**
   * Lấy danh sách câu hỏi lương của nhân viên.
   */
  async getSalaryInquiries(this: StoresService, profileId: string) {
    const feedbacks = await this.feedbackRepository.find({
      where: { employeeProfileId: profileId },
      order: { createdAt: 'DESC' },
    });
    // Filter to just salary inquiries
    const inquiries = feedbacks.filter((f) =>
      f.categories?.includes('SALARY_INQUIRY'),
    );
    return inquiries.map((f) => ({
      id: f.id,
      question: f.content,
      status: f.status,
      reply: f.adminNote || null,
      createdAt: f.createdAt,
    }));
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SALARY SLIP DATA
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Lấy dữ liệu phiếu lương cho nhân viên theo tháng.
   * Format tháng: "MM/YYYY".
   */
  async getSalarySlipData(
    this: StoresService,
    profileId: string,
    month: string,
  ) {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      relations: ['account', 'storeRole'],
    });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');

    // Fetch salary record for this month
    const salary = await this.getEmployeeSalaries(profileId, month);
    const salaryRecord = Array.isArray(salary) ? salary[0] : salary;

    if (!salaryRecord) {
      return {
        message: 'Chưa có phiếu lương cho tháng này. Vui lòng liên hệ quản lý.',
        profileId,
        month,
        employeeName: profile.account?.fullName || 'N/A',
        position: profile.storeRole?.name || 'N/A',
        data: null,
      };
    }

    return {
      profileId,
      month,
      employeeName: profile.account?.fullName || 'N/A',
      position: profile.storeRole?.name || 'N/A',
      workingDays: salaryRecord.workingDays,
      workingHours: salaryRecord.workingHours,
      baseSalary: salaryRecord.baseSalary,
      bonus: salaryRecord.bonus,
      penalty: salaryRecord.penalty,
      advancePayment: salaryRecord.advancePayment,
      totalIncome: salaryRecord.totalIncome,
      totalDeductions: salaryRecord.totalDeductions,
      netSalary: salaryRecord.netSalary,
      paymentStatus: salaryRecord.paymentStatus,
      paidAt: salaryRecord.paidAt,
      generatedAt: new Date().toISOString(),
    };
  }
}
