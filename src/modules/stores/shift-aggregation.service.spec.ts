import { ShiftAggregationService } from './shift-aggregation.service';
import { PaymentType } from './entities/employee-contract.entity';

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

describe('ShiftAggregationService employee schedule grid pay = payroll (R5)', () => {
  afterEach(() => jest.useRealTimers());

  const grid = async (rows: any[], contract: any, adjustments: any = null) => {
    const service = Object.create(ShiftAggregationService.prototype) as any;
    service.assertEmployeeCalendarAccess = jest.fn().mockResolvedValue(undefined);
    // Sundays off: September 2026 has 26 working days.
    service.loadDaysOff = jest.fn().mockResolvedValue(['SUNDAY']);
    service.salaryAdjustmentRepo = {
      findOne: jest.fn().mockResolvedValue(adjustments),
    };
    const employee: any = queryBuilder();
    employee.getOne = jest.fn().mockResolvedValue({ id: 'emp-1', account: {} });
    service.employeeProfileRepo = { createQueryBuilder: jest.fn(() => employee) };
    service.shiftAssignmentRepo = {
      createQueryBuilder: jest.fn(() =>
        queryBuilder(
          rows.map((row) => ({
            employeeId: 'emp-1',
            employee: { contracts: [{ isActive: true, ...contract }] },
            ...row,
          })),
        ),
      ),
    };
    service.leaveRequestRepo = { createQueryBuilder: jest.fn(() => queryBuilder([])) };
    return service.getEmployeeScheduleGrid({
      storeId: 'store-1',
      employeeId: 'emp-1',
      from: '2026-09-07',
      to: '2026-09-13',
      ownerAccountId: 'owner-1',
    });
  };
  const slot = (workDate: string, startTime: string, endTime: string) => ({
    workDate,
    startTime,
    endTime,
    workShift: { shiftName: 'Ca', startTime, endTime },
  });

  it('MONTH: two completed shifts on one day, earnings not stored yet → one day rate', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-13T12:00:00Z'));
    const result = await grid(
      [
        {
          id: 'a',
          shiftSlotId: 's-a',
          status: 'COMPLETED',
          checkInTime: new Date('2026-09-08T01:00:00Z'),
          checkOutTime: new Date('2026-09-08T05:00:00Z'),
          workedMinutes: 240,
          shiftEarnings: null,
          attendanceStatus: 'ON_TIME',
          shiftSlot: slot('2026-09-08', '08:00:00', '12:00:00'),
        },
        {
          id: 'b',
          shiftSlotId: 's-b',
          status: 'COMPLETED',
          checkInTime: new Date('2026-09-08T06:00:00Z'),
          checkOutTime: new Date('2026-09-08T10:00:00Z'),
          workedMinutes: 240,
          shiftEarnings: null,
          attendanceStatus: 'ON_TIME',
          shiftSlot: slot('2026-09-08', '13:00:00', '17:00:00'),
        },
      ],
      { paymentType: PaymentType.MONTH, salaryAmount: 8_000_000 },
    );
    const day = result.schedule.find((d: any) => d.date === '2026-09-08');
    const dayRate = Math.round(8_000_000 / 26);
    expect(day.earnedTotal).toBe(dayRate);
    expect(day.shifts.map((s: any) => s.earnedSalary)).toEqual([dayRate, 0]);
    expect(day.shifts.every((s: any) => s.earningsPending)).toBe(true);
    // `salary` of a completed shift is the earned figure too.
    expect(day.shifts.map((s: any) => s.salary)).toEqual([dayRate, 0]);
    expect(day.shifts[0].attendanceLabel).toBe('Đúng giờ');
    expect(result.summary.earnedPerWeek).toBe(dayRate);
    expect(result.summary.salaryPerWeek).toBe(dayRate);
  });

  it('HOUR: pays worked hours (month salary adjustment wins), stored figure when present', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-13T12:00:00Z'));
    const result = await grid(
      [
        {
          id: 'a',
          shiftSlotId: 's-a',
          status: 'COMPLETED',
          checkInTime: new Date('2026-09-08T01:00:00Z'),
          checkOutTime: new Date('2026-09-08T04:30:00Z'),
          workedMinutes: 210, // scheduled 240
          shiftEarnings: null,
          attendanceStatus: 'EARLY',
          shiftSlot: slot('2026-09-08', '08:00:00', '12:00:00'),
        },
        {
          id: 'b',
          shiftSlotId: 's-b',
          status: 'COMPLETED',
          checkInTime: new Date('2026-09-09T01:00:00Z'),
          checkOutTime: new Date('2026-09-09T05:00:00Z'),
          workedMinutes: 240,
          shiftEarnings: 100_000,
          attendanceStatus: 'ON_TIME',
          shiftSlot: slot('2026-09-09', '08:00:00', '12:00:00'),
        },
      ],
      { paymentType: PaymentType.HOUR, salaryAmount: 25_000 },
      { newSalary: 30_000 },
    );
    const byDate = (date: string) => result.schedule.find((d: any) => d.date === date);
    expect(byDate('2026-09-08').shifts[0]).toMatchObject({
      earnedSalary: 105_000, // 3.5 h × 30.000
      hours: 3.5,
      earningsPending: true,
      attendanceLabel: 'Về sớm',
    });
    expect(byDate('2026-09-09').shifts[0]).toMatchObject({
      earnedSalary: 100_000,
      earningsPending: false,
    });
    expect(result.summary.totalHoursPerWeek).toBe(7.5);
  });

  it('an absent shift has no hours or pay, is labelled, and is excluded from the totals', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-10T12:00:00Z'));
    const result = await grid(
      [
        {
          id: 'absent',
          shiftSlotId: 's-1',
          status: 'APPROVED',
          checkInTime: null,
          attendanceStatus: 'ABSENT',
          shiftSlot: slot('2026-09-08', '08:00:00', '12:00:00'),
        },
        {
          // Ended, never checked in, not yet marked by the cron.
          id: 'ended',
          shiftSlotId: 's-2',
          status: 'APPROVED',
          checkInTime: null,
          attendanceStatus: null,
          shiftSlot: slot('2026-09-09', '08:00:00', '12:00:00'),
        },
        {
          id: 'upcoming',
          shiftSlotId: 's-3',
          status: 'APPROVED',
          checkInTime: null,
          attendanceStatus: null,
          shiftSlot: slot('2026-09-11', '08:00:00', '12:00:00'),
        },
      ],
      { paymentType: PaymentType.HOUR, salaryAmount: 25_000 },
    );
    const shifts = result.schedule.flatMap((d: any) => d.shifts);
    const byId = (id: string) => shifts.find((s: any) => s.assignmentId === id);
    for (const id of ['absent', 'ended']) {
      expect(byId(id)).toMatchObject({
        hours: 0,
        salary: 0,
        earnedSalary: null,
        isAbsent: true,
        attendanceLabel: 'Nghỉ không phép',
      });
    }
    expect(byId('upcoming')).toMatchObject({
      hours: 4,
      salary: 100_000,
      earnedSalary: null,
      isAbsent: false,
      attendanceLabel: null,
    });
    expect(result.summary).toEqual({
      totalHoursPerWeek: 4,
      totalMinutes: 240,
      workedMinutes: 0,
      daysPerWeek: 1,
      salaryPerWeek: 100_000,
      earnedPerWeek: 0,
    });
    expect(result.schedule.every((d: any) => d.earnedTotal === 0)).toBe(true);
  });

  it('exposes exact minutes next to the 0.1 h rounded hours (m1)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-10T12:00:00Z'));
    const completed = (id: string, workDate: string, workedMinutes: number) => ({
      id,
      shiftSlotId: `s-${id}`,
      status: 'COMPLETED',
      checkInTime: new Date(`${workDate}T01:00:00Z`),
      checkOutTime: new Date(`${workDate}T05:10:00Z`),
      workedMinutes,
      shiftEarnings: 100_000,
      attendanceStatus: 'ON_TIME',
      shiftSlot: slot(workDate, '08:00:00', '12:00:00'),
    });
    const result = await grid(
      [
        completed('a', '2026-09-08', 250),
        completed('b', '2026-09-09', 250),
        {
          id: 'upcoming',
          shiftSlotId: 's-up',
          status: 'APPROVED',
          checkInTime: null,
          attendanceStatus: null,
          shiftSlot: slot('2026-09-11', '08:00:00', '12:25:00'),
        },
      ],
      { paymentType: PaymentType.HOUR, salaryAmount: 25_000 },
    );
    const shifts = result.schedule.flatMap((d: any) => d.shifts);
    const byId = (id: string) => shifts.find((s: any) => s.assignmentId === id);
    expect(byId('a')).toMatchObject({ hours: 4.2, minutes: 250 });
    expect(byId('upcoming')).toMatchObject({ hours: 4.4, minutes: 265 });
    // Legacy hours drift (4.2 + 4.2 + 4.4); minutes stay exact.
    expect(result.summary).toMatchObject({
      totalHoursPerWeek: 12.8,
      totalMinutes: 765,
      workedMinutes: 500,
    });
  });

  it('labels a forgotten check-out', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-10T12:00:00Z'));
    const result = await grid(
      [
        {
          id: 'f',
          shiftSlotId: 's-1',
          status: 'COMPLETED',
          checkInTime: new Date('2026-09-08T01:00:00Z'),
          checkOutTime: new Date('2026-09-08T05:15:00Z'),
          workedMinutes: 240,
          shiftEarnings: 100_000,
          attendanceStatus: 'FORGOT_CHECKOUT',
          shiftSlot: slot('2026-09-08', '08:00:00', '12:00:00'),
        },
      ],
      { paymentType: PaymentType.HOUR, salaryAmount: 25_000 },
    );
    const [shift] = result.schedule.find((d: any) => d.date === '2026-09-08').shifts;
    expect(shift).toMatchObject({
      attendanceLabel: 'Quên chấm công ra',
      earnedSalary: 100_000,
    });
  });
});

