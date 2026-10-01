/**
 * X1 "Lịch sử thao tác": the v1 action codes, the params allowlist and the
 * Vietnamese one-line summary both apps display.
 *
 * The summary is rendered on the server from `action` + `params` + resolved
 * names so owner and staff apps always show the same text. Unknown actions
 * fall back to a generic line, so an older app never breaks on a new code.
 */

export const ACTIVITY_ACTIONS = {
  CHECK_IN: 'attendance.check_in',
  CHECK_OUT: 'attendance.check_out',

  SHIFT_REGISTRATION_CREATED: 'shift_registration.created',
  SHIFT_REGISTRATION_BATCH_CREATED: 'shift_registration.batch_created',
  SHIFT_REGISTRATION_APPROVED: 'shift_registration.approved',
  SHIFT_REGISTRATION_REJECTED: 'shift_registration.rejected',
  SHIFT_REGISTRATION_CANCELLED: 'shift_registration.cancelled',
  SHIFT_REGISTRATION_UPCOMING_CANCELLED:
    'shift_registration.upcoming_cancelled',

  LEAVE_REQUEST_CREATED: 'leave_request.created',
  LEAVE_REQUEST_APPROVED: 'leave_request.approved',
  LEAVE_REQUEST_REJECTED: 'leave_request.rejected',
  LEAVE_REQUEST_CANCELLED: 'leave_request.cancelled',

  SHIFT_CHANGE_REQUEST_CREATED: 'shift_change_request.created',
  SHIFT_CHANGE_REQUEST_APPROVED: 'shift_change_request.approved',
  SHIFT_CHANGE_REQUEST_REJECTED: 'shift_change_request.rejected',
  SHIFT_CHANGE_REQUEST_CANCELLED: 'shift_change_request.cancelled',

  SHIFT_SWAP_APPROVED: 'shift_swap.approved',
  SHIFT_SWAP_REJECTED: 'shift_swap.rejected',

  BONUS_WORK_REQUEST_CREATED: 'bonus_work_request.created',
  BONUS_WORK_REQUEST_APPROVED: 'bonus_work_request.approved',
  BONUS_WORK_REQUEST_REJECTED: 'bonus_work_request.rejected',
  BONUS_WORK_REQUEST_CANCELLED: 'bonus_work_request.cancelled',

  CUSTOM_SHIFT_REQUEST_CREATED: 'custom_shift_request.created',
  CUSTOM_SHIFT_REQUEST_APPROVED: 'custom_shift_request.approved',
  CUSTOM_SHIFT_REQUEST_REJECTED: 'custom_shift_request.rejected',
  CUSTOM_SHIFT_REQUEST_CANCELLED: 'custom_shift_request.cancelled',

  SALARY_ADVANCE_CREATED: 'salary_advance.created',
  SALARY_ADVANCE_APPROVED: 'salary_advance.approved',
  SALARY_ADVANCE_REJECTED: 'salary_advance.rejected',
  SALARY_ADVANCE_CANCELLED: 'salary_advance.cancelled',

  PAYSLIP_PAID: 'payslip.paid',
  SALARY_ADJUSTMENT_CREATED: 'salary_adjustment.created',

  EMPLOYEE_ADDED: 'employee.added',
  EMPLOYEE_REHIRED: 'employee.rehired',
  EMPLOYEE_REMOVED: 'employee.removed',

  ASSET_ASSIGNED: 'asset.assigned',
  ASSET_RETURNED: 'asset.returned',

  CAREER_ADVANCED: 'career.advanced',

  WORK_SHIFT_DELETED: 'work_shift.deleted',
} as const;

export type ActivityAction =
  (typeof ACTIVITY_ACTIONS)[keyof typeof ACTIVITY_ACTIONS];

export const ACTIVITY_ACTION_CODES: readonly string[] =
  Object.values(ACTIVITY_ACTIONS);

export type ActivityResourceType =
  | 'shift_assignment'
  | 'leave_request'
  | 'shift_change_request'
  | 'shift_swap'
  | 'bonus_work_request'
  | 'custom_shift_request'
  | 'salary_advance'
  | 'payslip'
  | 'salary_adjustment'
  | 'employee'
  | 'asset_assignment'
  | 'career_event'
  | 'work_shift';

const HHMM = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

type ParamRule = (value: unknown) => unknown;

