import type { INestApplication } from '@nestjs/common';
import type { ChatSingleInstanceRuntimeGuardService } from './modules/chat-groups/chat-single-instance-runtime-guard.service';
import type { ChatRealtimeCoordinatorService } from './modules/chat-groups/chat-realtime-coordinator.service';
import { CHAT_FATAL_SHUTDOWN_MS } from './modules/chat-groups/chat-realtime.config';
import { isLocalApiOnly } from './app-runtime.config';

export async function listenWithChatRuntime(
  app: Pick<INestApplication, 'listen' | 'close'>,
  chatGuard: Pick<
    ChatSingleInstanceRuntimeGuardService,
    'acquireBeforeListen' | 'release' | 'startHealthMonitor'
  >,
  chatCoordinator: Pick<
    ChatRealtimeCoordinatorService,
    'activateAfterListen' | 'deactivate'
  >,
  apiOnly = isLocalApiOnly(),
): Promise<void> {
  if (apiOnly) {
    // Never compete for the shared database's chat lock. Existing HTTP/socket
    // readiness guards remain closed because this process never holds it.
    chatCoordinator.deactivate();
    try {
      await app.listen(process.env.PORT ?? 3000, '127.0.0.1');
    } catch (error) {
      await app.close();
      throw error;
    }
    return;
  }

  try {
    await chatGuard.acquireBeforeListen();
    await app.listen(process.env.PORT ?? 3000);
  } catch (error) {
    await chatGuard.release();
    await app.close();
    throw error;
  }
  chatCoordinator.activateAfterListen();
  chatGuard.startHealthMonitor(async () => {
    chatCoordinator.deactivate();
    process.exitCode = 1;
    const forcedExit = setTimeout(() => process.exit(1), CHAT_FATAL_SHUTDOWN_MS);
    forcedExit.unref?.();
    await app.close();
  });
}
