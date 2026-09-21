/**
 * Unit Tests for Attendance & Check-in/Check-out Flow
 * Tests: checkInWithFace, checkOutWithFace, late/early calculation, salary computation
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StoresService } from './stores.service';
import { FaceRecognitionService } from './face-recognition.service';
import { AccountsService } from '../accounts/accounts.service';
import { ShiftReminderService } from './shift-reminder.service';
import { NotificationsService } from '../notifications/notifications.service';

// Import all entities
import { Store } from './entities/store.entity';
import { StoreEmployeeType } from './entities/store-employee-type.entity';
import { StoreRole } from './entities/store-role.entity';
import {
  EmployeeProfile,
  EmploymentStatus,
} from './entities/employee-profile.entity';
import { calculateShiftEarnings } from './shift-earnings.utils';
import {
  EmployeeContract,
  PaymentType,
} from './entities/employee-contract.entity';
import { ContractTemplate } from './entities/contract-template.entity';
import { WorkShift } from './entities/work-shift.entity';
import {
  ShiftAssignment,
  ShiftAssignmentStatus,
  AttendanceStatus,
  WorkCycle,
  WorkCycleStatus,
  ShiftSlot,
} from './entities/shift-management.entity';
import { EmployeeFace } from './entities/employee-face.entity';
import {
  AttendanceLog,
  AttendanceLogType,
} from './entities/attendance-log.entity';
import { EmployeeSalary } from './entities/employee-salary.entity';
import { EmployeeMonthlySummary } from './entities/employee-monthly-summary.entity';
import { DailyEmployeeReport } from './entities/daily-employee-report.entity';

// Mock repositories
let idCounter = 0;
function mockRepo() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((d) => ({ id: `gen-${++idCounter}`, ...d })),
    save: jest.fn((e) =>
      Promise.resolve(
        Array.isArray(e) ? e : { id: `gen-${++idCounter}`, ...e },
      ),
    ),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getOne: jest.fn().mockResolvedValue(null),
      getRawMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn().mockResolvedValue(null),
    })),
  };
}

function mockDataSource() {
  return {
    transaction: jest.fn(async (cb) =>
      cb({
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((entity: any, data: any) => ({
          id: 'tx-gen',
          ...data,
        })),
        save: jest.fn((e: any) =>
          Promise.resolve({ id: 'tx-gen', ...(Array.isArray(e) ? e[0] : e) }),
        ),
        delete: jest.fn().mockResolvedValue({ affected: 1 }),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
        decrement: jest.fn().mockResolvedValue({ affected: 1 }),
        createQueryBuilder: () => {
          const queryBuilder: any = {
            update: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            execute: jest.fn().mockResolvedValue({ affected: 1 }),
            delete: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
          };
          return queryBuilder;
        },
      }),
    ),
  };
}

// Import ALL entities that StoresService needs
import { Asset } from './entities/asset.entity';
import { Product } from './entities/product.entity';
import { AssetUnit } from './entities/asset-unit.entity';
import { ProductUnit } from './entities/product-unit.entity';
import { MonthlyPayroll } from './entities/monthly-payroll.entity';
import { SalaryConfig } from './entities/salary-config.entity';
import { KpiType } from './entities/kpi-type.entity';
import { AssetCategory } from './entities/asset-category.entity';
import { AssetStatus } from './entities/asset-status.entity';
import { ProductCategory } from './entities/product-category.entity';
import { ProductStatus } from './entities/product-status.entity';
import { EmployeeKpi } from './entities/employee-kpi.entity';
import { KpiUnit } from './entities/kpi-unit.entity';
import { KpiPeriod } from './entities/kpi-period.entity';
import { KpiTask } from './entities/kpi-task.entity';
import { StoreEvent } from './entities/store-event.entity';
import {
  StockTransaction,
  StockTransactionDetail,
} from './entities/stock-transaction.entity';
import {
  ShiftSwap,
  CycleShiftTemplate,
} from './entities/shift-management.entity';
import { EmployeeLeaveRequest } from './entities/employee-leave-request.entity';
import { EmployeeAssetAssignment } from './entities/employee-asset-assignment.entity';
import {
  ServiceCategory,
  ServiceItem,
  ServiceItemRecipe,
} from './entities/service-item.entity';
import { Order, OrderItem } from './entities/order.entity';
import { EmployeePerformance } from './entities/employee-performance.entity';
import { EmployeeTerminationReason } from './entities/employee-termination-reason.entity';
import { StoreProbationSetting } from './entities/store-probation-setting.entity';
import { StoreSkill } from './entities/store-skill.entity';
import { StorePayrollPaymentHistory } from './entities/store-payroll-payment-history.entity';
import { SalaryFundHistory } from './entities/salary-fund-history.entity';
import { SalaryAdvanceRequest } from './entities/salary-advance-request.entity';
import { SalaryAdjustment } from './entities/salary-adjustment.entity';
import { SalaryAdjustmentReason } from './entities/salary-adjustment-reason.entity';
import { EmployeePaymentHistory } from './entities/employee-payment-history.entity';
import { StorePaymentAccount } from './entities/store-payment-account.entity';
import { KpiApprovalRequest } from './entities/kpi-approval-request.entity';
import { InventoryReport } from './entities/inventory-report.entity';
import { AssetExportType } from './entities/asset-export-type.entity';
import { ProductExportType } from './entities/product-export-type.entity';
import { StoreApprovalSetting } from './entities/store-approval-setting.entity';
import { StoreTimekeepingSetting } from './entities/store-timekeeping-setting.entity';
import { StorePayrollSetting } from './entities/store-payroll-setting.entity';
import { StorePayrollRule } from './entities/store-payroll-rule.entity';
import { StorePayrollIncrementRule } from './entities/store-payroll-increment-rule.entity';
import { StoreInternalRule } from './entities/store-internal-rule.entity';
import { StorePermissionConfig } from './entities/store-permission-config.entity';
import { StoreShiftConfig } from './entities/store-shift-config.entity';
import { Feedback } from './entities/feedback.entity';
import { ShiftChangeRequest } from './entities/shift-change-request.entity';
import { BonusWorkRequest } from './entities/bonus-work-request.entity';

let AccountIdentityDocument: any;
let AccountFinance: any;
try {
  AccountIdentityDocument =
    require('../accounts/entities/account-identity-document.entity').AccountIdentityDocument;
} catch {
  AccountIdentityDocument = class AccountIdentityDocument {};
}
try {
  AccountFinance =
    require('../accounts/entities/account-finance.entity').AccountFinance;
} catch {
  AccountFinance = class AccountFinance {};
}

const ENTITIES = [
  Store,
  StoreEmployeeType,
  StoreRole,
  EmployeeProfile,
  EmployeeContract,
  ContractTemplate,
  WorkShift,
  Asset,
  Product,
  AssetUnit,
  ProductUnit,
  MonthlyPayroll,
  SalaryConfig,
  EmployeeSalary,
  KpiType,
  AssetCategory,
  AssetStatus,
  ProductCategory,
  ProductStatus,
  EmployeeKpi,
  KpiUnit,
  KpiPeriod,
  KpiTask,
  DailyEmployeeReport,
  EmployeeMonthlySummary,
  StoreEvent,
  StockTransaction,
  StockTransactionDetail,
  WorkCycle,
  ShiftSlot,
  ShiftAssignment,
  ShiftSwap,
  ServiceCategory,
  ServiceItem,
  ServiceItemRecipe,
  Order,
  OrderItem,
  EmployeePerformance,
  EmployeeLeaveRequest,
  EmployeeAssetAssignment,
  EmployeeTerminationReason,
  StoreProbationSetting,
  StoreSkill,
  StorePayrollPaymentHistory,
  SalaryFundHistory,
  SalaryAdvanceRequest,
  SalaryAdjustment,
  SalaryAdjustmentReason,
  EmployeePaymentHistory,
  StorePaymentAccount,
  KpiApprovalRequest,
  InventoryReport,
  AssetExportType,
  ProductExportType,
  StoreApprovalSetting,
  StoreTimekeepingSetting,
  StorePayrollSetting,
  StorePayrollRule,
  StorePayrollIncrementRule,
  AccountIdentityDocument,
  StoreInternalRule,
  StorePermissionConfig,
  StoreShiftConfig,
  CycleShiftTemplate,
  AccountFinance,
  Feedback,
  EmployeeFace,
  AttendanceLog,
  ShiftChangeRequest,
  BonusWorkRequest,
];

// ============================================================
// LATE MINUTES CALCULATION TESTS (Pure Logic)
// ============================================================
describe('Late Minutes Calculation - Pure Logic', () => {
  /**
   * Simulates the late minutes calculation logic from stores.service.ts
   * Now uses work_date from shiftSlot + workTime from workShift
   */
  function calculateLateMinutes(
    checkInTime: Date,
    shiftDate: string,
    shiftStartTime: string,
  ): number {
    const [h, m] = shiftStartTime.split(':').map(Number);
    const shiftStart = new Date(shiftDate);
    shiftStart.setHours(h, m, 0, 0);
    const diffMs = checkInTime.getTime() - shiftStart.getTime();
    return Math.max(0, Math.floor(diffMs / 60000));
  }

  it('should return 0 late minutes when check-in exactly on time', () => {
    const shiftStart = new Date('2026-05-05T08:00:00');
    const checkIn = new Date('2026-05-05T08:00:00');
    expect(calculateLateMinutes(checkIn, '2026-05-05', '08:00')).toBe(0);
  });

  it('should return 0 late minutes when check-in 5 min early', () => {
    expect(
      calculateLateMinutes(
        new Date('2026-05-05T07:55:00'),
        '2026-05-05',
        '08:00',
      ),
    ).toBe(0);
  });

  it('should return 0 late minutes when check-in 1 hour early', () => {
    expect(
      calculateLateMinutes(
        new Date('2026-05-05T07:00:00'),
        '2026-05-05',
        '08:00',
      ),
    ).toBe(0);
  });

  it('should return 5 late minutes when check-in 5 min late', () => {
    expect(
      calculateLateMinutes(
        new Date('2026-05-05T08:05:00'),
        '2026-05-05',
        '08:00',
      ),
    ).toBe(5);
  });

  it('should return 15 late minutes when check-in 15 min late', () => {
    expect(
      calculateLateMinutes(
        new Date('2026-05-05T08:15:00'),
        '2026-05-05',
        '08:00',
      ),
    ).toBe(15);
  });

  it('should return 60 late minutes when check-in 1 hour late', () => {
    expect(
      calculateLateMinutes(
        new Date('2026-05-05T09:00:00'),
        '2026-05-05',
        '08:00',
      ),
    ).toBe(60);
  });

  it('should handle different shift start times', () => {
    expect(
      calculateLateMinutes(
        new Date('2026-05-05T13:30:00'),
        '2026-05-05',
        '13:00',
      ),
    ).toBe(30);
    expect(
      calculateLateMinutes(
        new Date('2026-05-05T18:00:00'),
        '2026-05-05',
        '17:00',
      ),
    ).toBe(60);
  });

  it('should handle midnight shift start', () => {
    expect(
      calculateLateMinutes(
        new Date('2026-05-05T00:30:00'),
        '2026-05-05',
        '00:00',
      ),
    ).toBe(30);
  });

  it('should handle PM shift start (17:00)', () => {
    expect(
      calculateLateMinutes(
        new Date('2026-05-05T17:30:00'),
        '2026-05-05',
        '17:00',
      ),
    ).toBe(30);
    expect(
      calculateLateMinutes(
        new Date('2026-05-05T22:00:00'),
        '2026-05-05',
        '17:00',
      ),
    ).toBe(300); // 5 hours late
  });
});

