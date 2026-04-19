import { IsEnum, IsNotEmpty, IsOptional, IsString, IsArray, IsInt, Min, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CycleType, WeekDaySchedule } from '../entities/shift-management.entity';

// Template ca cho 1 ngày trong tuần (dùng cho INDEFINITE)
export class ShiftTemplateDto {
  @ApiProperty({ description: 'ID ca làm việc' })
  @IsString()
  @IsNotEmpty()
  workShiftId: string;

  @ApiProperty({ description: 'Ngày trong tuần', enum: WeekDaySchedule })
  @IsEnum(WeekDaySchedule)
  dayOfWeek: WeekDaySchedule;

  @ApiPropertyOptional({ description: 'Số nhân viên tối đa', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxStaff?: number;
}

// Slot ca cho chu kỳ có thời hạn (DAILY, WEEKLY, MONTHLY)
export class ShiftSlotInputDto {
  @ApiProperty({ description: 'ID ca làm việc' })
  @IsString()
  @IsNotEmpty()
  workShiftId: string;

  @ApiProperty({ description: 'Ngày làm việc (YYYY-MM-DD)' })
  @IsString()
  @IsNotEmpty()
  workDate: string;

  @ApiPropertyOptional({ description: 'Số nhân viên tối đa', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxStaff?: number;
}

export class CreateWorkCycleDto {
  @ApiProperty({ description: 'Tên chu kỳ, VD: "Tuần 1 tháng 2"' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Loại chu kỳ', enum: CycleType })
  @IsEnum(CycleType)
  cycleType: CycleType;

  @ApiProperty({ description: 'Ngày bắt đầu (YYYY-MM-DD)' })
  @IsString()
  @IsNotEmpty()
  startDate: string;

  @ApiPropertyOptional({
    description: 'Ngày kết thúc (YYYY-MM-DD). Nếu không truyền, sẽ tự động tính theo cycleType.',
  })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ 
    description: 'Danh sách slot ca (cho DAILY, WEEKLY, MONTHLY). Nếu không truyền, sẽ dựa vào workShiftIds để tạo tự động.',
    type: [ShiftSlotInputDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShiftSlotInputDto)
  slots?: ShiftSlotInputDto[];

  @ApiPropertyOptional({ 
    description: 'Danh sách ID ca để auto-generate slots (thay thế cho slots). Áp dụng ca này cho tất cả ngày trong chu kỳ.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  workShiftIds?: string[];

  @ApiPropertyOptional({ 
    description: 'Lịch mẫu (chỉ cho INDEFINITE). Định nghĩa ca nào chạy vào ngày nào trong tuần.',
    type: [ShiftTemplateDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShiftTemplateDto)
  templates?: ShiftTemplateDto[];
}
