import { DataSource } from 'typeorm';

import { ChatAuthorizationService } from './chat-authorization.service';
import { ChatPushIntentDispatcherService } from './chat-push-intent-dispatcher.service';
import { ChatRealtimeConfig } from './chat-realtime.config';
import { ChatRealtimeReadinessService } from './chat-realtime-readiness.service';

describe('ChatPushIntentDispatcherService', () => {
  it('materializes eligible devices idempotently and completes the source intent', async () => {
    const event = {
      id: 'event-id',
      messageId: 'message-id',
      groupId: 'group-id',
      actorAccountId: 'sender-id',
      claimToken: 'claim-id',
      attemptCount: 1,
    };
    const manager = { query: jest.fn().mockResolvedValue([{ id: 'event-id' }]) };
    const dataSource = {
      query: jest.fn().mockResolvedValue([event]),
      transaction: jest.fn((callback) => callback(manager)),
    } as unknown as DataSource;
    const getEligiblePushDevices = jest.fn().mockResolvedValue([
        {
          userDeviceId: 'device-row',
          accountId: 'recipient-id',
          deviceId: 'installation-id',
          tokenFingerprint: 'a'.repeat(64),
          registrationVersion: '4',
        },
      ]);
    const authorization = {
      getEligiblePushDevices,
    } as unknown as ChatAuthorizationService;
    const service = new ChatPushIntentDispatcherService(
      dataSource,
      authorization,
      { isActive: () => true } as ChatRealtimeReadinessService,
      { pushDeliveryEnabled: true } as ChatRealtimeConfig,
    );
    service.start();

    await service.dispatchOnce();

    expect(getEligiblePushDevices).toHaveBeenCalledWith(
      'group-id',
      'sender-id',
      manager,
    );
    const insert = manager.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO chat_push_deliveries'));
    expect(insert?.[0]).toContain('ON CONFLICT DO NOTHING');
    expect(insert?.[1]).toEqual([
      'message-id',
      'group-id',
      'recipient-id',
      'device-row',
      'installation-id',
      'a'.repeat(64),
      '4',
    ]);
    expect(manager.query.mock.calls.some(([sql]) => sql.includes("push_intent_status = 'completed'"))).toBe(true);
  });
});
