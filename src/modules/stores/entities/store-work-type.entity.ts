import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';

/**
 * Hình thức làm việc của cửa hàng: Toàn thời gian, Bán thời gian, Thời vụ…
 *
 * Chỉ để phân loại nhân viên — không ảnh hưởng lương, ca hay chấm công. Khác
 * với store_employee_types (giai đoạn: Học việc → Thử việc → Chính thức), thứ
 * trước đây cũng được gọi là "hình thức làm việc" trên app.
 */
@Entity('store_work_types')
export class StoreWorkType extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}

/** Bốn mục mặc định, tạo khi cửa hàng mở danh mục lần đầu. */
export const DEFAULT_WORK_TYPES: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'Toàn thời gian', description: 'Làm việc cố định, full thời gian theo ca' },
  { name: 'Bán thời gian', description: 'Làm việc theo ca, thời gian linh hoạt' },
  { name: 'Thời vụ', description: 'Làm việc trong thời gian ngắn' },
  { name: 'Làm việc tại nhà', description: 'Làm việc từ xa, online' },
];
