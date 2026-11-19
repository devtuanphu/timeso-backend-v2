import { PaymentType } from './entities/employee-contract.entity';
import {
  payRatesOf,
  resolvePayrollPaymentType,
} from './payroll-calculation.utils';

/**
 * One active OVERTIME bonus rule (Thiết lập tính lương), already scoped by the
 * caller to the shift's Vietnam day and the employee. Only `calcMode` and
 * `value` drive the amount here.
 */
export interface OvertimePayRule {
  /** v2 calc mode (COEF_PER_HOUR, AMOUNT_PER_SHIFT…); null = legacy, pays 0. */
  calcMode: string | null;
  /** Coefficient (× the employee's pay) or flat amount, by `calcMode`. */
  value: number | string | null | undefined;
}

export interface EstimateShiftOvertimePayInput {
  /** Contract payment type (Giờ/Ca/Ngày/Tuần/Tháng); unknown → Tháng. */
  paymentType: PaymentType | string | null | undefined;
  /** The wage rate `estimateAssignmentSalary` chose (contract / store wage rate). */
  rate: number;
  /** Store's standard working days of the shift's month (monthly rate basis). */
  standardWorkingDays: number | null | undefined;
  /** Scheduled minutes of the shift's effective window (NOT including overtime). */
  plannedMinutes: number;
  /** Approved overtime minutes `M` of this shift (0 when none worked yet). */
  overtimeMinutes: number;
  /** Active OVERTIME bonus rules of the store applying this day + employee. */
  rules: OvertimePayRule[];
}

const toNum = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Overtime pay of ONE shift, estimated the way the monthly payslip pays
 * overtime — never the old `withOT − withoutOT` subtraction (which is 0 for
 * Ca/Ngày/Tuần/Tháng because `calculateShiftEarnings` never multiplies by
 * hours). Returns whole VND (≥ 0).
 *
 * - Base (only Giờ / HOUR): the credited overtime minutes already raise the
 *   worked time that an hourly contract is paid on, so the base overtime pay
 *   is `hourly × M/60`. Ca/Ngày/Tuần/Tháng credit no extra base for the
 *   overtime minutes — only the OVERTIME rules below pay for them.
 * - Each OVERTIME bonus rule adds, by its `calcMode`:
 *     COEF_PER_HOUR   → value × hourly × M/60
 *     AMOUNT_PER_HOUR → value × M/60
 *     COEF_PER_SHIFT  → value × perShift  (only when M > 0)
 *     AMOUNT_PER_SHIFT→ value             (only when M > 0)
 *   MILESTONE_* / legacy (`calcMode` null) / unknown pay nothing: they cannot
 *   be reduced to a single shift.
 *
 * Pure: no I/O, no clock. The caller decides `null` (no approved overtime /
 * on leave / no active contract or rate ≤ 0); this only returns the amount.
 */
export function estimateShiftOvertimePay(
  input: EstimateShiftOvertimePayInput,
): number {
  const overtimeMinutes = Math.max(0, Math.round(toNum(input.overtimeMinutes)));
  const rates = payRatesOf({
    paymentType: input.paymentType,
    rate: toNum(input.rate),
    standardWorkingDays: toNum(input.standardWorkingDays),
    facts: {
      workedMinutes: Math.max(0, toNum(input.plannedMinutes)),
      completedShifts: 1,
    },
  });
  const hourly = rates.hourly;
  const perShift = rates.perShift;
  const hours = overtimeMinutes / 60;
  const isHourly =
    resolvePayrollPaymentType(input.paymentType) === PaymentType.HOUR;

  let amount = isHourly ? hourly * hours : 0;
  for (const rule of input.rules ?? []) {
    const value = toNum(rule.value);
    switch (rule.calcMode) {
      case 'COEF_PER_HOUR':
        amount += value * hourly * hours;
        break;
      case 'AMOUNT_PER_HOUR':
        amount += value * hours;
        break;
      case 'COEF_PER_SHIFT':
        amount += overtimeMinutes > 0 ? value * perShift : 0;
        break;
      case 'AMOUNT_PER_SHIFT':
        amount += overtimeMinutes > 0 ? value : 0;
        break;
      default:
        // MILESTONE_HOURS / MILESTONE_SHIFTS / null (legacy) / unknown: 0.
        break;
    }
  }
  return Math.max(0, Math.round(amount));
}
