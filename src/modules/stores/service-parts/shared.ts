import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { join } from 'path';
import { EmploymentStatus } from '../entities/employee-profile.entity';
import {
  EmployeeLeaveRequest,
  LeaveType,
} from '../entities/employee-leave-request.entity';
import { WORK_SHIFT_TIME_PATTERN } from '../dto/work-shift.dto';
import {
  addDays,
  getTodayDateString,
  parseDateOnly,
} from '../shift-schedule.utils';
import { parseVietnamShiftStart } from '../shift-reminder.utils';
import {
  vnClockHHmm,
  vnDateString,
  VnMonth,
} from '../../../common/utils/vn-calendar';

/** Module-level helpers shared by StoresService and its service parts. */

/** Copies only `fields` that are present on `source`. */
export const pickDefined = <K extends string>(
  source: unknown,
  fields: readonly K[],
): Partial<Record<K, unknown>> => {
  const picked: Partial<Record<K, unknown>> = {};
  const record = (source ?? {}) as Record<string, unknown>;
  for (const field of fields) {
    if (record[field] !== undefined) picked[field] = record[field];
  }
  return picked;
};

/** Advisory-lock key serializing payslip writers for a store and month. */
export const monthlyPayrollLockKey = (storeId: string, month: VnMonth) =>
  `monthly-payroll:${storeId}:${month.year}-${month.monthIndex + 1}`;

/**
 * Employment statuses that can be rostered: registration, owner assignment,
 * schedule creation and swaps. Probation is a working state; ON_LEAVE is not.
 */
export const SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES = [
  EmploymentStatus.ACTIVE,
  EmploymentStatus.PROBATION,
] as const;

export const isShiftEligibleEmploymentStatus = (
  status: EmploymentStatus | null | undefined,
): boolean =>
  (SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES as readonly unknown[]).includes(status);

/**
 * A leave request's type. `'LEAVE'` (sent by released staff builds, not an
 * enum value) is read as PERSONAL; missing stays missing; anything else that
 * is not a `LeaveType` is 400.
 */
export function normalizeLeaveType(raw: unknown): LeaveType | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (raw === 'LEAVE') return LeaveType.PERSONAL;
  if (
    typeof raw === 'string' &&
    (Object.values(LeaveType) as string[]).includes(raw)
  ) {
    return raw as LeaveType;
  }
  throw new BadRequestException('Loại đơn không hợp lệ');
}

/**
 * `?type=` on an employee's leave history: a comma-separated list of
 * `LeaveType` values, where `LEAVE` means every absence type. Missing or
 * blank is no filter; an unknown value is 400.
 */
export function parseLeaveTypeFilter(
  raw: string | undefined,
): LeaveType[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const types = new Set<LeaveType>();
  for (const part of raw.split(',')) {
    const value = part.trim().toUpperCase();
    if (!value) continue;
    if (value === 'LEAVE') {
      BLOCKING_LEAVE_TYPE_VALUES.forEach((leaveType) => types.add(leaveType));
    } else if ((Object.values(LeaveType) as string[]).includes(value)) {
      types.add(value as LeaveType);
    } else {
      throw new BadRequestException('Loại đơn không hợp lệ');
    }
  }
  return types.size ? [...types] : null;
}

export const BLOCKING_LEAVE_TYPES = new Set<LeaveType>([
  LeaveType.SICK,
  LeaveType.PERSONAL,
  LeaveType.SUDDEN,
  LeaveType.VACATION,
  LeaveType.UNPAID,
  LeaveType.OTHER,
]);

export const BLOCKING_LEAVE_TYPE_VALUES = [...BLOCKING_LEAVE_TYPES];

/** Overtime times that do not fit the linked shift (an older build's). */
export const OVERTIME_SHIFT_MISMATCH = 'OVERTIME_SHIFT_MISMATCH';

/** A shift handed to someone else drops the previous holder's approved times. */
export const CLEARED_SHIFT_REQUEST_EFFECTS = {
  adjustedStartAt: null,
  adjustedEndAt: null,
  lateRequestId: null,
  earlyRequestId: null,
};

export const normalizeActiveShiftName = (name: string) =>
  name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi-VN');

/** "HH:mm" / "HH:mm:ss" → "HH:mm:ss"; null when malformed. */
export const normalizeWorkShiftTime = (value: unknown): string | null => {
  if (typeof value !== 'string' || !WORK_SHIFT_TIME_PATTERN.test(value)) {
    return null;
  }
  return value.length === 5 ? `${value}:00` : value;
};

