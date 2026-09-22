import {
  describeWorkDate,
  describeWorkDateRange,
  isWorkDateRangeOnly,
  formatShiftMoment,
  notificationWorkDates,
  relativeDayLabel,
  rerenderRelativeDays,
  workDatesMetadata,
} from './relative-day';

// 23:30 ngày 18/09 giờ VN = 16:30Z — UTC vẫn là 18/09, nhưng 00:30 ngày 19 VN là 17:30Z ngày 18.
const at = (iso: string) => new Date(iso);

describe('relativeDayLabel', () => {
  const now = at('2026-09-18T03:00:00Z'); // 10:00 ngày 18/09 giờ VN

  it.each([
    ['2026-09-18', 'hôm nay'],
    ['2026-09-19', 'ngày mai'],
    ['2026-09-20', 'ngày kia'],
    ['2026-09-21', null],
    ['2026-09-17', null],
  ])('%s → %p', (date, expected) => {
    expect(relativeDayLabel(date, now)).toBe(expected);
  });

  it('tính theo ngày Việt Nam, không theo UTC', () => {
    // 00:30 ngày 19/09 giờ VN (UTC còn là 18/09).
    expect(relativeDayLabel('2026-09-19', at('2026-09-18T17:30:00Z'))).toBe(
      'hôm nay',
    );
  });

  it('nhận cả Date (thời điểm)', () => {
    expect(relativeDayLabel(at('2026-09-19T01:00:00Z'), now)).toBe('ngày mai');
  });
});

describe('describeWorkDate', () => {
  const now = at('2026-09-18T03:00:00Z');
  it('gần thì kèm nhãn tương đối', () => {
    expect(describeWorkDate('2026-09-18', now)).toBe('hôm nay (18/09)');
    expect(describeWorkDate('2026-09-20', now)).toBe('ngày kia (20/09)');
  });
  it('xa thì giữ ngày', () => {
    expect(describeWorkDate('2026-09-25', now)).toBe('ngày 25/09');
  });
});

describe('formatShiftMoment', () => {
  const now = at('2026-09-20T03:00:00Z'); // 10:00 ngày 20/09 VN
  it.each([
    ['2026-09-20', '08:00 hôm nay (20/09)'],
    ['2026-09-21', '08:00 ngày mai (21/09)'],
    ['2026-09-22', '08:00 ngày kia (22/09)'],
    ['2026-09-23', '08:00 ngày 23/09'],
  ])('%s → %s', (date, expected) => {
    expect(formatShiftMoment(date, '08:00:00', now)).toBe(expected);
  });
});

describe('describeWorkDateRange', () => {
  const now = at('2026-09-21T03:00:00Z');
  it('một ngày thì như describeWorkDate', () => {
    expect(describeWorkDateRange(['2026-09-22'], now)).toBe(
      'ngày mai (22/09)',
    );
  });
  it('khoảng có hôm nay thì ghi rõ', () => {
    expect(
      describeWorkDateRange(['2026-09-25', '2026-09-20', '2026-09-21'], now),
    ).toBe('từ 20/09 đến 25/09 (có hôm nay)');
  });
  it('khoảng không có hôm nay', () => {
    expect(describeWorkDateRange(['2026-09-24', '2026-09-26'], now)).toBe(
      'từ 24/09 đến 26/09',
    );
  });
  it('khoảng bắt đầu ngày mai / ngày kia thì ghi nhãn ngày đầu', () => {
    expect(describeWorkDateRange(['2026-09-22', '2026-09-25'], now)).toBe(
      'từ ngày mai (22/09) đến 25/09',
    );
    expect(describeWorkDateRange(['2026-09-23', '2026-09-25'], now)).toBe(
      'từ ngày kia (23/09) đến 25/09',
    );
  });
  it('khoảng bắt đầu ngày mai được đọc lại đúng theo ngày đọc', () => {
    const stored = `Bạn có ca ${describeWorkDateRange(['2026-09-22', '2026-09-25'], now)}.`;
    expect(stored).toBe('Bạn có ca từ ngày mai (22/09) đến 25/09.');
    const dates = ['2026-09-22', '2026-09-25'];
    // Đọc hôm sau: ngày đầu là hôm nay.
    expect(rerenderRelativeDays(stored, dates, at('2026-09-22T03:00:00Z'))).toBe(
      'Bạn có ca từ 22/09 đến 25/09 (có hôm nay).',
    );
    // Đọc hôm trước nữa: ngày đầu là ngày kia.
    expect(rerenderRelativeDays(stored, dates, at('2026-09-20T03:00:00Z'))).toBe(
      'Bạn có ca từ ngày kia (22/09) đến 25/09.',
    );
    // Đọc sau khi hết khoảng: chỉ còn ngày tuyệt đối.
    expect(rerenderRelativeDays(stored, dates, at('2026-09-27T03:00:00Z'))).toBe(
      'Bạn có ca từ 22/09 đến 25/09.',
    );
    // Dạng cũ đã lưu cũng được gắn nhãn khi đọc.
    expect(
      rerenderRelativeDays('Bạn có ca từ 22/09 đến 25/09.', dates, at('2026-09-21T03:00:00Z')),
    ).toBe('Bạn có ca từ ngày mai (22/09) đến 25/09.');
  });
});

