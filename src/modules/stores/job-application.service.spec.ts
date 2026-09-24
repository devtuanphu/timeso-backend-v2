import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { HttpException } from '@nestjs/common';

import { JobApplicationService } from './job-application.service';
import { JobApplicationStatus } from './entities/job-application.entity';
import { AccountStatus } from '../accounts/entities/account.entity';
import { EmploymentStatus } from './entities/employee-profile.entity';
import { StoreStatus } from './entities/store.entity';
import { NotificationType } from '../notifications/entities/notification.entity';

const APPLICANT = 'account-applicant';
const OWNER = 'account-owner';
const STORE = 'store-1';
const APPLICATION = 'application-1';

const form = {
  fullName: 'Nguyễn Văn A',
  phone: '0900000000',
  email: 'a@example.test',
  introduction: 'Xin chào',
};

function build() {
  const applicationRepository: any = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((value: any) => value),
    save: jest.fn(async (value: any) => ({
      id: APPLICATION,
      createdAt: new Date('2026-05-05T00:00:00Z'),
      reviewedAt: null,
      rejectionReason: null,
      ...value,
    })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    // Backs the per-account apply rate limit.
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn(),
  };
  const storeRepository: any = {
    findOne: jest.fn().mockResolvedValue({
      id: STORE,
      name: 'Cửa hàng A',
      status: StoreStatus.ACTIVE,
      ownerAccountId: OWNER,
    }),
  };
  const profileRepository: any = {
    // `apply` uses this twice: once for "employed anywhere" (getExists) and
    // once for "currently employed at THIS store" (getOne). The second query
    // no longer uses withDeleted — a finished stint must not bar a new
    // application — so the clauses it builds are captured for assertion.
    builtClauses: [] as string[],
    usedWithDeleted: false,
    createQueryBuilder: jest.fn(function (this: any) {
      const builder: any = {
        withDeleted: jest.fn(() => {
          profileRepository.usedWithDeleted = true;
          return builder;
        }),
        where: jest.fn((clause: string) => {
          profileRepository.builtClauses.push(clause);
          return builder;
        }),
        andWhere: jest.fn((clause: string) => {
          profileRepository.builtClauses.push(clause);
          return builder;
        }),
        getExists: jest.fn().mockResolvedValue(false),
        getOne: jest.fn().mockResolvedValue(null),
      };
      return builder;
    }),
    // `accept` checks whether the hire actually committed before compensating.
    findOne: jest.fn().mockResolvedValue(null),
    // `apply` opens the PENDING profile; `reject`/`withdraw` remove it again.
    create: jest.fn((row: any) => row),
    save: jest.fn().mockResolvedValue({ id: 'pending-profile-1' }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const accountsService: any = {
    findById: jest.fn().mockResolvedValue({
      id: APPLICANT,
      status: AccountStatus.ACTIVE,
    }),
    // Acceptance backfills the applicant's identity onto their account. Without
    // this the call threw and the service's own try/catch swallowed it, so the
    // backfill looked fine while doing nothing.
    update: jest.fn().mockResolvedValue({}),
  };
  const notificationsService: any = { create: jest.fn().mockResolvedValue({}) };
  const storesService: any = {
    // Real shape: getEmployeeById resolves to { profile, monthlySummary,
    // recentActivities } — there is no top-level id.
    addEmployee: jest.fn().mockResolvedValue({
      profile: { id: 'profile-1' },
      monthlySummary: null,
      recentActivities: [],
    }),
  };

  // Filesystem access is its own provider; the real one is covered by
  // job-application-selfie.spec.ts.
  const selfieStorage: any = {
    verify: jest.fn().mockResolvedValue(true),
    remove: jest.fn().mockResolvedValue(true),
    exists: jest.fn().mockResolvedValue(true),
    resolve: jest.fn((name: unknown) =>
      typeof name === 'string' && !name.includes('/') && !name.includes('..')
        ? `/private/selfies/${name}`
        : null,
    ),
  };

  const service = new JobApplicationService(
    applicationRepository,
    storeRepository,
    profileRepository,
    accountsService,
    notificationsService,
    storesService,
    selfieStorage,
  );
  return {
    service,
    selfieStorage,
    applicationRepository,
    storeRepository,
    profileRepository,
    accountsService,
    notificationsService,
    storesService,
  };
}

describe('JobApplicationService.apply', () => {
  it('creates a pending application and notifies the store owner', async () => {
    const t = build();
    const result = await t.service.apply(APPLICANT, STORE, form);

    expect(result.status).toBe(JobApplicationStatus.PENDING);
    expect(t.applicationRepository.save).toHaveBeenCalled();
    expect(t.notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: OWNER,
        title: 'Có nhân viên ứng tuyển',
        // The recruitment screen defaults to the job-postings tab, so the
        // deep link must name the candidates tab or the owner lands where the
        // applicant list is not mounted.
        actionUrl: '/(home)/recruitment?tab=candidates',
        metadata: expect.objectContaining({
          type: 'JOB_APPLICATION_SUBMITTED',
          // The owner app's push router reads `screen`.
          screen: '/(home)/recruitment?tab=candidates',
        }),
      }),
    );
  });

  // The invariant carried over from store discovery.
  it('refuses an account that already belongs to a store', async () => {
    const t = build();
    t.profileRepository.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getExists: jest.fn().mockResolvedValue(true),
    });
    await expect(t.service.apply(APPLICANT, STORE, form)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses a blocked account', async () => {
    const t = build();
    t.accountsService.findById.mockResolvedValue({
      id: APPLICANT,
      status: AccountStatus.BLOCKED,
    });
    await expect(t.service.apply(APPLICANT, STORE, form)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses an inactive store', async () => {
    const t = build();
    t.storeRepository.findOne.mockResolvedValue({
      id: STORE,
      name: 'X',
      status: 'inactive',
      ownerAccountId: OWNER,
    });
    await expect(t.service.apply(APPLICANT, STORE, form)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a second application while one is pending', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ id: APPLICATION });
    await expect(t.service.apply(APPLICANT, STORE, form)).rejects.toThrow(
      ConflictException,
    );
  });

  // The partial unique index is the authority under concurrency.
  it('maps a unique-violation race to the same conflict', async () => {
    const t = build();
    t.applicationRepository.save.mockRejectedValue({ code: '23505' });
    await expect(t.service.apply(APPLICANT, STORE, form)).rejects.toThrow(
      ConflictException,
    );
  });

  // Delivery must never decide whether the application was recorded.
  it('still succeeds when the notification fails', async () => {
    const t = build();
    t.notificationsService.create.mockRejectedValue(new Error('expo down'));
    await expect(t.service.apply(APPLICANT, STORE, form)).resolves.toEqual(
      expect.objectContaining({ status: JobApplicationStatus.PENDING }),
    );
  });
});

describe('JobApplicationService.apply — người từng làm việc', () => {
  /**
   * The production bug: `apply` rejected on *any* prior profile at the store,
   * soft-deleted rows included, so a former employee was locked out for good.
   * Every attempt came back 409 while the message told them to ask the owner
   * for a restore that no flow provided — and the app swallowed the 409, so
   * nothing was shown at all.
   */
  it('does not consult soft-deleted profiles', async () => {
    const t = build();

    await t.service.apply(APPLICANT, STORE, form);

    expect(t.profileRepository.usedWithDeleted).toBe(false);
  });

  it('narrows the store check to someone currently employed', async () => {
    const t = build();

    await t.service.apply(APPLICANT, STORE, form);

    expect(t.profileRepository.builtClauses).toContain(
      'profile.employmentStatus IN (:...employed)',
    );
  });

  it('still refuses someone who works there right now', async () => {
    const t = build();
    t.profileRepository.createQueryBuilder.mockImplementation(() => ({
      withDeleted: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getExists: jest.fn().mockResolvedValue(false),
      getOne: jest.fn().mockResolvedValue({ id: 'profile-1' }),
    }));

    await expect(t.service.apply(APPLICANT, STORE, form)).rejects.toMatchObject({
      response: { code: 'JOB_APPLICATION_ALREADY_EMPLOYED' },
    });
  });
});

describe('JobApplicationService — hồ sơ PENDING', () => {
  it('opens a pending profile at the store as soon as the form is sent', async () => {
    const t = build();

    await t.service.apply(APPLICANT, STORE, form);

    expect(t.profileRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: STORE,
        accountId: APPLICANT,
        employmentStatus: EmploymentStatus.PENDING,
      }),
    );
  });

  // Every employee list reads account.fullName, so the name has to land there
  // at apply time for the pending profile to be identifiable at all.
  it('writes the applied name onto an account that has none', async () => {
    const t = build();
    t.accountsService.findById.mockResolvedValue({
      id: APPLICANT,
      status: AccountStatus.ACTIVE,
      fullName: null,
    });

    await t.service.apply(APPLICANT, STORE, form);

    expect(t.accountsService.update).toHaveBeenCalledWith(APPLICANT, {
      fullName: form.fullName,
    });
  });

  // The application is the durable record; a placeholder profile is not worth
  // losing a submission over.
  it('still accepts the application when the profile cannot be opened', async () => {
    const t = build();
    t.profileRepository.save.mockRejectedValue(new Error('profile write failed'));

    await expect(t.service.apply(APPLICANT, STORE, form)).resolves.toMatchObject({
      status: JobApplicationStatus.PENDING,
    });
  });

  // `apply` refuses a new application whenever any profile for this
  // (store, account) exists, soft-deleted included — so this must be a hard
  // delete or a rejected applicant could never re-apply.
  it.each([
    ['reject', (t: any) => t.service.reject(STORE, APPLICATION, OWNER, {})],
    ['withdraw', (t: any) => t.service.withdraw(STORE, APPLICATION, APPLICANT)],
  ])('removes the pending profile on %s', async (_label, act) => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({
      id: APPLICATION,
      storeId: STORE,
      accountId: APPLICANT,
      status: JobApplicationStatus.PENDING,
      createdAt: new Date('2026-05-05T00:00:00Z'),
      fullName: form.fullName,
      phone: form.phone,
      email: null,
      introduction: null,
      reviewedAt: null,
      rejectionReason: null,
    });

    await act(t);

    expect(t.profileRepository.delete).toHaveBeenCalledWith({
      storeId: STORE,
      accountId: APPLICANT,
      employmentStatus: EmploymentStatus.PENDING,
    });
  });
});

