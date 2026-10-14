import { Controller, Get, Post, Put, Delete, Patch, Body, UseGuards, Param, ParseUUIDPipe, Query, UseInterceptors, UploadedFile, UploadedFiles, NotFoundException, InternalServerErrorException, Optional, UnauthorizedException, Req, BadRequestException, Logger, Res } from '@nestjs/common';
import type { Response } from 'express';
import { extname } from 'path';
import * as fs from 'fs';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody, ApiQuery } from '@nestjs/swagger';
import { StoresService } from './stores.service';
import { CareerLadderService } from './career-ladder.service';
import { toSelfCareerHistory, toSelfEmployeeDetail } from './employee-detail-privacy';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoreAccessGuard } from './guards/store-access.guard';
import { StoreResourceAccessGuard } from './guards/store-resource-access.guard';
import { StoreOwnerOnlyGuard } from './guards/store-owner-only.guard';
import { StoreOwnerOnly } from './guards/store-owner-only.decorator';
import { resolveUploadedDocxPath } from './contract-template-file.utils';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { AccountsService } from '../accounts/accounts.service';
import { MailService } from '../mail/mail.service';
import { CreateManualEmployeeDto } from './dto/create-manual-employee.dto';
import { UpdateEmployeeByOwnerDto } from './dto/update-employee.dto';
import { StoreDiscoveryQueryDto } from './dto/store-discovery.dto';
import { AddExistingEmployeeDto, ExistingEmployeeCandidateQueryDto, LinkExistingEmployeeDto } from './dto/add-existing-employee.dto';
import { CreateStoreDto } from './dto/create-store.dto';
import { CreateProductDto } from './dto/inventory.dto';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateServiceItemRecipeDto } from './dto/service-item-recipe.dto';
import { CreateAssetExportTypeDto } from './dto/asset-export-type.dto';
import { CreateProductExportTypeDto } from './dto/product-export.dto';
import { StoreProbationSettingDto } from './dto/store-probation-setting.dto';
import { UpdateInternalRuleDto, InternalRuleResponseDto } from './dto/store-internal-rule.dto';
import { StorePermissionConfigDto } from './dto/store-permission-config.dto';
import { CreateOrderDto, CreateFnbServiceItemDto, CreateYieldServiceItemDto, CreatePersonalCareItemDto, CreatePetCareItemDto } from './dto/order-management.dto';
import { ContractTemplateResponseDto, CreateContractTemplateDto, UpdateContractTemplateDto } from './dto/contract-template.dto';
import { StoreResponseDto, EmployeeTypeResponseDto, StoreRoleResponseDto, EmployeeProfileResponseDto, ContractResponseDto, AssetResponseDto, ProductResponseDto, HomeRevenueSummaryResponseDto, DailyReportResponseDto, DailyReportForOwnerResponseDto, EventResponseDto, KpiTypeResponseDto, EmployeeBasicInfoResponseDto, EmployeeMonthlySummaryResponseDto, EmployeesWithStatisticsResponseDto, EmployeeDetailResponseDto, EmployeePerformanceReportResponseDto, ProgressionStageDto, DeleteEmployeeDto, PermanentDeleteEmployeeDto, RenewContractDto, UpdateDetailsContractDto, CreateStoreSkillDto, UpdateStoreSkillDto, StoreSkillResponseDto, MonthlySalaryFundResponseDto, EmployeePersonalInfoResponseDto, UpdatePersonalInfoDto } from './dto/store-response.dto';
import { resolveStoreRevenueDateRange, validateStoreReportDate } from './store-report-date.utils';
import { AssignAssetDto, ReturnAssetDto, ExchangeAssetDto, ReassignAssetDto } from './dto/employee-asset.dto';
import { FileFieldsInterceptor, FileInterceptor, AnyFilesInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { contractFileMulterConfig, identityImageUrl, mixedIdentityMulterConfig, multerConfig } from '../../common/utils/multer-config';
import { contractFileContentType } from '../../common/utils/contract-file';
import { AssetMultipartInterceptor, ProductMultipartInterceptor } from './interceptors/multipart.interceptor';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ShiftEndWorkflowService } from './shift-end-workflow.service';
import { effectiveReminderSettings } from './shift-reminder.utils';
import { StoreEventType } from './entities/store-event.entity';
import { KpiStatus } from './entities/employee-kpi.entity';
import { KpiRequestStatus } from './entities/kpi-approval-request.entity';
import { InventoryReportStatus } from './entities/inventory-report.entity';
import { StoreAccessResolver } from './guards/store-access.resolver';

@ApiTags('Cửa hàng & Vận hành (Stores)')
@ApiBearerAuth()
@Controller('stores')
// StoreAccessGuard scopes every store-addressed route (`:id/...`, `:storeId/...`)
// to the owner or a current employee of that store. Routes addressed by a
// sub-resource id pass through it untouched — see the guard's own docs.
// StoreOwnerOnlyGuard then restricts handlers marked @StoreOwnerOnly() to the
// store's owner (stores.owner_account_id); unmarked handlers pass through it.
@UseGuards(
  JwtAuthGuard,
  StoreAccessGuard,
  StoreResourceAccessGuard,
  StoreOwnerOnlyGuard,
)
export class StoresController {
  private readonly logger = new Logger(StoresController.name);

  constructor(
    private readonly storesService: StoresService,
    private readonly accountsService: AccountsService,
    private readonly mailService: MailService,
    @InjectQueue('attendance-background')
    private readonly attendanceQueue: Queue,
    private readonly shiftEndWorkflowService: ShiftEndWorkflowService,
    private readonly careerLadderService: CareerLadderService,
    // Optional only so unit doubles built with the six services above still
    // compile; assertStoreMember fails closed without it.
    @Optional() private readonly storeAccess?: StoreAccessResolver,
  ) {}

  /**
   * Tenancy for routes that take the store from the query string (the
   * path-based guards cannot see it): the owner or an employed member.
   */
  private async assertStoreMember(storeId: string, user: any): Promise<void> {
    if (!user?.userId) throw new UnauthorizedException();
    if (!this.storeAccess) {
      throw new InternalServerErrorException('Store access check unavailable');
    }
    await this.storeAccess.assertAccess(storeId, user.userId);
  }

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
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const storeData: any = {
      ...body,
      ownerAccountId: user.userId,
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

  @Get('discovery')
  @ApiOperation({ summary: 'Tìm cửa hàng cho tài khoản nhân viên chưa được gán' })
  async discoverStores(
    @GetUser() user: any,
    @Query() query: StoreDiscoveryQueryDto,
  ) {
    return this.storesService.discoverStores(user.userId, query);
  }

  @Get('monthly-salary-fund')
  @ApiOperation({
    summary:
      'Lấy tổng quỹ lương và dự kiến cần trả của tất cả stores theo tháng',
  })
  @ApiQuery({
    name: 'date',
    required: true,
    example: '04/2026',
    description: 'Tháng cần lấy báo cáo (MM/YYYY)',
  })
  @ApiResponse({ status: 200, type: MonthlySalaryFundResponseDto })
  async getMonthlySalaryFund(
    @GetUser() user: any,
    @Query('date') date: string,
  ) {
    return this.storesService.getMonthlySalaryFund(user.userId, date);
  }

  @Get('staff')
  @ApiOperation({
    summary: 'Lấy danh sách nhân viên của toàn bộ cửa hàng hoặc theo Store ID',
    description:
      'Nếu storeId không được truyền, hệ thống sẽ lấy toàn bộ nhân viên thuộc tất cả cửa hàng của Owner.',
  })
  @ApiQuery({
    name: 'storeId',
    required: false,
    description: 'ID của cửa hàng',
  })
  @ApiQuery({
    name: 'typeName',
    required: false,
    description: 'Lọc theo loại hình (Full-time, Part-time...)',
  })
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
    // Owner only: getEmployees() refuses a storeId the caller does not own.
    // This cannot use @StoreOwnerOnly(), which would refuse the no-storeId
    // form (the caller's own stores).
    return this.storesService.getEmployees(
      user.userId,
      sanitizedStoreId,
      typeName,
      isDeletedBool,
    );
  }

  // Employee KPI Management
  @Post('employee-kpis')
  @ApiOperation({ summary: 'Tạo bảng KPI cho nhân viên' })
  async createEmployeeKpi(@GetUser() user: any, @Body() body: any) {
    // The owner, or an employee for their own profile only; an employee's
    // KPI is always created as 'Nháp' (service-enforced).
    return this.storesService.createEmployeeKpi(body, user?.userId);
  }

  @Get('kpis')
  @ApiOperation({ summary: 'Lấy danh sách bảng KPI (có filter)' })
  async getEmployeeKpis(
    @GetUser() user: any,
    @Query('employeeProfileId') employeeProfileId?: string,
    @Query('storeId') storeId?: string,
    @Query('month') month?: string,
    @Query('rating') rating?: string,
  ) {
    return this.storesService.getEmployeeKpis(
      { employeeProfileId, storeId, month, rating },
      user?.userId,
    );
  }

