import { ForbiddenException } from '@nestjs/common';
import {
  EmployeeLeaveRequest,
  LeaveRequestStatus,
  LeaveType,
} from './entities/employee-leave-request.entity';
import { EmploymentStatus } from './entities/employee-profile.entity';
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

    const leaveRequests: Partial<EmployeeLeaveRequest>[] = [
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
    (service as any).leaveRequestRepository = {
      createQueryBuilder: jest.fn(() => createQueryBuilder(leaveRequests)),
    };
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
});
