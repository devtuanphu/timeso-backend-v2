import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { CriteriaSnapshotItem } from './employee-career-event.entity';

export enum SkillProgressStatus {
  IN_PROGRESS = 'in_progress',
  ACHIEVED = 'achieved',
}

/**
 * Kỹ năng của một nhân viên đã mở khoá hoặc đã đạt.
 *
 * Khoá / mở khoá tính theo quy tắc mỗi lần xét (mọi KN bắt buộc đứng trước đã
 * đạt), không theo việc có dòng hay không — sắp lại thứ tự có thể khoá lại một
 * kỹ năng đã có dòng. Dòng giữ mốc mở khoá (đầu cửa sổ giờ thực hành và số lần
 * đạt) và kết quả đạt. Đợt làm việc mới (tái tuyển) xoá mềm các dòng cũ.
 */
@Entity('employee_skill_progress')
@Index('ux_employee_skill_progress_profile_skill', ['employeeProfileId', 'skillId'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
export class EmployeeSkillProgress extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'employee_profile_id' })
  employeeProfileId: string;

  @Column({ name: 'skill_id' })
  skillId: string;

  @Column({ type: 'varchar', length: 16, default: SkillProgressStatus.IN_PROGRESS })
  status: SkillProgressStatus;

  @Column({ name: 'unlocked_at', type: 'timestamp', nullable: true })
  unlockedAt: Date | null;

  @Column({ name: 'achieved_at', type: 'timestamp', nullable: true })
  achievedAt: Date | null;

  @Column({ name: 'confirmed_by_account_id', type: 'uuid', nullable: true })
  confirmedByAccountId: string | null;

  @Column({ name: 'criteria_snapshot', type: 'jsonb', nullable: true })
  criteriaSnapshot: CriteriaSnapshotItem[] | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;
}
