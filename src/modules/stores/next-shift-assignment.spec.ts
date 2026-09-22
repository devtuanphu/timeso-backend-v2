import { StoresService } from './stores.service';
import { ShiftAssignmentStatus } from './entities/shift-management.entity';

/**
 * `getNextShiftAssignment` drives the staff Home card and the check-in flow.
 *
 * It had no notion of the current time: the check-in branch selected purely on
 * status, `checkInTime IS NULL` and work date, so a 10:00-12:00 shift was still
 * offered for check-in at 15:00 and nothing reported that it was over.
 */

/** A chainable query-builder double whose terminal call is queued per use. */
const builderReturning = (terminal: Record<string, unknown>) => {
  const builder: Record<string, unknown> = {};
  for (const method of [
    'leftJoin',
    'leftJoinAndSelect',
    'select',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'limit',
  ]) {
    builder[method] = jest.fn(() => builder);
  }
  return Object.assign(builder, terminal);
};

const assignment = (over: Record<string, unknown> = {}) => ({
  id: 'assignment-1',
  status: ShiftAssignmentStatus.APPROVED,
  checkInTime: null,
  checkOutTime: null,
  lateMinutes: 0,
  shiftSlot: {
    id: 'slot-1',
    workDate: '2026-09-13',
    location: '',
    note: '',
    workShift: {
      shiftName: 'Ca sáng',
      startTime: '10:00',
      endTime: '12:00',
    },
  },
  ...over,
});

/**
 * Wires the query-builder calls the method makes, in order: the day's shift
 * count, today's worked total, the active assignment, today's + yesterday's
 * assignments (approved candidates and finished shifts together), then
 * (terminal states only) the upcoming-shift look-ahead.
 */
function build({
  active = null,
  approved = [],
  done = null,
  loaded,
  workedToday = 0,
  upcoming = [],
  onLeave = false,
}: {
  active?: unknown;
  approved?: unknown[];
  done?: unknown;
  loaded?: unknown[];
  workedToday?: number;
  upcoming?: unknown[];
  onLeave?: boolean;
} = {}) {
  const service = Object.create(StoresService.prototype) as any;
  service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const rows = loaded ?? [...approved, ...(done ? [done] : [])];
  const builders = [
    builderReturning({ getCount: jest.fn().mockResolvedValue(rows.length) }),
    builderReturning({
      getRawOne: jest.fn().mockResolvedValue({ total: String(workedToday) }),
    }),
    builderReturning({ getOne: jest.fn().mockResolvedValue(active) }),
    builderReturning({ getMany: jest.fn().mockResolvedValue(rows) }),
    builderReturning({ getMany: jest.fn().mockResolvedValue(upcoming) }),
  ];
  const queue = [...builders];
  service.shiftAssignmentRepository = {
    createQueryBuilder: jest.fn(() => queue.shift()),
  };
  service.dataSource = {
    query: jest.fn().mockResolvedValue([{ covered: onLeave }]),
  };
  service.builders = builders;
  return service;
}

const at = (iso: string) => {
  jest.useFakeTimers().setSystemTime(new Date(iso));
};

