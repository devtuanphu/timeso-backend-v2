import { ConfigService } from '@nestjs/config';
import type { JwtModuleOptions } from '@nestjs/jwt';

export const JWT_SECRET_REQUIRED = 'JWT_SECRET_REQUIRED';
export const JWT_REFRESH_SECRET_REQUIRED = 'JWT_REFRESH_SECRET_REQUIRED';
export const JWT_SECRETS_MUST_DIFFER = 'JWT_SECRETS_MUST_DIFFER';
export const JWT_LEGACY_WINDOW_INVALID = 'JWT_LEGACY_WINDOW_INVALID';
export const JWT_LEGACY_ATTESTATION_INVALID = 'JWT_LEGACY_ATTESTATION_INVALID';
export const JWT_LEGACY_ACCESS_ATTESTED =
  'JWT_LEGACY_UNTYPED_ACCESS_ATTESTED';
export const JWT_LEGACY_WINDOW_STARTED_AT =
  'JWT_LEGACY_UNTYPED_WINDOW_STARTED_AT';
export const JWT_LEGACY_WINDOW_CUTOFF_AT =
  'JWT_LEGACY_UNTYPED_CUTOFF_AT';
const MAX_LEGACY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

export const JWT_ACCESS_TOKEN_USE = 'access' as const;
export const JWT_REFRESH_TOKEN_USE = 'refresh' as const;

export interface TimesoJwtPayload {
  sub: string;
  email?: string;
  tokenUse: typeof JWT_ACCESS_TOKEN_USE | typeof JWT_REFRESH_TOKEN_USE;
}

interface LegacyTokenWindow {
  startedAt: number;
  cutoffAt: number;
}

export const getLegacyUntypedTokenWindow = (
  configService: ConfigService,
): LegacyTokenWindow | null => {
  const startValue = configService.get<string>(JWT_LEGACY_WINDOW_STARTED_AT);
  const cutoffValue = configService.get<string>(JWT_LEGACY_WINDOW_CUTOFF_AT);
  if (!startValue && !cutoffValue) return null;
  const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (
    typeof startValue !== 'string' ||
    typeof cutoffValue !== 'string' ||
    !rfc3339.test(startValue) ||
    !rfc3339.test(cutoffValue)
  ) {
    throw new Error(JWT_LEGACY_WINDOW_INVALID);
  }
  const startedAt = Date.parse(startValue);
  const cutoffAt = Date.parse(cutoffValue);
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(cutoffAt) ||
    cutoffAt <= startedAt ||
    cutoffAt - startedAt > MAX_LEGACY_WINDOW_MS
  ) {
    throw new Error(JWT_LEGACY_WINDOW_INVALID);
  }
  return { startedAt, cutoffAt };
};

export const isLegacyUntypedTokenAccepted = (
  configService: ConfigService,
  now = Date.now(),
): boolean => {
  const window = getLegacyUntypedTokenWindow(configService);
  return !!window && now >= window.startedAt && now < window.cutoffAt;
};

export const isLegacyUntypedAccessAttested = (
  configService: ConfigService,
): boolean => {
  const value = configService.get<string | boolean>(JWT_LEGACY_ACCESS_ATTESTED);
  if (value === undefined || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw new Error(JWT_LEGACY_ATTESTATION_INVALID);
};

export const isLegacyUntypedAccessAccepted = (
  configService: ConfigService,
  now = Date.now(),
): boolean =>
  isLegacyUntypedAccessAttested(configService) &&
  isLegacyUntypedTokenAccepted(configService, now);

export const requireJwtSecret = (configService: ConfigService): string => {
  const secret = configService.get<string>('JWT_SECRET');
  if (typeof secret !== 'string' || secret.trim().length === 0) {
    throw new Error(JWT_SECRET_REQUIRED);
  }
  return secret;
};

export const requireJwtRefreshSecret = (
  configService: ConfigService,
): string => {
  const refreshSecret = configService.get<string>('JWT_REFRESH_SECRET');
  if (
    typeof refreshSecret !== 'string' ||
    refreshSecret.trim().length === 0
  ) {
    throw new Error(JWT_REFRESH_SECRET_REQUIRED);
  }
  if (refreshSecret === requireJwtSecret(configService)) {
    throw new Error(JWT_SECRETS_MUST_DIFFER);
  }
  return refreshSecret;
};

export const createJwtModuleOptions = (
  configService: ConfigService,
): JwtModuleOptions => {
  const secret = requireJwtSecret(configService);
  // Validate the refresh credential during startup too. A shared or missing
  // secret would allow a refresh token to be accepted as an access token.
  requireJwtRefreshSecret(configService);
  getLegacyUntypedTokenWindow(configService);
  isLegacyUntypedAccessAttested(configService);
  return {
    secret,
    signOptions: {
      expiresIn: (configService.get<string>('JWT_EXPIRES_IN') || '1h') as never,
    },
  };
};
