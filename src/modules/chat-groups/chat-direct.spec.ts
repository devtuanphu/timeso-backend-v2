import { ChatGroupsService, CHAT_CONTACTS_LIMIT } from './chat-groups.service';
import { ChatGroup } from './entities/chat-group.entity';
import { ChatGroupMember } from './entities/chat-group-member.entity';
import { Store } from '../stores/entities/store.entity';
import { CHAT_DIRECT_IMMUTABLE, CHAT_DIRECT_INVALID_TARGET } from './chat-errors';

/** Chat riêng 1-1: hai người luôn mở lại đúng một cuộc chat. */
describe('ChatGroupsService.openDirectChat', () => {
  const STORE = 'store-1';

  interface BuildOptions {
    existing?: { id: string } | null;
    store?: { id: string; ownerAccountId: string } | null;
    memberRows?: Record<string, { id: string; status: string } | null>;
  }

  const build = ({
    existing = null,
    store = { id: STORE, ownerAccountId: 'owner' },
    memberRows = {},
  }: BuildOptions = {}) => {
    const service = Object.create(ChatGroupsService.prototype) as any;
    const saved: any[] = [];
    const updated: any[] = [];
    const storeRepo = { findOne: jest.fn().mockResolvedValue(store) };
    const groupRepo = {
      findOne: jest.fn().mockResolvedValue(existing),
      create: jest.fn((data: any) => data),
      save: jest.fn(async (data: any) => {
        saved.push(data);
        return { ...data, id: 'new-group' };
      }),
    };
    const memberRepo = {
      findOne: jest.fn(
        async ({ where }: any) => memberRows[where.accountId] ?? null,
      ),
      count: jest.fn(async () => 0),
      update: jest.fn(async (criteria: any, patch: any) => {
        updated.push({ criteria, patch });
      }),
      create: jest.fn((data: any) => data),
      save: jest.fn(async (data: any) => {
        saved.push(data);
        return data;
      }),
    };
    const manager = {
      getRepository: jest.fn((entity: any) => {
        if (entity === Store) return storeRepo;
        if (entity === ChatGroup) return groupRepo;
        if (entity === ChatGroupMember) return memberRepo;
        throw new Error('unexpected repository');
      }),
    };
    service.dataSource = {
      transaction: jest.fn(async (fn: any) => fn(manager)),
    };
    service.authorization = { requireEligibleParticipants: jest.fn() };
    service.getGroupDetails = jest.fn(async (id: string) => ({ id }));
    return { service, saved, updated, storeRepo, groupRepo, memberRepo };
  };

  it('không mở chat riêng với chính mình', async () => {
    const { service } = build();
    await expect(
      service.openDirectChat(STORE, 'acc-a', 'acc-a'),
    ).rejects.toMatchObject({
      response: { code: CHAT_DIRECT_INVALID_TARGET },
    });
    expect(service.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('mở lại: kiểm lại cả hai người, không tạo nhóm mới; khoá không phụ thuộc ai bấm', async () => {
    const { service, groupRepo, saved } = build({
      existing: { id: 'direct-1' },
      memberRows: {
        'acc-a': { id: 'm-a', status: 'active' },
        'acc-b': { id: 'm-b', status: 'active' },
      },
    });
    await expect(
      service.openDirectChat(STORE, 'acc-b', 'acc-a'),
    ).resolves.toEqual({ id: 'direct-1' });
    await service.openDirectChat(STORE, 'acc-a', 'acc-b');
    const keys = groupRepo.findOne.mock.calls.map(
      ([args]: any) => args.where.directKey,
    );
    expect(keys).toEqual([`${STORE}:acc-a:acc-b`, `${STORE}:acc-a:acc-b`]);
    expect(
      service.authorization.requireEligibleParticipants,
    ).toHaveBeenCalledWith(
      STORE,
      ['acc-a', 'acc-b'],
      'owner',
      expect.anything(),
    );
    expect(groupRepo.save).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it('mở lại: kích hoạt lại người đã rời, thêm dòng cho người chưa có, không nhân đôi', async () => {
    const { service, updated, saved } = build({
      existing: { id: 'direct-1' },
      memberRows: {
        'acc-a': { id: 'm-a', status: 'active' },
        'acc-b': { id: 'm-b', status: 'left' },
      },
    });
    await service.openDirectChat(STORE, 'acc-b', 'acc-a');
    expect(updated).toEqual([
      { criteria: { id: 'm-b' }, patch: { status: 'active' } },
    ]);
    expect(saved).toEqual([]);

    const second = build({
      existing: { id: 'direct-1' },
      memberRows: { 'acc-a': { id: 'm-a', status: 'active' }, 'acc-b': null },
    });
    await second.service.openDirectChat(STORE, 'acc-b', 'acc-a');
    expect(second.saved).toEqual([
      { groupId: 'direct-1', accountId: 'acc-b', status: 'active' },
    ]);
  });

  it('mở lại với người đã nghỉ việc thì bị từ chối, không kích hoạt lại ai', async () => {
    const { service, updated, memberRepo } = build({
      existing: { id: 'direct-1' },
      memberRows: { 'acc-b': { id: 'm-b', status: 'left' } },
    });
    service.authorization.requireEligibleParticipants.mockRejectedValue(
      new Error('denied'),
    );
    await expect(
      service.openDirectChat(STORE, 'acc-b', 'acc-a'),
    ).rejects.toThrow('denied');
    expect(memberRepo.findOne).not.toHaveBeenCalled();
    expect(updated).toEqual([]);
  });

  it('cửa hàng không tồn tại hoặc ngừng hoạt động thì CHAT_ACCESS_DENIED', async () => {
    const { service, storeRepo } = build({ store: null });
    await expect(
      service.openDirectChat(STORE, 'acc-b', 'acc-a'),
    ).rejects.toMatchObject({ response: { code: 'CHAT_ACCESS_DENIED' } });
    expect(storeRepo.findOne.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ id: STORE, status: 'active' }),
    );
  });

  it('chưa có thì kiểm cả hai người thuộc cửa hàng rồi tạo nhóm hai người', async () => {
    const { service, saved } = build();
    await expect(
      service.openDirectChat(STORE, 'acc-b', 'acc-a'),
    ).resolves.toEqual({ id: 'new-group' });
    expect(saved[0]).toEqual(
      expect.objectContaining({
        directKey: `${STORE}:acc-a:acc-b`,
        storeId: STORE,
      }),
    );
    expect(saved[1].map((m: any) => m.accountId)).toEqual(['acc-a', 'acc-b']);
  });

  it('hai người cùng bấm: lỗi trùng khoá thì chạy lại và mở (kích hoạt lại) cuộc chat vừa tạo', async () => {
    const { service, groupRepo } = build();
    groupRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'direct-race' });
    groupRepo.save.mockRejectedValueOnce({ code: '23505' });
    await expect(
      service.openDirectChat(STORE, 'acc-b', 'acc-a'),
    ).resolves.toEqual({ id: 'direct-race' });
    expect(service.dataSource.transaction).toHaveBeenCalledTimes(2);
  });

  it('người không thuộc cửa hàng thì bị từ chối', async () => {
    const { service } = build();
    service.authorization.requireEligibleParticipants.mockRejectedValue(
      new Error('denied'),
    );
    await expect(
      service.openDirectChat(STORE, 'stranger', 'acc-a'),
    ).rejects.toThrow('denied');
  });
});

describe('ChatGroupsService.getGroupDetails for direct chats', () => {
  const build = (group: any, peer: any) => {
    const service = Object.create(ChatGroupsService.prototype) as any;
    service.authorization = {
      requireGroupAccess: jest.fn().mockResolvedValue({
        group: { store: { ownerAccountId: 'owner' } },
      }),
    };
    service.chatGroupRepository = { findOne: jest.fn().mockResolvedValue(group) };
    service.chatGroupMemberRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(peer),
    };
    return service;
  };

  it('chat riêng trả tên, ảnh và account của người kia', async () => {
    const service = build(
      { id: 'd1', name: 'Chat riêng', directKey: 's:a:b', customSenderIds: [] },
      {
        accountId: 'acc-b',
        status: 'left',
        account: { fullName: 'Chi', avatar: 'uploads/chi.png' },
      },
    );
    await expect(service.getGroupDetails('d1', 'acc-a')).resolves.toMatchObject(
      {
        name: 'Chi',
        avatar: 'uploads/chi.png',
        isDirect: true,
        peerAccountId: 'acc-b',
      },
    );
    const where = service.chatGroupMemberRepository.findOne.mock.calls[0][0]
      .where;
    expect(where.groupId).toBe('d1');
    expect(where.status).toBeUndefined();
  });

  it('nhóm thường giữ tên nhóm, isDirect=false, peerAccountId=null', async () => {
    const service = build(
      { id: 'g1', name: 'Ca sáng', avatar: null, directKey: null },
      null,
    );
    await expect(service.getGroupDetails('g1', 'acc-a')).resolves.toMatchObject(
      { name: 'Ca sáng', isDirect: false, peerAccountId: null },
    );
    expect(service.chatGroupMemberRepository.findOne).not.toHaveBeenCalled();
  });
});

