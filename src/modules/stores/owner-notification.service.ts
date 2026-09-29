import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';

import { vnClockHHmm, vnDateString } from '../../common/utils/vn-calendar';
import {
  NotificationPriority,
  NotificationType,
} from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveShiftBoundaries } from './attendance-time.utils';
import { OwnerNotificationSetting } from './entities/owner-notification-setting.entity';
import {
  ShiftAssignmentStatus,
  WorkCycleStatus,
} from './entities/shift-management.entity';
import { isShiftCoveredByApprovedLeave } from './leave-coverage.utils';
import {
  DEFAULT_OWNER_NOTIFICATION_SETTINGS,
  OWNER_NOTIFICATION_TYPES,
  OWNER_SHIFT_ALERTS_QUEUE,
  OWNER_SHIFT_ENDING_LEAD_MINUTES,
  OWNER_WORK_SHIFT_ROUTE,
  OwnerAlertKind,
  OwnerNotificationSettingsView,
  ownerAlertDedupKey,
  ownerAlertFingerprint,
  ownerAlertJobId,
  ownerCheckInText,
  ownerCheckOutText,
  ownerPreShiftText,
  ownerShiftEndingText,
} from './owner-notification.utils';
import {
  parseVietnamShiftStart,
  toWorkDateString,
} from './shift-reminder.utils';

const SYNC_BATCH_SIZE = 200;
const COMPLETED_RETENTION = true;
const FAILED_RETENTION = { age: 7 * 24 * 60 * 60, count: 5_000 };

export interface OwnerAlertJobData {
  assignmentId: string;
  kind: OwnerAlertKind;
  fingerprint: string;
}

/** One assignment with everything an owner alert needs, read in one query. */
interface AssignmentContext {
  id: string;
  status: ShiftAssignmentStatus;
  checkedIn: boolean;
  checkedOut: boolean;
  workDate: string | Date;
  startTime: string | null;
  endTime: string | null;
  shiftName: string | null;
  storeId: string;
  cycleStatus: WorkCycleStatus;
  scheduledStopAt: Date | null;
  ownerAccountId: string | null;
  employeeId: string;
  employeeAccountId: string;
  employeeName: string | null;
  effectiveEndAt: Date | null;
}

interface ShiftTimes {
  start: Date;
  /** Shift end, or the approved-overtime end once a workflow exists. */
  effectiveEnd: Date;
  workDate: string;
}

export type OwnerNotificationSettingsUpdate = Partial<OwnerNotificationSettingsView>;

/**
 * X6: notifications to the store owner about their staff's shifts, each one
 * switchable per store in the owner's settings (all on by default).
 *
 *  - check-in / check-out (late / early folded in), sent right after the
 *    attendance transaction commits;
 *  - "shift starts in 15/30 minutes" and "shift ends in 15 minutes", one per
 *    employee, as delayed BullMQ jobs per assignment.
 *
 * Jobs have a stable id per (kind, assignment) and carry a fingerprint of the
 * time and lead they were built for; the processor re-reads the assignment
 * and the settings and skips anything cancelled, changed, disabled or on
 * leave. `owner_notification_log.dedup_key` makes every send at-most-once.
 * Nothing here ever throws into the attendance or scheduling path.
 */
@Injectable()
export class OwnerNotificationService {
  private readonly logger = new Logger(OwnerNotificationService.name);

  constructor(
    @InjectRepository(OwnerNotificationSetting)
    private readonly settingsRepository: Repository<OwnerNotificationSetting>,
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
    @InjectQueue(OWNER_SHIFT_ALERTS_QUEUE) private readonly queue: Queue,
  ) {}

  // ─── settings ───────────────────────────────────────────────────────────

  async getSettings(
    storeId: string,
    ownerAccountId: string,
  ): Promise<OwnerNotificationSettingsView> {
    const row = await this.settingsRepository.findOne({
      where: { storeId, ownerAccountId },
    });
    return toView(row);
  }

