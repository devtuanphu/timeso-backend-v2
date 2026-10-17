/**
 * Cách tính khoản thưởng / vi phạm v3 (Thiết lập tính lương, Figma "Chọn cách
 * tính"): 8 kiểu, tính trên TỪNG LẦN phát sinh của khoản (mỗi lần đi muộn với số
 * phút của lần đó, mỗi ca tăng ca, mỗi lần chủ ghi nhận…), rồi cộng cả tháng.
 *
 * Thuần: không I/O, không đồng hồ. Gọi từ ruleRawLines khi khoản có calc_config.
 */

export type RuleCalcKind =
  | 'FIXED'
  | 'UNIT_PRICE'
  | 'SALARY_COEF'
  | 'PERCENT'
  | 'SALARY_BLOCK'
  | 'PROGRESSIVE'
  | 'TIERED'
  | 'MILESTONE';

/** Đơn vị đo một lần phát sinh. */
export type RuleUnit = 'MINUTE' | 'HOUR' | 'SHIFT' | 'OCCURRENCE' | 'DAY';
/** Gốc lương / doanh số của hệ số và phần trăm. */
export type RuleBase = 'HOURLY' | 'DAILY' | 'MONTHLY' | 'REVENUE';
export type RuleMetric = 'WORKED_DAYS' | 'COMPLETED_SHIFTS' | 'WORKED_HOURS' | 'OCCURRENCES';

export interface RuleTier {
  /** Từ (phút, hoặc số lượng với khoản không đo bằng phút), bao gồm. */
  from: number;
  /** Đến (bao gồm); null = trở lên. */
  to: number | null;
  /** Số tiền cố định của bậc… */
  amount?: number | null;
  /** …hoặc số ngày lương (0,5 = ½ ngày lương). */
  dayFraction?: number | null;
}

export interface RuleCalcConfig {
  kind: RuleCalcKind;
  /** FIXED / UNIT_PRICE / PROGRESSIVE (mỗi bước) / MILESTONE: số tiền. */
  amount?: number;
  /** FIXED: áp dụng mỗi lần / ca / ngày. UNIT_PRICE, PROGRESSIVE: đơn vị. */
  unit?: RuleUnit;
  /** SALARY_COEF: hệ số; PERCENT: phần trăm. */
  coef?: number;
  percent?: number;
  base?: RuleBase;
  /** SALARY_BLOCK: số ngày lương mỗi lần (0,5 / 1 / 2…). */
  dayFraction?: number;
  /** SALARY_BLOCK: chỉ tính lần có số phút ≥ ngưỡng (khoản đo bằng phút). */
  triggerMinutes?: number | null;
  /** PROGRESSIVE: cứ mỗi `step` đơn vị vượt thì cộng `amount`. */
  step?: number;
  /** PROGRESSIVE: tối đa mỗi tháng (tuỳ chọn). */
  cap?: number | null;
  tiers?: RuleTier[];
  /** Miễn trừ X phút đầu mỗi lần (khoản đo bằng phút). */
  graceMinutes?: number;
  /** false: mỗi ngày chỉ tính lần nặng nhất. Mặc định true (cộng dồn). */
  accumulateDaily?: boolean;
  /** MILESTONE: chỉ số tháng so với ngưỡng. */
  metric?: RuleMetric;
  op?: 'GTE' | 'LTE';
  threshold?: number;
}

/** Một lần phát sinh của khoản trong tháng. */
export interface RuleOccurrence {
  /** Ngày làm (giờ VN), YYYY-MM-DD. */
  date: string;
  /** Số phút của lần đó (trễ, sớm, tăng ca, đêm, giờ làm của ca…). */
  minutes: number;
  /** Số lượng chủ ghi nhận (khoản thủ công); 1 với khoản tự động. */
  quantity: number;
}

/** Khoản đo bằng số phút của từng lần (miễn trừ, bậc phút, luỹ tiến phút…). */
export const MINUTE_BASED_CODES: ReadonlySet<string> = new Set([
  'LATE',
  'EARLY',
  'OVERTIME',
  'NIGHT_SHIFT',
  'ABSENT',
  'PUNCTUALITY',
  'ATTENDANCE',
]);

