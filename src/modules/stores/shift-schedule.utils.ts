import { BadRequestException } from '@nestjs/common';
import { WeekDaySchedule } from './entities/shift-management.entity';
import {
  ShiftMonthlyMode,
  ShiftRecurrenceEndType,
  ShiftRecurrenceFrequency,
  ShiftRecurrenceRule,
} from './shift-schedule.types';

export const SHIFT_SCHEDULE_HORIZON_DAYS = 90;
const MAX_GENERATED_OCCURRENCES = 1000;
const MAX_SCAN_DAYS = 366 * 100;

const WEEK_DAYS: WeekDaySchedule[] = [
  WeekDaySchedule.SUNDAY,
  WeekDaySchedule.MONDAY,
  WeekDaySchedule.TUESDAY,
  WeekDaySchedule.WEDNESDAY,
  WeekDaySchedule.THURSDAY,
  WeekDaySchedule.FRIDAY,
  WeekDaySchedule.SATURDAY,
];

export function parseDateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new BadRequestException('Ngày phải có định dạng YYYY-MM-DD');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new BadRequestException('Ngày không hợp lệ');
  }

  return parsed;
}

export function formatDateOnly(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function addDays(dateString: string, amount: number): string {
  const date = parseDateOnly(dateString);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatDateOnly(date);
}

export function getWeekDayForDate(dateString: string): WeekDaySchedule {
  return WEEK_DAYS[parseDateOnly(dateString).getUTCDay()];
}

export function getTodayDateString(timeZone = 'Asia/Ho_Chi_Minh'): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function daysBetween(startDate: string, dateString: string): number {
  return Math.floor(
    (parseDateOnly(dateString).getTime() - parseDateOnly(startDate).getTime()) /
      86_400_000,
  );
}

function startOfWeek(dateString: string): string {
  const date = parseDateOnly(dateString);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return formatDateOnly(date);
}

function monthsBetween(startDate: string, dateString: string): number {
  const start = parseDateOnly(startDate);
  const date = parseDateOnly(dateString);
  return (
    (date.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    date.getUTCMonth() -
    start.getUTCMonth()
  );
}

function daysInMonth(date: Date): number {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

function isNthWeekdayOfMonth(
  dateString: string,
  weekday: WeekDaySchedule,
  weekOfMonth: number,
): boolean {
  const date = parseDateOnly(dateString);
  if (getWeekDayForDate(dateString) !== weekday) return false;
  return Math.floor((date.getUTCDate() - 1) / 7) + 1 === weekOfMonth;
}

export function matchesShiftRecurrence(
  dateString: string,
  startDate: string,
  rule: ShiftRecurrenceRule,
): boolean {
  if (dateString < startDate) return false;
  if (!rule.enabled) return dateString === startDate;

  switch (rule.frequency) {
    case ShiftRecurrenceFrequency.DAILY:
      return daysBetween(startDate, dateString) % rule.interval === 0;

    case ShiftRecurrenceFrequency.WEEKLY: {
      const selectedDays = rule.weekDays || [];
      const weekOffset = Math.floor(
        daysBetween(startOfWeek(startDate), startOfWeek(dateString)) / 7,
      );
      return (
        weekOffset % rule.interval === 0 &&
        selectedDays.includes(getWeekDayForDate(dateString))
      );
    }

    case ShiftRecurrenceFrequency.MONTHLY: {
      if (monthsBetween(startDate, dateString) % rule.interval !== 0) {
        return false;
      }

      const date = parseDateOnly(dateString);
      if (rule.monthlyMode === ShiftMonthlyMode.DAY_OF_MONTH) {
        const requestedDay = rule.dayOfMonth || 1;
        return date.getUTCDate() === Math.min(requestedDay, daysInMonth(date));
      }

      return isNthWeekdayOfMonth(
        dateString,
        rule.weekday as WeekDaySchedule,
        rule.weekOfMonth as number,
      );
    }

    default:
      return false;
  }
}

export function generateShiftScheduleDates(
  startDate: string,
  rule: ShiftRecurrenceRule,
): string[] {
  parseDateOnly(startDate);

  if (!rule.enabled) return [startDate];

  const targetCount =
    rule.endType === ShiftRecurrenceEndType.COUNT
      ? Math.min(rule.occurrenceCount || 0, MAX_GENERATED_OCCURRENCES)
      : MAX_GENERATED_OCCURRENCES;
  const endDate =
    rule.endType === ShiftRecurrenceEndType.UNTIL
      ? (rule.endDate as string)
      : rule.endType === ShiftRecurrenceEndType.NEVER
        ? addDays(startDate, SHIFT_SCHEDULE_HORIZON_DAYS - 1)
        : null;

  if (endDate) parseDateOnly(endDate);

  const dates: string[] = [];
  let current = startDate;
  let scannedDays = 0;

  while (scannedDays <= MAX_SCAN_DAYS) {
    if (endDate && current > endDate) break;
    if (dates.length >= targetCount) break;

    if (matchesShiftRecurrence(current, startDate, rule)) {
      dates.push(current);
    }

    current = addDays(current, 1);
    scannedDays += 1;
  }

  if (dates.length === 0) {
    throw new BadRequestException(
      'Quy tắc lặp không tạo ra ngày làm việc nào trong khoảng đã chọn',
    );
  }

  if (
    rule.endType === ShiftRecurrenceEndType.COUNT &&
    dates.length < (rule.occurrenceCount || 0)
  ) {
    throw new BadRequestException('Không thể tạo đủ số lần lặp đã chọn');
  }

  return dates;
}
