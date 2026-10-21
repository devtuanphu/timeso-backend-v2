import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { ActivityLogService } from '../activity-log.service';
import { ACTIVITY_ACTIONS } from '../activity-log.summary';
import {
  CriteriaSnapshotItem,
  EmployeeCareerEvent,
} from '../entities/employee-career-event.entity';
import {
  EMPLOYED_STATUSES,
  EmployeeProfile,
  isEmployedStatus,
} from '../entities/employee-profile.entity';
import { EmployeeSkillEvaluation } from '../entities/employee-skill-evaluation.entity';
import {
  EmployeeSkillProgress,
  SkillProgressStatus,
} from '../entities/employee-skill-progress.entity';
import { SkillConfirmation, StoreSkill } from '../entities/store-skill.entity';
import {
  CAREER_ERRORS,
  CAREER_FORCE_NOTE_MIN,
} from './career.constants';
import {
  CareerEvaluationService,
  CareerGraph,
  MeasuredRequirement,
  PromotionTarget,
  SkillState,
} from './career-evaluation.service';
import { assertCareerV2, isUniqueViolation, lockCareerStore } from './career-store';

const snapshotOf = (items: MeasuredRequirement[]): CriteriaSnapshotItem[] =>
  items.map((i) => ({
    label: i.label,
    kind: 'v2',
    code: i.code,
    operator: 'gte',
    target: i.target,
    current: i.current,
    met: i.met,
    isRequired: true,
  }));

/**
 * Một clientRequestId chỉ đại diện cho MỘT thao tác: gửi lại cùng mã cho thao
 * tác / đích khác là lỗi của client, trả 409 thay vì trả nhầm kết quả cũ.
 */
const requestReused = () =>
  new ConflictException({
    code: 'CAREER_REQUEST_REUSED',
    message: 'Mã yêu cầu đã dùng cho một thao tác khác',
  });

const trimNote = (note: string | null | undefined) => {
  const text = typeof note === 'string' ? note.trim() : '';
  return text ? text : null;
};

/** Ngoại lệ (chưa đủ điều kiện) phải có lý do. */
const assertForceNote = (force: boolean | undefined, note: string | null) => {
  if (force && (!note || note.length < CAREER_FORCE_NOTE_MIN)) {
    throw new BadRequestException({
      code: CAREER_ERRORS.NOTE_REQUIRED,
      message: 'Duyệt ngoại lệ cần ghi chú lý do',
    });
  }
};

interface Notice {
  accountId: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
}

/**
 * Các thao tác ghi tiến trình của nhân viên trên lộ trình v2: lên vị trí / bộ
 * phận, chấm kỹ năng, xác nhận đạt kỹ năng, tự đạt kỹ năng "auto".
 *
 * Khoá: dòng cài đặt cửa hàng FOR SHARE (không chen vào giữa một lần sửa cấu
 * trúc, ví dụ xoá đúng vị trí đang được duyệt lên), rồi hồ sơ FOR UPDATE (hai
 * lần bấm duyệt gần nhau không ghi hai sự kiện). Gửi lặp cùng clientRequestId
 * được nhận ra SAU khi đã khoá, và chỗ chạy song song thật sự bị unique index
 * chặn (23505) → trả lại kết quả của lần trước.
 *
 * Thông báo gửi sau khi commit: gửi bên trong thì một lần duyệt bị rollback
 * vẫn kịp đẩy thông báo cho một việc không xảy ra.
 */
@Injectable()
export class CareerProgressService {
  private readonly logger = new Logger(CareerProgressService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly evaluation: CareerEvaluationService,
    private readonly notificationsService: NotificationsService,
    @Optional() private readonly activityLogService?: ActivityLogService,
  ) {}

  // -------------------------------------------------------------------------
  // Lên vị trí / bộ phận
  // -------------------------------------------------------------------------

