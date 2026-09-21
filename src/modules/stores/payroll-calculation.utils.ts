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
 * 1 VND per shift.
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
  /** Stored per-shift display figure; never used by the monthly maths. */
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
  facts: Pick<
    MonthlyAttendanceFacts,
    'completedShifts' | 'workedMinutes' | 'daysWorked'
  >;
  standardWorkingDays: number;
  calendarDays: number;
}): number {
  const rate = Number(input.rate);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const { facts } = input;

  switch (input.paymentType) {
    case PaymentType.HOUR:
      return Math.round((rate * Math.max(0, facts.workedMinutes)) / 60);
    case PaymentType.SHIFT:
    case PaymentType.DAY:
      return Math.round(rate * facts.completedShifts);
    case PaymentType.WEEK:
      return Math.round((rate * facts.completedShifts) / WORKING_DAYS_PER_WEEK);
    case PaymentType.MONTH:
    default: {
      const days =
        input.standardWorkingDays > 0
          ? input.standardWorkingDays
          : input.calendarDays;
      if (!(days > 0)) return 0;
      return Math.round((rate * facts.daysWorked) / days);
    }
  }
}

/**
 * Bonus and penalty from the store's active rules.
 * - FINE LATE / EARLY: AMOUNT value × count; PERCENTAGE earned × value% × count.
 * - FINE ABSENT: AMOUNT only, value × count.
 * - BONUS ATTENDANCE: value when there was no late arrival and no absence.
 * - BONUS with no rule type or GENERAL: value, unconditionally.
 */
export function computeRuleAdjustments(
  rules: PayrollRuleInput[],
  facts: Pick<MonthlyAttendanceFacts, 'lateCount' | 'earlyCount' | 'absentCount'>,
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
  facts: Pick<MonthlyAttendanceFacts, 'lateCount' | 'earlyCount' | 'absentCount'>,
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
}): PayslipComputation {
  const paymentType = resolvePayrollPaymentType(input.paymentType);
  const rate = toFiniteNumber(input.rate);
  const earnedBaseSalary = computeEarnedBase({
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
