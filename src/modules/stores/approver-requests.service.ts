import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';

import {
  ApproverScope,
  ApproverScopeService,
  APPROVER_FORBIDDEN,
  RequestApproverType,
  sqlNormalizeDoc,
} from './approver-scope.service';
import {
  approverEmployeeView,
  bonusWorkRequestView,
  customShiftRequestView,
  kpiApprovalRequestView,
  leaveRequestView,
  salaryAdvanceRequestView,
  shiftChangeRequestView,
  shiftRegistrationView,
} from './approver-list-views';
import { BonusWorkRequest } from './entities/bonus-work-request.entity';
import { CustomShiftRequest } from './entities/custom-shift-request.entity';
import {
  EmployeeLeaveRequest,
  LeaveType,
} from './entities/employee-leave-request.entity';
import { SkillProgressStatus } from './entities/employee-skill-progress.entity';
import { KpiApprovalRequest } from './entities/kpi-approval-request.entity';
import { SalaryAdvanceRequest } from './entities/salary-advance-request.entity';
import {
  ShiftAssignment,
  ShiftAssignmentStatus,
} from './entities/shift-management.entity';
import { ShiftChangeRequest } from './entities/shift-change-request.entity';
import { ListApproverRequestsQueryDto } from './dto/store-request-approver.dto';

const DEFAULT_LIMIT = 20;

/** Generic status token → each type's real stored value. */
type StatusMap = { PENDING: string; APPROVED: string; REJECTED: string };
const STATUS_GENERIC: StatusMap = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};
const STATUS_KPI: StatusMap = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Chấp thuận',
  REJECTED: 'Từ chối',
};
const STATUS_SALARY: StatusMap = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
};
const STATUS_REGISTRATION: StatusMap = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'CANCELLED',
};

export interface ApproverListResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * The scoped-approver read side: the inbox lists and counts. Each list resolves
 * the caller's scope through {@link ApproverScopeService} (owner → unscoped;
 * approver → their one scope; anyone else → 403 APPROVER_FORBIDDEN), then pushes
 * the scope filter INTO SQL so pagination and totals are exact (no silent cap).
 * The SQL mirrors `employeeMatchesScope` exactly; a disposable pg-e2e test pins
 * the two together. Money/PII payloads are reduced (N2).
 */
@Injectable()
export class ApproverRequestsService {
  constructor(
    private readonly scope: ApproverScopeService,
    @InjectRepository(EmployeeLeaveRequest)
    private readonly leaveRepository: Repository<EmployeeLeaveRequest>,
    @InjectRepository(ShiftChangeRequest)
    private readonly shiftChangeRepository: Repository<ShiftChangeRequest>,
    @InjectRepository(BonusWorkRequest)
    private readonly bonusWorkRepository: Repository<BonusWorkRequest>,
    @InjectRepository(CustomShiftRequest)
    private readonly customShiftRepository: Repository<CustomShiftRequest>,
    @InjectRepository(KpiApprovalRequest)
    private readonly kpiRepository: Repository<KpiApprovalRequest>,
    @InjectRepository(SalaryAdvanceRequest)
    private readonly salaryAdvanceRepository: Repository<SalaryAdvanceRequest>,
    @InjectRepository(ShiftAssignment)
    private readonly assignmentRepository: Repository<ShiftAssignment>,
  ) {}

  private forbidden(): never {
    throw new ForbiddenException({
      code: APPROVER_FORBIDDEN,
      message: 'Bạn không có quyền xem danh sách này',
    });
  }

  /** Generic PENDING/APPROVED/REJECTED → the type's stored value, or 400. */
  private mapStatus(
    raw: string | undefined,
    map: StatusMap,
  ): string | undefined {
    if (raw == null || raw === '') return undefined;
    const key = raw.trim().toUpperCase();
    if (key === 'PENDING' || key === 'APPROVED' || key === 'REJECTED') {
      return map[key as keyof StatusMap];
    }
    throw new BadRequestException({
      code: 'APPROVER_STATUS_INVALID',
      message: 'status phải là PENDING, APPROVED hoặc REJECTED',
    });
  }

