import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AccountsService } from '../src/modules/accounts/accounts.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { MailService } from '../src/modules/mail/mail.service';
import { StoresController } from '../src/modules/stores/stores.controller';
import { ShiftEndWorkflowService } from '../src/modules/stores/shift-end-workflow.service';
import {
  ShiftAssignment,
  ShiftSlot,
  WorkCycle,
} from '../src/modules/stores/entities/shift-management.entity';
import {
  EmployeeProfile,
  EmploymentStatus,
} from '../src/modules/stores/entities/employee-profile.entity';
import { Store } from '../src/modules/stores/entities/store.entity';
import { WorkShift } from '../src/modules/stores/entities/work-shift.entity';
import { StoresService } from '../src/modules/stores/stores.service';
import {
  ShiftRecurrenceEndType,
  ShiftRecurrenceFrequency,
} from '../src/modules/stores/shift-schedule.types';
import {
  addDays,
  getTodayDateString,
} from '../src/modules/stores/shift-schedule.utils';

jest.mock('uuid', () => ({ v4: () => 'test-upload-id' }));

interface MemoryState {
  stores: any[];
  shifts: any[];
  cycles: any[];
  slots: any[];
  employees: any[];
  assignments: any[];
  sequence: number;
}

class MemoryScheduleDatabase {
  state: MemoryState = {
    stores: [
      { id: 'store-1', ownerAccountId: 'owner-1' },
      { id: 'store-2', ownerAccountId: 'owner-2' },
    ],
    shifts: [],
    cycles: [],
    slots: [],
    employees: [
      {
        id: 'employee-1',
        storeId: 'store-1',
        employmentStatus: EmploymentStatus.ACTIVE,
      },
      {
        id: 'employee-2',
        storeId: 'store-1',
        employmentStatus: EmploymentStatus.ACTIVE,
      },
    ],
    assignments: [],
    sequence: 1,
  };

  failNextSlotSave = false;
  transactionCount = 0;
  inTransaction = false;
  private transactionTail: Promise<void> = Promise.resolve();

  async transaction<T>(callback: (manager: any) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const staged = structuredClone(this.state);
    const manager = this.createManager(staged);
    this.inTransaction = true;
    try {
      const result = await callback(manager);
      this.state = staged;
      this.inTransaction = false;
      return result;
    } finally {
      this.inTransaction = false;
      release();
    }
  }

  private createManager(staged: MemoryState) {
    return {
      query: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
      findOne: jest.fn(async (entity: any, options: any) => {
        const where = options?.where || {};
        const source =
          entity === Store
            ? staged.stores
            : entity === WorkShift
              ? staged.shifts
              : entity === WorkCycle
                ? staged.cycles
                : entity === EmployeeProfile
                  ? staged.employees
                  : staged.slots;
        return (
          source.find((item) =>
            Object.entries(where).every(([key, value]) => item[key] === value),
          ) || null
        );
      }),
      find: jest.fn(async (entity: any, options: any) => {
        const where = options?.where || {};
        const source =
          entity === WorkShift
            ? staged.shifts
            : entity === EmployeeProfile
              ? staged.employees
              : [];
        return source.filter((item) =>
          Object.entries(where).every(([key, value]) => item[key] === value),
        );
      }),
      create: jest.fn((entity: any, data: any) => ({
        id: `${entity.name.toLowerCase()}-${staged.sequence++}`,
        ...data,
      })),
      save: jest.fn(async (entity: any, value: any) => {
        if (entity === ShiftSlot && this.failNextSlotSave) {
          this.failNextSlotSave = false;
          throw new Error('simulated slot failure');
        }

        const values = Array.isArray(value) ? value : [value];
        if (entity === WorkShift) staged.shifts.push(...values);
        if (entity === WorkCycle) staged.cycles.push(...values);
        if (entity === ShiftSlot) staged.slots.push(...values);
        if (entity === ShiftAssignment) staged.assignments.push(...values);
        return value;
      }),
      update: jest.fn(async (entity: any, criteria: any, patch: any) => {
        const source = entity === WorkCycle ? staged.cycles : [];
        const target = source.find((item) =>
          typeof criteria === 'string'
            ? item.id === criteria
            : item.id === criteria.id,
        );
        if (target) Object.assign(target, patch);
        return { affected: target ? 1 : 0 };
      }),
    };
  }
}

