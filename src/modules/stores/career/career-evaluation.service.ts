import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { vnDateString } from '../../../common/utils/vn-calendar';
import { stintFloor, stintStartVnDate } from '../employment-stint.utils';
import { CareerRequirement } from '../entities/career-requirement.entity';
import {
  EMPLOYED_STATUSES,
  EmployeeProfile,
  isEmployedStatus,
} from '../entities/employee-profile.entity';
import {
  EmployeeSkillProgress,
  SkillProgressStatus,
} from '../entities/employee-skill-progress.entity';
import { StoreCareerSetting } from '../entities/store-career-setting.entity';
import { StoreDepartment } from '../entities/store-department.entity';
import { StoreRole } from '../entities/store-role.entity';
import {
  SkillConfirmation,
  SkillLevel,
  StoreSkill,
} from '../entities/store-skill.entity';
import {
  CareerRequirementCode,
  CAREER_LIMITS,
  REQUIREMENT_LABELS,
  REQUIREMENT_UNITS,
} from './career.constants';
import {
  CompletedWork,
  completedWork,
  hoursOf,
  passEvaluationsSince,
} from './career-metrics';
import { lastEndedVnMonth, reviewPeriodStartDate, vnDayStartInstant } from './career-time';

/** Một điều kiện sau khi đo. `target` null với điều kiện đạt / chưa đạt. */
export interface MeasuredRequirement {
  code: CareerRequirementCode;
  label: string;
  unit: string | null;
  target: number | null;
  current: number | null;
  met: boolean;
  /** Mục ngầm D8 ("đạt đủ kỹ năng bắt buộc"), không do chủ khai. */
  implicit?: boolean;
  refSkillId?: string | null;
}

export interface Evaluation {
  passed: boolean;
  /** 0–100 theo số điều kiện đã đạt. */
  progress: number;
  items: MeasuredRequirement[];
}

export type SkillStateStatus = 'locked' | 'in_progress' | 'awaiting_confirmation' | 'achieved';

export interface SkillState {
  skillId: string;
  name: string;
  description: string | null;
  sequence: number | null;
  level: SkillLevel;
  confirmation: SkillConfirmation;
  status: SkillStateStatus;
  unlockedAt: Date | null;
  achievedAt: Date | null;
  passCount: number;
  evaluation: Evaluation | null;
}

export interface PromotionTarget {
  kind: 'position' | 'department';
  /** Vị trí đích (kind = position) hoặc bộ phận đích (kind = department). */
  id: string;
  name: string;
  rank: number | null;
  departmentId: string;
  departmentName: string;
  /** Đi tới được theo quy tắc kề (D8); không kề thì chỉ đi bằng ngoại lệ. */
  adjacent: boolean;
  passed: boolean;
  progress: number;
  items: MeasuredRequirement[];
}

/** Ảnh cấu trúc của một cửa hàng, nạp một lần cho cả lượt xét. */
export interface CareerGraph {
  storeId: string;
  setting: StoreCareerSetting | null;
  departments: Map<string, StoreDepartment>;
  positions: Map<string, StoreRole>;
  /** Kỹ năng còn dùng (chưa xoá, isActive). */
  skills: Map<string, StoreSkill>;
  requirements: CareerRequirement[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const evaluationOf = (items: MeasuredRequirement[], adjacent = true): Evaluation => {
  const met = items.filter((i) => i.met).length;
  return {
    passed: adjacent && met === items.length,
    progress: items.length === 0 ? 100 : Math.round((met / items.length) * 100),
    items,
  };
};

const later = (...dates: Array<Date | null | undefined>): Date | null => {
  let best: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    const t = new Date(d);
    if (!best || t.getTime() > best.getTime()) best = t;
  }
  return best;
};

/**
 * Bộ nhớ đệm cho một lượt xét một hồ sơ: các phép đo lặp lại (ca trong một
 * khoảng ngày, mốc vào vị trí) chỉ hỏi cơ sở dữ liệu một lần.
 */
class ProfileContext {
  private work = new Map<string, Promise<CompletedWork>>();
  private enteredPosition?: Promise<Date | null>;
  private enteredDepartment?: Promise<Date | null>;
  private progress?: Promise<EmployeeSkillProgress[]>;
  private passes = new Map<string, Promise<number>>();

  constructor(
    readonly manager: EntityManager,
    readonly profile: EmployeeProfile,
  ) {}

  get floor() {
    return stintFloor(this.profile.joinedAt);
  }

