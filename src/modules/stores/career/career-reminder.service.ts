import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { StoreCareerSetting } from '../entities/store-career-setting.entity';
import { CareerEvaluationService } from './career-evaluation.service';
import { ReviewFrequency, reviewPeriodKey } from './career-time';

/**
 * "Nhắc nhở kiểm duyệt": mỗi kỳ (ngày / tuần / tháng / quý / năm theo lịch VN)
 * gửi chủ cửa hàng MỘT thông báo tóm tắt việc cần rà soát trên lộ trình.
 *
 * Kỳ đã nhắc được đánh dấu bằng khoá kỳ (`last_reminded_period`) trong một
 * transaction khoá dòng cài đặt, rồi mới gửi sau commit: hai instance chạy
 * cron cùng lúc không gửi hai lần; gửi lỗi thì kỳ đó mất một lần nhắc (ghi log)
 * — chấp nhận được hơn là nhắc trùng.
 */
@Injectable()
export class CareerReminderService {
  private readonly logger = new Logger(CareerReminderService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly evaluation: CareerEvaluationService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async sendDueReminders(now: Date = new Date()): Promise<{ stores: number; sent: number }> {
    const stores: Array<{
      store_id: string;
      owner_account_id: string | null;
      review_frequency: ReviewFrequency;
      last_reminded_period: string | null;
    }> = await this.dataSource.query(
      `SELECT c.store_id, s.owner_account_id, c.review_frequency, c.last_reminded_period
         FROM store_career_settings c
         JOIN stores s ON s.id = c.store_id AND s.deleted_at IS NULL
        WHERE c.v2_enabled AND c.review_reminder_enabled AND c.deleted_at IS NULL`,
    );

    let sent = 0;
    for (const store of stores) {
      const period = reviewPeriodKey(store.review_frequency, now);
      if (store.last_reminded_period === period || !store.owner_account_id) continue;
      try {
        const summary = await this.summarize(store.store_id);
        const claimed = await this.dataSource.transaction(async (m) => {
          const setting = await m
            .getRepository(StoreCareerSetting)
            .createQueryBuilder('c')
            .setLock('pessimistic_write')
            .where('c.storeId = :storeId', { storeId: store.store_id })
            .getOne();
          if (!setting || setting.lastRemindedPeriod === period || !setting.reviewReminderEnabled) {
            return false;
          }
          await m.update(StoreCareerSetting, { id: setting.id }, { lastRemindedPeriod: period });
          return true;
        });
        if (!claimed) continue;

        await this.notificationsService.create({
          accountId: store.owner_account_id,
          type: NotificationType.SYSTEM,
          title: 'Đến kỳ rà soát lộ trình thăng tiến',
          content: this.content(summary),
          // App chủ: màn lộ trình, mở thẳng danh sách "Chờ kiểm duyệt". App
          // cũ không biết `tab=review` thì mở tab đầu như trước.
          actionUrl: '/manager/promotion-ladder?tab=review',
          metadata: { storeId: store.store_id, period, ...summary },
        } as any);
        sent += 1;
      } catch (error) {
        this.logger.warn(`Không gửi được nhắc kiểm duyệt cho cửa hàng ${store.store_id}: ${error}`);
      }
    }
    return { stores: stores.length, sent };
  }

  private content(summary: { eligiblePromotions: number; awaitingSkills: number }) {
    const parts = [
      summary.eligiblePromotions > 0
        ? `${summary.eligiblePromotions} nhân viên đủ điều kiện lên vị trí`
        : null,
      summary.awaitingSkills > 0 ? `${summary.awaitingSkills} kỹ năng chờ xác nhận` : null,
    ].filter(Boolean);
    return parts.length
      ? `${parts.join(', ')}. Mở lộ trình để xét duyệt.`
      : 'Rà soát bộ phận, vị trí và kỹ năng của cửa hàng.';
  }

  /**
   * Số việc chờ chủ: người đủ điều kiện bước kế, kỹ năng đủ điều kiện chờ xác
   * nhận — đếm từ đúng danh sách của màn "Chờ kiểm duyệt".
   */
  private async summarize(storeId: string) {
    const pending = await this.evaluation.getPendingReviews(storeId);
    return {
      eligiblePromotions: pending.promotions.length,
      awaitingSkills: pending.skills.length,
    };
  }
}
