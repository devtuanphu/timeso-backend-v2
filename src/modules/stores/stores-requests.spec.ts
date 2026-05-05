import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StoresService } from './stores.service';
import { AccountsService } from '../accounts/accounts.service';
import { FaceRecognitionService } from './face-recognition.service';
import {
  ShiftChangeRequest,
  ShiftChangeRequestStatus,
} from './entities/shift-change-request.entity';
import {
  BonusWorkRequest,
  BonusWorkRequestStatus,
} from './entities/bonus-work-request.entity';

// Import ALL entities that StoresService needs
import { Store } from './entities/store.entity';
import { StoreEmployeeType } from './entities/store-employee-type.entity';
import { StoreRole } from './entities/store-role.entity';
import { EmployeeProfile } from './entities/employee-profile.entity';
import { EmployeeProfileRole } from './entities/employee-profile-role.entity';
import { EmployeeContract } from './entities/employee-contract.entity';
import { WorkShift } from './entities/work-shift.entity';
import { Asset } from './entities/asset.entity';
import { Product } from './entities/product.entity';
import { AssetUnit } from './entities/asset-unit.entity';
import { ProductUnit } from './entities/product-unit.entity';
import { MonthlyPayroll } from './entities/monthly-payroll.entity';
import { SalaryConfig } from './entities/salary-config.entity';
import { EmployeeSalary } from './entities/employee-salary.entity';
import { KpiType } from './entities/kpi-type.entity';
import { AssetCategory } from './entities/asset-category.entity';
import { AssetStatus } from './entities/asset-status.entity';
import { ProductCategory } from './entities/product-category.entity';
import { ProductStatus } from './entities/product-status.entity';
import { EmployeeKpi } from './entities/employee-kpi.entity';
import { KpiUnit } from './entities/kpi-unit.entity';
import { KpiPeriod } from './entities/kpi-period.entity';
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
  ShiftSlot,
  ShiftAssignment,
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

function mockRepo() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((d) => ({ id: 'gen-id', ...d })),
    save: jest.fn((e) =>
      Promise.resolve(Array.isArray(e) ? e : { id: 'gen-id', ...e }),
    ),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(() => {
      const qb: any = {};
      qb.where = jest.fn().mockReturnValue(qb);
      qb.andWhere = jest.fn().mockReturnValue(qb);
      qb.leftJoinAndSelect = jest.fn().mockReturnValue(qb);
      qb.innerJoin = jest.fn().mockReturnValue(qb);
      qb.orderBy = jest.fn().mockReturnValue(qb);
      qb.getMany = jest.fn().mockResolvedValue([]);
      qb.getRawMany = jest.fn().mockResolvedValue([]);
      qb.getRawOne = jest.fn().mockResolvedValue(null);
      qb.execute = jest.fn().mockResolvedValue({ affected: 0 });
      qb.limit = jest.fn().mockReturnValue(qb);
      qb.select = jest.fn().mockReturnValue(qb);
      return qb;
    }),
  };
}

