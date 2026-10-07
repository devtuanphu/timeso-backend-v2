import {
  ACTUAL_DEFAULT_FROM,
  defaultWorkedTimeMode,
  resolveWorkedTimeMode,
  ruleBounds,
  ruleCovers,
  ruleWindowEnd,
  shiftStartKey,
  vnKeyCeil,
  type WorkedTimeRuleLike,
} from '../../../../src/modules/stores/worked-time-rules';

describe('shiftStartKey / vnKeyCeil', () => {
  it('keys a shift by its work date and scheduled start', () => {
    expect(shiftStartKey('2026-10-02', '13:00')).toBe('2026-10-02 13:00');
    // Postgres time columns come back with seconds.
    expect(shiftStartKey('2026-10-02', '13:00:00')).toBe('2026-10-02 13:00');
    // A cross-midnight shift belongs to the day it starts.
    expect(shiftStartKey('2026-10-02', '22:00:00')).toBe('2026-10-02 22:00');
    expect(shiftStartKey('2026-10-02', null)).toBe('2026-10-02 00:00');
    expect(shiftStartKey(null, '13:00')).toBeNull();
  });

  it('reads Vietnam wall clock whatever the host timezone, rounded up', () => {
    // 07:00:00Z = 14:00 in Vietnam.
    expect(vnKeyCeil(new Date('2026-10-02T07:00:00Z'))).toBe(
      '2026-10-02 14:00',
    );
    expect(vnKeyCeil(new Date('2026-10-02T07:00:30Z'))).toBe(
      '2026-10-02 14:01',
    );
    expect(vnKeyCeil(new Date('2026-10-02T16:59:10Z'))).toBe(
      '2026-10-03 00:00',
    );
  });
});

describe('ruleWindowEnd', () => {
  it('ends a day, a week or a month later at the same time', () => {
    expect(ruleWindowEnd('2026-10-02', '14:00', 'DAY')).toEqual({
      endDate: '2026-10-03',
      endTime: '14:00',
    });
    expect(ruleWindowEnd('2026-10-02', '14:00', 'WEEK')).toEqual({
      endDate: '2026-10-09',
      endTime: '14:00',
    });
    expect(ruleWindowEnd('2026-10-02', '14:00', 'MONTH')).toEqual({
      endDate: '2026-11-02',
      endTime: '14:00',
    });
    expect(ruleWindowEnd('2026-10-02', '14:00', 'INDEFINITE')).toBeNull();
  });

  it('crosses month and year ends, and stops at the end of a shorter month', () => {
    expect(ruleWindowEnd('2026-12-28', '08:00', 'WEEK')?.endDate).toBe(
      '2027-01-04',
    );
    expect(ruleWindowEnd('2026-12-15', '08:00', 'MONTH')?.endDate).toBe(
      '2027-01-15',
    );
    expect(ruleWindowEnd('2026-01-31', '08:00', 'MONTH')?.endDate).toBe(
      '2026-02-28',
    );
    expect(ruleWindowEnd('2028-01-31', '08:00', 'MONTH')?.endDate).toBe(
      '2028-02-29',
    );
    expect(ruleWindowEnd('2026-03-31', '08:00', 'MONTH')?.endDate).toBe(
      '2026-04-30',
    );
  });

  it('refuses a malformed start', () => {
    expect(() => ruleWindowEnd('2026/10/02', '08:00', 'DAY')).toThrow();
  });
});

