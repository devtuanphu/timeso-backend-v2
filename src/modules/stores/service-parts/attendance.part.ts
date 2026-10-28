import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { In, MoreThanOrEqual, LessThanOrEqual, EntityManager } from 'typeorm';
import * as QRCode from 'qrcode';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { Store } from '../entities/store.entity';
import {
  EmploymentStatus,
  WorkingStatus,
} from '../entities/employee-profile.entity';
import { PaymentType } from '../entities/employee-contract.entity';
import { WorkShift } from '../entities/work-shift.entity';
import { LeaveRequestStatus } from '../entities/employee-leave-request.entity';
import { currentStintSql } from '../employment-stint.utils';
import {
  AttendanceLog,
  AttendanceLogType,
  AttendanceMethod,
} from '../entities/attendance-log.entity';
import { AttendanceStatus } from '../entities/shift-management.entity';
import {
  ShiftAssignment,
  WorkCycleStatus,
  ShiftAssignmentStatus,
} from '../entities/shift-management.entity';
import {
  DEFAULT_MAX_OVERTIME_MINUTES,
  StoreTimekeepingSettingDto,
} from '../dto/store-timekeeping-setting.dto';
import { WORK_SHIFT_TIME_MESSAGE } from '../dto/work-shift.dto';
import { lockStoreShiftAvailability } from '../shift-availability-lock';
import { getTodayDateString } from '../shift-schedule.utils';
import { parseVietnamShiftStart } from '../shift-reminder.utils';
import {
  isShiftCoveredByApprovedLeave,
  leaveCoversShift,
} from '../leave-coverage.utils';
import { StoreTimekeepingSetting } from '../entities/store-timekeeping-setting.entity';
import { ACTIVITY_ACTIONS } from '../activity-log.summary';
import { calculateShiftEarnings } from '../shift-earnings.utils';
import { validateStoreReportDate } from '../store-report-date.utils';
import {
  parseVnMonthInput,
  toMonthMarker,
  vnClockHHmm,
  vnDateString,
  vnMiddayInstant,
  VnMonth,
  vnMonthOf,
  vnMonthOfDateString,
} from '../../../common/utils/vn-calendar';
import {
  calculateEarlyMinutes,
  calculateLateMinutes,
  computeAttendanceDeltas,
  effectiveWindowOf,
  resolveShiftBoundaries,
} from '../attendance-time.utils';
import {
  applyGrace,
  AttendanceRules,
  checkInOpensAt,
  creditedWorkedMinutes,
  resolveAttendanceRules,
} from '../attendance-rules';
import { StoreWorkedTimeRule } from '../entities/store-worked-time-rule.entity';
import {
  resolveWorkedTimeMode,
  ruleBounds,
  ruleWindowEnd,
  ruleWindowsOverlap,
  shiftStartKey,
  TIME_KEY,
  vnKeyCeil,
  type WorkedTimeMode,
  type WorkedTimePeriod,
} from '../worked-time-rules';
import {
  describeAttendanceViolation,
  evaluateAttendanceRules,
  evaluateFacelessAttendance,
  resolveAttendanceEnforcementMode,
} from '../attendance-enforcement';
import { randomUUID } from 'crypto';
import {
  normalizeActiveShiftName,
  CHECK_IN_TOO_EARLY_CODE,
  sameShiftTime,
  normalizeWorkShiftTime,
} from './shared';
import type { StoresService } from '../stores.service';

/**
 * A time from the legacy bulk settings save (older owner builds sent
 * free-typed text). An echo of the stored value, or a missing one, is "no
 * change" (undefined). "H:mm", "HH:mm" and "HH:mm:ss" are padded to
 * "HH:mm:ss" ("8:30" → "08:30:00"); anything else is a 400.
 */
const legacyBulkShiftTime = (
  value: unknown,
  stored: string,
): string | undefined => {
  if (value === undefined || value === null || value === stored) {
    return undefined;
  }
  const match =
    typeof value === 'string'
      ? /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
      : null;
  const [hour, minute, second] = match
    ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)]
    : [NaN, NaN, NaN];
  if (!(hour <= 23 && minute <= 59 && second <= 59)) {
    throw new BadRequestException(WORK_SHIFT_TIME_MESSAGE);
  }
  const pad = (part: number) => String(part).padStart(2, '0');
  const normalized = `${pad(hour)}:${pad(minute)}:${pad(second)}`;
  const storedNormalized = normalizeWorkShiftTime(stored);
  return normalized === storedNormalized ? undefined : normalized;
};

const assertShiftNamesPresent = (
  shifts: Array<{ shiftName: string; isActive?: boolean }>,
) => {
  if (
    shifts
      .filter((shift) => shift.isActive !== false)
      .some((shift) => !normalizeActiveShiftName(shift.shiftName))
  ) {
    throw new BadRequestException('Tên ca là bắt buộc');
  }
};

const DEFAULT_TIMEKEEPING_SHIFTS = [
  {
    shiftName: 'Ca sáng (fulltime)',
    startTime: '07:00:00',
    endTime: '17:00:00',
  },
  {
    shiftName: 'Ca chiều (fulltime)',
    startTime: '12:00:00',
    endTime: '20:00:00',
  },
  {
    shiftName: 'Ca tối (parttime)',
    startTime: '18:00:00',
    endTime: '22:00:00',
  },
] as const;

const defaultTimekeepingSettingData = (storeId: string) => ({
  storeId,
  enableFlexibleShift: false,
  requireLocation: true,
  attendanceRadius: 50,
  requireQrScan: true,
  locationExceptionEmployeeIds: [] as string[],
  allowedLateMinutes: 0,
  deductWorkTimeIfLate: true,
  showLateAlert: true,
  countFullTimeIfLate: false,
  earlyCheckinMinutes: 15,
  lateCheckoutMinutes: 15,
  maxOvertimeMinutes: DEFAULT_MAX_OVERTIME_MINUTES,
  enableOvertimeMultiplier: false,
  overtimeMultiplier: 1.5,
  notifyLateShift: false,
  isActive: true,
});

/**
 * StoresAttendancePart: attendance methods of StoresService, split out of stores.service.ts.
 * They still live on StoresService.prototype (applyClassParts), so DI, callers
 * and routes are unchanged; `this` is the StoresService instance.
 */
export class StoresAttendancePart {
  /**
   * The store's worked-time rules, removed ones included (they still cover
   * the shifts that started before their removal); [] when unavailable, so
   * the default applies.
   */
  async loadWorkedTimeRules(
    this: StoresService,
    storeId: string | null | undefined,
  ): Promise<StoreWorkedTimeRule[]> {
    if (!storeId || !this.workedTimeRuleRepository) return [];
    try {
      return await this.workedTimeRuleRepository.find({
        where: { storeId },
        withDeleted: true,
        order: { createdAt: 'ASC' },
      });
    } catch {
      this.logger.warn('Worked-time rules unavailable, using the default');
      return [];
    }
  }

  /** "Cách tính giờ công" rules of the store, newest first (owner only). */
  async listWorkedTimeRules(
    this: StoresService,
    storeId: string,
    ownerAccountId: string,
  ) {
    await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    if (!this.workedTimeRuleRepository) return [];
    try {
      return await this.workedTimeRuleRepository.find({
        where: { storeId },
        order: { createdAt: 'DESC' },
      });
    } catch {
      this.logger.warn('Worked-time rules unavailable, listing none');
      return [];
    }
  }