  completed(fromVnDate: string | null, toVnDateExclusive: string | null = null) {
    const key = `${fromVnDate}|${toVnDateExclusive}`;
    if (!this.work.has(key)) {
      this.work.set(
        key,
        completedWork(this.manager, this.profile.id, { fromVnDate, toVnDateExclusive }),
      );
    }
    return this.work.get(key) as Promise<CompletedWork>;
  }

  /** Sự kiện v2 gần nhất (trong đợt làm hiện tại) vào đúng đích hiện tại. */
  private async latestEvent(subject: 'position' | 'department', targetId: string | null) {
    if (!targetId) return null;
    const rows: Array<{ effective_at: Date }> = await this.manager.query(
      `SELECT effective_at FROM employee_career_events
        WHERE employee_profile_id = $1 AND subject_type = $2 AND to_target_id = $3
          AND deleted_at IS NULL
          AND ($4::timestamp IS NULL OR effective_at >= $4::timestamp)
        ORDER BY effective_at DESC LIMIT 1`,
      [this.profile.id, subject, targetId, this.floor],
    );
    return rows[0]?.effective_at ? new Date(rows[0].effective_at) : null;
  }

  /** Vào bộ phận hiện tại từ lúc nào: sự kiện bộ phận → đầu đợt làm → tạo hồ sơ. */
  departmentEnteredAt() {
    this.enteredDepartment ??= this.latestEvent('department', this.profile.departmentId).then(
      (at) => at ?? this.profile.joinedAt ?? this.profile.createdAt ?? null,
    );
    return this.enteredDepartment;
  }

  /** Vào vị trí hiện tại từ lúc nào; chưa có vị trí thì tính từ lúc vào bộ phận. */
  positionEnteredAt() {
    this.enteredPosition ??= (async () => {
      const at = await this.latestEvent('position', this.profile.storeRoleId);
      return at ?? (await this.departmentEnteredAt());
    })();
    return this.enteredPosition;
  }

  /**
   * Ngày VN bắt đầu cộng dồn của điều kiện vị trí: ngày vào vị trí, không sớm
   * hơn ngày bắt đầu đợt làm (cùng quy ước cumulativeSinceVnDate của lộ trình
   * cũ: ca sớm hơn trong chính ngày vào vẫn được tính).
   */
  async positionWindowStart(): Promise<string | null> {
    const entered = await this.positionEnteredAt();
    const entryDate = entered ? vnDateString(new Date(entered)) : null;
    const stintDate = stintStartVnDate(this.profile.joinedAt);
    if (entryDate && stintDate) return entryDate > stintDate ? entryDate : stintDate;
    return entryDate ?? stintDate;
  }

  /** Số lần đánh giá Đạt một kỹ năng từ một mốc (nhớ trong lượt xét). */
  passCount(skillId: string, since: Date | null) {
    const key = `${skillId}|${since ? new Date(since).getTime() : ''}`;
    if (!this.passes.has(key)) {
      this.passes.set(key, passEvaluationsSince(this.manager, this.profile.id, skillId, since));
    }
    return this.passes.get(key) as Promise<number>;
  }

  /** Dòng tiến độ kỹ năng của đợt làm hiện tại. */
  progressRows() {
    this.progress ??= this.manager
      .getRepository(EmployeeSkillProgress)
      .createQueryBuilder('g')
      .where('g.employeeProfileId = :id', { id: this.profile.id })
      .andWhere(this.floor ? 'g.createdAt >= :floor' : '1=1', { floor: this.floor })
      .getMany();
    return this.progress;
  }
}

/**
 * Xét điều kiện của lộ trình v2 — chỉ đọc.
 *
 * Quy tắc (plan …-v2-impl.md §1):
 * - điều kiện là điều kiện để VÀO đích; "ca/tháng", "giờ/tháng" của bộ phận đo
 *   trên tháng VN gần nhất đã kết thúc (D4); giờ / ca của vị trí cộng dồn từ
 *   lúc nhận vị trí hiện tại;
 * - kỹ năng S mở khoá khi mọi kỹ năng BẮT BUỘC đứng trước trong bộ phận đã
 *   đạt; mốc mở khoá = muộn nhất của (vào bộ phận, tạo kỹ năng, đạt kỹ năng bắt
 *   buộc liền trước) — tính từ dữ liệu, không cần ghi;
 * - lên vị trí P (D8): phải "kề" (cùng bộ phận: rank kế tiếp; khác bộ phận: bộ
 *   phận của P là tổ tiên, đang ở rank cao nhất, P là rank 1) và đạt điều kiện
 *   của P (+ của bộ phận đích khi đổi bộ phận) + mọi kỹ năng bắt buộc của bộ
 *   phận hiện tại.
 */
@Injectable()
export class CareerEvaluationService {
  constructor(private readonly dataSource: DataSource) {}

