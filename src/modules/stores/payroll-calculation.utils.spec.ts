import { PaymentType } from './entities/employee-contract.entity';
import {
  AttendanceStatus,
  ShiftAssignmentStatus,
} from './entities/shift-management.entity';
import {
  PayrollCalcType,
  PayrollRuleCategory,
} from './entities/store-payroll-rule.entity';
import { WeekDay } from './entities/store-shift-config.entity';
import {
  computeEarnedBase,
  computePayslip,
  computePayslipTotals,
  computeRuleAdjustments,
  MonthlyAttendanceFacts,
  PayrollAssignmentFact,
  pickDayOwnerAssignmentIds,
  resolvePayrollPaymentType,
  sumAllowances,
  summarizeMonthlyAttendance,
} from './payroll-calculation.utils';
import { countWorkingDaysInMonth } from './working-days.utils';

const facts = (over: Partial<MonthlyAttendanceFacts> = {}): MonthlyAttendanceFacts => ({
  totalAssignedShifts: 0,
  completedShifts: 0,
  workedMinutes: 0,
  workingHours: 0,
  daysWorked: 0,
  lateCount: 0,
  earlyCount: 0,
  absentCount: 0,
  totalLateMinutes: 0,
  totalEarlyMinutes: 0,
  ...over,
});

const completed = (
  id: string,
  workDate: string,
  over: Partial<PayrollAssignmentFact> = {},
): PayrollAssignmentFact => ({
  id,
  workDate,
  status: ShiftAssignmentStatus.COMPLETED,
  checkInTime: `${workDate}T01:00:00Z`,
  workedMinutes: 480,
  ...over,
});

const lateRule = {
  category: PayrollRuleCategory.FINE,
  ruleType: 'LATE',
  calcType: PayrollCalcType.PERCENTAGE,
  value: 1,
};

describe('computeEarnedBase', () => {
  const base = { standardWorkingDays: 26, calendarDays: 30 };

  describe('HOUR: rate × hours worked (no ÷176)', () => {
    it('pays the hours actually worked', () => {
      const summary = summarizeMonthlyAttendance(
        [
          completed('a', '2026-09-01', { workedMinutes: 450 }),
          completed('b', '2026-09-02', { workedMinutes: 480 }),
          completed('c', '2026-09-03', { workedMinutes: 300 }),
        ],
        '2026-09-30',
      );
      const earned = computeEarnedBase({
        ...base,
        paymentType: PaymentType.HOUR,
        rate: 25_000,
        facts: summary,
      });
      expect(earned).toBe(512_500);
      // The old fallback divided by 176 standard hours.
      expect(earned).not.toBe(Math.round((25_000 * 20.5) / 176));
    });

    it('rounds to whole VND once', () => {
      expect(
        computeEarnedBase({
          ...base,
          paymentType: PaymentType.HOUR,
          rate: 33_333,
          facts: facts({ workedMinutes: 70 }),
        }),
      ).toBe(38_889);
    });
  });

  describe('MONTH: salary ÷ standard working days × distinct days worked', () => {
    const sept = countWorkingDaysInMonth(2026, 8, [WeekDay.SUNDAY]);

    it('uses the store working days of the month', () => {
      expect(sept).toBe(26);
      const pay = (daysWorked: number) =>
        computeEarnedBase({
          paymentType: PaymentType.MONTH,
          rate: 10_000_000,
          facts: facts({ daysWorked }),
          standardWorkingDays: sept,
          calendarDays: 30,
        });
      expect(pay(13)).toBe(5_000_000);
      expect(pay(26)).toBe(10_000_000);
    });

    it('counts two shifts on one day as one day', () => {
      const summary = summarizeMonthlyAttendance(
        [
          completed('a', '2026-09-02'),
          completed('b', '2026-09-02'),
          completed('c', '2026-09-03'),
        ],
        '2026-09-30',
      );
      expect(summary.completedShifts).toBe(3);
      expect(summary.daysWorked).toBe(2);
      expect(
        computeEarnedBase({
          paymentType: PaymentType.MONTH,
          rate: 10_000_000,
          facts: summary,
          standardWorkingDays: sept,
          calendarDays: 30,
        }),
      ).toBe(769_231);
    });

    it('does not count shifts that were not completed', () => {
      const summary = summarizeMonthlyAttendance(
        [
          { id: 'p', workDate: '2026-09-04', status: ShiftAssignmentStatus.PENDING },
          { id: 'a', workDate: '2026-09-05', status: ShiftAssignmentStatus.APPROVED },
          { id: 'c', workDate: '2026-09-06', status: ShiftAssignmentStatus.CONFIRMED },
        ],
        '2026-09-01',
      );
      expect(summary.daysWorked).toBe(0);
      expect(summary.completedShifts).toBe(0);
    });

    it('falls back to calendar days without a days-off configuration', () => {
      expect(countWorkingDaysInMonth(2026, 8, null)).toBe(30);
      expect(
        computeEarnedBase({
          paymentType: PaymentType.MONTH,
          rate: 10_000_000,
          facts: facts({ daysWorked: 15 }),
          standardWorkingDays: 0,
          calendarDays: 30,
        }),
      ).toBe(5_000_000);
    });

    it('sizes February with a weekend off', () => {
      expect(countWorkingDaysInMonth(2026, 1, [WeekDay.SATURDAY_SUNDAY])).toBe(20);
    });
  });

  it('WEEK: rate × shifts ÷ 6', () => {
    expect(
      computeEarnedBase({
        ...base,
        paymentType: PaymentType.WEEK,
        rate: 1_200_000,
        facts: facts({ completedShifts: 5 }),
      }),
    ).toBe(1_000_000);
  });

  it('SHIFT and DAY: rate × completed shifts', () => {
    for (const paymentType of [PaymentType.SHIFT, PaymentType.DAY]) {
      expect(
        computeEarnedBase({
          ...base,
          paymentType,
          rate: 300_000,
          facts: facts({ completedShifts: 4 }),
        }),
      ).toBe(1_200_000);
    }
  });

  it('pays nothing for a zero or invalid rate', () => {
    expect(
      computeEarnedBase({
        ...base,
        paymentType: PaymentType.SHIFT,
        rate: Number.NaN,
        facts: facts({ completedShifts: 4 }),
      }),
    ).toBe(0);
  });
});

