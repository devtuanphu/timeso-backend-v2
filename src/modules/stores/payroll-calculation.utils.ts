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
import {
  evaluateRuleConfig,
  normalizeRuleCalcConfig,
  type DayPay,
  type RuleOccurrence,
} from './payroll-rule-config.utils';
import { PayslipBuiltinRow } from './entities/store-payslip-row.entity';
import {
  countedPayslipDeductions,
  isBuiltinRemoved,
  payslipExtraTotals,
  type PayslipRowsSnapshot,
} from './payslip-rows.utils';

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
  /** Check-out instant (COMPLETED shifts). */
  checkOutTime?: Date | string | null;
  /**
   * The shift's effective window (slot / template time, moved by approved
   * late-arrival / early-leave requests). Feeds overtime, night and absent
   * minutes of the v2 bonus / violation rules.
   */
  windowStart?: Date | string | null;
  windowEnd?: Date | string | null;
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
  /** v2 rules (Thiết lập tính lương): see summarizeMonthlyAttendance. */
  overtimeMinutes?: number;
  overtimeShifts?: number;
  nightMinutes?: number;
  nightShifts?: number;
  punctualMinutes?: number;
  punctualShifts?: number;
  missedPunchCount?: number;
  absentMinutes?: number;
  /** Month's manual records ("ghi nhận") summed per rule id. */
  ruleQuantities?: Record<string, number>;
  /** The employee's own pay per hour / shift / day / month (rule bases). */
  payRates?: { hourly: number; perShift: number; daily?: number; monthly?: number };
  /** v3 "x ngày lương": the pay of each work date (see dayPayOf). */
  dayPay?: DayPay;
  /**
   * Thưởng hoàn thành giai đoạn (chính sách của cửa hàng): số lần được duyệt
   * lên giai đoạn kế trong tháng và mức thưởng mỗi lần.
   */
  stageCompletion?: { count: number; amount: number };
  /**
   * v3 rules (calc_config): every occurrence of an automatic code in the
   * month (one late arrival with its minutes, one overtime shift…).
   */
  ruleOccurrences?: Record<string, RuleOccurrence[]>;
  /** v3 rules: the month's manual records per rule id, one per record. */
  recordOccurrences?: Record<string, RuleOccurrence[]>;
  /** Total of the employee's COMPLETED orders in the month (Theo % doanh số). */
  revenue?: number;
  /**
   * The month is over (Vietnam calendar). A "≤" milestone ("≤ 2 lần trễ →
   * thưởng", "≤ 20 công → phạt") can only be decided then; undefined = over.
   */
  monthComplete?: boolean;
}

export type PayrollRuleInput = Pick<
  StorePayrollRule,
  'category' | 'ruleType' | 'calcType' | 'value'
