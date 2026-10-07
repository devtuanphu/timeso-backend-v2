import {
  buildCriteriaProgressText,
  effectiveCriteriaUnit,
  formatVnNumber,
} from '../../../../src/modules/stores/career-progress-text';
import {
  CriteriaCode,
  CriteriaKind,
  CriteriaOperator,
} from '../../../../src/modules/stores/entities/store-rung-criteria.entity';

const item = (over: Partial<Parameters<typeof buildCriteriaProgressText>[0]> = {}) => ({
  kind: CriteriaKind.METRIC,
  code: CriteriaCode.COMPLETED_SHIFTS,
  operator: CriteriaOperator.GTE,
  current: 1,
  target: 30,
  unit: 'ca',
  met: false,
  ...over,
});

describe('formatVnNumber', () => {
  it('uses "." for thousands and "," for decimals', () => {
    expect(formatVnNumber(1234567, 0)).toBe('1.234.567');
    expect(formatVnNumber(1234.56, 1)).toBe('1.234,6');
    expect(formatVnNumber(12, 1)).toBe('12');
    expect(formatVnNumber(0, 0)).toBe('0');
  });
});

describe('buildCriteriaProgressText', () => {
  it('counts down a shift count: 1/30 → còn 29 ca', () => {
    expect(buildCriteriaProgressText(item())).toBe('Đã đạt 1/30 ca · còn 29 ca');
  });

  it('shows only the ratio once a gte threshold is met', () => {
    expect(buildCriteriaProgressText(item({ current: 30, met: true }))).toBe(
      'Đã đạt 30/30 ca',
    );
    expect(buildCriteriaProgressText(item({ current: 42, met: true }))).toBe(
      'Đã đạt 42/30 ca',
    );
  });

  it('starts from zero before the first shift', () => {
    expect(buildCriteriaProgressText(item({ current: 0 }))).toBe(
      'Đã đạt 0/30 ca · còn 30 ca',
    );
  });

  it('lte met: current and the maximum', () => {
    expect(
      buildCriteriaProgressText(
        item({
          code: CriteriaCode.UNAUTHORIZED_LEAVES,
          operator: CriteriaOperator.LTE,
          current: 1,
          target: 2,
          unit: 'ngày',
          met: true,
        }),
      ),
    ).toBe('Hiện 1 ngày · tối đa 2 ngày');
  });

  it('lte not met: how far over the maximum', () => {
    expect(
      buildCriteriaProgressText(
        item({
          code: CriteriaCode.UNAUTHORIZED_LEAVES,
          operator: CriteriaOperator.LTE,
          current: 5,
          target: 2,
          unit: 'ngày',
          met: false,
        }),
      ),
    ).toBe('Hiện 5 ngày · vượt 3 ngày (tối đa 2 ngày)');
  });

  it('rounds hours to one decimal, vi-VN style', () => {
    expect(
      buildCriteriaProgressText(
        item({
          code: CriteriaCode.WORK_HOURS,
          current: 12.345,
          target: 40,
          unit: 'giờ',
        }),
      ),
    ).toBe('Đã đạt 12,3/40 giờ · còn 27,7 giờ');
  });

  it('never says "còn 0" while a threshold is still unmet', () => {
    expect(
      buildCriteriaProgressText(
        item({
          code: CriteriaCode.WORK_HOURS,
          current: 39.96,
          target: 40,
          unit: 'giờ',
        }),
      ),
    ).toBe('Đã đạt 39,9/40 giờ · còn 0,1 giờ');
  });

  it('groups thousands of hours', () => {
    expect(
      buildCriteriaProgressText(
        item({
          code: CriteriaCode.WORK_HOURS,
          current: 1000,
          target: 1500,
          unit: 'giờ',
        }),
      ),
    ).toBe('Đã đạt 1.000/1.500 giờ · còn 500 giờ');
  });

  it('writes percentages without a space', () => {
    expect(
      buildCriteriaProgressText(
        item({
          code: CriteriaCode.ON_TIME_PERCENT,
          current: 80,
          target: 90,
          unit: '%',
        }),
      ),
    ).toBe('Đã đạt 80/90% · còn 10%');
  });

  it('tenure is always in days', () => {
    expect(
      buildCriteriaProgressText(
        item({
          kind: CriteriaKind.TENURE,
          code: CriteriaCode.DAYS_IN_RUNG,
          current: 12,
          target: 30,
          unit: null,
        }),
      ),
    ).toBe('Đã đạt 12/30 ngày · còn 18 ngày');
  });

  it('falls back to the default unit of the code when none is configured', () => {
    expect(buildCriteriaProgressText(item({ unit: null }))).toBe(
      'Đã đạt 1/30 ca · còn 29 ca',
    );
    expect(effectiveCriteriaUnit(CriteriaKind.METRIC, 'unknown', null)).toBeNull();
  });

  it('is null for checklist and cross-ladder criteria', () => {
    expect(
      buildCriteriaProgressText(
        item({ kind: CriteriaKind.CHECKLIST, code: null, current: 0, target: null }),
      ),
    ).toBeNull();
    expect(
      buildCriteriaProgressText(
        item({ kind: CriteriaKind.LADDER, code: 'ladder-2', current: 1, target: 2 }),
      ),
    ).toBeNull();
  });

  it('is null when there is nothing numeric to compare', () => {
    expect(buildCriteriaProgressText(item({ current: null }))).toBeNull();
    expect(buildCriteriaProgressText(item({ target: null }))).toBeNull();
  });
});
