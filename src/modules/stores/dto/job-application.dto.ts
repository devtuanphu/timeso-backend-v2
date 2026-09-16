import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
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

/** The values both apps already render for a person's gender. */
export const GENDER_VALUES = ['Nam', 'Nữ', 'Khác'] as const;

/**
 * `DD/MM/YYYY` -> `YYYY-MM-DD`, leaving anything else untouched so the format
 * validator below is the single place that rejects bad input.
 */
const toIsoDate = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmedValue = value.trim();
  if (!trimmedValue) return undefined;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmedValue);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : trimmedValue;
};

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

  @Transform(trimmed)
  @IsOptional()
  @IsIn(GENDER_VALUES, { message: 'Giới tính không hợp lệ' })
  gender?: string;

  /**
   * Accepted as the `DD/MM/YYYY` the staff app already uses for a birthday and
   * normalised to the `YYYY-MM-DD` Postgres wants. An ISO date passes through
   * unchanged, so an API client is not forced into the UI's format.
   */
  @Transform(toIsoDate)
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Ngày sinh không hợp lệ' })
  birthday?: string;
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
  gender: string | null;
  birthday: string | null;
  status: JobApplicationStatus;
  createdAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  avatarUrl: string | null;
  /**
   * Set when this applicant already has a profile at this store that has ended
   * — terminated, or soft-deleted when the owner removed them from the list.
   *
   * Accepting such an application revives that profile rather than creating a
   * second one, so the owner is deciding a rehire, not a new hire, and the card
   * says so.
   */
  formerEmployment: FormerEmployment | null;
}

/** Attendance of a past stint, summed over its monthly rows. */
export interface FormerEmploymentRecord {
  completedShifts: number;
  lateArrivals: number;
  unauthorizedLeaves: number;
}

/**
 * What the store already knows about an applicant who worked here before.
 *
 * None of it is new exposure — the owner can see all of it on the deleted
 * employee screen. It is surfaced on the application card because that is
 * where the rehire decision is actually made.
 */
export interface FormerEmployment {
  joinedAt: string | null;
  leftAt: string | null;
  /** e.g. "Hết hạn hợp đồng", "Đuổi việc". Null when none was recorded. */
  terminationReason: string | null;
  /** Null when the stint produced no monthly summary rows. */
  record: FormerEmploymentRecord | null;
}

export interface MyJobApplicationDto {
  id: string;
  storeId: string;
  /**
   * Included so the applicant's own history is readable. Without it the list
   * could only show store ids, which say nothing to the person who applied.
   */
  storeName: string;
  storeAddress: string | null;
  status: JobApplicationStatus;
  createdAt: string;
}
