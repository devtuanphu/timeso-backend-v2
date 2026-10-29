import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { currentStintSql } from './employment-stint.utils';
import {
  ShiftAssignment,
  ShiftAssignmentStatus,
  WorkCycleStatus,
} from './entities/shift-management.entity';
import {
  WORK_TERM_ERROR_CODES,
  WorkTermViolation,
  workTermWindow,
} from './work-terms.utils';

/**
 * Ngày đã có ca chưa huỷ (trong đợt làm hiện tại) của từng nhân viên trong cửa
 * hàng, trong khoảng tuần / tháng phủ `dates` (đếm giới hạn ngày làm, xem
 * work-terms.utils.ts). Chu kỳ đã dừng (STOPPED) / nháp không tính, cùng phạm
 * vi với danh sách chờ duyệt.
 * Gọi trong transaction đã giữ lockStoreShiftAvailability thì kết quả không bị
 * một lần đăng ký song song làm cũ.
 */
export async function loadBookedWorkDates(
  manager: EntityManager,
  storeId: string,
  employeeIds: string[],
  dates: string[],
): Promise<Map<string, Set<string>>> {
  const booked = new Map<string, Set<string>>();
  const window = workTermWindow(dates);
  if (!employeeIds.length || !window) return booked;
  const rows: Array<{ employeeId: string; workDate: string }> = await manager
    .createQueryBuilder(ShiftAssignment, 'assignment')
    .innerJoin('assignment.shiftSlot', 'slot')
    .innerJoin('slot.workShift', 'workShift')
    .innerJoin('assignment.employee', 'profile')
    .leftJoin('slot.cycle', 'cycle')
    .select('assignment.employeeId', 'employeeId')
    .addSelect("to_char(slot.work_date, 'YYYY-MM-DD')", 'workDate')
    .distinct(true)
    .where('assignment.employeeId IN (:...employeeIds)', { employeeIds })
    .andWhere('assignment.status != :cancelled', {
      cancelled: ShiftAssignmentStatus.CANCELLED,
    })
    .andWhere('workShift.storeId = :storeId', { storeId })
    .andWhere('(cycle.id IS NULL OR cycle.status IN (:...liveCycles))', {
      liveCycles: [WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED],
    })
    .andWhere('slot.workDate BETWEEN :from AND :to', window)
    // Chỉ đợt làm hiện tại: người được tuyển lại không mang ca của đợt cũ.
    .andWhere(currentStintSql('profile', 'assignment.created_at'))
    .getRawMany();
  for (const row of rows) {
    const set = booked.get(row.employeeId) ?? new Set<string>();
    set.add(row.workDate);
    booked.set(row.employeeId, set);
  }
  return booked;
}

export const workTermError = (violation: WorkTermViolation) =>
  new BadRequestException({
    code: WORK_TERM_ERROR_CODES[violation.code],
    message: violation.message,
  });
