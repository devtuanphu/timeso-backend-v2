import {
  applyGrace,
  checkInOpensAt,
  creditedWorkedMinutes,
  DEFAULT_ATTENDANCE_RULES,
  resolveAttendanceRules,
} from './attendance-rules';
import { resolveShiftBoundaries } from './attendance-time.utils';

/** Vietnam wall-clock time expressed as an absolute instant. */
const vn = (iso: string) => new Date(`${iso}+07:00`);

describe('resolveAttendanceRules', () => {
  it('falls back to the defaults without a settings row', () => {
    expect(resolveAttendanceRules(null)).toEqual(DEFAULT_ATTENDANCE_RULES);
    expect(resolveAttendanceRules(undefined)).toEqual(DEFAULT_ATTENDANCE_RULES);
  });

  it('reads the owner settings', () => {
    expect(
      resolveAttendanceRules({
        allowedLateMinutes: 10,
        earlyCheckinMinutes: 30,
        lateCheckoutMinutes: 45,
        countFullTimeIfLate: false,
        deductWorkTimeIfLate: true,
      }),
    ).toEqual({
      graceMinutes: 10,
      earlyCheckinMinutes: 30,
      lateCheckoutMinutes: 45,
      creditLateEarly: false,
    });
  });

  it('credits late/early time when full time is counted or nothing is deducted', () => {
    expect(
      resolveAttendanceRules({ countFullTimeIfLate: true }).creditLateEarly,
    ).toBe(true);
    expect(
      resolveAttendanceRules({ deductWorkTimeIfLate: false }).creditLateEarly,
    ).toBe(true);
  });

  it('ignores unusable values', () => {
    expect(
      resolveAttendanceRules({
        allowedLateMinutes: -5,
        earlyCheckinMinutes: null,
        lateCheckoutMinutes: Number.NaN,
      }),
    ).toEqual(DEFAULT_ATTENDANCE_RULES);
    // A postgres int/decimal may arrive as a string.
    expect(
      resolveAttendanceRules({ allowedLateMinutes: '7' as unknown as number })
        .graceMinutes,
    ).toBe(7);
  });
});

describe('applyGrace', () => {
  const rules = { ...DEFAULT_ATTENDANCE_RULES, graceMinutes: 10 };

  it('treats minutes within the grace as on time', () => {
    expect(applyGrace(0, rules)).toBe(0);
    expect(applyGrace(10, rules)).toBe(0);
  });

  it('records the full minutes beyond the grace', () => {
    expect(applyGrace(11, rules)).toBe(11);
    expect(applyGrace(45, rules)).toBe(45);
  });

  it('is the raw value with the default (no grace)', () => {
    expect(applyGrace(1, DEFAULT_ATTENDANCE_RULES)).toBe(1);
    expect(applyGrace(0, DEFAULT_ATTENDANCE_RULES)).toBe(0);
  });
});

describe('checkInOpensAt', () => {
  it('opens check-in the configured minutes before the start', () => {
    const { start } = resolveShiftBoundaries('2026-10-01', '08:00', '12:00');
    expect(checkInOpensAt(start, DEFAULT_ATTENDANCE_RULES)).toEqual(
      vn('2026-10-01T07:45'),
    );
    expect(
      checkInOpensAt(start, { ...DEFAULT_ATTENDANCE_RULES, earlyCheckinMinutes: 0 }),
    ).toEqual(vn('2026-10-01T08:00'));
  });

  it('opens the evening before for a shift starting just after midnight', () => {
    const { start } = resolveShiftBoundaries('2026-10-02', '00:10', '06:00');
    expect(checkInOpensAt(start, DEFAULT_ATTENDANCE_RULES)).toEqual(
      vn('2026-10-01T23:55'),
    );
  });

  it('has no limit when the start is unknown', () => {
    expect(checkInOpensAt(null, DEFAULT_ATTENDANCE_RULES)).toBeNull();
  });
});

