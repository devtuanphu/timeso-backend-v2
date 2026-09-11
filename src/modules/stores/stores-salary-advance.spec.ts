/**
 * Regressions for the salary-advance money bugs found in the backend audit.
 * These exercise the service's arithmetic directly against mocked repositories,
 * because the behaviours under test are pure decisions about amounts.
 */
import { BadRequestException } from '@nestjs/common';

import { StoresService } from './stores.service';
import { AdvanceRequestStatus } from './entities/salary-advance-request.entity';

jest.mock('uuid', () => ({ v4: () => 'test-id' }));

const SALARY_ID = 'salary-1';
const REVIEWER = 'owner-account-1';

function buildService() {
  const service = Object.create(StoresService.prototype) as any;

  const advanceRepo: any = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(async (value: any) => value),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    })),
  };
  const employeeSalaryRepo: any = { update: jest.fn().mockResolvedValue({ affected: 1 }) };

  service.salaryAdvanceRequestRepository = advanceRepo;
  service.employeeSalaryRepository = employeeSalaryRepo;
  service.logger = { debug: jest.fn(), warn: jest.fn(), log: jest.fn(), error: jest.fn() };

  return { service, advanceRepo, employeeSalaryRepo };
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