> &
  Partial<
    Pick<
      StorePayrollRule,
      'id' | 'name' | 'code' | 'calcMode' | 'threshold' | 'calcConfig'
    >
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
  let overtimeMinutes = 0;
  let overtimeShifts = 0;
  let nightMinutes = 0;
  let nightShifts = 0;
  let punctualMinutes = 0;
  let punctualShifts = 0;
  let missedPunchCount = 0;
  let absentMinutes = 0;
  const workedDates = new Set<string>();
  // v3: each occurrence with its own minutes (Đi muộn 12 phút ngày 03…).
  const occurrences: Record<string, RuleOccurrence[]> = {};
  // shiftMinutes: giờ theo lịch của ca đó (gốc "giờ của ca hôm đó").
  let shiftMinutesOfA = 0;
  const occur = (code: string, date: string, minutes: number) =>
    (occurrences[code] ??= []).push({
      date,
      minutes,
      quantity: 1,
      shiftMinutes: shiftMinutesOfA,
    });

  for (const a of assignments) {
    const late = toFiniteNumber(a.lateMinutes);
    const early = toFiniteNumber(a.earlyMinutes);
    const workDate = workDateOf(a.workDate);
    shiftMinutesOfA = windowMinutes(a);
    if (late > 0) {
      lateCount += 1;
      occur('LATE', workDate, late);
    }
    if (early > 0) {
      earlyCount += 1;
      occur('EARLY', workDate, early);
    }
    totalLateMinutes += late;
    totalEarlyMinutes += early;
    if (a.attendanceStatus === AttendanceStatus.FORGOT_CHECKOUT) {
      missedPunchCount += 1;
      occur('MISSED_PUNCH', workDate, 0);
    }

    if (a.status === ShiftAssignmentStatus.COMPLETED) {
      completedShifts += 1;
      const worked = toFiniteNumber(a.workedMinutes);
      if (worked > 0) workedMinutes += worked;
      if (workDate) workedDates.add(workDate);
      if (worked > 0) occur('ATTENDANCE', workDate, worked);
      if (late === 0 && early === 0 && worked > 0) {
        punctualShifts += 1;
        punctualMinutes += worked;
        occur('PUNCTUALITY', workDate, worked);
      }
      const extra = shiftExtraMinutes(a, worked);
      if (extra.overtime > 0) {
        overtimeShifts += 1;
        overtimeMinutes += extra.overtime;
        occur('OVERTIME', workDate, extra.overtime);
      }
      if (extra.night > 0) {
        nightShifts += 1;
        nightMinutes += extra.night;
        occur('NIGHT_SHIFT', workDate, extra.night);
      }
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
      absentMinutes += windowMinutes(a);
      occur('ABSENT', workDate, windowMinutes(a));
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
    overtimeMinutes,
    overtimeShifts,
    nightMinutes,
    nightShifts,
    punctualMinutes,
    punctualShifts,
    missedPunchCount,
    absentMinutes,
    ruleOccurrences: occurrences,
  };
}

