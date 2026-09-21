import { ZaloController } from './zalo.controller';
import {
  ZALO_OAUTH_STATE_TTL_MS,
  ZaloOAuthStateService,
} from './zalo-oauth-state.service';

const ADMIN = 'admin-account';

function config(values: Record<string, string | undefined> = {}) {
  const all: Record<string, string | undefined> = {
    JWT_SECRET: 'test-secret',
    ZALO_ADMIN_ACCOUNT_IDS: ADMIN,
    ...values,
  };
  return { get: jest.fn((key: string) => all[key]) } as any;
}

describe('ZaloOAuthStateService', () => {
  it('accepts a state it issued exactly once', () => {
    const service = new ZaloOAuthStateService(config());
    const state = service.issue(ADMIN);
    expect(service.consume(state)).toEqual({ ok: true, accountId: ADMIN });
    expect(service.consume(state)).toEqual({ ok: false, reason: 'unknown-or-used' });
  });

  it('rejects a missing, constant or tampered state', () => {
    const service = new ZaloOAuthStateService(config());
    expect(service.consume(undefined)).toEqual({ ok: false, reason: 'missing' });
    expect(service.consume('timeso')).toEqual({ ok: false, reason: 'malformed' });

    const [body, signature] = service.issue(ADMIN).split('.');
    const forged = Buffer.from(
      JSON.stringify({ jti: 'x', sub: 'attacker', exp: Date.now() + 1000 }),
    ).toString('base64url');
    expect(service.consume(`${forged}.${signature}`)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
    expect(service.consume(`${body}.${signature}x`)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('rejects a state signed with another secret', () => {
    const other = new ZaloOAuthStateService(config({ JWT_SECRET: 'other' }));
    const service = new ZaloOAuthStateService(config());
    expect(service.consume(other.issue(ADMIN))).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('rejects an expired state, and it stays unusable', () => {
    const service = new ZaloOAuthStateService(config());
    const issuedAt = 1_000_000;
    const state = service.issue(ADMIN, issuedAt);
    expect(service.consume(state, issuedAt + ZALO_OAUTH_STATE_TTL_MS)).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(service.consume(state, issuedAt + 1)).toEqual({
      ok: false,
      reason: 'unknown-or-used',
    });
  });

  it('rejects a state whose admin left the allowlist', () => {
    const values: Record<string, string> = { ZALO_ADMIN_ACCOUNT_IDS: ADMIN };
    const cfg = config();
    cfg.get.mockImplementation((key: string) =>
      key === 'JWT_SECRET' ? 'test-secret' : values[key],
    );
    const service = new ZaloOAuthStateService(cfg);
    const state = service.issue(ADMIN);
    values.ZALO_ADMIN_ACCOUNT_IDS = 'someone-else';
    expect(service.consume(state)).toEqual({ ok: false, reason: 'not-admin' });
  });
});

describe('ZaloController OAuth flow', () => {
  function build() {
    const zaloService = {
      exchangeCodeForToken: jest.fn().mockResolvedValue({ message: 'ok' }),
    };
    const cfg = config({ ZALO_APP_ID: 'app', ZALO_REDIRECT_URI: 'https://api/cb' });
    const states = new ZaloOAuthStateService(cfg);
    const controller = new ZaloController(zaloService as any, cfg, states);
    const res = () => {
      const response: any = {};
      response.status = jest.fn(() => response);
      response.send = jest.fn(() => response);
      return response;
    };
    return { controller, zaloService, res };
  }

  it('puts a signed single-use state in the permission URL', () => {
    const { controller } = build();
    const { url } = controller.getOAuthUrl({ userId: ADMIN });
    const state = new URL(url).searchParams.get('state');
    expect(state).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(url).not.toContain('state=timeso');
  });

  it('refuses the callback without a valid state and never installs a token', async () => {
    const { controller, zaloService, res } = build();
    for (const state of [undefined, 'timeso', 'a.b']) {
      const response = res();
      await controller.oauthCallback('code', state as any, response);
      expect(response.status).toHaveBeenCalledWith(400);
    }
    expect(zaloService.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('exchanges the code once for an issued state, and refuses a replay', async () => {
    const { controller, zaloService, res } = build();
    const state = new URL(controller.getOAuthUrl({ userId: ADMIN }).url).searchParams.get(
      'state',
    )!;
    await controller.oauthCallback('code', state, res());
    expect(zaloService.exchangeCodeForToken).toHaveBeenCalledTimes(1);

    const replay = res();
    await controller.oauthCallback('code-2', state, replay);
    expect(replay.status).toHaveBeenCalledWith(400);
    expect(zaloService.exchangeCodeForToken).toHaveBeenCalledTimes(1);
  });
});
