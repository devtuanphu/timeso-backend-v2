import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, QueryFailedError, Repository } from 'typeorm';

import {
  EMPLOYED_STATUSES,
  EmployeeProfile,
} from './entities/employee-profile.entity';
import {
  EmployeeSkillProgress,
  SkillProgressStatus,
} from './entities/employee-skill-progress.entity';
import { Store } from './entities/store.entity';
import {
  RequestApproverType,
  StoreRequestApprover,
} from './entities/store-request-approver.entity';
import { AccountIdentityDocument } from '../accounts/entities/account-identity-document.entity';
import { UpsertRequestApproverDto } from './dto/store-request-approver.dto';

export { RequestApproverType };

/** Stable 403 code; never carries the reason to the client (R6). */
export const APPROVER_FORBIDDEN = 'APPROVER_FORBIDDEN';
/** 409 when (store, employee) already has an active delegation. */
export const STORE_APPROVER_DUPLICATE = 'STORE_APPROVER_DUPLICATE';

/**
 * R3 (A3) identity-document normalization. Upper-cases, then keeps ONLY ASCII
 * [A-Z0-9] — every separator (space, NBSP, U+2007/U+202F/U+2009/U+3000, tab,
 * dash, dot, …) is dropped, so "079 201…" and "079\\u00A0201…" collapse to the
 * same key; an empty result is treated as "no document".
 *
 * This is the TS half of a pair with {@link sqlNormalizeDoc}. The old
 * whitespace-class rule diverged between the two under a UTF-8 collation
 * (Postgres `[:space:]` strips Unicode spaces the TS class kept), which could
 * let one surface (decide/fan-out, TS) allow what another (list/counts/
 * identity-conflicts, SQL) blocks. An allowlist of ASCII alphanumerics is
 * collation-independent and identical on both sides. Keep them in lockstep.
 */
export function normalizeDoc(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalized.length ? normalized : null;
}

/**
 * The exact SQL mirror of {@link normalizeDoc} for a `document_number` column:
 * upper-case, then keep only ASCII [A-Z0-9]. Collation-independent, so it
 * matches the TS helper on every input including Unicode spaces.
 */
export function sqlNormalizeDoc(column: string): string {
  return `regexp_replace(upper(COALESCE(${column}, '')), '[^A-Z0-9]', '', 'g')`;
}

export type ApproverScope =
  | { isOwner: true }
  | {
      isOwner: false;
      approverProfileId: string;
      /** The approver's own account id — bound into the R3(b) list SQL. */
      approverAccountId: string;
      /** The approver's normalized identity document numbers (R3(b)). */
      approverDocsNormalized: string[];
      /** R2: may this approver read the employee's free-text reason/note. */
      canViewReasons: boolean;
      departmentIds: string[];
      positionIds: string[];
      skillIds: string[];
    };

/** The facts of the *target* employee a scope is evaluated against. */
export interface EmployeeScopeFacts {
  departmentId: string | null;
  storeRoleId: string | null;
  achievedSkillIds: string[];
}

export type CanApproveReason =
  | 'NO_ACCOUNT'
  | 'NOT_MEMBER'
  | 'NOT_APPROVER'
  | 'WRONG_TYPE'
  | 'SELF'
  | 'TARGET_APPROVER'
  | 'SHARED_IDENTITY'
  | 'OUT_OF_SCOPE'
  | 'TARGET_MISSING';

export interface CanApproveResult {
  allowed: boolean;
  asOwner: boolean;
  /**
   * R2: whether the decider may see the employee's free-text reason. True for
   * the owner (they see everything); the approver row's flag otherwise. Only
   * meaningful when `allowed` — a denial carries no reason flag.
   */
  canViewReasons: boolean;
  reason?: CanApproveReason;
}

/**
 * Pure scope matcher. A dimension is satisfied when it is empty ("tất cả") or
 * the target's value is listed; dimensions are ANDed, values ORed within a
 * dimension (D3). Exported and side-effect free so the whole truth table is
 * unit-tested without a database.
 */
