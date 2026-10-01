/**
 * X5 "Khung giờ khác": staff custom-time shift requests, owner approval
 * creates the shift for exactly that employee through the unified
 * shift-schedule path.
 */
jest.mock('../../common/utils/multer-config', () => ({
  attendanceMulterConfig: {},
  multerConfig: {},
  mixedIdentityMulterConfig: () => ({}),
  identityImageUrl: (filename: string) => filename,
}));

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';

import { ACTIVITY_ACTIONS, renderActivitySummary } from './activity-log.summary';
import { CustomShiftRequestController } from './custom-shift-request.controller';
import {
  CustomShiftRequestService,
  STAFF_WORK_SHIFT_ROUTE,
} from './custom-shift-request.service';
import {
  expandCustomShiftDates,
  normalizeCustomShiftRequest,
} from './custom-shift-request.utils';
import {
  CustomShiftRequest,
  CustomShiftRequestStatus,
} from './entities/custom-shift-request.entity';
import { EmploymentStatus } from './entities/employee-profile.entity';
import {
  ShiftAssignmentStatus,
  WorkCycleStatus,
} from './entities/shift-management.entity';
import { STORE_OWNER_ONLY_KEY } from './guards/store-owner-only.decorator';
import { StoreOwnerOnlyGuard } from './guards/store-owner-only.guard';
import { NotificationType } from '../notifications/entities/notification.entity';
import { OWNER_APPROVAL_ROUTE } from './owner-notification.utils';
import { StoresService } from './stores.service';

// 2026-10-01 10:00 in Vietnam.
const NOW = new Date('2026-10-01T03:00:00.000Z');

beforeAll(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: [
      'nextTick',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'queueMicrotask',
    ],
  });
});
afterAll(() => jest.useRealTimers());

