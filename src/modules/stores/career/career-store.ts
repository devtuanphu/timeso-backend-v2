import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { StoreCareerSetting } from '../entities/store-career-setting.entity';
import { CAREER_ERRORS } from './career.constants';

/**
 * Nền và khoá theo cửa hàng của lộ trình v2.
 *
 * Dòng `store_career_settings` của cửa hàng là khoá chung:
 *   - ghi cấu trúc (bộ phận / vị trí / kỹ năng / điều kiện) khoá FOR UPDATE —
 *     các lần ghi cấu trúc của một cửa hàng đi tuần tự, nên kiểm cấp / cha /
 *     vòng / giới hạn / "còn ai dùng" trong khoá là đúng tới lúc commit;
 *   - lên vị trí, chấm và xác nhận kỹ năng khoá FOR SHARE (chạy song song với
 *     nhau, nhưng không chen được vào giữa một lần xoá vị trí), RỒI mới khoá
 *     hồ sơ FOR UPDATE. Không bao giờ khoá hồ sơ trước dòng cài đặt, nên không
 *     có vòng chờ.
 */

/**
 * Dòng cài đặt và bộ phận Cấp 1 "Chủ cửa hàng" — cửa hàng tạo sau migration
 * chưa có. Idempotent và an toàn khi chạy song song (ON CONFLICT).
 */
export async function ensureCareerBase(
  manager: EntityManager,
  storeId: string,
): Promise<void> {
  await manager.query(
    `INSERT INTO store_career_settings (store_id) VALUES ($1)
     ON CONFLICT (store_id) DO NOTHING`,
    [storeId],
  );
  await manager.query(
    `INSERT INTO store_departments (store_id, tier, name, description, sort_order, is_system)
     VALUES ($1, 1, 'Chủ cửa hàng', 'Quản lý toàn bộ hoạt động của cửa hàng', 0, true)
     ON CONFLICT (store_id) WHERE is_system AND deleted_at IS NULL DO NOTHING`,
    [storeId],
  );
}

export async function lockCareerStore(
  manager: EntityManager,
  storeId: string,
  mode: 'update' | 'share',
): Promise<StoreCareerSetting> {
  await ensureCareerBase(manager, storeId);
  const setting = await manager
    .getRepository(StoreCareerSetting)
    .createQueryBuilder('setting')
    .setLock(mode === 'update' ? 'pessimistic_write' : 'pessimistic_read')
    .where('setting.storeId = :storeId', { storeId })
    .getOne();
  // ensureCareerBase vừa chèn hoặc đã có dòng; không thấy nghĩa là cửa hàng
  // không tồn tại (khoá ngoại sẽ từ chối từ trước).
  return setting as StoreCareerSetting;
}

/** Ghi lộ trình v2 chỉ khi cửa hàng đã bật cờ (SaaS-7). */
export function assertCareerV2(setting: StoreCareerSetting): void {
  if (!setting.v2Enabled) {
    throw new ConflictException({
      code: CAREER_ERRORS.V2_DISABLED,
      message: 'Cửa hàng chưa bật lộ trình thăng tiến mới',
    });
  }
}

/** Lỗi 409 cho app cũ ghi kiểu cũ vào cửa hàng đã bật v2 (SaaS-6). */
export function appUpdateRequired(): ConflictException {
  return new ConflictException({
    code: CAREER_ERRORS.APP_UPDATE_REQUIRED,
    message:
      'Cửa hàng đã chuyển sang lộ trình thăng tiến mới. Vui lòng cập nhật ứng dụng để chỉnh sửa.',
  });
}

/** Cờ v2 của cửa hàng, không khoá (đọc). */
export async function isCareerV2Enabled(
  manager: EntityManager,
  storeId: string,
): Promise<boolean> {
  const rows: Array<{ v2_enabled: boolean }> = await manager.query(
    'SELECT v2_enabled FROM store_career_settings WHERE store_id = $1',
    [storeId],
  );
  return rows[0]?.v2_enabled === true;
}

/** Lỗi trùng khoá unique của Postgres (23505). */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = error as { code?: string; constraint?: string; driverError?: any };
  const code = e?.code ?? e?.driverError?.code;
  const name = e?.constraint ?? e?.driverError?.constraint;
  return code === '23505' && (!constraint || name === constraint);
}
