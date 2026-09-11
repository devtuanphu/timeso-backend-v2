import { DataSource } from 'typeorm';

import { DevicesService } from '../devices/devices.service';
import { ExpoPushService } from '../push/expo-push.service';
import { ChatAuthorizationService } from './chat-authorization.service';
import { ChatMessageQueryService } from './chat-message-query.service';
import { ChatPushDispatcherService } from './chat-push-dispatcher.service';
import { ChatRealtimeConfig } from './chat-realtime.config';
import { ChatRealtimeReadinessService } from './chat-realtime-readiness.service';

const delivery = {
  id: '11111111-1111-4111-8111-111111111111',
  messageId: '22222222-2222-4222-8222-222222222222',
  groupId: '33333333-3333-4333-8333-333333333333',
  intendedAccountId: '44444444-4444-4444-8444-444444444444',
  userDeviceId: '55555555-5555-4555-8555-555555555555',
  expectedDeviceId: 'installation-id',
  expectedTokenFingerprint: 'a'.repeat(64),
  expectedRegistrationVersion: '3',
  senderAccountId: '66666666-6666-4666-8666-666666666666',
  sequence: '19',
  claimToken: '77777777-7777-4777-8777-777777777777',
  attemptCount: 1,
};

const createHarness = (claimCurrent = true) => {
  const runnerQuery = jest.fn(async (query: string) => {
    if (query.includes('pg_try_advisory_lock')) return [{ acquired: true }];
    if (query.includes('pg_advisory_unlock')) return [{ unlocked: true }];
    if (query.includes('RETURNING id')) {
      return claimCurrent ? [[{ id: delivery.id }], 1] : [[], 0];
    }
    return [];
  });
  const runner = {
    connect: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    manager: {},
    query: runnerQuery,
  };
  const dataSourceQuery = jest.fn().mockResolvedValue([]);
  const dataSource = {
    createQueryRunner: jest.fn(() => runner),
    query: dataSourceQuery,
  } as unknown as DataSource;
  const authorization = {
    requirePushDeliveryEligibility: jest.fn().mockResolvedValue({
      eligible: true,
      expoPushToken: 'ExpoPushToken[private]',
    }),
  } as unknown as ChatAuthorizationService;
  const sendDeviceNotification = jest.fn().mockResolvedValue({
    outcome: 'accepted',
    ticketId: 'ticket-id',
  });
  const expoPush = { sendDeviceNotification } as unknown as ExpoPushService;
  const service = new ChatPushDispatcherService(
    dataSource,
    authorization,
    {
      getTotalUnreadCount: jest.fn().mockResolvedValue({ totalUnread: 4 }),
    } as unknown as ChatMessageQueryService,
    expoPush,
    { disableInvalidDevice: jest.fn() } as unknown as DevicesService,
    { isActive: () => true } as ChatRealtimeReadinessService,
    { pushDeliveryEnabled: true } as ChatRealtimeConfig,
  );
  service.start();
  return {
    service,
    dataSourceQuery,
    runnerQuery,
    authorization,
    sendDeviceNotification,
  };
};

