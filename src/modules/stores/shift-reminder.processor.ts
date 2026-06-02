import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType, NotificationPriority } from '../notifications/entities/notification.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmployeeProfile } from './entities/employee-profile.entity';
import moment from 'moment-timezone';

@Processor('shift-reminders')
export class ShiftReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ShiftReminderProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    @InjectRepository(EmployeeProfile)
    private readonly employeeRepository: Repository<EmployeeProfile>,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { employeeId, storeId, shiftId, startTime } = job.data;
    
    this.logger.log(`Processing shift reminder for employee ${employeeId}, shift ${shiftId}`);

    try {
      // 1. Fetch employee to get accountId and verify they still exist
      const employee = await this.employeeRepository.findOne({
        where: { id: employeeId, storeId },
        relations: ['account'],
      });

      if (!employee || !employee.account) {
        this.logger.warn(`Employee ${employeeId} not found or has no account, skipping reminder.`);
        return;
      }

      // 2. Lazy check: verify the ShiftAssignment is still APPROVED
      const assignment = await this.employeeRepository.manager.query(
        `SELECT sa.id, sa.status FROM shift_assignments sa
         JOIN shift_slots ss ON sa.shift_slot_id = ss.id
         WHERE sa.employee_id = $1 AND ss.work_shift_id = $2 AND sa.status = 'APPROVED'`,
        [employeeId, shiftId]
      );

      if (!assignment || assignment.length === 0) {
        this.logger.debug(`ShiftAssignment for employee ${employeeId} and shift ${shiftId} is deleted or not approved. Skipping reminder.`);
        return;
      }

      // 3. Format shift time for message
      const timeStr = moment(startTime).tz('Asia/Ho_Chi_Minh').format('HH:mm');

      // 4. Create and send notification
      await this.notificationsService.create({
        accountId: employee.accountId,
        storeId: employee.storeId,
        title: 'Nhắc nhở ca làm việc',
        content: `Ca làm của bạn sẽ bắt đầu lúc ${timeStr}. Đừng quên check-in đúng giờ nhé!`,
        type: NotificationType.SHIFT_REMINDER,
        priority: NotificationPriority.HIGH,
        metadata: {
          shiftId,
          type: 'shift_reminder'
        }
      });

      this.logger.log(`Successfully sent shift reminder to ${employee.accountId}`);
    } catch (error) {
      this.logger.error(`Error processing shift reminder: ${error.message}`, error.stack);
      throw error;
    }
  }
}
