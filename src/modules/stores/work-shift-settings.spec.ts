import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { FindOperator } from 'typeorm';

import { CUSTOM_SHIFT_NOTE } from './custom-shift-request.utils';
import { CreateWorkShiftDto, UpdateWorkShiftDto } from './dto/work-shift.dto';
import { EmploymentStatus } from './entities/employee-profile.entity';
import {
  ShiftAssignmentStatus,
  ShiftSlot,
  WorkCycle,
  WorkCycleStatus,
} from './entities/shift-management.entity';
import { Store } from './entities/store.entity';
import { StoreTimekeepingSetting } from './entities/store-timekeeping-setting.entity';
import { WorkShift } from './entities/work-shift.entity';
import {
  StoresService,
  WORK_SHIFT_HAS_UPCOMING_ASSIGNMENTS,
  WORK_SHIFT_INACTIVE_CODE,
} from './stores.service';

/**
 * "Thiết lập ca làm và chấm công": the owner adds, edits and deletes shift
 * templates. Delete hides the shift (history keeps joining it), refuses while
 * upcoming days are booked, and removes upcoming empty days. The settings
 * list shows only active, non-"Khung giờ khác" shifts.
 */
const STORE = 'store-1';
const OWNER = 'owner-1';
const SHIFT = '11111111-1111-4111-8111-111111111111';
// 2026-10-01 10:00 in Vietnam (03:00 UTC).
const NOW = new Date('2026-10-01T03:00:00Z');

const shiftRow = (over: Partial<WorkShift> = {}): WorkShift =>
  ({
    id: SHIFT,
    storeId: STORE,
    shiftName: 'Ca sáng',
    startTime: '08:00:00',
    endTime: '12:00:00',
    isActive: true,
    note: null,
    ...over,
  }) as WorkShift;

const slot = (
  id: string,
  workDate: string,
  statuses: ShiftAssignmentStatus[] = [],
  startTime: string | null = null,
) =>
  ({
    id,
    workDate,
    startTime,
    workShiftId: SHIFT,
    assignments: statuses.map((status, index) => ({
      id: `${id}-a${index}`,
      status,
    })),
  }) as unknown as ShiftSlot;

function buildDeleteService(opts: {
  shift?: WorkShift | null;
  slots?: ShiftSlot[];
  storeOwner?: string;
}) {
  const service = Object.create(StoresService.prototype) as any;
  let committed = false;
  const manager = {
    query: jest.fn(async () => []),
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === Store) {
        return { id: STORE, ownerAccountId: opts.storeOwner ?? OWNER };
      }
      if (entity === WorkShift) {
        return opts.shift === undefined ? shiftRow() : opts.shift;
      }
      return null;
    }),
    find: jest.fn(async (entity: unknown) =>
      entity === ShiftSlot ? (opts.slots ?? []) : [],
    ),
    update: jest.fn(async () => ({ affected: 1 })),
    delete: jest.fn(async () => ({ affected: 1 })),
  };
  service.storeRepository = {
    findOne: jest.fn(async () => ({
      id: STORE,
      ownerAccountId: opts.storeOwner ?? OWNER,
    })),
  };
  service.dataSource = {
    transaction: jest.fn(async (callback: (m: any) => unknown) => {
      const result = await callback(manager);
      committed = true;
      return result;
    }),
  };
  service.logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
  const cancelAssignmentReminders = jest.fn(async () => {
    expect(committed).toBe(true);
  });
  service.shiftReminderService = { cancelAssignmentReminders };
  const record = jest.fn(async () => undefined);
  service.activityLogService = { record };
  return {
    service: service as StoresService,
    manager,
    cancelAssignmentReminders,
    record,
  };
}