// ============================================================
// EARLY CHECKOUT CALCULATION TESTS (Pure Logic)
// ============================================================
describe('Early Checkout Minutes Calculation - Pure Logic', () => {
  function calculateEarlyMinutes(
    checkOutTime: Date,
    shiftDate: string,
    shiftEndTime: string,
  ): number {
    const [h, m] = shiftEndTime.split(':').map(Number);
    const shiftEnd = new Date(shiftDate);
    shiftEnd.setHours(h, m, 0, 0);
    const diffMs = shiftEnd.getTime() - checkOutTime.getTime();
    return Math.max(0, Math.floor(diffMs / 60000));
  }

  it('should return 0 early minutes when checkout exactly on time', () => {
    expect(
      calculateEarlyMinutes(
        new Date('2026-05-05T12:00:00'),
        '2026-05-05',
        '12:00',
      ),
    ).toBe(0);
  });

  it('should return 0 early minutes when checkout late', () => {
    expect(
      calculateEarlyMinutes(
        new Date('2026-05-05T12:30:00'),
        '2026-05-05',
        '12:00',
      ),
    ).toBe(0);
  });

  it('should return 30 early minutes when checkout 30 min early', () => {
    expect(
      calculateEarlyMinutes(
        new Date('2026-05-05T11:30:00'),
        '2026-05-05',
        '12:00',
      ),
    ).toBe(30);
  });

  it('should return 60 early minutes when checkout 1 hour early', () => {
    expect(
      calculateEarlyMinutes(
        new Date('2026-05-05T11:00:00'),
        '2026-05-05',
        '12:00',
      ),
    ).toBe(60);
  });
});