/** Check-in before the store's early check-in window opens. */
export const CHECK_IN_TOO_EARLY_CODE = 'CHECK_IN_TOO_EARLY';

export const sameShiftTime = (left: string, right: string) =>
  left.slice(0, 5) === right.slice(0, 5);

export type ShiftInterval = {
  start: number;
  end: number;
};

export const timeToMinutes = (time: string): number => {
  const [hours, minutes] = time.slice(0, 5).split(':').map(Number);
  return hours * 60 + minutes;
};

export const toShiftInterval = (
  workDate: string,
  startTime: string,
  endTime: string,
): ShiftInterval => {
  const dayStart = parseDateOnly(workDate).getTime() / 60000;
  const startMinutes = timeToMinutes(startTime);
  let endMinutes = timeToMinutes(endTime);
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  return {
    start: dayStart + startMinutes,
    end: dayStart + endMinutes,
  };
};

export const intervalsOverlap = (left: ShiftInterval, right: ShiftInterval) =>
  left.start < right.end && right.start < left.end;

/** One saved assignment shown next to an employee option (O4a). */
export interface ShiftEmployeeOtherShift {
  shiftName: string;
  workDate: string;
  startTime: string;
  endTime: string;
  overlaps: boolean;
}

export const sortIntervals = (intervals: ShiftInterval[]) =>
  intervals.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );

/**
 * Unique indexes that enforce one ACTIVE old-style cycle per store: the
 * original (every cycle) and its replacement (cycles without a recurrence
 * rule). Both are matched while the SQL rollout is in progress.
 */
export const ONE_ACTIVE_CYCLE_CONSTRAINTS = new Set([
  'uq_work_cycles_one_active_per_store',
  'uq_work_cycles_one_active_legacy_per_store',
]);

export type WorkCycleStopPlan =
  | { immediate: true }
  | { immediate: false; stopAt: Date };

export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads a cycle stop request into "stop now" or "stop at `stopAt`".
 *
 * - `{stopImmediately: false, scheduledStopAt: 'X'}`: X is the first day with
 *   no shifts; the cycle stops at 00:00 Vietnam time on X. A full ISO instant
 *   is taken as is.
 * - Released owner builds send `{stopType: 'scheduled', stopDate: S}` where S
 *   is the last working day (their date maths lands one day early), so the
 *   stop is at 00:00 Vietnam time on S + 1 — the same day the owner picked.
 * - `{stopType: 'immediate'}`, `{stopImmediately: true}` or nothing: now.
 *
 * A date before today (Vietnam) is 400; a stop instant already reached is
 * treated as immediate.
 */
export function normalizeWorkCycleStopRequest(
  body:
    | {
        stopImmediately?: boolean;
        scheduledStopAt?: string;
        stopType?: string;
        stopDate?: string;
      }
    | null
    | undefined,
  todayVn: string = getTodayDateString(),
  now: Date = new Date(),
): WorkCycleStopPlan {
  const request = body ?? {};
  const invalid = () => new BadRequestException('Ngày dừng không hợp lệ');
  const inPast = () =>
    new BadRequestException('Ngày dừng không được ở trong quá khứ');
  const plan = (stopAt: Date): WorkCycleStopPlan =>
    stopAt.getTime() <= now.getTime()
      ? { immediate: true }
      : { immediate: false, stopAt };
  const firstDayWithoutShifts = (date: string): WorkCycleStopPlan => {
    if (!DATE_ONLY_PATTERN.test(date)) throw invalid();
    try {
      parseDateOnly(date);
    } catch {
      throw invalid();
    }
    if (date < todayVn) throw inPast();
    return plan(parseVietnamShiftStart(date, '00:00'));
  };

  if (request.stopImmediately === true) return { immediate: true };
  if (request.stopImmediately === false) {
    const raw =
      typeof request.scheduledStopAt === 'string'
        ? request.scheduledStopAt.trim()
        : '';
    if (!raw) throw invalid();
    if (DATE_ONLY_PATTERN.test(raw)) return firstDayWithoutShifts(raw);
    const instant = new Date(raw);
    if (Number.isNaN(instant.getTime())) throw invalid();
    if (vnDateString(instant) < todayVn) throw inPast();
    return plan(instant);
  }
  if (request.stopType === 'scheduled') {
    const lastWorkingDay =
      typeof request.stopDate === 'string' ? request.stopDate.trim() : '';
    if (!DATE_ONLY_PATTERN.test(lastWorkingDay)) throw invalid();
    try {
      parseDateOnly(lastWorkingDay);
    } catch {
      throw invalid();
    }
    return firstDayWithoutShifts(addDays(lastWorkingDay, 1));
  }
  return { immediate: true };
}

