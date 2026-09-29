import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import {
  ChatAuthorizationService,
  EMPLOYED_STATUS_SQL_LIST,
} from './chat-authorization.service';
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
  MarkChatGroupDeliveredDto,
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

const maxBigInt = (left: bigint, right: bigint) => (left > right ? left : right);

@Injectable()
export class ChatMessageQueryService {
  private readonly logger = new Logger(ChatMessageQueryService.name);

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
    const context = await this.authorization.requireGroupAccess(
      groupId,
      accountId,
    );
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
    await this.markFetchedAsDelivered(
      groupId,
      accountId,
      context?.member?.lastDeliveredSequence,
      selected,
    );

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
    const context = await this.authorization.requireGroupAccess(
      groupId,
      accountId,
    );
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
    await this.markFetchedAsDelivered(
      groupId,
      accountId,
      context?.member?.lastDeliveredSequence,
      selected,
    );

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
      const maximum = await this.getMaximumSequence(manager, groupId);
      const requested = dto.sequence
        ? parseChatSequence(dto.sequence, 'sequence', true)
        : maximum;
      const target = requested > maximum ? maximum : requested;

      const members = manager.getRepository(ChatGroupMember);
      const member = await this.lockActiveMember(manager, groupId, accountId);
      const current = BigInt(member.lastReadSequence || '0');
      const next = maxBigInt(target, current);
      const updatedAt = new Date();

      if (next > current || member.lastReadSequence === null) {
        member.lastReadSequence = next.toString();
        member.lastReadAt = updatedAt;
        // Read implies delivered: keep delivered >= read so a sender never
        // sees "read" without "delivered".
        const deliveredBefore = BigInt(member.lastDeliveredSequence || '0');
        const deliveredChanged = next > deliveredBefore;
        if (deliveredChanged) {
          member.lastDeliveredSequence = next.toString();
          member.lastDeliveredAt = updatedAt;
        }
        await members.save(member);
        await this.enqueueCursorEvent(
          manager,
          ChatOutboxEventType.READ_UPDATED_V1,
          groupId,
          accountId,
          next,
          updatedAt,
        );
        if (deliveredChanged) {
          await this.enqueueDeliveredEvent(
            manager,
            groupId,
            accountId,
            deliveredBefore,
            next,
            updatedAt,
          );
        }
      }

