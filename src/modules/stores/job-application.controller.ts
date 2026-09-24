import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream } from 'fs';

import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoreOwnerOnly } from './guards/store-owner-only.decorator';
import { StoreOwnerOnlyGuard } from './guards/store-owner-only.guard';
import { JobApplicationService } from './job-application.service';
import {
  JOB_APPLICATION_SELFIE_FIELD,
  JobApplicationSelfieCleanupInterceptor,
  jobApplicationSelfieMulterConfig,
} from './job-application-selfie.storage';
import {
  AcceptJobApplicationDto,
  CreateJobApplicationDto,
  ListJobApplicationsQueryDto,
  RejectJobApplicationDto,
} from './dto/job-application.dto';

/**
 * Staff job applications.
 *
 * Route ordering note: `StoresController` registers a catch-all `@Get(':id')`.
 * Every route here has at least two segments after `/stores`, so none of them
 * can be shadowed by it.
 */
@ApiTags('Cửa hàng - Ứng tuyển')
@ApiBearerAuth()
@Controller('stores')
@UseGuards(JwtAuthGuard, StoreOwnerOnlyGuard)
export class JobApplicationController {
  constructor(private readonly jobApplicationService: JobApplicationService) {}

  @Get('job-applications/mine')
  @ApiOperation({
    summary: 'Đơn ứng tuyển của tôi',
    description:
      'Dùng cho màn tìm cửa hàng của nhân viên để hiển thị trạng thái đã gửi thông tin.',
  })
  async listMine(@GetUser() user: any) {
    return this.jobApplicationService.listMine(user?.userId);
  }

  /**
   * Accepts JSON (unchanged) or multipart/form-data with the same text fields
   * plus an optional `selfie` file. Multer only engages for multipart, so the
   * JSON path is untouched. The cleanup interceptor wraps multer so a selfie
   * written to disk is deleted if the ValidationPipe or the service refuses
   * the request.
   */
  @Post(':storeId/job-applications')
  @UseInterceptors(
    JobApplicationSelfieCleanupInterceptor,
    FileInterceptor(JOB_APPLICATION_SELFIE_FIELD, jobApplicationSelfieMulterConfig),
  )
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiOperation({
    summary: 'Nhân viên gửi thông tin ứng tuyển',
    description:
      'JSON hoặc multipart/form-data. Multipart có thể kèm ảnh chân dung ở trường `selfie` (JPEG/PNG, tối đa 5 MB).',
  })
  async apply(
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Body() body: CreateJobApplicationDto,
    @GetUser() user: any,
    @UploadedFile() selfie?: Express.Multer.File,
  ) {
    return this.jobApplicationService.apply(
      user?.userId,
      storeId,
      body,
      selfie,
    );
  }

  /**
   * Streams an application's selfie.
   *
   * Deliberately NOT `@StoreOwnerOnly()`: the applicant must be able to read
   * their own selfie, so `StoreOwnerOnlyGuard` passes this route through and
   * `JobApplicationService.getSelfie` authorizes it — store owner of the
   * application's store, or the applicant; everyone else gets the same 404.
   */
  @Get(':storeId/job-applications/:applicationId/selfie')
  @ApiOperation({
    summary: 'Ảnh chân dung của đơn ứng tuyển',
    description: 'Chỉ chủ cửa hàng nhận đơn và chính người ứng tuyển được xem.',
  })
  async getSelfie(
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Param('applicationId', new ParseUUIDPipe()) applicationId: string,
    @GetUser() user: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { absolutePath, contentType } =
      await this.jobApplicationService.getSelfie(
        storeId,
        applicationId,
        user?.userId,
      );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(createReadStream(absolutePath), {
      type: contentType,
    });
  }

  @Post(':storeId/job-applications/:applicationId/withdraw')
  @ApiOperation({
    summary: 'Nhân viên thu hồi đơn ứng tuyển',
    description:
      'Chỉ người gửi mới thu hồi được đơn của mình, và chỉ khi đơn đang chờ xử lý.',
  })
  async withdraw(
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Param('applicationId', new ParseUUIDPipe()) applicationId: string,
    @GetUser() user: any,
  ) {
    return this.jobApplicationService.withdraw(
      storeId,
      applicationId,
      user?.userId,
    );
  }

  @StoreOwnerOnly()
  @Get(':storeId/job-applications')
  @ApiOperation({ summary: 'Danh sách đơn ứng tuyển của cửa hàng (chủ cửa hàng)' })
  async list(
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Query() query: ListJobApplicationsQueryDto,
    @GetUser() user: any,
  ) {
    return this.jobApplicationService.listForStore(storeId, user?.userId, query);
  }

  @StoreOwnerOnly()
  @Post(':storeId/job-applications/:applicationId/accept')
  @ApiOperation({
    summary: 'Nhận vào làm việc',
    description:
      'Tạo hồ sơ nhân viên từ đơn ứng tuyển, dùng lại luồng thêm nhân viên từ tài khoản đã có.',
  })
  async accept(
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Param('applicationId', new ParseUUIDPipe()) applicationId: string,
    @Body() body: AcceptJobApplicationDto,
    @GetUser() user: any,
  ) {
    return this.jobApplicationService.accept(
      storeId,
      applicationId,
      user?.userId,
      body,
    );
  }

  @StoreOwnerOnly()
  @Post(':storeId/job-applications/:applicationId/reject')
  @ApiOperation({ summary: 'Từ chối đơn ứng tuyển' })
  async reject(
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Param('applicationId', new ParseUUIDPipe()) applicationId: string,
    @Body() body: RejectJobApplicationDto,
    @GetUser() user: any,
  ) {
    return this.jobApplicationService.reject(
      storeId,
      applicationId,
      user?.userId,
      body,
    );
  }
}
