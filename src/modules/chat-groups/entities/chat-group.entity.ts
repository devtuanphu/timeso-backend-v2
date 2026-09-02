import {
  Entity,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from '../../stores/entities/store.entity';
import { Account } from '../../accounts/entities/account.entity';
import { ChatGroupMember } from './chat-group-member.entity';
import { ChatMessage } from './chat-message.entity';

@Entity('chat_groups')
export class ChatGroup extends BaseEntity {
  @Column()
  name: string;

  @Column({ nullable: true })
  avatar: string;

  @Column({ type: 'uuid', name: 'store_id' })
  storeId: string;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy: string;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'created_by' })
  creator: Account;

  @Column({
    type: 'enum',
    enum: ['everyone', 'custom', 'admin_only'],
    default: 'everyone',
    name: 'message_permission',
  })
  messagePermission: string;

  @Column({ type: 'simple-array', nullable: true, name: 'custom_sender_ids' })
  customSenderIds: string[];

  @Column({ type: 'bigint', nullable: true, name: 'next_message_sequence' })
  nextMessageSequence: string | null;

  @OneToMany(() => ChatGroupMember, (member) => member.group)
  members: ChatGroupMember[];

  @OneToMany(() => ChatMessage, (message) => message.group)
  messages: ChatMessage[];
}