describe('JobApplicationService.accept', () => {
  const pending = {
    id: APPLICATION,
    storeId: STORE,
    accountId: APPLICANT,
    phone: form.phone,
    fullName: form.fullName,
    status: JobApplicationStatus.PENDING,
    createdAt: new Date('2026-05-05T00:00:00Z'),
    reviewedAt: null,
    rejectionReason: null,
    email: null,
    introduction: null,
  };

  // EmployeeProfile stores no name: every employee list reads account.fullName.
  // A phone-only signup has none, so without this backfill a hire made through
  // this flow showed up nameless in the owner's employee list.
  it('fills the applicant name onto an account that has none', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({
      ...pending,
      gender: 'Nữ',
      birthday: '1999-03-02',
    });
    t.accountsService.findById.mockResolvedValue({
      id: APPLICANT,
      status: AccountStatus.ACTIVE,
      fullName: null,
      gender: null,
      birthday: null,
    });

    await t.service.accept(STORE, APPLICATION, OWNER, {} as any);

    expect(t.accountsService.update).toHaveBeenCalledWith(APPLICANT, {
      fullName: form.fullName,
      gender: 'Nữ',
      birthday: '1999-03-02',
    });
  });

  // What the account already holds was set by its owner and outranks anything
  // typed into an application form.
  it('never overwrites identity the account already has', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({
      ...pending,
      gender: 'Nữ',
      birthday: '1999-03-02',
    });
    t.accountsService.findById.mockResolvedValue({
      id: APPLICANT,
      status: AccountStatus.ACTIVE,
      fullName: 'Tên Đã Có',
      gender: 'Nam',
      birthday: '1990-01-01',
    });

    await t.service.accept(STORE, APPLICATION, OWNER, {} as any);

    expect(t.accountsService.update).not.toHaveBeenCalled();
  });

  // A blank-but-present name is as useless as a missing one.
  it('treats a whitespace-only account name as missing', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...pending });
    t.accountsService.findById.mockResolvedValue({
      id: APPLICANT,
      status: AccountStatus.ACTIVE,
      fullName: '   ',
    });

    await t.service.accept(STORE, APPLICATION, OWNER, {} as any);

    expect(t.accountsService.update).toHaveBeenCalledWith(APPLICANT, {
      fullName: form.fullName,
    });
  });

  // The hire has already committed; a bookkeeping failure must not undo it.
  it('still reports a successful hire when the backfill throws', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...pending });
    t.accountsService.findById.mockResolvedValue({
      id: APPLICANT,
      status: AccountStatus.ACTIVE,
      fullName: null,
    });
    t.accountsService.update.mockRejectedValue(new Error('account write failed'));

    await expect(
      t.service.accept(STORE, APPLICATION, OWNER, {} as any),
    ).resolves.toMatchObject({ status: JobApplicationStatus.ACCEPTED });
  });

  it('hires through the existing attach flow and notifies the applicant', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...pending });

    const result = await t.service.accept(STORE, APPLICATION, OWNER, {
      storeRoleId: undefined,
    } as any);

    // The hire response is deliberately narrow: the full employee payload
    // carries the applicant's ID document and bank details.
    expect(result).toEqual({
      applicationId: APPLICATION,
      status: JobApplicationStatus.ACCEPTED,
      employeeProfileId: 'profile-1',
      rehire: null,
    });
    expect(t.applicationRepository.update).toHaveBeenCalledWith(
      { id: APPLICATION },
      { employeeProfileId: 'profile-1' },
    );
    // The hire is keyed on the authenticated applicant account, never on the
    // phone number typed into the application form.
    expect(t.storesService.addEmployee).toHaveBeenCalledWith(
      STORE,
      APPLICANT,
      expect.anything(),
      OWNER,
    );
    expect(t.notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: APPLICANT,
        title: 'Chúc mừng bạn đã ứng tuyển thành công',
      }),
    );
  });

  it('passes the rehire outcome through when a former employee is revived', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...pending });
    t.storesService.addEmployee.mockResolvedValue({
      profile: { id: 'profile-1' },
      rehire: { revived: true, currentMonthPayslipLocked: true },
    });

    const result = await t.service.accept(STORE, APPLICATION, OWNER, {} as any);

    expect(result).toMatchObject({
      employeeProfileId: 'profile-1',
      rehire: { revived: true, currentMonthPayslipLocked: true },
    });
  });

  // Regression: an applicant can type any phone number into the form. If that
  // value selected the account to attach, accepting would enrol a third party.
  it('ignores the form phone and hires the applicant account', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({
      ...pending,
      phone: '0988888888', // someone else's number
    });

    await t.service.accept(STORE, APPLICATION, OWNER, {} as any);

    const [, attachedAccountId] = t.storesService.addEmployee.mock.calls[0];
    expect(attachedAccountId).toBe(APPLICANT);
  });

  it('refuses a caller who does not own the store', async () => {
    const t = build();
    await expect(
      t.service.accept(STORE, APPLICATION, 'someone-else', {} as any),
    ).rejects.toThrow(ForbiddenException);
    expect(t.storesService.addEmployee).not.toHaveBeenCalled();
  });

  it('refuses an application belonging to another store', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({
      ...pending,
      storeId: 'store-2',
    });
    await expect(
      t.service.accept(STORE, APPLICATION, OWNER, {} as any),
    ).rejects.toThrow(NotFoundException);
  });

  // Double-tap: the claim update affects zero rows the second time.
  it('rejects a concurrent second accept instead of hiring twice', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...pending });
    t.applicationRepository.update.mockResolvedValue({ affected: 0 });

    await expect(
      t.service.accept(STORE, APPLICATION, OWNER, {} as any),
    ).rejects.toThrow(ConflictException);
    expect(t.storesService.addEmployee).not.toHaveBeenCalled();
  });

  it('releases the claim when hiring fails so the owner can retry', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...pending });
    t.storesService.addEmployee.mockRejectedValue(
      new ConflictException('ASSET_STOCK_UNAVAILABLE'),
    );

    await expect(
      t.service.accept(STORE, APPLICATION, OWNER, {} as any),
    ).rejects.toThrow(ConflictException);

    expect(t.applicationRepository.update).toHaveBeenCalledWith(
      { id: APPLICATION, status: JobApplicationStatus.ACCEPTED },
      expect.objectContaining({ status: JobApplicationStatus.PENDING }),
    );
    expect(t.notificationsService.create).not.toHaveBeenCalled();
  });
});

