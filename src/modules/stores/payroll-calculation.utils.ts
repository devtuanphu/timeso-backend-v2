import { PaymentType } from './entities/employee-contract.entity';
import {
  AttendanceStatus,
  ShiftAssignmentStatus,
} from './entities/shift-management.entity';
import {
  PayrollCalcType,
  PayrollRuleCategory,
  StorePayrollRule,
} from './entities/store-payroll-rule.entity';
import { WORKING_DAYS_PER_WEEK } from './shift-earnings.utils';

/**
 * Monthly payroll arithmetic, in one place.
 *
 * Payslip generation, recalculation, the real-time update at check-out and the
 * staff "estimated salary" card used to carry their own copies of this maths
 * and had drifted apart (an hourly contract divided by 176 on one path, the
 * absent fine applied for any calc type on another, rounding on some paths
 * only). Every path now calls these functions.
 *
 * Pure: no I/O and no clock. "Today" is passed in as a Vietnam date string.
 *
 * Rounding: money is computed from monthly totals and rounded to whole VND
 * once per component (earned base, allowances, bonus, penalty, advance).
 * Totals are sums of those integers. Per-shift `shiftEarnings` is a display
 * figure rounded per shift and is never summed into a payslip, so the sum of
 * a month's `shiftEarnings` can differ from `earnedBaseSalary` by less than
 * 1 VND per shift. The one exception is a same-month rehire: shifts of the
 * previous stint keep their stored `shiftEarnings` (computeStintSplitEarnedBase).
 */

export interface PayrollAssignmentFact {
  id: string;
  /** Vietnam calendar date of the shift, 'YYYY-MM-DD'. */
  workDate: string;
  status: ShiftAssignmentStatus;
  attendanceStatus?: AttendanceStatus | null;
  checkInTime?: Date | string | null;
  workedMinutes?: number | null;
  lateMinutes?: number | null;
  earlyMinutes?: number | null;
  /**
   * Stored per-shift figure written at check-out. The monthly maths ignores
   * it, except for shifts of a previous employment stint in the same month
   * (see computeStintSplitEarnedBase), which keep the pay recorded for them.
   */
  shiftEarnings?: number | null;
  /**
   * An approved full-day leave (or a timed leave attached to this exact
   * shift) covers the shift: it is authorized leave, never an absence.
   */
  leaveCovered?: boolean;
}

export interface MonthlyAttendanceFacts {
  totalAssignedShifts: number;
  completedShifts: number;
  /** Sum of workedMinutes over COMPLETED assignments. */
  workedMinutes: number;
  /** round(workedMinutes / 60, 2); display only. */
  workingHours: number;
  /** Distinct work dates with at least one COMPLETED assignment. */
  daysWorked: number;
  lateCount: number;
  earlyCount: number;
  absentCount: number;
  totalLateMinutes: number;
  totalEarlyMinutes: number;
}

export type PayrollRuleInput = Pick<
  StorePayrollRule,
  'category' | 'ruleType' | 'calcType' | 'value'
>;

const toFiniteNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const workDateOf = (value: unknown): string =>
  typeof value === 'string' ? value.slice(0, 10) : '';

export function summarizeMonthlyAttendance(
  assignments: PayrollAssignmentFact[],
  todayVn: string,
): MonthlyAttendanceFacts {
  let completedShifts = 0;
  let workedMinutes = 0;
  let lateCount = 0;
  let earlyCount = 0;
  let absentCount = 0;
  let totalLateMinutes = 0;
  let totalEarlyMinutes = 0;
  const workedDates = new Set<string>();

  for (const a of assignments) {
    const late = toFiniteNumber(a.lateMinutes);
    const early = toFiniteNumber(a.earlyMinutes);
    if (late > 0) lateCount += 1;
    if (early > 0) earlyCount += 1;
    totalLateMinutes += late;
    totalEarlyMinutes += early;

    const workDate = workDateOf(a.workDate);
    if (a.status === ShiftAssignmentStatus.COMPLETED) {
      completedShifts += 1;
      const worked = toFiniteNumber(a.workedMinutes);
      if (worked > 0) workedMinutes += worked;
      if (workDate) workedDates.add(workDate);
    }

    // Approved but never checked in: absent once marked ABSENT at shift end,
    // or once the work date is in the past (Vietnam calendar) — unless an
    // approved leave covers the shift (authorized leave is never an absence).
    if (
      a.status === ShiftAssignmentStatus.APPROVED &&
      !a.checkInTime &&
      !a.leaveCovered &&
      (a.attendanceStatus === AttendanceStatus.ABSENT ||
        (workDate !== '' && workDate < todayVn))
    ) {
      absentCount += 1;
    }
  }

  return {
    totalAssignedShifts: assignments.length,
    completedShifts,
    workedMinutes,
    workingHours: Math.round((workedMinutes / 60) * 100) / 100,
    daysWorked: workedDates.size,
    lateCount,
    earlyCount,
    absentCount,
    totalLateMinutes,
    totalEarlyMinutes,
  };
}

