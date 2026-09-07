import {
  BadRequestException,
  Injectable,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Account } from './entities/account.entity';
import { AccountIdentityDocument } from './entities/account-identity-document.entity';
import { AccountFinance } from './entities/account-finance.entity';
import { EmployeeProfile, EmploymentStatus } from '../stores/entities/employee-profile.entity';
import * as bcrypt from 'bcrypt';
import {
  legacyNormalizedPhoneSql,
  normalizeEmail,
  normalizeVietnamPhone,
} from '../../common/utils/account-identifier';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(AccountIdentityDocument)
    private readonly identityDocRepository: Repository<AccountIdentityDocument>,
    @InjectRepository(AccountFinance)
    private readonly financeRepository: Repository<AccountFinance>,
    @InjectRepository(EmployeeProfile)
    private readonly employeeProfileRepository: Repository<EmployeeProfile>,
  ) {}

  private singleMatchOrNull(accounts: Account[]): Account | null {
    // Legacy rows may contain multiple presentation variants for the same
    // canonical identifier. Never authenticate or attach an arbitrary row.
    return accounts.length === 1 ? accounts[0] : null;
  }

  async create(data: Partial<Account>, manager?: EntityManager) {
    const repository = manager
      ? manager.getRepository(Account)
      : this.accountRepository;
    const normalizedData: Partial<Account> = {
      ...data,
      email: data.email ? normalizeEmail(data.email) : data.email,
      phone: data.phone ? normalizeVietnamPhone(data.phone) : data.phone,
    };
    const duplicateQuery = repository.createQueryBuilder('account');
    if (normalizedData.email && normalizedData.phone) {
      duplicateQuery.where('LOWER(account.email) = :email', {
        email: normalizedData.email,
      });
      duplicateQuery.orWhere(
        `${legacyNormalizedPhoneSql('account.phone')} = :phone`,
        { phone: normalizedData.phone },
      );
    } else if (normalizedData.email) {
      duplicateQuery.where('LOWER(account.email) = :email', {
        email: normalizedData.email,
      });
    } else if (normalizedData.phone) {
      duplicateQuery.where(
        `${legacyNormalizedPhoneSql('account.phone')} = :phone`,
        { phone: normalizedData.phone },
      );
    }
    const existing = await duplicateQuery.getOne();

    if (existing) {
      throw new ConflictException('Email or Phone already exists');
    }

    if (normalizedData.passwordHash) {
      normalizedData.passwordHash = await bcrypt.hash(
        normalizedData.passwordHash,
        10,
      );
    }

    const account = repository.create(normalizedData);
    return repository.save(account);
  }

  async findByEmail(email: string, manager?: EntityManager, lock = false) {
    const query = (manager ? manager.getRepository(Account) : this.accountRepository)
      .createQueryBuilder('account')
      .addSelect('account.passwordHash')
      .where('(account.email = :email OR LOWER(account.email) = :email)', {
        email: normalizeEmail(email),
      });
    if (lock) {
      // Do not join nullable one-to-one relations while locking. PostgreSQL
      // rejects FOR UPDATE on the nullable side of an outer join.
      query.setLock('pessimistic_write');
    } else {
      query
        .leftJoinAndSelect('account.identityDocument', 'identityDocument')
        .leftJoinAndSelect('account.finance', 'finance');
    }
    return this.singleMatchOrNull(await query.take(2).getMany());
  }

  async findByPhone(phone: string, manager?: EntityManager, lock = false) {
    const normalizedPhone = normalizeVietnamPhone(phone);
    const query = (manager ? manager.getRepository(Account) : this.accountRepository)
      .createQueryBuilder('account')
      .addSelect('account.passwordHash')
      .where(
        `(account.phone = :phone OR ${legacyNormalizedPhoneSql(
          'account.phone',
        )} = :phone)`,
        { phone: normalizedPhone },
      );
    if (lock) {
      query.setLock('pessimistic_write');
    } else {
      query
        .leftJoinAndSelect('account.identityDocument', 'identityDocument')
        .leftJoinAndSelect('account.finance', 'finance');
    }
    return this.singleMatchOrNull(await query.take(2).getMany());
  }

  /**
   * Find account by email OR phone number (for login with either)
   */
  async findByEmailOrPhone(emailOrPhone: string, manager?: EntityManager) {
    const repository = manager
      ? manager.getRepository(Account)
      : this.accountRepository;
    const value = emailOrPhone.trim();
    const query = repository
      .createQueryBuilder('account')
      .addSelect('account.passwordHash')
      .leftJoinAndSelect('account.identityDocument', 'identityDocument')
      .leftJoinAndSelect('account.finance', 'finance');
    if (value.includes('@')) {
      query.where('(account.email = :email OR LOWER(account.email) = :email)', {
        email: normalizeEmail(value),
      });
    } else {
      query.where(
        `(account.phone = :phone OR ${legacyNormalizedPhoneSql(
          'account.phone',
        )} = :phone)`,
        { phone: normalizeVietnamPhone(value) },
      );
    }
    return this.singleMatchOrNull(await query.take(2).getMany());
  }

  async findById(id: string) {
    return this.accountRepository.findOne({
      where: { id },
      relations: ['identityDocument', 'finance'],
    });
  }

  async update(id: string, data: Partial<Account>) {
    const changes: Partial<Account> = { ...data };
    const updatesEmail = Object.prototype.hasOwnProperty.call(data, 'email');
    const updatesPhone = Object.prototype.hasOwnProperty.call(data, 'phone');
    if (!updatesEmail && !updatesPhone) {
      await this.accountRepository.update(id, changes);
      return this.findById(id);
    }

    try {
      if (updatesEmail && typeof data.email === 'string') {
        changes.email = normalizeEmail(data.email);
      }
      if (updatesPhone) {
        if (typeof data.phone !== 'string') throw new Error('invalid phone');
        changes.phone = normalizeVietnamPhone(data.phone);
      }
    } catch {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Email hoặc số điện thoại không hợp lệ.',
      });
    }

    await this.accountRepository.manager.transaction(async (manager) => {
      const keys = [
        typeof changes.email === 'string'
          ? `account-identifier:email:${changes.email}`
          : undefined,
        typeof changes.phone === 'string'
          ? `account-identifier:phone:${changes.phone}`
          : undefined,
      ]
        .filter((value): value is string => Boolean(value))
        .sort();
      for (const key of keys) {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [key],
        );
      }

      const repository = manager.getRepository(Account);
      const account = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) return;

      const duplicateQuery = repository
        .createQueryBuilder('account')
        .where('account.id != :id', { id });
      if (typeof changes.email === 'string' && typeof changes.phone === 'string') {
        duplicateQuery.andWhere(
          `((account.email = :email OR LOWER(account.email) = :email) OR (account.phone = :phone OR ${legacyNormalizedPhoneSql(
            'account.phone',
          )} = :phone))`,
          { email: changes.email, phone: changes.phone },
        );
      } else if (typeof changes.email === 'string') {
        duplicateQuery.andWhere(
          '(account.email = :email OR LOWER(account.email) = :email)',
          { email: changes.email },
        );
      } else if (typeof changes.phone === 'string') {
        duplicateQuery.andWhere(
          `(account.phone = :phone OR ${legacyNormalizedPhoneSql(
            'account.phone',
          )} = :phone)`,
          { phone: changes.phone },
        );
      }
      if (keys.length && (await duplicateQuery.getExists())) {
        throw new ConflictException('Email or Phone already exists');
      }
      await repository.update(id, changes);
    });
    return this.findById(id);
  }

  async createIdentityDocument(
    accountId: string,
    data: Partial<AccountIdentityDocument>,
    manager?: EntityManager,
  ) {
    const repository = manager
      ? manager.getRepository(AccountIdentityDocument)
      : this.identityDocRepository;
    const identityDoc = repository.create({
      ...data,
      accountId,
    });
    return repository.save(identityDoc);
  }

  async createFinance(
    accountId: string,
    data: Partial<AccountFinance>,
    manager?: EntityManager,
  ) {
    const repository = manager
      ? manager.getRepository(AccountFinance)
      : this.financeRepository;
    const finance = repository.create({
      ...data,
      accountId,
    });
    return repository.save(finance);
  }

  async verifyPassword(accountId: string, password: string): Promise<boolean> {
    const account = await this.accountRepository
      .createQueryBuilder('account')
      .addSelect('account.passwordHash')
      .where('account.id = :id', { id: accountId })
      .getOne();

    if (!account || !account.passwordHash) return false;
    return bcrypt.compare(password, account.passwordHash);
  }

  /**
   * Get all stores where user is an active employee
   */
  async getEmployeeStores(accountId: string) {
    const profiles = await this.employeeProfileRepository.find({
      where: { accountId },
      relations: ['store'],
    });

    return profiles
      .filter(p => p.employmentStatus !== EmploymentStatus.TERMINATED)
      .map(p => ({
        employeeProfileId: p.id,
        storeId: p.storeId,
        storeName: p.store?.name || '',
        storeAvatar: p.store?.avatarUrl || null,
        employmentStatus: p.employmentStatus,
        workingStatus: p.workingStatus,
        joinedAt: p.joinedAt,
      }));
  }
}
