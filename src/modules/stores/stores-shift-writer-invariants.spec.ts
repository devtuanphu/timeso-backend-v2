import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EmployeeTerminationReason } from './entities/employee-termination-reason.entity';
import {
  EmployeeProfile,
  EmploymentStatus,
} from './entities/employee-profile.entity';
import { Store } from './entities/store.entity';
import { StoreTimekeepingSetting } from './entities/store-timekeeping-setting.entity';
import { WorkShift } from './entities/work-shift.entity';
import {
  ShiftAssignment,
  ShiftSwap,
} from './entities/shift-management.entity';
import { EmployeeLeaveRequest } from './entities/employee-leave-request.entity';
import { ShiftChangeRequest } from './entities/shift-change-request.entity';
import { StoresService } from './stores.service';
import { KpiApprovalRequest } from './entities/kpi-approval-request.entity';
import { SalaryAdvanceRequest } from './entities/salary-advance-request.entity';

const rawQb = (rows: any[], clauses: string[] = []) => {
  const qb: any = {};
  for (const method of [
    'innerJoin',
    'leftJoin',
    'select',
    'addSelect',
  ]) {
    qb[method] = jest.fn(() => qb);
  }
  qb.where = jest.fn((clause: string) => {
    clauses.push(clause);
    return qb;
  });
  qb.andWhere = jest.fn((clause: string) => {
    clauses.push(clause);
    return qb;
  });
  qb.getRawMany = jest.fn(async () => rows);
  return qb;
};

