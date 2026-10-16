
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';

export enum PayrollRuleCategory {
  BONUS = 'bonus',
  FINE = 'fine',
  BENEFIT = 'benefit',
}

export enum PayrollCalcType {
  AMOUNT = 'amount',
  PERCENTAGE = 'percentage',
  SHIFT = 'shift',
}

/**
 * Khoản thưởng / vi phạm v2 (Thiết lập tính lương). Null trên các dòng cũ:
 * dòng cũ (calc_mode null) giữ nguyên cách tính cũ theo rule_type.
 */
export enum PayrollRuleCode {
  OVERTIME = 'OVERTIME',
  RESPONSIBILITY = 'RESPONSIBILITY',
  ATTENDANCE = 'ATTENDANCE',
  PUNCTUALITY = 'PUNCTUALITY',
  SALES = 'SALES',
  NIGHT_SHIFT = 'NIGHT_SHIFT',
  HOT_BONUS = 'HOT_BONUS',
  LATE = 'LATE',
  EARLY = 'EARLY',
  MISSED_PUNCH = 'MISSED_PUNCH',
  ABSENT = 'ABSENT',
  RULE_VIOLATION = 'RULE_VIOLATION',
  CUSTOM = 'CUSTOM',
}

/** Khoản hệ thống không tự biết ai đạt: chủ ghi nhận cho từng nhân viên. */
export const MANUAL_PAYROLL_RULE_CODES: ReadonlySet<string> = new Set([
  PayrollRuleCode.RESPONSIBILITY,
  PayrollRuleCode.SALES,
  PayrollRuleCode.HOT_BONUS,
  PayrollRuleCode.RULE_VIOLATION,
  PayrollRuleCode.CUSTOM,
]);

/** Mã hợp lệ theo nhóm: không có "thưởng mỗi lần đi muộn". */
export const BONUS_PAYROLL_RULE_CODES: ReadonlySet<string> = new Set([
  PayrollRuleCode.OVERTIME,
  PayrollRuleCode.RESPONSIBILITY,
  PayrollRuleCode.ATTENDANCE,
  PayrollRuleCode.PUNCTUALITY,
  PayrollRuleCode.SALES,
  PayrollRuleCode.NIGHT_SHIFT,
  PayrollRuleCode.HOT_BONUS,
  PayrollRuleCode.CUSTOM,
]);
export const FINE_PAYROLL_RULE_CODES: ReadonlySet<string> = new Set([
  PayrollRuleCode.LATE,
  PayrollRuleCode.EARLY,
  PayrollRuleCode.MISSED_PUNCH,
  PayrollRuleCode.ABSENT,
  PayrollRuleCode.RULE_VIOLATION,
  PayrollRuleCode.CUSTOM,
]);

/** rule_type của dòng cũ → mã v2 (cùng bảng với migration_payroll_rules_v2). */
export const legacyRuleCodeOf = (ruleType: string | null | undefined): string => {
  switch (ruleType) {
    case 'ATTENDANCE':
    case 'LATE':
    case 'EARLY':
    case 'ABSENT':
      return ruleType;
    case 'MISSING_CHECK':
      return PayrollRuleCode.MISSED_PUNCH;
    case 'KPI':
      return PayrollRuleCode.SALES;
    case 'DISCIPLINE':
      return PayrollRuleCode.RULE_VIOLATION;
    default:
      return PayrollRuleCode.CUSTOM;
  }
};

/**
 * Cách tính chung của mọi khoản v2. Hệ số nhân với lương giờ / ca của chính
 * nhân viên (với tăng ca là phần trả THÊM, giờ đó đã có trong lương công).
 */
export enum PayrollRuleCalcMode {
  COEF_PER_HOUR = 'COEF_PER_HOUR',
  COEF_PER_SHIFT = 'COEF_PER_SHIFT',
  AMOUNT_PER_HOUR = 'AMOUNT_PER_HOUR',
  AMOUNT_PER_SHIFT = 'AMOUNT_PER_SHIFT',
  MILESTONE_HOURS = 'MILESTONE_HOURS',
  MILESTONE_SHIFTS = 'MILESTONE_SHIFTS',
}

@Entity('store_payroll_rules')
export class StorePayrollRule extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({
    type: 'enum',
    enum: PayrollRuleCategory,
  })
  category: PayrollRuleCategory;

  @Column()
  name: string;

  @Column({ name: 'rule_type', nullable: true })
  ruleType: string; // e.g., 'ATTENDANCE', 'LATE', 'TET'

  @Column({
    type: 'enum',
    enum: PayrollCalcType,
    default: PayrollCalcType.AMOUNT,
    name: 'calc_type',
  })
  calcType: PayrollCalcType;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  value: number;

  @Column({ name: 'is_custom', default: false })
  isCustom: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'code', type: 'varchar', length: 32, nullable: true })
  code: string | null;

  @Column({ name: 'calc_mode', type: 'varchar', length: 24, nullable: true })
  calcMode: string | null;

  /** Mốc giờ / ca của MILESTONE_*. */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  threshold: number | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;
}
