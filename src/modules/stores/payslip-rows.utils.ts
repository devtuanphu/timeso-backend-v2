/**
 * The store's payslip template ("Thiết lập tính lương" → bảng lương nhân viên
 * nhìn thấy): owner labels / removals of the built-in rows and the extra
 * lines they add. A payslip keeps a snapshot of the template it was computed
 * with (`employee_salaries.payslip_rows`), so a finalized payslip still shows
 * — and adds up to — what it was paid with.
 */
import {
  PayslipBuiltinRow,
  PayslipRowSign,
} from './entities/store-payslip-row.entity';

export const PAYSLIP_BUILTIN_DEFAULT_LABELS: Record<PayslipBuiltinRow, string> = {
  [PayslipBuiltinRow.ALLOWANCE]: 'Phụ cấp',
  [PayslipBuiltinRow.BONUS]: 'Thưởng',
  [PayslipBuiltinRow.DEDUCTION]: 'Khấu trừ',
};

export interface PayslipExtraItem {
  id?: string;
  label: string;
  sign: PayslipRowSign;
  /** Whole VND, ≥ 0; the sign says whether it is added or taken. */
  amount: number;
}

export interface PayslipRowsSnapshot {
  labels: Record<PayslipBuiltinRow, string>;
  /** Built-in rows the owner removed: their amounts are not paid / taken. */
  removed: PayslipBuiltinRow[];
  items: PayslipExtraItem[];
}

export interface PayslipTemplateRowLike {
  id?: string;
  builtinKey: PayslipBuiltinRow | string | null;
  label: string;
  sign: PayslipRowSign | string;
  amount: number | string;
  sortOrder?: number | null;
  isActive?: boolean | null;
}

const BUILTINS = Object.values(PayslipBuiltinRow) as PayslipBuiltinRow[];
const toAmount = (value: unknown) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const toSign = (value: unknown) =>
  value === PayslipRowSign.MINUS ? PayslipRowSign.MINUS : PayslipRowSign.PLUS;

/** The template from the store's stored rows (none stored = the default payslip). */
export function payslipRowsSnapshot(
  rows: PayslipTemplateRowLike[] | null | undefined,
): PayslipRowsSnapshot {
  const labels = { ...PAYSLIP_BUILTIN_DEFAULT_LABELS };
  const removed: PayslipBuiltinRow[] = [];
  const items: PayslipExtraItem[] = [];
  const sorted = [...(rows ?? [])].sort(
    (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0),
  );
  for (const row of sorted) {
    const key = BUILTINS.find((builtin) => builtin === row.builtinKey);
    if (key) {
      if (row.isActive === false) removed.push(key);
      else if (String(row.label ?? '').trim()) labels[key] = String(row.label).trim();
      continue;
    }
    if (row.builtinKey != null || row.isActive === false) continue;
    const label = String(row.label ?? '').trim();
    if (!label) continue;
    items.push({
      ...(row.id ? { id: row.id } : {}),
      label,
      sign: toSign(row.sign),
      amount: toAmount(row.amount),
    });
  }
  return { labels, removed, items };
}

/** A stored snapshot (jsonb), or null when absent / not one. */
export function readPayslipRowsSnapshot(value: unknown): PayslipRowsSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PayslipRowsSnapshot>;
  const labels = { ...PAYSLIP_BUILTIN_DEFAULT_LABELS };
  for (const key of BUILTINS) {
    const label = raw.labels?.[key];
    if (typeof label === 'string' && label.trim()) labels[key] = label.trim();
  }
  return {
    labels,
    removed: (Array.isArray(raw.removed) ? raw.removed : []).filter(
      (key): key is PayslipBuiltinRow => BUILTINS.includes(key as PayslipBuiltinRow),
    ),
    items: (Array.isArray(raw.items) ? raw.items : [])
      .filter((item) => item && String(item.label ?? '').trim())
      .map((item) => ({
        ...(item.id ? { id: String(item.id) } : {}),
        label: String(item.label).trim(),
        sign: toSign(item.sign),
        amount: toAmount(item.amount),
      })),
  };
}

/** Extra income (PLUS lines) and extra deductions (MINUS lines) of a template. */
export function payslipExtraTotals(snapshot: PayslipRowsSnapshot | null | undefined): {
  additions: number;
  deductions: number;
} {
  let additions = 0;
  let deductions = 0;
  for (const item of snapshot?.items ?? []) {
    if (item.sign === PayslipRowSign.MINUS) deductions += item.amount;
    else additions += item.amount;
  }
  return { additions, deductions };
}

export const isBuiltinRemoved = (
  snapshot: PayslipRowsSnapshot | null | undefined,
  key: PayslipBuiltinRow,
) => !!snapshot?.removed.includes(key);

/**
 * The deductions a stored payslip actually takes, given its snapshot: a
 * removed "Khấu trừ" takes neither the fines nor the other deductions (the
 * owner's entered amount stays stored for when the row comes back).
 */
export function countedPayslipDeductions(row: {
  penalty: unknown;
  otherDeductions: unknown;
  payslipRows?: unknown;
}): { penalty: number; otherDeductions: number; extraDeductions: number } {
  const snapshot = readPayslipRowsSnapshot(row.payslipRows);
  const removed = isBuiltinRemoved(snapshot, PayslipBuiltinRow.DEDUCTION);
  return {
    penalty: removed ? 0 : Math.round(Number(row.penalty) || 0),
    otherDeductions: removed ? 0 : Math.round(Number(row.otherDeductions) || 0),
    extraDeductions: payslipExtraTotals(snapshot).deductions,
  };
}
