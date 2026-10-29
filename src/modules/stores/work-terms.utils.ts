/**
 * Điều kiện làm việc riêng của một nhân viên (cột trên employee_profiles, xem
 * scripts/migration_employee_work_terms.sql):
 *
 * - `officialStartDate`: trước ngày này không đăng ký / xếp ca được — chặn cả
 *   nhân viên lẫn chủ.
 * - `fixedDaysOff`, `workDaysPerWeek`, `workDaysPerMonth`: chặn nhân viên tự
 *   đăng ký; với chủ chỉ là cảnh báo khi xếp ca (chủ vẫn xếp được).
 *
 * "Một ngày làm" = một ngày (workDate của slot) có ít nhất một ca chưa huỷ;
 * hai ca cùng ngày tính là một ngày. Tuần tính từ Thứ 2 đến Chủ nhật, tháng là
 * tháng dương lịch, theo ngày làm giờ VN.
 */

export interface WorkTerms {
  officialStartDate: string | null;
  workDaysPerWeek: number | null;
  workDaysPerMonth: number | null;
  /** 0 = Chủ nhật … 6 = Thứ 7. */
  fixedDaysOff: number[];
}

export type WorkTermCode =
  | 'NOT_STARTED'
  | 'FIXED_DAY_OFF'
  | 'WEEK_LIMIT'
  | 'MONTH_LIMIT';

export interface WorkTermViolation {
  code: WorkTermCode;
  /** Nhãn ngắn, ngôi thứ ba, cho danh sách chọn nhân viên của chủ. */
  label: string;
  /** Câu báo cho chính nhân viên khi bị từ chối. */
  message: string;
}

/** Mã lỗi HTTP (details.code) khi một lần đăng ký ca bị chặn bởi điều kiện làm việc. */
export const WORK_TERM_ERROR_CODES: Record<WorkTermCode, string> = {
  NOT_STARTED: 'WORK_TERM_NOT_STARTED',
  FIXED_DAY_OFF: 'WORK_TERM_FIXED_DAY_OFF',
  WEEK_LIMIT: 'WORK_TERM_WEEK_LIMIT',
  MONTH_LIMIT: 'WORK_TERM_MONTH_LIMIT',
};

export const WEEKDAY_LABELS = [
  'Chủ nhật',
  'Thứ 2',
  'Thứ 3',
  'Thứ 4',
  'Thứ 5',
  'Thứ 6',
  'Thứ 7',
] as const;

/**
 * 'YYYY-MM-DD' của một cột `date`. Driver có thể trả chuỗi hoặc Date (nửa đêm
 * giờ máy chủ) — Date đọc theo giờ địa phương, toISOString() sẽ lùi một ngày ở +07.
 */
export function ymdOf(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0'),
    ].join('-');
  }
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

const utcOf = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

const ymdOfUtc = (date: Date) => date.toISOString().slice(0, 10);

/** 0 = Chủ nhật … 6 = Thứ 7 của một ngày lịch. */
export function weekdayOf(ymd: string): number {
  return utcOf(ymd).getUTCDay();
}

/** Thứ 2 đầu tuần (T2–CN) chứa ngày này. */
export function weekStartOf(ymd: string): string {
  const date = utcOf(ymd);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return ymdOfUtc(date);
}

