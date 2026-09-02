import { ConfigService } from '@nestjs/config';

import {
  createJwtModuleOptions,
  JWT_REFRESH_SECRET_REQUIRED,
  JWT_SECRET_REQUIRED,
  JWT_SECRETS_MUST_DIFFER,
  JWT_LEGACY_WINDOW_INVALID,
  getLegacyUntypedTokenWindow,
  isLegacyUntypedTokenAccepted,
  isLegacyUntypedAccessAccepted,
  JWT_LEGACY_ATTESTATION_INVALID,
  requireJwtRefreshSecret,
  requireJwtSecret,
} from './jwt.config';

const config = (values: Record<string, unknown>) =>
  ({ get: jest.fn((key: string) => values[key]) }) as unknown as ConfigService;

describe('JWT configuration', () => {
  it('fails startup when JWT_SECRET is absent or blank', () => {
    expect(() => requireJwtSecret(config({}))).toThrow(JWT_SECRET_REQUIRED);
    expect(() => requireJwtSecret(config({ JWT_SECRET: '   ' }))).toThrow(
      JWT_SECRET_REQUIRED,
    );
  });

  it('uses the explicit configured secret without rewriting it', () => {
    expect(
      createJwtModuleOptions(
        config({
          JWT_SECRET: 'test-only-secret',
          JWT_REFRESH_SECRET: 'test-only-refresh-secret',
          JWT_EXPIRES_IN: '15m',
        }),
      ),
    ).toMatchObject({
      secret: 'test-only-secret',
      signOptions: { expiresIn: '15m' },
    });
  });

  it('fails startup when the refresh secret is absent or blank', () => {
    expect(() =>
      requireJwtRefreshSecret(config({ JWT_SECRET: 'access-secret' })),
    ).toThrow(JWT_REFRESH_SECRET_REQUIRED);
    expect(() =>
      requireJwtRefreshSecret(
        config({ JWT_SECRET: 'access-secret', JWT_REFRESH_SECRET: '   ' }),
      ),
    ).toThrow(JWT_REFRESH_SECRET_REQUIRED);
  });

  it('fails startup when access and refresh secrets are equal', () => {
    expect(() =>
      createJwtModuleOptions(
        config({ JWT_SECRET: 'same-secret', JWT_REFRESH_SECRET: 'same-secret' }),
      ),
    ).toThrow(JWT_SECRETS_MUST_DIFFER);
  });

  it('keeps the legacy untyped window disabled when both values are absent', () => {
    expect(getLegacyUntypedTokenWindow(config({}))).toBeNull();
    expect(isLegacyUntypedTokenAccepted(config({}), Date.now())).toBe(false);
  });

  it.each([
    [{ JWT_LEGACY_UNTYPED_WINDOW_STARTED_AT: 'invalid', JWT_LEGACY_UNTYPED_CUTOFF_AT: '2026-08-30T00:00:00Z' }],
    [{ JWT_LEGACY_UNTYPED_WINDOW_STARTED_AT: '2026-08-29T00:00:00Z' }],
    [{ JWT_LEGACY_UNTYPED_WINDOW_STARTED_AT: '2026-08-01T00:00:00Z', JWT_LEGACY_UNTYPED_CUTOFF_AT: '2026-08-10T00:00:00Z' }],
  ])('rejects malformed, partial, or longer-than-seven-day windows', (values) => {
    expect(() => getLegacyUntypedTokenWindow(config(values))).toThrow(
      JWT_LEGACY_WINDOW_INVALID,
    );
  });

  it('accepts untyped tokens only inside the absolute bounded window', () => {
    const values = config({
      JWT_LEGACY_UNTYPED_WINDOW_STARTED_AT: '2026-08-29T00:00:00Z',
      JWT_LEGACY_UNTYPED_CUTOFF_AT: '2026-09-05T00:00:00Z',
    });
    expect(isLegacyUntypedTokenAccepted(values, Date.parse('2026-08-30T00:00:00Z'))).toBe(true);
    expect(isLegacyUntypedTokenAccepted(values, Date.parse('2026-09-05T00:00:00Z'))).toBe(false);
    expect(isLegacyUntypedAccessAccepted(values, Date.parse('2026-08-30T00:00:00Z'))).toBe(false);
  });

  it('accepts untyped access only with an explicit strict attestation', () => {
    const values = config({
      JWT_LEGACY_UNTYPED_WINDOW_STARTED_AT: '2026-08-29T00:00:00Z',
      JWT_LEGACY_UNTYPED_CUTOFF_AT: '2026-09-05T00:00:00Z',
      JWT_LEGACY_UNTYPED_ACCESS_ATTESTED: 'true',
    });
    expect(isLegacyUntypedAccessAccepted(values, Date.parse('2026-08-30T00:00:00Z'))).toBe(true);
    expect(() => isLegacyUntypedAccessAccepted(config({
      JWT_LEGACY_UNTYPED_ACCESS_ATTESTED: 'yes',
    }))).toThrow(JWT_LEGACY_ATTESTATION_INVALID);
  });
});
