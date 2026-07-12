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
import { AttendanceLog, AttendanceLogType, AttendanceMethod } from './entities/attendance-log.entity';
import { BonusWorkRequest, BonusWorkRequestStatus } from './entities/bonus-work-request.entity';
import { DailyEmployeeReport } from './entities/daily-employee-report.entity';
import { EmployeeProfile, WorkingStatus } from './entities/employee-profile.entity';
import { ShiftEndWorkflow, ShiftEndWorkflowState } from './entities/shift-end-workflow.entity';
import {
  AttendanceStatus,
  ShiftAssignment,
  ShiftAssignmentStatus,
} from './entities/shift-management.entity';

type ReminderMinute = 0 | 5 | 10 | 15;

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
    @InjectQueue('attendance-background') private readonly attendanceQueue: Queue,
  ) {}

  calculateScheduledEnd(workDate: string, startTime: string, endTime: string): Date {
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

    const scheduledEndAt = this.calculateScheduledEnd(slot.workDate, startTime, endTime);
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

  private async scheduleJobs(assignmentId: string, effectiveEndAt: Date): Promise<void> {
    for (const minute of [0, 5, 10, 15] as ReminderMinute[]) {
      const runAt = effectiveEndAt.getTime() + minute * 60_000;
      await this.workflowQueue.add(
        'shift-end-action',
        { assignmentId, expectedEndAt: effectiveEndAt.toISOString(), reminderMinute: minute },
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
      ![ShiftEndWorkflowState.ACTIVE, ShiftEndWorkflowState.OVERTIME_APPROVED].includes(
        workflow.state,
      )
    ) return;

    const assignment = await this.assignmentRepository.findOne({
      where: { id: data.assignmentId },
      relations: ['shiftSlot', 'shiftSlot.cycle', 'employee', 'employee.account'],
    });
    if (!assignment?.checkInTime) return;
    if (assignment.checkOutTime || assignment.status === ShiftAssignmentStatus.COMPLETED) {
      await this.markCompletedByEmployee(data.assignmentId);
      return;
    }

    const activeOvertime = await this.bonusWorkRepository.findOne({
      where: {
        shiftAssignmentId: data.assignmentId,
        status: In([BonusWorkRequestStatus.PENDING, BonusWorkRequestStatus.APPROVED]),
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
      { categoryId: 'SHIFT_END_ACTIONS', priority: 'high', channelId: 'shift-end' },
    );
  }

  private buildNotificationData(assignment: ShiftAssignment, workflow: ShiftEndWorkflow) {
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

  async autoCheckout(assignmentId: string, effectiveEndAt: Date): Promise<boolean> {
    const result = await this.dataSource.transaction(async (manager) => {
      const assignment = await manager.findOne(ShiftAssignment, {
        where: { id: assignmentId },
        relations: ['shiftSlot', 'shiftSlot.cycle', 'employee', 'employee.account'],
      });
      if (!assignment?.checkInTime || assignment.checkOutTime) return null;

      const pendingOvertime = await manager.findOne(BonusWorkRequest, {
        where: {
          shiftAssignmentId: assignmentId,
          status: In([BonusWorkRequestStatus.PENDING, BonusWorkRequestStatus.APPROVED]),
        },
      });
      if (pendingOvertime) return null;

      const autoCheckoutAt = new Date();
      const workedMinutes = Math.max(
        0,
        Math.floor((effectiveEndAt.getTime() - assignment.checkInTime.getTime()) / 60_000),
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
        .andWhere('status = :status', { status: ShiftAssignmentStatus.CONFIRMED })
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
    void this.attendanceQueue.add(
      'process-checkout-payroll',
      { assignmentId },
      { jobId: `checkout-payroll-${assignmentId}`, removeOnComplete: 1000 },
    ).catch((error) => {
      this.logger.error(`Không thể xếp hàng tính lương cho ca ${assignmentId}`, error?.stack);
    });
    const accountId = result.assignment.employee?.accountId;
    if (accountId) {
      await this.notificationsService.create({
        accountId,
        storeId: result.assignment.shiftSlot?.cycle?.storeId,
        title: 'Ca làm đã tự động kết thúc',
        content: 'Hệ thống ghi nhận bạn quên chấm công ra.',
        type: NotificationType.SHIFT_AUTO_CHECKOUT,
        priority: NotificationPriority.HIGH,
        metadata: { type: 'SHIFT_AUTO_CHECKOUT', assignmentId },
      });
    }
    return true;
  }

  private async appendForgotCheckout(storeId: string, employeeId: string, at: Date) {
    if (!storeId) return;
    const reportDate = new Date(at.getFullYear(), at.getMonth(), at.getDate());
    let report = await this.dailyReportRepository.findOne({ where: { storeId, reportDate } });
    if (!report) {
      report = this.dailyReportRepository.create({ storeId, reportDate, forgotClockOut: [] });
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
      { state: ShiftEndWorkflowState.OVERTIME_PENDING, overtimeRequestId: request.id },
    );
  }

  async approveOvertime(request: BonusWorkRequest): Promise<void> {
    if (!request.shiftAssignmentId || !request.requestDate || !request.endTime) return;
    const workflow = await this.workflowRepository.findOne({
      where: { shiftAssignmentId: request.shiftAssignmentId },
    });
    if (!workflow) return;
    const effectiveEndAt = new Date(`${request.requestDate}T${request.endTime}+07:00`);
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
    const effectiveEndAt = now > workflow.scheduledEndAt
      ? new Date(now.getTime() + 5 * 60_000)
      : workflow.scheduledEndAt;
    await this.workflowRepository.update(workflow.id, {
      state: ShiftEndWorkflowState.ACTIVE,
      effectiveEndAt,
      overtimeRequestId: null,
    });
    await this.scheduleJobs(request.shiftAssignmentId, effectiveEndAt);
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