  // Owner only: status decides what counts toward the career ladder.
  @StoreOwnerOnly()
  @Patch('employee-kpis/:id/status')
  @ApiOperation({
    summary: 'Cập nhật trạng thái bảng KPI (Tạm dừng, Đang áp dụng...)',
  })
  async updateEmployeeKpiStatus(
    @Param('id') id: string,
    @Body('status') status: KpiStatus,
  ) {
    return this.storesService.updateEmployeeKpiStatus(id, status);
  }

  @Post('employee-kpis/:id/duplicate')
  @ApiOperation({ summary: 'Nhân bản bảng KPI' })
  async duplicateEmployeeKpi(@GetUser() user: any, @Param('id') id: string) {
    // The owner, or the KPI's own employee while it is 'Nháp'.
    return this.storesService.duplicateEmployeeKpi(id, user?.userId);
  }

  @Delete('employee-kpis/:id')
  @ApiOperation({ summary: 'Xóa bảng KPI' })
  async deleteEmployeeKpi(@GetUser() user: any, @Param('id') id: string) {
    // The owner, or the KPI's own employee while it is 'Nháp'.
    return this.storesService.deleteEmployeeKpi(id, user?.userId);
  }

  @StoreOwnerOnly()
  @Patch('employee-kpis/:id/reminders')
  @ApiOperation({ summary: 'Cập nhật lời nhắc nhở cho KPI' })
  async updateKpiReminders(
    @Param('id') id: string,
    @Body('reminders') reminders: string,
  ) {
    return this.storesService.updateKpiReminders(id, reminders);
  }

  @StoreOwnerOnly()
  @Patch('employee-kpis/:id/compliments')
  @ApiOperation({ summary: 'Gửi lời khen cho nhân viên qua KPI' })
  async updateKpiCompliments(
    @Param('id') id: string,
    @Body('compliments') compliments: string,
  ) {
    return this.storesService.updateKpiCompliments(id, compliments);
  }

  // KPI Approval Requests
  @Post('kpi-approval-requests')
  @ApiOperation({ summary: 'Nhân viên gửi yêu cầu duyệt bảng KPI' })
  async createKpiApprovalRequest(
    @GetUser() user: any,
    @Body()
    body: {
      // Ignored: the employee is read from the KPI itself.
      employeeProfileId?: string;
      employeeKpiId: string;
      note?: string;
    },
  ) {
    return this.storesService.createKpiApprovalRequest(body, user?.userId);
  }

  @Get('kpi-approval-requests')
  @ApiOperation({ summary: 'Lấy danh sách yêu cầu duyệt KPI' })
  async getKpiApprovalRequests(
    @GetUser() user: any,
    @Query('storeId') storeId?: string,
    @Query('month') month?: string,
  ) {
    // With storeId: the owner sees the store's requests, an employee only
    // their own. Without it: the caller's owned stores plus their own KPIs
    // (never every tenant's).
    return this.storesService.getKpiApprovalRequests(
      storeId,
      month,
      user?.userId,
    );
  }

  @Patch('kpi-approval-requests/:id/handle')
  @ApiOperation({ summary: 'Chấp thuận hoặc Từ chối yêu cầu duyệt KPI' })
  async handleKpiApprovalRequest(
    @Param('id') id: string,
    @GetUser() user: any,
    @Body() body: { status: KpiRequestStatus; note?: string },
  ) {
    // Owner of the KPI's store only; the service resolves the reviewer's
    // employee profile from the account.
    return this.storesService.handleKpiApprovalRequest(id, user?.userId, body);
  }

