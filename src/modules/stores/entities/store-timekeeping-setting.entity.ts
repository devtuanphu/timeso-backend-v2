
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';

@Entity('store_timekeeping_settings')
export class StoreTimekeepingSetting extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  // -- Ca làm việc (Global) --
  @Column({ name: 'enable_flexible_shift', default: false })
  enableFlexibleShift: boolean;

  /**
   * Ca linh hoạt áp dụng cho ai: ALL = toàn bộ nhân viên, SELECTED = chỉ
   * `flexibleShiftEmployeeIds`. Mới chỉ lưu (app chủ ghi "Chưa áp dụng").
   */
  @Column({ name: 'flexible_shift_scope', type: 'varchar', length: 16, default: 'ALL' })
  flexibleShiftScope: 'ALL' | 'SELECTED';

  @Column({ type: 'simple-array', name: 'flexible_shift_employee_ids', nullable: true })
  flexibleShiftEmployeeIds: string[] | null;

  // -- Vị trí chấm công --
  @Column({ name: 'require_location', default: true })
  requireLocation: boolean;

  @Column({ name: 'attendance_radius', type: 'int', default: 50, comment: 'Khoảng cách chấm công tối đa (mét)' })
  attendanceRadius: number;

  @Column({ name: 'require_qr_scan', default: true, comment: 'Bắt buộc quét QR cửa hàng khi chấm công' })
  requireQrScan: boolean;

  @Column({ type: 'simple-array', name: 'location_exception_emp_ids', nullable: true })
  locationExceptionEmployeeIds: string[];

  // -- Quy định đi muộn / Về sớm --
  @Column({ name: 'allowed_late_minutes', type: 'int', default: 0 })
  allowedLateMinutes: number; // Cho phép đi muộn tối đa X phút

  /**
   * Cho phép về sớm tối đa X phút. NULL: cửa hàng chưa đặt riêng (trước khi
   * tách khỏi đi muộn) — dùng allowedLateMinutes.
   */
  @Column({ name: 'allowed_early_leave_minutes', type: 'int', nullable: true })
  allowedEarlyLeaveMinutes: number | null;

  @Column({ name: 'deduct_work_time_if_late', default: true })
  deductWorkTimeIfLate: boolean; // Trừ giờ công nếu vượt quá

  @Column({ name: 'show_late_alert', default: true })
  showLateAlert: boolean; // Hiển thị cảnh báo

  @Column({ name: 'count_full_time_if_late', default: false })
  countFullTimeIfLate: boolean; // Tính công đầy đủ dù đi muộn/về sớm

  // -- Giới hạn check-in/out --
  @Column({ name: 'early_checkin_minutes', type: 'int', default: 15 })
  earlyCheckinMinutes: number; // Cho phép check-in trước giờ làm

  @Column({ name: 'late_checkout_minutes', type: 'int', default: 15 })
  lateCheckoutMinutes: number; // Cho phép check-out sau giờ làm

  /** Tăng ca tối đa cho một ca (phút); đơn xin tăng ca dài hơn bị từ chối. */
  @Column({ name: 'max_overtime_minutes', type: 'int', default: 480 })
  maxOvertimeMinutes: number;

  /**
   * Cảnh báo khi xếp một nhân viên vào hai ca cách nhau ít hơn
   * `minRestMinutes` (Bộ luật Lao động: làm theo ca được nghỉ ít nhất 12 giờ
   * trước khi chuyển ca). Chỉ cảnh báo ở danh sách chọn nhân viên, không chặn.
   */
  @Column({ name: 'rest_warning_enabled', default: false })
  restWarningEnabled: boolean;

  @Column({ name: 'min_rest_minutes', type: 'int', default: 720 })
  minRestMinutes: number;

  // -- Làm trễ / Làm thêm giờ --
  @Column({ name: 'enable_overtime_multiplier', default: false })
  enableOvertimeMultiplier: boolean;

  @Column({ name: 'overtime_multiplier', type: 'decimal', precision: 5, scale: 2, default: 1.5 })
  overtimeMultiplier: number;

  @Column({ name: 'notify_late_shift', default: false })
  notifyLateShift: boolean; // Nhắc nhở sớm qua App/Zalo

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
