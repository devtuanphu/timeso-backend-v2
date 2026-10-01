/**
 * "GPS + QR (không cần FaceID)": a GPS_QR store accepts check-in/out without
 * a face photo, but then the store QR and a location inside the radius are
 * always required — even with ATTENDANCE_ENFORCEMENT_MODE off. Any other
 * store still needs the photo, and a photo sent to a GPS_QR store is still
 * verified.
 */
import { BadRequestException } from '@nestjs/common';

import { AttendanceMethod } from './entities/attendance-log.entity';
import { TimekeepingRequirement } from './entities/store-shift-config.entity';
import {
  AttendanceStatus,
  ShiftAssignmentStatus,
} from './entities/shift-management.entity';
import { parseAttendanceCoordinate } from './attendance-enforcement';
import { STORE_LOCATION_REQUIRED_CODE, StoresService } from './stores.service';

const STORE = 'store-1';
// Store at 10.0, 106.0; ~11 m and ~111 m north of it.
const STORE_AT = { latitude: 10, longitude: 106 };
const NEAR = { latitude: 10.0001, longitude: 106 };
const FAR = { latitude: 10.001, longitude: 106 };

const SLOT = {
  workDate: '2026-10-01',
  startTime: null,
  endTime: null,
  cycle: { storeId: STORE },
  workShift: { shiftName: 'Sáng', startTime: '08:00:00', endTime: '12:00:00' },
};
const vn = (clock: string) => new Date(`2026-10-01T${clock}:00+07:00`);