  async loadGraph(manager: EntityManager, storeId: string): Promise<CareerGraph> {
    const [setting, departments, positions, skills, requirements] = await Promise.all([
      manager.findOne(StoreCareerSetting, { where: { storeId } }),
      manager.find(StoreDepartment, { where: { storeId } }),
      // Vị trí đã tắt (isActive = false) không còn là một bậc trên lộ trình.
      manager.find(StoreRole, { where: { storeId, isActive: true } }),
      manager.find(StoreSkill, { where: { storeId, isActive: true } }),
      manager.find(CareerRequirement, {
        where: { storeId },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      }),
    ]);
    return {
      storeId,
      setting,
      departments: new Map(departments.map((d) => [d.id, d])),
      positions: new Map(positions.map((p) => [p.id, p])),
      skills: new Map(skills.map((s) => [s.id, s])),
      // Điều kiện thăng tiến chỉ thuộc VỊ TRÍ (và điều kiện đạt của kỹ năng).
      // Điều kiện cũ gắn với bộ phận (ca / giờ mỗi tháng) không còn được xét:
      // nó chỉ áp lúc chuyển VÀO bộ phận nên nhân viên trong bộ phận không
      // thấy, chủ đặt xong tưởng app NV "lúc hiện lúc không". Dữ liệu cũ giữ
      // nguyên trong DB, chỉ bỏ qua ở đây.
      requirements: requirements.filter((r) => !r.departmentId),
    };
  }

  context(manager: EntityManager, profile: EmployeeProfile) {
    return new ProfileContext(manager, profile);
  }

  // -------------------------------------------------------------------------
  // Cấu trúc
  // -------------------------------------------------------------------------

  /** Vị trí còn dùng của một bộ phận, thấp → cao. */
  positionsOf(graph: CareerGraph, departmentId: string | null) {
    if (!departmentId) return [];
    return [...graph.positions.values()]
      .filter((p) => p.departmentId === departmentId && p.rank !== null)
      .sort((a, b) => (a.rank as number) - (b.rank as number));
  }

  /** Kỹ năng còn dùng của một bộ phận, theo thứ tự. */
  skillsOf(graph: CareerGraph, departmentId: string | null) {
    if (!departmentId) return [];
    return [...graph.skills.values()]
      .filter((s) => s.departmentId === departmentId && s.sequence !== null)
      .sort((a, b) => (a.sequence as number) - (b.sequence as number));
  }

  /** `ancestorId` là tổ tiên (không tính chính nó) của `departmentId`. */
  isAncestor(graph: CareerGraph, ancestorId: string, departmentId: string | null) {
    let cursor = departmentId ? graph.departments.get(departmentId) : undefined;
    for (let guard = 0; cursor && guard < 10; guard += 1) {
      if (!cursor.parentId) return false;
      if (cursor.parentId === ancestorId) return true;
      cursor = graph.departments.get(cursor.parentId);
    }
    return false;
  }

  private requirementsOf(
    graph: CareerGraph,
    subject: { departmentId?: string; positionId?: string; skillId?: string },
  ) {
    return graph.requirements.filter((r) =>
      subject.departmentId
        ? r.departmentId === subject.departmentId
        : subject.positionId
          ? r.positionId === subject.positionId
          : r.skillId === subject.skillId,
    );
  }

  // -------------------------------------------------------------------------
  // Đo
  // -------------------------------------------------------------------------

  private measured(
    code: CareerRequirementCode,
    target: number | null,
    current: number | null,
    met?: boolean,
    extra: Partial<MeasuredRequirement> = {},
  ): MeasuredRequirement {
    return {
      code,
      label: REQUIREMENT_LABELS[code],
      unit: REQUIREMENT_UNITS[code] ?? null,
      target,
      current,
      met: met ?? (current !== null && target !== null && current >= target),
      ...extra,
    };
  }

