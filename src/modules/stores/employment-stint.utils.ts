import { vnDateString } from '../../common/utils/vn-calendar';

/**
 * Employment "stint" helpers.
 *
 * One `employee_profiles` row per (account, store) is kept across a
 * termination and a later rehire, so the current stint starts at
 * `employee_profiles.joined_at`. Views that should show only the current stint
 * (contracts, assets, capability entries, career events, schedule history)
 * filter their rows against a floor derived from that timestamp.
 *
 * Why a tolerance instead of `created_at >= joined_at`:
 * rows written inside the hire transaction take `created_at` /
 * `assigned_date` from the database's `now()`, which is the *transaction
 * start*, while `joinedAt` is assigned later from the application clock
 * (`new Date()`). A strict comparison would therefore hide every employee's
 * own initial contract and assets. Rows from a previous stint are much older
 * than the rehire, so a 60-second window lets the same-transaction rows
 * through while excluding the former stint. The only leak is a terminate and
 * rehire inside the same minute, for which "restore" is the right tool.
 */
export const STINT_CLOCK_TOLERANCE_MS = 60_000;

/** Lower bound for current-stint rows; null means "no filter" (legacy rows). */
export function stintFloor(joinedAt: Date | null | undefined): Date | null {
  if (!joinedAt) return null;
  const time = new Date(joinedAt).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time - STINT_CLOCK_TOLERANCE_MS);
}

/**
 * The Vietnam calendar date the current stint started on, as 'YYYY-MM-DD'.
 * Used for date-keyed rows (shift work dates). Known edge: a shift worked
 * earlier on the same VN day as the rehire is counted in the new stint.
 */
export function stintStartVnDate(
  joinedAt: Date | null | undefined,
): string | null {
  if (!joinedAt) return null;
  const date = new Date(joinedAt);
  if (!Number.isFinite(date.getTime())) return null;
  return vnDateString(date);
}

/**
 * Contracts that belong to the current stint, active first then newest first.
 * An active contract is always kept; with no floor (legacy `joinedAt` null)
 * nothing is filtered, only sorted.
 */
export function currentStintContracts<
  T extends { isActive?: boolean | null; createdAt?: Date | string | null },
>(contracts: T[] | null | undefined, floor: Date | null): T[] {
  const time = (value: Date | string | null | undefined) =>
    value ? new Date(value).getTime() : 0;
  return (contracts || [])
    .filter(
      (contract) =>
        !floor || contract.isActive || time(contract.createdAt) >= floor.getTime(),
    )
    .sort(
      (a, b) =>
        Number(!!b.isActive) - Number(!!a.isActive) ||
        time(b.createdAt) - time(a.createdAt),
    );
}

/**
 * SQL predicate for store-level lists that span several employees: keeps a
 * row when it was created in its employee's current stint. Same 60-second
 * tolerance as `stintFloor`; a profile without `joined_at` (legacy) or not
 * joined (soft-deleted former employee) is not filtered.
 *
 * `profileAlias` and `column` must be trusted query-builder identifiers,
 * never user input.
 */
export function currentStintSql(profileAlias: string, column: string): string {
  return `(${profileAlias}.joined_at IS NULL OR ${column} >= ${profileAlias}.joined_at - interval '${STINT_CLOCK_TOLERANCE_MS / 1000} seconds')`;
}
