import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { ChatGroup } from './entities/chat-group.entity';
import { ChatGroupMember } from './entities/chat-group-member.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { CreateChatGroupDto } from './dto/create-chat-group.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateChatGroupDto } from './dto/update-chat-group.dto';
import { ChatAuthorizationService } from './chat-authorization.service';
import { chatAccessDenied } from './chat-errors';
import { validateChatGroupName } from './chat-message.utils';
import { mapActiveChatMember } from './chat-member.mapper';

@Injectable()
export class ChatGroupsService {
  constructor(
    @InjectRepository(ChatGroup)
    private chatGroupRepository: Repository<ChatGroup>,
    @InjectRepository(ChatGroupMember)
    private chatGroupMemberRepository: Repository<ChatGroupMember>,
    @InjectRepository(ChatMessage)
    private chatMessageRepository: Repository<ChatMessage>,
    private readonly dataSource: DataSource,
    private readonly authorization: ChatAuthorizationService,
  ) {}

  // Create group with members
  async createGroup(dto: CreateChatGroupDto, userId: string) {
    const groupId = await this.dataSource.transaction(async (manager) => {
      await this.authorization.requireStoreOwner(dto.storeId, userId, manager);
      const accountIds = [...new Set([userId, ...dto.memberIds])];
      await this.authorization.requireEligibleParticipants(
        dto.storeId,
        accountIds,
        userId,
        manager,
      );
      const customSenderIds = dto.customSenderIds || [];
      if (customSenderIds.some((id) => !accountIds.includes(id))) {
        throw new BadRequestException(
          'Người có quyền gửi phải là thành viên của nhóm',
        );
      }

      const groups = manager.getRepository(ChatGroup);
      const group = await groups.save(
        groups.create({
          name: validateChatGroupName(dto.name),
          storeId: dto.storeId,
          createdBy: userId,
          messagePermission: dto.messagePermission || 'everyone',
          customSenderIds,
        }),
      );
      const members = manager.getRepository(ChatGroupMember);
      await members.save(
        accountIds.map((accountId) =>
          members.create({ groupId: group.id, accountId, status: 'active' }),
        ),
      );
      return group.id;
    });

    return this.getGroupDetails(groupId, userId);
  }

  // Get groups by store
  async getGroupsByStore(storeId: string, userId: string) {
    const groups = await this.chatGroupRepository
      .createQueryBuilder('group')
      .leftJoinAndSelect('group.members', 'member')
      .leftJoinAndSelect('member.account', 'account')
      .leftJoinAndSelect('member.employeeProfile', 'employeeProfile')
      .leftJoin('group.messages', 'message')
      .addSelect([
        'message.id',
        'message.content',
        'message.messageType',
        'message.senderId',
        'message.createdAt',
      ])
      .where('group.storeId = :storeId', { storeId })
      .andWhere('member.accountId = :userId', { userId })
      .andWhere('member.status = :status', { status: 'active' })
      .orderBy('message.createdAt', 'DESC')
      .getMany();

    const authorizedGroups = await this.filterAuthorizedGroups(groups, userId);

    // Calculate unread count for each group
    const groupsWithUnread = await Promise.all(
      authorizedGroups.map(async (group) => {
        const member = group.members.find((m) => m.accountId === userId);
        const unreadCount = await this.getUnreadCount(group.id, userId, member?.lastReadAt);

        // Get last message
        const lastMessage = group.messages?.[0] || null;

        return {
          id: group.id,
          name: group.name,
          avatar: group.avatar || null,
          storeId: group.storeId,
          createdBy: group.createdBy,
          messagePermission: group.messagePermission,
          customSenderIds: group.customSenderIds || [],
          members: group.members
            .filter((item) => item.status === 'active')
            .map((item) => mapActiveChatMember(item, group.createdBy)),
          unreadCount,
          lastMessage: lastMessage
            ? {
                id: lastMessage.id,
                content: lastMessage.content,
                messageType: lastMessage.messageType,
                senderId: lastMessage.senderId,
                createdAt: lastMessage.createdAt,
              }
            : null,
        };
      }),
    );

    return groupsWithUnread;
  }

