import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

import {
  CHAT_HEALTH_INTERVAL_MS,
  CHAT_HEALTH_QUERY_TIMEOUT_MS,
  CHAT_REALTIME_CONFIG,
  ChatRealtimeConfig,
} from './chat-realtime.config';
import { CHAT_SINGLETON_LOCK_KEY } from './chat-singleton-lock-key';

type LockLostCallback = () => void | Promise<void>;

@Injectable()
export class ChatSingleInstanceRuntimeGuardService
  implements OnApplicationShutdown
{
  private readonly logger = new Logger(
    ChatSingleInstanceRuntimeGuardService.name,
  );
  private runner: QueryRunner | null = null;
  private held = false;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private checking = false;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(CHAT_REALTIME_CONFIG)
    private readonly config: ChatRealtimeConfig,
  ) {}

  async acquireBeforeListen(): Promise<void> {
    if (this.config.singletonGuardMode === 'disabled') {
      this.held = true;
      this.logger.warn('Chat singleton guard disabled for isolated database');
      return;
    }
    if (this.runner) return;

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const rows = await runner.query(
        'SELECT pg_try_advisory_lock($1, $2) AS acquired',
        [CHAT_SINGLETON_LOCK_KEY.first, CHAT_SINGLETON_LOCK_KEY.second],
      );
      if (rows?.[0]?.acquired !== true) {
        throw new Error('CHAT_SINGLETON_ALREADY_ACTIVE');
      }
      this.runner = runner;
      this.held = true;
      this.logger.log('Chat singleton lock acquired');
    } catch (error) {
      await runner.release().catch(() => undefined);
      throw error;
    }
  }

  isHeld(): boolean {
    return this.held;
  }

  startHealthMonitor(onLockLost: LockLostCallback): void {
    if (
      this.config.singletonGuardMode === 'disabled' ||
      this.healthTimer ||
      !this.runner
    ) {
      return;
    }

    this.healthTimer = setInterval(() => {
      void this.checkHealth(onLockLost);
    }, CHAT_HEALTH_INTERVAL_MS);
    this.healthTimer.unref?.();
  }

  private async checkHealth(onLockLost: LockLostCallback): Promise<void> {
    if (this.checking || !this.runner || !this.held) return;
    this.checking = true;
    try {
      const query = this.runner.query(
        `SELECT EXISTS (
           SELECT 1
           FROM pg_locks
           WHERE locktype = 'advisory'
             AND pid = pg_backend_pid()
             AND objsubid = 2
             AND classid::bigint = CASE WHEN $1::bigint < 0 THEN $1::bigint + 4294967296 ELSE $1::bigint END
             AND objid::bigint = CASE WHEN $2::bigint < 0 THEN $2::bigint + 4294967296 ELSE $2::bigint END
         ) AS held`,
        [CHAT_SINGLETON_LOCK_KEY.first, CHAT_SINGLETON_LOCK_KEY.second],
      );
      const timeout = new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error('CHAT_SINGLETON_HEALTH_TIMEOUT')),
          CHAT_HEALTH_QUERY_TIMEOUT_MS,
        );
        timer.unref?.();
      });
      const rows = await Promise.race([query, timeout]);
      if (rows?.[0]?.held !== true) {
        throw new Error('CHAT_SINGLETON_LOCK_LOST');
      }
    } catch {
      this.held = false;
      this.stopHealthMonitor();
      this.logger.error('Chat singleton lock health check failed');
      await onLockLost();
    } finally {
      this.checking = false;
    }
  }

  stopHealthMonitor(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  async release(): Promise<void> {
    this.stopHealthMonitor();
    if (this.runner) {
      if (this.held) {
        await this.runner
          .query('SELECT pg_advisory_unlock($1, $2)', [
            CHAT_SINGLETON_LOCK_KEY.first,
            CHAT_SINGLETON_LOCK_KEY.second,
          ])
          .catch(() => undefined);
      }
      await this.runner.release().catch(() => undefined);
      this.runner = null;
    }
    this.held = false;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.release();
  }
}
