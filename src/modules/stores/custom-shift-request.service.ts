import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { vnDateString } from '../../common/utils/vn-calendar';
import {
  NotificationPriority,
  NotificationType,
} from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { ActivityLogService } from './activity-log.service';
import { ACTIVITY_ACTIONS } from './activity-log.summary';
import {
  CreateCustomShiftRequestDto,
  RejectCustomShiftRequestDto,
} from './dto/custom-shift-request.dto';
import {
  CustomShiftRequest,
  CustomShiftRequestStatus,
  CustomShiftScheduleRef,
} from './entities/custom-shift-request.entity';
import {
  EmployeeProfile,
  EMPLOYED_STATUSES,
} from './entities/employee-profile.entity';
import { Store } from './entities/store.entity';
import {
  customShiftDurationMinutes,
  expandCustomShiftDates,
  isOvernight,
  normalizeCustomShiftRequest,
  toHHmm,
} from './custom-shift-request.utils';
import { OWNER_APPROVAL_ROUTE } from './owner-notification.utils';
import { lockStoreShiftAvailability } from './shift-availability-lock';
import {
  ShiftRecurrenceEndType,
  ShiftRecurrenceFrequency,
} from './shift-schedule.types';
import {
  findSameNameShiftOnDates,
  SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES,
  StoresService,
} from './stores.service';

/** Staff app work-shift screen. */
export const STAFF_WORK_SHIFT_ROUTE = '/(home)/workshift';
export const CUSTOM_SHIFT_NOTIFICATION_TYPE = 'CUSTOM_SHIFT_REQUEST';
const OWNER_LIST_LIMIT = 200;
const STAFF_LIST_LIMIT = 100;
const SHIFT_NAME_MAX = 80;

export interface CustomShiftRequestView {
  id: string;
  storeId: string;
  employeeProfileId: string;
  employee: { id: string; fullName: string | null; avatar: string | null } | null;
  startDate: string;
  endDate: string;
  daysOfWeek: number[] | null;
  startTime: string;
  endTime: string;
  isOvernight: boolean;
  durationMinutes: number;
  dates: string[];
  note: string | null;
  status: CustomShiftRequestStatus;
  decidedByAccountId: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  createdSchedule: CustomShiftScheduleRef | null;
  createdAt: string;
  updatedAt: string;
}

const dateOnly = (value: unknown): string =>
  value instanceof Date ? vnDateString(value) : String(value ?? '').slice(0, 10);

const isUniqueViolation = (error: any) =>
  error?.code === '23505' || error?.driverError?.code === '23505';

const ddmm = (date: string) => {
  const [, month, day] = date.split('-');
  return `${day}/${month}`;
};

const describeRange = (request: { startDate: string; endDate: string }) =>
  request.startDate === request.endDate
    ? `ngày ${ddmm(request.startDate)}`
    : `từ ${ddmm(request.startDate)} đến ${ddmm(request.endDate)}`;

/**
 * X5 "Khung giờ khác": staff ask for a shift at a custom time; the owner
 * approves or rejects it in the approvals screen.
 *
 * Design: one request = one time window over one date or over chosen
 * weekdays of a date range (<= 62 days). It stays one row; approval expands
 * it into its dates and, in a single transaction, creates one
 * non-repeating shift per date through the unified shift-schedule path
 * (`StoresService.createShiftScheduleWithin`) with only this employee
 * assigned (maxStaff 1). All-or-nothing: any conflicting date fails the
 * whole approval with 409 and nothing is written. Dates already in the past
 * when the owner approves are skipped (recorded); if none remain, 409.
 */
