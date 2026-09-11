import { UnauthorizedException } from '@nestjs/common';
import { AppType } from '../accounts/entities/account-refresh-token.entity';
import { AccountStatus } from '../accounts/entities/account.entity';
import { OtpDeliveryStatus } from './dto/auth-response.dto';
import { AuthService } from './auth.service';

describe('AuthService staff registration', () => {
  const createService = () => {
    const events: string[] = [];
    const otpRepository = {
      update: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      getRepository: jest.fn().mockReturnValue(otpRepository),
      save: jest.fn(async (_entity, value) => value),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => {
        const value = await callback(manager);
        events.push('commit');
        return value;
      }),
    };
    const accountsService = {
      create: jest.fn().mockResolvedValue({ id: 'account-1' }),
      findByEmailOrPhone: jest.fn(),
      findByPhone: jest.fn(),
    };
    const zaloService = {
      sendOtp: jest.fn(async () => {
        events.push('zalo');
      }),
    };
    const employeeProfileRepository = { findOne: jest.fn() };
    const service = new AuthService(
      accountsService as never,
      { sign: jest.fn() } as never,
      // OTP codes are persisted as an HMAC keyed from JWT_SECRET, so the
      // service needs one even in registration-only tests.
      {
        get: jest.fn((key: string) =>
          key === 'JWT_SECRET' ? 'test-jwt-secret' : undefined,
        ),
      } as never,
      {} as never,
      {} as never,
      employeeProfileRepository as never,
      {} as never,
      zaloService as never,
      {} as never,
      dataSource as never,
    );
    return {
      accountsService,
      dataSource,
      employeeProfileRepository,
      events,
      manager,
      otpRepository,
      service,
      zaloService,
    };
  };

  it('commits account and OTP before delivering via Zalo', async () => {
    const fixture = createService();

    await expect(
      fixture.service.register({
        email: ' Staff@Example.com ',
        phone: '+84 900-000-000',
        passwordHash: 'secret',
      }),
    ).resolves.toMatchObject({
      phone: '0900000000',
      verificationRequired: true,
      otpDelivery: OtpDeliveryStatus.SENT,
    });

    expect(fixture.events).toEqual(['commit', 'zalo']);
    expect(fixture.accountsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'staff@example.com', phone: '0900000000' }),
      fixture.manager,
    );
    expect(fixture.employeeProfileRepository.findOne).not.toHaveBeenCalled();
    expect(fixture.manager.query).toHaveBeenCalledTimes(2);
  });

  it('keeps the committed account and OTP when Zalo delivery fails', async () => {
    const fixture = createService();
    fixture.zaloService.sendOtp.mockRejectedValueOnce(new Error('provider unavailable'));

    const result = await fixture.service.register({
      phone: '0900000000',
      passwordHash: 'secret',
    });

    expect(result.otpDelivery).toBe(OtpDeliveryStatus.FAILED);
    expect(fixture.events).toEqual(['commit']);
    expect(fixture.otpRepository.save).toHaveBeenCalledTimes(1);
  });

  it('rejects an older code when the newest unused OTP differs', async () => {
    const fixture = createService();
    fixture.accountsService.findByPhone.mockResolvedValue({
      id: 'account-1',
      status: AccountStatus.UNVERIFIED,
    });
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 'newest-otp',
        otp: '222222',
        expiresAt: new Date(Date.now() + 60_000),
        isUsed: false,
      }),
    };
    fixture.manager.getRepository.mockReturnValue({ createQueryBuilder: () => queryBuilder });

    await expect(
      fixture.service.verifyOtp('0900000000', '111111', 'register', AppType.EMPLOYEE_APP),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('accountOtp.createdAt', 'DESC');
    expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('accountOtp.id', 'DESC');
  });

  it('activates atomically and logs staff in only after commit', async () => {
    const fixture = createService();
    fixture.accountsService.findByPhone.mockResolvedValue({
      id: 'account-1',
      email: 'staff@example.com',
      phone: '0900000000',
      status: AccountStatus.UNVERIFIED,
    });
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 'newest-otp',
        otp: '222222',
        expiresAt: new Date(Date.now() + 60_000),
        isUsed: false,
      }),
    };
    fixture.manager.getRepository.mockReturnValue({ createQueryBuilder: () => queryBuilder });
    jest.spyOn(fixture.service, 'login').mockImplementation(async (_account, appType) => {
      fixture.events.push(`login:${appType}`);
      return { access_token: 'access', refresh_token: 'refresh', user: {} };
    });

    await expect(
      fixture.service.verifyOtp('0900000000', '222222', 'register', AppType.EMPLOYEE_APP),
    ).resolves.toMatchObject({ access_token: 'access' });

    expect(fixture.events).toEqual(['commit', `login:${AppType.EMPLOYEE_APP}`]);
    expect(fixture.manager.update).toHaveBeenCalled();
    expect(fixture.manager.save).toHaveBeenCalledTimes(2);
  });

  it.each([AccountStatus.ACTIVE, AccountStatus.BLOCKED])(
    'does not verify a registration OTP for a %s account',
    async (status) => {
      const fixture = createService();
      fixture.accountsService.findByPhone.mockResolvedValue({
        id: 'account-1',
        status,
      });

      await expect(
        fixture.service.verifyOtp(
          '0900000000',
          '222222',
          'register',
          AppType.EMPLOYEE_APP,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(fixture.manager.save).not.toHaveBeenCalled();
      expect(fixture.manager.update).not.toHaveBeenCalled();
    },
  );

  it.each([AccountStatus.ACTIVE, AccountStatus.BLOCKED])(
    'does not resend a registration OTP for a %s account',
    async (status) => {
      const fixture = createService();
      fixture.accountsService.findByPhone.mockResolvedValue({
        id: 'account-1',
        phone: '0900000000',
        status,
      });

      await expect(
        fixture.service.resendOtp('0900000000', 'register'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(fixture.otpRepository.save).not.toHaveBeenCalled();
      expect(fixture.zaloService.sendOtp).not.toHaveBeenCalled();
    },
  );

  it('maps malformed login identifiers to an authentication miss', async () => {
    const fixture = createService();

    await expect(
      fixture.service.validateUser(undefined as unknown as string, 'password'),
    ).resolves.toBeNull();
    expect(fixture.accountsService.findByPhone).not.toHaveBeenCalled();
    expect(fixture.accountsService.findByEmailOrPhone).not.toHaveBeenCalled();
  });

  it('does not disguise a login database failure as invalid credentials', async () => {
    const fixture = createService();
    const databaseFailure = new Error('isolated database failure');
    fixture.accountsService.findByEmailOrPhone.mockRejectedValue(databaseFailure);

    await expect(
      fixture.service.validateUser('0900000000', 'password'),
    ).rejects.toBe(databaseFailure);
  });

  it.each([
    ['forgotPassword', (service: AuthService) => service.forgotPassword('0900000000')],
    [
      'resetPassword',
      (service: AuthService) => service.resetPassword('0900000000', 'new-password'),
    ],
  ])('does not disguise a %s database failure as an unknown account', async (_name, invoke) => {
    const fixture = createService();
    const databaseFailure = new Error('isolated database failure');
    fixture.accountsService.findByPhone.mockRejectedValue(databaseFailure);

    await expect(invoke(fixture.service)).rejects.toBe(databaseFailure);
  });
});
