import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import {
  In,
  MoreThanOrEqual,
  LessThanOrEqual,
  Between,
  Not,
  IsNull,
  EntityManager,
} from 'typeorm';
import { isUUID } from 'class-validator';
import {
  ShiftChangeRequest,
  ShiftChangeRequestStatus,
} from '../entities/shift-change-request.entity';
import {
  BonusWorkRequest,
  BonusWorkRequestStatus,
} from '../entities/bonus-work-request.entity';
import { Store } from '../entities/store.entity';
import {
  EMPLOYED_STATUSES,
  EmployeeProfile,
  EmploymentStatus,
} from '../entities/employee-profile.entity';
import {
  EmployeeLeaveRequest,
  LeaveType,
  LeaveRequestStatus,
} from '../entities/employee-leave-request.entity';
import { AttendanceStatus } from '../entities/shift-management.entity';
import {
  ShiftAssignment,
  ShiftSwap,
  WorkCycleStatus,
  ShiftAssignmentStatus,
  ShiftSwapStatus,
} from '../entities/shift-management.entity';
import { StoreApprovalSettingDto } from '../dto/store-approval-setting.dto';
import { DEFAULT_MAX_OVERTIME_MINUTES } from '../dto/store-timekeeping-setting.dto';
import { lockStoreShiftAvailability } from '../shift-availability-lock';
import { parseDateOnly } from '../shift-schedule.utils';
import { StoreTimekeepingSetting } from '../entities/store-timekeeping-setting.entity';
import {
  NotificationPriority,
  NotificationType,
} from '../../notifications/entities/notification.entity';
import {
  ACTIVITY_ACTIONS,
  toActivityDate,
  toActivityHHmm,
} from '../activity-log.summary';
import { vnClockHHmm, vnDateString } from '../../../common/utils/vn-calendar';
import {
  describeOwnerRequestNotification,
  OWNER_REQUEST_NOTIFICATION_TYPE,
  type OwnerRequestKind,
} from '../owner-request-notification.utils';
import {
  calculateEarlyMinutes,
  calculateLateMinutes,
  effectiveWindowOf,
  formatDurationVi,
  resolveRequestedInstant,
} from '../attendance-time.utils';
import {
  applyGrace,
  creditedWorkedMinutes,
  resolveAttendanceRules,
} from '../attendance-rules';
import { overtimeEndAt } from '../shift-end-workflow.service';
import { SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES } from './shared';
import {
  normalizeLeaveType,
  parseLeaveTypeFilter,
  OVERTIME_SHIFT_MISMATCH,
  CLEARED_SHIFT_REQUEST_EFFECTS,
} from './shared';
import type { StoresService } from '../stores.service';

/**
 * A leave request date as YYYY-MM-DD. A full ISO timestamp keeps its date
 * part, which is what the `date` column did with it before; anything else
 * is 400.
 */
const normalizeLeaveDate = (raw: unknown): string => {
  const value =
    typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(raw)
      ? raw.slice(0, 10)
      : raw;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('Ngày của đơn không hợp lệ');
  }
  try {
    parseDateOnly(value);
  } catch {
    throw new BadRequestException('Ngày của đơn không hợp lệ');
  }
  return value;
};

/** "17:00:00" → "19:30:00" is 150; past midnight wraps; null when unknown. */
const overtimeLengthMinutes = (
  start?: string | null,
  end?: string | null,
): number | null => {
  const a = /^(\d{1,2}):(\d{2})/.exec(String(start ?? ''));
  const b = /^(\d{1,2}):(\d{2})/.exec(String(end ?? ''));
  if (!a || !b) return null;
  let minutes =
    Number(b[1]) * 60 + Number(b[2]) - (Number(a[1]) * 60 + Number(a[2]));
  if (minutes <= 0) minutes += 24 * 60;
  return minutes;
};

const isOvertimeShiftMismatch = (error: unknown): boolean => {
  if (!(error instanceof BadRequestException)) return false;
  const response = error.getResponse();
  return (
    typeof response === 'object' &&
    response !== null &&
    (response as { code?: string }).code === OVERTIME_SHIFT_MISMATCH
  );
};

/**
 * StoresRequestsPart: requests methods of StoresService, split out of stores.service.ts.
 * They still live on StoresService.prototype (applyClassParts), so DI, callers
 * and routes are unchanged; `this` is the StoresService instance.
 */
export class StoresRequestsPart {
  async createDefaultApprovalSetting(this: StoresService, storeId: string) {
    const defaultSetting = this.approvalSettingRepository.create({
      storeId,
      enableShiftRegistration: true,
      enableLeaveRequest: true,
      enableShiftSwap: true,
      leaveNoticeHours: 24,
      leaveLimitPerMonth: 2,
      swapNoticeHours: 12,
      swapLimitPerMonth: 2,
      lateEarlyNoticeHours: 2,
      lateEarlyLimitPerMonth: 2,
      shiftRegisterOpenTime: '08:00',
      shiftRegisterOpenDay: 'Monday',
      shiftRegisterCloseTime: '00:00',
      shiftRegisterCloseDay: 'Thursday',
      personnelWarningHours: 24,
      isActive: true,
    });
    return this.approvalSettingRepository.save(defaultSetting);
  }

  // --- Approval Settings ---
  async getApprovalSetting(this: StoresService, storeId: string) {
    let setting = await this.approvalSettingRepository.findOne({
      where: { storeId },
      relations: [
        'primaryApprover',
        'primaryApprover.account',
        'primaryApprover.storeRole',
        'backupApprover',
        'backupApprover.account',
        'backupApprover.storeRole',
      ],
    });

    if (!setting) {
      setting = await this.createDefaultApprovalSetting(storeId);
      // Re-fetch to get relations if needed, or just return defaults with nulls
      return setting;
    }

    const formatApprover = (profile: any) => {
      if (!profile) return null;
      return {
        id: profile.id,
        fullName: profile.account?.fullName || 'N/A',
        role: profile.storeRole?.name || 'Nhân viên',
      };
    };

    return {
      ...setting,
      primaryApprover: formatApprover(setting.primaryApprover),
      backupApprover: formatApprover(setting.backupApprover),
    };
  }

  async upsertApprovalSetting(
    this: StoresService,
    storeId: string,
    data: StoreApprovalSettingDto,
  ) {
    let setting = await this.approvalSettingRepository.findOne({
      where: { storeId },
    });

    if (setting) {
      Object.assign(setting, data);
    } else {
      setting = this.approvalSettingRepository.create({
        ...data,
        storeId,
      });
    }

    return this.approvalSettingRepository.save(setting);
  }

