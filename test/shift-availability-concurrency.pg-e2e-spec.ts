import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { EmployeeTerminationReason } from '../src/modules/stores/entities/employee-termination-reason.entity';
import { EmployeeProfile } from '../src/modules/stores/entities/employee-profile.entity';
import { Store } from '../src/modules/stores/entities/store.entity';
import {
  ShiftAssignment,
  ShiftSlot,
  WorkCycle,
} from '../src/modules/stores/entities/shift-management.entity';
import { WorkShift } from '../src/modules/stores/entities/work-shift.entity';
import {
  ShiftRecurrenceEndType,
  ShiftRecurrenceFrequency,
} from '../src/modules/stores/shift-schedule.types';
import {
  addDays,
  getTodayDateString,
} from '../src/modules/stores/shift-schedule.utils';
import { StoresService } from '../src/modules/stores/stores.service';

const connectionString = process.env.TIMESO_TEST_DATABASE_URL;
const isExplicitTestDatabase = (() => {
  if (!connectionString) return false;
  try {
    return /(^|[_-])(test|testing|ci)([_-]|$)/i.test(
      new URL(connectionString).pathname.slice(1),
    );
  } catch {
    return false;
  }
})();
const describeWithTestDatabase = isExplicitTestDatabase
  ? describe
  : describe.skip;

