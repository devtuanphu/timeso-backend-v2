/**
 * Service-side authorization for the owner-only hardening: the checks that
 * back up (or stand in for) `StoreOwnerOnlyGuard`.
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { StoresService } from './stores.service';
import { AdvanceRequestStatus } from './entities/salary-advance-request.entity';

jest.mock('uuid', () => ({ v4: () => 'test-id' }));

const STORE = '11111111-1111-4111-8111-111111111111';
const OWNER = 'owner-1';
const STAFF = 'staff-1';

function buildService() {
  const service = Object.create(StoresService.prototype) as any;
  const storeRepository = {
    findOne: jest.fn(async ({ where }: any) =>
      where.id === STORE ? { id: STORE, ownerAccountId: OWNER } : null,
    ),
    exists: jest.fn(),
  };
  const profileRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const salaryAdvanceRequestRepository = {
    findOne: jest.fn(),
    save: jest.fn(async (value: any) => value),
    // Cancel is a conditional update (C2).
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const feedbackRepository = { find: jest.fn().mockResolvedValue([]) };
  const queryBuilder: any = {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  };
  const salaryAdjustmentRepository = {
    createQueryBuilder: jest.fn(() => queryBuilder),
  };
  Object.assign(service, {
    storeRepository,
    profileRepository,
    salaryAdvanceRequestRepository,
    feedbackRepository,
    salaryAdjustmentRepository,
    logger: { debug: jest.fn(), warn: jest.fn(), log: jest.fn(), error: jest.fn() },
  });
  return {
    service,
    storeRepository,
    profileRepository,
    salaryAdvanceRequestRepository,
    feedbackRepository,
    queryBuilder,
  };
}

describe('cancelSalaryAdvanceRequest', () => {
  const pending = () => ({
    id: 'req-1',
    employeeProfileId: 'profile-staff',
    status: AdvanceRequestStatus.PENDING,
  });

  it('lets the employee who filed it cancel', async () => {
    const t = buildService();
    const request = pending();
    t.salaryAdvanceRequestRepository.findOne.mockResolvedValue(request);
    t.profileRepository.findOne.mockResolvedValue({
      id: 'profile-staff',
      accountId: STAFF,
    });

    await t.service.cancelSalaryAdvanceRequest('req-1', STAFF);

    expect(request.status).toBe(AdvanceRequestStatus.CANCELLED);
    expect(t.profileRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'profile-staff' } }),
    );
  });

  it('answers 404 to anyone else, without cancelling', async () => {
    const t = buildService();
    const request = pending();
    t.salaryAdvanceRequestRepository.findOne.mockResolvedValue(request);
    t.profileRepository.findOne.mockResolvedValue({
      id: 'profile-staff',
      accountId: STAFF,
    });

    await expect(
      t.service.cancelSalaryAdvanceRequest('req-1', 'colleague-1'),
    ).rejects.toThrow(NotFoundException);
    expect(request.status).toBe(AdvanceRequestStatus.PENDING);
    expect(t.salaryAdvanceRequestRepository.save).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing request', async () => {
    const t = buildService();
    t.salaryAdvanceRequestRepository.findOne.mockResolvedValue(null);
    await expect(
      t.service.cancelSalaryAdvanceRequest('gone', STAFF),
    ).rejects.toThrow(NotFoundException);
  });

  // C2: a concurrent approval must not be overwritten with CANCELLED.
  it('cancels with a conditional update, never a full save', async () => {
    const t = buildService();
    t.salaryAdvanceRequestRepository.findOne.mockResolvedValue(pending());
    t.profileRepository.findOne.mockResolvedValue({
      id: 'profile-staff',
      accountId: STAFF,
    });

    await t.service.cancelSalaryAdvanceRequest('req-1', STAFF);

    expect(t.salaryAdvanceRequestRepository.update).toHaveBeenCalledWith(
      {
        id: 'req-1',
        status: AdvanceRequestStatus.PENDING,
        employeeProfileId: 'profile-staff',
      },
      { status: AdvanceRequestStatus.CANCELLED },
    );
    expect(t.salaryAdvanceRequestRepository.save).not.toHaveBeenCalled();
  });

  it('answers 400 when the request was decided in the meantime', async () => {
    const t = buildService();
    const request = pending();
    t.salaryAdvanceRequestRepository.findOne.mockResolvedValue(request);
    t.profileRepository.findOne.mockResolvedValue({
      id: 'profile-staff',
      accountId: STAFF,
    });
    t.salaryAdvanceRequestRepository.update.mockResolvedValueOnce({ affected: 0 });

    await expect(
      t.service.cancelSalaryAdvanceRequest('req-1', STAFF),
    ).rejects.toThrow(BadRequestException);
    expect(request.status).toBe(AdvanceRequestStatus.PENDING);
  });
});

describe('permanentDeleteEmployee', () => {
  it('lets the owner hard-delete a (soft-deleted) profile of their store', async () => {
    const t = buildService();
    t.profileRepository.findOne.mockResolvedValue({ id: 'p-1', storeId: STORE });

    await t.service.permanentDeleteEmployee('p-1', OWNER);

    expect(t.profileRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ withDeleted: true }),
    );
    expect(t.profileRepository.delete).toHaveBeenCalledWith({
      id: 'p-1',
      storeId: STORE,
    });
  });

  // Previously the only check was the caller's own password.
  it('refuses anyone who does not own the profile store', async () => {
    const t = buildService();
    t.profileRepository.findOne.mockResolvedValue({ id: 'p-1', storeId: STORE });

    await expect(t.service.permanentDeleteEmployee('p-1', STAFF)).rejects.toThrow(
      ForbiddenException,
    );
    expect(t.profileRepository.delete).not.toHaveBeenCalled();
  });

  it('refuses a missing account id', async () => {
    const t = buildService();
    await expect(t.service.permanentDeleteEmployee('p-1', undefined)).rejects.toThrow(
      ForbiddenException,
    );
    expect(t.profileRepository.delete).not.toHaveBeenCalled();
  });
});

describe('getFeedbacksForViewer', () => {
  it('requires a storeId (it used to return every tenant)', async () => {
    const t = buildService();
    await expect(t.service.getFeedbacksForViewer(OWNER, {})).rejects.toThrow(
      BadRequestException,
    );
    expect(t.feedbackRepository.find).not.toHaveBeenCalled();
  });

  it('gives the owner the whole store', async () => {
    const t = buildService();
    await t.service.getFeedbacksForViewer(OWNER, { storeId: STORE });
    expect(t.feedbackRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: STORE } }),
    );
  });

  it('limits an employee to feedback they submitted', async () => {
    const t = buildService();
    t.profileRepository.findOne.mockResolvedValue({ id: 'profile-staff' });
    await t.service.getFeedbacksForViewer(STAFF, { storeId: STORE });
    expect(t.feedbackRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: STORE, accountId: STAFF } }),
    );
  });

  it('refuses an account with no employed profile at the store', async () => {
    const t = buildService();
    await expect(
      t.service.getFeedbacksForViewer('outsider', { storeId: STORE }),
    ).rejects.toThrow(ForbiddenException);
    expect(t.feedbackRepository.find).not.toHaveBeenCalled();
  });

  it('rejects a malformed storeId with 400, not a driver error', async () => {
    const t = buildService();
    await expect(
      t.service.getFeedbacksForViewer(OWNER, { storeId: 'nope' }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('bonus and penalty history filter', () => {
  it.each(['getBonusHistory', 'getPenaltyHistory'])(
    '%s narrows to one employee when asked',
    async (method) => {
      const t = buildService();
      await t.service[method](STORE, undefined, 'profile-staff');
      expect(t.queryBuilder.andWhere).toHaveBeenCalledWith(
        'ep.id = :employeeProfileId',
        { employeeProfileId: 'profile-staff' },
      );
    },
  );

  it.each(['getBonusHistory', 'getPenaltyHistory'])(
    '%s stays store-wide for the owner',
    async (method) => {
      const t = buildService();
      await t.service[method](STORE);
      expect(t.queryBuilder.andWhere).not.toHaveBeenCalledWith(
        'ep.id = :employeeProfileId',
        expect.anything(),
      );
    },
  );
});

describe('store-less owner tooling', () => {
  it('assertOwnsAnyStore allows an account that owns a store', async () => {
    const t = buildService();
    t.storeRepository.exists.mockResolvedValue(true);
    await expect(t.service.assertOwnsAnyStore(OWNER)).resolves.toBeUndefined();
  });

  it('assertOwnsAnyStore refuses everyone else', async () => {
    const t = buildService();
    t.storeRepository.exists.mockResolvedValue(false);
    await expect(t.service.assertOwnsAnyStore(STAFF)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(t.service.assertOwnsAnyStore(undefined)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('GET /stores/staff?storeId', () => {
  // It used to list any store's staff to any signed-in account.
  it('refuses a storeId the caller does not own', async () => {
    const t = buildService();
    await expect(t.service.getEmployees(STAFF, STORE)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
