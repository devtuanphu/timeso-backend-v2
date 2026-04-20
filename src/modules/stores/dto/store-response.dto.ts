import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsNotEmpty, IsBoolean, IsDateString, IsNumber } from 'class-validator';

export class StoreResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ required: false })
  avatarUrl: string;

  @ApiProperty({ required: false })
  city: string;

  @ApiProperty({ required: false })
  ward: string;

  @ApiProperty({ required: false })
  addressLine: string;

  @ApiProperty({ required: false })
  taxCode: string;

  @ApiProperty()
  phone: string;

  @ApiProperty({ required: false })
  email: string;

  @ApiProperty({ required: false })
  industry: string;

  @ApiProperty({ required: false })
  employeeRangeLabel: string;

  @ApiProperty({ required: false })
  yearsActiveLabel: string;

  @ApiProperty({ required: false })
  qrCode: string;

  @ApiProperty({ required: false })
  latitude: number;

  @ApiProperty({ required: false })
  longitude: number;

  @ApiProperty()
  status: string;
}

export class EmployeeTypeResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ required: false })
  description: string;
}

export class StoreRoleResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ required: false })
  description: string;

  @ApiProperty({ description: 'Hệ số lương', example: 1.5 })
  coefficient: number;

  @ApiProperty({ description: 'Phụ cấp cố định', example: 500000 })
  allowance: number;
}

export class StoreSkillResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  storeId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ required: false })
  description: string;

  @ApiProperty()
  isActive: boolean;
}

export class CreateStoreSkillDto {
  @ApiProperty({ example: 'Kỹ năng bán hàng' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Khả năng tư vấn và chốt đơn hàng', required: false })
  @IsString()
  @IsOptional()
  description?: string;
}

export class UpdateStoreSkillDto {
  @ApiProperty({ example: 'Kỹ năng bán hàng', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ example: 'Khả năng tư vấn và chốt đơn hàng', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: true, required: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class PayrollSummaryValueDto {
  @ApiProperty()
  value: number;

  @ApiProperty({ description: 'Phần trăm thay đổi so với tháng trước' })
  changePercent: number;
}


export class StorePayrollPaymentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  storeId: string;

  @ApiProperty()
  month: Date;

  @ApiProperty()
  totalAmount: number;

  @ApiProperty()
  paymentDate: Date;

  @ApiProperty({ required: false })
  note: string;

  @ApiProperty({ required: false })
  paymentMethod: string;

  @ApiProperty({ required: false })
  referenceNumber: string;
}

export class PayrollMonthlySummaryResponseDto {
  @ApiProperty()
  estimatedPayment: number;

  @ApiProperty()
  totalBonus: PayrollSummaryValueDto;

  @ApiProperty()
  totalPenalty: PayrollSummaryValueDto;

  @ApiProperty()
  totalOvertime: PayrollSummaryValueDto;

  @ApiProperty({ description: 'Số phiếu lương đã duyệt' })
  totalApproved: number;

  @ApiProperty({ description: 'Số phiếu lương cần duyệt' })
  totalPendingApproval: number;

  @ApiProperty()
  salaryFund: number;

  @ApiProperty({ description: 'Tổng quỹ lương tất cả stores cùng owner' })
  salaryFundTotalStore: number;

  @ApiProperty({ description: 'Tổng dự kiến chi trả tất cả stores cùng owner' })
  estimatedPaymentTotalStore: number;

  @ApiProperty({ type: [StorePayrollPaymentResponseDto] })
  paymentHistory: StorePayrollPaymentResponseDto[];
}

export class CreateStorePayrollPaymentDto {
  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  @IsNotEmpty()
  month: string;

  @ApiProperty({ example: 50000000 })
  @IsNumber()
  @IsNotEmpty()
  totalAmount: number;

  @ApiProperty({ example: '2026-01-05T12:00:00Z', required: false })
  @IsDateString()
  @IsOptional()
  paymentDate?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  note?: string;

  @ApiProperty({ required: false, example: 'Tiền mặt' })
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  referenceNumber?: string;
}

export class UpdateStorePayrollPaymentDto {
  @ApiProperty({ example: 50000000, required: false })
  @IsNumber()
  @IsOptional()
  totalAmount?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  note?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  referenceNumber?: string;
}

export class EmployeeProfileResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  accountId: string;

  @ApiProperty()
  storeId: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  status: string;

  @ApiProperty({ description: 'Trạng thái vận hành của nhân viên' })
  workingStatus: string;

  @ApiProperty({ required: false })
  probationEndsAt: Date;

  @ApiProperty({ required: false })
  role: StoreRoleResponseDto;

  @ApiProperty({ required: false })
  skillId: string;

  @ApiProperty({ required: false })
  skill: StoreSkillResponseDto;

  @ApiProperty({ required: false })
  account: any;

  @ApiProperty({ required: false })
  store: StoreResponseDto;

  // Thống kê tháng hiện tại
  @ApiProperty({ required: false, description: 'Tổng số ca đã đăng ký (tháng hiện tại)' })
  totalShifts?: number;

  @ApiProperty({ required: false, description: 'Tổng số ca đã làm thực tế (tháng hiện tại)' })
  completedShifts?: number;

  @ApiProperty({ required: false, description: 'Số lần đi làm đúng giờ (tháng hiện tại)' })
  onTimeArrivalsCount?: number;

  @ApiProperty({ required: false, description: 'Số lần đi trễ (tháng hiện tại)' })
  lateArrivalsCount?: number;

  @ApiProperty({ required: false, description: 'Số lần về sớm (tháng hiện tại)' })
  earlyDeparturesCount?: number;

  @ApiProperty({ required: false, description: 'Số lần nghỉ có phép (tháng hiện tại)' })
  authorizedLeavesCount?: number;

  @ApiProperty({ required: false, description: 'Số lần nghỉ không phép (tháng hiện tại)' })
  unauthorizedLeavesCount?: number;

  @ApiProperty({ required: false, description: 'Lương dự kiến (tháng hiện tại)' })
  estimatedSalary?: number;
}

export class ContractResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  contractCode: string;

  @ApiProperty()
  type: string;

  @ApiProperty()
  startDate: Date;

  @ApiProperty()
  endDate: Date;

  @ApiProperty({ required: false, description: 'Thời hạn hợp đồng (tháng)' })
  durationMonths: number;

  @ApiProperty()
  salaryType: string;

  @ApiProperty()
  baseSalary: number;

  @ApiProperty({ required: false })
  fileUrl: string;
}

export class WorkShiftResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  startTime: string;

  @ApiProperty()
  endTime: string;
}

export class AssetResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ required: false })
  sku: string;

  @ApiProperty({ required: false })
  purchasePrice: number;

  @ApiProperty({ required: false })
  avatarUrl: string;

  @ApiProperty()
  currentStatus: string;
}

