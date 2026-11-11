/**
 * Lịch cá nhân của nhân viên (lịch trống / lịch bận / lịch học), xem
 * entities/employee-personal-schedule.entity.ts.
 *
 * - Một khung giờ gắn một ngày (VN). Giờ kết thúc <= giờ bắt đầu = qua đêm,
 *   kết thúc ngày hôm sau (cùng quy ước toShiftInterval của ca làm); hai giờ
 *   bằng nhau bị từ chối.
 * - Lặp hằng tuần: khung giờ có hiệu lực mọi ngày cùng thứ, từ ngày của nó trở
 *   đi. Lặp hằng tháng: mọi ngày cùng số ngày trong tháng (tháng thiếu ngày đó
 *   thì bỏ qua). Không lặp: đúng ngày đó.
 * - Chỉ để chủ tham khảo: cảnh báo khi xếp ca, không chặn.
 */
import { PaymentType } from './entities/employee-contract.entity';
import {
  PersonalScheduleKind,
  PersonalScheduleRepeat,
  PersonalScheduleSlot,
} from './entities/employee-personal-schedule.entity';
import {
  computeEarnedBase,
  resolvePayrollPaymentType,
} from './payroll-calculation.utils';
import {
  intervalsOverlap,
  ShiftInterval,
  timeToMinutes,
  toShiftInterval,
} from './service-parts/shared';
import { addDays, parseDateOnly } from './shift-schedule.utils';

export const PERSONAL_SCHEDULE_MAX_SLOTS = 50;
export const PERSONAL_SCHEDULE_MAX_PER_EMPLOYEE = 50;
export const PERSONAL_SCHEDULE_NOTE_MAX = 100;
/** "Mong muốn được hỗ trợ" của một loại lịch. */
export const PERSONAL_SCHEDULE_WISH_MAX = 200;
/** "Mong muốn số ngày làm (tham khảo)": 1–7 ngày / tuần. */
export const PERSONAL_SCHEDULE_DESIRED_DAYS_MAX = 7;
/** "Mong muốn số giờ mỗi ca (tham khảo)": 1–12 tiếng / ca. */
export const PERSONAL_SCHEDULE_DESIRED_HOURS_MAX = 12;
/** Ước tính theo thiết kế: 1 tháng = 4 tuần (4 ngày / tuần → 16 ngày / tháng). */
export const PREFERENCE_WEEKS_PER_MONTH = 4;

/** Ước tính từ mong muốn số ngày / tuần và số giờ / ca. */
export interface PreferenceEstimate {
  /** Tổng số giờ dự kiến mỗi tuần = ngày × giờ; null khi thiếu một trong hai. */
  hoursPerWeek: number | null;
  /** Số ngày dự kiến mỗi tháng = ngày × 4; null khi chưa chọn số ngày. */
  daysPerMonth: number | null;
  /**
   * Thu nhập ước tính mỗi tháng (đồng), theo hợp đồng đang hiệu lực đúng như
   * cách tính lương (computeEarnedBase); null khi không tính được (chưa có
   * hợp đồng / mức lương, chưa chọn đủ, hoặc không được trả cho người xem).
   */
  monthlyIncome: number | null;
  /** Hình thức trả lương dùng để ước tính ('Giờ', 'Ca'…); null khi không có hợp đồng. */
  paymentType: PaymentType | null;
}