const text =
  (max: number): ParamRule =>
  (value) =>
    typeof value === 'string' && value.trim()
      ? value.trim().slice(0, max)
      : undefined;
const pattern =
  (re: RegExp): ParamRule =>
  (value) =>
    typeof value === 'string' && re.test(value) ? value : undefined;
const count: ParamRule = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
const flag: ParamRule = (value) =>
  typeof value === 'boolean' ? value : undefined;
const oneOf =
  (...allowed: string[]): ParamRule =>
  (value) =>
    typeof value === 'string' && allowed.includes(value) ? value : undefined;

/**
 * The only keys `params` may carry, each with its shape. Everything else is
 * dropped, so a hook can never leak money amounts, face or location data,
 * free-text reasons, phone or ID numbers into the log by accident.
 */
const PARAM_RULES: Record<string, ParamRule> = {
  shiftName: text(80),
  startTime: pattern(HHMM),
  endTime: pattern(HHMM),
  checkInAt: pattern(HHMM),
  checkOutAt: pattern(HHMM),
  workDate: pattern(DATE),
  fromDate: pattern(DATE),
  toDate: pattern(DATE),
  requestDate: pattern(DATE),
  month: pattern(MONTH),
  lateMinutes: count,
  earlyMinutes: count,
  count,
  quantity: count,
  status: text(32),
  leaveType: oneOf(
    'SICK',
    'PERSONAL',
    'VACATION',
    'UNPAID',
    'LATE',
    'EARLY',
    'OVERTIME',
    'OTHER',
  ),
  source: oneOf('manual', 'account', 'application'),
  mode: oneOf('rehire', 'restore'),
  direction: oneOf('increase', 'decrease'),
  assetName: text(120),
  assetStatus: oneOf('RETURNED', 'DAMAGED', 'LOST'),
  ladderName: text(80),
  rungName: text(80),
  byOwner: flag,
};

export function sanitizeActivityParams(
  params: Record<string, unknown> | null | undefined,
): Record<string, string | number | boolean> {
  const clean: Record<string, string | number | boolean> = {};
  if (!params || typeof params !== 'object') return clean;
  for (const [key, rule] of Object.entries(PARAM_RULES)) {
    if (!(key in params)) continue;
    const value = rule(params[key]);
    if (value !== undefined) clean[key] = value as string | number | boolean;
  }
  return clean;
}

/** `HH:mm[:ss]` → `HH:mm`, or undefined. */
export const toActivityHHmm = (
  time: string | null | undefined,
): string | undefined => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(time ?? ''));
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : undefined;
};

/** A DB date (string or Date read on the VN calendar) → `YYYY-MM-DD`. */
export const toActivityDate = (
  value: string | Date | null | undefined,
): string | undefined => {
  if (!value) return undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    return new Date(value.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  }
  const date = String(value).slice(0, 10);
  return DATE.test(date) ? date : undefined;
};

const LEAVE_LABEL: Record<string, string> = {
  LATE: 'đi trễ',
  EARLY: 'về sớm',
  OVERTIME: 'tăng ca',
};

const ddmm = (date: unknown): string | undefined => {
  if (typeof date !== 'string' || !DATE.test(date)) return undefined;
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
};

const mmyyyy = (month: unknown): string | undefined => {
  if (typeof month !== 'string' || !MONTH.test(month)) return undefined;
  const [y, m] = month.split('-');
  return `${m}/${y}`;
};

/** "ca Sáng (08:00–12:00) ngày 21/09" from whatever parts are present. */
const describeShift = (p: Record<string, unknown>): string => {
  let out = p.shiftName ? `ca ${String(p.shiftName)}` : 'ca làm';
  if (p.startTime && p.endTime) out += ` (${p.startTime}–${p.endTime})`;
  const day = ddmm(p.workDate);
  if (day) out += ` ngày ${day}`;
  return out;
};

const describeRange = (p: Record<string, unknown>): string => {
  const from = ddmm(p.fromDate);
  const to = ddmm(p.toDate);
  if (from && to && from !== to) return ` từ ${from} đến ${to}`;
  if (from) return ` ngày ${from}`;
  return '';
};

const describeLeave = (p: Record<string, unknown>): string => {
  const label = LEAVE_LABEL[String(p.leaveType ?? '')];
  return `${label ? `đơn xin ${label}` : 'đơn xin nghỉ'}${describeRange(p)}`;
};

const onDay = (p: Record<string, unknown>, key = 'requestDate'): string => {
  const day = ddmm(p[key]);
  return day ? ` ngày ${day}` : '';
};

