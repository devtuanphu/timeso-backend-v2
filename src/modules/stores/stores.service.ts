import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, MoreThanOrEqual, Between, Not, IsNull, DataSource, EntityManager, Brackets, SelectQueryBuilder } from 'typeorm';
import { isUUID } from 'class-validator';
import { UpdateServiceItemRecipeDto } from './dto/service-item-recipe.dto';
import {
  changeEmploymentType,
  computeProbationEndsAt,
  recordEntryCareerEvents,
} from './career-ladder.lifecycle';
import { UpdateEmployeeByOwnerDto } from './dto/update-employee.dto';
import { defaultStaffPermissions } from './store-permission-defaults';
import {
  appUpdateRequired,
  isCareerV2Enabled,
  lockCareerStore,
} from './career/career-store';
import { extname, join, resolve as resolvePath } from 'path';
import { readdir, rename, unlink } from 'fs/promises';
import { CONTRACT_UPLOAD_DIR } from '../../common/utils/contract-file';
import { revenueByShift } from './revenue-by-shift';
import { SalaryAdjustment } from './entities/salary-adjustment.entity';
import { SalaryAdjustmentReason } from './entities/salary-adjustment-reason.entity';
import { EmployeePaymentHistory } from './entities/employee-payment-history.entity';
import { StorePaymentAccount } from './entities/store-payment-account.entity';
import { ShiftChangeRequest, ShiftChangeRequestStatus } from './entities/shift-change-request.entity';
import { BonusWorkRequest } from './entities/bonus-work-request.entity';
import { Store, StoreStatus } from './entities/store.entity';
import { StoreEmployeeType } from './entities/store-employee-type.entity';
import { StoreLadder, LadderDimension } from './entities/store-ladder.entity';
import { StoreLadderRung } from './entities/store-ladder-rung.entity';
import { StoreLadderEdge } from './entities/store-ladder-edge.entity';
import { StoreDepartment } from './entities/store-department.entity';
import { StoreRole } from './entities/store-role.entity';
import { EMPLOYED_STATUSES, EmployeeProfile, EmploymentStatus, isEmployedStatus, WorkingStatus } from './entities/employee-profile.entity';
import { EmployeeContract, isNoLaborContract, NO_LABOR_CONTRACT_NAME } from './entities/employee-contract.entity';
import { ContractTemplate } from './entities/contract-template.entity';
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
import { ProductExportDto } from './dto/product-export.dto';
import { MonthlyPayroll } from './entities/monthly-payroll.entity';
import { SalaryConfig } from './entities/salary-config.entity';
import { EmployeeSalary } from './entities/employee-salary.entity';
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
import { ChatGroupMember } from '../chat-groups/entities/chat-group-member.entity';
import { JobApplication, JobApplicationStatus } from './entities/job-application.entity';
import { isSafeSelfieFilename, jobApplicationSelfieUrl } from './job-application-selfie.storage';
import { currentStintContracts, currentStintSql, stintFloor, stintStartVnDate } from './employment-stint.utils';
import { AttendanceLog } from './entities/attendance-log.entity';
import { AttendanceStatus } from './entities/shift-management.entity';
import { EmployeeAssetAssignment, AssetAssignmentStatus } from './entities/employee-asset-assignment.entity';
import { StoreEvent, StoreEventType } from './entities/store-event.entity';
import { StockTransaction, StockTransactionType, StockTransactionStatus, StockTransactionDetail } from './entities/stock-transaction.entity';
import { WorkCycle, ShiftSlot, ShiftAssignment, ShiftSwap, ShiftAssignmentStatus, ShiftSwapStatus, CycleShiftTemplate } from './entities/shift-management.entity';
import { KpiApprovalRequest, KpiRequestStatus } from './entities/kpi-approval-request.entity';
import { InventoryReport, InventoryReportStatus } from './entities/inventory-report.entity';
import { ServiceCategory, ServiceItem, ServiceItemRecipe, ServiceType } from './entities/service-item.entity';
import { Order, OrderItem, OrderStatus, PaymentStatus as OrderPaymentStatus } from './entities/order.entity';
import { EmployeeTerminationReason } from './entities/employee-termination-reason.entity';
import { StoreProbationSetting } from './entities/store-probation-setting.entity';
import { StoreSkill } from './entities/store-skill.entity';
import { CreateStoreSkillDto, UpdateStoreSkillDto, UpdatePersonalInfoDto, RenewContractDto } from './dto/store-response.dto';
import { lockStoreShiftAvailability } from './shift-availability-lock';
import { addDays, parseDateOnly } from './shift-schedule.utils';
import { parseVietnamShiftStart } from './shift-reminder.utils';
import { isShiftCoveredByApprovedLeave } from './leave-coverage.utils';
import { StorePayrollPaymentHistory } from './entities/store-payroll-payment-history.entity';
import { SalaryFundHistory } from './entities/salary-fund-history.entity';
import { SalaryAdvanceRequest, AdvanceRequestStatus } from './entities/salary-advance-request.entity';
import { StoreApprovalSetting } from './entities/store-approval-setting.entity';
import { StoreTimekeepingSetting } from './entities/store-timekeeping-setting.entity';
import { StorePayrollSetting } from './entities/store-payroll-setting.entity';
import { StorePayrollRule } from './entities/store-payroll-rule.entity';
import { StorePayrollIncrementRule } from './entities/store-payroll-increment-rule.entity';
import { StoreInternalRule } from './entities/store-internal-rule.entity';
import { UpdateInternalRuleDto } from './dto/store-internal-rule.dto';
import { StorePermissionConfig } from './entities/store-permission-config.entity';
import { StorePermissionConfigDto } from './dto/store-permission-config.dto';
import { StoreShiftConfig } from './entities/store-shift-config.entity';
import { CreateFnbServiceItemDto, CreateYieldServiceItemDto, CreatePersonalCareItemDto, CreatePetCareItemDto } from './dto/order-management.dto';
import { Account, AccountStatus } from '../accounts/entities/account.entity';
import { AccountIdentityDocument, VerifiedStatus } from '../accounts/entities/account-identity-document.entity';
import { AccountFinance } from '../accounts/entities/account-finance.entity';
import { AccountsService } from '../accounts/accounts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SlotAnnouncementThrottle } from './shift-assignment-notification';
import { MailService } from '../mail/mail.service';
import { ShiftReminderService } from './shift-reminder.service';
import { ActivityLogService, ActivityLogEntry } from './activity-log.service';
import { ACTIVITY_ACTIONS, toActivityDate, toActivityHHmm } from './activity-log.summary';
import { OwnerNotificationService } from './owner-notification.service';
import { parseVnMonthInput, toDateMarker, toMonthMarker, vnDateString, vnMonthOf, vnMonthOfDateString } from '../../common/utils/vn-calendar';
import { formatVnMoney } from '../../common/utils/money';
import { effectiveWindowOf } from './attendance-time.utils';
import { StoreWorkedTimeRule } from './entities/store-worked-time-rule.entity';
import { randomBytes } from 'crypto';
import { normalizeVietnamPhone } from '../../common/utils/account-identifier';
import { AddExistingEmployeeDto, EmployeeWorkAssignmentDto } from './dto/add-existing-employee.dto';
import { StoreDiscoveryPageDto, StoreDiscoveryQueryDto } from './dto/store-discovery.dto';
import {
  assertShiftsStartAhead,
  CHECK_IN_TOO_EARLY_CODE,
  FIXED_SHIFT_MAX_RANGE_DAYS,
  findSameNameShiftOnDates,
  monthlyPayrollLockKey,
  normalizeLeaveType,
  normalizeWorkCycleStopRequest,
  ONE_ACTIVE_CYCLE_CONSTRAINTS,
  parseLeaveTypeFilter,
  pickDefined,
  sameNameShiftMessage,
  SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES,
  ShiftEmployeeOtherShift,
  shouldNotifyNewShifts,
  STORE_LOCATION_REQUIRED_CODE,
  WORK_SHIFT_HAS_UPCOMING_ASSIGNMENTS,
  WORK_SHIFT_INACTIVE_CODE,
  WORK_SHIFT_INACTIVE_MESSAGE,
  WorkCycleStopPlan,
} from './service-parts/shared';
import { applyClassParts } from './service-parts/class-parts';
import { StoresAttendancePart } from './service-parts/attendance.part';
import { StoresPayrollPart } from './service-parts/payroll.part';
import { StoresRequestsPart } from './service-parts/requests.part';
import { StoresSchedulingPart } from './service-parts/scheduling.part';

// Helpers that moved to service-parts/shared.ts stay importable from here.
export {
  assertShiftsStartAhead,
  CHECK_IN_TOO_EARLY_CODE,
  FIXED_SHIFT_MAX_RANGE_DAYS,
  findSameNameShiftOnDates,
  monthlyPayrollLockKey,
  normalizeLeaveType,
  normalizeWorkCycleStopRequest,
  ONE_ACTIVE_CYCLE_CONSTRAINTS,
  parseLeaveTypeFilter,
  sameNameShiftMessage,
  SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES,
  shouldNotifyNewShifts,
  STORE_LOCATION_REQUIRED_CODE,
  WORK_SHIFT_HAS_UPCOMING_ASSIGNMENTS,
  WORK_SHIFT_INACTIVE_CODE,
  WORK_SHIFT_INACTIVE_MESSAGE,
} from './service-parts/shared';
export type {
  ShiftEmployeeOtherShift,
  WorkCycleStopPlan,
} from './service-parts/shared';

const VIETNAMESE_SEARCH_FROM =
  'áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ';
const VIETNAMESE_SEARCH_TO =
  `${'a'.repeat(17)}${'e'.repeat(11)}${'i'.repeat(5)}${'o'.repeat(17)}${'u'.repeat(11)}${'y'.repeat(5)}d`;

export const normalizeStoreSearchText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const escapeLikeToken = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

/** Employee KPI fields a client may set on create. */
const EMPLOYEE_KPI_CLIENT_FIELDS = [
  'name',
  'employeeProfileId',
  'month',
  'status',
  'notes',
  'reminders',
  'compliments',
] as const;

/** Asset columns `POST :id/assets` (bulk) may set: scalars only. */
const ASSET_CLIENT_FIELDS = [
  'name',
  'code',
  'avatarUrl',
  'assetUnitId',
  'assetCategoryId',
  'value',
  'note',
  'assetStatusId',
  'purchaseDate',
  'supplierName',
  'supplierPhone',
  'invoiceFileUrl',
  'currentStock',
  'minStock',
  'maxStock',
  'responsibleEmployeeId',
  'isActive',
] as const;

/** Product columns `POST :id/products` (bulk) may set: scalars only. */
const PRODUCT_CLIENT_FIELDS = [
  'name',
  'sku',
  'avatarUrl',
  'productUnitId',
  'productCategoryId',
  'productStatusId',
  'costPrice',
  'sellingPrice',
  'minThreshold',
  'maxThreshold',
  'note',
  'currentStock',
  'isActive',
] as const;

/** Columns a client may set when creating a KPI type / unit / period. */
const KPI_TYPE_CLIENT_FIELDS = ['name', 'description', 'isActive'] as const;
const KPI_UNIT_CLIENT_FIELDS = ['name', 'isActive'] as const;
const KPI_PERIOD_CLIENT_FIELDS = ['name', 'isActive'] as const;

/** Largest number of items one bulk stock-out request may carry. */
export const BULK_EXPORT_MAX_ITEMS = 500;

/** 403 codes of the KPI write rules (see `assertKpiWriteAccess`). */
export const KPI_SELF_OR_OWNER_REQUIRED = 'KPI_SELF_OR_OWNER_REQUIRED';
export const KPI_NOT_DRAFT = 'KPI_NOT_DRAFT';
export const KPI_CLOSED = 'KPI_CLOSED';

/** KPI task fields a client may set (never `id`, `employeeKpiId`, rates). */
const KPI_TASK_CLIENT_FIELDS = [
  'taskName',
  'kpiUnitId',
  'kpiPeriodId',
  'kpiTypeId',
  'target',
  'actualValue',
  'startDate',
  'endDate',
  'description',
  'isHidden',
] as const;

/** Largest value `kpi_tasks.completion_rate` (decimal(5,2)) can hold. */
export const KPI_COMPLETION_RATE_MAX = 999.99;

/** Completion % of a KPI task, clamped to the column's range. */
export const kpiCompletionRate = (
  actualValue: unknown,
  target: unknown,
): number => {
  const actual = Number(actualValue);
  const goal = Number(target);
  if (!(goal > 0) || actualValue === undefined || !Number.isFinite(actual)) {
    return 0;
  }
  const rate = Math.round((actual / goal) * 10000) / 100;
  return Math.min(KPI_COMPLETION_RATE_MAX, Math.max(-KPI_COMPLETION_RATE_MAX, rate));
};

/** Fields `PUT service-items/:itemId` may change; never `storeId` or `id`. */
const SERVICE_ITEM_EDITABLE_FIELDS = [
  'categoryId',
  'name',
  'price',
  'size',
  'avatarUrl',
  'description',
  'duration',
  'metadata',
  'isActive',
] as const;