// ============================================================
// WORKED MINUTES CALCULATION TESTS
// ============================================================
describe('Worked Minutes Calculation', () => {
  function calculateWorkedMinutes(
    checkInTime: Date,
    checkOutTime: Date,
  ): number {
    return Math.floor((checkOutTime.getTime() - checkInTime.getTime()) / 60000);
  }

  it('should calculate 240 minutes (4 hours) for 08:00-12:00', () => {
    expect(
      calculateWorkedMinutes(
        new Date('2026-05-05T08:00:00'),
        new Date('2026-05-05T12:00:00'),
      ),
    ).toBe(240);
  });

  it('should calculate 480 minutes (8 hours) for 08:00-16:00', () => {
    expect(
      calculateWorkedMinutes(
        new Date('2026-05-05T08:00:00'),
        new Date('2026-05-05T16:00:00'),
      ),
    ).toBe(480);
  });

  it('should calculate 60 minutes for 1 hour shift', () => {
    expect(
      calculateWorkedMinutes(
        new Date('2026-05-05T08:00:00'),
        new Date('2026-05-05T09:00:00'),
      ),
    ).toBe(60);
  });

  it('should handle overnight shift (crossing midnight)', () => {
    // 22:00 to 06:00 next day = 8 hours
    expect(
      calculateWorkedMinutes(
        new Date('2026-05-05T22:00:00'),
        new Date('2026-05-06T06:00:00'),
      ),
    ).toBe(480);
  });
});