describe('Unified shift schedule flow (e2e)', () => {
  let app: INestApplication;
  let database: MemoryScheduleDatabase;
  let storesService: StoresService;
  let preflightOptionsMock: jest.Mock;
  let commitAvailabilityMock: jest.Mock;
  let batchReminderMock: jest.Mock;
  let perAssignmentReminderMock: jest.Mock;
  let loggerErrorMock: jest.Mock;

  beforeAll(async () => {
    database = new MemoryScheduleDatabase();
    storesService = Object.create(StoresService.prototype) as StoresService;
    loggerErrorMock = jest.fn();
    (storesService as any).logger = { error: loggerErrorMock };
    (storesService as any).dataSource = database;
    (storesService as any).storeRepository = {
      findOne: jest.fn(async ({ where }: any) =>
        database.state.stores.find((item) => item.id === where.id),
      ),
    };
    commitAvailabilityMock = jest.fn(
      async (_manager: any, _storeId: string, drafts: any[]) => {
        const assignedEmployeeIds = new Set(
          database.state.assignments.map((assignment) => assignment.employeeId),
        );
        if (
          drafts.some((draft) =>
            draft.employeeIds.some((id: string) => assignedEmployeeIds.has(id)),
          )
        ) {
          const { BadRequestException } = await import('@nestjs/common');
          throw new BadRequestException('Nhân viên không còn khả dụng');
        }
      },
    );
    (storesService as any).assertShiftScheduleAvailabilityAtCommit =
      commitAvailabilityMock;
    preflightOptionsMock = jest.fn(
      async (_storeId: string, _ownerId: string, payload: any) => {
        const assignedEmployeeIds = new Set(
          database.state.assignments.map((assignment) => assignment.employeeId),
        );
        return {
          employees: (payload.employeeIds || []).map((id: string) => {
            const hasConflict = assignedEmployeeIds.has(id);
            return {
              id,
              name: id,
              statusLabel: hasConflict ? 'Trùng ca' : 'Rảnh',
              selectable: !hasConflict,
            };
          }),
        };
      },
    );
    (storesService as any).getShiftEmployeeOptions = preflightOptionsMock;
    batchReminderMock = jest.fn(async (assignmentIds: string[]) => {
      expect(database.inTransaction).toBe(false);
      expect(database.state.assignments).toHaveLength(assignmentIds.length);
    });
    (storesService as any).shiftReminderService = {
      scheduleAssignmentReminders: batchReminderMock,
    };
    perAssignmentReminderMock = jest.fn(async () => undefined);
    (storesService as any).scheduleReminderForAssignment =
      perAssignmentReminderMock;

    const authenticatedGuard: CanActivate = {
      canActivate(context: ExecutionContext) {
        context.switchToHttp().getRequest().user = { userId: 'owner-1' };
        return true;
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [StoresController],
      providers: [
        { provide: StoresService, useValue: storesService },
        { provide: AccountsService, useValue: {} },
        { provide: MailService, useValue: {} },
        { provide: ShiftEndWorkflowService, useValue: {} },
        {
          provide: getQueueToken('attendance-background'),
          useValue: { add: jest.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(authenticatedGuard)
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
    database.state.shifts = [];
    database.state.cycles = [];
    database.state.slots = [];
    database.state.assignments = [];
    database.failNextSlotSave = false;
    database.transactionCount = 0;
    preflightOptionsMock.mockClear();
    commitAvailabilityMock.mockClear();
    batchReminderMock.mockClear();
    perAssignmentReminderMock.mockClear();
    loggerErrorMock.mockClear();
  });

  const createPayload = (shiftName: string) => ({
    shiftName,
    startDate: addDays(getTodayDateString(), 1),
    startTime: '07:00',
    endTime: '11:00',
    maxStaff: 3,
    note: 'Ca thử nghiệm',
    recurrence: {
      enabled: true,
      frequency: ShiftRecurrenceFrequency.DAILY,
      interval: 1,
      endType: ShiftRecurrenceEndType.COUNT,
      occurrenceCount: 3,
    },
  });

  it('creates the shift, internal cycle and all slots through one HTTP request', async () => {
    const response = await request(app.getHttpServer())
      .post('/stores/store-1/shift-schedules')
      .send(createPayload('Ca sáng'))
      .expect(201);

    expect(response.body.generatedSlotCount).toBe(3);
    expect(response.body).not.toHaveProperty('assignmentIds');
    expect(database.state.shifts).toHaveLength(1);
    expect(database.state.cycles).toHaveLength(1);
    expect(database.state.slots).toHaveLength(3);
    expect(
      database.state.slots.every((slot) => slot.startTime === '07:00'),
    ).toBe(true);
  });

  it('assigns every selected employee to every generated slot atomically', async () => {
    const payload = {
      ...createPayload('Ca có nhân viên'),
      employeeIds: ['employee-1', 'employee-2'],
    };

    const response = await request(app.getHttpServer())
      .post('/stores/store-1/shift-schedules')
      .send(payload)
      .expect(201);

    expect(response.body.assignedEmployeeCount).toBe(2);
    expect(response.body.generatedAssignmentCount).toBe(6);
    expect(database.state.assignments).toHaveLength(6);
    expect(
      database.state.assignments.every(
        (assignment) =>
          assignment.status === 'APPROVED' &&
          ['employee-1', 'employee-2'].includes(assignment.employeeId),
      ),
    ).toBe(true);
  });

  it('creates multiple independent shift drafts in one atomic request', async () => {
    const payload = {
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
          shiftName: 'Ca sáng độc lập',
          startTime: '07:00',
          endTime: '11:00',
          maxStaff: 2,
          note: 'Ghi chú sáng',
          employeeIds: ['employee-1'],
        },
        {
          shiftName: 'Ca chiều độc lập',
          startTime: '12:00',
          endTime: '16:00',
          maxStaff: 4,
          note: 'Ghi chú chiều',
          employeeIds: ['employee-2'],
        },
      ],
    };

    const response = await request(app.getHttpServer())
      .post('/stores/store-1/shift-schedules')
      .send(payload)
      .expect(201);

    expect(response.body.shifts).toHaveLength(2);
    expect(response.body.shift.shiftName).toBe('Ca sáng độc lập');
    expect(database.state.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          startTime: '07:00',
          endTime: '11:00',
          maxStaff: 2,
          note: 'Ghi chú sáng',
        }),
        expect.objectContaining({
          startTime: '12:00',
          endTime: '16:00',
          maxStaff: 4,
          note: 'Ghi chú chiều',
        }),
      ]),
    );
    expect(database.state.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ employeeId: 'employee-1' }),
        expect.objectContaining({ employeeId: 'employee-2' }),
      ]),
    );
  });

  it('rejects a cross-store batch for the wrong owner without persistence', async () => {
    await request(app.getHttpServer())
      .post('/stores/store-2/shift-schedules')
      .send({
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
            shiftName: 'Ca cửa hàng khác',
            startTime: '07:00',
            endTime: '11:00',
            maxStaff: 1,
          },
        ],
      })
      .expect(403);
    expect(database.transactionCount).toBe(0);
    expect(database.state.shifts).toHaveLength(0);
    expect(database.state.cycles).toHaveLength(0);
    expect(database.state.slots).toHaveLength(0);
  });

  it('allows overlapping drafts for different employees but rejects overlap for one employee', async () => {
    const base = {
      startDate: addDays(getTodayDateString(), 1),
      recurrence: {
        enabled: false,
        frequency: ShiftRecurrenceFrequency.DAILY,
        interval: 1,
        endType: ShiftRecurrenceEndType.COUNT,
        occurrenceCount: 1,
      },
    };
    await request(app.getHttpServer())
      .post('/stores/store-1/shift-schedules')
      .send({
        ...base,
        shifts: [
          {
            shiftName: 'Ca chồng A',
            startTime: '07:00',
            endTime: '12:00',
            maxStaff: 1,
            employeeIds: ['employee-1'],
          },
          {
            shiftName: 'Ca chồng B',
            startTime: '10:00',
            endTime: '14:00',
            maxStaff: 1,
            employeeIds: ['employee-2'],
          },
        ],
      })
      .expect(201);

    database.state.shifts = [];
    database.state.cycles = [];
    database.state.slots = [];
    database.state.assignments = [];
    await request(app.getHttpServer())
      .post('/stores/store-1/shift-schedules')
      .send({
        ...base,
        shifts: [
          {
            shiftName: 'Ca trùng A',
            startTime: '07:00',
            endTime: '12:00',
            maxStaff: 1,
            employeeIds: ['employee-1'],
          },
          {
            shiftName: 'Ca trùng B',
            startTime: '10:00',
            endTime: '14:00',
            maxStaff: 1,
            employeeIds: ['employee-1'],
          },
        ],
      })
      .expect(400);
    expect(database.state.cycles).toHaveLength(0);
  });

  it('allows exactly 10000 generated assignments and rejects 10001 before opening a transaction', async () => {
    const payload = (
      employeeCount: number,
      occurrenceCount: number,
      shiftName: string,
    ) => ({
      startDate: addDays(getTodayDateString(), 1),
      recurrence: {
        enabled: true,
        frequency: ShiftRecurrenceFrequency.DAILY,
        interval: 1,
        endType: ShiftRecurrenceEndType.COUNT,
        occurrenceCount,
      },
      shifts: [
        {
          shiftName,
          startTime: '07:00',
          endTime: '11:00',
          maxStaff: employeeCount,
          employeeIds: Array.from(
            { length: employeeCount },
            (_, index) => `employee-boundary-${index}`,
          ),
        },
      ],
    });

    const atLimit = await request(app.getHttpServer())
      .post('/stores/store-1/shift-schedules')
      .send(payload(100, 100, 'Ca giới hạn 10000'))
      .expect(201);
    expect(atLimit.body.generatedAssignmentCount).toBe(10000);
    expect(atLimit.body).not.toHaveProperty('assignmentIds');
    expect(batchReminderMock).toHaveBeenCalledTimes(1);
    expect(batchReminderMock.mock.calls[0][0]).toHaveLength(10000);
    expect(perAssignmentReminderMock).not.toHaveBeenCalled();

    database.state.shifts = [];
    database.state.cycles = [];
    database.state.slots = [];
    database.state.assignments = [];
    database.transactionCount = 0;
    await request(app.getHttpServer())
      .post('/stores/store-1/shift-schedules')
      .send(payload(73, 137, 'Ca vượt 10001'))
      .expect(400);
    expect(database.transactionCount).toBe(0);
  });

  it('keeps the committed schedule when aggregate reminder scheduling fails', async () => {
    batchReminderMock.mockRejectedValueOnce(
      new Error('simulated aggregate reminder failure'),
    );

    const response = await request(app.getHttpServer())
      .post('/stores/store-1/shift-schedules')
      .send({
        ...createPayload('Ca reminder lỗi'),
        employeeIds: ['employee-1'],
      })
      .expect(201);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(response.body.generatedAssignmentCount).toBe(3);
    expect(database.state.cycles).toHaveLength(1);
    expect(database.state.assignments).toHaveLength(3);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to schedule reminders for newly created shift schedule',
    );
    expect(loggerErrorMock.mock.calls.flat().join(' ')).not.toContain(
      'employee-1',
    );
  });

  it('allows exactly 10000 generated slots and rejects an over-limit fan-out before preflight or transaction', async () => {
    const payload = (occurrenceCount: number, prefix: string) => ({
      startDate: addDays(getTodayDateString(), 1),
      recurrence: {
        enabled: true,
        frequency: ShiftRecurrenceFrequency.DAILY,
        interval: 1,
        endType: ShiftRecurrenceEndType.COUNT,
        occurrenceCount,
      },
      shifts: Array.from({ length: 50 }, (_, index) => ({
        shiftName: `${prefix} ${index + 1}`,
        startTime: '07:00',
        endTime: '11:00',
        maxStaff: 1,
        employeeIds: [`employee-boundary-${index}`],
      })),
    });

    const atLimit = await request(app.getHttpServer())
      .post('/stores/store-1/shift-schedules')
      .send(payload(200, 'Ca slot giới hạn'))
      .expect(201);
    expect(atLimit.body.generatedSlotCount).toBe(10000);
    expect(atLimit.body.generatedAssignmentCount).toBe(10000);
    expect(preflightOptionsMock).not.toHaveBeenCalled();
    expect(commitAvailabilityMock).toHaveBeenCalledTimes(1);

    database.state.shifts = [];
    database.state.cycles = [];
    database.state.slots = [];
    database.state.assignments = [];
    database.transactionCount = 0;
    preflightOptionsMock.mockClear();
    commitAvailabilityMock.mockClear();
    await request(app.getHttpServer())
      .post('/stores/store-1/shift-schedules')
      .send(payload(201, 'Ca slot vượt'))
      .expect(400);
    expect(preflightOptionsMock).not.toHaveBeenCalled();
    expect(commitAvailabilityMock).not.toHaveBeenCalled();
    expect(database.transactionCount).toBe(0);
  });

  it('rejects an incomplete weekly rule without persisting partial data', async () => {
    const payload = createPayload('Ca tuần');
    payload.recurrence.frequency = ShiftRecurrenceFrequency.WEEKLY;

    await request(app.getHttpServer())
      .post('/stores/store-1/shift-schedules')
      .send(payload)
      .expect(400);

    expect(database.state.shifts).toHaveLength(0);
    expect(database.state.cycles).toHaveLength(0);
    expect(database.state.slots).toHaveLength(0);
  });

  it('serializes concurrent duplicate requests so only one schedule is created', async () => {
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post('/stores/store-1/shift-schedules')
        .send(createPayload('Ca đồng thời')),
      request(app.getHttpServer())
        .post('/stores/store-1/shift-schedules')
        .send(createPayload('ca ĐỒNG THỜI')),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 400]);
    expect(database.state.shifts).toHaveLength(1);
    expect(database.state.cycles).toHaveLength(1);
    expect(database.state.slots).toHaveLength(3);
  });

  it('rechecks employee conflicts after acquiring the transaction lock', async () => {
    const firstPayload = {
      ...createPayload('Ca nhân viên đồng thời 1'),
      employeeIds: ['employee-1'],
    };
    const secondPayload = {
      ...createPayload('Ca nhân viên đồng thời 2'),
      employeeIds: ['employee-1'],
    };

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post('/stores/store-1/shift-schedules')
        .send(firstPayload),
      request(app.getHttpServer())
        .post('/stores/store-1/shift-schedules')
        .send(secondPayload),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 400]);
    expect(database.state.shifts).toHaveLength(1);
    expect(database.state.assignments).toHaveLength(3);
    expect(
      database.state.assignments.every(
        (assignment) => assignment.employeeId === 'employee-1',
      ),
    ).toBe(true);
  });

  it('rolls back the whole operation if slot persistence fails', async () => {
    database.failNextSlotSave = true;

    await request(app.getHttpServer())
      .post('/stores/store-1/shift-schedules')
      .send(createPayload('Ca rollback'))
      .expect(500);

    expect(database.state.shifts).toHaveLength(0);
    expect(database.state.cycles).toHaveLength(0);
    expect(database.state.slots).toHaveLength(0);
  });
});

describe('Unified shift schedule authentication boundary (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [StoresController],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => 'shift-schedule-e2e-secret') },
        },
        {
          provide: StoresService,
          useValue: { createShiftSchedule: jest.fn() },
        },
        { provide: AccountsService, useValue: {} },
        { provide: MailService, useValue: {} },
        { provide: ShiftEndWorkflowService, useValue: {} },
        {
          provide: getQueueToken('attendance-background'),
          useValue: { add: jest.fn() },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => app?.close());

  it.each([
    ['missing', undefined],
    ['invalid', 'Bearer not-a-jwt'],
  ])('returns 401 for %s authentication', async (_label, authorization) => {
    const call = request(app.getHttpServer()).post(
      '/stores/store-1/shift-schedules',
    );
    if (authorization) call.set('Authorization', authorization);
    await call.send({}).expect(401);
  });
});