describe('getNextShiftAssignment — ca đã qua giờ', () => {
  afterEach(() => jest.useRealTimers());

  // 15:00 local (+07) on the work date; the 10:00-12:00 shift is long over.
  it('does not offer check-in for a shift whose end time has passed', async () => {
    at('2026-09-13T08:00:00Z');
    const service = build({ approved: [assignment()] });

    const result = await service.getNextShiftAssignment('emp-1', 'store-1');

    expect(result.mode).not.toBe('check-in');
    expect(result).toMatchObject({ mode: 'done', shiftEnded: true, missed: true });
  });

  // 09:00 local — the same shift has not started yet, so it stays actionable.
  it('still offers check-in before the shift ends', async () => {
    at('2026-09-13T02:00:00Z');
    const service = build({ approved: [assignment()] });

    const result = await service.getNextShiftAssignment('emp-1', 'store-1');

    expect(result).toMatchObject({
      mode: 'check-in',
      shiftEnded: false,
      missed: false,
    });
  });

  // 11:00 local — inside the shift. Late is not the same as missed.
  it('offers check-in while the shift is still running', async () => {
    at('2026-09-13T04:00:00Z');
    const service = build({ approved: [assignment()] });

    expect(
      (await service.getNextShiftAssignment('emp-1', 'store-1')).mode,
    ).toBe('check-in');
  });

  // A 22:00-02:00 shift ends on the following day; treating 02:00 as earlier
  // than 22:00 on the same date would mark it over before it began.
  it('does not treat a cross-midnight shift as expired at 23:00', async () => {
    at('2026-09-13T16:00:00Z');
    const service = build({
      approved: [
        assignment({
          shiftSlot: {
            ...assignment().shiftSlot,
            workShift: { shiftName: 'Ca đêm', startTime: '22:00', endTime: '02:00' },
          },
        }),
      ],
    });

    expect(
      (await service.getNextShiftAssignment('emp-1', 'store-1')).mode,
    ).toBe('check-in');
  });

  // Picks the shift that is still actionable rather than the earliest row.
  it('skips the expired shift and offers the later one', async () => {
    at('2026-09-13T08:00:00Z');
    const later = assignment({
      id: 'assignment-2',
      shiftSlot: {
        ...assignment().shiftSlot,
        id: 'slot-2',
        workShift: { shiftName: 'Ca chiều', startTime: '17:00', endTime: '21:00' },
      },
    });
    const service = build({ approved: [assignment(), later] });

    expect(await service.getNextShiftAssignment('emp-1', 'store-1')).toMatchObject({
      mode: 'check-in',
      assignmentId: 'assignment-2',
    });
  });
});

describe('getNextShiftAssignment — sau khi tự động check-out', () => {
  afterEach(() => jest.useRealTimers());

  // The reported bug: the app rendered this as "chưa vào ca" because it only
  // special-cased 'check-out'. The shift is finished and must say so.
  it('reports a completed shift as done, not as awaiting check-in', async () => {
    at('2026-09-13T08:00:00Z');
    const service = build({
      done: assignment({
        status: ShiftAssignmentStatus.COMPLETED,
        checkInTime: new Date('2026-09-13T03:00:00Z'),
        checkOutTime: new Date('2026-09-13T05:00:00Z'),
      }),
    });

    const result = await service.getNextShiftAssignment('emp-1', 'store-1');

    expect(result).toMatchObject({ mode: 'done', shiftEnded: true, missed: false });
  });

  // Still checked in past the end time — the app should prompt a check-out.
  it('flags an open shift that has run past its end time', async () => {
    at('2026-09-13T08:00:00Z');
    const service = build({
      active: assignment({
        status: ShiftAssignmentStatus.CONFIRMED,
        checkInTime: new Date('2026-09-13T03:00:00Z'),
      }),
    });

    expect(await service.getNextShiftAssignment('emp-1', 'store-1')).toMatchObject({
      mode: 'check-out',
      shiftEnded: true,
    });
  });
});

