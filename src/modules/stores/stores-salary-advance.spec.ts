/**
 * Regressions for the salary-advance money bugs found in the backend audit.
 * These exercise the service's arithmetic directly against mocked repositories,
 * because the behaviours under test are pure decisions about amounts.
 */
import { BadRequestException } from '@nestjs/common';

import { StoresService } from './stores.service';
import {
  AdvanceRequestStatus,
  SalaryAdvanceRequest,
} from './entities/salary-advance-request.entity';
import { EmployeeSalary } from './entities/employee-salary.entity';

jest.mock('uuid', () => ({ v4: () => 'test-id' }));

const SALARY_ID = 'salary-1';
const REVIEWER = 'owner-account-1';

function buildService() {
  const service = Object.create(StoresService.prototype) as any;

  // APPROVED requests "in the database": seeded by a test, plus any request
  // the service saves as APPROVED. `sumApprovedAdvances` reads these.
  const approvedRows: any[] = [];
  const advanceRepo: any = {
    findOne: jest.fn(),
    find: jest.fn(async () =>
      approvedRows.filter((row) => row.status === AdvanceRequestStatus.APPROVED),
    ),
    save: jest.fn(async (value: any) => {
      if (value.status === AdvanceRequestStatus.APPROVED) {
        approvedRows.push({ ...value });
      }
      return value;
    }),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    })),
  };
  const employeeSalaryRepo: any = {
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    // The payslip row as re-read under lock inside the review transaction;
    // null falls back to the relation loaded with the request.
    findOne: jest.fn().mockResolvedValue(null),
  };

  service.salaryAdvanceRequestRepository = advanceRepo;
  service.employeeSalaryRepository = employeeSalaryRepo;
  service.logger = { debug: jest.fn(), warn: jest.fn(), log: jest.fn(), error: jest.fn() };
  // Approval runs in one transaction; the shim hands out the same mocked
  // repositories through the manager.
  const manager = {
    getRepository: (entity: unknown) =>
      entity === SalaryAdvanceRequest
        ? advanceRepo
        : entity === EmployeeSalary
          ? employeeSalaryRepo
          : undefined,
  };
  service.dataSource = {
    transaction: jest.fn((callback: (m: unknown) => unknown) =>
      Promise.resolve(callback(manager)),
    ),
  };

  return { service, advanceRepo, employeeSalaryRepo, approvedRows };
}

function pendingRequest(over: Record<string, unknown> = {}) {
  return {
    id: 'request-1',
    employeeSalaryId: SALARY_ID,
    status: AdvanceRequestStatus.PENDING,
    requestedAmount: 1_000_000,
    approvedAmount: null,
    employeeSalary: {
      id: SALARY_ID,
      totalIncome: 5_000_000,
      netSalary: 5_000_000,
      penalty: 0,
      otherDeductions: 0,
      advancePayment: 0,
    },
    ...over,
  };
}

