import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CreateShiftScheduleDto } from './create-shift-schedule.dto';

/**
 * Atomic multi-item shift-schedule create. Each item is exactly today's
 * `CreateShiftScheduleDto` (one cycle = one startDate + recurrence + shifts[]),
 * so the owner app can build a whole day/week/month of cycles in one request
 * and have them persisted all-or-nothing in a single transaction.
 *
 * The array size is only a coarse guard; the real bound is the existing
 * per-schedule slot/assignment limits, summed across items and checked in the
 * service before the transaction opens.
 */
export class BatchCreateShiftSchedulesDto {
  @ApiProperty({ type: [CreateShiftScheduleDto], minItems: 1, maxItems: 200 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateShiftScheduleDto)
  items: CreateShiftScheduleDto[];
}
