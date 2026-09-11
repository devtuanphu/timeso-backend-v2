import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { GetNotificationsQueryDto } from './dto/notification.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // Notification writes are producer-side concerns. They are driven internally
  // through NotificationsService by the shift reminder processor and the
  // shift-end workflow, never by a client. Previously these were exposed as
  // POST /, POST /broadcast and POST /send-push behind JwtAuthGuard only, which
  // let any authenticated account write a notification for an arbitrary
  // accountId, push to that account's devices, or broadcast to every active
  // account. No client consumes them, so the routes are removed rather than
  // guarded; reintroduce them behind an operator-scoped guard if ops tooling
  // ever needs them.

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách thông báo với filter' })
  @ApiResponse({ status: 200, description: 'Danh sách thông báo' })
  async getNotifications(
    @GetUser() user: any,
    @Query() query: GetNotificationsQueryDto,
  ) {
    return this.notificationsService.findAll(user.userId, query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Lấy 5 thông báo gần nhất' })
  async getSummary(@GetUser() user: any) {
    const notifications = await this.notificationsService.getByAccountId(
      user.userId,
    );
    return notifications.slice(0, 5);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Đếm số thông báo chưa đọc' })
  @ApiResponse({ status: 200, description: 'Số lượng thông báo chưa đọc' })
  async getUnreadCount(@GetUser() user: any, @Query('storeId') storeId?: string) {
    if (storeId) {
      // Count unread for specific store
      const result = await this.notificationsService.findAll(user.userId, {
        storeId,
        page: 1,
        limit: 1,
      });
      const unreadCount = await this.notificationsService
        .getByAccountId(user.userId, true)
        .then((notifications) =>
          notifications.filter((n) => n.storeId === storeId).length,
        );
      return { count: unreadCount };
    }
    return this.notificationsService.getUnreadCount(user.userId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Đánh dấu thông báo đã đọc' })
  @ApiResponse({ status: 200, description: 'Đã đánh dấu thông báo' })
  async markAsRead(@Param('id') id: string, @GetUser() user: any) {
    return this.notificationsService.markAsRead(id, user.userId);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Đánh dấu tất cả thông báo đã đọc' })
  @ApiResponse({ status: 200, description: 'Đã đánh dấu tất cả' })
  async markAllAsRead(@GetUser() user: any, @Query('storeId') storeId?: string) {
    if (storeId) {
      // Mark all as read for specific store
      await this.notificationsService.markAllAsReadForStore(user.userId, storeId);
      return { message: 'Đã đánh dấu tất cả thông báo của cửa hàng là đã đọc' };
    }
    return this.notificationsService.markAllAsRead(user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xóa thông báo' })
  @ApiResponse({ status: 200, description: 'Đã xóa thông báo' })
  async delete(@Param('id') id: string, @GetUser() user: any) {
    return this.notificationsService.delete(id, user.userId);
  }
}
