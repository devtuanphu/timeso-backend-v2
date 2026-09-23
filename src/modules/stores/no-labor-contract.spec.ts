import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { StoresService } from './stores.service';
import {
  EmployeeContract,
  isNoLaborContract,
  NO_LABOR_CONTRACT_NAME,
  PaymentType,
} from './entities/employee-contract.entity';
import { ExistingEmployeeContractDto } from './dto/add-existing-employee.dto';

/**
 * "Không hợp đồng" (user decision R7): the employee still has a pay rate for
 * payroll, so a contract row is kept, but it is marked as "no labor
 * contract" (duration 0, no end date, that name) and every contract response
 * says so through `noLaborContract`.
 */
describe('isNoLaborContract', () => {
  it('recognises duration 0 and the name, nothing else', () => {
    expect(isNoLaborContract({ durationMonths: 0 })).toBe(true);
    expect(isNoLaborContract({ durationMonths: '0' as any })).toBe(true);
    expect(isNoLaborContract({ contractName: ' không hợp đồng ' })).toBe(true);
    expect(isNoLaborContract({ durationMonths: 12, contractName: 'Hợp đồng lao động' })).toBe(false);
    expect(isNoLaborContract({ durationMonths: null, contractName: 'Hợp đồng lao động' })).toBe(false);
    expect(isNoLaborContract({ durationMonths: '' as any })).toBe(false);
    expect(isNoLaborContract(null)).toBe(false);
  });

  it('is exposed on every loaded contract (AfterLoad)', () => {
    const none = Object.assign(new EmployeeContract(), { durationMonths: 0 });
    const labor = Object.assign(new EmployeeContract(), { durationMonths: 12 });
    (none as any).markNoLaborContract();
    (labor as any).markNoLaborContract();
    expect(none.noLaborContract).toBe(true);
    expect(labor.noLaborContract).toBe(false);
  });
});

describe('createContract — "Không hợp đồng"', () => {
  const build = () => {
    const service = Object.create(StoresService.prototype) as any;
    const repository = {
      create: jest.fn((value: any) => ({ ...value })),
      save: jest.fn(async (value: any) => ({ id: 'contract-1', ...value })),
    };
    service.contractRepository = repository;
    return { service, repository };
  };

  const base = {
    contractName: 'Hợp đồng lao động',
    startDate: '2026-09-22',
    paymentType: PaymentType.HOUR,
    salaryAmount: 25_000,
  };

  it.each([
    ['noLaborContract: true', { noLaborContract: true }],
    ['noLaborContract: "true" (multipart)', { noLaborContract: 'true' }],
    ['durationMonths: 0', { durationMonths: 0 }],
    ['the name', { contractName: NO_LABOR_CONTRACT_NAME }],
  ])('%s keeps the pay rate but stores no labor contract', async (_label, marker) => {
    const { service, repository } = build();

    const saved = await service.createContract('profile-1', { ...base, ...marker });

    const row = repository.create.mock.calls[0][0];
    expect(row).toMatchObject({
      employeeProfileId: 'profile-1',
      contractName: NO_LABOR_CONTRACT_NAME,
      durationMonths: 0,
      endDate: null,
      salaryAmount: 25_000,
      paymentType: PaymentType.HOUR,
    });
    expect(row).not.toHaveProperty('noLaborContract');
    expect(saved.noLaborContract).toBe(true);
  });

  it('a normal contract is unchanged and marked as a labor contract', async () => {
    const { service, repository } = build();

    const saved = await service.createContract('profile-1', {
      ...base,
      durationMonths: 12,
    });

    const row = repository.create.mock.calls[0][0];
    expect(row.contractName).toBe('Hợp đồng lao động');
    expect(row.durationMonths).toBe(12);
    expect(row.endDate).toBeInstanceOf(Date);
    expect(saved.noLaborContract).toBe(false);
  });

  it('an open-ended contract without a duration stays a labor contract', async () => {
    const { service } = build();

    const saved = await service.createContract('profile-1', { ...base });

    expect(saved.noLaborContract).toBe(false);
  });
});

describe('ExistingEmployeeContractDto', () => {
  const check = (body: Record<string, unknown>) =>
    validate(plainToInstance(ExistingEmployeeContractDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it('accepts durationMonths 0 and the noLaborContract flag', async () => {
    expect(await check({ durationMonths: 0, noLaborContract: true })).toHaveLength(0);
  });

  it('still rejects a negative duration and a non-boolean flag', async () => {
    expect(await check({ durationMonths: -1 })).not.toHaveLength(0);
    expect(await check({ noLaborContract: 'yes' })).not.toHaveLength(0);
  });
});
