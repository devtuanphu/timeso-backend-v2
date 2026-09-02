import { randomUUID } from 'crypto';
import { join } from 'path';
import type { Server } from 'socket.io';
import { DataSource } from 'typeorm';

import { ChatAuthorizationService } from '../src/modules/chat-groups/chat-authorization.service';
import { ChatOutboxDispatcherService } from '../src/modules/chat-groups/chat-outbox-dispatcher.service';
import { ChatRealtimeReadinessService } from '../src/modules/chat-groups/chat-realtime-readiness.service';
import { ChatRealtimeConfig } from '../src/modules/chat-groups/chat-realtime.config';
import { ChatSingleInstanceRuntimeGuardService } from '../src/modules/chat-groups/chat-single-instance-runtime-guard.service';
import { ChatGroupMember } from '../src/modules/chat-groups/entities/chat-group-member.entity';
import { ChatGroup } from '../src/modules/chat-groups/entities/chat-group.entity';
import { LocalSocketChatEventPublisher } from '../src/modules/chat-groups/local-socket-chat-event-publisher';
import { Account } from '../src/modules/accounts/entities/account.entity';
import { EmployeeProfile } from '../src/modules/stores/entities/employee-profile.entity';
import { Store } from '../src/modules/stores/entities/store.entity';
import {
  describeWithIsolatedChatDatabase,
  guardedChatDatabaseUrl,
  IsolatedChatPgHarness,
} from './chat-isolated-pg-harness';
import {
  OwnedChatBackend,
  startOwnedChatBackend,
  stopOwnedChatBackend,
} from './chat-owned-app';
import {
  ReservedChatFixture,
  reserveOwnedChatFixture,
  SeededChatFixture,
  seedOwnedChatFixture,
  teardownOwnedChatFixture,
} from './chat-owned-fixture';

const realtimeConfig: ChatRealtimeConfig = {
  legacyConnectionEnabled: false,
  legacyMutationEnabled: false,
  legacyWindowStartedAt: null,
  legacyCutoffAt: null,
  singletonGuardMode: 'required',
};

