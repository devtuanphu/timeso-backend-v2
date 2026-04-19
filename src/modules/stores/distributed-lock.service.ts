import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { CronLock } from './entities/cron-lock.entity';

/**
 * Distributed Lock Service using PostgreSQL Advisory Locks
 *
 * Uses pg_advisory_lock() for true advisory locks that work correctly
 * across multiple server instances. Each cron job should acquire a lock
 * before execution to prevent duplicate runs in scaled deployments.
 *
 * Usage:
 *   const lock = await distributedLockService.acquireLock('my-cron-job', 300);
 *   if (lock) {
 *     try {
 *       // do work
 *     } finally {
 *       await distributedLockService.releaseLock(lock);
 *     }
 *   }
 */
@Injectable()
export class DistributedLockService implements OnModuleInit {
  private readonly logger = new Logger(DistributedLockService.name);

  constructor(
    @InjectRepository(CronLock)
    private readonly cronLockRepository: Repository<CronLock>,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    // Ensure the cron_locks table exists
    await this.ensureTable();
  }

  private async ensureTable(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS cron_locks (
          lock_name VARCHAR(255) PRIMARY KEY,
          instance_id VARCHAR(255) NOT NULL,
          acquired_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL
        )
      `);
    } catch (error) {
      this.logger.warn('Could not ensure cron_locks table exists:', error);
    }
  }

  /**
   * Acquire a distributed lock for a given job name.
   *
   * @param jobName - Unique identifier for the cron job
   * @param ttlSeconds - How long the lock is valid (default: 300s = 5 min)
   * @returns Lock record if acquired, null if already locked by another instance
   */
  async acquireLock(jobName: string, ttlSeconds = 300): Promise<CronLock | null> {
    const instanceId = this.getInstanceId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    try {
      // Use PostgreSQL advisory lock with a hash of the job name
      const lockKey = this.hashLockName(jobName);

      // Try to acquire PostgreSQL advisory lock (non-blocking)
      const advisoryResult = await this.dataSource.query(
        `SELECT pg_try_advisory_lock(${lockKey}) as acquired`,
      );

      const advisoryAcquired = advisoryResult?.[0]?.acquired === true;

      if (!advisoryAcquired) {
        this.logger.debug(`Advisory lock for '${jobName}' already held by another instance`);
        return null;
      }

      // Also update our tracking table for observability
      await this.dataSource.transaction(async (manager) => {
        await manager
          .createQueryBuilder()
          .insert()
          .into(CronLock)
          .values({
            lockName: jobName,
            instanceId,
            acquiredAt: now,
            expiresAt,
          })
          .onConflict(`("lockName") DO UPDATE SET
            "instanceId" = EXCLUDED."instanceId",
            "acquiredAt" = EXCLUDED."acquiredAt",
            "expiresAt" = EXCLUDED."expiresAt"
          `)
          .execute();
      });

      this.logger.log(`Acquired lock for '${jobName}' (TTL: ${ttlSeconds}s, instance: ${instanceId})`);
      return this.cronLockRepository.create({ lockName: jobName, instanceId, acquiredAt: now, expiresAt });
    } catch (error) {
      this.logger.error(`Failed to acquire lock for '${jobName}':`, error);
      return null;
    }
  }

  /**
   * Release a previously acquired lock.
   */
  async releaseLock(lock: CronLock): Promise<void> {
    try {
      const lockKey = this.hashLockName(lock.lockName);

      // Release PostgreSQL advisory lock
      await this.dataSource.query(
        `SELECT pg_advisory_unlock(${lockKey})`,
      );

      // Clean up tracking record
      await this.dataSource.transaction(async (manager) => {
        await manager.delete(CronLock, { lockName: lock.lockName });
      });

      this.logger.log(`Released lock for '${lock.lockName}'`);
    } catch (error) {
      this.logger.error(`Failed to release lock for '${lock.lockName}':`, error);
    }
  }

  /**
   * Check if a lock is currently held (by any instance).
   */
  async isLocked(jobName: string): Promise<boolean> {
    try {
      const lockKey = this.hashLockName(jobName);
      const result = await this.dataSource.query(
        `SELECT pg_advisory_locked(${lockKey}) as locked`,
      );
      return result?.[0]?.locked === true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up expired locks (fallback cleanup if advisory lock was not released).
   * Should not be needed often since PostgreSQL auto-releases advisory locks on session end.
   */
  async cleanupExpiredLocks(): Promise<number> {
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        return manager.delete(CronLock, {
          expiresAt: new Date(),
        });
      });
      const count = result.affected ?? 0;
      if (count > 0) {
        this.logger.log(`Cleaned up ${count} expired cron locks`);
      }
      return count;
    } catch (error) {
      this.logger.error('Failed to cleanup expired locks:', error);
      return 0;
    }
  }

  /**
   * Run a job with an exclusive lock. If lock cannot be acquired, skip execution.
   *
   * @param jobName - Unique identifier
   * @param ttlSeconds - Lock TTL
   * @param job - Async function to execute
   * @returns true if job ran, false if skipped due to lock
   */
  async withLock<T>(
    jobName: string,
    ttlSeconds: number,
    job: () => Promise<T>,
  ): Promise<{ ran: boolean; result?: T; error?: unknown }> {
    const lock = await this.acquireLock(jobName, ttlSeconds);
    if (!lock) {
      this.logger.warn(`Skipping '${jobName}' — lock held by another instance`);
      return { ran: false };
    }

    try {
      const result = await job();
      return { ran: true, result };
    } catch (error) {
      return { ran: true, error };
    } finally {
      await this.releaseLock(lock);
    }
  }

  private getInstanceId(): string {
    // Unique per process instance (hostname + pid + random suffix)
    const os = require('os');
    return `${os.hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private hashLockName(name: string): number {
    // Convert string lock name to a bigint hash for pg_advisory_lock
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      const char = name.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    // Ensure positive (PostgreSQL advisory lock keys must be bigint)
    return Math.abs(hash);
  }
}
