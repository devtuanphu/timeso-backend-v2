/**
 * "Giờ hoạt động cửa hàng": one or more frames within a calendar day, e.g.
 * 12:00–24:00 and 00:00–05:00 for a store open from noon to 5 a.m. A frame
 * never crosses midnight — the owner app splits such a range into two — so
 * `start` < `end`, with `end` up to "24:00".
 *
 * The older single pair (store_shift_configs.open_time / close_time, close ≤
 * open = overnight) is kept in step for the consumers that still read it
 * (the schedule preview's staffing gaps, older owner app builds).
 */

export interface OperatingFrame {
  /** "HH:mm", 00:00–23:59. */
  start: string;
  /** "HH:mm", 00:01–24:00, after `start`. */
  end: string;
}

export const OPERATING_FRAMES_MAX = 6;

const DAY = 24 * 60;

const pad = (value: number) => String(value).padStart(2, '0');

/** "HH:mm" (or "HH:mm:ss") → minutes; "24:00" → 1440; null when invalid. */
export const frameMinutes = (value: unknown): number | null => {
  const match = /^(\d{2}):(\d{2})(?::00)?$/.exec(String(value ?? ''));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes !== 0)) return null;
  return hours * 60 + minutes;
};

export const frameClock = (minutes: number) =>
  `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

export class OperatingFramesError extends Error {}

/**
 * Validated frames, sorted by start, as "HH:mm". Throws OperatingFramesError
 * with a message for the owner when a frame is malformed, crosses midnight,
 * or overlaps another one (touching frames are allowed).
 */
export function normalizeOperatingFrames(frames: unknown): OperatingFrame[] {
  if (!Array.isArray(frames)) {
    throw new OperatingFramesError('Giờ hoạt động không hợp lệ.');
  }
  if (frames.length === 0) {
    throw new OperatingFramesError('Cần ít nhất một khung giờ hoạt động.');
  }
  if (frames.length > OPERATING_FRAMES_MAX) {
    throw new OperatingFramesError(
      `Tối đa ${OPERATING_FRAMES_MAX} khung giờ hoạt động.`,
    );
  }
  const parsed = frames.map((frame: any, index) => {
    const start = frameMinutes(frame?.start);
    const end = frameMinutes(frame?.end);
    if (start === null || end === null || start >= DAY) {
      throw new OperatingFramesError(`Khung giờ ${index + 1} không hợp lệ.`);
    }
    if (end <= start) {
      throw new OperatingFramesError(
        `Khung giờ ${index + 1} phải kết thúc sau giờ bắt đầu; qua ngày mới thì tách thành hai khung (… – 24:00 và 00:00 – …).`,
      );
    }
    return { start, end };
  });
  parsed.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index].start < parsed[index - 1].end) {
      throw new OperatingFramesError('Các khung giờ hoạt động bị trùng nhau.');
    }
  }
  return parsed.map(({ start, end }) => ({
    start: frameClock(start),
    end: frameClock(end),
  }));
}

/** Frames for the single open/close pair: an overnight pair is split. */
export function framesFromOpenClose(
  openTime: string | null | undefined,
  closeTime: string | null | undefined,
): OperatingFrame[] {
  const open = frameMinutes(String(openTime ?? '').slice(0, 5));
  const close = frameMinutes(String(closeTime ?? '').slice(0, 5));
  if (open === null || close === null || open >= DAY) return [];
  if (close > open) return [{ start: frameClock(open), end: frameClock(close) }];
  const frames: OperatingFrame[] = [{ start: frameClock(open), end: '24:00' }];
  if (close > 0) frames.unshift({ start: '00:00', end: frameClock(close) });
  return frames;
}

/**
 * The store's business day in minutes from 00:00 of the calendar day: from
 * the start of the first frame after the longest closed gap (on a 24-hour
 * clock) to the end of the last frame before it, which passes 1440 when the
 * store stays open after midnight. 12:00–24:00 + 00:00–05:00 → 720 → 1740.
 * Null without frames.
 */
export function businessDayOf(
  frames: OperatingFrame[],
): { start: number; end: number } | null {
  const spans = frames
    .map((frame) => ({
      start: frameMinutes(frame.start),
      end: frameMinutes(frame.end),
    }))
    .filter(
      (span): span is { start: number; end: number } =>
        span.start !== null && span.end !== null && span.end > span.start,
    )
    .sort((a, b) => a.start - b.start);
  if (!spans.length) return null;
  // Closed gaps between consecutive frames, the last one wrapping midnight.
  let bestIndex = 0;
  let bestGap = -1;
  spans.forEach((span, index) => {
    const next = spans[(index + 1) % spans.length];
    const gap =
      index === spans.length - 1
        ? next.start + DAY - span.end
        : next.start - span.end;
    if (gap > bestGap) {
      bestGap = gap;
      bestIndex = index;
    }
  });
  if (bestGap <= 0) return { start: 0, end: DAY }; // open around the clock
  const first = spans[(bestIndex + 1) % spans.length];
  const last = spans[bestIndex];
  const start = first.start;
  const end = last.end <= start ? last.end + DAY : last.end;
  return { start, end };
}

/** The legacy open/close pair ("HH:mm:00") for the business day. */
export function openCloseFromFrames(frames: OperatingFrame[]): {
  openTime: string;
  closeTime: string;
} | null {
  const day = businessDayOf(frames);
  if (!day) return null;
  if (day.end - day.start >= DAY) {
    // Open around the clock: the pair cannot say it (open = close is refused).
    return { openTime: '00:00:00', closeTime: '23:59:00' };
  }
  return {
    openTime: `${frameClock(day.start)}:00`,
    closeTime: `${frameClock(day.end % DAY)}:00`,
  };
}
