import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StoresService } from './stores.service';
import { AccountsService } from '../accounts/accounts.service';
import { FaceRecognitionService } from './face-recognition.service';
import { ShiftReminderService } from './shift-reminder.service';
import { Store } from './entities/store.entity';
import { StoreEmployeeType } from './entities/store-employee-type.entity';
import { StoreRole } from './entities/store-role.entity';
import {
  EmployeeProfile,
  EmploymentStatus,
} from './entities/employee-profile.entity';
import { EmployeeProfileRole } from './entities/employee-profile-role.entity';
import {
  EmployeeContract,
  PaymentType,
} from './entities/employee-contract.entity';
import { ContractTemplate } from './entities/contract-template.entity';
import { WorkShift } from './entities/work-shift.entity';
import { Asset } from './entities/asset.entity';
import { Product } from './entities/product.entity';
import { AssetUnit } from './entities/asset-unit.entity';
import { ProductUnit } from './entities/product-unit.entity';
import { MonthlyPayroll } from './entities/monthly-payroll.entity';
import { SalaryConfig } from './entities/salary-config.entity';
import { EmployeeSalary } from './entities/employee-salary.entity';
import { KpiType } from './entities/kpi-type.entity';
import { KpiUnit } from './entities/kpi-unit.entity';
import { KpiPeriod } from './entities/kpi-period.entity';
import { EmployeeKpi } from './entities/employee-kpi.entity';
import { KpiTask } from './entities/kpi-task.entity';
import { DailyEmployeeReport } from './entities/daily-employee-report.entity';
import { EmployeeMonthlySummary } from './entities/employee-monthly-summary.entity';
import { StoreEvent } from './entities/store-event.entity';
import {
  StockTransaction,
  StockTransactionDetail,
} from './entities/stock-transaction.entity';
import {
  WorkCycle,
  WorkCycleStatus,
  ShiftSlot,
  ShiftAssignment,
  ShiftAssignmentStatus,
  ShiftSwap,
  CycleShiftTemplate,
} from './entities/shift-management.entity';
import { EmployeeLeaveRequest } from './entities/employee-leave-request.entity';
import { EmployeeFace } from './entities/employee-face.entity';
import { AttendanceLog } from './entities/attendance-log.entity';
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
import { AssetCategory } from './entities/asset-category.entity';
import { AssetStatus } from './entities/asset-status.entity';
import { ProductCategory } from './entities/product-category.entity';
import { ProductStatus } from './entities/product-status.entity';
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
import { BadRequestException } from '@nestjs/common';

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

// Mock services injected into StoresService
const mockAccountsService = {
  findOne: jest.fn().mockResolvedValue(null),
  find: jest.fn().mockResolvedValue([]),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
  save: jest.fn().mockResolvedValue({ id: 'mock-account' }),
};
const mockFaceRecognitionService = {
  detectAndSaveFace: jest.fn().mockResolvedValue({ faceId: 'mock-face-id' }),
};

function mockRepo() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((d: any) => ({ id: 'gen-id', ...d })),
    save: jest.fn((e: any) =>
      Promise.resolve(Array.isArray(e) ? e : { id: 'gen-id', ...e }),
    ),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(() => {
      const qb: any = {};
      qb.where = jest.fn().mockReturnValue(qb);
      qb.andWhere = jest.fn().mockReturnValue(qb);
      qb.leftJoinAndSelect = jest.fn().mockReturnValue(qb);
      qb.leftJoin = jest.fn().mockReturnValue(qb);
      qb.innerJoin = jest.fn().mockReturnValue(qb);
      qb.orderBy = jest.fn().mockReturnValue(qb);
      qb.addOrderBy = jest.fn().mockReturnValue(qb);
      qb.select = jest.fn().mockReturnValue(qb);
      qb.limit = jest.fn().mockReturnValue(qb);
      qb.getMany = jest.fn().mockResolvedValue([]);
      qb.getRawMany = jest.fn().mockResolvedValue([]);
      qb.getRawOne = jest.fn().mockResolvedValue(null);
      qb.setLock = jest.fn().mockReturnValue(qb);
      qb.getOne = jest.fn().mockResolvedValue(null);
      return qb;
    }),
  };
}

