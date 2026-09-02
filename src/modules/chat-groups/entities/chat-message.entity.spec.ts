import { getMetadataArgsStorage } from 'typeorm';

import { ChatMessage } from './chat-message.entity';

describe('ChatMessage database metadata', () => {
  it('declares an exact PostgreSQL type for every nullable union column', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (column) => column.target === ChatMessage,
    );
    const expectedTypes = new Map<string, string>([
      ['sequence', 'bigint'],
      ['clientMessageId', 'uuid'],
      ['attachmentUrl', 'varchar'],
      ['attachmentName', 'varchar'],
      ['attachmentSize', 'bigint'],
    ]);

    for (const [propertyName, expectedType] of expectedTypes) {
      const column = columns.find(
        (candidate) => candidate.propertyName === propertyName,
      );
      expect(column?.options.nullable).toBe(true);
      expect(column?.options.type).toBe(expectedType);
      expect(column?.options.type).not.toBe(Object);
    }
  });
});
