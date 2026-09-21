/**
 * Phase 3 B1/B5/B7/B10: leave requests from released staff builds (slot id
 * sent as the assignment id, `type: 'LEAVE'`, double submits) and the type
 * filter on an employee's leave history.
 */
import { BadRequestException } from '@nestjs/common';
import { In, IsNull } from 'typeorm';

import {
  StoresService,
  normalizeLeaveType,
  parseLeaveTypeFilter,
} from './stores.service';
import {
  EmployeeLeaveRequest,
  LeaveRequestStatus,
  LeaveType,
} from './entities/employee-leave-request.entity';
import { EmploymentStatus } from './entities/employee-profile.entity';
import { ShiftAssignment } from './entities/shift-management.entity';

const STORE = '11111111-1111-4111-8111-111111111111';
const PROFILE = '22222222-2222-4222-8222-222222222222';
const ASSIGNMENT = '33333333-3333-4333-8333-333333333333';
const SLOT = '44444444-4444-4444-8444-444444444444';
const OTHERS_ASSIGNMENT = '55555555-5555-4555-8555-555555555555';

function build(
  options: {
    assignments?: Array<{ id: string; shiftSlotId: string; employeeId: string }>;
    pending?: any;
  } = {},
) {
  const service = Object.create(StoresService.prototype) as any;
  service.profileRepository = {
    findOne: jest.fn().mockResolvedValue({
      id: PROFILE,
      storeId: STORE,
      accountId: 'account-1',
      employmentStatus: EmploymentStatus.ACTIVE,
    }),
  };
  const assignments = options.assignments ?? [
    { id: ASSIGNMENT, shiftSlotId: SLOT, employeeId: PROFILE },
    { id: OTHERS_ASSIGNMENT, shiftSlotId: SLOT, employeeId: 'someone-else' },
  ];
  const saved: any[] = [];
  const manager = {
    findOne: jest.fn(async (entity: any, { where }: any) => {
      if (entity === ShiftAssignment) {
        return (
          assignments.find(
            (row) =>
              row.employeeId === where.employeeId &&
              (where.id ? row.id === where.id : row.shiftSlotId === where.shiftSlotId),
          ) ?? null
        );
      }
      if (entity === EmployeeLeaveRequest) return options.pending ?? null;
      return { id: PROFILE };
    }),
    create: jest.fn((_entity: unknown, value: any) => ({ ...value })),
    save: jest.fn(async (_entity: unknown, value: any) => {
      saved.push(value);
      return { id: 'leave-1', ...value };
    }),
  };
  service.dataSource = { transaction: jest.fn(async (work: any) => work(manager)) };
  return { service, manager, saved };
}

const request = (over: Record<string, unknown> = {}) => ({
  employeeProfileId: PROFILE,
  type: LeaveType.LATE,
  startDate: '2026-09-22',
  endDate: '2026-09-22',
  ...over,
});