class PgServiceHarness {
  readonly pids: number[] = [];
  private hold?: { acquired: () => void; wait: Promise<void> };
  private transactionWaiters: Array<{ count: number; resolve: () => void }> =
    [];

  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
  ) {}

  holdNextLock() {
    let acquired!: () => void;
    let release!: () => void;
    const acquiredPromise = new Promise<void>(
      (resolve) => (acquired = resolve),
    );
    const wait = new Promise<void>((resolve) => (release = resolve));
    this.hold = { acquired, wait };
    return { acquired: acquiredPromise, release };
  }

  waitForTransactions(count: number) {
    if (this.pids.length >= count) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.transactionWaiters.push({ count, resolve });
    });
  }

  createService() {
    const service = Object.create(StoresService.prototype) as StoresService;
    (service as any).dataSource = {
      transaction: async <T>(callback: (manager: any) => Promise<T>) => {
        const client = await this.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`SET LOCAL search_path TO "${this.schema}"`);
          this.pids.push(
            Number(
              (await client.query('SELECT pg_backend_pid() pid')).rows[0].pid,
            ),
          );
          this.transactionWaiters = this.transactionWaiters.filter((waiter) => {
            if (this.pids.length < waiter.count) return true;
            waiter.resolve();
            return false;
          });
          const result = await callback(this.manager(client));
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
    };
    (service as any).profileRepository = {
      findOne: async ({ where }: any) =>
        (
          await this.pool.query(
            `SELECT id, store_id "storeId", employment_status "employmentStatus"
             FROM "${this.schema}".employee_profiles
            WHERE id=$1 AND deleted_at IS NULL`,
            [where.id],
          )
        ).rows[0] || null,
    };
    (service as any).storeRepository = {
      findOne: async ({ where }: any) =>
        (
          await this.pool.query(
            `SELECT id, owner_account_id "ownerAccountId"
             FROM "${this.schema}".stores WHERE id=$1`,
            [where.id],
          )
        ).rows[0] || null,
    };
    (service as any).terminationReasonRepository = {
      findOne: async ({ where }: any) =>
        (
          await this.pool.query(
            `SELECT id, store_id "storeId"
               FROM "${this.schema}".employee_termination_reasons
              WHERE id=$1 AND store_id=$2`,
            [where.id, where.storeId],
          )
        ).rows[0] || null,
    };
    (service as any).scheduleReminderForAssignment = jest.fn(
      async () => undefined,
    );
    (service as any).shiftReminderService = {
      scheduleAssignmentReminders: jest.fn(async () => undefined),
    };
    // Keep the test focused on the authoritative writer transaction. The real
    // service still executes its post-lock employee/status reread below.
    (service as any).getShiftEmployeeOptions = jest.fn(async () => ({
      employees: [
        {
          id: 'employee-1',
          name: 'E2E employee',
          statusLabel: 'Rảnh',
          selectable: true,
        },
      ],
    }));
    return service;
  }

  private manager(client: PoolClient) {
    const query = async (sql: string, parameters?: unknown[]) => {
      const rows = (await client.query(sql, parameters)).rows;
      if (sql.includes('pg_advisory_xact_lock') && this.hold) {
        const hold = this.hold;
        this.hold = undefined;
        hold.acquired();
        await hold.wait;
      }
      return rows;
    };
    return {
      query,
      findOne: async (entity: unknown, { where }: any) => {
        if (entity === Store)
          return (
            (
              await client.query(
                'SELECT id, owner_account_id "ownerAccountId" FROM stores WHERE id=$1',
                [where.id],
              )
            ).rows[0] || null
          );
        if (entity === EmployeeProfile)
          return (
            (
              await client.query(
                `SELECT id, store_id "storeId", employment_status "employmentStatus"
             FROM employee_profiles WHERE id=$1 AND deleted_at IS NULL`,
                [where.id],
              )
            ).rows[0] || null
          );
        if (entity === EmployeeTerminationReason)
          return (
            (
              await client.query(
                `SELECT id, store_id "storeId" FROM employee_termination_reasons
            WHERE id=$1 AND store_id=$2`,
                [where.id, where.storeId],
              )
            ).rows[0] || null
          );
        return null;
      },
      find: async (entity: unknown, { where }: any) => {
        if (entity === WorkShift)
          return (
            await client.query(
              `SELECT id, shift_name "shiftName", is_active "isActive"
             FROM work_shifts WHERE store_id=$1 AND ($2::boolean IS NULL OR is_active=$2)`,
              [where.storeId, where.isActive ?? null],
            )
          ).rows;
        if (entity === EmployeeProfile) {
          const ids: string[] = where.id?._value || where.id?.value || [];
          return (
            await client.query(
              `SELECT id, store_id "storeId", employment_status "employmentStatus"
               FROM employee_profiles WHERE id=ANY($1::text[]) AND store_id=$2
                AND employment_status=$3 AND deleted_at IS NULL`,
              [ids, where.storeId, where.employmentStatus],
            )
          ).rows;
        }
        return [];
      },
      createQueryBuilder: () => {
        const builder: any = {
          leftJoinAndSelect: jest.fn(() => builder),
          where: jest.fn(() => builder),
          andWhere: jest.fn(() => builder),
          take: jest.fn(() => builder),
          getMany: jest.fn(async () => []),
        };
        return builder;
      },
      create: (_entity: unknown, data: any) => ({ id: randomUUID(), ...data }),
      save: async (entity: unknown, value: any) => {
        for (const row of Array.isArray(value) ? value : [value]) {
          if (entity === EmployeeProfile)
            await client.query(
              `UPDATE employee_profiles SET employment_status=$2,
              termination_reason_id=$3,left_at=$4 WHERE id=$1`,
              [
                row.id,
                row.employmentStatus,
                row.terminationReasonId,
                row.leftAt,
              ],
            );
          if (entity === WorkShift)
            await client.query(
              `INSERT INTO work_shifts(id,store_id,shift_name,start_time,end_time,
              default_max_staff,color_code,note,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [
                row.id,
                row.storeId,
                row.shiftName,
                row.startTime,
                row.endTime,
                row.defaultMaxStaff,
                row.colorCode,
                row.note,
                row.isActive,
              ],
            );
          if (entity === WorkCycle)
            await client.query(
              `INSERT INTO work_cycles(id,store_id,name,cycle_type,start_date,end_date,
              work_shift_id,recurrence_rule,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [
                row.id,
                row.storeId,
                row.name,
                row.cycleType,
                row.startDate,
                row.endDate,
                row.workShiftId,
                row.recurrenceRule,
                row.status,
              ],
            );
          if (entity === ShiftSlot)
            await client.query(
              `INSERT INTO shift_slots(id,cycle_id,work_shift_id,work_date,start_time,end_time,
              max_staff,note,day_of_week) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [
                row.id,
                row.cycleId,
                row.workShiftId,
                row.workDate,
                row.startTime,
                row.endTime,
                row.maxStaff,
                row.note,
                row.dayOfWeek,
              ],
            );
          if (entity === ShiftAssignment)
            await client.query(
              `INSERT INTO shift_assignments(id,shift_slot_id,employee_id,status,note)
              VALUES($1,$2,$3,$4,$5)`,
              [row.id, row.shiftSlotId, row.employeeId, row.status, row.note],
            );
        }
        return value;
      },
      update: async (entity: unknown, criteria: any, patch: any) => {
        if (entity === WorkCycle)
          await client.query(
            'UPDATE work_cycles SET work_shift_id=$2 WHERE id=$1',
            [
              typeof criteria === 'string' ? criteria : criteria.id,
              patch.workShiftId,
            ],
          );
        return { affected: 1 };
      },
      softDelete: async (entity: unknown, criteria: any) => {
        if (entity !== EmployeeProfile) return { affected: 0 };
        const result = await client.query(
          'UPDATE employee_profiles SET deleted_at=now() WHERE id=$1 AND store_id=$2',
          [criteria.id, criteria.storeId],
        );
        return { affected: result.rowCount };
      },
    };
  }
}

describeWithTestDatabase(
  'shift availability service writers (PostgreSQL e2e)',
  () => {
    let pool: Pool;
    let schema: string;
    let harness: PgServiceHarness;
    let service: StoresService;

    beforeAll(async () => {
      pool = new Pool({ connectionString, max: 6 });
      schema = `timeso_shift_e2e_${randomUUID().replace(/-/g, '')}`;
      await pool.query(`CREATE SCHEMA "${schema}"`);
      await pool.query(`
      CREATE TABLE "${schema}".stores(id text PRIMARY KEY,owner_account_id text NOT NULL);
      CREATE TABLE "${schema}".employee_termination_reasons(id text PRIMARY KEY,store_id text NOT NULL);
      CREATE TABLE "${schema}".employee_profiles(id text PRIMARY KEY,store_id text NOT NULL,
        employment_status text NOT NULL,termination_reason_id text,left_at timestamptz,deleted_at timestamptz);
      CREATE TABLE "${schema}".work_shifts(id text PRIMARY KEY,store_id text NOT NULL,shift_name text NOT NULL,
        start_time time NOT NULL,end_time time NOT NULL,default_max_staff int,color_code text,note text,is_active boolean NOT NULL);
      CREATE TABLE "${schema}".work_cycles(id text PRIMARY KEY,store_id text NOT NULL,name text NOT NULL,
        cycle_type text NOT NULL,start_date date NOT NULL,end_date date,work_shift_id text,recurrence_rule jsonb,status text NOT NULL);
      CREATE TABLE "${schema}".shift_slots(id text PRIMARY KEY,cycle_id text NOT NULL,work_shift_id text NOT NULL,
        work_date date NOT NULL,start_time time,end_time time,max_staff int,note text,day_of_week text);
      CREATE TABLE "${schema}".shift_assignments(id text PRIMARY KEY,shift_slot_id text NOT NULL,
        employee_id text NOT NULL,status text NOT NULL,note text);
    `);
      harness = new PgServiceHarness(pool, schema);
    });

    beforeEach(async () => {
      await pool.query(`TRUNCATE "${schema}".shift_assignments,"${schema}".shift_slots,
      "${schema}".work_cycles,"${schema}".work_shifts,"${schema}".employee_profiles,
      "${schema}".employee_termination_reasons,"${schema}".stores`);
      await pool.query(`INSERT INTO "${schema}".stores VALUES('store-1','owner-1');
      INSERT INTO "${schema}".employee_termination_reasons VALUES('reason-1','store-1');
      INSERT INTO "${schema}".employee_profiles(id,store_id,employment_status)
        VALUES('employee-1','store-1','active')`);
      harness.pids.length = 0;
      service = harness.createService();
    });

    afterAll(async () => {
      if (pool && schema) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool?.end();
    });

    const schedulePayload = (name: string, employee = true) => ({
      startDate: addDays(getTodayDateString(), 1),
      recurrence: {
        enabled: false,
        frequency: ShiftRecurrenceFrequency.DAILY,
        interval: 1,
        endType: ShiftRecurrenceEndType.COUNT,
        occurrenceCount: 1,
      },
      shifts: [
        {
          shiftName: name,
          startTime: '07:00',
          endTime: '11:00',
          maxStaff: 1,
          employeeIds: employee ? ['employee-1'] : [],
        },
      ],
    });

    it('linearizes termination before schedule and leaves no partial schedule rows', async () => {
      const hold = harness.holdNextLock();
      const termination = service.deleteEmployee(
        'employee-1',
        'reason-1',
        'owner-1',
      );
      await hold.acquired;
      const schedule = service.createShiftSchedule(
        'store-1',
        'owner-1',
        schedulePayload('Ca sau thôi việc') as any,
      );
      await harness.waitForTransactions(2);
      hold.release();
      await termination;
      await expect(schedule).rejects.toBeInstanceOf(BadRequestException);
      const counts = (
        await pool.query(`SELECT
      (SELECT count(*) FROM "${schema}".work_shifts) shifts,
      (SELECT count(*) FROM "${schema}".work_cycles) cycles,
      (SELECT count(*) FROM "${schema}".shift_slots) slots`)
      ).rows[0];
      expect(counts).toEqual({ shifts: '0', cycles: '0', slots: '0' });
      expect(new Set(harness.pids).size).toBeGreaterThan(1);
    });

    it('linearizes schedule before termination and preserves post-schedule termination semantics', async () => {
      const hold = harness.holdNextLock();
      const schedule = service.createShiftSchedule(
        'store-1',
        'owner-1',
        schedulePayload('Ca trước thôi việc') as any,
      );
      await hold.acquired;
      const termination = service.deleteEmployee(
        'employee-1',
        'reason-1',
        'owner-1',
      );
      await harness.waitForTransactions(2);
      hold.release();
      await expect(schedule).resolves.toEqual(
        expect.objectContaining({ generatedAssignmentCount: 1 }),
      );
      await termination;
      expect(
        (
          await pool.query(
            `SELECT count(*) count FROM "${schema}".shift_assignments`,
          )
        ).rows[0].count,
      ).toBe('1');
      expect(new Set(harness.pids).size).toBeGreaterThan(1);
    });

    it.each([
      ['legacy first', true],
      ['batch first', false],
    ])(
      'serializes normalized active-name conflicts with %s',
      async (_label, legacyFirst) => {
        const hold = harness.holdNextLock();
        const legacy = () =>
          service.createWorkShift(
            'store-1',
            { shiftName: 'Ca Trùng', startTime: '07:00', endTime: '11:00' },
            'owner-1',
          );
        const batch = () =>
          service.createShiftSchedule(
            'store-1',
            'owner-1',
            schedulePayload('  ca   trùng ', false) as any,
          );
        const first = legacyFirst ? legacy() : batch();
        await hold.acquired;
        const second = legacyFirst ? batch() : legacy();
        await harness.waitForTransactions(2);
        hold.release();
        await expect(first).resolves.toBeDefined();
        await expect(second).rejects.toBeInstanceOf(BadRequestException);
        expect(
          (
            await pool.query(
              `SELECT count(*) count FROM "${schema}".work_shifts`,
            )
          ).rows[0].count,
        ).toBe('1');
        expect(new Set(harness.pids).size).toBeGreaterThan(1);
      },
    );
  },
);
