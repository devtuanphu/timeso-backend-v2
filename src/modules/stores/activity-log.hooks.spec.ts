/**
 * X1 activity log hooks: each business category records one entry, inside the
 * business transaction when there is one (the manager handed to `record` is
 * the transaction's), with an idempotency key, and never with money, face or
 * location data. A failing log write never fails the business action.
 *
 * X6: check-in / check-out hand the owner notification off after commit.
 */
import { AccountStatus } from '../accounts/entities/account.entity';
import { AdvanceRequestStatus } from './entities/salary-advance-request.entity';
import { AssetAssignmentStatus } from './entities/employee-asset-assignment.entity';
import {
  LeaveRequestStatus,
  LeaveType,
} from './entities/employee-leave-request.entity';
import { PaymentStatus } from './entities/employee-salary.entity';
import { ShiftAssignmentStatus } from './entities/shift-management.entity';
import { ACTIVITY_ACTIONS } from './activity-log.summary';
import { StoresService } from './stores.service';
import { CareerLadderService } from './career-ladder.service';
import { BonusWorkRequestStatus } from './entities/bonus-work-request.entity';

const FORBIDDEN_PARAM_KEYS = [
  'amount',
  'requestedAmount',
  'approvedAmount',
  'netSalary',
  'latitude',
  'longitude',
  'checkinLatitude',
  'checkinLongitude',
  'checkinDistance',
  'faceMatchScore',
  'distance',
  'reason',
  'note',
  'phone',
  'documentNumber',
];

function makeService() {
  const service = Object.create(StoresService.prototype) as any;
  const record = jest.fn().mockResolvedValue(undefined);
  service.activityLogService = { record };
  service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { service, record };
}