/** Unknown or missing payment type is paid as MONTH. */
export function resolvePayrollPaymentType(
  type: PaymentType | string | null | undefined,
): PaymentType {
  const known = Object.values(PaymentType) as string[];
  return type && known.includes(type) ? (type as PaymentType) : PaymentType.MONTH;
}

type EarnedBaseFacts = Pick<
  MonthlyAttendanceFacts,
  'completedShifts' | 'workedMinutes' | 'daysWorked'
>;

/**
 * The terms of the earned-base formula, shared by computeEarnedBase and
 * describeEarnedBase so the two cannot drift:
 * earned = round(rate × units ÷ per). `per` is null when the month cannot
 * be priced (MONTH with no standard and no calendar days).
 */
function earnedBaseTerms(input: {
  paymentType: PaymentType;
  facts: EarnedBaseFacts;
  standardWorkingDays: number;
  calendarDays: number;
}): { units: number; per: number | null } {
  const { facts } = input;
  switch (input.paymentType) {
    case PaymentType.HOUR:
      return { units: Math.max(0, facts.workedMinutes), per: 60 };
    case PaymentType.SHIFT:
    case PaymentType.DAY:
      return { units: facts.completedShifts, per: 1 };
    case PaymentType.WEEK:
      return { units: facts.completedShifts, per: WORKING_DAYS_PER_WEEK };
    case PaymentType.MONTH:
    default: {
      const days =
        input.standardWorkingDays > 0
          ? input.standardWorkingDays
          : input.calendarDays;
      return { units: facts.daysWorked, per: days > 0 ? days : null };
    }
  }
}

/**
 * Earned base pay for the month.
 * - HOUR: rate × hours worked.
 * - SHIFT, DAY: rate × completed shifts.
 * - WEEK: rate × completed shifts / 6.
 * - MONTH: rate ÷ standard working days × distinct days worked (calendar days
 *   when the store has no days-off configuration). Not capped.
 */
export function computeEarnedBase(input: {
  paymentType: PaymentType;
  rate: number;
  facts: EarnedBaseFacts;
  standardWorkingDays: number;
  calendarDays: number;
}): number {
  const rate = Number(input.rate);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const { units, per } = earnedBaseTerms(input);
  if (per == null) return 0;
  return Math.round((rate * units) / per);
}

/** How a payslip's earned base was obtained, for the salary screen. */
export interface EarnedBreakdown {
  paymentType: 'Giờ' | 'Ca' | 'Ngày' | 'Tuần' | 'Tháng';
  /** The rate the earned base is priced with (VND per rate unit). */
  rate: number;
  rateLabel:
    | 'Lương giờ'
    | 'Lương ca'
    | 'Lương ngày'
    | 'Lương tuần'
    | 'Lương tháng';
  rateUnitLabel: 'giờ' | 'ca' | 'ngày' | 'tuần' | 'tháng';
  /**
   * HOUR: hours worked (workedMinutes / 60, not rounded); SHIFT/DAY/WEEK:
   * completed shifts; MONTH: distinct days worked. Null on a stored payslip
   * whose amount the current attendance no longer reproduces.
   */
  quantity: number | null;
  quantityUnit: 'HOUR' | 'SHIFT' | 'DAY';
  quantityLabel: 'Tổng giờ làm' | 'Số ca làm' | 'Ngày công';
  /** HOUR only: minutes worked; null otherwise (and when `quantity` is null). */
  workedMinutes: number | null;
  /** WEEK: 6; MONTH: working days the rate is divided by; null otherwise. */
  divisor: number | null;
  divisorLabel: string | null;
  /** The payslip's earnedBaseSalary. */
  amount: number;
  /** round(rate × quantity ÷ (divisor ?? 1)) === amount, as computeEarnedBase rounds. */
  reproducible: boolean;
  /** The month holds shifts of two employment stints priced separately. */
  mixedRates: boolean;
}

