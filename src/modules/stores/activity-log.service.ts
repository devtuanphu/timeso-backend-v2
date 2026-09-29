import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import {
  ActivityResourceType,
  renderActivitySummary,
  sanitizeActivityParams,
} from './activity-log.summary';
import { ActivityActorRole } from './entities/activity-log.entity';
import { EMPLOYED_STATUSES } from './entities/employee-profile.entity';

export interface ActivityLogEntry {
  /** Store of the action; resolved from the subject profile when omitted. */
  storeId?: string | null;
  /** Account that acted; null for the system. */
  actorAccountId: string | null;
  /** Derived from the store owner when omitted (owner / staff / system). */
  actorRole?: ActivityActorRole;
  subjectEmployeeProfileId?: string | null;
  action: string;
  resourceType: ActivityResourceType;
  resourceId?: string | null;
  /** Filtered through sanitizeActivityParams before it is stored. */
  params?: Record<string, unknown>;
  /** `${action}:${resourceId}[:${transition}]`; null when not deduplicable. */
  idempotencyKey?: string | null;
}

export interface ActivityLogItem {
  id: string;
  action: string;
  actorRole: ActivityActorRole;
  actorName: string | null;
  subjectEmployeeProfileId: string | null;
  subjectName: string | null;
  resourceType: string;
  resourceId: string | null;
  params: Record<string, unknown>;
  summary: string;
  occurredAt: string;
}

export interface ActivityLogPage {
  items: ActivityLogItem[];
  nextCursor: string | null;
}

export interface ActivityLogQuery {
  cursor?: string;
  limit?: number;
  employeeProfileId?: string;
  action?: string;
  /** VN calendar dates, inclusive. */
  from?: string;
  to?: string;
}

export const ACTIVITY_LOG_DEFAULT_LIMIT = 20;
export const ACTIVITY_LOG_MAX_LIMIT = 50;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

type Cursor = { ts: string; id: string };

export const encodeActivityCursor = (cursor: Cursor): string =>
  Buffer.from(`${cursor.ts}|${cursor.id}`, 'utf8').toString('base64url');

export const decodeActivityCursor = (value?: string): Cursor | null => {
  if (!value) return null;
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  const [ts, id] = decoded.split('|');
  if (!ts || !id || !CURSOR_TS.test(ts) || !UUID.test(id)) {
    throw new BadRequestException({
      code: 'INVALID_CURSOR',
      message: 'Con trỏ phân trang không hợp lệ.',
    });
  }
  return { ts, id };
};

const clampLimit = (limit?: number) => {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return ACTIVITY_LOG_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), ACTIVITY_LOG_MAX_LIMIT);
};

/**
 * Writes and reads the store activity log (X1 "Lịch sử thao tác").
 *
 * `record` is called from the business services at the point a state change
 * is made. With a transaction manager it writes inside that transaction (so a
 * rolled-back change leaves no phantom entry and a committed one is never
 * lost), guarded by a SAVEPOINT so a failed log write can never abort the
 * business transaction. Without one it writes on its own connection after the
 * change. It never throws into the caller.
 */
