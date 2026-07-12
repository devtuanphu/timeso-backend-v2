import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';

@Entity('monthly_payrolls')
@Unique(['storeId', 'month'])
export class MonthlyPayroll extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({ type: 'date' })
  month: Date; // Tháng lương (VD: 2024-01-01 cho tháng 1/2024)

  @Column({
    name: 'estimated_payment',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  estimatedPayment: number; // Dự kiến cần chi trả

  @Column({
    name: 'salary_fund',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  salaryFund: number; // Quỹ lương

  @Column({
    name: 'total_bonus',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  totalBonus: number; // Tổng thưởng

  @Column({
    name: 'total_penalty',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  totalPenalty: number; // Tổng phạt

  @Column({
    name: 'total_overtime',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  totalOvertime: number; // Tăng ca

  @Column({
    name: 'total_pending_approval',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  totalPendingApproval: number; // Tổng số lương cần duyệt

  @Column({
    name: 'total_approved',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  totalApproved: number; // Tổng số lương đã duyệt

  @Column({ name: 'is_finalized', default: false })
  isFinalized: boolean; // Đã chốt sổ hay chưa

  @Column({ type: 'text', nullable: true })
  notes: string; // Ghi chú
}