describe('deleteWorkShift', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it('refuses a non-owner before opening a transaction', async () => {
    const { service } = buildDeleteService({ storeOwner: 'someone-else' });

    await expect(
      service.deleteWorkShift(STORE, SHIFT, OWNER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect((service as any).dataSource.transaction).not.toHaveBeenCalled();
  });

  it('refuses a missing account', async () => {
    const { service } = buildDeleteService({});
    await expect(
      service.deleteWorkShift(STORE, SHIFT, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s a shift of another store (looked up by id and store)', async () => {
    const { service, manager } = buildDeleteService({ shift: null });

    await expect(
      service.deleteWorkShift(STORE, SHIFT, OWNER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(manager.findOne).toHaveBeenCalledWith(
      WorkShift,
      expect.objectContaining({ where: { id: SHIFT, storeId: STORE } }),
    );
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('409s with the count while upcoming days hold seats, and changes nothing', async () => {
    const { service, manager, record } = buildDeleteService({
      slots: [
        slot('pending', '2026-10-02', [ShiftAssignmentStatus.PENDING]),
        slot('approved', '2026-10-03', [
          ShiftAssignmentStatus.CANCELLED,
          ShiftAssignmentStatus.APPROVED,
        ]),
        slot('empty', '2026-10-04'),
      ],
    });

    const error = await service
      .deleteWorkShift(STORE, SHIFT, OWNER)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: WORK_SHIFT_HAS_UPCOMING_ASSIGNMENTS,
      count: 2,
      message:
        'Ca còn 2 lịch sắp tới đã có nhân viên, hãy huỷ các lịch đó trước',
    });
    expect(manager.delete).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('hides the shift, removes upcoming empty days and keeps started ones', async () => {
    const { service, manager, cancelAssignmentReminders, record } =
      buildDeleteService({
        slots: [
          // Today 08:00 VN already started at 10:00: kept, even if booked.
          slot('started', '2026-10-01', [ShiftAssignmentStatus.APPROVED]),
          // Today 11:00 (slot's own time): upcoming, only a cancelled row.
          slot(
            'later-today',
            '2026-10-01',
            [ShiftAssignmentStatus.CANCELLED],
            '11:00:00',
          ),
          slot('tomorrow', '2026-10-02'),
        ],
      });

    const result = await service.deleteWorkShift(STORE, SHIFT, OWNER);

    expect(result).toEqual({
      id: SHIFT,
      deleted: true,
      alreadyDeleted: false,
      removedUpcomingSlots: 2,
    });
    // Lock first, then the authoritative owner check.
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`timeso:shift-availability:store:${STORE}`],
    );
    expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
      manager.findOne.mock.invocationCallOrder[0],
    );
    // Only VN-today-or-later slots of active/expired schedules are read.
    const [, options] = manager.find.mock.calls[0] as any[];
    expect(options.where.workShiftId).toBe(SHIFT);
    expect((options.where.workDate as FindOperator<string>).value).toBe(
      '2026-10-01',
    );
    expect(options.where.cycle.storeId).toBe(STORE);
    expect(options.where.cycle.status.value).toEqual([
      WorkCycleStatus.ACTIVE,
      WorkCycleStatus.EXPIRED,
    ]);
    expect(manager.delete).toHaveBeenCalledWith(ShiftSlot, [
      'later-today',
      'tomorrow',
    ]);
    // Hidden, not deleted: past slots, attendance and payroll keep joining it.
    expect(manager.update).toHaveBeenCalledWith(
      WorkShift,
      { id: SHIFT, storeId: STORE },
      { isActive: false },
    );
    expect(record).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        storeId: STORE,
        actorAccountId: OWNER,
        action: 'work_shift.deleted',
        resourceType: 'work_shift',
        resourceId: SHIFT,
        params: {
          shiftName: 'Ca sáng',
          startTime: '08:00',
          endTime: '12:00',
          count: 2,
        },
      }),
    );
    expect(cancelAssignmentReminders).toHaveBeenCalledWith(['later-today-a0']);
  });

  it('uses the Vietnam day just after midnight VN (still yesterday in UTC)', async () => {
    jest.setSystemTime(new Date('2026-10-01T17:30:00Z')); // 00:30 VN on 02/10
    const { service, manager } = buildDeleteService({
      shift: shiftRow({ startTime: '00:00:00', endTime: '06:00:00' }),
      slots: [
        // Started at 00:00 VN on 02/10: kept although booked.
        slot('night', '2026-10-02', [ShiftAssignmentStatus.APPROVED]),
        slot('next-night', '2026-10-03'),
      ],
    });

    await expect(service.deleteWorkShift(STORE, SHIFT, OWNER)).resolves.toEqual(
      expect.objectContaining({ removedUpcomingSlots: 1 }),
    );
    const [, options] = manager.find.mock.calls[0] as any[];
    expect(options.where.workDate.value).toBe('2026-10-02');
    expect(manager.delete).toHaveBeenCalledWith(ShiftSlot, 'next-night');
  });

  it('is idempotent: deleting an already hidden shift is a 200 no-op', async () => {
    const { service, manager, record, cancelAssignmentReminders } =
      buildDeleteService({ shift: shiftRow({ isActive: false }) });

    await expect(service.deleteWorkShift(STORE, SHIFT, OWNER)).resolves.toEqual(
      {
        id: SHIFT,
        deleted: true,
        alreadyDeleted: true,
        removedUpcomingSlots: 0,
      },
    );
    expect(manager.find).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.delete).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(cancelAssignmentReminders).not.toHaveBeenCalled();
  });

  it('keeps the committed delete when reminder cleanup fails', async () => {
    const { service } = buildDeleteService({
      slots: [
        slot('tomorrow', '2026-10-02', [ShiftAssignmentStatus.CANCELLED]),
      ],
    });
    (service as any).shiftReminderService.cancelAssignmentReminders = jest
      .fn()
      .mockRejectedValue(new Error('redis down'));

    await expect(service.deleteWorkShift(STORE, SHIFT, OWNER)).resolves.toEqual(
      expect.objectContaining({ deleted: true, removedUpcomingSlots: 1 }),
    );
    expect((service as any).logger.error).toHaveBeenCalled();
  });
});

