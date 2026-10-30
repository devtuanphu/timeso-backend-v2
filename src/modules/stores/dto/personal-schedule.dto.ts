import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  MaxLength,
  ValidateNested,
} from 'class-validator';

import {
  PersonalScheduleKind,
  PersonalScheduleRepeat,
} from '../entities/employee-personal-schedule.entity';
import {
  PERSONAL_SCHEDULE_MAX_SLOTS,
  PERSONAL_SCHEDULE_NOTE_MAX,
} from '../personal-schedule.utils';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class PersonalScheduleSlotDto {
  @ApiProperty({ example: '2026-10-22', description: 'Ngày (giờ VN)' })
  @Matches(DATE_PATTERN)
  date: string;

  @ApiProperty({ example: '08:00' })
  @Matches(TIME_PATTERN)
  startTime: string;

  @ApiProperty({
    example: '12:00',
    description: 'Nhỏ hơn giờ bắt đầu = qua đêm (kết thúc ngày hôm sau).',
  })
  @Matches(TIME_PATTERN)
  endTime: string;
}

export class UpdatePersonalScheduleDto {
  @ApiProperty({ enum: PersonalScheduleRepeat, default: PersonalScheduleRepeat.NONE })
  @IsEnum(PersonalScheduleRepeat)
  repeat: PersonalScheduleRepeat;

  @ApiProperty({ type: [PersonalScheduleSlotDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PERSONAL_SCHEDULE_MAX_SLOTS)
  @ValidateNested({ each: true })
  @Type(() => PersonalScheduleSlotDto)
  slots: PersonalScheduleSlotDto[];

  @ApiPropertyOptional({ maxLength: PERSONAL_SCHEDULE_NOTE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(PERSONAL_SCHEDULE_NOTE_MAX)
  note?: string | null;
}

export class CreatePersonalScheduleDto extends UpdatePersonalScheduleDto {
  @ApiProperty({ enum: PersonalScheduleKind })
  @IsEnum(PersonalScheduleKind)
  kind: PersonalScheduleKind;

  @ApiPropertyOptional({
    description: 'Gửi lại cùng giá trị (bấm hai lần, mạng gửi lại) trả về lịch đã tạo.',
  })
  @IsOptional()
  @IsUUID()
  clientRequestId?: string;
}
