/**
 * The owner's "Thiết lập ca làm & chấm công" minute rules at check-in and
 * check-out, read from the store's timekeeping settings row through the real
 * policy step: grace minutes (late/early within them is on time), the early
 * check-in window, and worked-time credit. Without a row the behaviour is
 * the one before these rules existed.
 */
import { BadRequestException } from '@nestjs/common';

import {
  AttendanceStatus,
  ShiftAssignmentStatus,
} from './entities/shift-management.entity';
import { CHECK_IN_TOO_EARLY_CODE, StoresService } from './stores.service';

// Shift 08:00–12:00 on 2026-10-01 (Vietnam).
const SLOT = {
  workDate: '2026-10-01',
  startTime: null,
  endTime: null,
  cycle: { storeId: 'store-1' },
  workShift: { shiftName: 'Sáng', startTime: '08:00:00', endTime: '12:00:00' },
};
const vn = (clock: string) => new Date(`2026-10-01T${clock}:00+07:00`);

function build(assignment: any, setting: Record<string, unknown> | null) {
  const service = Object.create(StoresService.prototype) as any;
  service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  service.activityLogService = { record: jest.fn().mockResolvedValue(undefined) };
  service.shiftAssignmentRepository = {
    findOne: jest.fn().mockResolvedValue(assignment),
  };
  service.timekeepingSettingRepository = {
    findOne: jest.fn().mockResolvedValue(setting),
  };
  service.shiftConfigRepository = { findOne: jest.fn().mockResolvedValue(null) };
  service.storeRepository = { findOne: jest.fn().mockResolvedValue(null) };
  service.employeeFaceRepository = {
    findOne: jest.fn().mockResolvedValue({ faceDescriptors: [[0.1]] }),
  };
  service.faceRecognitionService = {
    extractDescriptor: jest.fn().mockResolvedValue([0.1]),
    compareFaces: jest.fn().mockReturnValue({ matched: true, distance: 0.2 }),
  };
  const set = jest.fn().mockReturnThis();
  const queryBuilder: any = {
    update: jest.fn().mockReturnThis(),
    set,
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const manager = {
    create: jest.fn((_entity: unknown, data: any) => ({ ...data })),
    save: jest.fn(async (_entity: unknown, value: any) => value),
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn(() => queryBuilder),
  };
  service.dataSource = { transaction: jest.fn(async (cb: any) => cb(manager)) };
  service.profileRepository = { update: jest.fn().mockResolvedValue({}) };
  // No approved overtime unless a test says so.
  service.bonusWorkRequestRepository = { findOne: jest.fn().mockResolvedValue(null) };
  service.appendToDailyReport = jest.fn();
  // Check-out hands payroll and the shift-end workflow off after commit.
  service.processCheckoutPayroll = jest.fn().mockResolvedValue(undefined);
  service.shiftEndWorkflowService = {
    markCompletedByEmployee: jest.fn().mockResolvedValue(undefined),
  };
  service.attendanceQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const afterAttendance = jest.fn().mockResolvedValue(undefined);
  service.ownerNotificationService = { afterAttendance };
  /** Values written to the assignment row. */
  const written = () => set.mock.calls[0]?.[0];
  return { service, written, afterAttendance };
}

const approved = () => ({
  id: 'as-1',
  status: ShiftAssignmentStatus.APPROVED,
  employeeId: 'emp-1',
  checkInTime: null,
  employee: { id: 'emp-1', accountId: 'staff-1', employmentStatus: 'active' },
  shiftSlot: SLOT,
});

const checkedIn = (checkIn: string, lateMinutes: number) => ({
  ...approved(),
  status: ShiftAssignmentStatus.CONFIRMED,
  checkInTime: vn(checkIn),
  lateMinutes,
  attendanceStatus:
    lateMinutes > 0 ? AttendanceStatus.LATE : AttendanceStatus.ON_TIME,
});

describe('check-in with the store attendance rules', () => {
  afterEach(() => jest.useRealTimers());
  const at = (clock: string) =>
    jest.useFakeTimers({
      now: vn(clock),
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });

  it('records a late arrival within the allowed minutes as on time', async () => {
    at('08:07');
    const { service, written, afterAttendance } = build(approved(), {
      allowedLateMinutes: 10,
    });

    const result = await service.checkInWithFace('as-1', Buffer.from('x'), 'staff-1');

    expect(result).toMatchObject({
      matched: true,
      lateMinutes: 0,
      attendanceStatus: AttendanceStatus.ON_TIME,
    });
    expect(written()).toMatchObject({
      lateMinutes: 0,
      attendanceStatus: AttendanceStatus.ON_TIME,
    });
    expect(service.appendToDailyReport).not.toHaveBeenCalled();
    expect(afterAttendance).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'check_in', lateMinutes: 0 }),
    );
  });

  it('records the full late minutes beyond the allowed minutes', async () => {
    at('08:15');
    const { service, written } = build(approved(), { allowedLateMinutes: 10 });

    await service.checkInWithFace('as-1', Buffer.from('x'), 'staff-1');

    expect(written()).toMatchObject({
      lateMinutes: 15,
      attendanceStatus: AttendanceStatus.LATE,
    });
  });

  it('keeps every late minute without a settings row (no grace)', async () => {
    at('08:05');
    const { service, written } = build(approved(), null);

    await service.checkInWithFace('as-1', Buffer.from('x'), 'staff-1');

    expect(written()).toMatchObject({
      lateMinutes: 5,
      attendanceStatus: AttendanceStatus.LATE,
    });
  });

  it('refuses a check-in before the window opens, before face inference', async () => {
    at('07:40');
    const { service, written } = build(approved(), { earlyCheckinMinutes: 15 });

    const attempt = service.checkInWithFace('as-1', Buffer.from('x'), 'staff-1');

    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toMatchObject({
      response: {
        code: CHECK_IN_TOO_EARLY_CODE,
        message: 'Chưa đến giờ check-in. Bạn có thể check-in từ 07:45.',
      },
    });
    expect(service.faceRecognitionService.extractDescriptor).not.toHaveBeenCalled();
    expect(written()).toBeUndefined();
  });

  it('accepts a check-in in the first minute of the window', async () => {
    at('07:45');
    const { service, written } = build(approved(), { earlyCheckinMinutes: 15 });

    await service.checkInWithFace('as-1', Buffer.from('x'), 'staff-1');

    expect(written()).toMatchObject({
      lateMinutes: 0,
      attendanceStatus: AttendanceStatus.ON_TIME,
    });
  });

  it('follows a wider window set by the owner', async () => {
    at('07:00');
    const { service, written } = build(approved(), { earlyCheckinMinutes: 60 });

    await service.checkInWithFace('as-1', Buffer.from('x'), 'staff-1');

    expect(written()).toMatchObject({ attendanceStatus: AttendanceStatus.ON_TIME });
  });
});