describe('getNextShiftAssignment — additive attendance fields', () => {
  afterEach(() => jest.useRealTimers());

  it('uses the Vietnam date at 06:30 VN on a UTC server', async () => {
    at('2026-09-12T23:30:00Z'); // 06:30 on 13/09 in Vietnam
    const service = build({ approved: [assignment()] });
    await service.getNextShiftAssignment('emp-1', 'store-1');
    const countBuilder = service.builders[0];
    expect(countBuilder.andWhere).toHaveBeenCalledWith(
      'slot.workDate = :todayStr',
      { todayStr: '2026-09-13' },
    );
  });

  it('done after an auto check-out carries worked minutes and the reason', async () => {
    at('2026-09-13T08:00:00Z');
    const service = build({
      workedToday: 486,
      done: assignment({
        status: ShiftAssignmentStatus.COMPLETED,
        attendanceStatus: 'FORGOT_CHECKOUT',
        checkInTime: new Date('2026-09-13T03:00:00Z'),
        checkOutTime: new Date('2026-09-13T05:15:00Z'),
        scheduledCheckoutTime: new Date('2026-09-13T05:00:00Z'),
        workedMinutes: 120,
        earlyMinutes: 0,
        isAutoCheckout: true,
        autoCheckoutReason: 'FORGOT_CHECKOUT',
      }),
    });
    expect(
      await service.getNextShiftAssignment('emp-1', 'store-1'),
    ).toMatchObject({
      mode: 'done',
      attendanceStatus: 'FORGOT_CHECKOUT',
      checkOutTime: '2026-09-13T05:15:00.000Z',
      scheduledCheckoutTime: '2026-09-13T05:00:00.000Z',
      workedMinutes: 120,
      workedMinutesToday: 486,
      autoCheckoutReason: 'FORGOT_CHECKOUT',
      autoCheckedOut: true,
      onLeave: false,
      nextShift: null,
    });
  });

  it('a missed shift reports ABSENT, or onLeave with an approved leave', async () => {
    at('2026-09-13T08:00:00Z');
    const absent = build({
      approved: [assignment({ attendanceStatus: 'ABSENT' })],
    });
    expect(
      await absent.getNextShiftAssignment('emp-1', 'store-1'),
    ).toMatchObject({
      mode: 'done',
      missed: true,
      attendanceStatus: 'ABSENT',
      onLeave: false,
    });

    const leave = build({ approved: [assignment()], onLeave: true });
    expect(
      await leave.getNextShiftAssignment('emp-1', 'store-1'),
    ).toMatchObject({
      mode: 'done',
      missed: true,
      attendanceStatus: null,
      onLeave: true,
    });
  });

  it('returns the next upcoming shift (skipping one already started)', async () => {
    at('2026-09-13T08:00:00Z'); // 15:00 VN
    const service = build({
      upcoming: [
        assignment({ id: 'started' }), // 10:00 today: already started
        assignment({
          id: 'tomorrow',
          shiftSlot: {
            ...assignment().shiftSlot,
            workDate: '2026-09-14',
            startTime: '08:00:00',
            endTime: '12:00:00',
          },
        }),
      ],
    });
    const result = await service.getNextShiftAssignment('emp-1', 'store-1');
    expect(result.mode).toBe('none');
    expect(result.nextShift).toEqual({
      assignmentId: 'tomorrow',
      workDate: '2026-09-14',
      startTime: '08:00:00',
      endTime: '12:00:00',
      shiftName: 'Ca sáng',
      startsAt: '2026-09-14T01:00:00.000Z',
    });
    expect(result.workedMinutesToday).toBe(0);
  });

  it("mode 'none' carries every contract field with empty defaults", async () => {
    at('2026-09-13T08:00:00Z');
    const service = build();
    const result = await service.getNextShiftAssignment('emp-1', 'store-1');
    expect(result).toMatchObject({
      mode: 'none',
      assignmentId: null,
      workDate: null,
      shiftSlotId: null,
      shiftEnded: false,
      missed: false,
      onLeave: false,
      attendanceStatus: null,
      checkOutTime: null,
      workedMinutes: 0,
      earlyMinutes: 0,
      autoCheckoutReason: null,
      autoCheckedOut: false,
      scheduledCheckoutTime: null,
      workedMinutesToday: 0,
      nextShift: null,
    });
    // Same keys as a 'done' response, so the app reads one shape.
    const done = await build({
      done: assignment({ status: ShiftAssignmentStatus.COMPLETED }),
    }).getNextShiftAssignment('emp-1', 'store-1');
    expect(Object.keys(result).sort()).toEqual(Object.keys(done).sort());
  });

  it('orders the look-ahead by the effective start time (slot over work shift)', async () => {
    at('2026-09-13T08:00:00Z');
    const service = build();
    await service.getNextShiftAssignment('emp-1', 'store-1');
    const upcomingQuery = service.builders[4];
    expect(upcomingQuery.orderBy).toHaveBeenCalledWith('slot.workDate', 'ASC');
    expect(upcomingQuery.addOrderBy).toHaveBeenCalledWith(
      'COALESCE(slot.start_time, ws.start_time)',
      'ASC',
    );
    expect(upcomingQuery.addOrderBy).not.toHaveBeenCalledWith(
      'ws.startTime',
      'ASC',
    );
  });
});