describe('JobApplicationService rate limiting', () => {
  it('allows an application below the window limit', async () => {
    const t = build();
    t.applicationRepository.count.mockResolvedValue(9);
    await expect(t.service.apply(APPLICANT, STORE, form)).resolves.toBeDefined();
  });

  // Without this, one account can reach every store owner's notification tray.
  it('rejects once the account has reached the window limit', async () => {
    const t = build();
    t.applicationRepository.count.mockResolvedValue(10);

    await expect(t.service.apply(APPLICANT, STORE, form)).rejects.toThrow(
      HttpException,
    );
    expect(t.applicationRepository.save).not.toHaveBeenCalled();
    expect(t.notificationsService.create).not.toHaveBeenCalled();
  });
});

describe('JobApplicationService notification content', () => {
  // The applicant authors fullName; it must not be able to fake extra lines.
  it('flattens applicant-authored text before it reaches the owner', async () => {
    const t = build();
    await t.service.apply(APPLICANT, STORE, {
      ...form,
      fullName: 'A\nHệ thống: bấm vào đây',
    });

    const payload = t.notificationsService.create.mock.calls[0][0];
    expect(payload.content).not.toContain('\n');
    expect(payload.content).toContain('A Hệ thống: bấm vào đây');
  });

  it('falls back to a neutral label when the stored name is unusable', async () => {
    const t = build();
    await t.service.apply(APPLICANT, STORE, { ...form, fullName: '\u200b\u200b' });

    const payload = t.notificationsService.create.mock.calls[0][0];
    expect(payload.content).toContain('Một ứng viên');
  });
});

