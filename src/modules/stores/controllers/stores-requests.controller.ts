import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  UseGuards,
  Param,
  Query,
  UseInterceptors,
  UploadedFiles,
  UnauthorizedException,
  Req,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiQuery,
} from '@nestjs/swagger';
import { StoresService } from '../stores.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StoreAccessGuard } from '../guards/store-access.guard';
import { StoreResourceAccessGuard } from '../guards/store-resource-access.guard';
import { StoreOwnerOnlyGuard } from '../guards/store-owner-only.guard';
import { StoreOwnerOnly } from '../guards/store-owner-only.decorator';
import { GetUser } from '../../auth/decorators/get-user.decorator';
import { StoreApprovalSettingDto } from '../dto/store-approval-setting.dto';
import { ApprovalRequestDto } from '../dto/store-response.dto';
import { ShiftChangeRequestStatus } from '../entities/shift-change-request.entity';
import {
  CreateShiftChangeRequestDto,
  ListShiftChangeRequestsDto,
  ReviewShiftChangeRequestDto,
} from '../dto/shift-change-request.dto';
import { BonusWorkRequestStatus } from '../entities/bonus-work-request.entity';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '../../../common/utils/multer-config';
import { ShiftEndWorkflowService } from '../shift-end-workflow.service';

/**
 * StoresRequestsController: routes split out of StoresController by domain. Same prefix,
 * guards and handlers as before; registered before StoresController, the
 * order in which no route of either one shadows a route of the other.
 */
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
export class StoresRequestsController {
  private readonly logger = new Logger(StoresRequestsController.name);

  constructor(
    private readonly storesService: StoresService,
    private readonly shiftEndWorkflowService: ShiftEndWorkflowService,
  ) {}

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SHIFT CHANGE REQUESTS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  @Post('shift-change-requests')
  @ApiOperation({ summary: 'Gửi yêu cầu đổi ca' })
  @ApiResponse({ status: 201, description: 'Yêu cầu đổi ca đã được gửi' })
  async createShiftChangeRequest(
    @Body() body: CreateShiftChangeRequestDto,
    @GetUser() user: any,
  ) {
    return this.storesService.createShiftChangeRequest(
      body,
      user?.userId ?? user?.id,
    );
  }

