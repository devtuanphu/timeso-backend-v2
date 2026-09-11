import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';

import { DevicesService } from '../devices/devices.service';
import { ExpoPushService, PushDeliveryResult } from '../push/expo-push.service';
import { ChatAuthorizationService } from './chat-authorization.service';
import { ChatMessageQueryService } from './chat-message-query.service';
import {
  CHAT_OUTBOX_POLL_MS,
  CHAT_REALTIME_CONFIG,
  ChatRealtimeConfig,
} from './chat-realtime.config';
import { ChatRealtimeReadinessService } from './chat-realtime-readiness.service';

interface ClaimedDelivery {
  id: string;
  messageId: string;
  groupId: string;
  intendedAccountId: string;
  userDeviceId: string;
  expectedDeviceId: string;
  expectedTokenFingerprint: string;
  expectedRegistrationVersion: string;
  senderAccountId: string;
  sequence: string;
  claimToken: string;
  attemptCount: number;
}

const normalizeRows = <T>(result: T[] | [T[], number]): T[] =>
  Array.isArray(result?.[0]) ? (result[0] as T[]) : (result as T[]);

@Injectable()
export class ChatPushDispatcherService {
  private readonly logger = new Logger(ChatPushDispatcherService.name);
  private running = false;
  private dispatching = false;
  // Bounded by the claim batch. Never evict a known provider acknowledgement.
  // Process loss before persistence still has an unavoidable ambiguous window.
  private readonly knownAccepted = new Map<
    string,
    {
      delivery: ClaimedDelivery;
      ticketId: string;
    }
  >();
  private acknowledgementConflict = false;

  getRecoveryStatus(): { pending: number; reconciliationRequired: boolean } {
    return {
      pending: this.knownAccepted.size,
      reconciliationRequired: this.acknowledgementConflict,
    };
  }

  constructor(
    private readonly dataSource: DataSource,
    private readonly authorization: ChatAuthorizationService,
    private readonly messageQueries: ChatMessageQueryService,
    private readonly expoPush: ExpoPushService,
    private readonly devices: DevicesService,
    private readonly readiness: ChatRealtimeReadinessService,
    @Inject(CHAT_REALTIME_CONFIG) private readonly config: ChatRealtimeConfig,
  ) {}

