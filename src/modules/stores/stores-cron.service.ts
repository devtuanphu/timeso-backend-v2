import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StoresService } from './stores.service';
import { DistributedLockService } from './distributed-lock.service';

@Injectable()
export class StoresCronService {
  private readonly logger = new Logger(StoresCronService.name);

  constructor(
    private readonly storesService: StoresService,
    private readonly lockService: DistributedLockService,
  ) {}

  /**
   * Cron job chạy vào 00:05 (12:05 AM) mỗi ngày
   * Tạo DailyEmployeeReport cho tất cả các cửa hàng active
   */
  @Cron('5 0 * * *', {
    name: 'create-daily-reports',
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async handleCreateDailyReports() {
    const result = await this.lockService.withLock('cron:create-daily-reports', 300, async () => {
      this.logger.log('Starting daily reports creation for all stores...');
      const reports = await this.storesService.createDailyReportsForAllStores();
      this.logger.log(`Successfully created ${reports.length} daily reports`);
      return reports;
    });

    if (!result.ran) {
      this.logger.log('Skipped: create-daily-reports already running on another instance');
    }
  }

  /**
   * Cron job chạy vào 00:10 (12:10 AM) ngày 1 mỗi tháng
   * Tạo MonthlyPayroll cho tất cả các cửa hàng active
   */
  @Cron('10 0 1 * *', {
    name: 'create-monthly-payrolls',
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async handleCreateMonthlyPayrolls() {
    const result = await this.lockService.withLock('cron:create-monthly-payrolls', 1800, async () => {
      this.logger.log('Starting monthly payrolls creation for all stores...');
      const payrolls = await this.storesService.createMonthlyPayrollsForAllStores();
      this.logger.log(`Successfully created ${payrolls.length} monthly payrolls`);
      return payrolls;
    });

    if (!result.ran) {
      this.logger.log('Skipped: create-monthly-payrolls already running on another instance');
    }
  }

  /**
   * Cron job chạy vào 00:00 (12:00 AM) ngày 1 mỗi tháng
   * Tạo EmployeeMonthlySummary cho tất cả nhân viên active
   */
  @Cron('0 0 1 * *', {
    name: 'create-monthly-employee-summaries',
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async handleCreateMonthlySummaries() {
    const result = await this.lockService.withLock('cron:create-monthly-employee-summaries', 600, async () => {
      this.logger.log('Starting monthly employee summaries creation for all active employees...');
      const summaries = await this.storesService.createMonthlySummariesForAllEmployees();
      this.logger.log(`Successfully created ${summaries.length} monthly employee summaries`);
      return summaries;
    });

    if (!result.ran) {
      this.logger.log('Skipped: create-monthly-employee-summaries already running on another instance');
    }
  }

  /**
   * Cron job chạy vào 00:15 (12:15 AM) mỗi ngày
   * Xử lý các chu kỳ làm việc hết hạn và hẹn dừng
   */
  @Cron('15 0 * * *', {
    name: 'process-expired-work-cycles',
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async handleProcessExpiredCycles() {
    const result = await this.lockService.withLock('cron:process-expired-work-cycles', 300, async () => {
      this.logger.log('Starting to process expired and scheduled-stop work cycles...');
      const processResult = await this.storesService.processExpiredCycles();
      this.logger.log(`Processed work cycles: ${processResult.expiredCount} expired, ${processResult.stoppedCount} stopped`);
      return processResult;
    });

    if (!result.ran) {
      this.logger.log('Skipped: process-expired-work-cycles already running on another instance');
    }
  }

  /**
   * Cron job chạy vào 00:20 (12:20 AM) mỗi ngày
   * Tạo shift slots cho ngày mai cho các chu kỳ DAILY/WEEKLY/MONTHLY
   */
  @Cron('20 0 * * *', {
    name: 'generate-daily-slots',
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async handleGenerateDailySlots() {
    const result = await this.lockService.withLock('cron:generate-daily-slots', 300, async () => {
      this.logger.log('Starting to generate slots for tomorrow for all active cycles...');
      const generateResult = await this.storesService.generateDailySlotsForAllCycles();
      this.logger.log(`Generated slots: ${generateResult.createdSlots} slots for ${generateResult.processedCycles} cycles`);
      return generateResult;
    });

    if (!result.ran) {
      this.logger.log('Skipped: generate-daily-slots already running on another instance');
    }
  }

  /**
   * Cron job chạy vào 00:25 (12:25 AM) mỗi ngày
   * Tạo shift slots cho ngày mai cho các chu kỳ vô thời hạn (dựa trên template)
   */
  @Cron('25 0 * * *', {
    name: 'generate-slots-indefinite-cycles',
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async handleGenerateSlotsForIndefiniteCycles() {
    const result = await this.lockService.withLock('cron:generate-slots-indefinite-cycles', 300, async () => {
      this.logger.log('Starting to generate slots for indefinite work cycles...');
      const processResult = await this.storesService.generateDailySlotsForIndefiniteCycles();
      this.logger.log(`Processed ${processResult.processedCount} indefinite cycles`);
      return processResult;
    });

    if (!result.ran) {
      this.logger.log('Skipped: generate-slots-indefinite-cycles already running on another instance');
    }
  }

  /**
   * Cron job chạy vào 23:30 mỗi ngày
   * Phát hiện nhân viên quên check-out + nghỉ không phép
   * và ghi vào DailyEmployeeReport
   */
  @Cron('30 23 * * *', {
    name: 'detect-attendance-issues',
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async handleDetectAttendanceIssues() {
    const result = await this.lockService.withLock('cron:detect-attendance-issues', 300, async () => {
      this.logger.log('Starting end-of-day attendance issues detection...');
      const detectResult = await this.storesService.detectEndOfDayAttendanceIssues();
      this.logger.log(`Attendance issues detected: ${detectResult.forgotCount} forgot clock-out, ${detectResult.unauthorizedCount} unauthorized leaves`);
      return detectResult;
    });

    if (!result.ran) {
      this.logger.log('Skipped: detect-attendance-issues already running on another instance');
    }
  }
}
