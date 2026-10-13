import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import { ActivityLogService } from '../activity-log.service';
import { ACTIVITY_ACTIONS } from '../activity-log.summary';
import { CareerRequirement } from '../entities/career-requirement.entity';
import { EMPLOYED_STATUSES } from '../entities/employee-profile.entity';
import { SkillProgressStatus } from '../entities/employee-skill-progress.entity';
import { StoreCareerSetting } from '../entities/store-career-setting.entity';
import { StoreDepartment } from '../entities/store-department.entity';
import { StorePermissionConfig } from '../entities/store-permission-config.entity';
import { StoreRole } from '../entities/store-role.entity';
import {
  SkillConfirmation,
  SkillLevel,
  StoreSkill,
} from '../entities/store-skill.entity';
import { defaultStaffPermissions } from '../store-permission-defaults';
import {
  CAREER_ERRORS,
  CAREER_LIMITS,
  CAREER_NAME_MAX,
  CareerSubject,
} from './career.constants';
import {
  NormalizedRequirement,
  RequirementInput,
  RequirementView,
  normalizeRequirements,
  toRequirementView,
} from './career-requirements';
import {
  assertCareerV2,
  ensureCareerBase,
  isUniqueViolation,
  lockCareerStore,
} from './career-store';
import type { ReviewFrequency } from './career-time';

export interface CareerMember {
  profileId: string;
  name: string;
  avatar: string | null;
}

export interface CareerSettingsView {
  reviewReminderEnabled: boolean;
  reviewFrequency: ReviewFrequency;
  v2Enabled: boolean;
}

export interface DepartmentView {
  id: string;
  parentId: string | null;
  tier: number;
  name: string;
  description: string | null;
  sortOrder: number;
  isSystem: boolean;
  headcount: number;
  members: CareerMember[];
  requirements: RequirementView[];
}

export interface PositionView {
  id: string;
  departmentId: string | null;
  rank: number | null;
  name: string;
  description: string | null;
  headcount: number;
  members: CareerMember[];
  requirements: RequirementView[];
}

export interface SkillView {
  id: string;
  departmentId: string | null;
  sequence: number | null;
  name: string;
  description: string | null;
  level: SkillLevel;
  confirmation: SkillConfirmation;
  isActive: boolean;
  achievedCount: number;
  requirements: RequirementView[];
}

export interface CareerStructureView {
  settings: CareerSettingsView;
  departments: DepartmentView[];
  positions: PositionView[];
  skills: SkillView[];
  /** Nhân viên đang làm chưa thuộc bộ phận nào. */
  unassigned: { headcount: number; members: CareerMember[] };
}

type Ordered = 'position' | 'skill';

const ORDER = {
  position: {
    table: 'store_roles',
    column: 'rank',
    constraint: 'ux_store_roles_department_rank',
    limit: CAREER_LIMITS.positionsPerDepartment,
  },
  skill: {
    table: 'store_skills',
    column: 'sequence',
    constraint: 'ux_store_skills_department_sequence',
    limit: CAREER_LIMITS.skillsPerDepartment,
  },
} as const;

/** Số avatar xem trước trên thẻ (Figma: chồng 1–3 avatar). */
const MEMBER_PREVIEW = 5;

const trimOrNull = (value: string | null | undefined) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : null;
};

const notFound = (what: string) => new NotFoundException(`Không tìm thấy ${what}`);

/**
 * Cấu trúc lộ trình v2 của một cửa hàng: cây bộ phận, vị trí và kỹ năng có thứ
 * tự trong từng bộ phận, điều kiện để vào từng mục, và cài đặt nhắc kiểm duyệt.
 *
 * Mọi thao tác ghi chạy trong một transaction có khoá dòng cài đặt của cửa
 * hàng (career-store.ts), nên các kiểm tra "cha hợp lệ", "không vòng", "trong
 * giới hạn", "không còn ai dùng" đúng tới lúc commit. Mọi id con luôn được lọc
 * thêm theo `store_id` của route: id của cửa hàng khác trả 404.
 */
@Injectable()
export class CareerStructureService {
  constructor(
    private readonly dataSource: DataSource,
    @Optional() private readonly activityLogService?: ActivityLogService,
  ) {}

  // -------------------------------------------------------------------------
  // Đọc
  // -------------------------------------------------------------------------

  async getSettings(storeId: string): Promise<CareerSettingsView> {
    await this.dataSource.transaction((m) => ensureCareerBase(m, storeId));
    const setting = await this.dataSource.manager.findOneOrFail(StoreCareerSetting, {
      where: { storeId },
    });
    return this.settingsView(setting);
  }

  async updateSettings(
    storeId: string,
    dto: { reviewReminderEnabled?: boolean; reviewFrequency?: ReviewFrequency },
  ): Promise<CareerSettingsView> {
    return this.dataSource.transaction(async (m) => {
      const setting = await lockCareerStore(m, storeId, 'update');
      if (dto.reviewReminderEnabled !== undefined) {
        setting.reviewReminderEnabled = dto.reviewReminderEnabled;
      }
      if (dto.reviewFrequency !== undefined && dto.reviewFrequency !== setting.reviewFrequency) {
        setting.reviewFrequency = dto.reviewFrequency;
        // Kỳ mới tính theo tần suất mới: nhắc lại ở kỳ hiện tại.
        setting.lastRemindedPeriod = null;
      }
      return this.settingsView(await m.save(StoreCareerSetting, setting));
    });
  }

