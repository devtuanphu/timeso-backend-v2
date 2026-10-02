/**
 * How worked time is counted for pay ("Cách tính giờ công"), configured by the
 * owner per store or per employee, for a limited period or indefinitely.
 *
 *  - SHIFT  "Tính lương theo ca": only time inside the shift, plus approved
 *           overtime. Arriving early or staying late adds nothing.
 *  - ACTUAL "Làm bao nhiêu trả bấy nhiêu": actual check-in to check-out.
 *
 * A rule applies from `startDate` for one day / week / month or indefinitely.
 * For a shift on a given work date, the newest employee rule covering the date
 * wins, then the newest store-wide rule, then SHIFT.
 */

export type WorkedTimeMode = 'SHIFT' | 'ACTUAL';
export type WorkedTimePeriod = 'DAY' | 'WEEK' | 'MONTH' | 'INDEFINITE';

export const WORKED_TIME_MODES: WorkedTimeMode[] = ['SHIFT', 'ACTUAL'];
export const WORKED_TIME_PERIODS: WorkedTimePeriod[] = [
  'DAY',
  'WEEK',
  'MONTH',
  'INDEFINITE',
];

/** Mode for a store or employee without any rule covering the date. */
export const DEFAULT_WORKED_TIME_MODE: WorkedTimeMode = 'SHIFT';

export interface WorkedTimeRuleLike {
  employeeProfileId?: string | null;
  mode: WorkedTimeMode;
  startDate: string;
  endDate?: string | null;
  createdAt?: Date | string | null;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` of a date column (string or Date at UTC midnight). */
export const toDateKey = (value: string | Date): string =>
  typeof value === 'string'
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10);

const fromParts = (year: number, monthIndex: number, day: number): string => {
  const d = new Date(Date.UTC(year, monthIndex, day));
  return d.toISOString().slice(0, 10);
};

/**
 * Last day a rule applies (inclusive), or null for INDEFINITE.
 * MONTH runs to the day before the same day next month; when next month is
 * shorter (31/01 -> 28/02) it runs to the end of that month.
 */
export function ruleEndDate(
  startDate: string,
  period: WorkedTimePeriod,
): string | null {
  if (!DATE_KEY.test(startDate))
    throw new Error(`Invalid start date ${startDate}`);
  const [y, m, d] = startDate.split('-').map(Number);
  switch (period) {
    case 'DAY':
      return startDate;
    case 'WEEK':
      return fromParts(y, m - 1, d + 6);
    case 'MONTH': {
      const lastOfNext = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      if (d > lastOfNext) return fromParts(y, m, lastOfNext);
      return fromParts(y, m, d - 1);
    }
    case 'INDEFINITE':
      return null;
  }
}

/** Whether the rule applies on the work date (`YYYY-MM-DD`). */
export function ruleCovers(
  rule: WorkedTimeRuleLike,
  workDate: string,
): boolean {
  const start = toDateKey(rule.startDate);
  const end = rule.endDate ? toDateKey(rule.endDate) : null;
  return workDate >= start && (end === null || workDate <= end);
}

const createdMs = (rule: WorkedTimeRuleLike) =>
  rule.createdAt ? new Date(rule.createdAt).getTime() : 0;

/** The rule deciding the mode on that date for that employee, or null. */
export function resolveWorkedTimeRule<T extends WorkedTimeRuleLike>(
  rules: T[],
  employeeProfileId: string | null | undefined,
  workDate: string,
): T | null {
  const covering = rules.filter((rule) => ruleCovers(rule, workDate));
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

/** Mode for a shift of that employee on that work date. */
export function resolveWorkedTimeMode(
  rules: WorkedTimeRuleLike[],
  employeeProfileId: string | null | undefined,
  workDate: string,
): WorkedTimeMode {
  return (
    resolveWorkedTimeRule(rules, employeeProfileId, workDate)?.mode ??
    DEFAULT_WORKED_TIME_MODE
  );
}
