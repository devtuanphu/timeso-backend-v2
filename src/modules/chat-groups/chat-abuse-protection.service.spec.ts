import {
  CHAT_HTTP_LIMITS,
  CHAT_HTTP_IP_ACCOUNT_CAPACITY,
  CHAT_SOCKET_MAX_PER_ACCOUNT,
  ChatAbuseProtectionService,
} from './chat-abuse-protection.service';

describe('ChatAbuseProtectionService', () => {
  it('enforces deterministic per-account HTTP windows', () => {
    const service = new ChatAbuseProtectionService();
    for (let index = 0; index < CHAT_HTTP_LIMITS.send.max; index += 1) {
      service.assertHttp('send', 'account-a', '127.0.0.1', 1_000);
    }
    expect(() =>
      service.assertHttp('send', 'account-a', '127.0.0.1', 1_000),
    ).toThrow(/Thao tác trò chuyện quá nhanh/);
    expect(() =>
      service.assertHttp('send', 'account-a', '127.0.0.1', 61_000),
    ).not.toThrow();
  });

  it('bounds sockets and releases capacity on disconnect', () => {
    const service = new ChatAbuseProtectionService();
    for (let index = 0; index < CHAT_SOCKET_MAX_PER_ACCOUNT; index += 1) {
      service.acquireSocket(`socket-${index}`, 'account-a', `ip-${index}`);
    }
    expect(() =>
      service.acquireSocket('overflow', 'account-a', 'other-ip'),
    ).toThrow('CHAT_SOCKET_LIMITED');
    service.releaseSocket('socket-0');
    expect(() =>
      service.acquireSocket('replacement', 'account-a', 'other-ip'),
    ).not.toThrow();
  });

  it('does not let one shared store IP consume an individual account budget', () => {
    const service = new ChatAbuseProtectionService();
    for (let index = 0; index < 201; index += 1) {
      expect(() =>
        service.assertHttp('send', `account-${index}`, '10.0.0.1', 1_000),
      ).not.toThrow();
    }
    expect(CHAT_HTTP_IP_ACCOUNT_CAPACITY).toBeGreaterThanOrEqual(200);
  });
});
