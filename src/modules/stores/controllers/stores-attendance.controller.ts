import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  UseGuards,
  Param,
  ParseUUIDPipe,
  Query,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { StoresService } from '../stores.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StoreAccessGuard } from '../guards/store-access.guard';
import { StoreResourceAccessGuard } from '../guards/store-resource-access.guard';
import { StoreOwnerOnlyGuard } from '../guards/store-owner-only.guard';
import { StoreOwnerOnly } from '../guards/store-owner-only.decorator';
import { CreateWorkedTimeRuleDto } from '../dto/worked-time-rule.dto';
import { parseAttendanceCoordinate } from '../attendance-enforcement';
import { GetUser } from '../../auth/decorators/get-user.decorator';
import { StoreTimekeepingSettingDto } from '../dto/store-timekeeping-setting.dto';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  attendanceMulterConfig,
  multerConfig,
} from '../../../common/utils/multer-config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ShiftEndWorkflowService } from '../shift-end-workflow.service';

/**
 * StoresAttendanceController: routes split out of StoresController by domain. Same prefix,
 * guards and handlers as before; registered after StoresController, the
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
export class StoresAttendanceController {
  private readonly logger = new Logger(StoresAttendanceController.name);

  constructor(
    private readonly storesService: StoresService,
    private readonly shiftEndWorkflowService: ShiftEndWorkflowService,
    @InjectQueue('attendance-background')
    private readonly attendanceQueue: Queue,
  ) {}

  // Timekeeping Settings
  @Get(':id/timekeeping-settings')
  @ApiOperation({ summary: 'Lấy cấu hình chấm công' })
  async getTimekeepingSetting(@Param('id') id: string, @GetUser() user: any) {
    return this.storesService.getTimekeepingSetting(id, user.userId);
  }

  @StoreOwnerOnly()
  @Put(':id/timekeeping-settings')
  @ApiOperation({ summary: 'Cập nhật cấu hình chấm công' })
  async updateTimekeepingSetting(
    @Param('id') id: string,
    @Body() body: StoreTimekeepingSettingDto,
    @GetUser() user: any,
  ) {
    return this.storesService.upsertTimekeepingSetting(id, body, user.userId);
  }

  // "Cách tính giờ công": theo ca / làm bao nhiêu trả bấy nhiêu.
  @StoreOwnerOnly()
  @Get(':id/worked-time-rules')
  @ApiOperation({
    summary: 'Danh sách cách tính giờ công (toàn cửa hàng / từng nhân viên)',
  })
  async listWorkedTimeRules(@Param('id') id: string, @GetUser() user: any) {
    return this.storesService.listWorkedTimeRules(id, user.userId);
  }

  @StoreOwnerOnly()
  @Post(':id/worked-time-rules')
  @ApiOperation({
    summary: 'Thêm cách tính giờ công',
    description:
      'Áp dụng từ startDate trong 1 ngày / 1 tuần / 1 tháng / vô thời hạn. Tính lại các ca đã xong trong khoảng đó, trừ tháng đã duyệt/đã trả lương.',
  })
  async createWorkedTimeRule(
    @Param('id') id: string,
    @Body() body: CreateWorkedTimeRuleDto,
    @GetUser() user: any,
  ) {
    return this.storesService.createWorkedTimeRule(id, body, user.userId);
  }

  @StoreOwnerOnly()
  @Delete(':id/worked-time-rules/:ruleId')
  @ApiOperation({
    summary: 'Xoá cách tính giờ công (tính lại các ca nó áp dụng)',
  })
  async deleteWorkedTimeRule(
    @Param('id') id: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @GetUser() user: any,
  ) {
    return this.storesService.deleteWorkedTimeRule(id, ruleId, user.userId);
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
    return this.storesService.getEmployeeDailyReport(
      storeId,
      employeeProfileId,
      date,
    );
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
    return this.storesService.getEmployeeMonthlyReport(
      storeId,
      employeeProfileId,
      month,
    );
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
    @GetUser() user?: any,
  ) {
    return this.storesService.getEmployeeShiftHours(
      storeId,
      employeeProfileId,
      month,
      filter,
      user?.userId,
    );
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
  @ApiOperation({
    summary: 'Check-in ca làm việc (QR → GPS → Face)',
    description:
      'Không gửi ảnh chỉ được khi cửa hàng chọn chấm công GPS + QR (GPS_QR) hoặc chỉ QR (QR_ONLY); khi đó QR (và với GPS_QR, vị trí trong bán kính) là bắt buộc.',
  })
  @UseInterceptors(FileInterceptor('photo', attendanceMulterConfig))
  async checkIn(
    @Param('id') id: string,
    @UploadedFile() photo: Express.Multer.File,
    @GetUser() user: any,
    @Body()
    body: {
      latitude?: string;
      longitude?: string;
      qrStoreId?: string;
      orientationNormalized?: string;
    },
  ) {
    // No photo is accepted only for a GPS_QR store (the service checks the
    // store mode and then requires QR + GPS); other stores get 400
    // ATTENDANCE_FACE_REQUIRED.
    const imageBuffer = photo ? photo.buffer : null;
    if (photo && !imageBuffer)
      throw new BadRequestException('Invalid photo upload');
    const result = await this.storesService.checkInWithFace(
      id,
      imageBuffer,
      user?.userId,
      {
        latitude: parseAttendanceCoordinate(body.latitude, 90),
        longitude: parseAttendanceCoordinate(body.longitude, 180),
        qrStoreId: body.qrStoreId,
        orientationNormalized: body.orientationNormalized === 'true',
      },
    );
    if (result.matched) {
      void this.shiftEndWorkflowService
        .scheduleForAssignment(id)
        .catch((error) =>
          this.logger.error(
            `[CheckIn] Unable to schedule shift-end workflow for ${id}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      // Màn nhân viên của chủ (ca / đi trễ) đổi ngay khi chấm công vào; trước
      // đây chỉ cập nhật sau job của chấm công ra.
      void this.storesService
        .refreshMonthlySummaryOfAssignment(id)
        .catch((error) =>
          this.logger.error(
            `[CheckIn] Unable to refresh monthly summary for ${id}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }
    return result;
  }

  @Post('shift-assignments/:id/check-out')
  @ApiOperation({
    summary: 'Check-out ca làm việc (QR → GPS → Face)',
    description:
      'Không gửi ảnh chỉ được khi cửa hàng chọn chấm công GPS + QR (GPS_QR) hoặc chỉ QR (QR_ONLY); khi đó QR (và với GPS_QR, vị trí trong bán kính) là bắt buộc.',
  })
  @UseInterceptors(FileInterceptor('photo', attendanceMulterConfig))
  async checkOut(
    @Param('id') id: string,
    @UploadedFile() photo: Express.Multer.File,
    @GetUser() user: any,
    @Body()
    body: {
      latitude?: string;
      longitude?: string;
      qrStoreId?: string;
      orientationNormalized?: string;
    },
  ) {
    // No photo is accepted only for a GPS_QR store (the service checks the
    // store mode and then requires QR + GPS); other stores get 400
    // ATTENDANCE_FACE_REQUIRED.
    const imageBuffer = photo ? photo.buffer : null;
    if (photo && !imageBuffer)
      throw new BadRequestException('Invalid photo upload');
    const result = await this.storesService.checkOutWithFace(
      id,
      imageBuffer,
      user?.userId,
      {
        latitude: parseAttendanceCoordinate(body.latitude, 90),
        longitude: parseAttendanceCoordinate(body.longitude, 180),
        qrStoreId: body.qrStoreId,
        orientationNormalized: body.orientationNormalized === 'true',
      },
    );

    if (result.matched) {
      // Unguarded, this was the only floating promise in the file without a
      // handler; an unhandled rejection terminates the process by default on
      // Node >= 15, on one of the hottest employee-facing routes.
      void this.shiftEndWorkflowService
        .markCompletedByEmployee(id)
        .catch((error) =>
          this.logger.error(
            `[CheckOut] Unable to complete shift-end workflow for ${id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
      void this.attendanceQueue
        .add(
          'process-checkout-payroll',
          { assignmentId: id },
          {
            jobId: `checkout-payroll-${id}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: 1000,
            removeOnFail: 1000,
          },
        )
        .catch((error) => {
          this.logger.error(
            `[CheckOut] Unable to enqueue payroll for ${id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    }
    return result;
  }

  @StoreOwnerOnly()
  @Put(':id/location')
  @ApiOperation({
    summary: 'Cập nhật vị trí cửa hàng',
    description:
      'Chủ cửa hàng chọn vị trí trên bản đồ. Tự động tạo QR code nếu chưa có.',
  })
  async updateStoreLocation(
    @Param('id') id: string,
    @Body() body: { latitude: number; longitude: number },
  ) {
    return this.storesService.updateStoreLocation(
      id,
      body.latitude,
      body.longitude,
    );
  }

  @StoreOwnerOnly()
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
    @GetUser() user: any,
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
    const result = await this.storesService.registerFace(
      employeeId,
      buffers,
      user?.userId,
    );
    // Clean up temp files
    photos.forEach((p) => {
      if (p.path)
        try {
          fsLib.unlinkSync(p.path);
        } catch (_e) {
          /* ignore cleanup errors */
        }
    });
    return result;
  }

  @Get('employees/:employeeId/face-registration')
  @ApiOperation({ summary: 'Kiểm tra trạng thái đăng ký khuôn mặt' })
  async getFaceRegistration(
    @Param('employeeId') employeeId: string,
    @GetUser() user: any,
  ) {
    await this.storesService.assertEmployeeRecordAccess(
      employeeId,
      user.userId,
    );
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
    return this.storesService.getAttendanceLogs(id, {
      employeeProfileId,
      dateFrom,
      dateTo,
    });
  }

  @Get('employees/:employeeId/next-shift-assignment')
  @ApiOperation({
    summary: 'Lấy ca tiếp theo hoặc ca đang active của nhân viên',
  })
  async getNextShiftAssignment(
    @Param('employeeId') employeeId: string,
    // Required, and validated here: an empty or malformed value used to reach
    // Postgres as a uuid literal and come back as a 500 with a driver message
    // (22P02, `invalid input syntax for type uuid: ""`).
    @Query('storeId', new ParseUUIDPipe({ errorHttpStatusCode: 400 }))
    storeId: string,
    @GetUser() user: any,
  ) {
    // Owner-or-self, and the profile must belong to the queried store.
    await this.storesService.assertEmployeeRecordAccess(
      employeeId,
      user.userId,
      storeId,
    );
    return this.storesService.getNextShiftAssignment(employeeId, storeId);
  }
}
