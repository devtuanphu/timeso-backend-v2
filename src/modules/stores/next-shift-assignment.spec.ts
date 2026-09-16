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
    'where',
    'andWhere',
    'orderBy',
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
 * Wires the four query-builder calls the method makes, in order: the day's
 * shift count, the active assignment, the approved candidates, and the
 * already-processed fallback.
 */
function build({
  active = null,
  approved = [],
  done = null,
}: {
  active?: unknown;
  approved?: unknown[];
  done?: unknown;
} = {}) {
  const service = Object.create(StoresService.prototype) as any;
  service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const queue = [
    builderReturning({ getCount: jest.fn().mockResolvedValue(approved.length) }),
    builderReturning({ getOne: jest.fn().mockResolvedValue(active) }),
    builderReturning({ getMany: jest.fn().mockResolvedValue(approved) }),
    builderReturning({ getOne: jest.fn().mockResolvedValue(done) }),
  ];
  service.shiftAssignmentRepository = {
    createQueryBuilder: jest.fn(() => queue.shift()),
  };
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
