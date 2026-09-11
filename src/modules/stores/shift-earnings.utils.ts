import { PaymentType } from './entities/employee-contract.entity';

/**
 * Earnings for a single shift, by contract payment type.
 *
 * This existed as two near-identical `switch` statements that had drifted:
 * the estimate shown to staff when browsing shifts divided a weekly salary by
 * 7, while the amount actually persisted at check-out divided it by 6 — a
 * ~16.7% gap between the quoted and the paid figure for every weekly-paid
 * shift. Both call sites now share this function so the two can no longer
 * disagree.
 *
 * The weekly divisor is 6, matching what the payroll path has always
 * persisted (a six-day working week). Aligning the other direction would have
 * changed money that has already been paid out.
 */

/** Working days in a week, per the payroll rule this codebase has applied. */
export const WORKING_DAYS_PER_WEEK = 6;

export interface ShiftEarningsInput {
  paymentType: PaymentType | null | undefined;
  /** Contract salary for the payment period. */
  baseSalary: number;
  /** Hours attributable to this shift — scheduled for an estimate, worked for payroll. */
  hours: number;
  /**
   * Date the shift belongs to. Only used by the MONTH branch, to size the
   * month. Pass the shift's work date for an estimate and the check-out
   * instant for payroll.
   */
  referenceDate: Date;
  /**
   * Standard working days in the month, from the store's configured days off.
   * Omitted means the store has no weekly schedule, in which case the calendar
   * day count is used and behaviour is unchanged.
   */
  workingDaysInMonth?: number | null;
}

/** Calendar days in the month containing `date`. */
function daysInMonthOf(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * Returns `null` when the contract has no payment type this rule covers.
 * Callers differ in what that should mean — the estimate shows 0, the payroll
 * path leaves the stored figure untouched — so the decision stays with them
 * rather than being flattened to 0 here.
 */
export function calculateShiftEarnings(
  input: ShiftEarningsInput,
): number | null {
  const base = Number(input.baseSalary);
  if (!Number.isFinite(base) || base <= 0) return 0;

  switch (input.paymentType) {
    case PaymentType.HOUR: {
      const hours = Number(input.hours);
      if (!Number.isFinite(hours) || hours <= 0) return 0;
      return Math.round(base * hours);
    }

    case PaymentType.SHIFT:
    case PaymentType.DAY:
      return Math.round(base);

    case PaymentType.WEEK:
      return Math.round(base / WORKING_DAYS_PER_WEEK);

    case PaymentType.MONTH: {
      // Prorated across the store's WORKING days, not calendar days, so an
      // employee who works every scheduled shift earns their full monthly
      // salary. Falls back to the calendar count when the store has no weekly
      // schedule configured, which keeps such stores on their previous figures.
      const days =
        input.workingDaysInMonth && input.workingDaysInMonth > 0
          ? input.workingDaysInMonth
          : daysInMonthOf(input.referenceDate);
      if (days <= 0) return 0;
      return Math.round(base / days);
    }

    default:
      return null;
  }
}
