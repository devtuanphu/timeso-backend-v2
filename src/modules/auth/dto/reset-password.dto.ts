import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ResetPasswordDto {
  /** Returned by `POST /auth/verify-otp` with `type: 'forgot-password'`. */
  @IsString()
  @IsNotEmpty()
  resetToken: string;

  @IsString()
  newPassword: string;

  /** Optional cross-check; must match the account the token was issued for. */
  @IsOptional()
  @IsString()
  phone?: string;
}
