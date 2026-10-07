/**
 * X3 chat receipts: delivered cursor (2 grey ticks) next to the read cursor
 * (2 blue ticks). Monotonic, clamped to the group maximum, member-only,
 * emitted through the outbox as DELIVERED_UPDATED_V1 → chat.delivered.updated.v1.
 */
import { ChatGroupsService } from '../../../../src/modules/chat-groups/chat-groups.service';
import { mapActiveChatMember, mapChatMemberReceipt } from '../../../../src/modules/chat-groups/chat-member.mapper';
import { ChatMessageQueryService } from '../../../../src/modules/chat-groups/chat-message-query.service';
import { ChatOutboxDispatcherService } from '../../../../src/modules/chat-groups/chat-outbox-dispatcher.service';
import { LocalSocketChatEventPublisher } from '../../../../src/modules/chat-groups/local-socket-chat-event-publisher';
import { ChatGroupMember } from '../../../../src/modules/chat-groups/entities/chat-group-member.entity';
import {
  ChatOutboxEvent,
  ChatOutboxEventType,
  ChatOutboxStatus,
} from '../../../../src/modules/chat-groups/entities/chat-outbox-event.entity';
import { ChatMessage } from '../../../../src/modules/chat-groups/entities/chat-message.entity';

const denied = () => Object.assign(new Error('denied'), { status: 403 });

function buildQueryService(options: {
  member?: Partial<ChatGroupMember> | null;
  maximum?: string;
  accessDenied?: boolean;
  /** Messages from others in the advanced range (default: yes). */
  othersInRange?: boolean;
  /** An undispatched DELIVERED row already exists for this member (merge). */
  pendingDelivered?: boolean;
}) {
  const member =
    options.member === null
      ? null
      : Object.assign(new ChatGroupMember(), {
          groupId: 'g1',
          accountId: 'acc-1',
          status: 'active',
          lastReadSequence: '0',
          lastDeliveredSequence: '0',
          ...options.member,
        });
  const saves: { members: any[]; outbox: any[] } = { members: [], outbox: [] };
  const memberRepository = {
    findOne: jest.fn().mockResolvedValue(member),
    save: jest.fn(async (row: any) => {
      saves.members.push({ ...row });
      return row;
    }),
  };
  const outboxRepository = {
    create: jest.fn((row: any) => row),
    save: jest.fn(async (row: any) => {
      saves.outbox.push(row);
      return row;
    }),
  };
  const messageRepository = {
    createQueryBuilder: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ maximum: options.maximum ?? '10' }),
    })),
  };
  const sql: Array<{ text: string; params: unknown[] }> = [];
  const manager = {
    query: jest.fn(async (text: string, params: unknown[]) => {
      sql.push({ text, params });
      if (text.includes('FROM chat_messages')) {
        return options.othersInRange === false ? [] : [{ '?column?': 1 }];
      }
      if (text.includes('UPDATE chat_outbox_events')) {
        return [options.pendingDelivered ? [{ id: 'ev-pending' }] : [], 0];
      }
      return [];
    }),
    getRepository: jest.fn((entity: unknown) => {
      if (entity === ChatGroupMember) return memberRepository;
      if (entity === ChatOutboxEvent) return outboxRepository;
      if (entity === ChatMessage) return messageRepository;
      throw new Error('unexpected repository');
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (callback: any) => callback(manager)),
    getRepository: jest.fn(),
  };
  const authorization = {
    requireGroupAccess: jest.fn(async () => {
      if (options.accessDenied) throw denied();
      return { member };
    }),
  };
  const service = new ChatMessageQueryService(
    dataSource as any,
    authorization as any,
  );
  return { service, saves, memberRepository, dataSource, authorization, sql };
}

