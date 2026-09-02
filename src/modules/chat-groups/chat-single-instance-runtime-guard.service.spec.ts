import { DataSource, QueryRunner } from 'typeorm';

import type { ChatRealtimeConfig } from './chat-realtime.config';
import { ChatSingleInstanceRuntimeGuardService } from './chat-single-instance-runtime-guard.service';

const requiredConfig: ChatRealtimeConfig = {
  legacyConnectionEnabled: false,
  legacyMutationEnabled: false,
  legacyWindowStartedAt: null,
  legacyCutoffAt: null,
  singletonGuardMode: 'required',
};

describe('ChatSingleInstanceRuntimeGuardService', () => {
  it('rejects startup when another runtime owns the singleton lock', async () => {
    const release = jest.fn().mockResolvedValue(undefined);
    const runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([{ acquired: false }]),
      release,
    } as unknown as QueryRunner;
    const service = new ChatSingleInstanceRuntimeGuardService(
      { createQueryRunner: () => runner } as unknown as DataSource,
      requiredConfig,
    );

    await expect(service.acquireBeforeListen()).rejects.toThrow(
      'CHAT_SINGLETON_ALREADY_ACTIVE',
    );
    expect(service.isHeld()).toBe(false);
    expect(release).toHaveBeenCalled();
  });

  it('fails closed and invokes shutdown coordination after lock loss', async () => {
    jest.useFakeTimers();
    const runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([{ acquired: true }])
        .mockResolvedValueOnce([{ held: false }]),
      release: jest.fn().mockResolvedValue(undefined),
    } as unknown as QueryRunner;
    const service = new ChatSingleInstanceRuntimeGuardService(
      { createQueryRunner: () => runner } as unknown as DataSource,
      requiredConfig,
    );
    const onLockLost = jest.fn().mockResolvedValue(undefined);

    await service.acquireBeforeListen();
    service.startHealthMonitor(onLockLost);
    await jest.advanceTimersByTimeAsync(5_000);

    expect(service.isHeld()).toBe(false);
    expect(onLockLost).toHaveBeenCalledTimes(1);
    await service.release();
    jest.useRealTimers();
  });
});