  async processRequest(
    this: StoresService,
    accountId: string,
    requestId: string,
    type: 'REGISTER' | 'SWAP' | 'LEAVE',
    status: 'APPROVED' | 'REJECTED',
    reason?: string,
  ) {
    if (!['APPROVED', 'REJECTED'].includes(status)) {
      throw new BadRequestException('Trạng thái yêu cầu không hợp lệ');
    }
    if (type === 'REGISTER') {
      const assignment = await this.shiftAssignmentRepository.findOne({
        where: { id: requestId },
        relations: ['shiftSlot', 'shiftSlot.cycle', 'shiftSlot.workShift'],
      });
      if (!assignment)
        throw new NotFoundException('Không tìm thấy yêu cầu đăng ký');
      await this.assertOwnerStoreAccess(
        assignment.shiftSlot?.cycle?.storeId || '',
        accountId,
      );
      if (assignment.status !== ShiftAssignmentStatus.PENDING) {
        throw new BadRequestException('Yêu cầu không còn chờ duyệt');
      }

      const nextStatus =
        status === 'APPROVED'
          ? ShiftAssignmentStatus.APPROVED
          : ShiftAssignmentStatus.CANCELLED;
      const savedAssignment = await this.dataSource.transaction(
        async (manager) => {
          const storeId = assignment.shiftSlot?.cycle?.storeId || '';
          await lockStoreShiftAvailability(manager, storeId);
          const store = await manager.findOne(Store, {
            where: { id: storeId },
            select: ['id', 'ownerAccountId'],
          });
          if (!store || store.ownerAccountId !== accountId) {
            throw new ForbiddenException(
              'Bạn không có quyền duyệt yêu cầu này',
            );
          }
          const result = await manager.update(
            ShiftAssignment,
            { id: requestId, status: ShiftAssignmentStatus.PENDING },
            {
              status: nextStatus,
              ...(status === 'REJECTED' && reason ? { note: reason } : {}),
            },
          );
          if (!result.affected) {
            throw new BadRequestException(
              'Yêu cầu đã được cập nhật, vui lòng tải lại',
            );
          }
          const registrationAction =
            status === 'APPROVED'
              ? ACTIVITY_ACTIONS.SHIFT_REGISTRATION_APPROVED
              : ACTIVITY_ACTIONS.SHIFT_REGISTRATION_REJECTED;
          await this.logActivity(manager, {
            storeId,
            actorAccountId: accountId,
            subjectEmployeeProfileId: assignment.employeeId,
            action: registrationAction,
            resourceType: 'shift_assignment',
            resourceId: requestId,
            params: this.activityShiftParams(assignment.shiftSlot),
            idempotencyKey: `${registrationAction}:${requestId}`,
          });
          return {
            ...assignment,
            status: nextStatus,
            ...(status === 'REJECTED' && reason ? { note: reason } : {}),
          };
        },
      );

      // Hook: Schedule reminder if approved
      if (savedAssignment.status === ShiftAssignmentStatus.APPROVED) {
        void this.syncReminderAfterAssignmentStatusChange(
          savedAssignment.id,
          ShiftAssignmentStatus.PENDING,
          ShiftAssignmentStatus.APPROVED,
        );
        void this.notifyEmployeesOfNewShifts([savedAssignment.id], 'approved');
      }

      return savedAssignment;
    } else if (type === 'SWAP') {
      const swap = await this.shiftSwapRepository.findOne({
        where: { id: requestId },
        relations: [
          'fromAssignment',
          'fromAssignment.shiftSlot',
          'fromAssignment.shiftSlot.cycle',
        ],
      });
      if (!swap) throw new NotFoundException('Không tìm thấy yêu cầu đổi ca');
      await this.assertOwnerStoreAccess(
        swap.fromAssignment?.shiftSlot?.cycle?.storeId || '',
        accountId,
      );
      if (swap.status !== ShiftSwapStatus.PENDING) {
        throw new BadRequestException('Yêu cầu không còn chờ duyệt');
      }

      const sourceStoreId =
        swap.fromAssignment?.shiftSlot?.cycle?.storeId || '';
      if (status === 'APPROVED') {
        const target = await this.profileRepository.findOne({
          where: {
            id: swap.toEmployeeId,
            storeId: sourceStoreId,
            employmentStatus: In([...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]),
          },
          select: ['id'],
        });
        if (!target)
          throw new BadRequestException(
            'Nhân viên nhận ca không thuộc cửa hàng hoặc đã ngừng hoạt động',
          );
      }

      return this.dataSource.transaction(async (manager) => {
        await lockStoreShiftAvailability(manager, sourceStoreId);
        const store = await manager.findOne(Store, {
          where: { id: sourceStoreId },
          select: ['id', 'ownerAccountId'],
        });
        if (!store || store.ownerAccountId !== accountId) {
          throw new ForbiddenException('Bạn không có quyền duyệt yêu cầu này');
        }
        if (status === 'APPROVED' && swap.fromAssignment) {
          const result = await manager.update(
            ShiftAssignment,
            {
              id: swap.fromAssignment.id,
              employeeId: swap.fromAssignment.employeeId,
            },
            // The approved late arrival / early leave was the other
            // employee's: the shift is back to its own hours.
            { employeeId: swap.toEmployeeId, ...CLEARED_SHIFT_REQUEST_EFFECTS },
          );
          if (!result.affected)
            throw new BadRequestException(
              'Ca đã được thay đổi, vui lòng tải lại',
            );
        }
        const nextStatus =
          status === 'APPROVED'
            ? ShiftSwapStatus.APPROVED
            : ShiftSwapStatus.REJECTED;
        const result = await manager.update(
          ShiftSwap,
          { id: swap.id, status: ShiftSwapStatus.PENDING },
          { status: nextStatus, note: reason },
        );
        if (!result.affected)
          throw new BadRequestException(
            'Yêu cầu đổi ca đã được cập nhật, vui lòng tải lại',
          );
        const swapAction =
          status === 'APPROVED'
            ? ACTIVITY_ACTIONS.SHIFT_SWAP_APPROVED
            : ACTIVITY_ACTIONS.SHIFT_SWAP_REJECTED;
        await this.logActivity(manager, {
          storeId: sourceStoreId,
          actorAccountId: accountId,
          subjectEmployeeProfileId: swap.requestedByEmployeeId,
          action: swapAction,
          resourceType: 'shift_swap',
          resourceId: swap.id,
          params: {
            workDate: toActivityDate(swap.fromAssignment?.shiftSlot?.workDate),
          },
          idempotencyKey: `${swapAction}:${swap.id}`,
        });
        return { ...swap, status: nextStatus, note: reason };
      });
    } else if (type === 'LEAVE') {
      const leave = await this.leaveRequestRepository.findOne({
        where: { id: requestId },
      });
      if (!leave) throw new NotFoundException('Không tìm thấy đơn nghỉ phép');
      await this.assertOwnerStoreAccess(leave.storeId, accountId);
      if (leave.status !== LeaveRequestStatus.PENDING) {
        throw new BadRequestException('Yêu cầu không còn chờ duyệt');
      }

      const approver = await this.profileRepository.findOne({
        where: { accountId, storeId: leave.storeId },
        select: ['id'],
      });

      const nextStatus =
        status === 'APPROVED'
          ? LeaveRequestStatus.APPROVED
          : LeaveRequestStatus.REJECTED;
      const processed = await this.dataSource.transaction(async (manager) => {
        await lockStoreShiftAvailability(manager, leave.storeId);
        const store = await manager.findOne(Store, {
          where: { id: leave.storeId },
          select: ['id', 'ownerAccountId'],
        });
        if (!store || store.ownerAccountId !== accountId) {
          throw new ForbiddenException('Bạn không có quyền duyệt yêu cầu này');
        }
        const result = await manager.update(
          EmployeeLeaveRequest,
          { id: requestId, status: LeaveRequestStatus.PENDING },
          {
            status: nextStatus,
            approvedById: (approver?.id ?? null) as any,
            ...(status === 'REJECTED' ? { rejectionReason: reason || '' } : {}),
          },
        );
        if (!result.affected) {
          throw new BadRequestException(
            'Yêu cầu đã được cập nhật, vui lòng tải lại',
          );
        }
        // An approved late arrival / early leave moves the shift's start /
        // end (same transaction: the status and the shift change together).
        const appliedShiftChange =
          status === 'APPROVED'
            ? await this.applyApprovedShiftChange(manager, leave)
            : null;
        const leaveAction =
          status === 'APPROVED'
            ? ACTIVITY_ACTIONS.LEAVE_REQUEST_APPROVED
            : ACTIVITY_ACTIONS.LEAVE_REQUEST_REJECTED;
        await this.logActivity(manager, {
          storeId: leave.storeId,
          actorAccountId: accountId,
          subjectEmployeeProfileId: leave.employeeProfileId,
          action: leaveAction,
          resourceType: 'leave_request',
          resourceId: leave.id,
          params: this.activityLeaveParams(leave),
          idempotencyKey: `${leaveAction}:${leave.id}`,
        });
        return {
          ...leave,
          ...(appliedShiftChange && !leave.shiftAssignmentId
            ? { shiftAssignmentId: appliedShiftChange.assignmentId }
            : {}),
          status: nextStatus,
          approvedById: approver?.id ?? null,
          ...(status === 'REJECTED' ? { rejectionReason: reason || '' } : {}),
          appliedShiftChange,
        };
      });
      if (nextStatus === LeaveRequestStatus.APPROVED) {
        void this.cancelRemindersCoveredByLeave(leave).catch(() => {
          this.logger?.error(
            'Failed to cancel reminders for an approved leave',
          );
        });
      }
      const change = processed.appliedShiftChange;
      // Late / early minutes of a finished shift changed: the payslip's
      // counters follow (worked minutes are never cut by an approval).
      if (change?.phase === 'after') {
        void this.processCheckoutPayroll(change.assignmentId).catch(() => {
          this.logger?.warn(
            'Payslip not refreshed after a late/early approval',
          );
        });
      }
      const kind =
        leave.type === LeaveType.LATE
          ? 'LATE'
          : leave.type === LeaveType.EARLY
            ? 'EARLY'
            : leave.type === LeaveType.OVERTIME
              ? 'OVERTIME'
              : leave.type === LeaveType.SUDDEN
                ? 'SUDDEN'
                : 'LEAVE';
      void this.notifyRequestDecision({
        employeeProfileId: leave.employeeProfileId,
        storeId: leave.storeId,
        requestId: leave.id,
        kind,
        approved: nextStatus === LeaveRequestStatus.APPROVED,
        reason: status === 'REJECTED' ? reason : null,
        assignmentId: change?.assignmentId ?? leave.shiftAssignmentId ?? null,
        workDate: String(leave.startDate).slice(0, 10),
        endDate: String(leave.endDate).slice(0, 10),
        // A time only when the shift really moved (or for a refusal): an
        // approval that changed nothing must not promise new hours, nor an
        // old-style overtime leave (it does not extend paid time).
        time: change
          ? vnClockHHmm(change.kind === 'EARLY' ? change.at : change.requested)
          : nextStatus === LeaveRequestStatus.APPROVED
            ? null
            : kind === 'LATE'
              ? leave.startTime
              : kind === 'EARLY'
                ? leave.endTime
                : null,
      });
      return processed;
    }

    throw new BadRequestException('Loại yêu cầu không hợp lệ');
  }

  /**
   * The shift a late / early-leave request is about: its own assignment, or
   * (older requests without one) the only shift of that day whose scheduled
   * window contains the requested time.
   */
  async resolveRequestAssignmentId(
    this: StoresService,
    manager: EntityManager,
    leave: EmployeeLeaveRequest,
    time: string,
  ): Promise<string | null> {
    if (leave.shiftAssignmentId) return leave.shiftAssignmentId;
    const workDate = String(leave.startDate).slice(0, 10);
    const candidates = await manager
      .getRepository(ShiftAssignment)
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .leftJoin('slot.cycle', 'cycle')
      .where('a.employeeId = :employeeId', {
        employeeId: leave.employeeProfileId,
      })
      .andWhere('cycle.storeId = :storeId', { storeId: leave.storeId })
      .andWhere('slot.workDate = :workDate', { workDate })
      .andWhere('a.status IN (:...statuses)', {
        statuses: [
          ShiftAssignmentStatus.APPROVED,
          ShiftAssignmentStatus.CONFIRMED,
          ShiftAssignmentStatus.COMPLETED,
        ],
      })
      .getMany();
    const matching = candidates.filter((a) => {
      const window = effectiveWindowOf({ shiftSlot: a.shiftSlot });
      return !!resolveRequestedInstant(window, workDate, time);
    });
    return matching.length === 1 ? matching[0].id : null;
  }

