import { ConfigService } from '@nestjs/config';

export const CHAT_REALTIME_CONFIG = Symbol('CHAT_REALTIME_CONFIG');

export const CHAT_HEALTH_INTERVAL_MS = 5_000;
export const CHAT_HEALTH_QUERY_TIMEOUT_MS = 3_000;
export const CHAT_FATAL_SHUTDOWN_MS = 5_000;
export const CHAT_OUTBOX_POLL_MS = 250;

export interface ChatRealtimeConfig {
  legacyConnectionEnabled: boolean;
  legacyMutationEnabled: boolean;
  legacyWindowStartedAt: Date | null;
  legacyCutoffAt: Date | null;
  singletonGuardMode: 'required' | 'disabled';
}

const parseStrictBoolean = (value: unknown, name: string): boolean => {
  if (value === undefined || value === null || value === '') return false;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${name} must be true or false`);
};

const parseDate = (value: unknown, name: string): Date => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    throw new Error(`${name} must be an RFC3339 timestamp`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${name} must be an RFC3339 timestamp`);
  }
  return date;
};

const isIsolatedLocalDatabase = (config: ConfigService): boolean => {
  const environment = (config.get<string>('NODE_ENV') || '').toLowerCase();
  const isolated = parseStrictBoolean(
    config.get<string | boolean>('TIMESO_ISOLATED_DB'),
    'TIMESO_ISOLATED_DB',
  );
  const databaseName = config.get<string>('DATABASE_NAME') || '';
  return (
    (environment === 'test' || environment === 'development') &&
    isolated &&
    (databaseName.endsWith('_test') || databaseName.endsWith('_local'))
  );
};

export const createChatRealtimeConfig = (
  config: ConfigService,
  now = new Date(),
): ChatRealtimeConfig => {
  let legacyConnectionEnabled = parseStrictBoolean(
    config.get<string | boolean>('CHAT_LEGACY_SOCKET_CONNECTION_ENABLED'),
    'CHAT_LEGACY_SOCKET_CONNECTION_ENABLED',
  );
  let legacyMutationEnabled = parseStrictBoolean(
    config.get<string | boolean>('CHAT_LEGACY_SOCKET_MUTATION_ENABLED'),
    'CHAT_LEGACY_SOCKET_MUTATION_ENABLED',
  );

  if (legacyMutationEnabled && !legacyConnectionEnabled) {
    throw new Error(
      'CHAT_LEGACY_SOCKET_MUTATION_ENABLED requires legacy connections',
    );
  }

  let legacyWindowStartedAt: Date | null = null;
  let legacyCutoffAt: Date | null = null;
  if (legacyConnectionEnabled) {
    legacyWindowStartedAt = parseDate(
      config.get('CHAT_LEGACY_SOCKET_WINDOW_STARTED_AT'),
      'CHAT_LEGACY_SOCKET_WINDOW_STARTED_AT',
    );
    legacyCutoffAt = parseDate(
      config.get('CHAT_LEGACY_SOCKET_CUTOFF_AT'),
      'CHAT_LEGACY_SOCKET_CUTOFF_AT',
    );
    const windowMs = legacyCutoffAt.getTime() - legacyWindowStartedAt.getTime();
    if (windowMs <= 0 || windowMs > 14 * 24 * 60 * 60 * 1_000) {
      throw new Error('Legacy socket window must be greater than zero and at most 14 days');
    }
    if (now.getTime() >= legacyCutoffAt.getTime()) {
      legacyConnectionEnabled = false;
      legacyMutationEnabled = false;
    }
  }

  const guardValue = (
    config.get<string>('CHAT_SINGLETON_GUARD_MODE') || 'required'
  ).toLowerCase();
  if (guardValue !== 'required' && guardValue !== 'disabled') {
    throw new Error('CHAT_SINGLETON_GUARD_MODE must be required or disabled');
  }
  if (guardValue === 'disabled' && !isIsolatedLocalDatabase(config)) {
    throw new Error(
      'CHAT_SINGLETON_GUARD_MODE=disabled is allowed only for an isolated test/local database',
    );
  }

  return {
    legacyConnectionEnabled,
    legacyMutationEnabled,
    legacyWindowStartedAt,
    legacyCutoffAt,
    singletonGuardMode: guardValue,
  };
};
