import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RequestApproverType } from '../entities/store-request-approver.entity';

/** At most every request type once. */
const REQUEST_TYPES_MAX = 10;
/** A generous ceiling on a single scope dimension (R6). */
const SCOPE_IDS_MAX = 200;

/**
 * Create / replace one approver delegation. Every scope dimension is either
 * "tất cả" (`allX: true`, ids empty) or an explicit non-empty list
 * (`allX: false`, ids non-empty). The backend rejects any other combination so
 * a non-empty dimension can never silently collapse to empty (= all) on an
 * edit (R4).
 */
export class UpsertRequestApproverDto {
  @ApiProperty()
  @IsUUID()
  employeeProfileId: string;

  @ApiProperty({ enum: RequestApproverType, isArray: true })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(REQUEST_TYPES_MAX)
  @IsEnum(RequestApproverType, { each: true })
  requestTypes: RequestApproverType[];

  @ApiProperty({ description: 'true = tất cả bộ phận (departmentIds phải rỗng)' })
  @IsBoolean()
  allDepartments: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(SCOPE_IDS_MAX)
  @IsUUID('all', { each: true })
  departmentIds?: string[];

  @ApiProperty({ description: 'true = tất cả vị trí (positionIds phải rỗng)' })
  @IsBoolean()
  allPositions: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(SCOPE_IDS_MAX)
  @IsUUID('all', { each: true })
  positionIds?: string[];

  @ApiProperty({ description: 'true = tất cả kỹ năng (skillIds phải rỗng)' })
  @IsBoolean()
  allSkills: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(SCOPE_IDS_MAX)
  @IsUUID('all', { each: true })
  skillIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * R2 "Được xem lý do đơn". Omitted → FALSE (reasons hidden), the safe default.
   */
  @ApiPropertyOptional({ description: 'true = được xem lý do/ghi chú của đơn' })
  @IsOptional()
  @IsBoolean()
  canViewReasons?: boolean;
}

export class ListApproverRequestsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
