import { EntityManager, FindOperator, Repository } from 'typeorm';

import { Account } from '../../../../src/modules/accounts/entities/account.entity';
import {
  EmployeeProfile,
  EmploymentStatus,
} from '../../../../src/modules/stores/entities/employee-profile.entity';
import { Store, StoreStatus } from '../../../../src/modules/stores/entities/store.entity';
import {
  ChatAuthorizationService,
  EMPLOYED_STATUS_SQL_LIST,
} from '../../../../src/modules/chat-groups/chat-authorization.service';
import { ChatGroupsService } from '../../../../src/modules/chat-groups/chat-groups.service';
import { ChatMessageQueryService } from '../../../../src/modules/chat-groups/chat-message-query.service';
import { ChatGroupMember } from '../../../../src/modules/chat-groups/entities/chat-group-member.entity';
import { ChatGroup } from '../../../../src/modules/chat-groups/entities/chat-group.entity';

/**
 * Chat membership follows the employed whitelist (active / probation /
 * on_leave). A PENDING job applicant or TERMINATED ex-employee is not a member
 * even when a stale chat_group_members row exists; the store owner always is.
 */
describe('chat employed-status whitelist', () => {
  it('builds the SQL list from the employed statuses only', () => {
    expect(EMPLOYED_STATUS_SQL_LIST).toBe("'active', 'probation', 'on_leave'");
    expect(EMPLOYED_STATUS_SQL_LIST).not.toContain('pending');
    expect(EMPLOYED_STATUS_SQL_LIST).not.toContain('terminated');
  });

  const buildAuthorization = (employee: EmployeeProfile | null) => {
    const group = Object.assign(new ChatGroup(), {
      id: 'group-id',
      storeId: 'store-id',
      store: Object.assign(new Store(), {
        id: 'store-id',
        ownerAccountId: 'owner-id',
        status: StoreStatus.ACTIVE,
      }),
    });
    const findEmployee = jest.fn().mockResolvedValue(employee);
    const service = new ChatAuthorizationService(
      { findOne: jest.fn().mockResolvedValue(group) } as unknown as Repository<ChatGroup>,
      {
        findOne: jest.fn().mockResolvedValue({ id: 'm', status: 'active' }),
      } as unknown as Repository<ChatGroupMember>,
      {} as Repository<Store>,
      { findOne: findEmployee } as unknown as Repository<EmployeeProfile>,
      {
        findOne: jest.fn().mockResolvedValue({ id: 'x' }),
      } as unknown as Repository<Account>,
    );
    return { service, findEmployee };
  };

  it('requireGroupAccess filters staff by the employed whitelist (pending excluded)', async () => {
    const { service, findEmployee } = buildAuthorization(null);

    await expect(
      service.requireGroupAccess('group-id', 'pending-applicant'),
    ).rejects.toMatchObject({ status: 403 });

    const operator = findEmployee.mock.calls[0][0].where
      .employmentStatus as FindOperator<EmploymentStatus[]>;
    expect(operator.type).toBe('in');
    expect(operator.value).toEqual([
      EmploymentStatus.ACTIVE,
      EmploymentStatus.PROBATION,
      EmploymentStatus.ON_LEAVE,
    ]);
  });

  it('requireGroupAccess lets the owner in without an employee profile', async () => {
    const { service, findEmployee } = buildAuthorization(null);

    await expect(
      service.requireGroupAccess('group-id', 'owner-id'),
    ).resolves.toMatchObject({ isOwner: true });
    expect(findEmployee).not.toHaveBeenCalled();
  });

  it('push device and eligibility queries use the employed whitelist', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const manager = { query } as unknown as EntityManager;
    const service = new ChatAuthorizationService(
      {} as Repository<ChatGroup>,
      {} as Repository<ChatGroupMember>,
      {} as Repository<Store>,
      {} as Repository<EmployeeProfile>,
      {} as Repository<Account>,
    );

    await service.getEligiblePushDevices('group-id', 'sender', manager);
    await service.requirePushDeliveryEligibility(
      {
        groupId: 'group-id',
        intendedAccountId: 'a',
        userDeviceId: 'd',
        expectedDeviceId: 'dev',
        expectedTokenFingerprint: 'fp',
        expectedRegistrationVersion: '1',
        senderAccountId: 'sender',
      },
      manager,
    );

    for (const [sql] of query.mock.calls) {
      expect(sql).toContain(
        "employee.employment_status IN ('active', 'probation', 'on_leave')",
      );
      expect(sql).not.toContain("!= 'terminated'");
    }
  });

  it('getEmployedAccountIds queries only employed statuses and returns a set', async () => {
    const builder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ accountId: 'staff-a' }]),
    };
    const service = new ChatAuthorizationService(
      {} as Repository<ChatGroup>,
      {} as Repository<ChatGroupMember>,
      {} as Repository<Store>,
      {
        createQueryBuilder: jest.fn(() => builder),
      } as unknown as Repository<EmployeeProfile>,
      {} as Repository<Account>,
    );

    const result = await service.getEmployedAccountIds('store-id', [
      'staff-a',
      'pending-b',
      'staff-a',
    ]);

    expect([...result]).toEqual(['staff-a']);
    expect(builder.andWhere).toHaveBeenCalledWith(
      'employee.accountId IN (:...accountIds)',
      { accountIds: ['staff-a', 'pending-b'] },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'employee.employmentStatus IN (:...employedStatuses)',
      { employedStatuses: ['active', 'probation', 'on_leave'] },
    );
  });

  it('getEmployedAccountIds skips the query for an empty list', async () => {
    const createQueryBuilder = jest.fn();
    const service = new ChatAuthorizationService(
      {} as Repository<ChatGroup>,
      {} as Repository<ChatGroupMember>,
      {} as Repository<Store>,
      { createQueryBuilder } as unknown as Repository<EmployeeProfile>,
      {} as Repository<Account>,
    );

    await expect(service.getEmployedAccountIds('store-id', [])).resolves.toEqual(
      new Set(),
    );
    expect(createQueryBuilder).not.toHaveBeenCalled();
  });

  it('group list and unread-total queries use the employed whitelist', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = Object.create(ChatMessageQueryService.prototype) as any;
    service.dataSource = { query };

    await service.getTotalUnreadCount('acc');

    expect(query.mock.calls[0][0]).toContain(
      "employee.employment_status IN ('active', 'probation', 'on_leave')",
    );
  });
});