describe('reviewSalaryAdvanceRequest — approved amount', () => {
  // Regression: `data.approvedAmount || request.requestedAmount` treated a
  // deliberate 0 as "not supplied" and granted the whole request.
  it('treats an explicit 0 as approving nothing, not the full amount', async () => {
    const t = buildService();
    t.advanceRepo.findOne.mockResolvedValue(pendingRequest());

    await t.service.reviewSalaryAdvanceRequest('request-1', REVIEWER, {
      status: AdvanceRequestStatus.APPROVED,
      approvedAmount: 0,
    });

    const [, changes] = t.employeeSalaryRepo.update.mock.calls[0];
    expect(changes.advancePayment).toBe(0);
    expect(changes.netSalary).toBe(5_000_000);
  });

  it('still falls back to the requested amount when omitted', async () => {
    const t = buildService();
    t.advanceRepo.findOne.mockResolvedValue(pendingRequest());

    await t.service.reviewSalaryAdvanceRequest('request-1', REVIEWER, {
      status: AdvanceRequestStatus.APPROVED,
    });

    const [, changes] = t.employeeSalaryRepo.update.mock.calls[0];
    expect(changes.advancePayment).toBe(1_000_000);
  });

  // Regression: a negative amount reduced deductions and raised net pay.
  it('rejects a negative approved amount', async () => {
    const t = buildService();
    t.advanceRepo.findOne.mockResolvedValue(pendingRequest());

    await expect(
      t.service.reviewSalaryAdvanceRequest('request-1', REVIEWER, {
        status: AdvanceRequestStatus.APPROVED,
        approvedAmount: -500_000,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(t.employeeSalaryRepo.update).not.toHaveBeenCalled();
  });

  // Regression: this path lacked the Math.max(0, …) floor the other
  // net-salary computations have.
  it('floors net salary at zero', async () => {
    const t = buildService();
    t.advanceRepo.findOne.mockResolvedValue(
      pendingRequest({
        requestedAmount: 4_000_000,
        employeeSalary: {
          id: SALARY_ID,
          totalIncome: 5_000_000,
          netSalary: 5_000_000,
          penalty: 2_000_000,
          otherDeductions: 0,
          advancePayment: 0,
        },
      }),
    );

    await t.service.reviewSalaryAdvanceRequest('request-1', REVIEWER, {
      status: AdvanceRequestStatus.APPROVED,
      approvedAmount: 4_000_000,
    });

    const [, changes] = t.employeeSalaryRepo.update.mock.calls[0];
    expect(changes.netSalary).toBe(0);
    expect(changes.netSalary).toBeGreaterThanOrEqual(0);
  });
});

describe('reviewSalaryAdvanceRequest — advancePayment source of truth', () => {
  // Regression: approval incremented the stored advancePayment. A concurrent
  // recalculation could overwrite that increment, and a stale stored value was
  // carried forward. It is now re-derived from the APPROVED requests.
  it('sets advancePayment to the sum of APPROVED requests, not stored + amount', async () => {
    const t = buildService();
    t.approvedRows.push({
      id: 'request-0',
      status: AdvanceRequestStatus.APPROVED,
      approvedAmount: 500_000,
      requestedAmount: 500_000,
    });
    t.advanceRepo.findOne.mockResolvedValue(
      pendingRequest({
        employeeSalary: {
          id: SALARY_ID,
          totalIncome: 5_000_000,
          netSalary: 4_500_000,
          penalty: 0,
          otherDeductions: 0,
          // Stale: does not match the approved rows above.
          advancePayment: 999_999,
        },
      }),
    );

    await t.service.reviewSalaryAdvanceRequest('request-1', REVIEWER, {
      status: AdvanceRequestStatus.APPROVED,
      approvedAmount: 1_000_000,
    });

    expect(t.service.dataSource.transaction).toHaveBeenCalledTimes(1);
    const [id, changes] = t.employeeSalaryRepo.update.mock.calls[0];
    expect(id).toBe(SALARY_ID);
    expect(changes.advancePayment).toBe(1_500_000);
    expect(changes.totalDeductions).toBe(1_500_000);
    expect(changes.netSalary).toBe(3_500_000);
  });

  it('uses the payslip row re-read under lock for income and deductions', async () => {
    const t = buildService();
    t.advanceRepo.findOne.mockResolvedValue(pendingRequest());
    t.employeeSalaryRepo.findOne.mockResolvedValue({
      id: SALARY_ID,
      totalIncome: 6_000_000,
      netSalary: 6_000_000,
      penalty: 100_000,
      otherDeductions: 50_000,
      advancePayment: 0,
    });

    await t.service.reviewSalaryAdvanceRequest('request-1', REVIEWER, {
      status: AdvanceRequestStatus.APPROVED,
      approvedAmount: 1_000_000,
    });

    expect(t.employeeSalaryRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SALARY_ID },
        lock: { mode: 'pessimistic_write' },
      }),
    );
    const [, changes] = t.employeeSalaryRepo.update.mock.calls[0];
    expect(changes.totalDeductions).toBe(1_150_000);
    expect(changes.netSalary).toBe(4_850_000);
  });

  it('refuses a request that another reviewer processed first', async () => {
    const t = buildService();
    t.advanceRepo.findOne
      .mockResolvedValueOnce(pendingRequest())
      .mockResolvedValueOnce(
        pendingRequest({ status: AdvanceRequestStatus.APPROVED }),
      );

    await expect(
      t.service.reviewSalaryAdvanceRequest('request-1', REVIEWER, {
        status: AdvanceRequestStatus.APPROVED,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(t.employeeSalaryRepo.update).not.toHaveBeenCalled();
    expect(t.advanceRepo.save).not.toHaveBeenCalled();
  });

  it('does not touch the payslip when rejecting', async () => {
    const t = buildService();
    t.advanceRepo.findOne.mockResolvedValue(pendingRequest());

    await t.service.reviewSalaryAdvanceRequest('request-1', REVIEWER, {
      status: AdvanceRequestStatus.REJECTED,
    });

    expect(t.employeeSalaryRepo.update).not.toHaveBeenCalled();
    expect(t.advanceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: AdvanceRequestStatus.REJECTED }),
    );
  });
});

describe('sumApprovedAdvances', () => {
  // Regression: payroll regeneration hardcoded advancePayment to 0, so an
  // approved advance vanished and the employee was paid twice.
  it('sums only APPROVED advances against a payslip', async () => {
    const t = buildService();
    t.advanceRepo.find.mockResolvedValue([
      { approvedAmount: 300_000, requestedAmount: 500_000 },
      { approvedAmount: null, requestedAmount: 200_000 },
    ]);

    await expect(t.service.sumApprovedAdvances(SALARY_ID)).resolves.toBe(500_000);
    expect(t.advanceRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: AdvanceRequestStatus.APPROVED }),
      }),
    );
  });

  it('returns zero for a payslip that does not exist yet', async () => {
    const t = buildService();
    await expect(t.service.sumApprovedAdvances(undefined)).resolves.toBe(0);
    expect(t.advanceRepo.find).not.toHaveBeenCalled();
  });
});