  /** Mọi kỹ năng bắt buộc (còn dùng) của một bộ phận đã đạt chưa. */
  private async requiredSkillsMet(ctx: ProfileContext, graph: CareerGraph, departmentId: string | null) {
    const required = this.skillsOf(graph, departmentId).filter(
      (s) => s.level === SkillLevel.REQUIRED,
    );
    const achieved = new Set(
      (await ctx.progressRows())
        .filter((g) => g.status === SkillProgressStatus.ACHIEVED)
        .map((g) => g.skillId),
    );
    return {
      total: required.length,
      met: required.filter((s) => achieved.has(s.id)).length,
    };
  }

  /** Đo điều kiện của bộ phận / vị trí (không phải kỹ năng). */
  private async measureEntry(
    ctx: ProfileContext,
    graph: CareerGraph,
    requirements: CareerRequirement[],
  ): Promise<MeasuredRequirement[]> {
    const items: MeasuredRequirement[] = [];
    const achieved = new Map(
      (await ctx.progressRows())
        .filter((g) => g.status === SkillProgressStatus.ACHIEVED)
        .map((g) => [g.skillId, g]),
    );
    for (const r of requirements) {
      const target = r.value === null ? null : Number(r.value);
      switch (r.code) {
        case CareerRequirementCode.MONTHLY_SHIFTS:
        case CareerRequirementCode.MONTHLY_HOURS: {
          const month = lastEndedVnMonth();
          const work = await ctx.completed(month.fromDate, month.toDateExclusive);
          const current =
            r.code === CareerRequirementCode.MONTHLY_SHIFTS ? work.shifts : hoursOf(work.minutes);
          items.push(this.measured(r.code, target, current));
          break;
        }
        case CareerRequirementCode.WORK_HOURS:
        case CareerRequirementCode.COMPLETED_SHIFTS: {
          const work = await ctx.completed(await ctx.positionWindowStart());
          const current =
            r.code === CareerRequirementCode.COMPLETED_SHIFTS ? work.shifts : hoursOf(work.minutes);
          items.push(this.measured(r.code, target, current));
          break;
        }
        case CareerRequirementCode.SKILL_ACHIEVED: {
          const skill = r.refSkillId ? graph.skills.get(r.refSkillId) : undefined;
          // Kỹ năng đã ngừng dùng / xoá không còn được xét.
          if (!skill) break;
          items.push(
            this.measured(r.code, null, null, achieved.has(skill.id), {
              label: `Đạt kỹ năng "${skill.name}"`,
              refSkillId: skill.id,
            }),
          );
          break;
        }
        case CareerRequirementCode.ALL_REQUIRED_SKILLS: {
          const { total, met } = await this.requiredSkillsMet(ctx, graph, ctx.profile.departmentId);
          items.push(this.measured(r.code, total, met, met >= total));
          break;
        }
        default:
          break;
      }
    }
    return items;
  }

  // -------------------------------------------------------------------------
  // Kỹ năng
  // -------------------------------------------------------------------------

  /** Trạng thái các kỹ năng của bộ phận hiện tại, theo thứ tự. */
  async skillStates(ctx: ProfileContext, graph: CareerGraph): Promise<SkillState[]> {
    const departmentId = ctx.profile.departmentId;
    if (!departmentId) return [];
    const rows = new Map((await ctx.progressRows()).map((g) => [g.skillId, g]));
    const enteredDepartment = await ctx.departmentEnteredAt();

    const states: SkillState[] = [];
    let gateOpen = true;
    let lastRequiredAchievedAt: Date | null = null;
    for (const skill of this.skillsOf(graph, departmentId)) {
      const row = rows.get(skill.id);
      const base = {
        skillId: skill.id,
        name: skill.name,
        description: skill.description ?? null,
        sequence: skill.sequence,
        level: skill.level,
        confirmation: skill.confirmation,
      };

      if (row?.status === SkillProgressStatus.ACHIEVED) {
        states.push({
          ...base,
          status: 'achieved',
          unlockedAt: row.unlockedAt,
          achievedAt: row.achievedAt,
          passCount: 0,
          evaluation: null,
        });
        if (skill.level === SkillLevel.REQUIRED) {
          lastRequiredAchievedAt = later(lastRequiredAchievedAt, row.achievedAt);
        }
        continue;
      }

      if (!gateOpen) {
        states.push({ ...base, status: 'locked', unlockedAt: null, achievedAt: null, passCount: 0, evaluation: null });
        continue;
      }

      const unlockedAt = later(enteredDepartment, skill.createdAt, lastRequiredAchievedAt);
      const evaluation = await this.evaluateSkill(ctx, graph, skill, unlockedAt);
      const passCount = await ctx.passCount(skill.id, unlockedAt);
      states.push({
        ...base,
        status: evaluation.passed ? 'awaiting_confirmation' : 'in_progress',
        unlockedAt,
        achievedAt: null,
        passCount,
        evaluation,
      });
      // Kỹ năng bắt buộc chưa đạt khoá mọi kỹ năng đứng sau; kỹ năng tuỳ chọn thì không.
      if (skill.level === SkillLevel.REQUIRED) gateOpen = false;
    }
    return states;
  }

