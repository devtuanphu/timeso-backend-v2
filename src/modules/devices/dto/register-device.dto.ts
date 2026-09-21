import {
  ArrayMaxSize,
  IsArray,
  IsString,
  IsNotEmpty,
  IsIn,
  IsOptional,
  MaxLength,
  Matches,
} from 'class-validator';
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

  @ApiProperty({
    example: ['shift-alert-channels'],
    required: false,
    description:
      "Khả năng của bản app: 'shift-alert-channels' = đã tạo kênh Android shift-alerts / shift-alerts-quiet. Giá trị lạ bị bỏ qua.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  capabilities?: string[];
}
