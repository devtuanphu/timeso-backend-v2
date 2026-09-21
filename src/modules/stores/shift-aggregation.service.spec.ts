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
    // Store days off for the MONTH day rate; none configured = calendar days.
    service.shiftConfigRepo = { findOne: jest.fn().mockResolvedValue(null) };
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

describe('ShiftAggregationService employee schedule grid ids (B1)', () => {
  it('returns the assignment id next to the slot id, keeping id as the slot', async () => {
    const service = Object.create(ShiftAggregationService.prototype) as any;
    service.assertEmployeeCalendarAccess = jest.fn().mockResolvedValue(undefined);
    service.loadDaysOff = jest.fn().mockResolvedValue(null);
    service.estimateAssignmentSalary = jest.fn().mockReturnValue(0);
    const employee: any = queryBuilder();
    employee.getOne = jest.fn().mockResolvedValue({
      id: 'employee-1',
      account: { fullName: 'An' },
    });
    service.employeeProfileRepo = { createQueryBuilder: jest.fn(() => employee) };
    service.shiftAssignmentRepo = {
      createQueryBuilder: jest.fn(() =>
        queryBuilder([
          {
            id: 'assignment-1',
            shiftSlotId: 'slot-1',
            status: 'APPROVED',
            shiftSlot: {
              workDate: '2026-07-01',
              startTime: '08:00',
              endTime: '12:00',
              workShift: { shiftName: 'Ca sáng', startTime: '08:00', endTime: '12:00' },
            },
          },
        ]),
      ),
    };
    service.leaveRequestRepo = { createQueryBuilder: jest.fn(() => queryBuilder([])) };

    const grid = await service.getEmployeeScheduleGrid({
      storeId: 'store-1',
      employeeId: 'employee-1',
      from: '2026-07-01',
      to: '2026-07-01',
      ownerAccountId: 'owner-1',
    });

    expect(grid.schedule[0].shifts[0]).toMatchObject({
      id: 'slot-1',
      slotId: 'slot-1',
      assignmentId: 'assignment-1',
    });
  });
});

describe('ShiftAggregationService employee schedule grid attendance (calendar marks)', () => {
  it('exposes attendanceStatus and onLeave per shift', async () => {
    const service = Object.create(ShiftAggregationService.prototype) as any;
    service.assertEmployeeCalendarAccess = jest.fn().mockResolvedValue(undefined);
    service.loadDaysOff = jest.fn().mockResolvedValue(null);
    service.estimateAssignmentSalary = jest.fn().mockReturnValue(0);
    const employee: any = queryBuilder();
    employee.getOne = jest.fn().mockResolvedValue({ id: 'employee-1', account: {} });
    service.employeeProfileRepo = { createQueryBuilder: jest.fn(() => employee) };
    const shift = (id: string, workDate: string, attendanceStatus: string | null) => ({
      id,
      shiftSlotId: `slot-${id}`,
      status: 'APPROVED',
      attendanceStatus,
      shiftSlot: {
        workDate,
        startTime: '08:00',
        endTime: '12:00',
        workShift: { shiftName: 'Ca sáng', startTime: '08:00', endTime: '12:00' },
      },
    });
    service.shiftAssignmentRepo = {
      createQueryBuilder: jest.fn(() =>
        queryBuilder([
          shift('absent', '2026-07-01', 'ABSENT'),
          shift('leave', '2026-07-02', null),
        ]),
      ),
    };
    service.leaveRequestRepo = {
      createQueryBuilder: jest.fn(() =>
        queryBuilder([
          {
            type: 'SICK',
            status: 'APPROVED',
            startDate: '2026-07-02',
            endDate: '2026-07-02',
            startTime: null,
            endTime: null,
          },
        ]),
      ),
    };

    const grid = await service.getEmployeeScheduleGrid({
      storeId: 'store-1',
      employeeId: 'employee-1',
      from: '2026-07-01',
      to: '2026-07-02',
      ownerAccountId: 'owner-1',
    });

    expect(grid.schedule[0].shifts[0]).toMatchObject({
      attendanceStatus: 'ABSENT',
      onLeave: false,
    });
    expect(grid.schedule[1].shifts[0]).toMatchObject({
      attendanceStatus: null,
      onLeave: true,
    });
  });
});

describe('ShiftAggregationService absent fine respects approved leave (M1)', () => {
  const absentRule = {
    category: 'fine',
    ruleType: 'ABSENT',
    calcType: 'amount',
    value: 200_000,
  };
  const missed = {
    id: 'sa-1',
    employeeId: 'emp-1',
    status: 'APPROVED',
    checkInTime: null,
    attendanceStatus: 'ABSENT',
    shiftEarnings: 0,
    lateMinutes: 0,
    earlyMinutes: 0,
  };
  const slot = { id: 'slot-1', workDate: '2026-07-20', assignments: [missed] };
  const leave = (over: Record<string, unknown> = {}) => ({
    employeeProfileId: 'emp-1',
    status: 'APPROVED',
    type: 'SICK',
    startDate: '2026-07-19',
    endDate: '2026-07-21',
    startTime: null,
    endTime: null,
    shiftAssignmentId: null,
    ...over,
  });

  it('does not fine a missed shift covered by an approved full-day leave', () => {
    const service = Object.create(ShiftAggregationService.prototype) as any;
    expect(
      service.assignmentSalaryDiff(missed, [absentRule], 0, slot, []),
    ).toBe(-200_000);
    expect(
      service.assignmentSalaryDiff(missed, [absentRule], 0, slot, [leave()]),
    ).toBe(0);
    // A late request, or a timed leave for another shift, is not authorized.
    expect(
      service.assignmentSalaryDiff(missed, [absentRule], 0, slot, [
        leave({ type: 'LATE' }),
        leave({ startTime: '08:00', endTime: '12:00', shiftAssignmentId: 'x' }),
      ]),
    ).toBe(-200_000);
  });

  it('loads approved leave only for missed shifts and groups it by employee', async () => {
    const service = Object.create(ShiftAggregationService.prototype) as any;
    service.leaveRequestRepo = { find: jest.fn().mockResolvedValue([leave()]) };
    const byEmployee = await service.loadApprovedLeavesForSlots([slot]);
    expect(byEmployee.get('emp-1')).toHaveLength(1);
    const [{ where }] = service.leaveRequestRepo.find.mock.calls[0];
    expect(where.status).toBe('APPROVED');

    // Nobody left to fine: no query at all.
    service.leaveRequestRepo.find.mockClear();
    const none = await service.loadApprovedLeavesForSlots([
      { ...slot, assignments: [{ ...missed, checkInTime: new Date() }] },
    ]);
    expect(none.size).toBe(0);
    expect(service.leaveRequestRepo.find).not.toHaveBeenCalled();
  });
});
