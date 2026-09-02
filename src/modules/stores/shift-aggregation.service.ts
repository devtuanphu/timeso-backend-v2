import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ShiftSlot,
  ShiftAssignment,
  ShiftAssignmentStatus,
  AttendanceStatus,
  WorkCycle,
  WorkCycleStatus,
} from './entities/shift-management.entity';
import { WorkShift } from './entities/work-shift.entity';
import {
  EmployeeProfile,
  EmploymentStatus,
} from './entities/employee-profile.entity';
import { EmployeeLeaveRequest } from './entities/employee-leave-request.entity';
import { PaymentType } from './entities/employee-contract.entity';
import {
  StorePayrollRule,
  PayrollRuleCategory,
  PayrollCalcType,
} from './entities/store-payroll-rule.entity';
import { Store } from './entities/store.entity';
import { AttendanceLog, AttendanceLogType } from './entities/attendance-log.entity';
import { ShiftChangeRequest, ShiftChangeRequestStatus } from './entities/shift-change-request.entity';


// ── Helper Maps ────────────────────────────────────────────────────────────────

const DAY_FULL_VI: Record<string, string> = {
  MONDAY: 'Thứ 2',
  TUESDAY: 'Thứ 3',
  WEDNESDAY: 'Thứ 4',
  THURSDAY: 'Thứ 5',
  FRIDAY: 'Thứ 6',
  SATURDAY: 'Thứ 7',
  SUNDAY: 'Chủ Nhật',
};

const DAY_SHORT_VI: Record<string, string> = {
  MONDAY: 'T2',
  TUESDAY: 'T3',
  WEDNESDAY: 'T4',
  THURSDAY: 'T5',
  FRIDAY: 'T6',
  SATURDAY: 'T7',
  SUNDAY: 'CN',
};

// ── Enums ────────────────────────────────────────────────────────────────────

export enum StaffingStatus {
  SUFFICIENT = 'sufficient',
  INSUFFICIENT = 'insufficient',
  SERIOUS = 'serious',
}

export enum ShiftStatus {
  PENDING = 'pending',
  ONGOING = 'ongoing',
  FINISHED = 'finished',
  CANCELLED = 'cancelled',
}

const MAX_SHIFT_FILTER_CANDIDATES = 5000;
const MAX_SUGGESTION_CANDIDATES = 5000;
const MAX_SUGGESTION_SLOTS = 200;
const MAX_SCORED_SUGGESTION_CANDIDATES = 100;

// ── Response DTOs ─────────────────────────────────────────────────────────────

export interface ShiftSlotResponse {
  id: string;
  workDate: string;
  dayOfWeek: string;
  dayOfWeekVi: string;
  startTime: string;
  endTime: string;
  shiftName: string;
  shiftType: string;
  colorCode: string | null;
  maxStaff: number | null;
  requiredCount: number | null;
  assignedCount: number;
  insufficientCount: number;
  insufficientRatio: number;
  staffingStatus: StaffingStatus;
  totalSalary: number;
  location: string | null;
  note: string | null;
  status: ShiftStatus;
  employees: ShiftSlotEmployee[];
  cycleId: string;
}

export interface ShiftSlotEmployee {
  id: string;
  name: string;
  avatar: string | null;
  role: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  status: 'on_time' | 'late' | 'absent' | 'on_break' | null;
  lateMinutes: number | null;
  earlyMinutes: number | null;
  workedMinutes: number | null;
  salary: number | null;
  assignmentId: string;
  /** Original registration state, kept separate from attendance status. */
  assignmentStatus?: ShiftAssignmentStatus;
}

export interface ShiftSummaryResponse {
  totalSalary: number;
  salaryChange: number;
  totalEmployees: number;
  totalRequiredEmployees: number | null;
  employeeChange: number;
  totalHours: number;
  hoursChange: number;
  totalShifts: number;
  totalLeaveEmployees: number;
}

export interface MonthSummaryResponse {
  sufficientShifts: number;
  insufficientShifts: number;
  insufficientDetail: {
    types: string[];
    weekdays: string[];
  };
  seriousInsufficientShifts: number;
  seriousInsufficientDetail: {
    types: string[];
    weekdays: string[];
  };
  totalSalary: number;
  totalHours: number;
}

export interface ShiftSuggestion {
  shiftSlotId: string;
  dayLabel: string;
  shiftType: string;
  employee: {
    id: string;
    name: string;
    code: string;
  };
  matchPercent: number;
  reason: string;
  reasonSub: string | null;
}

export interface EmployeeScheduleDay {
  date: string;
  dateNumber: number;
  dayName: string;
  isToday: boolean;
  shifts: {
    id: string;
    type: string;
    shiftName: string;
    startTime: string;
    endTime: string;
    hours: number | null;
    salary: number;
    status: string;
    location: string | null;
  }[];
}

export interface EmployeeScheduleGridResponse {
  employee: {
    id: string;
    name: string;
    code: string;
    position: string;
    employmentType: string;
    avatar: string | null;
  };
  schedule: EmployeeScheduleDay[];
  summary: {
    totalHoursPerWeek: number;
    daysPerWeek: number;
    salaryPerWeek: number;
  };
}

