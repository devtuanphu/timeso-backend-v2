import { effectiveWindowOf } from './attendance-time.utils';
import { leaveCoversShift } from './leave-coverage.utils';

/** An approved request that changes one shift, as the owner's calendar shows it. */
export interface ShiftRequestInfo {
  id: string;
  kind: 'LATE' | 'EARLY' | 'OVERTIME' | 'SUDDEN' | 'LEAVE';
  /** "HH:mm": late — new start; early — new end; overtime — its span; absence — the shift. */
  startTime: string | null;
  endTime: string | null;
  /** Minutes late / early / of overtime / of the shift missed. */
  minutes: number | null;
  reason: string | null;
  approvedByAccountId: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
}

/** What approved requests do to one assignment. */
export interface ShiftRequestEffects {
  requests: ShiftRequestInfo[];
  /** An approved absence (leave / sudden absence) covers it and it was not worked. */
  onLeave: boolean;
  /** "HH:mm" of the start / end in force when an approval moved them; null = scheduled. */
  effectiveStartTime: string | null;
  effectiveEndTime: string | null;
  /** "HH:mm" end of the approved overtime, or null. */
  overtimeEndTime: string | null;
  /** Hours the shift is planned for now: in force + overtime; 0 on leave. */
  plannedHours: number;
}

interface LeaveLike {
  id: string;
  type: string;
  status?: string;
  employeeProfileId: string;
  startDate: string | Date;
  endDate: string | Date;
  startTime?: string | null;
  endTime?: string | null;
  shiftAssignmentId?: string | null;
  reason?: string | null;
  approvedById?: string | null;
  updatedAt?: Date | string | null;
}

interface OvertimeLike {
  id: string;
  shiftAssignmentId?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string | null;
  approvedById?: string | null;
  updatedAt?: Date | string | null;
}

interface AssignmentLike {
  id: string;
  employeeId: string;
  checkInTime?: Date | null;
  adjustedStartAt?: Date | string | null;
  adjustedEndAt?: Date | string | null;
  lateRequestId?: string | null;
  earlyRequestId?: string | null;
}

interface SlotLike {
  workDate: string | Date;
  startTime?: string | null;
  endTime?: string | null;
  workShift?: { startTime?: string | null; endTime?: string | null } | null;
}

export interface ApproverLookup {
  /** EmployeeProfile id → account of whoever approved. */
  profiles: Map<string, { accountId: string | null; name: string | null }>;
  /** The store owner, who approves when no profile was recorded. */
  owner: { accountId: string | null; name: string | null };
}

const VN_OFFSET_MS = 7 * 3_600_000;
const clockOf = (at: Date | null): string | null =>
  at ? new Date(at.getTime() + VN_OFFSET_MS).toISOString().slice(11, 16) : null;
const hhmm = (value?: string | null): string | null => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ''));
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
};
const minutesBetween = (from: Date | null, to: Date | null): number | null =>
  from && to ? Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000)) : null;
const spanMinutes = (start?: string | null, end?: string | null): number | null => {
  const a = /^(\d{1,2}):(\d{2})/.exec(String(start ?? ''));
  const b = /^(\d{1,2}):(\d{2})/.exec(String(end ?? ''));
  if (!a || !b) return null;
  let minutes = Number(b[1]) * 60 + Number(b[2]) - (Number(a[1]) * 60 + Number(a[2]));
  if (minutes <= 0) minutes += 24 * 60;
  return minutes;
};
const iso = (value?: Date | string | null): string | null => {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
};

const approverOf = (approvedById: string | null | undefined, lookup: ApproverLookup) => {
  const profile = approvedById ? lookup.profiles.get(approvedById) : undefined;
  // Only the store owner approves; without a recorded profile it was them.
  return profile ?? lookup.owner;
};

const ABSENCE_KINDS = new Set(['SICK', 'PERSONAL', 'VACATION', 'UNPAID', 'OTHER', 'SUDDEN']);

/**
 * The approved requests of one assignment and what they do to it: late
 * arrival / early leave (the times in force), overtime (the end it runs to)
 * and an absence (nothing planned). Hours are what the shift is planned for
 * now — the owner's calendar statistics follow them.
 */