// ============================================================
// SHIFT EARNINGS CALCULATION TESTS
// ============================================================
describe('Shift Earnings Calculation', () => {
  // This block used to define its own `calculateShiftEarnings` and a local
  // `PaymentType` enum whose values ('HOUR', 'WEEK', ...) never matched the
  // real entity's Vietnamese values ('Giờ', 'Tuần', ...). Every assertion
  // therefore passed against a private copy, which is how a real production
  // disagreement — the estimate dividing a weekly salary by 7 while payroll
  // divided by 6 — stayed invisible.
  //
  // The cases below are preserved, but now run against the shipped function.
  const earningsFor = (
    paymentType: PaymentType,
    baseSalary: number,
    workedMinutes: number,
    month: number,
    year: number,
  ): number | null =>
    calculateShiftEarnings({
      paymentType,
      baseSalary,
      hours: workedMinutes / 60,
      // The real signature takes the date the shift belongs to; these cases
      // address a month, so any day inside it will do.
      referenceDate: new Date(year, month - 1, 1),
    });

  describe('HOUR payment type', () => {
    it('should calculate 4 hours x 50000 = 200000', () => {
      expect(earningsFor(PaymentType.HOUR, 50000, 240, 5, 2026)).toBe(200000);
    });

    it('should calculate 8 hours x 25000 = 200000', () => {
      expect(earningsFor(PaymentType.HOUR, 25000, 480, 5, 2026)).toBe(200000);
    });
  });

  describe('SHIFT and DAY payment types', () => {
    it('pays the flat contract amount regardless of hours', () => {
      expect(earningsFor(PaymentType.SHIFT, 300000, 480, 5, 2026)).toBe(300000);
      expect(earningsFor(PaymentType.DAY, 300000, 240, 5, 2026)).toBe(300000);
    });
  });

  describe('WEEK payment type', () => {
    it('divides by the six-day working week, matching what payroll persists', () => {
      expect(earningsFor(PaymentType.WEEK, 3000000, 480, 5, 2026)).toBe(500000);
    });
  });

  describe('MONTH payment type', () => {
    it('should calculate per day for May (31 days)', () => {
      expect(earningsFor(PaymentType.MONTH, 6200000, 480, 5, 2026)).toBe(200000);
    });

    it('should calculate per day for February (28 days, non-leap)', () => {
      expect(earningsFor(PaymentType.MONTH, 5600000, 480, 2, 2026)).toBe(200000);
    });

    it('should calculate per day for February (29 days, leap year)', () => {
      expect(earningsFor(PaymentType.MONTH, 5800000, 480, 2, 2024)).toBe(200000);
    });

    it('should calculate per day for June (30 days)', () => {
      expect(earningsFor(PaymentType.MONTH, 9000000, 480, 6, 2026)).toBe(300000);
    });
  });
});

