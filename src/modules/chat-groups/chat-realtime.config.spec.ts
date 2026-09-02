import { ConfigService } from '@nestjs/config';

import { createChatRealtimeConfig } from './chat-realtime.config';

const config = (values: Record<string, unknown>) =>
  ({ get: jest.fn((key: string) => values[key]) }) as unknown as ConfigService;

describe('chat realtime configuration', () => {
  it('defaults to v2-only with a required singleton guard', () => {
    expect(createChatRealtimeConfig(config({}))).toMatchObject({
      legacyConnectionEnabled: false,
      legacyMutationEnabled: false,
      singletonGuardMode: 'required',
    });
  });

  it('accepts a bounded active legacy compatibility window', () => {
    const result = createChatRealtimeConfig(
      config({
        CHAT_LEGACY_SOCKET_CONNECTION_ENABLED: 'true',
        CHAT_LEGACY_SOCKET_MUTATION_ENABLED: 'true',
        CHAT_LEGACY_SOCKET_WINDOW_STARTED_AT: '2026-08-20T00:00:00.000Z',
        CHAT_LEGACY_SOCKET_CUTOFF_AT: '2026-08-30T00:00:00.000Z',
      }),
      new Date('2026-08-25T00:00:00.000Z'),
    );
    expect(result.legacyConnectionEnabled).toBe(true);
    expect(result.legacyMutationEnabled).toBe(true);
  });

  it('fails closed at the cutoff and rejects an overlong window', () => {
    const values = {
      CHAT_LEGACY_SOCKET_CONNECTION_ENABLED: 'true',
      CHAT_LEGACY_SOCKET_MUTATION_ENABLED: 'true',
      CHAT_LEGACY_SOCKET_WINDOW_STARTED_AT: '2026-08-20T00:00:00.000Z',
      CHAT_LEGACY_SOCKET_CUTOFF_AT: '2026-08-30T00:00:00.000Z',
    };
    expect(
      createChatRealtimeConfig(
        config(values),
        new Date('2026-08-30T00:00:00.000Z'),
      ),
    ).toMatchObject({
      legacyConnectionEnabled: false,
      legacyMutationEnabled: false,
    });
    expect(() =>
      createChatRealtimeConfig(
        config({
          ...values,
          CHAT_LEGACY_SOCKET_CUTOFF_AT: '2026-09-10T00:00:00.000Z',
        }),
      ),
    ).toThrow(/at most 14 days/);
  });

  it('requires timezone-qualified RFC3339 legacy timestamps', () => {
    expect(() =>
      createChatRealtimeConfig(
        config({
          CHAT_LEGACY_SOCKET_CONNECTION_ENABLED: 'true',
          CHAT_LEGACY_SOCKET_WINDOW_STARTED_AT: '2026-08-20T00:00:00',
          CHAT_LEGACY_SOCKET_CUTOFF_AT: '2026-08-21T00:00:00Z',
        }),
      ),
    ).toThrow(/RFC3339/);
  });

  it('allows disabling the singleton only for an isolated local database', () => {
    expect(() =>
      createChatRealtimeConfig(
        config({ CHAT_SINGLETON_GUARD_MODE: 'disabled' }),
      ),
    ).toThrow(/isolated test\/local/);
    expect(
      createChatRealtimeConfig(
        config({
          CHAT_SINGLETON_GUARD_MODE: 'disabled',
          NODE_ENV: 'test',
          TIMESO_ISOLATED_DB: 'true',
          DATABASE_NAME: 'timeso_test',
        }),
      ).singletonGuardMode,
    ).toBe('disabled');
  });
});
