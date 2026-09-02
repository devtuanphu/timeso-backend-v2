import {
  canonicalizeChatContent,
  escapeIlikePattern,
  parseChatSequence,
  validateChatGroupName,
  validateChatContent,
} from './chat-message.utils';

describe('chat message utilities', () => {
  it('canonicalizes line endings, unicode and surrounding whitespace', () => {
    expect(canonicalizeChatContent('  e\u0301\r\nhello\r  ')).toBe('é\nhello');
  });

  it('counts unicode code points when enforcing the message limit', () => {
    expect(validateChatContent('😀'.repeat(4_000))).toHaveLength(8_000);
    expect(() => validateChatContent('😀'.repeat(4_001))).toThrow(
      /1 đến 4000/,
    );
  });

  it('rejects blank messages and out-of-range bigint cursors', () => {
    expect(() => validateChatContent(' \r\n ')).toThrow(/1 đến 4000/);
    expect(() => parseChatSequence('0', 'beforeSequence', false)).toThrow();
    expect(() =>
      parseChatSequence('9223372036854775808', 'sequence', true),
    ).toThrow();
  });

  it('escapes SQL wildcard characters for literal ILIKE search', () => {
    expect(escapeIlikePattern('50%_off\\today')).toBe(
      '50\\%\\_off\\\\today',
    );
  });

  it('validates normalized group names by Unicode code point', () => {
    expect(validateChatGroupName('  Ca\u0301c điều hành  ')).toBe(
      'Các điều hành',
    );
    expect(validateChatGroupName('😀'.repeat(120))).toHaveLength(240);
    expect(() => validateChatGroupName('   ')).toThrow();
    expect(() => validateChatGroupName('😀'.repeat(121))).toThrow();
  });
});
