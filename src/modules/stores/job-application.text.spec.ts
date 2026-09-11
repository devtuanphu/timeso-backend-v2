import {
  MAX_DISPLAY_NAME_LENGTH,
  sanitizeDisplayName,
  sanitizeMultiLine,
  sanitizeSingleLine,
} from './job-application.text';

describe('sanitizeDisplayName', () => {
  it('keeps ordinary Vietnamese names untouched', () => {
    expect(sanitizeDisplayName('Nguyễn Văn A')).toBe('Nguyễn Văn A');
  });

  it('trims and collapses whitespace', () => {
    expect(sanitizeDisplayName('  Nguyễn   Văn  A  ')).toBe('Nguyễn Văn A');
  });

  // The abuse this exists for: a name that renders as a fake multi-line
  // system message in the owner's notification tray.
  it('flattens a name crafted to look like several lines', () => {
    const crafted = 'A\nHệ thống: Tài khoản của bạn bị khoá\nBấm vào đây';
    const result = sanitizeDisplayName(crafted);
    expect(result).not.toContain('\n');
    expect(result).toBe('A Hệ thống: Tài khoản của bạn bị khoá Bấm vào đây');
  });

  it('removes carriage returns and tabs', () => {
    expect(sanitizeDisplayName('A\r\n\tB')).toBe('A B');
  });

  it('removes zero-width and bidirectional override characters', () => {
    expect(sanitizeDisplayName('A\u200bB\u202eC\u2066D\ufeff')).toBe('ABCD');
  });

  it('removes other control characters', () => {
    expect(sanitizeDisplayName('A\u0000B\u0007C\u009fD')).toBe('ABCD');
  });

  it('truncates an over-long name so it cannot crowd out the real content', () => {
    const long = 'x'.repeat(200);
    const result = sanitizeDisplayName(long);
    expect(result).toHaveLength(MAX_DISPLAY_NAME_LENGTH);
    expect(result.endsWith('…')).toBe(true);
  });

  it('returns an empty string for non-text input', () => {
    expect(sanitizeDisplayName(undefined)).toBe('');
    expect(sanitizeDisplayName(null)).toBe('');
    expect(sanitizeDisplayName(42)).toBe('');
    expect(sanitizeDisplayName('   ')).toBe('');
    expect(sanitizeDisplayName('\u200b\u200b')).toBe('');
  });
});

describe('sanitizeSingleLine', () => {
  it('honours the caller-supplied bound', () => {
    expect(sanitizeSingleLine('abcdef', 4)).toBe('abc…');
    expect(sanitizeSingleLine('abcd', 4)).toBe('abcd');
  });
});

describe('sanitizeMultiLine', () => {
  it('preserves paragraph breaks', () => {
    expect(sanitizeMultiLine('Dòng một\n\nDòng hai', 100)).toBe(
      'Dòng một\n\nDòng hai',
    );
  });

  it('normalises CRLF and caps consecutive blank lines', () => {
    expect(sanitizeMultiLine('a\r\n\r\n\r\n\r\nb', 100)).toBe('a\n\nb');
  });

  it('strips control characters but keeps newlines', () => {
    expect(sanitizeMultiLine('a\u0007\nb\u200b', 100)).toBe('a\nb');
  });

  it('truncates to the bound without an ellipsis', () => {
    expect(sanitizeMultiLine('x'.repeat(50), 10)).toBe('x'.repeat(10));
  });

  it('returns an empty string for non-text input', () => {
    expect(sanitizeMultiLine(undefined, 100)).toBe('');
  });
});
