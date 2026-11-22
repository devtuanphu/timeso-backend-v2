import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { GetUser } from '../../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StoreAccessGuard } from '../guards/store-access.guard';
import { StoreResourceAccessGuard } from '../guards/store-resource-access.guard';
import { StoreOwnerOnlyGuard } from '../guards/store-owner-only.guard';
import { StoreOwnerOnly } from '../guards/store-owner-only.decorator';
import { ApproverScopeService } from '../approver-scope.service';
import { ApproverRequestsService } from '../approver-requests.service';
import { JobApplicationService } from '../job-application.service';
import {
  ListApproverRequestsQueryDto,
  UpsertRequestApproverDto,
} from '../dto/store-request-approver.dto';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 400 });

/**
 * "Cài đặt người phê duyệt" + the scoped-approver inbox.
 *
 * Guard chain mirrors StoresRequestsController: StoreAccessGuard scopes every
 * `:storeId/...` route to the store's owner or a current employee;
 * StoreOwnerOnlyGuard restricts the @StoreOwnerOnly() CRUD routes to the owner.
 * The `/me`, `/counts` and `/approver/*` lists stay open to members and are
 * narrowed in the service by the caller's delegated scope.
 */
@ApiTags('Cửa hàng - Người phê duyệt')
@ApiBearerAuth()
@Controller('stores')
@UseGuards(
  JwtAuthGuard,
  StoreAccessGuard,
  StoreResourceAccessGuard,
  StoreOwnerOnlyGuard,
)
export class StoresApproversController {
  constructor(
    private readonly approverScopeService: ApproverScopeService,
    private readonly approverRequestsService: ApproverRequestsService,
    private readonly jobApplicationService: JobApplicationService,
  ) {}

  // ── Config (owner only) ──────────────────────────────────────────────────

  @StoreOwnerOnly()
  @Get(':storeId/request-approvers')
  @ApiOperation({ summary: 'Danh sách người phê duyệt (chủ cửa hàng)' })
  async list(@Param('storeId', uuid) storeId: string) {
    return this.approverScopeService.listApprovers(storeId);
  }

  @StoreOwnerOnly()
  @Post(':storeId/request-approvers')
  @ApiOperation({ summary: 'Thêm người phê duyệt (chủ cửa hàng)' })
  async create(
    @Param('storeId', uuid) storeId: string,
    @Body() dto: UpsertRequestApproverDto,
  ) {
    return this.approverScopeService.createApprover(storeId, dto);
  }

  @StoreOwnerOnly()
  @Put(':storeId/request-approvers/:approverId')
  @ApiOperation({ summary: 'Cập nhật người phê duyệt (chủ cửa hàng)' })
  async update(
    @Param('storeId', uuid) storeId: string,
    @Param('approverId', uuid) approverId: string,
    @Body() dto: UpsertRequestApproverDto,
  ) {
    return this.approverScopeService.updateApprover(storeId, approverId, dto);
  }

  @StoreOwnerOnly()
  @Delete(':storeId/request-approvers/:approverId')
  @ApiOperation({ summary: 'Xoá người phê duyệt (chủ cửa hàng)' })
  async remove(
    @Param('storeId', uuid) storeId: string,
    @Param('approverId', uuid) approverId: string,
  ) {
    return this.approverScopeService.deleteApprover(storeId, approverId);
  }

  @StoreOwnerOnly()
  @Get(':storeId/request-approvers/identity-conflicts')
  @ApiOperation({
    summary:
      'Cảnh báo trùng số CCCD/CMND của nhân viên được chọn làm người phê duyệt (chủ cửa hàng)',
  })
  async identityConflicts(
    @Param('storeId', uuid) storeId: string,
    @Query('employeeProfileId', uuid) employeeProfileId: string,
  ) {
    return this.approverScopeService.identityConflictsForEmployee(
      storeId,
      employeeProfileId,
    );
  }

  // ── /me gate + counts (any member) ───────────────────────────────────────

  @Get(':storeId/request-approvers/me')
  @ApiOperation({ summary: 'Tôi có phải người phê duyệt không & loại nào' })
  async me(@Param('storeId', uuid) storeId: string, @GetUser() user: any) {
    return this.approverScopeService.listApproverTypesForAccount(
      user?.userId,
      storeId,
    );
  }

