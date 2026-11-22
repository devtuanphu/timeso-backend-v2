/**
 * Reduced payloads for the scoped-approver inbox. Every view is built from an
 * EXPLICIT allowlist of fields — entities are never spread (A5) — so the money
 * requests (salary advance, KPI) can never leak net salary, approved amounts of
 * other people, payslips or warnings to an approver (N2). The owner keeps their
 * own full endpoints unchanged.
 */

export interface ApproverEmployeeView {
  id: string;
  fullName: string | null;
  avatar: string | null;
  role: string | null;
}

/**
 * R2/A1: strip the employee's free-text field(s) (and any other sensitive
 * relation) from a DECISION response when the decider is a scoped approver
 * without can_view_reasons. The owner, and an approver who may view reasons,
 * get the response unchanged. Produces a shallow copy so the DB entity passed in
 * is never mutated (these objects are often the saved entity itself).
 */
export function redactDecisionReasons<T extends Record<string, any>>(
  response: T,
  decider: { asOwner: boolean; canViewReasons: boolean },
  fields: Array<keyof T>,
): T {
  if (decider.asOwner || decider.canViewReasons) return response;
  const copy: Record<string, any> = { ...response };
  for (const field of fields) copy[field as string] = null;
  return copy as T;
}

/** The employee of a request, name + role only. */
export function approverEmployeeView(
  profile:
    | {
        id: string;
        account?: { fullName?: string | null; avatar?: string | null } | null;
        storeRole?: { name?: string | null } | null;
      }
    | null
    | undefined,
): ApproverEmployeeView | null {
  if (!profile) return null;
  return {
    id: profile.id,
    fullName: profile.account?.fullName ?? null,
    avatar: profile.account?.avatar ?? null,
    role: profile.storeRole?.name ?? null,
  };
}

/**
 * R2: a scoped approver without `can_view_reasons` never sees the employee's
 * free-text. The flag is honoured HERE in the allowlist builders (and in the
 * fan-out) — the enforcement point is server-side, never trusted from the
 * client. The owner always passes `canViewReasons = true`.
 */
export function leaveRequestView(
  row: any,
  employee: ApproverEmployeeView | null,
  canViewReasons = true,
) {
  return {
    id: row.id,
    status: row.status,
    type: row.type,
    startDate: row.startDate,
    endDate: row.endDate,
    startTime: row.startTime ?? null,
    endTime: row.endTime ?? null,
    reason: canViewReasons ? (row.reason ?? null) : null,
    createdAt: row.createdAt,
    employee,
  };
}

export function shiftChangeRequestView(
  row: any,
  employee: ApproverEmployeeView | null,
  canViewReasons = true,
) {
  return {
    id: row.id,
    status: row.status,
    requestDate: row.requestDate,
    currentShiftId: row.currentShiftId ?? null,
    requestedShiftId: row.requestedShiftId ?? null,
    reason: canViewReasons ? (row.reason ?? null) : null,
    createdAt: row.createdAt,
    employee,
  };
}

export function bonusWorkRequestView(
  row: any,
  employee: ApproverEmployeeView | null,
  canViewReasons = true,
) {
  return {
    id: row.id,
    status: row.status,
    requestDate: row.requestDate,
    startTime: row.startTime ?? null,
    endTime: row.endTime ?? null,
    reason: canViewReasons ? (row.reason ?? null) : null,
    createdAt: row.createdAt,
    employee,
  };
}

export function customShiftRequestView(
  row: any,
  employee: ApproverEmployeeView | null,
  canViewReasons = true,
) {
  return {
    id: row.id,
    status: row.status,
    startDate: row.startDate,
    endDate: row.endDate,
    daysOfWeek: row.daysOfWeek ?? null,
    startTime: row.startTime,
    endTime: row.endTime,
    note: canViewReasons ? (row.note ?? null) : null,
    createdAt: row.createdAt,
    employee,
  };
}

/**
 * A pending shift self-registration. `id` is the ShiftAssignment id — exactly
 * what `POST /stores/approvals/:requestId` expects for type REGISTER. No pay.
 */
export function shiftRegistrationView(
  row: any,
  employee: ApproverEmployeeView | null,
) {
  const slot = row.shiftSlot;
  const ws = slot?.workShift;
  return {
    id: row.id,
    status: row.status,
    employee,
    shiftName: ws?.shiftName ?? null,
    workDate: slot?.workDate ?? null,
    startTime: slot?.startTime ?? ws?.startTime ?? null,
    endTime: slot?.endTime ?? ws?.endTime ?? null,
    createdAt: row.createdAt,
  };
}

/** NO net salary, NO approved amounts of others, NO payslip, NO warnings. */
export function salaryAdvanceRequestView(
  row: any,
  employee: ApproverEmployeeView | null,
  canViewReasons = true,
) {
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requestedAt ?? row.createdAt,
    requestedAmount: row.requestedAmount,
    requestReason: canViewReasons ? (row.requestReason ?? null) : null,
    employee,
  };
}

/** NO pay data; `employeeKpi` is name + month only (there is no "period"). */
export function kpiApprovalRequestView(
  row: any,
  employee: ApproverEmployeeView | null,
  canViewReasons = true,
) {
  return {
    id: row.id,
    status: row.status,
    note: canViewReasons ? (row.note ?? null) : null,
    employeeKpi: row.employeeKpi
      ? {
          id: row.employeeKpi.id,
          name: row.employeeKpi.name ?? null,
          month: row.employeeKpi.month ?? null,
        }
      : null,
    employee,
  };
}

/** Minimal applicant PII: name only. Honours contact redaction. */
export function jobApplicationApproverView(row: any) {
  return {
    id: row.id,
    fullName: row.fullName ?? null,
    status: row.status,
    createdAt: row.createdAt,
  };
}
