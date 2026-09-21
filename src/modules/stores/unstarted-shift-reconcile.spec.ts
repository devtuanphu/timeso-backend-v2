import {
  CHECK_IN_REMINDER_AFTER_MINUTES,
  ShiftEndWorkflowService,
  shiftAlertChannel,
} from './shift-end-workflow.service';
import { AttendanceStatus } from './entities/shift-management.entity';

/**
 * Ca đã có người nhận mà chưa check-in: nhắc sau 5 phút; qua giờ kết thúc thì
 * ghi nghỉ không phép ngay, thay vì để ca mở tới hết ngày.
 */
const at = (hhmm: string, date = '2026-09-18') =>
  new Date(`${date}T${hhmm}:00+07:00`);

const assignment = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  employeeId: 'p1',
  employee: { accountId: 'acc-1', reminderSettings: null },
  shiftSlot: {
    workDate: '2026-09-18',
    startTime: '08:00',
    endTime: '12:00',
    workShift: { startTime: '08:00', endTime: '12:00' },
    cycle: { storeId: 's1' },
  },
  ...over,
});

const build = (
  rows: unknown[],
  opts: { onLeave?: boolean; reminded?: boolean } = {},
) => {
  const service = Object.create(ShiftEndWorkflowService.prototype) as any;
  const updateBuilder: any = {
    update: jest.fn(() => updateBuilder),
    set: jest.fn(() => updateBuilder),
    where: jest.fn(() => updateBuilder),
    andWhere: jest.fn(() => updateBuilder),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const listBuilder: any = {
    leftJoinAndSelect: jest.fn(() => listBuilder),
    where: jest.fn(() => listBuilder),
    andWhere: jest.fn(() => listBuilder),
    getMany: jest.fn().mockResolvedValue(rows),
  };
  service.assignmentRepository = {
    createQueryBuilder: jest.fn((alias?: string) =>
      alias ? listBuilder : updateBuilder,
    ),
  };
  service.dataSource = {
    query: jest.fn(async (sql: string) =>
      sql.includes('employee_leave_requests')
        ? [{ covered: !!opts.onLeave }]
        : opts.reminded
          ? [{ '?column?': 1 }]
          : [],
    ),
  };
  service.notificationsService = { create: jest.fn().mockResolvedValue({}) };
  service.attendanceQueue = { add: jest.fn().mockResolvedValue({}) };
  service.logger = { warn: jest.fn(), error: jest.fn() };
  return { service, updateBuilder, listBuilder };
};

describe('ca chưa check-in', () => {
  it('chưa tới 5 phút sau giờ vào ca thì chưa làm gì', async () => {
    const { service } = build([assignment()]);
    const result = await service.reconcileUnstartedAssignments(at('08:04'));
    expect(result).toEqual({ reminded: 0, markedAbsent: 0 });
    expect(service.notificationsService.create).not.toHaveBeenCalled();
  });

  it(`sau ${CHECK_IN_REMINDER_AFTER_MINUTES} phút thì nhắc check-in, có rung`, async () => {
    const { service } = build([assignment()]);
    const result = await service.reconcileUnstartedAssignments(at('08:05'));
    expect(result.reminded).toBe(1);
    expect(service.notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Bạn chưa check-in',
        actionUrl: '/check-in-flow',
        metadata: expect.objectContaining({
          type: 'CHECK_IN_REMINDER',
          assignmentId: 'a1',
        }),
      }),
      expect.objectContaining({ channelId: 'shift-alerts' }),
    );
  });

  it('đã nhắc rồi thì không nhắc lại', async () => {
    const { service } = build([assignment()], { reminded: true });
    const result = await service.reconcileUnstartedAssignments(at('09:00'));
    expect(result.reminded).toBe(0);
    expect(service.notificationsService.create).not.toHaveBeenCalled();
  });

  it('nhân viên tắt "Nhắc nếu chưa Checkin" thì không nhắc', async () => {
    const { service } = build([
      assignment({
        employee: {
          accountId: 'acc-1',
          reminderSettings: { remindIfNotCheckIn: false },
        },
      }),
    ]);
    await service.reconcileUnstartedAssignments(at('09:00'));
    expect(service.notificationsService.create).not.toHaveBeenCalled();
  });

  it('qua giờ kết thúc ca thì ghi nghỉ không phép ngay và báo nhân viên', async () => {
    const { service, updateBuilder } = build([assignment()]);
    const result = await service.reconcileUnstartedAssignments(at('12:00'));
    expect(result.markedAbsent).toBe(1);
    expect(updateBuilder.set).toHaveBeenCalledWith({
      attendanceStatus: AttendanceStatus.ABSENT,
    });
    // Chỉ ghi khi vẫn chưa check-in và chưa có trạng thái (chống ghi đè đồng thời).
    expect(updateBuilder.andWhere).toHaveBeenCalledWith(
      'check_in_time IS NULL',
    );
    expect(service.notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Nghỉ không phép',
        content: expect.stringContaining('(18/09)'),
        metadata: expect.objectContaining({
          type: 'SHIFT_ABSENT',
          workDates: ['2026-09-18'],
        }),
      }),
      expect.objectContaining({ channelId: 'shift-alerts', priority: 'high' }),
    );
  });

  it('ghi vắng thì xếp đúng một job tính lại phiếu lương; chạy lại không xếp thêm', async () => {
    const { service, updateBuilder } = build([assignment()]);
    await service.reconcileUnstartedAssignments(at('12:01'));
    expect(service.attendanceQueue.add).toHaveBeenCalledTimes(1);
    expect(service.attendanceQueue.add).toHaveBeenCalledWith(
      'recompute-employee-payslip',
      {
        employeeProfileId: 'p1',
        storeId: 's1',
        workDate: '2026-09-18',
        assignmentId: 'a1',
      },
      expect.objectContaining({ jobId: 'payslip-p1-2026-09-a1' }),
    );
    // Lần chạy sau: câu UPDATE có điều kiện không ghi thêm dòng nào.
    updateBuilder.execute.mockResolvedValue({ affected: 0 });
    const again = await service.reconcileUnstartedAssignments(at('12:02'));
    expect(again.markedAbsent).toBe(0);
    expect(service.attendanceQueue.add).toHaveBeenCalledTimes(1);
    expect(service.notificationsService.create).toHaveBeenCalledTimes(1);
  });

  it('truy vấn loại ca có nghỉ có phép (không nhắc, không ghi vắng, không quét lại)', async () => {
    const { service, listBuilder } = build([]);
    await service.reconcileUnstartedAssignments(at('08:30'));
    const clauses = listBuilder.andWhere.mock.calls.map(([sql]: any) => sql);
    const leaveClause = clauses.find((sql: string) =>
      sql.includes('employee_leave_requests'),
    );
    expect(leaveClause).toMatch(/^NOT EXISTS/);
    expect(leaveClause).toContain("elr.status = 'APPROVED'");
    // Chỉ các loại nghỉ cả ngày; xin đi trễ (LATE) không được tính là có phép.
    expect(leaveClause).toContain("'SICK'");
    expect(leaveClause).not.toContain("'LATE'");
  });

  it('ngày làm theo giờ VN kể cả khi server chạy UTC (00:30 VN)', async () => {
    const { service, listBuilder } = build([]);
    await service.reconcileUnstartedAssignments(
      new Date('2026-09-18T17:30:00Z'),
    );
    const datesCall = listBuilder.andWhere.mock.calls.find(([sql]: any) =>
      String(sql).includes('slot.workDate IN'),
    );
    expect(datesCall[1]).toEqual({ dates: ['2026-09-18', '2026-09-19'] });
  });

  it('ngày có đơn nghỉ phép đã duyệt thì không ghi nghỉ không phép', async () => {
    const { service, updateBuilder } = build([assignment()], { onLeave: true });
    // Đơn nghỉ được duyệt sau lúc quét: câu UPDATE có điều kiện không ghi dòng nào.
    updateBuilder.execute.mockResolvedValue({ affected: 0 });
    const result = await service.reconcileUnstartedAssignments(at('13:00'));
    expect(result.markedAbsent).toBe(0);
    expect(service.attendanceQueue.add).not.toHaveBeenCalled();
    expect(service.notificationsService.create).not.toHaveBeenCalled();
  });

  it('kiểm tra nghỉ có phép nằm trong chính câu UPDATE ghi vắng (nguyên tử)', async () => {
    const { service, updateBuilder } = build([assignment()]);
    await service.reconcileUnstartedAssignments(at('12:30'));
    const leaveCall = updateBuilder.andWhere.mock.calls.find(([sql]: any) =>
      String(sql).includes('employee_leave_requests'),
    );
    expect(leaveCall).toBeDefined();
    const [sql, params] = leaveCall;
    expect(sql).toMatch(/^NOT EXISTS/);
    expect(sql).toContain('elr.employee_profile_id = shift_assignments.employee_id');
    expect(sql).toContain('elr.shift_assignment_id = shift_assignments.id');
    expect(sql).toContain('CAST(:absentWorkDate AS date)');
    expect(params).toEqual({ absentWorkDate: '2026-09-18' });
    // Không còn bước kiểm tra riêng trước khi ghi.
    expect(service.dataSource.query).not.toHaveBeenCalledWith(
      expect.stringContaining('employee_leave_requests'),
      expect.anything(),
    );
  });

  it('ca qua đêm hôm qua kết thúc sáng nay cũng được xử lý', async () => {
    const { service } = build([
      assignment({
        shiftSlot: {
          workDate: '2026-09-17',
          startTime: '22:00',
          endTime: '06:00',
          workShift: {},
          cycle: { storeId: 's1' },
        },
      }),
    ]);
    expect(
      (await service.reconcileUnstartedAssignments(at('05:00'))).markedAbsent,
    ).toBe(0);
    expect(
      (await service.reconcileUnstartedAssignments(at('06:00'))).markedAbsent,
    ).toBe(1);
  });
});

describe('kênh push theo cài đặt rung', () => {
  it('mặc định rung; tắt rung thì kênh im lặng', () => {
    expect(shiftAlertChannel(null)).toBe('shift-alerts');
    expect(shiftAlertChannel({ vibrate: true })).toBe('shift-alerts');
    expect(shiftAlertChannel({ vibrate: false })).toBe('shift-alerts-quiet');
  });
});
