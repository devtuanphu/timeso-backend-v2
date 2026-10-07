import { FindOperator } from 'typeorm';

import {
  EmployeeProfile,
  EmploymentStatus,
} from '../../../../src/modules/stores/entities/employee-profile.entity';
import { AccountsService } from '../../../../src/modules/accounts/accounts.service';

/**
 * In-memory stand-in for `employeeProfileRepository.find` that honours the
 * `employmentStatus: In([...])` operator, so the test proves the query itself
 * excludes non-employed profiles rather than a post-filter.
 */
const buildRepository = (profiles: Partial<EmployeeProfile>[]) => ({
  find: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
    profiles.filter((profile) => {
      if (profile.accountId !== where.accountId) return false;
      const status = where.employmentStatus as FindOperator<string[]> | undefined;
      if (!status) return true;
      return (status.value as string[]).includes(profile.employmentStatus as string);
    }),
  ),
});

const buildService = (repository: ReturnType<typeof buildRepository>) =>
  new AccountsService({} as any, {} as any, {} as any, repository as any);

describe('AccountsService.getEmployeeStores', () => {
  it('returns [] for a PENDING applicant, then the store once accepted', async () => {
    const profile: Partial<EmployeeProfile> = {
      id: 'profile-1',
      accountId: 'acc-1',
      storeId: 'store-1',
      store: { name: 'Cửa hàng 1', avatarUrl: null } as any,
      employmentStatus: EmploymentStatus.PENDING,
    };
    const repository = buildRepository([profile]);
    const service = buildService(repository);

    await expect(service.getEmployeeStores('acc-1')).resolves.toEqual([]);

    profile.employmentStatus = EmploymentStatus.PROBATION;

    await expect(service.getEmployeeStores('acc-1')).resolves.toEqual([
      expect.objectContaining({
        employeeProfileId: 'profile-1',
        storeId: 'store-1',
        storeName: 'Cửa hàng 1',
        employmentStatus: EmploymentStatus.PROBATION,
      }),
    ]);
  });

  it('keeps active / probation / on_leave and drops pending / terminated', async () => {
    const statuses = Object.values(EmploymentStatus);
    const repository = buildRepository(
      statuses.map((status, index) => ({
        id: `p-${status}`,
        accountId: 'acc-1',
        storeId: `store-${index}`,
        employmentStatus: status,
      })),
    );

    const result = await buildService(repository).getEmployeeStores('acc-1');

    expect(result.map((row) => row.employmentStatus).sort()).toEqual(
      [
        EmploymentStatus.ACTIVE,
        EmploymentStatus.ON_LEAVE,
        EmploymentStatus.PROBATION,
      ].sort(),
    );
  });
});

describe('AccountsService.setAvatarIfEmpty', () => {
  const build = (affected: number) => {
    const qb: any = {};
    for (const method of ['update', 'set', 'where', 'andWhere']) {
      qb[method] = jest.fn(() => qb);
    }
    qb.execute = jest.fn().mockResolvedValue({ affected });
    const accountRepository = { createQueryBuilder: jest.fn(() => qb) };
    const service = new AccountsService(
      accountRepository as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, qb };
  };

  it('writes only when the avatar is still empty (conditional in SQL)', async () => {
    const { service, qb } = build(1);

    await expect(
      service.setAvatarIfEmpty('acc-1', '/uploads/a.jpg'),
    ).resolves.toBe(true);
    expect(qb.set).toHaveBeenCalledWith({ avatar: '/uploads/a.jpg' });
    expect(qb.where).toHaveBeenCalledWith('id = :accountId', { accountId: 'acc-1' });
    expect(qb.andWhere).toHaveBeenCalledWith(
      "(avatar IS NULL OR btrim(avatar) = '')",
    );
  });

  it('reports false when an avatar already exists', async () => {
    const { service } = build(0);
    await expect(
      service.setAvatarIfEmpty('acc-1', '/uploads/a.jpg'),
    ).resolves.toBe(false);
  });
});
