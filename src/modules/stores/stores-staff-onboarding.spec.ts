import { normalizeStoreSearchText } from './stores.service';

describe('staff store discovery normalization', () => {
  it.each([
    ['Cà phê Đặng Văn', 'ca phe dang van'],
    ['  TIMESO---Quận_1 ', 'timeso quan 1'],
    ['ĐƯỜNG Nguyễn Huệ', 'duong nguyen hue'],
  ])('normalizes %s into %s', (input, expected) => {
    expect(normalizeStoreSearchText(input)).toBe(expected);
  });

  it('keeps wildcard characters from acting as query wildcards', () => {
    expect(normalizeStoreSearchText('100% _Timeso')).toBe('100 timeso');
  });

  it('supports all-token related matches across name and address text', () => {
    const haystack = normalizeStoreSearchText(
      'Timeso Coffee 125 Đường Nguyễn Huệ Phường Bến Nghé Hồ Chí Minh',
    );
    const tokens = normalizeStoreSearchText('cà phê nguyen hue').split(' ');

    // "cà phê" is not a synonym for Coffee; discovery is intentionally token
    // contains rather than an unbounded semantic search.
    expect(tokens.every((token) => haystack.includes(token))).toBe(false);
    expect(
      normalizeStoreSearchText('Timeso nguyễn huệ')
        .split(' ')
        .every((token) => haystack.includes(token)),
    ).toBe(true);
  });
});