describe('creditedWorkedMinutes', () => {
  const { start, end } = resolveShiftBoundaries('2026-10-01', '08:00', '12:00');

  it('equals check-in to check-out with the defaults', () => {
    expect(
      creditedWorkedMinutes({
        start,
        end,
        checkIn: vn('2026-10-01T08:07'),
        checkOut: vn('2026-10-01T11:50'),
        rules: DEFAULT_ATTENDANCE_RULES,
      }),
    ).toBe(223);
  });

  it('counts from the start / to the end within the grace', () => {
    expect(
      creditedWorkedMinutes({
        start,
        end,
        checkIn: vn('2026-10-01T08:07'),
        checkOut: vn('2026-10-01T11:55'),
        rules: { ...DEFAULT_ATTENDANCE_RULES, graceMinutes: 10 },
      }),
    ).toBe(240);
  });

  it('deducts the whole late time beyond the grace', () => {
    expect(
      creditedWorkedMinutes({
        start,
        end,
        checkIn: vn('2026-10-01T08:25'),
        checkOut: vn('2026-10-01T12:00'),
        rules: { ...DEFAULT_ATTENDANCE_RULES, graceMinutes: 10 },
      }),
    ).toBe(215);
  });

  it('never deducts when the store counts full time', () => {
    expect(
      creditedWorkedMinutes({
        start,
        end,
        checkIn: vn('2026-10-01T08:40'),
        checkOut: vn('2026-10-01T11:00'),
        rules: { ...DEFAULT_ATTENDANCE_RULES, creditLateEarly: true },
      }),
    ).toBe(240);
  });

  it('pays neither early arrival nor staying late without overtime', () => {
    expect(
      creditedWorkedMinutes({
        start,
        end,
        checkIn: vn('2026-10-01T07:50'),
        checkOut: vn('2026-10-01T12:20'),
        rules: { ...DEFAULT_ATTENDANCE_RULES, creditLateEarly: true },
      }),
    ).toBe(240);
  });

  it('shift 05:00-10:00, checked out at 12:00 without overtime: 5 hours', () => {
    const early = resolveShiftBoundaries('2026-10-01', '05:00', '10:00');
    expect(
      creditedWorkedMinutes({
        start: early.start,
        end: early.end,
        checkIn: vn('2026-10-01T05:00'),
        checkOut: vn('2026-10-01T12:00'),
        rules: DEFAULT_ATTENDANCE_RULES,
      }),
    ).toBe(300);
  });

  it('pays staying late up to the approved overtime end', () => {
    const at = (checkOut: string, paidUntil: string) =>
      creditedWorkedMinutes({
        start,
        end,
        checkIn: vn('2026-10-01T08:00'),
        checkOut: vn(checkOut),
        rules: DEFAULT_ATTENDANCE_RULES,
        paidUntil: vn(paidUntil),
      });
    // Approved to 13:00, left 12:20: the 20 minutes are paid.
    expect(at('2026-10-01T12:20', '2026-10-01T13:00')).toBe(260);
    // Approved to 12:10, left 12:20: paid to 12:10.
    expect(at('2026-10-01T12:20', '2026-10-01T12:10')).toBe(250);
    // An "overtime end" before the shift end never shortens the shift.
    expect(at('2026-10-01T12:00', '2026-10-01T11:00')).toBe(240);
  });

  it('handles a cross-midnight shift', () => {
    const night = resolveShiftBoundaries('2026-10-01', '22:00', '06:00');
    expect(
      creditedWorkedMinutes({
        start: night.start,
        end: night.end,
        checkIn: vn('2026-10-01T22:05'),
        checkOut: vn('2026-10-02T05:58'),
        rules: { ...DEFAULT_ATTENDANCE_RULES, graceMinutes: 5 },
      }),
    ).toBe(480);
  });

  it('follows the lateness recorded at check-in when given', () => {
    // Late 7 min, recorded as late (grace was 5); the owner raised the grace
    // to 10 during the shift: still deducted, matching the LATE record.
    expect(
      creditedWorkedMinutes({
        start,
        end,
        checkIn: vn('2026-10-01T08:07'),
        checkOut: vn('2026-10-01T12:00'),
        rules: { ...DEFAULT_ATTENDANCE_RULES, graceMinutes: 10 },
        storedLateMinutes: 7,
      }),
    ).toBe(233);
    // Recorded as on time (forgiven) although today's grace is 0.
    expect(
      creditedWorkedMinutes({
        start,
        end,
        checkIn: vn('2026-10-01T08:07'),
        checkOut: vn('2026-10-01T12:00'),
        rules: DEFAULT_ATTENDANCE_RULES,
        storedLateMinutes: 0,
      }),
    ).toBe(240);
  });

  it('credits a sub-minute late arrival recorded as on time', () => {
    // 08:00:30 is recorded as 0 late minutes: worked time is the full shift,
    // never a minute less than arriving 4 minutes late within a 5-min grace.
    const onTime = creditedWorkedMinutes({
      start,
      end,
      checkIn: new Date(vn('2026-10-01T08:00').getTime() + 30_000),
      checkOut: vn('2026-10-01T12:00'),
      rules: { ...DEFAULT_ATTENDANCE_RULES, graceMinutes: 5 },
      storedLateMinutes: 0,
    });
    const fourLate = creditedWorkedMinutes({
      start,
      end,
      checkIn: new Date(vn('2026-10-01T08:04').getTime() + 30_000),
      checkOut: vn('2026-10-01T12:00'),
      rules: { ...DEFAULT_ATTENDANCE_RULES, graceMinutes: 5 },
      storedLateMinutes: 0,
    });
    expect(onTime).toBe(240);
    expect(fourLate).toBe(240);
  });

  it('credits a sub-minute early leave', () => {
    expect(
      creditedWorkedMinutes({
        start,
        end,
        checkIn: vn('2026-10-01T08:00'),
        checkOut: new Date(vn('2026-10-01T12:00').getTime() - 20_000),
        rules: DEFAULT_ATTENDANCE_RULES,
      }),
    ).toBe(240);
  });

  it('never goes below zero', () => {
    expect(
      creditedWorkedMinutes({
        start,
        end,
        checkIn: vn('2026-10-01T10:00'),
        checkOut: vn('2026-10-01T09:00'),
        rules: DEFAULT_ATTENDANCE_RULES,
      }),
    ).toBe(0);
  });
});