  // Get all groups for user (across all stores)
  async getAllGroupsForUser(userId: string) {
    const groups = await this.chatGroupRepository
      .createQueryBuilder('group')
      .leftJoinAndSelect('group.members', 'member')
      .leftJoinAndSelect('member.account', 'account')
      .leftJoinAndSelect('member.employeeProfile', 'employeeProfile')
      .leftJoin('group.messages', 'message')
      .addSelect([
        'message.id',
        'message.content',
        'message.messageType',
        'message.senderId',
        'message.createdAt',
      ])
      .where('member.accountId = :userId', { userId })
      .andWhere('member.status = :status', { status: 'active' })
      .orderBy('message.createdAt', 'DESC')
      .getMany();

    const authorizedGroups = await this.filterAuthorizedGroups(groups, userId);

    // Calculate unread count for each group
    const groupsWithUnread = await Promise.all(
      authorizedGroups.map(async (group) => {
        const member = group.members.find((m) => m.accountId === userId);
        const unreadCount = await this.getUnreadCount(group.id, userId, member?.lastReadAt);

        // Get last message
        const lastMessage = group.messages?.[0] || null;

        return {
          id: group.id,
          name: group.name,
          avatar: group.avatar || null,
          storeId: group.storeId,
          createdBy: group.createdBy,
          messagePermission: group.messagePermission,
          customSenderIds: group.customSenderIds || [],
          members: group.members
            .filter((item) => item.status === 'active')
            .map((item) => mapActiveChatMember(item, group.createdBy)),
          unreadCount,
          lastMessage: lastMessage
            ? {
                id: lastMessage.id,
                content: lastMessage.content,
                messageType: lastMessage.messageType,
                senderId: lastMessage.senderId,
                createdAt: lastMessage.createdAt,
              }
            : null,
        };
      }),
    );

    return groupsWithUnread;
  }

  // Get total unread count across all groups
  async getTotalUnreadCount(userId: string) {
    const groups = await this.getUserGroups(userId);
    
    let totalUnread = 0;
    for (const group of groups) {
      const member = await this.chatGroupMemberRepository.findOne({
        where: { groupId: group.id, accountId: userId, status: 'active' },
      });
      
      if (member) {
        const unreadCount = await this.getUnreadCount(
          group.id,
          userId,
          member.lastReadAt
        );
        totalUnread += unreadCount;
      }
    }
    
    return { totalUnread };
  }

  // Get group details
  async getGroupDetails(groupId: string, userId: string) {
    const context = await this.authorization.requireGroupAccess(groupId, userId);
    const group = await this.chatGroupRepository.findOne({
      where: { id: groupId },
    });

    if (!group) throw new ForbiddenException('CHAT_ACCESS_DENIED');
    const members = await this.chatGroupMemberRepository.find({
      where: { groupId, status: 'active' },
      relations: ['account'],
      order: { createdAt: 'ASC' },
    });

    return {
      id: group.id,
      name: group.name,
      avatar: group.avatar || null,
      storeId: group.storeId,
      createdBy: group.createdBy,
      messagePermission: group.messagePermission,
      customSenderIds: group.customSenderIds || [],
      members: members.map((member) =>
        mapActiveChatMember(member, context.group.store.ownerAccountId),
      ),
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };
  }

