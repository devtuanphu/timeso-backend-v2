import { StoresService } from './stores.service';
import { LeaveType } from './entities/employee-leave-request.entity';

/** Đơn nghỉ cả ngày được duyệt: huỷ nhắc vào ca cho các ca trong khoảng nghỉ. */
describe('StoresService.cancelRemindersCoveredByLeave', () => {
  const build = (rows: Array<{ id: string }>) => {
    const service = Object.create(StoresService.prototype) as any;
    const qb: any = {};
    for (const method of ['innerJoin', 'select', 'where', 'andWhere', 'limit']) {
      qb[method] = jest.fn(() => qb);
    }
    qb.getRawMany = jest.fn().mockResolvedValue(rows);
    service.shiftAssignmentRepository = {
      createQueryBuilder: jest.fn(() => qb),
    };
    service.shiftReminderService = {
      cancelAssignmentReminders: jest.fn().mockResolvedValue({}),
    };
    return { service, qb };
  };

  const leave = {
    employeeProfileId: 'p1',
    type: LeaveType.SICK,
    startDate: '2099-01-01',
    endDate: '2099-01-03',
    startTime: null,
    endTime: null,
    shiftAssignmentId: null,
  };

  it('huỷ nhắc các ca APPROVED trong khoảng nghỉ', async () => {
    const { service, qb } = build([{ id: 'a1' }, { id: 'a2' }]);
    await service.cancelRemindersCoveredByLeave(leave);
    expect(qb.andWhere).toHaveBeenCalledWith('slot.workDate >= :from', {
      from: '2099-01-01',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('slot.workDate <= :to', {
      to: '2099-01-03',
    });
    expect(qb.limit).toHaveBeenCalledWith(500);
    expect(
      service.shiftReminderService.cancelAssignmentReminders,
    ).toHaveBeenCalledWith(['a1', 'a2']);
  });

  it('xin đi trễ (LATE) không phải nghỉ có phép: không huỷ nhắc', async () => {
    const { service } = build([{ id: 'a1' }]);
    await service.cancelRemindersCoveredByLeave({
      ...leave,
      type: LeaveType.LATE,
    });
    expect(
      service.shiftReminderService.cancelAssignmentReminders,
    ).not.toHaveBeenCalled();
  });

  it('đơn nghỉ theo giờ chỉ phủ đúng ca nó gắn', async () => {
    const { service, qb } = build([{ id: 'a9' }]);
    await service.cancelRemindersCoveredByLeave({
      ...leave,
      startTime: '08:00',
      endTime: '12:00',
      shiftAssignmentId: 'a9',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('sa.id = :assignmentId', {
      assignmentId: 'a9',
    });
    const noLink = build([{ id: 'a1' }]);
    await noLink.service.cancelRemindersCoveredByLeave({
      ...leave,
      startTime: '08:00',
      endTime: '12:00',
    });
    expect(
      noLink.service.shiftReminderService.cancelAssignmentReminders,
    ).not.toHaveBeenCalled();
  });
});