      return {
        groupId,
        lastReadSequence: next.toString(),
        updatedAt: updatedAt.toISOString(),
      };
    });
  }

  /**
   * Advance the caller's delivered cursor (Zalo-style "đã nhận"). Monotonic:
   * a lower sequence is a no-op, a higher one is clamped to the group's
   * current maximum. Only a change writes and emits DELIVERED_UPDATED_V1.
   */
  async advanceDeliveredCursor(
    groupId: string,
    accountId: string,
    dto: MarkChatGroupDeliveredDto,
  ): Promise<{
    groupId: string;
    lastDeliveredSequence: string;
    updatedAt: string;
  }> {
    const requested = parseChatSequence(dto.sequence, 'sequence', true);
    return this.dataSource.transaction(async (manager) => {
      await this.authorization.requireGroupAccess(groupId, accountId, manager);
      return this.advanceDeliveredWithin(manager, groupId, accountId, requested);
    });
  }

  private async advanceDeliveredWithin(
    manager: EntityManager,
    groupId: string,
    accountId: string,
    requested: bigint,
  ) {
    const maximum = await this.getMaximumSequence(manager, groupId);
    const target = requested > maximum ? maximum : requested;
    const member = await this.lockActiveMember(manager, groupId, accountId);
    const current = maxBigInt(
      BigInt(member.lastDeliveredSequence || '0'),
      BigInt(member.lastReadSequence || '0'),
    );
    const next = maxBigInt(target, current);
    const updatedAt = new Date();
    const before = BigInt(member.lastDeliveredSequence || '0');
    if (next > before) {
      member.lastDeliveredSequence = next.toString();
      member.lastDeliveredAt = updatedAt;
      await manager.getRepository(ChatGroupMember).save(member);
      await this.enqueueDeliveredEvent(
        manager,
        groupId,
        accountId,
        before,
        next,
        updatedAt,
      );
    }
    return {
      groupId,
      lastDeliveredSequence: next.toString(),
      updatedAt: updatedAt.toISOString(),
    };
  }

  /**
   * Messages returned to a member's own client have reached that device:
   * advance their delivered cursor to the highest sequence in the page.
   * Best effort — a receipt failure must never fail the read itself — and
   * skipped without a write when the cursor is already there.
   */
  private async markFetchedAsDelivered(
    groupId: string,
    accountId: string,
    knownDelivered: string | null | undefined,
    messages: Array<Pick<ChatMessage, 'sequence'>>,
  ): Promise<void> {
    let highest = 0n;
    for (const message of messages) {
      if (message.sequence) highest = maxBigInt(highest, BigInt(message.sequence));
    }
    if (highest === 0n) return;
    if (knownDelivered && BigInt(knownDelivered) >= highest) return;
    await this.markDeliveredUpTo(groupId, accountId, highest);
  }

  /** Best-effort delivered advance for fetch paths (also used by the legacy list). */
  async markDeliveredUpTo(
    groupId: string,
    accountId: string,
    sequence: bigint,
  ): Promise<void> {
    try {
      await this.dataSource.transaction((manager) =>
        this.advanceDeliveredWithin(manager, groupId, accountId, sequence),
      );
    } catch {
      this.logger.warn('Chat delivered cursor advance after fetch failed');
    }
  }

  private async getMaximumSequence(
    manager: EntityManager,
    groupId: string,
  ): Promise<bigint> {
    const maximumRow = await manager
      .getRepository(ChatMessage)
      .createQueryBuilder('message')
      .select('COALESCE(MAX(message.sequence), 0)', 'maximum')
      .where('message.groupId = :groupId', { groupId })
      .andWhere('message.sequence IS NOT NULL')
      .getRawOne<{ maximum: string }>();
    return BigInt(maximumRow?.maximum || '0');
  }

  private async lockActiveMember(
    manager: EntityManager,
    groupId: string,
    accountId: string,
  ): Promise<ChatGroupMember> {
    const member = await manager.getRepository(ChatGroupMember).findOne({
      where: { groupId, accountId, status: 'active' },
      lock: { mode: 'pessimistic_write' },
    });
    if (!member) {
      await this.authorization.requireGroupAccess(groupId, accountId, manager);
      throw new Error('CHAT_MEMBER_STATE_CHANGED');
    }
    return member;
  }

  /**
   * DELIVERED_UPDATED_V1 is coalesced to keep the fan-out linear:
   *  (a) nothing is queued unless (previous, next] holds at least one live
   *      message sent by someone else — the only messages whose ticks change;
   *  (b) the row records the range start, so the dispatcher sends the event
   *      only to the senders of messages in that range (the only accounts
   *      that render ticks for them);
   *  (c) an undispatched (pending) row of the same member and group is
   *      extended in place instead of queueing another one.
   * GET /chat-groups/:id/receipts stays the source of truth.
   */
  private async enqueueDeliveredEvent(
    manager: EntityManager,
    groupId: string,
    accountId: string,
    previous: bigint,
    next: bigint,
    at: Date,
  ): Promise<void> {
    if (next <= previous) return;
    const othersInRange: unknown[] = await manager.query(
      `SELECT 1
       FROM chat_messages
       WHERE group_id = $1
         AND sequence > $2::bigint
         AND sequence <= $3::bigint
         AND sender_id <> $4
         AND deleted_at IS NULL
       LIMIT 1`,
      [groupId, previous.toString(), next.toString(), accountId],
    );
    if (!othersInRange?.length) return;

    const merged: unknown = await manager.query(
      `UPDATE chat_outbox_events
       SET sequence = GREATEST(sequence, $3::bigint),
           range_start_sequence = LEAST(
             COALESCE(range_start_sequence, $4::bigint),
             $4::bigint
           ),
           updated_at = NOW()
       WHERE group_id = $1
         AND actor_account_id = $2
         AND event_type = 'DELIVERED_UPDATED_V1'
         AND status = 'pending'
         AND deleted_at IS NULL
       RETURNING id`,
      [groupId, accountId, next.toString(), previous.toString()],
    );
    // UPDATE ... RETURNING comes back as [rows, count] from TypeORM's
    // PostgreSQL runner; a plain array from other runners / mocks.
    const mergedRows = Array.isArray(merged) && Array.isArray(merged[0])
      ? (merged[0] as unknown[])
      : (merged as unknown[]);
    if (Array.isArray(mergedRows) && mergedRows.length > 0) return;

    const outbox = manager.getRepository(ChatOutboxEvent);
    await outbox.save(
      outbox.create({
        eventType: ChatOutboxEventType.DELIVERED_UPDATED_V1,
        groupId,
        messageId: null,
        actorAccountId: accountId,
        sequence: next.toString(),
        rangeStartSequence: previous.toString(),
        status: ChatOutboxStatus.PENDING,
        attemptCount: 0,
        availableAt: at,
      }),
    );
  }

  private async enqueueCursorEvent(
    manager: EntityManager,
    eventType: ChatOutboxEventType.READ_UPDATED_V1,
    groupId: string,
    accountId: string,
    sequence: bigint,
    at: Date,
  ): Promise<void> {
    const outbox = manager.getRepository(ChatOutboxEvent);
    await outbox.save(
      outbox.create({
        eventType,
        groupId,
        messageId: null,
        actorAccountId: accountId,
        sequence: sequence.toString(),
        status: ChatOutboxStatus.PENDING,
        attemptCount: 0,
        availableAt: at,
      }),
    );
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
              -- Chat riêng hiện tên và ảnh của người kia.
              CASE WHEN chat_group.direct_key IS NOT NULL
                   THEN COALESCE(peer.full_name, chat_group.name)
                   ELSE chat_group.name END AS name,
              CASE WHEN chat_group.direct_key IS NOT NULL
                   THEN peer.avatar
                   ELSE chat_group.avatar END AS avatar,
              (chat_group.direct_key IS NOT NULL) AS "isDirect",
              peer.account_id AS "peerAccountId",
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
       LEFT JOIN LATERAL (
         SELECT peer_member.account_id, peer_account.full_name, peer_account.avatar
         FROM chat_group_members peer_member
         JOIN accounts peer_account ON peer_account.id = peer_member.account_id
         WHERE chat_group.direct_key IS NOT NULL
           AND peer_member.group_id = chat_group.id
           AND peer_member.account_id <> $1
           AND peer_member.deleted_at IS NULL
         ORDER BY (peer_member.status = 'active') DESC, peer_member.created_at DESC
         LIMIT 1
       ) peer ON true
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
         AND (store.owner_account_id = $1 OR employee.employment_status IN (${EMPLOYED_STATUS_SQL_LIST}))
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
          isDirect: row.isDirect === true,
          peerAccountId:
            row.isDirect === true ? row.peerAccountId || null : null,
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

  async getTotalUnreadCount(
    accountId: string,
    manager?: EntityManager,
  ): Promise<{ totalUnread: number }> {
    const rows = await (manager || this.dataSource).query(
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
         AND (store.owner_account_id = $1 OR employee.employment_status IN (${EMPLOYED_STATUS_SQL_LIST}))`,
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
