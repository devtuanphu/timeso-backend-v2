import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Account } from '../../accounts/entities/account.entity';

export enum NotificationType {
  SYSTEM = 'Hệ thống',
  SCHEDULE_CONFIRMATION = 'Xác nhận lịch',
  SHIFT_APPROVAL = 'Duyệt ca',
  STAFF_SHORTAGE = 'Thiếu nhân viên',
  SHIFT_REMINDER = 'Nhắc ca làm',
  SHIFT_CHECKOUT_REMINDER = 'Nhắc chấm công ra',
  SHIFT_AUTO_CHECKOUT = 'Tự động kết thúc ca',
  OVERTIME_REQUEST_STATUS = 'Trạng thái tăng ca',
}

export enum NotificationPriority {
  LOW = 'Thấp',
  NORMAL = 'Bình thường',
  HIGH = 'Cao',
  URGENT = 'Khẩn cấp',
}

@Entity('notifications')
export class Notification extends BaseEntity {
  @Column({ name: 'account_id' })
  accountId: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ name: 'store_id', nullable: true })
  storeId: string; // For filtering by store

  @Column()
  title: string; // Tiêu đề thông báo

  @Column({ type: 'text' })
  content: string; // Nội dung thông báo

  @Column({
    type: 'enum',
    enum: NotificationType,
    default: NotificationType.SYSTEM,
  })
  type: NotificationType;

  @Column({
    name: 'priority',
    type: 'enum',
    enum: NotificationPriority,
    default: NotificationPriority.NORMAL,
  })
  priority: NotificationPriority;

  @Column({ name: 'is_read', default: false })
  isRead: boolean; // Đã đọc chưa

  @Column({ name: 'read_at', nullable: true })
  readAt: Date; // Thời gian đọc

  @Column({ name: 'action_url', nullable: true })
  actionUrl: string; // URL để điều hướng khi click vào thông báo

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>; // Dữ liệu bổ sung (VD: storeId, kpiId, etc.)
}