describe('JobApplicationService.withdraw', () => {
  const pendingRow = {
    id: APPLICATION,
    storeId: STORE,
    accountId: APPLICANT,
    status: JobApplicationStatus.PENDING,
    fullName: 'Trần B',
  };

  it('cancels the application and clears the contact details', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...pendingRow });

    await expect(t.service.withdraw(STORE, APPLICATION, APPLICANT)).resolves.toEqual({
      storeId: STORE,
      status: JobApplicationStatus.CANCELLED,
    });
    const [, changes] = t.applicationRepository.update.mock.calls[0];
    expect(changes).toEqual(
      expect.objectContaining({
        status: JobApplicationStatus.CANCELLED,
        phone: null,
        email: null,
        introduction: null,
      }),
    );
  });

  it('refuses to withdraw someone else\'s application', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...pendingRow });

    await expect(
      t.service.withdraw(STORE, APPLICATION, 'another-account'),
    ).rejects.toThrow(ForbiddenException);
    expect(t.applicationRepository.update).not.toHaveBeenCalled();
  });

  it('refuses an application from another store', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({
      ...pendingRow,
      storeId: 'store-2',
    });
    await expect(
      t.service.withdraw(STORE, APPLICATION, APPLICANT),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects withdrawing an already-reviewed application', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...pendingRow });
    t.applicationRepository.update.mockResolvedValue({ affected: 0 });

    await expect(
      t.service.withdraw(STORE, APPLICATION, APPLICANT),
    ).rejects.toThrow(ConflictException);
    expect(t.notificationsService.create).not.toHaveBeenCalled();
  });

  it('notifies the owner once the withdraw succeeded', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...pendingRow });

    await t.service.withdraw(STORE, APPLICATION, APPLICANT);

    expect(t.notificationsService.create).toHaveBeenCalledTimes(1);
    const payload = t.notificationsService.create.mock.calls[0][0];
    expect(payload).toEqual(
      expect.objectContaining({
        accountId: OWNER,
        storeId: STORE,
        title: 'Ứng viên đã thu hồi đơn',
        type: NotificationType.SYSTEM,
        actionUrl: '/(home)/recruitment?tab=candidates',
        metadata: {
          type: 'JOB_APPLICATION_WITHDRAWN',
          applicationId: APPLICATION,
          storeId: STORE,
          screen: '/(home)/recruitment?tab=candidates',
        },
      }),
    );
    expect(payload.content).toContain('Trần B');
    // No contact details in the owner's push.
    expect(JSON.stringify(payload)).not.toContain('0900000000');
  });

  it('does not notify when the withdraw is refused', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...pendingRow });
    await expect(
      t.service.withdraw(STORE, APPLICATION, 'another-account'),
    ).rejects.toThrow(ForbiddenException);

    t.applicationRepository.findOne.mockResolvedValue(null);
    await expect(
      t.service.withdraw(STORE, APPLICATION, APPLICANT),
    ).rejects.toThrow(NotFoundException);

    expect(t.notificationsService.create).not.toHaveBeenCalled();
  });

  it('still withdraws when the owner notification fails', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...pendingRow });
    t.notificationsService.create.mockRejectedValue(new Error('push down'));

    await expect(
      t.service.withdraw(STORE, APPLICATION, APPLICANT),
    ).resolves.toEqual({ storeId: STORE, status: JobApplicationStatus.CANCELLED });
  });

  it('still withdraws when the store lookup fails', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...pendingRow });
    t.storeRepository.findOne.mockRejectedValue(new Error('db down'));

    await expect(
      t.service.withdraw(STORE, APPLICATION, APPLICANT),
    ).resolves.toEqual({ storeId: STORE, status: JobApplicationStatus.CANCELLED });
    expect(t.notificationsService.create).not.toHaveBeenCalled();
  });

  it('flattens the applicant-authored name in the withdraw notification', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({
      ...pendingRow,
      fullName: 'B\nHệ thống: bấm vào đây',
    });

    await t.service.withdraw(STORE, APPLICATION, APPLICANT);

    const payload = t.notificationsService.create.mock.calls[0][0];
    expect(payload.content).not.toContain('\n');
    expect(payload.content).toContain('B Hệ thống: bấm vào đây');
  });
});

