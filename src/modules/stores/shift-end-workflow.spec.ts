import { ShiftEndWorkflowService } from './shift-end-workflow.service';
import { BonusWorkRequestStatus } from './entities/bonus-work-request.entity';
import { ShiftEndWorkflowState } from './entities/shift-end-workflow.entity';
import { ShiftAssignmentStatus } from './entities/shift-management.entity';

describe('ShiftEndWorkflowService', () => {
  const workflow = {
    id: 'workflow-1',
    shiftAssignmentId: 'assignment-1',
    effectiveEndAt: new Date('2026-07-12T10:00:00.000Z'),
    state: ShiftEndWorkflowState.ACTIVE,
  } as any;
  const assignment = {
    id: 'assignment-1',
    shiftSlotId: 'slot-1',
    employeeId: 'employee-1',
    checkInTime: new Date('2026-07-12T01:00:00.000Z'),
    checkOutTime: null,
    status: ShiftAssignmentStatus.CONFIRMED,
    shiftSlot: { workDate: '2026-07-12', cycle: { storeId: 'store-1' } },
    employee: { accountId: 'account-1' },
  } as any;

  function createService(options?: { overtimeStatus?: BonusWorkRequestStatus }) {
    let markerWasSet = false;
    const queryBuilder: any = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn(async () => {
        if (markerWasSet) return { affected: 0 };
        markerWasSet = true;
        return { affected: 1 };
      }),
    };
    const workflowRepository: any = {
      findOne: jest.fn().mockResolvedValue({ ...workflow }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    const assignmentRepository: any = {
      findOne: jest.fn().mockResolvedValue({ ...assignment }),
    };
    const bonusWorkRepository: any = {
      findOne: jest.fn().mockResolvedValue(
        options?.overtimeStatus
          ? { id: 'overtime-1', status: options.overtimeStatus }
          : null,
      ),
    };
    const notificationsService: any = { create: jest.fn().mockResolvedValue({}) };
    const service = new ShiftEndWorkflowService(
      workflowRepository,
      assignmentRepository,
      bonusWorkRepository,
      {} as any,
      {} as any,
      {} as any,
      notificationsService,
      { add: jest.fn() } as any,
      { add: jest.fn() } as any,
    );
    return { service, workflowRepository, notificationsService };
  }

  it('tính đúng giờ kết thúc cho ca thường và ca qua đêm', () => {
    const { service } = createService();
    expect(service.calculateScheduledEnd('2026-07-12', '08:00:00', '17:00:00').toISOString())
      .toBe('2026-07-12T10:00:00.000Z');
    expect(service.calculateScheduledEnd('2026-07-12', '22:00:00', '06:00:00').toISOString())
      .toBe('2026-07-12T23:00:00.000Z');
  });

  it('chỉ gửi một thông báo khi hai worker xử lý cùng reminder', async () => {
    const { service, notificationsService } = createService();
    const data = {
      assignmentId: 'assignment-1',
      expectedEndAt: workflow.effectiveEndAt.toISOString(),
      reminderMinute: 0 as const,
    };
    await Promise.all([service.handleReminderJob(data), service.handleReminderJob(data)]);
    expect(notificationsService.create).toHaveBeenCalledTimes(1);
  });

  it('tạm dừng reminder và auto-checkout khi đơn tăng ca đang chờ duyệt', async () => {
    const { service, workflowRepository, notificationsService } = createService({
      overtimeStatus: BonusWorkRequestStatus.PENDING,
    });
    const autoCheckout = jest.spyOn(service, 'autoCheckout');
    await service.handleReminderJob({
      assignmentId: 'assignment-1',
      expectedEndAt: workflow.effectiveEndAt.toISOString(),
      reminderMinute: 15,
    });
    expect(workflowRepository.update).toHaveBeenCalledWith('workflow-1', {
      state: ShiftEndWorkflowState.OVERTIME_PENDING,
      overtimeRequestId: 'overtime-1',
    });
    expect(autoCheckout).not.toHaveBeenCalled();
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('gọi auto-checkout đúng mốc 15 phút', async () => {
    const { service } = createService();
    const autoCheckout = jest.spyOn(service, 'autoCheckout').mockResolvedValue(true);
    await service.handleReminderJob({
      assignmentId: 'assignment-1',
      expectedEndAt: workflow.effectiveEndAt.toISOString(),
      reminderMinute: 15,
    });
    expect(autoCheckout).toHaveBeenCalledWith('assignment-1', workflow.effectiveEndAt);
  });
});
