import { PaymentType } from './entities/employee-contract.entity';
import {
  calculateShiftEarnings,
  WORKING_DAYS_PER_WEEK,
} from './shift-earnings.utils';

const MAY_5 = new Date('2026-05-05T00:00:00+07:00'); // 31-day month
const FEB_5 = new Date('2026-02-05T00:00:00+07:00'); // 28-day month

describe('calculateShiftEarnings', () => {
  it('pays an hourly contract for hours worked', () => {
    expect(
      calculateShiftEarnings({
        paymentType: PaymentType.HOUR,
        baseSalary: 50_000,
        hours: 8,
        referenceDate: MAY_5,
      }),
    ).toBe(400_000);
  });

  it('pays a flat amount per shift and per day', () => {
    for (const type of [PaymentType.SHIFT, PaymentType.DAY]) {
      expect(
        calculateShiftEarnings({
          paymentType: type,
          baseSalary: 300_000,
          hours: 8,
          referenceDate: MAY_5,
        }),
      ).toBe(300_000);
    }
  });

  // Regression: the estimate shown to staff divided by 7 while the payroll
  // path persisted a division by 6 — a ~16.7% gap between quoted and paid.
  // Both now go through this function, so the divisor is defined once.
  it('divides a weekly salary by the working-day count, not calendar days', () => {
    expect(WORKING_DAYS_PER_WEEK).toBe(6);
    expect(
      calculateShiftEarnings({
        paymentType: PaymentType.WEEK,
        baseSalary: 3_000_000,
        hours: 8,
        referenceDate: MAY_5,
      }),
    ).toBe(500_000);
  });

  it('prorates a monthly salary across the calendar month', () => {
    expect(
      calculateShiftEarnings({
        paymentType: PaymentType.MONTH,
        baseSalary: 31_000_000,
        hours: 8,
        referenceDate: MAY_5,
      }),
    ).toBe(1_000_000);
    // Documents the known behaviour: the same work pays differently in a
    // shorter month. Changing this is a business-rule decision.
    expect(
      calculateShiftEarnings({
        paymentType: PaymentType.MONTH,
        baseSalary: 28_000_000,
        hours: 8,
        referenceDate: FEB_5,
      }),
    ).toBe(1_000_000);
  });

  it('rounds to whole đồng', () => {
    expect(
      calculateShiftEarnings({
        paymentType: PaymentType.WEEK,
        baseSalary: 1_000_000,
        hours: 8,
        referenceDate: MAY_5,
      }),
    ).toBe(166_667);
  });

  // The payroll call site leaves the stored figure untouched on null; the
  // estimate call site shows 0. Flattening this to 0 here would have made
  // payroll overwrite a real amount with zero for an unrecognised type.
  it('returns null when no rule covers the payment type', () => {
    expect(
      calculateShiftEarnings({
        paymentType: undefined,
        baseSalary: 1_000_000,
        hours: 8,
        referenceDate: MAY_5,
      }),
    ).toBeNull();
    expect(
      calculateShiftEarnings({
        paymentType: 'BOGUS' as PaymentType,
        baseSalary: 1_000_000,
        hours: 8,
        referenceDate: MAY_5,
      }),
    ).toBeNull();
  });

  it('treats a missing or non-positive salary as zero', () => {
    for (const salary of [0, -1, Number.NaN]) {
      expect(
        calculateShiftEarnings({
          paymentType: PaymentType.HOUR,
          baseSalary: salary,
          hours: 8,
          referenceDate: MAY_5,
        }),
      ).toBe(0);
    }
  });

  it('treats non-positive hours as zero on an hourly contract only', () => {
    expect(
      calculateShiftEarnings({
        paymentType: PaymentType.HOUR,
        baseSalary: 50_000,
        hours: 0,
        referenceDate: MAY_5,
      }),
    ).toBe(0);
    // A per-shift contract pays regardless of the recorded hours.
    expect(
      calculateShiftEarnings({
        paymentType: PaymentType.SHIFT,
        baseSalary: 300_000,
        hours: 0,
        referenceDate: MAY_5,
      }),
    ).toBe(300_000);
  });
});