function txManager(overrides: Record<string, any> = {}) {
  const queryBuilder: any = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  return {
    query: jest.fn().mockResolvedValue([]),
    create: jest.fn((_entity: any, data: any) => ({ ...data })),
    save: jest.fn(async (_entity: any, value: any) => ({ id: 'saved-1', ...(value ?? _entity) })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(() => queryBuilder),
    getRepository: jest.fn(() => ({ update: jest.fn().mockResolvedValue({ affected: 1 }) })),
    ...overrides,
  };
}

const expectCleanParams = (entry: any) => {
  for (const key of FORBIDDEN_PARAM_KEYS) {
    expect(entry.params ?? {}).not.toHaveProperty(key);
  }
};

const SLOT = {
  workDate: '2026-09-21',
  startTime: null,
  endTime: null,
  cycle: { storeId: 'store-1' },
  workShift: { shiftName: 'Sáng', startTime: '08:00:00', endTime: '12:00:00' },
};

function attendanceService(assignment: any) {
  const { service, record } = makeService();
  const manager = txManager();
  service.shiftAssignmentRepository = {
    findOne: jest.fn().mockResolvedValue(assignment),
  };
  service.applyAttendancePolicy = jest.fn().mockResolvedValue({
    checkinDistance: 12.3,
    checkinLatitude: 10.1,
    checkinLongitude: 106.2,
  });
  service.employeeFaceRepository = {
    findOne: jest.fn().mockResolvedValue({ faceDescriptors: [[0.1]] }),
  };
  service.faceRecognitionService = {
    extractDescriptor: jest.fn().mockResolvedValue([0.1]),
    compareFaces: jest.fn().mockReturnValue({ matched: true, distance: 0.2 }),
  };
  service.dataSource = { transaction: jest.fn(async (cb: any) => cb(manager)) };
  service.profileRepository = { update: jest.fn().mockResolvedValue({}) };
  service.appendToDailyReport = jest.fn();
  const afterAttendance = jest.fn().mockResolvedValue(undefined);
  service.ownerNotificationService = { afterAttendance };
  return { service, record, manager, afterAttendance };
}

describe('activity log hooks', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-09-21T01:05:00Z') }); // 08:05 VN
  });
  afterEach(() => jest.useRealTimers());

  it('check-in: records inside the attendance transaction, late minutes, no location/face data; owner notified after commit', async () => {
    const { service, record, manager, afterAttendance } = attendanceService({
      id: 'as-1',
      status: ShiftAssignmentStatus.APPROVED,
      employeeId: 'emp-1',
      employee: { id: 'emp-1', accountId: 'staff-1', employmentStatus: 'active' },
      shiftSlot: SLOT,
    });

    const result = await service.checkInWithFace('as-1', Buffer.from('x'), 'staff-1');

    expect(result.matched).toBe(true);
    expect(record).toHaveBeenCalledTimes(1);
    const [usedManager, entry] = record.mock.calls[0];
    expect(usedManager).toBe(manager);
    expect(entry).toMatchObject({
      storeId: 'store-1',
      actorAccountId: 'staff-1',
      subjectEmployeeProfileId: 'emp-1',
      action: ACTIVITY_ACTIONS.CHECK_IN,
      resourceType: 'shift_assignment',
      resourceId: 'as-1',
      idempotencyKey: 'attendance.check_in:as-1',
      params: expect.objectContaining({
        shiftName: 'Sáng',
        startTime: '08:00',
        endTime: '12:00',
        workDate: '2026-09-21',
        checkInAt: '08:05',
        lateMinutes: 5,
      }),
    });
    expectCleanParams(entry);
    expect(afterAttendance).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'check_in', assignmentId: 'as-1', lateMinutes: 5 }),
    );
  });

  it('check-in: a duplicate (already recorded under the lock) writes no entry and notifies nobody', async () => {
    const { service, record, manager, afterAttendance } = attendanceService({
      id: 'as-1',
      status: ShiftAssignmentStatus.APPROVED,
      employeeId: 'emp-1',
      employee: { id: 'emp-1', accountId: 'staff-1', employmentStatus: 'active' },
      shiftSlot: SLOT,
    });
    manager.createQueryBuilder = jest.fn(() => ({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    }));
    manager.findOne = jest.fn().mockResolvedValue({
      checkInTime: new Date('2026-09-21T01:00:00Z'),
      lateMinutes: 0,
      attendanceStatus: 'ON_TIME',
    });

    const result = await service.checkInWithFace('as-1', Buffer.from('x'), 'staff-1');

    expect(result.alreadyRecorded).toBe(true);
    expect(record).not.toHaveBeenCalled();
    expect(afterAttendance).not.toHaveBeenCalled();
  });

  it('check-in: a failing log write does not fail the check-in', async () => {
    const { service, record } = attendanceService({
      id: 'as-1',
      status: ShiftAssignmentStatus.APPROVED,
      employeeId: 'emp-1',
      employee: { id: 'emp-1', accountId: 'staff-1', employmentStatus: 'active' },
      shiftSlot: SLOT,
    });
    record.mockRejectedValue(new Error('db down'));

    await expect(
      service.checkInWithFace('as-1', Buffer.from('x'), 'staff-1'),
    ).resolves.toMatchObject({ matched: true });
  });

  it('check-out: records early minutes inside the transaction and hands off to the owner', async () => {
    jest.setSystemTime(new Date('2026-09-21T04:50:00Z')); // 11:50 VN
    const { service, record, manager, afterAttendance } = attendanceService({
      id: 'as-1',
      status: ShiftAssignmentStatus.CONFIRMED,
      employeeId: 'emp-1',
      checkInTime: new Date('2026-09-21T01:05:00Z'),
      lateMinutes: 5,
      employee: { id: 'emp-1', accountId: 'staff-1', employmentStatus: 'active' },
      shiftSlot: SLOT,
    });

    await service.checkOutWithFace('as-1', Buffer.from('x'), 'staff-1');

    const [usedManager, entry] = record.mock.calls[0];
    expect(usedManager).toBe(manager);
    expect(entry).toMatchObject({
      action: ACTIVITY_ACTIONS.CHECK_OUT,
      idempotencyKey: 'attendance.check_out:as-1',
      params: expect.objectContaining({ checkOutAt: '11:50', earlyMinutes: 10 }),
    });
    expectCleanParams(entry);
    expect(afterAttendance).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'check_out', earlyMinutes: 10 }),
    );
  });

  it('shift registration approved by the owner (processRequest): recorded in the transaction', async () => {
    const { service, record } = makeService();
    const manager = txManager({
      findOne: jest.fn().mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
    });
    service.shiftAssignmentRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'as-9',
        status: ShiftAssignmentStatus.PENDING,
        employeeId: 'emp-1',
        shiftSlot: SLOT,
      }),
    };
    service.storeRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
    };
    service.dataSource = { transaction: jest.fn(async (cb: any) => cb(manager)) };
    service.syncReminderAfterAssignmentStatusChange = jest.fn().mockResolvedValue(undefined);
    service.notifyEmployeesOfNewShifts = jest.fn().mockResolvedValue(undefined);

    await service.processRequest('owner-1', 'as-9', 'REGISTER', 'APPROVED');

    expect(record).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: ACTIVITY_ACTIONS.SHIFT_REGISTRATION_APPROVED,
        actorAccountId: 'owner-1',
        subjectEmployeeProfileId: 'emp-1',
        idempotencyKey: 'shift_registration.approved:as-9',
      }),
    );
  });

  it('leave request rejected by the owner: type and dates only, never the reason', async () => {
    const { service, record } = makeService();
    const manager = txManager({
      findOne: jest.fn().mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
    });
    service.leaveRequestRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'lr-1',
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        type: LeaveType.LATE,
        startDate: '2026-09-22',
        endDate: '2026-09-22',
        reason: 'con ốm',
        status: LeaveRequestStatus.PENDING,
      }),
    };
    service.storeRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'store-1', ownerAccountId: 'owner-1' }),
    };
    service.profileRepository = { findOne: jest.fn().mockResolvedValue(null) };
    service.dataSource = { transaction: jest.fn(async (cb: any) => cb(manager)) };

    await service.processRequest('owner-1', 'lr-1', 'LEAVE', 'REJECTED', 'không');

    const [usedManager, entry] = record.mock.calls[0];
    expect(usedManager).toBe(manager);
    expect(entry).toMatchObject({
      action: ACTIVITY_ACTIONS.LEAVE_REQUEST_REJECTED,
      params: { leaveType: 'LATE', fromDate: '2026-09-22', toDate: '2026-09-22' },
      idempotencyKey: 'leave_request.rejected:lr-1',
    });
    expectCleanParams(entry);
  });

  it('leave request cancelled by the employee: recorded after the write (no transaction)', async () => {
    const { service, record } = makeService();
    const request = {
      id: 'lr-2',
      storeId: 'store-1',
      employeeProfileId: 'emp-1',
      type: LeaveType.SICK,
      startDate: '2026-09-23',
      endDate: '2026-09-24',
      status: LeaveRequestStatus.PENDING,
    };
    service.leaveRequestRepository = {
      findOne: jest.fn().mockResolvedValue(request),
      save: jest.fn(async (value: any) => value),
    };
    service.assertEmployeeSelfAccess = jest.fn().mockResolvedValue({});

    await service.cancelLeaveRequest('lr-2', 'staff-1');

    expect(record).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        action: ACTIVITY_ACTIONS.LEAVE_REQUEST_CANCELLED,
        actorAccountId: 'staff-1',
        idempotencyKey: 'leave_request.cancelled:lr-2',
      }),
    );
  });

  it('salary advance cancelled: no amount in params', async () => {
    const { service, record } = makeService();
    service.salaryAdvanceRequestRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'adv-1',
        employeeProfileId: 'emp-1',
        requestedAmount: 500000,
        status: AdvanceRequestStatus.PENDING,
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    service.profileRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'emp-1', accountId: 'staff-1' }),
    };

    await service.cancelSalaryAdvanceRequest('adv-1', 'staff-1');

    const [, entry] = record.mock.calls[0];
    expect(entry).toMatchObject({
      action: ACTIVITY_ACTIONS.SALARY_ADVANCE_CANCELLED,
      subjectEmployeeProfileId: 'emp-1',
      idempotencyKey: 'salary_advance.cancelled:adv-1',
    });
    expectCleanParams(entry);
  });

  it('payslip paid: month only, never the amount', async () => {
    const { service, record } = makeService();
    service.employeeSalaryRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'sal-1',
        employeeProfileId: 'emp-1',
        month: '2026-09-01',
        netSalary: 7000000,
        paymentStatus: PaymentStatus.PENDING,
        monthlyPayroll: { storeId: 'store-1' },
      }),
      save: jest.fn(async (value: any) => value),
    };
    service.storePaymentAccountRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'pa-1', bankName: 'B', accountNumber: '123456' }),
    };
    service.storeRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'store-1', name: 'S' }),
    };
    service.employeePaymentHistoryRepository = {
      create: jest.fn((value: any) => value),
      save: jest.fn(async (value: any) => value),
    };

    await service.payEmployeeSalary('sal-1', { paymentAccountId: 'pa-1' }, 'owner-1');

    const [usedManager, entry] = record.mock.calls[0];
    expect(usedManager).toBeNull();
    expect(entry).toMatchObject({
      storeId: 'store-1',
      actorAccountId: 'owner-1',
      action: ACTIVITY_ACTIONS.PAYSLIP_PAID,
      params: { month: '2026-09' },
      idempotencyKey: 'payslip.paid:sal-1',
    });
    expectCleanParams(entry);
  });

  it('asset returned: recorded in the return transaction', async () => {
    const { service, record } = makeService();
    const assignment = {
      id: 'ea-1',
      assetId: 'asset-1',
      employeeProfileId: 'emp-1',
      quantity: 2,
      status: AssetAssignmentStatus.ASSIGNED,
    };
    const lockedBuilder = (value: any) => ({
      where: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(value),
    });
    const manager = txManager({
      getRepository: jest.fn((entity: any) => ({
        createQueryBuilder: jest.fn(() =>
          lockedBuilder(entity?.name === 'Asset' ? { id: 'asset-1', currentStock: 1 } : assignment),
        ),
      })),
      findOne: jest.fn().mockResolvedValue({ id: 'asset-1', name: 'Áo đồng phục' }),
    });
    service.dataSource = { transaction: jest.fn(async (cb: any) => cb(manager)) };

    await service.returnAsset('ea-1', AssetAssignmentStatus.RETURNED, 'ok', 'owner-1');

    expect(record).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: ACTIVITY_ACTIONS.ASSET_RETURNED,
        actorAccountId: 'owner-1',
        params: { assetName: 'Áo đồng phục', quantity: 2, assetStatus: 'RETURNED' },
        idempotencyKey: 'asset.returned:ea-1',
      }),
    );
  });

  it('employee removed: recorded in the termination transaction, without the reason', async () => {
    const { service, record } = makeService();
    const profile = { id: 'emp-1', storeId: 'store-1', accountId: 'staff-1' };
    service.profileRepository = { findOne: jest.fn().mockResolvedValue({ ...profile }) };
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue({});
    service.terminationReasonRepository = { findOne: jest.fn().mockResolvedValue({ id: 'r-1' }) };
    const manager = txManager({
      findOne: jest.fn(async (entity: any) => {
        if (entity?.name === 'EmployeeProfile') return { ...profile };
        if (entity?.name === 'Store') return { id: 'store-1', ownerAccountId: 'owner-1' };
        return { id: 'r-1', name: 'Lý do riêng tư' };
      }),
    });
    service.dataSource = { transaction: jest.fn(async (cb: any) => cb(manager)) };
    service.cancelFutureShiftAssignments = jest.fn().mockResolvedValue([]);
    service.closePendingRequestsOfLeaver = jest.fn().mockResolvedValue(undefined);
    service.removeStoreGroupChatMemberships = jest.fn().mockResolvedValue({});

    await service.deleteEmployee('emp-1', 'r-1', 'owner-1');

    const [usedManager, entry] = record.mock.calls[0];
    expect(usedManager).toBe(manager);
    expect(entry).toMatchObject({
      action: ACTIVITY_ACTIONS.EMPLOYEE_REMOVED,
      actorAccountId: 'owner-1',
      subjectEmployeeProfileId: 'emp-1',
    });
    expect(entry.idempotencyKey).toMatch(/^employee\.removed:emp-1:\d+$/);
    expect(entry.params ?? {}).toEqual({});
  });

  it('bonus work request cancelled: recorded with request date and times', async () => {
    const { service, record } = makeService();
    service.bonusWorkRequestRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'bw-1',
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        requestDate: '2026-09-21',
        startTime: '12:00:00',
        endTime: '13:30:00',
        reason: 'riêng tư',
        status: BonusWorkRequestStatus.PENDING,
      }),
      save: jest.fn(async (value: any) => value),
    };
    service.profileRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'emp-1', accountId: 'staff-1' }),
    };

    await service.cancelBonusWorkRequest('bw-1', 'staff-1');

    const [, entry] = record.mock.calls[0];
    expect(entry).toMatchObject({
      action: ACTIVITY_ACTIONS.BONUS_WORK_REQUEST_CANCELLED,
      params: { requestDate: '2026-09-21', startTime: '12:00', endTime: '13:30' },
    });
    expectCleanParams(entry);
  });

  it('salary advance created: month only, never the amount or the reason', async () => {
    const { service, record } = makeService();
    service.employeeSalaryRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'sal-1',
        employeeProfileId: 'emp-1',
        month: '2026-09-01',
        netSalary: 7000000,
        employeeProfile: { id: 'emp-1', storeId: 'store-1' },
      }),
    };
    service.salaryAdvanceRequestRepository = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((value: any) => value),
      save: jest.fn(async (value: any) => ({ id: 'adv-2', ...value })),
    };

    await service.createSalaryAdvanceRequest(
      'emp-1',
      { employeeSalaryId: 'sal-1', requestedAmount: 500000, requestReason: 'ốm' },
      'staff-1',
    );

    const [, entry] = record.mock.calls[0];
    expect(entry).toMatchObject({
      storeId: 'store-1',
      actorAccountId: 'staff-1',
      action: ACTIVITY_ACTIONS.SALARY_ADVANCE_CREATED,
      params: { month: '2026-09' },
      idempotencyKey: 'salary_advance.created:adv-2',
    });
    expectCleanParams(entry);
  });

  it('employee hired from a job application: employee.added (source application) in the hire transaction', async () => {
    const { service, record } = makeService();
    const joinedAt = new Date('2026-09-21T02:00:00Z');
    const account = { id: 'acc-9', status: AccountStatus.ACTIVE };
    const manager = txManager({
      findOne: jest.fn(async (entity: any) =>
        entity?.name === 'Store'
          ? { id: 'store-1', ownerAccountId: 'owner-1' }
          : account,
      ),
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => ({
          withDeleted: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([
            {
              id: 'emp-9',
              storeId: 'store-1',
              accountId: 'acc-9',
              employmentStatus: 'pending',
              deletedAt: null,
            },
          ]),
        })),
      })),
    });
    service.assertOwnerStoreAccess = jest.fn().mockResolvedValue({});
    service.dataSource = { transaction: jest.fn(async (cb: any) => cb(manager)) };
    service.initializeEmployeeProfile = jest.fn().mockResolvedValue({
      profile: { id: 'emp-9', joinedAt },
      currentMonthPayslipLocked: false,
    });
    service.getEmployeeById = jest.fn().mockResolvedValue({ profile: { id: 'emp-9' } });

    await service.addEmployee('store-1', 'acc-9', {}, 'owner-1');

    expect(record).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: ACTIVITY_ACTIONS.EMPLOYEE_ADDED,
        actorAccountId: 'owner-1',
        subjectEmployeeProfileId: 'emp-9',
        params: { source: 'application' },
        idempotencyKey: `employee.added:emp-9:${joinedAt.getTime()}`,
      }),
    );
  });

  it('without an ActivityLogService (hand-built instances) hooks are no-ops', async () => {
    const service = Object.create(StoresService.prototype) as any;
    await expect(
      service.logActivity(null, {
        actorAccountId: 'a',
        action: 'x',
        resourceType: 'employee',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('career advance hook', () => {
  it('records career.advanced in the advance transaction with ladder and rung names', async () => {
    const service = Object.create(CareerLadderService.prototype) as any;
    const record = jest.fn().mockResolvedValue(undefined);
    service.activityLogService = { record };
    service.logger = { warn: jest.fn(), log: jest.fn() };
    const profile = { id: 'emp-1', storeId: 'store-1', accountId: 'staff-1' };
    const ladder = { id: 'lad-1', storeId: 'store-1', name: 'Vị trí', dimension: 'position' };
    const rung = { id: 'rung-2', ladderId: 'lad-1', targetId: 'role-2', resetsLadderId: null };
    const manager = {
      findOne: jest.fn(async (entity: any) => {
        switch (entity?.name) {
          case 'EmployeeProfile':
            return { ...profile };
          case 'StoreLadderRung':
            return rung;
          case 'StoreLadder':
            return ladder;
          case 'StoreLadderEdge':
            return { id: 'edge-1' };
          default:
            return null;
        }
      }),
      save: jest.fn(async (_entity: any, value: any) => ({ id: 'ev-1', ...value })),
      create: jest.fn((_entity: any, value: any) => value),
    };
    service.dataSource = { transaction: jest.fn(async (cb: any) => cb(manager)) };
    service.currentRung = jest.fn().mockResolvedValue({ id: 'rung-1' });
    service.evaluateRung = jest.fn().mockResolvedValue({ passed: true, items: [] });
    service.profileColumn = jest.fn(() => 'storeRoleId');
    service.targetNames = jest.fn().mockResolvedValue(new Map([['role-2', 'Trưởng ca']]));
    service.notifyAdvanced = jest.fn().mockResolvedValue(undefined);

    await service.advance('emp-1', 'rung-2', 'owner-1', { note: 'ghi chú riêng' });

    expect(record).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: ACTIVITY_ACTIONS.CAREER_ADVANCED,
        actorAccountId: 'owner-1',
        subjectEmployeeProfileId: 'emp-1',
        resourceId: 'ev-1',
        params: { ladderName: 'Vị trí', rungName: 'Trưởng ca' },
        idempotencyKey: 'career.advanced:ev-1',
      }),
    );
  });
});