describe('resolvePayrollPaymentType', () => {
  it('treats a null or unknown payment type as MONTH', () => {
    expect(resolvePayrollPaymentType(null)).toBe(PaymentType.MONTH);
    expect(resolvePayrollPaymentType('???')).toBe(PaymentType.MONTH);
    expect(resolvePayrollPaymentType(PaymentType.HOUR)).toBe(PaymentType.HOUR);
  });

  it('computes a null-type payslip as MONTH', () => {
    const slip = computePayslip({
      paymentType: null,
      rate: 2_600_000,
      allowances: null,
      rules: [],
      facts: facts({ daysWorked: 1, completedShifts: 1 }),
      standardWorkingDays: 26,
      calendarDays: 30,
      advancePayment: 0,
    });
    expect(slip.paymentType).toBe(PaymentType.MONTH);
    expect(slip.earnedBaseSalary).toBe(100_000);
  });
});

describe('summarizeMonthlyAttendance', () => {
  it('counts a past approved shift without check-in as absent, by Vietnam date', () => {
    const summary = summarizeMonthlyAttendance(
      [
        {
          id: 'x',
          workDate: '2026-08-31',
          status: ShiftAssignmentStatus.APPROVED,
          checkInTime: null,
        },
        {
          id: 'today',
          workDate: '2026-09-01',
          status: ShiftAssignmentStatus.APPROVED,
          checkInTime: null,
        },
        {
          id: 'marked',
          workDate: '2026-09-01',
          status: ShiftAssignmentStatus.APPROVED,
          attendanceStatus: AttendanceStatus.ABSENT,
        },
      ],
      '2026-09-01',
    );
    expect(summary.absentCount).toBe(2);
  });

  it('never counts a shift covered by approved leave as absent', () => {
    const summary = summarizeMonthlyAttendance(
      [
        {
          id: 'leave-past',
          workDate: '2026-08-20',
          status: ShiftAssignmentStatus.APPROVED,
          checkInTime: null,
          leaveCovered: true,
        },
        {
          id: 'leave-marked',
          workDate: '2026-08-21',
          status: ShiftAssignmentStatus.APPROVED,
          attendanceStatus: AttendanceStatus.ABSENT,
          leaveCovered: true,
        },
        {
          id: 'no-leave',
          workDate: '2026-08-22',
          status: ShiftAssignmentStatus.APPROVED,
          checkInTime: null,
          leaveCovered: false,
        },
      ],
      '2026-09-01',
    );
    expect(summary.absentCount).toBe(1);
    expect(summary.totalAssignedShifts).toBe(3);
  });

  it('counts late and early shifts and sums completed minutes', () => {
    const summary = summarizeMonthlyAttendance(
      [
        completed('a', '2026-09-01', { lateMinutes: 5, workedMinutes: 475 }),
        completed('b', '2026-09-02', { earlyMinutes: 10, workedMinutes: 470 }),
      ],
      '2026-09-30',
    );
    expect(summary.lateCount).toBe(1);
    expect(summary.earlyCount).toBe(1);
    expect(summary.totalLateMinutes).toBe(5);
    expect(summary.workedMinutes).toBe(945);
    expect(summary.workingHours).toBe(15.75);
  });
});

