import { randomUUID } from 'crypto';

import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { ChatAuthorizationService } from './chat-authorization.service';
import {
  CHAT_EVENT_PUBLISHER,
  ChatEventPublisher,
} from './chat-event-publisher';
import { ChatMessageCommandService } from './chat-message-command.service';
import {
  CHAT_REALTIME_CONFIG,
  ChatRealtimeConfig,
} from './chat-realtime.config';
import { ChatRealtimeReadinessService } from './chat-realtime-readiness.service';
import { ChatSocketAuthService } from './chat-socket-auth.service';
import { ChatRealtimeCoordinatorService } from './chat-realtime-coordinator.service';
import { ChatAbuseProtectionService } from './chat-abuse-protection.service';

@Injectable()
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
export class ChatGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnApplicationShutdown
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly socketAuth: ChatSocketAuthService,
    private readonly authorization: ChatAuthorizationService,
    private readonly commands: ChatMessageCommandService,
    private readonly readiness: ChatRealtimeReadinessService,
    private readonly coordinator: ChatRealtimeCoordinatorService,
    private readonly abuseProtection: ChatAbuseProtectionService,
    @Inject(CHAT_EVENT_PUBLISHER)
    private readonly publisher: ChatEventPublisher,
    @Inject(CHAT_REALTIME_CONFIG)
    private readonly config: ChatRealtimeConfig,
  ) {}

  afterInit(server: Server): void {
    this.readiness.attach('legacy', server);
    this.logger.log('Legacy chat namespace initialized');
  }

  onApplicationShutdown(): void {
    if (this.server) this.readiness.detach('legacy', this.server);
    this.expiryTimers.forEach(clearTimeout);
    this.expiryTimers.clear();
  }

  async handleConnection(client: Socket): Promise<void> {
    if (!this.coordinator.isActive() || !this.legacyConnectionsAllowed()) {
      client.emit('chat:error', { code: 'CHAT_UPGRADE_REQUIRED' });
      client.disconnect(true);
      return;
    }
    try {
      const principal = await this.socketAuth.authenticate(client, false);
      this.abuseProtection.acquireSocket(
        client.id,
        principal.accountId,
        client.handshake.address,
      );
      await client.join(`account:${principal.accountId}`);
      const timer = setTimeout(
        () => client.disconnect(true),
        Math.max(
          Math.min(
            principal.expiresAt,
            this.config.legacyCutoffAt?.getTime() || principal.expiresAt,
          ) - Date.now(),
          1,
        ),
      );
      timer.unref?.();
      this.expiryTimers.set(client.id, timer);
    } catch (error) {
      const code =
        error instanceof Error && error.message === 'CHAT_SOCKET_LIMITED'
          ? 'CHAT_SOCKET_LIMITED'
          : 'CHAT_SOCKET_UNAUTHORIZED';
      client.emit('chat:error', { code });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const timer = this.expiryTimers.get(client.id);
    if (timer) clearTimeout(timer);
    this.expiryTimers.delete(client.id);
    this.abuseProtection.releaseSocket(client.id);
  }

  @SubscribeMessage('message:send')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId?: string; content?: string },
  ) {
    // Released clients that authenticated only with a claimed userId cannot be
    // accepted safely. They must be force-upgraded during the staged legacy
    // window; this namespace remains JWT-only and never trusts auth.userId.
    if (!this.legacyMutationsAllowed()) {
      return { success: false, error: 'CHAT_UPGRADE_REQUIRED' };
    }
    try {
      const principal = this.socketAuth.getPrincipal(client);
      if (!data.groupId || typeof data.content !== 'string') {
        return { success: false, error: 'CHAT_CONTENT_INVALID' };
      }
      this.abuseProtection.assertHttp(
        'send',
        principal.accountId,
        client.handshake.address,
      );
      const result = await this.commands.sendTextMessage(
        data.groupId,
        principal.accountId,
        { clientMessageId: randomUUID(), content: data.content },
      );
      return { success: true, message: result.message };
    } catch (error) {
      return {
        success: false,
        error: this.safeErrorCode(error),
      };
    }
  }

  @SubscribeMessage('typing:start')
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId?: string },
  ) {
    return this.publishLegacyTyping(client, data.groupId, true);
  }

  @SubscribeMessage('typing:stop')
  async handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId?: string },
  ) {
    return this.publishLegacyTyping(client, data.groupId, false);
  }

  @SubscribeMessage('message:read')
  handleMarkAsRead() {
    return { success: false, error: 'CHAT_UPGRADE_REQUIRED' };
  }

  // Account rooms make membership changes visible without mutating socket rooms.
  joinGroup(_accountId: string, _groupId: string): void {}

  leaveGroup(_accountId: string, _groupId: string): void {}

  isUserOnline(accountId: string): boolean {
    return (this.server?.sockets.adapter.rooms.get(`account:${accountId}`)?.size || 0) > 0;
  }

  getOnlineUsersInGroup(_groupId: string): string[] {
    return [];
  }

  private async publishLegacyTyping(
    client: Socket,
    groupId: string | undefined,
    isTyping: boolean,
  ) {
    if (!this.legacyMutationsAllowed()) {
      return { success: false, error: 'CHAT_UPGRADE_REQUIRED' };
    }
    try {
      if (!groupId) return { success: false, error: 'CHAT_ACCESS_DENIED' };
      const principal = this.socketAuth.getPrincipal(client);
      if (isTyping) {
        this.abuseProtection.assertHttp(
          'typing',
          principal.accountId,
          client.handshake.address,
        );
      }
      await this.authorization.requireGroupAccess(groupId, principal.accountId);
      const recipients = (
        await this.authorization.getEligibleRecipientAccountIds(groupId)
      ).filter((id) => id !== principal.accountId);
      const expiresAt = Date.now() + (isTyping ? 5_000 : 0);
      await this.publisher.publishTyping(
        {
          version: 1,
          groupId,
          accountId: principal.accountId,
          isTyping,
          expiresAt: new Date(expiresAt).toISOString(),
        },
        recipients,
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error:
          this.safeErrorCode(error) === 'CHAT_RATE_LIMITED'
            ? 'CHAT_TYPING_REJECTED'
            : 'CHAT_ACCESS_DENIED',
      };
    }
  }

  private legacyConnectionsAllowed(): boolean {
    return (
      this.config.legacyConnectionEnabled &&
      !!this.config.legacyCutoffAt &&
      Date.now() < this.config.legacyCutoffAt.getTime()
    );
  }

  private legacyMutationsAllowed(): boolean {
    return this.legacyConnectionsAllowed() && this.config.legacyMutationEnabled;
  }

  private safeErrorCode(error: unknown): string {
    if (
      typeof error === 'object' &&
      error !== null &&
      'response' in error &&
      typeof (error as { response?: unknown }).response === 'object'
    ) {
      const response = (error as { response: { code?: unknown } }).response;
      if (typeof response.code === 'string') return response.code;
    }
    return 'CHAT_SEND_FAILED';
  }
}