describe('normalizeCustomShiftRequest', () => {
  const base = { startDate: '2026-10-02', startTime: '08:00', endTime: '12:00' };

  it('single date: end defaults to start, weekdays ignored', () => {
    const result = normalizeCustomShiftRequest(
      { ...base, daysOfWeek: [1, 2] },
      NOW,
    );
    expect(result).toMatchObject({
      startDate: '2026-10-02',
      endDate: '2026-10-02',
      daysOfWeek: null,
      dates: ['2026-10-02'],
      durationMinutes: 240,
    });
  });

  it('overnight: end < start is the next day', () => {
    const result = normalizeCustomShiftRequest(
      { ...base, startTime: '22:00', endTime: '06:00' },
      NOW,
    );
    expect(result.durationMinutes).toBe(8 * 60);
  });

  it.each([
    ['00:30 long', '08:00', '08:30', 'CUSTOM_SHIFT_INVALID_DURATION'],
    ['17h', '06:00', '23:00', 'CUSTOM_SHIFT_INVALID_DURATION'],
    ['same time', '08:00', '08:00', 'CUSTOM_SHIFT_INVALID_TIME'],
    ['bad format', '8:00', '12:00', 'CUSTOM_SHIFT_INVALID_TIME'],
  ])('rejects %s', (_label, startTime, endTime, code) => {
    try {
      normalizeCustomShiftRequest({ ...base, startTime, endTime }, NOW);
      throw new Error('expected a validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ code });
    }
  });

  it('accepts exactly 1 h and exactly 16 h (overnight)', () => {
    expect(
      normalizeCustomShiftRequest({ ...base, startTime: '08:00', endTime: '09:00' }, NOW)
        .durationMinutes,
    ).toBe(60);
    expect(
      normalizeCustomShiftRequest({ ...base, startTime: '14:00', endTime: '06:00' }, NOW)
        .durationMinutes,
    ).toBe(16 * 60);
  });

  it('refuses past dates (VN calendar) and a first shift already started today', () => {
    expect(() =>
      normalizeCustomShiftRequest({ ...base, startDate: '2026-09-30' }, NOW),
    ).toThrow(BadRequestException);
    // Today 10:00 VN: 08:00 already started, 18:00 is fine.
    expect(() =>
      normalizeCustomShiftRequest({ ...base, startDate: '2026-10-01' }, NOW),
    ).toThrow(BadRequestException);
    expect(
      normalizeCustomShiftRequest(
        { ...base, startDate: '2026-10-01', startTime: '18:00', endTime: '22:00' },
        NOW,
      ).dates,
    ).toEqual(['2026-10-01']);
  });

  it('VN date, not UTC date: 23:30 UTC on 30/09 is already 01/10 in Vietnam', () => {
    const lateUtc = new Date('2026-09-30T23:30:00.000Z'); // 06:30 VN on 01/10
    expect(() =>
      normalizeCustomShiftRequest({ ...base, startDate: '2026-09-30' }, lateUtc),
    ).toThrow(BadRequestException);
  });

  it('range: max 62 days, end >= start', () => {
    expect(
      normalizeCustomShiftRequest(
        { ...base, endDate: '2026-12-02' }, // 62 days
        NOW,
      ).dates,
    ).toHaveLength(62);
    expect(() =>
      normalizeCustomShiftRequest({ ...base, endDate: '2026-12-03' }, NOW),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeCustomShiftRequest({ ...base, endDate: '2026-10-01' }, NOW),
    ).toThrow(BadRequestException);
  });

  it('weekdays: sorted, de-duplicated, expanded; all 7 = every day (null)', () => {
    const result = normalizeCustomShiftRequest(
      { ...base, endDate: '2026-10-15', daysOfWeek: [5, 1, 1] },
      NOW,
    );
    // 2026-10-02 is a Friday.
    expect(result.daysOfWeek).toEqual([1, 5]);
    expect(result.dates).toEqual([
      '2026-10-02',
      '2026-10-05',
      '2026-10-09',
      '2026-10-12',
    ]);
    expect(
      normalizeCustomShiftRequest(
        { ...base, endDate: '2026-10-04', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
        NOW,
      ).daysOfWeek,
    ).toBeNull();
  });

  it('weekdays that match no date in the range: 400', () => {
    expect(() =>
      normalizeCustomShiftRequest(
        { ...base, endDate: '2026-10-03', daysOfWeek: [2] },
        NOW,
      ),
    ).toThrow(BadRequestException);
  });

  it('expandCustomShiftDates: null weekdays = every day', () => {
    expect(expandCustomShiftDates('2026-10-30', '2026-11-02', null)).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });
});

// ── Service ──────────────────────────────────────────────────────────────

const PROFILES: Record<string, any> = {
  'emp-1': {
    id: 'emp-1',
    storeId: 'store-a',
    accountId: 'staff-1',
    employmentStatus: EmploymentStatus.ACTIVE,
    account: { fullName: 'Minh', avatar: null },
  },
  'emp-2': {
    id: 'emp-2',
    storeId: 'store-a',
    accountId: 'staff-2',
    employmentStatus: EmploymentStatus.ACTIVE,
    account: { fullName: 'Lan', avatar: null },
  },
};

const pendingRow = (overrides: Partial<CustomShiftRequest> = {}) =>
  Object.assign(new CustomShiftRequest(), {
    id: 'req-1',
    storeId: 'store-a',
    employeeProfileId: 'emp-1',
    startDate: '2026-10-05',
    endDate: '2026-10-05',
    daysOfWeek: null,
    startTime: '22:00:00',
    endTime: '06:00:00',
    note: null,
    status: CustomShiftRequestStatus.PENDING,
    decidedByAccountId: null,
    decidedAt: null,
    rejectionReason: null,
    createdScheduleRef: null,
    createdAt: new Date('2026-10-01T02:00:00Z'),
    updatedAt: new Date('2026-10-01T02:00:00Z'),
    ...overrides,
  });

function build(options: {
  row?: CustomShiftRequest | null;
  conflicts?: Array<{ date: string; reason: 'SHIFT' | 'LEAVE' }>;
  saveError?: Error;
  employeeEligible?: boolean;
  sameNameRows?: Array<{ shift_name: string; work_date: string }>;
} = {}) {
  let row = options.row === undefined ? pendingRow() : options.row;
  const writes: any[] = [];
  const queries: string[] = [];
  const manager: any = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('FROM shift_slots')) return options.sameNameRows ?? [];
      return [];
    }),
    create: jest.fn((_entity: unknown, data: any) =>
      Object.assign(new CustomShiftRequest(), data),
    ),
    save: jest.fn(async (_entity: unknown, data: any) => {
      if (options.saveError) throw options.saveError;
      const saved = Object.assign(data, {
        id: data.id ?? 'req-new',
        createdAt: data.createdAt ?? NOW,
        updatedAt: NOW,
      });
      writes.push({ ...saved });
      row = saved;
      return saved;
    }),
    findOne: jest.fn(async (entity: any, opts: any) => {
      if (entity === CustomShiftRequest) {
        return row && row.id === opts.where.id && row.storeId === opts.where.storeId
          ? row
          : null;
      }
      // EmployeeProfile (approval eligibility check)
      if (options.employeeEligible === false) return null;
      return PROFILES[opts.where.id] ?? null;
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (callback: any) => callback(manager)),
  };
  const profileRepository = {
    findOne: jest.fn(async ({ where }: any) => {
      if (where.id) return PROFILES[where.id] ?? null;
      return (
        Object.values(PROFILES).find(
          (profile: any) =>
            profile.storeId === where.storeId && profile.accountId === where.accountId,
        ) ?? null
      );
    }),
  };
  const storeRepository = {
    findOne: jest.fn().mockResolvedValue({ id: 'store-a', ownerAccountId: 'owner-a' }),
  };
  const requestRepository = { find: jest.fn().mockResolvedValue([]) };
  let cycle = 0;
  const storesService = {
    findEmployeeShiftConflicts: jest.fn().mockResolvedValue(options.conflicts ?? []),
    createShiftScheduleWithin: jest.fn(async () => {
      cycle += 1;
      return {
        id: `cycle-${cycle}`,
        shifts: [{ id: `shift-${cycle}` }],
        assignmentIds: [`as-${cycle}`],
      };
    }),
    scheduleRemindersForNewAssignments: jest.fn(),
  };
  const notificationsService = { create: jest.fn().mockResolvedValue({}) };
  const activityLogService = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new CustomShiftRequestService(
    dataSource as any,
    requestRepository as any,
    profileRepository as any,
    storeRepository as any,
    storesService as any,
    notificationsService as any,
    activityLogService as any,
  );
  return {
    service,
    manager,
    writes,
    queries,
    storesService,
    notificationsService,
    activityLogService,
    profileRepository,
    get row() {
      return row;
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('CustomShiftRequestService.create (staff, self only)', () => {
  const dto = { startDate: '2026-10-05', startTime: '22:00', endTime: '06:00' };

  it('creates a PENDING request for the caller own profile, logs and notifies the owner', async () => {
    const ctx = build({ row: null });
    const view = await ctx.service.create('store-a', 'staff-1', dto);
    expect(view).toMatchObject({
      storeId: 'store-a',
      employeeProfileId: 'emp-1',
      startDate: '2026-10-05',
      endDate: '2026-10-05',
      startTime: '22:00',
      endTime: '06:00',
      isOvernight: true,
      durationMinutes: 480,
      dates: ['2026-10-05'],
      status: 'PENDING',
    });
    expect(ctx.activityLogService.record).toHaveBeenCalledWith(
      ctx.manager,
      expect.objectContaining({
        action: ACTIVITY_ACTIONS.CUSTOM_SHIFT_REQUEST_CREATED,
        resourceType: 'custom_shift_request',
        subjectEmployeeProfileId: 'emp-1',
        actorAccountId: 'staff-1',
      }),
    );
    await flush();
    expect(ctx.notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'owner-a',
        storeId: 'store-a',
        type: NotificationType.SYSTEM,
        actionUrl: OWNER_APPROVAL_ROUTE,
        metadata: expect.objectContaining({
          type: 'CUSTOM_SHIFT_REQUEST',
          requestId: 'req-new',
          employeeProfileId: 'emp-1',
        }),
      }),
    );
    expect(OWNER_APPROVAL_ROUTE).toBe('/(work-shift-v2)/approval');
  });

  it('a caller without an employed (rosterable) profile at the store: 403, nothing written', async () => {
    const ctx = build({ row: null });
    await expect(
      ctx.service.create('store-a', 'stranger', dto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.writes).toHaveLength(0);
    // The profile lookup is by the caller account, never a client-supplied id.
    expect(ctx.profileRepository.findOne.mock.calls[0][0].where).toMatchObject({
      storeId: 'store-a',
      accountId: 'stranger',
    });
  });

  it('duplicate PENDING (unique index): 409 CUSTOM_SHIFT_REQUEST_DUPLICATE', async () => {
    const ctx = build({ row: null, saveError: Object.assign(new Error('duplicate'), { code: '23505' }) });
    await expect(ctx.service.create('store-a', 'staff-1', dto)).rejects.toMatchObject({
      response: { code: 'CUSTOM_SHIFT_REQUEST_DUPLICATE' },
    });
  });

  it('invalid input never reaches the database', async () => {
    const ctx = build({ row: null });
    await expect(
      ctx.service.create('store-a', 'staff-1', { ...dto, startDate: '2026-09-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.writes).toHaveLength(0);
  });
});

describe('CustomShiftRequestService.approve (owner)', () => {
  it('creates one non-repeating shift per date for exactly that employee, in the same transaction', async () => {
    const ctx = build({
      row: pendingRow({
        startDate: '2026-10-05',
        endDate: '2026-10-11',
        daysOfWeek: [1, 3],
      }),
    });
    const view = await ctx.service.approve('store-a', 'req-1', 'owner-a');

    expect(ctx.queries.some((sql) => sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(ctx.storesService.findEmployeeShiftConflicts).toHaveBeenCalledWith(
      ctx.manager,
      'store-a',
      'emp-1',
      ['2026-10-05', '2026-10-07'],
      '22:00',
      '06:00',
    );
    const calls = ctx.storesService.createShiftScheduleWithin.mock.calls;
    expect(calls.map((call: any[]) => call[3].startDate)).toEqual([
      '2026-10-05',
      '2026-10-07',
    ]);
    for (const [manager, storeId, owner, data] of calls as any[]) {
      expect(manager).toBe(ctx.manager);
      expect(storeId).toBe('store-a');
      expect(owner).toBe('owner-a');
      expect(data).toMatchObject({
        startTime: '22:00',
        endTime: '06:00',
        maxStaff: 1,
        employeeIds: ['emp-1'],
        recurrence: { enabled: false },
      });
      expect(data.shiftName).toBe('Khung giờ khác');
    }
    expect(view).toMatchObject({
      status: 'APPROVED',
      decidedByAccountId: 'owner-a',
      createdSchedule: {
        cycleIds: ['cycle-1', 'cycle-2'],
        assignmentIds: ['as-1', 'as-2'],
        dates: ['2026-10-05', '2026-10-07'],
        skippedPastDates: [],
      },
    });
    expect(ctx.storesService.scheduleRemindersForNewAssignments).toHaveBeenCalledWith([
      'as-1',
      'as-2',
    ]);
    expect(ctx.activityLogService.record).toHaveBeenCalledWith(
      ctx.manager,
      expect.objectContaining({
        action: ACTIVITY_ACTIONS.CUSTOM_SHIFT_REQUEST_APPROVED,
        actorAccountId: 'owner-a',
        params: expect.objectContaining({ count: 2 }),
      }),
    );
    await flush();
    expect(ctx.notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'staff-1',
        actionUrl: STAFF_WORK_SHIFT_ROUTE,
        metadata: expect.objectContaining({
          type: 'CUSTOM_SHIFT_REQUEST',
          event: 'APPROVED',
          workDates: ['2026-10-05', '2026-10-07'],
        }),
      }),
    );
    expect(STAFF_WORK_SHIFT_ROUTE).toBe('/(home)/workshift');
  });

  it('names the shift plainly "Khung giờ khác" (no ids, names or times in it)', async () => {
    const ctx = build();
    await ctx.service.approve('store-a', 'req-1', 'owner-a');
    for (const call of ctx.storesService.createShiftScheduleWithin.mock.calls as any[]) {
      expect(call[3].shiftName).toBe('Khung giờ khác');
      expect(call[3].shiftName).not.toMatch(/#|·|\d{2}:\d{2}/);
    }
  });

  it('numbers the name only on a date that already has "Khung giờ khác"', async () => {
    const ctx = build({
      row: pendingRow({ endDate: '2026-10-07' }),
      sameNameRows: [
        { shift_name: 'Khung giờ khác', work_date: '2026-10-05' },
        { shift_name: 'Khung giờ khác 2', work_date: '2026-10-05' },
      ],
    });
    // The shared mock returns every row regardless of the date filter, so
    // both dates see the two existing names and get the next free number.
    await ctx.service.approve('store-a', 'req-1', 'owner-a');
    const names = (ctx.storesService.createShiftScheduleWithin.mock.calls as any[]).map(
      (call) => call[3].shiftName,
    );
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toBe('Khung giờ khác 3');
  });

  it('every numbered name taken on a date: coded 409, nothing created', async () => {
    const taken = [
      { shift_name: 'Khung giờ khác', work_date: '2026-10-05' },
      ...Array.from({ length: 49 }, (_, index) => ({
        shift_name: `Khung giờ khác ${index + 2}`,
        work_date: '2026-10-05',
      })),
    ];
    const ctx = build({ sameNameRows: taken });
    await expect(ctx.service.approve('store-a', 'req-1', 'owner-a')).rejects.toMatchObject({
      status: 409,
      response: { code: 'CUSTOM_SHIFT_NAME_TAKEN' },
    });
    expect(ctx.storesService.createShiftScheduleWithin).not.toHaveBeenCalled();
  });

  it("the unified path's same-name 400 is mapped to the coded 409", async () => {
    const ctx = build();
    ctx.storesService.createShiftScheduleWithin.mockRejectedValueOnce(
      new BadRequestException(
        'Đã có ca "X" vào ngày 05/10/2026. Tên ca chỉ được trùng khi khác ngày.',
      ),
    );
    await expect(ctx.service.approve('store-a', 'req-1', 'owner-a')).rejects.toMatchObject({
      status: 409,
      response: { code: 'CUSTOM_SHIFT_NAME_TAKEN' },
    });
  });

  it('overlap on any date: 409 with details, no shift created, request stays PENDING', async () => {
    const ctx = build({
      row: pendingRow({ endDate: '2026-10-07' }),
      conflicts: [{ date: '2026-10-06', reason: 'SHIFT' }],
    });
    await expect(ctx.service.approve('store-a', 'req-1', 'owner-a')).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'CUSTOM_SHIFT_CONFLICT',
        conflicts: [{ date: '2026-10-06', reason: 'SHIFT' }],
      },
    });
    expect(ctx.storesService.createShiftScheduleWithin).not.toHaveBeenCalled();
    expect(ctx.writes).toHaveLength(0);
    expect(ctx.row?.status).toBe('PENDING');
    expect(ctx.storesService.scheduleRemindersForNewAssignments).not.toHaveBeenCalled();
  });

  it('a failure while creating a later date propagates (whole transaction rolls back)', async () => {
    const ctx = build({ row: pendingRow({ endDate: '2026-10-06' }) });
    ctx.storesService.createShiftScheduleWithin
      .mockResolvedValueOnce({ id: 'c1', shifts: [{ id: 's1' }], assignmentIds: ['a1'] })
      .mockRejectedValueOnce(new BadRequestException('trùng'));
    await expect(ctx.service.approve('store-a', 'req-1', 'owner-a')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ctx.writes).toHaveLength(0);
    expect(ctx.storesService.scheduleRemindersForNewAssignments).not.toHaveBeenCalled();
  });

  it('idempotent: approving an APPROVED request returns it without creating anything', async () => {
    const ref = {
      cycleIds: ['c1'],
      shiftIds: ['s1'],
      assignmentIds: ['a1'],
      dates: ['2026-10-05'],
      skippedPastDates: [],
    };
    const ctx = build({
      row: pendingRow({
        status: CustomShiftRequestStatus.APPROVED,
        createdScheduleRef: ref,
        decidedByAccountId: 'owner-a',
      }),
    });
    const view = await ctx.service.approve('store-a', 'req-1', 'owner-a');
    expect(view).toMatchObject({ status: 'APPROVED', createdSchedule: ref });
    expect(ctx.storesService.createShiftScheduleWithin).not.toHaveBeenCalled();
    expect(ctx.writes).toHaveLength(0);
    await flush();
    expect(ctx.notificationsService.create).not.toHaveBeenCalled();
  });

  it('the row is read with a pessimistic write lock (serializes concurrent approvals)', async () => {
    const ctx = build();
    await ctx.service.approve('store-a', 'req-1', 'owner-a');
    const lockCall = ctx.manager.findOne.mock.calls.find(
      (call: any[]) => call[0] === CustomShiftRequest,
    );
    expect(lockCall[1].lock).toEqual({ mode: 'pessimistic_write' });
  });

  it('a REJECTED / CANCELLED request cannot be approved: 409', async () => {
    for (const status of [
      CustomShiftRequestStatus.REJECTED,
      CustomShiftRequestStatus.CANCELLED,
    ]) {
      const ctx = build({ row: pendingRow({ status }) });
      await expect(ctx.service.approve('store-a', 'req-1', 'owner-a')).rejects.toMatchObject({
        response: { code: 'CUSTOM_SHIFT_REQUEST_NOT_PENDING' },
      });
    }
  });

  it('a request of another store: 404 (store-scoped lookup)', async () => {
    const ctx = build();
    await expect(ctx.service.approve('store-b', 'req-1', 'owner-b')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('employee no longer rosterable: 409, nothing created', async () => {
    const ctx = build({ employeeEligible: false });
    await expect(ctx.service.approve('store-a', 'req-1', 'owner-a')).rejects.toMatchObject({
      response: { code: 'CUSTOM_SHIFT_EMPLOYEE_NOT_ELIGIBLE' },
    });
    expect(ctx.storesService.createShiftScheduleWithin).not.toHaveBeenCalled();
  });

  it('past dates at approval time are skipped and recorded; all past: 409 expired', async () => {
    const partly = build({
      row: pendingRow({ startDate: '2026-09-29', endDate: '2026-10-02' }),
    });
    const view = await partly.service.approve('store-a', 'req-1', 'owner-a');
    expect(view.createdSchedule).toMatchObject({
      dates: ['2026-10-01', '2026-10-02'],
      skippedPastDates: ['2026-09-29', '2026-09-30'],
    });

    const expired = build({
      row: pendingRow({ startDate: '2026-09-20', endDate: '2026-09-21' }),
    });
    await expect(expired.service.approve('store-a', 'req-1', 'owner-a')).rejects.toMatchObject({
      response: { code: 'CUSTOM_SHIFT_REQUEST_EXPIRED' },
    });
  });
});

describe('CustomShiftRequestService reject / cancel', () => {
  it('reject: records reason, logs, notifies the employee; idempotent', async () => {
    const ctx = build();
    const view = await ctx.service.reject('store-a', 'req-1', 'owner-a', {
      reason: ' Đủ người rồi ',
    });
    expect(view).toMatchObject({ status: 'REJECTED', rejectionReason: 'Đủ người rồi' });
    expect(ctx.activityLogService.record).toHaveBeenCalledWith(
      ctx.manager,
      expect.objectContaining({ action: ACTIVITY_ACTIONS.CUSTOM_SHIFT_REQUEST_REJECTED }),
    );
    await flush();
    expect(ctx.notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'staff-1',
        actionUrl: '/(home)/workshift',
        metadata: expect.objectContaining({ event: 'REJECTED' }),
      }),
    );
    const writes = ctx.writes.length;
    await ctx.service.reject('store-a', 'req-1', 'owner-a', {});
    expect(ctx.writes).toHaveLength(writes);
  });

  it('cancel: own pending request only', async () => {
    const own = build();
    await expect(own.service.cancel('store-a', 'req-1', 'staff-1')).resolves.toMatchObject({
      status: 'CANCELLED',
    });
    expect(own.activityLogService.record).toHaveBeenCalledWith(
      own.manager,
      expect.objectContaining({ action: ACTIVITY_ACTIONS.CUSTOM_SHIFT_REQUEST_CANCELLED }),
    );

    const other = build();
    await expect(other.service.cancel('store-a', 'req-1', 'staff-2')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(other.writes).toHaveLength(0);

    const decided = build({ row: pendingRow({ status: CustomShiftRequestStatus.APPROVED }) });
    await expect(
      decided.service.cancel('store-a', 'req-1', 'staff-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('activity summaries', () => {
  it('renders the four custom shift actions', () => {
    const params = {
      startTime: '22:00',
      endTime: '06:00',
      fromDate: '2026-10-05',
      toDate: '2026-10-11',
      count: 2,
    };
    expect(
      renderActivitySummary({
        action: ACTIVITY_ACTIONS.CUSTOM_SHIFT_REQUEST_CREATED,
        actorRole: 'staff',
        actorName: 'Minh',
        params,
      }),
    ).toBe('Minh gửi yêu cầu khung giờ 22:00–06:00 từ 05/10 đến 11/10 (2 ngày)');
    expect(
      renderActivitySummary({
        action: ACTIVITY_ACTIONS.CUSTOM_SHIFT_REQUEST_APPROVED,
        actorRole: 'owner',
        subjectName: 'Minh',
        params: { ...params, toDate: '2026-10-05', count: 1 },
      }),
    ).toBe('Chủ cửa hàng duyệt yêu cầu khung giờ 22:00–06:00 ngày 05/10 của Minh');
    expect(
      renderActivitySummary({
        action: ACTIVITY_ACTIONS.CUSTOM_SHIFT_REQUEST_REJECTED,
        actorRole: 'owner',
        subjectName: 'Minh',
        params,
      }),
    ).toContain('từ chối yêu cầu khung giờ');
    expect(
      renderActivitySummary({
        action: ACTIVITY_ACTIONS.CUSTOM_SHIFT_REQUEST_CANCELLED,
        actorRole: 'staff',
        actorName: 'Minh',
        params,
      }),
    ).toContain('Minh huỷ yêu cầu khung giờ');
  });
});

describe('routes', () => {
  const ownerOnly = (handler: string) =>
    Reflect.getMetadata(
      STORE_OWNER_ONLY_KEY,
      (CustomShiftRequestController.prototype as any)[handler],
    ) !== undefined;

  it('owner list/approve/reject are @StoreOwnerOnly; staff routes are not', () => {
    expect(ownerOnly('listForOwner')).toBe(true);
    expect(ownerOnly('approve')).toBe(true);
    expect(ownerOnly('reject')).toBe(true);
    expect(ownerOnly('create')).toBe(false);
    expect(ownerOnly('listMine')).toBe(false);
    expect(ownerOnly('cancel')).toBe(false);
    const guards = Reflect.getMetadata(GUARDS_METADATA, CustomShiftRequestController);
    expect(guards).toContain(StoreOwnerOnlyGuard);
  });
});

// ── Conflict detection (real StoresService helper) ───────────────────────

describe('StoresService.findEmployeeShiftConflicts', () => {
  const builder = (rows: unknown[]) => {
    const qb: any = {};
    for (const method of ['leftJoinAndSelect', 'where', 'andWhere', 'take']) {
      qb[method] = jest.fn(() => qb);
    }
    qb.getMany = jest.fn().mockResolvedValue(rows);
    return qb;
  };
  const run = (
    assignments: unknown[],
    leaves: unknown[],
    dates: string[],
    start: string,
    end: string,
  ) => {
    const service = Object.create(StoresService.prototype) as StoresService;
    const queues = [builder(assignments), builder(leaves)];
    const manager: any = { createQueryBuilder: jest.fn(() => queues.shift()) };
    return service.findEmployeeShiftConflicts(
      manager,
      'store-a',
      'emp-1',
      dates,
      start,
      end,
    );
  };
  const assignment = (workDate: string, startTime: string, endTime: string) => ({
    employeeId: 'emp-1',
    status: ShiftAssignmentStatus.APPROVED,
    shiftSlot: {
      workDate,
      startTime,
      endTime,
      cycle: { status: WorkCycleStatus.ACTIVE },
    },
  });

  it('cross-midnight: an existing 22:00–06:00 shift the day before blocks 05:00–09:00', async () => {
    await expect(
      run([assignment('2026-10-04', '22:00:00', '06:00:00')], [], ['2026-10-05'], '05:00', '09:00'),
    ).resolves.toEqual([{ date: '2026-10-05', reason: 'SHIFT' }]);
  });

  it('a requested overnight shift blocks the next morning shift', async () => {
    await expect(
      run(
        [assignment('2026-10-06', '05:00:00', '09:00:00')],
        [],
        ['2026-10-05', '2026-10-06'],
        '22:00',
        '06:00',
      ),
    ).resolves.toEqual([{ date: '2026-10-05', reason: 'SHIFT' }]);
  });

  it('back-to-back is not a conflict', async () => {
    await expect(
      run([assignment('2026-10-05', '06:00:00', '10:00:00')], [], ['2026-10-05'], '10:00', '14:00'),
    ).resolves.toEqual([]);
  });

  it('approved full-day leave blocks the date', async () => {
    await expect(
      run(
        [],
        [
          {
            employeeProfileId: 'emp-1',
            type: 'PERSONAL',
            startDate: '2026-10-07',
            endDate: '2026-10-07',
            startTime: null,
            endTime: null,
          },
        ],
        ['2026-10-06', '2026-10-07'],
        '08:00',
        '12:00',
      ),
    ).resolves.toEqual([{ date: '2026-10-07', reason: 'LEAVE' }]);
  });
});

describe('StoresService.createShiftScheduleWithin', () => {
  it("runs the unified path inside the caller's transaction (no new transaction)", async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.dataSource = { transaction: jest.fn() };
    const manager: any = {
      query: jest.fn().mockResolvedValue([]),
      // Store owned by someone else: the unified owner check refuses.
      findOne: jest.fn().mockResolvedValue({ id: 'store-a', ownerAccountId: 'owner-x' }),
    };
    await expect(
      service.createShiftScheduleWithin(manager, 'store-a', 'owner-a', {
        shiftName: 'Khung giờ khác 22:00-06:00',
        startDate: '2026-10-05',
        startTime: '22:00',
        endTime: '06:00',
        maxStaff: 1,
        employeeIds: ['emp-1'],
        recurrence: {
          enabled: false,
          frequency: 'DAILY',
          interval: 1,
          endType: 'COUNT',
          occurrenceCount: 1,
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.dataSource.transaction).not.toHaveBeenCalled();
    expect(manager.query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
  });

  it('keeps the unified validation (past start date refused)', async () => {
    const service = Object.create(StoresService.prototype) as any;
    const manager: any = { query: jest.fn(), findOne: jest.fn() };
    await expect(
      service.createShiftScheduleWithin(manager, 'store-a', 'owner-a', {
        shiftName: 'X',
        startDate: '2026-09-01',
        startTime: '08:00',
        endTime: '12:00',
        maxStaff: 1,
        employeeIds: ['emp-1'],
        recurrence: {
          enabled: false,
          frequency: 'DAILY',
          interval: 1,
          endType: 'COUNT',
          occurrenceCount: 1,
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.query).not.toHaveBeenCalled();
  });
});
