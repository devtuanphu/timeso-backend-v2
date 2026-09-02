import { ShiftAggregationService } from './shift-aggregation.service';

const queryBuilder = (rows: unknown = []) => {
  const qb: any = {};
  for (const method of [
    'leftJoinAndSelect',
    'leftJoin',
    'where',
    'andWhere',
    'select',
    'groupBy',
    'addGroupBy',
    'having',
    'limit',
    'take',
    'skip',
    'orderBy',
    'addOrderBy',
  ]) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getMany = jest.fn().mockResolvedValue(rows);
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  qb.getRawOne = jest.fn().mockResolvedValue(rows);
  return qb;
};

describe('ShiftAggregationService summary capacity resolution', () => {
  it('uses inherited work-shift capacity and keeps unlimited summaries backward compatible', async () => {
    const assignments = queryBuilder([]);
    const slotSummary = queryBuilder({ totalRequired: '4' });
    const leaves = queryBuilder([]);
    const service = Object.create(ShiftAggregationService.prototype) as any;
    service.shiftAssignmentRepo = { createQueryBuilder: jest.fn(() => assignments) };
    service.shiftSlotRepo = { createQueryBuilder: jest.fn(() => slotSummary) };
    service.leaveRequestRepo = { createQueryBuilder: jest.fn(() => leaves) };

    const summary = await service.calcSummary('store-1', '2026-07-01', '2026-07-01');

    expect(slotSummary.select).toHaveBeenCalledWith(
      expect.stringContaining('COALESCE(slot.maxStaff, ws.defaultMaxStaff)'),
      'totalRequired',
    );
    expect(summary.totalRequiredEmployees).toBe(4);

    slotSummary.getRawOne.mockResolvedValueOnce({ totalRequired: null });
    const unlimitedSummary = await service.calcSummary('store-1', '2026-07-01', '2026-07-01');
    expect(unlimitedSummary.totalRequiredEmployees).toBeNull();
  });
});

describe('ShiftAggregationService suggestion capacity resolution', () => {
  it('uses slot capacity overrides or inherited work-shift defaults', async () => {
    const insufficientSlots = queryBuilder([]);
    const service = Object.create(ShiftAggregationService.prototype) as any;
    service.shiftSlotRepo = {
      createQueryBuilder: jest.fn(() => insufficientSlots),
    };
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue(undefined);

    const suggestions = await service.getShiftSuggestions({
      storeId: 'store-1',
      from: '2026-07-01',
      to: '2026-07-01',
      ownerAccountId: 'owner-1',
    });

    expect(suggestions).toEqual([]);
    expect(insufficientSlots.andWhere).toHaveBeenCalledWith(
      'COALESCE(slot.maxStaff, ws.defaultMaxStaff) IS NOT NULL',
    );
    expect(insufficientSlots.select).toHaveBeenCalledWith(
      expect.arrayContaining([
        'COALESCE(slot.maxStaff, ws.defaultMaxStaff) as maxStaff',
      ]),
    );
    expect(insufficientSlots.having).toHaveBeenCalledWith(
      'COALESCE(slot.maxStaff, ws.defaultMaxStaff) > COUNT(sa.id)',
    );
  });
});
