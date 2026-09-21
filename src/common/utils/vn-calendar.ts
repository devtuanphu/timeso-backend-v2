/**
 * Vietnam calendar helpers for payroll and reports.
 *
 * Months and days in this product are Vietnamese calendar months and days,
 * whatever timezone the server process runs in. Deriving them from
 * `new Date()` with local getters, `setHours`, or `toISOString().slice(0, 10)`
 * made the result depend on the host: on a UTC host the 00:10 VN cron on the
 * 1st still saw the previous month, and at +07 `toISOString` gave the previous
 * day.
 *
 * Every helper here works from a fixed +07:00 offset (Vietnam has no DST, the
 * same approach as `attendance-time.utils.ts`) and from explicit
 * `YYYY-MM-DD` strings. The only local-time values produced are the "markers"
 * from `toMonthMarker` / `toDateMarker`: TypeORM and node-pg serialize a Date
 * bound to a `date` column with local getters, so a local-midnight marker is
 * stored as the intended calendar date on any host.
 */

export const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

export interface VnMonth {
  year: number;
  /** 1-12 */
  month: number;
  /** 0-11 */
  monthIndex: number;
  /** First day of the month, 'YYYY-MM-01'. */
  key: string;
  /** 'YYYY-MM' */
  label: string;
  /** First day of the next month, 'YYYY-MM-DD'. */
  endExclusiveDate: string;
  /** Last day of the month, 'YYYY-MM-DD'. */
  lastDate: string;
  calendarDays: number;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The Vietnam calendar date of an instant, as 'YYYY-MM-DD'. */
export function vnDateString(instant: Date = new Date()): string {
  return new Date(instant.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Builds a month from a year and a 1-12 month; null when out of range. */
export function vnMonthFromParts(
  year: number,
  month1to12: number,
): VnMonth | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month1to12) ||
    year < 1900 ||
    year > 9999 ||
    month1to12 < 1 ||
    month1to12 > 12
  ) {
    return null;
  }
  const monthIndex = month1to12 - 1;
  const calendarDays = new Date(
    Date.UTC(year, monthIndex + 1, 0),
  ).getUTCDate();
  const nextYear = month1to12 === 12 ? year + 1 : year;
  const nextMonth = month1to12 === 12 ? 1 : month1to12 + 1;
  const label = `${year}-${pad2(month1to12)}`;
  return {
    year,
    month: month1to12,
    monthIndex,
    key: `${label}-01`,
    label,
    endExclusiveDate: `${nextYear}-${pad2(nextMonth)}-01`,
    lastDate: `${label}-${pad2(calendarDays)}`,
    calendarDays,
  };
}

/** The Vietnam month containing an instant (defaults to now). */
export function vnMonthOf(instant: Date = new Date()): VnMonth {
  const date = vnDateString(instant);
  return vnMonthFromParts(Number(date.slice(0, 4)), Number(date.slice(5, 7)))!;
}

/**
 * The month of a calendar date string such as `slot.workDate` or a report
 * date. Only the first 10 characters ('YYYY-MM-DD') are read.
 */
export function vnMonthOfDateString(
  date: string | null | undefined,
): VnMonth | null {
  if (typeof date !== 'string') return null;
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;
  const day = Number(match[3]);
  if (day < 1 || day > 31) return null;
  return vnMonthFromParts(Number(match[1]), Number(match[2]));
}

/** Moves a month forwards or backwards by whole months. */
export function shiftVnMonth(m: VnMonth, deltaMonths: number): VnMonth {
  const total = m.year * 12 + m.monthIndex + Math.trunc(deltaMonths);
  return vnMonthFromParts(Math.floor(total / 12), (total % 12) + 1)!;
}

/**
 * Parses the month formats the API receives:
 * - 'MM/YYYY', 'M/YYYY', 'YYYY-MM', 'YYYY-MM-DD' → that literal month;
 * - an ISO datetime string or a Date → the Vietnam month of that instant;
 * - null, undefined, '' → null; anything invalid → null.
 */
export function parseVnMonthInput(
  input: string | Date | null | undefined,
): VnMonth | null {
  if (input === null || input === undefined) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : vnMonthOf(input);
  }
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value) return null;

  let match = /^(\d{1,2})\/(\d{4})$/.exec(value);
  if (match) return vnMonthFromParts(Number(match[2]), Number(match[1]));

  match = /^(\d{4})-(\d{2})$/.exec(value);
  if (match) return vnMonthFromParts(Number(match[1]), Number(match[2]));

  match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    const day = Number(match[3]);
    if (day < 1 || day > 31) return null;
    return vnMonthFromParts(Number(match[1]), Number(match[2]));
  }

  // Full datetime: interpret the instant in Vietnam time.
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const instant = new Date(value);
    return Number.isNaN(instant.getTime()) ? null : vnMonthOf(instant);
  }
  return null;
}

/**
 * Local-midnight marker for the first of the month, for Date-typed `date`
 * columns (`month` on payroll, salary and summary tables).
 */
export function toMonthMarker(m: VnMonth): Date {
  return new Date(m.year, m.monthIndex, 1);
}

/** Local-midnight marker for a 'YYYY-MM-DD' calendar date. */
export function toDateMarker(date: string): Date {
  const match = DATE_PATTERN.exec(date);
  if (!match) return new Date(NaN);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Wall-clock 'HH:mm' of an instant in Vietnam. */
export function vnClockHHmm(instant: Date): string {
  return new Date(instant.getTime() + VN_OFFSET_MS).toISOString().slice(11, 16);
}

/**
 * Noon, Vietnam time, on a 'YYYY-MM-DD' date: an instant that falls on that
 * Vietnam date whatever the host timezone. Useful as a `referenceDate` for
 * helpers that read the Vietnam month of an instant.
 */
export function vnMiddayInstant(date: string): Date {
  const match = DATE_PATTERN.exec(date);
  if (!match) return new Date(NaN);
  return new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00+07:00`);
}
