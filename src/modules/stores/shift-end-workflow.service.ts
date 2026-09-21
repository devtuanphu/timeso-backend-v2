import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationPriority,
  NotificationType,
} from '../notifications/entities/notification.entity';
import {
  AttendanceLog,
  AttendanceLogType,
  AttendanceMethod,
} from './entities/attendance-log.entity';
import {
  BonusWorkRequest,
  BonusWorkRequestStatus,
} from './entities/bonus-work-request.entity';
import { DailyEmployeeReport } from './entities/daily-employee-report.entity';
import {
  EmployeeProfile,
  WorkingStatus,
} from './entities/employee-profile.entity';
import {
  ShiftEndWorkflow,
  ShiftEndWorkflowState,
} from './entities/shift-end-workflow.entity';
import {
  AttendanceStatus,
  ShiftAssignment,
  ShiftAssignmentStatus,
} from './entities/shift-management.entity';
import { resolveShiftBoundaries } from './attendance-time.utils';
import { describeWorkDate } from '../../common/utils/relative-day';
import {
  toDateMarker,
  vnClockHHmm,
  vnDateString,
} from '../../common/utils/vn-calendar';
import { approvedLeaveCoversShiftSql } from './leave-coverage.utils';

/** Nhắc check-in khi ca đã bắt đầu được ngần này phút mà chưa vào ca. */
export const CHECK_IN_REMINDER_AFTER_MINUTES = 5;

/**
 * Kênh push Android: bật "Rung thông báo" thì dùng kênh có rung, tắt thì kênh
 * im lặng. Kênh phải được app tạo sẵn (xem staff notificationHandler).
 */
export const shiftAlertChannel = (reminderSettings: unknown): string =>
  (reminderSettings as { vibrate?: unknown } | null)?.vibrate === false
    ? 'shift-alerts-quiet'
    : 'shift-alerts';

type ReminderMinute = 0 | 5 | 10 | 15;

/** Job hàng đợi 'attendance-background': tính lại phiếu lương một nhân viên. */
export const RECOMPUTE_EMPLOYEE_PAYSLIP_JOB = 'recompute-employee-payslip';

export interface RecomputeEmployeePayslipJobData {
  employeeProfileId: string;
  storeId: string;
  /** Ngày làm (YYYY-MM-DD, giờ VN) quyết định tháng lương. */
  workDate: string;
  assignmentId: string;
}

@Injectable()
export class ShiftEndWorkflowService {
  private readonly logger = new Logger(ShiftEndWorkflowService.name);

  constructor(
    @InjectRepository(ShiftEndWorkflow)
    private readonly workflowRepository: Repository<ShiftEndWorkflow>,
    @InjectRepository(ShiftAssignment)
    private readonly assignmentRepository: Repository<ShiftAssignment>,
    @InjectRepository(BonusWorkRequest)
    private readonly bonusWorkRepository: Repository<BonusWorkRequest>,
    @InjectRepository(EmployeeProfile)
    private readonly profileRepository: Repository<EmployeeProfile>,
    @InjectRepository(DailyEmployeeReport)
    private readonly dailyReportRepository: Repository<DailyEmployeeReport>,
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
    @InjectQueue('shift-end-workflows') private readonly workflowQueue: Queue,
    @InjectQueue('attendance-background')
    private readonly attendanceQueue: Queue,
  ) {}

  calculateScheduledEnd(
    workDate: string,
    startTime: string,
    endTime: string,
  ): Date {
    const start = new Date(`${workDate}T${startTime}+07:00`);
    const end = new Date(`${workDate}T${endTime}+07:00`);
    if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
    return end;
  }

  async scheduleForAssignment(assignmentId: string): Promise<void> {
    const assignment = await this.assignmentRepository.findOne({
      where: { id: assignmentId },
      relations: ['shiftSlot', 'shiftSlot.workShift', 'shiftSlot.cycle'],
    });
    if (!assignment?.checkInTime || assignment.checkOutTime) return;

    const slot = assignment.shiftSlot;
    const startTime = slot?.startTime || slot?.workShift?.startTime;
    const endTime = slot?.endTime || slot?.workShift?.endTime;
    if (!slot?.workDate || !startTime || !endTime) return;

    const scheduledEndAt = this.calculateScheduledEnd(
      slot.workDate,
      startTime,
      endTime,
    );
    const existing = await this.workflowRepository.findOne({
      where: { shiftAssignmentId: assignmentId },
    });
    if (existing) {
      await this.scheduleJobs(assignmentId, existing.effectiveEndAt);
      return;
    }
    try {
      await this.workflowRepository.save(
        this.workflowRepository.create({
          shiftAssignmentId: assignmentId,
          scheduledEndAt,
          effectiveEndAt: scheduledEndAt,
          state: ShiftEndWorkflowState.ACTIVE,
          reminder0SentAt: null,
          reminder5SentAt: null,
          reminder10SentAt: null,
          autoCheckoutAt: null,
          lastError: null,
        }),
      );
    } catch (error: any) {
      if (error?.code !== '23505') throw error;
    }
    await this.scheduleJobs(assignmentId, scheduledEndAt);
  }

