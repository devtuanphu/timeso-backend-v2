import { AfterLoad, Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { EmployeeProfile } from './employee-profile.entity';

export enum PaymentType {
  SHIFT = 'Ca',
  HOUR = 'Giờ',
  DAY = 'Ngày',
  WEEK = 'Tuần',
  MONTH = 'Tháng',
}

/**
 * "Không hợp đồng": the employee works without a labor contract, but the row
 * still carries the pay rate payroll needs. Stored with the existing columns
 * (no schema change): `duration_months = 0`, no end date, and this name.
 */
export const NO_LABOR_CONTRACT_NAME = 'Không hợp đồng';

/** True for a "Không hợp đồng" row (see NO_LABOR_CONTRACT_NAME). */
export function isNoLaborContract(
  contract:
    | { durationMonths?: number | string | null; contractName?: string | null }
    | null
    | undefined,
): boolean {
  if (!contract) return false;
  if (
    contract.durationMonths !== null &&
    contract.durationMonths !== undefined &&
    String(contract.durationMonths).trim() !== '' &&
    Number(contract.durationMonths) === 0
  ) {
    return true;
  }
  return (
    typeof contract.contractName === 'string' &&
    contract.contractName.trim().toLowerCase() ===
      NO_LABOR_CONTRACT_NAME.toLowerCase()
  );
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

  /**
   * Derived, not a column: true when the employee has no labor contract
   * ("Không hợp đồng"). Sent to clients so the contract tab can say so
   * instead of "Hợp đồng lao động".
   */
  noLaborContract?: boolean;

  @AfterLoad()
  protected markNoLaborContract() {
    this.noLaborContract = isNoLaborContract(this);
  }
}
