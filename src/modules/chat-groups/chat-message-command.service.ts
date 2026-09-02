import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';

import { isAppReadOnlyMode } from '../../common/utils/app-read-only-mode';
import { ChatAuthorizationService } from './chat-authorization.service';
import { chatIdempotencyConflict, chatNotReady } from './chat-errors';
import { mapChatMessage } from './chat-message.mapper';
import { validateChatContent } from './chat-message.utils';
import {
  SendChatMessageDto,
  SendChatMessageResponseDto,
} from './dto/chat-v2.dto';
import { ChatGroupMember } from './entities/chat-group-member.entity';
import { ChatMessage } from './entities/chat-message.entity';
import {
  ChatOutboxEvent,
  ChatOutboxEventType,
  ChatOutboxStatus,
} from './entities/chat-outbox-event.entity';

interface SendResult extends SendChatMessageResponseDto {
  httpStatus: 200 | 201;
}

@Injectable()
export class ChatMessageCommandService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorization: ChatAuthorizationService,
    private readonly configService: ConfigService,
  ) {}

  async sendTextMessage(
    groupId: string,
    accountId: string,
    dto: SendChatMessageDto,
  ): Promise<SendResult> {
    if (isAppReadOnlyMode(this.configService)) {
      throw chatNotReady();
    }
    const content = validateChatContent(dto.content);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const context = await this.authorization.requireGroupAccess(
          groupId,
          accountId,
          manager,
        );
        this.requireSendPermission(context.group, accountId);

        const existing = await this.findIdempotentMessage(
          manager,
          groupId,
          accountId,
          dto.clientMessageId,
        );
        if (existing) {
          return this.resolveExisting(existing, content);
        }

        const messages = manager.getRepository(ChatMessage);
        const message = messages.create({
          groupId,
          senderId: accountId,
          clientMessageId: dto.clientMessageId,
          content,
          messageType: 'text',
          attachmentUrl: null,
          attachmentName: null,
          attachmentSize: null,
          readBy: [accountId],
        });
        const saved = await messages.save(message);

        const persisted = await messages.findOne({
          where: { id: saved.id },
          relations: ['sender'],
        });
        if (!persisted?.sequence) {
          throw new ServiceUnavailableException({
            statusCode: 503,
            code: 'CHAT_SCHEMA_NOT_READY',
            message: 'Dịch vụ trò chuyện đang được nâng cấp',
          });
        }

        await manager
          .createQueryBuilder()
          .update(ChatGroupMember)
          .set({
            lastReadSequence: () =>
              `GREATEST(COALESCE(last_read_sequence, 0), ${persisted.sequence})`,
            lastReadAt: () => 'CURRENT_TIMESTAMP',
          })
          .where('group_id = :groupId', { groupId })
          .andWhere('account_id = :accountId', { accountId })
          .andWhere('status = :active', { active: 'active' })
          .execute();

        const outbox = manager.getRepository(ChatOutboxEvent).create({
          eventType: ChatOutboxEventType.MESSAGE_CREATED_V1,
          groupId,
          messageId: persisted.id,
          actorAccountId: accountId,
          sequence: persisted.sequence,
          status: ChatOutboxStatus.PENDING,
          attemptCount: 0,
          availableAt: new Date(),
        });
        await manager.getRepository(ChatOutboxEvent).save(outbox);

        return {
          message: mapChatMessage(persisted),
          deduplicated: false,
          httpStatus: 201,
        };
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;

      await this.authorization.requireGroupAccess(groupId, accountId);
      const existing = await this.findIdempotentMessage(
        this.dataSource.manager,
        groupId,
        accountId,
        dto.clientMessageId,
      );
      if (!existing) throw error;
      return this.resolveExisting(existing, content);
    }
  }

  private requireSendPermission(
    group: {
      messagePermission: string;
      createdBy: string;
      customSenderIds: string[];
    },
    accountId: string,
  ): void {
    if (group.messagePermission === 'everyone') return;
    if (
      group.messagePermission === 'admin_only' &&
      group.createdBy === accountId
    ) {
      return;
    }
    if (
      group.messagePermission === 'custom' &&
      group.customSenderIds?.includes(accountId)
    ) {
      return;
    }
    throw new ForbiddenException({
      statusCode: 403,
      code: 'CHAT_SEND_DENIED',
      message: 'Bạn không có quyền gửi tin nhắn trong nhóm này',
    });
  }

  private async findIdempotentMessage(
    manager: EntityManager,
    groupId: string,
    senderId: string,
    clientMessageId: string,
  ): Promise<ChatMessage | null> {
    return manager
      .getRepository(ChatMessage)
      .createQueryBuilder('message')
      .withDeleted()
      .leftJoinAndSelect('message.sender', 'sender')
      .where('message.groupId = :groupId', { groupId })
      .andWhere('message.senderId = :senderId', { senderId })
      .andWhere('message.clientMessageId = :clientMessageId', {
        clientMessageId,
      })
      .getOne();
  }

  private resolveExisting(
    message: ChatMessage,
    canonicalContent: string,
  ): SendResult {
    if (message.content !== canonicalContent) {
      throw chatIdempotencyConflict();
    }
    if (!message.sequence) {
      throw chatNotReady();
    }
    return {
      message: mapChatMessage(message),
      deduplicated: true,
      httpStatus: 200,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { driverError?: { code?: string } })
        .driverError?.code === '23505'
    );
  }
}
