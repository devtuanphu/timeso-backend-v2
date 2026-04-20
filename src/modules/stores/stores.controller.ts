import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  UseGuards,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  NotFoundException,
  UnauthorizedException,
  Req,
  Res,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { StoresService } from './stores.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { AccountsService } from '../accounts/accounts.service';
import { MailService } from '../mail/mail.service';
import { CreateManualEmployeeDto } from './dto/create-manual-employee.dto';
import { CreateStoreDto } from './dto/create-store.dto';
import { CreateProductDto } from './dto/inventory.dto';
import { CreateAssetDto } from './dto/create-asset.dto';
import { AssetExportDto } from './dto/asset-export.dto';
import { CreateAssetExportTypeDto } from './dto/asset-export-type.dto';
import { CreateProductExportTypeDto } from './dto/product-export.dto';
import { StoreProbationSettingDto } from './dto/store-probation-setting.dto';
import { StoreApprovalSettingDto } from './dto/store-approval-setting.dto';
import { StoreTimekeepingSettingDto } from './dto/store-timekeeping-setting.dto';
import { UpdateStoreShiftConfigDto } from './dto/store-shift-config.dto';
import { UpdateInternalRuleDto, InternalRuleResponseDto } from './dto/store-internal-rule.dto';
import { StorePermissionConfigDto } from './dto/store-permission-config.dto';





import {
  CreateServiceItemDto,
  CreateOrderDto,
  CreateFnbServiceItemDto,
  CreateYieldServiceItemDto,
  CreatePersonalCareItemDto,
  CreatePetCareItemDto,
} from './dto/order-management.dto';
import {
  StoreResponseDto,
  EmployeeTypeResponseDto,
  StoreRoleResponseDto,
  EmployeeProfileResponseDto,
  ContractResponseDto,
  WorkShiftResponseDto,
  AssetResponseDto,
  ProductResponseDto,
  StockTransactionResponseDto,
  ServiceItemResponseDto,
  OrderResponseDto,
  RevenueReportResponseDto,
  PayrollResponseDto,
  SalaryConfigResponseDto,
  KpiResponseDto,
  DailyReportResponseDto,
  EventResponseDto,
  KpiTypeResponseDto,
  EmployeeBasicInfoResponseDto,
  EmployeeMonthlySummaryResponseDto,
  EmployeesWithStatisticsResponseDto,
  EmployeeDetailResponseDto,
  EmployeePerformanceReportResponseDto,
  ProgressionStageDto,
  EmployeeScheduleDetailsDto,
  ApprovalRequestDto,
  DeleteEmployeeDto,
  PermanentDeleteEmployeeDto,
  RenewContractDto,
  UpdateDetailsContractDto,
  CreateStoreSkillDto,
  UpdateStoreSkillDto,

  StoreSkillResponseDto,
  CreateStorePayrollPaymentDto,
  UpdateStorePayrollPaymentDto,
  StorePayrollPaymentResponseDto,
  PayrollMonthlySummaryResponseDto,
  MonthlySalaryFundResponseDto,
  EmployeePersonalInfoResponseDto,
  UpdatePersonalInfoDto,
} from './dto/store-response.dto';


import { CreateSalaryConfigDto, UpdateSalaryConfigDto } from './dto/salary-config.dto';
import { CreateSalaryAdjustmentDto, SalaryAdjustmentResponseDto } from './dto/salary-adjustment.dto';
import { ConfigStatus } from './entities/salary-config.entity';
import { ShiftChangeRequestStatus } from './entities/shift-change-request.entity';
import { BonusWorkRequestStatus } from './entities/bonus-work-request.entity';
import { AssignAssetDto, ReturnAssetDto, ExchangeAssetDto, ReassignAssetDto } from './dto/employee-asset.dto';
import {
  FileFieldsInterceptor,
  FileInterceptor,
  AnyFilesInterceptor,
  FilesInterceptor,
} from '@nestjs/platform-express';
import { multerConfig } from '../../common/utils/multer-config';
import { AssetMultipartInterceptor } from './interceptors/asset-multipart.interceptor';
import { ProductMultipartInterceptor } from './interceptors/product-multipart.interceptor';
import { UpdatePayrollSettingDto } from './dto/store-payroll-setting.dto';


import { StoreEventType } from './entities/store-event.entity';
import { KpiStatus } from './entities/employee-kpi.entity';
import { KpiRequestStatus } from './entities/kpi-approval-request.entity';
import { InventoryReportStatus } from './entities/inventory-report.entity';

@ApiTags('Cửa hàng & Vận hành (Stores)')
@ApiBearerAuth()
@Controller('stores')
@UseGuards(JwtAuthGuard)
export class StoresController {
  constructor(
    private readonly storesService: StoresService,
    private readonly accountsService: AccountsService,
    private readonly mailService: MailService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('avatar', multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Tạo cửa hàng mới',
    description: 'Chủ sở hữu tạo cửa hàng đầu tiên hoặc chi nhánh mới',
  })
  @ApiResponse({
    status: 201,
    description: 'Cửa hàng đã được tạo thành công',
    type: StoreResponseDto,
  })
  async create(
    @GetUser() user: any, 
    @Body() body: CreateStoreDto,
    @UploadedFile() file?: Express.Multer.File
  ) {
    const storeData: any = { 
      ...body, 
      ownerAccountId: user.userId 
    };
    
    // Handle avatar upload
    if (file) {
      storeData.avatarUrl = `/uploads/${file.filename}`;
    }
    
    // Remove the avatar field from body to avoid TypeORM errors
    delete storeData.avatar;
    
    return this.storesService.create(storeData);
  }

  @Get()
  @ApiOperation({
    summary: 'Lấy danh sách cửa hàng',
    description:
      'Lấy toàn bộ cửa hàng thuộc quyền quản lý của user đang đăng nhập',
  })
  @ApiResponse({
    status: 200,
    description: 'Danh sách cửa hàng',
    type: [StoreResponseDto],
  })
  async findAll(@GetUser() user: any) {
    return this.storesService.findAllByOwner(user.userId);
  }

  @Get('monthly-salary-fund')
  @ApiOperation({ summary: 'Lấy tổng quỹ lương và dự kiến cần trả của tất cả stores theo tháng' })
  @ApiQuery({ name: 'date', required: true, example: '04/2026', description: 'Tháng cần lấy báo cáo (MM/YYYY)' })
  @ApiResponse({ status: 200, type: MonthlySalaryFundResponseDto })
  async getMonthlySalaryFund(@GetUser() user: any, @Query('date') date: string) {
    return this.storesService.getMonthlySalaryFund(user.userId, date);
  }

  @Get('staff')
  @ApiOperation({
    summary: 'Lấy danh sách nhân viên của toàn bộ cửa hàng hoặc theo Store ID',
    description: 'Nếu storeId không được truyền, hệ thống sẽ lấy toàn bộ nhân viên thuộc tất cả cửa hàng của Owner.',
  })
  @ApiQuery({ name: 'storeId', required: false, description: 'ID của cửa hàng' })
  @ApiQuery({ name: 'typeName', required: false, description: 'Lọc theo loại hình (Full-time, Part-time...)' })
  @ApiResponse({
    status: 200,
    description: 'Danh sách nhân viên và thống kê tổng hợp',
    type: EmployeesWithStatisticsResponseDto,
  })
  async getAllStaff(
    @GetUser() user: any,
    @Query('storeId') storeId?: string,
    @Query('typeName') typeName?: string,
    @Query('isDeleted') isDeleted?: string,
  ) {
    // Sanitize storeId if it contains query string characters (handle manual entry errors)
    const sanitizedStoreId = storeId?.split('?')[0];
    const isDeletedBool = isDeleted === 'true';
    return this.storesService.getEmployees(user.userId, sanitizedStoreId, typeName, isDeletedBool);
  }

  // Employee KPI Management
  @Post('employee-kpis')
  @ApiOperation({ summary: 'Tạo bảng KPI cho nhân viên' })
  async createEmployeeKpi(@Body() body: any) {
    return this.storesService.createEmployeeKpi(body);
  }

  @Get('kpis')
  @ApiOperation({ summary: 'Lấy danh sách bảng KPI (có filter)' })
  async getEmployeeKpis(
    @Query('employeeProfileId') employeeProfileId?: string,
    @Query('storeId') storeId?: string,
    @Query('month') month?: string,
    @Query('rating') rating?: string
  ) {
    return this.storesService.getEmployeeKpis({ 
      employeeProfileId, 
      storeId, 
      month, 
      rating 
    });
  }

  @Patch('employee-kpis/:id/status')
  @ApiOperation({ summary: 'Cập nhật trạng thái bảng KPI (Tạm dừng, Đang áp dụng...)' })
  async updateEmployeeKpiStatus(
    @Param('id') id: string,
    @Body('status') status: KpiStatus,
  ) {
    return this.storesService.updateEmployeeKpiStatus(id, status);
  }

  @Post('employee-kpis/:id/duplicate')
  @ApiOperation({ summary: 'Nhân bản bảng KPI' })
  async duplicateEmployeeKpi(@Param('id') id: string) {
    return this.storesService.duplicateEmployeeKpi(id);
  }

  @Delete('employee-kpis/:id')
  @ApiOperation({ summary: 'Xóa bảng KPI' })
  async deleteEmployeeKpi(@Param('id') id: string) {
    return this.storesService.deleteEmployeeKpi(id);
  }

  @Patch('employee-kpis/:id/reminders')
  @ApiOperation({ summary: 'Cập nhật lời nhắc nhở cho KPI' })
  async updateKpiReminders(@Param('id') id: string, @Body('reminders') reminders: string) {
    return this.storesService.updateKpiReminders(id, reminders);
  }

  @Patch('employee-kpis/:id/compliments')
  @ApiOperation({ summary: 'Gửi lời khen cho nhân viên qua KPI' })
  async updateKpiCompliments(@Param('id') id: string, @Body('compliments') compliments: string) {
    return this.storesService.updateKpiCompliments(id, compliments);
  }

  // KPI Approval Requests
  @Post('kpi-approval-requests')
  @ApiOperation({ summary: 'Nhân viên gửi yêu cầu duyệt bảng KPI' })
  async createKpiApprovalRequest(@Body() body: { employeeProfileId: string; employeeKpiId: string; note?: string }) {
    return this.storesService.createKpiApprovalRequest(body);
  }

  @Get('kpi-approval-requests')
  @ApiOperation({ summary: 'Lấy danh sách yêu cầu duyệt KPI' })
  async getKpiApprovalRequests(
    @Query('storeId') storeId?: string,
    @Query('month') month?: string,
  ) {
    return this.storesService.getKpiApprovalRequests(storeId, month);
  }

  @Patch('kpi-approval-requests/:id/handle')
  @ApiOperation({ summary: 'Chấp thuận hoặc Từ chối yêu cầu duyệt KPI' })
  async handleKpiApprovalRequest(
    @Param('id') id: string,
    @GetUser() user: any,
    @Body() body: { status: KpiRequestStatus; note?: string }
  ) {
    // Giả định user.userId là accountId, cần tìm profile tương ứng của reviewer
    // Tuy nhiên để đơn giản trong luồng này, ta có thể log thông tin reviewer
    return this.storesService.handleKpiApprovalRequest(id, user.userId, body);
  }

  @Get('fnb-items')
  @ApiOperation({ summary: 'Lấy danh sách món F&B kèm thống kê theo danh mục' })
  async getFnbItems(
    @Query('storeId') storeId: string,
    @Query('categoryId') categoryId?: string,
  ) {
    if (!storeId) throw new BadRequestException('storeId is required');
    return this.storesService.getFnbItems(storeId, categoryId);
  }

