import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../../common/entities/base.entity';
import type { WorkedTimeMode, WorkedTimePeriod } from '../worked-time-rules';

/**
 * "Cách tính giờ công" chosen by the owner: for the whole store
 * (employee_profile_id NULL) or one employee, from start_date for a day /
 * week / month or indefinitely (end_date NULL). See worked-time-rules.ts.
 *
 * One rule for several employees is saved as one row per employee sharing
 * `group_id`; it is listed, recomputed and removed as one.
 */
@Entity('store_worked_time_rules')
@Index('idx_store_worked_time_rules_store_start', ['storeId', 'startDate'])
export class StoreWorkedTimeRule extends BaseEntity {
  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'employee_profile_id', type: 'uuid', nullable: true })
  employeeProfileId: string | null;

  @Column({ name: 'group_id', type: 'uuid', nullable: true })
  groupId: string | null;

  @Column({ type: 'varchar', length: 16 })
  mode: WorkedTimeMode;

  @Column({ type: 'varchar', length: 16 })
  period: WorkedTimePeriod;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: string | null;

  @Column({ name: 'created_by_account_id', type: 'uuid', nullable: true })
  createdByAccountId: string | null;
}