export class ProductResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ required: false })
  sku: string;

  @ApiProperty()
  costPrice: number;

  @ApiProperty({ required: false })
  sellingPrice: number;

  @ApiProperty()
  currentStock: number;

  @ApiProperty({ required: false })
  avatarUrl: string;
}

export class StockTransactionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  type: string;

  @ApiProperty()
  transactionDate: Date;

  @ApiProperty()
  status: string;

  @ApiProperty({ required: false })
  note: string;
}

export class ServiceItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  price: number;

  @ApiProperty({ required: false })
  size: string;

  @ApiProperty({ required: false })
  duration: number;

  @ApiProperty({ required: false })
  avatarUrl: string;
}

export class OrderItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  unitPrice: number;

  @ApiProperty()
  totalPrice: number;

  @ApiProperty({ required: false })
  note: string;

  @ApiProperty()
  itemSnapshot: any;
}

export class OrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  type: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  totalAmount: number;

  @ApiProperty()
  paymentMethod: string;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items: OrderItemResponseDto[];

  @ApiProperty()
  createdAt: Date;
}

export class RevenueReportResponseDto {
  @ApiProperty()
  summary: any;

  @ApiProperty()
  daily: any[];

  @ApiProperty()
  byType: any[];

  @ApiProperty()
  topItems: any[];
}

export class SalaryConfigResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  minWorkDays: number;
}

export class PayrollResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  month: Date;

  @ApiProperty()
  estimatedPayment: number;

  @ApiProperty()
  salaryFund: number;

  @ApiProperty()
  totalBonus: number;

  @ApiProperty()
  totalPenalty: number;

  @ApiProperty()
  totalOvertime: number;

  @ApiProperty()
  totalPendingApproval: number;

  @ApiProperty()
  totalApproved: number;

  @ApiProperty()
  isFinalized: boolean;

  @ApiProperty({ required: false })
  notes: string;
}

export class KpiTypeResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class KpiResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  targetValue: number;
}

export class EventResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  date: Date;

  @ApiProperty()
  eventType: string;
}