  /** Điều kiện đạt một kỹ năng, đo từ lúc mở khoá. */
  async evaluateSkill(
    ctx: ProfileContext,
    graph: CareerGraph,
    skill: StoreSkill,
    unlockedAt: Date | null,
  ): Promise<Evaluation> {
    const inDepartment = ctx.profile.departmentId === skill.departmentId;
    const items: MeasuredRequirement[] = [];
    for (const r of this.requirementsOf(graph, { skillId: skill.id })) {
      const target = r.value === null ? null : Number(r.value);
      switch (r.code) {
        case CareerRequirementCode.PRACTICE_HOURS: {
          // Chỉ giờ làm khi đang ở bộ phận của kỹ năng (D5).
          const work = inDepartment
            ? await ctx.completed(unlockedAt ? vnDateString(new Date(unlockedAt)) : null)
            : { shifts: 0, minutes: 0 };
          items.push(this.measured(r.code, target, hoursOf(work.minutes)));
          break;
        }
        case CareerRequirementCode.SUCCESSFUL_REPS: {
          const n = await ctx.passCount(skill.id, unlockedAt);
          items.push(this.measured(r.code, target, n));
          break;
        }
        case CareerRequirementCode.MANAGER_REVIEW: {
          const n = await ctx.passCount(skill.id, unlockedAt);
          items.push(this.measured(r.code, null, null, n > 0));
          break;
        }
        default:
          break;
      }
    }
    return evaluationOf(items);
  }

  // -------------------------------------------------------------------------
  // Lên vị trí / bộ phận
  // -------------------------------------------------------------------------

  /**
   * Quy tắc kề (D8): cùng bộ phận → rank kế tiếp; khác bộ phận → bộ phận đích
   * là tổ tiên, đang ở rank cao nhất của bộ phận hiện tại, đích là rank 1;
   * chưa có vị trí → rank 1 của bộ phận mình (hoặc bất kỳ, nếu chưa có bộ phận).
   */
  positionAdjacent(graph: CareerGraph, profile: EmployeeProfile, target: StoreRole): boolean {
    const current = profile.storeRoleId ? graph.positions.get(profile.storeRoleId) : undefined;
    const currentLive = current && current.rank !== null ? current : undefined;
    const sameDepartment = target.departmentId === profile.departmentId;
    if (!currentLive) {
      if (target.rank !== 1) return false;
      // Chưa thuộc bộ phận nào: vào vị trí đầu của bất kỳ bộ phận nào.
      if (!profile.departmentId) return true;
      // Bộ phận hiện tại có vị trí: phải vào vị trí đầu của chính nó trước,
      // không được nhảy thẳng lên bộ phận cấp trên.
      if (this.positionsOf(graph, profile.departmentId).length > 0) return sameDepartment;
      return sameDepartment || this.isAncestor(graph, target.departmentId as string, profile.departmentId);
    }
    if (sameDepartment) return target.rank === (currentLive.rank as number) + 1;
    const top = this.positionsOf(graph, profile.departmentId).at(-1);
    return (
      target.rank === 1 &&
      top?.id === currentLive.id &&
      this.isAncestor(graph, target.departmentId as string, profile.departmentId)
    );
  }

  /** Lên vị trí P, theo quy tắc kề + điều kiện (D8). */
  async evaluatePosition(
    ctx: ProfileContext,
    graph: CareerGraph,
    target: StoreRole,
  ): Promise<PromotionTarget> {
    const profile = ctx.profile;
    const department = graph.departments.get(target.departmentId as string);
    const current = profile.storeRoleId ? graph.positions.get(profile.storeRoleId) : undefined;
    const currentLive = current && current.rank !== null ? current : undefined;
    const sameDepartment = target.departmentId === profile.departmentId;
    const adjacent = this.positionAdjacent(graph, profile, target);

    const items = await this.measureEntry(ctx, graph, this.requirementsOf(graph, { positionId: target.id }));
    // D8: rời bộ phận hiện tại (khác bộ phận) hoặc lên vị trí cao hơn trong
    // nó đều cần đủ kỹ năng bắt buộc của bộ phận hiện tại.
    await this.addImplicitSkills(ctx, graph, items, !!currentLive || !sameDepartment);

    const evaluation = evaluationOf(items, adjacent);
    return {
      kind: 'position',
      id: target.id,
      name: target.name,
      rank: target.rank,
      departmentId: target.departmentId as string,
      departmentName: department?.name ?? '',
      adjacent,
      ...evaluation,
    };
  }

