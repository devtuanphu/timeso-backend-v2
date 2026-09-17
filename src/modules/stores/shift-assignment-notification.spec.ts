import { StoresService } from './stores.service';
import { buildShiftNotification } from './shift-assignment-notification';
import { NotificationType } from '../notifications/entities/notification.entity';

describe('buildShiftNotification', () => {
  const shift = (workDate: string, over = {}) => ({
    workDate,
    startTime: '08:00:00',
    endTime: '12:00:00',
    shiftName: 'Ca sáng',
    ...over,
  });

  it('một ca chủ xếp: nêu tên ca, ngày và giờ', () => {
    expect(buildShiftNotification('assigned', [shift('2026-09-16')])).toEqual({
      title: 'Bạn có ca làm mới',
      content: 'Chủ cửa hàng đã xếp cho bạn Ca sáng ngày 16/09 (08:00–12:00).',
    });
  });

  it('một ca được duyệt', () => {
    expect(buildShiftNotification('approved', [shift('2026-09-16')])).toEqual({
      title: 'Ca đăng ký đã được duyệt',
      content: 'Ca sáng ngày 16/09 (08:00–12:00) bạn đăng ký đã được duyệt.',
    });
  });

  // Lịch lặp sinh nhiều ca: gộp thành một câu, khoảng ngày theo thứ tự thật.
  it('nhiều ca: đếm số ca và nêu khoảng ngày, bất kể thứ tự đầu vào', () => {
    const result = buildShiftNotification('assigned', [
      shift('2026-09-20'),
      shift('2026-09-14'),
      shift('2026-09-17'),
    ]);
    expect(result.content).toBe(
      'Chủ cửa hàng đã xếp cho bạn 3 ca, từ 14/09 đến 20/09.',
    );
  });

  it('nhiều ca trong cùng một ngày', () => {
    const result = buildShiftNotification('approved', [
      shift('2026-09-16'),
      shift('2026-09-16', {
        startTime: '13:00',
        endTime: '17:00',
        shiftName: 'Ca chiều',
      }),
    ]);
    expect(result.content).toBe('2 ca bạn đăng ký ngày 16/09 đã được duyệt.');
  });

  it('thiếu tên ca và giờ vẫn ra câu đọc được', () => {
    expect(
      buildShiftNotification('assigned', [{ workDate: '2026-09-16' }]).content,
    ).toBe('Chủ cửa hàng đã xếp cho bạn Ca làm ngày 16/09.');
  });
});

