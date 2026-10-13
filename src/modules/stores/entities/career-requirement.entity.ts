import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { CareerRequirementCode } from '../career/career.constants';

/**
 * Một điều kiện để VÀO một bộ phận, vị trí hoặc kỹ năng (đúng một trong ba
 * cột chủ thể có giá trị). Cửa sổ đo suy từ `code`; xem
 * career/career-evaluation.service.ts. Khoá ngoại kép (store_id, …) nằm trong
 * scripts/migration_career_v2.sql.
 */
@Entity('career_requirements')
export class CareerRequirement extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  @Column({ name: 'position_id', type: 'uuid', nullable: true })
  positionId: string | null;

  @Column({ name: 'skill_id', type: 'uuid', nullable: true })
  skillId: string | null;

  @Column({ type: 'varchar', length: 32 })
  code: CareerRequirementCode;

  @Column({ type: 'varchar', length: 4, default: 'gte' })
  operator: 'gte' | 'lte';

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  value: string | number | null;

  /** Chỉ với `skill_achieved`: kỹ năng phải đạt. */
  @Column({ name: 'ref_skill_id', type: 'uuid', nullable: true })
  refSkillId: string | null;

  @Column({ name: 'is_required', default: true })
  isRequired: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}
