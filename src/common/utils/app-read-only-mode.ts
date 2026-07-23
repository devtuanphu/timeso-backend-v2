import type { ConfigService } from '@nestjs/config';

type ConfigReader = Pick<ConfigService, 'get'>;

export const isAppReadOnlyMode = (configService: ConfigReader): boolean => {
  const value = configService.get<string | boolean>('APP_READ_ONLY_MODE');
  return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
};