  async getStructure(storeId: string): Promise<CareerStructureView> {
    await this.dataSource.transaction((m) => ensureCareerBase(m, storeId));
    const m = this.dataSource.manager;

    const [setting, departments, positions, skills, requirements, members, achieved] =
      await Promise.all([
        m.findOneOrFail(StoreCareerSetting, { where: { storeId } }),
        m.find(StoreDepartment, {
          where: { storeId },
          order: { tier: 'ASC', sortOrder: 'ASC', createdAt: 'ASC' },
        }),
        // Vị trí đã tắt (app cũ) không còn là một bậc trên lộ trình.
        m.find(StoreRole, { where: { storeId, isActive: true }, order: { createdAt: 'ASC' } }),
        m.find(StoreSkill, { where: { storeId }, order: { createdAt: 'ASC' } }),
        m.find(CareerRequirement, {
          where: { storeId },
          order: { sortOrder: 'ASC', createdAt: 'ASC' },
        }),
        this.employedMembers(m, storeId),
        this.achievedCounts(m, storeId),
      ]);

    const reqsBy = (pick: (r: CareerRequirement) => string | null) => {
      const map = new Map<string, RequirementView[]>();
      for (const r of requirements) {
        const key = pick(r);
        if (!key) continue;
        map.set(key, [...(map.get(key) ?? []), toRequirementView(r)]);
      }
      return map;
    };
    const deptReqs = reqsBy((r) => r.departmentId);
    const posReqs = reqsBy((r) => r.positionId);
    const skillReqs = reqsBy((r) => r.skillId);

    const group = (pick: (row: (typeof members)[number]) => string | null) => {
      const map = new Map<string, CareerMember[]>();
      for (const row of members) {
        const key = pick(row);
        if (!key) continue;
        map.set(key, [...(map.get(key) ?? []), row.member]);
      }
      return map;
    };
    const byDept = group((r) => r.departmentId);
    const byPos = group((r) => r.positionId);
    const preview = (list: CareerMember[] | undefined) => ({
      headcount: list?.length ?? 0,
      members: (list ?? []).slice(0, MEMBER_PREVIEW),
    });

    const byOrder = <T extends { createdAt: Date }>(key: (row: T) => number | null) =>
      (a: T, b: T) =>
        (key(a) ?? Number.MAX_SAFE_INTEGER) - (key(b) ?? Number.MAX_SAFE_INTEGER) ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

    const unassigned = members.filter((r) => !r.departmentId).map((r) => r.member);

    return {
      settings: this.settingsView(setting),
      departments: departments.map((d) => ({
        id: d.id,
        parentId: d.parentId,
        tier: d.tier,
        name: d.name,
        description: d.description,
        sortOrder: d.sortOrder,
        isSystem: d.isSystem,
        ...preview(byDept.get(d.id)),
        requirements: deptReqs.get(d.id) ?? [],
      })),
      positions: [...positions].sort(byOrder((p) => p.rank)).map((p) => ({
        id: p.id,
        departmentId: p.departmentId,
        rank: p.rank,
        name: p.name,
        description: p.description ?? null,
        ...preview(byPos.get(p.id)),
        requirements: posReqs.get(p.id) ?? [],
      })),
      skills: [...skills].sort(byOrder((s) => s.sequence)).map((s) => ({
        id: s.id,
        departmentId: s.departmentId,
        sequence: s.sequence,
        name: s.name,
        description: s.description ?? null,
        level: s.level,
        confirmation: s.confirmation,
        isActive: s.isActive,
        achievedCount: achieved.get(s.id) ?? 0,
        requirements: skillReqs.get(s.id) ?? [],
      })),
      unassigned: { headcount: unassigned.length, members: unassigned.slice(0, MEMBER_PREVIEW) },
    };
  }

  // -------------------------------------------------------------------------
  // Bộ phận
  // -------------------------------------------------------------------------

  async createDepartment(
    storeId: string,
    dto: {
      name: string;
      description?: string | null;
      tier: number;
      parentId: string;
      requirements?: RequirementInput[];
    },
    actorAccountId: string | null,
  ) {
    return this.write(storeId, async (m) => {
      const total = await m.count(StoreDepartment, { where: { storeId } });
      if (total >= CAREER_LIMITS.departmentsPerStore) {
        throw this.limitReached(`Tối đa ${CAREER_LIMITS.departmentsPerStore} bộ phận`);
      }
      const parent = await this.department(m, storeId, dto.parentId);
      this.assertTier(parent, dto.tier);
      const name = dto.name.trim();
      await this.assertDepartmentNameFree(m, storeId, name);
      const requirements = normalizeRequirements('department', dto.requirements);

      const department = await m.save(
        StoreDepartment,
        m.create(StoreDepartment, {
          storeId,
          parentId: parent.id,
          tier: dto.tier,
          name,
          description: trimOrNull(dto.description),
          sortOrder: await this.nextSortOrder(m, storeId, parent.id),
          isSystem: false,
        }),
      );
      await this.writeRequirements(m, storeId, { departmentId: department.id }, requirements);
      await this.logChange(m, storeId, actorAccountId, 'department', 'created', department);
      return department;
    });
  }

