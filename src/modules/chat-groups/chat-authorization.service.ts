import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Not, Repository } from 'typeorm';

import { Account, AccountStatus } from '../accounts/entities/account.entity';
import {
  EmployeeProfile,
  EmploymentStatus,
} from '../stores/entities/employee-profile.entity';
import { Store, StoreStatus } from '../stores/entities/store.entity';
import { chatAccessDenied } from './chat-errors';
import { ChatGroupMember } from './entities/chat-group-member.entity';
import { ChatGroup } from './entities/chat-group.entity';

export interface AuthorizedChatContext {
  group: ChatGroup;
  member: ChatGroupMember;
  isOwner: boolean;
}

@Injectable()
export class ChatAuthorizationService {
  constructor(
    @InjectRepository(ChatGroup)
    private readonly groupRepository: Repository<ChatGroup>,
    @InjectRepository(ChatGroupMember)
    private readonly memberRepository: Repository<ChatGroupMember>,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    @InjectRepository(EmployeeProfile)
    private readonly employeeRepository: Repository<EmployeeProfile>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
  ) {}

  async requireGroupAccess(
    groupId: string,
    accountId: string,
    manager?: EntityManager,
  ): Promise<AuthorizedChatContext> {
    const groups = manager?.getRepository(ChatGroup) || this.groupRepository;
    const members = manager?.getRepository(ChatGroupMember) || this.memberRepository;
    const employees =
      manager?.getRepository(EmployeeProfile) || this.employeeRepository;
    const accounts = manager?.getRepository(Account) || this.accountRepository;

    const account = await accounts.findOne({
      where: { id: accountId, status: AccountStatus.ACTIVE },
      select: { id: true },
    });
    if (!account) throw chatAccessDenied();

    const group = await groups.findOne({
      where: { id: groupId },
      relations: ['store'],
    });
    if (!group || group.store?.status !== StoreStatus.ACTIVE) {
      throw chatAccessDenied();
    }

    const member = await members.findOne({
      where: { groupId, accountId, status: 'active' },
    });
    if (!member) {
      throw chatAccessDenied();
    }

    const isOwner = group.store.ownerAccountId === accountId;
    if (!isOwner) {
      const employee = await employees.findOne({
        where: {
          storeId: group.storeId,
          accountId,
          employmentStatus: Not(EmploymentStatus.TERMINATED),
        },
      });
      if (!employee) {
        throw chatAccessDenied();
      }
    }

    return { group, member, isOwner };
  }

  async requireGroupAdmin(
    groupId: string,
    accountId: string,
    manager?: EntityManager,
  ): Promise<AuthorizedChatContext> {
    const context = await this.requireGroupAccess(groupId, accountId, manager);
    if (!context.isOwner || context.group.createdBy !== accountId) {
      throw chatAccessDenied();
    }
    return context;
  }

  async requireStoreOwner(
    storeId: string,
    accountId: string,
    manager?: EntityManager,
  ): Promise<Store> {
    const stores = manager?.getRepository(Store) || this.storeRepository;
    const accounts = manager?.getRepository(Account) || this.accountRepository;
    const account = await accounts.findOne({
      where: { id: accountId, status: AccountStatus.ACTIVE },
      select: { id: true },
    });
    if (!account) throw chatAccessDenied();
    const store = await stores.findOne({
      where: {
        id: storeId,
        ownerAccountId: accountId,
        status: StoreStatus.ACTIVE,
      },
    });
    if (!store) {
      throw chatAccessDenied();
    }
    return store;
  }

  async requireEligibleParticipants(
    storeId: string,
    accountIds: string[],
    ownerAccountId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const uniqueIds = [...new Set(accountIds)];
    if (uniqueIds.length !== accountIds.length || uniqueIds.length > 200) {
      throw chatAccessDenied();
    }

    const staffIds = uniqueIds.filter((id) => id !== ownerAccountId);
    if (staffIds.length === 0) return;

    const employees =
      manager?.getRepository(EmployeeProfile) || this.employeeRepository;
    const eligible = await employees
      .createQueryBuilder('employee')
      .select('employee.accountId', 'accountId')
      .where('employee.storeId = :storeId', { storeId })
      .andWhere('employee.accountId IN (:...accountIds)', {
        accountIds: staffIds,
      })
      .andWhere('employee.employmentStatus != :terminated', {
        terminated: EmploymentStatus.TERMINATED,
      })
      .getRawMany<{ accountId: string }>();

    if (new Set(eligible.map((row) => row.accountId)).size !== staffIds.length) {
      throw chatAccessDenied();
    }

    const accounts = manager?.getRepository(Account) || this.accountRepository;
    const accountCount = await accounts
      .createQueryBuilder('account')
      .where('account.id IN (:...accountIds)', { accountIds: uniqueIds })
      .andWhere('account.status = :accountStatus', {
        accountStatus: AccountStatus.ACTIVE,
      })
      .getCount();
    if (accountCount !== uniqueIds.length) {
      throw chatAccessDenied();
    }
  }

  async getEligibleRecipientAccountIds(
    groupId: string,
  ): Promise<string[]> {
    const rows = await this.memberRepository
      .createQueryBuilder('member')
      .innerJoin('member.group', 'group')
      .innerJoin('group.store', 'store')
      .innerJoin(
        Account,
        'account',
        'account.id = member.account_id AND account.status = :accountStatus AND account.deleted_at IS NULL',
        { accountStatus: AccountStatus.ACTIVE },
      )
      .leftJoin(
        EmployeeProfile,
        'employee',
        'employee.store_id = group.store_id AND employee.account_id = member.account_id AND employee.deleted_at IS NULL',
      )
      .select('member.account_id', 'accountId')
      .where('member.group_id = :groupId', { groupId })
      .andWhere('member.status = :active', { active: 'active' })
      .andWhere('store.status = :storeStatus', {
        storeStatus: StoreStatus.ACTIVE,
      })
      .andWhere(
        '(store.owner_account_id = member.account_id OR employee.employment_status != :terminated)',
        { terminated: EmploymentStatus.TERMINATED },
      )
      .getRawMany<{ accountId: string }>();

    return [...new Set(rows.map((row) => row.accountId))];
  }
}
