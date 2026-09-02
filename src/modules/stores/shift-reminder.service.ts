import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  ShiftAssignment,
  ShiftAssignmentStatus,
  WorkCycleStatus,
} from './entities/shift-management.entity';
import {
  buildShiftReminderFingerprint,
  buildShiftReminderJobId,
  buildShiftReminderSuccessorJobId,
  legacyShiftReminderJobIds,
  parseVietnamShiftStart,
  SHIFT_REMINDER_JOB_VERSION,
  ShiftReminderIdentity,
} from './shift-reminder.utils';

const REMINDER_DB_BATCH_SIZE = 500;
const REMINDER_MUTATION_CONCURRENCY = 10;
const REMINDER_LOCK_BATCH_SIZE = 100;
const REMINDER_LOCK_TTL_MS = 10_000;
const REMINDER_LOCK_ATTEMPTS = 20;
const REMINDER_LOCK_RETRY_MS = 100;
const REMINDER_COMPLETED_RETENTION = { age: 24 * 60 * 60, count: 50_000 };
const REMINDER_FAILED_RETENTION = { age: 7 * 24 * 60 * 60, count: 50_000 };

type ReminderJob = {
  name: 'send_reminder';
  data: {
    employeeId: string;
    storeId: string;
    shiftId: string;
    shiftSlotId?: string;
    assignmentId?: string;
    startTime: Date;
    scheduleFingerprint: string;
    reminderVersion: number;
  };
  opts: {
    delay: number;
    jobId: string;
    removeOnComplete: { age: number; count: number };
    removeOnFail: { age: number; count: number };
  };
};

