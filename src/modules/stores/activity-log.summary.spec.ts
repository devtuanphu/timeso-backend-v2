import {
  ACTIVITY_ACTIONS,
  renderActivitySummary,
  sanitizeActivityParams,
} from './activity-log.summary';

describe('sanitizeActivityParams', () => {
  it('keeps only allow-listed, well-formed display fields', () => {
    expect(
      sanitizeActivityParams({
        shiftName: 'Sáng',
        startTime: '08:00',
        endTime: '8h',
        workDate: '2026-09-21',
        lateMinutes: 5,
        count: -1,
        // Never stored:
        amount: 500000,
        requestedAmount: 1,
        netSalary: 7000000,
        latitude: 10.1,
        longitude: 106.2,
        faceMatchScore: 0.2,
        faceDescriptor: [0.1],
        reason: 'ốm',
        note: 'x',
        phone: '0900000000',
        documentNumber: '0790',
      }),
    ).toEqual({
      shiftName: 'Sáng',
      startTime: '08:00',
      workDate: '2026-09-21',
      lateMinutes: 5,
    });
  });

  it('handles null and non-object input', () => {
    expect(sanitizeActivityParams(null)).toEqual({});
    expect(sanitizeActivityParams(undefined)).toEqual({});
  });
});

describe('renderActivitySummary', () => {
  const A = ACTIVITY_ACTIONS;

  it('check-in with late minutes', () => {
    expect(
      renderActivitySummary({
        action: A.CHECK_IN,
        actorRole: 'staff',
        actorName: 'Nguyễn A',
        params: { shiftName: 'Sáng', startTime: '08:00', endTime: '12:00', lateMinutes: 5 },
      }),
    ).toBe('Nguyễn A check-in ca Sáng (08:00–12:00), trễ 5 phút');
  });

  it('check-out early', () => {
    expect(
      renderActivitySummary({
        action: A.CHECK_OUT,
        actorRole: 'staff',
        actorName: 'Nguyễn A',
        params: { shiftName: 'Sáng', checkOutAt: '11:50', earlyMinutes: 10 },
      }),
    ).toBe('Nguyễn A check-out ca Sáng lúc 11:50, về sớm 10 phút');
  });

  it.each([
    [A.LEAVE_REQUEST_CREATED, { leaveType: 'LATE', fromDate: '2026-09-22', toDate: '2026-09-22' }, 'Nguyễn A gửi đơn xin đi trễ ngày 22/09'],
    [A.LEAVE_REQUEST_CREATED, { leaveType: 'EARLY', fromDate: '2026-09-22' }, 'Nguyễn A gửi đơn xin về sớm ngày 22/09'],
    [A.LEAVE_REQUEST_CREATED, { leaveType: 'SICK', fromDate: '2026-09-22', toDate: '2026-09-24' }, 'Nguyễn A gửi đơn xin nghỉ từ 22/09 đến 24/09'],
    [A.SHIFT_REGISTRATION_UPCOMING_CANCELLED, { count: 3 }, 'Nguyễn A huỷ 3 ca đã đăng ký sắp tới'],
    [A.SHIFT_REGISTRATION_BATCH_CREATED, { count: 4, shiftName: 'Tối', fromDate: '2026-10-01', toDate: '2026-10-31' }, 'Nguyễn A đăng ký 4 ca Tối từ 01/10 đến 31/10'],
    [A.SALARY_ADVANCE_CREATED, { month: '2026-09' }, 'Nguyễn A gửi yêu cầu ứng lương tháng 09/2026'],
    [A.SHIFT_CHANGE_REQUEST_CANCELLED, { requestDate: '2026-09-25' }, 'Nguyễn A huỷ yêu cầu đổi ca ngày 25/09'],
  ])('staff action %s', (action, params, expected) => {
    expect(
      renderActivitySummary({ action, actorRole: 'staff', actorName: 'Nguyễn A', params }),
    ).toBe(expected);
  });

  it.each([
    [A.SHIFT_REGISTRATION_CREATED, { byOwner: true, shiftName: 'Tối', workDate: '2026-09-21' }, 'Chủ A xếp Minh vào ca Tối ngày 21/09'],
    [A.PAYSLIP_PAID, { month: '2026-09' }, 'Chủ A thanh toán lương tháng 09/2026 cho Minh'],
    [A.SALARY_ADJUSTMENT_CREATED, { direction: 'increase', month: '2026-10' }, 'Chủ A tăng lương cho Minh, hiệu lực tháng 10/2026'],
    [A.EMPLOYEE_ADDED, { source: 'application' }, 'Chủ A nhận Minh vào làm từ đơn ứng tuyển'],
    [A.EMPLOYEE_ADDED, { source: 'manual' }, 'Chủ A thêm Minh vào cửa hàng'],
    [A.EMPLOYEE_REHIRED, { mode: 'restore' }, 'Chủ A khôi phục Minh vào cửa hàng'],
    [A.EMPLOYEE_REMOVED, {}, 'Chủ A cho Minh thôi việc'],
    [A.ASSET_ASSIGNED, { assetName: 'Áo', quantity: 2 }, 'Chủ A cấp 2 Áo cho Minh'],
    [A.ASSET_RETURNED, { assetName: 'Áo', assetStatus: 'LOST' }, 'Chủ A ghi nhận mất Áo của Minh'],
    [A.CAREER_ADVANCED, { ladderName: 'Vị trí', rungName: 'Trưởng ca' }, 'Chủ A chuyển Minh lên bậc Trưởng ca (lộ trình Vị trí)'],
    [A.WORK_SHIFT_DELETED, { shiftName: 'Sáng', startTime: '08:00', endTime: '12:00', count: 2 }, 'Chủ A xoá ca Sáng (08:00–12:00)'],
  ])('owner action %s', (action, params, expected) => {
    expect(
      renderActivitySummary({
        action,
        actorRole: 'owner',
        actorName: 'Chủ A',
        subjectName: 'Minh',
        params,
      }),
    ).toBe(expected);
  });

  it('falls back on missing names and unknown actions', () => {
    expect(
      renderActivitySummary({ action: A.CAREER_ADVANCED, actorRole: 'system' }),
    ).toBe('Hệ thống chuyển nhân viên lên bậc mới');
    expect(
      renderActivitySummary({ action: 'future.thing', actorRole: 'owner' }),
    ).toBe('Chủ cửa hàng thực hiện một thao tác');
  });
});