describe('ChatGroupsService member lists hide non-employed members', () => {
  const members = [
    { accountId: 'owner-id', status: 'active', account: { fullName: 'Owner' } },
    { accountId: 'staff-a', status: 'active', account: { fullName: 'A' } },
    { accountId: 'terminated-b', status: 'active', account: { fullName: 'B' } },
    { accountId: 'pending-c', status: 'active', account: { fullName: 'C' } },
  ];

  const build = () => {
    const service = Object.create(ChatGroupsService.prototype) as any;
    service.authorization = {
      requireGroupAccess: jest.fn().mockResolvedValue({
        group: { storeId: 'store-id', store: { ownerAccountId: 'owner-id' } },
      }),
      getEmployedAccountIds: jest.fn().mockResolvedValue(new Set(['staff-a'])),
    };
    service.chatGroupRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'g1',
        name: 'Ca sáng',
        directKey: null,
        customSenderIds: [],
      }),
    };
    service.chatGroupMemberRepository = {
      find: jest.fn().mockResolvedValue(members),
    };
    return service;
  };

  it('GET members returns the owner and employed staff only', async () => {
    const service = build();

    const result = await service.getGroupMembers('g1', 'staff-a');

    expect(result.map((m: { accountId: string }) => m.accountId)).toEqual([
      'owner-id',
      'staff-a',
    ]);
    expect(service.authorization.getEmployedAccountIds).toHaveBeenCalledWith(
      'store-id',
      ['staff-a', 'terminated-b', 'pending-c'],
    );
  });

  it('group details members apply the same filter', async () => {
    const service = build();

    const result = await service.getGroupDetails('g1', 'staff-a');

    expect(
      result.members.map((m: { accountId: string }) => m.accountId),
    ).toEqual(['owner-id', 'staff-a']);
  });
});
