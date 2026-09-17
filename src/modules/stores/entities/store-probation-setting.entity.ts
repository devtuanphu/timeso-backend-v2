import { Entity, Column, ManyToOne, JoinColumn, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';

/**
 * Chính sách thử việc của một cửa hàng.
 *
 * Phần *điều kiện* — số ngày, số ca, và hai checklist — đã chuyển sang lộ
 * trình `employment_type` dưới dạng store_rung_criteria, nơi mọi điều kiện lên
 * bậc được mô tả theo cùng một cách. Ở lại đây chỉ còn chính sách: nhắc ai,
 * báo cho ai, thưởng bao nhiêu.
 */
@Entity('store_probation_settings')
export class StoreProbationSetting extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({ name: 'notify_evaluation', default: false })
  notifyEvaluation: boolean; // Kích hoạt thông báo nhắc đánh giá

  @Column({ name: 'notify_result_to_employee', default: false })
  notifyResultToEmployee: boolean; // Thông báo kết quả cho nhân viên

  @Column({ name: 'auto_close_checklist', default: false })
  autoCloseChecklist: boolean; // In/đóng file checklist khi kết thúc

  // -- Thiết lập thưởng hoàn thành thử việc --
  @Column({ name: 'enable_completion_bonus', default: false })
  enableCompletionBonus: boolean;

  @Column({ name: 'completion_bonus', type: 'decimal', precision: 12, scale: 2, default: 0 })
  completionBonus: number; // Mức thưởng

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
