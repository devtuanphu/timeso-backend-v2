import { WeekDaySchedule } from './entities/shift-management.entity';
import {
  ShiftMonthlyMode,
  ShiftRecurrenceEndType,
  ShiftRecurrenceFrequency,
} from './shift-schedule.types';
import {
  SHIFT_SCHEDULE_HORIZON_DAYS,
  generateShiftScheduleDates,
  getWeekDayForDate,
} from './shift-schedule.utils';

describe('shift schedule date generation', () => {
  it('generates a daily interval with a fixed occurrence count', () => {
    expect(
      generateShiftScheduleDates('2026-07-13', {
        enabled: true,
        frequency: ShiftRecurrenceFrequency.DAILY,
        interval: 2,
        endType: ShiftRecurrenceEndType.COUNT,
        occurrenceCount: 3,
      }),
    ).toEqual(['2026-07-13', '2026-07-15', '2026-07-17']);
  });

  it('generates selected weekdays inside each weekly interval', () => {
    expect(
      generateShiftScheduleDates('2026-07-13', {
        enabled: true,
        frequency: ShiftRecurrenceFrequency.WEEKLY,
        interval: 1,
        weekDays: [WeekDaySchedule.MONDAY, WeekDaySchedule.WEDNESDAY],
        endType: ShiftRecurrenceEndType.COUNT,
        occurrenceCount: 4,
      }),
    ).toEqual(['2026-07-13', '2026-07-15', '2026-07-20', '2026-07-22']);
  });

  it('uses the last calendar day when a monthly day does not exist', () => {
    expect(
      generateShiftScheduleDates('2026-01-31', {
        enabled: true,
        frequency: ShiftRecurrenceFrequency.MONTHLY,
        interval: 1,
        monthlyMode: ShiftMonthlyMode.DAY_OF_MONTH,
        dayOfMonth: 31,
        endType: ShiftRecurrenceEndType.COUNT,
        occurrenceCount: 3,
      }),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('generates the nth weekday of each month', () => {
    expect(
      generateShiftScheduleDates('2026-01-01', {
        enabled: true,
        frequency: ShiftRecurrenceFrequency.MONTHLY,
        interval: 1,
        monthlyMode: ShiftMonthlyMode.NTH_WEEKDAY,
        weekday: WeekDaySchedule.MONDAY,
        weekOfMonth: 2,
        endType: ShiftRecurrenceEndType.COUNT,
        occurrenceCount: 3,
      }),
    ).toEqual(['2026-01-12', '2026-02-09', '2026-03-09']);
  });

  it('stops on an inclusive end date', () => {
    expect(
      generateShiftScheduleDates('2026-07-13', {
        enabled: true,
        frequency: ShiftRecurrenceFrequency.DAILY,
        interval: 2,
        endType: ShiftRecurrenceEndType.UNTIL,
        endDate: '2026-07-17',
      }),
    ).toEqual(['2026-07-13', '2026-07-15', '2026-07-17']);
  });

  it('creates a rolling 90-day horizon for a never-ending daily schedule', () => {
    const dates = generateShiftScheduleDates('2026-07-13', {
      enabled: true,
      frequency: ShiftRecurrenceFrequency.DAILY,
      interval: 1,
      endType: ShiftRecurrenceEndType.NEVER,
    });

    expect(dates).toHaveLength(SHIFT_SCHEDULE_HORIZON_DAYS);
    expect(dates[0]).toBe('2026-07-13');
    expect(dates.at(-1)).toBe('2026-10-10');
  });

  it('calculates weekdays without depending on the server timezone', () => {
    expect(getWeekDayForDate('2026-07-13')).toBe(WeekDaySchedule.MONDAY);
    expect(getWeekDayForDate('2026-07-19')).toBe(WeekDaySchedule.SUNDAY);
  });
});