  async updateDepartment(
    storeId: string,
    departmentId: string,
    dto: {
      name?: string;
      description?: string | null;
      tier?: number;
      parentId?: string;
      requirements?: RequirementInput[];
    },
    actorAccountId: string | null,
  ) {
    return this.write(storeId, async (m) => {
      const department = await this.department(m, storeId, departmentId);

      if (department.isSystem) {
        // Cấp 1 cố định (D1): đổi tên / mô tả được, không đổi cấp, không có cha,
        // không có điều kiện — không ai "lên" Cấp 1.
        const movesSystem =
          (dto.tier !== undefined && dto.tier !== department.tier) ||
          (dto.parentId !== undefined && dto.parentId !== department.parentId) ||
          (dto.requirements !== undefined && dto.requirements.length > 0);
        if (movesSystem) {
          throw new BadRequestException({
            code: CAREER_ERRORS.SYSTEM_DEPARTMENT,
            message: 'Bộ phận Cấp 1 chỉ đổi được tên và mô tả',
          });
        }
      } else {
        const tier = dto.tier ?? department.tier;
        const parentId = dto.parentId ?? (department.parentId as string);
        if (tier !== department.tier || parentId !== department.parentId) {
          const all = await m.find(StoreDepartment, { where: { storeId } });
          const parent = all.find((d) => d.id === parentId);
          if (!parent) throw notFound('bộ phận quản lý');
          this.assertTier(parent, tier);
          // Cha mới không được là chính nó hay một bộ phận con cháu của nó.
          for (let cursor: StoreDepartment | undefined = parent; cursor; ) {
            if (cursor.id === department.id) {
              throw new BadRequestException({
                code: CAREER_ERRORS.PARENT_INVALID,
                message: 'Không thể đặt bộ phận dưới chính bộ phận con của nó',
              });
            }
            cursor = all.find((d) => d.id === cursor?.parentId);
          }
          const lowChild = all.find((d) => d.parentId === department.id && d.tier <= tier);
          if (lowChild) {
            throw new BadRequestException({
              code: CAREER_ERRORS.TIER_INVALID,
              message: `Bộ phận con "${lowChild.name}" đang ở Cấp ${lowChild.tier}; cấp của bộ phận quản lý phải nhỏ hơn`,
            });
          }
          if (parentId !== department.parentId) {
            department.sortOrder = await this.nextSortOrder(m, storeId, parentId);
          }
          department.tier = tier;
          department.parentId = parentId;
        }
      }

      if (dto.name !== undefined) {
        const name = dto.name.trim();
        if (name.toLowerCase() !== department.name.toLowerCase()) {
          await this.assertDepartmentNameFree(m, storeId, name);
        }
        department.name = name;
      }
      if (dto.description !== undefined) department.description = trimOrNull(dto.description);
      const saved = await m.save(StoreDepartment, department);
      if (!department.isSystem && dto.requirements !== undefined) {
        await this.writeRequirements(
          m,
          storeId,
          { departmentId: department.id },
          normalizeRequirements('department', dto.requirements),
        );
      }
      await this.logChange(m, storeId, actorAccountId, 'department', 'updated', saved);
      return saved;
    });
  }

  async deleteDepartment(storeId: string, departmentId: string, actorAccountId: string | null) {
    return this.write(storeId, async (m) => {
      const department = await this.department(m, storeId, departmentId);
      if (department.isSystem) {
        throw new BadRequestException({
          code: CAREER_ERRORS.SYSTEM_DEPARTMENT,
          message: 'Không thể xoá bộ phận Cấp 1',
        });
      }
      const children = await m.count(StoreDepartment, {
        where: { storeId, parentId: department.id },
      });
      const [{ employees }] = await m.query(
        `SELECT count(*)::int AS employees
           FROM employee_profiles p
          WHERE p.store_id = $1 AND p.deleted_at IS NULL
            AND p.employment_status = ANY($3)
            AND (p.department_id = $2 OR p.store_role_id IN (
                  SELECT r.id FROM store_roles r WHERE r.department_id = $2 AND r.deleted_at IS NULL))`,
        [storeId, department.id, EMPLOYED_STATUSES],
      );
      const [{ achievers }] = await m.query(
        `SELECT count(*)::int AS achievers
           FROM employee_skill_progress g
           JOIN store_skills k ON k.id = g.skill_id
          WHERE g.store_id = $1 AND g.deleted_at IS NULL AND g.status = $3
            AND k.department_id = $2 AND k.deleted_at IS NULL`,
        [storeId, department.id, SkillProgressStatus.ACHIEVED],
      );
      if (children > 0 || employees > 0 || achievers > 0) {
        const reasons = [
          children > 0 ? `${children} bộ phận con` : null,
          employees > 0 ? `${employees} nhân viên` : null,
          achievers > 0 ? `${achievers} lượt đạt kỹ năng` : null,
        ].filter(Boolean);
        throw new ConflictException({
          code: CAREER_ERRORS.DEPARTMENT_IN_USE,
          message: `Bộ phận còn ${reasons.join(', ')}. Chuyển hoặc xoá chúng trước.`,
          children,
          employees,
          skillAchievers: achievers,
        });
      }

      const now = new Date();
      const positionIds = (
        await m.find(StoreRole, { where: { storeId, departmentId: department.id }, select: ['id'] })
      ).map((r) => r.id);
      const skillIds = (
        await m.find(StoreSkill, { where: { storeId, departmentId: department.id }, select: ['id'] })
      ).map((s) => s.id);

      await m.query(
        `UPDATE store_roles SET rank = NULL, deleted_at = $3, updated_at = $3
          WHERE store_id = $1 AND department_id = $2 AND deleted_at IS NULL`,
        [storeId, department.id, now],
      );
      await this.retireSkills(m, storeId, skillIds, now);
      await m.query(
        `UPDATE career_requirements SET deleted_at = $3, updated_at = $3
          WHERE store_id = $1 AND deleted_at IS NULL
            AND (department_id = $2 OR position_id = ANY($4::uuid[]))`,
        [storeId, department.id, now, positionIds],
      );
      await m.update(StoreDepartment, { id: department.id }, { deletedAt: now });
      await this.logChange(m, storeId, actorAccountId, 'department', 'deleted', department);
      return { id: department.id, deleted: true };
    });
  }