describeWithIsolatedChatDatabase(
  'Chat production outbox/singleton PostgreSQL E2E',
  () => {
    let reservation: ReservedChatFixture;
    let fixture: SeededChatFixture;
    let bootstrap: OwnedChatBackend;
    let harness: IsolatedChatPgHarness;
    let dataSource: DataSource;
    let secondDataSource: DataSource | undefined;
    let readiness: ChatRealtimeReadinessService;
    let dispatcher: ChatOutboxDispatcherService;
    let fakeServer: CapturingServer;

    beforeAll(async () => {
      reservation = await reserveOwnedChatFixture();
      bootstrap = await startOwnedChatBackend(reservation);
      fixture = await seedOwnedChatFixture(reservation);
      await stopOwnedChatBackend(bootstrap);

      harness = new IsolatedChatPgHarness(reservation.schema);
      dataSource = await createOwnedDataSource(reservation.schema);
      const authorization = new ChatAuthorizationService(
        dataSource.getRepository(ChatGroup),
        dataSource.getRepository(ChatGroupMember),
        dataSource.getRepository(Store),
        dataSource.getRepository(EmployeeProfile),
        dataSource.getRepository(Account),
      );
      readiness = new ChatRealtimeReadinessService(realtimeConfig);
      fakeServer = new CapturingServer();
      readiness.attach('v2', fakeServer as unknown as Server);
      readiness.setActive(true);
      dispatcher = new ChatOutboxDispatcherService(
        dataSource,
        authorization,
        readiness,
        new LocalSocketChatEventPublisher(readiness),
      );
      dispatcher.start();
    }, 45_000);

    beforeEach(async () => {
      fakeServer.fail = false;
      fakeServer.emissions.length = 0;
      await harness.query('DELETE FROM chat_outbox_events');
      await harness.query(
        'DELETE FROM chat_messages WHERE client_message_id IS NOT NULL',
      );
      await harness.query(
        `UPDATE chat_group_members SET status='active',deleted_at=NULL
        WHERE group_id=$1 AND account_id IN ($2,$3)`,
        [fixture.groupId, fixture.ownerId, fixture.staffId],
      );
    });

    afterEach(() => {
      expect(connectedQueryRunnerCount(dataSource)).toBe(0);
      if (secondDataSource) {
        expect(connectedQueryRunnerCount(secondDataSource)).toBe(0);
      }
    });

    afterAll(async () => {
      dispatcher?.stop();
      readiness?.detach('v2', fakeServer as unknown as Server);
      await secondDataSource?.destroy();
      await dataSource?.destroy();
      await harness?.pool.end();
      await stopOwnedChatBackend(bootstrap);
      if (reservation) await teardownOwnedChatFixture(reservation);
    }, 15_000);

    it('uses the production SKIP LOCKED claim and later publishes the locked row', async () => {
      const firstId = await insertMessageEvent('first');
      const secondId = await insertMessageEvent('second');
      const locker = await harness.connect();
      try {
        await locker.query('BEGIN');
        await locker.query(
          'SELECT id FROM chat_outbox_events WHERE id=$1 FOR UPDATE',
          [firstId],
        );
        await dispatcher.dispatchOnce();
        expect(await eventStatus(secondId)).toBe('published');
        expect(await eventStatus(firstId)).toBe('pending');
        await locker.query('COMMIT');
        await dispatcher.dispatchOnce();
        expect(await eventStatus(firstId)).toBe('published');
      } finally {
        await locker.query('ROLLBACK').catch(() => undefined);
        locker.release();
      }
    });

    it('uses production retry/lease recovery and bounded attempt accounting', async () => {
      const eventId = await insertMessageEvent('retry');
      fakeServer.fail = true;
      await dispatcher.dispatchOnce();
      expect(await eventState(eventId)).toMatchObject({
        status: 'pending',
        attempt_count: 1,
      });

      await harness.query(
        `UPDATE chat_outbox_events
          SET status='processing',attempt_count=1,locked_at=now()-interval '31 seconds'
        WHERE id=$1`,
        [eventId],
      );
      fakeServer.fail = false;
      await dispatcher.dispatchOnce();
      expect(await eventState(eventId)).toMatchObject({
        status: 'published',
        attempt_count: 2,
      });
    });

    it('reauthorizes recipients at dispatch and excludes a revoked staff member', async () => {
      const eventId = await insertMessageEvent('revoke');
      await harness.query(
        `UPDATE chat_group_members SET status='removed'
        WHERE group_id=$1 AND account_id=$2`,
        [fixture.groupId, fixture.staffId],
      );
      await dispatcher.dispatchOnce();
      expect(await eventStatus(eventId)).toBe('published');
      const rooms = fakeServer.emissions.map((event) => event.room);
      expect(rooms).toContain(`account:${fixture.ownerId}`);
      expect(rooms).not.toContain(`account:${fixture.staffId}`);
    });

    it('uses production singleton services for contention and graceful handoff', async () => {
      const alternateDataSource = await getSecondDataSource();
      const first = new ChatSingleInstanceRuntimeGuardService(
        dataSource,
        realtimeConfig,
      );
      const second = new ChatSingleInstanceRuntimeGuardService(
        alternateDataSource,
        realtimeConfig,
      );
      try {
        await first.acquireBeforeListen();
        await expect(second.acquireBeforeListen()).rejects.toThrow(
          'CHAT_SINGLETON_ALREADY_ACTIVE',
        );
        await first.release();
        await second.acquireBeforeListen();
        expect(second.isHeld()).toBe(true);
      } finally {
        await first.release();
        await second.release();
      }
    });

    it('runs the production health check fail-closed after its dedicated session is lost', async () => {
      const alternateDataSource = await getSecondDataSource();
      const guard = new ChatSingleInstanceRuntimeGuardService(
        dataSource,
        realtimeConfig,
      );
      const replacement = new ChatSingleInstanceRuntimeGuardService(
        alternateDataSource,
        realtimeConfig,
      );
      const onLost = jest.fn();
      try {
        await guard.acquireBeforeListen();
        const runner = (
          guard as unknown as {
            runner: { query(sql: string): Promise<Array<{ pid: number }>> };
          }
        ).runner;
        const [{ pid }] = await runner.query(
          'SELECT pg_backend_pid()::int pid',
        );
        await alternateDataSource.query('SELECT pg_terminate_backend($1)', [
          pid,
        ]);
        await (
          guard as unknown as {
            checkHealth(callback: () => void): Promise<void>;
          }
        ).checkHealth(onLost);
        expect(onLost).toHaveBeenCalledTimes(1);
        expect(guard.isHeld()).toBe(false);
        await replacement.acquireBeforeListen();
        expect(replacement.isHeld()).toBe(true);
      } finally {
        await guard.release();
        await replacement.release();
      }
    });

    async function insertMessageEvent(content: string): Promise<string> {
      const messageId = randomUUID();
      const clientMessageId = randomUUID();
      const message = await harness.query<{ sequence: string }>(
        `INSERT INTO chat_messages(
         id,group_id,sender_id,client_message_id,content,message_type,read_by,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,'text',$6,now(),now()) RETURNING sequence`,
        [
          messageId,
          fixture.groupId,
          fixture.ownerId,
          clientMessageId,
          content,
          fixture.ownerId,
        ],
      );
      const eventId = randomUUID();
      await harness.query(
        `INSERT INTO chat_outbox_events(
         id,event_type,group_id,message_id,actor_account_id,sequence,status,attempt_count,
         available_at,created_at,updated_at
       ) VALUES($1,'MESSAGE_CREATED_V1',$2,$3,$4,$5,'pending',0,now(),now(),now())`,
        [
          eventId,
          fixture.groupId,
          messageId,
          fixture.ownerId,
          message.rows[0].sequence,
        ],
      );
      return eventId;
    }

    async function eventStatus(id: string): Promise<string> {
      return (await eventState(id)).status;
    }

    async function eventState(id: string) {
      const result = await harness.query<{
        status: string;
        attempt_count: number;
      }>('SELECT status,attempt_count FROM chat_outbox_events WHERE id=$1', [
        id,
      ]);
      return result.rows[0];
    }

    async function getSecondDataSource(): Promise<DataSource> {
      secondDataSource ||= await createOwnedDataSource(reservation.schema);
      return secondDataSource;
    }
  },
);

class CapturingServer {
  fail = false;
  readonly emissions: Array<{ room: string; event: string }> = [];

  to(room: string) {
    return {
      emit: (event: string) => {
        if (this.fail) throw new Error('TEST_PUBLISH_FAILURE');
        this.emissions.push({ room, event });
      },
    };
  }
}

async function createOwnedDataSource(schema: string): Promise<DataSource> {
  if (!guardedChatDatabaseUrl)
    throw new Error('CHAT_E2E_DATABASE_GUARD_NOT_ENABLED');
  return new DataSource({
    type: 'postgres',
    url: guardedChatDatabaseUrl,
    schema,
    entities: [join(process.cwd(), 'src', '**', '*.entity.ts')],
    synchronize: false,
    extra: { options: `-c search_path=${schema},public` },
  }).initialize();
}

function connectedQueryRunnerCount(dataSource: DataSource): number {
  return (
    dataSource.driver as unknown as {
      connectedQueryRunners: unknown[];
    }
  ).connectedQueryRunners.length;
}
