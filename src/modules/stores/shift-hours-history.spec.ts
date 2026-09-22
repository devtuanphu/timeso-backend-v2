import { StoresService } from './stores.service';
import {
  AttendanceStatus,
  ShiftAssignmentStatus,
} from './entities/shift-management.entity';
import { LeaveType } from './entities/employee-leave-request.entity';

/**
 * "Ca & giờ đã làm → Thông tin ca": each row carries the same deltas as the
 * check-in/out result screens, auto check-outs are flagged, approved full-day
 * leave shows as "Nghỉ phép", and tab filters work by key.
 */
const slot = (workDate: string, startTime: string, endTime: string) => ({
  workDate,
  startTime,
  endTime,
  workShift: { shiftName: 'Ca', startTime, endTime },
});

const row = (over: Record<string, unknown>) => ({
  id: 'a',
  status: ShiftAssignmentStatus.COMPLETED,
  attendanceStatus: AttendanceStatus.ON_TIME,
  checkInTime: null,
  checkOutTime: null,
  workedMinutes: 0,
  lateMinutes: 0,
  earlyMinutes: 0,
  isAutoCheckout: false,
  autoCheckoutReason: null,
  scheduledCheckoutTime: null,
  shiftSlot: slot('2026-09-10', '08:00:00', '12:00:00'),
  ...over,
});

const build = (rows: unknown[], leaves: unknown[] = []) => {
  const service = Object.create(StoresService.prototype) as any;
  const qb: any = {};
  for (const method of [
    'leftJoinAndSelect',
    'leftJoin',
    'where',
    'andWhere',
    'orderBy',
  ]) {
    qb[method] = jest.fn(() => qb);
  }
  qb.getMany = jest.fn().mockResolvedValue(rows);
  service.shiftAssignmentRepository = { createQueryBuilder: jest.fn(() => qb) };
  service.leaveRequestRepository = { find: jest.fn().mockResolvedValue(leaves) };
  return service;
};

describe('getEmployeeShiftHours rows', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-20T03:00:00Z'));
  });
  afterAll(() => jest.useRealTimers());

  it('adds early arrival, overtime, auto check-out and tab keys', async () => {
    const service = build([
      row({
        id: 'early-in-overtime',
        checkInTime: new Date('2026-09-10T07:48:00+07:00'),
        checkOutTime: new Date('2026-09-10T12:20:00+07:00'),
        workedMinutes: 272,
      }),
      row({
        id: 'late-and-early',
        attendanceStatus: AttendanceStatus.LATE_AND_EARLY,
        checkInTime: new Date('2026-09-10T08:07:00+07:00'),
        checkOutTime: new Date('2026-09-10T11:00:00+07:00'),
        lateMinutes: 7,
        earlyMinutes: 60,
      }),
      row({
        id: 'auto',
        attendanceStatus: AttendanceStatus.FORGOT_CHECKOUT,
        checkInTime: new Date('2026-09-10T08:00:00+07:00'),
        checkOutTime: new Date('2026-09-10T12:15:00+07:00'),
        isAutoCheckout: true,
        autoCheckoutReason: 'FORGOT_CHECKOUT',
        scheduledCheckoutTime: new Date('2026-09-10T12:00:00+07:00'),
      }),
    ]);
    const result = await service.getEmployeeShiftHours('s1', 'p1', '2026-09');
    const byId = Object.fromEntries(result.shifts.map((s: any) => [s.id, s]));

    expect(byId['early-in-overtime']).toMatchObject({
      status: 'Đúng giờ',
      earlyArrivalMinutes: 12,
      overtimeMinutes: 20,
      autoCheckedOut: false,
      statusKeys: ['on_time', 'overtime'],
    });
    expect(byId['late-and-early']).toMatchObject({
      status: 'Đi trễ · Về sớm',
      lateMinutes: 7,
      earlyMinutes: 60,
      statusKeys: ['late', 'early'],
    });
    expect(byId.auto).toMatchObject({
      status: 'Quên chấm công ra',
      autoCheckedOut: true,
      overtimeMinutes: 0,
      scheduledCheckoutTime: '2026-09-10T05:00:00.000Z',
    });
    // 272 + 0 + 0 worked minutes: legacy hours/remainder plus the exact total.
    expect(result).toMatchObject({
      totalHours: 4,
      totalMinutes: 32,
      totalWorkedMinutes: 272,
    });
    expect(result.tabCounts).toMatchObject({
      overtime: 1,
      late: 1,
      early: 1,
      forgot: 1,
      on_time: 1,
    });

    const overtimeOnly = await build([
      row({
        id: 'early-in-overtime',
        checkInTime: new Date('2026-09-10T07:48:00+07:00'),
        checkOutTime: new Date('2026-09-10T12:20:00+07:00'),
      }),
      row({ id: 'plain', checkInTime: new Date('2026-09-10T08:00:00+07:00') }),
    ]).getEmployeeShiftHours('s1', 'p1', '2026-09', 'overtime');
    expect(overtimeOnly.shifts.map((s: any) => s.id)).toEqual([
      'early-in-overtime',
    ]);
  });

  it('shows an ended shift under approved full-day leave as "Nghỉ phép"', async () => {
    const service = build(
      [
        row({
          id: 'on-leave',
          status: ShiftAssignmentStatus.APPROVED,
          attendanceStatus: null,
        }),
        row({
          id: 'late-request-only',
          status: ShiftAssignmentStatus.APPROVED,
          attendanceStatus: null,
          shiftSlot: slot('2026-09-11', '08:00:00', '12:00:00'),
        }),
      ],
      [
        {
          type: LeaveType.SICK,
          status: 'APPROVED',
          startDate: '2026-09-10',
          endDate: '2026-09-10',
          startTime: null,
          endTime: null,
          shiftAssignmentId: null,
        },
        {
          type: LeaveType.LATE,
          status: 'APPROVED',
          startDate: '2026-09-11',
          endDate: '2026-09-11',
          startTime: null,
          endTime: null,
          shiftAssignmentId: null,
        },
      ],
    );
    const result = await service.getEmployeeShiftHours('s1', 'p1', '2026-09');
    expect(result.shifts.map((s: any) => s.id)).toEqual(['on-leave']);
    expect(result.shifts[0]).toMatchObject({
      status: 'Nghỉ phép',
      onLeave: true,
      statusKeys: ['leave'],
    });
    expect(result.tabCounts.leave).toBe(1);
  });
});
