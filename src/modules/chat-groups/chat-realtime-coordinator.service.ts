import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { isAppReadOnlyMode } from '../../common/utils/app-read-only-mode';
import { ChatOutboxDispatcherService } from './chat-outbox-dispatcher.service';
import { ChatRealtimeReadinessService } from './chat-realtime-readiness.service';
import { ChatSingleInstanceRuntimeGuardService } from './chat-single-instance-runtime-guard.service';
import { ChatPushIntentDispatcherService } from './chat-push-intent-dispatcher.service';
import { ChatPushDispatcherService } from './chat-push-dispatcher.service';
import { ChatPushReceiptDispatcherService } from './chat-push-receipt-dispatcher.service';

@Injectable()
export class ChatRealtimeCoordinatorService {
  private readonly logger = new Logger(ChatRealtimeCoordinatorService.name);
  private active = false;

  constructor(
    private readonly guard: ChatSingleInstanceRuntimeGuardService,
    private readonly readiness: ChatRealtimeReadinessService,
    private readonly dispatcher: ChatOutboxDispatcherService,
    private readonly configService: ConfigService,
    private readonly pushIntents?: ChatPushIntentDispatcherService,
    private readonly pushDeliveries?: ChatPushDispatcherService,
    private readonly pushReceipts?: ChatPushReceiptDispatcherService,
  ) {}

  async activateAfterListen(): Promise<void> {
    const writable = !isAppReadOnlyMode(this.configService);
    this.active =
      this.guard.isHeld() && writable && this.readiness.namespacesReady();
    this.readiness.setActive(this.active);
    if (this.active) {
      this.dispatcher.start();
      const pushReady = (await this.pushIntents?.prepare()) === true;
      if (pushReady) {
        this.pushIntents?.start();
        this.pushDeliveries?.start();
        this.pushReceipts?.start();
      } else {
        this.pushIntents?.stop();
        this.pushDeliveries?.stop();
        this.pushReceipts?.stop();
        if (this.pushIntents?.isConfigured()) {
          this.logger.warn('Chat push delivery inactive: schema is not ready');
        }
      }
      this.logger.log('Chat realtime coordinator active');
    } else {
      this.dispatcher.stop();
      this.pushIntents?.stop();
      this.pushDeliveries?.stop();
      this.pushReceipts?.stop();
      this.logger.warn('Chat realtime coordinator inactive');
    }
  }

  deactivate(): void {
    this.active = false;
    this.readiness.setActive(false);
    this.dispatcher.stop();
    this.pushIntents?.stop();
    this.pushDeliveries?.stop();
    this.pushReceipts?.stop();
  }

  isActive(): boolean {
    return this.active && this.readiness.isActive();
  }
}
