import { DataSource, Repository } from 'typeorm';

import { ChatAuthorizationService } from './chat-authorization.service';
import { ChatEventPublisher } from './chat-event-publisher';
import { ChatOutboxDispatcherService } from './chat-outbox-dispatcher.service';
import { ChatRealtimeReadinessService } from './chat-realtime-readiness.service';
import {
  ChatOutboxEvent,
  ChatOutboxStatus,
} from './entities/chat-outbox-event.entity';

describe('ChatOutboxDispatcherService PostgreSQL claim result', () => {
  it('unwraps TypeORM UPDATE RETURNING tuples before reloading events', async () => {
    const find = jest.fn().mockResolvedValue([]);
    const manager = {
      query: jest.fn().mockResolvedValue([[{ id: 'event-id' }], 1]),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
      getRepository: jest.fn(
        () => ({ find }) as unknown as Repository<ChatOutboxEvent>,
      ),
    } as unknown as DataSource;
    const readiness = {
      isActive: jest.fn().mockReturnValue(true),
    } as unknown as ChatRealtimeReadinessService;
    const dispatcher = new ChatOutboxDispatcherService(
      dataSource,
      {} as ChatAuthorizationService,
      readiness,
      {} as ChatEventPublisher,
    );

    dispatcher.start();
    await dispatcher.dispatchOnce();

    const findOptions = find.mock.calls[0][0];
    expect(findOptions.where.id.value).toEqual(['event-id']);
  });

  it.each([
    [1, "status = 'pending'", ['event-id', 500]],
    [20, "status = 'dead'", ['event-id']],
  ])(
    'uses a PostgreSQL-safe literal status after attempt %s',
    async (attemptCount, expectedStatusSql, expectedParameters) => {
      const query = jest.fn().mockResolvedValue([]);
      const dispatcher = new ChatOutboxDispatcherService(
        { query } as unknown as DataSource,
        {} as ChatAuthorizationService,
        {} as ChatRealtimeReadinessService,
        {} as ChatEventPublisher,
      );
      const event = {
        id: 'event-id',
        attemptCount,
        status: ChatOutboxStatus.PROCESSING,
      } as ChatOutboxEvent;

      await (
        dispatcher as unknown as {
          markFailed(value: ChatOutboxEvent): Promise<void>;
        }
      ).markFailed(event);

      const [sql, parameters] = query.mock.calls[0];
      expect(sql).toContain(expectedStatusSql);
      expect(sql).not.toContain('SET status = $2');
      expect(parameters).toEqual(expectedParameters);
    },
  );
});