const EARNED_BREAKDOWN_LABELS: Record<
  PaymentType,
  Pick<
    EarnedBreakdown,
    'rateLabel' | 'rateUnitLabel' | 'quantityUnit' | 'quantityLabel'
  > & { divisorLabel: string | null }
> = {
  [PaymentType.HOUR]: {
    rateLabel: 'Lương giờ',
    rateUnitLabel: 'giờ',
    quantityUnit: 'HOUR',
    quantityLabel: 'Tổng giờ làm',
    divisorLabel: null,
  },
  [PaymentType.SHIFT]: {
    rateLabel: 'Lương ca',
    rateUnitLabel: 'ca',
    quantityUnit: 'SHIFT',
    quantityLabel: 'Số ca làm',
    divisorLabel: null,
  },
  [PaymentType.DAY]: {
    rateLabel: 'Lương ngày',
    rateUnitLabel: 'ngày',
    quantityUnit: 'SHIFT',
    quantityLabel: 'Số ca làm',
    divisorLabel: null,
  },
  [PaymentType.WEEK]: {
    rateLabel: 'Lương tuần',
    rateUnitLabel: 'tuần',
    quantityUnit: 'SHIFT',
    quantityLabel: 'Số ca làm',
    divisorLabel: 'ngày/tuần',
  },
  [PaymentType.MONTH]: {
    rateLabel: 'Lương tháng',
    rateUnitLabel: 'tháng',
    quantityUnit: 'DAY',
    quantityLabel: 'Ngày công',
    divisorLabel: 'ngày công chuẩn',
  },
};

/**
 * Describes an earned base (`amount`) with the terms computeEarnedBase uses.
 * Pure and display-only: it never changes the amount. `reproducible` is
 * true only when pricing `facts` at `rate` gives back exactly `amount`; it
 * is false when `facts` is missing, when the amount was priced with other
 * inputs (a stored payslip whose rate changed since) or when `mixedRates`
 * is set (two stints priced with different contracts).
 */
export function describeEarnedBase(input: {
  paymentType: PaymentType | string | null | undefined;
  rate: unknown;
  facts: EarnedBaseFacts | null | undefined;
  standardWorkingDays: number;
  calendarDays: number;
  amount: unknown;
  mixedRates?: boolean;
}): EarnedBreakdown {
  const paymentType = resolvePayrollPaymentType(input.paymentType);
  const rate = toFiniteNumber(input.rate);
  const amount = toFiniteNumber(input.amount);
  const mixedRates = input.mixedRates === true;
  const facts: EarnedBaseFacts = input.facts ?? {
    completedShifts: 0,
    workedMinutes: 0,
    daysWorked: 0,
  };
  const { units, per } = earnedBaseTerms({
    paymentType,
    facts,
    standardWorkingDays: toFiniteNumber(input.standardWorkingDays),
    calendarDays: toFiniteNumber(input.calendarDays),
  });
  const isHour = paymentType === PaymentType.HOUR;
  const divided =
    paymentType === PaymentType.WEEK || paymentType === PaymentType.MONTH;
  const labels = EARNED_BREAKDOWN_LABELS[paymentType];
  const recomputed = computeEarnedBase({
    paymentType,
    rate,
    facts,
    standardWorkingDays: toFiniteNumber(input.standardWorkingDays),
    calendarDays: toFiniteNumber(input.calendarDays),
  });
  return {
    paymentType: paymentType as EarnedBreakdown['paymentType'],
    rate,
    rateLabel: labels.rateLabel,
    rateUnitLabel: labels.rateUnitLabel,
    quantity: isHour ? units / 60 : units,
    quantityUnit: labels.quantityUnit,
    quantityLabel: labels.quantityLabel,
    workedMinutes: isHour ? units : null,
    divisor: divided ? per : null,
    divisorLabel: divided && per != null ? labels.divisorLabel : null,
    amount,
    reproducible:
      input.facts != null &&
      !mixedRates &&
      (!divided || per != null) &&
      recomputed === amount,
    mixedRates,
  };
}