describe('Direct chat immutability', () => {
  const directGroup = { id: 'd1', directKey: 's:a:b', createdBy: 'owner' };

  const build = () => {
    const service = Object.create(ChatGroupsService.prototype) as any;
    service.authorization = {
      requireGroupAdmin: jest.fn().mockResolvedValue({ group: directGroup }),
      requireGroupAccess: jest.fn().mockResolvedValue({ group: directGroup }),
    };
    service.chatGroupRepository = { save: jest.fn() };
    service.chatGroupMemberRepository = { update: jest.fn(), find: jest.fn() };
    return service;
  };

  it.each([
    ['updateGroupSettings', (s: any) => s.updateGroupSettings('d1', { name: 'x' }, 'owner')],
    ['removeMember', (s: any) => s.removeMember('d1', 'acc-b', 'owner')],
    ['leaveGroup', (s: any) => s.leaveGroup('d1', 'acc-b')],
  ])('%s trả CHAT_DIRECT_IMMUTABLE và không ghi gì', async (_name, call) => {
    const service = build();
    await expect(call(service)).rejects.toMatchObject({
      response: { code: CHAT_DIRECT_IMMUTABLE },
    });
    expect(service.chatGroupRepository.save).not.toHaveBeenCalled();
    expect(service.chatGroupMemberRepository.update).not.toHaveBeenCalled();
  });

  it('kiểm quyền trước: người ngoài nhận 403, không lộ đây là chat riêng', async () => {
    const service = build();
    const denied = Object.assign(new Error('denied'), {
      response: { code: 'CHAT_ACCESS_DENIED' },
    });
    service.authorization.requireGroupAccess.mockRejectedValue(denied);
    await expect(service.leaveGroup('d1', 'stranger')).rejects.toMatchObject({
      response: { code: 'CHAT_ACCESS_DENIED' },
    });
  });

  it('addMembers vào chat riêng trả CHAT_DIRECT_IMMUTABLE', async () => {
    const service = build();
    const manager = {
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(directGroup),
      })),
    };
    service.dataSource = { transaction: jest.fn(async (fn: any) => fn(manager)) };
    service.getGroupDetails = jest.fn();
    await expect(
      service.addMembers('d1', ['acc-c'], 'owner'),
    ).rejects.toMatchObject({ response: { code: CHAT_DIRECT_IMMUTABLE } });
  });
});

