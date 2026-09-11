import { DataSource } from 'typeorm';

import { DevicesService } from '../devices/devices.service';
import { ExpoPushService } from '../push/expo-push.service';
import { ChatPushReceiptDispatcherService } from './chat-push-receipt-dispatcher.service';
import { ChatRealtimeConfig } from './chat-realtime.config';
import { ChatRealtimeReadinessService } from './chat-realtime-readiness.service';

const receipt = {
  id: '11111111-1111-4111-8111-111111111111',
  expoTicketId: 'ticket-id',
  intendedAccountId: '22222222-2222-4222-8222-222222222222',
  userDeviceId: '33333333-3333-4333-8333-333333333333',
  expectedDeviceId: 'installation-id',
  expectedTokenFingerprint: 'a'.repeat(64),
  expectedRegistrationVersion: '2',
  claimToken: '44444444-4444-4444-8444-444444444444',
  receiptAttemptCount: 1,
};

const createHarness = (terminalAffected = true) => {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('WITH candidates AS')) return [[receipt], 1];
    if (sql.includes('RETURNING id')) {
      return terminalAffected ? [[{ id: receipt.id }], 1] : [[], 0];
    }
    return [];
  });
  const getPushReceipts = jest.fn().mockResolvedValue({
    'ticket-id': {
      outcome: 'permanent',
      errorCode: 'DeviceNotRegistered',
      deviceInvalid: true,
    },
  });
  const disableInvalidDevice = jest.fn().mockResolvedValue(true);
  const service = new ChatPushReceiptDispatcherService(
    { query } as unknown as DataSource,
    { getPushReceipts } as unknown as ExpoPushService,
    { disableInvalidDevice } as unknown as DevicesService,
    { isActive: () => true } as ChatRealtimeReadinessService,
    { pushDeliveryEnabled: true } as ChatRealtimeConfig,
  );
  service.start();
  return { service, query, getPushReceipts, disableInvalidDevice };
};

describe('ChatPushReceiptDispatcherService', () => {
  it('normalizes PostgreSQL UPDATE tuples and fences invalid-device deactivation', async () => {
    const { service, getPushReceipts, disableInvalidDevice } = createHarness();
    await service.dispatchOnce();
    expect(getPushReceipts).toHaveBeenCalledWith(['ticket-id']);
    expect(disableInvalidDevice).toHaveBeenCalledWith({
      id: receipt.userDeviceId,
      userId: receipt.intendedAccountId,
      deviceId: receipt.expectedDeviceId,
      pushTokenFingerprint: receipt.expectedTokenFingerprint,
      registrationVersion: receipt.expectedRegistrationVersion,
    });
  });

  it('does not deactivate a rebound device when the receipt claim lost its fence', async () => {
    const { service, disableInvalidDevice } = createHarness(false);
    await service.dispatchOnce();
    expect(disableInvalidDevice).not.toHaveBeenCalled();
  });
});
