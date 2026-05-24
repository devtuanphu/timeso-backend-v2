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
}

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

  @Column({ name: 'skill_id', nullable: true })
  skillId: string | null;

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
}
