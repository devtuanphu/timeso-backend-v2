import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum PayrollWaiverKind {
  /** Một lần phát sinh của khoản tự động (khoản + ca). */
  OCCURRENCE = 'OCCURRENCE',
  /** Cả dòng của khoản trong tháng (khoản tính cả tháng). */
  LINE = 'LINE',
  /** Ghi nhận tay đã xoá mềm; chỉ giữ lý do, không tham gia tính lương. */
  RECORD = 'RECORD',
}

/**
 * Chủ xoá (miễn) một khoản thưởng / vi phạm khỏi lương tháng của nhân viên,
 * kèm lý do (popup "Chi tiết thưởng / vi phạm" ở sao kê lương của app chủ).
 * Xem scripts/migration_payroll_waivers.sql.
 */
@Entity('employee_payroll_waivers')
@Index('idx_employee_payroll_waivers_employee_period', ['employeeProfileId', 'periodStart'], {
  where: '"deleted_at" IS NULL',
})
export class EmployeePayrollWaiver extends BaseEntity {
  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'employee_profile_id', type: 'uuid' })
  employeeProfileId: string;

  @Column({ type: 'varchar', length: 16 })
  kind: PayrollWaiverKind;

  /** BONUS / FINE của khoản, chụp lúc xoá. */
  @Column({ type: 'varchar', length: 16 })
  category: string;

  /** lineage_id của khoản (id nếu khoản chưa có phiên bản). */
  @Column({ name: 'rule_lineage_id', type: 'uuid' })
  ruleLineageId: string;

  @Column({ name: 'rule_name', type: 'varchar', length: 255 })
  ruleName: string;

  /** Ngày đầu kỳ lương (YYYY-MM-01). */
  @Column({ name: 'period_start', type: 'date' })
  periodStart: string;

  @Column({ name: 'assignment_id', type: 'uuid', nullable: true })
  assignmentId: string | null;

  @Column({ name: 'record_id', type: 'uuid', nullable: true })
  recordId: string | null;

  /** Ngày làm của lần bị xoá (để hiển thị / tra cứu). */
  @Column({ name: 'work_date', type: 'date', nullable: true })
  workDate: string | null;

  @Column({ type: 'varchar', length: 300 })
  reason: string;

  @Column({ name: 'created_by_account_id', type: 'uuid', nullable: true })
  createdByAccountId: string | null;
}
