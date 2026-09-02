import { ShiftReminderService } from './shift-reminder.service';
import { parseVietnamShiftStart } from './shift-reminder.utils';

const createMutationLockClient = () => {
  const locks = new Map<string, { token: string; expiresAt: number }>();
  return {
    set: jest.fn(
      async (
        key: string,
        token: string,
        px: string,
        ttl: number,
        nx: string,
      ) => {
        expect([px, nx]).toEqual(['PX', 'NX']);
        const current = locks.get(key);
        if (current && current.expiresAt > Date.now()) return null;
        locks.set(key, { token, expiresAt: Date.now() + ttl });
        return 'OK' as const;
      },
    ),
    eval: jest.fn(
      async (
        script: string,
        _numberOfKeys: number,
        key: string,
        token: string,
        ttl?: number,
      ) => {
        const current = locks.get(key);
        if (!current || current.token !== token) return 0;
        if (script.includes('pexpire')) {
          current.expiresAt = Date.now() + Number(ttl);
          return 1;
        }
        locks.delete(key);
        return 1;
      },
    ),
  };
};

const withMutationLock = <T extends object>(
  queue: T,
  client = createMutationLockClient(),
) =>
  Object.assign(queue, {
    client: Promise.resolve(client),
    toKey: (value: string) => `bull:shift-reminders:${value}`,
  });

const authoritativeAssignment = (
  assignmentId: string,
  workDate: string,
  startTime: string,
  settings: any,
) => ({
  id: assignmentId,
  status: 'APPROVED',
  shiftSlot: {
    id: `slot-${assignmentId}`,
    workDate,
    startTime,
    cycle: { status: 'ACTIVE', scheduledStopAt: null },
    workShift: { id: 'shift-1', startTime },
  },
  employee: {
    id: 'employee-1',
    storeId: 'store-1',
    reminderSettings: settings,
  },
});

