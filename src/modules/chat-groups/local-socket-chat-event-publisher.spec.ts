import type { Server } from 'socket.io';

import { ChatRealtimeReadinessService } from './chat-realtime-readiness.service';
import type { ChatRealtimeConfig } from './chat-realtime.config';
import { LocalSocketChatEventPublisher } from './local-socket-chat-event-publisher';

const server = () => {
  const emit = jest.fn();
  return {
    value: { to: jest.fn(() => ({ emit })) } as unknown as Server,
    emit,
  };
};

describe('LocalSocketChatEventPublisher legacy cutoff', () => {
  afterEach(() => jest.useRealTimers());

  it('never emits to legacy after cutoff and readiness stops requiring it', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-30T00:00:00.000Z'));
    const config: ChatRealtimeConfig = {
      legacyConnectionEnabled: true,
      legacyMutationEnabled: true,
      legacyWindowStartedAt: new Date('2026-08-20T00:00:00.000Z'),
      legacyCutoffAt: new Date('2026-08-30T00:00:00.000Z'),
      singletonGuardMode: 'required',
    };
    const readiness = new ChatRealtimeReadinessService(config);
    const v2 = server();
    const legacy = server();
    readiness.attach('v2', v2.value);
    readiness.attach('legacy', legacy.value);
    readiness.setActive(true);
    expect(readiness.legacyConnectionsAllowed()).toBe(false);
    expect(readiness.namespacesReady()).toBe(true);

    const publisher = new LocalSocketChatEventPublisher(readiness);
    await publisher.publishReadUpdated(
      {
        version: 1,
        groupId: 'group-id',
        accountId: 'account-id',
        lastReadSequence: '7',
        updatedAt: '2026-08-30T00:00:00.000Z',
      },
      ['recipient-id'],
    );
    expect(v2.emit).toHaveBeenCalledWith(
      'chat.read.updated.v1',
      expect.any(Object),
    );
    expect(legacy.emit).not.toHaveBeenCalled();
  });
});