  /**
   * Nhân bản sâu (D9): bộ phận cùng cấp và cha, điều kiện, mọi vị trí và kỹ
   * năng cùng điều kiện của chúng. `skill_achieved` trỏ vào kỹ năng của chính
   * bộ phận được chép sang kỹ năng bản sao. Không chép nhân viên, tiến độ.
   */
  async duplicateDepartment(storeId: string, departmentId: string, actorAccountId: string | null) {
    return this.write(storeId, async (m) => {
      const source = await this.department(m, storeId, departmentId);
      if (source.isSystem) {
        throw new BadRequestException({
          code: CAREER_ERRORS.SYSTEM_DEPARTMENT,
          message: 'Không thể nhân bản bộ phận Cấp 1',
        });
      }
      const total = await m.count(StoreDepartment, { where: { storeId } });
      if (total >= CAREER_LIMITS.departmentsPerStore) {
        throw this.limitReached(`Tối đa ${CAREER_LIMITS.departmentsPerStore} bộ phận`);
      }

      const copy = await m.save(
        StoreDepartment,
        m.create(StoreDepartment, {
          storeId,
          parentId: source.parentId,
          tier: source.tier,
          name: await this.copyName(m, storeId, source.name),
          description: source.description,
          sortOrder: await this.nextSortOrder(m, storeId, source.parentId as string),
          isSystem: false,
        }),
      );

      const requirements = await m.find(CareerRequirement, { where: { storeId } });
      const cloneReqs = async (
        filter: (r: CareerRequirement) => boolean,
        subject: Partial<Pick<CareerRequirement, 'departmentId' | 'positionId' | 'skillId'>>,
        skillMap: Map<string, string>,
      ) => {
        const rows = requirements.filter(filter);
        for (const r of rows) {
          await m.save(
            CareerRequirement,
            m.create(CareerRequirement, {
              storeId,
              departmentId: subject.departmentId ?? null,
              positionId: subject.positionId ?? null,
              skillId: subject.skillId ?? null,
              code: r.code,
              operator: r.operator,
              value: r.value,
              refSkillId: r.refSkillId ? (skillMap.get(r.refSkillId) ?? r.refSkillId) : null,
              isRequired: r.isRequired,
              sortOrder: r.sortOrder,
            }),
          );
        }
      };

      const skills = await m.find(StoreSkill, { where: { storeId, departmentId: source.id } });
      const skillMap = new Map<string, string>();
      for (const s of skills) {
        const clone = await m.save(
          StoreSkill,
          m.create(StoreSkill, {
            storeId,
            departmentId: copy.id,
            sequence: s.sequence,
            name: s.name,
            description: s.description,
            level: s.level,
            confirmation: s.confirmation,
            isActive: s.isActive,
          }),
        );
        skillMap.set(s.id, clone.id);
      }
      await cloneReqs((r) => r.departmentId === source.id, { departmentId: copy.id }, skillMap);
      for (const s of skills) {
        await cloneReqs((r) => r.skillId === s.id, { skillId: skillMap.get(s.id) }, skillMap);
      }

      const positions = await m.find(StoreRole, { where: { storeId, departmentId: source.id } });
      for (const p of positions) {
        const clone = await this.insertRole(m, storeId, {
          departmentId: copy.id,
          rank: p.rank,
          name: p.name,
          description: p.description ?? null,
        });
        await cloneReqs((r) => r.positionId === p.id, { positionId: clone.id }, skillMap);
      }

      await this.logChange(m, storeId, actorAccountId, 'department', 'duplicated', copy);
      return copy;
    });
  }

  // -------------------------------------------------------------------------
  // Vị trí
  // -------------------------------------------------------------------------

  async createPosition(
    storeId: string,
    dto: {
      departmentId: string;
      name: string;
      description?: string | null;
      rank?: number;
      requirements?: RequirementInput[];
    },
    actorAccountId: string | null,
  ) {
    return this.write(storeId, async (m) => {
      const department = await this.memberDepartment(m, storeId, dto.departmentId, 'vị trí');
      const name = dto.name.trim();
      await this.assertNameFreeInDepartment(m, 'position', department.id, name);
      const requirements = normalizeRequirements('position', dto.requirements);

      const order = await this.orderedIds(m, 'position', department.id);
      if (order.length >= ORDER.position.limit) {
        throw this.limitReached(`Tối đa ${ORDER.position.limit} vị trí mỗi bộ phận`);
      }
      const role = await this.insertRole(m, storeId, {
        departmentId: department.id,
        rank: null,
        name,
        description: trimOrNull(dto.description),
      });
      await this.applyOrder(m, 'position', this.placed(order, role.id, dto.rank));
      await this.writeRequirements(m, storeId, { positionId: role.id }, requirements);
      await this.logChange(m, storeId, actorAccountId, 'position', 'created', role);
      return m.findOneByOrFail(StoreRole, { id: role.id });
    });
  }

