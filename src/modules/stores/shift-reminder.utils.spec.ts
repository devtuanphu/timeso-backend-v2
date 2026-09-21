import {
  computeShiftReminderTriggerMs,
  getShiftReminderPreferenceFingerprint,
  parseVietnamShiftStart,
  resolveReminderMode,
} from './shift-reminder.utils';

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

describe('fixed reminder time ("Nhắc cố định", B9)', () => {
  const originalTimeZone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'UTC';
  });
  afterAll(() => {
    process.env.TZ = originalTimeZone;
  });

  // 09:00 Vietnam on 2030-01-02.
  const shiftStart = parseVietnamShiftStart('2030-01-02', '09:00');

  it('fires at 07:00 the same day for a 09:00 shift', () => {
    const trigger = computeShiftReminderTriggerMs(shiftStart, {
      type: 'custom',
      customMode: 'fixed',
      fixedTimeLocal: '07:00',
    });
    expect(new Date(trigger!).toISOString()).toBe('2030-01-02T00:00:00.000Z');
  });

  it('fires the day before when the time is not before the shift', () => {
    for (const hhmm of ['10:00', '09:00']) {
      const trigger = computeShiftReminderTriggerMs(shiftStart, {
        type: 'custom',
        customMode: 'fixed',
        fixedTimeLocal: hhmm,
      });
      expect(new Date(trigger!).toISOString()).toBe(
        parseVietnamShiftStart('2030-01-01', hhmm).toISOString(),
      );
    }
  });

  it('reads an ISO fixedTime (released staff builds) in Vietnam time', () => {
    // 2024-02-01 12:00 on a +07 phone.
    const settings = { type: 'custom', fixedTime: '2024-02-01T05:00:00.000Z' };
    expect(resolveReminderMode(settings)).toEqual({ kind: 'fixed', hhmm: '12:00' });
    expect(new Date(computeShiftReminderTriggerMs(
      parseVietnamShiftStart('2030-01-02', '18:00'),
      settings,
    )!).toISOString()).toBe('2030-01-02T05:00:00.000Z');
  });

  it('prefers fixedTimeLocal over fixedTime', () => {
    expect(
      resolveReminderMode({
        type: 'custom',
        customMode: 'fixed',
        fixedTimeLocal: '06:30',
        fixedTime: '2024-02-01T05:00:00.000Z',
      }),
    ).toEqual({ kind: 'fixed', hhmm: '06:30' });
  });

  it('lets a custom offset win when both are present without customMode', () => {
    const settings = {
      type: 'custom',
      custom: { days: 0, hours: 2, minutes: 0 },
      fixedTime: '2024-02-01T05:00:00.000Z',
    };
    expect(resolveReminderMode(settings)).toEqual({ kind: 'offset', minutes: 120 });
    expect(computeShiftReminderTriggerMs(shiftStart, settings)).toBe(
      shiftStart.getTime() - 2 * 3_600_000,
    );
  });

  it('keeps offset fingerprints unchanged and marks fixed ones', () => {
    expect(getShiftReminderPreferenceFingerprint({ type: 'off' })).toBe('off|0');
    expect(getShiftReminderPreferenceFingerprint({ type: '15m' })).toBe('15m|15');
    expect(getShiftReminderPreferenceFingerprint({ type: '1h' })).toBe('1h|60');
    expect(
      getShiftReminderPreferenceFingerprint({
        type: 'custom',
        custom: { days: 1, hours: 2, minutes: 3 },
      }),
    ).toBe('custom|1563');
    expect(
      getShiftReminderPreferenceFingerprint({
        type: 'custom',
        customMode: 'fixed',
        fixedTimeLocal: '07:00',
      }),
    ).toBe('custom|fixed@07:00');
  });

  it('returns no trigger when reminders are off', () => {
    expect(computeShiftReminderTriggerMs(shiftStart, { type: 'off' })).toBeNull();
    expect(computeShiftReminderTriggerMs(shiftStart, null)).toBeNull();
  });
});