  // Get messages with pagination
  async getGroupMessages(
    groupId: string,
    userId: string,
    page = 1,
    limit = 50,
  ) {
    this.assertLegacyPagination(page, limit, 100);
    // Verify membership
    await this.verifyMembership(groupId, userId);

    const [messages, total] = await this.chatMessageRepository.findAndCount({
      where: { groupId },
      relations: ['sender'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: messages.reverse().map((message) => this.mapLegacyMessage(message)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Send message
  async sendMessage(dto: SendMessageDto, userId: string) {
    // Verify membership and permissions
    await this.verifyMembership(dto.groupId, userId);
    await this.verifyMessagePermission(dto.groupId, userId);

    const message = this.chatMessageRepository.create({
      groupId: dto.groupId,
      senderId: userId,
      content: dto.content,
      messageType: dto.messageType || 'text',
      attachmentUrl: dto.attachmentUrl,
      attachmentName: dto.attachmentName,
      attachmentSize:
        dto.attachmentSize === undefined ? null : String(dto.attachmentSize),
      readBy: [userId], // Sender has read it
    });

    await this.chatMessageRepository.save(message);

    // Load sender info
    return this.chatMessageRepository.findOne({
      where: { id: message.id },
      relations: ['sender'],
    });
  }

  // Mark message as read
  async markMessageAsRead(messageId: string, userId: string) {
    const message = await this.chatMessageRepository.findOne({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('Tin nhắn không tồn tại');
    }

    // Verify membership
    await this.verifyMembership(message.groupId, userId);

    // Add user to readBy if not already there
    if (!message.readBy) {
      message.readBy = [];
    }

    if (!message.readBy.includes(userId)) {
      message.readBy.push(userId);
      await this.chatMessageRepository.save(message);
    }

    return message;
  }

  // Mark all messages in group as read
  async markGroupAsRead(groupId: string, userId: string) {
    await this.verifyMembership(groupId, userId);

    // Update lastReadAt for member
    await this.chatGroupMemberRepository.update(
      { groupId, accountId: userId },
      { lastReadAt: new Date() },
    );

    return { success: true };
  }

  // Update group settings
  async updateGroupSettings(
    groupId: string,
    dto: UpdateChatGroupDto,
    userId: string,
  ) {
    const context = await this.authorization.requireGroupAdmin(groupId, userId);
    const group = context.group;

    if (dto.customSenderIds) {
      const activeMembers = await this.chatGroupMemberRepository.find({
        where: { groupId, status: 'active' },
        select: { accountId: true },
      });
      const activeIds = activeMembers.map((member) => member.accountId);
      if (dto.customSenderIds.some((id) => !activeIds.includes(id))) {
        throw new BadRequestException(
          'Người có quyền gửi phải là thành viên của nhóm',
        );
      }
    }
    Object.assign(group, {
      ...dto,
      ...(dto.name !== undefined
        ? { name: validateChatGroupName(dto.name) }
        : {}),
    });
    await this.chatGroupRepository.save(group);

    return group;
  }

  // Add members
  async addMembers(groupId: string, memberIds: string[], userId: string) {
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      throw new BadRequestException('CHAT_MEMBERS_REQUIRED');
    }

    await this.dataSource.transaction(async (manager) => {
      const context = await this.authorization.requireGroupAdmin(
        groupId,
        userId,
        manager,
      );
      const lockedGroup = await manager.getRepository(ChatGroup).findOne({
        where: { id: groupId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedGroup) throw new ForbiddenException('CHAT_ACCESS_DENIED');
      const uniqueIds = [...new Set(memberIds)];
      const members = manager.getRepository(ChatGroupMember);
      await this.authorization.requireEligibleParticipants(
        context.group.storeId,
        uniqueIds,
        userId,
        manager,
      );
      const alreadyActive = await members
        .createQueryBuilder('member')
        .select('member.accountId', 'accountId')
        .where('member.groupId = :groupId', { groupId })
        .andWhere('member.accountId IN (:...accountIds)', {
          accountIds: uniqueIds,
        })
        .andWhere('member.status = :active', { active: 'active' })
        .getRawMany<{ accountId: string }>();
      const existing = new Set(alreadyActive.map((row) => row.accountId));
      const newIds = uniqueIds.filter((id) => !existing.has(id));
      const activeCount = await members.count({
        where: { groupId, status: 'active' },
      });
      if (activeCount + newIds.length > 200) {
        throw new BadRequestException('Nhóm chat không được quá 200 thành viên');
      }
      if (newIds.length > 0) {
        await members.save(
          newIds.map((accountId) =>
            members.create({ groupId, accountId, status: 'active' }),
          ),
        );
      }
    });

    return this.getGroupDetails(groupId, userId);
  }

  // Remove member
  async removeMember(groupId: string, memberId: string, userId: string) {
    const context = await this.authorization.requireGroupAdmin(groupId, userId);
    const group = context.group;

    // Can't remove creator
    if (memberId === group.createdBy) {
      throw new BadRequestException('Không thể xóa người tạo nhóm');
    }

    await this.chatGroupMemberRepository.update(
      { groupId, accountId: memberId },
      { status: 'removed' },
    );

    return { success: true };
  }

  // Leave group
  async leaveGroup(groupId: string, userId: string) {
    const context = await this.authorization.requireGroupAccess(groupId, userId);
    const group = context.group;

    // Creator can't leave
    if (group.createdBy === userId) {
      throw new BadRequestException('Người tạo nhóm không thể rời nhóm');
    }

    await this.chatGroupMemberRepository.update(
      { groupId, accountId: userId },
      { status: 'left' },
    );

    return { success: true };
  }

  // Get group members
  async getGroupMembers(groupId: string, userId: string) {
    const context = await this.authorization.requireGroupAccess(groupId, userId);

    const members = await this.chatGroupMemberRepository.find({
      where: { groupId, status: 'active' },
      relations: ['account'],
      order: { createdAt: 'ASC' },
    });

    return members.map((member) =>
      mapActiveChatMember(member, context.group.store.ownerAccountId),
    );
  }

  // Get user's groups (for WebSocket)
  async getUserGroups(userId: string) {
    const members = await this.chatGroupMemberRepository.find({
      where: { accountId: userId, status: 'active' },
      relations: ['group'],
    });

    return this.filterAuthorizedGroups(
      members.map((m) => m.group),
      userId,
    );
  }

  private async filterAuthorizedGroups(
    groups: ChatGroup[],
    userId: string,
  ): Promise<ChatGroup[]> {
    const checked = await Promise.all(
      groups.map(async (group) => {
        try {
          await this.authorization.requireGroupAccess(group.id, userId);
          return group;
        } catch (error) {
          if (error instanceof ForbiddenException) return null;
          throw error;
        }
      }),
    );
    return checked.filter((group): group is ChatGroup => group !== null);
  }

  // Helper: Verify membership
  async verifyMembership(groupId: string, userId: string) {
    const context = await this.authorization.requireGroupAccess(groupId, userId);
    return context.member;
  }

  // Helper: Verify message permission
  private async verifyMessagePermission(groupId: string, userId: string) {
    const group = await this.chatGroupRepository.findOne({
      where: { id: groupId },
    });

    if (!group) {
      throw new NotFoundException('Nhóm chat không tồn tại');
    }

    // Everyone can send
    if (group.messagePermission === 'everyone') {
      return true;
    }

    // Only admin
    if (group.messagePermission === 'admin_only') {
      if (group.createdBy !== userId) {
        throw new ForbiddenException('Chỉ quản trị viên mới có thể gửi tin nhắn');
      }
      return true;
    }

    // Custom list
    if (group.messagePermission === 'custom') {
      if (!group.customSenderIds || !group.customSenderIds.includes(userId)) {
        throw new ForbiddenException('Bạn không có quyền gửi tin nhắn trong nhóm này');
      }
      return true;
    }

    return true;
  }

  // Helper: Get unread count
  private async getUnreadCount(
    groupId: string,
    userId: string,
    lastReadAt?: Date,
  ) {
    if (!lastReadAt) {
      // Never read, count all messages
      return this.chatMessageRepository.count({
        where: { groupId },
      });
    }

    return this.chatMessageRepository.count({
      where: {
        groupId,
        createdAt: MoreThan(lastReadAt),
      },
    });
  }

  // Update member settings (color, notifications)
  async updateMemberSettings(
    groupId: string,
    userId: string,
    settings: { chatColor?: string; notificationsEnabled?: boolean },
  ) {
    const { member } = await this.authorization.requireGroupAccess(
      groupId,
      userId,
    );
    const updates: {
      chatColor?: string;
      notificationsEnabled?: boolean;
    } = {};

    if (settings.chatColor !== undefined) {
      updates.chatColor = settings.chatColor;
    }

    if (settings.notificationsEnabled !== undefined) {
      updates.notificationsEnabled = settings.notificationsEnabled;
    }

    if (Object.keys(updates).length === 0) {
      return {
        id: member.id,
        chatColor: member.chatColor,
        notificationsEnabled: member.notificationsEnabled,
      };
    }

    const result = await this.chatGroupMemberRepository
      .createQueryBuilder()
      .update(ChatGroupMember)
      .set(updates)
      .where('id = :memberId', { memberId: member.id })
      .andWhere('group_id = :groupId', { groupId })
      .andWhere('account_id = :userId', { userId })
      .andWhere("status = 'active'")
      .andWhere('deleted_at IS NULL')
      .returning(['id', 'chatColor', 'notificationsEnabled'])
      .execute();

    if (result.affected !== 1) {
      throw chatAccessDenied();
    }

    const updated = result.raw[0] as {
      id: string;
      chat_color: string | null;
      notifications_enabled: boolean;
    };

    return {
      id: updated.id,
      chatColor: updated.chat_color,
      notificationsEnabled: updated.notifications_enabled,
    };
  }

  // Get group media (images, videos, documents)
  async getGroupMedia(
    groupId: string,
    userId: string,
    type: string = 'all',
    page: number = 1,
    limit: number = 20,
  ) {
    this.assertLegacyPagination(page, limit, 100);
    // Verify membership
    await this.getGroupDetails(groupId, userId);

    const queryBuilder = this.chatMessageRepository
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.sender', 'sender')
      .where('message.groupId = :groupId', { groupId })
      .andWhere('message.attachmentUrl IS NOT NULL')
      .orderBy('message.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    // Filter by type
    if (type !== 'all') {
      if (type === 'image') {
        queryBuilder.andWhere('message.messageType = :type', { type: 'image' });
      } else if (type === 'video') {
        // Videos are stored as 'file' type, need to check attachment name
        queryBuilder.andWhere('message.messageType = :type', { type: 'file' });
      } else if (type === 'document') {
        queryBuilder.andWhere('message.messageType = :type', { type: 'file' });
      }
    }

    const [messages, total] = await queryBuilder.getManyAndCount();

    const media = messages.map((msg) => ({
      id: msg.id,
      type: msg.messageType === 'image' ? 'image' : msg.messageType === 'file' ? 'document' : 'document',
      url: msg.attachmentUrl,
      fileName: msg.attachmentName || 'Unknown',
      fileSize: msg.attachmentSize || 0,
      createdAt: msg.createdAt,
      sender: {
        id: msg.sender.id,
        fullName: msg.sender.fullName,
        avatar: msg.sender.avatar,
      },
    }));

    return {
      media,
      total,
      page,
      limit,
    };
  }

  // Search messages in group
  async searchMessages(
    groupId: string,
    userId: string,
    query: string,
    page: number = 1,
    limit: number = 20,
  ) {
    this.assertLegacyPagination(page, limit, 50);
    // Verify membership
    await this.getGroupDetails(groupId, userId);

    const normalized = query.normalize('NFC').trim();
    if (!normalized || Array.from(normalized).length > 200) {
      throw new BadRequestException('Từ khóa tìm kiếm không hợp lệ');
    }
    const escaped = normalized.replace(/[\\%_]/g, (value) => `\\${value}`);
    const [messages, total] = await this.chatMessageRepository
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.sender', 'sender')
      .where('message.groupId = :groupId', { groupId })
      .andWhere(`message.content ILIKE :pattern ESCAPE '\\'`, {
        pattern: `%${escaped}%`,
      })
      .orderBy('message.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(Math.min(limit, 50))
      .getManyAndCount();

    return {
      messages: messages.map((message) => this.mapLegacyMessage(message)),
      total,
      page,
      limit,
    };
  }

  private assertLegacyPagination(
    page: number,
    limit: number,
    maxLimit: number,
  ): void {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 10_000 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > maxLimit
    ) {
      throw new BadRequestException('Phân trang không hợp lệ');
    }
  }

  private mapLegacyMessage(message: ChatMessage) {
    return {
      id: message.id,
      groupId: message.groupId,
      senderId: message.senderId,
      content: message.content,
      messageType: message.messageType,
      attachmentUrl: message.attachmentUrl,
      attachmentName: message.attachmentName,
      attachmentSize: message.attachmentSize,
      readBy: message.readBy,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      sender: message.sender
        ? {
            id: message.sender.id,
            fullName: message.sender.fullName,
            avatar: message.sender.avatar,
          }
        : null,
    };
  }
}
