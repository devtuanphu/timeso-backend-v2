import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccountsService } from '../src/modules/accounts/accounts.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
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
    stores: [{ id: 'store-1', ownerAccountId: 'owner-1' }],
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
  private transactionTail: Promise<void> = Promise.resolve();

  async transaction<T>(callback: (manager: any) => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const staged = structuredClone(this.state);
    const manager = this.createManager(staged);
    try {
      const result = await callback(manager);
      this.state = staged;
      return result;
    } finally {
      release();
    }
  }

  private createManager(staged: MemoryState) {
    return {
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
    };
  }
}

describe('Unified shift schedule flow (e2e)', () => {
  let app: INestApplication;
  let database: MemoryScheduleDatabase;

  beforeAll(async () => {
    database = new MemoryScheduleDatabase();
    const storesService = Object.create(
      StoresService.prototype,
    ) as StoresService;
    (storesService as any).dataSource = database;
    (storesService as any).getShiftEmployeeOptions = jest.fn(
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
    (storesService as any).scheduleReminderForAssignment = jest.fn(
      async () => undefined,
    );

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
