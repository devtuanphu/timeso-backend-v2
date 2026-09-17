import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { EmployeeProfile } from './employee-profile.entity';
import { Account } from '../../accounts/entities/account.entity';

/**
 * Một lần chủ cộng hoặc trừ điểm năng lực, kèm lý do.
 *
 * Trước đây `employee_profiles.capability_points` chỉ được đọc để so sánh và
 * không có một dòng mã nào ghi vào nó, nên điều kiện "điểm năng lực tối thiểu"
 * là điều kiện không bao giờ đạt được. Cột đó nay là tổng của bảng này, được
 * duy trì khi ghi để điều kiện không phải cộng dồn mỗi lần đánh giá.
 */
@Entity('employee_capability_entries')
export class EmployeeCapabilityEntry extends BaseEntity {
  @Column({ name: 'employee_profile_id' })
  employeeProfileId: string;

  @ManyToOne(() => EmployeeProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_profile_id' })
  employeeProfile: EmployeeProfile;

  /** Cho phép âm: chủ trừ điểm cũng là một lần chấm. */
  @Column({ type: 'int' })
  points: number;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'awarded_by_account_id', type: 'uuid', nullable: true })
  awardedByAccountId: string | null;

  @ManyToOne(() => Account, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'awarded_by_account_id' })
  awardedByAccount: Account | null;

  @Column({ name: 'awarded_at', type: 'timestamp' })
  awardedAt: Date;
}
