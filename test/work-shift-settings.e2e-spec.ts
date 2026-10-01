import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AccountsService } from '../src/modules/accounts/accounts.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { MailService } from '../src/modules/mail/mail.service';
import { CareerLadderService } from '../src/modules/stores/career-ladder.service';
import {
  ShiftAssignmentStatus,
  ShiftSlot,
} from '../src/modules/stores/entities/shift-management.entity';
import { Store } from '../src/modules/stores/entities/store.entity';
import { WorkShift } from '../src/modules/stores/entities/work-shift.entity';
import { StoreAccessGuard } from '../src/modules/stores/guards/store-access.guard';
import { StoreOwnerOnlyGuard } from '../src/modules/stores/guards/store-owner-only.guard';
import { StoreResourceAccessGuard } from '../src/modules/stores/guards/store-resource-access.guard';
import { ShiftEndWorkflowService } from '../src/modules/stores/shift-end-workflow.service';
import {
  addDays,
  getTodayDateString,
} from '../src/modules/stores/shift-schedule.utils';
import { StoresController } from '../src/modules/stores/stores.controller';
import { StoresService } from '../src/modules/stores/stores.service';

jest.mock('uuid', () => ({ v4: () => 'test-upload-id' }));

/**
 * HTTP contract of the owner's shift settings: POST/PUT/DELETE
 * /stores/:storeId/work-shifts with the global ValidationPipe, the real
 * owner-only guard (store owners read from an in-memory DataSource) and the
 * real service methods over an in-memory transaction manager.
 */
const STORE = '00000000-0000-4000-8000-000000000001';
const OTHER_STORE = '00000000-0000-4000-8000-000000000002';
const OWNER = 'owner-1';
const SHIFT = '11111111-1111-4111-8111-111111111111';

interface State {
  stores: { id: string; ownerAccountId: string }[];
  shifts: any[];
  slots: any[];
}