  private pageLimit(query: ListApproverRequestsQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : DEFAULT_LIMIT;
    return { page, limit };
  }

  /**
   * Pushes the scope into SQL, mirroring `employeeMatchesScope`: a dimension is
   * satisfied when empty ("tất cả") or the target's value is listed; dimensions
   * are ANDed, values ORed. Skill matches the career-v2 achieved rows OR the
   * legacy single `skill_id` (D3). The approver never sees their own request.
   * Compares as text to avoid uuid-vs-text operator issues with bound params.
   */
  private applyScope<T extends ObjectLiteral>(
    qb: SelectQueryBuilder<T>,
    scope: ApproverScope,
    storeId: string,
    // The request's own employee-profile column (differs for shift assignments,
    // whose column is `employee_id`, not `employee_profile_id`).
    selfColumn = 'request.employee_profile_id',
  ): void {
    if (scope.isOwner) return;
    qb.andWhere(`${selfColumn}::text != :selfPid`, {
      selfPid: scope.approverProfileId,
    });
    // R3(a): hide any request whose target is itself an active approver of the
    // store (owner-only). Mirrors `canApprove`'s TARGET_APPROVER branch so the
    // list and the decide path agree exactly.
    qb.andWhere(
      `NOT EXISTS (
          SELECT 1 FROM store_request_approvers sra
           WHERE sra.employee_profile_id = profile.id
             AND sra.store_id = :scopeStoreId
             AND sra.is_active
             AND sra.deleted_at IS NULL)`,
      { scopeStoreId: storeId },
    );
    // R3(b): hide any request whose target shares a normalized identity document
    // with this approver (SHARED_IDENTITY). Only when the approver actually has
    // a document — otherwise there is nothing to collide with.
    if (scope.approverDocsNormalized.length) {
      qb.andWhere(
        `NOT EXISTS (
            SELECT 1 FROM account_identity_documents aid
             WHERE aid.account_id = profile.account_id
               AND ${sqlNormalizeDoc('aid.document_number')} IN (:...approverDocs))`,
        { approverDocs: scope.approverDocsNormalized },
      );
    }
    if (scope.departmentIds.length) {
      qb.andWhere('profile.department_id::text IN (:...deptIds)', {
        deptIds: scope.departmentIds,
      });
    }
    if (scope.positionIds.length) {
      qb.andWhere('profile.store_role_id::text IN (:...posIds)', {
        posIds: scope.positionIds,
      });
    }
    if (scope.skillIds.length) {
      qb.andWhere(
        `(profile.skill_id::text IN (:...skillIdsLegacy) OR EXISTS (
            SELECT 1 FROM employee_skill_progress esp
             WHERE esp.employee_profile_id = profile.id
               AND esp.status = :achievedStatus
               AND esp.deleted_at IS NULL
               AND esp.skill_id::text IN (:...skillIdsAchieved)))`,
        {
          skillIdsLegacy: scope.skillIds,
          skillIdsAchieved: scope.skillIds,
          achievedStatus: SkillProgressStatus.ACHIEVED,
        },
      );
    }
  }

  private employeeOf(profile: any) {
    return approverEmployeeView(profile);
  }

