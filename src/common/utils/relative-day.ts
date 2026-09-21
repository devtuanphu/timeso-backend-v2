/**
 * Nhãn ngày tương đối theo giờ Việt Nam cho nội dung thông báo:
 * "hôm nay", "ngày mai", "ngày kia"; ngày khác thì null (giữ nguyên dd/mm).
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const vnDateOnly = (instant: Date): string =>
  new Date(instant.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);

const dayNumber = (date: string): number =>
  Math.round(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / 86_400_000);

export function relativeDayLabel(
  workDate: string | Date,
  now: Date = new Date(),
): 'hôm nay' | 'ngày mai' | 'ngày kia' | null {
  const target =
    typeof workDate === 'string' ? workDate.slice(0, 10) : vnDateOnly(workDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) return null;
  const diff = dayNumber(target) - dayNumber(vnDateOnly(now));
  if (diff === 0) return 'hôm nay';
  if (diff === 1) return 'ngày mai';
  if (diff === 2) return 'ngày kia';
  return null;
}

/** "hôm nay (18/09)" hoặc "ngày 25/09" khi xa hơn. */
export function describeWorkDate(
  workDate: string,
  now: Date = new Date(),
): string {
  const [, month, day] = workDate.slice(0, 10).split('-');
  const label = relativeDayLabel(workDate, now);
  return label ? `${label} (${day}/${month})` : `ngày ${day}/${month}`;
}

const ddmm = (date: string): string => {
  const [, month, day] = date.slice(0, 10).split('-');
  return `${day}/${month}`;
};

const isDateOnly = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10));

/**
 * "08:00 ngày mai (22/09)" / "08:00 ngày 25/09": giờ bắt đầu ca kèm ngày,
 * luôn giữ ngày tuyệt đối để nội dung đã lưu không bao giờ sai.
 */
export function formatShiftMoment(
  workDate: string,
  clock: string | null | undefined,
  now: Date = new Date(),
): string {
  const day = describeWorkDate(workDate, now);
  const hhmm = clock ? String(clock).slice(0, 5) : '';
  return hhmm ? `${hhmm} ${day}` : day;
}

/** Ngày làm (YYYY-MM-DD) duy nhất, đã sắp xếp. */
const uniqueSortedDates = (dates: readonly unknown[]): string[] =>
  [...new Set(dates.filter(isDateOnly).map((date) => date.slice(0, 10)))].sort();

export interface WorkDateRangeOptions {
  /**
   * `dates` là hai đầu mút của một khoảng liên tục (metadata chỉ có
   * `workDateRange {from,to}`): "có hôm nay" khi from <= hôm nay <= to, thay
   * vì chỉ khi hôm nay là một trong các ngày đã liệt kê.
   */
  continuousRange?: boolean;
}

/**
 * Nhiều ngày làm: một ngày thì như describeWorkDate; nhiều ngày thì
 * "từ 20/09 đến 25/09", thêm " (có hôm nay)" khi một trong các ngày là hôm nay
 * (hoặc, với khoảng liên tục, khi hôm nay nằm trong khoảng).
 */
export function describeWorkDateRange(
  dates: readonly string[],
  now: Date = new Date(),
  options: WorkDateRangeOptions = {},
): string {
  const sorted = uniqueSortedDates(dates);
  if (sorted.length === 0) return '';
  if (sorted.length === 1) return describeWorkDate(sorted[0], now);
  const today = vnDateOnly(now);
  const includesToday = options.continuousRange
    ? sorted[0] <= today && today <= sorted[sorted.length - 1]
    : sorted.some((date) => relativeDayLabel(date, now) === 'hôm nay');
  const range = `từ ${ddmm(sorted[0])} đến ${ddmm(sorted[sorted.length - 1])}`;
  return includesToday ? `${range} (có hôm nay)` : range;
}

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Viết lại nhãn ngày tương đối trong nội dung đã lưu theo thời điểm đọc:
 * với mỗi ngày trong `dates`, "(hôm nay|ngày mai|ngày kia) (dd/mm)" hoặc
 * "ngày dd/mm" của ngày đó được thay bằng describeWorkDate(ngày, now), và hậu
 * tố " (có hôm nay)" của khoảng ngày được tính lại. Không có `dates` thì giữ
 * nguyên. Hàm thuần: không ghi gì.
 */
export function rerenderRelativeDays(
  text: string,
  dates: readonly unknown[],
  now: Date = new Date(),
  options: WorkDateRangeOptions = {},
): string {
  if (typeof text !== 'string' || !text) return text;
  const sorted = uniqueSortedDates(dates);
  if (sorted.length === 0) return text;
  let result = text;
  for (const date of sorted) {
    const token = escapeRegExp(ddmm(date));
    const pattern = new RegExp(
      `(?:hôm nay|ngày mai|ngày kia) \\(${token}\\)|ngày ${token}(?![/\\d])`,
      'g',
    );
    result = result.replace(pattern, describeWorkDate(date, now));
  }
  if (sorted.length > 1) {
    const range = `từ ${ddmm(sorted[0])} đến ${ddmm(sorted[sorted.length - 1])}`;
    const rangePattern = new RegExp(
      `${escapeRegExp(range)}(?: \\(có hôm nay\\))?`,
      'g',
    );
    result = result.replace(
      rangePattern,
      describeWorkDateRange(sorted, now, options),
    );
  }
  return result;
}

/**
 * Ngày làm (VN) mà một thông báo nói tới, lấy từ metadata: `workDates`
 * (mảng), `workDateRange` ({from,to}) hoặc `workDate`.
 */
export function notificationWorkDates(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const meta = metadata as Record<string, unknown>;
  const dates: unknown[] = [];
  if (Array.isArray(meta.workDates)) dates.push(...meta.workDates);
  const range = meta.workDateRange as { from?: unknown; to?: unknown } | null;
  if (range && typeof range === 'object') dates.push(range.from, range.to);
  if (meta.workDate) dates.push(meta.workDate);
  return uniqueSortedDates(dates);
}

/**
 * Metadata chỉ ghi khoảng `workDateRange {from,to}` (không có danh sách
 * `workDates`): các ngày là một khoảng liên tục, không phải chỉ hai đầu mút.
 */
export function isWorkDateRangeOnly(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const meta = metadata as Record<string, unknown>;
  const range = meta.workDateRange as { from?: unknown; to?: unknown } | null;
  return (
    !!range &&
    typeof range === 'object' &&
    isDateOnly(range.from) &&
    isDateOnly(range.to) &&
    !(Array.isArray(meta.workDates) && meta.workDates.length > 0)
  );
}

/** Tối đa bao nhiêu ngày ghi vào metadata `workDates` (push data phải nhỏ). */
export const MAX_NOTIFICATION_WORK_DATES = 31;

/**
 * Metadata ngày làm cho thông báo: `workDates` khi ít ngày, còn nhiều hơn
 * MAX_NOTIFICATION_WORK_DATES thì `workDateRange: {from,to}`.
 */
export function workDatesMetadata(
  dates: readonly unknown[],
): { workDates?: string[]; workDateRange?: { from: string; to: string } } {
  const sorted = uniqueSortedDates(dates);
  if (sorted.length === 0) return {};
  if (sorted.length <= MAX_NOTIFICATION_WORK_DATES) return { workDates: sorted };
  return { workDateRange: { from: sorted[0], to: sorted[sorted.length - 1] } };
}
