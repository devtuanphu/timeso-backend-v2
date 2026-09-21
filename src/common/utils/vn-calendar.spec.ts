import {
  parseVnMonthInput,
  shiftVnMonth,
  toDateMarker,
  toMonthMarker,
  vnClockHHmm,
  vnDateString,
  vnMiddayInstant,
  vnMonthFromParts,
  vnMonthOf,
  vnMonthOfDateString,
} from './vn-calendar';

/**
 * Every expectation here must hold whatever the process timezone. The payroll
 * spec commands run this file under TZ=UTC, Asia/Ho_Chi_Minh and
 * America/Los_Angeles.
 */
describe('vn-calendar', () => {
  describe('vnDateString', () => {
    it('rolls to the next Vietnam day at 17:00 UTC', () => {
      expect(vnDateString(new Date('2026-08-31T17:30:00Z'))).toBe('2026-09-01');
      expect(vnDateString(new Date('2026-08-31T16:59:59.999Z'))).toBe(
        '2026-08-31',
      );
    });
  });

  describe('vnMonthOf', () => {
    it('returns the Vietnam month of an instant', () => {
      expect(vnMonthOf(new Date('2026-08-31T17:30:00Z'))).toEqual({
        year: 2026,
        month: 9,
        monthIndex: 8,
        key: '2026-09-01',
        label: '2026-09',
        endExclusiveDate: '2026-10-01',
        lastDate: '2026-09-30',
        calendarDays: 30,
      });
    });

    it('rolls over the year', () => {
      expect(vnMonthOf(new Date('2026-12-31T17:00:00Z')).key).toBe('2027-01-01');
      expect(vnMonthOf(new Date('2026-12-31T16:59:00Z')).key).toBe('2026-12-01');
    });
  });

  describe('vnMonthFromParts', () => {
    it('handles leap years and December', () => {
      expect(vnMonthFromParts(2028, 2)!.calendarDays).toBe(29);
      expect(vnMonthFromParts(2026, 2)!.calendarDays).toBe(28);
      const december = vnMonthFromParts(2026, 12)!;
      expect(december.endExclusiveDate).toBe('2027-01-01');
      expect(december.lastDate).toBe('2026-12-31');
    });

    it('rejects out-of-range months', () => {
      expect(vnMonthFromParts(2026, 0)).toBeNull();
      expect(vnMonthFromParts(2026, 13)).toBeNull();
      expect(vnMonthFromParts(Number.NaN, 1)).toBeNull();
    });
  });

  describe('shiftVnMonth', () => {
    it('moves across year boundaries', () => {
      const january = vnMonthFromParts(2027, 1)!;
      expect(shiftVnMonth(january, -1).key).toBe('2026-12-01');
      expect(shiftVnMonth(january, 12).key).toBe('2028-01-01');
      expect(shiftVnMonth(vnMonthFromParts(2026, 12)!, 1).key).toBe('2027-01-01');
    });
  });

  describe('parseVnMonthInput', () => {
    it.each(['09/2026', '9/2026', '2026-09', '2026-09-15', '2026-09-01'])(
      'reads %s as September 2026',
      (input) => {
        expect(parseVnMonthInput(input)!.key).toBe('2026-09-01');
      },
    );

    it('reads an ISO datetime as the Vietnam month of that instant', () => {
      expect(parseVnMonthInput('2026-08-31T18:00:00Z')!.key).toBe('2026-09-01');
      expect(parseVnMonthInput('2026-08-31T10:00:00Z')!.key).toBe('2026-08-01');
    });

    it('reads a Date as the Vietnam month of that instant', () => {
      expect(parseVnMonthInput(new Date('2026-08-31T18:00:00Z'))!.key).toBe(
        '2026-09-01',
      );
    });

    it.each(['13/2026', 'abc', '', '2026-13', '2026-09-40', '2026/09'])(
      'rejects %p',
      (input) => {
        expect(parseVnMonthInput(input)).toBeNull();
      },
    );

    it('returns null for missing input and invalid dates', () => {
      expect(parseVnMonthInput(null)).toBeNull();
      expect(parseVnMonthInput(undefined)).toBeNull();
      expect(parseVnMonthInput(new Date('nope'))).toBeNull();
    });
  });

  describe('vnMonthOfDateString', () => {
    it('reads the leading YYYY-MM-DD', () => {
      expect(vnMonthOfDateString('2026-08-31')!.key).toBe('2026-08-01');
      expect(vnMonthOfDateString('2026-08-31T23:00:00Z')!.key).toBe('2026-08-01');
      expect(vnMonthOfDateString('garbage')).toBeNull();
      expect(vnMonthOfDateString(null)).toBeNull();
    });
  });

  describe('markers', () => {
    it('builds a local-midnight month marker for date columns', () => {
      const marker = toMonthMarker(vnMonthFromParts(2026, 9)!);
      expect(marker.getFullYear()).toBe(2026);
      expect(marker.getMonth()).toBe(8);
      expect(marker.getDate()).toBe(1);
      expect(marker.getHours()).toBe(0);
    });

    it('builds a local-midnight day marker for date columns', () => {
      const marker = toDateMarker('2026-09-01');
      expect(marker.getFullYear()).toBe(2026);
      expect(marker.getMonth()).toBe(8);
      expect(marker.getDate()).toBe(1);
      expect(Number.isNaN(toDateMarker('bad').getTime())).toBe(true);
    });

    it('places vnMiddayInstant on the same Vietnam day', () => {
      expect(vnDateString(vnMiddayInstant('2026-09-01'))).toBe('2026-09-01');
      expect(vnMiddayInstant('2026-09-01').toISOString()).toBe(
        '2026-09-01T05:00:00.000Z',
      );
    });
  });

  describe('vnClockHHmm', () => {
    it('formats the Vietnam wall clock', () => {
      expect(vnClockHHmm(new Date('2026-09-01T01:02:00Z'))).toBe('08:02');
      expect(vnClockHHmm(new Date('2026-08-31T17:30:00Z'))).toBe('00:30');
    });
  });
});
