import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

@Entity('user_devices')
@Index('ux_user_devices_active_push_fingerprint', ['pushTokenFingerprint'], {
  unique: true,
  where:
    '"push_token_fingerprint" IS NOT NULL AND "is_active" = true AND "deleted_at" IS NULL',
})
export class UserDevice extends BaseEntity {
  @Column({ type: 'varchar', name: 'user_id', nullable: true })
  userId: string | null;

  @Column({ unique: true, name: 'device_id' })
  deviceId: string;

  @Column({ name: 'expo_push_token' })
  expoPushToken: string;

  /**
   * SHA-256 of expoPushToken. The raw token remains private provider material;
   * this fingerprint is the stable ownership/uniqueness key used by dispatch.
   * Legacy rows are intentionally null until the device registers again.
   */
  @Column({
    type: 'char',
    length: 64,
    nullable: true,
    name: 'push_token_fingerprint',
  })
  pushTokenFingerprint: string | null;

  /** Changes only when the security binding of this device registration changes. */
  @Column({ type: 'bigint', default: '0', name: 'registration_version' })
  registrationVersion: string;

  @Column()
  platform: 'android' | 'ios';

  @Column({ type: 'varchar', name: 'app_version', nullable: true })
  appVersion: string | null;

  /**
   * Push capabilities the registered build declared (see
   * push/push-capabilities.ts), e.g. 'shift-alert-channels'. Null/empty for
   * builds that predate the field. Column added by
   * scripts/migration_user_devices_push_capabilities.sql.
   */
  @Column({ type: 'simple-array', name: 'push_capabilities', nullable: true })
  pushCapabilities: string[] | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'last_seen_at', type: 'timestamp', nullable: true })
  lastSeenAt: Date;
}