describe('StoresService shift predicate writers', () => {
  const createService = () => {
    const service = Object.create(StoresService.prototype) as StoresService;
    (service as any).storeRepository = {
      findOne: jest.fn(async () => ({
        id: 'store-1',
        ownerAccountId: 'owner-1',
      })),
    };
    (service as any).terminationReasonRepository = {
      findOne: jest.fn(async () => ({ id: 'reason-1', storeId: 'store-1' })),
    };
    (service as any).timekeepingSettingRepository = {
      findOne: jest.fn(async () => null),
    };
    (service as any).workShiftRepository = {
      find: jest.fn(async () => []),
    };
    return service;
  };

  it('locks the employee store before authoritative termination checks and writes', async () => {
    const service = createService();
    (service as any).profileRepository = {
      findOne: jest.fn(async () => ({ id: 'employee-1', storeId: 'store-1' })),
    };
    const manager = {
      query: jest.fn(async () => []),
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === EmployeeProfile) {
          return {
            id: 'employee-1',
            storeId: 'store-1',
            employmentStatus: EmploymentStatus.ACTIVE,
          };
        }
        if (entity === Store) {
          return { id: 'store-1', ownerAccountId: 'owner-1' };
        }
        if (entity === EmployeeTerminationReason) {
          return { id: 'reason-1', storeId: 'store-1' };
        }
        return null;
      }),
      save: jest.fn(async (_entity: unknown, value: unknown) => value),
      softDelete: jest.fn(async () => ({ affected: 1 })),
      // Termination withdraws future shifts first; nothing to cancel here.
      getRepository: () => ({
        createQueryBuilder: () => rawQb([]),
        update: jest.fn(),
      }),
    };
    (service as any).dataSource = {
      transaction: jest.fn(async (callback: (value: any) => unknown) =>
        callback(manager),
      ),
    };

    await service.deleteEmployee('employee-1', 'reason-1', 'owner-1');

    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      ['timeso:shift-availability:store:store-1'],
    );
    expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
      manager.findOne.mock.invocationCallOrder[0],
    );
    expect(manager.save).toHaveBeenCalledWith(
      EmployeeProfile,
      expect.objectContaining({
        employmentStatus: EmploymentStatus.TERMINATED,
        terminationReasonId: 'reason-1',
      }),
    );
    expect(manager.softDelete).toHaveBeenCalledWith(EmployeeProfile, {
      id: 'employee-1',
      storeId: 'store-1',
    });
  });

  it('rechecks owner and store-scoped termination reason after the lock', async () => {
    const service = createService();
    (service as any).profileRepository = {
      findOne: jest.fn(async () => ({ id: 'employee-1', storeId: 'store-1' })),
    };
    const manager = {
      query: jest.fn(async () => []),
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === EmployeeProfile) {
          return { id: 'employee-1', storeId: 'store-1' };
        }
        if (entity === Store) {
          return { id: 'store-1', ownerAccountId: 'owner-2' };
        }
        return null;
      }),
      save: jest.fn(),
      softDelete: jest.fn(),
      getRepository: () => ({
        createQueryBuilder: () => rawQb([]),
        update: jest.fn(),
      }),
    };
    (service as any).dataSource = {
      transaction: jest.fn(async (callback: (value: any) => unknown) =>
        callback(manager),
      ),
    };

    await expect(
      service.deleteEmployee('employee-1', 'reason-1', 'owner-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.softDelete).not.toHaveBeenCalled();
  });

  it('cancels not-yet-started future shifts before soft-deleting the leaver', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    // 12:00 in Vietnam on 2026-09-22.
    jest.setSystemTime(new Date('2026-09-22T05:00:00.000Z'));
    try {
      const service = createService();
      (service as any).profileRepository = {
        findOne: jest.fn(async () => ({ id: 'employee-1', storeId: 'store-1' })),
      };
      const clauses: string[] = [];
      const update = jest.fn(async () => ({ affected: 2 }));
      const leaveUpdate = jest.fn(async () => ({ affected: 1 }));
      const changeUpdate = jest.fn(async () => ({ affected: 1 }));
      const swapUpdate = jest.fn(async () => ({ affected: 1 }));
      const kpiUpdate = jest.fn(async () => ({ affected: 1 }));
      const advanceUpdate = jest.fn(async () => ({ affected: 1 }));
      const manager = {
        query: jest.fn(async () => []),
        findOne: jest.fn(async (entity: unknown) => {
          if (entity === EmployeeProfile) {
            return {
              id: 'employee-1',
              storeId: 'store-1',
              employmentStatus: EmploymentStatus.ACTIVE,
            };
          }
          if (entity === Store) return { id: 'store-1', ownerAccountId: 'owner-1' };
          if (entity === EmployeeTerminationReason) {
            return { id: 'reason-1', storeId: 'store-1' };
          }
          return null;
        }),
        save: jest.fn(async (_entity: unknown, value: unknown) => value),
        softDelete: jest.fn(async () => ({ affected: 1 })),
        getRepository: jest.fn((entity: unknown) => {
          if (entity === EmployeeLeaveRequest) return { update: leaveUpdate };
          if (entity === ShiftChangeRequest) return { update: changeUpdate };
          if (entity === ShiftSwap) return { update: swapUpdate };
          if (entity === KpiApprovalRequest) return { update: kpiUpdate };
          if (entity === SalaryAdvanceRequest) return { update: advanceUpdate };
          expect(entity).toBe(ShiftAssignment);
          return {
            createQueryBuilder: () =>
              rawQb(
                [
                  // Tomorrow, approved.
                  { id: 'future-approved', workDate: '2026-09-23', slotStartTime: '08:00', shiftStartTime: null },
                  // Later today, pending; time from the work shift.
                  { id: 'later-today-pending', workDate: '2026-09-22', slotStartTime: null, shiftStartTime: '18:00:00' },
                  // Started earlier today: left for the absence reconcile.
                  { id: 'started-today', workDate: '2026-09-22', slotStartTime: '07:00', shiftStartTime: null },
                ],
                clauses,
              ),
            update,
          };
        }),
      };
      (service as any).dataSource = {
        transaction: jest.fn(async (callback: (value: any) => unknown) =>
          callback(manager),
        ),
      };

      await service.deleteEmployee('employee-1', 'reason-1', 'owner-1');

      expect(update).toHaveBeenCalledTimes(1);
      const [criteria, changes] = (update.mock.calls[0] as any[]);
      expect(criteria.id.value).toEqual(['future-approved', 'later-today-pending']);
      expect(changes).toEqual({ status: 'CANCELLED' });
      // Checked-in rows and past days are excluded in SQL.
      expect(clauses).toEqual(
        expect.arrayContaining([
          'a.checkInTime IS NULL',
          'slot.workDate >= :today',
          'a.status IN (:...statuses)',
        ]),
      );
      expect(update.mock.invocationCallOrder[0]).toBeLessThan(
        manager.softDelete.mock.invocationCallOrder[0],
      );

      // The leaver's PENDING requests are closed in the same transaction:
      // leave and shift-change requests CANCELLED, swaps (no CANCELLED
      // status) REJECTED whether the leaver asked or was the target.
      expect(leaveUpdate).toHaveBeenCalledWith(
        { employeeProfileId: 'employee-1', status: 'PENDING' },
        { status: 'CANCELLED' },
      );
      expect(changeUpdate).toHaveBeenCalledWith(
        { employeeProfileId: 'employee-1', status: 'PENDING' },
        { status: 'CANCELLED' },
      );
      expect(swapUpdate).toHaveBeenCalledTimes(2);
      expect(swapUpdate).toHaveBeenCalledWith(
        { requestedByEmployeeId: 'employee-1', status: 'PENDING' },
        expect.objectContaining({ status: 'REJECTED' }),
      );
      expect(swapUpdate).toHaveBeenCalledWith(
        { toEmployeeId: 'employee-1', status: 'PENDING' },
        expect.objectContaining({ status: 'REJECTED' }),
      );
      // KPI approvals have no CANCELLED status: closed as REJECTED. Pending
      // salary advances (never paid) are CANCELLED; decided ones untouched.
      expect(kpiUpdate).toHaveBeenCalledWith(
        { employeeProfileId: 'employee-1', status: 'Chờ duyệt' },
        { status: 'Từ chối', note: 'Nhân viên đã nghỉ việc' },
      );
      expect(advanceUpdate).toHaveBeenCalledWith(
        { employeeProfileId: 'employee-1', status: 'Chờ duyệt' },
        { status: 'Đã hủy' },
      );
      for (const fn of [
        leaveUpdate,
        changeUpdate,
        swapUpdate,
        kpiUpdate,
        advanceUpdate,
      ]) {
        expect(fn.mock.invocationCallOrder[0]).toBeLessThan(
          manager.softDelete.mock.invocationCallOrder[0],
        );
      }
      expect((service as any).dataSource.transaction).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // Chủ cửa hàng cho phép trùng tên ca miễn khác ngày; ca mẫu trong cài đặt
  // chấm công không gắn ngày nên không còn bị chặn vì trùng tên. Tên rỗng vẫn bị chặn.
  it('allows reactivating a timekeeping shift that shares an active name, but not an empty name', async () => {
    const service = createService();
    const manager = {
      query: jest.fn(async () => []),
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === Store) {
          return { id: 'store-1', ownerAccountId: 'owner-1' };
        }
        if (entity === StoreTimekeepingSetting) {
          return { id: 'setting-1', storeId: 'store-1' };
        }
        return null;
      }),
      find: jest.fn(async (entity: unknown) =>
        entity === WorkShift
          ? [
              {
                id: 'shift-1',
                storeId: 'store-1',
                shiftName: 'Ca Sáng',
                startTime: '07:00',
                endTime: '11:00',
                isActive: true,
              },
              {
                id: 'shift-2',
                storeId: 'store-1',
                shiftName: 'Ca chiều',
                startTime: '12:00',
                endTime: '16:00',
                isActive: false,
              },
            ]
          : [],
      ),
      update: jest.fn(),
      save: jest.fn(),
    };
    (service as any).dataSource = {
      transaction: jest.fn(async (callback: (value: any) => unknown) =>
        callback(manager),
      ),
    };

    await expect(
      service.upsertTimekeepingSetting(
        'store-1',
        {
          shifts: [
            {
              id: 'shift-2',
              shiftName: '   ',
              isActive: true,
            },
          ],
        } as any,
        'owner-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();

    await expect(
      service.upsertTimekeepingSetting(
        'store-1',
        {
          shifts: [
            {
              id: 'shift-2',
              shiftName: '  ca   sáng ',
              isActive: true,
            },
          ],
        } as any,
        'owner-1',
      ),
    ).resolves.not.toThrow();
  });

  it('rejects a timekeeping shift id outside the authoritative store set', async () => {
    const service = createService();
    const manager = {
      query: jest.fn(async () => []),
      findOne: jest.fn(async (entity: unknown) =>
        entity === Store ? { id: 'store-1', ownerAccountId: 'owner-1' } : null,
      ),
      find: jest.fn(async () => []),
      update: jest.fn(),
      save: jest.fn(),
    };
    (service as any).dataSource = {
      transaction: jest.fn(async (callback: (value: any) => unknown) =>
        callback(manager),
      ),
    };

    await expect(
      service.upsertTimekeepingSetting(
        'store-1',
        { shifts: [{ id: 'other-store-shift', isActive: true }] } as any,
        'owner-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('reschedules future inherited-time assignments only after bulk timekeeping commit', async () => {
    const service = createService();
    const setting = { id: 'setting-1', storeId: 'store-1' };
    let committed = false;
    const scheduleAssignmentReminders = jest.fn(async () => {
      expect(committed).toBe(true);
    });
    (service as any).shiftReminderService = {
      scheduleAssignmentReminders,
    };
    const manager = {
      query: jest.fn(async () => []),
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === Store) {
          return { id: 'store-1', ownerAccountId: 'owner-1' };
        }
        if (entity === StoreTimekeepingSetting) return setting;
        return null;
      }),
      find: jest.fn(async (entity: unknown) => {
        if (entity === WorkShift) {
          return [
            {
              id: 'shift-1',
              storeId: 'store-1',
              shiftName: 'Ca sáng',
              startTime: '08:00:00',
              endTime: '12:00:00',
              isActive: true,
            },
          ];
        }
        if (entity === ShiftAssignment) {
          return [
            {
              id: 'assignment-1',
              shiftSlot: {
                id: 'slot-1',
                workDate: '2099-01-01',
                startTime: null,
                workShift: { id: 'shift-1', startTime: '10:00:00' },
              },
            },
          ];
        }
        return [];
      }),
      update: jest.fn(async () => ({ affected: 1 })),
      save: jest.fn(async (_entity: unknown, value: unknown) => value),
    };
    (service as any).dataSource = {
      transaction: jest.fn(async (callback: (value: any) => unknown) => {
        const result = await callback(manager);
        committed = true;
        return result;
      }),
    };

    await expect(
      service.upsertTimekeepingSetting(
        'store-1',
        { shifts: [{ id: 'shift-1', startTime: '10:00:00' }] } as any,
        'owner-1',
      ),
    ).resolves.toBe(setting);

    expect(manager.find).toHaveBeenCalledWith(
      ShiftAssignment,
      expect.objectContaining({
        relations: ['shiftSlot', 'shiftSlot.workShift'],
        select: ['id'],
      }),
    );
    expect(scheduleAssignmentReminders).toHaveBeenCalledWith(['assignment-1']);
  });

  it('does not touch reminder queues for unrelated timekeeping fields', async () => {
    const service = createService();
    const setting = { id: 'setting-1', storeId: 'store-1' };
    const scheduleAssignmentReminders = jest.fn();
    (service as any).shiftReminderService = {
      scheduleAssignmentReminders,
    };
    const manager = {
      query: jest.fn(async () => []),
      findOne: jest.fn(async (entity: unknown) =>
        entity === Store
          ? { id: 'store-1', ownerAccountId: 'owner-1' }
          : setting,
      ),
      find: jest.fn(async () => []),
      update: jest.fn(),
      save: jest.fn(async () => setting),
    };
    (service as any).dataSource = {
      transaction: jest.fn(async (callback: (value: any) => unknown) =>
        callback(manager),
      ),
    };

    await service.upsertTimekeepingSetting(
      'store-1',
      { allowLateCheckIn: true } as any,
      'owner-1',
    );

    expect(scheduleAssignmentReminders).not.toHaveBeenCalled();
    expect(manager.find).toHaveBeenCalledTimes(1);
  });

  it('keeps a committed timekeeping update when reminder replacement fails', async () => {
    const service = createService();
    const setting = { id: 'setting-1', storeId: 'store-1' };
    const logError = jest.fn();
    (service as any).logger = { error: logError };
    (service as any).shiftReminderService = {
      scheduleAssignmentReminders: jest
        .fn()
        .mockRejectedValue(new Error('redis sensitive detail')),
    };
    const manager = {
      query: jest.fn(async () => []),
      findOne: jest.fn(async (entity: unknown) =>
        entity === Store
          ? { id: 'store-1', ownerAccountId: 'owner-1' }
          : setting,
      ),
      find: jest.fn(async (entity: unknown) => {
        if (entity === WorkShift) {
          return [
            {
              id: 'shift-1',
              shiftName: 'Ca sáng',
              startTime: '08:00:00',
              endTime: '12:00:00',
              isActive: true,
            },
          ];
        }
        return [
          {
            id: 'assignment-1',
            shiftSlot: {
              workDate: '2099-01-01',
              startTime: null,
              workShift: { startTime: '10:00:00' },
            },
          },
        ];
      }),
      update: jest.fn(async () => ({ affected: 1 })),
      save: jest.fn(async () => setting),
    };
    (service as any).dataSource = {
      transaction: jest.fn(async (callback: (value: any) => unknown) =>
        callback(manager),
      ),
    };

    await expect(
      service.upsertTimekeepingSetting(
        'store-1',
        { shifts: [{ id: 'shift-1', startTime: '10:00:00' }] } as any,
        'owner-1',
      ),
    ).resolves.toBe(setting);
    expect(logError).toHaveBeenCalledWith(
      'Failed to reschedule reminders after timekeeping update',
    );
    expect(logError.mock.calls.flat().join(' ')).not.toContain('sensitive');
  });

  it('reuses an equivalent active default-name shift when initializing a legacy store', async () => {
    const service = createService();
    const existingMorning = {
      id: 'shift-existing',
      storeId: 'store-1',
      shiftName: '  CA SÁNG   (FULLTIME) ',
      startTime: '07:00',
      endTime: '17:00',
      isActive: true,
    };
    const shifts: any[] = [existingMorning];
    let setting: any = null;
    let sequence = 0;
    (service as any).timekeepingSettingRepository = {
      findOne: jest.fn(async () => setting),
    };
    (service as any).workShiftRepository = {
      find: jest.fn(async () => [...shifts]),
    };
    const manager = {
      query: jest.fn(async () => []),
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === Store) {
          return { id: 'store-1', ownerAccountId: 'owner-1' };
        }
        if (entity === StoreTimekeepingSetting) return setting;
        return null;
      }),
      find: jest.fn(async (entity: unknown) =>
        entity === WorkShift ? [...shifts] : [],
      ),
      create: jest.fn((_entity: unknown, value: any) => ({
        id: `generated-${++sequence}`,
        ...value,
      })),
      save: jest.fn(async (entity: unknown, value: any) => {
        if (entity === WorkShift) shifts.push(value);
        if (entity === StoreTimekeepingSetting) setting = value;
        return value;
      }),
    };
    (service as any).dataSource = {
      transaction: jest.fn(async (callback: (value: any) => unknown) =>
        callback(manager),
      ),
    };

    const result = await service.getTimekeepingSetting('store-1', 'owner-1');

    expect(result.shifts).toHaveLength(3);
    expect(
      shifts.filter(
        (shift) =>
          shift.shiftName
            .normalize('NFKC')
            .trim()
            .replace(/\s+/g, ' ')
            .toLowerCase() === 'ca sáng (fulltime)',
      ),
    ).toHaveLength(1);
    expect(setting).toEqual(expect.objectContaining({ storeId: 'store-1' }));
    expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
      manager.findOne.mock.invocationCallOrder[0],
    );
  });

  it('serializes concurrent legacy fallback calls without double initialization', async () => {
    const service = createService();
    const state: { setting: any; shifts: any[]; sequence: number } = {
      setting: null,
      shifts: [],
      sequence: 0,
    };
    let transactionTail = Promise.resolve();
    (service as any).timekeepingSettingRepository = {
      findOne: jest.fn(async () => state.setting),
    };
    (service as any).workShiftRepository = {
      find: jest.fn(async () => [...state.shifts]),
    };
    const transaction = jest.fn(async (callback: (manager: any) => unknown) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => (release = resolve));
      await previous;
      const manager = {
        query: jest.fn(async () => []),
        findOne: jest.fn(async (entity: unknown) => {
          if (entity === Store) {
            return { id: 'store-1', ownerAccountId: 'owner-1' };
          }
          if (entity === StoreTimekeepingSetting) return state.setting;
          return null;
        }),
        find: jest.fn(async (entity: unknown) =>
          entity === WorkShift ? [...state.shifts] : [],
        ),
        create: jest.fn((_entity: unknown, value: any) => ({
          id: `generated-${++state.sequence}`,
          ...value,
        })),
        save: jest.fn(async (entity: unknown, value: any) => {
          if (entity === WorkShift) state.shifts.push(value);
          if (entity === StoreTimekeepingSetting) state.setting = value;
          return value;
        }),
      };
      try {
        return await callback(manager);
      } finally {
        release();
      }
    });
    (service as any).dataSource = { transaction };

    const [first, second] = await Promise.all([
      service.getTimekeepingSetting('store-1', 'owner-1'),
      service.getTimekeepingSetting('store-1', 'owner-1'),
    ]);

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(state.shifts).toHaveLength(3);
    expect(first.shifts).toHaveLength(3);
    expect(second.shifts).toHaveLength(3);
    expect(state.setting).toEqual(
      expect.objectContaining({ storeId: 'store-1' }),
    );
  });

  it('rejects wrong-owner settings access before opening an advisory transaction', async () => {
    const service = createService();
    (service as any).storeRepository = {
      findOne: jest.fn(async () => ({
        id: 'store-1',
        ownerAccountId: 'owner-1',
      })),
    };
    (service as any).profileRepository = { findOne: jest.fn(async () => null) };
    const transaction = jest.fn();
    (service as any).dataSource = { transaction };

    await expect(
      service.getTimekeepingSetting('store-1', 'wrong-owner'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('allows active same-store staff to read transient defaults without locking or persisting', async () => {
    const service = createService();
    (service as any).storeRepository = {
      findOne: jest.fn(async () => ({
        id: 'store-1',
        ownerAccountId: 'owner-1',
      })),
    };
    (service as any).profileRepository = {
      findOne: jest.fn(async () => ({ id: 'employee-1' })),
    };
    (service as any).timekeepingSettingRepository = {
      findOne: jest.fn(async () => null),
    };
    (service as any).workShiftRepository = {
      find: jest.fn(async () => [{ id: 'shift-1', storeId: 'store-1' }]),
    };
    const transaction = jest.fn();
    (service as any).dataSource = { transaction };

    const result = await service.getTimekeepingSetting(
      'store-1',
      'staff-account',
    );

    expect(result).toEqual(
      expect.objectContaining({
        storeId: 'store-1',
        requireLocation: true,
        shifts: [{ id: 'shift-1', storeId: 'store-1' }],
      }),
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a wrong-owner WorkShift writer before transaction or lock acquisition', async () => {
    const service = createService();
    (service as any).storeRepository = {
      findOne: jest.fn(async () => ({
        id: 'store-1',
        ownerAccountId: 'owner-1',
      })),
    };
    const transaction = jest.fn();
    (service as any).dataSource = { transaction };

    await expect(
      service.createWorkShift(
        'store-1',
        { shiftName: 'Ca trái phép', startTime: '07:00', endTime: '11:00' },
        'wrong-owner',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('prechecks other owner-only settings, termination, slot and cycle writers before transactions', async () => {
    const service = createService();
    const transaction = jest.fn();
    (service as any).dataSource = { transaction };
    (service as any).profileRepository = {
      findOne: jest.fn(async () => ({ id: 'employee-1', storeId: 'store-1' })),
    };
    (service as any).shiftSlotRepository = {
      findOne: jest.fn(async () => ({
        id: 'slot-1',
        cycle: { id: 'cycle-1', storeId: 'store-1' },
      })),
    };
    (service as any).workCycleRepository = {
      findOne: jest.fn(async () => ({
        id: 'cycle-1',
        storeId: 'store-1',
        status: 'ACTIVE',
      })),
    };

    await expect(
      service.upsertTimekeepingSetting('store-1', {}, 'wrong-owner'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.deleteEmployee('employee-1', 'reason-1', 'wrong-owner'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.updateShiftSlot('slot-1', { note: 'x' }, 'wrong-owner'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.stopWorkCycle(
        'cycle-1',
        { stopImmediately: true },
        'wrong-owner',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rolls back defaults created before an incompatible active default shift is found', async () => {
    const service = createService();
    const state = {
      setting: null as any,
      shifts: [
        {
          id: 'incompatible-afternoon',
          storeId: 'store-1',
          shiftName: 'Ca chiều (fulltime)',
          startTime: '13:00',
          endTime: '21:00',
          isActive: true,
        },
      ] as any[],
      sequence: 0,
    };
    (service as any).storeRepository = {
      findOne: jest.fn(async () => ({
        id: 'store-1',
        ownerAccountId: 'owner-1',
      })),
    };
    (service as any).profileRepository = { findOne: jest.fn() };
    (service as any).timekeepingSettingRepository = {
      findOne: jest.fn(async () => state.setting),
    };
    (service as any).workShiftRepository = {
      find: jest.fn(async () => [...state.shifts]),
    };
    (service as any).dataSource = {
      transaction: jest.fn(async (callback: (manager: any) => unknown) => {
        const staged = structuredClone(state);
        const manager = {
          query: jest.fn(async () => []),
          findOne: jest.fn(async (entity: unknown) => {
            if (entity === Store) {
              return { id: 'store-1', ownerAccountId: 'owner-1' };
            }
            if (entity === StoreTimekeepingSetting) return staged.setting;
            return null;
          }),
          find: jest.fn(async (entity: unknown) =>
            entity === WorkShift ? [...staged.shifts] : [],
          ),
          create: jest.fn((_entity: unknown, value: any) => ({
            id: `generated-${++staged.sequence}`,
            ...value,
          })),
          save: jest.fn(async (entity: unknown, value: any) => {
            if (entity === WorkShift) staged.shifts.push(value);
            if (entity === StoreTimekeepingSetting) staged.setting = value;
            return value;
          }),
        };
        const result = await callback(manager);
        Object.assign(state, staged);
        return result;
      }),
    };

    await expect(
      service.getTimekeepingSetting('store-1', 'owner-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(state.setting).toBeNull();
    expect(state.shifts).toEqual([
      expect.objectContaining({ id: 'incompatible-afternoon' }),
    ]);
  });
});