function build(opts: {
  requirement?: TimekeepingRequirement | null;
  store?: Record<string, unknown> | null;
  assignment?: Record<string, unknown>;
}) {
  const service = Object.create(StoresService.prototype) as any;
  service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  service.activityLogService = { record: jest.fn().mockResolvedValue(undefined) };
  service.shiftAssignmentRepository = {
    findOne: jest.fn().mockResolvedValue({
      id: 'as-1',
      status: ShiftAssignmentStatus.APPROVED,
      employeeId: 'emp-1',
      checkInTime: null,
      employee: { id: 'emp-1', accountId: 'staff-1', employmentStatus: 'active' },
      shiftSlot: SLOT,
      ...opts.assignment,
    }),
  };
  service.timekeepingSettingRepository = {
    findOne: jest.fn().mockResolvedValue({
      attendanceRadius: 50,
      // Owner toggles do not loosen the no-photo checks.
      requireQrScan: false,
      requireLocation: false,
      locationExceptionEmployeeIds: ['emp-1'],
    }),
  };
  service.shiftConfigRepository = {
    findOne: jest.fn().mockResolvedValue(
      opts.requirement === null
        ? null
        : { timekeepingRequirement: opts.requirement ?? TimekeepingRequirement.GPS_QR },
    ),
  };
  service.storeRepository = {
    findOne: jest
      .fn()
      .mockResolvedValue(opts.store === undefined ? { id: STORE, ...STORE_AT } : opts.store),
  };
  service.employeeFaceRepository = {
    findOne: jest.fn().mockResolvedValue({ faceDescriptors: [[0.1]] }),
  };
  service.faceRecognitionService = {
    extractDescriptor: jest.fn().mockResolvedValue([0.1]),
    compareFaces: jest.fn().mockReturnValue({ matched: true, distance: 0.2 }),
  };
  const set = jest.fn().mockReturnThis();
  const queryBuilder: any = {
    update: jest.fn().mockReturnThis(),
    set,
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const logs: any[] = [];
  const manager = {
    create: jest.fn((_entity: unknown, data: any) => {
      logs.push(data);
      return { ...data };
    }),
    save: jest.fn(async (_entity: unknown, value: any) => value),
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn(() => queryBuilder),
  };
  service.dataSource = { transaction: jest.fn(async (cb: any) => cb(manager)) };
  service.profileRepository = { update: jest.fn().mockResolvedValue({}) };
  // No approved overtime unless a test says so.
  service.bonusWorkRequestRepository = { findOne: jest.fn().mockResolvedValue(null) };
  service.appendToDailyReport = jest.fn();
  service.processCheckoutPayroll = jest.fn().mockResolvedValue(undefined);
  service.ownerNotificationService = { afterAttendance: jest.fn().mockResolvedValue(undefined) };
  return { service, written: () => set.mock.calls[0]?.[0], logs };
}

describe('attendance without a face photo', () => {
  const previousMode = process.env.ATTENDANCE_ENFORCEMENT_MODE;
  beforeEach(() => {
    delete process.env.ATTENDANCE_ENFORCEMENT_MODE; // observation mode
    jest.useFakeTimers({
      now: vn('08:00'),
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    if (previousMode === undefined) delete process.env.ATTENDANCE_ENFORCEMENT_MODE;
    else process.env.ATTENDANCE_ENFORCEMENT_MODE = previousMode;
  });

  it('checks in a GPS_QR store with its QR inside the radius, no face step', async () => {
    const { service, written, logs } = build({});

    const result = await service.checkInWithFace('as-1', null, 'staff-1', {
      qrStoreId: STORE,
      ...NEAR,
    });

    expect(result).toMatchObject({
      matched: true,
      distance: null,
      attendanceStatus: AttendanceStatus.ON_TIME,
    });
    expect(written()).toMatchObject({ status: ShiftAssignmentStatus.CONFIRMED });
    expect(logs[0]).toMatchObject({ method: AttendanceMethod.QR_GPS });
    expect(logs[0].faceMatchScore).toBeUndefined();
    expect(service.employeeFaceRepository.findOne).not.toHaveBeenCalled();
    expect(service.faceRecognitionService.extractDescriptor).not.toHaveBeenCalled();
  });

  it('checks out a GPS_QR store without a face photo', async () => {
    jest.setSystemTime(vn('12:00'));
    const { service, written, logs } = build({
      assignment: {
        status: ShiftAssignmentStatus.CONFIRMED,
        checkInTime: vn('08:00'),
        lateMinutes: 0,
        attendanceStatus: AttendanceStatus.ON_TIME,
      },
    });

    await service.checkOutWithFace('as-1', null, 'staff-1', {
      qrStoreId: STORE,
      ...NEAR,
    });

    expect(written()).toMatchObject({
      status: ShiftAssignmentStatus.COMPLETED,
      workedMinutes: 240,
    });
    expect(logs[0]).toMatchObject({ method: AttendanceMethod.QR_GPS });
  });

  const refused = async (
    opts: Parameters<typeof build>[0],
    request: Record<string, unknown>,
    code: string,
  ) => {
    const { service, written } = build(opts);
    const attempt = service.checkInWithFace('as-1', null, 'staff-1', request);
    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toMatchObject({ response: { code } });
    expect(written()).toBeUndefined();
  };

  it('still needs the face photo in any other store mode', async () => {
    await refused(
      { requirement: TimekeepingRequirement.LOCATION_QR_GPS_FACEID },
      { qrStoreId: STORE, ...NEAR },
      'ATTENDANCE_FACE_REQUIRED',
    );
    await refused({ requirement: null }, { qrStoreId: STORE, ...NEAR }, 'ATTENDANCE_FACE_REQUIRED');
  });

  it('requires the QR even with enforcement off and the QR toggle off', async () => {
    await refused({}, { ...NEAR }, 'ATTENDANCE_QR_REQUIRED');
    await refused({}, { qrStoreId: 'store-2', ...NEAR }, 'ATTENDANCE_QR_MISMATCH');
  });

  it('requires a location inside the radius, ignoring the exemption list', async () => {
    await refused({}, { qrStoreId: STORE }, 'ATTENDANCE_LOCATION_REQUIRED');
    await refused({}, { qrStoreId: STORE, ...FAR }, 'ATTENDANCE_OUT_OF_RANGE');
  });

  it('refuses unusable coordinates instead of passing them as inside', async () => {
    await refused(
      {},
      { qrStoreId: STORE, latitude: Number.NaN, longitude: Number.NaN },
      'ATTENDANCE_LOCATION_REQUIRED',
    );
  });

  it('refuses when the store has no coordinates', async () => {
    await refused(
      { store: { id: STORE, latitude: null, longitude: null } },
      { qrStoreId: STORE, ...NEAR },
      'ATTENDANCE_STORE_LOCATION_MISSING',
    );
  });

  it('still verifies a face photo sent to a GPS_QR store (older staff app)', async () => {
    const { service, logs } = build({});

    await service.checkInWithFace('as-1', Buffer.from('x'), 'staff-1', {
      qrStoreId: STORE,
      ...NEAR,
    });

    expect(service.faceRecognitionService.extractDescriptor).toHaveBeenCalled();
    expect(logs[0]).toMatchObject({ method: AttendanceMethod.FACE, faceMatchScore: 0.2 });
  });
});

describe('choosing GPS + QR for a store', () => {
  const buildConfig = (store: Record<string, unknown> | null) => {
    const service = Object.create(StoresService.prototype) as any;
    service.storeRepository = { findOne: jest.fn().mockResolvedValue(store) };
    service.shiftConfigRepository = {
      findOne: jest.fn().mockResolvedValue({ storeId: STORE }),
      save: jest.fn(async (value: unknown) => value),
    };
    return service;
  };

  it('needs the store location first', async () => {
    const service = buildConfig({ id: STORE, latitude: null, longitude: null });

    await expect(
      service.upsertShiftConfig(STORE, {
        timekeepingRequirement: TimekeepingRequirement.GPS_QR,
      }),
    ).rejects.toMatchObject({ response: { code: STORE_LOCATION_REQUIRED_CODE } });
    expect(service.shiftConfigRepository.save).not.toHaveBeenCalled();
  });

  it('saves it for a store with a location', async () => {
    const service = buildConfig({ id: STORE, ...STORE_AT });

    await expect(
      service.upsertShiftConfig(STORE, {
        timekeepingRequirement: TimekeepingRequirement.GPS_QR,
      }),
    ).resolves.toMatchObject({ timekeepingRequirement: TimekeepingRequirement.GPS_QR });
  });

  it('does not look at the location for the other modes', async () => {
    const service = buildConfig(null);

    await service.upsertShiftConfig(STORE, {
      timekeepingRequirement: TimekeepingRequirement.QR_ONLY,
    });

    expect(service.storeRepository.findOne).not.toHaveBeenCalled();
  });
});

describe('parseAttendanceCoordinate', () => {
  it('keeps a missing coordinate missing', () => {
    expect(parseAttendanceCoordinate(undefined, 90)).toBeUndefined();
    expect(parseAttendanceCoordinate('', 90)).toBeUndefined();
  });

  it('reads a real coordinate', () => {
    expect(parseAttendanceCoordinate('10.8231', 90)).toBe(10.8231);
    expect(parseAttendanceCoordinate('-179.5', 180)).toBe(-179.5);
  });

  it('refuses NaN, Infinity and out-of-range values', () => {
    for (const value of ['abc', 'NaN', '1e999', '-Infinity', '91']) {
      expect(() => parseAttendanceCoordinate(value, 90)).toThrow(BadRequestException);
    }
  });
});