  /** Lên một bộ phận chưa có vị trí nào (vào bộ phận, không vị trí). */
  async evaluateDepartment(
    ctx: ProfileContext,
    graph: CareerGraph,
    target: StoreDepartment,
  ): Promise<PromotionTarget> {
    const profile = ctx.profile;
    const current = profile.storeRoleId ? graph.positions.get(profile.storeRoleId) : undefined;
    const currentLive = current && current.rank !== null ? current : undefined;
    const top = this.positionsOf(graph, profile.departmentId).at(-1);
    const adjacent =
      !target.isSystem &&
      target.id !== profile.departmentId &&
      (!profile.departmentId ||
        (this.isAncestor(graph, target.id, profile.departmentId) &&
          (currentLive
            ? top?.id === currentLive.id
            : this.positionsOf(graph, profile.departmentId).length === 0)));

    // Bộ phận không có điều kiện riêng: vào bộ phận (chưa có vị trí) chỉ cần
    // đủ kỹ năng bắt buộc của bộ phận đang ở.
    const items: MeasuredRequirement[] = [];
    await this.addImplicitSkills(ctx, graph, items, true);
    const evaluation = evaluationOf(items, adjacent);
    return {
      kind: 'department',
      id: target.id,
      name: target.name,
      rank: null,
      departmentId: target.id,
      departmentName: target.name,
      adjacent,
      ...evaluation,
    };
  }

  /**
   * D8: lên vị trí cao hơn, hoặc rời sang bộ phận khác, cần đạt mọi kỹ năng
   * bắt buộc của bộ phận hiện tại. Vào vị trí đầu tiên của chính bộ phận mình
   * thì không cần.
   */
  private async addImplicitSkills(
    ctx: ProfileContext,
    graph: CareerGraph,
    items: MeasuredRequirement[],
    required: boolean,
  ) {
    if (!required || !ctx.profile.departmentId) return;
    if (items.some((i) => i.code === CareerRequirementCode.ALL_REQUIRED_SKILLS)) return;
    const { total, met } = await this.requiredSkillsMet(ctx, graph, ctx.profile.departmentId);
    if (total === 0) return;
    const department = graph.departments.get(ctx.profile.departmentId);
    items.push(
      this.measured(CareerRequirementCode.ALL_REQUIRED_SKILLS, total, met, met >= total, {
        label: `Đạt đủ kỹ năng bắt buộc của ${department?.name ?? 'bộ phận'}`,
        implicit: true,
      }),
    );
  }

  /** Bước kế tự nhiên của một nhân viên (rank kế, hoặc bộ phận cha khi đã ở đỉnh). */
  async nextTarget(ctx: ProfileContext, graph: CareerGraph): Promise<PromotionTarget | null> {
    const profile = ctx.profile;
    if (!profile.departmentId) return null;
    const ladder = this.positionsOf(graph, profile.departmentId);
    const current = profile.storeRoleId ? graph.positions.get(profile.storeRoleId) : undefined;
    const currentLive = current && current.rank !== null ? current : undefined;

    const nextInDepartment = currentLive
      ? ladder.find((p) => (p.rank as number) === (currentLive.rank as number) + 1)
      : ladder[0];
    if (nextInDepartment) return this.evaluatePosition(ctx, graph, nextInDepartment);

    const department = graph.departments.get(profile.departmentId);
    const parent = department?.parentId ? graph.departments.get(department.parentId) : undefined;
    if (!parent || parent.isSystem) return null;
    const entry = this.positionsOf(graph, parent.id)[0];
    return entry
      ? this.evaluatePosition(ctx, graph, entry)
      : this.evaluateDepartment(ctx, graph, parent);
  }

  // -------------------------------------------------------------------------
  // Màn hình
  // -------------------------------------------------------------------------

