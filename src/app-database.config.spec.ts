import { ConfigService } from '@nestjs/config';

import { createAppTypeOrmOptions } from './app-database.config';
import { isAppReadOnlyMode } from './common/utils/app-read-only-mode';

const createConfigService = (readOnlyValue?: string | boolean) =>
  ({
    get: jest.fn((key: string) => {
      const values: Record<string, unknown> = {
        APP_READ_ONLY_MODE: readOnlyValue,
        DATABASE_HOST: 'db-host',
        DATABASE_PORT: 5432,
        DATABASE_USER: 'db-user',
        DATABASE_PASSWORD: 'db-password',
        DATABASE_NAME: 'db-name',
      };
      return values[key];
    }),
  }) as unknown as ConfigService;

describe('application database configuration', () => {
  it('keeps the existing writable defaults when read-only mode is not enabled', () => {
    const options = createAppTypeOrmOptions(createConfigService());

    expect(options.synchronize).toBe(true);
    expect(options.extra).toBeUndefined();
  });

  it('disables synchronization and makes PostgreSQL sessions read-only when opted in', () => {
    const configService = createConfigService('true');
    const options = createAppTypeOrmOptions(configService);

    expect(isAppReadOnlyMode(configService)).toBe(true);
    expect(options.synchronize).toBe(false);
    expect(options.extra).toEqual({
      options: '-c default_transaction_read_only=on',
    });
  });
});
