import {
  resolveWorkedTimeMode,
  ruleCovers,
  ruleEndDate,
  type WorkedTimeRuleLike,
} from './worked-time-rules';

describe('ruleEndDate', () => {
  it('covers one day, one week, one month or no end', () => {
    expect(ruleEndDate('2026-10-02', 'DAY')).toBe('2026-10-02');
    expect(ruleEndDate('2026-10-02', 'WEEK')).toBe('2026-10-08');
    expect(ruleEndDate('2026-10-02', 'MONTH')).toBe('2026-11-01');
    expect(ruleEndDate('2026-10-02', 'INDEFINITE')).toBeNull();
  });

  it('crosses month and year ends', () => {
    expect(ruleEndDate('2026-12-28', 'WEEK')).toBe('2027-01-03');
    expect(ruleEndDate('2026-12-15', 'MONTH')).toBe('2027-01-14');
  });

  it('stops at the end of a shorter next month', () => {
    expect(ruleEndDate('2026-01-31', 'MONTH')).toBe('2026-02-28');
    expect(ruleEndDate('2028-01-31', 'MONTH')).toBe('2028-02-29');
    expect(ruleEndDate('2026-03-31', 'MONTH')).toBe('2026-04-30');
    expect(ruleEndDate('2026-01-01', 'MONTH')).toBe('2026-01-31');
  });

  it('refuses a malformed start', () => {
    expect(() => ruleEndDate('2026/10/02', 'DAY')).toThrow();
  });
});

describe('ruleCovers', () => {
  const rule = {
    mode: 'ACTUAL' as const,
    startDate: '2026-10-02',
    endDate: '2026-10-08',
  };

  it('includes both ends', () => {
    expect(ruleCovers(rule, '2026-10-01')).toBe(false);
    expect(ruleCovers(rule, '2026-10-02')).toBe(true);
    expect(ruleCovers(rule, '2026-10-08')).toBe(true);
    expect(ruleCovers(rule, '2026-10-09')).toBe(false);
  });

  it('runs on without an end', () => {
    expect(ruleCovers({ ...rule, endDate: null }, '2030-01-01')).toBe(true);
  });
});

describe('resolveWorkedTimeMode', () => {
  const at = (iso: string) => new Date(iso);
  const storeActual: WorkedTimeRuleLike = {
    mode: 'ACTUAL',
    startDate: '2026-10-01',
    endDate: null,
    createdAt: at('2026-10-01T00:00:00Z'),
  };
  const empShiftWeek: WorkedTimeRuleLike = {
    employeeProfileId: 'emp-a',
    mode: 'SHIFT',
    startDate: '2026-10-05',
    endDate: '2026-10-11',
    createdAt: at('2026-09-30T00:00:00Z'),
  };

  it('is "theo ca" without any rule', () => {
    expect(resolveWorkedTimeMode([], 'emp-a', '2026-10-02')).toBe('SHIFT');
  });

  it('follows the store rule for everyone it covers', () => {
    expect(resolveWorkedTimeMode([storeActual], 'emp-b', '2026-10-02')).toBe(
      'ACTUAL',
    );
    expect(resolveWorkedTimeMode([storeActual], 'emp-b', '2026-09-30')).toBe(
      'SHIFT',
    );
  });

  it('lets an employee rule beat the store rule, even when older', () => {
    const rules = [storeActual, empShiftWeek];
    expect(resolveWorkedTimeMode(rules, 'emp-a', '2026-10-06')).toBe('SHIFT');
    // Outside the employee's week the store rule applies again.
    expect(resolveWorkedTimeMode(rules, 'emp-a', '2026-10-12')).toBe('ACTUAL');
    expect(resolveWorkedTimeMode(rules, 'emp-b', '2026-10-06')).toBe('ACTUAL');
  });

  it('takes the newest of overlapping rules at the same level', () => {
    const newerShift: WorkedTimeRuleLike = {
      mode: 'SHIFT',
      startDate: '2026-10-02',
      endDate: '2026-10-02',
      createdAt: at('2026-10-02T03:00:00Z'),
    };
    expect(
      resolveWorkedTimeMode([storeActual, newerShift], 'emp-b', '2026-10-02'),
    ).toBe('SHIFT');
    expect(
      resolveWorkedTimeMode([storeActual, newerShift], 'emp-b', '2026-10-03'),
    ).toBe('ACTUAL');
  });
});
