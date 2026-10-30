import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { EmployeeProfile } from './employee-profile.entity';
import { Store } from './store.entity';

export enum PersonalScheduleKind {
  /** Lịch trống: thời gian có thể nhận ca. */
  AVAILABLE = 'AVAILABLE',
  /** Lịch bận: việc khác, việc cá nhân. */
  BUSY = 'BUSY',
  /** Lịch học ở trường. */
  STUDY = 'STUDY',
}

export enum PersonalScheduleRepeat {
  NONE = 'NONE',
  /** Mỗi khung giờ lặp lại cùng thứ hằng tuần, từ ngày của khung giờ. */
  WEEKLY = 'WEEKLY',
  /** Mỗi khung giờ lặp lại cùng ngày hằng tháng, từ ngày của khung giờ. */
  MONTHLY = 'MONTHLY',
}

/** Một khung giờ: ngày (VN) + giờ 'HH:mm'. Kết thúc <= bắt đầu = qua đêm. */
export interface PersonalScheduleSlot {
  date: string;
  startTime: string;
  endTime: string;
}

/**
 * Lịch cá nhân do nhân viên tự nhập (một lần "Lưu lịch"). Chủ chỉ đọc và chỉ
 * được cảnh báo khi xếp ca; không chặn gì. Luật ở personal-schedule.utils.ts.
 *
 * Schema: scripts/migration_employee_personal_schedules.sql (không synchronize).
 */
@Entity('employee_personal_schedules')
@Index('ix_employee_personal_schedules_employee', [
  'employeeProfileId',
  'kind',
  'createdAt',
])
export class EmployeePersonalSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store?: Store;

  @Column({ name: 'employee_profile_id', type: 'uuid' })
  employeeProfileId: string;

  @ManyToOne(() => EmployeeProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_profile_id' })
  employeeProfile?: EmployeeProfile;

  @Column({ type: 'varchar', length: 16 })
  kind: PersonalScheduleKind;

  @Column({ type: 'varchar', length: 16, default: PersonalScheduleRepeat.NONE })
  repeat: PersonalScheduleRepeat;

  @Column({ type: 'jsonb' })
  slots: PersonalScheduleSlot[];

  @Column({ type: 'varchar', length: 100, nullable: true })
  note: string | null;

  @Column({ name: 'client_request_id', type: 'uuid', nullable: true })
  clientRequestId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
