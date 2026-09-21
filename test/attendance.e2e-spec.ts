import { CanActivate, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { StoresController } from '../src/modules/stores/stores.controller';
import { StoresService } from '../src/modules/stores/stores.service';
import { StoreAccessGuard } from '../src/modules/stores/guards/store-access.guard';
import { StoreResourceAccessGuard } from '../src/modules/stores/guards/store-resource-access.guard';
import { AccountsService } from '../src/modules/accounts/accounts.service';
import { MailService } from '../src/modules/mail/mail.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { AttendanceBackgroundProcessor } from '../src/modules/stores/attendance-background.processor';
import { FaceRecognitionService } from '../src/modules/stores/face-recognition.service';
import { ShiftEndWorkflowService } from '../src/modules/stores/shift-end-workflow.service';
import { PaymentType } from '../src/modules/stores/entities/employee-contract.entity';
import {
  AttendanceStatus,
  ShiftAssignmentStatus,
} from '../src/modules/stores/entities/shift-management.entity';
import { EmploymentStatus } from '../src/modules/stores/entities/employee-profile.entity';

jest.mock('uuid', () => ({ v4: () => 'test-upload-id' }));

// Attendance is self-service, so every call is made as the assignment's owner.
const TEST_ACCOUNT_ID = 'account-1';

function createConcurrentAttendanceService(mode: 'check-in' | 'check-out') {
  const assignment: any = {
    id: 'assignment-1',
    employeeId: 'employee-1',
    status:
      mode === 'check-in'
        ? ShiftAssignmentStatus.APPROVED
        : ShiftAssignmentStatus.CONFIRMED,
    checkInTime:
      mode === 'check-out' ? new Date(Date.now() - 60 * 60 * 1000) : null,
    checkOutTime: null,
    lateMinutes: 0,
    earlyMinutes: 0,
    workedMinutes: 0,
    attendanceStatus: AttendanceStatus.ON_TIME,
    shiftSlot: {
      workShift: { startTime: '00:00', endTime: '23:59' },
      cycle: { storeId: 'store-1' },
    },
    employee: {
      accountId: TEST_ACCOUNT_ID,
      employmentStatus: EmploymentStatus.ACTIVE,
    },
  };
  const logs: any[] = [];
  const service = Object.create(StoresService.prototype) as any;
  service.logger = { warn: jest.fn(), debug: jest.fn(), log: jest.fn() };
  service.shiftAssignmentRepository = {
    findOne: jest.fn().mockImplementation(async () => ({ ...assignment })),
  };
  service.employeeFaceRepository = {
    findOne: jest.fn().mockResolvedValue({ faceDescriptors: [[0.1, 0.2]] }),
  };
  service.faceRecognitionService = {
    extractDescriptor: jest
      .fn()
      .mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve([0.1, 0.2]), 5)),
      ),
    compareFaces: jest.fn().mockReturnValue({ matched: true, distance: 0.1 }),
  };
  service.profileRepository = {
    update: jest.fn().mockResolvedValue(undefined),
  };
  service.storeRepository = { findOne: jest.fn() };
  // Store attendance policy lookups. No rows configured means the entity
  // defaults apply; enforcement stays in observation mode unless
  // ATTENDANCE_ENFORCEMENT_MODE=enforce, so these calls never reject here.
  service.timekeepingSettingRepository = {
    findOne: jest.fn().mockResolvedValue(null),
  };
  service.shiftConfigRepository = { findOne: jest.fn().mockResolvedValue(null) };
  service.appendToDailyReport = jest.fn();
  service.dataSource = {
    transaction: jest.fn(async (callback) => {
      let updateValues: Record<string, any> = {};
      const queryBuilder: any = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn((values) => {
          updateValues = values;
          return queryBuilder;
        }),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn(async () => {
          const canUpdate =
            mode === 'check-in'
              ? !assignment.checkInTime &&
                assignment.status === ShiftAssignmentStatus.APPROVED
              : !assignment.checkOutTime && !!assignment.checkInTime;
          if (!canUpdate) return { affected: 0 };
          Object.assign(assignment, updateValues);
          return { affected: 1 };
        }),
      };
      const manager = {
        createQueryBuilder: jest.fn(() => queryBuilder),
        findOne: jest.fn().mockImplementation(async () => ({ ...assignment })),
        create: jest.fn((_entity, value) => value),
        save: jest.fn(async (_entity, value) => {
          logs.push(value);
          return value;
        }),
      };
      return callback(manager);
    }),
  };
  return { service, logs };
}