function mockDataSource() {
  return {
    transaction: jest.fn(async (cb) =>
      cb({
        query: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((entity: any, data: any) => ({
          id: 'tx-gen-id',
          ...data,
        })),
        save: jest.fn((e: any) =>
          Promise.resolve({
            id: 'tx-gen-id',
            ...(Array.isArray(e) ? e[0] : e),
          }),
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
  CycleShiftTemplate,
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
  ContractTemplate,
];

// ============================================================
// PURE CALCULATION LOGIC TESTS (no NestJS DI)
// ============================================================

describe('Shift Registration Count - Pure Logic', () => {
  function computeSlotCount(assignments: { id: string }[], maxStaff: number) {
    const currentCount = assignments?.length || 0;
    const isFull = currentCount >= maxStaff;
    return { currentCount, isFull };
  }

  it('should return 0 count and not full when no assignments', () => {
    const result = computeSlotCount([], 5);
    expect(result.currentCount).toBe(0);
    expect(result.isFull).toBe(false);
  });

  it('should return correct count when assignments exist', () => {
    const result = computeSlotCount([{ id: '1' }, { id: '2' }, { id: '3' }], 5);
    expect(result.currentCount).toBe(3);
    expect(result.isFull).toBe(false);
  });

  it('should be full when count equals maxStaff', () => {
    const result = computeSlotCount([{ id: '1' }, { id: '2' }], 2);
    expect(result.currentCount).toBe(2);
    expect(result.isFull).toBe(true);
  });

  it('should be full when count exceeds maxStaff', () => {
    const result = computeSlotCount([{ id: '1' }, { id: '2' }, { id: '3' }], 2);
    expect(result.currentCount).toBe(3);
    expect(result.isFull).toBe(true);
  });

  it('should handle null/undefined assignments gracefully', () => {
    expect(computeSlotCount(null as any, 5).currentCount).toBe(0);
    expect(computeSlotCount(undefined as any, 5).currentCount).toBe(0);
  });

  it('should handle maxStaff edge cases', () => {
    expect(computeSlotCount([], 0).isFull).toBe(true);
    expect(computeSlotCount([], 1).isFull).toBe(false);
  });
});

// ============================================================
// STORESSERVICE INTEGRATION TESTS
// ============================================================

describe('StoresService - Shift Registration Count', () => {
  let dataSourceMock: ReturnType<typeof mockDataSource>;
  let service: StoresService;
  let repoMap: Map<any, ReturnType<typeof mockRepo>>;
  let reminderServiceMock: {
    syncEmployeeReminders: jest.Mock;
    scheduleReminder: jest.Mock;
    scheduleAssignmentReminder: jest.Mock;
  };
  const shiftSlotRepo = {
    ...mockRepo(),
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    dataSourceMock = mockDataSource();
    repoMap = new Map<any, ReturnType<typeof mockRepo>>();
    repoMap.set(ShiftSlot, shiftSlotRepo);
    reminderServiceMock = {
      syncEmployeeReminders: jest.fn(),
      scheduleReminder: jest.fn(),
      scheduleAssignmentReminder: jest.fn(),
    };

    const providers = ENTITIES.map((entity) => {
      const mock = repoMap.has(entity) ? repoMap.get(entity)! : mockRepo();
      if (!repoMap.has(entity)) repoMap.set(entity, mock);
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
            extractDescriptor: jest.fn().mockResolvedValue(null),
            compareFaces: jest.fn().mockReturnValue({}),
            detectFace: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: DataSource,
          useValue: dataSourceMock,
        },
        {
          provide: ShiftReminderService,
          useValue: reminderServiceMock,
        },
      ],
    }).compile();

    service = module.get<StoresService>(StoresService);
    repoMap.get(EmployeeProfile)!.findOne.mockResolvedValue({
      id: 'emp-1',
      accountId: 'account-1',
      storeId: 'store-1',
      employmentStatus: EmploymentStatus.ACTIVE,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getShiftSlots', () => {
    it('should return slots with currentCount and isFull', async () => {
      const mockSlots = [
        {
          id: 'slot-1',
          cycleId: 'cycle-1',
          workShiftId: 'ws-1',
          workDate: '2025-02-10',
          maxStaff: 3,
          note: null,
          workShift: {
            id: 'ws-1',
            shiftName: 'Ca sáng',
            startTime: '08:00',
            endTime: '12:00',
            defaultMaxStaff: 5,
          },
          assignments: [
            {
              id: 'a1',
              employeeId: 'e1',
              status: ShiftAssignmentStatus.APPROVED,
            },
            {
              id: 'a2',
              employeeId: 'e2',
              status: ShiftAssignmentStatus.APPROVED,
            },
          ],
        },
        {
          id: 'slot-2',
          cycleId: 'cycle-1',
          workShiftId: 'ws-2',
          workDate: '2025-02-10',
          maxStaff: 2,
          note: null,
          workShift: {
            id: 'ws-2',
            shiftName: 'Ca chiều',
            startTime: '14:00',
            endTime: '18:00',
          },
          assignments: [
            {
              id: 'a3',
              employeeId: 'e3',
              status: ShiftAssignmentStatus.PENDING,
            },
          ],
        },
      ];

      (shiftSlotRepo.find as jest.Mock).mockResolvedValue(mockSlots);

      const result = await service.getShiftSlots('cycle-1');

      expect(result).toHaveLength(2);
      expect(result[0].currentCount).toBe(2);
      expect(result[0].isFull).toBe(false);
      expect(result[1].currentCount).toBe(1);
      expect(result[1].isFull).toBe(false);
    });

    it('should return currentCount=0 for empty slots', async () => {
      const mockSlots = [
        {
          id: 'slot-empty',
          cycleId: 'cycle-1',
          workShiftId: 'ws-1',
          workDate: '2025-02-11',
          maxStaff: 5,
          workShift: {
            id: 'ws-1',
            shiftName: 'Ca tối',
            startTime: '18:00',
            endTime: '22:00',
          },
          assignments: [],
        },
      ];

      (shiftSlotRepo.find as jest.Mock).mockResolvedValue(mockSlots);

      const result = await service.getShiftSlots('cycle-1');

      expect(result).toHaveLength(1);
      expect(result[0].currentCount).toBe(0);
      expect(result[0].isFull).toBe(false);
    });

    it('should mark slot as isFull when at capacity', async () => {
      const mockSlots = [
        {
          id: 'slot-full',
          cycleId: 'cycle-1',
          workShiftId: 'ws-1',
          workDate: '2025-02-12',
          maxStaff: 2,
          workShift: {
            id: 'ws-1',
            shiftName: 'Ca đêm',
            startTime: '22:00',
            endTime: '02:00',
          },
          assignments: [
            {
              id: 'a1',
              employeeId: 'e1',
              status: ShiftAssignmentStatus.APPROVED,
            },
            {
              id: 'a2',
              employeeId: 'e2',
              status: ShiftAssignmentStatus.APPROVED,
            },
          ],
        },
      ];

      (shiftSlotRepo.find as jest.Mock).mockResolvedValue(mockSlots);

      const result = await service.getShiftSlots('cycle-1');

      expect(result[0].currentCount).toBe(2);
      expect(result[0].isFull).toBe(true);
    });

    it('should filter by date when date parameter is provided', async () => {
      (shiftSlotRepo.find as jest.Mock).mockResolvedValue([]);

      await service.getShiftSlots('cycle-1', '2025-02-10');

      expect(shiftSlotRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { cycleId: 'cycle-1', workDate: '2025-02-10' },
        }),
      );
    });

    it('should include all relations for full data', async () => {
      (shiftSlotRepo.find as jest.Mock).mockResolvedValue([]);

      await service.getShiftSlots('cycle-1');

      expect(shiftSlotRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          relations: ['workShift', 'assignments', 'assignments.employee'],
          order: { workDate: 'ASC' },
        }),
      );
    });
  });

  describe('registerToShiftSlot', () => {
    it('schedules an approved assignment only after transaction commit', async () => {
      const slot = {
        id: 'slot-1',
        cycleId: 'cycle-1',
        workShiftId: 'shift-1',
        maxStaff: 2,
        cycle: { id: 'cycle-1', storeId: 'store-1' },
      };
      shiftSlotRepo.findOne.mockResolvedValue(slot);
      repoMap.get(Store)!.findOne.mockResolvedValue({
        id: 'store-1',
        ownerAccountId: 'owner-1',
      });
      let committed = false;
      let releaseCommit!: () => void;
      let signalTransactionBodyFinished!: () => void;
      const commitGate = new Promise<void>((resolve) => {
        releaseCommit = resolve;
      });
      const transactionBodyFinished = new Promise<void>((resolve) => {
        signalTransactionBodyFinished = resolve;
      });
      reminderServiceMock.scheduleAssignmentReminder.mockImplementation(
        async () => {
          expect(committed).toBe(true);
        },
      );
      const txManager = {
        query: jest.fn(),
        createQueryBuilder: jest.fn(() => ({
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(slot),
        })),
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn(async (entityType) => {
          if (entityType === WorkCycle) {
            return {
              id: 'cycle-1',
              storeId: 'store-1',
              status: WorkCycleStatus.ACTIVE,
            };
          }
          if (entityType === WorkShift) {
            return { id: 'shift-1', defaultMaxStaff: 2 };
          }
          if (entityType === Store) {
            return { id: 'store-1', ownerAccountId: 'owner-1' };
          }
          if (entityType === EmployeeProfile) {
            return {
              id: 'employee-1',
              storeId: 'store-1',
              accountId: 'employee-account',
              employmentStatus: EmploymentStatus.ACTIVE,
            };
          }
          return null;
        }),
        create: jest.fn((_entity, value) => value),
        save: jest.fn(async (value) => ({
          id: 'assignment-1',
          ...value,
          status: ShiftAssignmentStatus.APPROVED,
        })),
      };
      dataSourceMock.transaction.mockImplementation(async (callback) => {
        const result = await callback(txManager);
        signalTransactionBodyFinished();
        await commitGate;
        committed = true;
        return result;
      });

      const registration = service.registerToShiftSlot(
        'slot-1',
        'employee-1',
        undefined,
        true,
        'owner-1',
      );
      await transactionBodyFinished;
      expect(
        reminderServiceMock.scheduleAssignmentReminder,
      ).not.toHaveBeenCalled();
      releaseCommit();

      await expect(registration).resolves.toEqual(
        expect.objectContaining({ id: 'assignment-1' }),
      );
      expect(
        reminderServiceMock.scheduleAssignmentReminder,
      ).toHaveBeenCalledWith('assignment-1');

      const loggerError = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation();
      reminderServiceMock.scheduleAssignmentReminder.mockRejectedValueOnce(
        new Error('private queue detail'),
      );
      committed = false;

      await expect(
        service.registerToShiftSlot(
          'slot-1',
          'employee-1',
          undefined,
          true,
          'owner-1',
        ),
      ).resolves.toEqual(
        expect.objectContaining({ id: 'assignment-1' }),
      );
      expect(committed).toBe(true);
      expect(loggerError).toHaveBeenCalledWith(
        'Failed to schedule registered assignment reminder',
      );
      expect(loggerError).not.toHaveBeenCalledWith(
        expect.stringContaining('private queue detail'),
      );
    });

    it('should reject registration when slot is at max capacity', async () => {
      const fullSlot = {
        id: 'slot-full',
        cycleId: 'cycle-1',
        workShiftId: 'ws-1',
        workDate: '2025-02-10',
        maxStaff: 1,
        assignments: [
          {
            id: 'existing-a1',
            employeeId: 'existing-employee',
            status: ShiftAssignmentStatus.APPROVED,
          },
        ],
        cycle: {
          id: 'cycle-1',
          storeId: 'store-1',
          status: WorkCycleStatus.ACTIVE,
          registrationDeadline: '2099-12-31',
        },
      };

      const txManager = {
        query: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
        find: jest.fn().mockResolvedValue([
          {
            id: 'existing-a1',
            employeeId: 'existing-employee',
            status: ShiftAssignmentStatus.APPROVED,
          },
        ]),
        findOne: jest.fn().mockImplementation((entityType) => {
          if (entityType === WorkCycle)
            return Promise.resolve({
              id: 'cycle-1',
              status: WorkCycleStatus.ACTIVE,
            });
          if (entityType === EmployeeProfile)
            return Promise.resolve({
              id: 'existing-employee',
              employmentStatus: EmploymentStatus.ACTIVE,
            });
          return Promise.resolve(fullSlot);
        }),
        createQueryBuilder: jest.fn(() => ({
          setLock: jest.fn().mockReturnThis(),
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          leftJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(fullSlot),
        })),
      };

      dataSourceMock.transaction.mockImplementation(async (cb) =>
        cb(txManager),
      );
      shiftSlotRepo.findOne.mockResolvedValue(fullSlot);
      repoMap.get(EmployeeProfile)!.findOne.mockResolvedValue({
        id: 'new-employee',
        accountId: 'new-account',
        storeId: 'store-1',
        employmentStatus: EmploymentStatus.ACTIVE,
      });

      await expect(
        service.registerToShiftSlot(
          'slot-full',
          'new-employee',
          undefined,
          false,
          'new-account',
        ),
      ).rejects.toThrow('Ca đã đầy người');
    });
  });

  describe('getStoreShiftSlots', () => {
    it('should return slots with currentCount and isFull via query builder', async () => {
      const mockSlots = [
        {
          id: 'slot-1',
          cycleId: 'cycle-1',
          workDate: '2025-02-10',
          maxStaff: 4,
          workShift: {
            id: 'ws-1',
            shiftName: 'Ca sáng',
            startTime: '08:00',
            endTime: '12:00',
          },
          assignments: [
            {
              id: 'a1',
              employeeId: 'e1',
              status: ShiftAssignmentStatus.APPROVED,
            },
            {
              id: 'a2',
              employeeId: 'e2',
              status: ShiftAssignmentStatus.APPROVED,
            },
            {
              id: 'a3',
              employeeId: 'e3',
              status: ShiftAssignmentStatus.PENDING,
            },
          ],
        },
      ];

      const qbMock: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockSlots),
      };
      shiftSlotRepo.createQueryBuilder.mockReturnValue(qbMock);

      const result = await service.getStoreShiftSlots('store-1');

      expect(result).toHaveLength(1);
      expect(result[0].currentCount).toBe(3);
      expect(result[0].isFull).toBe(false);
      expect(result[0].maxStaff).toBe(4);
      expect(result[0].effectiveMaxStaff).toBe(4);
    });

    it('exposes inherited work-shift capacity when the slot override is null', async () => {
      const mockSlots = [
        {
          id: 'slot-inherited',
          cycleId: 'cycle-1',
          workDate: '2025-02-10',
          maxStaff: null,
          workShift: {
            id: 'ws-1',
            shiftName: 'Ca sáng',
            startTime: '08:00',
            endTime: '12:00',
            defaultMaxStaff: 5,
          },
          assignments: Array.from({ length: 5 }, (_, index) => ({
            id: `a${index}`,
            employeeId: `e${index}`,
            status: ShiftAssignmentStatus.APPROVED,
          })),
        },
      ];
      const qbMock: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockSlots),
      };
      shiftSlotRepo.createQueryBuilder.mockReturnValue(qbMock);

      const result = await service.getStoreShiftSlots('store-1');

      expect(result[0].maxStaff).toBeNull();
      expect(result[0].effectiveMaxStaff).toBe(5);
      expect(result[0].currentCount).toBe(5);
      expect(result[0].isFull).toBe(true);
    });

    it('keeps unlimited capacity when both slot and shift defaults are null or zero', async () => {
      const mockSlots = [
        {
          id: 'slot-unlimited',
          cycleId: 'cycle-1',
          workDate: '2025-02-10',
          maxStaff: 0,
          workShift: {
            id: 'ws-1',
            shiftName: 'Ca sáng',
            startTime: '08:00',
            endTime: '12:00',
            defaultMaxStaff: null,
          },
          assignments: [
            {
              id: 'a1',
              employeeId: 'e1',
              status: ShiftAssignmentStatus.APPROVED,
            },
          ],
        },
      ];
      const qbMock: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockSlots),
      };
      shiftSlotRepo.createQueryBuilder.mockReturnValue(qbMock);

      const result = await service.getStoreShiftSlots('store-1');

      expect(result[0].maxStaff).toBe(0);
      expect(result[0].effectiveMaxStaff).toBeNull();
      expect(result[0].isFull).toBe(false);
    });

    it('should correctly mark slot as full in getStoreShiftSlots', async () => {
      const mockSlots = [
        {
          id: 'slot-full',
          cycleId: 'cycle-1',
          workDate: '2025-02-10',
          maxStaff: 2,
          workShift: {
            id: 'ws-1',
            shiftName: 'Ca sáng',
            startTime: '08:00',
            endTime: '12:00',
          },
          assignments: [
            {
              id: 'a1',
              employeeId: 'e1',
              status: ShiftAssignmentStatus.APPROVED,
            },
            {
              id: 'a2',
              employeeId: 'e2',
              status: ShiftAssignmentStatus.APPROVED,
            },
          ],
        },
      ];

      const qbMock: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockSlots),
      };
      shiftSlotRepo.createQueryBuilder.mockReturnValue(qbMock);

      const result = await service.getStoreShiftSlots('store-1');

      expect(result[0].currentCount).toBe(2);
      expect(result[0].isFull).toBe(true);
    });

    it('excludes cancelled assignments from staff calendar payload and capacity', async () => {
      const mockSlots = [
        {
          id: 'slot-cancelled',
          cycleId: 'cycle-1',
          workDate: '2025-02-10',
          maxStaff: 1,
          workShift: {
            id: 'ws-1',
            shiftName: 'Ca sáng',
            startTime: '08:00',
            endTime: '12:00',
          },
          assignments: [
            {
              id: 'a-cancelled',
              employeeId: 'e1',
              status: ShiftAssignmentStatus.CANCELLED,
            },
          ],
        },
      ];
      const qbMock: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockSlots),
      };
      shiftSlotRepo.createQueryBuilder.mockReturnValue(qbMock);

      const result = await service.getStoreShiftSlots('store-1');

      expect(result[0].assignments).toEqual([]);
      expect(result[0].currentCount).toBe(0);
      expect(result[0].isFull).toBe(false);
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        'cycle.status IN (:...cycleStatuses)',
        { cycleStatuses: [WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED] },
      );
    });
  });

  describe('createShiftRegistration - Batch Mode', () => {
    it('should throw error if no slots match the daysOfWeek', async () => {
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { id: '1', workDate: '2024-06-04' }, // Tuesday
        ]),
      };
      shiftSlotRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await expect(
        service.createShiftRegistration('account-1', {
          storeId: 'store-1',
          employeeProfileId: 'emp-1',
          workShiftId: 'ws-1',
          startDate: '2024-06-01',
          endDate: '2024-06-30',
          daysOfWeek: [1], // Monday
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should process batch registration successfully (Best-effort)', async () => {
      // Mock 4 slots (e.g. 4 Mondays in a month)
      const mockSlots = [
        {
          id: 's1',
          workDate: '2024-06-03',
          cycle: { status: WorkCycleStatus.ACTIVE },
        },
        {
          id: 's2',
          workDate: '2024-06-10',
          cycle: { status: WorkCycleStatus.ACTIVE },
        },
        {
          id: 's3',
          workDate: '2024-06-17',
          cycle: { status: WorkCycleStatus.ACTIVE },
        },
        {
          id: 's4',
          workDate: '2024-06-24',
          cycle: { status: WorkCycleStatus.ACTIVE },
        },
      ];

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockSlots),
      };
      shiftSlotRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Mock the transaction manager
      const managerMock = {
        query: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
        findOne: jest.fn(),
        find: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
        createQueryBuilder: jest.fn(),
      };

      jest
        .spyOn(service['dataSource'], 'transaction')
        .mockImplementation(async (cb: any) => {
          return cb(managerMock);
        });

      // Employee is active
      managerMock.findOne.mockResolvedValue({
        id: 'emp-1',
        accountId: 'account-1',
        storeId: 'store-1',
        employmentStatus: EmploymentStatus.ACTIVE,
      });
      managerMock.findOne.mockResolvedValueOnce({
        id: 'emp-1',
        accountId: 'account-1',
        storeId: 'store-1',
        employmentStatus: EmploymentStatus.ACTIVE,
      });

      // Mock locking slots
      managerMock.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest
          .fn()
          .mockResolvedValueOnce({ id: 's1', maxStaff: 2 }) // Slot 1: valid
          .mockResolvedValueOnce({ id: 's2', maxStaff: 1 }) // Slot 2: full
          .mockResolvedValueOnce({ id: 's3', maxStaff: 2 }) // Slot 3: valid
          .mockResolvedValueOnce({ id: 's4', maxStaff: null }), // Slot 4: valid (unlimited)
      });

      // Mock assignments per slot
      managerMock.find
        .mockResolvedValueOnce([
          {
            id: 'a1',
            employeeId: 'other',
            status: ShiftAssignmentStatus.PENDING,
          },
        ]) // Slot 1 has 1 (not full)
        .mockResolvedValueOnce([
          {
            id: 'a2',
            employeeId: 'other',
            status: ShiftAssignmentStatus.APPROVED,
          },
        ]) // Slot 2 has 1 (full since maxStaff=1)
        .mockResolvedValueOnce([
          {
            id: 'a3',
            employeeId: 'emp-1',
            status: ShiftAssignmentStatus.PENDING,
          },
        ]) // Slot 3 already has this employee
        .mockResolvedValueOnce([]); // Slot 4 empty

      managerMock.create.mockReturnValue({ id: 'new-assignment' });
      managerMock.save.mockResolvedValue({ id: 'new-assignment' });

      const result = await service.createShiftRegistration('account-1', {
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        workShiftId: 'ws-1',
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        daysOfWeek: [1], // Monday
      });

      expect(result).toEqual({ successCount: 2 });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'cycle.storeId = :storeId',
        { storeId: 'store-1' },
      );
      expect(managerMock.create).toHaveBeenCalledTimes(2);
      expect(managerMock.save).toHaveBeenCalledTimes(2);
    });

    it('should throw error if all slots fail', async () => {
      const mockSlots = [
        {
          id: 's1',
          workDate: '2024-06-03',
          cycle: { status: WorkCycleStatus.ACTIVE },
        },
      ];

      shiftSlotRepo.createQueryBuilder.mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockSlots),
      });

      const managerMock = {
        query: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
        findOne: jest.fn().mockResolvedValue({
          id: 'emp-1',
          accountId: 'account-1',
          storeId: 'store-1',
          employmentStatus: EmploymentStatus.ACTIVE,
        }),
        find: jest.fn().mockResolvedValue([
          {
            id: 'a1',
            employeeId: 'other',
            status: ShiftAssignmentStatus.APPROVED,
          },
        ]),
        createQueryBuilder: jest.fn().mockReturnValue({
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({ id: 's1', maxStaff: 1 }), // Slot 1 full
        }),
      };

      jest
        .spyOn(service['dataSource'], 'transaction')
        .mockImplementation(async (cb: any) => {
          return cb(managerMock);
        });

      await expect(
        service.createShiftRegistration('account-1', {
          storeId: 'store-1',
          employeeProfileId: 'emp-1',
          workShiftId: 'ws-1',
          startDate: '2024-06-01',
          daysOfWeek: [1],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects batch registration when a null slot capacity inherits a full shift default', async () => {
      const mockSlots = [
        {
          id: 'slot-inherited-full',
          workDate: '2024-06-03',
          cycle: { status: WorkCycleStatus.ACTIVE },
        },
      ];
      shiftSlotRepo.createQueryBuilder.mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockSlots),
      });
      const managerMock = {
        query: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
        findOne: jest.fn((entity) => {
          if (entity === EmployeeProfile) {
            return Promise.resolve({
              id: 'emp-1',
              accountId: 'account-1',
              storeId: 'store-1',
              employmentStatus: EmploymentStatus.ACTIVE,
            });
          }
          if (entity === WorkCycle) {
            return Promise.resolve({ id: 'cycle-1', storeId: 'store-1' });
          }
          if (entity === WorkShift) {
            return Promise.resolve({ id: 'ws-1', defaultMaxStaff: 5 });
          }
          return Promise.resolve(null);
        }),
        find: jest.fn().mockResolvedValue(
          Array.from({ length: 5 }, (_, index) => ({
            id: `a${index}`,
            employeeId: `other-${index}`,
            status: ShiftAssignmentStatus.APPROVED,
          })),
        ),
        createQueryBuilder: jest.fn().mockReturnValue({
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({
            id: 'slot-inherited-full',
            cycleId: 'cycle-1',
            workShiftId: 'ws-1',
            maxStaff: null,
          }),
        }),
      };
      jest
        .spyOn(service['dataSource'], 'transaction')
        .mockImplementation(async (cb: any) => cb(managerMock));

      await expect(
        service.createShiftRegistration('account-1', {
          storeId: 'store-1',
          employeeProfileId: 'emp-1',
          workShiftId: 'ws-1',
          startDate: '2024-06-01',
          daysOfWeek: [1],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(managerMock.find).toHaveBeenCalledWith(ShiftAssignment, {
        where: { shiftSlotId: 'slot-inherited-full' },
      });
    });

    it('allows batch registration for an explicit zero-capacity unlimited slot', async () => {
      const mockSlots = [
        {
          id: 'slot-unlimited',
          workDate: '2024-06-03',
          cycle: { status: WorkCycleStatus.ACTIVE },
        },
      ];
      shiftSlotRepo.createQueryBuilder.mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockSlots),
      });
      const managerMock = {
        query: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
        findOne: jest.fn((entity) => {
          if (entity === EmployeeProfile) {
            return Promise.resolve({
              id: 'emp-1',
              accountId: 'account-1',
              storeId: 'store-1',
              employmentStatus: EmploymentStatus.ACTIVE,
            });
          }
          if (entity === WorkCycle) {
            return Promise.resolve({ id: 'cycle-1', storeId: 'store-1' });
          }
          if (entity === WorkShift) {
            return Promise.resolve({ id: 'ws-1', defaultMaxStaff: 5 });
          }
          return Promise.resolve(null);
        }),
        find: jest.fn().mockResolvedValue(
          Array.from({ length: 5 }, (_, index) => ({
            id: `a${index}`,
            employeeId: `other-${index}`,
            status: ShiftAssignmentStatus.APPROVED,
          })),
        ),
        create: jest.fn().mockReturnValue({ id: 'new-assignment' }),
        save: jest.fn().mockResolvedValue({ id: 'new-assignment' }),
        createQueryBuilder: jest.fn().mockReturnValue({
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({
            id: 'slot-unlimited',
            cycleId: 'cycle-1',
            workShiftId: 'ws-1',
            maxStaff: 0,
          }),
        }),
      };
      jest
        .spyOn(service['dataSource'], 'transaction')
        .mockImplementation(async (cb: any) => cb(managerMock));

      await expect(
        service.createShiftRegistration('account-1', {
          storeId: 'store-1',
          employeeProfileId: 'emp-1',
          workShiftId: 'ws-1',
          startDate: '2024-06-01',
          daysOfWeek: [1],
        }),
      ).resolves.toEqual({ successCount: 1 });
      expect(managerMock.save).toHaveBeenCalledTimes(1);
    });

    it('rejects a cross-store slot even when a stale query returns it', async () => {
      shiftSlotRepo.createQueryBuilder.mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'foreign-slot',
            workDate: '2024-06-03',
            cycle: { storeId: 'store-2', status: WorkCycleStatus.ACTIVE },
          },
        ]),
      });
      const managerMock = {
        query: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
        findOne: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'emp-1',
            accountId: 'account-1',
            storeId: 'store-1',
            employmentStatus: EmploymentStatus.ACTIVE,
          })
          .mockResolvedValueOnce({
            id: 'foreign-cycle',
            storeId: 'store-2',
            status: WorkCycleStatus.ACTIVE,
          }),
        find: jest.fn().mockResolvedValue([]),
        createQueryBuilder: jest.fn().mockReturnValue({
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({
            id: 'foreign-slot',
            cycleId: 'foreign-cycle',
            maxStaff: 2,
          }),
        }),
      };
      jest
        .spyOn(service['dataSource'], 'transaction')
        .mockImplementation(async (cb: any) => cb(managerMock));
      await expect(
        service.createShiftRegistration('account-1', {
          storeId: 'store-1',
          employeeProfileId: 'emp-1',
          workShiftId: 'ws-1',
          startDate: '2024-06-01',
          daysOfWeek: [1],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(managerMock.find).not.toHaveBeenCalled();
    });
  });
});
