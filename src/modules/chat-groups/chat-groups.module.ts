import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatGroupsController } from './chat-groups.controller';
import { ChatGroupsService } from './chat-groups.service';
import { ChatGateway } from './chat.gateway';
import { ChatGroup } from './entities/chat-group.entity';
import { ChatGroupMember } from './entities/chat-group-member.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatOutboxEvent } from './entities/chat-outbox-event.entity';
import { Store } from '../stores/entities/store.entity';
import { EmployeeProfile } from '../stores/entities/employee-profile.entity';
import { Account } from '../accounts/entities/account.entity';
import { ChatAuthorizationService } from './chat-authorization.service';
import { ChatMessageCommandService } from './chat-message-command.service';
import { ChatMessageQueryService } from './chat-message-query.service';
import { ChatV2Gateway } from './chat-v2.gateway';
import {
  CHAT_REALTIME_CONFIG,
  createChatRealtimeConfig,
} from './chat-realtime.config';
import { ChatRealtimeReadinessService } from './chat-realtime-readiness.service';
import { LocalSocketChatEventPublisher } from './local-socket-chat-event-publisher';
import { CHAT_EVENT_PUBLISHER } from './chat-event-publisher';
import { ChatOutboxDispatcherService } from './chat-outbox-dispatcher.service';
import { ChatSingleInstanceRuntimeGuardService } from './chat-single-instance-runtime-guard.service';
import { ChatRealtimeCoordinatorService } from './chat-realtime-coordinator.service';
import { ChatSocketAuthService } from './chat-socket-auth.service';
import { ChatRuntimeHttpGuard } from './chat-runtime-http.guard';
import { AuthModule } from '../auth/auth.module';
import { ChatAbuseProtectionService } from './chat-abuse-protection.service';
import { ChatPushDelivery } from './entities/chat-push-delivery.entity';
import { ChatPushIntentDispatcherService } from './chat-push-intent-dispatcher.service';
import { ChatPushDispatcherService } from './chat-push-dispatcher.service';
import { ChatPushReceiptDispatcherService } from './chat-push-receipt-dispatcher.service';
import { DevicesModule } from '../devices/devices.module';
import { PushModule } from '../push/push.module';
import { UserDevice } from '../devices/entities/user-device.entity';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    DevicesModule,
    PushModule,
    TypeOrmModule.forFeature([
      ChatGroup,
      ChatGroupMember,
      ChatMessage,
      ChatOutboxEvent,
      ChatPushDelivery,
      UserDevice,
      Store,
      EmployeeProfile,
      Account,
    ]),
  ],
  controllers: [ChatGroupsController],
  providers: [
    {
      provide: CHAT_REALTIME_CONFIG,
      inject: [ConfigService],
      useFactory: createChatRealtimeConfig,
    },
    ChatGroupsService,
    ChatAuthorizationService,
    ChatMessageCommandService,
    ChatMessageQueryService,
    ChatSocketAuthService,
    ChatRuntimeHttpGuard,
    ChatAbuseProtectionService,
    ChatGateway,
    ChatV2Gateway,
    ChatRealtimeReadinessService,
    LocalSocketChatEventPublisher,
    {
      provide: CHAT_EVENT_PUBLISHER,
      useExisting: LocalSocketChatEventPublisher,
    },
    ChatOutboxDispatcherService,
    ChatPushIntentDispatcherService,
    ChatPushDispatcherService,
    ChatPushReceiptDispatcherService,
    ChatSingleInstanceRuntimeGuardService,
    ChatRealtimeCoordinatorService,
  ],
  exports: [
    ChatGroupsService,
    ChatGateway,
    ChatSingleInstanceRuntimeGuardService,
    ChatRealtimeCoordinatorService,
  ],
})
export class ChatGroupsModule {}
