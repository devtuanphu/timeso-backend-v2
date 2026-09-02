import { Type } from 'class-transformer';
import {
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SendChatMessageDto {
  @IsUUID('4')
  clientMessageId: string;

  @IsString()
  content: string;
}

export class HistoryMessagesQueryDto {
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  beforeSequence?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class CatchUpMessagesQueryDto {
  @Matches(/^(0|[1-9]\d{0,18})$/)
  afterSequence: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class SearchChatMessagesQueryDto {
  @IsString()
  query: string;

  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  beforeSequence?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  /** Temporary compatibility with released page-based clients. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;
}

export class ChatGroupListV2QueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 30;
}

export class LegacyChatPageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class LegacyChatPaginationQueryDto extends LegacyChatPageQueryDto {
  @IsOptional()
  @IsUUID('4')
  storeId?: string;
}

export class LegacyChatMediaQueryDto extends LegacyChatPageQueryDto {
  limit = 20;

  @IsOptional()
  @IsIn(['image', 'video', 'document', 'all'])
  type: 'image' | 'video' | 'document' | 'all' = 'all';
}

export class MarkChatGroupReadDto {
  @IsOptional()
  @Matches(/^(0|[1-9]\d{0,18})$/)
  sequence?: string;
}

export class ChatSenderResponseDto {
  id: string;
  fullName: string | null;
  avatar: string | null;
}

export class ChatAttachmentResponseDto {
  url: string;
  name: string | null;
  size: string | null;
}

export class ChatMessageResponseDto {
  id: string;
  groupId: string;
  clientMessageId: string | null;
  sequence: string;
  content: string;
  messageType: string;
  attachment: ChatAttachmentResponseDto | null;
  sender: ChatSenderResponseDto;
  createdAt: string;
}

export class SendChatMessageResponseDto {
  message: ChatMessageResponseDto;
  deduplicated: boolean;
}

export class ChatMessageCursorPageDto {
  data: ChatMessageResponseDto[];
  hasMore: boolean;
  nextCursor: string | null;
}

export class ChatGroupListItemResponseDto {
  id: string;
  name: string;
  avatar: string | null;
  storeId: string;
  activityAt: string;
  unreadCount: number;
  lastReadSequence: string | null;
  lastMessage: ChatMessageResponseDto | null;
}

export class ChatGroupListV2ResponseDto {
  data: ChatGroupListItemResponseDto[];
  hasMore: boolean;
  nextCursor: string | null;
}
