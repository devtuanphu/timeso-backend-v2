import { parseVietnamShiftStart } from './shift-reminder.utils';

describe('shift reminder Vietnam time parsing', () => {
  const originalTimeZone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'UTC';
  });

  afterAll(() => {
    process.env.TZ = originalTimeZone;
  });

  it('maps 09:00 Vietnam wall time to 02:00Z regardless of host TZ', () => {
    expect(parseVietnamShiftStart('2030-01-01', '09:00:00').toISOString()).toBe(
      '2030-01-01T02:00:00.000Z',
    );
  });

  it('keeps the next local date explicit for a cross-midnight occurrence', () => {
    const start = parseVietnamShiftStart('2030-01-01', '23:00');
    const end = parseVietnamShiftStart('2030-01-02', '01:00');

    expect(start.toISOString()).toBe('2030-01-01T16:00:00.000Z');
    expect(end.toISOString()).toBe('2030-01-01T18:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(2 * 60 * 60 * 1000);
  });
});
