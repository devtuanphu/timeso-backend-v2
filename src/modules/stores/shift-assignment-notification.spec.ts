import { StoresService } from './stores.service';
import {
  buildShiftNotification,
  shiftNotificationDateMetadata,
} from './shift-assignment-notification';
import { NotificationType } from '../notifications/entities/notification.entity';

// Mốc "bây giờ" xa các ngày trong test để nội dung giữ dạng dd/mm.
const FAR = new Date('2026-01-01T03:00:00Z');

describe('buildShiftNotification', () => {
  const shift = (workDate: string, over = {}) => ({
    workDate,
    startTime: '08:00:00',
    endTime: '12:00:00',
    shiftName: 'Ca sáng',
    ...over,
  });

  it('một ca chủ xếp: nêu tên ca, ngày và giờ', () => {
    expect(
      buildShiftNotification('assigned', [shift('2026-09-16')], FAR),
    ).toEqual({
      title: 'Bạn có ca làm mới',
      content: 'Chủ cửa hàng đã xếp cho bạn Ca sáng ngày 16/09 (08:00–12:00).',
    });
  });

  it('một ca được duyệt', () => {
    expect(
      buildShiftNotification('approved', [shift('2026-09-16')], FAR),
    ).toEqual({
      title: 'Đăng ký ca thành công · ngày 16/09',
      content: 'Ca 08:00-12:00 đã được đăng ký thành công',
    });
  });

  // Lịch lặp sinh nhiều ca: gộp thành một câu, khoảng ngày theo thứ tự thật.
  it('nhiều ca: đếm số ca và nêu khoảng ngày, bất kể thứ tự đầu vào', () => {
    const result = buildShiftNotification(
      'assigned',
      [shift('2026-09-20'), shift('2026-09-14'), shift('2026-09-17')],
      FAR,
    );
    expect(result.content).toBe(
      'Chủ cửa hàng đã xếp cho bạn 3 ca, từ 14/09 đến 20/09.',
    );
  });

  it('nhiều ca trong cùng một ngày', () => {
    const result = buildShiftNotification(
      'approved',
      [
        shift('2026-09-16'),
        shift('2026-09-16', {
          startTime: '13:00',
          endTime: '17:00',
          shiftName: 'Ca chiều',
        }),
      ],
      FAR,
    );
    expect(result.content).toBe('2 ca ngày 16/09 đã được đăng ký thành công');
  });

  // Câu chủ cửa hàng yêu cầu: "Ca 19:00-24:00 đã được đăng ký thành công".
  it('ca kết thúc lúc nửa đêm ghi 24:00', () => {
    expect(
      buildShiftNotification(
        'approved',
        [shift('2026-09-19', { startTime: '19:00:00', endTime: '00:00:00' })],
        FAR,
      ).content,
    ).toBe('Ca 19:00-24:00 đã được đăng ký thành công');
  });

  it('thiếu tên ca và giờ vẫn ra câu đọc được', () => {
    expect(
      buildShiftNotification('assigned', [{ workDate: '2026-09-16' }], FAR)
        .content,
    ).toBe('Chủ cửa hàng đã xếp cho bạn Ca làm ngày 16/09.');
  });
});

