import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';
import { EmployeeProfile } from './employee-profile.entity';

export enum ShiftChangeRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

@Entity('shift_change_requests')
export class ShiftChangeRequest extends BaseEntity {
  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({ name: 'employee_profile_id', type: 'uuid' })
  employeeProfileId: string;

  @ManyToOne(() => EmployeeProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_profile_id' })
  employeeProfile: EmployeeProfile;

  @Column({ name: 'current_shift_id', type: 'uuid', nullable: true })
  currentShiftId: string | null;

  @Column({ name: 'requested_shift_id', type: 'uuid', nullable: true })
  requestedShiftId: string | null;

  @Column({ name: 'request_date', type: 'date' })
  requestDate: string;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({
    type: 'enum',
    enum: ShiftChangeRequestStatus,
    default: ShiftChangeRequestStatus.PENDING,
  })
  status: ShiftChangeRequestStatus;

  @Column({ name: 'approved_by_id', type: 'uuid', nullable: true })
  approvedById: string | null;

  @ManyToOne(() => EmployeeProfile, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approved_by_id' })
  approvedBy: EmployeeProfile;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'attachments', type: 'text', nullable: true })
  attachments: string | null;
}