  async updatePosition(
    storeId: string,
    positionId: string,
    dto: {
      departmentId?: string;
      name?: string;
      description?: string | null;
      rank?: number;
      requirements?: RequirementInput[];
    },
    actorAccountId: string | null,
  ) {
    return this.write(storeId, async (m) => {
      const role = await this.position(m, storeId, positionId);
      const targetDepartmentId = dto.departmentId ?? role.departmentId;
      if (!targetDepartmentId) {
        throw new BadRequestException({
          code: CAREER_ERRORS.PARENT_INVALID,
          message: 'Chọn bộ phận cho vị trí',
        });
      }

      if (targetDepartmentId !== role.departmentId) {
        // Hồ sơ luôn cùng bộ phận với vị trí của nó: đổi bộ phận của vị trí
        // đang có người giữ sẽ làm lệch bất biến đó.
        const holders = await this.countHolders(m, storeId, role.id);
        if (holders > 0) {
          throw new ConflictException({
            code: CAREER_ERRORS.POSITION_IN_USE,
            message: `Còn ${holders} nhân viên ở vị trí này. Chuyển họ sang vị trí khác trước khi đổi bộ phận.`,
            employeesAffected: holders,
          });
        }
        const department = await this.memberDepartment(m, storeId, targetDepartmentId, 'vị trí');
        const target = await this.orderedIds(m, 'position', department.id);
        if (target.length >= ORDER.position.limit) {
          throw this.limitReached(`Tối đa ${ORDER.position.limit} vị trí mỗi bộ phận`);
        }
        const name = (dto.name ?? role.name).trim();
        await this.assertNameFreeInDepartment(m, 'position', department.id, name, role.id);
        if (role.departmentId) {
          const source = await this.orderedIds(m, 'position', role.departmentId);
          await m.query('UPDATE store_roles SET rank = NULL WHERE id = $1', [role.id]);
          await this.applyOrder(m, 'position', source.filter((id) => id !== role.id));
        }
        await m.query('UPDATE store_roles SET department_id = $2 WHERE id = $1', [
          role.id,
          department.id,
        ]);
        await this.applyOrder(m, 'position', this.placed(target, role.id, dto.rank));
      } else if (dto.rank !== undefined) {
        const order = await this.orderedIds(m, 'position', targetDepartmentId);
        await this.applyOrder(m, 'position', this.placed(order, role.id, dto.rank));
      }

      const changes: Partial<StoreRole> = {};
      if (dto.name !== undefined) {
        const name = dto.name.trim();
        if (targetDepartmentId === role.departmentId) {
          await this.assertNameFreeInDepartment(m, 'position', targetDepartmentId, name, role.id);
        }
        changes.name = name;
      }
      if (dto.description !== undefined) {
        changes.description = trimOrNull(dto.description) as string;
      }
      if (Object.keys(changes).length) await m.update(StoreRole, { id: role.id }, changes);
      if (dto.requirements !== undefined) {
        await this.writeRequirements(
          m,
          storeId,
          { positionId: role.id },
          normalizeRequirements('position', dto.requirements),
        );
      }
      const saved = await m.findOneByOrFail(StoreRole, { id: role.id });
      await this.logChange(m, storeId, actorAccountId, 'position', 'updated', saved);
      return saved;
    });
  }

  async deletePosition(storeId: string, positionId: string, actorAccountId: string | null) {
    return this.write(storeId, async (m) => {
      const role = await this.position(m, storeId, positionId);
      const holders = await this.countHolders(m, storeId, role.id);
      if (holders > 0) {
        throw new ConflictException({
          code: CAREER_ERRORS.POSITION_IN_USE,
          message: `Còn ${holders} nhân viên ở vị trí này. Chuyển họ sang vị trí khác trước khi xoá.`,
          employeesAffected: holders,
        });
      }
      const now = new Date();
      const remaining = role.departmentId
        ? (await this.orderedIds(m, 'position', role.departmentId)).filter((id) => id !== role.id)
        : [];
      await m.query(
        'UPDATE store_roles SET rank = NULL, deleted_at = $2, updated_at = $2 WHERE id = $1',
        [role.id, now],
      );
      await this.applyOrder(m, 'position', remaining);
      await m.query(
        `UPDATE career_requirements SET deleted_at = $2, updated_at = $2
          WHERE position_id = $1 AND deleted_at IS NULL`,
        [role.id, now],
      );
      await this.logChange(m, storeId, actorAccountId, 'position', 'deleted', role);
      return { id: role.id, deleted: true };
    });
  }

  // -------------------------------------------------------------------------
  // Kỹ năng
  // -------------------------------------------------------------------------

  async createSkill(
    storeId: string,
    dto: {
      departmentId: string;
      name: string;
      description?: string | null;
      sequence?: number;
      level: SkillLevel;
      confirmation: SkillConfirmation;
      requirements?: RequirementInput[];
    },
    actorAccountId: string | null,
  ) {
    return this.write(storeId, async (m) => {
      const department = await this.memberDepartment(m, storeId, dto.departmentId, 'kỹ năng');
      const name = dto.name.trim();
      await this.assertNameFreeInDepartment(m, 'skill', department.id, name);
      const requirements = normalizeRequirements('skill', dto.requirements);
      const order = await this.orderedIds(m, 'skill', department.id);
      if (order.length >= ORDER.skill.limit) {
        throw this.limitReached(`Tối đa ${ORDER.skill.limit} kỹ năng mỗi bộ phận`);
      }
      const skill = await m.save(
        StoreSkill,
        m.create(StoreSkill, {
          storeId,
          departmentId: department.id,
          sequence: null,
          name,
          description: trimOrNull(dto.description) as string,
          level: dto.level,
          confirmation: dto.confirmation,
          isActive: true,
        }),
      );
      await this.applyOrder(m, 'skill', this.placed(order, skill.id, dto.sequence));
      await this.writeRequirements(m, storeId, { skillId: skill.id }, requirements);
      await this.logChange(m, storeId, actorAccountId, 'skill', 'created', skill);
      return m.findOneByOrFail(StoreSkill, { id: skill.id });
    });
  }

