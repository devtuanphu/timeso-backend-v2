import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { ChatAuthorizationService } from './chat-authorization.service';
import { ChatMessageCommandService } from './chat-message-command.service';
import { ChatGroupMember } from './entities/chat-group-member.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatOutboxEvent } from './entities/chat-outbox-event.entity';

const ids = {
  group: '11111111-1111-4111-8111-111111111111',
  account: '22222222-2222-4222-8222-222222222222',
  client: '33333333-3333-4333-8333-333333333333',
  message: '44444444-4444-4444-8444-444444444444',
};

const persistedMessage = (content = 'Xin chào') =>
  ({
    id: ids.message,
    groupId: ids.group,
    senderId: ids.account,
    clientMessageId: ids.client,
    sequence: '7',
    content,
    messageType: 'text',
    attachmentUrl: null,
    attachmentName: null,
    attachmentSize: null,
    sender: { id: ids.account, fullName: 'Member', avatar: null },
    createdAt: new Date('2026-08-29T00:00:00.000Z'),
  }) as ChatMessage;

const createHarness = (existing: ChatMessage | null) => {
  const idempotencyBuilder = {
    withDeleted: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(existing),
  };
  const message = persistedMessage();
  const messageRepository = {
    createQueryBuilder: jest.fn(() => idempotencyBuilder),
    create: jest.fn((value) => value),
    save: jest.fn().mockResolvedValue(message),
    findOne: jest.fn().mockResolvedValue(message),
  };
  const updateBuilder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const outboxRepository = {
    create: jest.fn((value) => value),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === ChatMessage) return messageRepository;
      if (entity === ChatOutboxEvent) return outboxRepository;
      throw new Error('unexpected repository');
    }),
    createQueryBuilder: jest.fn(() => updateBuilder),
  };
  const dataSource = {
    transaction: jest.fn(async (callback) => callback(manager)),
    manager,
  } as unknown as DataSource;
  const authorization = {
    requireGroupAccess: jest.fn().mockResolvedValue({
      group: {
        messagePermission: 'everyone',
        createdBy: ids.account,
        customSenderIds: [],
      },
      member: {} as ChatGroupMember,
      isOwner: true,
    }),
  } as unknown as ChatAuthorizationService;
  const configService = {
    get: jest.fn().mockReturnValue(false),
  } as unknown as ConfigService;
  return {
    service: new ChatMessageCommandService(
      dataSource,
      authorization,
      configService,
    ),
    messageRepository,
    outboxRepository,
  };
};

describe('ChatMessageCommandService', () => {
  it('returns the existing message for an exact idempotent retry', async () => {
    const { service, messageRepository } = createHarness(persistedMessage());
    const result = await service.sendTextMessage(ids.group, ids.account, {
      clientMessageId: ids.client,
      content: '  Xin chào  ',
    });
    expect(result).toMatchObject({ deduplicated: true, httpStatus: 200 });
    expect(messageRepository.save).not.toHaveBeenCalled();
  });

  it('rejects reuse of a client id for different canonical content', async () => {
    const { service } = createHarness(persistedMessage('Nội dung cũ'));
    await expect(
      service.sendTextMessage(ids.group, ids.account, {
        clientMessageId: ids.client,
        content: 'Nội dung mới',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('persists the message and identity-only outbox event in one transaction', async () => {
    const { service, messageRepository, outboxRepository } = createHarness(null);
    const result = await service.sendTextMessage(ids.group, ids.account, {
      clientMessageId: ids.client,
      content: 'Xin chào',
    });
    expect(result).toMatchObject({ deduplicated: false, httpStatus: 201 });
    expect(messageRepository.save).toHaveBeenCalledTimes(1);
    expect(outboxRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: ids.group,
        messageId: ids.message,
        actorAccountId: ids.account,
        sequence: '7',
      }),
    );
    expect(outboxRepository.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.anything() }),
    );
  });
});

