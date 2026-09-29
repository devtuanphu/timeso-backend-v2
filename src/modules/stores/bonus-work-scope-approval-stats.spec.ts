jest.mock('../../common/utils/multer-config', () => ({
  attendanceMulterConfig: {},
  multerConfig: {},
  mixedIdentityMulterConfig: () => ({}),
  identityImageUrl: (filename: string) => filename,
}));

/**
 * GET bonus-work-requests is scoped (owner: store; anyone else: only their
 * own requests), and the approvals badge counts PENDING custom-time requests.
 */
import { UnauthorizedException } from '@nestjs/common';

import { EmploymentStatus } from './entities/employee-profile.entity';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';

const PROFILES: Record<string, any> = {
  'emp-1': { id: 'emp-1', storeId: 'store-a', accountId: 'staff-1', employmentStatus: EmploymentStatus.ACTIVE },
  'emp-2': { id: 'emp-2', storeId: 'store-a', accountId: 'staff-2', employmentStatus: EmploymentStatus.ACTIVE },
  'emp-b': { id: 'emp-b', storeId: 'store-b', accountId: 'staff-b', employmentStatus: EmploymentStatus.ACTIVE },
};
const STORES: Record<string, any> = {
  'store-a': { id: 'store-a', ownerAccountId: 'owner-a' },
  'store-b': { id: 'store-b', ownerAccountId: 'owner-b' },
};

function build() {
  const service = Object.create(StoresService.prototype) as any;
  service.profileRepository = {
    findOne: jest.fn(async ({ where }: any) => {
      if (where.id) return PROFILES[where.id] ?? null;
      return (
        Object.values(PROFILES).find(
          (p: any) => p.storeId === where.storeId && p.accountId === where.accountId,
        ) ?? null
      );
    }),
  };
  service.storeRepository = {
    findOne: jest.fn(async ({ where }: any) => STORES[where.id] ?? null),
  };
  service.getBonusWorkRequestsByStore = jest.fn(async (storeId: string) => [
    { id: `store-list-${storeId}`, status: 'PENDING' },
  ]);
  service.getBonusWorkRequestsByEmployee = jest.fn(async (profileId: string) => [
    { id: `${profileId}-pending`, status: 'PENDING' },
    { id: `${profileId}-approved`, status: 'APPROVED' },
  ]);
  const controller = new StoresController(
    service,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { controller, service };
}

describe('GET bonus-work-requests scoping', () => {
  it('owner: whole store, with ?status=', async () => {
    const { controller, service } = build();
    await expect(
      controller.getBonusWorkRequests('store-a', undefined, 'PENDING', { userId: 'owner-a' }),
    ).resolves.toEqual([{ id: 'store-list-store-a', status: 'PENDING' }]);
    expect(service.getBonusWorkRequestsByStore).toHaveBeenCalledWith('store-a', 'PENDING');
  });

  it('owner: a named employee of their store', async () => {
    const { controller, service } = build();
    await controller.getBonusWorkRequests(undefined, 'emp-2', undefined, { userId: 'owner-a' });
    expect(service.getBonusWorkRequestsByEmployee).toHaveBeenCalledWith('emp-2');
  });

  it('staff asking for the store gets only their own requests', async () => {
    const { controller, service } = build();
    const result = await controller.getBonusWorkRequests('store-a', undefined, 'PENDING', {
      userId: 'staff-1',
    });
    expect(service.getBonusWorkRequestsByStore).not.toHaveBeenCalled();
    expect(service.getBonusWorkRequestsByEmployee).toHaveBeenCalledWith('emp-1');
    expect(result).toEqual([{ id: 'emp-1-pending', status: 'PENDING' }]);
  });

  it("staff asking for a coworker's profile is forced to their own", async () => {
    const { controller, service } = build();
    const result: any = await controller.getBonusWorkRequests(undefined, 'emp-2', undefined, {
      userId: 'staff-1',
    });
    expect(service.getBonusWorkRequestsByEmployee).toHaveBeenCalledWith('emp-1');
    expect(service.getBonusWorkRequestsByEmployee).not.toHaveBeenCalledWith('emp-2');
    // Unfiltered by status on the employee path (released clients).
    expect(result).toHaveLength(2);
  });

  it('staff self read keeps working', async () => {
    const { controller, service } = build();
    await controller.getBonusWorkRequests(undefined, 'emp-1', undefined, { userId: 'staff-1' });
    expect(service.getBonusWorkRequestsByEmployee).toHaveBeenCalledWith('emp-1');
  });

  it('another store / no membership / mismatched store: empty list', async () => {
    const { controller, service } = build();
    await expect(
      controller.getBonusWorkRequests('store-b', undefined, undefined, { userId: 'staff-1' }),
    ).resolves.toEqual([]);
    await expect(
      controller.getBonusWorkRequests(undefined, 'emp-b', undefined, { userId: 'owner-a' }),
    ).resolves.toEqual([]);
    await expect(
      controller.getBonusWorkRequests('store-a', 'emp-b', undefined, { userId: 'owner-a' }),
    ).resolves.toEqual([]);
    await expect(
      controller.getBonusWorkRequests(undefined, undefined, undefined, { userId: 'owner-a' }),
    ).resolves.toEqual([]);
    expect(service.getBonusWorkRequestsByStore).not.toHaveBeenCalled();
    expect(service.getBonusWorkRequestsByEmployee).not.toHaveBeenCalled();
  });

  it('unauthenticated: 401', async () => {
    const { controller } = build();
    await expect(
      controller.getBonusWorkRequests('store-a', undefined, undefined, undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('getApprovalStats counts PENDING custom shift requests', () => {
  const statsService = (customRows: unknown) => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = { warn: jest.fn() };
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue({});
    const old = new Date(Date.now() - 3 * 86_400_000);
    service.shiftAssignmentRepository = {
      find: jest.fn().mockResolvedValue([
        { status: 'PENDING', createdAt: old },
        { status: 'APPROVED', createdAt: old },
      ]),
    };
    service.shiftChangeRequestRepository = { find: jest.fn().mockResolvedValue([]) };
    service.leaveRequestRepository = {
      find: jest.fn().mockResolvedValue([{ status: 'PENDING', createdAt: new Date() }]),
    };
    service.dataSource = {
      query:
        customRows instanceof Error
          ? jest.fn().mockRejectedValue(customRows)
          : jest.fn().mockResolvedValue(customRows),
    };
    return service;
  };

  it('adds the custom pending count to total / pending / urgent and exposes it', async () => {
    const service = statsService([{ pending: 3, urgent: 1 }]);
    await expect(service.getApprovalStats('store-a', 'owner-a')).resolves.toEqual({
      total: 3 + 3,
      pending: 2 + 3,
      approved: 1,
      urgent: 1 + 1,
      customShiftPending: 3,
    });
    const [sql, params] = service.dataSource.query.mock.calls[0];
    expect(sql).toContain('FROM custom_shift_requests');
    expect(sql).toContain("status = 'PENDING'");
    expect(params[0]).toBe('store-a');
  });

  it('table not migrated yet: counted as 0, stats still served', async () => {
    const service = statsService(new Error('relation "custom_shift_requests" does not exist'));
    await expect(service.getApprovalStats('store-a', 'owner-a')).resolves.toMatchObject({
      total: 3,
      pending: 2,
      customShiftPending: 0,
    });
  });
});
