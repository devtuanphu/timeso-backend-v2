/**
 * Nội dung thông báo gửi nhân viên khi chủ xếp ca cho họ hoặc duyệt ca họ đã
 * đăng ký.
 *
 * Trước đây cả hai việc chỉ ghi assignment rồi lên lịch nhắc sát giờ làm, nên
 * nhân viên chỉ biết mình có ca mới khi tự mở lịch hoặc khi ca sắp bắt đầu.
 */
export type ShiftNotificationKind = 'assigned' | 'approved';

export interface ShiftForNotification {
  workDate: string; // YYYY-MM-DD
  startTime?: string | null;
  endTime?: string | null;
  shiftName?: string | null;
}

const dayMonth = (workDate: string) => {
  const [, month, day] = workDate.slice(0, 10).split('-');
  return `${day}/${month}`;
};

const clock = (time?: string | null) => (time ? time.slice(0, 5) : '');

/** Giờ kết thúc 00:00 là hết ngày — viết "24:00" như cách chủ và nhân viên gọi. */
const endClock = (time?: string | null) => {
  const value = clock(time);
  return value === '00:00' ? '24:00' : value;
};

export function buildShiftNotification(
  kind: ShiftNotificationKind,
  shifts: ShiftForNotification[],
): { title: string; content: string } {
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
    const what = `${shift.shiftName || 'Ca làm'} ngày ${dayMonth(shift.workDate)}${range}`;
    return kind === 'assigned'
      ? {
          title: 'Bạn có ca làm mới',
          content: `Chủ cửa hàng đã xếp cho bạn ${what}.`,
        }
      : {
          // Nội dung theo đúng câu chủ cửa hàng yêu cầu; ngày để ở tiêu đề.
          title: `Đăng ký ca thành công · ngày ${dayMonth(shift.workDate)}`,
          content:
            shift.startTime && shift.endTime
              ? `Ca ${clock(shift.startTime)}-${endClock(shift.endTime)} đã được đăng ký thành công`
              : `${shift.shiftName || 'Ca làm'} đã được đăng ký thành công`,
        };
  }

  const first = dayMonth(sorted[0].workDate);
  const last = dayMonth(sorted[sorted.length - 1].workDate);
  const span = first === last ? `ngày ${first}` : `từ ${first} đến ${last}`;
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
