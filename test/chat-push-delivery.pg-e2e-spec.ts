import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { DataSource, EntitySchema } from 'typeorm';

import { ChatAuthorizationService } from '../src/modules/chat-groups/chat-authorization.service';
import { ChatMessageQueryService } from '../src/modules/chat-groups/chat-message-query.service';
import { ChatPushDispatcherService } from '../src/modules/chat-groups/chat-push-dispatcher.service';
import { ChatPushReceiptDispatcherService } from '../src/modules/chat-groups/chat-push-receipt-dispatcher.service';
import { ChatRealtimeConfig } from '../src/modules/chat-groups/chat-realtime.config';
import { ChatRealtimeReadinessService } from '../src/modules/chat-groups/chat-realtime-readiness.service';
import { DevicesService } from '../src/modules/devices/devices.service';
import { UserDevice } from '../src/modules/devices/entities/user-device.entity';
import { ExpoPushService } from '../src/modules/push/expo-push.service';

import {
  describeWithIsolatedChatDatabase,
  guardedChatDatabaseUrl,
  IsolatedChatPgHarness,
} from './chat-isolated-pg-harness';

const readSql = (name: string): string =>
  readFileSync(join(process.cwd(), 'scripts', name), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('\\'))
    .join('\n');

const readSqlPhases = (name: string): string[] =>
  readSql(name)
    .split(/^-- migration-phase:.*$/m)
    .map((phase) => phase.trim())
    .filter(Boolean);