  async updateSkill(
    storeId: string,
    skillId: string,
    dto: {
      departmentId?: string;
      name?: string;
      description?: string | null;
      sequence?: number;
      level?: SkillLevel;
      confirmation?: SkillConfirmation;
      isActive?: boolean;
      requirements?: RequirementInput[];
    },
    actorAccountId: string | null,
  ) {
    return this.write(storeId, async (m) => {
      const skill = await this.skill(m, storeId, skillId);
      const targetDepartmentId = dto.departmentId ?? skill.departmentId;
      if (!targetDepartmentId) {
        throw new BadRequestException({
          code: CAREER_ERRORS.PARENT_INVALID,
          message: 'Chọn bộ phận cho kỹ năng',
        });
      }

      if (targetDepartmentId !== skill.departmentId) {
        // Tiến độ đo giờ thực hành trong bộ phận của kỹ năng: chuyển bộ phận
        // giữa chừng làm sai nghĩa mọi tiến độ đã có.
        const [{ progress }] = await m.query(
          `SELECT count(*)::int AS progress FROM employee_skill_progress
            WHERE skill_id = $1 AND deleted_at IS NULL`,
          [skill.id],
        );
        if (progress > 0) {
          throw new ConflictException({
            code: CAREER_ERRORS.SKILL_HAS_ACHIEVERS,
            message: 'Kỹ năng đã có nhân viên học hoặc đạt, không chuyển bộ phận được.',
          });
        }
        const department = await this.memberDepartment(m, storeId, targetDepartmentId, 'kỹ năng');
        const target = await this.orderedIds(m, 'skill', department.id);
        if (target.length >= ORDER.skill.limit) {
          throw this.limitReached(`Tối đa ${ORDER.skill.limit} kỹ năng mỗi bộ phận`);
        }
        const name = (dto.name ?? skill.name).trim();
        await this.assertNameFreeInDepartment(m, 'skill', department.id, name, skill.id);
        if (skill.departmentId) {
          const source = await this.orderedIds(m, 'skill', skill.departmentId);
          await m.query('UPDATE store_skills SET sequence = NULL WHERE id = $1', [skill.id]);
          await this.applyOrder(m, 'skill', source.filter((id) => id !== skill.id));
        }
        await m.query('UPDATE store_skills SET department_id = $2 WHERE id = $1', [
          skill.id,
          department.id,
        ]);
        await this.applyOrder(m, 'skill', this.placed(target, skill.id, dto.sequence));
      } else if (dto.sequence !== undefined) {
        const order = await this.orderedIds(m, 'skill', targetDepartmentId);
        await this.applyOrder(m, 'skill', this.placed(order, skill.id, dto.sequence));
      }

      const changes: Partial<StoreSkill> = {};
      if (dto.name !== undefined) {
        const name = dto.name.trim();
        if (targetDepartmentId === skill.departmentId) {
          await this.assertNameFreeInDepartment(m, 'skill', targetDepartmentId, name, skill.id);
        }
        changes.name = name;
      }
      if (dto.description !== undefined) {
        changes.description = trimOrNull(dto.description) as string;
      }
      if (dto.level !== undefined) changes.level = dto.level;
      if (dto.confirmation !== undefined) changes.confirmation = dto.confirmation;
      if (dto.isActive !== undefined) changes.isActive = dto.isActive;
      if (Object.keys(changes).length) await m.update(StoreSkill, { id: skill.id }, changes);
      if (dto.requirements !== undefined) {
        await this.writeRequirements(
          m,
          storeId,
          { skillId: skill.id },
          normalizeRequirements('skill', dto.requirements),
        );
      }
      const saved = await m.findOneByOrFail(StoreSkill, { id: skill.id });
      const change = dto.isActive === false && skill.isActive ? 'deactivated' : 'updated';
      await this.logChange(m, storeId, actorAccountId, 'skill', change, saved);
      return saved;
    });
  }

  async deleteSkill(storeId: string, skillId: string, actorAccountId: string | null) {
    return this.write(storeId, async (m) => {
      const skill = await this.skill(m, storeId, skillId);
      const [{ achievers }] = await m.query(
        `SELECT count(*)::int AS achievers FROM employee_skill_progress
          WHERE skill_id = $1 AND deleted_at IS NULL AND status = $2`,
        [skill.id, SkillProgressStatus.ACHIEVED],
      );
      if (achievers > 0) {
        throw new ConflictException({
          code: CAREER_ERRORS.SKILL_HAS_ACHIEVERS,
          message: `Đã có ${achievers} lượt đạt kỹ năng này. Chỉ có thể ngừng dùng để giữ lịch sử.`,
          achievers,
        });
      }
      const now = new Date();
      const remaining = skill.departmentId
        ? (await this.orderedIds(m, 'skill', skill.departmentId)).filter((id) => id !== skill.id)
        : [];
      await this.retireSkills(m, storeId, [skill.id], now);
      await this.applyOrder(m, 'skill', remaining);
      await this.logChange(m, storeId, actorAccountId, 'skill', 'deleted', skill);
      return { id: skill.id, deleted: true };
    });
  }

  // -------------------------------------------------------------------------
  // Nội bộ
  // -------------------------------------------------------------------------

  /** Một lần ghi cấu trúc: transaction + khoá cửa hàng + cờ v2. */
  private async write<T>(storeId: string, work: (m: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.dataSource.transaction(async (m) => {
        const setting = await lockCareerStore(m, storeId, 'update');
        assertCareerV2(setting);
        return work(m);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'ux_store_departments_name')) {
        throw new ConflictException({
          code: CAREER_ERRORS.NAME_TAKEN,
          message: 'Tên bộ phận đã có trong cửa hàng',
        });
      }
      throw error;
    }
  }

  private settingsView(setting: StoreCareerSetting): CareerSettingsView {
    return {
      reviewReminderEnabled: setting.reviewReminderEnabled,
      reviewFrequency: setting.reviewFrequency,
      v2Enabled: setting.v2Enabled,
    };
  }

  private limitReached(message: string) {
    return new BadRequestException({ code: CAREER_ERRORS.LIMIT_REACHED, message });
  }

  private assertTier(parent: StoreDepartment, tier: number) {
    if (!(tier >= 2 && tier <= 4) || parent.tier >= tier) {
      throw new BadRequestException({
        code: CAREER_ERRORS.TIER_INVALID,
        message: `Bộ phận quản lý ở Cấp ${parent.tier}; cấp của bộ phận phải lớn hơn và từ 2 đến 4`,
      });
    }
  }

  private async department(m: EntityManager, storeId: string, id: string) {
    const department = await m.findOne(StoreDepartment, { where: { id, storeId } });
    if (!department) throw notFound('bộ phận');
    return department;
  }

