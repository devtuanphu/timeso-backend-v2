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
import { ChatRealtimeReadinessService } from './chat-realtime-readiness.service';
import { ChatSocketAuthService } from './chat-socket-auth.service';
import { ChatRealtimeCoordinatorService } from './chat-realtime-coordinator.service';
import { ChatAbuseProtectionService } from './chat-abuse-protection.service';

interface TypingState {
  lastStartAt: number;
  timer: ReturnType<typeof setTimeout>;
}

@Injectable()
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat-v2' })
export class ChatV2Gateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnApplicationShutdown
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatV2Gateway.name);
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly typing = new Map<string, Map<string, TypingState>>();
  private readonly buckets = new Map<string, number[]>();

  constructor(
    private readonly socketAuth: ChatSocketAuthService,
    private readonly authorization: ChatAuthorizationService,
    private readonly readiness: ChatRealtimeReadinessService,
    private readonly coordinator: ChatRealtimeCoordinatorService,
    private readonly abuseProtection: ChatAbuseProtectionService,
    @Inject(CHAT_EVENT_PUBLISHER)
    private readonly publisher: ChatEventPublisher,
  ) {}

  afterInit(server: Server): void {
    this.readiness.attach('v2', server);
    this.logger.log('Chat v2 namespace initialized');
  }

  onApplicationShutdown(): void {
    if (this.server) this.readiness.detach('v2', this.server);
    this.expiryTimers.forEach(clearTimeout);
    this.expiryTimers.clear();
    for (const states of this.typing.values()) {
      for (const state of states.values()) clearTimeout(state.timer);
    }
    this.typing.clear();
    this.buckets.clear();
  }

  async handleConnection(client: Socket): Promise<void> {
    if (!this.coordinator.isActive()) {
      client.emit('chat.error.v1', { code: 'CHAT_NOT_READY' });
      client.disconnect(true);
      return;
    }
    try {
      const principal = await this.socketAuth.authenticate(client, true);
      this.abuseProtection.acquireSocket(
        client.id,
        principal.accountId,
        client.handshake.address,
      );
      await client.join(`account:${principal.accountId}`);
      const timer = setTimeout(
        () => client.disconnect(true),
        Math.max(principal.expiresAt - Date.now(), 1),
      );
      timer.unref?.();
      this.expiryTimers.set(client.id, timer);
    } catch (error) {
      const code =
        error instanceof Error && error.message === 'CHAT_SOCKET_LIMITED'
          ? 'CHAT_SOCKET_LIMITED'
          : 'CHAT_SOCKET_UNAUTHORIZED';
      client.emit('chat.error.v1', { code });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const expiry = this.expiryTimers.get(client.id);
    if (expiry) clearTimeout(expiry);
    this.expiryTimers.delete(client.id);
    this.buckets.delete(client.id);
    this.abuseProtection.releaseSocket(client.id);
    await this.clearTyping(client);
  }

  @SubscribeMessage('chat.typing.start.v1')
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId?: string },
  ) {
    return this.updateTyping(client, data.groupId, true);
  }

  @SubscribeMessage('chat.typing.stop.v1')
  async handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId?: string },
  ) {
    return this.updateTyping(client, data.groupId, false);
  }

  private async updateTyping(
    client: Socket,
    groupId: string | undefined,
    isTyping: boolean,
  ): Promise<{ ok: boolean; code?: string }> {
    try {
      if (
        !groupId ||
        !this.isUuid(groupId) ||
        (isTyping && !this.takeToken(client.id))
      ) {
        return { ok: false, code: 'CHAT_TYPING_REJECTED' };
      }
      const principal = this.socketAuth.getPrincipal(client);
      if (isTyping) {
        this.abuseProtection.assertHttp(
          'typing',
          principal.accountId,
          client.handshake.address,
        );
      }
      await this.authorization.requireGroupAccess(groupId, principal.accountId);
      const socketGroups = this.typing.get(client.id) || new Map();
      const existing = socketGroups.get(groupId);

      if (isTyping) {
        if (!existing && socketGroups.size >= 5) {
          return { ok: false, code: 'CHAT_TYPING_REJECTED' };
        }
        const now = Date.now();
        if (existing && now - existing.lastStartAt < 1_000) {
          return { ok: true };
        }
        if (existing) clearTimeout(existing.timer);
        const expiresAt = now + 5_000;
        const timer = setTimeout(() => {
          void this.expireTyping(client, groupId, principal.accountId);
        }, 5_000);
        timer.unref?.();
        socketGroups.set(groupId, { lastStartAt: now, timer });
        this.typing.set(client.id, socketGroups);
        await this.publishTyping(groupId, principal.accountId, true, expiresAt);
      } else if (existing) {
        clearTimeout(existing.timer);
        socketGroups.delete(groupId);
        if (socketGroups.size === 0) this.typing.delete(client.id);
        await this.publishTyping(groupId, principal.accountId, false, Date.now());
      }
      return { ok: true };
    } catch (error) {
      const response =
        typeof error === 'object' && error !== null && 'response' in error
          ? (error as { response?: { code?: string } }).response
          : undefined;
      return {
        ok: false,
        code:
          response?.code === 'CHAT_RATE_LIMITED'
            ? 'CHAT_TYPING_REJECTED'
            : 'CHAT_ACCESS_DENIED',
      };
    }
  }

  private async expireTyping(
    client: Socket,
    groupId: string,
    accountId: string,
  ): Promise<void> {
    const socketGroups = this.typing.get(client.id);
    if (!socketGroups?.has(groupId)) return;
    socketGroups.delete(groupId);
    if (socketGroups.size === 0) this.typing.delete(client.id);
    await this.publishTyping(groupId, accountId, false, Date.now()).catch(
      () => undefined,
    );
  }

  private async clearTyping(client: Socket): Promise<void> {
    const principal = client.data.chatPrincipal as
      | { accountId: string }
      | undefined;
    const states = this.typing.get(client.id);
    this.typing.delete(client.id);
    if (!principal || !states) return;
    for (const [groupId, state] of states) {
      clearTimeout(state.timer);
      await this.publishTyping(
        groupId,
        principal.accountId,
        false,
        Date.now(),
      ).catch(() => undefined);
    }
  }

  private async publishTyping(
    groupId: string,
    accountId: string,
    isTyping: boolean,
    expiresAt: number,
  ): Promise<void> {
    const recipients = (
      await this.authorization.getEligibleRecipientAccountIds(groupId)
    ).filter((id) => id !== accountId);
    await this.publisher.publishTyping(
      {
        version: 1,
        groupId,
        accountId,
        isTyping,
        expiresAt: new Date(expiresAt).toISOString(),
      },
      recipients,
    );
  }

  private takeToken(socketId: string): boolean {
    const threshold = Date.now() - 5_000;
    const recent = (this.buckets.get(socketId) || []).filter(
      (time) => time > threshold,
    );
    if (recent.length >= 10) {
      this.buckets.set(socketId, recent);
      return false;
    }
    recent.push(Date.now());
    this.buckets.set(socketId, recent);
    return true;
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }
}
