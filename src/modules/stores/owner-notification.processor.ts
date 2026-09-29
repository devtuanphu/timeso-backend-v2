import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import {
  OwnerAlertJobData,
  OwnerNotificationService,
} from './owner-notification.service';
import { OWNER_SHIFT_ALERTS_QUEUE } from './owner-notification.utils';

/**
 * Delivers the owner's "shift starts soon" / "shift ends soon" alerts. All
 * validation (still scheduled, not on leave, setting still on, same time)
 * happens in OwnerNotificationService.processJob at processing time.
 */
@Processor(OWNER_SHIFT_ALERTS_QUEUE)
export class OwnerShiftAlertProcessor extends WorkerHost {
  private readonly logger = new Logger(OwnerShiftAlertProcessor.name);

  constructor(private readonly ownerNotificationService: OwnerNotificationService) {
    super();
  }

  async process(job: Job<OwnerAlertJobData>): Promise<unknown> {
    const tag = `[assignment=${job.data?.assignmentId ?? '-'} kind=${job.data?.kind ?? '-'} job=${job.id ?? '-'}]`;
    if (!job.data?.assignmentId || !job.data?.kind || !job.data?.fingerprint) {
      this.logger.warn(`Malformed owner alert job skipped ${tag}`);
      return { sent: false };
    }
    try {
      return await this.ownerNotificationService.processJob(job.data);
    } catch (error) {
      this.logger.error(
        `Owner alert failed ${tag}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }
}
