import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { CustomShiftRequestStatus } from '../entities/custom-shift-request.entity';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateCustomShiftRequestDto {
  @ApiProperty({ example: '2026-10-05', description: 'Ngày đầu (giờ VN)' })
  @Matches(DATE_PATTERN)
  startDate: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'Ngày cuối (mặc định = startDate). Tối đa 62 ngày.',
  })
  @IsOptional()
  @Matches(DATE_PATTERN)
  endDate?: string;

  @ApiPropertyOptional({
    type: [Number],
    example: [1, 3, 5],
    description:
      'Thứ trong tuần (0 = Chủ nhật … 6 = Thứ bảy) khi đăng ký cố định trong khoảng ngày. Bỏ trống = mọi ngày.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  @ApiProperty({ example: '18:00' })
  @Matches(TIME_PATTERN)
  startTime: string;

  @ApiProperty({
    example: '02:00',
    description: 'Nhỏ hơn giờ bắt đầu = ca qua đêm (kết thúc ngày hôm sau).',
  })
  @Matches(TIME_PATTERN)
  endTime: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RejectCustomShiftRequestDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CustomShiftRequestListQueryDto {
  @ApiPropertyOptional({ enum: CustomShiftRequestStatus })
  @IsOptional()
  @IsIn(Object.values(CustomShiftRequestStatus))
  status?: CustomShiftRequestStatus;
}
