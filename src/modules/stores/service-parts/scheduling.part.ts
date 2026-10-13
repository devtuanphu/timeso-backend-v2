import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import {
  In,
  MoreThanOrEqual,
  Between,
  Not,
  IsNull,
  EntityManager,
  Raw,
  Brackets,
} from 'typeorm';
import { isUUID } from 'class-validator';
import { StopWorkCycleDto } from '../dto/stop-work-cycle.dto';
import { join } from 'path';
import { Store } from '../entities/store.entity';
import {
  EMPLOYED_STATUSES,
  EmployeeProfile,
} from '../entities/employee-profile.entity';
import { EmployeeContract } from '../entities/employee-contract.entity';
import { WorkShift } from '../entities/work-shift.entity';
import {
  EmployeeLeaveRequest,
  LeaveType,
  LeaveRequestStatus,
} from '../entities/employee-leave-request.entity';
import { stintFloor } from '../employment-stint.utils';
import {
  WorkCycle,
  ShiftSlot,
  ShiftAssignment,
  ShiftSwap,
  WorkCycleStatus,
  ShiftAssignmentStatus,
  ShiftSwapStatus,
  CycleType,
  CycleShiftTemplate,
  WeekDaySchedule,
} from '../entities/shift-management.entity';
import {
  CreateWorkShiftDto,
  UpdateWorkShiftDto,
  WORK_SHIFT_NAME_MAX_LENGTH,
  WORK_SHIFT_TIME_MESSAGE,
} from '../dto/work-shift.dto';
import { CUSTOM_SHIFT_NOTE } from '../custom-shift-request.utils';
import {
  CreateShiftScheduleDto,
  ShiftDraftDto,
  ShiftEmployeeOptionsDto,
} from '../dto/create-shift-schedule.dto';
import { lockStoreShiftAvailability } from '../shift-availability-lock';
import {
  ShiftMonthlyMode,
  ShiftRecurrenceEndType,
  ShiftRecurrenceFrequency,
  ShiftRecurrenceRule,
} from '../shift-schedule.types';
import {
  SHIFT_SCHEDULE_HORIZON_DAYS,
  addDays,
  generateShiftScheduleDates,
  getTodayDateString,
  getWeekDayForDate,
  matchesShiftRecurrence,
  parseDateOnly,
} from '../shift-schedule.utils';
import { parseVietnamShiftStart } from '../shift-reminder.utils';
import { AUTHORIZED_ABSENCE_LEAVE_TYPES } from '../leave-coverage.utils';
import {
  WeekDay,
  TimekeepingRequirement,
} from '../entities/store-shift-config.entity';
import { UpdateStoreShiftConfigDto } from '../dto/store-shift-config.dto';
import { describeWorkDate } from '../../../common/utils/relative-day';
import {
  buildShiftNotification,
  selectCreatedShiftAnnouncement,
  selectFreeSeatAnnouncement,
  selectGeneratedSlotAnnouncements,
  GeneratedSlotSeatState,
  shiftsOpenTo,
  SlotAnnouncementThrottle,
  AnnouncedShift,
  shiftNotificationDateMetadata,
  ShiftNotificationKind,
} from '../shift-assignment-notification';
import {
  NotificationPriority,
  NotificationType,
} from '../../notifications/entities/notification.entity';
import { ACTIVITY_ACTIONS, toActivityDate } from '../activity-log.summary';
import { calculateShiftEarnings } from '../shift-earnings.utils';
import { countWorkingDaysInMonth } from '../working-days.utils';
import {
  vnDateString,
  vnMiddayInstant,
  vnMonthOfDateString,
} from '../../../common/utils/vn-calendar';
import { resolveShiftBoundaries } from '../attendance-time.utils';
import { DEFAULT_ANDROID_CHANNEL } from '../../push/push-capabilities';
import {
  isSlotRegistrationClosed,
  SHIFT_REGISTRATION_RANGE_PASSED_CODE,
  SHIFT_REGISTRATION_RANGE_PASSED_MESSAGE,
  SLOT_REGISTRATION_CLOSED_CODE,
  SLOT_REGISTRATION_CLOSED_MESSAGE,
} from '../shift-registration-window';
import {
  SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES,
  isShiftEligibleEmploymentStatus,
} from './shared';
import {
  CLEARED_SHIFT_REQUEST_EFFECTS,
  BLOCKING_LEAVE_TYPE_VALUES,
} from './shared';
import {
  normalizeActiveShiftName,
  sameShiftTime,
  normalizeWorkShiftTime,
} from './shared';
import {
  ShiftInterval,
  toShiftInterval,
  intervalsOverlap,
  ShiftEmployeeOtherShift,
  normalizeWorkCycleStopRequest,
  FIXED_SHIFT_MAX_RANGE_DAYS,
  MAX_BLOCKING_LEAVE_ROWS,
  shouldNotifyNewShifts,
  STORE_LOCATION_REQUIRED_CODE,
  WORK_SHIFT_INACTIVE_CODE,
  WORK_SHIFT_INACTIVE_MESSAGE,
  WORK_SHIFT_HAS_UPCOMING_ASSIGNMENTS,
  findSameNameShiftOnDates,
  sameNameShiftMessage,
  assertShiftsStartAhead,
  sortIntervals,
  ONE_ACTIVE_CYCLE_CONSTRAINTS,
  assertBlockingLeaveExpansionBound,
  toBlockingLeaveIntervals,
  mergeIntervals,
} from './shared';
import type { StoresService } from '../stores.service';

type ShiftEmployeeAvailability =
  | 'AVAILABLE'
  | 'OTHER_SHIFT'
  | 'CONFLICT'
  | 'ON_LEAVE';

const MAX_GENERATED_SHIFT_ASSIGNMENTS = 10000;

// Bound the persisted slot fan-out independently from assignments. The DTO
// currently allows at most 50 drafts, so 10,000 keeps normal long schedules
// available while preventing an unbounded transaction when no employees are set.
const MAX_GENERATED_SHIFT_SLOTS = 10000;

/** Bounds for announcing seats freed by one staff withdrawal. */
const FREE_SEAT_ANNOUNCE_MAX_SLOTS = 1000;

const FREE_SEAT_ANNOUNCE_CHUNK = 200;

type NormalizedShiftDraft = Omit<ShiftDraftDto, 'employeeIds' | 'note'> & {
  employeeIds: string[];
  note: string | null;
};

/** `HH:mm:ss` / `H:mm` → `HH:mm` for client-facing shift times. */
const toHHmm = (time: string): string => {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : time;
};

const hasInternalIntervalOverlap = (intervals: ShiftInterval[]) => {
  sortIntervals(intervals);
  let furthestEnd = Number.NEGATIVE_INFINITY;
  for (const interval of intervals) {
    if (interval.start < furthestEnd) return true;
    if (interval.end > furthestEnd) furthestEnd = interval.end;
  }
  return false;
};

const intervalSetsOverlap = (
  leftIntervals: ShiftInterval[],
  rightIntervals: ShiftInterval[],
) => {
  const left = sortIntervals(leftIntervals);
  const right = sortIntervals(rightIntervals);
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (intervalsOverlap(left[leftIndex], right[rightIndex])) return true;
    if (left[leftIndex].end <= right[rightIndex].start) leftIndex += 1;
    else rightIndex += 1;
  }
  return false;
};

const isOneActiveCycleViolation = (error: any): boolean =>
  (error?.code === '23505' || error?.driverError?.code === '23505') &&
  ONE_ACTIVE_CYCLE_CONSTRAINTS.has(
    error?.constraint ?? error?.driverError?.constraint,
  );

const groupBlockingLeaveIntervals = (
  leaveRequests: EmployeeLeaveRequest[],
  anchorRangeStart: string,
  anchorRangeEnd: string,
) => {
  assertBlockingLeaveExpansionBound(
    leaveRequests,
    anchorRangeStart,
    anchorRangeEnd,
  );
  const intervalsByEmployee = new Map<string, ShiftInterval[]>();
  for (const leave of leaveRequests) {
    const intervals = toBlockingLeaveIntervals(
      leave,
      anchorRangeStart,
      anchorRangeEnd,
    );
    if (!intervals.length) continue;
    const current = intervalsByEmployee.get(leave.employeeProfileId) || [];
    current.push(...intervals);
    intervalsByEmployee.set(leave.employeeProfileId, current);
  }
  for (const [employeeId, intervals] of intervalsByEmployee) {
    intervalsByEmployee.set(employeeId, mergeIntervals(intervals));
  }
  return intervalsByEmployee;
};

const requireWorkShiftTime = (value: unknown): string => {
  const time = normalizeWorkShiftTime(value);
  if (!time) throw new BadRequestException(WORK_SHIFT_TIME_MESSAGE);
  return time;
};

/** Trimmed shift name; 400 when blank or longer than the DTO limit. */
const requireWorkShiftName = (value: unknown): string => {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || !normalizeActiveShiftName(name)) {
    throw new BadRequestException('Tên ca là bắt buộc');
  }
  if (name.length > WORK_SHIFT_NAME_MAX_LENGTH) {
    throw new BadRequestException(
      `Tên ca tối đa ${WORK_SHIFT_NAME_MAX_LENGTH} ký tự`,
    );
  }
  return name;
};

/**
 * Assignment states that hold a seat on a not-yet-started slot. A slot with
 * one of these blocks deleting its shift; only CANCELLED rows do not.
 */
const SEAT_HOLDING_ASSIGNMENT_STATUSES: readonly ShiftAssignmentStatus[] = [
  ShiftAssignmentStatus.PENDING,
  ShiftAssignmentStatus.APPROVED,
  ShiftAssignmentStatus.CONFIRMED,
  ShiftAssignmentStatus.COMPLETED,
];

const assertUniqueActiveShiftNames = (
  shifts: Array<{ shiftName: string; isActive?: boolean }>,
) => {
  const activeNames = shifts
    .filter((shift) => shift.isActive !== false)
    .map((shift) => normalizeActiveShiftName(shift.shiftName));
  if (activeNames.some((name) => !name)) {
    throw new BadRequestException('Tên ca là bắt buộc');
  }
  if (new Set(activeNames).size !== activeNames.length) {
    throw new BadRequestException('Ca làm việc với tên này đã tồn tại');
  }
};

/**
 * Notes written on assignments the owner (or the system on the owner's
 * behalf) created. Used to keep them out of the staff's "Huỷ ca sắp tới".
 */
const OWNER_ASSIGNMENT_NOTES = [
  'Owner assigned during shift creation',
  'Auto-assigned from cycle',
] as const;

/**
 * StoresSchedulingPart: scheduling methods of StoresService, split out of stores.service.ts.
 * They still live on StoresService.prototype (applyClassParts), so DI, callers
 * and routes are unchanged; `this` is the StoresService instance.
 */
