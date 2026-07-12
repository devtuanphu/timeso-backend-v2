import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { StoresService } from './stores.service';

@Processor('attendance-background')
export class AttendanceBackgroundProcessor extends WorkerHost {
  private readonly logger = new Logger(AttendanceBackgroundProcessor.name);

  constructor(private readonly storesService: StoresService) {
    super();
  }

  async process(job: Job<{ assignmentId: string }>): Promise<void> {
    if (job.name !== 'process-checkout-payroll') return;

    const startedAt = Date.now();
    await this.storesService.processCheckoutPayroll(job.data.assignmentId);
    this.logger.log(
      `[AttendanceBackground] assignment=${job.data.assignmentId} payroll=${Date.now() - startedAt}ms`,
    );
  }
}
