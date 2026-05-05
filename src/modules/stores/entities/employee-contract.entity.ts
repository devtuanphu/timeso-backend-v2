import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { EmployeeProfile } from './employee-profile.entity';

export enum PaymentType {
  SHIFT = 'Ca',
  HOUR = 'Giờ',
  DAY = 'Ngày',
  WEEK = 'Tuần',
  MONTH = 'Tháng',
}

@Entity('employee_contracts')
export class EmployeeContract extends BaseEntity {
  @Column({ name: 'employee_profile_id' })
  employeeProfileId: string;

  @ManyToOne(() => EmployeeProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_profile_id' })
  employeeProfile: EmployeeProfile;

  @Column({ name: 'contract_name', nullable: true })
  contractName: string;

  @Column({ name: 'job_description', type: 'text', nullable: true })
  jobDescription: string;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate: Date;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: Date;

  @Column({
    name: 'duration_months',
    type: 'int',
    nullable: true,
    comment: 'Thời hạn hợp đồng (tháng)',
  })
  durationMonths: number;

  @Column({
    name: 'weekly_working_hours',
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  weeklyWorkingHours: number;

  @Column({ name: 'probation_period', nullable: true })
  probationPeriod: string;

  @Column({
    name: 'payment_type',
    type: 'enum',
    enum: PaymentType,
    nullable: true,
  })
  paymentType: PaymentType;

  @Column({
    name: 'salary_amount',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  salaryAmount: number;

  @Column({ type: 'jsonb', nullable: true })
  allowances: Record<string, number>;

  @Column({ type: 'jsonb', nullable: true })
  terms: Array<{ title: string; content: string }>;

  @Column({ name: 'contract_file_url', nullable: true })
  contractFileUrl: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