export class DailyReportResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  reportDate: Date;

  @ApiProperty({ type: [String] })
  lateArrivals: string[];

  @ApiProperty({ type: [String] })
  earlyDepartures: string[];

  @ApiProperty({ type: [String] })
  forgotClockOut: string[];

  @ApiProperty({ type: [String] })
  unauthorizedLeaves: string[];

  @ApiProperty({ type: [String] })
  extraShifts: string[];

  @ApiProperty({ type: [String] })
  authorizedLeaves: string[];

  @ApiProperty({ required: false })
  note: string;

  @ApiProperty({ description: 'Dự kiến chi trả tháng này (của store)' })
  estimatedPayment: number;

  @ApiProperty({ description: 'Quỹ lương tháng này (của store)' })
  salaryFund: number;

  @ApiProperty({ description: 'Tổng dự kiến chi trả tháng này (tất cả store của owner)' })
  estimatedPaymentTotalStore: number;

  @ApiProperty({ description: 'Tổng quỹ lương tháng này (tất cả store của owner)' })
  salaryFundTotalStore: number;
}

export class EmployeeBasicInfoResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  fullName: string;

  @ApiProperty({ required: false })
  avatar: string;

  @ApiProperty({ required: false })
  storeRole: string;

  @ApiProperty({ required: false })
  employeeType: string;
}

export class EmployeeStatisticsSummaryDto {
  @ApiProperty({ description: 'Tổng số nhân viên đi làm đúng giờ' })
  onTimeCount: number;

  @ApiProperty({ description: 'Tổng số nhân viên nghỉ có phép' })
  authorizedLeaveCount: number;

  @ApiProperty({ description: 'Tổng số nhân viên đi làm trễ' })
  lateArrivalCount: number;

  @ApiProperty({ description: 'Tổng số nhân viên nghỉ không phép' })
  unauthorizedLeaveCount: number;
}

export class EmployeeTypeCountDto {
  @ApiProperty({ description: 'Tên loại nhân viên (VD: All, Full-time...)' })
  name: string;

  @ApiProperty({ description: 'Số lượng nhân viên' })
  count: number;
}

export class EmployeesWithStatisticsResponseDto {
  @ApiProperty({ type: [EmployeeProfileResponseDto], description: 'Danh sách nhân viên' })
  employees: EmployeeProfileResponseDto[];

  @ApiProperty({ type: EmployeeStatisticsSummaryDto, description: 'Thống kê tổng hợp' })
  summary: EmployeeStatisticsSummaryDto;

  @ApiProperty({ type: [EmployeeTypeCountDto], description: 'Số lượng nhân viên theo từng loại' })
  typeCounts: EmployeeTypeCountDto[];
}

export class EmployeeMonthlySummaryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  employeeProfileId: string;

  @ApiProperty({ description: 'Tháng (ngày đầu tháng)', example: '2026-01-01' })
  month: Date;

  @ApiProperty({ description: 'Tổng số ca đã đăng ký' })
  totalShifts: number;

  @ApiProperty({ description: 'Tổng số ca đã làm thực tế' })
  completedShifts: number;

  @ApiProperty({ description: 'Số lần đi làm đúng giờ' })
  onTimeArrivalsCount: number;

  @ApiProperty({ description: 'Số lần đi trễ' })
  lateArrivalsCount: number;

  @ApiProperty({ description: 'Số lần về sớm' })
  earlyDeparturesCount: number;

  @ApiProperty({ description: 'Số lần quên chấm công ra' })
  forgotClockOutCount: number;

  @ApiProperty({ description: 'Số lần nghỉ không phép' })
  unauthorizedLeavesCount: number;

  @ApiProperty({ description: 'Số lần nghỉ có phép' })
  authorizedLeavesCount: number;

  @ApiProperty({ description: 'Số ca làm thêm' })
  extraShiftsCount: number;

  @ApiProperty({ description: 'Lương cơ bản từ hợp đồng' })
  baseSalary: number;

  @ApiProperty({ description: 'Phụ cấp' })
  allowances: number;

  @ApiProperty({ description: 'Thưởng' })
  bonuses: number;

  @ApiProperty({ description: 'Phạt (đi trễ, về sớm...)' })
  penalties: number;

  @ApiProperty({ description: 'Tiền làm thêm giờ' })
  overtimePay: number;

  @ApiProperty({ description: 'Lương tạm tính' })
  estimatedSalary: number;

  @ApiProperty({ description: 'Đã chốt lương chưa' })
  isFinalized: boolean;

  @ApiProperty({ required: false })
  finalizedAt: Date;

  @ApiProperty({ required: false })
  notes: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class EmployeeActivityResponseDto {
  @ApiProperty({ example: 'CHECK_IN' })
  type: 'CHECK_IN' | 'CHECK_OUT';

  @ApiProperty()
  time: Date;

  @ApiProperty({ example: 'Ca sáng' })
  shiftName: string;

  @ApiProperty({ example: '2026-01-23' })
  workDate: string;

  @ApiProperty({ example: 'COMPLETED' })
  status: string;
}