  private async scheduleJobs(
    assignmentId: string,
    effectiveEndAt: Date,
  ): Promise<void> {
    for (const minute of [0, 5, 10, 15] as ReminderMinute[]) {
      const runAt = effectiveEndAt.getTime() + minute * 60_000;
      await this.workflowQueue.add(
        'shift-end-action',
        {
          assignmentId,
          expectedEndAt: effectiveEndAt.toISOString(),
          reminderMinute: minute,
        },
        {
          jobId: `shift-end-${assignmentId}-${effectiveEndAt.getTime()}-${minute}`,
          delay: Math.max(0, runAt - Date.now()),
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
    }
  }

  async markCompletedByEmployee(assignmentId: string): Promise<void> {
    await this.workflowRepository.update(
      { shiftAssignmentId: assignmentId },
      { state: ShiftEndWorkflowState.COMPLETED_BY_EMPLOYEE },
    );
  }

  async handleReminderJob(data: {
    assignmentId: string;
    expectedEndAt: string;
    reminderMinute: ReminderMinute;
  }): Promise<void> {
    const workflow = await this.workflowRepository.findOne({
      where: { shiftAssignmentId: data.assignmentId },
    });
    if (!workflow) return;
    if (workflow.effectiveEndAt.toISOString() !== data.expectedEndAt) return;
    if (
      ![
        ShiftEndWorkflowState.ACTIVE,
        ShiftEndWorkflowState.OVERTIME_APPROVED,
      ].includes(workflow.state)
    )
      return;

    const assignment = await this.assignmentRepository.findOne({
      where: { id: data.assignmentId },
      relations: [
        'shiftSlot',
        'shiftSlot.cycle',
        'employee',
        'employee.account',
      ],
    });
    if (!assignment?.checkInTime) return;
    if (
      assignment.checkOutTime ||
      assignment.status === ShiftAssignmentStatus.COMPLETED
    ) {
      await this.markCompletedByEmployee(data.assignmentId);
      return;
    }

    const activeOvertime = await this.bonusWorkRepository.findOne({
      where: {
        shiftAssignmentId: data.assignmentId,
        status: In([
          BonusWorkRequestStatus.PENDING,
          BonusWorkRequestStatus.APPROVED,
        ]),
      },
    });
    if (activeOvertime?.status === BonusWorkRequestStatus.PENDING) {
      await this.workflowRepository.update(workflow.id, {
        state: ShiftEndWorkflowState.OVERTIME_PENDING,
        overtimeRequestId: activeOvertime.id,
      });
      return;
    }

    if (data.reminderMinute === 15) {
      await this.autoCheckout(data.assignmentId, workflow.effectiveEndAt);
      return;
    }

    const marker =
      data.reminderMinute === 0
        ? 'reminder0SentAt'
        : data.reminderMinute === 5
          ? 'reminder5SentAt'
          : 'reminder10SentAt';
    const markerColumn =
      data.reminderMinute === 0
        ? 'reminder_0_sent_at'
        : data.reminderMinute === 5
          ? 'reminder_5_sent_at'
          : 'reminder_10_sent_at';
    const marked = await this.workflowRepository
      .createQueryBuilder()
      .update(ShiftEndWorkflow)
      .set({ [marker]: new Date() })
      .where('id = :id', { id: workflow.id })
      .andWhere(`${markerColumn} IS NULL`)
      .execute();
    if (!marked.affected) return;

    const accountId = assignment.employee?.accountId;
    if (!accountId) return;
    await this.notificationsService.create(
      {
        accountId,
        storeId: assignment.shiftSlot?.cycle?.storeId,
        title: 'Đã đến giờ kết thúc ca',
        content:
          data.reminderMinute === 0
            ? 'Bạn muốn chấm công ra hay gửi yêu cầu tăng ca?'
            : `Bạn chưa chấm công ra sau ${data.reminderMinute} phút.`,
        type: NotificationType.SHIFT_CHECKOUT_REMINDER,
        priority: NotificationPriority.URGENT,
        actionUrl: '/check-in-flow',
        metadata: this.buildNotificationData(assignment, workflow),
      },
      {
        // Không gửi categoryId: app chưa đăng ký category SHIFT_END_ACTIONS.
        priority: 'high',
        // Kênh 'shift-end' cũ app chưa từng tạo nên Android rơi về kênh mặc định
        // không rung; dùng kênh nhắc ca theo cài đặt rung của nhân viên.
        channelId: shiftAlertChannel(assignment.employee?.reminderSettings),
      },
    );
  }

  private buildNotificationData(
    assignment: ShiftAssignment,
    workflow: ShiftEndWorkflow,
  ) {
    return {
      type: 'SHIFT_END_ACTION_REQUIRED',
      assignmentId: assignment.id,
      shiftSlotId: assignment.shiftSlotId,
      storeId: assignment.shiftSlot?.cycle?.storeId || '',
      workDate: assignment.shiftSlot?.workDate || '',
      scheduledEndAt: workflow.effectiveEndAt.toISOString(),
      categoryId: 'SHIFT_END_ACTIONS',
      defaultRoute: '/check-in-flow',
    };
  }

  async autoCheckout(
    assignmentId: string,
    effectiveEndAt: Date,
  ): Promise<boolean> {
    const result = await this.dataSource.transaction(async (manager) => {
      const assignment = await manager.findOne(ShiftAssignment, {
        where: { id: assignmentId },
        relations: [
          'shiftSlot',
          'shiftSlot.cycle',
          'employee',
          'employee.account',
        ],
      });
      if (!assignment?.checkInTime || assignment.checkOutTime) return null;

      const pendingOvertime = await manager.findOne(BonusWorkRequest, {
        where: {
          shiftAssignmentId: assignmentId,
          status: In([
            BonusWorkRequestStatus.PENDING,
            BonusWorkRequestStatus.APPROVED,
          ]),
        },
      });
      if (pendingOvertime) return null;

      const autoCheckoutAt = new Date();
      const workedMinutes = Math.max(
        0,
        Math.floor(
          (effectiveEndAt.getTime() - assignment.checkInTime.getTime()) /
            60_000,
        ),
      );
      const updated = await manager
        .createQueryBuilder()
        .update(ShiftAssignment)
        .set({
          checkOutTime: autoCheckoutAt,
          workedMinutes,
          attendanceStatus: AttendanceStatus.FORGOT_CHECKOUT,
          status: ShiftAssignmentStatus.COMPLETED,
          isAutoCheckout: true,
          autoCheckoutReason: 'FORGOT_CHECKOUT',
          scheduledCheckoutTime: effectiveEndAt,
        })
        .where('id = :assignmentId', { assignmentId })
        .andWhere('check_out_time IS NULL')
        .andWhere('status = :status', {
          status: ShiftAssignmentStatus.CONFIRMED,
        })
        .execute();
      if (!updated.affected) return null;

      await manager.save(
        AttendanceLog,
        manager.create(AttendanceLog, {
          shiftAssignmentId: assignment.id,
          employeeProfileId: assignment.employeeId,
          storeId: assignment.shiftSlot?.cycle?.storeId || '',
          type: AttendanceLogType.CHECK_OUT,
          timestamp: autoCheckoutAt,
          method: AttendanceMethod.SYSTEM,
        }),
      );
      await manager.update(
        ShiftEndWorkflow,
        { shiftAssignmentId: assignment.id },
        { state: ShiftEndWorkflowState.AUTO_COMPLETED, autoCheckoutAt },
      );
      return { assignment, autoCheckoutAt };
    });
    if (!result) return false;

    await this.profileRepository.update(result.assignment.employeeId, {
      workingStatus: WorkingStatus.IDLE,
    });
    await this.appendForgotCheckout(
      result.assignment.shiftSlot?.cycle?.storeId || '',
      result.assignment.employeeId,
      result.autoCheckoutAt,
    );
    void this.attendanceQueue
      .add(
        'process-checkout-payroll',
        { assignmentId },
        { jobId: `checkout-payroll-${assignmentId}`, removeOnComplete: 1000 },
      )
      .catch((error) => {
        this.logger.error(
          `Không thể xếp hàng tính lương cho ca ${assignmentId}`,
          error?.stack,
        );
      });
    const accountId = result.assignment.employee?.accountId;
    if (accountId) {
      const workDate = String(result.assignment.shiftSlot?.workDate ?? '').slice(
        0,
        10,
      );
      const dated = /^\d{4}-\d{2}-\d{2}$/.test(workDate);
      await this.notificationsService.create(
        {
          accountId,
          storeId: result.assignment.shiftSlot?.cycle?.storeId,
          title: 'Quên chấm công ra',
          content: `Hệ thống đã tự kết thúc ${
            dated ? `ca ${describeWorkDate(workDate)}` : 'ca'
          } lúc ${vnClockHHmm(effectiveEndAt)} (giờ kết thúc ca). Giờ làm được tính đến hết ca.`,
          type: NotificationType.SHIFT_AUTO_CHECKOUT,
          priority: NotificationPriority.HIGH,
          actionUrl: '/(home)/workshift',
          metadata: {
            type: 'SHIFT_AUTO_CHECKOUT',
            assignmentId,
            ...(dated ? { workDate, workDates: [workDate] } : {}),
          },
        },
        {
          priority: 'high',
          channelId: shiftAlertChannel(result.assignment.employee?.reminderSettings),
        },
      );
    }
    return true;
  }

  private async appendForgotCheckout(
    storeId: string,
    employeeId: string,
    at: Date,
  ) {
    if (!storeId) return;
    // Vietnam calendar day of the auto-checkout, not the server clock's day.
    const reportDate = toDateMarker(vnDateString(at));
    let report = await this.dailyReportRepository.findOne({
      where: { storeId, reportDate },
    });
    if (!report) {
      report = this.dailyReportRepository.create({
        storeId,
        reportDate,
        forgotClockOut: [],
      });
    }
    const values = new Set(report.forgotClockOut || []);
    values.add(employeeId);
    report.forgotClockOut = [...values];
    await this.dailyReportRepository.save(report);
  }

  async markOvertimePending(request: BonusWorkRequest): Promise<void> {
    if (!request.shiftAssignmentId) return;
    await this.workflowRepository.update(
      { shiftAssignmentId: request.shiftAssignmentId },
      {
        state: ShiftEndWorkflowState.OVERTIME_PENDING,
        overtimeRequestId: request.id,
      },
    );
  }

  async approveOvertime(request: BonusWorkRequest): Promise<void> {
    if (!request.shiftAssignmentId || !request.requestDate || !request.endTime)
      return;
    const workflow = await this.workflowRepository.findOne({
      where: { shiftAssignmentId: request.shiftAssignmentId },
    });
    if (!workflow) return;
    const effectiveEndAt = new Date(
      `${request.requestDate}T${request.endTime}+07:00`,
    );
    await this.workflowRepository.update(workflow.id, {
      state: ShiftEndWorkflowState.OVERTIME_APPROVED,
      effectiveEndAt,
      overtimeRequestId: request.id,
      reminder0SentAt: null,
      reminder5SentAt: null,
      reminder10SentAt: null,
    });
    await this.scheduleJobs(request.shiftAssignmentId, effectiveEndAt);
  }

  async resumeAfterOvertime(request: BonusWorkRequest): Promise<void> {
    if (!request.shiftAssignmentId) return;
    const workflow = await this.workflowRepository.findOne({
      where: { shiftAssignmentId: request.shiftAssignmentId },
    });
    if (!workflow) return;
    const now = new Date();
    const effectiveEndAt =
      now > workflow.scheduledEndAt
        ? new Date(now.getTime() + 5 * 60_000)
        : workflow.scheduledEndAt;
    await this.workflowRepository.update(workflow.id, {
      state: ShiftEndWorkflowState.ACTIVE,
      effectiveEndAt,
      overtimeRequestId: null,
    });
    await this.scheduleJobs(request.shiftAssignmentId, effectiveEndAt);
  }

  /**
   * Ca đã có người nhận (APPROVED) nhưng chưa check-in, chạy mỗi phút:
   *  - ca bắt đầu được 5 phút: nhắc check-in (nếu nhân viên bật "Nhắc nếu chưa
   *    checkin - checkout"), mỗi ca một lần;
   *  - qua giờ kết thúc ca: ghi nhận nghỉ không phép (attendance ABSENT) ngay,
   *    thay vì để ca mở tới hết ngày. Ngày có đơn nghỉ phép đã duyệt thì bỏ qua.
   */
  async reconcileUnstartedAssignments(now: Date = new Date()): Promise<{
    reminded: number;
    markedAbsent: number;
  }> {
    const today = vnDateString(now);
    const yesterday = vnDateString(new Date(now.getTime() - 86_400_000));
    const assignments = await this.assignmentRepository
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.employee', 'employee')
      .leftJoinAndSelect('a.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.workShift', 'workShift')
      .leftJoinAndSelect('slot.cycle', 'cycle')
      .where('a.status = :status', { status: ShiftAssignmentStatus.APPROVED })
      .andWhere('a.checkInTime IS NULL')
      .andWhere('a.attendanceStatus IS NULL')
      // Hôm qua để bắt ca qua đêm kết thúc sáng nay.
      .andWhere('slot.workDate IN (:...dates)', { dates: [yesterday, today] })
      // Nghỉ có phép (đơn nghỉ cả ngày đã duyệt): không nhắc, không ghi vắng,
      // và không bị truy vấn lại mỗi phút.
      .andWhere(
        `NOT ${approvedLeaveCoversShiftSql({
          employeeProfileId: 'a.employee_id',
          workDate: 'slot.work_date',
          assignmentId: 'a.id',
        })}`,
      )
      .getMany();

    let reminded = 0;
    let markedAbsent = 0;
    for (const assignment of assignments) {
      const slot = assignment.shiftSlot;
      if (!slot) continue;
      const workDate = String(slot.workDate).slice(0, 10);
      const startTime = slot.startTime || slot.workShift?.startTime;
      const endTime = slot.endTime || slot.workShift?.endTime;
      const { start, end } = resolveShiftBoundaries(
        workDate,
        startTime,
        endTime,
      );
      if (!start || !end) continue;

      try {
        if (now.getTime() >= end.getTime()) {
          // Kiểm tra đơn nghỉ ngay trong câu UPDATE (đơn có thể vừa được
          // duyệt): kiểm và ghi là một câu lệnh nên không có khe giữa hai bước.
          const marked = await this.assignmentRepository
            .createQueryBuilder()
            .update(ShiftAssignment)
            .set({ attendanceStatus: AttendanceStatus.ABSENT })
            .where('id = :id', { id: assignment.id })
            .andWhere('check_in_time IS NULL')
            .andWhere('attendance_status IS NULL')
            .andWhere(
              `NOT ${approvedLeaveCoversShiftSql({
                employeeProfileId: 'shift_assignments.employee_id',
                workDate: 'CAST(:absentWorkDate AS date)',
                assignmentId: 'shift_assignments.id',
              })}`,
              { absentWorkDate: workDate },
            )
            .execute();
          if (!marked.affected) continue;
          markedAbsent += 1;
          this.enqueuePayslipRecompute(assignment, workDate);
          await this.notifyAbsent(
            assignment,
            workDate,
            startTime,
            endTime,
            now,
          );
          continue;
        }

        if (
          now.getTime() >=
            start.getTime() + CHECK_IN_REMINDER_AFTER_MINUTES * 60_000 &&
          (assignment.employee?.reminderSettings as any)?.remindIfNotCheckIn !==
            false &&
          (await this.sendCheckInReminderOnce(
            assignment,
            workDate,
            startTime,
            endTime,
            now,
          ))
        ) {
          reminded += 1;
        }
      } catch (error) {
        this.logger.warn(
          `Không xử lý được ca chưa check-in ${assignment.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return { reminded, markedAbsent };
  }

  /**
   * Ca vừa bị ghi nghỉ không phép: tính lại phiếu lương tháng đó (phạt vắng,
   * công) qua cùng đường ghi phiếu lương duy nhất. Không bao giờ xoá phiếu;
   * phiếu đã duyệt/đã trả được giữ nguyên. jobId theo ca nên chạy lại cron
   * không xếp trùng.
   */
  private enqueuePayslipRecompute(
    assignment: ShiftAssignment,
    workDate: string,
  ): void {
    const storeId = assignment.shiftSlot?.cycle?.storeId;
    if (!storeId) return;
    const data: RecomputeEmployeePayslipJobData = {
      employeeProfileId: assignment.employeeId,
      storeId,
      workDate,
      assignmentId: assignment.id,
    };
    void this.attendanceQueue
      .add(RECOMPUTE_EMPLOYEE_PAYSLIP_JOB, data, {
        jobId: `payslip-${assignment.employeeId}-${workDate.slice(0, 7)}-${assignment.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      })
      .catch((error) => {
        this.logger.error(
          `Không thể xếp hàng tính lại lương cho ca ${assignment.id}`,
          error?.stack,
        );
      });
  }

  /** "ca 08:00-12:00 hôm nay (18/09)": luôn giữ ngày tuyệt đối. */
  private shiftLabel(
    workDate: string,
    startTime?: string | null,
    endTime?: string | null,
    now: Date = new Date(),
  ) {
    const clock = (value?: string | null) =>
      value ? String(value).slice(0, 5) : '';
    const dayText = describeWorkDate(workDate, now);
    const end = clock(endTime) === '00:00' ? '24:00' : clock(endTime);
    return startTime && endTime
      ? `ca ${clock(startTime)}-${end} ${dayText}`
      : `ca ${dayText}`;
  }

  /** Gửi nhắc check-in đúng một lần cho mỗi ca (khoá theo metadata thông báo). */
  private async sendCheckInReminderOnce(
    assignment: ShiftAssignment,
    workDate: string,
    startTime?: string | null,
    endTime?: string | null,
    now: Date = new Date(),
  ): Promise<boolean> {
    const accountId = assignment.employee?.accountId;
    if (!accountId) return false;
    const already = await this.dataSource.query(
      `SELECT 1 FROM notifications
        WHERE account_id = $1
          AND metadata->>'type' = 'CHECK_IN_REMINDER'
          AND metadata->>'assignmentId' = $2
        LIMIT 1`,
      [accountId, assignment.id],
    );
    if (Array.isArray(already) && already.length) return false;
    await this.notificationsService.create(
      {
        accountId,
        storeId: assignment.shiftSlot?.cycle?.storeId,
        title: 'Bạn chưa check-in',
        content: `${this.shiftLabel(workDate, startTime, endTime, now).replace(/^ca/, 'Ca')} đã bắt đầu. Check-in ngay để không bị tính nghỉ không phép.`,
        type: NotificationType.SHIFT_REMINDER,
        priority: NotificationPriority.HIGH,
        actionUrl: '/check-in-flow',
        metadata: {
          type: 'CHECK_IN_REMINDER',
          assignmentId: assignment.id,
          workDate,
          workDates: [workDate],
        },
      },
      {
        priority: 'high',
        channelId: shiftAlertChannel(assignment.employee?.reminderSettings),
      },
    );
    return true;
  }

  private async notifyAbsent(
    assignment: ShiftAssignment,
    workDate: string,
    startTime?: string | null,
    endTime?: string | null,
    now: Date = new Date(),
  ) {
    const accountId = assignment.employee?.accountId;
    if (!accountId) return;
    await this.notificationsService.create(
      {
        accountId,
        storeId: assignment.shiftSlot?.cycle?.storeId,
        title: 'Nghỉ không phép',
        content: `Bạn không check-in ${this.shiftLabel(workDate, startTime, endTime, now)}. Ca được ghi nhận là nghỉ không phép.`,
        type: NotificationType.SYSTEM,
        priority: NotificationPriority.HIGH,
        actionUrl: '/(home)/workshift',
        metadata: {
          type: 'SHIFT_ABSENT',
          assignmentId: assignment.id,
          workDate,
          workDates: [workDate],
        },
      },
      {
        priority: 'high',
        channelId: shiftAlertChannel(assignment.employee?.reminderSettings),
      },
    );
  }

  async reconcileActiveAssignments(): Promise<number> {
    const assignments = await this.assignmentRepository.find({
      where: {
        status: ShiftAssignmentStatus.CONFIRMED,
        checkOutTime: IsNull(),
      },
      select: ['id'],
    });
    for (const assignment of assignments) {
      await this.scheduleForAssignment(assignment.id);
      const workflow = await this.workflowRepository.findOne({
        where: { shiftAssignmentId: assignment.id },
      });
      if (
        workflow &&
        Date.now() >= workflow.effectiveEndAt.getTime() + 15 * 60_000 &&
        workflow.state === ShiftEndWorkflowState.ACTIVE
      ) {
        await this.autoCheckout(assignment.id, workflow.effectiveEndAt);
      }
    }
    return assignments.length;
  }
}
