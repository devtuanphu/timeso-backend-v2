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
  ParseUUIDPipe,
  Query,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { StoresService } from '../stores.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StoreAccessGuard } from '../guards/store-access.guard';
import { StoreResourceAccessGuard } from '../guards/store-resource-access.guard';
import { StoreOwnerOnlyGuard } from '../guards/store-owner-only.guard';
import { StoreOwnerOnly } from '../guards/store-owner-only.decorator';
import { CreateWorkShiftDto, UpdateWorkShiftDto } from '../dto/work-shift.dto';
import { GetUser } from '../../auth/decorators/get-user.decorator';
import { StopWorkCycleDto } from '../dto/stop-work-cycle.dto';
import { UpdateStoreShiftConfigDto } from '../dto/store-shift-config.dto';
import {
  WorkShiftResponseDto,
  EmployeeScheduleDetailsDto,
} from '../dto/store-response.dto';
import { UpdateAssignmentTimeDto } from '../dto/update-assignment-time.dto';
import {
  CreateShiftScheduleDto,
  ShiftEmployeeOptionsDto,
} from '../dto/create-shift-schedule.dto';

/**
 * StoresSchedulingController: routes split out of StoresController by domain. Same prefix,
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
export class StoresSchedulingController {
  constructor(private readonly storesService: StoresService) {}

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
    @GetUser() user?: any,
  ) {
    return this.storesService.getShiftRegistrations(
      { storeId, employeeProfileId, status },
      user?.userId,
    );
  }

  // Shift Config (Ca làm việc)
  @Get(':id/shift-config')
  @ApiOperation({ summary: 'Lấy cấu hình ca làm việc' })
  async getShiftConfig(@Param('id') id: string) {
    return this.storesService.getShiftConfig(id);
  }

  @StoreOwnerOnly()
  @Put(':id/shift-config')
  @ApiOperation({ summary: 'Cập nhật cấu hình ca làm việc' })
  async updateShiftConfig(
    @Param('id') id: string,
    @Body() body: UpdateStoreShiftConfigDto,
  ) {
    return this.storesService.upsertShiftConfig(id, body);
  }

  @Patch(':id/me/reminder-settings')
  @ApiOperation({
    summary: 'Cập nhật cài đặt nhắc nhở ca làm (Dành cho nhân viên hiện tại)',
    description:
      'Cập nhật cấu hình nhắc nhở của tài khoản đang đăng nhập trong cửa hàng này',
  })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật thành công',
  })
  async updateMyReminderSettings(
    @GetUser() user: any,
    @Param('id') storeId: string,
    @Body() body: any,
  ) {
    const profile = await this.storesService.getEmployeeByAccountAndStore(
      user.userId,
      storeId,
    );
    if (!profile) {
      throw new NotFoundException('Không tìm thấy nhân viên');
    }
    return this.storesService.updateEmployeeReminderSettings(profile.id, body);
  }

  @Get('employees/:profileId/schedule')
  @ApiOperation({
    summary: 'Lấy lịch làm việc chi tiết (Tháng hiện tại)',
    description:
      'Bao gồm: Lịch ca làm, Danh sách đăng ký ca, Đổi ca, và Nghỉ phép',
  })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết lịch làm việc',
    type: EmployeeScheduleDetailsDto,
  })
  @ApiQuery({
    name: 'month',
    required: false,
    type: String,
    description: 'YYYY-MM-DD (Mặc định là tháng hiện tại)',
  })
  async getEmployeeSchedule(
    @Param('profileId') profileId: string,
    @Query('month') monthString?: string,
    @GetUser() user?: any,
  ) {
    const month = monthString ? new Date(monthString) : new Date();
    return this.storesService.getEmployeeScheduleDetails(
      profileId,
      month,
      user?.userId,
    );
  }

  // Work Shifts
  @StoreOwnerOnly()
  @Post(':id/shift-schedules/employee-options')
  @ApiOperation({
    summary: 'Xem trạng thái nhân viên cho lịch ca đang tạo',
    description:
      'Phân loại nhân viên rảnh, có ca khác, trùng ca hoặc nghỉ phép trên toàn bộ các ngày sẽ được sinh từ quy tắc lặp.',
  })
  @ApiResponse({ status: 201, description: 'Danh sách trạng thái nhân viên' })
  async getShiftEmployeeOptions(
    @GetUser() user: any,
    @Param('id') storeId: string,
    @Body() body: ShiftEmployeeOptionsDto,
  ) {
    return this.storesService.getShiftEmployeeOptions(
      storeId,
      user.userId,
      body,
    );
  }

  @StoreOwnerOnly()
  @Post(':id/shift-schedules')
  @ApiOperation({
    summary: 'Tạo lịch ca làm việc thống nhất',
    description:
      'Tạo ca, quy tắc lặp và các ngày làm việc trong cùng một giao dịch. Hỗ trợ không lặp, hàng ngày, hàng tuần và hàng tháng.',
  })
  @ApiResponse({ status: 201, description: 'Tạo lịch ca thành công' })
  async createShiftSchedule(
    @GetUser() user: any,
    @Param('id') storeId: string,
    @Body() body: CreateShiftScheduleDto,
  ) {
    return this.storesService.createShiftSchedule(storeId, user.userId, body);
  }

  @StoreOwnerOnly()
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
  async createWorkShift(
    @Param('id') id: string,
    @Body() body: CreateWorkShiftDto,
    @GetUser() user: any,
  ) {
    return this.storesService.createWorkShift(id, body, user.userId);
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

  @StoreOwnerOnly()
  @Put(':storeId/work-shifts/:shiftId')
  @ApiOperation({
    summary: 'Cập nhật ca làm việc',
    description:
      'Cập nhật thông tin ca làm việc (tên, giờ bắt đầu, giờ kết thúc, ghi chú)',
  })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật thành công',
    type: WorkShiftResponseDto,
  })
  async updateWorkShift(
    @Param('storeId') storeId: string,
    @Param('shiftId') shiftId: string,
    @Body() body: UpdateWorkShiftDto,
    @GetUser() user: any,
  ) {
    return this.storesService.updateWorkShift(
      storeId,
      shiftId,
      body,
      user.userId,
    );
  }

  @StoreOwnerOnly()
  @Delete(':storeId/work-shifts/:shiftId')
  @ApiOperation({
    summary: 'Xoá ca làm việc khỏi thiết lập',
    description:
      'Ẩn ca (is_active=false), giữ lịch sử. Xoá các lịch sắp tới chưa có nhân viên; ' +
      'từ chối (409 WORK_SHIFT_HAS_UPCOMING_ASSIGNMENTS) khi còn lịch sắp tới đã có nhân viên. ' +
      'Xoá ca đã ẩn là thao tác không đổi (200).',
  })
  @ApiResponse({ status: 200, description: 'Đã xoá (hoặc đã xoá trước đó)' })
  @ApiResponse({
    status: 409,
    description:
      '{ code: "WORK_SHIFT_HAS_UPCOMING_ASSIGNMENTS", count, message }',
  })
  async deleteWorkShift(
    @Param('storeId') storeId: string,
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
    @GetUser() user: any,
  ) {
    return this.storesService.deleteWorkShift(storeId, shiftId, user.userId);
  }

  // ==================== WORK CYCLE MANAGEMENT ====================

  @StoreOwnerOnly()
  @Get(':id/active-cycle')
  @ApiOperation({
    summary: 'Lấy chu kỳ đang hoạt động',
    description: 'Mỗi cửa hàng chỉ có 1 chu kỳ active tại 1 thời điểm',
  })
  @ApiResponse({ status: 200, description: 'Chu kỳ đang active hoặc null' })
  async getActiveCycle(@Param('id') storeId: string, @GetUser() user: any) {
    return this.storesService.getActiveCycle(storeId, user.userId);
  }

  @StoreOwnerOnly()
  @Post(':id/work-cycles')
  @ApiOperation({
    summary: 'Tạo chu kỳ làm việc',
    description:
      'Tạo chu kỳ mới. Phải dừng chu kỳ cũ trước khi tạo mới. Hỗ trợ 4 loại: DAILY, WEEKLY, MONTHLY, INDEFINITE',
  })
  @ApiResponse({ status: 201, description: 'Tạo thành công' })
  async createWorkCycle(
    @Param('id') storeId: string,
    @Body() body: any,
    @GetUser() user: any,
  ) {
    return this.storesService.createWorkCycle(storeId, body, user.userId);
  }

  @Get(':id/work-cycles')
  @ApiOperation({ summary: 'Lấy danh sách chu kỳ làm việc' })
  @ApiResponse({ status: 200, description: 'Danh sách chu kỳ' })
  async getWorkCycles(@Param('id') storeId: string, @GetUser() user: any) {
    return this.storesService.getWorkCycles(storeId, user.userId);
  }

  @StoreOwnerOnly()
  @Get('work-cycles/:cycleId')
  @ApiOperation({ summary: 'Lấy chi tiết chu kỳ làm việc' })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết chu kỳ với slots và assignments',
  })
  async getWorkCycleById(
    @Param('cycleId') cycleId: string,
    @GetUser() user: any,
  ) {
    return this.storesService.getWorkCycleById(cycleId, user.userId);
  }

  @StoreOwnerOnly()
  @Put('work-cycles/:cycleId')
  @ApiOperation({ summary: 'Cập nhật chu kỳ làm việc' })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công' })
  async updateWorkCycle(
    @Param('cycleId') cycleId: string,
    @Body() body: any,
    @GetUser() user: any,
  ) {
    return this.storesService.updateWorkCycle(cycleId, body, user.userId);
  }

  @StoreOwnerOnly()
  @Put('work-cycles/:cycleId/stop')
  @ApiOperation({
    summary: 'Dừng chu kỳ làm việc',
    description:
      'Dừng chu kỳ ngay lập tức hoặc hẹn giờ dừng. Dữ liệu lịch sử được giữ lại.',
  })
  @ApiResponse({ status: 200, description: 'Dừng thành công' })
  async stopWorkCycle(
    @Param('cycleId') cycleId: string,
    // Includes the legacy `stopType`/`stopDate` fields: the global
    // forbidNonWhitelisted pipe would otherwise reject released owner builds.
    @Body() body: StopWorkCycleDto,
    @GetUser() user: any,
  ) {
    return this.storesService.stopWorkCycle(cycleId, body, user.userId);
  }

  @StoreOwnerOnly()
  @Put('work-cycles/:cycleId/activate')
  @ApiOperation({
    summary: 'Kích hoạt chu kỳ làm việc',
    description:
      'Chuyển chu kỳ từ DRAFT sang ACTIVE. Kiểm tra không có chu kỳ khác đang active.',
  })
  @ApiResponse({ status: 200, description: 'Kích hoạt thành công' })
  async activateWorkCycle(
    @Param('cycleId') cycleId: string,
    @GetUser() user: any,
  ) {
    return this.storesService.activateWorkCycle(cycleId, user.userId);
  }

  // ==================== SHIFT SLOT MANAGEMENT ====================

  @StoreOwnerOnly()
  @Post('work-cycles/:cycleId/slots')
  @ApiOperation({
    summary: 'Tạo slot ca làm việc',
    description: 'Tạo các slot ca cho từng ngày trong chu kỳ (bulk create)',
  })
  @ApiResponse({ status: 201, description: 'Tạo thành công' })
  async createShiftSlots(
    @Param('cycleId') cycleId: string,
    @Body() body: { slots: any[] },
    @GetUser() user: any,
  ) {
    return this.storesService.createShiftSlots(
      cycleId,
      body.slots,
      user.userId,
    );
  }

  @StoreOwnerOnly()
  @Get('work-cycles/:cycleId/slots')
  @ApiOperation({ summary: 'Lấy danh sách slot ca trong chu kỳ' })
  @ApiResponse({ status: 200, description: 'Danh sách slot' })
  async getShiftSlots(@Param('cycleId') cycleId: string, @GetUser() user: any) {
    return this.storesService.getShiftSlots(cycleId, undefined, user.userId);
  }

  @StoreOwnerOnly()
  @Put('shift-slots/:slotId')
  @ApiOperation({ summary: 'Cập nhật slot ca' })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công' })
  async updateShiftSlot(
    @Param('slotId') slotId: string,
    @Body() body: any,
    @GetUser() user: any,
  ) {
    return this.storesService.updateShiftSlot(slotId, body, user.userId);
  }

  @StoreOwnerOnly()
  @Delete('shift-slots/:slotId')
  @ApiOperation({ summary: 'Xóa slot ca' })
  @ApiResponse({ status: 200, description: 'Xóa thành công' })
  async deleteShiftSlot(@Param('slotId') slotId: string, @GetUser() user: any) {
    return this.storesService.deleteShiftSlot(slotId, user.userId);
  }

  // ==================== STORE SHIFT SLOTS (Staff App Calendar) ====================

  @Get(':id/store-shift-slots')
  @ApiOperation({
    summary: 'Lấy tất cả shift slots của cửa hàng (cho staff app lịch ca)',
    description:
      'Trả về tất cả slots với workShift info, assignments, capacity. Dùng cho staff app hiển thị lịch ca cửa hàng.',
  })
  @ApiQuery({ name: 'startDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'endDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({
    name: 'employeeProfileId',
    required: false,
    description: 'Nếu truyền, mỗi slot kèm lương tạm tính cho nhân viên này',
  })
  async getStoreShiftSlots(
    @Param('id') storeId: string,
    @GetUser() user: any,
    @Query('startDate') startDate: string | undefined,
    @Query('endDate') endDate: string | undefined,
    @Query('employeeProfileId') employeeProfileId: string | undefined,
  ) {
    return this.storesService.getStoreShiftSlots(
      storeId,
      startDate,
      endDate,
      employeeProfileId,
      user.userId,
    );
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
    @Body()
    body: { employeeId: string; note?: string; isOwnerAssign?: boolean },
    @GetUser() user: any,
  ) {
    return this.storesService.registerToShiftSlot(
      slotId,
      body.employeeId,
      body.note,
      body.isOwnerAssign || false,
      user.userId,
    );
  }

  @StoreOwnerOnly()
  @Get(':id/shift-assignments')
  @ApiOperation({ summary: 'Lấy danh sách đăng ký ca của cửa hàng' })
  @ApiQuery({
    name: 'cycleId',
    required: false,
    description: 'Lọc theo chu kỳ',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Lọc theo trạng thái',
  })
  @ApiResponse({ status: 200, description: 'Danh sách đăng ký' })
  async getShiftAssignments(
    @Param('id') storeId: string,
    @Query('cycleId') cycleId?: string,
    @Query('status') status?: string,
    @GetUser() user?: any,
  ) {
    console.log(
      `[Controller getShiftAssignments] storeId=${storeId}, cycleId=${cycleId}, status=${status}`,
    );
    return this.storesService.getShiftAssignments(
      storeId,
      { cycleId, status },
      user?.userId,
    );
  }

  @StoreOwnerOnly()
  @Put('shift-assignments/:assignmentId/status')
  @ApiOperation({
    summary: 'Duyệt/Từ chối đăng ký ca',
    description: 'Owner thay đổi trạng thái: CONFIRMED hoặc CANCELLED',
  })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công' })
  async updateAssignmentStatus(
    @Param('assignmentId') assignmentId: string,
    @Body() body: { status: string; note?: string },
    @GetUser() user: any,
  ) {
    return this.storesService.updateAssignmentStatus(
      assignmentId,
      body.status,
      body.note,
      user.userId,
    );
  }

  @StoreOwnerOnly()
  @Put('shift-assignments/:assignmentId/time')
  @ApiOperation({
    summary: 'Đổi giờ ca của một nhân viên',
    description:
      'Chỉ ca chưa chấm công vào. Khung ca còn người khác thì tách nhân viên này sang khung mới cùng ngày; nhân viên nhận thông báo đổi giờ.',
  })
  async updateAssignmentTime(
    @Param('assignmentId') assignmentId: string,
    @Body() body: UpdateAssignmentTimeDto,
    @GetUser() user: any,
  ) {
    return this.storesService.updateAssignmentTime(
      assignmentId,
      body,
      user.userId,
    );
  }

  // ==================== SHIFT SWAP MANAGEMENT ====================

  @Post('shift-swaps')
  @ApiOperation({
    summary: 'Tạo yêu cầu đổi ca',
    description: 'Nhân viên yêu cầu đổi ca với nhân viên khác',
  })
  @ApiResponse({ status: 201, description: 'Tạo yêu cầu thành công' })
  async createShiftSwap(@Body() body: any, @GetUser() user: any) {
    return this.storesService.createShiftSwap(body, user.userId);
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
    @GetUser() user: any,
  ) {
    return this.storesService.updateShiftSwapStatus(
      swapId,
      body.status,
      body.note,
      user.userId,
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SHIFT REGISTRATION (Nhân viên đăng ký ca)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  @Delete('shift-registrations/upcoming')
  @ApiOperation({
    summary: 'Huỷ các ca sắp tới mà nhân viên đã đăng ký',
    description:
      'Dùng khi nhân viên tắt đăng ký ca cố định. Lịch cố định không phải một bản ghi riêng — nó sinh ra từng ca rời — nên thao tác này rút lại các ca chưa bắt đầu (giờ Việt Nam) do chính nhân viên tự đăng ký — đang chờ duyệt hoặc đã được duyệt — không đụng vào ca chủ cửa hàng xếp và lịch sử đã làm.',
  })
  async cancelUpcomingShiftRegistrations(
    @Query('employeeProfileId', ParseUUIDPipe) employeeProfileId: string,
    @Query('storeId', ParseUUIDPipe) storeId: string,
    @Query('workShiftId') workShiftId: string | undefined,
    @GetUser() user: any,
  ) {
    return this.storesService.cancelUpcomingShiftRegistrations(
      storeId,
      employeeProfileId,
      user?.userId,
      workShiftId,
    );
  }

  /**
   * Duplicate of `getShiftRegistrationsEarly` above.
   *
   * The copy near the top of the file is the one NestJS actually matches —
   * it has to be declared before the `:id/...` routes or the parameterised
   * patterns swallow this path. This one is kept at the natural place among
   * the other shift-registration handlers, and `stores-owner-reports.controller.spec`
   * asserts both forward the authenticated owner so they cannot drift apart.
   */
  @Get('shift-registrations')
  @ApiOperation({ summary: 'Lấy danh sách đề xuất đăng ký ca' })
  @ApiQuery({ name: 'storeId', required: false })
  @ApiQuery({ name: 'employeeProfileId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getShiftRegistrations(
    @Query('storeId') storeId?: string,
    @Query('employeeProfileId') employeeProfileId?: string,
    @Query('status') status?: string,
    @GetUser() user?: any,
  ) {
    return this.storesService.getShiftRegistrations(
      { storeId, employeeProfileId, status },
      user?.userId,
    );
  }

  @Post('shift-registrations')
  @ApiOperation({
    summary: 'Nhân viên gửi đề xuất đăng ký ca làm việc',
    description:
      'Nhân viên chọn ca và gửi yêu cầu để quản lý phê duyệt. Tạo một ShiftAssignment với status PENDING.',
  })
  @ApiResponse({ status: 201, description: 'Yêu cầu đăng ký ca đã được gửi' })
  async createShiftRegistration(
    @GetUser() user: any,
    @Body()
    body: {
      storeId: string;
      employeeProfileId: string;
      workShiftId?: string;
      slotId?: string;
      startDate?: string;
      endDate?: string;
      daysOfWeek?: number[];
      note?: string;
    },
  ) {
    return this.storesService.createShiftRegistration(user.userId, body);
  }
}
