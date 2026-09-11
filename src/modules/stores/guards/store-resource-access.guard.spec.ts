import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';

import { StoreAccessResolver } from './store-access.resolver';
import { StoreResourceAccessGuard } from './store-resource-access.guard';

const OWNER = 'account-owner';
const OUTSIDER = 'account-outsider';
const STORE = 'store-1';
const PROFILE = 'profile-1';

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

describe('StoreResourceAccessGuard', () => {
  let repositories: Map<string, { findOne: jest.Mock }>;
  let storeRepository: { findOne: jest.Mock };
  let profileRepository: { exists: jest.Mock };
  let dataSource: { getRepository: jest.Mock };
  let guard: StoreResourceAccessGuard;

  /** Registers the row a given entity class resolves to. */
  const givenRow = (entityName: string, row: unknown) => {
    repositories.set(entityName, { findOne: jest.fn().mockResolvedValue(row) });
  };

  beforeEach(() => {
    repositories = new Map();
    dataSource = {
      getRepository: jest.fn((entity: any) => {
        const name = typeof entity === 'function' ? entity.name : String(entity);
        return (
          repositories.get(name) ?? { findOne: jest.fn().mockResolvedValue(null) }
        );
      }),
    };
    storeRepository = {
      findOne: jest.fn().mockResolvedValue({ id: STORE, ownerAccountId: OWNER }),
    };
    profileRepository = { exists: jest.fn().mockResolvedValue(false) };
    guard = new StoreResourceAccessGuard(
      dataSource as any,
      new StoreAccessResolver(storeRepository as any, profileRepository as any),
    );
  });

  describe('families it scopes', () => {
    // The reason this guard exists: the store is not in the URL, so the
    // previous guard could not cover these and any authenticated account could
    // act on another store's rows by supplying a uuid.
    it('refuses an outsider on a payroll addressed by its own id', async () => {
      givenRow('MonthlyPayroll', { id: 'payroll-1', storeId: STORE });
      await expect(
        guard.canActivate(
          contextFor('payrolls/:payrollId', { payrollId: 'payroll-1' }, OUTSIDER),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows the owner of the store that row belongs to', async () => {
      givenRow('StockTransaction', { id: 'tx-1', storeId: STORE });
      await expect(
        guard.canActivate(
          contextFor('stock-transactions/:transactionId', { transactionId: 'tx-1' }, OWNER),
        ),
      ).resolves.toBe(true);
    });

    it('allows a current employee of that store', async () => {
      givenRow('EmployeeProfile', { id: PROFILE, storeId: STORE });
      profileRepository.exists.mockResolvedValue(true);
      await expect(
        guard.canActivate(
          contextFor('employees/:profileId/assets', { profileId: PROFILE }, 'staff'),
        ),
      ).resolves.toBe(true);
    });

    // EmployeeSalary carries no store_id; the store comes from the profile.
    it('follows the one-hop lookup for employee salaries', async () => {
      givenRow('EmployeeSalary', { id: 'salary-1', employeeProfileId: PROFILE });
      givenRow('EmployeeProfile', { id: PROFILE, storeId: STORE });

      await expect(
        guard.canActivate(
          contextFor('employee-salaries/:salaryId', { salaryId: 'salary-1' }, OUTSIDER),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(dataSource.getRepository).toHaveBeenCalledTimes(2);
    });

    // Attendance: the assignment names the employee, the employee the store.
    it('scopes a check-in to the assignment employee\'s store', async () => {
      givenRow('ShiftAssignment', { id: 'a-1', employeeId: PROFILE });
      givenRow('EmployeeProfile', { id: PROFILE, storeId: STORE });
      await expect(
        guard.canActivate(
          contextFor('shift-assignments/:id/check-in', { id: 'a-1' }, OUTSIDER),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets a current employee of that store check in', async () => {
      givenRow('ShiftAssignment', { id: 'a-1', employeeId: PROFILE });
      givenRow('EmployeeProfile', { id: PROFILE, storeId: STORE });
      profileRepository.exists.mockResolvedValue(true);
      await expect(
        guard.canActivate(
          contextFor('shift-assignments/:id/check-in', { id: 'a-1' }, 'staff'),
        ),
      ).resolves.toBe(true);
    });

    it('follows a shift slot through its work cycle', async () => {
      givenRow('ShiftSlot', { id: 'slot-1', cycleId: 'cycle-1' });
      givenRow('WorkCycle', { id: 'cycle-1', storeId: STORE });
      await expect(
        guard.canActivate(
          contextFor('shift-slots/:slotId/register', { slotId: 'slot-1' }, OUTSIDER),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    // Two hops: swap -> assignment -> employee -> store.
    it('walks a two-hop chain for a shift swap', async () => {
      givenRow('ShiftSwap', { id: 'swap-1', fromAssignmentId: 'a-1' });
      givenRow('ShiftAssignment', { id: 'a-1', employeeId: PROFILE });
      givenRow('EmployeeProfile', { id: PROFILE, storeId: STORE });
      await expect(
        guard.canActivate(
          contextFor('shift-swaps/:swapId/status', { swapId: 'swap-1' }, OUTSIDER),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(dataSource.getRepository).toHaveBeenCalledTimes(3);
    });

    it('stops the chain when an intermediate row is missing', async () => {
      givenRow('ShiftSwap', { id: 'swap-1', fromAssignmentId: 'a-1' });
      givenRow('ShiftAssignment', null);
      await expect(
        guard.canActivate(
          contextFor('shift-swaps/:swapId/status', { swapId: 'swap-1' }, OUTSIDER),
        ),
      ).resolves.toBe(true);
    });

    it('follows a recipe through its service item', async () => {
      givenRow('ServiceItemRecipe', { id: 'r-1', serviceItemId: 'item-1' });
      givenRow('ServiceItem', { id: 'item-1', storeId: STORE });
      await expect(
        guard.canActivate(
          contextFor('service-item-recipes/:recipeId', { recipeId: 'r-1' }, OUTSIDER),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('takes the first route parameter regardless of its name', async () => {
      givenRow('Asset', { id: 'asset-1', storeId: STORE });
      await expect(
        guard.canActivate(
          contextFor('assets/:assetId/history', { assetId: 'asset-1' }, OUTSIDER),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a request with no principal', async () => {
      givenRow('Order', { id: 'order-1', storeId: STORE });
      await expect(
        guard.canActivate(contextFor('orders/:orderId', { orderId: 'order-1' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('reports a malformed id as not found rather than a driver error', async () => {
      repositories.set('Order', {
        findOne: jest.fn().mockRejectedValue(new Error('invalid input syntax for type uuid')),
      });
      await expect(
        guard.canActivate(contextFor('orders/:orderId', { orderId: 'nope' }, OWNER)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('cases it passes through unchanged', () => {
    // Safe-by-construction: an unmapped family keeps exactly its old behaviour,
    // so the table can be extended one entry at a time.
    it('ignores a family that is not in the map', async () => {
      // `approvals` is genuinely unmapped: its id is polymorphic across three
      // request types. Using a mapped family here would pass for the wrong
      // reason — because no row was registered, not because it was skipped.
      await expect(
        guard.canActivate(
          contextFor('approvals/:requestId', { requestId: 'req-1' }, OUTSIDER),
        ),
      ).resolves.toBe(true);
      expect(dataSource.getRepository).not.toHaveBeenCalled();
      expect(storeRepository.findOne).not.toHaveBeenCalled();
    });

    it('ignores store-addressed routes, which the other guard owns', async () => {
      await expect(
        guard.canActivate(contextFor(':id/payrolls', { id: STORE }, OUTSIDER)),
      ).resolves.toBe(true);
    });

    it('ignores a route with no parameter at all', async () => {
      await expect(
        guard.canActivate(contextFor('employees', {}, OUTSIDER)),
      ).resolves.toBe(true);
    });

    // The handler should produce its own 404 rather than the guard guessing.
    it('lets a missing row reach the handler', async () => {
      givenRow('Order', null);
      await expect(
        guard.canActivate(contextFor('orders/:orderId', { orderId: 'gone' }, OUTSIDER)),
      ).resolves.toBe(true);
    });

    it('lets a row with no store reach the handler', async () => {
      givenRow('Order', { id: 'order-1', storeId: null });
      await expect(
        guard.canActivate(contextFor('orders/:orderId', { orderId: 'order-1' }, OUTSIDER)),
      ).resolves.toBe(true);
    });
  });
});