describe('ruleCovers', () => {
  const rule: WorkedTimeRuleLike = {
    mode: 'SHIFT',
    startDate: '2026-10-02',
    startTime: '14:00',
    endDate: '2026-10-03',
    endTime: '14:00',
  };

  it('covers the shifts starting in [start, end)', () => {
    expect(ruleCovers(rule, '2026-10-02 08:00')).toBe(false);
    expect(ruleCovers(rule, '2026-10-02 13:59')).toBe(false);
    expect(ruleCovers(rule, '2026-10-02 14:00')).toBe(true);
    expect(ruleCovers(rule, '2026-10-03 13:59')).toBe(true);
    expect(ruleCovers(rule, '2026-10-03 14:00')).toBe(false);
  });

  it('runs on without an end', () => {
    expect(
      ruleCovers({ ...rule, endDate: null, endTime: null }, '2030-01-01 00:00'),
    ).toBe(true);
  });

  it('reads a row saved before start times: start of day, last day inclusive', () => {
    const legacy: WorkedTimeRuleLike = {
      mode: 'SHIFT',
      startDate: '2026-10-02',
      startTime: null,
      endDate: '2026-10-08',
      endTime: null,
    };
    expect(ruleBounds(legacy)).toEqual({
      start: '2026-10-02 00:00',
      end: '2026-10-09 00:00',
      cut: null,
    });
    expect(ruleCovers(legacy, '2026-10-08 22:00')).toBe(true);
    expect(ruleCovers(legacy, '2026-10-09 00:00')).toBe(false);
  });

  it('keeps covering, after removal, the shifts that started before it', () => {
    // Removed at 14:00:30 Vietnam time.
    const removed = { ...rule, deletedAt: new Date('2026-10-02T07:00:30Z') };
    expect(ruleBounds(removed).cut).toBe('2026-10-02 14:01');
    // The 14:00 shift had started: it stays under the rule.
    expect(ruleCovers(removed, '2026-10-02 14:00')).toBe(true);
    expect(ruleCovers(removed, '2026-10-02 14:01')).toBe(false);
    expect(ruleCovers(removed, '2026-10-02 18:00')).toBe(false);
  });

  it('covers nothing once removed before it started', () => {
    const removedEarly = {
      ...rule,
      deletedAt: new Date('2026-10-02T03:00:00Z'),
    };
    expect(ruleCovers(removedEarly, '2026-10-02 14:00')).toBe(false);
  });
});

describe('defaultWorkedTimeMode', () => {
  it('is "theo giờ chấm công" for shifts from the release, "theo lịch làm" before', () => {
    expect(defaultWorkedTimeMode(ACTUAL_DEFAULT_FROM)).toBe('ACTUAL');
    expect(defaultWorkedTimeMode('2099-01-01 00:00')).toBe('ACTUAL');
    expect(defaultWorkedTimeMode('2026-09-30 08:00')).toBe('SHIFT');
  });
});

describe('resolveWorkedTimeMode', () => {
  const at = (iso: string) => new Date(iso);
  const storeShift: WorkedTimeRuleLike = {
    mode: 'SHIFT',
    startDate: '2026-11-01',
    startTime: '14:00',
    endDate: null,
    createdAt: at('2026-10-30T00:00:00Z'),
  };
  const employeeActualWeek: WorkedTimeRuleLike = {
    employeeProfileId: 'emp-a',
    mode: 'ACTUAL',
    startDate: '2026-11-05',
    startTime: '00:00',
    endDate: '2026-11-12',
    endTime: '00:00',
    createdAt: at('2026-10-29T00:00:00Z'),
  };

  it('uses the default without any rule', () => {
    expect(resolveWorkedTimeMode([], 'emp-a', '2026-11-02 08:00')).toBe(
      'ACTUAL',
    );
    expect(resolveWorkedTimeMode([], 'emp-a', '2026-09-30 08:00')).toBe(
      'SHIFT',
    );
  });

  it('separates the shifts of one day by the rule start time', () => {
    expect(
      resolveWorkedTimeMode([storeShift], 'emp-b', '2026-11-01 08:00'),
    ).toBe('ACTUAL');
    expect(
      resolveWorkedTimeMode([storeShift], 'emp-b', '2026-11-01 14:00'),
    ).toBe('SHIFT');
  });

  it('lets an employee rule beat the store rule, even when older', () => {
    const rules = [storeShift, employeeActualWeek];
    expect(resolveWorkedTimeMode(rules, 'emp-a', '2026-11-06 08:00')).toBe(
      'ACTUAL',
    );
    // Outside the employee's week the store rule applies again.
    expect(resolveWorkedTimeMode(rules, 'emp-a', '2026-11-12 08:00')).toBe(
      'SHIFT',
    );
    expect(resolveWorkedTimeMode(rules, 'emp-b', '2026-11-06 08:00')).toBe(
      'SHIFT',
    );
  });

  it('takes the newest of overlapping rules at the same level', () => {
    const newerActual: WorkedTimeRuleLike = {
      mode: 'ACTUAL',
      startDate: '2026-11-03',
      startTime: '00:00',
      endDate: '2026-11-04',
      endTime: '00:00',
      createdAt: at('2026-11-02T00:00:00Z'),
    };
    const rules = [storeShift, newerActual];
    expect(resolveWorkedTimeMode(rules, 'emp-b', '2026-11-03 09:00')).toBe(
      'ACTUAL',
    );
    expect(resolveWorkedTimeMode(rules, 'emp-b', '2026-11-04 09:00')).toBe(
      'SHIFT',
    );
  });
});