/** Facts the bonus/fine rules read. */
export type RuleAdjustmentFacts = Pick<
  MonthlyAttendanceFacts,
  'lateCount' | 'earlyCount' | 'absentCount' | 'completedShifts'
>;

/** A bonus is only ever paid for a month with at least one COMPLETED shift. */
const hasCompletedWork = (facts: RuleAdjustmentFacts): boolean =>
  toFiniteNumber(facts.completedShifts) > 0;

/**
 * Bonus and penalty from the store's active rules.
 * - FINE LATE / EARLY: AMOUNT value × count; PERCENTAGE earned × value% × count.
 * - FINE ABSENT: AMOUNT only, value × count.
 * - BONUS ATTENDANCE: value when at least one shift was COMPLETED in the
 *   month and there was no late arrival and no absence.
 * - BONUS with no rule type or GENERAL: value, once at least one shift was
 *   COMPLETED in the month (nothing is paid for a month with no work).
 */
export function computeRuleAdjustments(
  rules: PayrollRuleInput[],
  facts: RuleAdjustmentFacts,
  earnedBase: number,
): { bonus: number; penalty: number } {
  let bonus = 0;
  let penalty = 0;

  const countedFine = (rule: PayrollRuleInput, count: number): number => {
    if (count <= 0) return 0;
    const value = toFiniteNumber(rule.value);
    if (rule.calcType === PayrollCalcType.AMOUNT) return value * count;
    if (rule.calcType === PayrollCalcType.PERCENTAGE) {
      return ((earnedBase * value) / 100) * count;
    }
    return 0;
  };

  for (const rule of rules ?? []) {
    if (rule.category === PayrollRuleCategory.FINE) {
      if (rule.ruleType === 'LATE') penalty += countedFine(rule, facts.lateCount);
      if (rule.ruleType === 'EARLY') {
        penalty += countedFine(rule, facts.earlyCount);
      }
      if (
        rule.ruleType === 'ABSENT' &&
        facts.absentCount > 0 &&
        rule.calcType === PayrollCalcType.AMOUNT
      ) {
        penalty += toFiniteNumber(rule.value) * facts.absentCount;
      }
    } else if (rule.category === PayrollRuleCategory.BONUS) {
      if (!hasCompletedWork(facts)) continue;
      if (
        rule.ruleType === 'ATTENDANCE' &&
        facts.lateCount === 0 &&
        facts.absentCount === 0
      ) {
        bonus += toFiniteNumber(rule.value);
      }
      if (!rule.ruleType || rule.ruleType === 'GENERAL') {
        bonus += toFiniteNumber(rule.value);
      }
    }
  }

  return { bonus: Math.round(bonus), penalty: Math.round(penalty) };
}

/** One automatic bonus/fine line of a payslip, for the salary screen. */
export interface PayslipAdjustmentLine {
  kind: 'BONUS' | 'FINE';
  /** LATE / EARLY / ABSENT / ATTENDANCE / GENERAL. */
  ruleType: string;
  label: string;
  /** Occurrences the line was multiplied by (1 for flat bonuses). */
  count: number;
  /** Whole VND, positive. */
  amount: number;
}

const ADJUSTMENT_LABELS: Record<string, string> = {
  LATE: 'Đi trễ',
  EARLY: 'Về sớm',
  ABSENT: 'Nghỉ không phép',
  ATTENDANCE: 'Chuyên cần',
  GENERAL: 'Thưởng',
};

/**
 * The lines behind computeRuleAdjustments, with the same rules and the same
 * totals: rounded lines are reconciled so BONUS lines sum exactly to `bonus`
 * and FINE lines to `penalty`. It does not change how pay is computed.
 */