describe('ChatPushDispatcherService', () => {
  it('retains at most the five-entry claim batch and blocks subsequent claims during recovery', async () => {
    const { service, runnerQuery, dataSourceQuery, sendDeviceNotification } =
      createHarness();
    const original = runnerQuery.getMockImplementation()!;
    runnerQuery.mockImplementation(async (sql) => {
      if (sql.includes("status = 'ticket_accepted'"))
        throw new Error('database unavailable');
      return original(sql);
    });
    dataSourceQuery.mockResolvedValueOnce(
      Array.from({ length: 5 }, (_, index) => ({
        ...delivery,
        id: `delivery-${index}`,
      })),
    );
    await service.dispatchOnce();
    for (let cycle = 0; cycle < 3; cycle += 1) await service.dispatchOnce();
    expect(dataSourceQuery.mock.calls[0][0]).toContain('LIMIT 5');
    expect(service.getRecoveryStatus().pending).toBe(5);
    expect(dataSourceQuery).toHaveBeenCalledTimes(1);
    expect(sendDeviceNotification).toHaveBeenCalledTimes(5);
  });

  it('retains accepted tickets through repeated persistence failures and flushes before new claims', async () => {
    const { service, runnerQuery, dataSourceQuery, sendDeviceNotification } =
      createHarness();
    const original = runnerQuery.getMockImplementation()!;
    let fail = true;
    runnerQuery.mockImplementation(async (sql) => {
      if (sql.includes("status = 'ticket_accepted'") && fail)
        throw new Error('database unavailable');
      return original(sql);
    });
    dataSourceQuery.mockResolvedValueOnce([delivery]);
    await service.dispatchOnce();
    await service.dispatchOnce();
    expect(service.getRecoveryStatus()).toEqual({
      pending: 1,
      reconciliationRequired: false,
    });
    expect(sendDeviceNotification).toHaveBeenCalledTimes(1);
    expect(dataSourceQuery).toHaveBeenCalledTimes(1);
    expect(
      runnerQuery.mock.calls.some(([sql]) =>
        sql.includes("status = 'pending'"),
      ),
    ).toBe(false);
    fail = false;
    await service.dispatchOnce();
    expect(service.getRecoveryStatus().pending).toBe(0);
    expect(sendDeviceNotification).toHaveBeenCalledTimes(1);
    expect(dataSourceQuery).toHaveBeenCalledTimes(2);
  });

  it.each(['missing', 'different-ticket', 'different-claim'])(
    'fails closed when accepted ticket persistence loses ownership: %s',
    async (scenario) => {
      const { service, runnerQuery, dataSourceQuery, sendDeviceNotification } =
        createHarness();
      const original = runnerQuery.getMockImplementation()!;
      runnerQuery.mockImplementation(async (sql) => {
        if (sql.includes("status = 'ticket_accepted'")) return [[], 0];
        if (sql.startsWith('SELECT status'))
          return (
            scenario === 'missing'
              ? []
              : [
                  {
                    status: 'processing',
                    claim_token: 'another-claim',
                    expo_ticket_id:
                      scenario === 'different-ticket' ? 'another-ticket' : null,
                  },
                ]
          ) as never;
        return original(sql);
      });
      await (service as any).dispatch(delivery);
      await service.dispatchOnce();
      expect(service.getRecoveryStatus()).toEqual({
        pending: 1,
        reconciliationRequired: true,
      });
      expect(sendDeviceNotification).toHaveBeenCalledTimes(1);
      expect(dataSourceQuery).not.toHaveBeenCalled();
    },
  );

  it('revalidates the binding and sends only generic typed chat data with authoritative badge', async () => {
    const { service, runnerQuery, sendDeviceNotification } = createHarness();
    await (service as any).dispatch(delivery);
    expect(sendDeviceNotification).toHaveBeenCalledWith({
      to: 'ExpoPushToken[private]',
      title: 'Tin nhắn mới',
      body: 'Bạn có tin nhắn mới trong Timeso',
      sound: 'default',
      badge: 4,
      priority: 'high',
      channelId: 'default',
      data: {
        type: 'CHAT_MESSAGE',
        version: 1,
        groupId: delivery.groupId,
        messageId: delivery.messageId,
        sequence: '19',
        deliveryId: delivery.id,
      },
    });
    expect(JSON.stringify(sendDeviceNotification.mock.calls)).not.toContain(
      'content',
    );
    expect(runnerQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'ticket_accepted'"),
      expect.arrayContaining([delivery.id, delivery.claimToken, 'ticket-id']),
    );
  });

  it('makes no external request when a stale claimant cannot renew its exact lease', async () => {
    const { service, sendDeviceNotification } = createHarness(false);
    await (service as any).dispatch(delivery);
    expect(sendDeviceNotification).not.toHaveBeenCalled();
  });
});