  @Get('shift-change-requests')
  @ApiOperation({ summary: 'Lấy danh sách yêu cầu đổi ca' })
  @ApiQuery({ name: 'storeId', required: false })
  @ApiQuery({ name: 'employeeProfileId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getShiftChangeRequests(
    @Query() query: ListShiftChangeRequestsDto,
    @GetUser() user?: any,
  ) {
    const accountId = user?.userId ?? user?.id;
    if (query.employeeProfileId) {
      return this.storesService.getShiftChangeRequestsByEmployee(
        query.employeeProfileId,
        accountId,
        query.storeId,
        {
          status: query.status,
          startDate: query.startDate,
          endDate: query.endDate,
        },
      );
    }
    if (query.storeId) {
      return this.storesService.getShiftChangeRequestsByStore(
        query.storeId,
        query.status as ShiftChangeRequestStatus | undefined,
        accountId,
        {
          page: query.page,
          limit: query.limit,
          startDate: query.startDate,
          endDate: query.endDate,
        },
      );
    }
    return [];
  }

  @StoreOwnerOnly()
  @Patch('shift-change-requests/:id/approve')
  @ApiOperation({ summary: 'Phê duyệt yêu cầu đổi ca' })
  async approveShiftChangeRequest(
    @Param('id') id: string,
    @GetUser() user: any,
  ) {
    return this.storesService.approveShiftChangeRequest(
      id,
      user?.userId ?? user?.id,
    );
  }

  @StoreOwnerOnly()
  @Patch('shift-change-requests/:id/reject')
  @ApiOperation({ summary: 'Từ chối yêu cầu đổi ca' })
  async rejectShiftChangeRequest(
    @Param('id') id: string,
    @GetUser() user: any,
    @Body() body: ReviewShiftChangeRequestDto,
  ) {
    return this.storesService.rejectShiftChangeRequest(
      id,
      user?.userId ?? user?.id,
      body.reason,
    );
  }

  @Patch('shift-change-requests/:id/cancel')
  @ApiOperation({ summary: 'Hủy yêu cầu đổi ca' })
  async cancelShiftChangeRequest(
    @Param('id') id: string,
    @GetUser() user: any,
  ) {
    const accountId = user?.userId ?? user?.id;
    const profile = await this.storesService.getEmployeeByAccountId(accountId);
    return this.storesService.cancelShiftChangeRequest(
      id,
      profile?.id,
      accountId,
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // BONUS WORK REQUESTS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  @Post('bonus-work-requests')
  @ApiOperation({ summary: 'Gửi yêu cầu bổ sung công' })
  @ApiResponse({ status: 201, description: 'Yêu cầu bổ sung công đã được gửi' })
  async createBonusWorkRequest(
    @Body()
    body: {
      storeId: string;
      employeeProfileId: string;
      shiftSlotId?: string | null;
      shiftAssignmentId?: string | null;
      requestDate: string;
      startTime?: string;
      endTime?: string;
      reason?: string;
      attachments?: string[];
    },
    @GetUser() user: any,
  ) {
    // Owner-or-self on the target employee: without this any authenticated
    // account could file an overtime request for someone else's profile.
    if (!user?.userId) throw new UnauthorizedException();
    if (!body?.employeeProfileId) {
      throw new BadRequestException('employeeProfileId is required');
    }
    const { profile } = await this.storesService.assertEmployeeRecordAccess(
      body.employeeProfileId,
      user.userId,
      body.storeId || undefined,
      'Bạn chỉ có thể gửi yêu cầu tăng ca cho chính mình',
    );
    const request = await this.storesService.createBonusWorkRequest(
      { ...body, storeId: profile.storeId },
      user.userId,
    );
    await this.shiftEndWorkflowService.markOvertimePending(request);
    return request;
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
    @GetUser() user?: any,
  ) {
    if (!user?.userId) throw new UnauthorizedException();
    // Owner: the store (or the named employee). Anyone else: only their own
    // requests at that store, whatever employeeProfileId was sent.
    const scope = await this.storesService.resolveBonusWorkRequestScope(
      user.userId,
      { storeId, employeeProfileId },
    );
    if (!scope) return [];
    if (scope.kind === 'store') {
      return this.storesService.getBonusWorkRequestsByStore(
        scope.storeId,
        status as BonusWorkRequestStatus | undefined,
      );
    }
    const own = await this.storesService.getBonusWorkRequestsByEmployee(
      scope.employeeProfileId,
    );
    // `?employeeProfileId=` never filtered by status (released clients);
    // a store-scoped read narrowed to the caller keeps its ?status= filter.
    return status && !employeeProfileId
      ? own.filter((request) => String(request.status) === status)
      : own;
  }

  @StoreOwnerOnly()
  @Patch('bonus-work-requests/:id/approve')
  @ApiOperation({ summary: 'Phê duyệt yêu cầu bổ sung công' })
  async approveBonusWorkRequest(@Param('id') id: string, @GetUser() user: any) {
    const request = await this.storesService.approveBonusWorkRequest(
      id,
      user.userId,
    );
    await this.shiftEndWorkflowService.approveOvertime(request);
    return request;
  }

  @StoreOwnerOnly()
  @Patch('bonus-work-requests/:id/reject')
  @ApiOperation({ summary: 'Từ chối yêu cầu bổ sung công' })
  async rejectBonusWorkRequest(
    @Param('id') id: string,
    @GetUser() user: any,
    @Body() body: { reason?: string },
  ) {
    const request = await this.storesService.rejectBonusWorkRequest(
      id,
      user.userId,
      body.reason,
    );
    await this.shiftEndWorkflowService.resumeAfterOvertime(request);
    return request;
  }

  @Patch('bonus-work-requests/:id/cancel')
  @ApiOperation({ summary: 'Hủy yêu cầu bổ sung công' })
  async cancelBonusWorkRequest(@Param('id') id: string, @GetUser() user: any) {
    const request = await this.storesService.cancelBonusWorkRequest(
      id,
      user.userId,
    );
    await this.shiftEndWorkflowService.resumeAfterOvertime(request);
    return request;
  }

  // Approval Settings
  @Get(':id/approval-settings')
  @ApiOperation({ summary: 'Lấy cấu hình phê duyệt' })
  async getApprovalSetting(@Param('id') id: string) {
    return this.storesService.getApprovalSetting(id);
  }

  @StoreOwnerOnly()
  @Put(':id/approval-settings')
  @ApiOperation({ summary: 'Cập nhật cấu hình phê duyệt' })
  async updateApprovalSetting(
    @Param('id') id: string,
    @Body() body: StoreApprovalSettingDto,
  ) {
    return this.storesService.upsertApprovalSetting(id, body);
  }

  @StoreOwnerOnly()
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
    const accountId = req.user?.userId || req.user?.id;
    // "Xin tăng ca" requests are listed with the leave requests and decided
    // here too (same effect as the bonus-work-request approve/reject routes).
    if (
      body.type === 'LEAVE' &&
      (await this.storesService.isBonusWorkRequestId(requestId))
    ) {
      if (body.status === 'APPROVED') {
        const request = await this.storesService.approveBonusWorkRequest(
          requestId,
          accountId,
        );
        await this.shiftEndWorkflowService.approveOvertime(request);
        return request;
      }
      const request = await this.storesService.rejectBonusWorkRequest(
        requestId,
        accountId,
        body.reason,
      );
      await this.shiftEndWorkflowService.resumeAfterOvertime(request);
      return request;
    }
    const result: any = await this.storesService.processRequest(
      accountId,
      requestId,
      body.type,
      body.status,
      body.reason,
    );
    // An early leave approved during the shift: reminders and the
    // auto-checkout move to the new end.
    const change = result?.appliedShiftChange;
    if (change?.kind === 'EARLY' && change.phase === 'during') {
      // The approval stands; the reminders then keep the old end.
      await this.shiftEndWorkflowService
        .applyAdjustedEnd(change.assignmentId)
        .catch((error) =>
          this.logger.error(
            `[processApproval] could not move the end of assignment ${change.assignmentId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
    }
    return result;
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
    @GetUser() user?: any,
  ) {
    return this.storesService.createLeaveRequest(id, body, user?.userId, files);
  }

  @StoreOwnerOnly()
  @Get(':id/leave-requests')
  @ApiOperation({ summary: 'Lấy danh sách đơn xin nghỉ theo cửa hàng' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getLeaveRequestsByStore(
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @GetUser() user?: any,
  ) {
    await this.storesService.assertOwnerStoreAccess(id, user?.userId);
    return this.storesService.getLeaveRequestsByStore(
      id,
      status as any,
      from,
      to,
    );
  }

  @Get('employees/:profileId/leave-requests')
  @ApiOperation({ summary: 'Lấy danh sách đơn xin nghỉ theo nhân viên' })
  @ApiQuery({
    name: 'type',
    required: false,
    description:
      'Lọc theo loại, phân tách bằng dấu phẩy. LEAVE = các loại nghỉ (SICK, PERSONAL, VACATION, UNPAID, OTHER).',
  })
  async getLeaveRequestsByEmployee(
    @Param('profileId') profileId: string,
    @GetUser() user: any,
    @Query('type') type?: string,
  ) {
    return this.storesService.getLeaveRequestsByEmployee(
      profileId,
      user.userId,
      type,
    );
  }

  @Patch('leave-requests/:requestId/cancel')
  @ApiOperation({ summary: 'Hủy đơn xin nghỉ phép' })
  async cancelLeaveRequest(
    @Param('requestId') requestId: string,
    @GetUser() user: any,
  ) {
    // The owning employee is resolved from the stored request, not the body.
    return this.storesService.cancelLeaveRequest(requestId, user?.userId);
  }

  @StoreOwnerOnly({ storeFrom: ['query'] })
  @Get('approvals/stats')
  @ApiOperation({ summary: 'Lấy thống kê phê duyệt' })
  @ApiQuery({ name: 'storeId', required: true })
  async getApprovalStats(
    @Query('storeId') storeId: string,
    @GetUser() user: any,
  ) {
    if (!storeId) {
      throw new BadRequestException('storeId is required');
    }
    return this.storesService.getApprovalStats(
      storeId,
      user?.userId ?? user?.id,
    );
  }
}
