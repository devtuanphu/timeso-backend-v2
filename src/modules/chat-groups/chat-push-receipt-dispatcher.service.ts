import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { DevicesService } from '../devices/devices.service';
import { ExpoPushService } from '../push/expo-push.service';
import {
  CHAT_REALTIME_CONFIG,
  ChatRealtimeConfig,
} from './chat-realtime.config';
import { ChatRealtimeReadinessService } from './chat-realtime-readiness.service';

interface ClaimedReceipt {
  id: string;
  expoTicketId: string;
  intendedAccountId: string;
  userDeviceId: string;
  expectedDeviceId: string;
  expectedTokenFingerprint: string;
  expectedRegistrationVersion: string;
  claimToken: string;
  receiptAttemptCount: number;
}

const RECEIPT_POLL_MS = 60_000;
const DELIVERY_CLEANUP_MS = 5 * 60_000;

const normalizeRows = <T>(result: T[] | [T[], number]): T[] =>
  Array.isArray(result?.[0]) ? (result[0] as T[]) : (result as T[]);

@Injectable()
export class ChatPushReceiptDispatcherService {
  private readonly logger = new Logger(ChatPushReceiptDispatcherService.name);
  private running = false;
  private dispatching = false;
  private cleaning = false;

  constructor(
    private readonly dataSource: DataSource,
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

  @Interval(RECEIPT_POLL_MS)
  async dispatchOnce(): Promise<void> {
    if (!this.running || this.dispatching || !this.readiness.isActive()) return;
    this.dispatching = true;
    try {
      const deliveries = await this.claim();
      if (deliveries.length === 0) return;
      const receipts = await this.expoPush.getPushReceipts(
        deliveries.map((item) => item.expoTicketId),
      );
      for (const delivery of deliveries) {
        const result = receipts[delivery.expoTicketId] || {
          outcome: 'pending' as const,
        };
        if (result.outcome === 'delivered') {
          await this.updateTerminal(delivery, 'delivered', null);
        } else if (result.outcome === 'permanent') {
          const recorded = await this.updateTerminal(
            delivery,
            'dead',
            result.errorCode,
          );
          if (recorded && result.deviceInvalid) {
            await this.devices.disableInvalidDevice({
              id: delivery.userDeviceId,
              userId: delivery.intendedAccountId,
              deviceId: delivery.expectedDeviceId,
              pushTokenFingerprint: delivery.expectedTokenFingerprint,
              registrationVersion: delivery.expectedRegistrationVersion,
            });
          }
        } else {
          await this.reschedule(
            delivery,
            result.outcome === 'retryable' ? result.errorCode : null,
          );
        }
      }
    } catch {
      this.logger.warn('Chat push receipt cycle failed');
    } finally {
      this.dispatching = false;
    }
  }

  @Interval(DELIVERY_CLEANUP_MS)
  async cleanupOnce(): Promise<void> {
    if (!this.running || this.cleaning) return;
    this.cleaning = true;
    try {
      await this.dataSource.query(
        `WITH expired AS (
           SELECT delivery.id
           FROM chat_push_deliveries delivery
           WHERE delivery.status IN ('delivered', 'suppressed', 'dead')
             AND COALESCE(delivery.delivered_at, delivery.suppressed_at, delivery.dead_at)
                 < NOW() - INTERVAL '14 days'
             AND NOT EXISTS (
               SELECT 1 FROM chat_outbox_events source
               WHERE source.message_id = delivery.message_id
                 AND source.event_type = 'MESSAGE_CREATED_V1'
                 AND COALESCE(source.push_intent_status, 'pending')
                     NOT IN ('completed', 'dead')
             )
           ORDER BY COALESCE(delivery.delivered_at, delivery.suppressed_at, delivery.dead_at)
           LIMIT 500
         )
         DELETE FROM chat_push_deliveries
         WHERE id IN (SELECT id FROM expired)`,
      );
    } catch {
      this.logger.warn('Chat push delivery cleanup failed');
    } finally {
      this.cleaning = false;
    }
  }

  private async claim(): Promise<ClaimedReceipt[]> {
    const claimToken = randomUUID();
    const raw = await this.dataSource.query(
      `WITH candidates AS (
         SELECT id FROM chat_push_deliveries
         WHERE ((status = 'ticket_accepted' AND receipt_available_at <= NOW())
             OR (status = 'processing' AND expo_ticket_id IS NOT NULL
                 AND locked_at < NOW() - INTERVAL '30 seconds'))
           AND deleted_at IS NULL
         ORDER BY receipt_available_at ASC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 100
       )
       UPDATE chat_push_deliveries delivery
       SET status = 'processing', locked_at = NOW(), claim_token = $1,
           receipt_attempt_count = delivery.receipt_attempt_count + 1, updated_at = NOW()
       FROM candidates
       WHERE delivery.id = candidates.id
       RETURNING delivery.id, delivery.expo_ticket_id AS "expoTicketId",
                 delivery.intended_account_id AS "intendedAccountId",
                 delivery.user_device_id AS "userDeviceId",
                 delivery.expected_device_id AS "expectedDeviceId",
                 delivery.expected_token_fingerprint AS "expectedTokenFingerprint",
                 delivery.expected_registration_version::text AS "expectedRegistrationVersion",
                 delivery.claim_token AS "claimToken",
                 delivery.receipt_attempt_count AS "receiptAttemptCount"`,
      [claimToken],
    );
    return normalizeRows<ClaimedReceipt>(raw).map((row) => ({
      ...row,
      receiptAttemptCount: Number(row.receiptAttemptCount),
    }));
  }

  private async updateTerminal(
    delivery: ClaimedReceipt,
    status: 'delivered' | 'dead',
    errorCode: string | null,
  ): Promise<boolean> {
    const raw = await this.dataSource.query(
      `UPDATE chat_push_deliveries
       SET status = $3, ${status === 'delivered' ? 'delivered_at' : 'dead_at'} = NOW(),
           error_code = $4, locked_at = NULL, claim_token = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'processing' AND claim_token = $2
         AND expo_ticket_id = $5
       RETURNING id`,
      [
        delivery.id,
        delivery.claimToken,
        status,
        errorCode,
        delivery.expoTicketId,
      ],
    );
    return normalizeRows<{ id: string }>(raw).length === 1;
  }

  private async reschedule(
    delivery: ClaimedReceipt,
    errorCode: string | null,
  ): Promise<void> {
    const delayMinutes = Math.min(
      2 ** Math.min(delivery.receiptAttemptCount, 6),
      60,
    );
    const expired = await this.dataSource.query(
      `UPDATE chat_push_deliveries
       SET status = 'dead', dead_at = NOW(), error_code = 'RECEIPT_EXPIRED_UNKNOWN',
           locked_at = NULL, claim_token = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'processing' AND claim_token = $2
         AND expo_ticket_id = $3
         AND ticket_accepted_at <= NOW() - INTERVAL '24 hours'
       RETURNING id`,
      [delivery.id, delivery.claimToken, delivery.expoTicketId],
    );
    if (normalizeRows<{ id: string }>(expired).length === 1) return;

    const rescheduled = await this.dataSource.query(
      `UPDATE chat_push_deliveries
       SET status = 'ticket_accepted',
           receipt_available_at = NOW() + ($4 * INTERVAL '1 minute'),
           error_code = $5, locked_at = NULL, claim_token = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'processing' AND claim_token = $2
         AND expo_ticket_id = $3
       RETURNING id`,
      [
        delivery.id,
        delivery.claimToken,
        delivery.expoTicketId,
        delayMinutes,
        errorCode,
      ],
    );
    if (normalizeRows<{ id: string }>(rescheduled).length !== 1) return;
  }
}