  @Get('fnb-items')
  @ApiOperation({ summary: 'Lấy danh sách món F&B kèm thống kê theo danh mục' })
  async getFnbItems(
    @Query('storeId') storeId: string,
    @Query('categoryId') categoryId?: string,
    @GetUser() user?: any,
  ) {
    if (!storeId) throw new BadRequestException('storeId is required');
    await this.assertStoreMember(storeId, user);
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
    @GetUser() user?: any,
  ) {
    if (!storeId) throw new BadRequestException('storeId is required');
    await this.assertStoreMember(storeId, user);
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
  @ApiOperation({
    summary: 'Lấy danh sách dịch vụ Spa/Personal Care kèm thống kê',
  })
  async getPersonalCareItems(
    @Query('storeId') storeId: string,
    @Query('categoryId') categoryId?: string,
    @GetUser() user?: any,
  ) {
    if (!storeId) throw new BadRequestException('storeId is required');
    await this.assertStoreMember(storeId, user);
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
    @GetUser() user?: any,
  ) {
    if (!storeId) throw new BadRequestException('storeId is required');
    await this.assertStoreMember(storeId, user);
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
    @GetUser() user?: any,
  ) {
    // storeId is required: the owner sees the store's feedback, an employee
    // only their own. Without it this returned every tenant's rows.
    return this.storesService.getFeedbacksForViewer(user?.userId, {
      storeId,
      employeeProfileId,
      status: status as any,
    });
  }

  @Get('feedbacks/leaderboard')
  @ApiOperation({ summary: 'Bảng xếp hạng feedback nhân viên theo store' })
  @ApiQuery({ name: 'storeId', required: true })
  async getFeedbackLeaderboardEarly(
    @Query('storeId') storeId: string,
    @GetUser() user?: any,
  ) {
    if (!storeId) throw new BadRequestException('storeId is required');
    await this.assertStoreMember(storeId, user);
    return this.storesService.getFeedbackLeaderboard(storeId);
  }

  // KPI Task Management (MUST be above @Get(':id') to avoid route collision)
  @Post('kpi-tasks')
  @ApiOperation({ summary: 'Thêm nhiệm vụ vào bảng KPI' })
  async createKpiTask(@GetUser() user: any, @Body() body: any) {
    // The owner, or the KPI's own employee while it is 'Nháp'.
    return this.storesService.createKpiTask(body, user?.userId);
  }

  @Patch('kpi-tasks/:id/progress')
  @ApiOperation({ summary: 'Cập nhật tiến độ nhiệm vụ KPI' })
  async updateKpiTaskProgress(
    @GetUser() user: any,
    @Param('id') id: string,
    @Body('actualValue') actualValue: number,
  ) {
    // The owner, or the KPI's own employee (self-reported progress).
    return this.storesService.updateKpiTaskProgress(
      id,
      actualValue,
      user?.userId,
    );
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
    @GetUser() user?: any,
  ) {
    // Scoped to what the caller may see: a store they belong to, or a KPI
    // they own / manage. Unscoped, this listed every store's tasks.
    if (storeId) {
      await this.assertStoreMember(storeId, user);
    } else if (employeeKpiId) {
      await this.storesService.assertKpiReadAccess(employeeKpiId, user?.userId);
    } else {
      return [];
    }
    return this.storesService.getKpiTasks({
      employeeKpiId,
      storeId,
      isHidden:
        isHidden === 'true' ? true : isHidden === 'false' ? false : undefined,
    });
  }

  @Delete('kpi-tasks/:id')
  @ApiOperation({ summary: 'Xóa nhiệm vụ KPI' })
  async deleteKpiTask(@GetUser() user: any, @Param('id') id: string) {
    // The owner, or the KPI's own employee while it is 'Nháp'.
    return this.storesService.deleteKpiTask(id, user?.userId);
  }

  @Patch('kpi-tasks/:id/hide')
  @ApiOperation({ summary: 'Ẩn nhiệm vụ KPI' })
  async hideKpiTask(@GetUser() user: any, @Param('id') id: string) {
    // The owner, or the KPI's own employee while it is 'Nháp'.
    return this.storesService.hideKpiTask(id, user?.userId);
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

  @StoreOwnerOnly()
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
  async geocodeReverse(@Query('lat') lat: string, @Query('lng') lng: string) {
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

  // MUST stay above @Get(':id') — Express matches in registration order, so
  // a single-segment route declared after the catch-all is unreachable.
  @StoreOwnerOnly({ storeFrom: ['query'] })
  @Get('inventory-reports')
  @ApiOperation({ summary: 'Lấy danh sách báo cáo sự cố kho' })
  async getInventoryReports(
    @Query('storeId') storeId?: string,
    @Query('status') status?: InventoryReportStatus,
    @Query('type') type?: string,
  ) {
    // @StoreOwnerOnly() already refuses a request without an owned storeId;
    // never fall through to the unfiltered (all-tenant) query.
    if (!storeId) throw new BadRequestException('storeId is required');
    return this.storesService.getInventoryReports({ storeId, status, type });
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

  @StoreOwnerOnly()
  @Put(':id')
  @UseInterceptors(FileInterceptor('avatar', multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Cập nhật thông tin cửa hàng',
    description:
      'Chủ sở hữu hoặc Quản lý cập nhật thông tin cửa hàng (bao gồm ảnh đại diện)',
  })
  @ApiResponse({
    status: 200,
    description: 'Cửa hàng đã được cập nhật thành công',
    type: StoreResponseDto,
  })
  async updateStore(
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFile() file?: Express.Multer.File,
    @GetUser() user?: any,
  ) {
    const storeData: any = { ...body };

    // Handle avatar upload
    if (file) {
      storeData.avatarUrl = `/uploads/${file.filename}`;
    }

    // Remove the avatar field from body to avoid TypeORM errors
    delete storeData.avatar;

    return this.storesService.updateStore(id, storeData, user?.userId);
  }

  // Employee Types
  @StoreOwnerOnly()
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

  @StoreOwnerOnly()
  @Patch(':id/employee-types/:typeId')
  @ApiOperation({
    summary: 'Sửa một bậc trong lộ trình thăng tiến',
    description:
      'Loại nhân viên chính là bậc thăng tiến: level là thứ tự, các cột req* là điều kiện lên bậc.',
  })
  async updateEmployeeType(
    @Param('id') id: string,
    @Param('typeId', ParseUUIDPipe) typeId: string,
    @Body() body: any,
  ) {
    return this.storesService.updateEmployeeType(id, typeId, body);
  }

  @StoreOwnerOnly()
  @Delete(':id/employee-types/:typeId')
  @ApiOperation({
    summary: 'Gỡ một bậc khỏi lộ trình',
    description:
      'Còn nhân viên đang giữ bậc thì chỉ ẩn khỏi lộ trình, không xoá, để hồ sơ của họ không mất tham chiếu.',
  })
  async deleteEmployeeType(
    @Param('id') id: string,
    @Param('typeId', ParseUUIDPipe) typeId: string,
  ) {
    return this.storesService.deleteEmployeeType(id, typeId);
  }

  @StoreOwnerOnly()
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
  @StoreOwnerOnly()
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

  @StoreOwnerOnly()
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

  @StoreOwnerOnly()
  @Get(':id/permissions/templates')
  @ApiOperation({ summary: 'Lấy danh sách các mẫu phân quyền (Templates)' })
  async getPermissionTemplates(@Param('id') id: string) {
    return this.storesService.getPermissionTemplates(id);
  }

  @StoreOwnerOnly()
  @Get(':id/roles/:roleId/permissions')
  @ApiOperation({ summary: 'Lấy cấu hình phân quyền của vai trò' })
  @ApiResponse({ status: 200, description: 'Chi tiết cấu hình phân quyền' })
  async getRolePermissionConfig(
    @Param('id') id: string,
    @Param('roleId') roleId: string,
  ) {
    return this.storesService.getRolePermissionConfig(id, roleId);
  }

  @StoreOwnerOnly()
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
  @StoreOwnerOnly()
  @Post(':id/termination-reasons')
  @ApiOperation({ summary: 'Tạo lý do thôi việc' })
  async createTerminationReason(
    @Param('id') id: string,
    @Body('name') name: string,
  ) {
    return this.storesService.createTerminationReason(id, name);
  }

  @StoreOwnerOnly()
  @Get(':id/termination-reasons')
  @ApiOperation({ summary: 'Lấy danh sách lý do thôi việc' })
  async getTerminationReasons(@Param('id') id: string) {
    return this.storesService.getTerminationReasons(id);
  }

  @StoreOwnerOnly()
  @Put('termination-reasons/:reasonId')
  @ApiOperation({ summary: 'Cập nhật lý do thôi việc' })
  async updateTerminationReason(
    @Param('reasonId') reasonId: string,
    @Body('name') name: string,
  ) {
    return this.storesService.updateTerminationReason(reasonId, name);
  }

  @StoreOwnerOnly()
  @Delete('termination-reasons/:reasonId')
  @ApiOperation({ summary: 'Xóa lý do thôi việc' })
  async deleteTerminationReason(@Param('reasonId') reasonId: string) {
    return this.storesService.deleteTerminationReason(reasonId);
  }

  // --- Store Skills ---

  @StoreOwnerOnly()
  @Post(':id/skills')
  @ApiOperation({ summary: 'Tạo kỹ năng mới cho cửa hàng' })
  @ApiResponse({ status: 201, type: StoreSkillResponseDto })
  async createSkill(
    @Param('id') id: string,
    @Body() data: CreateStoreSkillDto,
  ) {
    return this.storesService.createSkill(id, data);
  }

  @StoreOwnerOnly()
  @Get(':id/skills')
  @ApiOperation({ summary: 'Lấy danh sách kỹ năng của cửa hàng' })
  @ApiResponse({ status: 200, type: [StoreSkillResponseDto] })
  async getSkills(@Param('id') id: string) {
    return this.storesService.getSkills(id);
  }

  @StoreOwnerOnly()
  @Put('skills/:skillId')
  @ApiOperation({ summary: 'Cập nhật kỹ năng' })
  @ApiResponse({ status: 200, type: StoreSkillResponseDto })
  async updateSkill(
    @Param('skillId') skillId: string,
    @Body() data: UpdateStoreSkillDto,
  ) {
    return this.storesService.updateSkill(skillId, data);
  }

  @StoreOwnerOnly()
  @Delete('skills/:skillId')
  @ApiOperation({ summary: 'Xóa kỹ năng' })
  @ApiResponse({ status: 200 })
  async deleteSkill(@Param('skillId') skillId: string) {
    return this.storesService.deleteSkill(skillId);
  }

  @StoreOwnerOnly()
  @Post('employees/:profileId/skill')
  @ApiOperation({ summary: 'Gắn kỹ năng cho nhân viên' })
  @ApiBody({
    schema: { properties: { skillId: { type: 'string', nullable: true } } },
  })
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
  async getEmployeeSkill(
    @Param('profileId') profileId: string,
    @GetUser() user: any,
  ) {
    await this.storesService.assertEmployeeRecordAccess(profileId, user.userId);
    return this.storesService.getEmployeeSkill(profileId);
  }

  // Probation Settings
  @StoreOwnerOnly()
  @Get(':id/probation-settings')
  @ApiOperation({ summary: 'Lấy cấu hình lộ trình thử việc' })
  async getProbationSetting(@Param('id') id: string) {
    return this.storesService.getProbationSetting(id);
  }

  @StoreOwnerOnly()
  @Put(':id/probation-settings')
  @ApiOperation({ summary: 'Cập nhật cấu hình lộ trình thử việc' })
  async updateProbationSetting(
    @Param('id') id: string,
    @Body() body: StoreProbationSettingDto,
  ) {
    return this.storesService.upsertProbationSetting(id, body);
  }

  // Employees
  @StoreOwnerOnly()
  @Get(':id/employee-account-candidate')
  @ApiOperation({ summary: 'Tìm tài khoản nhân viên có thể thêm vào cửa hàng' })
  async findExistingEmployeeCandidate(
    @GetUser() user: any,
    @Param('id') id: string,
    @Query() query: ExistingEmployeeCandidateQueryDto,
  ) {
    return this.storesService.findExistingEmployeeCandidate(
      id,
      user.userId,
      query.phone,
    );
  }

  @StoreOwnerOnly()
  @Post(':id/employees/from-account')
  @ApiOperation({ summary: 'Thêm nhân viên từ tài khoản đã đăng ký' })
  async addEmployeeFromAccount(
    @GetUser() user: any,
    @Param('id') id: string,
    @Body() body: AddExistingEmployeeDto,
  ) {
    return this.storesService.addEmployeeFromAccount(id, user.userId, body);
  }

  @StoreOwnerOnly()
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
    @GetUser() user: any,
    @Param('id') id: string,
    @Body() body: LinkExistingEmployeeDto,
  ) {
    return this.storesService.addEmployee(
      id,
      body.accountId,
      body,
      user.userId,
    );
  }

  @StoreOwnerOnly()
  @Get(':id/employees')
  @ApiOperation({ summary: 'Lấy danh sách nhân viên của cửa hàng' })
  @ApiQuery({
    name: 'typeName',
    required: false,
    description: 'Lọc theo tên loại hình nhân viên (VD: Full-time, Part-time)',
  })
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
    await this.storesService.assertOwnerStoreAccess(sanitizedId, user.userId);
    const isDeletedBool = isDeleted === 'true';
    return this.storesService.getEmployees(
      user.userId,
      sanitizedId,
      typeName,
      isDeletedBool,
    );
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
      mixedIdentityMulterConfig(['frontIdentification', 'backIdentification']),
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
    @GetUser() user: any,
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
      // CCCD scans are private; they are read back through the authenticated
      // identity-image route, never the public /uploads mount.
      frontIdentificationUrl: files.frontIdentification?.[0]
        ? identityImageUrl(files.frontIdentification[0].filename)
        : undefined,
      backIdentificationUrl: files.backIdentification?.[0]
        ? identityImageUrl(files.backIdentification[0].filename)
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
      user.userId,
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
  async getEmployeeById(
    @Param('profileId') profileId: string,
    @GetUser() user: any,
  ) {
    // Owner-or-self: a coworker must not read identity, bank or contracts.
    const { isOwner } = await this.storesService.assertEmployeeRecordAccess(
      profileId,
      user.userId,
    );
    const result = await this.storesService.getEmployeeById(profileId);
    if (!result) {
      throw new NotFoundException('Không tìm thấy nhân viên');
    }
    return isOwner ? result : toSelfEmployeeDetail(result);
  }

  @Get(':id/me/reminder-settings')
  @ApiOperation({
    summary: 'Lấy cài đặt nhắc nhở ca làm (Dành cho nhân viên hiện tại)',
  })
  async getMyReminderSettings(
    @GetUser() user: any,
    @Param('id') storeId: string,
  ) {
    const profile = await this.storesService.getEmployeeByAccountAndStore(
      user.userId,
      storeId,
    );
    if (!profile) {
      throw new NotFoundException('Không tìm thấy nhân viên');
    }
    return {
      success: true,
      // Chưa lưu gì: nhắc trước 15 phút, có rung (thông báo đi qua kênh
      // Android có rung), nhắc nếu chưa check-in, báo ca mới — đúng như lịch
      // nhắc thực sự được xếp (effectiveReminderSettings).
      reminderSettings: effectiveReminderSettings(profile.reminderSettings),
    };
  }

  @Get(':id/me/personal-info')
  @ApiOperation({
    summary: 'Lấy thông tin cá nhân của người dùng tại cửa hàng hiện tại',
    description:
      'Lấy các thông tin cá nhân như Họ tên, Giới tính, CCCD, Ngân hàng... theo ngữ cảnh của cửa hàng (Role và StoreName)',
  })
  @ApiResponse({
    status: 200,
    description: 'Thông tin cá nhân chi tiết',
    type: EmployeePersonalInfoResponseDto,
  })
  async getMyPersonalInfo(@GetUser() user: any, @Param('id') id: string) {
    const result = await this.storesService.getMyPersonalInfoInStore(
      id,
      user.userId,
    );
    if (!result) {
      throw new NotFoundException('Không tìm thấy thông tin');
    }
    return result;
  }

  @Put(':id/me/personal-info')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'avatar', maxCount: 1 },
        { name: 'frontImage', maxCount: 1 },
        { name: 'backImage', maxCount: 1 },
      ],
      mixedIdentityMulterConfig(['frontImage', 'backImage']),
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Cập nhật thông tin cá nhân của người dùng hiện tại (kèm ảnh)',
    description:
      'Cập nhật các trường thông tin Họ tên, SĐT, Email, CCCD, Ngân hàng và tải lên ảnh avatar, CCCD mặt trước/sau.',
  })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật thành công',
  })
  async updateMyPersonalInfo(
    @GetUser() user: any,
    @Body() body: UpdatePersonalInfoDto,
    @UploadedFiles()
    files: {
      avatar?: Express.Multer.File[];
      frontImage?: Express.Multer.File[];
      backImage?: Express.Multer.File[];
    },
  ) {
    const data: any = { ...body };
    // Image URLs only ever come from files uploaded in this request. A text
    // part named frontImage/backImage would otherwise let a caller point their
    // identity record at someone else's private scan and then read it.
    delete data.avatar;
    delete data.frontImage;
    delete data.backImage;
    if (files.avatar?.[0]) data.avatar = `/uploads/${files.avatar[0].filename}`;
    if (files.frontImage?.[0])
      data.frontImage = identityImageUrl(files.frontImage[0].filename);
    if (files.backImage?.[0])
      data.backImage = identityImageUrl(files.backImage[0].filename);

    return this.storesService.updateMyPersonalInfoInStore(user.userId, data);
  }

  @StoreOwnerOnly()
  @Patch('employees/:profileId')
  @ApiOperation({
    summary: 'Chủ cửa hàng sửa thông tin nhân viên',
    description:
      'Thông tin tài khoản (họ tên, giới tính, ngày sinh, email, địa chỉ, tình trạng hôn nhân, CCCD, ngân hàng — không gồm số điện thoại) và hồ sơ tại cửa hàng (hình thức làm việc, ca mặc định). Không gửi = giữ nguyên, null / "" = xoá.',
  })
  async updateEmployee(
    @GetUser() user: any,
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Body() dto: UpdateEmployeeByOwnerDto,
  ) {
    return this.storesService.updateEmployeeByOwner(profileId, dto, user.userId);
  }

  @StoreOwnerOnly()
  @Delete('employees/:profileId')
  @ApiOperation({
    summary: 'Xóa nhân viên (Soft Delete)',
    description:
      'Cập nhật trạng thái terminated và thực hiện soft delete nhân viên. Yêu cầu mật khẩu xác nhận.',
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
    return this.storesService.deleteEmployee(
      profileId,
      body.reasonId,
      user.userId,
    );
  }

  @StoreOwnerOnly()
  @Delete('employees/:profileId/permanent')
  @ApiOperation({
    summary: 'Xóa nhân viên vĩnh viễn',
    description:
      'Xóa hoàn toàn dữ liệu nhân viên khỏi hệ thống. Yêu cầu mật khẩu xác nhận.',
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
    return this.storesService.permanentDeleteEmployee(profileId, user.userId);
  }

  @StoreOwnerOnly()
  @Post('employees/:profileId/restore')
  @ApiOperation({
    summary: 'Khôi phục nhân viên',
    description:
      'Khôi phục nhân viên đã bị soft delete quay lại trạng thái active.',
  })
  @ApiResponse({
    status: 200,
    description: 'Nhân viên đã được khôi phục thành công',
  })
  async restoreEmployee(
    @GetUser() user: any,
    @Param('profileId') profileId: string,
  ) {
    return this.storesService.restoreEmployee(profileId, user.userId);
  }

  @Get('employees/:profileId/performance')
  @ApiOperation({
    summary: 'Lấy báo cáo hiệu suất và lộ trình thăng tiến của nhân viên',
    description:
      'Bao gồm điểm hiệu suất, giờ làm, KPI, thâm niên và lộ trình thăng tiến sắp tới',
  })
  @ApiResponse({
    status: 200,
    description: 'Báo cáo hiệu suất chi tiết',
    type: EmployeePerformanceReportResponseDto,
  })
  async getEmployeePerformance(
    @Param('profileId') profileId: string,
    @GetUser() user: any,
  ) {
    await this.storesService.assertEmployeeRecordAccess(profileId, user.userId);
    // `progression` được ghép ở đây thay vì trong StoresService: nó cần lộ
    // trình, còn StoresService thì không nên nhận thêm phụ thuộc nào nữa.
    const report = await this.storesService.getEmployeePerformance(profileId);
    const progression =
      await this.careerLadderService.getProgressionSummaryByProfileId(profileId);
    return {
      ...report,
      progression: { ...progression, rankInPosition: report.rankInPosition },
    };
  }

  @Get('employees/:profileId/progression')
  @ApiOperation({
    summary: 'Lấy lộ trình thăng tiến chi tiết',
    description:
      'Trả về danh sách các giai đoạn thăng tiến, yêu cầu và tiến độ hiện tại',
  })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết lộ trình thăng tiến',
    type: [ProgressionStageDto],
  })
  async getEmployeeProgression(
    @Param('profileId') profileId: string,
    @GetUser() user: any,
  ) {
    await this.storesService.assertEmployeeRecordAccess(profileId, user.userId);
    // Vẫn là một mảng trần đúng như app chủ đang đọc bằng `setStages(res)`;
    // chỉ nguồn tính đổi sang máy đánh giá của lộ trình.
    return this.careerLadderService.getProgressionStages(profileId);
  }

  // --- Lộ trình thăng tiến ---
  //
  // StoreAccessGuard và StoreResourceAccessGuard chỉ kiểm "tài khoản có thuộc
  // cửa hàng này không" — chúng cho qua cả nhân viên đang làm, không nhìn vai
  // trò. Mọi route dưới đây đều là việc của chủ, nên route nào cũng tự gọi
  // assertOwnerStoreAccess như các route nhạy cảm khác trong controller này.
  // Service còn kiểm lại `storeId` của lộ trình và bậc thêm một lần nữa.

  /**
   * Route theo hồ sơ không mang id cửa hàng, nên phải tra cửa hàng của hồ sơ
   * trước rồi mới kiểm được người gọi có phải chủ không.
   */
  private async assertOwnerOfProfile(profileId: string, accountId: string) {
    const storeId = await this.careerLadderService.storeIdOfProfile(profileId);
    await this.storesService.assertOwnerStoreAccess(storeId, accountId);
  }

  @StoreOwnerOnly()
  @Get(':id/ladders')
  @ApiOperation({ summary: 'Danh sách lộ trình của cửa hàng' })
  async getLadders(@Param('id') storeId: string, @GetUser() user: any) {
    await this.storesService.assertOwnerStoreAccess(storeId, user.userId);
    return this.careerLadderService.getLadders(storeId);
  }

  @StoreOwnerOnly()
  @Post(':id/ladders')
  @ApiOperation({ summary: 'Tạo lộ trình cho một tác nhân' })
  async createLadder(
    @Param('id') storeId: string,
    @Body() body: any,
    @GetUser() user: any,
  ) {
    await this.storesService.assertOwnerStoreAccess(storeId, user.userId);
    return this.careerLadderService.createLadder(storeId, body);
  }

  @StoreOwnerOnly()
  @Post(':id/ladders/:ladderId/rungs')
  @ApiOperation({ summary: 'Thêm một bậc vào lộ trình' })
  async createRung(
    @Param('id') storeId: string,
    @Param('ladderId') ladderId: string,
    @Body() body: any,
    @GetUser() user: any,
  ) {
    await this.storesService.assertOwnerStoreAccess(storeId, user.userId);
    return this.careerLadderService.createRung(storeId, ladderId, body);
  }

  @StoreOwnerOnly()
  @Patch(':id/rungs/:rungId')
  @ApiOperation({ summary: 'Sửa một bậc' })
  async updateRung(
    @Param('id') storeId: string,
    @Param('rungId') rungId: string,
    @Body() body: any,
    @GetUser() user: any,
  ) {
    await this.storesService.assertOwnerStoreAccess(storeId, user.userId);
    return this.careerLadderService.updateRung(storeId, rungId, body);
  }

  @StoreOwnerOnly()
  @Delete(':id/rungs/:rungId')
  @ApiOperation({ summary: 'Gỡ một bậc khỏi lộ trình' })
  async deleteRung(
    @Param('id') storeId: string,
    @Param('rungId') rungId: string,
    @GetUser() user: any,
  ) {
    await this.storesService.assertOwnerStoreAccess(storeId, user.userId);
    return this.careerLadderService.deleteRung(storeId, rungId);
  }

  @StoreOwnerOnly()
  @Put(':id/rungs/:rungId/criteria')
  @ApiOperation({ summary: 'Đặt lại toàn bộ điều kiện để vào một bậc' })
  async setRungCriteria(
    @Param('id') storeId: string,
    @Param('rungId') rungId: string,
    @Body() body: any,
    @GetUser() user: any,
  ) {
    await this.storesService.assertOwnerStoreAccess(storeId, user.userId);
    return this.careerLadderService.setRungCriteria(
      storeId,
      rungId,
      body?.items ?? [],
    );
  }

  @StoreOwnerOnly()
  @Put(':id/rungs/:rungId/next')
  @ApiOperation({
    summary: 'Đặt lại các bậc đi tiếp được từ một bậc',
    description:
      'Đây là cách khai phân nhánh: mỗi bậc chọn nhiều bậc có thể lên tiếp.',
  })
  async setRungNextRungs(
    @Param('id') storeId: string,
    @Param('rungId') rungId: string,
    @Body() body: any,
    @GetUser() user: any,
  ) {
    await this.storesService.assertOwnerStoreAccess(storeId, user.userId);
    return this.careerLadderService.setRungNextRungs(
      storeId,
      rungId,
      body?.nextRungIds ?? [],
    );
  }

  @Get('employees/:profileId/career-summary')
  @ApiOperation({
    summary: 'Tóm tắt lộ trình của chính nhân viên (cho app nhân viên)',
    description:
      'Chủ cửa hàng hoặc chính nhân viên đó mới xem được; đồng nghiệp bị từ chối.',
  })
  async getCareerSummary(
    @Param('profileId') profileId: string,
    @GetUser() user: any,
  ) {
    await this.careerLadderService.assertCanViewOwnCareer(profileId, user.userId);
    return this.careerLadderService.getCareerSummary(profileId);
  }

  @Get('employees/:profileId/career-history')
  @ApiOperation({
    summary: 'Lịch sử nghề nghiệp của nhân viên',
    description:
      'Chủ cửa hàng hoặc chính nhân viên đó (khi còn làm). Nhân viên tự xem thì `note` của chủ trả về null.',
  })
  async getCareerHistory(
    @Param('profileId') profileId: string,
    @GetUser() user: any,
  ) {
    // Same owner-or-employed-self rule as assertCanViewOwnCareer, but also
    // tells us whether the reader is the owner (to hide the owner's notes).
    const { isOwner } = await this.storesService.assertEmployeeRecordAccess(
      profileId,
      user.userId,
      undefined,
      'Bạn chỉ có thể xem lộ trình của chính mình',
    );
    const history = await this.careerLadderService.getCareerHistory(profileId);
    return isOwner ? history : toSelfCareerHistory(history);
  }

  @Get('employees/:profileId/next-rungs/:ladderId')
  @ApiOperation({
    summary: 'Các bậc kế tiếp và tiến độ trên một lộ trình',
    description: 'Chủ cửa hàng hoặc chính nhân viên đó (khi còn làm).',
  })
  async getNextRungs(
    @Param('profileId') profileId: string,
    @Param('ladderId') ladderId: string,
    @GetUser() user: any,
  ) {
    await this.careerLadderService.assertCanViewOwnCareer(profileId, user.userId);
    return this.careerLadderService.nextRungs(profileId, ladderId);
  }

  @StoreOwnerOnly()
  @Post('employees/:profileId/advance')
  @ApiOperation({
    summary: 'Nâng nhân viên lên một bậc',
    description:
      'Đường duy nhất được phép đổi loại nhân viên, vị trí hay kỹ năng của hồ sơ.',
  })
  async advanceEmployee(
    @Param('profileId') profileId: string,
    @Body() body: any,
    @GetUser() user: any,
  ) {
    // Không có kiểm tra này thì một nhân viên gửi `force: true` lên chính hồ
    // sơ của mình là tự thăng chức, bỏ qua mọi điều kiện: cả hai guard chỉ
    // kiểm "có thuộc cửa hàng không", không kiểm vai trò.
    await this.assertOwnerOfProfile(profileId, user.userId);
    return this.careerLadderService.advance(profileId, body?.rungId, user.userId, {
      note: body?.note ?? null,
      checklistResults: body?.checklistResults,
      force: body?.force === true,
    });
  }

  @StoreOwnerOnly()
  @Get('employees/:profileId/capability-points')
  @ApiOperation({ summary: 'Lịch sử chấm điểm năng lực' })
  async getCapabilityEntries(
    @Param('profileId') profileId: string,
    @GetUser() user: any,
  ) {
    await this.assertOwnerOfProfile(profileId, user.userId);
    return this.careerLadderService.getCapabilityEntries(profileId);
  }

  @StoreOwnerOnly()
  @Post('employees/:profileId/capability-points')
  @ApiOperation({ summary: 'Chủ cộng hoặc trừ điểm năng lực kèm lý do' })
  async awardCapabilityPoints(
    @Param('profileId') profileId: string,
    @Body() body: any,
    @GetUser() user: any,
  ) {
    await this.assertOwnerOfProfile(profileId, user.userId);
    return this.careerLadderService.awardCapabilityPoints(
      profileId,
      Number(body?.points),
      body?.reason ?? null,
      user.userId,
    );
  }

  @StoreOwnerOnly()
  @Post('employees/contracts/:contractId/renew')
  @ApiOperation({
    summary: 'Gia hạn hợp đồng',
    description:
      'Archive hợp đồng cũ và tạo hợp đồng mới với thông tin cập nhật',
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

  /**
   * The signed file of an active contract (a renewal starts without one). It
   * is stored privately; contractFileUrl points at the owner-only read below.
   */
  @StoreOwnerOnly()
  @Post('employees/contracts/:contractId/file')
  @UseInterceptors(FileInterceptor('contractFile', contractFileMulterConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Tải file hợp đồng đã ký',
    description:
      'PDF, DOC, DOCX, JPG hoặc PNG, tối đa 20MB; thay file cũ của hợp đồng',
  })
  async uploadContractFile(
    @Param('contractId') contractId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Chọn file hợp đồng để tải lên');
    }
    return this.storesService.attachContractFile(contractId, file);
  }

  @StoreOwnerOnly()
  @Get('employees/contracts/:contractId/file')
  @ApiOperation({ summary: 'Xem file hợp đồng đã ký (chỉ chủ cửa hàng)' })
  async getContractFile(
    @Param('contractId') contractId: string,
    @Res() res: Response,
  ) {
    const path = await this.storesService.getContractFilePath(contractId);
    res.setHeader('Content-Type', contractFileContentType(path));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="hop-dong${extname(path)}"`,
    );
    fs.createReadStream(path).pipe(res);
  }

  @StoreOwnerOnly()
  @Put('employees/contracts/:contractId')
  @ApiOperation({
    summary: 'Cập nhật thông tin hợp đồng',
    description:
      'Chỉnh sửa trực tiếp thông tin trên hợp đồng (Sửa sai, bổ sung thông tin)',
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

  // --- Employee Asset Management ---

  @Get('employees/:profileId/assets')
  @ApiOperation({
    summary: 'Lấy danh sách tài sản của nhân viên',
    description:
      'Lấy các tài sản đang được cấp phát cho nhân viên theo profileId',
  })
  async getEmployeeAssets(
    @Param('profileId') profileId: string,
    @GetUser() user: any,
  ) {
    await this.storesService.assertEmployeeRecordAccess(profileId, user.userId);
    return this.storesService.getEmployeeAssets(profileId);
  }

  @StoreOwnerOnly()
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
    // The acting user, not a hardcoded identity. Null when the caller has no
    // employee profile in that store (e.g. the owner); the audit column is
    // nullable, so an unknown actor is recorded as unknown rather than as
    // somebody else.
    const managerProfileId =
      (await this.storesService.resolveActingProfileId(
        req?.user?.userId,
        profileId,
      )) ?? undefined;
    return this.storesService.assignAssetToEmployee(
      profileId,
      body.assetId,
      body.quantity,
      body.note,
      managerProfileId,
      body.dueDate,
      req?.user?.userId,
    );
  }

  @StoreOwnerOnly()
  @Put('employees/assets/:assignmentId/exchange')
  @ApiOperation({
    summary: 'Đổi tài sản (Trả A lấy B)',
    description:
      'Thu hồi tài sản đang sử dụng và cấp phát tài sản mới cho nhân viên',
  })
  async exchangeAsset(
    @Param('assignmentId') assignmentId: string,
    @Body() body: ExchangeAssetDto,
    @Req() req,
  ) {
    const managerProfileId =
      (await this.storesService.resolveActingProfileIdForAssignment(
        req?.user?.userId,
        assignmentId,
      )) ?? undefined;
    return this.storesService.exchangeAsset(
      assignmentId,
      body.newAssetId,
      body.quantity || 1,
      body.note,
      managerProfileId,
      body.dueDate,
      req?.user?.userId,
    );
  }

  @StoreOwnerOnly()
  @Put('employees/assets/:assignmentId/return')
  @ApiOperation({
    summary: 'Thu hồi tài sản',
    description:
      'Cập nhật trạng thái thu hồi tài sản và hoàn lại tồn kho nếu cần',
  })
  async returnAsset(
    @Param('assignmentId') assignmentId: string,
    @Body() body: ReturnAssetDto,
    @GetUser() user?: any,
  ) {
    return this.storesService.returnAsset(
      assignmentId,
      body.status,
      body.returnNote,
      user?.userId,
    );
  }

  @StoreOwnerOnly()
  @Post('employees/assets/:assignmentId/reassign')
  @ApiOperation({
    summary: 'Cấp lại tài sản',
    description:
      'Cấp lại một tài sản đã từng được thu hồi trước đó cho nhân viên',
  })
  async reassignAsset(
    @Param('assignmentId') assignmentId: string,
    @Body() body: ReassignAssetDto,
    @Req() req,
  ) {
    const managerProfileId =
      (await this.storesService.resolveActingProfileIdForAssignment(
        req?.user?.userId,
        assignmentId,
      )) ?? undefined;
    return this.storesService.reassignAsset(
      assignmentId,
      body.quantity,
      body.note,
      managerProfileId,
      body.dueDate,
      req?.user?.userId,
    );
  }

  @StoreOwnerOnly({ bodyResources: [{ field: 'ids', resource: 'employees' }] })
  @Post('employees/basic-info')
  @ApiOperation({
    summary: 'Lấy thông tin cơ bản của danh sách nhân viên',
    description:
      'Truyền vào mảng IDs để lấy Tên, Ảnh, Vai trò và Loại nhân viên',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          example: ['eb3c9aaa-099e-4425-a12e-02f6dc2672f4'],
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Danh sách thông tin cơ bản nhân viên',
    type: [EmployeeBasicInfoResponseDto],
  })
  async getEmployeesBasicInfo(@Body('ids') ids: string[]) {
    return this.storesService.getEmployeesBasicInfo(ids);
  }

  @StoreOwnerOnly()
  @Get(':id/employees/monthly-summaries')
  @ApiOperation({
    summary: 'Lấy thống kê tháng của nhân viên',
    description:
      'Lấy thống kê chấm công và lương tạm tính theo tháng cho tất cả nhân viên trong cửa hàng',
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

  // Contracts
  @StoreOwnerOnly()
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
  async getLatestContract(
    @Param('profileId') profileId: string,
    @GetUser() user: any,
  ) {
    await this.storesService.assertEmployeeRecordAccess(profileId, user.userId);
    return this.storesService.getLatestContract(profileId);
  }

  // ==================== CONTRACT TEMPLATES ====================
  @StoreOwnerOnly()
  @Get(':id/contract-templates')
  @ApiOperation({ summary: 'Lấy danh sách mẫu hợp đồng của cửa hàng' })
  @ApiResponse({
    status: 200,
    description: 'Danh sách mẫu hợp đồng',
    type: [ContractTemplateResponseDto],
  })
  async getContractTemplates(@Param('id') id: string) {
    return this.storesService.getContractTemplates(id);
  }

  @StoreOwnerOnly()
  @Get('contract-templates/:templateId')
  @ApiOperation({ summary: 'Lấy thông tin một mẫu hợp đồng' })
  @ApiResponse({
    status: 200,
    description: 'Thông tin mẫu hợp đồng',
    type: ContractTemplateResponseDto,
  })
  async getContractTemplate(@Param('templateId') templateId: string) {
    return this.storesService.getContractTemplate(templateId);
  }

  @StoreOwnerOnly()
  @Post(':id/contract-templates')
  @ApiOperation({ summary: 'Tạo mẫu hợp đồng mới' })
  @ApiResponse({
    status: 201,
    description: 'Tạo thành công',
    type: ContractTemplateResponseDto,
  })
  async createContractTemplate(
    @Param('id') id: string,
    @Body() body: CreateContractTemplateDto,
  ) {
    return this.storesService.createContractTemplate(id, body);
  }

  @StoreOwnerOnly()
  @Put('contract-templates/:templateId')
  @ApiOperation({ summary: 'Cập nhật mẫu hợp đồng' })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật thành công',
    type: ContractTemplateResponseDto,
  })
  async updateContractTemplate(
    @Param('templateId') templateId: string,
    @Body() body: UpdateContractTemplateDto,
  ) {
    return this.storesService.updateContractTemplate(templateId, body);
  }

  @StoreOwnerOnly()
  @Delete('contract-templates/:templateId')
  @ApiOperation({ summary: 'Xóa mẫu hợp đồng (xóa mềm)' })
  @ApiResponse({ status: 200, description: 'Xóa thành công' })
  async deleteContractTemplate(@Param('templateId') templateId: string) {
    return this.storesService.deleteContractTemplate(templateId);
  }

  @Post('contract-templates/upload')
  @UseInterceptors(FileInterceptor('file', multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload file mẫu hợp đồng',
    description: 'Upload file PDF hoặc DOCX làm mẫu hợp đồng. Trả về URL file.',
  })
  @ApiResponse({ status: 201, description: 'Upload thành công' })
  async uploadContractTemplateFile(
    @UploadedFile() file: Express.Multer.File,
    @GetUser() user: any,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    // No store in the request (multipart), so @StoreOwnerOnly() cannot scope
    // it: contract templates are owner tooling, so require a store owner and
    // discard the upload otherwise.
    try {
      await this.storesService.assertOwnsAnyStore(user?.userId);
    } catch (error) {
      if (file.path) {
        await fs.promises.unlink(file.path).catch(() => undefined);
      }
      throw error;
    }
    return {
      fileUrl: `/uploads/${file.filename}`,
      fileType: file.originalname.endsWith('.pdf')
        ? 'pdf'
        : file.originalname.endsWith('.docx')
          ? 'docx'
          : 'unknown',
      originalName: file.originalname,
      size: file.size,
    };
  }

  @Post('contract-templates/extract-placeholders')
  @ApiOperation({
    summary: 'Trích xuất placeholder từ file DOCX',
    description:
      'Đọc file DOCX đã upload và trích xuất danh sách {{placeholder}}',
  })
  @ApiResponse({ status: 200, description: 'Danh sách placeholder' })
  async extractPlaceholdersFromFile(
    @Body() body: { fileUrl: string },
    @GetUser() user: any,
  ) {
    await this.storesService.assertOwnsAnyStore(user?.userId);
    // Resolves inside ./uploads only (no `../`, absolute paths or symlinks out).
    const filePath = resolveUploadedDocxPath(body?.fileUrl);
    return this.storesService.extractPlaceholdersFromDocx(filePath);
  }

  // Assets
  @Post(':id/assets')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(AssetMultipartInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Thêm tài sản (Bulk Create)',
    description:
      'Thêm một hoặc nhiều tài sản cùng lúc kèm ảnh (avatar_0, invoice_0...)',
  })
  @ApiResponse({
    status: 201,
    description: 'Tài sản được tạo thành công',
    type: AssetResponseDto,
  })
  async uploadStoreAssetsBulk(@Param('id') id: string, @Req() req: any) {
    const assetsStr = req.body?.assets;
    const files = req.files || [];

    let assetsData = [];
    try {
      assetsData = JSON.parse(assetsStr);
      if (!Array.isArray(assetsData)) throw new Error();
    } catch (e) {
      throw new BadRequestException(
        'Trường "assets" phải là một chuỗi JSON Array hợp lệ',
      );
    }

    return this.storesService.createAssetsBulk(id, assetsData, files);
  }

  @StoreOwnerOnly({ storeFrom: ['query'] })
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

  @StoreOwnerOnly({ storeFrom: ['query'] })
  @Get('assets/export-report')
  @ApiOperation({ summary: 'Báo cáo tổng hợp xuất kho tài sản' })
  async getAssetExportReport(
    @Query('storeId') storeId: string,
    @Query('date') date?: string, // YYYY-MM-DD
    @Query('assetExportTypeId') assetExportTypeId?: string,
  ) {
    if (!storeId) throw new BadRequestException('storeId là bắt buộc');
    return this.storesService.getAssetExportReport(storeId, {
      date,
      assetExportTypeId,
    });
  }

  // --- Hàng hóa (Product) Reports ---

  @StoreOwnerOnly({ storeFrom: ['query'] })
  @Get('products/report')
  @ApiOperation({ summary: 'Báo cáo tổng hợp hàng hóa (Dashboard)' })
  async getProductReport(
    @Query('storeId') storeId: string,
    @Query('date') date?: string,
    @Query('productStatusId') productStatusId?: string,
  ) {
    if (!storeId) throw new BadRequestException('storeId là bắt buộc');
    return this.storesService.getProductReport(storeId, {
      date,
      productStatusId,
    });
  }

  @StoreOwnerOnly({ storeFrom: ['query'] })
  @Get('products/export-report')
  @ApiOperation({ summary: 'Báo cáo tổng hợp xuất kho hàng hóa' })
  async getProductExportReport(
    @Query('storeId') storeId: string,
    @Query('date') date?: string,
    @Query('productExportTypeId') productExportTypeId?: string,
  ) {
    if (!storeId) throw new BadRequestException('storeId là bắt buộc');
    return this.storesService.getProductExportReport(storeId, {
      date,
      productExportTypeId,
    });
  }

  @StoreOwnerOnly()
  @Get(':id/product-export-types')
  @ApiOperation({ summary: 'Lấy danh sách loại xuất kho hàng hóa' })
  async getProductExportTypes(@Param('id') id: string) {
    return this.storesService.getProductExportTypes(id);
  }

  @StoreOwnerOnly()
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
    @GetUser() user: any,
    @Body() body: any,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    let data = body;
    if (typeof body.items === 'string') {
      try {
        data = { items: JSON.parse(body.items) };
      } catch (e) {
        throw new BadRequestException(
          'Trường "items" phải là một chuỗi JSON Array hợp lệ',
        );
      }
    }
    // Every item must name one store the caller belongs to (service-checked).
    return this.storesService.exportProductsBulk(data, files, user?.userId);
  }

  @StoreOwnerOnly()
  @Delete('stock-transactions/:transactionId')
  @ApiOperation({ summary: 'Xóa giao dịch kho và hoàn tác tồn kho' })
  @ApiResponse({ status: 200, description: 'Xóa thành công' })
  async deleteStockTransaction(@Param('transactionId') transactionId: string) {
    return this.storesService.deleteStockTransaction(transactionId);
  }

  @StoreOwnerOnly()
  @Get(':id/asset-export-types')
  @ApiOperation({ summary: 'Lấy danh sách loại xuất kho tài sản' })
  async getAssetExportTypes(@Param('id') id: string) {
    return this.storesService.getAssetExportTypes(id);
  }

  @StoreOwnerOnly()
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
    @GetUser() user: any,
    @Body() body: any,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const data = { ...body };

    // Xử lý parse JSON cho danh sách items
    if (typeof data.items === 'string') {
      try {
        data.items = JSON.parse(data.items);
      } catch (e) {
        throw new BadRequestException(
          'Trường "items" phải là một chuỗi JSON Array hợp lệ',
        );
      }
    }

    // Every item must name one store the caller belongs to (service-checked).
    return this.storesService.exportAssetsBulk(data, files, user?.userId);
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

  @StoreOwnerOnly()
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

  @StoreOwnerOnly()
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
    description:
      'Thêm một hoặc nhiều hàng hóa cùng lúc kèm ảnh (avatar_0, avatar_1...)',
  })
  @ApiResponse({
    status: 201,
    description: 'Hàng hóa được tạo thành công',
    type: [ProductResponseDto],
  })
  async createProduct(@Param('id') id: string, @Req() req: any) {
    const productsStr = req.body?.products;
    const files = req.files || [];

    let productsData = [];
    try {
      productsData = JSON.parse(productsStr);
      if (!Array.isArray(productsData)) throw new Error();
    } catch (e) {
      throw new BadRequestException(
        'Trường "products" phải là một chuỗi JSON Array hợp lệ',
      );
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

  @StoreOwnerOnly()
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

  @StoreOwnerOnly()
  @Delete('products/:productId')
  @ApiOperation({ summary: 'Xóa sản phẩm/nguyên liệu' })
  @ApiResponse({ status: 200, description: 'Đã xóa sản phẩm' })
  async deleteProduct(@Param('productId') productId: string) {
    return this.storesService.deleteProduct(productId);
  }

  // Units
  @StoreOwnerOnly()
  @Post(':id/asset-units')
  @ApiOperation({ summary: 'Tạo đơn vị tính tài sản (Cái, Máy, Bộ...)' })
  @ApiResponse({ status: 201, description: 'Thành công' })
  async createAssetUnit(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createAssetUnit(id, body);
  }

  @StoreOwnerOnly()
  @Get(':id/asset-units')
  @ApiOperation({ summary: 'Lấy đơn vị tính tài sản' })
  @ApiResponse({ status: 200, description: 'Danh sách đơn vị tính' })
  async getAssetUnits(@Param('id') id: string) {
    return this.storesService.getAssetUnits(id);
  }

  @StoreOwnerOnly()
  @Post(':id/product-units')
  @ApiOperation({ summary: 'Tạo đơn vị tính sản phẩm (Kg, Lít, Chai...)' })
  @ApiResponse({ status: 201, description: 'Thành công' })
  async createProductUnit(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createProductUnit(id, body);
  }

  @StoreOwnerOnly()
  @Get(':id/product-units')
  @ApiOperation({ summary: 'Lấy đơn vị tính sản phẩm' })
  @ApiResponse({ status: 200, description: 'Danh sách đơn vị tính' })
  async getProductUnits(@Param('id') id: string) {
    return this.storesService.getProductUnits(id);
  }

  // Categories
  // Categories
  @StoreOwnerOnly()
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

  @StoreOwnerOnly()
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
  @StoreOwnerOnly()
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

  @StoreOwnerOnly()
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

  @StoreOwnerOnly()
  @Get(':id/general-dashboard')
  @ApiOperation({ summary: 'Lấy báo cáo tổng hợp (General Dashboard)' })
  @ApiQuery({
    name: 'month',
    required: false,
    example: '01/2026',
    description: 'Tháng báo cáo (MM/YYYY)',
  })
  async getGeneralDashboard(
    @Param('id') id: string,
    @Query('month') month?: string,
  ) {
    return this.storesService.getGeneralDashboard(id, month);
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
  @StoreOwnerOnly()
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

  @StoreOwnerOnly()
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

  @StoreOwnerOnly()
  @Get(':id/daily-reports/by-date')
  @ApiOperation({
    summary: 'Lấy báo cáo ngày theo ngày cụ thể',
    description:
      'Lấy báo cáo nhân viên hàng ngày của cửa hàng theo ngày cụ thể (format: YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'date',
    required: true,
    type: String,
    description: 'Ngày cần lấy báo cáo (YYYY-MM-DD)',
    example: '2026-01-22',
  })
  @ApiResponse({
    status: 200,
    description: 'Báo cáo ngày',
    type: DailyReportForOwnerResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Không tìm thấy báo cáo cho ngày này',
  })
  async getDailyReportByDate(
    @Param('id') id: string,
    @Query('date') date: string,
    @GetUser() user: any,
  ) {
    const reportDate = validateStoreReportDate(date);
    const report = await this.storesService.getDailyReportByDateForOwner(
      id,
      reportDate,
      user.userId,
    );
    if (!report) {
      throw new NotFoundException(`Không tìm thấy báo cáo cho ngày ${date}`);
    }
    return report;
  }

  @StoreOwnerOnly()
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

  @StoreOwnerOnly()
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

  @StoreOwnerOnly()
  @Delete('daily-reports/:reportId')
  @ApiOperation({ summary: 'Xóa báo cáo ngày' })
  @ApiResponse({ status: 200, description: 'Đã xóa báo cáo' })
  async deleteDailyReport(@Param('reportId') reportId: string) {
    return this.storesService.deleteDailyReport(reportId);
  }

  // Store Events
  @StoreOwnerOnly()
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

  @StoreOwnerOnly()
  @Get(':id/events')
  @ApiOperation({ summary: 'Lấy danh sách sự kiện' })
  @ApiQuery({
    name: 'timeRange',
    required: false,
    enum: ['today', 'yesterday', '1_week', '1_month'],
  })
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

  @StoreOwnerOnly()
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

  @StoreOwnerOnly()
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

  @StoreOwnerOnly()
  @Delete('events/:eventId')
  @ApiOperation({ summary: 'Xóa sự kiện' })
  @ApiResponse({ status: 200, description: 'Đã xóa sự kiện' })
  async deleteEvent(@Param('eventId') eventId: string) {
    return this.storesService.deleteEvent(eventId);
  }

  // Stock Transactions
  @StoreOwnerOnly()
  @Post(':id/stock-transactions')
  async createStockTransaction(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createStockTransaction(id, body);
  }

  @StoreOwnerOnly()
  @Get(':id/stock-transactions')
  async getStockTransactions(@Param('id') id: string) {
    return this.storesService.getStockTransactions(id);
  }

  @StoreOwnerOnly()
  @Get('stock-transactions/:transactionId')
  async getStockTransactionById(@Param('transactionId') transactionId: string) {
    return this.storesService.getStockTransactionById(transactionId);
  }

  // Inventory Reports (Broken Assets / Out of Stock)
  @Post('inventory-reports')
  @UseInterceptors(AnyFilesInterceptor(multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Gửi báo cáo sự cố kho (Hỗ trợ nhiều báo cáo & nhiều ảnh)',
  })
  async createInventoryReports(
    @Body('reports') reportsStr: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    let reports = [];
    try {
      reports = JSON.parse(reportsStr);
    } catch (e) {
      throw new BadRequestException(
        'Trường "reports" phải là một chuỗi JSON hợp lệ',
      );
    }

    return this.storesService.createInventoryReports(reports, files);
  }

  @StoreOwnerOnly()
  @Patch('inventory-reports/:id/handle')
  @ApiOperation({ summary: 'Xử lý báo cáo sự cố kho (Duyệt/Từ chối)' })
  async handleInventoryReport(
    @Param('id') id: string,
    @Body() body: { status: InventoryReportStatus; adminNote?: string },
  ) {
    return this.storesService.handleInventoryReport(id, body);
  }

  // Service Categories
  @StoreOwnerOnly()
  @Post(':id/service-categories')
  async createServiceCategory(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createServiceCategory(id, body);
  }

  @StoreOwnerOnly()
  @Get(':id/service-categories')
  async getServiceCategories(
    @Param('id') id: string,
    @Query('type') type?: string,
  ) {
    return this.storesService.getServiceCategories(id, type);
  }

  @StoreOwnerOnly()
  @Get('service-categories/:categoryId')
  async getServiceCategoryById(@Param('categoryId') categoryId: string) {
    return this.storesService.getServiceCategoryById(categoryId);
  }

  @StoreOwnerOnly()
  @Put('service-categories/:categoryId')
  async updateServiceCategory(
    @Param('categoryId') categoryId: string,
    @Body() body: any,
  ) {
    return this.storesService.updateServiceCategory(categoryId, body);
  }

  @StoreOwnerOnly()
  @Delete('service-categories/:categoryId')
  async deleteServiceCategory(@Param('categoryId') categoryId: string) {
    return this.storesService.deleteServiceCategory(categoryId);
  }

  // Service Items
  @StoreOwnerOnly()
  @Post(':id/fnb-items')
  @UseInterceptors(FileInterceptor('avatar', multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Tạo món F&B kèm danh mục và công thức (Tự động tạo danh mục nếu chưa có)',
  })
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
        throw new BadRequestException(
          'Trường "recipes" phải là một chuỗi JSON Array hợp lệ',
        );
      }
    }

    return this.storesService.createFnbServiceItem(id, data);
  }

  @StoreOwnerOnly()
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

  @StoreOwnerOnly()
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

  @StoreOwnerOnly()
  @Delete('service-items/:itemId')
  async deleteServiceItem(@Param('itemId') itemId: string) {
    return this.storesService.deleteServiceItem(itemId);
  }

  // Service Item Recipes
  @StoreOwnerOnly()
  @Post('service-items/:itemId/recipes')
  async createServiceItemRecipe(
    @Param('itemId') itemId: string,
    @Body() body: any,
  ) {
    return this.storesService.createServiceItemRecipe(itemId, body);
  }

  @StoreOwnerOnly()
  @Post('service-items/:itemId/recipes/bulk')
  async bulkCreateRecipes(
    @Param('itemId') itemId: string,
    @Body('recipes') recipes: any[],
  ) {
    return this.storesService.bulkCreateRecipes(itemId, recipes);
  }

  @StoreOwnerOnly()
  @Get('service-items/:itemId/recipes')
  async getServiceItemRecipes(@Param('itemId') itemId: string) {
    return this.storesService.getServiceItemRecipes(itemId);
  }

  @StoreOwnerOnly()
  @Put('service-item-recipes/:recipeId')
  async updateServiceItemRecipe(
    @Param('recipeId') recipeId: string,
    @Body() body: UpdateServiceItemRecipeDto,
  ) {
    return this.storesService.updateServiceItemRecipe(recipeId, body);
  }

  @StoreOwnerOnly()
  @Delete('service-item-recipes/:recipeId')
  async deleteServiceItemRecipe(@Param('recipeId') recipeId: string) {
    return this.storesService.deleteServiceItemRecipe(recipeId);
  }

  // --- Orders ---
  @StoreOwnerOnly()
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

  @StoreOwnerOnly()
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
    @GetUser() user: any,
  ) {
    // Whole Vietnam days, half-open, as for home-revenue-summary.
    // `new Date('YYYY-MM-DD')` was UTC midnight (07:00 in Vietnam), so each
    // range silently dropped its first day's 00:00–07:00 orders.
    const { startUtc, endExclusiveUtc } = resolveStoreRevenueDateRange(
      startDate,
      endDate,
    );
    return this.storesService.getRevenueReport(
      id,
      startUtc,
      endExclusiveUtc,
      user.userId,
    );
  }

  @StoreOwnerOnly()
  @Get(':id/home-revenue-summary')
  @ApiOperation({
    summary: 'Tóm tắt doanh thu cho Home của chủ cửa hàng',
    description:
      'Tổng hợp doanh thu, chi phí, lợi nhuận và số đơn theo ngày HCM cho chủ cửa hàng',
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
  @ApiResponse({ status: 200, type: HomeRevenueSummaryResponseDto })
  async getHomeRevenueSummary(
    @Param('id') id: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @GetUser() user: any,
  ) {
    const { startUtc, endExclusiveUtc } = resolveStoreRevenueDateRange(
      startDate,
      endDate,
    );

    return this.storesService.getHomeRevenueSummary(
      id,
      startUtc,
      endExclusiveUtc,
      user.userId,
    );
  }

  @StoreOwnerOnly()
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
    const start = startDate
      ? new Date(startDate)
      : new Date(new Date().setDate(end.getDate() - 30));
    return this.storesService.getTopEmployeesReport(id, start, end);
  }

  @StoreOwnerOnly()
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
    const start = startDate
      ? new Date(startDate)
      : new Date(new Date().setDate(end.getDate() - 30));
    return this.storesService.getShiftEfficiencyReport(id, start, end);
  }

  @StoreOwnerOnly()
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
    const start = startDate
      ? new Date(startDate)
      : new Date(new Date().setDate(end.getDate() - 30));
    return this.storesService.getLosingMoneyReport(id, start, end);
  }

  @StoreOwnerOnly()
  @Get(':id/order-statistics')
  @ApiOperation({
    summary: 'Thống kê đơn hàng theo kỳ (Dashboard)',
    description:
      'Lấy thống kê đơn hàng theo tuần/tháng/năm kèm so sánh với kỳ trước',
  })
  @ApiQuery({ name: 'period', required: true, enum: ['week', 'month', 'year'] })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'Ngày tham chiếu (YYYY-MM-DD)',
  })
  async getOrderStatistics(
    @Param('id') id: string,
    @Query('period') period: 'week' | 'month' | 'year',
    @Query('date') date?: string,
  ) {
    return this.storesService.getOrderStatistics(id, period, date);
  }

  @StoreOwnerOnly()
  @Get(':id/expense-report')
  @ApiOperation({
    summary: 'Báo cáo chi phí',
    description: 'Lấy chi phí vật tư, nhân sự và so sánh với doanh thu',
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
  async getExpenseReport(
    @Param('id') id: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    // Whole Vietnam days, half-open (see getRevenueReport).
    const { startUtc, endExclusiveUtc } = resolveStoreRevenueDateRange(
      startDate,
      endDate,
    );
    return this.storesService.getExpenseReport(id, startUtc, endExclusiveUtc);
  }

  @Get(':id/internal-rule')
  @ApiOperation({ summary: 'Lấy nội quy nội bộ của cửa hàng' })
  @ApiResponse({ type: InternalRuleResponseDto })
  async getInternalRule(@Param('id') id: string) {
    return this.storesService.getInternalRule(id);
  }

  @StoreOwnerOnly()
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
    @GetUser() user?: any,
  ) {
    // Unreachable duplicate of getFeedbacksEarly (Express matches the first
    // registration); kept identical so it cannot reopen the leak.
    return this.storesService.getFeedbacksForViewer(user?.userId, {
      storeId,
      employeeProfileId,
      status: status as any,
    });
  }

  @Get('feedbacks/leaderboard')
  @ApiOperation({ summary: 'Bảng xếp hạng feedback nhân viên theo store' })
  @ApiQuery({ name: 'storeId', required: true })
  async getFeedbackLeaderboard(
    @Query('storeId') storeId: string,
    @GetUser() user?: any,
  ) {
    if (!storeId) throw new BadRequestException('storeId is required');
    await this.assertStoreMember(storeId, user);
    return this.storesService.getFeedbackLeaderboard(storeId);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // KPI AI SUGGESTIONS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  @Post('kpi-ai-suggestions')
  @ApiOperation({
    summary: 'Gửi yêu cầu AI đề xuất KPI',
    description:
      'AI phân tích lịch sử hiệu suất của nhân viên và đề xuất các mục tiêu KPI phù hợp.',
  })
  @ApiResponse({
    status: 201,
    description: 'Yêu cầu đã được tiếp nhận, AI đang xử lý',
  })
  async requestKpiAiSuggestion(
    @GetUser() user: any,
    @Body()
    body: {
      storeId: string;
      employeeProfileId: string;
      context?: string;
    },
  ) {
    return this.storesService.requestKpiAiSuggestion(body);
  }
}
