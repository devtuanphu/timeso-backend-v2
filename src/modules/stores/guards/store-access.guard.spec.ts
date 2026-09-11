import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';

import { StoreAccessGuard } from './store-access.guard';
import { StoreAccessResolver } from './store-access.resolver';

const OWNER = 'account-owner';
const STAFF = 'account-staff';
const OUTSIDER = 'account-outsider';
const STORE = 'store-1';

/** Builds a context whose handler declares `path`, matching Nest's metadata. */
function contextFor(path: string, params: unknown, userId?: string) {
  const handler = () => undefined;
  Reflect.defineMetadata(PATH_METADATA, path, handler);
  return {
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({ params, user: userId ? { userId } : undefined }),
    }),
  } as any;
}

describe('StoreAccessGuard', () => {
  let storeRepository: { findOne: jest.Mock };
  let profileRepository: { exists: jest.Mock };
  let guard: StoreAccessGuard;

  beforeEach(() => {
    storeRepository = {
      findOne: jest.fn().mockResolvedValue({ id: STORE, ownerAccountId: OWNER }),
    };
    profileRepository = { exists: jest.fn().mockResolvedValue(false) };
    guard = new StoreAccessGuard(
      new StoreAccessResolver(storeRepository as any, profileRepository as any),
    );
  });

  describe('routes it scopes', () => {
    it('allows the store owner', async () => {
      await expect(
        guard.canActivate(contextFor(':id/payrolls', { id: STORE }, OWNER)),
      ).resolves.toBe(true);
      expect(profileRepository.exists).not.toHaveBeenCalled();
    });

    it('allows a non-terminated employee of that store', async () => {
      profileRepository.exists.mockResolvedValue(true);
      await expect(
        guard.canActivate(contextFor(':id/work-shifts', { id: STORE }, STAFF)),
      ).resolves.toBe(true);
    });

    // The reason the guard exists.
    it('refuses an authenticated outsider', async () => {
      await expect(
        guard.canActivate(contextFor(':id/payrolls', { id: STORE }, OUTSIDER)),
      ).rejects.toThrow(ForbiddenException);
    });

    it('handles the bare :id route', async () => {
      await expect(
        guard.canActivate(contextFor(':id', { id: STORE }, OUTSIDER)),
      ).rejects.toThrow(ForbiddenException);
    });

    it('handles :storeId routes', async () => {
      await expect(
        guard.canActivate(
          contextFor(':storeId/shifts/slots', { storeId: STORE }, OUTSIDER),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('404s an unknown store before revealing anything else', async () => {
      storeRepository.findOne.mockResolvedValue(null);
      await expect(
        guard.canActivate(contextFor(':id/payrolls', { id: STORE }, OWNER)),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses a request with no principal', async () => {
      await expect(
        guard.canActivate(contextFor(':id/payrolls', { id: STORE })),
      ).rejects.toThrow(ForbiddenException);
      expect(storeRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('routes it deliberately ignores', () => {
    // `:id` here is a KPI id, not a store id. Treating it as a store would
    // reject most of the controller.
    it('passes through a sub-resource route that reuses :id', async () => {
      await expect(
        guard.canActivate(
          contextFor('employee-kpis/:id', { id: 'kpi-1' }, OUTSIDER),
        ),
      ).resolves.toBe(true);
      expect(storeRepository.findOne).not.toHaveBeenCalled();
    });

    it('passes through routes addressed by another resource id', async () => {
      for (const path of [
        'employees/:profileId',
        'employee-salaries/:salaryId',
        'payment-accounts/:id',
        'shift-assignments/:id/check-in',
      ]) {
        await expect(
          guard.canActivate(contextFor(path, { id: 'x', profileId: 'y' }, OUTSIDER)),
        ).resolves.toBe(true);
      }
      expect(storeRepository.findOne).not.toHaveBeenCalled();
    });

    it('passes through static paths such as discovery', async () => {
      await expect(
        guard.canActivate(contextFor('discovery', {}, OUTSIDER)),
      ).resolves.toBe(true);
    });

    it('passes through when the handler declares no path metadata', async () => {
      const handler = () => undefined;
      const context = {
        getHandler: () => handler,
        switchToHttp: () => ({
          getRequest: () => ({ params: { id: STORE }, user: { userId: OUTSIDER } }),
        }),
      } as any;
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });
});