/** Khoản chủ ghi nhận tay: mỗi lần ghi nhận là một lần phát sinh. */
export const MANUAL_CODES: ReadonlySet<string> = new Set([
  'RESPONSIBILITY',
  'SALES',
  'HOT_BONUS',
  'RULE_VIOLATION',
  'CUSTOM',
]);

const KINDS: ReadonlySet<string> = new Set([
  'FIXED',
  'UNIT_PRICE',
  'SALARY_COEF',
  'PERCENT',
  'SALARY_BLOCK',
  'PROGRESSIVE',
  'TIERED',
  'MILESTONE',
]);
const UNITS: ReadonlySet<string> = new Set(['MINUTE', 'HOUR', 'SHIFT', 'OCCURRENCE', 'DAY']);
const BASES: ReadonlySet<string> = new Set(['HOURLY', 'DAILY', 'MONTHLY', 'REVENUE']);
const METRICS: ReadonlySet<string> = new Set([
  'WORKED_DAYS',
  'COMPLETED_SHIFTS',
  'WORKED_HOURS',
  'OCCURRENCES',
]);
const MAX_MONEY = 100_000_000;
const MAX_TIERS = 10;

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Kiểm và chuẩn hoá cấu hình chủ gửi lên. Trả về cấu hình sạch, hoặc câu báo lỗi
 * tiếng Việt (backend trả 400 với câu đó).
 */
