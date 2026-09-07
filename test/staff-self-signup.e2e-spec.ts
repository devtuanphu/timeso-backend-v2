import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AccountsService } from '../src/modules/accounts/accounts.service';
import { AccountFinance } from '../src/modules/accounts/entities/account-finance.entity';
import { AccountIdentityDocument } from '../src/modules/accounts/entities/account-identity-document.entity';
import { AccountOtp } from '../src/modules/accounts/entities/account-otp.entity';
import { AppType } from '../src/modules/accounts/entities/account-refresh-token.entity';
import {
  Account,
  AccountStatus,
} from '../src/modules/accounts/entities/account.entity';
import { JWT_ACCESS_TOKEN_USE } from '../src/modules/auth/jwt.config';
import { EmployeeMonthlySummary } from '../src/modules/stores/entities/employee-monthly-summary.entity';
import { EmployeeAssetAssignment } from '../src/modules/stores/entities/employee-asset-assignment.entity';
import {
  EmployeeContract,
  PaymentType,
} from '../src/modules/stores/entities/employee-contract.entity';
import {
  EmployeeProfile,
  EmploymentStatus,
} from '../src/modules/stores/entities/employee-profile.entity';
import { EmployeeSalary } from '../src/modules/stores/entities/employee-salary.entity';
import { MonthlyPayroll } from '../src/modules/stores/entities/monthly-payroll.entity';
import { Asset } from '../src/modules/stores/entities/asset.entity';
import { StoreEmployeeType } from '../src/modules/stores/entities/store-employee-type.entity';
import { StoreRole } from '../src/modules/stores/entities/store-role.entity';
import { StoreSkill } from '../src/modules/stores/entities/store-skill.entity';
import { Store, StoreStatus } from '../src/modules/stores/entities/store.entity';
import { WorkShift } from '../src/modules/stores/entities/work-shift.entity';
import {
  cleanupOwnedStaffSignupSchema,
  createStaffSignupTestApp,
  reserveStaffSignupSchema,
  assertStaffSignupIsolatedDatabaseEnvironment,
  STAFF_SIGNUP_ROLE_ID,
  STAFF_SIGNUP_STAFF,
  STAFF_SIGNUP_WORK_SHIFT_ID,
  StaffSignupTestApplication,
} from './support/staff-self-signup-test-app';

jest.mock('uuid', () => ({ v4: () => 'isolated-test-upload-id' }));

const databaseName = process.env.PGDATABASE || '';
const databaseHost = process.env.PGHOST || '';
const isExplicitTestDatabase =
  process.env.TIMESO_ISOLATED_DB === 'true' &&
  ['127.0.0.1', 'localhost', '::1'].includes(databaseHost) &&
  databaseName.endsWith('_test');
const describeWithTestDatabase = isExplicitTestDatabase ? describe : describe.skip;