  async promote(
    profileId: string,
    dto: {
      toPositionId?: string;
      toDepartmentId?: string;
      note?: string | null;
      force?: boolean;
      clientRequestId: string;
    },
    actorAccountId: string | null,
  ) {
    if (!!dto.toPositionId === !!dto.toDepartmentId) {
      throw new BadRequestException('Chọn đúng một vị trí hoặc bộ phận đích');
    }
    const note = trimNote(dto.note);
    assertForceNote(dto.force, note);

    const run = () =>
      this.dataSource.transaction(async (m) => {
        const { profile, graph } = await this.lockProfile(m, profileId);
        const prior = await this.priorEvent(m, profile.id, dto.clientRequestId);
        if (prior) {
          this.assertSamePromotion(prior, dto);
          return { replayed: true as const, event: prior, target: null, notice: null };
        }
        this.assertEmployed(profile);

        let target: PromotionTarget;
        const ctx = this.evaluation.context(m, profile);
        let toPositionId: string | null;
        let toDepartmentId: string;
        if (dto.toPositionId) {
          const position = graph.positions.get(dto.toPositionId);
          if (!position || position.rank === null || !position.departmentId) {
            throw new NotFoundException('Không tìm thấy vị trí');
          }
          if (profile.storeRoleId === position.id) {
            throw new BadRequestException({
              code: CAREER_ERRORS.ALREADY_IN_POSITION,
              message: 'Nhân viên đang ở vị trí này',
            });
          }
          target = await this.evaluation.evaluatePosition(ctx, graph, position);
          toPositionId = position.id;
          toDepartmentId = position.departmentId;
        } else {
          const department = graph.departments.get(dto.toDepartmentId as string);
          if (!department || department.isSystem) throw new NotFoundException('Không tìm thấy bộ phận');
          // Bộ phận có vị trí thì vào vị trí thấp nhất của nó.
          const entry = this.evaluation.positionsOf(graph, department.id)[0];
          if (entry) {
            if (profile.storeRoleId === entry.id) {
              throw new BadRequestException({
                code: CAREER_ERRORS.ALREADY_IN_POSITION,
                message: 'Nhân viên đang ở vị trí này',
              });
            }
            target = await this.evaluation.evaluatePosition(ctx, graph, entry);
            toPositionId = entry.id;
          } else {
            if (profile.departmentId === department.id) {
              throw new BadRequestException({
                code: CAREER_ERRORS.ALREADY_IN_POSITION,
                message: 'Nhân viên đã thuộc bộ phận này',
              });
            }
            target = await this.evaluation.evaluateDepartment(ctx, graph, department);
            toPositionId = null;
          }
          toDepartmentId = department.id;
        }

        if (!target.passed && !dto.force) {
          throw new BadRequestException({
            code: CAREER_ERRORS.CRITERIA_NOT_MET,
            message: target.adjacent
              ? 'Nhân viên chưa đủ điều kiện'
              : 'Đây không phải bước kế tiếp trên lộ trình của nhân viên',
            adjacent: target.adjacent,
            items: target.items,
          });
        }

        const fromPositionId = profile.storeRoleId ?? null;
        const fromDepartmentId = profile.departmentId ?? null;
        await m.update(
          EmployeeProfile,
          { id: profile.id },
          { storeRoleId: toPositionId as any, departmentId: toDepartmentId },
        );

        const now = new Date();
        const snapshot = snapshotOf(target.items);
        const departmentChanged = fromDepartmentId !== toDepartmentId;
        let event: EmployeeCareerEvent | null = null;
        if (departmentChanged) {
          event = await m.save(
            EmployeeCareerEvent,
            m.create(EmployeeCareerEvent, {
              employeeProfileId: profile.id,
              ladderId: null,
              toRungId: null,
              subjectType: 'department',
              fromTargetId: fromDepartmentId,
              toTargetId: toDepartmentId,
              effectiveAt: now,
              decidedByAccountId: actorAccountId,
              criteriaSnapshot: toPositionId ? null : snapshot,
              note,
              clientRequestId: toPositionId ? null : dto.clientRequestId,
            }),
          );
        }
        if (toPositionId) {
          event = await m.save(
            EmployeeCareerEvent,
            m.create(EmployeeCareerEvent, {
              employeeProfileId: profile.id,
              ladderId: null,
              toRungId: null,
              subjectType: 'position',
              fromTargetId: fromPositionId,
              toTargetId: toPositionId,
              effectiveAt: now,
              decidedByAccountId: actorAccountId,
              criteriaSnapshot: snapshot,
              note,
              clientRequestId: dto.clientRequestId,
            }),
          );
        }
        const saved = event as EmployeeCareerEvent;

        if (this.activityLogService) {
          await this.activityLogService.record(m, {
            storeId: profile.storeId,
            actorAccountId,
            subjectEmployeeProfileId: profile.id,
            action: ACTIVITY_ACTIONS.CAREER_ADVANCED,
            resourceType: 'career_event',
            resourceId: saved.id,
            params: { ladderName: target.departmentName, rungName: target.name },
            idempotencyKey: `${ACTIVITY_ACTIONS.CAREER_ADVANCED}:${saved.id}`,
          });
        }

        const notice: Notice = {
          accountId: profile.accountId,
          title: toPositionId ? 'Bạn đã lên vị trí mới' : 'Bạn đã chuyển sang bộ phận mới',
          content: toPositionId ? `${target.departmentName}: ${target.name}` : target.name,
          metadata: { profileId: profile.id, subjectType: saved.subjectType, targetId: saved.toTargetId },
        };
        return { replayed: false as const, event: saved, target, notice };
      });

    const result = await this.withReplay(run, async () => {
      const replay = await this.replayEvent(profileId, dto.clientRequestId);
      this.assertSamePromotion(replay.event, dto);
      return replay;
    });
    await this.notify(result.notice);
    return {
      replayed: result.replayed,
      event: this.eventView(result.event),
      evaluation: result.target
        ? { passed: result.target.passed, progress: result.target.progress, items: result.target.items }
        : null,
    };
  }