describe('computeRuleAdjustments', () => {
  it('applies a percentage late fine per late shift', () => {
    expect(
      computeRuleAdjustments([lateRule], facts({ lateCount: 2 }), 5_000_000),
    ).toEqual({ bonus: 0, penalty: 100_000 });
  });

  it('applies the absent fine only for AMOUNT rules', () => {
    const seeded = {
      category: PayrollRuleCategory.FINE,
      ruleType: 'ABSENT',
      calcType: PayrollCalcType.SHIFT,
      value: 1,
    };
    expect(
      computeRuleAdjustments([seeded], facts({ absentCount: 3 }), 5_000_000).penalty,
    ).toBe(0);
    expect(
      computeRuleAdjustments(
        [{ ...seeded, calcType: PayrollCalcType.AMOUNT, value: 200_000 }],
        facts({ absentCount: 3 }),
        5_000_000,
      ).penalty,
    ).toBe(600_000);
  });

  it('grants the attendance bonus only without lateness or absence', () => {
    const bonusRule = {
      category: PayrollRuleCategory.BONUS,
      ruleType: 'ATTENDANCE',
      calcType: PayrollCalcType.AMOUNT,
      value: 300_000,
    };
    const worked = { completedShifts: 3 };
    expect(computeRuleAdjustments([bonusRule], facts(worked), 0).bonus).toBe(300_000);
    expect(
      computeRuleAdjustments([bonusRule], facts({ ...worked, lateCount: 1 }), 0).bonus,
    ).toBe(0);
    expect(
      computeRuleAdjustments(
        [{ ...bonusRule, ruleType: 'GENERAL', value: 100_000 }],
        facts({ ...worked, lateCount: 1 }),
        0,
      ).bonus,
    ).toBe(100_000);
  });

  it('pays no attendance or general bonus for a month with no completed shift', () => {
    const rules = [
      {
        category: PayrollRuleCategory.BONUS,
        ruleType: 'ATTENDANCE',
        calcType: PayrollCalcType.AMOUNT,
        value: 200_000,
      },
      {
        category: PayrollRuleCategory.BONUS,
        ruleType: 'GENERAL',
        calcType: PayrollCalcType.AMOUNT,
        value: 100_000,
      },
      {
        category: PayrollRuleCategory.BONUS,
        ruleType: null as any,
        calcType: PayrollCalcType.AMOUNT,
        value: 50_000,
      },
    ];
    expect(computeRuleAdjustments(rules, facts(), 0)).toEqual({
      bonus: 0,
      penalty: 0,
    });
    const { computeRuleAdjustmentBreakdown: breakdown } = jest.requireActual(
      './payroll-calculation.utils',
    );
    expect(breakdown(rules, facts(), 0)).toEqual([]);
    // One completed shift is enough.
    expect(
      computeRuleAdjustments(rules, facts({ completedShifts: 1 }), 0).bonus,
    ).toBe(350_000);
    // A fine is still charged without a completed shift (e.g. absences).
    expect(
      computeRuleAdjustments(
        [
          {
            category: PayrollRuleCategory.FINE,
            ruleType: 'ABSENT',
            calcType: PayrollCalcType.AMOUNT,
            value: 100_000,
          },
        ],
        facts({ absentCount: 2 }),
        0,
      ).penalty,
    ).toBe(200_000);
  });
});

describe('totals', () => {
  it('sums allowances to whole VND', () => {
    expect(sumAllowances({ an: 500_000.4, xang: '300000', bad: 'x' })).toBe(800_000);
    expect(sumAllowances(null)).toBe(0);
  });

  it('builds an integer payslip end to end', () => {
    const slip = computePayslip({
      paymentType: PaymentType.MONTH,
      rate: 10_000_000,
      allowances: { ăn: 500_000 },
      rules: [lateRule],
      facts: facts({ daysWorked: 13, completedShifts: 13, lateCount: 2 }),
      standardWorkingDays: 26,
      calendarDays: 30,
      advancePayment: 1_000_000,
    });
    expect(slip).toEqual(
      expect.objectContaining({
        earnedBaseSalary: 5_000_000,
        allowancesTotal: 500_000,
        penalty: 100_000,
        advancePayment: 1_000_000,
        totalIncome: 5_500_000,
        totalDeductions: 1_100_000,
        netSalary: 4_400_000,
        workingDays: 13,
      }),
    );
    for (const key of [
      'earnedBaseSalary',
      'allowancesTotal',
      'bonus',
      'penalty',
      'advancePayment',
      'totalIncome',
      'totalDeductions',
      'netSalary',
    ] as const) {
      expect(Number.isInteger(slip[key])).toBe(true);
    }
  });

  it('always includes allowances and floors net at zero', () => {
    expect(
      computePayslipTotals({
        earnedBase: 0,
        allowancesTotal: 500_000,
        bonus: 0,
        penalty: 0,
        advancePayment: 0,
      }),
    ).toEqual({ totalIncome: 500_000, totalDeductions: 0, netSalary: 500_000 });
    expect(
      computePayslipTotals({
        earnedBase: 0,
        allowancesTotal: 500_000,
        bonus: 0,
        penalty: 200_000,
        advancePayment: 1_000_000,
      }),
    ).toEqual({ totalIncome: 500_000, totalDeductions: 1_200_000, netSalary: 0 });
  });
});