@Injectable()
// Merged with the `interface StoresService` of its domain parts (end of file).
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class StoresService {
  readonly logger = new Logger(StoresService.name);

  constructor(
    @InjectRepository(Store)
    readonly storeRepository: Repository<Store>,
    @InjectRepository(StoreEmployeeType)
    private readonly employeeTypeRepository: Repository<StoreEmployeeType>,
    @InjectRepository(StoreRole)
    readonly roleRepository: Repository<StoreRole>,
    @InjectRepository(EmployeeProfile)
    readonly profileRepository: Repository<EmployeeProfile>,
    @InjectRepository(EmployeeContract)
    readonly contractRepository: Repository<EmployeeContract>,
    @InjectRepository(ContractTemplate)
    private readonly contractTemplateRepository: Repository<ContractTemplate>,
    @InjectRepository(WorkShift)
    readonly workShiftRepository: Repository<WorkShift>,
    @InjectRepository(Asset)
    private readonly assetRepository: Repository<Asset>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(AssetUnit)
    private readonly assetUnitRepository: Repository<AssetUnit>,
    @InjectRepository(ProductUnit)
    private readonly productUnitRepository: Repository<ProductUnit>,
    @InjectRepository(MonthlyPayroll)
    readonly payrollRepository: Repository<MonthlyPayroll>,
    @InjectRepository(SalaryConfig)
    readonly salaryConfigRepository: Repository<SalaryConfig>,
    @InjectRepository(EmployeeSalary)
    readonly employeeSalaryRepository: Repository<EmployeeSalary>,
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
    readonly monthlySummaryRepository: Repository<EmployeeMonthlySummary>,
    @InjectRepository(StoreEvent)
    private readonly eventRepository: Repository<StoreEvent>,
    @InjectRepository(StockTransaction)
    private readonly stockTransactionRepository: Repository<StockTransaction>,
    @InjectRepository(StockTransactionDetail)
    private readonly stockTransactionDetailRepository: Repository<StockTransactionDetail>,
    @InjectRepository(WorkCycle)
    readonly workCycleRepository: Repository<WorkCycle>,
    @InjectRepository(ShiftSlot)
    readonly shiftSlotRepository: Repository<ShiftSlot>,
    @InjectRepository(ShiftAssignment)
    readonly shiftAssignmentRepository: Repository<ShiftAssignment>,
    @InjectRepository(ShiftSwap)
    readonly shiftSwapRepository: Repository<ShiftSwap>,
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
    readonly leaveRequestRepository: Repository<EmployeeLeaveRequest>,
    @InjectRepository(EmployeeAssetAssignment)
    private readonly assetAssignmentRepository: Repository<EmployeeAssetAssignment>,
    @InjectRepository(EmployeeTerminationReason)
    private readonly terminationReasonRepository: Repository<EmployeeTerminationReason>,
    @InjectRepository(StoreProbationSetting)
    private readonly probationSettingRepository: Repository<StoreProbationSetting>,
    @InjectRepository(StoreSkill)
    private readonly skillRepository: Repository<StoreSkill>,
    @InjectRepository(StorePayrollPaymentHistory)
    readonly paymentHistoryRepository: Repository<StorePayrollPaymentHistory>,
    @InjectRepository(SalaryFundHistory)
    readonly salaryFundHistoryRepository: Repository<SalaryFundHistory>,
    @InjectRepository(SalaryAdvanceRequest)
    readonly salaryAdvanceRequestRepository: Repository<SalaryAdvanceRequest>,
    @InjectRepository(SalaryAdjustment)
    readonly salaryAdjustmentRepository: Repository<SalaryAdjustment>,
    @InjectRepository(SalaryAdjustmentReason)
    readonly salaryAdjustmentReasonRepository: Repository<SalaryAdjustmentReason>,
    @InjectRepository(EmployeePaymentHistory)
    readonly employeePaymentHistoryRepository: Repository<EmployeePaymentHistory>,
    @InjectRepository(StorePaymentAccount)
    readonly storePaymentAccountRepository: Repository<StorePaymentAccount>,
    @InjectRepository(KpiApprovalRequest)
    private readonly kpiApprovalRequestRepository: Repository<KpiApprovalRequest>,
    @InjectRepository(InventoryReport)
    private readonly inventoryReportRepository: Repository<InventoryReport>,
    @InjectRepository(AssetExportType)
    private readonly assetExportTypeRepository: Repository<AssetExportType>,
    @InjectRepository(ProductExportType)
    private readonly productExportTypeRepository: Repository<ProductExportType>,
    @InjectRepository(StoreApprovalSetting)
    readonly approvalSettingRepository: Repository<StoreApprovalSetting>,
    @InjectRepository(StoreTimekeepingSetting)
    readonly timekeepingSettingRepository: Repository<StoreTimekeepingSetting>,
    @InjectRepository(StorePayrollSetting)
    readonly payrollSettingRepository: Repository<StorePayrollSetting>,
    @InjectRepository(StorePayrollRule)
    readonly payrollRuleRepository: Repository<StorePayrollRule>,
    @InjectRepository(StorePayrollIncrementRule)
    readonly payrollIncrementRuleRepository: Repository<StorePayrollIncrementRule>,
    @InjectRepository(AccountIdentityDocument)
    private readonly identityDocRepository: Repository<AccountIdentityDocument>,
    @InjectRepository(StoreInternalRule)
    private readonly internalRuleRepository: Repository<StoreInternalRule>,
    @InjectRepository(StorePermissionConfig)
    private readonly permissionConfigRepository: Repository<StorePermissionConfig>,
    @InjectRepository(StoreShiftConfig)
    readonly shiftConfigRepository: Repository<StoreShiftConfig>,
    @InjectRepository(CycleShiftTemplate)
    readonly cycleTemplateRepository: Repository<CycleShiftTemplate>,

    @InjectRepository(AccountFinance)
    private readonly financeRepository: Repository<AccountFinance>,
    @InjectRepository(Feedback)
    readonly feedbackRepository: Repository<Feedback>,
    @InjectRepository(EmployeeFace)
    readonly employeeFaceRepository: Repository<EmployeeFace>,
    @InjectRepository(AttendanceLog)
    readonly attendanceLogRepository: Repository<AttendanceLog>,
    @InjectRepository(ShiftChangeRequest)
    readonly shiftChangeRequestRepository: Repository<ShiftChangeRequest>,
    @InjectRepository(BonusWorkRequest)
    readonly bonusWorkRequestRepository: Repository<BonusWorkRequest>,
    private readonly accountsService: AccountsService,
    readonly faceRecognitionService: FaceRecognitionService,
    readonly dataSource: DataSource,
    readonly shiftReminderService: ShiftReminderService,
    // Appended deliberately: this constructor is positional and long, so a new
    // dependency goes on the end where it cannot shift any existing argument.
    readonly notificationsService: NotificationsService,
    // X1 activity log / X6 owner notifications. Optional so the many tests
    // that build this service by hand keep working; hooks no-op without them.
    @Optional()
    private readonly activityLogService?: ActivityLogService,
    @Optional()
    readonly ownerNotificationService?: OwnerNotificationService,
    // "Cách tính giờ công" rules. Optional: without it (or its table) worked
    // time is counted "theo ca", the default.
    @Optional()
    @InjectRepository(StoreWorkedTimeRule)
    readonly workedTimeRuleRepository?: Repository<StoreWorkedTimeRule>,
  ) {}

  /**
   * Writes one activity-log entry (inside `manager`'s transaction when given).
   * Never throws: a log failure must not fail the business action.
   */
  async logActivity(
    manager: EntityManager | null,
    entry: ActivityLogEntry,
  ): Promise<void> {
    if (!this.activityLogService) return;
    try {
      await this.activityLogService.record(manager, entry);
    } catch {
      // record() already swallows and logs; this is belt and braces.
    }
  }

  /** Non-sensitive shift description for activity params. */
  activityShiftParams(slot?: {
    workDate?: string | Date | null;
    startTime?: string | null;
    endTime?: string | null;
    workShift?: { shiftName?: string | null; startTime?: string | null; endTime?: string | null } | null;
  } | null): Record<string, unknown> {
    if (!slot) return {};
    return {
      shiftName: slot.workShift?.shiftName ?? undefined,
      startTime: toActivityHHmm(slot.startTime || slot.workShift?.startTime),
      endTime: toActivityHHmm(slot.endTime || slot.workShift?.endTime),
      workDate: toActivityDate(slot.workDate ?? null),
    };
  }

  /** Type and dates of a leave / late / early request — never its reason. */
  activityLeaveParams(leave: {
    type?: string | null;
    startDate?: string | Date | null;
    endDate?: string | Date | null;
  }): Record<string, unknown> {
    return {
      leaveType: leave.type ?? undefined,
      fromDate: toActivityDate(leave.startDate ?? null),
      toDate: toActivityDate(leave.endDate ?? null),
    };
  }

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
          this.logger.debug(
            `[CreateStore] Auto-geocoded: "${fullAddress}" → lat=${firstResult.lat}, lng=${firstResult.lng}`,
          );
        }
      }

      // Auto generate QR code
      await this.generateStoreQR(savedStore.id);
      this.logger.debug(
        `[CreateStore] Auto-generated QR for store ${savedStore.id}`,
      );
    } catch (err) {
      // Non-blocking: geocode/QR failure should not fail store creation
      this.logger.warn(
        `[CreateStore] Auto-geocode/QR failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return savedStore;
  }

  async updateStore(id: string, data: Partial<Store>, ownerAccountId?: string) {
    const store = await this.findById(id);
    if (!store) throw new NotFoundException('Cửa hàng không tồn tại');
    if (!ownerAccountId || store.ownerAccountId !== ownerAccountId) {
      throw new ForbiddenException('Bạn không có quyền cập nhật cửa hàng này');
    }

    const allowedFields: (keyof Store)[] = [
      'name',
      'avatarUrl',
      'city',
      'ward',
      'addressLine',
      'taxCode',
      'phone',
      'email',
      'industry',
      'employeeRangeLabel',
      'yearsActiveLabel',
    ];
    const safeData: Partial<Store> = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) (safeData as any)[field] = data[field];
    }

    // Auto-geocode address if changed
    try {
      if (safeData.addressLine || safeData.ward || safeData.city) {
        const fullAddress = [
          safeData.addressLine || store.addressLine,
          safeData.ward || store.ward,
          safeData.city || store.city,
        ]
          .filter(Boolean)
          .join(', ');

        if (fullAddress) {
          const geocodeResult = await this.searchPlaces(fullAddress);
          if (geocodeResult.results?.length > 0) {
            const firstResult = geocodeResult.results[0];
            safeData.latitude = firstResult.lat;
            safeData.longitude = firstResult.lng;
          }
        }
      }
    } catch (err) {
      this.logger.warn(
        `[UpdateStore] Auto-geocode failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await this.storeRepository.update(id, safeData);
    return this.findById(id);
  }

  async createDefaultProbationSetting(storeId: string) {
    // Số ngày, số ca và hai checklist từng nằm ở đây; chúng là *điều kiện* lên
    // bậc nên đã chuyển sang lộ trình employment_type dưới dạng
    // store_rung_criteria. Dòng này nay chỉ mang chính sách.
    const defaultSetting = this.probationSettingRepository.create({
      storeId,
      notifyEvaluation: false,
      notifyResultToEmployee: false,
      autoCloseChecklist: false,
      completionBonus: 0,
      isActive: true,
    });
    return this.probationSettingRepository.save(defaultSetting);
  }

  /**
   * Store ids the account may read data for: stores it owns, plus stores where
   * it holds a non-terminated employee profile.
   *
   * Used to scope list endpoints whose filters are all optional, so that
   * "no filter supplied" means "my data" rather than "every tenant's data".
   */
  /**
   * The acting user's employee profile in the store that owns `profileId`,
   * or null when they have none (a store owner typically has no employee
   * profile of their own).
   *
   * Asset custody routes previously stamped a hardcoded profile UUID as the
   * actor, so every handover in the system attributed to one fabricated
   * identity and the audit trail was meaningless.
   */
  async resolveActingProfileId(
    accountId: string | undefined,
    targetProfileId: string,
  ): Promise<string | null> {
    if (!accountId) return null;
    const target = await this.profileRepository.findOne({
      where: { id: targetProfileId },
      select: ['id', 'storeId'],
    });
    if (!target) return null;
    const acting = await this.profileRepository.findOne({
      where: { accountId, storeId: target.storeId },
      select: ['id'],
    });
    return acting?.id ?? null;
  }

  /** Same as `resolveActingProfileId`, addressed by an asset assignment. */
  async resolveActingProfileIdForAssignment(
    accountId: string | undefined,
    assignmentId: string,
  ): Promise<string | null> {
    if (!accountId) return null;
    const assignment = await this.assetAssignmentRepository.findOne({
      where: { id: assignmentId },
      select: ['id', 'employeeProfileId'],
    });
    if (!assignment) return null;
    return this.resolveActingProfileId(
      accountId,
      assignment.employeeProfileId,
    );
  }

  async getAccessibleStoreIds(accountId: string): Promise<string[]> {
    if (!accountId) return [];
    const [owned, employed] = await Promise.all([
      this.storeRepository.find({
        where: { ownerAccountId: accountId },
        select: ['id'],
      }),
      this.profileRepository.find({
        where: {
          accountId,
          // A store the account merely applied to is not one they belong to.
          employmentStatus: In([...EMPLOYED_STATUSES]),
        },
        select: ['storeId'],
      }),
    ]);
    return [
      ...new Set([
        ...owned.map((store) => store.id),
        ...employed.map((profile) => profile.storeId),
      ]),
    ];
  }

  async findAllByOwner(ownerId: string) {
    return this.storeRepository.find({ where: { ownerAccountId: ownerId } });
  }

  async findById(id: string) {
    return this.storeRepository.findOne({ where: { id } });
  }

  async discoverStores(
    accountId: string,
    query: StoreDiscoveryQueryDto,
  ): Promise<StoreDiscoveryPageDto> {
    const account = await this.accountsService.findById(accountId);
    if (!account || account.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'STORE_DISCOVERY_NOT_AVAILABLE',
        message: 'Tìm kiếm cửa hàng không khả dụng cho tài khoản này.',
      });
    }
    const activeMembership = await this.profileRepository
      .createQueryBuilder('profile')
      .where('profile.accountId = :accountId', { accountId })
      .andWhere('profile.employmentStatus != :terminated', {
        terminated: EmploymentStatus.TERMINATED,
      })
      .getExists();
    if (activeMembership) {
      throw new ForbiddenException({
        code: 'STORE_DISCOVERY_NOT_AVAILABLE',
        message: 'Tài khoản đã trực thuộc cửa hàng.',
      });
    }

    const normalizedQuery = normalizeStoreSearchText(query.q);
    const tokens = normalizedQuery.split(' ').filter(Boolean).slice(0, 20);
    if (!tokens.length) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Từ khóa tìm kiếm không hợp lệ.',
      });
    }
    const expression = `trim(regexp_replace(translate(lower(concat_ws(' ', "store"."name", "store"."address_line", "store"."ward", "store"."city")), '${VIETNAMESE_SEARCH_FROM}', '${VIETNAMESE_SEARCH_TO}'), '[^a-z0-9]+', ' ', 'g'))`;
    const builder = this.storeRepository
      .createQueryBuilder('store')
      .select('store.id', 'id')
      .addSelect('store.name', 'name')
      .addSelect('store.avatarUrl', 'avatarUrl')
      .addSelect('store.addressLine', 'addressLine')
      .addSelect('store.ward', 'ward')
      .addSelect('store.city', 'city')
      .where('store.status = :status', { status: StoreStatus.ACTIVE })
      .andWhere('"store"."deleted_at" IS NULL');
    tokens.forEach((token, index) => {
      builder.andWhere(`${expression} LIKE :token${index} ESCAPE E'\\\\'`, {
        [`token${index}`]: `%${escapeLikeToken(token)}%`,
      });
    });
    const offset = (query.page - 1) * query.limit;
    const rows = await builder
      .orderBy(
        `translate(lower("store"."name"), '${VIETNAMESE_SEARCH_FROM}', '${VIETNAMESE_SEARCH_TO}')`,
        'ASC',
      )
      .addOrderBy('store.id', 'ASC')
      .offset(offset)
      .limit(query.limit + 1)
      .getRawMany<{
        id: string;
        name: string;
        avatarUrl: string | null;
        addressLine: string | null;
        ward: string | null;
        city: string | null;
      }>();
    return {
      items: rows.slice(0, query.limit).map((row) => ({
        id: row.id,
        name: row.name,
        displayAddress:
          [row.addressLine, row.ward, row.city].filter(Boolean).join(', ') ||
          'Chưa cập nhật địa chỉ',
        avatarUrl: row.avatarUrl || null,
      })),
      page: query.page,
      limit: query.limit,
      hasMore: rows.length > query.limit,
    };
  }

  async findExistingEmployeeCandidate(
    storeId: string,
    ownerAccountId: string,
    phone: string,
  ) {
    await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    let account: Account | null;
    try {
      account = await this.accountsService.findByPhone(phone);
    } catch {
      return { eligible: false as const };
    }
    if (!account || account.status !== AccountStatus.ACTIVE) {
      return { eligible: false as const };
    }
    const profiles = await this.profileRepository
      .createQueryBuilder('profile')
      .withDeleted()
      .where('profile.accountId = :accountId', { accountId: account.id })
      .getMany();
    // Only real employment blocks a hire. A PENDING profile elsewhere is the
    // applicant's own pending request, and counting it would have stopped them
    // applying anywhere else — including re-applying after a rejection.
    const isAssigned = profiles.some((profile) =>
      isEmployedStatus(profile.employmentStatus),
    );
    if (isAssigned) {
      return { eligible: false as const };
    }
    // Mirrors `attachExistingEmployee`, so the lookup and the attach agree:
    //  - a live PENDING profile here is an open job application — hire through
    //    the application, or it would stay PENDING;
    //  - a former employee here (terminated or soft-deleted) may be rehired;
    //  - any other profile here is not attachable.
    const atStore = profiles.filter((profile) => profile.storeId === storeId);
    const former = atStore.find(
      (profile) =>
        profile.employmentStatus === EmploymentStatus.TERMINATED ||
        !!profile.deletedAt,
    );
    if (atStore.some((profile) => profile !== former)) {
      return { eligible: false as const };
    }
    const leftAt = former ? (former.leftAt ?? former.deletedAt ?? null) : null;
    const selfieUrl = await this.findCandidateApplicationSelfieUrl(
      storeId,
      account.id,
    );
    return {
      eligible: true as const,
      account: {
        id: account.id,
        fullName: account.fullName || null,
        avatar: account.avatar || null,
        phone: normalizeVietnamPhone(account.phone),
      },
      // Additive. No termination reason here; that stays on the applications
      // card.
      formerEmployee: former
        ? { leftAt: leftAt ? new Date(leftAt).toISOString() : null }
        : null,
      // Additive, nullable: the authenticated selfie route of this account's
      // most recent PENDING or ACCEPTED application *to this store* that
      // still has a selfie (not withdrawn, rejected or redacted). The route
      // itself re-checks that the reader owns the store.
      selfieUrl,
    };
  }

  /**
   * Selfie route of `accountId`'s latest live application at `storeId`, or
   * null. Only called after the caller was verified as the store owner.
   * Best effort: a lookup failure yields null rather than failing the
   * candidate lookup.
   */
  private async findCandidateApplicationSelfieUrl(
    storeId: string,
    accountId: string,
  ): Promise<string | null> {
    try {
      const application = await this.dataSource
        .getRepository(JobApplication)
        .findOne({
          where: {
            storeId,
            accountId,
            status: In([
              JobApplicationStatus.PENDING,
              JobApplicationStatus.ACCEPTED,
            ]),
            selfiePath: Not(IsNull()),
            contactRedactedAt: IsNull(),
          },
          select: ['id', 'storeId', 'selfiePath'],
          order: { createdAt: 'DESC' },
        });
      if (!application || !isSafeSelfieFilename(application.selfiePath)) {
        return null;
      }
      return jobApplicationSelfieUrl(application.storeId, application.id);
    } catch (error) {
      this.logger.warn(
        `[findExistingEmployeeCandidate] selfie lookup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  async assertOwnerStoreAccess(storeId: string, ownerAccountId: string) {
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      select: ['id', 'ownerAccountId'],
    });

    if (!store) {
      throw new NotFoundException('Cửa hàng không tồn tại');
    }
    if (store.ownerAccountId !== ownerAccountId) {
      throw new ForbiddenException('Bạn không có quyền truy cập cửa hàng này');
    }

    return store;
  }

  /**
   * Shift ids an owner writes into cycles, templates or slots must belong to
   * the store and still be in the settings list: a deleted (hidden) shift
   * takes no new days. Pass `rejectInactive: false` for a reference kept
   * unchanged from before the delete.
   */
  async assertWorkShiftsBelongToStore(
    storeId: string,
    workShiftIds: string[],
    { rejectInactive = true }: { rejectInactive?: boolean } = {},
  ) {
    const uniqueIds = [...new Set(workShiftIds.filter(Boolean))];
    if (!uniqueIds.length) return;
    const shifts = await this.workShiftRepository.find({
      where: { id: In(uniqueIds), storeId },
      select: ['id', 'isActive'],
    });
    if (shifts.length !== uniqueIds.length) {
      throw new ForbiddenException(
        'Một hoặc nhiều ca làm không thuộc cửa hàng này',
      );
    }
    if (rejectInactive && shifts.some((shift) => shift.isActive === false)) {
      throw new BadRequestException({
        code: WORK_SHIFT_INACTIVE_CODE,
        message: WORK_SHIFT_INACTIVE_MESSAGE,
      });
    }
  }

  /** Allow an owner to inspect store staff, or a staff account to inspect only itself. */
  async assertEmployeeCalendarAccess(
    profileId: string,
    accountId: string,
    expectedStoreId?: string,
    forbiddenMessage = 'Bạn chỉ có thể xem lịch của chính mình',
  ) {
    const { profile } = await this.resolveEmployeeOwnerOrSelf(
      profileId,
      accountId,
      expectedStoreId,
      forbiddenMessage,
    );
    return profile;
  }

  /**
   * Employee record reads (profile detail, performance, assets, contracts…)
   * are owner-or-self: the owner of the employee's store, or the employee's
   * own account while employed. A coworker, the owner of another store, or a
   * terminated / pending self is refused. `isOwner` lets callers strip
   * owner-private fields from a self read.
   */
  async assertEmployeeRecordAccess(
    profileId: string,
    accountId: string,
    expectedStoreId?: string,
    forbiddenMessage = 'Bạn chỉ có thể xem hồ sơ của chính mình',
  ) {
    return this.resolveEmployeeOwnerOrSelf(
      profileId,
      accountId,
      expectedStoreId,
      forbiddenMessage,
    );
  }

  private async resolveEmployeeOwnerOrSelf(
    profileId: string,
    accountId: string,
    expectedStoreId: string | undefined,
    forbiddenMessage: string,
  ): Promise<{ profile: EmployeeProfile; isOwner: boolean }> {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      select: ['id', 'storeId', 'accountId', 'employmentStatus'],
    });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');
    if (expectedStoreId && profile.storeId !== expectedStoreId) {
      throw new ForbiddenException('Nhân viên không thuộc cửa hàng này');
    }

    const store = await this.storeRepository.findOne({
      where: { id: profile.storeId },
      select: ['id', 'ownerAccountId'],
    });
    if (!store) throw new NotFoundException('Cửa hàng không tồn tại');
    if (store.ownerAccountId === accountId) return { profile, isOwner: true };
    // Any employed member (probation and on-leave included) reads their own.
    if (
      profile.accountId !== accountId ||
      !isEmployedStatus(profile.employmentStatus)
    ) {
      throw new ForbiddenException(forbiddenMessage);
    }
    return { profile, isOwner: false };
  }

  /**
   * Salary data (payslips, live estimate) is readable by the owner of the
   * employee's store or by the employee's own account — never a coworker.
   */
  async assertEmployeeSalaryAccess(
    profileId: string,
    accountId: string,
    expectedStoreId?: string,
  ) {
    return this.assertEmployeeCalendarAccess(
      profileId,
      accountId,
      expectedStoreId,
      'Bạn chỉ có thể xem lương của chính mình',
    );
  }

  /**
   * Strict self-service access to an employee profile. Used by operations that
   * only the employee may perform for themselves — face enrollment (which
   * replaces the biometric template attendance relies on) and submitting or
   * cancelling their own requests. The owning store is resolved from the
   * profile rather than trusted from the request body.
   */
  async assertEmployeeSelfAccess(
    employeeProfileId: string,
    accountId: string,
    expectedStoreId?: string,
    message = 'Bạn chỉ có thể thao tác cho chính mình',
  ) {
    if (!employeeProfileId) {
      throw new BadRequestException('Thiếu thông tin nhân viên');
    }
    const profile = await this.profileRepository.findOne({
      where: { id: employeeProfileId },
      select: ['id', 'storeId', 'accountId', 'employmentStatus'],
    });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');
    if (!accountId || profile.accountId !== accountId) {
      throw new ForbiddenException(message);
    }
    if (expectedStoreId && profile.storeId !== expectedStoreId) {
      throw new ForbiddenException('Nhân viên không thuộc cửa hàng này');
    }
    if (profile.employmentStatus === EmploymentStatus.TERMINATED) {
      throw new ForbiddenException(
        'Nhân viên đã ngừng làm việc tại cửa hàng này',
      );
    }
    return profile;
  }

  /**
   * Who is reading store data: the owner, or an employed member (with their
   * profile at this store). 404 for a missing store, 403 for anyone else —
   * the same rule as `StoreAccessResolver`.
   */
  async resolveStoreViewer(
    storeId: string,
    accountId: string | undefined,
  ): Promise<
    { isOwner: true; profileId: null } | { isOwner: false; profileId: string }
  > {
    if (!accountId) {
      throw new ForbiddenException('Bạn không có quyền truy cập cửa hàng này');
    }
    if (!storeId || !isUUID(storeId)) {
      throw new BadRequestException('storeId không hợp lệ');
    }
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      select: ['id', 'ownerAccountId'],
    });
    if (!store) {
      throw new NotFoundException('Cửa hàng không tồn tại');
    }
    if (store.ownerAccountId === accountId) {
      return { isOwner: true, profileId: null };
    }
    const profile = await this.profileRepository.findOne({
      where: {
        storeId,
        accountId,
        employmentStatus: In([...EMPLOYED_STATUSES]),
      },
      select: ['id'],
    });
    if (!profile) {
      throw new ForbiddenException('Bạn không có quyền truy cập cửa hàng này');
    }
    return { isOwner: false, profileId: profile.id };
  }

  /**
   * For owner tooling that names no store (contract-template file upload and
   * placeholder extraction): the caller must own at least one store.
   */
  async assertOwnsAnyStore(accountId: string | undefined): Promise<void> {
    const ownsStore = accountId
      ? await this.storeRepository.exists({
          where: { ownerAccountId: accountId },
        })
      : false;
    if (!ownsStore) {
      throw new ForbiddenException({
        code: 'STORE_OWNER_REQUIRED',
        message: 'Chỉ chủ cửa hàng mới được thực hiện thao tác này',
      });
    }
  }

  async assertStoreRevenueReportAccess(storeId: string, accountId: string) {
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      select: ['id', 'ownerAccountId'],
    });

    if (!store) {
      throw new NotFoundException('Cửa hàng không tồn tại');
    }
    if (store.ownerAccountId === accountId) {
      return store;
    }

    const activeEmployee = await this.profileRepository.findOne({
      where: {
        storeId,
        accountId,
        employmentStatus: EmploymentStatus.ACTIVE,
      },
      select: ['id'],
    });
    if (!activeEmployee) {
      throw new ForbiddenException('Bạn không có quyền truy cập cửa hàng này');
    }

    return store;
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
      const parsed = parseVnMonthInput(monthStr);
      if (!parsed) throw new BadRequestException('Tháng không hợp lệ');
      targetMonth = toMonthMarker(parsed);
    } else {
      targetMonth = toMonthMarker(vnMonthOf());
    }

    // Get all employees in the store
    const employees = await this.profileRepository.find({
      where: { storeId },
      select: ['id'],
    });

    const employeeIds = employees.map((e) => e.id);

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
    const type = this.employeeTypeRepository.create({
      ...this.creatableRow(this.employeeTypeRepository, data),
      storeId,
    });
    return this.employeeTypeRepository.save(type);
  }

  async getEmployeeTypes(storeId: string) {
    // Đây lại là danh mục thuần. Thứ tự bậc nay nằm ở store_ladder_rungs.level
    // và được đọc qua CareerLadderService, không còn trên bảng này.
    return this.employeeTypeRepository.find({
      where: { storeId, isActive: true },
      order: { name: 'ASC' },
    });
  }

  /**
   * Edits one rung of the store's promotion ladder.
   *
   * The ladder is not a table of its own: `getEmployeeProgression` derives it
   * from the store's employee types ordered by `level`, and the requirement
   * columns on each type are its promotion criteria. Owners could create types
   * but never change or remove one, so a ladder was write-once.
   */
  async updateEmployeeType(
    storeId: string,
    typeId: string,
    data: Partial<StoreEmployeeType>,
  ) {
    const type = await this.employeeTypeRepository.findOne({
      where: { id: typeId, storeId },
    });
    if (!type) throw new NotFoundException('Không tìm thấy bộ phận');

    // storeId and id are fixed by the route; anything else in the body would
    // let a caller move a rung into another store.
    const { id: _id, storeId: _storeId, ...patch } = data as any;
    Object.assign(type, patch);
    return this.employeeTypeRepository.save(type);
  }

  /**
   * Retires a rung. Soft-disabled rather than deleted, because employee
   * profiles reference it — a hard delete would orphan every employee holding
   * that type and break their progression view.
   */
  async deleteEmployeeType(storeId: string, typeId: string) {
    const type = await this.employeeTypeRepository.findOne({
      where: { id: typeId, storeId },
    });
    if (!type) throw new NotFoundException('Không tìm thấy bộ phận');

    const inUse = await this.profileRepository.count({
      where: { storeId, employeeTypeId: typeId },
    });
    if (inUse > 0) {
      // Hidden from the ladder but still resolvable for the people on it.
      type.isActive = false;
      await this.employeeTypeRepository.save(type);
      return { id: typeId, deactivated: true, employeesAffected: inUse };
    }

    await this.employeeTypeRepository.remove(type);
    return { id: typeId, deactivated: false, employeesAffected: 0 };
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
  async upsertProbationSetting(
    storeId: string,
    data: Partial<StoreProbationSetting>,
  ) {
    let setting = await this.probationSettingRepository.findOne({
      where: { storeId },
    });

    if (setting) {
      Object.assign(setting, data);
    } else {
      setting = this.probationSettingRepository.create({ ...data, storeId });
    }

    return this.probationSettingRepository.save(setting);
  }

  async getProbationSetting(storeId: string) {
    const setting =
      (await this.probationSettingRepository.findOne({
        where: { storeId },
      })) ?? (await this.createDefaultProbationSetting(storeId));
    // Không còn phần gieo checklist mặc định: nội dung đánh giá thử việc nay là
    // điều kiện của bậc trên lộ trình, do CareerLadderService quản lý.
    //
    // TẠM THỜI: bản app chủ trước khi có lộ trình render thẳng
    // `settings.attendanceChecklist.map(...)` và `probationDays.toString()`,
    // nên thiếu các trường này là màn Đánh giá thử việc sập. Trả chúng ở dạng
    // rỗng cho tới khi mọi máy đã nhận bản OTA mới, rồi bỏ khối này.
    return {
      ...setting,
      probationDays: 0,
      probationShifts: 0,
      attendanceChecklist: [],
      attitudeChecklist: [],
    };
  }

  // --- Store Skills ---

  async createSkill(storeId: string, data: CreateStoreSkillDto) {
    // Lộ trình v2: kỹ năng thuộc bộ phận và có thứ tự, chỉ tạo trên màn mới.
    if (await isCareerV2Enabled(this.dataSource.manager, storeId)) {
      throw appUpdateRequired();
    }
    const skill = this.skillRepository.create({
      ...data,
      storeId,
    });
    return this.skillRepository.save(skill);
  }

  async getSkills(storeId: string) {
    return this.skillRepository.find({
      where: { storeId },
      order: { createdAt: 'DESC' as const },
    });
  }

  async updateSkill(skillId: string, data: UpdateStoreSkillDto) {
    const skill = await this.skillRepository.findOne({
      where: { id: skillId },
    });
    if (!skill) throw new NotFoundException('Không tìm thấy kỹ năng');

    Object.assign(skill, data);
    return this.skillRepository.save(skill);
  }

  async deleteSkill(skillId: string) {
    const skill = await this.skillRepository.findOne({
      where: { id: skillId },
    });
    if (!skill) throw new NotFoundException('Không tìm thấy kỹ năng');
    // Xoá cứng ở đây sẽ mất lịch sử đạt kỹ năng của lộ trình v2 (D10).
    if (await isCareerV2Enabled(this.dataSource.manager, skill.storeId)) {
      throw appUpdateRequired();
    }
    // Cửa hàng chưa bật v2: dòng tiến độ duy nhất là dòng migration chép từ
    // `skill_id` của hồ sơ; xoá theo kỹ năng như mô hình cũ, kẻo khoá ngoại
    // chặn việc xoá.
    await this.dataSource.query('DELETE FROM employee_skill_evaluations WHERE skill_id = $1', [skill.id]);
    await this.dataSource.query('DELETE FROM employee_skill_progress WHERE skill_id = $1', [skill.id]);

    return this.skillRepository.remove(skill);
  }

  async assignSkillToEmployee(profileId: string, skillId: string | null) {
    const employee = await this.profileRepository.findOne({
      where: { id: profileId },
    });
    if (!employee) throw new NotFoundException('Không tìm thấy nhân viên');
    // Lộ trình v2: kỹ năng đạt qua đánh giá / xác nhận, không gán tay.
    if (await isCareerV2Enabled(this.dataSource.manager, employee.storeId)) {
      throw appUpdateRequired();
    }

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
  async addEmployee(
    storeId: string,
    accountId: string,
    data: EmployeeWorkAssignmentDto,
    ownerAccountId: string,
  ) {
    return this.attachExistingEmployee(
      storeId,
      ownerAccountId,
      data,
      { accountId },
    );
  }

  async addEmployeeFromAccount(
    storeId: string,
    ownerAccountId: string,
    data: AddExistingEmployeeDto,
  ) {
    return this.attachExistingEmployee(storeId, ownerAccountId, data, {
      phone: data.phone,
    });
  }

  private employeeAttachConflict(code = 'EMPLOYEE_ACCOUNT_NOT_ELIGIBLE') {
    return new ConflictException({
      code,
      message:
        code === 'EMPLOYEE_REHIRE_REQUIRES_RESTORE'
          ? 'Tài khoản đã có lịch sử tại cửa hàng. Vui lòng dùng chức năng khôi phục nhân viên.'
          : 'Tài khoản không còn đủ điều kiện để thêm vào cửa hàng.',
    });
  }

  private async attachExistingEmployee(
    storeId: string,
    ownerAccountId: string,
    data: EmployeeWorkAssignmentDto,
    lookup: { accountId?: string; phone?: string },
  ) {
    await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    const attached = await this.dataSource.transaction(async (manager) => {
      const store = await manager.findOne(Store, {
        where: { id: storeId, ownerAccountId },
      });
      if (!store) {
        throw new ForbiddenException({
          code: 'STORE_ACCESS_DENIED',
          message: 'Bạn không có quyền truy cập cửa hàng này.',
        });
      }
      let account: Account | null = null;
      if (lookup.accountId) {
        account = await manager.findOne(Account, {
          where: { id: lookup.accountId },
          lock: { mode: 'pessimistic_write' },
        });
      } else if (lookup.phone) {
        try {
          account = await this.accountsService.findByPhone(
            lookup.phone,
            manager,
            true,
          );
        } catch {
          account = null;
        }
      }
      if (!account || account.status !== AccountStatus.ACTIVE) {
        throw this.employeeAttachConflict();
      }
      const profiles = await manager
        .getRepository(EmployeeProfile)
        .createQueryBuilder('profile')
        .withDeleted()
        .where('profile.accountId = :accountId', { accountId: account.id })
        .getMany();
      // A live PENDING profile at this store is the applicant's own job
      // application waiting to be approved — and approving it is exactly what
      // this call does. It is promoted in place rather than read as a prior
      // stint, which would have made every acceptance fail with
      // EMPLOYEE_REHIRE_REQUIRES_RESTORE.
      const pendingAtStore = profiles.find(
        (profile) =>
          profile.storeId === storeId &&
          profile.employmentStatus === EmploymentStatus.PENDING &&
          !profile.deletedAt,
      );
      // A former employee's profile — terminated, or soft-deleted when they
      // were removed from the list. Hiring them again revives that row rather
      // than refusing, so a past stint is not a permanent ban.
      const formerAtStore = profiles.find(
        (profile) =>
          profile.storeId === storeId &&
          profile.id !== pendingAtStore?.id &&
          (profile.employmentStatus === EmploymentStatus.TERMINATED ||
            !!profile.deletedAt),
      );
      const reusableId = pendingAtStore?.id ?? formerAtStore?.id;
      if (
        profiles.some(
          (profile) => profile.storeId === storeId && profile.id !== reusableId,
        )
      ) {
        throw this.employeeAttachConflict('EMPLOYEE_REHIRE_REQUIRES_RESTORE');
      }
      // The applicant's own PENDING profile must not read as "already hired",
      // or accepting their application would fail with a conflict.
      if (profiles.some((profile) => isEmployedStatus(profile.employmentStatus))) {
        throw this.employeeAttachConflict();
      }
      // Reviving a former employee starts a fresh stint; promoting the
      // applicant's own PENDING profile does not.
      const revivesFormerStint = !pendingAtStore && !!formerAtStore;
      const initialized = await this.initializeEmployeeProfile(
        manager,
        storeId,
        account.id,
        data,
        reusableId,
        { revivesFormerStint },
      );
      // Promoting the applicant's own PENDING profile = accepting a job
      // application; reviving a former stint = rehire; otherwise a new hire.
      const hiredProfile = initialized.profile;
      const hireAction = revivesFormerStint
        ? ACTIVITY_ACTIONS.EMPLOYEE_REHIRED
        : ACTIVITY_ACTIONS.EMPLOYEE_ADDED;
      await this.logActivity(manager, {
        storeId,
        actorAccountId: ownerAccountId,
        subjectEmployeeProfileId: hiredProfile.id,
        action: hireAction,
        resourceType: 'employee',
        resourceId: hiredProfile.id,
        params: revivesFormerStint
          ? { mode: 'rehire' }
          : { source: pendingAtStore ? 'application' : 'account' },
        idempotencyKey: `${hireAction}:${hiredProfile.id}:${new Date(
          hiredProfile.joinedAt ?? Date.now(),
        ).getTime()}`,
      });
      return {
        profileId: initialized.profile.id,
        rehire: {
          revived: revivesFormerStint,
          currentMonthPayslipLocked: initialized.currentMonthPayslipLocked,
        },
      };
    });
    // `rehire` is additive: existing clients read the result for truthiness
    // or its `profile`, and ignore unknown keys.
    return {
      ...(await this.getEmployeeById(attached.profileId)),
      rehire: attached.rehire,
    };
  }

  private invalidStoreReference(): BadRequestException {
    return new BadRequestException({
      code: 'INVALID_STORE_REFERENCE',
      message: 'Thông tin công việc không thuộc cửa hàng đã chọn.',
    });
  }

  private async assertEmployeeReferences(
    manager: EntityManager,
    storeId: string,
    data: EmployeeWorkAssignmentDto,
  ): Promise<void> {
    const checks: Array<[string | undefined, any]> = [
      [data.storeRoleId, StoreRole],
      [data.employeeTypeId, StoreEmployeeType],
      [data.workShiftId, WorkShift],
      [data.skillId, StoreSkill],
    ];
    for (const [id, entity] of checks) {
      if (!id) continue;
      const exists = await manager.exists(entity, { where: { id, storeId } });
      if (!exists) throw this.invalidStoreReference();
    }
    // A new hire's default shift comes from the settings list; a deleted
    // (hidden) shift is no longer offered there.
    if (
      data.workShiftId &&
      (await manager.exists(WorkShift, {
        where: { id: data.workShiftId, storeId, isActive: false },
      }))
    ) {
      throw new BadRequestException({
        code: WORK_SHIFT_INACTIVE_CODE,
        message: WORK_SHIFT_INACTIVE_MESSAGE,
      });
    }
  }

  /**
   * Loại nhân viên và trạng thái cho một người vừa được tuyển.
   *
   * Trước đây việc này do `store_probation_settings.probation_days` quyết
   * định: khác 0 thì mọi người mới đều vào thử việc, bằng 0 thì không ai vào
   * cả — và trên thực tế mọi cửa hàng đều để 0 nên chưa từng có ai ở trạng
   * thái thử việc. Nay nó là bậc điểm-vào của lộ trình loại nhân viên, và hạn
   * thử việc lấy từ điều kiện `days_in_rung` của chính bậc đó.
   *
   * Truy vấn thẳng qua `manager` chứ không gọi CareerLadderService, để
   * StoresService không phải nhận thêm phụ thuộc vào constructor vốn đã rất lớn.
   */
  private async resolveHireEmploymentType(
    manager: EntityManager,
    storeId: string,
    requestedTypeId?: string | null,
  ): Promise<{
    employeeTypeId: string | null;
    employmentStatus: EmploymentStatus;
    probationEndsAt: Date | undefined;
  }> {
    let typeId = requestedTypeId ?? null;
    let rungId: string | null = null;

    const ladder = await manager.findOne(StoreLadder, {
      where: {
        storeId,
        dimension: LadderDimension.EMPLOYMENT_TYPE,
        isActive: true,
      },
    });

    if (ladder) {
      if (typeId) {
        const rung = await manager.findOne(StoreLadderRung, {
          where: { ladderId: ladder.id, targetId: typeId },
        });
        rungId = rung?.id ?? null;
      } else {
        // Không chọn gì thì vào điểm-vào của lộ trình.
        const entryEdge = await manager.findOne(StoreLadderEdge, {
          where: { ladderId: ladder.id, fromRungId: null as any },
        });
        if (entryEdge) {
          const rung = await manager.findOne(StoreLadderRung, {
            where: { id: entryEdge.toRungId },
          });
          if (rung) {
            rungId = rung.id;
            typeId = rung.targetId;
          }
        }
      }
    }

    if (!typeId) {
      return {
        employeeTypeId: null,
        employmentStatus: EmploymentStatus.ACTIVE,
        probationEndsAt: undefined,
      };
    }

    const type = await manager.findOne(StoreEmployeeType, {
      where: { id: typeId },
    });
    if (!type?.isProbation) {
      return {
        employeeTypeId: typeId,
        employmentStatus: EmploymentStatus.ACTIVE,
        probationEndsAt: undefined,
      };
    }

    // "Days in rung" usually sits on the rung after probation (Chính thức),
    // not on the probation rung itself; see computeProbationEndsAt.
    let probationEndsAt: Date | undefined;
    if (rungId) {
      probationEndsAt =
        (await computeProbationEndsAt(manager, rungId, new Date())) ??
        undefined;
    }

    return {
      employeeTypeId: typeId,
      employmentStatus: EmploymentStatus.PROBATION,
      probationEndsAt,
    };
  }

  private async initializeEmployeeProfile(
    manager: EntityManager,
    storeId: string,
    accountId: string,
    data: EmployeeWorkAssignmentDto,
    /**
     * Id of the PENDING profile this hire approves, when it came through a job
     * application. Passing it makes `save` update that row instead of
     * inserting a second profile for the same (store, account).
     */
    promoteProfileId?: string,
    options: {
      /**
       * True when `promoteProfileId` is a former employee's row (terminated or
       * soft-deleted) being rehired. The row is kept — one profile per
       * (account, store) — but everything that belonged to the previous stint
       * is closed first and the profile's own state is reset, so the rehire
       * looks like a new employee. False for promoting a PENDING applicant.
       */
      revivesFormerStint?: boolean;
    } = {},
  ): Promise<{ profile: EmployeeProfile; currentMonthPayslipLocked: boolean }> {
    const revivesFormerStint = !!(promoteProfileId && options.revivesFormerStint);
    await this.assertEmployeeReferences(manager, storeId, data);
    // Thử việc nay là một bậc trên lộ trình chứ không còn là một con số ngày
    // của cửa hàng: loại nhân viên được chọn tự nói nó có phải thử việc không,
    // và hạn lấy từ điều kiện days_in_rung của chính bậc đó.
    const { employeeTypeId, employmentStatus, probationEndsAt } =
      await this.resolveHireEmploymentType(manager, storeId, data.employeeTypeId);
    if (revivesFormerStint) {
      // Must run before the new contract and the asset re-issue below: it
      // deactivates the old contract and returns old assets to stock, so
      // re-issuing the same item nets to zero.
      await this.resetFormerStintForRehire(
        manager,
        { id: promoteProfileId as string, storeId, accountId },
        new Date(),
      );
      // Lộ trình v2: đợt làm mới học lại kỹ năng từ đầu.
      await manager.query(
        `UPDATE employee_skill_progress SET deleted_at = $2, updated_at = $2
          WHERE employee_profile_id = $1 AND deleted_at IS NULL`,
        [promoteProfileId, new Date()],
      );
    }
    // Lộ trình v2: hồ sơ thuộc bộ phận của vị trí được chọn; kỹ năng đạt qua
    // đánh giá chứ không chọn lúc tuyển. Khoá chia sẻ cửa hàng để không chen
    // vào giữa một lần xoá đúng vị trí này (career/career-store.ts).
    const careerV2 = await isCareerV2Enabled(manager, storeId);
    if (careerV2 && (data.storeRoleId || data.departmentId)) {
      await lockCareerStore(manager, storeId, 'share');
    }
    const hireRole = data.storeRoleId
      ? await manager.findOne(StoreRole, {
          where: { id: data.storeRoleId, storeId },
          select: ['id', 'departmentId'],
        })
      : null;
    if (careerV2 && data.storeRoleId && !hireRole) {
      throw new BadRequestException('Vị trí không còn tồn tại');
    }
    let departmentId = hireRole?.departmentId ?? null;
    // Chưa xếp vị trí: vào thẳng bộ phận được chọn (không phải Cấp 1 hệ
    // thống). Có vị trí thì bộ phận đi theo vị trí — gửi kèm bộ phận khác là
    // client lệch dữ liệu, từ chối thay vì lặng lẽ chọn một bên.
    if (careerV2 && data.departmentId) {
      if (hireRole) {
        if (hireRole.departmentId !== data.departmentId) {
          throw new BadRequestException('Vị trí không thuộc bộ phận đã chọn');
        }
      } else {
        const department = await manager.findOne(StoreDepartment, {
          where: { id: data.departmentId, storeId },
          select: ['id', 'isSystem'],
        });
        if (!department || department.isSystem) {
          throw new BadRequestException('Bộ phận không còn tồn tại');
        }
        departmentId = department.id;
      }
    }
    const hireSkillId = careerV2 ? null : (data.skillId ?? null);
    const profile = await manager.save(
      EmployeeProfile,
      manager.create(EmployeeProfile, {
        ...(promoteProfileId ? { id: promoteProfileId } : {}),
        storeId,
        accountId,
        storeRoleId: data.storeRoleId,
        // Cột nullable trong DB nhưng khai `string` trên entity, nên NULL phải
        // đi vào dưới dạng undefined để TypeORM bỏ qua trường.
        employeeTypeId: employeeTypeId ?? undefined,
        workShiftId: data.workShiftId,
        skillId: hireSkillId ?? undefined,
        departmentId: departmentId ?? undefined,
        joinedAt: new Date(),
        employmentStatus,
        probationEndsAt,
        // Reviving a former employee's row has to undo what ended it. Saving
        // the fields above alone left `deleted_at` in place, so the rehired
        // employee stayed invisible in the store's list and sat in the deleted
        // list instead — hired on paper, gone from every screen.
        ...(promoteProfileId
          ? {
              deletedAt: null,
              leftAt: null,
              terminationReasonId: null,
            }
          : {}),
        // A rehire starts from a clean profile. `undefined` would make
        // TypeORM keep the previous stint's value, so omitted fields are
        // written as explicit nulls here.
        ...(revivesFormerStint
          ? {
              storeRoleId: (data.storeRoleId ?? null) as any,
              workShiftId: (data.workShiftId ?? null) as any,
              skillId: hireSkillId,
              departmentId,
              // Nullable column typed `string` on the entity.
              employeeTypeId: (employeeTypeId ?? null) as any,
              probationEndsAt: probationEndsAt ?? null,
              capabilityPoints: 0,
              workingStatus: WorkingStatus.OFF,
              preferredShiftTypes: null,
              shiftPreferenceNote: null,
              reminderSettings: null,
            }
          : {}),
      }),
    );

    // Where the hire enters each active ladder; tenure counts from here. A
    // revived (rehired) row gets a fresh event, so the previous stint no
    // longer counts.
    await recordEntryCareerEvents(manager, profile, {
      decidedByAccountId: null,
      note: 'Vào làm',
      effectiveAt: profile.joinedAt ?? new Date(),
    });

    if (data.contract) {
      await this.createContract(profile.id, data.contract, manager);
    }
    // Current Vietnam month, not the server clock's month.
    const vnMonth = vnMonthOf();
    const currentMonth = toMonthMarker(vnMonth);
    const salaryAmount = Number(data.contract?.salaryAmount || 0);
    await this.createOrUpdateMonthlySummary(
      profile.id,
      salaryAmount,
      currentMonth,
      manager,
    );
    if (revivesFormerStint) {
      // `createOrUpdateMonthlySummary` returns an existing row untouched, so a
      // same-month rehire would show the previous stint's counters. This row
      // is display data only (payroll reads assignments); past months stay.
      await manager.update(
        EmployeeMonthlySummary,
        { employeeProfileId: profile.id, month: currentMonth },
        {
          totalShifts: 0,
          completedShifts: 0,
          monthlyWorkHours: 0,
          lateArrivalsCount: 0,
          onTimeArrivalsCount: 0,
          earlyDeparturesCount: 0,
          unauthorizedLeavesCount: 0,
          authorizedLeavesCount: 0,
          estimatedSalary: 0,
          performanceScore: 0,
          totalCompletedShifts: 0,
          totalWorkHours: 0,
          baseSalary: salaryAmount,
        },
      );
    }
    const monthlyPayroll = await this.findOrCreateMonthlyPayroll(
      storeId,
      vnMonth,
      manager,
    );
    const salaryResult = await this.upsertInitialEmployeeSalary(manager, {
      employeeProfileId: profile.id,
      month: currentMonth,
      monthlyPayrollId: monthlyPayroll.id,
      baseSalary: salaryAmount,
      paymentType: data.contract?.paymentType,
    });
    await this.assignInitialAssets(manager, storeId, profile.id, data.assetIds);
    return {
      profile,
      currentMonthPayslipLocked:
        revivesFormerStint && salaryResult === 'locked',
    };
  }

  /**
   * Closes what the previous stint of a former employee left open, inside the
   * rehire transaction. Everything is a status flag — nothing is deleted, and
   * payslips, attendance logs, salary advances and past monthly summaries are
   * never touched.
   *
   *   1. active contracts → inactive (payroll picks the active contract);
   *   2. ASSIGNED assets → RETURNED and restocked (DAMAGED/LOST untouched).
   *      Assets are locked by id ascending, the same order as
   *      `assignInitialAssets`, which runs later in the same transaction;
   *   3. active face registrations → inactive (check-in requires a new one);
   *   4. active memberships in store group chats → removed, except direct
   *      chats and groups the person created (the chat module forbids those
   *      transitions);
   *   5. not-yet-started shift assignments → cancelled (backstop for people
   *      terminated before termination did this itself);
   *   6. requests still PENDING (leave, shift change, swap, KPI approval,
   *      salary advance) → closed, the same backstop via
   *      `closePendingRequestsOfLeaver`.
   */
  private async resetFormerStintForRehire(
    manager: EntityManager,
    p: { id: string; storeId: string; accountId: string },
    now: Date,
  ): Promise<void> {
    const contracts = await manager.update(
      EmployeeContract,
      { employeeProfileId: p.id, isActive: true },
      { isActive: false },
    );

    const held = await manager
      .getRepository(EmployeeAssetAssignment)
      .createQueryBuilder('ea')
      .where('ea.employeeProfileId = :id AND ea.status = :status', {
        id: p.id,
        status: AssetAssignmentStatus.ASSIGNED,
      })
      .setLock('pessimistic_write')
      .getMany();
    if (held.length) {
      const quantityByAsset = new Map<string, number>();
      for (const row of held) {
        quantityByAsset.set(
          row.assetId,
          (quantityByAsset.get(row.assetId) ?? 0) + Number(row.quantity || 0),
        );
      }
      const assetIds = [...quantityByAsset.keys()].sort();
      const assets = await manager
        .getRepository(Asset)
        .createQueryBuilder('asset')
        .where('asset.id IN (:...assetIds)', { assetIds })
        .andWhere('asset.storeId = :storeId', { storeId: p.storeId })
        .orderBy('asset.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();
      for (const asset of assets) {
        asset.currentStock =
          Number(asset.currentStock) + (quantityByAsset.get(asset.id) ?? 0);
        await manager.save(Asset, asset);
      }
      await manager.update(
        EmployeeAssetAssignment,
        { id: In(held.map((row) => row.id)) },
        {
          status: AssetAssignmentStatus.RETURNED,
          returnedDate: now,
          returnNote:
            'Tự động thu hồi khi nhận lại nhân viên (kết thúc đợt làm việc trước)',
        },
      );
    }

    const faces = await manager.update(
      EmployeeFace,
      { employeeProfileId: p.id, isActive: true },
      { isActive: false },
    );

    const chats = await this.removeStoreGroupChatMemberships(
      manager,
      p.storeId,
      p.accountId,
    );

    const shifts = await this.cancelFutureShiftAssignments(manager, p.id, now);
    // Backstop for people terminated before termination closed these: old
    // pending leave/shift/swap/KPI/advance requests must not resurface.
    await this.closePendingRequestsOfLeaver(manager, p.id);

    this.logger.log(
      `[Rehire] profile=${p.id} contracts=${contracts?.affected ?? 0} assets=${held.length} faces=${faces?.affected ?? 0} chats=${chats?.affected ?? 0} shifts=${shifts.length}`,
    );
  }

  /**
   * Marks the account's active memberships in the store's group chats as
   * `removed` (direct chats and groups the account created are kept). Runs in
   * the caller's transaction: at termination, and again at a rehire as a
   * backstop for people terminated before termination did this.
   */
  private removeStoreGroupChatMemberships(
    manager: EntityManager,
    storeId: string,
    accountId: string,
  ) {
    return manager
      .createQueryBuilder()
      .update(ChatGroupMember)
      .set({ status: 'removed' })
      .where('account_id = :accountId', { accountId })
      .andWhere("status = 'active'")
      .andWhere('deleted_at IS NULL')
      .andWhere(
        'group_id IN (SELECT g.id FROM chat_groups g WHERE g.store_id = :storeId AND g.direct_key IS NULL AND g.created_by <> :accountId AND g.deleted_at IS NULL)',
        { storeId, accountId },
      )
      .execute();
  }

  private async assignInitialAssets(
    manager: EntityManager,
    storeId: string,
    profileId: string,
    requestedIds?: string[],
  ): Promise<void> {
    const assetIds = [...new Set(requestedIds || [])].sort();
    if (!assetIds.length) return;
    const assets = await manager
      .getRepository(Asset)
      .createQueryBuilder('asset')
      .where('asset.id IN (:...assetIds)', { assetIds })
      .andWhere('asset.storeId = :storeId', { storeId })
      .orderBy('asset.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
    if (
      assets.length !== assetIds.length ||
      assets.some((asset) => Number(asset.currentStock) <= 0)
    ) {
      throw new ConflictException({
        code: 'ASSET_STOCK_UNAVAILABLE',
        message: 'Một hoặc nhiều tài sản không còn đủ tồn kho.',
      });
    }
    for (const asset of assets) {
      asset.currentStock = Number(asset.currentStock) - 1;
      await manager.save(Asset, asset);
      await manager.save(
        EmployeeAssetAssignment,
        manager.create(EmployeeAssetAssignment, {
          employeeProfileId: profileId,
          assetId: asset.id,
          quantity: 1,
          status: AssetAssignmentStatus.ASSIGNED,
          note: 'Cấp phát ban đầu khi tạo nhân viên',
        }),
      );
    }
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
        'department',
        'workShift',
        'contracts',
        'store',
      ],
    });

    if (!profile) return null;

    // Only the current stint: a rehired employee's previous contracts and
    // activity stay in the database but are not shown as current. The active
    // contract comes first, so clients reading `contracts[0]` get it.
    const floor = stintFloor(profile.joinedAt);
    profile.contracts = currentStintContracts(profile.contracts, floor);

    // 1. Lấy thống kê tháng hiện tại (tháng Việt Nam)
    const currentMonth = toMonthMarker(vnMonthOf());
    const summary = await this.monthlySummaryRepository.findOne({
      where: {
        employeeProfileId: profileId,
        month: currentMonth,
      },
    });

    // 2. Lấy hoạt động gần đây (lịch sử chấm công)
    const assignments = await this.shiftAssignmentRepository.find({
      where: {
        employeeId: profileId,
        ...(floor ? { createdAt: MoreThanOrEqual(floor) } : {}),
      },
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
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
    });
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

  /**
   * Chủ cửa hàng sửa thông tin một nhân viên của cửa hàng mình (route có
   * @StoreOwnerOnly + StoreResourceAccessGuard định vị cửa hàng qua hồ sơ).
   *
   * - Trường tài khoản (họ tên, giới tính, ngày sinh, email, địa chỉ, tình
   *   trạng hôn nhân, CCCD, ngân hàng) là của TÀI KHOẢN nhân viên — dùng chung
   *   mọi cửa hàng họ làm và là thứ họ thấy trong app nhân viên. Không có số
   *   điện thoại: đó là tài khoản đăng nhập.
   * - Hình thức làm việc đi qua changeEmploymentType (trạng thái thử việc + sự
   *   kiện lộ trình), ca mặc định chỉ nhận ca còn dùng của chính cửa hàng.
   *
   * Một transaction, hồ sơ khoá FOR UPDATE (cùng khoá với advance()): đổi hình
   * thức làm việc không chen giữa một lần duyệt lên bậc. Nhật ký chỉ ghi tên
   * các nhóm trường đã đổi, không ghi giá trị (CCCD, ngân hàng là dữ liệu nhạy cảm).
   */
  async updateEmployeeByOwner(
    profileId: string,
    dto: UpdateEmployeeByOwnerDto,
    ownerAccountId: string,
  ) {
    const has = (key: keyof UpdateEmployeeByOwnerDto) => dto[key] !== undefined;
    return this.dataSource.transaction(async (manager) => {
      const profile = await manager.findOne(EmployeeProfile, {
        where: { id: profileId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');
      const account = await manager.findOne(Account, { where: { id: profile.accountId } });
      if (!account) throw new NotFoundException('Không tìm thấy tài khoản nhân viên');

      const changed: string[] = [];

      // 1. Tài khoản
      const accountUpdate: Partial<Account> = {};
      // Cột `date` có thể đọc ra là chuỗi hoặc Date (nửa đêm giờ máy chủ):
      // so theo YYYY-MM-DD lấy bằng giờ địa phương — toISOString() sẽ lùi
      // một ngày ở múi +07.
      const ymd = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const plain = (v: unknown) => (v instanceof Date ? ymd(v) : v === undefined ? null : v);
      const setAccount = <K extends keyof Account>(key: K, value: Account[K], label: string) => {
        if (plain(account[key]) === plain(value)) return;
        accountUpdate[key] = value;
        changed.push(label);
      };
      if (has('fullName')) setAccount('fullName', dto.fullName as string, 'Họ tên');
      if (has('gender')) setAccount('gender', dto.gender as string, 'Giới tính');
      if (has('birthday')) {
        const birthday = dto.birthday ? dto.birthday.slice(0, 10) : null;
        const current = account.birthday ? String(plain(account.birthday)).slice(0, 10) : null;
        if (current !== birthday) {
          accountUpdate.birthday = birthday as any;
          changed.push('Ngày sinh');
        }
      }
      if (has('address')) setAccount('address', (dto.address ?? null) as any, 'Địa chỉ');
      if (has('maritalStatus')) {
        setAccount('maritalStatus', (dto.maritalStatus ?? null) as any, 'Tình trạng hôn nhân');
      }
      if (has('email')) {
        const email = dto.email ? dto.email.toLowerCase() : null;
        if (email && email !== (account.email ?? '').toLowerCase()) {
          const taken = await manager
            .createQueryBuilder(Account, 'a')
            .where('LOWER(a.email) = :email', { email })
            .andWhere('a.id <> :id', { id: account.id })
            .getExists();
          if (taken) {
            throw new ConflictException({
              code: 'EMAIL_TAKEN',
              message: 'Email này đã được dùng cho một tài khoản khác',
            });
          }
        }
        setAccount('email', email as any, 'Email');
      }
      if (Object.keys(accountUpdate).length) {
        await manager.update(Account, { id: account.id }, accountUpdate as any);
      }

      // 2. Giấy tờ (CCCD) — chỉ số giấy tờ; ảnh do nhân viên tự cập nhật.
      if (has('identityCardNumber')) {
        const documentNumber = dto.identityCardNumber ?? null;
        const identity = await manager.findOne(AccountIdentityDocument, {
          where: { accountId: account.id },
        });
        if ((identity?.documentNumber ?? null) !== documentNumber) {
          if (identity) {
            await manager.update(AccountIdentityDocument, { id: identity.id }, {
              documentNumber: documentNumber as any,
            });
          } else if (documentNumber) {
            await manager.save(
              AccountIdentityDocument,
              manager.create(AccountIdentityDocument, {
                accountId: account.id,
                docType: 'CCCD',
                verifiedStatus: VerifiedStatus.VERIFIED,
                documentNumber,
              } as any),
            );
          }
          changed.push('CCCD');
        }
      }

      // 3. Ngân hàng
      if (has('bankName') || has('bankNumber')) {
        const finance = await manager.findOne(AccountFinance, { where: { accountId: account.id } });
        const financeUpdate: Record<string, string | null> = {};
        if (has('bankName') && (finance?.bankName ?? null) !== (dto.bankName ?? null)) {
          financeUpdate.bankName = dto.bankName ?? null;
        }
        if (has('bankNumber') && (finance?.bankNumber ?? null) !== (dto.bankNumber ?? null)) {
          financeUpdate.bankNumber = dto.bankNumber ?? null;
        }
        if (Object.keys(financeUpdate).length) {
          if (finance) {
            await manager.update(AccountFinance, { accountId: account.id }, financeUpdate as any);
          } else {
            await manager.save(
              AccountFinance,
              manager.create(AccountFinance, { accountId: account.id, ...financeUpdate } as any),
            );
          }
          changed.push('Ngân hàng');
        }
      }

      // 4. Hồ sơ tại cửa hàng
      let profileChanged = false;
      if (has('workShiftId') && (profile.workShiftId ?? null) !== (dto.workShiftId ?? null)) {
        if (dto.workShiftId) {
          const shift = await manager.findOne(WorkShift, {
            where: { id: dto.workShiftId, storeId: profile.storeId },
            select: ['id', 'isActive'],
          });
          if (!shift) throw this.invalidStoreReference();
          if (!shift.isActive) {
            throw new BadRequestException({
              code: WORK_SHIFT_INACTIVE_CODE,
              message: WORK_SHIFT_INACTIVE_MESSAGE,
            });
          }
        }
        profile.workShiftId = (dto.workShiftId ?? null) as any;
        profileChanged = true;
        changed.push('Ca làm việc');
      }
      if (has('employeeTypeId') && (profile.employeeTypeId ?? null) !== (dto.employeeTypeId ?? null)) {
        if (dto.employeeTypeId) {
          const exists = await manager.exists(StoreEmployeeType, {
            where: { id: dto.employeeTypeId, storeId: profile.storeId },
          });
          if (!exists) throw this.invalidStoreReference();
        }
        await changeEmploymentType(manager, profile, dto.employeeTypeId ?? null, {
          decidedByAccountId: ownerAccountId,
          note: 'Chủ cửa hàng sửa hình thức làm việc',
        });
        profileChanged = true;
        changed.push('Hình thức làm việc');
      }
      if (profileChanged) await manager.save(EmployeeProfile, profile);

      if (changed.length) {
        await this.logActivity(manager, {
          storeId: profile.storeId,
          actorAccountId: ownerAccountId,
          subjectEmployeeProfileId: profile.id,
          action: ACTIVITY_ACTIONS.EMPLOYEE_UPDATED,
          resourceType: 'employee',
          resourceId: profile.id,
          params: { changedFields: changed.join(', ') },
          idempotencyKey: null,
        });
      }
      return { id: profile.id, changed };
    });
  }

  async updateMyPersonalInfoInStore(
    accountId: string,
    data: UpdatePersonalInfoDto,
  ) {
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
    if (
      data.identityCardNumber ||
      (data as any).frontImage ||
      (data as any).backImage
    ) {
      const identity = await this.identityDocRepository.findOne({
        where: { accountId },
      });
      const identityUpdate: any = {};
      if (data.identityCardNumber)
        identityUpdate.documentNumber = data.identityCardNumber;
      if ((data as any).frontImage)
        identityUpdate.frontImageUrl = (data as any).frontImage;
      if ((data as any).backImage)
        identityUpdate.backImageUrl = (data as any).backImage;

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
      const finance = await this.financeRepository.findOne({
        where: { accountId },
      });
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
      throw new NotFoundException(
        'Không thể lấy thông tin tài khoản sau khi cập nhật',
      );
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

    // 1. Lấy thống kê tháng hiện tại (tháng Việt Nam)
    const currentMonth = toMonthMarker(vnMonthOf());
    const summary = await this.monthlySummaryRepository.findOne({
      where: { employeeProfileId: profileId, month: currentMonth },
      relations: ['performances', 'performances.reviewerAccount'],
    });

    // 3. Tính toán thâm niên
    const tenureMonths = summary?.tenureMonths || 0;
    const years = Math.floor(tenureMonths / 12);
    const months = tenureMonths % 12;
    let tenureDisplay = '';
    if (years > 0) tenureDisplay += `${years} năm `;
    if (months > 0 || years === 0) tenureDisplay += `${months} tháng`;

    // 4. Xử lý danh sách đánh giá (chỉ trong đợt làm việc hiện tại)
    // `performance_date` is a date column, so it is compared with the VN
    // calendar date the stint started (an assessment dated on the rehire day
    // belongs to the new stint), not with the timestamp floor.
    const stintStart = stintStartVnDate(profile.joinedAt);
    const assessmentDateKey = (value: Date | string | null | undefined) =>
      typeof value === 'string'
        ? value.slice(0, 10)
        : value instanceof Date && Number.isFinite(value.getTime())
          ? vnDateString(value)
          : '';
    const assessments = (summary?.performances || [])
      .filter(
        (p) => !stintStart || assessmentDateKey(p.performanceDate) >= stintStart,
      )
      .sort((a, b) =>
        assessmentDateKey(b.performanceDate).localeCompare(
          assessmentDateKey(a.performanceDate),
        ),
      )
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

    // 6. Xếp hạng cùng vị trí (Lazy rank calculation)
    const totalInPosition = await this.profileRepository.count({
      where: {
        employeeTypeId: profile.employeeTypeId,
        storeId: profile.storeId,
      },
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
      // `progression` được controller ghép vào từ CareerLadderService. Giữ nó
      // ngoài StoresService để service này không phải nhận thêm phụ thuộc —
      // constructor của nó đã có hơn bảy mươi tham số mà mọi spec đang mock.
      rankInPosition: `${higherProfiles}/${totalInPosition}`,
    };
  }

  async getEmployeeByAccountAndStore(accountId: string, storeId: string) {
    return this.profileRepository.findOne({
      where: { accountId, storeId },
      relations: ['account'],
    });
  }

  async getEmployeeByAccountId(accountId: string) {
    return this.profileRepository.findOne({
      where: { accountId },
      relations: ['account'],
    });
  }

  async getEmployees(
    ownerId: string,
    storeId?: string,
    typeName?: string,
    isDeleted: boolean = false,
  ) {
    // Guard: nếu storeId là 'undefined' hoặc không phải UUID hợp lệ → trả kết quả rỗng
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (storeId && !uuidRegex.test(storeId)) {
      return {
        employees: [],
        summary: {
          onTimeCount: 0,
          authorizedLeaveCount: 0,
          lateArrivalCount: 0,
          unauthorizedLeaveCount: 0,
        },
        typeCounts: [{ name: 'All', count: 0 }],
      };
    }
    // With a storeId, the caller must own it; without one the query below is
    // already scoped to the caller's own stores.
    if (storeId) {
      await this.assertOwnerStoreAccess(storeId, ownerId);
    }
    const contextWhere: any = {
      // A PENDING profile belongs to a job application the owner has not
      // approved yet. It is reviewed on the recruitment screen, and listing it
      // here would show applicants as staff and inflate every headcount below.
      employmentStatus: Not(EmploymentStatus.PENDING),
    };
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
      allEmployees = rawEmployees.filter((e) => e.deletedAt !== null);
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
      allEmployeeTypes.forEach((type) => {
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

    // 4. Lấy tháng hiện tại (tháng Việt Nam) & Summaries cho danh sách đã lọc
    const currentMonth = toMonthMarker(vnMonthOf());

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
        // Only the current stint's contracts of a rehired employee, active
        // first (the list reads `contracts[0]` for the expiry date).
        contracts: currentStintContracts(
          employee.contracts,
          stintFloor(employee.joinedAt),
        ),
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

  async deleteEmployee(
    profileId: string,
    reasonId: string,
    ownerAccountId?: string,
  ) {
    if (!ownerAccountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    const profileBeforeLock = await this.profileRepository.findOne({
      where: { id: profileId },
    });
    if (!profileBeforeLock) {
      throw new NotFoundException('Không tìm thấy nhân viên');
    }
    await this.assertOwnerStoreAccess(
      profileBeforeLock.storeId,
      ownerAccountId,
    );
    const reasonBeforeLock = await this.terminationReasonRepository.findOne({
      where: { id: reasonId, storeId: profileBeforeLock.storeId },
      select: ['id'],
    });
    if (!reasonBeforeLock) {
      throw new NotFoundException('Lý do thôi việc không hợp lệ');
    }

    return this.dataSource.transaction(async (manager) => {
      await lockStoreShiftAvailability(manager, profileBeforeLock.storeId);

      const profile = await manager.findOne(EmployeeProfile, {
        where: { id: profileId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!profile || profile.storeId !== profileBeforeLock.storeId) {
        throw new NotFoundException('Không tìm thấy nhân viên');
      }
      const store = await manager.findOne(Store, {
        where: { id: profile.storeId },
      });
      if (!store || store.ownerAccountId !== ownerAccountId) {
        throw new ForbiddenException(
          'Bạn không có quyền cho nhân viên cửa hàng này thôi việc',
        );
      }
      const reason = await manager.findOne(EmployeeTerminationReason, {
        where: { id: reasonId, storeId: profile.storeId },
      });
      if (!reason) {
        throw new NotFoundException('Lý do thôi việc không hợp lệ');
      }

      const now = new Date();
      // Shifts the leaver was booked for (and has not started) are withdrawn
      // so the slot frees up and nobody is counted absent. No reminder queue
      // call is needed: the reminder processor only sends for APPROVED
      // assignments of non-deleted employees, and `cancelAssignmentReminders`
      // would skip these rows anyway because it loads the (now soft-deleted)
      // employee relation.
      await this.cancelFutureShiftAssignments(manager, profile.id, now);
      // Requests still waiting for approval are closed with the employment, so
      // they never resurface in the approval tab after a rehire.
      await this.closePendingRequestsOfLeaver(manager, profile.id);

      // The leaver is no longer listed in, nor receives, the store's group
      // chats. Same transaction, so a failed termination keeps them.
      await this.removeStoreGroupChatMemberships(
        manager,
        profile.storeId,
        profile.accountId,
      );

      profile.employmentStatus = EmploymentStatus.TERMINATED;
      profile.terminationReasonId = reasonId;
      profile.leftAt = now;
      await manager.save(EmployeeProfile, profile);
      // The termination reason is not logged (it can be personal).
      await this.logActivity(manager, {
        storeId: profile.storeId,
        actorAccountId: ownerAccountId,
        subjectEmployeeProfileId: profile.id,
        action: ACTIVITY_ACTIONS.EMPLOYEE_REMOVED,
        resourceType: 'employee',
        resourceId: profile.id,
        idempotencyKey: `${ACTIVITY_ACTIONS.EMPLOYEE_REMOVED}:${profile.id}:${now.getTime()}`,
      });
      return manager.softDelete(EmployeeProfile, {
        id: profileId,
        storeId: profile.storeId,
      });
    });
  }

  /**
   * Closes a leaver's requests that are still PENDING, inside the
   * termination transaction (and again at a rehire, as a backstop): leave
   * and shift-change requests and salary advances become CANCELLED; shift
   * swaps and KPI approval requests (whose status has no CANCELLED value)
   * become REJECTED with a note, whether the leaver asked for the swap or was
   * its target. Decided requests are never touched.
   */
  private async closePendingRequestsOfLeaver(
    manager: EntityManager,
    profileId: string,
  ): Promise<void> {
    await manager
      .getRepository(EmployeeLeaveRequest)
      .update(
        { employeeProfileId: profileId, status: LeaveRequestStatus.PENDING },
        { status: LeaveRequestStatus.CANCELLED },
      );
    await manager
      .getRepository(ShiftChangeRequest)
      .update(
        {
          employeeProfileId: profileId,
          status: ShiftChangeRequestStatus.PENDING,
        },
        { status: ShiftChangeRequestStatus.CANCELLED },
      );
    const swapNote = 'Nhân viên đã nghỉ việc';
    for (const column of ['requestedByEmployeeId', 'toEmployeeId'] as const) {
      await manager
        .getRepository(ShiftSwap)
        .update(
          { [column]: profileId, status: ShiftSwapStatus.PENDING },
          { status: ShiftSwapStatus.REJECTED, note: swapNote },
        );
    }
    // KPI approval requests have no CANCELLED status (a Postgres enum), so a
    // pending one is closed as REJECTED with the same note as swaps.
    await manager
      .getRepository(KpiApprovalRequest)
      .update(
        { employeeProfileId: profileId, status: KpiRequestStatus.PENDING },
        { status: KpiRequestStatus.REJECTED, note: swapNote },
      );
    // A pending salary advance was never paid; APPROVED ones are payroll
    // history and stay as they are.
    await manager
      .getRepository(SalaryAdvanceRequest)
      .update(
        { employeeProfileId: profileId, status: AdvanceRequestStatus.PENDING },
        { status: AdvanceRequestStatus.CANCELLED },
      );
  }

  /**
   * Cancels an employee's PENDING/APPROVED shift assignments that have not
   * started yet. Used at termination and, as a backstop for people terminated
   * before this existed, when a former employee is rehired.
   *
   * Never touches CONFIRMED/COMPLETED rows, rows with a check-in, or a shift
   * that already started today (the absence reconcile owns those). Attendance
   * logs and payslips are not touched. Returns the cancelled ids.
   */
  private async cancelFutureShiftAssignments(
    manager: EntityManager,
    profileId: string,
    now: Date,
  ): Promise<string[]> {
    const today = vnDateString(now);
    const rows = await manager
      .getRepository(ShiftAssignment)
      .createQueryBuilder('a')
      .innerJoin('a.shiftSlot', 'slot')
      .leftJoin('slot.workShift', 'ws')
      .select('a.id', 'id')
      .addSelect('slot.workDate', 'workDate')
      .addSelect('slot.startTime', 'slotStartTime')
      .addSelect('ws.startTime', 'shiftStartTime')
      .where('a.employeeId = :profileId', { profileId })
      .andWhere('a.status IN (:...statuses)', {
        statuses: [
          ShiftAssignmentStatus.PENDING,
          ShiftAssignmentStatus.APPROVED,
        ],
      })
      .andWhere('a.checkInTime IS NULL')
      .andWhere('slot.workDate >= :today', { today })
      .getRawMany<{
        id: string;
        workDate: string | Date;
        slotStartTime: string | null;
        shiftStartTime: string | null;
      }>();

    const ids = rows
      .filter((row) => {
        const workDate =
          row.workDate instanceof Date
            ? vnDateString(row.workDate)
            : String(row.workDate).slice(0, 10);
        const time = row.slotStartTime || row.shiftStartTime;
        if (!time) return workDate > today;
        try {
          return parseVietnamShiftStart(workDate, time).getTime() > now.getTime();
        } catch {
          return workDate > today;
        }
      })
      .map((row) => row.id);
    if (!ids.length) return [];

    await manager
      .getRepository(ShiftAssignment)
      .update({ id: In(ids) }, { status: ShiftAssignmentStatus.CANCELLED });
    return ids;
  }

  /**
   * Hard-deletes an employee profile (soft-deleted or not). Owner only: the
   * route guard enforces it, and this re-checks so no other caller can reach
   * the delete without it.
   */
  async permanentDeleteEmployee(profileId: string, ownerAccountId: string) {
    if (!ownerAccountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      withDeleted: true,
    });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');
    await this.assertOwnerStoreAccess(profile.storeId, ownerAccountId);

    // Scoped to the verified store so the row cannot have moved in between.
    return this.profileRepository.delete({
      id: profileId,
      storeId: profile.storeId,
    });
  }

  /**
   * Restores a soft-deleted employee and continues the old stint (old
   * contracts and assets stay as they were). Shift assignments cancelled at
   * termination are NOT brought back; the owner re-assigns them.
   */
  /**
   * Vị trí / bộ phận của người được khôi phục có thể đã đổi trong lúc họ nghỉ:
   * chặn xoá vị trí / bộ phận chỉ đếm người ĐANG làm, nên chủ xoá được vị trí
   * mà một hồ sơ đã nghỉ vẫn trỏ tới. Khôi phục nguyên trạng thì hồ sơ trỏ vào
   * một vị trí không còn: lộ trình coi như "chưa có vị trí" (bước kế nhảy về
   * bậc 1) và chi tiết NV hiện "Chưa có vị trí" — trông như bị đổi vị trí.
   *
   * Nên: vị trí đã xoá / ngừng dùng → bỏ vị trí; vị trí còn → bộ phận đi theo
   * vị trí (vị trí có thể đã được chuyển bộ phận); bộ phận đã xoá → bỏ bộ phận.
   * Chủ xếp lại bằng "Chuyển bộ phận". Không ghi sự kiện: không phải một lần
   * lên / chuyển, chỉ là bỏ tham chiếu treo.
   */
  private async reconcileRestoredPlacement(manager: EntityManager, profile: EmployeeProfile) {
    if (profile.storeRoleId) {
      const role = await manager.findOne(StoreRole, {
        where: { id: profile.storeRoleId, storeId: profile.storeId },
        select: ['id', 'isActive', 'departmentId'],
      });
      if (!role || role.isActive === false) {
        profile.storeRoleId = null as any;
      } else if (role.departmentId) {
        profile.departmentId = role.departmentId;
      }
    }
    if (profile.departmentId) {
      const exists = await manager.exists(StoreDepartment, {
        where: { id: profile.departmentId, storeId: profile.storeId },
      });
      if (!exists) profile.departmentId = null as any;
    }
  }

  async restoreEmployee(profileId: string, ownerAccountId: string) {
    const profileBeforeLock = await this.profileRepository.findOne({
      where: { id: profileId },
      withDeleted: true,
    });
    if (!profileBeforeLock) {
      throw new NotFoundException('Không tìm thấy nhân viên');
    }
    await this.assertOwnerStoreAccess(
      profileBeforeLock.storeId,
      ownerAccountId,
    );

    return this.dataSource.transaction(async (manager) => {
      const account = await manager.findOne(Account, {
        where: { id: profileBeforeLock.accountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account || account.status !== AccountStatus.ACTIVE) {
        throw this.employeeAttachConflict();
      }

      const profile = await manager
        .getRepository(EmployeeProfile)
        .createQueryBuilder('profile')
        .withDeleted()
        .where('profile.id = :profileId', { profileId })
        .setLock('pessimistic_write')
        .getOne();
      if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');

      const store = await manager.findOne(Store, {
        where: { id: profile.storeId },
      });
      if (!store || store.ownerAccountId !== ownerAccountId) {
        throw new ForbiddenException(
          'Bạn không có quyền khôi phục nhân viên cửa hàng này',
        );
      }

      const otherActiveProfile = await manager
        .getRepository(EmployeeProfile)
        .createQueryBuilder('otherProfile')
        .withDeleted()
        .where('otherProfile.accountId = :accountId', {
          accountId: profile.accountId,
        })
        .andWhere('otherProfile.id != :profileId', { profileId })
        .andWhere('otherProfile.employmentStatus != :terminated', {
          terminated: EmploymentStatus.TERMINATED,
        })
        .getExists();
      if (otherActiveProfile) throw this.employeeAttachConflict();

      const previousLeftAt = profile.leftAt;
      profile.employmentStatus = EmploymentStatus.ACTIVE;
      profile.terminationReasonId = null;
      profile.leftAt = null;
      profile.deletedAt = null;
      await this.reconcileRestoredPlacement(manager, profile);
      await manager.save(EmployeeProfile, profile);
      await this.logActivity(manager, {
        storeId: profile.storeId,
        actorAccountId: ownerAccountId,
        subjectEmployeeProfileId: profile.id,
        action: ACTIVITY_ACTIONS.EMPLOYEE_REHIRED,
        resourceType: 'employee',
        resourceId: profile.id,
        params: { mode: 'restore' },
        // One entry per termination being undone.
        idempotencyKey: `${ACTIVITY_ACTIONS.EMPLOYEE_REHIRED}:${profile.id}:restore:${
          previousLeftAt ? new Date(previousLeftAt).getTime() : 'none'
        }`,
      });
      return manager.restore(EmployeeProfile, profileId);
    });
  }

  // Contract management
  async createContract(
    profileId: string,
    data: Partial<EmployeeContract> | Record<string, any>,
    manager?: EntityManager,
  ) {
    // Nếu data rỗng hoặc undefined, không tạo contract
    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    const sanitizedData: any = { ...data };

    // Xử lý empty strings -> undefined
    if ((sanitizedData.startDate as any) === '')
      sanitizedData.startDate = undefined;
    if ((sanitizedData.endDate as any) === '')
      sanitizedData.endDate = undefined;
    if ((sanitizedData.contractName as any) === '')
      sanitizedData.contractName = undefined;
    if ((sanitizedData.paymentType as any) === '')
      sanitizedData.paymentType = undefined;
    if (
      (sanitizedData.salaryAmount as any) === '' ||
      sanitizedData.salaryAmount === undefined
    )
      sanitizedData.salaryAmount = 0;
    if ((sanitizedData.jobDescription as any) === '')
      sanitizedData.jobDescription = undefined;
    if ((sanitizedData.probationPeriod as any) === '')
      sanitizedData.probationPeriod = undefined;
    if ((sanitizedData.weeklyWorkingHours as any) === '')
      sanitizedData.weeklyWorkingHours = undefined;
    if (
      (sanitizedData.durationMonths as any) === '' ||
      sanitizedData.durationMonths === undefined
    )
      sanitizedData.durationMonths = undefined;

    // "Không hợp đồng": no labor contract, but the pay rate is kept for
    // payroll. Marked by `noLaborContract: true`, `durationMonths: 0` or the
    // name itself (the only marker older backends also accept), and stored
    // as duration 0, no end date, that name.
    const noLaborContract =
      sanitizedData.noLaborContract === true ||
      sanitizedData.noLaborContract === 'true' ||
      isNoLaborContract(sanitizedData);
    delete sanitizedData.noLaborContract;
    if (noLaborContract) {
      sanitizedData.durationMonths = 0;
      sanitizedData.endDate = null;
      sanitizedData.contractName = NO_LABOR_CONTRACT_NAME;
    }

    // Tự động tính end_date nếu có duration_months và start_date
    if (sanitizedData.durationMonths && sanitizedData.startDate) {
      const startDate = new Date(sanitizedData.startDate);
      const endDate = new Date(startDate);
      endDate.setMonth(
        startDate.getMonth() + Number(sanitizedData.durationMonths),
      );

      // Giảm đi 1 ngày để hợp đồng kết thúc vào cuối ngày của tháng trước đó (VD: 01/01 -> 31/12 thay vì 01/01 năm sau)
      endDate.setDate(endDate.getDate() - 1);

      sanitizedData.endDate = endDate;
    }

    // Nếu contractName rỗng, đặt default
    if (!sanitizedData.contractName) {
      sanitizedData.contractName = 'Hợp đồng lao động';
    }

    const repository = manager
      ? manager.getRepository(EmployeeContract)
      : this.contractRepository;
    const contract = repository.create({
      ...sanitizedData,
      employeeProfileId: profileId,
    }) as unknown as EmployeeContract;
    const saved = await repository.save(contract);
    saved.noLaborContract = isNoLaborContract(saved);
    return saved;
  }

  /**
   * The employee's current contract: active first, then newest, and only
   * from the current stint of a rehired employee (null when none).
   */
  async getLatestContract(profileId: string) {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      select: ['id', 'joinedAt'],
    });
    const contracts = await this.contractRepository.find({
      where: { employeeProfileId: profileId },
      order: { createdAt: 'DESC' },
    });
    return (
      currentStintContracts(contracts, stintFloor(profile?.joinedAt))[0] ?? null
    );
  }

  // Contract Template management
  async getContractTemplates(storeId: string) {
    return this.contractTemplateRepository.find({
      where: { storeId, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async getContractTemplate(id: string) {
    const template = await this.contractTemplateRepository.findOne({
      where: { id },
    });
    if (!template) {
      throw new NotFoundException('Khong tim thay mau hop dong');
    }
    return template;
  }

  async createContractTemplate(storeId: string, data: any) {
    // If this is set as default, unset other defaults in the same store
    if (data.isDefault) {
      await this.contractTemplateRepository.update(
        { storeId, isDefault: true, isActive: true },
        { isDefault: false },
      );
    }

    const template = this.contractTemplateRepository.create({
      ...data,
      storeId,
    });
    return this.contractTemplateRepository.save(template);
  }

  async updateContractTemplate(id: string, data: any) {
    const template = await this.contractTemplateRepository.findOne({
      where: { id },
    });
    if (!template) {
      throw new NotFoundException('Khong tim thay mau hop dong');
    }

    // If setting as default, unset other defaults in the same store
    if (data.isDefault) {
      await this.contractTemplateRepository.update(
        {
          storeId: template.storeId,
          isDefault: true,
          isActive: true,
          id: Not(id),
        },
        { isDefault: false },
      );
    }

    Object.assign(template, data);
    return this.contractTemplateRepository.save(template);
  }

  async deleteContractTemplate(id: string) {
    const template = await this.contractTemplateRepository.findOne({
      where: { id },
    });
    if (!template) {
      throw new NotFoundException('Khong tim thay mau hop dong');
    }
    template.isActive = false;
    return this.contractTemplateRepository.save(template);
  }

  async extractPlaceholdersFromDocx(
    filePath: string,
  ): Promise<{ placeholders: string[]; textPreview: string }> {
    try {
      const { extractPlaceholdersFromDocx: extract } =
        await import('../../common/utils/docx-parser');
      const placeholders = extract(filePath);
      const { extractTextFromDocx } =
        await import('../../common/utils/docx-parser');
      const textPreview = extractTextFromDocx(filePath).substring(0, 500);
      return { placeholders, textPreview };
    } catch (error) {
      throw new BadRequestException(
        `Cannot extract placeholders from DOCX: ${(error as Error).message}`,
      );
    }
  }

  /** See SlotAnnouncementThrottle; created lazily (tests build via prototype). */
  freeSeatThrottle?: SlotAnnouncementThrottle;

  /** Rows an asset may reference; each must belong to the asset's store. */
  private assetReferences(data: any) {
    return [
      { repository: this.assetUnitRepository, id: data?.assetUnitId, label: 'Đơn vị tính' },
      { repository: this.assetCategoryRepository, id: data?.assetCategoryId, label: 'Danh mục tài sản' },
      { repository: this.assetStatusRepository, id: data?.assetStatusId, label: 'Trạng thái tài sản' },
      { repository: this.profileRepository, id: data?.responsibleEmployeeId, label: 'Nhân viên phụ trách' },
    ];
  }

  /** Rows a product may reference; each must belong to the product's store. */
  private productReferences(data: any) {
    return [
      { repository: this.productUnitRepository, id: data?.productUnitId, label: 'Đơn vị tính' },
      { repository: this.productCategoryRepository, id: data?.productCategoryId, label: 'Danh mục hàng hóa' },
      { repository: this.productStatusRepository, id: data?.productStatusId, label: 'Trạng thái hàng hóa' },
    ];
  }

  /**
   * Drops the fields a client must never set on a catalogue row: its identity
   * (an `id` turns `save` into an update of that row, in any store) and its
   * store (always the addressed one).
   */
  /**
   * `withoutRowIdentity` plus the entity's relation properties, for simple
   * store-scoped creates: a relation object (`store: { id }`, ...) would
   * otherwise set its foreign key past the addressed store.
   */
  creatableRow(
    repository: Repository<any>,
    data: unknown,
  ): Record<string, any> {
    const row: Record<string, any> = this.withoutRowIdentity(
      (data ?? {}) as Record<string, any>,
    );
    for (const relation of repository.metadata?.relations ?? []) {
      delete row[relation.propertyName];
    }
    return row;
  }

  private withoutRowIdentity<T extends Record<string, any>>(data: T) {
    const {
      id: _id,
      storeId: _storeId,
      store: _store,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      deletedAt: _deletedAt,
      ...rest
    } = (data ?? {}) as Record<string, any>;
    return rest as Omit<T, 'id' | 'storeId'>;
  }

  async createAssetsBulk(
    storeId: string,
    assetsData: any[],
    files: Express.Multer.File[],
  ) {
    console.log('Chạy hàm createAssetsBulk');
    const savedAssets: Asset[] = [];
    // Validate every row before writing any of them.
    // Scalar columns only: no identity, store or relation objects (a
    // `responsibleEmployee: { id }` would otherwise bypass the FK checks).
    const rows = assetsData.map(
      (data) => pickDefined(data, ASSET_CLIENT_FIELDS) as any,
    );
    for (const data of rows) {
      await this.assertRowsInStore(storeId, this.assetReferences(data));
    }

    for (let i = 0; i < rows.length; i++) {
      const data = rows[i];

      // 1. Ánh xạ file từ Form Data (Convention: avatar_0, invoice_0...)
      const avatarFile = files.find((f) => f.fieldname === `avatar_${i}`);
      const invoiceFile = files.find((f) => f.fieldname === `invoice_${i}`);

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
        transaction.totalAmount =
          (Number(data.value) || 0) * Number(data.currentStock);

        const savedTransaction =
          await this.stockTransactionRepository.save(transaction);

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
      relations: ['assetUnit', 'assetCategory', 'assetStatus'],
    });
  }

  async getAssetReport(
    storeId: string,
    filters: { date?: string; assetStatusId?: string },
  ) {
    // Xử lý trường hợp frontend gửi chuỗi "undefined" hoặc "null"
    if (filters.date === 'undefined' || filters.date === 'null')
      filters.date = undefined;
    if (
      filters.assetStatusId === 'all' ||
      filters.assetStatusId === 'undefined' ||
      filters.assetStatusId === 'null'
    )
      filters.assetStatusId = undefined;

    // 1. Summary Calculation (Dựa trên LỊCH SỬ NHẬP hàng - Đếm món, không đếm số lượng)
    const summaryAllTime = await this.stockTransactionDetailRepository
      .createQueryBuilder('detail')
      .leftJoin('detail.transaction', 'transaction')
      .select('COUNT(detail.id)', 'totalItems') // Đếm số dòng (món hàng)
      .addSelect('SUM(detail.total_price)', 'totalValue') // Tổng tiền các đợt nhập
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', {
        type: StockTransactionType.IMPORT,
      })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .getRawOne();

    const targetDate = filters.date || vnDateString();
    const summaryToday = await this.stockTransactionDetailRepository
      .createQueryBuilder('detail')
      .leftJoin('detail.transaction', 'transaction')
      .select('COUNT(detail.id)', 'totalItems')
      .addSelect('SUM(detail.total_price)', 'totalValue')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', {
        type: StockTransactionType.IMPORT,
      })
      .andWhere('DATE(transaction.transaction_date) = :targetDate', {
        targetDate,
      })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .getRawOne();

    // 2. Status Statistics (Đếm món hàng trong lịch sử theo trạng thái)
    const allStatuses = await this.assetStatusRepository.find({
      where: { storeId, isActive: true },
    });

    const statusStatsQb = this.stockTransactionDetailRepository
      .createQueryBuilder('detail')
      .select('asset.asset_status_id', 'statusId')
      .addSelect('COUNT(detail.id)', 'itemCount')
      .leftJoin('detail.asset', 'asset')
      .leftJoin('detail.transaction', 'transaction')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', {
        type: StockTransactionType.IMPORT,
      })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .groupBy('asset.asset_status_id');

    if (filters.date) {
      statusStatsQb.andWhere('DATE(transaction.transaction_date) = :date', {
        date: filters.date,
      });
    }

    const statusStatsRaw = await statusStatsQb.getRawMany();

    const statusDetails = allStatuses.map((status) => {
      const found = statusStatsRaw.find((r) => r.statusId === status.id);
      return {
        id: status.id,
        name: status.name,
        colorCode: status.colorCode,
        count: found ? Number(found.itemCount) : 0,
      };
    });

    const totalHistoryItems = statusDetails.reduce(
      (sum, item) => sum + item.count,
      0,
    );

    // 3. Import History (Lịch sử nhập hàng) - Dựa trên StockTransaction
    const importHistoryQb = this.stockTransactionDetailRepository
      .createQueryBuilder('detail')
      .leftJoinAndSelect('detail.transaction', 'transaction')
      .leftJoinAndSelect('detail.asset', 'asset')
      .leftJoinAndSelect('asset.assetUnit', 'unit')
      .leftJoinAndSelect('asset.assetCategory', 'category')
      .leftJoinAndSelect('asset.assetStatus', 'status')
      .leftJoinAndSelect('asset.store', 'store')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', {
        type: StockTransactionType.IMPORT,
      })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .orderBy('transaction.transaction_date', 'DESC');

    if (filters.date) {
      importHistoryQb.andWhere('DATE(transaction.transaction_date) = :date', {
        date: filters.date,
      });
    }

    if (filters.assetStatusId) {
      importHistoryQb.andWhere('asset.asset_status_id = :statusId', {
        statusId: filters.assetStatusId,
      });
    }

    const importHistory = await importHistoryQb.getMany();

    // Mapping lại theo format UI Card người dùng cung cấp
    const formattedImports = importHistory.map((detail) => ({
      id: detail.id,
      assetName: detail.asset?.name,
      assetCode: detail.asset?.code,
      avatarUrl: detail.asset?.avatarUrl,
      categoryName: detail.asset?.assetCategory?.name,
      unitName: detail.asset?.assetUnit?.name,
      supplierName:
        detail.transaction?.partnerName || detail.asset?.supplierName,
      value: Number(detail.unitPrice), // Giá trị đơn vị
      quantity: Number(detail.quantity), // Số lượng thực tế trong đợt đó
      totalPrice: Number(detail.totalPrice),
      status: {
        id: detail.asset?.assetStatus?.id,
        name: detail.asset?.assetStatus?.name,
        colorCode: detail.asset?.assetStatus?.colorCode,
      },
      storeName: detail.asset?.store?.name,
      storeAvatarUrl: detail.asset?.store?.avatarUrl,
      importDate: detail.transaction?.transactionDate,
      transactionCode: detail.transaction?.code,
      transactionId: detail.transaction?.id,
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
        },
      },
      statusStatistics: {
        all: totalHistoryItems,
        details: statusDetails,
      },
      importHistory: formattedImports,
    };
  }

  async getAssetExportReport(
    storeId: string,
    filters: { date?: string; assetExportTypeId?: string },
  ) {
    // Xử lý trường hợp frontend gửi chuỗi "undefined" hoặc "null"
    if (filters.date === 'undefined' || filters.date === 'null')
      filters.date = undefined;
    if (
      filters.assetExportTypeId === 'all' ||
      filters.assetExportTypeId === 'undefined' ||
      filters.assetExportTypeId === 'null'
    )
      filters.assetExportTypeId = undefined;

    // 1. Summary Calculation (Dựa trên LỊCH SỬ XUẤT hàng)
    const summaryAllTime = await this.stockTransactionDetailRepository
      .createQueryBuilder('detail')
      .leftJoin('detail.transaction', 'transaction')
      .select('COUNT(detail.id)', 'totalItems')
      .addSelect('SUM(detail.total_price)', 'totalValue')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', {
        type: StockTransactionType.EXPORT,
      })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .getRawOne();

    const targetDate = filters.date || vnDateString();
    const summaryToday = await this.stockTransactionDetailRepository
      .createQueryBuilder('detail')
      .leftJoin('detail.transaction', 'transaction')
      .select('COUNT(detail.id)', 'totalItems')
      .addSelect('SUM(detail.total_price)', 'totalValue')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', {
        type: StockTransactionType.EXPORT,
      })
      .andWhere('DATE(transaction.transaction_date) = :targetDate', {
        targetDate,
      })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .getRawOne();

    // 2. Export Type Statistics
    const allExportTypes = await this.assetExportTypeRepository.find({
      where: { storeId, isActive: true },
    });

    const typeStatsQb = this.stockTransactionDetailRepository
      .createQueryBuilder('detail')
      .select('transaction.asset_export_type_id', 'typeId')
      .addSelect('COUNT(detail.id)', 'itemCount')
      .leftJoin('detail.transaction', 'transaction')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', {
        type: StockTransactionType.EXPORT,
      })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .groupBy('transaction.asset_export_type_id');

    if (filters.date) {
      typeStatsQb.andWhere('DATE(transaction.transaction_date) = :date', {
        date: filters.date,
      });
    }

    const typeStatsRaw = await typeStatsQb.getRawMany();

    const typeDetails = allExportTypes.map((type) => {
      const found = typeStatsRaw.find((r) => r.typeId === type.id);
      return {
        id: type.id,
        name: type.name,
        colorCode: type.colorCode,
        count: found ? Number(found.itemCount) : 0,
      };
    });

    const totalHistoryItems = typeDetails.reduce(
      (sum, item) => sum + item.count,
      0,
    );

    // 3. Export History
    const exportHistoryQb = this.stockTransactionDetailRepository
      .createQueryBuilder('detail')
      .leftJoinAndSelect('detail.transaction', 'transaction')
      .leftJoinAndSelect('transaction.assetExportType', 'exportType')
      .leftJoinAndSelect('detail.asset', 'asset')
      .leftJoinAndSelect('asset.assetUnit', 'unit')
      .leftJoinAndSelect('asset.assetCategory', 'category')
      .leftJoinAndSelect('asset.store', 'store')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', {
        type: StockTransactionType.EXPORT,
      })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .orderBy('transaction.transaction_date', 'DESC');

    if (filters.date) {
      exportHistoryQb.andWhere('DATE(transaction.transaction_date) = :date', {
        date: filters.date,
      });
    }

    if (filters.assetExportTypeId) {
      exportHistoryQb.andWhere('transaction.asset_export_type_id = :typeId', {
        typeId: filters.assetExportTypeId,
      });
    }

    const exportHistory = await exportHistoryQb.getMany();

    const formattedExports = exportHistory.map((detail) => ({
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
        colorCode: detail.transaction?.assetExportType?.colorCode,
      },
      storeName: detail.asset?.store?.name,
      storeAvatarUrl: detail.asset?.store?.avatarUrl,
      exportDate: detail.transaction?.transactionDate,
      transactionCode: detail.transaction?.code,
      transactionId: detail.transaction?.id,
      note: detail.transaction?.note || detail.note,
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
        },
      },
      statusStatistics: {
        all: totalHistoryItems,
        details: typeDetails,
      },
      exportHistory: formattedExports,
    };
  }

  async updateAsset(id: string, data: Partial<Asset>) {
    const asset = await this.assetRepository.findOne({
      where: { id },
      select: ['id', 'storeId'],
    });
    if (!asset) throw new NotFoundException('Không tìm thấy tài sản');
    // The store never changes here, and every referenced row must be in it
    // (the guard cannot see this multipart body).
    const changes = this.withoutRowIdentity(data as any);
    await this.assertRowsInStore(asset.storeId, this.assetReferences(changes));
    await this.assetRepository.update(id, changes);
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
    // Validate every row before writing any of them.
    // Scalar columns only: no identity, store or relation objects.
    const rows = productsData.map(
      (data) => pickDefined(data, PRODUCT_CLIENT_FIELDS) as any,
    );
    for (const data of rows) {
      await this.assertRowsInStore(storeId, this.productReferences(data));
    }

    for (let i = 0; i < rows.length; i++) {
      const data = rows[i];

      // 1. Ánh xạ file (avatar_0, avatar_1...)
      const avatarFile = files.find((f) => f.fieldname === `avatar_${i}`);
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
    const product = await this.productRepository.findOne({
      where: { id },
      select: ['id', 'storeId'],
    });
    if (!product) throw new NotFoundException('Không tìm thấy hàng hóa');
    // The store never changes here, and every referenced row must be in it
    // (the guard cannot see this multipart body).
    const changes = this.withoutRowIdentity(data as any);
    await this.assertRowsInStore(
      product.storeId,
      this.productReferences(changes),
    );
    await this.productRepository.update(id, changes);
    return this.productRepository.findOne({
      where: { id },
      relations: ['productUnit', 'productCategory', 'productStatus'],
    });
  }

  async deleteProduct(id: string) {
    await this.productRepository.delete(id);
    return { message: 'Product deleted successfully' };
  }

  async renewContract(contractId: string, data: RenewContractDto) {
    const today = vnDateString();
    if (data.endDate && data.endDate.slice(0, 10) < today) {
      throw new BadRequestException(
        'Ngày kết thúc hợp đồng mới không được trước ngày bắt đầu (hôm nay)',
      );
    }

    // One transaction with the old row locked: archiving it and creating its
    // successor used to be two separate writes, so a double tap (or two owners
    // at once) could both read it as active and leave two active contracts.
    return this.dataSource.transaction(async (manager) => {
      const contracts = manager.getRepository(EmployeeContract);

      // 1. Get old contract
      const oldContract = await contracts.findOne({
        where: { id: contractId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!oldContract)
        throw new NotFoundException('Không tìm thấy hợp đồng cũ');
      if (!oldContract.isActive)
        throw new BadRequestException(
          'Chỉ có thể gia hạn hợp đồng đang hiệu lực',
        );

      // 2. Archive old contract
      oldContract.isActive = false;
      // Nếu không truyền endDate mới thì lấy ngày hiện tại làm ngày kết thúc hợp đồng cũ
      if (!oldContract.endDate) {
        oldContract.endDate = new Date();
      }
      await contracts.save(oldContract);

      // 3. Create new contract
      const newContract = contracts.create({
        employeeProfileId: oldContract.employeeProfileId,
        contractName: data.contractName || oldContract.contractName, // Giữ tên cũ hoặc tên mới
        jobDescription: data.jobDescription || oldContract.jobDescription,
        startDate: new Date(), // Bắt đầu từ hôm nay
        endDate: data.endDate as unknown as Date,
        // The term belongs to this renewal (left out = none); the old
        // duration would contradict the new end date.
        durationMonths: data.durationMonths,
        // Used to be dropped: the renewed contract lost these three.
        weeklyWorkingHours:
          data.weeklyWorkingHours ?? oldContract.weeklyWorkingHours,
        probationPeriod: data.probationPeriod ?? oldContract.probationPeriod,
        paymentType: oldContract.paymentType, // Giữ nguyên hình thức trả lương
        salaryAmount: data.salaryAmount || oldContract.salaryAmount, // Lương mới
        allowances: data.allowances || oldContract.allowances,
        terms: data.terms ?? oldContract.terms,
        contractFileUrl: undefined, // Reset file hợp đồng vì phải ký lại
        isActive: true,
      });

      return contracts.save(newContract);
    });
  }

  /**
   * Attaches the signed file to an active contract (a renewal starts without
   * one, since it must be signed again). The upload is moved to
   * `<contractId><ext>` in CONTRACT_UPLOAD_DIR, replacing an earlier file of
   * that contract; on any failure the upload is deleted.
   */
  async attachContractFile(contractId: string, file: Express.Multer.File) {
    try {
      // The id becomes a file name: only a bare uuid may reach the disk.
      if (!isUUID(contractId))
        throw new NotFoundException('Không tìm thấy hợp đồng');
      const contract = await this.contractRepository.findOne({
        where: { id: contractId },
      });
      if (!contract) throw new NotFoundException('Không tìm thấy hợp đồng');
      if (!contract.isActive)
        throw new BadRequestException(
          'Chỉ tải file cho hợp đồng đang hiệu lực',
        );

      const directory = resolvePath(CONTRACT_UPLOAD_DIR);
      const target = join(
        directory,
        `${contractId}${extname(file.filename).toLowerCase()}`,
      );
      for (const name of await readdir(directory)) {
        const existing = join(directory, name);
        if (name.startsWith(`${contractId}.`) && existing !== target) {
          await unlink(existing);
        }
      }
      await rename(file.path, target);

      contract.contractFileUrl = `/api/stores/employees/contracts/${contractId}/file`;
      await this.contractRepository.save(contract);
      return { contractFileUrl: contract.contractFileUrl };
    } catch (error) {
      await unlink(file.path).catch(() => undefined);
      throw error;
    }
  }

  /** Absolute path of the contract's stored signed file, or 404. */
  async getContractFilePath(contractId: string): Promise<string> {
    const missing = () => new NotFoundException('Hợp đồng chưa có file');
    if (!isUUID(contractId)) throw missing();
    const directory = resolvePath(CONTRACT_UPLOAD_DIR);
    const names = await readdir(directory).catch(() => [] as string[]);
    const name = names.find((entry) => entry.startsWith(`${contractId}.`));
    if (!name) throw missing();
    return join(directory, name);
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
    const unit = this.assetUnitRepository.create({
      ...this.creatableRow(this.assetUnitRepository, data),
      storeId,
    });
    return this.assetUnitRepository.save(unit);
  }

  async getAssetUnits(storeId: string) {
    return this.assetUnitRepository.find({
      where: { storeId, isActive: true },
    });
  }

  async createProductUnit(storeId: string, data: Partial<ProductUnit>) {
    const unit = this.productUnitRepository.create({
      ...this.creatableRow(this.productUnitRepository, data),
      storeId,
    });
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
    ownerAccountId: string,
  ) {
    await this.assertOwnerStoreAccess(data.storeId, ownerAccountId);
    const plainPassword = randomBytes(9).toString('base64url').slice(0, 12);
    const result = await this.dataSource.transaction(async (manager) => {
      const store = await manager.findOne(Store, {
        where: { id: data.storeId, ownerAccountId },
      });
      if (!store) {
        throw new ForbiddenException({
          code: 'STORE_ACCESS_DENIED',
          message: 'Bạn không có quyền truy cập cửa hàng này.',
        });
      }
      const newAccount = await accountsService.create(
        {
          fullName: data.fullName,
          email: data.email,
          phone: data.phone,
          passwordHash: plainPassword,
          gender: data.gender,
          birthday: data.birthday ? new Date(data.birthday) : undefined,
          avatar: data.avatarUrl,
          address: data.address,
          maritalStatus: data.maritalStatus,
          status: AccountStatus.ACTIVE,
        },
        manager,
      );
      if (
        data.documentNumber ||
        data.frontIdentificationUrl ||
        data.backIdentificationUrl
      ) {
        await accountsService.createIdentityDocument(
          newAccount.id,
          {
            documentNumber: data.documentNumber,
            frontImageUrl: data.frontIdentificationUrl,
            backImageUrl: data.backIdentificationUrl,
          },
          manager,
        );
      }
      if (data.bankName || data.bankNumber) {
        await accountsService.createFinance(
          newAccount.id,
          { bankName: data.bankName, bankNumber: data.bankNumber },
          manager,
        );
      }
      const { profile } = await this.initializeEmployeeProfile(
        manager,
        data.storeId,
        newAccount.id,
        data,
      );
      await this.logActivity(manager, {
        storeId: data.storeId,
        actorAccountId: ownerAccountId,
        subjectEmployeeProfileId: profile.id,
        action: ACTIVITY_ACTIONS.EMPLOYEE_ADDED,
        resourceType: 'employee',
        resourceId: profile.id,
        params: { source: 'manual' },
        idempotencyKey: `${ACTIVITY_ACTIONS.EMPLOYEE_ADDED}:${profile.id}`,
      });
      return { account: newAccount, profileId: profile.id };
    });

    try {
      await mailService.sendPasswordEmail(
        result.account.email,
        result.account.fullName,
        plainPassword,
      );
    } catch {
      this.logger.warn('Password email delivery failed after employee creation');
    }
    return this.getEmployeeById(result.profileId);
  }

  // KPI Type management
  async createKpiType(storeId: string, data: Partial<KpiType>) {
    const type = this.kpiTypeRepository.create({
      ...(pickDefined(data, KPI_TYPE_CLIENT_FIELDS) as Partial<KpiType>),
      storeId,
    });
    return this.kpiTypeRepository.save(type);
  }

  async getKpiTypes(storeId: string) {
    return this.kpiTypeRepository.find({ where: { storeId, isActive: true } });
  }

  // KPI Unit management
  async createKpiUnit(storeId: string, data: Partial<KpiUnit>) {
    const unit = this.kpiUnitRepository.create({
      ...(pickDefined(data, KPI_UNIT_CLIENT_FIELDS) as Partial<KpiUnit>),
      storeId,
    });
    return this.kpiUnitRepository.save(unit);
  }

  async getKpiUnits(storeId: string) {
    return this.kpiUnitRepository.find({ where: { storeId, isActive: true } });
  }

  // KPI Period management
  async createKpiPeriod(storeId: string, data: Partial<KpiPeriod>) {
    const period = this.kpiPeriodRepository.create({
      ...(pickDefined(data, KPI_PERIOD_CLIENT_FIELDS) as Partial<KpiPeriod>),
      storeId,
    });
    return this.kpiPeriodRepository.save(period);
  }

  async getKpiPeriods(storeId: string) {
    return this.kpiPeriodRepository.find({
      where: { storeId, isActive: true },
    });
  }

  /**
   * Task fields a client may set, from an explicit list. The task's store is
   * `storeId`, else the first of the released owner app's `storeIds`, and
   * must be one of the KPI's stores (else the KPI's first store).
   */
  private buildKpiTaskFields(
    taskData: any,
    kpiStoreIds: string[],
  ): Partial<KpiTask> {
    const fields: Partial<KpiTask> = {};
    for (const field of KPI_TASK_CLIENT_FIELDS) {
      if (taskData?.[field] !== undefined) {
        (fields as Record<string, unknown>)[field] = taskData[field];
      }
    }
    const requested =
      (typeof taskData?.storeId === 'string' && taskData.storeId) ||
      (Array.isArray(taskData?.storeIds) ? taskData.storeIds[0] : undefined) ||
      kpiStoreIds[0] ||
      null;
    fields.storeId = (
      requested && kpiStoreIds.includes(requested)
        ? requested
        : (kpiStoreIds[0] ?? null)
    ) as string;
    fields.completionRate = kpiCompletionRate(fields.actualValue, fields.target);
    return fields;
  }

  /** KPI units, periods and types must come from one of the KPI's stores. */
  private kpiTaskReferences(task: Partial<KpiTask>) {
    return [
      { repository: this.kpiUnitRepository, id: task.kpiUnitId, label: 'Đơn vị đo lường' },
      { repository: this.kpiPeriodRepository, id: task.kpiPeriodId, label: 'Kỳ đo lường' },
      { repository: this.kpiTypeRepository, id: task.kpiTypeId, label: 'Loại KPI' },
    ];
  }

  // Employee KPI Management
  async createEmployeeKpi(data: any, accountId?: string) {
    const { tasks, ...kpiData } = data ?? {};
    // Alias kpiName → name (support both field names from frontend/test)
    if (!kpiData.name && kpiData.kpiName) {
      kpiData.name = kpiData.kpiName;
    }
    delete kpiData.kpiName;
    // Đảm bảo storeIds luôn là mảng nếu người dùng truyền lên 1 string
    if (kpiData.storeId && !kpiData.storeIds) {
      kpiData.storeIds = [kpiData.storeId];
    }

    // The owner of the rated employee's store, or the employee rating
    // themself; every store the KPI applies to must be one the caller
    // belongs to.
    const actor = await this.resolveKpiActor(
      kpiData.employeeProfileId,
      accountId,
      'Không tìm thấy hồ sơ nhân viên',
    );
    const profileStoreId = actor.storeId;
    if (!actor.isOwner) {
      // A self-authored KPI always starts as a draft for the owner to
      // approve; the client's status is ignored.
      kpiData.status = KpiStatus.DRAFT;
    }
    if (!Array.isArray(kpiData.storeIds) || kpiData.storeIds.length === 0) {
      kpiData.storeIds = [profileStoreId];
    }
    const accessible = new Set(
      await this.getAccessibleStoreIds(accountId as string),
    );
    for (const storeId of kpiData.storeIds) {
      if (typeof storeId !== 'string' || !accessible.has(storeId)) {
        throw new ForbiddenException('Bạn không có quyền truy cập cửa hàng này');
      }
    }
    const kpiStoreIds: string[] = [...new Set<string>(kpiData.storeIds)];
    const referenceStores = [...new Set([...kpiStoreIds, profileStoreId])];

    const taskRows = Array.isArray(tasks)
      ? tasks.map((taskData) => this.buildKpiTaskFields(taskData, kpiStoreIds))
      : [];
    for (const task of taskRows) {
      await this.assertRowsInStore(referenceStores, this.kpiTaskReferences(task));
    }

    // Explicit fields only: no `id`, no relation objects.
    const kpiFields: Partial<EmployeeKpi> = { storeIds: kpiStoreIds };
    for (const field of EMPLOYEE_KPI_CLIENT_FIELDS) {
      if (kpiData[field] !== undefined) {
        (kpiFields as Record<string, unknown>)[field] = kpiData[field];
      }
    }
    const kpi = this.employeeKpiRepository.create(kpiFields);
    const savedKpi = await this.employeeKpiRepository.save(kpi);

    for (const taskFields of taskRows) {
      const task = this.kpiTaskRepository.create({
        ...taskFields,
        employeeKpiId: savedKpi.id,
      });
      await this.kpiTaskRepository.save(task);
    }

    const kpiWithRelations = await this.employeeKpiRepository.findOne({
      where: { id: savedKpi.id },
      relations: [
        'employeeProfile',
        'employeeProfile.account',
        'employeeProfile.employeeType',
        'employeeProfile.department',
        'employeeProfile.storeRole',
        'tasks',
        'tasks.kpiType',
        'tasks.kpiUnit',
        'tasks.kpiPeriod',
        'tasks.store',
      ],
    });

    if (!kpiWithRelations) {
      throw new NotFoundException('Không tìm thấy bảng KPI vừa tạo');
    }

    return this.summarizeKpi(kpiWithRelations);
  }

  async getEmployeeKpis(
    filters: {
      employeeProfileId?: string;
      storeId?: string;
      month?: string;
      rating?: string;
    } = {},
    accountId?: string,
  ) {
    const { employeeProfileId, storeId, month, rating } = filters;

    const accessibleStoreIds = await this.getAccessibleStoreIds(
      accountId as string,
    );
    if (!accessibleStoreIds.length) {
      // Not an owner and not employed anywhere: nothing is in scope.
      return { data: [], ratingCount: {} };
    }

    const query = this.employeeKpiRepository
      .createQueryBuilder('kpi')
      .leftJoinAndSelect('kpi.employeeProfile', 'profile')
      .leftJoinAndSelect('profile.account', 'account')
      .leftJoinAndSelect('profile.employeeType', 'employeeType')
      .leftJoinAndSelect('profile.storeRole', 'storeRole')
      .leftJoinAndSelect('kpi.tasks', 'tasks')
      .leftJoinAndSelect('tasks.kpiType', 'kpiType')
      .leftJoinAndSelect('tasks.kpiUnit', 'kpiUnit')
      .leftJoinAndSelect('tasks.kpiPeriod', 'kpiPeriod')
      .leftJoinAndSelect('tasks.store', 'taskStore')
      // Previously `.where('1=1')` — with every filter optional, a bare
      // `GET /stores/kpis` returned every KPI row in the database along with
      // the joined employee names and avatars. The caller's accessible stores
      // are now the outer bound, and the optional filters narrow within it.
      .where('kpi.store_ids && :accessibleStoreIds::uuid[]', {
        accessibleStoreIds,
      });

    if (employeeProfileId) {
      query.andWhere('kpi.employee_profile_id = :employeeProfileId', {
        employeeProfileId,
      });
    }

    if (storeId) {
      query.andWhere(':storeId = ANY(kpi.store_ids)', { storeId });
    }

    // A rehired employee's KPIs from the previous stint are kept but hidden.
    query.andWhere(currentStintSql('profile', 'kpi.created_at'));

    if (month) {
      query.andWhere("to_char(kpi.month, 'YYYY-MM') = :month", { month });
    }

    const kpis = await query.orderBy('kpi.created_at', 'DESC').getMany();

    // Lấy tất cả storeIds duy nhất từ tất cả các kpi để fetch 1 lần cho tối ưu
    const allStoreIds = [...new Set(kpis.flatMap((k) => k.storeIds || []))];
    const stores =
      allStoreIds.length > 0
        ? await this.storeRepository.find({ where: { id: In(allStoreIds) } })
        : [];

    // Tóm tắt dữ liệu và gắn thông tin stores
    const allSummarized = kpis.map((kpi) => {
      const summary = this.summarizeKpi(kpi);
      // Gắn thêm mảng objects store đầy đủ
      const appliedStores = stores.filter((s) => kpi.storeIds?.includes(s.id));
      return {
        ...summary,
        appliedStores,
      };
    });

    // Thống kê số lượng theo Rating
    const ratingCount = {
      all: allSummarized.length,
      good: allSummarized.filter((k) => k?.summary?.rating === 'Tốt').length,
      warning: allSummarized.filter((k) => k?.summary?.rating === 'Cảnh Báo')
        .length,
      low: allSummarized.filter((k) => k?.summary?.rating === 'Thấp').length,
    };

    let summarizedKpis = allSummarized;

    // Lọc theo rating (Tốt/Cảnh Báo/Thấp) nếu có
    if (rating) {
      summarizedKpis = allSummarized.filter(
        (kpi) => kpi?.summary?.rating === rating,
      );
    }

    return {
      data: summarizedKpis,
      ratingCount,
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
        'employeeProfile.department',
        'employeeProfile.storeRole',
        'tasks',
        'tasks.kpiType',
        'tasks.kpiUnit',
        'tasks.kpiPeriod',
        'tasks.store',
      ],
    });

    if (!kpi) return null;

    // Lấy thông tin stores đầy đủ
    const stores =
      kpi.storeIds?.length > 0
        ? await this.storeRepository.find({ where: { id: In(kpi.storeIds) } })
        : [];

    const summarized = this.summarizeKpi(kpi);
    return {
      ...summarized,
      appliedStores: stores,
    };
  }

  private summarizeKpi(kpi: EmployeeKpi) {
    if (!kpi) return null;

    const tasks = kpi.tasks || [];
    let totalTarget = 0;
    let totalActualValue = 0;
    let totalCompletionRate = 0;

    tasks.forEach((task) => {
      totalTarget += Number(task.target) || 0;
      totalActualValue += Number(task.actualValue) || 0;
      totalCompletionRate += Number(task.completionRate) || 0;
    });

    const averageCompletionRate =
      tasks.length > 0 ? totalCompletionRate / tasks.length : 0;
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
        taskCount: tasks.length,
      },
    };
  }

  // KPI Task Management
  async createKpiTask(data: any, accountId?: string) {
    const kpi =
      typeof data?.employeeKpiId === 'string' && isUUID(data.employeeKpiId)
        ? await this.employeeKpiRepository.findOne({
            where: { id: data.employeeKpiId },
            select: ['id', 'employeeProfileId', 'storeIds', 'status'],
          })
        : null;
    if (!kpi) throw new NotFoundException('Không tìm thấy bảng KPI');
    // The owner, or the KPI's own employee while it is still a draft.
    const { storeId } = await this.assertKpiWriteAccess(kpi, accountId, {
      draftOnly: true,
    });

    const kpiStoreIds = kpi.storeIds?.length ? kpi.storeIds : [storeId];
    const fields = this.buildKpiTaskFields(data, kpiStoreIds);
    await this.assertRowsInStore(
      [...new Set([...kpiStoreIds, storeId])],
      this.kpiTaskReferences(fields),
    );
    // Tự động tính tỷ lệ hoàn thành (buildKpiTaskFields, clamped)
    const task = this.kpiTaskRepository.create({
      ...fields,
      employeeKpiId: kpi.id,
    });
    return this.kpiTaskRepository.save(task);
  }

  async updateKpiTaskProgress(
    id: string,
    actualValue: number,
    accountId?: string,
  ) {
    const task = await this.kpiTaskRepository.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Không tìm thấy nhiệm vụ KPI');
    // The owner, or the KPI's own employee self-reporting progress — but not
    // on a KPI the owner has already closed (completed or cancelled): only
    // completed KPIs count toward the career ladder.
    const kpi = await this.findKpiForTask(task);
    const actor = await this.assertKpiWriteAccess(kpi, accountId, {
      draftOnly: false,
    });
    if (
      !actor.isOwner &&
      (kpi.status === KpiStatus.COMPLETED || kpi.status === KpiStatus.CANCELLED)
    ) {
      throw new ForbiddenException({
        code: KPI_CLOSED,
        message: 'Bảng KPI đã đóng, không thể cập nhật tiến độ',
      });
    }

    task.actualValue = actualValue;
    if (task.target > 0) {
      // Clamped: completion_rate is decimal(5,2) and overflowed above 999.99.
      task.completionRate = kpiCompletionRate(actualValue, task.target);
    }
    return this.kpiTaskRepository.save(task);
  }

  async getKpiTasks(
    filters: {
      employeeKpiId?: string;
      storeId?: string;
      isHidden?: boolean;
    } = {},
  ) {
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

  async deleteKpiTask(id: string, accountId?: string) {
    const task = await this.kpiTaskRepository.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Không tìm thấy nhiệm vụ');
    await this.assertKpiWriteAccess(await this.findKpiForTask(task), accountId, {
      draftOnly: true,
    });
    await this.kpiTaskRepository.delete(id);
    return { message: 'Xóa nhiệm vụ thành công' };
  }

  async hideKpiTask(id: string, accountId?: string) {
    const task = await this.kpiTaskRepository.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Không tìm thấy nhiệm vụ');
    await this.assertKpiWriteAccess(await this.findKpiForTask(task), accountId, {
      draftOnly: true,
    });
    task.isHidden = true;
    return this.kpiTaskRepository.save(task);
  }

  async duplicateEmployeeKpi(id: string, accountId?: string) {
    const sourceKpi = await this.employeeKpiRepository.findOne({
      where: { id },
      relations: ['tasks'],
    });

    if (!sourceKpi) throw new NotFoundException('Không tìm thấy bảng KPI gốc');
    // The owner, or the KPI's own employee while the source is a draft.
    await this.assertKpiWriteAccess(sourceKpi, accountId, { draftOnly: true });

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

  /**
   * The store a KPI belongs to: that of the employee it rates. Soft-deleted
   * profiles still resolve, as in `StoreResourceLocator`.
   */
  private async kpiStoreId(employeeProfileId: string): Promise<string> {
    const profile = employeeProfileId
      ? await this.profileRepository.findOne({
          where: { id: employeeProfileId },
          select: ['id', 'storeId'],
          withDeleted: true,
        })
      : null;
    if (!profile?.storeId) {
      throw new NotFoundException('Không tìm thấy bảng KPI');
    }
    return profile.storeId;
  }

  /**
   * Who is changing an employee's KPI: the owner of the employee's store, or
   * the employee themself (their own profile, still employed). Anyone else —
   * including other members of the store — is refused (403).
   */
  private async resolveKpiActor(
    employeeProfileId: string,
    accountId: string | undefined,
    notFoundMessage = 'Không tìm thấy bảng KPI',
  ): Promise<{ storeId: string; isOwner: boolean }> {
    if (!accountId) {
      throw new ForbiddenException('Bạn không có quyền truy cập cửa hàng này');
    }
    const profile =
      typeof employeeProfileId === 'string' && isUUID(employeeProfileId)
        ? await this.profileRepository.findOne({
            where: { id: employeeProfileId },
            select: ['id', 'storeId', 'accountId', 'employmentStatus', 'deletedAt'],
            withDeleted: true,
          })
        : null;
    if (!profile?.storeId) throw new NotFoundException(notFoundMessage);
    const store = await this.storeRepository.findOne({
      where: { id: profile.storeId },
      select: ['id', 'ownerAccountId'],
    });
    if (!store) throw new NotFoundException('Cửa hàng không tồn tại');
    if (store.ownerAccountId === accountId) {
      return { storeId: store.id, isOwner: true };
    }
    if (
      profile.accountId === accountId &&
      !profile.deletedAt &&
      isEmployedStatus(profile.employmentStatus)
    ) {
      return { storeId: store.id, isOwner: false };
    }
    throw new ForbiddenException({
      code: KPI_SELF_OR_OWNER_REQUIRED,
      message: 'Bạn chỉ có thể thao tác trên KPI của chính mình',
    });
  }

  /**
   * Write access to an existing KPI (or its tasks): the store owner always;
   * the KPI's own employee, and with `draftOnly` only while it is 'Nháp'.
   */
  private async assertKpiWriteAccess(
    kpi: Pick<EmployeeKpi, 'employeeProfileId' | 'status'>,
    accountId: string | undefined,
    { draftOnly }: { draftOnly: boolean },
  ): Promise<{ storeId: string; isOwner: boolean }> {
    const actor = await this.resolveKpiActor(kpi.employeeProfileId, accountId);
    if (!actor.isOwner && draftOnly && kpi.status !== KpiStatus.DRAFT) {
      throw new ForbiddenException({
        code: KPI_NOT_DRAFT,
        message: 'Chỉ có thể chỉnh sửa bảng KPI khi còn ở trạng thái Nháp',
      });
    }
    return actor;
  }

  /**
   * Reading a KPI's tasks: the store owner or the KPI's own employee (the same
   * actors as writing, without the draft rule). 404 for an unknown KPI.
   */
  async assertKpiReadAccess(employeeKpiId: string, accountId: string | undefined) {
    const kpi = await this.findKpiForTask({ employeeKpiId });
    await this.resolveKpiActor(kpi.employeeProfileId, accountId);
  }

  /** The KPI a task belongs to (404 when it is gone). */
  private async findKpiForTask(
    task: Pick<KpiTask, 'employeeKpiId'>,
  ): Promise<Pick<EmployeeKpi, 'id' | 'employeeProfileId' | 'status'>> {
    const kpi = task.employeeKpiId
      ? await this.employeeKpiRepository.findOne({
          where: { id: task.employeeKpiId },
          select: ['id', 'employeeProfileId', 'status'],
        })
      : null;
    if (!kpi) throw new NotFoundException('Không tìm thấy bảng KPI');
    return kpi;
  }

  async createKpiApprovalRequest(
    data: {
      employeeProfileId?: string;
      employeeKpiId: string;
      note?: string;
    },
    accountId?: string,
  ) {
    const kpi = data?.employeeKpiId
      ? await this.employeeKpiRepository.findOne({
          where: { id: data.employeeKpiId },
          select: ['id', 'employeeProfileId'],
        })
      : null;
    if (!kpi) throw new NotFoundException('Không tìm thấy bảng KPI');
    // Members of the KPI's store only; the rated employee comes from the KPI
    // itself (released staff builds omit it, which failed the NOT NULL).
    await this.resolveStoreViewer(
      await this.kpiStoreId(kpi.employeeProfileId),
      accountId,
    );

    // Idempotent: a KPI has at most one pending request. The KPI row lock
    // serializes concurrent submissions, so the second one sees the first
    // and gets it back instead of inserting a duplicate.
    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.getRepository(EmployeeKpi).findOne({
        where: { id: kpi.id },
        select: ['id'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Không tìm thấy bảng KPI');

      const requests = manager.getRepository(KpiApprovalRequest);
      const existing = await requests.findOne({
        where: {
          employeeKpiId: kpi.id,
          status: KpiRequestStatus.PENDING,
        },
      });
      if (existing) return existing;

      const request = requests.create({
        employeeProfileId: kpi.employeeProfileId,
        employeeKpiId: kpi.id,
        note: data.note ?? null,
        status: KpiRequestStatus.PENDING,
      });
      return requests.save(request);
    });
  }

  async getKpiApprovalRequests(
    storeId: string | undefined,
    month: string | undefined,
    accountId: string | undefined,
  ) {
    let scope: (query: SelectQueryBuilder<KpiApprovalRequest>) => void;
    if (storeId) {
      const viewer = await this.resolveStoreViewer(storeId, accountId);
      // A KPI belongs to the store of the employee it rates (the same hop the
      // route guards use), not to whatever `store_ids` its author listed.
      scope = (query) => {
        query.andWhere('profile.store_id = :storeId', { storeId });
        if (!viewer.isOwner) {
          query.andWhere('kpi.employee_profile_id = :viewerProfileId', {
            viewerProfileId: viewer.profileId,
          });
        }
      };
    } else {
      // No store named (released apps): the stores the caller owns, plus the
      // caller's own KPIs where they are employed — never every tenant.
      if (!accountId) {
        throw new ForbiddenException('Bạn không có quyền truy cập cửa hàng này');
      }
      const [owned, ownProfiles] = await Promise.all([
        this.storeRepository.find({
          where: { ownerAccountId: accountId },
          select: ['id'],
        }),
        this.profileRepository.find({
          where: { accountId, employmentStatus: In([...EMPLOYED_STATUSES]) },
          select: ['id'],
        }),
      ]);
      const ownedStoreIds = owned.map((store) => store.id);
      const ownProfileIds = ownProfiles.map((profile) => profile.id);
      if (ownedStoreIds.length === 0 && ownProfileIds.length === 0) return [];
      scope = (query) => {
        query.andWhere(
          new Brackets((where) => {
            if (ownedStoreIds.length > 0) {
              where.orWhere('profile.store_id IN (:...ownedStoreIds)', {
                ownedStoreIds,
              });
            }
            if (ownProfileIds.length > 0) {
              where.orWhere('kpi.employee_profile_id IN (:...ownProfileIds)', {
                ownProfileIds,
              });
            }
          }),
        );
      };
    }

    const query = this.kpiApprovalRequestRepository
      .createQueryBuilder('request')
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

    scope(query);
    // Requests about a KPI from a rehired employee's previous stint are hidden.
    query.andWhere(currentStintSql('profile', 'kpi.created_at'));

    if (month) {
      query.andWhere("to_char(kpi.month, 'YYYY-MM') = :month", { month });
    }

    const requests = await query.getMany();

    // Fetch full store objects for appliedStores
    const allStoreIds = [
      ...new Set(requests.flatMap((r) => r.employeeKpi?.storeIds || [])),
    ];
    const stores =
      allStoreIds.length > 0
        ? await this.storeRepository.find({ where: { id: In(allStoreIds) } })
        : [];

    // Map store objects into the responses
    return requests.map((request) => {
      if (request.employeeKpi) {
        (request.employeeKpi as any).appliedStores = stores.filter((s) =>
          request.employeeKpi.storeIds?.includes(s.id),
        );
      }
      return request;
    });
  }

  async handleKpiApprovalRequest(
    id: string,
    reviewerAccountId: string,
    data: { status: KpiRequestStatus; note?: string },
  ) {
    const status = data?.status;
    if (
      status !== KpiRequestStatus.APPROVED &&
      status !== KpiRequestStatus.REJECTED
    ) {
      throw new BadRequestException('Trạng thái duyệt không hợp lệ');
    }

    const request = await this.kpiApprovalRequestRepository.findOne({
      where: { id },
      relations: ['employeeKpi'],
    });
    if (!request || !request.employeeKpi) {
      throw new NotFoundException('Không tìm thấy yêu cầu duyệt KPI');
    }

    // Only the owner of the KPI's store decides; a member approving their
    // own KPI was possible before.
    const storeId = await this.kpiStoreId(request.employeeKpi.employeeProfileId);
    await this.assertOwnerStoreAccess(storeId, reviewerAccountId);
    if (request.status !== KpiRequestStatus.PENDING) {
      throw new BadRequestException('Yêu cầu này đã được xử lý');
    }

    // `reviewer_id` references employee_profiles: the owner's own profile in
    // that store, or none. An account id here broke the foreign key.
    const reviewerProfile = await this.profileRepository.findOne({
      where: { accountId: reviewerAccountId, storeId },
      select: ['id'],
    });
    const reviewerId = reviewerProfile?.id ?? null;
    const note = data.note ?? null;

    return this.dataSource.transaction(async (manager) => {
      // Conditional on PENDING so two concurrent decisions cannot both apply.
      const result = await manager
        .getRepository(KpiApprovalRequest)
        .update(
          { id, status: KpiRequestStatus.PENDING },
          { status, reviewerId: reviewerId as string, note },
        );
      if (!result.affected) {
        throw new BadRequestException('Yêu cầu này đã được xử lý');
      }
      await manager.getRepository(EmployeeKpi).update(request.employeeKpiId, {
        // Chấp thuận -> kích hoạt bảng KPI; Từ chối -> đưa về Nháp.
        status:
          status === KpiRequestStatus.APPROVED
            ? KpiStatus.ACTIVE
            : KpiStatus.DRAFT,
      });
      return manager
        .getRepository(KpiApprovalRequest)
        .findOne({ where: { id } });
    });
  }

  async deleteEmployeeKpi(id: string, accountId?: string) {
    const kpi = await this.employeeKpiRepository.findOne({
      where: { id },
      select: ['id', 'employeeProfileId', 'status'],
    });
    if (!kpi) throw new NotFoundException('Không tìm thấy bảng KPI');
    // The owner, or the KPI's own employee while it is still a draft.
    await this.assertKpiWriteAccess(kpi, accountId, { draftOnly: true });
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

  /**
   * @param reportDateStr Vietnam calendar date 'YYYY-MM-DD'; defaults to
   * today in Vietnam. The old `setHours(0,0,0,0)` used the server clock (on a
   * UTC host the 00:05 VN cron created yesterday's report) and mutated the
   * caller's Date.
   */
  async createDailyReportForStore(storeId: string, reportDateStr?: string) {
    const reportDate = toDateMarker(reportDateStr ?? vnDateString());
    if (Number.isNaN(reportDate.getTime())) {
      throw new BadRequestException('Ngày báo cáo không hợp lệ');
    }

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
  async ensureDailyReportForStore(
    storeId: string,
  ): Promise<DailyEmployeeReport | null> {
    try {
      return await this.createDailyReportForStore(storeId);
    } catch (error) {
      this.logger.warn(
        `[EnsureDailyReport] Failed for store ${storeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
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
      this.logger.warn(
        `[EnsureDailyReport] Failed for owner ${ownerAccountId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Ghi nhận sự kiện chấm công vào DailyEmployeeReport.
   * Tự tạo report nếu chưa có (lazy init). Tránh duplicate employeeId.
   */
  async appendToDailyReport(
    storeId: string,
    field:
      | 'lateArrivals'
      | 'earlyDepartures'
      | 'forgotClockOut'
      | 'unauthorizedLeaves'
      | 'extraShifts'
      | 'authorizedLeaves',
    employeeId: string,
  ): Promise<void> {
    try {
      const report = await this.ensureDailyReportForStore(storeId);
      if (!report) return;

      // Atomic append. Loading the row, pushing onto the JSONB array and saving
      // the whole entity is a read-modify-write: two employees checking in at
      // the same store concurrently would each save their own copy and one
      // append would be lost. A single conditional UPDATE has no such window,
      // and `NOT @>` keeps it idempotent so retries cannot duplicate an id.
      const column =
        this.dailyReportRepository.metadata.findColumnWithPropertyName(
          field,
        )?.databaseName;
      if (!column) {
        this.logger.warn(`[DailyReport] unknown field ${field}`);
        return;
      }

      const result = await this.dailyReportRepository.query(
        `UPDATE ${this.dailyReportRepository.metadata.tableName}
            SET "${column}" = COALESCE("${column}", '[]'::jsonb) || to_jsonb($2::text)
          WHERE id = $1
            AND NOT (COALESCE("${column}", '[]'::jsonb) @> to_jsonb($2::text))`,
        [report.id, employeeId],
      );
      this.logger.debug(
        `[DailyReport] Appended ${employeeId} to ${field} for store ${storeId} (changed=${
          Array.isArray(result) ? result.length : result
        })`,
      );
    } catch (error) {
      this.logger.warn(
        `[DailyReport] append ${field} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Cron cuối ngày: ghi báo cáo ngày từ trạng thái chấm công đã chốt.
   * Không tự phân loại lại: quên chấm công ra = FORGOT_CHECKOUT (tự kết thúc
   * ca lúc hết ca + 15 phút), nghỉ không phép = ABSENT (ghi ngay khi hết ca,
   * cron mỗi phút), nghỉ có phép = ca chưa check-in có đơn nghỉ cả ngày đã
   * duyệt. Chỉ ghi vào báo cáo, không đổi trạng thái ca.
   */
  async detectEndOfDayAttendanceIssues(): Promise<{
    forgotCount: number;
    unauthorizedCount: number;
    authorizedCount?: number;
  }> {
    const now = new Date();
    const todayStr = vnDateString(now); // Vietnam 'YYYY-MM-DD'

    let forgotCount = 0;
    let unauthorizedCount = 0;
    let authorizedCount = 0;

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

      const slotIds = slots.map((s) => s.id);
      if (slotIds.length === 0) continue;

      // Tìm tất cả assignments cho các slots này
      const assignments = await this.shiftAssignmentRepository.find({
        where: {
          shiftSlotId: In(slotIds),
          status: In([
            ShiftAssignmentStatus.APPROVED,
            ShiftAssignmentStatus.CONFIRMED,
            ShiftAssignmentStatus.COMPLETED,
          ]),
        },
      });

      for (const assignment of assignments) {
        const slot = slots.find((s) => s.id === assignment.shiftSlotId);
        if (!slot) continue;

        // Check xem ca đã kết thúc chưa — mốc kết thúc tuyệt đối theo giờ
        // Việt Nam trên work_date của ca (ca qua đêm kết thúc ngày hôm sau).
        // `setHours` trên đồng hồ máy chủ bỏ sót mọi ca kết thúc sau 16:30 VN
        // khi máy chủ chạy UTC.
        // Kết thúc theo giờ đang áp dụng (đơn về sớm đã duyệt dời sớm hơn).
        const { end: shiftEnd } = effectiveWindowOf({
          adjustedStartAt: assignment.adjustedStartAt,
          adjustedEndAt: assignment.adjustedEndAt,
          shiftSlot: slot,
        });
        if (!shiftEnd || now < shiftEnd) continue; // Ca chưa kết thúc, bỏ qua

        // Quên chấm công ra: ca đã được hệ thống tự kết thúc.
        if (assignment.attendanceStatus === AttendanceStatus.FORGOT_CHECKOUT) {
          await this.appendToDailyReport(
            store.id,
            'forgotClockOut',
            assignment.employeeId,
          );
          forgotCount++;
          continue;
        }

        // Nghỉ không phép: đã ghi ABSENT lúc hết ca.
        if (assignment.attendanceStatus === AttendanceStatus.ABSENT) {
          await this.appendToDailyReport(
            store.id,
            'unauthorizedLeaves',
            assignment.employeeId,
          );
          unauthorizedCount++;
          continue;
        }

        // Nghỉ có phép: chưa check-in, có đơn nghỉ cả ngày đã duyệt.
        if (
          assignment.status === ShiftAssignmentStatus.APPROVED &&
          !assignment.checkInTime &&
          !assignment.attendanceStatus &&
          (await isShiftCoveredByApprovedLeave(
            this.dataSource,
            assignment.employeeId,
            String(slot.workDate).slice(0, 10),
            assignment.id,
          ))
        ) {
          await this.appendToDailyReport(
            store.id,
            'authorizedLeaves',
            assignment.employeeId,
          );
          authorizedCount++;
        }
      }
    }

    return { forgotCount, unauthorizedCount, authorizedCount };
  }

  async getDailyReports(storeId: string) {
    const reports = await this.dailyReportRepository.find({
      where: { storeId },
      order: { reportDate: 'DESC' },
    });

    return Promise.all(
      reports.map((report) => this.getFinancialDataForReport(report)),
    );
  }

  async getDailyReportById(id: string) {
    const report = await this.dailyReportRepository.findOne({ where: { id } });
    if (!report) return null;
    return this.getFinancialDataForReport(report);
  }

  async getDailyReportByDate(storeId: string, date: string | Date) {
    // Chuyển về format YYYY-MM-DD để query chính xác trong Postgres DATE column
    const dateString =
      typeof date === 'string' ? date.split('T')[0] : vnDateString(date);

    const report = await this.dailyReportRepository
      .createQueryBuilder('report')
      .where('report.store_id = :storeId', { storeId })
      .andWhere('CAST(report.report_date AS DATE) = :dateString', {
        dateString,
      })
      .getOne();

    if (!report) return null;

    return this.getFinancialDataForReport(report);
  }

  async getDailyReportByDateForOwner(
    storeId: string,
    date: string,
    ownerAccountId: string,
  ) {
    await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    const report = await this.getDailyReportByDate(storeId, date);
    if (!report) return null;

    const employeeIds = Array.from(
      new Set(
        [
          report.lateArrivals,
          report.earlyDepartures,
          report.forgotClockOut,
          report.unauthorizedLeaves,
          report.extraShifts,
          report.authorizedLeaves,
        ].flatMap((ids) => ids || []),
      ),
    );

    const profiles = employeeIds.length
      ? await this.profileRepository.find({
          where: { id: In(employeeIds), storeId: report.storeId },
          relations: ['account', 'storeRole', 'employeeType'],
        })
      : [];

    return {
      ...report,
      employees: profiles.map((profile) => ({
        id: profile.id,
        fullName: profile.account?.fullName,
        avatar: profile.account?.avatar,
        storeRole: profile.storeRole?.name,
        employeeType: profile.employeeType?.name,
      })),
    };
  }

  private async getFinancialDataForReport(report: DailyEmployeeReport) {
    // report_date là cột `date`: TypeORM trả về chuỗi 'YYYY-MM-DD'; một Date
    // (nếu có) là mốc nửa đêm giờ máy chủ, nên đọc theo giờ địa phương.
    const rawDate: unknown = report.reportDate;
    const reportDateStr =
      rawDate instanceof Date
        ? `${rawDate.getFullYear()}-${String(rawDate.getMonth() + 1).padStart(2, '0')}-${String(rawDate.getDate()).padStart(2, '0')}`
        : String(rawDate ?? '');
    const reportMonth = vnMonthOfDateString(reportDateStr);
    if (!reportMonth) return report;
    const month = toMonthMarker(reportMonth);

    const store = await this.storeRepository.findOne({
      where: { id: report.storeId },
    });
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
        month,
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
      estimatedPayment: currentPayroll
        ? Number(currentPayroll.estimatedPayment)
        : 0,
      salaryFund: currentPayroll ? Number(currentPayroll.salaryFund) : 0,
      estimatedPaymentTotalStore,
      salaryFundTotalStore,
    };
  }

  async updateDailyReport(id: string, data: Partial<DailyEmployeeReport>) {
    await this.dailyReportRepository.update(id, data);
    return this.dailyReportRepository.findOne({ where: { id } });
  }

  /** @param date Vietnam calendar date 'YYYY-MM-DD'; defaults to today in Vietnam. */
  async createDailyReportsForAllStores(date?: string) {
    const stores = await this.storeRepository.find({
      where: { status: StoreStatus.ACTIVE },
    });

    const results: DailyEmployeeReport[] = [];
    for (const store of stores) {
      try {
        const report = await this.createDailyReportForStore(store.id, date);
        results.push(report);
      } catch (error) {
        console.error(
          `Failed to create daily report for store ${store.id}:`,
          error,
        );
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
    const event = this.eventRepository.create({
      ...this.creatableRow(this.eventRepository, data),
      storeId,
    });
    return this.eventRepository.save(event);
  }

  async getEvents(storeId: string, timeRange?: string, type?: StoreEventType) {
    const where: any = { storeId };

    if (type) {
      where.type = type;
    }

    if (timeRange) {
      const todayStr = vnDateString();

      if (timeRange === 'today') {
        where.eventDate = todayStr;
      } else if (timeRange === 'yesterday') {
        where.eventDate = addDays(todayStr, -1);
      } else if (timeRange === '1_week') {
        where.eventDate = Between(addDays(todayStr, -7), todayStr);
      } else if (timeRange === '1_month') {
        const lastMonth = parseDateOnly(todayStr);
        lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
        where.eventDate = Between(
          lastMonth.toISOString().slice(0, 10),
          todayStr,
        );
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
    const category = this.assetCategoryRepository.create({
      ...this.creatableRow(this.assetCategoryRepository, data),
      storeId,
    });
    return this.assetCategoryRepository.save(category);
  }

  async getAssetCategories(storeId: string) {
    return this.assetCategoryRepository.find({
      where: { storeId, isActive: true },
    });
  }

  // Asset Status management
  async createAssetStatus(storeId: string, data: Partial<AssetStatus>) {
    const status = this.assetStatusRepository.create({
      ...this.creatableRow(this.assetStatusRepository, data),
      storeId,
    });
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
      ...this.creatableRow(this.productCategoryRepository, data),
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
    const status = this.productStatusRepository.create({
      ...this.creatableRow(this.productStatusRepository, data),
      storeId,
    });
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
      if (reportData.targetAssetStatusId === '')
        reportData.targetAssetStatusId = null;

      const report = this.inventoryReportRepository.create(
        reportData as Partial<InventoryReport>,
      );

      // Ánh xạ ảnh từ mảng files vào báo cáo tương ứng
      // Quy chuẩn: file gửi lên có fieldname là 'file_idx_subidx' ví dụ 'file_0_1'
      const reportImages = files
        .filter((file) => file.fieldname.startsWith(`file_${index}_`))
        .map((file) => file.path); // Hoặc logic lưu path phù hợp với project

      if (reportImages.length > 0) {
        report.images = reportImages;
      }

      return report;
    });

    return this.inventoryReportRepository.save(reportEntities);
  }

  async getInventoryReports(filters: {
    storeId?: string;
    status?: InventoryReportStatus;
    type?: string;
  }) {
    const query = this.inventoryReportRepository
      .createQueryBuilder('report')
      .leftJoinAndSelect('report.reporter', 'reporter')
      .leftJoinAndSelect('reporter.account', 'account')
      .leftJoinAndSelect('report.asset', 'asset')
      .leftJoinAndSelect('report.product', 'product')
      .orderBy('report.created_at', 'DESC');

    if (filters.storeId) {
      query.andWhere('report.store_id = :storeId', {
        storeId: filters.storeId,
      });
    }

    if (filters.status) {
      query.andWhere('report.status = :status', { status: filters.status });
    }

    if (filters.type) {
      query.andWhere('report.type = :type', { type: filters.type });
    }

    return query.getMany();
  }

  async handleInventoryReport(
    id: string,
    updates: { status: InventoryReportStatus; adminNote?: string },
  ) {
    const report = await this.inventoryReportRepository.findOne({
      where: { id },
    });
    if (!report) throw new NotFoundException('Không tìm thấy báo cáo sự cố');

    Object.assign(report, updates);
    return this.inventoryReportRepository.save(report);
  }

  // Service Category Management
  async createServiceCategory(storeId: string, data: any) {
    const category = this.serviceCategoryRepository.create({
      ...this.creatableRow(this.serviceCategoryRepository, data),
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
    // Multipart body, unseen by the guard and the DTO pipe: the same fields
    // an update may set (never `id`/`storeId`/relations), with the category
    // inside the addressed store.
    const fields = pickDefined(data, SERVICE_ITEM_EDITABLE_FIELDS);
    await this.assertRowsInStore(storeId, [
      {
        repository: this.serviceCategoryRepository,
        id: fields.categoryId,
        label: 'Danh mục',
      },
    ]);
    const item = this.serviceItemRepository.create({
      ...(fields as Partial<ServiceItem>),
      storeId,
    });
    return this.serviceItemRepository.save(item);
  }

  async createFnbServiceItem(storeId: string, data: CreateFnbServiceItemDto) {
    const { categoryId, recipes, ...itemData } = data;

    // 1. Validate category
    const category = await this.serviceCategoryRepository.findOne({
      where: { id: categoryId, storeId, type: ServiceType.FNB },
    });

    if (!category) {
      throw new NotFoundException(
        'Danh mục không tồn tại hoặc không phải loại F&B',
      );
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
    const totalCount = categoryCounts.reduce(
      (sum, cat) => sum + Number(cat.count),
      0,
    );

    // Format summary
    const summary = [
      { id: 'all', name: 'Tất cả', count: totalCount },
      ...categoryCounts.map((c) => ({
        id: c.id,
        name: c.name,
        count: Number(c.count),
      })),
    ];

    return {
      summary,
      items,
    };
  }

  async createYieldServiceItem(
    storeId: string,
    data: CreateYieldServiceItemDto,
  ) {
    const { categoryId, ...itemData } = data;

    let targetCategoryId = categoryId;

    if (categoryId) {
      // Validate provided category
      const category = await this.serviceCategoryRepository.findOne({
        where: { id: categoryId, storeId, type: ServiceType.YIELD_DELIVERY },
      });

      if (!category) {
        throw new NotFoundException(
          'Danh mục không tồn tại hoặc không phải loại YIELD_DELIVERY',
        );
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
        defaultCategory =
          await this.serviceCategoryRepository.save(defaultCategory);
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
    const totalCount = categoryCounts.reduce(
      (sum, cat) => sum + Number(cat.count),
      0,
    );

    // Format summary
    const summary = [
      { id: 'all', name: 'Tất cả', count: totalCount },
      ...categoryCounts.map((c) => ({
        id: c.id,
        name: c.name,
        count: Number(c.count),
      })),
    ];

    return {
      summary,
      items,
    };
  }

  async createPersonalCareItem(
    storeId: string,
    data: CreatePersonalCareItemDto,
  ) {
    const { categoryId, ...itemData } = data;

    let targetCategoryId = categoryId;

    if (categoryId) {
      // Validate provided category
      const category = await this.serviceCategoryRepository.findOne({
        where: { id: categoryId, storeId, type: ServiceType.PERSONAL_CARE },
      });

      if (!category) {
        throw new NotFoundException(
          'Danh mục không tồn tại hoặc không phải loại PERSONAL_CARE',
        );
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
        defaultCategory =
          await this.serviceCategoryRepository.save(defaultCategory);
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
    const totalCount = categoryCounts.reduce(
      (sum, cat) => sum + Number(cat.count),
      0,
    );

    // Format summary
    const summary = [
      { id: 'all', name: 'Tất cả', count: totalCount },
      ...categoryCounts.map((c) => ({
        id: c.id,
        name: c.name,
        count: Number(c.count),
      })),
    ];

    return {
      summary,
      items,
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
        throw new NotFoundException(
          'Danh mục không tồn tại hoặc không phải loại PET_CARE',
        );
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
        defaultCategory =
          await this.serviceCategoryRepository.save(defaultCategory);
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
    const totalCount = categoryCounts.reduce(
      (sum, cat) => sum + Number(cat.count),
      0,
    );

    // Format summary
    const summary = [
      { id: 'all', name: 'Tất cả', count: totalCount },
      ...categoryCounts.map((c) => ({
        id: c.id,
        name: c.name,
        count: Number(c.count),
      })),
    ];

    return {
      summary,
      items,
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
    const item = await this.serviceItemRepository.findOne({
      where: { id },
      select: ['id', 'storeId'],
    });
    if (!item) throw new NotFoundException('Không tìm thấy mặt hàng');
    // Multipart body, unseen by the guard: take only editable fields (never
    // `storeId`/`id`), and keep the category inside the item's store.
    const changes: Record<string, unknown> = {};
    for (const field of SERVICE_ITEM_EDITABLE_FIELDS) {
      if (data?.[field] !== undefined) changes[field] = data[field];
    }
    await this.assertRowsInStore(item.storeId, [
      {
        repository: this.serviceCategoryRepository,
        id: changes.categoryId,
        label: 'Danh mục',
      },
    ]);
    if (Object.keys(changes).length > 0) {
      await this.serviceItemRepository.update(id, changes);
    }
    return this.getServiceItemById(id);
  }

  async deleteServiceItem(id: string) {
    await this.serviceItemRepository.update(id, { isActive: false });
    return { message: 'Service item deleted successfully' };
  }

  // Service Item Recipe Management
  /** The store of a service item (404 when it does not exist). */
  private async serviceItemStoreId(serviceItemId: string): Promise<string> {
    const item =
      typeof serviceItemId === 'string' && isUUID(serviceItemId)
        ? await this.serviceItemRepository.findOne({
            where: { id: serviceItemId },
            select: ['id', 'storeId'],
          })
        : null;
    if (!item) throw new NotFoundException('Không tìm thấy mặt hàng');
    return item.storeId;
  }

  async createServiceItemRecipe(serviceItemId: string, data: any) {
    const storeId = await this.serviceItemStoreId(serviceItemId);
    const fields = this.pickRecipeFields(data);
    await this.assertRowsInStore(storeId, [
      { repository: this.productRepository, id: fields.productId, label: 'Nguyên liệu' },
    ]);
    const recipe = this.serviceItemRecipeRepository.create({
      ...fields,
      serviceItemId,
    });
    return this.serviceItemRecipeRepository.save(recipe);
  }

  /** The client-settable fields of a recipe line. */
  private pickRecipeFields(data: any): Partial<ServiceItemRecipe> {
    const fields: Partial<ServiceItemRecipe> = {};
    if (data?.productId !== undefined) fields.productId = data.productId;
    if (data?.quantity !== undefined) fields.quantity = data.quantity;
    if (data?.unit !== undefined) fields.unit = data.unit;
    if (data?.note !== undefined) fields.note = data.note;
    return fields;
  }

  async getServiceItemRecipes(serviceItemId: string) {
    return this.serviceItemRecipeRepository.find({
      where: { serviceItemId },
      relations: ['product', 'product.productUnit'],
    });
  }

  async updateServiceItemRecipe(id: string, data: UpdateServiceItemRecipeDto) {
    const recipe = await this.serviceItemRecipeRepository.findOne({
      where: { id },
      select: ['id', 'serviceItemId'],
    });
    if (!recipe) throw new NotFoundException('Không tìm thấy định lượng');
    // Both ends of the recipe must stay in the recipe's current store.
    const storeId = await this.serviceItemStoreId(recipe.serviceItemId);
    const changes: Partial<ServiceItemRecipe> = this.pickRecipeFields(data);
    if (data?.serviceItemId !== undefined) {
      if ((await this.serviceItemStoreId(data.serviceItemId)) !== storeId) {
        throw new BadRequestException('Mặt hàng không thuộc cửa hàng này');
      }
      changes.serviceItemId = data.serviceItemId;
    }
    await this.assertRowsInStore(storeId, [
      { repository: this.productRepository, id: changes.productId, label: 'Nguyên liệu' },
    ]);
    if (Object.keys(changes).length > 0) {
      await this.serviceItemRecipeRepository.update(id, changes);
    }
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
    if (!Array.isArray(recipes)) {
      throw new BadRequestException('recipes phải là một mảng');
    }
    const storeId = await this.serviceItemStoreId(serviceItemId);
    const rows = recipes.map((recipe) => this.pickRecipeFields(recipe));
    for (const row of rows) {
      await this.assertRowsInStore(storeId, [
        { repository: this.productRepository, id: row.productId, label: 'Nguyên liệu' },
      ]);
    }
    const recipeEntities = rows.map((recipe) =>
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

  async createOrder(
    storeId: string,
    employeeId: string | undefined,
    data: any,
  ) {
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
          stockTransaction =
            await this.stockTransactionRepository.save(stockTransaction);
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
  private async queryRevenueSummary(
    storeId: string,
    startDate: Date,
    endDate: Date,
    halfOpenRange: boolean,
  ) {
    const query = this.orderRepository
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
      });

    if (halfOpenRange) {
      query.andWhere('o.created_at >= :startDate AND o.created_at < :endDate', {
        startDate,
        endDate,
      });
    } else {
      query.andWhere('o.created_at BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      });
    }

    return query.getRawOne();
  }

  private mapRevenueSummary(summary: any) {
    const totalRevenue = parseFloat(summary?.totalRevenue || 0);
    const totalCost = parseFloat(summary?.totalCost || 0);
    const totalTax = parseFloat(summary?.totalTax || 0);

    return {
      totalRevenue,
      totalCost,
      totalProfit: totalRevenue - totalCost - totalTax,
      totalDiscount: parseFloat(summary?.totalDiscount || 0),
      totalTax,
      totalOrders: parseInt(summary?.totalOrders || '0'),
      successOrders: parseInt(summary?.successOrders || '0'),
      failedOrders: parseInt(summary?.failedOrders || '0'),
    };
  }

  async getHomeRevenueSummary(
    storeId: string,
    startDate: Date,
    endExclusiveDate: Date,
    ownerAccountId: string,
  ) {
    await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    const summary = this.mapRevenueSummary(
      await this.queryRevenueSummary(
        storeId,
        startDate,
        endExclusiveDate,
        true,
      ),
    );

    return {
      summary: {
        totalRevenue: summary.totalRevenue,
        totalOrders: summary.totalOrders,
        totalProfit: summary.totalProfit,
        totalCost: summary.totalCost,
        // Completed and cancelled orders; the owner report's order card
        // compares them day by day.
        successOrders: summary.successOrders,
        failedOrders: summary.failedOrders,
      },
    };
  }

  /**
   * @param startDate first instant of the range (VN midnight)
   * @param endDate first instant AFTER the range (half-open), as built by
   *   resolveStoreRevenueDateRange
   */
  async getRevenueReport(
    storeId: string,
    startDate: Date,
    endDate: Date,
    accountId: string,
  ) {
    await this.assertStoreRevenueReportAccess(storeId, accountId);

    // 1. Overall Summary (All orders in period)
    const summary = await this.queryRevenueSummary(
      storeId,
      startDate,
      endDate,
      true,
    );

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
      .andWhere('o.created_at >= :startDate AND o.created_at < :endDate', {
        startDate,
        endDate,
      })
      .groupBy("DATE_TRUNC('day', o.created_at)")
      .orderBy('"date"', 'ASC')
      .getRawMany();

    // 3. Revenue by Service Type
    const byType = await this.orderRepository
      .createQueryBuilder('o')
      .select('o.type', 'type')
      .addSelect('SUM(o."totalAmount")', 'revenue')
      .addSelect('COUNT(o.id)', 'count')
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.status = :status', { status: OrderStatus.COMPLETED })
      .andWhere('o.created_at >= :startDate AND o.created_at < :endDate', {
        startDate,
        endDate,
      })
      .groupBy('o.type')
      .getRawMany();

    // 3b. Revenue by work shift: completed revenue per minute of the day
    // (at most 1440 rows, whatever the range), attributed to the store's
    // active shifts in revenueByShift.
    const [revenueByMinute, activeShifts] = await Promise.all([
      this.orderRepository
        .createQueryBuilder('o')
        .select("TO_CHAR(o.created_at, 'HH24:MI')", 'minute')
        .addSelect('SUM(o."totalAmount")', 'revenue')
        .addSelect('COUNT(o.id)', 'orders')
        .where('o.store_id = :storeId', { storeId })
        .andWhere('o.status = :status', { status: OrderStatus.COMPLETED })
        .andWhere('o.created_at >= :startDate AND o.created_at < :endDate', {
          startDate,
          endDate,
        })
        .groupBy("TO_CHAR(o.created_at, 'HH24:MI')")
        .getRawMany(),
      this.workShiftRepository.find({
        where: { storeId, isActive: true },
        // `id` breaks ties between shifts with the same start, so an
        // overlap always resolves to the same shift.
        order: { startTime: 'ASC', id: 'ASC' },
      }),
    ]);

    // 4. Top Selling Items
    let topItems: any[] = [];
    try {
      topItems = await this.orderItemRepository
        .createQueryBuilder('item')
        .innerJoin('item.order', 'o')
        .select('item."itemSnapshot"->>\'name\'', 'name')
        .addSelect('SUM(item.quantity)', 'totalQuantity')
        .addSelect('SUM(item."totalPrice")', 'totalRevenue')
        .where('o.store_id = :storeId', { storeId })
        .andWhere('o.status = :status', { status: OrderStatus.COMPLETED })
        .andWhere('o.created_at >= :startDate AND o.created_at < :endDate', {
          startDate,
          endDate,
        })
        .groupBy('item."itemSnapshot"->>\'name\'')
        .orderBy('"totalQuantity"', 'DESC')
        .limit(10)
        .getRawMany();
    } catch (e) {
      // If no order items exist yet, this query may fail
      topItems = [];
    }

    const mappedSummary = this.mapRevenueSummary(summary);

    // The same number of days just before the range, for the "so với kỳ
    // trước" badges. Clients read `comparison`, which this report never
    // returned, so those badges were always 0%.
    const previousStart = new Date(
      startDate.getTime() - (endDate.getTime() - startDate.getTime()),
    );
    const previousSummary = this.mapRevenueSummary(
      await this.queryRevenueSummary(storeId, previousStart, startDate, true),
    );
    const change = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100 * 10) / 10;
    };
    const comparison = {
      previousPeriod: {
        start: vnDateString(previousStart),
        end: vnDateString(new Date(startDate.getTime() - 1)),
      },
      // For ratios a client derives itself (e.g. average order value).
      previousTotals: {
        totalRevenue: previousSummary.totalRevenue,
        totalCost: previousSummary.totalCost,
        totalProfit: previousSummary.totalProfit,
        totalOrders: previousSummary.totalOrders,
        successOrders: previousSummary.successOrders,
      },
      revenueChange: change(
        mappedSummary.totalRevenue,
        previousSummary.totalRevenue,
      ),
      costChange: change(mappedSummary.totalCost, previousSummary.totalCost),
      profitChange: change(
        mappedSummary.totalProfit,
        previousSummary.totalProfit,
      ),
      ordersChange: change(
        mappedSummary.totalOrders,
        previousSummary.totalOrders,
      ),
    };

    const totalRev = mappedSummary.totalRevenue;
    const totalCost = mappedSummary.totalCost;
    const totalTax = mappedSummary.totalTax;
    const totalProfit = mappedSummary.totalProfit;

    // A.I Insight Heuristic
    let insight = '';
    if (totalProfit < 0) {
      insight = `Cảnh báo: Lợi nhuận đang âm (${formatVnMoney(totalProfit, ' VNĐ')}). Cần kiểm tra lại chi phí vận hành.`;
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

    return {
      summary: mappedSummary,
      comparison,
      insight,
      daily: dailyMapped,
      byShift: revenueByShift(activeShifts ?? [], revenueByMinute ?? []),
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
      .innerJoin('e.account', 'a')
      .select('e.id', 'employeeId')
      .addSelect('a.fullName', 'fullName')
      .addSelect('a.avatar', 'avatarUrl')
      .addSelect(
        'SUM(CASE WHEN o.status = :completed THEN o."totalAmount" ELSE 0 END)',
        'totalRevenue',
      )
      .addSelect('COUNT(o.id)', 'totalOrders')
      .where('o.store_id = :storeId', {
        storeId,
        completed: OrderStatus.COMPLETED,
      })
      .andWhere('o.status = :completed', { completed: OrderStatus.COMPLETED })
      .andWhere('o.created_at BETWEEN :startDate AND :endDate', {
        startDate,
        endDate: adjustedEndDate,
      })
      .groupBy('e.id')
      .addGroupBy('a.fullName')
      .addGroupBy('a.avatar')
      .orderBy('"totalRevenue"', 'DESC')
      .limit(3)
      .getRawMany();

    return topEmployees.map((e) => ({
      employeeId: e.employeeId,
      fullName: e.fullName,
      avatarUrl: e.avatar,
      revenue: parseFloat(e.totalRevenue || '0'),
      ordersCount: parseInt(e.totalOrders || '0'),
    }));
  }

  // --- Order Statistics Report (for Dashboard) ---
  async getOrderStatistics(
    storeId: string,
    period: 'week' | 'month' | 'year',
    dateStr?: string,
  ) {
    const now = dateStr ? new Date(dateStr) : new Date();
    let startDate: Date;
    let endDate: Date;
    let previousStartDate: Date;
    let previousEndDate: Date;
    let labels: string[] = [];
    let previousPeriodDays = 7;

    if (period === 'week') {
      // Current week (last 7 days)
      endDate = new Date(now);
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 6);
      // Previous week
      previousEndDate = new Date(startDate);
      previousEndDate.setDate(previousEndDate.getDate() - 1);
      previousStartDate = new Date(previousEndDate);
      previousStartDate.setDate(previousStartDate.getDate() - 6);
      previousPeriodDays = 7;
      // Labels for week
      for (let i = 0; i < 7; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        labels.push(`T${d.getDay() === 0 ? 'CN' : d.getDay()}`);
      }
    } else if (period === 'month') {
      // Current month
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      // Previous month
      previousEndDate = new Date(now.getFullYear(), now.getMonth(), 0);
      previousStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      previousPeriodDays = previousEndDate.getDate();
      // Labels (every ~5 days for month view)
      const daysInMonth = endDate.getDate();
      for (let i = 0; i < 6; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + Math.floor((daysInMonth / 5) * i));
        labels.push(`T${d.getDate()}`);
      }
    } else {
      // Current year
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date(now.getFullYear(), 11, 31);
      // Previous year
      previousStartDate = new Date(now.getFullYear() - 1, 0, 1);
      previousEndDate = new Date(now.getFullYear() - 1, 11, 31);
      previousPeriodDays = 365;
      // Labels for year (quarters)
      labels = ['Q1', 'Q2', 'Q3', 'Q4'];
    }

    endDate.setHours(23, 59, 59, 999);
    previousEndDate.setHours(23, 59, 59, 999);

    const [currentStats, previousStats, currentByDay, previousByDay] =
      await Promise.all([
        // Current period summary
        this.orderRepository
          .createQueryBuilder('o')
          .select('COUNT(o.id)', 'total')
          .addSelect(
            'COUNT(CASE WHEN o.status = :completed THEN 1 END)',
            'success',
          )
          .addSelect(
            'COUNT(CASE WHEN o.status = :cancelled THEN 1 END)',
            'failed',
          )
          .where('o.store_id = :storeId', { storeId })
          .andWhere('o.created_at BETWEEN :start AND :end', {
            start: startDate,
            end: endDate,
          })
          .setParameters({
            completed: OrderStatus.COMPLETED,
            cancelled: OrderStatus.CANCELLED,
          })
          .getRawOne(),
        // Previous period summary
        this.orderRepository
          .createQueryBuilder('o')
          .select('COUNT(o.id)', 'total')
          .addSelect(
            'COUNT(CASE WHEN o.status = :completed THEN 1 END)',
            'success',
          )
          .addSelect(
            'COUNT(CASE WHEN o.status = :cancelled THEN 1 END)',
            'failed',
          )
          .where('o.store_id = :storeId', { storeId })
          .andWhere('o.created_at BETWEEN :start AND :end', {
            start: previousStartDate,
            end: previousEndDate,
          })
          .setParameters({
            completed: OrderStatus.COMPLETED,
            cancelled: OrderStatus.CANCELLED,
          })
          .getRawOne(),
        // Current period by day/week/month
        period === 'week'
          ? this.orderRepository
              .createQueryBuilder('o')
              .select("TO_CHAR(o.created_at, 'Dy')", 'label')
              .addSelect(
                'COUNT(CASE WHEN o.status = :completed THEN 1 END)',
                'success',
              )
              .addSelect(
                'COUNT(CASE WHEN o.status = :cancelled THEN 1 END)',
                'failed',
              )
              .where('o.store_id = :storeId', { storeId })
              .andWhere('o.created_at BETWEEN :start AND :end', {
                start: startDate,
                end: endDate,
              })
              .setParameters({
                completed: OrderStatus.COMPLETED,
                cancelled: OrderStatus.CANCELLED,
              })
              .groupBy("TO_CHAR(o.created_at, 'Dy')")
              .getRawMany()
          : period === 'month'
            ? this.orderRepository
                .createQueryBuilder('o')
                .select("DATE_TRUNC('week', o.created_at)", 'label')
                .addSelect(
                  'COUNT(CASE WHEN o.status = :completed THEN 1 END)',
                  'success',
                )
                .addSelect(
                  'COUNT(CASE WHEN o.status = :cancelled THEN 1 END)',
                  'failed',
                )
                .where('o.store_id = :storeId', { storeId })
                .andWhere('o.created_at BETWEEN :start AND :end', {
                  start: startDate,
                  end: endDate,
                })
                .setParameters({
                  completed: OrderStatus.COMPLETED,
                  cancelled: OrderStatus.CANCELLED,
                })
                .groupBy("DATE_TRUNC('week', o.created_at)")
                .getRawMany()
            : this.orderRepository
                .createQueryBuilder('o')
                .select("DATE_TRUNC('quarter', o.created_at)", 'label')
                .addSelect(
                  'COUNT(CASE WHEN o.status = :completed THEN 1 END)',
                  'success',
                )
                .addSelect(
                  'COUNT(CASE WHEN o.status = :cancelled THEN 1 END)',
                  'failed',
                )
                .where('o.store_id = :storeId', { storeId })
                .andWhere('o.created_at BETWEEN :start AND :end', {
                  start: startDate,
                  end: endDate,
                })
                .setParameters({
                  completed: OrderStatus.COMPLETED,
                  cancelled: OrderStatus.CANCELLED,
                })
                .groupBy("DATE_TRUNC('quarter', o.created_at)")
                .getRawMany(),
        // Previous period same granularity
        period === 'week'
          ? this.orderRepository
              .createQueryBuilder('o')
              .select("TO_CHAR(o.created_at, 'Dy')", 'label')
              .addSelect(
                'COUNT(CASE WHEN o.status = :completed THEN 1 END)',
                'success',
              )
              .addSelect(
                'COUNT(CASE WHEN o.status = :cancelled THEN 1 END)',
                'failed',
              )
              .where('o.store_id = :storeId', { storeId })
              .andWhere('o.created_at BETWEEN :start AND :end', {
                start: previousStartDate,
                end: previousEndDate,
              })
              .setParameters({
                completed: OrderStatus.COMPLETED,
                cancelled: OrderStatus.CANCELLED,
              })
              .groupBy("TO_CHAR(o.created_at, 'Dy')")
              .getRawMany()
          : period === 'month'
            ? this.orderRepository
                .createQueryBuilder('o')
                .select("DATE_TRUNC('week', o.created_at)", 'label')
                .addSelect(
                  'COUNT(CASE WHEN o.status = :completed THEN 1 END)',
                  'success',
                )
                .addSelect(
                  'COUNT(CASE WHEN o.status = :cancelled THEN 1 END)',
                  'failed',
                )
                .where('o.store_id = :storeId', { storeId })
                .andWhere('o.created_at BETWEEN :start AND :end', {
                  start: previousStartDate,
                  end: previousEndDate,
                })
                .setParameters({
                  completed: OrderStatus.COMPLETED,
                  cancelled: OrderStatus.CANCELLED,
                })
                .groupBy("DATE_TRUNC('week', o.created_at)")
                .getRawMany()
            : this.orderRepository
                .createQueryBuilder('o')
                .select("DATE_TRUNC('quarter', o.created_at)", 'label')
                .addSelect(
                  'COUNT(CASE WHEN o.status = :completed THEN 1 END)',
                  'success',
                )
                .addSelect(
                  'COUNT(CASE WHEN o.status = :cancelled THEN 1 END)',
                  'failed',
                )
                .where('o.store_id = :storeId', { storeId })
                .andWhere('o.created_at BETWEEN :start AND :end', {
                  start: previousStartDate,
                  end: previousEndDate,
                })
                .setParameters({
                  completed: OrderStatus.COMPLETED,
                  cancelled: OrderStatus.CANCELLED,
                })
                .groupBy("DATE_TRUNC('quarter', o.created_at)")
                .getRawMany(),
      ]);

    // Calculate percentage changes
    const calcChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100 * 10) / 10;
    };

    const rateOf = (part: number, whole: number) =>
      whole > 0 ? (part / whole) * 100 : 0;
    const pointChange = (
      part: number,
      whole: number,
      previousPart: number,
      previousWhole: number,
    ) =>
      Math.round(
        (rateOf(part, whole) - rateOf(previousPart, previousWhole)) * 10,
      ) / 10;

    const currTotal = parseInt(currentStats?.total || '0');
    const prevTotal = parseInt(previousStats?.total || '0');
    const currSuccess = parseInt(currentStats?.success || '0');
    const prevSuccess = parseInt(previousStats?.success || '0');
    const currFailed = parseInt(currentStats?.failed || '0');
    const prevFailed = parseInt(previousStats?.failed || '0');

    // Format chart data - convert English day names to Vietnamese
    const dayMap: Record<string, string> = {
      Mon: 'T2',
      Tue: 'T3',
      Wed: 'T4',
      Thu: 'T5',
      Fri: 'T6',
      Sat: 'T7',
      Sun: 'CN',
    };

    const chartData = (currentByDay || []).map((d: any) => ({
      label:
        period === 'week'
          ? dayMap[d.label] || d.label
          : new Date(d.label).toLocaleDateString('vi-VN', {
              day: '2-digit',
              month: '2-digit',
            }),
      success: parseInt(d.success || '0'),
      failed: parseInt(d.failed || '0'),
    }));

    // If no data, provide empty structure
    if (chartData.length === 0) {
      for (const l of labels) {
        chartData.push({ label: l, success: 0, failed: 0 });
      }
    }

    // Get cancellation reasons from failed orders
    const cancelReasons = await this.getCancelReasons(
      storeId,
      startDate,
      endDate,
    );

    return {
      summary: {
        total: currTotal,
        success: currSuccess,
        failed: currFailed,
        successRate:
          currTotal > 0 ? Math.round((currSuccess / currTotal) * 1000) / 10 : 0,
        cancelRate:
          currTotal > 0 ? Math.round((currFailed / currTotal) * 1000) / 10 : 0,
        changes: {
          total: calcChange(currTotal, prevTotal),
          success: calcChange(currSuccess, prevSuccess),
          failed: calcChange(currFailed, prevFailed),
        },
        // Change in the rates themselves, in percentage points (the success
        // and cancel rate cards showed a fixed "+0%").
        rateChanges: {
          successRate: pointChange(
            currSuccess,
            currTotal,
            prevSuccess,
            prevTotal,
          ),
          cancelRate: pointChange(currFailed, currTotal, prevFailed, prevTotal),
        },
      },
      chartData,
      labels,
      cancellationReasons: cancelReasons,
      periodLabel:
        period === 'week'
          ? 'Tuần này'
          : period === 'month'
            ? `Tháng ${now.getMonth() + 1}/${now.getFullYear()}`
            : `Năm ${now.getFullYear()}`,
    };
  }

  // --- Expense Report ---
  /**
   * @param startDate first instant of the range (VN midnight)
   * @param endDate first instant AFTER the range (half-open), as built by
   *   resolveStoreRevenueDateRange
   */
  async getExpenseReport(storeId: string, startDate: Date, endDate: Date) {
    // The range's first and last VN calendar days. Payroll months come from
    // these strings, so they no longer depend on the server's time zone.
    const firstDay = vnDateString(startDate);
    const lastDay = vnDateString(new Date(endDate.getTime() - 1));

    // Payroll months touched by a range of VN days, as 'YYYY-MM'.
    const monthsBetween = (from: string, to: string): string[] => {
      const months: string[] = [];
      let [year, month] = from.split('-').map(Number);
      const [lastYear, lastMonth] = to.split('-').map(Number);
      while (year < lastYear || (year === lastYear && month <= lastMonth)) {
        months.push(`${year}-${String(month).padStart(2, '0')}`);
        if (month === 12) {
          year += 1;
          month = 1;
        } else {
          month += 1;
        }
      }
      return months;
    };
    const monthsInRange = monthsBetween(firstDay, lastDay);

    // 1. Get material costs from stock transactions (using total_amount from StockTransaction)
    const materialCosts = await this.stockTransactionRepository
      .createQueryBuilder('t')
      .select('SUM(t.total_amount)', 'totalCost')
      .addSelect("TO_CHAR(t.transaction_date, 'YYYY-MM-DD')", 'date')
      .where('t.store_id = :storeId', { storeId })
      .andWhere('t.type = :type', { type: StockTransactionType.EXPORT })
      .andWhere('t.transaction_date >= :start AND t.transaction_date < :end', {
        start: startDate,
        end: endDate,
      })
      .groupBy("TO_CHAR(t.transaction_date, 'YYYY-MM-DD')")
      .orderBy('"date"', 'ASC')
      .getRawMany();

    // 2. Get payroll costs from MonthlyPayroll (estimated payment for each month)
    const payrollData = await this.payrollRepository
      .createQueryBuilder('p')
      .select("TO_CHAR(p.month, 'YYYY-MM')", 'month')
      .addSelect('SUM(p.estimated_payment)', 'totalCost')
      .where('p.store_id = :storeId', { storeId })
      .andWhere(`TO_CHAR(p.month, 'YYYY-MM') IN (:...months)`, {
        months: monthsInRange.length > 0 ? monthsInRange : [''],
      })
      .groupBy("TO_CHAR(p.month, 'YYYY-MM')")
      .getRawMany();

    // 3. Get total revenue for comparison
    const revenueData = await this.orderRepository
      .createQueryBuilder('o')
      .select(
        'SUM(CASE WHEN o.status = :completed THEN o."totalAmount" ELSE 0 END)',
        'revenue',
      )
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.status = :completed', { completed: OrderStatus.COMPLETED })
      .andWhere('o.created_at >= :start AND o.created_at < :end', {
        start: startDate,
        end: endDate,
      })
      .setParameter('completed', OrderStatus.COMPLETED)
      .getRawOne();

    // Calculate totals
    const totalMaterialCost = (materialCosts || []).reduce(
      (sum, m) => sum + parseFloat(m.totalCost || 0),
      0,
    );
    const totalPayrollCost = (payrollData || []).reduce(
      (sum, p) => sum + parseFloat(p.totalCost || 0),
      0,
    );
    const totalExpenses = totalMaterialCost + totalPayrollCost;

    // The same number of days just before the range, measured the same way
    // (material exported + payroll of the months it touches). Clients read
    // `comparison.expenseChange`, which was never returned (always 0%).
    const previousStart = new Date(
      startDate.getTime() - (endDate.getTime() - startDate.getTime()),
    );
    const [previousMaterial, previousPayroll] = await Promise.all([
      this.stockTransactionRepository
        .createQueryBuilder('t')
        .select('SUM(t.total_amount)', 'totalCost')
        .where('t.store_id = :storeId', { storeId })
        .andWhere('t.type = :type', { type: StockTransactionType.EXPORT })
        .andWhere(
          't.transaction_date >= :start AND t.transaction_date < :end',
          { start: previousStart, end: startDate },
        )
        .getRawOne(),
      this.payrollRepository
        .createQueryBuilder('p')
        .select('SUM(p.estimated_payment)', 'totalCost')
        .where('p.store_id = :storeId', { storeId })
        .andWhere(`TO_CHAR(p.month, 'YYYY-MM') IN (:...months)`, {
          months: monthsBetween(
            vnDateString(previousStart),
            vnDateString(new Date(startDate.getTime() - 1)),
          ),
        })
        .getRawOne(),
    ]);
    const previousMaterialCost = parseFloat(previousMaterial?.totalCost || '0');
    const previousPayrollCost = parseFloat(previousPayroll?.totalCost || '0');
    const previousExpenses = previousMaterialCost + previousPayrollCost;
    const change = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100 * 10) / 10;
    };
    const totalRevenue = parseFloat(revenueData?.revenue || '0');

    // Format daily expenses (material only - payroll is monthly)
    const dailyExpenses = (materialCosts || []).map((m) => ({
      date: m.date,
      materialCost: parseFloat(m.totalCost || 0),
      payrollCost: 0, // Payroll is monthly, not daily
    }));

    return {
      summary: {
        totalExpenses,
        materialCost: totalMaterialCost,
        payrollCost: totalPayrollCost,
        revenue: totalRevenue,
        expenseRate:
          totalRevenue > 0
            ? Math.round((totalExpenses / totalRevenue) * 1000) / 10
            : 0,
      },
      daily: dailyExpenses,
      monthly: (payrollData || []).map((p) => ({
        month: p.month,
        payrollCost: parseFloat(p.totalCost || 0),
      })),
      period: {
        start: firstDay,
        end: lastDay,
      },
      comparison: {
        previousPeriod: {
          start: vnDateString(previousStart),
          end: vnDateString(new Date(startDate.getTime() - 1)),
        },
        previousExpenses,
        previousMaterialCost,
        previousPayrollCost,
        expenseChange: change(totalExpenses, previousExpenses),
        materialChange: change(totalMaterialCost, previousMaterialCost),
        // The personnel card showed "Đã tính" / "Chưa có" instead of a change.
        payrollChange: change(totalPayrollCost, previousPayrollCost),
      },
    };
  }

  private async getCancelReasons(
    storeId: string,
    startDate: Date,
    endDate: Date,
  ) {
    try {
      const reasons = await this.orderRepository
        .createQueryBuilder('o')
        .select("COALESCE(o.cancel_reason, 'Khác')", 'reason')
        .addSelect('COUNT(o.id)', 'count')
        .where('o.store_id = :storeId', { storeId })
        .andWhere('o.status = :cancelled', { cancelled: OrderStatus.CANCELLED })
        .andWhere('o.created_at BETWEEN :start AND :end', {
          start: startDate,
          end: endDate,
        })
        .setParameter('cancelled', OrderStatus.CANCELLED)
        .groupBy("COALESCE(o.cancel_reason, 'Khác')")
        .orderBy('"count"', 'DESC')
        .limit(5)
        .getRawMany();

      const total = reasons.reduce(
        (sum: number, r: any) => sum + parseInt(r.count || '0'),
        0,
      );

      return reasons.map((r: any) => ({
        name: r.reason,
        count: parseInt(r.count || '0'),
        percentage:
          total > 0 ? Math.round((parseInt(r.count || '0') / total) * 100) : 0,
      }));
    } catch {
      return [
        { name: 'Khách huỷ', count: 0, percentage: 0 },
        { name: 'Hết nguyên liệu', count: 0, percentage: 0 },
        { name: 'Lỗi kĩ thuật', count: 0, percentage: 0 },
      ];
    }
  }

  // --- Shift Efficiency Report ---
  async getShiftEfficiencyReport(
    storeId: string,
    startDate: Date,
    endDate: Date,
  ) {
    const adjustedEndDate = new Date(endDate);
    adjustedEndDate.setHours(23, 59, 59, 999);

    const shiftData = await this.orderRepository
      .createQueryBuilder('o')
      .select(
        `CASE
        WHEN EXTRACT(HOUR FROM o.created_at) >= 6 AND EXTRACT(HOUR FROM o.created_at) < 12 THEN 'Ca sáng'
        WHEN EXTRACT(HOUR FROM o.created_at) >= 12 AND EXTRACT(HOUR FROM o.created_at) < 18 THEN 'Ca chiều'
        ELSE 'Ca tối'
      END`,
        'shift',
      )
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

    const bestShift = formatted.reduce(
      (prev, current) => (prev.revenue > current.revenue ? prev : current),
      { shiftName: 'Chưa có', revenue: 0, ordersCount: 0 },
    );

    return {
      bestShift: bestShift.shiftName,
      details: formatted,
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
        .select('item."itemSnapshot"->>\'name\'', 'name')
        .addSelect('SUM(item.quantity)', 'totalQuantity')
        .addSelect('SUM(item."totalPrice")', 'lostRevenue')
        .where('o.store_id = :storeId', { storeId })
        .andWhere('o.status = :status', { status: OrderStatus.CANCELLED })
        .andWhere('o.created_at BETWEEN :startDate AND :endDate', {
          startDate,
          endDate: adjustedEndDate,
        })
        .groupBy('item."itemSnapshot"->>\'name\'')
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
    // Only assets issued in the current stint; a rehire returns the old ones.
    const stintProfile = await this.profileRepository.findOne({
      where: { id: profileId },
      select: ['id', 'joinedAt'],
    });
    const floor = stintFloor(stintProfile?.joinedAt);
    const assignments = await this.assetAssignmentRepository.find({
      where: {
        employeeProfileId: profileId,
        ...(floor ? { assignedDate: MoreThanOrEqual(floor) } : {}),
      },
      relations: [
        'asset',
        'asset.assetUnit',
        'asset.assetCategory',
        'asset.assetStatus',
        'assignedBy',
        'assignedBy.account',
      ],
      order: { assignedDate: 'DESC' },
    });

    return assignments.map((assignment) => ({
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

  async assignAssetToEmployee(
    profileId: string,
    assetId: string,
    quantity: number = 1,
    note?: string,
    assignedById?: string,
    dueDate?: Date,
    actorAccountId?: string,
  ) {
    const asset = await this.assetRepository.findOne({
      where: { id: assetId },
    });
    if (!asset) throw new NotFoundException('Không tìm thấy tài sản');

    if (asset.currentStock < quantity) {
      throw new BadRequestException(
        `Không đủ tồn kho. Hiện có: ${asset.currentStock}, yêu cầu: ${quantity}`,
      );
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
      if (note)
        assignment.note =
          (assignment.note ? assignment.note + ' | ' : '') + note;
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

    await this.logActivity(null, {
      actorAccountId: actorAccountId ?? null,
      subjectEmployeeProfileId: profileId,
      action: ACTIVITY_ACTIONS.ASSET_ASSIGNED,
      resourceType: 'asset_assignment',
      resourceId: assignment.id,
      params: { assetName: asset.name, quantity },
    });

    return this.getEmployeeAssets(profileId);
  }

  async exchangeAsset(
    assignmentId: string,
    newAssetId: string,
    quantity: number = 1,
    note?: string,
    changedById?: string,
    dueDate?: Date,
    actorAccountId?: string,
  ) {
    // 1. Get old assignment
    const oldAssignment = await this.assetAssignmentRepository.findOne({
      where: { id: assignmentId },
      relations: ['asset'],
    });

    if (!oldAssignment)
      throw new NotFoundException('Không tìm thấy bản ghi cấp phát cũ');
    if (oldAssignment.status !== AssetAssignmentStatus.ASSIGNED) {
      throw new BadRequestException(
        'Tài sản cũ phải đang trong trạng thái sử dụng',
      );
    }

    // 2. Get new asset and check stock
    const newAsset = await this.assetRepository.findOne({
      where: { id: newAssetId },
    });
    if (!newAsset) throw new NotFoundException('Không tìm thấy tài sản mới');

    if (newAsset.currentStock < quantity) {
      throw new BadRequestException(
        `Tài sản mới không đủ tồn kho (Hiện có: ${newAsset.currentStock})`,
      );
    }

    // Use transaction for safer execution
    return await this.profileRepository.manager.transaction(async (manager) => {
      // 3. Return old asset
      oldAssignment.status = AssetAssignmentStatus.RETURNED;
      oldAssignment.returnedDate = new Date();
      oldAssignment.returnNote = `Đổi sang tài sản khác: ${newAsset.name}. ${note || ''}`;
      await manager.save(oldAssignment);

      // Increase stock A
      await manager.increment(
        Asset,
        { id: oldAssignment.assetId },
        'currentStock',
        oldAssignment.quantity,
      );

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
        if (note)
          assignment.note =
            (assignment.note ? assignment.note + ' | ' : '') + note;
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
      await manager.decrement(
        Asset,
        { id: newAssetId },
        'currentStock',
        quantity,
      );

      // An exchange is a return of A and an assignment of B.
      await this.logActivity(manager, {
        actorAccountId: actorAccountId ?? null,
        subjectEmployeeProfileId: oldAssignment.employeeProfileId,
        action: ACTIVITY_ACTIONS.ASSET_RETURNED,
        resourceType: 'asset_assignment',
        resourceId: oldAssignment.id,
        params: {
          assetName: oldAssignment.asset?.name,
          quantity: oldAssignment.quantity,
          assetStatus: AssetAssignmentStatus.RETURNED,
        },
        idempotencyKey: `${ACTIVITY_ACTIONS.ASSET_RETURNED}:${oldAssignment.id}`,
      });
      await this.logActivity(manager, {
        actorAccountId: actorAccountId ?? null,
        subjectEmployeeProfileId: oldAssignment.employeeProfileId,
        action: ACTIVITY_ACTIONS.ASSET_ASSIGNED,
        resourceType: 'asset_assignment',
        resourceId: assignment.id,
        params: { assetName: newAsset.name, quantity },
      });

      return this.getEmployeeAssets(oldAssignment.employeeProfileId);
    });
  }

  async returnAsset(
    assignmentId: string,
    status: AssetAssignmentStatus,
    returnNote?: string,
    actorAccountId?: string,
  ) {
    // One transaction with the same lock order as the rehire restock
    // (assignment row, then asset row), and a conditional status update, so
    // a concurrent return or rehire can never return the same row twice or
    // double-count the stock.
    await this.dataSource.transaction(async (manager) => {
      const assignment = await manager
        .getRepository(EmployeeAssetAssignment)
        .createQueryBuilder('ea')
        .where('ea.id = :assignmentId', { assignmentId })
        .setLock('pessimistic_write')
        .getOne();

      if (!assignment)
        throw new NotFoundException('Không tìm thấy bản ghi cấp phát');
      const alreadyClosed = () =>
        new BadRequestException(
          'Tài sản này đã được thu hồi hoặc không còn hiệu lực',
        );
      if (assignment.status !== AssetAssignmentStatus.ASSIGNED) {
        throw alreadyClosed();
      }

      const updated = await manager.update(
        EmployeeAssetAssignment,
        { id: assignment.id, status: AssetAssignmentStatus.ASSIGNED },
        {
          status,
          returnedDate: new Date(),
          returnNote: returnNote || null,
        },
      );
      if (!updated.affected) throw alreadyClosed();

      if (status === AssetAssignmentStatus.RETURNED) {
        const asset = await manager
          .getRepository(Asset)
          .createQueryBuilder('asset')
          .where('asset.id = :assetId', { assetId: assignment.assetId })
          .setLock('pessimistic_write')
          .getOne();
        if (asset) {
          asset.currentStock =
            Number(asset.currentStock) + Number(assignment.quantity || 0);
          await manager.save(Asset, asset);
        }
      }

      if (this.activityLogService) {
        const assetName = await manager
          .findOne(Asset, { where: { id: assignment.assetId }, select: ['id', 'name'] })
          .then((row) => row?.name)
          .catch(() => undefined);
        await this.logActivity(manager, {
          actorAccountId: actorAccountId ?? null,
          subjectEmployeeProfileId: assignment.employeeProfileId,
          action: ACTIVITY_ACTIONS.ASSET_RETURNED,
          resourceType: 'asset_assignment',
          resourceId: assignment.id,
          params: {
            assetName,
            quantity: Number(assignment.quantity || 0),
            assetStatus: status,
          },
          idempotencyKey: `${ACTIVITY_ACTIONS.ASSET_RETURNED}:${assignment.id}`,
        });
      }
    });

    return { message: 'Đã thu hồi tài sản thành công' };
  }

  async reassignAsset(
    assignmentId: string,
    quantity?: number,
    note?: string,
    assignedById?: string,
    dueDate?: Date,
    actorAccountId?: string,
  ) {
    const oldAssignment = await this.assetAssignmentRepository.findOne({
      where: { id: assignmentId },
    });
    if (!oldAssignment)
      throw new NotFoundException('Không tìm thấy bản ghi cấp phát cũ');

    // Sử dụng lại logic cấp phát để tự động gộp số lượng và trừ kho
    return this.assignAssetToEmployee(
      oldAssignment.employeeProfileId,
      oldAssignment.assetId,
      quantity || oldAssignment.quantity,
      note || `Cấp lại từ bản ghi cũ. ${oldAssignment.note || ''}`,
      assignedById,
      dueDate || (oldAssignment.dueDate ?? undefined),
      actorAccountId,
    );
  }

  // Asset Export Management
  async createAssetExportType(storeId: string, data: any) {
    const type = this.assetExportTypeRepository.create({
      ...this.creatableRow(this.assetExportTypeRepository, data),
      storeId,
    });
    return this.assetExportTypeRepository.save(type);
  }

  async getAssetExportTypes(storeId: string) {
    return this.assetExportTypeRepository.find({
      where: { storeId, isActive: true },
    });
  }

  /**
   * Bulk stock-out addresses no store in its path, so each item names its
   * own store: every item's store must be one the caller owns or is employed
   * at (the released owner app sends items of several stores in one request).
   * Quantities must be positive. Runs before any write.
   */
  private async assertBulkExportItems(
    items: unknown,
    accountId: string | undefined,
  ): Promise<any[]> {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('Danh sách xuất kho không được để trống');
    }
    if (items.length > BULK_EXPORT_MAX_ITEMS) {
      throw new BadRequestException(
        `Mỗi lần xuất kho tối đa ${BULK_EXPORT_MAX_ITEMS} món`,
      );
    }
    for (const item of items) {
      if (typeof item?.storeId !== 'string' || !isUUID(item.storeId)) {
        throw new BadRequestException('Mỗi món xuất kho phải có cửa hàng hợp lệ');
      }
      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException('Số lượng xuất phải lớn hơn 0');
      }
    }
    const accessible = new Set(
      await this.getAccessibleStoreIds(accountId as string),
    );
    for (const item of items) {
      if (!accessible.has(item.storeId)) {
        throw new ForbiddenException('Bạn không có quyền truy cập cửa hàng này');
      }
    }
    return items;
  }

  /**
   * The stock row (product or asset) an export item takes from: its id must
   * be a uuid naming a row of the item's own store (400 otherwise). Rows are
   * shared by id so repeated items draw down the same stock.
   */
  private async loadStockRowInStore<T extends { id: string; storeId: string }>(
    repository: Repository<T>,
    id: unknown,
    storeId: string,
    label: string,
    loaded: Map<string, T>,
  ): Promise<T> {
    if (typeof id !== 'string' || !isUUID(id)) {
      throw new BadRequestException(`${label} không hợp lệ`);
    }
    const cached = loaded.get(id);
    if (cached) {
      if (cached.storeId !== storeId) {
        throw new BadRequestException(`${label} không thuộc cửa hàng này`);
      }
      return cached;
    }
    const row = await repository.findOne({
      where: { id, storeId } as never,
    });
    if (!row || row.storeId !== storeId) {
      throw new BadRequestException(`${label} không thuộc cửa hàng này`);
    }
    loaded.set(id, row);
    return row;
  }

  /** 400 when the items take more of a row than it has in stock. */
  private assertStockCovers(
    plan: Array<{ row: { id: string; name?: string; currentStock?: number }; quantity: number }>,
    label: string,
  ): void {
    const requested = new Map<string, number>();
    for (const { row, quantity } of plan) {
      const total = (requested.get(row.id) ?? 0) + quantity;
      requested.set(row.id, total);
      const stock = Number(row.currentStock) || 0;
      if (total > stock) {
        throw new BadRequestException(
          `Số lượng xuất (${total}) vượt quá tồn kho hiện tại (${stock}) của ${label} "${row.name}"`,
        );
      }
    }
  }

  /**
   * 400 unless every given id names a row of `storeId` (or of one of the
   * given stores). Blank ids are
   * skipped (optional fields); a malformed id is "not in this store".
   */
  async assertRowsInStore(
    storeId: string | string[],
    refs: Array<{ repository: Repository<any>; id: unknown; label: string }>,
  ): Promise<void> {
    const storeScope = Array.isArray(storeId) ? In(storeId) : storeId;
    for (const { repository, id, label } of refs) {
      if (id === undefined || id === null || id === '') continue;
      let found = false;
      if (typeof id === 'string' && isUUID(id)) {
        found = await repository.exists({ where: { id, storeId: storeScope } });
      }
      if (!found) {
        throw new BadRequestException(`${label} không thuộc cửa hàng này`);
      }
    }
  }

  async exportAssetsBulk(
    data: AssetExportDto,
    files: Express.Multer.File[] = [],
    accountId?: string,
  ) {
    const items = await this.assertBulkExportItems(data?.items, accountId);

    // Validate every item — store, stock row, export type, quantity — before
    // any write. An item takes from its asset, else (legacy) its product.
    const assets = new Map<string, Asset>();
    const products = new Map<string, Product>();
    const plan: Array<
      | { kind: 'asset'; row: Asset; quantity: number }
      | { kind: 'product'; row: Product; quantity: number }
    > = [];
    for (const item of items) {
      const quantity = Number(item.quantity);
      if (item.assetId !== undefined && item.assetId !== null && item.assetId !== '') {
        plan.push({
          kind: 'asset',
          row: await this.loadStockRowInStore(
            this.assetRepository, item.assetId, item.storeId, 'Tài sản', assets,
          ),
          quantity,
        });
      } else {
        plan.push({
          kind: 'product',
          row: await this.loadStockRowInStore(
            this.productRepository, item.productId, item.storeId, 'Hàng hóa', products,
          ),
          quantity,
        });
      }
      await this.assertRowsInStore(item.storeId, [
        {
          repository: this.assetExportTypeRepository,
          id: item.assetExportTypeId,
          label: 'Loại xuất kho',
        },
      ]);
    }
    this.assertStockCovers(
      plan.filter((step) => step.kind === 'asset'),
      'tài sản',
    );
    this.assertStockCovers(
      plan.filter((step) => step.kind === 'product'),
      'hàng hóa',
    );

    const transactionCodes: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const step = plan[i];

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
      const itemFile = files.find((f) => f.fieldname === `file_${i}`);
      if (itemFile) {
        transaction.fileUrl = `/uploads/${itemFile.filename}`;
      }

      const savedTransaction =
        await this.stockTransactionRepository.save(transaction);
      transactionCodes.push(savedTransaction.code);

      // 2. Create Detail and Update Stock
      if (step.kind === 'asset') {
        const asset = step.row;
        const detail = this.stockTransactionDetailRepository.create({
          transactionId: savedTransaction.id,
          assetId: asset.id,
          quantity: step.quantity,
          unitPrice: Number(asset.value) || 0,
          totalPrice: (Number(asset.value) || 0) * step.quantity,
          note: item.note,
          fileUrl: transaction.fileUrl,
        });
        await this.stockTransactionDetailRepository.save(detail);

        asset.currentStock = (Number(asset.currentStock) || 0) - step.quantity;
        await this.assetRepository.save(asset);
      } else {
        const product = step.row;
        const detail = this.stockTransactionDetailRepository.create({
          transactionId: savedTransaction.id,
          productId: product.id,
          quantity: step.quantity,
          unitPrice: Number(product.costPrice) || 0,
          totalPrice: (Number(product.costPrice) || 0) * step.quantity,
          note: item.note,
          fileUrl: transaction.fileUrl,
        });
        await this.stockTransactionDetailRepository.save(detail);

        product.currentStock =
          (Number(product.currentStock) || 0) - step.quantity;
        await this.productRepository.save(product);
      }
    }

    return {
      message: `Đã xuất kho ${items.length} món hàng thành công`,
      transactionCodes,
    };
  }

  // Product Export Management
  async createProductExportType(
    storeId: string,
    data: Partial<ProductExportType>,
  ) {
    const type = this.productExportTypeRepository.create({
      ...this.creatableRow(this.productExportTypeRepository, data),
      storeId,
    });
    return this.productExportTypeRepository.save(type);
  }

  async getProductExportTypes(storeId: string) {
    return this.productExportTypeRepository.find({
      where: { storeId, isActive: true },
    });
  }

  async exportProductsBulk(
    data: ProductExportDto,
    files: Express.Multer.File[] = [],
    accountId?: string,
  ) {
    const items = await this.assertBulkExportItems(data?.items, accountId);

    // Validate every item — store, product, export type, quantity — before
    // any write.
    const products = new Map<string, Product>();
    const plan: Array<{ row: Product; quantity: number }> = [];
    for (const item of items) {
      plan.push({
        row: await this.loadStockRowInStore(
          this.productRepository, item.productId, item.storeId, 'Hàng hóa', products,
        ),
        quantity: Number(item.quantity),
      });
      await this.assertRowsInStore(item.storeId, [
        {
          repository: this.productExportTypeRepository,
          id: item.productExportTypeId,
          label: 'Loại xuất kho',
        },
      ]);
    }
    this.assertStockCovers(plan, 'hàng hóa');

    const transactionCodes: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const { row: product, quantity } = plan[i];

      const transaction = this.stockTransactionRepository.create({
        storeId: item.storeId,
        type: StockTransactionType.EXPORT,
        code: `PX-PROD-${Date.now()}-${i}`,
        productExportTypeId: item.productExportTypeId,
        transactionDate: new Date(item.exportDate),
        note: item.note,
        status: StockTransactionStatus.COMPLETED,
      });

      const itemFile = files.find((f) => f.fieldname === `file_${i}`);
      if (itemFile) {
        transaction.fileUrl = `/uploads/${itemFile.filename}`;
      }

      const savedTransaction =
        await this.stockTransactionRepository.save(transaction);
      transactionCodes.push(savedTransaction.code);

      const detail = this.stockTransactionDetailRepository.create({
        transactionId: savedTransaction.id,
        productId: product.id,
        quantity,
        unitPrice: Number(product.costPrice) || 0,
        totalPrice: (Number(product.costPrice) || 0) * quantity,
        note: item.note,
        fileUrl: transaction.fileUrl,
      });
      await this.stockTransactionDetailRepository.save(detail);

      product.currentStock = (Number(product.currentStock) || 0) - quantity;
      await this.productRepository.save(product);
    }

    return {
      message: `Đã xuất kho ${items.length} mặt hàng thành công`,
      transactionCodes,
    };
  }

  async getProductReport(
    storeId: string,
    filters: { date?: string; productStatusId?: string },
  ) {
    if (filters.date === 'undefined' || filters.date === 'null')
      filters.date = undefined;
    if (
      filters.productStatusId === 'all' ||
      filters.productStatusId === 'undefined' ||
      filters.productStatusId === 'null'
    )
      filters.productStatusId = undefined;

    const summaryAllTime = await this.stockTransactionDetailRepository
      .createQueryBuilder('detail')
      .leftJoin('detail.transaction', 'transaction')
      .select('COUNT(detail.id)', 'totalItems')
      .addSelect('SUM(detail.total_price)', 'totalValue')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', {
        type: StockTransactionType.IMPORT,
      })
      .andWhere('detail.product_id IS NOT NULL')
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .getRawOne();

    const targetDate = filters.date || vnDateString();
    const summaryToday = await this.stockTransactionDetailRepository
      .createQueryBuilder('detail')
      .leftJoin('detail.transaction', 'transaction')
      .select('COUNT(detail.id)', 'totalItems')
      .addSelect('SUM(detail.total_price)', 'totalValue')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', {
        type: StockTransactionType.IMPORT,
      })
      .andWhere('detail.product_id IS NOT NULL')
      .andWhere('DATE(transaction.transaction_date) = :targetDate', {
        targetDate,
      })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .getRawOne();

    const allStatuses = await this.productStatusRepository.find({
      where: { storeId, isActive: true },
    });

    const statusStatsQb = this.stockTransactionDetailRepository
      .createQueryBuilder('detail')
      .select('product.product_status_id', 'statusId')
      .addSelect('COUNT(detail.id)', 'itemCount')
      .leftJoin('detail.product', 'product')
      .leftJoin('detail.transaction', 'transaction')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', {
        type: StockTransactionType.IMPORT,
      })
      .andWhere('detail.product_id IS NOT NULL')
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .groupBy('product.product_status_id');

    if (filters.date) {
      statusStatsQb.andWhere('DATE(transaction.transaction_date) = :date', {
        date: filters.date,
      });
    }

    const statusStatsRaw = await statusStatsQb.getRawMany();

    const statusDetails = allStatuses.map((status) => {
      const found = statusStatsRaw.find((r) => r.statusId === status.id);
      return {
        id: status.id,
        name: status.name,
        colorCode: status.colorCode,
        count: found ? Number(found.itemCount) : 0,
      };
    });

    const totalHistoryItems = statusDetails.reduce(
      (sum, item) => sum + item.count,
      0,
    );

    const importHistoryQb = this.stockTransactionDetailRepository
      .createQueryBuilder('detail')
      .leftJoinAndSelect('detail.transaction', 'transaction')
      .leftJoinAndSelect('detail.product', 'product')
      .leftJoinAndSelect('product.productUnit', 'unit')
      .leftJoinAndSelect('product.productCategory', 'category')
      .leftJoinAndSelect('product.productStatus', 'status')
      .leftJoinAndSelect('product.store', 'store')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', {
        type: StockTransactionType.IMPORT,
      })
      .andWhere('detail.product_id IS NOT NULL')
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .orderBy('transaction.transaction_date', 'DESC');

    if (filters.date) {
      importHistoryQb.andWhere('DATE(transaction.transaction_date) = :date', {
        date: filters.date,
      });
    }

    if (filters.productStatusId) {
      importHistoryQb.andWhere('product.product_status_id = :statusId', {
        statusId: filters.productStatusId,
      });
    }

    const importHistory = await importHistoryQb.getMany();

    const formattedImports = importHistory.map((detail) => ({
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
        colorCode: detail.product?.productStatus?.colorCode,
      },
      storeName: detail.product?.store?.name,
      importDate: detail.transaction?.transactionDate,
      transactionCode: detail.transaction?.code,
      transactionId: detail.transaction?.id,
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
        },
      },
      statusStatistics: {
        all: totalHistoryItems,
        details: statusDetails,
      },
      importHistory: formattedImports,
    };
  }

  async getProductExportReport(
    storeId: string,
    filters: { date?: string; productExportTypeId?: string },
  ) {
    if (filters.date === 'undefined' || filters.date === 'null')
      filters.date = undefined;
    if (
      filters.productExportTypeId === 'all' ||
      filters.productExportTypeId === 'undefined' ||
      filters.productExportTypeId === 'null'
    )
      filters.productExportTypeId = undefined;

    const summaryAllTime = await this.stockTransactionDetailRepository
      .createQueryBuilder('detail')
      .leftJoin('detail.transaction', 'transaction')
      .select('COUNT(detail.id)', 'totalItems')
      .addSelect('SUM(detail.total_price)', 'totalValue')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', {
        type: StockTransactionType.EXPORT,
      })
      .andWhere('detail.product_id IS NOT NULL')
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .getRawOne();

    const targetDate = filters.date || vnDateString();
    const summaryToday = await this.stockTransactionDetailRepository
      .createQueryBuilder('detail')
      .leftJoin('detail.transaction', 'transaction')
      .select('COUNT(detail.id)', 'totalItems')
      .addSelect('SUM(detail.total_price)', 'totalValue')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', {
        type: StockTransactionType.EXPORT,
      })
      .andWhere('detail.product_id IS NOT NULL')
      .andWhere('DATE(transaction.transaction_date) = :targetDate', {
        targetDate,
      })
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .getRawOne();

    const allExportTypes = await this.productExportTypeRepository.find({
      where: { storeId, isActive: true },
    });

    const typeStatsQb = this.stockTransactionDetailRepository
      .createQueryBuilder('detail')
      .select('transaction.product_export_type_id', 'typeId')
      .addSelect('COUNT(detail.id)', 'itemCount')
      .leftJoin('detail.transaction', 'transaction')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', {
        type: StockTransactionType.EXPORT,
      })
      .andWhere('detail.product_id IS NOT NULL')
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .groupBy('transaction.product_export_type_id');

    if (filters.date) {
      typeStatsQb.andWhere('DATE(transaction.transaction_date) = :date', {
        date: filters.date,
      });
    }

    const typeStatsRaw = await typeStatsQb.getRawMany();

    const typeDetails = allExportTypes.map((type) => {
      const found = typeStatsRaw.find((r) => r.typeId === type.id);
      return {
        id: type.id,
        name: type.name,
        colorCode: type.colorCode,
        count: found ? Number(found.itemCount) : 0,
      };
    });

    const totalHistoryItems = typeDetails.reduce(
      (sum, item) => sum + item.count,
      0,
    );

    const exportHistoryQb = this.stockTransactionDetailRepository
      .createQueryBuilder('detail')
      .leftJoinAndSelect('detail.transaction', 'transaction')
      .leftJoinAndSelect('transaction.productExportType', 'exportType')
      .leftJoinAndSelect('detail.product', 'product')
      .leftJoinAndSelect('product.productUnit', 'unit')
      .leftJoinAndSelect('product.productCategory', 'category')
      .leftJoinAndSelect('product.store', 'store')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', {
        type: StockTransactionType.EXPORT,
      })
      .andWhere('detail.product_id IS NOT NULL')
      .andWhere('transaction.deleted_at IS NULL')
      .andWhere('detail.deleted_at IS NULL')
      .orderBy('transaction.transaction_date', 'DESC');

    if (filters.date) {
      exportHistoryQb.andWhere('DATE(transaction.transaction_date) = :date', {
        date: filters.date,
      });
    }

    if (filters.productExportTypeId) {
      exportHistoryQb.andWhere('transaction.product_export_type_id = :typeId', {
        typeId: filters.productExportTypeId,
      });
    }

    const exportHistory = await exportHistoryQb.getMany();

    const formattedExports = exportHistory.map((detail) => ({
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
        colorCode: detail.transaction?.productExportType?.colorCode,
      },
      storeName: detail.product?.store?.name,
      exportDate: detail.transaction?.transactionDate,
      transactionCode: detail.transaction?.code,
      transactionId: detail.transaction?.id,
      note: detail.transaction?.note || detail.note,
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
        },
      },
      statusStatistics: {
        all: totalHistoryItems,
        details: typeDetails,
      },
      exportHistory: formattedExports,
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
          detail.asset.currentStock = Math.max(
            0,
            (detail.asset.currentStock || 0) - detail.quantity,
          );
        } else if (transaction.type === StockTransactionType.EXPORT) {
          detail.asset.currentStock =
            (detail.asset.currentStock || 0) + detail.quantity;
        }
        await this.assetRepository.save(detail.asset);
      } else if (detail.productId && detail.product) {
        if (transaction.type === StockTransactionType.IMPORT) {
          detail.product.currentStock = Math.max(
            0,
            (detail.product.currentStock || 0) - detail.quantity,
          );
        } else if (transaction.type === StockTransactionType.EXPORT) {
          detail.product.currentStock =
            (detail.product.currentStock || 0) + detail.quantity;
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
      const parts = monthStr.includes('/')
        ? monthStr.split('/')
        : monthStr.split('-');
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

      const qb = this.stockTransactionDetailRepository
        .createQueryBuilder('detail')
        .leftJoin('detail.transaction', 'transaction')
        .select([
          'SUM(CASE WHEN transaction.type = :import THEN detail.quantity ELSE -detail.quantity END) as netQuantity',
          'SUM(CASE WHEN transaction.type = :import THEN detail.total_price ELSE -detail.total_price END) as netValue',
          'COUNT(DISTINCT CASE WHEN detail.asset_id IS NOT NULL THEN detail.asset_id END) as assetCount', // Số lượng đầu tài sản unique (xấp xỉ)
          'COUNT(DISTINCT CASE WHEN detail.product_id IS NOT NULL THEN detail.product_id END) as productCount',
        ])
        .setParameters({
          import: StockTransactionType.IMPORT,
          // export: StockTransactionType.EXPORT,
          storeId,
          endDate,
        })
        .where('transaction.store_id = :storeId')
        .andWhere('transaction.transaction_date <= :endDate')
        .andWhere('transaction.deleted_at IS NULL')
        .andWhere('detail.deleted_at IS NULL');

      const assetStats = await qb
        .clone()
        .andWhere('detail.asset_id IS NOT NULL')
        .getRawOne();

      const productStats = await qb
        .clone()
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
        },
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
        growthQuantity: calculateGrowth(
          currentStats.asset.quantity,
          previousStats.asset.quantity,
        ),
        growthValue: calculateGrowth(
          currentStats.asset.value,
          previousStats.asset.value,
        ),
        previousTotalQuantity: previousStats.asset.quantity,
        previousTotalValue: previousStats.asset.value,
      },
      products: {
        totalQuantity: currentStats.product.quantity,
        totalValue: currentStats.product.value,
        growthQuantity: calculateGrowth(
          currentStats.product.quantity,
          previousStats.product.quantity,
        ),
        growthValue: calculateGrowth(
          currentStats.product.value,
          previousStats.product.value,
        ),
        previousTotalQuantity: previousStats.product.quantity,
        previousTotalValue: previousStats.product.value,
      },
    };

    // Phần 2: Status Statistics (Trạng thái và Giá trị)
    // Lấy trạng thái hiện tại thực tế của các items trong kho
    // Lưu ý: Đây là trạng thái hiện tại (real-time snapshot), nếu muốn lịch sử chính xác từng tháng phải lưu snapshot.
    // Ở đây ta lấy snapshot hiện tại đẻ đơn giản hoá, nhưng lọc theo items.

    // Status Assets
    const assetStatuses = await this.assetRepository
      .createQueryBuilder('asset')
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
    const productStatuses = await this.productRepository
      .createQueryBuilder('product')
      .leftJoin('product.productStatus', 'status')
      .select('status.id', 'id')
      .addSelect('status.name', 'name')
      .addSelect('status.color_code', 'colorCode')
      .addSelect('COUNT(product.id)', 'count') // Số đầu mã hàng
      .addSelect('SUM(product.cost_price * product.current_stock)', 'value')
      .where('product.store_id = :storeId', { storeId })
      .groupBy('status.id')
      .getRawMany();

    const formatStatusStats = (raw: any[]) =>
      raw.map((r) => ({
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

    const damageHistoryQb = this.stockTransactionDetailRepository
      .createQueryBuilder('detail')
      .leftJoinAndSelect('detail.transaction', 'transaction')
      .leftJoinAndSelect('transaction.assetExportType', 'exportType')
      .leftJoinAndSelect('transaction.productExportType', 'pExportType')
      .where('transaction.store_id = :storeId', { storeId })
      .andWhere('transaction.type = :type', {
        type: StockTransactionType.EXPORT,
      })
      .andWhere('transaction.transaction_date BETWEEN :start AND :end', {
        start: damageStartDate,
        end: damageEndDate,
      })
      .andWhere('transaction.deleted_at IS NULL')
      // Lọc các loại xuất liên quan đến hư hỏng/mất mát
      .andWhere(
        `(LOWER(exportType.name) LIKE '%hỏng%' OR LOWER(exportType.name) LIKE '%hủy%' OR LOWER(exportType.name) LIKE '%mất%' OR
           LOWER(pExportType.name) LIKE '%hỏng%' OR LOWER(pExportType.name) LIKE '%hủy%' OR LOWER(pExportType.name) LIKE '%mất%')`,
      );

    const damageRecords = await damageHistoryQb.getMany();

    const damageHistory: any[] = [];
    for (const record of damageRecords) {
      let itemName = '';
      let itemCode = '';
      if (record.assetId) {
        const asset = await this.assetRepository.findOne({
          where: { id: record.assetId },
        });
        itemName = asset?.name || '';
        itemCode = asset?.code || '';
      } else if (record.productId) {
        const prod = await this.productRepository.findOne({
          where: { id: record.productId },
        });
        itemName = prod?.name || '';
        itemCode = prod?.sku || '';
      }

      damageHistory.push({
        id: record.id,
        transactionDate: record.transaction.transactionDate,
        itemName,
        itemCode,
        quantity: record.quantity,
        reason:
          record.transaction.assetExportType?.name ||
          record.transaction.productExportType?.name ||
          '',
        totalLossValue: Number(record.totalPrice) || 0,
      });
    }

    return {
      overview: {
        month: `${currentMonth}/${currentYear}`,
        assets: summary.assets,
        products: summary.products,
      },
      statusDistribution: {
        assets: formatStatusStats(assetStatuses),
        products: formatStatusStats(productStatuses),
      },
      damageReport: {
        totalDamageValue: damageHistory.reduce(
          (sum, item) => sum + Number(item.totalLossValue),
          0,
        ),
        history: damageHistory,
      },
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
    if (!config)
      throw new NotFoundException(
        'Không tìm thấy cấu hình phân quyền cho vai trò này',
      );
    return config;
  }

  async updateRolePermissionConfig(
    storeId: string,
    roleId: string,
    data: StorePermissionConfigDto,
  ) {
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

  async createRole(storeId: string, data: any) {
    // Lộ trình v2: vị trí thuộc bộ phận và có cấp bậc, chỉ tạo trên màn mới.
    if (await isCareerV2Enabled(this.dataSource.manager, storeId)) {
      throw appUpdateRequired();
    }
    // 1. Create Role
    const role = this.roleRepository.create({
      storeId,
      ...data,
    } as any);
    const savedRole = (await this.roleRepository.save(
      role,
    )) as unknown as StoreRole;

    // 2. Tự động tạo bảng Permission riêng cho Role này (mặc định lấy quyền Nhân viên làm gốc)
    const initialPermissions = this.getDefaultStaffPermissions();

    const newConfig = this.permissionConfigRepository.create({
      storeId,
      roleId: savedRole.id,
      name: `Permissions for ${savedRole.name}`,
      ...initialPermissions,
    } as any);
    const savedConfig = (await this.permissionConfigRepository.save(
      newConfig,
    )) as unknown as StorePermissionConfig;

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
        const savedConfig = (await this.permissionConfigRepository.save(
          config,
        )) as unknown as StorePermissionConfig;

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
      schedule: {
        viewPersonalOnly: false,
        requestOffAndChange: true,
        viewGeneralSchedule: true,
        manageSchedule: true,
        approveRequests: true,
      },
      timekeeping: {
        editTimeSheet: true,
        viewPersonalTimeSheet: true,
        sendDispute: true,
        viewOtherTimeSheet: true,
        approveTimeSheet: true,
      },
      hr: {
        viewPersonalWorkAndKpi: true,
        viewShiftStaffList: true,
        viewAllStaff: true,
        assignWorkInShift: true,
        assignShiftLeader: true,
        assignSupervisor: true,
        createRecruitment: true,
        approveCandidate: true,
      },
      asset: {
        viewAssetAndWarehouse: true,
        manageAssetAndWarehouse: true,
        proposeSupplies: true,
        manageSupplies: true,
      },
      salary: {
        viewPersonalSalaryAndBonus: true,
        proposeSalaryEdit: true,
        approveSubordinateSalary: true,
        manageStaffPayroll: true,
        assignPayrollAccess: true,
      },
      content: {
        createPost: true,
        commentInGroups: true,
        approveContent: true,
        tagAndWarnViolation: true,
        reportContent: true,
        manageMembers: true,
      },
      report: {
        viewPersonalShiftReport: true,
        submitImprovementProposal: true,
        viewStaffPerformanceReport: true,
        viewStaffSalaryReport: true,
        viewViolationAnalysis: true,
        viewSummaryStaffReport: true,
      },
      system: {
        editStaffPermission: true,
        evaluateStaffCapacity: true,
        editShiftLeaderPermission: true,
        editSupervisorPermission: true,
        editManagerPermission: true,
      },
      employeeNotification: {
        remindAttendance: true,
        remindAttendanceMinutes: 30,
        allowLate: true,
        allowLateMinutes: 5,
        notifyAbnormalAbsence: true,
        notifyAttendanceIssue: true,
        notifySystemError: true,
        notifyRequestApproved: true,
        notifyNewInfoFromSuperior: true,
        notifyAbnormalOrders: true,
        notifyLowKpi: true,
        notifyLowKpiDays: 3,
        notifySalary: true,
        notifyNonStandardContent: true,
      },
      shiftLeaderNotification: {
        remindShiftAssignment: true,
        notifyManagerShortage: true,
        reportShiftPerformance: true,
        notifyStaffViolationInShift: true,
        notifyOrderIssue: true,
        remindEndShiftReport: true,
      },
      managerNotification: {
        notifyKpiDropStore: true,
        remindPermissionReview: true,
        notifyContinuousViolation: true,
        notifyContinuousViolationCount: 3,
        notifyContinuousPerformanceDrop: true,
        notifyContinuousPerformanceDropCount: 3,
        notifySalaryLate: true,
        notifyEmptyShift: true,
        remindApproveRequest: true,
        remindApproveRequestDays: 1,
      },
      storeNotification: {
        notifyShiftShortageToday: true,
        notifyUnannouncedAbsence: true,
        notifyResignationSign: true,
        remindUnreadNotifications: true,
        remindNewSchedule: true,
        remindNewScheduleDays: 1,
        notifyContinuousPerformanceDropDays: 3,
        notifyContinuousKpiDropDays: 3,
        notifyIndividualLowKpiDays: 3,
        notifyQualitySupervisorDropDays: 3,
        remindAssetInventory: true,
        remindAssetInventoryDays: 3,
      },
    };
  }

  private getDefaultManagerPermissions() {
    return {
      schedule: {
        viewPersonalOnly: false,
        requestOffAndChange: true,
        viewGeneralSchedule: true,
        manageSchedule: true,
        approveRequests: true,
      },
      timekeeping: {
        editTimeSheet: false,
        viewPersonalTimeSheet: true,
        sendDispute: true,
        viewOtherTimeSheet: true,
        approveTimeSheet: true,
      },
      hr: {
        viewPersonalWorkAndKpi: true,
        viewShiftStaffList: true,
        viewAllStaff: true,
        assignWorkInShift: true,
        assignShiftLeader: false,
        assignSupervisor: false,
        createRecruitment: false,
        approveCandidate: false,
      },
      asset: {
        viewAssetAndWarehouse: true,
        manageAssetAndWarehouse: true,
        proposeSupplies: true,
        manageSupplies: false,
      },
      salary: {
        viewPersonalSalaryAndBonus: true,
        proposeSalaryEdit: true,
        approveSubordinateSalary: false,
        manageStaffPayroll: false,
        assignPayrollAccess: false,
      },
      content: {
        createPost: true,
        commentInGroups: true,
        approveContent: false,
        tagAndWarnViolation: true,
        reportContent: true,
        manageMembers: false,
      },
      report: {
        viewPersonalShiftReport: true,
        submitImprovementProposal: true,
        viewStaffPerformanceReport: true,
        viewStaffSalaryReport: false,
        viewViolationAnalysis: true,
        viewSummaryStaffReport: false,
      },
      system: {
        editStaffPermission: false,
        evaluateStaffCapacity: true,
        editShiftLeaderPermission: false,
        editSupervisorPermission: false,
        editManagerPermission: false,
      },
      employeeNotification: {
        remindAttendance: true,
        remindAttendanceMinutes: 30,
        allowLate: true,
        allowLateMinutes: 10,
        notifyAbnormalAbsence: true,
        notifyAttendanceIssue: true,
        notifySystemError: true,
        notifyRequestApproved: true,
        notifyNewInfoFromSuperior: true,
        notifyAbnormalOrders: true,
        notifyLowKpi: true,
        notifyLowKpiDays: 3,
        notifySalary: true,
        notifyNonStandardContent: true,
      },
      shiftLeaderNotification: {
        remindShiftAssignment: true,
        notifyManagerShortage: true,
        reportShiftPerformance: true,
        notifyStaffViolationInShift: true,
        notifyOrderIssue: true,
        remindEndShiftReport: true,
      },
      managerNotification: {
        notifyKpiDropStore: true,
        remindPermissionReview: true,
        notifyContinuousViolation: true,
        notifyContinuousViolationCount: 3,
        notifyContinuousPerformanceDrop: true,
        notifyContinuousPerformanceDropCount: 3,
        notifySalaryLate: true,
        notifyEmptyShift: true,
        remindApproveRequest: true,
        remindApproveRequestDays: 1,
      },
      storeNotification: {
        notifyShiftShortageToday: true,
        notifyUnannouncedAbsence: true,
        notifyResignationSign: true,
        remindUnreadNotifications: true,
        remindNewSchedule: true,
        remindNewScheduleDays: 1,
        notifyContinuousPerformanceDropDays: 3,
        notifyContinuousKpiDropDays: 3,
        notifyIndividualLowKpiDays: 3,
        notifyQualitySupervisorDropDays: 3,
        remindAssetInventory: true,
        remindAssetInventoryDays: 3,
      },
    };
  }

  private getDefaultStaffPermissions() {
    return defaultStaffPermissions();
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
      attachments:
        attachments.length > 0 ? attachments : data.attachments || [],
    });
    return this.feedbackRepository.save(feedback);
  }

  async getFeedbacks(
    filters: {
      storeId?: string;
      employeeProfileId?: string;
      accountId?: string;
      status?: FeedbackStatus;
    } = {},
  ) {
    const where: any = {};
    if (filters.storeId) where.storeId = filters.storeId;
    if (filters.employeeProfileId)
      where.employeeProfileId = filters.employeeProfileId;
    if (filters.accountId) where.accountId = filters.accountId;
    if (filters.status) where.status = filters.status;

    return this.feedbackRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Feedback list for one store. The owner sees all of it; an employee sees
   * only the feedback they submitted. `storeId` is required.
   */
  async getFeedbacksForViewer(
    accountId: string | undefined,
    filters: {
      storeId?: string;
      employeeProfileId?: string;
      status?: FeedbackStatus;
    },
  ) {
    if (!filters.storeId) {
      throw new BadRequestException('storeId is required');
    }
    const viewer = await this.resolveStoreViewer(filters.storeId, accountId);
    return this.getFeedbacks({
      storeId: filters.storeId,
      employeeProfileId: filters.employeeProfileId,
      status: filters.status,
      ...(viewer.isOwner ? {} : { accountId }),
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
      if (score >= 90)
        return {
          title: 'Visionary',
          badgeText: 'Tiên Phong Cải Tiến',
          tier: 'TIEN_PHONG',
        };
      if (score >= 60)
        return {
          title: 'Innovator',
          badgeText: 'Đồng Hành Sáng Tạo',
          tier: 'DONG_HANH',
        };
      if (score >= 40)
        return {
          title: 'Architech',
          badgeText: 'Đóng Góp Tâm Huyết',
          tier: 'TAM_HUYET',
        };
      if (score >= 20)
        return {
          title: 'Builder',
          badgeText: 'Tiềm Năng Đổi Mới',
          tier: 'TIEM_NANG',
        };
      return {
        title: 'Contributor',
        badgeText: 'Khởi Đầu Cùng Bạn',
        tier: 'KHOI_DAU',
      };
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
      results: [
        {
          formattedAddress: data.display_name,
          placeId: String(data.place_id),
          types: [data.type, data.category].filter(Boolean),
        },
      ],
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
      // The relation is `tasks`; 'kpiTasks' made every request throw.
      relations: ['tasks'],
      order: { createdAt: 'DESC' },
      take: 5,
    });

    const performance = await this.performanceRepository.find({
      where: { employeeProfileId: data.employeeProfileId },
      order: { createdAt: 'DESC' },
      take: 3,
    });

    // Generate rule-based AI suggestions based on performance history
    const suggestions = this.generateKpiSuggestions(
      kpis,
      performance,
      data.context,
    );

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
  private generateKpiSuggestions(
    kpis: EmployeeKpi[],
    performance: any[],
    context?: string,
  ): any[] {
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
      description:
        'Hoàn thành ít nhất 1 khóa học hoặc buổi đào tạo trong tháng',
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
        rationale:
          'Cần cải thiện điểm hiệu suất để đạt tiêu chuẩn của cửa hàng.',
      });
    } else {
      suggestions.push({
        title: 'KPI Doanh số / Năng suất',
        description: 'Đặt mục tiêu doanh số hoặc số lượng phục vụ trong tháng',
        targetValue: 100,
        unit: 'đơn vị',
        category: 'PERFORMANCE',
        rationale:
          'Nhân viên đang có hiệu suất tốt, có thể đặt mục tiêu cao hơn.',
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

/*
 * The domain parts of StoresService (service-parts/*.part.ts). Their methods
 * are copied onto StoresService.prototype; the interface gives the class their
 * types. Parts take `this: StoresService`, so they reach the injected
 * repositories and each other's methods exactly as code in this class does.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface StoresService
  extends StoresPayrollPart,
    StoresRequestsPart,
    StoresAttendancePart,
    StoresSchedulingPart {}
applyClassParts(StoresService, [
  StoresPayrollPart,
  StoresRequestsPart,
  StoresAttendancePart,
  StoresSchedulingPart,
]);