export class StoresSchedulingPart {
  async updateEmployeeReminderSettings(
    this: StoresService,
    profileId: string,
    settings: any,
  ) {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
    });

    if (!profile) {
      throw new NotFoundException('Không tìm thấy nhân viên');
    }

    // Gộp với cài đặt đang có: nút chuông ngoài lịch chỉ gửi { type }, và
    // trước đây ghi đè làm mất rung, nhắc chưa check-in, công tắc ca mới…
    profile.reminderSettings = {
      ...(profile.reminderSettings || {}),
      ...(settings || {}),
    };
    // Released staff builds choose "Nhắc cố định" by sending `fixedTime` with
    // `custom: undefined`, which JSON drops, so a stale relative `custom`
    // survived the merge and kept winning. A fixed time sent without a
    // `custom` key clears it.
    if (
      settings &&
      typeof settings === 'object' &&
      settings.fixedTime &&
      !('custom' in settings)
    ) {
      profile.reminderSettings.custom = null;
    }
    settings = profile.reminderSettings;
    await this.profileRepository.save(profile);

    // Fetch upcoming shifts to reschedule reminders
    const upcomingShifts = await this.shiftAssignmentRepository.find({
      where: {
        employeeId: profileId,
        status: ShiftAssignmentStatus.APPROVED,
      },
      relations: ['shiftSlot', 'shiftSlot.workShift'],
    });

    // Filter out past shifts in memory
    const futureShifts = upcomingShifts.filter((s) => {
      const dateStr = s.shiftSlot?.workDate;
      const timeStr =
        s.shiftSlot?.startTime || s.shiftSlot?.workShift?.startTime;
      if (dateStr && timeStr) {
        return parseVietnamShiftStart(dateStr, timeStr).getTime() > Date.now();
      }
      return false;
    });

    try {
      await this.shiftReminderService.syncEmployeeReminders(
        profileId,
        profile.storeId,
        settings,
        futureShifts,
      );
    } catch {
      this.logger.error('Failed to synchronize employee shift reminders');
    }

    return { success: true, reminderSettings: settings };
  }

  async scheduleReminderForAssignment(
    this: StoresService,
    assignmentId: string,
  ) {
    return this.shiftReminderService.scheduleAssignmentReminder(assignmentId);
  }

  /**
   * Keeps an assignment's reminder in step with its status after the change
   * commits: approving schedules it, cancelling an approved one removes it.
   * Queue failures are logged, never surfaced; the status change stands.
   */
  /**
   * Nghỉ có phép (đơn nghỉ cả ngày đã duyệt): huỷ nhắc vào ca cho các ca sắp
   * tới trong khoảng nghỉ. Bộ xử lý nhắc ca cũng tự bỏ qua ngày nghỉ, nên đây
   * chỉ là dọn hàng đợi sớm. Chỉ xét ca từ hôm nay (giờ VN), tối đa 500 ca.
   */
  async cancelRemindersCoveredByLeave(
    this: StoresService,
    leave: Pick<
      EmployeeLeaveRequest,
      | 'employeeProfileId'
      | 'type'
      | 'startDate'
      | 'endDate'
      | 'startTime'
      | 'endTime'
      | 'shiftAssignmentId'
    >,
  ): Promise<void> {
    if (!AUTHORIZED_ABSENCE_LEAVE_TYPES.includes(leave.type)) return;
    const today = vnDateString();
    const from = String(leave.startDate).slice(0, 10);
    const to = String(leave.endDate).slice(0, 10);
    const qb = this.shiftAssignmentRepository
      .createQueryBuilder('sa')
      .innerJoin('sa.shiftSlot', 'slot')
      .select('sa.id', 'id')
      .where('sa.employeeId = :employeeId', {
        employeeId: leave.employeeProfileId,
      })
      .andWhere('sa.status = :status', {
        status: ShiftAssignmentStatus.APPROVED,
      })
      .andWhere('slot.workDate >= :from', { from: from > today ? from : today })
      .andWhere('slot.workDate <= :to', { to })
      .limit(500);
    // Đơn nghỉ theo giờ — và đơn nghỉ đột xuất gắn ca — chỉ phủ đúng ca nó
    // gắn (như leave-coverage.utils), không phải mọi ca trong ngày.
    if (leave.type === LeaveType.SUDDEN && leave.shiftAssignmentId) {
      qb.andWhere('sa.id = :assignmentId', {
        assignmentId: leave.shiftAssignmentId,
      });
    } else if (leave.startTime && leave.endTime) {
      if (!leave.shiftAssignmentId) return;
      qb.andWhere('sa.id = :assignmentId', {
        assignmentId: leave.shiftAssignmentId,
      });
    }
    const rows = await qb.getRawMany<{ id: string }>();
    if (!rows.length) return;
    await this.shiftReminderService.cancelAssignmentReminders(
      rows.map((row) => row.id),
    );
  }

  async syncReminderAfterAssignmentStatusChange(
    this: StoresService,
    assignmentId: string,
    previous: ShiftAssignmentStatus,
    next: ShiftAssignmentStatus,
  ): Promise<void> {
    try {
      if (next === ShiftAssignmentStatus.APPROVED) {
        await this.scheduleReminderForAssignment(assignmentId);
      } else if (
        previous === ShiftAssignmentStatus.APPROVED &&
        next === ShiftAssignmentStatus.CANCELLED
      ) {
        await this.shiftReminderService.cancelAssignmentReminders([
          assignmentId,
        ]);
      }
    } catch {
      this.logger.error(
        'Failed to sync assignment reminder after status change',
      );
    }
  }

  // getEmployeeProgression đã chuyển sang CareerLadderService.getProgressionStages.
  // Nó từng dựng thang bằng cách sắp store_employee_types theo `level` rồi nối
  // chuỗi điều kiện từ bốn cột req_*, nên mỗi màn tự mô tả điều kiện một kiểu.

  async getEmployeeScheduleDetails(
    this: StoresService,
    profileId: string,
    month: Date,
    accountId?: string,
  ) {
    if (accountId) {
      await this.assertEmployeeCalendarAccess(profileId, accountId);
    }
    const startDate = new Date(month.getFullYear(), month.getMonth(), 1);
    const endDate = new Date(month.getFullYear(), month.getMonth() + 1, 0);

    // Only the current stint of a rehired employee (staff calendar included).
    const stintProfile = await this.profileRepository.findOne({
      where: { id: profileId },
      select: ['id', 'joinedAt'],
    });
    const floor = stintFloor(stintProfile?.joinedAt);
    const sinceStint = floor ? { createdAt: MoreThanOrEqual(floor) } : {};

    // 1. Get Leave Requests
    const leaveRequests = await this.leaveRequestRepository.find({
      where: {
        employeeProfileId: profileId,
        startDate: Between(vnDateString(startDate), vnDateString(endDate)),
        ...sinceStint,
      },
    });

    // 2. Get Shift Swaps
    const swaps = await this.shiftSwapRepository.find({
      where: [
        { requestedByEmployeeId: profileId, ...sinceStint },
        { toEmployeeId: profileId, ...sinceStint },
      ],
      relations: [
        'fromAssignment',
        'fromAssignment.shiftSlot',
        'requestedByEmployee',
        'toEmployee',
        'toEmployee.account',
      ],
    });

    // 3. Get Assignments (Registered & Confirmed)
    const assignments = await this.shiftAssignmentRepository.find({
      where: {
        employeeId: profileId,
        shiftSlot: {
          workDate: Between(vnDateString(startDate), vnDateString(endDate)),
        },
        ...sinceStint,
      },
      relations: ['shiftSlot', 'shiftSlot.workShift'],
    });

    // --- Build Response ---

    // Part 1: Overview (Calculate directly from assignments in month)
    let totalWorkHours = 0;
    let totalShifts = 0;

    // Only count CONFIRMED or COMPLETED shifts for overview
    const confirmedAssignments = assignments.filter((a) =>
      ['CONFIRMED', 'COMPLETED'].includes(a.status),
    );
    totalShifts = confirmedAssignments.length;

    confirmedAssignments.forEach((assign) => {
      if (assign.shiftSlot?.workShift) {
        const start = new Date(
          `1970-01-01T${assign.shiftSlot.workShift.startTime}Z`,
        );
        const end = new Date(
          `1970-01-01T${assign.shiftSlot.workShift.endTime}Z`,
        );
        const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        totalWorkHours += hours > 0 ? hours : 0;
      }
    });

    // Part 2: Shift Requests (Registers & Swaps)
    const shiftRequests: any[] = [];

    // Map Swaps
    swaps.forEach((swap) => {
      shiftRequests.push({
        id: swap.id,
        type: 'SWAP',
        title: `Đổi ca ngày ${swap.fromAssignment?.shiftSlot?.workDate}`,
        details: `Với ${swap.toEmployee?.account?.fullName || 'N/A'}`,
        status: swap.status,
        requestDate: swap.createdAt,
      });
    });

    // Map Pending Registers
    assignments
      .filter((a) => a.status === ShiftAssignmentStatus.PENDING)
      .forEach((assign) => {
        shiftRequests.push({
          id: assign.id,
          type: 'REGISTER',
          title: `Đăng ký ca ngày ${assign.shiftSlot?.workDate}`,
          details: assign.shiftSlot?.workShift?.shiftName || 'Ca chưa đặt tên',
          status: 'PENDING',
          requestDate: assign.createdAt,
        });
      });

    // Part 3: Leave Requests
    const leaveRequestsDto: any[] = [];
    leaveRequests.forEach((req) => {
      leaveRequestsDto.push({
        id: req.id,
        startDate: req.startDate,
        endDate: req.endDate,
        reason: req.reason,
        status: req.status,
      });
    });

    // Part 4: Calendar (Daily Schedules)
    const scheduleMap = new Map<string, any[]>();
    assignments.forEach((assign) => {
      // Only show relevant statuses in calendar (skip cancelled or rejected)
      if (['CANCELLED', 'REJECTED'].includes(assign.status)) return;

      const dateKey = String(assign.shiftSlot.workDate);
      if (!scheduleMap.has(dateKey)) scheduleMap.set(dateKey, []);

      let status: string = assign.status;

      // Check for late
      if (
        assign.status === ShiftAssignmentStatus.COMPLETED &&
        assign.shiftSlot?.workShift
      ) {
        if (
          assign.checkInTime &&
          new Date(assign.checkInTime) >
            new Date(assign.shiftSlot.workShift.startTime)
        )
          status = 'LATE';
      }

      // Safety check
      if (assign.shiftSlot?.workShift) {
        scheduleMap.get(dateKey)?.push({
          name: assign.shiftSlot.workShift.shiftName,
          startTime: assign.shiftSlot.workShift.startTime,
          endTime: assign.shiftSlot.workShift.endTime,
          status: status,
          note: assign.note,
          color: assign.shiftSlot.workShift.colorCode,
        });
      }
    });

    // Generate Calendar List
    const calendar: any[] = [];
    const days = [
      'Chủ nhật',
      'Thứ 2',
      'Thứ 3',
      'Thứ 4',
      'Thứ 5',
      'Thứ 6',
      'Thứ 7',
    ];

    scheduleMap.forEach((shifts, dateKey) => {
      const date = new Date(dateKey); // Parse YYYY-MM-DD

      // Determine day status
      let dayStatus = 'NORMAL';
      const hasLate = shifts.some((s: any) => s.status === 'LATE');
      const hasUpcoming = shifts.some((s: any) => s.status === 'UPCOMING');

      if (hasLate) dayStatus = 'LATE';
      else if (hasUpcoming) dayStatus = 'UPCOMING';
      else dayStatus = 'COMPLETED';

      calendar.push({
        date: date,
        dayOfWeek: days[date.getDay()],
        day: date.getDate(),
        hasShift: true,
        status: dayStatus,
        shifts: shifts,
      });
    });

    // Sort by date
    calendar.sort((a, b) => a.date.getTime() - b.date.getTime());

    return {
      overview: {
        totalWorkHours: parseFloat(totalWorkHours.toFixed(1)),
        totalShifts: totalShifts,
      },
      shiftRequests: shiftRequests.sort(
        (a, b) => b.requestDate.getTime() - a.requestDate.getTime(),
      ),
      leaveRequests: leaveRequestsDto,
      calendar: calendar,
    };
  }

  // Work Shift management
  async createWorkShift(
    this: StoresService,
    storeId: string,
    data: CreateWorkShiftDto | Partial<WorkShift>,
    ownerAccountId?: string,
  ) {
    if (!data?.shiftName?.trim() || !data.startTime || !data.endTime) {
      throw new BadRequestException('Tên ca và thời gian là bắt buộc');
    }
    const shiftName = requireWorkShiftName(data.shiftName);
    const shiftStartTime = requireWorkShiftTime(data.startTime);
    const shiftEndTime = requireWorkShiftTime(data.endTime);
    // A start after the end is an overnight shift; only equal times are wrong.
    if (sameShiftTime(shiftStartTime, shiftEndTime)) {
      throw new BadRequestException(
        'Giờ bắt đầu và giờ kết thúc không được trùng nhau',
      );
    }
    if (!ownerAccountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    return this.dataSource.transaction(async (manager) => {
      await lockStoreShiftAvailability(manager, storeId);
      const store = await manager.findOne(Store, { where: { id: storeId } });
      if (!store) throw new NotFoundException('Cửa hàng không tồn tại');
      if (!ownerAccountId || store.ownerAccountId !== ownerAccountId) {
        throw new ForbiddenException(
          'Bạn không có quyền tạo ca cho cửa hàng này',
        );
      }
      // The same-name rule ("same name only on different days") needs work
      // dates; a new template has none, so no name can clash yet.
      const shift = manager.create(WorkShift, {
        storeId,
        shiftName,
        startTime: shiftStartTime,
        endTime: shiftEndTime,
        defaultMaxStaff: data.defaultMaxStaff ?? null,
        colorCode: data.colorCode ?? '#21D4D4',
        note: data.note ?? null,
        location: data.location ?? null,
        isActive: true,
      });
      return manager.save(WorkShift, shift);
    });
  }

  /**
   * The store's shift templates as the settings screen and the shift pickers
   * list them: active only, without the per-date shifts an approved
   * "Khung giờ khác" request created (those belong to one employee and day).
   */
  async getWorkShifts(this: StoresService, storeId: string) {
    return this.listSettingsWorkShifts(storeId);
  }

  async listSettingsWorkShifts(
    this: StoresService,
    storeId: string,
    manager?: EntityManager,
  ): Promise<WorkShift[]> {
    const options = {
      where: { storeId, isActive: true },
      order: { startTime: 'ASC' as const, shiftName: 'ASC' as const },
    };
    const shifts = manager
      ? await manager.find(WorkShift, options)
      : await this.workShiftRepository.find(options);
    const active = (shifts ?? []).filter((shift) => shift.isActive !== false);
    if (!active.length) return [];
    const customIds = await this.findCustomRequestShiftIds(
      manager ?? this.workShiftRepository,
      storeId,
    );
    return active.filter((shift) => !customIds.has(shift.id));
  }

  /**
   * Active shifts of the store created by an approved custom shift request:
   * listed in a request's `created_schedule_ref.shiftIds`, or carrying the
   * request note (rows created before the ref existed).
   */
  async findCustomRequestShiftIds(
    this: StoresService,
    runner: Pick<EntityManager, 'query'>,
    storeId: string,
  ): Promise<Set<string>> {
    const rows: Array<{ id?: unknown }> = await runner.query(
      `SELECT ws.id
         FROM work_shifts ws
        WHERE ws.store_id = $1
          AND ws.is_active = true
          AND (
            ws.note = $2
            OR EXISTS (
              SELECT 1
                FROM custom_shift_requests csr
               WHERE csr.store_id = ws.store_id
                 AND csr.created_schedule_ref -> 'shiftIds'
                     @> jsonb_build_array(ws.id::text)
            )
          )`,
      [storeId, CUSTOM_SHIFT_NOTE],
    );
    return new Set(
      (Array.isArray(rows) ? rows : [])
        .map((row) => row?.id)
        .filter((id): id is string => typeof id === 'string'),
    );
  }

  normalizeShiftRecurrence(
    this: StoresService,
    data: Pick<
      CreateShiftScheduleDto,
      'startDate' | 'startTime' | 'endTime' | 'recurrence'
    >,
  ): ShiftRecurrenceRule {
    if (!data.startDate || !data.recurrence) {
      throw new BadRequestException('Ngày áp dụng và quy tắc lặp là bắt buộc');
    }
    parseDateOnly(data.startDate);

    if (data.startDate < getTodayDateString()) {
      throw new BadRequestException('Ngày áp dụng không được ở trong quá khứ');
    }

    if (data.startTime && data.endTime && data.startTime === data.endTime) {
      throw new BadRequestException(
        'Giờ bắt đầu và giờ kết thúc không được trùng nhau',
      );
    }

    if (!data.recurrence.enabled) {
      return {
        enabled: false,
        frequency: ShiftRecurrenceFrequency.DAILY,
        interval: 1,
        endType: ShiftRecurrenceEndType.COUNT,
        occurrenceCount: 1,
      };
    }

    const recurrence: ShiftRecurrenceRule = {
      enabled: true,
      frequency: data.recurrence.frequency,
      interval: data.recurrence.interval,
      endType: data.recurrence.endType,
    };

    if (recurrence.frequency === ShiftRecurrenceFrequency.WEEKLY) {
      if (!data.recurrence.weekDays?.length) {
        throw new BadRequestException(
          'Vui lòng chọn ít nhất một thứ trong tuần',
        );
      }
      recurrence.weekDays = data.recurrence.weekDays;
    }

    if (recurrence.frequency === ShiftRecurrenceFrequency.MONTHLY) {
      if (!data.recurrence.monthlyMode) {
        throw new BadRequestException('Vui lòng chọn cách lặp theo tháng');
      }
      recurrence.monthlyMode = data.recurrence.monthlyMode;

      if (recurrence.monthlyMode === ShiftMonthlyMode.DAY_OF_MONTH) {
        if (!data.recurrence.dayOfMonth) {
          throw new BadRequestException('Vui lòng chọn ngày lặp trong tháng');
        }
        recurrence.dayOfMonth = data.recurrence.dayOfMonth;
      } else {
        if (!data.recurrence.weekOfMonth || !data.recurrence.weekday) {
          throw new BadRequestException(
            'Vui lòng chọn thứ và tuần lặp trong tháng',
          );
        }
        recurrence.weekOfMonth = data.recurrence.weekOfMonth;
        recurrence.weekday = data.recurrence.weekday;
      }
    }

    if (recurrence.endType === ShiftRecurrenceEndType.UNTIL) {
      if (!data.recurrence.endDate) {
        throw new BadRequestException('Vui lòng chọn ngày kết thúc');
      }
      parseDateOnly(data.recurrence.endDate);
      if (data.recurrence.endDate < data.startDate) {
        throw new BadRequestException(
          'Ngày kết thúc phải từ ngày áp dụng trở đi',
        );
      }
      recurrence.endDate = data.recurrence.endDate;
    }

    if (recurrence.endType === ShiftRecurrenceEndType.COUNT) {
      if (!data.recurrence.occurrenceCount) {
        throw new BadRequestException('Vui lòng nhập số lần lặp');
      }
      recurrence.occurrenceCount = data.recurrence.occurrenceCount;
    }

    return recurrence;
  }

  async getShiftEmployeeOptions(
    this: StoresService,
    storeId: string,
    ownerAccountId: string,
    data: ShiftEmployeeOptionsDto,
  ) {
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      select: ['id', 'ownerAccountId'],
    });
    if (!store) throw new NotFoundException('Không tìm thấy cửa hàng');
    if (store.ownerAccountId !== ownerAccountId) {
      throw new ForbiddenException(
        'Bạn không có quyền xem lịch nhân viên của cửa hàng này',
      );
    }

    const recurrenceRule = this.normalizeShiftRecurrence(data);
    const workDates = generateShiftScheduleDates(
      data.startDate,
      recurrenceRule,
    );
    const proposedIntervals = workDates.map((workDate) =>
      toShiftInterval(workDate, data.startTime, data.endTime),
    );
    const workDateSet = new Set(workDates);

    const employees = await this.profileRepository.find({
      where: {
        storeId,
        employmentStatus: In([...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]),
      },
      relations: ['account', 'storeRole', 'employeeType'],
    });
    if (employees.length === 0) {
      return {
        workDates,
        summary: {
          total: 0,
          available: 0,
          otherShift: 0,
          conflict: 0,
          onLeave: 0,
        },
        employees: [],
      };
    }

    const employeeIds = employees.map((employee) => employee.id);
    const rangeStart = addDays(workDates[0], -1);
    const rangeEnd = addDays(workDates[workDates.length - 1], 1);

    const assignments = await this.shiftAssignmentRepository
      .createQueryBuilder('assignment')
      .leftJoinAndSelect('assignment.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.workShift', 'workShift')
      .leftJoinAndSelect('slot.cycle', 'cycle')
      .where('assignment.employeeId IN (:...employeeIds)', { employeeIds })
      .andWhere('assignment.status != :cancelledStatus', {
        cancelledStatus: ShiftAssignmentStatus.CANCELLED,
      })
      .andWhere('cycle.status = :activeCycleStatus', {
        activeCycleStatus: WorkCycleStatus.ACTIVE,
      })
      .andWhere('slot.workDate BETWEEN :rangeStart AND :rangeEnd', {
        rangeStart,
        rangeEnd,
      })
      .getMany();

    const leaveRequests = await this.leaveRequestRepository
      .createQueryBuilder('leave')
      .where('leave.storeId = :storeId', { storeId })
      .andWhere('leave.employeeProfileId IN (:...employeeIds)', {
        employeeIds,
      })
      .andWhere('leave.status = :approvedStatus', {
        approvedStatus: LeaveRequestStatus.APPROVED,
      })
      .andWhere('leave.type IN (:...blockingLeaveTypes)', {
        blockingLeaveTypes: BLOCKING_LEAVE_TYPE_VALUES,
      })
      .andWhere('leave.startDate <= :rangeEnd', { rangeEnd })
      .andWhere('leave.endDate >= :rangeStart', { rangeStart })
      .take(MAX_BLOCKING_LEAVE_ROWS + 1)
      .getMany();

    const assignmentIntervalsByEmployee = new Map<string, ShiftInterval[]>();
    const assignmentDatesByEmployee = new Map<string, Set<string>>();
    // Additive (O4a): the saved shifts behind OTHER_SHIFT / CONFLICT, so the
    // owner app can say which shift an employee is already booked for.
    const otherShiftsByEmployee = new Map<string, ShiftEmployeeOtherShift[]>();
    for (const assignment of assignments) {
      const slot = assignment.shiftSlot;
      if (slot?.workDate) {
        const dates =
          assignmentDatesByEmployee.get(assignment.employeeId) || new Set();
        dates.add(slot.workDate);
        assignmentDatesByEmployee.set(assignment.employeeId, dates);
      }
      const assignmentStart = slot?.startTime || slot?.workShift?.startTime;
      const assignmentEnd = slot?.endTime || slot?.workShift?.endTime;
      if (!slot?.workDate || !assignmentStart || !assignmentEnd) continue;
      const interval = toShiftInterval(
        slot.workDate,
        assignmentStart,
        assignmentEnd,
      );
      const intervals =
        assignmentIntervalsByEmployee.get(assignment.employeeId) || [];
      intervals.push(interval);
      assignmentIntervalsByEmployee.set(assignment.employeeId, intervals);

      // Same-day shifts are listed; an adjacent-day (±1) shift only when it
      // actually overlaps, i.e. an overnight shift crossing into the date.
      const overlaps = proposedIntervals.some((proposed) =>
        intervalsOverlap(proposed, interval),
      );
      if (!overlaps && !workDateSet.has(slot.workDate)) continue;
      const others = otherShiftsByEmployee.get(assignment.employeeId) || [];
      others.push({
        shiftName: slot.workShift?.shiftName || 'Ca làm',
        workDate: slot.workDate,
        startTime: toHHmm(assignmentStart),
        endTime: toHHmm(assignmentEnd),
        overlaps,
      });
      otherShiftsByEmployee.set(assignment.employeeId, others);
    }
    const leaveIntervalsByEmployee = groupBlockingLeaveIntervals(
      leaveRequests,
      rangeStart,
      rangeEnd,
    );

    const statusLabels: Record<ShiftEmployeeAvailability, string> = {
      AVAILABLE: 'Rảnh',
      OTHER_SHIFT: 'Đang làm ca khác',
      CONFLICT: 'Trùng ca',
      ON_LEAVE: 'Nghỉ phép',
    };

    const options = employees
      .map((employee) => {
        const hasBlockingLeave = intervalSetsOverlap(
          [...proposedIntervals],
          leaveIntervalsByEmployee.get(employee.id) || [],
        );
        const hasConflict = intervalSetsOverlap(
          [...proposedIntervals],
          assignmentIntervalsByEmployee.get(employee.id) || [],
        );
        const hasOtherShift = [
          ...(assignmentDatesByEmployee.get(employee.id) || []),
        ].some((assignmentDate) => workDateSet.has(assignmentDate));

        const availability: ShiftEmployeeAvailability = hasBlockingLeave
          ? 'ON_LEAVE'
          : hasConflict
            ? 'CONFLICT'
            : hasOtherShift
              ? 'OTHER_SHIFT'
              : 'AVAILABLE';

        return {
          id: employee.id,
          name: employee.account?.fullName || 'Nhân viên',
          avatarUrl: employee.account?.avatar || null,
          position: employee.storeRole?.name || null,
          employmentType: employee.employeeType?.name || null,
          availability,
          statusLabel: statusLabels[availability],
          selectable:
            availability === 'AVAILABLE' || availability === 'OTHER_SHIFT',
          otherShifts: (otherShiftsByEmployee.get(employee.id) || []).sort(
            (left, right) =>
              left.workDate.localeCompare(right.workDate) ||
              left.startTime.localeCompare(right.startTime),
          ),
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'vi'));

    return {
      workDates,
      summary: {
        total: options.length,
        available: options.filter((item) => item.availability === 'AVAILABLE')
          .length,
        otherShift: options.filter(
          (item) => item.availability === 'OTHER_SHIFT',
        ).length,
        conflict: options.filter((item) => item.availability === 'CONFLICT')
          .length,
        onLeave: options.filter((item) => item.availability === 'ON_LEAVE')
          .length,
      },
      employees: options,
    };
  }

  async assertShiftScheduleAvailabilityAtCommit(
    this: StoresService,
    manager: EntityManager,
    storeId: string,
    drafts: NormalizedShiftDraft[],
    workDates: string[],
  ): Promise<void> {
    const employeeIds = [
      ...new Set(drafts.flatMap((draft) => draft.employeeIds)),
    ];
    if (!employeeIds.length) return;

    const employees = await manager.find(EmployeeProfile, {
      where: {
        id: In(employeeIds),
        storeId,
        employmentStatus: In([...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]),
      },
      select: ['id', 'storeId', 'employmentStatus'],
    });
    if (employees.length !== employeeIds.length) {
      throw new BadRequestException(
        'Một hoặc nhiều nhân viên không còn hoạt động tại cửa hàng này',
      );
    }

    const rangeStart = addDays(workDates[0], -1);
    const rangeEnd = addDays(workDates[workDates.length - 1], 1);
    const assignments = await manager
      .createQueryBuilder(ShiftAssignment, 'assignment')
      .leftJoinAndSelect('assignment.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.workShift', 'workShift')
      .leftJoinAndSelect('slot.cycle', 'cycle')
      .where('assignment.employeeId IN (:...employeeIds)', { employeeIds })
      .andWhere('assignment.status != :cancelledStatus', {
        cancelledStatus: ShiftAssignmentStatus.CANCELLED,
      })
      .andWhere('cycle.storeId = :storeId', { storeId })
      .andWhere('cycle.status = :activeCycleStatus', {
        activeCycleStatus: WorkCycleStatus.ACTIVE,
      })
      .andWhere('slot.workDate BETWEEN :rangeStart AND :rangeEnd', {
        rangeStart,
        rangeEnd,
      })
      .getMany();
    const leaveRequests = await manager
      .createQueryBuilder(EmployeeLeaveRequest, 'leave')
      .where('leave.storeId = :storeId', { storeId })
      .andWhere('leave.employeeProfileId IN (:...employeeIds)', {
        employeeIds,
      })
      .andWhere('leave.status = :approvedStatus', {
        approvedStatus: LeaveRequestStatus.APPROVED,
      })
      .andWhere('leave.type IN (:...blockingLeaveTypes)', {
        blockingLeaveTypes: BLOCKING_LEAVE_TYPE_VALUES,
      })
      .andWhere('leave.startDate <= :rangeEnd', { rangeEnd })
      .andWhere('leave.endDate >= :rangeStart', { rangeStart })
      .take(MAX_BLOCKING_LEAVE_ROWS + 1)
      .getMany();

    const assignmentIntervalsByEmployee = new Map<string, ShiftInterval[]>();
    for (const assignment of assignments) {
      const slot = assignment.shiftSlot;
      const assignmentStart = slot?.startTime || slot?.workShift?.startTime;
      const assignmentEnd = slot?.endTime || slot?.workShift?.endTime;
      if (!slot?.workDate || !assignmentStart || !assignmentEnd) continue;
      const current =
        assignmentIntervalsByEmployee.get(assignment.employeeId) || [];
      current.push(
        toShiftInterval(slot.workDate, assignmentStart, assignmentEnd),
      );
      assignmentIntervalsByEmployee.set(assignment.employeeId, current);
    }
    const leaveIntervalsByEmployee = groupBlockingLeaveIntervals(
      leaveRequests,
      rangeStart,
      rangeEnd,
    );
    const proposedByEmployee = new Map<string, ShiftInterval[]>();
    for (const draft of drafts) {
      for (const employeeId of draft.employeeIds) {
        for (const workDate of workDates) {
          const current = proposedByEmployee.get(employeeId) || [];
          current.push(
            toShiftInterval(workDate, draft.startTime, draft.endTime),
          );
          proposedByEmployee.set(employeeId, current);
        }
      }
    }
    for (const employeeId of employeeIds) {
      const proposed = proposedByEmployee.get(employeeId) || [];
      const assignmentConflict = intervalSetsOverlap(
        [...proposed],
        assignmentIntervalsByEmployee.get(employeeId) || [],
      );
      const leaveConflict = intervalSetsOverlap(
        [...proposed],
        leaveIntervalsByEmployee.get(employeeId) || [],
      );
      if (assignmentConflict) {
        throw new BadRequestException(
          'Một hoặc nhiều nhân viên bị trùng với ca làm việc đang hoạt động',
        );
      }
      if (leaveConflict) {
        throw new BadRequestException(
          'Một hoặc nhiều nhân viên có lịch nghỉ được duyệt trùng với ca làm việc',
        );
      }
    }
  }

  /**
   * Per-date conflicts of one employee against a proposed `startTime`–`endTime`
   * on each of `workDates` (end <= start = overnight): a non-cancelled
   * assignment in an active cycle of the store, or approved blocking leave.
   * Same data and interval rules as `assertShiftScheduleAvailabilityAtCommit`,
   * but reports which dates conflict so the caller can answer 409 with
   * details. Run it inside the transaction that holds the store's shift
   * availability lock.
   */
  async findEmployeeShiftConflicts(
    this: StoresService,
    manager: EntityManager,
    storeId: string,
    employeeId: string,
    workDates: string[],
    startTime: string,
    endTime: string,
  ): Promise<Array<{ date: string; reason: 'SHIFT' | 'LEAVE' }>> {
    if (!workDates.length) return [];
    const sorted = [...workDates].sort();
    const rangeStart = addDays(sorted[0], -1);
    const rangeEnd = addDays(sorted[sorted.length - 1], 1);
    const assignments = await manager
      .createQueryBuilder(ShiftAssignment, 'assignment')
      .leftJoinAndSelect('assignment.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.workShift', 'workShift')
      .leftJoinAndSelect('slot.cycle', 'cycle')
      .where('assignment.employeeId = :employeeId', { employeeId })
      .andWhere('assignment.status != :cancelledStatus', {
        cancelledStatus: ShiftAssignmentStatus.CANCELLED,
      })
      .andWhere('cycle.storeId = :storeId', { storeId })
      .andWhere('cycle.status = :activeCycleStatus', {
        activeCycleStatus: WorkCycleStatus.ACTIVE,
      })
      .andWhere('slot.workDate BETWEEN :rangeStart AND :rangeEnd', {
        rangeStart,
        rangeEnd,
      })
      .getMany();
    const leaveRequests = await manager
      .createQueryBuilder(EmployeeLeaveRequest, 'leave')
      .where('leave.storeId = :storeId', { storeId })
      .andWhere('leave.employeeProfileId = :employeeId', { employeeId })
      .andWhere('leave.status = :approvedStatus', {
        approvedStatus: LeaveRequestStatus.APPROVED,
      })
      .andWhere('leave.type IN (:...blockingLeaveTypes)', {
        blockingLeaveTypes: BLOCKING_LEAVE_TYPE_VALUES,
      })
      .andWhere('leave.startDate <= :rangeEnd', { rangeEnd })
      .andWhere('leave.endDate >= :rangeStart', { rangeStart })
      .take(MAX_BLOCKING_LEAVE_ROWS + 1)
      .getMany();

    const shiftIntervals: ShiftInterval[] = [];
    for (const assignment of assignments) {
      const slot = assignment.shiftSlot;
      const slotStart = slot?.startTime || slot?.workShift?.startTime;
      const slotEnd = slot?.endTime || slot?.workShift?.endTime;
      if (!slot?.workDate || !slotStart || !slotEnd) continue;
      shiftIntervals.push(toShiftInterval(slot.workDate, slotStart, slotEnd));
    }
    const leaveIntervals =
      groupBlockingLeaveIntervals(leaveRequests, rangeStart, rangeEnd).get(
        employeeId,
      ) || [];

    const conflicts: Array<{ date: string; reason: 'SHIFT' | 'LEAVE' }> = [];
    for (const date of sorted) {
      const proposed = toShiftInterval(date, startTime, endTime);
      if (
        shiftIntervals.some((interval) => intervalsOverlap(proposed, interval))
      ) {
        conflicts.push({ date, reason: 'SHIFT' });
      } else if (
        leaveIntervals.some((interval) => intervalsOverlap(proposed, interval))
      ) {
        conflicts.push({ date, reason: 'LEAVE' });
      }
    }
    return conflicts;
  }

  /**
   * Validation and date expansion of a unified shift schedule (no I/O).
   * Shared by `createShiftSchedule` and `createShiftScheduleWithin`.
   */
  planShiftSchedule(this: StoresService, data: CreateShiftScheduleDto) {
    const drafts = data.shifts?.length
      ? data.shifts.map((draft) => ({
          ...draft,
          shiftName: draft.shiftName.trim(),
          employeeIds: draft.employeeIds || [],
          note: draft.note?.trim() || null,
        }))
      : ([
          {
            shiftName: data.shiftName?.trim() || '',
            startTime: data.startTime || '',
            endTime: data.endTime || '',
            maxStaff: data.maxStaff,
            note: data.note?.trim() || null,
            employeeIds: data.employeeIds || [],
          },
        ] as NormalizedShiftDraft[]);
    if (!data.startDate || !data.recurrence) {
      throw new BadRequestException('Ngày áp dụng và quy tắc lặp là bắt buộc');
    }
    if (
      drafts.some(
        (draft) =>
          !draft.shiftName ||
          !draft.startTime ||
          !draft.endTime ||
          !draft.maxStaff ||
          draft.startTime === draft.endTime,
      )
    ) {
      throw new BadRequestException(
        'Mỗi ca phải có tên, giờ bắt đầu, giờ kết thúc khác nhau và số lượng nhân viên',
      );
    }
    if (drafts.some((draft) => draft.employeeIds.length > draft.maxStaff)) {
      throw new BadRequestException(
        'Số nhân viên được chọn không được vượt quá số lượng nhân viên của ca',
      );
    }
    assertUniqueActiveShiftNames(drafts);

    const recurrenceRule = this.normalizeShiftRecurrence(data);
    const workDates = generateShiftScheduleDates(
      data.startDate,
      recurrenceRule,
    );
    if (
      drafts.length > 0 &&
      workDates.length > Math.floor(MAX_GENERATED_SHIFT_SLOTS / drafts.length)
    ) {
      throw new BadRequestException(
        `Lịch này tạo quá ${MAX_GENERATED_SHIFT_SLOTS} ô ca. Vui lòng giảm số ca hoặc số lần lặp.`,
      );
    }
    const assignmentsPerDate = drafts.reduce(
      (total, draft) => total + draft.employeeIds.length,
      0,
    );
    if (
      assignmentsPerDate > 0 &&
      workDates.length >
        Math.floor(MAX_GENERATED_SHIFT_ASSIGNMENTS / assignmentsPerDate)
    ) {
      throw new BadRequestException(
        `Lịch này tạo quá ${MAX_GENERATED_SHIFT_ASSIGNMENTS} lượt phân ca. Vui lòng giảm số nhân viên hoặc số lần lặp.`,
      );
    }

    const employeeIntervals = new Map<string, ShiftInterval[]>();
    for (const draft of drafts) {
      for (const employeeId of draft.employeeIds) {
        const intervals = employeeIntervals.get(employeeId) || [];
        for (const workDate of workDates) {
          intervals.push(
            toShiftInterval(workDate, draft.startTime, draft.endTime),
          );
        }
        employeeIntervals.set(employeeId, intervals);
      }
    }
    for (const intervals of employeeIntervals.values()) {
      if (hasInternalIntervalOverlap(intervals)) {
        throw new BadRequestException(
          'Một nhân viên không thể được xếp vào các ca bị trùng giờ trong cùng chu kỳ',
        );
      }
    }
    const cycleType = !recurrenceRule.enabled
      ? CycleType.DAILY
      : recurrenceRule.endType === ShiftRecurrenceEndType.NEVER
        ? CycleType.INDEFINITE
        : (recurrenceRule.frequency as unknown as CycleType);
    const cycleEndDate =
      recurrenceRule.endType === ShiftRecurrenceEndType.NEVER
        ? null
        : recurrenceRule.endType === ShiftRecurrenceEndType.UNTIL
          ? (recurrenceRule.endDate as string)
          : workDates[workDates.length - 1];

    return {
      drafts,
      recurrenceRule,
      workDates,
      cycleType,
      cycleEndDate,
    };
  }

  /**
   * Persist a planned schedule inside `manager`'s transaction: store lock,
   * owner check, same-name rule, availability at commit, then cycle, shifts,
   * slots and assignments. No post-commit side effects.
   */
  async persistShiftSchedule(
    this: StoresService,
    manager: EntityManager,
    storeId: string,
    ownerAccountId: string,
    data: CreateShiftScheduleDto,
    plan: ReturnType<StoresService['planShiftSchedule']>,
  ) {
    const { drafts, recurrenceRule, workDates, cycleType, cycleEndDate } = plan;
    await lockStoreShiftAvailability(manager, storeId);

    const store = await manager.findOne(Store, {
      where: { id: storeId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!store) {
      throw new NotFoundException('Không tìm thấy cửa hàng');
    }
    if (store.ownerAccountId !== ownerAccountId) {
      throw new ForbiddenException(
        'Bạn không có quyền tạo lịch làm việc cho cửa hàng này',
      );
    }

    const sameNameHit = await findSameNameShiftOnDates(
      manager,
      storeId,
      drafts.map((draft) => draft.shiftName),
      workDates,
    );
    if (sameNameHit) {
      throw new BadRequestException(sameNameShiftMessage(sameNameHit));
    }

    if (drafts.some((draft) => draft.employeeIds.length > 0)) {
      await this.assertShiftScheduleAvailabilityAtCommit(
        manager,
        storeId,
        drafts,
        workDates,
      );
    }

    const cycle = manager.create(WorkCycle, {
      storeId,
      name: drafts[0].shiftName,
      cycleType,
      startDate: data.startDate,
      endDate: cycleEndDate,
      status: WorkCycleStatus.ACTIVE,
      workShiftId: null,
      recurrenceRule,
    });
    const savedCycle = await manager.save(WorkCycle, cycle);
    const savedShifts: WorkShift[] = [];
    const allSlots: ShiftSlot[] = [];
    const allAssignments: ShiftAssignment[] = [];
    for (const draft of drafts) {
      const savedShift = await manager.save(
        WorkShift,
        manager.create(WorkShift, {
          storeId,
          shiftName: draft.shiftName,
          startTime: draft.startTime,
          endTime: draft.endTime,
          defaultMaxStaff: draft.maxStaff,
          colorCode: '#21D4D4',
          note: draft.note,
          isActive: true,
        }),
      );
      savedShifts.push(savedShift);
      const slots = workDates.map((workDate) =>
        manager.create(ShiftSlot, {
          cycleId: savedCycle.id,
          workShiftId: savedShift.id,
          workDate,
          startTime: draft.startTime,
          endTime: draft.endTime,
          maxStaff: draft.maxStaff,
          note: draft.note,
          dayOfWeek: getWeekDayForDate(workDate),
        }),
      );
      await manager.save(ShiftSlot, slots, { chunk: 500 });
      allSlots.push(...slots);
      const assignments = draft.employeeIds.flatMap((employeeId) =>
        slots.map((slot) =>
          manager.create(ShiftAssignment, {
            shiftSlotId: slot.id,
            employeeId,
            status: ShiftAssignmentStatus.APPROVED,
            note: 'Owner assigned during shift creation',
          }),
        ),
      );
      if (assignments.length)
        await manager.save(ShiftAssignment, assignments, { chunk: 500 });
      allAssignments.push(...assignments);
    }
    await manager.update(WorkCycle, savedCycle.id, {
      workShiftId: savedShifts[0].id,
    });

    return {
      id: savedCycle.id,
      storeId,
      status: savedCycle.status,
      shift: savedShifts[0],
      shifts: savedShifts,
      recurrence: recurrenceRule,
      generatedSlotCount: allSlots.length,
      assignedEmployeeCount: drafts.reduce(
        (sum, draft) => sum + draft.employeeIds.length,
        0,
      ),
      generatedAssignmentCount: allAssignments.length,
      assignmentIds: allAssignments.map((assignment) => assignment.id),
      firstWorkDate: workDates[0],
      lastGeneratedWorkDate: workDates[workDates.length - 1],
    };
  }

  async createShiftSchedule(
    this: StoresService,
    storeId: string,
    ownerAccountId: string,
    data: CreateShiftScheduleDto,
  ) {
    await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    const plan = this.planShiftSchedule(data);
    const { drafts, workDates } = plan;
    assertShiftsStartAhead(drafts, workDates[0], new Date());

    let result: Awaited<ReturnType<StoresService['persistShiftSchedule']>>;
    try {
      result = await this.dataSource.transaction((manager) =>
        this.persistShiftSchedule(manager, storeId, ownerAccountId, data, plan),
      );
    } catch (error: any) {
      // Only the one-active-cycle index means "already has an active cycle";
      // any other unique violation is a real error and is rethrown.
      if (isOneActiveCycleViolation(error)) {
        throw new BadRequestException('Cửa hàng đã có chu kỳ đang hoạt động');
      }
      throw error;
    }

    const { assignmentIds, ...publicResult } = result;
    if (assignmentIds.length) {
      void this.shiftReminderService
        .scheduleAssignmentReminders(assignmentIds)
        .catch(() => {
          this.logger.error(
            'Failed to schedule reminders for newly created shift schedule',
          );
        });
      void this.notifyEmployeesOfNewShifts(assignmentIds, 'assigned');
    }
    const announcement = selectCreatedShiftAnnouncement(drafts, workDates);
    void this.notifyEmployeesOfCreatedShifts(
      storeId,
      announcement.shifts,
      announcement.excludeProfileIds,
    );

    return publicResult;
  }

  /**
   * `createShiftSchedule` inside the caller's transaction (X5 custom shift
   * request approval): the same validation, locks, same-name rule,
   * availability-at-commit check and writes, so every invariant of the
   * unified path holds. The caller owns the transaction and must call
   * `scheduleRemindersForNewAssignments` for the returned assignments once
   * committed.
   */
  async createShiftScheduleWithin(
    this: StoresService,
    manager: EntityManager,
    storeId: string,
    ownerAccountId: string,
    data: CreateShiftScheduleDto,
  ) {
    const plan = this.planShiftSchedule(data);
    return this.persistShiftSchedule(
      manager,
      storeId,
      ownerAccountId,
      data,
      plan,
    );
  }

  /** Post-commit reminders for assignments created by `createShiftScheduleWithin`. */
  scheduleRemindersForNewAssignments(
    this: StoresService,
    assignmentIds: string[],
  ): void {
    if (!assignmentIds.length) return;
    void this.shiftReminderService
      .scheduleAssignmentReminders(assignmentIds)
      .catch(() => {
        this.logger.error(
          'Failed to schedule reminders for newly created shift schedule',
        );
      });
  }

  /**
   * Báo cho nhân viên của cửa hàng khi chủ vừa mở ca mới còn chỗ, để họ vào
   * đăng ký. Chỉ gửi cho người đang làm và bật công tắc ở màn Nhắc tôi. Gửi
   * sau commit, best effort: lỗi không được làm hỏng việc tạo lịch.
   */
  async notifyEmployeesOfCreatedShifts(
    this: StoresService,
    storeId: string,
    shifts: AnnouncedShift[],
    excludeProfileIds: string[] = [],
  ): Promise<void> {
    // Shifts that already started or passed cannot be registered any more.
    const now = new Date();
    const openShifts = shifts.filter(
      (shift) => !isSlotRegistrationClosed(shift, null, now),
    );
    if (!openShifts.length) {
      if (shifts.length) {
        this.logger.debug(
          `[notifyEmployeesOfCreatedShifts] store=${storeId} openShifts=0 closedShifts=${shifts.length}`,
        );
      }
      return;
    }
    try {
      // Only people who can register (ACTIVE, PROBATION) are told.
      const employees = await this.profileRepository.find({
        where: {
          storeId,
          employmentStatus: In([...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]),
        },
        select: ['id', 'accountId', 'reminderSettings'],
      });
      const excluded = new Set(excludeProfileIds);
      const candidates = employees.filter(
        (employee) => !!employee.accountId && !excluded.has(employee.id),
      );
      const wanting = candidates.filter((employee) =>
        shouldNotifyNewShifts(employee.reminderSettings),
      );
      const optedOut = candidates.length - wanting.length;
      // Each person is told only about the shifts they do not already hold.
      // One notice per account.
      const byAccount = new Map<string, AnnouncedShift[]>();
      for (const employee of wanting) {
        const own = shiftsOpenTo(employee.id, openShifts);
        if (own.length && !byAccount.has(employee.accountId as string)) {
          byAccount.set(employee.accountId as string, own);
        }
      }
      const recipients = [...byAccount.keys()];
      let sent = 0;
      for (const accountId of recipients) {
        const own = byAccount.get(accountId) as AnnouncedShift[];
        const { title, content } = buildShiftNotification('created', own);
        try {
          await this.notificationsService.create(
            {
              accountId,
              storeId,
              title,
              content,
              type: NotificationType.SYSTEM,
              priority: NotificationPriority.NORMAL,
              // Mở thẳng lịch làm việc, nơi nhân viên đăng ký ca.
              actionUrl: '/(home)/workshift',
              metadata: {
                type: 'SHIFT_CREATED',
                storeId,
                ...shiftNotificationDateMetadata(own),
              },
            },
            // Not a shift alert: the channel every app build creates.
            { channelId: DEFAULT_ANDROID_CHANNEL },
          );
          sent++;
        } catch (error) {
          this.logger.warn(
            `[notifyEmployeesOfCreatedShifts] could not notify an employee of store ${storeId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      // Counts only: no account ids, names or content.
      this.logger.log(
        `[notifyEmployeesOfCreatedShifts] store=${storeId} openShifts=${openShifts.length} recipients=${sent}/${recipients.length} employees=${employees.length} excluded=${employees.length - candidates.length} optedOut=${optedOut}`,
      );
    } catch (error) {
      this.logger.warn(
        `[notifyEmployeesOfCreatedShifts] could not load employees of store ${storeId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * After commit, best effort: when an existing slot of an active cycle just
   * gained a free seat (the owner raised `maxStaff` or cancelled someone) and
   * has not started (VN time), tell the store's other eligible staff "Có ca
   * mới để đăng ký". Seat holders and `excludeProfileIds` (e.g. the person
   * just removed) are not told. A slot is announced at most once per
   * throttle window. Logs counts only.
   */
  async announceFreeSeatsOfSlot(
    this: StoresService,
    slotId: string,
    trigger: 'max_staff_raised' | 'assignment_cancelled',
    excludeProfileIds: string[] = [],
  ): Promise<void> {
    try {
      const slot = await this.shiftSlotRepository.findOne({
        where: { id: slotId },
        relations: ['cycle', 'workShift', 'assignments'],
      });
      const storeId = slot?.cycle?.storeId;
      if (!slot || !storeId || slot.cycle.status !== WorkCycleStatus.ACTIVE) {
        return;
      }
      const holderProfileIds = (slot.assignments || [])
        .filter((a) => a.status !== ShiftAssignmentStatus.CANCELLED)
        .map((a) => a.employeeId);
      const shift = selectFreeSeatAnnouncement({
        workDate: slot.workDate,
        startTime: slot.startTime,
        endTime: slot.endTime,
        maxStaff: slot.maxStaff ?? slot.workShift?.defaultMaxStaff ?? null,
        shiftName: slot.workShift?.shiftName ?? null,
        templateStartTime: slot.workShift?.startTime ?? null,
        templateEndTime: slot.workShift?.endTime ?? null,
        holderProfileIds,
      });
      if (!shift) {
        this.logger.debug(
          `[announceFreeSeatsOfSlot] trigger=${trigger} skipped=full_or_started holders=${holderProfileIds.length}`,
        );
        return;
      }
      this.freeSeatThrottle ??= new SlotAnnouncementThrottle();
      if (!this.freeSeatThrottle.claim(slotId)) {
        this.logger.debug(
          `[announceFreeSeatsOfSlot] trigger=${trigger} skipped=recently_announced`,
        );
        return;
      }
      await this.notifyEmployeesOfCreatedShifts(
        storeId,
        [shift],
        [...holderProfileIds, ...excludeProfileIds],
      );
    } catch (error) {
      this.logger.warn(
        `[announceFreeSeatsOfSlot] trigger=${trigger} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * `announceFreeSeatsOfSlot` for several slots of one withdrawal (a staff
   * member cancelling their upcoming self-registrations, which can span many
   * dates): same seat/start rules and the same per-slot throttle, but one
   * aggregated notice per recipient account per store instead of one per
   * slot. Holders of each slot are excluded per shift; `excludeProfileIds`
   * (the person who cancelled) are excluded altogether. After commit, best
   * effort, never throws, logs counts only.
   */
  async announceFreeSeatsOfSlots(
    this: StoresService,
    slotIds: string[],
    trigger: 'self_cancelled',
    excludeProfileIds: string[] = [],
  ): Promise<void> {
    try {
      const ids = [...new Set(slotIds.filter(Boolean))].slice(
        0,
        FREE_SEAT_ANNOUNCE_MAX_SLOTS,
      );
      if (!ids.length) return;
      const slots: ShiftSlot[] = [];
      for (let i = 0; i < ids.length; i += FREE_SEAT_ANNOUNCE_CHUNK) {
        slots.push(
          ...(await this.shiftSlotRepository.find({
            where: { id: In(ids.slice(i, i + FREE_SEAT_ANNOUNCE_CHUNK)) },
            relations: ['cycle', 'workShift', 'assignments'],
          })),
        );
      }
      const now = new Date();
      const byStore = new Map<string, AnnouncedShift[]>();
      let skipped = 0;
      for (const slot of slots) {
        const storeId = slot.cycle?.storeId;
        if (!storeId || slot.cycle.status !== WorkCycleStatus.ACTIVE) {
          skipped++;
          continue;
        }
        const shift = selectFreeSeatAnnouncement(
          {
            workDate: slot.workDate,
            startTime: slot.startTime,
            endTime: slot.endTime,
            maxStaff: slot.maxStaff ?? slot.workShift?.defaultMaxStaff ?? null,
            shiftName: slot.workShift?.shiftName ?? null,
            templateStartTime: slot.workShift?.startTime ?? null,
            templateEndTime: slot.workShift?.endTime ?? null,
            holderProfileIds: (slot.assignments || [])
              .filter((a) => a.status !== ShiftAssignmentStatus.CANCELLED)
              .map((a) => a.employeeId),
          },
          now,
        );
        this.freeSeatThrottle ??= new SlotAnnouncementThrottle();
        if (!shift || !this.freeSeatThrottle.claim(slot.id)) {
          skipped++;
          continue;
        }
        const list = byStore.get(storeId) ?? [];
        list.push(shift);
        byStore.set(storeId, list);
      }
      this.logger.debug(
        `[announceFreeSeatsOfSlots] trigger=${trigger} slots=${slots.length} announced=${slots.length - skipped} stores=${byStore.size}`,
      );
      for (const [storeId, shifts] of byStore) {
        await this.notifyEmployeesOfCreatedShifts(
          storeId,
          shifts,
          excludeProfileIds,
        );
      }
    } catch (error) {
      this.logger.warn(
        `[announceFreeSeatsOfSlots] trigger=${trigger} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Announces "Có ca mới để đăng ký" for slots the daily generation job just
   * created. Only slots created in this run are passed in (a retry or second
   * run finds them existing and creates nothing, so nothing is announced
   * twice). One aggregated notice per recipient account per store, same
   * recipient rules as a new schedule (`notifyEmployeesOfCreatedShifts`).
   * Best effort: never throws, so slot generation is never affected; logs
   * counts only.
   *
   * Known and accepted: "one notice per account per store" holds per cron
   * run. A store that has both an old-style daily cycle
   * (`generateDailySlotsForAllCycles`, 00:20 VN) and a legacy indefinite
   * template cycle (`generateDailySlotsForIndefiniteCycles`, 00:25 VN) can
   * therefore get two notices about 5 minutes apart. The two jobs are kept
   * separate on purpose (own locks, own failure domains); do not merge them
   * just to deduplicate this notice.
   */
  async announceGeneratedSlots(
    this: StoresService,
    slots: GeneratedSlotSeatState[],
    source: string,
  ): Promise<void> {
    if (!slots.length) return;
    try {
      const byStore = selectGeneratedSlotAnnouncements(slots);
      let open = 0;
      for (const [storeId, shifts] of byStore) {
        open += shifts.length;
        try {
          await this.notifyEmployeesOfCreatedShifts(storeId, shifts);
        } catch (error) {
          this.logger.warn(
            `[announceGeneratedSlots] source=${source} store=${storeId} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      this.logger.log(
        `[announceGeneratedSlots] source=${source} created=${slots.length} open=${open} stores=${byStore.size}`,
      );
    } catch (error) {
      this.logger.warn(
        `[announceGeneratedSlots] source=${source} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async updateWorkShift(
    this: StoresService,
    storeId: string,
    shiftId: string,
    data: UpdateWorkShiftDto | Partial<WorkShift>,
    ownerAccountId?: string,
  ) {
    if (!ownerAccountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    const input = data ?? {};
    const nextName =
      input.shiftName !== undefined
        ? requireWorkShiftName(input.shiftName)
        : undefined;
    const nextStartInput =
      input.startTime !== undefined
        ? requireWorkShiftTime(input.startTime)
        : undefined;
    const nextEndInput =
      input.endTime !== undefined
        ? requireWorkShiftTime(input.endTime)
        : undefined;
    await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    const shiftBeforeLock = await this.workShiftRepository.findOne({
      where: { id: shiftId, storeId },
      select: ['id'],
    });
    if (!shiftBeforeLock) {
      throw new NotFoundException('Không tìm thấy ca làm việc');
    }
    let timeChanged = false;
    const saved = await this.dataSource.transaction(async (manager) => {
      await lockStoreShiftAvailability(manager, storeId);
      const store = await manager.findOne(Store, { where: { id: storeId } });
      if (!store) throw new NotFoundException('Cửa hàng không tồn tại');
      if (!ownerAccountId || store.ownerAccountId !== ownerAccountId) {
        throw new ForbiddenException(
          'Bạn không có quyền cập nhật ca của cửa hàng này',
        );
      }
      const shift = await manager.findOne(WorkShift, {
        where: { id: shiftId, storeId },
        lock: { mode: 'pessimistic_write' },
      });
      // A deleted (hidden) shift is not editable: it is kept only for history.
      if (!shift || shift.isActive === false) {
        throw new NotFoundException('Không tìm thấy ca làm việc');
      }
      const nextStart = nextStartInput ?? shift.startTime;
      const nextEnd = nextEndInput ?? shift.endTime;
      if (sameShiftTime(nextStart, nextEnd)) {
        throw new BadRequestException(
          'Giờ bắt đầu và giờ kết thúc không được trùng nhau',
        );
      }
      if (nextName !== undefined) {
        const ownDates: Array<{ work_date: string }> = await manager.query(
          `SELECT DISTINCT to_char(ss.work_date, 'YYYY-MM-DD') AS work_date
             FROM shift_slots ss
             JOIN work_cycles wc ON wc.id = ss.cycle_id
            WHERE ss.work_shift_id = $1
              AND wc.status IN ('ACTIVE', 'EXPIRED')`,
          [shiftId],
        );
        const sameNameHit = await findSameNameShiftOnDates(
          manager,
          storeId,
          [nextName],
          (Array.isArray(ownDates) ? ownDates : [])
            .map((row) => row?.work_date)
            .filter((date): date is string => typeof date === 'string'),
          [shiftId],
        );
        if (sameNameHit) {
          throw new BadRequestException(sameNameShiftMessage(sameNameHit));
        }
      }
      timeChanged =
        (nextStartInput !== undefined &&
          !sameShiftTime(nextStartInput, shift.startTime)) ||
        (nextEndInput !== undefined &&
          !sameShiftTime(nextEndInput, shift.endTime));
      const allowed: Partial<WorkShift> = {};
      if (nextName !== undefined) allowed.shiftName = nextName;
      if (nextStartInput !== undefined) allowed.startTime = nextStartInput;
      if (nextEndInput !== undefined) allowed.endTime = nextEndInput;
      for (const key of [
        'defaultMaxStaff',
        'colorCode',
        'note',
        'location',
      ] as const) {
        if (input[key] !== undefined) (allowed as any)[key] = input[key];
      }
      if (Object.keys(allowed).length) {
        await manager.update(WorkShift, { id: shiftId, storeId }, allowed);
      }
      return manager.findOne(WorkShift, { where: { id: shiftId, storeId } });
    });

    // Reminders and the owner's start/ending alerts follow the shift's times.
    if (timeChanged) {
      this.rescheduleRemindersForShift(shiftId).catch(() => {
        this.logger.error('Failed to reschedule shift reminders');
      });
    }

    return saved;
  }

  /**
   * Deletes a shift from the store's shift settings by hiding it
   * (`is_active = false`); the row stays because past slots, attendance and
   * payroll join it.
   *
   * Refused with 409 WORK_SHIFT_HAS_UPCOMING_ASSIGNMENTS (nothing changed)
   * while a not-yet-started slot (VN time) of an active schedule still holds
   * a seat. Upcoming slots without one are removed the way DELETE
   * shift-slots/:slotId removes a slot; started and past slots are kept.
   * Deleting an already hidden shift is a no-op.
   */
  async deleteWorkShift(
    this: StoresService,
    storeId: string,
    shiftId: string,
    ownerAccountId?: string,
  ) {
    if (!ownerAccountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    const result = await this.dataSource.transaction(async (manager) => {
      await lockStoreShiftAvailability(manager, storeId);
      const store = await manager.findOne(Store, {
        where: { id: storeId },
        select: ['id', 'ownerAccountId'],
      });
      if (!store) throw new NotFoundException('Cửa hàng không tồn tại');
      if (store.ownerAccountId !== ownerAccountId) {
        throw new ForbiddenException(
          'Bạn không có quyền xoá ca của cửa hàng này',
        );
      }
      const shift = await manager.findOne(WorkShift, {
        where: { id: shiftId, storeId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!shift) throw new NotFoundException('Không tìm thấy ca làm việc');
      if (shift.isActive === false) {
        return {
          alreadyDeleted: true,
          removedSlotIds: [] as string[],
          removedAssignmentIds: [] as string[],
        };
      }

      const now = new Date();
      const candidates = await manager.find(ShiftSlot, {
        where: {
          workShiftId: shiftId,
          workDate: MoreThanOrEqual(vnDateString(now)),
          cycle: {
            storeId,
            status: In([WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED]),
          },
        },
        relations: ['assignments'],
      });
      const upcoming = (candidates ?? []).filter(
        (slot) => !isSlotRegistrationClosed(slot, shift, now),
      );
      const booked = upcoming.filter((slot) =>
        (slot.assignments ?? []).some((assignment) =>
          SEAT_HOLDING_ASSIGNMENT_STATUSES.includes(assignment.status),
        ),
      );
      if (booked.length) {
        throw new ConflictException({
          code: WORK_SHIFT_HAS_UPCOMING_ASSIGNMENTS,
          count: booked.length,
          message: `Ca còn ${booked.length} lịch sắp tới đã có nhân viên, hãy huỷ các lịch đó trước`,
        });
      }

      const removedSlotIds = upcoming.map((slot) => slot.id);
      const removedAssignmentIds = upcoming.flatMap((slot) =>
        (slot.assignments ?? []).map((assignment) => assignment.id),
      );
      await this.removeShiftSlotsWithin(manager, removedSlotIds);
      await manager.update(
        WorkShift,
        { id: shiftId, storeId },
        { isActive: false },
      );
      await this.logActivity(manager, {
        storeId,
        actorAccountId: ownerAccountId,
        action: ACTIVITY_ACTIONS.WORK_SHIFT_DELETED,
        resourceType: 'work_shift',
        resourceId: shiftId,
        params: {
          shiftName: shift.shiftName,
          startTime: String(shift.startTime ?? '').slice(0, 5),
          endTime: String(shift.endTime ?? '').slice(0, 5),
          count: removedSlotIds.length,
        },
        idempotencyKey: `${ACTIVITY_ACTIONS.WORK_SHIFT_DELETED}:${shiftId}`,
      });
      return { alreadyDeleted: false, removedSlotIds, removedAssignmentIds };
    });

    // Removed slots held only cancelled rows; clear any reminder or owner
    // alert still queued for them. Best effort, after commit.
    if (result.removedAssignmentIds.length) {
      try {
        await this.shiftReminderService.cancelAssignmentReminders(
          result.removedAssignmentIds,
        );
      } catch {
        this.logger.error('Failed to cancel reminders of removed shift slots');
      }
    }

    return {
      id: shiftId,
      deleted: true,
      alreadyDeleted: result.alreadyDeleted,
      removedUpcomingSlots: result.removedSlotIds.length,
    };
  }

  // Helper function to re-sync reminders for all employees assigned to a shift
  async rescheduleRemindersForShift(this: StoresService, shiftId: string) {
    const assignments = await this.shiftAssignmentRepository.find({
      where: {
        shiftSlot: { workShift: { id: shiftId } },
        status: ShiftAssignmentStatus.APPROVED,
      },
      select: ['id'],
    });

    await this.shiftReminderService.scheduleAssignmentReminders(
      assignments.map((assignment) => assignment.id),
    );
  }

  // ==================== WORK CYCLE MANAGEMENT ====================

  // Lấy chu kỳ đang active của cửa hàng (chỉ có 1 tại 1 thời điểm)
  async getActiveCycle(
    this: StoresService,
    storeId: string,
    ownerAccountId?: string,
  ) {
    if (ownerAccountId)
      await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    // A store may have several active schedules; return the newest.
    return this.workCycleRepository.findOne({
      where: {
        storeId,
        status: WorkCycleStatus.ACTIVE,
      },
      relations: [
        'slots',
        'slots.workShift',
        'templates',
        'templates.workShift',
      ],
      order: { createdAt: 'DESC' },
    });
  }

  // Tính ngày kết thúc dựa trên loại chu kỳ
  calculateEndDate(
    this: StoresService,
    startDate: string,
    cycleType: CycleType,
  ): string | null {
    const start = new Date(startDate);

    switch (cycleType) {
      case CycleType.DAILY:
        return startDate; // Kết thúc ngay trong ngày
      case CycleType.WEEKLY: {
        const weekEnd = new Date(start);
        weekEnd.setDate(weekEnd.getDate() + 6); // 7 ngày
        return weekEnd.toISOString().split('T')[0];
      }
      case CycleType.MONTHLY: {
        const monthEnd = new Date(start);
        monthEnd.setMonth(monthEnd.getMonth() + 1);
        monthEnd.setDate(monthEnd.getDate() - 1); // Ngày cuối tháng
        return monthEnd.toISOString().split('T')[0];
      }
      case CycleType.INDEFINITE:
        return null; // Vô thời hạn
      default:
        return null;
    }
  }

  // Lấy ngày trong tuần của 1 date
  getDayOfWeek(this: StoresService, dateString: string): WeekDaySchedule {
    return getWeekDayForDate(dateString);
  }

  // Tạo chu kỳ mới
  async createWorkCycle(
    this: StoresService,
    storeId: string,
    data: {
      name: string;
      cycleType: CycleType;
      startDate: string;
      endDate?: string;
      workShiftIds?: string[];
      slots?: { workShiftId: string; workDate: string; maxStaff?: number }[];
      templates?: {
        workShiftId: string;
        dayOfWeek: WeekDaySchedule;
        maxStaff?: number;
      }[];
    },
    ownerAccountId?: string,
  ) {
    if (ownerAccountId)
      await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    return this.createWorkCycleInternal(storeId, data, ownerAccountId);
  }

  async createWorkCycleInternal(
    this: StoresService,
    storeId: string,
    data: {
      name: string;
      cycleType: CycleType;
      startDate: string;
      endDate?: string;
      workShiftIds?: string[];
      slots?: { workShiftId: string; workDate: string; maxStaff?: number }[];
      templates?: {
        workShiftId: string;
        dayOfWeek: WeekDaySchedule;
        maxStaff?: number;
      }[];
    },
    ownerAccountId?: string,
  ) {
    if (ownerAccountId) {
      const shiftIds = [
        ...(data.workShiftIds || []),
        ...(data.templates || []).map((template) => template.workShiftId),
        ...(data.slots || []).map((slot) => slot.workShiftId),
      ];
      await this.assertWorkShiftsBelongToStore(storeId, shiftIds);
    }
    // Kiểm tra xem có chu kỳ active không. Only old-style cycles (no
    // recurrence rule) block another old-style cycle.
    const activeCycle = await this.workCycleRepository.findOne({
      where: {
        storeId,
        status: WorkCycleStatus.ACTIVE,
        recurrenceRule: IsNull(),
      },
      select: ['id'],
    });
    if (activeCycle) {
      throw new BadRequestException(
        'Cửa hàng đã có chu kỳ đang hoạt động. Vui lòng dừng chu kỳ hiện tại trước khi tạo mới.',
      );
    }

    // Tính ngày kết thúc: dùng endDate từ request nếu có, không thì tự tính theo cycleType
    const endDate =
      data.endDate || this.calculateEndDate(data.startDate, data.cycleType);

    // Tạo chu kỳ
    const cycle = this.workCycleRepository.create({
      storeId,
      name: data.name,
      cycleType: data.cycleType,
      startDate: data.startDate,
      endDate,
      status: WorkCycleStatus.ACTIVE,
    });
    let savedCycle: WorkCycle;
    try {
      savedCycle = await this.workCycleRepository.save(cycle);
    } catch (error: any) {
      // Concurrent requests are rejected by the partial unique index rather
      // than leaking a database error or creating a second ACTIVE cycle.
      if (isOneActiveCycleViolation(error)) {
        throw new BadRequestException(
          'Cửa hàng đã có chu kỳ đang hoạt động. Vui lòng dừng chu kỳ hiện tại trước khi tạo mới.',
        );
      }
      throw error;
    }

    // Nếu là INDEFINITE, tạo templates và slots cho 30 ngày tới
    if (data.cycleType === CycleType.INDEFINITE && data.templates?.length) {
      const templateEntities = data.templates.map((t) =>
        this.cycleTemplateRepository.create({
          cycleId: savedCycle.id,
          workShiftId: t.workShiftId,
          dayOfWeek: t.dayOfWeek,
          maxStaff: t.maxStaff !== undefined ? t.maxStaff : null,
        }),
      );
      await this.cycleTemplateRepository.save(templateEntities);

      // INDEFINITE: chỉ tạo slots cho 30 ngày tới, cron job sẽ tạo tiếp hàng ngày
      await this.generateSlotsFromTemplate(savedCycle.id, data.startDate, 30);
    }
    // Nếu có slots được truyền vào
    else if (data.slots?.length) {
      const slotEntities = data.slots.map((s) =>
        this.shiftSlotRepository.create({
          cycleId: savedCycle.id,
          workShiftId: s.workShiftId,
          workDate: s.workDate,
          maxStaff: s.maxStaff !== undefined ? s.maxStaff : null,
          dayOfWeek: this.getDayOfWeek(s.workDate),
        }),
      );
      await this.shiftSlotRepository.save(slotEntities);
    }
    // Nếu có workShiftIds, auto-generate slots cho tất cả ngày trong chu kỳ
    else if (data.workShiftIds?.length && endDate) {
      await this.autoGenerateSlots(
        savedCycle.id,
        data.startDate,
        endDate,
        data.workShiftIds,
      );
    }

    return this.workCycleRepository.findOne({
      where: { id: savedCycle.id },
      relations: [
        'slots',
        'slots.workShift',
        'templates',
        'templates.workShift',
      ],
    });
  }

  // Auto-generate slots cho TẤT CẢ ngày trong chu kỳ (từ startDate đến endDate)
  // Lấy maxStaff từ WorkShift.defaultMaxStaff
  async autoGenerateSlots(
    this: StoresService,
    cycleId: string,
    startDate: string,
    endDate: string,
    workShiftIds: string[],
  ) {
    // Lấy thông tin WorkShift để lấy defaultMaxStaff
    const workShifts = await this.workShiftRepository.findByIds(workShiftIds);
    const workShiftMap = new Map(workShifts.map((ws) => [ws.id, ws]));

    const slots: Partial<ShiftSlot>[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Tạo slots cho TẤT CẢ các ngày trong chu kỳ
    const current = new Date(start);
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      for (const shiftId of workShiftIds) {
        const workShift = workShiftMap.get(shiftId);
        slots.push({
          cycleId,
          workShiftId: shiftId,
          workDate: dateStr,
          maxStaff: workShift?.defaultMaxStaff || null,
          dayOfWeek: this.getDayOfWeek(dateStr),
        });
      }
      current.setDate(current.getDate() + 1);
    }

    if (slots.length > 0) {
      const slotEntities = slots.map((s) => this.shiftSlotRepository.create(s));
      await this.shiftSlotRepository.save(slotEntities);
    }
  }

  // Generate slots từ template cho N ngày tới (dùng cho INDEFINITE)
  async generateSlotsFromTemplate(
    this: StoresService,
    cycleId: string,
    fromDate: string,
    daysAhead: number,
  ) {
    const cycle = await this.workCycleRepository.findOne({
      where: { id: cycleId },
      relations: ['templates', 'templates.workShift'],
    });
    if (!cycle || !cycle.templates?.length) return [];

    const slots: Partial<ShiftSlot>[] = [];
    const sources: CycleShiftTemplate[] = [];
    const start = new Date(fromDate);

    for (let i = 0; i < daysAhead; i++) {
      const currentDate = new Date(start);
      currentDate.setDate(currentDate.getDate() + i);
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayOfWeek = this.getDayOfWeek(dateStr);

      // Tìm templates cho ngày này (bỏ qua ca đã bị xoá / ẩn)
      const dayTemplates = cycle.templates.filter(
        (t) => t.dayOfWeek === dayOfWeek && t.workShift?.isActive !== false,
      );
      for (const template of dayTemplates) {
        // Kiểm tra slot đã tồn tại chưa
        const existing = await this.shiftSlotRepository.findOne({
          where: {
            cycleId,
            workShiftId: template.workShiftId,
            workDate: dateStr,
          },
        });
        if (!existing) {
          slots.push({
            cycleId,
            workShiftId: template.workShiftId,
            workDate: dateStr,
            maxStaff: template.maxStaff,
            dayOfWeek: this.getDayOfWeek(dateStr),
          });
          sources.push(template);
        }
      }
    }

    if (!slots.length) return [];
    const slotEntities = slots.map((s) => this.shiftSlotRepository.create(s));
    const saved = await this.shiftSlotRepository.save(slotEntities);
    // The slots this call created, each with the template it came from.
    return (saved ?? slotEntities).map((slot, index) => ({
      slot,
      template: sources[index],
    }));
  }

  async getWorkCycles(
    this: StoresService,
    storeId: string,
    ownerAccountId?: string,
  ) {
    // This read is consumed by the staff calendar as well as the owner app.
    // Mutating cycle operations remain owner-only below.
    if (ownerAccountId)
      await this.assertStoreRevenueReportAccess(storeId, ownerAccountId);
    return this.workCycleRepository.find({
      where: { storeId },
      order: { createdAt: 'DESC' },
      relations: [
        'slots',
        'slots.workShift',
        'templates',
        'templates.workShift',
      ],
    });
  }

  async getWorkCycleById(
    this: StoresService,
    cycleId: string,
    ownerAccountId?: string,
  ) {
    const cycle = await this.workCycleRepository.findOne({
      where: { id: cycleId },
      relations: [
        'slots',
        'slots.workShift',
        'slots.assignments',
        'slots.assignments.employee',
        'templates',
        'templates.workShift',
      ],
    });
    if (ownerAccountId) {
      if (!cycle) throw new NotFoundException('Chu kỳ không tồn tại');
      await this.assertOwnerStoreAccess(cycle.storeId, ownerAccountId);
    }
    return cycle;
  }

  async updateWorkCycle(
    this: StoresService,
    cycleId: string,
    data: Partial<WorkCycle>,
    ownerAccountId?: string,
  ) {
    if (ownerAccountId) {
      const cycle = await this.workCycleRepository.findOne({
        where: { id: cycleId },
        select: ['id', 'storeId', 'workShiftId'],
      });
      if (!cycle) throw new NotFoundException('Chu kỳ không tồn tại');
      await this.assertOwnerStoreAccess(cycle.storeId, ownerAccountId);
      // Re-saving a cycle that still points at a since-deleted shift keeps
      // working; switching to a deleted shift does not.
      if (data.workShiftId)
        await this.assertWorkShiftsBelongToStore(
          cycle.storeId,
          [data.workShiftId],
          { rejectInactive: data.workShiftId !== cycle.workShiftId },
        );
    }
    const allowed: Partial<WorkCycle> = {};
    for (const key of [
      'name',
      'cycleType',
      'startDate',
      'endDate',
      'registrationDeadline',
      'scheduledStopAt',
      'recurrenceRule',
      'workShiftId',
    ]) {
      if (data[key] !== undefined) (allowed as any)[key] = data[key];
    }
    await this.workCycleRepository.update(cycleId, allowed);
    return this.getWorkCycleById(cycleId, ownerAccountId);
  }

  // Dừng chu kỳ (không xóa, chỉ chuyển status)
  async stopWorkCycle(
    this: StoresService,
    cycleId: string,
    options: StopWorkCycleDto = { stopImmediately: true },
    ownerAccountId?: string,
  ) {
    if (!ownerAccountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    const stopPlan = normalizeWorkCycleStopRequest(options);
    const cycle = await this.workCycleRepository.findOne({
      where: { id: cycleId },
    });
    if (!cycle) {
      throw new NotFoundException('Chu kỳ không tồn tại');
    }
    await this.assertOwnerStoreAccess(cycle.storeId, ownerAccountId);
    if (cycle.status !== WorkCycleStatus.ACTIVE) {
      throw new BadRequestException('Chỉ có thể dừng chu kỳ đang hoạt động');
    }

    const stoppedAssignmentIds = await this.dataSource.transaction(
      async (manager) => {
        await lockStoreShiftAvailability(manager, cycle.storeId);
        const lockedCycle = await manager.findOne(WorkCycle, {
          where: { id: cycleId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!lockedCycle || lockedCycle.status !== WorkCycleStatus.ACTIVE) {
          throw new BadRequestException(
            'Chỉ có thể dừng chu kỳ đang hoạt động',
          );
        }
        if (ownerAccountId) {
          const store = await manager.findOne(Store, {
            where: { id: lockedCycle.storeId },
            select: ['id', 'ownerAccountId'],
          });
          if (!store || store.ownerAccountId !== ownerAccountId) {
            throw new ForbiddenException('Bạn không có quyền dừng chu kỳ này');
          }
        }
        if (stopPlan.immediate) {
          await manager.update(WorkCycle, cycleId, {
            status: WorkCycleStatus.STOPPED,
            stoppedAt: new Date(),
          });
          const assignments = await manager.find(ShiftAssignment, {
            where: {
              shiftSlot: { cycleId },
            },
            select: ['id'],
          });
          return assignments.map((assignment) => assignment.id);
        } else {
          await manager.update(WorkCycle, cycleId, {
            scheduledStopAt: stopPlan.stopAt,
          });
        }
        return [] as string[];
      },
    );

    if (stoppedAssignmentIds.length) {
      try {
        await this.shiftReminderService.cancelAssignmentReminders(
          stoppedAssignmentIds,
        );
      } catch {
        this.logger.error('Failed to cancel reminders for stopped work cycle');
      }
    }

    return this.getWorkCycleById(cycleId, ownerAccountId);
  }

  // Kích hoạt chu kỳ (chuyển từ DRAFT sang ACTIVE)
  async activateWorkCycle(
    this: StoresService,
    cycleId: string,
    ownerAccountId?: string,
  ) {
    if (!ownerAccountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    const cycle = await this.workCycleRepository.findOne({
      where: { id: cycleId },
    });
    if (!cycle) {
      throw new NotFoundException('Chu kỳ không tồn tại');
    }
    await this.assertOwnerStoreAccess(cycle.storeId, ownerAccountId);

    try {
      await this.dataSource.transaction(async (manager) => {
        await lockStoreShiftAvailability(manager, cycle.storeId);
        const store = await manager.findOne(Store, {
          where: { id: cycle.storeId },
          select: ['id', 'ownerAccountId'],
        });
        if (ownerAccountId && store?.ownerAccountId !== ownerAccountId) {
          throw new ForbiddenException(
            'Bạn không có quyền kích hoạt chu kỳ này',
          );
        }
        // Only an old-style cycle is limited to one active per store.
        const activeCycle = cycle.recurrenceRule
          ? null
          : await manager.findOne(WorkCycle, {
              where: {
                storeId: cycle.storeId,
                status: WorkCycleStatus.ACTIVE,
                recurrenceRule: IsNull(),
                id: Not(cycleId),
              },
            });
        if (activeCycle && activeCycle.id !== cycleId) {
          throw new BadRequestException(
            'Cửa hàng đã có chu kỳ đang hoạt động. Vui lòng dừng chu kỳ hiện tại trước.',
          );
        }
        await manager.update(WorkCycle, cycleId, {
          status: WorkCycleStatus.ACTIVE,
        });
      });
    } catch (error: any) {
      if (isOneActiveCycleViolation(error)) {
        throw new BadRequestException(
          'Cửa hàng đã có chu kỳ đang hoạt động. Vui lòng dừng chu kỳ hiện tại trước.',
        );
      }
      throw error;
    }

    return this.getWorkCycleById(cycleId, ownerAccountId);
  }

  // Xử lý chu kỳ hết hạn (gọi bởi cron job)
  async processExpiredCycles(this: StoresService) {
    const today = vnDateString();

    // Tìm các chu kỳ active đã hết hạn
    const expiredCycles = await this.workCycleRepository
      .createQueryBuilder('cycle')
      .where('cycle.status = :status', { status: WorkCycleStatus.ACTIVE })
      .andWhere('cycle.endDate IS NOT NULL')
      .andWhere('cycle.endDate < :today', { today })
      .getMany();

    for (const cycle of expiredCycles) {
      await this.dataSource.transaction(async (manager) => {
        await lockStoreShiftAvailability(manager, cycle.storeId);
        await manager.update(
          WorkCycle,
          { id: cycle.id, status: WorkCycleStatus.ACTIVE },
          { status: WorkCycleStatus.EXPIRED },
        );
      });
    }

    // Xử lý các chu kỳ có lịch hẹn dừng
    const scheduledStopCycles = await this.workCycleRepository
      .createQueryBuilder('cycle')
      .where('cycle.status = :status', { status: WorkCycleStatus.ACTIVE })
      .andWhere('cycle.scheduledStopAt IS NOT NULL')
      .andWhere('cycle.scheduledStopAt <= :now', { now: new Date() })
      .getMany();

    let stoppedCount = 0;
    for (const cycle of scheduledStopCycles) {
      const stoppedAssignmentIds = await this.dataSource.transaction(
        async (manager) => {
          await lockStoreShiftAvailability(manager, cycle.storeId);
          const updateResult = await manager.update(
            WorkCycle,
            {
              id: cycle.id,
              status: WorkCycleStatus.ACTIVE,
              scheduledStopAt: Raw(
                (alias) =>
                  `${alias} IS NOT NULL AND ${alias} <= CURRENT_TIMESTAMP`,
              ),
            },
            {
              status: WorkCycleStatus.STOPPED,
              stoppedAt: new Date(),
            },
          );
          if (!updateResult.affected) return [] as string[];
          stoppedCount += 1;
          const assignments = await manager.find(ShiftAssignment, {
            where: {
              shiftSlot: { cycleId: cycle.id },
            },
            select: ['id'],
          });
          return assignments.map((assignment) => assignment.id);
        },
      );
      if (stoppedAssignmentIds.length) {
        try {
          await this.shiftReminderService.cancelAssignmentReminders(
            stoppedAssignmentIds,
          );
        } catch {
          this.logger.error(
            'Failed to cancel reminders for scheduled work cycle stop',
          );
        }
      }
    }

    return {
      expiredCount: expiredCycles.length,
      stoppedCount,
    };
  }

  /**
   * Daily cron (00:20 VN): copies each ACTIVE cycle's first-day slots onto
   * today and tomorrow (Vietnam calendar). A day that already has slots is
   * skipped, so running twice, or right after the old version (which only
   * ever created "today" because it used the UTC date), creates nothing twice
   * and leaves no day out. Days before the cycle's start or after its end are
   * never generated.
   */
  async generateDailySlotsForAllCycles(this: StoresService) {
    const today = vnDateString();
    const targetDates = [today, addDays(today, 1)];

    // Lấy tất cả chu kỳ ACTIVE (trừ INDEFINITE - sẽ xử lý riêng)
    const activeCycles = await this.workCycleRepository
      .createQueryBuilder('cycle')
      .leftJoinAndSelect('cycle.slots', 'slot')
      .where('cycle.status = :status', { status: WorkCycleStatus.ACTIVE })
      .andWhere('cycle.recurrenceRule IS NULL')
      .andWhere('cycle.cycleType != :indefinite', {
        indefinite: CycleType.INDEFINITE,
      })
      .andWhere('(cycle.endDate IS NULL OR cycle.endDate >= :today)', {
        today,
      })
      .getMany();

    let createdCount = 0;
    // Slots created by this run only, announced after generation.
    const createdSlots: GeneratedSlotSeatState[] = [];
    const nothing = () => ({
      slotCount: 0,
      assignmentIds: [] as string[],
      created: [] as GeneratedSlotSeatState[],
    });

    // Announce what was committed even when a later cycle throws: each
    // cycle commits on its own, so earlier slots exist. The error is still
    // rethrown (unchanged cron semantics); announcing never throws.
    try {
      for (const cycle of activeCycles) {
        for (const workDate of targetDates) {
          const cycleStart = String(cycle.startDate).slice(0, 10);
          const cycleEnd = cycle.endDate
            ? String(cycle.endDate).slice(0, 10)
            : null;
          if (workDate < cycleStart || (cycleEnd && workDate > cycleEnd))
            continue;
          const generated = await this.dataSource.transaction(
            async (manager) => {
              await lockStoreShiftAvailability(manager, cycle.storeId);
              const lockedCycle = await manager.findOne(WorkCycle, {
                where: { id: cycle.id, status: WorkCycleStatus.ACTIVE },
              });
              if (!lockedCycle) return nothing();
              const existingSlots = await manager.find(ShiftSlot, {
                where: { cycleId: cycle.id, workDate },
              });
              if (existingSlots.length) return nothing();
              // A deleted (hidden) shift is not copied to new days.
              const firstDaySlots = (
                (await manager.find(ShiftSlot, {
                  where: { cycleId: cycle.id, workDate: cycle.startDate },
                  relations: ['assignments', 'workShift'],
                })) ?? []
              ).filter((slot) => slot.workShift?.isActive !== false);
              if (!firstDaySlots.length) return nothing();
              const newSlots = firstDaySlots.map((slot) =>
                manager.create(ShiftSlot, {
                  cycleId: cycle.id,
                  workShiftId: slot.workShiftId,
                  workDate,
                  startTime: slot.startTime,
                  endTime: slot.endTime,
                  maxStaff: slot.maxStaff,
                  note: slot.note,
                  dayOfWeek: this.getDayOfWeek(workDate),
                }),
              );
              const savedSlots = await manager.save(ShiftSlot, newSlots);
              const newAssignments = firstDaySlots.flatMap(
                (templateSlot, index) =>
                  (templateSlot.assignments || [])
                    .filter(
                      (assignment) =>
                        assignment.status === ShiftAssignmentStatus.APPROVED,
                    )
                    .map((assignment) =>
                      manager.create(ShiftAssignment, {
                        shiftSlotId: savedSlots[index].id,
                        employeeId: assignment.employeeId,
                        status: ShiftAssignmentStatus.APPROVED,
                        note: 'Auto-assigned from cycle',
                      }),
                    ),
              );
              const savedAssignments = newAssignments.length
                ? await manager.save(ShiftAssignment, newAssignments)
                : [];
              return {
                slotCount: savedSlots.length,
                assignmentIds: savedAssignments.map(
                  (assignment) => assignment.id,
                ),
                created: savedSlots.map((slot, index) => {
                  const template = firstDaySlots[index];
                  return {
                    storeId: cycle.storeId,
                    workDate: slot.workDate,
                    startTime: slot.startTime ?? null,
                    endTime: slot.endTime ?? null,
                    maxStaff:
                      slot.maxStaff ??
                      template.workShift?.defaultMaxStaff ??
                      null,
                    shiftName: template.workShift?.shiftName ?? null,
                    templateStartTime: template.workShift?.startTime ?? null,
                    templateEndTime: template.workShift?.endTime ?? null,
                    holderProfileIds: newAssignments
                      .filter(
                        (assignment) => assignment.shiftSlotId === slot.id,
                      )
                      .map((assignment) => assignment.employeeId),
                  };
                }),
              };
            },
          );
          createdCount += generated.slotCount;
          createdSlots.push(...generated.created);
          for (const assignmentId of generated.assignmentIds) {
            this.scheduleReminderForAssignment(assignmentId).catch(() => {
              this.logger.error(
                'Failed to schedule automatic assignment reminder',
              );
            });
          }
        }
      }
    } finally {
      await this.announceGeneratedSlots(createdSlots, 'daily');
    }

    return { processedCycles: activeCycles.length, createdSlots: createdCount };
  }

  // Tạo slots cho chu kỳ INDEFINITE (gọi bởi cron job hàng ngày)
  async generateDailySlotsForIndefiniteCycles(this: StoresService) {
    const indefiniteCycles = await this.workCycleRepository.find({
      where: {
        cycleType: CycleType.INDEFINITE,
        status: WorkCycleStatus.ACTIVE,
      },
    });

    const unifiedSchedules = indefiniteCycles.filter(
      (cycle) => cycle.recurrenceRule && cycle.workShiftId,
    );
    let legacyCycles = indefiniteCycles.filter(
      (cycle) => !cycle.recurrenceRule || !cycle.workShiftId,
    );

    const today = getTodayDateString();
    const horizonDate = addDays(today, SHIFT_SCHEDULE_HORIZON_DAYS - 1);
    let createdCount = 0;
    // Slots created by this run only, announced after generation.
    const createdSlots: GeneratedSlotSeatState[] = [];

    // Announce what was committed even when a later cycle throws: each
    // cycle commits on its own, so earlier slots exist. The error is still
    // rethrown (unchanged cron semantics); announcing never throws.
    try {
      for (const cycle of unifiedSchedules) {
        const rule = cycle.recurrenceRule as ShiftRecurrenceRule;
        if (
          horizonDate < cycle.startDate ||
          rule.endType !== ShiftRecurrenceEndType.NEVER ||
          !matchesShiftRecurrence(horizonDate, cycle.startDate, rule)
        ) {
          continue;
        }

        const cycleSlots = await this.shiftSlotRepository.find({
          where: { cycleId: cycle.id },
          select: ['workShiftId'],
        });
        const shiftIds = [
          ...new Set([
            cycle.workShiftId as string,
            ...cycleSlots.map((slot) => slot.workShiftId).filter(Boolean),
          ]),
        ];
        for (const workShiftId of shiftIds) {
          const existing = await this.shiftSlotRepository.findOne({
            where: { cycleId: cycle.id, workShiftId, workDate: horizonDate },
          });
          if (existing) continue;
          const workShift = await this.workShiftRepository.findOne({
            where: { id: workShiftId, storeId: cycle.storeId, isActive: true },
          });
          if (!workShift) continue;
          await this.shiftSlotRepository.save(
            this.shiftSlotRepository.create({
              cycleId: cycle.id,
              workShiftId: workShift.id,
              workDate: horizonDate,
              startTime: workShift.startTime,
              endTime: workShift.endTime,
              maxStaff: workShift.defaultMaxStaff,
              note: workShift.note || null,
              dayOfWeek: getWeekDayForDate(horizonDate),
            }),
          );
          createdCount += 1;
          // A generated day carries no assignments: every seat is free.
          createdSlots.push({
            storeId: cycle.storeId,
            workDate: horizonDate,
            startTime: workShift.startTime ?? null,
            endTime: workShift.endTime ?? null,
            maxStaff: workShift.defaultMaxStaff ?? null,
            shiftName: workShift.shiftName ?? null,
            holderProfileIds: [],
          });
        }
      }

      const tomorrowStr = addDays(today, 1);

      // Bug 5.1 fix: Check if slots already exist for tomorrow before generating
      const existingTomorrowSlots = await this.shiftSlotRepository.find({
        where: { workDate: tomorrowStr },
      });

      if (existingTomorrowSlots.length > 0) {
        // Filter to only count INDEFINITE cycle slots
        const existingCycleIds = new Set(
          existingTomorrowSlots.map((s) => s.cycleId),
        );
        const indefiniteWithSlots = legacyCycles.filter((c) =>
          existingCycleIds.has(c.id),
        );

        // Remove cycles that already have slots for tomorrow
        legacyCycles = legacyCycles.filter((c) => !existingCycleIds.has(c.id));

        this.logger.debug(
          `Skipped ${indefiniteWithSlots.length} indefinite cycles - slots already exist for tomorrow`,
        );
      }

      for (const cycle of legacyCycles) {
        // Tạo slots cho ngày mai dựa trên template
        const generated = await this.generateSlotsFromTemplate(
          cycle.id,
          tomorrowStr,
          1,
        );
        for (const { slot, template } of generated ?? []) {
          createdSlots.push({
            storeId: cycle.storeId,
            workDate: slot.workDate,
            startTime: slot.startTime ?? null,
            endTime: slot.endTime ?? null,
            maxStaff:
              slot.maxStaff ?? template.workShift?.defaultMaxStaff ?? null,
            shiftName: template.workShift?.shiftName ?? null,
            templateStartTime: template.workShift?.startTime ?? null,
            templateEndTime: template.workShift?.endTime ?? null,
            holderProfileIds: [],
          });
        }
      }
    } finally {
      await this.announceGeneratedSlots(createdSlots, 'indefinite');
    }

    return {
      processedCount: indefiniteCycles.length,
      createdCount,
    };
  }

  // ==================== SHIFT SLOT MANAGEMENT ====================

  async createShiftSlots(
    this: StoresService,
    cycleId: string,
    slotsData: Partial<ShiftSlot>[],
    ownerAccountId?: string,
  ) {
    const cycle = await this.workCycleRepository.findOne({
      where: { id: cycleId },
      select: ['id', 'storeId'],
    });
    if (!cycle) throw new NotFoundException('Chu kỳ không tồn tại');
    if (ownerAccountId)
      await this.assertOwnerStoreAccess(cycle.storeId, ownerAccountId);
    if (ownerAccountId) {
      await this.assertWorkShiftsBelongToStore(
        cycle.storeId,
        slotsData.map((slot) => slot.workShiftId || ''),
      );
    }
    const slots = slotsData.map((data) =>
      this.shiftSlotRepository.create({
        ...data,
        cycleId,
        dayOfWeek: data.workDate ? this.getDayOfWeek(data.workDate) : undefined,
      }),
    );
    return this.shiftSlotRepository.save(slots);
  }

  async getShiftSlots(
    this: StoresService,
    cycleId: string,
    date?: string,
    ownerAccountId?: string,
  ) {
    if (ownerAccountId) {
      const cycle = await this.workCycleRepository.findOne({
        where: { id: cycleId },
        select: ['id', 'storeId'],
      });
      if (!cycle) throw new NotFoundException('Chu kỳ không tồn tại');
      await this.assertOwnerStoreAccess(cycle.storeId, ownerAccountId);
    }
    const where: any = { cycleId };
    if (date) {
      where.workDate = date;
    }
    const slots = await this.shiftSlotRepository.find({
      where,
      relations: ['workShift', 'assignments', 'assignments.employee'],
      order: { workDate: 'ASC' },
    });

    return slots.map((slot) => {
      const result: any = {
        ...slot,
        currentCount: slot.assignments?.length || 0,
        isFull:
          slot.maxStaff !== null
            ? (slot.assignments?.length || 0) >= slot.maxStaff
            : false,
        // Ưu tiên slot-specific time, fallback sang workShift time
        effectiveStartTime: slot.startTime || slot.workShift?.startTime,
        effectiveEndTime: slot.endTime || slot.workShift?.endTime,
      };
      return result;
    });
  }

  async updateShiftSlot(
    this: StoresService,
    slotId: string,
    data: {
      startTime?: string;
      endTime?: string;
      maxStaff?: number;
      note?: string;
    },
    ownerAccountId?: string,
  ) {
    const slotContext = await this.shiftSlotRepository.findOne({
      where: { id: slotId },
      relations: ['cycle'],
    });
    if (!slotContext) throw new NotFoundException('Shift slot not found');
    const storeId = slotContext.cycle?.storeId;
    if (!storeId)
      throw new BadRequestException('Slot không thuộc chu kỳ hợp lệ');
    if (!ownerAccountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    const updateData: Partial<ShiftSlot> = {};
    if (data.startTime !== undefined) updateData.startTime = data.startTime;
    if (data.endTime !== undefined) updateData.endTime = data.endTime;
    if (data.maxStaff !== undefined) updateData.maxStaff = data.maxStaff;
    if (data.note !== undefined) updateData.note = data.note;

    const seatsRaised = await this.dataSource.transaction(async (manager) => {
      await lockStoreShiftAvailability(manager, storeId);
      const store = await manager.findOne(Store, {
        where: { id: storeId },
        select: ['id', 'ownerAccountId'],
      });
      if (
        !ownerAccountId ||
        !store ||
        store.ownerAccountId !== ownerAccountId
      ) {
        throw new ForbiddenException('Bạn không có quyền cập nhật slot này');
      }
      const lockedSlot = await manager.findOne(ShiftSlot, {
        where: { id: slotId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedSlot) throw new NotFoundException('Shift slot not found');
      const nextStart = data.startTime ?? lockedSlot.startTime;
      const nextEnd = data.endTime ?? lockedSlot.endTime;
      if (nextStart && nextEnd && nextStart === nextEnd) {
        throw new BadRequestException(
          'Giờ bắt đầu và giờ kết thúc không được trùng nhau',
        );
      }
      await manager.update(ShiftSlot, slotId, updateData);
      if (data.maxStaff === undefined) return false;
      const next = Number(data.maxStaff) || 0;
      const previous = Number(lockedSlot.maxStaff) || 0;
      // 0/null is "unlimited" (a null override inherits the template, so a
      // change from null is treated as a possible raise; the announcement
      // re-checks the real free seats).
      return (
        lockedSlot.maxStaff === null ||
        next > previous ||
        (next === 0 && previous > 0)
      );
    });
    if (seatsRaised) {
      // More seats than before: others may now sign up (if it is not full).
      void this.announceFreeSeatsOfSlot(slotId, 'max_staff_raised').catch(
        () => undefined,
      );
    }
    if (data.startTime !== undefined) {
      const assignments = await this.shiftAssignmentRepository.find({
        where: {
          shiftSlotId: slotId,
          status: ShiftAssignmentStatus.APPROVED,
        },
        select: ['id'],
      });
      try {
        await this.shiftReminderService.scheduleAssignmentReminders(
          assignments.map((assignment) => assignment.id),
        );
      } catch {
        this.logger.error('Failed to reschedule shift slot reminders');
      }
    }
    return this.shiftSlotRepository.findOne({
      where: { id: slotId },
      relations: ['workShift', 'assignments', 'assignments.employee'],
    });
  }

  async deleteShiftSlot(
    this: StoresService,
    slotId: string,
    ownerAccountId?: string,
  ) {
    const slotContext = await this.shiftSlotRepository.findOne({
      where: { id: slotId },
      relations: ['cycle'],
    });
    if (!slotContext) throw new NotFoundException('Shift slot not found');
    const storeId = slotContext.cycle?.storeId;
    if (!storeId)
      throw new BadRequestException('Slot không thuộc chu kỳ hợp lệ');
    if (!ownerAccountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    await this.dataSource.transaction(async (manager) => {
      await lockStoreShiftAvailability(manager, storeId);
      const store = await manager.findOne(Store, {
        where: { id: storeId },
        select: ['id', 'ownerAccountId'],
      });
      if (
        !ownerAccountId ||
        !store ||
        store.ownerAccountId !== ownerAccountId
      ) {
        throw new ForbiddenException('Bạn không có quyền xóa slot này');
      }
      await this.removeShiftSlotsWithin(manager, [slotId]);
    });
    return { message: 'Shift slot deleted successfully' };
  }

  /**
   * Removes shift slots inside the caller's transaction (store availability
   * lock held). Their assignments and dependent rows go with them through
   * the ON DELETE CASCADE foreign keys.
   */
  async removeShiftSlotsWithin(
    this: StoresService,
    manager: EntityManager,
    slotIds: string[],
  ): Promise<void> {
    if (!slotIds.length) return;
    await manager.delete(
      ShiftSlot,
      slotIds.length === 1 ? slotIds[0] : slotIds,
    );
  }

  // ==================== STORE SHIFT SLOTS (for staff app calendar) ====================

  /**
   * Lấy tất cả shift slots của cửa hàng (bao gồm workShift info + assignments)
   * Dùng cho staff app hiển thị lịch ca cửa hàng
   */
  async getStoreShiftSlots(
    this: StoresService,
    storeId: string,
    startDate?: string,
    endDate?: string,
    employeeProfileId?: string,
    accountId?: string,
  ) {
    // The route is authenticated, but store IDs and employee profile IDs are
    // client-controlled. Resolve both against the caller's store membership
    // before returning schedules or salary data.
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      select: ['id', 'ownerAccountId'],
    });
    if (accountId) {
      if (!store) throw new NotFoundException('Cửa hàng không tồn tại');
      const isOwner = store.ownerAccountId === accountId;
      // Read access: any employed member (probation and on-leave included),
      // the same rule as the store guards.
      const activeEmployee = isOwner
        ? null
        : await this.profileRepository.findOne({
            where: {
              storeId,
              accountId,
              employmentStatus: In([...EMPLOYED_STATUSES]),
            },
            select: ['id'],
          });
      if (!isOwner && !activeEmployee) {
        throw new ForbiddenException(
          'Bạn không có quyền truy cập cửa hàng này',
        );
      }
      if (employeeProfileId) {
        const requestedEmployee = await this.profileRepository.findOne({
          where: {
            id: employeeProfileId,
            storeId,
            employmentStatus: In([...EMPLOYED_STATUSES]),
          },
          select: ['id', 'accountId'],
        });
        if (!requestedEmployee) {
          throw new NotFoundException('Không tìm thấy nhân viên');
        }
        if (!isOwner && requestedEmployee.accountId !== accountId) {
          throw new ForbiddenException(
            'Bạn chỉ có thể xem lương của chính mình',
          );
        }
      }
    }

    if (startDate || endDate) {
      this.validateShiftSlotDateRange(startDate, endDate);
    }
    const qb = this.shiftSlotRepository
      .createQueryBuilder('slot')
      .leftJoinAndSelect('slot.workShift', 'workShift')
      .leftJoinAndSelect('slot.assignments', 'assignment')
      .leftJoinAndSelect('assignment.employee', 'employee')
      .leftJoinAndSelect('employee.account', 'account')
      .leftJoin('slot.cycle', 'cycle')
      .where('cycle.storeId = :storeId', { storeId })
      .andWhere('cycle.status IN (:...cycleStatuses)', {
        cycleStatuses: [WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED],
      })
      .orderBy('slot.workDate', 'ASC')
      .addOrderBy('workShift.startTime', 'ASC');

    if (startDate) {
      qb.andWhere('slot.workDate >= :startDate', { startDate });
    }
    if (endDate) {
      qb.andWhere('slot.workDate <= :endDate', { endDate });
    }

    // Keep the legacy array response while bounding this compatibility
    // endpoint. The owner calendar uses the paginated aggregation endpoint.
    const boundedQb =
      typeof (qb as any).take === 'function' ? qb.take(5000) : qb;
    const slots = await boundedQb.getMany();

    // If an employee is given, resolve their active contract once so each slot
    // can carry an estimated salary (for the "Đăng ký ca làm" cards).
    let activeContract: EmployeeContract | null = null;
    if (employeeProfileId) {
      activeContract = await this.contractRepository.findOne({
        where: { employeeProfileId, isActive: true },
        order: { createdAt: 'DESC' },
      });
    }

    // MONTH contracts show the same day rate the checkout stores: the monthly
    // salary over the store's standard working days of the slot's month.
    // Days off are loaded once; the count is memoized per month.
    const daysOff = activeContract?.salaryAmount
      ? (
          await this.shiftConfigRepository.findOne({
            where: { storeId },
            select: ['id', 'daysOff'],
          })
        )?.daysOff
      : undefined;
    const workingDaysByMonth = new Map<string, number>();
    const workingDaysFor = (workDate: string): number | undefined => {
      const month = vnMonthOfDateString(workDate);
      if (!month) return undefined;
      let days = workingDaysByMonth.get(month.key);
      if (days === undefined) {
        days = countWorkingDaysInMonth(month.year, month.monthIndex, daysOff);
        workingDaysByMonth.set(month.key, days);
      }
      return days;
    };

    // Estimated salary for a single slot from contract rate + slot duration.
    const slotSalary = (slot: ShiftSlot): number => {
      if (!activeContract || !activeContract.salaryAmount) return 0;
      const startTime =
        slot.startTime || slot.workShift?.startTime || '00:00:00';
      const endTime = slot.endTime || slot.workShift?.endTime || '00:00:00';
      const start = new Date(`1970-01-01T${startTime}Z`).getTime();
      let end = new Date(`1970-01-01T${endTime}Z`).getTime();
      if (end < start) end += 24 * 60 * 60 * 1000;
      const durationHours = (end - start) / 3600000;
      const base = Number(activeContract.salaryAmount);

      // Shared with the payroll path so the quoted estimate and the amount
      // actually persisted at check-out can never diverge again. `?? 0`
      // preserves this path's original behaviour for an unknown payment type.
      return (
        calculateShiftEarnings({
          paymentType: activeContract.paymentType,
          baseSalary: base,
          hours: durationHours,
          referenceDate: vnMiddayInstant(String(slot.workDate)),
          workingDaysInMonth: workingDaysFor(String(slot.workDate)),
        }) ?? 0
      );
    };

    return slots.map((slot) => {
      // `maxStaff` is the legacy per-slot override. A null override inherits
      // the shift template default; null after inheritance means unlimited.
      const configuredMaxStaff =
        slot.maxStaff ?? slot.workShift?.defaultMaxStaff ?? null;
      const effectiveMaxStaff =
        configuredMaxStaff !== null && configuredMaxStaff > 0
          ? configuredMaxStaff
          : null;
      const activeCount =
        slot.assignments?.filter(
          (a) => a.status !== ShiftAssignmentStatus.CANCELLED,
        ).length || 0;

      return {
        id: slot.id,
        workDate: slot.workDate,
        maxStaff: slot.maxStaff,
        effectiveMaxStaff,
        cycleId: slot.cycleId,
        estimatedSalary: employeeProfileId ? slotSalary(slot) : 0,
        workShift: slot.workShift
          ? {
              id: slot.workShift.id,
              shiftName: slot.workShift.shiftName,
              startTime: slot.workShift.startTime,
              endTime: slot.workShift.endTime,
              colorCode: (slot.workShift as any).colorCode || null,
            }
          : null,
        assignments: (slot.assignments || [])
          .filter((a) => a.status !== ShiftAssignmentStatus.CANCELLED)
          .map((a) => ({
            id: a.id,
            employeeId: a.employeeId,
            status: a.status,
            employee: a.employee
              ? {
                  id: a.employee.id,
                  fullName: a.employee.account?.fullName || null,
                  avatarUrl: a.employee.account?.avatar || null,
                  account: {
                    fullName: a.employee.account?.fullName || null,
                    avatarUrl: a.employee.account?.avatar || null,
                  },
                }
              : null,
          })),
        currentCount: activeCount,
        isFull:
          effectiveMaxStaff !== null && effectiveMaxStaff > 0
            ? activeCount >= effectiveMaxStaff
            : false,
      };
    });
  }

  validateShiftSlotDateRange(
    this: StoresService,
    startDate?: string,
    endDate?: string,
  ): void {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    for (const value of [startDate, endDate]) {
      if (!value) continue;
      if (!dateOnly.test(value))
        throw new BadRequestException('Ngày không hợp lệ');
      const [year, month, day] = value.split('-').map(Number);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      if (
        Number.isNaN(parsed.getTime()) ||
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day
      ) {
        throw new BadRequestException('Ngày không tồn tại');
      }
    }
    if (startDate && endDate) {
      if (startDate > endDate)
        throw new BadRequestException('Khoảng ngày không hợp lệ');
      const start = Date.parse(`${startDate}T00:00:00Z`);
      const end = Date.parse(`${endDate}T00:00:00Z`);
      if (end - start > 366 * 24 * 60 * 60 * 1000) {
        throw new BadRequestException('Khoảng ngày tối đa là 366 ngày');
      }
    }
  }

  // ==================== SHIFT ASSIGNMENT MANAGEMENT ====================

  async registerToShiftSlot(
    this: StoresService,
    slotId: string,
    employeeId: string,
    note?: string,
    isOwnerAssign = false,
    ownerAccountId?: string,
  ) {
    const slotContext = await this.shiftSlotRepository.findOne({
      where: { id: slotId },
      relations: ['cycle'],
    });
    if (!slotContext) throw new NotFoundException('Shift slot not found');
    const storeId = slotContext.cycle?.storeId;
    if (!storeId) throw new BadRequestException('Ca không thuộc chu kỳ hợp lệ');
    if (!ownerAccountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    if (isOwnerAssign) {
      await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    } else {
      const caller = await this.profileRepository.findOne({
        where: {
          id: employeeId,
          accountId: ownerAccountId,
          storeId,
          // Probation is a working state — someone on probation is rostered
          // like anyone else. Requiring ACTIVE alone locked every new hire out
          // of signing up for their own shifts.
          employmentStatus: In([...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]),
        },
        select: ['id'],
      });
      if (!caller) {
        throw new ForbiddenException(
          'Nhân viên chỉ có thể tự đăng ký ca của mình',
        );
      }
    }
    const savedAssignment = await this.dataSource.transaction(
      async (manager) => {
        await lockStoreShiftAvailability(manager, storeId);
        // Step 1: Lock the slot row to prevent race condition (no joins, FOR UPDATE only works on non-nullable side)
        const slot = await manager
          .createQueryBuilder(ShiftSlot, 'slot')
          .setLock('pessimistic_write')
          .where('slot.id = :slotId', { slotId })
          .getOne();

        if (!slot) throw new NotFoundException('Shift slot not found');

        // Step 2: Load cycle, workShift and assignments separately (now inside transaction)
        const [cycle, workShift, assignments] = await Promise.all([
          slot.cycleId
            ? manager.findOne(WorkCycle, { where: { id: slot.cycleId } })
            : Promise.resolve(null),
          manager.findOne(WorkShift, { where: { id: slot.workShiftId } }),
          manager.find(ShiftAssignment, {
            where: { shiftSlotId: slotId },
          }),
        ]);

        // The request flag is only a hint. Resolve the caller's role from the
        // store and employee profile so a staff token cannot self-promote to an
        // owner assignment (or register somebody else's profile).
        let authorizedOwnerAssign = false;
        if (ownerAccountId) {
          if (isOwnerAssign) {
            const store = await manager.findOne(Store, {
              where: { id: cycle?.storeId || '' },
              select: ['id', 'ownerAccountId'],
            });
            if (!store || store.ownerAccountId !== ownerAccountId) {
              throw new ForbiddenException(
                'Bạn không có quyền gán nhân viên vào ca này',
              );
            }
            authorizedOwnerAssign = true;
          }
        }

        // Check if cycle is still active
        if (cycle && cycle.status !== WorkCycleStatus.ACTIVE) {
          throw new BadRequestException('Chu kỳ không còn hoạt động');
        }

        // Check registration deadline
        const now = new Date();
        if (
          cycle?.registrationDeadline &&
          now > new Date(cycle.registrationDeadline)
        ) {
          throw new BadRequestException('Đã quá hạn đăng ký ca làm việc');
        }

        // A deleted (hidden) shift takes no new self-registrations. Its
        // upcoming slots were removed on delete; this covers the rest.
        if (!authorizedOwnerAssign && workShift?.isActive === false) {
          throw new BadRequestException({
            code: WORK_SHIFT_INACTIVE_CODE,
            message: WORK_SHIFT_INACTIVE_MESSAGE,
          });
        }

        // Staff cannot sign up for a slot that already started or is in the
        // past (VN time). The owner can still assign to fix records.
        if (
          !authorizedOwnerAssign &&
          isSlotRegistrationClosed(slot, workShift, now)
        ) {
          throw new BadRequestException({
            code: SLOT_REGISTRATION_CLOSED_CODE,
            message: SLOT_REGISTRATION_CLOSED_MESSAGE,
          });
        }

        // Check capacity (0 or null = unlimited)
        const activeCount =
          assignments.filter(
            (a) => a.status !== ShiftAssignmentStatus.CANCELLED,
          ).length || 0;

        const maxRequired = slot.maxStaff ?? workShift?.defaultMaxStaff ?? 0;
        if (maxRequired > 0 && activeCount >= maxRequired) {
          throw new BadRequestException('Ca đã đầy người');
        }

        // Check employee status
        const employee = await manager.findOne(EmployeeProfile, {
          where: { id: employeeId },
        });
        if (!employee) {
          throw new NotFoundException('Không tìm thấy nhân viên');
        }
        if (!isShiftEligibleEmploymentStatus(employee.employmentStatus)) {
          throw new BadRequestException(
            'Nhân viên không còn hoạt động, không thể đăng ký ca',
          );
        }
        if (cycle?.storeId && employee.storeId !== cycle.storeId) {
          throw new ForbiddenException('Nhân viên không thuộc cửa hàng này');
        }
        if (
          ownerAccountId &&
          !authorizedOwnerAssign &&
          employee.accountId !== ownerAccountId
        ) {
          throw new ForbiddenException(
            'Nhân viên chỉ có thể tự đăng ký ca của mình',
          );
        }

        // Check if employee already registered (exclude cancelled)
        const existing = await manager.findOne(ShiftAssignment, {
          where: { shiftSlotId: slotId, employeeId },
        });
        if (existing && existing.status !== ShiftAssignmentStatus.CANCELLED) {
          throw new BadRequestException('Nhân viên đã đăng ký ca này');
        }

        // Create and save assignment
        const assignment = manager.create(ShiftAssignment, {
          shiftSlotId: slotId,
          employeeId,
          note,
          status:
            authorizedOwnerAssign || (!ownerAccountId && isOwnerAssign)
              ? ShiftAssignmentStatus.APPROVED
              : ShiftAssignmentStatus.PENDING,
        });
        const saved = await manager.save(assignment);
        console.log(
          `[registerToShiftSlot] saved assignmentId=${saved.id}, slotId=${slotId}, cycleId=${slot.cycleId}, employeeId=${employeeId}, status=${saved.status}`,
        );
        await this.logActivity(manager, {
          storeId,
          actorAccountId: ownerAccountId ?? null,
          subjectEmployeeProfileId: employeeId,
          action: ACTIVITY_ACTIONS.SHIFT_REGISTRATION_CREATED,
          resourceType: 'shift_assignment',
          resourceId: saved.id,
          params: {
            ...this.activityShiftParams({ ...slot, workShift }),
            status: saved.status,
            byOwner: authorizedOwnerAssign,
          },
          idempotencyKey: `${ACTIVITY_ACTIONS.SHIFT_REGISTRATION_CREATED}:${saved.id}`,
        });

        return saved;
      },
    );
    if (savedAssignment.status === ShiftAssignmentStatus.APPROVED) {
      try {
        await this.shiftReminderService.scheduleAssignmentReminder(
          savedAssignment.id,
        );
      } catch {
        this.logger.error('Failed to schedule registered assignment reminder');
      }
    }
    // Only a self-registration needs announcing — when the owner assigns a
    // shift they already know. Best effort: the registration has committed and
    // must not be rolled back because a notification failed.
    if (!isOwnerAssign) {
      await this.notifyOwnerOfShiftRegistration(storeId, employeeId, slotId);
    } else if (savedAssignment.status === ShiftAssignmentStatus.APPROVED) {
      // Ngược lại, chủ xếp ca thì chính nhân viên mới là người chưa biết.
      void this.notifyEmployeesOfNewShifts([savedAssignment.id], 'assigned');
    }

    return savedAssignment;
  }

  /**
   * Báo cho nhân viên khi chủ xếp ca cho họ hoặc duyệt ca họ đăng ký.
   *
   * Gom theo nhân viên: tạo một lịch lặp nhiều tuần sinh ra hàng chục
   * assignment, và một người không nên nhận hàng chục thông báo cho cùng một
   * lần bấm. Gửi sau khi dữ liệu đã commit và chỉ là best effort — thông báo
   * hỏng không được làm hỏng việc xếp ca. Nơi gọi không chờ hàm này: gửi push
   * lần lượt cho từng người không được giữ phản hồi của chủ. Hàm tự bắt mọi
   * lỗi nên không có promise bị từ chối mà không ai xử lý.
   */
  async notifyEmployeesOfNewShifts(
    this: StoresService,
    assignmentIds: string[],
    kind: ShiftNotificationKind,
  ): Promise<void> {
    if (!assignmentIds.length) return;
    let assignments: ShiftAssignment[];
    try {
      assignments = await this.shiftAssignmentRepository.find({
        where: { id: In(assignmentIds) },
        relations: [
          'employee',
          'shiftSlot',
          'shiftSlot.workShift',
          'shiftSlot.cycle',
        ],
      });
    } catch (error) {
      this.logger.warn(
        `[notifyEmployeesOfNewShifts] could not load assignments: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    const byAccount = new Map<string, ShiftAssignment[]>();
    for (const assignment of assignments) {
      const accountId = assignment.employee?.accountId;
      if (!accountId || !assignment.shiftSlot?.workDate) continue;
      byAccount.set(accountId, [
        ...(byAccount.get(accountId) ?? []),
        assignment,
      ]);
    }

    for (const [accountId, list] of byAccount) {
      try {
        const shifts = list.map((a) => ({
          workDate: a.shiftSlot.workDate,
          startTime: a.shiftSlot.startTime || a.shiftSlot.workShift?.startTime,
          endTime: a.shiftSlot.endTime || a.shiftSlot.workShift?.endTime,
          shiftName: a.shiftSlot.workShift?.shiftName,
        }));
        const { title, content } = buildShiftNotification(kind, shifts);
        const storeId = list[0].shiftSlot?.cycle?.storeId;
        await this.notificationsService.create({
          accountId,
          storeId,
          title,
          content,
          type:
            kind === 'approved'
              ? NotificationType.SHIFT_APPROVAL
              : NotificationType.SCHEDULE_CONFIRMATION,
          priority: NotificationPriority.NORMAL,
          // Chạm vào thông báo trong danh sách mở thẳng lịch làm việc.
          actionUrl: '/(home)/workshift',
          metadata: {
            type: kind === 'approved' ? 'SHIFT_APPROVED' : 'SHIFT_ASSIGNED',
            storeId,
            assignmentIds: list.map((a) => a.id),
            ...shiftNotificationDateMetadata(shifts),
          },
        });
      } catch (error) {
        // Lỗi với một người không được chặn thông báo của người khác.
        this.logger.warn(
          `[notifyEmployeesOfNewShifts] could not notify account ${accountId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /**
   * Tells the store owner that an employee signed themselves up for a shift.
   *
   * Registration previously wrote the assignment and returned, so the owner had
   * to notice it by opening the schedule.
   */
  async notifyOwnerOfShiftRegistration(
    this: StoresService,
    storeId: string,
    employeeId: string,
    slotId: string,
  ): Promise<void> {
    try {
      const [store, profile, slot] = await Promise.all([
        this.storeRepository.findOne({
          where: { id: storeId },
          select: ['id', 'name', 'ownerAccountId'],
        }),
        this.profileRepository.findOne({
          where: { id: employeeId },
          relations: ['account'],
        }),
        this.shiftSlotRepository.findOne({
          where: { id: slotId },
          relations: ['workShift'],
        }),
      ]);
      if (!store?.ownerAccountId) return;

      const who = profile?.account?.fullName?.trim() || 'Một nhân viên';
      const shiftName = slot?.workShift?.shiftName || 'ca làm việc';
      // "hôm nay (18/09)" / "ngày mai (19/09)" / "ngày 25/09" thay cho ngày thô YYYY-MM-DD.
      const workDate = slot?.workDate ? String(slot.workDate).slice(0, 10) : '';
      const dated = /^\d{4}-\d{2}-\d{2}$/.test(workDate);
      const when = dated ? ` ${describeWorkDate(workDate)}` : '';

      await this.notificationsService.create({
        accountId: store.ownerAccountId,
        storeId,
        title: 'Nhân viên đăng ký ca',
        content: `${who} vừa đăng ký ${shiftName}${when}.`,
        type: NotificationType.SYSTEM,
        priority: NotificationPriority.NORMAL,
        // App chủ: mở thẳng màn duyệt ca.
        actionUrl: '/(work-shift-v2)/approval',
        metadata: {
          type: 'SHIFT_REGISTRATION',
          storeId,
          slotId,
          employeeProfileId: employeeId,
          // Lets the list re-label "hôm nay / ngày mai" at read time.
          ...(dated ? { workDate, workDates: [workDate] } : {}),
        },
      });
    } catch (error) {
      this.logger.warn(
        `[registerToShiftSlot] could not notify the owner of store ${storeId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async getShiftAssignments(
    this: StoresService,
    storeId: string,
    filters: { cycleId?: string; status?: string },
    ownerAccountId?: string,
  ) {
    if (ownerAccountId)
      await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    const qb = this.shiftAssignmentRepository
      .createQueryBuilder('assignment')
      .leftJoinAndSelect('assignment.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.workShift', 'workShift')
      .leftJoinAndSelect('slot.cycle', 'cycle')
      .leftJoinAndSelect('assignment.employee', 'employee')
      .leftJoinAndSelect('employee.account', 'account')
      .where('cycle.storeId = :storeId', { storeId })
      .orderBy('assignment.createdAt', 'DESC');

    if (filters.cycleId) {
      qb.andWhere('slot.cycleId = :cycleId', { cycleId: filters.cycleId });
    }
    if (filters.status) {
      qb.andWhere('assignment.status = :status', { status: filters.status });
    }

    const result = await qb.getMany();
    // A debug block used to run here on every call: two extra aggregate
    // queries, an unfiltered `find()` over the whole shift_assignments
    // table across all tenants, and per-row console output. It was a
    // full-table scan and a cross-tenant leak into the logs on a hot read
    // path. Removed; the query above is the actual result.
    return result;
  }

  async updateAssignmentStatus(
    this: StoresService,
    assignmentId: string,
    status: string,
    note?: string,
    ownerAccountId?: string,
  ) {
    const assignment = await this.shiftAssignmentRepository.findOne({
      where: { id: assignmentId },
      relations: ['shiftSlot', 'shiftSlot.cycle', 'shiftSlot.workShift'],
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    const storeId = assignment.shiftSlot?.cycle?.storeId;
    if (!storeId)
      throw new BadRequestException('Assignment không thuộc cửa hàng');
    if (!ownerAccountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    if (
      ![
        ShiftAssignmentStatus.APPROVED,
        ShiftAssignmentStatus.CONFIRMED,
        ShiftAssignmentStatus.CANCELLED,
      ].includes(status as ShiftAssignmentStatus)
    ) {
      throw new BadRequestException('Trạng thái assignment không hợp lệ');
    }

    const nextStatus = status as ShiftAssignmentStatus;
    const allowedTransitions: Record<
      ShiftAssignmentStatus,
      ShiftAssignmentStatus[]
    > = {
      [ShiftAssignmentStatus.PENDING]: [
        ShiftAssignmentStatus.APPROVED,
        ShiftAssignmentStatus.CANCELLED,
      ],
      [ShiftAssignmentStatus.APPROVED]: [
        ShiftAssignmentStatus.CONFIRMED,
        ShiftAssignmentStatus.CANCELLED,
      ],
      [ShiftAssignmentStatus.CONFIRMED]: [],
      [ShiftAssignmentStatus.COMPLETED]: [],
      [ShiftAssignmentStatus.CANCELLED]: [],
    };
    if (!allowedTransitions[assignment.status]?.includes(nextStatus)) {
      throw new BadRequestException(
        'Không thể chuyển trạng thái assignment hiện tại',
      );
    }

    return this.dataSource
      .transaction(async (manager) => {
        await lockStoreShiftAvailability(manager, storeId);
        const store = await manager.findOne(Store, {
          where: { id: storeId },
          select: ['id', 'ownerAccountId'],
        });
        if (
          !ownerAccountId ||
          !store ||
          store.ownerAccountId !== ownerAccountId
        ) {
          throw new ForbiddenException(
            'Bạn không có quyền cập nhật assignment này',
          );
        }
        const current = await manager.findOne(ShiftAssignment, {
          where: { id: assignmentId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!current) throw new NotFoundException('Assignment not found');
        if (!allowedTransitions[current.status]?.includes(nextStatus)) {
          throw new BadRequestException(
            'Không thể chuyển trạng thái assignment hiện tại',
          );
        }
        const previousStatus = current.status;
        current.status = nextStatus;
        if (note !== undefined) current.note = note;
        const saved = await manager.save(ShiftAssignment, current);
        const statusAction =
          previousStatus === ShiftAssignmentStatus.PENDING
            ? nextStatus === ShiftAssignmentStatus.APPROVED
              ? ACTIVITY_ACTIONS.SHIFT_REGISTRATION_APPROVED
              : nextStatus === ShiftAssignmentStatus.CANCELLED
                ? ACTIVITY_ACTIONS.SHIFT_REGISTRATION_REJECTED
                : null
            : nextStatus === ShiftAssignmentStatus.CANCELLED
              ? ACTIVITY_ACTIONS.SHIFT_REGISTRATION_CANCELLED
              : null;
        if (statusAction) {
          await this.logActivity(manager, {
            storeId,
            actorAccountId: ownerAccountId,
            subjectEmployeeProfileId: current.employeeId,
            action: statusAction,
            resourceType: 'shift_assignment',
            resourceId: assignmentId,
            params: this.activityShiftParams(assignment.shiftSlot),
            idempotencyKey: `${statusAction}:${assignmentId}`,
          });
        }
        return { saved, previousStatus };
      })
      .then(async ({ saved, previousStatus }) => {
        // Transaction đã kiểm lại chuyển trạng thái dưới khoá, nên trạng thái
        // đọc trước đó là PENDING nghĩa là đây đúng là lần duyệt ca đăng ký.
        if (
          assignment.status === ShiftAssignmentStatus.PENDING &&
          nextStatus === ShiftAssignmentStatus.APPROVED
        ) {
          void this.notifyEmployeesOfNewShifts([assignmentId], 'approved');
        }
        // The owner took someone off a booked shift: the seat is free again.
        // (Rejecting a PENDING registration is a decision on a request, not an
        // unassignment, and is not announced.)
        if (
          previousStatus === ShiftAssignmentStatus.APPROVED &&
          nextStatus === ShiftAssignmentStatus.CANCELLED
        ) {
          void this.announceFreeSeatsOfSlot(
            saved.shiftSlotId,
            'assignment_cancelled',
            [saved.employeeId],
          ).catch(() => undefined);
        }
        // After commit, from the status read under the lock. The owner app
        // approves through this route, which scheduled no reminder before.
        await this.syncReminderAfterAssignmentStatusChange(
          assignmentId,
          previousStatus,
          nextStatus,
        );
        return saved;
      });
  }

  async assertSlotOwnerAccess(
    this: StoresService,
    slotId: string,
    ownerAccountId: string,
  ) {
    const slot = await this.shiftSlotRepository.findOne({
      relations: ['cycle'],
      where: { id: slotId },
    });
    if (!slot) throw new NotFoundException('Shift slot not found');
    await this.assertOwnerStoreAccess(
      slot.cycle?.storeId || '',
      ownerAccountId,
    );
  }

  async assertAssignmentOwnerAccess(
    this: StoresService,
    assignmentId: string,
    ownerAccountId: string,
  ) {
    const assignment = await this.shiftAssignmentRepository.findOne({
      relations: ['shiftSlot', 'shiftSlot.cycle'],
      where: { id: assignmentId },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    await this.assertOwnerStoreAccess(
      assignment.shiftSlot?.cycle?.storeId || '',
      ownerAccountId,
    );
  }

  // ==================== SHIFT SWAP MANAGEMENT ====================

  async createShiftSwap(
    this: StoresService,
    data: {
      fromAssignmentId: string;
      toEmployeeId: string;
      requestedByEmployeeId: string;
      note?: string;
    },
    accountId?: string,
  ) {
    if (!accountId)
      throw new ForbiddenException('Không xác định được tài khoản');
    const source = await this.shiftAssignmentRepository.findOne({
      where: { id: data.fromAssignmentId },
      relations: ['shiftSlot', 'shiftSlot.cycle'],
    });
    if (!source) throw new NotFoundException('Assignment không tồn tại');
    const storeId = source.shiftSlot?.cycle?.storeId;
    if (!storeId)
      throw new BadRequestException('Assignment không thuộc chu kỳ hợp lệ');
    const requester = await this.profileRepository.findOne({
      where: {
        id: data.requestedByEmployeeId,
        accountId,
        storeId,
        employmentStatus: In([...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]),
      },
      select: ['id'],
    });
    if (!requester || source.employeeId !== requester.id) {
      throw new ForbiddenException(
        'Bạn chỉ có thể yêu cầu đổi ca của chính mình',
      );
    }
    const target = await this.profileRepository.findOne({
      where: {
        id: data.toEmployeeId,
        storeId,
        employmentStatus: In([...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]),
      },
      select: ['id'],
    });
    if (!target)
      throw new BadRequestException(
        'Nhân viên nhận ca không thuộc cửa hàng hoặc đã ngừng hoạt động',
      );
    if (source.status === ShiftAssignmentStatus.CANCELLED)
      throw new BadRequestException('Assignment đã bị hủy');
    const swap = this.shiftSwapRepository.create({
      fromAssignmentId: source.id,
      toEmployeeId: target.id,
      requestedByEmployeeId: requester.id,
      note: data.note,
      status: ShiftSwapStatus.PENDING,
    });
    return this.shiftSwapRepository.save(swap);
  }

  async updateShiftSwapStatus(
    this: StoresService,
    swapId: string,
    status: string,
    note?: string,
    accountId?: string,
  ) {
    if (!accountId)
      throw new ForbiddenException('Không xác định được tài khoản');
    if (
      ![ShiftSwapStatus.APPROVED, ShiftSwapStatus.REJECTED].includes(
        status as ShiftSwapStatus,
      )
    ) {
      throw new BadRequestException('Trạng thái đổi ca không hợp lệ');
    }
    const nextStatus = status as ShiftSwapStatus;
    const swap = await this.shiftSwapRepository.findOne({
      where: { id: swapId },
      relations: [
        'fromAssignment',
        'fromAssignment.shiftSlot',
        'fromAssignment.shiftSlot.cycle',
      ],
    });
    if (!swap) throw new NotFoundException('Shift swap request not found');
    if (swap.status !== ShiftSwapStatus.PENDING)
      throw new BadRequestException('Yêu cầu đổi ca không còn chờ duyệt');
    const storeId = swap.fromAssignment?.shiftSlot?.cycle?.storeId || '';
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      select: ['id', 'ownerAccountId'],
    });
    if (!store) throw new NotFoundException('Cửa hàng không tồn tại');
    const isOwner = store.ownerAccountId === accountId;
    if (!isOwner) {
      const caller = await this.profileRepository.findOne({
        where: {
          accountId,
          storeId,
          employmentStatus: In([...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]),
        },
        select: ['id'],
      });
      if (
        !caller ||
        ![swap.requestedByEmployeeId, swap.toEmployeeId].includes(caller.id)
      ) {
        throw new ForbiddenException(
          'Bạn không có quyền cập nhật yêu cầu đổi ca này',
        );
      }
    }
    const target = await this.profileRepository.findOne({
      where: {
        id: swap.toEmployeeId,
        storeId,
        employmentStatus: In([...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]),
      },
      select: ['id'],
    });
    if (!target)
      throw new BadRequestException(
        'Nhân viên nhận ca không thuộc cửa hàng hoặc đã ngừng hoạt động',
      );
    return this.dataSource.transaction(async (manager) => {
      await lockStoreShiftAvailability(manager, storeId);
      const lockedStore = await manager.findOne(Store, {
        where: { id: storeId },
        select: ['id', 'ownerAccountId'],
      });
      if (!lockedStore) throw new NotFoundException('Cửa hàng không tồn tại');
      if (lockedStore.ownerAccountId !== accountId) {
        const lockedCaller = await manager.findOne(EmployeeProfile, {
          where: {
            accountId,
            storeId,
            employmentStatus: In([...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]),
          },
          select: ['id'],
        });
        if (
          !lockedCaller ||
          ![swap.requestedByEmployeeId, swap.toEmployeeId].includes(
            lockedCaller.id,
          )
        ) {
          throw new ForbiddenException(
            'Bạn không có quyền cập nhật yêu cầu đổi ca này',
          );
        }
      }
      const lockedTarget = await manager.findOne(EmployeeProfile, {
        where: {
          id: swap.toEmployeeId,
          storeId,
          employmentStatus: In([...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]),
        },
        select: ['id'],
      });
      if (!lockedTarget) {
        throw new BadRequestException(
          'Nhân viên nhận ca không thuộc cửa hàng hoặc đã ngừng hoạt động',
        );
      }
      if (nextStatus === ShiftSwapStatus.APPROVED) {
        const assignmentResult = await manager.update(
          ShiftAssignment,
          {
            id: swap.fromAssignment.id,
            employeeId: swap.fromAssignment.employeeId,
          },
          // The approved late arrival / early leave was the other employee's.
          { employeeId: swap.toEmployeeId, ...CLEARED_SHIFT_REQUEST_EFFECTS },
        );
        if (!assignmentResult.affected)
          throw new BadRequestException(
            'Ca đã được thay đổi, vui lòng tải lại',
          );
      }
      const swapResult = await manager.update(
        ShiftSwap,
        { id: swap.id, status: ShiftSwapStatus.PENDING },
        { status: nextStatus, note },
      );
      if (!swapResult.affected)
        throw new BadRequestException(
          'Yêu cầu đổi ca đã được cập nhật, vui lòng tải lại',
        );
      return { ...swap, status: nextStatus, note };
    });
  }

  // --- Store Shift Config ---
  async createDefaultShiftConfig(this: StoresService, storeId: string) {
    const defaultConfig = this.shiftConfigRepository.create({
      storeId,
      daysOff: [WeekDay.SATURDAY, WeekDay.SUNDAY],
      noApprovalDays: [WeekDay.SATURDAY, WeekDay.SUNDAY],
      timekeepingRequirement: TimekeepingRequirement.LOCATION_QR_GPS_FACEID,
      isActive: true,
    });
    return this.shiftConfigRepository.save(defaultConfig);
  }

  async getShiftConfig(this: StoresService, storeId: string) {
    let config = await this.shiftConfigRepository.findOne({
      where: { storeId },
    });
    if (!config) {
      config = await this.createDefaultShiftConfig(storeId);
    }
    return config;
  }

  async upsertShiftConfig(
    this: StoresService,
    storeId: string,
    data: UpdateStoreShiftConfigDto,
  ) {
    // GPS + QR without FaceID measures every check-in against the store's
    // coordinates: without them nobody could check in.
    if (data.timekeepingRequirement === TimekeepingRequirement.GPS_QR) {
      const store = await this.storeRepository.findOne({
        where: { id: storeId },
        select: ['id', 'latitude', 'longitude'],
      });
      if (store?.latitude == null || store?.longitude == null) {
        throw new BadRequestException({
          code: STORE_LOCATION_REQUIRED_CODE,
          message:
            'Hãy thiết lập vị trí cửa hàng trước khi chọn chấm công GPS + QR.',
        });
      }
    }
    let config = await this.shiftConfigRepository.findOne({
      where: { storeId },
    });
    const hours = (value?: string) =>
      value ? `${value.slice(0, 5)}:00` : undefined;
    // A first save stores the column defaults (06:00 / 22:00) for what it
    // leaves out, so those are what the other value is checked against.
    const openTime = hours(data.openTime) ?? config?.openTime ?? '06:00:00';
    const closeTime = hours(data.closeTime) ?? config?.closeTime ?? '22:00:00';
    if (
      openTime &&
      closeTime &&
      openTime.slice(0, 5) === closeTime.slice(0, 5)
    ) {
      throw new BadRequestException('Giờ mở cửa và đóng cửa phải khác nhau.');
    }
    data = {
      ...data,
      ...(data.openTime ? { openTime: hours(data.openTime) } : {}),
      ...(data.closeTime ? { closeTime: hours(data.closeTime) } : {}),
    };

    if (config) {
      Object.assign(config, data);
    } else {
      config = this.shiftConfigRepository.create({
        ...data,
        storeId,
      });
    }

    return this.shiftConfigRepository.save(config);
  }

  /**
   * The next APPROVED, not-yet-started shift in this store from today (VN)
   * on, or null. Bounded look-ahead of 20 rows.
   */
  async findNextUpcomingShift(
    this: StoresService,
    employeeProfileId: string,
    storeId: string,
    todayStr: string,
    now: Date,
  ): Promise<{
    assignmentId: string;
    workDate: string;
    startTime: string;
    endTime: string;
    shiftName: string;
    startsAt: string;
  } | null> {
    const candidates = await this.shiftAssignmentRepository
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .leftJoin('slot.cycle', 'cycle')
      .where('a.employeeId = :employeeProfileId', { employeeProfileId })
      .andWhere('a.status = :status', {
        status: ShiftAssignmentStatus.APPROVED,
      })
      .andWhere('a.checkInTime IS NULL')
      .andWhere('slot.workDate >= :todayStr', { todayStr })
      .andWhere('cycle.storeId = :storeId', { storeId })
      .orderBy('slot.workDate', 'ASC')
      // Effective start: a slot's own start time overrides its work shift's,
      // so order by the same time the loop below resolves.
      .addOrderBy('COALESCE(slot.start_time, ws.start_time)', 'ASC')
      .addOrderBy('a.id', 'ASC')
      // Many-to-one joins only, so a plain LIMIT is exact.
      .limit(20)
      .getMany();
    for (const candidate of candidates) {
      const slot = candidate.shiftSlot;
      const startTime = slot?.startTime ?? slot?.workShift?.startTime;
      const endTime = slot?.endTime ?? slot?.workShift?.endTime;
      const workDate = String(slot?.workDate ?? '').slice(0, 10);
      const { start } = resolveShiftBoundaries(workDate, startTime, endTime);
      if (!start || start.getTime() <= now.getTime()) continue;
      return {
        assignmentId: candidate.id,
        workDate,
        startTime: startTime || '',
        endTime: endTime || '',
        shiftName: slot?.workShift?.shiftName || '',
        startsAt: start.toISOString(),
      };
    }
    return null;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SHIFT REGISTRATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Nhân viên gửi đề xuất đăng ký ca làm việc.
   * Nếu có slotId → gắn vào slot cụ thể (registerToShiftSlot flow).
   * Nếu không có slotId → tạo ShiftRegistration dạng đề xuất tổng quát.
   */
  /**
   * Cancels an employee's upcoming shift registrations at a store.
   *
   * A "fixed" registration is not a record of its own — it fans out into one
   * ShiftAssignment per matching slot with nothing tying them together. So
   * turning the fixed schedule off cannot delete "the registration"; what it
   * can do, and what this does, is withdraw the shifts it produced that have
   * not started yet.
   *
   * Deliberately narrow:
   *   - today and later only, so worked history is never rewritten;
   *   - APPROVED with no check-in, so a shift already under way is untouched;
   *   - scoped to the caller's own profile.
   */
  async cancelUpcomingShiftRegistrations(
    this: StoresService,
    storeId: string,
    employeeProfileId: string,
    callerAccountId: string,
    workShiftId?: string,
  ): Promise<{ cancelled: number }> {
    const caller = await this.profileRepository.findOne({
      where: { id: employeeProfileId, accountId: callerAccountId, storeId },
      select: ['id'],
    });
    if (!caller) {
      throw new ForbiddenException('Bạn chỉ có thể huỷ ca của chính mình');
    }

    // Vietnam calendar day and start instant, whatever the server TZ.
    const now = new Date();
    const today = vnDateString(now);
    const query = this.shiftAssignmentRepository
      .createQueryBuilder('a')
      .innerJoin('a.shiftSlot', 'slot')
      .innerJoin('slot.cycle', 'cycle')
      .leftJoin('slot.workShift', 'ws')
      .select('a.id', 'id')
      .addSelect('a.status', 'status')
      .addSelect('slot.id', 'slotId')
      .addSelect('slot.workDate', 'workDate')
      .addSelect('slot.startTime', 'slotStartTime')
      .addSelect('ws.startTime', 'shiftStartTime')
      .where('a.employeeId = :employeeProfileId', { employeeProfileId })
      .andWhere('cycle.storeId = :storeId', { storeId })
      .andWhere('a.checkInTime IS NULL')
      .andWhere('slot.workDate >= :today', { today })
      .andWhere(
        new Brackets((origin) => {
          // No origin column exists, so self-registration is inferred:
          // - PENDING: only a staff self-registration (fixed or one-off)
          //   is created PENDING; every owner assignment is created APPROVED.
          origin.where('a.status = :pending', {
            pending: ShiftAssignmentStatus.PENDING,
          });
          // - APPROVED: a self-registration the owner approved later, i.e.
          //   the row changed after it was inserted. An owner assignment is
          //   inserted APPROVED (updated_at = created_at) and is never
          //   touched before check-in; the known owner notes are excluded too.
          origin.orWhere(
            new Brackets((approved) => {
              approved
                .where('a.status = :approved', {
                  approved: ShiftAssignmentStatus.APPROVED,
                })
                .andWhere("a.updated_at > a.created_at + interval '2 seconds'")
                .andWhere(
                  '(a.note IS NULL OR a.note NOT IN (:...ownerNotes))',
                  { ownerNotes: [...OWNER_ASSIGNMENT_NOTES] },
                );
            }),
          );
        }),
      );
    if (workShiftId) {
      query.andWhere('slot.workShiftId = :workShiftId', { workShiftId });
    }

    const rows = await query.getRawMany<{
      id: string;
      status: ShiftAssignmentStatus;
      slotId?: string;
      workDate: string | Date;
      slotStartTime: string | null;
      shiftStartTime: string | null;
    }>();
    // Only shifts that have not started yet (VN time).
    const doomed = rows.filter(
      (row) =>
        !isSlotRegistrationClosed(
          { workDate: row.workDate, startTime: row.slotStartTime },
          { startTime: row.shiftStartTime },
          now,
        ),
    );
    if (doomed.length === 0) return { cancelled: 0 };

    // Guarded write: a row checked in or decided meanwhile is left alone.
    await this.shiftAssignmentRepository.update(
      {
        id: In(doomed.map((a) => a.id)),
        status: In([
          ShiftAssignmentStatus.PENDING,
          ShiftAssignmentStatus.APPROVED,
        ]),
        checkInTime: IsNull(),
      },
      { status: ShiftAssignmentStatus.CANCELLED },
    );
    // No transaction here: the entry is written right after the guarded write.
    await this.logActivity(null, {
      storeId,
      actorAccountId: callerAccountId,
      subjectEmployeeProfileId: employeeProfileId,
      action: ACTIVITY_ACTIONS.SHIFT_REGISTRATION_UPCOMING_CANCELLED,
      resourceType: 'shift_assignment',
      params: { count: doomed.length },
    });
    const approvedIds = doomed
      .filter((a) => a.status === ShiftAssignmentStatus.APPROVED)
      .map((a) => a.id);
    if (approvedIds.length) {
      try {
        await this.shiftReminderService.cancelAssignmentReminders(approvedIds);
      } catch {
        this.logger.error('Failed to cancel reminders of withdrawn shifts');
      }
    }
    // The withdrawn seats are free again: tell the store's other eligible
    // staff (not the person who withdrew), with the free-seat throttle, one
    // aggregated notice per account. Only not-yet-started slots were
    // withdrawn, and the announcement re-checks seats and start time.
    // After the write, best effort, never awaited by the caller.
    const freedSlotIds = doomed
      .map((row) => row.slotId)
      .filter((slotId): slotId is string => !!slotId);
    if (freedSlotIds.length) {
      void this.announceFreeSeatsOfSlots(freedSlotIds, 'self_cancelled', [
        employeeProfileId,
      ]).catch(() => undefined);
    }
    return { cancelled: doomed.length };
  }

  /**
   * Last day a fixed-shift registration covers. With an end date, that date
   * (never before the start). Without one (the staff app's "vô thời hạn"),
   * every slot of the shift already open in the store's ACTIVE cycles from
   * the start date, capped at 366 days. Slots the nightly job adds later are
   * not registered automatically.
   */
  async resolveFixedShiftRangeEnd(
    this: StoresService,
    storeId: string,
    workShiftId: string,
    startDate: string,
    endDate: string | undefined,
  ): Promise<string> {
    if (endDate) {
      if (endDate < startDate) {
        throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu');
      }
      return endDate;
    }
    const start = String(startDate).slice(0, 10);
    let cap: string;
    try {
      cap = addDays(start, FIXED_SHIFT_MAX_RANGE_DAYS);
    } catch {
      throw new BadRequestException('Ngày bắt đầu không hợp lệ');
    }
    const row = await this.shiftSlotRepository
      .createQueryBuilder('slot')
      .innerJoin('slot.cycle', 'cycle')
      .select('MAX(slot.workDate)', 'latest')
      .where('slot.workShiftId = :workShiftId', { workShiftId })
      .andWhere('cycle.storeId = :storeId', { storeId })
      .andWhere('slot.workDate >= :startDate', { startDate })
      .andWhere('cycle.status = :activeStatus', {
        activeStatus: WorkCycleStatus.ACTIVE,
      })
      .getRawOne();
    const latestRaw = row?.latest;
    if (!latestRaw) return startDate;
    const latest =
      latestRaw instanceof Date
        ? [
            latestRaw.getFullYear(),
            String(latestRaw.getMonth() + 1).padStart(2, '0'),
            String(latestRaw.getDate()).padStart(2, '0'),
          ].join('-')
        : String(latestRaw).slice(0, 10);
    return latest < cap ? latest : cap;
  }

  async createShiftRegistration(
    this: StoresService,
    accountId: string,
    data: {
      storeId: string;
      employeeProfileId: string;
      workShiftId?: string;
      slotId?: string;
      startDate?: string;
      endDate?: string;
      daysOfWeek?: number[];
      note?: string;
    },
  ) {
    const callerProfile = await this.profileRepository.findOne({
      where: { id: data.employeeProfileId, accountId },
      select: ['id', 'storeId', 'employmentStatus', 'accountId'],
    });
    if (!callerProfile) {
      throw new ForbiddenException(
        'Bạn chỉ có thể đăng ký ca cho hồ sơ của mình',
      );
    }
    if (callerProfile.storeId !== data.storeId) {
      throw new ForbiddenException('Nhân viên không thuộc cửa hàng này');
    }
    if (!isShiftEligibleEmploymentStatus(callerProfile.employmentStatus)) {
      throw new BadRequestException(
        'Nhân viên không còn hoạt động, không thể đăng ký ca',
      );
    }
    // If slotId provided, delegate to existing registerToShiftSlot
    if (data.slotId) {
      return this.registerToShiftSlot(
        data.slotId,
        data.employeeProfileId,
        data.note,
        false,
        accountId,
      );
    }

    // Batch Registration (Fixed Shift)
    if (
      data.workShiftId &&
      data.startDate &&
      data.daysOfWeek &&
      data.daysOfWeek.length > 0
    ) {
      // Past days cannot be registered: a range that already ended is
      // rejected, and a start date before today (VN) moves to today.
      const todayVn = vnDateString(new Date());
      if (data.endDate && String(data.endDate).slice(0, 10) < todayVn) {
        throw new BadRequestException({
          code: SHIFT_REGISTRATION_RANGE_PASSED_CODE,
          message: SHIFT_REGISTRATION_RANGE_PASSED_MESSAGE,
        });
      }
      const startDate =
        String(data.startDate).slice(0, 10) < todayVn
          ? todayVn
          : data.startDate;
      // Fixed registration targets a shift of the settings list; a deleted
      // (hidden) shift is refused up front. Another store's id finds no
      // slots below (the slot query is store-scoped).
      const targetShift = await this.workShiftRepository.findOne({
        where: { id: data.workShiftId, storeId: data.storeId },
        select: ['id', 'isActive'],
      });
      if (targetShift?.isActive === false) {
        throw new BadRequestException({
          code: WORK_SHIFT_INACTIVE_CODE,
          message: WORK_SHIFT_INACTIVE_MESSAGE,
        });
      }
      const rangeEnd = await this.resolveFixedShiftRangeEnd(
        data.storeId,
        data.workShiftId,
        startDate,
        data.endDate,
      );
      const slots = await this.shiftSlotRepository
        .createQueryBuilder('slot')
        .leftJoinAndSelect('slot.cycle', 'cycle')
        .leftJoinAndSelect('slot.workShift', 'workShift')
        .where('slot.workShiftId = :workShiftId', {
          workShiftId: data.workShiftId,
        })
        .andWhere('cycle.storeId = :storeId', { storeId: data.storeId })
        .andWhere('slot.workDate >= :startDate', { startDate })
        .andWhere('slot.workDate <= :endDate', {
          endDate: rangeEnd,
        })
        .andWhere('cycle.status = :activeStatus', {
          activeStatus: WorkCycleStatus.ACTIVE,
        })
        .getMany();

      const matchedSlots = slots.filter((slot) => {
        // Safe parsing of YYYY-MM-DD
        let y, m, d;
        if (typeof slot.workDate === 'string') {
          [y, m, d] = slot.workDate.split('-');
        } else {
          // If TypeORM mapped it to a Date object
          const dateObj = slot.workDate as any;
          y = dateObj.getFullYear();
          m = dateObj.getMonth() + 1;
          d = dateObj.getDate();
        }
        const day = new Date(Number(y), Number(m) - 1, Number(d)).getDay();
        return (
          data.daysOfWeek!.includes(day) &&
          !isSlotRegistrationClosed(slot, slot.workShift)
        );
      });

      if (matchedSlots.length === 0) {
        throw new BadRequestException(
          'Không tìm thấy ca làm việc nào phù hợp với thời gian và các ngày đã chọn.',
        );
      }

      return this.dataSource.transaction(async (manager) => {
        await lockStoreShiftAvailability(manager, data.storeId);
        let successCount = 0;

        // Check employee status once
        const employee = await manager.findOne(EmployeeProfile, {
          where: { id: data.employeeProfileId },
        });
        if (!employee) {
          throw new NotFoundException('Không tìm thấy nhân viên');
        }
        if (!isShiftEligibleEmploymentStatus(employee.employmentStatus)) {
          throw new BadRequestException(
            'Nhân viên không còn hoạt động, không thể đăng ký ca',
          );
        }
        if (
          employee.storeId !== data.storeId ||
          employee.accountId !== accountId
        ) {
          throw new ForbiddenException('Nhân viên không thuộc cửa hàng này');
        }

        const now = new Date();

        for (const slot of matchedSlots) {
          // Pessimistic lock for this slot
          const lockedSlot = await manager
            .createQueryBuilder(ShiftSlot, 'slot')
            .setLock('pessimistic_write')
            .where('slot.id = :slotId', { slotId: slot.id })
            .getOne();

          if (!lockedSlot) continue; // Should exist, but just in case

          const lockedCycle = await manager.findOne(WorkCycle, {
            where: { id: lockedSlot.cycleId },
          });
          if (!lockedCycle || lockedCycle.storeId !== data.storeId) continue;

          const lockedWorkShift = await manager.findOne(WorkShift, {
            where: { id: lockedSlot.workShiftId },
          });

          // Authoritative re-check under the lock: skip slots that already
          // started or are in the past (VN time).
          if (isSlotRegistrationClosed(lockedSlot, lockedWorkShift, now)) {
            continue;
          }

          // Check deadline
          if (
            slot.cycle?.registrationDeadline &&
            now > new Date(slot.cycle.registrationDeadline)
          ) {
            continue; // Passed deadline, skip
          }

          // Check capacity
          const assignments = await manager.find(ShiftAssignment, {
            where: { shiftSlotId: lockedSlot.id },
          });

          const activeCount =
            assignments.filter(
              (a) => a.status !== ShiftAssignmentStatus.CANCELLED,
            ).length || 0;

          const maxRequired =
            lockedSlot.maxStaff ?? lockedWorkShift?.defaultMaxStaff ?? 0;
          if (maxRequired > 0 && activeCount >= maxRequired) {
            continue; // Slot is full, skip
          }

          // Check if employee already registered
          const existing = assignments.find(
            (a) =>
              a.employeeId === data.employeeProfileId &&
              a.status !== ShiftAssignmentStatus.CANCELLED,
          );
          if (existing) {
            continue; // Already registered, skip
          }

          // Create assignment
          const assignment = manager.create(ShiftAssignment, {
            shiftSlotId: lockedSlot.id,
            employeeId: data.employeeProfileId,
            note: data.note,
            status: ShiftAssignmentStatus.PENDING,
          });
          await manager.save(assignment);
          successCount++;
        }

        if (successCount === 0) {
          throw new BadRequestException(
            'Tất cả các ca bạn chọn đều đã đầy, đã bắt đầu hoặc bạn đã đăng ký.',
          );
        }

        // One entry for the whole fixed-shift registration, not one per slot.
        const firstSlot = matchedSlots[0];
        await this.logActivity(manager, {
          storeId: data.storeId,
          actorAccountId: accountId,
          subjectEmployeeProfileId: data.employeeProfileId,
          action: ACTIVITY_ACTIONS.SHIFT_REGISTRATION_BATCH_CREATED,
          resourceType: 'shift_assignment',
          params: {
            shiftName: firstSlot?.workShift?.shiftName,
            fromDate: toActivityDate(startDate),
            toDate: toActivityDate(rangeEnd),
            count: successCount,
          },
        });

        return { successCount };
      });
    }

    // Fallback for single shift registration by workShiftId + startDate (legacy compatibility)
    let targetSlotId: string | null = null;
    if (data.workShiftId && data.startDate) {
      const slot = await this.shiftSlotRepository.findOne({
        where: {
          workShiftId: data.workShiftId,
          workDate: data.startDate, // Explicitly match workDate so we get the exact slot
          cycle: { storeId: data.storeId, status: WorkCycleStatus.ACTIVE },
        } as any,
      });
      if (slot) targetSlotId = slot.id;
    }

    if (targetSlotId) {
      return this.registerToShiftSlot(
        targetSlotId,
        data.employeeProfileId,
        data.note,
        false,
        accountId,
      );
    }

    // No available slot found
    throw new BadRequestException(
      'Không tìm thấy slot ca phù hợp. Vui lòng chọn ca và ngày hợp lệ.',
    );
  }

  /**
   * Lấy danh sách đăng ký ca (shift registrations / proposals).
   */
  async getShiftRegistrations(
    this: StoresService,
    filters: {
      storeId?: string;
      employeeProfileId?: string;
      status?: string;
    },
    accountId?: string,
  ) {
    if (!accountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }

    let scopedStoreId = filters.storeId;
    if (filters.employeeProfileId) {
      const profile = await this.assertEmployeeCalendarAccess(
        filters.employeeProfileId,
        accountId,
        filters.storeId,
      );
      // Legacy employee callers may omit storeId. Resolve it from the
      // authorized profile so the assignment relation is still store-scoped.
      scopedStoreId = scopedStoreId || profile.storeId;
    } else if (scopedStoreId) {
      await this.assertOwnerStoreAccess(scopedStoreId, accountId);
    } else {
      throw new BadRequestException(
        'storeId hoặc employeeProfileId là bắt buộc',
      );
    }

    const where: any = {};
    // NOTE: ShiftAssignment entity has no storeId column (FK is through shiftSlot)
    // Only filter by employeeId and status directly
    if (filters.employeeProfileId) {
      if (!isUUID(filters.employeeProfileId)) {
        throw new BadRequestException(
          `employeeProfileId phải là UUID hợp lệ, nhận được: "${filters.employeeProfileId}"`,
        );
      }
      where.employeeId = filters.employeeProfileId;
    }
    if (scopedStoreId) {
      // Only count registrations on slots that belong to a live cycle
      // (ACTIVE/EXPIRED). Stopped/draft cycles' registrations are stale and
      // must not keep inflating the pending-approval badge.
      where.shiftSlot = {
        workShift: { storeId: scopedStoreId },
        cycle: {
          storeId: scopedStoreId,
          status: In([WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED]),
        },
      };
    }
    if (filters.status) where.status = filters.status;

    return this.shiftAssignmentRepository.find({
      where,
      relations: [
        'shiftSlot',
        'shiftSlot.cycle',
        'shiftSlot.workShift',
        'employee',
        'employee.account',
        'employee.storeRole',
        'employee.employeeType',
      ],
      order: { createdAt: 'DESC' },
    });
  }
}
