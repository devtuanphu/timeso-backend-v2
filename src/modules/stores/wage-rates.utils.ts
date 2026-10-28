import { PaymentType } from './entities/employee-contract.entity';

/**
 * Đơn giá lương của cửa hàng (Thiết lập tính lương → "Đơn giá theo ca / vị trí
 * / khung giờ"): ca sáng 25.000đ/giờ, ca tối 30.000đ/giờ, Pha chế 28.000đ/giờ,
 * 22:00–06:00 35.000đ/giờ…
 *
 * Chỉ áp cho nhân viên trả lương theo GIỜ (đơn giá giờ) hoặc theo CA (đơn giá
 * ca). Lương ngày / tuần / tháng giữ nguyên hợp đồng.
 *
 * Mỗi ca được định giá riêng theo ca mà nhân viên thực sự làm, nên đổi ca là
 * đổi giá. Một ca khớp nhiều đơn giá: đơn giá khớp NHIỀU điều kiện hơn thắng
 * (ca, vị trí, khung giờ — mỗi thứ một điểm), hoà thì lấy giá cao hơn. Không
 * khớp đơn giá nào: lương trong hợp đồng.
 *
 * Thuần: không I/O, không đồng hồ.
 */

export type WageUnit = 'HOUR' | 'SHIFT';

export interface WageRateRule {
  id?: string;
  unit: WageUnit;
  /** Đồng / giờ hoặc đồng / ca. */
  amount: number;
  /** Trống = mọi ca. */
  workShiftIds: string[];
  /** Vị trí (store_roles). Trống = mọi vị trí. */
  roleIds: string[];
  /** Khung giờ trong ngày, giờ VN 'HH:MM'. Cả hai null = cả ngày. */
  timeFrom: string | null;
  timeTo: string | null;
}

/** Hàng store_wage_rates (hoặc bất kỳ thứ gì cùng hình) → luật thuần. */
export function wageRuleOf(r: {
  unit: string;
  amount: number | string;
  workShiftIds?: string[] | null;
  roleIds?: string[] | null;
  timeFrom?: string | null;
  timeTo?: string | null;
}): WageRateRule {
  return {
    unit: r.unit === 'SHIFT' ? 'SHIFT' : 'HOUR',
    amount: Number(r.amount) || 0,
    workShiftIds: Array.isArray(r.workShiftIds) ? r.workShiftIds : [],
    roleIds: Array.isArray(r.roleIds) ? r.roleIds : [],
    timeFrom: r.timeFrom ? String(r.timeFrom).slice(0, 5) : null,
    timeTo: r.timeTo ? String(r.timeTo).slice(0, 5) : null,
  };
}

/** Một ca cần định giá. */
export interface WageShift {
  workShiftId: string | null;
  /** Vị trí hiện tại của nhân viên. */
  roleId: string | null;
  /**
   * Khoảng thời gian dùng để chia theo khung giờ (giờ vào → giờ ra, hoặc giờ
   * theo lịch của ca). Null: không chia được, chỉ đơn giá không có khung giờ
   * mới áp.
   */
  from: Date | string | null;
  to: Date | string | null;
}