  // -------------------------------------------------------------------------
  // Chuyển bộ phận
  // -------------------------------------------------------------------------

  /**
   * Chủ cửa hàng chuyển ngang một nhân viên sang bộ phận khác — không phải
   * thăng tiến nên không xét điều kiện / tính kề. Vị trí đích tuỳ chọn (phải
   * thuộc bộ phận đích); bỏ trống thì vào bộ phận, chưa xếp vị trí.
   *
   * Tiến độ kỹ năng của bộ phận cũ được giữ nguyên làm lịch sử; kỹ năng của
   * bộ phận mới mở khoá tính từ lúc chuyển (mốc là sự kiện bộ phận ghi ở đây).
   */
  async transfer(
    profileId: string,
    dto: {
      toDepartmentId: string;
      toPositionId?: string | null;
      note?: string | null;
      clientRequestId: string;
    },
    actorAccountId: string | null,
  ) {
    const note = trimNote(dto.note);
    const toPositionId = dto.toPositionId ?? null;

    const run = () =>
      this.dataSource.transaction(async (m) => {
        const { profile, graph } = await this.lockProfile(m, profileId);
        const prior = await this.priorEvent(m, profile.id, dto.clientRequestId);
        if (prior) {
          await this.assertSameTransfer(m, prior, dto.toDepartmentId, toPositionId);
          return { replayed: true as const, event: prior, notice: null };
        }
        this.assertEmployed(profile);

        const department = graph.departments.get(dto.toDepartmentId);
        if (!department || department.isSystem) throw new NotFoundException('Không tìm thấy bộ phận');
        if (profile.departmentId === department.id) {
          throw new BadRequestException({
            code: CAREER_ERRORS.ALREADY_IN_POSITION,
            message: 'Nhân viên đã thuộc bộ phận này',
          });
        }
        let positionName: string | null = null;
        if (toPositionId) {
          const position = graph.positions.get(toPositionId);
          if (!position || position.rank === null || position.departmentId !== department.id) {
            throw new NotFoundException('Không tìm thấy vị trí trong bộ phận này');
          }
          positionName = position.name;
        }

        const fromDepartmentId = profile.departmentId ?? null;
        const fromPositionId = profile.storeRoleId ?? null;
        await m.update(
          EmployeeProfile,
          { id: profile.id },
          { storeRoleId: toPositionId as any, departmentId: department.id },
        );

        // Sự kiện bộ phận là mốc "vào bộ phận" (mở khoá kỹ năng), sự kiện vị
        // trí là mốc cộng dồn điều kiện vị trí. Rời vị trí mà không vào vị trí
        // mới thì không có sự kiện vị trí (ck_employee_career_events_shape bắt
        // buộc to_target_id); mốc vào vị trí luôn lấy sự kiện gần nhất của
        // đúng vị trí hiện tại nên không cần. Mã chống lặp gắn vào sự kiện bộ
        // phận (luôn có); criteriaSnapshot null phân biệt nó với một lần
        // promote() lên bộ phận (luôn có snapshot).
        const now = new Date();
        const base = {
          employeeProfileId: profile.id,
          ladderId: null,
          toRungId: null,
          effectiveAt: now,
          decidedByAccountId: actorAccountId,
          criteriaSnapshot: null,
          note,
        };
        const event = await m.save(
          EmployeeCareerEvent,
          m.create(EmployeeCareerEvent, {
            ...base,
            subjectType: 'department',
            fromTargetId: fromDepartmentId,
            toTargetId: department.id,
            clientRequestId: dto.clientRequestId,
          } as any),
        );
        if (toPositionId) {
          await m.save(
            EmployeeCareerEvent,
            m.create(EmployeeCareerEvent, {
              ...base,
              subjectType: 'position',
              fromTargetId: fromPositionId,
              toTargetId: toPositionId,
              clientRequestId: null,
            } as any),
          );
        }

        if (this.activityLogService) {
          await this.activityLogService.record(m, {
            storeId: profile.storeId,
            actorAccountId,
            subjectEmployeeProfileId: profile.id,
            action: ACTIVITY_ACTIONS.CAREER_TRANSFERRED,
            resourceType: 'career_event',
            resourceId: event.id,
            params: { departmentName: department.name, positionName },
            idempotencyKey: `${ACTIVITY_ACTIONS.CAREER_TRANSFERRED}:${event.id}`,
          });
        }

        const notice: Notice = {
          accountId: profile.accountId,
          title: 'Bạn đã chuyển sang bộ phận mới',
          content: positionName ? `${department.name}: ${positionName}` : department.name,
          metadata: { profileId: profile.id, subjectType: 'department', targetId: department.id },
        };
        return { replayed: false as const, event, notice };
      });

    const result = await this.withReplay(run, async () => {
      const replay = await this.replayEvent(profileId, dto.clientRequestId);
      await this.assertSameTransfer(
        this.dataSource.manager,
        replay.event,
        dto.toDepartmentId,
        toPositionId,
      );
      return replay;
    });
    await this.notify(result.notice);
    return { replayed: result.replayed, event: this.eventView(result.event) };
  }