describe('advanceDeliveredCursor', () => {
  it('advances, stamps the time and enqueues DELIVERED_UPDATED_V1', async () => {
    const { service, saves } = buildQueryService({
      member: { lastDeliveredSequence: '3' },
    });
    const result = await service.advanceDeliveredCursor('g1', 'acc-1', {
      sequence: '7',
    });
    expect(result).toMatchObject({ groupId: 'g1', lastDeliveredSequence: '7' });
    expect(saves.members[0]).toMatchObject({ lastDeliveredSequence: '7' });
    expect(saves.members[0].lastDeliveredAt).toBeInstanceOf(Date);
    expect(saves.outbox).toEqual([
      expect.objectContaining({
        eventType: ChatOutboxEventType.DELIVERED_UPDATED_V1,
        groupId: 'g1',
        actorAccountId: 'acc-1',
        messageId: null,
        sequence: '7',
        rangeStartSequence: '3',
        status: ChatOutboxStatus.PENDING,
      }),
    ]);
  });

  it('(a) advancing over only own messages updates the cursor but queues nothing', async () => {
    const { service, saves, sql } = buildQueryService({
      member: { lastDeliveredSequence: '3' },
      othersInRange: false,
    });
    const result = await service.advanceDeliveredCursor('g1', 'acc-1', {
      sequence: '7',
    });
    expect(result.lastDeliveredSequence).toBe('7');
    expect(saves.members[0]).toMatchObject({ lastDeliveredSequence: '7' });
    expect(saves.outbox).toHaveLength(0);
    const probe = sql.find((entry) => entry.text.includes('FROM chat_messages'));
    expect(probe?.text).toContain('sender_id <> $4');
    expect(probe?.params).toEqual(['g1', '3', '7', 'acc-1']);
  });

  it('(c) an undispatched DELIVERED row of the same member is extended, not duplicated', async () => {
    const { service, saves, sql } = buildQueryService({
      member: { lastDeliveredSequence: '3' },
      pendingDelivered: true,
    });
    await service.advanceDeliveredCursor('g1', 'acc-1', { sequence: '9' });
    expect(saves.outbox).toHaveLength(0);
    const merge = sql.find((entry) => entry.text.includes('UPDATE chat_outbox_events'));
    expect(merge?.text).toContain("status = 'pending'");
    expect(merge?.text).toContain("event_type = 'DELIVERED_UPDATED_V1'");
    expect(merge?.text).toContain('GREATEST(sequence');
    expect(merge?.params).toEqual(['g1', 'acc-1', '9', '3']);
  });

  it('is monotonic: a lower or equal sequence writes nothing and emits nothing', async () => {
    for (const sequence of ['2', '5']) {
      const { service, saves } = buildQueryService({
        member: { lastDeliveredSequence: '5' },
      });
      const result = await service.advanceDeliveredCursor('g1', 'acc-1', {
        sequence,
      });
      expect(result.lastDeliveredSequence).toBe('5');
      expect(saves.members).toHaveLength(0);
      expect(saves.outbox).toHaveLength(0);
    }
  });

  it('never goes beyond the group maximum sequence', async () => {
    const { service, saves } = buildQueryService({ maximum: '9' });
    const result = await service.advanceDeliveredCursor('g1', 'acc-1', {
      sequence: '999',
    });
    expect(result.lastDeliveredSequence).toBe('9');
    expect(saves.outbox[0].sequence).toBe('9');
  });

  it('never reports below the read cursor', async () => {
    const { service } = buildQueryService({
      member: { lastReadSequence: '8', lastDeliveredSequence: '0' },
    });
    const result = await service.advanceDeliveredCursor('g1', 'acc-1', {
      sequence: '4',
    });
    expect(result.lastDeliveredSequence).toBe('8');
  });

  it('non-member / ineligible caller: refused before any write', async () => {
    const { service, saves, memberRepository } = buildQueryService({
      accessDenied: true,
    });
    await expect(
      service.advanceDeliveredCursor('g1', 'stranger', { sequence: '3' }),
    ).rejects.toThrow('denied');
    expect(memberRepository.findOne).not.toHaveBeenCalled();
    expect(saves.outbox).toHaveLength(0);
  });

  it('rejects a malformed sequence', async () => {
    const { service } = buildQueryService({});
    await expect(
      service.advanceDeliveredCursor('g1', 'acc-1', { sequence: '-1' }),
    ).rejects.toThrow();
  });
});

describe('advanceReadCursor bumps delivered', () => {
  it('read past delivered also advances delivered and emits both events', async () => {
    const { service, saves } = buildQueryService({
      member: { lastReadSequence: '2', lastDeliveredSequence: '4' },
    });
    await service.advanceReadCursor('g1', 'acc-1', { sequence: '6' });
    expect(saves.members[0]).toMatchObject({
      lastReadSequence: '6',
      lastDeliveredSequence: '6',
    });
    expect(saves.outbox.map((row) => [row.eventType, row.sequence])).toEqual([
      [ChatOutboxEventType.READ_UPDATED_V1, '6'],
      [ChatOutboxEventType.DELIVERED_UPDATED_V1, '6'],
    ]);
  });

  it('read below delivered leaves delivered alone (only the read event)', async () => {
    const { service, saves } = buildQueryService({
      member: { lastReadSequence: '2', lastDeliveredSequence: '9' },
    });
    await service.advanceReadCursor('g1', 'acc-1', { sequence: '5' });
    expect(saves.members[0]).toMatchObject({
      lastReadSequence: '5',
      lastDeliveredSequence: '9',
    });
    expect(saves.outbox.map((row) => row.eventType)).toEqual([
      ChatOutboxEventType.READ_UPDATED_V1,
    ]);
  });
});