/** Longest range a fixed-shift registration without an end date covers. */
export const FIXED_SHIFT_MAX_RANGE_DAYS = 366;

// The authoritative query is capped before interval construction, and partial
// leave expansion is bounded independently. This keeps transaction-held work
// predictable even when legacy leave ranges span many years.
export const MAX_BLOCKING_LEAVE_ROWS = 5000;

export const MAX_DERIVED_BLOCKING_LEAVE_INTERVALS = 20000;

export const BLOCKING_LEAVE_COMPLEXITY_ERROR =
  'Phạm vi nghỉ phép quá lớn để kiểm tra lịch ca an toàn';

export const inclusiveDateSpan = (startDate: string, endDate: string) =>
  Math.floor(
    (parseDateOnly(endDate).getTime() - parseDateOnly(startDate).getTime()) /
      86_400_000,
  ) + 1;

export const assertBlockingLeaveExpansionBound = (
  leaveRequests: EmployeeLeaveRequest[],
  anchorRangeStart: string,
  anchorRangeEnd: string,
) => {
  if (leaveRequests.length > MAX_BLOCKING_LEAVE_ROWS) {
    throw new BadRequestException(BLOCKING_LEAVE_COMPLEXITY_ERROR);
  }
  let derivedIntervals = 0;
  for (const leave of leaveRequests) {
    if (!BLOCKING_LEAVE_TYPES.has(leave.type)) continue;
    if (!leave.startTime || !leave.endTime) {
      derivedIntervals += 1;
    } else {
      const firstAnchor =
        leave.startDate > anchorRangeStart ? leave.startDate : anchorRangeStart;
      const lastAnchor =
        leave.endDate < anchorRangeEnd ? leave.endDate : anchorRangeEnd;
      if (firstAnchor <= lastAnchor) {
        derivedIntervals += inclusiveDateSpan(firstAnchor, lastAnchor);
      }
    }
    if (derivedIntervals > MAX_DERIVED_BLOCKING_LEAVE_INTERVALS) {
      throw new BadRequestException(BLOCKING_LEAVE_COMPLEXITY_ERROR);
    }
  }
};

/**
 * Convert leave to absolute Asia/Ho_Chi_Minh wall-clock intervals. Vietnam has
 * no DST, so date-only epoch minutes preserve ordering across midnight.
 */
export const toBlockingLeaveIntervals = (
  leave: Pick<
    EmployeeLeaveRequest,
    'type' | 'startDate' | 'endDate' | 'startTime' | 'endTime'
  > & { shiftAssignmentId?: string | null },
  anchorRangeStart: string,
  anchorRangeEnd: string,
): ShiftInterval[] => {
  if (!BLOCKING_LEAVE_TYPES.has(leave.type)) return [];
  // A sudden absence is asked for one shift: it frees that shift only (whose
  // assignment still holds its time), not the whole day.
  if (leave.type === LeaveType.SUDDEN && leave.shiftAssignmentId) return [];

  if (!leave.startTime || !leave.endTime) {
    return [
      {
        start: parseDateOnly(leave.startDate).getTime() / 60000,
        end: parseDateOnly(addDays(leave.endDate, 1)).getTime() / 60000,
      },
    ];
  }

  const firstAnchor =
    leave.startDate > anchorRangeStart ? leave.startDate : anchorRangeStart;
  const lastAnchor =
    leave.endDate < anchorRangeEnd ? leave.endDate : anchorRangeEnd;
  if (firstAnchor > lastAnchor) return [];

  const intervals: ShiftInterval[] = [];
  for (
    let anchor = firstAnchor;
    anchor <= lastAnchor;
    anchor = addDays(anchor, 1)
  ) {
    intervals.push(toShiftInterval(anchor, leave.startTime, leave.endTime));
  }
  return intervals;
};

export const mergeIntervals = (intervals: ShiftInterval[]): ShiftInterval[] => {
  const sorted = sortIntervals(intervals);
  const merged: ShiftInterval[] = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.start > previous.end) {
      merged.push({ ...interval });
    } else if (interval.end > previous.end) {
      previous.end = interval.end;
    }
  }
  return merged;
};

