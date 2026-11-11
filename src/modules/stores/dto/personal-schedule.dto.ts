import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  PersonalScheduleKind,
  PersonalScheduleRepeat,
} from '../entities/employee-personal-schedule.entity';
import {
  PERSONAL_SCHEDULE_DESIRED_DAYS_MAX,
  PERSONAL_SCHEDULE_DESIRED_HOURS_MAX,
  PERSONAL_SCHEDULE_MAX_SLOTS,
  PERSONAL_SCHEDULE_NOTE_MAX,
  PERSONAL_SCHEDULE_WISH_MAX,
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

export class UpdatePersonalScheduleWishDto {
  @ApiProperty({ enum: PersonalScheduleKind })
  @IsEnum(PersonalScheduleKind)
  kind: PersonalScheduleKind;

  @ApiProperty({
    maxLength: PERSONAL_SCHEDULE_WISH_MAX,
    description: 'Rỗng = xoá mong muốn của loại lịch này.',
    example: 'Làm 4 ca/tuần, ưu tiên sắp ca tối',
  })
  @IsString()
  @MaxLength(PERSONAL_SCHEDULE_WISH_MAX)
  wish: string;
}

/**
 * "Mong muốn số ngày làm" / "Mong muốn số giờ mỗi ca" (tham khảo) của chính
 * nhân viên. Không gửi một trường = giữ nguyên; null = xoá. Phải gửi ít nhất
 * một trường (kiểm ở service: thuộc tính vắng mặt vẫn là undefined).
 */
export class UpdatePersonalSchedulePreferencesDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: PERSONAL_SCHEDULE_DESIRED_DAYS_MAX,
    nullable: true,
    description: 'Số ngày làm mong muốn mỗi tuần (tham khảo). null = xoá.',
    example: 4,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PERSONAL_SCHEDULE_DESIRED_DAYS_MAX)
  daysPerWeek?: number | null;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: PERSONAL_SCHEDULE_DESIRED_HOURS_MAX,
    nullable: true,
    description: 'Số giờ mong muốn mỗi ca (tham khảo). null = xoá.',
    example: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PERSONAL_SCHEDULE_DESIRED_HOURS_MAX)
  hoursPerShift?: number | null;
}
