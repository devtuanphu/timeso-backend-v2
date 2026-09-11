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
import { UserDevice } from '../../devices/entities/user-device.entity';
import { ChatGroup } from './chat-group.entity';
import { ChatMessage } from './chat-message.entity';

export enum ChatPushDeliveryStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  TICKET_ACCEPTED = 'ticket_accepted',
  DELIVERED = 'delivered',
  SUPPRESSED = 'suppressed',
  DEAD = 'dead',
}

@Entity('chat_push_deliveries')
@Check('ck_chat_push_delivery_attempts', '"attempt_count" >= 0 AND "receipt_attempt_count" >= 0')
@Index('ux_chat_push_delivery_message_device', ['messageId', 'userDeviceId'], {
  unique: true,
})
@Index(
  'ux_chat_push_delivery_message_token',
  ['messageId', 'expectedTokenFingerprint'],
  { unique: true },
)
@Index('ix_chat_push_delivery_dispatch', ['status', 'availableAt', 'createdAt'], {
  where: '"status" IN (\'pending\', \'processing\') AND "deleted_at" IS NULL',
})
@Index('ix_chat_push_delivery_receipt', ['status', 'receiptAvailableAt'], {
  where: '"status" = \'ticket_accepted\' AND "deleted_at" IS NULL',
})
@Index('ix_chat_push_delivery_lease', ['lockedAt'], {
  where: '"status" = \'processing\' AND "deleted_at" IS NULL',
})
export class ChatPushDelivery extends BaseEntity {
  @Column({ type: 'uuid', name: 'message_id' })
  messageId: string;

  @ManyToOne(() => ChatMessage, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'message_id' })
  message: ChatMessage;

  @Column({ type: 'uuid', name: 'group_id' })
  groupId: string;

  @ManyToOne(() => ChatGroup, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'group_id' })
  group: ChatGroup;

  @Column({ type: 'uuid', name: 'intended_account_id' })
  intendedAccountId: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'intended_account_id' })
  intendedAccount: Account;

  @Column({ type: 'uuid', name: 'user_device_id' })
  userDeviceId: string;

  @ManyToOne(() => UserDevice, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_device_id' })
  userDevice: UserDevice;

  @Column({ type: 'varchar', length: 255, name: 'expected_device_id' })
  expectedDeviceId: string;

  @Column({ type: 'char', length: 64, name: 'expected_token_fingerprint' })
  expectedTokenFingerprint: string;

  @Column({ type: 'bigint', name: 'expected_registration_version' })
  expectedRegistrationVersion: string;

  @Column({ type: 'enum', enum: ChatPushDeliveryStatus, default: ChatPushDeliveryStatus.PENDING })
  status: ChatPushDeliveryStatus;

  @Column({ type: 'integer', default: 0, name: 'attempt_count' })
  attemptCount: number;

  @Column({ type: 'integer', default: 0, name: 'receipt_attempt_count' })
  receiptAttemptCount: number;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP', name: 'available_at' })
  availableAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'locked_at' })
  lockedAt: Date | null;

  @Column({ type: 'uuid', nullable: true, name: 'claim_token' })
  claimToken: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'expo_ticket_id' })
  expoTicketId: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'ticket_accepted_at' })
  ticketAcceptedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'receipt_available_at' })
  receiptAvailableAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'delivered_at' })
  deliveredAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'suppressed_at' })
  suppressedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'dead_at' })
  deadAt: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'error_code' })
  errorCode: string | null;
}