describe('check-out with the store attendance rules', () => {
  afterEach(() => jest.useRealTimers());
  const at = (clock: string) =>
    jest.useFakeTimers({
      now: vn(clock),
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });

  it('counts a forgiven late arrival and early leave as full time', async () => {
    at('11:55');
    const { service, written } = build(checkedIn('08:07', 0), {
      allowedLateMinutes: 10,
    });

    await service.checkOutWithFace('as-1', Buffer.from('x'), 'staff-1');

    expect(written()).toMatchObject({
      earlyMinutes: 0,
      workedMinutes: 240,
      attendanceStatus: AttendanceStatus.ON_TIME,
    });
  });

  it('deducts late and early time beyond the allowed minutes', async () => {
    at('11:30');
    const { service, written } = build(checkedIn('08:20', 20), {
      allowedLateMinutes: 10,
    });

    await service.checkOutWithFace('as-1', Buffer.from('x'), 'staff-1');

    expect(written()).toMatchObject({
      earlyMinutes: 30,
      workedMinutes: 190,
      attendanceStatus: AttendanceStatus.LATE_AND_EARLY,
    });
  });

  it('counts full time when the store says so, still recording late/early', async () => {
    at('11:00');
    const { service, written } = build(checkedIn('08:30', 30), {
      countFullTimeIfLate: true,
    });

    await service.checkOutWithFace('as-1', Buffer.from('x'), 'staff-1');

    expect(written()).toMatchObject({
      earlyMinutes: 60,
      workedMinutes: 240,
      attendanceStatus: AttendanceStatus.LATE_AND_EARLY,
    });
  });

  it('keeps the recorded lateness when the owner changed the grace mid-shift', async () => {
    // Late 7 recorded under grace 5; grace is now 10.
    at('12:00');
    const { service, written } = build(checkedIn('08:07', 7), {
      allowedLateMinutes: 10,
    });

    await service.checkOutWithFace('as-1', Buffer.from('x'), 'staff-1');

    expect(written()).toMatchObject({
      workedMinutes: 233,
      attendanceStatus: AttendanceStatus.LATE,
    });
  });

  it('is check-in to check-out without a settings row', async () => {
    at('11:50');
    const { service, written } = build(checkedIn('08:05', 5), null);

    await service.checkOutWithFace('as-1', Buffer.from('x'), 'staff-1');

    expect(written()).toMatchObject({
      earlyMinutes: 10,
      workedMinutes: 225,
      attendanceStatus: AttendanceStatus.LATE_AND_EARLY,
    });
  });
});

