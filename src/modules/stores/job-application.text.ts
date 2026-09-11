/**
 * Applicant-authored text that reaches other people's screens.
 *
 * `fullName` is submitted by the applicant and is interpolated into the store
 * owner's notification title/body and Expo push payload. Left raw it is a
 * formatting-injection surface: newlines and control characters let an
 * applicant compose text that renders as several lines and imitates a system
 * message, and an over-long value pushes the real content out of a push banner.
 *
 * Sanitising happens on the way in, so what is stored is already clean, and
 * again when composing a notification, so a row written by an older build
 * cannot bypass it.
 */

/**
 * Characters removed outright: non-whitespace C0/C1 controls, zero-width
 * characters, and bidirectional overrides that can visually reorder text.
 *
 * Whitespace-like controls (tab, newline, carriage return, vertical tab, form
 * feed) are deliberately NOT in this class. They are folded into a single
 * space instead, so "A\nB" reads as "A B" rather than silently becoming "AB"
 * and joining two separate words.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS =
  /[\u0000-\u0008\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** Keeps a name readable in a one-line push banner. */
export const MAX_DISPLAY_NAME_LENGTH = 60;

/**
 * Collapses a user-supplied string to a single safe line.
 * Returns an empty string for anything that is not usable text.
 */
export function sanitizeSingleLine(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .replace(UNSAFE_CHARS, '')
    // Any whitespace run, including newlines and tabs, becomes one space.
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Name as shown to a store owner in a notification. */
export function sanitizeDisplayName(value: unknown): string {
  return sanitizeSingleLine(value, MAX_DISPLAY_NAME_LENGTH);
}

/**
 * Multi-line free text (the applicant's introduction). Paragraph breaks are
 * preserved because the owner reads it in a normal text view, but control
 * characters are removed and the length is bounded.
 */
export function sanitizeMultiLine(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .replace(/\r\n?/g, '\n')
    // The class excludes newline, so paragraph breaks survive untouched.
    .replace(UNSAFE_CHARS, '')
    .replace(/[\u000B\u000C]/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned.length <= maxLength
    ? cleaned
    : cleaned.slice(0, maxLength).trimEnd();
}
