import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';

/**
 * Bộ phận trong cơ cấu cửa hàng, Cấp 1–4 (lộ trình thăng tiến v2).
 *
 * Cấp 1 là bộ phận hệ thống "Chủ cửa hàng": mỗi cửa hàng đúng một, không có
 * cha, không sửa cấp, không xoá, không ai "lên" được. Mọi bộ phận khác có cha
 * ở cấp nhỏ hơn. Cha cùng cửa hàng được giữ bằng khoá ngoại kép
 * (store_id, parent_id) trong scripts/migration_career_v2.sql — entity chỉ
 * khai cột để TypeORM không tự dựng một khoá đơn cột khác.
 */
@Entity('store_departments')
@Index('ux_store_departments_system', ['storeId'], {
  unique: true,
  where: 'is_system AND deleted_at IS NULL',
})
export class StoreDepartment extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @Column({ type: 'smallint' })
  tier: number;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  description: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_system', default: false })
  isSystem: boolean;
}
