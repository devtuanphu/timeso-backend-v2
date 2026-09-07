import {
  legacyNormalizedPhoneSql,
  normalizeEmail,
  normalizeVietnamPhone,
} from './account-identifier';

describe('account identifiers', () => {
  it.each([
    ['0901234567', '0901234567'],
    ['+84 901 234 567', '0901234567'],
    ['84-901-234-567', '0901234567'],
    ['(090) 123.4567', '0901234567'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeVietnamPhone(input)).toBe(expected);
  });

  it.each(['', 'abc', '+12025550123', '09012'])('rejects invalid phone %s', (input) => {
    expect(() => normalizeVietnamPhone(input)).toThrow('INVALID_VIETNAM_PHONE');
  });

  it('normalizes email without changing the local-part structure', () => {
    expect(normalizeEmail('  Staff.User@Example.COM ')).toBe(
      'staff.user@example.com',
    );
  });

  it('provides a legacy-compatible SQL expression', () => {
    expect(legacyNormalizedPhoneSql('account.phone')).toContain(
      "regexp_replace(account.phone",
    );
  });
});