export function normalizeRuleCalcConfig(
  raw: unknown,
  name: string,
): RuleCalcConfig | string {
  if (!raw || typeof raw !== 'object') return `Cách tính của "${name}" không hợp lệ`;
  const r = raw as Record<string, unknown>;
  const kind = String(r.kind ?? '');
  if (!KINDS.has(kind)) return `Cách tính của "${name}" không hợp lệ`;
  const out: RuleCalcConfig = { kind: kind as RuleCalcKind };
  const money = (key: string, required: boolean): string | null => {
    const v = num(r[key]);
    if (v === null) return required ? `Hãy nhập số tiền cho "${name}"` : null;
    if (Number.isNaN(v) || v < 0 || v > MAX_MONEY) return `Số tiền của "${name}" không hợp lệ`;
    (out as any)[key] = Math.round(v);
    return null;
  };
  const positive = (key: string, max: number, label: string): string | null => {
    const v = num(r[key]);
    if (v === null || Number.isNaN(v) || v <= 0 || v > max) {
      return `Hãy nhập ${label} hợp lệ cho "${name}"`;
    }
    (out as any)[key] = Math.round(v * 100) / 100;
    return null;
  };
  const optionalUnit = (fallback: RuleUnit): string | null => {
    const unit = r.unit === undefined || r.unit === null ? fallback : String(r.unit);
    if (!UNITS.has(unit)) return `Đơn vị của "${name}" không hợp lệ`;
    out.unit = unit as RuleUnit;
    return null;
  };
  const base = (allowed: RuleBase[]): string | null => {
    const b = String(r.base ?? '');
    if (!allowed.includes(b as RuleBase)) return `Gốc tính của "${name}" không hợp lệ`;
    out.base = b as RuleBase;
    return null;
  };

  let error: string | null = null;
  switch (out.kind) {
    case 'FIXED':
      error = money('amount', true) ?? optionalUnit('OCCURRENCE');
      break;
    case 'UNIT_PRICE':
      error = money('amount', true) ?? optionalUnit('SHIFT');
      break;
    case 'SALARY_COEF':
      error = positive('coef', 100, 'hệ số') ?? base(['HOURLY', 'DAILY']);
      break;
    case 'PERCENT':
      error = positive('percent', 100, 'tỉ lệ %') ?? base(['HOURLY', 'DAILY', 'MONTHLY', 'REVENUE']);
      break;
    case 'SALARY_BLOCK': {
      error = positive('dayFraction', 31, 'số ngày lương');
      const t = num(r.triggerMinutes);
      if (!error && t !== null) {
        if (Number.isNaN(t) || t < 0 || t > 24 * 60) error = `Điều kiện của "${name}" không hợp lệ`;
        else out.triggerMinutes = Math.round(t);
      }
      break;
    }
    case 'PROGRESSIVE': {
      error =
        positive('step', 10_000, 'bước luỹ tiến') ?? money('amount', true) ?? optionalUnit('MINUTE');
      if (!error && out.unit === 'DAY') error = `Đơn vị luỹ tiến của "${name}" không hợp lệ`;
      if (!error) error = money('cap', false);
      if (!error && out.cap === 0) out.cap = null;
      break;
    }
    case 'TIERED': {
      const tiers = Array.isArray(r.tiers) ? r.tiers : [];
      if (!tiers.length) {
        error = `Hãy thêm ít nhất một bậc cho "${name}"`;
        break;
      }
      if (tiers.length > MAX_TIERS) {
        error = `"${name}" tối đa ${MAX_TIERS} bậc`;
        break;
      }
      const clean: RuleTier[] = [];
      for (const t of tiers as Array<Record<string, unknown>>) {
        const from = num(t?.from);
        const to = num(t?.to);
        const amount = num(t?.amount);
        const dayFraction = num(t?.dayFraction);
        if (from === null || Number.isNaN(from) || from < 0) {
          error = `Bậc của "${name}" không hợp lệ`;
          break;
        }
        if (to !== null && (Number.isNaN(to) || to < from)) {
          error = `Bậc của "${name}" không hợp lệ`;
          break;
        }
        const hasAmount = amount !== null && !Number.isNaN(amount) && amount >= 0 && amount <= MAX_MONEY;
        const hasDays =
          dayFraction !== null && !Number.isNaN(dayFraction) && dayFraction > 0 && dayFraction <= 31;
        if (hasAmount === hasDays) {
          error = `Mỗi bậc của "${name}" cần một số tiền hoặc số ngày lương`;
          break;
        }
        clean.push({
          from: Math.round(from * 100) / 100,
          to: to === null ? null : Math.round(to * 100) / 100,
          amount: hasAmount ? Math.round(amount as number) : null,
          dayFraction: hasDays ? Math.round((dayFraction as number) * 100) / 100 : null,
        });
      }
      if (!error) out.tiers = clean.sort((a, b) => a.from - b.from);
      break;
    }
    case 'MILESTONE': {
      const metric = String(r.metric ?? '');
      if (!METRICS.has(metric)) {
        error = `Điều kiện của "${name}" không hợp lệ`;
        break;
      }
      out.metric = metric as RuleMetric;
      out.op = r.op === 'LTE' ? 'LTE' : 'GTE';
      const t = num(r.threshold);
      // "≥ 0" luôn đạt: ngưỡng của "≥" phải lớn hơn 0 ("≤ 0 lần trễ" thì được).
      if (
        t === null ||
        Number.isNaN(t) ||
        t < 0 ||
        (out.op === 'GTE' && t === 0) ||
        t > 100_000
      ) {
        error = `Hãy nhập ngưỡng cho "${name}"`;
        break;
      }
      out.threshold = Math.round(t * 100) / 100;
      error = money('amount', true);
      break;
    }
  }
  if (error) return error;

  const grace = num(r.graceMinutes);
  if (grace !== null) {
    if (Number.isNaN(grace) || grace < 0 || grace > 600) return `Miễn trừ của "${name}" không hợp lệ`;
    if (grace > 0) out.graceMinutes = Math.round(grace);
  }
  if (r.accumulateDaily === false) out.accumulateDaily = false;
  // Mốc theo số công / ca / giờ của tháng: miễn trừ và cộng dồn không có nghĩa
  // (màn hình cũng không hiện) — không để chúng âm thầm đổi kết quả.
  if (out.kind === 'MILESTONE' && out.metric !== 'OCCURRENCES') {
    delete out.graceMinutes;
    delete out.accumulateDaily;
  }
  return out;
}