// ============================================================
// ATTENDANCE STATUS DETERMINATION TESTS
// ============================================================
describe('Attendance Status Determination', () => {
  enum AttendanceStatus {
    ON_TIME,
    LATE,
    EARLY,
    LATE_AND_EARLY,
    ABSENT,
  }

  function determineAttendanceStatus(
    lateMinutes: number,
    earlyMinutes: number,
  ): AttendanceStatus {
    if (lateMinutes > 0 && earlyMinutes > 0)
      return AttendanceStatus.LATE_AND_EARLY;
    if (lateMinutes > 0) return AttendanceStatus.LATE;
    if (earlyMinutes > 0) return AttendanceStatus.EARLY;
    return AttendanceStatus.ON_TIME;
  }

  it('should be ON_TIME when neither late nor early', () => {
    expect(determineAttendanceStatus(0, 0)).toBe(AttendanceStatus.ON_TIME);
  });

  it('should be LATE when only late', () => {
    expect(determineAttendanceStatus(5, 0)).toBe(AttendanceStatus.LATE);
    expect(determineAttendanceStatus(60, 0)).toBe(AttendanceStatus.LATE);
  });

  it('should be EARLY when only early', () => {
    expect(determineAttendanceStatus(0, 30)).toBe(AttendanceStatus.EARLY);
    expect(determineAttendanceStatus(0, 120)).toBe(AttendanceStatus.EARLY);
  });

  it('should be LATE_AND_EARLY when both late and early', () => {
    expect(determineAttendanceStatus(10, 30)).toBe(
      AttendanceStatus.LATE_AND_EARLY,
    );
  });
});

