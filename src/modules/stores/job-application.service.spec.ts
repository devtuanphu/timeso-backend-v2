import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { HttpException } from '@nestjs/common';

import { JobApplicationService } from './job-application.service';
import { JobApplicationStatus } from './entities/job-application.entity';
import { AccountStatus } from '../accounts/entities/account.entity';
import { StoreStatus } from './entities/store.entity';

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
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getExists: jest.fn().mockResolvedValue(false),
    })),
  };
  const accountsService: any = {
    findById: jest.fn().mockResolvedValue({
      id: APPLICANT,
      status: AccountStatus.ACTIVE,
    }),
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

  const service = new JobApplicationService(
    applicationRepository,
    storeRepository,
    profileRepository,
    accountsService,
    notificationsService,
    storesService,
  );
  return {
    service,
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
        metadata: expect.objectContaining({
          type: 'JOB_APPLICATION_SUBMITTED',
          // The owner app's push router reads `screen`.
          screen: '/(home)/recruitment',
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
  });
});

describe('JobApplicationService.redactStaleContactDetails', () => {
  it('clears contact fields on reviewed applications past the window', async () => {
    const t = build();
    t.applicationRepository.update.mockResolvedValue({ affected: 3 });

    await expect(t.service.redactStaleContactDetails()).resolves.toBe(3);
    const [criteria, changes] = t.applicationRepository.update.mock.calls[0];
    // Pending applications are never touched.
    expect(criteria.status).toBeDefined();
    expect(criteria.reviewedAt).toBeDefined();
    expect(changes).toEqual(
      expect.objectContaining({ phone: null, email: null, introduction: null }),
    );
  });

  it('reports zero when nothing is stale', async () => {
    const t = build();
    t.applicationRepository.update.mockResolvedValue({ affected: 0 });
    await expect(t.service.redactStaleContactDetails()).resolves.toBe(0);
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
