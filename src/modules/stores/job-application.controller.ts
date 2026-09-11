import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JobApplicationService } from './job-application.service';
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
@UseGuards(JwtAuthGuard)
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

  @Post(':storeId/job-applications')
  @ApiOperation({ summary: 'Nhân viên gửi thông tin ứng tuyển' })
  async apply(
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Body() body: CreateJobApplicationDto,
    @GetUser() user: any,
  ) {
    return this.jobApplicationService.apply(user?.userId, storeId, body);
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

  @Get(':storeId/job-applications')
  @ApiOperation({ summary: 'Danh sách đơn ứng tuyển của cửa hàng (chủ cửa hàng)' })
  async list(
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Query() query: ListJobApplicationsQueryDto,
    @GetUser() user: any,
  ) {
    return this.jobApplicationService.listForStore(storeId, user?.userId, query);
  }

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