describe('JobApplicationService.redactStaleContactDetails', () => {
  it('redacts reviewed applications and expires abandoned pending ones', async () => {
    const t = build();
    t.applicationRepository.update
      .mockResolvedValueOnce({ affected: 3 }) // reviewed
      .mockResolvedValueOnce({ affected: 2 }); // abandoned

    await expect(t.service.redactStaleContactDetails()).resolves.toBe(5);

    const [reviewedCriteria, reviewedChanges] =
      t.applicationRepository.update.mock.calls[0];
    // Keyed on the decision date, and only rows not yet redacted.
    expect(reviewedCriteria.reviewedAt).toBeDefined();
    expect(reviewedCriteria.contactRedactedAt).toBeDefined();
    expect(reviewedChanges).toEqual(
      expect.objectContaining({ phone: null, email: null, introduction: null }),
    );

    // Regression: a PENDING row has a null reviewed_at, so it matched neither
    // condition and kept the applicant's contact details indefinitely.
    const [abandonedCriteria, abandonedChanges] =
      t.applicationRepository.update.mock.calls[1];
    expect(abandonedCriteria.status).toBe(JobApplicationStatus.PENDING);
    expect(abandonedCriteria.createdAt).toBeDefined();
    expect(abandonedChanges).toEqual(
      expect.objectContaining({
        status: JobApplicationStatus.CANCELLED,
        phone: null,
        email: null,
        introduction: null,
      }),
    );
  });

  it('reports zero when nothing is stale', async () => {
    const t = build();
    t.applicationRepository.update.mockResolvedValue({ affected: 0 });
    await expect(t.service.redactStaleContactDetails()).resolves.toBe(0);
  });

  // Regression: the redaction payload was an object literal, so `new Date()`
  // was evaluated once at module load and every row recorded the process
  // start time instead of the moment of redaction.
  it('stamps the redaction time per call, not once per process', async () => {
    const t = build();
    t.applicationRepository.update.mockResolvedValue({ affected: 1 });

    await t.service.redactStaleContactDetails();
    const first = t.applicationRepository.update.mock.calls[0][1]
      .contactRedactedAt as Date;

    await new Promise((resolve) => setTimeout(resolve, 5));

    t.applicationRepository.update.mockClear();
    await t.service.redactStaleContactDetails();
    const second = t.applicationRepository.update.mock.calls[0][1]
      .contactRedactedAt as Date;

    expect(second.getTime()).toBeGreaterThan(first.getTime());
  });
});

describe('JobApplicationService.reject', () => {
  it('clears the contact details when the decision is made', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({
      id: APPLICATION,
      storeId: STORE,
      accountId: APPLICANT,
      status: JobApplicationStatus.PENDING,
      createdAt: new Date('2026-05-05T00:00:00Z'),
      reviewedAt: null,
      rejectionReason: null,
      fullName: form.fullName,
      phone: form.phone,
      email: null,
      introduction: null,
    });

    await t.service.reject(STORE, APPLICATION, OWNER, { reason: 'Chưa phù hợp' });

    const [, changes] = t.applicationRepository.update.mock.calls[0];
    expect(changes).toEqual(
      expect.objectContaining({
        status: JobApplicationStatus.REJECTED,
        phone: null,
        email: null,
        introduction: null,
      }),
    );
  });
});