export function employeeMatchesScope(
  scope: {
    departmentIds: string[];
    positionIds: string[];
    skillIds: string[];
  },
  target: EmployeeScopeFacts,
): boolean {
  const departmentOk =
    scope.departmentIds.length === 0 ||
    (!!target.departmentId && scope.departmentIds.includes(target.departmentId));
  const positionOk =
    scope.positionIds.length === 0 ||
    (!!target.storeRoleId && scope.positionIds.includes(target.storeRoleId));
  const skillOk =
    scope.skillIds.length === 0 ||
    target.achievedSkillIds.some((id) => scope.skillIds.includes(id));
  return departmentOk && positionOk && skillOk;
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof QueryFailedError &&
  (error as QueryFailedError & { code?: string }).code === '23505';

/**
 * The single authority for "may this account decide this request" once an owner
 * delegates it. The owner is always allowed (byte-identical to the old
 * `assertOwnerStoreAccess` path); a scoped approver is allowed only for a type
 * they hold and a target inside their department/position/skill scope, and
 * never for their own request (D4). Also owns the approver CRUD, the `/me`
 * gate and the notification fan-out.
 */
@Injectable()
export class ApproverScopeService {
  private readonly logger = new Logger(ApproverScopeService.name);

  constructor(
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    @InjectRepository(EmployeeProfile)
    private readonly profileRepository: Repository<EmployeeProfile>,
    @InjectRepository(StoreRequestApprover)
    private readonly approverRepository: Repository<StoreRequestApprover>,
    @InjectRepository(EmployeeSkillProgress)
    private readonly skillProgressRepository: Repository<EmployeeSkillProgress>,
    @InjectRepository(AccountIdentityDocument)
    private readonly identityDocRepository: Repository<AccountIdentityDocument>,
  ) {}

  /**
   * The normalized identity document numbers of an account (R3/A3). An account
   * may hold several documents, so this is a SET — the conflict rule is a
   * non-empty intersection of two accounts' sets. Normalization (whitespace +
   * NBSP removal, upper-case) matches {@link sqlNormalizeDoc} exactly.
   */
  private async normalizedDocsForAccount(
    accountId: string | null | undefined,
  ): Promise<Set<string>> {
    const out = new Set<string>();
    if (!accountId) return out;
    const rows = await this.identityDocRepository
      .find({ where: { accountId }, select: ['documentNumber'] })
      .catch(() => [] as AccountIdentityDocument[]);
    for (const row of rows) {
      const normalized = normalizeDoc(row.documentNumber);
      if (normalized) out.add(normalized);
    }
    return out;
  }

  /**
   * R3(b) (A3): two accounts "share identity" when their sets of normalized
   * document numbers intersect. Same account is never a share here — SELF is
   * handled separately. Best-effort anti-collusion (a user can edit their own
   * CCCD via POST /accounts/identity), NOT a hard guarantee.
   */
  private async accountsShareIdentity(
    accountA: string | null | undefined,
    accountB: string | null | undefined,
  ): Promise<boolean> {
    if (!accountA || !accountB || accountA === accountB) return false;
    const [docsA, docsB] = await Promise.all([
      this.normalizedDocsForAccount(accountA),
      this.normalizedDocsForAccount(accountB),
    ]);
    for (const doc of docsA) if (docsB.has(doc)) return true;
    return false;
  }

  /** R3(a): is `profileId` an active, non-deleted approver row of the store. */
  private async isActiveApprover(
    storeId: string,
    profileId: string,
  ): Promise<boolean> {
    const row = await this.approverRepository
      .findOne({
        where: {
          storeId,
          employeeProfileId: profileId,
          isActive: true,
          deletedAt: IsNull(),
        },
        select: ['id'],
      })
      .catch(() => null);
    return !!row;
  }

  // ── Authorization ──────────────────────────────────────────────────────

  private async isOwner(storeId: string, accountId: string): Promise<boolean> {
    const store = await this.storeRepository
      .findOne({ where: { id: storeId }, select: ['id', 'ownerAccountId'] })
      .catch(() => null);
    return !!store && store.ownerAccountId === accountId;
  }

  /** The caller's own employed profile at the store, or null. */
  private async memberProfile(
    storeId: string,
    accountId: string,
  ): Promise<Pick<EmployeeProfile, 'id' | 'accountId'> | null> {
    return this.profileRepository
      .findOne({
        where: {
          accountId,
          storeId,
          employmentStatus: In([...EMPLOYED_STATUSES]),
        },
        select: ['id', 'accountId'],
      })
      .catch(() => null);
  }

  /** The caller's active, non-deleted approver row at the store, or null. */
  private async approverRow(
    storeId: string,
    employeeProfileId: string,
  ): Promise<StoreRequestApprover | null> {
    return this.approverRepository
      .findOne({
        where: {
          storeId,
          employeeProfileId,
          isActive: true,
          deletedAt: IsNull(),
        },
      })
      .catch(() => null);
  }

  async canApprove(
    accountId: string | undefined,
    storeId: string,
    type: RequestApproverType,
    targetProfileId: string | null | undefined,
  ): Promise<CanApproveResult> {
    if (!accountId)
      return { allowed: false, asOwner: false, canViewReasons: false, reason: 'NO_ACCOUNT' };
    if (await this.isOwner(storeId, accountId)) {
      return { allowed: true, asOwner: true, canViewReasons: true };
    }
    const actor = await this.memberProfile(storeId, accountId);
    if (!actor)
      return { allowed: false, asOwner: false, canViewReasons: false, reason: 'NOT_MEMBER' };

    const row = await this.approverRow(storeId, actor.id);
    if (!row)
      return { allowed: false, asOwner: false, canViewReasons: false, reason: 'NOT_APPROVER' };
    if (!row.requestTypes.includes(type)) {
      return { allowed: false, asOwner: false, canViewReasons: false, reason: 'WRONG_TYPE' };
    }

    const target = targetProfileId
      ? await this.profileRepository
          .findOne({
            where: { id: targetProfileId },
            select: ['id', 'accountId'],
            withDeleted: true,
          })
          .catch(() => null)
      : null;
    if (!target)
      return { allowed: false, asOwner: false, canViewReasons: false, reason: 'TARGET_MISSING' };
    // Approving one's own request is never allowed, even in scope (D4).
    if (target.accountId === accountId) {
      return { allowed: false, asOwner: false, canViewReasons: false, reason: 'SELF' };
    }
    // R3(a): the target is themselves an active approver of this store → the
    // request is owner-only, hidden from every scoped approver.
    if (await this.isActiveApprover(storeId, targetProfileId as string)) {
      return {
        allowed: false,
        asOwner: false,
        canViewReasons: false,
        reason: 'TARGET_APPROVER',
      };
    }
    // R3(b): the approver and the target share a normalized identity document
    // (best-effort anti-collusion; a user can edit their own CCCD).
    if (await this.accountsShareIdentity(accountId, target.accountId)) {
      return {
        allowed: false,
        asOwner: false,
        canViewReasons: false,
        reason: 'SHARED_IDENTITY',
      };
    }

    const facts = (await this.loadTargetFacts([targetProfileId as string])).get(
      targetProfileId as string,
    );
    if (!facts)
      return { allowed: false, asOwner: false, canViewReasons: false, reason: 'TARGET_MISSING' };
    if (!employeeMatchesScope(row, facts)) {
      return { allowed: false, asOwner: false, canViewReasons: false, reason: 'OUT_OF_SCOPE' };
    }
    return { allowed: true, asOwner: false, canViewReasons: !!row.canViewReasons };
  }

  /**
   * Throws a uniform 403 {code: APPROVER_FORBIDDEN} when denied; otherwise
   * returns whether the caller passed as the owner. The reason is logged with
   * only {type, storeId} — never the account or any personal data (R6).
   */
  async assertCanApprove(
    accountId: string | undefined,
    storeId: string,
    type: RequestApproverType,
    targetProfileId: string | null | undefined,
  ): Promise<{ asOwner: boolean; canViewReasons: boolean }> {
    const result = await this.canApprove(accountId, storeId, type, targetProfileId);
    if (!result.allowed) {
      this.logger.warn(
        `[assertCanApprove] denied (${result.reason}) type=${type} store=${storeId}`,
      );
      throw new ForbiddenException({
        code: APPROVER_FORBIDDEN,
        message: 'Bạn không có quyền duyệt yêu cầu này',
      });
    }
    return { asOwner: result.asOwner, canViewReasons: result.canViewReasons };
  }

  /**
   * Fresh re-read used inside the conditional-update lock (R3): an approver
   * removed or narrowed between the pre-check and the write is rejected.
   */
  async stillScopedApprover(
    accountId: string | undefined,
    storeId: string,
    type: RequestApproverType,
    targetProfileId: string | null | undefined,
  ): Promise<boolean> {
    const result = await this.canApprove(accountId, storeId, type, targetProfileId);
    return result.allowed;
  }

  /**
   * Reject a job application: owner, or an employed member holding the
   * `job_application` type whose department/position scope matches the applied
   * snapshot (R1). An application with a null `appliedPositionId` is owner-only
   * (a store with no positions still receives applicants). Skill is ignored for
   * job applications (an applicant has no achieved skills yet). The applicant
   * can never reject their own application. R3 anti-collusion does NOT apply:
   * an applicant is neither an employee nor an approver of the store.
   * `application` is passed in already bound to the store by `loadPending`;
   * this method never re-fetches it (A4).
   */
  async assertCanRejectApplication(
    accountId: string | undefined,
    storeId: string,
    application: {
      accountId: string | null;
      appliedPositionId: string | null;
      appliedDepartmentId: string | null;
    },
  ): Promise<void> {
    const deny = () => {
      throw new ForbiddenException({
        code: APPROVER_FORBIDDEN,
        message: 'Bạn không có quyền từ chối đơn ứng tuyển này',
      });
    };
    if (!accountId) deny();
    if (await this.isOwner(storeId, accountId as string)) return;
    const actor = await this.memberProfile(storeId, accountId as string);
    if (!actor) deny();
    const row = await this.approverRow(storeId, (actor as EmployeeProfile).id);
    if (!row || !row.requestTypes.includes(RequestApproverType.JOB_APPLICATION)) {
      deny();
      return;
    }
    // R1: a null-position application is owner-only; a scoped approver cannot
    // reject it even when "tất cả".
    if (!application.appliedPositionId) {
      this.logger.warn(
        `[assertCanRejectApplication] denied (NULL_POSITION) store=${storeId}`,
      );
      deny();
    }
    const departmentOk =
      row.departmentIds.length === 0 ||
      (!!application.appliedDepartmentId &&
        row.departmentIds.includes(application.appliedDepartmentId));
    const positionOk =
      row.positionIds.length === 0 ||
      (!!application.appliedPositionId &&
        row.positionIds.includes(application.appliedPositionId));
    if (!departmentOk || !positionOk) {
      this.logger.warn(
        `[assertCanRejectApplication] denied (OUT_OF_SCOPE) store=${storeId}`,
      );
      deny();
    }
    if (application.accountId && application.accountId === accountId) {
      this.logger.warn(
        `[assertCanRejectApplication] denied (SELF) store=${storeId}`,
      );
      deny();
    }
  }

  // ── Scope resolution for list reads ──────────────────────────────────────

  /**
   * Null when the caller may not read this type's requests at all. Owner gets
   * the unscoped view; an approver gets their single scope.
   */
  async scopeFilterFor(
    accountId: string | undefined,
    storeId: string,
    type: RequestApproverType,
  ): Promise<ApproverScope | null> {
    if (!accountId) return null;
    if (await this.isOwner(storeId, accountId)) return { isOwner: true };
    const actor = await this.memberProfile(storeId, accountId);
    if (!actor) return null;
    const row = await this.approverRow(storeId, actor.id);
    if (!row || !row.requestTypes.includes(type)) return null;
    // R3(b): resolve the approver's own normalized documents so the list SQL can
    // exclude any target sharing one (list↔decide parity).
    const approverDocsNormalized = [
      ...(await this.normalizedDocsForAccount(accountId)),
    ];
    return {
      isOwner: false,
      approverProfileId: actor.id,
      approverAccountId: accountId,
      approverDocsNormalized,
      canViewReasons: !!row.canViewReasons,
      departmentIds: row.departmentIds ?? [],
      positionIds: row.positionIds ?? [],
      skillIds: row.skillIds ?? [],
    };
  }

  /**
   * Target employee facts for a batch of profile ids: department, position
   * (store role), and achieved skills. `achievedSkillIds` is the union of the
   * career-v2 `achieved` rows and the legacy single `skill_id` (D3 fallback).
   */
  async loadTargetFacts(
    profileIds: string[],
  ): Promise<Map<string, EmployeeScopeFacts>> {
    const ids = [...new Set(profileIds.filter(Boolean))];
    const out = new Map<string, EmployeeScopeFacts>();
    if (!ids.length) return out;

    const profiles = await this.profileRepository.find({
      where: { id: In(ids) },
      select: ['id', 'departmentId', 'storeRoleId', 'skillId'],
      withDeleted: true,
    });
    const achieved = await this.skillProgressRepository.find({
      where: {
        employeeProfileId: In(ids),
        status: SkillProgressStatus.ACHIEVED,
        deletedAt: IsNull(),
      },
      select: ['employeeProfileId', 'skillId'],
    });
    const achievedByProfile = new Map<string, Set<string>>();
    for (const row of achieved) {
      const set = achievedByProfile.get(row.employeeProfileId) ?? new Set<string>();
      if (row.skillId) set.add(row.skillId);
      achievedByProfile.set(row.employeeProfileId, set);
    }
    for (const profile of profiles) {
      const set = achievedByProfile.get(profile.id) ?? new Set<string>();
      if (profile.skillId) set.add(profile.skillId);
      out.set(profile.id, {
        departmentId: profile.departmentId ?? null,
        storeRoleId: profile.storeRoleId ?? null,
        achievedSkillIds: [...set],
      });
    }
    return out;
  }

  // ── Notification fan-out ─────────────────────────────────────────────────

  /**
   * Account ids of the scoped approvers to notify of a new `type` request about
   * `targetProfileId`. Only rows that are active, not soft-deleted, whose
   * approver is still employed (A1), and whose scope matches the target, minus
   * the excluded accounts (the submitter and the owner).
   */
  async matchingApprovers(
    storeId: string,
    type: RequestApproverType,
    targetProfileId: string | null | undefined,
    exclude: string[] = [],
  ): Promise<Array<{ accountId: string; canViewReasons: boolean }>> {
    if (!targetProfileId) return [];
    // R3(a): a request whose target is itself an active approver is owner-only —
    // no scoped approver is notified.
    if (await this.isActiveApprover(storeId, targetProfileId)) return [];
    const facts = (await this.loadTargetFacts([targetProfileId])).get(
      targetProfileId,
    );
    if (!facts) return [];

    const rows = await this.approverRepository.find({
      where: { storeId, isActive: true, deletedAt: IsNull() },
    });
    const candidates = rows.filter((row) => row.requestTypes.includes(type));
    if (!candidates.length) return [];

    // A1: only approvers whose own profile is still EMPLOYED (a fired approver
    // whose row was not deleted must not be notified).
    const employed = await this.profileRepository.find({
      where: {
        id: In(candidates.map((row) => row.employeeProfileId)),
        storeId,
        employmentStatus: In([...EMPLOYED_STATUSES]),
      },
      select: ['id', 'accountId'],
    });
    const accountByProfile = new Map(employed.map((p) => [p.id, p.accountId]));

    // R3(b): drop any approver who shares a normalized identity document with
    // the target account (resolved once for the target, then per candidate).
    const targetAccount = await this.profileRepository
      .findOne({
        where: { id: targetProfileId },
        select: ['id', 'accountId'],
        withDeleted: true,
      })
      .catch(() => null);
    const targetDocs = await this.normalizedDocsForAccount(
      targetAccount?.accountId,
    );

    const excluded = new Set(exclude.filter(Boolean));
    const seen = new Set<string>();
    const out: Array<{ accountId: string; canViewReasons: boolean }> = [];
    for (const row of candidates) {
      const accountId = accountByProfile.get(row.employeeProfileId);
      if (!accountId || excluded.has(accountId) || seen.has(accountId)) continue;
      if (!employeeMatchesScope(row, facts)) continue;
      if (targetDocs.size) {
        const docs = await this.normalizedDocsForAccount(accountId);
        let shares = false;
        for (const doc of docs)
          if (targetDocs.has(doc)) {
            shares = true;
            break;
          }
        if (shares) continue;
      }
      seen.add(accountId);
      out.push({ accountId, canViewReasons: !!row.canViewReasons });
    }
    return out;
  }

  /** Account ids only — R2 reason flag dropped. Kept for callers that only
   * need the recipient list (the per-approver reason flag is read via
   * {@link matchingApprovers}). */
  async matchingApproverAccountIds(
    storeId: string,
    type: RequestApproverType,
    targetProfileId: string | null | undefined,
    exclude: string[] = [],
  ): Promise<string[]> {
    return (
      await this.matchingApprovers(storeId, type, targetProfileId, exclude)
    ).map((entry) => entry.accountId);
  }

  // ── /me gate ─────────────────────────────────────────────────────────────

  async listApproverTypesForAccount(
    accountId: string | undefined,
    storeId: string,
  ): Promise<{
    isApprover: boolean;
    types: RequestApproverType[];
    canViewReasons: boolean;
  }> {
    if (!accountId) return { isApprover: false, types: [], canViewReasons: false };
    const actor = await this.memberProfile(storeId, accountId);
    if (!actor) return { isApprover: false, types: [], canViewReasons: false };
    const row = await this.approverRow(storeId, actor.id);
    if (!row || !row.requestTypes.length)
      return { isApprover: false, types: [], canViewReasons: false };
    return {
      isApprover: true,
      types: row.requestTypes.filter((t): t is RequestApproverType =>
        (Object.values(RequestApproverType) as string[]).includes(t),
      ),
      canViewReasons: !!row.canViewReasons,
    };
  }

  /**
   * R3c owner-only CCCD-collision check for a candidate approver. Returns the
   * EMPLOYED coworkers whose account shares a normalized identity document with
   * the selected employee — names/roles only, NEVER a document number.
   * `approverHasIdentity` lets the owner app warn when the selected employee has
   * no document to compare against. 404 when the employee is not employed here.
   */
  async identityConflictsForEmployee(
    storeId: string,
    employeeProfileId: string,
  ): Promise<{
    hasConflict: boolean;
    conflicts: Array<{
      employeeProfileId: string;
      fullName: string | null;
      role: string | null;
    }>;
    approverHasIdentity: boolean;
  }> {
    const target = await this.profileRepository
      .findOne({
        where: {
          id: employeeProfileId,
          storeId,
          employmentStatus: In([...EMPLOYED_STATUSES]),
        },
        select: ['id', 'accountId'],
      })
      .catch(() => null);
    if (!target) {
      throw new NotFoundException({
        code: 'APPROVER_EMPLOYEE_INVALID',
        message: 'Nhân viên không thuộc cửa hàng này hoặc đã nghỉ',
      });
    }
    const targetDocs = await this.normalizedDocsForAccount(target.accountId);
    const approverHasIdentity = targetDocs.size > 0;
    if (!approverHasIdentity) {
      return { hasConflict: false, conflicts: [], approverHasIdentity: false };
    }
    const rows: Array<{
      id: string;
      fullName: string | null;
      role: string | null;
    }> = await this.profileRepository
      .createQueryBuilder('p')
      .innerJoin(
        AccountIdentityDocument,
        'd',
        'd.account_id = p.account_id',
      )
      .leftJoin('p.account', 'acc')
      .leftJoin('p.storeRole', 'role')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.id != :targetId', { targetId: employeeProfileId })
      .andWhere('p.deleted_at IS NULL')
      .andWhere('p.employment_status IN (:...employed)', {
        employed: [...EMPLOYED_STATUSES],
      })
      .andWhere(
        `${sqlNormalizeDoc('d.document_number')} IN (:...targetDocs)`,
        { targetDocs: [...targetDocs] },
      )
      .select('p.id', 'id')
      .addSelect('acc.full_name', 'fullName')
      .addSelect('role.name', 'role')
      .distinct(true)
      .getRawMany();
    return {
      hasConflict: rows.length > 0,
      conflicts: rows.map((row) => ({
        employeeProfileId: row.id,
        fullName: row.fullName ?? null,
        role: row.role ?? null,
      })),
      approverHasIdentity: true,
    };
  }

  // ── Owner CRUD ───────────────────────────────────────────────────────────

  /** Reconstructs the three dimensions with their `allX` flags (empty ⇒ all). */
  private toApproverView(row: StoreRequestApprover & { employeeProfile?: any }) {
    const profile = row.employeeProfile;
    return {
      id: row.id,
      storeId: row.storeId,
      employeeProfileId: row.employeeProfileId,
      employee: profile
        ? {
            id: profile.id,
            fullName: profile.account?.fullName ?? null,
            avatar: profile.account?.avatar ?? null,
            role: profile.storeRole?.name ?? null,
            departmentId: profile.departmentId ?? null,
            storeRoleId: profile.storeRoleId ?? null,
          }
        : null,
      requestTypes: row.requestTypes ?? [],
      allDepartments: (row.departmentIds ?? []).length === 0,
      departmentIds: row.departmentIds ?? [],
      allPositions: (row.positionIds ?? []).length === 0,
      positionIds: row.positionIds ?? [],
      allSkills: (row.skillIds ?? []).length === 0,
      skillIds: row.skillIds ?? [],
      isActive: row.isActive,
      canViewReasons: !!row.canViewReasons,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async listApprovers(storeId: string) {
    const rows = await this.approverRepository.find({
      where: { storeId, deletedAt: IsNull() },
      relations: [
        'employeeProfile',
        'employeeProfile.account',
        'employeeProfile.storeRole',
      ],
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => this.toApproverView(row));
  }

  /** `allX XOR ids`: tất cả (flag true, ids empty) or an explicit list (R4). */
  private resolveDimension(
    name: string,
    all: boolean,
    ids: string[] | undefined,
  ): string[] {
    const list = [...new Set((ids ?? []).filter(Boolean))];
    if (all && list.length > 0) {
      throw new BadRequestException({
        code: 'APPROVER_SCOPE_INVALID',
        message: `Chọn "Tất cả" thì không được kèm danh sách ${name}`,
      });
    }
    if (!all && list.length === 0) {
      throw new BadRequestException({
        code: 'APPROVER_SCOPE_INVALID',
        message: `Phải chọn "Tất cả" hoặc ít nhất một ${name}`,
      });
    }
    return all ? [] : list;
  }

  private normalizeUpsert(dto: UpsertRequestApproverDto) {
    const requestTypes = [...new Set(dto.requestTypes ?? [])];
    if (!requestTypes.length) {
      throw new BadRequestException({
        code: 'APPROVER_SCOPE_INVALID',
        message: 'Phải chọn ít nhất một loại yêu cầu',
      });
    }
    return {
      requestTypes,
      departmentIds: this.resolveDimension(
        'bộ phận',
        dto.allDepartments,
        dto.departmentIds,
      ),
      positionIds: this.resolveDimension(
        'vị trí',
        dto.allPositions,
        dto.positionIds,
      ),
      skillIds: this.resolveDimension('kỹ năng', dto.allSkills, dto.skillIds),
      isActive: dto.isActive ?? true,
      // R2/A2: default FALSE (reasons hidden) when the owner omits it.
      canViewReasons: dto.canViewReasons ?? false,
    };
  }

  private async assertEmployeeOfStore(storeId: string, employeeProfileId: string) {
    const profile = await this.profileRepository.findOne({
      where: {
        id: employeeProfileId,
        storeId,
        employmentStatus: In([...EMPLOYED_STATUSES]),
      },
      select: ['id'],
    });
    if (!profile) {
      throw new BadRequestException({
        code: 'APPROVER_EMPLOYEE_INVALID',
        message: 'Nhân viên không thuộc cửa hàng này hoặc đã nghỉ',
      });
    }
  }

  async createApprover(storeId: string, dto: UpsertRequestApproverDto) {
    const data = this.normalizeUpsert(dto);
    await this.assertEmployeeOfStore(storeId, dto.employeeProfileId);
    try {
      const saved = await this.approverRepository.save(
        this.approverRepository.create({
          storeId,
          employeeProfileId: dto.employeeProfileId,
          ...data,
        }),
      );
      return this.getApprover(storeId, saved.id);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: STORE_APPROVER_DUPLICATE,
          message: 'Nhân viên này đã là người phê duyệt',
        });
      }
      throw error;
    }
  }

  private async getApprover(storeId: string, approverId: string) {
    const row = await this.approverRepository.findOne({
      where: { id: approverId, storeId, deletedAt: IsNull() },
      relations: [
        'employeeProfile',
        'employeeProfile.account',
        'employeeProfile.storeRole',
      ],
    });
    if (!row) throw new NotFoundException('Không tìm thấy người phê duyệt');
    return this.toApproverView(row);
  }

  async updateApprover(
    storeId: string,
    approverId: string,
    dto: UpsertRequestApproverDto,
  ) {
    const row = await this.approverRepository.findOne({
      where: { id: approverId, storeId, deletedAt: IsNull() },
    });
    if (!row) throw new NotFoundException('Không tìm thấy người phê duyệt');
    const data = this.normalizeUpsert(dto);
    // The employee may be reassigned; validate the (possibly new) target.
    if (dto.employeeProfileId && dto.employeeProfileId !== row.employeeProfileId) {
      await this.assertEmployeeOfStore(storeId, dto.employeeProfileId);
      row.employeeProfileId = dto.employeeProfileId;
    }
    row.requestTypes = data.requestTypes;
    row.departmentIds = data.departmentIds;
    row.positionIds = data.positionIds;
    row.skillIds = data.skillIds;
    row.isActive = data.isActive;
    // A2: this assigns fields explicitly, so canViewReasons must be persisted
    // here too — otherwise an owner toggling it on an edit would be silently
    // dropped and the flag frozen at its create-time value.
    row.canViewReasons = data.canViewReasons;
    try {
      await this.approverRepository.save(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: STORE_APPROVER_DUPLICATE,
          message: 'Nhân viên này đã là người phê duyệt',
        });
      }
      throw error;
    }
    return this.getApprover(storeId, approverId);
  }

  async deleteApprover(storeId: string, approverId: string) {
    const row = await this.approverRepository.findOne({
      where: { id: approverId, storeId, deletedAt: IsNull() },
      select: ['id'],
    });
    if (!row) throw new NotFoundException('Không tìm thấy người phê duyệt');
    await this.approverRepository.softDelete({ id: approverId, storeId });
    return { id: approverId, deleted: true };
  }
}
