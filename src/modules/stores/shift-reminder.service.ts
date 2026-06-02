import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { WorkShift } from './entities/work-shift.entity';
import { ShiftAssignment } from './entities/shift-management.entity';

@Injectable()
export class ShiftReminderService {
  private readonly logger = new Logger(ShiftReminderService.name);

  constructor(
    @InjectQueue('shift-reminders') private readonly reminderQueue: Queue,
  ) {}

  /**
   * Schedule or update a shift reminder for a specific employee
   */
  async scheduleReminder(
    employeeId: string,
    storeId: string,
    shiftId: string,
    startTime: Date,
    settings: any,
  ) {
    // 1. Determine if we should set a reminder
    if (!settings || settings.type === 'off') {
      return this.removeReminder(shiftId, employeeId);
    }

    // 2. Calculate trigger time
    const shiftStart = new Date(startTime).getTime();
    let triggerTime = shiftStart;

    if (settings.type === '15m') triggerTime -= 15 * 60 * 1000;
    else if (settings.type === '30m') triggerTime -= 30 * 60 * 1000;
    else if (settings.type === '1h') triggerTime -= 60 * 60 * 1000;
    else if (settings.type === 'custom') {
      const { days = 0, hours = 0, minutes = 0 } = settings.custom || {};
      const offset =
        (days * 24 * 60 * 60 + hours * 60 * 60 + minutes * 60) * 1000;
      triggerTime -= offset;
    }

    const delay = triggerTime - Date.now();

    // 3. Skip if the trigger time is already in the past
    if (delay <= 0) {
      this.logger.debug(
        `Skipping reminder for shift ${shiftId}, employee ${employeeId}: time has passed.`,
      );
      return;
    }

    // 4. Create Job ID
    const jobId = `reminder_${shiftId}_${employeeId}`;

    // 5. Add to queue (will overwrite if exists with same jobId)
    await this.reminderQueue.add(
      'send_reminder',
      { employeeId, storeId, shiftId, startTime },
      { delay, jobId, removeOnComplete: true, removeOnFail: false },
    );

    this.logger.log(
      `Scheduled reminder for shift ${shiftId}, employee ${employeeId} in ${delay}ms`,
    );
  }

  /**
   * Remove a scheduled reminder
   */
  async removeReminder(shiftId: string, employeeId: string) {
    const jobId = `reminder_${shiftId}_${employeeId}`;
    const job = await this.reminderQueue.getJob(jobId);
    if (job) {
      await job.remove();
      this.logger.log(`Removed reminder job ${jobId}`);
    }
  }

  /**
   * Bulk schedule reminders for an employee based on upcoming shifts
   */
  async syncEmployeeReminders(
    employeeId: string,
    storeId: string,
    settings: any,
    upcomingShifts: ShiftAssignment[],
  ) {
    for (const shift of upcomingShifts) {
      if (
        shift.shiftSlot &&
        shift.shiftSlot.workDate &&
        shift.shiftSlot.workShift
      ) {
        // Construct accurate start time from workDate and startTime
        const dateStr = shift.shiftSlot.workDate; // YYYY-MM-DD
        const timeStr =
          shift.shiftSlot.startTime || shift.shiftSlot.workShift.startTime; // HH:mm:ss
        if (timeStr) {
          const shiftStart = new Date(`${dateStr}T${timeStr}`);
          await this.scheduleReminder(
            employeeId,
            storeId,
            shift.shiftSlot.workShift.id,
            shiftStart,
            settings,
          );
        }
      }
    }
  }
}
