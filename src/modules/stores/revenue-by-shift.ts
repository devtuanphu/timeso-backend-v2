/**
 * Revenue by work shift, for the owner's revenue report.
 *
 * Orders carry no shift, so an order counts toward the store's active shift
 * whose hours contain its time of day (Vietnam wall time, which is how
 * `created_at` is stored). Overnight shifts (22:00–06:00) wrap past midnight;
 * when shifts overlap, the one that started most recently takes the order
 * (equal starts: the first in the given order, which the caller sorts by id);
 * an order outside every shift is "Ngoài ca". The shifts are the store's
 * current ones, so editing a shift re-attributes past orders.
 *
 * The revenue detail screen used to split each day 30/40/30 between three
 * hard-coded shifts instead.
 */

export interface ShiftWindow {
  id: string;
  shiftName: string;
  startTime: string; // 'HH:MM[:SS]'
  endTime: string;
  colorCode?: string | null;
}

/** Completed revenue for one minute of the day ('HH:MM'), summed over the range. */
export interface MinuteRevenue {
  minute: string;
  revenue: number | string;
  orders: number | string;
}

export interface ShiftRevenue {
  /** null for "Ngoài ca". */
  shiftId: string | null;
  name: string;
  startTime: string | null;
  endTime: string | null;
  colorCode: string | null;
  revenue: number;
  orders: number;
}

const DAY = 24 * 60;

const toMinute = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours * 60 + minutes) % DAY;
};

/** The shift an order placed at `minute` (0–1439) belongs to, or null. */
export function shiftAt(
  shifts: ShiftWindow[],
  minute: number,
): ShiftWindow | null {
  let best: ShiftWindow | null = null;
  let bestElapsed = DAY;
  for (const shift of shifts) {
    const start = toMinute(shift.startTime);
    const end = toMinute(shift.endTime);
    // Minutes since the shift started, wrapping past midnight.
    const elapsed = (minute - start + DAY) % DAY;
    const length = end === start ? DAY : (end - start + DAY) % DAY;
    if (elapsed < length && elapsed < bestElapsed) {
      best = shift;
      bestElapsed = elapsed;
    }
  }
  return best;
}

/**
 * One row per shift (in the order given, normally by start time), then
 * "Ngoài ca" when any revenue or order fell outside every shift.
 */
export function revenueByShift(
  shifts: ShiftWindow[],
  minutes: MinuteRevenue[],
): ShiftRevenue[] {
  const rows = new Map<string | null, ShiftRevenue>();
  for (const shift of shifts) {
    rows.set(shift.id, {
      shiftId: shift.id,
      name: shift.shiftName,
      startTime: shift.startTime.slice(0, 5),
      endTime: shift.endTime.slice(0, 5),
      colorCode: shift.colorCode ?? null,
      revenue: 0,
      orders: 0,
    });
  }
  const outside: ShiftRevenue = {
    shiftId: null,
    name: 'Ngoài ca',
    startTime: null,
    endTime: null,
    colorCode: null,
    revenue: 0,
    orders: 0,
  };

  for (const row of minutes) {
    const shift = shiftAt(shifts, toMinute(row.minute));
    const target = (shift && rows.get(shift.id)) || outside;
    target.revenue += Number(row.revenue) || 0;
    target.orders += Number(row.orders) || 0;
  }

  const result = [...rows.values()];
  if (outside.revenue !== 0 || outside.orders !== 0) result.push(outside);
  return result;
}