describe('Attendance flow (e2e)', () => {
  let app: INestApplication;
  const queue = { add: jest.fn() };
  const storesService = {
    checkInWithFace: jest.fn(),
    checkOutWithFace: jest.fn(),
  };
  const shiftEndWorkflowService = {
    scheduleForAssignment: jest.fn().mockResolvedValue(undefined),
    markCompletedByEmployee: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const allowAll: CanActivate = {
      canActivate: (context) => {
        // Attendance routes now resolve the caller from the request principal.
        context.switchToHttp().getRequest().user = { userId: TEST_ACCOUNT_ID };
        return true;
      },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [StoresController],
      providers: [
        { provide: StoresService, useValue: storesService },
        { provide: AccountsService, useValue: {} },
        { provide: MailService, useValue: {} },
        { provide: ShiftEndWorkflowService, useValue: shiftEndWorkflowService },
        { provide: getQueueToken('attendance-background'), useValue: queue },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowAll)
      // StoresController declares two tenancy guards that resolve a store from
      // the database. This suite predates them and asserts a different concern,
      // so the tenancy boundary is stubbed open to preserve its prior scope;
      // the guards carry their own unit tests.
      .overrideGuard(StoreAccessGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(StoreResourceAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    queue.add.mockResolvedValue({ id: 'job-1' });
  });

  it('checks in with an in-memory multipart image without queueing payroll', async () => {
    storesService.checkInWithFace.mockResolvedValue({
      matched: true,
      checkInTime: new Date().toISOString(),
    });

    const response = await request(app.getHttpServer())
      .post('/stores/shift-assignments/assignment-1/check-in')
      .field('orientationNormalized', 'true')
      .attach('photo', Buffer.from('jpeg-data'), {
        filename: 'checkin.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    expect(response.body.matched).toBe(true);
    expect(storesService.checkInWithFace).toHaveBeenCalledWith(
      'assignment-1',
      expect.any(Buffer),
      TEST_ACCOUNT_ID,
      expect.objectContaining({ orientationNormalized: true }),
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('returns checkout success and queues payroll background work', async () => {
    storesService.checkOutWithFace.mockResolvedValue({
      matched: true,
      checkOutTime: new Date().toISOString(),
      payrollProcessing: true,
    });

    const startedAt = Date.now();
    const response = await request(app.getHttpServer())
      .post('/stores/shift-assignments/assignment-1/check-out')
      .field('orientationNormalized', 'true')
      .attach('photo', Buffer.from('jpeg-data'), {
        filename: 'checkout.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(response.body).toEqual(
      expect.objectContaining({ matched: true, payrollProcessing: true }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'process-checkout-payroll',
      { assignmentId: 'assignment-1' },
      expect.objectContaining({ jobId: 'checkout-payroll-assignment-1' }),
    );
  });

  it('runs queued checkout payroll through the background processor', async () => {
    const backgroundService = {
      processCheckoutPayroll: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new AttendanceBackgroundProcessor(
      backgroundService as unknown as StoresService,
    );

    await processor.process({
      name: 'process-checkout-payroll',
      data: { assignmentId: 'assignment-1' },
    } as any);

    expect(backgroundService.processCheckoutPayroll).toHaveBeenCalledWith(
      'assignment-1',
    );
  });

  it('rebuilds payroll summaries idempotently when a job is retried', async () => {
    const assignment = {
      id: 'assignment-1',
      employeeId: 'employee-1',
      status: ShiftAssignmentStatus.COMPLETED,
      checkOutTime: new Date('2026-07-11T10:00:00.000Z'),
      workedMinutes: 120,
      shiftEarnings: null as number | null,
      shiftSlot: { workDate: '2026-07-11', cycle: { storeId: 'store-1' } },
      employee: {
        contracts: [
          {
            isActive: true,
            salaryAmount: 50000,
            paymentType: PaymentType.HOUR,
          },
        ],
      },
    };
    // The month's attendance, as loaded by the shared payroll composer.
    const monthRows = [
      { ...assignment, checkInTime: new Date('2026-07-11T08:00:00.000Z') },
      ...['2026-07-08', '2026-07-09', '2026-07-10'].map((workDate, i) => ({
        id: `earlier-${i}`,
        status: ShiftAssignmentStatus.COMPLETED,
        checkInTime: new Date(`${workDate}T01:00:00.000Z`),
        workedMinutes: 280,
        lateMinutes: i === 0 ? 5 : 0,
        earlyMinutes: i === 1 ? 5 : 0,
        shiftEarnings: 233333,
        shiftSlot: { workDate },
      })),
      {
        id: 'upcoming',
        status: ShiftAssignmentStatus.APPROVED,
        checkInTime: null,
        shiftSlot: { workDate: '2099-07-30' },
      },
    ];
    const queryBuilder: any = {};
    for (const method of [
      'select',
      'addSelect',
      'where',
      'andWhere',
      'leftJoinAndSelect',
      'innerJoin',
    ]) {
      queryBuilder[method] = jest.fn().mockReturnValue(queryBuilder);
    }
    queryBuilder.getMany = jest.fn().mockResolvedValue(monthRows);
    queryBuilder.getRawOne = jest.fn().mockResolvedValue({
      completedShifts: '4',
      workedMinutes: '960',
    });
    const service = Object.create(StoresService.prototype) as any;
    service.logger = { warn: jest.fn(), debug: jest.fn(), log: jest.fn() };
    service.shiftAssignmentRepository = {
      findOne: jest.fn().mockResolvedValue(assignment),
      update: jest.fn(async (id: string, changes: any) => {
        if (id === assignment.id) Object.assign(assignment, changes);
        monthRows
          .filter((row) => row.id === id)
          .forEach((row) => Object.assign(row, changes));
      }),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    service.monthlySummaryRepository = {
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    service.payrollRuleRepository = { find: jest.fn().mockResolvedValue([]) };
    service.salaryAdjustmentRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    service.salaryAdvanceRequestRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    // No days-off config: calendar-day fallback.
    service.shiftConfigRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    service.findOrCreateMonthlyPayroll = jest
      .fn()
      .mockResolvedValue({ id: 'payroll-1' });
    const salaryTotalsQuery = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({
        estimatedPayment: '400000',
        totalBonus: '0',
        totalPenalty: '0',
      }),
    };
    const salaryRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: any) => value),
      save: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn().mockReturnValue(salaryTotalsQuery),
    };
    const payrollRepository = { update: jest.fn().mockResolvedValue(undefined) };
    service.dataSource = {
      transaction: jest.fn((callback: any) =>
        callback({
          getRepository: (entity: any) =>
            entity?.name === 'EmployeeSalary'
              ? salaryRepository
              : payrollRepository,
        }),
      ),
    };

    await service.processCheckoutPayroll('assignment-1');
    await service.processCheckoutPayroll('assignment-1');

    // HOUR: 50,000 × 2h worked.
    expect(assignment.shiftEarnings).toBe(100000);
    expect(service.monthlySummaryRepository.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        completedShifts: 4,
        monthlyWorkHours: 16,
        // 50,000 × 960 minutes / 60 (rate × hours worked, whole month).
        estimatedSalary: 800000,
        totalCompletedShifts: 4,
        totalWorkHours: 16,
      }),
      ['employeeProfileId', 'month'],
    );
    // The per-shift figure is written once; the retry sees it unchanged.
    expect(
      service.shiftAssignmentRepository.update.mock.calls.filter(
        ([id]: [string]) => id === 'assignment-1',
      ),
    ).toHaveLength(1);
    // One payslip write per job run, through the shared transactional writer.
    expect(service.dataSource.transaction).toHaveBeenCalledTimes(2);
    expect(salaryRepository.save).toHaveBeenCalledTimes(2);
  });

  it('accepts concurrent duplicate check-ins but persists only one log', async () => {
    const { service, logs } = createConcurrentAttendanceService('check-in');
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        service.checkInWithFace('assignment-1', Buffer.from('photo'), TEST_ACCOUNT_ID, {
          orientationNormalized: true,
        }),
      ),
    );

    expect(results.every((result) => result.matched)).toBe(true);
    expect(results.filter((result) => !result.alreadyRecorded)).toHaveLength(1);
    expect(logs).toHaveLength(1);
  });

  it('accepts concurrent duplicate check-outs but persists only one log', async () => {
    const { service, logs } = createConcurrentAttendanceService('check-out');
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        service.checkOutWithFace('assignment-1', Buffer.from('photo'), TEST_ACCOUNT_ID, {
          orientationNormalized: true,
        }),
      ),
    );

    expect(results.every((result) => result.matched)).toBe(true);
    expect(results.filter((result) => !result.alreadyRecorded)).toHaveLength(1);
    expect(logs).toHaveLength(1);
  });

  it('limits concurrent face inference work to the configured capacity', async () => {
    const faceService = Object.create(FaceRecognitionService.prototype) as any;
    faceService.activeInferences = 0;
    faceService.inferenceWaiters = [];
    faceService.maxConcurrentInferences = 2;
    let active = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 20 }, async () => {
        await faceService.acquireInferenceSlot();
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        faceService.releaseInferenceSlot();
      }),
    );

    expect(peak).toBe(2);
    expect(faceService.activeInferences).toBe(0);
  });
});
