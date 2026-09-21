import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import {
  STORE_OWNER_REQUIRED,
  STORE_SCOPE_CONFLICT,
  StoreOwnerOnly,
  StoreOwnerOnlyOptions,
} from './store-owner-only.decorator';
import { StoreOwnerOnlyGuard } from './store-owner-only.guard';

const OWNER = 'account-owner';
const MEMBER = 'account-member';
const STORE = 'store-1';
const OTHER_STORE = 'store-2';
const PROFILE = 'profile-1';

interface RequestShape {
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  userId?: string;
}

/** A context whose handler declares `path` and, optionally, the marker. */
function contextFor(
  path: string,
  request: RequestShape,
  options: StoreOwnerOnlyOptions | null = {},
) {
  const handler = () => undefined;
  Reflect.defineMetadata(PATH_METADATA, path, handler);
  if (options) StoreOwnerOnly(options)(handler, 'handler', {
    value: handler,
  } as PropertyDescriptor);
  const req = {
    params: request.params ?? {},
    query: request.query ?? {},
    body: request.body,
    user: request.userId ? { userId: request.userId } : undefined,
  };
  return {
    getHandler: () => handler,
    getClass: () => class Stub {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(ForbiddenException);
  await promise.catch((error: ForbiddenException) => {
    expect((error.getResponse() as { code?: string }).code).toBe(code);
  });
}

describe('StoreOwnerOnlyGuard', () => {
  let rows: Map<string, Record<string, unknown>[]>;
  let stores: { id: string; ownerAccountId: string }[];
  let storeFind: jest.Mock;
  let guard: StoreOwnerOnlyGuard;

  /** Registers rows an entity's repository can return by id. */
  const givenRows = (entityName: string, ...entityRows: Record<string, unknown>[]) => {
    rows.set(entityName, entityRows);
  };

  beforeEach(() => {
    rows = new Map();
    stores = [
      { id: STORE, ownerAccountId: OWNER },
      { id: OTHER_STORE, ownerAccountId: OWNER },
    ];
    storeFind = jest.fn(async ({ where }: any) =>
      stores.filter((store) => (where.id.value as string[]).includes(store.id)),
    );
    const dataSource = {
      getRepository: jest.fn((entity: any) => {
        const name = typeof entity === 'function' ? entity.name : String(entity);
        if (name === 'Store') return { find: storeFind };
        return {
          findOne: jest.fn(
            async ({ where }: any) =>
              (rows.get(name) ?? []).find((row) => row.id === where.id) ?? null,
          ),
        };
      }),
    };
    guard = new StoreOwnerOnlyGuard(new Reflector(), dataSource as any);
  });

  it('passes an unmarked handler without touching the database', async () => {
    await expect(
      guard.canActivate(
        contextFor(':id/work-shifts', { params: { id: STORE }, userId: MEMBER }, null),
      ),
    ).resolves.toBe(true);
    expect(storeFind).not.toHaveBeenCalled();
  });

  describe('store from the path', () => {
    it('lets the owner through', async () => {
      await expect(
        guard.canActivate(
          contextFor(':id/payrolls/generate', { params: { id: STORE }, userId: OWNER }),
        ),
      ).resolves.toBe(true);
    });

    it('refuses an employee of the store with STORE_OWNER_REQUIRED', async () => {
      await expectCode(
        guard.canActivate(
          contextFor(':id/location', { params: { id: STORE }, userId: MEMBER }),
        ),
        STORE_OWNER_REQUIRED,
      );
    });

    it('reads :storeId too', async () => {
      await expect(
        guard.canActivate(
          contextFor(':storeId/salary-advance-requests', {
            params: { storeId: STORE },
            userId: OWNER,
          }),
        ),
      ).resolves.toBe(true);
    });

    it('answers 404 for a store that does not exist', async () => {
      await expect(
        guard.canActivate(
          contextFor(':id/qr-code', { params: { id: 'missing' }, userId: OWNER }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses a request with no principal', async () => {
      await expectCode(
        guard.canActivate(contextFor(':id/qr-code', { params: { id: STORE } })),
        STORE_OWNER_REQUIRED,
      );
    });
  });

  describe('store from the addressed row', () => {
    it('lets the owner act on a row of their store', async () => {
      givenRows('EmployeeSalary', { id: 'salary-1', employeeProfileId: PROFILE });
      givenRows('EmployeeProfile', { id: PROFILE, storeId: STORE });
      await expect(
        guard.canActivate(
          contextFor('salaries/:id/pay', { params: { id: 'salary-1' }, userId: OWNER }),
        ),
      ).resolves.toBe(true);
    });

    it('refuses a member acting on a row of that store', async () => {
      givenRows('SalaryAdvanceRequest', { id: 'req-1', employeeProfileId: PROFILE });
      givenRows('EmployeeProfile', { id: PROFILE, storeId: STORE });
      await expectCode(
        guard.canActivate(
          contextFor('salary-advance-requests/:requestId/review', {
            params: { requestId: 'req-1' },
            userId: MEMBER,
          }),
        ),
        STORE_OWNER_REQUIRED,
      );
    });

    it('answers 404 when the mapped row is missing', async () => {
      await expect(
        guard.canActivate(
          contextFor('payrolls/:payrollId', {
            params: { payrollId: 'gone' },
            userId: OWNER,
          }),
        ),
      ).rejects.toThrow(NotFoundException);
      expect(storeFind).not.toHaveBeenCalled();
    });

    it('resolves a soft-deleted employee for permanent delete', async () => {
      givenRows('EmployeeProfile', { id: PROFILE, storeId: STORE });
      await expectCode(
        guard.canActivate(
          contextFor('employees/:profileId/permanent', {
            params: { profileId: PROFILE },
            userId: MEMBER,
          }),
        ),
        STORE_OWNER_REQUIRED,
      );
    });

    it('checks a salary config by its owner account', async () => {
      givenRows('SalaryConfig', { id: 'cfg-1', ownerAccountId: OWNER });
      await expect(
        guard.canActivate(
          contextFor('salary-configs/:configId', {
            params: { configId: 'cfg-1' },
            userId: OWNER,
          }),
        ),
      ).resolves.toBe(true);
      await expectCode(
        guard.canActivate(
          contextFor('salary-configs/:configId', {
            params: { configId: 'cfg-1' },
            userId: MEMBER,
          }),
        ),
        STORE_OWNER_REQUIRED,
      );
    });
  });

  describe('store from the query and body', () => {
    it('uses query.storeId on a route that opts into it', async () => {
      const options: StoreOwnerOnlyOptions = { storeFrom: ['query'] };
      await expect(
        guard.canActivate(
          contextFor(
            'inventory-reports',
            { query: { storeId: STORE }, userId: OWNER },
            options,
          ),
        ),
      ).resolves.toBe(true);
      stores[0].ownerAccountId = 'someone-else';
      await expectCode(
        guard.canActivate(
          contextFor(
            'inventory-reports',
            { query: { storeId: STORE }, userId: OWNER },
            options,
          ),
        ),
        STORE_OWNER_REQUIRED,
      );
    });

    it('uses a JSON body.storeId on a route that opts into it', async () => {
      await expect(
        guard.canActivate(
          contextFor(
            'some-owner-action',
            { body: { storeId: STORE }, userId: OWNER },
            { storeFrom: ['body'] },
          ),
        ),
      ).resolves.toBe(true);
    });

    // H3: `?storeId=<own store>` used to authorize routes whose handler
    // never reads it and acts on a row of another store instead.
    it('does not accept an un-opted query.storeId as proof', async () => {
      await expectCode(
        guard.canActivate(
          contextFor('inventory-reports', { query: { storeId: STORE }, userId: OWNER }),
        ),
        STORE_OWNER_REQUIRED,
      );
      expect(storeFind).not.toHaveBeenCalled();
    });

    it('does not accept an un-opted JSON body.storeId as proof', async () => {
      await expectCode(
        guard.canActivate(
          contextFor('employees/payment-histories', {
            body: { storeId: STORE },
            userId: OWNER,
          }),
        ),
        STORE_OWNER_REQUIRED,
      );
    });

    it('still checks an un-opted storeId against the proven store', async () => {
      givenRows('EmployeeProfile', { id: PROFILE, storeId: STORE });
      await expectCode(
        guard.canActivate(
          contextFor(
            'employee-salaries',
            {
              body: { employeeProfileId: PROFILE, storeId: OTHER_STORE },
              userId: OWNER,
            },
            { bodyResources: [{ field: 'employeeProfileId', resource: 'employees' }] },
          ),
        ),
        STORE_SCOPE_CONFLICT,
      );
      stores[1].ownerAccountId = 'someone-else';
      await expectCode(
        guard.canActivate(
          contextFor(':id/work-shifts', {
            params: { id: STORE },
            query: { storeId: STORE },
            body: { storeId: STORE },
            userId: MEMBER,
          }),
        ),
        STORE_OWNER_REQUIRED,
      );
    });

    it('resolves a declared body resource', async () => {
      givenRows('EmployeeProfile', { id: PROFILE, storeId: STORE });
      stores[0].ownerAccountId = 'someone-else';
      await expectCode(
        guard.canActivate(
          contextFor(
            'employee-salaries',
            { body: { employeeProfileId: PROFILE }, userId: OWNER },
            { bodyResources: [{ field: 'employeeProfileId', resource: 'employees' }] },
          ),
        ),
        STORE_OWNER_REQUIRED,
      );
    });

    it('requires every store in a declared list to be owned', async () => {
      const options = { bodyStoreIdLists: ['storeIds'] };
      await expect(
        guard.canActivate(
          contextFor(
            'salary-configs',
            { body: { storeIds: [STORE, OTHER_STORE] }, userId: OWNER },
            options,
          ),
        ),
      ).resolves.toBe(true);
      stores[1].ownerAccountId = 'someone-else';
      await expectCode(
        guard.canActivate(
          contextFor(
            'salary-configs',
            { body: { storeIds: [STORE, OTHER_STORE] }, userId: OWNER },
            options,
          ),
        ),
        STORE_OWNER_REQUIRED,
      );
    });
  });

  describe('fails closed', () => {
    it('refuses a marked route whose store cannot be resolved', async () => {
      await expectCode(
        guard.canActivate(contextFor('monthly-report', { userId: OWNER })),
        STORE_OWNER_REQUIRED,
      );
      expect(storeFind).not.toHaveBeenCalled();
    });

    // Multipart bodies are not parsed when guards run.
    it('does not read a missing (multipart) body as a source', async () => {
      await expectCode(
        guard.canActivate(contextFor('products/export', { userId: OWNER })),
        STORE_OWNER_REQUIRED,
      );
    });

    it('refuses sources that name different stores, even both owned', async () => {
      await expectCode(
        guard.canActivate(
          contextFor(':id/salary-configs', {
            params: { id: STORE },
            body: { storeId: OTHER_STORE },
            userId: OWNER,
          }),
        ),
        STORE_SCOPE_CONFLICT,
      );
    });

    it('refuses a path store that disagrees with the addressed row', async () => {
      givenRows('EmployeeProfile', { id: PROFILE, storeId: OTHER_STORE });
      await expectCode(
        guard.canActivate(
          contextFor(
            ':id/employees',
            { params: { id: STORE }, body: { employeeProfileId: PROFILE }, userId: OWNER },
            { bodyResources: [{ field: 'employeeProfileId', resource: 'employees' }] },
          ),
        ),
        STORE_SCOPE_CONFLICT,
      );
    });

    it('refuses a repeated query storeId naming two stores', async () => {
      await expectCode(
        guard.canActivate(
          contextFor(
            'assets/report',
            { query: { storeId: [STORE, OTHER_STORE] }, userId: OWNER },
            { storeFrom: ['query'] },
          ),
        ),
        STORE_SCOPE_CONFLICT,
      );
    });

    it('answers 404 rather than a driver error for a malformed store id', async () => {
      storeFind.mockRejectedValueOnce(new Error('invalid input syntax for type uuid'));
      await expect(
        guard.canActivate(
          contextFor(':id/location', { params: { id: 'nope' }, userId: OWNER }),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
