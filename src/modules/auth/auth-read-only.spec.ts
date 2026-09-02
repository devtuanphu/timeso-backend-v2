jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

import * as bcrypt from 'bcrypt';

import { AppType } from '../accounts/entities/account-refresh-token.entity';
import { AuthService } from './auth.service';

const account = {
  id: 'account-1',
  email: 'owner@example.test',
  phone: '0000000000',
  status: 'active',
  passwordHash: 'test-password-hash',
};

const createService = (
  readOnlyValue?: string,
  legacyWindow: Record<string, string> = {},
) => {
  const jwtService = {
    sign: jest.fn().mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token'),
    verify: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'APP_READ_ONLY_MODE') return readOnlyValue;
      if (key === 'JWT_SECRET') return 'test-access-secret';
      if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
      if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
      if (key in legacyWindow) return legacyWindow[key];
      return undefined;
    }),
  };
  const refreshTokenRepository = {
    create: jest.fn((value) => value),
    save: jest.fn().mockResolvedValue(undefined),
    find: jest.fn(),
  };
  const storesService = {
    ensureDailyReportsForOwner: jest.fn().mockResolvedValue(undefined),
    ensureDailyReportForStore: jest.fn().mockResolvedValue(undefined),
  };
  const accountsService = { findById: jest.fn().mockResolvedValue(account) };
  const service = new AuthService(
    accountsService as any,
    jwtService as any,
    configService as any,
    refreshTokenRepository as any,
    {} as any,
    { findOne: jest.fn() } as any,
    {} as any,
    {} as any,
    storesService as any,
  );

  return { service, jwtService, refreshTokenRepository, storesService };
};

describe('AuthService login in read-only mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-refresh-token');
  });

  it('issues a token pair without persisting or ensuring reports', async () => {
    const { service, jwtService, refreshTokenRepository, storesService } =
      createService('true');

    const result = await service.login(account, AppType.OWNER_APP);

    expect(result).toEqual({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      user: {
        id: account.id,
        email: account.email,
        phone: account.phone,
        status: account.status,
      },
    });
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(refreshTokenRepository.create).not.toHaveBeenCalled();
    expect(refreshTokenRepository.save).not.toHaveBeenCalled();
    expect(storesService.ensureDailyReportsForOwner).not.toHaveBeenCalled();
    expect(jwtService.sign).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tokenUse: 'access' }),
    );
    expect(jwtService.sign).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tokenUse: 'refresh' }),
      expect.objectContaining({ secret: 'test-refresh-secret' }),
    );
  });

  it('keeps refresh-token persistence and report ensure enabled by default', async () => {
    const { service, refreshTokenRepository, storesService } = createService();

    await service.login(account, AppType.OWNER_APP);
    await Promise.resolve();

    expect(refreshTokenRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: account.id,
        tokenHash: 'hashed-refresh-token',
        appType: AppType.OWNER_APP,
      }),
    );
    expect(refreshTokenRepository.save).toHaveBeenCalledTimes(1);
    expect(storesService.ensureDailyReportsForOwner).toHaveBeenCalledWith(account.id);
  });

  it('rejects an access token presented to the refresh flow before DB lookup', async () => {
    const { service, jwtService, refreshTokenRepository } = createService('true');
    jwtService.verify.mockReturnValue({ sub: account.id, tokenUse: 'access' });

    await expect(
      service.refreshToken('access-token', AppType.OWNER_APP),
    ).rejects.toMatchObject({ status: 401 });
    expect(refreshTokenRepository.find).not.toHaveBeenCalled();
  });

  it('accepts a verified legacy untyped refresh token only in the bounded window', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-30T00:00:00Z'));
    const { service, jwtService, refreshTokenRepository } = createService('true', {
      JWT_LEGACY_UNTYPED_WINDOW_STARTED_AT: '2026-08-29T00:00:00Z',
      JWT_LEGACY_UNTYPED_CUTOFF_AT: '2026-09-05T00:00:00Z',
    });
    jwtService.verify.mockReturnValue({ sub: account.id });
    refreshTokenRepository.find.mockResolvedValue([
      { tokenHash: 'hash', revokedAt: null },
    ]);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    await expect(
      service.refreshToken('legacy-refresh', AppType.OWNER_APP),
    ).resolves.toMatchObject({ access_token: 'access-token' });
    jest.useRealTimers();
  });
});
