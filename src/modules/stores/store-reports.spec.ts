import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StoresService } from './stores.service';
import { FaceRecognitionService } from './face-recognition.service';
import { AccountsService } from '../accounts/accounts.service';

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
import { StockTransaction, StockTransactionDetail } from './entities/stock-transaction.entity';
import {
  WorkCycle, ShiftSlot, ShiftAssignment, ShiftSwap, CycleShiftTemplate,
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
  AccountIdentityDocument = require('../accounts/entities/account-identity-document.entity').AccountIdentityDocument;
} catch {
  AccountIdentityDocument = class AccountIdentityDocument {};
}
try {
  AccountFinance = require('../accounts/entities/account-finance.entity').AccountFinance;
} catch {
  AccountFinance = class AccountFinance {};
}

function mockRepo() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((d) => ({ id: 'gen-id', ...d })),
    save: jest.fn((e) => Promise.resolve(Array.isArray(e) ? e : { id: 'gen-id', ...e })),
    createQueryBuilder: jest.fn(() => {
      const qb: any = {};
      qb.where = jest.fn().mockReturnValue(qb);
      qb.andWhere = jest.fn().mockReturnValue(qb);
      qb.leftJoinAndSelect = jest.fn().mockReturnValue(qb);
      qb.innerJoin = jest.fn().mockReturnValue(qb);
      qb.orderBy = jest.fn().mockReturnValue(qb);
      qb.select = jest.fn().mockReturnValue(qb);
      qb.addSelect = jest.fn().mockReturnValue(qb);
      qb.groupBy = jest.fn().mockReturnValue(qb);
      qb.having = jest.fn().mockReturnValue(qb);
      qb.limit = jest.fn().mockReturnValue(qb);
      qb.getMany = jest.fn().mockResolvedValue([]);
      qb.getRawMany = jest.fn().mockResolvedValue([]);
      qb.getRawOne = jest.fn().mockResolvedValue(null);
      return qb;
    }),
  };
}

const ENTITIES = [
  Store, StoreEmployeeType, StoreRole, EmployeeProfile, EmployeeProfileRole,
  EmployeeContract, WorkShift, Asset, Product, AssetUnit, ProductUnit,
  MonthlyPayroll, SalaryConfig, EmployeeSalary, KpiType, AssetCategory,
  AssetStatus, ProductCategory, ProductStatus, EmployeeKpi, KpiUnit, KpiPeriod,
  KpiTask, DailyEmployeeReport, EmployeeMonthlySummary, StoreEvent,
  StockTransaction, StockTransactionDetail, WorkCycle, ShiftSlot, ShiftAssignment,
  ShiftSwap, ServiceCategory, ServiceItem, ServiceItemRecipe, Order, OrderItem,
  EmployeePerformance, EmployeeLeaveRequest, EmployeeAssetAssignment,
  EmployeeTerminationReason, StoreProbationSetting, StoreSkill,
  StorePayrollPaymentHistory, SalaryFundHistory, SalaryAdvanceRequest,
  SalaryAdjustment, SalaryAdjustmentReason, EmployeePaymentHistory,
  StorePaymentAccount, KpiApprovalRequest, InventoryReport, AssetExportType,
  ProductExportType, StoreApprovalSetting, StoreTimekeepingSetting,
  StorePayrollSetting, StorePayrollRule, StorePayrollIncrementRule,
  AccountIdentityDocument, StoreInternalRule, StorePermissionConfig,
  StoreShiftConfig, CycleShiftTemplate, AccountFinance, Feedback,
  EmployeeFace, AttendanceLog,
];

