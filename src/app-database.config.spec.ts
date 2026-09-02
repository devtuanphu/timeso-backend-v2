import { ConfigService } from '@nestjs/config';

import { createAppTypeOrmOptions } from './app-database.config';
import { isAppReadOnlyMode } from './common/utils/app-read-only-mode';

const createConfigService = (
  overrides: Record<string, unknown> = {},
) =>
  ({
    get: jest.fn((key: string) => {
      const values: Record<string, unknown> = {
        APP_READ_ONLY_MODE: false,
        DATABASE_SCHEMA_MODE: undefined,
        NODE_ENV: 'development',
        TIMESO_ISOLATED_DB: false,
        DATABASE_HOST: 'db-host',
        DATABASE_PORT: 5432,
        DATABASE_USER: 'db-user',
        DATABASE_PASSWORD: 'db-password',
        DATABASE_NAME: 'timeso',
        ...overrides,
      };
      return values[key];
    }),
  }) as unknown as ConfigService;

describe('application database configuration', () => {
  it('defaults to managed schema mode and never synchronizes', () => {
    const options = createAppTypeOrmOptions(createConfigService());

    expect(options.synchronize).toBe(false);
    expect(options.extra).toBeUndefined();
  });

  it('disables synchronization and makes PostgreSQL sessions read-only when opted in', () => {
    const configService = createConfigService({ APP_READ_ONLY_MODE: 'true' });
    const options = createAppTypeOrmOptions(configService);

    expect(isAppReadOnlyMode(configService)).toBe(true);
    expect(options.synchronize).toBe(false);
    expect(options.extra).toEqual({
      options: '-c default_transaction_read_only=on',
    });
  });

  it('allows bootstrap only for an explicitly isolated local database', () => {
    const options = createAppTypeOrmOptions(
      createConfigService({
        DATABASE_SCHEMA_MODE: 'bootstrap',
        TIMESO_ISOLATED_DB: 'true',
        DATABASE_NAME: 'timeso_local',
      }),
    );

    expect(options.synchronize).toBe(true);
  });

  it.each([
    { NODE_ENV: 'production', TIMESO_ISOLATED_DB: 'true', DATABASE_NAME: 'timeso_local' },
    { NODE_ENV: 'development', TIMESO_ISOLATED_DB: 'false', DATABASE_NAME: 'timeso_local' },
    { NODE_ENV: 'development', TIMESO_ISOLATED_DB: 'true', DATABASE_NAME: 'timeso' },
    {
      NODE_ENV: 'development',
      TIMESO_ISOLATED_DB: 'true',
      DATABASE_NAME: 'timeso_local',
      APP_READ_ONLY_MODE: 'true',
    },
  ])('rejects unsafe bootstrap configuration %#', (unsafe) => {
    expect(() =>
      createAppTypeOrmOptions(
        createConfigService({ DATABASE_SCHEMA_MODE: 'bootstrap', ...unsafe }),
      ),
    ).toThrow(/requires a writable isolated/);
  });

  it('rejects unknown schema modes', () => {
    expect(() =>
      createAppTypeOrmOptions(
        createConfigService({ DATABASE_SCHEMA_MODE: 'automatic' }),
      ),
    ).toThrow('DATABASE_SCHEMA_MODE must be managed or bootstrap');
  });
});
