import { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

import { isAppReadOnlyMode } from './common/utils/app-read-only-mode';

export const createAppTypeOrmOptions = (
  configService: ConfigService,
): TypeOrmModuleOptions => {
  const readOnly = isAppReadOnlyMode(configService);

  return {
    type: 'postgres',
    host: configService.get<string>('DATABASE_HOST'),
    port: configService.get<number>('DATABASE_PORT'),
    username: configService.get<string>('DATABASE_USER'),
    password: configService.get<string>('DATABASE_PASSWORD'),
    database: configService.get<string>('DATABASE_NAME'),
    autoLoadEntities: true,
    synchronize: !readOnly,
    ...(readOnly
      ? {
          extra: {
            options: '-c default_transaction_read_only=on',
          },
        }
      : {}),
  };
};