describe('StoresService.notifyEmployeesOfNewShifts', () => {
  const assignment = (
    id: string,
    accountId: string | null,
    workDate: string,
    reminderSettings: unknown = null,
  ) => ({
    id,
    employee: accountId ? { accountId, reminderSettings } : null,
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

  // Công tắc ở màn Nhắc tôi chỉ nói về ca chủ mới mở để đăng ký; ca chủ xếp
  // cho chính nhân viên thì luôn báo.
  it('tắt công tắc ca mới vẫn nhận ca chủ xếp cho mình', async () => {
    const service = build([
      assignment('a1', 'acc-off', '2026-09-14', { notifyNewShifts: false }),
    ]);
    await service.notifyEmployeesOfNewShifts(['a1'], 'assigned');
    expect(service.notificationsService.create).toHaveBeenCalledTimes(1);
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

describe('thông báo ca kèm "hôm nay / ngày mai / ngày kia"', () => {
  const now = new Date('2026-09-18T03:00:00Z'); // 10:00 ngày 18/09 giờ VN
  const shift = (workDate: string) => ({
    workDate,
    startTime: '08:00',
    endTime: '12:00',
    shiftName: 'Ca sáng',
  });

  it('ca hôm nay', () => {
    expect(
      buildShiftNotification('assigned', [shift('2026-09-18')], now).content,
    ).toBe(
      'Chủ cửa hàng đã xếp cho bạn Ca sáng hôm nay (18/09) (08:00–12:00).',
    );
  });

  it('đăng ký ca thành công cho ngày mai', () => {
    expect(
      buildShiftNotification('approved', [shift('2026-09-19')], now).title,
    ).toBe('Đăng ký ca thành công · ngày mai (19/09)');
  });

  it('khoảng ngày có hôm nay thì ghi "(có hôm nay)" (Q8.2)', () => {
    expect(
      buildShiftNotification(
        'assigned',
        [shift('2026-09-18'), shift('2026-09-20')],
        now,
      ).content,
    ).toBe('Chủ cửa hàng đã xếp cho bạn 2 ca, từ 18/09 đến 20/09 (có hôm nay).');
  });

  it('cùng dd/mm khác năm không bị gộp thành một ngày', () => {
    expect(
      buildShiftNotification(
        'assigned',
        [shift('2026-12-31'), shift('2027-12-31')],
        now,
      ).content,
    ).toMatch(/^Chủ cửa hàng đã xếp cho bạn 2 ca, từ 31\/12 đến 31\/12/);
  });

  it('metadata ngày làm để danh sách tính lại theo lúc đọc', () => {
    expect(
      shiftNotificationDateMetadata([shift('2026-09-20'), shift('2026-09-18')]),
    ).toEqual({ workDates: ['2026-09-18', '2026-09-20'] });
  });

  it('ca mới chủ vừa mở để đăng ký', () => {
    expect(
      buildShiftNotification('created', [shift('2026-09-19')], now),
    ).toEqual({
      title: 'Có ca mới để đăng ký',
      content:
        'Cửa hàng vừa mở Ca sáng ngày mai (19/09) (08:00–12:00). Vào đăng ký ngay nhé!',
    });
  });
});

describe('StoresService.notifyEmployeesOfCreatedShifts — chủ mở ca mới để đăng ký', () => {
  const build = (profiles: unknown[]) => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = { warn: jest.fn() };
    service.profileRepository = { find: jest.fn().mockResolvedValue(profiles) };
    service.notificationsService = { create: jest.fn().mockResolvedValue({}) };
    return service;
  };
  const open = [
    {
      workDate: '2026-09-25',
      startTime: '08:00',
      endTime: '12:00',
      shiftName: 'Ca sáng',
    },
  ];

  it('báo cho nhân viên đang bật công tắc, bỏ qua người đã tắt', async () => {
    const service = build([
      { id: 'p1', accountId: 'acc-on', reminderSettings: null },
      {
        id: 'p2',
        accountId: 'acc-off',
        reminderSettings: { notifyNewShifts: false },
      },
      { id: 'p3', accountId: null, reminderSettings: null },
    ]);

    await service.notifyEmployeesOfCreatedShifts('store-1', open);

    expect(service.notificationsService.create).toHaveBeenCalledTimes(1);
    expect(service.notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-on',
        storeId: 'store-1',
        title: 'Có ca mới để đăng ký',
        actionUrl: '/(home)/workshift',
        metadata: {
          type: 'SHIFT_CREATED',
          storeId: 'store-1',
          workDates: ['2026-09-25'],
        },
      }),
    );
  });

  it('lịch không còn chỗ trống thì không báo ai', async () => {
    const service = build([
      { id: 'p1', accountId: 'acc-on', reminderSettings: null },
    ]);
    await service.notifyEmployeesOfCreatedShifts('store-1', []);
    expect(service.profileRepository.find).not.toHaveBeenCalled();
    expect(service.notificationsService.create).not.toHaveBeenCalled();
  });

  it('lỗi không ném ra ngoài', async () => {
    const service = build([]);
    service.profileRepository.find.mockRejectedValue(new Error('db'));
    await expect(
      service.notifyEmployeesOfCreatedShifts('store-1', open),
    ).resolves.toBeUndefined();
  });
});