const instantMs = (value: unknown): number | null => {
  if (!value) return null;
  const ms = new Date(value as string | Date).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/**
 * Phút theo lịch của các ca trong ngày (giờ VN), cho gốc "giờ của ca hôm đó"
 * của khoản ghi nhận tay: ca đã duyệt / đã làm của ngày được ghi nhận.
 */
export function scheduledMinutesByDate(
  assignments: PayrollAssignmentFact[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of assignments) {
    if (
      a.status !== ShiftAssignmentStatus.APPROVED &&
      a.status !== ShiftAssignmentStatus.COMPLETED
    ) {
      continue;
    }
    const date = workDateOf(a.workDate);
    if (date) out[date] = (out[date] ?? 0) + windowMinutes(a);
  }
  return out;
}

/**
 * Khoản áp dụng cho một nhân viên: khoản toàn cửa hàng (không có danh sách)
 * hoặc khoản có tên nhân viên đó trong phạm vi áp dụng.
 */
export function rulesApplyingTo<
  T extends { employeeProfileIds?: string[] | null },
>(rules: T[] | null | undefined, employeeProfileId: string): T[] {
  return (rules ?? []).filter(
    (rule) =>
      !rule.employeeProfileIds?.length ||
      rule.employeeProfileIds.includes(employeeProfileId),
  );
}

/** Scheduled length of a shift's effective window, in whole minutes. */
const windowMinutes = (a: PayrollAssignmentFact): number => {
  const start = instantMs(a.windowStart);
  const end = instantMs(a.windowEnd);
  return start != null && end != null && end > start
    ? Math.round((end - start) / 60000)
    : 0;
};

const overlapMs = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Night work window, Vietnam time: 22:00 → 06:00 the next day. */
const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 6;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Minutes of [from, to) that fall in a 22:00–06:00 (VN) night. */
export function nightOverlapMinutes(from: number, to: number): number {
  if (!(to > from)) return 0;
  // Vietnam midnight before `from`, one day earlier to catch a night that
  // started the evening before.
  const vnMidnight = Math.floor((from + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS;
  let total = 0;
  for (let day = vnMidnight - DAY_MS; day < to; day += DAY_MS) {
    const nightStart = day + NIGHT_START_HOUR * 60 * 60 * 1000;
    const nightEnd = day + DAY_MS + NIGHT_END_HOUR * 60 * 60 * 1000;
    total += overlapMs(from, to, nightStart, nightEnd);
  }
  return Math.round(total / 60000);
}

/**
 * Overtime and night minutes of one COMPLETED shift, never more than what the
 * shift was credited (`workedMinutes`), so nothing unpaid is rewarded twice:
 * - overtime: time after the effective end, capped by the credited minutes
 *   beyond the time worked inside the window (an early arrival paid in ACTUAL
 *   mode is not overtime);
 * - night: the part of check-in (not before the window start) → check-out
 *   inside 22:00–06:00.
 */
export function shiftExtraMinutes(
  a: PayrollAssignmentFact,
  worked: number,
): { overtime: number; night: number } {
  const checkIn = instantMs(a.checkInTime);
  const checkOut = instantMs(a.checkOutTime);
  if (checkIn == null || checkOut == null || !(checkOut > checkIn) || worked <= 0) {
    return { overtime: 0, night: 0 };
  }
  const start = instantMs(a.windowStart);
  const end = instantMs(a.windowEnd);
  let overtime = 0;
  if (start != null && end != null && end > start) {
    const inside = Math.round(overlapMs(checkIn, checkOut, start, end) / 60000);
    const afterEnd = Math.round(Math.max(0, checkOut - end) / 60000);
    overtime = Math.max(0, Math.min(afterEnd, worked - inside));
  }
  // Phần đến sớm trước giờ bắt đầu thường không được trả: không tính giờ đêm.
  const nightFrom = start != null && start > checkIn ? start : checkIn;
  const night = Math.min(worked, nightOverlapMinutes(nightFrom, checkOut));
  return { overtime, night };
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
> &
  Partial<
    Pick<
      MonthlyAttendanceFacts,
      | 'workedMinutes'
      | 'totalLateMinutes'
      | 'totalEarlyMinutes'
      | 'overtimeMinutes'
      | 'overtimeShifts'
      | 'nightMinutes'
      | 'nightShifts'
      | 'punctualMinutes'
      | 'punctualShifts'
      | 'missedPunchCount'
      | 'absentMinutes'
      | 'ruleQuantities'
      | 'payRates'
      | 'dayPay'
      | 'stageCompletion'
      | 'daysWorked'
      | 'ruleOccurrences'
      | 'recordOccurrences'
      | 'revenue'
      | 'monthComplete'
    >
  >;

/** A bonus is only ever paid for a month with at least one COMPLETED shift. */
const hasCompletedWork = (facts: RuleAdjustmentFacts): boolean =>
  toFiniteNumber(facts.completedShifts) > 0;

/** One automatic bonus/fine line of a payslip, for the salary screen. */
export interface PayslipAdjustmentLine {
  kind: 'BONUS' | 'FINE';
  /** The rule the line comes from (null for rows without an id). */
  ruleId?: string | null;
  /** LATE / EARLY / ABSENT / ATTENDANCE / GENERAL, or the v2 rule code. */
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

type RuleWithName = PayrollRuleInput & { name?: string | null };
type RawRuleLine = PayslipAdjustmentLine & { exact: number };

/** "2,5" — hours with at most one decimal, Vietnamese comma. */
const formatQuantity = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1).replace('.', ',');
};

/**
 * Hours H and shifts S a v2 rule is measured on, by its code. Manual codes
 * (and an unknown code) read the month's recorded quantity for the rule.
 * Chuyên cần is earned only by a month with completed work and no absence.
 */
function v2RuleBasis(
  rule: RuleWithName,
  facts: RuleAdjustmentFacts,
): { hours: number; shifts: number } {
  const n = (value: unknown) => toFiniteNumber(value);
  switch (rule.code) {
    case 'OVERTIME':
      return { hours: n(facts.overtimeMinutes) / 60, shifts: n(facts.overtimeShifts) };
    case 'ATTENDANCE':
      return hasCompletedWork(facts) && n(facts.absentCount) === 0
        ? { hours: n(facts.workedMinutes) / 60, shifts: n(facts.completedShifts) }
        : { hours: 0, shifts: 0 };
    case 'PUNCTUALITY':
      return { hours: n(facts.punctualMinutes) / 60, shifts: n(facts.punctualShifts) };
    case 'NIGHT_SHIFT':
      return { hours: n(facts.nightMinutes) / 60, shifts: n(facts.nightShifts) };
    case 'LATE':
      return { hours: n(facts.totalLateMinutes) / 60, shifts: n(facts.lateCount) };
    case 'EARLY':
      return { hours: n(facts.totalEarlyMinutes) / 60, shifts: n(facts.earlyCount) };
    case 'MISSED_PUNCH':
      return { hours: 0, shifts: n(facts.missedPunchCount) };
    case 'ABSENT':
      return { hours: n(facts.absentMinutes) / 60, shifts: n(facts.absentCount) };
    default: {
      const recorded = rule.id ? n(facts.ruleQuantities?.[rule.id]) : 0;
      return { hours: recorded, shifts: recorded };
    }
  }
}

/** Exact amount and display of one v2 rule (calc_mode set). */
function v2RuleLine(
  rule: RuleWithName,
  facts: RuleAdjustmentFacts,
): { exact: number; count: number; label: string } {
  const value = toFiniteNumber(rule.value);
  const { hours, shifts } = v2RuleBasis(rule, facts);
  const hourly = toFiniteNumber(facts.payRates?.hourly);
  const perShift = toFiniteNumber(facts.payRates?.perShift);
  const threshold = toFiniteNumber(rule.threshold);
  const name =
    (typeof rule.name === 'string' && rule.name.trim()) ||
    (rule.category === PayrollRuleCategory.FINE ? 'Vi phạm' : 'Thưởng');
  switch (rule.calcMode) {
    case 'COEF_PER_HOUR':
      return {
        exact: value * hourly * hours,
        count: 1,
        label: `${name} (${formatQuantity(hours)} giờ)`,
      };
    case 'AMOUNT_PER_HOUR':
      return {
        exact: value * hours,
        count: 1,
        label: `${name} (${formatQuantity(hours)} giờ)`,
      };
    case 'COEF_PER_SHIFT':
    case 'AMOUNT_PER_SHIFT': {
      const per = rule.calcMode === 'COEF_PER_SHIFT' ? value * perShift : value;
      const whole = Number.isInteger(shifts);
      return {
        exact: per * shifts,
        count: whole ? shifts : 1,
        label: whole ? name : `${name} (${formatQuantity(shifts)} ca)`,
      };
    }
    case 'MILESTONE_HOURS':
      return {
        exact: threshold > 0 && hours >= threshold ? value : 0,
        count: 1,
        label: `${name} (đạt ${formatQuantity(threshold)} giờ)`,
      };
    case 'MILESTONE_SHIFTS':
      return {
        exact: threshold > 0 && shifts >= threshold ? value : 0,
        count: 1,
        label: `${name} (đạt ${formatQuantity(threshold)} ca)`,
      };
    default:
      return { exact: 0, count: 0, label: name };
  }
}

/**
 * Exact amount of one v3 rule (calc_config), on the month's occurrences of its
 * code (or its manual records). Null when the stored config is unreadable:
 * the rule then pays nothing rather than a guess.
 * - Chuyên cần (except "Theo mốc điều kiện", whose threshold is the condition)
 *   is earned only by a month with no absence, like v2.
 */
function v3RuleLine(
  rule: RuleWithName,
  facts: RuleAdjustmentFacts,
  name: string,
): { exact: number; count: number; label: string } | null {
  const config = normalizeRuleCalcConfig(rule.calcConfig, name);
  if (typeof config === 'string') return null;
  const code = rule.code || 'CUSTOM';
  const n = (value: unknown) => toFiniteNumber(value);
  let occurrences: RuleOccurrence[] = facts.ruleOccurrences?.[code] ?? [];
  if (!AUTO_RULE_CODES.has(code)) {
    occurrences = rule.id ? (facts.recordOccurrences?.[rule.id] ?? []) : [];
  }
  // Chuyên cần: như v2, tháng có nghỉ không phép thì không có lần nào. Mốc
  // theo số công / ca / giờ của tháng thì chính ngưỡng là điều kiện.
  if (
    code === 'ATTENDANCE' &&
    (config.kind !== 'MILESTONE' || config.metric === 'OCCURRENCES') &&
    n(facts.absentCount) > 0
  ) {
    occurrences = [];
  }
  if (config.kind === 'MILESTONE' && config.op === 'LTE' && facts.monthComplete === false) {
    return null;
  }
  const hourly = n(facts.payRates?.hourly);
  const daily = n(facts.payRates?.daily ?? facts.payRates?.perShift);
  return evaluateRuleConfig({
    code,
    name,
    config,
    occurrences,
    rates: {
      hourly,
      daily,
      monthly: n(facts.payRates?.monthly),
      revenue: n(facts.revenue),
      dayPay: facts.dayPay,
    },
    monthly: {
      workedDays: n(facts.daysWorked),
      completedShifts: n(facts.completedShifts),
      workedMinutes: n(facts.workedMinutes),
    },
  });
}

/** Codes whose occurrences the system detects (the others are recorded). */
const AUTO_RULE_CODES: ReadonlySet<string> = new Set([
  'OVERTIME',
  'ATTENDANCE',
  'PUNCTUALITY',
  'NIGHT_SHIFT',
  'LATE',
  'EARLY',
  'MISSED_PUNCH',
  'ABSENT',
]);

/**
 * Every bonus / fine line of the store's active rules, unrounded. The single
 * source of computeRuleAdjustments (totals) and computeRuleAdjustmentBreakdown
 * (lines), so the two can never drift apart.
 *
 * Legacy rules (calc_mode null) keep their original maths:
 * - FINE LATE / EARLY: AMOUNT value × count; PERCENTAGE earned × value% × count.
 * - FINE ABSENT: AMOUNT only, value × count.
 * - BONUS ATTENDANCE: value when at least one shift was COMPLETED in the
 *   month and there was no late arrival and no absence.
 * - BONUS with no rule type or GENERAL: value, once at least one shift was
 *   COMPLETED in the month (nothing is paid for a month with no work).
 * v2 rules: see v2RuleLine. v3 rules (calc_config, takes precedence over
 * calc_mode): see v3RuleLine; a v3 bonus also needs completed work in the
 * month (a "≤ 0 lần đi muộn" milestone never pays a month nobody worked).
 */
function ruleRawLines(
  rules: RuleWithName[],
  facts: RuleAdjustmentFacts,
  earnedBase: number,
): RawRuleLine[] {
  const raw: RawRuleLine[] = [];
  const push = (
    kind: 'BONUS' | 'FINE',
    rule: RuleWithName,
    ruleType: string,
    count: number,
    exact: number,
    label?: string,
  ) => {
    if (!(exact !== 0) || !Number.isFinite(exact)) return;
    raw.push({
      kind,
      ruleId: rule.id ?? null,
      ruleType,
      label:
        label ||
        (typeof rule.name === 'string' && rule.name.trim()) ||
        ADJUSTMENT_LABELS[ruleType] ||
        (kind === 'BONUS' ? 'Thưởng' : 'Phạt'),
      count,
      amount: 0,
      exact,
    });
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
    if (
      rule.category !== PayrollRuleCategory.FINE &&
      rule.category !== PayrollRuleCategory.BONUS
    ) {
      continue;
    }
    const kind = rule.category === PayrollRuleCategory.FINE ? 'FINE' : 'BONUS';
    if (rule.calcConfig) {
      // Khoản tự động không thưởng tháng chưa làm ca nào ("≤ 0 lần trễ");
      // khoản chủ ghi nhận tay thì trả theo ghi nhận, như v2.
      if (kind === 'BONUS' && AUTO_RULE_CODES.has(rule.code ?? '') && !hasCompletedWork(facts)) {
        continue;
      }
      const name =
        (typeof rule.name === 'string' && rule.name.trim()) ||
        (kind === 'FINE' ? 'Vi phạm' : 'Thưởng');
      const line = v3RuleLine(rule, facts, name);
      if (line) push(kind, rule, rule.code || 'CUSTOM', line.count, line.exact, line.label);
      continue;
    }
    if (rule.calcMode) {
      const line = v2RuleLine(rule, facts);
      push(kind, rule, rule.code || 'CUSTOM', line.count, line.exact, line.label);
      continue;
    }
    if (kind === 'FINE') {
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
    } else {
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
  const stage = facts.stageCompletion;
  const stageExact = stage ? stage.count * toFiniteNumber(stage.amount) : 0;
  if (stage && stage.count > 0 && stageExact > 0 && Number.isFinite(stageExact)) {
    raw.push({
      kind: 'BONUS',
      ruleId: null,
      ruleType: 'STAGE_COMPLETION',
      label: 'Thưởng hoàn thành giai đoạn',
      count: stage.count,
      amount: 0,
      exact: stageExact,
    });
  }
  return raw;
}

/** Bonus and penalty from the store's active rules (see ruleRawLines). */
export function computeRuleAdjustments(
  rules: PayrollRuleInput[],
  facts: RuleAdjustmentFacts,
  earnedBase: number,
): { bonus: number; penalty: number } {
  let bonus = 0;
  let penalty = 0;
  for (const line of ruleRawLines(rules, facts, earnedBase)) {
    if (line.kind === 'BONUS') bonus += line.exact;
    else penalty += line.exact;
  }
  return { bonus: Math.round(bonus), penalty: Math.round(penalty) };
}

/**
 * The lines behind computeRuleAdjustments, with the same rules and the same
 * totals: rounded lines are reconciled so BONUS lines sum exactly to `bonus`
 * and FINE lines to `penalty`. It does not change how pay is computed.
 */
export function computeRuleAdjustmentBreakdown(
  rules: RuleWithName[],
  facts: RuleAdjustmentFacts,
  earnedBase: number,
): PayslipAdjustmentLine[] {
  const raw = ruleRawLines(rules, facts, earnedBase);
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

/**
 * The employee's pay per hour and per shift, for coefficient rules (hệ số ×
 * giờ / ca). An hourly or per-shift contract converts with the month's
 * average credited shift length (8 h when nothing was worked yet); day, week
 * and month contracts pay one shift per worked day and 8 hours per shift.
 */
export function payRatesOf(input: {
  paymentType: PaymentType | string | null | undefined;
  rate: number;
  standardWorkingDays: number;
  facts: Pick<MonthlyAttendanceFacts, 'workedMinutes' | 'completedShifts'>;
}): { hourly: number; perShift: number; daily: number; monthly: number } {
  const rate = toFiniteNumber(input.rate);
  const shifts = toFiniteNumber(input.facts.completedShifts);
  const minutes = toFiniteNumber(input.facts.workedMinutes);
  const shiftHours = shifts > 0 && minutes > 0 ? minutes / 60 / shifts : 8;
  const days = toFiniteNumber(input.standardWorkingDays) || 26;
  // A day's pay is one shift's pay (one shift per worked day); a month's pay
  // is the contract amount, or a day's pay × the standard working days.
  const withDays = (hourly: number, perShift: number, monthly?: number) => ({
    hourly,
    perShift,
    daily: perShift,
    monthly: monthly ?? perShift * days,
  });
  switch (resolvePayrollPaymentType(input.paymentType)) {
    case PaymentType.HOUR:
      return withDays(rate, rate * shiftHours);
    case PaymentType.SHIFT:
      return withDays(rate / shiftHours, rate);
    case PaymentType.DAY:
      return withDays(rate / 8, rate);
    case PaymentType.WEEK: {
      const perDay = rate / WORKING_DAYS_PER_WEEK;
      return withDays(perDay / 8, perDay);
    }
    default: {
      const perDay = rate / days;
      return withDays(perDay / 8, perDay, rate);
    }
  }
}

/**
 * Pay of each work date, for the "x ngày lương" of bonus / fine rules: a
 * day's shifts differ, so its pay does too. Hourly pay: hourly × the date's
 * scheduled hours (APPROVED / COMPLETED shifts), shared by minutes; per-shift
 * pay: one shift's pay × the date's shifts, shared per shift. Day / week /
 * month pay is the same every day: undefined (rules use the daily rate).
 */
export function dayPayOf(input: {
  paymentType: PaymentType | string | null | undefined;
  rates: { hourly: number; perShift: number };
  assignments: PayrollAssignmentFact[];
}): DayPay | undefined {
  const type = resolvePayrollPaymentType(input.paymentType);
  if (type !== PaymentType.HOUR && type !== PaymentType.SHIFT) return undefined;
  const byDate: Record<string, number> = {};
  const unitsByDate: Record<string, number> = {};
  if (type === PaymentType.HOUR) {
    const hourly = toFiniteNumber(input.rates.hourly);
    for (const [date, minutes] of Object.entries(scheduledMinutesByDate(input.assignments))) {
      byDate[date] = (hourly * minutes) / 60;
      unitsByDate[date] = minutes;
    }
    return { byDate, unitsByDate, unit: 'MINUTE' };
  }
  const perShift = toFiniteNumber(input.rates.perShift);
  for (const a of input.assignments) {
    if (
      a.status !== ShiftAssignmentStatus.APPROVED &&
      a.status !== ShiftAssignmentStatus.COMPLETED
    ) {
      continue;
    }
    const date = workDateOf(a.workDate);
    if (!date) continue;
    byDate[date] = (byDate[date] ?? 0) + perShift;
    unitsByDate[date] = (unitsByDate[date] ?? 0) + 1;
  }
  return { byDate, unitsByDate, unit: 'SHIFT' };
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
  /** The store template's MINUS lines (payslip-rows.utils). */
  extraDeductions?: number;
}): { totalIncome: number; totalDeductions: number; netSalary: number } {
  const totalIncome = Math.round(toFiniteNumber(input.totalIncome));
  const totalDeductions =
    Math.round(toFiniteNumber(input.penalty)) +
    Math.round(toFiniteNumber(input.advancePayment)) +
    Math.round(toFiniteNumber(input.otherDeductions)) +
    Math.round(toFiniteNumber(input.extraDeductions));
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
  /** The store template's PLUS / MINUS lines (payslip-rows.utils). */
  extraIncome?: number;
  extraDeductions?: number;
}): { totalIncome: number; totalDeductions: number; netSalary: number } {
  const totalIncome =
    Math.round(toFiniteNumber(input.earnedBase)) +
    Math.round(toFiniteNumber(input.allowancesTotal)) +
    Math.round(toFiniteNumber(input.bonus)) +
    Math.round(toFiniteNumber(input.extraIncome));
  return computeNetFromIncome({
    totalIncome,
    penalty: input.penalty,
    advancePayment: input.advancePayment,
    otherDeductions: input.otherDeductions,
    extraDeductions: input.extraDeductions,
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
  /** The payslip's template snapshot (removed "Khấu trừ", MINUS lines). */
  payslipRows?: unknown;
}): {
  incomeAfterAdvance: number;
  deductionsExcludingAdvance: number;
  /** The template's MINUS lines, taken after TỔNG THU NHẬP like Khấu trừ. */
  extraDeductions: number;
  isNetClamped: boolean;
} {
  const counted = countedPayslipDeductions(input);
  const incomeAfterAdvance =
    toFiniteNumber(input.totalIncome) - toFiniteNumber(input.advancePayment);
  const deductionsExcludingAdvance = counted.penalty + counted.otherDeductions;
  return {
    incomeAfterAdvance,
    deductionsExcludingAdvance,
    extraDeductions: counted.extraDeductions,
    isNetClamped:
      incomeAfterAdvance - deductionsExcludingAdvance - counted.extraDeductions < 0 &&
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
  /** The store template applied (null: the default payslip). */
  payslipRows: PayslipRowsSnapshot | null;
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
  /**
   * The store's payslip template: removed built-in rows are not paid / taken
   * and its extra lines are added to the income or taken from the net pay.
   */
  payslipRows?: PayslipRowsSnapshot | null;
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
  const template = input.payslipRows ?? null;
  const adjustments = computeRuleAdjustments(
    input.rules,
    input.facts,
    earnedBaseSalary,
  );
  const deductionRemoved = isBuiltinRemoved(template, PayslipBuiltinRow.DEDUCTION);
  const bonus = isBuiltinRemoved(template, PayslipBuiltinRow.BONUS)
    ? 0
    : adjustments.bonus;
  const penalty = deductionRemoved ? 0 : adjustments.penalty;
  const allowancesTotal = isBuiltinRemoved(template, PayslipBuiltinRow.ALLOWANCE)
    ? 0
    : sumAllowances(input.allowances);
  const advancePayment = Math.round(toFiniteNumber(input.advancePayment));
  const otherDeductions = deductionRemoved
    ? 0
    : Math.round(toFiniteNumber(input.otherDeductions));
  const extras = payslipExtraTotals(template);
  const totals = computePayslipTotals({
    earnedBase: earnedBaseSalary,
    allowancesTotal,
    bonus,
    penalty,
    advancePayment,
    otherDeductions,
    extraIncome: extras.additions,
    extraDeductions: extras.deductions,
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
    payslipRows: template,
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