export function shiftRequestEffects(input: {
  assignment: AssignmentLike;
  slot: SlotLike;
  leaves: LeaveLike[];
  overtimes: OvertimeLike[];
  approvers: ApproverLookup;
}): ShiftRequestEffects {
  const { assignment: a, slot } = input;
  const workDate = String(slot.workDate ?? '').slice(0, 10);
  const window = effectiveWindowOf({
    adjustedStartAt: a.adjustedStartAt ?? null,
    adjustedEndAt: a.adjustedEndAt ?? null,
    shiftSlot: slot as any,
  });
  const requests: ShiftRequestInfo[] = [];
  const approval = (request: { approvedById?: string | null; updatedAt?: Date | string | null }) => {
    const approver = approverOf(request.approvedById, input.approvers);
    return {
      approvedByAccountId: approver.accountId,
      approvedByName: approver.name,
      approvedAt: iso(request.updatedAt),
    };
  };

  let onLeave = false;
  for (const leave of input.leaves) {
    if (leave.employeeProfileId !== a.employeeId) continue;
    const type = String(leave.type);
    if (type === 'LATE' && (leave.shiftAssignmentId === a.id || a.lateRequestId === leave.id)) {
      requests.push({
        id: leave.id,
        kind: 'LATE',
        startTime: clockOf(window.start) ?? hhmm(leave.startTime),
        endTime: null,
        minutes: minutesBetween(window.scheduledStart, window.start),
        reason: leave.reason ?? null,
        ...approval(leave),
      });
    } else if (type === 'EARLY' && (leave.shiftAssignmentId === a.id || a.earlyRequestId === leave.id)) {
      requests.push({
        id: leave.id,
        kind: 'EARLY',
        startTime: null,
        endTime: clockOf(window.end) ?? hhmm(leave.endTime),
        minutes: minutesBetween(window.end, window.scheduledEnd),
        reason: leave.reason ?? null,
        ...approval(leave),
      });
    } else if (
      ABSENCE_KINDS.has(type) &&
      workDate &&
      leaveCoversShift(
        {
          type,
          status: leave.status,
          startDate: String(leave.startDate).slice(0, 10),
          endDate: String(leave.endDate).slice(0, 10),
          startTime: leave.startTime ?? null,
          endTime: leave.endTime ?? null,
          shiftAssignmentId: leave.shiftAssignmentId ?? null,
        },
        workDate,
        a.id,
      )
    ) {
      if (!a.checkInTime) onLeave = true;
      requests.push({
        id: leave.id,
        kind: type === 'SUDDEN' ? 'SUDDEN' : 'LEAVE',
        startTime: clockOf(window.scheduledStart),
        endTime: clockOf(window.scheduledEnd),
        minutes: minutesBetween(window.scheduledStart, window.scheduledEnd),
        reason: leave.reason ?? null,
        ...approval(leave),
      });
    }
  }

  let overtimeEndTime: string | null = null;
  let overtimeMinutes = 0;
  for (const overtime of input.overtimes) {
    if (overtime.shiftAssignmentId !== a.id) continue;
    const minutes = spanMinutes(overtime.startTime, overtime.endTime);
    overtimeEndTime = hhmm(overtime.endTime);
    overtimeMinutes = minutes ?? 0;
    requests.push({
      id: overtime.id,
      kind: 'OVERTIME',
      startTime: hhmm(overtime.startTime),
      endTime: overtimeEndTime,
      minutes,
      reason: overtime.reason ?? null,
      ...approval(overtime),
    });
  }

  const adjusted = !!(a.adjustedStartAt || a.adjustedEndAt);
  const inForce = minutesBetween(window.start, window.end) ?? 0;
  return {
    requests,
    onLeave,
    effectiveStartTime: adjusted && a.adjustedStartAt ? clockOf(window.start) : null,
    effectiveEndTime: adjusted && a.adjustedEndAt ? clockOf(window.end) : null,
    overtimeEndTime,
    plannedHours: onLeave ? 0 : Math.round(((inForce + overtimeMinutes) / 60) * 100) / 100,
  };
}
