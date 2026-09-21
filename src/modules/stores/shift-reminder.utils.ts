import moment from 'moment-timezone';

export const SHIFT_REMINDER_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const SHIFT_REMINDER_JOB_VERSION = 2;

export type ShiftReminderIdentity = {
  assignmentId?: string;
  shiftSlotId?: string;
};

export type ShiftReminderMode =
  | { kind: 'offset'; minutes: number }
  | { kind: 'fixed'; hhmm: string }
  | null;

/**
 * Cài đặt nhắc ca khi nhân viên chưa từng lưu gì: nhắc trước 15 phút, có
 * rung, nhắc nếu chưa check-in, báo ca mới. Màn hình app hiển thị đúng mặc
 * định này; `type: 'off'` đã lưu thì vẫn tắt.
 */
export const DEFAULT_REMINDER_SETTINGS = Object.freeze({
  type: '15m',
  remindIfNotCheckIn: true,
  vibrate: true,
  notifyNewShifts: true,
});

/** Cài đặt đã lưu, gộp trên mặc định (khoá thiếu lấy mặc định). */
export const effectiveReminderSettings = (
  saved: unknown,
): Record<string, any> => ({
  ...DEFAULT_REMINDER_SETTINGS,
  ...(saved && typeof saved === 'object' ? (saved as Record<string, any>) : {}),
});

const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * The fixed reminder time as Vietnam 'HH:mm': `fixedTimeLocal` wins, then
 * `fixedTime` ('HH:mm' or an ISO instant read in Vietnam time).
 */
export const resolveReminderFixedTime = (settings: any): string | null => {
  const local = settings?.fixedTimeLocal;
  if (typeof local === 'string' && HHMM_PATTERN.test(local.slice(0, 5))) {
    return local.slice(0, 5);
  }
  const fixed = settings?.fixedTime;
  if (typeof fixed !== 'string' || !fixed) return null;
  if (HHMM_PATTERN.test(fixed.slice(0, 5)) && fixed.length <= 8) {
    return fixed.slice(0, 5);
  }
  const instant = moment(fixed, moment.ISO_8601, true);
  if (!instant.isValid()) return null;
  return instant.tz(SHIFT_REMINDER_TIMEZONE).format('HH:mm');
};

/**
 * How a reminder is timed: minutes before the shift, a fixed Vietnam
 * clock time ("Nhắc cố định"), or no reminder.
 *
 * `custom` is fixed when `customMode` says so, or when there is no `custom`
 * offset object but a fixed time is set (released staff builds send only
 * `fixedTime`). A `custom` object otherwise wins.
 */
export const resolveReminderMode = (settings: any): ShiftReminderMode => {
  const type = String(settings?.type || 'off');
  if (type === 'off') return null;
  if (type === '15m') return { kind: 'offset', minutes: 15 };
  if (type === '30m') return { kind: 'offset', minutes: 30 };
  if (type === '1h') return { kind: 'offset', minutes: 60 };
  if (type !== 'custom') return { kind: 'offset', minutes: 0 };

  const custom = settings?.custom;
  const hasCustomOffset = Boolean(custom) && typeof custom === 'object';
  const fixed = resolveReminderFixedTime(settings);
  if (fixed && (settings?.customMode === 'fixed' || !hasCustomOffset)) {
    return { kind: 'fixed', hhmm: fixed };
  }
  const days = Number(custom?.days) || 0;
  const hours = Number(custom?.hours) || 0;
  const minutes = Number(custom?.minutes) || 0;
  return { kind: 'offset', minutes: days * 24 * 60 + hours * 60 + minutes };
};

/**
 * When the reminder for a shift starting at `shiftStart` fires (epoch ms),
 * or null for no reminder. A fixed time fires at that Vietnam clock time on
 * the shift's date, or the day before when that is not before the start.
 */
export const computeShiftReminderTriggerMs = (
  shiftStart: Date,
  settings: any,
): number | null => {
  const mode = resolveReminderMode(settings);
  if (!mode) return null;
  const startMs = new Date(shiftStart).getTime();
  if (Number.isNaN(startMs)) return null;
  if (mode.kind === 'offset') return startMs - mode.minutes * 60 * 1000;

  const shiftDate = moment.tz(startMs, SHIFT_REMINDER_TIMEZONE);
  const sameDay = parseVietnamShiftStart(
    shiftDate.format('YYYY-MM-DD'),
    mode.hhmm,
  ).getTime();
  if (sameDay < startMs) return sameDay;
  return parseVietnamShiftStart(
    shiftDate.clone().subtract(1, 'day').format('YYYY-MM-DD'),
    mode.hhmm,
  ).getTime();
};

/**
 * Identifies the timing preference a queued job was built with. Offset
 * modes keep their original `type|minutes` form so jobs already queued stay
 * valid; fixed mode is `custom|fixed@HH:mm`.
 */
export const getShiftReminderPreferenceFingerprint = (settings: any) => {
  const type = String(settings?.type || 'off');
  const mode = resolveReminderMode(settings);
  if (!mode) return 'off|0';
  if (mode.kind === 'fixed') return `${type}|fixed@${mode.hhmm}`;
  return `${type}|${mode.minutes}`;
};

export const parseVietnamShiftStart = (
  workDate: string,
  time: string,
): Date => {
  const normalizedTime =
    time.slice(0, 5) + (time.length >= 8 ? time.slice(5, 8) : ':00');
  const parsed = moment.tz(
    `${workDate} ${normalizedTime}`,
    'YYYY-MM-DD HH:mm:ss',
    true,
    SHIFT_REMINDER_TIMEZONE,
  );
  if (!parsed.isValid()) {
    throw new Error('Invalid shift reminder date or time');
  }
  return parsed.toDate();
};

export const buildShiftReminderFingerprint = (
  identity: ShiftReminderIdentity,
  shiftId: string,
  startTime: Date,
  settings: any,
) =>
  [
    `v${SHIFT_REMINDER_JOB_VERSION}`,
    identity.assignmentId || '',
    identity.shiftSlotId || '',
    shiftId,
    startTime.getTime(),
    getShiftReminderPreferenceFingerprint(settings),
  ].join('|');

export const buildShiftReminderJobId = (
  identity: ShiftReminderIdentity,
  shiftId: string,
  employeeId: string,
) => {
  // Assignment-scoped v2 jobs intentionally keep one stable queue identity.
  // Rescheduling explicitly replaces this job and the processor validates the
  // complete timing/preference fingerprint against authoritative state.
  const identityKey = identity.assignmentId
    ? identity.assignmentId
    : identity.shiftSlotId
      ? `slot_${identity.shiftSlotId}_${employeeId}`
      : `shift_${shiftId}_${employeeId}`;
  return `reminder_v${SHIFT_REMINDER_JOB_VERSION}_${identityKey}`;
};

export const buildShiftReminderSuccessorJobId = (
  identity: ShiftReminderIdentity,
  shiftId: string,
  employeeId: string,
) => `${buildShiftReminderJobId(identity, shiftId, employeeId)}_successor`;

export const legacyShiftReminderJobIds = (
  identity: ShiftReminderIdentity,
  shiftId: string,
  employeeId: string,
) =>
  [...new Set([identity.assignmentId, identity.shiftSlotId, shiftId])]
    .filter((value): value is string => Boolean(value))
    .map((identityKey) => `reminder_${identityKey}_${employeeId}`);
