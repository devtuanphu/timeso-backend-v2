import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { StoreLadderRung } from './store-ladder-rung.entity';

export enum CriteriaKind {
  /** Chỉ số đo được từ employee_monthly_summaries hoặc hồ sơ. */
  METRIC = 'metric',
  /** Thời gian đã ở bậc hiện tại, đếm từ lịch sử nghề nghiệp. */
  TENURE = 'tenure',
  /** Mục chủ tick tay lúc đánh giá. */
  CHECKLIST = 'checklist',
  /** Đã đạt một bậc tối thiểu trên lộ trình khác. */
  LADDER = 'ladder',
}

export enum CriteriaOperator {
  GTE = 'gte',
  LTE = 'lte',
}

/**
 * Mã chỉ số đo được. Thêm một điều kiện kiểu mới chỉ là thêm một mã ở đây và
 * một nhánh trong CareerLadderService.measure — không phải dựng thêm cơ chế.
 */
export enum CriteriaCode {
  ON_TIME_PERCENT = 'on_time_percent',
  UNAUTHORIZED_LEAVES = 'unauthorized_leaves',
  COMPLETED_SHIFTS = 'completed_shifts',
  WORK_HOURS = 'work_hours',
  PERFORMANCE_SCORE = 'performance_score',
  KPI_COMPLETION = 'kpi_completion',
  CAPABILITY_POINTS = 'capability_points',
  DAYS_IN_RUNG = 'days_in_rung',
}

@Entity('store_rung_criteria')
export class StoreRungCriteria extends BaseEntity {
  @Column({ name: 'rung_id' })
  rungId: string;

  @ManyToOne(() => StoreLadderRung, (rung) => rung.criteria, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'rung_id' })
  rung: StoreLadderRung;

  @Column({ type: 'varchar', length: 16 })
  kind: CriteriaKind;

  /**
   * Với `metric`/`tenure` là một `CriteriaCode`; với `ladder` là id của lộ
   * trình được tham chiếu; NULL với `checklist`.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  code: string | null;

  @Column({ type: 'varchar', length: 4, nullable: true })
  operator: CriteriaOperator | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  value: number | null;

  /** Nhãn hiển thị cho nhân viên và chủ. Với checklist, đây là nội dung mục. */
  @Column({ type: 'text' })
  label: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  unit: string | null;

  /**
   * Điều kiện không bắt buộc vẫn hiện tiến độ nhưng không chặn việc lên bậc.
   * Trước đây chữ "[Bắt buộc]" được viết thẳng vào nhãn checklist; giờ nó là
   * dữ liệu thật.
   */
  @Column({ name: 'is_required', default: true })
  isRequired: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}
