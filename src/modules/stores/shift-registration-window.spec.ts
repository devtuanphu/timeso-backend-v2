import {
  isSlotRegistrationClosed,
  slotEffectiveStart,
} from './shift-registration-window';

// 2026-09-22 08:00 in Vietnam.
const NOW = new Date('2026-09-22T01:00:00Z');

describe('shift registration window', () => {
  it('closes a slot on a past day', () => {
    expect(
      isSlotRegistrationClosed(
        { workDate: '2026-09-21', startTime: '23:00' },
        null,
        NOW,
      ),
    ).toBe(true);
  });

  it('keeps a slot on a future day open', () => {
    expect(
      isSlotRegistrationClosed(
        { workDate: '2026-09-23', startTime: '06:00' },
        null,
        NOW,
      ),
    ).toBe(false);
  });

  it('keeps today open until the start instant', () => {
    const slot = { workDate: '2026-09-22', startTime: '08:00' };
    expect(
      isSlotRegistrationClosed(slot, null, new Date('2026-09-22T00:59:00Z')),
    ).toBe(false);
    expect(isSlotRegistrationClosed(slot, null, NOW)).toBe(true);
    expect(
      isSlotRegistrationClosed(slot, null, new Date('2026-09-22T01:01:00Z')),
    ).toBe(true);
  });

  it('lets the slot override win over the template time', () => {
    const slot = { workDate: '2026-09-22', startTime: '09:00' };
    expect(isSlotRegistrationClosed(slot, { startTime: '07:00' }, NOW)).toBe(
      false,
    );
    expect(
      isSlotRegistrationClosed(
        { workDate: '2026-09-22', startTime: null },
        { startTime: '07:00' },
        NOW,
      ),
    ).toBe(true);
    expect(slotEffectiveStart(slot, { startTime: '07:00' })?.toISOString()).toBe(
      '2026-09-22T02:00:00.000Z',
    );
  });

  it('keeps a late-evening shift open before it starts', () => {
    expect(
      isSlotRegistrationClosed(
        { workDate: '2026-09-22', startTime: '22:00' },
        null,
        new Date('2026-09-22T14:00:00Z'), // 21:00 VN
      ),
    ).toBe(false);
  });

  it('uses the VN calendar day, not the UTC one', () => {
    // 2026-09-22 00:30 VN is still 2026-09-21 in UTC.
    const justAfterVnMidnight = new Date('2026-09-21T17:30:00Z');
    expect(
      isSlotRegistrationClosed(
        { workDate: '2026-09-21', startTime: null },
        null,
        justAfterVnMidnight,
      ),
    ).toBe(true);
  });

  it('falls back to the date when no time is known', () => {
    expect(
      isSlotRegistrationClosed({ workDate: '2026-09-22' }, null, NOW),
    ).toBe(false);
    expect(
      isSlotRegistrationClosed({ workDate: '2026-09-21' }, null, NOW),
    ).toBe(true);
  });

  it('accepts a driver-parsed Date work date', () => {
    expect(
      isSlotRegistrationClosed(
        { workDate: new Date(2026, 8, 21), startTime: '10:00' },
        null,
        NOW,
      ),
    ).toBe(true);
    expect(
      isSlotRegistrationClosed(
        { workDate: new Date(2026, 8, 23), startTime: '10:00' },
        null,
        NOW,
      ),
    ).toBe(false);
  });

  it('accepts HH:mm:ss times', () => {
    expect(
      isSlotRegistrationClosed(
        { workDate: '2026-09-22', startTime: '08:00:01' },
        null,
        NOW,
      ),
    ).toBe(false);
  });
});
