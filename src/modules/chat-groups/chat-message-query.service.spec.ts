import { DataSource } from 'typeorm';

import { ChatAuthorizationService } from './chat-authorization.service';
import { ChatMessageQueryService } from './chat-message-query.service';
import { ChatMessage } from './entities/chat-message.entity';

const message = Object.assign(new ChatMessage(), {
  id: 'message-id',
  groupId: 'group-id',
  senderId: 'sender-id',
  clientMessageId: null,
  sequence: '75',
  content: 'kết quả',
  messageType: 'text',
  attachmentUrl: null,
  attachmentName: null,
  attachmentSize: null,
  sender: { id: 'sender-id', fullName: 'Sender', avatar: null },
  createdAt: new Date('2026-08-29T00:00:00.000Z'),
});

describe('ChatMessageQueryService', () => {
  it('preserves page-based search page 2 and authoritative total', async () => {
    const builder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[message], 75]),
    };
    const dataSource = {
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => builder),
      })),
    } as unknown as DataSource;
    const authorization = {
      requireGroupAccess: jest.fn().mockResolvedValue(undefined),
    } as unknown as ChatAuthorizationService;
    const service = new ChatMessageQueryService(dataSource, authorization);
    const result = await service.searchMessages('group-id', 'account-id', {
      query: 'kết quả',
      page: 2,
      limit: 20,
    });
    expect(builder.skip).toHaveBeenCalledWith(20);
    expect(result).toMatchObject({
      page: 2,
      limit: 20,
      total: 75,
      totalPages: 4,
      hasMore: true,
    });
  });

  it('loads a V2 group page in one set-based database query', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Nhóm',
        avatar: null,
        storeId: '22222222-2222-4222-8222-222222222222',
        lastReadSequence: '6',
        activityAt: '2026-08-29T00:00:00.000Z',
        unreadCount: 1,
        messageId: '33333333-3333-4333-8333-333333333333',
        clientMessageId: null,
        messageSequence: '7',
        messageContent: 'Tin mới',
        messageType: 'text',
        attachmentUrl: null,
        attachmentName: null,
        attachmentSize: null,
        senderId: '44444444-4444-4444-8444-444444444444',
        senderFullName: 'Sender',
        senderAvatar: null,
        messageCreatedAt: '2026-08-29T00:00:00.000Z',
      },
    ]);
    const service = new ChatMessageQueryService(
      { query } as unknown as DataSource,
      {} as ChatAuthorizationService,
    );
    const result = await service.getAuthorizedGroupListV2('account-id', {
      limit: 30,
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(result.data[0]).toMatchObject({ unreadCount: 1 });
  });

  it('applies a store filter and bounded legacy offset in the same list query', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new ChatMessageQueryService(
      { query } as unknown as DataSource,
      {} as ChatAuthorizationService,
    );
    await service.getAuthorizedGroupListV2(
      'account-id',
      { limit: 30 },
      '22222222-2222-4222-8222-222222222222',
      60,
    );
    const [statement, parameters] = query.mock.calls[0];
    expect(statement).toContain('chat_group.store_id');
    expect(statement).toContain('OFFSET');
    expect(parameters).toEqual([
      'account-id',
      '22222222-2222-4222-8222-222222222222',
      31,
      60,
    ]);
  });

  it('rejects invalid legacy list caps inside the service', async () => {
    const service = new ChatMessageQueryService(
      { query: jest.fn() } as unknown as DataSource,
      {} as ChatAuthorizationService,
    );
    await expect(
      service.getAuthorizedLegacyGroupList('account-id', {
        page: 1,
        limit: 101,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.getAuthorizedLegacyGroupList('account-id', {
        page: 10_001,
        limit: 20,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('computes total unread with one aggregate query', async () => {
    const query = jest.fn().mockResolvedValue([{ totalUnread: 42 }]);
    const service = new ChatMessageQueryService(
      { query } as unknown as DataSource,
      {} as ChatAuthorizationService,
    );
    await expect(service.getTotalUnreadCount('account-id')).resolves.toEqual({
      totalUnread: 42,
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