  private async paginate<E extends ObjectLiteral, V>(
    qb: SelectQueryBuilder<E>,
    query: ListApproverRequestsQueryDto,
    view: (row: E) => V,
  ): Promise<ApproverListResult<V>> {
    const { page, limit } = this.pageLimit(query);
    // B1: order by ENTITY PROPERTY paths (createdAt / id), never raw column
    // names. With getManyAndCount() + skip/take + joins TypeORM builds a
    // distinct id subquery and maps the order-by to selected columns by
    // property name — `request.created_at` (a column) has no property and throws.
    qb.orderBy('request.createdAt', 'DESC')
      .addOrderBy('request.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    const [rows, total] = await qb.getManyAndCount();
    return { items: rows.map(view), total, page, limit };
  }

  // ── Leave / late / early ────────────────────────────────────────────────

  private async leaveQuery(
    accountId: string | undefined,
    storeId: string,
    query: ListApproverRequestsQueryDto,
  ): Promise<{
    qb: SelectQueryBuilder<EmployeeLeaveRequest>;
    canViewReasons: boolean;
  }> {
    // One approver row may hold any of leave / late / early; they share the one
    // scope. Show the union of the leave types actually held.
    const scopes = await Promise.all(
      [
        RequestApproverType.LEAVE,
        RequestApproverType.LATE,
        RequestApproverType.EARLY,
      ].map(async (type) => ({
        type,
        scope: await this.scope.scopeFilterFor(accountId, storeId, type),
      })),
    );
    const held = scopes.filter((e) => e.scope !== null);
    if (!held.length) this.forbidden();
    const scope = held[0].scope as ApproverScope;
    const allowed = new Set<LeaveType>();
    for (const { type } of held) {
      if (type === RequestApproverType.LATE) allowed.add(LeaveType.LATE);
      else if (type === RequestApproverType.EARLY) allowed.add(LeaveType.EARLY);
      else
        [
          LeaveType.SICK,
          LeaveType.PERSONAL,
          LeaveType.VACATION,
          LeaveType.UNPAID,
          LeaveType.SUDDEN,
          LeaveType.OVERTIME,
          LeaveType.OTHER,
        ].forEach((t) => allowed.add(t));
    }
    const qb = this.leaveRepository
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.employeeProfile', 'profile')
      .leftJoinAndSelect('profile.account', 'account')
      .leftJoinAndSelect('profile.storeRole', 'storeRole')
      .where('request.store_id = :storeId', { storeId })
      .andWhere('request.type IN (:...leaveTypes)', {
        leaveTypes: [...allowed],
      });
    const status = this.mapStatus(query.status, STATUS_GENERIC);
    if (status) qb.andWhere('request.status = :status', { status });
    this.applyScope(qb, scope, storeId);
    return {
      qb,
      canViewReasons:
        scope.isOwner ||
        (scope as Extract<ApproverScope, { isOwner: false }>).canViewReasons,
    };
  }

  async listLeaveRequests(
    accountId: string | undefined,
    storeId: string,
    query: ListApproverRequestsQueryDto,
  ) {
    const { qb, canViewReasons } = await this.leaveQuery(
      accountId,
      storeId,
      query,
    );
    return this.paginate(qb, query, (row) =>
      leaveRequestView(
        row,
        this.employeeOf((row as any).employeeProfile),
        canViewReasons,
      ),
    );
  }

  // ── Shift registration (pending self-registrations) ──────────────────────

  private async registrationQuery(
    accountId: string | undefined,
    storeId: string,
    query: ListApproverRequestsQueryDto,
  ): Promise<SelectQueryBuilder<ShiftAssignment>> {
    const scope = await this.scope.scopeFilterFor(
      accountId,
      storeId,
      RequestApproverType.SHIFT_REGISTRATION,
    );
    if (!scope) this.forbidden();
    const qb = this.assignmentRepository
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.shiftSlot', 'slot')
      .leftJoinAndSelect('slot.cycle', 'cycle')
      .leftJoinAndSelect('slot.workShift', 'ws')
      .leftJoinAndSelect('request.employee', 'profile')
      .leftJoinAndSelect('profile.account', 'account')
      .leftJoinAndSelect('profile.storeRole', 'storeRole')
      .where('cycle.store_id = :storeId', { storeId });
    // Default to the pending self-registrations the owner's approval screen
    // shows (ShiftAssignment PENDING = registered, waiting for approval).
    const status = this.mapStatus(query.status, STATUS_REGISTRATION);
    qb.andWhere('request.status = :status', {
      status: status ?? ShiftAssignmentStatus.PENDING,
    });
    // The scope target is the registering employee (assignment.employeeId).
    this.applyScope(qb, scope as ApproverScope, storeId, 'request.employee_id');
    return qb;
  }

  async listShiftRegistrations(
    accountId: string | undefined,
    storeId: string,
    query: ListApproverRequestsQueryDto,
  ) {
    const qb = await this.registrationQuery(accountId, storeId, query);
    return this.paginate(qb, query, (row) =>
      shiftRegistrationView(row, this.employeeOf((row as any).employee)),
    );
  }

  // ── A generic store-column list (shift-change / bonus / custom) ───────────

  private async storeColumnQuery<E extends ObjectLiteral>(
    repo: Repository<E>,
    accountId: string | undefined,
    storeId: string,
    type: RequestApproverType,
    query: ListApproverRequestsQueryDto,
    extraJoins: [string, string][] = [],
  ): Promise<{ qb: SelectQueryBuilder<E>; canViewReasons: boolean }> {
    const scope = await this.scope.scopeFilterFor(accountId, storeId, type);
    if (!scope) this.forbidden();
    const qb = repo
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.employeeProfile', 'profile')
      .leftJoinAndSelect('profile.account', 'account')
      .leftJoinAndSelect('profile.storeRole', 'storeRole');
    for (const [rel, alias] of extraJoins) qb.leftJoinAndSelect(rel, alias);
    qb.where('request.store_id = :storeId', { storeId });
    const status = this.mapStatus(query.status, STATUS_GENERIC);
    if (status) qb.andWhere('request.status = :status', { status });
    this.applyScope(qb, scope as ApproverScope, storeId);
    return {
      qb,
      canViewReasons:
        (scope as ApproverScope).isOwner ||
        (scope as Extract<ApproverScope, { isOwner: false }>).canViewReasons,
    };
  }

  async listShiftChangeRequests(
    accountId: string | undefined,
    storeId: string,
    query: ListApproverRequestsQueryDto,
  ) {
    const { qb, canViewReasons } = await this.storeColumnQuery(
      this.shiftChangeRepository,
      accountId,
      storeId,
      RequestApproverType.SHIFT_CHANGE,
      query,
    );
    return this.paginate(qb, query, (row) =>
      shiftChangeRequestView(
        row,
        this.employeeOf((row as any).employeeProfile),
        canViewReasons,
      ),
    );
  }

  async listBonusWorkRequests(
    accountId: string | undefined,
    storeId: string,
    query: ListApproverRequestsQueryDto,
  ) {
    const { qb, canViewReasons } = await this.storeColumnQuery(
      this.bonusWorkRepository,
      accountId,
      storeId,
      RequestApproverType.BONUS_WORK,
      query,
    );
    return this.paginate(qb, query, (row) =>
      bonusWorkRequestView(
        row,
        this.employeeOf((row as any).employeeProfile),
        canViewReasons,
      ),
    );
  }

  async listCustomShiftRequests(
    accountId: string | undefined,
    storeId: string,
    query: ListApproverRequestsQueryDto,
  ) {
    const { qb, canViewReasons } = await this.storeColumnQuery(
      this.customShiftRepository,
      accountId,
      storeId,
      RequestApproverType.CUSTOM_SHIFT,
      query,
    );
    return this.paginate(qb, query, (row) =>
      customShiftRequestView(
        row,
        this.employeeOf((row as any).employeeProfile),
        canViewReasons,
      ),
    );
  }

  // ── KPI / salary advance (store via profile; reduced, money-safe) ─────────

  private async profileStoreQuery<E extends ObjectLiteral>(
    repo: Repository<E>,
    accountId: string | undefined,
    storeId: string,
    type: RequestApproverType,
    query: ListApproverRequestsQueryDto,
    statusMap: StatusMap,
    extraJoins: [string, string][] = [],
  ): Promise<{ qb: SelectQueryBuilder<E>; canViewReasons: boolean }> {
    const scope = await this.scope.scopeFilterFor(accountId, storeId, type);
    if (!scope) this.forbidden();
    const qb = repo
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.employeeProfile', 'profile')
      .leftJoinAndSelect('profile.account', 'account')
      .leftJoinAndSelect('profile.storeRole', 'storeRole');
    for (const [rel, alias] of extraJoins) qb.leftJoinAndSelect(rel, alias);
    qb.where('profile.store_id = :storeId', { storeId });
    const status = this.mapStatus(query.status, statusMap);
    if (status) qb.andWhere('request.status = :status', { status });
    this.applyScope(qb, scope as ApproverScope, storeId);
    return {
      qb,
      canViewReasons:
        (scope as ApproverScope).isOwner ||
        (scope as Extract<ApproverScope, { isOwner: false }>).canViewReasons,
    };
  }

  async listKpiApprovalRequests(
    accountId: string | undefined,
    storeId: string,
    query: ListApproverRequestsQueryDto,
  ) {
    const { qb, canViewReasons } = await this.profileStoreQuery(
      this.kpiRepository,
      accountId,
      storeId,
      RequestApproverType.KPI,
      query,
      STATUS_KPI,
      [['request.employeeKpi', 'kpi']],
    );
    return this.paginate(qb, query, (row) =>
      kpiApprovalRequestView(
        row,
        this.employeeOf((row as any).employeeProfile),
        canViewReasons,
      ),
    );
  }

  async listSalaryAdvanceRequests(
    accountId: string | undefined,
    storeId: string,
    query: ListApproverRequestsQueryDto,
  ) {
    const { qb, canViewReasons } = await this.profileStoreQuery(
      this.salaryAdvanceRepository,
      accountId,
      storeId,
      RequestApproverType.SALARY_ADVANCE,
      query,
      STATUS_SALARY,
    );
    return this.paginate(qb, query, (row) =>
      salaryAdvanceRequestView(
        row,
        this.employeeOf((row as any).employeeProfile),
        canViewReasons,
      ),
    );
  }

  // ── Counts (exact) ────────────────────────────────────────────────────────

  async counts(
    accountId: string | undefined,
    storeId: string,
  ): Promise<Record<string, number>> {
    const me = await this.scope.listApproverTypesForAccount(accountId, storeId);
    const out: Record<string, number> = {};
    if (!me.isApprover) return out;
    const pending = { status: 'PENDING' } as ListApproverRequestsQueryDto;
    const types = new Set(me.types);

    if (types.has(RequestApproverType.SHIFT_REGISTRATION)) {
      out.shift_registration = await (
        await this.registrationQuery(accountId, storeId, pending)
      ).getCount();
    }
    if (
      types.has(RequestApproverType.LEAVE) ||
      types.has(RequestApproverType.LATE) ||
      types.has(RequestApproverType.EARLY)
    ) {
      out.leave = await (
        await this.leaveQuery(accountId, storeId, pending)
      ).qb.getCount();
    }
    if (types.has(RequestApproverType.SHIFT_CHANGE)) {
      out.shift_change = await (
        await this.storeColumnQuery(
          this.shiftChangeRepository,
          accountId,
          storeId,
          RequestApproverType.SHIFT_CHANGE,
          pending,
        )
      ).qb.getCount();
    }
    if (types.has(RequestApproverType.BONUS_WORK)) {
      out.bonus_work = await (
        await this.storeColumnQuery(
          this.bonusWorkRepository,
          accountId,
          storeId,
          RequestApproverType.BONUS_WORK,
          pending,
        )
      ).qb.getCount();
    }
    if (types.has(RequestApproverType.CUSTOM_SHIFT)) {
      out.custom_shift = await (
        await this.storeColumnQuery(
          this.customShiftRepository,
          accountId,
          storeId,
          RequestApproverType.CUSTOM_SHIFT,
          pending,
        )
      ).qb.getCount();
    }
    if (types.has(RequestApproverType.KPI)) {
      out.kpi = await (
        await this.profileStoreQuery(
          this.kpiRepository,
          accountId,
          storeId,
          RequestApproverType.KPI,
          pending,
          STATUS_KPI,
          [['request.employeeKpi', 'kpi']],
        )
      ).qb.getCount();
    }
    if (types.has(RequestApproverType.SALARY_ADVANCE)) {
      out.salary_advance = await (
        await this.profileStoreQuery(
          this.salaryAdvanceRepository,
          accountId,
          storeId,
          RequestApproverType.SALARY_ADVANCE,
          pending,
          STATUS_SALARY,
        )
      ).qb.getCount();
    }
    return out;
  }
}
