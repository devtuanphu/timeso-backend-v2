import { ForbiddenException } from '@nestjs/common';
import {
  EmployeeLeaveRequest,
  LeaveRequestStatus,
  LeaveType,
} from './entities/employee-leave-request.entity';
import {
  EmployeeProfile,
  EmploymentStatus,
} from './entities/employee-profile.entity';
import { Store } from './entities/store.entity';
import { WorkShift } from './entities/work-shift.entity';
import {
  ShiftAssignmentStatus,
  WorkCycleStatus,
} from './entities/shift-management.entity';
import {
  ShiftRecurrenceEndType,
  ShiftRecurrenceFrequency,
} from './shift-schedule.types';
import { addDays, getTodayDateString } from './shift-schedule.utils';
import { StoresService } from './stores.service';

const createQueryBuilder = (result: unknown[]) => {
  const builder: any = {
    leftJoinAndSelect: jest.fn(() => builder),
    where: jest.fn(() => builder),
    andWhere: jest.fn(() => builder),
    take: jest.fn(() => builder),
    getMany: jest.fn(async () => result),
  };
  return builder;
};

describe('Shift employee options', () => {
  const workDate = addDays(getTodayDateString(), 1);

  const createService = (
    ownerAccountId = 'owner-1',
    assignmentRows?: Array<{
      employeeId: string;
      status: ShiftAssignmentStatus;
      shiftSlot: {
        workDate: string;
        startTime: string;
        endTime: string;
      };
    }>,
    leaveRows?: Partial<EmployeeLeaveRequest>[],
  ) => {
    const service = Object.create(StoresService.prototype) as StoresService;
    (service as any).storeRepository = {
      findOne: jest.fn(async () => ({ id: 'store-1', ownerAccountId })),
    };
    (service as any).profileRepository = {
      find: jest.fn(async () => [
        {
          id: 'available',
          storeId: 'store-1',
          employmentStatus: EmploymentStatus.ACTIVE,
          account: { fullName: 'An', avatar: '/an.png' },
          storeRole: { name: 'Nhân viên' },
          employeeType: { name: 'Parttime' },
        },
        {
          id: 'other-shift',
          storeId: 'store-1',
          employmentStatus: EmploymentStatus.ACTIVE,
          account: { fullName: 'Bình', avatar: null },
          storeRole: { name: 'Thu ngân' },
          employeeType: { name: 'Fulltime' },
        },
        {
          id: 'conflict',
          storeId: 'store-1',
          employmentStatus: EmploymentStatus.ACTIVE,
          account: { fullName: 'Chi', avatar: null },
          storeRole: { name: 'Pha chế' },
          employeeType: { name: 'Fulltime' },
        },
        {
          id: 'on-leave',
          storeId: 'store-1',
          employmentStatus: EmploymentStatus.ACTIVE,
          account: { fullName: 'Dung', avatar: null },
          storeRole: { name: 'Nhân viên' },
          employeeType: { name: 'Parttime' },
        },
      ]),
    };

    const assignments = assignmentRows ?? [
      {
        employeeId: 'other-shift',
        status: ShiftAssignmentStatus.APPROVED,
        shiftSlot: {
          workDate,
          startTime: '13:00',
          endTime: '17:00',
        },
      },
      {
        employeeId: 'conflict',
        status: ShiftAssignmentStatus.APPROVED,
        shiftSlot: {
          workDate,
          startTime: '08:00',
          endTime: '12:00',
        },
      },
    ];
    const assignmentQueryBuilder = createQueryBuilder(assignments);
    (service as any).shiftAssignmentRepository = {
      createQueryBuilder: jest.fn(() => assignmentQueryBuilder),
    };
    (service as any).__assignmentQueryBuilder = assignmentQueryBuilder;

    const leaveRequests: Partial<EmployeeLeaveRequest>[] = leaveRows ?? [
      {
        employeeProfileId: 'on-leave',
        storeId: 'store-1',
        startDate: workDate,
        endDate: workDate,
        startTime: null,
        endTime: null,
        type: LeaveType.VACATION,
        status: LeaveRequestStatus.APPROVED,
      },
    ];
    const leaveQueryBuilder = createQueryBuilder(leaveRequests);
    (service as any).leaveRequestRepository = {
      createQueryBuilder: jest.fn(() => leaveQueryBuilder),
    };
    (service as any).__leaveQueryBuilder = leaveQueryBuilder;
    return service;
  };

  const payload = {
    startDate: workDate,
    startTime: '07:00',
    endTime: '11:00',
    recurrence: {
      enabled: false,
      frequency: ShiftRecurrenceFrequency.DAILY,
      interval: 1,
      endType: ShiftRecurrenceEndType.COUNT,
      occurrenceCount: 1,
    },
  };

  it('classifies availability for the proposed shift', async () => {
    const service = createService();
    const result = await service.getShiftEmployeeOptions(
      'store-1',
      'owner-1',
      payload,
    );
    const statuses = Object.fromEntries(
      result.employees.map((employee) => [employee.id, employee.availability]),
    );

    expect(statuses).toEqual({
      available: 'AVAILABLE',
      'other-shift': 'OTHER_SHIFT',
      conflict: 'CONFLICT',
      'on-leave': 'ON_LEAVE',
    });
    expect(result.summary).toEqual({
      total: 4,
      available: 1,
      otherShift: 1,
      conflict: 1,
      onLeave: 1,
    });
    expect(
      result.employees
        .filter((employee) => employee.selectable)
        .map((employee) => employee.id),
    ).toEqual(['available', 'other-shift']);
    expect(
      (service as any).__assignmentQueryBuilder.andWhere,
    ).toHaveBeenCalledWith('cycle.status = :activeCycleStatus', {
      activeCycleStatus: WorkCycleStatus.ACTIVE,
    });
    expect((service as any).__leaveQueryBuilder.andWhere).toHaveBeenCalledWith(
      'leave.type IN (:...blockingLeaveTypes)',
      {
        blockingLeaveTypes: [
          LeaveType.SICK,
          LeaveType.PERSONAL,
          LeaveType.VACATION,
          LeaveType.UNPAID,
          LeaveType.OTHER,
        ],
      },
    );
  });

  it('rejects access from a different owner', async () => {
    await expect(
      createService('owner-2').getShiftEmployeeOptions(
        'store-1',
        'owner-1',
        payload,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('detects a next-day conflict for an overnight proposed shift', async () => {
    const service = createService('owner-1', [
      {
        employeeId: 'available',
        status: ShiftAssignmentStatus.APPROVED,
        shiftSlot: {
          workDate: addDays(workDate, 1),
          startTime: '05:00',
          endTime: '09:00',
        },
      },
    ]);

    const result = await service.getShiftEmployeeOptions('store-1', 'owner-1', {
      ...payload,
      startTime: '22:00',
      endTime: '06:00',
    });

    expect(
      result.employees.find((employee) => employee.id === 'available')
        ?.availability,
    ).toBe('CONFLICT');
    expect(
      (service as any).__assignmentQueryBuilder.andWhere,
    ).toHaveBeenCalledWith('slot.workDate BETWEEN :rangeStart AND :rangeEnd', {
      rangeStart: addDays(workDate, -1),
      rangeEnd: addDays(workDate, 1),
    });
  });

  it.each([
    {
      label: 'all-day',
      startTime: null,
      endTime: null,
    },
    {
      label: 'hourly',
      startTime: '05:00',
      endTime: '08:00',
    },
  ])(
    'detects next-day $label leave for an overnight proposed shift in preflight and commit checks',
    async ({ startTime, endTime }) => {
      const nextDate = addDays(workDate, 1);
      const leave = {
        employeeProfileId: 'available',
        storeId: 'store-1',
        startDate: nextDate,
        endDate: nextDate,
        startTime,
        endTime,
        type: LeaveType.VACATION,
        status: LeaveRequestStatus.APPROVED,
      } as EmployeeLeaveRequest;
      const service = createService('owner-1', [], [leave]);

      const result = await service.getShiftEmployeeOptions(
        'store-1',
        'owner-1',
        { ...payload, startTime: '22:00', endTime: '06:00' },
      );
      expect(
        result.employees.find((employee) => employee.id === 'available')
          ?.availability,
      ).toBe('ON_LEAVE');

      const assignmentBuilder = createQueryBuilder([]);
      const leaveBuilder = createQueryBuilder([leave]);
      const manager: any = {
        find: jest.fn(async () => [
          {
            id: 'available',
            storeId: 'store-1',
            employmentStatus: EmploymentStatus.ACTIVE,
          },
        ]),
        createQueryBuilder: jest
          .fn()
          .mockReturnValueOnce(assignmentBuilder)
          .mockReturnValueOnce(leaveBuilder),
      };
      await expect(
        (service as any).assertShiftScheduleAvailabilityAtCommit(
          manager,
          'store-1',
          [
            {
              shiftName: 'Ca đêm',
              startTime: '22:00',
              endTime: '06:00',
              maxStaff: 1,
              employeeIds: ['available'],
              note: null,
            },
          ],
          [workDate],
        ),
      ).rejects.toThrow('lịch nghỉ được duyệt');
      expect(leaveBuilder.andWhere).toHaveBeenCalledWith(
        'leave.endDate >= :rangeStart',
        { rangeStart: addDays(workDate, -1) },
      );
    },
  );

  it('loads authoritative availability with a constant query count at the 10000-reference boundary', async () => {
    const service = createService();
    const employeeIds = Array.from(
      { length: 50 },
      (_, index) => `employee-${index}`,
    );
    const workDates = Array.from({ length: 200 }, (_, index) =>
      addDays(workDate, index),
    );
    const assignmentBuilder = createQueryBuilder([]);
    const leaveBuilder = createQueryBuilder(
      Array.from({ length: 5000 }, (_, index) => ({
        employeeProfileId: employeeIds[index % employeeIds.length],
        storeId: 'store-1',
        startDate: workDates[index % workDates.length],
        endDate: workDates[index % workDates.length],
        startTime: '06:00',
        endTime: '06:30',
        type: [LeaveType.LATE, LeaveType.EARLY, LeaveType.OVERTIME][index % 3],
        status: LeaveRequestStatus.APPROVED,
      })),
    );
    const manager: any = {
      find: jest.fn(async () =>
        employeeIds.map((id) => ({
          id,
          storeId: 'store-1',
          employmentStatus: EmploymentStatus.ACTIVE,
        })),
      ),
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(assignmentBuilder)
        .mockReturnValueOnce(leaveBuilder),
    };
    const drafts = employeeIds.map((employeeId, index) => ({
      shiftName: `Ca ${index}`,
      startTime: '07:00',
      endTime: '11:00',
      maxStaff: 1,
      employeeIds: [employeeId],
      note: null,
    }));

    await expect(
      (service as any).assertShiftScheduleAvailabilityAtCommit(
        manager,
        'store-1',
        drafts,
        workDates,
      ),
    ).resolves.toBeUndefined();
    expect(manager.find).toHaveBeenCalledTimes(1);
    expect(manager.createQueryBuilder).toHaveBeenCalledTimes(2);
    expect(assignmentBuilder.getMany).toHaveBeenCalledTimes(1);
    expect(leaveBuilder.getMany).toHaveBeenCalledTimes(1);
    expect(leaveBuilder.andWhere).toHaveBeenCalledWith(
      'leave.type IN (:...blockingLeaveTypes)',
      {
        blockingLeaveTypes: [
          LeaveType.SICK,
          LeaveType.PERSONAL,
          LeaveType.VACATION,
          LeaveType.UNPAID,
          LeaveType.OTHER,
        ],
      },
    );
  });

  it.each([
    { leaveCount: 20, outcome: 'allowed' },
    { leaveCount: 21, outcome: 'rejected' },
  ])(
    '$outcome long-range partial leave expansion at the explicit interval boundary',
    async ({ leaveCount, outcome }) => {
      const service = createService();
      const workDates = Array.from({ length: 1000 }, (_, index) =>
        addDays(workDate, index),
      );
      const assignmentBuilder = createQueryBuilder([]);
      const leaveBuilder = createQueryBuilder(
        Array.from({ length: leaveCount }, () => ({
          employeeProfileId: 'employee-1',
          storeId: 'store-1',
          startDate: workDates[0],
          endDate: workDates[workDates.length - 1],
          startTime: '12:00',
          endTime: '01:00',
          type: LeaveType.PERSONAL,
          status: LeaveRequestStatus.APPROVED,
        })),
      );
      const manager: any = {
        find: jest.fn(async () => [
          {
            id: 'employee-1',
            storeId: 'store-1',
            employmentStatus: EmploymentStatus.ACTIVE,
          },
        ]),
        createQueryBuilder: jest
          .fn()
          .mockReturnValueOnce(assignmentBuilder)
          .mockReturnValueOnce(leaveBuilder),
        create: jest.fn(),
        save: jest.fn(),
        update: jest.fn(),
      };
      const check = (service as any).assertShiftScheduleAvailabilityAtCommit(
        manager,
        'store-1',
        [
          {
            shiftName: 'Ca sáng dài hạn',
            startTime: '07:00',
            endTime: '11:00',
            maxStaff: 1,
            employeeIds: ['employee-1'],
            note: null,
          },
        ],
        workDates,
      );

      if (outcome === 'allowed') await expect(check).resolves.toBeUndefined();
      else {
        await expect(check).rejects.toThrow(
          'Phạm vi nghỉ phép quá lớn để kiểm tra lịch ca an toàn',
        );
      }
      expect(leaveBuilder.take).toHaveBeenCalledWith(5001);
      expect(manager.create).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
    },
  );

  it('returns a stable 400 before schedule writes when authoritative leave expansion is unsafe', async () => {
    const service = createService();
    const workDates = Array.from({ length: 1000 }, (_, index) =>
      addDays(workDate, index),
    );
    const assignmentBuilder = createQueryBuilder([]);
    const leaveBuilder = createQueryBuilder(
      Array.from({ length: 21 }, () => ({
        employeeProfileId: 'employee-1',
        storeId: 'store-1',
        startDate: workDates[0],
        endDate: workDates[workDates.length - 1],
        startTime: '22:00',
        endTime: '06:00',
        type: LeaveType.VACATION,
        status: LeaveRequestStatus.APPROVED,
      })),
    );
    const manager: any = {
      query: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(async (entity) =>
        entity === Store ? { id: 'store-1', ownerAccountId: 'owner-1' } : null,
      ),
      find: jest.fn(async (entity) => {
        if (entity === WorkShift) return [];
        if (entity === EmployeeProfile) {
          return [
            {
              id: 'employee-1',
              storeId: 'store-1',
              employmentStatus: EmploymentStatus.ACTIVE,
            },
          ];
        }
        return [];
      }),
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(assignmentBuilder)
        .mockReturnValueOnce(leaveBuilder),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };
    const transaction = jest.fn(async (callback) => callback(manager));
    (service as any).dataSource = { transaction };
    (service as any).shiftReminderService = {
      scheduleAssignmentReminders: jest.fn(),
    };

    await expect(
      service.createShiftSchedule('store-1', 'owner-1', {
        startDate: workDate,
        recurrence: {
          enabled: true,
          frequency: ShiftRecurrenceFrequency.DAILY,
          interval: 1,
          endType: ShiftRecurrenceEndType.COUNT,
          occurrenceCount: 1000,
        },
        shifts: [
          {
            shiftName: 'Ca dài hạn không an toàn',
            startTime: '07:00',
            endTime: '11:00',
            maxStaff: 1,
            employeeIds: ['employee-1'],
          },
        ],
      }),
    ).rejects.toThrow('Phạm vi nghỉ phép quá lớn để kiểm tra lịch ca an toàn');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(manager.create).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
  });
});
