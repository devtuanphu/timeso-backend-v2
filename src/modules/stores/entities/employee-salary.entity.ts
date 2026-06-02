import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { EmployeeProfile } from './employee-profile.entity';
import { MonthlyPayroll } from './monthly-payroll.entity';

export enum PaymentStatus {
  PENDING = 'Chờ duyệt',
  APPROVED = 'Đã duyệt',
  PAID = 'Đã thanh toán',
  REJECTED = 'Từ chối',
}

@Entity('employee_salaries')
export class EmployeeSalary extends BaseEntity {
  @Column({ name: 'employee_profile_id' })
  employeeProfileId: string;

  @ManyToOne(() => EmployeeProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_profile_id' })
  employeeProfile: EmployeeProfile;

  @Column({ name: 'monthly_payroll_id', nullable: true })
  monthlyPayrollId: string;

  @ManyToOne(() => MonthlyPayroll, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'monthly_payroll_id' })
  monthlyPayroll: MonthlyPayroll;

  @Column({ type: 'date' })
  month: Date; // Tháng lương (VD: 2024-01-01)

  // Lương cơ bản theo hợp đồng
  @Column({
    name: 'base_salary',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  baseSalary: number;

  @Column({ name: 'payment_type', nullable: true })
  paymentType: string; // Hình thức trả lương (từ contract)

  // Lương sinh ra từ ca làm việc (không bao gồm phụ cấp/thưởng)
  @Column({
    name: 'earned_base_salary',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  earnedBaseSalary: number;

  // Phụ cấp
  @Column({ type: 'jsonb', nullable: true })
  allowances: Record<string, number>; // { "Tiền ăn": 500000, "Xăng xe": 300000 }

  // Thưởng & Phạt
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  bonus: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  penalty: number;

  // Công & Giờ làm việc
  @Column({
    name: 'working_days',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0,
  })
  workingDays: number; // Ngày công

  @Column({
    name: 'working_hours',
    type: 'decimal',
    precision: 6,
    scale: 2,
    default: 0,
  })
  workingHours: number; // Giờ làm việc

  @Column({
    name: 'unauthorized_leave_days',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0,
  })
  unauthorizedLeaveDays: number; // Nghỉ không phép

  // Ứng lương & Khấu trừ
  @Column({
    name: 'advance_payment',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  advancePayment: number; // Ứng lương

  @Column({
    name: 'other_deductions',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  otherDeductions: number; // Khấu trừ khác

  // Tổng kết
  @Column({
    name: 'total_income',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  totalIncome: number; // Tổng thu nhập = baseSalary + allowances + bonus

  @Column({
    name: 'total_deductions',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  totalDeductions: number; // Tổng khấu trừ = penalty + advancePayment + otherDeductions

  @Column({
    name: 'net_salary',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  netSalary: number; // Thực lãnh = totalIncome - totalDeductions

  // Trạng thái
  @Column({
    name: 'payment_status',
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  paymentStatus: PaymentStatus;

  @Column({ name: 'approved_by', nullable: true })
  approvedBy: string; // ID người duyệt

  @Column({ name: 'approved_at', nullable: true })
  approvedAt: Date;

  @Column({ name: 'paid_at', nullable: true })
  paidAt: Date;

  @Column({ type: 'text', nullable: true })
  notes: string;
}
