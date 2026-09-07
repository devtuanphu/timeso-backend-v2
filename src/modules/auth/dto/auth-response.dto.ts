import { ApiProperty } from '@nestjs/swagger';

export enum OtpDeliveryStatus {
  SENT = 'sent',
  FAILED = 'failed',
}

export class LoginResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1...' })
  access_token: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1...' })
  refresh_token: string;

  @ApiProperty()
  user: any;
}

export class AuthMessageDto {
  @ApiProperty({ example: 'Thao tác thành công' })
  message: string;
}

export class RegisterResponseDto extends AuthMessageDto {
  @ApiProperty({ example: '0901234567' })
  phone: string;

  @ApiProperty({ example: true })
  verificationRequired: true;

  @ApiProperty({ enum: OtpDeliveryStatus })
  otpDelivery: OtpDeliveryStatus;
}

export class ResendOtpResponseDto extends AuthMessageDto {
  @ApiProperty({ example: '0901234567' })
  phone: string;

  @ApiProperty({ enum: OtpDeliveryStatus })
  otpDelivery: OtpDeliveryStatus;
}