/** Đơn vị đơn giá của một hình thức trả lương; null = không áp đơn giá. */
export function wageUnitOf(
  paymentType: PaymentType | string | null | undefined,
): WageUnit | null {
  if (paymentType === PaymentType.HOUR) return 'HOUR';
  if (paymentType === PaymentType.SHIFT) return 'SHIFT';
  return null;
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 'HH:MM' hoặc 'HH:MM:SS' → phút trong ngày; sai định dạng → null. */
export function minuteOfDay(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

const hasWindow = (r: WageRateRule): boolean =>
  minuteOfDay(r.timeFrom) != null && minuteOfDay(r.timeTo) != null;

/** Số điều kiện đơn giá đặt ra: đơn giá cụ thể hơn thắng. */
const specificity = (r: WageRateRule): number =>
  (r.workShiftIds.length ? 1 : 0) + (r.roleIds.length ? 1 : 0) + (hasWindow(r) ? 1 : 0);

/** Đơn giá tốt nhất trong các đơn giá khớp: cụ thể hơn, rồi cao hơn. */
function best(rules: WageRateRule[]): WageRateRule | null {
  let pick: WageRateRule | null = null;
  for (const r of rules) {
    if (
      !pick ||
      specificity(r) > specificity(pick) ||
      (specificity(r) === specificity(pick) && Number(r.amount) > Number(pick.amount))
    ) {
      pick = r;
    }
  }
  return pick;
}

/** Thời điểm `ms` (giờ VN) có nằm trong khung giờ của đơn giá không. */
function inWindow(r: WageRateRule, ms: number): boolean {
  const from = minuteOfDay(r.timeFrom);
  const to = minuteOfDay(r.timeTo);
  if (from == null || to == null) return true;
  const minute = Math.floor((((ms + VN_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS / 60000);
  // Khung qua nửa đêm (22:00–06:00) khi to <= from.
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

const instantMs = (value: Date | string | null | undefined): number | null => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/** Mốc bắt đầu / kết thúc của các khung giờ rơi trong (from, to). */
function windowEdges(rules: WageRateRule[], from: number, to: number): number[] {
  const edges = new Set<number>();
  const firstMidnight = Math.floor((from + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS;
  for (const r of rules) {
    const a = minuteOfDay(r.timeFrom);
    const b = minuteOfDay(r.timeTo);
    if (a == null || b == null) continue;
    for (let day = firstMidnight - DAY_MS; day < to + DAY_MS; day += DAY_MS) {
      for (const minute of [a, b]) {
        const at = day + minute * 60000;
        if (at > from && at < to) edges.add(at);
      }
    }
  }
  return Array.from(edges).sort((x, y) => x - y);
}

/** Đơn giá của ca khớp điều kiện ca + vị trí (chưa xét khung giờ). */
function candidatesFor(
  rules: WageRateRule[],
  unit: WageUnit,
  shift: Pick<WageShift, 'workShiftId' | 'roleId'>,
): WageRateRule[] {
  return rules.filter(
    (r) =>
      r.unit === unit &&
      Number(r.amount) > 0 &&
      (!r.workShiftIds.length ||
        (shift.workShiftId != null && r.workShiftIds.includes(shift.workShiftId))) &&
      (!r.roleIds.length || (shift.roleId != null && r.roleIds.includes(shift.roleId))),
  );
}

/**
 * Đơn giá áp cho một ca, theo đơn vị của hình thức trả lương:
 * - SHIFT: đồng / ca của đơn giá tốt nhất (khung giờ không áp cho đơn giá ca).
 * - HOUR: đồng / giờ BÌNH QUÂN trên khoảng `from → to` — mỗi đoạn của khoảng
 *   lấy đơn giá tốt nhất phủ đoạn đó (đơn giá có khung giờ chỉ phủ phần trong
 *   khung), rồi bình quân theo độ dài. Không có khoảng: đơn giá không khung giờ.
 * Đoạn / ca không khớp đơn giá nào dùng `fallbackRate` (lương hợp đồng).
 */
export function wageRateForShift(input: {
  rules: WageRateRule[];
  unit: WageUnit;
  fallbackRate: number;
  shift: WageShift;
}): number {
  const fallback = Number(input.fallbackRate) || 0;
  const candidates = candidatesFor(input.rules, input.unit, input.shift);
  if (!candidates.length) return fallback;
  if (input.unit === 'SHIFT') {
    const pick = best(candidates.filter((r) => !hasWindow(r)));
    return pick ? Number(pick.amount) : fallback;
  }
  const allDay = candidates.filter((r) => !hasWindow(r));
  const windowed = candidates.filter(hasWindow);
  const from = instantMs(input.shift.from);
  const to = instantMs(input.shift.to);
  if (!windowed.length || from == null || to == null || !(to > from)) {
    const pick = best(allDay);
    return pick ? Number(pick.amount) : fallback;
  }
  const points = [from, ...windowEdges(windowed, from, to), to];
  let weighted = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const mid = a + (b - a) / 2;
    const pick = best([...allDay, ...windowed.filter((r) => inWindow(r, mid))]);
    weighted += (pick ? Number(pick.amount) : fallback) * (b - a);
  }
  return weighted / (to - from);
}

/** Có ca nào khớp ít nhất một đơn giá (ca + vị trí) không. */
export function wageRulesApply(
  rules: WageRateRule[],
  unit: WageUnit,
  shifts: Pick<WageShift, 'workShiftId' | 'roleId'>[],
): boolean {
  return shifts.some((shift) => candidatesFor(rules, unit, shift).length > 0);
}

/** Một ca đã làm, để tính lương theo đơn giá. */
export interface WagePricedShift extends WageShift {
  /** HOUR: số phút được tính công của ca. */
  workedMinutes: number;
}

/**
 * Lương theo công của các ca đã làm khi cửa hàng có đơn giá cho đơn vị này:
 * HOUR: Σ đơn giá bình quân của ca × giờ được tính công; SHIFT: Σ đơn giá ca.
 * Làm tròn một lần ở cuối, như computeEarnedBase: ca nào cũng không khớp đơn
 * giá thì kết quả trùng đúng lương hợp đồng × tổng giờ / tổng ca.
 */
export function wageEarnedOf(input: {
  rules: WageRateRule[];
  unit: WageUnit;
  fallbackRate: number;
  shifts: WagePricedShift[];
}): number {
  // HOUR cộng "đơn giá × phút" rồi mới chia 60, đúng thứ tự phép tính của
  // computeEarnedBase — chia từng ca trước thì sai số dấu phẩy động có thể
  // làm lệch 1đ khi tổng rơi đúng ,5.
  let total = 0;
  for (const shift of input.shifts) {
    const rate = wageRateForShift({
      rules: input.rules,
      unit: input.unit,
      fallbackRate: input.fallbackRate,
      shift,
    });
    if (input.unit === 'SHIFT') {
      total += rate;
    } else {
      const minutes = Number(shift.workedMinutes);
      if (Number.isFinite(minutes) && minutes > 0) total += rate * minutes;
    }
  }
  return Math.round(input.unit === 'SHIFT' ? total : total / 60);
}

/**
 * Khoảng dùng để chia ca theo khung giờ: đúng phần giờ được trả.
 * - Bắt đầu: giờ vào, nhưng không sớm hơn giờ bắt đầu ca — trừ khi số phút
 *   được trả nhiều hơn phần từ giờ bắt đầu ca tới giờ ra (chế độ "theo giờ
 *   chấm công" trả cả phần đến sớm).
 * - Kết thúc: bắt đầu + số phút được trả, không quá giờ ra. Chế độ "theo lịch
 *   làm" không trả phần ở lại sau giờ hết ca (kể cả khi hệ thống tự ra ca muộn
 *   lúc quét), nên phần đó không được kéo khung giờ khác vào đơn giá.
 * Ca không có giờ vào / ra thì giờ theo lịch của ca.
 */
export function wageIntervalOf(a: {
  checkInTime?: Date | string | null;
  checkOutTime?: Date | string | null;
  windowStart?: Date | string | null;
  windowEnd?: Date | string | null;
  /** Số phút được trả của ca; không có thì lấy cả khoảng vào → ra. */
  workedMinutes?: number | null;
}): { from: Date | null; to: Date | null } {
  const checkIn = instantMs(a.checkInTime);
  const checkOut = instantMs(a.checkOutTime);
  const start = instantMs(a.windowStart);
  const end = instantMs(a.windowEnd);
  if (checkIn != null && checkOut != null && checkOut > checkIn) {
    const paidMs =
      a.workedMinutes != null && Number(a.workedMinutes) > 0
        ? Number(a.workedMinutes) * 60000
        : null;
    let from = start != null && start > checkIn && start < checkOut ? start : checkIn;
    if (paidMs != null && paidMs > checkOut - from) from = checkIn;
    const to = paidMs != null ? Math.min(checkOut, from + paidMs) : checkOut;
    return { from: new Date(from), to: new Date(to) };
  }
  if (start != null && end != null && end > start) {
    return { from: new Date(start), to: new Date(end) };
  }
  return { from: null, to: null };
}
