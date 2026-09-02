import { DataSource, Repository } from 'typeorm';
import { validate } from 'class-validator';

import { ChatAuthorizationService } from './chat-authorization.service';
import { chatAccessDenied } from './chat-errors';
import { ChatGroupsService } from './chat-groups.service';
import { AddMembersDto } from './dto/add-members.dto';
import { ChatGroupMember } from './entities/chat-group-member.entity';
import { ChatGroup } from './entities/chat-group.entity';
import { ChatMessage } from './entities/chat-message.entity';

describe('ChatGroupsService member concurrency', () => {
  it('rejects an empty member list at the DTO boundary', async () => {
    const dto = Object.assign(new AddMembersDto(), { memberIds: [] });

    const errors = await validate(dto);

    expect(errors[0]?.constraints).toMatchObject({ arrayMinSize: expect.any(String) });
  });

  it('rejects an empty member list before opening a transaction', async () => {
    const transaction = jest.fn();
    const dataSource = {
      transaction,
    } as unknown as DataSource;
    const service = new ChatGroupsService(
      {} as Repository<ChatGroup>,
      {} as Repository<ChatGroupMember>,
      {} as Repository<ChatMessage>,
      dataSource,
      {} as ChatAuthorizationService,
    );

    await expect(
      service.addMembers('group-id', [], 'owner-id'),
    ).rejects.toMatchObject({ status: 400, message: 'CHAT_MEMBERS_REQUIRED' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('locks the group row before counting and inserting active members', async () => {
    const order: string[] = [];
    const groupRepository = {
      findOne: jest.fn().mockImplementation(async () => {
        order.push('lock-group');
        return { id: 'group-id' };
      }),
    };
    const activeBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    const memberRepository = {
      createQueryBuilder: jest.fn(() => activeBuilder),
      count: jest.fn().mockImplementation(async () => {
        order.push('count-active');
        return 199;
      }),
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async () => {
        order.push('save-member');
      }),
    };
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === ChatGroup ? groupRepository : memberRepository,
      ),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    } as unknown as DataSource;
    const authorization = {
      requireGroupAdmin: jest.fn().mockResolvedValue({
        group: { id: 'group-id', storeId: 'store-id' },
      }),
      requireEligibleParticipants: jest.fn().mockResolvedValue(undefined),
    } as unknown as ChatAuthorizationService;
    const service = new ChatGroupsService(
      {} as Repository<ChatGroup>,
      {} as Repository<ChatGroupMember>,
      {} as Repository<ChatMessage>,
      dataSource,
      authorization,
    );
    jest
      .spyOn(service, 'getGroupDetails')
      .mockResolvedValue({ id: 'group-id' } as never);

    await service.addMembers('group-id', ['account-id'], 'owner-id');

    expect(groupRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'group-id' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(order).toEqual(['lock-group', 'count-active', 'save-member']);
  });
});

describe('ChatGroupsService legacy message compatibility', () => {
  const createService = (messages: ChatMessage[] = []) => {
    const messageRepository = {
      findAndCount: jest.fn().mockResolvedValue([messages, messages.length]),
    } as unknown as Repository<ChatMessage>;
    const authorization = {
      requireGroupAccess: jest.fn().mockResolvedValue({ member: { id: 'member' } }),
    } as unknown as ChatAuthorizationService;
    return new ChatGroupsService(
      {} as Repository<ChatGroup>,
      {} as Repository<ChatGroupMember>,
      messageRepository,
      {} as DataSource,
      authorization,
    );
  };

  it.each([
    [0, 20],
    [1, 0],
    [1, 101],
    [1.5, 20],
    [10_001, 20],
  ])('rejects invalid legacy page=%s limit=%s inside the service', async (page, limit) => {
    await expect(
      createService().getGroupMessages('group-id', 'account-id', page, limit),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('returns only the minimal sender compatibility fields', async () => {
    const legacy = Object.assign(new ChatMessage(), {
      id: 'message-id',
      groupId: 'group-id',
      senderId: 'sender-id',
      content: 'hello',
      messageType: 'text',
      attachmentUrl: null,
      attachmentName: null,
      attachmentSize: null,
      readBy: [],
      createdAt: new Date('2026-08-29T00:00:00.000Z'),
      updatedAt: new Date('2026-08-29T00:00:00.000Z'),
      sender: {
        id: 'sender-id',
        fullName: 'Sender',
        avatar: null,
        phone: 'secret-phone',
        email: 'secret@example.test',
        birthday: '1990-01-01',
        address: 'secret-address',
      },
    });
    const result = await createService([legacy]).getGroupMessages(
      'group-id',
      'account-id',
      1,
      20,
    );
    expect(result.data[0].sender).toEqual({
      id: 'sender-id',
      fullName: 'Sender',
      avatar: null,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /secret-phone|secret@example|birthday|secret-address/,
    );
  });
});

describe('ChatGroupsService member settings authorization', () => {
  const createService = (
    memberRepository: Partial<Repository<ChatGroupMember>>,
    authorization: Partial<ChatAuthorizationService>,
  ) =>
    new ChatGroupsService(
      {} as Repository<ChatGroup>,
      memberRepository as Repository<ChatGroupMember>,
      {} as Repository<ChatMessage>,
      {} as DataSource,
      authorization as ChatAuthorizationService,
    );

  const updateBuilder = (result: {
    affected: number;
    raw: Array<{
      id: string;
      chat_color: string | null;
      notifications_enabled: boolean;
    }>;
  }) => ({
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(result),
  });

  it('updates settings for a canonically authorized active member', async () => {
    const member = Object.assign(new ChatGroupMember(), {
      id: 'member-id',
      chatColor: '#000000',
      notificationsEnabled: false,
    });
    const builder = updateBuilder({
      affected: 1,
      raw: [
        {
          id: 'member-id',
          chat_color: '#ffffff',
          notifications_enabled: true,
        },
      ],
    });
    const memberRepository = {
      createQueryBuilder: jest.fn(() => builder),
      save: jest.fn(),
    };
    const authorization = {
      requireGroupAccess: jest.fn().mockResolvedValue({ member }),
    };
    const service = createService(memberRepository, authorization);

    await expect(
      service.updateMemberSettings('group-id', 'account-id', {
        chatColor: '#ffffff',
        notificationsEnabled: true,
      }),
    ).resolves.toEqual({
      id: 'member-id',
      chatColor: '#ffffff',
      notificationsEnabled: true,
    });
    expect(authorization.requireGroupAccess).toHaveBeenCalledWith(
      'group-id',
      'account-id',
    );
    expect(builder.set).toHaveBeenCalledWith({
      chatColor: '#ffffff',
      notificationsEnabled: true,
    });
    expect(builder.where).toHaveBeenCalledWith('id = :memberId', {
      memberId: 'member-id',
    });
    expect(builder.andWhere).toHaveBeenCalledWith('group_id = :groupId', {
      groupId: 'group-id',
    });
    expect(builder.andWhere).toHaveBeenCalledWith('account_id = :userId', {
      userId: 'account-id',
    });
    expect(builder.andWhere).toHaveBeenCalledWith("status = 'active'");
    expect(builder.andWhere).toHaveBeenCalledWith('deleted_at IS NULL');
    expect(memberRepository.save).not.toHaveBeenCalled();
  });

  it('updates only the provided setting field', async () => {
    const member = Object.assign(new ChatGroupMember(), {
      id: 'member-id',
      chatColor: '#000000',
      notificationsEnabled: true,
    });
    const builder = updateBuilder({
      affected: 1,
      raw: [
        {
          id: 'member-id',
          chat_color: '#ffffff',
          notifications_enabled: true,
        },
      ],
    });
    const service = createService(
      { createQueryBuilder: jest.fn(() => builder) },
      { requireGroupAccess: jest.fn().mockResolvedValue({ member }) },
    );

    await expect(
      service.updateMemberSettings('group-id', 'account-id', {
        chatColor: '#ffffff',
      }),
    ).resolves.toMatchObject({
      chatColor: '#ffffff',
      notificationsEnabled: true,
    });
    expect(builder.set).toHaveBeenCalledWith({ chatColor: '#ffffff' });
  });

  it('preserves the authorized member response for an empty settings patch', async () => {
    const member = Object.assign(new ChatGroupMember(), {
      id: 'member-id',
      chatColor: '#000000',
      notificationsEnabled: true,
    });
    const createQueryBuilder = jest.fn();
    const service = createService(
      { createQueryBuilder },
      { requireGroupAccess: jest.fn().mockResolvedValue({ member }) },
    );

    await expect(
      service.updateMemberSettings('group-id', 'account-id', {}),
    ).resolves.toEqual({
      id: 'member-id',
      chatColor: '#000000',
      notificationsEnabled: true,
    });
    expect(createQueryBuilder).not.toHaveBeenCalled();
  });

  it('denies a stale update when membership becomes removed after authorization', async () => {
    const member = Object.assign(new ChatGroupMember(), {
      id: 'member-id',
      chatColor: '#000000',
      notificationsEnabled: true,
    });
    const builder = updateBuilder({ affected: 0, raw: [] });
    const service = createService(
      { createQueryBuilder: jest.fn(() => builder), save: jest.fn() },
      { requireGroupAccess: jest.fn().mockResolvedValue({ member }) },
    );

    await expect(
      service.updateMemberSettings('group-id', 'account-id', {
        notificationsEnabled: false,
      }),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'CHAT_ACCESS_DENIED' },
    });
  });

  it.each(['terminated staff', 'inactive store'])(
    'denies %s through canonical chat authorization without saving',
    async () => {
      const memberRepository = {
        createQueryBuilder: jest.fn(),
        save: jest.fn(),
      };
      const authorization = {
        requireGroupAccess: jest.fn().mockRejectedValue(chatAccessDenied()),
      };
      const service = createService(memberRepository, authorization);

      await expect(
        service.updateMemberSettings('group-id', 'account-id', {
          notificationsEnabled: false,
        }),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'CHAT_ACCESS_DENIED' },
      });
      expect(memberRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(memberRepository.save).not.toHaveBeenCalled();
    },
  );
});
