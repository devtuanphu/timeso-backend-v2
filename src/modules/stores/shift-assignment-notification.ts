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
