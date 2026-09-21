import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { EmployeeProfile } from './employee-profile.entity';
import { EmployeeSalary } from './employee-salary.entity';
import { Account } from '../../accounts/entities/account.entity';

export enum AdvanceRequestStatus {
  PENDING = 'Chờ duyệt',
  APPROVED = 'Đã duyệt',
  REJECTED = 'Từ chối',
  CANCELLED = 'Đã hủy',
}

@Entity('salary_advance_requests')
export class SalaryAdvanceRequest extends BaseEntity {
  @Column({ name: 'employee_profile_id' })
  employeeProfileId: string;

  @ManyToOne(() => EmployeeProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_profile_id' })
  employeeProfile: EmployeeProfile;

  @Column({ name: 'employee_salary_id' })
  employeeSalaryId: string;

  // NO ACTION, not CASCADE: deleting a payslip must never silently delete the
  // advances paid against it. NO ACTION is checked at the end of the
  // statement, so deleting an employee profile (which cascades to both
  // tables) still succeeds. See scripts/migration_salary_advance_fk_no_cascade.sql.
  @ManyToOne(() => EmployeeSalary, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'employee_salary_id' })
  employeeSalary: EmployeeSalary;

  @Column({
    name: 'requested_amount',
    type: 'decimal',
    precision: 12,
    scale: 2,
    comment: 'Số tiền yêu cầu ứng',
  })
  requestedAmount: number;

  @Column({
    name: 'approved_amount',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    comment: 'Số tiền được duyệt (có thể khác với số tiền yêu cầu)',
  })
  approvedAmount: number;

  @Column({
    name: 'request_reason',
    type: 'text',
    nullable: true,
    comment: 'Lý do ứng lương',
  })
  requestReason: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: AdvanceRequestStatus,
    default: AdvanceRequestStatus.PENDING,
  })
  status: AdvanceRequestStatus;

  @Column({ name: 'requested_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  requestedAt: Date;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true })
  reviewedAt: Date;

  @Column({ name: 'reviewed_by_account_id', nullable: true })
  reviewedByAccountId: string;

  @ManyToOne(() => Account, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewed_by_account_id' })
  reviewedBy: Account;

  @Column({
    name: 'review_note',
    type: 'text',
    nullable: true,
    comment: 'Ghi chú của người duyệt',
  })
  reviewNote: string;

  @Column({
    name: 'payment_method',
    nullable: true,
    comment: 'Phương thức chi trả (Tiền mặt, Chuyển khoản...)',
  })
  paymentMethod: string;

  @Column({
    name: 'payment_reference',
    nullable: true,
    comment: 'Mã tham chiếu giao dịch',
  })
  paymentReference: string;
}
