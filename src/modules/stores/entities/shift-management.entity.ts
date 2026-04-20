import { Entity, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';
import { WorkShift } from './work-shift.entity';
import { EmployeeProfile } from './employee-profile.entity';

// --- ENUMS ---

// Loại chu kỳ ca làm việc
export enum CycleType {
  DAILY = 'DAILY',           // Theo ngày
  WEEKLY = 'WEEKLY',         // Theo tuần
  MONTHLY = 'MONTHLY',       // Theo tháng
  INDEFINITE = 'INDEFINITE', // Vô thời hạn
}

// Trạng thái chu kỳ
export enum WorkCycleStatus {
  DRAFT = 'DRAFT',       // Nháp
  ACTIVE = 'ACTIVE',     // Đang hoạt động
  STOPPED = 'STOPPED',   // Đã dừng thủ công
  EXPIRED = 'EXPIRED',   // Đã hết hạn tự nhiên
}

export enum ShiftAssignmentStatus {
  PENDING = 'PENDING',       // Employee registered, waiting for owner approval
  APPROVED = 'APPROVED',     // Approved by owner or auto-approved (owner assign), ready for check-in
  CONFIRMED = 'CONFIRMED',   // Checked in
  COMPLETED = 'COMPLETED',   // Checked out
  CANCELLED = 'CANCELLED',   // Rejected or cancelled
}

export enum ShiftSwapStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum AttendanceStatus {
  ON_TIME = 'ON_TIME',
  LATE = 'LATE',
  EARLY = 'EARLY',
  LATE_AND_EARLY = 'LATE_AND_EARLY',
  ABSENT = 'ABSENT',
  FORGOT_CHECKOUT = 'FORGOT_CHECKOUT',
}

// Ngày trong tuần (cho lịch mẫu)
export enum WeekDaySchedule {
  MONDAY = 'MONDAY',
  TUESDAY = 'TUESDAY',
  WEDNESDAY = 'WEDNESDAY',
  THURSDAY = 'THURSDAY',
  FRIDAY = 'FRIDAY',
  SATURDAY = 'SATURDAY',
  SUNDAY = 'SUNDAY',
}

// --- ENTITIES ---

@Entity('work_cycles')
export class WorkCycle extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column()
  name: string;

  @Column({
    name: 'cycle_type',
    type: 'enum',
    enum: CycleType,
  })
  cycleType: CycleType;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: string | null; // null cho INDEFINITE

  @Column({ name: 'registration_deadline', type: 'timestamp', nullable: true })
  registrationDeadline: Date;

  @Column({
    type: 'enum',
    enum: WorkCycleStatus,
    default: WorkCycleStatus.DRAFT,
  })
  status: WorkCycleStatus;

  @Column({ name: 'stopped_at', type: 'timestamp', nullable: true })
  stoppedAt: Date | null;

  @Column({ name: 'scheduled_stop_at', type: 'timestamp', nullable: true })
  scheduledStopAt: Date | null;

  @OneToMany(() => ShiftSlot, (slot) => slot.cycle)
  slots: ShiftSlot[];

  @OneToMany(() => CycleShiftTemplate, (template) => template.cycle)
  templates: CycleShiftTemplate[];
}

// Lịch mẫu cho chu kỳ Vô thời hạn
@Entity('cycle_shift_templates')
export class CycleShiftTemplate extends BaseEntity {
  @Column({ name: 'cycle_id' })
  cycleId: string;

  @ManyToOne(() => WorkCycle, (cycle) => cycle.templates, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cycle_id' })
  cycle: WorkCycle;

  @Column({ name: 'work_shift_id' })
  workShiftId: string;

  @ManyToOne(() => WorkShift, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'work_shift_id' })
  workShift: WorkShift;

  @Column({
    name: 'day_of_week',
    type: 'enum',
    enum: WeekDaySchedule,
  })
  dayOfWeek: WeekDaySchedule;

  @Column({ name: 'max_staff', type: 'int', default: 1 })
  maxStaff: number;
}