  start(): void {
    this.running = this.config.pushDeliveryEnabled;
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  @Interval(CHAT_OUTBOX_POLL_MS)
  async dispatchOnce(): Promise<void> {
    if (!this.running || this.dispatching || !this.readiness.isActive()) return;
    this.dispatching = true;
    try {
      if (!(await this.flushKnownAccepted())) return;
      const deliveries = await this.claim();
      for (let index = 0; index < deliveries.length; index += 5) {
        await Promise.all(
          deliveries.slice(index, index + 5).map((item) => this.dispatch(item)),
        );
      }
    } catch {
      this.logger.warn('Chat push delivery cycle failed');
    } finally {
      this.dispatching = false;
    }
  }

  private async claim(): Promise<ClaimedDelivery[]> {
    const claimToken = randomUUID();
    const raw = await this.dataSource.query(
      `WITH candidates AS (
         SELECT delivery.id
         FROM chat_push_deliveries delivery
         WHERE delivery.expo_ticket_id IS NULL
           AND ((delivery.status = 'pending' AND delivery.available_at <= NOW())
             OR (delivery.status = 'processing'
                 AND delivery.locked_at < NOW() - INTERVAL '30 seconds'))
           AND delivery.deleted_at IS NULL
         ORDER BY delivery.available_at ASC, delivery.created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 5
       )
       UPDATE chat_push_deliveries delivery
       SET status = 'processing', locked_at = NOW(), claim_token = $1,
           attempt_count = delivery.attempt_count + 1, updated_at = NOW()
       FROM candidates, chat_messages message
       WHERE delivery.id = candidates.id AND message.id = delivery.message_id
       RETURNING delivery.id,
                 delivery.message_id AS "messageId",
                 delivery.group_id AS "groupId",
                 delivery.intended_account_id AS "intendedAccountId",
                 delivery.user_device_id AS "userDeviceId",
                 delivery.expected_device_id AS "expectedDeviceId",
                 delivery.expected_token_fingerprint AS "expectedTokenFingerprint",
                 delivery.expected_registration_version::text AS "expectedRegistrationVersion",
                 message.sender_id AS "senderAccountId",
                 message.sequence::text AS sequence,
                 delivery.claim_token AS "claimToken",
                 delivery.attempt_count AS "attemptCount"`,
      [claimToken],
    );
    return normalizeRows<ClaimedDelivery>(raw).map((row) => ({
      ...row,
      attemptCount: Number(row.attemptCount),
    }));
  }

  private async dispatch(delivery: ClaimedDelivery): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    let advisoryHeld = false;
    let invalidDevice = false;
    try {
      advisoryHeld = await this.tryAcquireTokenLock(runner, delivery);
      if (!advisoryHeld) {
        await this.markRetry(runner, delivery, 'TOKEN_BINDING_BUSY');
        return;
      }
      if (!this.isReady() || !(await this.renewClaim(runner, delivery))) return;

      const eligibility =
        await this.authorization.requirePushDeliveryEligibility(
          delivery,
          runner.manager,
        );
      if (!eligibility.eligible) {
        await this.markSuppressed(runner, delivery, eligibility.reason);
        return;
      }

      const { totalUnread } = await this.messageQueries.getTotalUnreadCount(
        delivery.intendedAccountId,
        runner.manager,
      );
      // This is the last database action before the provider request. A claimant
      // whose lease was reclaimed while it waited for the token lock cannot send.
      if (!this.isReady() || !(await this.renewClaim(runner, delivery))) return;
      const result = await this.expoPush.sendDeviceNotification({
        to: eligibility.expoPushToken,
        title: 'Tin nhắn mới',
        body: 'Bạn có tin nhắn mới trong Timeso',
        sound: 'default',
        badge: totalUnread,
        priority: 'high',
        channelId: 'default',
        data: {
          type: 'CHAT_MESSAGE',
          version: 1,
          groupId: delivery.groupId,
          messageId: delivery.messageId,
          sequence: delivery.sequence,
          deliveryId: delivery.id,
        },
      });
      if (result.outcome === 'accepted') {
        this.knownAccepted.set(delivery.id, {
          delivery,
          ticketId: result.ticketId,
        });
        await this.persistKnownAccepted(runner, delivery.id);
        return;
      }
      const recorded = await this.recordResult(runner, delivery, result);
      invalidDevice =
        recorded && result.outcome === 'permanent' && result.deviceInvalid;
    } catch {
      if (!this.knownAccepted.has(delivery.id)) {
        await this.markRetry(runner, delivery, 'DELIVERY_ATTEMPT_FAILED').catch(
          () => undefined,
        );
      }
    } finally {
      if (advisoryHeld) {
        await runner
          .query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [
            `push:${delivery.expectedTokenFingerprint}`,
          ])
          .catch(() => undefined);
      }
      await runner.release().catch(() => undefined);
    }
    // Never wait for a device-row lock while holding the token advisory lock.
    // Registration can then finish and the binding epoch CAS protects a new owner.
    if (invalidDevice) {
      await this.devices.disableInvalidDevice({
        id: delivery.userDeviceId,
        userId: delivery.intendedAccountId,
        deviceId: delivery.expectedDeviceId,
        pushTokenFingerprint: delivery.expectedTokenFingerprint,
        registrationVersion: delivery.expectedRegistrationVersion,
      });
    }
  }

  private async flushKnownAccepted(): Promise<boolean> {
    if (this.acknowledgementConflict) return false;
    for (const id of this.knownAccepted.keys()) {
      const runner = this.dataSource.createQueryRunner();
      try {
        await runner.connect();
        await this.persistKnownAccepted(runner, id);
      } catch {
        // Keep the ticket; the next cycle retries persistence, never provider send.
      } finally {
        await runner.release().catch(() => undefined);
      }
    }
    return this.knownAccepted.size === 0 && !this.acknowledgementConflict;
  }

  private async persistKnownAccepted(
    runner: QueryRunner,
    id: string,
  ): Promise<void> {
    const entry = this.knownAccepted.get(id);
    if (!entry || this.acknowledgementConflict) return;
    if (
      await this.recordResult(runner, entry.delivery, {
        outcome: 'accepted',
        ticketId: entry.ticketId,
      })
    ) {
      this.knownAccepted.delete(id);
      return;
    }
    const rows = (await runner.query(
      'SELECT status, claim_token, expo_ticket_id FROM chat_push_deliveries WHERE id = $1',
      [id],
    )) as Array<{
      status: string;
      claim_token: string | null;
      expo_ticket_id: string | null;
    }>;
    const row = rows[0];
    if (row?.expo_ticket_id === entry.ticketId) {
      this.knownAccepted.delete(id);
    } else if (
      !(
        row?.status === 'processing' &&
        row.claim_token === entry.delivery.claimToken &&
        row.expo_ticket_id === null
      )
    ) {
      this.acknowledgementConflict = true;
      this.logger.error('CHAT_PUSH_ACK_RECONCILIATION_REQUIRED');
    }
  }

  private async recordResult(
    runner: QueryRunner,
    delivery: ClaimedDelivery,
    result: PushDeliveryResult,
  ): Promise<boolean> {
    if (result.outcome === 'accepted') {
      return this.runFencedUpdate(
        runner,
        `UPDATE chat_push_deliveries
         SET status = 'ticket_accepted', expo_ticket_id = $3,
             ticket_accepted_at = NOW(), receipt_available_at = NOW() + INTERVAL '15 minutes',
             locked_at = NULL, claim_token = NULL, error_code = NULL, updated_at = NOW()
         WHERE id = $1 AND status = 'processing' AND claim_token = $2
           AND expo_ticket_id IS NULL
         RETURNING id`,
        [delivery.id, delivery.claimToken, result.ticketId],
      );
    }
    if (result.outcome === 'permanent') {
      return this.markDead(runner, delivery, result.errorCode);
    }
    return this.markRetry(runner, delivery, result.errorCode);
  }

  private async markSuppressed(
    runner: QueryRunner,
    delivery: ClaimedDelivery,
    reason: string,
  ): Promise<boolean> {
    return this.runFencedUpdate(
      runner,
      `UPDATE chat_push_deliveries
       SET status = 'suppressed', suppressed_at = NOW(), error_code = $3,
           locked_at = NULL, claim_token = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'processing' AND claim_token = $2
         AND expo_ticket_id IS NULL
       RETURNING id`,
      [delivery.id, delivery.claimToken, reason],
    );
  }

  private async markDead(
    runner: QueryRunner,
    delivery: ClaimedDelivery,
    code: string,
  ): Promise<boolean> {
    return this.runFencedUpdate(
      runner,
      `UPDATE chat_push_deliveries
       SET status = 'dead', dead_at = NOW(), error_code = $3,
           locked_at = NULL, claim_token = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'processing' AND claim_token = $2
         AND expo_ticket_id IS NULL
       RETURNING id`,
      [delivery.id, delivery.claimToken, code],
    );
  }

  private async markRetry(
    runner: QueryRunner,
    delivery: ClaimedDelivery,
    code: string,
  ): Promise<boolean> {
    if (delivery.attemptCount >= 20) {
      return this.markDead(runner, delivery, 'DELIVERY_RETRY_EXHAUSTED');
    }
    const delay = Math.min(
      1_000 * 2 ** Math.max(delivery.attemptCount - 1, 0),
      60_000,
    );
    return this.runFencedUpdate(
      runner,
      `UPDATE chat_push_deliveries
       SET status = 'pending', available_at = NOW() + ($3 * INTERVAL '1 millisecond'),
           error_code = $4, locked_at = NULL, claim_token = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'processing' AND claim_token = $2
         AND expo_ticket_id IS NULL
       RETURNING id`,
      [delivery.id, delivery.claimToken, delay, code],
    );
  }

  private async tryAcquireTokenLock(
    runner: QueryRunner,
    delivery: ClaimedDelivery,
  ): Promise<boolean> {
    const rows = (await runner.query(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [`push:${delivery.expectedTokenFingerprint}`],
    )) as Array<{ acquired: boolean }>;
    return rows[0]?.acquired === true;
  }

  private async renewClaim(
    runner: QueryRunner,
    delivery: ClaimedDelivery,
  ): Promise<boolean> {
    return this.runFencedUpdate(
      runner,
      `UPDATE chat_push_deliveries
       SET locked_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'processing' AND claim_token = $2
         AND expo_ticket_id IS NULL
       RETURNING id`,
      [delivery.id, delivery.claimToken],
    );
  }

  private async runFencedUpdate(
    runner: QueryRunner,
    query: string,
    parameters: unknown[],
  ): Promise<boolean> {
    const raw = await runner.query(query, parameters);
    return normalizeRows<{ id: string }>(raw).length === 1;
  }

  private isReady(): boolean {
    return this.running && this.readiness.isActive();
  }
}
