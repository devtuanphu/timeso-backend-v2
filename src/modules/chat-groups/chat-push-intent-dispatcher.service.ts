import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { ChatAuthorizationService } from './chat-authorization.service';
import {
  CHAT_OUTBOX_POLL_MS,
  CHAT_REALTIME_CONFIG,
  ChatRealtimeConfig,
} from './chat-realtime.config';
import { ChatRealtimeReadinessService } from './chat-realtime-readiness.service';

interface ClaimedPushIntent {
  id: string;
  messageId: string;
  groupId: string;
  actorAccountId: string;
  claimToken: string;
  attemptCount: number;
}

const normalizeRows = <T>(result: T[] | [T[], number]): T[] =>
  Array.isArray(result?.[0]) ? (result[0] as T[]) : (result as T[]);

@Injectable()
export class ChatPushIntentDispatcherService {
  private readonly logger = new Logger(ChatPushIntentDispatcherService.name);
  private running = false;
  private dispatching = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly authorization: ChatAuthorizationService,
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

  isConfigured(): boolean {
    return this.config.pushDeliveryEnabled;
  }

  async prepare(): Promise<boolean> {
    if (!this.config.pushDeliveryEnabled) return false;
    try {
      const rows = await this.dataSource.query(
        `SELECT to_regclass('chat_push_deliveries') IS NOT NULL AS "hasLedger",
                EXISTS (
                  SELECT 1 FROM information_schema.columns
                  WHERE table_schema = current_schema()
                    AND table_name = 'user_devices'
                    AND column_name = 'push_token_fingerprint'
                ) AS "hasDeviceBinding",
                EXISTS (
                  SELECT 1 FROM information_schema.columns
                  WHERE table_schema = current_schema()
                    AND table_name = 'chat_outbox_events'
                    AND column_name = 'push_intent_status'
                ) AS "hasPushIntent"`,
      );
      return Boolean(
        rows[0]?.hasLedger &&
        rows[0]?.hasDeviceBinding &&
        rows[0]?.hasPushIntent,
      );
    } catch {
      return false;
    }
  }

  @Interval(CHAT_OUTBOX_POLL_MS)
  async dispatchOnce(): Promise<void> {
    if (!this.running || this.dispatching || !this.readiness.isActive()) return;
    this.dispatching = true;
    try {
      const events = await this.claim();
      for (const event of events) await this.materialize(event);
    } catch {
      this.logger.warn('Chat push intent dispatch cycle failed');
    } finally {
      this.dispatching = false;
    }
  }

  private async claim(): Promise<ClaimedPushIntent[]> {
    const claimToken = randomUUID();
    const raw = await this.dataSource.query(
      `WITH candidates AS (
         SELECT id
         FROM chat_outbox_events
         WHERE event_type = 'MESSAGE_CREATED_V1'
           AND ((push_intent_status = 'pending' AND push_intent_available_at <= NOW())
             OR (push_intent_status = 'processing'
                 AND push_intent_locked_at < NOW() - INTERVAL '30 seconds'))
           AND deleted_at IS NULL
         ORDER BY push_intent_available_at ASC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 50
       )
       UPDATE chat_outbox_events event
       SET push_intent_status = 'processing',
           push_intent_locked_at = NOW(),
           push_intent_claim_token = $1,
           push_intent_attempt_count = event.push_intent_attempt_count + 1,
           updated_at = NOW()
       FROM candidates
       WHERE event.id = candidates.id
       RETURNING event.id,
                 event.message_id AS "messageId",
                 event.group_id AS "groupId",
                 event.actor_account_id AS "actorAccountId",
                 event.push_intent_claim_token AS "claimToken",
                 event.push_intent_attempt_count AS "attemptCount"`,
      [claimToken],
    );
    return normalizeRows<ClaimedPushIntent>(raw).map((row) => ({
      ...row,
      attemptCount: Number(row.attemptCount),
    }));
  }

  private async materialize(event: ClaimedPushIntent): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const locked = await manager.query(
          `SELECT id FROM chat_outbox_events
           WHERE id = $1 AND push_intent_status = 'processing'
             AND push_intent_claim_token = $2
           FOR UPDATE`,
          [event.id, event.claimToken],
        );
        if (locked.length === 0) return;

        const devices = await this.authorization.getEligiblePushDevices(
          event.groupId,
          event.actorAccountId,
          manager,
        );
        for (const device of devices) {
          await manager.query(
            `INSERT INTO chat_push_deliveries (
               message_id, group_id, intended_account_id, user_device_id,
               expected_device_id, expected_token_fingerprint,
               expected_registration_version, status, available_at,
               created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7::bigint, 'pending', NOW(), NOW(), NOW())
             ON CONFLICT DO NOTHING`,
            [
              event.messageId,
              event.groupId,
              device.accountId,
              device.userDeviceId,
              device.deviceId,
              device.tokenFingerprint,
              device.registrationVersion,
            ],
          );
        }
        const completed = await manager.query(
          `UPDATE chat_outbox_events
           SET push_intent_status = 'completed', push_intent_locked_at = NULL,
               push_intent_claim_token = NULL, push_intent_error_code = NULL,
               updated_at = NOW()
           WHERE id = $1 AND push_intent_status = 'processing'
             AND push_intent_claim_token = $2
           RETURNING id`,
          [event.id, event.claimToken],
        );
        if (normalizeRows<{ id: string }>(completed).length !== 1) {
          throw new Error('PUSH_INTENT_CLAIM_LOST');
        }
      });
    } catch {
      await this.markFailed(event);
    }
  }

  private async markFailed(event: ClaimedPushIntent): Promise<void> {
    const dead = event.attemptCount >= 20;
    const delay = Math.min(
      500 * 2 ** Math.max(event.attemptCount - 1, 0),
      60_000,
    );
    const updated = await this.dataSource.query(
      dead
        ? `UPDATE chat_outbox_events
           SET push_intent_status = 'dead', push_intent_locked_at = NULL,
               push_intent_claim_token = NULL,
               push_intent_error_code = 'MATERIALIZATION_FAILED', updated_at = NOW()
           WHERE id = $1 AND push_intent_status = 'processing'
             AND push_intent_claim_token = $2
           RETURNING id`
        : `UPDATE chat_outbox_events
           SET push_intent_status = 'pending',
               push_intent_available_at = NOW() + ($3 * INTERVAL '1 millisecond'),
               push_intent_locked_at = NULL, push_intent_claim_token = NULL,
               push_intent_error_code = 'MATERIALIZATION_FAILED', updated_at = NOW()
           WHERE id = $1 AND push_intent_status = 'processing'
             AND push_intent_claim_token = $2
           RETURNING id`,
      dead ? [event.id, event.claimToken] : [event.id, event.claimToken, delay],
    );
    if (normalizeRows<{ id: string }>(updated).length === 1) {
      this.logger.warn('Chat push intent materialization failed');
    }
  }
}
