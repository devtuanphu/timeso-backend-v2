import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ChatAuthorizationService } from './chat-authorization.service';
import { mapChatMessage } from './chat-message.mapper';
import {
  escapeIlikePattern,
  parseChatSequence,
} from './chat-message.utils';
import {
  CatchUpMessagesQueryDto,
  ChatGroupListV2QueryDto,
  ChatGroupListV2ResponseDto,
  ChatMessageCursorPageDto,
  HistoryMessagesQueryDto,
  LegacyChatPaginationQueryDto,
  MarkChatGroupReadDto,
  SearchChatMessagesQueryDto,
} from './dto/chat-v2.dto';
import { ChatGroupMember } from './entities/chat-group-member.entity';
import { ChatGroup } from './entities/chat-group.entity';
import { ChatMessage } from './entities/chat-message.entity';
import {
  ChatOutboxEvent,
  ChatOutboxEventType,
  ChatOutboxStatus,
} from './entities/chat-outbox-event.entity';

interface GroupListCursor {
  v: 1;
  activityAt: string;
  groupId: string;
}

@Injectable()
export class ChatMessageQueryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorization: ChatAuthorizationService,
  ) {}

  async getHistory(
    groupId: string,
    accountId: string,
    query: HistoryMessagesQueryDto,
  ): Promise<ChatMessageCursorPageDto> {
    this.assertPageSize(query.limit, 100);
    await this.authorization.requireGroupAccess(groupId, accountId);
    if (query.beforeSequence) {
      parseChatSequence(query.beforeSequence, 'beforeSequence', false);
    }

    const builder = this.dataSource
      .getRepository(ChatMessage)
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.sender', 'sender')
      .where('message.groupId = :groupId', { groupId })
      .andWhere('message.sequence IS NOT NULL');
    if (query.beforeSequence) {
      builder.andWhere('message.sequence < :beforeSequence', {
        beforeSequence: query.beforeSequence,
      });
    }

    const rows = await builder
      .orderBy('message.sequence', 'DESC')
      .take(query.limit + 1)
      .getMany();
    const hasMore = rows.length > query.limit;
    const selected = rows.slice(0, query.limit).reverse();

    return {
      data: selected.map(mapChatMessage),
      hasMore,
      nextCursor:
        hasMore && selected.length > 0 ? String(selected[0].sequence) : null,
    };
  }

  async getCatchUp(
    groupId: string,
    accountId: string,
    query: CatchUpMessagesQueryDto,
  ): Promise<ChatMessageCursorPageDto> {
    this.assertPageSize(query.limit, 100);
    await this.authorization.requireGroupAccess(groupId, accountId);
    parseChatSequence(query.afterSequence, 'afterSequence', true);

    const rows = await this.dataSource
      .getRepository(ChatMessage)
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.sender', 'sender')
      .where('message.groupId = :groupId', { groupId })
      .andWhere('message.sequence > :afterSequence', {
        afterSequence: query.afterSequence,
      })
      .orderBy('message.sequence', 'ASC')
      .take(query.limit + 1)
      .getMany();
    const hasMore = rows.length > query.limit;
    const selected = rows.slice(0, query.limit);

    return {
      data: selected.map(mapChatMessage),
      hasMore,
      nextCursor:
        selected.length > 0
          ? String(selected[selected.length - 1].sequence)
          : query.afterSequence,
    };
  }

  async searchMessages(
    groupId: string,
    accountId: string,
    query: SearchChatMessagesQueryDto,
  ): Promise<
    | ChatMessageCursorPageDto
    | (ChatMessageCursorPageDto & {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      })
  > {
    this.assertPageSize(query.limit, 50);
    if (
      query.page !== undefined &&
      (!Number.isSafeInteger(query.page) || query.page < 1 || query.page > 10_000)
    ) {
      throw new BadRequestException('page không hợp lệ');
    }
    await this.authorization.requireGroupAccess(groupId, accountId);
    const normalizedQuery = query.query.normalize('NFC').trim();
    const codePointLength = Array.from(normalizedQuery).length;
    if (codePointLength < 1 || codePointLength > 200) {
      throw new BadRequestException('query phải có từ 1 đến 200 ký tự');
    }
    if (query.beforeSequence) {
      parseChatSequence(query.beforeSequence, 'beforeSequence', false);
    }

    const builder = this.dataSource
      .getRepository(ChatMessage)
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.sender', 'sender')
      .where('message.groupId = :groupId', { groupId })
      .andWhere('message.sequence IS NOT NULL')
      .andWhere(`message.content ILIKE :pattern ESCAPE '\\'`, {
        pattern: `%${escapeIlikePattern(normalizedQuery)}%`,
      });
    if (query.beforeSequence) {
      builder.andWhere('message.sequence < :beforeSequence', {
        beforeSequence: query.beforeSequence,
      });
    }

    if (query.page !== undefined) {
      const [rows, total] = await builder
        .orderBy('message.sequence', 'DESC')
        .skip((query.page - 1) * query.limit)
        .take(query.limit)
        .getManyAndCount();
      return {
        data: rows.map(mapChatMessage),
        hasMore: query.page * query.limit < total,
        nextCursor: null,
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      };
    }

    const rows = await builder
      .orderBy('message.sequence', 'DESC')
      .take(query.limit + 1)
      .getMany();
    const hasMore = rows.length > query.limit;
    const selected = rows.slice(0, query.limit);
    return {
      data: selected.map(mapChatMessage),
      hasMore,
      nextCursor:
        hasMore && selected.length > 0
          ? String(selected[selected.length - 1].sequence)
          : null,
    };
  }

  async advanceReadCursor(
    groupId: string,
    accountId: string,
    dto: MarkChatGroupReadDto,
  ): Promise<{ groupId: string; lastReadSequence: string; updatedAt: string }> {
    return this.dataSource.transaction(async (manager) => {
      await this.authorization.requireGroupAccess(groupId, accountId, manager);
      const maximumRow = await manager
        .getRepository(ChatMessage)
        .createQueryBuilder('message')
        .select('COALESCE(MAX(message.sequence), 0)', 'maximum')
        .where('message.groupId = :groupId', { groupId })
        .andWhere('message.sequence IS NOT NULL')
        .getRawOne<{ maximum: string }>();
      const maximum = BigInt(maximumRow?.maximum || '0');
      const requested = dto.sequence
        ? parseChatSequence(dto.sequence, 'sequence', true)
        : maximum;
      const target = requested > maximum ? maximum : requested;

      const members = manager.getRepository(ChatGroupMember);
      const member = await members.findOne({
        where: { groupId, accountId, status: 'active' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!member) {
        await this.authorization.requireGroupAccess(groupId, accountId, manager);
        throw new Error('CHAT_MEMBER_STATE_CHANGED');
      }
      const current = BigInt(member.lastReadSequence || '0');
      const next = target > current ? target : current;
      const updatedAt = new Date();

      if (next > current || member.lastReadSequence === null) {
        member.lastReadSequence = next.toString();
        member.lastReadAt = updatedAt;
        await members.save(member);
        await manager.getRepository(ChatOutboxEvent).save(
          manager.getRepository(ChatOutboxEvent).create({
            eventType: ChatOutboxEventType.READ_UPDATED_V1,
            groupId,
            messageId: null,
            actorAccountId: accountId,
            sequence: next.toString(),
            status: ChatOutboxStatus.PENDING,
            attemptCount: 0,
            availableAt: updatedAt,
          }),
        );
      }

      return {
        groupId,
        lastReadSequence: next.toString(),
        updatedAt: updatedAt.toISOString(),
      };
    });
  }

  async getAuthorizedGroupListV2(
    accountId: string,
    query: ChatGroupListV2QueryDto,
    storeId?: string,
    offset = 0,
    maximumLimit = 50,
  ): Promise<ChatGroupListV2ResponseDto> {
    this.assertPageSize(query.limit, maximumLimit);
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new BadRequestException('offset không hợp lệ');
    }
    const cursor = query.cursor ? this.decodeGroupCursor(query.cursor) : null;
    const parameters: unknown[] = [accountId];
    const storeClause = storeId
      ? `AND chat_group.store_id = $${parameters.push(storeId)}::uuid`
      : '';
    let cursorClause = '';
    if (cursor) {
      const activityIndex = parameters.push(cursor.activityAt);
      const groupIndex = parameters.push(cursor.groupId);
      cursorClause = `AND (COALESCE(last_message.created_at, chat_group.created_at) < $${activityIndex}::timestamptz
           OR (COALESCE(last_message.created_at, chat_group.created_at) = $${activityIndex}::timestamptz
               AND chat_group.id < $${groupIndex}::uuid))`;
    }
    const limitIndex = parameters.push(query.limit + 1);
    const offsetIndex = parameters.push(Math.max(0, offset));
    const rawRows = await this.dataSource.query(
      `SELECT chat_group.id,
              chat_group.name,
              chat_group.avatar,
              chat_group.store_id AS "storeId",
              membership.last_read_sequence AS "lastReadSequence",
              COALESCE(last_message.created_at, chat_group.created_at) AS "activityAt",
              COALESCE(last_message.created_at, chat_group.created_at)::text AS "activityCursor",
              unread.unread_count::int AS "unreadCount",
              last_message.id AS "messageId",
              last_message.client_message_id AS "clientMessageId",
              last_message.sequence AS "messageSequence",
              last_message.content AS "messageContent",
              last_message.message_type AS "messageType",
              last_message.attachment_url AS "attachmentUrl",
              last_message.attachment_name AS "attachmentName",
              last_message.attachment_size AS "attachmentSize",
              last_message.sender_id AS "senderId",
              sender.full_name AS "senderFullName",
              sender.avatar AS "senderAvatar",
              last_message.created_at AS "messageCreatedAt"
       FROM chat_group_members membership
       JOIN chat_groups chat_group
         ON chat_group.id = membership.group_id AND chat_group.deleted_at IS NULL
       JOIN stores store
         ON store.id = chat_group.store_id
        AND store.status = 'active' AND store.deleted_at IS NULL
       JOIN accounts actor
         ON actor.id = membership.account_id
        AND actor.status = 'active' AND actor.deleted_at IS NULL
       LEFT JOIN employee_profiles employee
         ON employee.store_id = chat_group.store_id
        AND employee.account_id = membership.account_id
        AND employee.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT message.*
         FROM chat_messages message
         WHERE message.group_id = chat_group.id
           AND message.sequence IS NOT NULL
           AND message.deleted_at IS NULL
         ORDER BY message.sequence DESC
         LIMIT 1
       ) last_message ON true
       LEFT JOIN accounts sender
         ON sender.id = last_message.sender_id AND sender.deleted_at IS NULL
       JOIN LATERAL (
         SELECT COUNT(*) AS unread_count
         FROM chat_messages unread_message
         WHERE unread_message.group_id = chat_group.id
           AND unread_message.sequence > COALESCE(membership.last_read_sequence, 0)
           AND unread_message.deleted_at IS NULL
       ) unread ON true
       WHERE membership.account_id = $1
         AND membership.status = 'active'
         AND membership.deleted_at IS NULL
         AND (store.owner_account_id = $1 OR employee.employment_status != 'terminated')
         ${storeClause}
         ${cursorClause}
       ORDER BY "activityAt" DESC, chat_group.id DESC
       LIMIT $${limitIndex}
       OFFSET $${offsetIndex}`,
      parameters,
    );
    const hasMore = rawRows.length > query.limit;
    const selected = rawRows.slice(0, query.limit);

    const data = selected.map((row) => {
        const activityAt = new Date(row.activityAt).toISOString();
        return {
          id: row.id,
          name: row.name,
          avatar: row.avatar,
          storeId: row.storeId,
          activityAt,
          unreadCount: Number(row.unreadCount || 0),
          lastReadSequence: row.lastReadSequence,
          lastMessage: row.messageId
            ? {
                id: row.messageId,
                groupId: row.id,
                clientMessageId: row.clientMessageId,
                sequence: String(row.messageSequence),
                content: row.messageContent,
                messageType: row.messageType,
                attachment: row.attachmentUrl
                  ? {
                      url: row.attachmentUrl,
                      name: row.attachmentName,
                      size:
                        row.attachmentSize === null
                          ? null
                          : String(row.attachmentSize),
                    }
                  : null,
                sender: {
                  id: row.senderId,
                  fullName: row.senderFullName || null,
                  avatar: row.senderAvatar || null,
                },
                createdAt: new Date(row.messageCreatedAt).toISOString(),
              }
            : null,
        };
      });
    const last = data[data.length - 1];
    const lastRow = selected[selected.length - 1];
    return {
      data,
      hasMore,
      nextCursor:
        hasMore && last && lastRow
          ? this.encodeGroupCursor({
              v: 1,
              activityAt: String(lastRow.activityCursor),
              groupId: last.id,
            })
          : null,
    };
  }

  async getAuthorizedLegacyGroupList(
    accountId: string,
    query: LegacyChatPaginationQueryDto,
  ): Promise<ChatGroupListV2ResponseDto> {
    this.assertPageSize(query.limit, 100);
    if (
      !Number.isSafeInteger(query.page) ||
      query.page < 1 ||
      query.page > 10_000
    ) {
      throw new BadRequestException('page không hợp lệ');
    }
    return this.getAuthorizedGroupListV2(
      accountId,
      { limit: query.limit },
      query.storeId,
      (query.page - 1) * query.limit,
      100,
    );
  }

  async getTotalUnreadCount(accountId: string): Promise<{ totalUnread: number }> {
    const rows = await this.dataSource.query(
      `SELECT COUNT(message.id)::int AS "totalUnread"
       FROM chat_group_members membership
       JOIN chat_groups chat_group
         ON chat_group.id = membership.group_id AND chat_group.deleted_at IS NULL
       JOIN stores store
         ON store.id = chat_group.store_id
        AND store.status = 'active' AND store.deleted_at IS NULL
       JOIN accounts actor
         ON actor.id = membership.account_id
        AND actor.status = 'active' AND actor.deleted_at IS NULL
       LEFT JOIN employee_profiles employee
         ON employee.store_id = chat_group.store_id
        AND employee.account_id = membership.account_id
        AND employee.deleted_at IS NULL
       JOIN chat_messages message
         ON message.group_id = chat_group.id
        AND message.sequence > COALESCE(membership.last_read_sequence, 0)
        AND message.deleted_at IS NULL
       WHERE membership.account_id = $1
         AND membership.status = 'active'
         AND membership.deleted_at IS NULL
         AND (store.owner_account_id = $1 OR employee.employment_status != 'terminated')`,
      [accountId],
    );
    return { totalUnread: Number(rows[0]?.totalUnread || 0) };
  }

  private decodeGroupCursor(value: string): GroupListCursor {
    try {
      const parsed = JSON.parse(
        Buffer.from(value, 'base64url').toString('utf8'),
      ) as GroupListCursor;
      if (
        parsed.v !== 1 ||
        typeof parsed.activityAt !== 'string' ||
        Number.isNaN(new Date(parsed.activityAt).getTime()) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          parsed.groupId,
        )
      ) {
        throw new Error('invalid');
      }
      return parsed;
    } catch {
      throw new BadRequestException('cursor không hợp lệ');
    }
  }

  private encodeGroupCursor(cursor: GroupListCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  private assertPageSize(limit: number, maximum: number): void {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
      throw new BadRequestException('limit không hợp lệ');
    }
  }
}
