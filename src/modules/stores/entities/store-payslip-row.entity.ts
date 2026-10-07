import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';

/** Built-in payslip rows the owner may rename or remove. */
export enum PayslipBuiltinRow {
  ALLOWANCE = 'ALLOWANCE', // Phụ cấp (from the contract)
  BONUS = 'BONUS', // Thưởng (bonus rules)
  DEDUCTION = 'DEDUCTION', // Khấu trừ (fine rules + other deductions)
}

export enum PayslipRowSign {
  PLUS = 'PLUS',
  MINUS = 'MINUS',
}

/**
 * One row of the store's payslip template ("Thiết lập tính lương"), shown on
 * every employee's payslip:
 * - `builtinKey` set: the owner's label for that built-in row, or its removal
 *   (`isActive = false`: the row and its amount leave the payslip);
 * - `builtinKey` null: an extra line of `amount`, added to the income (PLUS)
 *   or taken from the net pay (MINUS).
 * Rows 1–3, Ứng lương, Tổng thu nhập and Thực lãnh are fixed and never stored.
 */
@Entity('store_payslip_rows')
@Index('ix_store_payslip_rows_store', ['storeId'])
// One stored row per built-in row of a store.
@Index('ux_store_payslip_rows_builtin', ['storeId', 'builtinKey'], {
  unique: true,
  where: '"builtin_key" IS NOT NULL',
})
export class StorePayslipRow extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({
    name: 'builtin_key',
    type: 'enum',
    enum: PayslipBuiltinRow,
    nullable: true,
  })
  builtinKey: PayslipBuiltinRow | null;

  @Column({ length: 80 })
  label: string;

  @Column({ type: 'enum', enum: PayslipRowSign, default: PayslipRowSign.PLUS })
  sign: PayslipRowSign;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  amount: number;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
