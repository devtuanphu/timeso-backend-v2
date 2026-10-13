import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';
import type { ReviewFrequency } from '../career/career-time';

/**
 * Cài đặt lộ trình v2 của một cửa hàng — một dòng mỗi cửa hàng.
 *
 * Dòng này cũng là khoá của cửa hàng cho mọi thao tác ghi lộ trình v2: ghi
 * cấu trúc khoá `FOR UPDATE`, lên vị trí / chấm kỹ năng khoá `FOR SHARE` trước
 * khi khoá hồ sơ (career-structure.service.ts).
 */
@Entity('store_career_settings')
@Unique('ux_store_career_settings_store', ['storeId'])
export class StoreCareerSetting extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({ name: 'review_reminder_enabled', default: false })
  reviewReminderEnabled: boolean;

  @Column({ name: 'review_frequency', type: 'varchar', length: 8, default: 'month' })
  reviewFrequency: ReviewFrequency;

  /** Khoá kỳ rà soát đã nhắc (career-time.reviewPeriodKey). */
  @Column({ name: 'last_reminded_period', type: 'varchar', length: 16, nullable: true })
  lastRemindedPeriod: string | null;

  /**
   * Bật lộ trình v2 cho cửa hàng. Chỉ bật bằng scripts/career_v2_enable_store.sql
   * (không có API ghi): bật kèm chuyển nốt dữ liệu phát sinh trong cùng
   * transaction.
   */
  @Column({ name: 'v2_enabled', default: false })
  v2Enabled: boolean;
}
