import { ChatMessageResponseDto } from './dto/chat-v2.dto';

export const CHAT_EVENT_PUBLISHER = Symbol('CHAT_EVENT_PUBLISHER');

export interface ChatMessageCreatedEvent {
  version: 1;
  message: ChatMessageResponseDto;
}

export interface ChatReadUpdatedEvent {
  version: 1;
  groupId: string;
  accountId: string;
  lastReadSequence: string;
  updatedAt: string;
}

export interface ChatTypingEvent {
  version: 1;
  groupId: string;
  accountId: string;
  isTyping: boolean;
  expiresAt: string;
}

export interface ChatEventPublisher {
  publishMessageCreated(
    event: ChatMessageCreatedEvent,
    recipientAccountIds: string[],
  ): Promise<void>;
  publishReadUpdated(
    event: ChatReadUpdatedEvent,
    recipientAccountIds: string[],
  ): Promise<void>;
  publishTyping(
    event: ChatTypingEvent,
    recipientAccountIds: string[],
  ): Promise<void>;
}

