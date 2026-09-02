import { Injectable } from '@nestjs/common';

import {
  ChatEventPublisher,
  ChatMessageCreatedEvent,
  ChatReadUpdatedEvent,
  ChatTypingEvent,
} from './chat-event-publisher';
import { ChatRealtimeReadinessService } from './chat-realtime-readiness.service';

@Injectable()
export class LocalSocketChatEventPublisher implements ChatEventPublisher {
  constructor(
    private readonly readiness: ChatRealtimeReadinessService,
  ) {}

  async publishMessageCreated(
    event: ChatMessageCreatedEvent,
    recipientAccountIds: string[],
  ): Promise<void> {
    const v2 = this.readiness.getServer('v2');
    if (!v2 || !this.readiness.isActive()) {
      throw new Error('CHAT_REALTIME_NOT_READY');
    }
    for (const accountId of recipientAccountIds) {
      v2.to(`account:${accountId}`).emit('chat.message.created.v1', event);
    }

    const legacy = this.readiness.getServer('legacy');
    if (legacy && this.readiness.legacyConnectionsAllowed()) {
      for (const accountId of recipientAccountIds) {
        legacy.to(`account:${accountId}`).emit('message:new', event.message);
      }
    }
  }

  async publishReadUpdated(
    event: ChatReadUpdatedEvent,
    recipientAccountIds: string[],
  ): Promise<void> {
    const v2 = this.readiness.getServer('v2');
    if (!v2 || !this.readiness.isActive()) {
      throw new Error('CHAT_REALTIME_NOT_READY');
    }
    for (const accountId of recipientAccountIds) {
      v2.to(`account:${accountId}`).emit('chat.read.updated.v1', event);
    }

    const legacy = this.readiness.getServer('legacy');
    if (legacy && this.readiness.legacyConnectionsAllowed()) {
      for (const accountId of recipientAccountIds) {
        legacy.to(`account:${accountId}`).emit('message:read', {
          groupId: event.groupId,
          userId: event.accountId,
          sequence: event.lastReadSequence,
        });
      }
    }
  }

  async publishTyping(
    event: ChatTypingEvent,
    recipientAccountIds: string[],
  ): Promise<void> {
    const v2 = this.readiness.getServer('v2');
    if (!v2 || !this.readiness.isActive()) return;
    for (const accountId of recipientAccountIds) {
      v2.to(`account:${accountId}`).emit('chat.typing.v1', event);
    }

    const legacy = this.readiness.getServer('legacy');
    if (legacy && this.readiness.legacyConnectionsAllowed()) {
      for (const accountId of recipientAccountIds) {
        legacy.to(`account:${accountId}`).emit('typing:user', {
          groupId: event.groupId,
          userId: event.accountId,
          isTyping: event.isTyping,
          expiresAt: event.expiresAt,
        });
      }
    }
  }
}
