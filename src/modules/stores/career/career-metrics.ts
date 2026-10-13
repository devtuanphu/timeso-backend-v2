import { EntityManager } from 'typeorm';

import { SkillEvaluationResult } from '../entities/employee-skill-evaluation.entity';
import {
  ShiftAssignment,
  ShiftAssignmentStatus,
} from '../entities/shift-management.entity';

/**
 * Phép đo của lộ trình v2. Cùng nguồn với lộ trình cũ
 * (CareerLadderService.completedWorkSince): ca COMPLETED và `worked_minutes`
 * của chính ca đó, lọc theo ngày làm VN (`shift_slots.work_date`). Không cộng
 * employee_monthly_summaries — dòng đó ghi bất đồng bộ và `totalWorkHours` của
 * nó vốn đã là số cộng dồn.
 */
export interface CompletedWork {
  shifts: number;
  minutes: number;
}

/** Ca hoàn thành trong [fromVnDate, toVnDateExclusive) — biên nào null thì không giới hạn. */
export async function completedWork(
  manager: EntityManager,
  profileId: string,
  range: { fromVnDate?: string | null; toVnDateExclusive?: string | null },
): Promise<CompletedWork> {
  const query = manager
    .getRepository(ShiftAssignment)
    .createQueryBuilder('assignment')
    .innerJoin('assignment.shiftSlot', 'slot')
    .select('COUNT(assignment.id)', 'shifts')
    .addSelect('COALESCE(SUM(assignment.workedMinutes), 0)', 'minutes')
    .where('assignment.employeeId = :profileId', { profileId })
    .andWhere('assignment.status = :status', {
      status: ShiftAssignmentStatus.COMPLETED,
    });
  if (range.fromVnDate) {
    query.andWhere('slot.workDate >= :from', { from: range.fromVnDate });
  }
  if (range.toVnDateExclusive) {
    query.andWhere('slot.workDate < :to', { to: range.toVnDateExclusive });
  }
  const row = await query.getRawOne<{ shifts: string; minutes: string }>();
  return {
    shifts: Number(row?.shifts) || 0,
    minutes: Number(row?.minutes) || 0,
  };
}

export const hoursOf = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

/** Số lần đánh giá Đạt một kỹ năng từ một thời điểm (đã lọc đầu đợt làm). */
export async function passEvaluationsSince(
  manager: EntityManager,
  profileId: string,
  skillId: string,
  since: Date | null,
): Promise<number> {
  const rows: Array<{ n: number }> = await manager.query(
    `SELECT count(*)::int AS n FROM employee_skill_evaluations
      WHERE employee_profile_id = $1 AND skill_id = $2 AND result = $3
        AND deleted_at IS NULL
        AND ($4::timestamp IS NULL OR evaluated_at >= $4::timestamp)`,
    [profileId, skillId, SkillEvaluationResult.PASS, since],
  );
  return Number(rows[0]?.n) || 0;
}
