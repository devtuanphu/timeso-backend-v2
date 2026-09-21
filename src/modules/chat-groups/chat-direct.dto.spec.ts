import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';

import { ChatContactsQueryDto, OpenDirectChatDto } from './dto/chat-v2.dto';

/** Same options as the global pipe in src/main.ts. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const STORE = '22222222-2222-4222-8222-222222222222';
const TARGET = '55555555-5555-4555-8555-555555555555';

const run = (metatype: any, type: 'body' | 'query', value: unknown) =>
  pipe.transform(value, { metatype, type } as ArgumentMetadata);

describe('direct chat DTO validation', () => {
  it('accepts UUID storeId and targetAccountId', async () => {
    await expect(
      run(OpenDirectChatDto, 'body', { storeId: STORE, targetAccountId: TARGET }),
    ).resolves.toMatchObject({ storeId: STORE, targetAccountId: TARGET });
  });

  it.each([
    ['non-UUID storeId', { storeId: 'junk', targetAccountId: TARGET }],
    ['non-UUID targetAccountId', { storeId: STORE, targetAccountId: 'x' }],
    ['array targetAccountId', { storeId: STORE, targetAccountId: [TARGET] }],
    ['missing targetAccountId', { storeId: STORE }],
    ['extra field', { storeId: STORE, targetAccountId: TARGET, name: 'x' }],
  ])('rejects %s with 400', async (_label, body) => {
    await expect(run(OpenDirectChatDto, 'body', body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects junk contacts storeId with 400', async () => {
    await expect(
      run(ChatContactsQueryDto, 'query', { storeId: 'junk' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      run(ChatContactsQueryDto, 'query', { storeId: STORE }),
    ).resolves.toMatchObject({ storeId: STORE });
  });
});