  // Yield Items
  @Post(':id/yield-items')
  @UseInterceptors(FileInterceptor('avatar', multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Tạo mặt hàng Sản lượng (Yield)' })
  async createYieldItem(
    @Param('id') id: string,
    @Body() body: CreateYieldServiceItemDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const data: any = { ...body };
    if (file) data.avatarUrl = `/uploads/${file.filename}`;
    return this.storesService.createYieldServiceItem(id, data);
  }

  @Get('yield-items')
  @ApiOperation({ summary: 'Lấy danh sách mặt hàng Sản lượng kèm thống kê' })
  async getYieldItems(
    @Query('storeId') storeId: string,
    @Query('categoryId') categoryId?: string,
  ) {
    if (!storeId) throw new BadRequestException('storeId is required');
    return this.storesService.getYieldItems(storeId, categoryId);
  }

  // Personal Care Items
  @Post(':id/personal-care-items')
  @UseInterceptors(FileInterceptor('avatar', multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Tạo dịch vụ Spa/Personal Care' })
  async createPersonalCareItem(
    @Param('id') id: string,
    @Body() body: CreatePersonalCareItemDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const data: any = { ...body };
    if (file) data.avatarUrl = `/uploads/${file.filename}`;
    return this.storesService.createPersonalCareItem(id, data);
  }

  @Get('personal-care-items')
  @ApiOperation({ summary: 'Lấy danh sách dịch vụ Spa/Personal Care kèm thống kê' })
  async getPersonalCareItems(
    @Query('storeId') storeId: string,
    @Query('categoryId') categoryId?: string,
  ) {
    if (!storeId) throw new BadRequestException('storeId is required');
    return this.storesService.getPersonalCareItems(storeId, categoryId);
  }

  // Pet Care Items
  @Post(':id/pet-care-items')
  @UseInterceptors(FileInterceptor('avatar', multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Tạo dịch vụ Thú cưng (Pet Care)' })
  async createPetCareItem(
    @Param('id') id: string,
    @Body() body: CreatePetCareItemDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const data: any = { ...body };
    if (file) data.avatarUrl = `/uploads/${file.filename}`;
    return this.storesService.createPetCareItem(id, data);
  }

  @Get('pet-care-items')
  @ApiOperation({ summary: 'Lấy danh sách dịch vụ Thú cưng kèm thống kê' })
  async getPetCareItems(
    @Query('storeId') storeId: string,
    @Query('categoryId') categoryId?: string,
  ) {
    if (!storeId) throw new BadRequestException('storeId is required');
    return this.storesService.getPetCareItems(storeId, categoryId);
  }

  // Feedbacks — MUST be BEFORE GET ':id' to avoid route conflict
  @Get('feedbacks')
  @ApiOperation({ summary: 'Lấy danh sách feedback' })
  @ApiQuery({ name: 'storeId', required: false })
  @ApiQuery({ name: 'employeeProfileId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getFeedbacksEarly(
    @Query('storeId') storeId?: string,
    @Query('employeeProfileId') employeeProfileId?: string,
    @Query('status') status?: string,
  ) {
    return this.storesService.getFeedbacks({ storeId, employeeProfileId, status: status as any });
  }

  @Get('feedbacks/leaderboard')
  @ApiOperation({ summary: 'Bảng xếp hạng feedback nhân viên theo store' })
  @ApiQuery({ name: 'storeId', required: true })
  async getFeedbackLeaderboardEarly(@Query('storeId') storeId: string) {
    return this.storesService.getFeedbackLeaderboard(storeId);
  }

  // Shift Registrations — MUST be BEFORE GET ':id' to avoid route conflict
  @Get('shift-registrations')
  @ApiOperation({ summary: 'Lấy danh sách đề xuất đăng ký ca' })
  @ApiQuery({ name: 'storeId', required: false })
  @ApiQuery({ name: 'employeeProfileId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getShiftRegistrationsEarly(
    @Query('storeId') storeId?: string,
    @Query('employeeProfileId') employeeProfileId?: string,
    @Query('status') status?: string,
  ) {
    return this.storesService.getShiftRegistrations({ storeId, employeeProfileId, status });
  }

  // KPI Task Management (MUST be above @Get(':id') to avoid route collision)
  @Post('kpi-tasks')
  @ApiOperation({ summary: 'Thêm nhiệm vụ vào bảng KPI' })
  async createKpiTask(@Body() body: any) {
    return this.storesService.createKpiTask(body);
  }

  @Patch('kpi-tasks/:id/progress')
  @ApiOperation({ summary: 'Cập nhật tiến độ nhiệm vụ KPI' })
  async updateKpiTaskProgress(
    @Param('id') id: string,
    @Body('actualValue') actualValue: number,
  ) {
    return this.storesService.updateKpiTaskProgress(id, actualValue);
  }

  @Get('kpi-tasks')
  @ApiOperation({ summary: 'Lấy danh sách nhiệm vụ KPI' })
  @ApiQuery({ name: 'employeeKpiId', required: false })
  @ApiQuery({ name: 'storeId', required: false })
  @ApiQuery({ name: 'isHidden', required: false, type: Boolean })
  async getKpiTasks(
    @Query('employeeKpiId') employeeKpiId?: string,
    @Query('storeId') storeId?: string,
    @Query('isHidden') isHidden?: string,
  ) {
    return this.storesService.getKpiTasks({
      employeeKpiId,
      storeId,
      isHidden: isHidden === 'true' ? true : isHidden === 'false' ? false : undefined,
    });
  }

  @Delete('kpi-tasks/:id')
  @ApiOperation({ summary: 'Xóa nhiệm vụ KPI' })
  async deleteKpiTask(@Param('id') id: string) {
    return this.storesService.deleteKpiTask(id);
  }

  @Patch('kpi-tasks/:id/hide')
  @ApiOperation({ summary: 'Ẩn nhiệm vụ KPI' })
  async hideKpiTask(@Param('id') id: string) {
    return this.storesService.hideKpiTask(id);
  }

  // Orders detail routes (MUST be above @Get(':id') to avoid route collision)
  @Get('orders/:orderId')
  @ApiOperation({
    summary: 'Xem chi tiết đơn hàng',
    description: 'Lấy thông tin tài chính và danh sách món trong đơn',
  })
  async getOrderById(@Param('orderId') orderId: string) {
    return this.storesService.getOrderById(orderId);
  }

  @Put('orders/:orderId/status')
  @ApiOperation({
    summary: 'Cập nhật trạng thái đơn hàng',
    description: 'Ví dụ: Chuyển từ PENDING sang COMPLETED hoặc CANCELLED',
  })
  async updateOrderStatus(
    @Param('orderId') orderId: string,
    @Body('status') status: any,
  ) {
    return this.storesService.updateOrderStatus(orderId, status);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Google Maps Proxy API (key stays server-side)
  // MUST be above @Get(':id') to avoid route collision
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  @Get('maps/geocode')
  @ApiOperation({
    summary: 'Reverse geocode (lat/lng → address)',
    description: 'Proxy API — Google Maps key stays server-side',
  })
  async geocodeReverse(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
  ) {
    if (!lat || !lng) throw new BadRequestException('lat and lng are required');
    return this.storesService.geocodeReverse(parseFloat(lat), parseFloat(lng));
  }

  @Get('maps/places')
  @ApiOperation({
    summary: 'Search places by query',
    description: 'Proxy API — Google Maps key stays server-side',
  })
  async searchPlaces(
    @Query('query') query: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ) {
    if (!query) throw new BadRequestException('query is required');
    return this.storesService.searchPlaces(
      query,
      lat ? parseFloat(lat) : undefined,
      lng ? parseFloat(lng) : undefined,
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Lấy thông tin chi tiết cửa hàng',
    description: 'Lấy đầy đủ thông tin cửa hàng theo ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Thông tin cửa hàng',
    type: StoreResponseDto,
  })
  async findById(@Param('id') id: string) {
    return this.storesService.findById(id);
  }

  @Put(':id')
  @UseInterceptors(FileInterceptor('avatar', multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Cập nhật thông tin cửa hàng',
    description: 'Chủ sở hữu hoặc Quản lý cập nhật thông tin cửa hàng (bao gồm ảnh đại diện)',
  })
  @ApiResponse({
    status: 200,
    description: 'Cửa hàng đã được cập nhật thành công',
    type: StoreResponseDto,
  })
  async updateStore(
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFile() file?: Express.Multer.File
  ) {
    const storeData: any = { ...body };
    
    // Handle avatar upload
    if (file) {
      storeData.avatarUrl = `/uploads/${file.filename}`;
    }
    
    // Remove the avatar field from body to avoid TypeORM errors
    delete storeData.avatar;
    
    return this.storesService.updateStore(id, storeData);
  }

  // Employee Types
  @Post(':id/employee-types')
  @ApiOperation({
    summary: 'Tạo loại nhân viên',
    description: 'Ví dụ: Full-time, Part-time, Thử việc',
  })
  @ApiResponse({
    status: 201,
    description: 'Thành công',
    type: EmployeeTypeResponseDto,
  })
  async createEmployeeType(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createEmployeeType(id, body);
  }

  @Get(':id/employee-types')
  @ApiOperation({ summary: 'Lấy danh sách loại nhân viên của cửa hàng' })
  @ApiResponse({
    status: 200,
    description: 'Danh sách loại nhân viên',
    type: [EmployeeTypeResponseDto],
  })
  async getEmployeeTypes(@Param('id') id: string) {
    return this.storesService.getEmployeeTypes(id);
  }

  // Roles
  @Post(':id/roles')
  @ApiOperation({
    summary: 'Tạo chức vụ/vị trí',
    description: 'Ví dụ: Quản lý, Thu ngân, Pha chế, Bảo vệ',
  })
  @ApiResponse({
    status: 201,
    description: 'Thành công',
    type: StoreRoleResponseDto,
  })
  async createRole(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createRole(id, body);
  }

  @Get(':id/roles')
  @ApiOperation({ summary: 'Lấy danh sách chức vụ của cửa hàng' })
  @ApiResponse({
    status: 200,
    description: 'Danh sách chức vụ',
    type: [StoreRoleResponseDto],
  })
  async getRoles(@Param('id') id: string) {
    return this.storesService.getRoles(id);
  }

  // --- Role Permission Configs ---

  @Get(':id/permissions/templates')
  @ApiOperation({ summary: 'Lấy danh sách các mẫu phân quyền (Templates)' })
  async getPermissionTemplates(@Param('id') id: string) {
    return this.storesService.getPermissionTemplates(id);
  }

  @Get(':id/roles/:roleId/permissions')
  @ApiOperation({ summary: 'Lấy cấu hình phân quyền của vai trò' })
  @ApiResponse({ status: 200, description: 'Chi tiết cấu hình phân quyền' })
  async getRolePermissionConfig(
    @Param('id') id: string,
    @Param('roleId') roleId: string,
  ) {
    return this.storesService.getRolePermissionConfig(id, roleId);
  }

  @Put(':id/roles/:roleId/permissions')
  @ApiOperation({ summary: 'Cập nhật cấu hình phân quyền cho vai trò' })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công' })
  async updateRolePermissionConfig(
    @Param('id') id: string,
    @Param('roleId') roleId: string,
    @Body() body: StorePermissionConfigDto,
  ) {
    return this.storesService.updateRolePermissionConfig(id, roleId, body);
  }




  // Termination Reasons
  @Post(':id/termination-reasons')
  @ApiOperation({ summary: 'Tạo lý do thôi việc' })
  async createTerminationReason(@Param('id') id: string, @Body('name') name: string) {
    return this.storesService.createTerminationReason(id, name);
  }

  @Get(':id/termination-reasons')
  @ApiOperation({ summary: 'Lấy danh sách lý do thôi việc' })
  async getTerminationReasons(@Param('id') id: string) {
    return this.storesService.getTerminationReasons(id);
  }

  @Put('termination-reasons/:reasonId')
  @ApiOperation({ summary: 'Cập nhật lý do thôi việc' })
  async updateTerminationReason(@Param('reasonId') reasonId: string, @Body('name') name: string) {
    return this.storesService.updateTerminationReason(reasonId, name);
  }

  @Delete('termination-reasons/:reasonId')
  @ApiOperation({ summary: 'Xóa lý do thôi việc' })
  async deleteTerminationReason(@Param('reasonId') reasonId: string) {
    return this.storesService.deleteTerminationReason(reasonId);
  }

  // --- Store Skills ---

  @Post(':id/skills')
  @ApiOperation({ summary: 'Tạo kỹ năng mới cho cửa hàng' })
  @ApiResponse({ status: 201, type: StoreSkillResponseDto })
  async createSkill(
    @Param('id') id: string,
    @Body() data: CreateStoreSkillDto,
  ) {
    return this.storesService.createSkill(id, data);
  }

  @Get(':id/skills')
  @ApiOperation({ summary: 'Lấy danh sách kỹ năng của cửa hàng' })
  @ApiResponse({ status: 200, type: [StoreSkillResponseDto] })
  async getSkills(@Param('id') id: string) {
    return this.storesService.getSkills(id);
  }

  @Put('skills/:skillId')
  @ApiOperation({ summary: 'Cập nhật kỹ năng' })
  @ApiResponse({ status: 200, type: StoreSkillResponseDto })
  async updateSkill(
    @Param('skillId') skillId: string,
    @Body() data: UpdateStoreSkillDto,
  ) {
    return this.storesService.updateSkill(skillId, data);
  }

  @Delete('skills/:skillId')
  @ApiOperation({ summary: 'Xóa kỹ năng' })
  @ApiResponse({ status: 200 })
  async deleteSkill(@Param('skillId') skillId: string) {
    return this.storesService.deleteSkill(skillId);
  }

  @Post('employees/:profileId/skill')
  @ApiOperation({ summary: 'Gắn kỹ năng cho nhân viên' })
  @ApiBody({ schema: { properties: { skillId: { type: 'string', nullable: true } } } })
  @ApiResponse({ status: 200 })
  async assignSkillToEmployee(
    @Param('profileId') profileId: string,
    @Body('skillId') skillId: string | null,
  ) {
    return this.storesService.assignSkillToEmployee(profileId, skillId);
  }

  @Get('employees/:profileId/skill')
  @ApiOperation({ summary: 'Lấy kỹ năng của một nhân viên' })
  @ApiResponse({ status: 200, type: StoreSkillResponseDto })
  async getEmployeeSkill(@Param('profileId') profileId: string) {
    return this.storesService.getEmployeeSkill(profileId);
  }

  // Probation Settings
  @Get(':id/probation-settings')
  @ApiOperation({ summary: 'Lấy cấu hình lộ trình thử việc' })
  async getProbationSetting(@Param('id') id: string) {
    return this.storesService.getProbationSetting(id);
  }

  @Put(':id/probation-settings')
  @ApiOperation({ summary: 'Cập nhật cấu hình lộ trình thử việc' })
  async updateProbationSetting(@Param('id') id: string, @Body() body: StoreProbationSettingDto) {
    return this.storesService.upsertProbationSetting(id, body);
  }

  // Approval Settings
  @Get(':id/approval-settings')
  @ApiOperation({ summary: 'Lấy cấu hình phê duyệt' })
  async getApprovalSetting(@Param('id') id: string) {
    return this.storesService.getApprovalSetting(id);
  }

  @Put(':id/approval-settings')
  @ApiOperation({ summary: 'Cập nhật cấu hình phê duyệt' })
  async updateApprovalSetting(@Param('id') id: string, @Body() body: StoreApprovalSettingDto) {
    return this.storesService.upsertApprovalSetting(id, body);
  }

  // Timekeeping Settings
  @Get(':id/timekeeping-settings')
  @ApiOperation({ summary: 'Lấy cấu hình chấm công' })
  async getTimekeepingSetting(@Param('id') id: string) {
    return this.storesService.getTimekeepingSetting(id);
  }

  @Put(':id/timekeeping-settings')
  @ApiOperation({ summary: 'Cập nhật cấu hình chấm công' })
  async updateTimekeepingSetting(@Param('id') id: string, @Body() body: StoreTimekeepingSettingDto) {
    return this.storesService.upsertTimekeepingSetting(id, body);
  }

  // Shift Config (Ca làm việc)
  @Get(':id/shift-config')
  @ApiOperation({ summary: 'Lấy cấu hình ca làm việc' })
  async getShiftConfig(@Param('id') id: string) {
    return this.storesService.getShiftConfig(id);
  }

  @Put(':id/shift-config')
  @ApiOperation({ summary: 'Cập nhật cấu hình ca làm việc' })
  async updateShiftConfig(@Param('id') id: string, @Body() body: UpdateStoreShiftConfigDto) {
    return this.storesService.upsertShiftConfig(id, body);
  }


  // Payroll Settings
  @Get(':id/payroll-settings')
  @ApiOperation({ summary: 'Lấy cấu hình tính lương' })
  async getPayrollSetting(@Param('id') id: string) {
    return this.storesService.getPayrollSetting(id);
  }

  @Put(':id/payroll-settings')
  @ApiOperation({ summary: 'Cập nhật cấu hình tính lương' })
  async updatePayrollSetting(@Param('id') id: string, @Body() body: UpdatePayrollSettingDto) {
    return this.storesService.upsertPayrollSetting(id, body);
  }




  // Employees
  @Post(':id/employees')
  @ApiOperation({
    summary: 'Thêm nhân viên vào cửa hàng',
    description: 'Liên kết một tài khoản đã tồn tại vào cửa hàng này',
  })
  @ApiResponse({
    status: 201,
    description: 'Thêm nhân viên thành công',
    type: EmployeeProfileResponseDto,
  })
  async addEmployee(
    @Param('id') id: string,
    @Body('accountId') accountId: string,
    @Body() body: any,
  ) {
    return this.storesService.addEmployee(id, accountId, body);
  }

  @Get(':id/employees')
  @ApiOperation({ summary: 'Lấy danh sách nhân viên của cửa hàng' })
  @ApiQuery({ name: 'typeName', required: false, description: 'Lọc theo tên loại hình nhân viên (VD: Full-time, Part-time)' })
  @ApiResponse({
    status: 200,
    description: 'Danh sách nhân viên và thống kê tổng hợp',
    type: EmployeesWithStatisticsResponseDto,
  })
  async getEmployees(
    @GetUser() user: any,
    @Param('id') id: string,
    @Query('typeName') typeName?: string,
    @Query('isDeleted') isDeleted?: string,
  ) {
    const sanitizedId = id?.split('?')[0];
    const isDeletedBool = isDeleted === 'true';
    return this.storesService.getEmployees(user.userId, sanitizedId, typeName, isDeletedBool);
  }

  @Post('employees/manual')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'avatar', maxCount: 1 },
        { name: 'frontIdentification', maxCount: 1 },
        { name: 'backIdentification', maxCount: 1 },
        { name: 'contractFile', maxCount: 1 },
      ],
      multerConfig,
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Thêm nhân viên thủ công',
    description:
      'Tạo tài khoản và hồ sơ nhân viên trực tiếp (Dành cho Admin/Owner)',
  })
  @ApiResponse({
    status: 201,
    description: 'Tạo nhân viên thành công',
    type: EmployeeProfileResponseDto,
  })
  async createManualEmployee(
    @Body() dto: CreateManualEmployeeDto,
    @UploadedFiles()
    files: {
      avatar?: Express.Multer.File[];
      frontIdentification?: Express.Multer.File[];
      backIdentification?: Express.Multer.File[];
      contractFile?: Express.Multer.File[];
    },
  ) {
    const fileUrls = {
      avatarUrl: files.avatar?.[0]
        ? `/uploads/${files.avatar[0].filename}`
        : undefined,
      frontIdentificationUrl: files.frontIdentification?.[0]
        ? `/uploads/${files.frontIdentification[0].filename}`
        : undefined,
      backIdentificationUrl: files.backIdentification?.[0]
        ? `/uploads/${files.backIdentification[0].filename}`
        : undefined,
      contractFileUrl: files.contractFile?.[0]
        ? `/uploads/${files.contractFile[0].filename}`
        : undefined,
    };

    const mergedDto: any = { ...dto, ...fileUrls };

    // Parse assetIds if it is a string
    if (typeof mergedDto.assetIds === 'string') {
      try {
        mergedDto.assetIds = JSON.parse(mergedDto.assetIds);
      } catch (e) {
        // If not JSON, treat as a single ID in an array
        mergedDto.assetIds = [mergedDto.assetIds];
      }
    }

    // Parse contract JSON if it is a string
    if (typeof mergedDto.contract === 'string') {
      try {
        mergedDto.contract = JSON.parse(mergedDto.contract);
      } catch (e) {
        // Keep as is if parsing fails
      }
    }

    if (fileUrls.contractFileUrl) {
      mergedDto.contract = {
        ...(mergedDto.contract || {}),
        contractFileUrl: fileUrls.contractFileUrl,
      };
    }

    return this.storesService.createManualEmployee(
      mergedDto,
      this.accountsService,
      this.mailService,
    );
  }

  @Get('employees/:profileId')
  @ApiOperation({
    summary: 'Lấy thông tin hồ sơ nhân viên',
    description: 'Lấy chi tiết Profile nhân viên bằng ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Thông tin hồ sơ nhân viên chi tiết',
    type: EmployeeDetailResponseDto,
  })
  async getEmployeeById(@Param('profileId') profileId: string) {
    const result = await this.storesService.getEmployeeById(profileId);
    if (!result) {
      throw new NotFoundException('Không tìm thấy nhân viên');
    }
    return result;
  }

  @Get(':id/me/personal-info')
  @ApiOperation({
    summary: 'Lấy thông tin cá nhân của người dùng tại cửa hàng hiện tại',
    description: 'Lấy các thông tin cá nhân như Họ tên, Giới tính, CCCD, Ngân hàng... theo ngữ cảnh của cửa hàng (Role và StoreName)',
  })
  @ApiResponse({
    status: 200,
    description: 'Thông tin cá nhân chi tiết',
    type: EmployeePersonalInfoResponseDto,
  })
  async getMyPersonalInfo(@GetUser() user: any, @Param('id') id: string) {
    const result = await this.storesService.getMyPersonalInfoInStore(id, user.userId);
    if (!result) {
      throw new NotFoundException('Không tìm thấy thông tin');
    }
    return result;
  }

  @Put(':id/me/personal-info')
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'avatar', maxCount: 1 },
    { name: 'frontImage', maxCount: 1 },
    { name: 'backImage', maxCount: 1 },
  ], multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Cập nhật thông tin cá nhân của người dùng hiện tại (kèm ảnh)',
    description: 'Cập nhật các trường thông tin Họ tên, SĐT, Email, CCCD, Ngân hàng và tải lên ảnh avatar, CCCD mặt trước/sau.',
  })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật thành công',
  })
  async updateMyPersonalInfo(
    @GetUser() user: any,
    @Body() body: UpdatePersonalInfoDto,
    @UploadedFiles() files: { avatar?: Express.Multer.File[], frontImage?: Express.Multer.File[], backImage?: Express.Multer.File[] }
  ) {
    const data: any = { ...body };
    if (files.avatar?.[0]) data.avatar = `/uploads/${files.avatar[0].filename}`;
    if (files.frontImage?.[0]) data.frontImage = `/uploads/${files.frontImage[0].filename}`;
    if (files.backImage?.[0]) data.backImage = `/uploads/${files.backImage[0].filename}`;

    return this.storesService.updateMyPersonalInfoInStore(user.userId, data);
  }






  @Delete('employees/:profileId')
  @ApiOperation({
    summary: 'Xóa nhân viên (Soft Delete)',
    description: 'Cập nhật trạng thái terminated và thực hiện soft delete nhân viên. Yêu cầu mật khẩu xác nhận.',
  })
  @ApiResponse({
    status: 200,
    description: 'Nhân viên đã được xóa thành công',
  })
  async deleteEmployee(
    @GetUser() user: any,
    @Param('profileId') profileId: string,
    @Body() body: DeleteEmployeeDto,
  ) {
    // 1. Xác thực mật khẩu người đang xóa
    const isPasswordCorrect = await this.accountsService.verifyPassword(
      user.userId,
      body.password,
    );

    if (!isPasswordCorrect) {
      throw new UnauthorizedException('Mật khẩu không chính xác');
    }

    // 2. Thực hiện xóa
    return this.storesService.deleteEmployee(profileId, body.reasonId);
  }

  @Delete('employees/:profileId/permanent')
  @ApiOperation({
    summary: 'Xóa nhân viên vĩnh viễn',
    description: 'Xóa hoàn toàn dữ liệu nhân viên khỏi hệ thống. Yêu cầu mật khẩu xác nhận.',
  })
  @ApiResponse({
    status: 200,
    description: 'Nhân viên đã được xóa vĩnh viễn',
  })
  async permanentDeleteEmployee(
    @GetUser() user: any,
    @Param('profileId') profileId: string,
    @Body() body: PermanentDeleteEmployeeDto,
  ) {
    // 1. Xác thực mật khẩu
    const isPasswordCorrect = await this.accountsService.verifyPassword(
      user.userId,
      body.password,
    );

    if (!isPasswordCorrect) {
      throw new UnauthorizedException('Mật khẩu không chính xác');
    }

    // 2. Thực hiện xóa vĩnh viễn
    return this.storesService.permanentDeleteEmployee(profileId);
  }

  @Post('employees/:profileId/restore')
  @ApiOperation({
    summary: 'Khôi phục nhân viên',
    description: 'Khôi phục nhân viên đã bị soft delete quay lại trạng thái active.',
  })
  @ApiResponse({
    status: 200,
    description: 'Nhân viên đã được khôi phục thành công',
  })
  async restoreEmployee(@Param('profileId') profileId: string) {
    return this.storesService.restoreEmployee(profileId);
  }

  @Get('employees/:profileId/performance')
  @ApiOperation({
    summary: 'Lấy báo cáo hiệu suất và lộ trình thăng tiến của nhân viên',
    description: 'Bao gồm điểm hiệu suất, giờ làm, KPI, thâm niên và lộ trình thăng tiến sắp tới',
  })
  @ApiResponse({
    status: 200,
    description: 'Báo cáo hiệu suất chi tiết',
    type: EmployeePerformanceReportResponseDto,
  })
  async getEmployeePerformance(@Param('profileId') profileId: string) {
    return this.storesService.getEmployeePerformance(profileId);
  }

  @Get('employees/:profileId/progression')
  @ApiOperation({
    summary: 'Lấy lộ trình thăng tiến chi tiết',
    description: 'Trả về danh sách các giai đoạn thăng tiến, yêu cầu và tiến độ hiện tại',
  })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết lộ trình thăng tiến',
    type: [ProgressionStageDto],
  })
  async getEmployeeProgression(@Param('profileId') profileId: string) {
    return this.storesService.getEmployeeProgression(profileId);
  }

  @Post('employees/contracts/:contractId/renew')
  @ApiOperation({
    summary: 'Gia hạn hợp đồng',
    description: 'Archive hợp đồng cũ và tạo hợp đồng mới với thông tin cập nhật',
  })
  @ApiResponse({
    status: 201,
    description: 'Hợp đồng mới đã được tạo',
    type: ContractResponseDto,
  })
  async renewContract(
    @Param('contractId') contractId: string,
    @Body() body: RenewContractDto,
  ) {
    return this.storesService.renewContract(contractId, body);
  }

  @Put('employees/contracts/:contractId')
  @ApiOperation({
    summary: 'Cập nhật thông tin hợp đồng',
    description: 'Chỉnh sửa trực tiếp thông tin trên hợp đồng (Sửa sai, bổ sung thông tin)',
  })
  @ApiResponse({
    status: 200,
    description: 'Hợp đồng đã được cập nhật',
    type: ContractResponseDto,
  })
  async updateContract(
    @Param('contractId') contractId: string,
    @Body() body: UpdateDetailsContractDto,
  ) {
    return this.storesService.updateContract(contractId, body);
  }

  @Get('employees/:profileId/schedule')
  @ApiOperation({
    summary: 'Lấy lịch làm việc chi tiết (Tháng hiện tại)',
    description: 'Bao gồm: Lịch ca làm, Danh sách đăng ký ca, Đổi ca, và Nghỉ phép',
  })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết lịch làm việc',
    type: EmployeeScheduleDetailsDto,
  })
  @ApiQuery({ name: 'month', required: false, type: String, description: 'YYYY-MM-DD (Mặc định là tháng hiện tại)' })
  async getEmployeeSchedule(
    @Param('profileId') profileId: string,
    @Query('month') monthString?: string,
  ) {
    const month = monthString ? new Date(monthString) : new Date();
    return this.storesService.getEmployeeScheduleDetails(profileId, month);
  }

  @Post('approvals/:requestId')
  @ApiOperation({
    summary: 'Duyệt/Từ chối yêu cầu (Đăng ký ca, Đổi ca, Nghỉ phép)',
    description: 'Xử lý các loại yêu cầu từ nhân viên',
  })
  @ApiResponse({
    status: 200,
    description: 'Kết quả xử lý',
  })
  async processApproval(
    @Req() req,
    @Param('requestId') requestId: string,
    @Body() body: ApprovalRequestDto,
  ) {
    // Resolve the authenticated user's profile from their account ID
    const accountId = req.user?.userId || req.user?.id;
    let managerProfileId = 'unknown';
    if (accountId) {
      const profile = await this.storesService.getEmployeeByAccountId(accountId);
      if (profile) managerProfileId = profile.id;
    }

    return this.storesService.processRequest(
      managerProfileId,
      requestId,
      body.type,
      body.status,
      body.reason
    );
  }


  // --- Employee Asset Management ---

  @Get('employees/:profileId/assets')
  @ApiOperation({
    summary: 'Lấy danh sách tài sản của nhân viên',
    description: 'Lấy các tài sản đang được cấp phát cho nhân viên theo profileId',
  })
  async getEmployeeAssets(@Param('profileId') profileId: string) {
    return this.storesService.getEmployeeAssets(profileId);
  }

  @Post('employees/:profileId/assets/assign')
  @ApiOperation({
    summary: 'Cấp tài sản cho nhân viên',
    description: 'Tạo bản ghi cấp phát tài sản mới và trừ tồn kho',
  })
  async assignAsset(
    @Param('profileId') profileId: string,
    @Body() body: AssignAssetDto,
    @Req() req,
  ) {
    // Temporal manager ID
    const managerProfileId = 'ec7e3feb-985c-416a-870c-88c470a17ac6'; 
    return this.storesService.assignAssetToEmployee(
      profileId,
      body.assetId,
      body.quantity,
      body.note,
      managerProfileId,
      body.dueDate,
    );
  }

  @Put('employees/assets/:assignmentId/exchange')
  @ApiOperation({
    summary: 'Đổi tài sản (Trả A lấy B)',
    description: 'Thu hồi tài sản đang sử dụng và cấp phát tài sản mới cho nhân viên',
  })
  async exchangeAsset(
    @Param('assignmentId') assignmentId: string,
    @Body() body: ExchangeAssetDto,
    @Req() req,
  ) {
    const managerProfileId = 'ec7e3feb-985c-416a-870c-88c470a17ac6';
    return this.storesService.exchangeAsset(
      assignmentId,
      body.newAssetId,
      body.quantity || 1,
      body.note,
      managerProfileId,
      body.dueDate,
    );
  }

  @Put('employees/assets/:assignmentId/return')
  @ApiOperation({
    summary: 'Thu hồi tài sản',
    description: 'Cập nhật trạng thái thu hồi tài sản và hoàn lại tồn kho nếu cần',
  })
  async returnAsset(
    @Param('assignmentId') assignmentId: string,
    @Body() body: ReturnAssetDto,
  ) {
    return this.storesService.returnAsset(
      assignmentId,
      body.status,
      body.returnNote,
    );
  }

  @Post('employees/assets/:assignmentId/reassign')
  @ApiOperation({
    summary: 'Cấp lại tài sản',
    description: 'Cấp lại một tài sản đã từng được thu hồi trước đó cho nhân viên',
  })
  async reassignAsset(
    @Param('assignmentId') assignmentId: string,
    @Body() body: ReassignAssetDto,
    @Req() req,
  ) {
    const managerProfileId = 'ec7e3feb-985c-416a-870c-88c470a17ac6';
    return this.storesService.reassignAsset(
      assignmentId,
      body.quantity,
      body.note,
      managerProfileId,
      body.dueDate,
    );
  }

  @Post('employees/basic-info')
  @ApiOperation({ 
    summary: 'Lấy thông tin cơ bản của danh sách nhân viên',
    description: 'Truyền vào mảng IDs để lấy Tên, Ảnh, Vai trò và Loại nhân viên'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          example: ['eb3c9aaa-099e-4425-a12e-02f6dc2672f4']
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Danh sách thông tin cơ bản nhân viên',
    type: [EmployeeBasicInfoResponseDto],
  })
  async getEmployeesBasicInfo(@Body('ids') ids: string[]) {
    return this.storesService.getEmployeesBasicInfo(ids);
  }

  @Get(':id/employees/monthly-summaries')
  @ApiOperation({
    summary: 'Lấy thống kê tháng của nhân viên',
    description: 'Lấy thống kê chấm công và lương tạm tính theo tháng cho tất cả nhân viên trong cửa hàng',
  })
  @ApiQuery({
    name: 'month',
    required: false,
    description: 'Tháng cần lấy (YYYY-MM-DD), mặc định là tháng hiện tại',
    example: '2026-01-01',
  })
  @ApiResponse({
    status: 200,
    description: 'Danh sách thống kê tháng của nhân viên',
    type: [EmployeeMonthlySummaryResponseDto],
  })
  async getEmployeeMonthlySummaries(
    @Param('id') storeId: string,
    @Query('month') month?: string,
  ) {
    return this.storesService.getEmployeeMonthlySummaries(storeId, month);
  }

  @Post('profiles/:profileId/roles/:roleId')
  @ApiOperation({
    summary: 'Gán chức vụ cho nhân viên',
    description: 'Gán một Role cụ thể cho hồ sơ nhân viên',
  })
  @ApiResponse({
    status: 200,
    description: 'Gán chức vụ thành công',
    type: EmployeeProfileResponseDto,
  })
  async assignRole(
    @Param('profileId') profileId: string,
    @Param('roleId') roleId: string,
    @GetUser() user: any,
  ) {
    return this.storesService.assignRoleToEmployee(
      profileId,
      roleId,
      user.userId,
    );
  }

  // Contracts
  @Post('employees/:profileId/contracts')
  @UseInterceptors(FileInterceptor('contractFile', multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Ký hợp đồng nhân viên',
    description: 'Tải lên hợp đồng lao động và thông tin lương thưởng',
  })
  @ApiResponse({
    status: 201,
    description: 'Hợp đồng được tạo thành công',
    type: ContractResponseDto,
  })
  async createContract(
    @Param('profileId') profileId: string,
    @Body() body: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const data = { ...body };
    if (file) {
      data.fileUrl = `/uploads/${file.filename}`;
    }
    return this.storesService.createContract(profileId, data);
  }

  @Get('employees/:profileId/contracts/latest')
  @ApiOperation({
    summary: 'Lấy hợp đồng mới nhất',
    description: 'Lấy thông tin hợp đồng hiện tại của nhân viên',
  })
  @ApiResponse({
    status: 200,
    description: 'Hợp đồng hiện tại',
    type: ContractResponseDto,
  })
  async getLatestContract(@Param('profileId') profileId: string) {
    return this.storesService.getLatestContract(profileId);
  }

  // Work Shifts
  @Post(':id/work-shifts')
  @ApiOperation({
    summary: 'Tạo ca làm việc',
    description: 'Ví dụ: Ca sáng (8h-12h), Ca chiều (13h-17h)',
  })
  @ApiResponse({
    status: 201,
    description: 'Thành công',
    type: WorkShiftResponseDto,
  })
  async createWorkShift(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createWorkShift(id, body);
  }

  @Get(':id/work-shifts')
  @ApiOperation({ summary: 'Lấy danh sách các ca làm việc của cửa hàng' })
  @ApiResponse({
    status: 200,
    description: 'Danh sách ca làm việc',
    type: [WorkShiftResponseDto],
  })
  async getWorkShifts(@Param('id') id: string) {
    return this.storesService.getWorkShifts(id);
  }

  @Put(':storeId/work-shifts/:shiftId')
  @ApiOperation({
    summary: 'Cập nhật ca làm việc',
    description: 'Cập nhật thông tin ca làm việc (tên, giờ bắt đầu, giờ kết thúc, ghi chú)',
  })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật thành công',
    type: WorkShiftResponseDto,
  })
  async updateWorkShift(
    @Param('storeId') storeId: string,
    @Param('shiftId') shiftId: string,
    @Body() body: any,
  ) {
    return this.storesService.updateWorkShift(storeId, shiftId, body);
  }

  // ==================== WORK CYCLE MANAGEMENT ====================

  @Get(':id/active-cycle')
  @ApiOperation({ 
    summary: 'Lấy chu kỳ đang hoạt động',
    description: 'Mỗi cửa hàng chỉ có 1 chu kỳ active tại 1 thời điểm' 
  })
  @ApiResponse({ status: 200, description: 'Chu kỳ đang active hoặc null' })
  async getActiveCycle(@Param('id') storeId: string) {
    return this.storesService.getActiveCycle(storeId);
  }

  @Post(':id/work-cycles')
  @ApiOperation({
    summary: 'Tạo chu kỳ làm việc',
    description: 'Tạo chu kỳ mới. Phải dừng chu kỳ cũ trước khi tạo mới. Hỗ trợ 4 loại: DAILY, WEEKLY, MONTHLY, INDEFINITE',
  })
  @ApiResponse({ status: 201, description: 'Tạo thành công' })
  async createWorkCycle(@Param('id') storeId: string, @Body() body: any) {
    return this.storesService.createWorkCycle(storeId, body);
  }

  @Get(':id/work-cycles')
  @ApiOperation({ summary: 'Lấy danh sách chu kỳ làm việc' })
  @ApiResponse({ status: 200, description: 'Danh sách chu kỳ' })
  async getWorkCycles(@Param('id') storeId: string) {
    return this.storesService.getWorkCycles(storeId);
  }

  @Get('work-cycles/:cycleId')
  @ApiOperation({ summary: 'Lấy chi tiết chu kỳ làm việc' })
  @ApiResponse({ status: 200, description: 'Chi tiết chu kỳ với slots và assignments' })
  async getWorkCycleById(@Param('cycleId') cycleId: string) {
    return this.storesService.getWorkCycleById(cycleId);
  }

  @Put('work-cycles/:cycleId')
  @ApiOperation({ summary: 'Cập nhật chu kỳ làm việc' })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công' })
  async updateWorkCycle(
    @Param('cycleId') cycleId: string,
    @Body() body: any,
  ) {
    return this.storesService.updateWorkCycle(cycleId, body);
  }

  @Put('work-cycles/:cycleId/stop')
  @ApiOperation({
    summary: 'Dừng chu kỳ làm việc',
    description: 'Dừng chu kỳ ngay lập tức hoặc hẹn giờ dừng. Dữ liệu lịch sử được giữ lại.',
  })
  @ApiResponse({ status: 200, description: 'Dừng thành công' })
  async stopWorkCycle(
    @Param('cycleId') cycleId: string,
    @Body() body: { stopImmediately?: boolean; scheduledStopAt?: string },
  ) {
    return this.storesService.stopWorkCycle(cycleId, body);
  }

  @Put('work-cycles/:cycleId/activate')
  @ApiOperation({
    summary: 'Kích hoạt chu kỳ làm việc',
    description: 'Chuyển chu kỳ từ DRAFT sang ACTIVE. Kiểm tra không có chu kỳ khác đang active.',
  })
  @ApiResponse({ status: 200, description: 'Kích hoạt thành công' })
  async activateWorkCycle(@Param('cycleId') cycleId: string) {
    return this.storesService.activateWorkCycle(cycleId);
  }

  // ==================== SHIFT SLOT MANAGEMENT ====================

  @Post('work-cycles/:cycleId/slots')
  @ApiOperation({
    summary: 'Tạo slot ca làm việc',
    description: 'Tạo các slot ca cho từng ngày trong chu kỳ (bulk create)',
  })
  @ApiResponse({ status: 201, description: 'Tạo thành công' })
  async createShiftSlots(
    @Param('cycleId') cycleId: string,
    @Body() body: { slots: any[] },
  ) {
    return this.storesService.createShiftSlots(cycleId, body.slots);
  }

  @Get('work-cycles/:cycleId/slots')
  @ApiOperation({ summary: 'Lấy danh sách slot ca trong chu kỳ' })
  @ApiResponse({ status: 200, description: 'Danh sách slot' })
  async getShiftSlots(@Param('cycleId') cycleId: string) {
    return this.storesService.getShiftSlots(cycleId);
  }

  @Put('shift-slots/:slotId')
  @ApiOperation({ summary: 'Cập nhật slot ca' })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công' })
  async updateShiftSlot(
    @Param('slotId') slotId: string,
    @Body() body: any,
  ) {
    return this.storesService.updateShiftSlot(slotId, body);
  }

  @Delete('shift-slots/:slotId')
  @ApiOperation({ summary: 'Xóa slot ca' })
  @ApiResponse({ status: 200, description: 'Xóa thành công' })
  async deleteShiftSlot(@Param('slotId') slotId: string) {
    return this.storesService.deleteShiftSlot(slotId);
  }

  // ==================== STORE SHIFT SLOTS (Staff App Calendar) ====================

  @Get(':id/store-shift-slots')
  @ApiOperation({
    summary: 'Lấy tất cả shift slots của cửa hàng (cho staff app lịch ca)',
    description: 'Trả về tất cả slots với workShift info, assignments, capacity. Dùng cho staff app hiển thị lịch ca cửa hàng.',
  })
  @ApiQuery({ name: 'startDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'endDate', required: false, description: 'YYYY-MM-DD' })
  async getStoreShiftSlots(
    @Param('id') storeId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.storesService.getStoreShiftSlots(storeId, startDate, endDate);
  }

  // ==================== SHIFT ASSIGNMENT MANAGEMENT ====================

  @Post('shift-slots/:slotId/register')
  @ApiOperation({
    summary: 'Đăng ký/gắn nhân viên vào slot ca',
    description: 'Nhân viên đăng ký hoặc Owner gắn nhân viên vào ca',
  })
  @ApiResponse({ status: 201, description: 'Đăng ký thành công' })
  async registerToShiftSlot(
    @Param('slotId') slotId: string,
    @Body() body: { employeeId: string; note?: string; isOwnerAssign?: boolean },
  ) {
    return this.storesService.registerToShiftSlot(slotId, body.employeeId, body.note, body.isOwnerAssign || false);
  }

  @Get(':id/shift-assignments')
  @ApiOperation({ summary: 'Lấy danh sách đăng ký ca của cửa hàng' })
  @ApiQuery({ name: 'cycleId', required: false, description: 'Lọc theo chu kỳ' })
  @ApiQuery({ name: 'status', required: false, description: 'Lọc theo trạng thái' })
  @ApiResponse({ status: 200, description: 'Danh sách đăng ký' })
  async getShiftAssignments(
    @Param('id') storeId: string,
    @Query('cycleId') cycleId?: string,
    @Query('status') status?: string,
  ) {
    return this.storesService.getShiftAssignments(storeId, { cycleId, status });
  }

  @Put('shift-assignments/:assignmentId/status')
  @ApiOperation({
    summary: 'Duyệt/Từ chối đăng ký ca',
    description: 'Owner thay đổi trạng thái: CONFIRMED hoặc CANCELLED',
  })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công' })
  async updateAssignmentStatus(
    @Param('assignmentId') assignmentId: string,
    @Body() body: { status: string; note?: string },
  ) {
    return this.storesService.updateAssignmentStatus(assignmentId, body.status, body.note);
  }

  // ==================== SHIFT SWAP MANAGEMENT ====================

  @Post('shift-swaps')
  @ApiOperation({
    summary: 'Tạo yêu cầu đổi ca',
    description: 'Nhân viên yêu cầu đổi ca với nhân viên khác',
  })
  @ApiResponse({ status: 201, description: 'Tạo yêu cầu thành công' })
  async createShiftSwap(@Body() body: any) {
    return this.storesService.createShiftSwap(body);
  }

  @Put('shift-swaps/:swapId/status')
  @ApiOperation({
    summary: 'Duyệt/Từ chối yêu cầu đổi ca',
    description: 'Owner hoặc nhân viên được đổi xác nhận',
  })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công' })
  async updateShiftSwapStatus(
    @Param('swapId') swapId: string,
    @Body() body: { status: string; note?: string },
  ) {
    return this.storesService.updateShiftSwapStatus(swapId, body.status, body.note);
  }

  // Assets
  @Post(':id/assets')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(AssetMultipartInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Thêm tài sản (Bulk Create)',
    description: 'Thêm một hoặc nhiều tài sản cùng lúc kèm ảnh (avatar_0, invoice_0...)',
  })
  @ApiResponse({
    status: 201,
    description: 'Tài sản được tạo thành công',
    type: AssetResponseDto,
  })
  async uploadStoreAssetsBulk(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const assetsStr = req.body?.assets;
    const files = req.files || [];
    
    let assetsData = [];
    try {
      assetsData = JSON.parse(assetsStr);
      if (!Array.isArray(assetsData)) throw new Error();
    } catch (e) {
      throw new BadRequestException('Trường "assets" phải là một chuỗi JSON Array hợp lệ');
    }

    return this.storesService.createAssetsBulk(id, assetsData, files);
  }

  @Get('assets/report')
  @ApiOperation({ summary: 'Báo cáo tổng hợp tài sản (Dashboard)' })
  async getAssetReport(
    @Query('storeId') storeId: string,
    @Query('date') date?: string, // YYYY-MM-DD
    @Query('assetStatusId') assetStatusId?: string,
  ) {
    if (!storeId) throw new BadRequestException('storeId là bắt buộc');
    return this.storesService.getAssetReport(storeId, { date, assetStatusId });
  }

  @Get('assets/export-report')
  @ApiOperation({ summary: 'Báo cáo tổng hợp xuất kho tài sản' })
  async getAssetExportReport(
    @Query('storeId') storeId: string,
    @Query('date') date?: string, // YYYY-MM-DD
    @Query('assetExportTypeId') assetExportTypeId?: string,
  ) {
    if (!storeId) throw new BadRequestException('storeId là bắt buộc');
    return this.storesService.getAssetExportReport(storeId, { date, assetExportTypeId });
  }

  // --- Hàng hóa (Product) Reports ---

  @Get('products/report')
  @ApiOperation({ summary: 'Báo cáo tổng hợp hàng hóa (Dashboard)' })
  async getProductReport(
    @Query('storeId') storeId: string,
    @Query('date') date?: string,
    @Query('productStatusId') productStatusId?: string,
  ) {
    if (!storeId) throw new BadRequestException('storeId là bắt buộc');
    return this.storesService.getProductReport(storeId, { date, productStatusId });
  }

  @Get('products/export-report')
  @ApiOperation({ summary: 'Báo cáo tổng hợp xuất kho hàng hóa' })
  async getProductExportReport(
    @Query('storeId') storeId: string,
    @Query('date') date?: string,
    @Query('productExportTypeId') productExportTypeId?: string,
  ) {
    if (!storeId) throw new BadRequestException('storeId là bắt buộc');
    return this.storesService.getProductExportReport(storeId, { date, productExportTypeId });
  }

  @Get(':id/product-export-types')
  @ApiOperation({ summary: 'Lấy danh sách loại xuất kho hàng hóa' })
  async getProductExportTypes(@Param('id') id: string) {
    return this.storesService.getProductExportTypes(id);
  }

  @Post(':id/product-export-types')
  @ApiOperation({ summary: 'Tạo loại xuất kho hàng hóa' })
  async createProductExportType(
    @Param('id') id: string,
    @Body() body: CreateProductExportTypeDto,
  ) {
    return this.storesService.createProductExportType(id, body);
  }

  @Post('products/export')
  @UseInterceptors(AnyFilesInterceptor(multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Xuất kho hàng hóa hàng loạt' })
  async exportProductsBulk(
    @Body() body: any,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    let data = body;
    if (typeof body.items === 'string') {
      try {
        data = { items: JSON.parse(body.items) };
      } catch (e) {
        throw new BadRequestException('Trường "items" phải là một chuỗi JSON Array hợp lệ');
      }
    }
    return this.storesService.exportProductsBulk(data, files);
  }

  @Delete('stock-transactions/:transactionId')
  @ApiOperation({ summary: 'Xóa giao dịch kho và hoàn tác tồn kho' })
  @ApiResponse({ status: 200, description: 'Xóa thành công' })
  async deleteStockTransaction(
    @Param('transactionId') transactionId: string
  ) {
    return this.storesService.deleteStockTransaction(transactionId);
  }




  @Get(':id/asset-export-types')
  @ApiOperation({ summary: 'Lấy danh sách loại xuất kho tài sản' })
  async getAssetExportTypes(@Param('id') id: string) {
    return this.storesService.getAssetExportTypes(id);
  }

  @Post(':id/asset-export-types')
  @ApiOperation({ summary: 'Tạo loại xuất kho tài sản' })
  async createAssetExportType(
    @Param('id') id: string,
    @Body() body: CreateAssetExportTypeDto,
  ) {
    return this.storesService.createAssetExportType(id, body);
  }

  @Post('assets/export')
  @UseInterceptors(AnyFilesInterceptor(multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Xuất kho tài sản hàng loạt' })
  async exportAssetsBulk(
    @Body() body: any,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const data = { ...body };

    // Xử lý parse JSON cho danh sách items
    if (typeof data.items === 'string') {
      try {
        data.items = JSON.parse(data.items);
      } catch (e) {
        throw new BadRequestException('Trường "items" phải là một chuỗi JSON Array hợp lệ');
      }
    }

    return this.storesService.exportAssetsBulk(data, files);
  }



  @Get(':id/assets')
  @ApiOperation({ summary: 'Lấy danh sách tài sản' })
  @ApiResponse({
    status: 200,
    description: 'Danh sách tài sản',
    type: [AssetResponseDto],
  })
  async getAssets(@Param('id') id: string) {
    return this.storesService.getAssets(id);
  }

  @Put('assets/:assetId')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'avatar', maxCount: 1 },
        { name: 'invoiceFile', maxCount: 1 },
      ],
      multerConfig,
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Cập nhật thông tin tài sản' })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật thành công',
    type: AssetResponseDto,
  })
  async updateAsset(
    @Param('assetId') assetId: string,
    @Body() body: CreateAssetDto,
    @UploadedFiles()
    files: {
      avatar?: Express.Multer.File[];
      invoiceFile?: Express.Multer.File[];
    },
  ) {
    const data: any = { ...body };
    if (files.avatar?.[0])
      data.avatarUrl = `/uploads/${files.avatar[0].filename}`;
    if (files.invoiceFile?.[0])
      data.invoiceFileUrl = `/uploads/${files.invoiceFile[0].filename}`;

    delete data.avatar;
    return this.storesService.updateAsset(assetId, data);
  }

  @Delete('assets/:assetId')
  @ApiOperation({ summary: 'Xóa tài sản' })
  @ApiResponse({ status: 200, description: 'Đã xóa tài sản' })
  async deleteAsset(@Param('assetId') assetId: string) {
    return this.storesService.deleteAsset(assetId);
  }

  // Products
  @Post(':id/products')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(ProductMultipartInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Thêm hàng hóa (Bulk Create)',
    description: 'Thêm một hoặc nhiều hàng hóa cùng lúc kèm ảnh (avatar_0, avatar_1...)',
  })
  @ApiResponse({
    status: 201,
    description: 'Hàng hóa được tạo thành công',
    type: [ProductResponseDto],
  })
  async createProduct(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const productsStr = req.body?.products;
    const files = req.files || [];
    
    let productsData = [];
    try {
      productsData = JSON.parse(productsStr);
      if (!Array.isArray(productsData)) throw new Error();
    } catch (e) {
      throw new BadRequestException('Trường "products" phải là một chuỗi JSON Array hợp lệ');
    }

    return this.storesService.createProductsBulk(id, productsData, files);
  }


  @Get(':id/products')
  @ApiOperation({ summary: 'Lấy danh sách sản phẩm/nguyên liệu' })
  @ApiResponse({
    status: 200,
    description: 'Danh sách sản phẩm',
    type: [ProductResponseDto],
  })
  async getProducts(@Param('id') id: string) {
    return this.storesService.getProducts(id);
  }

  @Put('products/:productId')
  @UseInterceptors(FileInterceptor('avatar', multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Cập nhật sản phẩm/nguyên liệu' })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật thành công',
    type: ProductResponseDto,
  })
  async updateProduct(
    @Param('productId') productId: string,
    @Body() body: CreateProductDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const data: any = { ...body };
    if (file) data.avatarUrl = `/uploads/${file.filename}`;

    delete data.avatar;
    return this.storesService.updateProduct(productId, data);
  }

  @Delete('products/:productId')
  @ApiOperation({ summary: 'Xóa sản phẩm/nguyên liệu' })
  @ApiResponse({ status: 200, description: 'Đã xóa sản phẩm' })
  async deleteProduct(@Param('productId') productId: string) {
    return this.storesService.deleteProduct(productId);
  }

  // Units
  @Post(':id/asset-units')
  @ApiOperation({ summary: 'Tạo đơn vị tính tài sản (Cái, Máy, Bộ...)' })
  @ApiResponse({ status: 201, description: 'Thành công' })
  async createAssetUnit(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createAssetUnit(id, body);
  }

  @Get(':id/asset-units')
  @ApiOperation({ summary: 'Lấy đơn vị tính tài sản' })
  @ApiResponse({ status: 200, description: 'Danh sách đơn vị tính' })
  async getAssetUnits(@Param('id') id: string) {
    return this.storesService.getAssetUnits(id);
  }

  @Post(':id/product-units')
  @ApiOperation({ summary: 'Tạo đơn vị tính sản phẩm (Kg, Lít, Chai...)' })
  @ApiResponse({ status: 201, description: 'Thành công' })
  async createProductUnit(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createProductUnit(id, body);
  }

  @Get(':id/product-units')
  @ApiOperation({ summary: 'Lấy đơn vị tính sản phẩm' })
  @ApiResponse({ status: 200, description: 'Danh sách đơn vị tính' })
  async getProductUnits(@Param('id') id: string) {
    return this.storesService.getProductUnits(id);
  }

  // Categories
  // Categories
  @Post(':id/asset-categories')
  @ApiOperation({ summary: 'Tạo danh mục tài sản' })
  @ApiResponse({ status: 201, description: 'Thành công' })
  async createAssetCategory(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createAssetCategory(id, body);
  }

  @Get(':id/asset-categories')
  @ApiOperation({ summary: 'Lấy danh mục tài sản' })
  @ApiResponse({ status: 200, description: 'Danh sách danh mục tài sản' })
  async getAssetCategories(@Param('id') id: string) {
    return this.storesService.getAssetCategories(id);
  }

  @Post(':id/product-categories')
  @ApiOperation({ summary: 'Tạo danh mục sản phẩm/nguyên liệu' })
  @ApiResponse({ status: 201, description: 'Thành công' })
  async createProductCategory(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createProductCategory(id, body);
  }

  @Get(':id/product-categories')
  @ApiOperation({ summary: 'Lấy danh mục sản phẩm' })
  @ApiResponse({ status: 200, description: 'Danh sách danh mục sản phẩm' })
  async getProductCategories(@Param('id') id: string) {
    return this.storesService.getProductCategories(id);
  }

  // Statuses
  @Post(':id/asset-statuses')
  @ApiOperation({ summary: 'Tạo trạng thái tài sản (Mới, Đang dùng, Hỏng...)' })
  @ApiResponse({ status: 201, description: 'Thành công' })
  async createAssetStatus(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createAssetStatus(id, body);
  }

  @Get(':id/asset-statuses')
  @ApiOperation({ summary: 'Lấy các trạng thái tài sản' })
  @ApiResponse({ status: 200, description: 'Danh sách trạng thái tài sản' })
  async getAssetStatuses(@Param('id') id: string) {
    return this.storesService.getAssetStatuses(id);
  }

  @Post(':id/product-statuses')
  @ApiOperation({ summary: 'Tạo trạng thái sản phẩm' })
  @ApiResponse({ status: 201, description: 'Thành công' })
  async createProductStatus(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createProductStatus(id, body);
  }

  @Get(':id/product-statuses')
  @ApiOperation({ summary: 'Lấy các trạng thái sản phẩm' })
  @ApiResponse({ status: 200, description: 'Danh sách trạng thái sản phẩm' })
  async getProductStatuses(@Param('id') id: string) {
    return this.storesService.getProductStatuses(id);
  }

  // Monthly Payrolls
  @Post(':id/payrolls')
  @ApiOperation({
    summary: 'Tạo bảng lương tháng',
    description: 'Tính toán lương cho toàn bộ nhân viên trong tháng',
  })
  @ApiResponse({
    status: 201,
    description: 'Tạo bảng lương thành công',
    type: PayrollResponseDto,
  })
  async createPayroll(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createPayroll(id, body);
  }

  @Post(':id/payrolls/generate')
  @ApiOperation({
    summary: 'Tạo bảng lương tự động từ dữ liệu chấm công',
    description: 'Aggregate ShiftAssignment, tính lương, áp dụng thưởng/phạt từ payroll rules',
  })
  @ApiResponse({
    status: 201,
    description: 'Bảng lương đã tạo thành công',
    type: PayrollResponseDto,
  })
  async generatePayroll(
    @Param('id') id: string,
    @Body() body: { date?: string },
  ) {
    const date = body.date ? new Date(body.date) : undefined;
    return this.storesService.createMonthlyPayrollForStore(id, date);
  }

  @Post(':id/payrolls/recalculate')
  @ApiOperation({
    summary: 'Tính lại bảng lương từ dữ liệu chấm công',
    description: 'Xóa bảng lương cũ và tính lại từ đầu dựa trên dữ liệu chấm công thực tế',
  })
  @ApiResponse({
    status: 201,
    description: 'Bảng lương đã tính lại thành công',
    type: PayrollResponseDto,
  })
  async recalculatePayroll(
    @Param('id') id: string,
    @Body() body: { date?: string },
  ) {
    const date = body.date ? new Date(body.date) : undefined;
    return this.storesService.recalculatePayroll(id, date);
  }

  @Get(':id/payrolls')
  @ApiOperation({ summary: 'Lấy danh sách bảng lương' })
  @ApiResponse({
    status: 200,
    description: 'Danh sách bảng lương',
    type: [PayrollResponseDto],
  })
  async getPayrolls(@Param('id') id: string) {
    return this.storesService.getPayrolls(id);
  }

  @Get(':id/payrolls/by-month')
  @ApiOperation({ 
    summary: 'Lấy bảng lương theo tháng cụ thể',
    description: 'Lấy bảng lương của cửa hàng theo tháng (format: YYYY-MM-DD, ngày bất kỳ trong tháng)'
  })
  @ApiQuery({ 
    name: 'date', 
    required: true, 
    type: String,
    description: 'Tháng cần lấy (YYYY-MM-DD)',
    example: '2026-01-01'
  })
  @ApiResponse({
    status: 200,
    description: 'Bảng lương tháng',
    type: PayrollResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Không tìm thấy bảng lương cho tháng này',
  })
  async getPayrollByMonth(
    @Param('id') id: string,
    @Query('date') date: string
  ) {
    const payroll = await this.storesService.getPayrollByMonth(id, new Date(date));
    if (!payroll) {
      throw new NotFoundException(`Không tìm thấy bảng lương cho tháng ${date}`);
    }
    return payroll;
  }

  // --- Store Payroll Payment History ---

  @Post(':id/payroll-payments')
  @ApiOperation({ summary: 'Tạo lịch sử thanh toán lương tổng cho cửa hàng' })
  @ApiResponse({ status: 201, type: StorePayrollPaymentResponseDto })
  async createPaymentHistory(
    @Param('id') id: string,
    @Body() data: CreateStorePayrollPaymentDto,
  ) {
    return this.storesService.createPaymentHistory(id, data);
  }

  @Get(':id/payroll-payments')
  @ApiOperation({ summary: 'Lấy danh sách lịch sử thanh toán lương của cửa hàng' })
  @ApiResponse({ status: 200, type: [StorePayrollPaymentResponseDto] })
  async getPaymentHistories(@Param('id') id: string) {
    return this.storesService.getPaymentHistories(id);
  }

  @Put('payroll-payments/:paymentId')
  @ApiOperation({ summary: 'Cập nhật lịch sử thanh toán lương' })
  @ApiResponse({ status: 200, type: StorePayrollPaymentResponseDto })
  async updatePaymentHistory(
    @Param('paymentId') paymentId: string,
    @Body() data: UpdateStorePayrollPaymentDto,
  ) {
    return this.storesService.updatePaymentHistory(paymentId, data);
  }

  @Delete('payroll-payments/:paymentId')
  @ApiOperation({ summary: 'Xóa lịch sử thanh toán lương' })
  @ApiResponse({ status: 200 })
  async deletePaymentHistory(@Param('paymentId') paymentId: string) {
    return this.storesService.deletePaymentHistory(paymentId);
  }

  @Get(':id/payroll-summary')
  @ApiOperation({ summary: 'Lấy báo cáo tổng hợp lương theo tháng' })
  @ApiQuery({ name: 'date', required: true, example: '11/2025', description: 'Tháng cần lấy báo cáo (MM/YYYY)' })
  @ApiResponse({ status: 200, type: PayrollMonthlySummaryResponseDto })
  async getPayrollSummary(
    @Param('id') id: string,
    @Query('date') date: string,
  ) {
    return this.storesService.getPayrollSummary(id, date);
  }

  @Get(':id/payroll-details')
  @ApiOperation({ summary: 'Lấy danh sách chi tiết phạt, thưởng và tăng ca trong tháng' })
  @ApiQuery({ name: 'date', required: true, example: '11/2025', description: 'Tháng cần lấy báo cáo (MM/YYYY)' })
  @ApiResponse({ status: 200, description: 'Danh sách chi tiết' })
  async getPayrollDetails(
    @Param('id') id: string,
    @Query('date') date: string,
  ) {
    if (!date) throw new BadRequestException('Vui lòng cung cấp tháng (date)');
    return this.storesService.getPayrollDetailsList(id, date);
  }

  @Patch(':id/salary-fund')
  @ApiOperation({ summary: 'Cập nhật quỹ lương của cửa hàng trong tháng' })
  @ApiQuery({ name: 'date', required: true, example: '11/2025' })
  async updateSalaryFund(
    @Param('id') id: string,
    @Query('date') date: string,
    @Body() body: any,
  ) {
    const amount = body.amount ?? body.salaryFund;
    return this.storesService.updateSalaryFund(id, date, amount);
  }

  @Get(':id/payroll-report/export')
  @ApiOperation({ summary: 'Xuất file báo cáo quỹ lương tháng' })
  @ApiQuery({ name: 'date', required: true, example: '11/2025' })
  async exportPayrollReport(
    @Param('id') id: string,
    @Query('date') date: string,
    @Res() res: any,
  ) {
    if (!id || !date) throw new BadRequestException('Vui lòng cung cấp storeId và date');
    const buffer = await this.storesService.downloadPayrollReport(id, date);
    
    let slugDate = date.replace('/', '-');
    const fileName = `Bao_Cao_Quy_Luong_${slugDate}.xlsx`;

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });

    res.send(buffer);
  }

  @Get(':id/general-dashboard')
  @ApiOperation({ summary: 'Lấy báo cáo tổng hợp (General Dashboard)' })
  @ApiQuery({ name: 'month', required: false, example: '01/2026', description: 'Tháng báo cáo (MM/YYYY)' })
  async getGeneralDashboard(
    @Param('id') id: string,
    @Query('month') month?: string,
  ) {
    return this.storesService.getGeneralDashboard(id, month);
  }



  @Get(':id/salary-fund/history')
  @ApiOperation({ summary: 'Lịch sử điều chỉnh quỹ lương của cửa hàng' })
  @ApiQuery({ name: 'date', required: false, example: '11/2025' })
  @ApiResponse({ status: 200, description: 'Danh sách lịch sử điều chỉnh' })
  async getSalaryFundHistory(
    @Param('id') id: string,
    @Query('date') date?: string,
  ) {
    return this.storesService.getSalaryFundHistory(id, date);
  }

  @Get('payrolls/:payrollId')
  @ApiOperation({ summary: 'Chi tiết bảng lương' })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết bảng lương',
    type: PayrollResponseDto,
  })
  async getPayrollById(@Param('payrollId') payrollId: string) {
    return this.storesService.getPayrollById(payrollId);
  }

  @Put('payrolls/:payrollId')
  @ApiOperation({ summary: 'Cập nhật bảng lương' })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật thành công',
    type: PayrollResponseDto,
  })
  async updatePayroll(
    @Param('payrollId') payrollId: string,
    @Body() body: any,
  ) {
    return this.storesService.updatePayroll(payrollId, body);
  }

  @Delete('payrolls/:payrollId')
  @ApiOperation({ summary: 'Xóa bảng lương' })
  @ApiResponse({ status: 200, description: 'Xóa thành công' })
  async deletePayroll(@Param('payrollId') payrollId: string) {
    return this.storesService.deletePayroll(payrollId);
  }

  @Get(':id/employee-salaries')
  @ApiOperation({ summary: 'Lấy danh sách lương nhân viên của cửa hàng theo tháng' })
  @ApiQuery({ name: 'month', required: true, example: '11/2025' })
  @ApiQuery({ name: 'type', required: false, description: 'Lọc theo loại nhân viên (Full-time, Part-time...)' })
  async getEmployeeSalariesByStore(
    @Param('id') id: string,
    @Query('month') month: string,
    @Query('type') type?: string,
  ) {
    if (!month) throw new BadRequestException('Vui lòng cung cấp tháng (month)');
    return this.storesService.getEmployeeSalariesByStore(id, month, type);
  }

  // Salary Configs
  @Get(':id/salary-configs')
  @ApiOperation({ summary: 'Lấy cấu hình lương của cửa hàng' })
  @ApiResponse({
    status: 200,
    type: [SalaryConfigResponseDto],
  })
  async getSalaryConfigsByStore(@Param('id') id: string) {
    return this.storesService.getSalaryConfigsByStore(id);
  }

  @Post('salary-configs')
  @ApiOperation({ summary: 'Tạo cấu hình lương' })
  @ApiResponse({
    status: 201,
    description: 'Tạo thành công',
    type: SalaryConfigResponseDto,
  })
  async createSalaryConfig(@GetUser() user: any, @Body() body: CreateSalaryConfigDto) {
    return this.storesService.createSalaryConfig(user.userId, body);
  }

  @Post(':id/salary-configs')
  @ApiOperation({ summary: 'Tạo cấu hình lương cho cửa hàng cụ thể (URL có ID)' })
  @ApiResponse({
    status: 201,
    description: 'Tạo thành công',
    type: SalaryConfigResponseDto,
  })
  async createSalaryConfigWithId(
    @Param('id') id: string,
    @GetUser() user: any,
    @Body() body: CreateSalaryConfigDto,
  ) {
    if (!body.storeIds || body.storeIds.length === 0) {
      body.storeIds = [id];
    }
    return this.storesService.createSalaryConfig(user.userId, body);
  }

  @Put('salary-configs/:configId')
  @ApiOperation({ summary: 'Cập nhật cấu hình lương' })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật thành công',
    type: SalaryConfigResponseDto,
  })
  async updateSalaryConfig(
    @Param('configId') configId: string,
    @Body() body: UpdateSalaryConfigDto,
  ) {
    return this.storesService.updateSalaryConfig(configId, body);
  }
  
  @Patch('salary-configs/:configId/status')
  @ApiOperation({ summary: 'Thay đổi trạng thái cấu hình lương' })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật trạng thái thành công',
    type: SalaryConfigResponseDto,
  })
  async changeSalaryConfigStatus(
      @Param('configId') configId: string,
      @Body('status') status: ConfigStatus
  ) {
      return this.storesService.changeSalaryConfigStatus(configId, status);
  }


  @Delete('salary-configs/:configId')
  @ApiOperation({ summary: 'Xóa cấu hình lương' })
  @ApiResponse({ status: 200, description: 'Xóa thành công' })
  async deleteSalaryConfig(@Param('configId') configId: string) {
    return this.storesService.deleteSalaryConfig(configId);
  }

  // Employee Salaries
  @Post('employee-salaries')
  @ApiOperation({ summary: 'Tạo phiếu lương nhân viên' })
  @ApiResponse({ status: 201, description: 'Tạo thành công' })
  async createEmployeeSalary(@Body() body: any) {
    return this.storesService.createEmployeeSalary(body);
  }

  @Get('employees/:profileId/salaries')
  @ApiOperation({ summary: 'Lấy lịch sử lương nhân viên' })
  @ApiResponse({ status: 200, description: 'Danh sách lương' })
  async getEmployeeSalaries(
    @Param('profileId') profileId: string,
    @Query('month') month?: string,
  ) {
    return this.storesService.getEmployeeSalaries(profileId, month);
  }

  @Get('employee-salaries/:salaryId')
  @ApiOperation({ summary: 'Chi tiết phiếu lương' })
  @ApiResponse({ status: 200, description: 'Chi tiết phiếu lương' })
  async getEmployeeSalaryById(@Param('salaryId') salaryId: string) {
    return this.storesService.getEmployeeSalaryById(salaryId);
  }

  @Put('employee-salaries/:salaryId')
  @ApiOperation({ summary: 'Cập nhật phiếu lương' })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công' })
  async updateEmployeeSalary(
    @Param('salaryId') salaryId: string,
    @Body() body: any,
  ) {
    return this.storesService.updateEmployeeSalary(salaryId, body);
  }

  @Delete('employee-salaries/:salaryId')
  @ApiOperation({ summary: 'Xóa phiếu lương' })
  @ApiResponse({ status: 200, description: 'Xóa thành công' })
  async deleteEmployeeSalary(@Param('salaryId') salaryId: string) {
    return this.storesService.deleteEmployeeSalary(salaryId);
  }

  // Employee Salary Payment History
  @Get('employees/:profileId/salary-history')
  @ApiOperation({ summary: 'Lấy lịch sử thanh toán lương của nhân viên (phân trang)' })
  @ApiQuery({ name: 'page', required: false, example: '1' })
  @ApiQuery({ name: 'limit', required: false, example: '10' })
  @ApiResponse({ status: 200, description: 'Danh sách lịch sử thanh toán' })
  async getEmployeeSalaryHistory(
    @Param('profileId') profileId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.storesService.getEmployeeSalaryHistory(
      profileId,
      parseInt(page || '1', 10),
      parseInt(limit || '10', 10),
    );
  }

  // Salary Advance Requests
  @Post('employees/:profileId/salary-advance-requests')
  @ApiOperation({ summary: 'Tạo yêu cầu ứng lương' })
  @ApiResponse({ status: 201, description: 'Tạo yêu cầu thành công' })
  async createSalaryAdvanceRequest(
    @Param('profileId') profileId: string,
    @Body() body: { employeeSalaryId: string; requestedAmount: number; requestReason?: string }
  ) {
    return this.storesService.createSalaryAdvanceRequest(profileId, body);
  }

  @Get(':storeId/salary-advance-requests')
  @ApiOperation({ summary: 'Lấy danh sách yêu cầu ứng lương của cửa hàng' })
  @ApiResponse({ status: 200, description: 'Danh sách yêu cầu ứng lương' })
  async getSalaryAdvanceRequests(
    @Param('storeId') storeId: string,
    @Query('status') status?: string,
    @Query('month') month?: string,
  ) {
    return this.storesService.getSalaryAdvanceRequests({
      storeId,
      status: status as any,
      month: month ? new Date(month) : undefined
    });
  }

  @Get('employees/:profileId/salary-advance-requests')
  @ApiOperation({ summary: 'Lấy danh sách yêu cầu ứng lương của nhân viên' })
  @ApiResponse({ status: 200, description: 'Danh sách yêu cầu ứng lương' })
  async getEmployeeSalaryAdvanceRequests(
    @Param('profileId') profileId: string,
    @Query('status') status?: string,
  ) {
    return this.storesService.getSalaryAdvanceRequests({
      employeeProfileId: profileId,
      status: status as any
    });
  }

  @Patch('salary-advance-requests/:requestId/review')
  @ApiOperation({ summary: 'Duyệt/Từ chối yêu cầu ứng lương' })
  @ApiResponse({ status: 200, description: 'Xử lý yêu cầu thành công' })
  async reviewSalaryAdvanceRequest(
    @Param('requestId') requestId: string,
    @GetUser() user: any,
    @Body() body: {
      status: string;
      approvedAmount?: number;
      reviewNote?: string;
      paymentMethod?: string;
      paymentReference?: string;
    }
  ) {
    return this.storesService.reviewSalaryAdvanceRequest(requestId, user.userId, body as any);
  }

  @Delete('salary-advance-requests/:requestId')
  @ApiOperation({ summary: 'Hủy yêu cầu ứng lương (chỉ người tạo)' })
  @ApiResponse({ status: 200, description: 'Hủy yêu cầu thành công' })
  async cancelSalaryAdvanceRequest(
    @Param('requestId') requestId: string,
    @GetUser() user: any,
  ) {
    // Assuming user has employeeProfileId, adjust if needed
    const profile = await this.storesService.getEmployeeById(user.userId);
    if (!profile) {
      throw new NotFoundException('Không tìm thấy thông tin nhân viên');
    }
    return this.storesService.cancelSalaryAdvanceRequest(requestId, profile.profile.id);
  }

  // KPI Types
  @Post(':id/kpi-types')
  @ApiOperation({ summary: 'Tạo loại KPI' })
  @ApiResponse({
    status: 201,
    description: 'Thành công',
    type: KpiTypeResponseDto,
  })
  async createKpiType(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createKpiType(id, body);
  }

  @Get(':id/kpi-types')
  @ApiOperation({ summary: 'Lấy danh sách loại KPI' })
  async getKpiTypes(@Param('id') id: string) {
    return this.storesService.getKpiTypes(id);
  }

  // KPI Units
  @Post(':id/kpi-units')
  @ApiOperation({ summary: 'Tạo đơn vị đo lường KPI' })
  async createKpiUnit(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createKpiUnit(id, body);
  }

  @Get(':id/kpi-units')
  @ApiOperation({ summary: 'Lấy danh sách đơn vị đo lường KPI' })
  async getKpiUnits(@Param('id') id: string) {
    return this.storesService.getKpiUnits(id);
  }

  // KPI Periods
  @Post(':id/kpi-periods')
  @ApiOperation({ summary: 'Tạo kỳ đo lường KPI' })
  async createKpiPeriod(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createKpiPeriod(id, body);
  }

  @Get(':id/kpi-periods')
  @ApiOperation({ summary: 'Lấy danh sách kỳ đo lường KPI' })
  async getKpiPeriods(@Param('id') id: string) {
    return this.storesService.getKpiPeriods(id);
  }







  // Daily Employee Reports
  @Post(':id/daily-reports')
  @ApiOperation({
    summary: 'Tạo báo cáo ngày',
    description: 'Báo cáo doanh thu và tình hình hoạt động cuối ngày',
  })
  @ApiResponse({
    status: 201,
    description: 'Tạo báo cáo thành công',
    type: DailyReportResponseDto,
  })
  async createDailyReport(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createDailyReport({ ...body, storeId: id });
  }

  @Get(':id/daily-reports')
  @ApiOperation({ summary: 'Lấy danh sách báo cáo ngày' })
  @ApiResponse({
    status: 200,
    description: 'Danh sách báo cáo',
    type: [DailyReportResponseDto],
  })
  async getDailyReports(@Param('id') id: string) {
    return this.storesService.getDailyReports(id);
  }

  @Get(':id/daily-reports/by-date')
  @ApiOperation({ 
    summary: 'Lấy báo cáo ngày theo ngày cụ thể',
    description: 'Lấy báo cáo nhân viên hàng ngày của cửa hàng theo ngày cụ thể (format: YYYY-MM-DD)'
  })
  @ApiQuery({ 
    name: 'date', 
    required: true, 
    type: String,
    description: 'Ngày cần lấy báo cáo (YYYY-MM-DD)',
    example: '2026-01-22'
  })
  @ApiResponse({
    status: 200,
    description: 'Báo cáo ngày',
    type: DailyReportResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Không tìm thấy báo cáo cho ngày này',
  })
  async getDailyReportByDate(
    @Param('id') id: string,
    @Query('date') date: string
  ) {
    const report = await this.storesService.getDailyReportByDate(id, new Date(date));
    if (!report) {
      throw new NotFoundException(`Không tìm thấy báo cáo cho ngày ${date}`);
    }
    return report;
  }

  @Get('daily-reports/:reportId')
  @ApiOperation({ summary: 'Chi tiết báo cáo ngày' })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết báo cáo',
    type: DailyReportResponseDto,
  })
  async getDailyReportById(@Param('reportId') reportId: string) {
    return this.storesService.getDailyReportById(reportId);
  }

  @Put('daily-reports/:reportId')
  @ApiOperation({ summary: 'Cập nhật báo cáo ngày' })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật thành công',
    type: DailyReportResponseDto,
  })
  async updateDailyReport(
    @Param('reportId') reportId: string,
    @Body() body: any,
  ) {
    return this.storesService.updateDailyReport(reportId, body);
  }

  @Delete('daily-reports/:reportId')
  @ApiOperation({ summary: 'Xóa báo cáo ngày' })
  @ApiResponse({ status: 200, description: 'Đã xóa báo cáo' })
  async deleteDailyReport(@Param('reportId') reportId: string) {
    return this.storesService.deleteDailyReport(reportId);
  }

  // Store Events
  @Post(':id/events')
  @ApiOperation({
    summary: 'Tạo sự kiện',
    description: 'Lịch sự kiện, khuyến mãi, tiệc tùng',
  })
  @ApiResponse({
    status: 201,
    description: 'Tạo sự kiện thành công',
    type: EventResponseDto,
  })
  async createEvent(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createEvent(id, body);
  }


  @Get(':id/events')
  @ApiOperation({ summary: 'Lấy danh sách sự kiện' })
  @ApiQuery({ name: 'timeRange', required: false, enum: ['today', 'yesterday', '1_week', '1_month'] })
  @ApiQuery({ name: 'type', required: false, enum: StoreEventType })
  @ApiResponse({
    status: 200,
    description: 'Danh sách sự kiện',
    type: [EventResponseDto],
  })
  async getEvents(
    @Param('id') id: string,
    @Query('timeRange') timeRange?: string,
    @Query('type') type?: StoreEventType,
  ) {
    return this.storesService.getEvents(id, timeRange, type);
  }

  @Get('events/:eventId')
  @ApiOperation({ summary: 'Chi tiết sự kiện' })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết sự kiện',
    type: EventResponseDto,
  })
  async getEventById(@Param('eventId') eventId: string) {
    return this.storesService.getEventById(eventId);
  }

  @Put('events/:eventId')
  @ApiOperation({ summary: 'Cập nhật sự kiện' })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật thành công',
    type: EventResponseDto,
  })
  async updateEvent(@Param('eventId') eventId: string, @Body() body: any) {
    return this.storesService.updateEvent(eventId, body);
  }

  @Delete('events/:eventId')
  @ApiOperation({ summary: 'Xóa sự kiện' })
  @ApiResponse({ status: 200, description: 'Đã xóa sự kiện' })
  async deleteEvent(@Param('eventId') eventId: string) {
    return this.storesService.deleteEvent(eventId);
  }

  // Stock Transactions
  @Post(':id/stock-transactions')
  async createStockTransaction(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createStockTransaction(id, body);
  }

  @Get(':id/stock-transactions')
  async getStockTransactions(@Param('id') id: string) {
    return this.storesService.getStockTransactions(id);
  }

  @Get('stock-transactions/:transactionId')
  async getStockTransactionById(@Param('transactionId') transactionId: string) {
    return this.storesService.getStockTransactionById(transactionId);
  }

  // Inventory Reports (Broken Assets / Out of Stock)
  @Post('inventory-reports')
  @UseInterceptors(AnyFilesInterceptor(multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Gửi báo cáo sự cố kho (Hỗ trợ nhiều báo cáo & nhiều ảnh)' })
  async createInventoryReports(
    @Body('reports') reportsStr: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    let reports = [];
    try {
      reports = JSON.parse(reportsStr);
    } catch (e) {
      throw new BadRequestException('Trường "reports" phải là một chuỗi JSON hợp lệ');
    }

    return this.storesService.createInventoryReports(reports, files);
  }

  @Get('inventory-reports')
  @ApiOperation({ summary: 'Lấy danh sách báo cáo sự cố kho' })
  async getInventoryReports(
    @Query('storeId') storeId?: string,
    @Query('status') status?: InventoryReportStatus,
    @Query('type') type?: string,
  ) {
    return this.storesService.getInventoryReports({ storeId, status, type });
  }

  @Patch('inventory-reports/:id/handle')
  @ApiOperation({ summary: 'Xử lý báo cáo sự cố kho (Duyệt/Từ chối)' })
  async handleInventoryReport(
    @Param('id') id: string,
    @Body() body: { status: InventoryReportStatus; adminNote?: string },
  ) {
    return this.storesService.handleInventoryReport(id, body);
  }

  // Service Categories
  @Post(':id/service-categories')
  async createServiceCategory(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createServiceCategory(id, body);
  }

  @Get(':id/service-categories')
  async getServiceCategories(
    @Param('id') id: string,
    @Query('type') type?: string,
  ) {
    return this.storesService.getServiceCategories(id, type);
  }

  @Get('service-categories/:categoryId')
  async getServiceCategoryById(@Param('categoryId') categoryId: string) {
    return this.storesService.getServiceCategoryById(categoryId);
  }

  @Put('service-categories/:categoryId')
  async updateServiceCategory(
    @Param('categoryId') categoryId: string,
    @Body() body: any,
  ) {
    return this.storesService.updateServiceCategory(categoryId, body);
  }

  @Delete('service-categories/:categoryId')
  async deleteServiceCategory(@Param('categoryId') categoryId: string) {
    return this.storesService.deleteServiceCategory(categoryId);
  }

  // Service Items
  @Post(':id/fnb-items')
  @UseInterceptors(FileInterceptor('avatar', multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Tạo món F&B kèm danh mục và công thức (Tự động tạo danh mục nếu chưa có)' })
  async createFnbItem(
    @Param('id') id: string,
    @Body() body: CreateFnbServiceItemDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const data: any = { ...body };
    if (file) data.avatarUrl = `/uploads/${file.filename}`;

    // Parse recipes if sent as string (multipart form case)
    if (typeof data.recipes === 'string') {
      try {
        data.recipes = JSON.parse(data.recipes);
      } catch (e) {
        throw new BadRequestException('Trường "recipes" phải là một chuỗi JSON Array hợp lệ');
      }
    }

    return this.storesService.createFnbServiceItem(id, data);
  }


  @Post(':id/service-items')
  @UseInterceptors(FileInterceptor('avatar', multerConfig))
  async createServiceItem(
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const data = { ...body };
    if (file) data.avatarUrl = `/uploads/${file.filename}`;
    return this.storesService.createServiceItem(id, data);
  }

  @Get(':id/service-items')
  async getServiceItems(
    @Param('id') id: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.storesService.getServiceItems(id, categoryId);
  }

  @Get('service-items/:itemId')
  async getServiceItemById(@Param('itemId') itemId: string) {
    return this.storesService.getServiceItemById(itemId);
  }

  @Put('service-items/:itemId')
  @UseInterceptors(FileInterceptor('avatar', multerConfig))
  async updateServiceItem(
    @Param('itemId') itemId: string,
    @Body() body: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const data = { ...body };
    if (file) data.avatarUrl = `/uploads/${file.filename}`;
    return this.storesService.updateServiceItem(itemId, data);
  }

  @Delete('service-items/:itemId')
  async deleteServiceItem(@Param('itemId') itemId: string) {
    return this.storesService.deleteServiceItem(itemId);
  }

  // Service Item Recipes
  @Post('service-items/:itemId/recipes')
  async createServiceItemRecipe(
    @Param('itemId') itemId: string,
    @Body() body: any,
  ) {
    return this.storesService.createServiceItemRecipe(itemId, body);
  }

  @Post('service-items/:itemId/recipes/bulk')
  async bulkCreateRecipes(
    @Param('itemId') itemId: string,
    @Body('recipes') recipes: any[],
  ) {
    return this.storesService.bulkCreateRecipes(itemId, recipes);
  }

  @Get('service-items/:itemId/recipes')
  async getServiceItemRecipes(@Param('itemId') itemId: string) {
    return this.storesService.getServiceItemRecipes(itemId);
  }

  @Put('service-item-recipes/:recipeId')
  async updateServiceItemRecipe(
    @Param('recipeId') recipeId: string,
    @Body() body: any,
  ) {
    return this.storesService.updateServiceItemRecipe(recipeId, body);
  }

  @Delete('service-item-recipes/:recipeId')
  async deleteServiceItemRecipe(@Param('recipeId') recipeId: string) {
    return this.storesService.deleteServiceItemRecipe(recipeId);
  }

  // --- Orders ---
  @Post(':id/orders')
  @ApiOperation({
    summary: 'Tạo đơn hàng mới (POS)',
    description:
      'Tạo đơn hàng, tính toán tài chính và tự động trừ kho nguyên liệu',
  })
  @ApiResponse({ status: 201, description: 'Đơn hàng được tạo thành công' })
  async createOrder(
    @Param('id') id: string,
    @GetUser() user: any,
    @Body() body: CreateOrderDto,
  ) {
    // Find employee profile for the current user (Optional)
    const profile = await this.storesService.getEmployeeByAccountId(
      user.userId,
    );

    return this.storesService.createOrder(id, profile?.id, body);
  }

  @Get(':id/orders')
  @ApiOperation({
    summary: 'Lấy danh sách đơn hàng',
    description: 'Lấy các đơn hàng của cửa hàng kèm theo bộ lọc',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    description: 'Lọc theo loại đơn (FNB, RETAIL...)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Lọc theo trạng thái đơn',
  })
  async getOrders(@Param('id') id: string, @Query() query: any) {
    return this.storesService.getOrders(id, query);
  }



  @Get(':id/revenue-report')
  @ApiOperation({
    summary: 'Báo cáo doanh thu & lợi nhuận',
    description:
      'Tổng hợp doanh thu, vốn, lợi nhuận, giảm giá, thuế và số lượng đơn theo ngày',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Ngày bắt đầu (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'Ngày kết thúc (YYYY-MM-DD)',
  })
  async getRevenueReport(
    @Param('id') id: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    // Default to last 30 days if not provided
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(new Date().setDate(end.getDate() - 30));

    return this.storesService.getRevenueReport(id, start, end);
  }

  @Get(':id/top-employees-report')
  @ApiOperation({
    summary: 'Báo cáo nhân viên xuất sắc nhất',
  })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getTopEmployeesReport(
    @Param('id') id: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(end.getDate() - 30));
    return this.storesService.getTopEmployeesReport(id, start, end);
  }

  @Get(':id/shift-efficiency-report')
  @ApiOperation({
    summary: 'Báo cáo ca làm việc hiệu quả nhất',
  })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getShiftEfficiencyReport(
    @Param('id') id: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(end.getDate() - 30));
    return this.storesService.getShiftEfficiencyReport(id, start, end);
  }

  @Get(':id/losing-money-report')
  @ApiOperation({
    summary: 'Báo cáo dịch vụ huỷ nhiều nhất',
  })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getLosingMoneyReport(
    @Param('id') id: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(end.getDate() - 30));
    return this.storesService.getLosingMoneyReport(id, start, end);
  }

  // Salary Adjustments
  @Post('salary-adjustments')
  @ApiOperation({ summary: 'Tạo phiếu điều chỉnh lương (tăng/giảm)' })
  @ApiResponse({
    status: 201,
    description: 'Điều chỉnh thành công',
    type: SalaryAdjustmentResponseDto,
  })
  async createSalaryAdjustment(
    @GetUser() user: any,
    @Body() body: CreateSalaryAdjustmentDto,
  ) {
    return this.storesService.createSalaryAdjustment(user.userId, body);
  }

  @Get('salary-adjustments/:employeeProfileId')
  @ApiOperation({ summary: 'Lấy lịch sử điều chỉnh lương của nhân viên' })
  @ApiResponse({
    status: 200,
    type: [SalaryAdjustmentResponseDto],
  })
  async getSalaryAdjustments(@Param('employeeProfileId') employeeProfileId: string) {
    return this.storesService.getSalaryAdjustments(employeeProfileId);
  }

  @Get(':id/employees-salary-overview')
  @ApiOperation({ summary: 'Lấy danh sách tổng hợp lương và điều chỉnh của nhân viên trong store' })
  @ApiResponse({
    status: 200,
    description: 'Lấy dữ liệu thành công',
  })
  async getEmployeesSalaryOverview(@Param('id') id: string) {
    return this.storesService.getEmployeesSalaryOverview(id);
  }

  @Get('employees/:employeeProfileId/salary-overview')
  @ApiOperation({ summary: 'Lấy tổng hợp lương và điều chỉnh của MỘT nhân viên' })
  @ApiResponse({
    status: 200,
    description: 'Lấy dữ liệu thành công',
  })
  async getEmployeeSalaryOverview(@Param('employeeProfileId') employeeProfileId: string) {
    return this.storesService.getEmployeeSalaryOverview(employeeProfileId);
  }

  @Get('employees/:employeeProfileId/salary-details')
  @ApiOperation({ summary: 'Lấy chi tiết phiếu lương nhân viên theo tháng' })
  async getEmployeeSalaryDetailByMonth(
    @Param('employeeProfileId') employeeProfileId: string,
    @Query('month') month: string,
  ) {
    return this.storesService.getEmployeeSalaryDetailByMonth(employeeProfileId, month);
  }

  @Post('salaries/:id/pay')
  @ApiOperation({ summary: 'Thực hiện thanh toán lương cho nhân viên' })
  async payEmployeeSalary(
    @Param('id') id: string,
    @Body() body: { paymentAccountId: string, paymentMethod?: string, referenceNumber?: string, notes?: string }
  ) {
    return this.storesService.payEmployeeSalary(id, body);
  }

  @Patch('employees/:id/salary-structure')
  @ApiOperation({ summary: 'Cập nhật mức lương và các khoản phụ cấp của nhân viên' })
  async updateEmployeeSalaryStructure(
    @Param('id') id: string,
    @Body() body: { salaryAmount?: number; allowances?: Record<string, number> }
  ) {
    return this.storesService.updateEmployeeSalaryStructure(id, body);
  }

  // Employee Payment History (Individual)
  @Get('employees/:employeeProfileId/payment-histories')
  @ApiOperation({ summary: 'Lấy lịch sử thanh toán lương của MỘT nhân viên' })
  async getEmployeePaymentHistories(@Param('employeeProfileId') employeeProfileId: string) {
    return this.storesService.getEmployeePaymentHistories(employeeProfileId);
  }

  @Post('employees/payment-histories')
  @ApiOperation({ summary: 'Tạo bản ghi thanh toán lương cho nhân viên' })
  async createEmployeePaymentHistory(@Body() body: any) {
    return this.storesService.createEmployeePaymentHistory(body);
  }

  @Patch('employees/payment-histories/:id')
  @ApiOperation({ summary: 'Cập nhật bản ghi thanh toán lương' })
  async updateEmployeePaymentHistory(@Param('id') id: string, @Body() body: any) {
    return this.storesService.updateEmployeePaymentHistory(id, body);
  }

  @Delete('employees/payment-histories/:id')
  @ApiOperation({ summary: 'Xóa bản ghi thanh toán lương' })
  async deleteEmployeePaymentHistory(@Param('id') id: string) {
    return this.storesService.deleteEmployeePaymentHistory(id);
  }

  // Store Payment Accounts
  @Get(':id/payment-accounts')
  @ApiOperation({ summary: 'Lấy danh sách tài khoản ngân hàng của cửa hàng' })
  async getStorePaymentAccounts(@Param('id') id: string) {
    return this.storesService.getStorePaymentAccounts(id);
  }

  @Post(':id/payment-accounts')
  @ApiOperation({ summary: 'Thêm tài khoản ngân hàng mới cho cửa hàng' })
  async createStorePaymentAccount(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createStorePaymentAccount({ ...body, storeId: id });
  }

  @Patch('payment-accounts/:id')
  @ApiOperation({ summary: 'Cập nhật tài khoản ngân hàng cửa hàng' })
  async updateStorePaymentAccount(@Param('id') id: string, @Body() body: any) {
    return this.storesService.updateStorePaymentAccount(id, body);
  }

  @Delete('payment-accounts/:id')
  @ApiOperation({ summary: 'Xóa tài khoản ngân hàng cửa hàng' })
  async deleteStorePaymentAccount(@Param('id') id: string) {
    return this.storesService.deleteStorePaymentAccount(id);
  }

  @Post(':id/salary-adjustment-reasons')
  @ApiOperation({ summary: 'Tạo lý do điều chỉnh lương' })
  async createSalaryAdjustmentReason(
    @Param('id') id: string,
    @Body('name') name: string,
  ) {
    return this.storesService.createSalaryAdjustmentReason(id, name);
  }

  @Get(':id/salary-adjustment-reasons')
  @ApiOperation({ summary: 'Lấy danh sách lý do điều chỉnh lương' })
  async getSalaryAdjustmentReasons(@Param('id') id: string) {
    return this.storesService.getSalaryAdjustmentReasons(id);
  }

  @Get(':id/internal-rule')
  @ApiOperation({ summary: 'Lấy nội quy nội bộ của cửa hàng' })
  @ApiResponse({ type: InternalRuleResponseDto })
  async getInternalRule(@Param('id') id: string) {
    return this.storesService.getInternalRule(id);
  }

  @Put(':id/internal-rule')
  @UseInterceptors(FilesInterceptor('files', 10, multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Cập nhật nội quy nội bộ của cửa hàng' })
  @ApiResponse({ type: InternalRuleResponseDto })
  async updateInternalRule(
    @Param('id') id: string,
    @Body() data: UpdateInternalRuleDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.storesService.upsertInternalRule(id, data, files);
  }

  // Employee Reports (Staff)
  @Get(':id/employee-daily-report')
  @ApiOperation({ summary: 'Lấy báo cáo hàng ngày của nhân viên' })
  @ApiQuery({ name: 'employeeProfileId', required: true })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD' })
  async getEmployeeDailyReport(
    @Param('id') storeId: string,
    @Query('employeeProfileId') employeeProfileId: string,
    @Query('date') date?: string,
  ) {
    return this.storesService.getEmployeeDailyReport(storeId, employeeProfileId, date);
  }

  @Get(':id/employee-monthly-report')
  @ApiOperation({ summary: 'Lấy báo cáo tháng của nhân viên' })
  @ApiQuery({ name: 'employeeProfileId', required: true })
  @ApiQuery({ name: 'month', required: false, description: 'MM/YYYY' })
  async getEmployeeMonthlyReport(
    @Param('id') storeId: string,
    @Query('employeeProfileId') employeeProfileId: string,
    @Query('month') month?: string,
  ) {
    return this.storesService.getEmployeeMonthlyReport(storeId, employeeProfileId, month);
  }

  @Get(':id/employee-shift-hours')
  @ApiOperation({ summary: 'Lấy thông tin ca & giờ đã làm của nhân viên' })
  @ApiQuery({ name: 'employeeProfileId', required: true })
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'filter', required: false })
  async getEmployeeShiftHours(
    @Param('id') storeId: string,
    @Query('employeeProfileId') employeeProfileId: string,
    @Query('month') month?: string,
    @Query('filter') filter?: string,
  ) {
    return this.storesService.getEmployeeShiftHours(storeId, employeeProfileId, month, filter);
  }

  // Leave Requests (Staff)
  @Post(':id/leave-requests')
  @UseInterceptors(AnyFilesInterceptor(multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Gửi đơn xin nghỉ phép' })
  async createLeaveRequest(
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.storesService.createLeaveRequest({ ...body, storeId: id }, files);
  }

  @Get(':id/leave-requests')
  @ApiOperation({ summary: 'Lấy danh sách đơn xin nghỉ theo cửa hàng' })
  @ApiQuery({ name: 'status', required: false })
  async getLeaveRequestsByStore(
    @Param('id') id: string,
    @Query('status') status?: string,
  ) {
    return this.storesService.getLeaveRequestsByStore(id, status as any);
  }

  @Get('employees/:profileId/leave-requests')
  @ApiOperation({ summary: 'Lấy danh sách đơn xin nghỉ theo nhân viên' })
  async getLeaveRequestsByEmployee(@Param('profileId') profileId: string) {
    return this.storesService.getLeaveRequestsByEmployee(profileId);
  }

  @Patch('leave-requests/:requestId/cancel')
  @ApiOperation({ summary: 'Hủy đơn xin nghỉ phép' })
  async cancelLeaveRequest(
    @Param('requestId') requestId: string,
    @Body('employeeProfileId') employeeProfileId: string,
  ) {
    return this.storesService.cancelLeaveRequest(requestId, employeeProfileId);
  }

  // Feedback
  @Post('feedbacks')
  @UseInterceptors(AnyFilesInterceptor(multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Gửi góp ý / feedback' })
  async createFeedback(
    @Body() body: any,
    @UploadedFiles() files: Express.Multer.File[],
    @GetUser() user: any,
  ) {
    const data = { ...body };
    if (user?.userId) data.accountId = user.userId;
    return this.storesService.createFeedback(data, files);
  }

  @Get('feedbacks')
  @ApiOperation({ summary: 'Lấy danh sách feedback' })
  @ApiQuery({ name: 'storeId', required: false })
  @ApiQuery({ name: 'employeeProfileId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getFeedbacks(
    @Query('storeId') storeId?: string,
    @Query('employeeProfileId') employeeProfileId?: string,
    @Query('status') status?: string,
  ) {
    return this.storesService.getFeedbacks({
      storeId,
      employeeProfileId,
      status: status as any,
    });
  }

  @Get('feedbacks/leaderboard')
  @ApiOperation({ summary: 'Bảng xếp hạng feedback nhân viên theo store' })
  @ApiQuery({ name: 'storeId', required: true })
  async getFeedbackLeaderboard(@Query('storeId') storeId: string) {
    return this.storesService.getFeedbackLeaderboard(storeId);
  }

  @Post('shift-assignments/:id/checkout-mood')
  @ApiOperation({ summary: 'Lưu cảm xúc sau ca làm việc' })
  async recordCheckoutMood(
    @Param('id') id: string,
    @Body() body: { mood: string; note?: string },
  ) {
    return this.storesService.recordCheckoutMood(id, body.mood, body.note);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ATTENDANCE & FACE RECOGNITION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  @Post('shift-assignments/:id/check-in')
  @ApiOperation({ summary: 'Check-in ca làm việc (3 bước: QR → GPS → Face)' })
  @UseInterceptors(FileInterceptor('photo', multerConfig))
  async checkIn(
    @Param('id') id: string,
    @UploadedFile() photo: Express.Multer.File,
    @Body() body: { latitude?: string; longitude?: string; qrStoreId?: string },
  ) {
    if (!photo) throw new BadRequestException('Photo is required');
    // multerConfig uses diskStorage → file.buffer is undefined, read from file.path
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsLib = require('fs');
    const imageBuffer = photo.buffer || (photo.path ? fsLib.readFileSync(photo.path) : null);
    if (!imageBuffer) throw new BadRequestException('Invalid photo upload');
    const result = await this.storesService.checkInWithFace(id, imageBuffer, {
      latitude: body.latitude ? parseFloat(body.latitude) : undefined,
      longitude: body.longitude ? parseFloat(body.longitude) : undefined,
      qrStoreId: body.qrStoreId,
    });
    // Clean up temp file
    if (photo.path) try { fsLib.unlinkSync(photo.path); } catch (_e) { /* ignore */ }
    return result;
  }

  @Post('shift-assignments/:id/check-out')
  @ApiOperation({ summary: 'Check-out ca làm việc (3 bước: QR → GPS → Face)' })
  @UseInterceptors(FileInterceptor('photo', multerConfig))
  async checkOut(
    @Param('id') id: string,
    @UploadedFile() photo: Express.Multer.File,
    @Body() body: { latitude?: string; longitude?: string; qrStoreId?: string },
  ) {
    if (!photo) throw new BadRequestException('Photo is required');
    // multerConfig uses diskStorage → file.buffer is undefined, read from file.path
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsLib = require('fs');
    const imageBuffer = photo.buffer || (photo.path ? fsLib.readFileSync(photo.path) : null);
    if (!imageBuffer) throw new BadRequestException('Invalid photo upload');
    const result = await this.storesService.checkOutWithFace(id, imageBuffer, {
      latitude: body.latitude ? parseFloat(body.latitude) : undefined,
      longitude: body.longitude ? parseFloat(body.longitude) : undefined,
      qrStoreId: body.qrStoreId,
    });
    // Clean up temp file
    if (photo.path) try { fsLib.unlinkSync(photo.path); } catch (_e) { /* ignore */ }
    return result;
  }

  @Put(':id/location')
  @ApiOperation({
    summary: 'Cập nhật vị trí cửa hàng',
    description: 'Chủ cửa hàng chọn vị trí trên bản đồ. Tự động tạo QR code nếu chưa có.',
  })
  async updateStoreLocation(
    @Param('id') id: string,
    @Body() body: { latitude: number; longitude: number },
  ) {
    return this.storesService.updateStoreLocation(id, body.latitude, body.longitude);
  }

  @Post(':id/qr-code')
  @ApiOperation({ summary: 'Tạo/tái tạo mã QR cửa hàng' })
  async generateStoreQR(@Param('id') id: string) {
    return this.storesService.generateStoreQR(id);
  }


  @Post('employees/:employeeId/face-registration')
  @ApiOperation({ summary: 'Đăng ký khuôn mặt nhân viên (Face ID style)' })
  @UseInterceptors(FilesInterceptor('photos', 5, multerConfig))
  async registerFace(
    @Param('employeeId') employeeId: string,
    @UploadedFiles() photos: Express.Multer.File[],
    @Body('storeId') storeId: string,
  ) {
    if (!photos || photos.length < 3) {
      throw new BadRequestException('At least 3 face photos required');
    }
    // multerConfig uses diskStorage → file.buffer is undefined, read from file.path
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsLib = require('fs');
    const buffers = photos.map((p) => {
      if (p.buffer) return p.buffer;
      if (p.path) return fsLib.readFileSync(p.path);
      throw new BadRequestException('Invalid file upload');
    });
    const result = await this.storesService.registerFace(employeeId, storeId, buffers);
    // Clean up temp files
    photos.forEach((p) => {
      if (p.path) try { fsLib.unlinkSync(p.path); } catch (_e) { /* ignore cleanup errors */ }
    });
    return result;
  }

  @Get('employees/:employeeId/face-registration')
  @ApiOperation({ summary: 'Kiểm tra trạng thái đăng ký khuôn mặt' })
  async getFaceRegistration(
    @Param('employeeId') employeeId: string,
  ) {
    return this.storesService.getFaceRegistration(employeeId);
  }

  @Get(':id/attendance-logs')
  @ApiOperation({ summary: 'Lịch sử chấm công' })
  async getAttendanceLogs(
    @Param('id') id: string,
    @Query('employeeProfileId') employeeProfileId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.storesService.getAttendanceLogs(id, { employeeProfileId, dateFrom, dateTo });
  }

  @Get(':id/bonus-history')
  @ApiOperation({ summary: 'Lịch sử thưởng' })
  async getBonusHistory(
    @Param('id') id: string,
    @Query('month') month?: string,
  ) {
    return this.storesService.getBonusHistory(id, month);
  }

  @Get(':id/penalty-history')
  @ApiOperation({ summary: 'Lịch sử phạt' })
  async getPenaltyHistory(
    @Param('id') id: string,
    @Query('month') month?: string,
  ) {
    return this.storesService.getPenaltyHistory(id, month);
  }

  @Get('employees/:employeeId/next-shift-assignment')
  @ApiOperation({ summary: 'Lấy ca tiếp theo hoặc ca đang active của nhân viên' })
  async getNextShiftAssignment(
    @Param('employeeId') employeeId: string,
    @Query('storeId') storeId: string,
  ) {
    return this.storesService.getNextShiftAssignment(employeeId, storeId);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SHIFT REGISTRATION (Nhân viên đăng ký ca)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  @Post('shift-registrations')
  @ApiOperation({
    summary: 'Nhân viên gửi đề xuất đăng ký ca làm việc',
    description: 'Nhân viên chọn ca và gửi yêu cầu để quản lý phê duyệt. Tạo một ShiftAssignment với status PENDING.',
  })
  @ApiResponse({ status: 201, description: 'Yêu cầu đăng ký ca đã được gửi' })
  async createShiftRegistration(
    @GetUser() user: any,
    @Body() body: {
      storeId: string;
      employeeProfileId: string;
      workShiftId?: string;
      slotId?: string;
      startDate?: string;
      endDate?: string;
      note?: string;
    },
  ) {
    return this.storesService.createShiftRegistration(user.userId, body);
  }

  @Get('shift-registrations')
  @ApiOperation({ summary: 'Lấy danh sách đề xuất đăng ký ca' })
  @ApiQuery({ name: 'storeId', required: false })
  @ApiQuery({ name: 'employeeProfileId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getShiftRegistrations(
    @Query('storeId') storeId?: string,
    @Query('employeeProfileId') employeeProfileId?: string,
    @Query('status') status?: string,
  ) {
    return this.storesService.getShiftRegistrations({ storeId, employeeProfileId, status });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SALARY INQUIRIES (Nhân viên hỏi về lương)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  @Post('employees/:profileId/salary-inquiries')
  @ApiOperation({
    summary: 'Gửi câu hỏi về lương tới quản lý',
    description: 'Nhân viên đặt câu hỏi liên quan đến lương thưởng. Câu hỏi được lưu và thông báo tới quản lý.',
  })
  @ApiResponse({ status: 201, description: 'Câu hỏi đã được gửi thành công' })
  async createSalaryInquiry(
    @Param('profileId') profileId: string,
    @GetUser() user: any,
    @Body() body: { question: string; month?: string },
  ) {
    return this.storesService.createSalaryInquiry(profileId, body.question, body.month);
  }

  @Get('employees/:profileId/salary-inquiries')
  @ApiOperation({ summary: 'Lấy danh sách câu hỏi lương của nhân viên' })
  async getSalaryInquiries(@Param('profileId') profileId: string) {
    return this.storesService.getSalaryInquiries(profileId);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SALARY SLIPS (Phiếu lương)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  @Post('employees/:profileId/salary-slips')
  @ApiOperation({
    summary: 'Yêu cầu xuất phiếu lương',
    description: 'Lấy dữ liệu phiếu lương của nhân viên cho tháng được chỉ định. Trả về dữ liệu lương chi tiết.',
  })
  @ApiResponse({ status: 200, description: 'Dữ liệu phiếu lương' })
  async createSalarySlip(
    @Param('profileId') profileId: string,
    @Body() body: { month: string },
  ) {
    return this.storesService.getSalarySlipData(profileId, body.month);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // KPI AI SUGGESTIONS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  @Post('kpi-ai-suggestions')
  @ApiOperation({
    summary: 'Gửi yêu cầu AI đề xuất KPI',
    description: 'AI phân tích lịch sử hiệu suất của nhân viên và đề xuất các mục tiêu KPI phù hợp.',
  })
  @ApiResponse({ status: 201, description: 'Yêu cầu đã được tiếp nhận, AI đang xử lý' })
  async requestKpiAiSuggestion(
    @GetUser() user: any,
    @Body() body: {
      storeId: string;
      employeeProfileId: string;
      context?: string;
    },
  ) {
    return this.storesService.requestKpiAiSuggestion(body);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SHIFT CHANGE REQUESTS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  @Post('shift-change-requests')
  @ApiOperation({ summary: 'Gửi yêu cầu đổi ca' })
  @ApiResponse({ status: 201, description: 'Yêu cầu đổi ca đã được gửi' })
  async createShiftChangeRequest(
    @Body() body: {
      storeId: string;
      employeeProfileId: string;
      currentShiftId?: string;
      requestedShiftId?: string;
      requestDate: string;
      reason?: string;
      attachments?: string[];
    },
  ) {
    return this.storesService.createShiftChangeRequest(body);
  }

  @Get('shift-change-requests')
  @ApiOperation({ summary: 'Lấy danh sách yêu cầu đổi ca' })
  @ApiQuery({ name: 'storeId', required: false })
  @ApiQuery({ name: 'employeeProfileId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getShiftChangeRequests(
    @Query('storeId') storeId?: string,
    @Query('employeeProfileId') employeeProfileId?: string,
    @Query('status') status?: string,
  ) {
    if (employeeProfileId) {
      return this.storesService.getShiftChangeRequestsByEmployee(employeeProfileId);
    }
    if (storeId) {
      return this.storesService.getShiftChangeRequestsByStore(
        storeId,
        status as ShiftChangeRequestStatus | undefined,
      );
    }
    return [];
  }

  @Patch('shift-change-requests/:id/approve')
  @ApiOperation({ summary: 'Phê duyệt yêu cầu đổi ca' })
  async approveShiftChangeRequest(
    @Param('id') id: string,
    @GetUser() user: any,
  ) {
    const profile = await this.storesService.getEmployeeByAccountId(user.id);
    return this.storesService.approveShiftChangeRequest(id, profile?.id);
  }

  @Patch('shift-change-requests/:id/reject')
  @ApiOperation({ summary: 'Từ chối yêu cầu đổi ca' })
  async rejectShiftChangeRequest(
    @Param('id') id: string,
    @GetUser() user: any,
    @Body() body: { reason?: string },
  ) {
    const profile = await this.storesService.getEmployeeByAccountId(user.id);
    return this.storesService.rejectShiftChangeRequest(id, profile?.id, body.reason);
  }

  @Patch('shift-change-requests/:id/cancel')
  @ApiOperation({ summary: 'Hủy yêu cầu đổi ca' })
  async cancelShiftChangeRequest(
    @Param('id') id: string,
    @GetUser() user: any,
  ) {
    const profile = await this.storesService.getEmployeeByAccountId(user.id);
    return this.storesService.cancelShiftChangeRequest(id, profile?.id);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // BONUS WORK REQUESTS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  @Post('bonus-work-requests')
  @ApiOperation({ summary: 'Gửi yêu cầu bổ sung công' })
  @ApiResponse({ status: 201, description: 'Yêu cầu bổ sung công đã được gửi' })
  async createBonusWorkRequest(
    @Body() body: {
      storeId: string;
      employeeProfileId: string;
      shiftSlotId?: string | null;
      requestDate: string;
      startTime?: string;
      endTime?: string;
      reason?: string;
      attachments?: string[];
    },
  ) {
    return this.storesService.createBonusWorkRequest(body);
  }

  @Get('bonus-work-requests')
  @ApiOperation({ summary: 'Lấy danh sách yêu cầu bổ sung công' })
  @ApiQuery({ name: 'storeId', required: false })
  @ApiQuery({ name: 'employeeProfileId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getBonusWorkRequests(
    @Query('storeId') storeId?: string,
    @Query('employeeProfileId') employeeProfileId?: string,
    @Query('status') status?: string,
  ) {
    if (employeeProfileId) {
      return this.storesService.getBonusWorkRequestsByEmployee(employeeProfileId);
    }
    if (storeId) {
      return this.storesService.getBonusWorkRequestsByStore(
        storeId,
        status as BonusWorkRequestStatus | undefined,
      );
    }
    return [];
  }

  @Patch('bonus-work-requests/:id/approve')
  @ApiOperation({ summary: 'Phê duyệt yêu cầu bổ sung công' })
  async approveBonusWorkRequest(
    @Param('id') id: string,
    @GetUser() user: any,
  ) {
    const profile = await this.storesService.getEmployeeByAccountId(user.id);
    return this.storesService.approveBonusWorkRequest(id, profile?.id);
  }

  @Patch('bonus-work-requests/:id/reject')
  @ApiOperation({ summary: 'Từ chối yêu cầu bổ sung công' })
  async rejectBonusWorkRequest(
    @Param('id') id: string,
    @GetUser() user: any,
    @Body() body: { reason?: string },
  ) {
    const profile = await this.storesService.getEmployeeByAccountId(user.id);
    return this.storesService.rejectBonusWorkRequest(id, profile?.id, body.reason);
  }

  @Patch('bonus-work-requests/:id/cancel')
  @ApiOperation({ summary: 'Hủy yêu cầu bổ sung công' })
  async cancelBonusWorkRequest(
    @Param('id') id: string,
    @GetUser() user: any,
  ) {
    const profile = await this.storesService.getEmployeeByAccountId(user.id);
    return this.storesService.cancelBonusWorkRequest(id, profile?.id);
  }
}

