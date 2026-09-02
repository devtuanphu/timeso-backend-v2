import { Account } from '../accounts/entities/account.entity';
import { mapActiveChatMember } from './chat-member.mapper';
import { ChatGroupMember } from './entities/chat-group-member.entity';

describe('mapActiveChatMember', () => {
  it('does not serialize private account or employment fields', () => {
    const account = Object.assign(new Account(), {
      id: 'account-id',
      fullName: 'Thành viên',
      avatar: 'avatar-key',
      email: 'secret@example.test',
      phone: '0900000000',
      birthday: new Date('1990-01-01'),
      address: 'private address',
    });
    const member = Object.assign(new ChatGroupMember(), {
      id: 'member-id',
      accountId: 'account-id',
      account,
      status: 'active',
      notificationsEnabled: true,
      chatColor: null,
      employeeProfile: { employmentStatus: 'active', salary: 'private' },
    });
    const mapped = mapActiveChatMember(member, 'owner-id') as unknown as Record<
      string,
      unknown
    >;
    expect(mapped).toMatchObject({
      id: 'member-id',
      accountId: 'account-id',
      displayName: 'Thành viên',
      chatRole: 'participant',
      status: 'active',
    });
    for (const privateKey of [
      'email',
      'phone',
      'birthday',
      'address',
      'employeeProfile',
    ]) {
      expect(mapped).not.toHaveProperty(privateKey);
    }
  });
});
