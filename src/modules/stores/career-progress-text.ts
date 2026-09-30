import {
  CriteriaCode,
  CriteriaKind,
  CriteriaOperator,
} from './entities/store-rung-criteria.entity';

/**
 * Câu tiến độ của một điều kiện lộ trình, vd. "Đã đạt 1/30 ca · còn 29 ca".
 *
 * Dựng ở backend để trang chủ, tab Hiệu suất và app chủ nói cùng một câu cho
 * cùng một điều kiện. Chỉ có với chỉ số đo được (metric/tenure) khi đã có cả
 * số hiện tại lẫn ngưỡng; checklist và điều kiện chéo lộ trình trả null vì
 * chúng là có/không, không có gì để đếm.
 */

/** Đơn vị mặc định theo mã, khớp METRIC_DEFINITIONS của app chủ. */
const DEFAULT_UNITS: Record<string, string> = {
  [CriteriaCode.ON_TIME_PERCENT]: '%',
  [CriteriaCode.UNAUTHORIZED_LEAVES]: 'ngày',
  [CriteriaCode.COMPLETED_SHIFTS]: 'ca',
  [CriteriaCode.WORK_HOURS]: 'giờ',
  [CriteriaCode.PERFORMANCE_SCORE]: 'điểm',
  [CriteriaCode.KPI_COMPLETION]: '%',
  [CriteriaCode.CAPABILITY_POINTS]: 'điểm',
  [CriteriaCode.DAYS_IN_RUNG]: 'ngày',
};

/** Chỉ số đếm (ca, lần, ngày) luôn là số nguyên. */
const COUNT_CODES = new Set<string>([
  CriteriaCode.COMPLETED_SHIFTS,
  CriteriaCode.UNAUTHORIZED_LEAVES,
  CriteriaCode.DAYS_IN_RUNG,
]);

const TENURE: string = CriteriaKind.TENURE;
/** Kinds with something to count; checklist/ladder are yes/no. */
const MEASURABLE_KINDS = new Set<string>([
  CriteriaKind.METRIC,
  CriteriaKind.TENURE,
]);

export interface ProgressTextInput {
  kind: string;
  code: string | null;
  operator: string | null;
  current: number | null;
  target: number | null;
  unit: string | null;
  met: boolean;
}

/**
 * Số theo kiểu Việt Nam: "." ngăn hàng nghìn, "," thập phân. Tự dựng thay vì
 * Intl để kết quả không phụ thuộc bản ICU của máy chủ.
 */
export function formatVnNumber(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  const negative = rounded < 0;
  const [intPart, fracPart] = Math.abs(rounded).toFixed(decimals).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const frac = fracPart ? fracPart.replace(/0+$/, '') : '';
  return `${negative ? '-' : ''}${grouped}${frac ? `,${frac}` : ''}`;
}

/** Đơn vị thật dùng để hiển thị: tenure luôn là ngày. */
export function effectiveCriteriaUnit(
  kind: string,
  code: string | null,
  unit: string | null,
): string | null {
  if (kind === TENURE) return 'ngày';
  const trimmed = unit?.trim();
  if (trimmed) return trimmed;
  return code ? (DEFAULT_UNITS[code] ?? null) : null;
}

export function buildCriteriaProgressText(
  input: ProgressTextInput,
): string | null {
  if (!MEASURABLE_KINDS.has(input.kind)) return null;
  const { current, target } = input;
  if (
    current === null ||
    target === null ||
    current === undefined ||
    target === undefined ||
    !Number.isFinite(Number(current)) ||
    !Number.isFinite(Number(target))
  ) {
    return null;
  }
  const cur = Number(current);
  const tgt = Number(target);
  const isCount = input.kind === TENURE || COUNT_CODES.has(input.code ?? '');
  const decimals = isCount ? 0 : 1;
  const factor = 10 ** decimals;
  // Không bao giờ nói quá tiến độ: hiện tại làm tròn xuống với "tối thiểu",
  // phần còn thiếu / phần vượt làm tròn lên để không thành "còn 0".
  const down = (n: number) => Math.floor(n * factor + 1e-9) / factor;
  const up = (n: number) => Math.ceil(n * factor - 1e-9) / factor;
  const fmt = (n: number) => formatVnNumber(n, decimals);

  const unit = effectiveCriteriaUnit(input.kind, input.code, input.unit);
  const withUnit = (text: string) =>
    !unit ? text : unit === '%' ? `${text}%` : `${text} ${unit}`;

  if (input.operator === CriteriaOperator.LTE) {
    const shown = up(cur);
    if (input.met) {
      return `Hiện ${withUnit(fmt(shown))} · tối đa ${withUnit(fmt(tgt))}`;
    }
    const over = Math.max(up(cur - tgt), 1 / factor);
    return `Hiện ${withUnit(fmt(shown))} · vượt ${withUnit(fmt(over))} (tối đa ${withUnit(fmt(tgt))})`;
  }

  // gte (mặc định, cùng quy ước với CareerLadderService.compare).
  const ratio = `${fmt(input.met ? cur : down(cur))}/${withUnit(fmt(tgt))}`;
  if (input.met) return `Đã đạt ${ratio}`;
  const remaining = Math.max(up(tgt - cur), 1 / factor);
  return `Đã đạt ${ratio} · còn ${withUnit(fmt(remaining))}`;
}
