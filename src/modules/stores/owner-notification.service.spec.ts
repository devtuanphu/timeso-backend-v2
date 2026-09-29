import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateOwnerNotificationSettingsDto } from './dto/owner-notification-settings.dto';
import { OwnerNotificationService } from './owner-notification.service';
import {
  DEFAULT_OWNER_NOTIFICATION_SETTINGS,
  OWNER_WORK_SHIFT_ROUTE,
  ownerAlertFingerprint,
} from './owner-notification.utils';

const VN = (local: string) => new Date(`${local}+07:00`);

type Ctx = Record<string, any>;

const baseRow = (overrides: Ctx = {}): Ctx => ({
  id: 'as-1',
  status: 'APPROVED',
  checked_in: false,
  checked_out: false,
  work_date: '2026-09-21',
  start_time: '18:00:00',
  end_time: '22:00:00',
  shift_name: 'Tối',
  store_id: 'store-1',
  cycle_status: 'ACTIVE',
  scheduled_stop_at: null,
  owner_account_id: 'owner-1',
  employee_id: 'emp-1',
  employee_account_id: 'staff-1',
  employee_name: 'Minh',
  effective_end_at: null,
  ...overrides,
});

function build(options: {
  rows?: Ctx[];
  settings?: Record<string, unknown> | null;
  onLeave?: boolean;
} = {}) {
  const rows = options.rows ?? [baseRow()];
  const dedup = new Set<string>();
  const query = jest.fn(async (sql: string, values: any[] = []) => {
    if (sql.includes('FROM shift_assignments sa') && sql.includes('ANY($1::uuid[])')) {
      return rows.filter((row) => values[0].includes(row.id));
    }
    if (sql.includes('INSERT INTO owner_notification_log')) {
      if (dedup.has(values[0])) return [];
      dedup.add(values[0]);
      return [{ id: 'log-1' }];
    }
    if (sql.includes('DELETE FROM owner_notification_log')) {
      dedup.delete(values[0]);
      return [];
    }
    if (sql.includes('employee_leave_requests')) {
      return [{ covered: Boolean(options.onLeave) }];
    }
    if (sql.includes('SELECT sa.id') && sql.includes('LIMIT $5')) {
      return rows.map((row) => ({ id: row.id }));
    }
    return [];
  });
  const settingsRepository = {
    findOne: jest.fn().mockResolvedValue(
      options.settings
        ? {
            ...DEFAULT_OWNER_NOTIFICATION_SETTINGS,
            ...options.settings,
          }
        : null,
    ),
    upsert: jest.fn().mockResolvedValue({}),
  };
  const notificationsService = { create: jest.fn().mockResolvedValue({ id: 'n-1' }) };
  const jobs = new Map<string, any>();
  const queue = {
    getJob: jest.fn(async (id: string) => jobs.get(id)),
    remove: jest.fn(async (id: string) => (jobs.delete(id) ? 1 : 0)),
    add: jest.fn(async (name: string, data: any, opts: any) => {
      jobs.set(opts.jobId, { id: opts.jobId, name, data, opts });
    }),
  };
  const service = new OwnerNotificationService(
    settingsRepository as any,
    { query } as any,
    notificationsService as any,
    queue as any,
  );
  return { service, query, settingsRepository, notificationsService, queue, jobs, dedup };
}