  @Get(':storeId/approver/counts')
  @ApiOperation({ summary: 'Số yêu cầu chờ duyệt theo loại (trong phạm vi)' })
  async counts(@Param('storeId', uuid) storeId: string, @GetUser() user: any) {
    return this.approverRequestsService.counts(user?.userId, storeId);
  }

  // ── Scoped lists ─────────────────────────────────────────────────────────

  @Get(':storeId/approver/shift-registrations')
  @ApiOperation({ summary: 'Đăng ký ca chờ duyệt trong phạm vi duyệt' })
  async shiftRegistrations(
    @Param('storeId', uuid) storeId: string,
    @Query() query: ListApproverRequestsQueryDto,
    @GetUser() user: any,
  ) {
    return this.approverRequestsService.listShiftRegistrations(
      user?.userId,
      storeId,
      query,
    );
  }

  @Get(':storeId/approver/leave-requests')
  @ApiOperation({ summary: 'Đơn nghỉ/trễ/sớm trong phạm vi duyệt' })
  async leaveRequests(
    @Param('storeId', uuid) storeId: string,
    @Query() query: ListApproverRequestsQueryDto,
    @GetUser() user: any,
  ) {
    return this.approverRequestsService.listLeaveRequests(
      user?.userId,
      storeId,
      query,
    );
  }

  @Get(':storeId/approver/shift-change-requests')
  @ApiOperation({ summary: 'Yêu cầu đổi ca trong phạm vi duyệt' })
  async shiftChangeRequests(
    @Param('storeId', uuid) storeId: string,
    @Query() query: ListApproverRequestsQueryDto,
    @GetUser() user: any,
  ) {
    return this.approverRequestsService.listShiftChangeRequests(
      user?.userId,
      storeId,
      query,
    );
  }

  @Get(':storeId/approver/bonus-work-requests')
  @ApiOperation({ summary: 'Yêu cầu bổ sung công / tăng ca trong phạm vi duyệt' })
  async bonusWorkRequests(
    @Param('storeId', uuid) storeId: string,
    @Query() query: ListApproverRequestsQueryDto,
    @GetUser() user: any,
  ) {
    return this.approverRequestsService.listBonusWorkRequests(
      user?.userId,
      storeId,
      query,
    );
  }

  @Get(':storeId/approver/custom-shift-requests')
  @ApiOperation({ summary: 'Yêu cầu khung giờ khác trong phạm vi duyệt' })
  async customShiftRequests(
    @Param('storeId', uuid) storeId: string,
    @Query() query: ListApproverRequestsQueryDto,
    @GetUser() user: any,
  ) {
    return this.approverRequestsService.listCustomShiftRequests(
      user?.userId,
      storeId,
      query,
    );
  }

  @Get(':storeId/approver/kpi-approval-requests')
  @ApiOperation({ summary: 'Yêu cầu duyệt KPI trong phạm vi (dữ liệu rút gọn)' })
  async kpiApprovalRequests(
    @Param('storeId', uuid) storeId: string,
    @Query() query: ListApproverRequestsQueryDto,
    @GetUser() user: any,
  ) {
    return this.approverRequestsService.listKpiApprovalRequests(
      user?.userId,
      storeId,
      query,
    );
  }

  @Get(':storeId/approver/salary-advance-requests')
  @ApiOperation({ summary: 'Yêu cầu ứng lương trong phạm vi (dữ liệu rút gọn)' })
  async salaryAdvanceRequests(
    @Param('storeId', uuid) storeId: string,
    @Query() query: ListApproverRequestsQueryDto,
    @GetUser() user: any,
  ) {
    return this.approverRequestsService.listSalaryAdvanceRequests(
      user?.userId,
      storeId,
      query,
    );
  }

  @Get(':storeId/approver/job-applications')
  @ApiOperation({ summary: 'Đơn ứng tuyển chờ xử lý (chỉ tên; người phê duyệt chỉ từ chối)' })
  async jobApplications(
    @Param('storeId', uuid) storeId: string,
    @Query() query: ListApproverRequestsQueryDto,
    @GetUser() user: any,
  ) {
    return this.jobApplicationService.listForApprover(
      storeId,
      user?.userId,
      query,
    );
  }
}