@Injectable()
export class CustomShiftRequestService {
  private readonly logger = new Logger(CustomShiftRequestService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CustomShiftRequest)
    private readonly requestRepository: Repository<CustomShiftRequest>,
    @InjectRepository(EmployeeProfile)
    private readonly profileRepository: Repository<EmployeeProfile>,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    private readonly storesService: StoresService,
    private readonly notificationsService: NotificationsService,
    @Optional() private readonly activityLogService?: ActivityLogService,
  ) {}

  // ── Staff ────────────────────────────────────────────────────────────

  async create(
    storeId: string,
    accountId: string,
    dto: CreateCustomShiftRequestDto,
  ): Promise<CustomShiftRequestView> {
    const profile = await this.requireSelfProfile(storeId, accountId);
    const normalized = normalizeCustomShiftRequest(dto);

    let saved: CustomShiftRequest;
    try {
      saved = await this.dataSource.transaction(async (manager) => {
        const row = await manager.save(
          CustomShiftRequest,
          manager.create(CustomShiftRequest, {
            storeId,
            employeeProfileId: profile.id,
            startDate: normalized.startDate,
            endDate: normalized.endDate,
            daysOfWeek: normalized.daysOfWeek,
            startTime: normalized.startTime,
            endTime: normalized.endTime,
            note: normalized.note,
            status: CustomShiftRequestStatus.PENDING,
          }),
        );
        await this.log(manager, ACTIVITY_ACTIONS.CUSTOM_SHIFT_REQUEST_CREATED, row, accountId);
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'CUSTOM_SHIFT_REQUEST_DUPLICATE',
          message: 'Bạn đã gửi yêu cầu khung giờ này và đang chờ duyệt',
        });
      }
      throw error;
    }

    void this.notifyOwnerOfNewRequest(saved, profile);
    return this.toView(saved, profile);
  }

  async listMine(storeId: string, accountId: string) {
    const profile = await this.requireSelfProfile(storeId, accountId, false);
    const rows = await this.requestRepository.find({
      where: { storeId, employeeProfileId: profile.id },
      order: { createdAt: 'DESC' },
      take: STAFF_LIST_LIMIT,
    });
    return rows.map((row) => this.toView(row, profile));
  }

  async cancel(storeId: string, requestId: string, accountId: string) {
    const profile = await this.requireSelfProfile(storeId, accountId, false);
    const row = await this.dataSource.transaction(async (manager) => {
      const request = await this.lockRequest(manager, storeId, requestId);
      if (request.employeeProfileId !== profile.id) {
        throw new ForbiddenException({
          code: 'CUSTOM_SHIFT_REQUEST_NOT_OWNED',
          message: 'Bạn chỉ có thể huỷ yêu cầu của chính mình',
        });
      }
      if (request.status === CustomShiftRequestStatus.CANCELLED) return request;
      this.assertPending(request);
      request.status = CustomShiftRequestStatus.CANCELLED;
      request.decidedByAccountId = accountId;
      request.decidedAt = new Date();
      const saved = await manager.save(CustomShiftRequest, request);
      await this.log(manager, ACTIVITY_ACTIONS.CUSTOM_SHIFT_REQUEST_CANCELLED, saved, accountId);
      return saved;
    });
    return this.toView(row, profile);
  }

  // ── Owner ────────────────────────────────────────────────────────────

  async listForOwner(storeId: string, status?: CustomShiftRequestStatus) {
    const rows = await this.requestRepository.find({
      where: { storeId, ...(status ? { status } : {}) },
      relations: ['employeeProfile', 'employeeProfile.account'],
      order: { createdAt: 'DESC' },
      take: OWNER_LIST_LIMIT,
    });
    return rows.map((row) => this.toView(row, row.employeeProfile));
  }

  /**
   * Idempotent and race-safe: the request row is locked for the whole
   * approval, a second approve returns the first result, and the shifts,
   * the status change and the activity entry commit together or not at all.
   */
  async approve(storeId: string, requestId: string, ownerAccountId: string) {
    let createdAssignmentIds: string[] = [];
    let newlyApproved = false;
    const request = await this.dataSource.transaction(async (manager) => {
      const row = await this.lockRequest(manager, storeId, requestId);
      if (row.status === CustomShiftRequestStatus.APPROVED) return row;
      this.assertPending(row);

      const employee = await manager.findOne(EmployeeProfile, {
        where: {
          id: row.employeeProfileId,
          storeId,
          employmentStatus: In([...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]),
        },
        relations: ['account'],
      });
      if (!employee) {
        throw new ConflictException({
          code: 'CUSTOM_SHIFT_EMPLOYEE_NOT_ELIGIBLE',
          message: 'Nhân viên không còn làm việc tại cửa hàng này',
        });
      }

      // Same lock the unified path takes; held until commit so no other
      // roster write can slip in between the check and the inserts.
      await lockStoreShiftAvailability(manager, storeId);

      const startTime = toHHmm(row.startTime);
      const endTime = toHHmm(row.endTime);
      const allDates = expandCustomShiftDates(
        dateOnly(row.startDate),
        dateOnly(row.endDate),
        row.daysOfWeek?.length ? row.daysOfWeek.map(Number) : null,
      );
      const today = vnDateString();
      const dates = allDates.filter((date) => date >= today);
      const skippedPastDates = allDates.filter((date) => date < today);
      if (!dates.length) {
        throw new ConflictException({
          code: 'CUSTOM_SHIFT_REQUEST_EXPIRED',
          message: 'Tất cả các ngày của yêu cầu đã qua',
        });
      }

      const conflicts = await this.storesService.findEmployeeShiftConflicts(
        manager,
        storeId,
        employee.id,
        dates,
        startTime,
        endTime,
      );
      if (conflicts.length) {
        throw new ConflictException({
          code: 'CUSTOM_SHIFT_CONFLICT',
          message: 'Nhân viên đã có ca hoặc lịch nghỉ trùng khung giờ này',
          conflicts,
        });
      }

      const shiftName = this.shiftNameFor(employee, startTime, endTime, row.id);
      // The name is unique per request, so this only fires on data drift;
      // answer it with a coded 409 instead of the generic 400.
      const sameName = await findSameNameShiftOnDates(
        manager,
        storeId,
        [shiftName],
        dates,
      );
      if (sameName) {
        throw this.shiftNameTaken(sameName.workDate);
      }
      const ref: CustomShiftScheduleRef = {
        cycleIds: [],
        shiftIds: [],
        assignmentIds: [],
        dates: [],
        skippedPastDates,
      };
      for (const date of dates) {
        const created = await this.createShiftFor(
          manager,
          storeId,
          ownerAccountId,
          {
            shiftName,
            startDate: date,
            startTime,
            endTime,
            maxStaff: 1,
            note: 'Khung giờ khác (nhân viên đề xuất)',
            employeeIds: [employee.id],
            recurrence: {
              enabled: false,
              frequency: ShiftRecurrenceFrequency.DAILY,
              interval: 1,
              endType: ShiftRecurrenceEndType.COUNT,
              occurrenceCount: 1,
            },
          },
        );
        ref.cycleIds.push(created.id);
        ref.shiftIds.push(...created.shifts.map((shift) => shift.id));
        ref.assignmentIds.push(...created.assignmentIds);
        ref.dates.push(date);
      }

      row.status = CustomShiftRequestStatus.APPROVED;
      row.decidedByAccountId = ownerAccountId;
      row.decidedAt = new Date();
      row.createdScheduleRef = ref;
      const saved = await manager.save(CustomShiftRequest, row);
      await this.log(manager, ACTIVITY_ACTIONS.CUSTOM_SHIFT_REQUEST_APPROVED, saved, ownerAccountId);
      createdAssignmentIds = ref.assignmentIds;
      newlyApproved = true;
      return saved;
    });

    if (newlyApproved) {
      this.storesService.scheduleRemindersForNewAssignments(createdAssignmentIds);
      void this.notifyEmployeeOfDecision(request);
    }
    return this.toView(request, await this.loadProfile(request.employeeProfileId));
  }

  async reject(
    storeId: string,
    requestId: string,
    ownerAccountId: string,
    dto: RejectCustomShiftRequestDto,
  ) {
    let newlyRejected = false;
    const request = await this.dataSource.transaction(async (manager) => {
      const row = await this.lockRequest(manager, storeId, requestId);
      if (row.status === CustomShiftRequestStatus.REJECTED) return row;
      this.assertPending(row);
      row.status = CustomShiftRequestStatus.REJECTED;
      row.decidedByAccountId = ownerAccountId;
      row.decidedAt = new Date();
      row.rejectionReason = dto?.reason?.trim() || null;
      const saved = await manager.save(CustomShiftRequest, row);
      await this.log(manager, ACTIVITY_ACTIONS.CUSTOM_SHIFT_REQUEST_REJECTED, saved, ownerAccountId);
      newlyRejected = true;
      return saved;
    });
    if (newlyRejected) void this.notifyEmployeeOfDecision(request);
    return this.toView(request, await this.loadProfile(request.employeeProfileId));
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /**
   * The caller's own profile at the store. Creating requires a rosterable
   * (ACTIVE / PROBATION) profile; reading and cancelling their own requests
   * only requires an employed one (StoreAccessGuard already admits it).
   */
  private async requireSelfProfile(
    storeId: string,
    accountId: string,
    rosterable = true,
  ): Promise<EmployeeProfile> {
    const statuses = rosterable
      ? [...SHIFT_ELIGIBLE_EMPLOYMENT_STATUSES]
      : [...EMPLOYED_STATUSES];
    const profile = await this.profileRepository.findOne({
      where: { storeId, accountId, employmentStatus: In(statuses) },
      relations: ['account'],
    });
    if (!profile) {
      throw new ForbiddenException({
        code: 'CUSTOM_SHIFT_NOT_EMPLOYED',
        message: 'Bạn không phải nhân viên đang làm việc tại cửa hàng này',
      });
    }
    return profile;
  }

  private async lockRequest(
    manager: EntityManager,
    storeId: string,
    requestId: string,
  ): Promise<CustomShiftRequest> {
    const row = await manager.findOne(CustomShiftRequest, {
      where: { id: requestId, storeId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'CUSTOM_SHIFT_REQUEST_NOT_FOUND',
        message: 'Không tìm thấy yêu cầu',
      });
    }
    return row;
  }

  private assertPending(row: CustomShiftRequest) {
    if (row.status !== CustomShiftRequestStatus.PENDING) {
      throw new ConflictException({
        code: 'CUSTOM_SHIFT_REQUEST_NOT_PENDING',
        message: 'Yêu cầu đã được xử lý',
        status: row.status,
      });
    }
  }

  /**
   * "Khung giờ khác 22:00-06:00 · Minh #1a2b3c": the request-id suffix makes
   * the name unique per request, so the same-name-on-date rule never blocks
   * one employee's second request (or another employee's identical one).
   */
  private shiftNameFor(
    employee: EmployeeProfile,
    startTime: string,
    endTime: string,
    requestId: string,
  ) {
    const suffix = ` #${requestId.replace(/-/g, '').slice(0, 6)}`;
    const who = employee.account?.fullName?.trim();
    const base = `Khung giờ khác ${startTime}-${endTime}${who ? ` · ${who}` : ''}`;
    return `${base.slice(0, SHIFT_NAME_MAX - suffix.length).trim()}${suffix}`;
  }

  private shiftNameTaken(workDate?: string) {
    return new ConflictException({
      code: 'CUSTOM_SHIFT_NAME_TAKEN',
      message: 'Đã có ca cùng tên trong ngày này',
      ...(workDate ? { date: workDate } : {}),
    });
  }

  /** The unified path; its same-name 400 is mapped to a coded 409. */
  private async createShiftFor(
    ...args: Parameters<StoresService['createShiftScheduleWithin']>
  ) {
    try {
      return await this.storesService.createShiftScheduleWithin(...args);
    } catch (error) {
      if (
        error instanceof BadRequestException &&
        /^Đã có ca ".*" vào ngày/.test(error.message)
      ) {
        throw this.shiftNameTaken(args[3].startDate);
      }
      throw error;
    }
  }

  private async loadProfile(profileId: string) {
    return this.profileRepository.findOne({
      where: { id: profileId },
      relations: ['account'],
    });
  }

  private async log(
    manager: EntityManager,
    action: string,
    row: CustomShiftRequest,
    actorAccountId: string,
  ) {
    if (!this.activityLogService) return;
    const startDate = dateOnly(row.startDate);
    const endDate = dateOnly(row.endDate);
    const dates =
      row.createdScheduleRef?.dates.length ??
      expandCustomShiftDates(
        startDate,
        endDate,
        row.daysOfWeek?.length ? row.daysOfWeek.map(Number) : null,
      ).length;
    try {
      await this.activityLogService.record(manager, {
        storeId: row.storeId,
        actorAccountId,
        subjectEmployeeProfileId: row.employeeProfileId,
        action,
        resourceType: 'custom_shift_request',
        resourceId: row.id,
        params: {
          fromDate: startDate,
          toDate: endDate,
          startTime: toHHmm(row.startTime),
          endTime: toHHmm(row.endTime),
          count: dates,
        },
        idempotencyKey: `${action}:${row.id}`,
      });
    } catch {
      // record() never throws; belt and braces.
    }
  }

  private toView(
    row: CustomShiftRequest,
    profile?: EmployeeProfile | null,
  ): CustomShiftRequestView {
    const startDate = dateOnly(row.startDate);
    const endDate = dateOnly(row.endDate);
    const startTime = toHHmm(row.startTime);
    const endTime = toHHmm(row.endTime);
    const daysOfWeek = row.daysOfWeek?.length ? row.daysOfWeek.map(Number) : null;
    return {
      id: row.id,
      storeId: row.storeId,
      employeeProfileId: row.employeeProfileId,
      employee: profile
        ? {
            id: profile.id,
            fullName: profile.account?.fullName ?? null,
            avatar: profile.account?.avatar ?? null,
          }
        : null,
      startDate,
      endDate,
      daysOfWeek,
      startTime,
      endTime,
      isOvernight: isOvernight(startTime, endTime),
      durationMinutes: customShiftDurationMinutes(startTime, endTime),
      dates: expandCustomShiftDates(startDate, endDate, daysOfWeek),
      note: row.note ?? null,
      status: row.status,
      decidedByAccountId: row.decidedByAccountId ?? null,
      decidedAt: row.decidedAt ? new Date(row.decidedAt).toISOString() : null,
      rejectionReason: row.rejectionReason ?? null,
      createdSchedule: row.createdScheduleRef ?? null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt ?? row.createdAt).toISOString(),
    };
  }

  /** After commit, best effort. */
  private async notifyOwnerOfNewRequest(
    request: CustomShiftRequest,
    profile: EmployeeProfile,
  ) {
    try {
      const store = await this.storeRepository.findOne({
        where: { id: request.storeId },
        select: ['id', 'ownerAccountId'],
      });
      if (!store?.ownerAccountId) return;
      const who = profile.account?.fullName?.trim() || 'Một nhân viên';
      const startDate = dateOnly(request.startDate);
      const endDate = dateOnly(request.endDate);
      await this.notificationsService.create({
        accountId: store.ownerAccountId,
        storeId: request.storeId,
        title: 'Yêu cầu khung giờ khác',
        content: `${who} xin làm ${toHHmm(request.startTime)}–${toHHmm(
          request.endTime,
        )} ${describeRange({ startDate, endDate })}.`,
        type: NotificationType.SYSTEM,
        priority: NotificationPriority.NORMAL,
        actionUrl: OWNER_APPROVAL_ROUTE,
        metadata: {
          type: CUSTOM_SHIFT_NOTIFICATION_TYPE,
          event: 'CREATED',
          storeId: request.storeId,
          requestId: request.id,
          employeeProfileId: request.employeeProfileId,
          startDate,
          endDate,
        },
      });
    } catch (error) {
      this.logger.warn(
        `[customShiftRequest] owner notification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** After commit, best effort: approved / rejected to the employee. */
  private async notifyEmployeeOfDecision(request: CustomShiftRequest) {
    try {
      const profile = await this.loadProfile(request.employeeProfileId);
      if (!profile?.accountId) return;
      const approved = request.status === CustomShiftRequestStatus.APPROVED;
      const startDate = dateOnly(request.startDate);
      const endDate = dateOnly(request.endDate);
      const window = `${toHHmm(request.startTime)}–${toHHmm(request.endTime)} ${describeRange(
        { startDate, endDate },
      )}`;
      await this.notificationsService.create({
        accountId: profile.accountId,
        storeId: request.storeId,
        title: approved
          ? 'Yêu cầu khung giờ đã được duyệt'
          : 'Yêu cầu khung giờ bị từ chối',
        content: approved
          ? `Chủ cửa hàng đã duyệt khung giờ ${window}. Ca đã có trong lịch làm việc của bạn.`
          : `Chủ cửa hàng đã từ chối khung giờ ${window}.`,
        type: approved ? NotificationType.SHIFT_APPROVAL : NotificationType.SYSTEM,
        priority: NotificationPriority.NORMAL,
        actionUrl: STAFF_WORK_SHIFT_ROUTE,
        metadata: {
          type: CUSTOM_SHIFT_NOTIFICATION_TYPE,
          event: approved ? 'APPROVED' : 'REJECTED',
          storeId: request.storeId,
          requestId: request.id,
          startDate,
          endDate,
          ...(approved && request.createdScheduleRef
            ? { workDates: request.createdScheduleRef.dates }
            : {}),
        },
      });
    } catch (error) {
      this.logger.warn(
        `[customShiftRequest] employee notification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