describe('JobApplicationService.accept — hire committed before the failure', () => {
  const pendingRow = {
    id: APPLICATION,
    storeId: STORE,
    accountId: APPLICANT,
    phone: form.phone,
    fullName: form.fullName,
    status: JobApplicationStatus.PENDING,
    createdAt: new Date('2026-05-05T00:00:00Z'),
    reviewedAt: null,
    rejectionReason: null,
    email: null,
    introduction: null,
  };

  // Regression: `attachExistingEmployee` commits, then runs a large read to
  // build its response. A failure in that read used to be treated as "hiring
  // failed", so the claim was released while the applicant was already
  // employed — and every retry then hit EMPLOYEE_REHIRE_REQUIRES_RESTORE,
  // leaving the application permanently stuck and the applicant unnotified.
  it('completes the acceptance when the employee was already created', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...pendingRow });
    t.storesService.addEmployee.mockRejectedValue(new Error('read failed'));
    t.profileRepository.findOne.mockResolvedValue({ id: 'profile-created' });

    const result = await t.service.accept(STORE, APPLICATION, OWNER, {} as any);

    expect(result).toEqual(
      expect.objectContaining({
        status: JobApplicationStatus.ACCEPTED,
        employeeProfileId: 'profile-created',
      }),
    );
    // The claim must NOT be released.
    const revert = t.applicationRepository.update.mock.calls.find(
      ([, changes]: any[]) => changes?.status === JobApplicationStatus.PENDING,
    );
    expect(revert).toBeUndefined();
    // And the applicant must still be told.
    expect(t.notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: APPLICANT }),
    );
  });

  it('still releases the claim when no employee was created', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...pendingRow });
    t.storesService.addEmployee.mockRejectedValue(
      new ConflictException('ASSET_STOCK_UNAVAILABLE'),
    );
    t.profileRepository.findOne.mockResolvedValue(null);

    await expect(
      t.service.accept(STORE, APPLICATION, OWNER, {} as any),
    ).rejects.toThrow(ConflictException);

    expect(t.applicationRepository.update).toHaveBeenCalledWith(
      { id: APPLICATION, status: JobApplicationStatus.ACCEPTED },
      expect.objectContaining({ status: JobApplicationStatus.PENDING }),
    );
    expect(t.notificationsService.create).not.toHaveBeenCalled();
  });

  // Regression: a failure releasing the claim replaced the real cause with a
  // secondary error, hiding why the hire failed.
  it('surfaces the original error even if releasing the claim fails', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...pendingRow });
    t.storesService.addEmployee.mockRejectedValue(new Error('original cause'));
    t.profileRepository.findOne.mockResolvedValue(null);
    t.applicationRepository.update
      .mockResolvedValueOnce({ affected: 1 }) // the claim
      .mockRejectedValueOnce(new Error('release failed'));

    await expect(
      t.service.accept(STORE, APPLICATION, OWNER, {} as any),
    ).rejects.toThrow('original cause');
  });

  // Bookkeeping must not turn a successful hire into a reported failure.
  it('does not fail the hire when recording the link fails', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...pendingRow });
    t.applicationRepository.update
      .mockResolvedValueOnce({ affected: 1 }) // the claim
      .mockRejectedValueOnce(new Error('link write failed'));

    await expect(
      t.service.accept(STORE, APPLICATION, OWNER, {} as any),
    ).resolves.toEqual(
      expect.objectContaining({ status: JobApplicationStatus.ACCEPTED }),
    );
    expect(t.notificationsService.create).toHaveBeenCalled();
  });
});

describe('JobApplicationService.apply — prior history at the store', () => {
  // Regression: a terminated ex-employee could apply, but the attach flow
  // always refused with EMPLOYEE_REHIRE_REQUIRES_RESTORE — after the owner had
  // filled in the whole three-step hiring form.
  it('refuses an applicant who already has a profile at that store', async () => {
    const t = build();
    t.profileRepository.createQueryBuilder.mockReturnValue({
      withDeleted: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getExists: jest.fn().mockResolvedValue(false),
      getOne: jest.fn().mockResolvedValue({ id: 'old-profile' }),
    });

    await expect(t.service.apply(APPLICANT, STORE, form)).rejects.toThrow(
      ConflictException,
    );
    expect(t.applicationRepository.save).not.toHaveBeenCalled();
    expect(t.notificationsService.create).not.toHaveBeenCalled();
  });
});

describe('JobApplicationService.listMine', () => {
  it('returns the newest status per store', async () => {
    const t = build();
    t.applicationRepository.find.mockResolvedValue([
      {
        storeId: STORE,
        status: JobApplicationStatus.PENDING,
        createdAt: new Date('2026-05-06T00:00:00Z'),
      },
      {
        storeId: STORE,
        status: JobApplicationStatus.REJECTED,
        createdAt: new Date('2026-05-01T00:00:00Z'),
      },
      {
        storeId: 'store-2',
        status: JobApplicationStatus.ACCEPTED,
        createdAt: new Date('2026-05-02T00:00:00Z'),
      },
    ]);

    await expect(t.service.listMine(APPLICANT)).resolves.toEqual([
      expect.objectContaining({ storeId: STORE, status: JobApplicationStatus.PENDING }),
      expect.objectContaining({ storeId: 'store-2' }),
    ]);
  });
});

// ─── address + selfie ─────────────────────────────────────────────────────────

const SELFIE = '0b7c6a52-6a0e-4c47-9d3e-3f1c2b8e5a11.jpg';
const selfieFile = {
  filename: SELFIE,
  path: `uploads-private/job-application-selfies/${SELFIE}`,
  mimetype: 'image/jpeg',
  size: 1234,
};

