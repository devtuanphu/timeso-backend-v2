import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { EmployeeProfile } from './employee-profile.entity';
import { StorePayrollRule } from './store-payroll-rule.entity';

/**
 * Một lần chủ "ghi nhận" khoản thưởng / vi phạm thủ công (trách nhiệm, doanh
 * số, thưởng nóng, làm sai quy định, khoản tự thêm) cho một nhân viên. Lương
 * tháng tính khoản đó theo tổng `quantity` (giờ / ca / lần) của tháng.
 * `ruleName` + `category` chụp lúc ghi: xoá khoản không làm mất lịch sử.
 */
@Entity('employee_payroll_records')
@Index('idx_employee_payroll_records_employee_date', ['employeeProfileId', 'workDate'], {
  where: '"deleted_at" IS NULL',
})
export class EmployeePayrollRecord extends BaseEntity {
  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'employee_profile_id', type: 'uuid' })
  employeeProfileId: string;

  @ManyToOne(() => EmployeeProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_profile_id' })
  employeeProfile: EmployeeProfile;

  @Column({ name: 'rule_id', type: 'uuid', nullable: true })
  ruleId: string | null;

  @ManyToOne(() => StorePayrollRule, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'rule_id' })
  rule: StorePayrollRule | null;

  @Column({ name: 'rule_name', type: 'varchar', length: 255 })
  ruleName: string;

  @Column({ type: 'varchar', length: 16 })
  category: string;

  @Column({ name: 'work_date', type: 'date' })
  workDate: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  quantity: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'created_by_account_id', type: 'uuid', nullable: true })
  createdByAccountId: string | null;
}