export class EmployeeDetailResponseDto {
  @ApiProperty({ type: EmployeeProfileResponseDto })
  profile: EmployeeProfileResponseDto;

  @ApiProperty({ type: EmployeeMonthlySummaryResponseDto, required: false })
  monthlySummary?: EmployeeMonthlySummaryResponseDto;

  @ApiProperty({ type: [EmployeeActivityResponseDto] })
  recentActivities: EmployeeActivityResponseDto[];
}

export class PerformanceAssessmentDto {
  @ApiProperty()
  type: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  content: string;

  @ApiProperty()
  ratingLabel: string;

  @ApiProperty()
  reviewerName: string;

  @ApiProperty()
  date: Date;
}

export class ProgressionRequirementDto {
  @ApiProperty()
  label: string;

  @ApiProperty()
  currentValue: string | number;

  @ApiProperty()
  requiredValue: string | number;

  @ApiProperty()
  isMet: boolean;
}

export class EmployeePerformanceReportResponseDto {
  // Part 1: Tổng quan (Tháng hiện tại)
  @ApiProperty()
  performanceScore: number;

  @ApiProperty()
  monthlyWorkHours: number;

  @ApiProperty()
  completedShifts: number;

  @ApiProperty()
  totalShifts: number;

  @ApiProperty()
  kpiCompletedCount: number;

  @ApiProperty()
  kpiTotalCount: number;

  @ApiProperty()
  lateArrivalsCount: number;

  @ApiProperty()
  unauthorizedLeavesCount: number;

  // Part 2: Thống kê làm việc (Tích lũy)
  @ApiProperty()
  tenureDisplay: string; // VD: "3 năm", "6 tháng"

  @ApiProperty()
  totalWorkHours: number;

  @ApiProperty()
  totalCompletedShifts: number;

  // Part 3: Danh sách đánh giá
  @ApiProperty({ type: [PerformanceAssessmentDto] })
  assessments: PerformanceAssessmentDto[];

  // Part 4: Lộ trình thăng tiến
  @ApiProperty()
  progression: {
    currentPosition: string;
    skills: string;
    nextTarget: string;
    rankInPosition: string; // VD: "8/15"
    requirements: ProgressionRequirementDto[];
    suggestion: string; // VD: "Còn thiếu 8 điểm năng lực..."
  };
}

export class ProgressionSuggestionDto {
  @ApiProperty()
  text: string;
}

export class ProgressionStageRequirementDto {
  @ApiProperty()
  text: string;

  @ApiProperty()
  completed: boolean;
}

export class ProgressionStageDto {
  @ApiProperty()
  title: string;

  @ApiProperty()
  progress: number;

  @ApiProperty({ type: [ProgressionStageRequirementDto], required: false })
  requirements?: ProgressionStageRequirementDto[];

  @ApiProperty({ type: ProgressionSuggestionDto, required: false })
  suggestion?: ProgressionSuggestionDto;
}

export class ScheduleRequestDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'REGISTER' })
  type: string; // REGISTER, SWAP, LEAVE

  @ApiProperty()
  title: string;

  @ApiProperty()
  details: string;

  @ApiProperty()
  status: string; // PENDING, APPROVED, REJECTED

  @ApiProperty()
  requestDate: Date;

  @ApiProperty()
  targetDate: Date;
}

export class DailyShiftDto {
  @ApiProperty()
  name: string; // Ca sáng

  @ApiProperty()
  startTime: string;

  @ApiProperty()
  endTime: string;

  @ApiProperty()
  status: string; // UPCOMING, COMPLETED, ABSENT, LATE

  @ApiProperty({ required: false })
  note?: string;

  @ApiProperty({ required: false })
  color?: string;
}

export class DailyScheduleDto {
  @ApiProperty()
  date: Date;

  @ApiProperty()
  dayOfWeek: string;

  @ApiProperty()
  day: number;

  @ApiProperty()
  hasShift: boolean;

  @ApiProperty({ required: false })
  status?: string; // LATE, ABSENT, NORMAL, etc.

  @ApiProperty({ type: [DailyShiftDto] })
  shifts: DailyShiftDto[];
}

export class ScheduleOverviewDto {
  @ApiProperty()
  totalWorkHours: number;

  @ApiProperty()
  totalShifts: number;
}

export class ShiftRequestDto { // Dùng cho REGISTER và SWAP
   @ApiProperty()
  id: string;

  @ApiProperty()
  type: string; // REGISTER, SWAP

  @ApiProperty()
  title: string;

