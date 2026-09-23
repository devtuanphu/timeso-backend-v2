/**
 * Nội dung thông báo gửi nhân viên khi chủ xếp ca cho họ hoặc duyệt ca họ đã
 * đăng ký.
 *
 * Trước đây cả hai việc chỉ ghi assignment rồi lên lịch nhắc sát giờ làm, nên
 * nhân viên chỉ biết mình có ca mới khi tự mở lịch hoặc khi ca sắp bắt đầu.
 */
import {
  describeWorkDate,
  describeWorkDateRange,
  workDatesMetadata,
} from '../../common/utils/relative-day';
import {
  isSlotRegistrationClosed,
  normalizeWorkDate,
} from './shift-registration-window';

/**
 * - assigned: chủ xếp ca cho nhân viên;
 * - approved: chủ duyệt ca nhân viên đã đăng ký;
 * - created: chủ vừa mở ca mới, còn chỗ để nhân viên đăng ký.
 */
export type ShiftNotificationKind = 'assigned' | 'approved' | 'created';

export interface ShiftForNotification {
  workDate: string; // YYYY-MM-DD
  startTime?: string | null;
  endTime?: string | null;
  shiftName?: string | null;
}

const clock = (time?: string | null) => (time ? time.slice(0, 5) : '');

/** Giờ kết thúc 00:00 là hết ngày — viết "24:00" như cách chủ và nhân viên gọi. */
const endClock = (time?: string | null) => {
  const value = clock(time);
  return value === '00:00' ? '24:00' : value;
};

export function buildShiftNotification(
  kind: ShiftNotificationKind,
  shifts: ShiftForNotification[],
  now: Date = new Date(),
): { title: string; content: string } {
  // "hôm nay (18/09)" / "ngày mai (19/09)" / "ngày 25/09".
  const when = (workDate: string) => describeWorkDate(workDate, now);
  const sorted = [...shifts].sort(
    (a, b) =>
      a.workDate.localeCompare(b.workDate) ||
      clock(a.startTime).localeCompare(clock(b.startTime)),
  );

  if (sorted.length === 1) {
    const shift = sorted[0];
    const range =
      shift.startTime && shift.endTime
        ? ` (${clock(shift.startTime)}–${clock(shift.endTime)})`
        : '';
    const what = `${shift.shiftName || 'Ca làm'} ${when(shift.workDate)}${range}`;
    if (kind === 'created') {
      return {
        title: 'Có ca mới để đăng ký',
        content: `Cửa hàng vừa mở ${what}. Vào đăng ký ngay nhé!`,
      };
    }
    return kind === 'assigned'
      ? {
          title: 'Bạn có ca làm mới',
          content: `Chủ cửa hàng đã xếp cho bạn ${what}.`,
        }
      : {
          // Nội dung theo đúng câu chủ cửa hàng yêu cầu; ngày để ở tiêu đề.
          title: `Đăng ký ca thành công · ${when(shift.workDate)}`,
          content:
            shift.startTime && shift.endTime
              ? `Ca ${clock(shift.startTime)}-${endClock(shift.endTime)} đã được đăng ký thành công`
              : `${shift.shiftName || 'Ca làm'} đã được đăng ký thành công`,
        };
  }

  // Một ngày: "hôm nay (18/09)"; nhiều ngày: "từ 18/09 đến 20/09 (có hôm
  // nay)". So cả năm (ngày dạng YYYY-MM-DD), không chỉ dd/mm.
  const dates = sorted.map((shift) => shift.workDate.slice(0, 10));
  const span =
    new Set(dates).size === 1
      ? when(dates[0])
      : describeWorkDateRange(dates, now);
  if (kind === 'created') {
    return {
      title: 'Có ca mới để đăng ký',
      content: `Cửa hàng vừa mở ${sorted.length} ca mới, ${span}. Vào đăng ký ngay nhé!`,
    };
  }
  return kind === 'assigned'
    ? {
        title: 'Bạn có ca làm mới',
        content: `Chủ cửa hàng đã xếp cho bạn ${sorted.length} ca, ${span}.`,
      }
    : {
        title: 'Đăng ký ca thành công',
        content: `${sorted.length} ca ${span} đã được đăng ký thành công`,
      };
}

/**
 * Metadata ngày làm cho thông báo ca (để danh sách thông báo tính lại "hôm
 * nay / ngày mai" theo lúc đọc): `workDates`, hoặc `workDateRange` khi nhiều.
 */
export function shiftNotificationDateMetadata(shifts: ShiftForNotification[]) {
  return workDatesMetadata(shifts.map((shift) => shift.workDate));
}

/**
 * A shift announced as "Có ca mới để đăng ký". `assignedProfileIds` are the
 * people already holding a seat on it: they are never told about that shift
 * (the picked person gets "Bạn có ca làm mới" instead).
 */
