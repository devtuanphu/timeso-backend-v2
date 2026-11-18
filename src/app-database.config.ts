import { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

import { isAppReadOnlyMode } from './common/utils/app-read-only-mode';

type SchemaMode = 'managed' | 'bootstrap';

const normalizeEnvironment = (value?: string): string =>
  (value || '').trim().toLowerCase();

const isTrue = (value: unknown): boolean =>
  value === true ||
  (typeof value === 'string' && value.trim().toLowerCase() === 'true');

const resolveSchemaMode = (configService: ConfigService): SchemaMode => {
  const configured = normalizeEnvironment(
    configService.get<string>('DATABASE_SCHEMA_MODE'),
  );

  if (!configured || configured === 'managed') {
    return 'managed';
  }
  if (configured === 'bootstrap') {
    return 'bootstrap';
  }

  throw new Error('DATABASE_SCHEMA_MODE must be managed or bootstrap');
};

/**
 * A positive-integer env override, or the default when unset or invalid
 * (empty, non-numeric, zero, negative, fractional, non-finite).
 */
const positiveIntEnv = (
  configService: ConfigService,
  key: string,
  fallback: number,
): number => {
  const raw = configService.get<string | number>(key);
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const canBootstrapSchema = (configService: ConfigService): boolean => {
  const environment = normalizeEnvironment(
    configService.get<string>('NODE_ENV'),
  );
  const databaseName = configService.get<string>('DATABASE_NAME') || '';

  return (
    (environment === 'test' || environment === 'development') &&
    isTrue(configService.get<string | boolean>('TIMESO_ISOLATED_DB')) &&
    (databaseName.endsWith('_test') || databaseName.endsWith('_local'))
  );
};

export const createAppTypeOrmOptions = (
  configService: ConfigService,
): TypeOrmModuleOptions => {
  const readOnly = isAppReadOnlyMode(configService);
  const schemaMode = resolveSchemaMode(configService);

  if (schemaMode === 'bootstrap' && (readOnly || !canBootstrapSchema(configService))) {
    throw new Error(
      'DATABASE_SCHEMA_MODE=bootstrap requires a writable isolated test/development database ending in _test or _local',
    );
  }

  // Safety net for a future pool deadlock: cap how long a query waits for a
  // free pooled connection, and let Postgres kill a connection left "idle in
  // transaction". Without these the backend hangs for hours instead of
  // self-healing (see the 2026-11-17 incident). Pool `max` is left untouched.
  const acquireTimeoutMs = positiveIntEnv(
    configService,
    'DATABASE_POOL_ACQUIRE_TIMEOUT_MS',
    60000,
  );
  const idleInTxTimeoutMs = positiveIntEnv(
    configService,
    'DATABASE_IDLE_IN_TX_TIMEOUT_MS',
    600000,
  );
  // Both `-c` flags must survive in read-only mode, so compose `options` from
  // the (optional) read-only flag plus the idle-in-transaction timeout.
  const options = [
    ...(readOnly ? ['-c default_transaction_read_only=on'] : []),
    `-c idle_in_transaction_session_timeout=${idleInTxTimeoutMs}`,
  ].join(' ');

  return {
    type: 'postgres',
    host: configService.get<string>('DATABASE_HOST'),
    port: configService.get<number>('DATABASE_PORT'),
    username: configService.get<string>('DATABASE_USER'),
    password: configService.get<string>('DATABASE_PASSWORD'),
    database: configService.get<string>('DATABASE_NAME'),
    autoLoadEntities: true,
    synchronize: schemaMode === 'bootstrap',
    extra: {
      connectionTimeoutMillis: acquireTimeoutMs,
      options,
    },
  };
};
