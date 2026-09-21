// stores.service kéo theo cấu hình upload dùng uuid bản ESM mà Jest không parse.
jest.mock('../../common/utils/multer-config', () => ({
  attendanceMulterConfig: {},
  multerConfig: {},
}));

import { StoresService } from './stores.service';

/**
 * Nút chuông ở lịch làm việc chỉ gửi { type }. Trước đây backend ghi đè cả cài
 * đặt, làm mất rung, nhắc chưa check-in và công tắc "ca mới được tạo".
 */
describe('cập nhật cài đặt nhắc ca gộp với cài đặt đang có', () => {
  const build = (current: unknown) => {
    const service = Object.create(StoresService.prototype) as any;
    const profile = { id: 'p1', storeId: 's1', reminderSettings: current };
    service.profileRepository = {
      findOne: jest.fn().mockResolvedValue(profile),
      save: jest.fn().mockResolvedValue(profile),
    };
    service.shiftAssignmentRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    service.shiftReminderService = { syncEmployeeReminders: jest.fn() };
    service.logger = { error: jest.fn() };
    return { service, profile };
  };

  it('tắt nhắc bằng nút chuông giữ nguyên các lựa chọn khác', async () => {
    const { service, profile } = build({
      type: '30m',
      vibrate: true,
      remindIfNotCheckIn: false,
      notifyNewShifts: false,
    });

    const result = await service.updateEmployeeReminderSettings('p1', {
      type: 'off',
    });

    expect(profile.reminderSettings).toEqual({
      type: 'off',
      vibrate: true,
      remindIfNotCheckIn: false,
      notifyNewShifts: false,
    });
    expect(result.reminderSettings).toEqual(profile.reminderSettings);
    // Lịch nhắc được tính lại theo cài đặt đã gộp.
    expect(
      service.shiftReminderService.syncEmployeeReminders,
    ).toHaveBeenCalledWith('p1', 's1', profile.reminderSettings, []);
  });

  it('chưa có cài đặt nào thì lưu đúng những gì gửi lên', async () => {
    const { service, profile } = build(null);
    await service.updateEmployeeReminderSettings('p1', { type: '15m' });
    expect(profile.reminderSettings).toEqual({ type: '15m' });
  });

  // B9: released staff builds pick "Nhắc cố định" by sending `fixedTime`
  // with `custom: undefined`, which JSON drops, so the old relative offset
  // survived the merge and kept winning over the fixed time.
  it('clears a stale relative offset when a fixed time arrives without custom', async () => {
    const { service, profile } = build({
      type: 'custom',
      custom: { days: 0, hours: 2, minutes: 0 },
      vibrate: true,
    });
    await service.updateEmployeeReminderSettings('p1', {
      type: 'custom',
      fixedTime: '2024-02-01T05:00:00.000Z',
    });
    expect(profile.reminderSettings).toEqual({
      type: 'custom',
      custom: null,
      fixedTime: '2024-02-01T05:00:00.000Z',
      vibrate: true,
    });
  });

  it('keeps an explicit custom offset sent together with a fixed time', async () => {
    const { service, profile } = build({ type: '15m' });
    await service.updateEmployeeReminderSettings('p1', {
      type: 'custom',
      custom: { days: 0, hours: 1, minutes: 0 },
      fixedTime: '2024-02-01T05:00:00.000Z',
    });
    expect((profile.reminderSettings as any).custom).toEqual({ days: 0, hours: 1, minutes: 0 });
  });
});
