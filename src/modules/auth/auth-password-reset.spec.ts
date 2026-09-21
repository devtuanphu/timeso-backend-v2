import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { AppType } from '../accounts/entities/account-refresh-token.entity';
import { AccountStatus } from '../accounts/entities/account.entity';
import { hashOtp } from './otp-hash';
import {
  AuthService,
  __resetOtpVerifyLimiterForTests,
  hashRefreshToken,
} from './auth.service';

const ACCESS_SECRET = 'test-access-secret';
const REFRESH_SECRET = 'test-refresh-secret';

const createFixture = () => {
  const jwtService = new JwtService({
    secret: ACCESS_SECRET,
    signOptions: { expiresIn: '1h' },
  });
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return ACCESS_SECRET;
      if (key === 'JWT_REFRESH_SECRET') return REFRESH_SECRET;
      if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
      return undefined;
    }),
  };
  const account = {
    id: 'account-1',
    phone: '0900000000',
    email: 'owner@example.test',
    status: AccountStatus.ACTIVE,
    passwordHash: 'old-password-hash',
  };

  const otpRow = {
    id: 'otp-1',
    otp: hashOtp('123456', ACCESS_SECRET),
    expiresAt: new Date(Date.now() + 60_000),
    isUsed: false,
  };
  const otpQuery = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn(async () => (otpRow.isUsed ? null : otpRow)),
  };
  const accountQuery = {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest.fn(async () => ({ ...account })),
  };
  const updates: Array<{ entity: string; criteria: unknown; values: any }> = [];
  const manager = {
    getRepository: jest.fn((entity: { name: string }) =>
      entity.name === 'Account'
        ? { createQueryBuilder: () => accountQuery }
        : { createQueryBuilder: () => otpQuery },
    ),
    save: jest.fn(async (_entity, value) => value),
    update: jest.fn(async (entity: { name: string }, criteria, values) => {
      updates.push({ entity: entity.name, criteria, values });
      if (entity.name === 'Account' && values.passwordHash) {
        account.passwordHash = values.passwordHash;
      }
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (callback) => callback(manager)),
  };
  const accountsService = {
    findByPhone: jest.fn(async () => ({ ...account })),
    findById: jest.fn(async () => ({ ...account })),
  };
  const refreshRows: any[] = [];
  const refreshTokenRepository = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => {
      refreshRows.push({ id: `row-${refreshRows.length}`, revokedAt: null, ...value });
      return value;
    }),
    find: jest.fn(async () => refreshRows.filter((row) => !row.revokedAt)),
    findOne: jest.fn(async ({ where }) =>
      refreshRows.find(
        (row) =>
          !row.revokedAt &&
          row.tokenHash === where.tokenHash &&
          row.accountId === where.accountId &&
          row.appType === where.appType,
      ) ?? null,
    ),
    update: jest.fn(async (criteria: any, values: any) => {
      const row = refreshRows.find((r) => r.id === criteria.id && !r.revokedAt);
      if (!row) return { affected: 0 };
      Object.assign(row, values);
      return { affected: 1 };
    }),
    delete: jest.fn(async () => undefined),
  };
  const otpRepository = { update: jest.fn(async () => undefined) };
  const service = new AuthService(
    accountsService as never,
    jwtService,
    configService as never,
    refreshTokenRepository as never,
    otpRepository as never,
    { findOne: jest.fn() } as never,
    {} as never,
    {} as never,
    {
      ensureDailyReportsForOwner: jest.fn().mockResolvedValue(undefined),
      ensureDailyReportForStore: jest.fn().mockResolvedValue(undefined),
    } as never,
    dataSource as never,
  );
  return {
    account,
    jwtService,
    manager,
    otpRow,
    refreshRows,
    refreshTokenRepository,
    service,
    updates,
  };
};

describe('AuthService password reset', () => {
  beforeEach(() => __resetOtpVerifyLimiterForTests());

  it('rejects a reset that presents no reset token, even after repeated forgot-password calls', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.resetPassword('', 'new-password', '0900000000'),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      fixture.service.resetPassword('not-a-token', 'new-password'),
    ).rejects.toMatchObject({ status: 401 });
    expect(fixture.manager.update).not.toHaveBeenCalled();
  });

  it('issues a reset token from verify-otp that resets the password once and revokes sessions', async () => {
    const fixture = createFixture();

    const verified = (await fixture.service.verifyOtp(
      '0900000000',
      '123456',
      'forgot-password',
    )) as { resetToken: string };
    expect(typeof verified.resetToken).toBe('string');

    await expect(
      fixture.service.resetPassword(verified.resetToken, 'new-password', '0900000000'),
    ).resolves.toMatchObject({ message: expect.any(String) });

    expect(await bcrypt.compare('new-password', fixture.account.passwordHash)).toBe(true);
    expect(fixture.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: 'AccountRefreshToken',
          values: { revokedAt: expect.any(Date) },
        }),
      ]),
    );

    // Same token again: the password changed, so its fingerprint no longer matches.
    await expect(
      fixture.service.resetPassword(verified.resetToken, 'another-password'),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a reset token for a different phone', async () => {
    const fixture = createFixture();
    const verified = (await fixture.service.verifyOtp(
      '0900000000',
      '123456',
      'forgot-password',
    )) as { resetToken: string };

    await expect(
      fixture.service.resetPassword(verified.resetToken, 'new-password', '0911111111'),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('does not accept an access token as a reset token', async () => {
    const fixture = createFixture();
    const accessToken = fixture.jwtService.sign({
      sub: fixture.account.id,
      tokenUse: 'access',
    });

    await expect(
      fixture.service.resetPassword(accessToken, 'new-password'),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe('AuthService refresh token rotation', () => {
  it('stores a SHA-256 hash and rejects an older token of the same account after rotation', async () => {
    const fixture = createFixture();

    const first = (await fixture.service.login(fixture.account as never, AppType.OWNER_APP)) as {
      refresh_token: string;
    };
    const second = (await fixture.service.refreshToken(
      first.refresh_token,
      AppType.OWNER_APP,
    )) as { refresh_token: string };

    expect(fixture.refreshRows[0].tokenHash).toBe(hashRefreshToken(first.refresh_token));
    expect(first.refresh_token).not.toBe(second.refresh_token);
    // Both tokens share their first 72 bytes; bcrypt would have matched them.
    expect(first.refresh_token.slice(0, 72)).toBe(second.refresh_token.slice(0, 72));

    await expect(
      fixture.service.refreshToken(first.refresh_token, AppType.OWNER_APP),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      fixture.service.refreshToken(second.refresh_token, AppType.OWNER_APP),
    ).resolves.toMatchObject({ refresh_token: expect.any(String) });
  });

  it('rejects an unknown appType', async () => {
    const fixture = createFixture();
    const pair = (await fixture.service.login(fixture.account as never, AppType.OWNER_APP)) as {
      refresh_token: string;
    };

    await expect(
      fixture.service.refreshToken(pair.refresh_token, 'ADMIN_APP' as AppType),
    ).rejects.toMatchObject({ status: 400 });
  });
});