  @ApiProperty()
  details: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  requestDate: Date;
}

export class LeaveRequestDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  startDate: Date;

  @ApiProperty()
  endDate: Date;

  @ApiProperty()
  reason: string;

  @ApiProperty()
  status: string;
}

export class EmployeeScheduleDetailsDto {
  @ApiProperty({ type: ScheduleOverviewDto })
  overview: ScheduleOverviewDto;

  @ApiProperty({ type: [ShiftRequestDto] })
  shiftRequests: ShiftRequestDto[];

  @ApiProperty({ type: [LeaveRequestDto] })
  leaveRequests: LeaveRequestDto[];

  @ApiProperty({ type: [DailyScheduleDto] })
  calendar: DailyScheduleDto[];
}

export class ApprovalRequestDto {
  @ApiProperty({ example: 'REGISTER' })
  @IsEnum(['REGISTER', 'SWAP', 'LEAVE'])
  type: 'REGISTER' | 'SWAP' | 'LEAVE';

  @ApiProperty({ example: 'APPROVED' })
  @IsEnum(['APPROVED', 'REJECTED'])
  status: 'APPROVED' | 'REJECTED';

  @ApiProperty({ required: false })
  @IsString()
  reason?: string;
}

export class DeleteEmployeeDto {
  @ApiProperty({ example: 'reason-uuid' })
  @IsString()
  @IsNotEmpty()
  reasonId: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class PermanentDeleteEmployeeDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class RenewContractDto {
  @ApiProperty({ required: false, example: '2026-06-30' })
  @IsOptional()
  endDate?: Date;

  @ApiProperty({ required: false, example: 5000000 })
  @IsOptional()
  salaryAmount?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  contractName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  jobDescription?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  allowances?: Record<string, number>;
}

export class UpdateDetailsContractDto {
  @ApiProperty({ required: false })
  @IsOptional()
  contractName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  jobDescription?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  startDate?: Date;

  @ApiProperty({ required: false })
  @IsOptional()
  endDate?: Date;

  @ApiProperty({ required: false })
  @IsOptional()
  salaryAmount?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  allowances?: Record<string, number>;
}

export class StoreProbationSettingDto {
  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  probationDays?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  probationShifts?: number;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  notifyEvaluation?: boolean;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  notifyResultToEmployee?: boolean;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  autoCloseChecklist?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  attendanceChecklist?: any[];

  @ApiProperty({ required: false })
  @IsOptional()
  attitudeChecklist?: any[];

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  enableCompletionBonus?: boolean;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  completionBonus?: number;
}

export class EmployeePersonalInfoResponseDto {
  @ApiProperty()
  fullName: string;

  @ApiProperty()
  gender: string;

  @ApiProperty()
  birthday: Date;

  @ApiProperty()
  phone: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  identityCardNumber: string;

  @ApiProperty()
  frontImageUrl: string;

  @ApiProperty()
  backImageUrl: string;

  @ApiProperty()
  address: string;

  @ApiProperty()
  city: string;

  @ApiProperty()
  district: string;

  @ApiProperty()

  bankNumber: string;

  @ApiProperty()
  bankName: string;

  @ApiProperty()
  taxCode: string;

  @ApiProperty()
  header: {
    avatar: string;
    fullName: string;
    role: string;
    storeName: string;
  };
}

export class UpdatePersonalInfoDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() fullName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() gender?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() birthday?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() phone?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() email?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() identityCardNumber?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() address?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() city?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() district?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() bankNumber?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() bankName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() taxCode?: string;

  @ApiProperty({ type: 'string', format: 'binary', required: false })
  @IsOptional()
  avatar?: any;

  @ApiProperty({ type: 'string', format: 'binary', required: false })
  @IsOptional()
  frontImage?: any;

  @ApiProperty({ type: 'string', format: 'binary', required: false })
  @IsOptional()
  backImage?: any;
}

export class MonthlySalaryFundStoreDto {
  @ApiProperty()
  storeId: string;

  @ApiProperty()
  storeName: string;

  @ApiProperty()
  salaryFund: number;

  @ApiProperty()
  estimatedPayment: number;

  @ApiProperty()
  remainingBudget: number;
}

export class MonthlySalaryFundResponseDto {
  @ApiProperty()
  totalBudget: number;

  @ApiProperty()
  totalExpectedPayroll: number;

  @ApiProperty()
  totalRemainingBudget: number;

  @ApiProperty()
  month: string;

  @ApiProperty()
  storeCount: number;

  @ApiProperty({ type: [MonthlySalaryFundStoreDto] })
  stores: MonthlySalaryFundStoreDto[];
}


