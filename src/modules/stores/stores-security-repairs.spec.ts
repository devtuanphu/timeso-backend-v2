/**
 * Service-side checks behind the phase-1 security repairs (H1, H3, H4):
 * owner-only pay changes and KPI decisions, store-scoped KPI approval lists,
 * single-store bulk stock-out, and foreign keys that must stay in the
 * resolved store.
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Brackets } from 'typeorm';

import {
  KPI_CLOSED,
  KPI_NOT_DRAFT,
  KPI_SELF_OR_OWNER_REQUIRED,
  StoresService,
  kpiCompletionRate,
} from './stores.service';
import { KpiRequestStatus } from './entities/kpi-approval-request.entity';
import { KpiStatus } from './entities/employee-kpi.entity';
import { EmploymentStatus } from './entities/employee-profile.entity';
import {
  CreateEmployeeSalaryDto,
  UpdateEmployeeSalaryDto,
} from './dto/employee-salary-write.dto';
import {
  CreateEmployeePaymentHistoryDto,
  UpdateEmployeePaymentHistoryDto,
} from './dto/employee-payment-history.dto';
import { UpdateServiceItemRecipeDto } from './dto/service-item-recipe.dto';

jest.mock('uuid', () => ({ v4: () => 'test-id' }));

const STORE_A = '11111111-1111-4111-8111-111111111111';
const STORE_B = '22222222-2222-4222-8222-222222222222';
const OWNER_A = 'owner-a';
const OWNER_B = 'owner-b';
const STAFF_A = 'staff-a';
const PROFILE_A = '33333333-3333-4333-8333-333333333333';
const OWNER_PROFILE_A = '44444444-4444-4444-8444-444444444444';
const ROW_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROW_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const KPI_ID = '55555555-5555-4555-8555-555555555555';
const STAFF_A2 = 'staff-a2';
const PROFILE_A2 = '77777777-7777-4777-8777-777777777777';
const MULTI = 'multi-store-staff';
const TASK_ID = '88888888-8888-4888-8888-888888888888';
const REQUEST_ID = '66666666-6666-4666-8666-666666666666';

/** A repository whose `exists` answers from rows keyed by id -> storeId. */
function scopedRepository(rows: Record<string, string>, extra: any = {}) {
  return {
    exists: jest.fn(async ({ where }: any) => {
      const storeId = rows[where.id];
      if (!storeId) return false;
      const scope = where.storeId;
      if (typeof scope === 'string') return storeId === scope;
      return (scope?.value as string[]).includes(storeId);
    }),
    findOne: jest.fn(async ({ where }: any) =>
      rows[where.id] ? { id: where.id, storeId: rows[where.id] } : null,
    ),
    update: jest.fn(async () => ({ affected: 1 })),
    create: jest.fn((value: any) => ({ ...value })),
    save: jest.fn(async (value: any) => value),
    ...extra,
  };
}

