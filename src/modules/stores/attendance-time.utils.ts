/**
 * Absolute shift boundaries for attendance maths.
 *
 * Late/early minutes used to be derived with `new Date()` + `setHours()`, which
 * anchors the shift boundary to *today in the server's local timezone*. That has
 * two failure modes:
 *
 *  - It silently depends on the process running with `TZ=Asia/Ho_Chi_Minh`.
 *  - For an overnight shift (22:00 → 06:00) `setHours(22, 0)` on the check-in
 *    day produces a boundary in the future, so `lateMinutes` clamps to 0 and a
 *    genuinely late arrival is recorded as on time. Those minutes feed payroll
 *    fine rules, so the error has a monetary effect.
 *
 * The boundaries are instead anchored to the slot's `work_date` at the Vietnam
 * offset. Vietnam has no DST, so the fixed +07:00 offset is exact year-round —
 * the same approach already used by `ShiftEndWorkflowService.calculateScheduledEnd`.
 */

export const VIETNAM_UTC_OFFSET = '+07:00';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}(:\d{2})?$/;

export interface ShiftBoundaries {
  start: Date | null;
  end: Date | null;
}

function toInstant(workDate: string, time?: string | null): Date | null {
  if (!time || !DATE_PATTERN.test(workDate) || !TIME_PATTERN.test(time)) {
    return null;
  }
  const instant = new Date(`${workDate}T${time}${VIETNAM_UTC_OFFSET}`);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/**
 * Resolves the absolute start and end instants of a shift. The end is rolled to
 * the following day when it is at or before the start, which is how an
 * overnight shift is represented.
 */
export function resolveShiftBoundaries(
  workDate: string | null | undefined,
  startTime?: string | null,
  endTime?: string | null,
): ShiftBoundaries {
  if (!workDate) return { start: null, end: null };

  const start = toInstant(workDate, startTime);
  let end = toInstant(workDate, endTime);

  if (start && end && end.getTime() <= start.getTime()) {
    end = new Date(end.getTime() + DAY_MS);
  }
  return { start, end };
}

/**
 * A shift's scheduled boundaries and the ones in force after an owner
 * approved a late arrival (`adjustedStartAt`) or an early leave
 * (`adjustedEndAt`). Attendance, reminders and pay use `start` / `end`;
 * approved overtime is separate (paid until its end).
 */
export interface EffectiveShiftWindow {
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  start: Date | null;
  end: Date | null;
}

const validInstant = (value?: Date | string | null): Date | null => {
  if (!value) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
};

export function resolveEffectiveShiftWindow(input: {
  workDate: string | Date | null | undefined;
  startTime?: string | null;
  endTime?: string | null;
  adjustedStartAt?: Date | string | null;
  adjustedEndAt?: Date | string | null;
}): EffectiveShiftWindow {
  const workDate =
    input.workDate instanceof Date
      ? input.workDate.toISOString().slice(0, 10)
      : input.workDate
        ? String(input.workDate).slice(0, 10)
        : null;
  const { start: scheduledStart, end: scheduledEnd } = resolveShiftBoundaries(
    workDate,
    input.startTime,
    input.endTime,
  );
  return {
    scheduledStart,
    scheduledEnd,
    start: validInstant(input.adjustedStartAt) ?? scheduledStart,
    end: validInstant(input.adjustedEndAt) ?? scheduledEnd,
  };
}

/** The window of an assignment loaded with its slot (and the slot's shift). */
export function effectiveWindowOf(assignment: {
  adjustedStartAt?: Date | string | null;
  adjustedEndAt?: Date | string | null;
  shiftSlot?: {
    workDate?: string | Date | null;
    startTime?: string | null;
    endTime?: string | null;
    workShift?: { startTime?: string | null; endTime?: string | null } | null;
  } | null;
}): EffectiveShiftWindow {
  const slot = assignment.shiftSlot;
  return resolveEffectiveShiftWindow({
    workDate: slot?.workDate,
    startTime: slot?.startTime || slot?.workShift?.startTime,
    endTime: slot?.endTime || slot?.workShift?.endTime,
    adjustedStartAt: assignment.adjustedStartAt,
    adjustedEndAt: assignment.adjustedEndAt,
  });
}

/**
 * The instant of a requested clock time ("HH:mm[:ss]", Vietnam) for a shift:
 * on the work date, or the next day when that is the one inside the shift
 * (an overnight shift). Null when the time is malformed or outside the
 * scheduled shift.
 */
export function resolveRequestedInstant(
  window: Pick<EffectiveShiftWindow, 'scheduledStart' | 'scheduledEnd'>,
  workDate: string,
  time: string | null | undefined,
): Date | null {
  if (!time || !window.scheduledStart || !window.scheduledEnd) return null;
  const sameDay = toInstant(String(workDate).slice(0, 10), String(time).slice(0, 8));
  if (!sameDay) return null;
  for (const candidate of [sameDay, new Date(sameDay.getTime() + DAY_MS)]) {
    if (
      candidate.getTime() >= window.scheduledStart.getTime() &&
      candidate.getTime() <= window.scheduledEnd.getTime()
    ) {
      return candidate;
    }
  }
  return null;
}

/** Whole minutes `now` falls after the shift start; 0 when on time or early. */
export function calculateLateMinutes(start: Date | null, now: Date): number {
  if (!start) return 0;
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 60000));
}

/** Whole minutes `now` falls before the shift end; 0 when on time or late. */
export function calculateEarlyMinutes(end: Date | null, now: Date): number {
  if (!end) return 0;
  return Math.max(0, Math.floor((end.getTime() - now.getTime()) / 60000));
}

/**
 * Early/late deltas of one attendance against its shift, in whole minutes —
 * the single source for the check-in/out result screens and the shift-hours
 * history, so the wording cannot drift between them.
 *
 * - lateMinutes: check-in after start; earlyArrivalMinutes: check-in before it.
 * - earlyMinutes: check-out before end; overtimeMinutes: check-out after it.
 * An automatic check-out (forgot to check out) is paid to the shift end, so
 * it never counts as overtime or as leaving early.
 */
export interface AttendanceDeltas {
  lateMinutes: number;
  earlyArrivalMinutes: number;
  earlyMinutes: number;
  overtimeMinutes: number;
}

export function computeAttendanceDeltas(input: {
  start: Date | null;
  end: Date | null;
  checkIn?: Date | null;
  checkOut?: Date | null;
  autoCheckedOut?: boolean;
}): AttendanceDeltas {
  const { start, end, checkIn, checkOut } = input;
  const minutesBetween = (from: Date, to: Date) =>
    Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60000));
  const hasCheckOut = !!checkOut && !input.autoCheckedOut;
  return {
    lateMinutes: start && checkIn ? minutesBetween(start, checkIn) : 0,
    earlyArrivalMinutes: start && checkIn ? minutesBetween(checkIn, start) : 0,
    earlyMinutes: end && hasCheckOut ? minutesBetween(checkOut!, end) : 0,
    overtimeMinutes: end && hasCheckOut ? minutesBetween(end, checkOut!) : 0,
  };
}

/** 90 -> "1 giờ 30 phút", 120 -> "2 giờ", 45 -> "45 phút". */
export const formatDurationVi = (minutes: number): string => {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} phút`;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
};
