import { BadRequestException } from '@nestjs/common';

import { vnDateString } from '../../common/utils/vn-calendar';
import { addDays, parseDateOnly } from './shift-schedule.utils';

/** Longest date range one request may cover (inclusive days). */
export const CUSTOM_SHIFT_MAX_RANGE_DAYS = 62;
export const CUSTOM_SHIFT_MIN_MINUTES = 60;
export const CUSTOM_SHIFT_MAX_MINUTES = 16 * 60;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

const invalid = (code: string, message: string) =>
  new BadRequestException({ code, message });

/** `HH:mm[:ss]` → `HH:mm`. */
export const toHHmm = (value: string | null | undefined): string => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ''));
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
};

const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

/** Length in minutes; end <= start is overnight (ends the next day). */
export const customShiftDurationMinutes = (startTime: string, endTime: string) => {
  const start = minutesOf(startTime);
  let end = minutesOf(endTime);
  if (end <= start) end += 24 * 60;
  return end - start;
};

export const isOvernight = (startTime: string, endTime: string) =>
  minutesOf(toHHmm(endTime)) <= minutesOf(toHHmm(startTime));

/** VN wall-clock start of the shift on `date` as an instant. */
export const customShiftStartInstant = (date: string, startTime: string) =>
  new Date(`${date}T${toHHmm(startTime)}:00+07:00`);

/**
 * The dates a request covers: every day of [start, end] whose weekday
 * (0 = Sunday … 6 = Saturday) is in `daysOfWeek`, or every day when null.
 */
export const expandCustomShiftDates = (
  startDate: string,
  endDate: string,
  daysOfWeek: number[] | null,
): string[] => {
  const wanted = daysOfWeek?.length ? new Set(daysOfWeek) : null;
  const dates: string[] = [];
  for (
    let date = startDate;
    date <= endDate && dates.length <= CUSTOM_SHIFT_MAX_RANGE_DAYS;
    date = addDays(date, 1)
  ) {
    if (!wanted || wanted.has(parseDateOnly(date).getUTCDay())) dates.push(date);
  }
  return dates;
};

export interface NormalizedCustomShiftRequest {
  startDate: string;
  endDate: string;
  daysOfWeek: number[] | null;
  startTime: string;
  endTime: string;
  note: string | null;
  dates: string[];
  durationMinutes: number;
}

/**
 * Validate a staff request against the VN calendar. `end < start` is an
 * overnight shift; duration 1–16 h; no past dates (and a first shift that
 * has already started today is refused); range at most 62 days; weekdays
 * only meaningful for a multi-day range and must hit at least one date.
 * daysOfWeek is stored sorted and de-duplicated (null = every day) so the
 * duplicate-PENDING index sees one canonical form.
 */
export function normalizeCustomShiftRequest(
  input: {
    startDate: string;
    endDate?: string | null;
    daysOfWeek?: number[] | null;
    startTime: string;
    endTime: string;
    note?: string | null;
  },
  now: Date = new Date(),
): NormalizedCustomShiftRequest {
  const startDate = input.startDate;
  const endDate = input.endDate || input.startDate;
  try {
    parseDateOnly(startDate);
    parseDateOnly(endDate);
  } catch {
    throw invalid('CUSTOM_SHIFT_INVALID_DATE', 'Ngày không hợp lệ');
  }
  if (!TIME.test(input.startTime ?? '') || !TIME.test(input.endTime ?? '')) {
    throw invalid('CUSTOM_SHIFT_INVALID_TIME', 'Giờ phải có định dạng HH:mm');
  }
  if (input.startTime === input.endTime) {
    throw invalid(
      'CUSTOM_SHIFT_INVALID_TIME',
      'Giờ bắt đầu và giờ kết thúc không được trùng nhau',
    );
  }
  const durationMinutes = customShiftDurationMinutes(
    input.startTime,
    input.endTime,
  );
  if (
    durationMinutes < CUSTOM_SHIFT_MIN_MINUTES ||
    durationMinutes > CUSTOM_SHIFT_MAX_MINUTES
  ) {
    throw invalid(
      'CUSTOM_SHIFT_INVALID_DURATION',
      'Khung giờ phải dài từ 1 đến 16 giờ',
    );
  }
  if (endDate < startDate) {
    throw invalid(
      'CUSTOM_SHIFT_INVALID_RANGE',
      'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu',
    );
  }
  const spanDays =
    Math.round(
      (parseDateOnly(endDate).getTime() - parseDateOnly(startDate).getTime()) /
        86_400_000,
    ) + 1;
  if (spanDays > CUSTOM_SHIFT_MAX_RANGE_DAYS) {
    throw invalid(
      'CUSTOM_SHIFT_INVALID_RANGE',
      `Khoảng ngày tối đa ${CUSTOM_SHIFT_MAX_RANGE_DAYS} ngày`,
    );
  }
  if (startDate < vnDateString(now)) {
    throw invalid('CUSTOM_SHIFT_PAST_DATE', 'Không thể đăng ký ngày đã qua');
  }

  let daysOfWeek: number[] | null = null;
  if (startDate !== endDate && input.daysOfWeek?.length) {
    if (
      input.daysOfWeek.some(
        (day) => !Number.isInteger(day) || day < 0 || day > 6,
      )
    ) {
      throw invalid(
        'CUSTOM_SHIFT_INVALID_WEEKDAYS',
        'Thứ trong tuần phải từ 0 (Chủ nhật) đến 6 (Thứ bảy)',
      );
    }
    const unique = [...new Set(input.daysOfWeek)].sort((a, b) => a - b);
    daysOfWeek = unique.length === 7 ? null : unique;
  }

  const dates = expandCustomShiftDates(startDate, endDate, daysOfWeek);
  if (!dates.length) {
    throw invalid(
      'CUSTOM_SHIFT_NO_DATES',
      'Khoảng ngày không có ngày nào khớp với thứ đã chọn',
    );
  }
  if (customShiftStartInstant(dates[0], input.startTime) <= now) {
    throw invalid(
      'CUSTOM_SHIFT_PAST_DATE',
      'Khung giờ của ngày đầu tiên đã bắt đầu',
    );
  }

  const note = input.note?.trim() || null;
  return {
    startDate,
    endDate,
    daysOfWeek,
    startTime: input.startTime,
    endTime: input.endTime,
    note,
    dates,
    durationMinutes,
  };
}
