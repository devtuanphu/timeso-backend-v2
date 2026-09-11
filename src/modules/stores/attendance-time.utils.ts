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
