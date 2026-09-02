import { Repository } from 'typeorm';

import { Account } from '../accounts/entities/account.entity';
import {
  EmployeeProfile,
  EmploymentStatus,
} from '../stores/entities/employee-profile.entity';
import { Store, StoreStatus } from '../stores/entities/store.entity';
import { ChatAuthorizationService } from './chat-authorization.service';
import { ChatGroupMember } from './entities/chat-group-member.entity';
import { ChatGroup } from './entities/chat-group.entity';

describe('ChatAuthorizationService account status', () => {
  it.each(['blocked', 'deleted'])('denies a %s account before group lookup', async () => {
    const findGroup = jest.fn();
    const groups = { findOne: findGroup } as unknown as Repository<ChatGroup>;
    const accounts = {
      findOne: jest.fn().mockResolvedValue(null),
    } as unknown as Repository<Account>;
    const service = new ChatAuthorizationService(
      groups,
      {} as Repository<ChatGroupMember>,
      {} as Repository<Store>,
      {} as Repository<EmployeeProfile>,
      accounts,
    );
    await expect(
      service.requireGroupAccess('group-id', 'account-id'),
    ).rejects.toMatchObject({ status: 403 });
    expect(findGroup).not.toHaveBeenCalled();
  });
});

describe('ChatAuthorizationService group eligibility', () => {
  const createService = (options?: {
    storeStatus?: StoreStatus;
    employee?: EmployeeProfile | null;
  }) => {
    const group = Object.assign(new ChatGroup(), {
      id: 'group-id',
      storeId: 'store-id',
      createdBy: 'owner-id',
      store: Object.assign(new Store(), {
        id: 'store-id',
        ownerAccountId: 'owner-id',
        status: options?.storeStatus ?? StoreStatus.ACTIVE,
      }),
    });
    const member = Object.assign(new ChatGroupMember(), {
      id: 'member-id',
      groupId: 'group-id',
      accountId: 'staff-id',
      status: 'active',
    });
    const groups = {
      findOne: jest.fn().mockResolvedValue(group),
    } as unknown as Repository<ChatGroup>;
    const findMember = jest.fn().mockResolvedValue(member);
    const members = {
      findOne: findMember,
    } as unknown as Repository<ChatGroupMember>;
    const findEmployee = jest.fn().mockResolvedValue(
      options?.employee === undefined
        ? Object.assign(new EmployeeProfile(), {
            id: 'employee-id',
            employmentStatus: EmploymentStatus.ACTIVE,
          })
        : options.employee,
    );
    const employees = {
      findOne: findEmployee,
    } as unknown as Repository<EmployeeProfile>;
    const accounts = {
      findOne: jest.fn().mockResolvedValue({ id: 'staff-id' }),
    } as unknown as Repository<Account>;
    return {
      service: new ChatAuthorizationService(
        groups,
        members,
        {} as Repository<Store>,
        employees,
        accounts,
      ),
      groups,
      findMember,
      findEmployee,
      member,
    };
  };

  it('authorizes an active employee with active membership in an active store', async () => {
    const { service, member } = createService();

    await expect(
      service.requireGroupAccess('group-id', 'staff-id'),
    ).resolves.toMatchObject({ member, isOwner: false });
  });

  it('denies terminated staff represented by no non-terminated employee match', async () => {
    const { service, findEmployee } = createService({ employee: null });

    await expect(
      service.requireGroupAccess('group-id', 'staff-id'),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'CHAT_ACCESS_DENIED' },
    });
    expect(findEmployee).toHaveBeenCalledWith({
      where: expect.objectContaining({
        storeId: 'store-id',
        accountId: 'staff-id',
        employmentStatus: expect.anything(),
      }),
    });
  });

  it('denies access before membership lookup when the store is inactive', async () => {
    const { service, findMember, findEmployee } = createService({
      storeStatus: StoreStatus.INACTIVE,
    });

    await expect(
      service.requireGroupAccess('group-id', 'staff-id'),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'CHAT_ACCESS_DENIED' },
    });
    expect(findMember).not.toHaveBeenCalled();
    expect(findEmployee).not.toHaveBeenCalled();
  });
});
