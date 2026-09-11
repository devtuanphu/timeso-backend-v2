import { ExpoPushService } from './expo-push.service';

describe('ExpoPushService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('accepts only a provider ok ticket with an id', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { status: 'ok', id: 'ticket-id' } }),
    }) as jest.Mock;
    const service = new ExpoPushService();
    await expect(
      service.sendDeviceNotification({
        to: 'ExpoPushToken[redacted]',
        title: 'Tin nhắn mới',
        body: 'Bạn có tin nhắn mới trong Timeso',
      }),
    ).resolves.toEqual({ outcome: 'accepted', ticketId: 'ticket-id' });
  });

  it('classifies an invalid device without logging token or payload', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          status: 'error',
          details: { error: 'DeviceNotRegistered' },
        },
      }),
    }) as jest.Mock;
    const service = new ExpoPushService();
    await expect(
      service.sendDeviceNotification({
        to: 'ExpoPushToken[redacted]',
        title: 'Tin nhắn mới',
        body: 'Bạn có tin nhắn mới trong Timeso',
      }),
    ).resolves.toEqual({
      outcome: 'permanent',
      errorCode: 'DeviceNotRegistered',
      deviceInvalid: true,
    });
  });

  it('does not treat a missing receipt as a reason to resend', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    }) as jest.Mock;
    const service = new ExpoPushService();
    await expect(service.getPushReceipts(['ticket-id'])).resolves.toEqual({
      'ticket-id': { outcome: 'pending' },
    });
  });

  it.each([
    [429, 'EXPO_HTTP_429'],
    [503, 'EXPO_HTTP_503'],
  ])(
    'retries a provider HTTP %s without exposing provider content',
    async (status, code) => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status }) as jest.Mock;
      const service = new ExpoPushService();
      await expect(
        service.sendDeviceNotification({
          to: 'ExpoPushToken[redacted]',
          title: 'Tin nhắn mới',
          body: 'Bạn có tin nhắn mới trong Timeso',
        }),
      ).resolves.toEqual({ outcome: 'retryable', errorCode: code });
    },
  );

  it('retries MessageRateExceeded tickets', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { status: 'error', details: { error: 'MessageRateExceeded' } },
      }),
    }) as jest.Mock;
    const service = new ExpoPushService();
    await expect(
      service.sendDeviceNotification({
        to: 'ExpoPushToken[redacted]',
        title: 'Tin nhắn mới',
        body: 'Bạn có tin nhắn mới trong Timeso',
      }),
    ).resolves.toEqual({
      outcome: 'retryable',
      errorCode: 'MessageRateExceeded',
    });
  });

  it('keeps the timeout active while reading the response body', async () => {
    global.fetch = jest.fn(async (_url, init) => ({
      ok: true,
      json: () =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    })) as jest.Mock;
    const service = new ExpoPushService();
    (service as any).timeoutMs = 5;
    await expect(
      service.sendDeviceNotification({
        to: 'ExpoPushToken[redacted]',
        title: 'Tin nhắn mới',
        body: 'Bạn có tin nhắn mới trong Timeso',
      }),
    ).resolves.toEqual({
      outcome: 'retryable',
      errorCode: 'EXPO_REQUEST_FAILED',
    });
  });
});
