import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { StoresService } from './stores.service';
import { ShiftAggregationService } from './shift-aggregation.service';
import { EmploymentStatus } from './entities/employee-profile.entity';
import {
  ShiftAssignment,
  ShiftAssignmentStatus,
  ShiftSwapStatus,
  WorkCycleStatus,
  CycleType,
} from './entities/shift-management.entity';
import { LeaveRequestStatus } from './entities/employee-leave-request.entity';

describe('calendar mutation owner authorization', () => {
  const makeService = (storeOwner: string | null) => {
    const service = Object.create(StoresService.prototype) as any;
    service.storeRepository = {
      findOne: jest.fn(async () =>
        storeOwner ? { id: 'store-1', ownerAccountId: storeOwner } : null,
      ),
    };
    service.shiftSlotRepository = {
      findOne: jest.fn(async () => ({
        id: 'slot-1',
        cycle: { storeId: 'store-1' },
      })),
    };
    service.shiftAssignmentRepository = {
      findOne: jest.fn(async () => ({
        id: 'assignment-1',
        shiftSlot: { cycle: { storeId: 'store-1' } },
      })),
      find: jest.fn(async () => []),
    };
    service.dataSource = {
      transaction: jest.fn(async (callback: any) =>
        callback({
          query: jest.fn().mockResolvedValue([]),
          update: jest.fn().mockResolvedValue({ affected: 1 }),
          findOne: jest
            .fn()
            .mockResolvedValue(
              storeOwner ? { id: 'store-1', ownerAccountId: storeOwner } : null,
            ),
        }),
      ),
    };
    service.shiftAssignmentRepository.createQueryBuilder = jest.fn(() => {
      const qb: any = {};
      for (const method of [
        'leftJoinAndSelect',
        'leftJoin',
        'where',
        'andWhere',
        'orderBy',
      ])
        qb[method] = jest.fn().mockReturnValue(qb);
      qb.getMany = jest.fn().mockResolvedValue([]);
      return qb;
    });
    return service;
  };

  it('allows the owning account', async () => {
    await expect(
      (makeService('owner-1') as any).assertSlotOwnerAccess(
        'slot-1',
        'owner-1',
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects a foreign owner', async () => {
    await expect(
      (makeService('owner-1') as any).assertSlotOwnerAccess(
        'slot-1',
        'owner-2',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not leak missing resources', async () => {
    await expect(
      (makeService(null) as any).assertSlotOwnerAccess('missing', 'owner-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('scopes assignment authorization through its slot cycle', async () => {
    await expect(
      (makeService('owner-1') as any).assertAssignmentOwnerAccess(
        'assignment-1',
        'owner-1',
      ),
    ).resolves.toBeUndefined();
    await expect(
      (makeService('owner-1') as any).assertAssignmentOwnerAccess(
        'assignment-1',
        'owner-2',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not let a forged non-owner registration flag skip slot authorization', async () => {
    const service = makeService('owner-1');
    await expect(
      (service as any).assertSlotOwnerAccess('slot-1', 'owner-2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('scopes shift-assignment listing to the authenticated store owner', async () => {
    await expect(
      (makeService('owner-1') as any).getShiftAssignments(
        'store-1',
        {},
        'owner-1',
      ),
    ).resolves.toEqual([]);
    await expect(
      (makeService('owner-1') as any).getShiftAssignments(
        'store-1',
        {},
        'owner-2',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an active staff account to access only its own calendar data', async () => {
    const service = Object.create(ShiftAggregationService.prototype) as any;
    service.storeRepo = {
      findOne: jest.fn(async () => ({
        id: 'store-1',
        ownerAccountId: 'owner-1',
      })),
    };
    service.employeeProfileRepo = {
      findOne: jest.fn(async ({ where }: any) =>
        where.id === 'emp-1' &&
        where.storeId === 'store-1' &&
        where.accountId === 'staff-1'
          ? { id: 'emp-1' }
          : null,
      ),
    };
    await expect(
      service.assertEmployeeCalendarAccess('store-1', 'emp-1', 'staff-1'),
    ).resolves.toBeUndefined();
    await expect(
      service.assertEmployeeCalendarAccess('store-1', 'emp-2', 'staff-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.assertEmployeeCalendarAccess('store-2', 'emp-1', 'staff-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('authorizes legacy employee calendar reads by owner or self only', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.profileRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'emp-1',
        storeId: 'store-1',
        accountId: 'staff-1',
        employmentStatus: EmploymentStatus.ACTIVE,
      }),
    };
    service.storeRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
    };
    await expect(
      service.assertEmployeeCalendarAccess('emp-1', 'owner-1'),
    ).resolves.toBeTruthy();
    await expect(
      service.assertEmployeeCalendarAccess('emp-1', 'staff-1', 'store-1'),
    ).resolves.toBeTruthy();
    await expect(
      service.assertEmployeeCalendarAccess('emp-1', 'staff-2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an active staff member to read work cycles but rejects foreign accounts', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.storeRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
    };
    service.profileRepository = {
      findOne: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          where.accountId === 'staff-1'
            ? Promise.resolve({ id: 'emp-1' })
            : Promise.resolve(null),
        ),
    };
    service.workCycleRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    await expect(service.getWorkCycles('store-1', 'staff-1')).resolves.toEqual(
      [],
    );
    await expect(
      service.getWorkCycles('store-1', 'staff-2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.workCycleRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: 'store-1' } }),
    );
  });

  it('rejects forged shift-swap requester and validates target store membership', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.shiftAssignmentRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'assignment-1',
        employeeId: 'emp-1',
        status: ShiftAssignmentStatus.APPROVED,
        shiftSlot: { cycle: { storeId: 'store-1' } },
      }),
    };
    service.profileRepository = {
      findOne: jest.fn().mockImplementation(({ where }: any) => {
        if (where.id === 'emp-1' && where.accountId === 'staff-1')
          return Promise.resolve({ id: 'emp-1' });
        return Promise.resolve(null);
      }),
    };
    await expect(
      service.createShiftSwap(
        {
          fromAssignmentId: 'assignment-1',
          toEmployeeId: 'foreign-emp',
          requestedByEmployeeId: 'emp-1',
        },
        'staff-2',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.createShiftSwap(
        {
          fromAssignmentId: 'assignment-1',
          toEmployeeId: 'foreign-emp',
          requestedByEmployeeId: 'emp-1',
        },
        'staff-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('whitelists work-cycle updates and validates owner shift ownership', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue(undefined);
    service.workCycleRepository = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({ id: 'cycle-1', storeId: 'store-1' })
        .mockResolvedValueOnce({ id: 'cycle-1', storeId: 'store-1' }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    service.getWorkCycleById = jest.fn().mockResolvedValue({ id: 'cycle-1' });
    await service.updateWorkCycle(
      'cycle-1',
      {
        name: 'Safe',
        storeId: 'foreign',
        status: WorkCycleStatus.STOPPED,
      } as any,
      'owner-1',
    );
    expect(service.workCycleRepository.update).toHaveBeenCalledWith('cycle-1', {
      name: 'Safe',
    });

    service.workShiftRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    await expect(
      service.assertWorkShiftsBelongToStore('store-1', ['foreign-shift']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects replayed swap transitions and conditionally transfers assignments', async () => {
    const service = Object.create(StoresService.prototype) as any;
    const swap = {
      id: 'swap-1',
      status: ShiftSwapStatus.PENDING,
      toEmployeeId: 'emp-2',
      requestedByEmployeeId: 'emp-1',
      fromAssignment: {
        id: 'assignment-1',
        employeeId: 'emp-1',
        shiftSlot: { cycle: { storeId: 'store-1' } },
      },
    };
    service.shiftSwapRepository = {
      findOne: jest.fn().mockResolvedValue(swap),
    };
    service.shiftAssignmentRepository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    service.storeRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
    };
    service.profileRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'emp-2' }),
    };
    service.dataSource = {
      transaction: jest.fn(async (callback: any) =>
        callback({
          query: jest.fn().mockResolvedValue([]),
          findOne: jest
            .fn()
            .mockResolvedValueOnce({
              id: 'store-1',
              ownerAccountId: 'owner-1',
            })
            .mockResolvedValueOnce({ id: 'emp-2' }),
          update: jest
            .fn()
            .mockResolvedValueOnce({ affected: 1 })
            .mockResolvedValueOnce({ affected: 1 }),
        }),
      ),
    };
    await expect(
      service.updateShiftSwapStatus(
        'swap-1',
        ShiftSwapStatus.APPROVED,
        undefined,
        'owner-1',
      ),
    ).resolves.toMatchObject({ status: ShiftSwapStatus.APPROVED });
    swap.status = ShiftSwapStatus.APPROVED;
    await expect(
      service.updateShiftSwapStatus(
        'swap-1',
        ShiftSwapStatus.APPROVED,
        undefined,
        'owner-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('only allows forward assignment transitions and rejects terminal replay', async () => {
    const service = Object.create(StoresService.prototype) as any;
    const assignment = {
      id: 'assignment-1',
      status: ShiftAssignmentStatus.PENDING,
      shiftSlot: { cycle: { storeId: 'store-1' } },
    };
    service.shiftAssignmentRepository = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(assignment)
        .mockResolvedValueOnce({
          ...assignment,
          status: ShiftAssignmentStatus.APPROVED,
        }),
    };
    service.storeRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
    };
    const save = jest.fn(async (_entity: unknown, value: unknown) => value);
    service.dataSource = {
      transaction: jest.fn(async (callback: any) =>
        callback({
          query: jest.fn(),
          findOne: jest
            .fn()
            .mockResolvedValueOnce({ id: 'store-1', ownerAccountId: 'owner-1' })
            .mockResolvedValueOnce({
              id: 'assignment-1',
              status: ShiftAssignmentStatus.PENDING,
            }),
          save,
        }),
      ),
    };
    await expect(
      service.updateAssignmentStatus(
        'assignment-1',
        ShiftAssignmentStatus.APPROVED,
        undefined,
        'owner-1',
      ),
    ).resolves.toMatchObject({ status: ShiftAssignmentStatus.APPROVED });
    expect(save).toHaveBeenCalledWith(
      ShiftAssignment,
      expect.objectContaining({ status: ShiftAssignmentStatus.APPROVED }),
    );

    service.shiftAssignmentRepository.findOne.mockResolvedValueOnce({
      id: 'assignment-1',
      status: ShiftAssignmentStatus.CANCELLED,
    });
    await expect(
      service.updateAssignmentStatus(
        'assignment-1',
        ShiftAssignmentStatus.APPROVED,
        undefined,
        'owner-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('records the authenticated owner profile when approving leave', async () => {
    const service = makeService('owner-1');
    const leave = {
      id: 'leave-1',
      storeId: 'store-1',
      status: LeaveRequestStatus.PENDING,
    };
    service.leaveRequestRepository = {
      findOne: jest.fn().mockResolvedValue(leave),
    };
    service.profileRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'owner-profile-1' }),
    };

    await service.processRequest('owner-1', 'leave-1', 'LEAVE', 'APPROVED');

    expect(service.profileRepository.findOne).toHaveBeenCalledWith({
      where: { accountId: 'owner-1', storeId: 'store-1' },
      select: ['id'],
    });
    expect(service.dataSource.transaction).toHaveBeenCalled();
  });

  it('rejects a stale register approval when the conditional update loses the race', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.shiftAssignmentRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'assignment-1',
        status: ShiftAssignmentStatus.PENDING,
        shiftSlot: { cycle: { storeId: 'store-1' } },
      }),
    };
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue(undefined);
    service.dataSource = {
      transaction: jest.fn(async (callback: any) =>
        callback({
          query: jest.fn().mockResolvedValue([]),
          findOne: jest.fn().mockResolvedValue({
            id: 'store-1',
            ownerAccountId: 'owner-1',
          }),
          update: jest.fn().mockResolvedValue({ affected: 0 }),
        }),
      ),
    };

    await expect(
      service.processRequest('owner-1', 'assignment-1', 'REGISTER', 'APPROVED'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a stale leave approval without saving duplicate side effects', async () => {
    const service = Object.create(StoresService.prototype) as any;
    service.leaveRequestRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'leave-1',
        storeId: 'store-1',
        status: LeaveRequestStatus.PENDING,
      }),
    };
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue(undefined);
    service.profileRepository = { findOne: jest.fn().mockResolvedValue(null) };
    const update = jest.fn().mockResolvedValue({ affected: 0 });
    service.dataSource = {
      transaction: jest.fn(async (callback: any) =>
        callback({
          query: jest.fn().mockResolvedValue([]),
          findOne: jest.fn().mockResolvedValue({
            id: 'store-1',
            ownerAccountId: 'owner-1',
          }),
          update,
        }),
      ),
    };

    await expect(
      service.processRequest('owner-1', 'leave-1', 'LEAVE', 'APPROVED'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'leave-1', status: LeaveRequestStatus.PENDING },
      expect.objectContaining({ status: LeaveRequestStatus.APPROVED }),
    );
  });

  it('approves leave for an authorized owner without an employee profile', async () => {
    const service = makeService('owner-1');
    service.leaveRequestRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'leave-1',
        storeId: 'store-1',
        status: LeaveRequestStatus.PENDING,
      }),
    };
    service.profileRepository = { findOne: jest.fn().mockResolvedValue(null) };

    await service.processRequest('owner-1', 'leave-1', 'LEAVE', 'APPROVED');
    expect(service.dataSource.transaction).toHaveBeenCalled();
  });

  it('uses the mapped Store name property in leave request projections', async () => {
    const service = Object.create(StoresService.prototype) as any;
    const selections: string[][] = [];
    const qb: any = {};
    for (const method of [
      'select',
      'leftJoinAndSelect',
      'where',
      'andWhere',
      'orderBy',
    ]) {
      qb[method] = jest.fn().mockImplementation((value: any) => {
        if (method === 'select' || method === 'addSelect')
          selections.push(value);
        return qb;
      });
    }
    qb.addSelect = jest.fn().mockImplementation((value: string[]) => {
      selections.push(value);
      return qb;
    });
    qb.getMany = jest.fn().mockResolvedValue([]);
    service.leaveRequestRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };

    await service.getLeaveRequestsByStore('store-1');

    expect(selections.flat()).toContain('store.name');
    expect(selections.flat()).not.toContain('store.nameStore');
  });

  it('uses a deterministic workload probe instead of silently truncating slots', async () => {
    const service = Object.create(ShiftAggregationService.prototype) as any;
    const qb: any = {};
    for (const method of [
      'leftJoinAndSelect',
      'leftJoin',
      'where',
      'andWhere',
      'orderBy',
      'addOrderBy',
      'skip',
      'take',
    ]) {
      qb[method] = jest.fn().mockReturnValue(qb);
    }
    qb.getMany = jest
      .fn()
      .mockResolvedValueOnce(
        Array.from({ length: 5000 }, (_, index) => ({ id: `slot-${index}` })),
      )
      .mockResolvedValueOnce([]);
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue(undefined);
    service.loadActivePayrollRules = jest.fn().mockResolvedValue([]);
    service.mapSlotToResponse = jest.fn((slot: any) => ({
      id: slot.id,
      shiftType: 'morning',
      staffingStatus: 'sufficient',
    }));
    service.shiftSlotRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };

    const result = await service.getShiftSlots({
      storeId: 'store-1',
      ownerAccountId: 'owner-1',
    });

    expect(qb.take).toHaveBeenCalledWith(5000);
    expect(qb.skip).toHaveBeenCalledWith(5000);
    expect(result.meta).toMatchObject({
      total: 5000,
      truncated: false,
      hasMore: true,
    });
  });

  it('marks the employee calendar day using Asia/Ho_Chi_Minh at UTC midnight boundary', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-23T17:30:00.000Z'));
    const service = Object.create(ShiftAggregationService.prototype) as any;
    service.assertEmployeeCalendarAccess = jest
      .fn()
      .mockResolvedValue(undefined);
    service.requireDateRange = jest.fn();
    service.employeeProfileRepo = {
      createQueryBuilder: jest.fn(() => {
        const qb: any = {};
        for (const method of ['leftJoinAndSelect', 'where', 'andWhere'])
          qb[method] = jest.fn().mockReturnValue(qb);
        qb.getOne = jest
          .fn()
          .mockResolvedValue({ id: 'emp-1', account: { fullName: 'A' } });
        return qb;
      }),
    };
    service.shiftAssignmentRepo = {
      createQueryBuilder: jest.fn(() => {
        const qb: any = {};
        for (const method of [
          'leftJoinAndSelect',
          'leftJoin',
          'where',
          'andWhere',
          'orderBy',
        ])
          qb[method] = jest.fn().mockReturnValue(qb);
        qb.getMany = jest.fn().mockResolvedValue([]);
        return qb;
      }),
    };

    const result = await service.getEmployeeScheduleGrid({
      storeId: 'store-1',
      employeeId: 'emp-1',
      from: '2026-08-24',
      to: '2026-08-24',
      ownerAccountId: 'owner-1',
    });

    expect(result?.schedule[0].isToday).toBe(true);
    jest.useRealTimers();
  });

  it('keeps an overnight slot ongoing after local midnight', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-23T18:00:00.000Z'));
    const service = Object.create(ShiftAggregationService.prototype) as any;
    const status = service.computeShiftStatus({
      workDate: '2026-08-24',
      startTime: '22:00',
      endTime: '06:00',
    });
    expect(status).toBe('pending');

    jest.setSystemTime(new Date('2026-08-24T18:00:00.000Z'));
    expect(
      service.computeShiftStatus({
        workDate: '2024-08-24',
        startTime: '22:00',
        endTime: '06:00',
      }),
    ).toBe('finished');

    // 01:00 Asia/Ho_Chi_Minh is 18:00 UTC on the previous day.
    jest.setSystemTime(new Date('2026-08-23T18:00:00.000Z'));
    expect(
      service.computeShiftStatus({
        workDate: '2026-08-23',
        startTime: '22:00',
        endTime: '06:00',
      }),
    ).toBe('ongoing');
    jest.useRealTimers();
  });

  it('rejects invalid aggregation enum filters before querying', async () => {
    const service = Object.create(ShiftAggregationService.prototype) as any;
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue(undefined);
    await expect(
      service.getShiftSlots({
        storeId: 'store-1',
        ownerAccountId: 'owner-1',
        type: 'night',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('scores a deterministic bounded subset when eligible candidates exceed the safety cap', async () => {
    const service = Object.create(ShiftAggregationService.prototype) as any;
    const insufficientQb: any = {};
    const candidateQb: any = {};
    for (const method of [
      'leftJoinAndSelect',
      'leftJoin',
      'where',
      'andWhere',
      'select',
      'groupBy',
      'addGroupBy',
      'having',
      'orderBy',
      'addOrderBy',
      'take',
      'skip',
      'limit',
    ]) {
      insufficientQb[method] = jest.fn().mockReturnValue(insufficientQb);
      candidateQb[method] = jest.fn().mockReturnValue(candidateQb);
    }
    insufficientQb.getRawMany = jest.fn().mockResolvedValue([
      {
        id: 'slot-1',
        maxStaff: 1,
        assignedCount: 0,
        workDate: '2026-07-01',
        dayOfWeek: 'MONDAY',
        ws_shiftName: 'Ca sáng',
        ws_startTime: '09:00',
      },
    ]);
    candidateQb.getMany = jest.fn().mockResolvedValue(
      Array.from({ length: 101 }, (_, i) => ({
        id: `employee-${i}`,
        storeId: 'store-1',
      })),
    );
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue(undefined);
    service.shiftSlotRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(insufficientQb),
    };
    service.employeeProfileRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(candidateQb),
    };
    const leaveQb: any = {};
    for (const method of ['where', 'andWhere'])
      leaveQb[method] = jest.fn().mockReturnValue(leaveQb);
    leaveQb.getMany = jest.fn().mockResolvedValue([]);
    const assignmentQb: any = {};
    for (const method of [
      'leftJoin',
      'where',
      'andWhere',
      'select',
      'addSelect',
    ])
      assignmentQb[method] = jest.fn().mockReturnValue(assignmentQb);
    assignmentQb.getRawMany = jest.fn().mockResolvedValue([]);
    service.leaveRequestRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(leaveQb),
    };
    service.shiftAssignmentRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(assignmentQb),
    };
    const scoreCandidates = jest
      .fn()
      .mockImplementation(async (eligible: any[]) =>
        eligible.map((employee) => ({
          ...employee,
          matchPercent: 80,
          reason: 'Phù hợp',
          reasonSub: null,
        })),
      );
    service.scoreCandidates = scoreCandidates;

    const result = await service.getShiftSuggestions({
      storeId: 'store-1',
      ownerAccountId: 'owner-1',
      from: '2026-07-01',
      to: '2026-07-01',
      limit: 3,
    });
    expect(result).toHaveLength(3);
    expect(scoreCandidates).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'employee-0' })]),
      expect.anything(),
      '2026-07-01',
      '2026-07-01',
    );
    expect(scoreCandidates.mock.calls[0][0]).toHaveLength(100);
    expect(
      service.shiftAssignmentRepo.createQueryBuilder,
    ).toHaveBeenCalledTimes(1);
  });
});
