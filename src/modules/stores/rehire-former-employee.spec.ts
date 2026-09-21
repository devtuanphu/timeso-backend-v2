import { StoresService } from './stores.service';
import { JobApplicationService } from './job-application.service';
import { EmploymentStatus } from './entities/employee-profile.entity';

/**
 * Removing an employee soft-deletes their profile, which the owner sees in the
 * deleted list. That stint is over, so the person may apply again and accepting
 * revives the original row instead of creating a second one.
 */
const STORE = 'store-1';
const ACCOUNT = 'account-1';

describe('loadFormerEmployment', () => {
  const build = (profiles: unknown[], summaryRows: unknown[] = []) => {
    const service = Object.create(JobApplicationService.prototype) as any;
    const builder: any = {
      withDeleted: jest.fn(() => builder),
      leftJoinAndSelect: jest.fn(() => builder),
      where: jest.fn(() => builder),
      andWhere: jest.fn(() => builder),
      getMany: jest.fn().mockResolvedValue(profiles),
    };
    // The attendance roll-up runs through the profile repository's manager, so
    // the service needs no extra constructor argument.
    const summaryBuilder: any = {
      select: jest.fn(() => summaryBuilder),
      addSelect: jest.fn(() => summaryBuilder),
      where: jest.fn(() => summaryBuilder),
      groupBy: jest.fn(() => summaryBuilder),
      getRawMany: jest.fn().mockResolvedValue(summaryRows),
    };
    service.profileRepository = {
      createQueryBuilder: jest.fn(() => builder),
      manager: {
        getRepository: jest.fn(() => ({
          createQueryBuilder: jest.fn(() => summaryBuilder),
        })),
      },
    };
    return { service, builder, summaryBuilder };
  };

  const profile = (over: Record<string, unknown> = {}) => ({
    id: 'profile-1',
    accountId: ACCOUNT,
    storeId: STORE,
    employmentStatus: EmploymentStatus.TERMINATED,
    joinedAt: new Date('2026-01-05T00:00:00Z'),
    leftAt: new Date('2026-09-14T00:00:00Z'),
    deletedAt: null,
    ...over,
  });

  it('reports a terminated stint with its reason', async () => {
    const { service } = build([
      profile({ terminationReason: { name: 'Hết hạn hợp đồng' } }),
    ]);

    const found = await service.loadFormerEmployment(STORE, [ACCOUNT]);

    expect(found.get(ACCOUNT)).toMatchObject({
      joinedAt: '2026-01-05T00:00:00.000Z',
      leftAt: '2026-09-14T00:00:00.000Z',
      terminationReason: 'Hết hạn hợp đồng',
    });
  });

  // pg returns SUM as a string; printing "142" as "142" and not NaN depends
  // on coercing here.
  it('sums the past attendance across monthly rows', async () => {
    const { service } = build(
      [profile({ id: 'profile-1' })],
      [
        {
          profileId: 'profile-1',
          completedShifts: '142',
          lateArrivals: '3',
          unauthorizedLeaves: '0',
        },
      ],
    );

    const found = await service.loadFormerEmployment(STORE, [ACCOUNT]);

    expect(found.get(ACCOUNT)?.record).toEqual({
      completedShifts: 142,
      lateArrivals: 3,
      unauthorizedLeaves: 0,
    });
  });

  // No summary rows must not read as a perfect record of zeroes.
  it('leaves the record null when the stint produced no summaries', async () => {
    const { service } = build([profile({ id: 'profile-1' })], []);

    const found = await service.loadFormerEmployment(STORE, [ACCOUNT]);

    expect(found.get(ACCOUNT)?.record).toBeNull();
  });

  // Removing someone from the list only soft-deletes them; that still ends the
  // stint, and it is the case the owner's badge exists for.
  it('counts a soft-deleted profile as a finished stint', async () => {
    const { service } = build([
      profile({
        employmentStatus: EmploymentStatus.ACTIVE,
        leftAt: null,
        deletedAt: new Date('2026-09-14T00:00:00Z'),
      }),
    ]);

    const found = await service.loadFormerEmployment(STORE, [ACCOUNT]);

    expect(found.get(ACCOUNT)?.leftAt).toBe('2026-09-14T00:00:00.000Z');
  });

  it('ignores someone still employed', async () => {
    const { service } = build([
      profile({ employmentStatus: EmploymentStatus.ACTIVE, leftAt: null }),
    ]);

    expect((await service.loadFormerEmployment(STORE, [ACCOUNT])).size).toBe(0);
  });

  // One query per page, not one per applicant.
  it('does not query at all for an empty page', async () => {
    const { service } = build([]);

    await service.loadFormerEmployment(STORE, []);

    expect(service.profileRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('includes soft-deleted rows in the lookup', async () => {
    const { service, builder } = build([profile()]);

    await service.loadFormerEmployment(STORE, [ACCOUNT]);

    expect(builder.withDeleted).toHaveBeenCalled();
  });
});

describe('initializeEmployeeProfile — khôi phục hồ sơ cũ', () => {
  const build = () => {
    const service = Object.create(StoresService.prototype) as any;
    service.assertEmployeeReferences = jest.fn().mockResolvedValue(undefined);
    service.createContract = jest.fn().mockResolvedValue(undefined);
    const saved: Record<string, unknown>[] = [];
    // The method carries on past the profile save into payroll scaffolding;
    // those repositories are stubbed so the assertion above can be reached.
    const stubRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => data),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    const manager: any = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn(() => stubRepository),
      query: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      insert: jest.fn().mockResolvedValue({ identifiers: [] }),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
      save: jest.fn(async (_entity: unknown, data: Record<string, unknown>) => {
        saved.push(data);
        return { id: (data.id as string) ?? 'new-profile', ...data };
      }),
    };
    return { service, manager, saved };
  };

  // The bug this guards: saving the hire fields alone left `deleted_at` set, so
  // the rehired employee stayed in the deleted list and never reappeared in the
  // store's own employee list.
  it('clears the departure markers when reviving a profile', async () => {
    const { service, manager, saved } = build();

    await service.initializeEmployeeProfile(manager, STORE, ACCOUNT, {} as any, 'old-profile');

    expect(saved[0]).toMatchObject({
      id: 'old-profile',
      deletedAt: null,
      leftAt: null,
      terminationReasonId: null,
    });
  });

  it('does not touch those fields for a brand new hire', async () => {
    const { service, manager, saved } = build();

    await service.initializeEmployeeProfile(manager, STORE, ACCOUNT, {} as any);

    expect(saved[0]).not.toHaveProperty('deletedAt');
    expect(saved[0]).not.toHaveProperty('leftAt');
  });

  // C: tenure counts from the hire. A revived row gets its own entry event,
  // so days in rung no longer count from the previous stint (or stay 0).
  it('records an entry career event for a revived profile', async () => {
    const { service, manager, saved } = build();
    manager.find.mockImplementation(async (entity: any) =>
      entity?.name === 'StoreLadder'
        ? [{ id: 'ladder-type', dimension: 'employment_type' }]
        : [],
    );
    manager.findOne.mockImplementation(async (entity: any) =>
      entity?.name === 'StoreLadderRung' ? { id: 'rung-official' } : null,
    );

    await service.initializeEmployeeProfile(
      manager,
      STORE,
      ACCOUNT,
      { employeeTypeId: 'type-official' } as any,
      'old-profile',
    );

    const event = saved.find((row) => row.toRungId === 'rung-official');
    expect(event).toMatchObject({
      employeeProfileId: 'old-profile',
      ladderId: 'ladder-type',
      fromRungId: null,
      note: 'Vào làm',
      effectiveAt: expect.any(Date),
    });
  });
});