describe('createLeaveRequest', () => {
  it("resolves a slot id to the caller's own assignment", async () => {
    const { service, manager, saved } = build();
    await service.createLeaveRequest(
      STORE,
      request({ shiftAssignmentId: SLOT }),
      'account-1',
    );
    expect(saved[0].shiftAssignmentId).toBe(ASSIGNMENT);
    // Both lookups are scoped to the addressed store and the caller.
    for (const call of manager.findOne.mock.calls.filter(
      ([entity]: any[]) => entity === ShiftAssignment,
    )) {
      expect(call[1].where).toMatchObject({
        employeeId: PROFILE,
        shiftSlot: { cycle: { storeId: STORE } },
      });
    }
  });

  it('keeps a real assignment id of the caller', async () => {
    const { service, saved } = build();
    await service.createLeaveRequest(
      STORE,
      request({ shiftAssignmentId: ASSIGNMENT }),
      'account-1',
    );
    expect(saved[0].shiftAssignmentId).toBe(ASSIGNMENT);
  });

  it("refuses another employee's assignment with 400", async () => {
    const { service, saved } = build({
      assignments: [
        { id: OTHERS_ASSIGNMENT, shiftSlotId: SLOT, employeeId: 'someone-else' },
      ],
    });
    await expect(
      service.createLeaveRequest(
        STORE,
        request({ shiftAssignmentId: OTHERS_ASSIGNMENT }),
        'account-1',
      ),
    ).rejects.toThrow('Ca làm không hợp lệ cho đơn này');
    await expect(
      service.createLeaveRequest(
        STORE,
        request({ shiftAssignmentId: 'not-a-uuid' }),
        'account-1',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(saved).toEqual([]);
  });

  it("maps the released app's 'LEAVE' type to PERSONAL", async () => {
    const { service, saved } = build();
    await service.createLeaveRequest(STORE, request({ type: 'LEAVE' }), 'account-1');
    expect(saved[0].type).toBe(LeaveType.PERSONAL);
  });

  it('refuses an unknown type with 400 instead of a database 500', async () => {
    const { service } = build();
    await expect(
      service.createLeaveRequest(STORE, request({ type: 'HOLIDAY' }), 'account-1'),
    ).rejects.toThrow('Loại đơn không hợp lệ');
  });

  it('returns an identical pending request instead of creating another', async () => {
    const pending = { id: 'existing', status: LeaveRequestStatus.PENDING };
    const { service, manager, saved } = build({ pending });
    await expect(
      service.createLeaveRequest(
        STORE,
        request({ shiftAssignmentId: SLOT }),
        'account-1',
      ),
    ).resolves.toBe(pending);
    expect(saved).toEqual([]);
    expect(manager.findOne).toHaveBeenCalledWith(EmployeeLeaveRequest, {
      where: {
        employeeProfileId: PROFILE,
        type: LeaveType.LATE,
        startDate: '2026-09-22',
        endDate: '2026-09-22',
        status: LeaveRequestStatus.PENDING,
        shiftAssignmentId: ASSIGNMENT,
      },
      order: { createdAt: 'DESC' },
    });
  });

  it('matches a request without a shift by IS NULL', async () => {
    const { service, manager } = build();
    await service.createLeaveRequest(STORE, request(), 'account-1');
    expect(manager.findOne).toHaveBeenCalledWith(
      EmployeeLeaveRequest,
      expect.objectContaining({
        where: expect.objectContaining({ shiftAssignmentId: IsNull() }),
      }),
    );
  });

  it('serialises submissions by locking the employee row', async () => {
    const { service, manager } = build();
    await service.createLeaveRequest(STORE, request(), 'account-1');
    expect(manager.findOne.mock.calls[0][1]).toEqual(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });

  it('refuses reversed or malformed dates with 400', async () => {
    const { service } = build();
    await expect(
      service.createLeaveRequest(
        STORE,
        request({ startDate: '2026-09-23', endDate: '2026-09-22' }),
        'account-1',
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.createLeaveRequest(STORE, request({ startDate: '22/09/2026' }), 'account-1'),
    ).rejects.toThrow('Ngày của đơn không hợp lệ');
  });

  it('still refuses filing for someone else', async () => {
    const { service } = build();
    await expect(
      service.createLeaveRequest(STORE, request(), 'account-2'),
    ).rejects.toThrow('Bạn chỉ có thể gửi đơn cho chính mình');
  });
});

describe('normalizeLeaveType', () => {
  it('passes enum values, maps LEAVE, keeps missing missing', () => {
    expect(normalizeLeaveType(LeaveType.SICK)).toBe(LeaveType.SICK);
    expect(normalizeLeaveType('LEAVE')).toBe(LeaveType.PERSONAL);
    expect(normalizeLeaveType(undefined)).toBeUndefined();
    expect(() => normalizeLeaveType('leave')).toThrow(BadRequestException);
  });
});

describe('leave history type filter (B7)', () => {
  it('parses one type, a list, and LEAVE as the absence types', () => {
    expect(parseLeaveTypeFilter('LATE')).toEqual([LeaveType.LATE]);
    expect(parseLeaveTypeFilter('LATE,EARLY')).toEqual([
      LeaveType.LATE,
      LeaveType.EARLY,
    ]);
    expect(parseLeaveTypeFilter('LEAVE')).toEqual([
      LeaveType.SICK,
      LeaveType.PERSONAL,
      LeaveType.VACATION,
      LeaveType.UNPAID,
      LeaveType.OTHER,
    ]);
    expect(parseLeaveTypeFilter(undefined)).toBeNull();
    expect(parseLeaveTypeFilter(' ')).toBeNull();
    expect(() => parseLeaveTypeFilter('HOLIDAY')).toThrow(BadRequestException);
  });

  const historyService = () => {
    const service = Object.create(StoresService.prototype) as any;
    service.assertEmployeeCalendarAccess = jest.fn().mockResolvedValue(undefined);
    service.leaveRequestRepository = { find: jest.fn().mockResolvedValue([]) };
    return service;
  };

  it('filters by the requested types', async () => {
    const service = historyService();
    await service.getLeaveRequestsByEmployee(PROFILE, 'account-1', 'LATE');
    expect(service.leaveRequestRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { employeeProfileId: PROFILE, type: In([LeaveType.LATE]) },
      }),
    );
  });

  it('returns everything without a type', async () => {
    const service = historyService();
    await service.getLeaveRequestsByEmployee(PROFILE, 'account-1');
    expect(service.leaveRequestRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employeeProfileId: PROFILE } }),
    );
  });

  it('answers 400 for an unknown type before reading anything', async () => {
    const service = historyService();
    await expect(
      service.getLeaveRequestsByEmployee(PROFILE, 'account-1', 'NOPE'),
    ).rejects.toThrow(BadRequestException);
    expect(service.leaveRequestRepository.find).not.toHaveBeenCalled();
  });
});
