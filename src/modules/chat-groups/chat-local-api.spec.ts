import { ExecutionContext, HttpException } from '@nestjs/common';
import type { Socket } from 'socket.io';
import { listenWithChatRuntime } from '../../app-listen';
import { ChatRuntimeHttpGuard } from './chat-runtime-http.guard';
import { ChatSingleInstanceRuntimeGuardService } from './chat-single-instance-runtime-guard.service';
import { ChatRealtimeCoordinatorService } from './chat-realtime-coordinator.service';
import { ChatGateway } from './chat.gateway';
import { ChatV2Gateway } from './chat-v2.gateway';

describe('chat rejection in local API-only mode', () => {
  it('opens HTTP without enabling chat HTTP, either socket namespace or dispatch', async () => {
    const dataSource = { createQueryRunner: jest.fn() };
    const configService = { get: jest.fn() };
    const realtimeConfig = {
      singletonGuardMode: 'required' as const,
      legacyConnectionEnabled: true,
      legacyMutationEnabled: true,
      legacyWindowStartedAt: null,
      legacyCutoffAt: null,
      pushDeliveryEnabled: false,
      pushActivationStartedAt: null,
    };
    const guard = new ChatSingleInstanceRuntimeGuardService(dataSource as never, realtimeConfig);
    const readiness = { setActive: jest.fn(), isActive: jest.fn(), namespacesReady: jest.fn() };
    const dispatcher = { start: jest.fn(), stop: jest.fn() };
    const coordinator = new ChatRealtimeCoordinatorService(guard, readiness as never, dispatcher as never, configService as never);
    const app = { listen: jest.fn().mockResolvedValue(undefined), close: jest.fn().mockResolvedValue(undefined) };
    await listenWithChatRuntime(app, guard, coordinator, true);

    const httpGuard = new ChatRuntimeHttpGuard(configService as never, guard);
    const context = {} as ExecutionContext;
    expect(() => httpGuard.canActivate(context)).toThrow(HttpException);
    try {
      httpGuard.canActivate(context);
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(503);
    }
    const auth = { authenticate: jest.fn() };
    const legacy = new ChatGateway(auth as never, {} as never, {} as never, readiness as never, coordinator, {} as never, {} as never, realtimeConfig);
    const v2 = new ChatV2Gateway(auth as never, {} as never, readiness as never, coordinator, {} as never, {} as never);
    for (const gateway of [legacy, v2]) {
      const client = { emit: jest.fn(), disconnect: jest.fn(), join: jest.fn() };
      await gateway.handleConnection(client as unknown as Socket);
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    }
    expect(auth.authenticate).not.toHaveBeenCalled();
    expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    expect(guard.isHeld()).toBe(false);
    expect(coordinator.isActive()).toBe(false);
    expect(dispatcher.start).not.toHaveBeenCalled();
    expect(dispatcher.stop).toHaveBeenCalledTimes(1);
  });
});
