import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StoresService } from './stores.service';
import { AccountsService } from '../accounts/accounts.service';
import { FaceRecognitionService } from './face-recognition.service';
import { Store } from './entities/store.entity';
import { StoreEmployeeType } from './entities/store-employee-type.entity';
import { StoreRole } from './entities/store-role.entity';
import { EmployeeProfile } from './entities/employee-profile.entity';
import { EmployeeProfileRole } from './entities/employee-profile-role.entity';
import { EmployeeContract, PaymentType } from './entities/employee-contract.entity';
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
import { StockTransaction, StockTransactionDetail } from './entities/stock-transaction.entity';
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
import { ServiceCategory, ServiceItem, ServiceItemRecipe } from './entities/service-item.entity';
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

let AccountIdentityDocument: any;
let AccountFinance: any;
try {
  AccountIdentityDocument = require('../accounts/entities/account-identity-document.entity').AccountIdentityDocument;
} catch {
  AccountIdentityDocument = class AccountIdentityDocument {};
}
try {
  AccountFinance = require('../accounts/entities/account-finance.entity').AccountFinance;
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
    save: jest.fn((e: any) => Promise.resolve(Array.isArray(e) ? e : { id: 'gen-id', ...e })),
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
    transaction: jest.fn(async (cb) => cb({
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((entity: any, data: any) => ({ id: 'tx-gen-id', ...data })),
      save: jest.fn((e: any) => Promise.resolve({ id: 'tx-gen-id', ...(Array.isArray(e) ? e[0] : e) })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      decrement: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: () => ({
        delete: () => ({ execute: jest.fn().mockResolvedValue({ affected: 0 }) }),
        from: () => ({ where: () => ({ execute: jest.fn().mockResolvedValue({ affected: 0 }) }) }),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      }),
    })),
  };
}

const ENTITIES = [
  Store, StoreEmployeeType, StoreRole, EmployeeProfile, EmployeeProfileRole,
  EmployeeContract, WorkShift, Asset, Product, AssetUnit, ProductUnit,
  MonthlyPayroll, SalaryConfig, EmployeeSalary, KpiType, AssetCategory,
  AssetStatus, ProductCategory, ProductStatus, EmployeeKpi, KpiUnit, KpiPeriod,
  KpiTask, DailyEmployeeReport, EmployeeMonthlySummary, StoreEvent,
  StockTransaction, StockTransactionDetail, WorkCycle, ShiftSlot, ShiftAssignment,
  ShiftSwap, CycleShiftTemplate, ServiceCategory, ServiceItem, ServiceItemRecipe,
  Order, OrderItem, EmployeePerformance, EmployeeLeaveRequest, EmployeeAssetAssignment,
  EmployeeTerminationReason, StoreProbationSetting, StoreSkill,
  StorePayrollPaymentHistory, SalaryFundHistory, SalaryAdvanceRequest,
  SalaryAdjustment, SalaryAdjustmentReason, EmployeePaymentHistory,
  StorePaymentAccount, KpiApprovalRequest, InventoryReport, AssetExportType,
  ProductExportType, StoreApprovalSetting, StoreTimekeepingSetting,
  StorePayrollSetting, StorePayrollRule, StorePayrollIncrementRule,
  AccountIdentityDocument, StoreInternalRule, StorePermissionConfig,
  StoreShiftConfig, CycleShiftTemplate, AccountFinance, Feedback,
  EmployeeFace, AttendanceLog,
  ShiftChangeRequest, BonusWorkRequest,
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
  const shiftSlotRepo = {
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    dataSourceMock = mockDataSource();
    repoMap = new Map<any, ReturnType<typeof mockRepo>>();
    repoMap.set(ShiftSlot, shiftSlotRepo);

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
      ],
    }).compile();

    service = module.get<StoresService>(StoresService);
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
          workShift: { id: 'ws-1', shiftName: 'Ca sáng', startTime: '08:00', endTime: '12:00' },
          assignments: [
            { id: 'a1', employeeId: 'e1', status: ShiftAssignmentStatus.APPROVED },
            { id: 'a2', employeeId: 'e2', status: ShiftAssignmentStatus.APPROVED },
          ],
        },
        {
          id: 'slot-2',
          cycleId: 'cycle-1',
          workShiftId: 'ws-2',
          workDate: '2025-02-10',
          maxStaff: 2,
          note: null,
          workShift: { id: 'ws-2', shiftName: 'Ca chiều', startTime: '14:00', endTime: '18:00' },
          assignments: [
            { id: 'a3', employeeId: 'e3', status: ShiftAssignmentStatus.PENDING },
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
          workShift: { id: 'ws-1', shiftName: 'Ca tối', startTime: '18:00', endTime: '22:00' },
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
          workShift: { id: 'ws-1', shiftName: 'Ca đêm', startTime: '22:00', endTime: '02:00' },
          assignments: [
            { id: 'a1', employeeId: 'e1', status: ShiftAssignmentStatus.APPROVED },
            { id: 'a2', employeeId: 'e2', status: ShiftAssignmentStatus.APPROVED },
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
        findOne: jest.fn().mockResolvedValue(fullSlot),
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

      await expect(
        service.registerToShiftSlot('slot-full', 'new-employee'),
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
            { id: 'a1', employeeId: 'e1', status: ShiftAssignmentStatus.APPROVED },
            { id: 'a2', employeeId: 'e2', status: ShiftAssignmentStatus.APPROVED },
            { id: 'a3', employeeId: 'e3', status: ShiftAssignmentStatus.PENDING },
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
            { id: 'a1', employeeId: 'e1', status: ShiftAssignmentStatus.APPROVED },
            { id: 'a2', employeeId: 'e2', status: ShiftAssignmentStatus.APPROVED },
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
  });
});
