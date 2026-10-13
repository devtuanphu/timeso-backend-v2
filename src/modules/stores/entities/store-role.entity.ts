import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';
import { StorePermissionConfig } from './store-permission-config.entity';

/**
 * Vị trí ("Vị trí" trên app; tên bảng giữ là store_roles). Lộ trình v2: vị trí
 * thuộc một bộ phận và có `rank` thấp → cao trong bộ phận đó. Vị trí bị xoá
 * mềm được đặt rank = null để không chiếm chỗ trong ràng buộc unique.
 */
@Entity('store_roles')
@Unique('ux_store_roles_department_rank', ['departmentId', 'rank'], {
  deferrable: 'INITIALLY IMMEDIATE',
})
export class StoreRole extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({ nullable: true })
  code: string; // MANAGER, WAITER

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 1,
    comment: 'Hệ số lương'
  })
  coefficient: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
    comment: 'Phụ cấp cố định'
  })
  allowance: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /** Lộ trình v2: bộ phận chứa vị trí (khoá ngoại kép ở migration_career_v2.sql). */
  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  /** Thứ tự thấp → cao trong bộ phận, bắt đầu từ 1. */
  @Column({ type: 'int', nullable: true })
  rank: number | null;

  @Column({ name: 'permission_config_id', nullable: true })
  permissionConfigId: string | null;

  @ManyToOne(() => StorePermissionConfig, (config) => config.roles, { nullable: true })
  @JoinColumn({ name: 'permission_config_id' })
  permissionConfig: StorePermissionConfig;
}
