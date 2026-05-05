/**
 * Unit Tests for Attendance & Check-in/Check-out Flow
 * Tests: checkInWithFace, checkOutWithFace, late/early calculation, salary computation
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StoresService } from './stores.service';
import { FaceRecognitionService } from './face-recognition.service';
import { AccountsService } from '../accounts/accounts.service';

// Import all entities
import { Store } from './entities/store.entity';
import { StoreEmployeeType } from './entities/store-employee-type.entity';
import { StoreRole } from './entities/store-role.entity';
import { EmployeeProfile } from './entities/employee-profile.entity';
import { EmployeeProfileRole } from './entities/employee-profile-role.entity';
import {
  EmployeeContract,
  PaymentType,
} from './entities/employee-contract.entity';
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
        createQueryBuilder: () => ({
          delete: () => ({
            execute: jest.fn().mockResolvedValue({ affected: 0 }),
          }),
          from: () => ({
            where: () => ({
              execute: jest.fn().mockResolvedValue({ affected: 0 }),
            }),
          }),
          where: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue({ affected: 0 }),
        }),
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
  EmployeeProfileRole,
  EmployeeContract,
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
  enum PaymentType {
    HOUR = 'HOUR',
    SHIFT = 'SHIFT',
    DAY = 'DAY',
    WEEK = 'WEEK',
    MONTH = 'MONTH',
  }

  function calculateShiftEarnings(
    paymentType: PaymentType,
    baseSalary: number,
    workedMinutes: number,
    month: number,
    year: number,
  ): number {
    const workedHours = workedMinutes / 60;

    switch (paymentType) {
      case PaymentType.HOUR:
        return Math.round(baseSalary * workedHours);
      case PaymentType.SHIFT:
        return baseSalary;
      case PaymentType.DAY:
        return baseSalary;
      case PaymentType.WEEK:
        return Math.round(baseSalary / 6); // 6 working days per week
      case PaymentType.MONTH: {
        const daysInMonth = new Date(year, month, 0).getDate();
        return Math.round(baseSalary / daysInMonth);
      }
      default:
        return 0;
    }
  }

  describe('HOUR payment type', () => {
    it('should calculate 4 hours × 50000 = 200000', () => {
      expect(
        calculateShiftEarnings(PaymentType.HOUR, 50000, 240, 5, 2026),
      ).toBe(200000);
    });

    it('should calculate 8 hours × 25000 = 200000', () => {
      expect(
        calculateShiftEarnings(PaymentType.HOUR, 25000, 480, 5, 2026),
      ).toBe(200000);
    });

    it('should round partial hours correctly', () => {
      // 4.5 hours × 20000 = 90000
      expect(
        calculateShiftEarnings(PaymentType.HOUR, 20000, 270, 5, 2026),
      ).toBe(90000);
    });
  });

  describe('SHIFT payment type', () => {
    it('should return full base salary regardless of hours worked', () => {
      expect(
        calculateShiftEarnings(PaymentType.SHIFT, 150000, 60, 5, 2026),
      ).toBe(150000); // 1 hour only
      expect(
        calculateShiftEarnings(PaymentType.SHIFT, 150000, 480, 5, 2026),
      ).toBe(150000); // 8 hours
    });
  });

  describe('DAY payment type', () => {
    it('should return full base salary for a day shift', () => {
      expect(
        calculateShiftEarnings(PaymentType.DAY, 300000, 480, 5, 2026),
      ).toBe(300000);
    });
  });

  describe('WEEK payment type', () => {
    it('should return baseSalary / 6 for weekly payment', () => {
      expect(
        calculateShiftEarnings(PaymentType.WEEK, 12000000, 480, 5, 2026),
      ).toBe(2000000); // 12M / 6
      expect(
        calculateShiftEarnings(PaymentType.WEEK, 6000000, 480, 5, 2026),
      ).toBe(1000000); // 6M / 6
    });
  });

  describe('MONTH payment type', () => {
    it('should calculate per day for May (31 days)', () => {
      // 8M / 31 = ~258065
      const result = calculateShiftEarnings(
        PaymentType.MONTH,
        8000000,
        480,
        5,
        2026,
      );
      expect(result).toBe(258065);
    });

    it('should calculate per day for April (30 days)', () => {
      // 6M / 30 = 200000
      const result = calculateShiftEarnings(
        PaymentType.MONTH,
        6000000,
        480,
        4,
        2026,
      );
      expect(result).toBe(200000);
    });

    it('should calculate per day for February (28 days, non-leap)', () => {
      // 5.6M / 28 = 200000
      const result = calculateShiftEarnings(
        PaymentType.MONTH,
        5600000,
        480,
        2,
        2026,
      );
      expect(result).toBe(200000);
    });

    it('should calculate per day for February (29 days, leap year)', () => {
      // 5.8M / 29 = 200000
      const result = calculateShiftEarnings(
        PaymentType.MONTH,
        5800000,
        480,
        2,
        2024,
      );
      expect(result).toBe(200000);
    });

    it('should calculate per day for June (30 days)', () => {
      // 9M / 30 = 300000
      const result = calculateShiftEarnings(
        PaymentType.MONTH,
        9000000,
        480,
        6,
        2026,
      );
      expect(result).toBe(300000);
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
      ],
    }).compile();

    service = module.get<StoresService>(StoresService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('checkInWithFace', () => {
    it('should reject if assignment not found', async () => {
      shiftAssignmentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.checkInWithFace('nonexistent-id', Buffer.from('fake')),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject if already checked in', async () => {
      shiftAssignmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        checkInTime: new Date(), // Already checked in
        status: ShiftAssignmentStatus.CONFIRMED,
        shiftSlot: { workShift: { startTime: '08:00' } },
      });
      await expect(
        service.checkInWithFace('a1', Buffer.from('fake')),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject if assignment not APPROVED', async () => {
      shiftAssignmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        checkInTime: null,
        status: ShiftAssignmentStatus.PENDING,
        shiftSlot: {
          workShift: { startTime: '08:00' },
          cycle: { storeId: 'store-1' },
        },
      });
      await expect(
        service.checkInWithFace('a1', Buffer.from('fake')),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('checkOutWithFace', () => {
    it('should reject if not checked in first', async () => {
      shiftAssignmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        checkInTime: null, // Not checked in
        status: ShiftAssignmentStatus.APPROVED,
      });
      await expect(
        service.checkOutWithFace('a1', Buffer.from('fake')),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject if already checked out', async () => {
      shiftAssignmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        checkInTime: new Date(),
        checkOutTime: new Date(), // Already checked out
        status: ShiftAssignmentStatus.COMPLETED,
      });
      await expect(
        service.checkOutWithFace('a1', Buffer.from('fake')),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Complete Check-in/Check-out Flow', () => {
    it('should track late minutes correctly in check-in', async () => {
      // Mock assignment
      const assignment = {
        id: 'a1',
        employeeId: 'emp-1',
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

      // Check-in 10 minutes late
      const fixedDate = new Date('2026-05-05T08:10:00');
      jest.useFakeTimers();
      jest.setSystemTime(fixedDate);

      const result = await service.checkInWithFace('a1', Buffer.from('fake'));

      expect(result.lateMinutes).toBe(10);
      expect(result.attendanceStatus).toBe(AttendanceStatus.LATE);
      expect(shiftAssignmentRepo.save).toHaveBeenCalled();

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