  // -------------------------------------------------------------------------
  // Kỹ năng
  // -------------------------------------------------------------------------

  async recordEvaluation(
    profileId: string,
    skillId: string,
    dto: { result: 'pass' | 'fail'; note?: string | null; clientRequestId: string },
    actorAccountId: string | null,
  ) {
    const run = () =>
      this.dataSource.transaction(async (m) => {
        const { profile, graph } = await this.lockProfile(m, profileId);
        const prior = await m.findOne(EmployeeSkillEvaluation, {
          where: { storeId: profile.storeId, clientRequestId: dto.clientRequestId },
        });
        if (prior) {
          this.assertSameEvaluation(prior, profile.id, skillId, dto.result);
          return { replayed: true as const, evaluation: prior, notice: null };
        }
        this.assertEmployed(profile);
        const { skill, state } = await this.skillState(m, profile, graph, skillId);
        if (state.status === 'achieved') {
          throw new BadRequestException({
            code: CAREER_ERRORS.SKILL_ALREADY_ACHIEVED,
            message: 'Nhân viên đã đạt kỹ năng này',
          });
        }

        const evaluation = await m.save(
          EmployeeSkillEvaluation,
          m.create(EmployeeSkillEvaluation, {
            storeId: profile.storeId,
            employeeProfileId: profile.id,
            skillId: skill.id,
            result: dto.result as any,
            evaluatedByAccountId: actorAccountId,
            evaluatedAt: new Date(),
            note: trimNote(dto.note),
            clientRequestId: dto.clientRequestId,
          }),
        );

        // Kỹ năng "tự đạt": lần chấm này có thể vừa đủ điều kiện.
        let notice: Notice | null = null;
        if (skill.confirmation === SkillConfirmation.AUTO) {
          const fresh = await this.skillState(m, profile, graph, skillId);
          if (fresh.state.status === 'awaiting_confirmation') {
            notice = await this.achieve(m, profile, skill, fresh.state, null, null, null);
          }
        }
        return { replayed: false as const, evaluation, notice };
      });

    const result = await this.withReplay(run, async () => {
      // Cùng phạm vi với lần kiểm trong transaction (cửa hàng + mã).
      const evaluation = await this.dataSource.manager
        .getRepository(EmployeeSkillEvaluation)
        .createQueryBuilder('e')
        .innerJoin(EmployeeProfile, 'p', 'p.id = :profileId AND p.store_id = e.store_id', { profileId })
        .where('e.clientRequestId = :id', { id: dto.clientRequestId })
        .getOne();
      if (!evaluation) throw requestReused();
      this.assertSameEvaluation(evaluation, profileId, skillId, dto.result);
      return { replayed: true as const, evaluation, notice: null };
    });
    if (result.notice) await this.notify(result.notice);
    return {
      replayed: result.replayed,
      evaluation: {
        id: result.evaluation.id,
        result: result.evaluation.result,
        evaluatedAt: result.evaluation.evaluatedAt,
        note: result.evaluation.note,
      },
    };
  }

