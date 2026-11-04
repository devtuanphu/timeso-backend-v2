import { EntityManager } from 'typeorm';

import { effectiveWindowOf } from './attendance-time.utils';
import {
  ShiftAssignment,
  ShiftAssignmentStatus,
} from './entities/shift-management.entity';
import { isShiftCoveredByApprovedLeave } from './leave-coverage.utils';
import { addDays } from './shift-schedule.utils';

/**
 * Ca nối liền: ca kế tiếp của cùng nhân viên, cùng cửa hàng, bắt đầu ĐÚNG lúc
 * ca trước kết thúc (19:00 → 24:00 rồi 00:00 → 05:00; 14:00 → 22:00 rồi
 * 22:00 → 06:00). Hai ca như vậy là một lượt làm liên tục: khi ca trước hết
 * giờ mà nhân viên vẫn đang trong ca, hệ thống tự chấm ra ca trước đúng giờ
 * kết thúc và tự vào ca sau đúng giờ bắt đầu (ShiftEndWorkflowService
 * .chainIntoNextShift), nhân viên không phải chấm công lại giữa chừng.
 *
 * Chỉ nối ca APPROVED chưa vào ca và không nằm trong đơn nghỉ đã duyệt.
 */
export async function findChainedNextAssignment(
  manager: EntityManager,
  previous: {
    id: string;
    employeeId: string;
    shiftSlot?: {
      workDate?: string | Date | null;
      cycle?: { storeId?: string | null } | null;
    } | null;
  },
  previousEnd: Date | null,
): Promise<ShiftAssignment | null> {
  const storeId = previous.shiftSlot?.cycle?.storeId;
  const workDate = previous.shiftSlot?.workDate
    ? String(previous.shiftSlot.workDate).slice(0, 10)
    : null;
  if (!previousEnd || !storeId || !workDate) return null;
  const candidates = await manager
    .createQueryBuilder(ShiftAssignment, 'assignment')
    .innerJoinAndSelect('assignment.shiftSlot', 'slot')
    .leftJoinAndSelect('slot.workShift', 'workShift')
    .innerJoinAndSelect('slot.cycle', 'cycle')
    .where('assignment.employeeId = :employeeId', {
      employeeId: previous.employeeId,
    })
    .andWhere('assignment.id != :previousId', { previousId: previous.id })
    .andWhere('assignment.status = :approved', {
      approved: ShiftAssignmentStatus.APPROVED,
    })
    .andWhere('assignment.checkInTime IS NULL')
    .andWhere('cycle.storeId = :storeId', { storeId })
    // Ca sau bắt đầu lúc ca trước kết thúc: cùng ngày làm hoặc ngày hôm sau.
    .andWhere('slot.workDate IN (:...workDates)', {
      workDates: [workDate, addDays(workDate, 1)],
    })
    .getMany();
  for (const candidate of candidates) {
    const { start } = effectiveWindowOf(candidate);
    if (!start || start.getTime() !== previousEnd.getTime()) continue;
    const covered = await isShiftCoveredByApprovedLeave(
      manager,
      candidate.employeeId,
      String(candidate.shiftSlot.workDate).slice(0, 10),
      candidate.id,
    );
    if (covered) continue;
    return candidate;
  }
  return null;
}