function buildService() {
  const service = Object.create(StoresService.prototype) as any;
  const stores: Record<string, string> = {
    [STORE_A]: OWNER_A,
    [STORE_B]: OWNER_B,
  };
  const profiles: any[] = [
    {
      id: PROFILE_A,
      storeId: STORE_A,
      accountId: STAFF_A,
      employmentStatus: EmploymentStatus.ACTIVE,
    },
    {
      id: OWNER_PROFILE_A,
      storeId: STORE_A,
      accountId: OWNER_A,
      employmentStatus: EmploymentStatus.ACTIVE,
    },
    // Another member of store A.
    {
      id: PROFILE_A2,
      storeId: STORE_A,
      accountId: STAFF_A2,
      employmentStatus: EmploymentStatus.PROBATION,
    },
    // Employed at both stores.
    { id: 'multi-a', storeId: STORE_A, accountId: MULTI, employmentStatus: EmploymentStatus.ACTIVE },
    { id: 'multi-b', storeId: STORE_B, accountId: MULTI, employmentStatus: EmploymentStatus.ACTIVE },
  ];
  const matches = (row: any, where: any) =>
    Object.entries(where).every(([key, value]: [string, any]) =>
      value && typeof value === 'object' && '_value' in value
        ? (value._value as unknown[]).includes(row[key])
        : row[key] === value,
    );
  const storeRepository = {
    findOne: jest.fn(async ({ where }: any) =>
      stores[where.id]
        ? { id: where.id, ownerAccountId: stores[where.id], name: 'Store' }
        : null,
    ),
    find: jest.fn(async ({ where }: any) =>
      Object.entries(stores)
        .filter(([, owner]) => owner === where.ownerAccountId)
        .map(([id]) => ({ id })),
    ),
  };
  const profileRepository = {
    findOne: jest.fn(
      async ({ where }: any) => profiles.find((row) => matches(row, where)) ?? null,
    ),
    find: jest.fn(async ({ where }: any) =>
      profiles.filter((row) => matches(row, where)),
    ),
    exists: jest.fn(async ({ where }: any) =>
      profiles.some(
        (row) =>
          row.id === where.id &&
          (typeof where.storeId === 'string'
            ? row.storeId === where.storeId
            : (where.storeId.value as string[]).includes(row.storeId)),
      ),
    ),
  };
  const queryBuilder: any = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  };
  const kpiApprovalRequestRepository = {
    createQueryBuilder: jest.fn(() => queryBuilder),
    findOne: jest.fn(),
    create: jest.fn((value: any) => ({ ...value })),
    save: jest.fn(async (value: any) => value),
  };
  const txRequests = {
    update: jest.fn(async () => ({ affected: 1 })),
    findOne: jest.fn(async (): Promise<any> => ({ id: REQUEST_ID })),
    create: jest.fn((value: any) => ({ ...value })),
    save: jest.fn(async (value: any) => value),
  };
  const txKpis = {
    update: jest.fn(async () => ({ affected: 1 })),
    findOne: jest.fn(async ({ where }: any) => ({ id: where.id })),
  };
  const manager = {
    getRepository: jest.fn((entity: any) =>
      entity.name === 'KpiApprovalRequest' ? txRequests : txKpis,
    ),
  };
  const dataSource = {
    transaction: jest.fn(async (work: any) => work(manager)),
  };

  Object.assign(service, {
    storeRepository,
    profileRepository,
    kpiApprovalRequestRepository,
    dataSource,
    employeeKpiRepository: {
      findOne: jest.fn(),
      create: jest.fn((value: any) => ({ ...value })),
      save: jest.fn(async (value: any) => ({ ...value, id: KPI_ID })),
    },
    kpiTaskRepository: {
      create: jest.fn((value: any) => ({ ...value })),
      save: jest.fn(async (value: any) => value),
    },
    kpiUnitRepository: scopedRepository({ [ROW_A]: STORE_A, [ROW_B]: STORE_B }),
    kpiPeriodRepository: scopedRepository({ [ROW_A]: STORE_A }),
    kpiTypeRepository: scopedRepository({ [ROW_A]: STORE_A }),
    productRepository: scopedRepository({ [ROW_A]: STORE_A, [ROW_B]: STORE_B }),
    assetRepository: scopedRepository({ [ROW_A]: STORE_A, [ROW_B]: STORE_B }),
    productExportTypeRepository: scopedRepository({ [ROW_A]: STORE_A }),
    assetExportTypeRepository: scopedRepository({ [ROW_A]: STORE_A }),
    assetUnitRepository: scopedRepository({ [ROW_A]: STORE_A, [ROW_B]: STORE_B }),
    assetCategoryRepository: scopedRepository({ [ROW_A]: STORE_A }),
    assetStatusRepository: scopedRepository({ [ROW_A]: STORE_A }),
    productUnitRepository: scopedRepository({ [ROW_A]: STORE_A, [ROW_B]: STORE_B }),
    productCategoryRepository: scopedRepository({ [ROW_A]: STORE_A }),
    productStatusRepository: scopedRepository({ [ROW_A]: STORE_A }),
    payrollRepository: scopedRepository({ [ROW_A]: STORE_A, [ROW_B]: STORE_B }),
    storePaymentAccountRepository: scopedRepository(
      { [ROW_A]: STORE_A, [ROW_B]: STORE_B },
      {
        findOne: jest.fn(async ({ where }: any) =>
          where.id === ROW_A && where.storeId === STORE_A
            ? { id: ROW_A, bankName: 'VCB', accountNumber: '0011223344' }
            : null,
        ),
      },
    ),
    serviceCategoryRepository: scopedRepository({ [ROW_A]: STORE_A, [ROW_B]: STORE_B }),
    serviceItemRepository: scopedRepository({ [ROW_A]: STORE_A, [ROW_B]: STORE_B }),
    serviceItemRecipeRepository: scopedRepository(
      {},
      {
        findOne: jest.fn(async ({ where }: any) =>
          where.id === 'recipe-1'
            ? { id: 'recipe-1', serviceItemId: ROW_A }
            : null,
        ),
      },
    ),
    employeeSalaryRepository: {
      findOne: jest.fn(async () => ({ id: 'salary-1', employeeProfileId: PROFILE_A })),
      update: jest.fn(async () => ({ affected: 1 })),
      create: jest.fn((value: any) => ({ ...value })),
      save: jest.fn(async (value: any) => value),
    },
    employeePaymentHistoryRepository: {
      findOne: jest.fn(),
      create: jest.fn((value: any) => ({ ...value })),
      save: jest.fn(async (value: any) => value),
    },
    stockTransactionRepository: {
      create: jest.fn((value: any) => ({ ...value })),
      save: jest.fn(async (value: any) => ({ ...value, id: 'tx' })),
    },
    salaryAdjustmentReasonRepository: { findOne: jest.fn() },
    salaryAdjustmentRepository: {
      create: jest.fn((value: any) => ({ ...value })),
      save: jest.fn(async (value: any) => value),
    },
    logger: { debug: jest.fn(), warn: jest.fn(), log: jest.fn(), error: jest.fn() },
  });
  return { service, queryBuilder, txRequests, txKpis, profileRepository };
}

