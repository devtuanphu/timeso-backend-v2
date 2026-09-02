import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { ChatGroup } from './chat-group.entity';
import { Account } from '../../accounts/entities/account.entity';

@Entity('chat_messages')
@Index('ux_chat_group_message_sequence', ['groupId', 'sequence'], {
  unique: true,
  where: '"sequence" IS NOT NULL',
})
@Index(
  'ux_chat_message_client_idempotency',
  ['groupId', 'senderId', 'clientMessageId'],
  { unique: true, where: '"client_message_id" IS NOT NULL' },
)
export class ChatMessage extends BaseEntity {
  @Column({ type: 'uuid', name: 'group_id' })
  groupId: string;

  @ManyToOne(() => ChatGroup, (group) => group.messages)
  @JoinColumn({ name: 'group_id' })
  group: ChatGroup;

  @Column({ type: 'uuid', name: 'sender_id' })
  senderId: string;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'sender_id' })
  sender: Account;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'bigint', nullable: true })
  sequence: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'client_message_id' })
  clientMessageId: string | null;

  @Column({
    type: 'enum',
    enum: ['text', 'image', 'file', 'system'],
    default: 'text',
    name: 'message_type',
  })
  messageType: string;

  @Column({ type: 'varchar', nullable: true, name: 'attachment_url' })
  attachmentUrl: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'attachment_name' })
  attachmentName: string | null;

  @Column({ type: 'bigint', nullable: true, name: 'attachment_size' })
  attachmentSize: string | null;

  @Column({ type: 'simple-array', nullable: true, name: 'read_by' })
  readBy: string[];
}
