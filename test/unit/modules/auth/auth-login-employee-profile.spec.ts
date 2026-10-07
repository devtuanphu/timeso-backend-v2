jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

import { FindOperator } from 'typeorm';

import { AppType } from '../../../../src/modules/accounts/entities/account-refresh-token.entity';
import { EmploymentStatus } from '../../../../src/modules/stores/entities/employee-profile.entity';
import { AuthService } from '../../../../src/modules/auth/auth.service';

const account = {
  id: 'account-1',
  email: 'staff@example.test',
  phone: '0000000000',
  status: 'active',
  passwordHash: 'test-password-hash',
};

const createService = (profile: Record<string, unknown> | null) => {
  const jwtService = {
    sign: jest.fn().mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token'),
    decode: jest.fn().mockReturnValue({ exp: 2_000_000_000 }),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'test-access-secret';
      if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
      if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
      return undefined;
    }),
  };
  const refreshTokenRepository = {
    create: jest.fn((value) => value),
    save: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const employeeProfileRepository = {
    findOne: jest.fn().mockResolvedValue(profile),
  };
  const storesService = {
    ensureDailyReportsForOwner: jest.fn().mockResolvedValue(undefined),
    ensureDailyReportForStore: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AuthService(
    { findById: jest.fn() } as any,
    jwtService as any,
    configService as any,
    refreshTokenRepository as any,
    {} as any,
    employeeProfileRepository as any,
    {} as any,
    {} as any,
    storesService as any,
    {} as any,
  );
  return { service, employeeProfileRepository, storesService };
};

describe('AuthService staff login store selection', () => {
  it('queries only employed profiles with a deterministic order', async () => {
    const { service, employeeProfileRepository } = createService(null);

    await service.login(account, AppType.EMPLOYEE_APP);

    const options = employeeProfileRepository.findOne.mock.calls[0][0];
    const status = options.where.employmentStatus as FindOperator<string[]>;
    expect(options.where.accountId).toBe(account.id);
    expect(status.type).toBe('in');
    expect(status.value).toEqual([
      EmploymentStatus.ACTIVE,
      EmploymentStatus.PROBATION,
      EmploymentStatus.ON_LEAVE,
    ]);
    expect(options.order).toEqual({
      joinedAt: { direction: 'DESC', nulls: 'LAST' },
      updatedAt: 'DESC',
      id: 'ASC',
    });
  });

  it('a PENDING-only applicant gets no store and no daily-report ensure', async () => {
    // The whitelist query finds nothing for an account whose only profile is pending.
    const { service, storesService } = createService(null);

    const result: any = await service.login(account, AppType.EMPLOYEE_APP);
    await Promise.resolve();

    expect(result.user.storeId).toBeUndefined();
    expect(result.user.employeeProfileId).toBeUndefined();
    expect(storesService.ensureDailyReportForStore).not.toHaveBeenCalled();
  });

  it('an employed profile yields its store and ensures the daily report', async () => {
    const { service, storesService } = createService({
      id: 'profile-1',
      storeId: 'store-1',
      store: { name: 'Cửa hàng 1' },
      employmentStatus: EmploymentStatus.ACTIVE,
    });

    const result: any = await service.login(account, AppType.EMPLOYEE_APP);
    await Promise.resolve();

    expect(result.user).toMatchObject({
      employeeProfileId: 'profile-1',
      storeId: 'store-1',
      storeName: 'Cửa hàng 1',
      employmentStatus: EmploymentStatus.ACTIVE,
    });
    expect(storesService.ensureDailyReportForStore).toHaveBeenCalledWith('store-1');
  });
});
