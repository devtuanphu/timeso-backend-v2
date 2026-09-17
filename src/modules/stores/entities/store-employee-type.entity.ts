import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';

/**
 * Danh mục loại nhân viên của một cửa hàng: Thử việc, Chính thức, Học việc…
 *
 * Bảng này từng kiêm cả vai trò thang lộ trình — nó mang `level` và bốn cột
 * `req_*` mô tả điều kiện lên bậc — nên loại nhân viên và vị trí bị trộn vào
 * nhau và mỗi cửa hàng chỉ có đúng một lộ trình. Các cột đó đã chuyển sang
 * store_ladder_rungs / store_rung_criteria; ở đây chỉ còn là danh mục.
 */
@Entity('store_employee_types')
export class StoreEmployeeType extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({ nullable: true })
  code: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  /**
   * Nhân viên mang loại này thì `employment_status` là `probation`. Cờ dữ liệu
   * thay cho việc đoán theo tên, vì mỗi cửa hàng đặt tên một kiểu.
   */
  @Column({ name: 'is_probation', default: false })
  isProbation: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
