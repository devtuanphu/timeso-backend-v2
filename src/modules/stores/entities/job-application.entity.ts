import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Account } from '../../accounts/entities/account.entity';
import { Store } from './store.entity';

export enum JobApplicationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

/**
 * A staff account applying to work at a store.
 *
 * This row is a request only: it never creates an `EmployeeProfile`. Membership
 * is created exclusively by the owner accepting the application, which reuses
 * the existing attach flow — the same invariant `docs/staff-self-signup.md`
 * records for store discovery.
 */
@Entity('store_job_applications')
// One open application per (store, account). Partial so a rejected or cancelled
// application can be replaced by a new attempt without dropping the history.
@Index('uq_job_applications_one_pending', ['storeId', 'accountId'], {
  unique: true,
  where: `"status" = 'PENDING' AND "deleted_at" IS NULL`,
})
@Index('idx_job_applications_store_status', ['storeId', 'status'], {
  where: `"deleted_at" IS NULL`,
})
@Index('idx_job_applications_account', ['accountId'], {
  where: `"deleted_at" IS NULL`,
})
@Index('idx_job_applications_retention', ['reviewedAt'], {
  where: `"reviewed_at" IS NOT NULL AND "contact_redacted_at" IS NULL AND "deleted_at" IS NULL`,
})
export class JobApplication extends BaseEntity {
  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  /** The applicant. Not an EmployeeProfile — they are not a member yet. */
  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  // Contact details are snapshotted at submission time so the owner sees what
  // was applied with, even if the account is edited afterwards. They are
  // nullable because a daily job clears them once the application has been
  // reviewed for longer than the retention window.
  @Column({ name: 'full_name', type: 'text' })
  fullName: string;

  @Column({ name: 'phone', type: 'text', nullable: true })
  phone: string | null;

  @Column({ name: 'email', type: 'text', nullable: true })
  email: string | null;

  @Column({ name: 'introduction', type: 'text', nullable: true })
  introduction: string | null;

  @Column({
    type: 'enum',
    enum: JobApplicationStatus,
    default: JobApplicationStatus.PENDING,
  })
  status: JobApplicationStatus;

  /** Owner account that accepted or rejected. */
  @Column({ name: 'reviewed_by_id', type: 'uuid', nullable: true })
  reviewedById: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  /** Profile created when the application was accepted. */
  @Column({ name: 'employee_profile_id', type: 'uuid', nullable: true })
  employeeProfileId: string | null;

  /** Set when the contact fields were cleared by the retention job. */
  @Column({ name: 'contact_redacted_at', type: 'timestamptz', nullable: true })
  contactRedactedAt: Date | null;
}
