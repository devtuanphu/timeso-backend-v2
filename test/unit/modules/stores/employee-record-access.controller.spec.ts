jest.mock('../../../../src/common/utils/multer-config', () => ({
  attendanceMulterConfig: {},
  multerConfig: {},
  mixedIdentityMulterConfig: () => ({}),
  identityImageUrl: (filename: string) => filename,
}));

/**
 * X7: employee record reads addressed by profile id are owner-or-self.
 *
 * StoreResourceAccessGuard only proves store membership, so before this change
 * any coworker could read another employee's identity document, bank data,
 * contracts, salary data, … These tests run the real authorization helpers
 * (StoresService.assertEmployeeRecordAccess / assertEmployeeSalaryAccess and
 * CareerLadderService.assertCanViewOwnCareer) against stub repositories.
 */
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';

import { CareerLadderService } from '../../../../src/modules/stores/career-ladder.service';
import { EmploymentStatus } from '../../../../src/modules/stores/entities/employee-profile.entity';
import { StoresController } from '../../../../src/modules/stores/stores.controller';
import { StoresService } from '../../../../src/modules/stores/stores.service';

const PROFILES: Record<string, any> = {
  'emp-1': {
    id: 'emp-1',
    storeId: 'store-a',
    accountId: 'staff-1',
    employmentStatus: EmploymentStatus.ACTIVE,
  },
  'emp-t': {
    id: 'emp-t',
    storeId: 'store-a',
    accountId: 'staff-t',
    employmentStatus: EmploymentStatus.TERMINATED,
  },
};
const STORES: Record<string, any> = {
  'store-a': { id: 'store-a', ownerAccountId: 'owner-a' },
  'store-b': { id: 'store-b', ownerAccountId: 'owner-b' },
};

const DATA_METHODS = [
  'getEmployeeSkill',
  'getEmployeePerformance',
  'getEmployeeAssets',
  'getLatestContract',
  'getEmployeeSalaryHistory',
  'getSalaryAdvanceRequests',
  'getSalaryAdjustments',
  'getEmployeeSalaryOverview',
  'getEmployeeSalaryDetailByMonth',
  'getEmployeePaymentHistories',
  'getFaceRegistration',
  'getNextShiftAssignment',
  'getSalaryInquiries',
  'getSalarySlipData',
  'createSalaryAdvanceRequest',
  'createSalaryInquiry',
  'createBonusWorkRequest',
] as const;

const EMPLOYEE_DETAIL = {
  profile: {
    id: 'emp-1',
    capabilityPoints: 42,
    terminationReasonId: null,
    terminationReason: null,
    account: {
      identityDocument: { documentNumber: 'id-doc' },
      finance: { bankNumber: 'bank' },
    },
    contracts: [{ id: 'c-1' }],
  },
  monthlySummary: null,
  recentActivities: [],
};

const HISTORY = [{ id: 'ev-1', note: 'owner note', toName: 'Senior' }];

