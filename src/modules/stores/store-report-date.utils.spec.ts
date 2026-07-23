import { BadRequestException } from '@nestjs/common';

import {
  resolveStoreRevenueDateRange,
  validateStoreReportDate,
} from './store-report-date.utils';

describe('store report date utilities', () => {
  it('converts inclusive HCM dates to half-open UTC bounds', () => {
    const range = resolveStoreRevenueDateRange('2026-07-22', '2026-07-22');

    expect(range.startUtc.toISOString()).toBe('2026-07-21T17:00:00.000Z');
    expect(range.endExclusiveUtc.toISOString()).toBe(
      '2026-07-22T17:00:00.000Z',
    );
  });

  it('keeps cross-month ranges exact', () => {
    const range = resolveStoreRevenueDateRange('2026-01-31', '2026-02-01');

    expect(range.startUtc.toISOString()).toBe('2026-01-30T17:00:00.000Z');
    expect(range.endExclusiveUtc.toISOString()).toBe(
      '2026-02-01T17:00:00.000Z',
    );
  });

  it('derives defaults from the HCM calendar date', () => {
    const range = resolveStoreRevenueDateRange(
      undefined,
      undefined,
      new Date('2026-07-22T18:30:00.000Z'),
    );

    expect(range.endDate).toBe('2026-07-23');
    expect(range.startDate).toBe('2026-06-23');
  });

  it.each(['2026-02-30', '22-07-2026', '2026-7-2', ''])(
    'rejects invalid date %p',
    (date) => {
      expect(() => validateStoreReportDate(date)).toThrow(BadRequestException);
    },
  );

  it('rejects a reversed range', () => {
    expect(() =>
      resolveStoreRevenueDateRange('2026-07-23', '2026-07-22'),
    ).toThrow(BadRequestException);
  });
});