  /** Lộ trình của một nhân viên (app chủ: chi tiết NV; app NV: trang chủ). */
  async getEmployeeCareer(profileId: string) {
    const m = this.dataSource.manager;
    const profile = await m.findOne(EmployeeProfile, { where: { id: profileId } });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');
    const graph = await this.loadGraph(m, profile.storeId);
    const v2Enabled = graph.setting?.v2Enabled === true;
    if (!v2Enabled) return { v2Enabled: false as const };

    const ctx = this.context(m, profile);
    const department = profile.departmentId ? graph.departments.get(profile.departmentId) : undefined;
    const position = profile.storeRoleId ? graph.positions.get(profile.storeRoleId) : undefined;
    const skills = await this.skillStates(ctx, graph);
    const next = isEmployedStatus(profile.employmentStatus) ? await this.nextTarget(ctx, graph) : null;
    return {
      v2Enabled: true as const,
      department: department
        ? { id: department.id, name: department.name, tier: department.tier }
        : null,
      position:
        position && position.rank !== null
          ? { id: position.id, name: position.name, rank: position.rank }
          : null,
      /** Vị trí của bộ phận hiện tại, thấp → cao. */
      positions: this.positionsOf(graph, profile.departmentId).map((p) => ({
        id: p.id,
        name: p.name,
        rank: p.rank as number,
      })),
      positionEnteredAt: await ctx.positionEnteredAt(),
      next,
      skills,
    };
  }

  /**
   * Ứng viên của một vị trí (màn sửa vị trí):
   * - eligible: NV đang làm, kề vị trí này và đạt điều kiện;
   * - reviewed: đang ở vị trí này nhờ một lần duyệt trong kỳ rà soát hiện tại;
   * - optional: mọi NV đang làm còn lại chưa ở vị trí này ("Xét duyệt" ngoại lệ).
   */
  async getPositionCandidates(storeId: string, positionId: string) {
    const m = this.dataSource.manager;
    const graph = await this.loadGraph(m, storeId);
    const position = graph.positions.get(positionId);
    if (!position || position.rank === null) throw new NotFoundException('Không tìm thấy vị trí');

    const profiles = await m
      .getRepository(EmployeeProfile)
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.account', 'a')
      .where('p.storeId = :storeId', { storeId })
      .andWhere('p.employmentStatus IN (:...statuses)', { statuses: [...EMPLOYED_STATUSES] })
      .orderBy('a.fullName', 'ASC', 'NULLS LAST')
      .getMany();

    const frequency = graph.setting?.reviewReminderEnabled ? graph.setting.reviewFrequency : 'month';
    const periodStart = vnDayStartInstant(reviewPeriodStartDate(frequency));

    const person = (p: EmployeeProfile) => {
      const current = p.storeRoleId ? graph.positions.get(p.storeRoleId) : undefined;
      const department = p.departmentId ? graph.departments.get(p.departmentId) : undefined;
      return {
        profileId: p.id,
        name: p.account?.fullName ?? '',
        avatar: p.account?.avatar ?? null,
        currentPositionName: current && current.rank !== null ? current.name : null,
        departmentName: department?.name ?? null,
      };
    };

    const eligible: Array<ReturnType<typeof person> & { progress: number; items: MeasuredRequirement[] }> = [];
    const reviewed: Array<ReturnType<typeof person> & { reviewedAt: Date }> = [];
    const optional: Array<ReturnType<typeof person>> = [];

    for (const p of profiles) {
      if (p.storeRoleId === position.id) {
        const [event] = await m.query(
          `SELECT effective_at FROM employee_career_events
            WHERE employee_profile_id = $1 AND subject_type = 'position' AND to_target_id = $2
              AND decided_by_account_id IS NOT NULL AND deleted_at IS NULL
              AND effective_at >= $3
            ORDER BY effective_at DESC LIMIT 1`,
          [p.id, position.id, periodStart],
        );
        if (event) reviewed.push({ ...person(p), reviewedAt: event.effective_at });
        continue;
      }
      // Người không kề vị trí này chỉ đi được bằng ngoại lệ: khỏi đo.
      if (!this.positionAdjacent(graph, p, position)) {
        if (optional.length < CAREER_LIMITS.optionalCandidates) optional.push(person(p));
        continue;
      }
      const evaluation = await this.evaluatePosition(this.context(m, p), graph, position);
      if (evaluation.passed) {
        eligible.push({ ...person(p), progress: evaluation.progress, items: evaluation.items });
      } else if (optional.length < CAREER_LIMITS.optionalCandidates) {
        optional.push(person(p));
      }
    }

    return {
      position: {
        id: position.id,
        name: position.name,
        rank: position.rank,
        departmentId: position.departmentId,
      },
      eligible,
      reviewed,
      optional,
    };
  }

