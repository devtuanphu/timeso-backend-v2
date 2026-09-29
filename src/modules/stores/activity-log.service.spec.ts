import { BadRequestException, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  ActivityLogService,
  decodeActivityCursor,
  encodeActivityCursor,
} from './activity-log.service';

type Row = {
  id: string;
  store_id: string;
  actor_account_id: string | null;
  actor_role: 'owner' | 'staff' | 'system';
  subject_employee_profile_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  params: Record<string, unknown>;
  occurred_at_text: string;
};

const NAMES: Record<string, string> = {
  'owner-1': 'Chủ A',
  'staff-1': 'Nguyễn A',
  'staff-2': 'Trần B',
};
const PROFILE_ACCOUNT: Record<string, string> = {
  'emp-1': 'staff-1',
  'emp-2': 'staff-2',
};

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * A tiny stand-in for Postgres that evaluates the feed query the service
 * builds (store, subject/actor visibility, filters, keyset cursor, limit), so
 * visibility and pagination are tested by outcome rather than by SQL text.
 */
function fakeDataSource(rows: Row[], profiles: Array<{ id: string }> = []) {
  const query = jest.fn(async (sql: string, values: any[]) => {
    if (sql.includes('FROM employee_profiles')) return profiles;
    if (!sql.includes('FROM activity_logs l')) return [];
    let result = rows.filter((row) => row.store_id === values[0]);
    let next = 1;
    if (sql.includes('= ANY($2::uuid[])')) {
      const subjects: string[] = values[1];
      const actor: string = values[2];
      result = result.filter(
        (row) =>
          (row.subject_employee_profile_id &&
            subjects.includes(row.subject_employee_profile_id)) ||
          row.actor_account_id === actor,
      );
      next = 3;
    }
    if (sql.includes('l.subject_employee_profile_id = $')) {
      const id = values[next++];
      result = result.filter((row) => row.subject_employee_profile_id === id);
    }
    if (sql.includes('l.action = $')) {
      const action = values[next++];
      result = result.filter((row) => row.action === action);
    }
    if (sql.includes('l.occurred_at >= (')) next++;
    if (sql.includes('l.occurred_at < ((')) next++;
    result.sort((a, b) =>
      a.occurred_at_text === b.occurred_at_text
        ? b.id.localeCompare(a.id)
        : b.occurred_at_text.localeCompare(a.occurred_at_text),
    );
    if (sql.includes('(l.occurred_at, l.id) <')) {
      const ts = values[next++];
      const id = values[next++];
      result = result.filter(
        (row) =>
          row.occurred_at_text < ts ||
          (row.occurred_at_text === ts && row.id < id),
      );
    }
    const limit = values[values.length - 1];
    return result.slice(0, limit).map((row) => ({
      ...row,
      actor_name: row.actor_account_id ? NAMES[row.actor_account_id] ?? null : null,
      subject_name: row.subject_employee_profile_id
        ? NAMES[PROFILE_ACCOUNT[row.subject_employee_profile_id]] ?? null
        : null,
    }));
  });
  return { query, manager: { query } } as any;
}

const row = (n: number, partial: Partial<Row>): Row => ({
  id: uuid(n),
  store_id: 'store-1',
  actor_account_id: null,
  actor_role: 'staff',
  subject_employee_profile_id: null,
  action: 'attendance.check_in',
  resource_type: 'shift_assignment',
  resource_id: null,
  params: {},
  occurred_at_text: `2026-09-21T01:${String(n).padStart(2, '0')}:00.000000Z`,
  ...partial,
});

