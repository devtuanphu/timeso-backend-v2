import {
  calculateEarlyMinutes,
  calculateLateMinutes,
  computeAttendanceDeltas,
  resolveShiftBoundaries,
} from './attendance-time.utils';

/** Vietnam wall-clock time expressed as an absolute instant. */
const vn = (iso: string) => new Date(`${iso}+07:00`);

describe('resolveShiftBoundaries', () => {
  it('anchors a same-day shift to its work date', () => {
    const { start, end } = resolveShiftBoundaries('2026-05-05', '08:00', '17:00');
    expect(start).toEqual(vn('2026-05-05T08:00'));
    expect(end).toEqual(vn('2026-05-05T17:00'));
  });

  it('rolls an overnight shift end to the next day', () => {
    const { start, end } = resolveShiftBoundaries('2026-05-05', '22:00', '06:00');
    expect(start).toEqual(vn('2026-05-05T22:00'));
    expect(end).toEqual(vn('2026-05-06T06:00'));
  });

  it('rolls a shift whose end equals its start to a full 24 hours', () => {
    const { end } = resolveShiftBoundaries('2026-05-05', '09:00', '09:00');
    expect(end).toEqual(vn('2026-05-06T09:00'));
  });

  it('accepts postgres time values that carry seconds', () => {
    const { start } = resolveShiftBoundaries('2026-05-05', '08:00:00', '17:00:00');
    expect(start).toEqual(vn('2026-05-05T08:00'));
  });

  it('returns nulls for missing or malformed input', () => {
    expect(resolveShiftBoundaries(null, '08:00', '17:00')).toEqual({
      start: null,
      end: null,
    });
    expect(resolveShiftBoundaries('2026-05-05', undefined, undefined)).toEqual({
      start: null,
      end: null,
    });
    expect(resolveShiftBoundaries('05/05/2026', '08:00', '17:00').start).toBeNull();
    expect(resolveShiftBoundaries('2026-05-05', 'bogus', '17:00').start).toBeNull();
  });

  it('is independent of the server timezone', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const utc = resolveShiftBoundaries('2026-05-05', '08:00', '17:00');
      process.env.TZ = 'America/New_York';
      const ny = resolveShiftBoundaries('2026-05-05', '08:00', '17:00');
      expect(utc.start!.getTime()).toBe(ny.start!.getTime());
      expect(utc.start!.toISOString()).toBe('2026-05-05T01:00:00.000Z');
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('late and early minutes', () => {
  it('counts minutes late after the shift start', () => {
    const { start } = resolveShiftBoundaries('2026-05-05', '08:00', '17:00');
    expect(calculateLateMinutes(start, vn('2026-05-05T08:10'))).toBe(10);
  });

  it('reports zero when arriving early', () => {
    const { start } = resolveShiftBoundaries('2026-05-05', '08:00', '17:00');
    expect(calculateLateMinutes(start, vn('2026-05-05T07:45'))).toBe(0);
  });

  // Regression: the previous `setHours` maths put the boundary in the future for
  // an overnight shift, so this 150-minute late arrival was recorded as on time.
  it('counts a late arrival on an overnight shift', () => {
    const { start } = resolveShiftBoundaries('2026-05-05', '22:00', '06:00');
    expect(calculateLateMinutes(start, vn('2026-05-06T00:30'))).toBe(150);
  });

  it('counts minutes left when checking out early', () => {
    const { end } = resolveShiftBoundaries('2026-05-05', '08:00', '17:00');
    expect(calculateEarlyMinutes(end, vn('2026-05-05T16:30'))).toBe(30);
  });

  // Regression: checking out at 05:30 on an overnight shift is 30 minutes early,
  // not "11 hours late relative to today 06:00".
  it('counts an early checkout on an overnight shift', () => {
    const { end } = resolveShiftBoundaries('2026-05-05', '22:00', '06:00');
    expect(calculateEarlyMinutes(end, vn('2026-05-06T05:30'))).toBe(30);
    expect(calculateEarlyMinutes(end, vn('2026-05-06T06:10'))).toBe(0);
  });

  it('treats unknown boundaries as neither late nor early', () => {
    expect(calculateLateMinutes(null, new Date())).toBe(0);
    expect(calculateEarlyMinutes(null, new Date())).toBe(0);
  });
});

describe('computeAttendanceDeltas', () => {
  it('check-in 07:48 for an 08:00 shift is 12 minutes early', () => {
    const { start, end } = resolveShiftBoundaries('2026-09-18', '08:00', '12:00');
    expect(
      computeAttendanceDeltas({
        start,
        end,
        checkIn: new Date('2026-09-18T07:48:00+07:00'),
      }),
    ).toEqual({
      lateMinutes: 0,
      earlyArrivalMinutes: 12,
      earlyMinutes: 0,
      overtimeMinutes: 0,
    });
  });

  it('cross-midnight 22:00-02:00, check-out at 02:15 is 15 minutes overtime', () => {
    const { start, end } = resolveShiftBoundaries('2026-09-18', '22:00', '02:00');
    expect(
      computeAttendanceDeltas({
        start,
        end,
        checkIn: new Date('2026-09-18T22:07:00+07:00'),
        checkOut: new Date('2026-09-19T02:15:00+07:00'),
      }),
    ).toEqual({
      lateMinutes: 7,
      earlyArrivalMinutes: 0,
      earlyMinutes: 0,
      overtimeMinutes: 15,
    });
  });

  it('early check-out and auto check-out', () => {
    const { start, end } = resolveShiftBoundaries('2026-09-18', '08:00', '17:00');
    const checkIn = new Date('2026-09-18T08:00:00+07:00');
    expect(
      computeAttendanceDeltas({
        start,
        end,
        checkIn,
        checkOut: new Date('2026-09-18T15:50:00+07:00'),
      }).earlyMinutes,
    ).toBe(70);
    // Auto check-out at end + 15: paid to the end, no overtime.
    expect(
      computeAttendanceDeltas({
        start,
        end,
        checkIn,
        checkOut: new Date('2026-09-18T17:15:00+07:00'),
        autoCheckedOut: true,
      }),
    ).toMatchObject({ earlyMinutes: 0, overtimeMinutes: 0 });
  });
});