describe('H1: POST salary-adjustments is owner-only', () => {
  it('refuses an employee of the store before touching any pay', async () => {
    const { service, profileRepository } = buildService();
    profileRepository.findOne.mockResolvedValueOnce({
      id: PROFILE_A,
      storeId: STORE_A,
      contracts: [{ id: 'c1', isActive: true, salaryAmount: 1000 }],
    });
    await expect(
      service.createSalaryAdjustment(STAFF_A, {
        employeeProfileId: PROFILE_A,
        effectiveMonth: '2099-01',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(service.salaryAdjustmentRepository.save).not.toHaveBeenCalled();
  });

  it('refuses the owner of another store', async () => {
    const { service, profileRepository } = buildService();
    profileRepository.findOne.mockResolvedValueOnce({
      id: PROFILE_A,
      storeId: STORE_A,
      contracts: [{ id: 'c1', isActive: true, salaryAmount: 1000 }],
    });
    await expect(
      service.createSalaryAdjustment(OWNER_B, {
        employeeProfileId: PROFILE_A,
        effectiveMonth: '2099-01',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("lets the store's owner through, with a reason from that store only", async () => {
    const { service, profileRepository } = buildService();
    profileRepository.findOne.mockResolvedValueOnce({
      id: PROFILE_A,
      storeId: STORE_A,
      contracts: [{ id: 'c1', isActive: true, salaryAmount: 1000 }],
    });
    service.salaryAdjustmentReasonRepository.findOne.mockResolvedValueOnce(null);
    await expect(
      service.createSalaryAdjustment(OWNER_A, {
        employeeProfileId: PROFILE_A,
        effectiveMonth: '2099-01',
        reasonId: ROW_B,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(service.salaryAdjustmentReasonRepository.findOne).toHaveBeenCalledWith({
      where: { id: ROW_B, storeId: STORE_A },
    });
  });
});

describe('H1: GET kpi-approval-requests', () => {
  /** Runs the Brackets passed to andWhere against a recording builder. */
  const bracketClauses = (queryBuilder: any) => {
    const call = queryBuilder.andWhere.mock.calls.find(
      ([clause]: any[]) => clause instanceof Brackets,
    );
    if (!call) return null;
    const recorded: any[] = [];
    const where: any = {
      orWhere: jest.fn((...args: any[]) => {
        recorded.push(args);
        return where;
      }),
    };
    (call[0] as Brackets).whereFactory(where);
    return recorded;
  };

  it("without storeId scopes an owner to the stores they own", async () => {
    const { service, queryBuilder } = buildService();
    await expect(
      service.getKpiApprovalRequests(undefined, undefined, OWNER_A),
    ).resolves.toEqual([]);
    // OWNER_A also has a profile at STORE_A: both scopes, OR-ed.
    expect(bracketClauses(queryBuilder)).toEqual([
      ['profile.store_id IN (:...ownedStoreIds)', { ownedStoreIds: [STORE_A] }],
      [
        'kpi.employee_profile_id IN (:...ownProfileIds)',
        { ownProfileIds: [OWNER_PROFILE_A] },
      ],
    ]);
  });

  it('without storeId shows an employee only their own requests', async () => {
    const { service, queryBuilder } = buildService();
    await service.getKpiApprovalRequests(undefined, '2026-09', STAFF_A);
    expect(bracketClauses(queryBuilder)).toEqual([
      ['kpi.employee_profile_id IN (:...ownProfileIds)', { ownProfileIds: [PROFILE_A] }],
    ]);
    expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
      'profile.store_id = :storeId',
      expect.anything(),
    );
  });

  it('without storeId returns nothing (no query) for an account with no store', async () => {
    const { service } = buildService();
    await expect(
      service.getKpiApprovalRequests(undefined, undefined, 'stranger'),
    ).resolves.toEqual([]);
    expect(service.kpiApprovalRequestRepository.createQueryBuilder).not.toHaveBeenCalled();
    await expect(
      service.getKpiApprovalRequests(undefined, undefined, undefined),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a non-member of the store', async () => {
    const { service } = buildService();
    await expect(
      service.getKpiApprovalRequests(STORE_A, undefined, OWNER_B),
    ).rejects.toThrow(ForbiddenException);
  });

  it("scopes the owner to the store's employees", async () => {
    const { service, queryBuilder } = buildService();
    await service.getKpiApprovalRequests(STORE_A, '2026-09', OWNER_A);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'profile.store_id = :storeId',
      { storeId: STORE_A },
    );
    expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
      'kpi.employee_profile_id = :viewerProfileId',
      expect.anything(),
    );
  });

  it('shows an employee only their own KPIs', async () => {
    const { service, queryBuilder } = buildService();
    await service.getKpiApprovalRequests(STORE_A, undefined, STAFF_A);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'kpi.employee_profile_id = :viewerProfileId',
      { viewerProfileId: PROFILE_A },
    );
  });
});

describe('H1 + BE-10: PATCH kpi-approval-requests/:id/handle', () => {
  const pending = () => ({
    id: REQUEST_ID,
    status: KpiRequestStatus.PENDING,
    employeeKpiId: KPI_ID,
    employeeKpi: { id: KPI_ID, employeeProfileId: PROFILE_A },
  });

  it('refuses a member deciding (their own) KPI', async () => {
    const { service, txRequests } = buildService();
    service.kpiApprovalRequestRepository.findOne.mockResolvedValue(pending());
    await expect(
      service.handleKpiApprovalRequest(REQUEST_ID, STAFF_A, {
        status: KpiRequestStatus.APPROVED,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(txRequests.update).not.toHaveBeenCalled();
  });

  it('refuses an invalid status', async () => {
    const { service } = buildService();
    await expect(
      service.handleKpiApprovalRequest(REQUEST_ID, OWNER_A, { status: 'Chờ duyệt' }),
    ).rejects.toThrow(BadRequestException);
  });

  it("records the owner's profile id (never an account id) and activates the KPI", async () => {
    const { service, txRequests, txKpis } = buildService();
    service.kpiApprovalRequestRepository.findOne.mockResolvedValue(pending());
    await service.handleKpiApprovalRequest(REQUEST_ID, OWNER_A, {
      status: KpiRequestStatus.APPROVED,
      note: 'ok',
    });
    expect(txRequests.update).toHaveBeenCalledWith(
      { id: REQUEST_ID, status: KpiRequestStatus.PENDING },
      { status: KpiRequestStatus.APPROVED, reviewerId: OWNER_PROFILE_A, note: 'ok' },
    );
    expect(txKpis.update).toHaveBeenCalledWith(KPI_ID, { status: KpiStatus.ACTIVE });
  });

  it('stores a null reviewer when the owner has no profile in the store', async () => {
    const { service, txRequests, profileRepository } = buildService();
    service.kpiApprovalRequestRepository.findOne.mockResolvedValue(pending());
    const original = profileRepository.findOne.getMockImplementation()!;
    profileRepository.findOne.mockImplementation(async (args: any) =>
      args.where.accountId === OWNER_A ? null : original(args),
    );
    await service.handleKpiApprovalRequest(REQUEST_ID, OWNER_A, {
      status: KpiRequestStatus.REJECTED,
    });
    expect(txRequests.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reviewerId: null }),
    );
  });

  it('answers 400 when a concurrent decision already applied', async () => {
    const { service, txRequests, txKpis } = buildService();
    service.kpiApprovalRequestRepository.findOne.mockResolvedValue(pending());
    txRequests.update.mockResolvedValueOnce({ affected: 0 });
    await expect(
      service.handleKpiApprovalRequest(REQUEST_ID, OWNER_A, {
        status: KpiRequestStatus.APPROVED,
      }),
    ).rejects.toThrow('Yêu cầu này đã được xử lý');
    expect(txKpis.update).not.toHaveBeenCalled();
  });

  it('answers 400 for an already handled request', async () => {
    const { service } = buildService();
    service.kpiApprovalRequestRepository.findOne.mockResolvedValue({
      ...pending(),
      status: KpiRequestStatus.APPROVED,
    });
    await expect(
      service.handleKpiApprovalRequest(REQUEST_ID, OWNER_A, {
        status: KpiRequestStatus.REJECTED,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('BE-10: POST kpi-approval-requests', () => {
  it('takes the employee from the KPI, not the body', async () => {
    const { service, txRequests } = buildService();
    service.employeeKpiRepository.findOne.mockResolvedValue({
      id: KPI_ID,
      employeeProfileId: PROFILE_A,
    });
    txRequests.findOne.mockResolvedValueOnce(null);
    const saved = await service.createKpiApprovalRequest(
      { employeeKpiId: KPI_ID, employeeProfileId: 'forged', note: 'n' },
      STAFF_A,
    );
    expect(saved).toEqual({
      employeeProfileId: PROFILE_A,
      employeeKpiId: KPI_ID,
      note: 'n',
      status: KpiRequestStatus.PENDING,
    });
  });

  it('returns the pending request instead of inserting a duplicate, under the KPI lock', async () => {
    const { service, txRequests, txKpis } = buildService();
    service.employeeKpiRepository.findOne.mockResolvedValue({
      id: KPI_ID,
      employeeProfileId: PROFILE_A,
    });
    const pending = { id: REQUEST_ID, status: KpiRequestStatus.PENDING };
    txRequests.findOne.mockResolvedValueOnce(pending);
    await expect(
      service.createKpiApprovalRequest({ employeeKpiId: KPI_ID }, STAFF_A),
    ).resolves.toBe(pending);
    expect(txKpis.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: KPI_ID },
        lock: { mode: 'pessimistic_write' },
      }),
    );
    // The pending check runs after the lock, inside the same transaction.
    expect(txKpis.findOne.mock.invocationCallOrder[0]).toBeLessThan(
      txRequests.findOne.mock.invocationCallOrder[0],
    );
    expect(txRequests.findOne).toHaveBeenCalledWith({
      where: { employeeKpiId: KPI_ID, status: KpiRequestStatus.PENDING },
    });
    expect(txRequests.save).not.toHaveBeenCalled();
  });

  it('404s an unknown KPI and refuses a non-member', async () => {
    const { service } = buildService();
    service.employeeKpiRepository.findOne.mockResolvedValueOnce(null);
    await expect(
      service.createKpiApprovalRequest({ employeeKpiId: KPI_ID }, STAFF_A),
    ).rejects.toThrow(NotFoundException);
    service.employeeKpiRepository.findOne.mockResolvedValueOnce({
      id: KPI_ID,
      employeeProfileId: PROFILE_A,
    });
    await expect(
      service.createKpiApprovalRequest({ employeeKpiId: KPI_ID }, OWNER_B),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('H1: bulk stock-out (products/export, assets/export)', () => {
  const productItem = (overrides: any = {}) => ({
    storeId: STORE_A,
    productId: ROW_A,
    productExportTypeId: ROW_A,
    quantity: 1,
    exportDate: '2026-09-01',
    ...overrides,
  });

  it('refuses a caller who is not a member of the items store', async () => {
    const { service } = buildService();
    await expect(
      service.exportProductsBulk({ items: [productItem()] }, [], OWNER_B),
    ).rejects.toThrow(ForbiddenException);
    expect(service.stockTransactionRepository.save).not.toHaveBeenCalled();
  });

  it('refuses an item of a store the caller does not belong to, or with no store', async () => {
    const { service } = buildService();
    await expect(
      service.exportProductsBulk(
        { items: [productItem(), productItem({ storeId: STORE_B })] },
        [],
        OWNER_A,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(service.stockTransactionRepository.save).not.toHaveBeenCalled();
    await expect(
      service.exportAssetsBulk({ items: [{ assetId: ROW_A }] }, [], OWNER_A),
    ).rejects.toThrow(BadRequestException);
    await expect(service.exportAssetsBulk({ items: [] }, [], OWNER_A)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses a product or asset of another store before any write', async () => {
    const { service } = buildService();
    await expect(
      service.exportProductsBulk(
        { items: [productItem(), productItem({ productId: ROW_B })] },
        [],
        STAFF_A,
      ),
    ).rejects.toThrow('Hàng hóa không thuộc cửa hàng này');
    await expect(
      service.exportAssetsBulk(
        {
          items: [
            { storeId: STORE_A, assetId: ROW_B, assetExportTypeId: ROW_A, quantity: 1 },
          ],
        },
        [],
        STAFF_A,
      ),
    ).rejects.toThrow('Tài sản không thuộc cửa hàng này');
    expect(service.stockTransactionRepository.save).not.toHaveBeenCalled();
  });
});

describe('H1: member KPI writes stay in the addressed store', () => {
  it('refuses a KPI for an employee of a store the caller does not belong to', async () => {
    const { service } = buildService();
    await expect(
      service.createEmployeeKpi({ employeeProfileId: PROFILE_A, tasks: [] }, OWNER_B),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a KPI applied to a store the caller does not belong to', async () => {
    const { service } = buildService();
    await expect(
      service.createEmployeeKpi(
        { employeeProfileId: PROFILE_A, storeIds: [STORE_B], tasks: [] },
        STAFF_A,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a task unit from another store', async () => {
    const { service } = buildService();
    await expect(
      service.createEmployeeKpi(
        {
          employeeProfileId: PROFILE_A,
          storeId: STORE_A,
          tasks: [{ taskName: 't', target: 10, kpiUnitId: ROW_B }],
        },
        OWNER_A,
      ),
    ).rejects.toThrow('Đơn vị đo lường không thuộc cửa hàng này');
    expect(service.employeeKpiRepository.save).not.toHaveBeenCalled();
  });

  it('refuses POST kpi-tasks for a KPI of a store the caller does not belong to', async () => {
    const { service } = buildService();
    service.employeeKpiRepository.findOne.mockResolvedValue({
      id: KPI_ID,
      employeeProfileId: PROFILE_A,
      storeIds: [STORE_A],
    });
    await expect(
      service.createKpiTask({ employeeKpiId: KPI_ID, taskName: 't' }, OWNER_B),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('BE-10: KPI tasks', () => {
  it("reads the released owner app's tasks[].storeIds into storeId", async () => {
    const { service } = buildService();
    service.employeeKpiRepository.findOne.mockResolvedValue({ id: KPI_ID });
    service.summarizeKpi = jest.fn((kpi: any) => kpi);
    await service.createEmployeeKpi(
      {
        employeeProfileId: PROFILE_A,
        storeId: STORE_A,
        name: 'KPI',
        tasks: [
          { taskName: 't', target: 10, actualValue: 5, storeIds: [STORE_A], kpiUnitId: ROW_A },
        ],
      },
      OWNER_A,
    );
    expect(service.kpiTaskRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: STORE_A,
        employeeKpiId: KPI_ID,
        completionRate: 50,
      }),
    );
    const created = service.kpiTaskRepository.create.mock.calls[0][0];
    expect(created).not.toHaveProperty('storeIds');
  });

  it('falls back to the KPI store when a task names a store outside the KPI', async () => {
    const { service } = buildService();
    service.employeeKpiRepository.findOne.mockResolvedValue({
      id: KPI_ID,
      employeeProfileId: PROFILE_A,
      storeIds: [STORE_A],
      status: KpiStatus.DRAFT,
    });
    await service.createKpiTask(
      { employeeKpiId: KPI_ID, taskName: 't', target: 1, storeId: STORE_B },
      STAFF_A,
    );
    expect(service.kpiTaskRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: STORE_A }),
    );
  });

  it('asks for the `tasks` relation for AI suggestions', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.employeeKpiRepository = { find: jest.fn().mockResolvedValue([]) };
    service.performanceRepository = { find: jest.fn().mockResolvedValue([]) };
    await service.requestKpiAiSuggestion({
      storeId: STORE_A,
      employeeProfileId: PROFILE_A,
    });
    expect(service.employeeKpiRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ relations: ['tasks'] }),
    );
  });

  it('clamps completionRate to the decimal(5,2) range', () => {
    expect(kpiCompletionRate(5000, 10)).toBe(999.99);
    expect(kpiCompletionRate(1, 3)).toBe(33.33);
    expect(kpiCompletionRate(undefined, 10)).toBe(0);
    expect(kpiCompletionRate(5, 0)).toBe(0);
  });
});

describe('H3: whitelisted bodies and foreign keys in the resolved store', () => {
  const invalidFields = async (cls: any, body: any) => {
    const errors = await validate(plainToInstance(cls, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return errors.map((error) => error.property);
  };

  it('rejects id and relation objects in every new DTO', async () => {
    expect(
      await invalidFields(CreateEmployeeSalaryDto, {
        employeeProfileId: PROFILE_A,
        month: '2026-09',
        id: ROW_B,
        employeeProfile: { id: ROW_B },
        paymentStatus: 'Đã thanh toán',
      }),
    ).toEqual(expect.arrayContaining(['id', 'employeeProfile', 'paymentStatus']));
    expect(
      await invalidFields(UpdateEmployeeSalaryDto, { monthlyPayroll: { id: ROW_B } }),
    ).toEqual(['monthlyPayroll']);
    expect(
      await invalidFields(CreateEmployeePaymentHistoryDto, {
        employeeProfileId: PROFILE_A,
        salaryMonth: '2026-09-01',
        employeeProfile: { id: ROW_B },
        paymentAccountInfo: 'x',
      }),
    ).toEqual(expect.arrayContaining(['employeeProfile', 'paymentAccountInfo']));
    expect(
      await invalidFields(UpdateEmployeePaymentHistoryDto, {
        id: ROW_B,
        employeeProfileId: PROFILE_A,
      }),
    ).toEqual(expect.arrayContaining(['id', 'employeeProfileId']));
    expect(
      await invalidFields(UpdateServiceItemRecipeDto, { id: ROW_B, quantity: 2 }),
    ).toEqual(['id']);
  });

  it('POST employee-salaries refuses a payroll of another store', async () => {
    const { service } = buildService();
    await expect(
      service.createEmployeeSalaryForStore({
        employeeProfileId: PROFILE_A,
        month: '2026-09',
        monthlyPayrollId: ROW_B,
      }),
    ).rejects.toThrow('Bảng lương không thuộc cửa hàng này');
    await service.createEmployeeSalaryForStore({
      employeeProfileId: PROFILE_A,
      month: '2026-09',
      monthlyPayrollId: ROW_A,
      netSalary: 10,
    });
    expect(service.employeeSalaryRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeProfileId: PROFILE_A,
        monthlyPayrollId: ROW_A,
        month: expect.any(Date),
      }),
    );
  });

  it("PUT employee-salaries/:id refuses a payroll outside the payslip's store", async () => {
    const { service } = buildService();
    await expect(
      service.updateEmployeeSalary('salary-1', { monthlyPayrollId: ROW_B }),
    ).rejects.toThrow('Bảng lương không thuộc cửa hàng này');
    expect(service.employeeSalaryRepository.update).not.toHaveBeenCalled();
  });

  it('POST payment-histories refuses another store account or storeId', async () => {
    const { service } = buildService();
    await expect(
      service.createEmployeePaymentHistory({
        employeeProfileId: PROFILE_A,
        salaryMonth: '2026-09-01',
        paymentAccountId: ROW_B,
      }),
    ).rejects.toThrow('Tài khoản thanh toán không thuộc cửa hàng này');
    await expect(
      service.createEmployeePaymentHistory({
        employeeProfileId: PROFILE_A,
        salaryMonth: '2026-09-01',
        storeId: STORE_B,
      }),
    ).rejects.toThrow(BadRequestException);
    const saved = await service.createEmployeePaymentHistory({
      employeeProfileId: PROFILE_A,
      salaryMonth: '2026-09-01',
      paymentAccountId: ROW_A,
      amount: 5,
    });
    expect(saved).toEqual(
      expect.objectContaining({
        storeId: STORE_A,
        paymentAccountInfo: 'VCB - ****3344',
      }),
    );
  });

  it('PATCH payment-histories/:id keeps the row and checks the account store', async () => {
    const { service } = buildService();
    const row = { id: 'pay-1', storeId: STORE_A, employeeProfileId: PROFILE_A };
    service.employeePaymentHistoryRepository.findOne.mockResolvedValue(row);
    await expect(
      service.updateEmployeePaymentHistory('pay-1', { paymentAccountId: ROW_B }),
    ).rejects.toThrow('Tài khoản thanh toán không thuộc cửa hàng này');
    const saved = await service.updateEmployeePaymentHistory('pay-1', {
      amount: 7,
      id: ROW_B,
    } as any);
    expect(saved.id).toBe('pay-1');
  });

  it('PUT service-item-recipes/:id keeps both ends in the recipe store', async () => {
    const { service } = buildService();
    await expect(
      service.updateServiceItemRecipe('recipe-1', { productId: ROW_B }),
    ).rejects.toThrow('Nguyên liệu không thuộc cửa hàng này');
    await expect(
      service.updateServiceItemRecipe('recipe-1', { serviceItemId: ROW_B }),
    ).rejects.toThrow('Mặt hàng không thuộc cửa hàng này');
    expect(service.serviceItemRecipeRepository.update).not.toHaveBeenCalled();
  });
});

describe('H4: multipart owner updates ignore body storeId and check references', () => {
  it('PUT service-items/:id never moves the item and keeps its category in store', async () => {
    const { service } = buildService();
    service.getServiceItemById = jest.fn();
    await service.updateServiceItem(ROW_A, {
      storeId: STORE_B,
      id: ROW_B,
      name: 'Latte',
    });
    expect(service.serviceItemRepository.update).toHaveBeenCalledWith(ROW_A, {
      name: 'Latte',
    });
    await expect(
      service.updateServiceItem(ROW_A, { categoryId: ROW_B }),
    ).rejects.toThrow('Danh mục không thuộc cửa hàng này');
  });

  it('PUT assets/:id refuses a unit or responsible employee of another store', async () => {
    const { service } = buildService();
    await expect(
      service.updateAsset(ROW_A, { assetUnitId: ROW_B }),
    ).rejects.toThrow('Đơn vị tính không thuộc cửa hàng này');
    await expect(
      service.updateAsset(ROW_A, { responsibleEmployeeId: ROW_B }),
    ).rejects.toThrow('Nhân viên phụ trách không thuộc cửa hàng này');
    await service.updateAsset(ROW_A, {
      storeId: STORE_B,
      assetUnitId: ROW_A,
      responsibleEmployeeId: PROFILE_A,
    } as any);
    expect(service.assetRepository.update).toHaveBeenCalledWith(ROW_A, {
      assetUnitId: ROW_A,
      responsibleEmployeeId: PROFILE_A,
    });
  });

  it('PUT products/:id refuses a unit of another store', async () => {
    const { service } = buildService();
    await expect(
      service.updateProduct(ROW_A, { productUnitId: ROW_B }),
    ).rejects.toThrow('Đơn vị tính không thuộc cửa hàng này');
    expect(service.productRepository.update).not.toHaveBeenCalled();
  });
});

/** Rejects with a 403 whose body carries `code`. */
async function expectForbiddenCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e) => e,
  );
  expect(error).toBeInstanceOf(ForbiddenException);
  expect((error as ForbiddenException).getResponse()).toMatchObject({ code });
}

describe('KPI integrity: who may write a KPI', () => {
  const kpiService = (status: KpiStatus) => {
    const built = buildService();
    const { service } = built;
    const kpi = { id: KPI_ID, employeeProfileId: PROFILE_A, storeIds: [STORE_A], status, tasks: [] };
    service.employeeKpiRepository.findOne.mockResolvedValue(kpi);
    service.employeeKpiRepository.softDelete = jest.fn(async () => ({ affected: 1 }));
    service.getEmployeeKpiById = jest.fn(async (id: string) => ({ id }));
    service.kpiTaskRepository.findOne = jest.fn(async () => ({
      id: TASK_ID,
      employeeKpiId: KPI_ID,
      target: 10,
      actualValue: 0,
    }));
    service.kpiTaskRepository.delete = jest.fn(async () => ({ affected: 1 }));
    return { ...built, kpi };
  };

  describe('POST employee-kpis', () => {
    const body = (overrides: any = {}) => ({
      employeeProfileId: PROFILE_A,
      name: 'KPI',
      status: KpiStatus.ACTIVE,
      tasks: [],
      ...overrides,
    });
    const created = () => {
      const { service } = buildService();
      service.employeeKpiRepository.findOne.mockResolvedValue({ id: KPI_ID });
      service.summarizeKpi = jest.fn((kpi: any) => kpi);
      return service;
    };

    it("forces an employee's own KPI to 'Nháp', ignoring the client status", async () => {
      const service = created();
      await service.createEmployeeKpi(body(), STAFF_A);
      expect(service.employeeKpiRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeProfileId: PROFILE_A,
          status: KpiStatus.DRAFT,
        }),
      );
    });

    it('refuses an employee creating a KPI for a colleague', async () => {
      const service = created();
      await expectForbiddenCode(
        service.createEmployeeKpi(body(), STAFF_A2),
        KPI_SELF_OR_OWNER_REQUIRED,
      );
      expect(service.employeeKpiRepository.save).not.toHaveBeenCalled();
    });

    it("keeps the owner's status", async () => {
      const service = created();
      await service.createEmployeeKpi(body(), OWNER_A);
      expect(service.employeeKpiRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: KpiStatus.ACTIVE }),
      );
    });

    it('404s an unknown employee profile', async () => {
      const service = created();
      await expect(
        service.createEmployeeKpi(body({ employeeProfileId: ROW_B }), OWNER_A),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('duplicate / delete an employee KPI', () => {
    it('lets the KPI employee act only while it is a draft', async () => {
      const active = kpiService(KpiStatus.ACTIVE);
      await expectForbiddenCode(
        active.service.duplicateEmployeeKpi(KPI_ID, STAFF_A),
        KPI_NOT_DRAFT,
      );
      await expectForbiddenCode(
        active.service.deleteEmployeeKpi(KPI_ID, STAFF_A),
        KPI_NOT_DRAFT,
      );
      expect(active.service.employeeKpiRepository.save).not.toHaveBeenCalled();
      expect(active.service.employeeKpiRepository.softDelete).not.toHaveBeenCalled();

      const draft = kpiService(KpiStatus.DRAFT);
      await draft.service.duplicateEmployeeKpi(KPI_ID, STAFF_A);
      expect(draft.service.employeeKpiRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: KpiStatus.DRAFT }),
      );
      await draft.service.deleteEmployeeKpi(KPI_ID, STAFF_A);
      expect(draft.service.employeeKpiRepository.softDelete).toHaveBeenCalledWith(KPI_ID);
    });

    it('refuses another member even on a draft, and lets the owner act on any status', async () => {
      const draft = kpiService(KpiStatus.DRAFT);
      await expectForbiddenCode(
        draft.service.deleteEmployeeKpi(KPI_ID, STAFF_A2),
        KPI_SELF_OR_OWNER_REQUIRED,
      );
      await expectForbiddenCode(
        draft.service.duplicateEmployeeKpi(KPI_ID, STAFF_A2),
        KPI_SELF_OR_OWNER_REQUIRED,
      );
      await expect(
        draft.service.deleteEmployeeKpi(KPI_ID, OWNER_B),
      ).rejects.toThrow(ForbiddenException);

      const completed = kpiService(KpiStatus.COMPLETED);
      await completed.service.deleteEmployeeKpi(KPI_ID, OWNER_A);
      expect(completed.service.employeeKpiRepository.softDelete).toHaveBeenCalledWith(KPI_ID);
      await completed.service.duplicateEmployeeKpi(KPI_ID, OWNER_A);
      expect(completed.service.employeeKpiRepository.save).toHaveBeenCalled();
    });

    it('404s an unknown KPI on delete', async () => {
      const { service } = kpiService(KpiStatus.DRAFT);
      service.employeeKpiRepository.findOne.mockResolvedValue(null);
      await expect(service.deleteEmployeeKpi(KPI_ID, OWNER_A)).rejects.toThrow(
        NotFoundException,
      );
      expect(service.employeeKpiRepository.softDelete).not.toHaveBeenCalled();
    });
  });

  describe('KPI tasks: create / delete / hide', () => {
    it('refuses the KPI employee once the KPI is no longer a draft', async () => {
      const { service } = kpiService(KpiStatus.ACTIVE);
      await expectForbiddenCode(
        service.createKpiTask({ employeeKpiId: KPI_ID, taskName: 't', target: 1 }, STAFF_A),
        KPI_NOT_DRAFT,
      );
      await expectForbiddenCode(service.deleteKpiTask(TASK_ID, STAFF_A), KPI_NOT_DRAFT);
      await expectForbiddenCode(service.hideKpiTask(TASK_ID, STAFF_A), KPI_NOT_DRAFT);
      expect(service.kpiTaskRepository.save).not.toHaveBeenCalled();
      expect(service.kpiTaskRepository.delete).not.toHaveBeenCalled();
    });

    it('lets the KPI employee edit a draft, refuses colleagues, and always lets the owner', async () => {
      const draft = kpiService(KpiStatus.DRAFT);
      await draft.service.deleteKpiTask(TASK_ID, STAFF_A);
      expect(draft.service.kpiTaskRepository.delete).toHaveBeenCalledWith(TASK_ID);
      await draft.service.hideKpiTask(TASK_ID, STAFF_A);
      expect(draft.service.kpiTaskRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ isHidden: true }),
      );
      await expectForbiddenCode(
        draft.service.createKpiTask({ employeeKpiId: KPI_ID, taskName: 't' }, STAFF_A2),
        KPI_SELF_OR_OWNER_REQUIRED,
      );

      const active = kpiService(KpiStatus.ACTIVE);
      await active.service.createKpiTask(
        { employeeKpiId: KPI_ID, taskName: 't', target: 1 },
        OWNER_A,
      );
      await active.service.deleteKpiTask(TASK_ID, OWNER_A);
      expect(active.service.kpiTaskRepository.delete).toHaveBeenCalledWith(TASK_ID);
    });
  });

  describe('PATCH kpi-tasks/:id/progress', () => {
    it("lets the KPI's own employee self-report progress on an active KPI", async () => {
      const { service } = kpiService(KpiStatus.ACTIVE);
      await service.updateKpiTaskProgress(TASK_ID, 5, STAFF_A);
      expect(service.kpiTaskRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ actualValue: 5, completionRate: 50 }),
      );
    });

    it('refuses a colleague and the owner of another store', async () => {
      const { service } = kpiService(KpiStatus.ACTIVE);
      await expectForbiddenCode(
        service.updateKpiTaskProgress(TASK_ID, 5, STAFF_A2),
        KPI_SELF_OR_OWNER_REQUIRED,
      );
      await expect(service.updateKpiTaskProgress(TASK_ID, 5, OWNER_B)).rejects.toThrow(
        ForbiddenException,
      );
      expect(service.kpiTaskRepository.save).not.toHaveBeenCalled();
    });

    it('refuses the employee on a KPI the owner closed; the owner still may', async () => {
      for (const status of [KpiStatus.COMPLETED, KpiStatus.CANCELLED]) {
        const { service } = kpiService(status);
        await expectForbiddenCode(
          service.updateKpiTaskProgress(TASK_ID, 10, STAFF_A),
          KPI_CLOSED,
        );
        expect(service.kpiTaskRepository.save).not.toHaveBeenCalled();
        await service.updateKpiTaskProgress(TASK_ID, 10, OWNER_A);
        expect(service.kpiTaskRepository.save).toHaveBeenCalled();
      }
    });
  });
});

describe('bulk stock-out: per-item store scope and required stock rows', () => {
  const stocked = (built: ReturnType<typeof buildService>) => {
    const { service } = built;
    const stock: Record<string, any> = {
      [ROW_A]: { id: ROW_A, storeId: STORE_A, name: 'A', currentStock: 5, costPrice: 2, value: 3 },
      [ROW_B]: { id: ROW_B, storeId: STORE_B, name: 'B', currentStock: 5, costPrice: 4, value: 5 },
    };
    const findOne = jest.fn(async ({ where }: any) => {
      const row = stock[where.id];
      return row && row.storeId === where.storeId ? row : null;
    });
    service.productRepository.findOne = findOne;
    service.assetRepository.findOne = jest.fn(findOne);
    service.productExportTypeRepository = scopedRepository({ [ROW_A]: STORE_A, [ROW_B]: STORE_B });
    service.assetExportTypeRepository = scopedRepository({ [ROW_A]: STORE_A, [ROW_B]: STORE_B });
    service.stockTransactionDetailRepository = {
      create: jest.fn((value: any) => ({ ...value })),
      save: jest.fn(async (value: any) => value),
    };
    return stock;
  };
  const item = (overrides: any = {}) => ({
    storeId: STORE_A,
    productId: ROW_A,
    productExportTypeId: ROW_A,
    quantity: 1,
    exportDate: '2026-09-01',
    ...overrides,
  });

  it('accepts items of several stores the caller belongs to, each in its own store', async () => {
    const built = buildService();
    const stock = stocked(built);
    const { service } = built;
    await service.exportProductsBulk(
      {
        items: [
          item({ quantity: 2 }),
          item({ storeId: STORE_B, productId: ROW_B, productExportTypeId: ROW_B, quantity: 1 }),
        ],
      },
      [],
      MULTI,
    );
    const stores = service.stockTransactionRepository.create.mock.calls.map(
      ([value]: any[]) => value.storeId,
    );
    expect(stores).toEqual([STORE_A, STORE_B]);
    expect(stock[ROW_A].currentStock).toBe(3);
    expect(stock[ROW_B].currentStock).toBe(4);
  });

  it("refuses a row, or an export type, of another of the caller's stores", async () => {
    const built = buildService();
    stocked(built);
    const { service } = built;
    await expect(
      service.exportProductsBulk({ items: [item({ productId: ROW_B })] }, [], MULTI),
    ).rejects.toThrow('Hàng hóa không thuộc cửa hàng này');
    await expect(
      service.exportProductsBulk({ items: [item({ productExportTypeId: ROW_B })] }, [], MULTI),
    ).rejects.toThrow('Loại xuất kho không thuộc cửa hàng này');
    expect(service.stockTransactionRepository.save).not.toHaveBeenCalled();
  });

  it('requires a valid product/asset id and never looks up an undefined one', async () => {
    const built = buildService();
    stocked(built);
    const { service } = built;
    for (const productId of [undefined, '', 'not-a-uuid']) {
      await expect(
        service.exportProductsBulk({ items: [item({ productId })] }, [], OWNER_A),
      ).rejects.toThrow('Hàng hóa không hợp lệ');
    }
    await expect(
      service.exportAssetsBulk(
        { items: [{ storeId: STORE_A, assetExportTypeId: ROW_A, quantity: 1 }] },
        [],
        OWNER_A,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(service.productRepository.findOne).not.toHaveBeenCalled();
    expect(service.assetRepository.findOne).not.toHaveBeenCalled();
    expect(service.stockTransactionRepository.save).not.toHaveBeenCalled();
  });

  it('checks quantities and total stock before any write', async () => {
    const built = buildService();
    stocked(built);
    const { service } = built;
    await expect(
      service.exportProductsBulk({ items: [item({ quantity: 0 })] }, [], OWNER_A),
    ).rejects.toThrow('Số lượng xuất phải lớn hơn 0');
    await expect(
      service.exportProductsBulk({ items: [item({ quantity: -3 })] }, [], OWNER_A),
    ).rejects.toThrow(BadRequestException);
    // 3 + 3 > 5 in stock: refused although each item alone fits.
    await expect(
      service.exportProductsBulk(
        { items: [item({ quantity: 3 }), item({ quantity: 3 })] },
        [],
        OWNER_A,
      ),
    ).rejects.toThrow('vượt quá tồn kho');
    expect(service.stockTransactionRepository.save).not.toHaveBeenCalled();
  });

  it('exports an asset of the item store and decrements its stock', async () => {
    const built = buildService();
    const stock = stocked(built);
    const { service } = built;
    await service.exportAssetsBulk(
      { items: [{ storeId: STORE_A, assetId: ROW_A, assetExportTypeId: ROW_A, quantity: 2 }] },
      [],
      STAFF_A,
    );
    expect(service.stockTransactionDetailRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: ROW_A, quantity: 2, totalPrice: 6 }),
    );
    expect(stock[ROW_A].currentStock).toBe(3);
  });
});

describe('create routes never take row identity or relation objects', () => {
  it('KPI type / unit / period keep only their own columns', async () => {
    const { service } = buildService();
    const body = {
      id: ROW_B,
      storeId: STORE_B,
      store: { id: STORE_B },
      createdAt: '2020-01-01',
      name: 'n',
      description: 'd',
      isActive: true,
    };
    await service.createKpiType(STORE_A, body);
    expect(service.kpiTypeRepository.create).toHaveBeenCalledWith({
      name: 'n',
      description: 'd',
      isActive: true,
      storeId: STORE_A,
    });
    await service.createKpiUnit(STORE_A, body);
    expect(service.kpiUnitRepository.create).toHaveBeenCalledWith({
      name: 'n',
      isActive: true,
      storeId: STORE_A,
    });
    await service.createKpiPeriod(STORE_A, body);
    expect(service.kpiPeriodRepository.create).toHaveBeenCalledWith({
      name: 'n',
      isActive: true,
      storeId: STORE_A,
    });
  });

  it('POST :id/service-items drops identity and keeps the category in store', async () => {
    const { service } = buildService();
    await expect(
      service.createServiceItem(STORE_A, { name: 'x', price: 1, categoryId: ROW_B }),
    ).rejects.toThrow('Danh mục không thuộc cửa hàng này');
    expect(service.serviceItemRepository.save).not.toHaveBeenCalled();

    await service.createServiceItem(STORE_A, {
      id: ROW_B,
      storeId: STORE_B,
      store: { id: STORE_B },
      category: { id: ROW_B },
      recipes: [{ productId: ROW_B }],
      name: 'x',
      price: 1,
      categoryId: ROW_A,
    });
    expect(service.serviceItemRepository.create).toHaveBeenCalledWith({
      name: 'x',
      price: 1,
      categoryId: ROW_A,
      storeId: STORE_A,
    });
  });

  it('simple catalogue creates drop the entity relations too', async () => {
    const { service } = buildService();
    service.assetCategoryRepository.metadata = {
      relations: [{ propertyName: 'store' }, { propertyName: 'assets' }],
    };
    await service.createAssetCategory(STORE_A, {
      id: ROW_B,
      storeId: STORE_B,
      assets: [{ id: ROW_B }],
      name: 'c',
    });
    expect(service.assetCategoryRepository.create).toHaveBeenCalledWith({
      name: 'c',
      storeId: STORE_A,
    });
  });

  it('bulk asset create keeps scalar columns only, then checks foreign keys', async () => {
    const { service } = buildService();
    service.stockTransactionDetailRepository = { save: jest.fn() };
    await service.createAssetsBulk(
      STORE_A,
      [
        {
          id: ROW_B,
          storeId: STORE_B,
          store: { id: STORE_B },
          responsibleEmployee: { id: 'someone-elsewhere' },
          assetCategory: { id: ROW_B },
          name: 'asset',
          assetCategoryId: ROW_A,
          currentStock: 0,
        },
      ],
      [],
    );
    expect(service.assetRepository.create).toHaveBeenCalledWith({
      name: 'asset',
      assetCategoryId: ROW_A,
      currentStock: 0,
      storeId: STORE_A,
    });

    await expect(
      service.createAssetsBulk(STORE_A, [{ name: 'a', assetUnitId: ROW_B }], []),
    ).rejects.toThrow('Đơn vị tính không thuộc cửa hàng này');
  });

  it('bulk product create keeps scalar columns only, then checks foreign keys', async () => {
    const { service } = buildService();
    service.stockTransactionDetailRepository = { save: jest.fn() };
    await service.createProductsBulk(
      STORE_A,
      [
        {
          id: ROW_B,
          store: { id: STORE_B },
          productUnit: { id: ROW_B },
          productCategory: { id: ROW_B },
          name: 'p',
          productUnitId: ROW_A,
          costPrice: 3,
        },
      ],
      [],
    );
    expect(service.productRepository.create).toHaveBeenCalledWith({
      name: 'p',
      productUnitId: ROW_A,
      costPrice: 3,
      storeId: STORE_A,
    });
    await expect(
      service.createProductsBulk(STORE_A, [{ name: 'p', productUnitId: ROW_B }], []),
    ).rejects.toThrow('Đơn vị tính không thuộc cửa hàng này');
  });
});
