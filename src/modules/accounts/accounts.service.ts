import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from './entities/account.entity';
import { AccountIdentityDocument } from './entities/account-identity-document.entity';
import { AccountFinance } from './entities/account-finance.entity';
import { EmployeeProfile, EmploymentStatus } from '../stores/entities/employee-profile.entity';
import * as bcrypt from 'bcrypt';

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

  async create(data: Partial<Account>) {
    const existing = await this.accountRepository.findOne({
      where: [{ email: data.email }, { phone: data.phone }],
    });

    if (existing) {
      throw new ConflictException('Email or Phone already exists');
    }

    if (data.passwordHash) {
      data.passwordHash = await bcrypt.hash(data.passwordHash, 10);
    }

    const account = this.accountRepository.create(data);
    return this.accountRepository.save(account);
  }

  async findByEmail(email: string) {
    return this.accountRepository
      .createQueryBuilder('account')
      .addSelect('account.passwordHash')
      .leftJoinAndSelect('account.identityDocument', 'identityDocument')
      .leftJoinAndSelect('account.finance', 'finance')
      .where('account.email = :email', { email })
      .getOne();
  }

  async findByPhone(phone: string) {
    return this.accountRepository
      .createQueryBuilder('account')
      .addSelect('account.passwordHash')
      .leftJoinAndSelect('account.identityDocument', 'identityDocument')
      .leftJoinAndSelect('account.finance', 'finance')
      .where('account.phone = :phone', { phone })
      .getOne();
  }

  /**
   * Find account by email OR phone number (for login with either)
   */
  async findByEmailOrPhone(emailOrPhone: string) {
    return this.accountRepository
      .createQueryBuilder('account')
      .addSelect('account.passwordHash')
      .leftJoinAndSelect('account.identityDocument', 'identityDocument')
      .leftJoinAndSelect('account.finance', 'finance')
      .where('account.email = :emailOrPhone', { emailOrPhone })
      .orWhere('account.phone = :emailOrPhone', { emailOrPhone })
      .getOne();
  }

  async findById(id: string) {
    return this.accountRepository.findOne({
      where: { id },
      relations: ['identityDocument', 'finance'],
    });
  }

  async update(id: string, data: Partial<Account>) {
    await this.accountRepository.update(id, data);
    return this.findById(id);
  }

  async createIdentityDocument(
    accountId: string,
    data: Partial<AccountIdentityDocument>,
  ) {
    const identityDoc = this.identityDocRepository.create({
      ...data,
      accountId,
    });
    return this.identityDocRepository.save(identityDoc);
  }

  async createFinance(accountId: string, data: Partial<AccountFinance>) {
    const finance = this.financeRepository.create({
      ...data,
      accountId,
    });
    return this.financeRepository.save(finance);
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