describe('ShiftReminderService identity', () => {
  it('creates distinct jobs for different assignments sharing a work shift', async () => {
    const queue = withMutationLock({
      add: jest.fn().mockResolvedValue(undefined),
      addBulk: jest.fn(),
      remove: jest.fn().mockResolvedValue(0),
      getJob: jest.fn().mockResolvedValue(undefined),
    });
    const assignmentRepository = {
      find: jest.fn(async () => [
        authoritativeAssignment('assignment-1', '2030-01-01', '09:00:00', {
          type: '15m',
        }),
        authoritativeAssignment('assignment-2', '2030-01-02', '09:00:00', {
          type: '15m',
        }),
      ]),
      findOne: jest.fn(),
    };
    const service = new ShiftReminderService(
      queue as any,
      assignmentRepository as any,
    );
    const settings = { type: '15m' };

    await service.syncEmployeeReminders('employee-1', 'store-1', settings, [
      {
        id: 'assignment-1',
        status: 'APPROVED',
        shiftSlot: {
          id: 'slot-1',
          workDate: '2030-01-01',
          startTime: '09:00:00',
          workShift: { id: 'shift-1', startTime: '09:00:00' },
        },
      } as any,
      {
        id: 'assignment-2',
        status: 'APPROVED',
        shiftSlot: {
          id: 'slot-2',
          workDate: '2030-01-02',
          startTime: '09:00:00',
          workShift: { id: 'shift-1', startTime: '09:00:00' },
        },
      } as any,
    ]);

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add.mock.calls[0][2].jobId).toBe('reminder_v2_assignment-1');
    expect(queue.add.mock.calls[1][2].jobId).toBe('reminder_v2_assignment-2');
    expect(queue.add.mock.calls[0][1].scheduleFingerprint).not.toBe(
      queue.add.mock.calls[1][1].scheduleFingerprint,
    );
    expect(assignmentRepository.find).toHaveBeenCalledTimes(1);
    expect(assignmentRepository.findOne).not.toHaveBeenCalled();
  });

  it('replaces one stable v2 job when time or preference changes', async () => {
    const events: string[] = [];
    const queue = withMutationLock({
      add: jest.fn(async (_name, _data, options) => {
        events.push(`add:${options.jobId}`);
      }),
      addBulk: jest.fn(),
      remove: jest.fn(async (jobId) => {
        events.push(`remove:${jobId}`);
        return 1;
      }),
    });
    const assignmentRepository = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(
          authoritativeAssignment('assignment-1', '2030-01-01', '09:00:00', {
            type: '15m',
          }),
        )
        .mockResolvedValueOnce(
          authoritativeAssignment('assignment-1', '2030-01-01', '10:00:00', {
            type: '1h',
          }),
        ),
    };
    const service = new ShiftReminderService(
      queue as any,
      assignmentRepository as any,
    );
    const identity = { assignmentId: 'assignment-1', shiftSlotId: 'slot-1' };

    await service.scheduleReminder(
      'employee-1',
      'store-1',
      'shift-1',
      parseVietnamShiftStart('2030-01-01', '09:00'),
      { type: '15m' },
      identity,
    );
    await service.scheduleReminder(
      'employee-1',
      'store-1',
      'shift-1',
      parseVietnamShiftStart('2030-01-01', '10:00'),
      { type: '1h' },
      identity,
    );

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add.mock.calls[0][2].jobId).toBe(
      queue.add.mock.calls[1][2].jobId,
    );
    expect(queue.add.mock.calls[0][1].scheduleFingerprint).not.toBe(
      queue.add.mock.calls[1][1].scheduleFingerprint,
    );
    expect(queue.add.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        removeOnComplete: { age: 86400, count: 50000 },
        removeOnFail: { age: 604800, count: 50000 },
      }),
    );
    expect(
      events.filter((event) => event === 'add:reminder_v2_assignment-1'),
    ).toHaveLength(2);
    expect(events.indexOf('remove:reminder_v2_assignment-1')).toBeLessThan(
      events.indexOf('add:reminder_v2_assignment-1'),
    );
  });

  it('is idempotent when the same stable assignment reminder is retried', async () => {
    const queued = new Set<string>();
    const queue = withMutationLock({
      remove: jest.fn(async (jobId: string) => (queued.delete(jobId) ? 1 : 0)),
      getJob: jest.fn(async (jobId: string) =>
        queued.has(jobId) ? { id: jobId } : undefined,
      ),
      add: jest.fn(async (_name, _data, options) => queued.add(options.jobId)),
      addBulk: jest.fn(),
    });
    const assignmentRepository = {
      findOne: jest.fn().mockResolvedValue(
        authoritativeAssignment('assignment-1', '2030-01-01', '09:00:00', {
          type: '15m',
        }),
      ),
    };
    const service = new ShiftReminderService(
      queue as any,
      assignmentRepository as any,
    );
    const args = [
      'employee-1',
      'store-1',
      'shift-1',
      parseVietnamShiftStart('2030-01-01', '09:00'),
      { type: '15m' },
      { assignmentId: 'assignment-1', shiftSlotId: 'slot-1' },
    ] as const;

    await service.scheduleReminder(...args);
    await service.scheduleReminder(...args);

    expect(queued).toEqual(new Set(['reminder_v2_assignment-1']));
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('uses one replaceable successor when the primary job is active', async () => {
    type StoredJob = {
      id: string;
      data: any;
      opts: any;
      state: 'delayed' | 'active';
    };
    const stored = new Map<string, StoredJob>();
    const queue = withMutationLock({
      remove: jest.fn(async (jobId: string) => {
        const existing = stored.get(jobId);
        if (!existing) return 0;
        if (existing.state === 'active') return 0;
        stored.delete(jobId);
        return 1;
      }),
      getJob: jest.fn(async (jobId: string) => stored.get(jobId)),
      add: jest.fn(async (_name: string, data: any, opts: any) => {
        if (stored.has(opts.jobId)) return stored.get(opts.jobId);
        const job = { id: opts.jobId, data, opts, state: 'delayed' as const };
        stored.set(opts.jobId, job);
        return job;
      }),
      addBulk: jest.fn(),
    });
    const authoritativeStates = [
      ['09:00:00', { type: '15m' }],
      ['09:30:00', { type: '30m' }],
      ['09:30:00', { type: '30m' }],
      ['10:00:00', { type: '1h' }],
      ['11:00:00', { type: '30m' }],
      ['12:00:00', { type: '1h' }],
      ['13:00:00', { type: '30m' }],
    ] as const;
    let lastAuthoritativeState: readonly [string, any] = authoritativeStates[0];
    const assignmentRepository = {
      findOne: jest.fn(async () => {
        const nextState = authoritativeStates.shift();
        if (nextState) lastAuthoritativeState = nextState;
        const [time, settings] = lastAuthoritativeState;
        return authoritativeAssignment(
          'assignment-1',
          '2030-01-01',
          time,
          settings,
        );
      }),
    };
    const service = new ShiftReminderService(
      queue as any,
      assignmentRepository as any,
    );
    const identity = { assignmentId: 'assignment-1', shiftSlotId: 'slot-1' };

    await service.scheduleReminder(
      'employee-1',
      'store-1',
      'shift-1',
      parseVietnamShiftStart('2030-01-01', '09:00'),
      { type: '15m' },
      identity,
    );
    await service.scheduleReminder(
      'employee-1',
      'store-1',
      'shift-1',
      parseVietnamShiftStart('2030-01-01', '09:30'),
      { type: '30m' },
      identity,
    );
    expect([...stored.keys()]).toEqual(['reminder_v2_assignment-1']);
    expect(
      stored.get('reminder_v2_assignment-1')!.data.startTime.toISOString(),
    ).toBe(parseVietnamShiftStart('2030-01-01', '09:30').toISOString());
    expect(
      queue.remove.mock.invocationCallOrder.some(
        (order) =>
          order > queue.add.mock.invocationCallOrder[0] &&
          order < queue.add.mock.invocationCallOrder[1],
      ),
    ).toBe(true);
    stored.get('reminder_v2_assignment-1')!.state = 'active';

    await service.scheduleReminder(
      'employee-1',
      'store-1',
      'shift-1',
      parseVietnamShiftStart('2030-01-01', '09:30'),
      { type: '30m' },
      identity,
    );
    expect([...stored.keys()]).toEqual(['reminder_v2_assignment-1']);

    await service.scheduleReminder(
      'employee-1',
      'store-1',
      'shift-1',
      parseVietnamShiftStart('2030-01-01', '10:00'),
      { type: '1h' },
      identity,
    );
    const firstSuccessorFingerprint = stored.get(
      'reminder_v2_assignment-1_successor',
    )!.data.scheduleFingerprint;

    await service.scheduleReminder(
      'employee-1',
      'store-1',
      'shift-1',
      parseVietnamShiftStart('2030-01-01', '11:00'),
      { type: '30m' },
      identity,
    );

    expect([...stored.keys()].sort()).toEqual([
      'reminder_v2_assignment-1',
      'reminder_v2_assignment-1_successor',
    ]);
    const successor = stored.get('reminder_v2_assignment-1_successor')!;
    expect(successor.data.scheduleFingerprint).not.toBe(
      firstSuccessorFingerprint,
    );
    expect(successor.data.startTime.toISOString()).toBe(
      parseVietnamShiftStart('2030-01-01', '11:00').toISOString(),
    );
    for (const current of stored.values()) {
      expect(current.opts.removeOnComplete).toEqual({
        age: 86400,
        count: 50000,
      });
      expect(current.opts.removeOnFail).toEqual({
        age: 604800,
        count: 50000,
      });
    }
    expect(stored.size).toBeLessThanOrEqual(2);

    successor.state = 'active';
    stored.delete('reminder_v2_assignment-1');
    await service.scheduleReminder(
      'employee-1',
      'store-1',
      'shift-1',
      parseVietnamShiftStart('2030-01-01', '12:00'),
      { type: '1h' },
      identity,
    );
    expect(
      stored.get('reminder_v2_assignment-1')!.data.startTime.toISOString(),
    ).toBe(parseVietnamShiftStart('2030-01-01', '12:00').toISOString());

    stored.get('reminder_v2_assignment-1')!.state = 'active';
    await expect(
      service.scheduleReminder(
        'employee-1',
        'store-1',
        'shift-1',
        parseVietnamShiftStart('2030-01-01', '13:00'),
        { type: '30m' },
        identity,
      ),
    ).rejects.toThrow('Shift reminder reconciliation unavailable');
    expect(stored.size).toBe(2);
  });

  it('reconciles after both active jobs finish without creating a third id', async () => {
    const current = authoritativeAssignment(
      'assignment-1',
      '2030-01-01',
      '13:00:00',
      { type: '30m' },
    );
    const stored = new Map<string, any>([
      [
        'reminder_v2_assignment-1',
        {
          id: 'reminder_v2_assignment-1',
          state: 'active',
          data: { scheduleFingerprint: 'old-primary' },
        },
      ],
      [
        'reminder_v2_assignment-1_successor',
        {
          id: 'reminder_v2_assignment-1_successor',
          state: 'active',
          data: { scheduleFingerprint: 'old-successor' },
        },
      ],
    ]);
    const queue = withMutationLock({
      remove: jest.fn(async (jobId: string) => {
        const job = stored.get(jobId);
        if (!job) return 0;
        if (job.state === 'active') return 0;
        stored.delete(jobId);
        return 1;
      }),
      getJob: jest.fn(async (jobId: string) => stored.get(jobId)),
      add: jest.fn(async (_name: string, data: any, opts: any) => {
        stored.set(opts.jobId, {
          id: opts.jobId,
          state: 'delayed',
          data,
          opts,
        });
      }),
    });
    const service = new ShiftReminderService(
      queue as any,
      {
        findOne: jest.fn().mockResolvedValue(current),
      } as any,
    );
    setTimeout(() => {
      for (const job of stored.values()) job.state = 'completed';
    }, 100);

    await expect(
      service.scheduleAssignmentReminder('assignment-1'),
    ).resolves.toBe(true);
    expect([...stored.keys()]).toEqual(['reminder_v2_assignment-1']);
  });

  it('serializes concurrent cross-instance changes with the Redis token lock', async () => {
    const baseClient = createMutationLockClient();
    let releaseFirstSet!: () => void;
    let signalFirstSet!: () => void;
    const firstSetEntered = new Promise<void>((resolve) => {
      signalFirstSet = resolve;
    });
    const firstSetGate = new Promise<void>((resolve) => {
      releaseFirstSet = resolve;
    });
    let setCalls = 0;
    const client = {
      set: jest.fn(async (...args: Parameters<typeof baseClient.set>) => {
        setCalls += 1;
        if (setCalls === 1) {
          signalFirstSet();
          await firstSetGate;
        }
        return baseClient.set(...args);
      }),
      eval: baseClient.eval,
    };
    const stored = new Map<string, any>();
    const queue = withMutationLock(
      {
        remove: jest.fn(async (jobId: string) =>
          stored.delete(jobId) ? 1 : 0,
        ),
        getJob: jest.fn(async (jobId: string) => stored.get(jobId)),
        add: jest.fn(async (_name: string, data: any, opts: any) => {
          if (!stored.has(opts.jobId)) {
            stored.set(opts.jobId, { id: opts.jobId, data, opts });
          }
          return stored.get(opts.jobId);
        }),
        addBulk: jest.fn(),
      },
      client,
    );
    let current = authoritativeAssignment(
      'assignment-1',
      '2030-01-01',
      '10:00:00',
      { type: '1h' },
    );
    const assignmentRepository = {
      findOne: jest.fn(async () => current),
    };
    const firstService = new ShiftReminderService(
      queue as any,
      assignmentRepository as any,
    );
    const secondService = new ShiftReminderService(
      queue as any,
      assignmentRepository as any,
    );
    const identity = { assignmentId: 'assignment-1', shiftSlotId: 'slot-1' };

    const first = firstService.scheduleReminder(
      'employee-1',
      'store-1',
      'shift-1',
      parseVietnamShiftStart('2030-01-01', '10:00'),
      { type: '1h' },
      identity,
    );
    await firstSetEntered;
    current = authoritativeAssignment(
      'assignment-1',
      '2030-01-01',
      '11:00:00',
      { type: '30m' },
    );
    const second = secondService.scheduleReminder(
      'employee-1',
      'store-1',
      'shift-1',
      parseVietnamShiftStart('2030-01-01', '11:00'),
      { type: '30m' },
      identity,
    );
    await second;
    releaseFirstSet();
    await first;

    expect(stored.size).toBe(1);
    expect(
      stored.get('reminder_v2_assignment-1').data.startTime.toISOString(),
    ).toBe(parseVietnamShiftStart('2030-01-01', '11:00').toISOString());
    expect(client.set).toHaveBeenCalledWith(
      'bull:shift-reminders:mutation-lock:assignment:assignment-1',
      expect.any(String),
      'PX',
      10000,
      'NX',
    );
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('del'"),
      1,
      'bull:shift-reminders:mutation-lock:assignment:assignment-1',
      expect.any(String),
    );
    expect((client as any).runCommand).toBeUndefined();
  });

  it('fails safely after a bounded distributed-lock wait', async () => {
    const client = {
      set: jest.fn().mockResolvedValue(null),
      eval: jest.fn(),
    };
    const queue = withMutationLock(
      {
        add: jest.fn(),
        remove: jest.fn(),
        getJob: jest.fn(),
      },
      client,
    );
    const service = new ShiftReminderService(
      queue as any,
      {
        findOne: jest.fn(),
      } as any,
    );

    await expect(
      service.scheduleReminder(
        'employee-1',
        'store-1',
        'shift-1',
        parseVietnamShiftStart('2030-01-01', '10:00'),
        { type: '15m' },
        { assignmentId: 'assignment-1' },
      ),
    ).rejects.toThrow('Shift reminder mutation lock unavailable');
    expect(client.set).toHaveBeenCalledTimes(20);
    expect(client.eval).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects a queue client that does not expose the real ioredis eval surface', async () => {
    const set = jest.fn();
    const queue = Object.assign(
      {
        add: jest.fn(),
        remove: jest.fn(),
        getJob: jest.fn(),
      },
      {
        client: Promise.resolve({ set }),
        toKey: (value: string) => `bull:shift-reminders:${value}`,
      },
    );
    const assignmentRepository = { findOne: jest.fn() };
    const service = new ShiftReminderService(
      queue as any,
      assignmentRepository as any,
    );

    await expect(
      service.scheduleAssignmentReminder('assignment-1'),
    ).rejects.toThrow('Shift reminder mutation lock unavailable');
    expect(set).not.toHaveBeenCalled();
    expect(assignmentRepository.findOne).not.toHaveBeenCalled();
  });

  it('isolates a permanently locked assignment from sibling batch reminders', async () => {
    const assignments = [
      authoritativeAssignment('assignment-1', '2030-01-01', '09:00:00', {
        type: '15m',
      }),
      authoritativeAssignment('assignment-2', '2030-01-01', '10:00:00', {
        type: '30m',
      }),
    ];
    const stored = new Map<string, any>([
      [
        'reminder_v2_assignment-1',
        {
          id: 'reminder_v2_assignment-1',
          state: 'active',
          data: { scheduleFingerprint: 'stale-primary' },
        },
      ],
      [
        'reminder_v2_assignment-1_successor',
        {
          id: 'reminder_v2_assignment-1_successor',
          state: 'active',
          data: { scheduleFingerprint: 'stale-successor' },
        },
      ],
    ]);
    const queue = withMutationLock({
      remove: jest.fn(async (jobId: string) => {
        const existing = stored.get(jobId);
        if (!existing) return 0;
        if (existing.state === 'active') return 0;
        stored.delete(jobId);
        return 1;
      }),
      getJob: jest.fn(async (jobId: string) => stored.get(jobId)),
      add: jest.fn(async (_name: string, data: any, opts: any) => {
        if (stored.has(opts.jobId)) return stored.get(opts.jobId);
        const job = { id: opts.jobId, state: 'delayed', data, opts };
        stored.set(opts.jobId, job);
        return job;
      }),
    });
    const assignmentRepository = {
      find: jest.fn().mockResolvedValue(assignments),
      findOne: jest.fn().mockResolvedValue(assignments[0]),
    };
    const service = new ShiftReminderService(
      queue as any,
      assignmentRepository as any,
    );
    const loggerError = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation();

    await expect(
      service.scheduleAssignmentReminders(['assignment-1', 'assignment-2']),
    ).resolves.toEqual({ requested: 2, loaded: 2, enqueued: 1 });

    expect(stored.has('reminder_v2_assignment-2')).toBe(true);
    expect(stored.has('reminder_v2_assignment-1')).toBe(true);
    expect(stored.has('reminder_v2_assignment-1_successor')).toBe(true);
    expect(stored.size).toBe(3);
    expect(loggerError).toHaveBeenCalledWith(
      'Some shift reminders could not be reconciled',
    );
  });

  it('reconciles approved, non-approved and missing assignments without per-id reads', async () => {
    const approved = authoritativeAssignment(
      'assignment-approved',
      '2030-01-01',
      '09:00:00',
      { type: '15m' },
    );
    const cancelled = {
      ...authoritativeAssignment(
        'assignment-cancelled',
        '2030-01-01',
        '10:00:00',
        { type: '30m' },
      ),
      status: 'CANCELLED',
    };
    const assignmentRepository = {
      find: jest.fn().mockResolvedValue([approved, cancelled]),
      findOne: jest.fn(),
    };
    const queue = withMutationLock({
      add: jest.fn(),
      remove: jest.fn().mockResolvedValue(0),
      getJob: jest.fn().mockResolvedValue(undefined),
    });
    const service = new ShiftReminderService(
      queue as any,
      assignmentRepository as any,
    );

    await expect(
      service.scheduleAssignmentReminders([
        'assignment-approved',
        'assignment-cancelled',
        'assignment-missing',
      ]),
    ).resolves.toEqual({ requested: 3, loaded: 2, enqueued: 1 });

    expect(assignmentRepository.find).toHaveBeenCalledTimes(1);
    expect(
      assignmentRepository.find.mock.calls[0][0].where.status,
    ).toBeUndefined();
    expect(assignmentRepository.findOne).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][2].jobId).toBe(
      'reminder_v2_assignment-approved',
    );
    expect(queue.remove).toHaveBeenCalledWith(
      'reminder_v2_assignment-cancelled',
    );
    expect(queue.remove).toHaveBeenCalledWith('reminder_v2_assignment-missing');
  });

  it('keeps all-missing and non-approved high-bound batches at one query per chunk', async () => {
    const assignmentRepository = {
      findOne: jest.fn(),
      find: jest.fn(async (options) => {
        const requestedIds = options.where.id._value as string[];
        return requestedIds
          .filter((id) => Number(id.replace('assignment-', '')) % 2 === 0)
          .map((id) => ({
            ...authoritativeAssignment(id, '2099-01-01', '09:00:00', {
              type: '15m',
            }),
            status: 'PENDING',
          }));
      }),
    };
    let activeRemovals = 0;
    let maximumRemovals = 0;
    const queue = withMutationLock({
      add: jest.fn(),
      remove: jest.fn(async () => {
        activeRemovals += 1;
        maximumRemovals = Math.max(maximumRemovals, activeRemovals);
        await Promise.resolve();
        activeRemovals -= 1;
        return 0;
      }),
      getJob: jest.fn(),
    });
    const service = new ShiftReminderService(
      queue as any,
      assignmentRepository as any,
    );
    const ids = Array.from(
      { length: 10000 },
      (_, index) => `assignment-${index}`,
    );

    await expect(service.scheduleAssignmentReminders(ids)).resolves.toEqual({
      requested: 10000,
      loaded: 5000,
      enqueued: 0,
    });

    expect(assignmentRepository.find).toHaveBeenCalledTimes(100);
    expect(assignmentRepository.findOne).not.toHaveBeenCalled();
    expect(
      assignmentRepository.find.mock.calls.every(
        ([options]) => options.where.status === undefined,
      ),
    ).toBe(true);
    expect(queue.add).not.toHaveBeenCalled();
    expect(queue.getJob).not.toHaveBeenCalled();
    expect(queue.remove).toHaveBeenCalledTimes(35000);
    expect(maximumRemovals).toBeLessThanOrEqual(10);
  });

  it('loads and enqueues 10000 reminders in sequential bounded chunks', async () => {
    const assignmentRepository = {
      findOne: jest.fn(),
      find: jest.fn(async (options) => {
        const requestedIds = options.where.id._value as string[];
        return requestedIds.map((id) => {
          const sequence = Number(id.replace('assignment-', ''));
          return {
            id,
            status: 'APPROVED',
            shiftSlot: {
              id: `slot-${sequence}`,
              workDate: '2099-01-01',
              startTime: '09:00:00',
              cycle: { status: 'ACTIVE', scheduledStopAt: null },
              workShift: { id: `shift-${sequence}`, startTime: '09:00:00' },
            },
            employee: {
              id: `employee-${sequence}`,
              storeId: 'store-1',
              reminderSettings: { type: '15m' },
            },
          };
        });
      }),
    };
    let activeAdds = 0;
    let maximumAdds = 0;
    const queue = withMutationLock({
      add: jest.fn(async () => {
        activeAdds += 1;
        maximumAdds = Math.max(maximumAdds, activeAdds);
        await Promise.resolve();
        activeAdds -= 1;
      }),
      remove: jest.fn().mockResolvedValue(0),
      getJob: jest.fn().mockResolvedValue(undefined),
      addBulk: jest.fn(),
    });
    const service = new ShiftReminderService(
      queue as any,
      assignmentRepository as any,
    );
    const ids = Array.from(
      { length: 10000 },
      (_, index) => `assignment-${index}`,
    );

    await expect(service.scheduleAssignmentReminders(ids)).resolves.toEqual({
      requested: 10000,
      loaded: 10000,
      enqueued: 10000,
    });

    expect(assignmentRepository.find).toHaveBeenCalledTimes(100);
    expect(assignmentRepository.findOne).not.toHaveBeenCalled();
    expect(
      assignmentRepository.find.mock.calls.every(
        ([options]) =>
          options.relations.join(',') ===
          'shiftSlot,shiftSlot.workShift,shiftSlot.cycle,employee',
      ),
    ).toBe(true);
    expect(queue.addBulk).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(10000);
    expect(queue.remove).toHaveBeenCalledTimes(50000);
    expect(maximumAdds).toBeLessThanOrEqual(10);
  });

  it('cancels stable v2 and known legacy ids with sequential bounded work', async () => {
    const assignments = ['assignment-1', 'assignment-2'].map((id, index) => ({
      id,
      shiftSlot: {
        id: `slot-${index + 1}`,
        workShift: { id: `shift-${index + 1}` },
      },
      employee: { id: `employee-${index + 1}` },
    }));
    const assignmentRepository = {
      find: jest.fn().mockResolvedValue(assignments),
    };
    let activeRemovals = 0;
    let maximumRemovals = 0;
    const queue = withMutationLock({
      remove: jest.fn(async () => {
        activeRemovals += 1;
        maximumRemovals = Math.max(maximumRemovals, activeRemovals);
        await Promise.resolve();
        activeRemovals -= 1;
        return 1;
      }),
    });
    const service = new ShiftReminderService(
      queue as any,
      assignmentRepository as any,
    );

    await expect(
      service.cancelAssignmentReminders(['assignment-1', 'assignment-2']),
    ).resolves.toEqual({ requested: 2, loaded: 2, cancelled: 2 });

    expect(queue.remove).toHaveBeenCalledTimes(10);
    expect(queue.remove).toHaveBeenCalledWith('reminder_v2_assignment-1');
    expect(queue.remove).toHaveBeenCalledWith(
      'reminder_assignment-1_employee-1',
    );
    expect(maximumRemovals).toBe(1);
  });
});
