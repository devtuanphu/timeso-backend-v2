import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Longest shift name, the same limit as the unified shift-schedule DTO. */
export const WORK_SHIFT_NAME_MAX_LENGTH = 80;
/** "HH:mm", or "HH:mm:ss" as the API returns it (the column is `time`). */
export const WORK_SHIFT_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
export const WORK_SHIFT_TIME_MESSAGE = 'Giờ phải có dạng HH:mm';

/**
 * POST /stores/:id/work-shifts. A start later than the end is an overnight
 * shift; equal times are refused by the service.
 */
export class CreateWorkShiftDto {
  @ApiProperty({ example: 'Ca sáng', maxLength: WORK_SHIFT_NAME_MAX_LENGTH })
  @IsString()
  @IsNotEmpty({ message: 'Tên ca là bắt buộc' })
  @MaxLength(WORK_SHIFT_NAME_MAX_LENGTH, {
    message: `Tên ca tối đa ${WORK_SHIFT_NAME_MAX_LENGTH} ký tự`,
  })
  shiftName: string;

  @ApiProperty({ example: '08:00' })
  @IsString()
  @Matches(WORK_SHIFT_TIME_PATTERN, { message: WORK_SHIFT_TIME_MESSAGE })
  startTime: string;

  @ApiProperty({ example: '12:00' })
  @IsString()
  @Matches(WORK_SHIFT_TIME_PATTERN, { message: WORK_SHIFT_TIME_MESSAGE })
  endTime: string;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  defaultMaxStaff?: number | null;

  @ApiPropertyOptional({ example: '#21D4D4' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  colorCode?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string | null;
}

/**
 * PUT /stores/:storeId/work-shifts/:shiftId. Every field is optional. A shift
 * is hidden (deleted) only through DELETE, so `isActive` is not here.
 */
export class UpdateWorkShiftDto {
  @ApiPropertyOptional({
    example: 'Ca sáng',
    maxLength: WORK_SHIFT_NAME_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Tên ca là bắt buộc' })
  @MaxLength(WORK_SHIFT_NAME_MAX_LENGTH, {
    message: `Tên ca tối đa ${WORK_SHIFT_NAME_MAX_LENGTH} ký tự`,
  })
  shiftName?: string;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  @Matches(WORK_SHIFT_TIME_PATTERN, { message: WORK_SHIFT_TIME_MESSAGE })
  startTime?: string;

  @ApiPropertyOptional({ example: '12:00' })
  @IsOptional()
  @IsString()
  @Matches(WORK_SHIFT_TIME_PATTERN, { message: WORK_SHIFT_TIME_MESSAGE })
  endTime?: string;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  defaultMaxStaff?: number | null;

  @ApiPropertyOptional({ example: '#21D4D4' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  colorCode?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string | null;
}