  async updateSettings(
    storeId: string,
    ownerAccountId: string,
    changes: OwnerNotificationSettingsUpdate,
  ): Promise<OwnerNotificationSettingsView> {
    const current = await this.getSettings(storeId, ownerAccountId);
    const next: OwnerNotificationSettingsView = {
      ...current,
      ...pickDefined(changes),
    };
    await this.settingsRepository.upsert(
      { storeId, ownerAccountId, ...next },
      ['storeId', 'ownerAccountId'],
    );
    // A switch turned on or a new lead time needs the store's upcoming jobs
    // rebuilt. After the write, best effort, not awaited by the request.
    if (
      next.preShiftEnabled !== current.preShiftEnabled ||
      next.preShiftMinutes !== current.preShiftMinutes ||
      next.shiftEndingEnabled !== current.shiftEndingEnabled
    ) {
      void this.reconcileUpcoming(new Date(), { storeId }).catch(() =>
        this.logger.warn('Owner alert reschedule after settings change failed'),
      );
    }
    return next;
  }

  // ─── check-in / check-out ────────────────────────────────────────────────

  /**
   * Called after a check-in or check-out has committed. Sends the owner
   * notification (if enabled) and refreshes the assignment's scheduled jobs
   * (check-in cancels the pre-shift one and arms "ending soon"). Never throws.
   */
  async afterAttendance(input: {
    kind: 'check_in' | 'check_out';
    assignmentId: string;
    at: Date;
    lateMinutes?: number;
    earlyMinutes?: number;
  }): Promise<void> {
    try {
      await this.notifyAttendance(input);
    } catch (error) {
      this.logger.warn(
        `Owner ${input.kind} notification failed [assignment=${input.assignmentId}]: ${errorText(error)}`,
      );
    }
    try {
      await this.syncAssignments([input.assignmentId]);
    } catch (error) {
      this.logger.warn(
        `Owner alert sync after ${input.kind} failed [assignment=${input.assignmentId}]: ${errorText(error)}`,
      );
    }
  }

  async notifyAttendance(input: {
    kind: 'check_in' | 'check_out';
    assignmentId: string;
    at: Date;
    lateMinutes?: number;
    earlyMinutes?: number;
  }): Promise<boolean> {
    const [ctx] = await this.loadContexts([input.assignmentId]);
    if (!ctx || !this.hasDistinctOwner(ctx)) return false;
    const owner = ctx.ownerAccountId as string;
    const settings = await this.getSettings(ctx.storeId, owner);
    const at = vnClockHHmm(input.at);
    const workDate = toWorkDateString(ctx.workDate);

    if (input.kind === 'check_in') {
      const late =
        (input.lateMinutes ?? 0) > 0 && settings.lateEarlyEnabled
          ? (input.lateMinutes as number)
          : 0;
      if (!settings.checkInEnabled && !late) return false;
      const type = settings.checkInEnabled
        ? OWNER_NOTIFICATION_TYPES.CHECK_IN
        : OWNER_NOTIFICATION_TYPES.LATE;
      return this.sendOnce({
        ctx,
        dedupKey: ownerAlertDedupKey('check_in', owner, ctx.id),
        title: late ? 'Nhân viên đi trễ' : 'Nhân viên check-in',
        content: ownerCheckInText({
          employeeName: ctx.employeeName,
          shiftName: ctx.shiftName,
          at,
          lateMinutes: late,
        }),
        metadata: {
          type,
          workDate,
          checkInAt: at,
          ...(late ? { lateMinutes: late } : {}),
        },
      });
    }

    const early =
      (input.earlyMinutes ?? 0) > 0 && settings.lateEarlyEnabled
        ? (input.earlyMinutes as number)
        : 0;
    if (!settings.checkOutEnabled && !early) return false;
    const type = settings.checkOutEnabled
      ? OWNER_NOTIFICATION_TYPES.CHECK_OUT
      : OWNER_NOTIFICATION_TYPES.EARLY_LEAVE;
    return this.sendOnce({
      ctx,
      dedupKey: ownerAlertDedupKey('check_out', owner, ctx.id),
      title: early ? 'Nhân viên về sớm' : 'Nhân viên check-out',
      content: ownerCheckOutText({
        employeeName: ctx.employeeName,
        shiftName: ctx.shiftName,
        at,
        earlyMinutes: early,
      }),
      metadata: {
        type,
        workDate,
        checkOutAt: at,
        ...(early ? { earlyMinutes: early } : {}),
      },
    });
  }

