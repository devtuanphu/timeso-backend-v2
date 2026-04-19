import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('cron_locks')
export class CronLock {
  @PrimaryColumn({ name: 'lock_name' })
  lockName: string;

  @Column({ name: 'instance_id' })
  instanceId: string;

  @Column({ name: 'acquired_at', type: 'timestamptz' })
  acquiredAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}
