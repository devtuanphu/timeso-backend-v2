import {
  NotificationsService,
  presentNotificationForRead,
} from './notifications.service';

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

describe('NotificationsService read-time relative days', () => {
  const build = (rows: any[]) => {
    const qb: any = {};
    for (const method of ['where', 'andWhere', 'skip', 'take', 'orderBy']) {
      qb[method] = jest.fn(() => qb);
    }
    qb.getManyAndCount = jest.fn().mockResolvedValue([rows, rows.length]);
    const repository: any = {
      createQueryBuilder: jest.fn(() => qb),
      find: jest.fn().mockResolvedValue(rows),
    };
    return new NotificationsService(repository, {} as any, {} as any, {} as any);
  };

  beforeAll(() => {
    // 08:00 on 21/09 in Vietnam.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-21T01:00:00Z'));
  });
  afterAll(() => jest.useRealTimers());

  const dated = {
    id: 'n1',
    title: 'Nhắc nhở ca làm việc',
    content: 'Ca làm của bạn sẽ bắt đầu lúc 08:00 ngày mai (21/09).',
    metadata: { type: 'shift_reminder', workDates: ['2026-09-21'] },
  };
  const legacy = {
    id: 'n2',
    title: 'Nhắc nhở ca làm việc',
    content: 'Ca làm của bạn sẽ bắt đầu lúc 08:00 ngày mai.',
    metadata: { type: 'shift_reminder' },
  };

  it('findAll re-renders rows with work dates and leaves others untouched', async () => {
    const service = build([dated, legacy]);
    const result = await service.findAll('acc-1', {});
    expect(result.data[0].content).toBe(
      'Ca làm của bạn sẽ bắt đầu lúc 08:00 hôm nay (21/09).',
    );
    expect(result.data[1]).toBe(legacy);
    // The stored row object is not mutated.
    expect(dated.content).toContain('ngày mai (21/09)');
  });

  it('getByAccountId (summary) applies the same transform', async () => {
    const service = build([dated]);
    const [row] = await service.getByAccountId('acc-1');
    expect(row.content).toContain('hôm nay (21/09)');
  });
});

describe('NotificationsService push channel fallback', () => {
  it('sends shift-alerts only to builds that created the channel', async () => {
    const repository: any = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'n1', ...value })),
    };
    const devicesService: any = {
      getActiveDevicesByUser: jest.fn().mockResolvedValue([
        {
          expoPushToken: 'ExponentPushToken[new]',
          pushCapabilities: ['shift-alert-channels'],
        },
        { expoPushToken: 'ExponentPushToken[old]', pushCapabilities: null },
      ]),
    };
    const expoPushService: any = {
      sendToMultiple: jest.fn().mockResolvedValue(undefined),
    };
    const service = new NotificationsService(
      repository,
      {} as any,
      devicesService,
      expoPushService,
    );

    await service.create(
      { accountId: 'acc-1', title: 't', content: 'c' },
      { channelId: 'shift-alerts', priority: 'high' },
    );

    expect(expoPushService.sendToMultiple).toHaveBeenCalledWith(
      ['ExponentPushToken[new]'],
      expect.objectContaining({ channelId: 'shift-alerts', priority: 'high' }),
    );
    expect(expoPushService.sendToMultiple).toHaveBeenCalledWith(
      ['ExponentPushToken[old]'],
      expect.objectContaining({ channelId: 'default', priority: 'high' }),
    );
  });
});

describe('presentNotificationForRead với workDateRange', () => {
  it('chỉ có workDateRange {from,to}: "(có hôm nay)" khi hôm nay nằm trong khoảng', () => {
    const row = {
      title: 'Đăng ký ca',
      content: 'Đăng ký ca thành công từ 01/09 đến 10/10',
      metadata: { workDateRange: { from: '2026-09-01', to: '2026-10-10' } },
    };
    const inside = presentNotificationForRead(row, new Date('2026-09-21T03:00:00Z'));
    expect(inside.content).toBe(
      'Đăng ký ca thành công từ 01/09 đến 10/10 (có hôm nay)',
    );
    const after = presentNotificationForRead(
      { ...row, content: inside.content },
      new Date('2026-10-12T03:00:00Z'),
    );
    expect(after.content).toBe('Đăng ký ca thành công từ 01/09 đến 10/10');
  });
});
