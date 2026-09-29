import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ActivityLogService } from './activity-log.service';
import {
  MyActivityLogQueryDto,
  StoreActivityLogQueryDto,
} from './dto/activity-log.dto';
import { UpdateOwnerNotificationSettingsDto } from './dto/owner-notification-settings.dto';
import { StoreAccessGuard } from './guards/store-access.guard';
import { StoreOwnerOnly } from './guards/store-owner-only.decorator';
import { StoreOwnerOnlyGuard } from './guards/store-owner-only.guard';
import { OwnerNotificationService } from './owner-notification.service';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 400 });

/**
 * X1 activity log feeds and X6 owner notification settings.
 *
 * StoreAccessGuard admits the owner and employed staff of `:storeId`/`:id`;
 * StoreOwnerOnlyGuard then restricts @StoreOwnerOnly handlers to the owner.
 */
@ApiTags('Stores - Activity & owner notifications')
@Controller('stores')
@UseGuards(JwtAuthGuard, StoreAccessGuard, StoreOwnerOnlyGuard)
export class StoreActivityController {
  constructor(
    private readonly activityLogService: ActivityLogService,
    private readonly ownerNotificationService: OwnerNotificationService,
  ) {}

  @Get(':storeId/me/activity-logs')
  @ApiOperation({
    summary: 'Lịch sử thao tác của tôi',
    description:
      'Các thao tác của chính nhân viên tại cửa hàng và các thao tác (của chủ) có đối tượng là nhân viên này. Mới nhất trước.',
  })
  async getMyActivityLogs(
    @Param('storeId', uuid) storeId: string,
    @Query() query: MyActivityLogQueryDto,
    @GetUser() user: any,
  ) {
    return this.activityLogService.listForStaff(storeId, user.userId, query);
  }

  @StoreOwnerOnly()
  @Get(':storeId/activity-logs')
  @ApiOperation({
    summary: 'Lịch sử thao tác của cửa hàng (chủ cửa hàng)',
  })
  async getStoreActivityLogs(
    @Param('storeId', uuid) storeId: string,
    @Query() query: StoreActivityLogQueryDto,
  ) {
    return this.activityLogService.listForOwner(storeId, query);
  }

  @StoreOwnerOnly()
  @Get(':id/owner-notification-settings')
  @ApiOperation({ summary: 'Cài đặt thông báo của chủ cửa hàng' })
  async getOwnerNotificationSettings(
    @Param('id', uuid) storeId: string,
    @GetUser() user: any,
  ) {
    return this.ownerNotificationService.getSettings(storeId, user.userId);
  }

  @StoreOwnerOnly()
  @Put(':id/owner-notification-settings')
  @ApiOperation({ summary: 'Cập nhật cài đặt thông báo của chủ cửa hàng' })
  async updateOwnerNotificationSettings(
    @Param('id', uuid) storeId: string,
    @Body() body: UpdateOwnerNotificationSettingsDto,
    @GetUser() user: any,
  ) {
    return this.ownerNotificationService.updateSettings(
      storeId,
      user.userId,
      body,
    );
  }
}