describeWithTestDatabase('staff self-sign-up and owner attach (real PostgreSQL)', () => {
  let testApplication: StaffSignupTestApplication;
  let app: StaffSignupTestApplication['app'];
  let dataSource: DataSource;
  let accountsService: AccountsService;
  let jwtService: JwtService;
  let owner: Account;
  let store: Store;
  let deliveredOtps: Map<string, string>;
  let failingOtpDeliveries: Set<string>;

  beforeAll(async () => {
    testApplication = await createStaffSignupTestApp({
      runId: `jest-main-${process.pid}-${Date.now()}`,
    });
    app = testApplication.app;
    dataSource = testApplication.dataSource;
    accountsService = testApplication.accountsService;
    jwtService = testApplication.jwtService;
    owner = testApplication.fixture.owner;
    store = testApplication.fixture.store;
    deliveredOtps = testApplication.fixture.deliveredOtps;
    failingOtpDeliveries = testApplication.fixture.failingOtpDeliveries;
  }, 120_000);

  afterAll(async () => {
    await testApplication?.close();
  });

  const registerAndVerify = async (
    phone: string,
    email: string,
    fullName = 'Staff',
  ) => {
    const registerResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ fullName, email, phone, password: 'password' })
      .expect(201);
    expect(registerResponse.body).toMatchObject({
      phone,
      verificationRequired: true,
      otpDelivery: 'sent',
    });
    const account = await accountsService.findByPhone(phone);
    expect(account).toBeTruthy();
    expect(await dataSource.getRepository(EmployeeProfile).count({ where: { accountId: account!.id } })).toBe(0);

    const otp = deliveredOtps.get(phone);
    expect(otp).toMatch(/^\d{6}$/);
    const verifyResponse = await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ phone, otp, type: 'register', appType: AppType.EMPLOYEE_APP })
      .expect(200);
    expect(verifyResponse.body).toEqual(
      expect.objectContaining({ access_token: expect.any(String), refresh_token: expect.any(String) }),
    );
    return {
      account: (await accountsService.findByPhone(phone))!,
      accessToken: verifyResponse.body.access_token as string,
    };
  };

  it('registers without a profile, verifies, and discovers stores by accent-insensitive tokens', async () => {
    const { account: staff, accessToken } = await registerAndVerify(
      '0900000001',
      'staff1@isolated.test',
    );
    expect(staff.status).toBe(AccountStatus.ACTIVE);

    const response = await request(app.getHttpServer())
      .get('/stores/discovery')
      .auth(accessToken, { type: 'bearer' })
      .query({ q: 'dang nguyen hue', page: 1, limit: 20 })
      .expect(200);

    expect(response.body.items).toEqual([
      {
        id: store.id,
        name: 'Cà phê Đặng Văn',
        displayAddress: '125 Nguyễn Huệ, Bến Nghé, Hồ Chí Minh',
        avatarUrl: null,
      },
    ]);
    expect(Object.keys(response.body.items[0]).sort()).toEqual(
      ['avatarUrl', 'displayAddress', 'id', 'name'].sort(),
    );

    await request(app.getHttpServer())
      .get('/stores/discovery')
      .query({ q: 'timeso', page: 1, limit: 20 })
      .expect(401);
    const wrongTokenUse = jwtService.sign({
      sub: staff.id,
      email: staff.email,
      tokenUse: 'refresh',
    });
    await request(app.getHttpServer())
      .get('/stores/discovery')
      .auth(wrongTokenUse, { type: 'bearer' })
      .query({ q: 'timeso', page: 1, limit: 20 })
      .expect(401);
  });

  it('serializes legacy/new attach races and initializes the complete profile shell once', async () => {
    const { account: staff, accessToken } = await registerAndVerify(
      '0900000002',
      'staff2@isolated.test',
    );
    const ownerToken = jwtService.sign({
      sub: owner.id,
      email: owner.email,
      tokenUse: JWT_ACCESS_TOKEN_USE,
    });

    await request(app.getHttpServer())
      .get(`/stores/${store.id}/employee-account-candidate`)
      .auth(ownerToken, { type: 'bearer' })
      .query({ phone: '+84 900 000 002' })
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ eligible: true }));

    const [byPhone, byId] = await Promise.all([
      request(app.getHttpServer())
        .post(`/stores/${store.id}/employees/from-account`)
        .auth(ownerToken, { type: 'bearer' })
        .send({ phone: '0900000002' }),
      request(app.getHttpServer())
        .post(`/stores/${store.id}/employees`)
        .auth(ownerToken, { type: 'bearer' })
        .send({ accountId: staff.id }),
    ]);
    expect([byPhone.status, byId.status].sort()).toEqual([201, 409]);

    const profile = await dataSource.getRepository(EmployeeProfile).findOneByOrFail({
      accountId: staff.id,
      storeId: store.id,
    });
    expect(await dataSource.getRepository(EmployeeMonthlySummary).count({ where: { employeeProfileId: profile.id } })).toBe(1);
    expect(await dataSource.getRepository(EmployeeSalary).count({ where: { employeeProfileId: profile.id } })).toBe(1);
    expect(await dataSource.getRepository(MonthlyPayroll).count({ where: { storeId: store.id } })).toBe(1);
    expect((await accountsService.findById(staff.id))?.fullName).toBe('Staff');

    const memberships = await request(app.getHttpServer())
      .get('/accounts/employee-stores')
      .auth(accessToken, { type: 'bearer' })
      .expect(200);
    expect(memberships.body).toEqual([
      expect.objectContaining({ storeId: store.id, storeName: store.name }),
    ]);

    await request(app.getHttpServer())
      .get('/stores/discovery')
      .auth(accessToken, { type: 'bearer' })
      .query({ q: 'timeso', page: 1, limit: 20 })
      .expect(403);
  });

  it('serializes equivalent normalized identifiers without deadlock', async () => {
    const [canonical, international] = await Promise.all([
      request(app.getHttpServer()).post('/auth/register').send({
        fullName: 'Concurrent A',
        email: 'concurrent-a@isolated.test',
        phone: '0900000010',
        password: 'password',
      }),
      request(app.getHttpServer()).post('/auth/register').send({
        fullName: 'Concurrent B',
        email: 'concurrent-b@isolated.test',
        phone: '+84 900 000 010',
        password: 'password',
      }),
    ]);
    expect([canonical.status, international.status].sort()).toEqual([201, 409]);
    expect(await dataSource.getRepository(Account).count({ where: { phone: '0900000010' } })).toBe(1);

    const [lowercase, mixedCase] = await Promise.all([
      request(app.getHttpServer()).post('/auth/register').send({
        fullName: 'Concurrent email A',
        email: 'same-email@isolated.test',
        phone: '0900000011',
        password: 'password',
      }),
      request(app.getHttpServer()).post('/auth/register').send({
        fullName: 'Concurrent email B',
        email: 'Same-Email@Isolated.Test',
        phone: '0900000012',
        password: 'password',
      }),
    ]);
    expect([lowercase.status, mixedCase.status].sort()).toEqual([201, 409]);
  });

  it('keeps a durable OTP after Zalo failure and recovers through resend', async () => {
    const phone = '0900000020';
    failingOtpDeliveries.add(phone);
    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        fullName: 'Delivery recovery',
        email: 'delivery@isolated.test',
        phone,
        password: 'password',
      })
      .expect(201);
    expect(registration.body.otpDelivery).toBe('failed');
    const account = await accountsService.findByPhone(phone);
    expect(account?.status).toBe(AccountStatus.UNVERIFIED);
    expect(await dataSource.getRepository(AccountOtp).count({ where: { accountId: account!.id } })).toBe(1);

    failingOtpDeliveries.delete(phone);
    const resend = await request(app.getHttpServer())
      .post('/auth/resend-otp')
      .send({ phone, type: 'register' })
      .expect(200);
    expect(resend.body.otpDelivery).toBe('sent');
    await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({
        phone,
        otp: deliveredOtps.get(phone),
        type: 'register',
        appType: AppType.EMPLOYEE_APP,
      })
      .expect(200);
  });

  it('rejects older, expired and already-used OTPs using one outward error', async () => {
    const phone = '0900000030';
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        fullName: 'OTP ordering',
        email: 'otp-order@isolated.test',
        phone,
        password: 'password',
      })
      .expect(201);
    const account = (await accountsService.findByPhone(phone))!;
    const oldCode = deliveredOtps.get(phone)!;
    const otpRepository = dataSource.getRepository(AccountOtp);
    const newest = await otpRepository.save(
      otpRepository.create({
        accountId: account.id,
        otp: '654321',
        type: 'REGISTER',
        isUsed: false,
        expiresAt: new Date(Date.now() - 1_000),
        createdAt: new Date(Date.now() + 1_000),
      }),
    );

    for (const otp of [oldCode, '654321']) {
      const invalid = await request(app.getHttpServer())
        .post('/auth/verify-otp')
        .send({ phone, otp, type: 'register', appType: AppType.EMPLOYEE_APP })
        .expect(401);
      expect(invalid.body).toMatchObject({ code: 'INVALID_OR_EXPIRED_OTP' });
    }

    newest.expiresAt = new Date(Date.now() + 60_000);
    await otpRepository.save(newest);
    await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ phone, otp: '654321', type: 'register', appType: AppType.EMPLOYEE_APP })
      .expect(200);
    const reused = await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ phone, otp: '654321', type: 'register', appType: AppType.EMPLOYEE_APP })
      .expect(401);
    expect(reused.body).toMatchObject({ code: 'INVALID_OR_EXPIRED_OTP' });
  });

  it('allows only one concurrent verification of the latest OTP', async () => {
    const phone = '0900000031';
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        fullName: 'Concurrent OTP',
        email: 'otp-concurrent@isolated.test',
        phone,
        password: 'password',
      })
      .expect(201);
    const payload = {
      phone,
      otp: deliveredOtps.get(phone),
      type: 'register',
      appType: AppType.EMPLOYEE_APP,
    };
    const responses = await Promise.all([
      request(app.getHttpServer()).post('/auth/verify-otp').send(payload),
      request(app.getHttpServer()).post('/auth/verify-otp').send(payload),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
  });

  it('enforces owner isolation and rolls back foreign references, contract and asset work', async () => {
    const { account: staff } = await registerAndVerify(
      '0900000040',
      'rollback@isolated.test',
    );
    const otherOwner = await accountsService.create({
      fullName: 'Other owner',
      email: 'other-owner@isolated.test',
      phone: '0910000040',
      passwordHash: 'password',
      status: AccountStatus.ACTIVE,
    });
    const otherOwnerToken = jwtService.sign({
      sub: otherOwner.id,
      email: otherOwner.email,
      tokenUse: JWT_ACCESS_TOKEN_USE,
    });
    await request(app.getHttpServer())
      .get(`/stores/${store.id}/employee-account-candidate`)
      .auth(otherOwnerToken, { type: 'bearer' })
      .query({ phone: staff.phone })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/stores/${store.id}/employees/from-account`)
      .auth(otherOwnerToken, { type: 'bearer' })
      .send({ phone: staff.phone })
      .expect(403);
    expect(
      await dataSource.getRepository(EmployeeProfile).count({
        where: { accountId: staff.id },
      }),
    ).toBe(0);

    const ownerToken = jwtService.sign({
      sub: owner.id,
      email: owner.email,
      tokenUse: JWT_ACCESS_TOKEN_USE,
    });
    await request(app.getHttpServer())
      .post(`/stores/${store.id}/employees/from-account`)
      .auth(ownerToken, { type: 'bearer' })
      .send({
        phone: staff.phone,
        storeRoleId: '11111111-1111-4111-8111-111111111111',
      })
      .expect(400);
    expect(await dataSource.getRepository(EmployeeProfile).count({ where: { accountId: staff.id } })).toBe(0);

    const unavailableAsset = await dataSource.getRepository(Asset).save(
      dataSource.getRepository(Asset).create({
        storeId: store.id,
        name: 'Hết tồn kho',
        currentStock: 0,
      }),
    );
    const rollbackSnapshot = async () => ({
      profiles: await dataSource.getRepository(EmployeeProfile).count({
        where: { accountId: staff.id },
      }),
      contracts: await dataSource.getRepository(EmployeeContract).count(),
      summaries: await dataSource.getRepository(EmployeeMonthlySummary).count(),
      payrolls: await dataSource.getRepository(MonthlyPayroll).count({
        where: { storeId: store.id },
      }),
      salaries: await dataSource.getRepository(EmployeeSalary).count(),
      assignments: await dataSource
        .getRepository(EmployeeAssetAssignment)
        .count({ where: { assetId: unavailableAsset.id } }),
      assetStock: (
        await dataSource.getRepository(Asset).findOneByOrFail({
          id: unavailableAsset.id,
        })
      ).currentStock,
    });
    const beforeRejectedAttach = await rollbackSnapshot();
    await request(app.getHttpServer())
      .post(`/stores/${store.id}/employees/from-account`)
      .auth(ownerToken, { type: 'bearer' })
      .send({
        phone: staff.phone,
        assetIds: [unavailableAsset.id],
        contract: {
          contractName: 'Hợp đồng phải rollback',
          paymentType: 'Tháng',
          salaryAmount: 8_000_000,
        },
      })
      .expect(409);
    expect(await rollbackSnapshot()).toEqual(beforeRejectedAttach);
  });

  it('locks final asset stock so only one account can consume it', async () => {
    const [first, second] = await Promise.all([
      registerAndVerify('0900000050', 'asset-first@isolated.test'),
      registerAndVerify('0900000051', 'asset-second@isolated.test'),
    ]);
    const assetRepository = dataSource.getRepository(Asset);
    const lastAsset = await assetRepository.save(
      assetRepository.create({ storeId: store.id, name: 'Tài sản cuối', currentStock: 1 }),
    );
    const ownerToken = jwtService.sign({
      sub: owner.id,
      email: owner.email,
      tokenUse: JWT_ACCESS_TOKEN_USE,
    });

    const responses = await Promise.all(
      [first.account.phone, second.account.phone].map((phone) =>
        request(app.getHttpServer())
          .post(`/stores/${store.id}/employees/from-account`)
          .auth(ownerToken, { type: 'bearer' })
          .send({ phone, assetIds: [lastAsset.id] }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect((await assetRepository.findOneByOrFail({ id: lastAsset.id })).currentStock).toBe(0);
    expect(await dataSource.getRepository(EmployeeAssetAssignment).count({ where: { assetId: lastAsset.id } })).toBe(1);
  });

  it('keeps blocked accounts blocked when registration OTP endpoints are retried', async () => {
    const phone = '0900000060';
    const blocked = await accountsService.create({
      fullName: 'Blocked staff',
      email: 'blocked@isolated.test',
      phone,
      passwordHash: 'password',
      status: AccountStatus.BLOCKED,
    });
    await dataSource.getRepository(AccountOtp).save({
      accountId: blocked.id,
      otp: '123456',
      type: 'REGISTER',
      isUsed: false,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ phone, otp: '123456', type: 'register', appType: AppType.EMPLOYEE_APP })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/resend-otp')
      .send({ phone, type: 'register' })
      .expect(401);

    expect((await accountsService.findById(blocked.id))?.status).toBe(
      AccountStatus.BLOCKED,
    );
    expect(
      await dataSource.getRepository(AccountOtp).count({
        where: { accountId: blocked.id },
      }),
    ).toBe(1);
  });

  it('creates one first-month payroll while attaching two different accounts', async () => {
    const [first, second] = await Promise.all([
      registerAndVerify('0900000061', 'payroll-first@isolated.test'),
      registerAndVerify('0900000062', 'payroll-second@isolated.test'),
    ]);
    const payrollStore = await dataSource.getRepository(Store).save({
      ownerAccountId: owner.id,
      name: 'Payroll concurrency QA',
      status: StoreStatus.ACTIVE,
    });
    const ownerToken = jwtService.sign({
      sub: owner.id,
      email: owner.email,
      tokenUse: JWT_ACCESS_TOKEN_USE,
    });

    const responses = await Promise.all(
      [first.account.phone, second.account.phone].map((phone) =>
        request(app.getHttpServer())
          .post(`/stores/${payrollStore.id}/employees/from-account`)
          .auth(ownerToken, { type: 'bearer' })
          .send({ phone }),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(
      await dataSource.getRepository(MonthlyPayroll).count({
        where: { storeId: payrollStore.id },
      }),
    ).toBe(1);
    const profileIds = (
      await dataSource.getRepository(EmployeeProfile).find({
        where: { storeId: payrollStore.id },
      })
    ).map((profile) => profile.id);
    expect(
      await dataSource
        .getRepository(EmployeeSalary)
        .createQueryBuilder('salary')
        .where('salary.employeeProfileId IN (:...profileIds)', { profileIds })
        .getCount(),
    ).toBe(2);
  });

  it('authorizes restore and serializes it against attachment to another store', async () => {
    const { account: staff } = await registerAndVerify(
      '0900000063',
      'restore-race@isolated.test',
    );
    const profileRepository = dataSource.getRepository(EmployeeProfile);
    const terminatedProfile = await profileRepository.save({
      storeId: store.id,
      accountId: staff.id,
      employmentStatus: EmploymentStatus.TERMINATED,
      leftAt: new Date(),
    });
    await profileRepository.softDelete(terminatedProfile.id);

    const foreignOwner = await accountsService.create({
      fullName: 'Foreign restore owner',
      email: 'foreign-restore@isolated.test',
      phone: '0910000063',
      passwordHash: 'password',
      status: AccountStatus.ACTIVE,
    });
    const foreignToken = jwtService.sign({
      sub: foreignOwner.id,
      email: foreignOwner.email,
      tokenUse: JWT_ACCESS_TOKEN_USE,
    });
    await request(app.getHttpServer())
      .post(`/stores/employees/${terminatedProfile.id}/restore`)
      .auth(foreignToken, { type: 'bearer' })
      .expect(403);

    const destinationStore = await dataSource.getRepository(Store).save({
      ownerAccountId: owner.id,
      name: 'Restore race destination QA',
      status: StoreStatus.ACTIVE,
    });
    const ownerToken = jwtService.sign({
      sub: owner.id,
      email: owner.email,
      tokenUse: JWT_ACCESS_TOKEN_USE,
    });
    const [restore, attach] = await Promise.all([
      request(app.getHttpServer())
        .post(`/stores/employees/${terminatedProfile.id}/restore`)
        .auth(ownerToken, { type: 'bearer' }),
      request(app.getHttpServer())
        .post(`/stores/${destinationStore.id}/employees/from-account`)
        .auth(ownerToken, { type: 'bearer' })
        .send({ phone: staff.phone }),
    ]);
    expect([restore.status, attach.status].sort()).toEqual([201, 409]);
    const activeProfiles = await profileRepository
      .createQueryBuilder('profile')
      .withDeleted()
      .where('profile.accountId = :accountId', { accountId: staff.id })
      .andWhere('profile.employmentStatus != :terminated', {
        terminated: EmploymentStatus.TERMINATED,
      })
      .getCount();
    expect(activeProfiles).toBe(1);
  });

  it('fails closed for ambiguous legacy identifiers and canonicalizes safe updates', async () => {
    const passwordHash = await bcrypt.hash('password', 10);
    const accountRepository = dataSource.getRepository(Account);
    const first = await accountRepository.save({
      fullName: 'Legacy phone A',
      email: 'legacy-a@isolated.test',
      phone: '+84900000070',
      passwordHash,
      status: AccountStatus.ACTIVE,
    });
    const second = await accountRepository.save({
      fullName: 'Legacy phone B',
      email: 'legacy-b@isolated.test',
      phone: '0900000070',
      passwordHash,
      status: AccountStatus.ACTIVE,
    });

    expect(await accountsService.findByPhone('0900000070')).toBeNull();
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ emailOrPhone: '0900000070', password: 'password' })
      .expect(401);
    await expect(
      accountsService.update(first.id, { phone: '0900000070' }),
    ).rejects.toMatchObject({ status: 409 });

    const safe = await accountsService.create({
      fullName: 'Canonical update',
      email: 'canonical-update@isolated.test',
      phone: '0900000071',
      passwordHash: 'password',
      status: AccountStatus.ACTIVE,
    });
    await accountsService.update(safe.id, { phone: '+84 900-000-072' });
    expect((await accountRepository.findOneByOrFail({ id: safe.id })).phone).toBe(
      '0900000072',
    );
    expect((await accountRepository.findOneByOrFail({ id: second.id })).phone).toBe(
      '0900000070',
    );

    await accountRepository.save([
      {
        fullName: 'Legacy email A',
        email: 'Legacy-Collision@Isolated.Test',
        phone: '0900000073',
        passwordHash,
        status: AccountStatus.ACTIVE,
      },
      {
        fullName: 'Legacy email B',
        email: 'legacy-collision@isolated.test',
        phone: '0900000074',
        passwordHash,
        status: AccountStatus.ACTIVE,
      },
    ]);
    expect(
      await accountsService.findByEmail('legacy-collision@isolated.test'),
    ).toBeNull();
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        emailOrPhone: 'LEGACY-COLLISION@ISOLATED.TEST',
        password: 'password',
      })
      .expect(401);
  });

  it('initializes valid work, contract, salary and asset records without changing account identity', async () => {
    const { account: staff } = await registerAndVerify(
      '0900000080',
      'full-attach@isolated.test',
    );
    const accountRepository = dataSource.getRepository(Account);
    const readIdentity = async () => {
      const account = await accountRepository
        .createQueryBuilder('account')
        .addSelect('account.passwordHash')
        .where('account.id = :id', { id: staff.id })
        .getOneOrFail();
      return {
        fullName: account.fullName,
        email: account.email,
        phone: account.phone,
        passwordHash: account.passwordHash,
        avatar: account.avatar,
        address: account.address,
        status: account.status,
      };
    };
    const identityBefore = await readIdentity();
    const role = await dataSource.getRepository(StoreRole).save({
      storeId: store.id,
      code: 'FULL_ATTACH_ROLE',
      name: 'Nhân viên phục vụ',
    });
    const employeeType = await dataSource.getRepository(StoreEmployeeType).save({
      storeId: store.id,
      code: 'FULL_ATTACH_TYPE',
      name: 'Toàn thời gian',
    });
    const workShift = await dataSource.getRepository(WorkShift).save({
      storeId: store.id,
      shiftName: 'Ca sáng full attach',
      startTime: '08:00:00',
      endTime: '16:00:00',
    });
    const skill = await dataSource.getRepository(StoreSkill).save({
      storeId: store.id,
      name: 'Pha chế full attach',
    });
    const asset = await dataSource.getRepository(Asset).save({
      storeId: store.id,
      name: 'Tạp dề full attach',
      currentStock: 2,
    });
    const ownerToken = jwtService.sign({
      sub: owner.id,
      email: owner.email,
      tokenUse: JWT_ACCESS_TOKEN_USE,
    });

    await request(app.getHttpServer())
      .post(`/stores/${store.id}/employees/from-account`)
      .auth(ownerToken, { type: 'bearer' })
      .send({
        phone: staff.phone,
        storeRoleId: role.id,
        employeeTypeId: employeeType.id,
        workShiftId: workShift.id,
        skillId: skill.id,
        assetIds: [asset.id, asset.id],
        contract: {
          contractName: 'Hợp đồng full attach',
          jobDescription: 'Phục vụ và pha chế',
          startDate: '2026-09-01',
          durationMonths: 12,
          weeklyWorkingHours: 40,
          paymentType: PaymentType.MONTH,
          salaryAmount: 9_000_000,
          allowances: { meal: 500_000 },
          terms: [{ title: 'Nội quy', content: 'Tuân thủ lịch làm việc' }],
        },
      })
      .expect(201);

    const profile = await dataSource.getRepository(EmployeeProfile).findOneByOrFail({
      accountId: staff.id,
      storeId: store.id,
    });
    expect(profile).toMatchObject({
      storeRoleId: role.id,
      employeeTypeId: employeeType.id,
      workShiftId: workShift.id,
      skillId: skill.id,
    });
    const contract = await dataSource.getRepository(EmployeeContract).findOneByOrFail({
      employeeProfileId: profile.id,
    });
    expect(contract).toMatchObject({
      contractName: 'Hợp đồng full attach',
      jobDescription: 'Phục vụ và pha chế',
      durationMonths: 12,
      paymentType: PaymentType.MONTH,
      allowances: { meal: 500_000 },
      terms: [{ title: 'Nội quy', content: 'Tuân thủ lịch làm việc' }],
    });
    expect(Number(contract.weeklyWorkingHours)).toBe(40);
    expect(Number(contract.salaryAmount)).toBe(9_000_000);
    const summary = await dataSource
      .getRepository(EmployeeMonthlySummary)
      .findOneByOrFail({ employeeProfileId: profile.id });
    expect(Number(summary.baseSalary)).toBe(9_000_000);
    const salary = await dataSource.getRepository(EmployeeSalary).findOneByOrFail({
      employeeProfileId: profile.id,
    });
    expect(Number(salary.baseSalary)).toBe(9_000_000);
    expect(salary.paymentType).toBe(PaymentType.MONTH);
    expect(salary.monthlyPayrollId).toBeTruthy();
    expect(
      await dataSource.getRepository(EmployeeAssetAssignment).count({
        where: { employeeProfileId: profile.id, assetId: asset.id },
      }),
    ).toBe(1);
    expect((await dataSource.getRepository(Asset).findOneByOrFail({ id: asset.id })).currentStock).toBe(1);
    expect(await readIdentity()).toEqual(identityBefore);
    expect(
      await dataSource.getRepository(AccountIdentityDocument).count({
        where: { accountId: staff.id },
      }),
    ).toBe(0);
    expect(
      await dataSource.getRepository(AccountFinance).count({
        where: { accountId: staff.id },
      }),
    ).toBe(0);
  });

  it('discovers only active nondeleted stores with stable pagination and a minimal projection', async () => {
    const { accessToken } = await registerAndVerify(
      '0900000081',
      'discovery-page@isolated.test',
    );
    const storeRepository = dataSource.getRepository(Store);
    const visibleStores = await storeRepository.save([
      {
        ownerAccountId: owner.id,
        name: 'Discovery QA Alpha',
        addressLine: '1 Đường Một',
        status: StoreStatus.ACTIVE,
      },
      {
        ownerAccountId: owner.id,
        name: 'Discovery QA Beta',
        addressLine: '2 Đường Hai',
        status: StoreStatus.ACTIVE,
      },
      {
        ownerAccountId: owner.id,
        name: 'Discovery QA Gamma',
        addressLine: '3 Đường Ba',
        status: StoreStatus.ACTIVE,
      },
    ]);
    await storeRepository.save({
      ownerAccountId: owner.id,
      name: 'Discovery QA Inactive',
      status: StoreStatus.INACTIVE,
    });
    const deletedStore = await storeRepository.save({
      ownerAccountId: owner.id,
      name: 'Discovery QA Deleted',
      status: StoreStatus.ACTIVE,
    });
    await storeRepository.softDelete(deletedStore.id);

    const firstPage = await request(app.getHttpServer())
      .get('/stores/discovery')
      .auth(accessToken, { type: 'bearer' })
      .query({ q: 'discovery qa', page: 1, limit: 2 })
      .expect(200);
    const secondPage = await request(app.getHttpServer())
      .get('/stores/discovery')
      .auth(accessToken, { type: 'bearer' })
      .query({ q: 'discovery qa', page: 2, limit: 2 })
      .expect(200);

    expect(firstPage.body).toMatchObject({ page: 1, limit: 2, hasMore: true });
    expect(secondPage.body).toMatchObject({ page: 2, limit: 2, hasMore: false });
    const items = [...firstPage.body.items, ...secondPage.body.items];
    expect(items.map((item) => item.id)).toEqual(visibleStores.map((item) => item.id));
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
        ['avatarUrl', 'displayAddress', 'id', 'name'].sort(),
      );
    }
  });

  it('reports only positive sanitized facts for the actual owner default contract payload', async () => {
    const { account: staff } = await registerAndVerify(
      STAFF_SIGNUP_STAFF.phone,
      STAFF_SIGNUP_STAFF.email,
      STAFF_SIGNUP_STAFF.fullName,
    );
    const ownerToken = jwtService.sign({
      sub: owner.id,
      email: owner.email,
      tokenUse: JWT_ACCESS_TOKEN_USE,
    });
    await request(app.getHttpServer())
      .post(`/stores/${store.id}/employees/from-account`)
      .auth(ownerToken, { type: 'bearer' })
      .send({
        phone: staff.phone,
        storeRoleId: STAFF_SIGNUP_ROLE_ID,
        workShiftId: STAFF_SIGNUP_WORK_SHIFT_ID,
        contract: {
          contractName: 'Hợp đồng lao động',
          salaryAmount: 0,
          paymentType: PaymentType.SHIFT,
          endDate: '',
          durationMonths: 12,
          weeklyWorkingHours: 44,
          allowances: {
            'Tiền tăng ca (VNĐ)': 200_000,
            'Phụ cấp (VNĐ)': 300_000,
            'Thưởng (VNĐ)': 1_000_000,
          },
        },
      })
      .expect(201);

    const status = await testApplication.getSanitizedStatus();
    expect(status).toMatchObject({
      accountCount: 1,
      accountStatus: AccountStatus.ACTIVE,
      identityMatchesExpected: true,
      profileCount: 1,
      activeProfileCount: 1,
      profileStoreMatches: true,
      profileReferencesMatch: true,
      profileReferencesMatchSubmitted: true,
      contractCount: 1,
      contractMatchesSubmitted: true,
      monthlySummaryCount: 1,
      monthlyPayrollCount: 1,
      employeeSalaryCount: 1,
      assetAssignmentCount: 0,
      assetAssignmentsMatchSubmitted: true,
    });
    expect(status).not.toHaveProperty('profileReferences');
    expect(status).not.toHaveProperty('contract');
    expect(status).not.toHaveProperty('schema');
  });

  it('returns stable client errors for malformed auth identifiers', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ password: 'password' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ emailOrPhone: 'not-a-phone', password: 'password' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ phone: 'not-a-phone' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ phone: 'not-a-phone', newPassword: 'password' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ phone: owner.phone })
      .expect(400);
  });

  it('owns each test schema exclusively and cleans only with its reservation token', async () => {
    const config = assertStaffSignupIsolatedDatabaseEnvironment(process.env);
    const runId = `lifecycle-${process.pid}-${Date.now()}`;
    const first = await reserveStaffSignupSchema(config, runId);
    try {
      await expect(reserveStaffSignupSchema(config, runId)).rejects.toThrow(
        'STAFF_SIGNUP_TEST_SCHEMA_ALREADY_OWNED',
      );
      await expect(
        cleanupOwnedStaffSignupSchema(config, {
          ...first,
          ownershipToken: 'not-the-owner-token',
        }),
      ).rejects.toThrow('STAFF_SIGNUP_TEST_SCHEMA_NOT_OWNED');
      const stillOwned = await dataSource.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name=$1`,
        [first.schema],
      );
      expect(stillOwned).toHaveLength(1);

      const second = await reserveStaffSignupSchema(config, `${runId}-other`);
      expect(second.schema).not.toBe(first.schema);
      await cleanupOwnedStaffSignupSchema(config, second);
    } finally {
      await cleanupOwnedStaffSignupSchema(config, first);
    }
  });
});