export function computeRuleAdjustmentBreakdown(
  rules: Array<PayrollRuleInput & { name?: string | null }>,
  facts: RuleAdjustmentFacts,
  earnedBase: number,
): PayslipAdjustmentLine[] {
  const raw: Array<PayslipAdjustmentLine & { exact: number }> = [];
  const push = (
    kind: 'BONUS' | 'FINE',
    rule: PayrollRuleInput & { name?: string | null },
    ruleType: string,
    count: number,
    exact: number,
  ) => {
    if (!(exact !== 0) || !Number.isFinite(exact)) return;
    const label =
      (typeof rule.name === 'string' && rule.name.trim()) ||
      ADJUSTMENT_LABELS[ruleType] ||
      (kind === 'BONUS' ? 'Thưởng' : 'Phạt');
    raw.push({ kind, ruleType, label, count, amount: 0, exact });
  };
  const countedFine = (rule: PayrollRuleInput, count: number): number => {
    if (count <= 0) return 0;
    const value = toFiniteNumber(rule.value);
    if (rule.calcType === PayrollCalcType.AMOUNT) return value * count;
    if (rule.calcType === PayrollCalcType.PERCENTAGE) {
      return ((earnedBase * value) / 100) * count;
    }
    return 0;
  };

  for (const rule of rules ?? []) {
    if (rule.category === PayrollRuleCategory.FINE) {
      if (rule.ruleType === 'LATE') {
        push('FINE', rule, 'LATE', facts.lateCount, countedFine(rule, facts.lateCount));
      }
      if (rule.ruleType === 'EARLY') {
        push('FINE', rule, 'EARLY', facts.earlyCount, countedFine(rule, facts.earlyCount));
      }
      if (
        rule.ruleType === 'ABSENT' &&
        facts.absentCount > 0 &&
        rule.calcType === PayrollCalcType.AMOUNT
      ) {
        push(
          'FINE',
          rule,
          'ABSENT',
          facts.absentCount,
          toFiniteNumber(rule.value) * facts.absentCount,
        );
      }
    } else if (rule.category === PayrollRuleCategory.BONUS) {
      if (!hasCompletedWork(facts)) continue;
      if (
        rule.ruleType === 'ATTENDANCE' &&
        facts.lateCount === 0 &&
        facts.absentCount === 0
      ) {
        push('BONUS', rule, 'ATTENDANCE', 1, toFiniteNumber(rule.value));
      }
      if (!rule.ruleType || rule.ruleType === 'GENERAL') {
        push('BONUS', rule, 'GENERAL', 1, toFiniteNumber(rule.value));
      }
    }
  }

  const totals = computeRuleAdjustments(rules, facts, earnedBase);
  for (const kind of ['BONUS', 'FINE'] as const) {
    const lines = raw.filter((line) => line.kind === kind);
    if (!lines.length) continue;
    for (const line of lines) line.amount = Math.round(line.exact);
    const target = kind === 'BONUS' ? totals.bonus : totals.penalty;
    const diff = target - lines.reduce((sum, line) => sum + line.amount, 0);
    if (diff !== 0) {
      const largest = lines.reduce((a, b) =>
        Math.abs(b.exact) > Math.abs(a.exact) ? b : a,
      );
      largest.amount += diff;
    }
  }
  return raw
    .filter((line) => line.amount !== 0)
    .map(({ exact: _exact, ...line }) => line);
}

/** Sum of a contract's allowances, rounded to whole VND. */
export function sumAllowances(
  allowances: Record<string, unknown> | null | undefined,
): number {
  if (!allowances || typeof allowances !== 'object') return 0;
  return Math.round(
    Object.values(allowances).reduce<number>(
      (sum, value) => sum + toFiniteNumber(value),
      0,
    ),
  );
}

/**
 * Deductions and net pay for a known total income. Used by the payslip
 * composer and by advance approval, which keeps the stored income.
 */
export function computeNetFromIncome(input: {
  totalIncome: number;
  penalty: number;
  advancePayment: number;
  otherDeductions?: number;
}): { totalIncome: number; totalDeductions: number; netSalary: number } {
  const totalIncome = Math.round(toFiniteNumber(input.totalIncome));
  const totalDeductions =
    Math.round(toFiniteNumber(input.penalty)) +
    Math.round(toFiniteNumber(input.advancePayment)) +
    Math.round(toFiniteNumber(input.otherDeductions));
  return {
    totalIncome,
    totalDeductions,
    netSalary: Math.max(0, totalIncome - totalDeductions),
  };
}

