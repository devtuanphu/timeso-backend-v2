import { StoresService } from './stores.service';
import { AccountStatus } from '../accounts/entities/account.entity';
import { EmploymentStatus } from './entities/employee-profile.entity';

const STORE = 'store-1';
const OWNER = 'owner-1';
const ACCOUNT = 'account-1';

describe('findExistingEmployeeCandidate — former employees', () => {
  const build = (profiles: any[]) => {
    const service = Object.create(StoresService.prototype) as any;
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
});
