import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { isAppReadOnlyMode } from '../../common/utils/app-read-only-mode';
import { ChatOutboxDispatcherService } from './chat-outbox-dispatcher.service';
import { ChatRealtimeReadinessService } from './chat-realtime-readiness.service';
import { ChatSingleInstanceRuntimeGuardService } from './chat-single-instance-runtime-guard.service';

@Injectable()
export class ChatRealtimeCoordinatorService {
  private readonly logger = new Logger(ChatRealtimeCoordinatorService.name);
  private active = false;

  constructor(
    private readonly guard: ChatSingleInstanceRuntimeGuardService,
    private readonly readiness: ChatRealtimeReadinessService,
    private readonly dispatcher: ChatOutboxDispatcherService,
    private readonly configService: ConfigService,
  ) {}

  activateAfterListen(): void {
    const writable = !isAppReadOnlyMode(this.configService);
    this.active =
      this.guard.isHeld() && writable && this.readiness.namespacesReady();
    this.readiness.setActive(this.active);
    if (this.active) {
      this.dispatcher.start();
      this.logger.log('Chat realtime coordinator active');
    } else {
      this.dispatcher.stop();
      this.logger.warn('Chat realtime coordinator inactive');
    }
  }

  deactivate(): void {
    this.active = false;
    this.readiness.setActive(false);
    this.dispatcher.stop();
  }

  isActive(): boolean {
    return this.active && this.readiness.isActive();
  }
}