describeWithIsolatedChatDatabase(
  'Chat push delivery PostgreSQL invariants',
  () => {
    let harness: IsolatedChatPgHarness;

    beforeEach(async () => {
      harness = new IsolatedChatPgHarness();
      await harness.createSchema();
      await harness.query(`
      CREATE TABLE accounts(id uuid PRIMARY KEY);
      CREATE TABLE stores(id uuid PRIMARY KEY);
      CREATE TABLE chat_groups(id uuid PRIMARY KEY);
      CREATE TABLE chat_messages(
        id uuid PRIMARY KEY,
        group_id uuid NOT NULL REFERENCES chat_groups(id),
        sender_id uuid NOT NULL REFERENCES accounts(id),
        sequence bigint
      );
      CREATE TABLE user_devices(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar,
        device_id varchar NOT NULL UNIQUE,
        expo_push_token varchar NOT NULL,
        platform varchar NOT NULL,
        app_version varchar,
        is_active boolean NOT NULL DEFAULT true,
        last_seen_at timestamp,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE TABLE chat_outbox_events(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type varchar(32) NOT NULL,
        group_id uuid NOT NULL REFERENCES chat_groups(id),
        message_id uuid REFERENCES chat_messages(id),
        actor_account_id uuid REFERENCES accounts(id),
        sequence bigint,
        status varchar(16) NOT NULL DEFAULT 'pending',
        attempt_count integer NOT NULL DEFAULT 0,
        available_at timestamptz NOT NULL DEFAULT now(),
        locked_at timestamptz,
        published_at timestamptz,
        dead_at timestamptz,
        error_code varchar(64),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);
    });

    afterEach(async () => harness.cleanup());

    const applyExpand = async (repetitions = 1): Promise<void> => {
      const phases = readSqlPhases('migration_chat_push_delivery_expand.sql');
      const client = await harness.connect();
      try {
        for (let run = 0; run < repetitions; run += 1) {
          for (const phase of phases) await client.query(phase);
        }
      } finally {
        client.release();
      }
    };

    const createDataSource = async (
      entities: (string | Function | EntitySchema<any>)[] = [],
    ): Promise<DataSource> => {
      if (!guardedChatDatabaseUrl)
        throw new Error('CHAT_E2E_DATABASE_GUARD_NOT_ENABLED');
      return new DataSource({
        type: 'postgres',
        url: guardedChatDatabaseUrl,
        schema: harness.schema,
        entities,
        synchronize: false,
        extra: { options: `-c search_path=${harness.schema},public` },
      }).initialize();
    };

    const seedDelivery = async (options?: {
      status?: 'pending' | 'processing' | 'ticket_accepted' | 'delivered';
      claimToken?: string | null;
      expoTicketId?: string | null;
      lockedAtSql?: string;
      createdAtSql?: string;
    }) => {
      const senderId = randomUUID();
      const recipientId = randomUUID();
      const groupId = randomUUID();
      const messageId = randomUUID();
      const userDeviceId = randomUUID();
      const deliveryId = randomUUID();
      const fingerprint = randomUUID().replace(/-/g, '').repeat(2);
      await harness.query('INSERT INTO accounts(id) VALUES ($1), ($2)', [
        senderId,
        recipientId,
      ]);
      await harness.query('INSERT INTO chat_groups(id) VALUES ($1)', [groupId]);
      await harness.query(
        'INSERT INTO chat_messages(id, group_id, sender_id, sequence) VALUES ($1, $2, $3, 1)',
        [messageId, groupId, senderId],
      );
      await harness.query(
        `INSERT INTO user_devices(
         id,user_id,device_id,expo_push_token,platform,push_token_fingerprint,registration_version
       ) VALUES ($1,$2,$3,$4,'ios',$5,1)`,
        [
          userDeviceId,
          recipientId,
          `installation-${userDeviceId}`,
          'ExpoPushToken[private]',
          fingerprint,
        ],
      );
      await harness.query(
        `INSERT INTO chat_push_deliveries(
         id,message_id,group_id,intended_account_id,user_device_id,
         expected_device_id,expected_token_fingerprint,expected_registration_version,
         status,claim_token,locked_at,expo_ticket_id,ticket_accepted_at,
         receipt_available_at,delivered_at,created_at,updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,1,$8,$9,
         ${options?.lockedAtSql || 'NULL'},$10,
         CASE WHEN $10::varchar IS NULL THEN NULL ELSE NOW() - INTERVAL '20 minutes' END,
         CASE WHEN $10::varchar IS NULL THEN NULL ELSE NOW() - INTERVAL '1 minute' END,
         CASE WHEN $8::varchar = 'delivered' THEN NOW() - INTERVAL '15 days' ELSE NULL END,
         ${options?.createdAtSql || 'NOW()'},NOW()
       )`,
        [
          deliveryId,
          messageId,
          groupId,
          recipientId,
          userDeviceId,
          `installation-${userDeviceId}`,
          fingerprint,
          options?.status || 'pending',
          options?.claimToken || null,
          options?.expoTicketId || null,
        ],
      );
      return {
        senderId,
        recipientId,
        groupId,
        messageId,
        userDeviceId,
        deliveryId,
        fingerprint,
        deviceId: `installation-${userDeviceId}`,
      };
    };

    it('rehearses the retry-safe expand and enforces device/delivery deduplication', async () => {
      await applyExpand(2);

      const senderId = randomUUID();
      const recipientId = randomUUID();
      const groupId = randomUUID();
      const messageId = randomUUID();
      const deviceId = randomUUID();
      const fingerprint = 'a'.repeat(64);
      await harness.query('INSERT INTO accounts(id) VALUES ($1), ($2)', [
        senderId,
        recipientId,
      ]);
      await harness.query('INSERT INTO stores(id) VALUES ($1)', [randomUUID()]);
      await harness.query('INSERT INTO chat_groups(id) VALUES ($1)', [groupId]);
      await harness.query(
        'INSERT INTO chat_messages(id, group_id, sender_id) VALUES ($1, $2, $3)',
        [messageId, groupId, senderId],
      );
      await harness.query(
        `INSERT INTO user_devices(
         id,user_id,device_id,expo_push_token,platform,push_token_fingerprint,registration_version
       ) VALUES ($1,$2,$3,$4,'ios',$5,1)`,
        [
          deviceId,
          recipientId,
          'installation-1',
          'ExpoPushToken[private]',
          fingerprint,
        ],
      );
      await harness.query(
        `INSERT INTO chat_push_deliveries(
         message_id,group_id,intended_account_id,user_device_id,
         expected_device_id,expected_token_fingerprint,expected_registration_version
       ) VALUES ($1,$2,$3,$4,'installation-1',$5,1)`,
        [messageId, groupId, recipientId, deviceId, fingerprint],
      );

      await expect(
        harness.query(
          `INSERT INTO chat_push_deliveries(
           message_id,group_id,intended_account_id,user_device_id,
           expected_device_id,expected_token_fingerprint,expected_registration_version
         ) VALUES ($1,$2,$3,$4,'installation-1',$5,1)`,
          [messageId, groupId, recipientId, deviceId, fingerprint],
        ),
      ).rejects.toMatchObject({ code: '23505' });

      await expect(
        harness.query(
          `INSERT INTO user_devices(
           user_id,device_id,expo_push_token,platform,push_token_fingerprint,registration_version
         ) VALUES ($1,'installation-2','ExpoPushToken[other]','ios',$2,1)`,
          [recipientId, fingerprint],
        ),
      ).rejects.toMatchObject({ code: '23505' });

      await expect(
        harness.query(readSql('verify_chat_push_delivery.sql')),
      ).resolves.toBeDefined();
    });

    it('persists an accepted ticket through real TypeORM UPDATE tuples without a timestamp fence', async () => {
      await applyExpand();
      const claimToken = randomUUID();
      const seeded = await seedDelivery({
        status: 'processing',
        claimToken,
        lockedAtSql: "'2026-09-07T00:00:00.123456Z'::timestamptz",
      });
      const dataSource = await createDataSource();
      const sendDeviceNotification = jest.fn().mockResolvedValue({
        outcome: 'accepted',
        ticketId: 'ticket-accepted-id',
      });
      const service = createPushDispatcher(dataSource, sendDeviceNotification);
      try {
        await (service as any).dispatch({
          id: seeded.deliveryId,
          messageId: seeded.messageId,
          groupId: seeded.groupId,
          intendedAccountId: seeded.recipientId,
          userDeviceId: seeded.userDeviceId,
          expectedDeviceId: seeded.deviceId,
          expectedTokenFingerprint: seeded.fingerprint,
          expectedRegistrationVersion: '1',
          senderAccountId: seeded.senderId,
          sequence: '1',
          claimToken,
          attemptCount: 1,
        });
        expect(sendDeviceNotification).toHaveBeenCalledTimes(1);
        const row = await harness.query<{
          status: string;
          expo_ticket_id: string;
        }>(
          'SELECT status,expo_ticket_id FROM chat_push_deliveries WHERE id=$1',
          [seeded.deliveryId],
        );
        expect(row.rows[0]).toEqual({
          status: 'ticket_accepted',
          expo_ticket_id: 'ticket-accepted-id',
        });
      } finally {
        await dataSource.destroy();
      }
    });

    it.each([false, true])(
      'never resends a known accepted ticket after DB failure (ownership loss: %s)',
      async (loseOwnership) => {
        await applyExpand();
        const seeded = await seedDelivery();
        const dataSource = await createDataSource();
        const send = jest
          .fn()
          .mockResolvedValue({ outcome: 'accepted', ticketId: 'known-ticket' });
        const service = createPushDispatcher(dataSource, send);
        const persistence = jest
          .spyOn(service as any, 'recordResult')
          .mockRejectedValueOnce(new Error('database unavailable'));
        try {
          await service.dispatchOnce();
          expect(send).toHaveBeenCalledTimes(1);
          expect(service.getRecoveryStatus().pending).toBe(1);
          if (loseOwnership)
            await harness.query(
              'UPDATE chat_push_deliveries SET claim_token=$2 WHERE id=$1',
              [seeded.deliveryId, randomUUID()],
            );
          await service.dispatchOnce();
          expect(send).toHaveBeenCalledTimes(1);
          expect(service.getRecoveryStatus()).toEqual({
            pending: loseOwnership ? 1 : 0,
            reconciliationRequired: loseOwnership,
          });
          const result = await harness.query(
            'SELECT expo_ticket_id FROM chat_push_deliveries WHERE id=$1',
            [seeded.deliveryId],
          );
          expect(result.rows[0].expo_ticket_id).toBe(
            loseOwnership ? null : 'known-ticket',
          );
        } finally {
          persistence.mockRestore();
          await dataSource.destroy();
        }
      },
    );

    it('waits through a provider token lock for register and owned disable', async () => {
      await applyExpand();
      const dataSource = await createDataSource([UserDevice]);
      const devices = new DevicesService(
        dataSource.getRepository(UserDevice),
        dataSource,
      );
      const userId = randomUUID();
      const dto = {
        deviceId: randomUUID(),
        expoPushToken: 'ExpoPushToken[lock-test]',
        platform: 'ios' as const,
      };
      const holder = await harness.connect();
      try {
        await devices.register(userId, dto);
        const device = await dataSource
          .getRepository(UserDevice)
          .findOneByOrFail({ deviceId: dto.deviceId });
        const key = `push:${device.pushTokenFingerprint}`;
        for (const operation of [
          () => devices.register(userId, dto),
          () => devices.disableOwnedDevice(userId, dto.deviceId),
        ]) {
          await holder.query(
            'SELECT pg_advisory_lock(hashtextextended($1,0))',
            [key],
          );
          let finished = false;
          const pending = operation().then(() => {
            finished = true;
          });
          // Keep a rejection observer attached while the real DB lock is held.
          void pending.catch(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, 300));
          expect(finished).toBe(false);
          await holder.query(
            'SELECT pg_advisory_unlock(hashtextextended($1,0))',
            [key],
          );
          await pending;
        }
        expect(
          (
            await dataSource
              .getRepository(UserDevice)
              .findOneByOrFail({ deviceId: dto.deviceId })
          ).isActive,
        ).toBe(false);
      } finally {
        await holder.query('SELECT pg_advisory_unlock_all()');
        holder.release();
        await dataSource.destroy();
      }
    });

    it('makes zero provider requests when a stale claimant cannot renew its exact lease and never lets push reclaim receipt work', async () => {
      await applyExpand();
      const seeded = await seedDelivery({
        status: 'processing',
        claimToken: randomUUID(),
        expoTicketId: 'accepted-ticket',
        lockedAtSql: "NOW() - INTERVAL '1 minute'",
      });
      const dataSource = await createDataSource();
      const sendDeviceNotification = jest.fn();
      const service = createPushDispatcher(dataSource, sendDeviceNotification);
      try {
        await (service as any).dispatch({
          id: seeded.deliveryId,
          messageId: seeded.messageId,
          groupId: seeded.groupId,
          intendedAccountId: seeded.recipientId,
          userDeviceId: seeded.userDeviceId,
          expectedDeviceId: seeded.deviceId,
          expectedTokenFingerprint: seeded.fingerprint,
          expectedRegistrationVersion: '1',
          senderAccountId: seeded.senderId,
          sequence: '1',
          claimToken: randomUUID(),
          attemptCount: 2,
        });
        await service.dispatchOnce();
        expect(sendDeviceNotification).not.toHaveBeenCalled();
      } finally {
        await dataSource.destroy();
      }
    });

    it('reclaims receipt polling after a crash without resending the accepted notification', async () => {
      await applyExpand();
      const seeded = await seedDelivery({
        status: 'processing',
        claimToken: randomUUID(),
        expoTicketId: 'accepted-ticket',
        lockedAtSql: "NOW() - INTERVAL '1 minute'",
      });
      const dataSource = await createDataSource();
      const receipts = jest.fn().mockResolvedValue({
        'accepted-ticket': { outcome: 'delivered' },
      });
      const receiptService = new ChatPushReceiptDispatcherService(
        dataSource,
        { getPushReceipts: receipts } as unknown as ExpoPushService,
        { disableInvalidDevice: jest.fn() } as unknown as DevicesService,
        { isActive: () => true } as ChatRealtimeReadinessService,
        { pushDeliveryEnabled: true } as ChatRealtimeConfig,
      );
      receiptService.start();
      try {
        await receiptService.dispatchOnce();
        expect(receipts).toHaveBeenCalledTimes(1);
        const row = await harness.query<{
          status: string;
          receipt_attempt_count: number;
        }>(
          'SELECT status,receipt_attempt_count FROM chat_push_deliveries WHERE id=$1',
          [seeded.deliveryId],
        );
        expect(row.rows[0]).toEqual({
          status: 'delivered',
          receipt_attempt_count: 1,
        });
      } finally {
        await dataSource.destroy();
      }
    });

    it('keeps one active token owner, preserves unchanged epochs, and fences late invalidation', async () => {
      await applyExpand();
      const dataSource = await createDataSource([UserDevice]);
      const devices = new DevicesService(
        dataSource.getRepository(UserDevice),
        dataSource,
      );
      const token = 'ExpoPushToken[shared-private]';
      const dtoA = {
        deviceId: 'ios-a',
        expoPushToken: token,
        platform: 'ios' as const,
      };
      const dtoB = {
        deviceId: 'ios-b',
        expoPushToken: token,
        platform: 'ios' as const,
      };
      const accountA = randomUUID();
      const accountB = randomUUID();
      try {
        await Promise.all([
          devices.register(accountA, dtoA),
          devices.register(accountB, dtoB),
        ]);
        const active = await dataSource.getRepository(UserDevice).find({
          where: { isActive: true },
        });
        expect(active).toHaveLength(1);
        const owner = active[0];
        const unchanged = await devices.register(owner.userId!, {
          deviceId: owner.deviceId,
          expoPushToken: token,
          platform: 'ios',
        });
        expect(unchanged.registrationVersion).toBe(owner.registrationVersion);

        const lateBinding = {
          id: owner.id,
          userId: owner.userId!,
          deviceId: owner.deviceId,
          pushTokenFingerprint: owner.pushTokenFingerprint!,
          registrationVersion: owner.registrationVersion,
        };
        const newOwner = owner.userId === accountA ? accountB : accountA;
        const rebound = await devices.register(newOwner, {
          deviceId: owner.deviceId,
          expoPushToken: token,
          platform: 'ios',
        });
        expect(BigInt(rebound.registrationVersion)).toBeGreaterThan(
          BigInt(lateBinding.registrationVersion),
        );
        await expect(devices.disableInvalidDevice(lateBinding)).resolves.toBe(
          false,
        );
        expect(
          await dataSource.getRepository(UserDevice).count({
            where: { userId: newOwner, isActive: true },
          }),
        ).toBe(1);
      } finally {
        await dataSource.destroy();
      }
    });

    it('cleans old terminal rows after source retention but preserves a nonterminal source barrier', async () => {
      await applyExpand();
      const withoutSource = await seedDelivery({ status: 'delivered' });
      const withSource = await seedDelivery({ status: 'delivered' });
      await harness.query(
        `INSERT INTO chat_outbox_events(
         event_type,group_id,message_id,actor_account_id,sequence,status,
         push_intent_status,push_intent_available_at
       ) VALUES ('MESSAGE_CREATED_V1',$1,$2,$3,1,'published','pending',NOW())`,
        [withSource.groupId, withSource.messageId, withSource.senderId],
      );
      const dataSource = await createDataSource();
      const receiptService = new ChatPushReceiptDispatcherService(
        dataSource,
        { getPushReceipts: jest.fn() } as unknown as ExpoPushService,
        { disableInvalidDevice: jest.fn() } as unknown as DevicesService,
        { isActive: () => true } as ChatRealtimeReadinessService,
        { pushDeliveryEnabled: true } as ChatRealtimeConfig,
      );
      receiptService.start();
      try {
        await receiptService.cleanupOnce();
        const rows = await harness.query<{ id: string }>(
          'SELECT id FROM chat_push_deliveries ORDER BY id',
        );
        expect(rows.rows.map((row) => row.id)).toEqual([withSource.deliveryId]);
        expect(rows.rows.map((row) => row.id)).not.toContain(
          withoutSource.deliveryId,
        );
      } finally {
        await dataSource.destroy();
      }
    });

    function createPushDispatcher(
      dataSource: DataSource,
      sendDeviceNotification: jest.Mock,
    ): ChatPushDispatcherService {
      const service = new ChatPushDispatcherService(
        dataSource,
        {
          requirePushDeliveryEligibility: jest.fn().mockResolvedValue({
            eligible: true,
            expoPushToken: 'ExpoPushToken[private]',
          }),
        } as unknown as ChatAuthorizationService,
        {
          getTotalUnreadCount: jest.fn().mockResolvedValue({ totalUnread: 3 }),
        } as unknown as ChatMessageQueryService,
        { sendDeviceNotification } as unknown as ExpoPushService,
        { disableInvalidDevice: jest.fn() } as unknown as DevicesService,
        { isActive: () => true } as ChatRealtimeReadinessService,
        { pushDeliveryEnabled: true } as ChatRealtimeConfig,
      );
      service.start();
      return service;
    }
  },
);
