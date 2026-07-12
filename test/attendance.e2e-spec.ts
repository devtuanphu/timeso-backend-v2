import { CanActivate, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { StoresController } from '../src/modules/stores/stores.controller';
import { StoresService } from '../src/modules/stores/stores.service';
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

jest.mock('uuid', () => ({ v4: () => 'test-upload-id' }));

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
    employee: {},
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
    const allowAll: CanActivate = { canActivate: () => true };
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
      shiftSlot: { cycle: { storeId: 'store-1' } },
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
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({
        completedShifts: '4',
        workedMinutes: '960',
      }),
    };
    const service = Object.create(StoresService.prototype) as any;
    service.logger = { warn: jest.fn(), debug: jest.fn(), log: jest.fn() };
    service.shiftAssignmentRepository = {
      findOne: jest.fn().mockResolvedValue(assignment),
      save: jest.fn().mockResolvedValue(assignment),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    service.monthlySummaryRepository = {
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    service.calculateEmployeeAttendanceSummary = jest.fn().mockResolvedValue({
      totalAssignedShifts: 5,
      completedShifts: 4,
      workingHours: 16,
      lateCount: 1,
      earlyCount: 1,
      absentCount: 0,
      totalShiftEarnings: 400000,
    });
    service.payrollSettingRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    service.payrollRuleRepository = { find: jest.fn().mockResolvedValue([]) };
    service.calculateBaseSalary = jest.fn().mockReturnValue(400000);
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
    service.employeeSalaryRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn().mockReturnValue(salaryTotalsQuery),
    };
    service.payrollRepository = {
      update: jest.fn().mockResolvedValue(undefined),
    };

    await service.processCheckoutPayroll('assignment-1');
    await service.processCheckoutPayroll('assignment-1');

    expect(assignment.shiftEarnings).toBe(100000);
    expect(service.monthlySummaryRepository.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        completedShifts: 4,
        monthlyWorkHours: 16,
        estimatedSalary: 400000,
        totalCompletedShifts: 4,
        totalWorkHours: 16,
      }),
      ['employeeProfileId', 'month'],
    );
    expect(service.shiftAssignmentRepository.save).toHaveBeenCalledTimes(1);
    expect(service.employeeSalaryRepository.upsert).toHaveBeenCalledTimes(2);
  });

  it('accepts concurrent duplicate check-ins but persists only one log', async () => {
    const { service, logs } = createConcurrentAttendanceService('check-in');
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        service.checkInWithFace('assignment-1', Buffer.from('photo'), {
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
        service.checkOutWithFace('assignment-1', Buffer.from('photo'), {
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