  async confirmSkill(
    profileId: string,
    skillId: string,
    dto: { note?: string | null; force?: boolean; clientRequestId: string },
    actorAccountId: string | null,
  ) {
    const note = trimNote(dto.note);
    assertForceNote(dto.force, note);

    const run = () =>
      this.dataSource.transaction(async (m) => {
        const { profile, graph } = await this.lockProfile(m, profileId);
        const prior = await this.priorEvent(m, profile.id, dto.clientRequestId);
        if (prior) {
          if (prior.subjectType !== 'skill' || prior.toTargetId !== skillId) throw requestReused();
          return { replayed: true as const, event: prior, target: null, notice: null };
        }
        this.assertEmployed(profile);
        const { skill, state } = await this.skillState(m, profile, graph, skillId);
        if (state.status === 'achieved') {
          throw new BadRequestException({
            code: CAREER_ERRORS.SKILL_ALREADY_ACHIEVED,
            message: 'Nhân viên đã đạt kỹ năng này',
          });
        }
        if (state.status === 'in_progress' && !dto.force) {
          throw new BadRequestException({
            code: CAREER_ERRORS.CRITERIA_NOT_MET,
            message: 'Nhân viên chưa đủ điều kiện đạt kỹ năng này',
            items: state.evaluation?.items ?? [],
          });
        }
        const notice = await this.achieve(m, profile, skill, state, actorAccountId, note, dto.clientRequestId);
        const event = await this.priorEvent(m, profile.id, dto.clientRequestId);
        return { replayed: false as const, event: event as EmployeeCareerEvent, target: null, notice };
      });

    const result = await this.withReplay(run, async () => {
      const replay = await this.replayEvent(profileId, dto.clientRequestId);
      if (replay.event.subjectType !== 'skill' || replay.event.toTargetId !== skillId) {
        throw requestReused();
      }
      return replay;
    });
    if (result.notice) await this.notify(result.notice);
    return { replayed: result.replayed, event: this.eventView(result.event) };
  }

