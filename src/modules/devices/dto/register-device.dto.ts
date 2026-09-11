import { IsString, IsNotEmpty, IsIn, IsOptional, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDeviceDto {
  @ApiProperty({ example: '1738776000000-abc123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  deviceId: string;

  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/)
  expoPushToken: string;

  @ApiProperty({ example: 'android', enum: ['android', 'ios'] })
  @IsIn(['android', 'ios'])
  platform: 'android' | 'ios';

  @ApiProperty({ example: '1.0.0', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  appVersion?: string;
}
