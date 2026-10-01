/**
 * The owner's "Thiết lập ca làm & chấm công" rules applied to one attendance.
 *
 * These fields of `store_timekeeping_settings` were saved but never read, so
 * every store got the same hardcoded behaviour. They now decide:
 *
 *  - allowedLateMinutes: arriving late / leaving early by at most this many
 *    minutes counts as on time — stored late/early minutes are 0, so no LATE
 *    status, no owner "late" alert and no payroll fine. Beyond it, the full
 *    minutes are recorded.
 *  - countFullTimeIfLate / deductWorkTimeIfLate: whether late/early minutes
 *    are taken out of worked time (hour-based pay uses worked time).
 *  - earlyCheckinMinutes: how long before the shift start check-in opens.
 *  - lateCheckoutMinutes: how long after the shift end an open shift is
 *    closed automatically (forgot to check out).
 *
 * With the defaults below, late/early minutes and worked time are what they
 * were before these rules were applied. The early check-in window is new:
 * check-in used to be accepted at any time before the shift start, and now
 * opens 15 minutes before it unless the store sets otherwise.
 */

export interface AttendanceRules {
  graceMinutes: number;
  earlyCheckinMinutes: number;
  lateCheckoutMinutes: number;
  /** Late arrival / early leave never reduce worked time. */
  creditLateEarly: boolean;
}

export interface AttendanceRuleSettings {
  allowedLateMinutes?: number | null;
  earlyCheckinMinutes?: number | null;
  lateCheckoutMinutes?: number | null;
  countFullTimeIfLate?: boolean | null;
  deductWorkTimeIfLate?: boolean | null;
}

export const DEFAULT_ATTENDANCE_RULES: AttendanceRules = Object.freeze({
  graceMinutes: 0,
  earlyCheckinMinutes: 15,
  lateCheckoutMinutes: 15,
  creditLateEarly: false,
});

const minutesOr = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n) || n < 0
    ? fallback
    : Math.floor(n);
};

/** Rules of a store; a missing row (or field) falls back to the defaults. */
export function resolveAttendanceRules(
  setting?: AttendanceRuleSettings | null,
): AttendanceRules {
  if (!setting) return { ...DEFAULT_ATTENDANCE_RULES };
  return {
    graceMinutes: minutesOr(
      setting.allowedLateMinutes,
      DEFAULT_ATTENDANCE_RULES.graceMinutes,
    ),
    earlyCheckinMinutes: minutesOr(
      setting.earlyCheckinMinutes,
      DEFAULT_ATTENDANCE_RULES.earlyCheckinMinutes,
    ),
    lateCheckoutMinutes: minutesOr(
      setting.lateCheckoutMinutes,
      DEFAULT_ATTENDANCE_RULES.lateCheckoutMinutes,
    ),
    creditLateEarly:
      setting.countFullTimeIfLate === true ||
      setting.deductWorkTimeIfLate === false,
  };
}

/** Late or early minutes as recorded: 0 within the store's grace. */
export function applyGrace(rawMinutes: number, rules: AttendanceRules): number {
  const raw = Math.max(0, Math.floor(rawMinutes || 0));
  return raw <= rules.graceMinutes ? 0 : raw;
}

/** First instant check-in is accepted; null when the shift start is unknown. */
export function checkInOpensAt(
  start: Date | null,
  rules: AttendanceRules,
): Date | null {
  if (!start) return null;
  return new Date(start.getTime() - rules.earlyCheckinMinutes * 60_000);
}

/**
 * Worked minutes between check-in and check-out. A late arrival (or early
 * leave) is counted from the shift start (or to the shift end) when it fell
 * within the grace, or when the store does not deduct late/early time.
 * Arriving early or leaving late is counted as it happened, as before.
 *
 * Pass `storedLateMinutes` (what check-in recorded) when known: whether the
 * late arrival was forgiven is then decided by that record, not re-decided
 * with rules the owner may have changed during the shift.
 */
export function creditedWorkedMinutes(input: {
  start: Date | null;
  end: Date | null;
  checkIn: Date;
  checkOut: Date;
  rules: AttendanceRules;
  storedLateMinutes?: number | null;
}): number {
  const { start, end, checkIn, checkOut, rules, storedLateMinutes } = input;
  // Called only for a real gap (> 0 ms); whole minutes decide the grace, as
  // they do for the recorded late/early minutes.
  const credited = (gapMs: number, recorded?: number | null) =>
    rules.creditLateEarly ||
    (recorded != null
      ? Number(recorded) === 0
      : applyGrace(Math.floor(gapMs / 60_000), rules) === 0);

  let from = checkIn.getTime();
  if (start && from > start.getTime()) {
    if (credited(from - start.getTime(), storedLateMinutes)) {
      from = start.getTime();
    }
  }
  let to = checkOut.getTime();
  if (end && to < end.getTime()) {
    if (credited(end.getTime() - to)) to = end.getTime();
  }
  return Math.max(0, Math.floor((to - from) / 60_000));
}
