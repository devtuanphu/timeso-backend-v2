/**
 * Cửa sổ thời gian của lộ trình v2, theo lịch Việt Nam bất kể múi giờ của
 * tiến trình (cùng cách của common/utils/vn-calendar.ts).
 *
 * - Điều kiện "ca/tháng", "giờ/tháng" của bộ phận đo trên tháng dương lịch VN
 *   gần nhất ĐÃ KẾT THÚC (D4): ngày 1/11 xét cả tháng 10, không xét 1/11.
 * - Nhắc kiểm duyệt và nhãn "Đã xét duyệt" dùng "kỳ rà soát" theo tần suất
 *   của cửa hàng. Kỳ được nhận diện bằng một khoá chuỗi; so khoá thay vì so
 *   mốc giờ nên không lệch múi giờ và không nhắc hai lần trong một kỳ.
 */
import {
  shiftVnMonth,
  vnDateString,
  vnMonthOf,
} from '../../../common/utils/vn-calendar';

export type ReviewFrequency = 'day' | 'week' | 'month' | 'quarter' | 'year';

export const REVIEW_FREQUENCIES: ReviewFrequency[] = [
  'day',
  'week',
  'month',
  'quarter',
  'year',
];

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' → [năm, tháng 1–12, ngày]. */
const parts = (date: string): [number, number, number] => {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Tháng VN gần nhất đã kết thúc: [fromDate, toDateExclusive) theo 'YYYY-MM-DD'. */
export function lastEndedVnMonth(now: Date = new Date()): {
  label: string;
  fromDate: string;
  toDateExclusive: string;
} {
  const previous = shiftVnMonth(vnMonthOf(now), -1);
  return {
    label: previous.label,
    fromDate: previous.key,
    toDateExclusive: previous.endExclusiveDate,
  };
}

/** Năm ISO và số tuần ISO (thứ Hai đầu tuần) của một ngày VN. */
function isoWeek(date: string): { year: number; week: number } {
  const [y, m, d] = parts(date);
  const day = new Date(Date.UTC(y, m - 1, d));
  // Thứ Năm của tuần chứa ngày đó quyết định năm ISO.
  const weekday = (day.getUTCDay() + 6) % 7; // 0 = thứ Hai
  const thursday = new Date(day.getTime() + (3 - weekday) * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  const week1Monday = firstThursday.getTime() - firstWeekday * DAY_MS;
  const week = 1 + Math.floor((thursday.getTime() - week1Monday) / (7 * DAY_MS));
  return { year: isoYear, week };
}

/** Khoá kỳ rà soát chứa `now` (lịch VN). */
export function reviewPeriodKey(
  frequency: ReviewFrequency,
  now: Date = new Date(),
): string {
  const today = vnDateString(now);
  const [y, m] = parts(today);
  switch (frequency) {
    case 'day':
      return today;
    case 'week': {
      const { year, week } = isoWeek(today);
      return `${year}-W${pad(week)}`;
    }
    case 'quarter':
      return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    case 'year':
      return `${y}`;
    case 'month':
    default:
      return `${y}-${pad(m)}`;
  }
}

/** Ngày VN đầu kỳ rà soát chứa `now`, 'YYYY-MM-DD'. */
export function reviewPeriodStartDate(
  frequency: ReviewFrequency,
  now: Date = new Date(),
): string {
  const today = vnDateString(now);
  const [y, m, d] = parts(today);
  switch (frequency) {
    case 'day':
      return today;
    case 'week': {
      const day = new Date(Date.UTC(y, m - 1, d));
      const weekday = (day.getUTCDay() + 6) % 7;
      const monday = new Date(day.getTime() - weekday * DAY_MS);
      return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
    }
    case 'quarter':
      return `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`;
    case 'year':
      return `${y}-01-01`;
    case 'month':
    default:
      return `${y}-${pad(m)}-01`;
  }
}

/** Thời điểm 00:00 giờ VN của một ngày 'YYYY-MM-DD'. */
export function vnDayStartInstant(date: string): Date {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d) - VN_OFFSET_MS);
}