  /** Bộ phận chứa được vị trí / kỹ năng: mọi bộ phận trừ Cấp 1 hệ thống (D1). */
  private async memberDepartment(m: EntityManager, storeId: string, id: string, what: string) {
    const department = await this.department(m, storeId, id);
    if (department.isSystem) {
      throw new BadRequestException({
        code: CAREER_ERRORS.SYSTEM_DEPARTMENT,
        message: `Bộ phận Cấp 1 không có ${what}`,
      });
    }
    return department;
  }

  private async position(m: EntityManager, storeId: string, id: string) {
    const role = await m.findOne(StoreRole, { where: { id, storeId } });
    if (!role) throw notFound('vị trí');
    return role;
  }

  private async skill(m: EntityManager, storeId: string, id: string) {
    const skill = await m.findOne(StoreSkill, { where: { id, storeId } });
    if (!skill) throw notFound('kỹ năng');
    return skill;
  }

  private async assertDepartmentNameFree(m: EntityManager, storeId: string, name: string) {
    const [{ taken }] = await m.query(
      `SELECT count(*)::int AS taken FROM store_departments
        WHERE store_id = $1 AND deleted_at IS NULL AND lower(name) = lower($2)`,
      [storeId, name],
    );
    if (taken > 0) {
      throw new ConflictException({
        code: CAREER_ERRORS.NAME_TAKEN,
        message: 'Tên bộ phận đã có trong cửa hàng',
      });
    }
  }

  private async assertNameFreeInDepartment(
    m: EntityManager,
    kind: Ordered,
    departmentId: string,
    name: string,
    exceptId?: string,
  ) {
    const { table } = ORDER[kind];
    const [{ taken }] = await m.query(
      `SELECT count(*)::int AS taken FROM ${table}
        WHERE department_id = $1 AND deleted_at IS NULL AND lower(name) = lower($2)
          AND ($3::uuid IS NULL OR id <> $3::uuid)`,
      [departmentId, name, exceptId ?? null],
    );
    if (taken > 0) {
      throw new ConflictException({
        code: CAREER_ERRORS.NAME_TAKEN,
        message: `Bộ phận đã có ${kind === 'position' ? 'vị trí' : 'kỹ năng'} cùng tên`,
      });
    }
  }

  private async nextSortOrder(m: EntityManager, storeId: string, parentId: string) {
    const [{ next }] = await m.query(
      `SELECT COALESCE(max(sort_order), 0) + 1 AS next FROM store_departments
        WHERE store_id = $1 AND parent_id = $2 AND deleted_at IS NULL`,
      [storeId, parentId],
    );
    return Number(next) || 1;
  }

