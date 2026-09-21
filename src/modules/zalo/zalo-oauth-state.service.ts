import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

import {
  ZALO_ADMIN_ACCOUNT_IDS_ENV,
  parseZaloAdminAccountIds,
} from './zalo-admin.guard';

/** How long an issued OAuth `state` stays usable. */
export const ZALO_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
/** Bound on outstanding (issued, unused, unexpired) states. */
export const ZALO_OAUTH_STATE_MAX_OUTSTANDING = 100;

export type ZaloOAuthStateRejection =
  | 'missing'
  | 'malformed'
  | 'bad-signature'
  | 'expired'
  | 'unknown-or-used'
  | 'not-admin';

export type ZaloOAuthStateResult =
  | { ok: true; accountId: string }
  | { ok: false; reason: ZaloOAuthStateRejection };

interface StatePayload {
  /** Single-use id. */
  jti: string;
  /** Admin account the state was issued to. */
  sub: string;
  /** Expiry, epoch ms. */
  exp: number;
}

/**
 * Single-use OAuth `state` for the Zalo OA permission flow.
 *
 * `GET /zalo/oauth-callback` is public (Zalo redirects a browser to it), so
 * the constant `state=timeso` let anyone who authorized the app on their own
 * OA install their token as the system ZNS token. Now `oauth-url` (admin
 * only) issues `base64url(payload).hmac` bound to the admin account, valid
 * for 10 minutes, and the callback consumes it exactly once.
 *
 * Single-use tracking is in process memory: issued ids live in a map until
 * consumed or expired. The API enforces a single running instance
 * (`ChatSingleInstanceRuntimeGuardService`), so that map is authoritative.
 * Limitation: a restart forgets outstanding states (the admin requests a new
 * URL), and if the app is ever scaled out the callback must reach the
 * instance that issued the state, or this must move to shared storage.
 */
@Injectable()
export class ZaloOAuthStateService {
  private readonly outstanding = new Map<string, StatePayload>();

  constructor(private readonly configService: ConfigService) {}

  /** Issues a fresh state for `accountId` (an allowlisted admin). */
  issue(accountId: string, now = Date.now()): string {
    this.prune(now);
    if (this.outstanding.size >= ZALO_OAUTH_STATE_MAX_OUTSTANDING) {
      // Drop the oldest; Map iteration is insertion order.
      const oldest = this.outstanding.keys().next().value;
      if (oldest !== undefined) this.outstanding.delete(oldest);
    }
    const payload: StatePayload = {
      jti: randomUUID(),
      sub: accountId,
      exp: now + ZALO_OAUTH_STATE_TTL_MS,
    };
    this.outstanding.set(payload.jti, payload);
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  /**
   * Verifies and consumes `state`. Every failure is final: a state that was
   * presented once cannot be presented again.
   */
  consume(state: unknown, now = Date.now()): ZaloOAuthStateResult {
    this.prune(now);
    if (typeof state !== 'string' || !state) {
      return { ok: false, reason: 'missing' };
    }
    const parts = state.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { ok: false, reason: 'malformed' };
    }
    const [body, signature] = parts;
    let expected: Buffer;
    try {
      expected = Buffer.from(this.sign(body));
    } catch {
      return { ok: false, reason: 'bad-signature' };
    }
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return { ok: false, reason: 'bad-signature' };
    }

    let payload: StatePayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return { ok: false, reason: 'malformed' };
    }
    if (
      typeof payload?.jti !== 'string' ||
      typeof payload?.sub !== 'string' ||
      typeof payload?.exp !== 'number'
    ) {
      return { ok: false, reason: 'malformed' };
    }

    const issued = this.outstanding.get(payload.jti);
    // Consume first so no path can accept the same state twice.
    this.outstanding.delete(payload.jti);
    if (payload.exp <= now) return { ok: false, reason: 'expired' };
    if (!issued || issued.sub !== payload.sub || issued.exp !== payload.exp) {
      return { ok: false, reason: 'unknown-or-used' };
    }
    // The admin may have been removed from the allowlist since.
    const admins = parseZaloAdminAccountIds(
      this.configService.get<string>(ZALO_ADMIN_ACCOUNT_IDS_ENV),
    );
    if (!admins.has(payload.sub)) return { ok: false, reason: 'not-admin' };
    return { ok: true, accountId: payload.sub };
  }

  private prune(now: number): void {
    for (const [jti, payload] of this.outstanding) {
      if (payload.exp <= now) this.outstanding.delete(jti);
    }
  }

  private sign(body: string): string {
    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret) {
      // Never sign with an empty key; the callback then rejects everything.
      throw new Error('JWT_SECRET is required to sign the Zalo OAuth state');
    }
    return createHmac('sha256', `${secret}:zalo_oauth_state`)
      .update(body)
      .digest('base64url');
  }
}
