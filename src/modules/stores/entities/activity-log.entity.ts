import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ActivityActorRole = 'owner' | 'staff' | 'system';

/**
 * One business action in a store ("Lịch sử thao tác"). Append-only: rows are
 * written by ActivityLogService.record inside the transaction of the state
 * change they describe, and never updated.
 *
 * `params` holds only non-sensitive display data (shift names, HH:mm times,
 * dates, statuses, counts). No money amounts, face/location data, free-text
 * reasons or identity numbers — see sanitizeActivityParams.
 *
 * Schema: scripts/migration_activity_logs.sql (schema is managed, not
 * synchronized — keep both in step). Its (store|subject|actor, occurred_at
 * DESC, id DESC) indexes live only in the SQL: TypeORM cannot declare DESC.
 *
 * Deliberately no foreign keys (no @ManyToOne): a store FK would make each
 * insert take FOR KEY SHARE on the stores row and stall check-ins behind
 * schedule writes that hold that row FOR UPDATE.
 */
@Entity('activity_logs')
export class ActivityLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'actor_account_id', type: 'uuid', nullable: true })
  actorAccountId: string | null;

  @Column({ name: 'actor_role', type: 'varchar', length: 16 })
  actorRole: ActivityActorRole;

  @Column({ name: 'subject_employee_profile_id', type: 'uuid', nullable: true })
  subjectEmployeeProfileId: string | null;

  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Column({ name: 'resource_type', type: 'varchar', length: 32 })
  resourceType: string;

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  params: Record<string, unknown>;

  @Column({
    name: 'occurred_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  occurredAt: Date;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 200,
    nullable: true,
    unique: true,
  })
  idempotencyKey: string | null;
}
