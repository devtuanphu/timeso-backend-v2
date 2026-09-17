import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
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
export class EmployeeCareerEvent extends BaseEntity {
  @Column({ name: 'employee_profile_id' })
  employeeProfileId: string;

  @ManyToOne(() => EmployeeProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_profile_id' })
  employeeProfile: EmployeeProfile;

  @Column({ name: 'ladder_id' })
  ladderId: string;

  @ManyToOne(() => StoreLadder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ladder_id' })
  ladder: StoreLadder;

  @Column({ name: 'from_rung_id', type: 'uuid', nullable: true })
  fromRungId: string | null;

  @ManyToOne(() => StoreLadderRung, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'from_rung_id' })
  fromRung: StoreLadderRung | null;

  @Column({ name: 'to_rung_id' })
  toRungId: string;

  @ManyToOne(() => StoreLadderRung, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'to_rung_id' })
  toRung: StoreLadderRung;

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
