import moment from 'moment-timezone';

export const SHIFT_REMINDER_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const SHIFT_REMINDER_JOB_VERSION = 2;

export type ShiftReminderIdentity = {
  assignmentId?: string;
  shiftSlotId?: string;
};

export const getShiftReminderPreferenceFingerprint = (settings: any) => {
  const type = String(settings?.type || 'off');
  if (type === 'off') return 'off|0';

  let offsetMinutes = 0;
  if (type === '15m') offsetMinutes = 15;
  else if (type === '30m') offsetMinutes = 30;
  else if (type === '1h') offsetMinutes = 60;
  else if (type === 'custom') {
    const custom = settings?.custom || {};
    const days = Number(custom.days) || 0;
    const hours = Number(custom.hours) || 0;
    const minutes = Number(custom.minutes) || 0;
    offsetMinutes = days * 24 * 60 + hours * 60 + minutes;
  }

  return `${type}|${offsetMinutes}`;
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
