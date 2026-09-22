import { StoresService } from './stores.service';
import { presentNotificationForRead } from '../notifications/notifications.service';

/**
 * The owner's "Nhân viên đăng ký ca" notification says "hôm nay / ngày mai"
 * at send time. Without the work date in its metadata the list could not
 * re-label it, so the next day it still said "hôm nay".
 */
describe('owner SHIFT_REGISTRATION notification dates (R5)', () => {
  afterEach(() => jest.useRealTimers());

  const build = (workDate: string | null) => {
    const service = Object.create(StoresService.prototype) as any;
    service.logger = { warn: jest.fn(), log: jest.fn() };
    service.storeRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'store-1', name: 'S', ownerAccountId: 'owner-1' }),
    };
    service.profileRepository = {
      findOne: jest.fn().mockResolvedValue({ account: { fullName: 'An' } }),
    };
    service.shiftSlotRepository = {
      findOne: jest.fn().mockResolvedValue({
        workDate,
        workShift: { shiftName: 'Ca sáng' },
      }),
    };
    service.notificationsService = { create: jest.fn().mockResolvedValue({}) };
    return service;
  };

  it('stores workDate/workDates and re-renders the label the next day', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-22T03:00:00Z')); // 10:00 VN 22/09
    const service = build('2026-09-23');
    await service.notifyOwnerOfShiftRegistration('store-1', 'emp-1', 'slot-1');
    const [payload] = service.notificationsService.create.mock.calls[0];
    expect(payload.content).toBe('An vừa đăng ký Ca sáng ngày mai (23/09).');
    expect(payload.metadata).toMatchObject({
      type: 'SHIFT_REGISTRATION',
      workDate: '2026-09-23',
      workDates: ['2026-09-23'],
    });
    const nextDay = presentNotificationForRead(
      payload,
      new Date('2026-09-23T03:00:00Z'),
    );
    expect(nextDay.content).toBe('An vừa đăng ký Ca sáng hôm nay (23/09).');
    const later = presentNotificationForRead(
      payload,
      new Date('2026-09-26T03:00:00Z'),
    );
    expect(later.content).toBe('An vừa đăng ký Ca sáng ngày 23/09.');
  });

  it('a slot without a work date gets no date metadata', async () => {
    const service = build(null);
    await service.notifyOwnerOfShiftRegistration('store-1', 'emp-1', 'slot-1');
    const [payload] = service.notificationsService.create.mock.calls[0];
    expect(payload.metadata.workDates).toBeUndefined();
    expect(payload.content).toBe('An vừa đăng ký Ca sáng.');
  });
});
