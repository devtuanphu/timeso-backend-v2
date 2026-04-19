import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, MoreThanOrEqual, Between, Not, IsNull, DataSource } from 'typeorm';
import * as QRCode from 'qrcode';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { SalaryAdjustment, AdjustmentType, SalaryChangeType } from './entities/salary-adjustment.entity';
import { SalaryAdjustmentReason } from './entities/salary-adjustment-reason.entity';
import { EmployeePaymentHistory } from './entities/employee-payment-history.entity';
import { StorePaymentAccount } from './entities/store-payment-account.entity';
import { ShiftChangeRequest, ShiftChangeRequestStatus } from './entities/shift-change-request.entity';
import { BonusWorkRequest, BonusWorkRequestStatus } from './entities/bonus-work-request.entity';
import { Store, StoreStatus } from './entities/store.entity';
import { StoreEmployeeType } from './entities/store-employee-type.entity';
import { StoreRole } from './entities/store-role.entity';
import { EmployeeProfile, EmploymentStatus, WorkingStatus } from './entities/employee-profile.entity';
import { EmployeeProfileRole } from './entities/employee-profile-role.entity';
import { EmployeeContract, PaymentType } from './entities/employee-contract.entity';
import { WorkShift } from './entities/work-shift.entity';
import { Asset } from './entities/asset.entity';
import { Product } from './entities/product.entity';
import { AssetUnit } from './entities/asset-unit.entity';
import { ProductUnit } from './entities/product-unit.entity';
import { AssetCategory } from './entities/asset-category.entity';
import { AssetStatus } from './entities/asset-status.entity';
import { ProductCategory } from './entities/product-category.entity';
import { ProductStatus } from './entities/product-status.entity';
import { AssetExportType } from './entities/asset-export-type.entity';
import { ProductExportType } from './entities/product-export-type.entity';

import { AssetExportDto } from './dto/asset-export.dto';
import { ProductExportDto, CreateProductExportTypeDto } from './dto/product-export.dto';



import { MonthlyPayroll } from './entities/monthly-payroll.entity';
import { SalaryConfig, ConfigStatus } from './entities/salary-config.entity';
import { EmployeeSalary, PaymentStatus } from './entities/employee-salary.entity';
import { KpiType } from './entities/kpi-type.entity';
import { KpiUnit } from './entities/kpi-unit.entity';
import { KpiPeriod } from './entities/kpi-period.entity';
import { EmployeeKpi, KpiStatus } from './entities/employee-kpi.entity';
import { KpiTask } from './entities/kpi-task.entity';
import { Feedback, FeedbackStatus } from './entities/feedback.entity';
import { FaceRecognitionService } from './face-recognition.service';
import { DailyEmployeeReport } from './entities/daily-employee-report.entity';
import { EmployeeMonthlySummary } from './entities/employee-monthly-summary.entity';
import { EmployeePerformance, PerformanceType } from './entities/employee-performance.entity';
import { EmployeeLeaveRequest, LeaveRequestStatus } from './entities/employee-leave-request.entity';
import { EmployeeFace } from './entities/employee-face.entity';
import { AttendanceLog, AttendanceLogType, AttendanceMethod } from './entities/attendance-log.entity';
import { AttendanceStatus } from './entities/shift-management.entity';
import { EmployeeAssetAssignment, AssetAssignmentStatus } from './entities/employee-asset-assignment.entity';
import { StoreEvent, StoreEventType } from './entities/store-event.entity';
import {
  StockTransaction,
  StockTransactionType,
  StockTransactionStatus,
  StockTransactionDetail,
} from './entities/stock-transaction.entity';
import {
  WorkCycle,
  ShiftSlot,
  ShiftAssignment,
  ShiftSwap,
  WorkCycleStatus,
  ShiftAssignmentStatus,
  ShiftSwapStatus,
  CycleType,
  CycleShiftTemplate,
  WeekDaySchedule,
} from './entities/shift-management.entity';
import { KpiApprovalRequest, KpiRequestStatus } from './entities/kpi-approval-request.entity';
import { InventoryReport, InventoryReportStatus } from './entities/inventory-report.entity';
import {
  ServiceCategory,
  ServiceItem,
  ServiceItemRecipe,
  ServiceType,
} from './entities/service-item.entity';
import {
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  PaymentStatus as OrderPaymentStatus,
} from './entities/order.entity';
import { EmployeeTerminationReason } from './entities/employee-termination-reason.entity';
import { StoreProbationSetting } from './entities/store-probation-setting.entity';
import { StoreSkill } from './entities/store-skill.entity';
import {
  CreateStoreSkillDto,
  UpdateStoreSkillDto,
  CreateStorePayrollPaymentDto,
  UpdateStorePayrollPaymentDto,
  PayrollMonthlySummaryResponseDto,
  UpdatePersonalInfoDto,
} from './dto/store-response.dto';

import { StoreApprovalSettingDto } from './dto/store-approval-setting.dto';
import { StoreTimekeepingSettingDto } from './dto/store-timekeeping-setting.dto';
import { UpdatePayrollSettingDto } from './dto/store-payroll-setting.dto';



import { StorePayrollPaymentHistory } from './entities/store-payroll-payment-history.entity';
import { SalaryFundHistory } from './entities/salary-fund-history.entity';
import { SalaryAdvanceRequest, AdvanceRequestStatus } from './entities/salary-advance-request.entity';
import { StoreApprovalSetting } from './entities/store-approval-setting.entity';
import { StoreTimekeepingSetting } from './entities/store-timekeeping-setting.entity';
import { StorePayrollSetting, PayrollCalculationMethod } from './entities/store-payroll-setting.entity';
import { StorePayrollRule, PayrollRuleCategory, PayrollCalcType } from './entities/store-payroll-rule.entity';
import { StorePayrollIncrementRule, IncrementRuleType } from './entities/store-payroll-increment-rule.entity';
import { StoreInternalRule } from './entities/store-internal-rule.entity';
import { UpdateInternalRuleDto } from './dto/store-internal-rule.dto';
import { StorePermissionConfig } from './entities/store-permission-config.entity';
import { StorePermissionConfigDto } from './dto/store-permission-config.dto';
import { StoreShiftConfig, WeekDay, TimekeepingRequirement } from './entities/store-shift-config.entity';
import { CreateStoreShiftConfigDto, UpdateStoreShiftConfigDto } from './dto/store-shift-config.dto';
import { CreateFnbServiceItemDto, RecipeDto, CreateYieldServiceItemDto, CreatePersonalCareItemDto, CreatePetCareItemDto } from './dto/order-management.dto';


import { AccountStatus } from '../accounts/entities/account.entity';

import { AccountIdentityDocument, VerifiedStatus } from '../accounts/entities/account-identity-document.entity';
import { AccountFinance } from '../accounts/entities/account-finance.entity';
import { AccountsService } from '../accounts/accounts.service';

import { MailService } from '../mail/mail.service';
@Injectable()
export class StoresService {
  private readonly logger = new Logger(StoresService.name);

  constructor(
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    @InjectRepository(StoreEmployeeType)
    private readonly employeeTypeRepository: Repository<StoreEmployeeType>,
    @InjectRepository(StoreRole)
    private readonly roleRepository: Repository<StoreRole>,
    @InjectRepository(EmployeeProfile)
    private readonly profileRepository: Repository<EmployeeProfile>,
    @InjectRepository(EmployeeProfileRole)
    private readonly profileRoleRepository: Repository<EmployeeProfileRole>,
    @InjectRepository(EmployeeContract)
    private readonly contractRepository: Repository<EmployeeContract>,
    @InjectRepository(WorkShift)
    private readonly workShiftRepository: Repository<WorkShift>,
    @InjectRepository(Asset)
    private readonly assetRepository: Repository<Asset>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(AssetUnit)
    private readonly assetUnitRepository: Repository<AssetUnit>,
    @InjectRepository(ProductUnit)
    private readonly productUnitRepository: Repository<ProductUnit>,
    @InjectRepository(MonthlyPayroll)
    private readonly payrollRepository: Repository<MonthlyPayroll>,
    @InjectRepository(SalaryConfig)
    private readonly salaryConfigRepository: Repository<SalaryConfig>,
    @InjectRepository(EmployeeSalary)
    private readonly employeeSalaryRepository: Repository<EmployeeSalary>,
    @InjectRepository(KpiType)
    private readonly kpiTypeRepository: Repository<KpiType>,
    @InjectRepository(AssetCategory)
    private readonly assetCategoryRepository: Repository<AssetCategory>,
    @InjectRepository(AssetStatus)
    private readonly assetStatusRepository: Repository<AssetStatus>,
    @InjectRepository(ProductCategory)
    private readonly productCategoryRepository: Repository<ProductCategory>,
    @InjectRepository(ProductStatus)
    private readonly productStatusRepository: Repository<ProductStatus>,

    @InjectRepository(EmployeeKpi)
    private readonly employeeKpiRepository: Repository<EmployeeKpi>,
    @InjectRepository(KpiUnit)
    private readonly kpiUnitRepository: Repository<KpiUnit>,
    @InjectRepository(KpiPeriod)
    private readonly kpiPeriodRepository: Repository<KpiPeriod>,
    @InjectRepository(KpiTask)
    private readonly kpiTaskRepository: Repository<KpiTask>,
    @InjectRepository(DailyEmployeeReport)
    private readonly dailyReportRepository: Repository<DailyEmployeeReport>,
    @InjectRepository(EmployeeMonthlySummary)
    private readonly monthlySummaryRepository: Repository<EmployeeMonthlySummary>,
    @InjectRepository(StoreEvent)
    private readonly eventRepository: Repository<StoreEvent>,
    @InjectRepository(StockTransaction)
    private readonly stockTransactionRepository: Repository<StockTransaction>,
    @InjectRepository(StockTransactionDetail)
    private readonly stockTransactionDetailRepository: Repository<StockTransactionDetail>,
    @InjectRepository(WorkCycle)
    private readonly workCycleRepository: Repository<WorkCycle>,
    @InjectRepository(ShiftSlot)
    private readonly shiftSlotRepository: Repository<ShiftSlot>,
    @InjectRepository(ShiftAssignment)
    private readonly shiftAssignmentRepository: Repository<ShiftAssignment>,
    @InjectRepository(ShiftSwap)
    private readonly shiftSwapRepository: Repository<ShiftSwap>,
    @InjectRepository(ServiceCategory)
    private readonly serviceCategoryRepository: Repository<ServiceCategory>,
    @InjectRepository(ServiceItem)
    private readonly serviceItemRepository: Repository<ServiceItem>,
    @InjectRepository(ServiceItemRecipe)
    private readonly serviceItemRecipeRepository: Repository<ServiceItemRecipe>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(EmployeePerformance)
    private readonly performanceRepository: Repository<EmployeePerformance>,
    @InjectRepository(EmployeeLeaveRequest)
    private readonly leaveRequestRepository: Repository<EmployeeLeaveRequest>,
    @InjectRepository(EmployeeAssetAssignment)
    private readonly assetAssignmentRepository: Repository<EmployeeAssetAssignment>,
    @InjectRepository(EmployeeTerminationReason)
    private readonly terminationReasonRepository: Repository<EmployeeTerminationReason>,
    @InjectRepository(StoreProbationSetting)
    private readonly probationSettingRepository: Repository<StoreProbationSetting>,
    @InjectRepository(StoreSkill)
    private readonly skillRepository: Repository<StoreSkill>,
    @InjectRepository(StorePayrollPaymentHistory)
    private readonly paymentHistoryRepository: Repository<StorePayrollPaymentHistory>,
    @InjectRepository(SalaryFundHistory)
    private readonly salaryFundHistoryRepository: Repository<SalaryFundHistory>,
    @InjectRepository(SalaryAdvanceRequest)
    private readonly salaryAdvanceRequestRepository: Repository<SalaryAdvanceRequest>,
    @InjectRepository(SalaryAdjustment)
    private readonly salaryAdjustmentRepository: Repository<SalaryAdjustment>,
    @InjectRepository(SalaryAdjustmentReason)
    private readonly salaryAdjustmentReasonRepository: Repository<SalaryAdjustmentReason>,
    @InjectRepository(EmployeePaymentHistory)
    private readonly employeePaymentHistoryRepository: Repository<EmployeePaymentHistory>,
    @InjectRepository(StorePaymentAccount)
    private readonly storePaymentAccountRepository: Repository<StorePaymentAccount>,
    @InjectRepository(KpiApprovalRequest)
    private readonly kpiApprovalRequestRepository: Repository<KpiApprovalRequest>,
    @InjectRepository(InventoryReport)
    private readonly inventoryReportRepository: Repository<InventoryReport>,
    @InjectRepository(AssetExportType)
    private readonly assetExportTypeRepository: Repository<AssetExportType>,
    @InjectRepository(ProductExportType)
    private readonly productExportTypeRepository: Repository<ProductExportType>,
    @InjectRepository(StoreApprovalSetting)
    private readonly approvalSettingRepository: Repository<StoreApprovalSetting>,
    @InjectRepository(StoreTimekeepingSetting)
    private readonly timekeepingSettingRepository: Repository<StoreTimekeepingSetting>,
    @InjectRepository(StorePayrollSetting)
    private readonly payrollSettingRepository: Repository<StorePayrollSetting>,
    @InjectRepository(StorePayrollRule)
    private readonly payrollRuleRepository: Repository<StorePayrollRule>,
    @InjectRepository(StorePayrollIncrementRule)
    private readonly payrollIncrementRuleRepository: Repository<StorePayrollIncrementRule>,
    @InjectRepository(AccountIdentityDocument)
    private readonly identityDocRepository: Repository<AccountIdentityDocument>,
    @InjectRepository(StoreInternalRule)
    private readonly internalRuleRepository: Repository<StoreInternalRule>,
    @InjectRepository(StorePermissionConfig)
    private readonly permissionConfigRepository: Repository<StorePermissionConfig>,
    @InjectRepository(StoreShiftConfig)
    private readonly shiftConfigRepository: Repository<StoreShiftConfig>,
    @InjectRepository(CycleShiftTemplate)
    private readonly cycleTemplateRepository: Repository<CycleShiftTemplate>,

    @InjectRepository(AccountFinance)
    private readonly financeRepository: Repository<AccountFinance>,
    @InjectRepository(Feedback)
    private readonly feedbackRepository: Repository<Feedback>,
    @InjectRepository(EmployeeFace)
    private readonly employeeFaceRepository: Repository<EmployeeFace>,
    @InjectRepository(AttendanceLog)
    private readonly attendanceLogRepository: Repository<AttendanceLog>,
    @InjectRepository(ShiftChangeRequest)
    private readonly shiftChangeRequestRepository: Repository<ShiftChangeRequest>,
    @InjectRepository(BonusWorkRequest)
    private readonly bonusWorkRequestRepository: Repository<BonusWorkRequest>,
    private readonly accountsService: AccountsService,
    private readonly faceRecognitionService: FaceRecognitionService,
    private readonly dataSource: DataSource,
  ) {}






  // Store management
  async create(data: Partial<Store>) {
    const store = this.storeRepository.create(data);
    const savedStore = await this.storeRepository.save(store);
    
    // Tạo DailyEmployeeReport cho ngày hôm nay
    await this.createDailyReportForStore(savedStore.id);
    
    // Tạo MonthlyPayroll cho tháng hiện tại
    await this.createMonthlyPayrollForStore(savedStore.id);

    // Tạo Default Probation Setting
    await this.createDefaultProbationSetting(savedStore.id);

    // Tạo Default Approval Setting (Thiết lập phê duyệt)
    await this.createDefaultApprovalSetting(savedStore.id);

    // Tạo Default Timekeeping Setting (Thiết lập chấm công & ca làm)
    await this.createDefaultTimekeepingSetting(savedStore.id);

    // Tạo Default Payroll Setting (Thiết lập lương)
    await this.createDefaultPayrollSetting(savedStore.id);

    // Tạo Default Internal Rules (Nội quy nội bộ)
    await this.createDefaultInternalRules(savedStore.id);

    // Tạo Default Shift Config (Cấu hình ca làm việc)
    await this.createDefaultShiftConfig(savedStore.id);

    // Auto-geocode address → lat/lng + Auto QR
    try {
      const fullAddress = [data.addressLine, data.ward, data.city]
        .filter(Boolean)
        .join(', ');

      if (fullAddress) {
        const geocodeResult = await this.searchPlaces(fullAddress);
        if (geocodeResult.results?.length > 0) {
          const firstResult = geocodeResult.results[0];
          savedStore.latitude = firstResult.lat;
          savedStore.longitude = firstResult.lng;
          await this.storeRepository.save(savedStore);
          this.logger.debug(`[CreateStore] Auto-geocoded: "${fullAddress}" → lat=${firstResult.lat}, lng=${firstResult.lng}`);
        }
      }

      // Auto generate QR code
      await this.generateStoreQR(savedStore.id);
      this.logger.debug(`[CreateStore] Auto-generated QR for store ${savedStore.id}`);
    } catch (err) {
      // Non-blocking: geocode/QR failure should not fail store creation
      this.logger.warn(`[CreateStore] Auto-geocode/QR failed: ${err?.message || err}`);
    }

    return savedStore;
  }


  async updateStore(id: string, data: Partial<Store>) {
    const store = await this.findById(id);
    if (!store) throw new NotFoundException('Cửa hàng không tồn tại');
    
    // Auto-geocode address if changed
    try {
      if (data.addressLine || data.ward || data.city) {
        const fullAddress = [data.addressLine || store.addressLine, data.ward || store.ward, data.city || store.city]
          .filter(Boolean)
          .join(', ');

        if (fullAddress) {
          const geocodeResult = await this.searchPlaces(fullAddress);
          if (geocodeResult.results?.length > 0) {
            const firstResult = geocodeResult.results[0];
            data.latitude = firstResult.lat;
            data.longitude = firstResult.lng;
          }
        }
      }
    } catch (err) {
      this.logger.warn(`[UpdateStore] Auto-geocode failed: ${err?.message || err}`);
    }

    await this.storeRepository.update(id, data);
    return this.findById(id);
  }

  async createDefaultProbationSetting(storeId: string) {
    const DEFAULT_ATTENDANCE_CHECKLIST = [
      { label: 'Đi làm đúng giờ [Bắt buộc]', targetValue: 28, unit: 'ngày / tháng', checked: true, hidden: false },
      { label: 'Đủ số ca làm việc [Bắt buộc]', targetValue: 28, unit: 'ca / tháng', checked: false, hidden: false },
      { label: 'Không nghỉ không phép', checked: false, hidden: false },
      { label: 'Sẵn sàng làm thêm giờ', checked: false, hidden: false },
    ];

    const DEFAULT_ATTITUDE_CHECKLIST = [
      { label: 'Thái độ phục vụ khách hàng [Bắt buộc]', checked: false, hidden: false },
      { label: 'Tinh thần đồng đội', checked: false, hidden: false },
      { label: 'Kỹ năng bán hàng', checked: false, hidden: false },
      { label: 'Kỹ năng xử lý tình huống', checked: false, hidden: false },
      { label: 'Đề xuất ý tưởng', checked: false, hidden: false },
    ];

    const defaultSetting = this.probationSettingRepository.create({
      storeId,
      probationDays: 0,
      probationShifts: 0,
      notifyEvaluation: false,
      notifyResultToEmployee: false,
      autoCloseChecklist: false,
      attendanceChecklist: DEFAULT_ATTENDANCE_CHECKLIST,
      attitudeChecklist: DEFAULT_ATTITUDE_CHECKLIST,
      completionBonus: 0,
      isActive: true,
    });
    return this.probationSettingRepository.save(defaultSetting);
  }

  async createDefaultApprovalSetting(storeId: string) {
    const defaultSetting = this.approvalSettingRepository.create({
      storeId,
      enableShiftRegistration: true,
      enableLeaveRequest: true,
      enableShiftSwap: true,
      leaveNoticeHours: 24,
      leaveLimitPerMonth: 2,
      swapNoticeHours: 12,
      swapLimitPerMonth: 2,
      lateEarlyNoticeHours: 2,
      lateEarlyLimitPerMonth: 2,
      shiftRegisterOpenTime: '08:00',
      shiftRegisterOpenDay: 'Monday',
      shiftRegisterCloseTime: '00:00',
      shiftRegisterCloseDay: 'Thursday',
      personnelWarningHours: 24,
      isActive: true,
    });
    return this.approvalSettingRepository.save(defaultSetting);
  }

  async createDefaultPayrollSetting(storeId: string) {
    const setting = this.payrollSettingRepository.create({
      storeId,
      calculationMethod: PayrollCalculationMethod.FLEXIBLE,
    });
    const savedSetting = await this.payrollSettingRepository.save(setting);

    // 1. Create Default Rules (Bonuses, Fines, Benefits)
    const defaultRules = [
      // Bonuses
      { name: 'Thưởng chuyên cần', category: PayrollRuleCategory.BONUS, ruleType: 'ATTENDANCE', calcType: PayrollCalcType.AMOUNT, value: 200000 },
      { name: 'Thưởng hiệu suất', category: PayrollRuleCategory.BONUS, ruleType: 'KPI', calcType: PayrollCalcType.AMOUNT, value: 200000 },
      // Fines
      { name: 'Vi phạm nội quy', category: PayrollRuleCategory.FINE, ruleType: 'DISCIPLINE', calcType: PayrollCalcType.AMOUNT, value: 200000 },
      { name: 'Vi phạm đi trễ - về sớm', category: PayrollRuleCategory.FINE, ruleType: 'LATE_EARLY', calcType: PayrollCalcType.AMOUNT, value: 50000 },
      { name: 'Không check in-out', category: PayrollRuleCategory.FINE, ruleType: 'MISSING_CHECK', calcType: PayrollCalcType.AMOUNT, value: 200000 },
      { name: 'Vắng mặt không phép', category: PayrollRuleCategory.FINE, ruleType: 'ABSENT', calcType: PayrollCalcType.SHIFT, value: 1 },
      // Benefits
      { name: 'Làm việc ngày tết', category: PayrollRuleCategory.BENEFIT, ruleType: 'TET_WORK', calcType: PayrollCalcType.AMOUNT, value: 300000 },
      { name: 'Làm việc ngày lễ', category: PayrollRuleCategory.BENEFIT, ruleType: 'HOLIDAY_WORK', calcType: PayrollCalcType.AMOUNT, value: 300000 },
      { name: 'Làm việc ban đêm', category: PayrollRuleCategory.BENEFIT, ruleType: 'NIGHT_WORK', calcType: PayrollCalcType.AMOUNT, value: 300000 },
      { name: 'Sinh nhật/ kỷ nhiệm', category: PayrollRuleCategory.BENEFIT, ruleType: 'BIRTHDAY', calcType: PayrollCalcType.AMOUNT, value: 300000 },
    ];

    for (const rule of defaultRules) {
      await this.payrollRuleRepository.save(this.payrollRuleRepository.create({ ...rule, storeId }));
    }

    // 2. Create Default Increment Rules
    const defaultIncrementRules = [
      { type: IncrementRuleType.PERIODIC, conditionType: 'DATE', conditionValue: '01/06', calcType: PayrollCalcType.PERCENTAGE, value: 5 },
      { type: IncrementRuleType.SENIORITY, conditionType: 'DAYS', conditionValue: '180', calcType: PayrollCalcType.PERCENTAGE, value: 5 },
      { type: IncrementRuleType.SENIORITY, conditionType: 'DAYS', conditionValue: '360', calcType: PayrollCalcType.AMOUNT, value: 300000 },
    ];

    for (const incRule of defaultIncrementRules) {
      await this.payrollIncrementRuleRepository.save(this.payrollIncrementRuleRepository.create({ ...incRule, storeId }));
    }

    return savedSetting;
  }



  async createDefaultTimekeepingSetting(storeId: string) {
    // 1. Create Default Setting
    const defaultSetting = this.timekeepingSettingRepository.create({
      storeId,
      enableFlexibleShift: false,
      requireLocation: true,
      allowedLateMinutes: 0,
      deductWorkTimeIfLate: true,
      showLateAlert: true,
      countFullTimeIfLate: false,
      earlyCheckinMinutes: 15,
      lateCheckoutMinutes: 15,
      enableOvertimeMultiplier: false,
      overtimeMultiplier: 1.5,
      notifyLateShift: false,
      isActive: true,
    });
    await this.timekeepingSettingRepository.save(defaultSetting);

    // 2. Create Default Shifts (Sáng, Chiều, Tối)
    const shiftsToCreate = [
      { shiftName: 'Ca sáng (fulltime)', startTime: '07:00:00', endTime: '17:00:00' },
      { shiftName: 'Ca chiều (fulltime)', startTime: '12:00:00', endTime: '20:00:00' },
      { shiftName: 'Ca tối (parttime)', startTime: '18:00:00', endTime: '22:00:00' },
    ];

    for (const shift of shiftsToCreate) {
      const newShift = this.workShiftRepository.create({
        storeId,
        shiftName: shift.shiftName,
        startTime: shift.startTime,
        endTime: shift.endTime,
        isActive: true,
      });
      await this.workShiftRepository.save(newShift);
    }
  }



  async findAllByOwner(ownerId: string) {
    return this.storeRepository.find({ where: { ownerAccountId: ownerId } });
  }

  async findById(id: string) {
    return this.storeRepository.findOne({ where: { id } });
  }

  async getEmployeesBasicInfo(ids: string[]) {
    if (!ids || ids.length === 0) return [];

    const profiles = await this.profileRepository.find({
      where: { id: In(ids) },
      relations: ['account', 'storeRole', 'employeeType'],
    });

    return profiles.map((profile) => ({
      id: profile.id,
      fullName: profile.account?.fullName,
      avatar: profile.account?.avatar,
      storeRole: profile.storeRole?.name,
      employeeType: profile.employeeType?.name,
    }));
  }

  async getEmployeeMonthlySummaries(storeId: string, monthStr?: string) {
    // Parse month or use current month
    let targetMonth: Date;
    if (monthStr) {
      targetMonth = new Date(monthStr);
    } else {
      targetMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    }

    // Get all employees in the store
    const employees = await this.profileRepository.find({
      where: { storeId },
      select: ['id'],
    });

    const employeeIds = employees.map(e => e.id);

    if (employeeIds.length === 0) {
      return [];
    }

    // Get monthly summaries for these employees
    const summaries = await this.monthlySummaryRepository.find({
      where: {
        employeeProfileId: In(employeeIds),
        month: targetMonth,
      },
      order: { employeeProfileId: 'ASC' },
    });

    return summaries;
  }

  // Employee Type management
  async createEmployeeType(storeId: string, data: Partial<StoreEmployeeType>) {
    const type = this.employeeTypeRepository.create({ ...data, storeId });
    return this.employeeTypeRepository.save(type);
  }

  async getEmployeeTypes(storeId: string) {
    return this.employeeTypeRepository.find({
      where: { storeId, isActive: true },
    });
  }

  // Employee Termination Reason management
  async createTerminationReason(storeId: string, name: string) {
    const reason = this.terminationReasonRepository.create({ storeId, name });
    return this.terminationReasonRepository.save(reason);
  }

  async getTerminationReasons(storeId: string) {
    return this.terminationReasonRepository.find({
      where: { storeId, isActive: true },
    });
  }

  async updateTerminationReason(id: string, name: string) {
    await this.terminationReasonRepository.update(id, { name });
    return this.terminationReasonRepository.findOne({ where: { id } });
  }

  async deleteTerminationReason(id: string) {
    return this.terminationReasonRepository.delete(id);
  }

  // Probation Settings management
  async upsertProbationSetting(storeId: string, data: Partial<StoreProbationSetting>) {
    let setting = await this.probationSettingRepository.findOne({ where: { storeId } });

    if (setting) {
      Object.assign(setting, data);
    } else {
      setting = this.probationSettingRepository.create({ ...data, storeId });
    }

    return this.probationSettingRepository.save(setting);
  }

  async getProbationSetting(storeId: string) {
    let setting = await this.probationSettingRepository.findOne({ where: { storeId } });

    const DEFAULT_ATTENDANCE_CHECKLIST = [
      { label: 'Đi làm đúng giờ [Bắt buộc]', targetValue: 28, unit: 'ngày / tháng', checked: true, hidden: false },
      { label: 'Đủ số ca làm việc [Bắt buộc]', targetValue: 28, unit: 'ca / tháng', checked: false, hidden: false },
      { label: 'Không nghỉ không phép', checked: false, hidden: false },
      { label: 'Sẵn sàng làm thêm giờ', checked: false, hidden: false },
    ];

    const DEFAULT_ATTITUDE_CHECKLIST = [
      { label: 'Thái độ phục vụ khách hàng [Bắt buộc]', checked: false, hidden: false },
      { label: 'Tinh thần đồng đội', checked: false, hidden: false },
      { label: 'Kỹ năng bán hàng', checked: false, hidden: false },
      { label: 'Kỹ năng xử lý tình huống', checked: false, hidden: false },
      { label: 'Đề xuất ý tưởng', checked: false, hidden: false },
    ];

    if (!setting) {
      // Create and save defaults if missing
      setting = await this.createDefaultProbationSetting(storeId);
    } else if (
      (!setting.attendanceChecklist || setting.attendanceChecklist.length === 0) &&
      (!setting.attitudeChecklist || setting.attitudeChecklist.length === 0)
    ) {
      // Lazy migration: Populate empty checklists with defaults
      setting.attendanceChecklist = DEFAULT_ATTENDANCE_CHECKLIST;
      setting.attitudeChecklist = DEFAULT_ATTITUDE_CHECKLIST;
      setting = await this.probationSettingRepository.save(setting);
    }

    return setting;
  }

  // --- Approval Settings ---
  async getApprovalSetting(storeId: string) {
    let setting = await this.approvalSettingRepository.findOne({
      where: { storeId },
      relations: [
        'primaryApprover',
        'primaryApprover.account',
        'primaryApprover.storeRole',
        'backupApprover',
        'backupApprover.account',
        'backupApprover.storeRole',
      ],
    });

    if (!setting) {
      setting = await this.createDefaultApprovalSetting(storeId);
      // Re-fetch to get relations if needed, or just return defaults with nulls
      return setting;
    }

    const formatApprover = (profile: any) => {
      if (!profile) return null;
      return {
        id: profile.id,
        fullName: profile.account?.fullName || 'N/A',
        role: profile.storeRole?.name || 'Nhân viên',
      };
    };

    return {
      ...setting,
      primaryApprover: formatApprover(setting.primaryApprover),
      backupApprover: formatApprover(setting.backupApprover),
    };
  }


  async upsertApprovalSetting(storeId: string, data: StoreApprovalSettingDto) {
    let setting = await this.approvalSettingRepository.findOne({ where: { storeId } });

    if (setting) {
      Object.assign(setting, data);
    } else {
      setting = this.approvalSettingRepository.create({
        ...data,
        storeId,
      });
    }

    return this.approvalSettingRepository.save(setting);
  }

  // --- Timekeeping Settings ---
  async getTimekeepingSetting(storeId: string) {
    let setting = await this.timekeepingSettingRepository.findOne({ where: { storeId } });
    if (!setting) {
      await this.createDefaultTimekeepingSetting(storeId);
      setting = await this.timekeepingSettingRepository.findOne({ where: { storeId } });
    }

    const shifts = await this.workShiftRepository.find({ where: { storeId } });
    return { ...setting, shifts };
  }

  async upsertTimekeepingSetting(storeId: string, data: StoreTimekeepingSettingDto) {
    let setting = await this.timekeepingSettingRepository.findOne({ where: { storeId } });

    if (setting) {
      Object.assign(setting, data);
    } else {
      setting = this.timekeepingSettingRepository.create({
        ...data,
        storeId,
      });
    }

    // Handle shifts update if present
    if (data.shifts && Array.isArray(data.shifts)) {
      for (const shiftData of data.shifts) {
        if (shiftData.id) {
          await this.workShiftRepository.update(shiftData.id, shiftData);
        }
      }
    }

    return this.timekeepingSettingRepository.save(setting);
  }

  // --- Payroll Settings ---
  async getPayrollSetting(storeId: string) {
    let setting = await this.payrollSettingRepository.findOne({ where: { storeId } });
    if (!setting) {
      setting = this.payrollSettingRepository.create({ storeId, calculationMethod: PayrollCalculationMethod.FLEXIBLE });
      await this.payrollSettingRepository.save(setting);
    }

    const rules = await this.payrollRuleRepository.find({ where: { storeId, isActive: true } });
    const incrementRules = await this.payrollIncrementRuleRepository.find({ where: { storeId, isActive: true } });
    const roles = await this.roleRepository.find({ where: { storeId, isActive: true } });

    return {
      ...setting,
      bonuses: rules.filter(r => r.category === PayrollRuleCategory.BONUS),
      fines: rules.filter(r => r.category === PayrollRuleCategory.FINE),
      benefits: rules.filter(r => r.category === PayrollRuleCategory.BENEFIT),
      incrementRules,
      roles,
    };
  }

  async upsertPayrollSetting(storeId: string, data: UpdatePayrollSettingDto) {
    // 1. Update main setting
    let setting = await this.payrollSettingRepository.findOne({ where: { storeId } });
    const mainData = {
      calculationMethod: data.calculationMethod as PayrollCalculationMethod,
      priorityCalcType: data.priorityCalcType,
      priorityCalcValue: data.priorityCalcValue,
      alternativeCalcType: data.alternativeCalcType,
      alternativeCalcValue: data.alternativeCalcValue,
    };

    if (setting) {
      Object.assign(setting, mainData);
    } else {
      setting = this.payrollSettingRepository.create({ ...mainData, storeId });
    }
    await this.payrollSettingRepository.save(setting);

    // 2. Sync Rules (Bonuses, Fines, Benefits)
    const incomingRules = [
      ...(data.bonuses || []).map(r => ({ ...r, category: PayrollRuleCategory.BONUS })),
      ...(data.fines || []).map(r => ({ ...r, category: PayrollRuleCategory.FINE })),
      ...(data.benefits || []).map(r => ({ ...r, category: PayrollRuleCategory.BENEFIT })),
    ];

    const currentRules = await this.payrollRuleRepository.find({ where: { storeId } });
    const rulesToSave: StorePayrollRule[] = [];

    for (const ruleData of incomingRules) {
      let rule: StorePayrollRule | undefined;

      if (ruleData.id) {
        rule = currentRules.find(r => r.id === ruleData.id);
      } else {
        rule = currentRules.find(r => r.name === ruleData.name && r.category === ruleData.category && r.ruleType === ruleData.ruleType);
      }


      const payload = {
        ...ruleData,
        calcType: ruleData.calcType as PayrollCalcType,
        storeId,
      };

      if (rule) {
        Object.assign(rule, payload);
      } else {
        rule = this.payrollRuleRepository.create(payload);
      }
      rulesToSave.push(rule);
    }

    // Remove rules not in payload
    const incomingIds = rulesToSave.map(r => r.id).filter(id => !!id);
    const toRemoveIds = currentRules
      .filter(r => !incomingIds.includes(r.id))
      .map(r => r.id);
    
    if (toRemoveIds.length > 0) {
      await this.payrollRuleRepository.delete({ id: In(toRemoveIds) });
    }
    if (rulesToSave.length > 0) {
      await this.payrollRuleRepository.save(rulesToSave);
    }

    // 3. Sync Increment Rules
    if (data.incrementRules) {
      const currentIncRules = await this.payrollIncrementRuleRepository.find({ where: { storeId } });
      const incToSave: StorePayrollIncrementRule[] = [];

      for (const incData of data.incrementRules) {
        let incRule: StorePayrollIncrementRule | undefined;

        if (incData.id) {
          incRule = currentIncRules.find(r => r.id === incData.id);
        } else {
          incRule = currentIncRules.find(r => r.type === (incData.type as IncrementRuleType) && r.conditionType === incData.conditionType && r.conditionValue === incData.conditionValue);
        }


        const payload = {
          ...incData,
          type: incData.type as IncrementRuleType,
          calcType: incData.calcType as PayrollCalcType,
          storeId,
        };

        if (incRule) {
          Object.assign(incRule, payload);
        } else {
          incRule = this.payrollIncrementRuleRepository.create(payload);
        }
        incToSave.push(incRule);
      }

      const incomingIncIds = incToSave.map(r => r.id).filter(id => !!id);
      const incToRemoveIds = currentIncRules
        .filter(r => !incomingIncIds.includes(r.id))
        .map(r => r.id);

      if (incToRemoveIds.length > 0) {
        await this.payrollIncrementRuleRepository.delete({ id: In(incToRemoveIds) });
      }
      if (incToSave.length > 0) {
        await this.payrollIncrementRuleRepository.save(incToSave);
      }
    }






    // 4. Update Role coefficients/allowances
    if (data.roles) {
      for (const roleData of data.roles) {
        await this.roleRepository.update(roleData.id, {
          coefficient: roleData.coefficient,
          allowance: roleData.allowance,
        });
      }
    }

    return this.getPayrollSetting(storeId);
  }



  // --- Store Skills ---



  async createSkill(storeId: string, data: CreateStoreSkillDto) {
    const skill = this.skillRepository.create({
      ...data,
      storeId,
    });
    return this.skillRepository.save(skill);
  }

  async getSkills(storeId: string) {
    return this.skillRepository.find({
      where: { storeId },
      order: { createdAt: 'DESC' },
    });
  }

  async updateSkill(skillId: string, data: UpdateStoreSkillDto) {
    const skill = await this.skillRepository.findOne({ where: { id: skillId } });
    if (!skill) throw new NotFoundException('Không tìm thấy kỹ năng');

    Object.assign(skill, data);
    return this.skillRepository.save(skill);
  }

  async deleteSkill(skillId: string) {
    const skill = await this.skillRepository.findOne({ where: { id: skillId } });
    if (!skill) throw new NotFoundException('Không tìm thấy kỹ năng');

    return this.skillRepository.remove(skill);
  }

  async assignSkillToEmployee(profileId: string, skillId: string | null) {
    const employee = await this.profileRepository.findOne({
      where: { id: profileId },
    });
    if (!employee) throw new NotFoundException('Không tìm thấy nhân viên');

    employee.skillId = skillId;
    return this.profileRepository.save(employee);
  }

  async getEmployeeSkill(profileId: string) {
    const employee = await this.profileRepository.findOne({
      where: { id: profileId },
      relations: ['skill'],
    });
    if (!employee) throw new NotFoundException('Không tìm thấy nhân viên');

    return employee.skill;
  }

  // Role management is handled later in the file

  // Employee Profile management
  async addEmployee(storeId: string, accountId: string, data: any) {
    // Check probation settings
    const probationSetting = await this.probationSettingRepository.findOne({ where: { storeId } });
    let probationEndsAt: Date | undefined;
    let employmentStatus = EmploymentStatus.ACTIVE;

    if (probationSetting && probationSetting.probationDays > 0) {
      const now = new Date();
      probationEndsAt = new Date(now.getTime() + probationSetting.probationDays * 24 * 60 * 60 * 1000);
      employmentStatus = EmploymentStatus.PROBATION;
    }

    const profile = this.profileRepository.create({
      ...data,
      storeId,
      accountId,
      employmentStatus,
      probationEndsAt,
    });
    return this.profileRepository.save(profile);
  }

  async getEmployeeById(profileId: string) {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      relations: [
        'account',
        'account.identityDocument',
        'account.finance',
        'storeRole',
        'employeeType',
        'workShift',
        'contracts',
        'store',
      ],
    });

    if (!profile) return null;

    // 1. Lấy thống kê tháng hiện tại
    const currentMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    );
    const summary = await this.monthlySummaryRepository.findOne({
      where: {
        employeeProfileId: profileId,
        month: currentMonth,
      },
    });

    // 2. Lấy hoạt động gần đây (lịch sử chấm công)
    const assignments = await this.shiftAssignmentRepository.find({
      where: { employeeId: profileId },
      relations: ['shiftSlot', 'shiftSlot.workShift'],
      order: {
        createdAt: 'DESC',
      },
      take: 20,
    });

    const recentActivities: any[] = [];
    assignments.forEach((assign) => {
      if (assign.checkOutTime) {
        recentActivities.push({
          type: 'CHECK_OUT',
          time: assign.checkOutTime,
          shiftName: assign.shiftSlot?.workShift?.shiftName || 'N/A',
          workDate: assign.shiftSlot?.workDate,
          status: assign.status,
        });
      }
      if (assign.checkInTime) {
        recentActivities.push({
          type: 'CHECK_IN',
          time: assign.checkInTime,
          shiftName: assign.shiftSlot?.workShift?.shiftName || 'N/A',
          workDate: assign.shiftSlot?.workDate,
          status: assign.status,
        });
      }
    });

    // Sắp xếp theo thời gian mới nhất và lấy top 10
    const sortedActivities = recentActivities
      .sort((a, b) => b.time.getTime() - a.time.getTime())
      .slice(0, 10);

    return {
      profile: {
        ...profile,
        totalShifts: summary?.totalShifts || 0,
        completedShifts: summary?.completedShifts || 0,
        onTimeArrivalsCount: summary?.onTimeArrivalsCount || 0,
        lateArrivalsCount: summary?.lateArrivalsCount || 0,
        earlyDeparturesCount: summary?.earlyDeparturesCount || 0,
        authorizedLeavesCount: summary?.authorizedLeavesCount || 0,
        unauthorizedLeavesCount: summary?.unauthorizedLeavesCount || 0,
        estimatedSalary: summary?.estimatedSalary || 0,
        workingStatus: profile.workingStatus,
      },
      monthlySummary: summary,
      recentActivities: sortedActivities,
    };
  }

  async getMyPersonalInfoInStore(storeId: string, accountId: string) {
    const store = await this.storeRepository.findOne({ where: { id: storeId } });
    if (!store) throw new NotFoundException('Không tìm thấy cửa hàng');

    const account = await this.accountsService.findById(accountId);
    if (!account) throw new NotFoundException('Không tìm thấy tài khoản');

    // Tìm profile để lấy Role (nếu có)
    const profile = await this.profileRepository.findOne({
      where: { storeId, accountId },
      relations: ['storeRole'],
    });

    let role = 'Thành viên';
    if (store.ownerAccountId === accountId) {
      role = 'Chủ cửa hàng';
    } else if (profile?.storeRole) {
      role = profile.storeRole.name;
    }

    const idDoc = account.identityDocument;
    const finance = account.finance;

    return {
      fullName: account.fullName,
      gender: account.gender,
      birthday: account.birthday,
      phone: account.phone,
      email: account.email,
      identityCardNumber: idDoc?.documentNumber,
      frontImageUrl: idDoc?.frontImageUrl,
      backImageUrl: idDoc?.backImageUrl,
      address: account.address,
      city: account.city,
      district: account.district,
      bankNumber: finance?.bankNumber,
      bankName: finance?.bankName,

      taxCode: finance?.taxCode,
      header: {
        avatar: account.avatar,
        fullName: account.fullName,
        role: role,
        storeName: store.name,
      },
    };
  }

  async updateMyPersonalInfoInStore(accountId: string, data: UpdatePersonalInfoDto) {
    const account = await this.accountsService.findById(accountId);
    if (!account) throw new NotFoundException('Không tìm thấy tài khoản');

    // 1. Cập nhật bảng Accounts
    const accountUpdate: any = {};
    if (data.fullName) accountUpdate.fullName = data.fullName;
    if (data.gender) accountUpdate.gender = data.gender;
    if (data.birthday) accountUpdate.birthday = data.birthday;
    if (data.phone) accountUpdate.phone = data.phone;
    if (data.email) accountUpdate.email = data.email;
    if (data.address) accountUpdate.address = data.address;
    if (data.city) accountUpdate.city = data.city;
    if (data.district) accountUpdate.district = data.district;
    if ((data as any).avatar) accountUpdate.avatar = (data as any).avatar;

    if (Object.keys(accountUpdate).length > 0) {
      await this.accountsService.update(accountId, accountUpdate);
    }

    // 2. Cập nhật bảng định danh (Identity Document)
    if (data.identityCardNumber || (data as any).frontImage || (data as any).backImage) {
      const identity = await this.identityDocRepository.findOne({ where: { accountId } });
      const identityUpdate: any = {};
      if (data.identityCardNumber) identityUpdate.documentNumber = data.identityCardNumber;
      if ((data as any).frontImage) identityUpdate.frontImageUrl = (data as any).frontImage;
      if ((data as any).backImage) identityUpdate.backImageUrl = (data as any).backImage;

      if (identity) {
        await this.identityDocRepository.update(identity.id, identityUpdate);
      } else {
        await this.identityDocRepository.save({
          accountId,
          docType: 'CCCD',
          verifiedStatus: VerifiedStatus.VERIFIED,
          ...identityUpdate,
        });
      }
    }


    // 3. Cập nhật bảng tài chính (Finance)
    const financeUpdate: any = {};
    if (data.bankName) financeUpdate.bankName = data.bankName;
    if (data.bankNumber) financeUpdate.bankNumber = data.bankNumber;
    if (data.taxCode) financeUpdate.taxCode = data.taxCode;

    if (Object.keys(financeUpdate).length > 0) {
      const finance = await this.financeRepository.findOne({ where: { accountId } });
      if (finance) {
        await this.financeRepository.update({ accountId }, financeUpdate);
      } else {
        await this.financeRepository.save({
          accountId,
          ...financeUpdate,
        });
      }
    }

    // Return updated account data for frontend sync
    const updatedAccount = await this.accountsService.findById(accountId);
    if (!updatedAccount) {
      throw new NotFoundException('Không thể lấy thông tin tài khoản sau khi cập nhật');
    }
    
    return {
      success: true,
      fullName: updatedAccount.fullName,
      phone: updatedAccount.phone,
      email: updatedAccount.email,
      gender: updatedAccount.gender,
      birthday: updatedAccount.birthday,
      avatar: updatedAccount.avatar,
      address: updatedAccount.address,
      city: updatedAccount.city,
      district: updatedAccount.district,
    };

  }




  async getEmployeePerformance(profileId: string) {
    // 0. Lấy thông tin profile và loại nhân viên hiện tại
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      relations: ['employeeType', 'account'],
    });

    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');

    // 1. Lấy thống kê tháng hiện tại
    const currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const summary = await this.monthlySummaryRepository.findOne({
      where: { employeeProfileId: profileId, month: currentMonth },
      relations: ['performances', 'performances.reviewerAccount'],
    });

    // 2. Lấy loại nhân viên tiếp theo (Level + 1)
    let nextType: StoreEmployeeType | null = null;
    if (profile.employeeType) {
      nextType = await this.employeeTypeRepository.findOne({
        where: {
          storeId: profile.storeId,
          level: profile.employeeType.level + 1,
          isActive: true,
        },
      });
    }

    // 3. Tính toán thâm niên
    const tenureMonths = summary?.tenureMonths || 0;
    const years = Math.floor(tenureMonths / 12);
    const months = tenureMonths % 12;
    let tenureDisplay = '';
    if (years > 0) tenureDisplay += `${years} năm `;
    if (months > 0 || years === 0) tenureDisplay += `${months} tháng`;

    // 4. Xử lý danh sách đánh giá
    const assessments = (summary?.performances || [])
      .sort((a, b) => b.performanceDate.getTime() - a.performanceDate.getTime())
      .map((p) => ({
        type: p.type,
        title: p.title,
        content: p.content,
        ratingLabel: p.ratingLabel,
        reviewerName:
          p.reviewerAccount?.fullName ||
          (p.type === PerformanceType.SELF ? 'Tự đánh giá' : 'Hệ thống'),
        date: p.performanceDate,
      }));

    // 5. Xử lý lộ trình thăng tiến
    const requirements: any[] = [];
    let suggestion = 'Bạn đang hoàn thành tốt công việc!';

    if (nextType) {
      // Đúng giờ
      const currentOnTime = summary?.totalShifts
        ? (summary.onTimeArrivalsCount / summary.totalShifts) * 100
        : 0;
      requirements.push({
        label: `${nextType.reqOnTimePercent}% ca đúng giờ / 30 ngày`,
        currentValue: `${currentOnTime.toFixed(0)}%`,
        requiredValue: `${nextType.reqOnTimePercent}%`,
        isMet: currentOnTime >= nextType.reqOnTimePercent,
      });

      // Nghỉ không phép
      const unauthorized = summary?.unauthorizedLeavesCount || 0;
      requirements.push({
        label: `Nghỉ không phép < ${nextType.reqMaxUnauthorizedLeave} ngày`,
        currentValue: unauthorized,
        requiredValue: nextType.reqMaxUnauthorizedLeave,
        isMet: unauthorized < nextType.reqMaxUnauthorizedLeave,
      });

      // Năng lực
      requirements.push({
        label: `Năng lực > ${nextType.reqMinCapabilityPoints} điểm`,
        currentValue: profile.capabilityPoints,
        requiredValue: nextType.reqMinCapabilityPoints,
        isMet: profile.capabilityPoints >= nextType.reqMinCapabilityPoints,
      });

      // Gợi ý
      const pointDiff = nextType.reqMinCapabilityPoints - profile.capabilityPoints;
      if (pointDiff > 0) {
        suggestion = `Còn thiếu ${pointDiff} điểm năng lực. Cần làm thêm các ca đúng giờ trong tháng này`;
      }
    }

    // 6. Xếp hạng cùng vị trí (Lazy rank calculation)
    const totalInPosition = await this.profileRepository.count({
      where: { employeeTypeId: profile.employeeTypeId, storeId: profile.storeId },
    });
    const higherProfiles = await this.profileRepository.count({
      where: {
        employeeTypeId: profile.employeeTypeId,
        storeId: profile.storeId,
        capabilityPoints: MoreThanOrEqual(profile.capabilityPoints),
      },
    });

    return {
      performanceScore: summary?.performanceScore || 0,
      monthlyWorkHours: summary?.monthlyWorkHours || 0,
      completedShifts: summary?.completedShifts || 0,
      totalShifts: summary?.totalShifts || 0,
      kpiCompletedCount: summary?.kpiCompletedCount || 0,
      kpiTotalCount: summary?.kpiTotalCount || 0,
      lateArrivalsCount: summary?.lateArrivalsCount || 0,
      unauthorizedLeavesCount: summary?.unauthorizedLeavesCount || 0,
      tenureDisplay,
      totalWorkHours: summary?.totalWorkHours || 0,
      totalCompletedShifts: summary?.totalCompletedShifts || 0,
      assessments,
      progression: {
        currentPosition: profile.employeeType?.name || 'N/A',
        skills: profile.employeeType?.skillName || 'N/A',
        nextTarget: nextType?.name || 'Cấp tối đa',
        rankInPosition: `${higherProfiles}/${totalInPosition}`,
        requirements,
        suggestion,
      },
    };
  }

  async getEmployeeProgression(profileId: string) {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      relations: ['employeeType'],
    });

    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');

    // Lấy tất cả các loại nhân viên của store, sắp xếp theo level
    const types = await this.employeeTypeRepository.find({
      where: { storeId: profile.storeId, isActive: true },
      order: { level: 'ASC' },
    });

    // Lấy thống kê hiện tại để tính toán tiến độ
    const currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const summary = await this.monthlySummaryRepository.findOne({
      where: { employeeProfileId: profileId, month: currentMonth },
    });

    const currentLevel = profile.employeeType?.level || 0;
    const stages: any[] = [];

    for (const type of types) {
      const stage: any = {
        title: type.name,
        progress: 0,
      };

      if (type.level <= currentLevel) {
        // Đã hoàn thành hoặc đang giữ vị trí này -> 100%
        stage.progress = 100;
      } else if (type.level === currentLevel + 1) {
        // Đây là mục tiêu tiếp theo -> Tính toán tiến độ dựa trên yêu cầu
        const currentReqs: any[] = [];
        let completedReqs = 0;
        let totalReqs = 0;

        // 1. Đúng giờ
        if (type.reqOnTimePercent > 0) {
          totalReqs++;
          const currentOnTime = summary?.totalShifts
            ? (summary.onTimeArrivalsCount / summary.totalShifts) * 100
            : 0;
          const met = currentOnTime >= type.reqOnTimePercent;
          if (met) completedReqs++;
          currentReqs.push({
            text: `${type.reqOnTimePercent}% ca đúng giờ / 30 ngày`,
            completed: met,
          });
        }

        // 2. Nghỉ không phép
        // Luôn kiểm tra yêu cầu này
        totalReqs++;
        const unauthorized = summary?.unauthorizedLeavesCount || 0;
        const metUnauthorized = unauthorized < type.reqMaxUnauthorizedLeave;
        if (metUnauthorized) completedReqs++;
        currentReqs.push({
          text: `Nghỉ không phép < ${type.reqMaxUnauthorizedLeave} ngày`,
          completed: metUnauthorized,
        });
        

        // 3. Không bị phản ánh
        if (type.reqNoComplaints) {
          totalReqs++;
          // Tạm thời giả định là true vì chưa có logic phản ánh
          const met = true; 
          if (met) completedReqs++;
          currentReqs.push({
            text: 'Không bị phản ánh',
            completed: met,
          });
        }

        // 4. Năng lực
        if (type.reqMinCapabilityPoints > 0) {
          totalReqs++;
          const met = profile.capabilityPoints >= type.reqMinCapabilityPoints;
          if (met) completedReqs++;
          currentReqs.push({
            text: `Năng lực > ${type.reqMinCapabilityPoints} điểm`,
            completed: met,
          });
        }

        stage.requirements = currentReqs;
        stage.progress = totalReqs > 0 ? Math.round((completedReqs / totalReqs) * 100) : 0;

        // Gợi ý
        const pointDiff = type.reqMinCapabilityPoints - profile.capabilityPoints;
        if (pointDiff > 0) {
          stage.suggestion = {
            text: `Còn thiếu ${pointDiff} điểm năng lực. Cần làm thêm các ca đúng giờ trong tháng này`,
          };
        } else if (stage.progress < 100) {
           stage.suggestion = {
            text: `Bạn đã đạt đủ điểm năng lực, hãy duy trì các chỉ số khác nhé!`,
          };
        }
      } else {
        // Các mức cao hơn nữa -> 0%
        stage.progress = 0;
      }

      stages.push(stage);
    }

    return stages;
    return stages;
  }

  async getEmployeeScheduleDetails(profileId: string, month: Date) {
    const startDate = new Date(month.getFullYear(), month.getMonth(), 1);
    const endDate = new Date(month.getFullYear(), month.getMonth() + 1, 0);

    // 1. Get Leave Requests
    const leaveRequests = await this.leaveRequestRepository.find({
      where: {
        employeeProfileId: profileId,
        startDate: Between(startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]),
      },
    });

    // 2. Get Shift Swaps
    const swaps = await this.shiftSwapRepository.find({
      where: [
        { requestedByEmployeeId: profileId },
        { toEmployeeId: profileId }
      ],
      relations: ['fromAssignment', 'fromAssignment.shiftSlot', 'requestedByEmployee', 'toEmployee', 'toEmployee.account'],
    });

    // 3. Get Assignments (Registered & Confirmed)
    const assignments = await this.shiftAssignmentRepository.find({
      where: {
        employeeId: profileId,
        shiftSlot: {
          workDate: Between(startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0])
        }
      },
      relations: ['shiftSlot', 'shiftSlot.workShift'],
    });

    // --- Build Response ---
    
    // Part 1: Overview (Calculate directly from assignments in month)
    let totalWorkHours = 0;
    let totalShifts = 0;
    
    // Only count CONFIRMED or COMPLETED shifts for overview
    const confirmedAssignments = assignments.filter(a => ['CONFIRMED', 'COMPLETED'].includes(a.status));
    totalShifts = confirmedAssignments.length;
    
    confirmedAssignments.forEach(assign => {
      if (assign.shiftSlot?.workShift) {
        const start = new Date(`1970-01-01T${assign.shiftSlot.workShift.startTime}Z`);
        const end = new Date(`1970-01-01T${assign.shiftSlot.workShift.endTime}Z`);
        const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        totalWorkHours += hours > 0 ? hours : 0;
      }
    });

    // Part 2: Shift Requests (Registers & Swaps)
    const shiftRequests: any[] = [];
    
     // Map Swaps
    swaps.forEach(swap => {
      shiftRequests.push({
        id: swap.id,
        type: 'SWAP',
        title: `Đổi ca ngày ${swap.fromAssignment?.shiftSlot?.workDate}`,
        details: `Với ${swap.toEmployee?.account?.fullName || 'N/A'}`,
        status: swap.status,
        requestDate: swap.createdAt,
      });
    });

    // Map Pending Registers
    assignments.filter(a => a.status === ShiftAssignmentStatus.PENDING).forEach(assign => {
      shiftRequests.push({
        id: assign.id,
        type: 'REGISTER',
        title: `Đăng ký ca ngày ${assign.shiftSlot?.workDate}`,
        details: assign.shiftSlot?.workShift?.shiftName || 'Ca chưa đặt tên',
        status: 'PENDING',
        requestDate: assign.createdAt,
      });
    });

    // Part 3: Leave Requests
    const leaveRequestsDto: any[] = [];
    leaveRequests.forEach(req => {
      leaveRequestsDto.push({
        id: req.id,
        startDate: req.startDate,
        endDate: req.endDate,
        reason: req.reason,
        status: req.status,
      });
    });

    // Part 4: Calendar (Daily Schedules)
    const scheduleMap = new Map<string, any[]>();
    assignments.forEach(assign => {
       // Only show relevant statuses in calendar (skip cancelled or rejected)
      if (['CANCELLED', 'REJECTED'].includes(assign.status)) return;

      const dateKey = String(assign.shiftSlot.workDate);
      if (!scheduleMap.has(dateKey)) scheduleMap.set(dateKey, []);
      
      let status: string = assign.status;
      
      // Check for late
      if (assign.status === ShiftAssignmentStatus.COMPLETED && assign.shiftSlot?.workShift) {
         if (assign.checkInTime && new Date(assign.checkInTime) > new Date(assign.shiftSlot.workShift.startTime)) status = 'LATE'; 
      }

      // Safety check
      if (assign.shiftSlot?.workShift) {
        scheduleMap.get(dateKey)?.push({
          name: assign.shiftSlot.workShift.shiftName,
          startTime: assign.shiftSlot.workShift.startTime,
          endTime: assign.shiftSlot.workShift.endTime,
          status: status,
          note: assign.note,
          color: assign.shiftSlot.workShift.colorCode
        });
      }
    });

    // Generate Calendar List
    const calendar: any[] = [];
    const days = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

    scheduleMap.forEach((shifts, dateKey) => {
      const date = new Date(dateKey); // Parse YYYY-MM-DD
      
      // Determine day status
      let dayStatus = 'NORMAL';
      const hasLate = shifts.some((s: any) => s.status === 'LATE');
      const hasUpcoming = shifts.some((s: any) => s.status === 'UPCOMING');
      
      if (hasLate) dayStatus = 'LATE';
      else if (hasUpcoming) dayStatus = 'UPCOMING';
      else dayStatus = 'COMPLETED';

      calendar.push({
        date: date,
        dayOfWeek: days[date.getDay()],
        day: date.getDate(),
        hasShift: true,
        status: dayStatus,
        shifts: shifts
      });
    });

    // Sort by date
    calendar.sort((a, b) => a.date.getTime() - b.date.getTime());

    return {
      overview: {
        totalWorkHours: parseFloat(totalWorkHours.toFixed(1)),
        totalShifts: totalShifts
      },
      shiftRequests: shiftRequests.sort((a,b) => b.requestDate.getTime() - a.requestDate.getTime()),
      leaveRequests: leaveRequestsDto,
      calendar: calendar
    };
  }

  async processRequest(
    userId: string,
    requestId: string,
    type: 'REGISTER' | 'SWAP' | 'LEAVE',
    status: 'APPROVED' | 'REJECTED',
    reason?: string
  ) {
    // Check permission logic here (omitted for brevity)
    
    if (type === 'REGISTER') {
      const assignment = await this.shiftAssignmentRepository.findOne({ where: { id: requestId } });
      if (!assignment) throw new NotFoundException('Không tìm thấy yêu cầu đăng ký');
      
      assignment.status = status === 'APPROVED' ? ShiftAssignmentStatus.APPROVED : ShiftAssignmentStatus.CANCELLED;
      // If rejected, maybe save reason somewhere? Currently Note.
      if (status === 'REJECTED' && reason) assignment.note = reason;
      
      return this.shiftAssignmentRepository.save(assignment);
    } 
    
    else if (type === 'SWAP') {
      const swap = await this.shiftSwapRepository.findOne({ 
        where: { id: requestId },
        relations: ['fromAssignment'] 
      });
      if (!swap) throw new NotFoundException('Không tìm thấy yêu cầu đổi ca');

      swap.status = status === 'APPROVED' ? ShiftSwapStatus.APPROVED : ShiftSwapStatus.REJECTED;
      swap.note = reason;
      await this.shiftSwapRepository.save(swap);

      if (status === 'APPROVED' && swap.fromAssignment) {
        // Thực hiện đổi ca: Cập nhật Assignment sang nhân viên mới
        swap.fromAssignment.employeeId = swap.toEmployeeId;
        // Nếu Assignment đang Completed (đổi bù) -> Giữ nguyên
        // Nếu Assignment đang Confirmed -> Giữ nguyên
        // Quan trọng: Đổi người sở hữu Assignment
        await this.shiftAssignmentRepository.save(swap.fromAssignment);
      }
      return swap;
    } 
    
    else if (type === 'LEAVE') {
      const leave = await this.leaveRequestRepository.findOne({ where: { id: requestId } });
      if (!leave) throw new NotFoundException('Không tìm thấy đơn nghỉ phép');

      leave.status = status === 'APPROVED' ? LeaveRequestStatus.APPROVED : LeaveRequestStatus.REJECTED;
      leave.approvedById = userId; // Giả định userId là profileId của quản lý, cần map từ accountId nếu cần
      if (status === 'REJECTED') leave.rejectionReason = reason || '';
      
      return this.leaveRequestRepository.save(leave);
    }

    throw new BadRequestException('Loại yêu cầu không hợp lệ');
  }

  async getEmployeeByAccountId(accountId: string) {
    return this.profileRepository.findOne({
      where: { accountId },
      relations: ['account'],
    });
  }

  async getEmployees(ownerId: string, storeId?: string, typeName?: string, isDeleted: boolean = false) {
    // Guard: nếu storeId là 'undefined' hoặc không phải UUID hợp lệ → trả kết quả rỗng
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (storeId && !uuidRegex.test(storeId)) {
      return { employees: [], summary: { onTimeCount: 0, authorizedLeaveCount: 0, lateArrivalCount: 0, unauthorizedLeaveCount: 0 }, typeCounts: [{ name: 'All', count: 0 }] };
    }
    const contextWhere: any = {};
    if (storeId) {
      contextWhere.storeId = storeId;
    } else {
      contextWhere.store = { ownerAccountId: ownerId };
    }

    // 1. Lấy tất cả Employee Types của store để tạo danh sách đầy đủ
    let allEmployeeTypes: StoreEmployeeType[] = [];
    if (storeId) {
      allEmployeeTypes = await this.employeeTypeRepository.find({
        where: { storeId, isActive: true },
      });
    } else {
      // Nếu là owner context, có thể cần lấy types từ tất cả các store của owner
      // Ở đây đơn giản hóa: nếu không có storeId, ta chỉ đếm dựa trên nhân viên thực tế như cũ hoặc cần logic phức tạp hơn
      // Tạm thời giữ logic cũ cho owner context, hoặc improved nếu cần.
       // TODO: Handle owner context better if needed.
    }

    // 2. Lấy TẤT CẢ nhân viên trong context để tính số lượng
    // Nếu isDeleted = true, ta chỉ muốn lấy NHỮNG NGƯỜI ĐÃ XÓA
    // Nếu isDeleted = false (mặc định), ta chỉ lấy NHỮNG NGƯỜI CHƯA XÓA (mặc định TypeORM find đã làm điều này)
    
    let allEmployees: EmployeeProfile[] = [];
    
    if (isDeleted) {
       // Lấy soft deleted
       const rawEmployees = await this.profileRepository.find({
            where: contextWhere,
            relations: ['employeeType'],
            withDeleted: true,
       });
       // Lọc chỉ lấy những bản ghi đã xóa (deletedAt != null)
       allEmployees = rawEmployees.filter(e => e.deletedAt !== null);
    } else {
        // Lấy active (default behavior)
        allEmployees = await this.profileRepository.find({
            where: contextWhere,
            relations: ['employeeType'],
        });
    }

    // Tính toán counts
    const typeCountMap = new Map<string, number>();
    
    // Initialize map with all defined types (if applicable)
     if (allEmployeeTypes.length > 0) {
        allEmployeeTypes.forEach(type => {
            typeCountMap.set(type.name, 0);
        });
    }

    allEmployees.forEach((emp) => {
      const name = emp.employeeType?.name || 'Unassigned';
      // Nếu type chưa có trong map (vd Unassigned), set = 0 trước khi cộng
      if (!typeCountMap.has(name)) typeCountMap.set(name, 0);
      typeCountMap.set(name, (typeCountMap.get(name) || 0) + 1);
    });
    
    // Convert map to array
    const typeCounts = [
      { name: 'All', count: allEmployees.length },
      ...Array.from(typeCountMap.entries()).map(([name, count]) => ({
        name,
        count,
      })),
    ];

    // 2. Lọc danh sách nhân viên thực tế cần trả về
    let filteredEmployees = allEmployees;
    if (typeName && typeName !== 'All') {
      filteredEmployees = allEmployees.filter(
        (emp) => emp.employeeType?.name === typeName,
      );
    }

    // 3. Lấy thông tin chi tiết (relations) cho danh sách đã lọc
    const employeeIds = filteredEmployees.map((e) => e.id);
    let detailedEmployees: EmployeeProfile[] = [];
    if (employeeIds.length > 0) {
      detailedEmployees = await this.profileRepository.find({
        where: { id: In(employeeIds) },
        relations: [
          'account',
          'employeeType',
          'storeRole',
          'contracts',
          'workShift',
          'store',
          'skill',
        ],
        withDeleted: isDeleted, // Cần withDeleted nếu đang query nhân viên đã xóa
      });
    }

    // 4. Lấy tháng hiện tại & Summaries cho danh sách đã lọc
    const currentMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    );

    let monthlySummaries: EmployeeMonthlySummary[] = [];
    if (employeeIds.length > 0) {
      monthlySummaries = await this.monthlySummaryRepository.find({
        where: {
          employeeProfileId: In(employeeIds),
          month: currentMonth,
        },
      });
    }

    const summaryMap = new Map<string, EmployeeMonthlySummary>();
    monthlySummaries.forEach((summary) => {
      summaryMap.set(summary.employeeProfileId, summary);
    });

    const employeesWithStats = detailedEmployees.map((employee) => {
      const summary = summaryMap.get(employee.id);
      return {
        ...employee,
        totalShifts: summary?.totalShifts || 0,
        completedShifts: summary?.completedShifts || 0,
        onTimeArrivalsCount: summary?.onTimeArrivalsCount || 0,
        lateArrivalsCount: summary?.lateArrivalsCount || 0,
        earlyDeparturesCount: summary?.earlyDeparturesCount || 0,
        authorizedLeavesCount: summary?.authorizedLeavesCount || 0,
        unauthorizedLeavesCount: summary?.unauthorizedLeavesCount || 0,
        estimatedSalary: summary?.estimatedSalary || 0,
        workingStatus: employee.workingStatus,
      };
    });

    const summary = {
      onTimeCount: monthlySummaries.reduce(
        (sum, s) => sum + s.onTimeArrivalsCount,
        0,
      ),
      authorizedLeaveCount: monthlySummaries.reduce(
        (sum, s) => sum + s.authorizedLeavesCount,
        0,
      ),
      lateArrivalCount: monthlySummaries.reduce(
        (sum, s) => sum + s.lateArrivalsCount,
        0,
      ),
      unauthorizedLeaveCount: monthlySummaries.reduce(
        (sum, s) => sum + s.unauthorizedLeavesCount,
        0,
      ),
    };

    return {
      employees: employeesWithStats,
      summary,
      typeCounts,
    };
  }

  async deleteEmployee(profileId: string, reasonId: string) {
    const profile = await this.profileRepository.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');

    // Validate reason
    const reason = await this.terminationReasonRepository.findOne({ where: { id: reasonId } });
    if (!reason) throw new NotFoundException('Lý do thôi việc không hợp lệ');

    // Cập nhật thông tin thôi việc
    profile.employmentStatus = EmploymentStatus.TERMINATED;
    profile.terminationReasonId = reasonId;
    profile.leftAt = new Date();
    await this.profileRepository.save(profile);

    // Soft delete (sẽ cập nhật deleted_at)
    return this.profileRepository.softDelete(profileId);
  }

  async permanentDeleteEmployee(profileId: string) {
    const profile = await this.profileRepository.findOne({ 
      where: { id: profileId },
      withDeleted: true 
    });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');

    return this.profileRepository.delete(profileId);
  }

  async restoreEmployee(profileId: string) {
    const profile = await this.profileRepository.findOne({ 
      where: { id: profileId },
      withDeleted: true 
    });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');

    // Khôi phục trạng thái active
    profile.employmentStatus = EmploymentStatus.ACTIVE;
    profile.terminationReasonId = null;
    profile.leftAt = null;
    profile.deletedAt = null;
    
    await this.profileRepository.save(profile);

    return this.profileRepository.restore(profileId);
  }

  async assignRoleToEmployee(
    profileId: string,
    roleId: string,
    assignedBy: string,
  ) {
    const profileRole = this.profileRoleRepository.create({
      employeeProfileId: profileId,
      storeRoleId: roleId,
      assignedByAccountId: assignedBy,
    });
    return this.profileRoleRepository.save(profileRole);
  }

  // Contract management
  async createContract(profileId: string, data: Partial<EmployeeContract>) {
    const sanitizedData = { ...data };
    if ((sanitizedData.startDate as any) === '') sanitizedData.startDate = undefined;
    if ((sanitizedData.endDate as any) === '') sanitizedData.endDate = undefined; 

    // Tự động tính end_date nếu có duration_months và start_date
    if (sanitizedData.durationMonths && sanitizedData.startDate) {
      const startDate = new Date(sanitizedData.startDate);
      const endDate = new Date(startDate);
      endDate.setMonth(startDate.getMonth() + Number(sanitizedData.durationMonths));
      
      // Giảm đi 1 ngày để hợp đồng kết thúc vào cuối ngày của tháng trước đó (VD: 01/01 -> 31/12 thay vì 01/01 năm sau)
      endDate.setDate(endDate.getDate() - 1);
      
      sanitizedData.endDate = endDate;
    }

    const contract = this.contractRepository.create({
      ...sanitizedData,
      employeeProfileId: profileId,
    });
    return this.contractRepository.save(contract);
  }

  async getLatestContract(profileId: string) {
    return this.contractRepository.findOne({
      where: { employeeProfileId: profileId },
      order: { createdAt: 'DESC' },
    });
  }

  // Work Shift management
  async createWorkShift(storeId: string, data: Partial<WorkShift>) {
    const shift = this.workShiftRepository.create({ ...data, storeId });
    return this.workShiftRepository.save(shift);
  }

  async getWorkShifts(storeId: string) {
    return this.workShiftRepository.find({
      where: { storeId, isActive: true },
    });
  }

  async updateWorkShift(storeId: string, shiftId: string, data: Partial<WorkShift>) {
    const shift = await this.workShiftRepository.findOne({
      where: { id: shiftId, storeId },
    });
    
    if (!shift) {
      throw new NotFoundException('Không tìm thấy ca làm việc');
    }

    await this.workShiftRepository.update(shiftId, data);
    return this.workShiftRepository.findOne({ where: { id: shiftId } });
  }

  // ==================== WORK CYCLE MANAGEMENT ====================

  // Lấy chu kỳ đang active của cửa hàng (chỉ có 1 tại 1 thời điểm)
  async getActiveCycle(storeId: string) {
    return this.workCycleRepository.findOne({
      where: { storeId, status: WorkCycleStatus.ACTIVE },
      relations: ['slots', 'slots.workShift', 'templates', 'templates.workShift'],
    });
  }

  // Tính ngày kết thúc dựa trên loại chu kỳ
  private calculateEndDate(startDate: string, cycleType: CycleType): string | null {
    const start = new Date(startDate);
    
    switch (cycleType) {
      case CycleType.DAILY:
        return startDate; // Kết thúc ngay trong ngày
      case CycleType.WEEKLY: {
        const weekEnd = new Date(start);
        weekEnd.setDate(weekEnd.getDate() + 6); // 7 ngày
        return weekEnd.toISOString().split('T')[0];
      }
      case CycleType.MONTHLY: {
        const monthEnd = new Date(start);
        monthEnd.setMonth(monthEnd.getMonth() + 1);
        monthEnd.setDate(monthEnd.getDate() - 1); // Ngày cuối tháng
        return monthEnd.toISOString().split('T')[0];
      }
      case CycleType.INDEFINITE:
        return null; // Vô thời hạn
      default:
        return null;
    }
  }

  // Lấy ngày trong tuần của 1 date
  private getDayOfWeek(dateString: string): WeekDaySchedule {
    const date = new Date(dateString);
    const days: WeekDaySchedule[] = [
      WeekDaySchedule.SUNDAY,
      WeekDaySchedule.MONDAY,
      WeekDaySchedule.TUESDAY,
      WeekDaySchedule.WEDNESDAY,
      WeekDaySchedule.THURSDAY,
      WeekDaySchedule.FRIDAY,
      WeekDaySchedule.SATURDAY,
    ];
    return days[date.getDay()];
  }

  // Tạo chu kỳ mới
  async createWorkCycle(
    storeId: string,
    data: {
      name: string;
      cycleType: CycleType;
      startDate: string;
      endDate?: string;
      workShiftIds?: string[];
      slots?: { workShiftId: string; workDate: string; maxStaff?: number }[];
      templates?: { workShiftId: string; dayOfWeek: WeekDaySchedule; maxStaff?: number }[];
    },
  ) {
    // Kiểm tra xem có chu kỳ active không
    const activeCycle = await this.getActiveCycle(storeId);
    if (activeCycle) {
      throw new BadRequestException(
        'Cửa hàng đã có chu kỳ đang hoạt động. Vui lòng dừng chu kỳ hiện tại trước khi tạo mới.',
      );
    }

    // Tính ngày kết thúc: dùng endDate từ request nếu có, không thì tự tính theo cycleType
    const endDate = data.endDate || this.calculateEndDate(data.startDate, data.cycleType);

    // Tạo chu kỳ
    const cycle = this.workCycleRepository.create({
      storeId,
      name: data.name,
      cycleType: data.cycleType,
      startDate: data.startDate,
      endDate,
      status: WorkCycleStatus.ACTIVE,
    });
    const savedCycle = await this.workCycleRepository.save(cycle);

    // Nếu là INDEFINITE, tạo templates
    if (data.cycleType === CycleType.INDEFINITE && data.templates?.length) {
      const templateEntities = data.templates.map((t) =>
        this.cycleTemplateRepository.create({
          cycleId: savedCycle.id,
          workShiftId: t.workShiftId,
          dayOfWeek: t.dayOfWeek,
          maxStaff: t.maxStaff || 1,
        }),
      );
      await this.cycleTemplateRepository.save(templateEntities);
      
      // INDEFINITE: chỉ tạo slots cho 30 ngày tới, cron job sẽ tạo tiếp hàng ngày
      if (data.cycleType === CycleType.INDEFINITE) {
        await this.generateSlotsFromTemplate(savedCycle.id, data.startDate, 30);
      }
    } 
    // Nếu có slots được truyền vào
    else if (data.slots?.length) {
      const slotEntities = data.slots.map((s) =>
        this.shiftSlotRepository.create({
          cycleId: savedCycle.id,
          workShiftId: s.workShiftId,
          workDate: s.workDate,
          maxStaff: s.maxStaff || 1,
        }),
      );
      await this.shiftSlotRepository.save(slotEntities);
    }
    // Nếu có workShiftIds, auto-generate slots cho tất cả ngày trong chu kỳ
    else if (data.workShiftIds?.length && endDate) {
      await this.autoGenerateSlots(savedCycle.id, data.startDate, endDate, data.workShiftIds);
    }

    return this.workCycleRepository.findOne({
      where: { id: savedCycle.id },
      relations: ['slots', 'slots.workShift', 'templates', 'templates.workShift'],
    });
  }

  // Auto-generate slots cho TẤT CẢ ngày trong chu kỳ (từ startDate đến endDate)
  // Lấy maxStaff từ WorkShift.defaultMaxStaff
  private async autoGenerateSlots(
    cycleId: string,
    startDate: string,
    endDate: string,
    workShiftIds: string[],
  ) {
    // Lấy thông tin WorkShift để lấy defaultMaxStaff
    const workShifts = await this.workShiftRepository.findByIds(workShiftIds);
    const workShiftMap = new Map(workShifts.map(ws => [ws.id, ws]));

    const slots: Partial<ShiftSlot>[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Tạo slots cho TẤT CẢ các ngày trong chu kỳ
    const current = new Date(start);
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      for (const shiftId of workShiftIds) {
        const workShift = workShiftMap.get(shiftId);
        slots.push({
          cycleId,
          workShiftId: shiftId,
          workDate: dateStr,
          maxStaff: workShift?.defaultMaxStaff || 1,  // Lấy từ WorkShift
        });
      }
      current.setDate(current.getDate() + 1);
    }

    if (slots.length > 0) {
      const slotEntities = slots.map((s) => this.shiftSlotRepository.create(s));
      await this.shiftSlotRepository.save(slotEntities);
    }
  }

  // Generate slots từ template cho N ngày tới (dùng cho INDEFINITE)
  async generateSlotsFromTemplate(cycleId: string, fromDate: string, daysAhead: number) {
    const cycle = await this.workCycleRepository.findOne({
      where: { id: cycleId },
      relations: ['templates'],
    });
    if (!cycle || !cycle.templates?.length) return;

    const slots: Partial<ShiftSlot>[] = [];
    const start = new Date(fromDate);

    for (let i = 0; i < daysAhead; i++) {
      const currentDate = new Date(start);
      currentDate.setDate(currentDate.getDate() + i);
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayOfWeek = this.getDayOfWeek(dateStr);

      // Tìm templates cho ngày này
      const dayTemplates = cycle.templates.filter((t) => t.dayOfWeek === dayOfWeek);
      for (const template of dayTemplates) {
        // Kiểm tra slot đã tồn tại chưa
        const existing = await this.shiftSlotRepository.findOne({
          where: { cycleId, workShiftId: template.workShiftId, workDate: dateStr },
        });
        if (!existing) {
          slots.push({
            cycleId,
            workShiftId: template.workShiftId,
            workDate: dateStr,
            maxStaff: template.maxStaff,
          });
        }
      }
    }

    if (slots.length > 0) {
      const slotEntities = slots.map((s) => this.shiftSlotRepository.create(s));
      await this.shiftSlotRepository.save(slotEntities);
    }
  }

  async getWorkCycles(storeId: string) {
    return this.workCycleRepository.find({
      where: { storeId },
      order: { createdAt: 'DESC' },
      relations: ['slots', 'slots.workShift', 'templates', 'templates.workShift'],
    });
  }

  async getWorkCycleById(cycleId: string) {
    return this.workCycleRepository.findOne({
      where: { id: cycleId },
      relations: ['slots', 'slots.workShift', 'slots.assignments', 'slots.assignments.employee', 'templates', 'templates.workShift'],
    });
  }

  async updateWorkCycle(cycleId: string, data: Partial<WorkCycle>) {
    await this.workCycleRepository.update(cycleId, data);
    return this.getWorkCycleById(cycleId);
  }

  // Dừng chu kỳ (không xóa, chỉ chuyển status)
  async stopWorkCycle(
    cycleId: string,
    options: { stopImmediately?: boolean; scheduledStopAt?: string } = { stopImmediately: true },
  ) {
    const cycle = await this.workCycleRepository.findOne({ where: { id: cycleId } });
    if (!cycle) {
      throw new NotFoundException('Chu kỳ không tồn tại');
    }
    if (cycle.status !== WorkCycleStatus.ACTIVE) {
      throw new BadRequestException('Chỉ có thể dừng chu kỳ đang hoạt động');
    }

    if (options.stopImmediately !== false) {
      // Dừng ngay
      await this.workCycleRepository.update(cycleId, {
        status: WorkCycleStatus.STOPPED,
        stoppedAt: new Date(),
      });
    } else if (options.scheduledStopAt) {
      // Hẹn giờ dừng
      await this.workCycleRepository.update(cycleId, {
        scheduledStopAt: new Date(options.scheduledStopAt),
      });
    }

    return this.getWorkCycleById(cycleId);
  }

  // Kích hoạt chu kỳ (chuyển từ DRAFT sang ACTIVE)
  async activateWorkCycle(cycleId: string) {
    const cycle = await this.workCycleRepository.findOne({ where: { id: cycleId } });
    if (!cycle) {
      throw new NotFoundException('Chu kỳ không tồn tại');
    }

    // Kiểm tra xem có chu kỳ active khác không
    const activeCycle = await this.getActiveCycle(cycle.storeId);
    if (activeCycle && activeCycle.id !== cycleId) {
      throw new BadRequestException(
        'Cửa hàng đã có chu kỳ đang hoạt động. Vui lòng dừng chu kỳ hiện tại trước.',
      );
    }

    await this.workCycleRepository.update(cycleId, {
      status: WorkCycleStatus.ACTIVE,
    });

    return this.getWorkCycleById(cycleId);
  }

  // Xử lý chu kỳ hết hạn (gọi bởi cron job)
  async processExpiredCycles() {
    const today = new Date().toISOString().split('T')[0];
    
    // Tìm các chu kỳ active đã hết hạn
    const expiredCycles = await this.workCycleRepository
      .createQueryBuilder('cycle')
      .where('cycle.status = :status', { status: WorkCycleStatus.ACTIVE })
      .andWhere('cycle.endDate IS NOT NULL')
      .andWhere('cycle.endDate < :today', { today })
      .getMany();

    for (const cycle of expiredCycles) {
      await this.workCycleRepository.update(cycle.id, {
        status: WorkCycleStatus.EXPIRED,
      });
    }

    // Xử lý các chu kỳ có lịch hẹn dừng
    const scheduledStopCycles = await this.workCycleRepository
      .createQueryBuilder('cycle')
      .where('cycle.status = :status', { status: WorkCycleStatus.ACTIVE })
      .andWhere('cycle.scheduledStopAt IS NOT NULL')
      .andWhere('cycle.scheduledStopAt <= :now', { now: new Date() })
      .getMany();

    for (const cycle of scheduledStopCycles) {
      await this.workCycleRepository.update(cycle.id, {
        status: WorkCycleStatus.STOPPED,
        stoppedAt: new Date(),
      });
    }

    return { expiredCount: expiredCycles.length, stoppedCount: scheduledStopCycles.length };
  }

  // Tạo slots cho ngày mai cho TẤT CẢ chu kỳ ACTIVE (gọi bởi cron job hàng ngày)
  async generateDailySlotsForAllCycles() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Lấy tất cả chu kỳ ACTIVE (trừ INDEFINITE - sẽ xử lý riêng)
    const activeCycles = await this.workCycleRepository
      .createQueryBuilder('cycle')
      .leftJoinAndSelect('cycle.slots', 'slot')
      .where('cycle.status = :status', { status: WorkCycleStatus.ACTIVE })
      .andWhere('cycle.cycleType != :indefinite', { indefinite: CycleType.INDEFINITE })
      .andWhere('(cycle.endDate IS NULL OR cycle.endDate >= :tomorrow)', { tomorrow: tomorrowStr })
      .getMany();

    let createdCount = 0;

    for (const cycle of activeCycles) {
      // Kiểm tra xem đã có slots cho ngày mai chưa
      const existingSlots = await this.shiftSlotRepository.find({
        where: { cycleId: cycle.id, workDate: tomorrowStr },
      });

      if (existingSlots.length > 0) {
        continue; // Đã có slots rồi, skip
      }

      // Lấy danh sách ca từ slot đầu tiên (giả định dùng cùng các ca)
      const firstDaySlots = await this.shiftSlotRepository.find({
        where: { cycleId: cycle.id, workDate: cycle.startDate },
        relations: ['assignments'],
      });

      if (firstDaySlots.length === 0) {
        continue; // Không có slots mẫu
      }

      // Tạo slots cho ngày mai dựa trên slots ngày đầu tiên
      const newSlots = firstDaySlots.map((slot) =>
        this.shiftSlotRepository.create({
          cycleId: cycle.id,
          workShiftId: slot.workShiftId,
          workDate: tomorrowStr,
          maxStaff: slot.maxStaff,
        }),
      );

      const savedSlots = await this.shiftSlotRepository.save(newSlots);
      createdCount += savedSlots.length;

      // Auto-assign: copy APPROVED assignments từ slot gốc sang slot mới
      for (let i = 0; i < firstDaySlots.length; i++) {
        const templateSlot = firstDaySlots[i];
        const newSlot = savedSlots[i];
        const approvedAssignments = (templateSlot.assignments || [])
          .filter(a => a.status === ShiftAssignmentStatus.APPROVED);

        if (approvedAssignments.length > 0) {
          const newAssignments = approvedAssignments.map(a =>
            this.shiftAssignmentRepository.create({
              shiftSlotId: newSlot.id,
              employeeId: a.employeeId,
              status: ShiftAssignmentStatus.APPROVED,
              note: 'Auto-assigned from cycle',
            }),
          );
          await this.shiftAssignmentRepository.save(newAssignments);
        }
      }
    }

    return { processedCycles: activeCycles.length, createdSlots: createdCount };
  }

  // Tạo slots cho chu kỳ INDEFINITE (gọi bởi cron job hàng ngày)
  async generateDailySlotsForIndefiniteCycles() {
    const indefiniteCycles = await this.workCycleRepository.find({
      where: { cycleType: CycleType.INDEFINITE, status: WorkCycleStatus.ACTIVE },
    });

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    
    for (const cycle of indefiniteCycles) {
      // Tạo slots cho ngày mai dựa trên template
      await this.generateSlotsFromTemplate(cycle.id, tomorrowStr, 1);
    }

    return { processedCount: indefiniteCycles.length };
  }

  // ==================== SHIFT SLOT MANAGEMENT ====================

  async createShiftSlots(cycleId: string, slotsData: Partial<ShiftSlot>[]) {
    const slots = slotsData.map((data) =>
      this.shiftSlotRepository.create({ ...data, cycleId }),
    );
    return this.shiftSlotRepository.save(slots);
  }

  async getShiftSlots(cycleId: string, date?: string) {
    const where: any = { cycleId };
    if (date) {
      where.workDate = date;
    }
    const slots = await this.shiftSlotRepository.find({
      where,
      relations: ['workShift', 'assignments', 'assignments.employee'],
      order: { workDate: 'ASC' },
    });

    return slots.map(slot => ({
      ...slot,
      currentCount: slot.assignments?.length || 0,
      isFull: (slot.assignments?.length || 0) >= slot.maxStaff,
    }));
  }

  async updateShiftSlot(slotId: string, data: Partial<ShiftSlot>) {
    await this.shiftSlotRepository.update(slotId, data);
    return this.shiftSlotRepository.findOne({
      where: { id: slotId },
      relations: ['workShift', 'assignments'],
    });
  }

  async deleteShiftSlot(slotId: string) {
    await this.shiftSlotRepository.delete(slotId);
    return { message: 'Shift slot deleted successfully' };
  }

  // ==================== STORE SHIFT SLOTS (for staff app calendar) ====================

  /**
   * Lấy tất cả shift slots của cửa hàng (bao gồm workShift info + assignments)
   * Dùng cho staff app hiển thị lịch ca cửa hàng
   */
  async getStoreShiftSlots(storeId: string, startDate?: string, endDate?: string) {
    const qb = this.shiftSlotRepository
      .createQueryBuilder('slot')
      .leftJoinAndSelect('slot.workShift', 'workShift')
      .leftJoinAndSelect('slot.assignments', 'assignment')
      .leftJoinAndSelect('assignment.employee', 'employee')
      .leftJoinAndSelect('employee.account', 'account')
      .leftJoin('slot.cycle', 'cycle')
      .where('cycle.storeId = :storeId', { storeId })
      .orderBy('slot.workDate', 'ASC')
      .addOrderBy('workShift.startTime', 'ASC');

    if (startDate) {
      qb.andWhere('slot.workDate >= :startDate', { startDate });
    }
    if (endDate) {
      qb.andWhere('slot.workDate <= :endDate', { endDate });
    }

    const slots = await qb.getMany();

    return slots.map(slot => ({
      id: slot.id,
      workDate: slot.workDate,
      maxStaff: slot.maxStaff,
      cycleId: slot.cycleId,
      workShift: slot.workShift ? {
        id: slot.workShift.id,
        shiftName: slot.workShift.shiftName,
        startTime: slot.workShift.startTime,
        endTime: slot.workShift.endTime,
        colorCode: (slot.workShift as any).colorCode || null,
      } : null,
      assignments: (slot.assignments || []).map(a => ({
        id: a.id,
        employeeId: a.employeeId,
        status: a.status,
        employeeName: (a as any).employee?.account?.fullName || null,
        employeeAvatar: (a as any).employee?.account?.avatarUrl || null,
      })),
      currentCount: slot.assignments?.length || 0,
      isFull: (slot.assignments?.length || 0) >= slot.maxStaff,
    }));
  }

  // ==================== SHIFT ASSIGNMENT MANAGEMENT ====================

  async registerToShiftSlot(slotId: string, employeeId: string, note?: string, isOwnerAssign = false) {
    // P0-3, P0-4, P0-5: Use transaction with pessimistic locking + deadline + cycle status check
    return await this.dataSource.transaction(async manager => {
      // Lock the slot row to prevent race condition
      const slot = await manager
        .createQueryBuilder(ShiftSlot, 'slot')
        .setLock('pessimistic_write')
        .leftJoinAndSelect('slot.assignments', 'assignment')
        .leftJoinAndSelect('slot.cycle', 'cycle')
        .where('slot.id = :slotId', { slotId })
        .getOne();

      if (!slot) throw new NotFoundException('Shift slot not found');

      // P0-5: Check if cycle is still active
      if (slot.cycle && slot.cycle.status !== WorkCycleStatus.ACTIVE) {
        throw new BadRequestException('Chu kỳ không còn hoạt động');
      }

      // P0-4: Check registration deadline
      const now = new Date();
      if (slot.cycle?.registrationDeadline && now > new Date(slot.cycle.registrationDeadline)) {
        throw new BadRequestException('Đã quá hạn đăng ký ca làm việc');
      }

      // P0-3: Check capacity with lock held (prevents race condition)
      const activeCount = slot.assignments?.filter(
        a => [ShiftAssignmentStatus.APPROVED, ShiftAssignmentStatus.CONFIRMED, ShiftAssignmentStatus.PENDING].includes(a.status)
      ).length || 0;

      if (activeCount >= slot.maxStaff) {
        throw new BadRequestException('Ca đã đầy người');
      }

      // Check if employee already registered
      const existing = await manager.findOne(ShiftAssignment, {
        where: { shiftSlotId: slotId, employeeId },
      });
      if (existing) {
        throw new BadRequestException('Nhân viên đã đăng ký ca này');
      }

      // Create and save assignment
      const assignment = manager.create(ShiftAssignment, {
        shiftSlotId: slotId,
        employeeId,
        note,
        status: isOwnerAssign ? ShiftAssignmentStatus.APPROVED : ShiftAssignmentStatus.PENDING,
      });
      return manager.save(assignment);
    });
  }

  async getShiftAssignments(
    storeId: string,
    filters: { cycleId?: string; status?: string },
  ) {
    const qb = this.shiftAssignmentRepository
      .createQueryBuilder('assignment')
      .leftJoinAndSelect('assignment.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.workShift', 'workShift')
      .leftJoinAndSelect('slot.cycle', 'cycle')
      .leftJoinAndSelect('assignment.employee', 'employee')
      .leftJoinAndSelect('employee.account', 'account')
      .where('cycle.storeId = :storeId', { storeId })
      .orderBy('assignment.createdAt', 'DESC');

    if (filters.cycleId) {
      qb.andWhere('slot.cycleId = :cycleId', { cycleId: filters.cycleId });
    }
    if (filters.status) {
      qb.andWhere('assignment.status = :status', { status: filters.status });
    }

    return qb.getMany();
  }

  async updateAssignmentStatus(
    assignmentId: string,
    status: string,
    note?: string,
  ) {
    const assignment = await this.shiftAssignmentRepository.findOne({
      where: { id: assignmentId },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    assignment.status = status as ShiftAssignmentStatus;
    if (note) assignment.note = note;

    return this.shiftAssignmentRepository.save(assignment);
  }

  // ==================== SHIFT SWAP MANAGEMENT ====================

  async createShiftSwap(data: {
    fromAssignmentId: string;
    toEmployeeId: string;
    requestedByEmployeeId: string;
    note?: string;
  }) {
    const swap = this.shiftSwapRepository.create({
      fromAssignmentId: data.fromAssignmentId,
      toEmployeeId: data.toEmployeeId,
      requestedByEmployeeId: data.requestedByEmployeeId,
      note: data.note,
      status: ShiftSwapStatus.PENDING,
    });
    return this.shiftSwapRepository.save(swap);
  }

  async updateShiftSwapStatus(swapId: string, status: string, note?: string) {
    const swap = await this.shiftSwapRepository.findOne({
      where: { id: swapId },
      relations: ['fromAssignment'],
    });
    if (!swap) throw new NotFoundException('Shift swap request not found');

    swap.status = status as ShiftSwapStatus;
    if (note) swap.note = note;
    await this.shiftSwapRepository.save(swap);

    // If approved, transfer the assignment
    if ((status as ShiftSwapStatus) === ShiftSwapStatus.APPROVED && swap.fromAssignment) {
      swap.fromAssignment.employeeId = swap.toEmployeeId;
      await this.shiftAssignmentRepository.save(swap.fromAssignment);
    }

    return swap;
  }


  async createAssetsBulk(
    storeId: string,
    assetsData: any[],
    files: Express.Multer.File[],
  ) {
    console.log("Chạy hàm createAssetsBulk");
    const savedAssets: Asset[] = [];

    for (let i = 0; i < assetsData.length; i++) {
      const data = assetsData[i];
      
      // 1. Ánh xạ file từ Form Data (Convention: avatar_0, invoice_0...)
      const avatarFile = files.find(f => f.fieldname === `avatar_${i}`);
      const invoiceFile = files.find(f => f.fieldname === `invoice_${i}`);

      if (avatarFile) data.avatarUrl = `/uploads/${avatarFile.filename}`;
      if (invoiceFile) data.invoiceFileUrl = `/uploads/${invoiceFile.filename}`;

      // 2. Tạo Asset Entity
      const asset = this.assetRepository.create({ ...data, storeId });
      const savedAsset = (await this.assetRepository.save(
        asset,
      )) as unknown as Asset;
      savedAssets.push(savedAsset);

      // 3. Tạo phiếu nhập kho (Nếu có currentStock > 0)
      if (data.currentStock > 0) {
        // Tự động generate phiếu nhập
        const transaction = new StockTransaction();
        transaction.storeId = storeId;
        transaction.type = StockTransactionType.IMPORT;
        transaction.code = `PN-INIT-${Date.now()}-${i}`;
        transaction.employeeId = data.responsibleEmployeeId; // Lưu ý: Cần ID người nhập nếu có
        transaction.note = 'Nhập kho ban đầu (Khai báo tài sản)';
        transaction.status = StockTransactionStatus.COMPLETED;
        transaction.totalAmount = (Number(data.value) || 0) * Number(data.currentStock);

        const savedTransaction = await this.stockTransactionRepository.save(transaction);

        const detail = new StockTransactionDetail();
        detail.transactionId = savedTransaction.id;
        detail.assetId = savedAsset.id;
        detail.quantity = Number(data.currentStock);
        detail.unitPrice = Number(data.value) || 0;
        detail.totalPrice = transaction.totalAmount;

        await this.stockTransactionDetailRepository.save(detail);
      }
    }

    return savedAssets;
  }

  async getAssets(storeId: string) {
    return this.assetRepository.find({
      where: { storeId },
      relations: [
        'assetUnit',
        'assetCategory',
        'assetStatus',
      ],
    });
  }

  async getAssetReport(storeId: string, filters: { date?: string; assetStatusId?: string }) {
    // Xử lý trường hợp frontend gửi chuỗi "undefined" hoặc "null"
    if (filters.date === 'undefined' || filters.date === 'null') filters.date = undefined;
    if (filters.assetStatusId === 'all' || filters.assetStatusId === 'undefined' || filters.assetStatusId === 'null') filters.assetStatusId = undefined;

    // 1. Summary Calculation (Dựa trên LỊCH SỬ NHẬP hàng - Đếm món, không đếm số lượng)
    const summaryAllTime = await this.stockTransactionDetailRepository.createQueryBuilder('detail')
      .leftJoin('detail.transaction', 'transaction')
      .select('COUNT(detail.id)', 'totalItems') // Đếm số dòng (món hàng)
      .addSelect('SUM(detail.total_price)', 'totalValue') // Tổng tiền các đợt nhập
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', { type: StockTransactionType.IMPORT })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .getRawOne();

    const targetDate = filters.date || new Date().toISOString().split('T')[0];
    const summaryToday = await this.stockTransactionDetailRepository.createQueryBuilder('detail')
      .leftJoin('detail.transaction', 'transaction')
      .select('COUNT(detail.id)', 'totalItems')
      .addSelect('SUM(detail.total_price)', 'totalValue')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', { type: StockTransactionType.IMPORT })
      .andWhere('DATE(transaction.transaction_date) = :targetDate', { targetDate })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .getRawOne();

    // 2. Status Statistics (Đếm món hàng trong lịch sử theo trạng thái)
    const allStatuses = await this.assetStatusRepository.find({ where: { storeId, isActive: true } });
    
    const statusStatsQb = this.stockTransactionDetailRepository.createQueryBuilder('detail')
      .select('asset.asset_status_id', 'statusId')
      .addSelect('COUNT(detail.id)', 'itemCount')
      .leftJoin('detail.asset', 'asset')
      .leftJoin('detail.transaction', 'transaction')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', { type: StockTransactionType.IMPORT })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .groupBy('asset.asset_status_id');


    if (filters.date) {
      statusStatsQb.andWhere('DATE(transaction.transaction_date) = :date', { date: filters.date });
    }

    const statusStatsRaw = await statusStatsQb.getRawMany();

    const statusDetails = allStatuses.map(status => {
      const found = statusStatsRaw.find(r => r.statusId === status.id);
      return {
        id: status.id,
        name: status.name,
        colorCode: status.colorCode,
        count: found ? Number(found.itemCount) : 0
      };
    });

    const totalHistoryItems = statusDetails.reduce((sum, item) => sum + item.count, 0);

    // 3. Import History (Lịch sử nhập hàng) - Dựa trên StockTransaction
    const importHistoryQb = this.stockTransactionDetailRepository.createQueryBuilder('detail')
      .leftJoinAndSelect('detail.transaction', 'transaction')
      .leftJoinAndSelect('detail.asset', 'asset')
      .leftJoinAndSelect('asset.assetUnit', 'unit')
      .leftJoinAndSelect('asset.assetCategory', 'category')
      .leftJoinAndSelect('asset.assetStatus', 'status')
      .leftJoinAndSelect('asset.store', 'store')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', { type: StockTransactionType.IMPORT })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .orderBy('transaction.transaction_date', 'DESC');

    if (filters.date) {
      importHistoryQb.andWhere('DATE(transaction.transaction_date) = :date', { date: filters.date });
    }

    if (filters.assetStatusId) {
      importHistoryQb.andWhere('asset.asset_status_id = :statusId', { statusId: filters.assetStatusId });
    }

    const importHistory = await importHistoryQb.getMany();

    // Mapping lại theo format UI Card người dùng cung cấp
    const formattedImports = importHistory.map(detail => ({
      id: detail.id,
      assetName: detail.asset?.name,
      assetCode: detail.asset?.code,
      avatarUrl: detail.asset?.avatarUrl,
      categoryName: detail.asset?.assetCategory?.name,
      unitName: detail.asset?.assetUnit?.name,
      supplierName: detail.transaction?.partnerName || detail.asset?.supplierName,
      value: Number(detail.unitPrice), // Giá trị đơn vị
      quantity: Number(detail.quantity), // Số lượng thực tế trong đợt đó
      totalPrice: Number(detail.totalPrice),
      status: {
        id: detail.asset?.assetStatus?.id,
        name: detail.asset?.assetStatus?.name,
        colorCode: detail.asset?.assetStatus?.colorCode
      },
      storeName: detail.asset?.store?.name,
      storeAvatarUrl: detail.asset?.store?.avatarUrl,
      importDate: detail.transaction?.transactionDate,
      transactionCode: detail.transaction?.code,
      transactionId: detail.transaction?.id
    }));


    return {
      summary: {
        total: {
          count: Number(summaryAllTime.totalItems) || 0,
          value: Number(summaryAllTime.totalValue) || 0,
        },
        today: {
          date: targetDate,
          count: Number(summaryToday.totalItems) || 0,
          value: Number(summaryToday.totalValue) || 0,
        }
      },
      statusStatistics: {
        all: totalHistoryItems,
        details: statusDetails
      },
      importHistory: formattedImports
    };
  }

  async getAssetExportReport(storeId: string, filters: { date?: string; assetExportTypeId?: string }) {
    // Xử lý trường hợp frontend gửi chuỗi "undefined" hoặc "null"
    if (filters.date === 'undefined' || filters.date === 'null') filters.date = undefined;
    if (filters.assetExportTypeId === 'all' || filters.assetExportTypeId === 'undefined' || filters.assetExportTypeId === 'null') filters.assetExportTypeId = undefined;

    // 1. Summary Calculation (Dựa trên LỊCH SỬ XUẤT hàng)
    const summaryAllTime = await this.stockTransactionDetailRepository.createQueryBuilder('detail')
      .leftJoin('detail.transaction', 'transaction')
      .select('COUNT(detail.id)', 'totalItems')
      .addSelect('SUM(detail.total_price)', 'totalValue')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', { type: StockTransactionType.EXPORT })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .getRawOne();

    const targetDate = filters.date || new Date().toISOString().split('T')[0];
    const summaryToday = await this.stockTransactionDetailRepository.createQueryBuilder('detail')
      .leftJoin('detail.transaction', 'transaction')
      .select('COUNT(detail.id)', 'totalItems')
      .addSelect('SUM(detail.total_price)', 'totalValue')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', { type: StockTransactionType.EXPORT })
      .andWhere('DATE(transaction.transaction_date) = :targetDate', { targetDate })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .getRawOne();

    // 2. Export Type Statistics
    const allExportTypes = await this.assetExportTypeRepository.find({ where: { storeId, isActive: true } });
    
    const typeStatsQb = this.stockTransactionDetailRepository.createQueryBuilder('detail')
      .select('transaction.asset_export_type_id', 'typeId')
      .addSelect('COUNT(detail.id)', 'itemCount')
      .leftJoin('detail.transaction', 'transaction')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', { type: StockTransactionType.EXPORT })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .groupBy('transaction.asset_export_type_id');


    if (filters.date) {
      typeStatsQb.andWhere('DATE(transaction.transaction_date) = :date', { date: filters.date });
    }

    const typeStatsRaw = await typeStatsQb.getRawMany();

    const typeDetails = allExportTypes.map(type => {
      const found = typeStatsRaw.find(r => r.typeId === type.id);
      return {
        id: type.id,
        name: type.name,
        colorCode: type.colorCode,
        count: found ? Number(found.itemCount) : 0
      };
    });

    const totalHistoryItems = typeDetails.reduce((sum, item) => sum + item.count, 0);

    // 3. Export History
    const exportHistoryQb = this.stockTransactionDetailRepository.createQueryBuilder('detail')
      .leftJoinAndSelect('detail.transaction', 'transaction')
      .leftJoinAndSelect('transaction.assetExportType', 'exportType')
      .leftJoinAndSelect('detail.asset', 'asset')
      .leftJoinAndSelect('asset.assetUnit', 'unit')
      .leftJoinAndSelect('asset.assetCategory', 'category')
      .leftJoinAndSelect('asset.store', 'store')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', { type: StockTransactionType.EXPORT })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .orderBy('transaction.transaction_date', 'DESC');


    if (filters.date) {
      exportHistoryQb.andWhere('DATE(transaction.transaction_date) = :date', { date: filters.date });
    }

    if (filters.assetExportTypeId) {
      exportHistoryQb.andWhere('transaction.asset_export_type_id = :typeId', { typeId: filters.assetExportTypeId });
    }

    const exportHistory = await exportHistoryQb.getMany();

    const formattedExports = exportHistory.map(detail => ({
      id: detail.id,
      assetName: detail.asset?.name,
      assetCode: detail.asset?.code,
      avatarUrl: detail.asset?.avatarUrl,
      categoryName: detail.asset?.assetCategory?.name,
      unitName: detail.asset?.assetUnit?.name,
      value: Number(detail.unitPrice),
      quantity: Number(detail.quantity),
      totalPrice: Number(detail.totalPrice),
      status: {
        id: detail.transaction?.assetExportType?.id,
        name: detail.transaction?.assetExportType?.name,
        colorCode: detail.transaction?.assetExportType?.colorCode
      },
      storeName: detail.asset?.store?.name,
      storeAvatarUrl: detail.asset?.store?.avatarUrl,
      exportDate: detail.transaction?.transactionDate,
      transactionCode: detail.transaction?.code,
      transactionId: detail.transaction?.id,
      note: detail.transaction?.note || detail.note
    }));

    return {
      summary: {
        total: {
          count: Number(summaryAllTime.totalItems) || 0,
          value: Number(summaryAllTime.totalValue) || 0,
        },
        today: {
          date: targetDate,
          count: Number(summaryToday.totalItems) || 0,
          value: Number(summaryToday.totalValue) || 0,
        }
      },
      statusStatistics: {
        all: totalHistoryItems,
        details: typeDetails
      },
      exportHistory: formattedExports
    };
  }


  async updateAsset(id: string, data: Partial<Asset>) {
    await this.assetRepository.update(id, data);
    return this.assetRepository.findOne({
      where: { id },
      relations: [
        'assetUnit',
        'responsibleEmployee',
        'assetCategory',
        'assetStatus',
      ],
    });
  }

  async deleteAsset(id: string) {
    await this.assetRepository.delete(id);
    return { message: 'Asset deleted successfully' };
  }

  // Product management
  async createProduct(storeId: string, data: any) {
    const product = this.productRepository.create({ ...data, storeId });
    const savedProduct = (await this.productRepository.save(
      product,
    )) as unknown as Product;

    // Create initial stock transaction if currentStock > 0
    if (data.currentStock > 0) {
      const transaction = new StockTransaction();
      transaction.storeId = storeId;
      transaction.type = StockTransactionType.IMPORT;
      transaction.code = `PN-INITIAL-PROD-${Date.now()}`;
      transaction.employeeId = data.employeeId; // Should be provided in request
      transaction.note = 'Nhập kho ban đầu';
      transaction.status = StockTransactionStatus.COMPLETED;
      transaction.totalAmount =
        (Number(data.costPrice) || 0) * Number(data.currentStock);

      const savedTransaction =
        await this.stockTransactionRepository.save(transaction);

      const detail = new StockTransactionDetail();
      detail.transactionId = savedTransaction.id;
      detail.productId = savedProduct.id;
      detail.quantity = Number(data.currentStock);
      detail.unitPrice = Number(data.costPrice) || 0;
      detail.totalPrice = transaction.totalAmount;

      await this.stockTransactionDetailRepository.save(detail);
    }

    return savedProduct;
  }

  async createProductsBulk(
    storeId: string,
    productsData: any[],
    files: Express.Multer.File[],
  ) {
    const savedProducts: Product[] = [];

    for (let i = 0; i < productsData.length; i++) {
      const data = productsData[i];
      
      // 1. Ánh xạ file (avatar_0, avatar_1...)
      const avatarFile = files.find(f => f.fieldname === `avatar_${i}`);
      if (avatarFile) data.avatarUrl = `/uploads/${avatarFile.filename}`;

      // 2. Tạo Product Entity
      const product = this.productRepository.create({ ...data, storeId });
      const savedProduct = (await this.productRepository.save(
        product,
      )) as unknown as Product;
      savedProducts.push(savedProduct);

      // 3. Tạo phiếu nhập kho nếu có tồn kho ban đầu
      if (data.currentStock > 0) {
        const transaction = new StockTransaction();
        transaction.storeId = storeId;
        transaction.type = StockTransactionType.IMPORT;
        transaction.code = `PN-PROD-INIT-${Date.now()}-${i}`;
        transaction.note = 'Nhập kho ban đầu';
        transaction.status = StockTransactionStatus.COMPLETED;
        transaction.totalAmount = (Number(data.costPrice) || 0) * Number(data.currentStock);

        const savedTransaction = await this.stockTransactionRepository.save(transaction);

        const detail = new StockTransactionDetail();
        detail.transactionId = savedTransaction.id;
        detail.productId = savedProduct.id;
        detail.quantity = Number(data.currentStock);
        detail.unitPrice = Number(data.costPrice) || 0;
        detail.totalPrice = transaction.totalAmount;

        await this.stockTransactionDetailRepository.save(detail);
      }
    }

    return savedProducts;
  }

  async getProducts(storeId: string) {

    return this.productRepository.find({
      where: { storeId },
      relations: ['productUnit', 'productCategory', 'productStatus'],
    });
  }

  async updateProduct(id: string, data: Partial<Product>) {
    await this.productRepository.update(id, data);
    return this.productRepository.findOne({
      where: { id },
      relations: ['productUnit', 'productCategory', 'productStatus'],
    });
  }

  async deleteProduct(id: string) {
    await this.productRepository.delete(id);
    return { message: 'Product deleted successfully' };
  }

  async renewContract(contractId: string, data: any) {
    // 1. Get old contract
    const oldContract = await this.contractRepository.findOne({
      where: { id: contractId },
    });
    if (!oldContract) throw new NotFoundException('Không tìm thấy hợp đồng cũ');
    if (!oldContract.isActive) throw new BadRequestException('Chỉ có thể gia hạn hợp đồng đang hiệu lực');

    // 2. Archive old contract
    oldContract.isActive = false;
    // Nếu không truyền endDate mới thì lấy ngày hiện tại làm ngày kết thúc hợp đồng cũ
    if (!oldContract.endDate) {
      oldContract.endDate = new Date(); 
    }
    await this.contractRepository.save(oldContract);

    // 3. Create new contract
    const newContract = this.contractRepository.create({
      employeeProfileId: oldContract.employeeProfileId,
      contractName: data.contractName || oldContract.contractName, // Giữ tên cũ hoặc tên mới
      jobDescription: data.jobDescription || oldContract.jobDescription,
      startDate: new Date(), // Bắt đầu từ hôm nay
      endDate: data.endDate,
      paymentType: oldContract.paymentType, // Giữ nguyên hình thức trả lương
      salaryAmount: data.salaryAmount || oldContract.salaryAmount, // Lương mới
      allowances: data.allowances || oldContract.allowances,
      terms: oldContract.terms, // Giữ nguyên điều khoản (nếu cần đổi thì phải làm API riêng)
      contractFileUrl: undefined, // Reset file hợp đồng vì phải ký lại
      isActive: true,
    });

    return this.contractRepository.save(newContract);
  }

  async updateContract(contractId: string, data: any) {
    const contract = await this.contractRepository.findOne({
      where: { id: contractId },
    });
    if (!contract) throw new NotFoundException('Không tìm thấy hợp đồng');

    // Chỉ cho phép cập nhật các trường được truyền lên
    Object.assign(contract, data);
    
    return this.contractRepository.save(contract);
  }

  // Unit management
  async createAssetUnit(storeId: string, data: Partial<AssetUnit>) {
    const unit = this.assetUnitRepository.create({ ...data, storeId });
    return this.assetUnitRepository.save(unit);
  }

  async getAssetUnits(storeId: string) {
    return this.assetUnitRepository.find({
      where: { storeId, isActive: true },
    });
  }

  async createProductUnit(storeId: string, data: Partial<ProductUnit>) {
    const unit = this.productUnitRepository.create({ ...data, storeId });
    return this.productUnitRepository.save(unit);
  }

  async getProductUnits(storeId: string) {
    return this.productUnitRepository.find({
      where: { storeId, isActive: true },
    });
  }

  // Manual Employee Creation
  async createManualEmployee(
    data: any,
    accountsService: AccountsService,
    mailService: MailService,
  ) {
    // Generate random password
    const plainPassword = Math.random().toString(36).slice(-8);

    // 1. Create Account
    const newAccount = await accountsService.create({
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      passwordHash: plainPassword, // Passed as plain, hashed in accountsService.create
      gender: data.gender,
      birthday: data.birthday ? new Date(data.birthday) : undefined,
      avatar: data.avatarUrl,
      address: data.address,
      maritalStatus: data.maritalStatus,
      status: AccountStatus.ACTIVE,
    });

    // 2. Create Identity Document
    if (data.documentNumber || data.frontIdentificationUrl || data.backIdentificationUrl) {
      await accountsService.createIdentityDocument(newAccount.id, {
        documentNumber: data.documentNumber,
        frontImageUrl: data.frontIdentificationUrl,
        backImageUrl: data.backIdentificationUrl,
      });
    }

    // 3. Create Finance Info
    if (data.bankName || data.bankNumber) {
      await accountsService.createFinance(newAccount.id, {
        bankName: data.bankName,
        bankNumber: data.bankNumber,
      });
    }

    // Check probation settings
    const probationSetting = await this.probationSettingRepository.findOne({ where: { storeId: data.storeId } });
    let probationEndsAt: Date | undefined;
    let employmentStatus = EmploymentStatus.ACTIVE;

    if (probationSetting && probationSetting.probationDays > 0) {
      const now = new Date();
      probationEndsAt = new Date(now.getTime() + probationSetting.probationDays * 24 * 60 * 60 * 1000);
      employmentStatus = EmploymentStatus.PROBATION;
    }

    // 4. Create Employee Profile
    const newProfile = this.profileRepository.create({
      storeId: data.storeId,
      accountId: newAccount.id,
      storeRoleId: data.storeRoleId,
      employeeTypeId: data.employeeTypeId,
      workShiftId: data.workShiftId,
      skillId: data.skillId,
      joinedAt: new Date(),
      employmentStatus,
      probationEndsAt,
    });

    const savedProfile: any = await this.profileRepository.save(newProfile);


    // 5. Create Contract
    if (data.contract) {
      await this.createContract(savedProfile.id, data.contract);
    }

    // 6. Send Email
    try {
      await mailService.sendPasswordEmail(
        newAccount.email,
        newAccount.fullName,
        plainPassword,
      );
    } catch (error) {
      console.error('Failed to send password email:', error);
      // We don't throw here to avoid failing the whole process
    }

    // 7. Create Monthly Summary for current month
    await this.createOrUpdateMonthlySummary(
      savedProfile.id,
      data.contract?.salaryAmount || 0,
    );

    // 8. Assign Assets if provided
    if (data.assetIds && Array.isArray(data.assetIds) && data.assetIds.length > 0) {
      for (const assetId of data.assetIds) {
        const asset = await this.assetRepository.findOne({ where: { id: assetId } });
        if (asset && asset.currentStock > 0) {
          // Check for existing assignment (consistency check)
          let assignment = await this.assetAssignmentRepository.findOne({
            where: {
              employeeProfileId: savedProfile.id,
              assetId: assetId,
              status: AssetAssignmentStatus.ASSIGNED,
            },
          });

          if (assignment) {
            assignment.quantity += 1;
            await this.assetAssignmentRepository.save(assignment);
          } else {
            // Create assignment
            assignment = this.assetAssignmentRepository.create({
              employeeProfileId: savedProfile.id,
              assetId: assetId,
              quantity: 1,
              assignedById: undefined, // No manager assigned — initial setup during employee creation
              note: 'Cấp phát ban đầu khi tạo nhân viên',
            });
            await this.assetAssignmentRepository.save(assignment);
          }

          // Update stock
          asset.currentStock -= 1;
          await this.assetRepository.save(asset);
        }
      }
    }

    // 9. Create EmployeeSalary for current month
    const currentDate = new Date();
    const currentMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    
    // Find or create monthly payroll for current month
    let monthlyPayroll = await this.payrollRepository.findOne({
      where: { storeId: savedProfile.storeId, month: currentMonth }
    });
    
    if (!monthlyPayroll) {
      monthlyPayroll = await this.createMonthlyPayrollForStore(savedProfile.storeId, currentMonth);
    }

    // Create salary slip for this employee
    await this.createEmployeeSalary({
      employeeProfileId: savedProfile.id,
      month: currentMonth,
      monthlyPayrollId: monthlyPayroll.id,
      baseSalary: data.contract?.salaryAmount || 0,
      paymentType: data.contract?.paymentType,
      workingDays: 0,
      workingHours: 0
    });

    return this.getEmployeeById(savedProfile.id);
  }

  // Helper method to create or update monthly summary
  async createOrUpdateMonthlySummary(
    employeeProfileId: string,
    baseSalary: number = 0,
    month?: Date,
  ) {
    const targetMonth = month || new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const existing = await this.monthlySummaryRepository.findOne({
      where: { employeeProfileId, month: targetMonth },
    });

    if (existing) {
      return existing;
    }

    const summary = this.monthlySummaryRepository.create({
      employeeProfileId,
      month: targetMonth,
      baseSalary,
      estimatedSalary: 0, // Sẽ được tính sau khi nhân viên checkin
    });

    return this.monthlySummaryRepository.save(summary);
  }

  // Monthly Payroll management
  async createPayroll(storeId: string, data: Partial<MonthlyPayroll>) {
    const payroll = this.payrollRepository.create({ ...data, storeId });
    return this.payrollRepository.save(payroll);
  }

  async getPayrolls(storeId: string) {
    return this.payrollRepository.find({
      where: { storeId },
      order: { month: 'DESC' },
    });
  }

  async getPayrollById(id: string) {
    return this.payrollRepository.findOne({ where: { id } });
  }

  async getPayrollByMonth(storeId: string, date: Date) {
    // Set to first day of month
    const month = new Date(date.getFullYear(), date.getMonth(), 1);
    
    return this.payrollRepository.findOne({
      where: { storeId, month },
    });
  }

  async updatePayroll(id: string, data: Partial<MonthlyPayroll>) {
    await this.payrollRepository.update(id, data);
    return this.payrollRepository.findOne({ where: { id } });
  }

  async deletePayroll(id: string) {
    await this.payrollRepository.delete(id);
    return { message: 'Payroll deleted successfully' };
  }

  async createMonthlyPayrollForStore(storeId: string, date?: Date) {
    const currentDate = date || new Date();
    const month = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const nextMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);

    console.log(`📊 [Payroll] Creating payroll for store=${storeId}, month=${month.toISOString().slice(0, 7)}`);

    // 1. Create or find MonthlyPayroll
    let payroll = await this.payrollRepository.findOne({
      where: { storeId, month },
    });

    if (!payroll) {
      payroll = this.payrollRepository.create({
        storeId,
        month,
        estimatedPayment: 0,
        salaryFund: 0,
        totalBonus: 0,
        totalPenalty: 0,
        totalOvertime: 0,
        totalPendingApproval: 0,
        totalApproved: 0,
        isFinalized: false,
      });
      payroll = await this.payrollRepository.save(payroll);
    }

    // 2. Load payroll rules for this store
    const payrollRules = await this.payrollRuleRepository.find({
      where: { storeId, isActive: true },
    });

    // 3. Load payroll settings
    const payrollSetting = await this.payrollSettingRepository.findOne({
      where: { storeId, isActive: true },
    });

    // 4. Get all active employees
    const employees = await this.profileRepository.find({
      where: { storeId, employmentStatus: EmploymentStatus.ACTIVE },
      relations: ['contracts'],
    });

    console.log(`📊 [Payroll] Found ${employees.length} active employees`);

    let totalEstimatedPayment = 0;
    let totalBonus = 0;
    let totalPenalty = 0;

    for (const employee of employees) {
      // Skip if salary already exists for this month
      const existingSalary = await this.employeeSalaryRepository.findOne({
        where: { employeeProfileId: employee.id, month },
      });
      if (existingSalary) {
        totalEstimatedPayment += Number(existingSalary.netSalary) || 0;
        totalBonus += Number(existingSalary.bonus) || 0;
        totalPenalty += Number(existingSalary.penalty) || 0;
        continue;
      }

      // Resolve active contract
      const activeContract = employee.contracts?.find(c => c.isActive);
      if (!activeContract) {
        console.log(`⚠️ [Payroll] Skip ${employee.id} — no active contract`);
        continue;
      }

      // Check salary adjustments
      const adjustment = await this.salaryAdjustmentRepository.findOne({
        where: { employeeProfileId: employee.id, effectiveMonth: month },
        order: { createdAt: 'DESC' },
      });

      let currentBaseSalary = Number(activeContract.salaryAmount);
      if (adjustment) {
        currentBaseSalary = Number(adjustment.newSalary);
        await this.contractRepository.update(activeContract.id, { salaryAmount: currentBaseSalary });
      }

      // ========== AGGREGATE ATTENDANCE DATA ==========
      const attendanceSummary = await this.calculateEmployeeAttendanceSummary(
        employee.id, storeId, month, nextMonth,
      );

      console.log(`📊 [Payroll] Employee ${employee.id}: ${attendanceSummary.completedShifts} shifts, ${attendanceSummary.workingHours.toFixed(1)}h, late=${attendanceSummary.lateCount}, early=${attendanceSummary.earlyCount}`);

      // ========== CALCULATE SALARY ==========
      // Prefer real-time per-shift earnings if available
      const paymentType = activeContract.paymentType || PaymentType.MONTH;
      let calculatedSalary = 0;

      if (attendanceSummary.hasShiftEarnings) {
        // Use SUM of real-time shift earnings (calculated at each checkout)
        calculatedSalary = attendanceSummary.totalShiftEarnings;
        this.logger.debug(`[Payroll] Using real-time shiftEarnings SUM: ${calculatedSalary}`);
      } else if (paymentType === PaymentType.HOUR || payrollSetting?.calculationMethod === PayrollCalculationMethod.HOUR) {
        // HOURLY rate: salaryAmount is the hourly rate (VND/hour)
        // Standard monthly hours = 176 (22 days × 8h), but we only use the ratio for proper prorating
        const STANDARD_MONTHLY_HOURS = 176;
        calculatedSalary = currentBaseSalary * (attendanceSummary.workingHours / STANDARD_MONTHLY_HOURS);
      } else if (paymentType === PaymentType.SHIFT || payrollSetting?.calculationMethod === PayrollCalculationMethod.SHIFT) {
        // Fallback: Per-shift
        calculatedSalary = currentBaseSalary * attendanceSummary.completedShifts;
      } else if (paymentType === PaymentType.DAY || payrollSetting?.calculationMethod === PayrollCalculationMethod.DAY) {
        // Fallback: Per-day
        calculatedSalary = currentBaseSalary * attendanceSummary.completedShifts;
      } else {
        // Fallback: Monthly prorate by shifts completed
        const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
        if (daysInMonth > 0) {
          calculatedSalary = currentBaseSalary * (attendanceSummary.completedShifts / daysInMonth);
        } else {
          calculatedSalary = currentBaseSalary;
        }
      }

      // ========== APPLY PAYROLL RULES (Bonus/Penalty) ==========
      let bonus = 0;
      let penalty = 0;

      for (const rule of payrollRules) {
        if (rule.category === PayrollRuleCategory.FINE) {
          // Late penalty rules
          if (rule.ruleType === 'LATE' && attendanceSummary.lateCount > 0) {
            if (rule.calcType === PayrollCalcType.AMOUNT) {
              penalty += Number(rule.value) * attendanceSummary.lateCount;
            } else if (rule.calcType === PayrollCalcType.PERCENTAGE) {
              penalty += (calculatedSalary * Number(rule.value) / 100) * attendanceSummary.lateCount;
            }
          }
          // Early leave penalty
          if (rule.ruleType === 'EARLY' && attendanceSummary.earlyCount > 0) {
            if (rule.calcType === PayrollCalcType.AMOUNT) {
              penalty += Number(rule.value) * attendanceSummary.earlyCount;
            } else if (rule.calcType === PayrollCalcType.PERCENTAGE) {
              penalty += (calculatedSalary * Number(rule.value) / 100) * attendanceSummary.earlyCount;
            }
          }
          // Absent penalty
          if (rule.ruleType === 'ABSENT' && attendanceSummary.absentCount > 0) {
            if (rule.calcType === PayrollCalcType.AMOUNT) {
              penalty += Number(rule.value) * attendanceSummary.absentCount;
            }
          }
        } else if (rule.category === PayrollRuleCategory.BONUS) {
          // Attendance bonus (e.g., full attendance bonus)
          if (rule.ruleType === 'ATTENDANCE' && attendanceSummary.lateCount === 0 && attendanceSummary.absentCount === 0) {
            bonus += Number(rule.value);
          }
          // Other bonuses
          if (!rule.ruleType || rule.ruleType === 'GENERAL') {
            bonus += Number(rule.value);
          }
        }
      }

      // ========== CALCULATE TOTALS ==========
      const allowancesTotal = activeContract.allowances
        ? Object.values(activeContract.allowances).reduce((sum, v) => sum + Number(v || 0), 0)
        : 0;
      const totalIncome = calculatedSalary + allowancesTotal + bonus;
      const advancePayment = 0; // Will be filled from salary advance requests
      const otherDeductions = 0;
      const totalDeductions = penalty + advancePayment + otherDeductions;
      const netSalary = Math.max(0, totalIncome - totalDeductions);

      // ========== SAVE EmployeeSalary ==========
      await this.createEmployeeSalary({
        employeeProfileId: employee.id,
        month,
        monthlyPayrollId: payroll.id,
        baseSalary: currentBaseSalary,
        paymentType,
        workingDays: attendanceSummary.completedShifts,
        workingHours: attendanceSummary.workingHours,
        unauthorizedLeaveDays: attendanceSummary.absentCount,
        bonus,
        penalty,
        totalIncome,
        totalDeductions,
        netSalary,
        advancePayment,
        otherDeductions,
      });

      console.log(`✅ [Payroll] ${employee.id}: salary=${calculatedSalary.toFixed(0)}, bonus=${bonus.toFixed(0)}, penalty=${penalty.toFixed(0)}, net=${netSalary.toFixed(0)}`);

      totalEstimatedPayment += netSalary;
      totalBonus += bonus;
      totalPenalty += penalty;
    }

    // 5. Update MonthlyPayroll totals
    payroll.estimatedPayment = totalEstimatedPayment;
    payroll.totalBonus = totalBonus;
    payroll.totalPenalty = totalPenalty;
    payroll.totalPendingApproval = totalEstimatedPayment;
    await this.payrollRepository.save(payroll);

    console.log(`📊 [Payroll] DONE — total=${totalEstimatedPayment.toFixed(0)}, bonus=${totalBonus.toFixed(0)}, penalty=${totalPenalty.toFixed(0)}`);

    return payroll;
  }

  /**
   * Recalculate payroll for a store — deletes old salary records and recalculates from attendance.
   * Uses a transaction to prevent data loss if recalculation fails mid-way.
   */
  async recalculatePayroll(storeId: string, date?: Date) {
    const currentDate = date || new Date();
    const month = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const dataSource = this.payrollRepository.manager;

    console.log(`🔄 [Payroll] Recalculating payroll for store=${storeId}, month=${month.toISOString().slice(0, 7)}`);

    return dataSource.transaction(async (manager) => {
      // 1. Delete existing salary records for this month
      const deleteResult = await manager
        .createQueryBuilder()
        .delete()
        .from('employee_salaries')
        .where('monthly_payroll_id IN (SELECT id FROM monthly_payrolls WHERE store_id = :storeId AND month = :month)', { storeId, month: month.toISOString().slice(0, 10) })
        .execute();

      console.log(`🗑️ [Payroll] Deleted ${deleteResult.affected || 0} old salary records`);

      // 2. Delete the MonthlyPayroll record so it gets recreated cleanly
      await manager.delete(MonthlyPayroll, { storeId, month });

      // 3. Recreate payroll via a managed query (bypass the standalone repo to stay in transaction)
      const payroll = manager.create(MonthlyPayroll, {
        storeId,
        month,
        estimatedPayment: 0,
        salaryFund: 0,
        totalBonus: 0,
        totalPenalty: 0,
        totalOvertime: 0,
        totalPendingApproval: 0,
        totalApproved: 0,
        isFinalized: false,
      });
      await manager.save(payroll);

      // 4. Load payroll rules and settings via manager
      const [payrollRules, payrollSetting] = await Promise.all([
        manager.findBy(StorePayrollRule, { storeId, isActive: true }),
        manager.findOne(StorePayrollSetting, { where: { storeId, isActive: true } }),
      ]);

      // 5. Get active employees via manager
      const employees = await manager.find(EmployeeProfile, {
        where: { storeId, employmentStatus: EmploymentStatus.ACTIVE },
        relations: ['contracts'],
      });

      let totalEstimatedPayment = 0;
      let totalBonus = 0;
      let totalPenalty = 0;

      for (const employee of employees) {
        const activeContract = employee.contracts?.find(c => c.isActive);
        if (!activeContract) continue;

        const adjustment = await manager.findOne(SalaryAdjustment, {
          where: { employeeProfileId: employee.id, effectiveMonth: month },
          order: { createdAt: 'DESC' },
        });

        let currentBaseSalary = Number(activeContract.salaryAmount);
        if (adjustment) {
          currentBaseSalary = Number(adjustment.newSalary);
          await manager.update(EmployeeContract, activeContract.id, { salaryAmount: currentBaseSalary });
        }

        const attendanceSummary = await this.calculateEmployeeAttendanceSummary(
          employee.id, storeId, month,
          new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1),
        );

        const paymentType = activeContract.paymentType || PaymentType.MONTH;
        let calculatedSalary = 0;

        if (attendanceSummary.hasShiftEarnings) {
          calculatedSalary = attendanceSummary.totalShiftEarnings;
        } else if (paymentType === PaymentType.HOUR || payrollSetting?.calculationMethod === PayrollCalculationMethod.HOUR) {
          const STANDARD_MONTHLY_HOURS = 176;
          calculatedSalary = currentBaseSalary * (attendanceSummary.workingHours / STANDARD_MONTHLY_HOURS);
        } else if (paymentType === PaymentType.SHIFT || payrollSetting?.calculationMethod === PayrollCalculationMethod.SHIFT) {
          calculatedSalary = currentBaseSalary * attendanceSummary.completedShifts;
        } else if (paymentType === PaymentType.DAY || payrollSetting?.calculationMethod === PayrollCalculationMethod.DAY) {
          calculatedSalary = currentBaseSalary * attendanceSummary.completedShifts;
        } else {
          const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
          calculatedSalary = daysInMonth > 0
            ? currentBaseSalary * (attendanceSummary.completedShifts / daysInMonth)
            : currentBaseSalary;
        }

        let bonus = 0;
        let penalty = 0;

        for (const rule of payrollRules) {
          if (rule.category === PayrollRuleCategory.FINE) {
            if (rule.ruleType === 'LATE' && attendanceSummary.lateCount > 0) {
              penalty += rule.calcType === PayrollCalcType.AMOUNT
                ? Number(rule.value) * attendanceSummary.lateCount
                : (calculatedSalary * Number(rule.value) / 100) * attendanceSummary.lateCount;
            }
            if (rule.ruleType === 'EARLY' && attendanceSummary.earlyCount > 0) {
              penalty += rule.calcType === PayrollCalcType.AMOUNT
                ? Number(rule.value) * attendanceSummary.earlyCount
                : (calculatedSalary * Number(rule.value) / 100) * attendanceSummary.earlyCount;
            }
            if (rule.ruleType === 'ABSENT' && attendanceSummary.absentCount > 0 && rule.calcType === PayrollCalcType.AMOUNT) {
              penalty += Number(rule.value) * attendanceSummary.absentCount;
            }
          } else if (rule.category === PayrollRuleCategory.BONUS) {
            if (rule.ruleType === 'ATTENDANCE' && attendanceSummary.lateCount === 0 && attendanceSummary.absentCount === 0) {
              bonus += Number(rule.value);
            }
            if (!rule.ruleType || rule.ruleType === 'GENERAL') {
              bonus += Number(rule.value);
            }
          }
        }

        const allowancesTotal = activeContract.allowances
          ? Object.values(activeContract.allowances).reduce((sum, v) => sum + Number(v || 0), 0)
          : 0;
        const totalIncome = calculatedSalary + allowancesTotal + bonus;
        const totalDeductions = penalty;
        const netSalary = Math.max(0, totalIncome - totalDeductions);

        const salaryRecord = manager.create(EmployeeSalary, {
          employeeProfileId: employee.id,
          month,
          monthlyPayrollId: payroll.id,
          baseSalary: currentBaseSalary,
          paymentType,
          workingDays: attendanceSummary.completedShifts,
          workingHours: attendanceSummary.workingHours,
          unauthorizedLeaveDays: attendanceSummary.absentCount,
          bonus,
          penalty,
          totalIncome,
          totalDeductions,
          netSalary,
        });
        await manager.save(EmployeeSalary, salaryRecord);
        totalEstimatedPayment += netSalary;
        totalBonus += bonus;
        totalPenalty += penalty;
      }

      payroll.estimatedPayment = totalEstimatedPayment;
      payroll.totalBonus = totalBonus;
      payroll.totalPenalty = totalPenalty;
      payroll.totalPendingApproval = totalEstimatedPayment;
      await manager.save(payroll);

      console.log(`📊 [Payroll] Recalculate DONE — total=${totalEstimatedPayment.toFixed(0)}`);
      return payroll;
    });
  }

  /**
   * Aggregate attendance data for an employee in a given month.
   * Queries ShiftAssignments linked to ShiftSlots with workDate in [month, nextMonth).
   */
  private async calculateEmployeeAttendanceSummary(
    employeeProfileId: string,
    storeId: string,
    monthStart: Date,
    monthEnd: Date,
  ) {
    // Get all shift assignments for this employee in this month
    const assignments = await this.shiftAssignmentRepository
      .createQueryBuilder('sa')
      .leftJoinAndSelect('sa.shiftSlot', 'slot')
      .innerJoin('slot.cycle', 'cycle')
      .where('sa.employeeId = :employeeProfileId', { employeeProfileId })
      .andWhere('cycle.storeId = :storeId', { storeId })
      .andWhere('slot.workDate >= :monthStart', { monthStart: monthStart.toISOString().slice(0, 10) })
      .andWhere('slot.workDate < :monthEnd', { monthEnd: monthEnd.toISOString().slice(0, 10) })
      .getMany();

    const totalAssignedShifts = assignments.length;
    const completedShifts = assignments.filter(a => a.status === ShiftAssignmentStatus.COMPLETED).length;
    const confirmedShifts = assignments.filter(a => a.status === ShiftAssignmentStatus.CONFIRMED).length;

    const totalWorkedMinutes = assignments
      .filter(a => a.workedMinutes > 0)
      .reduce((sum, a) => sum + a.workedMinutes, 0);

    const lateCount = assignments.filter(a => a.lateMinutes > 0).length;
    const totalLateMinutes = assignments.reduce((sum, a) => sum + (a.lateMinutes || 0), 0);

    const earlyCount = assignments.filter(a => a.earlyMinutes > 0).length;
    const totalEarlyMinutes = assignments.reduce((sum, a) => sum + (a.earlyMinutes || 0), 0);

    // Absent = approved but never checked in (past shifts only)
    const today = new Date().toISOString().slice(0, 10);
    const absentCount = assignments.filter(a =>
      a.status === ShiftAssignmentStatus.APPROVED &&
      !a.checkInTime &&
      a.shiftSlot?.workDate < today,
    ).length;

    // SUM of real-time shift earnings (from checkout)
    const totalShiftEarnings = assignments
      .filter(a => a.shiftEarnings != null)
      .reduce((sum, a) => sum + Number(a.shiftEarnings), 0);
    const hasShiftEarnings = assignments.some(a => a.shiftEarnings != null);

    return {
      totalAssignedShifts,
      completedShifts: completedShifts + confirmedShifts, // Both completed and checked-in count
      workingHours: Math.round((totalWorkedMinutes / 60) * 100) / 100,
      lateCount,
      totalLateMinutes,
      earlyCount,
      totalEarlyMinutes,
      absentCount,
      totalShiftEarnings,
      hasShiftEarnings,
    };
  }

  // --- Store Payroll Payment History ---

  async createPaymentHistory(storeId: string, data: CreateStorePayrollPaymentDto) {
    const payment = this.paymentHistoryRepository.create({
      ...data,
      storeId,
      month: new Date(new Date(data.month).getFullYear(), new Date(data.month).getMonth(), 1), // Normalize to first of month
      paymentDate: data.paymentDate ? new Date(data.paymentDate) : new Date(),
    });
    return this.paymentHistoryRepository.save(payment);
  }

  async getPaymentHistories(storeId: string) {
    return this.paymentHistoryRepository.find({
      where: { storeId },
      order: { paymentDate: 'DESC' },
    });
  }

  async updatePaymentHistory(id: string, data: UpdateStorePayrollPaymentDto) {
    const payment = await this.paymentHistoryRepository.findOne({ where: { id } });
    if (!payment) throw new NotFoundException('Không tìm thấy lịch sử thanh toán');

    Object.assign(payment, data);
    return this.paymentHistoryRepository.save(payment);
  }

  async deletePaymentHistory(id: string) {
    const payment = await this.paymentHistoryRepository.findOne({ where: { id } });
    if (!payment) throw new NotFoundException('Không tìm thấy lịch sử thanh toán');

    return this.paymentHistoryRepository.remove(payment);
  }

  async getPayrollSummary(storeId: string, dateStr: string): Promise<PayrollMonthlySummaryResponseDto> {
    let date: Date;
    if (dateStr.includes('/')) {
      const [month, year] = dateStr.split('/').map(Number);
      date = new Date(year, month - 1, 1);
    } else {
      date = new Date(dateStr);
    }
    
    const currentMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const prevMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);

    // 1. Fetch current and previous payroll records
    const [currentPayroll, previousPayroll] = await Promise.all([
      this.payrollRepository.findOne({ where: { storeId, month: currentMonth } }),
      this.payrollRepository.findOne({ where: { storeId, month: prevMonth } }),
    ]);

    // 2. Fetch payment history for current month
    const paymentHistory = await this.paymentHistoryRepository.find({
      where: { storeId, month: currentMonth },
      order: { paymentDate: 'DESC' },
    });

    const calculateChange = (current: number, previous: number) => {
      if (!previous || previous === 0) return current > 0 ? 100 : 0;
      return parseFloat((((current - previous) / previous) * 100).toFixed(2));
    };

    const getSummaryValue = (current: number, previous: number) => ({
      value: current || 0,
      changePercent: calculateChange(current || 0, previous || 0),
    });

    // 3. Count approved and pending salaries
    const [totalApproved, totalPendingApproval] = await Promise.all([
      this.employeeSalaryRepository.count({
        where: {
          monthlyPayroll: { storeId, month: currentMonth },
          paymentStatus: In([PaymentStatus.APPROVED, PaymentStatus.PAID]),
        },
      }),
      this.employeeSalaryRepository.count({
        where: {
          monthlyPayroll: { storeId, month: currentMonth },
          paymentStatus: PaymentStatus.PENDING,
        },
      }),
    ]);

    return {
      estimatedPayment: Number(currentPayroll?.estimatedPayment || 0),
      totalBonus: getSummaryValue(
        Number(currentPayroll?.totalBonus),
        Number(previousPayroll?.totalBonus),
      ),
      totalPenalty: getSummaryValue(
        Number(currentPayroll?.totalPenalty),
        Number(previousPayroll?.totalPenalty),
      ),
      totalOvertime: getSummaryValue(
        Number(currentPayroll?.totalOvertime),
        Number(previousPayroll?.totalOvertime),
      ),
      totalApproved,
      totalPendingApproval,
      salaryFund: Number(currentPayroll?.salaryFund || 0),
      paymentHistory,
    };
  }

  async getPayrollDetailsList(storeId: string, monthStr: string) {
    let targetMonth: Date;
    if (monthStr.includes('/')) {
      const [m, y] = monthStr.split('/').map(Number);
      targetMonth = new Date(y, m - 1, 1);
    } else {
      const parsed = new Date(monthStr);
      targetMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
    }

    const payroll = await this.payrollRepository.findOne({
      where: { storeId, month: targetMonth },
    });

    if (!payroll) {
      return { bonuses: [], penalties: [], overtimes: [] };
    }

    const salaries = await this.employeeSalaryRepository.find({
      where: { monthlyPayrollId: payroll.id },
      relations: ['employeeProfile', 'employeeProfile.account', 'employeeProfile.employeeType', 'employeeProfile.storeRole'],
    });

    if (salaries.length === 0) {
      return { bonuses: [], penalties: [], overtimes: [] };
    }

    const summaries = await this.monthlySummaryRepository.find({
      where: {
        employeeProfileId: In(salaries.map(s => s.employeeProfileId)),
        month: targetMonth,
      },
    });

    const summaryMap = new Map();
    summaries.forEach(s => summaryMap.set(s.employeeProfileId, s));

    const bonuses: any[] = [];
    const penalties: any[] = [];
    const overtimes: any[] = [];

    salaries.forEach(salary => {
      const profile = salary.employeeProfile;
      const summary = summaryMap.get(salary.employeeProfileId);

      const baseInfo = {
        id: profile?.id,
        name: (profile?.account as any)?.fullName || (profile?.account as any)?.name || 'Unknown',
        position: profile?.storeRole?.name || '',
        type: profile?.employeeType?.name || '',
        avatar: (profile?.account as any)?.avatarUrl || (profile?.account as any)?.avatar || '',
      };

      if (Number(salary.penalty) > 0) {
        let reasons: string[] = [];
        if (summary) {
          if (summary.lateArrivalsCount > 0) reasons.push(`Muộn ${summary.lateArrivalsCount} lần`);
          if (summary.earlyDeparturesCount > 0) reasons.push(`Về sớm ${summary.earlyDeparturesCount} lần`);
          if (summary.unauthorizedLeavesCount > 0) reasons.push(`Nghỉ KP ${summary.unauthorizedLeavesCount} lần`);
          if (summary.forgotClockOutCount > 0) reasons.push(`Quên Check-out ${summary.forgotClockOutCount} lần`);
          if (summary.absentCount > 0) reasons.push(`Vắng ${summary.absentCount} ca`);
        }
        penalties.push({
          ...baseInfo,
          penaltyReason: reasons.length > 0 ? reasons.join(', ') : 'Vi phạm quy định',
          penaltyAmount: Number(salary.penalty),
        });
      }

      if (Number(salary.bonus) > 0) {
        bonuses.push({
          ...baseInfo,
          bonusReason: 'Thưởng chuyên cần / Thưởng chung',
          bonusAmount: Number(salary.bonus),
        });
      }

      if (summary && summary.extraShiftsCount > 0) {
        overtimes.push({
          ...baseInfo,
          overtimeReason: `Làm thêm ${summary.extraShiftsCount} ca`,
          overtimeAmount: Number(summary.overtimePay || 0),
        });
      }
    });

    return { bonuses, penalties, overtimes };
  }

  async downloadPayrollReport(storeId: string, monthStr: string) {
    const exceljs = require('exceljs');
    const workbook = new exceljs.Workbook();
    
    let targetMonth: Date;
    if (monthStr.includes('/')) {
      const [m, y] = monthStr.split('/').map(Number);
      targetMonth = new Date(y, m - 1, 1);
    } else {
      const parsed = new Date(monthStr);
      targetMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
    }

    const payroll = await this.payrollRepository.findOne({
      where: { storeId, month: targetMonth },
    });

    if (!payroll) {
      throw new BadRequestException('Chưa có thông tin dữ liệu cho tháng này');
    }

    const salaries = await this.employeeSalaryRepository.find({
      where: { monthlyPayrollId: payroll.id },
      relations: ['employeeProfile', 'employeeProfile.account', 'employeeProfile.employeeType', 'employeeProfile.storeRole'],
    });

    if (salaries.length === 0) {
      throw new BadRequestException('Bảng lương tháng này chưa có nhân viên nào');
    }

    const ws1 = workbook.addWorksheet('Ghi chú bảng lương');
    ws1.columns = [
      { header: 'STT', key: 'stt', width: 5 },
      { header: 'Tên nhân viên', key: 'name', width: 25 },
      { header: 'Vị trí', key: 'role', width: 20 },
      { header: 'Lương cơ bản', key: 'base', width: 15 },
      { header: 'Thưởng', key: 'bonus', width: 15 },
      { header: 'Khấu trừ (Phạt/Ứng)', key: 'deductions', width: 22 },
      { header: 'Tổng thu nhập', key: 'income', width: 15 },
      { header: 'Thực lãnh', key: 'net', width: 15 },
    ];

    ws1.getRow(1).font = { bold: true };
    salaries.forEach((salary, idx) => {
      const profile = salary.employeeProfile;
      ws1.addRow({
        stt: idx + 1,
        name: (profile?.account as any)?.fullName || (profile?.account as any)?.name || 'Unknown',
        role: profile?.storeRole?.name || '',
        base: Number(salary.baseSalary || 0),
        bonus: Number(salary.bonus || 0),
        deductions: Number(salary.totalDeductions || salary.penalty || 0),
        income: Number(salary.totalIncome || 0),
        net: Number(salary.netSalary || 0)
      });
    });

    for (let i = 2; i <= salaries.length + 1; i++) {
        ['base', 'bonus', 'deductions', 'income', 'net'].forEach(col => {
            const cell = ws1.getRow(i).getCell(col);
            if (cell.value) {
                cell.numFmt = '#,##0';
            }
        });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async updateSalaryFund(storeId: string, dateStr: string, salaryFund: number, userId?: string) {
    if (!dateStr) throw new BadRequestException('Vui lòng cung cấp ngày tháng (date)');
    
    let date: Date;
    if (dateStr.includes('/')) {
      const [month, year] = dateStr.split('/').map(Number);
      date = new Date(year, month - 1, 1);
    } else {
      date = new Date(dateStr);
    }
    const month = new Date(date.getFullYear(), date.getMonth(), 1);

    let payroll = await this.payrollRepository.findOne({
      where: { storeId, month },
    });

    const oldValue = payroll ? Number(payroll.salaryFund) : 0;
    const isNew = !payroll;

    if (!payroll) {
      payroll = this.payrollRepository.create({
        storeId,
        month,
        salaryFund,
      });
    } else {
      payroll.salaryFund = salaryFund;
    }

    const savedPayroll = await this.payrollRepository.save(payroll);

    // Save history
    if (oldValue !== salaryFund) {
      const history = this.salaryFundHistoryRepository.create({
        storeId,
        month,
        oldValue,
        newValue: salaryFund,
        reason: isNew ? 'Khởi tạo quỹ lương' : 'Cập nhật quỹ lương',
        changedBy: userId,
      });
      await this.salaryFundHistoryRepository.save(history);
    }

    return savedPayroll;
  }

  async getSalaryFundHistory(storeId: string, dateStr?: string) {
    const query = this.salaryFundHistoryRepository.createQueryBuilder('history')
      .where('history.storeId = :storeId', { storeId })
      .orderBy('history.createdAt', 'DESC');

    if (dateStr) {
      let date: Date;
      if (dateStr.includes('/')) {
        const [month, year] = dateStr.split('/').map(Number);
        date = new Date(year, month - 1, 1);
      } else {
        date = new Date(dateStr);
      }
      const monthDate = new Date(date.getFullYear(), date.getMonth(), 1);
      query.andWhere('history.month = :month', { month: monthDate });
    }

    return query.getMany();
  }

  async createMonthlyPayrollsForAllStores(date?: Date) {
    const stores = await this.storeRepository.find({
      where: { status: StoreStatus.ACTIVE },
    });
    
    const results: MonthlyPayroll[] = [];
    for (const store of stores) {
      try {
        const payroll = await this.createMonthlyPayrollForStore(store.id, date);
        results.push(payroll);
      } catch (error) {
        console.error(`Failed to create monthly payroll for store ${store.id}:`, error);
      }
    }
    
    return results;
  }

  async createMonthlySummariesForAllEmployees(date?: Date) {
    const targetMonth = date || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    
    // Get all active employees across all stores
    const employees = await this.profileRepository.find({
      where: { employmentStatus: EmploymentStatus.ACTIVE },
      relations: ['contracts'],
    });
    
    const results: EmployeeMonthlySummary[] = [];
    for (const employee of employees) {
      try {
        // Get latest contract to determine base salary
        const latestContract = employee.contracts?.sort((a, b) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )[0];
        
        const baseSalary = latestContract?.salaryAmount || 0;
        
        const summary = await this.createOrUpdateMonthlySummary(
          employee.id,
          baseSalary,
          targetMonth,
        );
        results.push(summary);
      } catch (error) {
        console.error(`Failed to create monthly summary for employee ${employee.id}:`, error);
      }
    }
    
    return results;
  }

  // Salary Config management
  async createSalaryConfig(
    ownerAccountId: string,
    data: Partial<SalaryConfig>,
  ) {


    const config = this.salaryConfigRepository.create({
      ...data,
      ownerAccountId,
    });
    return this.salaryConfigRepository.save(config);
  }

  async changeSalaryConfigStatus(id: string, status: ConfigStatus) {
    const config = await this.salaryConfigRepository.findOne({ where: { id } });
    if (!config) throw new NotFoundException('Cấu hình không tồn tại');



    config.status = status;
    return this.salaryConfigRepository.save(config);
  }

  async getSalaryConfigsByStore(storeId: string) {
    const configs = await this.salaryConfigRepository.createQueryBuilder('config')
      .where('"config"."storeIds"::jsonb ? :storeId', { storeId })
      .orderBy('config.createdAt', 'DESC')
      .getMany();

    // Map storeIds to full Store objects
    const configsWithStores = await Promise.all(
      configs.map(async (config) => {
        if (config.storeIds && config.storeIds.length > 0) {
          const stores = await this.storeRepository.find({
            where: { id: In(config.storeIds) },
            select: ['id', 'name', 'addressLine', 'phone']
          });
          return { ...config, stores };
        }
        return { ...config, stores: [] };
      })
    );

    return configsWithStores;
  }

  async getSalaryConfigs(ownerAccountId: string) {
    return this.salaryConfigRepository.find({
      where: { ownerAccountId },
      order: { createdAt: 'DESC' },
    });
  }

  async getSalaryConfigById(id: string) {
    return this.salaryConfigRepository.findOne({ where: { id } });
  }

  async updateSalaryConfig(id: string, data: Partial<SalaryConfig>) {
    await this.salaryConfigRepository.update(id, data);
    return this.salaryConfigRepository.findOne({ where: { id } });
  }

  async deleteSalaryConfig(id: string) {
    await this.salaryConfigRepository.softDelete(id);
    return { message: 'Xóa cấu hình lương thành công' };
  }

  // Employee Salary management
  async createEmployeeSalary(data: Partial<EmployeeSalary>) {
    const salary = this.employeeSalaryRepository.create(data);
    return this.employeeSalaryRepository.save(salary);
  }

  async getEmployeeSalaries(employeeProfileId: string, month?: string) {
    const where: any = { employeeProfileId };
    if (month) {
      where.month = month;
    }
    return this.employeeSalaryRepository.find({
      where,
      order: { month: 'DESC' },
      relations: ['employeeProfile', 'monthlyPayroll'],
    });
  }

  async getEmployeeSalaryById(id: string) {
    return this.employeeSalaryRepository.findOne({
      where: { id },
      relations: ['employeeProfile', 'monthlyPayroll'],
    });
  }

  async getEmployeeSalariesByStore(storeId: string, monthStr: string, filterType?: string) {
    let month: Date;
    if (monthStr.includes('/')) {
      const [m, y] = monthStr.split('/').map(Number);
      month = new Date(y, m - 1, 1);
    } else {
      month = new Date(monthStr);
    }
    const targetMonth = new Date(month.getFullYear(), month.getMonth(), 1);

    // 1. Find the MonthlyPayroll for this store and month
    const payroll = await this.payrollRepository.findOne({
      where: { storeId, month: targetMonth },
    });

    if (!payroll) {
       return {
         salaries: [],
         typeCounts: []
       };
    }

    // 2. Find all employee salaries linked to this payroll
    const allSalaries = await this.employeeSalaryRepository.find({
      where: { monthlyPayrollId: payroll.id },
      relations: ['employeeProfile', 'employeeProfile.account', 'employeeProfile.employeeType', 'employeeProfile.storeRole'],
      order: {
        employeeProfile: {
           account: {
             fullName: 'ASC'
           }
        }
      }
    });

    // 3. Aggregate counts by Employee Type
    const typeMap = new Map<string, number>();
    let totalCount = 0;

    allSalaries.forEach(salary => {
      totalCount++;
      const typeName = salary.employeeProfile?.employeeType?.name || 'Unknown';
      typeMap.set(typeName, (typeMap.get(typeName) || 0) + 1);
    });

    const typeCounts = [
      { name: 'All', count: totalCount }
    ];

    typeMap.forEach((count, name) => {
      typeCounts.push({ name, count });
    });

    // 4. Filter salaries if type is specified
    let filteredSalaries = allSalaries;
    if (filterType && filterType !== 'All') {
      filteredSalaries = allSalaries.filter(salary => {
         const typeName = salary.employeeProfile?.employeeType?.name || 'Unknown';
         return typeName === filterType;
      });
    }

    return {
      salaries: filteredSalaries,
      typeCounts
    };
  }

  async updateEmployeeSalary(id: string, data: Partial<EmployeeSalary>) {
    await this.employeeSalaryRepository.update(id, data);
    return this.employeeSalaryRepository.findOne({
      where: { id },
      relations: ['employeeProfile', 'monthlyPayroll'],
    });
  }

  async deleteEmployeeSalary(id: string) {
    await this.employeeSalaryRepository.delete(id);
    return { message: 'Employee salary deleted successfully' };
  }

  // KPI Type management
  async createKpiType(storeId: string, data: Partial<KpiType>) {
    const type = this.kpiTypeRepository.create({ ...data, storeId });
    return this.kpiTypeRepository.save(type);
  }

  async getKpiTypes(storeId: string) {
    return this.kpiTypeRepository.find({ where: { storeId, isActive: true } });
  }

  // KPI Unit management
  async createKpiUnit(storeId: string, data: Partial<KpiUnit>) {
    const unit = this.kpiUnitRepository.create({ ...data, storeId });
    return this.kpiUnitRepository.save(unit);
  }

  async getKpiUnits(storeId: string) {
    return this.kpiUnitRepository.find({ where: { storeId, isActive: true } });
  }

  // KPI Period management
  async createKpiPeriod(storeId: string, data: Partial<KpiPeriod>) {
    const period = this.kpiPeriodRepository.create({ ...data, storeId });
    return this.kpiPeriodRepository.save(period);
  }

  async getKpiPeriods(storeId: string) {
    return this.kpiPeriodRepository.find({ where: { storeId, isActive: true } });
  }

  // Employee KPI Management
  async createEmployeeKpi(data: any) {
    const { tasks, ...kpiData } = data;
    // Alias kpiName → name (support both field names from frontend/test)
    if (!kpiData.name && kpiData.kpiName) {
      kpiData.name = kpiData.kpiName;
    }
    delete kpiData.kpiName;
    // Đảm bảo storeIds luôn là mảng nếu người dùng truyền lên 1 string
    if (kpiData.storeId && !kpiData.storeIds) {
      kpiData.storeIds = [kpiData.storeId];
    }
    
    const kpi = this.employeeKpiRepository.create(kpiData as Partial<EmployeeKpi>);
    const savedKpi = await this.employeeKpiRepository.save(kpi);

    if (tasks && Array.isArray(tasks)) {
      for (const taskData of tasks) {
        let completionRate = 0;
        if (taskData.target > 0 && taskData.actualValue !== undefined) {
          completionRate = (taskData.actualValue / taskData.target) * 100;
        }
        const task = this.kpiTaskRepository.create({
          ...taskData,
          employeeKpiId: savedKpi.id,
          completionRate
        });
        await this.kpiTaskRepository.save(task);
      }
    }

    const kpiWithRelations = await this.employeeKpiRepository.findOne({
      where: { id: savedKpi.id },
      relations: [
        'employeeProfile', 
        'employeeProfile.account',
        'employeeProfile.employeeType',
        'employeeProfile.storeRole',
        'tasks', 
        'tasks.kpiType', 
        'tasks.kpiUnit', 
        'tasks.kpiPeriod', 
        'tasks.store'
      ]
    });

    if (!kpiWithRelations) {
      throw new NotFoundException('Không tìm thấy bảng KPI vừa tạo');
    }

    return this.summarizeKpi(kpiWithRelations);
  }

  async getEmployeeKpis(
    filters: { employeeProfileId?: string; storeId?: string; month?: string; rating?: string } = {}
  ) {
    const { employeeProfileId, storeId, month, rating } = filters;
    const query = this.employeeKpiRepository.createQueryBuilder('kpi')
      .leftJoinAndSelect('kpi.employeeProfile', 'profile')
      .leftJoinAndSelect('profile.account', 'account')
      .leftJoinAndSelect('profile.employeeType', 'employeeType')
      .leftJoinAndSelect('profile.storeRole', 'storeRole')
      .leftJoinAndSelect('kpi.tasks', 'tasks')
      .leftJoinAndSelect('tasks.kpiType', 'kpiType')
      .leftJoinAndSelect('tasks.kpiUnit', 'kpiUnit')
      .leftJoinAndSelect('tasks.kpiPeriod', 'kpiPeriod')
      .leftJoinAndSelect('tasks.store', 'taskStore')
      .where('1=1');

    if (employeeProfileId) {
      query.andWhere('kpi.employee_profile_id = :employeeProfileId', { employeeProfileId });
    }

    if (storeId) {
      query.andWhere(':storeId = ANY(kpi.store_ids)', { storeId });
    }

    if (month) {
      query.andWhere("to_char(kpi.month, 'YYYY-MM') = :month", { month });
    }

    const kpis = await query.orderBy('kpi.created_at', 'DESC').getMany();

    // Lấy tất cả storeIds duy nhất từ tất cả các kpi để fetch 1 lần cho tối ưu
    const allStoreIds = [...new Set(kpis.flatMap(k => k.storeIds || []))];
    const stores = allStoreIds.length > 0 
      ? await this.storeRepository.find({ where: { id: In(allStoreIds) } })
      : [];

    // Tóm tắt dữ liệu và gắn thông tin stores
    const allSummarized = kpis.map(kpi => {
      const summary = this.summarizeKpi(kpi);
      // Gắn thêm mảng objects store đầy đủ
      const appliedStores = stores.filter(s => kpi.storeIds?.includes(s.id));
      return {
        ...summary,
        appliedStores
      };
    });

    // Thống kê số lượng theo Rating
    const ratingCount = {
      all: allSummarized.length,
      good: allSummarized.filter(k => k?.summary?.rating === 'Tốt').length,
      warning: allSummarized.filter(k => k?.summary?.rating === 'Cảnh Báo').length,
      low: allSummarized.filter(k => k?.summary?.rating === 'Thấp').length
    };

    let summarizedKpis = allSummarized;

    // Lọc theo rating (Tốt/Cảnh Báo/Thấp) nếu có
    if (rating) {
      summarizedKpis = allSummarized.filter(kpi => kpi?.summary?.rating === rating);
    }

    return {
      data: summarizedKpis,
      ratingCount
    };
  }
  async updateEmployeeKpiStatus(id: string, status: KpiStatus) {
    const kpi = await this.employeeKpiRepository.findOne({ where: { id } });
    if (!kpi) throw new NotFoundException('Không tìm thấy bảng KPI');
    
    kpi.status = status;
    const savedKpi = await this.employeeKpiRepository.save(kpi);
    return this.summarizeKpi(savedKpi);
  }

  async getEmployeeKpiById(id: string) {
    const kpi = await this.employeeKpiRepository.findOne({
      where: { id },
      relations: [
        'employeeProfile', 
        'employeeProfile.account',
        'employeeProfile.employeeType',
        'employeeProfile.storeRole',
        'tasks', 
        'tasks.kpiType', 
        'tasks.kpiUnit', 
        'tasks.kpiPeriod', 
        'tasks.store'
      ]
    });
    
    if (!kpi) return null;
    
    // Lấy thông tin stores đầy đủ
    const stores = kpi.storeIds?.length > 0 
      ? await this.storeRepository.find({ where: { id: In(kpi.storeIds) } })
      : [];
      
    const summarized = this.summarizeKpi(kpi);
    return {
      ...summarized,
      appliedStores: stores
    };
  }

  private summarizeKpi(kpi: EmployeeKpi) {
    if (!kpi) return null;
    
    const tasks = kpi.tasks || [];
    let totalTarget = 0;
    let totalActualValue = 0;
    let totalCompletionRate = 0;

    tasks.forEach(task => {
      totalTarget += Number(task.target) || 0;
      totalActualValue += Number(task.actualValue) || 0;
      totalCompletionRate += Number(task.completionRate) || 0;
    });

    const averageCompletionRate = tasks.length > 0 ? totalCompletionRate / tasks.length : 0;
    let rating = 'Thấp';
    if (averageCompletionRate >= 90) {
      rating = 'Tốt';
    } else if (averageCompletionRate >= 70) {
      rating = 'Cảnh Báo';
    }

    return {
      ...kpi,
      summary: {
        totalTarget,
        totalActualValue,
        averageCompletionRate,
        rating,
        taskCount: tasks.length
      }
    };
  }

  // KPI Task Management
  async createKpiTask(data: Partial<KpiTask>) {
    // Tự động tính tỷ lệ hoàn thành
    if (data.target && data.actualValue !== undefined) {
      data.completionRate = (data.actualValue / data.target) * 100;
    }
    const task = this.kpiTaskRepository.create(data);
    return this.kpiTaskRepository.save(task);
  }

  async updateKpiTaskProgress(id: string, actualValue: number) {
    const task = await this.kpiTaskRepository.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Không tìm thấy nhiệm vụ KPI');
    
    task.actualValue = actualValue;
    if (task.target > 0) {
      task.completionRate = (actualValue / task.target) * 100;
    }
    return this.kpiTaskRepository.save(task);
  }

  async getKpiTasks(filters: { employeeKpiId?: string; storeId?: string; isHidden?: boolean } = {}) {
    const where: any = {};
    if (filters.employeeKpiId) where.employeeKpiId = filters.employeeKpiId;
    if (filters.storeId) where.storeId = filters.storeId;
    if (filters.isHidden !== undefined) where.isHidden = filters.isHidden;
    
    return this.kpiTaskRepository.find({
      where,
      relations: ['kpiType', 'kpiUnit', 'kpiPeriod', 'store', 'employeeKpi'],
      order: { createdAt: 'DESC' },
    });
  }

  async deleteKpiTask(id: string) {
    const task = await this.kpiTaskRepository.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Không tìm thấy nhiệm vụ');
    await this.kpiTaskRepository.delete(id);
    return { message: 'Xóa nhiệm vụ thành công' };
  }

  async hideKpiTask(id: string) {
    const task = await this.kpiTaskRepository.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Không tìm thấy nhiệm vụ');
    task.isHidden = true;
    return this.kpiTaskRepository.save(task);
  }

  async duplicateEmployeeKpi(id: string) {
    const sourceKpi = await this.employeeKpiRepository.findOne({
      where: { id },
      relations: ['tasks'],
    });

    if (!sourceKpi) throw new NotFoundException('Không tìm thấy bảng KPI gốc');

    // 1. Tạo bản sao bảng KPI
    const duplicatedKpi = this.employeeKpiRepository.create({
      name: `${sourceKpi.name}`,
      employeeProfileId: sourceKpi.employeeProfileId,
      storeIds: sourceKpi.storeIds,
      month: sourceKpi.month,
      notes: sourceKpi.notes,
      status: KpiStatus.DRAFT, // Mặc định là DRAFT khi nhân bản để chờ duyệt nếu cần
    });

    const savedKpi = await this.employeeKpiRepository.save(duplicatedKpi);

    // 2. Nhân bản các nhiệm vụ (Reset tiến độ về 0)
    if (sourceKpi.tasks && sourceKpi.tasks.length > 0) {
      const duplicatedTasks = sourceKpi.tasks.map((task) => {
        const { id, createdAt, updatedAt, ...taskData } = task;
        return this.kpiTaskRepository.create({
          ...taskData,
          employeeKpiId: savedKpi.id,
          actualValue: 0,
          completionRate: 0,
        });
      });
      await this.kpiTaskRepository.save(duplicatedTasks);
    }

    return this.getEmployeeKpiById(savedKpi.id);
  }

  // --- KPI Approval Request Management ---

  async createKpiApprovalRequest(data: { employeeProfileId: string; employeeKpiId: string; note?: string }) {
    // Kiểm tra xem yêu cầu đã tồn tại chưa
    const existing = await this.kpiApprovalRequestRepository.findOne({
      where: { 
        employeeKpiId: data.employeeKpiId, 
        status: KpiRequestStatus.PENDING 
      }
    });
    if (existing) throw new BadRequestException('Yêu cầu này đang chờ duyệt');

    const request = this.kpiApprovalRequestRepository.create({
      ...data,
      status: KpiRequestStatus.PENDING
    });
    
    return this.kpiApprovalRequestRepository.save(request);
  }

  async getKpiApprovalRequests(storeId?: string, month?: string) {
    const query = this.kpiApprovalRequestRepository.createQueryBuilder('request')
      .leftJoinAndSelect('request.employeeProfile', 'req_profile')
      .leftJoinAndSelect('req_profile.account', 'req_account')
      .leftJoinAndSelect('request.employeeKpi', 'kpi')
      .leftJoinAndSelect('kpi.employeeProfile', 'profile')
      .leftJoinAndSelect('profile.account', 'account')
      .leftJoinAndSelect('profile.employeeType', 'employeeType')
      .leftJoinAndSelect('profile.storeRole', 'storeRole')
      .leftJoinAndSelect('kpi.tasks', 'tasks')
      .leftJoinAndSelect('tasks.kpiType', 'kpiType')
      .leftJoinAndSelect('tasks.kpiUnit', 'kpiUnit')
      .leftJoinAndSelect('tasks.kpiPeriod', 'kpiPeriod')
      .leftJoinAndSelect('tasks.store', 'taskStore')
      .orderBy('request.created_at', 'DESC');

    if (storeId) {
      query.andWhere(':storeId = ANY(kpi.store_ids)', { storeId });
    }

    if (month) {
      query.andWhere("to_char(kpi.month, 'YYYY-MM') = :month", { month });
    }

    const requests = await query.getMany();

    // Fetch full store objects for appliedStores
    const allStoreIds = [...new Set(requests.flatMap(r => r.employeeKpi?.storeIds || []))];
    const stores = allStoreIds.length > 0 
      ? await this.storeRepository.find({ where: { id: In(allStoreIds) } })
      : [];

    // Map store objects into the responses
    return requests.map(request => {
      if (request.employeeKpi) {
        (request.employeeKpi as any).appliedStores = stores.filter(s => 
          request.employeeKpi.storeIds?.includes(s.id)
        );
      }
      return request;
    });
  }

  async handleKpiApprovalRequest(id: string, reviewerId: string, data: { status: KpiRequestStatus; note?: string }) {
    const request = await this.kpiApprovalRequestRepository.findOne({
      where: { id },
      relations: ['employeeKpi']
    });

    if (!request) throw new NotFoundException('Không tìm thấy yêu cầu duyệt KPI');
    if (request.status !== KpiRequestStatus.PENDING) {
      throw new BadRequestException('Yêu cầu này đã được xử lý');
    }

    request.status = data.status;
    request.reviewerId = reviewerId;
    request.note = data.note ?? null;

    if (data.status === KpiRequestStatus.APPROVED) {
      // Nếu chấp thuận, kích hoạt bảng KPI
      await this.employeeKpiRepository.update(request.employeeKpiId, { 
        status: KpiStatus.ACTIVE 
      });
    } else if (data.status === KpiRequestStatus.REJECTED) {
      // Nếu từ chối, đưa về Nháp
      await this.employeeKpiRepository.update(request.employeeKpiId, { 
        status: KpiStatus.DRAFT 
      });
    }

    return this.kpiApprovalRequestRepository.save(request);
  }

  async deleteEmployeeKpi(id: string) {
    return this.employeeKpiRepository.softDelete(id);
  }

  async updateKpiReminders(id: string, reminders: string) {
    const kpi = await this.employeeKpiRepository.findOne({ where: { id } });
    if (!kpi) throw new NotFoundException('Không tìm thấy bảng KPI');
    
    kpi.reminders = reminders;
    return this.employeeKpiRepository.save(kpi);
  }

  async updateKpiCompliments(id: string, compliments: string) {
    const kpi = await this.employeeKpiRepository.findOne({ where: { id } });
    if (!kpi) throw new NotFoundException('Không tìm thấy bảng KPI');
    
    kpi.compliments = compliments;
    return this.employeeKpiRepository.save(kpi);
  }

  // Daily Employee Report management
  async createDailyReport(data: Partial<DailyEmployeeReport>) {
    const report = this.dailyReportRepository.create(data);
    return this.dailyReportRepository.save(report);
  }

  async createDailyReportForStore(storeId: string, date?: Date) {
    const reportDate = date || new Date();
    reportDate.setHours(0, 0, 0, 0); // Reset time to midnight
    
    // Check if report already exists for this date
    const existing = await this.dailyReportRepository.findOne({
      where: { storeId, reportDate },
    });
    
    if (existing) {
      return existing;
    }
    
    // Create new report
    const report = this.dailyReportRepository.create({
      storeId,
      reportDate,
      lateArrivals: [],
      earlyDepartures: [],
      forgotClockOut: [],
      unauthorizedLeaves: [],
      extraShifts: [],
      authorizedLeaves: [],
    });
    
    return this.dailyReportRepository.save(report);
  }

  /**
   * Lazy init fallback — đảm bảo daily report tồn tại cho store hôm nay.
   * Returns report entity. Idempotent, có error handling.
   * Dùng khi login (fallback cron) và khi ghi attendance events.
   */
  async ensureDailyReportForStore(storeId: string): Promise<DailyEmployeeReport | null> {
    try {
      return await this.createDailyReportForStore(storeId);
    } catch (error) {
      this.logger.warn(`[EnsureDailyReport] Failed for store ${storeId}: ${error?.message || error}`);
      return null;
    }
  }

  /**
   * Lazy init fallback cho owner — đảm bảo daily report tồn tại cho tất cả stores của owner.
   */
  async ensureDailyReportsForOwner(ownerAccountId: string): Promise<void> {
    try {
      const stores = await this.storeRepository.find({
        where: { ownerAccountId, status: StoreStatus.ACTIVE },
        select: ['id'],
      });
      for (const store of stores) {
        await this.ensureDailyReportForStore(store.id);
      }
    } catch (error) {
      this.logger.warn(`[EnsureDailyReport] Failed for owner ${ownerAccountId}: ${error?.message || error}`);
    }
  }

  /**
   * Ghi nhận sự kiện chấm công vào DailyEmployeeReport.
   * Tự tạo report nếu chưa có (lazy init). Tránh duplicate employeeId.
   */
  async appendToDailyReport(
    storeId: string,
    field: 'lateArrivals' | 'earlyDepartures' | 'forgotClockOut' | 'unauthorizedLeaves' | 'extraShifts' | 'authorizedLeaves',
    employeeId: string,
  ): Promise<void> {
    try {
      const report = await this.ensureDailyReportForStore(storeId);
      if (!report) return;

      // Tránh duplicate
      if (!report[field].includes(employeeId)) {
        report[field].push(employeeId);
        await this.dailyReportRepository.save(report);
        this.logger.debug(`[DailyReport] Appended ${employeeId} to ${field} for store ${storeId}`);
      }
    } catch (error) {
      this.logger.warn(`[DailyReport] append ${field} failed: ${error?.message || error}`);
    }
  }

  /**
   * Cron cuối ngày: phát hiện quên check-out + nghỉ không phép.
   * Scan tất cả shift assignments hôm nay cho tất cả stores active.
   */
  async detectEndOfDayAttendanceIssues(): Promise<{ forgotCount: number; unauthorizedCount: number }> {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // 'YYYY-MM-DD'

    let forgotCount = 0;
    let unauthorizedCount = 0;

    const stores = await this.storeRepository.find({
      where: { status: StoreStatus.ACTIVE },
      select: ['id'],
    });

    for (const store of stores) {
      // Tìm tất cả shift slots hôm nay của store
      const slots = await this.shiftSlotRepository.find({
        where: {
          cycle: { storeId: store.id },
          workDate: todayStr,
        },
        relations: ['cycle', 'workShift'],
      });

      const slotIds = slots.map(s => s.id);
      if (slotIds.length === 0) continue;

      // Tìm tất cả assignments cho các slots này
      const assignments = await this.shiftAssignmentRepository.find({
        where: {
          shiftSlotId: In(slotIds),
          status: In([ShiftAssignmentStatus.APPROVED, ShiftAssignmentStatus.CONFIRMED, ShiftAssignmentStatus.COMPLETED]),
        },
      });

      for (const assignment of assignments) {
        const slot = slots.find(s => s.id === assignment.shiftSlotId);
        if (!slot?.workShift?.endTime) continue;

        // Check xem ca đã kết thúc chưa
        const [endH, endM] = slot.workShift.endTime.split(':').map(Number);
        const shiftEnd = new Date();
        shiftEnd.setHours(endH, endM, 0, 0);

        if (new Date() < shiftEnd) continue; // Ca chưa kết thúc, bỏ qua

        // Case 1: Quên check-out — đã check-in nhưng chưa check-out sau khi ca kết thúc
        if (assignment.checkInTime && !assignment.checkOutTime) {
          await this.appendToDailyReport(store.id, 'forgotClockOut', assignment.employeeId);
          forgotCount++;
        }

        // Case 2: Nghỉ không phép — được approved nhưng không check-in sau khi ca kết thúc
        if (assignment.status === ShiftAssignmentStatus.APPROVED && !assignment.checkInTime) {
          await this.appendToDailyReport(store.id, 'unauthorizedLeaves', assignment.employeeId);
          unauthorizedCount++;
        }
      }
    }

    return { forgotCount, unauthorizedCount };
  }

  async getDailyReports(storeId: string) {
    const reports = await this.dailyReportRepository.find({
      where: { storeId },
      order: { reportDate: 'DESC' },
    });
    
    return Promise.all(reports.map(report => this.getFinancialDataForReport(report)));
  }

  async getDailyReportById(id: string) {
    const report = await this.dailyReportRepository.findOne({ where: { id } });
    if (!report) return null;
    return this.getFinancialDataForReport(report);
  }

  async getDailyReportByDate(storeId: string, date: string | Date) {
    // Chuyển về format YYYY-MM-DD để query chính xác trong Postgres DATE column
    const dateString = typeof date === 'string' ? date.split('T')[0] : date.toISOString().split('T')[0];
    
    const report = await this.dailyReportRepository
      .createQueryBuilder('report')
      .where('report.store_id = :storeId', { storeId })
      .andWhere('CAST(report.report_date AS DATE) = :dateString', { dateString })
      .getOne();

    if (!report) return null;

    return this.getFinancialDataForReport(report);
  }

  private async getFinancialDataForReport(report: DailyEmployeeReport) {
    // Đảm bảo reportDate là đối tượng Date
    const rDate = new Date(report.reportDate);
    const month = new Date(rDate.getFullYear(), rDate.getMonth(), 1);

    const store = await this.storeRepository.findOne({ where: { id: report.storeId } });
    if (!store) return report;

    // Lấy payroll của chính store này trong tháng này
    const currentPayroll = await this.payrollRepository.findOne({
      where: { storeId: report.storeId, month },
    });

    // Lấy tất cả store của owner này
    const allOwnerStores = await this.storeRepository.find({
      where: { ownerAccountId: store.ownerAccountId },
    });
    const storeIds = allOwnerStores.map((s) => s.id);

    // Lấy tất cả payroll của các store cùng owner trong tháng này
    const allPayrolls = await this.payrollRepository.find({
      where: { 
        storeId: In(storeIds),
        month 
      },
    });

    // Tính tổng
    const estimatedPaymentTotalStore = allPayrolls.reduce(
      (sum, p) => sum + Number(p.estimatedPayment || 0),
      0,
    );
    const salaryFundTotalStore = allPayrolls.reduce(
      (sum, p) => sum + Number(p.salaryFund || 0),
      0,
    );

    return {
      ...report,
      estimatedPayment: currentPayroll ? Number(currentPayroll.estimatedPayment) : 0,
      salaryFund: currentPayroll ? Number(currentPayroll.salaryFund) : 0,
      estimatedPaymentTotalStore,
      salaryFundTotalStore,
    };
  }

  async updateDailyReport(id: string, data: Partial<DailyEmployeeReport>) {
    await this.dailyReportRepository.update(id, data);
    return this.dailyReportRepository.findOne({ where: { id } });
  }

  async createDailyReportsForAllStores(date?: Date) {
    const stores = await this.storeRepository.find({
      where: { status: StoreStatus.ACTIVE },
    });
    
    const results: DailyEmployeeReport[] = [];
    for (const store of stores) {
      try {
        const report = await this.createDailyReportForStore(store.id, date);
        results.push(report);
      } catch (error) {
        console.error(`Failed to create daily report for store ${store.id}:`, error);
      }
    }
    
    return results;
  }

  async deleteDailyReport(id: string) {
    await this.dailyReportRepository.delete(id);
    return { message: 'Daily report deleted successfully' };
  }

  // Store Event management
  async createEvent(storeId: string, data: Partial<StoreEvent>) {
    const event = this.eventRepository.create({ ...data, storeId });
    return this.eventRepository.save(event);
  }

  async getEvents(storeId: string, timeRange?: string, type?: StoreEventType) {
    const where: any = { storeId };

    if (type) {
      where.type = type;
    }

    if (timeRange) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todayStr = today.toISOString().split('T')[0];

      if (timeRange === 'today') {
        where.eventDate = todayStr;
      } else if (timeRange === 'yesterday') {
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        where.eventDate = yesterday.toISOString().split('T')[0];
      } else if (timeRange === '1_week') {
        const lastWeek = new Date(today);
        lastWeek.setDate(today.getDate() - 7);
        where.eventDate = Between(lastWeek.toISOString().split('T')[0], todayStr);
      } else if (timeRange === '1_month') {
        const lastMonth = new Date(today);
        lastMonth.setMonth(today.getMonth() - 1);
        where.eventDate = Between(lastMonth.toISOString().split('T')[0], todayStr);
      }
    }

    return this.eventRepository.find({
      where,
      order: { eventDate: 'DESC', eventTime: 'DESC' },
    });
  }

  async getEventById(id: string) {
    return this.eventRepository.findOne({ where: { id } });
  }

  async updateEvent(id: string, data: Partial<StoreEvent>) {
    await this.eventRepository.update(id, data);
    return this.eventRepository.findOne({ where: { id } });
  }

  async deleteEvent(id: string) {
    await this.eventRepository.delete(id);
    return { message: 'Event deleted successfully' };
  }

  // Asset Category management
  async createAssetCategory(storeId: string, data: Partial<AssetCategory>) {
    const category = this.assetCategoryRepository.create({ ...data, storeId });
    return this.assetCategoryRepository.save(category);
  }

  async getAssetCategories(storeId: string) {
    return this.assetCategoryRepository.find({
      where: { storeId, isActive: true },
    });
  }

  // Asset Status management
  async createAssetStatus(storeId: string, data: Partial<AssetStatus>) {
    const status = this.assetStatusRepository.create({ ...data, storeId });
    return this.assetStatusRepository.save(status);
  }

  async getAssetStatuses(storeId: string) {
    return this.assetStatusRepository.find({
      where: { storeId, isActive: true },
    });
  }

  // Product Category management
  async createProductCategory(storeId: string, data: Partial<ProductCategory>) {
    const category = this.productCategoryRepository.create({
      ...data,
      storeId,
    });
    return this.productCategoryRepository.save(category);
  }

  async getProductCategories(storeId: string) {
    return this.productCategoryRepository.find({
      where: { storeId, isActive: true },
    });
  }

  // Product Status management
  async createProductStatus(storeId: string, data: Partial<ProductStatus>) {
    const status = this.productStatusRepository.create({ ...data, storeId });
    return this.productStatusRepository.save(status);
  }

  async getProductStatuses(storeId: string) {
    return this.productStatusRepository.find({
      where: { storeId, isActive: true },
    });
  }

  async createStockTransaction(
    storeId: string,
    data: any,
  ): Promise<StockTransaction> {
    const { details, ...transactionData } = data;

    // Generate code if not provided
    if (!transactionData.code) {
      const typeLabel =
        transactionData.type === StockTransactionType.IMPORT
          ? 'PN'
          : transactionData.type === StockTransactionType.EXPORT
            ? 'PX'
            : 'PK';
      transactionData.code = `${typeLabel}${Date.now()}`;
    }

    const transaction = new StockTransaction();
    Object.assign(transaction, transactionData);
    transaction.storeId = storeId;

    const savedTransaction =
      await this.stockTransactionRepository.save(transaction);

    let totalAmount = 0;
    const detailEntities: StockTransactionDetail[] = [];

    if (details && Array.isArray(details)) {
      for (const detail of details) {
        const unitPrice = Number(detail.unitPrice) || 0;
        const quantity = Number(detail.quantity) || 0;
        const totalPrice = quantity * unitPrice;
        totalAmount += totalPrice;

        const detailEntity = new StockTransactionDetail();
        Object.assign(detailEntity, detail);
        detailEntity.transactionId = savedTransaction.id;
        detailEntity.totalPrice = totalPrice;

        detailEntities.push(detailEntity);

        // Update current stock
        if (detail.productId) {
          const product = await this.productRepository.findOne({
            where: { id: detail.productId },
          });
          if (product) {
            if (transactionData.type === StockTransactionType.IMPORT) {
              product.currentStock =
                (Number(product.currentStock) || 0) + quantity;
            } else if (transactionData.type === StockTransactionType.EXPORT) {
              product.currentStock =
                (Number(product.currentStock) || 0) - quantity;
            } else if (transactionData.type === StockTransactionType.ADJUST) {
              product.currentStock = quantity;
            }
            await this.productRepository.save(product);
          }
        } else if (detail.assetId) {
          const asset = await this.assetRepository.findOne({
            where: { id: detail.assetId },
          });
          if (asset) {
            if (transactionData.type === StockTransactionType.IMPORT) {
              asset.currentStock = (Number(asset.currentStock) || 0) + quantity;
            } else if (transactionData.type === StockTransactionType.EXPORT) {
              asset.currentStock = (Number(asset.currentStock) || 0) - quantity;
            } else if (transactionData.type === StockTransactionType.ADJUST) {
              asset.currentStock = quantity;
            }
            await this.assetRepository.save(asset);
          }
        }
      }
    }

    if (detailEntities.length > 0) {
      await this.stockTransactionDetailRepository.save(detailEntities);
    }

    // Update total amount of transaction
    savedTransaction.totalAmount = totalAmount;
    return this.stockTransactionRepository.save(savedTransaction);
  }

  async getStockTransactions(storeId: string) {
    return this.stockTransactionRepository.find({
      where: { storeId },
      relations: ['employee'],
      order: { transactionDate: 'DESC' },
    });
  }

  async getStockTransactionById(transactionId: string) {
    return this.stockTransactionRepository.findOne({
      where: { id: transactionId },
      relations: ['employee', 'details', 'details.product', 'details.asset'],
    });
  }

  // --- Inventory Reporting (Broken Assets / Low Stock) ---

  async createInventoryReports(reports: any[], files: Express.Multer.File[]) {
    const reportEntities = reports.map((reportData, index) => {
      // Xử lý các trường UUID rỗng thành null để tránh lỗi Postgres
      if (reportData.assetId === '') reportData.assetId = null;
      if (reportData.productId === '') reportData.productId = null;
      if (reportData.targetAssetStatusId === '') reportData.targetAssetStatusId = null;

      const report = this.inventoryReportRepository.create(reportData as Partial<InventoryReport>);
      
      // Ánh xạ ảnh từ mảng files vào báo cáo tương ứng
      // Quy chuẩn: file gửi lên có fieldname là 'file_idx_subidx' ví dụ 'file_0_1'
      const reportImages = files
        .filter(file => file.fieldname.startsWith(`file_${index}_`))
        .map(file => file.path); // Hoặc logic lưu path phù hợp với project

      if (reportImages.length > 0) {
        report.images = reportImages;
      }
      
      return report;
    });
    
    return this.inventoryReportRepository.save(reportEntities);
  }

  async getInventoryReports(filters: { storeId?: string; status?: InventoryReportStatus; type?: string }) {
    const query = this.inventoryReportRepository.createQueryBuilder('report')
      .leftJoinAndSelect('report.reporter', 'reporter')
      .leftJoinAndSelect('reporter.account', 'account')
      .leftJoinAndSelect('report.asset', 'asset')
      .leftJoinAndSelect('report.product', 'product')
      .orderBy('report.created_at', 'DESC');

    if (filters.storeId) {
      query.andWhere('report.store_id = :storeId', { storeId: filters.storeId });
    }

    if (filters.status) {
      query.andWhere('report.status = :status', { status: filters.status });
    }

    if (filters.type) {
      query.andWhere('report.type = :type', { type: filters.type });
    }

    return query.getMany();
  }

  async handleInventoryReport(id: string, updates: { status: InventoryReportStatus; adminNote?: string }) {
    const report = await this.inventoryReportRepository.findOne({ where: { id } });
    if (!report) throw new NotFoundException('Không tìm thấy báo cáo sự cố');
    
    Object.assign(report, updates);
    return this.inventoryReportRepository.save(report);
  }

  // Service Category Management
  async createServiceCategory(storeId: string, data: any) {
    const category = this.serviceCategoryRepository.create({
      ...data,
      storeId,
    });
    return this.serviceCategoryRepository.save(category);
  }

  async getServiceCategories(storeId: string, type?: string) {
    const where: any = { storeId, isActive: true };
    if (type) where.type = type;
    return this.serviceCategoryRepository.find({ where });
  }

  async getServiceCategoryById(id: string) {
    return this.serviceCategoryRepository.findOne({
      where: { id },
      relations: ['items'],
    });
  }

  async updateServiceCategory(id: string, data: any) {
    await this.serviceCategoryRepository.update(id, data);
    return this.getServiceCategoryById(id);
  }

  async deleteServiceCategory(id: string) {
    await this.serviceCategoryRepository.update(id, { isActive: false });
    return { message: 'Service category deleted successfully' };
  }

  // Service Item Management
  async createServiceItem(storeId: string, data: any) {
    const item = this.serviceItemRepository.create({ ...data, storeId });
    return this.serviceItemRepository.save(item);
  }

  async createFnbServiceItem(storeId: string, data: CreateFnbServiceItemDto) {
    const { categoryId, recipes, ...itemData } = data;

    // 1. Validate category
    const category = await this.serviceCategoryRepository.findOne({
      where: { id: categoryId, storeId, type: ServiceType.FNB },
    });

    if (!category) {
      throw new NotFoundException('Danh mục không tồn tại hoặc không phải loại F&B');
    }

    // 2. Create the ServiceItem
    const serviceItem = this.serviceItemRepository.create({
      ...itemData,
      storeId,
      categoryId: category.id,
    });
    const savedItem = await this.serviceItemRepository.save(serviceItem);

    // 3. Create recipes if provided
    if (recipes && recipes.length > 0) {
      const recipeEntities = recipes.map((r) =>
        this.serviceItemRecipeRepository.create({
          ...r,
          serviceItemId: savedItem.id,
        }),
      );
      await this.serviceItemRecipeRepository.save(recipeEntities);
    }

    return this.getServiceItemById(savedItem.id);
  }

  async getFnbItems(storeId: string, categoryId?: string) {
    // 1. Base query for FNB items
    const queryBuilder = this.serviceItemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.category', 'category')
      .leftJoinAndSelect('item.recipes', 'recipes')
      .leftJoinAndSelect('recipes.product', 'product')
      .where('item.storeId = :storeId', { storeId })
      .andWhere('category.type = :type', { type: ServiceType.FNB })
      .andWhere('item.isActive = :isActive', { isActive: true });

    // 2. Filter by category if provided
    if (categoryId) {
      queryBuilder.andWhere('item.categoryId = :categoryId', { categoryId });
    }
    
    // Order by created date DESC
    queryBuilder.orderBy('item.createdAt', 'DESC');

    const items = await queryBuilder.getMany();

    // 3. Calculate category counts (Summary)
    // We need a separate query to get counts for ALL categories, 
    // regardless of the current category filter, to support the UI filters.
    const categoryCounts = await this.serviceItemRepository
      .createQueryBuilder('item')
      .select('category.id', 'id')
      .addSelect('category.name', 'name')
      .addSelect('COUNT(item.id)', 'count')
      .leftJoin('item.category', 'category')
      .where('item.storeId = :storeId', { storeId })
      .andWhere('category.type = :type', { type: ServiceType.FNB })
      .andWhere('item.isActive = :isActive', { isActive: true })
      .groupBy('category.id')
      .addGroupBy('category.name')
      .getRawMany();

    // Calculate 'All' count
    const totalCount = categoryCounts.reduce((sum, cat) => sum + Number(cat.count), 0);
    
    // Format summary
    const summary = [
      { id: 'all', name: 'Tất cả', count: totalCount },
      ...categoryCounts.map(c => ({
        id: c.id,
        name: c.name,
        count: Number(c.count)
      }))
    ];

    return {
      summary,
      items
    };
  }

  async createYieldServiceItem(storeId: string, data: CreateYieldServiceItemDto) {
    const { categoryId, ...itemData } = data;

    let targetCategoryId = categoryId;

    if (categoryId) {
      // Validate provided category
      const category = await this.serviceCategoryRepository.findOne({
        where: { id: categoryId, storeId, type: ServiceType.YIELD_DELIVERY },
      });

      if (!category) {
        throw new NotFoundException('Danh mục không tồn tại hoặc không phải loại YIELD_DELIVERY');
      }
    } else {
      // Find or create default "Chung" category for Yield
      let defaultCategory = await this.serviceCategoryRepository.findOne({
        where: { storeId, name: 'Chung', type: ServiceType.YIELD_DELIVERY },
      });

      if (!defaultCategory) {
        defaultCategory = this.serviceCategoryRepository.create({
          storeId,
          name: 'Chung',
          type: ServiceType.YIELD_DELIVERY,
        });
        defaultCategory = await this.serviceCategoryRepository.save(defaultCategory);
      }
      targetCategoryId = defaultCategory.id;
    }

    // 2. Create the ServiceItem
    const serviceItem = this.serviceItemRepository.create({
      ...itemData,
      size: itemData.unit, // Map unit -> size
      storeId,
      categoryId: targetCategoryId,
    });
    const savedItem = await this.serviceItemRepository.save(serviceItem);

    return this.getServiceItemById(savedItem.id);
  }

  async getYieldItems(storeId: string, categoryId?: string) {
    // 1. Base query for YIELD items
    const queryBuilder = this.serviceItemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.category', 'category')
      .where('item.storeId = :storeId', { storeId })
      .andWhere('category.type = :type', { type: ServiceType.YIELD_DELIVERY })
      .andWhere('item.isActive = :isActive', { isActive: true });

    // 2. Filter by category if provided
    if (categoryId) {
      queryBuilder.andWhere('item.categoryId = :categoryId', { categoryId });
    }
    
    // Order by created date DESC
    queryBuilder.orderBy('item.createdAt', 'DESC');

    const items = await queryBuilder.getMany();

    // 3. Calculate category counts (Summary)
    const categoryCounts = await this.serviceItemRepository
      .createQueryBuilder('item')
      .select('category.id', 'id')
      .addSelect('category.name', 'name')
      .addSelect('COUNT(item.id)', 'count')
      .leftJoin('item.category', 'category')
      .where('item.storeId = :storeId', { storeId })
      .andWhere('category.type = :type', { type: ServiceType.YIELD_DELIVERY })
      .andWhere('item.isActive = :isActive', { isActive: true })
      .groupBy('category.id')
      .addGroupBy('category.name')
      .getRawMany();

    // Calculate 'All' count
    const totalCount = categoryCounts.reduce((sum, cat) => sum + Number(cat.count), 0);
    
    // Format summary
    const summary = [
      { id: 'all', name: 'Tất cả', count: totalCount },
      ...categoryCounts.map(c => ({
        id: c.id,
        name: c.name,
        count: Number(c.count)
      }))
    ];

    return {
      summary,
      items
    };
  }

  async createPersonalCareItem(storeId: string, data: CreatePersonalCareItemDto) {
    const { categoryId, ...itemData } = data;

    let targetCategoryId = categoryId;

    if (categoryId) {
      // Validate provided category
      const category = await this.serviceCategoryRepository.findOne({
        where: { id: categoryId, storeId, type: ServiceType.PERSONAL_CARE },
      });

      if (!category) {
        throw new NotFoundException('Danh mục không tồn tại hoặc không phải loại PERSONAL_CARE');
      }
    } else {
      // Find or create default "Dịch vụ" category
      let defaultCategory = await this.serviceCategoryRepository.findOne({
        where: { storeId, name: 'Dịch vụ', type: ServiceType.PERSONAL_CARE },
      });

      if (!defaultCategory) {
        defaultCategory = this.serviceCategoryRepository.create({
          storeId,
          name: 'Dịch vụ',
          type: ServiceType.PERSONAL_CARE,
        });
        defaultCategory = await this.serviceCategoryRepository.save(defaultCategory);
      }
      targetCategoryId = defaultCategory.id;
    }

    // 2. Create the ServiceItem
    const serviceItem = this.serviceItemRepository.create({
      ...itemData,
      storeId,
      categoryId: targetCategoryId,
    });
    const savedItem = await this.serviceItemRepository.save(serviceItem);

    return this.getServiceItemById(savedItem.id);
  }

  async getPersonalCareItems(storeId: string, categoryId?: string) {
    // 1. Base query for PERSONAL_CARE items
    const queryBuilder = this.serviceItemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.category', 'category')
      .where('item.storeId = :storeId', { storeId })
      .andWhere('category.type = :type', { type: ServiceType.PERSONAL_CARE })
      .andWhere('item.isActive = :isActive', { isActive: true });

    // 2. Filter by category if provided
    if (categoryId) {
      queryBuilder.andWhere('item.categoryId = :categoryId', { categoryId });
    }
    
    // Order by created date DESC
    queryBuilder.orderBy('item.createdAt', 'DESC');

    const items = await queryBuilder.getMany();

    // 3. Calculate category counts (Summary)
    const categoryCounts = await this.serviceItemRepository
      .createQueryBuilder('item')
      .select('category.id', 'id')
      .addSelect('category.name', 'name')
      .addSelect('COUNT(item.id)', 'count')
      .leftJoin('item.category', 'category')
      .where('item.storeId = :storeId', { storeId })
      .andWhere('category.type = :type', { type: ServiceType.PERSONAL_CARE })
      .andWhere('item.isActive = :isActive', { isActive: true })
      .groupBy('category.id')
      .addGroupBy('category.name')
      .getRawMany();

    // Calculate 'All' count
    const totalCount = categoryCounts.reduce((sum, cat) => sum + Number(cat.count), 0);
    
    // Format summary
    const summary = [
      { id: 'all', name: 'Tất cả', count: totalCount },
      ...categoryCounts.map(c => ({
        id: c.id,
        name: c.name,
        count: Number(c.count)
      }))
    ];

    return {
      summary,
      items
    };
  }

  async createPetCareItem(storeId: string, data: CreatePetCareItemDto) {
    const { categoryId, ...itemData } = data;

    let targetCategoryId = categoryId;

    if (categoryId) {
      // Validate provided category
      const category = await this.serviceCategoryRepository.findOne({
        where: { id: categoryId, storeId, type: ServiceType.PET_CARE },
      });

      if (!category) {
        throw new NotFoundException('Danh mục không tồn tại hoặc không phải loại PET_CARE');
      }
    } else {
      // Find or create default "Dịch vụ" category for Pet Care
      let defaultCategory = await this.serviceCategoryRepository.findOne({
        where: { storeId, name: 'Dịch vụ', type: ServiceType.PET_CARE },
      });

      if (!defaultCategory) {
        defaultCategory = this.serviceCategoryRepository.create({
          storeId,
          name: 'Dịch vụ',
          type: ServiceType.PET_CARE,
        });
        defaultCategory = await this.serviceCategoryRepository.save(defaultCategory);
      }
      targetCategoryId = defaultCategory.id;
    }

    // 2. Create the ServiceItem
    const serviceItem = this.serviceItemRepository.create({
      ...itemData,
      storeId,
      categoryId: targetCategoryId,
    });
    const savedItem = await this.serviceItemRepository.save(serviceItem);

    return this.getServiceItemById(savedItem.id);
  }

  async getPetCareItems(storeId: string, categoryId?: string) {
    // 1. Base query for PET_CARE items
    const queryBuilder = this.serviceItemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.category', 'category')
      .where('item.storeId = :storeId', { storeId })
      .andWhere('category.type = :type', { type: ServiceType.PET_CARE })
      .andWhere('item.isActive = :isActive', { isActive: true });

    // 2. Filter by category if provided
    if (categoryId) {
      queryBuilder.andWhere('item.categoryId = :categoryId', { categoryId });
    }
    
    // Order by created date DESC
    queryBuilder.orderBy('item.createdAt', 'DESC');

    const items = await queryBuilder.getMany();

    // 3. Calculate category counts (Summary)
    const categoryCounts = await this.serviceItemRepository
      .createQueryBuilder('item')
      .select('category.id', 'id')
      .addSelect('category.name', 'name')
      .addSelect('COUNT(item.id)', 'count')
      .leftJoin('item.category', 'category')
      .where('item.storeId = :storeId', { storeId })
      .andWhere('category.type = :type', { type: ServiceType.PET_CARE })
      .andWhere('item.isActive = :isActive', { isActive: true })
      .groupBy('category.id')
      .addGroupBy('category.name')
      .getRawMany();

    // Calculate 'All' count
    const totalCount = categoryCounts.reduce((sum, cat) => sum + Number(cat.count), 0);
    
    // Format summary
    const summary = [
      { id: 'all', name: 'Tất cả', count: totalCount },
      ...categoryCounts.map(c => ({
        id: c.id,
        name: c.name,
        count: Number(c.count)
      }))
    ];

    return {
      summary,
      items
    };
  }

  async getServiceItems(storeId: string, categoryId?: string) {
    const where: any = { storeId, isActive: true };
    if (categoryId) where.categoryId = categoryId;
    return this.serviceItemRepository.find({
      where,
      relations: ['category', 'recipes', 'recipes.product'],
    });
  }

  async getServiceItemById(id: string) {
    return this.serviceItemRepository.findOne({
      where: { id },
      relations: [
        'category',
        'recipes',
        'recipes.product',
        'recipes.product.productUnit',
      ],
    });
  }

  async updateServiceItem(id: string, data: any) {
    await this.serviceItemRepository.update(id, data);
    return this.getServiceItemById(id);
  }

  async deleteServiceItem(id: string) {
    await this.serviceItemRepository.update(id, { isActive: false });
    return { message: 'Service item deleted successfully' };
  }

  // Service Item Recipe Management
  async createServiceItemRecipe(serviceItemId: string, data: any) {
    const recipe = this.serviceItemRecipeRepository.create({
      ...data,
      serviceItemId,
    });
    return this.serviceItemRecipeRepository.save(recipe);
  }

  async getServiceItemRecipes(serviceItemId: string) {
    return this.serviceItemRecipeRepository.find({
      where: { serviceItemId },
      relations: ['product', 'product.productUnit'],
    });
  }

  async updateServiceItemRecipe(id: string, data: any) {
    await this.serviceItemRecipeRepository.update(id, data);
    return this.serviceItemRecipeRepository.findOne({
      where: { id },
      relations: ['product', 'product.productUnit'],
    });
  }

  async deleteServiceItemRecipe(id: string) {
    await this.serviceItemRecipeRepository.delete(id);
    return { message: 'Recipe deleted successfully' };
  }

  // Bulk create recipes for a service item
  async bulkCreateRecipes(serviceItemId: string, recipes: any[]) {
    const recipeEntities = recipes.map((recipe) =>
      this.serviceItemRecipeRepository.create({ ...recipe, serviceItemId }),
    );
    return this.serviceItemRecipeRepository.save(recipeEntities as any);
  }

  // --- Order Management ---

  private generateOrderCode(type: string): string {
    const prefix = type.substring(0, 3).toUpperCase();
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    return `${prefix}-${timestamp}${random}`;
  }

  async createOrder(storeId: string, employeeId: string | undefined, data: any) {
    const {
      type,
      customerName,
      customerPhone,
      items,
      discountPercent = 0,
      taxPercent = 0,
      paymentMethod,
      orderDetails,
      note,
    } = data;

    // 1. Calculate values
    let subtotal = 0;
    let totalOrderCost = 0;
    const orderItemsData: any[] = [];

    for (const item of items) {
      const serviceItem = await this.serviceItemRepository.findOne({
        where: { id: item.serviceItemId },
        relations: ['recipes', 'recipes.product'],
      });

      if (!serviceItem)
        throw new NotFoundException(
          `ServiceItem ${item.serviceItemId} not found`,
        );

      // Calculate unit cost from recipes
      let itemUnitCost = 0;
      if (serviceItem.recipes) {
        for (const recipe of serviceItem.recipes) {
          const productCost = recipe.product?.costPrice || 0;
          itemUnitCost += Number(productCost) * Number(recipe.quantity);
        }
      }

      const totalPrice = serviceItem.price * item.quantity;
      const totalItemCost = itemUnitCost * item.quantity;

      subtotal += totalPrice;
      totalOrderCost += totalItemCost;

      orderItemsData.push({
        serviceItemId: serviceItem.id,
        quantity: item.quantity,
        unitPrice: serviceItem.price,
        totalPrice: totalPrice,
        unitCost: itemUnitCost,
        totalCost: totalItemCost,
        note: item.note,
        itemSnapshot: {
          name: serviceItem.name,
          size: serviceItem.size,
          price: serviceItem.price,
          duration: serviceItem.duration,
          metadata: serviceItem.metadata,
        },
        recipes: serviceItem.recipes,
      });
    }

    const discountAmount = subtotal * (discountPercent / 100);
    const taxAmount = (subtotal - discountAmount) * (taxPercent / 100);
    const totalAmount = subtotal - discountAmount + taxAmount;

    // 2. Create Order
    const order = new Order();
    order.storeId = storeId;
    order.employeeId = employeeId;
    order.code = this.generateOrderCode(type);
    order.type = type;
    order.customerName = customerName;
    order.customerPhone = customerPhone;
    order.city = data.city;
    order.ward = data.ward;
    order.addressLine = data.addressLine;
    order.deliveryDate = data.appointmentDate; // Mapping appointment -> delivery
    order.deliveryTime = data.appointmentTime;

    order.subtotal = subtotal;
    order.discountPercent = discountPercent;
    order.discountAmount = discountAmount;
    order.taxPercent = taxPercent;
    order.taxAmount = taxAmount;
    order.totalAmount = totalAmount;
    order.totalCost = totalOrderCost;
    order.paymentMethod = paymentMethod;
    
    // Default status when creating from POS
    order.status = OrderStatus.PREPARING; // Mặc định: Chuẩn bị
    order.paymentStatus = OrderPaymentStatus.UNPAID; // Mặc định: Chưa thanh toán
    order.paidAmount = 0;

    order.orderDetails = orderDetails;
    order.note = note;

    const savedOrder = (await this.orderRepository.save(order)) as any;

    // 3. Save Order Items and Deduct Stock
    // Handle Stock Transaction (One per order if there are recipes)
    let stockTransaction: StockTransaction | null = null;

    for (const itemData of orderItemsData) {
      const { recipes, ...itemSaveData } = itemData;

      const orderItem = this.orderItemRepository.create({
        ...itemSaveData,
        orderId: savedOrder.id,
      });
      await this.orderItemRepository.save(orderItem);

      // --- STOCK DEDUCTION LOGIC ---
      if (recipes && recipes.length > 0) {
        // Create the transaction once per order
        if (!stockTransaction) {
          stockTransaction = new StockTransaction();
          stockTransaction.storeId = storeId;
          stockTransaction.type = StockTransactionType.EXPORT;
          stockTransaction.code = `EXPORT-ORDER-${savedOrder.code}`;
          stockTransaction.employeeId = employeeId;
          stockTransaction.transactionDate = new Date();
          stockTransaction.status = StockTransactionStatus.COMPLETED;
          stockTransaction.note = `Xuất kho nguyên liệu cho đơn hàng ${savedOrder.code}`;
          stockTransaction = await this.stockTransactionRepository.save(stockTransaction);
        }

        for (const recipe of recipes) {
          const deductionQty = recipe.quantity * itemData.quantity;

          // Update product stock
          const product = recipe.product;
          if (product) {
            product.currentStock = Number(product.currentStock) - deductionQty;
            await (this.productRepository as any).save(product);

            // Create transaction detail
            const detail = new StockTransactionDetail();
            detail.transactionId = stockTransaction.id;
            detail.productId = product.id;
            detail.quantity = deductionQty;
            detail.unitPrice = 0; 
            detail.totalPrice = 0;
            await this.stockTransactionDetailRepository.save(detail);
          }
        }
      }
    }

    return this.getOrderById(savedOrder.id);
  }

  async getOrders(storeId: string, filters: any = {}) {
    const { type, status, startDate, endDate, search } = filters;
    const query = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.employee', 'employee')
      .where('order.store_id = :storeId', { storeId });

    if (type) query.andWhere('order.type = :type', { type });
    if (status) query.andWhere('order.status = :status', { status });
    if (startDate && endDate) {
      const adjustedEnd = new Date(endDate);
      adjustedEnd.setHours(23, 59, 59, 999);
      query.andWhere('order.created_at BETWEEN :startDate AND :endDate', {
        startDate,
        endDate: adjustedEnd,
      });
    }
    if (search) {
      query.andWhere(
        '(order.code ILIKE :search OR order.customer_name ILIKE :search OR order.customer_phone ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    query.orderBy('order.created_at', 'DESC');
    return query.getMany();
  }

  async getOrderById(orderId: string) {
    return this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['items', 'employee'],
    });
  }

  async updateOrderStatus(orderId: string, status: OrderStatus) {
    await this.orderRepository.update(orderId, { status });
    return this.getOrderById(orderId);
  }

  // --- Revenue Reporting ---
  async getRevenueReport(storeId: string, startDate: Date, endDate: Date) {
    // Ensure endDate includes the full day
    const adjustedEndDate = new Date(endDate);
    adjustedEndDate.setHours(23, 59, 59, 999);

    // 1. Overall Summary (All orders in period)
    const summary = await this.orderRepository
      .createQueryBuilder('o')
      .select(
        'SUM(CASE WHEN o.status = :completed THEN o."totalAmount" ELSE 0 END)',
        'totalRevenue',
      )
      .addSelect(
        'SUM(CASE WHEN o.status = :completed THEN o."totalCost" ELSE 0 END)',
        'totalCost',
      )
      .addSelect(
        'SUM(CASE WHEN o.status = :completed THEN o."discountAmount" ELSE 0 END)',
        'totalDiscount',
      )
      .addSelect(
        'SUM(CASE WHEN o.status = :completed THEN o."taxAmount" ELSE 0 END)',
        'totalTax',
      )
      .addSelect('COUNT(o.id)', 'totalOrders')
      .addSelect(
        'COUNT(CASE WHEN o.status = :completed THEN 1 END)',
        'successOrders',
      )
      .addSelect(
        'COUNT(CASE WHEN o.status = :cancelled THEN 1 END)',
        'failedOrders',
      )
      .where('o.store_id = :storeId', {
        storeId,
        completed: OrderStatus.COMPLETED,
        cancelled: OrderStatus.CANCELLED,
      })
      .andWhere('o.created_at BETWEEN :startDate AND :endDate', {
        startDate,
        endDate: adjustedEndDate,
      })
      .getRawOne();

    // 2. Daily Detailed Breakdown
    const dailyReport = await this.orderRepository
      .createQueryBuilder('o')
      .select("DATE_TRUNC('day', o.created_at)", 'date')
      .addSelect(
        'SUM(CASE WHEN o.status = :completed THEN o."totalAmount" ELSE 0 END)',
        'revenue',
      )
      .addSelect(
        'SUM(CASE WHEN o.status = :completed THEN o."totalCost" ELSE 0 END)',
        'cost',
      )
      .addSelect(
        'SUM(CASE WHEN o.status = :completed THEN o."discountAmount" ELSE 0 END)',
        'discount',
      )
      .addSelect(
        'SUM(CASE WHEN o.status = :completed THEN o."taxAmount" ELSE 0 END)',
        'tax',
      )
      .addSelect('COUNT(o.id)', 'totalOrders')
      .addSelect(
        'COUNT(CASE WHEN o.status = :completed THEN 1 END)',
        'successOrders',
      )
      .addSelect(
        'COUNT(CASE WHEN o.status = :cancelled THEN 1 END)',
        'failedOrders',
      )
      .where('o.store_id = :storeId', {
        storeId,
        completed: OrderStatus.COMPLETED,
        cancelled: OrderStatus.CANCELLED,
      })
      .andWhere('o.created_at BETWEEN :startDate AND :endDate', {
        startDate,
        endDate: adjustedEndDate,
      })
      .groupBy("DATE_TRUNC('day', o.created_at)")
      .orderBy('date', 'ASC')
      .getRawMany();

    // 3. Revenue by Service Type
    const byType = await this.orderRepository
      .createQueryBuilder('o')
      .select('o.type', 'type')
      .addSelect('SUM(o."totalAmount")', 'revenue')
      .addSelect('COUNT(o.id)', 'count')
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.status = :status', { status: OrderStatus.COMPLETED })
      .andWhere('o.created_at BETWEEN :startDate AND :endDate', {
        startDate,
        endDate: adjustedEndDate,
      })
      .groupBy('o.type')
      .getRawMany();

    // 4. Top Selling Items
    let topItems: any[] = [];
    try {
      topItems = await this.orderItemRepository
        .createQueryBuilder('item')
        .innerJoin('item.order', 'o')
        .select("item.\"itemSnapshot\"->>'name'", 'name')
        .addSelect('SUM(item.quantity)', 'totalQuantity')
        .addSelect('SUM(item."totalPrice")', 'totalRevenue')
        .where('o.store_id = :storeId', { storeId })
        .andWhere('o.status = :status', { status: OrderStatus.COMPLETED })
        .andWhere('o.created_at BETWEEN :startDate AND :endDate', {
          startDate,
          endDate: adjustedEndDate,
        })
        .groupBy("item.\"itemSnapshot\"->>'name'")
        .orderBy('"totalQuantity"', 'DESC')
        .limit(10)
        .getRawMany();
    } catch (e) {
      // If no order items exist yet, this query may fail
      topItems = [];
    }

    const totalRev = parseFloat(summary?.totalRevenue || 0);
    const totalCost = parseFloat(summary?.totalCost || 0);
    const totalTax = parseFloat(summary?.totalTax || 0);
    const totalProfit = totalRev - totalCost - totalTax;

    // A.I Insight Heuristic
    let insight = '';
    if (totalProfit < 0) {
      insight = `Cảnh báo: Lợi nhuận đang âm (${totalProfit.toLocaleString('vi-VN')} VNĐ). Cần kiểm tra lại chi phí vận hành.`;
    } else if (totalCost > totalRev * 0.7) {
      insight = `Cảnh báo: Chi phí chiếm hơn 70% doanh thu. Nguyên vật liệu là khoản chi lớn nhất cần theo dõi.`;
    } else if (totalRev > 0) {
      insight = `Tín hiệu tốt: Cửa hàng đang giữ mức lợi nhuận ổn định. Các khoản chi phí nằm trong vùng an toàn.`;
    } else {
      insight = `Chưa có giao dịch nào được ghi nhận trong kỳ báo cáo này.`;
    }

    const dailyMapped = (dailyReport || []).map((d) => {
      const dRev = parseFloat(d.revenue);
      const dCost = parseFloat(d.cost);
      const dTax = parseFloat(d.tax);
      return {
        date: d.date,
        revenue: dRev,
        cost: dCost,
        profit: dRev - dCost - dTax,
        discount: parseFloat(d.discount),
        tax: dTax,
        totalOrders: parseInt(d.totalOrders),
        successOrders: parseInt(d.successOrders),
        failedOrders: parseInt(d.failedOrders),
      };
    });

    // Mock Expense Breakdown for Personnel per shift (UI requirement)
    // Phân bổ ngẫu nhiên dựa trên Cost để UI có dữ liệu vẽ biểu đồ Chi phí nhân sự theo ca
    const expenseBreakdown = {
      labels: dailyMapped.map(d => new Date(d.date).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })),
      data: [
        { label: 'Ca sáng', values: dailyMapped.map(d => d.cost > 0 ? parseFloat((d.cost * 0.3).toFixed(2)) : 0) },
        { label: 'Ca trưa', values: dailyMapped.map(d => d.cost > 0 ? parseFloat((d.cost * 0.4).toFixed(2)) : 0) },
        { label: 'Ca tối', values: dailyMapped.map(d => d.cost > 0 ? parseFloat((d.cost * 0.3).toFixed(2)) : 0) }
      ],
      colors: ['#FEB273', '#F97066', '#9FA2F9']
    };

    return {
      summary: {
        totalRevenue: totalRev,
        totalCost: totalCost,
        totalProfit: totalProfit,
        totalDiscount: parseFloat(summary?.totalDiscount || 0),
        totalTax: totalTax,
        totalOrders: parseInt(summary?.totalOrders || '0'),
        successOrders: parseInt(summary?.successOrders || '0'),
        failedOrders: parseInt(summary?.failedOrders || '0'),
      },
      insight,
      expenseBreakdown,
      daily: dailyMapped,
      byType: (byType || []).map((t) => ({
        type: t.type,
        revenue: parseFloat(t.revenue),
        count: parseInt(t.count),
      })),
      topItems: (topItems || []).map((i) => ({
        name: i.name,
        quantity: parseInt(i.totalQuantity),
        revenue: parseFloat(i.totalRevenue),
      })),
    };
  }

  // --- Top Employees Report ---
  async getTopEmployeesReport(storeId: string, startDate: Date, endDate: Date) {
    const adjustedEndDate = new Date(endDate);
    adjustedEndDate.setHours(23, 59, 59, 999);

    const topEmployees = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.employee', 'e')
      .select('e.id', 'employeeId')
      .addSelect('e."fullName"', 'fullName')
      .addSelect('e."avatarUrl"', 'avatarUrl')
      .addSelect('SUM(CASE WHEN o.status = :completed THEN o."totalAmount" ELSE 0 END)', 'totalRevenue')
      .addSelect('COUNT(o.id)', 'totalOrders')
      .where('o.store_id = :storeId', { storeId, completed: OrderStatus.COMPLETED })
      .andWhere('o.status = :completed', { completed: OrderStatus.COMPLETED })
      .andWhere('o.created_at BETWEEN :startDate AND :endDate', {
        startDate,
        endDate: adjustedEndDate,
      })
      .groupBy('e.id')
      .orderBy('"totalRevenue"', 'DESC')
      .limit(3)
      .getRawMany();

    return topEmployees.map((e) => ({
      employeeId: e.employeeId,
      fullName: e.fullName,
      avatarUrl: e.avatarUrl,
      revenue: parseFloat(e.totalRevenue || '0'),
      ordersCount: parseInt(e.totalOrders || '0'),
    }));
  }

  // --- Shift Efficiency Report ---
  async getShiftEfficiencyReport(storeId: string, startDate: Date, endDate: Date) {
    const adjustedEndDate = new Date(endDate);
    adjustedEndDate.setHours(23, 59, 59, 999);

    const shiftData = await this.orderRepository
      .createQueryBuilder('o')
      .select(`CASE
        WHEN EXTRACT(HOUR FROM o.created_at) >= 6 AND EXTRACT(HOUR FROM o.created_at) < 12 THEN 'Ca sáng'
        WHEN EXTRACT(HOUR FROM o.created_at) >= 12 AND EXTRACT(HOUR FROM o.created_at) < 18 THEN 'Ca chiều'
        ELSE 'Ca tối'
      END`, 'shift')
      .addSelect('SUM(o."totalAmount")', 'revenue')
      .addSelect('COUNT(o.id)', 'orders')
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.status = :completed', { completed: OrderStatus.COMPLETED })
      .andWhere('o.created_at BETWEEN :startDate AND :endDate', {
        startDate,
        endDate: adjustedEndDate,
      })
      .groupBy('shift')
      .getRawMany();

    // Determine the most efficient
    const formatted = shiftData.map((s) => ({
      shiftName: s.shift,
      revenue: parseFloat(s.revenue || '0'),
      ordersCount: parseInt(s.orders || '0'),
    }));

    const bestShift = formatted.reduce((prev, current) => (prev.revenue > current.revenue) ? prev : current, { shiftName: 'Chưa có', revenue: 0, ordersCount: 0 });

    return {
      bestShift: bestShift.shiftName,
      details: formatted
    };
  }

  // --- Losing Money (Cancelled items) Report ---
  async getLosingMoneyReport(storeId: string, startDate: Date, endDate: Date) {
    const adjustedEndDate = new Date(endDate);
    adjustedEndDate.setHours(23, 59, 59, 999);

    let topCancelled: any[] = [];
    try {
      topCancelled = await this.orderItemRepository
        .createQueryBuilder('item')
        .innerJoin('item.order', 'o')
        .select("item.\"itemSnapshot\"->>'name'", 'name')
        .addSelect('SUM(item.quantity)', 'totalQuantity')
        .addSelect('SUM(item."totalPrice")', 'lostRevenue')
        .where('o.store_id = :storeId', { storeId })
        .andWhere('o.status = :status', { status: OrderStatus.CANCELLED })
        .andWhere('o.created_at BETWEEN :startDate AND :endDate', {
          startDate,
          endDate: adjustedEndDate,
        })
        .groupBy("item.\"itemSnapshot\"->>'name'")
        .orderBy('"totalQuantity"', 'DESC')
        .limit(5)
        .getRawMany();
    } catch (e) {
      topCancelled = [];
    }

    return topCancelled.map((i) => ({
      name: i.name,
      cancelledQuantity: parseInt(i.totalQuantity || '0'),
      lostRevenue: parseFloat(i.lostRevenue || '0'),
    }));
  }

  // Employee Asset Management
  async getEmployeeAssets(profileId: string) {
    const assignments = await this.assetAssignmentRepository.find({
      where: { employeeProfileId: profileId },
      relations: ['asset', 'asset.assetUnit', 'asset.assetCategory', 'asset.assetStatus', 'assignedBy', 'assignedBy.account'],
      order: { assignedDate: 'DESC' },
    });

    return assignments.map(assignment => ({
      id: assignment.id,
      asset: {
        id: assignment.asset.id,
        name: assignment.asset.name,
        code: assignment.asset.code,
        avatarUrl: assignment.asset.avatarUrl,
        value: assignment.asset.value,
        unit: assignment.asset.assetUnit?.name,
        category: assignment.asset.assetCategory?.name,
        status: assignment.asset.assetStatus?.name,
        statusColor: assignment.asset.assetStatus?.colorCode,
      },
      quantity: assignment.quantity,
      status: assignment.status,
      assignedDate: assignment.assignedDate,
      returnedDate: assignment.returnedDate,
      dueDate: assignment.dueDate,
      assignedBy: assignment.assignedBy?.account?.fullName || 'N/A',
      note: assignment.note,
      returnNote: assignment.returnNote,
    }));
  }

  async assignAssetToEmployee(profileId: string, assetId: string, quantity: number = 1, note?: string, assignedById?: string, dueDate?: Date) {
    const asset = await this.assetRepository.findOne({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Không tìm thấy tài sản');
    
    if (asset.currentStock < quantity) {
      throw new BadRequestException(`Không đủ tồn kho. Hiện có: ${asset.currentStock}, yêu cầu: ${quantity}`);
    }

    // Kiểm tra xem nhân viên đã được cấp tài sản này và đang sử dụng không
    let assignment = await this.assetAssignmentRepository.findOne({
      where: {
        employeeProfileId: profileId,
        assetId: assetId,
        status: AssetAssignmentStatus.ASSIGNED,
      },
    });

    if (assignment) {
      // Nếu đã có, chỉ tăng số lượng
      assignment.quantity += quantity;
      if (note) assignment.note = (assignment.note ? assignment.note + ' | ' : '') + note;
      if (dueDate) assignment.dueDate = dueDate;
      await this.assetAssignmentRepository.save(assignment);
    } else {
      // Nếu chưa có, tạo bản ghi mới
      assignment = this.assetAssignmentRepository.create({
        employeeProfileId: profileId,
        assetId: assetId,
        quantity: quantity,
        assignedById: assignedById,
        note: note,
        dueDate: dueDate,
      });
      await this.assetAssignmentRepository.save(assignment);
    }

    asset.currentStock -= quantity;
    await this.assetRepository.save(asset);

    return this.getEmployeeAssets(profileId);
  }

  async exchangeAsset(assignmentId: string, newAssetId: string, quantity: number = 1, note?: string, changedById?: string, dueDate?: Date) {
    // 1. Get old assignment
    const oldAssignment = await this.assetAssignmentRepository.findOne({
      where: { id: assignmentId },
      relations: ['asset'],
    });

    if (!oldAssignment) throw new NotFoundException('Không tìm thấy bản ghi cấp phát cũ');
    if (oldAssignment.status !== AssetAssignmentStatus.ASSIGNED) {
      throw new BadRequestException('Tài sản cũ phải đang trong trạng thái sử dụng');
    }

    // 2. Get new asset and check stock
    const newAsset = await this.assetRepository.findOne({ where: { id: newAssetId } });
    if (!newAsset) throw new NotFoundException('Không tìm thấy tài sản mới');
    
    if (newAsset.currentStock < quantity) {
      throw new BadRequestException(`Tài sản mới không đủ tồn kho (Hiện có: ${newAsset.currentStock})`);
    }

    // Use transaction for safer execution
    return await this.profileRepository.manager.transaction(async (manager) => {
      // 3. Return old asset
      oldAssignment.status = AssetAssignmentStatus.RETURNED;
      oldAssignment.returnedDate = new Date();
      oldAssignment.returnNote = `Đổi sang tài sản khác: ${newAsset.name}. ${note || ''}`;
      await manager.save(oldAssignment);

      // Increase stock A
      await manager.increment(Asset, { id: oldAssignment.assetId }, 'currentStock', oldAssignment.quantity);

      // 4. Assign new asset
      // Check if employee already has the new asset and is using it
      let assignment = await manager.findOne(EmployeeAssetAssignment, {
        where: {
          employeeProfileId: oldAssignment.employeeProfileId,
          assetId: newAssetId,
          status: AssetAssignmentStatus.ASSIGNED,
        },
      });

      if (assignment) {
        // If already has it, just increase quantity
        assignment.quantity += quantity;
        if (note) assignment.note = (assignment.note ? assignment.note + ' | ' : '') + note;
        if (dueDate) assignment.dueDate = dueDate;
        await manager.save(assignment);
      } else {
        // If not, create new record
        assignment = manager.create(EmployeeAssetAssignment, {
          employeeProfileId: oldAssignment.employeeProfileId,
          assetId: newAssetId,
          quantity: quantity,
          assignedById: changedById,
          note: `Đổi từ tài sản: ${oldAssignment.asset.name}. ${note || ''}`,
          dueDate: dueDate,
        });
        await manager.save(assignment);
      }

      // Decrease stock B
      await manager.decrement(Asset, { id: newAssetId }, 'currentStock', quantity);

      return this.getEmployeeAssets(oldAssignment.employeeProfileId);
    });
  }

  async returnAsset(assignmentId: string, status: AssetAssignmentStatus, returnNote?: string) {
    const assignment = await this.assetAssignmentRepository.findOne({
      where: { id: assignmentId },
      relations: ['asset'],
    });

    if (!assignment) throw new NotFoundException('Không tìm thấy bản ghi cấp phát');
    if (assignment.status !== AssetAssignmentStatus.ASSIGNED) {
      throw new BadRequestException('Tài sản này đã được thu hồi hoặc không còn hiệu lực');
    }

    assignment.status = status;
    assignment.returnedDate = new Date();
    assignment.returnNote = returnNote || null;

    await this.assetAssignmentRepository.save(assignment);

    if (status === AssetAssignmentStatus.RETURNED) {
      assignment.asset.currentStock += assignment.quantity;
      await this.assetRepository.save(assignment.asset);
    }

    return { message: 'Đã thu hồi tài sản thành công' };
  }

  async reassignAsset(assignmentId: string, quantity?: number, note?: string, assignedById?: string, dueDate?: Date) {
    const oldAssignment = await this.assetAssignmentRepository.findOne({
      where: { id: assignmentId },
    });
    if (!oldAssignment) throw new NotFoundException('Không tìm thấy bản ghi cấp phát cũ');

    // Sử dụng lại logic cấp phát để tự động gộp số lượng và trừ kho
    return this.assignAssetToEmployee(
      oldAssignment.employeeProfileId,
      oldAssignment.assetId,
      quantity || oldAssignment.quantity,
      note || `Cấp lại từ bản ghi cũ. ${oldAssignment.note || ''}`,
      assignedById,
      dueDate || (oldAssignment.dueDate ?? undefined),
    );
  }

  // Salary Advance Request management
  async createSalaryAdvanceRequest(
    employeeProfileId: string,
    data: { employeeSalaryId: string; requestedAmount: number; requestReason?: string }
  ) {
    // 1. Lấy thông tin phiếu lương
    const employeeSalary = await this.employeeSalaryRepository.findOne({
      where: { id: data.employeeSalaryId },
      relations: ['employeeProfile']
    });

    if (!employeeSalary) {
      throw new NotFoundException('Không tìm thấy phiếu lương');
    }

    if (employeeSalary.employeeProfileId !== employeeProfileId) {
      throw new BadRequestException('Phiếu lương không thuộc về nhân viên này');
    }

    // 2. Tính tổng số tiền đã ứng (bao gồm cả pending và approved)
    const existingAdvances = await this.salaryAdvanceRequestRepository.find({
      where: {
        employeeSalaryId: data.employeeSalaryId,
        status: In([AdvanceRequestStatus.PENDING, AdvanceRequestStatus.APPROVED])
      }
    });

    const totalAdvanced = existingAdvances.reduce((sum, adv) => {
      const amount = adv.status === AdvanceRequestStatus.APPROVED 
        ? (adv.approvedAmount || adv.requestedAmount)
        : adv.requestedAmount;
      return sum + Number(amount);
    }, 0);

    const totalAfterRequest = totalAdvanced + Number(data.requestedAmount);

    // 3. Kiểm tra điều kiện: Tổng tiền ứng không được vượt quá netSalary
    if (totalAfterRequest > Number(employeeSalary.netSalary)) {
      throw new BadRequestException(
        `Tổng số tiền ứng (${totalAfterRequest.toLocaleString()}đ) vượt quá lương thực nhận (${Number(employeeSalary.netSalary).toLocaleString()}đ)`
      );
    }

    // 4. Tạo yêu cầu ứng lương
    const request = this.salaryAdvanceRequestRepository.create({
      employeeProfileId,
      employeeSalaryId: data.employeeSalaryId,
      requestedAmount: data.requestedAmount,
      requestReason: data.requestReason,
      status: AdvanceRequestStatus.PENDING,
      requestedAt: new Date()
    });

    return this.salaryAdvanceRequestRepository.save(request);
  }

  async getSalaryAdvanceRequests(filters: {
    storeId?: string;
    employeeProfileId?: string;
    status?: AdvanceRequestStatus;
    month?: Date;
  }) {
    const queryBuilder = this.salaryAdvanceRequestRepository
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.employeeProfile', 'profile')
      .leftJoinAndSelect('profile.account', 'account')
      .leftJoinAndSelect('profile.storeRole', 'storeRole')
      .leftJoinAndSelect('profile.employeeType', 'employeeType')
      .leftJoinAndSelect('request.employeeSalary', 'salary')
      .leftJoinAndSelect('request.reviewedBy', 'reviewer')
      .orderBy('request.requestedAt', 'DESC');

    if (filters.storeId) {
      queryBuilder.andWhere('profile.storeId = :storeId', { storeId: filters.storeId });
    }

    if (filters.employeeProfileId) {
      queryBuilder.andWhere('request.employeeProfileId = :employeeProfileId', {
        employeeProfileId: filters.employeeProfileId
      });
    }

    if (filters.status) {
      queryBuilder.andWhere('request.status = :status', { status: filters.status });
    }

    if (filters.month) {
      queryBuilder.andWhere('salary.month = :month', { month: filters.month });
    }

    const requests = await queryBuilder.getMany();

    // Map to include UI specific fields
    return Promise.all(requests.map(async (request) => {
      // Tính tổng tiền đã ứng được DUYỆT cho phiếu lương này (không tính request hiện tại)
      const approvedAdvances = await this.salaryAdvanceRequestRepository.find({
        where: {
          employeeSalaryId: request.employeeSalaryId,
          status: AdvanceRequestStatus.APPROVED,
          id: Not(request.id)
        }
      });

      const totalApproved = approvedAdvances.reduce((sum, adv) => {
        return sum + Number(adv.approvedAmount || adv.requestedAmount);
      }, 0);

      const requestMonth = new Date(request.employeeSalary.month).getMonth() + 1;
      const nextMonth = (requestMonth % 12) + 1;

      let warningMessage: string | null = null;
      if (totalApproved > 0) {
        warningMessage = `Đã ứng lương tháng ${requestMonth}. Nếu tiếp tục sẽ cấn trừ qua tháng ${nextMonth}`;
      }

      return {
        ...request,
        employeeInfo: {
          fullName: request.employeeProfile.account?.fullName,
          avatar: request.employeeProfile.account?.avatar,
          employeeCode: `NV${request.employeeProfile.id.slice(0, 4)}`, // Giả lập mã NV
          roleName: request.employeeProfile.storeRole?.name,
          employeeTypeName: request.employeeProfile.employeeType?.name,
        },
        warningMessage,
        totalApprovedBefore: totalApproved
      };
    }));
  }

  async reviewSalaryAdvanceRequest(
    requestId: string,
    reviewerId: string,
    data: {
      status: AdvanceRequestStatus;
      approvedAmount?: number;
      reviewNote?: string;
      paymentMethod?: string;
      paymentReference?: string;
    }
  ) {
    const request = await this.salaryAdvanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['employeeSalary']
    });

    if (!request) {
      throw new NotFoundException('Không tìm thấy yêu cầu ứng lương');
    }

    if (request.status !== AdvanceRequestStatus.PENDING) {
      throw new BadRequestException('Yêu cầu này đã được xử lý');
    }

    // Nếu duyệt (APPROVED), cập nhật EmployeeSalary
    if (data.status === AdvanceRequestStatus.APPROVED) {
      const approvedAmount = data.approvedAmount || request.requestedAmount;

      // Kiểm tra lại điều kiện
      const totalAdvanced = await this.calculateTotalAdvanced(request.employeeSalaryId, requestId);
      const totalAfterApproval = totalAdvanced + Number(approvedAmount);

      if (totalAfterApproval > Number(request.employeeSalary.netSalary)) {
        throw new BadRequestException(
          `Tổng tiền ứng sau khi duyệt (${totalAfterApproval.toLocaleString()}đ) vượt quá lương thực nhận`
        );
      }

      // Cập nhật EmployeeSalary
      const currentAdvancePayment = Number(request.employeeSalary.advancePayment || 0);
      const newAdvancePayment = currentAdvancePayment + Number(approvedAmount);
      
      // Tính lại totalDeductions và netSalary
      const currentOtherDeductions = Number(request.employeeSalary.otherDeductions || 0);
      const currentPenalty = Number(request.employeeSalary.penalty || 0);
      const newTotalDeductions = currentPenalty + newAdvancePayment + currentOtherDeductions;
      const newNetSalary = Number(request.employeeSalary.totalIncome) - newTotalDeductions;

      await this.employeeSalaryRepository.update(request.employeeSalaryId, {
        advancePayment: newAdvancePayment,
        totalDeductions: newTotalDeductions,
        netSalary: newNetSalary
      });

      // Cập nhật request
      request.approvedAmount = approvedAmount;
    }

    // Cập nhật trạng thái request
    request.status = data.status;
    request.reviewedAt = new Date();
    request.reviewedByAccountId = reviewerId;
    if (data.reviewNote) request.reviewNote = data.reviewNote;
    if (data.paymentMethod) request.paymentMethod = data.paymentMethod;
    if (data.paymentReference) request.paymentReference = data.paymentReference;

    return this.salaryAdvanceRequestRepository.save(request);
  }

  async cancelSalaryAdvanceRequest(requestId: string, employeeProfileId: string) {
    const request = await this.salaryAdvanceRequestRepository.findOne({
      where: { id: requestId, employeeProfileId }
    });

    if (!request) {
      throw new NotFoundException('Không tìm thấy yêu cầu ứng lương');
    }

    if (request.status !== AdvanceRequestStatus.PENDING) {
      throw new BadRequestException('Chỉ có thể hủy yêu cầu đang chờ duyệt');
    }

    request.status = AdvanceRequestStatus.CANCELLED;
    return this.salaryAdvanceRequestRepository.save(request);
  }

  private async calculateTotalAdvanced(employeeSalaryId: string, excludeRequestId?: string) {
    const queryBuilder = this.salaryAdvanceRequestRepository
      .createQueryBuilder('request')
      .where('request.employeeSalaryId = :employeeSalaryId', { employeeSalaryId })
      .andWhere('request.status IN (:...statuses)', {
        statuses: [AdvanceRequestStatus.PENDING, AdvanceRequestStatus.APPROVED]
      });

    if (excludeRequestId) {
      queryBuilder.andWhere('request.id != :excludeRequestId', { excludeRequestId });
    }

    const requests = await queryBuilder.getMany();

    return requests.reduce((sum, req) => {
      const amount = req.status === AdvanceRequestStatus.APPROVED
        ? (req.approvedAmount || req.requestedAmount)
        : req.requestedAmount;
      return sum + Number(amount);
    }, 0);
  }

  // Salary Adjustment Logic
  async createSalaryAdjustment(createdByAccountId: string, data: any) {
    const profile = await this.profileRepository.findOne({
      where: { id: data.employeeProfileId },
      relations: ['contracts']
    });

    if (!profile) {
      throw new NotFoundException('Không tìm thấy hồ sơ nhân viên');
    }

    // Lấy hợp đồng đang hiệu lực (active)
    const activeContract = profile.contracts?.find(c => c.isActive);
    if (!activeContract) {
      throw new BadRequestException('Nhân viên hiện không có hợp đồng lao động nào đang hiệu lực');
    }

    // Kiểm tra tháng hiệu lực (Không cho phép tháng quá khứ)
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const effectiveMonth = new Date(data.effectiveMonth);
    
    if (effectiveMonth < currentMonth) {
      throw new BadRequestException('Không thể điều chỉnh lương cho các tháng trong quá khứ');
    }

    const previousSalary = Number(activeContract.salaryAmount);
    let adjustmentAmount = 0;

    // Tính toán số tiền điều chỉnh
    if (data.changeType === SalaryChangeType.PERCENTAGE) {
      adjustmentAmount = previousSalary * (Number(data.amountValue) / 100);
    } else {
      adjustmentAmount = Number(data.amountValue);
    }

    let newSalary = previousSalary;
    if (data.adjustmentType === AdjustmentType.INCREASE) {
      newSalary = previousSalary + adjustmentAmount;
    } else {
      newSalary = previousSalary - adjustmentAmount;
    }

    // Lấy lý do từ bảng reasons nếu có
    let reasonText = data.reasonText || '';
    if (data.reasonId) {
      const reason = await this.salaryAdjustmentReasonRepository.findOne({ where: { id: data.reasonId } });
      if (reason) reasonText = reason.name;
    }

    // 1. Tạo bản ghi lịch sử điều chỉnh
    const adjustment = this.salaryAdjustmentRepository.create({
      ...data,
      previousSalary,
      adjustmentAmount,
      newSalary,
      createdByAccountId,
      effectiveMonth,
      reasonText,
      paymentType: activeContract.paymentType
    });

    const savedAdjustment = await this.salaryAdjustmentRepository.save(adjustment);

    // 2. Nếu hiệu lực ngay tháng hiện tại -> Cập nhật Hợp đồng và Phiếu lương
    if (effectiveMonth.getTime() === currentMonth.getTime()) {
      // Cập nhật Hợp đồng
      const updateData: any = { salaryAmount: newSalary };
      await this.contractRepository.update(activeContract.id, updateData);

      // Cập nhật Phiếu lương tháng hiện tại (nếu đã được tạo)
      const currentSalary = await this.employeeSalaryRepository.findOne({
        where: {
          employeeProfileId: profile.id,
          month: currentMonth
        }
      });

      if (currentSalary) {
        await this.employeeSalaryRepository.update(currentSalary.id, {
          baseSalary: newSalary
          // Note: NetSalary should be recalculated if there's a hook, 
          // but usually it's calculated during final payroll processing.
        });
      }
    }

    return savedAdjustment;
  }

  async getSalaryAdjustments(employeeProfileId: string) {
    return this.salaryAdjustmentRepository.find({
      where: { employeeProfileId },
      relations: ['createdBy', 'reasonDetail'],
      order: { effectiveMonth: 'DESC', createdAt: 'DESC' }
    });
  }

  // Salary Adjustment Reasons
  async createSalaryAdjustmentReason(storeId: string, name: string) {
    const reason = this.salaryAdjustmentReasonRepository.create({
      storeId,
      name,
      isActive: true
    });
    return this.salaryAdjustmentReasonRepository.save(reason);
  }

  async getSalaryAdjustmentReasons(storeId: string) {
    return this.salaryAdjustmentReasonRepository.find({
      where: { storeId, isActive: true },
      order: { name: 'ASC' }
    });
  }

  // Employee Payment History (Individual)
  async createEmployeePaymentHistory(data: Partial<EmployeePaymentHistory>) {
    // Nếu có ID tài khoản thanh toán, tự động lấy thông tin để lưu snapshot
    if (data.paymentAccountId && !data.paymentAccountInfo) {
      const account = await this.storePaymentAccountRepository.findOne({
        where: { id: data.paymentAccountId }
      });
      if (account) {
        data.paymentAccountInfo = `${account.bankName} - ****${account.accountNumber.slice(-4)}`;
      }
    }
    
    const payment = this.employeePaymentHistoryRepository.create(data);
    return this.employeePaymentHistoryRepository.save(payment);
  }

  async getEmployeePaymentHistories(employeeProfileId: string) {
    return this.employeePaymentHistoryRepository.find({
      where: { employeeProfileId },
      order: { paymentDate: 'DESC' },
      relations: ['store'],
    });
  }

  async getEmployeeSalaryHistory(profileId: string, page = 1, limit = 10) {
    const [data, total] = await this.employeePaymentHistoryRepository.findAndCount({
      where: { employeeProfileId: profileId },
      order: { paymentDate: 'DESC' },
      relations: ['store'],
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }

  async updateEmployeePaymentHistory(id: string, data: Partial<EmployeePaymentHistory>) {
    const payment = await this.employeePaymentHistoryRepository.findOne({ where: { id } });
    if (!payment) throw new NotFoundException('Không tìm thấy lịch sử thanh toán');
    
    Object.assign(payment, data);
    return this.employeePaymentHistoryRepository.save(payment);
  }

  async deleteEmployeePaymentHistory(id: string) {
    const payment = await this.employeePaymentHistoryRepository.findOne({ where: { id } });
    if (!payment) throw new NotFoundException('Không tìm thấy lịch sử thanh toán');
    
    return this.employeePaymentHistoryRepository.remove(payment);
  }

  // Store Payment Accounts
  async createStorePaymentAccount(data: Partial<StorePaymentAccount>) {
    if (data.isDefault) {
      await this.storePaymentAccountRepository.update(
        { storeId: data.storeId },
        { isDefault: false }
      );
    }
    const account = this.storePaymentAccountRepository.create(data);
    return this.storePaymentAccountRepository.save(account);
  }

  async getStorePaymentAccounts(storeId: string) {
    const accounts = await this.storePaymentAccountRepository.find({
      where: { storeId, isActive: true },
      order: { isDefault: 'DESC', createdAt: 'ASC' }
    });

    return accounts.map(acc => ({
      id: acc.id,
      bankName: acc.bankName,
      accountHolderName: acc.accountHolderName,
      accountNumberMasked: acc.accountNumber.length > 4 
        ? `****${acc.accountNumber.slice(-4)}` 
        : acc.accountNumber,
      isDefault: acc.isDefault
    }));
  }

  async updateStorePaymentAccount(id: string, data: Partial<StorePaymentAccount>) {
    const account = await this.storePaymentAccountRepository.findOne({ where: { id } });
    if (!account) throw new NotFoundException('Không tìm thấy tài khoản thanh toán');

    if (data.isDefault) {
      await this.storePaymentAccountRepository.update(
        { storeId: account.storeId },
        { isDefault: false }
      );
    }

    Object.assign(account, data);
    return this.storePaymentAccountRepository.save(account);
  }

  async deleteStorePaymentAccount(id: string) {
    const account = await this.storePaymentAccountRepository.findOne({ where: { id } });
    if (!account) throw new NotFoundException('Không tìm thấy tài khoản thanh toán');
    
    return this.storePaymentAccountRepository.remove(account);
  }

  async payEmployeeSalary(salaryId: string, data: { paymentAccountId: string, paymentMethod?: string, referenceNumber?: string, notes?: string }) {
    const salary = await this.employeeSalaryRepository.findOne({
      where: { id: salaryId },
      relations: ['employeeProfile', 'monthlyPayroll']
    });

    if (!salary) {
      throw new NotFoundException('Không tìm thấy phiếu lương');
    }

    if (salary.paymentStatus === PaymentStatus.PAID) {
      throw new BadRequestException('Phiếu lương này đã được thanh toán trước đó');
    }

    // 1. Lấy thông tin tài khoản ngân hàng của Store
    const account = await this.storePaymentAccountRepository.findOne({
      where: { id: data.paymentAccountId }
    });

    if (!account) {
      throw new NotFoundException('Không tìm thấy tài khoản thanh toán của cửa hàng');
    }

    const store = await this.storeRepository.findOne({ where: { id: salary.monthlyPayroll.storeId } });
    if (!store) {
      throw new NotFoundException('Không tìm thấy cửa hàng');
    }

    // 2. Cập nhật trạng thái phiếu lương
    salary.paymentStatus = PaymentStatus.PAID;
    salary.paidAt = new Date();
    salary.notes = data.notes || salary.notes;
    await this.employeeSalaryRepository.save(salary);

    // 3. Tạo bản ghi lịch sử thanh toán cho nhân viên
    const paymentHistory = this.employeePaymentHistoryRepository.create({
      employeeProfileId: salary.employeeProfileId,
      storeId: store.id,
      storeName: store.name,
      amount: salary.netSalary,
      salaryMonth: salary.month,
      paymentDate: new Date(),
      paymentMethod: data.paymentMethod || 'Chuyển khoản',
      referenceNumber: data.referenceNumber,
      paymentAccountId: account.id,
      paymentAccountInfo: `${account.bankName} - ****${account.accountNumber.slice(-4)}`,
      notes: data.notes
    });

    await this.employeePaymentHistoryRepository.save(paymentHistory);

    return {
      message: 'Thanh toán lương thành công',
      paymentHistory
    };
  }

  async getEmployeeSalaryDetailByMonth(employeeProfileId: string, monthStr: string) {
    const month = new Date(monthStr);
    const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);

    const profile = await this.profileRepository.findOne({
      where: { id: employeeProfileId },
      relations: ['account', 'storeRole', 'employeeType', 'contracts', 'workShift'],
    });

    if (!profile) {
      throw new NotFoundException('Không tìm thấy hồ sơ nhân viên');
    }

    // 1. Lấy phiếu lương của tháng yêu cầu
    const salaryRecord = await this.employeeSalaryRepository.findOne({
      where: { employeeProfileId, month: monthStart },
      relations: ['monthlyPayroll']
    });

    if (!salaryRecord) {
      throw new NotFoundException(`Không tìm thấy phiếu lương cho tháng ${monthStart.getMonth() + 1}/${monthStart.getFullYear()}`);
    }

    // 2. Lấy hợp đồng đang hiệu lực
    const activeContract = profile.contracts?.find(c => c.isActive);
    
    // Tính số ngày còn lại của hợp đồng
    let daysRemaining: number | null = null;
    const now = new Date();
    if (activeContract?.endDate) {
      const end = new Date(activeContract.endDate);
      const diffTime = end.getTime() - now.getTime();
      daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    // 3. Lấy lịch sử thanh toán (Mới tạo ở bước trước)
    const paymentHistory = await this.employeePaymentHistoryRepository.find({
      where: { employeeProfileId },
      order: { paymentDate: 'DESC' }
    });

    // Format trạng thái
    const monthLabel = monthStart.getMonth() + 1;
    let payrollStatusText = `${salaryRecord.paymentStatus} tháng ${monthLabel}`;
    if (salaryRecord.paymentStatus === PaymentStatus.PENDING) {
      payrollStatusText = `Chưa chi trả lương tháng ${monthLabel}`;
    }

    return {
      employeeInfo: {
        fullName: profile.account?.fullName,
        avatar: profile.account?.avatar,
        employeeCode: profile.id.split('-')[0], // Lấy chuỗi đầu tiên của UUID
      },
      jobDetails: {
        roleStore: profile.storeRole?.name,
        typeStore: profile.employeeType?.name,
        shiftName: profile.workShift?.shiftName, // <--- Thêm Tên ca
        joinedAt: profile.joinedAt,
      },
      payrollStatus: payrollStatusText,
      daysRemaining: daysRemaining,
      currentSalary: {
        value: activeContract?.salaryAmount || 0,
        method: activeContract?.paymentType,
      },
      // Đổ toàn bộ dữ liệu từ EmployeeSalary
      ...salaryRecord,
      // Lịch sử thanh toán
      paymentHistory: paymentHistory
    };
  }

  async getEmployeeSalaryOverview(employeeProfileId: string) {
    const profile = await this.profileRepository.findOne({
      where: { id: employeeProfileId },
      relations: ['account', 'storeRole', 'employeeType', 'contracts'],
    });

    if (!profile) {
      throw new NotFoundException('Không tìm thấy hồ sơ nhân viên');
    }

    // Xác định ngày bắt đầu của tháng hiện tại
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // 1. Tìm hợp đồng đang hiệu lực
    const activeContract = profile.contracts?.find(c => c.isActive);

    // 2. Lấy trạng thái trả lương tháng hiện tại
    const currentSalary = await this.employeeSalaryRepository.findOne({
      where: {
        employeeProfileId: profile.id,
        month: currentMonthStart
      }
    });

    // 3. Lấy lịch sử điều chỉnh lương
    const adjustmentHistory = await this.salaryAdjustmentRepository.find({
      where: { employeeProfileId: profile.id },
      relations: ['createdBy'],
      order: { effectiveMonth: 'DESC', createdAt: 'DESC' }
    });

    // Tính số ngày còn lại của hợp đồng
    let daysRemaining: number | null = null;
    if (activeContract?.endDate) {
      const end = new Date(activeContract.endDate);
      const diffTime = end.getTime() - now.getTime();
      daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    // Format trạng thái trả lương
    let payrollStatusText = 'Chưa tạo phiếu lương';
    if (currentSalary) {
      const monthLabel = currentMonthStart.getMonth() + 1;
      payrollStatusText = `${currentSalary.paymentStatus} tháng ${monthLabel}`;
      if (currentSalary.paymentStatus === PaymentStatus.PENDING) {
        payrollStatusText = `Chưa chi trả lương tháng ${monthLabel}`;
      }
    }

    return {
      id: profile.id,
      employeeInfo: {
        fullName: profile.account?.fullName,
        avatar: profile.account?.avatar,
        employeeCode: profile.id.split('-')[0],
      },
      jobDetails: {
        roleStore: profile.storeRole?.name,
        typeStore: profile.employeeType?.name,
        joinedAt: profile.joinedAt,
      },
      contractDetails: {
        id: activeContract?.id,
        expiryDate: activeContract?.endDate,
        daysRemaining: daysRemaining,
        currentSalary: {
          value: activeContract?.salaryAmount || 0,
          method: activeContract?.paymentType,
        },
        allowances: activeContract?.allowances || {},
      },
      payrollStatus: payrollStatusText,
      salaryAdjustments: {
        latest: adjustmentHistory[0] || null,
        history: adjustmentHistory
      }
    };
  }

  async updateEmployeeSalaryStructure(employeeProfileId: string, data: { salaryAmount?: number; allowances?: Record<string, number> }) {
    const profile = await this.profileRepository.findOne({
      where: { id: employeeProfileId },
      relations: ['contracts']
    });

    if (!profile) {
      throw new NotFoundException('Không tìm thấy hồ sơ nhân viên');
    }

    const activeContract = profile.contracts?.find(c => c.isActive);
    if (!activeContract) {
      throw new BadRequestException('Nhân viên không có hợp đồng lao động đang hoạt động');
    }

    const updateData: any = {};
    if (data.salaryAmount !== undefined) {
      updateData.salaryAmount = data.salaryAmount;
    }
    if (data.allowances !== undefined) {
      updateData.allowances = data.allowances;
    }

    await this.contractRepository.update(activeContract.id, updateData);
    
    // Nếu cập nhật trong tháng này, cần kiểm tra và cập nhật phiếu lương tháng này nếu đã tạo
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const currentSalary = await this.employeeSalaryRepository.findOne({
      where: { employeeProfileId, month: currentMonth }
    });

    if (currentSalary) {
      const salaryUpdate: any = {};
      if (data.salaryAmount !== undefined) salaryUpdate.baseSalary = data.salaryAmount;
      if (data.allowances !== undefined) salaryUpdate.allowances = data.allowances;
      
      await this.employeeSalaryRepository.update(currentSalary.id, salaryUpdate);
    }

    return { message: 'Cập nhật bảng lương thành công' };
  }

  async getEmployeesSalaryOverview(storeId: string) {
    const profiles = await this.profileRepository.find({
      where: { storeId },
      relations: ['account', 'storeRole', 'employeeType', 'contracts'],
      order: { joinedAt: 'DESC' }
    });

    // Xác định ngày bắt đầu của tháng hiện tại
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    return Promise.all(profiles.map(async (profile) => {
      // 1. Tìm hợp đồng đang hiệu lực
      const activeContract = profile.contracts?.find(c => c.isActive);

      // 2. Lấy trạng thái trả lương tháng hiện tại
      const currentSalary = await this.employeeSalaryRepository.findOne({
        where: {
          employeeProfileId: profile.id,
          month: currentMonthStart
        }
      });

      // 3. Lấy lịch sử điều chỉnh lương
      const adjustmentHistory = await this.salaryAdjustmentRepository.find({
        where: { employeeProfileId: profile.id },
        relations: ['createdBy'],
        order: { effectiveMonth: 'DESC', createdAt: 'DESC' }
      });

      return {
        id: profile.id,
        employeeInfo: {
          fullName: profile.account?.fullName,
          avatar: profile.account?.avatar,
          employeeCode: profile.id.split('-')[0],
        },
        jobDetails: {
          roleStore: profile.storeRole?.name,
          typeStore: profile.employeeType?.name,
          joinedAt: profile.joinedAt,
        },
        contractDetails: {
          expiryDate: activeContract?.endDate,
          currentSalary: {
            value: activeContract?.salaryAmount || 0,
            method: activeContract?.paymentType,
          }
        },
        payrollStatus: currentSalary?.paymentStatus || 'Chưa tạo phiếu',
        salaryAdjustments: {
          latest: adjustmentHistory[0] || null,
          history: adjustmentHistory
        }
      };
    }));
  }

  // Asset Export Management
  async createAssetExportType(storeId: string, data: any) {
    const type = this.assetExportTypeRepository.create({ ...data, storeId });
    return this.assetExportTypeRepository.save(type);
  }

  async getAssetExportTypes(storeId: string) {
    return this.assetExportTypeRepository.find({
      where: { storeId, isActive: true },
    });
  }

  async exportAssetsBulk(data: AssetExportDto, files: Express.Multer.File[] = []) {
    const { items } = data;
    const transactionCodes: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      // 1. Create Stock Transaction for each item (since they have individual dates/types)
      const transaction = this.stockTransactionRepository.create({
        storeId: item.storeId,
        type: StockTransactionType.EXPORT,
        code: `PX-ASSET-${Date.now()}-${i}`,
        assetExportTypeId: item.assetExportTypeId,
        transactionDate: new Date(item.exportDate),
        note: item.note,
        status: StockTransactionStatus.COMPLETED,
      });

      // Find file specifically for this item (file_0, file_1...)
      const itemFile = files.find(f => f.fieldname === `file_${i}`);
      if (itemFile) {
        transaction.fileUrl = `/uploads/${itemFile.filename}`;
      }

      const savedTransaction = await this.stockTransactionRepository.save(transaction);
      transactionCodes.push(savedTransaction.code);

      // 2. Create Detail and Update Stock
      if (item.assetId) {
        const asset = await this.assetRepository.findOne({ where: { id: item.assetId } });
        if (asset) {
          // Validate stock
          if (Number(item.quantity) > (asset.currentStock || 0)) {
            throw new BadRequestException(`Số lượng xuất (${item.quantity}) vượt quá tồn kho hiện tại (${asset.currentStock}) của tài sản "${asset.name}"`);
          }

          const detail = this.stockTransactionDetailRepository.create({
            transactionId: savedTransaction.id,
            assetId: asset.id,
            quantity: Number(item.quantity),
            unitPrice: Number(asset.value) || 0,
            totalPrice: (Number(asset.value) || 0) * Number(item.quantity),
            note: item.note,
            fileUrl: transaction.fileUrl,
          });
          await this.stockTransactionDetailRepository.save(detail);

          // Update Stock
          asset.currentStock = (asset.currentStock || 0) - Number(item.quantity);
          await this.assetRepository.save(asset);
        }
      } else if ((item as any).productId) {
        const product = await this.productRepository.findOne({ where: { id: (item as any).productId } });
        if (product) {
          // Validate stock
          if (Number(item.quantity) > ((product as any).currentStock || 0)) {
            throw new BadRequestException(`Số lượng xuất (${item.quantity}) vượt quá tồn kho hiện tại (${(product as any).currentStock}) của hàng hóa "${product.name}"`);
          }

          const detail = this.stockTransactionDetailRepository.create({
            transactionId: savedTransaction.id,
            productId: product.id,
            quantity: Number(item.quantity),
            unitPrice: Number(product.costPrice) || 0,
            totalPrice: (Number(product.costPrice) || 0) * Number(item.quantity),
            note: item.note,
            fileUrl: transaction.fileUrl,
          });
          await this.stockTransactionDetailRepository.save(detail);

          // Update Stock
          if ((product as any).currentStock !== undefined) {
             (product as any).currentStock -= Number(item.quantity);
             await this.productRepository.save(product);
          }
        }
      }

    }

    return {
      message: `Đã xuất kho ${items.length} món hàng thành công`,
      transactionCodes,
    };
  }

  // Product Export Management
  async createProductExportType(storeId: string, data: Partial<ProductExportType>) {
    const type = this.productExportTypeRepository.create({ ...data, storeId });
    return this.productExportTypeRepository.save(type);
  }

  async getProductExportTypes(storeId: string) {
    return this.productExportTypeRepository.find({
      where: { storeId, isActive: true },
    });
  }

  async exportProductsBulk(data: ProductExportDto, files: Express.Multer.File[] = []) {
    const items = data.items || [];
    const transactionCodes: string[] = [];


    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      const transaction = this.stockTransactionRepository.create({
        storeId: item.storeId,
        type: StockTransactionType.EXPORT,
        code: `PX-PROD-${Date.now()}-${i}`,
        productExportTypeId: item.productExportTypeId,
        transactionDate: new Date(item.exportDate),
        note: item.note,
        status: StockTransactionStatus.COMPLETED,
      });

      const itemFile = files.find(f => f.fieldname === `file_${i}`);
      if (itemFile) {
        transaction.fileUrl = `/uploads/${itemFile.filename}`;
      }

      const savedTransaction = await this.stockTransactionRepository.save(transaction);
      transactionCodes.push(savedTransaction.code);

      const product = await this.productRepository.findOne({ where: { id: item.productId } });
      if (product) {
        if (Number(item.quantity) > (product.currentStock || 0)) {
          throw new BadRequestException(`Số lượng xuất (${item.quantity}) vượt quá tồn kho hiện tại (${product.currentStock}) của hàng hóa "${product.name}"`);
        }

        const detail = this.stockTransactionDetailRepository.create({
          transactionId: savedTransaction.id,
          productId: product.id,
          quantity: Number(item.quantity),
          unitPrice: Number(product.costPrice) || 0,
          totalPrice: (Number(product.costPrice) || 0) * Number(item.quantity),
          note: item.note,
          fileUrl: transaction.fileUrl,
        });
        await this.stockTransactionDetailRepository.save(detail);

        product.currentStock = (product.currentStock || 0) - Number(item.quantity);
        await this.productRepository.save(product);
      }
    }

    return {
      message: `Đã xuất kho ${items.length} mặt hàng thành công`,
      transactionCodes,
    };
  }

  async getProductReport(storeId: string, filters: { date?: string; productStatusId?: string }) {
    if (filters.date === 'undefined' || filters.date === 'null') filters.date = undefined;
    if (filters.productStatusId === 'all' || filters.productStatusId === 'undefined' || filters.productStatusId === 'null') filters.productStatusId = undefined;

    const summaryAllTime = await this.stockTransactionDetailRepository.createQueryBuilder('detail')
      .leftJoin('detail.transaction', 'transaction')
      .select('COUNT(detail.id)', 'totalItems')
      .addSelect('SUM(detail.total_price)', 'totalValue')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', { type: StockTransactionType.IMPORT })
      .andWhere('detail.product_id IS NOT NULL')
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .getRawOne();

    const targetDate = filters.date || new Date().toISOString().split('T')[0];
    const summaryToday = await this.stockTransactionDetailRepository.createQueryBuilder('detail')
      .leftJoin('detail.transaction', 'transaction')
      .select('COUNT(detail.id)', 'totalItems')
      .addSelect('SUM(detail.total_price)', 'totalValue')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', { type: StockTransactionType.IMPORT })
      .andWhere('detail.product_id IS NOT NULL')
      .andWhere('DATE(transaction.transaction_date) = :targetDate', { targetDate })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .getRawOne();

    const allStatuses = await this.productStatusRepository.find({ where: { storeId, isActive: true } });
    
    const statusStatsQb = this.stockTransactionDetailRepository.createQueryBuilder('detail')
      .select('product.product_status_id', 'statusId')
      .addSelect('COUNT(detail.id)', 'itemCount')
      .leftJoin('detail.product', 'product')
      .leftJoin('detail.transaction', 'transaction')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', { type: StockTransactionType.IMPORT })
      .andWhere('detail.product_id IS NOT NULL')
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .groupBy('product.product_status_id');


    if (filters.date) {
      statusStatsQb.andWhere('DATE(transaction.transaction_date) = :date', { date: filters.date });
    }

    const statusStatsRaw = await statusStatsQb.getRawMany();

    const statusDetails = allStatuses.map(status => {
      const found = statusStatsRaw.find(r => r.statusId === status.id);
      return {
        id: status.id,
        name: status.name,
        colorCode: status.colorCode,
        count: found ? Number(found.itemCount) : 0
      };
    });

    const totalHistoryItems = statusDetails.reduce((sum, item) => sum + item.count, 0);

    const importHistoryQb = this.stockTransactionDetailRepository.createQueryBuilder('detail')
      .leftJoinAndSelect('detail.transaction', 'transaction')
      .leftJoinAndSelect('detail.product', 'product')
      .leftJoinAndSelect('product.productUnit', 'unit')
      .leftJoinAndSelect('product.productCategory', 'category')
      .leftJoinAndSelect('product.productStatus', 'status')
      .leftJoinAndSelect('product.store', 'store')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', { type: StockTransactionType.IMPORT })
      .andWhere('detail.product_id IS NOT NULL')
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .orderBy('transaction.transaction_date', 'DESC');


    if (filters.date) {
      importHistoryQb.andWhere('DATE(transaction.transaction_date) = :date', { date: filters.date });
    }

    if (filters.productStatusId) {
      importHistoryQb.andWhere('product.product_status_id = :statusId', { statusId: filters.productStatusId });
    }

    const importHistory = await importHistoryQb.getMany();

    const formattedImports = importHistory.map(detail => ({
      id: detail.id,
      productName: detail.product?.name,
      sku: detail.product?.sku,
      avatarUrl: detail.product?.avatarUrl,
      categoryName: detail.product?.productCategory?.name,
      unitName: detail.product?.productUnit?.name,
      value: Number(detail.unitPrice),
      quantity: Number(detail.quantity),
      totalPrice: Number(detail.totalPrice),
      status: {
        id: detail.product?.productStatus?.id,
        name: detail.product?.productStatus?.name,
        colorCode: detail.product?.productStatus?.colorCode
      },
      storeName: detail.product?.store?.name,
      importDate: detail.transaction?.transactionDate,
      transactionCode: detail.transaction?.code,
      transactionId: detail.transaction?.id
    }));


    return {
      summary: {
        total: {
          count: Number(summaryAllTime.totalItems) || 0,
          value: Number(summaryAllTime.totalValue) || 0,
        },
        today: {
          date: targetDate,
          count: Number(summaryToday.totalItems) || 0,
          value: Number(summaryToday.totalValue) || 0,
        }
      },
      statusStatistics: {
        all: totalHistoryItems,
        details: statusDetails
      },
      importHistory: formattedImports
    };
  }

  async getProductExportReport(storeId: string, filters: { date?: string; productExportTypeId?: string }) {
    if (filters.date === 'undefined' || filters.date === 'null') filters.date = undefined;
    if (filters.productExportTypeId === 'all' || filters.productExportTypeId === 'undefined' || filters.productExportTypeId === 'null') filters.productExportTypeId = undefined;

    const summaryAllTime = await this.stockTransactionDetailRepository.createQueryBuilder('detail')
      .leftJoin('detail.transaction', 'transaction')
      .select('COUNT(detail.id)', 'totalItems')
      .addSelect('SUM(detail.total_price)', 'totalValue')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', { type: StockTransactionType.EXPORT })
      .andWhere('detail.product_id IS NOT NULL')
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .getRawOne();

    const targetDate = filters.date || new Date().toISOString().split('T')[0];
    const summaryToday = await this.stockTransactionDetailRepository.createQueryBuilder('detail')
      .leftJoin('detail.transaction', 'transaction')
      .select('COUNT(detail.id)', 'totalItems')
      .addSelect('SUM(detail.total_price)', 'totalValue')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', { type: StockTransactionType.EXPORT })
      .andWhere('detail.product_id IS NOT NULL')
      .andWhere('DATE(transaction.transaction_date) = :targetDate', { targetDate })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .getRawOne();

    const allExportTypes = await this.productExportTypeRepository.find({ where: { storeId, isActive: true } });
    
    const typeStatsQb = this.stockTransactionDetailRepository.createQueryBuilder('detail')
      .select('transaction.product_export_type_id', 'typeId')
      .addSelect('COUNT(detail.id)', 'itemCount')
      .leftJoin('detail.transaction', 'transaction')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', { type: StockTransactionType.EXPORT })
      .andWhere('detail.product_id IS NOT NULL')
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .groupBy('transaction.product_export_type_id');


    if (filters.date) {
      typeStatsQb.andWhere('DATE(transaction.transaction_date) = :date', { date: filters.date });
    }

    const typeStatsRaw = await typeStatsQb.getRawMany();

    const typeDetails = allExportTypes.map(type => {
      const found = typeStatsRaw.find(r => r.typeId === type.id);
      return {
        id: type.id,
        name: type.name,
        colorCode: type.colorCode,
        count: found ? Number(found.itemCount) : 0
      };
    });

    const totalHistoryItems = typeDetails.reduce((sum, item) => sum + item.count, 0);

    const exportHistoryQb = this.stockTransactionDetailRepository.createQueryBuilder('detail')
      .leftJoinAndSelect('detail.transaction', 'transaction')
      .leftJoinAndSelect('transaction.productExportType', 'exportType')
      .leftJoinAndSelect('detail.product', 'product')
      .leftJoinAndSelect('product.productUnit', 'unit')
      .leftJoinAndSelect('product.productCategory', 'category')
      .leftJoinAndSelect('product.store', 'store')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', { type: StockTransactionType.EXPORT })
      .andWhere('detail.product_id IS NOT NULL')
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .orderBy('transaction.transaction_date', 'DESC');


    if (filters.date) {
      exportHistoryQb.andWhere('DATE(transaction.transaction_date) = :date', { date: filters.date });
    }

    if (filters.productExportTypeId) {
      exportHistoryQb.andWhere('transaction.product_export_type_id = :typeId', { typeId: filters.productExportTypeId });
    }

    const exportHistory = await exportHistoryQb.getMany();

    const formattedExports = exportHistory.map(detail => ({
      id: detail.id,
      productName: detail.product?.name,
      sku: detail.product?.sku,
      avatarUrl: detail.product?.avatarUrl,
      categoryName: detail.product?.productCategory?.name,
      unitName: detail.product?.productUnit?.name,
      value: Number(detail.unitPrice),
      quantity: Number(detail.quantity),
      totalPrice: Number(detail.totalPrice),
      status: {
        id: detail.transaction?.productExportType?.id,
        name: detail.transaction?.productExportType?.name,
        colorCode: detail.transaction?.productExportType?.colorCode
      },
      storeName: detail.product?.store?.name,
      exportDate: detail.transaction?.transactionDate,
      transactionCode: detail.transaction?.code,
      transactionId: detail.transaction?.id,
      note: detail.transaction?.note || detail.note
    }));


    return {
      summary: {
        total: {
          count: Number(summaryAllTime.totalItems) || 0,
          value: Number(summaryAllTime.totalValue) || 0,
        },
        today: {
          date: targetDate,
          count: Number(summaryToday.totalItems) || 0,
          value: Number(summaryToday.totalValue) || 0,
        }
      },
      statusStatistics: {
        all: totalHistoryItems,
        details: typeDetails
      },
      exportHistory: formattedExports
    };
  }



  async deleteStockTransaction(transactionId: string) {
    const transaction = await this.stockTransactionRepository.findOne({
      where: { id: transactionId },
      relations: ['details', 'details.asset', 'details.product'],
    });

    if (!transaction) {
      throw new NotFoundException('Không tìm thấy giao dịch');
    }

    // Hoàn tác tồn kho cho từng chi tiết
    for (const detail of transaction.details) {
      if (detail.assetId && detail.asset) {
        if (transaction.type === StockTransactionType.IMPORT) {
          detail.asset.currentStock = Math.max(0, (detail.asset.currentStock || 0) - detail.quantity);
        } else if (transaction.type === StockTransactionType.EXPORT) {
          detail.asset.currentStock = (detail.asset.currentStock || 0) + detail.quantity;
        }
        await this.assetRepository.save(detail.asset);
      } else if (detail.productId && detail.product) {
        if (transaction.type === StockTransactionType.IMPORT) {
          detail.product.currentStock = Math.max(0, (detail.product.currentStock || 0) - detail.quantity);
        } else if (transaction.type === StockTransactionType.EXPORT) {
          detail.product.currentStock = (detail.product.currentStock || 0) + detail.quantity;
        }
        await this.productRepository.save(detail.product);
      }
    }

    // Xóa transaction (soft delete)
    await this.stockTransactionRepository.softDelete(transactionId);
    
    // Xóa chi tiết (soft delete)
    await this.stockTransactionDetailRepository.softDelete({ transactionId });

    return { message: 'Xóa giao dịch và hoàn tác tồn kho thành công' };
  }

  async getGeneralDashboard(storeId: string, monthStr?: string) {
    // 1. Xác định khung thời gian (Tháng hiện tại & Tháng trước)
    const now = new Date();
    let targetDate = now;
    if (monthStr) {
      // monthStr format: MM/YYYY or YYYY-MM
      const parts = monthStr.includes('/') ? monthStr.split('/') : monthStr.split('-');
      if (parts.length === 2) {
        // Nếu input là MM/YYYY -> parts[0]=MM, parts[1]=YYYY
        // Nếu input là YYYY-MM -> parts[0]=YYYY, parts[1]=MM
        const isYearFirst = parts[0].length === 4;
        const year = isYearFirst ? Number(parts[0]) : Number(parts[1]);
        const month = isYearFirst ? Number(parts[1]) : Number(parts[0]);
        targetDate = new Date(year, month - 1, 1);
      }
    }

    const currentYear = targetDate.getFullYear();
    const currentMonth = targetDate.getMonth() + 1; // 1-12

    const previousDate = new Date(currentYear, currentMonth - 2, 1);
    const previousYear = previousDate.getFullYear();
    const previousMonth = previousDate.getMonth() + 1;

    // Helper: Tính tổng tồn kho và giá trị tại thời điểm cuối tháng
    // Logic: Tổng nhập - Tổng xuất (tính đến thời điểm đó)
    const getStockStats = async (year: number, month: number) => {
      // Ngày cuối tháng
      const endDate = new Date(year, month, 0, 23, 59, 59);

      const qb = this.stockTransactionDetailRepository.createQueryBuilder('detail')
        .leftJoin('detail.transaction', 'transaction')
        .select([
          'SUM(CASE WHEN transaction.type = :import THEN detail.quantity ELSE -detail.quantity END) as netQuantity',
          'SUM(CASE WHEN transaction.type = :import THEN detail.total_price ELSE -detail.total_price END) as netValue',
          'COUNT(DISTINCT CASE WHEN detail.asset_id IS NOT NULL THEN detail.asset_id END) as assetCount', // Số lượng đầu tài sản unique (xấp xỉ)
          'COUNT(DISTINCT CASE WHEN detail.product_id IS NOT NULL THEN detail.product_id END) as productCount'
        ])
        .setParameters({ 
          import: StockTransactionType.IMPORT, 
          // export: StockTransactionType.EXPORT,
          storeId,
          endDate 
        })
        .where('transaction.store_id = :storeId')
        .andWhere('transaction.transaction_date <= :endDate')
        .andWhere('transaction.deleted_at IS NULL')
        .andWhere('detail.deleted_at IS NULL');

      const assetStats = await qb.clone()
        .andWhere('detail.asset_id IS NOT NULL')
        .getRawOne();
      
      const productStats = await qb.clone()
        .andWhere('detail.product_id IS NOT NULL')
        .getRawOne();

      return {
        asset: {
          quantity: Number(assetStats.netQuantity) || 0,
          value: Number(assetStats.netValue) || 0,
        },
        product: {
          quantity: Number(productStats.netQuantity) || 0,
          value: Number(productStats.netValue) || 0,
        }
      };
    };

    const currentStats = await getStockStats(currentYear, currentMonth);
    const previousStats = await getStockStats(previousYear, previousMonth);

    const calculateGrowth = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Number((((current - previous) / previous) * 100).toFixed(2));
    };

    // Phần 1: Tổng quan Tăng/Giảm
    const summary = {
      assets: {
        totalQuantity: currentStats.asset.quantity,
        totalValue: currentStats.asset.value,
        growthQuantity: calculateGrowth(currentStats.asset.quantity, previousStats.asset.quantity),
        growthValue: calculateGrowth(currentStats.asset.value, previousStats.asset.value),
        previousTotalQuantity: previousStats.asset.quantity,
        previousTotalValue: previousStats.asset.value,
      },
      products: {
        totalQuantity: currentStats.product.quantity,
        totalValue: currentStats.product.value,
        growthQuantity: calculateGrowth(currentStats.product.quantity, previousStats.product.quantity),
        growthValue: calculateGrowth(currentStats.product.value, previousStats.product.value),
        previousTotalQuantity: previousStats.product.quantity,
        previousTotalValue: previousStats.product.value,
      }
    };

    // Phần 2: Status Statistics (Trạng thái và Giá trị)
    // Lấy trạng thái hiện tại thực tế của các items trong kho
    // Lưu ý: Đây là trạng thái hiện tại (real-time snapshot), nếu muốn lịch sử chính xác từng tháng phải lưu snapshot.
    // Ở đây ta lấy snapshot hiện tại đẻ đơn giản hoá, nhưng lọc theo items. 
    
    // Status Assets
    const assetStatuses = await this.assetRepository.createQueryBuilder('asset')
      .leftJoin('asset.assetStatus', 'status')
      .select('status.id', 'id')
      .addSelect('status.name', 'name')
      .addSelect('status.color_code', 'colorCode')
      .addSelect('COUNT(asset.id)', 'count')
      .addSelect('SUM(asset.value * asset.current_stock)', 'value') // Giá trị tồn kho theo status
      .where('asset.store_id = :storeId', { storeId })
      .groupBy('status.id')
      .getRawMany();

    // Status Products
    const productStatuses = await this.productRepository.createQueryBuilder('product')
      .leftJoin('product.productStatus', 'status')
      .select('status.id', 'id')
      .addSelect('status.name', 'name')
      .addSelect('status.color_code', 'colorCode')
      .addSelect('COUNT(product.id)', 'count') // Số đầu mã hàng
      .addSelect('SUM(product.cost_price * product.current_stock)', 'value')
      .where('product.store_id = :storeId', { storeId })
      .groupBy('status.id')
      .getRawMany();

    const formatStatusStats = (raw: any[]) => raw.map(r => ({
      id: r.id,
      name: r.name,
      colorCode: r.colorCode,
      count: Number(r.count),
      value: Number(r.value) || 0,
      growthCount: 0, 
    }));



     // Phần 2b: Lịch sử báo hỏng/sửa chữa trong tháng (Dựa vào AssetStatus hoặc Transaction Type EXPORT type 'Hủy/Hỏng')
     // Tìm các transaction Export có exportType là 'Hủy' hoặc 'Thanh lý' hoặc 'Hỏng'
     // Giả sử ta dựa vào tên của ExportType có chứa chữ 'hỏng', 'hủy', 'sửa chữa'
     
     const damageStartDate = new Date(currentYear, currentMonth - 1, 1);
     const damageEndDate = new Date(currentYear, currentMonth, 0, 23, 59, 59);

     const damageHistoryQb = this.stockTransactionDetailRepository.createQueryBuilder('detail')
       .leftJoinAndSelect('detail.transaction', 'transaction')
       .leftJoinAndSelect('transaction.assetExportType', 'exportType')
       .leftJoinAndSelect('transaction.productExportType', 'pExportType')
       .where('transaction.store_id = :storeId', { storeId })
       .andWhere('transaction.type = :type', { type: StockTransactionType.EXPORT })
       .andWhere('transaction.transaction_date BETWEEN :start AND :end', { start: damageStartDate, end: damageEndDate })
       .andWhere('transaction.deleted_at IS NULL')
       // Lọc các loại xuất liên quan đến hư hỏng/mất mát
       .andWhere(
         `(LOWER(exportType.name) LIKE '%hỏng%' OR LOWER(exportType.name) LIKE '%hủy%' OR LOWER(exportType.name) LIKE '%mất%' OR
           LOWER(pExportType.name) LIKE '%hỏng%' OR LOWER(pExportType.name) LIKE '%hủy%' OR LOWER(pExportType.name) LIKE '%mất%')`
       );

      const damageRecords = await damageHistoryQb.getMany();
      
      const damageHistory: any[] = [];
      for (const record of damageRecords) {
         let itemName = '';
         let itemCode = '';
         if (record.assetId) {
             const asset = await this.assetRepository.findOne({ where: {id: record.assetId }});
             itemName = asset?.name || '';
             itemCode = asset?.code || '';
         } else if (record.productId) {
             const prod = await this.productRepository.findOne({ where: {id: record.productId }});
             itemName = prod?.name || '';
             itemCode = prod?.sku || '';
         }

         damageHistory.push({
             id: record.id,
             transactionDate: record.transaction.transactionDate,
             itemName,
             itemCode,
             quantity: record.quantity,
             reason: record.transaction.assetExportType?.name || record.transaction.productExportType?.name || '',
             totalLossValue: Number(record.totalPrice) || 0
         });
      }



    return {
      overview: {
        month: `${currentMonth}/${currentYear}`,
        assets: summary.assets,
        products: summary.products
      },
      statusDistribution: {
        assets: formatStatusStats(assetStatuses),
        products: formatStatusStats(productStatuses)
      },
      damageReport: {
        totalDamageValue: damageHistory.reduce((sum, item) => sum + Number(item.totalLossValue), 0),
        history: damageHistory
      }
    };
  }

  async createDefaultInternalRules(storeId: string) {
    const rule = this.internalRuleRepository.create({
      storeId: storeId,
      files: [],
      isRequiredView: false,
    } as any) as any;
    await this.internalRuleRepository.save(rule);
  }

  async getInternalRule(storeId: string) {
    let rule = await this.internalRuleRepository.findOne({
      where: { storeId },
    });

    if (!rule) {
      rule = this.internalRuleRepository.create({ storeId, files: [] });
      await this.internalRuleRepository.save(rule);
    }

    return rule;
  }

  async upsertInternalRule(
    storeId: string,
    data: UpdateInternalRuleDto,
    newFiles?: Express.Multer.File[],
  ) {
    let rule = await this.internalRuleRepository.findOne({
      where: { storeId },
    });

    if (!rule) {
      rule = this.internalRuleRepository.create({
        storeId,
        files: [],
        isRequiredView: false,
      } as any) as any;
    }

    if (!rule) {
      throw new Error('Failed to initialize internal rule record');
    }

    const { existingFiles, ...otherData } = data;
    const combinedFiles = [...(existingFiles || [])];

    if (newFiles && newFiles.length > 0) {
      newFiles.forEach((file) => {
        combinedFiles.push({
          name: file.originalname,
          url: `/uploads/${file.filename}`,
          type: file.mimetype.split('/')[1] || 'unknown',
          size: file.size,
          key: file.filename,
        });
      });
    }

    Object.assign(rule, {
      ...otherData,
      files: combinedFiles,
    });

    return this.internalRuleRepository.save(rule);
  }

  // --- Permission Config Management (Templates) ---

  async getPermissionTemplates(storeId: string) {
    return this.permissionConfigRepository.find({
      where: { storeId, roleId: IsNull() }, // Template has roleId = null
    });
  }

  async getPermissionConfig(configId: string) {
    return this.permissionConfigRepository.findOne({
      where: { id: configId },
    });
  }

  async getRolePermissionConfig(storeId: string, roleId: string) {
    const config = await this.permissionConfigRepository.findOne({
      where: { storeId, roleId },
    });
    if (!config) throw new NotFoundException('Không tìm thấy cấu hình phân quyền cho vai trò này');
    return config;
  }

  async updateRolePermissionConfig(storeId: string, roleId: string, data: StorePermissionConfigDto) {
    let config = await this.permissionConfigRepository.findOne({
      where: { storeId, roleId },
    });

    if (!config) {
      // Nếu chưa có thì tạo mới (Upsert)
      config = this.permissionConfigRepository.create({
        storeId,
        roleId,
        name: `Permissions for role ${roleId}`,
      });
    }

    Object.assign(config, data);
    return this.permissionConfigRepository.save(config);
  }

  // --- Store Shift Config ---
  async createDefaultShiftConfig(storeId: string) {
    const defaultConfig = this.shiftConfigRepository.create({
      storeId,
      daysOff: [WeekDay.SATURDAY, WeekDay.SUNDAY],
      noApprovalDays: [WeekDay.SATURDAY, WeekDay.SUNDAY],
      timekeepingRequirement: TimekeepingRequirement.LOCATION_QR_GPS_FACEID,
      isActive: true,
    });
    return this.shiftConfigRepository.save(defaultConfig);
  }

  async getShiftConfig(storeId: string) {
    let config = await this.shiftConfigRepository.findOne({ where: { storeId } });
    if (!config) {
      config = await this.createDefaultShiftConfig(storeId);
    }
    return config;
  }

  async upsertShiftConfig(storeId: string, data: UpdateStoreShiftConfigDto) {
    let config = await this.shiftConfigRepository.findOne({ where: { storeId } });

    if (config) {
      Object.assign(config, data);
    } else {
      config = this.shiftConfigRepository.create({
        ...data,
        storeId,
      });
    }

    return this.shiftConfigRepository.save(config);
  }

  async createRole(storeId: string, data: any) {
    // 1. Create Role
    const role = this.roleRepository.create({
      storeId,
      ...data,
    } as any);
    const savedRole = await this.roleRepository.save(role) as unknown as StoreRole;

    // 2. Tự động tạo bảng Permission riêng cho Role này (mặc định lấy quyền Nhân viên làm gốc)
    const initialPermissions = this.getDefaultStaffPermissions();

    const newConfig = this.permissionConfigRepository.create({
        storeId,
        roleId: savedRole.id,
        name: `Permissions for ${savedRole.name}`,
        ...initialPermissions
    } as any);
    const savedConfig = await this.permissionConfigRepository.save(newConfig) as unknown as StorePermissionConfig;

    // Link back 
    savedRole.permissionConfigId = savedConfig.id;
    return this.roleRepository.save(savedRole);
  }

  async migrateRolesPermissions() {
    const roles = await this.roleRepository.find({
      relations: ['permissionConfig'],
    });

    let migratedCount = 0;
    for (const role of roles) {
      if (!role.permissionConfigId) {
        // Create default config
        const config = this.permissionConfigRepository.create({
          storeId: role.storeId,
          roleId: role.id,
          name: `Permissions for ${role.name}`,
          ...this.getDefaultStaffPermissions(),
        } as any);
        const savedConfig = await this.permissionConfigRepository.save(config) as unknown as StorePermissionConfig;
        
        // Link back
        role.permissionConfigId = savedConfig.id;
        await this.roleRepository.save(role);
        migratedCount++;
      }
    }
    return { migratedCount };
  }

  async getRoles(storeId: string) {
    return this.roleRepository.find({
      where: { storeId, isActive: true },
      order: { createdAt: 'ASC' },
      relations: ['permissionConfig'], 
    });
  }

  // HARD-CODED DEFAULTS

  // HARD-CODED DEFAULTS

  private getDefaultOwnerPermissions() {
    return {
      schedule: { viewPersonalOnly: false, requestOffAndChange: true, viewGeneralSchedule: true, manageSchedule: true, approveRequests: true },
      timekeeping: { editTimeSheet: true, viewPersonalTimeSheet: true, sendDispute: true, viewOtherTimeSheet: true, approveTimeSheet: true },
      hr: { viewPersonalWorkAndKpi: true, viewShiftStaffList: true, viewAllStaff: true, assignWorkInShift: true, assignShiftLeader: true, assignSupervisor: true, createRecruitment: true, approveCandidate: true },
      asset: { viewAssetAndWarehouse: true, manageAssetAndWarehouse: true, proposeSupplies: true, manageSupplies: true },
      salary: { viewPersonalSalaryAndBonus: true, proposeSalaryEdit: true, approveSubordinateSalary: true, manageStaffPayroll: true, assignPayrollAccess: true },
      content: { createPost: true, commentInGroups: true, approveContent: true, tagAndWarnViolation: true, reportContent: true, manageMembers: true },
      report: { viewPersonalShiftReport: true, submitImprovementProposal: true, viewStaffPerformanceReport: true, viewStaffSalaryReport: true, viewViolationAnalysis: true, viewSummaryStaffReport: true },
      system: { editStaffPermission: true, evaluateStaffCapacity: true, editShiftLeaderPermission: true, editSupervisorPermission: true, editManagerPermission: true },
      employeeNotification: { remindAttendance: true, remindAttendanceMinutes: 30, allowLate: true, allowLateMinutes: 5, notifyAbnormalAbsence: true, notifyAttendanceIssue: true, notifySystemError: true, notifyRequestApproved: true, notifyNewInfoFromSuperior: true, notifyAbnormalOrders: true, notifyLowKpi: true, notifyLowKpiDays: 3, notifySalary: true, notifyNonStandardContent: true },
      shiftLeaderNotification: { remindShiftAssignment: true, notifyManagerShortage: true, reportShiftPerformance: true, notifyStaffViolationInShift: true, notifyOrderIssue: true, remindEndShiftReport: true },
      managerNotification: { notifyKpiDropStore: true, remindPermissionReview: true, notifyContinuousViolation: true, notifyContinuousViolationCount: 3, notifyContinuousPerformanceDrop: true, notifyContinuousPerformanceDropCount: 3, notifySalaryLate: true, notifyEmptyShift: true, remindApproveRequest: true, remindApproveRequestDays: 1 },
      storeNotification: { notifyShiftShortageToday: true, notifyUnannouncedAbsence: true, notifyResignationSign: true, remindUnreadNotifications: true, remindNewSchedule: true, remindNewScheduleDays: 1, notifyContinuousPerformanceDropDays: 3, notifyContinuousKpiDropDays: 3, notifyIndividualLowKpiDays: 3, notifyQualitySupervisorDropDays: 3, remindAssetInventory: true, remindAssetInventoryDays: 3 },
    };
  }

  private getDefaultManagerPermissions() {
    return {
      schedule: { viewPersonalOnly: false, requestOffAndChange: true, viewGeneralSchedule: true, manageSchedule: true, approveRequests: true },
      timekeeping: { editTimeSheet: false, viewPersonalTimeSheet: true, sendDispute: true, viewOtherTimeSheet: true, approveTimeSheet: true },
      hr: { viewPersonalWorkAndKpi: true, viewShiftStaffList: true, viewAllStaff: true, assignWorkInShift: true, assignShiftLeader: false, assignSupervisor: false, createRecruitment: false, approveCandidate: false },
      asset: { viewAssetAndWarehouse: true, manageAssetAndWarehouse: true, proposeSupplies: true, manageSupplies: false },
      salary: { viewPersonalSalaryAndBonus: true, proposeSalaryEdit: true, approveSubordinateSalary: false, manageStaffPayroll: false, assignPayrollAccess: false },
      content: { createPost: true, commentInGroups: true, approveContent: false, tagAndWarnViolation: true, reportContent: true, manageMembers: false },
      report: { viewPersonalShiftReport: true, submitImprovementProposal: true, viewStaffPerformanceReport: true, viewStaffSalaryReport: false, viewViolationAnalysis: true, viewSummaryStaffReport: false },
      system: { editStaffPermission: false, evaluateStaffCapacity: true, editShiftLeaderPermission: false, editSupervisorPermission: false, editManagerPermission: false },
      employeeNotification: { remindAttendance: true, remindAttendanceMinutes: 30, allowLate: true, allowLateMinutes: 10, notifyAbnormalAbsence: true, notifyAttendanceIssue: true, notifySystemError: true, notifyRequestApproved: true, notifyNewInfoFromSuperior: true, notifyAbnormalOrders: true, notifyLowKpi: true, notifyLowKpiDays: 3, notifySalary: true, notifyNonStandardContent: true },
      shiftLeaderNotification: { remindShiftAssignment: true, notifyManagerShortage: true, reportShiftPerformance: true, notifyStaffViolationInShift: true, notifyOrderIssue: true, remindEndShiftReport: true },
      managerNotification: { notifyKpiDropStore: true, remindPermissionReview: true, notifyContinuousViolation: true, notifyContinuousViolationCount: 3, notifyContinuousPerformanceDrop: true, notifyContinuousPerformanceDropCount: 3, notifySalaryLate: true, notifyEmptyShift: true, remindApproveRequest: true, remindApproveRequestDays: 1 },
      storeNotification: { notifyShiftShortageToday: true, notifyUnannouncedAbsence: true, notifyResignationSign: true, remindUnreadNotifications: true, remindNewSchedule: true, remindNewScheduleDays: 1, notifyContinuousPerformanceDropDays: 3, notifyContinuousKpiDropDays: 3, notifyIndividualLowKpiDays: 3, notifyQualitySupervisorDropDays: 3, remindAssetInventory: true, remindAssetInventoryDays: 3 },
    };
  }

  private getDefaultStaffPermissions() {
    return {
      schedule: { viewPersonalOnly: true, requestOffAndChange: true, viewGeneralSchedule: true, manageSchedule: false, approveRequests: false },
      timekeeping: { editTimeSheet: false, viewPersonalTimeSheet: true, sendDispute: true, viewOtherTimeSheet: false, approveTimeSheet: false },
      hr: { viewPersonalWorkAndKpi: true, viewShiftStaffList: true, viewAllStaff: false, assignWorkInShift: false, assignShiftLeader: false, assignSupervisor: false, createRecruitment: false, approveCandidate: false },
      asset: { viewAssetAndWarehouse: true, manageAssetAndWarehouse: false, proposeSupplies: true, manageSupplies: false },
      salary: { viewPersonalSalaryAndBonus: true, proposeSalaryEdit: true, approveSubordinateSalary: false, manageStaffPayroll: false, assignPayrollAccess: false },
      content: { createPost: true, commentInGroups: true, approveContent: false, tagAndWarnViolation: false, reportContent: true, manageMembers: false },
      report: { viewPersonalShiftReport: true, submitImprovementProposal: true, viewStaffPerformanceReport: false, viewStaffSalaryReport: false, viewViolationAnalysis: false, viewSummaryStaffReport: false },
      system: { editStaffPermission: false, evaluateStaffCapacity: false, editShiftLeaderPermission: false, editSupervisorPermission: false, editManagerPermission: false },
      employeeNotification: { remindAttendance: true, remindAttendanceMinutes: 30, allowLate: true, allowLateMinutes: 5, notifyAbnormalAbsence: false, notifyAttendanceIssue: true, notifySystemError: true, notifyRequestApproved: true, notifyNewInfoFromSuperior: true, notifyAbnormalOrders: false, notifyLowKpi: true, notifyLowKpiDays: 3, notifySalary: true, notifyNonStandardContent: false },
      shiftLeaderNotification: { remindShiftAssignment: false, notifyManagerShortage: false, reportShiftPerformance: false, notifyStaffViolationInShift: false, notifyOrderIssue: false, remindEndShiftReport: false },
      managerNotification: { notifyKpiDropStore: false, remindPermissionReview: false, notifyContinuousViolation: false, notifyContinuousViolationCount: 0, notifyContinuousPerformanceDrop: false, notifyContinuousPerformanceDropCount: 0, notifySalaryLate: false, notifyEmptyShift: false, remindApproveRequest: false, remindApproveRequestDays: 0 },
      storeNotification: { notifyShiftShortageToday: false, notifyUnannouncedAbsence: false, notifyResignationSign: false, remindUnreadNotifications: false, remindNewSchedule: false, remindNewScheduleDays: 0, notifyContinuousPerformanceDropDays: 0, notifyContinuousKpiDropDays: 0, notifyIndividualLowKpiDays: 0, notifyQualitySupervisorDropDays: 0, remindAssetInventory: false, remindAssetInventoryDays: 0 },
    };
  }

  // Employee Report (Staff-facing)
  async getEmployeeDailyReport(storeId: string, employeeProfileId: string, dateStr?: string) {
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    const dateString = targetDate.toISOString().split('T')[0];

    // Get shift assignments for this employee on this date
    const assignments = await this.shiftAssignmentRepository
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.shiftSlot', 'slot')
      .where('a.employeeId = :employeeProfileId', { employeeProfileId })
      .andWhere('CAST(slot.workDate AS DATE) = :dateString', { dateString })
      .getMany();

    let totalMinutes = 0;
    let checkIn = '--:--';
    let checkOut = '--:--';
    let warning = '';
    const shiftsCount = assignments.length;

    if (assignments.length > 0) {
      assignments.forEach((a: any) => {
        if (a.checkInTime) {
          const cin = new Date(a.checkInTime);
          checkIn = `${String(cin.getHours()).padStart(2, '0')}:${String(cin.getMinutes()).padStart(2, '0')}`;
        }
        if (a.checkOutTime) {
          const cout = new Date(a.checkOutTime);
          checkOut = `${String(cout.getHours()).padStart(2, '0')}:${String(cout.getMinutes()).padStart(2, '0')}`;
        }
        totalMinutes += Number(a.workedMinutes || 0);

        if (a.status === 'LATE') {
          warning = `Vào ca trễ hôm nay`;
        }
      });
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    // Calculate income from real-time shiftEarnings (per-shift basis)
    const dailyShiftEarnings = assignments
      .filter((a: any) => a.shiftEarnings != null)
      .reduce((sum: number, a: any) => sum + Number(a.shiftEarnings), 0);
    const hasRealTimeEarnings = assignments.some((a: any) => a.shiftEarnings != null);

    let dailyIncome = 0;
    if (hasRealTimeEarnings) {
      dailyIncome = Math.round(dailyShiftEarnings);
    } else {
      // Fallback: estimate from batch EmployeeSalary
      const salaryMonthDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
      const salaries = await this.employeeSalaryRepository.find({
        where: { employeeProfileId, month: salaryMonthDate } as any,
      });
      const daysInMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
      dailyIncome = salaries.length > 0 ? Math.round(Number(salaries[0].netSalary || 0) / daysInMonth) : 0;
    }

    return {
      income: dailyIncome,
      trendPercent: 0,
      trendUp: false,
      shifts: shiftsCount,
      hours,
      minutes,
      checkIn,
      checkOut,
      warning,
    };
  }

  async getEmployeeMonthlyReport(storeId: string, employeeProfileId: string, monthStr?: string) {
    const now = new Date();
    const month = monthStr || `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    // Parse month string (MM/YYYY or YYYY-MM-DD) into m/y
    let mNum: number, yNum: number;
    if (month.includes('/')) {
      [mNum, yNum] = month.split('/').map(Number);
    } else {
      const d = new Date(month);
      mNum = d.getMonth() + 1;
      yNum = d.getFullYear();
    }
    // Use Date object for salary month query
    const salaryMonthDate = new Date(yNum, mNum - 1, 1);

    // Get salary info
    const salaries = await this.employeeSalaryRepository.find({
      where: { employeeProfileId, month: salaryMonthDate } as any,
      relations: ['monthlyPayroll'],
    });

    const salary = salaries.length > 0 ? salaries[0] : null;

    // Get shift assignments for the month
    const startDate = new Date(yNum, mNum - 1, 1).toISOString().split('T')[0];
    const endDate = new Date(yNum, mNum, 0).toISOString().split('T')[0];

    const assignments = await this.shiftAssignmentRepository
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.shiftSlot', 'slot')
      .where('a.employeeId = :employeeProfileId', { employeeProfileId })
      .andWhere('CAST(slot.workDate AS DATE) >= :startDate', { startDate })
      .andWhere('CAST(slot.workDate AS DATE) <= :endDate', { endDate })
      .getMany();

    let totalMinutes = 0;
    let totalShiftEarnings = 0;
    let hasRealTimeEarnings = false;
    assignments.forEach((a: any) => {
      totalMinutes += Number(a.workedMinutes || 0);
      if (a.shiftEarnings != null) {
        totalShiftEarnings += Number(a.shiftEarnings);
        hasRealTimeEarnings = true;
      }
    });

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    // Use real-time earnings if available, fallback to batch EmployeeSalary
    let income = 0;
    let estimatedMonthly = 0;
    let bonus = 0;
    let penalty = 0;

    if (hasRealTimeEarnings) {
      income = Math.round(totalShiftEarnings);
      estimatedMonthly = income;
    }

    if (!hasRealTimeEarnings || salary) {
      // Supplement with batch data for bonus/penalty + fallback income
      if (salary) {
        bonus = Number(salary.bonus || 0);
        penalty = Number(salary.penalty || 0);
        if (!hasRealTimeEarnings) {
          income = Number(salary.netSalary || 0);
          estimatedMonthly = income;
        }
      }
    }

    return {
      todaySummary: assignments.length > 0 ? 'Dữ liệu tháng này' : 'Chưa có dữ liệu',
      shifts: assignments.length,
      hours,
      minutes,
      income,
      incomeTrendUp: false,
      bonus,
      bonusTrendUp: false,
      penalty,
      penaltyTrendUp: false,
      estimatedMonthly,
      motivationText: assignments.length >= 20 ? 'Đang tiến triển tốt, hãy tiếp tục duy trì nhé' : 'Hãy cố gắng thêm nhé!',
    };
  }

  async getEmployeeShiftHours(storeId: string, employeeProfileId: string, monthStr?: string, filter?: string) {
    const now = new Date();
    let m: number, y: number;
    if (monthStr) {
      [m, y] = monthStr.split('/').map(Number);
    } else {
      m = now.getMonth() + 1;
      y = now.getFullYear();
    }
    const startDate = new Date(y, m - 1, 1).toISOString().split('T')[0];
    const endDate = new Date(y, m, 0).toISOString().split('T')[0];

    const query = this.shiftAssignmentRepository
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.shiftSlot', 'slot')
      .where('a.employeeId = :employeeProfileId', { employeeProfileId })
      .andWhere('CAST(slot.workDate AS DATE) >= :startDate', { startDate })
      .andWhere('CAST(slot.workDate AS DATE) <= :endDate', { endDate })
      .orderBy('slot.workDate', 'DESC');

    const assignments = await query.getMany();

    // Aggregate counts by status
    const tabCounts: Record<string, number> = {
      all: assignments.length,
      on_time: 0,
      overtime: 0,
      forgot: 0,
      late: 0,
      early: 0,
      leave: 0,
      absent: 0,
    };

    let totalMinutes = 0;
    const shifts = assignments.map((a: any) => {
      const slot = a.shiftSlot;
      const dateObj = slot?.workDate ? new Date(slot.workDate) : new Date();
      const dayNames = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
      const dayLabel = `${dayNames[dateObj.getDay()]}, ${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${String(dateObj.getFullYear()).slice(2)}`;
      const shiftName = slot?.name || slot?.id?.slice(0, 8) || 'Ca làm';

      let status = 'Đúng giờ';
      let statusColor = '#12B569';
      const assignStatus = (a.status || '').toUpperCase();

      if (assignStatus === 'LATE' || assignStatus === 'CHECKED_IN_LATE') {
        status = 'Đi trễ';
        statusColor = '#F78F08';
        tabCounts.late++;
      } else if (assignStatus === 'EARLY' || assignStatus === 'LEFT_EARLY') {
        status = 'Về sớm';
        statusColor = '#F78F08';
        tabCounts.early++;
      } else if (assignStatus === 'ABSENT') {
        status = 'Nghỉ không phép';
        statusColor = '#F95555';
        tabCounts.absent++;
      } else if (assignStatus === 'LEAVE') {
        status = 'Nghỉ phép';
        statusColor = '#3B82F6';
        tabCounts.leave++;
      } else if (assignStatus === 'OVERTIME') {
        status = 'Tăng ca';
        statusColor = '#8B5CF6';
        tabCounts.overtime++;
      } else if (assignStatus === 'FORGOT') {
        status = 'Quên chấm công';
        statusColor = '#F95555';
        tabCounts.forgot++;
      } else {
        tabCounts.on_time++;
      }

      const workedMins = Number(a.workedMinutes || 0);
      totalMinutes += workedMins;
      const h = Math.floor(workedMins / 60);
      const mins = workedMins % 60;

      return {
        id: a.id,
        dayLabel,
        shiftName,
        status,
        statusColor,
        hours: `${h}:${String(mins).padStart(2, '0')}`,
      };
    });

    // Filter if needed
    let filteredShifts = shifts;
    if (filter && filter !== 'all') {
      const statusMap: Record<string, string> = {
        on_time: 'Đúng giờ',
        overtime: 'Tăng ca',
        forgot: 'Quên chấm công',
        late: 'Đi trễ',
        early: 'Về sớm',
        leave: 'Nghỉ phép',
        absent: 'Nghỉ không phép',
      };
      filteredShifts = shifts.filter(s => s.status === statusMap[filter]);
    }

    return {
      completedShifts: tabCounts.on_time + tabCounts.overtime,
      totalHours: Math.floor(totalMinutes / 60),
      totalMinutes: totalMinutes % 60,
      shiftsTrend: 0,
      hoursTrend: 0,
      shifts: filteredShifts,
      tabCounts,
    };
  }

  // Leave Request Management (Staff)
  async createLeaveRequest(data: Partial<EmployeeLeaveRequest>, files?: Express.Multer.File[]) {
    const attachments: string[] = [];
    if (files && files.length > 0) {
      files.forEach((file) => {
        attachments.push(`/uploads/${file.filename}`);
      });
    }

    const leaveRequest = this.leaveRequestRepository.create({
      ...data,
      attachments: attachments.length > 0 ? attachments : (data.attachments || []),
      status: LeaveRequestStatus.PENDING,
    });
    return this.leaveRequestRepository.save(leaveRequest);
  }

  async getLeaveRequestsByEmployee(employeeProfileId: string) {
    return this.leaveRequestRepository.find({
      where: { employeeProfileId },
      order: { createdAt: 'DESC' },
      relations: ['approvedBy', 'approvedBy.account'],
    });
  }

  async getLeaveRequestsByStore(storeId: string, status?: LeaveRequestStatus) {
    const where: any = { storeId };
    if (status) where.status = status;
    return this.leaveRequestRepository.find({
      where,
      order: { createdAt: 'DESC' },
      relations: ['employeeProfile', 'employeeProfile.account', 'approvedBy', 'approvedBy.account'],
    });
  }

  async cancelLeaveRequest(id: string, employeeProfileId: string) {
    const request = await this.leaveRequestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Không tìm thấy đơn xin nghỉ');
    if (request.employeeProfileId !== employeeProfileId) {
      throw new BadRequestException('Bạn không có quyền hủy đơn này');
    }
    if (request.status !== LeaveRequestStatus.PENDING) {
      throw new BadRequestException('Chỉ có thể hủy đơn đang chờ duyệt');
    }
    request.status = LeaveRequestStatus.CANCELLED;
    return this.leaveRequestRepository.save(request);
  }

  // ===== Shift Change Request Management =====
  async createShiftChangeRequest(data: {
    storeId: string;
    employeeProfileId: string;
    currentShiftId?: string;
    requestedShiftId?: string;
    requestDate: string;
    reason?: string;
    attachments?: string[];
  }) {
    if (!data.currentShiftId && !data.requestedShiftId) {
      throw new BadRequestException('Phải cung cấp ca hiện tại hoặc ca muốn đổi');
    }

    const request = this.shiftChangeRequestRepository.create({
      storeId: data.storeId,
      employeeProfileId: data.employeeProfileId,
      currentShiftId: data.currentShiftId ?? undefined,
      requestedShiftId: data.requestedShiftId ?? undefined,
      requestDate: data.requestDate,
      reason: data.reason ?? undefined,
      attachments: data.attachments ? JSON.stringify(data.attachments) : null,
      status: ShiftChangeRequestStatus.PENDING,
    });
    return this.shiftChangeRequestRepository.save(request);
  }

  async getShiftChangeRequestsByEmployee(employeeProfileId: string) {
    return this.shiftChangeRequestRepository.find({
      where: { employeeProfileId },
      order: { createdAt: 'DESC' },
      relations: ['approvedBy', 'approvedBy.account'],
    });
  }

  async getShiftChangeRequestsByStore(storeId: string, status?: ShiftChangeRequestStatus) {
    const where: any = { storeId };
    if (status) where.status = status;
    return this.shiftChangeRequestRepository.find({
      where,
      order: { createdAt: 'DESC' },
      relations: ['employeeProfile', 'employeeProfile.account', 'approvedBy', 'approvedBy.account'],
    });
  }

  async approveShiftChangeRequest(id: string, approverId: string | undefined) {
    if (!approverId) throw new BadRequestException('Không xác định được người duyệt');
    const request = await this.shiftChangeRequestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Không tìm thấy yêu cầu đổi ca');
    request.status = ShiftChangeRequestStatus.APPROVED;
    request.approvedById = approverId ?? null;
    return this.shiftChangeRequestRepository.save(request);
  }

  async rejectShiftChangeRequest(id: string, approverId: string | undefined, reason?: string) {
    if (!approverId) throw new BadRequestException('Không xác định được người duyệt');
    const request = await this.shiftChangeRequestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Không tìm thấy yêu cầu đổi ca');
    request.status = ShiftChangeRequestStatus.REJECTED;
    request.approvedById = approverId ?? null;
    request.rejectionReason = reason ?? null;
    return this.shiftChangeRequestRepository.save(request);
  }

  async cancelShiftChangeRequest(id: string, employeeProfileId: string | undefined) {
    if (!employeeProfileId) throw new BadRequestException('Không xác định được nhân viên');
    const request = await this.shiftChangeRequestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Không tìm thấy yêu cầu đổi ca');
    if (request.employeeProfileId !== employeeProfileId) {
      throw new BadRequestException('Bạn không có quyền hủy yêu cầu này');
    }
    if (request.status !== ShiftChangeRequestStatus.PENDING) {
      throw new BadRequestException('Chỉ có thể hủy yêu cầu đang chờ duyệt');
    }
    request.status = ShiftChangeRequestStatus.CANCELLED;
    return this.shiftChangeRequestRepository.save(request);
  }

  // ===== Bonus Work Request Management =====
  async createBonusWorkRequest(data: {
    storeId: string;
    employeeProfileId: string;
    shiftSlotId?: string | null;
    requestDate: string;
    startTime?: string;
    endTime?: string;
    reason?: string;
    attachments?: string[];
  }) {
    const request = this.bonusWorkRequestRepository.create({
      storeId: data.storeId,
      employeeProfileId: data.employeeProfileId,
      shiftSlotId: data.shiftSlotId || undefined,
      requestDate: data.requestDate,
      startTime: data.startTime || undefined,
      endTime: data.endTime || undefined,
      reason: data.reason || undefined,
      attachments: data.attachments ? JSON.stringify(data.attachments) : null,
      status: BonusWorkRequestStatus.PENDING,
    });
    return this.bonusWorkRequestRepository.save(request);
  }

  async getBonusWorkRequestsByEmployee(employeeProfileId: string) {
    return this.bonusWorkRequestRepository.find({
      where: { employeeProfileId },
      order: { createdAt: 'DESC' },
      relations: ['approvedBy', 'approvedBy.account'],
    });
  }

  async getBonusWorkRequestsByStore(storeId: string, status?: BonusWorkRequestStatus) {
    const where: any = { storeId };
    if (status) where.status = status;
    return this.bonusWorkRequestRepository.find({
      where,
      order: { createdAt: 'DESC' },
      relations: ['employeeProfile', 'employeeProfile.account', 'approvedBy', 'approvedBy.account'],
    });
  }

  async approveBonusWorkRequest(id: string, approverId: string | undefined) {
    if (!approverId) throw new BadRequestException('Không xác định được người duyệt');
    const request = await this.bonusWorkRequestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Không tìm thấy yêu cầu bổ sung công');
    request.status = BonusWorkRequestStatus.APPROVED;
    request.approvedById = approverId ?? null;
    return this.bonusWorkRequestRepository.save(request);
  }

  async rejectBonusWorkRequest(id: string, approverId: string | undefined, reason?: string) {
    if (!approverId) throw new BadRequestException('Không xác định được người duyệt');
    const request = await this.bonusWorkRequestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Không tìm thấy yêu cầu bổ sung công');
    request.status = BonusWorkRequestStatus.REJECTED;
    request.approvedById = approverId ?? null;
    request.rejectionReason = reason ?? null;
    return this.bonusWorkRequestRepository.save(request);
  }

  async cancelBonusWorkRequest(id: string, employeeProfileId: string | undefined) {
    if (!employeeProfileId) throw new BadRequestException('Không xác định được nhân viên');
    const request = await this.bonusWorkRequestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Không tìm thấy yêu cầu bổ sung công');
    if (request.employeeProfileId !== employeeProfileId) {
      throw new BadRequestException('Bạn không có quyền hủy yêu cầu này');
    }
    if (request.status !== BonusWorkRequestStatus.PENDING) {
      throw new BadRequestException('Chỉ có thể hủy yêu cầu đang chờ duyệt');
    }
    request.status = BonusWorkRequestStatus.CANCELLED;
    return this.bonusWorkRequestRepository.save(request);
  }

  // Feedback Management
  async createFeedback(data: Partial<Feedback>, files?: Express.Multer.File[]) {
    const attachments: string[] = [];
    if (files && files.length > 0) {
      files.forEach((file) => {
        attachments.push(`/uploads/${file.filename}`);
      });
    }

    // Parse categories if string
    let categories = data.categories;
    if (typeof categories === 'string') {
      try {
        categories = JSON.parse(categories as any);
      } catch (e) {
        categories = [categories as any];
      }
    }

    const feedback = this.feedbackRepository.create({
      ...data,
      categories,
      attachments: attachments.length > 0 ? attachments : (data.attachments || []),
    });
    return this.feedbackRepository.save(feedback);
  }

  async getFeedbacks(filters: { storeId?: string; employeeProfileId?: string; accountId?: string; status?: FeedbackStatus } = {}) {
    const where: any = {};
    if (filters.storeId) where.storeId = filters.storeId;
    if (filters.employeeProfileId) where.employeeProfileId = filters.employeeProfileId;
    if (filters.accountId) where.accountId = filters.accountId;
    if (filters.status) where.status = filters.status;

    return this.feedbackRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async getFeedbackLeaderboard(storeId: string) {
    // Aggregate feedback count per employee for the store leaderboard
    const feedbacks = await this.feedbackRepository
      .createQueryBuilder('fb')
      .leftJoinAndSelect('fb.store', 'store')
      .where('fb.storeId = :storeId', { storeId })
      .andWhere('fb.employeeProfileId IS NOT NULL')
      .getMany();

    // Count feedbacks per employee
    const countMap: Record<string, number> = {};
    for (const fb of feedbacks) {
      const pid = fb.employeeProfileId;
      if (pid) countMap[pid] = (countMap[pid] || 0) + 1;
    }

    if (Object.keys(countMap).length === 0) return { podium: [], ranking: [] };

    // Load employee profiles with account info
    const profileIds = Object.keys(countMap);
    const profiles = await this.profileRepository.find({
      where: { id: In(profileIds) } as any,
      relations: ['account'],
    });

    // Tier calculation based on score ranges
    const getTier = (score: number) => {
      if (score >= 90) return { title: 'Visionary', badgeText: 'Tiên Phong Cải Tiến', tier: 'TIEN_PHONG' };
      if (score >= 60) return { title: 'Innovator', badgeText: 'Đồng Hành Sáng Tạo', tier: 'DONG_HANH' };
      if (score >= 40) return { title: 'Architech', badgeText: 'Đóng Góp Tâm Huyết', tier: 'TAM_HUYET' };
      if (score >= 20) return { title: 'Builder', badgeText: 'Tiềm Năng Đổi Mới', tier: 'TIEM_NANG' };
      return { title: 'Contributor', badgeText: 'Khởi Đầu Cùng Bạn', tier: 'KHOI_DAU' };
    };

    const leaderboard = profiles
      .map((p: any) => {
        const score = Number(((countMap[p.id] || 0) * 10).toFixed(1));
        const tier = getTier(score);
        return {
          id: p.id,
          name: p.account?.name || 'Nhân viên',
          score,
          avatar: p.account?.avatar || null,
          ...tier,
        };
      })
      .sort((a, b) => b.score - a.score);

    return {
      podium: leaderboard.slice(0, 3).map((item, idx) => ({
        ...item,
        rank: idx + 1,
      })),
      ranking: leaderboard.slice(3),
    };
  }

  async recordCheckoutMood(assignmentId: string, mood: string, note?: string) {
    const assignment = await this.shiftAssignmentRepository.findOne({ where: { id: assignmentId } });
    if (!assignment) return { success: false, message: 'Assignment not found' };

    // Store mood as JSON in a generic field (metadata or note)
    // We use the existing 'notes' or patch via metadata approach
    (assignment as any).checkoutMood = mood;
    (assignment as any).checkoutNote = note || '';
    await this.shiftAssignmentRepository.save(assignment);
    return { success: true, mood, note };
  }


  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ATTENDANCE & FACE RECOGNITION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async checkInWithFace(
    assignmentId: string,
    imageBuffer: Buffer,
    options?: { latitude?: number; longitude?: number; qrStoreId?: string },
  ) {
    const assignment = await this.shiftAssignmentRepository.findOne({
      where: { id: assignmentId },
      relations: ['shiftSlot', 'shiftSlot.workShift', 'shiftSlot.cycle', 'employee'],
    });
    if (!assignment) throw new NotFoundException('Shift assignment not found');
    if (assignment.checkInTime) throw new BadRequestException('Already checked in');
    if (assignment.status !== ShiftAssignmentStatus.APPROVED) {
      throw new BadRequestException('Ca làm việc chưa được chấp thuận. Vui lòng chờ chủ cửa hàng duyệt.');
    }

    const storeId = assignment.shiftSlot?.cycle?.storeId;

    // ===== Step 1: QR Verification =====
    if (options?.qrStoreId && storeId) {
      if (options.qrStoreId !== storeId) {
        throw new BadRequestException('Mã QR không khớp với cửa hàng của ca làm việc này');
      }
      this.logger.debug(`[CheckIn] QR verified — storeId match`);
    }

    // ===== Step 2: Face Verification =====
    const employeeFace = await this.employeeFaceRepository.findOne({
      where: { employeeProfileId: assignment.employeeId, isActive: true },
    });
    if (!employeeFace || employeeFace.faceDescriptors.length === 0) {
      throw new BadRequestException('Face not registered. Please register your face first.');
    }

    const descriptor = await this.faceRecognitionService.extractDescriptor(imageBuffer);
    if (!descriptor) {
      return { matched: false, message: 'No face detected in image' };
    }

    const matchResult = this.faceRecognitionService.compareFaces(descriptor, employeeFace.faceDescriptors);
    if (!matchResult.matched) {
      return { matched: false, distance: matchResult.distance, message: 'Face does not match' };
    }
    this.logger.debug(`[CheckIn] Face verified — distance=${matchResult.distance}`);

    // ===== Step 3: GPS — record distance only (never block) =====
    let checkinDistance: number | null = null;
    let checkinLatitude: number | null = null;
    let checkinLongitude: number | null = null;

    if (options?.latitude != null && options?.longitude != null) {
      checkinLatitude = options.latitude;
      checkinLongitude = options.longitude;

      if (storeId) {
        const store = await this.storeRepository.findOne({ where: { id: storeId } });
        if (store?.latitude != null && store?.longitude != null) {
          checkinDistance = this.calculateDistance(
            options.latitude, options.longitude,
            store.latitude, store.longitude,
          );
          this.logger.debug(`[CheckIn] GPS recorded — distance=${Math.round(checkinDistance)}m`);
        }
      }
    }

    // Calculate late minutes
    const now = new Date();
    const workShift = assignment.shiftSlot?.workShift;
    let lateMinutes = 0;

    if (workShift?.startTime) {
      const [h, m] = workShift.startTime.split(':').map(Number);
      const shiftStart = new Date(now);
      shiftStart.setHours(h, m, 0, 0);
      lateMinutes = Math.max(0, Math.floor((now.getTime() - shiftStart.getTime()) / 60000));
    }

    const attendanceStatus = lateMinutes > 0 ? AttendanceStatus.LATE : AttendanceStatus.ON_TIME;

    // Update assignment
    assignment.checkInTime = now;
    assignment.lateMinutes = lateMinutes;
    assignment.attendanceStatus = attendanceStatus;
    assignment.status = ShiftAssignmentStatus.CONFIRMED;
    await this.shiftAssignmentRepository.save(assignment);

    // Fix 2: Sync workingStatus → WORKING
    try {
      await this.profileRepository.update(assignment.employeeId, {
        workingStatus: WorkingStatus.WORKING,
      });
    } catch (err) {
      this.logger.warn(`[CheckIn] workingStatus sync failed: ${err?.message}`);
    }

    // Create audit log with GPS data
    const checkInLog = new AttendanceLog();
    checkInLog.shiftAssignmentId = assignmentId;
    checkInLog.employeeProfileId = assignment.employeeId;
    checkInLog.storeId = storeId ?? '';
    checkInLog.type = AttendanceLogType.CHECK_IN;
    checkInLog.timestamp = now;
    checkInLog.method = AttendanceMethod.FACE;
    checkInLog.faceMatchScore = matchResult.distance;
    if (checkinLatitude != null) checkInLog.checkinLatitude = checkinLatitude;
    if (checkinLongitude != null) checkInLog.checkinLongitude = checkinLongitude;
    if (checkinDistance != null) checkInLog.checkinDistance = checkinDistance;
    await this.attendanceLogRepository.save(checkInLog);

    // Ghi nhận đi trễ vào DailyEmployeeReport
    if (lateMinutes > 0 && storeId) {
      this.appendToDailyReport(storeId, 'lateArrivals', assignment.employeeId);
    }

    return {
      matched: true,
      distance: matchResult.distance,
      lateMinutes,
      attendanceStatus,
      checkInTime: now.toISOString(),
      gpsDistance: checkinDistance != null ? Math.round(checkinDistance) : null,
    };
  }

  async checkOutWithFace(
    assignmentId: string,
    imageBuffer: Buffer,
    options?: { latitude?: number; longitude?: number; qrStoreId?: string },
  ) {
    const assignment = await this.shiftAssignmentRepository.findOne({
      where: { id: assignmentId },
      relations: ['shiftSlot', 'shiftSlot.workShift', 'shiftSlot.cycle', 'employee'],
    });
    if (!assignment) throw new NotFoundException('Shift assignment not found');
    if (!assignment.checkInTime) throw new BadRequestException('Must check in first');
    if (assignment.checkOutTime) throw new BadRequestException('Already checked out');

    const storeId = assignment.shiftSlot?.cycle?.storeId;

    // ===== Step 1: QR Verification =====
    if (options?.qrStoreId && storeId) {
      if (options.qrStoreId !== storeId) {
        throw new BadRequestException('Mã QR không khớp với cửa hàng của ca làm việc này');
      }
      this.logger.debug(`[CheckOut] QR verified — storeId match`);
    }

    // ===== Step 2: Face Verification =====
    const employeeFace = await this.employeeFaceRepository.findOne({
      where: { employeeProfileId: assignment.employeeId, isActive: true },
    });
    if (!employeeFace || employeeFace.faceDescriptors.length === 0) {
      throw new BadRequestException('Face not registered');
    }

    const descriptor = await this.faceRecognitionService.extractDescriptor(imageBuffer);
    if (!descriptor) {
      return { matched: false, message: 'No face detected in image' };
    }

    const matchResult = this.faceRecognitionService.compareFaces(descriptor, employeeFace.faceDescriptors);
    if (!matchResult.matched) {
      return { matched: false, distance: matchResult.distance, message: 'Face does not match' };
    }
    this.logger.debug(`[CheckOut] Face verified — distance=${matchResult.distance}`);

    // ===== Step 3: GPS — record distance only (never block) =====
    let checkinDistance: number | null = null;
    let checkinLatitude: number | null = null;
    let checkinLongitude: number | null = null;

    if (options?.latitude != null && options?.longitude != null) {
      checkinLatitude = options.latitude;
      checkinLongitude = options.longitude;

      if (storeId) {
        const store = await this.storeRepository.findOne({ where: { id: storeId } });
        if (store?.latitude != null && store?.longitude != null) {
          checkinDistance = this.calculateDistance(
            options.latitude, options.longitude,
            store.latitude, store.longitude,
          );
          this.logger.debug(`[CheckOut] GPS recorded — distance=${Math.round(checkinDistance)}m`);
        }
      }
    }

    // Calculate early minutes and worked minutes
    const now = new Date();
    const workShift = assignment.shiftSlot?.workShift;
    let earlyMinutes = 0;

    if (workShift?.endTime) {
      const [h, m] = workShift.endTime.split(':').map(Number);
      const shiftEnd = new Date(now);
      shiftEnd.setHours(h, m, 0, 0);
      earlyMinutes = Math.max(0, Math.floor((shiftEnd.getTime() - now.getTime()) / 60000));
    }

    const workedMinutes = Math.floor(
      (now.getTime() - new Date(assignment.checkInTime).getTime()) / 60000,
    );

    // Determine final attendance status
    let attendanceStatus = assignment.attendanceStatus || AttendanceStatus.ON_TIME;
    if (assignment.lateMinutes > 0 && earlyMinutes > 0) {
      attendanceStatus = AttendanceStatus.LATE_AND_EARLY;
    } else if (earlyMinutes > 0) {
      attendanceStatus = AttendanceStatus.EARLY;
    }

    // Update assignment
    assignment.checkOutTime = now;
    assignment.earlyMinutes = earlyMinutes;
    assignment.workedMinutes = workedMinutes;
    assignment.attendanceStatus = attendanceStatus;
    assignment.status = ShiftAssignmentStatus.COMPLETED;

    // ===== Real-time Payroll: Calculate shift earnings =====
    let shiftEarnings: number | null = null;
    try {
      const employeeProfile = await this.profileRepository.findOne({
        where: { id: assignment.employeeId },
        relations: ['contracts'],
      });
      const activeContract = employeeProfile?.contracts?.find(c => c.isActive);

      if (activeContract) {
        const baseSalary = Number(activeContract.salaryAmount) || 0;
        const workedHours = workedMinutes / 60;

        switch (activeContract.paymentType) {
          case PaymentType.HOUR:
            shiftEarnings = Math.round(baseSalary * workedHours);
            break;
          case PaymentType.SHIFT:
            shiftEarnings = baseSalary;
            break;
          case PaymentType.DAY:
            shiftEarnings = baseSalary;
            break;
          case PaymentType.WEEK:
            shiftEarnings = Math.round(baseSalary / 6); // 6 working days per week
            break;
          case PaymentType.MONTH: {
            // Actual days in the current month
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            shiftEarnings = Math.round(baseSalary / daysInMonth);
            break;
          }
          default:
            shiftEarnings = null;
        }

        if (shiftEarnings != null) {
          assignment.shiftEarnings = shiftEarnings;
        }
        this.logger.debug(`[CheckOut] Earnings: ${shiftEarnings}đ (type=${activeContract.paymentType}, base=${baseSalary})`);
      }
    } catch (err) {
      this.logger.warn(`[CheckOut] Earnings calc failed: ${err?.message || err}`);
    }

    await this.shiftAssignmentRepository.save(assignment);

    // Create audit log with GPS data
    const checkOutLog = new AttendanceLog();
    checkOutLog.shiftAssignmentId = assignmentId;
    checkOutLog.employeeProfileId = assignment.employeeId;
    checkOutLog.storeId = storeId ?? '';
    checkOutLog.type = AttendanceLogType.CHECK_OUT;
    checkOutLog.timestamp = now;
    checkOutLog.method = AttendanceMethod.FACE;
    checkOutLog.faceMatchScore = matchResult.distance;
    if (checkinLatitude != null) checkOutLog.checkinLatitude = checkinLatitude;
    if (checkinLongitude != null) checkOutLog.checkinLongitude = checkinLongitude;
    if (checkinDistance != null) checkOutLog.checkinDistance = checkinDistance;
    await this.attendanceLogRepository.save(checkOutLog);

    // Ghi nhận về sớm vào DailyEmployeeReport
    if (earlyMinutes > 0 && storeId) {
      this.appendToDailyReport(storeId, 'earlyDepartures', assignment.employeeId);
    }

    // ===== Fix 2: Sync workingStatus → IDLE =====
    try {
      await this.profileRepository.update(assignment.employeeId, {
        workingStatus: WorkingStatus.IDLE,
      });
    } catch (err) {
      this.logger.warn(`[CheckOut] workingStatus sync failed: ${err?.message}`);
    }

    // ===== Fix 1: Real-time MonthlySummary Update =====
    try {
      const monthDate = new Date(now.getFullYear(), now.getMonth(), 1);
      let summary = await this.monthlySummaryRepository.findOne({
        where: { employeeProfileId: assignment.employeeId, month: monthDate },
      });
      if (!summary) {
        const employeeForSummary = await this.profileRepository.findOne({
          where: { id: assignment.employeeId },
          relations: ['contracts'],
        });
        const contractForSummary = employeeForSummary?.contracts?.find(c => c.isActive);
        summary = this.monthlySummaryRepository.create({
          employeeProfileId: assignment.employeeId,
          month: monthDate,
          baseSalary: contractForSummary?.salaryAmount || 0,
        });
      }
      summary.completedShifts = (summary.completedShifts || 0) + 1;
      summary.monthlyWorkHours = Number(summary.monthlyWorkHours || 0) + (workedMinutes / 60);
      if (assignment.lateMinutes > 0) {
        summary.lateArrivalsCount = (summary.lateArrivalsCount || 0) + 1;
      } else {
        // Fix: onTimeArrivalsCount — tăng khi đi đúng giờ
        summary.onTimeArrivalsCount = (summary.onTimeArrivalsCount || 0) + 1;
      }
      if (earlyMinutes > 0) summary.earlyDeparturesCount = (summary.earlyDeparturesCount || 0) + 1;
      if (shiftEarnings != null) {
        summary.estimatedSalary = Number(summary.estimatedSalary || 0) + shiftEarnings;
      }

      // Fix: totalWorkHours & totalCompletedShifts — tích lũy xuyên tháng
      summary.totalWorkHours = Number(summary.totalWorkHours || 0) + (workedMinutes / 60);
      summary.totalCompletedShifts = (summary.totalCompletedShifts || 0) + 1;

      // Fix: performanceScore — tự động tính = (onTimeArrivals / completedShifts) * 100
      if (summary.completedShifts > 0) {
        summary.performanceScore = Math.round(
          ((summary.onTimeArrivalsCount || 0) / summary.completedShifts) * 100,
        );
      }

      await this.monthlySummaryRepository.save(summary);
      this.logger.debug(`[CheckOut] MonthlySummary updated: shifts=${summary.completedShifts}, onTime=${summary.onTimeArrivalsCount}, totalHours=${summary.totalWorkHours}, perf=${summary.performanceScore}%`);
    } catch (err) {
      this.logger.warn(`[CheckOut] MonthlySummary update failed: ${err?.message}`);
    }

    // ===== Fix 5: Real-time EmployeeSalary + netSalary =====
    let netSalaryResult: number | null = null;
    try {
      const monthDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      // 1. Load employee profile + contract (reuse if already loaded)
      const employeeForSalary = await this.profileRepository.findOne({
        where: { id: assignment.employeeId },
        relations: ['contracts'],
      });
      const activeContractForSalary = employeeForSalary?.contracts?.find(c => c.isActive);

      if (activeContractForSalary && storeId) {
        const currentBaseSalary = Number(activeContractForSalary.salaryAmount) || 0;
        const paymentType = activeContractForSalary.paymentType || PaymentType.MONTH;

        // 2. Allowances from contract
        const allowancesMap = activeContractForSalary.allowances || {};
        const allowancesTotal = Object.values(allowancesMap)
          .reduce((sum, v) => sum + Number(v || 0), 0);

        // 3. Re-aggregate attendance
        const attendanceSummary = await this.calculateEmployeeAttendanceSummary(
          assignment.employeeId, storeId, monthDate, nextMonthDate,
        );

        // 4. Calculate salary (same logic as batch)
        let calculatedSalary = 0;
        if (attendanceSummary.hasShiftEarnings) {
          calculatedSalary = attendanceSummary.totalShiftEarnings;
        } else if (paymentType === PaymentType.HOUR) {
          calculatedSalary = currentBaseSalary * attendanceSummary.workingHours;
        } else if (paymentType === PaymentType.SHIFT || paymentType === PaymentType.DAY) {
          calculatedSalary = currentBaseSalary * attendanceSummary.completedShifts;
        } else {
          const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
          calculatedSalary = daysInMonth > 0
            ? currentBaseSalary * (attendanceSummary.completedShifts / daysInMonth)
            : currentBaseSalary;
        }

        // 5. Apply PayrollRules
        const payrollRules = await this.payrollRuleRepository.find({
          where: { storeId, isActive: true },
        });
        let bonus = 0, penalty = 0;
        for (const rule of payrollRules) {
          if (rule.category === PayrollRuleCategory.FINE) {
            if (rule.ruleType === 'LATE' && attendanceSummary.lateCount > 0) {
              penalty += rule.calcType === PayrollCalcType.AMOUNT
                ? Number(rule.value) * attendanceSummary.lateCount
                : (calculatedSalary * Number(rule.value) / 100) * attendanceSummary.lateCount;
            }
            if (rule.ruleType === 'EARLY' && attendanceSummary.earlyCount > 0) {
              penalty += rule.calcType === PayrollCalcType.AMOUNT
                ? Number(rule.value) * attendanceSummary.earlyCount
                : (calculatedSalary * Number(rule.value) / 100) * attendanceSummary.earlyCount;
            }
            if (rule.ruleType === 'ABSENT' && attendanceSummary.absentCount > 0) {
              penalty += Number(rule.value) * attendanceSummary.absentCount;
            }
          } else if (rule.category === PayrollRuleCategory.BONUS) {
            if (rule.ruleType === 'ATTENDANCE' && attendanceSummary.lateCount === 0 && attendanceSummary.absentCount === 0) {
              bonus += Number(rule.value);
            }
            if (!rule.ruleType || rule.ruleType === 'GENERAL') {
              bonus += Number(rule.value);
            }
          }
        }

        // 6. Calculate totals
        const totalIncome = Math.round(calculatedSalary + allowancesTotal + bonus);
        const totalDeductions = Math.round(penalty);
        const netSalary = Math.max(0, totalIncome - totalDeductions);
        netSalaryResult = netSalary;

        // 7. Upsert EmployeeSalary
        let salary = await this.employeeSalaryRepository.findOne({
          where: { employeeProfileId: assignment.employeeId, month: monthDate },
        });
        if (!salary) {
          salary = this.employeeSalaryRepository.create({
            employeeProfileId: assignment.employeeId,
            month: monthDate,
          });
        }
        salary.baseSalary = currentBaseSalary;
        salary.paymentType = paymentType;
        salary.allowances = allowancesMap;
        salary.workingDays = attendanceSummary.completedShifts;
        salary.workingHours = attendanceSummary.workingHours;
        salary.unauthorizedLeaveDays = attendanceSummary.absentCount;
        salary.bonus = bonus;
        salary.penalty = penalty;
        salary.totalIncome = totalIncome;
        salary.totalDeductions = totalDeductions;
        salary.netSalary = netSalary;
        await this.employeeSalaryRepository.save(salary);

        this.logger.debug(`[CheckOut] Real-time salary: income=${totalIncome}, deductions=${totalDeductions}, net=${netSalary}`);
      }
    } catch (err) {
      this.logger.warn(`[CheckOut] Real-time salary update failed: ${err?.message}`);
    }

    return {
      matched: true,
      distance: matchResult.distance,
      earlyMinutes,
      workedMinutes,
      attendanceStatus,
      checkOutTime: now.toISOString(),
      gpsDistance: checkinDistance != null ? Math.round(checkinDistance) : null,
      shiftEarnings,
      netSalary: netSalaryResult,
    };
  }

  /**
   * Haversine formula — calculate distance between two GPS points in meters
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * OpenStreetMap Nominatim — Reverse Geocode (lat/lng → address)
   * FREE, no API key required
   */
  async geocodeReverse(lat: number, lng: number) {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=vi&addressdetails=1`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'TimeSO/1.0' }, // Nominatim requires User-Agent
    });
    const data = await response.json();

    if (!data || data.error) {
      return { address: null, results: [] };
    }

    return {
      address: data.display_name,
      results: [{
        formattedAddress: data.display_name,
        placeId: String(data.place_id),
        types: [data.type, data.category].filter(Boolean),
      }],
    };
  }

  /**
   * OpenStreetMap Nominatim — Places Search
   * FREE, no API key required
   */
  async searchPlaces(query: string, lat?: number, lng?: number) {
    let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&accept-language=vi&addressdetails=1&limit=10&countrycodes=vn`;
    if (lat != null && lng != null) {
      url += `&viewbox=${lng - 0.5},${lat + 0.5},${lng + 0.5},${lat - 0.5}&bounded=0`;
    }

    const response = await fetch(url, {
      headers: { 'User-Agent': 'TimeSO/1.0' }, // Nominatim requires User-Agent
    });
    const data = await response.json();

    if (!Array.isArray(data)) {
      return { results: [] };
    }

    return {
      results: data.map((r: any) => ({
        name: r.name || r.display_name?.split(',')[0] || '',
        address: r.display_name,
        placeId: String(r.place_id),
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
      })),
    };
  }

  /**
   * Update store location (lat/lng) and auto-generate QR code
   */
  async updateStoreLocation(storeId: string, latitude: number, longitude: number) {
    const store = await this.storeRepository.findOne({ where: { id: storeId } });
    if (!store) throw new NotFoundException('Store not found');

    store.latitude = latitude;
    store.longitude = longitude;

    // Auto-generate QR code data if not exists
    if (!store.qrCode) {
      store.qrCode = JSON.stringify({
        type: 'TIMESO_STORE',
        storeId: store.id,
        name: store.name,
      });
    }

    await this.storeRepository.save(store);
    console.log(`📍 [Store] Location updated: ${latitude}, ${longitude} — QR: ${store.qrCode}`);
    return store;
  }

  /**
   * Generate/regenerate QR code data for a store
   */
  async generateStoreQR(storeId: string) {
    const store = await this.storeRepository.findOne({ where: { id: storeId } });
    if (!store) throw new NotFoundException('Store not found');

    // QR payload = storeId (staff app will scan this)
    const qrPayload = storeId;

    // Ensure uploads/qr directory exists
    const qrDir = join(process.cwd(), 'uploads', 'qr');
    if (!existsSync(qrDir)) {
      mkdirSync(qrDir, { recursive: true });
    }

    // Generate QR code PNG file
    const fileName = `store-${storeId}.png`;
    const filePath = join(qrDir, fileName);

    await QRCode.toFile(filePath, qrPayload, {
      type: 'png',
      width: 512,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' },
    });

    // Save URL path in store entity
    const qrUrl = `/uploads/qr/${fileName}`;
    store.qrCode = qrUrl;
    await this.storeRepository.save(store);

    this.logger.debug(`[QR] Generated QR image: ${qrUrl} for store ${storeId}`);
    return { qrCode: qrUrl };
  }

  async registerFace(employeeProfileId: string, storeId: string, imageBuffers: Buffer[]) {
    const startTime = Date.now();
    console.log(`🔵 [FaceRegistration] START — employee=${employeeProfileId}, store=${storeId}, images=${imageBuffers.length}`);

    if (imageBuffers.length < 3) {
      console.warn(`❌ [FaceRegistration] Not enough images: ${imageBuffers.length} < 3`);
      throw new BadRequestException('At least 3 face images required');
    }

    const t1 = Date.now();
    console.log(`🔍 [FaceRegistration] Extracting face descriptors from ${imageBuffers.length} images...`);
    const result = await this.faceRecognitionService.registerFace(imageBuffers);
    const extractTime = Date.now() - t1;
    console.log(`🔍 [FaceRegistration] Result: ${result.successCount} faces detected, ${result.failedCount} failed — took ${extractTime}ms`);

    if (result.successCount < 3) {
      console.warn(`❌ [FaceRegistration] Only ${result.successCount}/3 faces detected — REJECTED`);
      throw new BadRequestException(
        `Only ${result.successCount} faces detected out of ${imageBuffers.length} images. Need at least 3.`,
      );
    }

    // Deactivate old face registrations
    const deactivated = await this.employeeFaceRepository.update(
      { employeeProfileId, isActive: true },
      { isActive: false },
    );
    console.log(`♻️ [FaceRegistration] Deactivated ${deactivated.affected || 0} old registration(s)`);

    // Save new face registration
    const face = this.employeeFaceRepository.create({
      employeeProfileId,
      storeId,
      faceDescriptors: result.descriptors,
      faceImageUrls: [],
      isActive: true,
    });

    const saved = await this.employeeFaceRepository.save(face);
    const totalTime = Date.now() - startTime;
    console.log(`✅ [FaceRegistration] SUCCESS — faceId=${saved.id}, descriptors=${saved.faceDescriptors?.length} — TOTAL ${totalTime}ms`);

    return saved;
  }

  async getFaceRegistration(employeeProfileId: string) {
    const face = await this.employeeFaceRepository.findOne({
      where: { employeeProfileId, isActive: true },
    });
    return {
      registered: !!face,
      registeredAt: face?.registeredAt || null,
      descriptorCount: face?.faceDescriptors?.length || 0,
    };
  }

  async getAttendanceLogs(storeId: string, filters?: { employeeProfileId?: string; dateFrom?: string; dateTo?: string }) {
    const where: any = { storeId };
    if (filters?.employeeProfileId) where.employeeProfileId = filters.employeeProfileId;
    if (filters?.dateFrom && filters?.dateTo) {
      where.timestamp = Between(new Date(filters.dateFrom), new Date(filters.dateTo + 'T23:59:59'));
    }

    return this.attendanceLogRepository.find({
      where,
      relations: ['shiftAssignment', 'employeeProfile'],
      order: { timestamp: 'DESC' },
      take: 100,
    });
  }

  async getBonusHistory(storeId: string, month?: string) {
    const query = this.salaryAdjustmentRepository
      .createQueryBuilder('sa')
      .innerJoinAndSelect('sa.employeeProfile', 'ep')
      .leftJoinAndSelect('ep.account', 'acc')
      .leftJoinAndSelect('ep.storeRole', 'role')
      .leftJoinAndSelect('ep.employeeType', 'etype')
      .where('ep.storeId = :storeId', { storeId })
      .andWhere('sa.adjustmentType = :type', { type: AdjustmentType.INCREASE })
      .orderBy('sa.createdAt', 'DESC');

    if (month) {
      query.andWhere("TO_CHAR(sa.effective_month, 'MM/YYYY') = :month", { month });
    }

    const adjustments = await query.take(50).getMany();

    // Group by date
    const grouped: Record<string, any[]> = {};
    for (const adj of adjustments) {
      const dateKey = new Date(adj.createdAt).toLocaleDateString('vi-VN');
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push({
        id: adj.id,
        employeeName: (adj.employeeProfile as any)?.account?.name || '',
        position: (adj.employeeProfile as any)?.storeRole?.name || '',
        employmentType: (adj.employeeProfile as any)?.employeeType?.name || '',
        performance: adj.reasonText || '',
        bonusAmount: `+${Number(adj.adjustmentAmount).toLocaleString('vi-VN')}vnđ`,
      });
    }

    return Object.entries(grouped).map(([date, records]) => ({ date, records }));
  }

  async getPenaltyHistory(storeId: string, month?: string) {
    const query = this.salaryAdjustmentRepository
      .createQueryBuilder('sa')
      .innerJoinAndSelect('sa.employeeProfile', 'ep')
      .leftJoinAndSelect('ep.account', 'acc2')
      .leftJoinAndSelect('ep.storeRole', 'role2')
      .leftJoinAndSelect('ep.employeeType', 'etype2')
      .where('ep.storeId = :storeId', { storeId })
      .andWhere('sa.adjustmentType = :type', { type: AdjustmentType.DECREASE })
      .orderBy('sa.createdAt', 'DESC');

    if (month) {
      query.andWhere("TO_CHAR(sa.effective_month, 'MM/YYYY') = :month", { month });
    }

    const adjustments = await query.take(50).getMany();

    // Group by date
    const grouped: Record<string, any[]> = {};
    for (const adj of adjustments) {
      const dateKey = new Date(adj.createdAt).toLocaleDateString('vi-VN');
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push({
        id: adj.id,
        employeeName: (adj.employeeProfile as any)?.account?.name || '',
        position: (adj.employeeProfile as any)?.storeRole?.name || '',
        employmentType: (adj.employeeProfile as any)?.employeeType?.name || '',
        reason: adj.reasonText || '',
        penaltyAmount: `-${Number(adj.adjustmentAmount).toLocaleString('vi-VN')}vnđ`,
      });
    }

    return Object.entries(grouped).map(([date, records]) => ({ date, records }));
  }

  async getNextShiftAssignment(employeeProfileId: string, storeId: string) {
    const today = new Date();
    // Use local date to match PostgreSQL date column (avoids UTC+7 midnight mismatch)
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;

    this.logger.log(`[getNextShiftAssignment] employeeProfileId=${employeeProfileId}, storeId=${storeId}, todayStr=${todayStr}`);

    // 1) Check if there's an active assignment (checked in but not checked out)
    const activeAssignment = await this.shiftAssignmentRepository.findOne({
      where: {
        employeeId: employeeProfileId,
        status: ShiftAssignmentStatus.CONFIRMED,
        checkOutTime: null as any,
      },
      relations: ['shiftSlot', 'shiftSlot.workShift'],
      order: { checkInTime: 'DESC' },
    });

    if (activeAssignment) {
      const ws = activeAssignment.shiftSlot?.workShift;
      this.logger.log(`[getNextShiftAssignment] Found active (checked-in) assignment: ${activeAssignment.id}`);
      return {
        assignmentId: activeAssignment.id,
        mode: 'check-out' as const,
        shiftName: ws?.shiftName || '',
        startTime: ws?.startTime || '',
        endTime: ws?.endTime || '',
        workDate: activeAssignment.shiftSlot?.workDate || null,
        shiftSlotId: activeAssignment.shiftSlot?.id || null,
        checkInTime: activeAssignment.checkInTime?.toISOString() || null,
        lateMinutes: activeAssignment.lateMinutes || 0,
      };
    }

    // 2) Find next approved assignment for TODAY in this store
    const approvedAssignment = await this.shiftAssignmentRepository
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .leftJoinAndSelect('slot.cycle', 'cycle')
      .where('a.employeeId = :employeeProfileId', { employeeProfileId })
      .andWhere('a.status = :status', { status: ShiftAssignmentStatus.APPROVED })
      .andWhere('a.checkInTime IS NULL')
      .andWhere('slot.workDate = :todayStr', { todayStr })
      .andWhere('cycle.storeId = :storeId', { storeId })
      .orderBy('ws.startTime', 'ASC')
      .getOne();

    if (approvedAssignment) {
      const ws = approvedAssignment.shiftSlot?.workShift;
      this.logger.log(`[getNextShiftAssignment] Found approved assignment for today: ${approvedAssignment.id}, shift=${ws?.shiftName}`);
      return {
        assignmentId: approvedAssignment.id,
        mode: 'check-in' as const,
        shiftName: ws?.shiftName || '',
        startTime: ws?.startTime || '',
        endTime: ws?.endTime || '',
        workDate: approvedAssignment.shiftSlot?.workDate || todayStr,
        shiftSlotId: approvedAssignment.shiftSlot?.id || null,
        checkInTime: null,
        lateMinutes: 0,
      };
    }

    this.logger.log(`[getNextShiftAssignment] No shifts found for today (${todayStr})`);
    return { mode: 'none', assignmentId: null, shiftName: null, startTime: null, endTime: null, checkInTime: null, lateMinutes: 0 };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SHIFT REGISTRATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Nhân viên gửi đề xuất đăng ký ca làm việc.
   * Nếu có slotId → gắn vào slot cụ thể (registerToShiftSlot flow).
   * Nếu không có slotId → tạo ShiftRegistration dạng đề xuất tổng quát.
   */
  async createShiftRegistration(
    accountId: string,
    data: {
      storeId: string;
      employeeProfileId: string;
      workShiftId?: string;
      slotId?: string;
      startDate?: string;
      endDate?: string;
      note?: string;
    },
  ) {
    // If slotId provided, delegate to existing registerToShiftSlot
    if (data.slotId) {
      return this.registerToShiftSlot(data.slotId, data.employeeProfileId, data.note);
    }

    // Otherwise create a general shift proposal via leave-request-style record
    // Find an open shift slot that matches the requested workShift + date
    let targetSlotId: string | null = null;

    if (data.workShiftId && data.startDate) {
      const slot = await this.shiftSlotRepository.findOne({
        where: {
          workShiftId: data.workShiftId,
        } as any,
      });
      if (slot) targetSlotId = slot.id;
    }

    if (targetSlotId) {
      return this.registerToShiftSlot(targetSlotId, data.employeeProfileId, data.note);
    }

    // No available slot found — return 400 instead of creating invalid record
    throw new BadRequestException(
      'Không tìm thấy slot ca phù hợp. Vui lòng chọn slotId cụ thể hoặc liên hệ quản lý.',
    );
  }

  /**
   * Lấy danh sách đăng ký ca (shift registrations / proposals).
   */
  async getShiftRegistrations(filters: {
    storeId?: string;
    employeeProfileId?: string;
    status?: string;
  }) {
    const where: any = {};
    // NOTE: ShiftAssignment entity has no storeId column (FK is through shiftSlot)
    // Only filter by employeeId and status directly
    if (filters.employeeProfileId) where.employeeId = filters.employeeProfileId;
    if (filters.status) where.status = filters.status;

    return this.shiftAssignmentRepository.find({
      where,
      relations: ['shiftSlot'],
      order: { createdAt: 'DESC' },
    });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SALARY INQUIRIES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Nhân viên gửi câu hỏi về lương tới quản lý.
   * Tái dụng bảng Feedback để lưu trữ, type = 'SALARY_INQUIRY'.
   */
  async createSalaryInquiry(profileId: string, question: string, month?: string) {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      relations: ['account'],
    });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');

    const feedbackData = this.feedbackRepository.create({
      employeeProfileId: profileId,
      storeId: profile.storeId,
      accountId: profile.accountId,
      content: month ? `[Tháng ${month}] ${question}` : question,
      categories: ['SALARY_INQUIRY'],
      status: FeedbackStatus.PENDING,
    });
    const saved = await this.feedbackRepository.save(feedbackData);

    return {
      id: saved.id,
      message: 'Câu hỏi của bạn đã được gửi thành công. Quản lý sẽ phản hồi trong thời gian sớm nhất.',
      status: 'PENDING',
      createdAt: saved.createdAt,
    };
  }

  /**
   * Lấy danh sách câu hỏi lương của nhân viên.
   */
  async getSalaryInquiries(profileId: string) {
    const feedbacks = await this.feedbackRepository.find({
      where: { employeeProfileId: profileId },
      order: { createdAt: 'DESC' },
    });
    // Filter to just salary inquiries
    const inquiries = feedbacks.filter(f => f.categories?.includes('SALARY_INQUIRY'));
    return inquiries.map(f => ({
      id: f.id,
      question: f.content,
      status: f.status,
      reply: f.adminNote || null,
      createdAt: f.createdAt,
    }));
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SALARY SLIP DATA
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Lấy dữ liệu phiếu lương cho nhân viên theo tháng.
   * Format tháng: "MM/YYYY".
   */
  async getSalarySlipData(profileId: string, month: string) {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      relations: ['account', 'storeRole'],
    });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');

    // Fetch salary record for this month
    const salary = await this.getEmployeeSalaries(profileId, month);
    const salaryRecord = Array.isArray(salary) ? salary[0] : salary;

    if (!salaryRecord) {
      return {
        message: 'Chưa có phiếu lương cho tháng này. Vui lòng liên hệ quản lý.',
        profileId,
        month,
        employeeName: profile.account?.fullName || 'N/A',
        position: profile.storeRole?.name || 'N/A',
        data: null,
      };
    }

    return {
      profileId,
      month,
      employeeName: profile.account?.fullName || 'N/A',
      position: profile.storeRole?.name || 'N/A',
      workingDays: salaryRecord.workingDays,
      workingHours: salaryRecord.workingHours,
      baseSalary: salaryRecord.baseSalary,
      bonus: salaryRecord.bonus,
      penalty: salaryRecord.penalty,
      advancePayment: salaryRecord.advancePayment,
      totalIncome: salaryRecord.totalIncome,
      totalDeductions: salaryRecord.totalDeductions,
      netSalary: salaryRecord.netSalary,
      paymentStatus: salaryRecord.paymentStatus,
      paidAt: salaryRecord.paidAt,
      generatedAt: new Date().toISOString(),
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // KPI AI SUGGESTION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Yêu cầu AI đề xuất KPI cho nhân viên.
   * Phân tích lịch sử hiệu suất và trả về các gợi ý KPI phù hợp.
   */
  async requestKpiAiSuggestion(data: {
    storeId: string;
    employeeProfileId: string;
    context?: string;
  }) {
    // Fetch recent KPIs and performance data for the employee
    const kpis = await this.employeeKpiRepository.find({
      where: { employeeProfileId: data.employeeProfileId },
      relations: ['kpiTasks'],
      order: { createdAt: 'DESC' },
      take: 5,
    });

    const performance = await this.performanceRepository.find({
      where: { employeeProfileId: data.employeeProfileId },
      order: { createdAt: 'DESC' },
      take: 3,
    });

    // Generate rule-based AI suggestions based on performance history
    const suggestions = this.generateKpiSuggestions(kpis, performance, data.context);

    return {
      requestId: `ai-kpi-${Date.now()}`,
      status: 'COMPLETED',
      employeeProfileId: data.employeeProfileId,
      suggestions,
      generatedAt: new Date().toISOString(),
      message: 'AI đã phân tích dữ liệu hiệu suất và đề xuất các KPI phù hợp.',
    };
  }

  /**
   * Rule-based KPI suggestion engine.
   * Phân tích dữ liệu KPI hiện có và đề xuất các mục tiêu phù hợp.
   */
  private generateKpiSuggestions(kpis: EmployeeKpi[], performance: any[], context?: string): any[] {
    const suggestions: any[] = [];

    // Default suggestions dựa trên performance data
    const hasHighPerformance = performance.some((p: any) => p.score >= 80);
    const hasLowPerformance = performance.some((p: any) => p.score < 60);

    // Attendance KPI
    suggestions.push({
      title: 'KPI Chuyên cần',
      description: 'Đi làm đúng giờ và đủ số ca trong tháng',
      targetValue: hasHighPerformance ? 28 : 25,
      unit: 'ngày',
      category: 'ATTENDANCE',
      rationale: hasHighPerformance
        ? 'Nhân viên có hiệu suất tốt, nâng mục tiêu lên mức cao hơn.'
        : 'Mục tiêu khởi đầu phù hợp để xây dựng thói quen tốt.',
    });

    // Learning KPI
    suggestions.push({
      title: 'KPI Phát triển kỹ năng',
      description: 'Hoàn thành ít nhất 1 khóa học hoặc buổi đào tạo trong tháng',
      targetValue: 1,
      unit: 'khóa học',
      category: 'DEVELOPMENT',
      rationale: 'Phát triển liên tục là yếu tố quan trọng để thăng tiến.',
    });

    // Performance-based KPI
    if (hasLowPerformance) {
      suggestions.push({
        title: 'KPI Cải thiện hiệu suất',
        description: 'Đạt điểm hiệu suất tối thiểu 70/100 trong tháng',
        targetValue: 70,
        unit: 'điểm',
        category: 'PERFORMANCE',
        rationale: 'Cần cải thiện điểm hiệu suất để đạt tiêu chuẩn của cửa hàng.',
      });
    } else {
      suggestions.push({
        title: 'KPI Doanh số / Năng suất',
        description: 'Đặt mục tiêu doanh số hoặc số lượng phục vụ trong tháng',
        targetValue: 100,
        unit: 'đơn vị',
        category: 'PERFORMANCE',
        rationale: 'Nhân viên đang có hiệu suất tốt, có thể đặt mục tiêu cao hơn.',
      });
    }

    // Customer satisfaction KPI
    suggestions.push({
      title: 'KPI Hài lòng khách hàng',
      description: 'Nhận ít nhất 5 phản hồi tích cực từ khách hàng trong tháng',
      targetValue: 5,
      unit: 'phản hồi',
      category: 'CUSTOMER_SERVICE',
      rationale: 'Chất lượng phục vụ khách hàng là chỉ số quan trọng nhất.',
    });

    // Context-based additional suggestion
    if (context) {
      suggestions.push({
        title: 'KPI Theo yêu cầu',
        description: context,
        targetValue: 1,
        unit: 'lần',
        category: 'CUSTOM',
        rationale: 'Được thêm theo yêu cầu cụ thể của nhân viên.',
      });
    }

    return suggestions;
  }
}