/** Lương / doanh số dùng làm gốc (đồng). */
export interface RuleRates {
  hourly: number;
  daily: number;
  monthly: number;
  revenue: number;
}

const distinctDays = (list: RuleOccurrence[]) => new Set(list.map((o) => o.date)).size;

/** Kết quả của một khoản: số tiền chưa làm tròn, số lần, nhãn hiển thị. */
export interface RuleConfigResult {
  exact: number;
  count: number;
  label: string;
}

/**
 * Tăng ca / ca đêm: giờ đó đã có trong lương công, hệ số là MỨC TRẢ của giờ
 * (Figma: "1,5 = +50% lương giờ") nên khoản thưởng là phần thêm, hệ số − 1.
 * Khoản khác: hệ số nhân thẳng (phạt 1× lương giờ mỗi giờ trễ…).
 */
export function salaryCoefExtra(code: string, coef: number): number {
  return code === 'OVERTIME' || code === 'NIGHT_SHIFT' ? Math.max(0, coef - 1) : coef;
}

const fmt = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',');
};

/**
 * Tiền của một khoản v3 trong tháng.
 * - occurrences: các lần phát sinh (đã gồm ghi nhận tay với khoản thủ công);
 * - monthly: số liệu tháng cho kiểu "Theo mốc điều kiện".
 */