const preferenceValue = (value: unknown, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max
    ? value
    : null;

/**
 * Ước tính cho khung "Hỗ trợ" ở Lịch học / Lịch bận. Thu nhập dùng đúng công
 * thức lương (computeEarnedBase) với giả định mỗi ngày một ca:
 * - Giờ: mức lương × (ngày × 4 × giờ); Ca / Ngày: mức lương × (ngày × 4);
 * - Tuần: mức lương × (ngày × 4) ÷ 6; Tháng (và không rõ hình thức): mức lương
 *   ÷ số ngày công chuẩn × (ngày × 4) — không giới hạn trần, như phiếu lương.
 * Chỉ là lương theo giờ / ca: không có phụ cấp, thưởng, phạt.
 */
export function estimateFromPreferences(input: {
  daysPerWeek: number | null | undefined;
  hoursPerShift: number | null | undefined;
  /** Hợp đồng đang hiệu lực với mức lương đã tính điều chỉnh + đơn giá; null = không có. */
  contract: { paymentType: PaymentType | string | null | undefined; rate: number } | null;
  standardWorkingDays: number;
  calendarDays: number;
}): PreferenceEstimate {
  const days = preferenceValue(input.daysPerWeek, PERSONAL_SCHEDULE_DESIRED_DAYS_MAX);
  const hours = preferenceValue(input.hoursPerShift, PERSONAL_SCHEDULE_DESIRED_HOURS_MAX);
  const daysPerMonth = days ? days * PREFERENCE_WEEKS_PER_MONTH : null;
  const hoursPerWeek = days && hours ? days * hours : null;
  const paymentType = input.contract
    ? resolvePayrollPaymentType(input.contract.paymentType)
    : null;
  let monthlyIncome: number | null = null;
  // Lương giờ cần cả số giờ mỗi ca; các hình thức khác chỉ cần số ngày.
  if (
    input.contract &&
    paymentType &&
    daysPerMonth &&
    (paymentType !== PaymentType.HOUR || hours)
  ) {
    const income = computeEarnedBase({
      paymentType,
      rate: input.contract.rate,
      facts: {
        completedShifts: daysPerMonth,
        workedMinutes: daysPerMonth * (hours ?? 0) * 60,
        daysWorked: daysPerMonth,
      },
      standardWorkingDays: input.standardWorkingDays,
      calendarDays: input.calendarDays,
    });
    monthlyIncome = income > 0 ? income : null;
  }
  return { hoursPerWeek, daysPerMonth, monthlyIncome, paymentType };
}

/**
 * Ngày của khung giờ không được xa hơn chừng này ngày sau hôm nay (VN). Không
 * chặn ngày đã qua: lịch lặp tạo từ lâu vẫn đang có hiệu lực và phải sửa được.
 */
export const PERSONAL_SCHEDULE_DATE_WINDOW_DAYS = 366;
/** Ngày sớm nhất nhận (chặn ngày vô lý, không phải luật nghiệp vụ). */
export const PERSONAL_SCHEDULE_MIN_DATE = '2020-01-01';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Câu cảnh báo kể tối đa chừng này khung giờ bị trùng, còn lại là "…". */
const PERSONAL_WARNING_MAX_RANGES = 3;

/** "09:00" → "9h", "09:30" → "9h30" (cách nói giờ trong câu cảnh báo). */
const shortClock = (time: string) => {
  const [hour, minute] = time.split(':');
  return `${Number(hour)}h${minute === '00' ? '' : minute}`;
};

export const PERSONAL_SCHEDULE_LABELS: Record<PersonalScheduleKind, string> = {
  AVAILABLE: 'Lịch trống',
  BUSY: 'Lịch bận',
  STUDY: 'Lịch học',
};

/** Lịch tối thiểu cần để tính khung giờ có hiệu lực. */
export interface PersonalScheduleLike {
  kind: PersonalScheduleKind;
  repeat: PersonalScheduleRepeat;
  slots: PersonalScheduleSlot[];
}

const isValidDate = (value: string) => {
  try {
    parseDateOnly(value);
    return true;
  } catch {
    return false;
  }
};

const slotKey = (slot: PersonalScheduleSlot) =>
  `${slot.date} ${slot.startTime}-${slot.endTime}`;

/**
 * Kiểm tra và chuẩn hoá các khung giờ (sắp theo ngày, giờ). Trả câu lỗi cho
 * người dùng khi không hợp lệ.
 */
export function normalizePersonalSlots(
  slots: PersonalScheduleSlot[],
  today: string,
): { slots: PersonalScheduleSlot[] } | { error: string } {
  if (!Array.isArray(slots) || slots.length === 0) {
    return { error: 'Chọn ít nhất một khung giờ.' };
  }
  if (slots.length > PERSONAL_SCHEDULE_MAX_SLOTS) {
    return {
      error: `Mỗi lịch có tối đa ${PERSONAL_SCHEDULE_MAX_SLOTS} khung giờ.`,
    };
  }
  const maxDate = addDays(today, PERSONAL_SCHEDULE_DATE_WINDOW_DAYS);

  const normalized: PersonalScheduleSlot[] = [];
  for (const raw of slots) {
    const slot = {
      date: String(raw?.date ?? ''),
      startTime: String(raw?.startTime ?? ''),
      endTime: String(raw?.endTime ?? ''),
    };
    if (!isValidDate(slot.date)) return { error: 'Ngày không hợp lệ.' };
    if (slot.date < PERSONAL_SCHEDULE_MIN_DATE || slot.date > maxDate) {
      return { error: 'Ngày không được quá một năm tính từ hôm nay.' };
    }
    if (
      !TIME_PATTERN.test(slot.startTime) ||
      !TIME_PATTERN.test(slot.endTime)
    ) {
      return { error: 'Giờ phải có dạng HH:mm.' };
    }
    if (slot.startTime === slot.endTime) {
      return { error: 'Giờ kết thúc phải khác giờ bắt đầu.' };
    }
    normalized.push(slot);
  }
  normalized.sort((a, b) => slotKey(a).localeCompare(slotKey(b)));

  // Hai khung giờ chồng nhau trong cùng một lần lưu là nhập nhầm.
  const intervals = normalized.map((slot) =>
    toShiftInterval(slot.date, slot.startTime, slot.endTime),
  );
  for (let i = 0; i < intervals.length; i += 1) {
    for (let j = i + 1; j < intervals.length; j += 1) {
      if (intervalsOverlap(intervals[i], intervals[j])) {
        return { error: 'Các khung giờ không được trùng nhau.' };
      }
    }
  }
  return { slots: normalized };
}

/** Khung giờ đã tính sẵn thứ / ngày trong tháng (gọi lặp nhiều lần khi xếp ca dài). */
interface CompiledSlot extends PersonalScheduleSlot {
  repeat: PersonalScheduleRepeat;
  weekday: number;
  dayOfMonth: string;
  /** Phút từ 00:00 của ngày khung giờ; kết thúc qua đêm đã cộng 24h. */
  startMinute: number;
  endMinute: number;
}

const compileSlot = (
  slot: PersonalScheduleSlot,
  repeat: PersonalScheduleRepeat,
): CompiledSlot => {
  const startMinute = timeToMinutes(slot.startTime);
  let endMinute = timeToMinutes(slot.endTime);
  if (endMinute <= startMinute) endMinute += 24 * 60;
  return {
    ...slot,
    repeat,
    weekday: parseDateOnly(slot.date).getUTCDay(),
    dayOfMonth: slot.date.slice(8, 10),
    startMinute,
    endMinute,
  };
};

const occursOn = (slot: CompiledSlot, date: string, weekday: number) => {
  if (date === slot.date) return true;
  if (date < slot.date) return false;
  if (slot.repeat === PersonalScheduleRepeat.WEEKLY)
    return weekday === slot.weekday;
  if (slot.repeat === PersonalScheduleRepeat.MONTHLY) {
    return date.slice(8, 10) === slot.dayOfMonth;
  }
  return false;
};

/** Khung giờ của `slot` có hiệu lực vào ngày `date` theo kiểu lặp. */
export function slotOccursOn(
  slot: PersonalScheduleSlot,
  repeat: PersonalScheduleRepeat,
  date: string,
): boolean {
  return occursOn(
    compileSlot(slot, repeat),
    date,
    parseDateOnly(date).getUTCDay(),
  );
}

/**
 * Cảnh báo cho chủ khi xếp một ca giờ `startTime`–`endTime` vào các ngày
 * `workDates` (không trùng nhãn):
 *
 * - "Trùng lịch bận (…)" / "Trùng lịch học (…)": ca chồng lên một khung giờ
 *   bận / học bắt đầu hôm trước (qua đêm), cùng ngày, hoặc hôm sau (ca qua
 *   đêm); trong ngoặc là các khung giờ bị trùng, vd "Trùng lịch học (9h - 12h)".
 *   Câu bắt đầu đúng như trước để app cũ vẫn hiện được.
 * - "Ngoài lịch trống": ngày đó nhân viên có khai lịch trống (kể cả khung qua
 *   đêm từ hôm trước) nhưng không khung nào chứa trọn ca. Ngày không khai lịch
 *   trống thì không cảnh báo (không biết).
 */
export function personalScheduleWarnings(
  schedules: PersonalScheduleLike[],
  workDates: string[],
  startTime: string,
  endTime: string,
): string[] {
  if (!schedules.length || !workDates.length) return [];
  // Chỉ mục theo ngày / thứ / ngày trong tháng: mỗi lần tra chỉ xét khung giờ
  // có thể rơi vào ngày đó (lịch lặp dài × nhiều ngày làm).
  const indexOf = (slots: CompiledSlot[]) => {
    const byDate = new Map<string, CompiledSlot[]>();
    const byWeekday = new Map<number, CompiledSlot[]>();
    const byDayOfMonth = new Map<string, CompiledSlot[]>();
    const push = <Key>(
      map: Map<Key, CompiledSlot[]>,
      key: Key,
      slot: CompiledSlot,
    ) => {
      const list = map.get(key);
      if (list) list.push(slot);
      else map.set(key, [slot]);
    };
    for (const slot of slots) {
      if (slot.repeat === PersonalScheduleRepeat.WEEKLY)
        push(byWeekday, slot.weekday, slot);
      else if (slot.repeat === PersonalScheduleRepeat.MONTHLY) {
        push(byDayOfMonth, slot.dayOfMonth, slot);
      } else push(byDate, slot.date, slot);
    }
    return { byDate, byWeekday, byDayOfMonth };
  };
  const compiled = schedules.map((schedule) => ({
    kind: schedule.kind,
    index: indexOf(
      schedule.slots.map((slot) => compileSlot(slot, schedule.repeat)),
    ),
  }));
  const days = new Map<string, { weekday: number; start: number }>();
  const dayOf = (date: string) => {
    let day = days.get(date);
    if (!day) {
      const parsed = parseDateOnly(date);
      day = { weekday: parsed.getUTCDay(), start: parsed.getTime() / 60000 };
      days.set(date, day);
    }
    return day;
  };
  const intervalsOn = (
    index: ReturnType<typeof indexOf>,
    date: string,
  ): (ShiftInterval & { slot: CompiledSlot })[] => {
    const day = dayOf(date);
    const candidates = [
      ...(index.byDate.get(date) ?? []),
      ...(index.byWeekday.get(day.weekday) ?? []),
      ...(index.byDayOfMonth.get(date.slice(8, 10)) ?? []),
    ];
    return candidates
      .filter((slot) => slot.date <= date)
      .map((slot) => ({
        start: day.start + slot.startMinute,
        end: day.start + slot.endMinute,
        slot,
      }));
  };

  // Khung giờ bị trùng theo loại, để câu cảnh báo nói luôn giờ học / bận.
  const overlapped = new Map<PersonalScheduleKind, Set<string>>();
  let outsideAvailable = false;
  for (const workDate of [...new Set(workDates)].sort()) {
    const shift = toShiftInterval(workDate, startTime, endTime);
    const dayStart = dayOf(workDate).start;
    const previous = addDays(workDate, -1);
    const next = addDays(workDate, 1);
    let hasAvailable = false;
    let coveredByAvailable = false;
    for (const schedule of compiled) {
      if (schedule.kind === PersonalScheduleKind.AVAILABLE) {
        const available = [
          ...intervalsOn(schedule.index, previous).filter(
            (slot) => slot.end > dayStart,
          ),
          ...intervalsOn(schedule.index, workDate),
        ];
        if (available.length) hasAvailable = true;
        if (
          available.some(
            (slot) => slot.start <= shift.start && slot.end >= shift.end,
          )
        ) {
          coveredByAvailable = true;
        }
        continue;
      }
      for (const day of [previous, workDate, next]) {
        for (const interval of intervalsOn(schedule.index, day)) {
          if (!intervalsOverlap(interval, shift)) continue;
          const ranges = overlapped.get(schedule.kind) ?? new Set<string>();
          ranges.add(`${interval.slot.startTime}-${interval.slot.endTime}`);
          overlapped.set(schedule.kind, ranges);
        }
      }
    }
    if (hasAvailable && !coveredByAvailable) outsideAvailable = true;
  }

  const labels: string[] = [];
  for (const [kind, label] of [
    [PersonalScheduleKind.BUSY, 'Trùng lịch bận'],
    [PersonalScheduleKind.STUDY, 'Trùng lịch học'],
  ] as const) {
    const ranges = overlapped.get(kind);
    if (!ranges?.size) continue;
    const sorted = [...ranges].sort();
    const shown = sorted
      .slice(0, PERSONAL_WARNING_MAX_RANGES)
      .map((range) => {
        const [start, end] = range.split('-');
        return `${shortClock(start)} - ${shortClock(end)}`;
      });
    if (sorted.length > shown.length) shown.push('…');
    labels.push(`${label} (${shown.join(', ')})`);
  }
  if (outsideAvailable) labels.push('Ngoài lịch trống');
  return labels;
}
