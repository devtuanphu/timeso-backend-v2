import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Not, Repository } from 'typeorm';

import { Account, AccountStatus } from '../accounts/entities/account.entity';
import {
  EmployeeProfile,
  EmploymentStatus,
} from '../stores/entities/employee-profile.entity';
import { Store, StoreStatus } from '../stores/entities/store.entity';
import { UserDevice } from '../devices/entities/user-device.entity';
import { chatAccessDenied } from './chat-errors';
import { ChatGroupMember } from './entities/chat-group-member.entity';
import { ChatGroup } from './entities/chat-group.entity';

export interface AuthorizedChatContext {
  group: ChatGroup;
  member: ChatGroupMember;
  isOwner: boolean;
}

export interface EligibleChatPushDevice {
  userDeviceId: string;
  accountId: string;
  deviceId: string;
  tokenFingerprint: string;
  registrationVersion: string;
}

export type PushDeliveryEligibility =
  | { eligible: true; expoPushToken: string }
  | { eligible: false; reason: string };

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

  async getEligiblePushDevices(
    groupId: string,
    senderAccountId: string,
    manager?: EntityManager,
  ): Promise<EligibleChatPushDevice[]> {
    const executor = manager || this.memberRepository.manager;
    const rows = await executor.query(
      `SELECT device.id AS "userDeviceId",
              member.account_id AS "accountId",
              device.device_id AS "deviceId",
              device.push_token_fingerprint AS "tokenFingerprint",
              device.registration_version::text AS "registrationVersion"
       FROM chat_group_members member
       JOIN chat_groups chat_group
         ON chat_group.id = member.group_id AND chat_group.deleted_at IS NULL
       JOIN stores store
         ON store.id = chat_group.store_id
        AND store.status = 'active' AND store.deleted_at IS NULL
       JOIN accounts account
         ON account.id = member.account_id
        AND account.status = 'active' AND account.deleted_at IS NULL
       LEFT JOIN employee_profiles employee
         ON employee.store_id = chat_group.store_id
        AND employee.account_id = member.account_id
        AND employee.deleted_at IS NULL
       JOIN user_devices device
         ON device.user_id = member.account_id::text
        AND device.is_active = true
        AND device.deleted_at IS NULL
        AND device.push_token_fingerprint IS NOT NULL
       WHERE member.group_id = $1
         AND member.account_id != $2
         AND member.status = 'active'
         AND member.deleted_at IS NULL
         AND member.notifications_enabled = true
         AND (store.owner_account_id = member.account_id
              OR employee.employment_status != 'terminated')`,
      [groupId, senderAccountId],
    );
    return rows as EligibleChatPushDevice[];
  }

  async requirePushDeliveryEligibility(
    delivery: {
      groupId: string;
      intendedAccountId: string;
      userDeviceId: string;
      expectedDeviceId: string;
      expectedTokenFingerprint: string;
      expectedRegistrationVersion: string;
      senderAccountId: string;
    },
    manager?: EntityManager,
  ): Promise<PushDeliveryEligibility> {
    const executor = manager || this.memberRepository.manager;
    const rows = await executor.query(
      `SELECT device.expo_push_token AS "expoPushToken"
       FROM chat_group_members member
       JOIN chat_groups chat_group
         ON chat_group.id = member.group_id AND chat_group.deleted_at IS NULL
       JOIN stores store
         ON store.id = chat_group.store_id
        AND store.status = 'active' AND store.deleted_at IS NULL
       JOIN accounts account
         ON account.id = member.account_id
        AND account.status = 'active' AND account.deleted_at IS NULL
       LEFT JOIN employee_profiles employee
         ON employee.store_id = chat_group.store_id
        AND employee.account_id = member.account_id
        AND employee.deleted_at IS NULL
       JOIN user_devices device ON device.id = $3
       WHERE member.group_id = $1
         AND member.account_id = $2
         AND member.account_id != $7
         AND member.status = 'active'
         AND member.deleted_at IS NULL
         AND member.notifications_enabled = true
         AND (store.owner_account_id = member.account_id
              OR employee.employment_status != 'terminated')
         AND device.user_id = member.account_id::text
         AND device.device_id = $4
         AND device.push_token_fingerprint = $5
         AND device.registration_version = $6::bigint
         AND device.is_active = true
         AND device.deleted_at IS NULL
       LIMIT 1`,
      [
        delivery.groupId,
        delivery.intendedAccountId,
        delivery.userDeviceId,
        delivery.expectedDeviceId,
        delivery.expectedTokenFingerprint,
        delivery.expectedRegistrationVersion,
        delivery.senderAccountId,
      ],
    );
    const token = rows[0]?.expoPushToken;
    return typeof token === 'string' && token
      ? { eligible: true, expoPushToken: token }
      : { eligible: false, reason: 'DELIVERY_NO_LONGER_ELIGIBLE' };
  }
}