describe('rerenderRelativeDays', () => {
  const stored = 'Ca làm của bạn sẽ bắt đầu lúc 08:00 ngày mai (21/09).';
  it('lưu ngày 20/09 "ngày mai (21/09)", đọc ngày 21/09 thành "hôm nay (21/09)"', () => {
    expect(
      rerenderRelativeDays(stored, ['2026-09-21'], at('2026-09-21T01:00:00Z')),
    ).toBe('Ca làm của bạn sẽ bắt đầu lúc 08:00 hôm nay (21/09).');
  });
  it('đọc ngày 24/09 thì chỉ còn ngày tuyệt đối', () => {
    expect(
      rerenderRelativeDays(stored, ['2026-09-21'], at('2026-09-24T01:00:00Z')),
    ).toBe('Ca làm của bạn sẽ bắt đầu lúc 08:00 ngày 21/09.');
  });
  it('"ngày dd/mm" cũng được đổi khi tới gần', () => {
    expect(
      rerenderRelativeDays(
        'Ca ngày 21/09 đã mở',
        ['2026-09-21'],
        at('2026-09-20T01:00:00Z'),
      ),
    ).toBe('Ca ngày mai (21/09) đã mở');
  });
  it('ranh giới 23:30 / 00:30 giờ VN', () => {
    const text = 'Ca 08:00 ngày mai (19/09)';
    // 23:30 ngày 18/09 VN
    expect(
      rerenderRelativeDays(text, ['2026-09-19'], at('2026-09-18T16:30:00Z')),
    ).toBe('Ca 08:00 ngày mai (19/09)');
    // 00:30 ngày 19/09 VN
    expect(
      rerenderRelativeDays(text, ['2026-09-19'], at('2026-09-18T17:30:00Z')),
    ).toBe('Ca 08:00 hôm nay (19/09)');
  });
  it('tính lại hậu tố "(có hôm nay)" của khoảng ngày', () => {
    const dates = ['2026-09-20', '2026-09-21', '2026-09-22'];
    expect(
      rerenderRelativeDays(
        'Đăng ký ca thành công từ 20/09 đến 22/09',
        dates,
        at('2026-09-21T01:00:00Z'),
      ),
    ).toBe('Đăng ký ca thành công từ 20/09 đến 22/09 (có hôm nay)');
    expect(
      rerenderRelativeDays(
        'Đăng ký ca thành công từ 20/09 đến 22/09 (có hôm nay)',
        dates,
        at('2026-09-25T01:00:00Z'),
      ),
    ).toBe('Đăng ký ca thành công từ 20/09 đến 22/09');
  });
  it('không có ngày thì giữ nguyên; không đụng ngày khác', () => {
    expect(rerenderRelativeDays('ngày mai (21/09)', [], at('2026-09-21T01:00:00Z'))).toBe(
      'ngày mai (21/09)',
    );
    expect(
      rerenderRelativeDays('ngày 22/09', ['2026-09-21'], at('2026-09-21T01:00:00Z')),
    ).toBe('ngày 22/09');
  });
});

