import { ChatGroupMember } from './entities/chat-group-member.entity';

export interface ChatMemberResponse {
  id: string;
  accountId: string;
  displayName: string | null;
  fullName: string | null;
  avatar: string | null;
  chatRole: 'owner' | 'participant';
  role: 'owner' | 'participant';
  status: 'active';
  notificationsEnabled: boolean;
  chatColor: string | null;
  /** Receipt cursors (additive): delivered is always >= read. */
  lastDeliveredSequence: string;
  lastReadSequence: string;
}

export interface ChatMemberReceipt {
  accountId: string;
  lastDeliveredSequence: string;
  lastReadSequence: string;
}

/**
 * Normalized receipt cursors of one membership. A null read cursor is "0";
 * delivered never reports below read (rows written before the delivered
 * column existed, or before the backfill ran).
 */
export const mapChatMemberReceipt = (
  member: Pick<
    ChatGroupMember,
    'accountId' | 'lastReadSequence' | 'lastDeliveredSequence'
  >,
): ChatMemberReceipt => {
  const read = BigInt(member.lastReadSequence || '0');
  const delivered = BigInt(member.lastDeliveredSequence || '0');
  return {
    accountId: member.accountId,
    lastDeliveredSequence: (delivered > read ? delivered : read).toString(),
    lastReadSequence: read.toString(),
  };
};

export const mapActiveChatMember = (
  member: ChatGroupMember,
  ownerAccountId: string,
): ChatMemberResponse => {
  const chatRole =
    member.accountId === ownerAccountId ? 'owner' : 'participant';
  const receipt = mapChatMemberReceipt(member);
  return {
    id: member.id,
    accountId: member.accountId,
    displayName: member.account?.fullName || null,
    fullName: member.account?.fullName || null,
    avatar: member.account?.avatar || null,
    chatRole,
    role: chatRole,
    status: 'active',
    notificationsEnabled: member.notificationsEnabled,
    chatColor: member.chatColor || null,
    lastDeliveredSequence: receipt.lastDeliveredSequence,
    lastReadSequence: receipt.lastReadSequence,
  };
};