/**
 * Income = earned + allowances + bonus (allowances are always included, even
 * with nothing earned yet); deductions = penalty + advance + other;
 * net = max(0, income − deductions). All in whole VND.
 */
export function computePayslipTotals(input: {
  earnedBase: number;
  allowancesTotal: number;
  bonus: number;
  penalty: number;
  advancePayment: number;
  otherDeductions?: number;
}): { totalIncome: number; totalDeductions: number; netSalary: number } {
  const totalIncome =
    Math.round(toFiniteNumber(input.earnedBase)) +
    Math.round(toFiniteNumber(input.allowancesTotal)) +
    Math.round(toFiniteNumber(input.bonus));
  return computeNetFromIncome({
    totalIncome,
    penalty: input.penalty,
    advancePayment: input.advancePayment,
    otherDeductions: input.otherDeductions,
  });
}

/**
 * Display figures derived from a payslip's returned totals, so they always
 * reconcile with totalIncome / totalDeductions / netSalary of that payslip.
 * - incomeAfterAdvance = totalIncome − advancePayment (TỔNG THU NHẬP).
 * - deductionsExcludingAdvance = penalty + otherDeductions (Khấu trừ).
 * - isNetClamped: the difference is negative and netSalary was clamped to 0.
 */
export function describePayslipTotals(input: {
  totalIncome: unknown;
  advancePayment: unknown;
  penalty: unknown;
  otherDeductions: unknown;
  netSalary: unknown;
}): {
  incomeAfterAdvance: number;
  deductionsExcludingAdvance: number;
  isNetClamped: boolean;
} {
  const incomeAfterAdvance =
    toFiniteNumber(input.totalIncome) - toFiniteNumber(input.advancePayment);
  const deductionsExcludingAdvance =
    toFiniteNumber(input.penalty) + toFiniteNumber(input.otherDeductions);
  return {
    incomeAfterAdvance,
    deductionsExcludingAdvance,
    isNetClamped:
      incomeAfterAdvance - deductionsExcludingAdvance < 0 &&
      toFiniteNumber(input.netSalary) === 0,
  };
}

export interface PayslipComputation {
  paymentType: PaymentType;
  baseSalary: number;
  earnedBaseSalary: number;
  allowancesTotal: number;
  bonus: number;
  penalty: number;
  advancePayment: number;
  otherDeductions: number;
  totalIncome: number;
  totalDeductions: number;
  netSalary: number;
  /** Distinct days worked. */
  workingDays: number;
  workingHours: number;
  /** Absent shifts. */
  unauthorizedLeaveDays: number;
  standardWorkingDays: number;
}

export function computePayslip(input: {
  paymentType: PaymentType | string | null | undefined;
  rate: number;
  allowances: Record<string, unknown> | null | undefined;
  rules: PayrollRuleInput[];
  facts: MonthlyAttendanceFacts;
  standardWorkingDays: number;
  calendarDays: number;
  advancePayment: number;
  otherDeductions?: number;
  /**
   * Earned base already computed by the caller (a same-month rehire, see
   * computeStintSplitEarnedBase). When omitted it is computed from `facts`
   * at `rate`. Bonus and fine rules always read the whole month's `facts`.
   */
  earnedBaseSalary?: number | null;
}): PayslipComputation {
  const paymentType = resolvePayrollPaymentType(input.paymentType);
  const rate = toFiniteNumber(input.rate);
  const earnedBaseSalary =
    input.earnedBaseSalary != null && Number.isFinite(Number(input.earnedBaseSalary))
      ? Math.round(Number(input.earnedBaseSalary))
      : computeEarnedBase({
          paymentType,
          rate,
          facts: input.facts,
          standardWorkingDays: input.standardWorkingDays,
          calendarDays: input.calendarDays,
        });
  const { bonus, penalty } = computeRuleAdjustments(
    input.rules,
    input.facts,
    earnedBaseSalary,
  );
  const allowancesTotal = sumAllowances(input.allowances);
  const advancePayment = Math.round(toFiniteNumber(input.advancePayment));
  const otherDeductions = Math.round(toFiniteNumber(input.otherDeductions));
  const totals = computePayslipTotals({
    earnedBase: earnedBaseSalary,
    allowancesTotal,
    bonus,
    penalty,
    advancePayment,
    otherDeductions,
  });

  return {
    paymentType,
    baseSalary: rate,
    earnedBaseSalary,
    allowancesTotal,
    bonus,
    penalty,
    advancePayment,
    otherDeductions,
    ...totals,
    workingDays: input.facts.daysWorked,
    workingHours: input.facts.workingHours,
    unauthorizedLeaveDays: input.facts.absentCount,
    standardWorkingDays: input.standardWorkingDays,
  };
}

