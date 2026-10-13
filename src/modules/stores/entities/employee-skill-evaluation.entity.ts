import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum SkillEvaluationResult {
  PASS = 'pass',
  FAIL = 'fail',
}

/**
 * Một lần chủ / quản lý chấm Đạt hoặc Không đạt một kỹ năng của nhân viên —
 * nguồn của điều kiện "Số lần thực hiện đạt" và "Quản lý đánh giá". Gửi lặp
 * cùng `clientRequestId` không ghi hai lần (unique theo cửa hàng).
 */
@Entity('employee_skill_evaluations')
@Index('ux_employee_skill_evaluations_request', ['storeId', 'clientRequestId'], {
  unique: true,
  where: 'client_request_id IS NOT NULL',
})
export class EmployeeSkillEvaluation extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'employee_profile_id' })
  employeeProfileId: string;

  @Column({ name: 'skill_id' })
  skillId: string;

  @Column({ type: 'varchar', length: 8 })
  result: SkillEvaluationResult;

  @Column({ name: 'evaluated_by_account_id', type: 'uuid', nullable: true })
  evaluatedByAccountId: string | null;

  @Column({ name: 'evaluated_at', type: 'timestamp' })
  evaluatedAt: Date;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ name: 'client_request_id', type: 'varchar', length: 64, nullable: true })
  clientRequestId: string | null;
}
