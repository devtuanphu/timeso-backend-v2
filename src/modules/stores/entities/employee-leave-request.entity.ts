import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';
import { EmployeeProfile } from './employee-profile.entity';

export enum LeaveRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum LeaveType {
  SICK = 'SICK', // Nghỉ ốm
  PERSONAL = 'PERSONAL', // Việc riêng
  VACATION = 'VACATION', // Nghỉ phép năm
  UNPAID = 'UNPAID', // Nghỉ không lương
  LATE = 'LATE', // Xin đi trễ
  EARLY = 'EARLY', // Xin về sớm
  OVERTIME = 'OVERTIME', // Xin tăng ca
  OTHER = 'OTHER',
}

@Entity('employee_leave_requests')
export class EmployeeLeaveRequest extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({ name: 'employee_profile_id' })
  employeeProfileId: string;

  @ManyToOne(() => EmployeeProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_profile_id' })
  employeeProfile: EmployeeProfile;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  @Column({
    type: 'enum',
    enum: LeaveType,
    default: LeaveType.PERSONAL,
  })
  type: LeaveType;

  @Column({ type: 'text', nullable: true })
  reason: string;

  @Column({
    type: 'enum',
    enum: LeaveRequestStatus,
    default: LeaveRequestStatus.PENDING,
  })
  status: LeaveRequestStatus;

  // Người duyệt
  @Column({ name: 'approved_by_id', nullable: true })
  approvedById: string;

  @ManyToOne(() => EmployeeProfile, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approved_by_id' })
  approvedBy: EmployeeProfile;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string;

  @Column('simple-array', { name: 'attachments', nullable: true })
  attachments: string[];
}