describe('notification work-date metadata', () => {
  it('đọc workDates, workDateRange và workDate', () => {
    expect(
      notificationWorkDates({
        workDates: ['2026-09-22', '2026-09-21'],
        workDate: '2026-09-21',
      }),
    ).toEqual(['2026-09-21', '2026-09-22']);
    expect(
      notificationWorkDates({ workDateRange: { from: '2026-09-01', to: '2026-10-15' } }),
    ).toEqual(['2026-09-01', '2026-10-15']);
    expect(notificationWorkDates(null)).toEqual([]);
  });
  it('nhiều hơn 31 ngày thì ghi khoảng {from,to}', () => {
    const dates = Array.from({ length: 40 }, (_, i) =>
      new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10),
    );
    expect(workDatesMetadata(dates)).toEqual({
      workDateRange: { from: '2026-09-01', to: '2026-10-10' },
    });
    expect(workDatesMetadata(['2026-09-02', '2026-09-01'])).toEqual({
      workDates: ['2026-09-01', '2026-09-02'],
    });
    expect(workDatesMetadata([])).toEqual({});
  });
});

describe('workDateRange {from,to} là khoảng liên tục', () => {
  const content = 'Đăng ký ca thành công từ 01/09 đến 10/10';
  const rangeOnly = { workDateRange: { from: '2026-09-01', to: '2026-10-10' } };

  it('nhận biết metadata chỉ có workDateRange', () => {
    expect(isWorkDateRangeOnly(rangeOnly)).toBe(true);
    expect(
      isWorkDateRangeOnly({ ...rangeOnly, workDates: ['2026-09-01'] }),
    ).toBe(false);
    expect(isWorkDateRangeOnly({ workDates: ['2026-09-01'] })).toBe(false);
    expect(isWorkDateRangeOnly(null)).toBe(false);
  });

  it('hôm nay ở giữa khoảng thì có "(có hôm nay)"', () => {
    const now = at('2026-09-21T03:00:00Z');
    expect(
      rerenderRelativeDays(content, notificationWorkDates(rangeOnly), now, {
        continuousRange: true,
      }),
    ).toBe(`${content} (có hôm nay)`);
    // Không phải khoảng liên tục: chỉ hai đầu mút nên không có hôm nay.
    expect(
      rerenderRelativeDays(content, notificationWorkDates(rangeOnly), now),
    ).toBe(content);
  });

  it('ngoài khoảng thì bỏ hậu tố; hai đầu mút vẫn tính', () => {
    const dates = notificationWorkDates(rangeOnly);
    const opts = { continuousRange: true };
    expect(
      rerenderRelativeDays(`${content} (có hôm nay)`, dates, at('2026-10-11T03:00:00Z'), opts),
    ).toBe(content);
    expect(
      rerenderRelativeDays(content, dates, at('2026-10-10T03:00:00Z'), opts),
    ).toBe(`${content} (có hôm nay)`);
    // Khoảng bắt đầu ngày mai: nhãn cho ngày đầu, không có hậu tố.
    expect(
      rerenderRelativeDays(content, dates, at('2026-08-31T03:00:00Z'), opts),
    ).toBe(content.replace('từ 01/09', 'từ ngày mai (01/09)'));
    expect(
      rerenderRelativeDays(content, dates, at('2026-08-20T03:00:00Z'), opts),
    ).toBe(content);
    // Ranh giới giờ VN: 00:30 ngày 01/09 VN = 17:30 UTC ngày 31/08.
    expect(
      rerenderRelativeDays(content, dates, at('2026-08-31T17:30:00Z'), opts),
    ).toBe(`${content} (có hôm nay)`);
  });
});