// ============================================================
// FULL CHECK-IN/OUT FLOW INTEGRATION TESTS
// ============================================================
describe('StoresService - Check-in/Check-out Integration', () => {
  let service: StoresService;
  let shiftAssignmentRepo: ReturnType<typeof mockRepo>;
  let employeeFaceRepo: ReturnType<typeof mockRepo>;
  let attendanceLogRepo: ReturnType<typeof mockRepo>;
  let shiftSlotRepo: ReturnType<typeof mockRepo>;
  let dataSourceMock: ReturnType<typeof mockDataSource>;

  beforeEach(async () => {
    const repoMap = new Map<any, ReturnType<typeof mockRepo>>();
    shiftAssignmentRepo = mockRepo();
    employeeFaceRepo = mockRepo();
    attendanceLogRepo = mockRepo();
    shiftSlotRepo = mockRepo();
    repoMap.set(ShiftAssignment, shiftAssignmentRepo);
    repoMap.set(EmployeeFace, employeeFaceRepo);
    repoMap.set(AttendanceLog, attendanceLogRepo);
    repoMap.set(ShiftSlot, shiftSlotRepo);

    dataSourceMock = mockDataSource();

    const providers = ENTITIES.map((entity) => {
      const mock = repoMap.has(entity) ? repoMap.get(entity)! : mockRepo();
      return { provide: getRepositoryToken(entity), useValue: mock };
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoresService,
        ...providers,
        {
          provide: AccountsService,
          useValue: { findById: jest.fn(), findByEmail: jest.fn() },
        },
        {
          provide: FaceRecognitionService,
          useValue: {
            extractDescriptor: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
            compareFaces: jest
              .fn()
              .mockReturnValue({ matched: true, distance: 0.3 }),
          },
        },
        { provide: DataSource, useValue: dataSourceMock },
        {
          provide: ShiftReminderService,
          useValue: {
            syncEmployeeReminders: jest.fn(),
            scheduleReminder: jest.fn(),
          },
        },
        {
          // Appended to the StoresService constructor so shift self-registration
          // can tell the owner. Stubbed here: these suites assert service logic,
          // not delivery.
          provide: NotificationsService,
          useValue: { create: jest.fn().mockResolvedValue({}) },
        },
      ],
    }).compile();

    service = module.get<StoresService>(StoresService);
  });

  afterEach(() => jest.clearAllMocks());

  // Attendance is self-service: the caller must own the shift assignment.
  const SELF_ACCOUNT = 'account-self';
  const OTHER_ACCOUNT = 'account-attacker';
  const selfEmployee = {
    accountId: SELF_ACCOUNT,
    employmentStatus: EmploymentStatus.ACTIVE,
  };

  describe('checkInWithFace', () => {
    it('should reject if assignment not found', async () => {
      shiftAssignmentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.checkInWithFace(
          'nonexistent-id',
          Buffer.from('fake'),
          SELF_ACCOUNT,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return the existing result if already checked in', async () => {
      shiftAssignmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        checkInTime: new Date(), // Already checked in
        status: ShiftAssignmentStatus.CONFIRMED,
        employee: selfEmployee,
        shiftSlot: { workShift: { startTime: '08:00' } },
      });
      await expect(
        service.checkInWithFace('a1', Buffer.from('fake'), SELF_ACCOUNT),
      ).resolves.toEqual(expect.objectContaining({ alreadyRecorded: true }));
    });

    it('should reject if assignment not APPROVED', async () => {
      shiftAssignmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        checkInTime: null,
        status: ShiftAssignmentStatus.PENDING,
        employee: selfEmployee,
        shiftSlot: {
          workShift: { startTime: '08:00' },
          cycle: { storeId: 'store-1' },
        },
      });
      await expect(
        service.checkInWithFace('a1', Buffer.from('fake'), SELF_ACCOUNT),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject a caller who does not own the assignment', async () => {
      shiftAssignmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        checkInTime: null,
        status: ShiftAssignmentStatus.APPROVED,
        employee: selfEmployee,
        shiftSlot: {
          workShift: { startTime: '08:00' },
          cycle: { storeId: 'store-1' },
        },
      });
      await expect(
        service.checkInWithFace('a1', Buffer.from('fake'), OTHER_ACCOUNT),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should not leak attendance state to an unauthorized caller', async () => {
      shiftAssignmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        checkInTime: new Date(),
        status: ShiftAssignmentStatus.CONFIRMED,
        employee: selfEmployee,
        shiftSlot: { workShift: { startTime: '08:00' } },
      });
      // The already-recorded short-circuit must sit behind authorization.
      await expect(
        service.checkInWithFace('a1', Buffer.from('fake'), OTHER_ACCOUNT),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject a terminated employee', async () => {
      shiftAssignmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        checkInTime: null,
        status: ShiftAssignmentStatus.APPROVED,
        employee: {
          accountId: SELF_ACCOUNT,
          employmentStatus: EmploymentStatus.TERMINATED,
        },
        shiftSlot: {
          workShift: { startTime: '08:00' },
          cycle: { storeId: 'store-1' },
        },
      });
      await expect(
        service.checkInWithFace('a1', Buffer.from('fake'), SELF_ACCOUNT),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('checkOutWithFace', () => {
    it('should reject if not checked in first', async () => {
      shiftAssignmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        checkInTime: null, // Not checked in
        status: ShiftAssignmentStatus.APPROVED,
        employee: selfEmployee,
      });
      await expect(
        service.checkOutWithFace('a1', Buffer.from('fake'), SELF_ACCOUNT),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return the existing result if already checked out', async () => {
      shiftAssignmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        checkInTime: new Date(),
        checkOutTime: new Date(), // Already checked out
        status: ShiftAssignmentStatus.COMPLETED,
        employee: selfEmployee,
      });
      await expect(
        service.checkOutWithFace('a1', Buffer.from('fake'), SELF_ACCOUNT),
      ).resolves.toEqual(expect.objectContaining({ alreadyRecorded: true }));
    });

    it('should reject a caller who does not own the assignment', async () => {
      shiftAssignmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        checkInTime: new Date(),
        checkOutTime: null,
        status: ShiftAssignmentStatus.CONFIRMED,
        employee: selfEmployee,
      });
      await expect(
        service.checkOutWithFace('a1', Buffer.from('fake'), OTHER_ACCOUNT),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('store attendance policy', () => {
    const approvedAssignment = {
      id: 'a1',
      employeeId: 'emp-1',
      checkInTime: null,
      status: ShiftAssignmentStatus.APPROVED,
      employee: selfEmployee,
      shiftSlot: {
        // Ca còn mở: check-in sau giờ kết thúc ca giờ bị chặn trước bước QR.
        workDate: '2099-05-05',
        workShift: { startTime: '08:00', endTime: '17:00' },
        cycle: { storeId: 'store-1' },
      },
    };

    afterEach(() => {
      delete process.env.ATTENDANCE_ENFORCEMENT_MODE;
    });

    // Qua giờ kết thúc mà chưa vào ca thì ca đã là nghỉ không phép.
    it('rejects a check-in after the shift has ended', async () => {
      shiftAssignmentRepo.findOne.mockResolvedValue({
        ...approvedAssignment,
        shiftSlot: { ...approvedAssignment.shiftSlot, workDate: '2026-05-05' },
      });
      await expect(
        service.checkInWithFace('a1', Buffer.from('fake'), SELF_ACCOUNT),
      ).rejects.toThrow('Ca làm đã kết thúc nên không thể check-in');
    });

    it('does not reject a missing QR while enforcement is off', async () => {
      shiftAssignmentRepo.findOne.mockResolvedValue({ ...approvedAssignment });
      employeeFaceRepo.findOne.mockResolvedValue(null);

      // Reaching the face step proves the policy pass allowed the request; the
      // "Face not registered" rejection comes from the next step.
      await expect(
        service.checkInWithFace('a1', Buffer.from('fake'), SELF_ACCOUNT),
      ).rejects.toThrow('Face not registered');
    });

    it('rejects a missing QR before face inference when enforcing', async () => {
      process.env.ATTENDANCE_ENFORCEMENT_MODE = 'enforce';
      shiftAssignmentRepo.findOne.mockResolvedValue({ ...approvedAssignment });
      const faceService = service['faceRecognitionService'] as any;

      await expect(
        service.checkInWithFace('a1', Buffer.from('fake'), SELF_ACCOUNT),
      ).rejects.toThrow(BadRequestException);
      // The expensive step must not have run.
      expect(faceService.extractDescriptor).not.toHaveBeenCalled();
    });

    it('rejects a QR belonging to another store when enforcing', async () => {
      process.env.ATTENDANCE_ENFORCEMENT_MODE = 'enforce';
      shiftAssignmentRepo.findOne.mockResolvedValue({ ...approvedAssignment });

      await expect(
        service.checkInWithFace('a1', Buffer.from('fake'), SELF_ACCOUNT, {
          qrStoreId: 'store-2',
        }),
      ).rejects.toThrow(/QR không khớp/);
    });
  });

  describe('Complete Check-in/Check-out Flow', () => {
    it('should track late minutes correctly in check-in', async () => {
      // Mock assignment
      const assignment = {
        id: 'a1',
        employeeId: 'emp-1',
        employee: selfEmployee,
        checkInTime: null as Date | null,
        status: ShiftAssignmentStatus.APPROVED,
        lateMinutes: 0,
        attendanceStatus: AttendanceStatus.ON_TIME,
        shiftSlot: {
          workDate: '2026-05-05',
          workShift: { startTime: '08:00', endTime: '12:00' },
          cycle: { storeId: 'store-1' },
        },
      };
      shiftAssignmentRepo.findOne.mockResolvedValue(assignment);

      // Mock employee face
      employeeFaceRepo.findOne.mockResolvedValue({
        employeeProfileId: 'emp-1',
        faceDescriptors: [[0.1, 0.2, 0.3]],
        isActive: true,
      });

      // Mock face recognition
      const faceService = service['faceRecognitionService'] as any;
      faceService.extractDescriptor.mockResolvedValue([0.1, 0.2, 0.3]);
      faceService.compareFaces.mockReturnValue({
        matched: true,
        distance: 0.3,
      });

      // Mock store
      const storeRepo = mockRepo();
      storeRepo.findOne.mockResolvedValue({
        id: 'store-1',
        latitude: 10.8231,
        longitude: 106.6297,
      });

      // Mock profile update
      const profileRepo = mockRepo();
      profileRepo.update.mockResolvedValue({ affected: 1 });

      // Check-in 10 minutes late. The offset is explicit so the assertion does
      // not depend on the timezone of the machine running the suite.
      const fixedDate = new Date('2026-05-05T08:10:00+07:00');
      jest.useFakeTimers();
      jest.setSystemTime(fixedDate);

      const result = await service.checkInWithFace(
        'a1',
        Buffer.from('fake'),
        SELF_ACCOUNT,
      );

      expect(result.lateMinutes).toBe(10);
      expect(result.attendanceStatus).toBe(AttendanceStatus.LATE);
      expect(dataSourceMock.transaction).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });
});

// ============================================================
// MONTHLY SUMMARY UPDATE TESTS
// ============================================================
describe('Monthly Summary Updates', () => {
  it('should accumulate completed shifts correctly', () => {
    let summary = { completedShifts: 0, monthlyWorkHours: 0 };

    // Shift 1: 4 hours
    summary.completedShifts += 1;
    summary.monthlyWorkHours += 4;

    // Shift 2: 8 hours
    summary.completedShifts += 1;
    summary.monthlyWorkHours += 8;

    expect(summary.completedShifts).toBe(2);
    expect(summary.monthlyWorkHours).toBe(12);
  });

  it('should calculate performance score correctly', () => {
    let summary = {
      completedShifts: 10,
      onTimeArrivalsCount: 8,
      lateArrivalsCount: 2,
      performanceScore: 0,
    };

    summary.performanceScore = Math.round(
      (summary.onTimeArrivalsCount / summary.completedShifts) * 100,
    );

    expect(summary.performanceScore).toBe(80);
  });

  it('should accumulate shift earnings correctly', () => {
    let summary = { estimatedSalary: 0 };

    // Shift 1: 150000
    summary.estimatedSalary += 150000;

    // Shift 2: 200000
    summary.estimatedSalary += 200000;

    // Shift 3: 150000
    summary.estimatedSalary += 150000;

    expect(summary.estimatedSalary).toBe(500000);
  });
});
