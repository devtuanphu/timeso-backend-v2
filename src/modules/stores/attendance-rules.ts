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

import {
  DEFAULT_WORKED_TIME_MODE,
  type WorkedTimeMode,
} from './worked-time-rules';

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
 * Paid worked minutes of one attendance.
 *
 * Mode ACTUAL ("Làm bao nhiêu trả bấy nhiêu"): actual check-in to check-out,
 * no grace credit. With `capAtPaidEnd` (the system closed a forgotten
 * check-out) it still stops at the shift end / approved overtime end.
 *
 * Mode SHIFT ("Tính lương theo ca", the default): only time inside the
 * shift, plus approved overtime. Arriving before the start is not paid, and staying
 * after the end is paid only up to `paidUntil` — the approved overtime end —
 * so sitting on until 12:00 after a 10:00 shift adds nothing without an
 * approved overtime request.
 *
 * Inside the shift, a late arrival (or early leave) is counted from the
 * start (or to the end) when it fell within the grace, or when the store
 * does not deduct late/early time.
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
  /** End of approved overtime, when later than the shift end. */
  paidUntil?: Date | null;
  /** How the owner counts worked time for this shift (default SHIFT). */
  mode?: WorkedTimeMode;
  /** The check-out was made by the system: never pay past the paid end. */
  capAtPaidEnd?: boolean;
}): number {
  const { start, end, checkIn, checkOut, rules, storedLateMinutes } = input;
  // Staying late is paid to the shift end, or to the approved overtime end.
  const paidEnd =
    input.paidUntil && (!end || input.paidUntil.getTime() > end.getTime())
      ? input.paidUntil
      : end;

  if ((input.mode ?? DEFAULT_WORKED_TIME_MODE) === 'ACTUAL') {
    let to = checkOut.getTime();
    if (input.capAtPaidEnd && paidEnd && to > paidEnd.getTime())
      to = paidEnd.getTime();
    return Math.max(0, Math.floor((to - checkIn.getTime()) / 60_000));
  }

  // Called only for a real gap (> 0 ms); whole minutes decide the grace, as
  // they do for the recorded late/early minutes.
  const credited = (gapMs: number, recorded?: number | null) =>
    rules.creditLateEarly ||
    (recorded != null
      ? Number(recorded) === 0
      : applyGrace(Math.floor(gapMs / 60_000), rules) === 0);

  let from = checkIn.getTime();
  if (start) {
    if (from < start.getTime()) {
      // Early arrival: paid from the shift start.
      from = start.getTime();
    } else if (
      from > start.getTime() &&
      credited(from - start.getTime(), storedLateMinutes)
    ) {
      from = start.getTime();
    }
  }
  let to = checkOut.getTime();
  if (end && to < end.getTime()) {
    if (credited(end.getTime() - to)) to = end.getTime();
  }
  if (paidEnd && to > paidEnd.getTime()) to = paidEnd.getTime();
  return Math.max(0, Math.floor((to - from) / 60_000));
}
