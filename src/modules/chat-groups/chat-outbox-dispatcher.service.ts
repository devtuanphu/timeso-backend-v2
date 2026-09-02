import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource, In } from 'typeorm';

import { ChatAuthorizationService } from './chat-authorization.service';
import {
  CHAT_EVENT_PUBLISHER,
  ChatEventPublisher,
} from './chat-event-publisher';
import { mapChatMessage } from './chat-message.mapper';
import { CHAT_OUTBOX_POLL_MS } from './chat-realtime.config';
import { ChatRealtimeReadinessService } from './chat-realtime-readiness.service';
import { ChatMessage } from './entities/chat-message.entity';
import {
  ChatOutboxEvent,
  ChatOutboxEventType,
  ChatOutboxStatus,
} from './entities/chat-outbox-event.entity';

const CLAIM_LIMIT = 100;
const MAX_ATTEMPTS = 20;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1_000;

@Injectable()
export class ChatOutboxDispatcherService {
  private readonly logger = new Logger(ChatOutboxDispatcherService.name);
  private running = false;
  private dispatching = false;
  private cleaning = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly authorization: ChatAuthorizationService,
    private readonly readiness: ChatRealtimeReadinessService,
    @Inject(CHAT_EVENT_PUBLISHER)
    private readonly publisher: ChatEventPublisher,
  ) {}

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  @Interval(CHAT_OUTBOX_POLL_MS)
  async dispatchOnce(): Promise<void> {
    if (!this.running || this.dispatching || !this.readiness.isActive()) {
      return;
    }
    this.dispatching = true;
    try {
      const events = await this.claim();
      for (const event of events) {
        await this.dispatchEvent(event);
      }
    } catch {
      this.logger.warn('Chat outbox dispatch cycle failed');
    } finally {
      this.dispatching = false;
    }
  }

  @Interval(CLEANUP_INTERVAL_MS)
  async cleanupOnce(): Promise<void> {
    if (!this.running || this.cleaning) return;
    this.cleaning = true;
    try {
      await this.dataSource.query(`
        WITH expired AS (
          SELECT id
          FROM chat_outbox_events
          WHERE (status = 'published' AND published_at < NOW() - INTERVAL '24 hours')
             OR (status = 'dead' AND dead_at < NOW() - INTERVAL '7 days')
          ORDER BY COALESCE(published_at, dead_at) ASC
          LIMIT 500
        )
        DELETE FROM chat_outbox_events
        WHERE id IN (SELECT id FROM expired)
      `);
    } catch {
      this.logger.warn('Chat outbox cleanup failed');
    } finally {
      this.cleaning = false;
    }
  }

  private async claim(): Promise<ChatOutboxEvent[]> {
    const rawResult = await this.dataSource.transaction(async (manager) =>
      manager.query(
        `WITH candidates AS (
           SELECT id
           FROM chat_outbox_events
           WHERE (status = 'pending' AND available_at <= NOW())
              OR (status = 'processing' AND locked_at < NOW() - INTERVAL '30 seconds')
           ORDER BY available_at ASC, created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE chat_outbox_events event
         SET status = 'processing',
             locked_at = NOW(),
             attempt_count = event.attempt_count + 1,
             updated_at = NOW()
         FROM candidates
         WHERE event.id = candidates.id
         RETURNING event.id`,
        [CLAIM_LIMIT],
      ),
    );
    // TypeORM's PostgreSQL runner returns UPDATE results as
    // [returningRows, affectedCount], unlike SELECT queries which return rows.
    // Normalize both shapes before resolving claimed event identities.
    const rows: Array<{ id: string }> = Array.isArray(rawResult?.[0])
      ? rawResult[0]
      : rawResult;
    const ids = rows.map((row: { id: string }) => row.id);
    if (ids.length === 0) return [];
    return this.dataSource.getRepository(ChatOutboxEvent).find({
      where: { id: In(ids) },
      order: { createdAt: 'ASC' },
    });
  }

  private async dispatchEvent(event: ChatOutboxEvent): Promise<void> {
    try {
      const recipients =
        await this.authorization.getEligibleRecipientAccountIds(event.groupId);
      if (event.eventType === ChatOutboxEventType.MESSAGE_CREATED_V1) {
        if (!event.messageId) throw new Error('CHAT_OUTBOX_IDENTITY_INVALID');
        const message = await this.dataSource
          .getRepository(ChatMessage)
          .findOne({
            where: { id: event.messageId, groupId: event.groupId },
            relations: ['sender'],
          });
        if (!message?.sequence || message.sequence !== event.sequence) {
          throw new Error('CHAT_OUTBOX_RESOURCE_MISSING');
        }
        await this.publisher.publishMessageCreated(
          { version: 1, message: mapChatMessage(message) },
          recipients,
        );
      } else if (event.eventType === ChatOutboxEventType.READ_UPDATED_V1) {
        if (!event.actorAccountId || event.sequence === null) {
          throw new Error('CHAT_OUTBOX_IDENTITY_INVALID');
        }
        try {
          await this.authorization.requireGroupAccess(
            event.groupId,
            event.actorAccountId,
          );
        } catch {
          this.requireReady();
          await this.markPublished(event.id);
          return;
        }
        await this.publisher.publishReadUpdated(
          {
            version: 1,
            groupId: event.groupId,
            accountId: event.actorAccountId,
            lastReadSequence: event.sequence,
            updatedAt: event.createdAt.toISOString(),
          },
          recipients,
        );
      } else {
        throw new Error('CHAT_OUTBOX_EVENT_UNSUPPORTED');
      }
      this.requireReady();
      await this.markPublished(event.id);
    } catch {
      await this.markFailed(event);
    }
  }

  private async markPublished(id: string): Promise<void> {
    await this.dataSource.getRepository(ChatOutboxEvent).update(
      { id, status: ChatOutboxStatus.PROCESSING },
      {
        status: ChatOutboxStatus.PUBLISHED,
        publishedAt: new Date(),
        lockedAt: null,
        errorCode: null,
      },
    );
  }

  private async markFailed(event: ChatOutboxEvent): Promise<void> {
    const dead = event.attemptCount >= MAX_ATTEMPTS;
    const backoffMs = Math.min(
      500 * 2 ** Math.max(event.attemptCount - 1, 0),
      60_000,
    );
    if (dead) {
      await this.dataSource.query(
        `UPDATE chat_outbox_events
         SET status = 'dead',
             locked_at = NULL,
             dead_at = NOW(),
             error_code = 'PUBLISH_FAILED',
             updated_at = NOW()
         WHERE id = $1 AND status = 'processing'`,
        [event.id],
      );
    } else {
      await this.dataSource.query(
        `UPDATE chat_outbox_events
         SET status = 'pending',
             available_at = NOW() + ($2 * INTERVAL '1 millisecond'),
             locked_at = NULL,
             error_code = 'PUBLISH_FAILED',
             updated_at = NOW()
         WHERE id = $1 AND status = 'processing'`,
        [event.id, backoffMs],
      );
    }
    this.logger.warn('Chat outbox publish attempt failed');
  }

  private requireReady(): void {
    if (!this.running || !this.readiness.isActive()) {
      throw new Error('CHAT_REALTIME_NOT_READY');
    }
  }
}
