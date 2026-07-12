import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { ShiftAssignment } from './shift-management.entity';

export enum ShiftEndWorkflowState {
  ACTIVE = 'ACTIVE',
  OVERTIME_PENDING = 'OVERTIME_PENDING',
  OVERTIME_APPROVED = 'OVERTIME_APPROVED',
  COMPLETED_BY_EMPLOYEE = 'COMPLETED_BY_EMPLOYEE',
  AUTO_COMPLETED = 'AUTO_COMPLETED',
  CANCELLED = 'CANCELLED',
}

@Entity('shift_end_workflows')
export class ShiftEndWorkflow extends BaseEntity {
  @Column({ name: 'shift_assignment_id', unique: true })
  shiftAssignmentId: string;

  @OneToOne(() => ShiftAssignment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shift_assignment_id' })
  shiftAssignment: ShiftAssignment;

  @Column({ name: 'scheduled_end_at', type: 'timestamptz' })
  scheduledEndAt: Date;

  @Column({ name: 'effective_end_at', type: 'timestamptz' })
  effectiveEndAt: Date;

  @Column({
    type: 'enum',
    enum: ShiftEndWorkflowState,
    default: ShiftEndWorkflowState.ACTIVE,
  })
  state: ShiftEndWorkflowState;

  @Column({ name: 'reminder_0_sent_at', type: 'timestamptz', nullable: true })
  reminder0SentAt: Date | null;

  @Column({ name: 'reminder_5_sent_at', type: 'timestamptz', nullable: true })
  reminder5SentAt: Date | null;

  @Column({ name: 'reminder_10_sent_at', type: 'timestamptz', nullable: true })
  reminder10SentAt: Date | null;

  @Column({ name: 'auto_checkout_at', type: 'timestamptz', nullable: true })
  autoCheckoutAt: Date | null;

  @Column({ name: 'overtime_request_id', type: 'uuid', nullable: true })
  overtimeRequestId: string | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;
}