describe('settings shift list', () => {
  const build = (shifts: Partial<WorkShift>[], customIds: string[] = []) => {
    const service = Object.create(StoresService.prototype) as any;
    service.workShiftRepository = {
      find: jest.fn(async () => shifts),
      query: jest.fn(async () => customIds.map((id) => ({ id }))),
    };
    return service as any;
  };

  it('lists active shifts without "Khung giờ khác" request shifts', async () => {
    const service = build(
      [
        { id: 'morning', shiftName: 'Ca sáng', isActive: true },
        { id: 'custom', shiftName: 'Khung giờ khác', isActive: true },
        // Defensive: an inactive row is dropped even if a query returns it.
        { id: 'hidden', shiftName: 'Ca cũ', isActive: false },
      ],
      ['custom'],
    );

    const result = await service.getWorkShifts(STORE);

    expect(result.map((shift) => shift.id)).toEqual(['morning']);
    expect(service.workShiftRepository.find).toHaveBeenCalledWith({
      where: { storeId: STORE, isActive: true },
      order: { startTime: 'ASC', shiftName: 'ASC' },
    });
    const [sql, params] = service.workShiftRepository.query.mock.calls[0];
    expect(sql).toContain("created_schedule_ref -> 'shiftIds'");
    expect(sql).toContain('ws.note = $2');
    expect(params).toEqual([STORE, CUSTOM_SHIFT_NOTE]);
  });

  it('skips the custom lookup when there is no active shift', async () => {
    const service = build([]);
    await expect(service.getWorkShifts(STORE)).resolves.toEqual([]);
    expect(service.workShiftRepository.query).not.toHaveBeenCalled();
  });

  it('applies the same list to GET timekeeping-settings', async () => {
    const service = build(
      [
        { id: 'morning', shiftName: 'Ca sáng', isActive: true },
        { id: 'custom', shiftName: 'Khung giờ khác 2', isActive: true },
      ],
      ['custom'],
    ) as any;
    service.storeRepository = {
      findOne: jest.fn(async () => ({ id: STORE, ownerAccountId: OWNER })),
    };
    service.timekeepingSettingRepository = {
      findOne: jest.fn(async () => ({ id: 'setting-1', storeId: STORE })),
    };

    const result = await service.getTimekeepingSetting(STORE, OWNER);

    expect(result.shifts.map((shift: WorkShift) => shift.id)).toEqual([
      'morning',
    ]);
  });
});