  /**
   * Nhân viên theo một kỹ năng (tab Kỹ năng → "Xem nhân viên"):
   * - achieved: NV đang làm đã đạt (kể cả đã chuyển sang bộ phận khác);
   * - learning: NV của bộ phận kỹ năng, kỹ năng đang mở (đang học / chờ xác nhận);
   * - locked: NV của bộ phận kỹ năng, chưa đạt kỹ năng bắt buộc đứng trước.
   * Trạng thái lấy từ chính `skillStates` của màn chi tiết NV, để hai màn
   * không bao giờ nói khác nhau. Người đã nghỉ chỉ được đếm (`formerAchieved`),
   * khớp con số "đã đạt" của tab Kỹ năng (đếm cả người đã nghỉ, D10).
   */
  async getSkillEmployees(storeId: string, skillId: string) {
    const m = this.dataSource.manager;
    const skill = await m.findOne(StoreSkill, { where: { id: skillId, storeId } });
    if (!skill) throw new NotFoundException('Không tìm thấy kỹ năng');
    const graph = await this.loadGraph(m, storeId);

    const profiles = await m
      .getRepository(EmployeeProfile)
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.account', 'a')
      .where('p.storeId = :storeId', { storeId })
      .andWhere('p.employmentStatus IN (:...statuses)', { statuses: [...EMPLOYED_STATUSES] })
      .orderBy('a.fullName', 'ASC', 'NULLS LAST')
      .getMany();
    const achievedRows: Array<{ employee_profile_id: string; achieved_at: Date | null }> =
      await m.query(
        `SELECT employee_profile_id, achieved_at FROM employee_skill_progress
          WHERE store_id = $1 AND skill_id = $2 AND status = $3 AND deleted_at IS NULL`,
        [storeId, skill.id, SkillProgressStatus.ACHIEVED],
      );
    const achievedAt = new Map(achievedRows.map((r) => [r.employee_profile_id, r.achieved_at]));

    const person = (p: EmployeeProfile) => {
      const position = p.storeRoleId ? graph.positions.get(p.storeRoleId) : undefined;
      const department = p.departmentId ? graph.departments.get(p.departmentId) : undefined;
      return {
        profileId: p.id,
        name: p.account?.fullName ?? '',
        avatar: p.account?.avatar ?? null,
        positionName: position && position.rank !== null ? position.name : null,
        departmentName: department?.name ?? null,
        inSkillDepartment: !!skill.departmentId && p.departmentId === skill.departmentId,
      };
    };

    const achieved: Array<ReturnType<typeof person> & { achievedAt: Date | null }> = [];
    const learning: Array<
      ReturnType<typeof person> & {
        awaitingConfirmation: boolean;
        passCount: number;
        progress: number;
        unlockedAt: Date | null;
      }
    > = [];
    const locked: Array<ReturnType<typeof person>> = [];

    for (const p of profiles) {
      if (achievedAt.has(p.id)) {
        achieved.push({ ...person(p), achievedAt: achievedAt.get(p.id) ?? null });
        continue;
      }
      // Kỹ năng đã ngừng dùng không còn mở cho ai: chỉ còn danh sách đã đạt.
      if (!skill.isActive || !skill.departmentId || p.departmentId !== skill.departmentId) continue;
      const states = await this.skillStates(this.context(m, p), graph);
      const state = states.find((s) => s.skillId === skill.id);
      if (!state) continue;
      if (state.status === 'locked') {
        locked.push(person(p));
      } else if (state.status !== 'achieved') {
        learning.push({
          ...person(p),
          awaitingConfirmation: state.status === 'awaiting_confirmation',
          passCount: state.passCount,
          progress: state.evaluation?.progress ?? 0,
          unlockedAt: state.unlockedAt,
        });
      }
    }

    return {
      skill: {
        id: skill.id,
        name: skill.name,
        departmentId: skill.departmentId,
        sequence: skill.sequence,
        level: skill.level,
        confirmation: skill.confirmation,
        isActive: skill.isActive,
      },
      achieved,
      learning,
      locked,
      formerAchieved: achievedRows.length - achieved.length,
    };
  }
}
