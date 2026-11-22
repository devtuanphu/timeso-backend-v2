import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { vnDateString } from '../../common/utils/vn-calendar';
import {
  NotificationPriority,
  NotificationType,
} from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { ACTIVITY_ACTIONS } from './activity-log.summary';
import { EMPLOYED_STATUSES } from './entities/employee-profile.entity';
import { StoreRequestApprover } from './entities/store-request-approver.entity';
import { ApproverIdentityChangeHook } from './approver-identity-change.hook';

/**
 * A4(b) implementation. When an account that is an ACTIVE approver somewhere
 * changes its identity document, tell each such store's owner and log it. The
 * same-CCCD rule is best-effort anti-collusion, not a hard guarantee (a user can
 * freely edit their own CCCD), so the owner is warned to re-check instead of the
 * change being blocked. Name only — the document numbers are never sent.
 *
 * Deduped per (account, store, day): the activity-log row carries an idempotency
 * key, and the owner is notified ONLY when that row is newly inserted, so
 * repeated A->B->A edits in one day produce at most one log and one
 * notification per store.
 */
@Injectable()
export class ApproverIdentityChangeService implements ApproverIdentityChangeHook {
  private readonly logger = new Logger(ApproverIdentityChangeService.name);

  constructor(
    @InjectRepository(StoreRequestApprover)
    private readonly approverRepository: Repository<StoreRequestApprover>,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  async onIdentityDocumentChanged(accountId: string): Promise<void> {
    if (!accountId) return;
    try {
      const rows = await this.approverRepository
        .createQueryBuilder('a')
        .innerJoinAndSelect('a.employeeProfile', 'profile')
        .innerJoinAndSelect('profile.account', 'account')
        .leftJoinAndSelect('a.store', 'store')
        .where('account.id = :accountId', { accountId })
        .andWhere('a.is_active = true')
        .andWhere('a.deleted_at IS NULL')
        .andWhere('profile.employment_status IN (:...employed)', {
          employed: [...EMPLOYED_STATUSES],
        })
        .getMany();

      const day = vnDateString();
      for (const row of rows) {
        const store = (row as any).store;
        const profile = (row as any).employeeProfile;
        const ownerAccountId: string | undefined = store?.ownerAccountId;
        if (!ownerAccountId || !store?.id) continue;
        // The owner editing their own document should not notify themselves.
        if (ownerAccountId === accountId) continue;

        // Atomic dedupe gate: insert the activity log with a per-(account,
        // store, day) idempotency key; a conflict means today's change was
        // already recorded for this store, so neither log nor notify again.
        const newlyLogged = await this.recordOnce(
          store.id,
          accountId,
          profile?.id ?? null,
          day,
        );
        if (!newlyLogged) continue;

        const name = profile?.account?.fullName?.trim() || 'Một người phê duyệt';
        await this.notifyOwner(store.id, ownerAccountId, name, profile?.id);
      }
    } catch (error) {
      // Best-effort: the identity update already committed and must not fail.
      this.logger.warn(
        `[approverIdentityChanged] ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Inserts one activity-log row for today's change at this store, deduped by
   * idempotency key. Returns true only when a row was actually inserted (the
   * first change today), so the caller notifies the owner at most once per day.
   */
  private async recordOnce(
    storeId: string,
    actorAccountId: string,
    subjectProfileId: string | null,
    day: string,
  ): Promise<boolean> {
    const idempotencyKey = `${ACTIVITY_ACTIONS.APPROVER_IDENTITY_CHANGED}:${actorAccountId}:${storeId}:${day}`;
    try {
      const inserted: Array<{ id: string }> = await this.dataSource.query(
        `INSERT INTO activity_logs (
           store_id, actor_account_id, actor_role, subject_employee_profile_id,
           action, resource_type, resource_id, params, idempotency_key
         )
         VALUES ($1::uuid, $2::uuid, 'staff', $3::uuid, $4, 'employee', $3::uuid,
                 '{}'::jsonb, $5)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [storeId, actorAccountId, subjectProfileId, ACTIVITY_ACTIONS.APPROVER_IDENTITY_CHANGED, idempotencyKey],
      );
      return inserted.length > 0;
    } catch (error) {
      this.logger.warn(
        `[approverIdentityChanged] activity log failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private async notifyOwner(
    storeId: string,
    ownerAccountId: string,
    approverName: string,
    employeeProfileId: string | undefined,
  ): Promise<void> {
    try {
      await this.notificationsService.create({
        accountId: ownerAccountId,
        storeId,
        title: 'Người phê duyệt thay đổi số định danh',
        content: `Người phê duyệt ${approverName} vừa thay đổi số CCCD/CMND.`,
        type: NotificationType.SYSTEM,
        priority: NotificationPriority.NORMAL,
        metadata: {
          type: 'APPROVER_IDENTITY_CHANGED',
          storeId,
          ...(employeeProfileId ? { employeeProfileId } : {}),
        },
      } as any);
    } catch (error) {
      this.logger.warn(
        `[approverIdentityChanged] owner notify failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
