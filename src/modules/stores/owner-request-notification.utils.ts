import { describeWorkDate } from '../../common/utils/relative-day';
import { formatDurationVi } from './attendance-time.utils';

/** What an employee asked for, as the owner is told about it. */
export type OwnerRequestKind =
  | 'LATE'
  | 'EARLY'
  | 'SUDDEN'
  | 'LEAVE'
  | 'OVERTIME'
  | 'SALARY_INQUIRY'
  | 'SALARY_ADVANCE';

/** `metadata.type` of the owner notification, per kind. */
export const OWNER_REQUEST_NOTIFICATION_TYPE: Record<OwnerRequestKind, string> = {
  LATE: 'OWNER_LATE_REQUEST',
  EARLY: 'OWNER_EARLY_REQUEST',
  SUDDEN: 'OWNER_SUDDEN_LEAVE_REQUEST',
  LEAVE: 'OWNER_LEAVE_REQUEST',
  OVERTIME: 'OWNER_OVERTIME_REQUEST',
  SALARY_INQUIRY: 'OWNER_SALARY_INQUIRY',
  SALARY_ADVANCE: 'OWNER_SALARY_ADVANCE_REQUEST',
};

export interface OwnerRequestNotificationInput {
  kind: OwnerRequestKind;
  /** Employee's name. */
  who: string;
  shiftName?: string | null;
  /** YYYY-MM-DD of the shift (or the first leave day). */
  workDate?: string | null;
  /** Last leave day, for a multi-day leave. */
  endDate?: string | null;
  /** "HH:mm" of the shift in force. */
  shiftStart?: string | null;
  shiftEnd?: string | null;
  /** "HH:mm" asked for: arrival (late), leave (early), overtime end. */
  time?: string | null;
  /** Minutes late / early / of overtime the request means. */
  minutes?: number | null;
  reason?: string | null;
  /** Salary advance amount (VND). */
  amount?: number | null;
  /** Salary inquiry text. */
  question?: string | null;
  now?: Date;
}

const hhmm = (value?: string | null): string | null => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ''));
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
};

const ddmm = (ymd?: string | null): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? ''));
  return match ? `${match[3]}/${match[2]}` : null;
};

const money = (amount: number): string =>
  `${Math.round(amount).toLocaleString('vi-VN')}đ`;

/**
 * Title and text of the owner's notification for a new request — the kind,
 * who, which shift and when, the time asked for (with its length in hours
 * and minutes) and the reason, so the owner can decide from the
 * notification itself.
 */
export function describeOwnerRequestNotification(
  input: OwnerRequestNotificationInput,
): { title: string; content: string } {
  const now = input.now ?? new Date();
  const reason = input.reason?.trim() ? ` Lý do: ${input.reason.trim()}` : '';
  const day =
    input.workDate && /^\d{4}-\d{2}-\d{2}/.test(input.workDate)
      ? describeWorkDate(input.workDate.slice(0, 10), now)
      : null;
  const start = hhmm(input.shiftStart);
  const end = hhmm(input.shiftEnd);
  const hours = start && end ? ` (${start}–${end})` : '';
  const shift = `${input.shiftName?.trim() || 'ca làm'}${day ? ` ${day}` : ''}${hours}`;
  const time = hhmm(input.time);
  const length =
    input.minutes && input.minutes > 0 ? formatDurationVi(input.minutes) : null;

  switch (input.kind) {
    case 'LATE':
      return {
        title: 'Nhân viên xin đi trễ',
        content: `${input.who} xin đi trễ ${shift}${time ? `, đến lúc ${time}` : ''}${
          length ? ` (trễ ${length})` : ''
        }.${reason}`,
      };
    case 'EARLY':
      return {
        title: 'Nhân viên xin về sớm',
        content: `${input.who} xin về sớm ${shift}${time ? `, về lúc ${time}` : ''}${
          length ? ` (sớm ${length})` : ''
        }.${reason}`,
      };
    case 'SUDDEN':
      return {
        title: 'Nhân viên xin nghỉ đột xuất',
        content: `${input.who} xin nghỉ đột xuất ${shift}.${reason}`,
      };
    case 'OVERTIME':
      return {
        title: 'Nhân viên xin tăng ca',
        content: `${input.who} xin tăng ca ${shift}${time ? ` đến ${time}` : ''}${
          length ? ` (${length})` : ''
        }.${reason}`,
      };
    case 'SALARY_INQUIRY':
      return {
        title: 'Nhân viên hỏi về bảng lương',
        content: `${input.who}: ${input.question?.trim() || '(không có nội dung)'}`,
      };
    case 'SALARY_ADVANCE':
      return {
        title: 'Nhân viên xin ứng lương',
        content: `${input.who} xin ứng ${money(Number(input.amount) || 0)}.${reason}`,
      };
    case 'LEAVE':
    default: {
      const from = ddmm(input.workDate);
      const to = ddmm(input.endDate);
      const range = from && to && to !== from ? ` từ ${from} đến ${to}` : from ? ` ngày ${from}` : '';
      return {
        title: 'Nhân viên xin nghỉ phép',
        content: `${input.who} xin nghỉ phép${range}.${reason}`,
      };
    }
  }
}