describe('owner notification settings', () => {
  it('defaults to everything on and 30 minutes when no row exists', async () => {
    const { service } = build();
    await expect(service.getSettings('store-1', 'owner-1')).resolves.toEqual({
      preShiftEnabled: true,
      preShiftMinutes: 30,
      checkInEnabled: true,
      checkOutEnabled: true,
      shiftEndingEnabled: true,
      lateEarlyEnabled: true,
    });
  });

  it('update merges onto the current values and upserts per (store, owner)', async () => {
    const { service, settingsRepository } = build();
    const reconcile = jest
      .spyOn(service, 'reconcileUpcoming')
      .mockResolvedValue({ candidates: 0 });

    const result = await service.updateSettings('store-1', 'owner-1', {
      preShiftMinutes: 15,
      checkOutEnabled: false,
    });

    expect(result).toMatchObject({ preShiftMinutes: 15, checkOutEnabled: false, checkInEnabled: true });
    expect(settingsRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'store-1', ownerAccountId: 'owner-1', preShiftMinutes: 15 }),
      ['storeId', 'ownerAccountId'],
    );
    // Lead time changed: the store's upcoming jobs are rebuilt.
    expect(reconcile).toHaveBeenCalledWith(expect.any(Date), { storeId: 'store-1' });
  });

  it('reconcileUpcoming merges extra ids and syncs each assignment once', async () => {
    const { service } = build();
    (service as any).dataSource = {
      query: jest.fn().mockResolvedValue([{ id: 'as-1' }, { id: 'as-3' }]),
    };
    const sync = jest
      .spyOn(service, 'syncAssignments')
      .mockResolvedValue(undefined as any);
    const now = new Date('2026-09-21T05:00:00Z');
    await expect(
      service.reconcileUpcoming(now, { extraAssignmentIds: ['as-1', 'as-2', ''] }),
    ).resolves.toEqual({ candidates: 3 });
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith(['as-1', 'as-3', 'as-2'], now);
  });

  it('DTO: only 15 or 30 minutes and booleans are accepted; unknown fields are not whitelisted', async () => {
    const bad = plainToInstance(UpdateOwnerNotificationSettingsDto, {
      preShiftMinutes: 20,
      checkInEnabled: 'yes',
    });
    const errors = await validate(bad);
    expect(errors.map((error) => error.property).sort()).toEqual([
      'checkInEnabled',
      'preShiftMinutes',
    ]);
    const good = plainToInstance(UpdateOwnerNotificationSettingsDto, {
      preShiftMinutes: 15,
      lateEarlyEnabled: false,
    });
    await expect(validate(good)).resolves.toHaveLength(0);
  });
});

