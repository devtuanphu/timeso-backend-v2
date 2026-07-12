import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { Account } from '../accounts/entities/account.entity';
import { DevicesService } from '../devices/devices.service';
import { ExpoPushService } from '../push/expo-push.service';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly devicesService: DevicesService,
    private readonly expoPushService: ExpoPushService,
  ) {}

  // Create notification
  async create(
    data: Partial<Notification>,
    pushOptions?: {
      categoryId?: string;
      priority?: 'default' | 'normal' | 'high';
      channelId?: string;
    },
  ) {
    const notification = this.notificationRepository.create(data);
    const saved = await this.notificationRepository.save(notification);

    // Send push notification
    if (data.accountId) {
      await this.sendPushToUser(data.accountId, {
        title: data.title || 'Thông báo mới',
        body: data.content || '',
        data: {
          ...(data.metadata || {}),
          notificationId: saved.id,
          notificationType: data.type || '',
          actionUrl: data.actionUrl || '',
        },
        ...pushOptions,
      });
    }

    return saved;
  }

  // Send push notification to user's devices (public for direct use)
  async sendPushToUser(
    userId: string,
    notification: {
      title: string;
      body: string;
      data?: Record<string, any>;
      categoryId?: string;
      priority?: 'default' | 'normal' | 'high';
      channelId?: string;
    }
  ) {
    const devices = await this.devicesService.getActiveDevicesByUser(userId);
    const tokens = devices.map(d => d.expoPushToken);

    if (tokens.length > 0) {
      await this.expoPushService.sendToMultiple(tokens, notification);
    }

    return {
      sent: tokens.length > 0,
      devicesCount: tokens.length,
    };
  }

  // Send push notification only (without creating notification record)
  async sendPushOnly(
    accountId: string,
    title: string,
    body: string,
    data?: Record<string, any>,
    options?: {
      categoryId?: string;
      priority?: 'default' | 'normal' | 'high';
      channelId?: string;
    },
  ) {
    return this.sendPushToUser(accountId, {
      title,
      body,
      data,
      ...options,
    });
  }

  // Get all notifications for a user with filters
  async findAll(accountId: string, query: any) {
    const qb = this.notificationRepository
      .createQueryBuilder('n')
      .where('n.accountId = :accountId', { accountId });

    // Filter by type
    if (query.type) {
      qb.andWhere('n.type = :type', { type: query.type });
    }

    // Filter by store
    if (query.storeId) {
      qb.andWhere('n.storeId = :storeId', { storeId: query.storeId });
    }

    // Filter by date range
    if (query.dateFrom) {
      qb.andWhere('n.createdAt >= :dateFrom', { dateFrom: new Date(query.dateFrom) });
    }
    if (query.dateTo) {
      qb.andWhere('n.createdAt <= :dateTo', { dateTo: new Date(query.dateTo) });
    }

    // Search by title
    if (query.search) {
      qb.andWhere('n.title ILIKE :search', { search: `%${query.search}%` });
    }

    // Pagination
    const page = query.page || 1;
    const limit = query.limit || 20;
    qb.skip((page - 1) * limit).take(limit);

    // Order by newest first
    qb.orderBy('n.createdAt', 'DESC');

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Get all notifications for a user (legacy - kept for backward compatibility)
  async getByAccountId(accountId: string, unreadOnly: boolean = false) {
    const where: any = { accountId };
    if (unreadOnly) {
      where.isRead = false;
    }

    return this.notificationRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  // Mark notification as read
  async markAsRead(id: string, accountId: string) {
    const notification = await this.notificationRepository.findOne({
      where: { id, accountId },
    });

    if (!notification) {
      return null;
    }

    notification.isRead = true;
    notification.readAt = new Date();
    return this.notificationRepository.save(notification);
  }

  // Mark all notifications as read for a user
  async markAllAsRead(accountId: string) {
    await this.notificationRepository.update(
      { accountId, isRead: false },
      { isRead: true, readAt: new Date() },
    );
    return { message: 'Đã đánh dấu tất cả thông báo là đã đọc' };
  }

  // Mark all notifications as read for a specific store
  async markAllAsReadForStore(accountId: string, storeId: string) {
    await this.notificationRepository.update(
      { accountId, storeId, isRead: false },
      { isRead: true, readAt: new Date() },
    );
    return { message: 'Đã đánh dấu tất cả thông báo của cửa hàng là đã đọc' };
  }

  // Delete notification
  async delete(id: string, accountId: string) {
    await this.notificationRepository.delete({ id, accountId });
    return { message: 'Đã xóa thông báo' };
  }

  // Get unread count
  async getUnreadCount(accountId: string) {
    const count = await this.notificationRepository.count({
      where: { accountId, isRead: false },
    });
    return { count };
  }

  // Create notifications for multiple users
  async createMany(data: Partial<Notification>[], accountIds: string[]) {
    const notifications = accountIds.map((accountId) =>
      this.notificationRepository.create({ ...data[0], accountId }),
    );
    return this.notificationRepository.save(notifications);
  }

  // Send notification to ALL active users
  async broadcast(data: Partial<Notification>) {
    const accounts = await this.accountRepository.find({
      where: { status: 'active' as any },
    });
    const accountIds = accounts.map((a) => a.id);

    const notifications = accountIds.map((accountId) =>
      this.notificationRepository.create({ ...data, accountId }),
    );

    // Save in chunks if there are many users to avoid DB limits
    const chunkSize = 100;
    for (let i = 0; i < notifications.length; i += chunkSize) {
      await this.notificationRepository.save(
        notifications.slice(i, i + chunkSize),
      );
    }

    return {
      message: `Đã gửi thông báo tới ${notifications.length} người dùng`,
      count: notifications.length,
    };
  }
}