  // ─── scheduled alerts ────────────────────────────────────────────────────

  /**
   * (Re)schedules or removes the pre-shift and ending-soon jobs of these
   * assignments from their current state. Idempotent: a job whose
   * fingerprint still matches is left alone.
   */
  async syncAssignments(
    assignmentIds: string[],
    now: Date = new Date(),
  ): Promise<{ scheduled: number }> {
    const ids = [...new Set(assignmentIds.filter(Boolean))];
    let scheduled = 0;
    for (let offset = 0; offset < ids.length; offset += SYNC_BATCH_SIZE) {
      const batch = ids.slice(offset, offset + SYNC_BATCH_SIZE);
      const contexts = await this.loadContexts(batch);
      const byId = new Map(contexts.map((ctx) => [ctx.id, ctx]));
      const settingsCache = new Map<string, OwnerNotificationSettingsView>();
      for (const id of batch) {
        try {
          const ctx = byId.get(id);
          const plan = ctx
            ? await this.planJobs(ctx, now, settingsCache)
            : { pre_shift: null, shift_ending: null };
          for (const kind of ['pre_shift', 'shift_ending'] as const) {
            const job = plan[kind];
            if (job) {
              if (await this.upsertJob(kind, id, job.fingerprint, job.runAt, now)) {
                scheduled += 1;
              }
            } else {
              await this.queue.remove(ownerAlertJobId(kind, id));
            }
          }
        } catch (error) {
          this.logger.warn(
            `Owner alert sync failed [assignment=${id}]: ${errorText(error)}`,
          );
        }
      }
    }
    return { scheduled };
  }

  /** Removes both scheduled jobs of these assignments. Never throws. */
  async cancelAssignments(assignmentIds: string[]): Promise<void> {
    for (const id of new Set(assignmentIds.filter(Boolean))) {
      for (const kind of ['pre_shift', 'shift_ending'] as const) {
        try {
          await this.queue.remove(ownerAlertJobId(kind, id));
        } catch (error) {
          this.logger.warn(
            `Owner alert cancel failed [assignment=${id}]: ${errorText(error)}`,
          );
        }
      }
    }
  }

