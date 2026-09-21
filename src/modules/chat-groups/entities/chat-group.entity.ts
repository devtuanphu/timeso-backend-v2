import {
  Entity,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from '../../stores/entities/store.entity';
import { Account } from '../../accounts/entities/account.entity';
import { ChatGroupMember } from './chat-group-member.entity';
import { ChatMessage } from './chat-message.entity';

@Entity('chat_groups')
// Cùng tên/điều kiện với scripts/migration_chat_direct_expand.sql để DB tự đồng
// bộ schema (bootstrap/e2e) cũng có ràng buộc duy nhất cho chat riêng.
@Index('uq_chat_groups_direct_key', ['directKey'], {
  unique: true,
  where: '"direct_key" IS NOT NULL AND "deleted_at" IS NULL',
})
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

  /**
   * Chat riêng 1-1: '<storeId>:<accountA>:<accountB>' (hai account đã sắp xếp).
   * NULL với nhóm chat thường. Duy nhất (xem migration_chat_direct_expand.sql).
   */
  @Column({ type: 'varchar', length: 200, nullable: true, name: 'direct_key' })
  directKey: string | null;

  @Column({ type: 'bigint', nullable: true, name: 'next_message_sequence' })
  nextMessageSequence: string | null;

  @OneToMany(() => ChatGroupMember, (member) => member.group)
  members: ChatGroupMember[];

  @OneToMany(() => ChatMessage, (message) => message.group)
  messages: ChatMessage[];
}
