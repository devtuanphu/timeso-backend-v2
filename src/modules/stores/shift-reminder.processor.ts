import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationType,
  NotificationPriority,
} from '../notifications/entities/notification.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmployeeProfile } from './entities/employee-profile.entity';
import moment from 'moment-timezone';
import {
  buildShiftReminderFingerprint,
  buildShiftReminderJobId,
  buildShiftReminderSuccessorJobId,
  effectiveReminderSettings,
  parseVietnamShiftStart,
  SHIFT_REMINDER_TIMEZONE,
} from './shift-reminder.utils';
import { WorkCycleStatus } from './entities/shift-management.entity';
import { formatShiftMoment } from '../../common/utils/relative-day';
import { vnClockHHmm, vnDateString } from '../../common/utils/vn-calendar';
import { shiftAlertChannel } from './shift-end-workflow.service';
import { isShiftCoveredByApprovedLeave } from './leave-coverage.utils';

@Processor('shift-reminders')
export class ShiftReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ShiftReminderProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    @InjectRepository(EmployeeProfile)
    private readonly employeeRepository: Repository<EmployeeProfile>,
    @InjectQueue('shift-reminders') private readonly reminderQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const {
      employeeId,
      storeId,
      shiftId,
      shiftSlotId,
      assignmentId,
      startTime,
      scheduleFingerprint,
    } = job.data;

    this.logger.log('Processing shift reminder');

    try {
      // 1. Fetch employee to get accountId and verify they still exist
      const employee = await this.employeeRepository.findOne({
        where: { id: employeeId, storeId },
        relations: ['account'],
      });

      if (!employee || !employee.account) {
        this.logger.warn(
          'Reminder recipient is unavailable; skipping reminder',
        );
        return;
      }

      // Legacy jobs may still use the work-shift-only key. Always honor the
      // current preference at processing time so an opt-out cannot leak a
      // queued notification after identity-key migration.
      // Chưa lưu cài đặt thì dùng mặc định (nhắc trước 15 phút), cùng cách
      // buildReminderJob tính fingerprint.
      const reminderSettings = effectiveReminderSettings(
        employee.reminderSettings,
      );
      if (reminderSettings.type === 'off') {
        this.logger.debug('Shift reminders are disabled; skipping reminder');
        return;
      }

      let legacyWorkDate: string | null = null;
      let legacyStartTime: string | null = null;
      let legacyStart: number | null = null;
      if (!scheduleFingerprint) {
        const legacyMoment = moment(startTime);
        if (!legacyMoment.isValid()) {
          this.logger.debug('Legacy shift reminder time is invalid');
          return;
        }
        const localStart = legacyMoment.tz(SHIFT_REMINDER_TIMEZONE);
        legacyWorkDate = localStart.format('YYYY-MM-DD');
        legacyStartTime = localStart.format('HH:mm:ss');
        legacyStart = legacyMoment.valueOf();
      }

      // 2. Lazy check: verify the ShiftAssignment is still APPROVED
      const assignment = await this.employeeRepository.manager.query(
        `SELECT sa.id,
                sa.status,
                ss.id "shiftSlotId",
                ss.work_date "workDate",
                COALESCE(ss.start_time, ws.start_time) "startTime",
                ss.work_shift_id "shiftId"
         FROM shift_assignments sa
         JOIN shift_slots ss ON sa.shift_slot_id = ss.id
         JOIN work_shifts ws ON ss.work_shift_id = ws.id
         JOIN work_cycles wc ON ss.cycle_id = wc.id
         WHERE sa.employee_id = $1
           AND sa.status = 'APPROVED'
           AND ($2::uuid IS NULL OR sa.id = $2::uuid)
           AND ($3::uuid IS NULL OR ss.id = $3::uuid)
           AND ($4::uuid IS NULL OR ss.work_shift_id = $4::uuid)
           AND ($5::date IS NULL OR ss.work_date = $5::date)
           AND ($6::time IS NULL OR COALESCE(ss.start_time, ws.start_time) = $6::time)
           AND wc.status = $7
           AND (wc.scheduled_stop_at IS NULL OR wc.scheduled_stop_at > NOW())`,
        [
          employeeId,
          assignmentId || null,
          shiftSlotId || null,
          shiftId || null,
          legacyWorkDate,
          legacyStartTime,
          WorkCycleStatus.ACTIVE,
        ],
      );

      if (!assignment || assignment.length === 0) {
        this.logger.debug('Shift assignment is unavailable; skipping reminder');
        return;
      }

      const current = assignment[0];
      if (!current || !current.workDate || !current.startTime) {
        this.logger.debug('Shift schedule is incomplete; skipping reminder');
        return;
      }
      const currentStart = parseVietnamShiftStart(
        current.workDate,
        current.startTime,
      );
      const currentIdentity = {
        assignmentId: current.id,
        shiftSlotId: current.shiftSlotId,
      };
      const currentFingerprint = buildShiftReminderFingerprint(
        currentIdentity,
        current.shiftId,
        currentStart,
        reminderSettings,
      );

      if (scheduleFingerprint) {
        if (scheduleFingerprint !== currentFingerprint) {
          this.logger.debug('Superseded shift reminder skipped');
          return;
        }
      } else {
        if (
          legacyStart === null ||
          !Number.isFinite(legacyStart) ||
          legacyStart !== currentStart.getTime()
        ) {
          this.logger.debug('Stale legacy shift reminder skipped');
          return;
        }
        const currentV2Ids = [
          buildShiftReminderJobId(currentIdentity, current.shiftId, employeeId),
          buildShiftReminderSuccessorJobId(
            currentIdentity,
            current.shiftId,
            employeeId,
          ),
        ];
        for (const currentV2Id of currentV2Ids) {
          const replacementJob = await this.reminderQueue.getJob(currentV2Id);
          if (replacementJob && replacementJob.id !== job.id) {
            this.logger.debug('Legacy shift reminder replaced by current job');
            return;
          }
        }
      }

      // Nghỉ có phép (đơn nghỉ cả ngày đã duyệt) thì không nhắc vào ca.
      const workDate = vnDateString(currentStart);
      if (
        await isShiftCoveredByApprovedLeave(
          this.employeeRepository.manager,
          employeeId,
          workDate,
          current.id,
        )
      ) {
        this.logger.debug('Employee is on approved leave; skipping reminder');
        return;
      }

      // 3. "08:00 hôm nay (21/09)" / "08:00 ngày mai (22/09)" / "08:00 ngày
      // 25/09": luôn giữ ngày tuyệt đối; danh sách thông báo tính lại nhãn
      // tương đối theo lúc đọc (metadata.workDates).
      const timeStr = formatShiftMoment(workDate, vnClockHHmm(currentStart));

      // 4. Create and send notification
      await this.notificationsService.create(
        {
          accountId: employee.accountId,
          storeId: employee.storeId,
          title: 'Nhắc nhở ca làm việc',
          content: `Ca làm của bạn sẽ bắt đầu lúc ${timeStr}. Đừng quên check-in đúng giờ nhé!`,
          type: NotificationType.SHIFT_REMINDER,
          priority: NotificationPriority.HIGH,
          // Chạm vào thông báo mở thẳng lịch làm việc của nhân viên.
          actionUrl: '/(home)/workshift',
          metadata: {
            shiftId: current.shiftId,
            shiftSlotId: current.shiftSlotId,
            assignmentId: current.id,
            type: 'shift_reminder',
            workDate,
            workDates: [workDate],
          },
        },
        {
          priority: 'high',
          channelId: shiftAlertChannel(reminderSettings),
        },
      );

      this.logger.log('Shift reminder sent successfully');
    } catch (error) {
      this.logger.error('Shift reminder processing failed');
      throw error;
    }
  }
}