  /**
   * Cron hằng ngày: kỹ năng "tự đạt" đã đủ điều kiện nhờ giờ thực hành (thứ
   * không có thao tác nào kích hoạt) được ghi đạt. Mỗi hồ sơ một transaction
   * có khoá; xét lại bên trong khoá.
   */
  async sweepAutoSkills(): Promise<{ checked: number; achieved: number }> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT p.id FROM employee_profiles p
         JOIN store_career_settings c ON c.store_id = p.store_id AND c.v2_enabled
        WHERE p.deleted_at IS NULL AND p.department_id IS NOT NULL
          AND p.employment_status = ANY($1)
          AND EXISTS (SELECT 1 FROM store_skills k
                       WHERE k.department_id = p.department_id AND k.deleted_at IS NULL
                         AND k.is_active AND k.confirmation = $2)`,
      [EMPLOYED_STATUSES, SkillConfirmation.AUTO],
    );
    let achieved = 0;
    for (const { id } of rows) {
      try {
        const notices = await this.dataSource.transaction(async (m) => {
          const { profile, graph } = await this.lockProfile(m, id);
          const out: Notice[] = [];
          // Đạt một kỹ năng có thể mở khoá và làm đủ ngay kỹ năng kế.
          for (let round = 0; round < 30; round += 1) {
            const states = await this.evaluation.skillStates(this.evaluation.context(m, profile), graph);
            const ready = states.find(
              (s) => s.status === 'awaiting_confirmation' && s.confirmation === SkillConfirmation.AUTO,
            );
            if (!ready) break;
            const skill = graph.skills.get(ready.skillId) as StoreSkill;
            out.push(await this.achieve(m, profile, skill, ready, null, null, null));
          }
          return out;
        });
        achieved += notices.length;
        for (const notice of notices) await this.notify(notice);
      } catch (error) {
        this.logger.warn(`Không xét được kỹ năng tự đạt cho hồ sơ ${id}: ${error}`);
      }
    }
    return { checked: rows.length, achieved };
  }

  // -------------------------------------------------------------------------
  // Nội bộ
  // -------------------------------------------------------------------------

  /** Khoá cửa hàng (chia sẻ) rồi khoá hồ sơ; nạp cấu trúc sau khi khoá. */
  private async lockProfile(m: EntityManager, profileId: string) {
    const head = await m.findOne(EmployeeProfile, {
      where: { id: profileId },
      select: ['id', 'storeId'],
    });
    if (!head) throw new NotFoundException('Không tìm thấy nhân viên');
    const setting = await lockCareerStore(m, head.storeId, 'share');
    assertCareerV2(setting);
    // FOR NO KEY UPDATE: tuần tự hoá các lần ghi lộ trình của một hồ sơ mà
    // không chặn các bảng có khoá ngoại tới hồ sơ (phân ca, chấm công).
    const profile = await m.findOne(EmployeeProfile, {
      where: { id: profileId },
      lock: { mode: 'for_no_key_update' },
    });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');
    const graph = await this.evaluation.loadGraph(m, profile.storeId);
    return { profile, graph };
  }

  private assertEmployed(profile: EmployeeProfile) {
    if (!isEmployedStatus(profile.employmentStatus)) {
      throw new BadRequestException({
        code: CAREER_ERRORS.EMPLOYEE_NOT_ACTIVE,
        message: 'Nhân viên không còn làm việc tại cửa hàng',
      });
    }
  }

  private async skillState(
    m: EntityManager,
    profile: EmployeeProfile,
    graph: CareerGraph,
    skillId: string,
  ): Promise<{ skill: StoreSkill; state: SkillState }> {
    const skill = graph.skills.get(skillId);
    if (!skill) throw new NotFoundException('Không tìm thấy kỹ năng');
    const states = await this.evaluation.skillStates(this.evaluation.context(m, profile), graph);
    const state = states.find((s) => s.skillId === skill.id);
    if (!state || state.status === 'locked') {
      throw new BadRequestException({
        code: CAREER_ERRORS.SKILL_LOCKED,
        message: state
          ? 'Kỹ năng chưa mở khoá: cần đạt các kỹ năng bắt buộc đứng trước'
          : 'Kỹ năng không thuộc bộ phận / vị trí hiện tại của nhân viên',
      });
    }
    return { skill, state };
  }

  /** Ghi đạt kỹ năng + sự kiện + activity log; trả thông báo để gửi sau commit. */
  private async achieve(
    m: EntityManager,
    profile: EmployeeProfile,
    skill: StoreSkill,
    state: SkillState,
    actorAccountId: string | null,
    note: string | null,
    clientRequestId: string | null,
  ): Promise<Notice> {
    const now = new Date();
    const snapshot = snapshotOf(state.evaluation?.items ?? []);
    const existing = await m.findOne(EmployeeSkillProgress, {
      where: { employeeProfileId: profile.id, skillId: skill.id },
    });
    if (existing) {
      await m.update(
        EmployeeSkillProgress,
        { id: existing.id },
        {
          status: SkillProgressStatus.ACHIEVED,
          unlockedAt: state.unlockedAt,
          achievedAt: now,
          confirmedByAccountId: actorAccountId,
          criteriaSnapshot: snapshot as any,
          note,
        },
      );
    } else {
      await m.save(
        EmployeeSkillProgress,
        m.create(EmployeeSkillProgress, {
          storeId: profile.storeId,
          employeeProfileId: profile.id,
          skillId: skill.id,
          status: SkillProgressStatus.ACHIEVED,
          unlockedAt: state.unlockedAt,
          achievedAt: now,
          confirmedByAccountId: actorAccountId,
          criteriaSnapshot: snapshot,
          note,
        }),
      );
    }
    const event = await m.save(
      EmployeeCareerEvent,
      m.create(EmployeeCareerEvent, {
        employeeProfileId: profile.id,
        ladderId: null,
        toRungId: null,
        subjectType: 'skill',
        fromTargetId: null,
        toTargetId: skill.id,
        effectiveAt: now,
        decidedByAccountId: actorAccountId,
        criteriaSnapshot: snapshot,
        note,
        clientRequestId,
      }),
    );
    if (this.activityLogService) {
      await this.activityLogService.record(m, {
        storeId: profile.storeId,
        actorAccountId,
        subjectEmployeeProfileId: profile.id,
        action: ACTIVITY_ACTIONS.CAREER_SKILL_ACHIEVED,
        resourceType: 'career_event',
        resourceId: event.id,
        params: { skillName: skill.name },
        idempotencyKey: `${ACTIVITY_ACTIONS.CAREER_SKILL_ACHIEVED}:${event.id}`,
      });
    }
    return {
      accountId: profile.accountId,
      title: 'Bạn đã đạt kỹ năng mới',
      content: skill.name,
      metadata: { profileId: profile.id, subjectType: 'skill', targetId: skill.id },
    };
  }

  /** Sự kiện cũ phải là lần lên đúng đích này (vị trí, hoặc bộ phận không vị trí). */
  private assertSamePromotion(
    event: EmployeeCareerEvent,
    dto: { toPositionId?: string; toDepartmentId?: string },
  ) {
    // Sự kiện bộ phận của transfer() không có snapshot: mã đó không phải của
    // một lần promote.
    const same = dto.toPositionId
      ? event.subjectType === 'position' && event.toTargetId === dto.toPositionId
      : (event.subjectType === 'department' &&
          event.criteriaSnapshot !== null &&
          event.toTargetId === dto.toDepartmentId) ||
        // Lên bộ phận có vị trí = vào vị trí thấp nhất của nó.
        event.subjectType === 'position';
    if (!same) throw requestReused();
  }

  /**
   * Sự kiện cũ phải là đúng lần chuyển này: sự kiện bộ phận không snapshot
   * (promote luôn có) tới đúng bộ phận, và vị trí ghi cùng lúc khớp vị trí đích.
   */
  private async assertSameTransfer(
    m: EntityManager,
    event: EmployeeCareerEvent,
    toDepartmentId: string,
    toPositionId: string | null,
  ) {
    if (
      event.subjectType !== 'department' ||
      event.criteriaSnapshot !== null ||
      event.toTargetId !== toDepartmentId
    ) {
      throw requestReused();
    }
    const [position]: Array<{ to_target_id: string | null }> = await m.query(
      `SELECT to_target_id FROM employee_career_events
        WHERE employee_profile_id = $1 AND subject_type = 'position'
          AND effective_at = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [event.employeeProfileId, event.effectiveAt],
    );
    if ((position?.to_target_id ?? null) !== toPositionId) throw requestReused();
  }

  private assertSameEvaluation(
    evaluation: EmployeeSkillEvaluation,
    profileId: string,
    skillId: string,
    result: string,
  ) {
    if (
      evaluation.employeeProfileId !== profileId ||
      evaluation.skillId !== skillId ||
      String(evaluation.result) !== result
    ) {
      throw requestReused();
    }
  }

  private priorEvent(m: EntityManager, profileId: string, clientRequestId: string) {
    return m.findOne(EmployeeCareerEvent, {
      where: { employeeProfileId: profileId, clientRequestId },
    });
  }

  private async replayEvent(profileId: string, clientRequestId: string) {
    const event = await this.priorEvent(this.dataSource.manager, profileId, clientRequestId);
    if (!event) throw new NotFoundException('Không tìm thấy kết quả lần gửi trước');
    return { replayed: true as const, event, target: null, notice: null };
  }

  /**
   * Hai request cùng clientRequestId chạy song song: cái sau va unique index
   * khi cái trước vừa commit → đọc lại và trả kết quả của cái trước.
   */
  private async withReplay<T>(run: () => Promise<T>, replay: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (
        isUniqueViolation(error, 'ux_employee_career_events_request') ||
        isUniqueViolation(error, 'ux_employee_skill_evaluations_request')
      ) {
        return replay();
      }
      throw error;
    }
  }

  private eventView(event: EmployeeCareerEvent) {
    return {
      id: event.id,
      subjectType: event.subjectType,
      fromTargetId: event.fromTargetId,
      toTargetId: event.toTargetId,
      effectiveAt: event.effectiveAt,
      note: event.note,
    };
  }

  private async notify(notice: Notice | null | undefined) {
    if (!notice) return;
    try {
      await this.notificationsService.create({
        accountId: notice.accountId,
        // Như lộ trình cũ: dùng lại SYSTEM, chi tiết nằm ở tiêu đề và metadata
        // (thêm giá trị enum cần ALTER TYPE ngoài transaction).
        type: NotificationType.SYSTEM,
        title: notice.title,
        content: notice.content,
        // App nhân viên: trang chủ có mục Lộ trình.
        actionUrl: '/',
        metadata: notice.metadata,
      } as any);
    } catch (error) {
      // Thông báo hỏng không được làm hỏng việc đã ghi.
      this.logger.warn(`Không gửi được thông báo lộ trình: ${error}`);
    }
  }
}