/**
 * Công tắc "Nhận thông báo khi có ca mới được tạo" ở màn Nhắc tôi — báo khi
 * chủ mở ca mới để đăng ký. Mặc định bật; chỉ tắt khi nhân viên chủ động tắt.
 * Không ảnh hưởng thông báo ca chủ xếp hay duyệt cho chính nhân viên.
 */
export const shouldNotifyNewShifts = (reminderSettings: unknown): boolean =>
  (reminderSettings as { notifyNewShifts?: unknown } | null)
    ?.notifyNewShifts !== false;

/** GPS_QR chosen for a store without saved coordinates. */
export const STORE_LOCATION_REQUIRED_CODE = 'STORE_LOCATION_REQUIRED';

/** Registering to a deleted (hidden) shift. */
export const WORK_SHIFT_INACTIVE_CODE = 'WORK_SHIFT_INACTIVE';

export const WORK_SHIFT_INACTIVE_MESSAGE =
  'Ca làm việc này đã bị xoá, vui lòng chọn ca khác';

/** Stable 409 code of DELETE work-shifts when booked upcoming days remain. */
export const WORK_SHIFT_HAS_UPCOMING_ASSIGNMENTS =
  'WORK_SHIFT_HAS_UPCOMING_ASSIGNMENTS';

/**
 * Tên ca được phép trùng, miễn các ca cùng tên không làm cùng ngày. Trả về
 * ngày đầu tiên có ca khác (đang hoạt động, chu kỳ chưa dừng) trùng tên với
 * một trong `names` — null nếu không trùng.
 */
export const findSameNameShiftOnDates = async (
  manager: EntityManager,
  storeId: string,
  names: string[],
  workDates: string[],
  excludeShiftIds: string[] = [],
): Promise<{ shiftName: string; workDate: string } | null> => {
  const wanted = new Set(names.map(normalizeActiveShiftName));
  if (wanted.size === 0 || workDates.length === 0) return null;
  const rows: Array<{ shift_name: string; work_date: string }> =
    await manager.query(
      `SELECT ws.shift_name, to_char(ss.work_date, 'YYYY-MM-DD') AS work_date
         FROM shift_slots ss
         JOIN work_shifts ws ON ws.id = ss.work_shift_id
         JOIN work_cycles wc ON wc.id = ss.cycle_id
        WHERE ws.store_id = $1
          AND ws.is_active = true
          AND wc.status IN ('ACTIVE', 'EXPIRED')
          AND ss.work_date = ANY($2::date[])
          AND NOT (ws.id = ANY($3::uuid[]))
        ORDER BY ss.work_date ASC`,
      [storeId, workDates, excludeShiftIds],
    );
  const hit = (Array.isArray(rows) ? rows : []).find(
    (row) =>
      typeof row?.shift_name === 'string' &&
      wanted.has(normalizeActiveShiftName(row.shift_name)),
  );
  return hit ? { shiftName: hit.shift_name, workDate: hit.work_date } : null;
};

export const sameNameShiftMessage = (hit: {
  shiftName: string;
  workDate: string;
}) => {
  const [year, month, day] = hit.workDate.split('-');
  return `Đã có ca "${hit.shiftName}" vào ngày ${day}/${month}/${year}. Tên ca chỉ được trùng khi khác ngày.`;
};

/**
 * A new schedule's first day must not start in the past — checked for every
 * shift of the form, not only the first (Vietnam time).
 */
export function assertShiftsStartAhead(
  drafts: Array<{ shiftName: string; startTime: string }>,
  firstWorkDate: string | undefined,
  now: Date,
): void {
  if (!firstWorkDate) return;
  const today = vnDateString(now);
  const date = String(firstWorkDate).slice(0, 10);
  const clock = vnClockHHmm(now);
  const past = drafts.filter(
    (draft) =>
      date < today ||
      // Before the current minute: 04:30 is still accepted at 04:30.
      (date === today && String(draft.startTime).slice(0, 5) < clock),
  );
  if (past.length) {
    throw new BadRequestException({
      code: 'SHIFT_START_PASSED',
      message: `${past.map((d) => d.shiftName).join(', ')}: thời gian bắt đầu không được trước thời gian hiện tại`,
      shiftNames: past.map((d) => d.shiftName),
    });
  }
}