describe('Owner shift settings: work-shifts routes (e2e)', () => {
  let app: INestApplication;
  const state: State = { stores: [], shifts: [], slots: [] };
  const reset = () => {
    state.stores = [
      { id: STORE, ownerAccountId: OWNER },
      { id: OTHER_STORE, ownerAccountId: 'owner-2' },
    ];
    state.shifts = [
      {
        id: SHIFT,
        storeId: STORE,
        shiftName: 'Ca sáng',
        startTime: '08:00:00',
        endTime: '12:00:00',
        isActive: true,
        note: null,
      },
    ];
    state.slots = [];
  };

  const matches = (row: any, where: any) =>
    Object.entries(where ?? {}).every(([key, value]) => row[key] === value);

  const manager = {
    query: jest.fn(async () => []),
    findOne: jest.fn(async (entity: unknown, options: any) => {
      if (entity === Store) {
        return (
          state.stores.find((store) => store.id === options.where.id) ?? null
        );
      }
      if (entity === WorkShift) {
        return (
          state.shifts.find((shift) => matches(shift, options.where)) ?? null
        );
      }
      return null;
    }),
    find: jest.fn(async (entity: unknown, options: any) => {
      if (entity === ShiftSlot) {
        return state.slots.filter(
          (slot) =>
            slot.workShiftId === options.where.workShiftId &&
            slot.workDate >= options.where.workDate.value,
        );
      }
      return [];
    }),
    create: jest.fn((_entity: unknown, value: any) => ({
      id: '22222222-2222-4222-8222-222222222222',
      ...value,
    })),
    save: jest.fn(async (entity: unknown, value: any) => {
      if (entity === WorkShift) state.shifts.push(value);
      return value;
    }),
    update: jest.fn(async (entity: unknown, where: any, patch: any) => {
      if (entity === WorkShift) {
        const row = state.shifts.find((shift) => matches(shift, where));
        if (row) Object.assign(row, patch);
      }
      return { affected: 1 };
    }),
    delete: jest.fn(async (entity: unknown, ids: string | string[]) => {
      if (entity === ShiftSlot) {
        const doomed = new Set(Array.isArray(ids) ? ids : [ids]);
        state.slots = state.slots.filter((slot) => !doomed.has(slot.id));
      }
      return { affected: 1 };
    }),
  };

  beforeAll(async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
    service.storeRepository = {
      findOne: jest.fn(
        async ({ where }: any) =>
          state.stores.find((store) => store.id === where.id) ?? null,
      ),
    };
    service.workShiftRepository = {
      findOne: jest.fn(
        async ({ where }: any) =>
          state.shifts.find((shift) => matches(shift, where)) ?? null,
      ),
      find: jest.fn(async ({ where }: any) =>
        state.shifts.filter((shift) => matches(shift, where)),
      ),
      query: jest.fn(async () => []),
    };
    service.dataSource = {
      transaction: jest.fn(async (callback: (m: any) => unknown) =>
        callback(manager),
      ),
    };
    service.shiftReminderService = {
      cancelAssignmentReminders: jest.fn(async () => undefined),
      scheduleAssignmentReminders: jest.fn(async () => undefined),
    };
    service.shiftAssignmentRepository = { find: jest.fn(async () => []) };

    // The real owner-only guard; the store owner comes from the fake rows.
    const guardDataSource = {
      getRepository: () => ({
        find: jest.fn(async ({ where }: any) =>
          state.stores.filter((store) =>
            (where.id.value as string[]).includes(store.id),
          ),
        ),
      }),
    };
    const ownerOnlyGuard = new StoreOwnerOnlyGuard(
      new Reflector(),
      guardDataSource as any,
    );
    const authenticatedGuard: CanActivate = {
      canActivate(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest();
        req.user = { userId: req.headers['x-test-user'] ?? OWNER };
        return true;
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [StoresController],
      providers: [
        { provide: StoresService, useValue: service },
        { provide: AccountsService, useValue: {} },
        { provide: MailService, useValue: {} },
        { provide: ShiftEndWorkflowService, useValue: {} },
        { provide: CareerLadderService, useValue: {} },
        {
          provide: getQueueToken('attendance-background'),
          useValue: { add: jest.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(authenticatedGuard)
      // Membership guards have their own suites; this one exercises the
      // owner-only decision, which is what these routes depend on.
      .overrideGuard(StoreAccessGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(StoreResourceAccessGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(StoreOwnerOnlyGuard)
      .useValue(ownerOnlyGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    reset();
    jest.clearAllMocks();
  });

  const tomorrow = () => addDays(getTodayDateString(), 1);

  it('creates a shift (201) with normalized times', async () => {
    const response = await request(app.getHttpServer())
      .post(`/stores/${STORE}/work-shifts`)
      .send({ shiftName: '  Ca đêm ', startTime: '22:00', endTime: '06:00' })
      .expect(201);

    expect(response.body).toEqual(
      expect.objectContaining({
        storeId: STORE,
        shiftName: 'Ca đêm',
        startTime: '22:00:00',
        endTime: '06:00:00',
        isActive: true,
      }),
    );
  });

  it.each([
    [{ shiftName: 'Ca', startTime: '8h', endTime: '12:00' }],
    [{ shiftName: 'x'.repeat(81), startTime: '08:00', endTime: '12:00' }],
    [{ shiftName: 'Ca', startTime: '08:00', endTime: '08:00' }],
    [
      {
        shiftName: 'Ca',
        startTime: '08:00',
        endTime: '12:00',
        isActive: false,
      },
    ],
  ])('rejects create body %j with 400', async (body) => {
    await request(app.getHttpServer())
      .post(`/stores/${STORE}/work-shifts`)
      .send(body)
      .expect(400);
    expect(state.shifts).toHaveLength(1);
  });

  it('refuses a staff account on create, edit and delete (403)', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post(`/stores/${STORE}/work-shifts`)
      .set('x-test-user', 'staff-1')
      .send({ shiftName: 'Ca', startTime: '08:00', endTime: '12:00' })
      .expect(403);
    await request(server)
      .put(`/stores/${STORE}/work-shifts/${SHIFT}`)
      .set('x-test-user', 'staff-1')
      .send({ shiftName: 'Ca' })
      .expect(403);
    const response = await request(server)
      .delete(`/stores/${STORE}/work-shifts/${SHIFT}`)
      .set('x-test-user', 'staff-1')
      .expect(403);
    expect(response.body.code).toBe('STORE_OWNER_REQUIRED');
    expect(state.shifts[0].isActive).toBe(true);
  });

  it('refuses the owner of another store (403) and 404s a foreign shift', async () => {
    await request(app.getHttpServer())
      .delete(`/stores/${OTHER_STORE}/work-shifts/${SHIFT}`)
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/stores/${OTHER_STORE}/work-shifts/${SHIFT}`)
      .set('x-test-user', 'owner-2')
      .expect(404);
    expect(state.shifts[0].isActive).toBe(true);
  });

  it('400s a malformed shift id on delete', async () => {
    await request(app.getHttpServer())
      .delete(`/stores/${STORE}/work-shifts/not-a-uuid`)
      .expect(400);
  });

  it('edits name and times (200) and rejects isActive in the body (400)', async () => {
    const server = app.getHttpServer();
    const response = await request(server)
      .put(`/stores/${STORE}/work-shifts/${SHIFT}`)
      .send({ shiftName: 'Ca sáng sớm', startTime: '07:00', endTime: '11:30' })
      .expect(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        shiftName: 'Ca sáng sớm',
        startTime: '07:00:00',
        endTime: '11:30:00',
      }),
    );
    await request(server)
      .put(`/stores/${STORE}/work-shifts/${SHIFT}`)
      .send({ isActive: true })
      .expect(400);
  });

  it('409s with code and count while upcoming days are booked', async () => {
    state.slots = [
      {
        id: 'booked',
        workShiftId: SHIFT,
        workDate: tomorrow(),
        startTime: null,
        assignments: [{ id: 'a1', status: ShiftAssignmentStatus.APPROVED }],
      },
    ];

    const response = await request(app.getHttpServer())
      .delete(`/stores/${STORE}/work-shifts/${SHIFT}`)
      .expect(409);

    expect(response.body).toEqual({
      code: 'WORK_SHIFT_HAS_UPCOMING_ASSIGNMENTS',
      count: 1,
      message:
        'Ca còn 1 lịch sắp tới đã có nhân viên, hãy huỷ các lịch đó trước',
    });
    expect(state.shifts[0].isActive).toBe(true);
    expect(state.slots).toHaveLength(1);
  });

  it('hides the shift, removes empty upcoming days and repeats as a no-op', async () => {
    state.slots = [
      {
        id: 'empty',
        workShiftId: SHIFT,
        workDate: tomorrow(),
        startTime: null,
        assignments: [],
      },
    ];
    const server = app.getHttpServer();

    const first = await request(server)
      .delete(`/stores/${STORE}/work-shifts/${SHIFT}`)
      .expect(200);
    expect(first.body).toEqual({
      id: SHIFT,
      deleted: true,
      alreadyDeleted: false,
      removedUpcomingSlots: 1,
    });
    expect(state.shifts[0].isActive).toBe(false);
    expect(state.slots).toHaveLength(0);

    const again = await request(server)
      .delete(`/stores/${STORE}/work-shifts/${SHIFT}`)
      .expect(200);
    expect(again.body).toEqual(
      expect.objectContaining({ deleted: true, alreadyDeleted: true }),
    );

    // Hidden from the list, and no longer editable.
    const list = await request(server)
      .get(`/stores/${STORE}/work-shifts`)
      .expect(200);
    expect(list.body).toEqual([]);
    await request(server)
      .put(`/stores/${STORE}/work-shifts/${SHIFT}`)
      .send({ shiftName: 'Hồi sinh' })
      .expect(404);
  });
});