describe('owner check-in / check-out notifications', () => {
  const checkIn = (lateMinutes = 0) => ({
    kind: 'check_in' as const,
    assignmentId: 'as-1',
    at: VN('2026-09-21T18:05:00'),
    lateMinutes,
  });

  it('routes owner alerts to the owner app main work-shift calendar', () => {
    expect(OWNER_WORK_SHIFT_ROUTE).toBe('/(work-shift)');
  });

  it('check-in with late folded in, to the owner, with the work-shift route', async () => {
    const { service, notificationsService } = build();
    await expect(service.notifyAttendance(checkIn(5))).resolves.toBe(true);
    const [payload] = notificationsService.create.mock.calls[0];
    expect(payload).toMatchObject({
      accountId: 'owner-1',
      storeId: 'store-1',
      title: 'Nhân viên đi trễ',
      content: 'Minh check-in ca Tối lúc 18:05, trễ 5 phút',
      actionUrl: OWNER_WORK_SHIFT_ROUTE,
      metadata: expect.objectContaining({
        type: 'OWNER_CHECK_IN',
        lateMinutes: 5,
        assignmentId: 'as-1',
        employeeProfileId: 'emp-1',
      }),
    });
  });

  it('late/early switch off: the check-in message does not mention lateness', async () => {
    const { service, notificationsService } = build({ settings: { lateEarlyEnabled: false } });
    await service.notifyAttendance(checkIn(5));
    expect(notificationsService.create.mock.calls[0][0].content).toBe(
      'Minh check-in ca Tối lúc 18:05',
    );
  });

  it('check-in switch off but late switch on: only a late arrival is sent, as OWNER_LATE', async () => {
    const { service, notificationsService } = build({ settings: { checkInEnabled: false } });
    await expect(service.notifyAttendance(checkIn(0))).resolves.toBe(false);
    await expect(service.notifyAttendance(checkIn(7))).resolves.toBe(true);
    expect(notificationsService.create).toHaveBeenCalledTimes(1);
    expect(notificationsService.create.mock.calls[0][0].metadata.type).toBe('OWNER_LATE');
  });

  it('both switches off: nothing is sent', async () => {
    const { service, notificationsService } = build({
      settings: { checkInEnabled: false, lateEarlyEnabled: false },
    });
    await expect(service.notifyAttendance(checkIn(9))).resolves.toBe(false);
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('dedup: a repeated check-in notification is sent once', async () => {
    const { service, notificationsService } = build();
    await service.notifyAttendance(checkIn());
    await service.notifyAttendance(checkIn());
    expect(notificationsService.create).toHaveBeenCalledTimes(1);
  });

  it('a failed send releases the dedup claim so a retry can deliver', async () => {
    const { service, notificationsService, dedup } = build();
    notificationsService.create.mockRejectedValueOnce(new Error('push down'));
    await expect(service.notifyAttendance(checkIn())).rejects.toThrow('push down');
    expect(dedup.size).toBe(0);
    await expect(service.notifyAttendance(checkIn())).resolves.toBe(true);
  });

  it('the owner working the shift is not notified about themself', async () => {
    const { service, notificationsService } = build({
      rows: [baseRow({ employee_account_id: 'owner-1' })],
    });
    await expect(service.notifyAttendance(checkIn(3))).resolves.toBe(false);
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('check-out early: "về sớm"; with check-out off it is OWNER_EARLY_LEAVE', async () => {
    const on = build({ rows: [baseRow({ status: 'COMPLETED' })] });
    await on.service.notifyAttendance({
      kind: 'check_out',
      assignmentId: 'as-1',
      at: VN('2026-09-21T21:50:00'),
      earlyMinutes: 10,
    });
    expect(on.notificationsService.create.mock.calls[0][0]).toMatchObject({
      title: 'Nhân viên về sớm',
      content: 'Minh check-out ca Tối lúc 21:50, về sớm 10 phút',
      metadata: expect.objectContaining({ type: 'OWNER_CHECK_OUT', earlyMinutes: 10 }),
    });

    const off = build({ settings: { checkOutEnabled: false } });
    await off.service.notifyAttendance({
      kind: 'check_out',
      assignmentId: 'as-1',
      at: VN('2026-09-21T22:01:00'),
      earlyMinutes: 0,
    });
    expect(off.notificationsService.create).not.toHaveBeenCalled();
  });

  it('afterAttendance never throws, even when everything fails', async () => {
    const { service, query } = build();
    query.mockRejectedValue(new Error('db down'));
    await expect(service.afterAttendance(checkIn(1))).resolves.toBeUndefined();
  });
});

describe('owner pre-shift and ending-soon jobs', () => {
  const NOW = VN('2026-09-21T12:00:00');

  it('schedules one pre-shift job (start − 30 min) and one ending job (end − 15 min) per assignment', async () => {
    const { service, jobs } = build();
    await service.syncAssignments(['as-1'], NOW);

    const pre = jobs.get('owner_pre_as-1');
    const end = jobs.get('owner_end_as-1');
    expect(pre.opts.delay).toBe(VN('2026-09-21T17:30:00').getTime() - NOW.getTime());
    expect(pre.data).toEqual({
      assignmentId: 'as-1',
      kind: 'pre_shift',
      fingerprint: ownerAlertFingerprint('pre_shift', VN('2026-09-21T18:00:00'), 30),
    });
    expect(end.opts.delay).toBe(VN('2026-09-21T21:45:00').getTime() - NOW.getTime());
  });

  it('15-minute lead time is used when set', async () => {
    const { service, jobs } = build({ settings: { preShiftMinutes: 15 } });
    await service.syncAssignments(['as-1'], NOW);
    expect(jobs.get('owner_pre_as-1').opts.delay).toBe(
      VN('2026-09-21T17:45:00').getTime() - NOW.getTime(),
    );
  });

  it('cross-midnight: a 22:00–06:00 shift ends at 06:00 the next day', async () => {
    const { service, jobs } = build({
      rows: [baseRow({ start_time: '22:00:00', end_time: '06:00:00' })],
    });
    await service.syncAssignments(['as-1'], NOW);
    expect(jobs.get('owner_end_as-1').opts.delay).toBe(
      VN('2026-09-22T05:45:00').getTime() - NOW.getTime(),
    );
  });

  it('a Date work_date from a raw query is read on the Vietnam calendar', async () => {
    const { service, jobs } = build({
      // Midnight VN on 21/09, as pg hands back a `date` column.
      rows: [baseRow({ work_date: VN('2026-09-21T00:00:00') })],
    });
    await service.syncAssignments(['as-1'], NOW);
    expect(jobs.get('owner_pre_as-1').opts.delay).toBe(
      VN('2026-09-21T17:30:00').getTime() - NOW.getTime(),
    );
  });

  it('disabled switches or a cancelled assignment leave no jobs', async () => {
    const disabled = build({ settings: { preShiftEnabled: false, shiftEndingEnabled: false } });
    await disabled.service.syncAssignments(['as-1'], NOW);
    expect(disabled.jobs.size).toBe(0);

    const cancelled = build({ rows: [baseRow({ status: 'CANCELLED' })] });
    cancelled.jobs.set('owner_pre_as-1', { data: {} });
    await cancelled.service.syncAssignments(['as-1'], NOW);
    expect(cancelled.jobs.size).toBe(0);
  });

  it('re-sync with an unchanged schedule keeps the queued job (idempotent)', async () => {
    const { service, queue } = build();
    await service.syncAssignments(['as-1'], NOW);
    await service.syncAssignments(['as-1'], NOW);
    expect(queue.add).toHaveBeenCalledTimes(2); // pre + end, once each
  });

  it('pre-shift processor sends "Ca của Minh bắt đầu lúc 18:00, còn 30 phút"', async () => {
    const { service, notificationsService } = build();
    const result = await service.processJob(
      {
        assignmentId: 'as-1',
        kind: 'pre_shift',
        fingerprint: ownerAlertFingerprint('pre_shift', VN('2026-09-21T18:00:00'), 30),
      },
      VN('2026-09-21T17:30:00'),
    );
    expect(result).toEqual({ sent: true });
    expect(notificationsService.create.mock.calls[0][0]).toMatchObject({
      accountId: 'owner-1',
      title: 'Sắp đến ca làm',
      content: 'Ca của Minh bắt đầu lúc 18:00, còn 30 phút',
      metadata: expect.objectContaining({ type: 'OWNER_PRE_SHIFT' }),
    });
  });

  it.each([
    ['the switch is off', { settings: { preShiftEnabled: false } }],
    ['the assignment was cancelled', { rows: [baseRow({ status: 'CANCELLED' })] }],
    ['the employee already checked in', { rows: [baseRow({ checked_in: true, status: 'CONFIRMED' })] }],
    ['the shift time changed', { rows: [baseRow({ start_time: '19:00:00' })] }],
    ['the lead time changed', { settings: { preShiftMinutes: 15 } }],
    ['the employee is on approved leave', { onLeave: true }],
    ['the cycle was stopped', { rows: [baseRow({ cycle_status: 'STOPPED' })] }],
  ])('pre-shift processor skips when %s', async (_label, options) => {
    const { service, notificationsService } = build(options as any);
    const result = await service.processJob(
      {
        assignmentId: 'as-1',
        kind: 'pre_shift',
        fingerprint: ownerAlertFingerprint('pre_shift', VN('2026-09-21T18:00:00'), 30),
      },
      VN('2026-09-21T17:30:00'),
    );
    expect(result).toEqual({ sent: false });
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it.each([
    ['exactly at the start', '2026-09-21T18:00:00'],
    ['after the start (delayed job)', '2026-09-21T18:20:00'],
  ])('pre-shift processor skips a job run %s', async (_label, at) => {
    const { service, notificationsService } = build();
    const result = await service.processJob(
      {
        assignmentId: 'as-1',
        kind: 'pre_shift',
        fingerprint: ownerAlertFingerprint('pre_shift', VN('2026-09-21T18:00:00'), 30),
      },
      VN(at),
    );
    expect(result).toEqual({ sent: false });
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('pre-shift processor still sends one minute before the start', async () => {
    const { service } = build();
    await expect(
      service.processJob(
        {
          assignmentId: 'as-1',
          kind: 'pre_shift',
          fingerprint: ownerAlertFingerprint('pre_shift', VN('2026-09-21T18:00:00'), 30),
        },
        VN('2026-09-21T17:59:00'),
      ),
    ).resolves.toEqual({ sent: true });
  });

  it.each([
    ['exactly at the end', '2026-09-22T06:00:00'],
    ['after the end (delayed job)', '2026-09-22T06:30:00'],
  ])('ending-soon processor skips a job run %s', async (_label, at) => {
    const { service, notificationsService } = build({
      rows: [
        baseRow({
          start_time: '22:00:00',
          end_time: '06:00:00',
          status: 'CONFIRMED',
          checked_in: true,
        }),
      ],
    });
    const result = await service.processJob(
      {
        assignmentId: 'as-1',
        kind: 'shift_ending',
        fingerprint: ownerAlertFingerprint('shift_ending', VN('2026-09-22T06:00:00')),
      },
      VN(at),
    );
    expect(result).toEqual({ sent: false });
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('ending-soon processor: checked in, cross-midnight end text, sent once', async () => {
    const { service, notificationsService } = build({
      rows: [
        baseRow({
          start_time: '22:00:00',
          end_time: '06:00:00',
          status: 'CONFIRMED',
          checked_in: true,
        }),
      ],
    });
    const job = {
      assignmentId: 'as-1',
      kind: 'shift_ending' as const,
      fingerprint: ownerAlertFingerprint('shift_ending', VN('2026-09-22T06:00:00')),
    };
    await expect(service.processJob(job, VN('2026-09-22T05:45:00'))).resolves.toEqual({ sent: true });
    await expect(service.processJob(job, VN('2026-09-22T05:45:00'))).resolves.toEqual({ sent: false });
    expect(notificationsService.create).toHaveBeenCalledTimes(1);
    expect(notificationsService.create.mock.calls[0][0]).toMatchObject({
      title: 'Ca sắp kết thúc',
      content: 'Ca của Minh kết thúc lúc 06:00, còn 15 phút',
      metadata: expect.objectContaining({ type: 'OWNER_SHIFT_ENDING' }),
    });
  });

  it('ending-soon follows an approved-overtime effective end and skips a stale job', async () => {
    const { service, notificationsService } = build({
      rows: [
        baseRow({
          status: 'CONFIRMED',
          checked_in: true,
          effective_end_at: VN('2026-09-21T23:00:00'),
        }),
      ],
    });
    const stale = await service.processJob(
      {
        assignmentId: 'as-1',
        kind: 'shift_ending',
        fingerprint: ownerAlertFingerprint('shift_ending', VN('2026-09-21T22:00:00')),
      },
      VN('2026-09-21T21:45:00'),
    );
    expect(stale).toEqual({ sent: false });
    const current = await service.processJob(
      {
        assignmentId: 'as-1',
        kind: 'shift_ending',
        fingerprint: ownerAlertFingerprint('shift_ending', VN('2026-09-21T23:00:00')),
      },
      VN('2026-09-21T22:45:00'),
    );
    expect(current).toEqual({ sent: true });
    expect(notificationsService.create.mock.calls[0][0].content).toBe(
      'Ca của Minh kết thúc lúc 23:00, còn 15 phút',
    );
  });

  it('ending-soon skips when the employee never checked in or already checked out', async () => {
    for (const row of [
      baseRow({ checked_in: false }),
      baseRow({ checked_in: true, checked_out: true, status: 'COMPLETED' }),
    ]) {
      const { service, notificationsService } = build({ rows: [row] });
      const result = await service.processJob(
        {
          assignmentId: 'as-1',
          kind: 'shift_ending',
          fingerprint: ownerAlertFingerprint('shift_ending', VN('2026-09-21T22:00:00')),
        },
        VN('2026-09-21T21:45:00'),
      );
      expect(result).toEqual({ sent: false });
      expect(notificationsService.create).not.toHaveBeenCalled();
    }
  });
});