describe('pickDayOwnerAssignmentIds', () => {
  it('picks the earliest completed check-in per day, ties by id, order independent', () => {
    const rows: PayrollAssignmentFact[] = [
      completed('b', '2026-09-02', { checkInTime: '2026-09-02T05:00:00Z' }),
      completed('a', '2026-09-02', { checkInTime: '2026-09-02T01:00:00Z' }),
      completed('z', '2026-09-03', { checkInTime: '2026-09-03T01:00:00Z' }),
      completed('y', '2026-09-03', { checkInTime: '2026-09-03T01:00:00Z' }),
      {
        id: '0',
        workDate: '2026-09-02',
        status: ShiftAssignmentStatus.APPROVED,
        checkInTime: '2026-09-02T00:00:00Z',
      },
    ];
    const expected = new Set(['a', 'y']);
    expect(pickDayOwnerAssignmentIds(rows)).toEqual(expected);
    expect(pickDayOwnerAssignmentIds([...rows].reverse())).toEqual(expected);
  });
});

describe('computeRuleAdjustmentBreakdown', () => {
  const { computeRuleAdjustmentBreakdown, computeRuleAdjustments } =
    jest.requireActual('./payroll-calculation.utils');
  const { PayrollRuleCategory, PayrollCalcType } = jest.requireActual(
    './entities/store-payroll-rule.entity',
  );

  const rules = [
    { category: PayrollRuleCategory.FINE, ruleType: 'LATE', calcType: PayrollCalcType.AMOUNT, value: 50_000 },
    { category: PayrollRuleCategory.FINE, ruleType: 'EARLY', calcType: PayrollCalcType.PERCENTAGE, value: 0.333 },
    { category: PayrollRuleCategory.FINE, ruleType: 'ABSENT', calcType: PayrollCalcType.AMOUNT, value: 100_000 },
    { category: PayrollRuleCategory.BONUS, ruleType: 'ATTENDANCE', calcType: PayrollCalcType.AMOUNT, value: 300_000 },
    { category: PayrollRuleCategory.BONUS, ruleType: null, calcType: PayrollCalcType.AMOUNT, value: 200_000, name: 'Thưởng lễ' },
  ];

  it('lines sum exactly to the bonus and penalty totals', () => {
    const facts = { lateCount: 3, earlyCount: 2, absentCount: 1, completedShifts: 5 };
    const earned = 7_123_457;
    const lines = computeRuleAdjustmentBreakdown(rules, facts, earned);
    const totals = computeRuleAdjustments(rules, facts, earned);
    const sum = (kind: string) =>
      lines
        .filter((line: any) => line.kind === kind)
        .reduce((total: number, line: any) => total + line.amount, 0);
    expect(sum('FINE')).toBe(totals.penalty);
    expect(sum('BONUS')).toBe(totals.bonus);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'FINE', ruleType: 'LATE', label: 'Đi trễ', count: 3, amount: 150_000 }),
        expect.objectContaining({ kind: 'FINE', ruleType: 'ABSENT', count: 1, amount: 100_000 }),
        expect.objectContaining({ kind: 'BONUS', ruleType: 'GENERAL', label: 'Thưởng lễ', amount: 200_000 }),
      ]),
    );
    // Attendance bonus not earned with a late arrival.
    expect(lines.find((line: any) => line.ruleType === 'ATTENDANCE')).toBeUndefined();
  });

  it('no rule hit gives no line', () => {
    expect(
      computeRuleAdjustmentBreakdown(
        rules.filter((rule) => rule.category === PayrollRuleCategory.FINE),
        { lateCount: 0, earlyCount: 0, absentCount: 0, completedShifts: 5 },
        1_000_000,
      ),
    ).toEqual([]);
  });
});