  /**
   * Re-creates the jobs of every live assignment in a bounded look-ahead
   * window (jobs live only in Redis). Includes yesterday's work dates for
   * shifts crossing midnight. Bounded by `limit` (max 5000).
   */
  async reconcileUpcoming(
    now: Date = new Date(),
    options: {
      windowHours?: number;
      limit?: number;
      storeId?: string;
      /** Also sync these (merged, each assignment synced once per run). */
      extraAssignmentIds?: string[];
    } = {},
  ): Promise<{ candidates: number }> {
    const windowHours = options.windowHours ?? 48;
    const limit = Math.min(Math.max(options.limit ?? 2000, 1), 5000);
    const from = vnDateString(new Date(now.getTime() - 24 * 3_600_000));
    const to = vnDateString(new Date(now.getTime() + windowHours * 3_600_000));
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT sa.id
       FROM shift_assignments sa
       JOIN shift_slots ss ON ss.id = sa.shift_slot_id
       JOIN work_cycles wc ON wc.id = ss.cycle_id
       WHERE sa.status IN ('APPROVED', 'CONFIRMED')
         AND sa.check_out_time IS NULL
         AND sa.deleted_at IS NULL
         AND wc.status = $1
         AND ss.work_date >= $2::date
         AND ss.work_date <= $3::date
         AND ($4::uuid IS NULL OR wc.store_id = $4::uuid)
       ORDER BY ss.work_date ASC, sa.id ASC
       LIMIT $5`,
      [WorkCycleStatus.ACTIVE, from, to, options.storeId ?? null, limit],
    );
    const ids = [
      ...new Set([
        ...rows.map((row) => row.id),
        ...(options.extraAssignmentIds ?? []).filter(Boolean),
      ]),
    ];
    if (ids.length) await this.syncAssignments(ids, now);
    return { candidates: ids.length };
  }

  /**
   * Queue processor entry: re-validates against current state and sends at
   * most once. Throws only on a send failure, so BullMQ retries.
   */
  async processJob(data: OwnerAlertJobData, now: Date = new Date()) {
    const [ctx] = await this.loadContexts([data.assignmentId]);
    if (!ctx || !this.hasDistinctOwner(ctx)) return { sent: false };
    const owner = ctx.ownerAccountId as string;
    const settings = await this.getSettings(ctx.storeId, owner);
    const times = shiftTimes(ctx);
    if (!times || !isCycleLive(ctx, now)) return { sent: false };

    if (data.kind === 'pre_shift') {
      if (
        !settings.preShiftEnabled ||
        ctx.status !== ShiftAssignmentStatus.APPROVED ||
        ctx.checkedIn
      ) {
        return { sent: false };
      }
      const fingerprint = ownerAlertFingerprint(
        'pre_shift',
        times.start,
        settings.preShiftMinutes,
      );
      if (fingerprint !== data.fingerprint) return { sent: false };
      // A delayed job (worker down, queue backlog) must not announce
      // "starts in 30 minutes" for a shift that has already started.
      if (now.getTime() >= times.start.getTime()) return { sent: false };
      if (
        await isShiftCoveredByApprovedLeave(
          this.dataSource,
          ctx.employeeId,
          times.workDate,
          ctx.id,
        )
      ) {
        return { sent: false };
      }
      const at = vnClockHHmm(times.start);
      const sent = await this.sendOnce({
        ctx,
        dedupKey: ownerAlertDedupKey('pre_shift', owner, ctx.id, times.start),
        title: 'Sắp đến ca làm',
        content: ownerPreShiftText({
          employeeName: ctx.employeeName,
          at,
          minutes: settings.preShiftMinutes,
        }),
        metadata: {
          type: OWNER_NOTIFICATION_TYPES.PRE_SHIFT,
          workDate: times.workDate,
          startTime: at,
          minutesBefore: settings.preShiftMinutes,
        },
        high: true,
      });
      return { sent };
    }

    if (
      !settings.shiftEndingEnabled ||
      !ctx.checkedIn ||
      ctx.checkedOut ||
      ![ShiftAssignmentStatus.APPROVED, ShiftAssignmentStatus.CONFIRMED].includes(
        ctx.status,
      )
    ) {
      return { sent: false };
    }
    const fingerprint = ownerAlertFingerprint('shift_ending', times.effectiveEnd);
    if (fingerprint !== data.fingerprint) return { sent: false };
    // Likewise, never "ends in 15 minutes" once the shift has ended.
    if (now.getTime() >= times.effectiveEnd.getTime()) return { sent: false };
    const at = vnClockHHmm(times.effectiveEnd);
    const sent = await this.sendOnce({
      ctx,
      dedupKey: ownerAlertDedupKey(
        'shift_ending',
        owner,
        ctx.id,
        times.effectiveEnd,
      ),
      title: 'Ca sắp kết thúc',
      content: ownerShiftEndingText({
        employeeName: ctx.employeeName,
        at,
        minutes: OWNER_SHIFT_ENDING_LEAD_MINUTES,
      }),
      metadata: {
        type: OWNER_NOTIFICATION_TYPES.SHIFT_ENDING,
        workDate: times.workDate,
        endTime: at,
        minutesBefore: OWNER_SHIFT_ENDING_LEAD_MINUTES,
      },
      high: true,
    });
    return { sent };
  }

  // ─── internals ───────────────────────────────────────────────────────────

  private hasDistinctOwner(ctx: AssignmentContext) {
    // No owner, or the owner is the employee on this shift: nothing to tell.
    return Boolean(
      ctx.ownerAccountId && ctx.ownerAccountId !== ctx.employeeAccountId,
    );
  }

  private async planJobs(
    ctx: AssignmentContext,
    now: Date,
    cache: Map<string, OwnerNotificationSettingsView>,
  ): Promise<
    Record<OwnerAlertKind, { fingerprint: string; runAt: number } | null>
  > {
    const none = { pre_shift: null, shift_ending: null };
    if (!this.hasDistinctOwner(ctx) || !isCycleLive(ctx, now)) return none;
    const times = shiftTimes(ctx);
    if (!times) return none;
    const owner = ctx.ownerAccountId as string;
    const cacheKey = `${ctx.storeId}|${owner}`;
    let settings = cache.get(cacheKey);
    if (!settings) {
      settings = await this.getSettings(ctx.storeId, owner);
      cache.set(cacheKey, settings);
    }

    const plan: Record<
      OwnerAlertKind,
      { fingerprint: string; runAt: number } | null
    > = { pre_shift: null, shift_ending: null };
    if (
      settings.preShiftEnabled &&
      ctx.status === ShiftAssignmentStatus.APPROVED &&
      !ctx.checkedIn
    ) {
      const runAt = times.start.getTime() - settings.preShiftMinutes * 60_000;
      if (runAt > now.getTime()) {
        plan.pre_shift = {
          runAt,
          fingerprint: ownerAlertFingerprint(
            'pre_shift',
            times.start,
            settings.preShiftMinutes,
          ),
        };
      }
    }
    if (
      settings.shiftEndingEnabled &&
      !ctx.checkedOut &&
      (ctx.status === ShiftAssignmentStatus.APPROVED ||
        ctx.status === ShiftAssignmentStatus.CONFIRMED)
    ) {
      const runAt =
        times.effectiveEnd.getTime() - OWNER_SHIFT_ENDING_LEAD_MINUTES * 60_000;
      if (runAt > now.getTime()) {
        plan.shift_ending = {
          runAt,
          fingerprint: ownerAlertFingerprint('shift_ending', times.effectiveEnd),
        };
      }
    }
    return plan;
  }

  /** Adds the job unless an identical one is already queued. */
  private async upsertJob(
    kind: OwnerAlertKind,
    assignmentId: string,
    fingerprint: string,
    runAt: number,
    now: Date,
  ): Promise<boolean> {
    const jobId = ownerAlertJobId(kind, assignmentId);
    const existing = await this.queue.getJob(jobId);
    if (existing?.data?.fingerprint === fingerprint) return false;
    if (existing) {
      // 0 = active/locked; that job re-validates its fingerprint and skips.
      const removed = await this.queue.remove(jobId);
      if (!removed) return false;
    }
    const data: OwnerAlertJobData = { assignmentId, kind, fingerprint };
    await this.queue.add(kind, data, {
      jobId,
      delay: Math.max(0, runAt - now.getTime()),
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: COMPLETED_RETENTION,
      removeOnFail: FAILED_RETENTION,
    });
    return true;
  }

  private async sendOnce(input: {
    ctx: AssignmentContext;
    dedupKey: string;
    title: string;
    content: string;
    metadata: Record<string, unknown>;
    high?: boolean;
  }): Promise<boolean> {
    const { ctx } = input;
    const owner = ctx.ownerAccountId as string;
    const claimed: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO owner_notification_log (dedup_key, store_id, owner_account_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (dedup_key) DO NOTHING
       RETURNING id`,
      [input.dedupKey.slice(0, 200), ctx.storeId, owner],
    );
    if (!claimed?.length) return false;
    try {
      await this.notificationsService.create(
        {
          accountId: owner,
          storeId: ctx.storeId,
          title: input.title,
          content: input.content,
          type: NotificationType.SYSTEM,
          priority: input.high
            ? NotificationPriority.HIGH
            : NotificationPriority.NORMAL,
          actionUrl: OWNER_WORK_SHIFT_ROUTE,
          metadata: {
            ...input.metadata,
            storeId: ctx.storeId,
            assignmentId: ctx.id,
            employeeProfileId: ctx.employeeId,
            ...(ctx.shiftName ? { shiftName: ctx.shiftName } : {}),
          },
        },
        input.high ? { priority: 'high' } : undefined,
      );
    } catch (error) {
      // Release the claim so a retry can send it.
      await this.dataSource
        .query('DELETE FROM owner_notification_log WHERE dedup_key = $1', [
          input.dedupKey.slice(0, 200),
        ])
        .catch(() => undefined);
      throw error;
    }
    return true;
  }

  private async loadContexts(ids: string[]): Promise<AssignmentContext[]> {
    if (!ids.length) return [];
    const rows: any[] = await this.dataSource.query(
      `SELECT sa.id,
              sa.status,
              (sa.check_in_time IS NOT NULL) AS checked_in,
              (sa.check_out_time IS NOT NULL) AS checked_out,
              ss.work_date,
              COALESCE(ss.start_time, ws.start_time) AS start_time,
              COALESCE(ss.end_time, ws.end_time) AS end_time,
              ws.shift_name,
              wc.store_id,
              wc.status AS cycle_status,
              wc.scheduled_stop_at,
              s.owner_account_id,
              ep.id AS employee_id,
              ep.account_id AS employee_account_id,
              acc.full_name AS employee_name,
              sew.effective_end_at
       FROM shift_assignments sa
       JOIN shift_slots ss ON ss.id = sa.shift_slot_id
       JOIN work_shifts ws ON ws.id = ss.work_shift_id
       JOIN work_cycles wc ON wc.id = ss.cycle_id
       JOIN stores s ON s.id = wc.store_id
       JOIN employee_profiles ep ON ep.id = sa.employee_id AND ep.deleted_at IS NULL
       LEFT JOIN accounts acc ON acc.id = ep.account_id
       LEFT JOIN shift_end_workflows sew
         ON sew.shift_assignment_id = sa.id AND sew.deleted_at IS NULL
       WHERE sa.id = ANY($1::uuid[]) AND sa.deleted_at IS NULL`,
      [ids],
    );
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      checkedIn: row.checked_in === true || row.checked_in === 't',
      checkedOut: row.checked_out === true || row.checked_out === 't',
      workDate: row.work_date,
      startTime: row.start_time ?? null,
      endTime: row.end_time ?? null,
      shiftName: row.shift_name ?? null,
      storeId: row.store_id,
      cycleStatus: row.cycle_status,
      scheduledStopAt: row.scheduled_stop_at
        ? new Date(row.scheduled_stop_at)
        : null,
      ownerAccountId: row.owner_account_id ?? null,
      employeeId: row.employee_id,
      employeeAccountId: row.employee_account_id,
      employeeName: row.employee_name ?? null,
      effectiveEndAt: row.effective_end_at
        ? new Date(row.effective_end_at)
        : null,
    }));
  }
}