describe('ChatGroupsService.getChatContacts', () => {
  const build = (store: any, rows: any[], directChats: any[] = []) => {
    const service = Object.create(ChatGroupsService.prototype) as any;
    const query = jest.fn().mockResolvedValue(rows);
    service.dataSource = {
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(store),
      })),
      query,
    };
    service.authorization = { requireEligibleParticipants: jest.fn() };
    service.chatGroupRepository = {
      find: jest.fn().mockResolvedValue(directChats),
    };
    return { service, query };
  };

  it('người gọi không thuộc cửa hàng: 403 và không chạy truy vấn', async () => {
    const { service, query } = build({ id: 's1', ownerAccountId: 'owner' }, []);
    service.authorization.requireEligibleParticipants.mockRejectedValue(
      new Error('denied'),
    );
    await expect(service.getChatContacts('s1', 'acc-x')).rejects.toThrow(
      'denied',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('cửa hàng không hoạt động: CHAT_ACCESS_DENIED', async () => {
    const { service, query } = build(null, []);
    await expect(service.getChatContacts('s1', 'acc-a')).rejects.toMatchObject({
      response: { code: 'CHAT_ACCESS_DENIED' },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('giới hạn số dòng, lọc theo cửa hàng và gắn directGroupId theo khoá', async () => {
    const { service, query } = build(
      { id: 's1', ownerAccountId: 'owner' },
      [
        { accountId: 'acc-b', fullName: 'Bình', avatar: null },
        { accountId: 'acc-0', fullName: null, avatar: 'uploads/x.png' },
      ],
      [{ id: 'direct-ab', directKey: 's1:acc-a:acc-b' }],
    );
    const result = await service.getChatContacts('s1', 'acc-a');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain(`LIMIT ${CHAT_CONTACTS_LIMIT}`);
    expect(sql).toContain('chat_group.store_id = $2');
    expect(params).toEqual(['acc-a', 's1']);
    expect(result).toEqual([
      {
        accountId: 'acc-b',
        fullName: 'Bình',
        avatar: null,
        directGroupId: 'direct-ab',
      },
      {
        accountId: 'acc-0',
        fullName: 'Thành viên',
        avatar: 'uploads/x.png',
        directGroupId: null,
      },
    ]);
  });
});