describe('Store Reports Module', () => {
  let service: StoresService;
  let orderRepo: ReturnType<typeof mockRepo>;
  let orderItemRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const repoMap = new Map<any, ReturnType<typeof mockRepo>>();
    const providers = ENTITIES.map((entity) => {
      const mock = mockRepo();
      repoMap.set(entity, mock);
      return { provide: getRepositoryToken(entity), useValue: mock };
    });

    orderRepo = repoMap.get(Order)!;
    orderItemRepo = repoMap.get(OrderItem)!;

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
            registerFace: jest.fn().mockResolvedValue({}),
            isReady: jest.fn().mockReturnValue(false),
          },
        },
      ],
    }).compile();

    service = module.get<StoresService>(StoresService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getRevenueReport', () => {
    it('should calculate revenue and return formatted detailed summary', async () => {
      const mockSummary = {
        totalRevenue: '100000',
        totalCost: '50000',
        totalDiscount: '5000',
        totalTax: '10000',
        totalOrders: '5',
        successOrders: '4',
        failedOrders: '1'
      };

      const mockDaily = [
        {
          date: new Date('2026-04-01'),
          revenue: '100000',
          cost: '50000',
          discount: '5000',
          tax: '10000',
          totalOrders: '5',
          successOrders: '4',
          failedOrders: '1'
        }
      ];

      const qbStore = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValueOnce(mockSummary),
        getRawMany: jest.fn().mockResolvedValueOnce(mockDaily).mockResolvedValueOnce([]), // day breakdown and byType
      };
      
      orderRepo.createQueryBuilder.mockImplementation(() => qbStore as any);

      // orderItemRepo setup for top items
      const qbItemStore = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { name: 'Haircut', totalQuantity: '10', totalRevenue: '50000' }
        ]),
      };
      orderItemRepo.createQueryBuilder.mockImplementation(() => qbItemStore as any);

      const result = await service.getRevenueReport('store-1', new Date(), new Date());

      expect(result).toBeDefined();
      expect(result.summary.totalRevenue).toBe(100000);
      expect(result.summary.totalProfit).toBe(40000); // 100000 - 50000 - 10000
      expect(result.daily.length).toBe(1);
      expect(result.insight).toContain('Tín hiệu tốt');
      expect(result.topItems[0]).toEqual({ name: 'Haircut', quantity: 10, revenue: 50000 });
      expect(orderRepo.createQueryBuilder).toHaveBeenCalledTimes(3); 
    });
    
    it('should handle zero data scenarios (no orders)', async () => {
       const qbStore = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue(null),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      orderRepo.createQueryBuilder.mockImplementation(() => qbStore as any);
      orderItemRepo.createQueryBuilder.mockImplementation(() => qbStore as any);

      const result = await service.getRevenueReport('store-1', new Date(), new Date());
      expect(result.summary.totalRevenue).toBe(0);
      expect(result.summary.totalProfit).toBe(0);
      expect(result.insight).toContain('Chưa có giao dịch nào');
    });
  });

  describe('getTopEmployeesReport', () => {
    it('should aggregate employee revenue', async () => {
      const mockResult = [
        { employeeId: 'emp1', fullName: 'Alice', avatarUrl: 'link', totalRevenue: '200000', totalOrders: '10' }
      ];

      const qbStore = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockResult),
      };
      orderRepo.createQueryBuilder.mockImplementation(() => qbStore as any);

      const result = await service.getTopEmployeesReport('store-1', new Date(), new Date());

      expect(result).toHaveLength(1);
      expect(result[0].employeeId).toBe('emp1');
      expect(result[0].revenue).toBe(200000);
      expect(result[0].ordersCount).toBe(10);
      expect(qbStore.innerJoin).toHaveBeenCalledWith('o.employee', 'e');
    });
  });

  describe('getShiftEfficiencyReport', () => {
    it('should group data by shifts', async () => {
      const mockResult = [
        {
          shift: 'Ca sáng',
          revenue: '500000',
          orders: '5'
        }
      ];

      const qbStore = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockResult),
      };
      orderRepo.createQueryBuilder.mockImplementation(() => qbStore as any);

      const result = await service.getShiftEfficiencyReport('store-1', new Date(), new Date());

      expect(result.details).toHaveLength(1);
      expect(result.details[0].shiftName).toBe('Ca sáng');
      expect(result.details[0].revenue).toBe(500000);
      expect(result.details[0].ordersCount).toBe(5);
      expect(result.bestShift).toBe('Ca sáng');
    });
  });

  describe('getLosingMoneyReport', () => {
    it('should query for cancelled items and construct losing objects', async () => {
      const mockResult = [
        {
          name: 'Facial massage',
          totalQuantity: '2',
          lostRevenue: '2000'
        }
      ];

      const qbStore = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockResult),
      };
      
      orderItemRepo.createQueryBuilder.mockImplementation(() => qbStore as any);

      const result = await service.getLosingMoneyReport('store-1', new Date(), new Date());

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Facial massage');
      expect(result[0].cancelledQuantity).toBe(2);
      expect(result[0].lostRevenue).toBe(2000);
      expect(qbStore.groupBy).toHaveBeenCalledWith("item.\"itemSnapshot\"->>'name'");
      expect(qbStore.addSelect).toHaveBeenCalled();
    });
  });
});
