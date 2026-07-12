import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  it('đưa metadata điều hướng vào payload push', async () => {
    const repository: any = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'notification-1', ...value })),
    };
    const devicesService: any = {
      getActiveDevicesByUser: jest.fn().mockResolvedValue([
        { expoPushToken: 'ExponentPushToken[test]' },
      ]),
    };
    const expoPushService: any = { sendToMultiple: jest.fn().mockResolvedValue(undefined) };
    const service = new NotificationsService(
      repository,
      {} as any,
      devicesService,
      expoPushService,
    );

    await service.create({
      accountId: 'account-1',
      title: 'Kết thúc ca',
      content: 'Chọn thao tác',
      type: 'Nhắc chấm công ra' as any,
      actionUrl: '/check-in-flow',
      metadata: {
        type: 'SHIFT_END_ACTION_REQUIRED',
        assignmentId: 'assignment-1',
        shiftSlotId: 'slot-1',
      },
    });

    expect(expoPushService.sendToMultiple).toHaveBeenCalledWith(
      ['ExponentPushToken[test]'],
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'SHIFT_END_ACTION_REQUIRED',
          assignmentId: 'assignment-1',
          shiftSlotId: 'slot-1',
          notificationId: 'notification-1',
          notificationType: 'Nhắc chấm công ra',
        }),
      }),
    );
  });
});