describe('getNextShiftAssignment — R5: relevant shift, deltas, worked today', () => {
  afterEach(() => jest.useRealTimers());

  const shiftOn = (
    id: string,
    workDate: string,
    startTime: string,
    endTime: string,
    over: Record<string, unknown> = {},
  ) =>
    assignment({
      id,
      shiftSlot: {
        id: `slot-${id}`,
        workDate,
        location: '',
        note: '',
        workShift: { shiftName: `Ca ${id}`, startTime, endTime },
      },
      ...over,
    });

  it('check-in and check-out modes carry workedMinutesToday', async () => {
    at('2026-09-13T08:00:00Z'); // 15:00 VN
    const afternoon = shiftOn('pm', '2026-09-13', '16:00', '20:00');
    const checkIn = await build({
      approved: [afternoon],
      workedToday: 240,
    }).getNextShiftAssignment('emp-1', 'store-1');
    expect(checkIn).toMatchObject({ mode: 'check-in', workedMinutesToday: 240 });

    const checkOut = await build({
      active: shiftOn('pm', '2026-09-13', '14:00', '20:00', {
        status: ShiftAssignmentStatus.CONFIRMED,
        checkInTime: new Date('2026-09-13T06:50:00Z'),
      }),
      workedToday: 240,
    }).getNextShiftAssignment('emp-1', 'store-1');
    expect(checkOut).toMatchObject({
      mode: 'check-out',
      workedMinutesToday: 240,
      // 13:50 check-in for a 14:00 shift.
      earlyArrivalMinutes: 10,
      overtimeMinutes: 0,
    });
  });

  it('done mode reports early arrival and overtime like the result screens', async () => {
    at('2026-09-13T12:00:00Z'); // 19:00 VN
    const result = await build({
      done: shiftOn('am', '2026-09-13', '08:00', '17:00', {
        status: ShiftAssignmentStatus.COMPLETED,
        checkInTime: new Date('2026-09-13T00:48:00Z'), // 07:48
        checkOutTime: new Date('2026-09-13T10:20:00Z'), // 17:20
        workedMinutes: 572,
      }),
    }).getNextShiftAssignment('emp-1', 'store-1');
    expect(result).toMatchObject({
      mode: 'done',
      earlyArrivalMinutes: 12,
      overtimeMinutes: 20,
      earlyMinutes: 0,
    });

    // An automatic check-out is never overtime.
    const auto = await build({
      done: shiftOn('am', '2026-09-13', '08:00', '17:00', {
        status: ShiftAssignmentStatus.COMPLETED,
        checkInTime: new Date('2026-09-13T01:00:00Z'),
        checkOutTime: new Date('2026-09-13T10:15:00Z'),
        isAutoCheckout: true,
        autoCheckoutReason: 'FORGOT_CHECKOUT',
      }),
    }).getNextShiftAssignment('emp-1', 'store-1');
    expect(auto).toMatchObject({ overtimeMinutes: 0, autoCheckedOut: true });
  });

  it('a missed morning shift does not hide the afternoon shift completed after it', async () => {
    at('2026-09-13T12:00:00Z'); // 19:00 VN
    const morning = shiftOn('am', '2026-09-13', '08:00', '12:00', {
      attendanceStatus: 'ABSENT',
    });
    const afternoon = shiftOn('pm', '2026-09-13', '13:00', '17:00', {
      status: ShiftAssignmentStatus.COMPLETED,
      checkInTime: new Date('2026-09-13T06:00:00Z'),
      checkOutTime: new Date('2026-09-13T10:00:00Z'),
      workedMinutes: 240,
    });
    const result = await build({
      loaded: [morning, afternoon],
      workedToday: 240,
    }).getNextShiftAssignment('emp-1', 'store-1');
    expect(result).toMatchObject({
      mode: 'done',
      assignmentId: 'pm',
      missed: false,
      workedMinutesToday: 240,
    });

    // The other way round: the later missed shift is the one shown.
    const done = await build({
      loaded: [
        shiftOn('am', '2026-09-13', '08:00', '12:00', {
          status: ShiftAssignmentStatus.COMPLETED,
          checkInTime: new Date('2026-09-13T01:00:00Z'),
          checkOutTime: new Date('2026-09-13T05:00:00Z'),
        }),
        shiftOn('pm', '2026-09-13', '13:00', '17:00'),
      ],
    }).getNextShiftAssignment('emp-1', 'store-1');
    expect(done).toMatchObject({ mode: 'done', assignmentId: 'pm', missed: true });
  });

  it("after midnight, yesterday's overnight shift is still returned", async () => {
    // 01:00 VN on 14/09: yesterday's 22:00-06:00 shift not checked into yet.
    at('2026-09-13T18:00:00Z');
    const overnight = shiftOn('night', '2026-09-13', '22:00', '06:00');
    const service = build({ approved: [overnight] });
    const running = await service.getNextShiftAssignment('emp-1', 'store-1');
    expect(running).toMatchObject({
      mode: 'check-in',
      assignmentId: 'night',
      workDate: '2026-09-13',
    });
    const loadedQuery = service.builders[3];
    expect(loadedQuery.andWhere).toHaveBeenCalledWith(
      'slot.workDate IN (:...workDates)',
      { workDates: ['2026-09-13', '2026-09-14'] },
    );

    // 07:00 VN: it ended with an automatic check-out.
    at('2026-09-14T00:00:00Z');
    const finished = await build({
      done: shiftOn('night', '2026-09-13', '22:00', '06:00', {
        status: ShiftAssignmentStatus.COMPLETED,
        attendanceStatus: 'FORGOT_CHECKOUT',
        checkInTime: new Date('2026-09-13T15:00:00Z'),
        checkOutTime: new Date('2026-09-13T23:15:00Z'),
        scheduledCheckoutTime: new Date('2026-09-13T23:00:00Z'),
        isAutoCheckout: true,
      }),
    }).getNextShiftAssignment('emp-1', 'store-1');
    expect(finished).toMatchObject({
      mode: 'done',
      assignmentId: 'night',
      attendanceStatus: 'FORGOT_CHECKOUT',
    });
  });

  it("a normal shift of yesterday is not shown today", async () => {
    at('2026-09-14T01:00:00Z'); // 08:00 VN on 14/09
    const result = await build({
      done: shiftOn('y', '2026-09-13', '08:00', '12:00', {
        status: ShiftAssignmentStatus.COMPLETED,
        checkInTime: new Date('2026-09-13T01:00:00Z'),
        checkOutTime: new Date('2026-09-13T05:00:00Z'),
      }),
    }).getNextShiftAssignment('emp-1', 'store-1');
    expect(result.mode).toBe('none');
    expect(result).toMatchObject({ earlyArrivalMinutes: 0, overtimeMinutes: 0 });
  });

  it("uses the slot's own times over the work shift's", async () => {
    at('2026-09-13T02:00:00Z'); // 09:00 VN
    const result = await build({
      approved: [
        assignment({
          shiftSlot: {
            ...assignment().shiftSlot,
            startTime: '10:30:00',
            endTime: '12:30:00',
          },
        }),
      ],
    }).getNextShiftAssignment('emp-1', 'store-1');
    expect(result).toMatchObject({ startTime: '10:30:00', endTime: '12:30:00' });
  });

  it('a leave-covered shift does not block check-in for the next real shift', async () => {
    at('2026-09-13T02:00:00Z'); // 09:00 VN
    const morning = shiftOn('am', '2026-09-13', '08:00', '12:00');
    const afternoon = shiftOn('pm', '2026-09-13', '12:00', '17:00');
    const service = build({ approved: [morning, afternoon] });
    // Only the morning shift is covered by the approved leave.
    service.dataSource.query = jest.fn(
      async (_sql: string, params: unknown[]) => [{ covered: params[2] === 'am' }],
    );
    expect(await service.getNextShiftAssignment('emp-1', 'store-1')).toMatchObject({
      mode: 'check-in',
      assignmentId: 'pm',
      onLeave: false,
    });
  });

  it('returns the leave shift as onLeave when no other shift is actionable', async () => {
    at('2026-09-13T02:00:00Z'); // 09:00 VN
    const morning = shiftOn('am', '2026-09-13', '08:00', '12:00');
    const afternoon = shiftOn('pm', '2026-09-13', '12:00', '17:00');
    const result = await build({
      approved: [morning, afternoon],
      onLeave: true,
    }).getNextShiftAssignment('emp-1', 'store-1');
    expect(result).toMatchObject({
      mode: 'check-in',
      assignmentId: 'am',
      onLeave: true,
    });
  });
});