  /**
   * An approved late arrival ("xin đi trễ", requested arrival T) or early
   * leave ("xin về sớm", requested leave time T) moves the shift's start /
   * end to T, on the locked assignment row:
   *  - before check-in (late) / check-out (early): the shift starts / ends
   *    at T — not late before T, paid from / to T when counted by schedule;
   *  - late approved after check-in: never cuts time already worked (the
   *    start is not later than the check-in); the late minutes are redone;
   *  - early approved during the shift: ends at T, or now if T has passed;
   *  - early approved after check-out: only the early-leave mark goes
   *    (the end is not before the check-out).
   * Returns what changed, or null when the request does not fit a shift
   * (status-only approval, as before).
   */
  async applyApprovedShiftChange(
    this: StoresService,
    manager: EntityManager,
    leave: EmployeeLeaveRequest,
  ): Promise<{
    assignmentId: string;
    kind: 'LATE' | 'EARLY';
    phase: 'before' | 'during' | 'after';
    at: Date;
    /** The time the employee asked for (what the notification says). */
    requested: Date;
  } | null> {
    const kind =
      leave.type === LeaveType.LATE
        ? 'LATE'
        : leave.type === LeaveType.EARLY
          ? 'EARLY'
          : null;
    const time =
      kind === 'LATE'
        ? leave.startTime
        : kind === 'EARLY'
          ? leave.endTime
          : null;
    if (!kind || !time) return null;
    const assignmentId = await this.resolveRequestAssignmentId(
      manager,
      leave,
      time,
    );
    if (!assignmentId) return null;

    const locked = await manager.findOne(ShiftAssignment, {
      where: { id: assignmentId, employeeId: leave.employeeProfileId },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !locked ||
      locked.status === ShiftAssignmentStatus.CANCELLED ||
      locked.attendanceStatus === AttendanceStatus.ABSENT
    ) {
      return null;
    }
    const withSlot = await manager.findOne(ShiftAssignment, {
      where: { id: assignmentId },
      relations: ['shiftSlot', 'shiftSlot.workShift', 'shiftSlot.cycle'],
    });
    const slot = withSlot?.shiftSlot;
    if (!slot || slot.cycle?.storeId !== leave.storeId) return null;
    const workDate = String(slot.workDate).slice(0, 10);
    const scheduled = effectiveWindowOf({ shiftSlot: slot });
    const requested = resolveRequestedInstant(scheduled, workDate, time);
    if (!requested) return null;
    const current = effectiveWindowOf({
      adjustedStartAt: locked.adjustedStartAt,
      adjustedEndAt: locked.adjustedEndAt,
      shiftSlot: slot,
    });
    const setting = await manager
      .getRepository(StoreTimekeepingSetting)
      .findOne({ where: { storeId: leave.storeId } });
    const rules = resolveAttendanceRules(setting);
    const checkIn = locked.checkInTime ? new Date(locked.checkInTime) : null;
    const checkOut = locked.checkOutTime ? new Date(locked.checkOutTime) : null;
    const updates: Partial<ShiftAssignment> = {};
    let phase: 'before' | 'during' | 'after';
    let at: Date;

    if (kind === 'LATE') {
      // Must still leave a shift to work.
      if (current.end && requested.getTime() >= current.end.getTime())
        return null;
      phase = !checkIn ? 'before' : !checkOut ? 'during' : 'after';
      // Never later than the check-in (time worked is not cut), never before
      // the scheduled start (arriving early is not paid more).
      at =
        checkIn && checkIn.getTime() < requested.getTime()
          ? checkIn
          : requested;
      if (scheduled.start && at.getTime() < scheduled.start.getTime()) {
        at = scheduled.start;
      }
      updates.adjustedStartAt = at;
      updates.lateRequestId = leave.id;
      if (checkIn) {
        updates.lateMinutes = applyGrace(
          calculateLateMinutes(at, checkIn),
          rules,
        );
      }
    } else {
      if (current.start && requested.getTime() <= current.start.getTime())
        return null;
      phase = !checkIn ? 'before' : !checkOut ? 'during' : 'after';
      at =
        phase === 'during'
          ? new Date(Math.max(requested.getTime(), Date.now()))
          : phase === 'after' &&
              checkOut &&
              checkOut.getTime() > requested.getTime()
            ? checkOut
            : requested;
      // Never past the end in force: an approval after the end must not
      // pay minutes beyond the shift without an approved overtime.
      if (current.end && at.getTime() > current.end.getTime()) at = current.end;
      updates.adjustedEndAt = at;
      updates.earlyRequestId = leave.id;
      if (checkOut) {
        updates.earlyMinutes = applyGrace(
          calculateEarlyMinutes(at, checkOut),
          rules,
        );
      }
    }

    // The attendance status follows the redone late / early minutes; an
    // automatic check-out keeps "Quên chấm công ra".
    if (
      checkIn &&
      locked.attendanceStatus !== AttendanceStatus.FORGOT_CHECKOUT
    ) {
      const late = Number(updates.lateMinutes ?? locked.lateMinutes) || 0;
      const early = checkOut
        ? Number(updates.earlyMinutes ?? locked.earlyMinutes) || 0
        : 0;
      updates.attendanceStatus =
        late > 0 && early > 0
          ? AttendanceStatus.LATE_AND_EARLY
          : late > 0
            ? AttendanceStatus.LATE
            : early > 0
              ? AttendanceStatus.EARLY
              : AttendanceStatus.ON_TIME;
    }
    await manager.update(ShiftAssignment, { id: assignmentId }, updates);
    if (!leave.shiftAssignmentId) {
      await manager.update(
        EmployeeLeaveRequest,
        { id: leave.id },
        {
          shiftAssignmentId: assignmentId,
        },
      );
    }
    return { assignmentId, kind, phase, at, requested };
  }

  /**
   * Tells the employee the owner decided their request (late, early leave,
   * leave or overtime): in-app row + push. Never fails the decision.
   */
  async notifyRequestDecision(
    this: StoresService,
    input: {
      employeeProfileId: string;
      storeId: string;
      requestId: string;
      kind: 'LATE' | 'EARLY' | 'LEAVE' | 'OVERTIME' | 'SUDDEN';
      approved: boolean;
      reason?: string | null;
      assignmentId?: string | null;
      workDate?: string | null;
      endDate?: string | null;
      /** HH:mm the request is about (arrival, leave or overtime end). */
      time?: string | null;
      /** Scheduled end (HH:mm), for a refused overtime. */
      shiftEnd?: string | null;
    },
  ): Promise<void> {
    try {
      const profile = await this.profileRepository.findOne({
        where: { id: input.employeeProfileId },
        select: ['id', 'accountId'],
      });
      if (!profile?.accountId) return;
      const day = (d?: string | null) => {
        const [, m, dd] = String(d || '')
          .slice(0, 10)
          .split('-');
        return m && dd ? `${dd}/${m}` : '';
      };
      const on = input.workDate ? ` ngày ${day(input.workDate)}` : '';
      const clock = String(input.time || '').slice(0, 5);
      const reasonText = input.reason?.trim()
        ? ` Lý do: ${input.reason.trim()}`
        : '';
      const label = {
        LATE: 'Đơn xin đi trễ',
        EARLY: 'Đơn xin về sớm',
        LEAVE: 'Đơn xin nghỉ',
        SUDDEN: 'Đơn xin nghỉ đột xuất',
        OVERTIME: 'Yêu cầu tăng ca',
      }[input.kind];
      const title = `${label} ${input.approved ? 'đã được duyệt' : 'bị từ chối'}`;
      let content: string;
      if (!input.approved) {
        content =
          input.kind === 'OVERTIME' && input.shiftEnd
            ? `Ca${on} vẫn kết thúc lúc ${String(input.shiftEnd).slice(0, 5)}.${reasonText}`
            : `${label}${on} không được chấp nhận.${reasonText}`;
      } else if (input.kind === 'LATE' && clock) {
        content = `Ca${on} bắt đầu lúc ${clock}. Đến trước ${clock} không bị tính trễ.`;
      } else if (input.kind === 'EARLY' && clock) {
        content = `Ca${on} kết thúc lúc ${clock}. Giờ làm được tính đến ${clock}.`;
      } else if (input.kind === 'OVERTIME' && clock) {
        content = `Ca${on} được tăng ca đến ${clock}. Giờ làm được tính đến ${clock}.`;
      } else if (input.kind === 'LEAVE') {
        const range =
          input.endDate && input.endDate !== input.workDate
            ? ` ${day(input.workDate)} – ${day(input.endDate)}`
            : on;
        content = `Đơn nghỉ${range} đã được chủ cửa hàng chấp nhận.`;
      } else {
        content = `${label}${on} đã được chủ cửa hàng chấp nhận.`;
      }
      const today = vnDateString();
      await this.notificationsService.create({
        accountId: profile.accountId,
        storeId: input.storeId,
        title,
        content,
        type:
          input.kind === 'OVERTIME'
            ? NotificationType.OVERTIME_REQUEST_STATUS
            : NotificationType.SHIFT_APPROVAL,
        priority: NotificationPriority.HIGH,
        actionUrl:
          input.workDate && String(input.workDate).slice(0, 10) === today
            ? '/(home)'
            : '/(home)/workshift',
        metadata: {
          type: input.approved ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED',
          requestKind: input.kind,
          requestId: input.requestId,
          assignmentId: input.assignmentId ?? null,
          workDate: input.workDate ?? null,
          ...(input.workDate
            ? { workDates: [String(input.workDate).slice(0, 10)] }
            : {}),
        },
      } as any);
    } catch (error) {
      this.logger.warn(
        `[notifyRequestDecision] request ${input.requestId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Tells the store owner a request arrived — late arrival, early leave,
   * sudden absence, leave, overtime, a payslip question or a salary advance —
   * with what was asked, so it can be decided from the notification. Sent
   * after the request is saved; never fails it.
   */
  async notifyOwnerOfRequest(
    this: StoresService,
    input: {
      storeId: string;
      employeeProfileId: string;
      kind: OwnerRequestKind;
      requestId: string;
      shiftAssignmentId?: string | null;
      workDate?: string | null;
      endDate?: string | null;
      time?: string | null;
      minutes?: number | null;
      reason?: string | null;
      amount?: number | null;
      question?: string | null;
      /** Who filed it: the owner filing for an employee is not told of it. */
      actorAccountId?: string | null;
    },
  ): Promise<void> {
    try {
      const [store, profile, assignment] = await Promise.all([
        this.storeRepository.findOne({
          where: { id: input.storeId },
          select: ['id', 'name', 'ownerAccountId'],
        }),
        this.profileRepository.findOne({
          where: { id: input.employeeProfileId },
          relations: ['account'],
        }),
        input.shiftAssignmentId
          ? this.shiftAssignmentRepository.findOne({
              where: { id: input.shiftAssignmentId },
              relations: ['shiftSlot', 'shiftSlot.workShift'],
            })
          : Promise.resolve(null),
      ]);
      if (!store?.ownerAccountId) return;
      if (input.actorAccountId && input.actorAccountId === store.ownerAccountId)
        return;
      const slot = assignment?.shiftSlot;
      const window = assignment ? effectiveWindowOf(assignment) : null;
      const workDate =
        (slot?.workDate ? String(slot.workDate).slice(0, 10) : null) ??
        (input.workDate ? String(input.workDate).slice(0, 10) : null);
      // Late / early: how long that is against the shift in force.
      let minutes = input.minutes ?? null;
      if (minutes == null && window && workDate && input.time) {
        const clock = /^(\d{1,2}):(\d{2})/.exec(String(input.time));
        const at = clock
          ? resolveRequestedInstant(
              window,
              workDate,
              `${clock[1].padStart(2, '0')}:${clock[2]}:00`,
            )
          : null;
        if (at && input.kind === 'LATE' && window.start) {
          minutes = Math.round(
            (at.getTime() - window.start.getTime()) / 60_000,
          );
        } else if (at && input.kind === 'EARLY' && window.end) {
          minutes = Math.round((window.end.getTime() - at.getTime()) / 60_000);
        }
      }
      const { title, content } = describeOwnerRequestNotification({
        kind: input.kind,
        who: profile?.account?.fullName?.trim() || 'Một nhân viên',
        shiftName: slot?.workShift?.shiftName ?? null,
        workDate,
        endDate: input.endDate ? String(input.endDate).slice(0, 10) : null,
        shiftStart: window?.start ? vnClockHHmm(window.start) : null,
        shiftEnd: window?.end ? vnClockHHmm(window.end) : null,
        time: input.time ?? null,
        minutes,
        reason: input.reason ?? null,
        amount: input.amount ?? null,
        question: input.question ?? null,
      });
      const isMoney =
        input.kind === 'SALARY_ADVANCE' || input.kind === 'SALARY_INQUIRY';
      await this.notificationsService.create({
        accountId: store.ownerAccountId,
        storeId: input.storeId,
        title,
        content,
        type: NotificationType.SYSTEM,
        priority: NotificationPriority.HIGH,
        // App chủ: đơn ca làm mở màn duyệt; ứng lương mở tab yêu cầu của
        // màn lương; câu hỏi về bảng lương đọc ngay trong thông báo.
        actionUrl:
          input.kind === 'SALARY_ADVANCE'
            ? '/(salary)?tab=yeu-cau'
            : input.kind === 'SALARY_INQUIRY'
              ? null
              : '/(work-shift-v2)/approval',
        metadata: {
          type: OWNER_REQUEST_NOTIFICATION_TYPE[input.kind],
          requestKind: input.kind,
          requestId: input.requestId,
          storeId: input.storeId,
          employeeProfileId: input.employeeProfileId,
          ...(input.shiftAssignmentId
            ? { assignmentId: input.shiftAssignmentId }
            : {}),
          ...(!isMoney && workDate ? { workDate, workDates: [workDate] } : {}),
        },
      } as any);
    } catch (error) {
      // Fire-and-forget: this must never reject (it is not awaited).
      this.logger?.warn(
        `[notifyOwnerOfRequest] ${input.kind} ${input.requestId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Leave Request Management (Staff)
  async createLeaveRequest(
    this: StoresService,
    storeId: string,
    data: Record<string, any>,
    accountId: string,
    files?: Express.Multer.File[],
  ) {
    // Employees submit their own requests. Binding the profile to the JWT stops
    // a client from filing (or, via a supplied `id`, overwriting) someone
    // else's request.
    await this.assertEmployeeSelfAccess(
      data?.employeeProfileId,
      accountId,
      storeId,
      'Bạn chỉ có thể gửi đơn cho chính mình',
    );

    const startDate = normalizeLeaveDate(data?.startDate);
    const endDate = normalizeLeaveDate(data?.endDate);
    if (endDate < startDate) {
      throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu');
    }
    // Released staff builds send 'LEAVE' (not an enum value: a 500 before).
    const type = normalizeLeaveType(data?.type) ?? LeaveType.PERSONAL;

    const attachments: string[] = [];
    if (files && files.length > 0) {
      files.forEach((file) => {
        attachments.push(`/uploads/${file.filename}`);
      });
    }

    let created: EmployeeLeaveRequest | null = null;
    const result = await this.dataSource.transaction(async (manager) => {
      // Serialise this employee's submissions (as createShiftChangeRequest
      // does) so a double submit cannot slip past the duplicate check.
      await manager.findOne(EmployeeProfile, {
        where: { id: data.employeeProfileId },
        select: ['id'],
        lock: { mode: 'pessimistic_write' },
      });
      const shiftAssignmentId = await this.resolveLeaveShiftAssignmentId(
        manager,
        storeId,
        data.employeeProfileId,
        data?.shiftAssignmentId,
      );

      // Late/Early/Absent screens in released builds submit twice (modal and
      // parent). An identical pending request is returned, not duplicated.
      const duplicate = await manager.findOne(EmployeeLeaveRequest, {
        where: {
          employeeProfileId: data.employeeProfileId,
          type,
          startDate,
          endDate,
          status: LeaveRequestStatus.PENDING,
          shiftAssignmentId: shiftAssignmentId ?? IsNull(),
        },
        order: { createdAt: 'DESC' },
      });
      if (duplicate) return duplicate;

      await this.assertShiftChangeRequestFits(
        manager,
        type,
        startDate,
        shiftAssignmentId,
        type === LeaveType.LATE ? data?.startTime : data?.endTime,
        data.employeeProfileId,
      );

      // Explicit allowlist. The previous `create({ ...data })` spread let a
      // client set `id` (turning the save into an update of an arbitrary row),
      // `approvedById`, `approvedAt` and every other column.
      const leaveRequest = manager.create(EmployeeLeaveRequest, {
        storeId,
        employeeProfileId: data.employeeProfileId,
        type,
        startDate,
        endDate,
        startTime: data.startTime,
        endTime: data.endTime,
        reason: data.reason,
        leaveDays: data.leaveDays,
        shiftAssignmentId: shiftAssignmentId ?? undefined,
        attachments,
        status: LeaveRequestStatus.PENDING,
      } as Partial<EmployeeLeaveRequest>);
      const saved = await manager.save(EmployeeLeaveRequest, leaveRequest);
      await this.logActivity(manager, {
        storeId,
        actorAccountId: accountId,
        subjectEmployeeProfileId: data.employeeProfileId,
        action: ACTIVITY_ACTIONS.LEAVE_REQUEST_CREATED,
        resourceType: 'leave_request',
        resourceId: saved.id,
        params: this.activityLeaveParams(saved),
        idempotencyKey: `${ACTIVITY_ACTIONS.LEAVE_REQUEST_CREATED}:${saved.id}`,
      });
      created = saved;
      return saved;
    });
    // A new request (not a resubmitted duplicate): tell the owner.
    const fresh = created as EmployeeLeaveRequest | null;
    if (fresh) {
      void this.notifyOwnerOfRequest({
        storeId,
        employeeProfileId: fresh.employeeProfileId,
        kind:
          fresh.type === LeaveType.LATE
            ? 'LATE'
            : fresh.type === LeaveType.EARLY
              ? 'EARLY'
              : fresh.type === LeaveType.SUDDEN
                ? 'SUDDEN'
                : fresh.type === LeaveType.OVERTIME
                  ? 'OVERTIME'
                  : 'LEAVE',
        requestId: fresh.id,
        shiftAssignmentId: fresh.shiftAssignmentId ?? null,
        workDate: String(fresh.startDate).slice(0, 10),
        endDate: String(fresh.endDate).slice(0, 10),
        time:
          fresh.type === LeaveType.LATE
            ? fresh.startTime
            : fresh.type === LeaveType.EARLY ||
                fresh.type === LeaveType.OVERTIME
              ? fresh.endTime
              : null,
        reason: fresh.reason ?? null,
        actorAccountId: accountId,
      });
    }
    return result;
  }

  /**
   * A late arrival must be asked for a time still ahead; late / early times
   * must fall inside the shift. One late and one early request per shift
   * once approved, and no early leave on a shift with overtime asked for.
   * Times in another format (older builds send "8:30AM") are not checked.
   */
  async assertShiftChangeRequestFits(
    this: StoresService,
    manager: EntityManager,
    type: LeaveType,
    startDate: string,
    shiftAssignmentId: string | null,
    rawTime: unknown,
    employeeProfileId?: string,
  ): Promise<void> {
    if (type !== LeaveType.LATE && type !== LeaveType.EARLY) return;
    const label = type === LeaveType.LATE ? 'đi trễ' : 'về sớm';
    const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(
      String(rawTime ?? '').trim(),
    );
    const clock = match ? `${match[1].padStart(2, '0')}:${match[2]}:00` : null;

    // Same row lock as "Xin tăng ca": an early leave and an overtime sent
    // together for one shift are checked one after the other, so they
    // cannot both get in.
    if (shiftAssignmentId) {
      // (No relation in the lock: FOR UPDATE refuses outer joins. The id
      // was resolved within the caller's store already.)
      await manager.findOne(ShiftAssignment, {
        where: employeeProfileId
          ? { id: shiftAssignmentId, employeeId: employeeProfileId }
          : { id: shiftAssignmentId },
        select: ['id'],
        lock: { mode: 'pessimistic_write' },
      });
    }
    let requested: Date | null = null;
    if (clock && shiftAssignmentId) {
      const assignment = await manager.findOne(ShiftAssignment, {
        where: { id: shiftAssignmentId },
        relations: ['shiftSlot', 'shiftSlot.workShift'],
      });
      if (assignment?.shiftSlot) {
        const window = effectiveWindowOf({ shiftSlot: assignment.shiftSlot });
        requested = resolveRequestedInstant(
          window,
          String(assignment.shiftSlot.workDate).slice(0, 10),
          clock,
        );
        // Strictly inside: arriving at the start is not late, leaving at the
        // end is not early (a 0-minute request changes nothing).
        if (
          !requested ||
          requested.getTime() === window.start?.getTime() ||
          requested.getTime() === window.end?.getTime()
        ) {
          throw new BadRequestException(
            `Giờ xin ${label} phải nằm trong giờ của ca làm.`,
          );
        }
      }
    } else if (clock) {
      requested = new Date(`${startDate}T${clock}+07:00`);
    }
    if (
      type === LeaveType.LATE &&
      requested &&
      !Number.isNaN(requested.getTime()) &&
      requested.getTime() <= Date.now()
    ) {
      throw new BadRequestException({
        code: 'LATE_REQUEST_TIME_PASSED',
        message: 'Giờ xin đến phải sau thời điểm hiện tại.',
      });
    }
    if (!shiftAssignmentId) return;
    const approved = await manager.findOne(EmployeeLeaveRequest, {
      where: {
        shiftAssignmentId,
        type,
        status: LeaveRequestStatus.APPROVED,
      },
      select: ['id'],
    });
    if (approved) {
      throw new BadRequestException(
        `Ca làm đã có đơn xin ${label} được duyệt.`,
      );
    }
    if (type === LeaveType.EARLY) {
      const overtime = await manager.findOne(BonusWorkRequest, {
        where: {
          shiftAssignmentId,
          status: In([
            BonusWorkRequestStatus.PENDING,
            BonusWorkRequestStatus.APPROVED,
          ]),
        },
        select: ['id'],
      });
      if (overtime) {
        throw new BadRequestException(
          'Ca làm đã có yêu cầu tăng ca, không thể xin về sớm.',
        );
      }
    }
  }

  /**
   * The shift a leave request is about. Released staff builds send the slot
   * id (the schedule grid's `id`) as `shiftAssignmentId`, which broke the
   * foreign key; it is resolved to the employee's own assignment on that
   * slot. Anything else outside the caller's own assignments in this store
   * is refused.
   */
  async resolveLeaveShiftAssignmentId(
    this: StoresService,
    manager: EntityManager,
    storeId: string,
    employeeProfileId: string,
    ref: unknown,
  ): Promise<string | null> {
    if (ref === undefined || ref === null || ref === '') return null;
    const invalid = () =>
      new BadRequestException('Ca làm không hợp lệ cho đơn này');
    if (typeof ref !== 'string' || !isUUID(ref)) throw invalid();

    const own = await manager.findOne(ShiftAssignment, {
      where: {
        id: ref,
        employeeId: employeeProfileId,
        shiftSlot: { cycle: { storeId } },
      },
      select: ['id'],
    });
    if (own) return own.id;

    const onSlot = await manager.findOne(ShiftAssignment, {
      where: {
        shiftSlotId: ref,
        employeeId: employeeProfileId,
        status: Not(ShiftAssignmentStatus.CANCELLED),
        shiftSlot: { cycle: { storeId } },
      },
      select: ['id'],
      order: { createdAt: 'DESC' },
    });
    if (onSlot) return onSlot.id;
    throw invalid();
  }

  async getLeaveRequestsByEmployee(
    this: StoresService,
    employeeProfileId: string,
    accountId?: string,
    type?: string,
  ) {
    const types = parseLeaveTypeFilter(type);
    if (accountId)
      await this.assertEmployeeCalendarAccess(employeeProfileId, accountId);
    return this.leaveRequestRepository.find({
      where: {
        employeeProfileId,
        ...(types ? { type: In(types) } : {}),
      },
      order: { createdAt: 'DESC' },
      relations: ['approvedBy', 'approvedBy.account', 'shiftAssignment'],
    });
  }

  async getLeaveRequestsByStore(
    this: StoresService,
    storeId: string,
    status?: LeaveRequestStatus,
    from?: string,
    to?: string,
  ) {
    const query = this.leaveRequestRepository
      .createQueryBuilder('lr')
      .select([
        'lr.id',
        'lr.storeId',
        'lr.employeeProfileId',
        'lr.startDate',
        'lr.endDate',
        'lr.startTime',
        'lr.endTime',
        'lr.type',
        'lr.reason',
        'lr.status',
        'lr.rejectionReason',
        'lr.createdAt',
        'lr.updatedAt',
      ])
      .leftJoinAndSelect('lr.employeeProfile', 'employeeProfile')
      .leftJoinAndSelect('employeeProfile.account', 'employeeAccount')
      .addSelect([
        'employeeProfile.id',
        'employeeProfile.employeeTypeId',
        'employeeAccount.id',
        'employeeAccount.fullName',
        'employeeAccount.avatar',
      ])
      .leftJoinAndSelect('lr.store', 'store')
      .addSelect(['store.id', 'store.name'])
      .leftJoinAndSelect('lr.shiftAssignment', 'shiftAssignment')
      .addSelect(['shiftAssignment.id'])
      .where('lr.storeId = :storeId', { storeId });
    if (status) query.andWhere('lr.status = :status', { status });
    if (from) query.andWhere('lr.endDate >= :from', { from });
    if (to) query.andWhere('lr.startDate <= :to', { to });
    const leaves = await query.orderBy('lr.createdAt', 'DESC').getMany();
    // Overtime requests tied to a shift ("Xin tăng ca") are reviewed in the
    // same list, shaped like an OVERTIME leave row; approving one goes
    // through POST /stores/approvals/:id with type LEAVE as well.
    const overtime = await this.linkedOvertimeRowsForStore(
      storeId,
      status,
      from,
      to,
    );
    if (!overtime.length) return leaves;
    return [...leaves, ...overtime].sort(
      (a: any, b: any) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    /* return this.leaveRequestRepository.find({
      where,
      order: { createdAt: 'DESC' },
      relations: [
        'employeeProfile',
        'employeeProfile.account',
        'approvedBy',
        'approvedBy.account',
        'shiftAssignment',
      ],
    }); */
  }

  /** Shift-linked overtime requests of a store as OVERTIME leave rows. */
  async linkedOvertimeRowsForStore(
    this: StoresService,
    storeId: string,
    status?: LeaveRequestStatus | string,
    from?: string,
    to?: string,
  ): Promise<any[]> {
    let rows: BonusWorkRequest[] = [];
    try {
      const query = this.bonusWorkRequestRepository
        .createQueryBuilder('bw')
        .leftJoinAndSelect('bw.employeeProfile', 'employeeProfile')
        .leftJoinAndSelect('employeeProfile.account', 'employeeAccount')
        .where('bw.storeId = :storeId', { storeId })
        .andWhere('bw.shiftAssignmentId IS NOT NULL');
      if (status) query.andWhere('bw.status = :status', { status });
      if (from) query.andWhere('bw.requestDate >= :from', { from });
      if (to) query.andWhere('bw.requestDate <= :to', { to });
      rows = await query.orderBy('bw.createdAt', 'DESC').take(500).getMany();
    } catch {
      // Best effort: the leave requests are still listed.
      return [];
    }
    return rows.map((bw) => ({
      id: bw.id,
      storeId: bw.storeId,
      employeeProfileId: bw.employeeProfileId,
      startDate: bw.requestDate,
      endDate: bw.requestDate,
      startTime: bw.startTime,
      endTime: bw.endTime,
      type: LeaveType.OVERTIME,
      reason: bw.reason,
      status: bw.status,
      rejectionReason: bw.rejectionReason,
      createdAt: bw.createdAt,
      updatedAt: bw.updatedAt,
      employeeProfile: bw.employeeProfile
        ? {
            id: bw.employeeProfile.id,
            employeeTypeId: (bw.employeeProfile as any).employeeTypeId,
            account: bw.employeeProfile.account
              ? {
                  id: bw.employeeProfile.account.id,
                  fullName: bw.employeeProfile.account.fullName,
                  avatar: (bw.employeeProfile.account as any).avatar,
                }
              : null,
          }
        : null,
      store: { id: storeId },
      shiftAssignment: { id: bw.shiftAssignmentId },
      source: 'BONUS_WORK',
    }));
  }

  async cancelLeaveRequest(this: StoresService, id: string, accountId: string) {
    const request = await this.leaveRequestRepository.findOne({
      where: { id },
    });
    if (!request) throw new NotFoundException('Không tìm thấy đơn xin nghỉ');
    // The owning profile is read from the stored request and matched against
    // the caller's account. Previously the profile id came from the request
    // body, so anyone could cancel anyone else's request.
    await this.assertEmployeeSelfAccess(
      request.employeeProfileId,
      accountId,
      undefined,
      'Bạn không có quyền hủy đơn này',
    );
    if (request.status !== LeaveRequestStatus.PENDING) {
      throw new BadRequestException('Chỉ có thể hủy đơn đang chờ duyệt');
    }
    request.status = LeaveRequestStatus.CANCELLED;
    const saved = await this.leaveRequestRepository.save(request);
    await this.logActivity(null, {
      storeId: request.storeId,
      actorAccountId: accountId,
      subjectEmployeeProfileId: request.employeeProfileId,
      action: ACTIVITY_ACTIONS.LEAVE_REQUEST_CANCELLED,
      resourceType: 'leave_request',
      resourceId: request.id,
      params: this.activityLeaveParams(request),
      idempotencyKey: `${ACTIVITY_ACTIONS.LEAVE_REQUEST_CANCELLED}:${request.id}`,
    });
    return saved;
  }

  // ===== Shift Change Request Management =====
  async resolveShiftChangeReferences(
    this: StoresService,
    storeId: string,
    referenceIds: string[],
  ) {
    const ids = [...new Set(referenceIds.filter(Boolean))];
    if (!ids.length) return new Map<string, Record<string, unknown>>();

    // The legacy request stores opaque UUIDs. They may identify either an
    // assignment or a slot, so resolve each bounded set in the request store.
    const [assignments, slots] = await Promise.all([
      this.shiftAssignmentRepository.find({
        where: { id: In(ids), shiftSlot: { cycle: { storeId } } },
        relations: ['shiftSlot', 'shiftSlot.workShift'],
      }),
      this.shiftSlotRepository.find({
        where: { id: In(ids), cycle: { storeId } },
        relations: ['workShift'],
      }),
    ]);
    const references = new Map<string, Record<string, unknown>>();
    for (const assignment of assignments) {
      const slot = assignment.shiftSlot;
      references.set(assignment.id, {
        id: assignment.id,
        referenceType: 'assignment',
        assignmentId: assignment.id,
        slotId: slot?.id,
        shiftName: slot?.workShift?.shiftName || 'Ca làm việc',
        workDate: slot?.workDate,
        startTime: slot?.startTime || slot?.workShift?.startTime,
        endTime: slot?.endTime || slot?.workShift?.endTime,
        location: slot?.location,
        employeeId: assignment.employeeId,
        status: assignment.status,
      });
    }
    for (const slot of slots) {
      if (references.has(slot.id)) continue;
      references.set(slot.id, {
        id: slot.id,
        referenceType: 'slot',
        slotId: slot.id,
        shiftName: slot.workShift?.shiftName || 'Ca làm việc',
        workDate: slot.workDate,
        startTime: slot.startTime || slot.workShift?.startTime,
        endTime: slot.endTime || slot.workShift?.endTime,
        location: slot.location,
      });
    }
    return references;
  }

  async createShiftChangeRequest(
    this: StoresService,
    data: {
      storeId: string;
      employeeProfileId: string;
      currentShiftId?: string;
      requestedShiftId?: string;
      requestDate: string;
      reason?: string;
      attachments?: string[];
    },
    accountId?: string,
  ) {
    if (!accountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    if (!data.currentShiftId && !data.requestedShiftId) {
      throw new BadRequestException(
        'Phải cung cấp ca hiện tại hoặc ca muốn đổi',
      );
    }

    const employee = await this.profileRepository.findOne({
      where: {
        id: data.employeeProfileId,
        storeId: data.storeId,
        accountId,
        // Anyone who can be rostered may ask to change a shift (probation
        // included); on-leave staff have no shifts to change.
        employmentStatus: In([...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]),
      },
      select: ['id', 'storeId', 'accountId'],
    });
    if (!employee) {
      throw new ForbiddenException(
        'Bạn không thể tạo yêu cầu cho nhân viên này',
      );
    }
    const references = await this.resolveShiftChangeReferences(data.storeId, [
      data.currentShiftId || '',
      data.requestedShiftId || '',
    ]);
    const referenceIds = [data.currentShiftId, data.requestedShiftId].filter(
      Boolean,
    ) as string[];
    if (references.size !== new Set(referenceIds).size) {
      throw new BadRequestException(
        'Ca làm không thuộc cửa hàng này hoặc không tồn tại',
      );
    }
    const currentReference = data.currentShiftId
      ? references.get(data.currentShiftId)
      : undefined;
    if (
      currentReference?.referenceType === 'assignment' &&
      currentReference.employeeId !== employee.id
    ) {
      throw new ForbiddenException('Ca hiện tại không thuộc nhân viên này');
    }
    if (
      currentReference?.referenceType === 'assignment' &&
      currentReference.status === ShiftAssignmentStatus.CANCELLED
    ) {
      throw new BadRequestException('Ca hiện tại đã bị hủy');
    }
    if (currentReference?.referenceType === 'slot') {
      const assignment = await this.shiftAssignmentRepository.findOne({
        where: {
          shiftSlotId: currentReference.slotId as string,
          employeeId: employee.id,
          status: Not(ShiftAssignmentStatus.CANCELLED),
        },
        select: ['id', 'status'],
      });
      if (!assignment) {
        throw new ForbiddenException('Ca hiện tại không thuộc nhân viên này');
      }
    }

    return this.dataSource.transaction(async (manager) => {
      // Serialize pending requests for this employee so the duplicate check
      // remains safe when two submissions arrive concurrently.
      const lockedEmployee = await manager.findOne(EmployeeProfile, {
        where: {
          id: data.employeeProfileId,
          storeId: data.storeId,
          accountId,
          employmentStatus: EmploymentStatus.ACTIVE,
        },
        select: ['id'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedEmployee) {
        throw new ForbiddenException('Nhân viên không còn thuộc cửa hàng này');
      }

      const existing = await manager.findOne(ShiftChangeRequest, {
        where: {
          storeId: data.storeId,
          employeeProfileId: data.employeeProfileId,
          currentShiftId: data.currentShiftId ? data.currentShiftId : IsNull(),
          requestedShiftId: data.requestedShiftId
            ? data.requestedShiftId
            : IsNull(),
          requestDate: data.requestDate,
          status: ShiftChangeRequestStatus.PENDING,
        },
      });
      if (existing) {
        throw new ConflictException('Yêu cầu đổi ca tương tự đang chờ duyệt');
      }

      const request = manager.create(ShiftChangeRequest, {
        storeId: data.storeId,
        employeeProfileId: data.employeeProfileId,
        currentShiftId: data.currentShiftId ?? undefined,
        requestedShiftId: data.requestedShiftId ?? undefined,
        requestDate: data.requestDate,
        reason: data.reason ?? undefined,
        attachments: data.attachments ? JSON.stringify(data.attachments) : null,
        status: ShiftChangeRequestStatus.PENDING,
      });
      const saved = await manager.save(ShiftChangeRequest, request);
      await this.logActivity(manager, {
        storeId: data.storeId,
        actorAccountId: accountId,
        subjectEmployeeProfileId: data.employeeProfileId,
        action: ACTIVITY_ACTIONS.SHIFT_CHANGE_REQUEST_CREATED,
        resourceType: 'shift_change_request',
        resourceId: saved.id,
        params: { requestDate: toActivityDate(data.requestDate) },
        idempotencyKey: `${ACTIVITY_ACTIONS.SHIFT_CHANGE_REQUEST_CREATED}:${saved.id}`,
      });
      return saved;
    });
  }

  async getShiftChangeRequestsByEmployee(
    this: StoresService,
    employeeProfileId: string,
    accountId?: string,
    expectedStoreId?: string,
    filters?: {
      status?: ShiftChangeRequestStatus;
      startDate?: string;
      endDate?: string;
    },
  ) {
    if (!accountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    const profile = await this.assertEmployeeCalendarAccess(
      employeeProfileId,
      accountId,
      expectedStoreId,
    );

    const where: any = {
      employeeProfileId,
      storeId: expectedStoreId ?? profile.storeId,
    };
    if (filters?.status) where.status = filters.status;
    this.applyShiftChangeRequestDateRange(where, filters);
    const requests = await this.shiftChangeRequestRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
    // Staff may inspect their own request state, but approver profiles/accounts
    // are owner-only data and must not cross the mobile API boundary.
    return requests.map((request) => ({
      id: request.id,
      storeId: request.storeId,
      employeeProfileId: request.employeeProfileId,
      currentShiftId: request.currentShiftId,
      requestedShiftId: request.requestedShiftId,
      requestDate: request.requestDate,
      reason: request.reason,
      status: request.status,
      approvedById: request.approvedById,
      rejectionReason: request.rejectionReason,
      attachments: request.attachments,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    }));
  }

  async getShiftChangeRequestsByStore(
    this: StoresService,
    storeId: string,
    status?: ShiftChangeRequestStatus,
    accountId?: string,
    pagination?: {
      page?: number;
      limit?: number;
      startDate?: string;
      endDate?: string;
    },
  ): Promise<
    | ShiftChangeRequest[]
    | { data: unknown[]; page: number; limit: number; total: number }
  > {
    if (!accountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    await this.assertOwnerStoreAccess(storeId, accountId);

    const where: any = { storeId };
    if (status) where.status = status;
    this.applyShiftChangeRequestDateRange(where, pagination);
    const findOptions = {
      where,
      order: { createdAt: 'DESC' as const },
      relations: [
        'employeeProfile',
        'employeeProfile.account',
        'approvedBy',
        'approvedBy.account',
      ],
    };
    const paginated = Boolean(pagination?.page || pagination?.limit);
    const page = pagination?.page || 1;
    const limit = pagination?.limit || 20;
    const [requests, total] = paginated
      ? await this.shiftChangeRequestRepository.findAndCount({
          ...findOptions,
          skip: (page - 1) * limit,
          take: limit,
        })
      : [await this.shiftChangeRequestRepository.find(findOptions), 0];
    const references = await this.resolveShiftChangeReferences(
      storeId,
      requests.flatMap((request) => [
        request.currentShiftId || '',
        request.requestedShiftId || '',
      ]),
    );
    const data = requests.map((request) => ({
      ...request,
      currentShift: request.currentShiftId
        ? references.get(request.currentShiftId) || null
        : null,
      requestedShift: request.requestedShiftId
        ? references.get(request.requestedShiftId) || null
        : null,
    }));
    return paginated ? { data, page, limit, total } : data;
  }

  applyShiftChangeRequestDateRange(
    this: StoresService,
    where: Record<string, unknown>,
    range?: { startDate?: string; endDate?: string },
  ) {
    if (range?.startDate && range.endDate) {
      where.requestDate = Between(range.startDate, range.endDate);
    } else if (range?.startDate) {
      where.requestDate = MoreThanOrEqual(range.startDate);
    } else if (range?.endDate) {
      where.requestDate = LessThanOrEqual(range.endDate);
    }
  }

  async reviewShiftChangeRequest(
    this: StoresService,
    id: string,
    ownerAccountId: string | undefined,
    status:
      | ShiftChangeRequestStatus.APPROVED
      | ShiftChangeRequestStatus.REJECTED,
    rejectionReason?: string,
  ) {
    if (!ownerAccountId)
      throw new BadRequestException('Không xác định được người duyệt');
    const request = await this.shiftChangeRequestRepository.findOne({
      where: { id },
    });
    if (!request) throw new NotFoundException('Không tìm thấy yêu cầu đổi ca');
    await this.assertOwnerStoreAccess(request.storeId, ownerAccountId);

    // Store owners do not necessarily have an employee profile. Scope this
    // optional lookup to the request store and persist null when absent.
    const ownerProfile = await this.profileRepository.findOne({
      where: { accountId: ownerAccountId, storeId: request.storeId },
      select: ['id'],
    });
    const result = await this.dataSource.transaction(async (manager) => {
      const updated = await manager.update(
        ShiftChangeRequest,
        {
          id,
          storeId: request.storeId,
          status: ShiftChangeRequestStatus.PENDING,
        },
        {
          status,
          approvedById: ownerProfile?.id ?? null,
          rejectionReason:
            status === ShiftChangeRequestStatus.REJECTED
              ? (rejectionReason ?? null)
              : null,
        },
      );
      if (updated.affected) {
        const reviewAction =
          status === ShiftChangeRequestStatus.APPROVED
            ? ACTIVITY_ACTIONS.SHIFT_CHANGE_REQUEST_APPROVED
            : ACTIVITY_ACTIONS.SHIFT_CHANGE_REQUEST_REJECTED;
        await this.logActivity(manager, {
          storeId: request.storeId,
          actorAccountId: ownerAccountId,
          subjectEmployeeProfileId: request.employeeProfileId,
          action: reviewAction,
          resourceType: 'shift_change_request',
          resourceId: id,
          params: { requestDate: toActivityDate(request.requestDate) },
          idempotencyKey: `${reviewAction}:${id}`,
        });
      }
      return updated;
    });
    if (!result.affected) {
      throw new BadRequestException('Yêu cầu không còn chờ duyệt');
    }
    return {
      ...request,
      status,
      approvedById: ownerProfile?.id ?? null,
      rejectionReason:
        status === ShiftChangeRequestStatus.REJECTED
          ? (rejectionReason ?? null)
          : null,
    };
  }

  async approveShiftChangeRequest(
    this: StoresService,
    id: string,
    ownerAccountId: string | undefined,
  ) {
    return this.reviewShiftChangeRequest(
      id,
      ownerAccountId,
      ShiftChangeRequestStatus.APPROVED,
    );
  }

  async rejectShiftChangeRequest(
    this: StoresService,
    id: string,
    ownerAccountId: string | undefined,
    reason?: string,
  ) {
    return this.reviewShiftChangeRequest(
      id,
      ownerAccountId,
      ShiftChangeRequestStatus.REJECTED,
      reason,
    );
  }

  async cancelShiftChangeRequest(
    this: StoresService,
    id: string,
    employeeProfileId: string | undefined,
    actorAccountId?: string,
  ) {
    if (!employeeProfileId)
      throw new BadRequestException('Không xác định được nhân viên');
    const request = await this.shiftChangeRequestRepository.findOne({
      where: { id },
    });
    if (!request) throw new NotFoundException('Không tìm thấy yêu cầu đổi ca');
    if (request.employeeProfileId !== employeeProfileId) {
      throw new BadRequestException('Bạn không có quyền hủy yêu cầu này');
    }
    if (request.status !== ShiftChangeRequestStatus.PENDING) {
      throw new BadRequestException('Chỉ có thể hủy yêu cầu đang chờ duyệt');
    }
    request.status = ShiftChangeRequestStatus.CANCELLED;
    const saved = await this.shiftChangeRequestRepository.save(request);
    await this.logActivity(null, {
      storeId: request.storeId,
      actorAccountId: actorAccountId ?? null,
      subjectEmployeeProfileId: request.employeeProfileId,
      action: ACTIVITY_ACTIONS.SHIFT_CHANGE_REQUEST_CANCELLED,
      resourceType: 'shift_change_request',
      resourceId: request.id,
      params: { requestDate: toActivityDate(request.requestDate) },
      idempotencyKey: `${ACTIVITY_ACTIONS.SHIFT_CHANGE_REQUEST_CANCELLED}:${request.id}`,
    });
    return saved;
  }

  // ===== Bonus Work Request Management =====
  /**
   * "Xin tăng ca" for a shift: until `endTime` (Vietnam clock, after the
   * shift end, possibly past midnight), at most the store's "Tăng ca tối đa
   * mỗi ca". Tied to the employee's assignment (given, or found from the
   * slot), which must be upcoming or under way and not checked out; one
   * pending/approved request per shift, none with an early leave. The start
   * is the shift end, whatever the client sent.
   *
   * Older builds send only a slot and fixed 17:00-18:00 times: when such a
   * request does not fit a shift it is saved unlinked, as it always was.
   */
  async createBonusWorkRequest(
    this: StoresService,
    data: {
      storeId: string;
      employeeProfileId: string;
      shiftSlotId?: string | null;
      shiftAssignmentId?: string | null;
      requestDate: string;
      startTime?: string;
      endTime?: string;
      reason?: string;
      attachments?: string[];
    },
    actorAccountId?: string,
  ) {
    const strict = !!data.shiftAssignmentId;
    let assignmentId = data.shiftAssignmentId || null;
    if (!assignmentId && data.shiftSlotId) {
      const bySlot = await this.shiftAssignmentRepository.findOne({
        where: {
          shiftSlotId: data.shiftSlotId,
          employeeId: data.employeeProfileId,
          status: In([
            ShiftAssignmentStatus.APPROVED,
            ShiftAssignmentStatus.CONFIRMED,
          ]),
        },
      });
      assignmentId = bySlot?.id ?? null;
    }

    const saveUnlinked = async () => {
      const request = this.bonusWorkRequestRepository.create({
        storeId: data.storeId,
        employeeProfileId: data.employeeProfileId,
        shiftSlotId: data.shiftSlotId || undefined,
        requestDate: data.requestDate,
        startTime: data.startTime || undefined,
        endTime: data.endTime || undefined,
        reason: data.reason || undefined,
        attachments: data.attachments ? JSON.stringify(data.attachments) : null,
        status: BonusWorkRequestStatus.PENDING,
      });
      return this.bonusWorkRequestRepository.save(request);
    };

    let saved: BonusWorkRequest;
    if (!assignmentId) {
      if (strict) {
        throw new BadRequestException('Ca làm không còn hợp lệ để xin tăng ca');
      }
      saved = await saveUnlinked();
    } else {
      const linkedId = assignmentId;
      try {
        saved = await this.dataSource.transaction(async (manager) => {
          // One decision at a time per shift (two requests, or a request and
          // the check-out).
          const locked = await manager.findOne(ShiftAssignment, {
            where: { id: linkedId, employeeId: data.employeeProfileId },
            lock: { mode: 'pessimistic_write' },
          });
          if (
            !locked ||
            ![
              ShiftAssignmentStatus.APPROVED,
              ShiftAssignmentStatus.CONFIRMED,
            ].includes(locked.status) ||
            locked.checkOutTime
          ) {
            throw new BadRequestException({
              code: OVERTIME_SHIFT_MISMATCH,
              message: 'Ca làm không còn hợp lệ để xin tăng ca',
            });
          }
          const assignment = await manager.findOne(ShiftAssignment, {
            where: { id: linkedId },
            relations: ['shiftSlot', 'shiftSlot.workShift', 'shiftSlot.cycle'],
          });
          const slot = assignment?.shiftSlot;
          if (!assignment || !slot || slot.cycle?.storeId !== data.storeId) {
            throw new BadRequestException({
              code: OVERTIME_SHIFT_MISMATCH,
              message: 'Ca làm không còn hợp lệ để xin tăng ca',
            });
          }
          const workDate = String(slot.workDate).slice(0, 10);
          const { end } = effectiveWindowOf(assignment);
          const endClock = String(data.endTime || '').slice(0, 8);
          const endAt = end
            ? overtimeEndAt({ requestDate: workDate, endTime: endClock }, end)
            : null;
          if (!end || !endAt || endAt.getTime() <= end.getTime()) {
            throw new BadRequestException({
              code: OVERTIME_SHIFT_MISMATCH,
              message: 'Giờ kết thúc tăng ca phải sau giờ kết thúc ca.',
            });
          }
          const setting = await manager
            .getRepository(StoreTimekeepingSetting)
            .findOne({ where: { storeId: data.storeId } });
          const maxMinutes =
            Number(setting?.maxOvertimeMinutes) > 0
              ? Number(setting!.maxOvertimeMinutes)
              : DEFAULT_MAX_OVERTIME_MINUTES;
          const requestedMinutes = Math.round(
            (endAt.getTime() - end.getTime()) / 60_000,
          );
          if (requestedMinutes > maxMinutes) {
            throw new BadRequestException({
              code: 'OVERTIME_TOO_LONG',
              message: `Cửa hàng cho tăng ca tối đa ${formatDurationVi(maxMinutes)} mỗi ca.`,
            });
          }
          const existing = await manager.findOne(BonusWorkRequest, {
            where: {
              shiftAssignmentId: linkedId,
              status: In([
                BonusWorkRequestStatus.PENDING,
                BonusWorkRequestStatus.APPROVED,
              ]),
            },
          });
          if (existing) {
            throw new BadRequestException(
              'Ca làm đã có yêu cầu tăng ca đang xử lý',
            );
          }
          const earlyLeave = await manager.findOne(EmployeeLeaveRequest, {
            where: {
              shiftAssignmentId: linkedId,
              type: LeaveType.EARLY,
              status: In([
                LeaveRequestStatus.PENDING,
                LeaveRequestStatus.APPROVED,
              ]),
            },
          });
          if (earlyLeave) {
            throw new BadRequestException(
              'Ca làm đã có đơn xin về sớm, không thể xin tăng ca.',
            );
          }
          return manager.save(
            BonusWorkRequest,
            manager.create(BonusWorkRequest, {
              storeId: data.storeId,
              employeeProfileId: data.employeeProfileId,
              shiftSlotId: slot.id,
              shiftAssignmentId: linkedId,
              requestDate: workDate,
              startTime: `${vnClockHHmm(end)}:00`,
              endTime: `${vnClockHHmm(endAt)}:00`,
              reason: data.reason || undefined,
              attachments: data.attachments
                ? JSON.stringify(data.attachments)
                : null,
              status: BonusWorkRequestStatus.PENDING,
            }),
          );
        });
      } catch (error) {
        // An older build's fixed times that do not fit the shift: keep its
        // unlinked request, as before. The store's rules (limit, one request
        // per shift, early leave) apply to it as to any other.
        if (strict || !isOvertimeShiftMismatch(error)) throw error;
        saved = await saveUnlinked();
      }
    }
    await this.logBonusWorkActivity(
      ACTIVITY_ACTIONS.BONUS_WORK_REQUEST_CREATED,
      saved,
      actorAccountId ?? null,
    );
    void this.notifyOwnerOfRequest({
      storeId: saved.storeId,
      employeeProfileId: saved.employeeProfileId,
      kind: 'OVERTIME',
      requestId: saved.id,
      shiftAssignmentId: saved.shiftAssignmentId ?? null,
      workDate: saved.requestDate
        ? String(saved.requestDate).slice(0, 10)
        : null,
      time: saved.endTime ?? null,
      minutes: overtimeLengthMinutes(saved.startTime, saved.endTime),
      reason: saved.reason ?? null,
      actorAccountId: actorAccountId ?? null,
    });
    return saved;
  }

  async logBonusWorkActivity(
    this: StoresService,
    action: string,
    request: BonusWorkRequest,
    actorAccountId: string | null,
  ) {
    await this.logActivity(null, {
      storeId: request.storeId,
      actorAccountId,
      subjectEmployeeProfileId: request.employeeProfileId,
      action,
      resourceType: 'bonus_work_request',
      resourceId: request.id,
      params: {
        requestDate: toActivityDate(request.requestDate),
        startTime: toActivityHHmm(request.startTime),
        endTime: toActivityHHmm(request.endTime),
      },
      idempotencyKey: `${action}:${request.id}`,
    });
  }

  async getBonusWorkRequestsByEmployee(
    this: StoresService,
    employeeProfileId: string,
  ) {
    try {
      return await this.bonusWorkRequestRepository.find({
        where: { employeeProfileId },
        order: { createdAt: 'DESC' },
        // relations: ['approvedBy', 'approvedBy.account'],
      });
    } catch (e: any) {
      // Was `'DEBUG ERROR: ' + e.message`, which returned raw TypeORM/Postgres
      // text (table and column names, SQL fragments) to the caller.
      this.logger.error(
        `[BonusWorkRequests] query failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      throw new BadRequestException({
        code: 'BONUS_WORK_REQUEST_QUERY_FAILED',
        message: 'Không tải được danh sách yêu cầu tăng ca.',
      });
    }
  }

  async getBonusWorkRequestsByStore(
    this: StoresService,
    storeId: string,
    status?: BonusWorkRequestStatus,
  ) {
    const where: any = { storeId };
    if (status) where.status = status;
    return this.bonusWorkRequestRepository.find({
      where,
      order: { createdAt: 'DESC' },
      relations: [
        'employeeProfile',
        'employeeProfile.account',
        'approvedBy',
        'approvedBy.account',
      ],
    });
  }

  /**
   * Loads a bonus-work request for review by the store owner.
   *
   * `approvedById` is an `EmployeeProfile` FK, and an owner normally has no
   * profile at their own store, so it records the owner's profile there when
   * one exists and null otherwise. The authority is the owner check, not the
   * profile.
   */
  async loadBonusWorkRequestForOwner(
    this: StoresService,
    id: string,
    ownerAccountId: string | undefined,
  ) {
    if (!ownerAccountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    const request = await this.bonusWorkRequestRepository.findOne({
      where: { id },
    });
    if (!request)
      throw new NotFoundException('Không tìm thấy yêu cầu bổ sung công');
    await this.assertOwnerStoreAccess(request.storeId, ownerAccountId);
    // Withdrawn by the employee, or expired when the shift was auto-closed
    // before approval (never paid): no longer reviewable.
    if (request.status === BonusWorkRequestStatus.CANCELLED) {
      throw new BadRequestException(
        'Yêu cầu đã bị hủy hoặc đã hết hạn, không thể duyệt',
      );
    }
    const approverProfile = await this.profileRepository.findOne({
      where: { accountId: ownerAccountId, storeId: request.storeId },
      select: ['id'],
    });
    return { request, approverProfileId: approverProfile?.id ?? null };
  }

  /**
   * Moves a request from the status the owner saw to `next`; a second
   * decision sent at the same time (or on a stale screen) is refused.
   */
  async decideBonusWorkRequest(
    this: StoresService,
    request: BonusWorkRequest,
    next: BonusWorkRequestStatus,
    changes: Partial<BonusWorkRequest>,
  ): Promise<BonusWorkRequest> {
    if (request.status === next) {
      throw new BadRequestException(
        'Yêu cầu đã được cập nhật, vui lòng tải lại',
      );
    }
    // Only a pending request is approved: approving one refused earlier
    // could leave a shift with two approved overtimes. (Refusing one
    // approved earlier stays possible: the owner takes it back.)
    if (
      next === BonusWorkRequestStatus.APPROVED &&
      request.status !== BonusWorkRequestStatus.PENDING
    ) {
      throw new BadRequestException(
        'Chỉ duyệt được yêu cầu tăng ca đang chờ duyệt.',
      );
    }
    const result = await this.bonusWorkRequestRepository.update(
      { id: request.id, status: request.status },
      { ...changes, status: next },
    );
    if (result && result.affected === 0) {
      throw new BadRequestException(
        'Yêu cầu đã được cập nhật, vui lòng tải lại',
      );
    }
    return Object.assign(request, changes, { status: next });
  }

  /** Shift label for an overtime decision notification. */
  async notifyOvertimeDecision(
    this: StoresService,
    request: BonusWorkRequest,
    approved: boolean,
    reason?: string | null,
  ) {
    let shiftEnd: string | null = null;
    if (!approved && request.shiftAssignmentId) {
      const assignment = await this.shiftAssignmentRepository
        .findOne({
          where: { id: request.shiftAssignmentId },
          relations: ['shiftSlot', 'shiftSlot.workShift'],
        })
        .catch(() => null);
      const end = assignment ? effectiveWindowOf(assignment).end : null;
      shiftEnd = end ? vnClockHHmm(end) : null;
    }
    await this.notifyRequestDecision({
      employeeProfileId: request.employeeProfileId,
      storeId: request.storeId,
      requestId: request.id,
      kind: 'OVERTIME',
      approved,
      reason,
      assignmentId: request.shiftAssignmentId,
      workDate: request.requestDate
        ? String(request.requestDate).slice(0, 10)
        : null,
      // Unlinked (older build): approving it does not extend paid time.
      time: request.shiftAssignmentId ? request.endTime : null,
      shiftEnd,
    });
  }

  async approveBonusWorkRequest(
    this: StoresService,
    id: string,
    ownerAccountId: string | undefined,
  ) {
    const { request, approverProfileId } =
      await this.loadBonusWorkRequestForOwner(id, ownerAccountId);
    const saved = await this.decideBonusWorkRequest(
      request,
      BonusWorkRequestStatus.APPROVED,
      { approvedById: approverProfileId },
    );
    await this.logBonusWorkActivity(
      ACTIVITY_ACTIONS.BONUS_WORK_REQUEST_APPROVED,
      request,
      ownerAccountId ?? null,
    );
    await this.repriceCheckedOutOvertime(saved);
    void this.notifyOvertimeDecision(saved, true);
    return saved;
  }

  async rejectBonusWorkRequest(
    this: StoresService,
    id: string,
    ownerAccountId: string | undefined,
    reason?: string,
  ) {
    const { request, approverProfileId } =
      await this.loadBonusWorkRequestForOwner(id, ownerAccountId);
    const saved = await this.decideBonusWorkRequest(
      request,
      BonusWorkRequestStatus.REJECTED,
      { approvedById: approverProfileId, rejectionReason: reason ?? null },
    );
    await this.logBonusWorkActivity(
      ACTIVITY_ACTIONS.BONUS_WORK_REQUEST_REJECTED,
      request,
      ownerAccountId ?? null,
    );
    await this.repriceCheckedOutOvertime(saved);
    void this.notifyOvertimeDecision(saved, false, reason);
    return saved;
  }

  /** Whether `id` is an overtime ("bổ sung công") request, not a leave row. */
  async isBonusWorkRequestId(
    this: StoresService,
    id: string,
  ): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
    const found = await this.bonusWorkRequestRepository
      .findOne({ where: { id }, select: ['id'] })
      .catch(() => null);
    return !!found;
  }

  /**
   * End of the approved overtime of an assignment, as an instant, or null.
   * Only this extends paid time past the shift end.
   */
  async approvedOvertimeEnd(
    this: StoresService,
    assignmentId: string,
    shiftEnd: Date | null,
  ): Promise<Date | null> {
    const request = await this.bonusWorkRequestRepository.findOne({
      where: {
        shiftAssignmentId: assignmentId,
        status: BonusWorkRequestStatus.APPROVED,
      },
      order: { updatedAt: 'DESC' },
    });
    return request ? overtimeEndAt(request, shiftEnd ?? undefined) : null;
  }

  /**
   * An overtime request decided after the employee already checked out
   * (they left while it was pending): worked minutes were paid to the shift
   * end, so approving pays the overtime and rejecting an earlier approval
   * takes it back. The payslip is recomputed when the minutes change.
   * Automatic check-outs are priced when they close and are left alone.
   */
  async repriceCheckedOutOvertime(
    this: StoresService,
    request: BonusWorkRequest,
  ): Promise<void> {
    if (!request.shiftAssignmentId) return;
    const assignment = await this.shiftAssignmentRepository.findOne({
      where: { id: request.shiftAssignmentId },
      relations: ['shiftSlot', 'shiftSlot.workShift', 'shiftSlot.cycle'],
    });
    if (
      !assignment ||
      assignment.status !== ShiftAssignmentStatus.COMPLETED ||
      !assignment.checkInTime ||
      !assignment.checkOutTime ||
      assignment.isAutoCheckout
    ) {
      return;
    }
    const slot = assignment.shiftSlot;
    const { start, end } = effectiveWindowOf(assignment);
    const storeId = slot?.cycle?.storeId;
    const setting = storeId
      ? await this.timekeepingSettingRepository.findOne({ where: { storeId } })
      : null;
    const workedMinutes = creditedWorkedMinutes({
      start,
      end,
      checkIn: new Date(assignment.checkInTime),
      checkOut: new Date(assignment.checkOutTime),
      rules: resolveAttendanceRules(setting),
      storedLateMinutes: assignment.lateMinutes,
      paidUntil: await this.approvedOvertimeEnd(assignment.id, end),
      mode: await this.workedTimeModeFor(storeId, assignment.employeeId, slot),
    });
    if (workedMinutes === Number(assignment.workedMinutes)) return;
    await this.shiftAssignmentRepository.update(
      { id: assignment.id, status: ShiftAssignmentStatus.COMPLETED },
      { workedMinutes },
    );
    try {
      await this.processCheckoutPayroll(assignment.id);
    } catch {
      this.logger.error(
        `[Overtime] Payslip not recomputed after repricing ${assignment.id}`,
      );
    }
  }

  // Lấy thống kê duyệt
  /** Best effort: a missing table (migration not yet applied) counts 0. */
  async countPendingCustomShiftRequests(
    this: StoresService,
    storeId: string,
    urgentBefore: Date,
  ): Promise<{ pending: number; urgent: number }> {
    try {
      const rows: Array<{ pending: number; urgent: number }> =
        await this.dataSource.query(
          `SELECT COUNT(*)::int AS pending,
                  COUNT(*) FILTER (WHERE created_at < $2)::int AS urgent
           FROM custom_shift_requests
           WHERE store_id = $1 AND status = 'PENDING'`,
          [storeId, urgentBefore],
        );
      return {
        pending: Number(rows?.[0]?.pending || 0),
        urgent: Number(rows?.[0]?.urgent || 0),
      };
    } catch (error) {
      this.logger.warn(
        `[getApprovalStats] custom shift requests not counted: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { pending: 0, urgent: 0 };
    }
  }

  /**
   * Which bonus-work requests `GET bonus-work-requests` may return.
   * The owner of the store sees the store (or the requested employee);
   * anyone else only ever sees their own requests at that store, whatever
   * `employeeProfileId` they sent. Null = nothing visible.
   */
  async resolveBonusWorkRequestScope(
    this: StoresService,
    accountId: string,
    query: { storeId?: string; employeeProfileId?: string },
  ): Promise<
    | { kind: 'store'; storeId: string }
    | { kind: 'employee'; employeeProfileId: string }
    | null
  > {
    let storeId = query.storeId || null;
    if (query.employeeProfileId) {
      const target = await this.profileRepository.findOne({
        where: { id: query.employeeProfileId },
        select: ['id', 'storeId'],
      });
      if (!target) return null;
      if (storeId && storeId !== target.storeId) return null;
      storeId = target.storeId;
    }
    if (!storeId) return null;
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      select: ['id', 'ownerAccountId'],
    });
    if (!store) return null;
    if (store.ownerAccountId === accountId) {
      return query.employeeProfileId
        ? { kind: 'employee', employeeProfileId: query.employeeProfileId }
        : { kind: 'store', storeId };
    }
    const own = await this.profileRepository.findOne({
      where: {
        storeId,
        accountId,
        employmentStatus: In([...EMPLOYED_STATUSES]),
      },
      select: ['id'],
    });
    return own ? { kind: 'employee', employeeProfileId: own.id } : null;
  }

  async getApprovalStats(
    this: StoresService,
    storeId: string,
    ownerAccountId?: string,
  ) {
    if (!ownerAccountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    // Only count registrations belonging to live cycles (ACTIVE/EXPIRED).
    // Registrations from STOPPED/DRAFT cycles are stale and would otherwise
    // keep the pending count permanently elevated (the "stuck at 3" bug).
    const registrations = await this.shiftAssignmentRepository.find({
      where: {
        shiftSlot: {
          cycle: {
            status: In([WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED]),
          },
          workShift: { storeId },
        },
      },
      select: ['status', 'createdAt'],
    });

    const changeRequests = await this.shiftChangeRequestRepository.find({
      where: { storeId },
      select: ['status', 'createdAt'],
    });

    const leaveRequests = await this.leaveRequestRepository.find({
      where: { storeId },
      select: ['status', 'createdAt'],
    });
    // Shift-linked overtime requests are reviewed with the leave requests.
    let overtimeRequests: BonusWorkRequest[] = [];
    try {
      overtimeRequests = await this.bonusWorkRequestRepository.find({
        where: { storeId, shiftAssignmentId: Not(IsNull()) },
        select: ['status', 'createdAt'],
      });
    } catch {
      // Best effort, like the custom-time count below.
    }

    const allRequests = [
      ...registrations,
      ...changeRequests,
      ...leaveRequests,
      ...overtimeRequests,
    ];

    // X5 custom-time requests: only the PENDING ones matter to the badge.
    const custom = await this.countPendingCustomShiftRequests(
      storeId,
      oneDayAgo,
    );

    const total = allRequests.length + custom.pending;
    const pending =
      allRequests.filter((r) => String(r.status) === 'PENDING').length + custom.pending;
    const approved = allRequests.filter((r) => String(r.status) === 'APPROVED').length;
    const urgent =
      allRequests.filter(
        (r) => String(r.status) === 'PENDING' && new Date(r.createdAt) < oneDayAgo,
      ).length + custom.urgent;

    return {
      total,
      pending,
      approved,
      urgent,
      customShiftPending: custom.pending,
    };
  }

  /** Only the employee who filed the request may cancel it. */
  async cancelBonusWorkRequest(
    this: StoresService,
    id: string,
    accountId: string | undefined,
  ) {
    if (!accountId)
      throw new BadRequestException('Không xác định được nhân viên');
    const request = await this.bonusWorkRequestRepository.findOne({
      where: { id },
    });
    if (!request)
      throw new NotFoundException('Không tìm thấy yêu cầu bổ sung công');
    const requester = await this.profileRepository.findOne({
      where: { id: request.employeeProfileId },
      select: ['id', 'accountId'],
      withDeleted: true,
    });
    if (!requester || requester.accountId !== accountId) {
      throw new ForbiddenException('Bạn không có quyền hủy yêu cầu này');
    }
    if (request.status !== BonusWorkRequestStatus.PENDING) {
      throw new BadRequestException('Chỉ có thể hủy yêu cầu đang chờ duyệt');
    }
    request.status = BonusWorkRequestStatus.CANCELLED;
    const saved = await this.bonusWorkRequestRepository.save(request);
    await this.logBonusWorkActivity(
      ACTIVITY_ACTIONS.BONUS_WORK_REQUEST_CANCELLED,
      request,
      accountId,
    );
    return saved;
  }
}
