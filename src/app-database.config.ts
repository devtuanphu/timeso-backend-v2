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

  return {
    type: 'postgres',
    host: configService.get<string>('DATABASE_HOST'),
    port: configService.get<number>('DATABASE_PORT'),
    username: configService.get<string>('DATABASE_USER'),
    password: configService.get<string>('DATABASE_PASSWORD'),
    database: configService.get<string>('DATABASE_NAME'),
    autoLoadEntities: true,
    synchronize: schemaMode === 'bootstrap',
    ...(readOnly
      ? {
          extra: {
            options: '-c default_transaction_read_only=on',
          },
        }
      : {}),
  };
};
