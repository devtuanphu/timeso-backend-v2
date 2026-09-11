import { TimekeepingRequirement } from './entities/store-shift-config.entity';
import {
  evaluateAttendanceRules,
  resolveAttendanceEnforcementMode,
  type AttendanceRuleInput,
} from './attendance-enforcement';

const STORE = 'store-1';

const base = (over: Partial<AttendanceRuleInput> = {}): AttendanceRuleInput => ({
  requirement: TimekeepingRequirement.LOCATION_QR_GPS_FACEID,
  requireQrScan: true,
  requireLocation: true,
  attendanceRadius: 50,
  expectedStoreId: STORE,
  qrStoreId: STORE,
  hasLocationFix: true,
  distanceMeters: 10,
  ...over,
});

describe('resolveAttendanceEnforcementMode', () => {
  it('defaults to off so a deploy cannot lock anyone out', () => {
    expect(resolveAttendanceEnforcementMode({})).toBe('off');
    expect(resolveAttendanceEnforcementMode({ ATTENDANCE_ENFORCEMENT_MODE: '' })).toBe('off');
    expect(resolveAttendanceEnforcementMode({ ATTENDANCE_ENFORCEMENT_MODE: 'off' })).toBe('off');
  });

  it('accepts enforce', () => {
    expect(
      resolveAttendanceEnforcementMode({ ATTENDANCE_ENFORCEMENT_MODE: 'enforce' }),
    ).toBe('enforce');
  });

  it('rejects anything else rather than silently disabling enforcement', () => {
    expect(() =>
      resolveAttendanceEnforcementMode({ ATTENDANCE_ENFORCEMENT_MODE: 'true' }),
    ).toThrow(/must be/);
  });
});

describe('evaluateAttendanceRules', () => {
  it('passes a compliant request', () => {
    expect(evaluateAttendanceRules(base())).toEqual([]);
  });

  // Regression: the QR step was `if (options?.qrStoreId && storeId)`, so simply
  // omitting the field skipped store verification entirely.
  it('rejects a missing QR when the store requires one', () => {
    expect(evaluateAttendanceRules(base({ qrStoreId: null }))).toEqual(['QR_REQUIRED']);
  });

  it('rejects a QR from another store', () => {
    expect(evaluateAttendanceRules(base({ qrStoreId: 'store-2' }))).toEqual(['QR_MISMATCH']);
  });

  it('checks a supplied QR even when the store does not require one', () => {
    expect(
      evaluateAttendanceRules(base({ requireQrScan: false, qrStoreId: 'store-2' })),
    ).toEqual(['QR_MISMATCH']);
  });

  it('allows a missing QR when the store does not require one', () => {
    expect(evaluateAttendanceRules(base({ requireQrScan: false, qrStoreId: null }))).toEqual([]);
  });

  it('does not ask for QR under a GPS-only policy', () => {
    expect(
      evaluateAttendanceRules(
        base({ requirement: TimekeepingRequirement.GPS_ONLY, qrStoreId: null }),
      ),
    ).toEqual([]);
  });

  // Regression: GPS was recorded but explicitly "never blocked".
  it('rejects a missing location fix when the store requires one', () => {
    expect(
      evaluateAttendanceRules(base({ hasLocationFix: false, distanceMeters: null })),
    ).toEqual(['LOCATION_REQUIRED']);
  });

  it('rejects a fix outside the configured radius', () => {
    expect(evaluateAttendanceRules(base({ distanceMeters: 120 }))).toEqual(['OUT_OF_RANGE']);
  });

  it('accepts a fix exactly on the radius boundary', () => {
    expect(evaluateAttendanceRules(base({ distanceMeters: 50 }))).toEqual([]);
  });

  it('exempts employees listed as location exceptions', () => {
    expect(
      evaluateAttendanceRules(base({ locationExempt: true, hasLocationFix: false })),
    ).toEqual([]);
    expect(
      evaluateAttendanceRules(base({ locationExempt: true, distanceMeters: 5000 })),
    ).toEqual([]);
  });

  it('does not ask for location under a QR-only policy', () => {
    expect(
      evaluateAttendanceRules(
        base({ requirement: TimekeepingRequirement.QR_ONLY, hasLocationFix: false }),
      ),
    ).toEqual([]);
  });

  it('ignores a non-positive radius', () => {
    expect(evaluateAttendanceRules(base({ attendanceRadius: 0, distanceMeters: 9999 }))).toEqual([]);
  });

  it('reports every broken rule at once', () => {
    expect(
      evaluateAttendanceRules(base({ qrStoreId: null, hasLocationFix: false })),
    ).toEqual(['QR_REQUIRED', 'LOCATION_REQUIRED']);
  });

  it('falls back to the strictest policy when settings are absent', () => {
    expect(
      evaluateAttendanceRules({
        expectedStoreId: STORE,
        hasLocationFix: false,
      }),
    ).toEqual(['QR_REQUIRED', 'LOCATION_REQUIRED']);
  });
});
