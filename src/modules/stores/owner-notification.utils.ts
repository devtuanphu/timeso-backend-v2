import { formatDurationVi } from './attendance-time.utils';

/**
 * X6 owner notifications: settings defaults, metadata types, job identity and
 * message texts. Pure functions only, so both the service and the queue
 * processor (and tests) share one definition.
 */

export interface OwnerNotificationSettingsView {
  preShiftEnabled: boolean;
  preShiftMinutes: 15 | 30;
  checkInEnabled: boolean;
  checkOutEnabled: boolean;
  shiftEndingEnabled: boolean;
  lateEarlyEnabled: boolean;
}

/** No saved row: everything on, 30 minutes before the shift. */
export const DEFAULT_OWNER_NOTIFICATION_SETTINGS: Readonly<OwnerNotificationSettingsView> =
  Object.freeze({
    preShiftEnabled: true,
    preShiftMinutes: 30,
    checkInEnabled: true,
    checkOutEnabled: true,
    shiftEndingEnabled: true,
    lateEarlyEnabled: true,
  });

export const OWNER_PRE_SHIFT_MINUTES = [15, 30] as const;

/** "Shift ending soon" fires this many minutes before the effective end. */
export const OWNER_SHIFT_ENDING_LEAD_MINUTES = 15;

/**
 * `metadata.type` of owner notifications. The row itself uses
 * NotificationType.SYSTEM so no Postgres enum migration is needed.
 */
export const OWNER_NOTIFICATION_TYPES = {
  PRE_SHIFT: 'OWNER_PRE_SHIFT',
  CHECK_IN: 'OWNER_CHECK_IN',
  CHECK_OUT: 'OWNER_CHECK_OUT',
  SHIFT_ENDING: 'OWNER_SHIFT_ENDING',
  LATE: 'OWNER_LATE',
  EARLY_LEAVE: 'OWNER_EARLY_LEAVE',
} as const;

/**
 * Owner app main "Ca làm việc" calendar screen
 * (timeso_owner/src/app/(work-shift)/index.tsx).
 */
export const OWNER_WORK_SHIFT_ROUTE = '/(work-shift)';

/** Owner app approvals screen (timeso_owner/src/app/(work-shift-v2)/approval.tsx). */
export const OWNER_APPROVAL_ROUTE = '/(work-shift-v2)/approval';

export const OWNER_SHIFT_ALERTS_QUEUE = 'owner-shift-alerts';

export type OwnerAlertKind = 'pre_shift' | 'shift_ending';

export const ownerAlertJobId = (kind: OwnerAlertKind, assignmentId: string) =>
  `${kind === 'pre_shift' ? 'owner_pre' : 'owner_end'}_${assignmentId}`;

/**
 * What a queued job was built from. The processor recomputes it from the
 * current assignment and settings and skips on any difference (time changed,
 * lead time changed).
 */
export const ownerAlertFingerprint = (
  kind: OwnerAlertKind,
  instant: Date,
  preShiftMinutes?: number,
) =>
  kind === 'pre_shift'
    ? `pre|${instant.getTime()}|${preShiftMinutes}`
    : `end|${instant.getTime()}`;

export const ownerAlertDedupKey = (
  event: string,
  ownerAccountId: string,
  assignmentId: string,
  instant?: Date,
) =>
  [event, ownerAccountId, assignmentId, instant ? instant.getTime() : '']
    .filter((part) => part !== '')
    .join(':');

const displayName = (name?: string | null) => name?.trim() || 'Nhân viên';
const shiftLabel = (shiftName?: string | null) =>
  shiftName?.trim() ? `ca ${shiftName.trim()}` : 'ca làm';

/** "Minh check-in ca Sáng lúc 08:05, trễ 5 phút" */
export const ownerCheckInText = (input: {
  employeeName?: string | null;
  shiftName?: string | null;
  at: string;
  lateMinutes?: number;
}) =>
  `${displayName(input.employeeName)} check-in ${shiftLabel(input.shiftName)} lúc ${input.at}${
    (input.lateMinutes ?? 0) > 0 ? `, trễ ${formatDurationVi(input.lateMinutes ?? 0)}` : ''
  }`;

/** "Minh check-out ca Sáng lúc 11:50, về sớm 10 phút" */
export const ownerCheckOutText = (input: {
  employeeName?: string | null;
  shiftName?: string | null;
  at: string;
  earlyMinutes?: number;
}) =>
  `${displayName(input.employeeName)} check-out ${shiftLabel(input.shiftName)} lúc ${input.at}${
    (input.earlyMinutes ?? 0) > 0 ? `, về sớm ${formatDurationVi(input.earlyMinutes ?? 0)}` : ''
  }`;

/** "Ca của Minh bắt đầu lúc 18:00, còn 30 phút" */
export const ownerPreShiftText = (input: {
  employeeName?: string | null;
  at: string;
  minutes: number;
}) =>
  `Ca của ${displayName(input.employeeName)} bắt đầu lúc ${input.at}, còn ${formatDurationVi(input.minutes)}`;

/** "Ca của Minh kết thúc lúc 22:00, còn 15 phút" */
export const ownerShiftEndingText = (input: {
  employeeName?: string | null;
  at: string;
  minutes: number;
}) =>
  `Ca của ${displayName(input.employeeName)} kết thúc lúc ${input.at}, còn ${formatDurationVi(input.minutes)}`;
