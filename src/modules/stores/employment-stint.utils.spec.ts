import {
  currentStintContracts,
  STINT_CLOCK_TOLERANCE_MS,
  stintFloor,
  stintStartVnDate,
} from './employment-stint.utils';

describe('employment stint helpers', () => {
  it('returns null (no filter) when joinedAt is missing', () => {
    expect(stintFloor(null)).toBeNull();
    expect(stintFloor(undefined)).toBeNull();
    expect(stintStartVnDate(null)).toBeNull();
    expect(stintStartVnDate(undefined)).toBeNull();
  });

  it('places the floor exactly 60 seconds before joinedAt', () => {
    const joinedAt = new Date('2026-09-10T03:00:00.000Z');
    const floor = stintFloor(joinedAt) as Date;
    expect(STINT_CLOCK_TOLERANCE_MS).toBe(60_000);
    expect(joinedAt.getTime() - floor.getTime()).toBe(60_000);
    expect(floor.toISOString()).toBe('2026-09-10T02:59:00.000Z');
  });

  it('returns null for an invalid date', () => {
    expect(stintFloor(new Date('nope'))).toBeNull();
    expect(stintStartVnDate(new Date('nope'))).toBeNull();
  });

  it('uses the Vietnam calendar date across the UTC/VN midnight boundary', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      // 17:30 UTC on the 9th is 00:30 on the 10th in Vietnam.
      expect(stintStartVnDate(new Date('2026-09-09T17:30:00.000Z'))).toBe(
        '2026-09-10',
      );
      // 16:59 UTC is still 23:59 on the 9th in Vietnam.
      expect(stintStartVnDate(new Date('2026-09-09T16:59:00.000Z'))).toBe(
        '2026-09-09',
      );
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe('currentStintContracts', () => {
  const floor = new Date('2026-09-10T02:59:00.000Z');
  const c = (id: string, isActive: boolean, createdAt: string) => ({
    id,
    isActive,
    createdAt: new Date(createdAt),
  });

  it('drops inactive contracts from before the stint and puts the active one first', () => {
    const result = currentStintContracts(
      [
        c('old', false, '2026-01-01T00:00:00Z'),
        c('later', false, '2026-09-20T00:00:00Z'),
        c('active', true, '2026-09-10T02:59:30Z'),
      ],
      floor,
    );
    expect(result.map((x) => x.id)).toEqual(['active', 'later']);
  });

  it('always keeps an active contract, even an old one', () => {
    const result = currentStintContracts(
      [c('legacy-active', true, '2025-01-01T00:00:00Z')],
      floor,
    );
    expect(result.map((x) => x.id)).toEqual(['legacy-active']);
  });

  it('only sorts when there is no floor', () => {
    const result = currentStintContracts(
      [
        c('a', false, '2025-01-01T00:00:00Z'),
        c('b', false, '2026-01-01T00:00:00Z'),
        c('c', true, '2024-01-01T00:00:00Z'),
      ],
      null,
    );
    expect(result.map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });

  it('handles a missing list', () => {
    expect(currentStintContracts(undefined, floor)).toEqual([]);
  });
});
