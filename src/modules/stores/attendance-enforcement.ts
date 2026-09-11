import { TimekeepingRequirement } from './entities/store-shift-config.entity';

/**
 * Attendance rule enforcement.
 *
 * `StoreTimekeepingSetting.requireQrScan` / `requireLocation` / `attendanceRadius`
 * and `StoreShiftConfig.timekeepingRequirement` have always been configurable —
 * and both booleans default to `true` — but nothing in the check-in path ever
 * read them. QR was verified only when the client chose to send `qrStoreId`, and
 * GPS was explicitly recorded "never block".
 *
 * Turning that on unconditionally would immediately lock out every employee
 * running an app build that does not send a location fix, so enforcement is
 * staged through `ATTENDANCE_ENFORCEMENT_MODE`:
 *
 *  - `off`     (default) — evaluate the rules and report violations for logging
 *                          only; attendance still succeeds. Use this to measure
 *                          how many real check-ins would break before enabling.
 *  - `enforce`           — a violation rejects the attendance request.
 *
 * Once client rollout is complete, flip the variable to `enforce`.
 */

export type AttendanceEnforcementMode = 'off' | 'enforce';

export const ATTENDANCE_ENFORCEMENT_ENV = 'ATTENDANCE_ENFORCEMENT_MODE';

export function resolveAttendanceEnforcementMode(
  env: NodeJS.ProcessEnv,
): AttendanceEnforcementMode {
  const value = env[ATTENDANCE_ENFORCEMENT_ENV];
  if (value === undefined || value === '' || value === 'off') return 'off';
  if (value === 'enforce') return 'enforce';
  throw new Error(`${ATTENDANCE_ENFORCEMENT_ENV} must be "off" or "enforce"`);
}

export type AttendanceViolation =
  | 'QR_REQUIRED'
  | 'QR_MISMATCH'
  | 'LOCATION_REQUIRED'
  | 'OUT_OF_RANGE';

export interface AttendanceRuleInput {
  /** Store-level policy; absent settings fall back to the entity defaults. */
  requirement?: TimekeepingRequirement | null;
  requireQrScan?: boolean | null;
  requireLocation?: boolean | null;
  attendanceRadius?: number | null;
  /** Employee is listed in `location_exception_emp_ids`. */
  locationExempt?: boolean;
  /** Store id decoded from the scanned QR, if the client sent one. */
  qrStoreId?: string | null;
  /** Store that owns the shift being attended. */
  expectedStoreId?: string | null;
  /** Haversine distance to the store, in metres, when a fix was supplied. */
  distanceMeters?: number | null;
  /** Whether the client supplied a location fix at all. */
  hasLocationFix: boolean;
}

const QR_REQUIREMENTS = new Set<TimekeepingRequirement>([
  TimekeepingRequirement.LOCATION_QR_GPS_FACEID,
  TimekeepingRequirement.QR_ONLY,
]);

const GPS_REQUIREMENTS = new Set<TimekeepingRequirement>([
  TimekeepingRequirement.LOCATION_QR_GPS_FACEID,
  TimekeepingRequirement.GPS_ONLY,
]);

const VIOLATION_MESSAGES: Record<AttendanceViolation, string> = {
  QR_REQUIRED: 'Cửa hàng yêu cầu quét mã QR khi chấm công.',
  QR_MISMATCH: 'Mã QR không khớp với cửa hàng của ca làm việc này',
  LOCATION_REQUIRED: 'Cửa hàng yêu cầu bật vị trí khi chấm công.',
  OUT_OF_RANGE: 'Bạn đang ở ngoài phạm vi chấm công của cửa hàng.',
};

export function describeAttendanceViolation(
  violation: AttendanceViolation,
): string {
  return VIOLATION_MESSAGES[violation];
}

/**
 * Returns every rule the request breaks, most specific first. An empty array
 * means the request satisfies the store's configured policy.
 */
export function evaluateAttendanceRules(
  input: AttendanceRuleInput,
): AttendanceViolation[] {
  const violations: AttendanceViolation[] = [];
  const requirement =
    input.requirement ?? TimekeepingRequirement.LOCATION_QR_GPS_FACEID;

  // --- QR ---
  const qrRequired =
    (input.requireQrScan ?? true) && QR_REQUIREMENTS.has(requirement);

  if (input.qrStoreId) {
    // A supplied QR is always checked, whether or not the store requires one.
    if (input.expectedStoreId && input.qrStoreId !== input.expectedStoreId) {
      violations.push('QR_MISMATCH');
    }
  } else if (qrRequired) {
    violations.push('QR_REQUIRED');
  }

  // --- Location ---
  const locationRequired =
    (input.requireLocation ?? true) &&
    GPS_REQUIREMENTS.has(requirement) &&
    !input.locationExempt;

  if (!input.hasLocationFix) {
    if (locationRequired) violations.push('LOCATION_REQUIRED');
    return violations;
  }

  // A fix was supplied: range is checked whenever the store defines a radius
  // and the policy asks for location, so an exempt employee is never blocked.
  const radius = input.attendanceRadius;
  if (
    locationRequired &&
    typeof radius === 'number' &&
    radius > 0 &&
    typeof input.distanceMeters === 'number' &&
    input.distanceMeters > radius
  ) {
    violations.push('OUT_OF_RANGE');
  }

  return violations;
}
