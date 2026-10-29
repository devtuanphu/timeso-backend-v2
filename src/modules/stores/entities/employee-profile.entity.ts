import { StoreDepartment } from './store-department.entity';
import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';
import { Account } from '../../accounts/entities/account.entity';
import { StoreEmployeeType } from './store-employee-type.entity';
import { StoreWorkType } from './store-work-type.entity';
import { StoreRole } from './store-role.entity';
import { EmployeeContract } from './employee-contract.entity';
import { WorkShift } from './work-shift.entity';
import { EmployeeAssetAssignment } from './employee-asset-assignment.entity';
import { EmployeeTerminationReason } from './employee-termination-reason.entity';
import { StoreSkill } from './store-skill.entity';
import { JoinTable, ManyToMany } from 'typeorm';

export enum EmploymentStatus {
  ACTIVE = 'active',
  PROBATION = 'probation',
  ON_LEAVE = 'on_leave',
  TERMINATED = 'terminated',
  /**
   * Created by a job application, not yet approved by the owner.
   *
   * The person is NOT an employee: they may not reach any store data, must not
   * appear in staff lists, and must not block their own hire. Use
   * `isEmployedStatus` / `EMPLOYED_STATUSES` instead of comparing against
   * TERMINATED, which is what every pre-existing check did.
   */
  PENDING = 'pending',
}

/**
 * The statuses that mean "this person works here".
 *
 * PENDING and TERMINATED are both excluded: one has not started, the other has
 * finished. Checks used to be written as `!== TERMINATED`, which silently
 * counted a pending applicant as staff the moment PENDING existed.
 */
export const EMPLOYED_STATUSES = [
  EmploymentStatus.ACTIVE,
  EmploymentStatus.PROBATION,
  EmploymentStatus.ON_LEAVE,
] as const;

export const isEmployedStatus = (status: EmploymentStatus): boolean =>
  (EMPLOYED_STATUSES as readonly EmploymentStatus[]).includes(status);

export enum WorkingStatus {
  IDLE = 'idle', // Trống ca / Chờ ca
  WORKING = 'working', // Đang làm việc
  OFF = 'off', // Nghỉ (Ngày nghỉ/Có phép)
  ABSENT = 'absent', // Nghỉ không phép (Quá giờ ca mà chưa check-in)
}

