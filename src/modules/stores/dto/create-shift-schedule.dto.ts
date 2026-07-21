import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WeekDaySchedule } from '../entities/shift-management.entity';
import {
  ShiftMonthlyMode,
  ShiftRecurrenceEndType,
  ShiftRecurrenceFrequency,
} from '../shift-schedule.types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ShiftRecurrenceDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ enum: ShiftRecurrenceFrequency })
  @IsEnum(ShiftRecurrenceFrequency)
  frequency: ShiftRecurrenceFrequency;

  @ApiProperty({ minimum: 1, maximum: 365, example: 1 })
  @IsInt()
  @Min(1)
  @Max(365)
  interval: number;

  @ApiPropertyOptional({ enum: WeekDaySchedule, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(WeekDaySchedule, { each: true })
  weekDays?: WeekDaySchedule[];

  @ApiPropertyOptional({ enum: ShiftMonthlyMode })
  @IsOptional()
  @IsEnum(ShiftMonthlyMode)
  monthlyMode?: ShiftMonthlyMode;

  @ApiPropertyOptional({ minimum: 1, maximum: 31 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  weekOfMonth?: number;

  @ApiPropertyOptional({ enum: WeekDaySchedule })
  @IsOptional()
  @IsEnum(WeekDaySchedule)
  weekday?: WeekDaySchedule;

  @ApiProperty({ enum: ShiftRecurrenceEndType })
  @IsEnum(ShiftRecurrenceEndType)
  endType: ShiftRecurrenceEndType;

  @ApiPropertyOptional({ example: '2026-07-31' })
  @IsOptional()
  @Matches(DATE_PATTERN)
  endDate?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000, example: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  occurrenceCount?: number;
}

export class CreateShiftScheduleDto {
  @ApiProperty({ example: 'Ca sáng' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  shiftName: string;

  @ApiProperty({ example: '2026-07-17' })
  @Matches(DATE_PATTERN)
  startDate: string;

  @ApiProperty({ example: '07:00' })
  @Matches(TIME_PATTERN)
  startTime: string;

  @ApiProperty({ example: '11:00' })
  @Matches(TIME_PATTERN)
  endTime: string;

  @ApiProperty({ minimum: 1, maximum: 10000, example: 1 })
  @IsInt()
  @Min(1)
  @Max(10000)
  maxStaff: number;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  note?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Danh sách employee profile ID được chủ cửa hàng xếp trực tiếp vào tất cả ca được tạo.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  employeeIds?: string[];

  @ApiProperty({ type: ShiftRecurrenceDto })
  @ValidateNested()
  @Type(() => ShiftRecurrenceDto)
  recurrence: ShiftRecurrenceDto;
}

export class ShiftEmployeeOptionsDto {
  @ApiProperty({ example: '2026-07-17' })
  @Matches(DATE_PATTERN)
  startDate: string;

  @ApiProperty({ example: '07:00' })
  @Matches(TIME_PATTERN)
  startTime: string;

  @ApiProperty({ example: '11:00' })
  @Matches(TIME_PATTERN)
  endTime: string;

  @ApiProperty({ type: ShiftRecurrenceDto })
  @ValidateNested()
  @Type(() => ShiftRecurrenceDto)
  recurrence: ShiftRecurrenceDto;
}