export interface ShiftDetailResponse extends ShiftSlotResponse {
  shiftName: string;
  date: string;
  dayOfWeekVi: string;
  cycleName: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  todos?: {
    id: string;
    type: string;
    title: string;
    count: number;
    role: string;
  }[];
  aiSuggestions?: {
    id: string;
    dayLabel: string;
    shiftType: string;
    employeeName: string;
    employeeCode: string;
    employeeAvatar: string;
    matchPercent: number;
    reason: string;
    reasonSub?: string | null;
  }[];
  estimatedTotalSalary?: number;
  salaryChangePercent?: number;
  estimatedTotalHours?: number;
  hoursChangePercent?: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class ShiftAggregationService {
  constructor(
    @InjectRepository(ShiftSlot)
    private readonly shiftSlotRepo: Repository<ShiftSlot>,
    @InjectRepository(ShiftAssignment)
    private readonly shiftAssignmentRepo: Repository<ShiftAssignment>,
    @InjectRepository(WorkShift)
    private readonly workShiftRepo: Repository<WorkShift>,
    @InjectRepository(WorkCycle)
    private readonly workCycleRepo: Repository<WorkCycle>,
    @InjectRepository(EmployeeProfile)
    private readonly employeeProfileRepo: Repository<EmployeeProfile>,
    @InjectRepository(EmployeeLeaveRequest)
    private readonly leaveRequestRepo: Repository<EmployeeLeaveRequest>,
    @InjectRepository(Store)
    private readonly storeRepo: Repository<Store>,
    @InjectRepository(AttendanceLog)
    private readonly attendanceLogRepo: Repository<AttendanceLog>,
    @InjectRepository(ShiftChangeRequest)
    private readonly shiftChangeRequestRepo: Repository<ShiftChangeRequest>,
    @InjectRepository(StorePayrollRule)
    private readonly payrollRuleRepo: Repository<StorePayrollRule>,
  ) { }

  // ── 1. List Shift Slots ────────────────────────────────────────────────────

  async getShiftSlots(params: {
    storeId: string;
    ownerAccountId: string;
    from?: string;
    to?: string;
    type?: string;
    staffingStatus?: StaffingStatus;
    page?: number;
    limit?: number;
  }): Promise<{
  data: ShiftSlotResponse[];
    meta: { total: number; page: number; limit: number; truncated: boolean; hasMore: boolean };
  }> {
    const {
      storeId,
      from,
      to,
      type,
      staffingStatus,
      page = 1,
      limit = 50,
    } = params;

    await this.assertOwnerStoreAccess(storeId, params.ownerAccountId);
    this.validateDateRange(from, to);
    if ((from && !to) || (!from && to)) {
      throw new BadRequestException('Cần cung cấp cả ngày bắt đầu và ngày kết thúc');
    }
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new BadRequestException('Phân trang không hợp lệ');
    }
    if (staffingStatus && !Object.values(StaffingStatus).includes(staffingStatus)) {
      throw new BadRequestException('Trạng thái nhân sự không hợp lệ');
    }
    if (type && !['morning', 'noon', 'evening'].includes(type)) {
      throw new BadRequestException('Loại ca không hợp lệ');
    }

    const qb = this.shiftSlotRepo
      .createQueryBuilder('slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .leftJoinAndSelect('slot.assignments', 'sa')
      .leftJoinAndSelect('sa.employee', 'emp')
      .leftJoinAndSelect('emp.contracts', 'contract', 'contract.isActive = true')
      .leftJoinAndSelect('emp.account', 'account')
      .leftJoinAndSelect('emp.storeRole', 'role')
      .leftJoin('slot.cycle', 'cycle')
      .where('cycle.storeId = :storeId', { storeId })
      // Exclude slots from manually-stopped or draft cycles. When a new cycle
      // is created the previous one is STOPPED, but its slots remain in the DB —
      // including them here caused duplicate shifts (2 ca sáng / trưa / tối).
      .andWhere('cycle.status IN (:...cycleStatuses)', {
        cycleStatuses: [WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED],
      });

    if (from) qb.andWhere('slot.workDate >= :from', { from });
    if (to) qb.andWhere('slot.workDate <= :to', { to });

    const rules = await this.loadActivePayrollRules(storeId);
    // Derived staffing/type filters require hydrated slot data. Bound the
    // hydration workload and reject larger ranges instead of silently omitting
    // slots after an arbitrary cap.
    const batchQb = qb
      .orderBy('slot.workDate', 'ASC')
      .addOrderBy('ws.startTime', 'ASC')
      .addOrderBy('slot.id', 'ASC');
    const rawSlots = await batchQb.take(MAX_SHIFT_FILTER_CANDIDATES).getMany();
    if (rawSlots.length === MAX_SHIFT_FILTER_CANDIDATES) {
      // Derived filters currently require hydrated entities. Refuse a larger
      // workload instead of silently dropping slots after an arbitrary cap.
      const probe = await qb
        .skip(MAX_SHIFT_FILTER_CANDIDATES)
        .take(1)
        .getMany();
      if (probe.length > 0) {
        throw new BadRequestException(
          `Khoảng thời gian có quá nhiều ca (tối đa ${MAX_SHIFT_FILTER_CANDIDATES}). Vui lòng thu hẹp khoảng ngày`,
        );
      }
    }
    const slots = rawSlots
      .map((slot) => this.mapSlotToResponse(slot, rules))
      .filter((s) => !staffingStatus || s.staffingStatus === staffingStatus)
      .filter((s) => !type || s.shiftType === type);

    const total = slots.length;
    const paged = slots.slice((page - 1) * limit, page * limit);

    return {
      data: paged,
      meta: { total, page, limit, truncated: false, hasMore: page * limit < total },
    };
  }

  // ── 2. Chi tiết 1 ca ──────────────────────────────────────────────────────

  async getShiftDetail(params: {
    storeId: string;
    shiftSlotId: string;
    ownerAccountId: string;
  }): Promise<ShiftDetailResponse | null> {
    const { storeId, shiftSlotId } = params;
    await this.assertOwnerStoreAccess(storeId, params.ownerAccountId);

    const slot = await this.shiftSlotRepo
      .createQueryBuilder('slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .leftJoinAndSelect('slot.assignments', 'sa')
      .leftJoinAndSelect('sa.employee', 'emp')
      .leftJoinAndSelect('emp.contracts', 'contract', 'contract.isActive = true')
      .leftJoinAndSelect('emp.account', 'account')
      .leftJoinAndSelect('emp.storeRole', 'role')
      .leftJoin('slot.cycle', 'cycle')
      .where('cycle.storeId = :storeId', { storeId })
      .andWhere('cycle.status IN (:...cycleStatuses)', {
        cycleStatuses: [WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED],
      })
      .andWhere('slot.id = :shiftSlotId', { shiftSlotId })
      .getOne();

    if (!slot) return null;

    const rules = await this.loadActivePayrollRules(storeId);
    const response = this.mapSlotToResponse(slot, rules) as ShiftDetailResponse;
    response.shiftName = slot.workShift?.shiftName || 'Ca làm việc';
    response.date = this.formatDateVn(slot.workDate);
    response.dayOfWeekVi =
      DAY_FULL_VI[slot.dayOfWeek || ''] || slot.dayOfWeek || '';
    response.cycleName = (slot as any).cycle?.name || null;
    response.createdAt = slot.createdAt?.toISOString();
    response.updatedAt = slot.updatedAt?.toISOString();

    const yesterday = new Date(new Date(slot.workDate).getTime() - 86400000).toISOString().split('T')[0];
    const [currentDaySummary, prevDaySummary] = await Promise.all([
      this.calcSummary(storeId, slot.workDate, slot.workDate),
      this.calcSummary(storeId, yesterday, yesterday),
    ]);

    response.estimatedTotalSalary = response.totalSalary;
    response.salaryChangePercent = prevDaySummary.totalSalary > 0 
      ? Math.round(((currentDaySummary.totalSalary - prevDaySummary.totalSalary) / prevDaySummary.totalSalary) * 100)
      : 0;
    
    const startTimeStr = slot.startTime || slot.workShift?.startTime || '00:00:00';
    const endTimeStr = slot.endTime || slot.workShift?.endTime || '00:00:00';
    let startMs = new Date(`1970-01-01T${startTimeStr}Z`).getTime();
    let endMs = new Date(`1970-01-01T${endTimeStr}Z`).getTime();
    if (endMs < startMs) endMs += 24 * 60 * 60 * 1000;
    const durationHours = (endMs - startMs) / 3600000;
    const activeAssignments = (slot.assignments || []).filter(
      (a) => a.status !== ShiftAssignmentStatus.CANCELLED,
    );

    response.estimatedTotalHours = Math.round(durationHours * activeAssignments.length * 10) / 10;
    response.hoursChangePercent = prevDaySummary.totalHours > 0
      ? Math.round(((currentDaySummary.totalHours - prevDaySummary.totalHours) / prevDaySummary.totalHours) * 100)
      : 0;

    const daySlots = await this.getShiftSlots({ storeId, ownerAccountId: params.ownerAccountId, from: slot.workDate, to: slot.workDate, limit: 100 });
    
    response.todos = daySlots.data
      .filter((s) => s.insufficientCount > 0)
      .map((s) => ({
        id: s.id,
        type: this.inferShiftType(s.shiftName || '', s.startTime || ''),
        title: `Bổ sung ${s.shiftName.toLowerCase()} ${s.startTime} - ${s.endTime}`,
        count: s.insufficientCount,
        role: 'nhân viên',
      }));

    const aiSugRaw = await this.getShiftSuggestions({ storeId, ownerAccountId: params.ownerAccountId, from: slot.workDate, to: slot.workDate, limit: 5 });
    response.aiSuggestions = aiSugRaw.map((s) => {
      const relatedSlot = daySlots.data.find(d => d.id === s.shiftSlotId);
      const timeRange = relatedSlot ? `${relatedSlot.startTime} - ${relatedSlot.endTime}` : '';
      const shiftTitle = relatedSlot?.shiftName || (s.shiftType === 'morning' ? 'Ca sáng' : s.shiftType === 'noon' ? 'Ca trưa' : 'Ca tối');
      
      return {
        id: `${s.shiftSlotId}-${s.employee.id}`,
        dayLabel: s.dayLabel,
        shiftType: s.shiftType,
        employeeName: s.employee.name,
        employeeCode: s.employee.code,
        employeeAvatar: '',
        matchPercent: s.matchPercent,
        reason: s.reason,
        reasonSub: s.reasonSub,
      };
    });

    return response;
  }

  // ── 3. Stats Summary ──────────────────────────────────────────────────────

  async getShiftSummary(params: {
    storeId: string;
    from: string;
    to: string;
    ownerAccountId: string;
  }): Promise<ShiftSummaryResponse> {
    const { storeId, from, to } = params;
    await this.assertOwnerStoreAccess(storeId, params.ownerAccountId);
    this.requireDateRange(from, to);
    const prevPeriod = this.getPreviousPeriod(from, to);

    const [current, prev] = await Promise.all([
      this.calcSummary(storeId, from, to),
      this.calcSummary(storeId, prevPeriod.from, prevPeriod.to),
    ]);

    const salaryChange =
      prev.totalSalary > 0
        ? Math.round(
          ((current.totalSalary - prev.totalSalary) / prev.totalSalary) *
          1000,
        ) / 10
        : 0;
    const employeeChange =
      prev.totalEmployees > 0
        ? Math.round(
          ((current.totalEmployees - prev.totalEmployees) /
            prev.totalEmployees) *
          1000,
        ) / 10
        : 0;
    const hoursChange =
      prev.totalHours > 0
        ? Math.round(
          ((current.totalHours - prev.totalHours) / prev.totalHours) * 1000,
        ) / 10
        : 0;

    return {
      totalSalary: current.totalSalary,
      salaryChange,
      totalEmployees: current.totalEmployees,
      totalRequiredEmployees: current.totalRequiredEmployees,
      employeeChange,
      totalHours: Math.round(current.totalHours * 10) / 10,
      hoursChange,
      totalShifts: current.totalShifts,
      totalLeaveEmployees: current.totalLeaveEmployees,
    };
  }

  // ── 4. Month Summary ─────────────────────────────────────────────────────

  async getMonthSummary(params: {
    storeId: string;
    year: number;
    month: number;
    ownerAccountId: string;
  }): Promise<MonthSummaryResponse> {
    const { storeId, year, month } = params;
    await this.assertOwnerStoreAccess(storeId, params.ownerAccountId);
    if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('Năm hoặc tháng không hợp lệ');
    }
    const lastDay = new Date(year, month, 0).getDate();
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const slots = await this.shiftSlotRepo
      .createQueryBuilder('slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .leftJoinAndSelect('slot.assignments', 'sa')
      .leftJoinAndSelect('sa.employee', 'emp')
      .leftJoinAndSelect('emp.contracts', 'contract', 'contract.isActive = true')
      .leftJoin('slot.cycle', 'cycle')
      .where('cycle.storeId = :storeId', { storeId })
      .andWhere('cycle.status IN (:...cycleStatuses)', {
        cycleStatuses: [WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED],
      })
      .andWhere('slot.workDate >= :from', { from })
      .andWhere('slot.workDate <= :to', { to })
      .getMany();

    let sufficientShifts = 0;
    let insufficientShifts = 0;
    let seriousInsufficientShifts = 0;
    const insufficientTypes = new Set<string>();
    const insufficientWeekdays = new Set<string>();
    const seriousTypes = new Set<string>();
    const seriousWeekdays = new Set<string>();
    let totalSalary = 0;
    let totalMinutes = 0;

    for (const slot of slots) {
      const required = slot.maxStaff ?? slot.workShift?.defaultMaxStaff ?? 0;
      const activeAssignments = (slot.assignments || []).filter(
        (a) => a.status !== ShiftAssignmentStatus.CANCELLED,
      );
      const assigned = activeAssignments.length;
      const insufficientCount = Math.max(0, required - assigned);
      const ratio = required > 0 ? insufficientCount / required : 0;
      const shiftType = this.inferShiftType(
        slot.workShift?.shiftName || '',
        slot.workShift?.startTime || '',
      );

      totalSalary += activeAssignments.reduce(
        (sum, a) => sum + this.estimateAssignmentSalary(a, slot),
        0,
      );
      totalMinutes += activeAssignments.reduce(
        (sum, a) => sum + this.assignmentHours(a, slot) * 60,
        0,
      );

      if (insufficientCount === 0) {
        sufficientShifts++;
      } else if (ratio >= 0.5) {
        seriousInsufficientShifts++;
        seriousTypes.add(shiftType);
        if (slot.dayOfWeek) seriousWeekdays.add(slot.dayOfWeek);
      } else {
        insufficientShifts++;
        insufficientTypes.add(shiftType);
        if (slot.dayOfWeek) insufficientWeekdays.add(slot.dayOfWeek);
      }
    }

    return {
      sufficientShifts,
      insufficientShifts,
      insufficientDetail: {
        types: Array.from(insufficientTypes),
        weekdays: Array.from(insufficientWeekdays).map(
          (d) => DAY_SHORT_VI[d] || d,
        ),
      },
      seriousInsufficientShifts,
      seriousInsufficientDetail: {
        types: Array.from(seriousTypes),
        weekdays: Array.from(seriousWeekdays).map((d) => DAY_SHORT_VI[d] || d),
      },
      totalSalary,
      totalHours: Math.round(totalMinutes / 60),
    };
  }

  // ── 5. Gợi ý nhân viên ──────────────────────────────────────────────────

  async getShiftSuggestions(params: {
    storeId: string;
    from: string;
    to: string;
    ownerAccountId: string;
    limit?: number;
  }): Promise<ShiftSuggestion[]> {
    const { storeId, from, to, limit = 3 } = params;
    await this.assertOwnerStoreAccess(storeId, params.ownerAccountId);
    this.requireDateRange(from, to);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new BadRequestException('Giới hạn gợi ý không hợp lệ');
    }

    // Lấy các slot thiếu nhân viên
    const insufficientRaw = await this.shiftSlotRepo
      .createQueryBuilder('slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .leftJoin(
        'slot.assignments',
        'sa',
        'sa.status != :cancelledAssignmentStatus',
        { cancelledAssignmentStatus: ShiftAssignmentStatus.CANCELLED },
      )
      .leftJoin('slot.cycle', 'cycle')
      .where('cycle.storeId = :storeId', { storeId })
      .andWhere('cycle.status IN (:...cycleStatuses)', {
        cycleStatuses: [WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED],
      })
      .andWhere('slot.workDate >= :from', { from })
      .andWhere('slot.workDate <= :to', { to })
      .andWhere(
        'COALESCE(slot.maxStaff, ws.defaultMaxStaff) IS NOT NULL',
      )
      .groupBy('slot.id')
      .addGroupBy('ws.id')
      .select([
        'slot.id as id',
        'slot.workDate as workDate',
        'slot.dayOfWeek as dayOfWeek',
        'COALESCE(slot.maxStaff, ws.defaultMaxStaff) as maxStaff',
        'slot.workShiftId as workShiftId',
        'slot.startTime as slotStartTime',
        'slot.endTime as slotEndTime',
        'ws.shiftName as ws_shiftName',
        'ws.startTime as ws_startTime',
        'COUNT(sa.id) as assignedCount',
      ])
      .having('COALESCE(slot.maxStaff, ws.defaultMaxStaff) > COUNT(sa.id)')
      .orderBy('slot.workDate', 'ASC')
      .addOrderBy('ws.startTime', 'ASC')
      .addOrderBy('slot.id', 'ASC')
      .limit(MAX_SUGGESTION_SLOTS + 1)
      .getRawMany();

    if (!insufficientRaw || insufficientRaw.length === 0) return [];
    if (insufficientRaw.length > MAX_SUGGESTION_SLOTS) {
      throw new BadRequestException(
        `Khoảng thời gian có quá nhiều ca thiếu người (tối đa ${MAX_SUGGESTION_SLOTS}). Vui lòng thu hẹp phạm vi`,
      );
    }

    // Lấy candidate employees
    const candidatesQb = this.employeeProfileRepo
      .createQueryBuilder('emp')
      .leftJoinAndSelect('emp.account', 'account')
      .leftJoinAndSelect('emp.storeRole', 'role')
      .where('emp.storeId = :storeId', { storeId })
      .andWhere('emp.employmentStatus = :status', {
        status: EmploymentStatus.ACTIVE,
      })
      .orderBy('emp.createdAt', 'ASC')
      .addOrderBy('emp.id', 'ASC')
      .take(MAX_SUGGESTION_CANDIDATES);
    const candidates = await candidatesQb.getMany();
    if (candidates.length === MAX_SUGGESTION_CANDIDATES) {
      const probe = await candidatesQb.skip(MAX_SUGGESTION_CANDIDATES).take(1).getMany();
      if (probe.length > 0) {
        throw new BadRequestException(
          `Cửa hàng có quá nhiều nhân viên để tạo gợi ý (tối đa ${MAX_SUGGESTION_CANDIDATES}). Vui lòng thu hẹp phạm vi`,
        );
      }
    }

    if (candidates.length === 0) return [];

    // Lấy employee đang nghỉ phép trong khoảng thời gian
    const onLeave = await this.leaveRequestRepo
      .createQueryBuilder('lr')
      .where('lr.storeId = :storeId', { storeId })
      .andWhere('lr.status = :approved', { approved: 'APPROVED' })
      .andWhere('lr.startDate <= :to', { to })
      .andWhere('lr.endDate >= :from', { from })
      .getMany();
    const onLeaveIds = new Set(onLeave.map((lr) => lr.employeeProfileId));

    // Lấy tất cả assignments trong khoảng để loại trừ employee đã được gán
    const existingAssignments = await this.shiftAssignmentRepo
      .createQueryBuilder('sa')
      .leftJoin('sa.shiftSlot', 'slot')
      .leftJoin('slot.cycle', 'cycle')
      .where('cycle.storeId = :storeId', { storeId })
      .andWhere('cycle.status IN (:...cycleStatuses)', {
        cycleStatuses: [WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED],
      })
      .andWhere('slot.workDate >= :from', { from })
      .andWhere('slot.workDate <= :to', { to })
      .andWhere('sa.status != :cancelled', {
        cancelled: ShiftAssignmentStatus.CANCELLED,
      })
      .select('sa.employeeId', 'employeeId')
      .addSelect('sa.shiftSlotId', 'shiftSlotId')
      .getRawMany();

    const suggestions: ShiftSuggestion[] = [];

    for (const raw of insufficientRaw) {
      const slotAssigned = new Set(
        existingAssignments
          .filter((a: any) => (a.shiftSlotId ?? a.sa_shiftSlotId) === raw.id)
          .map((a: any) => a.employeeId ?? a.sa_employeeId),
      );

      const eligible = candidates.filter(
        (c) => !slotAssigned.has(c.id) && !onLeaveIds.has(c.id),
      );
      if (eligible.length === 0) continue;
      // Candidate rows are ordered by createdAt/id above. Score only a stable
      // prefix so large stores cannot fan out unbounded DB work per slot while
      // still returning useful suggestions instead of rejecting the request.
      const scoredEligible = eligible.slice(0, MAX_SCORED_SUGGESTION_CANDIDATES);

      const shiftType = this.inferShiftType(
        raw.ws_shiftName || '',
        raw.ws_startTime || '',
      );
      const dayLabel = `${DAY_FULL_VI[raw.dayOfWeek || ''] || raw.dayOfWeek || ''}, ${this.formatDateVn(raw.workDate).slice(0, 5)}`;

      // Chấm điểm
      const scored = await this.scoreCandidates(
        scoredEligible,
        {
          id: raw.id,
          workDate: raw.workDate,
          dayOfWeek: raw.dayOfWeek,
          workShift: {
            shiftName: raw.ws_shiftName || '',
            startTime: raw.ws_startTime || '',
          },
          assignments: [],
        } as any,
        from,
        to,
      );

      for (const c of scored.slice(0, limit)) {
        suggestions.push({
          shiftSlotId: raw.id,
          dayLabel,
          shiftType,
          employee: {
            id: c.id,
            name: (c as any).account?.fullName || 'Nhân viên',
            code: c.id.slice(0, 8).toUpperCase(),
          },
          matchPercent: c.matchPercent,
          reason: c.reason,
          reasonSub: c.reasonSub,
        });
      }
    }

    return suggestions
      .sort((a, b) => b.matchPercent - a.matchPercent)
      .slice(0, limit * 3);
  }

  // ── 6. Lịch nhân viên grid ────────────────────────────────────────────────

  async getEmployeeScheduleGrid(params: {
    storeId: string;
    employeeId: string;
    from: string;
    to: string;
    ownerAccountId: string;
  }): Promise<EmployeeScheduleGridResponse | null> {
    const { storeId, employeeId, from, to } = params;
    await this.assertEmployeeCalendarAccess(storeId, employeeId, params.ownerAccountId);
    this.requireDateRange(from, to);

    const emp = await this.employeeProfileRepo
      .createQueryBuilder('emp')
      .leftJoinAndSelect('emp.account', 'account')
      .leftJoinAndSelect('emp.storeRole', 'role')
      .leftJoinAndSelect('emp.employeeType', 'empType')
      .where('emp.id = :employeeId', { employeeId })
      .andWhere('emp.storeId = :storeId', { storeId })
      .getOne();

    if (!emp) return null;

    const assignments = await this.shiftAssignmentRepo
      .createQueryBuilder('sa')
      .leftJoinAndSelect('sa.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .leftJoinAndSelect('sa.employee', 'saEmp')
      .leftJoinAndSelect('saEmp.contracts', 'contract', 'contract.isActive = true')
      .leftJoin('slot.cycle', 'cycle')
      .where('sa.employeeId = :employeeId', { employeeId })
      .andWhere('cycle.storeId = :storeId', { storeId })
      .andWhere('cycle.status IN (:...cycleStatuses)', {
        cycleStatuses: [WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED],
      })
      .andWhere('slot.workDate >= :from', { from })
      .andWhere('slot.workDate <= :to', { to })
      .andWhere('sa.status IN (:...statuses)', {
        statuses: [
          ShiftAssignmentStatus.APPROVED,
          ShiftAssignmentStatus.CONFIRMED,
          ShiftAssignmentStatus.COMPLETED,
        ],
      })
      .orderBy('slot.workDate', 'ASC')
      .getMany();

    const dateRange = this.getDateRange(from, to);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
    }).format(new Date());

    const schedule: EmployeeScheduleDay[] = dateRange.map((date) => {
      const dateStr = date.toISOString().split('T')[0];
      const dayAssignments = assignments.filter(
        (a) => a.shiftSlot?.workDate === dateStr,
      );
      const dayOfWeek = new Date(dateStr)
        .toLocaleDateString('en-US', { weekday: 'long' })
        .toUpperCase();

      return {
        date: dateStr,
        dateNumber: date.getDate(),
        dayName: DAY_SHORT_VI[dayOfWeek] || dayOfWeek,
        isToday: dateStr === today,
        shifts: dayAssignments.map((a) => ({
          id: a.shiftSlotId,
          type: this.inferShiftType(
            a.shiftSlot?.workShift?.shiftName || '',
            a.shiftSlot?.workShift?.startTime || '',
          ),
          shiftName: a.shiftSlot?.workShift?.shiftName || 'Ca làm',
          startTime:
            a.shiftSlot?.startTime || a.shiftSlot?.workShift?.startTime || '',
          endTime:
            a.shiftSlot?.endTime || a.shiftSlot?.workShift?.endTime || '',
          hours: this.assignmentHours(a),
          salary: this.estimateAssignmentSalary(a),
          status: a.status,
          location: a.shiftSlot?.location || null,
        })),
      };
    });

    const totalHours = assignments.reduce(
      (sum, a) => sum + this.assignmentHours(a),
      0,
    );
    const workingDays = new Set(assignments.map((a) => a.shiftSlot?.workDate))
      .size;
    const totalSalary = assignments.reduce(
      (sum, a) => sum + this.estimateAssignmentSalary(a),
      0,
    );

    return {
      employee: {
        id: emp.id,
        name: emp.account?.fullName || 'Nhân viên',
        code: emp.id.slice(0, 8).toUpperCase(),
        position: (emp as any).storeRole?.name || 'Nhân viên',
        employmentType: (emp as any).employeeType?.name || 'Nhân viên',
        avatar: emp.account?.avatar || null,
      },
      schedule,
      summary: {
        totalHoursPerWeek: Math.round(totalHours * 10) / 10,
        daysPerWeek: workingDays,
        salaryPerWeek: Math.round(totalSalary),
      },
    };
  }

  // ── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Số giờ theo lịch của 1 slot (không phải giờ thực làm).
   * Dùng cho ước tính lương HOUR và tổng-giờ-dự-kiến. Xử lý ca qua nửa đêm.
   */
  private slotDurationHours(slot?: ShiftSlot | null): number {
    if (!slot) return 0;
    const startTime = slot.startTime || slot.workShift?.startTime || '';
    const endTime = slot.endTime || slot.workShift?.endTime || '';
    if (!startTime || !endTime) return 0;
    let start = new Date(`1970-01-01T${startTime}Z`).getTime();
    let end = new Date(`1970-01-01T${endTime}Z`).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) return 0;
    if (end < start) end += 24 * 60 * 60 * 1000;
    return Math.round(((end - start) / 3600000) * 10) / 10;
  }

  /**
   * Số giờ của 1 assignment: đã làm → workedMinutes thực; chưa → thời lượng ca theo lịch.
   */
  private assignmentHours(a: ShiftAssignment, slot?: ShiftSlot | null): number {
    if (a.workedMinutes && a.workedMinutes > 0) {
      return Math.round((a.workedMinutes / 60) * 10) / 10;
    }
    return this.slotDurationHours(slot || a.shiftSlot);
  }

  /**
   * Lương 1 assignment theo quy tắc thống nhất:
   *  - Đã check-out (shiftEarnings != null) → lấy shiftEarnings thực đã lưu.
   *  - Chưa → ước tính từ hợp đồng active × thời lượng ca.
   * Công thức ước tính mirror checkOutWithFace (stores.service.ts) để số ước tính
   * trùng khớp với số thực nhận sau khi check-out, không bị nhảy giá trị.
   * MONTH dùng daysInMonth theo slot.workDate (không phải thời điểm hiện tại).
   */
  private estimateAssignmentSalary(
    a: ShiftAssignment,
    slot?: ShiftSlot | null,
  ): number {
    // Chỉ tính lương khi nhân viên đã đăng ký xong VÀ được duyệt.
    // PENDING (chờ owner duyệt) chưa được cộng vào lương dự kiến.
    if (
      a.status !== ShiftAssignmentStatus.APPROVED &&
      a.status !== ShiftAssignmentStatus.CONFIRMED &&
      a.status !== ShiftAssignmentStatus.COMPLETED
    ) {
      return 0;
    }

    if (a.shiftEarnings != null) return Number(a.shiftEarnings);

    const s = slot || a.shiftSlot;
    const contract = (a.employee as any)?.contracts?.find(
      (c: any) => c.isActive,
    );
    const base = Number(contract?.salaryAmount) || 0;
    if (!base) return 0;

    switch (contract.paymentType) {
      case PaymentType.HOUR:
        return Math.round(base * this.slotDurationHours(s));
      case PaymentType.SHIFT:
      case PaymentType.DAY:
        return Math.round(base);
      case PaymentType.WEEK:
        return Math.round(base / 6); // 6 ngày làm/tuần — khớp checkOutWithFace
      case PaymentType.MONTH: {
        const date = new Date(s?.workDate || '');
        const daysInMonth = Number.isNaN(date.getTime())
          ? 30
          : new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
        return Math.round(base / daysInMonth);
      }
      default:
        return 0;
    }
  }

  /** Load các rule thưởng/phạt đang active của cửa hàng (mảng rỗng nếu chưa cấu hình). */
  private async loadActivePayrollRules(
    storeId: string,
  ): Promise<StorePayrollRule[]> {
    return this.payrollRuleRepo.find({ where: { storeId, isActive: true } });
  }

  private async assertOwnerStoreAccess(storeId: string, ownerAccountId: string): Promise<void> {
    const store = await this.storeRepo.findOne({
      where: { id: storeId },
      select: ['id', 'ownerAccountId'],
    });
    if (!store) throw new NotFoundException('Cửa hàng không tồn tại');
    if (store.ownerAccountId !== ownerAccountId) {
      throw new ForbiddenException('Bạn không có quyền truy cập cửa hàng này');
    }
  }

  private async assertEmployeeCalendarAccess(storeId: string, employeeId: string, accountId: string): Promise<void> {
    const store = await this.storeRepo.findOne({ where: { id: storeId }, select: ['id', 'ownerAccountId'] });
    if (!store) throw new NotFoundException('Cửa hàng không tồn tại');
    if (store.ownerAccountId === accountId) return;
    const profile = await this.employeeProfileRepo.findOne({
      where: { id: employeeId, storeId, accountId, employmentStatus: EmploymentStatus.ACTIVE },
      select: ['id'],
    });
    if (!profile) throw new ForbiddenException('Bạn chỉ có thể xem lịch của chính mình');
  }

  private validateDateRange(from?: string, to?: string): void {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    if (from && !dateOnly.test(from)) throw new BadRequestException('Ngày bắt đầu không hợp lệ');
    if (to && !dateOnly.test(to)) throw new BadRequestException('Ngày kết thúc không hợp lệ');
    if (from && to && from > to) throw new BadRequestException('Khoảng ngày không hợp lệ');
    for (const value of [from, to]) {
      if (!value) continue;
      const [year, month, day] = value.split('-').map(Number);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
        throw new BadRequestException('Ngày không tồn tại');
      }
    }
    if (from && to) {
      const start = Date.parse(`${from}T00:00:00Z`);
      const end = Date.parse(`${to}T00:00:00Z`);
      if (end - start > 366 * 24 * 60 * 60 * 1000) {
        throw new BadRequestException('Khoảng ngày tối đa là 366 ngày');
      }
    }
  }

  private requireDateRange(from: string | undefined, to: string | undefined): asserts from is string {
    if (!from || !to) throw new BadRequestException('Cần cung cấp ngày bắt đầu và ngày kết thúc');
    this.validateDateRange(from, to);
  }

  /**
   * Chênh lệch lương của 1 ca (thưởng/phạt) theo StorePayrollRule của cửa hàng.
   * Chỉ áp phần PHẠT map được về mức 1 ca: LATE / EARLY / ABSENT (mirror công thức
   * payroll thật trong stores.service.ts). Bonus ATTENDANCE/GENERAL là mức THÁNG,
   * không thuộc 1 ca nên không cộng vào đây.
   * Trả về số âm (phạt) hoặc 0. Ca chưa đi làm (chưa có shiftEarnings) => 0.
   */
  private assignmentSalaryDiff(
    a: ShiftAssignment,
    rules: StorePayrollRule[],
    baseSalary: number,
    slot?: ShiftSlot | null,
  ): number {
    if (a.shiftEarnings == null) return 0; // chưa đi làm
    if (!rules || rules.length === 0) return 0;

    const s = slot || a.shiftSlot;
    // Đếm mức 1 ca: mỗi loại vi phạm tính 1 lần cho ca này.
    const lateCount = (a.lateMinutes || 0) > 0 ? 1 : 0;
    const earlyCount = (a.earlyMinutes || 0) > 0 ? 1 : 0;
    const today = new Date().toISOString().slice(0, 10);
    const absentCount =
      a.status === ShiftAssignmentStatus.APPROVED &&
      !a.checkInTime &&
      (s?.workDate || '') < today
        ? 1
        : 0;

    let penalty = 0;
    for (const rule of rules) {
      if (rule.category !== PayrollRuleCategory.FINE) continue;
      if (rule.ruleType === 'LATE' && lateCount > 0) {
        penalty +=
          rule.calcType === PayrollCalcType.AMOUNT
            ? Number(rule.value) * lateCount
            : ((baseSalary * Number(rule.value)) / 100) * lateCount;
      }
      if (rule.ruleType === 'EARLY' && earlyCount > 0) {
        penalty +=
          rule.calcType === PayrollCalcType.AMOUNT
            ? Number(rule.value) * earlyCount
            : ((baseSalary * Number(rule.value)) / 100) * earlyCount;
      }
      if (rule.ruleType === 'ABSENT' && absentCount > 0) {
        penalty += Number(rule.value) * absentCount;
      }
    }
    return penalty > 0 ? -Math.round(penalty) : 0;
  }

  private mapSlotToResponse(
    slot: ShiftSlot,
    rules: StorePayrollRule[] = [],
  ): ShiftSlotResponse {
    const activeAssignments = (slot.assignments || []).filter(
      (a) => a.status !== ShiftAssignmentStatus.CANCELLED,
    );
    const required = slot.maxStaff ?? slot.workShift?.defaultMaxStaff ?? null;
    const assigned = activeAssignments.length;
    
    // If required is null (unlimited), insufficient is 0. Otherwise, it's required - assigned
    const insufficientCount = required === null ? 0 : Math.max(0, required - assigned);
    const insufficientRatio = required && required > 0 ? insufficientCount / required : 0;

    let staffingStatus: StaffingStatus;
    if (insufficientCount === 0) {
      staffingStatus = StaffingStatus.SUFFICIENT;
    } else if (insufficientRatio >= 0.5) {
      staffingStatus = StaffingStatus.SERIOUS;
    } else {
      staffingStatus = StaffingStatus.INSUFFICIENT;
    }

    const startTime = slot.startTime || slot.workShift?.startTime || '';
    const endTime = slot.endTime || slot.workShift?.endTime || '';
    const shiftType = this.inferShiftType(
      slot.workShift?.shiftName || '',
      startTime,
    );

    return {
      id: slot.id,
      workDate: slot.workDate,
      dayOfWeek: slot.dayOfWeek || '',
      dayOfWeekVi: DAY_FULL_VI[slot.dayOfWeek || ''] || '',
      startTime,
      endTime,
      shiftName: slot.workShift?.shiftName || 'Ca làm việc',
      shiftType,
      colorCode: slot.workShift?.colorCode || null,
      maxStaff: slot.maxStaff,
      requiredCount: required,
      assignedCount: assigned,
      insufficientCount,
      insufficientRatio: Math.round(insufficientRatio * 100),
      staffingStatus,
      totalSalary: activeAssignments.reduce((sum, a) => {
        // Đã check-out → shiftEarnings thực; chưa → ước tính từ hợp đồng.
        // Trừ thêm phần phạt trễ/về sớm/vắng (assignmentSalaryDiff) để tổng
        // lương dự kiến khớp với số hiển thị từng nhân viên.
        const salary = this.estimateAssignmentSalary(a, slot);
        return sum + salary + this.assignmentSalaryDiff(a, rules, salary, slot);
      }, 0),
      location: slot.location || (slot.workShift as any)?.location || null,
      note: slot.note || null,
      status: this.computeShiftStatus(slot),
      employees: activeAssignments.map((a) => {
        const salary = this.estimateAssignmentSalary(a, slot);
        // Thưởng/phạt theo StorePayrollRule (chỉ phần phạt map được về 1 ca).
        const salaryDiff = this.assignmentSalaryDiff(a, rules, salary, slot);

        return {
          id: a.employeeId,
          name: (a.employee as any)?.account?.fullName || 'Nhân viên',
          avatar: (a.employee as any)?.account?.avatar || null,
          role: (a.employee as any)?.storeRole?.name || null,
          type: 'Parttime',
          checkInTime: a.checkInTime?.toISOString() || null,
          checkOutTime: a.checkOutTime?.toISOString() || null,
          status: this.mapAttendanceStatus(a.attendanceStatus),
          lateMinutes: a.lateMinutes || null,
          earlyMinutes: a.earlyMinutes || null,
          workedMinutes: a.workedMinutes || null,
          // Lương dự kiến: đã check-out → thực nhận; chưa → ước tính từ hợp đồng.
          salary,
          salaryDiff,
          assignmentId: a.id,
          assignmentStatus: a.status,
        };
      }),
      cycleId: slot.cycleId,
    };
  }

  private computeShiftStatus(slot: ShiftSlot): ShiftStatus {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now).reduce<Record<string, string>>((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    const currentTime = `${parts.hour}:${parts.minute}`;
    const startTime = slot.startTime || slot.workShift?.startTime || '';
    const endTime = slot.endTime || slot.workShift?.endTime || '';
    if (!startTime || !endTime) return ShiftStatus.PENDING;

    const overnight = endTime < startTime;
    const workDate = slot.workDate;
    if (overnight) {
      // A shift that starts yesterday remains active after midnight until its
      // end time on the following local (Asia/Ho_Chi_Minh) day.
      const yesterday = new Date(`${today}T00:00:00Z`);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayDate = yesterday.toISOString().slice(0, 10);
      if (workDate === yesterdayDate && currentTime <= endTime) return ShiftStatus.ONGOING;
      if (workDate === today) {
        if (currentTime >= startTime) return ShiftStatus.ONGOING;
        return ShiftStatus.PENDING;
      }
      return workDate > today ? ShiftStatus.PENDING : ShiftStatus.FINISHED;
    }

    if (workDate > today) return ShiftStatus.PENDING;
    if (workDate < today) return ShiftStatus.FINISHED;
    if (currentTime >= startTime && currentTime <= endTime) return ShiftStatus.ONGOING;
    return currentTime > endTime ? ShiftStatus.FINISHED : ShiftStatus.PENDING;
  }

  private mapAttendanceStatus(
    status: AttendanceStatus | null,
  ): ShiftSlotEmployee['status'] {
    if (!status) return null;
    switch (status) {
      case AttendanceStatus.ON_TIME:
        return 'on_time';
      case AttendanceStatus.LATE:
        return 'late';
      case AttendanceStatus.ABSENT:
        return 'absent';
      case AttendanceStatus.FORGOT_CHECKOUT:
        return 'on_break';
      default:
        return null;
    }
  }

  private inferShiftType(shiftName: string, startTime: string): string {
    const name = shiftName.toLowerCase();
    const time = startTime || '';
    if (
      name.includes('sáng') ||
      name.includes('morning') ||
      (time >= '05:00' && time < '11:00')
    ) {
      return 'morning';
    }
    if (
      name.includes('trưa') ||
      name.includes('noon') ||
      (time >= '11:00' && time < '15:00')
    ) {
      return 'noon';
    }
    if (name.includes('tối') || name.includes('evening') || time >= '15:00') {
      return 'evening';
    }
    return 'morning';
  }

  private async calcSummary(storeId: string, from: string, to: string) {
    const [assignments, slotResult, leaveRows] = await Promise.all([
      this.shiftAssignmentRepo
        .createQueryBuilder('sa')
        .leftJoinAndSelect('sa.shiftSlot', 'slot')
        .leftJoinAndSelect('slot.workShift', 'ws')
        .leftJoinAndSelect('sa.employee', 'emp')
        .leftJoinAndSelect(
          'emp.contracts',
          'contract',
          'contract.isActive = true',
        )
        .leftJoin('slot.cycle', 'cycle')
        .where('cycle.storeId = :storeId', { storeId })
        .andWhere('cycle.status IN (:...cycleStatuses)', {
          cycleStatuses: [WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED],
        })
        .andWhere('slot.workDate >= :from', { from })
        .andWhere('slot.workDate <= :to', { to })
        .andWhere('sa.status != :cancelled', {
          cancelled: ShiftAssignmentStatus.CANCELLED,
        })
        .getMany(),
      this.shiftSlotRepo
        .createQueryBuilder('slot')
        .leftJoin('slot.cycle', 'cycle')
        .where('cycle.storeId = :storeId', { storeId })
        .andWhere('cycle.status IN (:...cycleStatuses)', {
          cycleStatuses: [WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED],
        })
        .andWhere('slot.workDate >= :from', { from })
        .andWhere('slot.workDate <= :to', { to })
        // A slot inherits its work-shift default when it has no override.
        // Any null after resolution means the period is unlimited.
        .select(
          `CASE WHEN COUNT(*) FILTER (WHERE COALESCE(slot.maxStaff, ws.defaultMaxStaff) IS NULL) > 0
            THEN NULL
            ELSE COALESCE(SUM(COALESCE(slot.maxStaff, ws.defaultMaxStaff)), 0)
          END`,
          'totalRequired',
        )
        .leftJoin('slot.workShift', 'ws')
        .getRawOne(),
      this.leaveRequestRepo
        .createQueryBuilder('lr')
        .select('DISTINCT lr.employeeProfileId', 'employeeId')
        .where('lr.storeId = :storeId', { storeId })
        .andWhere('lr.status = :approved', { approved: 'APPROVED' })
        .andWhere('lr.startDate <= :to', { to })
        .andWhere('lr.endDate >= :from', { from })
        .getRawMany(),
    ]);

    // Đồng nhất quy tắc: đã làm → thực tế; chưa → ước tính (giờ theo lịch, lương theo hợp đồng).
    let totalSalary = 0;
    let totalHours = 0;
    const employeeIds = new Set<string>();
    const slotIds = new Set<string>();
    for (const a of assignments) {
      totalSalary += this.estimateAssignmentSalary(a);
      totalHours += this.assignmentHours(a);
      if (a.employeeId) employeeIds.add(a.employeeId);
      if (a.shiftSlotId) slotIds.add(a.shiftSlotId);
    }

    return {
      totalSalary,
      totalEmployees: employeeIds.size,
      totalHours,
      totalShifts: slotIds.size,
      totalRequiredEmployees:
        slotResult?.totalRequired == null ? null : Number(slotResult.totalRequired) || 0,
      totalLeaveEmployees: leaveRows.length,
    };
  }

  private getPreviousPeriod(
    from: string,
    to: string,
  ): { from: string; to: string } {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const diffMs = toDate.getTime() - fromDate.getTime();
    const prevTo = new Date(fromDate.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - diffMs);
    return {
      from: prevFrom.toISOString().split('T')[0],
      to: prevTo.toISOString().split('T')[0],
    };
  }

  private formatDateVn(dateInput: string | Date): string {
    let dateStr = '';
    if (dateInput instanceof Date) {
      dateStr = dateInput.toISOString().split('T')[0];
    } else {
      dateStr = String(dateInput);
    }
    if (!dateStr.includes('-')) return dateStr;
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  }

  private getDateRange(from: string, to: string): Date[] {
    const dates: Date[] = [];
    const current = new Date(from);
    const end = new Date(to);
    while (current <= end) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  private async scoreCandidates(
    candidates: EmployeeProfile[],
    slot: any,
    from: string,
    to: string,
  ): Promise<
    (EmployeeProfile & {
      matchPercent: number;
      reason: string;
      reasonSub: string | null;
    })[]
  > {
    const shiftType = this.inferShiftType(
      slot.workShift?.shiftName || '',
      slot.workShift?.startTime || '',
    );

    const results = await Promise.all(
      candidates.map(async (c) => {
        const [historyCount, avgWorkload, currentWorkload] = await Promise.all([
          this.getSameTypeShiftCount(c.id, shiftType, from, to),
          this.getAvgWorkload(c.storeId, from, to),
          this.getCurrentWorkload(c.id, from, to),
        ]);

        const punctualityRate = await this.getPunctualityRate(c.id, from, to);
        const preferenceLevel = this.getPreferenceLevel(c, shiftType);
        const capability = c.capabilityPoints || 0;

        const historyScore = Math.min(historyCount * 5, 40);
        const punctualityScore = Math.min(punctualityRate * 0.25, 25);
        const workloadScore = Math.max(
          0,
          Math.min(15, 15 - currentWorkload * 1.5),
        );
        const preferenceScore = preferenceLevel * 20;
        const capabilityScore = Math.min(capability * 0.2, 20);

        const rawScore =
          historyScore +
          punctualityScore +
          workloadScore +
          preferenceScore +
          capabilityScore;
        const maxPossible = 115;
        const matchPercent = Math.round((rawScore / maxPossible) * 100);

        const { reason, reasonSub } = this.buildReason(
          historyCount,
          punctualityRate,
          preferenceLevel,
          currentWorkload,
          avgWorkload,
        );

        return {
          ...c,
          matchPercent,
          reason,
          reasonSub,
        };
      }),
    );

    return results.sort((a, b) => b.matchPercent - a.matchPercent);
  }

  private async getSameTypeShiftCount(
    employeeId: string,
    shiftType: string,
    from: string,
    to: string,
  ): Promise<number> {
    return this.shiftAssignmentRepo
      .createQueryBuilder('sa')
      .leftJoin('sa.shiftSlot', 'slot')
      .where('sa.employeeId = :employeeId', { employeeId })
      .andWhere('slot.workDate >= :from', { from })
      .andWhere('slot.workDate <= :to', { to })
      .andWhere('sa.status != :cancelled', {
        cancelled: ShiftAssignmentStatus.CANCELLED,
      })
      .getCount();
  }

  private async getPunctualityRate(
    employeeId: string,
    from: string,
    to: string,
  ): Promise<number> {
    const total = await this.shiftAssignmentRepo
      .createQueryBuilder('sa')
      .leftJoin('sa.shiftSlot', 'slot')
      .where('sa.employeeId = :employeeId', { employeeId })
      .andWhere('slot.workDate >= :from', { from })
      .andWhere('slot.workDate <= :to', { to })
      .getCount();

    if (total === 0) return 100;

    const lateCount = await this.shiftAssignmentRepo
      .createQueryBuilder('sa')
      .leftJoin('sa.shiftSlot', 'slot')
      .where('sa.employeeId = :employeeId', { employeeId })
      .andWhere('slot.workDate >= :from', { from })
      .andWhere('slot.workDate <= :to', { to })
      .andWhere('sa.lateMinutes > 0')
      .getCount();

    return Math.round(((total - lateCount) / total) * 100);
  }

  private async getCurrentWorkload(
    employeeId: string,
    from: string,
    to: string,
  ): Promise<number> {
    return this.shiftAssignmentRepo
      .createQueryBuilder('sa')
      .leftJoin('sa.shiftSlot', 'slot')
      .where('sa.employeeId = :employeeId', { employeeId })
      .andWhere('slot.workDate >= :from', { from })
      .andWhere('slot.workDate <= :to', { to })
      .andWhere('sa.status != :cancelled', {
        cancelled: ShiftAssignmentStatus.CANCELLED,
      })
      .getCount();
  }

  private async getAvgWorkload(
    storeId: string,
    from: string,
    to: string,
  ): Promise<number> {
    const result = await this.shiftAssignmentRepo
      .createQueryBuilder('sa')
      .leftJoin('sa.shiftSlot', 'slot')
      .leftJoin('slot.cycle', 'cycle')
      .where('cycle.storeId = :storeId', { storeId })
      .andWhere('cycle.status IN (:...cycleStatuses)', {
        cycleStatuses: [WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED],
      })
      .andWhere('slot.workDate >= :from', { from })
      .andWhere('slot.workDate <= :to', { to })
      .andWhere('sa.status != :cancelled', {
        cancelled: ShiftAssignmentStatus.CANCELLED,
      })
      .select('COUNT(sa.id) * 1.0 / NULLIF(COUNT(DISTINCT sa.employeeId), 0)', 'avgCount')
      .getRawOne();

    return Number(result?.avgCount) || 0;
  }

  private getPreferenceLevel(c: EmployeeProfile, shiftType: string): number {
    const prefs = c.preferredShiftTypes || [];
    if (prefs.includes(shiftType)) return 1;
    return 0;
  }

  private buildReason(
    historyCount: number,
    punctualityRate: number,
    preferenceLevel: number,
    currentWorkload: number,
    avgWorkload: number,
  ): { reason: string; reasonSub: string | null } {
    if (historyCount >= 5) {
      return {
        reason: `Đã làm ca này ${historyCount} lần`,
        reasonSub: 'trong 30 ngày qua',
      };
    }
    if (historyCount >= 2) {
      return { reason: `Đã làm ca này ${historyCount} lần`, reasonSub: null };
    }
    if (punctualityRate >= 95) {
      return { reason: 'Điểm chuyên cần cao', reasonSub: 'không đi muộn' };
    }
    if (punctualityRate >= 85) {
      return { reason: 'Ít đi muộn', reasonSub: null };
    }
    if (currentWorkload < avgWorkload) {
      return { reason: 'Ít việc hơn mức trung bình', reasonSub: null };
    }
    if (preferenceLevel > 0) {
      return { reason: 'Đăng ký ưa thích ca này', reasonSub: null };
    }
    return { reason: 'Nhân viên khả dụng', reasonSub: null };
  }

  async getEmployeeActivities(params: {
    storeId: string;
    employeeId: string;
    from: string;
    to: string;
    ownerAccountId: string;
  }): Promise<any[]> {
    const { storeId, employeeId, from, to } = params;
    await this.assertEmployeeCalendarAccess(storeId, employeeId, params.ownerAccountId);
    this.requireDateRange(from, to);

    const fromDate = new Date(`${from}T00:00:00+07:00`);
    const toDate = new Date(`${to}T23:59:59.999+07:00`);

    // 1. Fetch Attendance Logs
    const attendanceLogs = await this.attendanceLogRepo
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.shiftAssignment', 'sa')
      .leftJoinAndSelect('sa.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .where('log.storeId = :storeId', { storeId })
      .andWhere('log.employeeProfileId = :employeeId', { employeeId })
      .andWhere('log.timestamp >= :from', { from: fromDate })
      .andWhere('log.timestamp <= :to', { to: toDate })
      .getMany();

    // 2. Fetch Shift Assignments (SHIFT_REGISTER)
    const shiftAssignments = await this.shiftAssignmentRepo
      .createQueryBuilder('sa')
      .leftJoinAndSelect('sa.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .leftJoin('slot.cycle', 'cycle')
      .where('sa.employeeId = :employeeId', { employeeId })
      .andWhere('cycle.storeId = :storeId', { storeId })
      .andWhere('cycle.status IN (:...cycleStatuses)', {
        cycleStatuses: [WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED],
      })
      .andWhere('sa.createdAt >= :from', { from: fromDate })
      .andWhere('sa.createdAt <= :to', { to: toDate })
      .getMany();

    // 3. Fetch Shift Change Requests (SHIFT_CHANGE)
    const shiftChangeRequests = await this.shiftChangeRequestRepo
      .createQueryBuilder('scr')
      .where('scr.storeId = :storeId', { storeId })
      .andWhere('scr.employeeProfileId = :employeeId', { employeeId })
      .andWhere('scr.createdAt >= :from', { from: fromDate })
      .andWhere('scr.createdAt <= :to', { to: toDate })
      .getMany();

    // 4. Fetch Leave Requests (LEAVE, LATE, EARLY, OVERTIME)
    const leaveRequests = await this.leaveRequestRepo
      .createQueryBuilder('lr')
      .leftJoinAndSelect('lr.shiftAssignment', 'sa')
      .leftJoinAndSelect('sa.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .where('lr.storeId = :storeId', { storeId })
      .andWhere('lr.employeeProfileId = :employeeId', { employeeId })
      .andWhere('lr.createdAt >= :from', { from: fromDate })
      .andWhere('lr.createdAt <= :to', { to: toDate })
      .getMany();

    // Collect all shift IDs to fetch details for shift change request lookup
    const allShiftIds = new Set<string>();
    for (const scr of shiftChangeRequests) {
      if (scr.currentShiftId) allShiftIds.add(scr.currentShiftId);
      if (scr.requestedShiftId) allShiftIds.add(scr.requestedShiftId);
    }

    const shiftLookupMap = new Map<string, { shiftName: string; timeRange: string; employeeName?: string }>();
    if (allShiftIds.size > 0) {
      const idsArray = Array.from(allShiftIds);
      // Try to load as ShiftAssignment
      const assignments = await this.shiftAssignmentRepo
        .createQueryBuilder('sa')
        .leftJoinAndSelect('sa.shiftSlot', 'slot')
        .leftJoinAndSelect('slot.workShift', 'ws')
        .leftJoinAndSelect('sa.employee', 'emp')
        .leftJoinAndSelect('emp.account', 'acc')
        .leftJoin('slot.cycle', 'cycle')
        .where('sa.id IN (:...idsArray)', { idsArray })
        .andWhere('sa.employeeId = :employeeId', { employeeId })
        .andWhere('cycle.storeId = :storeId', { storeId })
        .andWhere('cycle.status IN (:...cycleStatuses)', {
          cycleStatuses: [WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED],
        })
        .getMany();

      for (const a of assignments) {
        shiftLookupMap.set(a.id, {
          shiftName: a.shiftSlot?.workShift?.shiftName || 'Ca làm',
          timeRange: `${a.shiftSlot?.startTime || a.shiftSlot?.workShift?.startTime || ''} - ${a.shiftSlot?.endTime || a.shiftSlot?.workShift?.endTime || ''}`,
          employeeName: a.employee?.account?.fullName,
        });
      }

      // Try to load as ShiftSlot
      const slots = await this.shiftSlotRepo
        .createQueryBuilder('slot')
        .leftJoinAndSelect('slot.workShift', 'ws')
        .leftJoin('slot.cycle', 'cycle')
        .where('slot.id IN (:...idsArray)', { idsArray })
        .andWhere('cycle.storeId = :storeId', { storeId })
        .andWhere('cycle.status IN (:...cycleStatuses)', {
          cycleStatuses: [WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED],
        })
        .getMany();

      for (const s of slots) {
        shiftLookupMap.set(s.id, {
          shiftName: s.workShift?.shiftName || 'Ca làm',
          timeRange: `${s.startTime || s.workShift?.startTime || ''} - ${s.endTime || s.workShift?.endTime || ''}`,
        });
      }
    }

    const activities: any[] = [];

    // Map Attendance Logs
    for (const log of attendanceLogs) {
      const isCheckIn = log.type === 'CHECK_IN';
      const sa = log.shiftAssignment;
      const ws = sa?.shiftSlot?.workShift;
      const slot = sa?.shiftSlot;

      let statusText = 'Đúng giờ';
      let statusColor = '#12B76A'; // Green
      if (isCheckIn && sa && sa.lateMinutes > 0) {
        statusText = `Trễ ${sa.lateMinutes} phút`;
        statusColor = '#F79009'; // Yellow/Orange
      } else if (!isCheckIn && sa && sa.earlyMinutes > 0) {
        statusText = `Về sớm ${sa.earlyMinutes} phút`;
        statusColor = '#F04438'; // Red
      }

      activities.push({
        id: log.id,
        type: log.type,
        title: isCheckIn ? 'Check-in' : 'Check-out',
        timestamp: log.timestamp.toISOString(),
        statusText,
        statusColor,
        hasWarningIcon: false,
        details: {
          shiftName: ws?.shiftName || 'Ca làm việc',
          timeRange: slot ? `${slot.startTime || ws?.startTime || ''} - ${slot.endTime || ws?.endTime || ''}` : '',
          method: log.method,
        },
      });
    }

    // Map Shift Assignments (SHIFT_REGISTER)
    for (const sa of shiftAssignments) {
      const ws = sa.shiftSlot?.workShift;
      const slot = sa.shiftSlot;

      let type: 'SHIFT_REGISTER' = 'SHIFT_REGISTER';
      let title = 'Đăng ký ca làm';
      let statusText = 'Chờ duyệt';
      let statusColor = '#F79009'; // Yellow/Orange
      let hasWarningIcon = false;

      if (sa.status === ShiftAssignmentStatus.PENDING) {
        statusText = 'Chờ duyệt';
        statusColor = '#F79009';
        hasWarningIcon = true;
      } else if (sa.status === ShiftAssignmentStatus.CANCELLED) {
        statusText = 'Đã từ chối';
        statusColor = '#F04438';
      } else {
        statusText = 'Đã duyệt';
        statusColor = '#12B76A';
      }

      activities.push({
        id: sa.id,
        type,
        title,
        timestamp: sa.createdAt.toISOString(),
        statusText,
        statusColor,
        hasWarningIcon,
        details: {
          shiftName: ws?.shiftName || 'Ca làm việc',
          workDate: slot?.workDate || '',
          timeRange: slot ? `${slot.startTime || ws?.startTime || ''} - ${slot.endTime || ws?.endTime || ''}` : '',
          note: sa.note || '',
        },
      });
    }

    // Map Shift Change Requests
    for (const scr of shiftChangeRequests) {
      let statusText = 'Chờ duyệt';
      let statusColor = '#F79009'; // Yellow/Orange
      let hasWarningIcon = false;

      if (scr.status === ShiftChangeRequestStatus.PENDING) {
        statusText = 'Chờ duyệt';
        statusColor = '#F79009';
        hasWarningIcon = true;
      } else if (scr.status === ShiftChangeRequestStatus.APPROVED) {
        statusText = 'Đã duyệt';
        statusColor = '#12B76A';
      } else if (scr.status === ShiftChangeRequestStatus.REJECTED) {
        statusText = 'Đã từ chối';
        statusColor = '#F04438';
      } else {
        statusText = 'Đã huỷ';
        statusColor = '#98A2B3';
      }

      const current = scr.currentShiftId ? shiftLookupMap.get(scr.currentShiftId) : null;
      const requested = scr.requestedShiftId ? shiftLookupMap.get(scr.requestedShiftId) : null;

      activities.push({
        id: scr.id,
        type: 'SHIFT_CHANGE',
        title: 'Xin đổi ca',
        timestamp: scr.createdAt.toISOString(),
        statusText,
        statusColor,
        hasWarningIcon,
        details: {
          requestDate: scr.requestDate,
          reason: scr.reason || '',
          currentShift: current ? `${current.shiftName} (${current.timeRange})` : 'Không có ca',
          requestedShift: requested 
            ? `${requested.shiftName} (${requested.timeRange})${requested.employeeName ? ` - ${requested.employeeName}` : ''}`
            : 'Ca trống',
        },
      });
    }

    // Map Leave Requests (LEAVE, LATE, EARLY, OVERTIME)
    for (const lr of leaveRequests) {
      let type: 'LEAVE' | 'LATE' | 'EARLY' | 'OVERTIME' = 'LEAVE';
      let title = 'Xin nghỉ phép';

      if (lr.type === 'LATE') {
        type = 'LATE';
        title = 'Xin đi trễ';
      } else if (lr.type === 'EARLY') {
        type = 'EARLY';
        title = 'Xin về sớm';
      } else if (lr.type === 'OVERTIME') {
        type = 'OVERTIME';
        title = 'Xin tăng ca';
      }

      let statusText = 'Chờ duyệt';
      let statusColor = '#F79009';
      let hasWarningIcon = false;

      if (lr.status === 'PENDING') {
        statusText = 'Chờ duyệt';
        statusColor = '#F79009';
        hasWarningIcon = true;
      } else if (lr.status === 'APPROVED') {
        statusText = 'Đã duyệt';
        statusColor = '#12B76A';
      } else if (lr.status === 'REJECTED') {
        statusText = 'Đã từ chối';
        statusColor = '#F04438';
      } else {
        statusText = 'Đã huỷ';
        statusColor = '#98A2B3';
      }

      const ws = lr.shiftAssignment?.shiftSlot?.workShift;
      const slot = lr.shiftAssignment?.shiftSlot;

      activities.push({
        id: lr.id,
        type,
        title,
        timestamp: lr.createdAt.toISOString(),
        statusText,
        statusColor,
        hasWarningIcon,
        details: {
          reason: lr.reason || '',
          startDate: lr.startDate,
          endDate: lr.endDate,
          startTime: lr.startTime,
          endTime: lr.endTime,
          shiftName: ws?.shiftName,
          timeRange: slot ? `${slot.startTime || ws?.startTime || ''} - ${slot.endTime || ws?.endTime || ''}` : '',
        },
      });
    }

    // Sort by timestamp descending
    return activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }
}