describe('JobApplicationService.apply — address and selfie', () => {
  it('JSON apply still works: no selfie, address optional', async () => {
    const t = build();
    const item = await t.service.apply(APPLICANT, STORE, { ...form } as any);

    const created = t.applicationRepository.create.mock.calls[0][0];
    expect(created.selfiePath).toBeNull();
    expect(created.address).toBeNull();
    expect(item.selfieUrl).toBeNull();
    expect(item.address).toBeNull();
    expect(t.selfieStorage.verify).not.toHaveBeenCalled();
    expect(t.selfieStorage.remove).not.toHaveBeenCalled();
  });

  it('persists the address and the selfie filename with the application', async () => {
    const t = build();
    const item = await t.service.apply(
      APPLICANT,
      STORE,
      { ...form, address: '12 Lê Lợi, Q1' } as any,
      selfieFile,
    );

    expect(t.selfieStorage.verify).toHaveBeenCalledWith(selfieFile);
    const created = t.applicationRepository.create.mock.calls[0][0];
    expect(created.selfiePath).toBe(SELFIE);
    expect(created.address).toBe('12 Lê Lợi, Q1');
    expect(item.address).toBe('12 Lê Lợi, Q1');
    expect(item.selfieUrl).toBe(
      `/api/stores/${STORE}/job-applications/${APPLICATION}/selfie`,
    );
    expect(item.avatarUrl).toBeNull();
    expect(t.selfieStorage.remove).not.toHaveBeenCalled();
  });

  it('never puts the address or selfie into the owner notification', async () => {
    const t = build();
    await t.service.apply(
      APPLICANT,
      STORE,
      { ...form, address: '12 Lê Lợi, Q1' } as any,
      selfieFile,
    );
    const payload = JSON.stringify(t.notificationsService.create.mock.calls);
    expect(payload).not.toContain('Lê Lợi');
    expect(payload).not.toContain(SELFIE);
    expect(payload).not.toContain('selfie');
  });

  it('rejects content that fails the magic-byte check and deletes the file', async () => {
    const t = build();
    t.selfieStorage.verify.mockResolvedValue(false);

    await expect(
      t.service.apply(APPLICANT, STORE, { ...form } as any, selfieFile),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'JOB_APPLICATION_SELFIE_INVALID' }),
    });
    expect(t.applicationRepository.save).not.toHaveBeenCalled();
    expect(t.selfieStorage.remove).toHaveBeenCalledWith(SELFIE);
  });

  it('deletes the uploaded selfie when a business rule refuses the application', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({
      id: 'existing',
      status: JobApplicationStatus.PENDING,
    });

    await expect(
      t.service.apply(APPLICANT, STORE, { ...form } as any, selfieFile),
    ).rejects.toThrow(ConflictException);
    expect(t.selfieStorage.remove).toHaveBeenCalledWith(SELFIE);
  });

  it('deletes the uploaded selfie when the insert loses the duplicate race', async () => {
    const t = build();
    t.applicationRepository.save.mockRejectedValue({ code: '23505' });

    await expect(
      t.service.apply(APPLICANT, STORE, { ...form } as any, selfieFile),
    ).rejects.toThrow(ConflictException);
    expect(t.selfieStorage.remove).toHaveBeenCalledWith(SELFIE);
  });

  it('keeps the selfie once saved even if post-save bookkeeping fails', async () => {
    const t = build();
    t.profileRepository.save.mockRejectedValue(new Error('db down'));
    t.accountsService.findById
      .mockResolvedValueOnce({ id: APPLICANT, status: AccountStatus.ACTIVE })
      .mockRejectedValue(new Error('db down'));

    const item = await t.service.apply(APPLICANT, STORE, { ...form } as any, selfieFile);
    expect(item.selfieUrl).not.toBeNull();
    expect(t.selfieStorage.remove).not.toHaveBeenCalled();
  });
});

describe('JobApplicationService — selfie retention on withdraw and reject', () => {
  const rowWithSelfie = {
    id: APPLICATION,
    storeId: STORE,
    accountId: APPLICANT,
    status: JobApplicationStatus.PENDING,
    fullName: 'Trần B',
    address: '12 Lê Lợi',
    selfiePath: SELFIE,
    createdAt: new Date('2026-05-05T00:00:00Z'),
    reviewedAt: null,
    rejectionReason: null,
  };

  it('withdraw nulls address and selfie_path, then deletes the file', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...rowWithSelfie });
    const order: string[] = [];
    t.applicationRepository.update.mockImplementation(async () => {
      order.push('update');
      return { affected: 1 };
    });
    t.selfieStorage.remove.mockImplementation(async () => {
      order.push('remove');
      return true;
    });

    await t.service.withdraw(STORE, APPLICATION, APPLICANT);

    const [, changes] = t.applicationRepository.update.mock.calls[0];
    expect(changes).toEqual(
      expect.objectContaining({ address: null, selfiePath: null }),
    );
    expect(t.selfieStorage.remove).toHaveBeenCalledWith(SELFIE);
    expect(order).toEqual(['update', 'remove']);
  });

  it('a refused withdraw keeps the file', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...rowWithSelfie });
    t.applicationRepository.update.mockResolvedValue({ affected: 0 });

    await expect(
      t.service.withdraw(STORE, APPLICATION, APPLICANT),
    ).rejects.toThrow(ConflictException);
    expect(t.selfieStorage.remove).not.toHaveBeenCalled();
  });

  it('reject clears the address but keeps the selfie until retention', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...rowWithSelfie });

    await t.service.reject(STORE, APPLICATION, OWNER, {});

    const [, changes] = t.applicationRepository.update.mock.calls[0];
    expect(changes.address).toBeNull();
    expect('selfiePath' in changes).toBe(false);
    expect(t.selfieStorage.remove).not.toHaveBeenCalled();
  });
});

