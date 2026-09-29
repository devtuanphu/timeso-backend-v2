import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { EmployeeProfile } from './employee-profile.entity';
import { Store } from './store.entity';

export enum CustomShiftRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

/** What an approval created (kept for audit and idempotent replies). */
export interface CustomShiftScheduleRef {
  cycleIds: string[];
  shiftIds: string[];
  assignmentIds: string[];
  /** Dates a shift was created for. */
  dates: string[];
  /** Requested dates already in the past (VN) when approved; not created. */
  skippedPastDates: string[];
}

/**
 * X5 "Khung giờ khác": a staff member asks for a shift at a custom time on
 * one date, or on chosen weekdays of a date range. One request expands into
 * its dates on approval, when the owner's approval creates one non-repeating
 * shift per date (unified shift-schedule path) with the employee assigned.
 *
 * Schema: scripts/migration_custom_shift_requests.sql (managed schema, not
 * synchronized). The duplicate-PENDING guard is an expression index that
 * lives only in the SQL (COALESCE over days_of_week).
 */
@Entity('custom_shift_requests')
@Index('ix_custom_shift_requests_store_status', ['storeId', 'status', 'createdAt'])
@Index('ix_custom_shift_requests_employee', ['employeeProfileId', 'createdAt'])
export class CustomShiftRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store?: Store;

  @Column({ name: 'employee_profile_id', type: 'uuid' })
  employeeProfileId: string;

  @ManyToOne(() => EmployeeProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_profile_id' })
  employeeProfile?: EmployeeProfile;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  /** 0 = Sunday … 6 = Saturday; null = every day of the range. */
  @Column({ name: 'days_of_week', type: 'smallint', array: true, nullable: true })
  daysOfWeek: number[] | null;

  @Column({ name: 'start_time', type: 'time' })
  startTime: string;

  /** end <= start means the shift ends the next day. */
  @Column({ name: 'end_time', type: 'time' })
  endTime: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({
    type: 'varchar',
    length: 16,
    default: CustomShiftRequestStatus.PENDING,
  })
  status: CustomShiftRequestStatus;

  @Column({ name: 'decided_by_account_id', type: 'uuid', nullable: true })
  decidedByAccountId: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({
    name: 'rejection_reason',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  rejectionReason: string | null;

  @Column({ name: 'created_schedule_ref', type: 'jsonb', nullable: true })
  createdScheduleRef: CustomShiftScheduleRef | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