describe('StoresService.notifyEmployeesOfNewShifts', () => {
  const assignment = (
    id: string,
    accountId: string | null,
    workDate: string,
  ) => ({
    id,
    employee: accountId ? { accountId } : null,
    shiftSlot: {
      workDate,
      startTime: '08:00',
      endTime: '12:00',
      workShift: { shiftName: 'Ca sáng' },
      cycle: { storeId: 'store-1' },
    },
  });

  const build = (rows: unknown[]) => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = { warn: jest.fn() };
    service.shiftAssignmentRepository = {
      find: jest.fn().mockResolvedValue(rows),
    };
    service.notificationsService = { create: jest.fn().mockResolvedValue({}) };
    return service;
  };

  // Tạo lịch lặp cho hai người sinh nhiều assignment; mỗi người một thông báo.
  it('gom theo nhân viên: mỗi người đúng một thông báo', async () => {
    const service = build([
      assignment('a1', 'acc-1', '2026-09-14'),
      assignment('a2', 'acc-1', '2026-09-15'),
      assignment('a3', 'acc-2', '2026-09-14'),
    ]);

    await service.notifyEmployeesOfNewShifts(['a1', 'a2', 'a3'], 'assigned');

    expect(service.notificationsService.create).toHaveBeenCalledTimes(2);
    expect(service.notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        storeId: 'store-1',
        type: NotificationType.SCHEDULE_CONFIRMATION,
        actionUrl: '/(home)/workshift',
        metadata: expect.objectContaining({
          type: 'SHIFT_ASSIGNED',
          assignmentIds: ['a1', 'a2'],
        }),
      }),
    );
  });

  it('duyệt ca dùng loại "Duyệt ca"', async () => {
    const service = build([assignment('a1', 'acc-1', '2026-09-14')]);
    await service.notifyEmployeesOfNewShifts(['a1'], 'approved');
    expect(service.notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: NotificationType.SHIFT_APPROVAL }),
    );
  });

  // Best effort: lỗi gửi cho một người không được chặn người khác, cũng không
  // được ném ra làm hỏng việc xếp ca đã commit.
  it('lỗi với một người không chặn người khác và không ném lỗi', async () => {
    const service = build([
      assignment('a1', 'acc-1', '2026-09-14'),
      assignment('a2', 'acc-2', '2026-09-14'),
    ]);
    service.notificationsService.create
      .mockRejectedValueOnce(new Error('push lỗi'))
      .mockResolvedValueOnce({});

    await expect(
      service.notifyEmployeesOfNewShifts(['a1', 'a2'], 'assigned'),
    ).resolves.toBeUndefined();
    expect(service.notificationsService.create).toHaveBeenCalledTimes(2);
    expect(service.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('không tải được assignment thì bỏ qua, không ném lỗi', async () => {
    const service = build([]);
    service.shiftAssignmentRepository.find.mockRejectedValue(
      new Error('db lỗi'),
    );
    await expect(
      service.notifyEmployeesOfNewShifts(['a1'], 'assigned'),
    ).resolves.toBeUndefined();
    expect(service.notificationsService.create).not.toHaveBeenCalled();
  });

  it('bỏ qua hồ sơ chưa gắn tài khoản và danh sách rỗng', async () => {
    const service = build([assignment('a1', null, '2026-09-14')]);
    await service.notifyEmployeesOfNewShifts(['a1'], 'assigned');
    await service.notifyEmployeesOfNewShifts([], 'assigned');
    expect(service.notificationsService.create).not.toHaveBeenCalled();
    expect(service.shiftAssignmentRepository.find).toHaveBeenCalledTimes(1);
  });
});

describe('các chỗ chủ xếp/duyệt ca gọi thông báo', () => {
  it('duyệt yêu cầu đăng ký ca báo cho nhân viên', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = { warn: jest.fn(), error: jest.fn() };
    service.notifyEmployeesOfNewShifts = jest.fn().mockResolvedValue(undefined);
    service.scheduleReminderForAssignment = jest
      .fn()
      .mockResolvedValue(undefined);
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue(undefined);
    service.shiftAssignmentRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'a1',
        status: 'PENDING',
        shiftSlot: { cycle: { storeId: 'store-1' } },
      }),
    };
    service.dataSource = {
      transaction: jest.fn(async (cb: any) =>
        cb({
          query: jest.fn(),
          findOne: jest
            .fn()
            .mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
          update: jest.fn().mockResolvedValue({ affected: 1 }),
        }),
      ),
    };

    await service.processRequest('owner-1', 'a1', 'REGISTER', 'APPROVED');
    expect(service.notifyEmployeesOfNewShifts).toHaveBeenCalledWith(
      ['a1'],
      'approved',
    );
  });

  it('từ chối yêu cầu đăng ký thì không báo "đã duyệt"', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = { warn: jest.fn(), error: jest.fn() };
    service.notifyEmployeesOfNewShifts = jest.fn();
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue(undefined);
    service.shiftAssignmentRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'a1',
        status: 'PENDING',
        shiftSlot: { cycle: { storeId: 'store-1' } },
      }),
    };
    service.dataSource = {
      transaction: jest.fn(async (cb: any) =>
        cb({
          query: jest.fn(),
          findOne: jest
            .fn()
            .mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
          update: jest.fn().mockResolvedValue({ affected: 1 }),
        }),
      ),
    };

    await service.processRequest('owner-1', 'a1', 'REGISTER', 'REJECTED');
    expect(service.notifyEmployeesOfNewShifts).not.toHaveBeenCalled();
  });
});
