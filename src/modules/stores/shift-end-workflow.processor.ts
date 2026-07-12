import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ShiftEndWorkflowService } from './shift-end-workflow.service';

@Processor('shift-end-workflows')
export class ShiftEndWorkflowProcessor extends WorkerHost {
  constructor(private readonly workflowService: ShiftEndWorkflowService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'shift-end-action') return;
    await this.workflowService.handleReminderJob(job.data);
  }
}