function mockDataSource() {
  return {
    transaction: jest.fn(async (cb) =>
      cb({
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((entity, data) => ({ id: 'tx-gen-id', ...data })),
        save: jest.fn((e) =>
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

// All entities
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
  AccountFinance,
  Feedback,
  EmployeeFace,
  AttendanceLog,
  ShiftChangeRequest,
  BonusWorkRequest,
];

describe('StoresService - Shift & Bonus Request Features', () => {
  let shiftChangeRepo: ReturnType<typeof mockRepo>;
  let bonusWorkRepo: ReturnType<typeof mockRepo>;
  let service: StoresService;
  let repoMap: Map<any, ReturnType<typeof mockRepo>>;

  beforeEach(async () => {
    repoMap = new Map<any, ReturnType<typeof mockRepo>>();

    // Create mocks for all entities
    const providers = ENTITIES.map((entity) => {
      const mock = mockRepo();
      repoMap.set(entity, mock);
      return { provide: getRepositoryToken(entity), useValue: mock };
    });

    shiftChangeRepo = repoMap.get(ShiftChangeRequest);
    bonusWorkRepo = repoMap.get(BonusWorkRequest);

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
            compareFaces: jest
              .fn()
              .mockReturnValue({ matched: false, distance: Infinity }),
          },
        },
        { provide: DataSource, useValue: mockDataSource() },
      ],
    }).compile();

    service = module.get<StoresService>(StoresService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===== Shift Change Request Tests =====

  describe('createShiftChangeRequest', () => {
    it('should create a shift change request with both shift IDs', async () => {
      const data = {
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        currentShiftId: 'shift-current',
        requestedShiftId: 'shift-requested',
        requestDate: '2026-04-20',
        reason: 'Cần đổi ca',
        attachments: [],
      };

      const result = await service.createShiftChangeRequest(data);

      expect(shiftChangeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: 'store-1',
          employeeProfileId: 'emp-1',
          currentShiftId: 'shift-current',
          requestedShiftId: 'shift-requested',
          status: ShiftChangeRequestStatus.PENDING,
        }),
      );
      expect(shiftChangeRepo.save).toHaveBeenCalled();
    });

    it('should create a shift change request with only currentShiftId', async () => {
      const data = {
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        currentShiftId: 'shift-current',
        requestDate: '2026-04-20',
        reason: 'Cần đổi ca',
      };

      const result = await service.createShiftChangeRequest(data);

      expect(shiftChangeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          currentShiftId: 'shift-current',
          requestedShiftId: undefined,
        }),
      );
    });

    it('should create a shift change request with only requestedShiftId', async () => {
      const data = {
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        requestedShiftId: 'shift-requested',
        requestDate: '2026-04-20',
      };

      const result = await service.createShiftChangeRequest(data);

      expect(shiftChangeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          currentShiftId: undefined,
          requestedShiftId: 'shift-requested',
        }),
      );
    });

    it('should throw BadRequestException when neither shift ID is provided', async () => {
      const data = {
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        requestDate: '2026-04-20',
      };

      await expect(service.createShiftChangeRequest(data)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('approveShiftChangeRequest', () => {
    it('should approve a pending shift change request', async () => {
      const mockRequest = {
        id: 'req-1',
        status: ShiftChangeRequestStatus.PENDING,
        approvedById: null as string | null,
        rejectionReason: null as string | null,
        save: jest.fn(),
      };
      shiftChangeRepo.findOne.mockResolvedValue(mockRequest);

      const result = await service.approveShiftChangeRequest(
        'req-1',
        'approver-1',
      );

      expect(mockRequest.status).toBe(ShiftChangeRequestStatus.APPROVED);
      expect(mockRequest.approvedById).toBe('approver-1');
      expect(shiftChangeRepo.save).toHaveBeenCalledWith(mockRequest);
    });

    it('should throw NotFoundException when request does not exist', async () => {
      shiftChangeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.approveShiftChangeRequest('non-existent', 'approver-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when approver ID is undefined', async () => {
      await expect(
        service.approveShiftChangeRequest('req-1', undefined),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('rejectShiftChangeRequest', () => {
    it('should reject a pending shift change request with reason', async () => {
      const mockRequest = {
        id: 'req-1',
        status: ShiftChangeRequestStatus.PENDING,
        approvedById: null as string | null,
        rejectionReason: null as string | null,
        save: jest.fn(),
      };
      shiftChangeRepo.findOne.mockResolvedValue(mockRequest);

      await service.rejectShiftChangeRequest(
        'req-1',
        'approver-1',
        'Ca không phù hợp',
      );

      expect(mockRequest.status).toBe(ShiftChangeRequestStatus.REJECTED);
      expect(mockRequest.approvedById).toBe('approver-1');
      expect(mockRequest.rejectionReason).toBe('Ca không phù hợp');
    });
  });

  describe('cancelShiftChangeRequest', () => {
    it('should cancel a pending shift change request by the owner', async () => {
      const mockRequest = {
        id: 'req-1',
        employeeProfileId: 'emp-1',
        status: ShiftChangeRequestStatus.PENDING,
        save: jest.fn(),
      };
      shiftChangeRepo.findOne.mockResolvedValue(mockRequest);

      await service.cancelShiftChangeRequest('req-1', 'emp-1');

      expect(mockRequest.status).toBe(ShiftChangeRequestStatus.CANCELLED);
    });

    it('should throw BadRequestException when cancelling from different employee', async () => {
      const mockRequest = {
        id: 'req-1',
        employeeProfileId: 'emp-1',
        status: ShiftChangeRequestStatus.PENDING,
      };
      shiftChangeRepo.findOne.mockResolvedValue(mockRequest);

      await expect(
        service.cancelShiftChangeRequest('req-1', 'emp-2'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when cancelling a non-pending request', async () => {
      const mockRequest = {
        id: 'req-1',
        employeeProfileId: 'emp-1',
        status: ShiftChangeRequestStatus.APPROVED,
      };
      shiftChangeRepo.findOne.mockResolvedValue(mockRequest);

      await expect(
        service.cancelShiftChangeRequest('req-1', 'emp-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ===== Bonus Work Request Tests =====

  describe('createBonusWorkRequest', () => {
    it('should create a bonus work request with shiftSlotId', async () => {
      const data = {
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        shiftSlotId: 'slot-1',
        requestDate: '2026-04-20',
        startTime: '08:00',
        endTime: '12:00',
        reason: 'Tăng ca hoàn thành deadline',
      };

      const result = await service.createBonusWorkRequest(data);

      expect(bonusWorkRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: 'store-1',
          employeeProfileId: 'emp-1',
          shiftSlotId: 'slot-1',
          status: BonusWorkRequestStatus.PENDING,
        }),
      );
      expect(bonusWorkRepo.save).toHaveBeenCalled();
    });

    it('should create a bonus work request without shiftSlotId (null)', async () => {
      const data = {
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        shiftSlotId: null,
        requestDate: '2026-04-20',
        startTime: '08:00',
        endTime: '12:00',
        reason: 'Tăng ca ad-hoc',
      };

      const result = await service.createBonusWorkRequest(data);

      expect(bonusWorkRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          shiftSlotId: undefined,
        }),
      );
    });
  });

  describe('approveBonusWorkRequest', () => {
    it('should approve a pending bonus work request', async () => {
      const mockRequest = {
        id: 'bonus-1',
        status: BonusWorkRequestStatus.PENDING,
        approvedById: null as string | null,
        rejectionReason: null as string | null,
        save: jest.fn(),
      };
      bonusWorkRepo.findOne.mockResolvedValue(mockRequest);

      await service.approveBonusWorkRequest('bonus-1', 'approver-1');

      expect(mockRequest.status).toBe(BonusWorkRequestStatus.APPROVED);
      expect(mockRequest.approvedById).toBe('approver-1');
    });
  });

  describe('rejectBonusWorkRequest', () => {
    it('should reject a pending bonus work request', async () => {
      const mockRequest = {
        id: 'bonus-1',
        status: BonusWorkRequestStatus.PENDING,
        approvedById: null as string | null,
        rejectionReason: null as string | null,
        save: jest.fn(),
      };
      bonusWorkRepo.findOne.mockResolvedValue(mockRequest);

      await service.rejectBonusWorkRequest(
        'bonus-1',
        'approver-1',
        'Không cần thiết',
      );

      expect(mockRequest.status).toBe(BonusWorkRequestStatus.REJECTED);
      expect(mockRequest.rejectionReason).toBe('Không cần thiết');
    });
  });

  describe('cancelBonusWorkRequest', () => {
    it('should cancel a pending bonus work request by the owner', async () => {
      const mockRequest = {
        id: 'bonus-1',
        employeeProfileId: 'emp-1',
        status: BonusWorkRequestStatus.PENDING,
        save: jest.fn(),
      };
      bonusWorkRepo.findOne.mockResolvedValue(mockRequest);

      await service.cancelBonusWorkRequest('bonus-1', 'emp-1');

      expect(mockRequest.status).toBe(BonusWorkRequestStatus.CANCELLED);
    });

    it('should throw BadRequestException when cancelling from different employee', async () => {
      const mockRequest = {
        id: 'bonus-1',
        employeeProfileId: 'emp-1',
        status: BonusWorkRequestStatus.PENDING,
      };
      bonusWorkRepo.findOne.mockResolvedValue(mockRequest);

      await expect(
        service.cancelBonusWorkRequest('bonus-1', 'emp-2'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