@Entity('employee_profiles')
@Unique(['storeId', 'accountId'])
export class EmployeeProfile extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({ name: 'account_id' })
  accountId: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({
    name: 'employment_status',
    type: 'enum',
    enum: EmploymentStatus,
    default: EmploymentStatus.ACTIVE,
  })
  employmentStatus: EmploymentStatus;

  @Column({
    name: 'working_status',
    type: 'enum',
    enum: WorkingStatus,
    default: WorkingStatus.OFF,
  })
  workingStatus: WorkingStatus;

  @Column({ name: 'employee_type_id', nullable: true })
  employeeTypeId: string;

  @ManyToOne(() => StoreEmployeeType, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'employee_type_id' })
  employeeType: StoreEmployeeType;

  /** Hình thức làm việc (Toàn thời gian, Bán thời gian…) — chỉ phân loại. */
  @Column({ name: 'work_type_id', type: 'uuid', nullable: true })
  workTypeId: string | null;

  @ManyToOne(() => StoreWorkType, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'work_type_id' })
  workType: StoreWorkType | null;

  @Column({ name: 'store_role_id', nullable: true })
  storeRoleId: string;

  @ManyToOne(() => StoreRole, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'store_role_id' })
  storeRole: StoreRole;

  @Column({ name: 'work_shift_id', nullable: true })
  workShiftId: string;

  @ManyToOne(() => WorkShift, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'work_shift_id' })
  workShift: WorkShift;

  @Column({ name: 'joined_at', type: 'timestamp', nullable: true })
  joinedAt: Date | null;

  @Column({
    name: 'capability_points',
    type: 'int',
    default: 0,
    comment: 'Điểm năng lực hiện có',
  })
  capabilityPoints: number;

  @OneToMany(() => EmployeeContract, (contract) => contract.employeeProfile)
  contracts: EmployeeContract[];

  @OneToMany(
    () => EmployeeAssetAssignment,
    (assignment: EmployeeAssetAssignment) => assignment.employeeProfile,
  )
  assetAssignments: EmployeeAssetAssignment[];

  @Column({ name: 'termination_reason_id', type: 'uuid', nullable: true })
  terminationReasonId: string | null;

  @ManyToOne(() => EmployeeTerminationReason, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'termination_reason_id' })
  terminationReason: EmployeeTerminationReason;

  @Column({ name: 'left_at', type: 'timestamp', nullable: true })
  leftAt: Date | null;

  @Column({ name: 'probation_ends_at', type: 'timestamp', nullable: true })
  probationEndsAt: Date | null;

  /**
   * Kỹ năng đơn của mô hình cũ. Lộ trình v2 dùng employee_skill_progress; cột
   * này chỉ còn để app cũ đọc và không được ghi trên cửa hàng đã bật v2.
   */
  @Column({ name: 'skill_id', nullable: true })
  skillId: string | null;

  /** Lộ trình v2: bộ phận hiện tại (khoá ngoại kép ở migration_career_v2.sql). */
  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  /** Chỉ để join tên bộ phận; khoá ngoại thật (kép) nằm ở SQL. */
  @ManyToOne(() => StoreDepartment, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'department_id' })
  department: StoreDepartment | null;

  @ManyToOne(() => StoreSkill, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'skill_id' })
  skill: StoreSkill;

  @Column({
    name: 'preferred_shift_types',
    type: 'simple-array',
    nullable: true,
    comment: 'Loại ca ưa thích: morning, noon, evening',
  })
  preferredShiftTypes: string[] | null;

  @Column({
    name: 'shift_preference_note',
    type: 'varchar',
    nullable: true,
    comment: 'Ghi chú sở thích ca',
  })
  shiftPreferenceNote: string | null;

  /**
   * Ngày chính thức vào làm (VN, 'YYYY-MM-DD'), do chủ đặt; khác `joinedAt`
   * (lúc được thêm vào app, mốc của "đợt làm"). Trước ngày này không đăng ký /
   * xếp ca được. Null = không giới hạn. Luật ở work-terms.utils.ts.
   */
  @Column({ name: 'official_start_date', type: 'date', nullable: true })
  officialStartDate: string | null;

  /** Số ngày làm tối đa nhân viên tự đăng ký mỗi tuần (T2–CN); null = không giới hạn. */
  @Column({ name: 'work_days_per_week', type: 'smallint', nullable: true })
  workDaysPerWeek: number | null;

  /** Số ngày làm tối đa nhân viên tự đăng ký mỗi tháng dương lịch; null = không giới hạn. */
  @Column({ name: 'work_days_per_month', type: 'smallint', nullable: true })
  workDaysPerMonth: number | null;

  /** Ngày nghỉ cố định hằng tuần: 0 = Chủ nhật … 6 = Thứ 7. */
  @Column({ name: 'fixed_days_off', type: 'smallint', array: true, default: () => "'{}'" })
  fixedDaysOff: number[];

  /**
   * Ghi chú của chủ về mong muốn của nhân viên. Riêng của chủ: `select: false`
   * để mọi truy vấn hồ sơ (kể cả các route nhân viên / đồng nghiệp đọc được)
   * không mang theo; chỉ chi tiết nhân viên của chủ chọn thêm cột này.
   */
  @Column({ name: 'owner_note', type: 'text', nullable: true, select: false })
  ownerNote?: string | null;

  @Column({
    name: 'reminder_settings',
    type: 'jsonb',
    nullable: true,
    comment: 'Cài đặt nhắc nhở ca làm việc của nhân viên',
  })
  reminderSettings: any | null;
}
