import { IsEnum, IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { AppType } from '../../accounts/entities/account-refresh-token.entity';

export class VerifyOtpDto {
  @IsString()
  phone: string;

  @IsString()
  @Matches(/^\d{6}$/)
  otp: string;

  @IsOptional()
  @IsIn(['register', 'forgot-password'])
  type?: 'register' | 'forgot-password';

  @IsOptional()
  @IsEnum(AppType)
  appType?: AppType;
}
