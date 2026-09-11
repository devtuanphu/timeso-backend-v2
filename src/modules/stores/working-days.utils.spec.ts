import { WeekDay } from './entities/store-shift-config.entity';
import {
  calendarDaysInMonth,
  countWorkingDaysInMonth,
  resolveDaysOffIndices,
} from './working-days.utils';

/** (year, zero-based month) for the month under test. */
const inMonth = (year: number, month1Based: number) =>
  [year, month1Based - 1] as const;

describe('resolveDaysOffIndices', () => {
  it('maps each weekday to its getUTCDay index', () => {
    expect([...resolveDaysOffIndices([WeekDay.SUNDAY])]).toEqual([0]);
    expect([...resolveDaysOffIndices([WeekDay.MONDAY])]).toEqual([1]);
    expect([...resolveDaysOffIndices([WeekDay.SATURDAY])]).toEqual([6]);
  });

  // The enum carries a composite value meaning both weekend days.
  it('expands SATURDAY_SUNDAY to both days', () => {
    expect([...resolveDaysOffIndices([WeekDay.SATURDAY_SUNDAY])].sort()).toEqual(
      [0, 6],
    );
  });

  it('deduplicates overlapping configurations', () => {
    expect(
      [
        ...resolveDaysOffIndices([
          WeekDay.SATURDAY,
          WeekDay.SATURDAY_SUNDAY,
          WeekDay.SUNDAY,
        ]),
      ].sort(),
    ).toEqual([0, 6]);
  });

  it('ignores missing or unknown values', () => {
    expect(resolveDaysOffIndices(null).size).toBe(0);
    expect(resolveDaysOffIndices(undefined).size).toBe(0);
    expect(resolveDaysOffIndices(['NOT_A_DAY' as WeekDay]).size).toBe(0);
  });
});

describe('countWorkingDaysInMonth', () => {
  // May 2026 has 31 days and begins on a Friday: 5 Saturdays, 5 Sundays.
  it('excludes a single weekly day off', () => {
    expect(calendarDaysInMonth(...inMonth(2026, 5))).toBe(31);
    expect(countWorkingDaysInMonth(...inMonth(2026, 5), [WeekDay.SUNDAY])).toBe(26);
  });

  it('excludes a two-day weekend', () => {
    expect(
      countWorkingDaysInMonth(...inMonth(2026, 5), [
        WeekDay.SATURDAY,
        WeekDay.SUNDAY,
      ]),
    ).toBe(21);
    // The composite value must give the same answer.
    expect(
      countWorkingDaysInMonth(...inMonth(2026, 5), [WeekDay.SATURDAY_SUNDAY]),
    ).toBe(21);
  });

  it('varies correctly with month length', () => {
    // February 2026: 28 days, starts Sunday -> 4 Sundays.
    expect(countWorkingDaysInMonth(...inMonth(2026, 2), [WeekDay.SUNDAY])).toBe(24);
    // February 2024: 29 days, leap year.
    expect(calendarDaysInMonth(...inMonth(2024, 2))).toBe(29);
  });

  // A store with no weekly schedule must keep its previous payroll behaviour
  // rather than silently changing.
  it('falls back to calendar days when nothing is configured', () => {
    expect(countWorkingDaysInMonth(...inMonth(2026, 5), [])).toBe(31);
    expect(countWorkingDaysInMonth(...inMonth(2026, 5), null)).toBe(31);
  });

  // Otherwise this would be a division by zero downstream.
  it('never returns zero for a store marked closed every day', () => {
    const everyDay = [
      WeekDay.MONDAY,
      WeekDay.TUESDAY,
      WeekDay.WEDNESDAY,
      WeekDay.THURSDAY,
      WeekDay.FRIDAY,
      WeekDay.SATURDAY,
      WeekDay.SUNDAY,
    ];
    expect(countWorkingDaysInMonth(...inMonth(2026, 5), everyDay)).toBe(31);
  });

  it('does not depend on the host timezone', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const utc = countWorkingDaysInMonth(...inMonth(2026, 5), [WeekDay.SUNDAY]);
      process.env.TZ = 'Pacific/Kiritimati'; // UTC+14
      const ahead = countWorkingDaysInMonth(...inMonth(2026, 5), [WeekDay.SUNDAY]);
      process.env.TZ = 'Pacific/Midway'; // UTC-11
      const behind = countWorkingDaysInMonth(...inMonth(2026, 5), [WeekDay.SUNDAY]);
      expect(utc).toBe(26);
      expect(ahead).toBe(26);
      expect(behind).toBe(26);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