/** "khung giờ 18:00–02:00 từ 05/10 đến 31/10 (8 ngày)". */
const describeCustomShift = (p: Record<string, unknown>): string => {
  let out = 'khung giờ';
  if (p.startTime && p.endTime) out += ` ${p.startTime}–${p.endTime}`;
  out += describeRange(p);
  const days = Number(p.count);
  if (days > 1) out += ` (${days} ngày)`;
  return out;
};

const forMonth = (p: Record<string, unknown>): string => {
  const month = mmyyyy(p.month);
  return month ? ` tháng ${month}` : '';
};

export interface ActivitySummaryInput {
  action: string;
  actorRole: string;
  actorName?: string | null;
  subjectName?: string | null;
  params?: Record<string, unknown> | null;
}

/**
 * The Vietnamese line shown for one log entry, e.g.
 * "Nguyễn A check-in ca Sáng (08:00–12:00), trễ 5 phút".
 */
export function renderActivitySummary(entry: ActivitySummaryInput): string {
  const p = entry.params ?? {};
  const actor =
    entry.actorName?.trim() ||
    (entry.actorRole === 'owner'
      ? 'Chủ cửa hàng'
      : entry.actorRole === 'system'
        ? 'Hệ thống'
        : 'Nhân viên');
  const subject = entry.subjectName?.trim() || 'nhân viên';
  const late = Number(p.lateMinutes) > 0 ? `, trễ ${p.lateMinutes} phút` : '';
  const early =
    Number(p.earlyMinutes) > 0 ? `, về sớm ${p.earlyMinutes} phút` : '';
  const at = (key: string) => (p[key] ? ` lúc ${String(p[key])}` : '');
  const A = ACTIVITY_ACTIONS;

  switch (entry.action) {
    case A.CHECK_IN:
      return `${actor} check-in ${describeShift(p)}${at('checkInAt')}${late}`;
    case A.CHECK_OUT:
      return `${actor} check-out ${describeShift(p)}${at('checkOutAt')}${early}`;
    case A.SHIFT_REGISTRATION_CREATED:
      return p.byOwner
        ? `${actor} xếp ${subject} vào ${describeShift(p)}`
        : `${actor} đăng ký ${describeShift(p)}`;
    case A.SHIFT_REGISTRATION_BATCH_CREATED:
      return `${actor} đăng ký ${Number(p.count) || 0} ca${
        p.shiftName ? ` ${String(p.shiftName)}` : ''
      }${describeRange(p)}`;
    case A.SHIFT_REGISTRATION_APPROVED:
      return `${actor} duyệt đăng ký ${describeShift(p)} của ${subject}`;
    case A.SHIFT_REGISTRATION_REJECTED:
      return `${actor} từ chối đăng ký ${describeShift(p)} của ${subject}`;
    case A.SHIFT_REGISTRATION_CANCELLED:
      return `${actor} huỷ ${describeShift(p)} của ${subject}`;
    case A.SHIFT_REGISTRATION_UPCOMING_CANCELLED:
      return `${actor} huỷ ${Number(p.count) || 0} ca đã đăng ký sắp tới${
        p.shiftName ? ` (ca ${String(p.shiftName)})` : ''
      }`;
    case A.LEAVE_REQUEST_CREATED:
      return `${actor} gửi ${describeLeave(p)}`;
    case A.LEAVE_REQUEST_APPROVED:
      return `${actor} duyệt ${describeLeave(p)} của ${subject}`;
    case A.LEAVE_REQUEST_REJECTED:
      return `${actor} từ chối ${describeLeave(p)} của ${subject}`;
    case A.LEAVE_REQUEST_CANCELLED:
      return `${actor} huỷ ${describeLeave(p)}`;
    case A.SHIFT_CHANGE_REQUEST_CREATED:
      return `${actor} gửi yêu cầu đổi ca${onDay(p)}`;
    case A.SHIFT_CHANGE_REQUEST_APPROVED:
      return `${actor} duyệt yêu cầu đổi ca${onDay(p)} của ${subject}`;
    case A.SHIFT_CHANGE_REQUEST_REJECTED:
      return `${actor} từ chối yêu cầu đổi ca${onDay(p)} của ${subject}`;
    case A.SHIFT_CHANGE_REQUEST_CANCELLED:
      return `${actor} huỷ yêu cầu đổi ca${onDay(p)}`;
    case A.SHIFT_SWAP_APPROVED:
      return `${actor} duyệt yêu cầu nhượng ${describeShift(p)} của ${subject}`;
    case A.SHIFT_SWAP_REJECTED:
      return `${actor} từ chối yêu cầu nhượng ${describeShift(p)} của ${subject}`;
    case A.BONUS_WORK_REQUEST_CREATED:
      return `${actor} gửi yêu cầu tăng ca${onDay(p)}`;
    case A.BONUS_WORK_REQUEST_APPROVED:
      return `${actor} duyệt yêu cầu tăng ca${onDay(p)} của ${subject}`;
    case A.BONUS_WORK_REQUEST_REJECTED:
      return `${actor} từ chối yêu cầu tăng ca${onDay(p)} của ${subject}`;
    case A.BONUS_WORK_REQUEST_CANCELLED:
      return `${actor} huỷ yêu cầu tăng ca${onDay(p)}`;
    case A.CUSTOM_SHIFT_REQUEST_CREATED:
      return `${actor} gửi yêu cầu ${describeCustomShift(p)}`;
    case A.CUSTOM_SHIFT_REQUEST_APPROVED:
      return `${actor} duyệt yêu cầu ${describeCustomShift(p)} của ${subject}`;
    case A.CUSTOM_SHIFT_REQUEST_REJECTED:
      return `${actor} từ chối yêu cầu ${describeCustomShift(p)} của ${subject}`;
    case A.CUSTOM_SHIFT_REQUEST_CANCELLED:
      return `${actor} huỷ yêu cầu ${describeCustomShift(p)}`;
    case A.SALARY_ADVANCE_CREATED:
      return entry.actorRole === 'owner'
        ? `${actor} tạo yêu cầu ứng lương${forMonth(p)} cho ${subject}`
        : `${actor} gửi yêu cầu ứng lương${forMonth(p)}`;
    case A.SALARY_ADVANCE_APPROVED:
      return `${actor} duyệt yêu cầu ứng lương${forMonth(p)} của ${subject}`;
    case A.SALARY_ADVANCE_REJECTED:
      return `${actor} từ chối yêu cầu ứng lương${forMonth(p)} của ${subject}`;
    case A.SALARY_ADVANCE_CANCELLED:
      return `${actor} huỷ yêu cầu ứng lương${forMonth(p)}`;
    case A.PAYSLIP_PAID:
      return `${actor} thanh toán lương${forMonth(p)} cho ${subject}`;
    case A.SALARY_ADJUSTMENT_CREATED:
      return `${actor} ${
        p.direction === 'decrease' ? 'giảm' : 'tăng'
      } lương cho ${subject}${
        mmyyyy(p.month) ? `, hiệu lực tháng ${mmyyyy(p.month)}` : ''
      }`;
    case A.EMPLOYEE_ADDED:
      return p.source === 'application'
        ? `${actor} nhận ${subject} vào làm từ đơn ứng tuyển`
        : `${actor} thêm ${subject} vào cửa hàng`;
    case A.EMPLOYEE_REHIRED:
      return p.mode === 'restore'
        ? `${actor} khôi phục ${subject} vào cửa hàng`
        : `${actor} tuyển lại ${subject}`;
    case A.EMPLOYEE_REMOVED:
      return `${actor} cho ${subject} thôi việc`;
    case A.ASSET_ASSIGNED:
      return `${actor} cấp ${
        Number(p.quantity) > 1 ? `${p.quantity} ` : ''
      }${p.assetName ? String(p.assetName) : 'tài sản'} cho ${subject}`;
    case A.ASSET_RETURNED:
      return `${actor} ${
        p.assetStatus === 'LOST'
          ? 'ghi nhận mất'
          : p.assetStatus === 'DAMAGED'
            ? 'ghi nhận hỏng'
            : 'thu hồi'
      } ${p.assetName ? String(p.assetName) : 'tài sản'} của ${subject}`;
    case A.CAREER_ADVANCED:
      return `${actor} chuyển ${subject} lên bậc ${
        p.rungName ? String(p.rungName) : 'mới'
      }${p.ladderName ? ` (lộ trình ${String(p.ladderName)})` : ''}`;
    case A.WORK_SHIFT_DELETED:
      return `${actor} xoá ${describeShift(p)}`;
    default:
      return `${actor} thực hiện một thao tác`;
  }
}
