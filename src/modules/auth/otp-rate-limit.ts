/**
 * OTP abuse limits.
 *
 * A six-digit code with unlimited attempts is brute-forceable, and nothing in
 * the project rate-limits `verify-otp`, `resend-otp` or `forgot-password`.
 * `@nestjs/throttler` is not a dependency here, so the limits are implemented
 * directly:
 *
 *  - **Send throttling** is derived from `account_otps.created_at`, which is
 *    already persisted. It is durable and correct across processes.
 *  - **Verify throttling** is an in-process sliding window. It is intentionally
 *    simple and its weakness is worth stating: with several PM2 workers an
 *    attacker gets the limit once per worker. It still turns an unbounded
 *    brute force into a bounded one, and pairs with the send limit that caps
 *    how many live codes can exist. Move this to Redis (already a dependency
 *    for BullMQ) when a shared limiter is warranted.
 */

/** Codes that may be requested for one account within the send window. */
export const OTP_SEND_LIMIT = 5;
export const OTP_SEND_WINDOW_MS = 15 * 60 * 1000;

/** Failed verifications tolerated for one account within the verify window. */
export const OTP_VERIFY_LIMIT = 10;
export const OTP_VERIFY_WINDOW_MS = 15 * 60 * 1000;

export interface SlidingWindowOptions {
  limit: number;
  windowMs: number;
  /** Guards against unbounded growth from many distinct keys. */
  maxKeys?: number;
}

/**
 * A fixed-capacity sliding-window counter. `hit` records an attempt and returns
 * whether the caller is now over the limit.
 */
export class SlidingWindowCounter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly options: SlidingWindowOptions) {}

  private prune(key: string, now: number): number[] {
    const cutoff = now - this.options.windowMs;
    const kept = (this.hits.get(key) ?? []).filter((at) => at > cutoff);
    if (kept.length) this.hits.set(key, kept);
    else this.hits.delete(key);
    return kept;
  }

  /** Current attempt count for a key, excluding expired entries. */
  count(key: string, now = Date.now()): number {
    return this.prune(key, now).length;
  }

  /** Records an attempt. Returns true when the key is over its limit. */
  hit(key: string, now = Date.now()): boolean {
    const kept = this.prune(key, now);
    kept.push(now);
    this.hits.set(key, kept);

    const maxKeys = this.options.maxKeys ?? 10_000;
    if (this.hits.size > maxKeys) {
      // Drop the oldest-inserted key; Map preserves insertion order.
      const oldest = this.hits.keys().next();
      if (!oldest.done) this.hits.delete(oldest.value);
    }
    return kept.length > this.options.limit;
  }

  /** Clears a key, e.g. after a successful verification. */
  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Test-only. */
  clear(): void {
    this.hits.clear();
  }
}

/** True when another code may not be sent yet. */
export function isOverSendLimit(recentSendCount: number): boolean {
  return recentSendCount >= OTP_SEND_LIMIT;
}
