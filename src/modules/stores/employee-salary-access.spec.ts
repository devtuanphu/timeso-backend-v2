/**
 * Salary reads (payslips, live estimate, one payslip) are owner-or-self:
 * the owner of the employee's store or the employee's own account. A
 * coworker in the same store, or the owner of another store, is refused.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { StoresService } from './stores.service';
import { EmploymentStatus } from './entities/employee-profile.entity';

const PROFILES: Record<string, any> = {
  'emp-1': {
    id: 'emp-1',
    storeId: 'store-a',
    accountId: 'staff-1',
    employmentStatus: EmploymentStatus.ACTIVE,
  },
};
const STORES: Record<string, any> = {
  'store-a': { id: 'store-a', ownerAccountId: 'owner-a' },
  'store-b': { id: 'store-b', ownerAccountId: 'owner-b' },
};
const SALARIES: Record<string, any> = {
  's-1': { id: 's-1', employeeProfileId: 'emp-1', netSalary: 1 },
};

function build() {
  const service = Object.create(StoresService.prototype) as any;
  service.profileRepository = {
    findOne: jest.fn(async ({ where }: any) => PROFILES[where.id] ?? null),
  };
  service.storeRepository = {
    findOne: jest.fn(async ({ where }: any) => STORES[where.id] ?? null),
  };
  service.employeeSalaryRepository = {
    findOne: jest.fn(async ({ where }: any) => SALARIES[where.id] ?? null),
  };
  return service as StoresService;
}

describe('employee salary reads are owner-or-self', () => {
  it('the owner of the employee store may read', async () => {
    const service = build();
    await expect(
      service.assertEmployeeSalaryAccess('emp-1', 'owner-a'),
    ).resolves.toMatchObject({ id: 'emp-1' });
    await expect(
      service.getEmployeeSalaryByIdForViewer('s-1', 'owner-a'),
    ).resolves.toMatchObject({ id: 's-1' });
  });

  it('the employee may read their own', async () => {
    const service = build();
    await expect(
      service.assertEmployeeSalaryAccess('emp-1', 'staff-1', 'store-a'),
    ).resolves.toMatchObject({ id: 'emp-1' });
    await expect(
      service.getEmployeeSalaryByIdForViewer('s-1', 'staff-1'),
    ).resolves.toMatchObject({ id: 's-1' });
  });

  it('a coworker is refused with the salary message', async () => {
    const service = build();
    await expect(
      service.assertEmployeeSalaryAccess('emp-1', 'staff-2'),
    ).rejects.toThrow(
      new ForbiddenException('Bạn chỉ có thể xem lương của chính mình'),
    );
    await expect(
      service.getEmployeeSalaryByIdForViewer('s-1', 'staff-2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the owner of another store is refused', async () => {
    const service = build();
    await expect(
      service.assertEmployeeSalaryAccess('emp-1', 'owner-b'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.getEmployeeSalaryByIdForViewer('s-1', 'owner-b'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('estimate: the profile must belong to the queried store', async () => {
    const service = build();
    await expect(
      service.assertEmployeeSalaryAccess('emp-1', 'staff-1', 'store-b'),
    ).rejects.toThrow(
      new ForbiddenException('Nhân viên không thuộc cửa hàng này'),
    );
  });

  it('a missing profile or payslip is 404', async () => {
    const service = build();
    await expect(
      service.assertEmployeeSalaryAccess('nope', 'owner-a'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.getEmployeeSalaryByIdForViewer('nope', 'owner-a'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('calendar access keeps its own message', async () => {
    const service = build();
    await expect(
      service.assertEmployeeCalendarAccess('emp-1', 'staff-2'),
    ).rejects.toThrow(
      new ForbiddenException('Bạn chỉ có thể xem lịch của chính mình'),
    );
  });
});