@Entity('shift_slots')
export class ShiftSlot extends BaseEntity {
  @Column({ name: 'cycle_id' })
  cycleId: string;

  @ManyToOne(() => WorkCycle, (cycle) => cycle.slots, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'cycle_id' })
    cycle: WorkCycle;

    @Column({ name: 'work_shift_id' })
    workShiftId: string;

    @ManyToOne(() => WorkShift, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'work_shift_id' })
    workShift: WorkShift;

    @Column({ name: 'work_date', type: 'date' })
    workDate: string;

    @Column({ name: 'start_time', type: 'time', nullable: true })
    startTime?: string;

    @Column({ name: 'end_time', type: 'time', nullable: true })
    endTime?: string;

    @Column({ name: 'max_staff', type: 'int', default: 1 })
    maxStaff: number;

    @Column({ type: 'text', nullable: true })
    note?: string;

    @OneToMany(() => ShiftAssignment, (assignment) => assignment.shiftSlot)
    assignments: ShiftAssignment[];
}

@Entity('shift_assignments')
export class ShiftAssignment extends BaseEntity {
    @Column({ name: 'shift_slot_id' })
    shiftSlotId: string;

    @ManyToOne(() => ShiftSlot, (slot) => slot.assignments, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'shift_slot_id' })
    shiftSlot: ShiftSlot;

    @Column({ name: 'employee_id' })
    employeeId: string;

    @ManyToOne(() => EmployeeProfile, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'employee_id' })
    employee: EmployeeProfile;

    @Column({
        type: 'enum',
        enum: ShiftAssignmentStatus,
        default: ShiftAssignmentStatus.PENDING,
    })
    status: ShiftAssignmentStatus;

    @Column({ name: 'check_in_time', type: 'timestamp', nullable: true })
    checkInTime: Date;

    @Column({ name: 'check_out_time', type: 'timestamp', nullable: true })
    checkOutTime: Date;

    @Column({ type: 'text', nullable: true })
    note?: string;

    @Column({ name: 'worked_minutes', type: 'int', default: 0 })
    workedMinutes: number;

    @Column({ name: 'late_minutes', type: 'int', default: 0 })
    lateMinutes: number;

    @Column({ name: 'early_minutes', type: 'int', default: 0 })
    earlyMinutes: number;

    @Column({
      name: 'attendance_status',
      type: 'enum',
      enum: AttendanceStatus,
      nullable: true,
    })
    attendanceStatus: AttendanceStatus;

    @Column({ name: 'check_in_face_url', nullable: true })
    checkInFaceUrl: string;

    @Column({ name: 'check_out_face_url', nullable: true })
    checkOutFaceUrl: string;

    @Column({
      name: 'shift_earnings',
      type: 'decimal',
      precision: 12,
      scale: 2,
      nullable: true,
      comment: 'Calculated earnings for this shift based on contract type',
    })
    shiftEarnings: number;
}

@Entity('shift_swaps')
export class ShiftSwap extends BaseEntity {
    @Column({ name: 'from_assignment_id' })
    fromAssignmentId: string;

    @ManyToOne(() => ShiftAssignment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'from_assignment_id' })
  fromAssignment: ShiftAssignment;

  @Column({ name: 'to_employee_id', nullable: true })
  toEmployeeId: string;

  @ManyToOne(() => EmployeeProfile)
  @JoinColumn({ name: 'to_employee_id' })
  toEmployee: EmployeeProfile;

  @Column({ name: 'requested_by_employee_id' })
  requestedByEmployeeId: string;

  @ManyToOne(() => EmployeeProfile)
  @JoinColumn({ name: 'requested_by_employee_id' })
  requestedByEmployee: EmployeeProfile;

  @Column({
    type: 'enum',
    enum: ShiftSwapStatus,
    default: ShiftSwapStatus.PENDING,
  })
  status: ShiftSwapStatus;

  @Column({ type: 'text', nullable: true })
  note?: string;
}
