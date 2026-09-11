import { hashOtp, matchesStoredOtp } from './otp-hash';

const SECRET = 'server-secret-value';

describe('otp hashing', () => {
  it('produces a stable 64-character hex digest', () => {
    const digest = hashOtp('123456', SECRET);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOtp('123456', SECRET)).toBe(digest);
  });

  it('never stores the code itself', () => {
    expect(hashOtp('123456', SECRET)).not.toContain('123456');
  });

  // Reversing a six-digit code offline must additionally require the secret.
  it('changes completely when the server secret changes', () => {
    expect(hashOtp('123456', SECRET)).not.toBe(hashOtp('123456', 'other-secret'));
  });

  it('distinguishes different codes', () => {
    expect(hashOtp('123456', SECRET)).not.toBe(hashOtp('123457', SECRET));
  });

  it('matches a hashed row', () => {
    const stored = hashOtp('123456', SECRET);
    expect(matchesStoredOtp(stored, '123456', SECRET)).toBe(true);
    expect(matchesStoredOtp(stored, '654321', SECRET)).toBe(false);
  });

  // Rows written by the previous build hold plaintext and must stay usable
  // until they expire.
  it('still matches a legacy plaintext row', () => {
    expect(matchesStoredOtp('123456', '123456', SECRET)).toBe(true);
    expect(matchesStoredOtp('123456', '999999', SECRET)).toBe(false);
  });

  it('rejects empty input on either side', () => {
    expect(matchesStoredOtp('', '123456', SECRET)).toBe(false);
    expect(matchesStoredOtp(hashOtp('123456', SECRET), '', SECRET)).toBe(false);
  });

  it('does not match a hash submitted as the code', () => {
    const stored = hashOtp('123456', SECRET);
    expect(matchesStoredOtp(stored, stored, SECRET)).toBe(false);
  });
});
