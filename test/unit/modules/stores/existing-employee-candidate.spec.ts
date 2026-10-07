import { StoresService } from '../../../../src/modules/stores/stores.service';
import { AccountStatus } from '../../../../src/modules/accounts/entities/account.entity';
import { EmploymentStatus } from '../../../../src/modules/stores/entities/employee-profile.entity';

const STORE = 'store-1';
const OWNER = 'owner-1';
const ACCOUNT = 'account-1';

describe('findExistingEmployeeCandidate — former employees', () => {
  const build = (profiles: any[], application: any = null) => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = { warn: jest.fn() };
    const applications = { findOne: jest.fn().mockResolvedValue(application) };
    service.dataSource = { getRepository: jest.fn(() => applications) };
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue({});
    service.accountsService = {
      findByPhone: jest.fn().mockResolvedValue({
        id: ACCOUNT,
        status: AccountStatus.ACTIVE,
        fullName: 'Nguyễn Văn A',
        avatar: '/uploads/a.jpg',
        phone: '0900000000',
      }),
    };
    const builder: any = {
      withDeleted: jest.fn(() => builder),
      where: jest.fn(() => builder),
      getMany: jest.fn().mockResolvedValue(profiles),
    };
    service.profileRepository = { createQueryBuilder: jest.fn(() => builder) };
    return service;
  };

  const profile = (over: Record<string, unknown> = {}) => ({
    id: 'profile-1',
    accountId: ACCOUNT,
    storeId: STORE,
    employmentStatus: EmploymentStatus.TERMINATED,
    leftAt: new Date('2026-09-14T03:00:00.000Z'),
    deletedAt: new Date('2026-09-14T03:00:00.000Z'),
    ...over,
  });

  const lookup = (service: any) =>
    service.findExistingEmployeeCandidate(STORE, OWNER, '0900000000');

  it('allows a terminated employee and reports when they left', async () => {
    const result = await lookup(build([profile()]));

    expect(result).toMatchObject({
      eligible: true,
      account: { id: ACCOUNT },
      formerEmployee: { leftAt: '2026-09-14T03:00:00.000Z' },
    });
  });

  it('falls back to deletedAt for a soft-deleted profile without leftAt', async () => {
    const result = await lookup(
      build([
        profile({
          leftAt: null,
          deletedAt: new Date('2026-09-01T00:00:00.000Z'),
        }),
      ]),
    );

    expect(result).toMatchObject({
      eligible: true,
      formerEmployee: { leftAt: '2026-09-01T00:00:00.000Z' },
    });
  });

  // Same rule as attachExistingEmployee: an employed status anywhere blocks
  // the hire, so the lookup must not offer what the attach would refuse.
  it('refuses a soft-deleted row that still carries an employed status', async () => {
    const result = await lookup(
      build([
        profile({
          employmentStatus: EmploymentStatus.ACTIVE,
          leftAt: null,
          deletedAt: new Date('2026-09-01T00:00:00.000Z'),
        }),
      ]),
    );

    expect(result).toEqual({ eligible: false });
  });

  it('refuses a live PENDING applicant at this store', async () => {
    const result = await lookup(
      build([
        profile({
          employmentStatus: EmploymentStatus.PENDING,
          leftAt: null,
          deletedAt: null,
        }),
      ]),
    );

    expect(result).toEqual({ eligible: false });
  });

  it('refuses someone employed at another store', async () => {
    const result = await lookup(
      build([
        profile({
          storeId: 'store-2',
          employmentStatus: EmploymentStatus.ACTIVE,
          leftAt: null,
          deletedAt: null,
        }),
      ]),
    );

    expect(result).toEqual({ eligible: false });
  });

  it('refuses a former employee here who is now employed elsewhere', async () => {
    const result = await lookup(
      build([
        profile(),
        profile({
          id: 'profile-2',
          storeId: 'store-2',
          employmentStatus: EmploymentStatus.ACTIVE,
          leftAt: null,
          deletedAt: null,
        }),
      ]),
    );

    expect(result).toEqual({ eligible: false });
  });

  it('reports formerEmployee null for someone with no history here', async () => {
    const result = await lookup(build([]));

    expect(result).toEqual({
      eligible: true,
      account: {
        id: ACCOUNT,
        fullName: 'Nguyễn Văn A',
        avatar: '/uploads/a.jpg',
        phone: '0900000000',
      },
      formerEmployee: null,
      selfieUrl: null,
    });
  });

  it('ignores a pending application at another store', async () => {
    const result = await lookup(
      build([
        profile({
          storeId: 'store-2',
          employmentStatus: EmploymentStatus.PENDING,
          leftAt: null,
          deletedAt: null,
        }),
      ]),
    );

    expect(result).toMatchObject({ eligible: true, formerEmployee: null });
  });

  describe('selfieUrl (additive)', () => {
    const SELFIE = '0f8fad5b-d9cb-469f-a165-70867728950e.jpg';

    it('is the selfie route of the latest live application at this store', async () => {
      const service = build([profile()], {
        id: 'app-1',
        storeId: STORE,
        selfiePath: SELFIE,
      });

      const result = await lookup(service);

      expect(result).toMatchObject({
        eligible: true,
        selfieUrl: `/api/stores/${STORE}/job-applications/app-1/selfie`,
      });
      const [{ where, order, select }] =
        service.dataSource.getRepository.mock.results[0].value.findOne.mock
          .calls[0];
      // This store and this account only; live statuses; not redacted.
      expect(where.storeId).toBe(STORE);
      expect(where.accountId).toBe(ACCOUNT);
      expect(where.status.value).toEqual(['PENDING', 'ACCEPTED']);
      expect(where.selfiePath.type).toBe('not');
      expect(where.contactRedactedAt.type).toBe('isNull');
      expect(order).toEqual({ createdAt: 'DESC' });
      expect(select).not.toContain('phone');
    });

    it('is null without a matching application (none, other store, cancelled or rejected)', async () => {
      // The query filters store and status; no row comes back.
      const result = await lookup(build([], null));
      expect(result).toMatchObject({ eligible: true, selfieUrl: null });
    });

    it('is null for an unsafe stored filename', async () => {
      const result = await lookup(
        build([], {
          id: 'app-1',
          storeId: STORE,
          selfiePath: '../../etc/passwd',
        }),
      );
      expect(result).toMatchObject({ eligible: true, selfieUrl: null });
    });

    it('a lookup failure yields null, not an error', async () => {
      const service = build([]);
      service.dataSource.getRepository = jest.fn(() => ({
        findOne: jest.fn().mockRejectedValue(new Error('db')),
      }));
      await expect(lookup(service)).resolves.toMatchObject({
        eligible: true,
        selfieUrl: null,
      });
    });

    it('is never added to an ineligible answer', async () => {
      const service = build(
        [
          profile({
            storeId: 'store-2',
            employmentStatus: EmploymentStatus.ACTIVE,
            leftAt: null,
            deletedAt: null,
          }),
        ],
        { id: 'app-1', storeId: STORE, selfiePath: SELFIE },
      );
      expect(await lookup(service)).toEqual({ eligible: false });
    });

    it('checks store ownership before reading applications', async () => {
      const service = build([], {
        id: 'app-1',
        storeId: STORE,
        selfiePath: SELFIE,
      });
      service.assertOwnerStoreAccess.mockRejectedValue(new Error('forbidden'));
      await expect(lookup(service)).rejects.toThrow('forbidden');
      expect(service.dataSource.getRepository).not.toHaveBeenCalled();
    });
  });
});
