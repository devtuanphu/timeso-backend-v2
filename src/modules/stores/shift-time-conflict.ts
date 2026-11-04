import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { addDays } from './shift-schedule.utils';
import {
  ShiftAssignment,
  ShiftAssignmentStatus,
  WorkCycleStatus,
} from './entities/shift-management.entity';
import {
  intervalsOverlap,
  toShiftInterval,
  type ShiftInterval,
} from './service-parts/shared';

/**
 * Trùng giờ và giờ nghỉ giữa các ca của một nhân viên, trên khoảng thời gian
 * thật: ca qua đêm (22:00 → 04:00) kéo sang ngày sau, nên luôn xét cả ngày
 * trước và ngày sau của ngày làm.
 */

export const SHIFT_TIME_CONFLICT_CODE = 'SHIFT_TIME_CONFLICT';

const HHmm = (time: string) => String(time).slice(0, 5);
const ddmm = (workDate: string) =>
  `${workDate.slice(8, 10)}/${workDate.slice(5, 7)}`;

/** "ca Ca tối 22:00–04:00 (12/11)" */
export const describeShift = (shift: {
  shiftName?: string | null;
  workDate: string;
  startTime: string;
  endTime: string;
}) =>
  `${shift.shiftName ? `${shift.shiftName} ` : 'ca '}${HHmm(shift.startTime)}–${HHmm(
    shift.endTime,
  )} (${ddmm(shift.workDate)})`;

export interface ExistingShift {
  interval: ShiftInterval;
  label: string;
}

/**
 * Cảnh báo "nghỉ chưa đủ" cho các ca đề xuất so với các ca đã có. Hai ca nối
 * liền (khoảng nghỉ 0) là một lượt làm liên tục, được nối ca tự động, nên
 * không cảnh báo; ca trùng giờ do kiểm tra trùng ca xử lý riêng.
 */
export function restWarnings(
  proposed: ShiftInterval[],
  existing: ExistingShift[],
  minRestMinutes: number,
): string[] {
  if (!(minRestMinutes > 0) || !proposed.length || !existing.length) return [];
  const hours = Math.round((minRestMinutes / 60) * 10) / 10;
  const warnings = new Set<string>();
  for (const candidate of proposed) {
    for (const other of existing) {
      if (intervalsOverlap(candidate, other.interval)) continue;
      const gap =
        candidate.start >= other.interval.end
          ? candidate.start - other.interval.end
          : other.interval.start - candidate.end;
      if (gap > 0 && gap < minRestMinutes) {
        const restHours = Math.floor(gap / 60);
        const restMinutes = gap % 60;
        warnings.add(
          `Nghỉ chưa đủ ${hours} giờ so với ${other.label}: chỉ cách ${
            restHours ? `${restHours} giờ` : ''
          }${restHours && restMinutes ? ' ' : ''}${
            restMinutes ? `${restMinutes} phút` : ''
          }`,
        );
      }
    }
  }
  return [...warnings];
}

/**
 * Ca còn hiệu lực (chưa huỷ) của nhân viên mà giờ trùng với ca đề xuất, hoặc
 * null. Xét ngày trước / ngày sau của ngày làm. `excludeAssignmentIds`: lượt
 * đang được thay (đổi ca, sửa giờ chính nó).
 */
export async function findShiftTimeConflict(
  manager: EntityManager,
  input: {
    storeId: string;
    employeeId: string;
    workDate: string;
    startTime: string;
    endTime: string;
    excludeAssignmentIds?: string[];
    excludeSlotIds?: string[];
  },
): Promise<{
  assignment: ShiftAssignment;
  workDate: string;
  startTime: string;
  endTime: string;
  shiftName: string | null;
} | null> {
  const workDate = String(input.workDate).slice(0, 10);
  const proposed = toShiftInterval(workDate, input.startTime, input.endTime);
  const candidates = await manager
    .createQueryBuilder(ShiftAssignment, 'assignment')
    .leftJoinAndSelect('assignment.shiftSlot', 'slot')
    .leftJoinAndSelect('slot.workShift', 'workShift')
    .leftJoin('slot.cycle', 'cycle')
    .where('assignment.employeeId = :employeeId', {
      employeeId: input.employeeId,
    })
    .andWhere('assignment.status != :cancelled', {
      cancelled: ShiftAssignmentStatus.CANCELLED,
    })
    .andWhere('cycle.storeId = :storeId', { storeId: input.storeId })
    // Cả chu kỳ vừa hết hạn: ca qua đêm ngày cuối của nó (22:00 → 04:00) vẫn
    // chạm ngày đầu chu kỳ mới.
    .andWhere('cycle.status IN (:...cycleStatuses)', {
      cycleStatuses: [WorkCycleStatus.ACTIVE, WorkCycleStatus.EXPIRED],
    })
    .andWhere('slot.workDate BETWEEN :from AND :to', {
      from: addDays(workDate, -1),
      to: addDays(workDate, 1),
    })
    .getMany();
  const excludedAssignments = new Set(input.excludeAssignmentIds ?? []);
  const excludedSlots = new Set(input.excludeSlotIds ?? []);
  for (const assignment of candidates) {
    if (excludedAssignments.has(assignment.id)) continue;
    if (excludedSlots.has(assignment.shiftSlotId)) continue;
    const slot = assignment.shiftSlot;
    const startTime = slot?.startTime || slot?.workShift?.startTime;
    const endTime = slot?.endTime || slot?.workShift?.endTime;
    if (!slot?.workDate || !startTime || !endTime) continue;
    const otherDate = String(slot.workDate).slice(0, 10);
    if (intervalsOverlap(proposed, toShiftInterval(otherDate, startTime, endTime))) {
      return {
        assignment,
        workDate: otherDate,
        startTime,
        endTime,
        shiftName: slot.workShift?.shiftName ?? null,
      };
    }
  }
  return null;
}

/** Như findShiftTimeConflict, nhưng báo lỗi 400 khi trùng. */
export async function assertNoShiftTimeConflict(
  manager: EntityManager,
  input: Parameters<typeof findShiftTimeConflict>[1] & {
    /** "Bạn" (nhân viên tự đăng ký) hoặc tên nhân viên (chủ xếp / duyệt). */
    who?: string;
  },
): Promise<void> {
  const conflict = await findShiftTimeConflict(manager, input);
  if (!conflict) return;
  throw new BadRequestException({
    code: SHIFT_TIME_CONFLICT_CODE,
    message: `${input.who ?? 'Nhân viên'} đã có ${describeShift(
      conflict,
    )} trùng giờ với ca này.`,
  });
}
