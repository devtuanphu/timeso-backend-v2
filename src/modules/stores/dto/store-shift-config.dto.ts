import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WeekDay, TimekeepingRequirement } from '../entities/store-shift-config.entity';
import { OPERATING_FRAMES_MAX } from '../operating-hours.utils';

/** One "Khung giờ" of the store's operating hours (never across midnight). */
export class OperatingFrameDto {
  @ApiProperty({ description: 'Bắt đầu (HH:mm)', example: '12:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Giờ bắt đầu khung giờ không hợp lệ' })
  start: string;

  @ApiProperty({ description: 'Kết thúc (HH:mm, tối đa 24:00)', example: '24:00' })
  @Matches(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, {
    message: 'Giờ kết thúc khung giờ không hợp lệ',
  })
  end: string;
}

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

  @ApiPropertyOptional({
    description:
      'Giờ hoạt động: các khung giờ trong ngày, không khung nào qua nửa đêm. Gửi thì openTime/closeTime tính lại từ đây.',
    type: [OperatingFrameDto],
    example: [
      { start: '12:00', end: '24:00' },
      { start: '00:00', end: '05:00' },
    ],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Cần ít nhất một khung giờ hoạt động.' })
  @ArrayMaxSize(OPERATING_FRAMES_MAX, {
    message: `Tối đa ${OPERATING_FRAMES_MAX} khung giờ hoạt động.`,
  })
  @ValidateNested({ each: true })
  @Type(() => OperatingFrameDto)
  operatingHours?: OperatingFrameDto[];
}
