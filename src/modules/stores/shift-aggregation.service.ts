import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ShiftSlot,
  ShiftAssignment,
  ShiftAssignmentStatus,
  AttendanceStatus,
  WorkCycle,
} from './entities/shift-management.entity';
import { WorkShift } from './entities/work-shift.entity';
import {
  EmployeeProfile,
  EmploymentStatus,
} from './entities/employee-profile.entity';
import { EmployeeLeaveRequest } from './entities/employee-leave-request.entity';
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
  requiredCount: number;
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
}

export interface ShiftSummaryResponse {
  totalSalary: number;
  salaryChange: number;
  totalEmployees: number;
  totalRequiredEmployees: number;
  employeeChange: number;
  totalHours: number;
  hoursChange: number;
  totalShifts: number;
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
    startTime: string;
    endTime: string;
    hours: number | null;
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
  ) { }

  // ── 1. List Shift Slots ────────────────────────────────────────────────────

  async getShiftSlots(params: {
    storeId: string;
    from?: string;
    to?: string;
    type?: string;
    staffingStatus?: StaffingStatus;
    page?: number;
    limit?: number;
  }): Promise<{
    data: ShiftSlotResponse[];
    meta: { total: number; page: number; limit: number };
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

    const qb = this.shiftSlotRepo
      .createQueryBuilder('slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .leftJoinAndSelect('slot.assignments', 'sa')
      .leftJoinAndSelect('sa.employee', 'emp')
      .leftJoinAndSelect('emp.account', 'account')
      .leftJoinAndSelect('emp.storeRole', 'role')
      .leftJoin('slot.cycle', 'cycle')
      .where('cycle.storeId = :storeId', { storeId });

    if (from) qb.andWhere('slot.workDate >= :from', { from });
    if (to) qb.andWhere('slot.workDate <= :to', { to });

    const rawSlots = await qb
      .orderBy('slot.workDate', 'ASC')
      .addOrderBy('ws.startTime', 'ASC')
      .getMany();

    let slots = rawSlots.map((slot) => this.mapSlotToResponse(slot));

    if (staffingStatus) {
      slots = slots.filter((s) => s.staffingStatus === staffingStatus);
    }
    if (type) {
      slots = slots.filter((s) => s.shiftType === type);
    }

    const total = slots.length;
    const paged = slots.slice((page - 1) * limit, page * limit);

    return { data: paged, meta: { total, page, limit } };
  }

  // ── 2. Chi tiết 1 ca ──────────────────────────────────────────────────────

  async getShiftDetail(params: {
    storeId: string;
    shiftSlotId: string;
  }): Promise<ShiftDetailResponse | null> {
    const { storeId, shiftSlotId } = params;

    const slot = await this.shiftSlotRepo
      .createQueryBuilder('slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .leftJoinAndSelect('slot.assignments', 'sa')
      .leftJoinAndSelect('sa.employee', 'emp')
      .leftJoinAndSelect('emp.account', 'account')
      .leftJoinAndSelect('emp.storeRole', 'role')
      .leftJoin('slot.cycle', 'cycle')
      .where('cycle.storeId = :storeId', { storeId })
      .andWhere('slot.id = :shiftSlotId', { shiftSlotId })
      .getOne();

    if (!slot) return null;

    const response = this.mapSlotToResponse(slot) as ShiftDetailResponse;
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

    response.estimatedTotalSalary = currentDaySummary.totalSalary;
    response.salaryChangePercent = prevDaySummary.totalSalary > 0 
      ? Math.round(((currentDaySummary.totalSalary - prevDaySummary.totalSalary) / prevDaySummary.totalSalary) * 100)
      : 0;
    
    response.estimatedTotalHours = currentDaySummary.totalHours;
    response.hoursChangePercent = prevDaySummary.totalHours > 0
      ? Math.round(((currentDaySummary.totalHours - prevDaySummary.totalHours) / prevDaySummary.totalHours) * 100)
      : 0;

    const daySlots = await this.getShiftSlots({ storeId, from: slot.workDate, to: slot.workDate, limit: 100 });
    
    response.todos = daySlots.data
      .filter((s) => s.insufficientCount > 0)
      .map((s) => ({
        id: s.id,
        type: this.inferShiftType(s.shiftName || '', s.startTime || ''),
        title: `Bổ sung ${s.shiftName.toLowerCase()} ${s.startTime} - ${s.endTime}`,
        count: s.insufficientCount,
        role: 'nhân viên',
      }));

    const aiSugRaw = await this.getShiftSuggestions({ storeId, from: slot.workDate, to: slot.workDate, limit: 5 });
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
  }): Promise<ShiftSummaryResponse> {
    const { storeId, from, to } = params;
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
    };
  }

  // ── 4. Month Summary ─────────────────────────────────────────────────────

  async getMonthSummary(params: {
    storeId: string;
    year: number;
    month: number;
  }): Promise<MonthSummaryResponse> {
    const { storeId, year, month } = params;
    const lastDay = new Date(year, month, 0).getDate();
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const slots = await this.shiftSlotRepo
      .createQueryBuilder('slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .leftJoinAndSelect('slot.assignments', 'sa')
      .leftJoin('slot.cycle', 'cycle')
      .where('cycle.storeId = :storeId', { storeId })
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
        (sum, a) => sum + Number(a.shiftEarnings || 0),
        0,
      );
      totalMinutes += activeAssignments.reduce(
        (sum, a) => sum + (a.workedMinutes || 0),
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
    limit?: number;
  }): Promise<ShiftSuggestion[]> {
    const { storeId, from, to, limit = 3 } = params;

    // Lấy các slot thiếu nhân viên
    const insufficientRaw = await this.shiftSlotRepo
      .createQueryBuilder('slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .leftJoin('slot.assignments', 'sa')
      .leftJoin('slot.cycle', 'cycle')
      .where('cycle.storeId = :storeId', { storeId })
      .andWhere('slot.workDate >= :from', { from })
      .andWhere('slot.workDate <= :to', { to })
      .andWhere('slot.maxStaff IS NOT NULL')
      .groupBy('slot.id')
      .addGroupBy('ws.id')
      .select([
        'slot.id as id',
        'slot.workDate as workDate',
        'slot.dayOfWeek as dayOfWeek',
        'slot.maxStaff as maxStaff',
        'slot.workShiftId as workShiftId',
        'slot.startTime as slotStartTime',
        'slot.endTime as slotEndTime',
        'ws.shiftName as ws_shiftName',
        'ws.startTime as ws_startTime',
        'COUNT(sa.id) as assignedCount',
      ])
      .having('slot.maxStaff > COUNT(sa.id)')
      .getRawMany();

    if (!insufficientRaw || insufficientRaw.length === 0) return [];

    // Lấy candidate employees
    const candidates = await this.employeeProfileRepo
      .createQueryBuilder('emp')
      .leftJoinAndSelect('emp.account', 'account')
      .leftJoinAndSelect('emp.storeRole', 'role')
      .where('emp.storeId = :storeId', { storeId })
      .andWhere('emp.employmentStatus = :status', {
        status: EmploymentStatus.ACTIVE,
      })
      .getMany();

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
      .andWhere('slot.workDate >= :from', { from })
      .andWhere('slot.workDate <= :to', { to })
      .andWhere('sa.status != :cancelled', {
        cancelled: ShiftAssignmentStatus.CANCELLED,
      })
      .select(['sa.employeeId', 'sa.shiftSlotId'])
      .getMany();

    const suggestions: ShiftSuggestion[] = [];

    for (const raw of insufficientRaw) {
      const slotAssigned = new Set(
        existingAssignments
          .filter((a: any) => a.sa_shiftSlotId === raw.id)
          .map((a: any) => a.sa_employeeId),
      );

      const eligible = candidates.filter(
        (c) => !slotAssigned.has(c.id) && !onLeaveIds.has(c.id),
      );
      if (eligible.length === 0) continue;

      const shiftType = this.inferShiftType(
        raw.ws_shiftName || '',
        raw.ws_startTime || '',
      );
      const dayLabel = `${DAY_FULL_VI[raw.dayOfWeek || ''] || raw.dayOfWeek || ''}, ${this.formatDateVn(raw.workDate).slice(0, 5)}`;

      // Chấm điểm
      const scored = await this.scoreCandidates(
        eligible,
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
  }): Promise<EmployeeScheduleGridResponse | null> {
    const { storeId, employeeId, from, to } = params;

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
      .leftJoin('slot.cycle', 'cycle')
      .where('sa.employeeId = :employeeId', { employeeId })
      .andWhere('cycle.storeId = :storeId', { storeId })
      .andWhere('slot.workDate >= :from', { from })
      .andWhere('slot.workDate <= :to', { to })
      .orderBy('slot.workDate', 'ASC')
      .getMany();

    const dateRange = this.getDateRange(from, to);
    const today = new Date().toISOString().split('T')[0];

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
          startTime:
            a.shiftSlot?.startTime || a.shiftSlot?.workShift?.startTime || '',
          endTime:
            a.shiftSlot?.endTime || a.shiftSlot?.workShift?.endTime || '',
          hours: a.workedMinutes
            ? Math.round((a.workedMinutes / 60) * 10) / 10
            : null,
          status: a.status,
          location: a.shiftSlot?.location || null,
        })),
      };
    });

    const totalMinutes = assignments.reduce(
      (sum, a) => sum + (a.workedMinutes || 0),
      0,
    );
    const workingDays = new Set(assignments.map((a) => a.shiftSlot?.workDate))
      .size;
    const totalSalary = assignments.reduce(
      (sum, a) => sum + Number(a.shiftEarnings || 0),
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
        totalHoursPerWeek: Math.round((totalMinutes / 60) * 10) / 10,
        daysPerWeek: workingDays,
        salaryPerWeek: Math.round(totalSalary),
      },
    };
  }

  // ── Private Helpers ─────────────────────────────────────────────────────────

  private mapSlotToResponse(slot: ShiftSlot): ShiftSlotResponse {
    const activeAssignments = (slot.assignments || []).filter(
      (a) => a.status !== ShiftAssignmentStatus.CANCELLED,
    );
    const required = slot.maxStaff ?? slot.workShift?.defaultMaxStaff ?? 0;
    const assigned = activeAssignments.length;
    const insufficientCount = Math.max(0, required - assigned);
    const insufficientRatio = required > 0 ? insufficientCount / required : 0;

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
      totalSalary: activeAssignments.reduce(
        (sum, a) => sum + Number(a.shiftEarnings || 0),
        0,
      ),
      location: slot.location || (slot.workShift as any)?.location || null,
      note: slot.note || null,
      status: this.computeShiftStatus(slot),
      employees: activeAssignments.map((a) => {
        const late = a.lateMinutes || 0;
        const early = a.earlyMinutes || 0;
        const isNegative = late > 0 || early > 0;
        const penalty = (late + early) * 10000;
        const bonus = (a.workedMinutes || 0) > 480 ? 50000 : 0;
        const salaryDiff = isNegative ? -penalty : bonus;

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
          salary: Number(a.shiftEarnings) || null,
          salaryDiff,
          assignmentId: a.id,
        };
      }),
      cycleId: slot.cycleId,
    };
  }

  private computeShiftStatus(slot: ShiftSlot): ShiftStatus {
    const today = new Date().toISOString().split('T')[0];
    if (slot.workDate > today) return ShiftStatus.PENDING;
    if (slot.workDate < today) return ShiftStatus.FINISHED;

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes(),
    ).padStart(2, '0')}`;
    const startTime = slot.startTime || slot.workShift?.startTime || '';
    const endTime = slot.endTime || slot.workShift?.endTime || '';
    if (currentTime >= startTime && currentTime <= endTime)
      return ShiftStatus.ONGOING;
    if (currentTime > endTime) return ShiftStatus.FINISHED;
    return ShiftStatus.PENDING;
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
    const [assignResult, slotResult] = await Promise.all([
      this.shiftAssignmentRepo
        .createQueryBuilder('sa')
        .leftJoin('sa.shiftSlot', 'slot')
        .leftJoin('slot.cycle', 'cycle')
        .where('cycle.storeId = :storeId', { storeId })
        .andWhere('slot.workDate >= :from', { from })
        .andWhere('slot.workDate <= :to', { to })
        .andWhere('sa.status != :cancelled', {
          cancelled: ShiftAssignmentStatus.CANCELLED,
        })
        .select([
          'COALESCE(SUM(sa.shiftEarnings), 0) as totalSalary',
          'COUNT(DISTINCT sa.employeeId) as totalEmployees',
          'COALESCE(SUM(sa.workedMinutes), 0) as totalMinutes',
          'COUNT(DISTINCT slot.id) as totalShifts',
        ])
        .getRawOne(),
      this.shiftSlotRepo
        .createQueryBuilder('slot')
        .leftJoin('slot.cycle', 'cycle')
        .where('cycle.storeId = :storeId', { storeId })
        .andWhere('slot.workDate >= :from', { from })
        .andWhere('slot.workDate <= :to', { to })
        .select('COALESCE(SUM(slot.maxStaff), 0) as totalRequired')
        .getRawOne(),
    ]);

    return {
      totalSalary: Number(assignResult?.totalSalary) || 0,
      totalEmployees: Number(assignResult?.totalEmployees) || 0,
      totalHours: (Number(assignResult?.totalMinutes) || 0) / 60,
      totalShifts: Number(assignResult?.totalShifts) || 0,
      totalRequiredEmployees: Number(slotResult?.totalRequired) || 0,
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
      .andWhere('slot.workDate >= :from', { from })
      .andWhere('slot.workDate <= :to', { to })
      .andWhere('sa.status != :cancelled', {
        cancelled: ShiftAssignmentStatus.CANCELLED,
      })
      .select('AVG(sub_count)', 'avgCount')
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
  }): Promise<any[]> {
    const { storeId, employeeId, from, to } = params;

    const fromDate = new Date(from);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);

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
      .where('sa.employeeId = :employeeId', { employeeId })
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
        .where('sa.id IN (:...idsArray)', { idsArray })
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
        .where('slot.id IN (:...idsArray)', { idsArray })
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
