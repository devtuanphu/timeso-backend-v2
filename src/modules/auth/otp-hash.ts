import { createHmac, timingSafeEqual } from 'crypto';

/**
 * OTP codes at rest.
 *
 * `account_otps.otp` held the six-digit code in plaintext, so anyone able to
 * read the table could complete a password reset for any account. Codes are now
 * stored as an HMAC.
 *
 * A six-digit code has only a million possibilities, so a plain digest would be
 * trivially reversible offline. The HMAC key is derived from `JWT_SECRET` with a
 * fixed context label, which means reversing a stored value requires the server
 * secret as well — and keeps this key separate from token signing.
 *
 * The digest is 64 hex characters and the column is a varchar(255), so no schema
 * change is needed.
 */

const OTP_HASH_CONTEXT = 'timeso:otp-hash:v1';

/** Shape of a code issued by the previous, plaintext build. */
const LEGACY_OTP_PATTERN = /^\d{6}$/;

function deriveKey(serverSecret: string): Buffer {
  return createHmac('sha256', serverSecret).update(OTP_HASH_CONTEXT).digest();
}

export function hashOtp(code: string, serverSecret: string): string {
  return createHmac('sha256', deriveKey(serverSecret)).update(code).digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Compares a submitted code against the stored value.
 *
 * Accepts a legacy plaintext row so codes issued by the previous build remain
 * usable. Those rows expire within the OTP lifetime, after which this fallback
 * can be deleted.
 */
export function matchesStoredOtp(
  storedValue: string,
  submittedCode: string,
  serverSecret: string,
): boolean {
  if (!storedValue || !submittedCode) return false;
  if (constantTimeEquals(storedValue, hashOtp(submittedCode, serverSecret))) {
    return true;
  }
  // The legacy branch is restricted to values shaped like an actual code.
  // Without this, someone holding the stored digest could submit it verbatim
  // and authenticate, which would defeat hashing the column at all.
  if (!LEGACY_OTP_PATTERN.test(submittedCode)) return false;
  return constantTimeEquals(storedValue, submittedCode);
}
