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
}

export const mapActiveChatMember = (
  member: ChatGroupMember,
  ownerAccountId: string,
): ChatMemberResponse => {
  const chatRole =
    member.accountId === ownerAccountId ? 'owner' : 'participant';
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
  };
};
