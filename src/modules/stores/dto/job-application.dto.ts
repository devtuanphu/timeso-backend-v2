import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { EmployeeWorkAssignmentDto } from './add-existing-employee.dto';
import {
  MAX_DISPLAY_NAME_LENGTH,
  sanitizeMultiLine,
  sanitizeSingleLine,
} from '../job-application.text';
import { JobApplicationStatus } from '../entities/job-application.entity';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * `fullName` reaches the store owner's notification body and push payload, so
 * it is normalised at the boundary rather than only at render time.
 */
const singleLine =
  (maxLength: number) =>
  ({ value }: { value: unknown }) =>
    typeof value === 'string' ? sanitizeSingleLine(value, maxLength) : value;

const multiLine =
  (maxLength: number) =>
  ({ value }: { value: unknown }) =>
    typeof value === 'string' ? sanitizeMultiLine(value, maxLength) : value;

/** Staff-submitted application form. */
export class CreateJobApplicationDto {
  @Transform(singleLine(MAX_DISPLAY_NAME_LENGTH))
  @IsString()
  @MinLength(2)
  @MaxLength(MAX_DISPLAY_NAME_LENGTH)
  fullName: string;

  // Contact number only — it never selects which account gets hired.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/[^\d+]/g, '') : value,
  )
  @IsString()
  @Matches(/^\+?\d{8,15}$/, { message: 'Số điện thoại không hợp lệ' })
  phone: string;

  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string;

  @Transform(multiLine(1000))
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  introduction?: string;
}

/** Owner inbox filter. */
export class ListJobApplicationsQueryDto {
  @IsOptional()
  @IsEnum(JobApplicationStatus)
  status?: JobApplicationStatus;

  // Both bounds are explicit: an unbounded page drives a large OFFSET scan and
  // an unbounded limit drives an arbitrarily large response.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

/**
 * Owner acceptance. Carries the same work/contract assignment the existing
 * add-employee form already builds, because acceptance delegates to the
 * existing attach flow rather than reimplementing hiring.
 */
export class AcceptJobApplicationDto extends EmployeeWorkAssignmentDto {}

export class RejectJobApplicationDto {
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export interface JobApplicationItemDto {
  id: string;
  storeId: string;
  accountId: string;
  fullName: string;
  // Contact fields are null once the retention job has redacted them.
  phone: string | null;
  email: string | null;
  introduction: string | null;
  status: JobApplicationStatus;
  createdAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  avatarUrl: string | null;
}

export interface MyJobApplicationDto {
  id: string;
  storeId: string;
  status: JobApplicationStatus;
  createdAt: string;
}
