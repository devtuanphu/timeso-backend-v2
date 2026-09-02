import { ChatMessageResponseDto } from './dto/chat-v2.dto';
import { ChatMessage } from './entities/chat-message.entity';

export const mapChatMessage = (
  message: ChatMessage,
): ChatMessageResponseDto => ({
  id: message.id,
  groupId: message.groupId,
  clientMessageId: message.clientMessageId,
  sequence: String(message.sequence),
  content: message.content,
  messageType: message.messageType,
  attachment: message.attachmentUrl
    ? {
        url: message.attachmentUrl,
        name: message.attachmentName || null,
        size:
          message.attachmentSize === null || message.attachmentSize === undefined
            ? null
            : String(message.attachmentSize),
      }
    : null,
  sender: {
    id: message.senderId,
    fullName: message.sender?.fullName || null,
    avatar: message.sender?.avatar || null,
  },
  createdAt: message.createdAt.toISOString(),
});

