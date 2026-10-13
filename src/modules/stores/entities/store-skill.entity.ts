import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';

export enum SkillLevel {
  REQUIRED = 'required',
  OPTIONAL = 'optional',
}

export enum SkillConfirmation {
  /** Chủ / quản lý bấm xác nhận khi đủ điều kiện (bản này: chủ cửa hàng). */
  MANAGER = 'manager',
  /** Tự đạt khi đủ điều kiện. */
  AUTO = 'auto',
}

/**
 * Kỹ năng. Lộ trình v2: thuộc một bộ phận, mở khoá tuần tự theo `sequence`
 * (KN bắt buộc đứng trước phải đạt), Bắt buộc / Tuỳ chọn. Kỹ năng bị xoá mềm
 * được đặt sequence = null.
 */
@Entity('store_skills')
@Unique('ux_store_skills_department_sequence', ['departmentId', 'sequence'], {
  deferrable: 'INITIALLY IMMEDIATE',
})
export class StoreSkill extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  @Column({ type: 'int', nullable: true })
  sequence: number | null;

  @Column({ type: 'varchar', length: 16, default: SkillLevel.REQUIRED })
  level: SkillLevel;

  @Column({ type: 'varchar', length: 16, default: SkillConfirmation.MANAGER })
  confirmation: SkillConfirmation;
}
