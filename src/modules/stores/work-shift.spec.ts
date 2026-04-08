/**
 * Unit tests for Work Shift & Work Cycle management flow
 * Tests the full lifecycle: create shifts → create cycle → stop cycle
 * 
 * Strategy: Import ALL actual entity classes for getRepositoryToken(),
 * mock ALL dependencies including AccountsService and FaceRecognitionService.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StoresService } from './stores.service';
import { FaceRecognitionService } from './face-recognition.service';
import { AccountsService } from '../accounts/accounts.service';

// ─── Import ALL entity classes used in StoresService constructor ─────────
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
  CycleType, WorkCycleStatus, WeekDaySchedule,
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

// Check if AccountIdentityDocument and AccountFinance exist
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

// ─── Mock repository factory ─────────────────────────────────────────────
function mockRepo() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((d) => ({ id: 'gen-id', ...d })),
    save: jest.fn((e) => Promise.resolve(Array.isArray(e) ? e : { id: 'gen-id', ...e })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getOne: jest.fn().mockResolvedValue(null),
      getCount: jest.fn().mockResolvedValue(0),
      getRawMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn().mockResolvedValue(null),
    })),
  };
}

// ─── All entities in constructor ORDER ───────────────────────────────────
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

// ─── TESTS ──────────────────────────────────────────────────────────────
describe('Work Shift & Cycle Management', () => {
  let service: StoresService;
  let workShiftRepo: ReturnType<typeof mockRepo>;
  let workCycleRepo: ReturnType<typeof mockRepo>;
  let shiftSlotRepo: ReturnType<typeof mockRepo>;
  let cycleTemplateRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const repoMap = new Map<any, ReturnType<typeof mockRepo>>();
    const providers = ENTITIES.map((entity) => {
      const mock = mockRepo();
      repoMap.set(entity, mock);
      return { provide: getRepositoryToken(entity), useValue: mock };
    });

    workShiftRepo = repoMap.get(WorkShift)!;
    workCycleRepo = repoMap.get(WorkCycle)!;
    shiftSlotRepo = repoMap.get(ShiftSlot)!;
    cycleTemplateRepo = repoMap.get(CycleShiftTemplate)!;

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
            compareFaces: jest.fn().mockReturnValue({ matched: false, distance: Infinity, bestMatchIndex: -1 }),
            registerFace: jest.fn().mockResolvedValue({ descriptors: [], successCount: 0, failedCount: 0 }),
            isReady: jest.fn().mockReturnValue(false),
          },
        },
      ],
    }).compile();

    service = module.get<StoresService>(StoresService);
  });

  afterEach(() => jest.clearAllMocks());

  // ═══════════════════════════════════════════════════════════════════════
  //  WORK SHIFT CRUD
  // ═══════════════════════════════════════════════════════════════════════
  describe('createWorkShift', () => {
    it('should create a work shift with correct storeId', async () => {
      const data = { shiftName: 'Ca sáng', startTime: '08:00', endTime: '12:00' };
      workShiftRepo.create.mockReturnValue({ id: 'ws-1', storeId: 'store-1', ...data });
      workShiftRepo.save.mockResolvedValue({ id: 'ws-1', storeId: 'store-1', ...data, isActive: true });

      const result = await service.createWorkShift('store-1', data);

      expect(workShiftRepo.create).toHaveBeenCalledWith({ ...data, storeId: 'store-1' });
      expect(workShiftRepo.save).toHaveBeenCalled();
      expect(result.shiftName).toBe('Ca sáng');
      expect(result.storeId).toBe('store-1');
    });

    it('should create multiple shifts for same store', async () => {
      workShiftRepo.create.mockImplementation((d) => ({ id: `ws-${Math.random()}`, ...d }));
      workShiftRepo.save.mockImplementation((e) => Promise.resolve(e));

      const s1 = await service.createWorkShift('store-1', { shiftName: 'Ca sáng', startTime: '08:00', endTime: '12:00' });
      const s2 = await service.createWorkShift('store-1', { shiftName: 'Ca chiều', startTime: '13:00', endTime: '17:00' });

      expect(s1.shiftName).toBe('Ca sáng');
      expect(s2.shiftName).toBe('Ca chiều');
      expect(workShiftRepo.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('getWorkShifts', () => {
    it('should return only active shifts', async () => {
      workShiftRepo.find.mockResolvedValue([
        { id: 's1', shiftName: 'Ca sáng', isActive: true },
        { id: 's2', shiftName: 'Ca chiều', isActive: true },
      ]);

      const result = await service.getWorkShifts('store-1');

      expect(workShiftRepo.find).toHaveBeenCalledWith({ where: { storeId: 'store-1', isActive: true } });
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no shifts', async () => {
      workShiftRepo.find.mockResolvedValue([]);
      const result = await service.getWorkShifts('store-empty');
      expect(result).toEqual([]);
    });
  });

  describe('updateWorkShift', () => {
    it('should update and return updated entity', async () => {
      workShiftRepo.findOne
        .mockResolvedValueOnce({ id: 's1', storeId: 'store-1', shiftName: 'Ca sáng' })
        .mockResolvedValueOnce({ id: 's1', storeId: 'store-1', shiftName: 'Ca sáng mới' });

      const result = await service.updateWorkShift('store-1', 's1', { shiftName: 'Ca sáng mới' });

      expect(workShiftRepo.update).toHaveBeenCalledWith('s1', { shiftName: 'Ca sáng mới' });
      expect(result!.shiftName).toBe('Ca sáng mới');
    });

    it('should throw NotFoundException when shift not found', async () => {
      workShiftRepo.findOne.mockResolvedValue(null);
      await expect(service.updateWorkShift('store-1', 'bad-id', { shiftName: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  WORK CYCLE LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════
  describe('getActiveCycle', () => {
    it('should return active cycle with relations', async () => {
      const cycle = { id: 'c1', storeId: 'store-1', status: WorkCycleStatus.ACTIVE, slots: [], templates: [] };
      workCycleRepo.findOne.mockResolvedValue(cycle);

      const result = await service.getActiveCycle('store-1');

      expect(workCycleRepo.findOne).toHaveBeenCalledWith({
        where: { storeId: 'store-1', status: WorkCycleStatus.ACTIVE },
        relations: ['slots', 'slots.workShift', 'templates', 'templates.workShift'],
      });
      expect(result).toEqual(cycle);
    });

    it('should return null when no active cycle', async () => {
      workCycleRepo.findOne.mockResolvedValue(null);
      expect(await service.getActiveCycle('store-1')).toBeNull();
    });
  });

  describe('createWorkCycle', () => {
    beforeEach(() => {
      workCycleRepo.findOne.mockResolvedValue(null); // no active cycle
    });

    it('should reject if active cycle exists', async () => {
      workCycleRepo.findOne.mockResolvedValue({ id: 'existing', status: WorkCycleStatus.ACTIVE });

      await expect(service.createWorkCycle('store-1', {
        name: 'New', cycleType: CycleType.WEEKLY, startDate: '2026-04-08',
      })).rejects.toThrow(BadRequestException);
    });

    it('should create WEEKLY cycle with endDate = startDate + 6 days', async () => {
      workCycleRepo.create.mockImplementation((d) => ({ id: 'c1', ...d }));
      workCycleRepo.save.mockImplementation((e) => Promise.resolve(e));
      workCycleRepo.findOne
        .mockResolvedValueOnce(null) // getActiveCycle
        .mockResolvedValueOnce({ id: 'c1', cycleType: CycleType.WEEKLY, endDate: '2026-04-14', slots: [], templates: [] });

      await service.createWorkCycle('store-1', {
        name: 'Week', cycleType: CycleType.WEEKLY, startDate: '2026-04-08',
      });

      expect(workCycleRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        cycleType: CycleType.WEEKLY,
        startDate: '2026-04-08',
        endDate: '2026-04-14',
        status: WorkCycleStatus.ACTIVE,
      }));
    });

    it('should create DAILY cycle with endDate = startDate', async () => {
      workCycleRepo.create.mockImplementation((d) => ({ id: 'c1', ...d }));
      workCycleRepo.save.mockImplementation((e) => Promise.resolve(e));
      workCycleRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'c1', slots: [], templates: [] });

      await service.createWorkCycle('store-1', {
        name: 'Day', cycleType: CycleType.DAILY, startDate: '2026-04-08',
      });

      expect(workCycleRepo.create).toHaveBeenCalledWith(expect.objectContaining({ endDate: '2026-04-08' }));
    });

    it('should create INDEFINITE cycle with endDate = null', async () => {
      workCycleRepo.create.mockImplementation((d) => ({ id: 'c1', ...d }));
      workCycleRepo.save.mockImplementation((e) => Promise.resolve(e));
      workCycleRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'c1', slots: [], templates: [] });

      await service.createWorkCycle('store-1', {
        name: 'Indef', cycleType: CycleType.INDEFINITE, startDate: '2026-04-08',
      });

      expect(workCycleRepo.create).toHaveBeenCalledWith(expect.objectContaining({ endDate: null }));
    });

    it('should generate slots when workShiftIds provided', async () => {
      workCycleRepo.create.mockImplementation((d) => ({ id: 'c1', ...d }));
      workCycleRepo.save.mockImplementation((e) => Promise.resolve(e));
      workCycleRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'c1', slots: [], templates: [] });
      shiftSlotRepo.create.mockImplementation((d) => d);
      shiftSlotRepo.save.mockResolvedValue([]);

      await service.createWorkCycle('store-1', {
        name: 'Test', cycleType: CycleType.WEEKLY, startDate: '2026-04-08',
        workShiftIds: ['shift-1', 'shift-2'],
      });

      expect(shiftSlotRepo.create).toHaveBeenCalledTimes(2);
      expect(shiftSlotRepo.save).toHaveBeenCalled();
    });

    it('should create templates for INDEFINITE cycle', async () => {
      workCycleRepo.create.mockImplementation((d) => ({ id: 'c1', ...d }));
      workCycleRepo.save.mockImplementation((e) => Promise.resolve(e));
      workCycleRepo.findOne
        .mockResolvedValueOnce(null) // active check
        .mockResolvedValueOnce({ id: 'c1', templates: [] }) // generateSlotsFromTemplate
        .mockResolvedValueOnce({ id: 'c1', slots: [], templates: [] }); // final return
      cycleTemplateRepo.create.mockImplementation((d) => d);
      cycleTemplateRepo.save.mockResolvedValue([]);

      await service.createWorkCycle('store-1', {
        name: 'Indef',
        cycleType: CycleType.INDEFINITE,
        startDate: '2026-04-08',
        templates: [
          { workShiftId: 's1', dayOfWeek: WeekDaySchedule.MONDAY, maxStaff: 2 },
          { workShiftId: 's2', dayOfWeek: WeekDaySchedule.TUESDAY, maxStaff: 1 },
        ],
      });

      expect(cycleTemplateRepo.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('getWorkCycles', () => {
    it('should return all cycles ordered by createdAt DESC', async () => {
      workCycleRepo.find.mockResolvedValue([
        { id: 'c1', status: WorkCycleStatus.ACTIVE },
        { id: 'c2', status: WorkCycleStatus.STOPPED },
      ]);

      const result = await service.getWorkCycles('store-1');

      expect(workCycleRepo.find).toHaveBeenCalledWith({
        where: { storeId: 'store-1' },
        order: { createdAt: 'DESC' },
        relations: ['slots', 'slots.workShift', 'templates', 'templates.workShift'],
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('stopWorkCycle', () => {
    it('should stop cycle immediately', async () => {
      workCycleRepo.findOne.mockResolvedValue({ id: 'c1', status: WorkCycleStatus.ACTIVE });

      await service.stopWorkCycle('c1', { stopImmediately: true });

      expect(workCycleRepo.update).toHaveBeenCalledWith('c1', expect.objectContaining({
        status: WorkCycleStatus.STOPPED,
        stoppedAt: expect.any(Date),
      }));
    });

    it('should schedule stop', async () => {
      workCycleRepo.findOne.mockResolvedValue({ id: 'c1', status: WorkCycleStatus.ACTIVE });

      await service.stopWorkCycle('c1', { stopImmediately: false, scheduledStopAt: '2026-04-15' });

      expect(workCycleRepo.update).toHaveBeenCalledWith('c1', expect.objectContaining({
        scheduledStopAt: expect.any(Date),
      }));
    });

    it('should throw NotFoundException if cycle missing', async () => {
      workCycleRepo.findOne.mockResolvedValue(null);
      await expect(service.stopWorkCycle('bad', { stopImmediately: true })).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if cycle not ACTIVE', async () => {
      workCycleRepo.findOne.mockResolvedValue({ id: 'c1', status: WorkCycleStatus.STOPPED });
      await expect(service.stopWorkCycle('c1', { stopImmediately: true })).rejects.toThrow(BadRequestException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  FULL LIFECYCLE TEST
  // ═══════════════════════════════════════════════════════════════════════
  describe('Full Flow: Shifts → Cycle → Stop → New Cycle', () => {
    it('should complete entire lifecycle', async () => {
      // 1. Create shifts
      workShiftRepo.create.mockImplementation((d) => ({ id: `ws-${d.shiftName}`, ...d }));
      workShiftRepo.save.mockImplementation((e) => Promise.resolve(e));

      const s1 = await service.createWorkShift('s1', { shiftName: 'Morning', startTime: '08:00', endTime: '12:00' });
      const s2 = await service.createWorkShift('s1', { shiftName: 'Afternoon', startTime: '13:00', endTime: '17:00' });
      expect(workShiftRepo.save).toHaveBeenCalledTimes(2);

      // 2. Verify shifts
      workShiftRepo.find.mockResolvedValue([s1, s2]);
      expect(await service.getWorkShifts('s1')).toHaveLength(2);

      // 3. Create cycle
      workCycleRepo.findOne.mockResolvedValueOnce(null); // no active
      workCycleRepo.create.mockReturnValue({ id: 'c1', storeId: 's1', status: WorkCycleStatus.ACTIVE });
      workCycleRepo.save.mockResolvedValue({ id: 'c1', storeId: 's1', status: WorkCycleStatus.ACTIVE });
      shiftSlotRepo.create.mockImplementation((d) => d);
      shiftSlotRepo.save.mockResolvedValue([]);
      workCycleRepo.findOne.mockResolvedValueOnce({ id: 'c1', status: WorkCycleStatus.ACTIVE, slots: [{}, {}], templates: [] });

      const cycle = await service.createWorkCycle('s1', {
        name: 'Test', cycleType: CycleType.WEEKLY, startDate: '2026-04-08',
        workShiftIds: [s1.id, s2.id],
      });
      expect(cycle).toBeDefined();
      expect(cycle!.slots).toHaveLength(2);

      // 4. Stop cycle
      workCycleRepo.findOne.mockResolvedValue({ id: 'c1', status: WorkCycleStatus.ACTIVE });
      await service.stopWorkCycle('c1', { stopImmediately: true });
      expect(workCycleRepo.update).toHaveBeenCalledWith('c1', expect.objectContaining({ status: WorkCycleStatus.STOPPED }));

      // 5. Create new cycle (should succeed after stop)
      workCycleRepo.findOne.mockResolvedValueOnce(null); // no active
      workCycleRepo.create.mockReturnValue({ id: 'c2', storeId: 's1', status: WorkCycleStatus.ACTIVE });
      workCycleRepo.save.mockResolvedValue({ id: 'c2' });
      workCycleRepo.findOne.mockResolvedValueOnce({ id: 'c2', status: WorkCycleStatus.ACTIVE, slots: [], templates: [] });

      const c2 = await service.createWorkCycle('s1', { name: 'New', cycleType: CycleType.DAILY, startDate: '2026-04-15' });
      expect(c2).toBeDefined();
      expect(c2!.id).toBe('c2');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  EDGE CASES
  // ═══════════════════════════════════════════════════════════════════════
  describe('Edge Cases', () => {
    it('should calculate MONTHLY endDate correctly (March → 31 days)', async () => {
      workCycleRepo.findOne.mockResolvedValueOnce(null);
      workCycleRepo.create.mockImplementation((d) => d);
      workCycleRepo.save.mockImplementation((e) => Promise.resolve({ id: 'c1', ...e }));
      workCycleRepo.findOne.mockResolvedValueOnce({ id: 'c1', slots: [], templates: [] });

      await service.createWorkCycle('s1', { name: 'M', cycleType: CycleType.MONTHLY, startDate: '2026-03-01' });

      expect(workCycleRepo.create).toHaveBeenCalledWith(expect.objectContaining({ endDate: '2026-03-31' }));
    });

    it('should handle February (28 days, non-leap year)', async () => {
      workCycleRepo.findOne.mockResolvedValueOnce(null);
      workCycleRepo.create.mockImplementation((d) => d);
      workCycleRepo.save.mockImplementation((e) => Promise.resolve({ id: 'c1', ...e }));
      workCycleRepo.findOne.mockResolvedValueOnce({ id: 'c1', slots: [], templates: [] });

      await service.createWorkCycle('s1', { name: 'F', cycleType: CycleType.MONTHLY, startDate: '2026-02-01' });

      expect(workCycleRepo.create).toHaveBeenCalledWith(expect.objectContaining({ endDate: '2026-02-28' }));
    });

    it('should reject creating cycle with error message', async () => {
      workCycleRepo.findOne.mockResolvedValue({ id: 'act', status: WorkCycleStatus.ACTIVE });

      await expect(service.createWorkCycle('s1', {
        name: 'X', cycleType: CycleType.WEEKLY, startDate: '2026-04-08',
      })).rejects.toThrow('Cửa hàng đã có chu kỳ đang hoạt động');
    });
  });
});