describe('upsertTimekeepingSetting shift entries', () => {
  const build = (customIds: string[] = []) => {
    const service = Object.create(StoresService.prototype) as any;
    const setting = { id: 'setting-1', storeId: STORE };
    service.storeRepository = {
      findOne: jest.fn(async () => ({ id: STORE, ownerAccountId: OWNER })),
    };
    service.shiftReminderService = { scheduleAssignmentReminders: jest.fn() };
    const manager = {
      query: jest.fn(async (sql: string) =>
        sql.includes('custom_shift_requests')
          ? customIds.map((id) => ({ id }))
          : [],
      ),
      findOne: jest.fn(async (entity: unknown) =>
        entity === Store
          ? { id: STORE, ownerAccountId: OWNER }
          : entity === StoreTimekeepingSetting
            ? setting
            : null,
      ),
      find: jest.fn(async (entity: unknown) =>
        entity === WorkShift
          ? [
              shiftRow(),
              shiftRow({
                id: 'custom',
                shiftName: 'Khung giờ khác',
                note: CUSTOM_SHIFT_NOTE,
              }),
            ]
          : [],
      ),
      update: jest.fn(async () => ({ affected: 1 })),
      save: jest.fn(async (_entity: unknown, value: unknown) => value),
    };
    service.dataSource = {
      transaction: jest.fn(async (callback: (m: any) => unknown) =>
        callback(manager),
      ),
    };
    return { service: service as StoresService, manager, setting };
  };

  it('saves only the settings when the client sends no shifts', async () => {
    const { service, manager, setting } = build();

    await expect(
      service.upsertTimekeepingSetting(
        STORE,
        { allowedLateMinutes: 10, requireLocation: false },
        OWNER,
      ),
    ).resolves.toBe(setting);

    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.save).toHaveBeenCalledWith(
      StoreTimekeepingSetting,
      expect.objectContaining({
        allowedLateMinutes: 10,
        requireLocation: false,
      }),
    );
    // No custom-shift lookup without shift entries.
    expect(
      manager.query.mock.calls.some(([sql]) =>
        String(sql).includes('custom_shift_requests'),
      ),
    ).toBe(false);
  });

  it('ignores an entry for a "Khung giờ khác" shift', async () => {
    const { service, manager } = build(['custom']);

    await service.upsertTimekeepingSetting(
      STORE,
      { shifts: [{ id: 'custom', startTime: '09:00' }] },
      OWNER,
    );

    expect(manager.update).not.toHaveBeenCalled();
  });

  it('rejects malformed or equal times for a visible shift', async () => {
    const { service, manager } = build();

    await expect(
      service.upsertTimekeepingSetting(
        STORE,
        { shifts: [{ id: SHIFT, startTime: '8h' }] },
        OWNER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.upsertTimekeepingSetting(
        STORE,
        { shifts: [{ id: SHIFT, startTime: '12:00' }] },
        OWNER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.upsertTimekeepingSetting(
        STORE,
        { shifts: [{ id: SHIFT, startTime: '25:00' }] },
        OWNER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  // Older owner builds send whatever was typed in the raw time inputs.
  it('pads free-typed H:mm times from older builds instead of failing the save', async () => {
    const { service, manager } = build();

    // "12:5" is not a time: the whole save is refused, nothing written.
    await expect(
      service.upsertTimekeepingSetting(
        STORE,
        { shifts: [{ id: SHIFT, startTime: ' 8:30', endTime: '12:5' }] },
        OWNER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();

    await expect(
      service.upsertTimekeepingSetting(
        STORE,
        { shifts: [{ id: SHIFT, startTime: '8:30', endTime: '13:00' }] },
        OWNER,
      ),
    ).resolves.toBeDefined();
    expect(manager.update).toHaveBeenCalledWith(
      WorkShift,
      { id: SHIFT, storeId: STORE },
      { startTime: '08:30:00', endTime: '13:00:00' },
    );
  });

  it('treats an echo of the stored times as no change', async () => {
    const { service, manager } = build();

    await expect(
      service.upsertTimekeepingSetting(
        STORE,
        {
          allowedLateMinutes: 5,
          shifts: [
            // The exact stored strings, and the same times as HH:mm.
            { id: SHIFT, startTime: '08:00:00', endTime: '12:00' },
          ],
        },
        OWNER,
      ),
    ).resolves.toBeDefined();
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.save).toHaveBeenCalledWith(
      StoreTimekeepingSetting,
      expect.objectContaining({ allowedLateMinutes: 5 }),
    );
  });
});

describe('createWorkShift / updateWorkShift validation', () => {
  const build = (existing: WorkShift | null = shiftRow()) => {
    const service = Object.create(StoresService.prototype) as any;
    service.storeRepository = {
      findOne: jest.fn(async () => ({ id: STORE, ownerAccountId: OWNER })),
    };
    service.workShiftRepository = {
      findOne: jest.fn(async () => (existing ? { id: existing.id } : null)),
    };
    service.logger = { error: jest.fn() };
    const manager = {
      query: jest.fn(
        async (_sql: string, _params?: unknown[]): Promise<any[]> => [],
      ),
      findOne: jest.fn(async (entity: unknown) =>
        entity === Store
          ? { id: STORE, ownerAccountId: OWNER }
          : entity === WorkShift
            ? existing
            : null,
      ),
      create: jest.fn((_entity: unknown, value: any) => ({
        id: 'new',
        ...value,
      })),
      save: jest.fn(async (_entity: unknown, value: unknown) => value),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    service.dataSource = {
      transaction: jest.fn(async (callback: (m: any) => unknown) =>
        callback(manager),
      ),
    };
    const reschedule = jest.fn(async () => undefined);
    service.rescheduleRemindersForShift = reschedule;
    return { service: service as StoresService, manager, reschedule };
  };

  it.each([
    [{ shiftName: '   ', startTime: '08:00', endTime: '12:00' }],
    [{ shiftName: 'x'.repeat(81), startTime: '08:00', endTime: '12:00' }],
    [{ shiftName: 'Ca', startTime: '8h', endTime: '12:00' }],
    [{ shiftName: 'Ca', startTime: '24:00', endTime: '12:00' }],
    [{ shiftName: 'Ca', startTime: '08:00', endTime: '08:00:00' }],
  ])('create rejects %j', async (body) => {
    const { service, manager } = build();
    await expect(
      service.createWorkShift(STORE, body as any, OWNER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('creates an overnight shift with a trimmed name', async () => {
    const { service, manager } = build();

    const created = await service.createWorkShift(
      STORE,
      { shiftName: '  Ca đêm ', startTime: '22:00', endTime: '06:00' },
      OWNER,
    );

    expect(created).toEqual(
      expect.objectContaining({
        storeId: STORE,
        shiftName: 'Ca đêm',
        startTime: '22:00:00',
        endTime: '06:00:00',
        isActive: true,
      }),
    );
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`timeso:shift-availability:store:${STORE}`],
    );
  });

  it('refuses to edit a deleted (hidden) shift', async () => {
    const { service, manager } = build(shiftRow({ isActive: false }));
    await expect(
      service.updateWorkShift(STORE, SHIFT, { shiftName: 'Ca mới' }, OWNER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('rejects an edit that makes start equal end (HH:mm vs HH:mm:ss)', async () => {
    const { service, manager } = build();
    await expect(
      service.updateWorkShift(STORE, SHIFT, { endTime: '08:00' }, OWNER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('applies the same-name-on-the-same-day rule on rename', async () => {
    const { service, manager } = build();
    manager.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT DISTINCT')) return [{ work_date: '2026-10-05' }];
      if (sql.includes('JOIN work_shifts ws')) {
        return [{ shift_name: 'Ca chiều', work_date: '2026-10-05' }];
      }
      return [];
    });

    await expect(
      service.updateWorkShift(
        STORE,
        SHIFT,
        { shiftName: ' ca  chiều ' },
        OWNER,
      ),
    ).rejects.toThrow('Đã có ca "Ca chiều" vào ngày 05/10/2026');
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('reschedules reminders when the end time changes, not on a rename', async () => {
    const { service, manager, reschedule } = build();

    await service.updateWorkShift(
      STORE,
      SHIFT,
      { shiftName: 'Ca sáng sớm', startTime: '08:00' },
      OWNER,
    );
    expect(reschedule).not.toHaveBeenCalled();
    expect(manager.update).toHaveBeenCalledWith(
      WorkShift,
      { id: SHIFT, storeId: STORE },
      { shiftName: 'Ca sáng sớm', startTime: '08:00:00' },
    );

    await service.updateWorkShift(STORE, SHIFT, { endTime: '13:00' }, OWNER);
    expect(reschedule).toHaveBeenCalledWith(SHIFT);
  });
});

describe('work-shift DTOs (global ValidationPipe settings)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const validate = (metatype: any, body: unknown) =>
    pipe.transform(body, { type: 'body', metatype });

  it('accepts the owner app payloads', async () => {
    await expect(
      validate(CreateWorkShiftDto, {
        shiftName: 'Ca sáng',
        startTime: '08:00',
        endTime: '12:00',
      }),
    ).resolves.toBeInstanceOf(CreateWorkShiftDto);
    await expect(
      validate(UpdateWorkShiftDto, {
        shiftName: 'Ca sáng',
        startTime: '08:00:00',
        endTime: '12:00',
        defaultMaxStaff: null,
      }),
    ).resolves.toBeInstanceOf(UpdateWorkShiftDto);
  });

  it.each([
    [CreateWorkShiftDto, { startTime: '08:00', endTime: '12:00' }],
    [
      CreateWorkShiftDto,
      { shiftName: '', startTime: '08:00', endTime: '12:00' },
    ],
    [
      CreateWorkShiftDto,
      { shiftName: 'x'.repeat(81), startTime: '08:00', endTime: '12:00' },
    ],
    [
      CreateWorkShiftDto,
      { shiftName: 'Ca', startTime: '8:00', endTime: '12:00' },
    ],
    [UpdateWorkShiftDto, { endTime: '12:60' }],
    // Hiding goes through DELETE only.
    [UpdateWorkShiftDto, { isActive: true }],
  ])('%p rejects %j', async (metatype, body) => {
    await expect(validate(metatype, body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('registration to a deleted (hidden) shift', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it('refuses a fixed registration for it', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.profileRepository = {
      findOne: jest.fn(async () => ({
        id: 'profile-1',
        storeId: STORE,
        accountId: 'staff-1',
        employmentStatus: EmploymentStatus.ACTIVE,
      })),
    };
    service.workShiftRepository = {
      findOne: jest.fn(async () => ({ id: SHIFT, isActive: false })),
    };
    service.shiftSlotRepository = { createQueryBuilder: jest.fn() };

    const error = await service
      .createShiftRegistration('staff-1', {
        storeId: STORE,
        employeeProfileId: 'profile-1',
        workShiftId: SHIFT,
        startDate: '2026-10-02',
        daysOfWeek: [1, 2],
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual(
      expect.objectContaining({ code: WORK_SHIFT_INACTIVE_CODE }),
    );
    expect(service.workShiftRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SHIFT, storeId: STORE } }),
    );
    expect(
      service.shiftSlotRepository.createQueryBuilder,
    ).not.toHaveBeenCalled();
  });

  it('refuses a staff self-registration to one of its slots', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.shiftSlotRepository = {
      findOne: jest.fn(async () => ({
        id: 'slot-1',
        cycle: { id: 'cycle-1', storeId: STORE },
      })),
    };
    service.profileRepository = {
      findOne: jest.fn(async () => ({ id: 'profile-1' })),
    };
    const lockedSlot = {
      id: 'slot-1',
      cycleId: 'cycle-1',
      workShiftId: SHIFT,
      workDate: '2026-10-05',
    };
    const qb: any = {};
    for (const method of ['setLock', 'where']) qb[method] = jest.fn(() => qb);
    qb.getOne = jest.fn(async () => lockedSlot);
    const manager = {
      query: jest.fn(async () => []),
      createQueryBuilder: jest.fn(() => qb),
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === WorkCycle) {
          return {
            id: 'cycle-1',
            storeId: STORE,
            status: WorkCycleStatus.ACTIVE,
          };
        }
        if (entity === WorkShift) return shiftRow({ isActive: false });
        return null;
      }),
      find: jest.fn(async () => []),
      save: jest.fn(),
    };
    service.dataSource = {
      transaction: jest.fn(async (callback: (m: any) => unknown) =>
        callback(manager),
      ),
    };

    const error = await service
      .registerToShiftSlot('slot-1', 'profile-1', undefined, false, 'staff-1')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual(
      expect.objectContaining({ code: WORK_SHIFT_INACTIVE_CODE }),
    );
    expect(manager.save).not.toHaveBeenCalled();
  });
});

describe('slot generation skips deleted (hidden) shifts', () => {
  it('does not generate template slots for a hidden shift', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.workCycleRepository = {
      findOne: jest.fn(async () => ({
        id: 'cycle-1',
        templates: [
          {
            workShiftId: 'hidden',
            dayOfWeek: 'FRIDAY',
            workShift: { id: 'hidden', isActive: false },
          },
          {
            workShiftId: 'kept',
            dayOfWeek: 'FRIDAY',
            workShift: { id: 'kept', isActive: true },
          },
        ],
      })),
    };
    service.shiftSlotRepository = {
      findOne: jest.fn(async () => null),
      create: jest.fn((value: unknown) => value),
      save: jest.fn(async (value: unknown) => value),
    };

    // 2026-10-02 is a Friday.
    const generated = await service.generateSlotsFromTemplate(
      'cycle-1',
      '2026-10-02',
      1,
    );

    expect(generated.map((row: any) => row.slot.workShiftId)).toEqual(['kept']);
  });
});

describe('hidden shifts in legacy cycle / manual slot writes', () => {
  const buildService = (shifts: Array<{ id: string; isActive: boolean }>) => {
    const service = Object.create(StoresService.prototype) as any;
    service.assertOwnerStoreAccess = jest.fn(async () => undefined);
    service.workShiftRepository = {
      find: jest.fn(async () => shifts),
    };
    return service;
  };

  it('refuses to create a work cycle on a deleted shift', async () => {
    const service = buildService([{ id: 'hidden', isActive: false }]);
    service.workCycleRepository = { findOne: jest.fn(), save: jest.fn() };

    await expect(
      service.createWorkCycle(
        STORE,
        {
          name: 'Tuần 1',
          cycleType: 'WEEKLY',
          startDate: '2026-10-05',
          workShiftIds: ['hidden'],
        },
        OWNER,
      ),
    ).rejects.toMatchObject({
      response: { code: WORK_SHIFT_INACTIVE_CODE },
    });
    expect(service.workCycleRepository.save).not.toHaveBeenCalled();
  });

  it('refuses manual slots on a deleted shift', async () => {
    const service = buildService([{ id: 'hidden', isActive: false }]);
    service.workCycleRepository = {
      findOne: jest.fn(async () => ({ id: 'cycle-1', storeId: STORE })),
    };
    service.shiftSlotRepository = { create: jest.fn(), save: jest.fn() };

    await expect(
      service.createShiftSlots(
        'cycle-1',
        [{ workShiftId: 'hidden', workDate: '2026-10-05' }],
        OWNER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.shiftSlotRepository.save).not.toHaveBeenCalled();
  });

  it('still accepts active shifts for cycles and slots', async () => {
    const service = buildService([{ id: 'kept', isActive: true }]);

    await expect(
      service.assertWorkShiftsBelongToStore(STORE, ['kept']),
    ).resolves.toBeUndefined();
  });

  it('lets a cycle keep its since-deleted shift but not switch to one', async () => {
    const service = buildService([{ id: 'hidden', isActive: false }]);
    service.getWorkCycleById = jest.fn(async () => ({ id: 'cycle-1' }));
    service.workCycleRepository = {
      findOne: jest.fn(async () => ({
        id: 'cycle-1',
        storeId: STORE,
        workShiftId: 'hidden',
      })),
      update: jest.fn(async () => undefined),
    };

    await service.updateWorkCycle(
      'cycle-1',
      { name: 'Đổi tên', workShiftId: 'hidden' },
      OWNER,
    );
    expect(service.workCycleRepository.update).toHaveBeenCalledWith('cycle-1', {
      name: 'Đổi tên',
      workShiftId: 'hidden',
    });

    service.workCycleRepository.findOne.mockResolvedValueOnce({
      id: 'cycle-1',
      storeId: STORE,
      workShiftId: 'other',
    });
    service.workCycleRepository.update.mockClear();
    await expect(
      service.updateWorkCycle('cycle-1', { workShiftId: 'hidden' }, OWNER),
    ).rejects.toMatchObject({ response: { code: WORK_SHIFT_INACTIVE_CODE } });
    expect(service.workCycleRepository.update).not.toHaveBeenCalled();
  });

  it('refuses a deleted shift as a new hire default shift', async () => {
    const service = Object.create(StoresService.prototype) as any;
    const manager = {
      // The shift belongs to the store, and it is hidden.
      exists: jest.fn(
        async (_entity: unknown, _options: { where: { isActive?: boolean } }) =>
          true,
      ),
    };

    await expect(
      service.assertEmployeeReferences(manager, STORE, {
        workShiftId: 'hidden',
      }),
    ).rejects.toMatchObject({ response: { code: WORK_SHIFT_INACTIVE_CODE } });

    manager.exists.mockImplementation(
      async (_entity: unknown, options: { where: { isActive?: boolean } }) =>
        options.where.isActive !== false,
    );
    await expect(
      service.assertEmployeeReferences(manager, STORE, { workShiftId: 'kept' }),
    ).resolves.toBeUndefined();
  });
});