@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);

  constructor(private readonly dataSource: DataSource) {}

  async record(
    manager: EntityManager | null | undefined,
    entry: ActivityLogEntry,
  ): Promise<void> {
    const inTransaction = Boolean(
      manager?.queryRunner?.isTransactionActive,
    );
    const runner: Pick<EntityManager, 'query'> =
      manager ?? this.dataSource.manager;
    let savepoint = false;
    try {
      if (!entry.storeId && !entry.subjectEmployeeProfileId) return;
      const params = sanitizeActivityParams(entry.params);
      if (inTransaction) {
        await runner.query('SAVEPOINT activity_log_record');
        savepoint = true;
      }
      await runner.query(
        `INSERT INTO activity_logs (
           store_id, actor_account_id, actor_role, subject_employee_profile_id,
           action, resource_type, resource_id, params, idempotency_key
         )
         SELECT s.id,
                $2::uuid,
                COALESCE(
                  $3::varchar,
                  CASE
                    WHEN $2::uuid IS NULL THEN 'system'
                    WHEN s.owner_account_id = $2::uuid THEN 'owner'
                    ELSE 'staff'
                  END
                ),
                $4::uuid, $5, $6, $7::uuid, $8::jsonb, $9
         FROM stores s
         WHERE s.id = COALESCE(
           $1::uuid,
           (SELECT ep.store_id FROM employee_profiles ep WHERE ep.id = $4::uuid)
         )
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          entry.storeId ?? null,
          entry.actorAccountId ?? null,
          entry.actorRole ?? null,
          entry.subjectEmployeeProfileId ?? null,
          entry.action,
          entry.resourceType,
          entry.resourceId ?? null,
          JSON.stringify(params),
          entry.idempotencyKey ? entry.idempotencyKey.slice(0, 200) : null,
        ],
      );
      if (savepoint) {
        await runner.query('RELEASE SAVEPOINT activity_log_record');
      }
    } catch (error) {
      if (savepoint) {
        try {
          await runner.query('ROLLBACK TO SAVEPOINT activity_log_record');
        } catch {
          // The transaction is already unusable; the caller's own write will
          // surface that. Nothing more to do here.
        }
      }
      // Action code only: the entry may name people.
      this.logger.warn(
        `Activity log write failed [action=${entry.action}]: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Staff feed: entries about the caller's own employed profile at this store
   * (whoever acted, e.g. the owner approving their leave) plus the caller's
   * own actions in this store. Never another coworker's entries.
   */
  async listForStaff(
    storeId: string,
    accountId: string,
    query: Pick<ActivityLogQuery, 'cursor' | 'limit'>,
  ): Promise<ActivityLogPage> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM employee_profiles
       WHERE store_id = $1 AND account_id = $2 AND deleted_at IS NULL
         AND employment_status::text = ANY($3::text[])`,
      [storeId, accountId, [...EMPLOYED_STATUSES]],
    );
    if (!rows.length) {
      throw new NotFoundException('Không tìm thấy nhân viên');
    }
    return this.page(
      {
        where: [
          'l.store_id = $1',
          '(l.subject_employee_profile_id = ANY($2::uuid[]) OR l.actor_account_id = $3::uuid)',
        ],
        values: [storeId, rows.map((row) => row.id), accountId],
      },
      query,
    );
  }

  /** Owner feed: the whole store, optionally filtered. */
  async listForOwner(
    storeId: string,
    query: ActivityLogQuery,
  ): Promise<ActivityLogPage> {
    const where = ['l.store_id = $1'];
    const values: unknown[] = [storeId];
    if (query.employeeProfileId) {
      values.push(query.employeeProfileId);
      where.push(`l.subject_employee_profile_id = $${values.length}::uuid`);
    }
    if (query.action) {
      values.push(query.action);
      where.push(`l.action = $${values.length}`);
    }
    if (query.from) {
      values.push(query.from);
      where.push(
        `l.occurred_at >= ($${values.length}::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`,
      );
    }
    if (query.to) {
      values.push(query.to);
      where.push(
        `l.occurred_at < (($${values.length}::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`,
      );
    }
    return this.page({ where, values }, query);
  }

  private async page(
    filter: { where: string[]; values: unknown[] },
    query: Pick<ActivityLogQuery, 'cursor' | 'limit'>,
  ): Promise<ActivityLogPage> {
    const limit = clampLimit(query.limit);
    const cursor = decodeActivityCursor(query.cursor);
    const where = [...filter.where];
    const values = [...filter.values];
    if (cursor) {
      values.push(cursor.ts, cursor.id);
      where.push(
        `(l.occurred_at, l.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`,
      );
    }
    values.push(limit + 1);
    const rows: Array<{
      id: string;
      action: string;
      actor_role: ActivityActorRole;
      actor_name: string | null;
      subject_employee_profile_id: string | null;
      subject_name: string | null;
      resource_type: string;
      resource_id: string | null;
      params: Record<string, unknown> | null;
      occurred_at_text: string;
    }> = await this.dataSource.query(
      `SELECT l.id, l.action, l.actor_role,
              actor.full_name AS actor_name,
              l.subject_employee_profile_id,
              subject.full_name AS subject_name,
              l.resource_type, l.resource_id, l.params,
              to_char(l.occurred_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at_text
       FROM activity_logs l
       LEFT JOIN accounts actor ON actor.id = l.actor_account_id
       LEFT JOIN employee_profiles ep ON ep.id = l.subject_employee_profile_id
       LEFT JOIN accounts subject ON subject.id = ep.account_id
       WHERE ${where.join(' AND ')}
       ORDER BY l.occurred_at DESC, l.id DESC
       LIMIT $${values.length}`,
      values,
    );
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map((row) => {
      const params = row.params ?? {};
      return {
        id: row.id,
        action: row.action,
        actorRole: row.actor_role,
        actorName: row.actor_name ?? null,
        subjectEmployeeProfileId: row.subject_employee_profile_id ?? null,
        subjectName: row.subject_name ?? null,
        resourceType: row.resource_type,
        resourceId: row.resource_id ?? null,
        params,
        summary: renderActivitySummary({
          action: row.action,
          actorRole: row.actor_role,
          actorName: row.actor_name,
          subjectName: row.subject_name,
          params,
        }),
        // Millisecond ISO for clients; the cursor keeps microseconds.
        occurredAt: new Date(row.occurred_at_text).toISOString(),
      };
    });
    const last = pageRows[pageRows.length - 1];
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeActivityCursor({ ts: last.occurred_at_text, id: last.id })
          : null,
    };
  }
}
