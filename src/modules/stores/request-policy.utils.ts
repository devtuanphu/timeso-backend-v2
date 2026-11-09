/**
 * Cài đặt duyệt đơn của chủ (app chủ → Cài đặt phê duyệt, bảng
 * store_approval_settings) áp vào đơn nhân viên tự gửi. Trước đây các số này
 * chỉ để hiển thị: nhân viên thấy "Báo trước 24h, tối đa 2 lần/tháng" nhưng
 * backend không chặn gì.
 *
 * - Tắt loại đơn: không gửi được loại đó.
 * - Báo trước N giờ (N > 0): thời điểm bị ảnh hưởng (giờ vào ca, giờ xin về)
 *   phải cách lúc gửi ít nhất N giờ.
 * - Tối đa N lần / tháng (N > 0): số đơn đang chờ / đã duyệt cùng nhóm trong
 *   tháng của ngày bị ảnh hưởng. 0 = không giới hạn / không cần báo trước,
 *   giống cách app nhân viên hiển thị.
 * - Nghỉ đột xuất (SUDDEN) là đơn gửi gấp: không áp báo trước và số lần,
 *   chỉ chặn khi chủ tắt nhóm "Xin đi trễ / về sớm / nghỉ phép / vắng mặt".
 * Đơn do chủ tạo / xếp hộ không đi qua đây.
 */

export type RequestPolicyKind = 'LEAVE' | 'SUDDEN' | 'LATE' | 'EARLY' | 'SWAP' | 'REGISTER';

export interface ApprovalPolicy {
  enableShiftRegistration?: boolean | null;
  enableLeaveRequest?: boolean | null;
  enableShiftSwap?: boolean | null;
  leaveNoticeHours?: number | null;
  leaveLimitPerMonth?: number | null;
  swapNoticeHours?: number | null;
  swapLimitPerMonth?: number | null;
  lateEarlyNoticeHours?: number | null;
  lateEarlyLimitPerMonth?: number | null;
}

export const REQUEST_POLICY_CODE = 'REQUEST_POLICY_VIOLATION';

const LABEL: Record<RequestPolicyKind, string> = {
  LEAVE: 'xin nghỉ phép',
  SUDDEN: 'xin nghỉ đột xuất',
  LATE: 'xin đi trễ / về sớm',
  EARLY: 'xin đi trễ / về sớm',
  SWAP: 'đổi ca',
  REGISTER: 'đăng ký ca',
};

const n = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/** Lý do đơn bị chặn theo cài đặt của cửa hàng; null = được gửi. */
export function requestPolicyViolation(input: {
  policy: ApprovalPolicy | null | undefined;
  kind: RequestPolicyKind;
  now: Date;
  /** Thời điểm bị ảnh hưởng (giờ vào ca, giờ xin về); null = không kiểm báo trước. */
  affectsAt: Date | null;
  /** Số đơn cùng nhóm đang chờ / đã duyệt trong tháng (không tính đơn đang gửi). */
  usedThisMonth: number;
}): string | null {
  const policy = input.policy ?? {};
  const kind = input.kind;
  if (kind === 'REGISTER') {
    return policy.enableShiftRegistration === false ? 'Cửa hàng đang tắt đăng ký ca' : null;
  }
  if (kind === 'SWAP') {
    if (policy.enableShiftSwap === false) return 'Cửa hàng đang tắt đổi ca';
  } else if (policy.enableLeaveRequest === false) {
    return 'Cửa hàng đang tắt xin đi trễ / về sớm / nghỉ phép / vắng mặt';
  }
  if (kind === 'SUDDEN') return null;
  const notice =
    kind === 'LEAVE'
      ? n(policy.leaveNoticeHours)
      : kind === 'SWAP'
        ? n(policy.swapNoticeHours)
        : n(policy.lateEarlyNoticeHours);
  const limit =
    kind === 'LEAVE'
      ? n(policy.leaveLimitPerMonth)
      : kind === 'SWAP'
        ? n(policy.swapLimitPerMonth)
        : n(policy.lateEarlyLimitPerMonth);
  if (
    notice > 0 &&
    input.affectsAt &&
    input.affectsAt.getTime() - input.now.getTime() < notice * 60 * 60 * 1000
  ) {
    return `Cửa hàng yêu cầu ${LABEL[kind]} trước ít nhất ${notice} giờ`;
  }
  if (limit > 0 && input.usedThisMonth >= limit) {
    return `Đã đủ ${limit} lần ${LABEL[kind]} trong tháng theo quy định của cửa hàng`;
  }
  return null;
}

const WEEK_MINUTES = 7 * 24 * 60;
const WEEKDAY_INDEX: Record<string, number> = {
  MONDAY: 0,
  TUESDAY: 1,
  WEDNESDAY: 2,
  THURSDAY: 3,
  FRIDAY: 4,
  SATURDAY: 5,
  SUNDAY: 6,
};

/** Khoảng tối thiểu giữa giờ mở và giờ khoá đăng ký ca (phút). */
export const SHIFT_REGISTER_MIN_GAP_MINUTES = 30;

/** "Monday" + "08:30" → phút tính từ 00:00 thứ Hai; null khi không đọc được. */
export function weeklyMinuteOf(day: unknown, time: unknown): number | null {
  const index = WEEKDAY_INDEX[String(day ?? '').trim().toUpperCase()];
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(time ?? '').trim());
  if (index === undefined || !match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return index * 24 * 60 + hours * 60 + minutes;
}

/**
 * Giờ mở và giờ khoá đăng ký ca (lặp hàng tuần) cách nhau bao nhiêu phút,
 * theo chiều gần hơn trên vòng tuần: mở Thứ 2 08:00 / khoá Thứ 2 08:00 → 0;
 * khoá Chủ nhật 23:50 / mở Thứ 2 00:10 → 20. Null khi một trong hai không
 * đọc được.
 */
export function shiftRegisterWindowGapMinutes(input: {
  openDay: unknown;
  openTime: unknown;
  closeDay: unknown;
  closeTime: unknown;
}): number | null {
  const open = weeklyMinuteOf(input.openDay, input.openTime);
  const close = weeklyMinuteOf(input.closeDay, input.closeTime);
  if (open === null || close === null) return null;
  const forward = (((close - open) % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES;
  return Math.min(forward, WEEK_MINUTES - forward);
}