const ROWS: Row[] = [
  // staff-1 checks in (own action, own subject)
  row(1, {
    actor_account_id: 'staff-1',
    subject_employee_profile_id: 'emp-1',
    params: { shiftName: 'Sáng', startTime: '08:00', endTime: '12:00', lateMinutes: 5 },
  }),
  // owner approves staff-1's leave (subject = staff-1)
  row(2, {
    actor_account_id: 'owner-1',
    actor_role: 'owner',
    subject_employee_profile_id: 'emp-1',
    action: 'leave_request.approved',
    params: { leaveType: 'SICK', fromDate: '2026-09-22', toDate: '2026-09-22' },
  }),
  // coworker staff-2 checks in
  row(3, { actor_account_id: 'staff-2', subject_employee_profile_id: 'emp-2' }),
  // owner approves staff-2's registration
  row(4, {
    actor_account_id: 'owner-1',
    actor_role: 'owner',
    subject_employee_profile_id: 'emp-2',
    action: 'shift_registration.approved',
  }),
  // another store
  row(5, { store_id: 'store-2', actor_account_id: 'staff-1', subject_employee_profile_id: 'emp-x' }),
];

describe('ActivityLogService.record', () => {
  it('inside a transaction: SAVEPOINT + idempotent INSERT on the same manager', async () => {
    const dataSource = { manager: { query: jest.fn() } } as any;
    const service = new ActivityLogService(dataSource);
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      queryRunner: { isTransactionActive: true },
    } as any;

    await service.record(manager, {
      actorAccountId: 'staff-1',
      subjectEmployeeProfileId: 'emp-1',
      action: 'attendance.check_in',
      resourceType: 'shift_assignment',
      resourceId: uuid(9),
      params: { lateMinutes: 5, checkinLatitude: 10.1, amount: 5000 },
      idempotencyKey: 'attendance.check_in:x',
    });

    const sqls = manager.query.mock.calls.map((call: any[]) => call[0]);
    expect(sqls[0]).toBe('SAVEPOINT activity_log_record');
    expect(sqls[1]).toContain('INSERT INTO activity_logs');
    expect(sqls[1]).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
    expect(sqls[2]).toBe('RELEASE SAVEPOINT activity_log_record');
    expect(dataSource.manager.query).not.toHaveBeenCalled();
    const values = manager.query.mock.calls[1][1];
    expect(values[8]).toBe('attendance.check_in:x');
    // Only allow-listed params are stored.
    expect(JSON.parse(values[7])).toEqual({ lateMinutes: 5 });
  });

  it('a failing insert inside a transaction rolls back to the savepoint and never throws', async () => {
    const service = new ActivityLogService({ manager: { query: jest.fn() } } as any);
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.startsWith('INSERT')) throw new Error('boom');
        return [];
      }),
      queryRunner: { isTransactionActive: true },
    } as any;

    await expect(
      service.record(manager, {
        storeId: 'store-1',
        actorAccountId: null,
        action: 'employee.removed',
        resourceType: 'employee',
      }),
    ).resolves.toBeUndefined();
    expect(manager.query.mock.calls.map((call: any[]) => call[0])).toContain(
      'ROLLBACK TO SAVEPOINT activity_log_record',
    );
  });

  it('without a transaction: writes on its own connection, no savepoint, never throws', async () => {
    const query = jest.fn().mockRejectedValue(new Error('down'));
    const service = new ActivityLogService({ manager: { query } } as any);

    await expect(
      service.record(null, {
        storeId: 'store-1',
        actorAccountId: 'owner-1',
        action: 'payslip.paid',
        resourceType: 'payslip',
      }),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('INSERT INTO activity_logs');
  });

  it('skips an entry that names neither a store nor a subject', async () => {
    const query = jest.fn();
    const service = new ActivityLogService({ manager: { query } } as any);
    await service.record(null, {
      actorAccountId: 'x',
      action: 'payslip.paid',
      resourceType: 'payslip',
    });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('ActivityLogService feeds', () => {
  it('staff sees own actions and entries about themself, never a coworker’s', async () => {
    const service = new ActivityLogService(
      fakeDataSource(ROWS, [{ id: 'emp-1' }]),
    );
    const page = await service.listForStaff('store-1', 'staff-1', {});
    expect(page.items.map((item) => item.id)).toEqual([uuid(2), uuid(1)]);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toMatchObject({
      action: 'leave_request.approved',
      actorRole: 'owner',
      actorName: 'Chủ A',
      subjectEmployeeProfileId: 'emp-1',
      subjectName: 'Nguyễn A',
      summary: 'Chủ A duyệt đơn xin nghỉ ngày 22/09 của Nguyễn A',
    });
    expect(page.items[1].summary).toBe(
      'Nguyễn A check-in ca Sáng (08:00–12:00), trễ 5 phút',
    );
    expect(page.items[1].occurredAt).toBe('2026-09-21T01:01:00.000Z');
  });

  it('a coworker cannot see another employee’s entries', async () => {
    const service = new ActivityLogService(
      fakeDataSource(ROWS, [{ id: 'emp-2' }]),
    );
    const page = await service.listForStaff('store-1', 'staff-2', {});
    const subjects = page.items.map((item) => item.subjectEmployeeProfileId);
    expect(subjects).not.toContain('emp-1');
    expect(page.items.map((item) => item.id)).toEqual([uuid(4), uuid(3)]);
  });

  it('staff without an employed profile at the store: 404', async () => {
    const service = new ActivityLogService(fakeDataSource(ROWS, []));
    await expect(
      service.listForStaff('store-1', 'staff-9', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('owner sees the whole store (and only that store)', async () => {
    const service = new ActivityLogService(fakeDataSource(ROWS));
    const page = await service.listForOwner('store-1', {});
    expect(page.items.map((item) => item.id)).toEqual([
      uuid(4),
      uuid(3),
      uuid(2),
      uuid(1),
    ]);
  });

  it('owner filters by employee and action', async () => {
    const service = new ActivityLogService(fakeDataSource(ROWS));
    const byEmployee = await service.listForOwner('store-1', {
      employeeProfileId: 'emp-2',
    });
    expect(byEmployee.items.map((item) => item.id)).toEqual([uuid(4), uuid(3)]);
    const byAction = await service.listForOwner('store-1', {
      action: 'leave_request.approved',
    });
    expect(byAction.items.map((item) => item.id)).toEqual([uuid(2)]);
  });

  it('keyset pagination walks every row once, newest first', async () => {
    const service = new ActivityLogService(fakeDataSource(ROWS));
    const first = await service.listForOwner('store-1', { limit: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    const second = await service.listForOwner('store-1', {
      limit: 3,
      cursor: first.nextCursor as string,
    });
    expect(second.items.map((item) => item.id)).toEqual([uuid(1)]);
    expect(second.nextCursor).toBeNull();
  });

  it('limit is capped at 50', async () => {
    const dataSource = fakeDataSource(ROWS);
    const service = new ActivityLogService(dataSource);
    await service.listForOwner('store-1', { limit: 500 });
    const values = dataSource.query.mock.calls[0][1];
    expect(values[values.length - 1]).toBe(51);
  });

  it('a malformed cursor is a 400, a valid one round-trips with microseconds', () => {
    expect(() => decodeActivityCursor('not-a-cursor')).toThrow(
      BadRequestException,
    );
    const cursor = { ts: '2026-09-21T01:02:03.123456Z', id: uuid(1) };
    expect(decodeActivityCursor(encodeActivityCursor(cursor))).toEqual(cursor);
  });
});

describe('activity_logs schema', () => {
  it('has no foreign key to stores (log inserts must not lock the store row)', () => {
    const sql = readFileSync(
      join(process.cwd(), 'scripts', 'migration_activity_logs.sql'),
      'utf8',
    );
    const createTable = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS activity_logs'),
      sql.indexOf(');', sql.indexOf('CREATE TABLE IF NOT EXISTS activity_logs')),
    );
    expect(createTable).not.toMatch(/REFERENCES/i);
    // Earlier deployments: the FK is dropped.
    expect(sql).toContain("confrelid = to_regclass('stores')");
    expect(sql).toContain('DROP CONSTRAINT');
  });
});