/**
 * For each work date, the COMPLETED assignment that carries the day's MONTH
 * pay: earliest check-in, ties (or missing check-ins) broken by smallest id,
 * so the result does not depend on input order.
 */
export function pickDayOwnerAssignmentIds(
  assignments: PayrollAssignmentFact[],
): Set<string> {
  const best = new Map<string, { id: string; at: number }>();
  for (const a of assignments) {
    if (a.status !== ShiftAssignmentStatus.COMPLETED) continue;
    const date = workDateOf(a.workDate);
    if (!date) continue;
    const parsed = a.checkInTime ? new Date(a.checkInTime).getTime() : NaN;
    const at = Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
    const current = best.get(date);
    if (
      !current ||
      at < current.at ||
      (at === current.at && a.id < current.id)
    ) {
      best.set(date, { id: a.id, at });
    }
  }
  return new Set(Array.from(best.values(), (entry) => entry.id));
}

/** Pricing of one contract, for computeStintSplitEarnedBase. */
export interface StintPricing {
  paymentType: PaymentType | string | null | undefined;
  rate: number;
}

/**
 * Earned base for a month that holds shifts of two employment stints (the
 * employee was terminated and rehired within the month and the payslip is
 * still PENDING/REJECTED). One payslip covers the month, but each stint is
 * priced with its own contract:
 * - Shifts before `stintStartDate` (the VN date the current stint started)
 *   belong to the previous stint. A COMPLETED one contributes the
 *   `shiftEarnings` stored at its check-out, which was priced with the
 *   contract of that time. When that figure is missing (null) the shift is
 *   priced with `prior` (the previous stint's contract), or with `current`
 *   when no previous contract is known.
 * - Shifts on or after `stintStartDate` are priced with `current` from their
 *   attendance facts, exactly like a normal month.
 *
 * Returns null when the month has no previous-stint shift, so the caller
 * keeps the normal single-contract path.
 */
export function computeStintSplitEarnedBase(input: {
  assignments: PayrollAssignmentFact[];
  stintStartDate: string | null | undefined;
  todayVn: string;
  current: StintPricing;
  prior: StintPricing | null;
  standardWorkingDays: number;
  calendarDays: number;
}): {
  earnedBase: number;
  currentStintEarned: number;
  priorStintEarned: number;
} | null {
  const start = input.stintStartDate;
  if (!start) return null;
  const isPrior = (a: PayrollAssignmentFact) => {
    const date = workDateOf(a.workDate);
    return date !== '' && date < start;
  };
  if (!input.assignments.some(isPrior)) return null;

  const price = (pricing: StintPricing, rows: PayrollAssignmentFact[]) =>
    rows.length
      ? computeEarnedBase({
          paymentType: resolvePayrollPaymentType(pricing.paymentType),
          rate: toFiniteNumber(pricing.rate),
          facts: summarizeMonthlyAttendance(rows, input.todayVn),
          standardWorkingDays: input.standardWorkingDays,
          calendarDays: input.calendarDays,
        })
      : 0;

  const priorCompleted = input.assignments.filter(
    (a) => isPrior(a) && a.status === ShiftAssignmentStatus.COMPLETED,
  );
  const stored = priorCompleted
    .filter((a) => a.shiftEarnings != null)
    .reduce((sum, a) => sum + Math.round(toFiniteNumber(a.shiftEarnings)), 0);
  const repriced = price(
    input.prior ?? input.current,
    priorCompleted.filter((a) => a.shiftEarnings == null),
  );
  const priorStintEarned = stored + repriced;
  const currentStintEarned = price(
    input.current,
    input.assignments.filter((a) => !isPrior(a)),
  );
  return {
    earnedBase: priorStintEarned + currentStintEarned,
    currentStintEarned,
    priorStintEarned,
  };
}