function toView(
  row: OwnerNotificationSetting | null | undefined,
): OwnerNotificationSettingsView {
  if (!row) return { ...DEFAULT_OWNER_NOTIFICATION_SETTINGS };
  return {
    preShiftEnabled: row.preShiftEnabled,
    preShiftMinutes: Number(row.preShiftMinutes) === 15 ? 15 : 30,
    checkInEnabled: row.checkInEnabled,
    checkOutEnabled: row.checkOutEnabled,
    shiftEndingEnabled: row.shiftEndingEnabled,
    lateEarlyEnabled: row.lateEarlyEnabled,
  };
}

const SETTING_KEYS: Array<keyof OwnerNotificationSettingsView> = [
  'preShiftEnabled',
  'preShiftMinutes',
  'checkInEnabled',
  'checkOutEnabled',
  'shiftEndingEnabled',
  'lateEarlyEnabled',
];

function pickDefined(
  changes: OwnerNotificationSettingsUpdate,
): OwnerNotificationSettingsUpdate {
  const out: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    if (changes?.[key] !== undefined) out[key] = changes[key];
  }
  return out as OwnerNotificationSettingsUpdate;
}

/**
 * Start and effective end in real instants, Vietnam calendar; an end at or
 * before the start is the next day (cross-midnight). Null when incomplete.
 */
function shiftTimes(ctx: AssignmentContext): ShiftTimes | null {
  if (!ctx.workDate || !ctx.startTime) return null;
  try {
    const workDate = toWorkDateString(ctx.workDate);
    const start = parseVietnamShiftStart(workDate, ctx.startTime);
    const { end } = resolveShiftBoundaries(workDate, ctx.startTime, ctx.endTime);
    const effectiveEnd = ctx.effectiveEndAt ?? end;
    if (!effectiveEnd) return null;
    return { start, effectiveEnd, workDate };
  } catch {
    return null;
  }
}

function isCycleLive(ctx: AssignmentContext, now: Date) {
  return (
    ctx.cycleStatus === WorkCycleStatus.ACTIVE &&
    (!ctx.scheduledStopAt || ctx.scheduledStopAt.getTime() > now.getTime())
  );
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