describe('ShiftAggregationService — current stint only (rehire)', () => {
  // Rehired at 10:00 VN on 2026-09-10.
  const JOINED = new Date('2026-09-10T03:00:00.000Z');

  const gridService = (joinedAt: Date | null) => {
    const service = Object.create(ShiftAggregationService.prototype) as any;
    service.assertEmployeeCalendarAccess = jest.fn().mockResolvedValue(undefined);
    service.loadDaysOff = jest.fn().mockResolvedValue(null);
    service.estimateAssignmentSalary = jest.fn().mockReturnValue(0);
    const employee: any = queryBuilder();
    employee.getOne = jest.fn().mockResolvedValue({
      id: 'employee-1',
      joinedAt,
      account: { fullName: 'An' },
    });
    service.employeeProfileRepo = { createQueryBuilder: jest.fn(() => employee) };
    const assignments = queryBuilder([]);
    service.shiftAssignmentRepo = { createQueryBuilder: jest.fn(() => assignments) };
    const leaves = queryBuilder([]);
    service.leaveRequestRepo = { createQueryBuilder: jest.fn(() => leaves) };
    return { service, assignments, leaves };
  };

  const grid = (service: any) =>
    service.getEmployeeScheduleGrid({
      storeId: 'store-1',
      employeeId: 'employee-1',
      from: '2026-09-01',
      to: '2026-09-30',
      ownerAccountId: 'owner-1',
    });

  it('schedule grid only loads shifts from the VN date the stint started', async () => {
    const { service, assignments } = gridService(JOINED);

    await grid(service);

    expect(assignments.andWhere).toHaveBeenCalledWith(
      'slot.workDate >= :stintStart',
      { stintStart: '2026-09-10' },
    );
  });

  it('uses the VN date of joinedAt (late evening UTC is the next VN day)', async () => {
    // 2026-09-09T18:30Z is 01:30 on 2026-09-10 in Vietnam.
    const { service, assignments } = gridService(new Date('2026-09-09T18:30:00Z'));

    await grid(service);

    expect(assignments.andWhere).toHaveBeenCalledWith(
      'slot.workDate >= :stintStart',
      { stintStart: '2026-09-10' },
    );
  });

  it('schedule grid is unfiltered for a legacy profile without joinedAt', async () => {
    const { service, assignments, leaves } = gridService(null);

    await grid(service);

    expect(assignments.andWhere).not.toHaveBeenCalledWith(
      'slot.workDate >= :stintStart',
      expect.anything(),
    );
    expect(leaves.andWhere).not.toHaveBeenCalledWith(
      'leave.createdAt >= :leaveFloor',
      expect.anything(),
    );
  });

  it('schedule grid ignores leave approved in the previous stint', async () => {
    const { service, leaves } = gridService(JOINED);

    await grid(service);

    const call = leaves.andWhere.mock.calls.find(
      ([sql]: [string]) => sql === 'leave.createdAt >= :leaveFloor',
    );
    expect(call).toBeDefined();
    expect(call[1].leaveFloor.toISOString()).toBe('2026-09-10T02:59:00.000Z');
  });

  const activitiesService = (joinedAt: Date | null) => {
    const service = Object.create(ShiftAggregationService.prototype) as any;
    service.assertEmployeeCalendarAccess = jest.fn().mockResolvedValue(undefined);
    service.employeeProfileRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'employee-1', joinedAt }),
    };
    const qbs = {
      logs: queryBuilder([]),
      assignments: queryBuilder([]),
      changes: queryBuilder([]),
      leaves: queryBuilder([]),
    };
    service.attendanceLogRepo = { createQueryBuilder: jest.fn(() => qbs.logs) };
    service.shiftAssignmentRepo = { createQueryBuilder: jest.fn(() => qbs.assignments) };
    service.shiftChangeRequestRepo = { createQueryBuilder: jest.fn(() => qbs.changes) };
    service.leaveRequestRepo = { createQueryBuilder: jest.fn(() => qbs.leaves) };
    service.shiftSlotRepo = { createQueryBuilder: jest.fn(() => queryBuilder([])) };
    return { service, qbs };
  };

  const fromBound = (qb: any) =>
    qb.andWhere.mock.calls.find(
      ([clause]: [string]) => clause.includes('>= :from'),
    )?.[1]?.from as Date;

  it('activities start at the stint floor when it is inside the range', async () => {
    const { service, qbs } = activitiesService(JOINED);

    await service.getEmployeeActivities({
      storeId: 'store-1',
      employeeId: 'employee-1',
      from: '2026-09-01',
      to: '2026-09-30',
      ownerAccountId: 'owner-1',
    });

    // joinedAt − 60 s tolerance.
    for (const qb of Object.values(qbs)) {
      expect(fromBound(qb).toISOString()).toBe('2026-09-10T02:59:00.000Z');
    }
  });

  it('activities keep the requested range when it starts after the stint', async () => {
    const { service, qbs } = activitiesService(JOINED);

    await service.getEmployeeActivities({
      storeId: 'store-1',
      employeeId: 'employee-1',
      from: '2026-09-15',
      to: '2026-09-30',
      ownerAccountId: 'owner-1',
    });

    expect(fromBound(qbs.logs).toISOString()).toBe('2026-09-14T17:00:00.000Z');
  });
});