type QueueRedisClient = Awaited<Queue['client']>;
type ReminderRedisClient = Omit<QueueRedisClient, 'set'> & {
  set(
    key: string,
    value: string,
    px: 'PX',
    ttl: number,
    nx: 'NX',
  ): Promise<'OK' | null>;
  eval(
    script: string,
    numberOfKeys: number,
    key: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
};

type ReminderMutationLease = {
  client: ReminderRedisClient;
  key: string;
  token: string;
};

class ReminderJobsLockedError extends Error {}

@Injectable()
export class ShiftReminderService {
  private readonly logger = new Logger(ShiftReminderService.name);

  constructor(
    @InjectQueue('shift-reminders') private readonly reminderQueue: Queue,
    @InjectRepository(ShiftAssignment)
    private readonly assignmentRepository: Repository<ShiftAssignment>,
  ) {}

  private async acquireReminderMutationLock(
    shiftId: string,
    employeeId: string,
    identity: ShiftReminderIdentity,
  ): Promise<ReminderMutationLease> {
    const queueClient = await this.reminderQueue.client;
    if (
      !queueClient ||
      typeof queueClient.set !== 'function' ||
      typeof (queueClient as unknown as { eval?: unknown }).eval !== 'function'
    ) {
      throw new Error('Shift reminder mutation lock unavailable');
    }
    // BullMQ's public IRedisClient type intentionally exposes only its common
    // command subset. This queue is configured with ioredis, whose runtime
    // client supports the SET modifiers and EVAL calls checked above.
    const client = queueClient as unknown as ReminderRedisClient;

    const identityKey = identity.assignmentId
      ? `assignment:${identity.assignmentId}`
      : buildShiftReminderJobId(identity, shiftId, employeeId);
    const lockKey = this.reminderQueue.toKey(`mutation-lock:${identityKey}`);
    const token = randomUUID();
    for (let attempt = 0; attempt < REMINDER_LOCK_ATTEMPTS; attempt += 1) {
      const acquired =
        (await client.set(lockKey, token, 'PX', REMINDER_LOCK_TTL_MS, 'NX')) ===
        'OK';
      if (acquired) return { client, key: lockKey, token };
      if (attempt + 1 < REMINDER_LOCK_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, REMINDER_LOCK_RETRY_MS),
        );
      }
    }
    throw new Error('Shift reminder mutation lock unavailable');
  }

  private async renewReminderMutationLock(lease: ReminderMutationLease) {
    const renewed = await lease.client.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then
         return redis.call('pexpire', KEYS[1], ARGV[2])
       end
       return 0`,
      1,
      lease.key,
      lease.token,
      REMINDER_LOCK_TTL_MS,
    );
    if (Number(renewed) !== 1) {
      throw new Error('Shift reminder mutation lock lost');
    }
  }

  private async releaseReminderMutationLock(lease: ReminderMutationLease) {
    try {
      await lease.client.eval(
        `if redis.call('get', KEYS[1]) == ARGV[1] then
           return redis.call('del', KEYS[1])
         end
         return 0`,
        1,
        lease.key,
        lease.token,
      );
    } catch {
      this.logger.error('Failed to release shift reminder mutation lock');
    }
  }

  private buildReminderJob(
    employeeId: string,
    storeId: string,
    shiftId: string,
    startTime: Date,
    settings: any,
    identity: ShiftReminderIdentity = {},
  ): ReminderJob | null {
    if (!settings || settings.type === 'off') return null;

    const shiftStart = new Date(startTime).getTime();
    let triggerTime = shiftStart;
    if (settings.type === '15m') triggerTime -= 15 * 60 * 1000;
    else if (settings.type === '30m') triggerTime -= 30 * 60 * 1000;
    else if (settings.type === '1h') triggerTime -= 60 * 60 * 1000;
    else if (settings.type === 'custom') {
      const { days = 0, hours = 0, minutes = 0 } = settings.custom || {};
      triggerTime -=
        (days * 24 * 60 * 60 + hours * 60 * 60 + minutes * 60) * 1000;
    }

    const delay = triggerTime - Date.now();
    if (delay <= 0) return null;
    const scheduleFingerprint = buildShiftReminderFingerprint(
      identity,
      shiftId,
      startTime,
      settings,
    );
    return {
      name: 'send_reminder',
      data: {
        employeeId,
        storeId,
        shiftId,
        shiftSlotId: identity.shiftSlotId,
        assignmentId: identity.assignmentId,
        startTime,
        scheduleFingerprint,
        reminderVersion: SHIFT_REMINDER_JOB_VERSION,
      },
      opts: {
        delay,
        jobId: buildShiftReminderJobId(identity, shiftId, employeeId),
        // Both successful and failed jobs are bounded by age and count. The
        // short successful retention lets delayed legacy jobs detect v2 while
        // the failed bound preserves diagnostics without unbounded Redis use.
        removeOnComplete: REMINDER_COMPLETED_RETENTION,
        removeOnFail: REMINDER_FAILED_RETENTION,
      },
    };
  }

  /**
   * Schedule or update a shift reminder for a specific employee
   */
  async scheduleReminder(
    employeeId: string,
    storeId: string,
    shiftId: string,
    startTime: Date,
    settings: any,
    identity: ShiftReminderIdentity = {},
  ) {
    if (identity.assignmentId) {
      return this.scheduleAssignmentReminder(identity.assignmentId);
    }
    // 1. Determine if we should set a reminder
    if (!settings || settings.type === 'off') {
      return this.removeReminder(shiftId, employeeId, identity, startTime);
    }

    const job = this.buildReminderJob(
      employeeId,
      storeId,
      shiftId,
      startTime,
      settings,
      identity,
    );
    if (!job) {
      this.logger.debug(
        `Skipping reminder for shift ${shiftId}, employee ${employeeId}: time has passed.`,
      );
      return;
    }

    const lease = await this.acquireReminderMutationLock(
      shiftId,
      employeeId,
      identity,
    );
    try {
      await this.renewReminderMutationLock(lease);
      const replacementJobId = await this.prepareReminderReplacement(
        shiftId,
        employeeId,
        identity,
        job.data.scheduleFingerprint,
      );
      if (replacementJobId) {
        await this.renewReminderMutationLock(lease);
        job.opts.jobId = replacementJobId;
        await this.reminderQueue.add(job.name, job.data, job.opts);
      }
    } finally {
      await this.releaseReminderMutationLock(lease);
    }

    this.logger.log(`Scheduled shift reminder in ${job.opts.delay}ms`);
  }

  private async loadAuthoritativeAssignments(assignmentIds: string[]) {
    if (!assignmentIds.length) return [];
    return this.assignmentRepository.find({
      where: {
        id: In(assignmentIds),
      },
      relations: [
        'shiftSlot',
        'shiftSlot.workShift',
        'shiftSlot.cycle',
        'employee',
      ],
    });
  }

  private async applyAuthoritativeAssignmentReminder(
    assignmentId: string,
    lease: ReminderMutationLease,
    assignment?: ShiftAssignment | null,
  ) {
    const current =
      assignment === undefined
        ? await this.assignmentRepository.findOne({
            where: {
              id: assignmentId,
              status: ShiftAssignmentStatus.APPROVED,
            },
            relations: [
              'shiftSlot',
              'shiftSlot.workShift',
              'shiftSlot.cycle',
              'employee',
            ],
          })
        : assignment;
    await this.renewReminderMutationLock(lease);
    const identity = {
      assignmentId,
      shiftSlotId: current?.shiftSlot?.id,
    };
    const slot = current?.shiftSlot;
    const cycle = slot?.cycle;
    const workShift = slot?.workShift;
    const employee = current?.employee;
    const time = slot?.startTime || workShift?.startTime;
    const scheduledStopAt = cycle?.scheduledStopAt
      ? new Date(cycle.scheduledStopAt).getTime()
      : null;
    const isCurrent = Boolean(
      current &&
      current.status === ShiftAssignmentStatus.APPROVED &&
      slot?.workDate &&
      workShift &&
      employee &&
      time &&
      cycle?.status === WorkCycleStatus.ACTIVE &&
      (scheduledStopAt === null || scheduledStopAt > Date.now()),
    );
    if (!isCurrent || !slot || !workShift || !employee || !time) {
      if (slot && workShift && employee) {
        await this.removeKnownReminderJobs(workShift.id, employee.id, identity);
      } else {
        await this.reminderQueue.remove(
          buildShiftReminderJobId(identity, '', ''),
        );
        await this.reminderQueue.remove(
          buildShiftReminderSuccessorJobId(identity, '', ''),
        );
      }
      return false;
    }

    const shiftStart = parseVietnamShiftStart(slot.workDate, time);
    const job = this.buildReminderJob(
      employee.id,
      employee.storeId,
      workShift.id,
      shiftStart,
      employee.reminderSettings,
      identity,
    );
    if (!job) {
      await this.removeKnownReminderJobs(workShift.id, employee.id, identity);
      return false;
    }
    const replacementJobId = await this.prepareReminderReplacement(
      workShift.id,
      employee.id,
      identity,
      job.data.scheduleFingerprint,
    );
    if (!replacementJobId) return false;
    await this.renewReminderMutationLock(lease);
    job.opts.jobId = replacementJobId;
    await this.reminderQueue.add(job.name, job.data, job.opts);
    return true;
  }

  async scheduleAssignmentReminder(assignmentId: string) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const lease = await this.acquireReminderMutationLock('', '', {
        assignmentId,
      });
      try {
        return await this.applyAuthoritativeAssignmentReminder(
          assignmentId,
          lease,
        );
      } catch (error) {
        if (!(error instanceof ReminderJobsLockedError)) {
          throw error;
        }
        if (attempt > 0) {
          throw new Error('Shift reminder reconciliation unavailable');
        }
      } finally {
        await this.releaseReminderMutationLock(lease);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error('Shift reminder reconciliation unavailable');
  }

  async scheduleAssignmentReminders(assignmentIds: string[]) {
    const uniqueIds = [...new Set(assignmentIds.filter(Boolean))];
    let loaded = 0;
    let enqueued = 0;
    let failed = 0;

    for (
      let offset = 0;
      offset < uniqueIds.length;
      offset += REMINDER_LOCK_BATCH_SIZE
    ) {
      const idBatch = uniqueIds.slice(
        offset,
        offset + REMINDER_LOCK_BATCH_SIZE,
      );
      const lockResults = await Promise.allSettled(
        idBatch.map(async (assignmentId) => ({
          assignmentId,
          lease: await this.acquireReminderMutationLock('', '', {
            assignmentId,
          }),
        })),
      );
      const locked = lockResults.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      failed += lockResults.length - locked.length;
      let assignments: ShiftAssignment[];
      try {
        assignments = await this.loadAuthoritativeAssignments(
          locked.map(({ assignmentId }) => assignmentId),
        );
      } catch {
        await Promise.allSettled(
          locked.map(({ lease }) => this.releaseReminderMutationLock(lease)),
        );
        failed += locked.length;
        continue;
      }
      loaded += assignments.length;
      const byId = new Map(
        assignments.map((assignment) => [assignment.id, assignment]),
      );
      const deferred: string[] = [];

      for (
        let mutationOffset = 0;
        mutationOffset < locked.length;
        mutationOffset += REMINDER_MUTATION_CONCURRENCY
      ) {
        const mutationBatch = locked.slice(
          mutationOffset,
          mutationOffset + REMINDER_MUTATION_CONCURRENCY,
        );
        const results = await Promise.allSettled(
          mutationBatch.map(async ({ assignmentId, lease }) => {
            try {
              return await this.applyAuthoritativeAssignmentReminder(
                assignmentId,
                lease,
                byId.get(assignmentId) ?? null,
              );
            } catch (error) {
              if (error instanceof ReminderJobsLockedError) {
                deferred.push(assignmentId);
                return false;
              }
              throw error;
            } finally {
              await this.releaseReminderMutationLock(lease);
            }
          }),
        );
        enqueued += results.filter(
          (result) => result.status === 'fulfilled' && result.value,
        ).length;
        failed += results.filter(
          (result) => result.status === 'rejected',
        ).length;
      }

      for (
        let retryOffset = 0;
        retryOffset < deferred.length;
        retryOffset += REMINDER_MUTATION_CONCURRENCY
      ) {
        const retryResults = await Promise.allSettled(
          deferred
            .slice(retryOffset, retryOffset + REMINDER_MUTATION_CONCURRENCY)
            .map(async (assignmentId) => {
              await new Promise((resolve) => setTimeout(resolve, 1_000));
              return this.scheduleAssignmentReminder(assignmentId);
            }),
        );
        enqueued += retryResults.filter(
          (result) => result.status === 'fulfilled' && result.value,
        ).length;
        failed += retryResults.filter(
          (result) => result.status === 'rejected',
        ).length;
      }
    }

    if (failed) {
      this.logger.error('Some shift reminders could not be reconciled');
    }
    this.logger.log(
      `Processed shift reminder batch: requested=${uniqueIds.length}, loaded=${loaded}, enqueued=${enqueued}`,
    );
    return { requested: uniqueIds.length, loaded, enqueued };
  }

  /**
   * Remove a scheduled reminder
   */
  async removeReminder(
    shiftId: string,
    employeeId: string,
    identity: ShiftReminderIdentity = {},
    _startTime?: Date,
  ) {
    const lease = await this.acquireReminderMutationLock(
      shiftId,
      employeeId,
      identity,
    );
    try {
      await this.renewReminderMutationLock(lease);
      await this.removeKnownReminderJobs(shiftId, employeeId, identity);
    } finally {
      await this.releaseReminderMutationLock(lease);
    }
    this.logger.log('Removed scheduled shift reminder jobs');
  }

  private async removeKnownReminderJobs(
    shiftId: string,
    employeeId: string,
    identity: ShiftReminderIdentity,
  ) {
    const jobIds = [
      buildShiftReminderJobId(identity, shiftId, employeeId),
      buildShiftReminderSuccessorJobId(identity, shiftId, employeeId),
      ...legacyShiftReminderJobIds(identity, shiftId, employeeId),
    ];
    for (const jobId of jobIds) {
      await this.reminderQueue.remove(jobId);
    }
  }

  /**
   * Prefer the single primary v2 id. BullMQ returns 0 when an active/locked job
   * cannot be removed, so retain that stale primary and put the latest payload
   * in one deterministic successor. This bounds the lifecycle to two known v2
   * jobs per assignment without scans or timestamp-derived accumulation.
   */
  private async prepareReminderReplacement(
    shiftId: string,
    employeeId: string,
    identity: ShiftReminderIdentity,
    scheduleFingerprint: string,
  ) {
    const primaryId = buildShiftReminderJobId(identity, shiftId, employeeId);
    const successorId = buildShiftReminderSuccessorJobId(
      identity,
      shiftId,
      employeeId,
    );
    const primaryRemoval = await this.reminderQueue.remove(primaryId);
    const primaryJob =
      primaryRemoval === 0
        ? await this.reminderQueue.getJob(primaryId)
        : undefined;
    const primaryStillExists = Boolean(primaryJob);

    const successorRemoval = await this.reminderQueue.remove(successorId);
    const successorJob =
      successorRemoval === 0
        ? await this.reminderQueue.getJob(successorId)
        : undefined;
    const successorStillExists = Boolean(successorJob);
    for (const legacyId of legacyShiftReminderJobIds(
      identity,
      shiftId,
      employeeId,
    )) {
      await this.reminderQueue.remove(legacyId);
    }
    if (
      primaryStillExists &&
      primaryJob?.data?.scheduleFingerprint === scheduleFingerprint
    ) {
      return null;
    }
    if (
      primaryStillExists &&
      successorStillExists &&
      successorJob?.data?.scheduleFingerprint !== scheduleFingerprint
    ) {
      throw new ReminderJobsLockedError('Current reminder jobs are locked');
    }
    if (successorStillExists) {
      if (successorJob?.data?.scheduleFingerprint === scheduleFingerprint) {
        return null;
      }
      return primaryId;
    }
    return primaryStillExists ? successorId : primaryId;
  }

  /**
   * Cancel v2 and known legacy jobs after a cycle has authoritatively stopped.
   * Relation reads and Redis operations are sequentially chunked and never run
   * inside the database transaction that changes cycle state.
   */
  async cancelAssignmentReminders(assignmentIds: string[]) {
    const uniqueIds = [...new Set(assignmentIds.filter(Boolean))];
    let loaded = 0;
    let cancelled = 0;

    for (
      let offset = 0;
      offset < uniqueIds.length;
      offset += REMINDER_DB_BATCH_SIZE
    ) {
      const idBatch = uniqueIds.slice(offset, offset + REMINDER_DB_BATCH_SIZE);
      const assignments = await this.assignmentRepository.find({
        where: { id: In(idBatch) },
        relations: ['shiftSlot', 'shiftSlot.workShift', 'employee'],
      });
      loaded += assignments.length;
      for (const assignment of assignments) {
        const slot = assignment.shiftSlot;
        const shift = slot?.workShift;
        const employee = assignment.employee;
        if (!slot || !shift || !employee) continue;
        const lease = await this.acquireReminderMutationLock(
          shift.id,
          employee.id,
          { assignmentId: assignment.id, shiftSlotId: slot.id },
        );
        try {
          await this.renewReminderMutationLock(lease);
          await this.removeKnownReminderJobs(shift.id, employee.id, {
            assignmentId: assignment.id,
            shiftSlotId: slot.id,
          });
        } finally {
          await this.releaseReminderMutationLock(lease);
        }
        cancelled += 1;
      }
    }

    this.logger.log(
      `Processed shift reminder cancellation batch: requested=${uniqueIds.length}, loaded=${loaded}, cancelled=${cancelled}`,
    );
    return { requested: uniqueIds.length, loaded, cancelled };
  }

  /**
   * Bulk schedule reminders for an employee based on upcoming shifts
   */
  async syncEmployeeReminders(
    _employeeId: string,
    _storeId: string,
    _settings: any,
    upcomingShifts: ShiftAssignment[],
  ) {
    return this.scheduleAssignmentReminders(
      upcomingShifts
        .filter((shift) => shift.status === ShiftAssignmentStatus.APPROVED)
        .map((shift) => shift.id)
        .filter(Boolean),
    );
  }
}