function build() {
  const storesService = Object.create(StoresService.prototype) as any;
  storesService.profileRepository = {
    findOne: jest.fn(async ({ where }: any) => PROFILES[where.id] ?? null),
  };
  storesService.storeRepository = {
    findOne: jest.fn(async ({ where }: any) => STORES[where.id] ?? null),
  };
  for (const method of DATA_METHODS) {
    storesService[method] = jest.fn().mockResolvedValue({ ok: true });
  }
  storesService.getEmployeePerformance = jest
    .fn()
    .mockResolvedValue({ rankInPosition: 1 });
  storesService.getEmployeeById = jest
    .fn()
    .mockResolvedValue(JSON.parse(JSON.stringify(EMPLOYEE_DETAIL)));

  const careerLadderService = Object.create(CareerLadderService.prototype) as any;
  careerLadderService.profileRepository = storesService.profileRepository;
  careerLadderService.dataSource = {
    manager: {
      query: jest.fn(async (_sql: string, [storeId]: string[]) =>
        STORES[storeId] ? [{ owner_account_id: STORES[storeId].ownerAccountId }] : [],
      ),
    },
  };
  careerLadderService.getProgressionSummaryByProfileId = jest
    .fn()
    .mockResolvedValue({});
  careerLadderService.getProgressionStages = jest.fn().mockResolvedValue([]);
  careerLadderService.getCareerHistory = jest
    .fn()
    .mockResolvedValue(JSON.parse(JSON.stringify(HISTORY)));
  careerLadderService.nextRungs = jest.fn().mockResolvedValue([]);

  const shiftEndWorkflowService = {
    markOvertimePending: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new StoresController(
    storesService,
    {} as any,
    {} as any,
    {} as any,
    shiftEndWorkflowService as any,
    careerLadderService,
  );
  return { controller, storesService, careerLadderService, shiftEndWorkflowService };
}

type Call = (c: StoresController, profileId: string, user: any) => Promise<unknown>;

const ROUTES: Array<[string, Call]> = [
  ['GET employees/:profileId', (c, p, u) => c.getEmployeeById(p, u)],
  ['GET employees/:profileId/skill', (c, p, u) => c.getEmployeeSkill(p, u)],
  ['GET employees/:profileId/performance', (c, p, u) => c.getEmployeePerformance(p, u)],
  ['GET employees/:profileId/progression', (c, p, u) => c.getEmployeeProgression(p, u)],
  ['GET employees/:profileId/career-history', (c, p, u) => c.getCareerHistory(p, u)],
  [
    'GET employees/:profileId/next-rungs/:ladderId',
    (c, p, u) => c.getNextRungs(p, 'ladder-1', u),
  ],
  ['GET employees/:profileId/assets', (c, p, u) => c.getEmployeeAssets(p, u)],
  ['GET employees/:profileId/contracts/latest', (c, p, u) => c.getLatestContract(p, u)],
  [
    'GET employees/:profileId/salary-history',
    (c, p, u) => c.getEmployeeSalaryHistory(p, u, '1', '10'),
  ],
  [
    'GET employees/:profileId/salary-advance-requests',
    (c, p, u) => c.getEmployeeSalaryAdvanceRequests(p, u),
  ],
  ['GET salary-adjustments/:employeeProfileId', (c, p, u) => c.getSalaryAdjustments(p, u)],
  [
    'GET employees/:employeeProfileId/salary-overview',
    (c, p, u) => c.getEmployeeSalaryOverview(p, u),
  ],
  [
    'GET employees/:employeeProfileId/salary-details',
    (c, p, u) => c.getEmployeeSalaryDetailByMonth(p, '2026-09', u),
  ],
  [
    'GET employees/:employeeProfileId/payment-histories',
    (c, p, u) => c.getEmployeePaymentHistories(p, u),
  ],
  ['GET employees/:employeeId/face-registration', (c, p, u) => c.getFaceRegistration(p, u)],
  [
    'GET employees/:employeeId/next-shift-assignment',
    (c, p, u) => c.getNextShiftAssignment(p, 'store-a', u),
  ],
  ['GET employees/:profileId/salary-inquiries', (c, p, u) => c.getSalaryInquiries(p, u)],
  [
    'POST employees/:profileId/salary-slips',
    (c, p, u) => c.createSalarySlip(p, { month: '2026-09' }, u),
  ],
  // Writes addressed by profile id: same owner-or-self rule (B2 / A).
  [
    'POST employees/:profileId/salary-advance-requests',
    (c, p, u) =>
      c.createSalaryAdvanceRequest(
        p,
        { employeeSalaryId: 'sal-1', requestedAmount: 100 },
        u,
      ),
  ],
  [
    'POST employees/:profileId/salary-inquiries',
    (c, p, u) => c.createSalaryInquiry(p, u, { question: 'Lương tháng này?' }),
  ],
  [
    'POST bonus-work-requests',
    (c, p, u) =>
      c.createBonusWorkRequest(
        { storeId: 'store-a', employeeProfileId: p, requestDate: '2026-09-30' },
        u,
      ),
  ],
];

describe('employee record reads (and salary writes) are owner-or-self', () => {
  describe.each(ROUTES)('%s', (_name, call) => {
    it('owner of the store: allowed', async () => {
      const { controller } = build();
      await expect(call(controller, 'emp-1', { userId: 'owner-a' })).resolves.toBeDefined();
    });

    it('the employee themself: allowed', async () => {
      const { controller } = build();
      await expect(call(controller, 'emp-1', { userId: 'staff-1' })).resolves.toBeDefined();
    });

    it('a coworker in the same store: 403', async () => {
      const { controller } = build();
      await expect(
        call(controller, 'emp-1', { userId: 'staff-2' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('the owner of another store: 403', async () => {
      const { controller } = build();
      await expect(
        call(controller, 'emp-1', { userId: 'owner-b' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a terminated employee reading their own record: 403', async () => {
      const { controller } = build();
      await expect(
        call(controller, 'emp-t', { userId: 'staff-t' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('a refused read never reaches the data method', async () => {
    const { controller, storesService } = build();
    await expect(
      controller.getEmployeeById('emp-1', { userId: 'staff-2' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storesService.getEmployeeById).not.toHaveBeenCalled();
  });

  it('a coworker cannot file a salary advance or inquiry on someone else', async () => {
    const { controller, storesService } = build();
    await expect(
      controller.createSalaryAdvanceRequest(
        'emp-1',
        { employeeSalaryId: 'sal-1', requestedAmount: 100 },
        { userId: 'staff-2' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.createSalaryInquiry('emp-1', { userId: 'staff-2' }, { question: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storesService.createSalaryAdvanceRequest).not.toHaveBeenCalled();
    expect(storesService.createSalaryInquiry).not.toHaveBeenCalled();
  });

  it('bonus-work-requests: a coworker cannot file for someone else, nothing is written', async () => {
    const { controller, storesService, shiftEndWorkflowService } = build();
    await expect(
      controller.createBonusWorkRequest(
        { storeId: 'store-a', employeeProfileId: 'emp-1', requestDate: '2026-09-30' },
        { userId: 'staff-2' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storesService.createBonusWorkRequest).not.toHaveBeenCalled();
    expect(shiftEndWorkflowService.markOvertimePending).not.toHaveBeenCalled();
  });

  it('bonus-work-requests: body storeId must match the profile store', async () => {
    const { controller, storesService } = build();
    await expect(
      controller.createBonusWorkRequest(
        { storeId: 'store-b', employeeProfileId: 'emp-1', requestDate: '2026-09-30' },
        { userId: 'owner-b' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storesService.createBonusWorkRequest).not.toHaveBeenCalled();
  });

  it('bonus-work-requests: unauthenticated or missing profile id is refused', async () => {
    const { controller } = build();
    await expect(
      controller.createBonusWorkRequest(
        { storeId: 'store-a', employeeProfileId: 'emp-1', requestDate: '2026-09-30' },
        undefined,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      controller.createBonusWorkRequest(
        { storeId: 'store-a', employeeProfileId: '', requestDate: '2026-09-30' },
        { userId: 'staff-1' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bonus-work-requests: self request uses the profile store and the acting account', async () => {
    const { controller, storesService } = build();
    await controller.createBonusWorkRequest(
      { storeId: '', employeeProfileId: 'emp-1', requestDate: '2026-09-30' },
      { userId: 'staff-1' },
    );
    expect(storesService.createBonusWorkRequest).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'store-a', employeeProfileId: 'emp-1' }),
      'staff-1',
    );
  });

  it('salary advance by the employee records the acting account', async () => {
    const { controller, storesService } = build();
    await controller.createSalaryAdvanceRequest(
      'emp-1',
      { employeeSalaryId: 'sal-1', requestedAmount: 100 },
      { userId: 'staff-1' },
    );
    expect(storesService.createSalaryAdvanceRequest).toHaveBeenCalledWith(
      'emp-1',
      { employeeSalaryId: 'sal-1', requestedAmount: 100 },
      'staff-1',
    );
  });

  it('next-shift-assignment: the profile must belong to the queried store', async () => {
    const { controller } = build();
    await expect(
      controller.getNextShiftAssignment('emp-1', 'store-b', { userId: 'staff-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('employee detail: the owner gets every field', async () => {
    const { controller } = build();
    const result: any = await controller.getEmployeeById('emp-1', { userId: 'owner-a' });
    expect(result.profile.capabilityPoints).toBe(42);
    expect(result.profile).toHaveProperty('terminationReasonId');
  });

  it('employee detail: a self read keeps identity/finance/contracts but drops owner-private fields', async () => {
    const { controller } = build();
    const result: any = await controller.getEmployeeById('emp-1', { userId: 'staff-1' });
    expect(result.profile.account.identityDocument.documentNumber).toBe('id-doc');
    expect(result.profile.account.finance.bankNumber).toBe('bank');
    expect(result.profile.contracts).toEqual([{ id: 'c-1' }]);
    expect(result.profile).not.toHaveProperty('capabilityPoints');
    expect(result.profile).not.toHaveProperty('terminationReasonId');
    expect(result.profile).not.toHaveProperty('terminationReason');
  });

  it('career history: owner sees the decision note, self gets note=null', async () => {
    const owner = build();
    await expect(
      owner.controller.getCareerHistory('emp-1', { userId: 'owner-a' }),
    ).resolves.toEqual([expect.objectContaining({ note: 'owner note' })]);

    const self = build();
    await expect(
      self.controller.getCareerHistory('emp-1', { userId: 'staff-1' }),
    ).resolves.toEqual([
      expect.objectContaining({ id: 'ev-1', toName: 'Senior', note: null }),
    ]);
  });

  it('capability-points GET stays owner-only for a self read', async () => {
    const { controller, careerLadderService } = build();
    careerLadderService.storeIdOfProfile = jest.fn().mockResolvedValue('store-a');
    careerLadderService.getCapabilityEntries = jest.fn();
    await expect(
      controller.getCapabilityEntries('emp-1', { userId: 'staff-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(careerLadderService.getCapabilityEntries).not.toHaveBeenCalled();
  });
});
