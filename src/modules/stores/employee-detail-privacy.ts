/**
 * Fields of `GET /stores/employees/:profileId` that are owner-private.
 *
 * The employee keeps their own identity document, bank/finance data, contracts,
 * schedule and attendance summary. What is removed is data the owner records
 * *about* the employee:
 * - `capabilityPoints`: the owner's capability score total (the scoring
 *   entries themselves are owner-only at `GET .../capability-points`).
 * - `terminationReasonId` / `terminationReason`: the owner's classification of
 *   a termination (normally null for an employed self, stripped defensively).
 *
 * The profile/contract/account entities carry no owner-note or reviewer-note
 * column; if one is added, list it here.
 */
export const OWNER_PRIVATE_EMPLOYEE_PROFILE_FIELDS = [
  'capabilityPoints',
  'terminationReasonId',
  'terminationReason',
] as const;

/** Removes owner-private fields from an employee-detail response for a self read. */
export const toSelfEmployeeDetail = <T extends { profile?: unknown }>(
  detail: T,
): T => {
  if (!detail?.profile || typeof detail.profile !== 'object') return detail;
  const profile = { ...(detail.profile as Record<string, unknown>) };
  for (const field of OWNER_PRIVATE_EMPLOYEE_PROFILE_FIELDS) {
    delete profile[field];
  }
  return { ...detail, profile };
};

/**
 * Career history for a self read: the owner's free-text decision `note` is
 * owner-private and is returned as null (shape kept for clients).
 */
export const toSelfCareerHistory = <T extends { note?: unknown }>(
  events: T[],
): T[] => events.map((event) => ({ ...event, note: null }));
