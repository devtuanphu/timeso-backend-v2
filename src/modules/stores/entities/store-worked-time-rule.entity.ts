import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../../common/entities/base.entity';
import type { WorkedTimeMode, WorkedTimePeriod } from '../worked-time-rules';

/**
 * "Cách tính giờ công" chosen by the owner: for the whole store
 * (employee_profile_id NULL) or one employee, for the shifts starting from
 * start_date start_time (Vietnam wall clock) for a day / week / month, up to
 * end_date end_time (exclusive), or indefinitely (end_date NULL). Removing it
 * (deleted_at) only stops it for shifts starting later. See
 * worked-time-rules.ts.
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

  /** `HH:mm`, Vietnam time. */
  @Column({ name: 'start_time', type: 'varchar', length: 5, default: '00:00' })
  startTime: string;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: string | null;

  /** `HH:mm`; NULL on rows saved before start times (end_date inclusive). */
  @Column({ name: 'end_time', type: 'varchar', length: 5, nullable: true })
  endTime: string | null;

  @Column({ name: 'created_by_account_id', type: 'uuid', nullable: true })
  createdByAccountId: string | null;
}
