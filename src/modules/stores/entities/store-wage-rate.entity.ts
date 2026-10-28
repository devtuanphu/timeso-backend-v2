import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';

/**
 * Đơn giá lương theo ca / vị trí / khung giờ (Thiết lập tính lương). Luật áp
 * dụng ở wage-rates.utils.ts. Danh sách được lưu thay cả bộ (PUT), nên hàng
 * cũ bị xoá hẳn — không bảng nào trỏ tới đây.
 */
@Entity('store_wage_rates')
export class StoreWageRate extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({ type: 'varchar', length: 80, nullable: true })
  name: string | null;

  /** HOUR (đồng / giờ) hoặc SHIFT (đồng / ca). */
  @Column({ type: 'varchar', length: 10 })
  unit: 'HOUR' | 'SHIFT';

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  /** Ca áp dụng (work_shifts); trống = mọi ca. */
  @Column({ name: 'work_shift_ids', type: 'uuid', array: true, default: () => "'{}'" })
  workShiftIds: string[];

  /** Vị trí áp dụng (store_roles); trống = mọi vị trí. */
  @Column({ name: 'role_ids', type: 'uuid', array: true, default: () => "'{}'" })
  roleIds: string[];

  /** Khung giờ trong ngày (giờ VN); cả hai null = cả ngày. */
  @Column({ name: 'time_from', type: 'time', nullable: true })
  timeFrom: string | null;

  @Column({ name: 'time_to', type: 'time', nullable: true })
  timeTo: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}
