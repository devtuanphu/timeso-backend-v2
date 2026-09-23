/**
 * When a staff member may still sign up for a shift slot on their own.
 *
 * A slot closes for self-registration once its start instant (Vietnam time)
 * is at or before `now`: past days and today's slots that have already
 * started. The start is the slot's own `startTime` override, else the work
 * shift template's. Owner assignment is not subject to this rule — callers
 * decide who is exempt.
 *
 * Anchored at +07:00 via `resolveShiftBoundaries`, so the answer does not
 * depend on the server's `TZ`.
 */
import { vnDateString } from '../../common/utils/vn-calendar';
import { resolveShiftBoundaries } from './attendance-time.utils';

/** Stable error code for a staff self-registration on a closed slot. */
export const SLOT_REGISTRATION_CLOSED_CODE = 'SHIFT_SLOT_REGISTRATION_CLOSED';
export const SLOT_REGISTRATION_CLOSED_MESSAGE =
  'Ca đã bắt đầu hoặc đã qua, không thể đăng ký';

/** Stable error code for a fixed-shift registration whose range already ended. */
export const SHIFT_REGISTRATION_RANGE_PASSED_CODE =
  'SHIFT_REGISTRATION_RANGE_PASSED';
export const SHIFT_REGISTRATION_RANGE_PASSED_MESSAGE =
  'Khoảng thời gian đăng ký đã qua';

export interface RegistrationWindowSlot {
  workDate: string | Date;
  startTime?: string | null;
}

export interface RegistrationWindowShift {
  startTime?: string | null;
}

/** The slot's work date as 'YYYY-MM-DD', or null when it cannot be read. */
export function normalizeWorkDate(workDate: string | Date | null | undefined) {
  if (!workDate) return null;
  if (workDate instanceof Date) {
    if (Number.isNaN(workDate.getTime())) return null;
    // A raw `date` column parsed by the driver is local midnight of that day.
    return [
      workDate.getFullYear(),
      String(workDate.getMonth() + 1).padStart(2, '0'),
      String(workDate.getDate()).padStart(2, '0'),
    ].join('-');
  }
  const day = String(workDate).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** Absolute start of the slot (slot override, else template), or null. */
export function slotEffectiveStart(
  slot: RegistrationWindowSlot,
  workShift?: RegistrationWindowShift | null,
): Date | null {
  const workDate = normalizeWorkDate(slot.workDate);
  if (!workDate) return null;
  return resolveShiftBoundaries(
    workDate,
    slot.startTime ?? workShift?.startTime ?? null,
  ).start;
}

/**
 * True when staff can no longer self-register the slot. Without a resolvable
 * start time the rule falls back to the date alone: past days are closed,
 * today stays open.
 */
export function isSlotRegistrationClosed(
  slot: RegistrationWindowSlot,
  workShift?: RegistrationWindowShift | null,
  now: Date = new Date(),
): boolean {
  const workDate = normalizeWorkDate(slot.workDate);
  if (!workDate) return false;
  if (workDate < vnDateString(now)) return true;
  const start = slotEffectiveStart(slot, workShift);
  return start ? start.getTime() <= now.getTime() : false;
}