describe('check-out pays only the shift and approved overtime', () => {
  afterEach(() => jest.useRealTimers());
  const at = (clock: string) =>
    jest.useFakeTimers({
      now: vn(clock),
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });

  it('stops at the shift end without an approved overtime request', async () => {
    // Shift 08:00-12:00, stayed until 14:00 with no overtime request.
    at('14:00');
    const { service, written } = build(checkedIn('08:00', 0), null);

    await service.checkOutWithFace('as-1', Buffer.from('x'), 'staff-1');

    expect(written()).toMatchObject({ earlyMinutes: 0, workedMinutes: 240 });
  });

  it('pays up to the approved overtime end', async () => {
    at('14:00');
    const { service, written } = build(checkedIn('08:00', 0), null);
    service.bonusWorkRequestRepository.findOne.mockResolvedValue({
      status: 'APPROVED',
      requestDate: '2026-10-01',
      endTime: '13:00:00',
    });

    await service.checkOutWithFace('as-1', Buffer.from('x'), 'staff-1');

    expect(written()).toMatchObject({ workedMinutes: 300 });
    expect(service.bonusWorkRequestRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shiftAssignmentId: 'as-1', status: 'APPROVED' },
      }),
    );
  });

  it('does not pay the time before the shift start', async () => {
    at('12:00');
    const { service, written } = build(checkedIn('07:45', 0), null);

    await service.checkOutWithFace('as-1', Buffer.from('x'), 'staff-1');

    expect(written()).toMatchObject({ workedMinutes: 240 });
  });
});

describe('overtime decided after the employee checked out', () => {
  const completed = (over: Record<string, unknown> = {}) => ({
    id: 'as-1',
    status: ShiftAssignmentStatus.COMPLETED,
    employeeId: 'emp-1',
    checkInTime: vn('08:00'),
    checkOutTime: vn('14:00'),
    lateMinutes: 0,
    workedMinutes: 240,
    isAutoCheckout: false,
    shiftSlot: SLOT,
    ...over,
  });

  const buildDecision = (
    assignment: Record<string, unknown>,
    approved: Record<string, unknown> | null,
  ) => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    service.shiftAssignmentRepository = {
      findOne: jest.fn().mockResolvedValue(assignment),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    service.timekeepingSettingRepository = { findOne: jest.fn().mockResolvedValue(null) };
    service.bonusWorkRequestRepository = { findOne: jest.fn().mockResolvedValue(approved) };
    service.processCheckoutPayroll = jest.fn().mockResolvedValue(undefined);
    return service;
  };
  const request = { id: 'ot-1', shiftAssignmentId: 'as-1' } as any;
  const approvedTo13 = { status: 'APPROVED', requestDate: '2026-10-01', endTime: '13:00:00' };

  it('approving pays the overtime and recomputes the payslip', async () => {
    const service = buildDecision(completed(), approvedTo13);

    await service.repriceCheckedOutOvertime(request);

    expect(service.shiftAssignmentRepository.update).toHaveBeenCalledWith(
      { id: 'as-1', status: ShiftAssignmentStatus.COMPLETED },
      { workedMinutes: 300 },
    );
    expect(service.processCheckoutPayroll).toHaveBeenCalledWith('as-1');
  });

  it('rejecting an earlier approval takes the overtime back', async () => {
    const service = buildDecision(completed({ workedMinutes: 300 }), null);

    await service.repriceCheckedOutOvertime(request);

    expect(service.shiftAssignmentRepository.update).toHaveBeenCalledWith(
      expect.anything(),
      { workedMinutes: 240 },
    );
    expect(service.processCheckoutPayroll).toHaveBeenCalledWith('as-1');
  });

  it('leaves unchanged minutes, open shifts and automatic check-outs alone', async () => {
    for (const assignment of [
      completed(),
      completed({ status: ShiftAssignmentStatus.CONFIRMED, checkOutTime: null }),
      completed({ isAutoCheckout: true, workedMinutes: 240 }),
    ]) {
      const service = buildDecision(assignment, null);
      await service.repriceCheckedOutOvertime(request);
      expect(service.shiftAssignmentRepository.update).not.toHaveBeenCalled();
      expect(service.processCheckoutPayroll).not.toHaveBeenCalled();
    }
  });

  it('runs when the owner approves or rejects', async () => {
    const service = Object.create(StoresService.prototype) as any;
    const saved = { ...request, status: 'APPROVED' };
    service.loadBonusWorkRequestForOwner = jest.fn().mockResolvedValue({
      request: { ...request },
      approverProfileId: 'owner-profile',
    });
    service.bonusWorkRequestRepository = { save: jest.fn().mockResolvedValue(saved) };
    service.logBonusWorkActivity = jest.fn().mockResolvedValue(undefined);
    service.repriceCheckedOutOvertime = jest.fn().mockResolvedValue(undefined);

    await service.approveBonusWorkRequest('ot-1', 'owner-1');
    await service.rejectBonusWorkRequest('ot-1', 'owner-1', 'Không cần');

    expect(service.repriceCheckedOutOvertime).toHaveBeenCalledTimes(2);
  });
});