  /**
   * Adds a rule (store-wide, or for one or more employees of the store) for
   * the shifts starting from its start date and time. Only shifts not started
   * yet are affected: the start may not be in the past (a start up to 15
   * minutes ago means "now"), and nothing already worked is recomputed.
   * Several employees get one row each, sharing a group id. Only one rule may
   * be in force at a time for the whole store, and one for each employee:
   * an overlapping rule is refused (an employee rule may sit inside a
   * store-wide one).
   */
  async createWorkedTimeRule(
    this: StoresService,
    storeId: string,
    data: {
      mode: WorkedTimeMode;
      period: WorkedTimePeriod;
      startDate: string;
      startTime?: string | null;
      employeeProfileIds?: string[] | null;
      employeeProfileId?: string | null;
    },
    ownerAccountId: string,
  ) {
    await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    if (!this.workedTimeRuleRepository) {
      throw new BadRequestException(
        'Chưa thể lưu cách tính giờ công. Vui lòng thử lại sau.',
      );
    }
    const employeeIds = [
      ...new Set(
        [...(data.employeeProfileIds ?? []), data.employeeProfileId].filter(
          (id): id is string => !!id,
        ),
      ),
    ];
    const employeeNames = new Map<string, string>();
    if (employeeIds.length) {
      const profiles = await this.profileRepository.find({
        where: { id: In(employeeIds), storeId },
        relations: { account: true },
        // Only the name, for an overlap message.
        select: { id: true, account: { id: true, fullName: true } },
      });
      for (const profile of profiles) {
        employeeNames.set(profile.id, profile.account?.fullName || 'Nhân viên');
      }
      if (profiles.length !== employeeIds.length) {
        throw new BadRequestException({
          code: 'WORKED_TIME_RULE_EMPLOYEE_NOT_IN_STORE',
          message: 'Nhân viên không thuộc cửa hàng này.',
        });
      }
    }
    let startDate = String(data.startDate).slice(0, 10);
    const [y, m, d] = startDate.split('-').map(Number);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== startDate
    ) {
      throw new BadRequestException('Ngày bắt đầu không hợp lệ.');
    }
    const nowKey = vnKeyCeil(new Date());
    let startTime: string;
    if (data.startTime) {
      startTime = String(data.startTime).slice(0, 5);
    } else if (startDate === vnDateString(new Date())) {
      // Apps sending a date only, for today: from now (at 23:59:30 that is
      // 00:00 the next day).
      [startDate, startTime] = nowKey.split(' ');
    } else {
      // A later day: from its start.
      startTime = '00:00';
    }
    if (!TIME_KEY.test(startTime)) {
      throw new BadRequestException('Giờ bắt đầu không hợp lệ (HH:mm).');
    }
    if (`${startDate} ${startTime}` < nowKey) {
      const graceKey = vnKeyCeil(new Date(Date.now() - 15 * 60_000));
      if (`${startDate} ${startTime}` < graceKey) {
        throw new BadRequestException({
          code: 'WORKED_TIME_RULE_START_IN_PAST',
          message:
            'Thời điểm bắt đầu đã qua. Cách tính mới chỉ áp dụng cho các ca chưa bắt đầu.',
        });
      }
      // Picked a moment ago (form left open): from now, so a shift that
      // started in between is not affected.
      [startDate, startTime] = nowKey.split(' ');
    }
    const end = ruleWindowEnd(startDate, startTime, data.period);
    const window = {
      start: `${startDate} ${startTime}`,
      end: end ? `${end.endDate} ${end.endTime}` : null,
    };
    const groupId = randomUUID();
    const rules = await this.dataSource.transaction(async (manager) => {
      // One writer per store: two overlapping rules saved at once cannot
      // both pass the check below.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`worked-time-rules:${storeId}`],
      );
      const repo = manager.getRepository(StoreWorkedTimeRule);
      const inForce = await repo.find({ where: { storeId } });
      const overlapping = inForce.filter((rule) =>
        ruleWindowsOverlap(window, ruleBounds(rule)),
      );
      if (!employeeIds.length) {
        if (overlapping.some((rule) => !rule.employeeProfileId)) {
          throw new BadRequestException({
            code: 'WORKED_TIME_RULE_OVERLAP',
            message:
              'Toàn cửa hàng đã có cách tính giờ công trong khoảng thời gian này. Mỗi thời điểm chỉ được có một cách tính, vui lòng xoá cách tính cũ hoặc chọn thời gian khác.',
          });
        }
      } else {
        const taken = employeeIds.filter((id) =>
          overlapping.some((rule) => rule.employeeProfileId === id),
        );
        if (taken.length) {
          const names = taken.map((id) => employeeNames.get(id) || 'Nhân viên');
          throw new BadRequestException({
            code: 'WORKED_TIME_RULE_OVERLAP',
            message: `${names.join(', ')} đã có cách tính giờ công trong khoảng thời gian này. Mỗi thời điểm chỉ được có một cách tính, vui lòng xoá cách tính cũ, bỏ chọn nhân viên này hoặc chọn thời gian khác.`,
            employeeProfileIds: taken,
          });
        }
      }
      // save() of a list writes all rows together.
      return repo.save(
        (employeeIds.length ? employeeIds : [null]).map((employeeProfileId) =>
          repo.create({
            storeId,
            employeeProfileId,
            groupId,
            mode: data.mode,
            period: data.period,
            startDate,
            startTime,
            endDate: end?.endDate ?? null,
            endTime: end?.endTime ?? null,
            createdByAccountId: ownerAccountId,
          }),
        ),
      );
    });
    return { rule: rules[0], rules };
  }

  /**
   * The rule and the rows saved with it (same group), or [] when it does not
   * exist in the store.
   */
  async findWorkedTimeRuleGroup(
    this: StoresService,
    storeId: string,
    ruleId: string,
  ): Promise<StoreWorkedTimeRule[]> {
    const repo = this.workedTimeRuleRepository;
    if (!repo) return [];
    const rule = await repo.findOne({ where: { id: ruleId, storeId } });
    if (!rule) return [];
    if (!rule.groupId) return [rule];
    const group = await repo.find({
      where: { storeId, groupId: rule.groupId },
    });
    return group.length ? group : [rule];
  }

  /**
   * Removes a rule with the rows saved with it. It keeps covering the shifts
   * that started before now (under way or done stay as they are); shifts
   * starting later follow the remaining rules or the default.
   */
  async deleteWorkedTimeRule(
    this: StoresService,
    storeId: string,
    ruleId: string,
    ownerAccountId: string,
  ) {
    await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    const rules = await this.findWorkedTimeRuleGroup(storeId, ruleId);
    if (!rules.length)
      throw new NotFoundException('Không tìm thấy cách tính giờ công này');
    // The removal instant is the cut-off, so it is written from this
    // process's clock (as created_at is) rather than the database's.
    await this.workedTimeRuleRepository!.update(
      { id: In(rules.map((r) => r.id)), storeId },
      { deletedAt: new Date() },
    );
    return { id: ruleId, deletedIds: rules.map((r) => r.id), deleted: true };
  }

  /**
   * How worked time is counted for that employee's shift, from its work date
   * and scheduled start time.
   */
  async workedTimeModeFor(
    this: StoresService,
    storeId: string | null | undefined,
    employeeProfileId: string | null | undefined,
    slot:
      | {
          workDate?: string | Date | null;
          startTime?: string | null;
          workShift?: { startTime?: string | null } | null;
        }
      | null
      | undefined,
  ): Promise<WorkedTimeMode> {
    const key = shiftStartKey(
      slot?.workDate,
      slot?.startTime || slot?.workShift?.startTime,
    );
    // No work date: count strictly to the schedule.
    if (!key) return 'SHIFT';
    return resolveWorkedTimeMode(
      await this.loadWorkedTimeRules(storeId),
      employeeProfileId,
      key,
    );
  }

  async ensureDefaultTimekeepingSetting(
    this: StoresService,
    manager: EntityManager,
    storeId: string,
  ) {
    let setting = await manager.findOne(StoreTimekeepingSetting, {
      where: { storeId },
    });
    const existingShifts = await manager.find(WorkShift, {
      where: { storeId },
    });
    assertShiftNamesPresent(existingShifts);
    if (setting) return { setting, shifts: existingShifts };

    const finalActiveShifts = existingShifts.filter((shift) => shift.isActive);
    const createdShifts: WorkShift[] = [];
    for (const defaultShift of DEFAULT_TIMEKEEPING_SHIFTS) {
      const normalizedName = normalizeActiveShiftName(defaultShift.shiftName);
      const existingActive = finalActiveShifts.find(
        (shift) => normalizeActiveShiftName(shift.shiftName) === normalizedName,
      );
      if (existingActive) {
        if (
          !sameShiftTime(existingActive.startTime, defaultShift.startTime) ||
          !sameShiftTime(existingActive.endTime, defaultShift.endTime)
        ) {
          throw new BadRequestException(
            `Ca mặc định ${defaultShift.shiftName} đã tồn tại với thời gian không tương thích`,
          );
        }
        continue;
      }
      const newShift = manager.create(WorkShift, {
        storeId,
        ...defaultShift,
        isActive: true,
      });
      await manager.save(WorkShift, newShift);
      finalActiveShifts.push(newShift);
      createdShifts.push(newShift);
    }
    assertShiftNamesPresent(finalActiveShifts);

    setting = manager.create(
      StoreTimekeepingSetting,
      defaultTimekeepingSettingData(storeId),
    );
    setting = await manager.save(StoreTimekeepingSetting, setting);
    return { setting, shifts: existingShifts.concat(createdShifts) };
  }

  async createDefaultTimekeepingSetting(this: StoresService, storeId: string) {
    return this.dataSource.transaction(async (manager) => {
      await lockStoreShiftAvailability(manager, storeId);
      return this.ensureDefaultTimekeepingSetting(manager, storeId);
    });
  }

  /**
   * Attendance is a self-service action: only the employee who owns the shift
   * assignment may check in or out on it. Owners have separate manual-attendance
   * routes and must never be able to drive face attendance for someone else.
   */
  assertAttendanceSelfAccess(
    this: StoresService,
    assignment: ShiftAssignment,
    accountId: string,
  ) {
    const employee = assignment.employee;
    if (!accountId || !employee || employee.accountId !== accountId) {
      throw new ForbiddenException(
        'Bạn chỉ có thể chấm công cho ca làm việc của chính mình',
      );
    }
    if (employee.employmentStatus === EmploymentStatus.TERMINATED) {
      throw new ForbiddenException(
        'Nhân viên đã ngừng làm việc tại cửa hàng này',
      );
    }
    return employee;
  }

  // --- Timekeeping Settings ---
  async assertTimekeepingSettingsReadAccess(
    this: StoresService,
    storeId: string,
    accountId?: string,
  ): Promise<'OWNER' | 'STAFF'> {
    if (!accountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      select: ['id', 'ownerAccountId'],
    });
    if (!store) throw new NotFoundException('Cửa hàng không tồn tại');
    if (store.ownerAccountId === accountId) return 'OWNER';
    const staff = await this.profileRepository.findOne({
      where: {
        storeId,
        accountId,
        employmentStatus: EmploymentStatus.ACTIVE,
      },
      select: ['id'],
    });
    if (!staff) {
      throw new ForbiddenException('Bạn không có quyền xem cấu hình chấm công');
    }
    return 'STAFF';
  }

  async getTimekeepingSetting(
    this: StoresService,
    storeId: string,
    accountId?: string,
  ) {
    const access = await this.assertTimekeepingSettingsReadAccess(
      storeId,
      accountId,
    );
    // `shifts` lists what the settings screen manages: active templates,
    // without deleted (hidden) or "Khung giờ khác" request shifts.
    const [existingSetting, visibleShifts] = await Promise.all([
      this.timekeepingSettingRepository.findOne({ where: { storeId } }),
      this.listSettingsWorkShifts(storeId),
    ]);
    if (existingSetting || access === 'STAFF') {
      return {
        ...(existingSetting || defaultTimekeepingSettingData(storeId)),
        shifts: visibleShifts,
      };
    }

    return this.dataSource.transaction(async (manager) => {
      await lockStoreShiftAvailability(manager, storeId);
      const store = await manager.findOne(Store, { where: { id: storeId } });
      if (!store) throw new NotFoundException('Cửa hàng không tồn tại');
      if (store.ownerAccountId !== accountId) {
        throw new ForbiddenException(
          'Bạn không có quyền xem cấu hình chấm công',
        );
      }
      const { setting } = await this.ensureDefaultTimekeepingSetting(
        manager,
        storeId,
      );
      const shifts = await this.listSettingsWorkShifts(storeId, manager);
      return { ...setting, shifts };
    });
  }

  async upsertTimekeepingSetting(
    this: StoresService,
    storeId: string,
    data: StoreTimekeepingSettingDto,
    ownerAccountId?: string,
  ) {
    if (!ownerAccountId) {
      throw new ForbiddenException('Không xác định được tài khoản');
    }
    await this.assertOwnerStoreAccess(storeId, ownerAccountId);
    const result = await this.dataSource.transaction(async (manager) => {
      await lockStoreShiftAvailability(manager, storeId);
      const store = await manager.findOne(Store, { where: { id: storeId } });
      if (!store) throw new NotFoundException('Cửa hàng không tồn tại');
      if (store.ownerAccountId !== ownerAccountId) {
        throw new ForbiddenException(
          'Bạn không có quyền cập nhật cấu hình chấm công',
        );
      }

      const { shifts, ...settingData } = data;
      const shiftUpdates = shifts || [];
      const duplicateShiftIds = shiftUpdates
        .map((shift) => shift.id)
        .filter((id): id is string => Boolean(id));
      if (
        shiftUpdates.some((shift) => !shift.id) ||
        new Set(duplicateShiftIds).size !== duplicateShiftIds.length
      ) {
        throw new BadRequestException('Mỗi ca cập nhật phải có mã ca duy nhất');
      }

      const existingShifts = await manager.find(WorkShift, {
        where: { storeId },
      });
      const existingById = new Map(
        existingShifts.map((shift) => [shift.id, shift]),
      );
      for (const shiftData of shiftUpdates) {
        if (!existingById.has(shiftData.id)) {
          throw new BadRequestException('Ca làm việc không thuộc cửa hàng này');
        }
      }
      // Shifts are created, edited and deleted through the work-shifts
      // routes; this bulk path (older apps) may only retouch the shifts the
      // settings list shows. Entries for a deleted (hidden) or "Khung giờ
      // khác" shift are ignored so a stale screen cannot revive or alter
      // them, and `isActive` is never written here: hiding goes through
      // DELETE and its upcoming-assignment check.
      const customShiftIds = shiftUpdates.length
        ? await this.findCustomRequestShiftIds(manager, storeId)
        : new Set<string>();
      const editableUpdates = shiftUpdates
        .filter((shiftData) => {
          const existing = existingById.get(shiftData.id!);
          return (
            existing?.isActive !== false && !customShiftIds.has(shiftData.id!)
          );
        })
        .map((shiftData) => ({
          id: shiftData.id as string,
          shiftName:
            shiftData.shiftName !== undefined && shiftData.shiftName !== null
              ? String(shiftData.shiftName).trim()
              : undefined,
          startTime: legacyBulkShiftTime(
            shiftData.startTime,
            existingById.get(shiftData.id!)!.startTime,
          ),
          endTime: legacyBulkShiftTime(
            shiftData.endTime,
            existingById.get(shiftData.id!)!.endTime,
          ),
        }));
      const updatesById = new Map(
        editableUpdates.map((shift) => [shift.id, shift]),
      );
      const finalShifts = existingShifts.map((shift) => {
        const update = updatesById.get(shift.id);
        return {
          shiftName: (update?.shiftName ?? shift.shiftName).trim(),
          isActive: shift.isActive,
        };
      });
      assertShiftNamesPresent(finalShifts);
      const reminderShiftIds = editableUpdates
        .filter((shiftData) => {
          const existing = existingById.get(shiftData.id)!;
          return (
            (shiftData.startTime !== undefined &&
              !sameShiftTime(shiftData.startTime, existing.startTime)) ||
            (shiftData.endTime !== undefined &&
              !sameShiftTime(shiftData.endTime, existing.endTime))
          );
        })
        .map((shiftData) => shiftData.id);

      let setting = await manager.findOne(StoreTimekeepingSetting, {
        where: { storeId },
      });
      if (setting) Object.assign(setting, settingData);
      else {
        setting = manager.create(StoreTimekeepingSetting, {
          ...settingData,
          storeId,
        });
      }

      for (const shiftData of editableUpdates) {
        const shift = existingById.get(shiftData.id)!;
        const finalStartTime = shiftData.startTime ?? shift.startTime;
        const finalEndTime = shiftData.endTime ?? shift.endTime;
        if (sameShiftTime(finalStartTime, finalEndTime)) {
          throw new BadRequestException(
            'Giờ bắt đầu và giờ kết thúc không được trùng nhau',
          );
        }
        const allowedUpdate: Partial<WorkShift> = {};
        for (const key of ['shiftName', 'startTime', 'endTime'] as const) {
          if (shiftData[key] !== undefined) allowedUpdate[key] = shiftData[key];
        }
        if (!Object.keys(allowedUpdate).length) continue;
        await manager.update(
          WorkShift,
          { id: shift.id, storeId },
          allowedUpdate,
        );
      }

      const savedSetting = await manager.save(StoreTimekeepingSetting, setting);
      let reminderAssignmentIds: string[] = [];
      if (reminderShiftIds.length) {
        const assignments = await manager.find(ShiftAssignment, {
          where: {
            status: ShiftAssignmentStatus.APPROVED,
            shiftSlot: {
              workShiftId: In(reminderShiftIds),
              workDate: MoreThanOrEqual(getTodayDateString()),
              cycle: { status: WorkCycleStatus.ACTIVE },
            },
          },
          relations: ['shiftSlot', 'shiftSlot.workShift'],
          select: ['id'],
        });
        reminderAssignmentIds = assignments
          .filter((assignment) => {
            const slot = assignment.shiftSlot;
            const time = slot?.startTime || slot?.workShift?.startTime;
            return Boolean(
              slot?.workDate &&
              time &&
              parseVietnamShiftStart(slot.workDate, time).getTime() >
                Date.now(),
            );
          })
          .map((assignment) => assignment.id);
      }
      return { setting: savedSetting, reminderAssignmentIds };
    });

    if (result.reminderAssignmentIds.length) {
      try {
        await this.shiftReminderService.scheduleAssignmentReminders(
          result.reminderAssignmentIds,
        );
      } catch {
        this.logger.error(
          'Failed to reschedule reminders after timekeeping update',
        );
      }
    }
    return result.setting;
  }

  // Employee Report (Staff-facing)
  async getEmployeeDailyReport(
    this: StoresService,
    storeId: string,
    employeeProfileId: string,
    dateStr?: string,
  ) {
    // Vietnam calendar day. A full ISO datetime is read as an instant in
    // Vietnam time; otherwise the value must be 'YYYY-MM-DD'.
    let dateString: string;
    if (!dateStr) {
      dateString = vnDateString();
    } else if (/^\d{4}-\d{2}-\d{2}T/.test(dateStr)) {
      const instant = new Date(dateStr);
      if (Number.isNaN(instant.getTime())) {
        throw new BadRequestException(
          'date phải có định dạng YYYY-MM-DD hợp lệ',
        );
      }
      dateString = vnDateString(instant);
    } else {
      dateString = validateStoreReportDate(dateStr);
    }

    // Get shift assignments for this employee on this date
    const assignments = await this.shiftAssignmentRepository
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .where('a.employeeId = :employeeProfileId', { employeeProfileId })
      .andWhere('CAST(slot.workDate AS DATE) = :dateString', { dateString })
      .getMany();

    let totalMinutes = 0;
    let checkIn = '--:--';
    let checkOut = '--:--';
    // Minutes the employee was late in / early out on the assignment the times
    // above came from. The report returned only the clock readings, so the app
    // had nothing to say whether 10:02 was on time or two minutes late.
    let lateMinutes = 0;
    // Checked in before the start (the app said "Đúng giờ" for it).
    let earlyArrivalMinutes = 0;
    let earlyMinutes = 0;
    let warning = '';
    const shiftsCount = assignments.length;

    if (assignments.length > 0) {
      assignments.forEach((a: any) => {
        if (a.checkInTime) {
          checkIn = vnClockHHmm(new Date(a.checkInTime));
          lateMinutes = Number(a.lateMinutes) || 0;
          earlyArrivalMinutes =
            this.storedAttendanceDeltas(a).earlyArrivalMinutes;
        }
        if (a.checkOutTime) {
          checkOut = vnClockHHmm(new Date(a.checkOutTime));
          earlyMinutes = Number(a.earlyMinutes) || 0;
        }
        totalMinutes += Number(a.workedMinutes || 0);

        if (a.status === 'LATE') {
          warning = `Vào ca trễ hôm nay`;
        }
      });
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    // Calculate income from real-time shiftEarnings (per-shift basis)
    const dailyShiftEarnings = assignments
      .filter((a: any) => a.shiftEarnings != null)
      .reduce((sum: number, a: any) => sum + Number(a.shiftEarnings), 0);
    const hasRealTimeEarnings = assignments.some(
      (a: any) => a.shiftEarnings != null,
    );

    let dailyIncome = 0;
    if (hasRealTimeEarnings) {
      dailyIncome = Math.round(dailyShiftEarnings);
    } else {
      // Fallback: estimate from batch EmployeeSalary
      const reportMonth = vnMonthOfDateString(dateString)!;
      const salaries = await this.employeeSalaryRepository.find({
        where: {
          employeeProfileId,
          month: toMonthMarker(reportMonth),
        } as any,
      });
      const daysInMonth = reportMonth.calendarDays;
      dailyIncome =
        salaries.length > 0
          ? Math.round(Number(salaries[0].netSalary || 0) / daysInMonth)
          : 0;
    }

    return {
      income: dailyIncome,
      // false: `income` is a day's share of the payslip, not shift pay, so
      // the app must not add the shift under way on top of it.
      incomeFromShifts: hasRealTimeEarnings,
      trendPercent: 0,
      trendUp: false,
      lateMinutes,
      earlyArrivalMinutes,
      earlyMinutes,
      shifts: shiftsCount,
      hours,
      minutes,
      checkIn,
      checkOut,
      warning,
    };
  }

  async getEmployeeMonthlyReport(
    this: StoresService,
    storeId: string,
    employeeProfileId: string,
    monthStr?: string,
  ) {
    // Vietnam month: 'MM/YYYY', 'YYYY-MM', 'YYYY-MM-DD'; default current.
    const reportMonth = parseVnMonthInput(monthStr) ?? vnMonthOf();
    const salaryMonthDate = toMonthMarker(reportMonth);

    // Get salary info
    const salaries = await this.employeeSalaryRepository.find({
      where: { employeeProfileId, month: salaryMonthDate } as any,
      relations: ['monthlyPayroll'],
    });

    const salary = salaries.length > 0 ? salaries[0] : null;

    // Get shift assignments for the month (both bounds inclusive). The old
    // toISOString() bounds were a day early on a +07 host.
    const startDate = reportMonth.key;
    const endDate = reportMonth.lastDate;

    const assignments = await this.shiftAssignmentRepository
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.shiftSlot', 'slot')
      .where('a.employeeId = :employeeProfileId', { employeeProfileId })
      .andWhere('CAST(slot.workDate AS DATE) >= :startDate', { startDate })
      .andWhere('CAST(slot.workDate AS DATE) <= :endDate', { endDate })
      .getMany();

    let totalMinutes = 0;
    let totalShiftEarnings = 0;
    let hasRealTimeEarnings = false;
    assignments.forEach((a: any) => {
      totalMinutes += Number(a.workedMinutes || 0);
      if (a.shiftEarnings != null) {
        totalShiftEarnings += Number(a.shiftEarnings);
        hasRealTimeEarnings = true;
      }
    });

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    // Use real-time earnings if available, fallback to batch EmployeeSalary
    let income = 0;
    let estimatedMonthly = 0;
    let bonus = 0;
    let penalty = 0;

    if (hasRealTimeEarnings) {
      income = Math.round(totalShiftEarnings);
      estimatedMonthly = income;
    }

    if (!hasRealTimeEarnings || salary) {
      // Supplement with batch data for bonus/penalty + fallback income
      if (salary) {
        bonus = Number(salary.bonus || 0);
        penalty = Number(salary.penalty || 0);
        if (!hasRealTimeEarnings) {
          income = Number(salary.netSalary || 0);
          estimatedMonthly = income;
        }
      }
    }

    return {
      todaySummary:
        assignments.length > 0 ? 'Dữ liệu tháng này' : 'Chưa có dữ liệu',
      shifts: assignments.length,
      hours,
      minutes,
      income,
      incomeTrendUp: false,
      bonus,
      bonusTrendUp: false,
      penalty,
      penaltyTrendUp: false,
      estimatedMonthly,
      motivationText:
        assignments.length >= 20
          ? 'Đang tiến triển tốt, hãy tiếp tục duy trì nhé'
          : 'Hãy cố gắng thêm nhé!',
    };
  }

  async getEmployeeShiftHours(
    this: StoresService,
    storeId: string,
    employeeProfileId: string,
    monthStr?: string,
    filter?: string,
    accountId?: string,
  ) {
    if (accountId)
      await this.assertEmployeeCalendarAccess(
        employeeProfileId,
        accountId,
        storeId,
      );
    // Default is the current Vietnam month, not the server clock's month.
    const currentVnMonth = vnMonthOf();
    let m: number, y: number;
    if (monthStr) {
      if (monthStr.includes('/')) {
        [m, y] = monthStr.split('/').map(Number);
      } else if (monthStr.includes('-')) {
        [y, m] = monthStr.split('-').map(Number);
      } else {
        m = currentVnMonth.month;
        y = currentVnMonth.year;
      }
    } else {
      m = currentVnMonth.month;
      y = currentVnMonth.year;
    }
    // Ngày dạng chuỗi, không qua toISOString của giờ máy chủ (lệch một ngày ở UTC+7).
    const pad = (value: number) => String(value).padStart(2, '0');
    const startDate = `${y}-${pad(m)}-01`;
    const endDate = `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;

    const query = this.shiftAssignmentRepository
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .leftJoin('slot.cycle', 'cycle')
      .where('a.employeeId = :employeeProfileId', { employeeProfileId })
      .andWhere('cycle.storeId = :storeId', { storeId })
      // Ca chờ duyệt / đã huỷ không phải ca đã làm.
      .andWhere('a.status NOT IN (:...skipped)', {
        skipped: [
          ShiftAssignmentStatus.PENDING,
          ShiftAssignmentStatus.CANCELLED,
        ],
      })
      .andWhere('CAST(slot.workDate AS DATE) >= :startDate', { startDate })
      .andWhere('CAST(slot.workDate AS DATE) <= :endDate', { endDate })
      .orderBy('slot.workDate', 'DESC');

    // Chỉ liệt kê ca đã diễn ra: đã chấm công, đã bị ghi nghỉ không phép,
    // hoặc đã hết giờ khi đang nghỉ có phép (đơn nghỉ cả ngày đã duyệt).
    // Ca sắp tới chưa có gì để báo cáo.
    const loaded = await query.getMany();
    const approvedLeaves = await this.leaveRequestRepository.find({
      where: {
        employeeProfileId,
        storeId,
        status: LeaveRequestStatus.APPROVED,
        startDate: LessThanOrEqual(endDate),
        endDate: MoreThanOrEqual(startDate),
      },
      take: 500,
    });
    const nowInstant = new Date();
    // The start / end in force (an approved late arrival or early leave).
    const boundariesOf = (a: any) =>
      effectiveWindowOf({
        adjustedStartAt: a.adjustedStartAt,
        adjustedEndAt: a.adjustedEndAt,
        shiftSlot: {
          ...a.shiftSlot,
          workDate: String(a.shiftSlot?.workDate || '').slice(0, 10),
        },
      });
    const onLeaveIds = new Set<string>();
    for (const a of loaded as any[]) {
      if (a.checkInTime || a.attendanceStatus) continue;
      const { end } = boundariesOf(a);
      if (!end || end.getTime() > nowInstant.getTime()) continue;
      const workDate = String(a.shiftSlot?.workDate || '').slice(0, 10);
      if (
        approvedLeaves.some((leave) => leaveCoversShift(leave, workDate, a.id))
      ) {
        onLeaveIds.add(a.id);
      }
    }
    const assignments = loaded.filter(
      (a: any) =>
        a.checkInTime ||
        a.attendanceStatus === AttendanceStatus.ABSENT ||
        onLeaveIds.has(a.id),
    );

    // Aggregate counts by status
    const tabCounts: Record<string, number> = {
      all: assignments.length,
      on_time: 0,
      overtime: 0,
      forgot: 0,
      late: 0,
      early: 0,
      leave: 0,
      absent: 0,
    };

    const dayNames = [
      'Chủ nhật',
      'Thứ 2',
      'Thứ 3',
      'Thứ 4',
      'Thứ 5',
      'Thứ 6',
      'Thứ 7',
    ];
    let totalMinutes = 0;
    let completedShifts = 0;
    const shifts = assignments.map((a: any) => {
      const slot = a.shiftSlot;
      const workDate = String(slot?.workDate || '').slice(0, 10);
      const [yy, mm, dd] = workDate.split('-').map(Number);
      const weekday = new Date(
        Date.UTC(yy, (mm || 1) - 1, dd || 1),
      ).getUTCDay();
      const dayLabel = `${dayNames[weekday]}, ${pad(dd || 1)}/${pad(mm || 1)}/${String(yy || '').slice(2)}`;
      const shiftName = slot?.workShift?.shiftName || slot?.name || 'Ca làm';

      // Phân loại theo trạng thái chấm công (attendanceStatus). Trước đây so
      // trạng thái đăng ký ca (a.status) với 'LATE'/'ABSENT'… nên ca nào cũng
      // thành "Đúng giờ".
      const { start, end } = boundariesOf(a);
      const autoCheckedOut = !!(a.isAutoCheckout || a.autoCheckoutReason);
      const deltas = computeAttendanceDeltas({
        start,
        end,
        checkIn: a.checkInTime ? new Date(a.checkInTime) : null,
        checkOut: a.checkOutTime ? new Date(a.checkOutTime) : null,
        autoCheckedOut,
      });
      // Tab keys this row belongs to (filter uses them, not the label).
      const statusKeys: string[] = [];
      let status = 'Đúng giờ';
      let statusColor = '#12B569';
      switch (a.attendanceStatus) {
        case AttendanceStatus.LATE:
          status = 'Đi trễ';
          statusColor = '#F78F08';
          tabCounts.late++;
          statusKeys.push('late');
          break;
        case AttendanceStatus.LATE_AND_EARLY:
          status = 'Đi trễ · Về sớm';
          statusColor = '#F78F08';
          tabCounts.late++;
          tabCounts.early++;
          statusKeys.push('late', 'early');
          break;
        case AttendanceStatus.EARLY:
          status = 'Về sớm';
          statusColor = '#F78F08';
          tabCounts.early++;
          statusKeys.push('early');
          break;
        case AttendanceStatus.ABSENT:
          status = 'Nghỉ không phép';
          statusColor = '#F95555';
          tabCounts.absent++;
          statusKeys.push('absent');
          break;
        case AttendanceStatus.FORGOT_CHECKOUT:
          status = 'Quên chấm công ra';
          statusColor = '#F95555';
          tabCounts.forgot++;
          statusKeys.push('forgot');
          break;
        default:
          if (onLeaveIds.has(a.id)) {
            status = 'Nghỉ phép';
            statusColor = '#667085';
            tabCounts.leave++;
            statusKeys.push('leave');
          } else {
            tabCounts.on_time++;
            statusKeys.push('on_time');
          }
      }
      // "Tăng ca": ra muộn sau giờ kết thúc ca (không tính tự kết thúc ca).
      if (deltas.overtimeMinutes > 0) {
        tabCounts.overtime++;
        statusKeys.push('overtime');
      }
      if (a.checkInTime) completedShifts++;

      const workedMins = Number(a.workedMinutes || 0);
      totalMinutes += workedMins;
      const h = Math.floor(workedMins / 60);
      const mins = workedMins % 60;

      return {
        id: a.id,
        dayLabel,
        shiftName,
        status,
        statusColor,
        hours: `${h}:${String(mins).padStart(2, '0')}`,
        workedMinutes: workedMins,
        // Giờ vào/ra và số phút trễ/sớm — app hiện giống màn kết quả chấm công.
        checkInTime: a.checkInTime
          ? new Date(a.checkInTime).toISOString()
          : null,
        checkOutTime: a.checkOutTime
          ? new Date(a.checkOutTime).toISOString()
          : null,
        lateMinutes: Number(a.lateMinutes || 0),
        earlyMinutes: Number(a.earlyMinutes || 0),
        // Cùng cách tính với màn kết quả chấm công (computeAttendanceDeltas).
        earlyArrivalMinutes: deltas.earlyArrivalMinutes,
        overtimeMinutes: deltas.overtimeMinutes,
        autoCheckedOut,
        autoCheckoutReason: a.autoCheckoutReason ?? null,
        // Tự kết thúc ca: giờ làm tính đến mốc này (giờ kết thúc ca).
        scheduledCheckoutTime: a.scheduledCheckoutTime
          ? new Date(a.scheduledCheckoutTime).toISOString()
          : null,
        attendanceStatus: a.attendanceStatus ?? null,
        onLeave: onLeaveIds.has(a.id),
        statusKeys,
      };
    });

    // Filter by tab key; a row can belong to several tabs (e.g. late + early,
    // or on time + overtime).
    let filteredShifts = shifts;
    if (filter && filter !== 'all') {
      filteredShifts = shifts.filter((s) => s.statusKeys.includes(filter));
    }

    return {
      completedShifts,
      totalHours: Math.floor(totalMinutes / 60),
      // Legacy: the minutes part left over after totalHours (0-59).
      totalMinutes: totalMinutes % 60,
      // Exact worked minutes of the month (all listed shifts, before the tab filter).
      totalWorkedMinutes: totalMinutes,
      shiftsTrend: 0,
      hoursTrend: 0,
      shifts: filteredShifts,
      tabCounts,
    };
  }

  async recordCheckoutMood(
    this: StoresService,
    assignmentId: string,
    mood: string,
    note?: string,
  ) {
    const assignment = await this.shiftAssignmentRepository.findOne({
      where: { id: assignmentId },
    });
    if (!assignment) return { success: false, message: 'Assignment not found' };

    // Store mood as JSON in a generic field (metadata or note)
    // We use the existing 'notes' or patch via metadata approach
    (assignment as any).checkoutMood = mood;
    (assignment as any).checkoutNote = note || '';
    await this.shiftAssignmentRepository.save(assignment);
    return { success: true, mood, note };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ATTENDANCE & FACE RECOGNITION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Applies the store's configured QR and location policy, and records the
   * caller's distance from the store.
   *
   * Runs before face inference so a policy rejection does not cost a
   * TensorFlow pass. Whether a violation actually rejects the request is
   * governed by ATTENDANCE_ENFORCEMENT_MODE — see attendance-enforcement.ts.
   *
   * Also returns the store's attendance minute rules (grace, check-in
   * window, worked-time credit) from the same settings row.
   */
  async applyAttendancePolicy(
    this: StoresService,
    label: 'CheckIn' | 'CheckOut',
    storeId: string | undefined,
    employeeProfileId: string | undefined,
    options?: { latitude?: number; longitude?: number; qrStoreId?: string },
    /** No face photo: allowed only for a GPS_QR / QR_ONLY store, always enforced. */
    faceless = false,
  ): Promise<{
    checkinDistance: number | null;
    checkinLatitude: number | null;
    checkinLongitude: number | null;
    rules: AttendanceRules;
  }> {
    let checkinDistance: number | null = null;
    let checkinLatitude: number | null = null;
    let checkinLongitude: number | null = null;

    // Finite numbers only: NaN would make every distance comparison false.
    const hasLocationFix =
      Number.isFinite(options?.latitude) && Number.isFinite(options?.longitude);

    const [timekeeping, shiftConfig, store] = await Promise.all([
      storeId
        ? this.timekeepingSettingRepository.findOne({ where: { storeId } })
        : null,
      storeId
        ? this.shiftConfigRepository.findOne({ where: { storeId } })
        : null,
      storeId && (hasLocationFix || faceless)
        ? this.storeRepository.findOne({ where: { id: storeId } })
        : null,
    ]);

    if (hasLocationFix) {
      checkinLatitude = options!.latitude!;
      checkinLongitude = options!.longitude!;
      if (store?.latitude != null && store?.longitude != null) {
        checkinDistance = this.calculateDistance(
          checkinLatitude,
          checkinLongitude,
          store.latitude,
          store.longitude,
        );
      }
    }

    if (faceless) {
      // Nothing identifies the person, so QR + location are the evidence and
      // are enforced regardless of ATTENDANCE_ENFORCEMENT_MODE.
      const facelessViolations = evaluateFacelessAttendance({
        requirement: shiftConfig?.timekeepingRequirement,
        attendanceRadius: timekeeping?.attendanceRadius,
        qrStoreId: options?.qrStoreId,
        expectedStoreId: storeId,
        hasLocationFix,
        storeHasLocation: store?.latitude != null && store?.longitude != null,
        distanceMeters: checkinDistance,
      });
      if (facelessViolations.length) {
        this.logger.warn(
          `[${label}] attendance without face refused: ${facelessViolations.join(',')}`,
        );
        throw new BadRequestException({
          code: `ATTENDANCE_${facelessViolations[0]}`,
          message: describeAttendanceViolation(facelessViolations[0]),
        });
      }
      return {
        checkinDistance,
        checkinLatitude,
        checkinLongitude,
        rules: resolveAttendanceRules(timekeeping),
      };
    }

    const violations = evaluateAttendanceRules({
      requirement: shiftConfig?.timekeepingRequirement,
      requireQrScan: timekeeping?.requireQrScan,
      requireLocation: timekeeping?.requireLocation,
      attendanceRadius: timekeeping?.attendanceRadius,
      locationExempt: Boolean(
        employeeProfileId &&
        timekeeping?.locationExceptionEmployeeIds?.includes(employeeProfileId),
      ),
      qrStoreId: options?.qrStoreId,
      expectedStoreId: storeId,
      distanceMeters: checkinDistance,
      hasLocationFix,
    });

    if (violations.length) {
      const mode = resolveAttendanceEnforcementMode(process.env);
      const summary = violations.join(',');
      if (mode === 'enforce') {
        throw new BadRequestException(
          describeAttendanceViolation(violations[0]),
        );
      }
      // Observation mode: surface what a rollout to `enforce` would reject.
      this.logger.warn(
        `[${label}] attendance policy not satisfied (mode=off, would reject): ${summary}`,
      );
    }

    return {
      checkinDistance,
      checkinLatitude,
      checkinLongitude,
      rules: resolveAttendanceRules(timekeeping),
    };
  }

  /**
   * Check-in. `imageBuffer` null = no face photo, accepted only for a store
   * whose attendance mode is GPS_QR (QR + GPS then strictly required).
   */
  async checkInWithFace(
    this: StoresService,
    assignmentId: string,
    imageBuffer: Buffer | null,
    accountId: string,
    options?: {
      latitude?: number;
      longitude?: number;
      qrStoreId?: string;
      orientationNormalized?: boolean;
    },
  ) {
    const requestStartedAt = Date.now();
    const assignment = await this.shiftAssignmentRepository.findOne({
      where: { id: assignmentId },
      relations: [
        'shiftSlot',
        'shiftSlot.workShift',
        'shiftSlot.cycle',
        'employee',
      ],
    });
    if (!assignment) throw new NotFoundException('Shift assignment not found');
    // Authorize before any state is revealed, including the already-recorded
    // short-circuit below.
    this.assertAttendanceSelfAccess(assignment, accountId);
    if (assignment.checkInTime) {
      return {
        matched: true,
        alreadyRecorded: true,
        lateMinutes: assignment.lateMinutes,
        // A duplicate submit shows the same "Sớm X" as the first response.
        earlyArrivalMinutes:
          this.storedAttendanceDeltas(assignment).earlyArrivalMinutes,
        attendanceStatus: assignment.attendanceStatus,
        checkInTime: assignment.checkInTime.toISOString(),
        gpsDistance: null,
      };
    }
    if (assignment.status !== ShiftAssignmentStatus.APPROVED) {
      throw new BadRequestException(
        'Ca làm việc chưa được chấp thuận. Vui lòng chờ chủ cửa hàng duyệt.',
      );
    }
    // Qua giờ kết thúc mà chưa vào ca thì ca đã bị ghi nghỉ không phép; không
    // cho check-in muộn hơn giờ kết thúc nữa (giờ kết thúc sau khi duyệt về sớm).
    {
      const { end } = effectiveWindowOf(assignment);
      if (
        assignment.attendanceStatus === AttendanceStatus.ABSENT ||
        (end && Date.now() >= end.getTime())
      ) {
        throw new BadRequestException(
          'Ca làm đã kết thúc nên không thể check-in. Ca được ghi nhận là nghỉ không phép.',
        );
      }
    }

    const storeId = assignment.shiftSlot?.cycle?.storeId;

    // ===== Step 1: Store policy (QR + location) =====
    // Evaluated before face inference so a policy rejection is cheap.
    const { checkinDistance, checkinLatitude, checkinLongitude, rules } =
      await this.applyAttendancePolicy(
        'CheckIn',
        storeId,
        assignment.employeeId,
        options,
        !imageBuffer,
      );

    // Check-in opens the store's "Cho phép check-in trước giờ làm" minutes
    // before the shift start.
    {
      const slot = assignment.shiftSlot;
      const { start } = resolveShiftBoundaries(
        slot?.workDate,
        slot?.startTime || slot?.workShift?.startTime,
        slot?.endTime || slot?.workShift?.endTime,
      );
      const opensAt = checkInOpensAt(start, rules);
      if (opensAt && Date.now() < opensAt.getTime()) {
        throw new BadRequestException({
          code: CHECK_IN_TOO_EARLY_CODE,
          message: `Chưa đến giờ check-in. Bạn có thể check-in từ ${vnClockHHmm(opensAt)}.`,
        });
      }
    }

    // ===== Step 2: Face Verification =====
    // Skipped only without a photo, which the policy step accepted for a
    // GPS_QR store after checking QR + location.
    const faceStartedAt = Date.now();
    const matchResult: { matched: true; distance: number | null } = {
      matched: true,
      distance: null,
    };
    if (imageBuffer) {
      const employeeFace = await this.employeeFaceRepository.findOne({
        where: { employeeProfileId: assignment.employeeId, isActive: true },
      });
      if (!employeeFace || employeeFace.faceDescriptors.length === 0) {
        throw new BadRequestException(
          'Face not registered. Please register your face first.',
        );
      }

      const descriptor = await this.faceRecognitionService.extractDescriptor(
        imageBuffer,
        options?.orientationNormalized ? { rotations: [0] } : undefined,
      );
      if (!descriptor) {
        return { matched: false, message: 'No face detected in image' };
      }

      const faceMatch = this.faceRecognitionService.compareFaces(
        descriptor,
        employeeFace.faceDescriptors,
      );
      if (!faceMatch.matched) {
        return {
          matched: false,
          distance: faceMatch.distance,
          message: 'Face does not match',
        };
      }
      matchResult.distance = faceMatch.distance;
      this.logger.debug(
        `[CheckIn] Face verified — distance=${faceMatch.distance}`,
      );
    }

    // Late minutes are measured against the shift's start on its Vietnam work
    // date (overnight shifts on the right day), or the start in force after an
    // approved late arrival. Computed under the row lock, so an approval
    // landing at the same moment is either seen here or sees this check-in.
    const now = new Date();
    const slot = assignment.shiftSlot;
    let shiftStart: Date | null = effectiveWindowOf(assignment).start;
    let lateMinutes = 0;
    let attendanceStatus = AttendanceStatus.ON_TIME;

    const persistence = await this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(ShiftAssignment, {
        where: { id: assignmentId },
        lock: { mode: 'pessimistic_write' },
      });
      shiftStart = effectiveWindowOf({
        adjustedStartAt: locked?.adjustedStartAt ?? assignment.adjustedStartAt,
        adjustedEndAt: locked?.adjustedEndAt ?? assignment.adjustedEndAt,
        shiftSlot: slot,
      }).start;
      // Late within the store's allowed minutes counts as on time (0).
      lateMinutes = applyGrace(calculateLateMinutes(shiftStart, now), rules);
      attendanceStatus =
        lateMinutes > 0 ? AttendanceStatus.LATE : AttendanceStatus.ON_TIME;

      const updateResult = await manager
        .createQueryBuilder()
        .update(ShiftAssignment)
        .set({
          checkInTime: now,
          lateMinutes,
          attendanceStatus,
          status: ShiftAssignmentStatus.CONFIRMED,
        })
        .where('id = :assignmentId', { assignmentId })
        .andWhere('check_in_time IS NULL')
        .andWhere('status = :approvedStatus', {
          approvedStatus: ShiftAssignmentStatus.APPROVED,
        })
        .execute();

      if (!updateResult.affected) {
        const existing = await manager.findOne(ShiftAssignment, {
          where: { id: assignmentId },
        });
        if (existing?.checkInTime) {
          return { recorded: false, assignment: existing };
        }
        throw new BadRequestException('Unable to check in this assignment');
      }

      const checkInLog = manager.create(AttendanceLog, {
        shiftAssignmentId: assignmentId,
        employeeProfileId: assignment.employeeId,
        storeId: storeId ?? '',
        type: AttendanceLogType.CHECK_IN,
        timestamp: now,
        method: imageBuffer ? AttendanceMethod.FACE : AttendanceMethod.QR_GPS,
        faceMatchScore: matchResult.distance ?? undefined,
        checkinLatitude: checkinLatitude ?? undefined,
        checkinLongitude: checkinLongitude ?? undefined,
        checkinDistance: checkinDistance ?? undefined,
      });
      await manager.save(AttendanceLog, checkInLog);
      // Shift and minutes only — never location or face data.
      await this.logActivity(manager, {
        storeId: storeId ?? null,
        actorAccountId: accountId,
        subjectEmployeeProfileId: assignment.employeeId,
        action: ACTIVITY_ACTIONS.CHECK_IN,
        resourceType: 'shift_assignment',
        resourceId: assignmentId,
        params: {
          ...this.activityShiftParams(slot),
          checkInAt: vnClockHHmm(now),
          lateMinutes,
        },
        idempotencyKey: `${ACTIVITY_ACTIONS.CHECK_IN}:${assignmentId}`,
      });
      return { recorded: true, assignment: null };
    });

    if (!persistence.recorded && persistence.assignment) {
      return {
        matched: true,
        alreadyRecorded: true,
        distance: matchResult.distance,
        lateMinutes: persistence.assignment.lateMinutes,
        // A duplicate submit shows the same result as the first one.
        earlyArrivalMinutes: computeAttendanceDeltas({
          start: shiftStart,
          end: null,
          checkIn: persistence.assignment.checkInTime,
        }).earlyArrivalMinutes,
        attendanceStatus: persistence.assignment.attendanceStatus,
        checkInTime: persistence.assignment.checkInTime.toISOString(),
        gpsDistance: null,
      };
    }

    // Fix 2: Sync workingStatus → WORKING
    try {
      await this.profileRepository.update(assignment.employeeId, {
        workingStatus: WorkingStatus.WORKING,
      });
    } catch (err) {
      this.logger.warn(
        `[CheckIn] workingStatus sync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Ghi nhận đi trễ vào DailyEmployeeReport
    if (lateMinutes > 0 && storeId) {
      this.appendToDailyReport(storeId, 'lateArrivals', assignment.employeeId);
    }

    // X6: tell the owner after commit. Not awaited; never fails the check-in.
    if (this.ownerNotificationService) {
      void this.ownerNotificationService
        .afterAttendance({
          kind: 'check_in',
          assignmentId,
          at: now,
          lateMinutes,
        })
        .catch(() => undefined);
    }

    this.logger.log(
      `[AttendanceTiming] mode=check-in assignment=${assignmentId} face=${Date.now() - faceStartedAt}ms total=${Date.now() - requestStartedAt}ms`,
    );

    return {
      matched: true,
      distance: matchResult.distance,
      lateMinutes,
      // Đến sớm bao nhiêu phút so với giờ vào ca (0 nếu đúng giờ hoặc trễ), để
      // màn kết quả nói "Sớm 12 phút" thay vì luôn "Đúng giờ".
      earlyArrivalMinutes: computeAttendanceDeltas({
        start: shiftStart,
        end: null,
        checkIn: now,
      }).earlyArrivalMinutes,
      attendanceStatus,
      checkInTime: now.toISOString(),
      gpsDistance: checkinDistance != null ? Math.round(checkinDistance) : null,
    };
  }

  /** Check-out; `imageBuffer` null as for checkInWithFace (GPS_QR stores). */
  async checkOutWithFace(
    this: StoresService,
    assignmentId: string,
    imageBuffer: Buffer | null,
    accountId: string,
    options?: {
      latitude?: number;
      longitude?: number;
      qrStoreId?: string;
      orientationNormalized?: boolean;
    },
  ) {
    const requestStartedAt = Date.now();
    const assignment = await this.shiftAssignmentRepository.findOne({
      where: { id: assignmentId },
      relations: [
        'shiftSlot',
        'shiftSlot.workShift',
        'shiftSlot.cycle',
        'employee',
      ],
    });
    if (!assignment) throw new NotFoundException('Shift assignment not found');
    // Authorize before any state is revealed, including the already-recorded
    // short-circuit below.
    this.assertAttendanceSelfAccess(assignment, accountId);
    if (!assignment.checkInTime)
      throw new BadRequestException('Must check in first');
    if (assignment.checkOutTime) {
      return {
        matched: true,
        alreadyRecorded: true,
        earlyMinutes: assignment.earlyMinutes,
        // A duplicate submit shows the same "Ra muộn X" as the first response.
        overtimeMinutes:
          this.storedAttendanceDeltas(assignment).overtimeMinutes,
        workedMinutes: assignment.workedMinutes,
        attendanceStatus: assignment.attendanceStatus,
        checkOutTime: assignment.checkOutTime.toISOString(),
        gpsDistance: null,
        shiftEarnings: assignment.shiftEarnings ?? null,
        netSalary: null,
        payrollProcessing: true,
      };
    }

    const storeId = assignment.shiftSlot?.cycle?.storeId;

    // ===== Step 1: Store policy (QR + location) =====
    // Evaluated before face inference so a policy rejection is cheap.
    const { checkinDistance, checkinLatitude, checkinLongitude, rules } =
      await this.applyAttendancePolicy(
        'CheckOut',
        storeId,
        assignment.employeeId,
        options,
        !imageBuffer,
      );

    // ===== Step 2: Face Verification =====
    // Skipped only without a photo, which the policy step accepted for a
    // GPS_QR store after checking QR + location.
    const faceStartedAt = Date.now();
    const matchResult: { matched: true; distance: number | null } = {
      matched: true,
      distance: null,
    };
    if (imageBuffer) {
      const employeeFace = await this.employeeFaceRepository.findOne({
        where: { employeeProfileId: assignment.employeeId, isActive: true },
      });
      if (!employeeFace || employeeFace.faceDescriptors.length === 0) {
        throw new BadRequestException('Face not registered');
      }

      const descriptor = await this.faceRecognitionService.extractDescriptor(
        imageBuffer,
        options?.orientationNormalized ? { rotations: [0] } : undefined,
      );
      if (!descriptor) {
        return { matched: false, message: 'No face detected in image' };
      }

      const faceMatch = this.faceRecognitionService.compareFaces(
        descriptor,
        employeeFace.faceDescriptors,
      );
      if (!faceMatch.matched) {
        return {
          matched: false,
          distance: faceMatch.distance,
          message: 'Face does not match',
        };
      }
      matchResult.distance = faceMatch.distance;
      this.logger.debug(
        `[CheckOut] Face verified — distance=${faceMatch.distance}`,
      );
    }

    // Calculate early minutes and worked minutes. Same Vietnam-anchored
    // boundaries as check-in, so an overnight shift ending at 06:00 is compared
    // against the following morning rather than the current calendar day; an
    // approved late arrival / early leave moves the start / end.
    const now = new Date();
    const slot = assignment.shiftSlot;
    const paidUntil = await this.approvedOvertimeEnd(
      assignmentId,
      effectiveWindowOf(assignment).end,
    );
    const mode = await this.workedTimeModeFor(
      storeId,
      assignment.employeeId,
      slot,
    );
    let shiftEnd: Date | null = null;
    let earlyMinutes = 0;
    let workedMinutes = 0;
    let attendanceStatus =
      assignment.attendanceStatus || AttendanceStatus.ON_TIME;

    const persistence = await this.dataSource.transaction(async (manager) => {
      // Under the row lock: an approved late arrival / early leave saved at the
      // same moment is either seen here or sees this check-out.
      const locked = await manager.findOne(ShiftAssignment, {
        where: { id: assignmentId },
        lock: { mode: 'pessimistic_write' },
      });
      const current = locked ?? assignment;
      const window = effectiveWindowOf({
        adjustedStartAt: current.adjustedStartAt,
        adjustedEndAt: current.adjustedEndAt,
        shiftSlot: slot,
      });
      shiftEnd = window.end;
      // Leaving early within the store's allowed minutes counts as on time (0).
      earlyMinutes = applyGrace(calculateEarlyMinutes(window.end, now), rules);
      // Paid time inside the shift, with forgiven (or not deducted) late/early
      // time counted; staying after the end is paid only up to an approved
      // overtime end. Whether the late arrival was forgiven is what check-in
      // (or a later approval) stored.
      workedMinutes = creditedWorkedMinutes({
        start: window.start,
        end: window.end,
        checkIn: new Date(current.checkInTime ?? assignment.checkInTime),
        checkOut: now,
        rules,
        storedLateMinutes: current.lateMinutes,
        paidUntil,
        mode,
      });
      const lateMinutes =
        Number(current.lateMinutes ?? assignment.lateMinutes) || 0;
      attendanceStatus = current.attendanceStatus || AttendanceStatus.ON_TIME;
      if (lateMinutes > 0 && earlyMinutes > 0) {
        attendanceStatus = AttendanceStatus.LATE_AND_EARLY;
      } else if (earlyMinutes > 0) {
        attendanceStatus = AttendanceStatus.EARLY;
      }

      const updateResult = await manager
        .createQueryBuilder()
        .update(ShiftAssignment)
        .set({
          checkOutTime: now,
          earlyMinutes,
          workedMinutes,
          attendanceStatus,
          status: ShiftAssignmentStatus.COMPLETED,
        })
        .where('id = :assignmentId', { assignmentId })
        .andWhere('check_out_time IS NULL')
        .andWhere('check_in_time IS NOT NULL')
        .execute();

      if (!updateResult.affected) {
        const existing = await manager.findOne(ShiftAssignment, {
          where: { id: assignmentId },
        });
        if (existing?.checkOutTime) {
          return { recorded: false, assignment: existing };
        }
        throw new BadRequestException('Unable to check out this assignment');
      }

      const checkOutLog = manager.create(AttendanceLog, {
        shiftAssignmentId: assignmentId,
        employeeProfileId: assignment.employeeId,
        storeId: storeId ?? '',
        type: AttendanceLogType.CHECK_OUT,
        timestamp: now,
        method: imageBuffer ? AttendanceMethod.FACE : AttendanceMethod.QR_GPS,
        faceMatchScore: matchResult.distance ?? undefined,
        checkinLatitude: checkinLatitude ?? undefined,
        checkinLongitude: checkinLongitude ?? undefined,
        checkinDistance: checkinDistance ?? undefined,
      });
      await manager.save(AttendanceLog, checkOutLog);
      await this.logActivity(manager, {
        storeId: storeId ?? null,
        actorAccountId: accountId,
        subjectEmployeeProfileId: assignment.employeeId,
        action: ACTIVITY_ACTIONS.CHECK_OUT,
        resourceType: 'shift_assignment',
        resourceId: assignmentId,
        params: {
          ...this.activityShiftParams(slot),
          checkOutAt: vnClockHHmm(now),
          earlyMinutes,
        },
        idempotencyKey: `${ACTIVITY_ACTIONS.CHECK_OUT}:${assignmentId}`,
      });
      return { recorded: true, assignment: null };
    });

    if (!persistence.recorded && persistence.assignment) {
      return {
        matched: true,
        alreadyRecorded: true,
        distance: matchResult.distance,
        earlyMinutes: persistence.assignment.earlyMinutes,
        // A duplicate submit shows the same result as the first one (0 when
        // the stored check-out was automatic).
        overtimeMinutes: computeAttendanceDeltas({
          start: null,
          end: shiftEnd,
          checkOut: persistence.assignment.checkOutTime,
          autoCheckedOut: !!(
            persistence.assignment.isAutoCheckout ||
            persistence.assignment.autoCheckoutReason
          ),
        }).overtimeMinutes,
        workedMinutes: persistence.assignment.workedMinutes,
        attendanceStatus: persistence.assignment.attendanceStatus,
        checkOutTime: persistence.assignment.checkOutTime.toISOString(),
        gpsDistance: null,
        shiftEarnings: persistence.assignment.shiftEarnings ?? null,
        netSalary: null,
        payrollProcessing: true,
      };
    }

    // Ghi nhận về sớm vào DailyEmployeeReport
    if (earlyMinutes > 0 && storeId) {
      this.appendToDailyReport(
        storeId,
        'earlyDepartures',
        assignment.employeeId,
      );
    }

    // X6: tell the owner after commit. Not awaited; never fails the check-out.
    if (this.ownerNotificationService) {
      void this.ownerNotificationService
        .afterAttendance({
          kind: 'check_out',
          assignmentId,
          at: now,
          earlyMinutes,
        })
        .catch(() => undefined);
    }

    // ===== Fix 2: Sync workingStatus → IDLE =====
    try {
      await this.profileRepository.update(assignment.employeeId, {
        workingStatus: WorkingStatus.IDLE,
      });
    } catch (err) {
      this.logger.warn(
        `[CheckOut] workingStatus sync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.logger.log(
      `[AttendanceTiming] mode=check-out assignment=${assignmentId} face=${Date.now() - faceStartedAt}ms total=${Date.now() - requestStartedAt}ms`,
    );

    return {
      matched: true,
      distance: matchResult.distance,
      earlyMinutes,
      // Ra muộn bao nhiêu phút sau giờ kết thúc ca (0 nếu về đúng giờ hoặc sớm).
      overtimeMinutes: computeAttendanceDeltas({
        start: null,
        end: shiftEnd,
        checkOut: now,
      }).overtimeMinutes,
      workedMinutes,
      attendanceStatus,
      checkOutTime: now.toISOString(),
      gpsDistance: checkinDistance != null ? Math.round(checkinDistance) : null,
      shiftEarnings: null,
      netSalary: null,
      payrollProcessing: true,
    };
  }

  /**
   * Haversine formula — calculate distance between two GPS points in meters
   */
  calculateDistance(
    this: StoresService,
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371000; // Earth radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Update store location (lat/lng) and auto-generate QR code
   */
  async updateStoreLocation(
    this: StoresService,
    storeId: string,
    latitude: number,
    longitude: number,
  ) {
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
    });
    if (!store) throw new NotFoundException('Store not found');

    store.latitude = latitude;
    store.longitude = longitude;

    // Auto-generate QR code data if not exists
    if (!store.qrCode) {
      store.qrCode = JSON.stringify({
        type: 'TIMESO_STORE',
        storeId: store.id,
        name: store.name,
      });
    }

    await this.storeRepository.save(store);
    // Coordinates and the attendance QR path are not log material.
    return store;
  }

  /**
   * Generate/regenerate QR code data for a store
   */
  async generateStoreQR(this: StoresService, storeId: string) {
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
    });
    if (!store) throw new NotFoundException('Store not found');

    // QR payload = storeId (staff app will scan this)
    const qrPayload = storeId;

    // Ensure uploads/qr directory exists
    const qrDir = join(process.cwd(), 'uploads', 'qr');
    if (!existsSync(qrDir)) {
      mkdirSync(qrDir, { recursive: true });
    }

    // Generate QR code PNG file
    const fileName = `store-${storeId}.png`;
    const filePath = join(qrDir, fileName);

    await QRCode.toFile(filePath, qrPayload, {
      type: 'png',
      width: 512,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' },
    });

    // Save URL path in store entity
    const qrUrl = `/uploads/qr/${fileName}`;
    store.qrCode = qrUrl;
    await this.storeRepository.save(store);

    this.logger.debug(`[QR] Generated QR image: ${qrUrl} for store ${storeId}`);
    return { qrCode: qrUrl };
  }

  async registerFace(
    this: StoresService,
    employeeProfileId: string,
    imageBuffers: Buffer[],
    accountId: string,
  ) {
    const startTime = Date.now();
    // Self-service only, and the owning store comes from the profile so a
    // client cannot point the enrollment at a store it does not belong to.
    const profile = await this.assertEmployeeSelfAccess(
      employeeProfileId,
      accountId,
      undefined,
      'Bạn chỉ có thể đăng ký khuôn mặt cho chính mình',
    );
    const storeId = profile.storeId;
    this.logger.debug(
      `[FaceRegistration] START — images=${imageBuffers.length}`,
    );

    if (imageBuffers.length < 3) {
      console.warn(
        `❌ [FaceRegistration] Not enough images: ${imageBuffers.length} < 3`,
      );
      throw new BadRequestException('At least 3 face images required');
    }

    const t1 = Date.now();
    console.log(
      `🔍 [FaceRegistration] Extracting face descriptors from ${imageBuffers.length} images...`,
    );
    const result = await this.faceRecognitionService.registerFace(imageBuffers);
    const extractTime = Date.now() - t1;
    console.log(
      `🔍 [FaceRegistration] Result: ${result.successCount} faces detected, ${result.failedCount} failed — took ${extractTime}ms`,
    );

    if (result.successCount < 3) {
      console.warn(
        `❌ [FaceRegistration] Only ${result.successCount}/3 faces detected — REJECTED`,
      );
      throw new BadRequestException(
        `Only ${result.successCount} faces detected out of ${imageBuffers.length} images. Need at least 3.`,
      );
    }

    // Deactivate old face registrations
    const deactivated = await this.employeeFaceRepository.update(
      { employeeProfileId, isActive: true },
      { isActive: false },
    );
    console.log(
      `♻️ [FaceRegistration] Deactivated ${deactivated.affected || 0} old registration(s)`,
    );

    // Save new face registration
    const face = this.employeeFaceRepository.create({
      employeeProfileId,
      storeId,
      faceDescriptors: result.descriptors,
      faceImageUrls: [],
      isActive: true,
    });

    const saved = await this.employeeFaceRepository.save(face);
    const totalTime = Date.now() - startTime;
    console.log(
      `✅ [FaceRegistration] SUCCESS — faceId=${saved.id}, descriptors=${saved.faceDescriptors?.length} — TOTAL ${totalTime}ms`,
    );

    return saved;
  }

  async getFaceRegistration(this: StoresService, employeeProfileId: string) {
    const face = await this.employeeFaceRepository.findOne({
      where: { employeeProfileId, isActive: true },
    });
    return {
      registered: !!face,
      registeredAt: face?.registeredAt || null,
      descriptorCount: face?.faceDescriptors?.length || 0,
    };
  }

  async getAttendanceLogs(
    this: StoresService,
    storeId: string,
    filters?: {
      employeeProfileId?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    const query = this.attendanceLogRepository
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.shiftAssignment', 'sa')
      .leftJoinAndSelect('log.employeeProfile', 'ep')
      .where('log.storeId = :storeId', { storeId });
    if (filters?.employeeProfileId) {
      query.andWhere('log.employeeProfileId = :employeeProfileId', {
        employeeProfileId: filters.employeeProfileId,
      });
    }
    if (filters?.dateFrom && filters?.dateTo) {
      query.andWhere('log.timestamp BETWEEN :from AND :to', {
        from: new Date(filters.dateFrom),
        to: new Date(filters.dateTo + 'T23:59:59'),
      });
    }
    // Current stint only: a rehired employee keeps one profile row, so logs
    // from before `joined_at` belong to the former stint. Legacy profiles
    // (no joined_at) and soft-deleted former employees are not filtered.
    query.andWhere(currentStintSql('ep', 'log.timestamp'));

    return query.orderBy('log.timestamp', 'DESC').take(100).getMany();
  }

  /**
   * How a shift under way counts so far, for live display (not stored):
   * from `from` to now, never past `until`. Same rule as the check-out:
   * "theo lịch làm" from the start in force (a forgiven late arrival counts
   * from the start) to the end or the approved overtime end; "theo giờ chấm
   * công" from the check-in, open-ended.
   */
  async liveCountWindow(
    this: StoresService,
    assignment: ShiftAssignment,
    storeId: string,
  ): Promise<{ from: Date; until: Date | null } | null> {
    if (!assignment.checkInTime || assignment.checkOutTime) return null;
    const checkIn = new Date(assignment.checkInTime);
    try {
      const window = effectiveWindowOf(assignment);
      const mode = await this.workedTimeModeFor(
        storeId,
        assignment.employeeId,
        assignment.shiftSlot,
      );
      if (mode === 'ACTUAL') return { from: checkIn, until: null };
      const paidUntil = await this.approvedOvertimeEnd(
        assignment.id,
        window.end,
      );
      // As the check-out pays it: a store that does not deduct late time
      // counts from the start anyway.
      const setting = await this.timekeepingSettingRepository
        .findOne({ where: { storeId } })
        .catch(() => null);
      const lateCounted =
        !!window.start &&
        checkIn.getTime() > window.start.getTime() &&
        Number(assignment.lateMinutes) > 0 &&
        !resolveAttendanceRules(setting).creditLateEarly;
      return {
        from: window.start && !lateCounted ? window.start : checkIn,
        until:
          paidUntil &&
          (!window.end || paidUntil.getTime() > window.end.getTime())
            ? paidUntil
            : window.end,
      };
    } catch {
      return { from: checkIn, until: null };
    }
  }

  /**
   * The shift under way with its live count window and what it earns: per
   * minute for an hourly contract, its fixed amount otherwise. Shown on top
   * of the month's estimate, which counts completed shifts only.
   */
  async inProgressShiftEstimate(
    this: StoresService,
    employeeProfileId: string,
    storeId: string,
    /** Only a shift of this month (payroll counts a shift by its work date). */
    forMonth?: VnMonth,
  ): Promise<{
    assignmentId: string;
    countFrom: string;
    countUntil: string | null;
    ratePerMinute: number;
    shiftAmount: number;
  } | null> {
    const active = await this.shiftAssignmentRepository
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .leftJoinAndSelect('slot.cycle', 'cycle')
      .where('a.employeeId = :employeeProfileId', { employeeProfileId })
      .andWhere('a.status = :status', {
        status: ShiftAssignmentStatus.CONFIRMED,
      })
      .andWhere('a.checkInTime IS NOT NULL')
      .andWhere('a.checkOutTime IS NULL')
      .andWhere('cycle.storeId = :storeId', { storeId })
      .orderBy('a.checkInTime', 'DESC')
      .getOne();
    if (!active) return null;
    // An overnight shift of the 31st, still under way on the 1st, belongs
    // to the month it started in.
    if (
      forMonth &&
      vnMonthOfDateString(String(active.shiftSlot?.workDate ?? '').slice(0, 10))
        ?.key !== forMonth.key
    ) {
      return null;
    }
    const count = await this.liveCountWindow(active, storeId);
    if (!count) return null;
    let ratePerMinute = 0;
    let shiftAmount = 0;
    try {
      const profile = await this.profileRepository.findOne({
        where: { id: employeeProfileId, storeId },
        relations: ['contracts'],
      });
      const contract = profile?.contracts?.find((c) => c.isActive) ?? null;
      const workDate = String(active.shiftSlot?.workDate ?? '').slice(0, 10);
      const month = vnMonthOfDateString(workDate) ?? vnMonthOf(new Date());
      if (contract) {
        const { rate: contractRate } = await this.resolveRateForMonth(
          employeeProfileId,
          contract,
          month,
        );
        // Đơn giá theo ca / vị trí / khung giờ: bình quân trên giờ theo lịch
        // của ca (con số chạy ở app là ước tính; phiếu lương chia đúng khung).
        const shiftWindow = effectiveWindowOf(active);
        const rate = await this.wageRateOfShift({
          storeId,
          employeeProfileId,
          paymentType: contract.paymentType,
          contractRate: Number(contractRate) || 0,
          workShiftId: active.shiftSlot?.workShiftId ?? null,
          from: shiftWindow.start,
          to: shiftWindow.end,
        });
        if (contract.paymentType === PaymentType.HOUR) {
          ratePerMinute = Number(rate) > 0 ? Number(rate) / 60 : 0;
        } else {
          const window = shiftWindow;
          const hours =
            window.start && window.end
              ? (window.end.getTime() - window.start.getTime()) / 3_600_000
              : 0;
          shiftAmount =
            calculateShiftEarnings({
              paymentType: contract.paymentType,
              baseSalary: Number(rate) || 0,
              hours,
              referenceDate: workDate ? vnMiddayInstant(workDate) : new Date(),
              workingDaysInMonth: await this.getStandardWorkingDays(
                storeId,
                month,
              ),
            }) ?? 0;
        }
      }
    } catch {
      // The live time still shows; only the money stays at the estimate.
    }
    return {
      assignmentId: active.id,
      countFrom: count.from.toISOString(),
      countUntil: count.until?.toISOString() ?? null,
      ratePerMinute,
      shiftAmount,
    };
  }

  /**
   * The shift the staff Home / "Hôm nay" cards and the check-in flow act on.
   *
   * Selection (Vietnam time):
   *  1. check-out: a checked-in, not checked-out shift (any date, so an
   *     overnight shift stays actionable after midnight);
   *  2. check-in: the earliest APPROVED, not-started shift that has not ended,
   *     among today's shifts and yesterday's overnight shift ending today;
   *  3. done: among the same shifts, the finished one (completed, or ended
   *     without a check-in = missed) that STARTED LATEST — so a missed
   *     morning shift no longer hides the afternoon shift completed after it;
   *  4. none.
   * Every mode carries the same keys, including workedMinutesToday (completed
   * shifts whose work date is today) and the early/overtime deltas computed
   * like the check-in/out result screens (computeAttendanceDeltas).
   */
  async getNextShiftAssignment(
    this: StoresService,
    employeeProfileId: string,
    storeId: string,
  ) {
    const now = new Date();
    // Vietnam calendar day, whatever the server timezone (a UTC host saw
    // "yesterday" between 00:00 and 07:00 VN).
    const todayStr = vnDateString(now);
    const yesterdayStr = vnDateString(new Date(now.getTime() - 86_400_000));

    this.logger.log(
      `[getNextShiftAssignment] employeeProfileId=${employeeProfileId}, storeId=${storeId}, todayStr=${todayStr}`,
    );

    // Count total shifts today for this employee in this store
    const totalShiftsToday = await this.shiftAssignmentRepository
      .createQueryBuilder('a')
      .leftJoin('a.shiftSlot', 'slot')
      .leftJoin('slot.cycle', 'cycle')
      .where('a.employeeId = :employeeProfileId', { employeeProfileId })
      .andWhere('slot.workDate = :todayStr', { todayStr })
      .andWhere('cycle.storeId = :storeId', { storeId })
      .andWhere('a.status IN (:...statuses)', {
        statuses: [
          ShiftAssignmentStatus.APPROVED,
          ShiftAssignmentStatus.CONFIRMED,
          ShiftAssignmentStatus.COMPLETED,
        ],
      })
      .getCount();

    // Comparison happens on real instants: `endTime` is a bare clock time, and
    // resolveShiftBoundaries anchors it to the work date in Asia/Ho_Chi_Minh,
    // rolling a 22:00-02:00 shift onto the following day. An approved late
    // arrival / early leave moves the start / end.
    const boundsOf = (assignment: ShiftAssignment) => {
      const slot = assignment.shiftSlot;
      return effectiveWindowOf({
        adjustedStartAt: assignment.adjustedStartAt,
        adjustedEndAt: assignment.adjustedEndAt,
        shiftSlot: slot
          ? {
              ...slot,
              workDate: String(slot.workDate ?? todayStr).slice(0, 10),
            }
          : { workDate: todayStr },
      });
    };
    const hasEnded = (assignment: ShiftAssignment): boolean => {
      const { end } = boundsOf(assignment);
      // No usable end time means we cannot prove it is over, so it stays open.
      return end !== null && end.getTime() <= now.getTime();
    };
    const startMs = (assignment: ShiftAssignment): number =>
      boundsOf(assignment).start?.getTime() ?? Number.NEGATIVE_INFINITY;

    // Additive attendance facts for the Home / "Hôm nay" cards.
    const attendanceFields = (assignment: ShiftAssignment) => {
      const autoCheckedOut = !!(
        assignment.isAutoCheckout || assignment.autoCheckoutReason
      );
      const { start, end } = boundsOf(assignment);
      const deltas = computeAttendanceDeltas({
        start,
        end,
        checkIn: assignment.checkInTime ?? null,
        checkOut: assignment.checkOutTime ?? null,
        autoCheckedOut,
      });
      return {
        attendanceStatus: assignment.attendanceStatus ?? null,
        checkOutTime: assignment.checkOutTime?.toISOString() || null,
        workedMinutes: assignment.workedMinutes ?? 0,
        earlyMinutes: assignment.earlyMinutes ?? 0,
        // Same maths as the check-in/out result screens: minutes checked in
        // before the start, and checked out after the end (0 on auto
        // check-out).
        earlyArrivalMinutes: deltas.earlyArrivalMinutes,
        overtimeMinutes: deltas.overtimeMinutes,
        autoCheckoutReason: assignment.autoCheckoutReason ?? null,
        autoCheckedOut,
        // Auto check-out: the shift end the employee is paid up to.
        scheduledCheckoutTime:
          assignment.scheduledCheckoutTime?.toISOString?.() || null,
      };
    };
    const onLeaveFor = (assignment: ShiftAssignment) =>
      assignment.checkInTime
        ? Promise.resolve(false)
        : isShiftCoveredByApprovedLeave(
            this.dataSource,
            employeeProfileId,
            String(assignment.shiftSlot?.workDate ?? todayStr).slice(0, 10),
            assignment.id,
          );
    const shiftFields = (assignment: ShiftAssignment) => {
      const slot = assignment.shiftSlot;
      const ws = slot?.workShift;
      // The slot's own times override its work shift's.
      const scheduledStartTime = slot?.startTime || ws?.startTime || '';
      const scheduledEndTime = slot?.endTime || ws?.endTime || '';
      const window = boundsOf(assignment);
      return {
        assignmentId: assignment.id,
        shiftName: ws?.shiftName || '',
        // The times in force: an approved late arrival / early leave shows
        // the new start / end (older builds display these as they are).
        startTime:
          assignment.adjustedStartAt && window.start
            ? `${vnClockHHmm(window.start)}:00`
            : scheduledStartTime,
        endTime:
          assignment.adjustedEndAt && window.end
            ? `${vnClockHHmm(window.end)}:00`
            : scheduledEndTime,
        scheduledStartTime,
        scheduledEndTime,
        effectiveStartAt: window.start?.toISOString() ?? null,
        effectiveEndAt: window.end?.toISOString() ?? null,
        lateApproved: !!assignment.adjustedStartAt,
        earlyLeaveApproved: !!assignment.adjustedEndAt,
        workDate: slot?.workDate || todayStr,
        shiftSlotId: slot?.id || null,
        checkInTime: assignment.checkInTime?.toISOString() || null,
        lateMinutes: assignment.lateMinutes || 0,
        location: slot?.location || ws?.location || '',
        note: slot?.note || '',
      };
    };

    const workedMinutesToday = await this.sumWorkedMinutesOn(
      employeeProfileId,
      storeId,
      todayStr,
    );

    // 1) Check if there's an active assignment (checked in but not checked out) in this store
    const activeAssignment = await this.shiftAssignmentRepository
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .leftJoinAndSelect('slot.cycle', 'cycle')
      .where('a.employeeId = :employeeProfileId', { employeeProfileId })
      .andWhere('a.status = :status', {
        status: ShiftAssignmentStatus.CONFIRMED,
      })
      .andWhere('a.checkOutTime IS NULL')
      .andWhere('cycle.storeId = :storeId', { storeId })
      .orderBy('a.checkInTime', 'DESC')
      .getOne();

    if (activeAssignment) {
      this.logger.log(
        `[getNextShiftAssignment] Found active (checked-in) assignment: ${activeAssignment.id}`,
      );
      return {
        ...shiftFields(activeAssignment),
        mode: 'check-out' as const,
        workDate: activeAssignment.shiftSlot?.workDate || null,
        // Still checked in after the shift's end time — the app can prompt to
        // check out rather than letting it run silently past closing.
        shiftEnded: hasEnded(activeAssignment),
        missed: false,
        onLeave: false,
        ...attendanceFields(activeAssignment),
        // Live "Hôm nay đã làm": count from `liveCountFrom` to now, never past
        // `liveCountUntil` (how the check-out will count this shift).
        ...(await this.liveCountWindow(activeAssignment, storeId).then(
          (count) => ({
            liveCountFrom: count?.from.toISOString() ?? null,
            liveCountUntil: count?.until?.toISOString() ?? null,
          }),
        )),
        workedMinutesToday,
        totalShiftsToday,
      };
    }

    // Today's shifts plus yesterday's (for an overnight shift ending today).
    // Bounded: one employee, one store, two work dates.
    const loaded = await this.shiftAssignmentRepository
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .leftJoinAndSelect('slot.cycle', 'cycle')
      .where('a.employeeId = :employeeProfileId', { employeeProfileId })
      .andWhere('slot.workDate IN (:...workDates)', {
        workDates: [yesterdayStr, todayStr],
      })
      .andWhere('cycle.storeId = :storeId', { storeId })
      .andWhere('a.status IN (:...statuses)', {
        statuses: [
          ShiftAssignmentStatus.APPROVED,
          ShiftAssignmentStatus.CONFIRMED,
          ShiftAssignmentStatus.COMPLETED,
        ],
      })
      .orderBy('slot.workDate', 'ASC')
      .addOrderBy('COALESCE(slot.start_time, ws.start_time)', 'ASC')
      .addOrderBy('a.id', 'ASC')
      // Many-to-one joins only, so a plain LIMIT is exact.
      .limit(50)
      .getMany();
    const relevant = (loaded ?? []).filter((assignment) => {
      const workDate = String(assignment.shiftSlot?.workDate ?? '').slice(
        0,
        10,
      );
      if (workDate === todayStr) return true;
      if (workDate !== yesterdayStr) return false;
      // Yesterday's shift only when it runs past midnight into today.
      const { end } = boundsOf(assignment);
      return end !== null && vnDateString(end) === todayStr;
    });
    const byStart = (x: ShiftAssignment, y: ShiftAssignment) =>
      startMs(x) - startMs(y) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

    // 2) The next approved shift still actionable. A shift whose end time has
    //    passed is never offered for check-in. A shift covered by approved
    //    leave is skipped in favour of a later real shift, and is returned
    //    (as onLeave) only when no other candidate remains.
    const approvedCandidates = relevant
      .filter(
        (a) =>
          a.status === ShiftAssignmentStatus.APPROVED &&
          !a.checkInTime &&
          !hasEnded(a),
      )
      .sort(byStart);
    let approvedAssignment: ShiftAssignment | undefined;
    let approvedOnLeave = false;
    for (const candidate of approvedCandidates) {
      if (!(await onLeaveFor(candidate))) {
        approvedAssignment = candidate;
        approvedOnLeave = false;
        break;
      }
      if (!approvedAssignment) {
        approvedAssignment = candidate;
        approvedOnLeave = true;
      }
    }

    if (approvedAssignment) {
      this.logger.log(
        `[getNextShiftAssignment] Found approved assignment: ${approvedAssignment.id}`,
      );
      return {
        ...shiftFields(approvedAssignment),
        mode: 'check-in' as const,
        checkInTime: null,
        lateMinutes: 0,
        shiftEnded: false,
        missed: false,
        onLeave: approvedOnLeave,
        ...attendanceFields(approvedAssignment),
        workedMinutesToday,
        totalShiftsToday,
      };
    }

    // Terminal states below also carry the next scheduled shift (any day)
    // for the "Ca tiếp theo" line.
    const nextShift = await this.findNextUpcomingShift(
      employeeProfileId,
      storeId,
      todayStr,
      now,
    );

    // 3) Finished shifts: completed (checked in and out, or auto checked out)
    //    or missed (approved, never checked in, and the clock ran out). The
    //    latest-starting one reflects where the employee is now.
    const terminal = relevant
      .filter((a) =>
        a.status === ShiftAssignmentStatus.APPROVED && !a.checkInTime
          ? hasEnded(a)
          : true,
      )
      .sort(byStart);
    const doneAssignment = terminal[terminal.length - 1];

    if (doneAssignment) {
      const missed = !doneAssignment.checkInTime;
      this.logger.log(
        `[getNextShiftAssignment] Terminal assignment: ${doneAssignment.id}, status=${doneAssignment.status}, missed=${missed}`,
      );
      return {
        ...shiftFields(doneAssignment),
        mode: 'done' as const,
        shiftEnded: hasEnded(doneAssignment),
        // Never checked in: attendanceStatus is 'ABSENT' once the per-minute
        // reconcile marked it; null for that first minute, or when onLeave
        // (approved full-day leave → "Nghỉ phép", never ABSENT).
        missed,
        onLeave: await onLeaveFor(doneAssignment),
        ...attendanceFields(doneAssignment),
        workedMinutesToday,
        nextShift,
        totalShiftsToday,
      };
    }

    this.logger.log(
      `[getNextShiftAssignment] No shifts found for today (${todayStr})`,
    );
    // Same fields as every other mode, with empty defaults, so the app can
    // read the contract without per-mode guards.
    return {
      mode: 'none',
      assignmentId: null,
      shiftName: null,
      startTime: null,
      endTime: null,
      scheduledStartTime: null,
      scheduledEndTime: null,
      effectiveStartAt: null,
      effectiveEndAt: null,
      lateApproved: false,
      earlyLeaveApproved: false,
      workDate: null,
      shiftSlotId: null,
      checkInTime: null,
      lateMinutes: 0,
      location: '',
      note: '',
      shiftEnded: false,
      missed: false,
      onLeave: false,
      attendanceStatus: null,
      checkOutTime: null,
      workedMinutes: 0,
      earlyMinutes: 0,
      earlyArrivalMinutes: 0,
      overtimeMinutes: 0,
      autoCheckoutReason: null,
      autoCheckedOut: false,
      scheduledCheckoutTime: null,
      workedMinutesToday,
      nextShift,
      totalShiftsToday,
    };
  }

  /**
   * Early-arrival / overtime minutes of a recorded attendance, from its stored
   * check-in/out against the slot's Vietnam boundaries — the same maths as
   * the first check-in/out response (computeAttendanceDeltas).
   */
  storedAttendanceDeltas(this: StoresService, assignment: ShiftAssignment) {
    const { start, end } = effectiveWindowOf(assignment);
    return computeAttendanceDeltas({
      start,
      end,
      checkIn: assignment.checkInTime ?? null,
      checkOut: assignment.checkOutTime ?? null,
      autoCheckedOut: !!(
        assignment.isAutoCheckout || assignment.autoCheckoutReason
      ),
    });
  }

  /** Worked minutes of the employee's completed shifts on a VN work date. */
  async sumWorkedMinutesOn(
    this: StoresService,
    employeeProfileId: string,
    storeId: string,
    workDate: string,
  ): Promise<number> {
    const raw = await this.shiftAssignmentRepository
      .createQueryBuilder('a')
      .leftJoin('a.shiftSlot', 'slot')
      .leftJoin('slot.cycle', 'cycle')
      .select('COALESCE(SUM(a.workedMinutes), 0)', 'total')
      .where('a.employeeId = :employeeProfileId', { employeeProfileId })
      .andWhere('slot.workDate = :workDate', { workDate })
      .andWhere('cycle.storeId = :storeId', { storeId })
      .andWhere('a.status = :status', {
        status: ShiftAssignmentStatus.COMPLETED,
      })
      .getRawOne<{ total: string | number }>();
    return Number(raw?.total || 0);
  }
}
