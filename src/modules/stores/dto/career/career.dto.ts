import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import {
  CAREER_DESCRIPTION_MAX,
  CAREER_LIMITS,
  CAREER_NAME_MAX,
  CAREER_NOTE_MAX,
  CareerRequirementCode,
} from '../../career/career.constants';
import { REVIEW_FREQUENCIES } from '../../career/career-time';
import type { ReviewFrequency } from '../../career/career-time';
import {
  SkillConfirmation,
  SkillLevel,
} from '../../entities/store-skill.entity';
import { SkillEvaluationResult } from '../../entities/employee-skill-evaluation.entity';

const NOT_BLANK = /\S/;

/** Một điều kiện; danh sách điều kiện của một chủ thể luôn được thay trọn bộ. */
export class CareerRequirementInputDto {
  @IsEnum(CareerRequirementCode)
  code: CareerRequirementCode;

  /** Ngưỡng (giờ / ca / lần); bỏ trống với điều kiện đạt / chưa đạt. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(CAREER_LIMITS.maxRequirementValue)
  value?: number | null;

  /** Chỉ với `skill_achieved`. */
  @IsOptional()
  @IsUUID()
  refSkillId?: string | null;
}

class RequirementsField {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CAREER_LIMITS.requirementsPerSubject)
  @ValidateNested({ each: true })
  @Type(() => CareerRequirementInputDto)
  requirements?: CareerRequirementInputDto[];
}

export class CreateDepartmentDto extends RequirementsField {
  @IsString()
  @MinLength(1)
  @MaxLength(CAREER_NAME_MAX)
  @Matches(NOT_BLANK, { message: 'Tên bộ phận không được để trống' })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(CAREER_DESCRIPTION_MAX)
  description?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(4)
  tier: number;

  @IsUUID()
  parentId: string;
}

export class UpdateDepartmentDto extends RequirementsField {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(CAREER_NAME_MAX)
  @Matches(NOT_BLANK, { message: 'Tên bộ phận không được để trống' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CAREER_DESCRIPTION_MAX)
  description?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(4)
  tier?: number;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class CreatePositionDto extends RequirementsField {
  @IsUUID()
  departmentId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(CAREER_NAME_MAX)
  @Matches(NOT_BLANK, { message: 'Tên vị trí không được để trống' })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(CAREER_DESCRIPTION_MAX)
  description?: string | null;

  /** Thứ tự thấp → cao (1 = thấp nhất); bỏ trống = cuối danh sách. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CAREER_LIMITS.positionsPerDepartment)
  rank?: number;
}

export class UpdatePositionDto extends RequirementsField {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(CAREER_NAME_MAX)
  @Matches(NOT_BLANK, { message: 'Tên vị trí không được để trống' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CAREER_DESCRIPTION_MAX)
  description?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CAREER_LIMITS.positionsPerDepartment)
  rank?: number;
}

export class CreateSkillDto extends RequirementsField {
  @IsUUID()
  departmentId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(CAREER_NAME_MAX)
  @Matches(NOT_BLANK, { message: 'Tên kỹ năng không được để trống' })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(CAREER_DESCRIPTION_MAX)
  description?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CAREER_LIMITS.skillsPerDepartment)
  sequence?: number;

  @IsEnum(SkillLevel)
  level: SkillLevel;

  @IsEnum(SkillConfirmation)
  confirmation: SkillConfirmation;
}

export class UpdateSkillDto extends RequirementsField {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(CAREER_NAME_MAX)
  @Matches(NOT_BLANK, { message: 'Tên kỹ năng không được để trống' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CAREER_DESCRIPTION_MAX)
  description?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CAREER_LIMITS.skillsPerDepartment)
  sequence?: number;

  @IsOptional()
  @IsEnum(SkillLevel)
  level?: SkillLevel;

  @IsOptional()
  @IsEnum(SkillConfirmation)
  confirmation?: SkillConfirmation;

  /** "Ngừng dùng" (D10): kỹ năng đã có người đạt không xoá được. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCareerSettingsDto {
  @IsOptional()
  @IsBoolean()
  reviewReminderEnabled?: boolean;

  @IsOptional()
  @IsIn(REVIEW_FREQUENCIES)
  reviewFrequency?: ReviewFrequency;
}

class ClientRequestField {
  /** Chống gửi lặp: cùng giá trị → trả lại kết quả lần trước. */
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  clientRequestId: string;
}

export class PromoteEmployeeDto extends ClientRequestField {
  /** Đúng một trong hai: vị trí đích, hoặc bộ phận đích (vào vị trí thấp nhất). */
  @ValidateIf((o) => !o.toDepartmentId)
  @IsUUID()
  toPositionId?: string;

  @ValidateIf((o) => !o.toPositionId)
  @IsUUID()
  toDepartmentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CAREER_NOTE_MAX)
  note?: string | null;

  /** Duyệt ngoại lệ khi chưa đủ điều kiện; bắt buộc ghi chú. */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

/** Chuyển ngang sang bộ phận khác (không xét điều kiện thăng tiến). */
export class TransferEmployeeDto extends ClientRequestField {
  @IsUUID()
  toDepartmentId: string;

  /** Vị trí trong bộ phận đích; bỏ trống = vào bộ phận, chưa xếp vị trí. */
  @IsOptional()
  @IsUUID()
  toPositionId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(CAREER_NOTE_MAX)
  note?: string | null;
}

export class RecordSkillEvaluationDto extends ClientRequestField {
  @IsEnum(SkillEvaluationResult)
  result: SkillEvaluationResult;

  @IsOptional()
  @IsString()
  @MaxLength(CAREER_NOTE_MAX)
  note?: string | null;
}

export class ConfirmSkillDto extends ClientRequestField {
  @IsOptional()
  @IsString()
  @MaxLength(CAREER_NOTE_MAX)
  note?: string | null;

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