describe('fetching messages marks them delivered', () => {
  const pageBuilder = (rows: Array<{ sequence: string }>) => ({
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(
      rows.map((row) =>
        Object.assign(new ChatMessage(), {
          id: `m-${row.sequence}`,
          groupId: 'g1',
          senderId: 'other',
          sequence: row.sequence,
          content: 'x',
          messageType: 'text',
          createdAt: new Date('2026-09-29T00:00:00Z'),
        }),
      ),
    ),
  });

  it('catch-up advances delivered to the highest fetched sequence', async () => {
    const { service, dataSource } = buildQueryService({
      member: { lastDeliveredSequence: '3' },
    });
    const spy = jest.spyOn(service, 'markDeliveredUpTo').mockResolvedValue();
    dataSource.getRepository.mockReturnValue({
      createQueryBuilder: () => pageBuilder([{ sequence: '4' }, { sequence: '6' }]),
    });
    await service.getCatchUp('g1', 'acc-1', { afterSequence: '3', limit: 50 });
    expect(spy).toHaveBeenCalledWith('g1', 'acc-1', 6n);
  });

  it('history skips the write when the cursor is already there', async () => {
    const { service, dataSource } = buildQueryService({
      member: { lastDeliveredSequence: '10' },
    });
    const spy = jest.spyOn(service, 'markDeliveredUpTo').mockResolvedValue();
    dataSource.getRepository.mockReturnValue({
      createQueryBuilder: () => pageBuilder([{ sequence: '9' }, { sequence: '8' }]),
    });
    await service.getHistory('g1', 'acc-1', { limit: 50 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('a receipt failure never fails the fetch', async () => {
    const { service, dataSource } = buildQueryService({});
    dataSource.transaction.mockRejectedValue(new Error('lock timeout'));
    dataSource.getRepository.mockReturnValue({
      createQueryBuilder: () => pageBuilder([{ sequence: '2' }]),
    });
    await expect(
      service.getCatchUp('g1', 'acc-1', { afterSequence: '0', limit: 50 }),
    ).resolves.toMatchObject({ nextCursor: '2' });
  });
});

describe('GET receipts / members expose cursors for eligible members only', () => {
  const members = [
    { accountId: 'owner-id', lastReadSequence: '5', lastDeliveredSequence: '7' },
    { accountId: 'staff-a', lastReadSequence: null, lastDeliveredSequence: '3' },
    { accountId: 'terminated-b', lastReadSequence: '9', lastDeliveredSequence: '9' },
  ];
  const build = (accessDenied = false) => {
    const service = Object.create(ChatGroupsService.prototype) as any;
    service.authorization = {
      requireGroupAccess: jest.fn(async () => {
        if (accessDenied) throw denied();
        return {
          group: { storeId: 'store-id', store: { ownerAccountId: 'owner-id' } },
        };
      }),
      getEmployedAccountIds: jest.fn().mockResolvedValue(new Set(['staff-a'])),
    };
    service.chatGroupMemberRepository = {
      find: jest.fn().mockResolvedValue(members),
    };
    return service;
  };

  it('receipts: owner + employed staff, normalized cursors', async () => {
    const service = build();
    await expect(service.getGroupReceipts('g1', 'staff-a')).resolves.toEqual({
      groupId: 'g1',
      members: [
        { accountId: 'owner-id', lastDeliveredSequence: '7', lastReadSequence: '5' },
        { accountId: 'staff-a', lastDeliveredSequence: '3', lastReadSequence: '0' },
      ],
    });
  });

  it('receipts: member-only', async () => {
    const service = build(true);
    await expect(service.getGroupReceipts('g1', 'stranger')).rejects.toThrow(
      'denied',
    );
    expect(service.chatGroupMemberRepository.find).not.toHaveBeenCalled();
  });

  it('members list items carry the cursors (additive)', async () => {
    const service = build();
    const result = await service.getGroupMembers('g1', 'staff-a');
    expect(result).toEqual([
      expect.objectContaining({
        accountId: 'owner-id',
        lastDeliveredSequence: '7',
        lastReadSequence: '5',
      }),
      expect.objectContaining({
        accountId: 'staff-a',
        lastDeliveredSequence: '3',
        lastReadSequence: '0',
      }),
    ]);
  });

  it('mapper: delivered never below read; legacy rows default to 0', () => {
    expect(
      mapChatMemberReceipt({
        accountId: 'a',
        lastReadSequence: '8',
        lastDeliveredSequence: '2',
      }),
    ).toEqual({ accountId: 'a', lastDeliveredSequence: '8', lastReadSequence: '8' });
    expect(
      mapActiveChatMember(
        Object.assign(new ChatGroupMember(), { accountId: 'a', account: null }),
        'owner',
      ),
    ).toMatchObject({ lastDeliveredSequence: '0', lastReadSequence: '0' });
  });
});

describe('DELIVERED_UPDATED_V1 dispatch', () => {
  const event = Object.assign(new ChatOutboxEvent(), {
    id: 'ev-1',
    eventType: ChatOutboxEventType.DELIVERED_UPDATED_V1,
    groupId: 'g1',
    actorAccountId: 'acc-1',
    messageId: null,
    sequence: '12',
    rangeStartSequence: '9',
    attemptCount: 1,
    createdAt: new Date('2026-09-29T01:00:00.000Z'),
  });

  const build = (actorStillMember = true, senders: string[] = ['owner-id']) => {
    const publisher = {
      publishDeliveredUpdated: jest.fn().mockResolvedValue(undefined),
      publishReadUpdated: jest.fn(),
    };
    const update = jest.fn().mockResolvedValue(undefined);
    // Senders of messages in (range_start, sequence]: only owner-id sent.
    const query = jest.fn().mockResolvedValue(senders.map((senderId) => ({ senderId })));
    const dispatcher = new ChatOutboxDispatcherService(
      { getRepository: () => ({ update }), query } as any,
      {
        getEligibleRecipientAccountIds: jest
          .fn()
          .mockResolvedValue(['owner-id', 'acc-1', 'staff-a']),
        requireGroupAccess: jest.fn(async () => {
          if (!actorStillMember) throw denied();
          return {};
        }),
      } as any,
      { isActive: () => true } as any,
      publisher as any,
    );
    dispatcher.start();
    return { dispatcher, publisher, update, query };
  };

  it('(b) publishes chat.delivered.updated.v1 only to senders of messages in the range', async () => {
    const { dispatcher, publisher, update, query } = build();
    await (dispatcher as any).dispatchEvent(event);
    expect(publisher.publishDeliveredUpdated).toHaveBeenCalledWith(
      {
        version: 1,
        groupId: 'g1',
        accountId: 'acc-1',
        lastDeliveredSequence: '12',
        updatedAt: '2026-09-29T01:00:00.000Z',
      },
      ['owner-id'],
    );
    const [text, params] = query.mock.calls[0];
    expect(text).toContain('SELECT DISTINCT sender_id');
    expect(text).toContain('LIMIT');
    expect(params).toEqual(['g1', '9', '12', 'acc-1']);
    expect(publisher.publishReadUpdated).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      { id: 'ev-1', status: ChatOutboxStatus.PROCESSING },
      expect.objectContaining({ status: ChatOutboxStatus.PUBLISHED }),
    );
  });

  it('(b) senders who are no longer eligible, or no senders: nothing emitted, still published', async () => {
    const { dispatcher, publisher, update } = build(true, ['terminated-x']);
    await (dispatcher as any).dispatchEvent(event);
    expect(publisher.publishDeliveredUpdated).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      { id: 'ev-1', status: ChatOutboxStatus.PROCESSING },
      expect.objectContaining({ status: ChatOutboxStatus.PUBLISHED }),
    );
  });

  it('(b) the range scan is bounded to the newest sequences', async () => {
    const { dispatcher, query } = build();
    await (dispatcher as any).dispatchEvent(
      Object.assign(new ChatOutboxEvent(), event, {
        sequence: '5000',
        rangeStartSequence: '0',
      }),
    );
    expect(query.mock.calls[0][1]).toEqual(['g1', '4500', '5000', 'acc-1']);
  });

  it('actor no longer eligible: dropped (marked published, nothing emitted)', async () => {
    const { dispatcher, publisher, update } = build(false);
    await (dispatcher as any).dispatchEvent(event);
    expect(publisher.publishDeliveredUpdated).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
  });

  it('socket publisher emits chat.delivered.updated.v1 to each account room', async () => {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const publisher = new LocalSocketChatEventPublisher({
      getServer: (kind: string) => (kind === 'v2' ? { to } : null),
      isActive: () => true,
      legacyConnectionsAllowed: () => false,
    } as any);
    const payload = {
      version: 1 as const,
      groupId: 'g1',
      accountId: 'acc-1',
      lastDeliveredSequence: '12',
      updatedAt: '2026-09-29T01:00:00.000Z',
    };
    await publisher.publishDeliveredUpdated(payload, ['owner-id', 'staff-a']);
    expect(to.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      'account:owner-id',
      'account:staff-a',
    ]);
    expect(emit).toHaveBeenCalledWith('chat.delivered.updated.v1', payload);
  });
});
