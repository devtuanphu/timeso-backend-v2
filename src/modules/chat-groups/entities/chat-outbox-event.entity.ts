import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';

import { BaseEntity } from '../../../common/entities/base.entity';
import { Account } from '../../accounts/entities/account.entity';
import { ChatGroup } from './chat-group.entity';
import { ChatMessage } from './chat-message.entity';

export enum ChatOutboxEventType {
  MESSAGE_CREATED_V1 = 'MESSAGE_CREATED_V1',
  READ_UPDATED_V1 = 'READ_UPDATED_V1',
}

export enum ChatOutboxStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  PUBLISHED = 'published',
  DEAD = 'dead',
}

@Entity('chat_outbox_events')
@Check(
  'ck_chat_outbox_event_identity',
  `("event_type" = 'MESSAGE_CREATED_V1' AND "message_id" IS NOT NULL AND "actor_account_id" IS NOT NULL AND "sequence" IS NOT NULL)
   OR ("event_type" = 'READ_UPDATED_V1' AND "message_id" IS NULL AND "actor_account_id" IS NOT NULL AND "sequence" IS NOT NULL)`,
)
@Index('ux_chat_outbox_message_created', ['messageId', 'eventType'], {
  unique: true,
  where:
    '"event_type" = \'MESSAGE_CREATED_V1\' AND "deleted_at" IS NULL',
})
@Index('ix_chat_outbox_dispatch', ['status', 'availableAt', 'createdAt'], {
  where:
    '"status" IN (\'pending\', \'processing\') AND "deleted_at" IS NULL',
})
@Index('ix_chat_outbox_lease', ['lockedAt'], {
  where: '"status" = \'processing\' AND "deleted_at" IS NULL',
})
@Index('ix_chat_outbox_group_sequence', ['groupId', 'sequence'])
@Index('ix_chat_outbox_cleanup_published', ['publishedAt'], {
  where: '"status" = \'published\'',
})
@Index('ix_chat_outbox_cleanup_dead', ['deadAt'], {
  where: '"status" = \'dead\'',
})
export class ChatOutboxEvent extends BaseEntity {
  @Column({ type: 'enum', enum: ChatOutboxEventType, name: 'event_type' })
  eventType: ChatOutboxEventType;

  @Column({ type: 'uuid', name: 'group_id' })
  groupId: string;

  @ManyToOne(() => ChatGroup)
  @JoinColumn({ name: 'group_id' })
  group: ChatGroup;

  @Column({ type: 'uuid', nullable: true, name: 'message_id' })
  messageId: string | null;

  @ManyToOne(() => ChatMessage, { nullable: true })
  @JoinColumn({ name: 'message_id' })
  message: ChatMessage | null;

  @Column({ type: 'uuid', nullable: true, name: 'actor_account_id' })
  actorAccountId: string | null;

  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'actor_account_id' })
  actorAccount: Account | null;

  @Column({ type: 'bigint', nullable: true })
  sequence: string | null;

  @Column({ type: 'enum', enum: ChatOutboxStatus, default: ChatOutboxStatus.PENDING })
  status: ChatOutboxStatus;

  @Column({ type: 'integer', default: 0, name: 'attempt_count' })
  attemptCount: number;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP', name: 'available_at' })
  availableAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'locked_at' })
  lockedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'published_at' })
  publishedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'dead_at' })
  deadAt: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'error_code' })
  errorCode: string | null;
}
