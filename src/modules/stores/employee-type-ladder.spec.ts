import { NotFoundException } from '@nestjs/common';

import { StoresService } from './stores.service';

/**
 * `store_employee_types` used to double as the promotion ladder: it carried a
 * `level` and four `req_*` columns, so the catalogue of employment types and
 * the ladder were the same rows. Both moved to `store_ladder_rungs` and
 * `store_rung_criteria`; what stays here is plain catalogue CRUD, and these
 * tests hold it to that.
 */
const STORE = 'store-1';
const TYPE = 'type-1';

function build(
  type: Record<string, unknown> | null,
  employeesHoldingType = 0,
) {
  const service = Object.create(StoresService.prototype) as any;
  service.employeeTypeRepository = {
    findOne: jest.fn().mockResolvedValue(type),
    save: jest.fn(async (row: unknown) => row),
    remove: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue([]),
  };
  service.profileRepository = {
    count: jest.fn().mockResolvedValue(employeesHoldingType),
  };
  return service;
}

const rung = (over: Record<string, unknown> = {}) => ({
  id: TYPE,
  storeId: STORE,
  name: 'Thợ chính',
  isProbation: false,
  isActive: true,
  ...over,
});

describe('updateEmployeeType', () => {
  it('applies the edit to the rung', async () => {
    const service = build(rung());

    const result = await service.updateEmployeeType(STORE, TYPE, {
      name: 'Thợ cả',
      isProbation: true,
    });

    expect(result).toMatchObject({ name: 'Thợ cả', isProbation: true });
    expect(service.employeeTypeRepository.save).toHaveBeenCalled();
  });

  // The route already fixes which store and which rung; taking them from the
  // body as well would let a caller move a rung into somebody else's store.
  it('ignores id and storeId supplied in the body', async () => {
    const service = build(rung());

    const result = await service.updateEmployeeType(STORE, TYPE, {
      id: 'someone-elses-id',
      storeId: 'someone-elses-store',
      name: 'Thợ cả',
    });

    expect(result).toMatchObject({ id: TYPE, storeId: STORE, name: 'Thợ cả' });
  });

  it('refuses a rung that does not belong to this store', async () => {
    const service = build(null);

    await expect(
      service.updateEmployeeType(STORE, TYPE, { name: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('deleteEmployeeType', () => {
  // Employee profiles reference the type. Removing the row would orphan every
  // employee on that rung and break their progression view.
  it('deactivates rather than deletes while employees still hold it', async () => {
    const row = rung();
    const service = build(row, 3);

    const result = await service.deleteEmployeeType(STORE, TYPE);

    expect(result).toEqual({ id: TYPE, deactivated: true, employeesAffected: 3 });
    expect(service.employeeTypeRepository.remove).not.toHaveBeenCalled();
    expect(row.isActive).toBe(false);
  });

  it('deletes a rung nobody holds', async () => {
    const service = build(rung(), 0);

    const result = await service.deleteEmployeeType(STORE, TYPE);

    expect(result).toEqual({ id: TYPE, deactivated: false, employeesAffected: 0 });
    expect(service.employeeTypeRepository.remove).toHaveBeenCalled();
  });

  it('refuses a rung that does not belong to this store', async () => {
    const service = build(null);

    await expect(service.deleteEmployeeType(STORE, TYPE)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('getEmployeeTypes', () => {
  // The list is the ladder, so its order carries meaning.
  it('returns the catalogue ordered by name', async () => {
    const service = build(null);

    await service.getEmployeeTypes(STORE);

    // Thứ tự bậc nay thuộc về store_ladder_rungs.level; danh mục chỉ cần một
    // thứ tự ổn định để hiển thị.
    expect(service.employeeTypeRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ order: { name: 'ASC' } }),
    );
  });
});
