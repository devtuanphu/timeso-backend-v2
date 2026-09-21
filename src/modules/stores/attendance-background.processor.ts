import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { StoresService } from './stores.service';
import {
  RECOMPUTE_EMPLOYEE_PAYSLIP_JOB,
  RecomputeEmployeePayslipJobData,
} from './shift-end-workflow.service';

@Processor('attendance-background')
export class AttendanceBackgroundProcessor extends WorkerHost {
  private readonly logger = new Logger(AttendanceBackgroundProcessor.name);

  constructor(private readonly storesService: StoresService) {
    super();
  }

  async process(
    job: Job<{ assignmentId: string } | RecomputeEmployeePayslipJobData>,
  ): Promise<void> {
    const startedAt = Date.now();
    if (job.name === 'process-checkout-payroll') {
      await this.storesService.processCheckoutPayroll(job.data.assignmentId);
      this.logger.log(
        `[AttendanceBackground] assignment=${job.data.assignmentId} payroll=${Date.now() - startedAt}ms`,
      );
      return;
    }
    if (job.name === RECOMPUTE_EMPLOYEE_PAYSLIP_JOB) {
      const data = job.data as RecomputeEmployeePayslipJobData;
      const outcome = await this.storesService.recomputeEmployeePayslipForWorkDate(
        {
          employeeProfileId: data.employeeProfileId,
          storeId: data.storeId,
          workDate: data.workDate,
        },
      );
      // Ids and outcome only: amounts are not log material.
      this.logger.log(
        `[AttendanceBackground] assignment=${data.assignmentId} payslip=${outcome} ${Date.now() - startedAt}ms`,
      );
    }
  }
}
