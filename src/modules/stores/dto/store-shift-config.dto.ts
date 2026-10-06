import { IsArray, IsEnum, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WeekDay, TimekeepingRequirement } from '../entities/store-shift-config.entity';

export class CreateStoreShiftConfigDto {
  @ApiProperty({ description: 'Store ID' })
  @IsUUID()
  storeId: string;

  @ApiPropertyOptional({
    description: 'Ngày được nghỉ trong tuần',
    enum: WeekDay,
    isArray: true,
    example: ['SATURDAY', 'SUNDAY'],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(WeekDay, { each: true })
  daysOff?: WeekDay[];

  @ApiPropertyOptional({
    description: 'Không duyệt nghỉ vào các ngày này',
    enum: WeekDay,
    isArray: true,
    example: ['SATURDAY', 'SUNDAY'],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(WeekDay, { each: true })
  noApprovalDays?: WeekDay[];

  @ApiPropertyOptional({
    description: 'Điểm danh yêu cầu',
    enum: TimekeepingRequirement,
    example: 'LOCATION_QR_GPS_FACEID',
  })
  @IsOptional()
  @IsEnum(TimekeepingRequirement)
  timekeepingRequirement?: TimekeepingRequirement;
}

export class UpdateStoreShiftConfigDto {
  @ApiPropertyOptional({
    description: 'Ngày được nghỉ trong tuần',
    enum: WeekDay,
    isArray: true,
    example: ['SATURDAY', 'SUNDAY'],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(WeekDay, { each: true })
  daysOff?: WeekDay[];

  @ApiPropertyOptional({
    description: 'Không duyệt nghỉ vào các ngày này',
    enum: WeekDay,
    isArray: true,
    example: ['SATURDAY', 'SUNDAY'],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(WeekDay, { each: true })
  noApprovalDays?: WeekDay[];

  @ApiPropertyOptional({
    description: 'Điểm danh yêu cầu',
    enum: TimekeepingRequirement,
    example: 'LOCATION_QR_GPS_FACEID',
  })
  @IsOptional()
  @IsEnum(TimekeepingRequirement)
  timekeepingRequirement?: TimekeepingRequirement;

  @ApiPropertyOptional({ description: 'Giờ mở cửa (HH:mm)', example: '06:00' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/, { message: 'Giờ mở cửa không hợp lệ' })
  openTime?: string;

  @ApiPropertyOptional({ description: 'Giờ đóng cửa (HH:mm)', example: '22:00' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/, { message: 'Giờ đóng cửa không hợp lệ' })
  closeTime?: string;
}