describe('JobApplicationService.redactStaleContactDetails — selfies', () => {
  it('clears each stale selfie with a conditional update, then deletes its file', async () => {
    const t = build();
    const other = '9d1f2e3a-1111-4222-8333-444455556666.png';
    t.applicationRepository.find.mockResolvedValueOnce([
      { id: 'a-1', selfiePath: SELFIE, reviewedAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'a-2', selfiePath: other, reviewedAt: null },
    ]);
    t.applicationRepository.update
      .mockResolvedValueOnce({ affected: 1 }) // a-1 selfie
      .mockResolvedValueOnce({ affected: 1 }) // a-2 selfie
      .mockResolvedValueOnce({ affected: 3 }) // reviewed
      .mockResolvedValueOnce({ affected: 2 }); // abandoned

    await expect(t.service.redactStaleContactDetails()).resolves.toBe(5);

    const [firstCriteria, firstChanges] = t.applicationRepository.update.mock.calls[0];
    expect(firstCriteria).toEqual(
      expect.objectContaining({ id: 'a-1', selfiePath: SELFIE, reviewedAt: expect.anything() }),
    );
    expect(firstChanges).toEqual({ selfiePath: null, address: null });
    const [secondCriteria] = t.applicationRepository.update.mock.calls[1];
    // Never reviewed: keyed on creation time, and still unreviewed at write time.
    expect(secondCriteria).toEqual(
      expect.objectContaining({ id: 'a-2', selfiePath: other, createdAt: expect.anything() }),
    );
    expect(t.selfieStorage.remove.mock.calls).toEqual([[SELFIE], [other]]);

    // Bulk redaction clears the address but leaves selfie_path to the pass above.
    for (const call of t.applicationRepository.update.mock.calls.slice(2)) {
      expect(call[1].address).toBeNull();
      expect('selfiePath' in call[1]).toBe(false);
    }
  });

  it('keeps the file when the row changed between read and write', async () => {
    const t = build();
    t.applicationRepository.find.mockResolvedValueOnce([
      { id: 'a-1', selfiePath: SELFIE, reviewedAt: null },
    ]);
    t.applicationRepository.update.mockResolvedValue({ affected: 0 });

    await t.service.redactStaleContactDetails();
    expect(t.selfieStorage.remove).not.toHaveBeenCalled();
  });
});

describe('JobApplicationService.getSelfie', () => {
  const row = {
    id: APPLICATION,
    storeId: STORE,
    accountId: APPLICANT,
    selfiePath: SELFIE,
  };
  const notFound = { status: 404 };

  it('lets the store owner read it', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...row });
    await expect(t.service.getSelfie(STORE, APPLICATION, OWNER)).resolves.toEqual({
      absolutePath: `/private/selfies/${SELFIE}`,
      contentType: 'image/jpeg',
    });
  });

  it('lets the applicant read their own without an owner lookup', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...row });
    await expect(t.service.getSelfie(STORE, APPLICATION, APPLICANT)).resolves.toEqual(
      expect.objectContaining({ contentType: 'image/jpeg' }),
    );
    expect(t.storeRepository.findOne).not.toHaveBeenCalled();
  });

  it('refuses an employee/member of the store with a 404', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...row });
    await expect(
      t.service.getSelfie(STORE, APPLICATION, 'store-employee'),
    ).rejects.toMatchObject(notFound);
  });

  it('refuses the owner of another store, even via their own store id', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({ ...row });
    t.storeRepository.findOne.mockResolvedValue({ id: STORE, ownerAccountId: OWNER });
    await expect(
      t.service.getSelfie(STORE, APPLICATION, 'other-owner'),
    ).rejects.toMatchObject(notFound);
    // Addressing the application through a store it does not belong to.
    await expect(
      t.service.getSelfie('store-2', APPLICATION, OWNER),
    ).rejects.toMatchObject(notFound);
  });

  it('is 404 for an unknown application, no selfie, or a missing file', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValueOnce(null);
    await expect(t.service.getSelfie(STORE, APPLICATION, OWNER)).rejects.toMatchObject(notFound);

    t.applicationRepository.findOne.mockResolvedValueOnce({ ...row, selfiePath: null });
    await expect(t.service.getSelfie(STORE, APPLICATION, OWNER)).rejects.toMatchObject(notFound);

    t.applicationRepository.findOne.mockResolvedValueOnce({ ...row });
    t.selfieStorage.exists.mockResolvedValueOnce(false);
    await expect(t.service.getSelfie(STORE, APPLICATION, OWNER)).rejects.toMatchObject(notFound);
  });

  it('rejects a stored value that tries to traverse out of the directory', async () => {
    const t = build();
    t.applicationRepository.findOne.mockResolvedValue({
      ...row,
      selfiePath: '../../.env',
    });
    await expect(t.service.getSelfie(STORE, APPLICATION, APPLICANT)).rejects.toMatchObject(
      notFound,
    );
    expect(t.selfieStorage.exists).not.toHaveBeenCalled();
  });
});

describe('CreateJobApplicationDto.address', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { plainToInstance } = require('class-transformer');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { validateSync } = require('class-validator');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CreateJobApplicationDto } = require('./dto/job-application.dto');

  const check = (address: unknown) => {
    const dto = plainToInstance(CreateJobApplicationDto, { ...form, address });
    return { dto, errors: validateSync(dto).filter((e: any) => e.property === 'address') };
  };

  it('is optional for older builds', () => {
    const dto = plainToInstance(CreateJobApplicationDto, { ...form });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.address).toBeUndefined();
  });

  it('folds to one trimmed line', () => {
    const { dto, errors } = check('  12 Lê Lợi,\n  Quận 1\t ');
    expect(errors).toEqual([]);
    expect(dto.address).toBe('12 Lê Lợi, Quận 1');
  });

  it('treats a blank value as absent', () => {
    const { dto, errors } = check('   ');
    expect(errors).toEqual([]);
    expect(dto.address).toBeUndefined();
  });

  it('enforces 2..255 characters when present', () => {
    expect(check('A').errors).toHaveLength(1);
    expect(check('AB').errors).toEqual([]);
    expect(check('x'.repeat(255)).errors).toEqual([]);
    expect(check('x'.repeat(256)).errors).toHaveLength(1);
  });

  it('refuses a non-string', () => {
    expect(check(12345).errors).toHaveLength(1);
  });
});
