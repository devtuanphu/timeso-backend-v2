import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * An owner's on/off switches for store notifications (X6). One row per
 * (store, owner); no row means every switch is on and the pre-shift lead
 * time is 30 minutes (DEFAULT_OWNER_NOTIFICATION_SETTINGS).
 *
 * Schema: scripts/migration_owner_notifications.sql.
 */
@Entity('owner_notification_settings')
@Unique('uq_owner_notification_settings_store_owner', [
  'storeId',
  'ownerAccountId',
])
export class OwnerNotificationSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'owner_account_id', type: 'uuid' })
  ownerAccountId: string;

  @Column({ name: 'pre_shift_enabled', type: 'boolean', default: true })
  preShiftEnabled: boolean;

  @Column({ name: 'pre_shift_minutes', type: 'smallint', default: 30 })
  preShiftMinutes: number;

  @Column({ name: 'check_in_enabled', type: 'boolean', default: true })
  checkInEnabled: boolean;

  @Column({ name: 'check_out_enabled', type: 'boolean', default: true })
  checkOutEnabled: boolean;

  @Column({ name: 'shift_ending_enabled', type: 'boolean', default: true })
  shiftEndingEnabled: boolean;

  @Column({ name: 'late_early_enabled', type: 'boolean', default: true })
  lateEarlyEnabled: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/**
 * One owner notification that was sent, keyed so a retried job or a repeated
 * check-in can never notify twice. Rows are tiny and only read by key.
 */
@Entity('owner_notification_log')
export class OwnerNotificationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dedup_key', type: 'varchar', length: 200, unique: true })
  dedupKey: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'owner_account_id', type: 'uuid' })
  ownerAccountId: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