  /** "Tên (bản sao)", "Tên (bản sao 2)"… vừa 80 ký tự và chưa có trong cửa hàng. */
  private async copyName(m: EntityManager, storeId: string, base: string) {
    const rows: Array<{ name: string }> = await m.query(
      'SELECT lower(name) AS name FROM store_departments WHERE store_id = $1 AND deleted_at IS NULL',
      [storeId],
    );
    const taken = new Set(rows.map((r) => r.name));
    for (let n = 1; n < 1000; n += 1) {
      const suffix = n === 1 ? ' (bản sao)' : ` (bản sao ${n})`;
      const name = `${base.slice(0, CAREER_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
      if (!taken.has(name.toLowerCase())) return name;
    }
    throw new ConflictException({ code: CAREER_ERRORS.NAME_TAKEN, message: 'Không đặt được tên bản sao' });
  }

  private async countHolders(m: EntityManager, storeId: string, positionId: string) {
    const [{ holders }] = await m.query(
      `SELECT count(*)::int AS holders FROM employee_profiles
        WHERE store_id = $1 AND store_role_id = $2 AND deleted_at IS NULL
          AND employment_status = ANY($3)`,
      [storeId, positionId, EMPLOYED_STATUSES],
    );
    return holders as number;
  }

  /** Id còn sống trong bộ phận, theo thứ tự hiện tại. */
  private async orderedIds(m: EntityManager, kind: Ordered, departmentId: string) {
    const { table, column } = ORDER[kind];
    const rows: Array<{ id: string }> = await m.query(
      `SELECT id FROM ${table}
        WHERE department_id = $1 AND deleted_at IS NULL
        ORDER BY ${column} NULLS LAST, created_at, id`,
      [departmentId],
    );
    return rows.map((r) => r.id);
  }

  /** Đặt `id` vào vị trí thứ `position` (1 = đầu); không có = cuối. */
  private placed(order: string[], id: string, position?: number) {
    const rest = order.filter((x) => x !== id);
    const index = position === undefined ? rest.length : Math.min(Math.max(position - 1, 0), rest.length);
    return [...rest.slice(0, index), id, ...rest.slice(index)];
  }

  /**
   * Ghi lại thứ tự 1..n. Ràng buộc unique (department_id, rank|sequence) là
   * DEFERRABLE: hoãn tới cuối transaction để các bước hoán đổi giữa chừng không
   * va nhau.
   */
  private async applyOrder(m: EntityManager, kind: Ordered, ids: string[]) {
    const { table, column, constraint } = ORDER[kind];
    await m.query(`SET CONSTRAINTS ${constraint} DEFERRED`);
    for (let i = 0; i < ids.length; i += 1) {
      await m.query(`UPDATE ${table} SET ${column} = $1, updated_at = now() WHERE id = $2`, [
        i + 1,
        ids[i],
      ]);
    }
  }

  /** Vị trí mới kèm bảng quyền mặc định riêng, như StoresService.createRole. */
  private async insertRole(
    m: EntityManager,
    storeId: string,
    data: { departmentId: string; rank: number | null; name: string; description: string | null },
  ) {
    const role = await m.save(
      StoreRole,
      m.create(StoreRole, {
        storeId,
        departmentId: data.departmentId,
        rank: data.rank,
        name: data.name,
        description: data.description as string,
      }),
    );
    const config = await m.save(
      StorePermissionConfig,
      m.create(StorePermissionConfig, {
        storeId,
        roleId: role.id,
        name: `Permissions for ${role.name}`,
        ...defaultStaffPermissions(),
      } as any),
    );
    await m.update(StoreRole, { id: role.id }, { permissionConfigId: (config as any).id });
    return role;
  }

  /**
   * Thay trọn bộ điều kiện của một chủ thể. Kỹ năng tham chiếu phải cùng cửa
   * hàng, còn dùng (khoá ngoại kép giữ phần "cùng cửa hàng" ở tầng DB).
   */
  private async writeRequirements(
    m: EntityManager,
    storeId: string,
    subject: { departmentId?: string; positionId?: string; skillId?: string },
    requirements: NormalizedRequirement[],
  ) {
    const refs = requirements.map((r) => r.refSkillId).filter((id): id is string => !!id);
    if (refs.length) {
      const found = await m.find(StoreSkill, {
        where: { id: In(refs), storeId, isActive: true },
        select: ['id'],
      });
      if (found.length !== new Set(refs).size) {
        throw new BadRequestException({
          code: CAREER_ERRORS.REQUIREMENT_INVALID,
          message: 'Kỹ năng trong điều kiện không còn dùng hoặc không thuộc cửa hàng',
        });
      }
    }
    const where = subject.departmentId
      ? { departmentId: subject.departmentId }
      : subject.positionId
        ? { positionId: subject.positionId }
        : { skillId: subject.skillId };
    await m.delete(CareerRequirement, where);
    let order = 0;
    for (const r of requirements) {
      await m.save(
        CareerRequirement,
        m.create(CareerRequirement, {
          storeId,
          departmentId: subject.departmentId ?? null,
          positionId: subject.positionId ?? null,
          skillId: subject.skillId ?? null,
          code: r.code,
          operator: 'gte',
          value: r.value,
          refSkillId: r.refSkillId,
          isRequired: true,
          sortOrder: order++,
        }),
      );
    }
  }

  /**
   * Xoá mềm kỹ năng: bỏ khỏi thứ tự, xoá điều kiện của nó và các điều kiện
   * "đạt kỹ năng X" trỏ vào nó, xoá tiến độ dở. Tiến độ đã đạt được giữ (chặn
   * từ trước khi gọi).
   */
  private async retireSkills(m: EntityManager, storeId: string, skillIds: string[], now: Date) {
    if (!skillIds.length) return;
    await m.query(
      `UPDATE store_skills SET sequence = NULL, deleted_at = $3, updated_at = $3
        WHERE store_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
      [storeId, skillIds, now],
    );
    await m.query(
      `UPDATE career_requirements SET deleted_at = $3, updated_at = $3
        WHERE store_id = $1 AND deleted_at IS NULL
          AND (skill_id = ANY($2::uuid[]) OR ref_skill_id = ANY($2::uuid[]))`,
      [storeId, skillIds, now],
    );
    await m.query(
      `UPDATE employee_skill_progress SET deleted_at = $3, updated_at = $3
        WHERE store_id = $1 AND skill_id = ANY($2::uuid[]) AND deleted_at IS NULL AND status <> $4`,
      [storeId, skillIds, now, SkillProgressStatus.ACHIEVED],
    );
  }

  private async employedMembers(m: EntityManager, storeId: string) {
    const rows: Array<{
      profile_id: string;
      department_id: string | null;
      store_role_id: string | null;
      full_name: string | null;
      avatar: string | null;
    }> = await m.query(
      `SELECT p.id AS profile_id, p.department_id, p.store_role_id, a.full_name, a.avatar
         FROM employee_profiles p
         JOIN accounts a ON a.id = p.account_id
        WHERE p.store_id = $1 AND p.deleted_at IS NULL AND p.employment_status = ANY($2)
        ORDER BY a.full_name NULLS LAST, p.created_at`,
      [storeId, EMPLOYED_STATUSES],
    );
    return rows.map((r) => ({
      departmentId: r.department_id,
      positionId: r.store_role_id,
      member: { profileId: r.profile_id, name: r.full_name ?? '', avatar: r.avatar ?? null },
    }));
  }

  /**
   * Số lượt đạt từng kỹ năng, gồm cả người đã nghỉ: cùng cách đếm với quy tắc
   * chặn xoá (D10 giữ lịch sử của mọi người), để màn hình và lệnh xoá nói một.
   */
  private async achievedCounts(m: EntityManager, storeId: string) {
    const rows: Array<{ skill_id: string; n: number }> = await m.query(
      `SELECT g.skill_id, count(*)::int AS n
         FROM employee_skill_progress g
        WHERE g.store_id = $1 AND g.deleted_at IS NULL AND g.status = $2
        GROUP BY g.skill_id`,
      [storeId, SkillProgressStatus.ACHIEVED],
    );
    return new Map(rows.map((r) => [r.skill_id, Number(r.n)]));
  }

  private async logChange(
    m: EntityManager,
    storeId: string,
    actorAccountId: string | null,
    entity: CareerSubject,
    change: 'created' | 'updated' | 'deleted' | 'duplicated' | 'deactivated',
    target: { id: string; name: string },
  ) {
    if (!this.activityLogService) return;
    await this.activityLogService.record(m, {
      storeId,
      actorAccountId,
      action: ACTIVITY_ACTIONS.CAREER_STRUCTURE_CHANGED,
      resourceType: 'career_structure',
      resourceId: target.id,
      params: { careerEntity: entity, change, targetName: target.name },
      idempotencyKey: null,
    });
  }
}

