import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { EmployeeProfile } from './employee-profile.entity';
import { StoreLadder } from './store-ladder.entity';
import { StoreLadderRung } from './store-ladder-rung.entity';
import { Account } from '../../accounts/entities/account.entity';

/** Một mục điều kiện đúng như nó được đo tại thời điểm duyệt. */
export interface CriteriaSnapshotItem {
  label: string;
  kind: string;
  code: string | null;
  operator: string | null;
  target: number | null;
  current: number | null;
  met: boolean;
  isRequired: boolean;
}

/**
 * Một bước lên bậc trên một lộ trình.
 *
 * Đây là nguồn duy nhất trả lời "vào bậc hiện tại từ bao giờ", thứ mà điều
 * kiện `days_in_rung` cần, và là toàn bộ phần "đã đi qua" của lộ trình — trước
 * đây không được lưu ở đâu cả.
 */
@Entity('employee_career_events')
@Index('ux_employee_career_events_request', ['employeeProfileId', 'clientRequestId'], {
  unique: true,
  where: 'client_request_id IS NOT NULL',
})
export class EmployeeCareerEvent extends BaseEntity {
  @Column({ name: 'employee_profile_id' })
  employeeProfileId: string;

  @ManyToOne(() => EmployeeProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_profile_id' })
  employeeProfile: EmployeeProfile;

  /** Null với sự kiện của lộ trình v2 (subjectType + toTargetId). */
  @Column({ name: 'ladder_id', type: 'uuid', nullable: true })
  ladderId: string | null;

  @ManyToOne(() => StoreLadder, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'ladder_id' })
  ladder: StoreLadder | null;

  @Column({ name: 'from_rung_id', type: 'uuid', nullable: true })
  fromRungId: string | null;

  @ManyToOne(() => StoreLadderRung, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'from_rung_id' })
  fromRung: StoreLadderRung | null;

  @Column({ name: 'to_rung_id', type: 'uuid', nullable: true })
  toRungId: string | null;

  @ManyToOne(() => StoreLadderRung, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'to_rung_id' })
  toRung: StoreLadderRung | null;

  /**
   * Lộ trình v2: chủ thể của bước (bộ phận / vị trí / kỹ năng) và id đích /
   * nguồn trong bảng của chủ thể đó. Sự kiện lộ trình vị trí / kỹ năng cũ cũng
   * mang các cột này (migration + CareerLadderService), nên "vào vị trí hiện
   * tại từ lúc nào" chỉ đọc một nguồn.
   */
  @Column({ name: 'subject_type', type: 'varchar', length: 16, nullable: true })
  subjectType: 'department' | 'position' | 'skill' | null;

  @Column({ name: 'from_target_id', type: 'uuid', nullable: true })
  fromTargetId: string | null;

  @Column({ name: 'to_target_id', type: 'uuid', nullable: true })
  toTargetId: string | null;

  /** Chống gửi lặp: unique theo (hồ sơ, clientRequestId). */
  @Column({ name: 'client_request_id', type: 'varchar', length: 64, nullable: true })
  clientRequestId: string | null;

  @Column({ name: 'effective_at', type: 'timestamp' })
  effectiveAt: Date;

  @Column({ name: 'decided_by_account_id', type: 'uuid', nullable: true })
  decidedByAccountId: string | null;

  @ManyToOne(() => Account, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'decided_by_account_id' })
  decidedByAccount: Account | null;

  /**
   * Ảnh chụp điều kiện lúc duyệt. Chủ sửa điều kiện sau đó là chuyện thường,
   * và không có ảnh chụp này thì lịch sử mất khả năng giải thích vì sao người
   * đó được duyệt.
   */
  @Column({ name: 'criteria_snapshot', type: 'jsonb', nullable: true })
  criteriaSnapshot: CriteriaSnapshotItem[] | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;
}