export function evaluateRuleConfig(input: {
  code: string;
  name: string;
  config: RuleCalcConfig;
  occurrences: RuleOccurrence[];
  rates: RuleRates;
  monthly: { workedDays: number; completedShifts: number; workedMinutes: number };
}): RuleConfigResult {
  const { code, name, config, rates } = input;
  const minuteBased = MINUTE_BASED_CODES.has(code);
  const manual = !minuteBased;
  // Ghi nhận tay: "ngày" là số lượng chủ ghi; quên chấm công: mỗi ngày một lần.
  const recorded = manual && code !== 'MISSED_PUNCH';
  const grace = minuteBased ? Math.max(0, config.graceMinutes ?? 0) : 0;

  // Miễn trừ: bỏ lần không vượt X phút đầu.
  let list = input.occurrences.filter((o) => (minuteBased ? o.minutes > grace : o.quantity > 0));
  // Không cộng dồn trong ngày: mỗi ngày giữ lần nặng nhất.
  if (config.accumulateDaily === false) {
    const byDay = new Map<string, RuleOccurrence>();
    for (const o of list) {
      const prev = byDay.get(o.date);
      const weight = minuteBased ? o.minutes : o.quantity;
      const prevWeight = prev ? (minuteBased ? prev.minutes : prev.quantity) : -1;
      if (!prev || weight > prevWeight) byDay.set(o.date, o);
    }
    list = [...byDay.values()];
  }
  const after = (o: RuleOccurrence) => Math.max(0, o.minutes - grace);
  /** Số lượng một lần theo đơn vị (khoản thủ công: số lượng chủ ghi nhận). */
  const measure = (o: RuleOccurrence, unit: RuleUnit): number => {
    if (manual) return o.quantity;
    if (unit === 'MINUTE') return after(o);
    if (unit === 'HOUR') return after(o) / 60;
    return 1;
  };
  const total = (unit: RuleUnit) =>
    unit === 'DAY' && !recorded ? distinctDays(list) : list.reduce((s, o) => s + measure(o, unit), 0);
  const occurrences = manual ? list.reduce((s, o) => s + o.quantity, 0) : list.length;
  const none = { exact: 0, count: 0, label: name };

  switch (config.kind) {
    case 'FIXED': {
      const unit = config.unit ?? 'OCCURRENCE';
      const times = unit === 'DAY' ? (recorded ? occurrences : distinctDays(list)) : occurrences;
      return { exact: (config.amount ?? 0) * times, count: times, label: name };
    }
    case 'UNIT_PRICE': {
      const unit = config.unit ?? 'SHIFT';
      const q = total(unit);
      const whole = Number.isInteger(q) && unit !== 'MINUTE' && unit !== 'HOUR';
      return {
        exact: (config.amount ?? 0) * q,
        count: whole ? q : 1,
        label: whole ? name : `${name} (${fmt(q)} ${unit === 'MINUTE' ? 'phút' : 'giờ'})`,
      };
    }
    case 'SALARY_COEF': {
      const coef = salaryCoefExtra(code, config.coef ?? 0);
      if (config.base === 'DAILY') {
        const days = recorded ? occurrences : distinctDays(list);
        return { exact: coef * rates.daily * days, count: days, label: name };
      }
      const hours = total('HOUR');
      return {
        exact: coef * rates.hourly * hours,
        count: 1,
        label: `${name} (${fmt(hours)} giờ)`,
      };
    }
    case 'PERCENT': {
      const pct = (config.percent ?? 0) / 100;
      if (config.base === 'MONTHLY' || config.base === 'REVENUE') {
        // Một lần mỗi tháng: khoản sự kiện cần có ít nhất một lần phát sinh;
        // thưởng doanh số theo doanh số thì luôn tính (doanh số 0 → 0).
        const applies = list.length > 0 || (code === 'SALES' && config.base === 'REVENUE');
        if (!applies) return none;
        const baseAmount = config.base === 'REVENUE' ? rates.revenue : rates.monthly;
        return { exact: pct * baseAmount, count: 1, label: name };
      }
      const rate = config.base === 'HOURLY' ? rates.hourly : rates.daily;
      return { exact: pct * rate * occurrences, count: occurrences, label: name };
    }
    case 'SALARY_BLOCK': {
      const hit = minuteBased
        ? list.filter((o) => o.minutes >= (config.triggerMinutes ?? 0))
        : list;
      const times = manual ? hit.reduce((s, o) => s + o.quantity, 0) : hit.length;
      return { exact: (config.dayFraction ?? 0) * rates.daily * times, count: times, label: name };
    }
    case 'PROGRESSIVE': {
      const unit = config.unit ?? 'MINUTE';
      const step = config.step ?? 0;
      if (!(step > 0)) return none;
      let steps = 0;
      if (manual || unit === 'SHIFT' || unit === 'OCCURRENCE') {
        steps = Math.floor(total(unit) / step);
      } else {
        // Mỗi lần: số bước vượt (sau miễn trừ) của chính lần đó.
        for (const o of list) steps += Math.floor(measure(o, unit) / step);
      }
      let exact = steps * (config.amount ?? 0);
      if (config.cap && exact > config.cap) exact = config.cap;
      return { exact, count: steps, label: name };
    }
    case 'TIERED': {
      const tiers = config.tiers ?? [];
      const pick = (value: number) =>
        tiers.find((t) => value >= t.from && (t.to === null || value <= t.to)) ?? null;
      const valueOf = (t: RuleTier) =>
        t.dayFraction ? t.dayFraction * rates.daily : (t.amount ?? 0);
      if (minuteBased) {
        let exact = 0;
        let hits = 0;
        for (const o of list) {
          const tier = pick(o.minutes);
          if (!tier) continue;
          exact += valueOf(tier);
          hits += 1;
        }
        return { exact, count: hits, label: name };
      }
      const tier = pick(occurrences);
      return tier ? { exact: valueOf(tier), count: 1, label: name } : none;
    }
    case 'MILESTONE': {
      const m = input.monthly;
      const value =
        config.metric === 'WORKED_DAYS'
          ? m.workedDays
          : config.metric === 'COMPLETED_SHIFTS'
            ? m.completedShifts
            : config.metric === 'WORKED_HOURS'
              ? m.workedMinutes / 60
              : occurrences;
      const threshold = config.threshold ?? 0;
      const ok = config.op === 'LTE' ? value <= threshold : value >= threshold;
      return ok ? { exact: config.amount ?? 0, count: 1, label: name } : none;
    }
    default:
      return none;
  }
}
