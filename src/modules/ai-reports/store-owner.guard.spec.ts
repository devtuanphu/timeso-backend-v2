import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { StoreOwnerGuard } from './store-owner.guard';

const OWNER = 'account-owner';
const STORE = 'store-1';

function contextFor(params: any, user: any) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ params, user }) }),
  } as any;
}

describe('StoreOwnerGuard', () => {
  let storeRepository: { findOne: jest.Mock };
  let guard: StoreOwnerGuard;

  beforeEach(() => {
    storeRepository = { findOne: jest.fn() };
    guard = new StoreOwnerGuard(storeRepository as any);
  });

  it('allows the store owner through', async () => {
    storeRepository.findOne.mockResolvedValue({ id: STORE, ownerAccountId: OWNER });
    await expect(
      guard.canActivate(contextFor({ id: STORE }, { userId: OWNER })),
    ).resolves.toBe(true);
  });

  // The reason this guard exists: any authenticated account could previously
  // read another store's revenue and forecasts by supplying its UUID.
  it('refuses an authenticated caller who does not own the store', async () => {
    storeRepository.findOne.mockResolvedValue({ id: STORE, ownerAccountId: OWNER });
    await expect(
      guard.canActivate(contextFor({ id: STORE }, { userId: 'someone-else' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('404s an unknown store', async () => {
    storeRepository.findOne.mockResolvedValue(null);
    await expect(
      guard.canActivate(contextFor({ id: STORE }, { userId: OWNER })),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses a request with no principal', async () => {
    await expect(
      guard.canActivate(contextFor({ id: STORE }, undefined)),
    ).rejects.toThrow(ForbiddenException);
    expect(storeRepository.findOne).not.toHaveBeenCalled();
  });

  it('refuses a request with no store id', async () => {
    await expect(
      guard.canActivate(contextFor({}, { userId: OWNER })),
    ).rejects.toThrow(NotFoundException);
    expect(storeRepository.findOne).not.toHaveBeenCalled();
  });

  it('scopes the lookup to the requested store only', async () => {
    storeRepository.findOne.mockResolvedValue({ id: STORE, ownerAccountId: OWNER });
    await guard.canActivate(contextFor({ id: STORE }, { userId: OWNER }));
    expect(storeRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: STORE } }),
    );
  });
});