export function addCalendarDays(ymd: string, days: number): string {
  const date = utcOf(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return ymdOfUtc(date);
}

/** Khoảng ngày cần đọc để đếm tuần / tháng của mọi ngày trong `dates`. */
export function workTermWindow(dates: string[]): { from: string; to: string } | null {
  if (!dates.length) return null;
  const sorted = [...dates].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const weekFrom = weekStartOf(first);
  const monthFrom = `${first.slice(0, 7)}-01`;
  const weekTo = addCalendarDays(weekStartOf(last), 6);
  const lastDate = utcOf(`${last.slice(0, 7)}-01`);
  lastDate.setUTCMonth(lastDate.getUTCMonth() + 1);
  lastDate.setUTCDate(0);
  const monthTo = ymdOfUtc(lastDate);
  return {
    from: weekFrom < monthFrom ? weekFrom : monthFrom,
    to: weekTo > monthTo ? weekTo : monthTo,
  };
}

const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

export function workTermsOf(profile: {
  officialStartDate?: string | Date | null;
  workDaysPerWeek?: number | null;
  workDaysPerMonth?: number | null;
  fixedDaysOff?: number[] | null;
}): WorkTerms {
  return {
    officialStartDate: ymdOf(profile.officialStartDate ?? null),
    workDaysPerWeek: profile.workDaysPerWeek ?? null,
    workDaysPerMonth: profile.workDaysPerMonth ?? null,
    fixedDaysOff: (profile.fixedDaysOff ?? []).map(Number),
  };
}

export function hasWorkTerms(terms: WorkTerms): boolean {
  return (
    !!terms.officialStartDate ||
    terms.workDaysPerWeek !== null ||
    terms.workDaysPerMonth !== null ||
    terms.fixedDaysOff.length > 0
  );
}

/**
 * Lỗi (code + message) khi giao ca ngày `workDate` cho người nhận ca (đổi ca)
 * chưa tới ngày chính thức vào làm; null = được.
 */
export function swapTargetNotStarted(
  target: { officialStartDate?: string | Date | null },
  workDate: string | Date | null | undefined,
): { code: string; message: string } | null {
  const day = ymdOf(workDate ?? null);
  const start = ymdOf(target.officialStartDate ?? null);
  if (!day || !start || day >= start) return null;
  return {
    code: WORK_TERM_ERROR_CODES.NOT_STARTED,
    message: `Nhân viên nhận ca vào làm chính thức từ ${dm(start)}, chưa nhận ca ngày ${dm(day)} được.`,
  };
}

/** Ngày `workDate` trước ngày chính thức vào làm. Chặn cả chủ. */
export function notStartedViolation(
  terms: WorkTerms,
  workDate: string,
): WorkTermViolation | null {
  if (!terms.officialStartDate || workDate >= terms.officialStartDate) return null;
  const day = dm(terms.officialStartDate);
  return {
    code: 'NOT_STARTED',
    label: `Vào làm từ ${day.slice(0, 5)}`,
    message: `Ngày chính thức vào làm là ${day}, chưa đăng ký ca trước ngày này được.`,
  };
}

/**
 * Điều kiện đầu tiên bị vi phạm khi thêm một ca vào ngày `workDate`, hoặc null.
 *
 * `bookedDates`: các ngày đã có ca chưa huỷ của nhân viên (ít nhất phủ tuần và
 * tháng của `workDate`, xem workTermWindow). Ngày đã có ca thì thêm ca nữa
 * không tốn thêm ngày, nên không vướng giới hạn tuần / tháng.
 */
export function workTermViolation(
  terms: WorkTerms,
  workDate: string,
  bookedDates: ReadonlySet<string>,
): WorkTermViolation | null {
  const notStarted = notStartedViolation(terms, workDate);
  if (notStarted) return notStarted;

  const weekday = weekdayOf(workDate);
  if (terms.fixedDaysOff.includes(weekday)) {
    const name = WEEKDAY_LABELS[weekday];
    return {
      code: 'FIXED_DAY_OFF',
      label: `Nghỉ cố định ${name}`,
      message: `${name} là ngày nghỉ cố định của bạn, không đăng ký ca được.`,
    };
  }
  if (bookedDates.has(workDate)) return null;

  if (terms.workDaysPerWeek !== null) {
    const from = weekStartOf(workDate);
    const to = addCalendarDays(from, 6);
    const used = [...bookedDates].filter((d) => d >= from && d <= to).length;
    if (used >= terms.workDaysPerWeek) {
      return {
        code: 'WEEK_LIMIT',
        label: `Đủ ${terms.workDaysPerWeek} ngày/tuần`,
        message: `Bạn đã đăng ký đủ ${terms.workDaysPerWeek} ngày làm trong tuần này.`,
      };
    }
  }
  if (terms.workDaysPerMonth !== null) {
    const month = workDate.slice(0, 7);
    const used = [...bookedDates].filter((d) => d.slice(0, 7) === month).length;
    if (used >= terms.workDaysPerMonth) {
      return {
        code: 'MONTH_LIMIT',
        label: `Đủ ${terms.workDaysPerMonth} ngày/tháng`,
        message: `Bạn đã đăng ký đủ ${terms.workDaysPerMonth} ngày làm trong tháng ${Number(month.slice(5, 7))}.`,
      };
    }
  }
  return null;
}

/**
 * Cảnh báo cho chủ khi xếp nhân viên vào mọi ngày `workDates` một lượt: các
 * điều kiện bị vượt (không trùng nhãn), tính dồn — ngày xếp trước được tính vào
 * tuần / tháng của ngày xếp sau. Không gồm NOT_STARTED (chủ bị chặn hẳn).
 */
export function workTermWarnings(
  terms: WorkTerms,
  workDates: string[],
  bookedDates: ReadonlySet<string>,
): string[] {
  const booked = new Set(bookedDates);
  const labels: string[] = [];
  for (const workDate of [...new Set(workDates)].sort()) {
    const violation = workTermViolation(
      { ...terms, officialStartDate: null },
      workDate,
      booked,
    );
    if (violation && !labels.includes(violation.label)) labels.push(violation.label);
    booked.add(workDate);
  }
  return labels;
}