export interface AnnouncedShift extends ShiftForNotification {
  assignedProfileIds?: string[];
}

/** The announced shifts a given employee is not already booked on. */
export function shiftsOpenTo(
  profileId: string,
  shifts: AnnouncedShift[],
): AnnouncedShift[] {
  return shifts.filter(
    (shift) => !(shift.assignedProfileIds ?? []).includes(profileId),
  );
}

/** One owner-created shift row of a schedule, repeated on every work date. */
export interface CreatedShiftDraft {
  shiftName?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  maxStaff: number;
  /** Employee profile ids the owner picked for this shift. */
  employeeIds: string[];
}

/**
 * What the "Có ca mới để đăng ký" notice announces for a new schedule:
 * shifts that still have a free seat and have not started yet (VN time).
 * A full shift (every seat picked, the owner app's default of one seat and
 * one picked person) announces nothing to others. Each shift carries the
 * profiles picked for it, so nobody is told about a shift they already hold;
 * profiles picked for every such shift are excluded altogether.
 */
export function selectCreatedShiftAnnouncement(
  drafts: CreatedShiftDraft[],
  workDates: string[],
  now: Date = new Date(),
): { shifts: AnnouncedShift[]; excludeProfileIds: string[] } {
  const openDrafts = drafts
    .filter((draft) => draft.employeeIds.length < draft.maxStaff)
    .map((draft) => ({
      employeeIds: draft.employeeIds,
      shifts: workDates
        .map((workDate) => ({
          workDate,
          startTime: draft.startTime,
          endTime: draft.endTime,
          shiftName: draft.shiftName,
          assignedProfileIds: [...new Set(draft.employeeIds)],
        }))
        .filter((shift) => !isSlotRegistrationClosed(shift, null, now)),
    }))
    .filter((draft) => draft.shifts.length > 0);
  const excludeProfileIds = openDrafts.length
    ? [...new Set(openDrafts[0].employeeIds)].filter((profileId) =>
        openDrafts.every((draft) => draft.employeeIds.includes(profileId)),
      )
    : [];
  return {
    shifts: openDrafts.flatMap((draft) => draft.shifts),
    excludeProfileIds,
  };
}

/** An existing slot, as read after the owner changed it. */
export interface SlotSeatState {
  workDate: string | Date;
  startTime?: string | null;
  endTime?: string | null;
  /** Effective seat count (slot override, else template); 0/null = unlimited. */
  maxStaff: number | null;
  shiftName?: string | null;
  /** The work shift template's times, used when the slot has no override. */
  templateStartTime?: string | null;
  templateEndTime?: string | null;
  /** Profiles holding a seat (every assignment that is not CANCELLED). */
  holderProfileIds: string[];
}

/**
 * The announcement for an existing slot that just gained a free seat (the
 * owner raised `maxStaff`, or cancelled someone): null when the slot is full
 * or has already started (VN time).
 */
export function selectFreeSeatAnnouncement(
  slot: SlotSeatState,
  now: Date = new Date(),
): AnnouncedShift | null {
  const workDate = normalizeWorkDate(slot.workDate);
  if (!workDate) return null;
  const holders = [...new Set(slot.holderProfileIds)];
  const seats = Number(slot.maxStaff) || 0;
  if (seats > 0 && holders.length >= seats) return null;
  const startTime = slot.startTime ?? slot.templateStartTime ?? null;
  if (isSlotRegistrationClosed({ workDate, startTime }, null, now)) return null;
  return {
    workDate,
    startTime,
    endTime: slot.endTime ?? slot.templateEndTime ?? null,
    shiftName: slot.shiftName ?? null,
    assignedProfileIds: holders,
  };
}

/**
 * Keeps one slot from being announced again and again (the owner removing
 * several people, or raising the seat count step by step): a slot is
 * announced at most once per window. Per process and in memory — a restart
 * or a second instance can announce once more, which is acceptable for a
 * best-effort notice. Bounded: old entries are pruned.
 */
export class SlotAnnouncementThrottle {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly windowMs = 15 * 60_000,
    private readonly maxEntries = 5_000,
  ) {}

  /** True when the slot may be announced now (and records it). */
  claim(slotId: string, nowMs: number = Date.now()): boolean {
    const previous = this.last.get(slotId);
    if (previous !== undefined && nowMs - previous < this.windowMs) {
      return false;
    }
    if (this.last.size >= this.maxEntries) {
      for (const [key, at] of this.last) {
        if (nowMs - at >= this.windowMs) this.last.delete(key);
      }
      if (this.last.size >= this.maxEntries) {
        const oldest = this.last.keys().next().value;
        if (oldest !== undefined) this.last.delete(oldest);
      }
    }
    this.last.delete(slotId);
    this.last.set(slotId, nowMs);
    return true;
  }
}
