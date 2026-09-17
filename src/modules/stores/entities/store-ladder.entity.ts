import { Entity, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';
import { StoreLadderRung } from './store-ladder-rung.entity';

/**
 * Tác nhân mà một lộ trình nâng nhân viên đi qua.
 *
 * Mỗi tác nhân đã có sẵn một bảng danh mục và một trường đơn trị trên
 * employee_profiles; lộ trình chỉ là cơ chế chung để đi từ giá trị này sang
 * giá trị khác trong danh mục đó. Đây là lý do `StoreLadderRung.targetId`
 * không có khoá ngoại: bảng đích thay đổi theo giá trị dưới đây.
 */
export enum LadderDimension {
  /** store_employee_types -> employee_profiles.employee_type_id */
  EMPLOYMENT_TYPE = 'employment_type',
  /** store_roles -> employee_profiles.store_role_id */
  POSITION = 'position',
  /** store_skills -> employee_profiles.skill_id */
  SKILL = 'skill',
}

@Entity('store_ladders')
export class StoreLadder extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({ type: 'varchar', length: 32 })
  dimension: LadderDimension;

  @Column()
  name: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @OneToMany(() => StoreLadderRung, (rung) => rung.ladder)
  rungs: StoreLadderRung[];
}
