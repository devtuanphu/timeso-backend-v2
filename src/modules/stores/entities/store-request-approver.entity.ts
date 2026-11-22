import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';
import { EmployeeProfile } from './employee-profile.entity';

/**
 * The request families an owner can delegate to a scoped approver. The string
 * values are the stable contract shared with both mobile apps and are mirrored
 * by the CHECK constraint in
 * `scripts/migration_store_request_approvers.sql` — keep the two in sync.
 */
export enum RequestApproverType {
  SHIFT_REGISTRATION = 'shift_registration',
  SHIFT_CHANGE = 'shift_change',
  CUSTOM_SHIFT = 'custom_shift',
  LEAVE = 'leave',
  LATE = 'late',
  EARLY = 'early',
  BONUS_WORK = 'bonus_work',
  SALARY_ADVANCE = 'salary_advance',
  KPI = 'kpi',
  JOB_APPLICATION = 'job_application',
}

export const REQUEST_APPROVER_TYPES = Object.values(RequestApproverType);

/**
 * "Cài đặt người phê duyệt": one employee a store owner delegates to approve a
 * chosen set of request types, optionally narrowed by department / position /
 * skill. The scope dimensions are plain `uuid[]` **without** foreign keys on
 * purpose (see the migration): an empty dimension means "tất cả", and a deleted
 * id simply stops matching (fail-closed) instead of a join-table cascade
 * silently widening the scope to everything.
 *
 * `primary/backup_approver_id` on `store_approval_settings` stay display-only;
 * this table is the one the enforcement path (`ApproverScopeService`) reads.
 */
@Entity('store_request_approvers')
// One active delegation row per (store, employee). Partial so a soft-deleted
// row never blocks re-adding the same employee.
@Index('ux_store_request_approvers_store_employee', ['storeId', 'employeeProfileId'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('idx_store_request_approvers_store', ['storeId'], {
  where: 'deleted_at IS NULL',
})
export class StoreRequestApprover extends BaseEntity {
  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({ name: 'employee_profile_id', type: 'uuid' })
  employeeProfileId: string;

  @ManyToOne(() => EmployeeProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_profile_id' })
  employeeProfile: EmployeeProfile;

  /** The request-type string values of {@link RequestApproverType}. */
  @Column({ name: 'request_types', type: 'text', array: true, default: () => "'{}'" })
  requestTypes: string[];

  /** Empty = all departments. */
  @Column({ name: 'department_ids', type: 'uuid', array: true, default: () => "'{}'" })
  departmentIds: string[];

  /** Empty = all positions (store roles). */
  @Column({ name: 'position_ids', type: 'uuid', array: true, default: () => "'{}'" })
  positionIds: string[];

  /** Empty = all skills (an achieved skill satisfies the dimension). */
  @Column({ name: 'skill_ids', type: 'uuid', array: true, default: () => "'{}'" })
  skillIds: string[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /**
   * R2 "Được xem lý do đơn": when FALSE (the safe default) this scoped approver
   * never sees the employee's free-text reason/note/requestReason — it is
   * stripped server-side from every scoped list, the decision response and the
   * fan-out push. The owner always sees reasons through their own endpoints.
   */
  @Column({ name: 'can_view_reasons', type: 'boolean', default: false })
  canViewReasons: boolean;
}
