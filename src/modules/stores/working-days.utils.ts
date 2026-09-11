import { WeekDay } from './entities/store-shift-config.entity';

/**
 * Standard working days in a month, derived from the store's weekly days off.
 *
 * Monthly salary used to be prorated across *calendar* days (28-31), so an
 * employee on a monthly contract who worked every scheduled shift still
 * received only 71-84% of their contracted salary, and a different amount in
 * February than in March for identical work.
 *
 * The denominator is now the store's actual working days, derived from
 * `StoreShiftConfig.daysOff`, which already records which weekdays each store
 * is closed. No new column and no migration are needed.
 *
 * All date maths is done in UTC so the result cannot shift with the host
 * timezone — a month's weekday layout is a calendar fact, not a clock reading.
 */

/** `Date#getUTCDay()` indices: 0 = Sunday … 6 = Saturday. */
const WEEKDAY_INDEX: Record<Exclude<WeekDay, WeekDay.SATURDAY_SUNDAY>, number> =
  {
    [WeekDay.SUNDAY]: 0,
    [WeekDay.MONDAY]: 1,
    [WeekDay.TUESDAY]: 2,
    [WeekDay.WEDNESDAY]: 3,
    [WeekDay.THURSDAY]: 4,
    [WeekDay.FRIDAY]: 5,
    [WeekDay.SATURDAY]: 6,
  };

/**
 * Expands the configured days off to weekday indices.
 * `SATURDAY_SUNDAY` is a composite value meaning both days.
 */
export function resolveDaysOffIndices(
  daysOff: WeekDay[] | null | undefined,
): Set<number> {
  const indices = new Set<number>();
  for (const day of daysOff ?? []) {
    if (day === WeekDay.SATURDAY_SUNDAY) {
      indices.add(WEEKDAY_INDEX[WeekDay.SATURDAY]);
      indices.add(WEEKDAY_INDEX[WeekDay.SUNDAY]);
      continue;
    }
    const index = WEEKDAY_INDEX[day as Exclude<WeekDay, WeekDay.SATURDAY_SUNDAY>];
    if (index !== undefined) indices.add(index);
  }
  return indices;
}

/**
 * Calendar days in the given month.
 *
 * Takes an explicit year and zero-based month rather than a `Date`, because the
 * payroll code constructs its month markers with `new Date(y, m, 1)` in local
 * time: reading such a value with UTC accessors lands in the previous month for
 * any host ahead of UTC, and with local accessors it would depend on the host.
 * An explicit (year, month) pair has neither problem.
 */
export function calendarDaysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Reads a local-time month marker (`new Date(y, m, 1)`) into its parts. */
export function monthPartsOf(reference: Date): {
  year: number;
  monthIndex: number;
} {
  return {
    year: reference.getFullYear(),
    monthIndex: reference.getMonth(),
  };
}

/**
 * Working days in the month containing `reference`, excluding the store's
 * configured days off.
 *
 * Returns the calendar-day count when no days off are configured, so a store
 * that has not set a weekly schedule keeps the previous behaviour rather than
 * silently changing its payroll.
 *
 * Never returns 0 — a store configured as closed every day would otherwise
 * divide by zero. In that case the calendar count is used instead.
 */
export function countWorkingDaysInMonth(
  year: number,
  monthIndex: number,
  daysOff: WeekDay[] | null | undefined,
): number {
  const totalDays = calendarDaysInMonth(year, monthIndex);
  const offIndices = resolveDaysOffIndices(daysOff);
  if (offIndices.size === 0) return totalDays;

  let workingDays = 0;
  for (let day = 1; day <= totalDays; day += 1) {
    const weekday = new Date(Date.UTC(year, monthIndex, day)).getUTCDay();
    if (!offIndices.has(weekday)) workingDays += 1;
  }

  return workingDays > 0 ? workingDays : totalDays;
}

/** Convenience for the codebase's local-time month markers. */
export function countWorkingDaysForMonthDate(
  reference: Date,
  daysOff: WeekDay[] | null | undefined,
): number {
  const { year, monthIndex } = monthPartsOf(reference);
  return countWorkingDaysInMonth(year, monthIndex, daysOff);
}
