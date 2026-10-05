/**
 * How worked time is counted for pay ("Cách tính giờ công"), configured by the
 * owner per store or per employee, from a date and time, for a limited period
 * or indefinitely.
 *
 *  - SHIFT  "Tính theo lịch làm": only time inside the scheduled shift, plus
 *           approved overtime. Arriving early or staying late adds nothing.
 *  - ACTUAL "Tính theo giờ chấm công": actual check-in to check-out (a
 *           forgotten check-out counts to the scheduled end).
 *
 * A shift belongs to a rule by its scheduled start (Vietnam wall clock,
 * `YYYY-MM-DD HH:mm` keys compared as strings). A rule covers the shifts
 * starting in [start, end); a removed rule keeps covering the shifts that
 * started before it was removed, so a change never touches a shift already
 * under way or done. For a shift, the newest covering employee rule wins, then
 * the newest covering store-wide rule, then the default.
 */

import { vnClockHHmm, vnDateString } from '../../common/utils/vn-calendar';

export type WorkedTimeMode = 'SHIFT' | 'ACTUAL';
export type WorkedTimePeriod = 'DAY' | 'WEEK' | 'MONTH' | 'INDEFINITE';

export const WORKED_TIME_MODES: WorkedTimeMode[] = ['SHIFT', 'ACTUAL'];
export const WORKED_TIME_PERIODS: WorkedTimePeriod[] = [
  'DAY',
  'WEEK',
  'MONTH',
  'INDEFINITE',
];

/**
 * Without a rule, shifts starting at or after this moment (Vietnam wall
 * clock) are paid "theo giờ chấm công"; earlier shifts keep "theo lịch làm",
 * the default before this release. Set to when this release goes live.
 */
export const ACTUAL_DEFAULT_FROM = '2026-10-04 00:40';

/** Mode of a shift no rule covers. */
export const defaultWorkedTimeMode = (shiftKey: string): WorkedTimeMode =>
  shiftKey >= ACTUAL_DEFAULT_FROM ? 'ACTUAL' : 'SHIFT';

export interface WorkedTimeRuleLike {
  employeeProfileId?: string | null;
  mode: WorkedTimeMode;
  startDate: string | Date;
  /** `HH:mm`; missing = 00:00. */
  startTime?: string | null;
  /** With `endTime`: exclusive end. Without (legacy rows): last day, inclusive. */
  endDate?: string | Date | null;
  endTime?: string | null;
  createdAt?: Date | string | null;
  /** A removed rule stops covering shifts that start from this instant. */
  deletedAt?: Date | string | null;
}

export const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_KEY = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `YYYY-MM-DD` of a date column (string, or a Date read from one). */
export const toDateKey = (value: string | Date): string =>
  typeof value === 'string' ? value.slice(0, 10) : vnDateString(value);

/** `HH:mm` of a time column (`HH:mm` or `HH:mm:ss`); missing = 00:00. */
export const toTimeKey = (value?: string | null): string =>
  value ? String(value).slice(0, 5) : '00:00';

export const toRuleKey = (date: string | Date, time?: string | null) =>
  `${toDateKey(date)} ${toTimeKey(time)}`;

/** Key of a shift: its work date and scheduled start time. */
export const shiftStartKey = (
  workDate: string | Date | null | undefined,
  startTime?: string | null,
): string | null => (workDate ? toRuleKey(workDate, startTime) : null);

/** Vietnam wall clock of an instant, rounded up to the next whole minute. */
export const vnKeyCeil = (instant: Date): string => {
  const up = new Date(Math.ceil(instant.getTime() / 60_000) * 60_000);
  return `${vnDateString(up)} ${vnClockHHmm(up)}`;
};

const addDays = (dateKey: string, days: number): string => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/**
 * Exclusive end of a rule starting at `startDate startTime`, or null for
 * INDEFINITE: a day, a week, or the same day and time next month (the last
 * day of a shorter month: 31/01 -> 28/02).
 */
export function ruleWindowEnd(
  startDate: string,
  startTime: string,
  period: WorkedTimePeriod,
): { endDate: string; endTime: string } | null {
  if (!DATE_KEY.test(startDate))
    throw new Error(`Invalid start date ${startDate}`);
  switch (period) {
    case 'DAY':
      return { endDate: addDays(startDate, 1), endTime: startTime };
    case 'WEEK':
      return { endDate: addDays(startDate, 7), endTime: startTime };
    case 'MONTH': {
      const [y, m, d] = startDate.split('-').map(Number);
      const lastOfNext = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const endDate = new Date(Date.UTC(y, m, Math.min(d, lastOfNext)))
        .toISOString()
        .slice(0, 10);
      return { endDate, endTime: startTime };
    }
    case 'INDEFINITE':
      return null;
  }
}

/** Start, exclusive end and removal cut of a rule, as keys. */
export function ruleBounds(rule: WorkedTimeRuleLike): {
  start: string;
  end: string | null;
  cut: string | null;
} {
  let end: string | null = null;
  if (rule.endDate) {
    end = rule.endTime
      ? toRuleKey(rule.endDate, rule.endTime)
      : // Legacy row: end_date was the last day covered.
        `${addDays(toDateKey(rule.endDate), 1)} 00:00`;
  }
  return {
    start: toRuleKey(rule.startDate, rule.startTime),
    end,
    cut: rule.deletedAt ? vnKeyCeil(new Date(rule.deletedAt)) : null,
  };
}

/**
 * Whether two rules' windows share a moment ([start, end), no end = open).
 * Only one rule may be in force at a time for the whole store, and only one
 * for each employee (an employee rule may sit inside a store-wide one).
 */
export function ruleWindowsOverlap(
  a: { start: string; end: string | null },
  b: { start: string; end: string | null },
): boolean {
  return (
    (b.end === null || a.start < b.end) && (a.end === null || b.start < a.end)
  );
}

/** Whether the rule covers a shift starting at `shiftKey`. */
export function ruleCovers(
  rule: WorkedTimeRuleLike,
  shiftKey: string,
): boolean {
  const { start, end, cut } = ruleBounds(rule);
  return (
    shiftKey >= start &&
    (end === null || shiftKey < end) &&
    (cut === null || shiftKey < cut)
  );
}

const createdMs = (rule: WorkedTimeRuleLike) =>
  rule.createdAt ? new Date(rule.createdAt).getTime() : 0;

/** The rule deciding the mode of that employee's shift, or null. */
export function resolveWorkedTimeRule<T extends WorkedTimeRuleLike>(
  rules: T[],
  employeeProfileId: string | null | undefined,
  shiftKey: string,
): T | null {
  const covering = rules.filter((rule) => ruleCovers(rule, shiftKey));
  const newest = (list: T[]) =>
    list.reduce<T | null>(
      (best, rule) =>
        !best || createdMs(rule) >= createdMs(best) ? rule : best,
      null,
    );
  const own = employeeProfileId
    ? newest(
        covering.filter((rule) => rule.employeeProfileId === employeeProfileId),
      )
    : null;
  return own ?? newest(covering.filter((rule) => !rule.employeeProfileId));
}

/** Mode of that employee's shift starting at `shiftKey`. */
export function resolveWorkedTimeMode(
  rules: WorkedTimeRuleLike[],
  employeeProfileId: string | null | undefined,
  shiftKey: string,
): WorkedTimeMode {
  return (
    resolveWorkedTimeRule(rules, employeeProfileId, shiftKey)?.mode ??
    defaultWorkedTimeMode(shiftKey)
  );
}
