import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { stintFloor } from './employment-stint.utils';

import { StoreLadder, LadderDimension } from './entities/store-ladder.entity';
import {
  StoreLadderRung,
  RungApproval,
} from './entities/store-ladder-rung.entity';
import { StoreLadderEdge } from './entities/store-ladder-edge.entity';
import {
  StoreRungCriteria,
  CriteriaKind,
  CriteriaCode,
  CriteriaOperator,
} from './entities/store-rung-criteria.entity';
import {
  EmployeeCareerEvent,
  CriteriaSnapshotItem,
} from './entities/employee-career-event.entity';
import { EmployeeCapabilityEntry } from './entities/employee-capability-entry.entity';
import {
  EmployeeProfile,
  EmploymentStatus,
  isEmployedStatus,
} from './entities/employee-profile.entity';
import { StoreEmployeeType } from './entities/store-employee-type.entity';
import { StoreRole } from './entities/store-role.entity';
import { StoreSkill } from './entities/store-skill.entity';
import { EmployeeMonthlySummary } from './entities/employee-monthly-summary.entity';
import { StoreProbationSetting } from './entities/store-probation-setting.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { computeProbationEndsAt } from './career-ladder.lifecycle';
import { KpiTask } from './entities/kpi-task.entity';
import { KpiStatus } from './entities/employee-kpi.entity';
import { vnDateString } from '../../common/utils/vn-calendar';
import { NotificationType } from '../notifications/entities/notification.entity';

/**
 * Cạnh cần gỡ và cạnh cần nối khi gỡ một bậc khỏi lộ trình.
 *
 * Mọi bậc trước được nối thẳng sang mọi bậc sau, để A→B→C thành A→C khi gỡ B,
 * và nếu B là điểm vào thì các bậc sau của nó thành điểm vào. Không tạo được
 * vòng lặp, vì mỗi đường mới vốn đã tồn tại qua B.
 */
export function planRungRemoval(
  edges: Array<{ id: string; fromRungId: string | null; toRungId: string }>,
  rungId: string,
): {
  detachEdgeIds: string[];
  bridges: Array<{ fromRungId: string | null; toRungId: string }>;
} {
  const incoming = edges.filter((e) => e.toRungId === rungId);
  const outgoing = edges.filter(
    (e) => e.fromRungId === rungId && e.toRungId !== rungId,
  );
  const kept = edges
    .filter((e) => e.toRungId !== rungId && e.fromRungId !== rungId)
    .map((e) => ({ fromRungId: e.fromRungId, toRungId: e.toRungId }));

  const bridges: Array<{ fromRungId: string | null; toRungId: string }> = [];
  for (const inEdge of incoming) {
    for (const outEdge of outgoing) {
      if (inEdge.fromRungId === outEdge.toRungId) continue;
      const pair = {
        fromRungId: inEdge.fromRungId,
        toRungId: outEdge.toRungId,
      };
      const duplicate = [...kept, ...bridges].some(
        (e) => e.fromRungId === pair.fromRungId && e.toRungId === pair.toRungId,
      );
      if (!duplicate) bridges.push(pair);
    }
  }

  return {
    detachEdgeIds: edges
      .filter((e) => e.toRungId === rungId || e.fromRungId === rungId)
      .map((e) => e.id),
    bridges,
  };
}

/** Một điều kiện sau khi đã đo, đủ để hiển thị lẫn để quyết định. */
export interface EvaluatedCriteria {
  id: string;
  label: string;
  kind: CriteriaKind;
  code: string | null;
  operator: CriteriaOperator | null;
  target: number | null;
  current: number | null;
  unit: string | null;
  met: boolean;
  isRequired: boolean;
}

export interface RungEvaluation {
  rungId: string;
  passed: boolean;
  /** 0–100, tính trên số điều kiện bắt buộc đã đạt. */
  progress: number;
  items: EvaluatedCriteria[];
}

/**
 * Lộ trình thăng tiến dùng chung cho mọi tác nhân.
 *
 * Trước đây có hai cơ chế rời nhau cho cùng một khái niệm: thăng vị trí đọc
 * bốn cột `req_*` trên danh mục loại nhân viên, còn thử việc thì chỉ có một số
 * ngày trong `store_probation_settings` và không có máy đánh giá nào. Ở đây cả
 * hai là cùng một thứ: một bậc, một bộ điều kiện, một phép đo.
 *
 * Service này cố ý tách khỏi StoresService. Constructor của StoresService có
 * hơn bảy mươi tham số và mọi spec đang mock nó, nên thêm một repository vào
 * đó là hỏng hàng loạt test không liên quan.
 */
@Injectable()
export class CareerLadderService {
  private readonly logger = new Logger(CareerLadderService.name);

  /** Giới hạn cho một lần chấm điểm năng lực. */
  static readonly MAX_POINTS_PER_ENTRY = 1000;

  constructor(
    @InjectRepository(StoreLadder)
    private readonly ladderRepository: Repository<StoreLadder>,
    @InjectRepository(StoreLadderRung)
    private readonly rungRepository: Repository<StoreLadderRung>,
    @InjectRepository(StoreLadderEdge)
    private readonly edgeRepository: Repository<StoreLadderEdge>,
    @InjectRepository(StoreRungCriteria)
    private readonly criteriaRepository: Repository<StoreRungCriteria>,
    @InjectRepository(EmployeeCareerEvent)
    private readonly eventRepository: Repository<EmployeeCareerEvent>,
    @InjectRepository(EmployeeCapabilityEntry)
    private readonly capabilityRepository: Repository<EmployeeCapabilityEntry>,
    @InjectRepository(EmployeeProfile)
    private readonly profileRepository: Repository<EmployeeProfile>,
    @InjectRepository(EmployeeMonthlySummary)
    private readonly summaryRepository: Repository<EmployeeMonthlySummary>,
    @InjectRepository(StoreProbationSetting)
    private readonly probationSettingRepository: Repository<StoreProbationSetting>,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------------
  // Danh mục theo tác nhân
  // ---------------------------------------------------------------------

  /**
   * Bảng danh mục ứng với một tác nhân. Đây là toàn bộ phép map giữa lộ trình
   * và thứ nó nâng: `dimension` chọn bảng, `targetId` chọn dòng.
   */
  private catalogEntity(dimension: LadderDimension) {
    switch (dimension) {
      case LadderDimension.EMPLOYMENT_TYPE:
        return StoreEmployeeType;
      case LadderDimension.POSITION:
        return StoreRole;
      case LadderDimension.SKILL:
        return StoreSkill;
      default:
        throw new BadRequestException(`Tác nhân không hợp lệ: ${dimension}`);
    }
  }

  /** Trường trên hồ sơ mà tác nhân này ghi vào. */
  private profileColumn(
    dimension: LadderDimension,
  ): 'employeeTypeId' | 'storeRoleId' | 'skillId' {
    switch (dimension) {
      case LadderDimension.EMPLOYMENT_TYPE:
        return 'employeeTypeId';
      case LadderDimension.POSITION:
        return 'storeRoleId';
      case LadderDimension.SKILL:
        return 'skillId';
      default:
        throw new BadRequestException(`Tác nhân không hợp lệ: ${dimension}`);
    }
  }

  /**
   * Bậc trỏ vào danh mục bằng uuid không có khoá ngoại, vì bảng đích đổi theo
   * tác nhân. Ràng buộc đó được giữ ở đây thay cho cơ sở dữ liệu.
   */
  private async assertTargetExists(
    ladder: StoreLadder,
    targetId: string,
    manager?: EntityManager,
  ) {
    const repo = manager
      ? manager.getRepository(this.catalogEntity(ladder.dimension))
      : this.dataSource.getRepository(this.catalogEntity(ladder.dimension));
    const found = await repo.findOne({
      where: { id: targetId, storeId: ladder.storeId } as any,
    });
    if (!found) {
      throw new NotFoundException(
        'Giá trị được chọn không thuộc danh mục của cửa hàng này',
      );
    }
    return found as { id: string; name: string };
  }

  /** Tên hiển thị của các bậc, tra một lượt theo tác nhân. */
  private async targetNames(
    dimension: LadderDimension,
    targetIds: string[],
    withDeleted = false,
  ): Promise<Map<string, string>> {
    if (targetIds.length === 0) return new Map();
    const rows = await this.dataSource
      .getRepository(this.catalogEntity(dimension))
      .find({ where: { id: In(targetIds) } as any, withDeleted });
    return new Map(
      (rows as any[]).map((row) => [row.id as string, row.name as string]),
    );
  }

  // ---------------------------------------------------------------------
  // Đọc lộ trình
  // ---------------------------------------------------------------------

  async getLadders(storeId: string) {
    const ladders = await this.ladderRepository.find({
      where: { storeId, isActive: true },
      order: { dimension: 'ASC' },
    });

    return Promise.all(ladders.map((ladder) => this.describeLadder(ladder)));
  }

  async getLadder(storeId: string, ladderId: string) {
    const ladder = await this.ladderRepository.findOne({
      where: { id: ladderId, storeId },
    });
    if (!ladder) throw new NotFoundException('Không tìm thấy lộ trình');
    return this.describeLadder(ladder);
  }

  /** Lộ trình kèm bậc, cạnh, điều kiện và tên hiển thị của từng bậc. */
  private async describeLadder(ladder: StoreLadder) {
    const rungs = await this.rungRepository.find({
      where: { ladderId: ladder.id },
      order: { level: 'ASC' },
    });
    const rungIds = rungs.map((r) => r.id);

    const [criteria, edges, names] = await Promise.all([
      rungIds.length
        ? this.criteriaRepository.find({
            where: { rungId: In(rungIds) },
            order: { sortOrder: 'ASC' },
          })
        : Promise.resolve([] as StoreRungCriteria[]),
      this.edgeRepository.find({ where: { ladderId: ladder.id } }),
      this.targetNames(
        ladder.dimension,
        rungs.map((r) => r.targetId),
      ),
    ]);

    // Cạnh trỏ tới bậc đã gỡ trước khi deleteRung biết dọn cạnh vẫn có thể còn
    // trong dữ liệu; không được đưa chúng ra app.
    const liveIds = new Set(rungIds);

    return {
      id: ladder.id,
      storeId: ladder.storeId,
      dimension: ladder.dimension,
      name: ladder.name,
      isActive: ladder.isActive,
      rungs: rungs.map((rung) => ({
        id: rung.id,
        level: rung.level,
        targetId: rung.targetId,
        targetName: names.get(rung.targetId) ?? null,
        approval: rung.approval,
        suggestedSalary:
          rung.suggestedSalary === null ? null : Number(rung.suggestedSalary),
        resetsLadderId: rung.resetsLadderId,
        // Bậc đi tới được từ bậc này. Đây là chỗ mô tả phân nhánh; `level` chỉ
        // để xếp thứ tự hiển thị.
        nextRungIds: edges
          .filter((e) => e.fromRungId === rung.id && liveIds.has(e.toRungId))
          .map((e) => e.toRungId),
        isEntry: edges.some(
          (e) => e.fromRungId === null && e.toRungId === rung.id,
        ),
        criteria: criteria
          .filter((c) => c.rungId === rung.id)
          .map((c) => this.describeCriteria(c)),
      })),
    };
  }

  private describeCriteria(c: StoreRungCriteria) {
    return {
      id: c.id,
      kind: c.kind,
      code: c.code,
      operator: c.operator,
      value: c.value === null ? null : Number(c.value),
      label: c.label,
      unit: c.unit,
      isRequired: c.isRequired,
      sortOrder: c.sortOrder,
    };
  }

  /** Cửa hàng của một hồ sơ, để controller kiểm được người gọi có phải chủ. */
  async storeIdOfProfile(profileId: string): Promise<string> {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      select: ['id', 'storeId'],
    });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');
    return profile.storeId;
  }

  // ---------------------------------------------------------------------
  // Chủ cửa hàng soạn lộ trình
  // ---------------------------------------------------------------------

  async createLadder(
    storeId: string,
    data: { dimension: LadderDimension; name: string },
  ) {
    if (!Object.values(LadderDimension).includes(data?.dimension)) {
      throw new BadRequestException('Tác nhân không hợp lệ');
    }
    if (!data?.name?.trim()) {
      throw new BadRequestException('Lộ trình cần có tên');
    }
    const existing = await this.ladderRepository.findOne({
      where: { storeId, dimension: data.dimension },
    });
    if (existing) {
      throw new BadRequestException('Cửa hàng đã có lộ trình cho tác nhân này');
    }
    const ladder = await this.ladderRepository.save(
      this.ladderRepository.create({
        storeId,
        dimension: data.dimension,
        name: data.name,
        isActive: true,
      }),
    );
    return this.describeLadder(ladder);
  }

  /** Nạp lộ trình và khẳng định nó thuộc cửa hàng đang gọi. */
  private async ownedLadder(storeId: string, ladderId: string) {
    const ladder = await this.ladderRepository.findOne({
      where: { id: ladderId, storeId },
    });
    if (!ladder) throw new NotFoundException('Không tìm thấy lộ trình');
    return ladder;
  }

  /**
   * Nạp bậc và khẳng định nó thuộc cửa hàng đang gọi.
   *
   * Bậc được định địa chỉ bằng id riêng nhưng route luôn mang theo id cửa
   * hàng; kiểm ở đây là thứ chặn một chủ sửa bậc của cửa hàng khác.
   */
  private async ownedRung(storeId: string, rungId: string) {
    const rung = await this.rungRepository.findOne({ where: { id: rungId } });
    if (!rung) throw new NotFoundException('Không tìm thấy bậc');
    const ladder = await this.ownedLadder(storeId, rung.ladderId);
    return { rung, ladder };
  }

  async createRung(
    storeId: string,
    ladderId: string,
    data: {
      targetId: string;
      level?: number;
      approval?: RungApproval;
      suggestedSalary?: number | null;
      resetsLadderId?: string | null;
      /** Bậc sẽ nối sang bậc mới. Thêm cạnh, không thay danh sách cạnh cũ. */
      fromRungIds?: string[];
    },
  ) {
    const ladder = await this.ownedLadder(storeId, ladderId);
    await this.assertTargetExists(ladder, data.targetId);

    const duplicate = await this.rungRepository.findOne({
      where: { ladderId, targetId: data.targetId },
    });
    if (duplicate) {
      throw new BadRequestException('Giá trị này đã là một bậc trên lộ trình');
    }

    if (data.resetsLadderId) {
      await this.ownedLadder(storeId, data.resetsLadderId);
    }

    const fromRungIds = [...new Set(data.fromRungIds ?? [])];
    if (fromRungIds.length) {
      const from = await this.rungRepository.find({
        where: { id: In(fromRungIds), ladderId },
      });
      if (from.length !== fromRungIds.length) {
        throw new BadRequestException(
          'Chỉ nối được từ các bậc trong cùng lộ trình',
        );
      }
    }

    // Tạo bậc và nối cạnh trong một transaction. Làm thành nhiều lần gọi từ app
    // thì hỏng giữa chừng sẽ để lại một bậc không ai đi tới được, và việc app
    // gửi lại cả danh sách cạnh của bậc trước sẽ xoá mất cạnh mà máy khác vừa
    // thêm.
    await this.dataSource.transaction(async (manager) => {
      const rung = await manager.save(
        StoreLadderRung,
        manager.create(StoreLadderRung, {
          ladderId,
          targetId: data.targetId,
          level: data.level ?? 0,
          approval: data.approval ?? RungApproval.OWNER,
          suggestedSalary: data.suggestedSalary ?? null,
          resetsLadderId: data.resetsLadderId ?? null,
        }),
      );

      for (const fromRungId of fromRungIds) {
        await manager.save(
          StoreLadderEdge,
          manager.create(StoreLadderEdge, {
            ladderId,
            fromRungId,
            toRungId: rung.id,
          }),
        );
      }

      // Lộ trình chưa có điểm vào còn sống thì bậc này thành điểm vào, nếu
      // không thì không ai bước chân vào được lộ trình.
      if (!(await this.hasLiveEntry(manager, ladderId))) {
        await manager.save(
          StoreLadderEdge,
          manager.create(StoreLadderEdge, {
            ladderId,
            fromRungId: null,
            toRungId: rung.id,
          }),
        );
      }
    });

    return this.describeLadder(ladder);
  }

  /** Có cạnh điểm-vào nào trỏ tới một bậc chưa bị gỡ không. */
  private async hasLiveEntry(manager: EntityManager, ladderId: string) {
    const entries = await manager.find(StoreLadderEdge, {
      where: { ladderId, fromRungId: IsNull() },
    });
    if (entries.length === 0) return false;
    const alive = await manager.count(StoreLadderRung, {
      where: { id: In(entries.map((e) => e.toRungId)) },
    });
    return alive > 0;
  }

  async updateRung(
    storeId: string,
    rungId: string,
    data: Partial<{
      level: number;
      approval: RungApproval;
      suggestedSalary: number | null;
      resetsLadderId: string | null;
    }>,
  ) {
    const { rung, ladder } = await this.ownedRung(storeId, rungId);
    if (data.resetsLadderId) {
      await this.ownedLadder(storeId, data.resetsLadderId);
    }
    Object.assign(rung, {
      ...(data.level !== undefined ? { level: data.level } : {}),
      ...(data.approval !== undefined ? { approval: data.approval } : {}),
      ...(data.suggestedSalary !== undefined
        ? { suggestedSalary: data.suggestedSalary }
        : {}),
      ...(data.resetsLadderId !== undefined
        ? { resetsLadderId: data.resetsLadderId }
        : {}),
    });
    await this.rungRepository.save(rung);
    return this.describeLadder(ladder);
  }

  async deleteRung(storeId: string, rungId: string) {
    const { rung, ladder } = await this.ownedRung(storeId, rungId);

    // Xoá một bậc có người đang đứng sẽ làm lịch sử của họ trỏ vào khoảng
    // không, nên chặn lại và để chủ chuyển người đi trước.
    const holders = await this.profileRepository.count({
      where: {
        storeId,
        [this.profileColumn(ladder.dimension)]: rung.targetId,
      } as any,
    });
    if (holders > 0) {
      throw new BadRequestException({
        code: 'CAREER_RUNG_IN_USE',
        message: `Còn ${holders} nhân viên đang ở bậc này`,
        employeesAffected: holders,
      });
    }

    // Gỡ bậc giữa dãy không được làm đứt lộ trình. Bậc chỉ bị xoá mềm nên
    // ON DELETE CASCADE của cạnh không chạy; tự dọn cạnh ở đây, và nối thẳng
    // mọi bậc trước sang mọi bậc sau để A→B→C thành A→C khi gỡ B. Không tạo
    // được vòng lặp, vì đường A→C vốn đã tồn tại qua B.
    await this.dataSource.transaction(async (manager) => {
      const edges = await manager.find(StoreLadderEdge, {
        where: { ladderId: ladder.id },
      });
      const { detachEdgeIds, bridges } = planRungRemoval(edges, rung.id);

      if (detachEdgeIds.length) {
        await manager.delete(StoreLadderEdge, { id: In(detachEdgeIds) });
      }
      for (const bridge of bridges) {
        await manager.save(
          StoreLadderEdge,
          manager.create(StoreLadderEdge, { ladderId: ladder.id, ...bridge }),
        );
      }

      await manager.softRemove(StoreLadderRung, rung);
    });

    return this.describeLadder(ladder);
  }

  /**
   * Đặt lại toàn bộ điều kiện của một bậc.
   *
   * Thay cả bộ chứ không vá từng dòng: màn thiết lập gửi lên danh sách đầy đủ,
   * và việc so từng dòng để biết cái nào bị bỏ sẽ sinh ra trạng thái nửa vời
   * khi có lỗi giữa chừng.
   */
  async setRungCriteria(
    storeId: string,
    rungId: string,
    items: Array<{
      kind: CriteriaKind;
      code?: string | null;
      operator?: CriteriaOperator | null;
      value?: number | null;
      label: string;
      unit?: string | null;
      isRequired?: boolean;
    }>,
  ) {
    const { rung, ladder } = await this.ownedRung(storeId, rungId);

    for (const item of items) {
      if (item.kind === CriteriaKind.LADDER && item.code) {
        await this.ownedLadder(storeId, item.code);
      }
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(StoreRungCriteria, { rungId: rung.id });
      if (items.length === 0) return;
      await manager.save(
        StoreRungCriteria,
        items.map((item, index) =>
          manager.create(StoreRungCriteria, {
            rungId: rung.id,
            kind: item.kind,
            code: item.code ?? null,
            operator: item.operator ?? null,
            value: item.value ?? null,
            label: item.label,
            unit: item.unit ?? null,
            isRequired: item.isRequired ?? true,
            sortOrder: index,
          }),
        ),
      );
    });

    return this.describeLadder(ladder);
  }

  /**
   * Đặt lại các bậc đi tiếp được từ một bậc.
   *
   * Đây là cách khai phân nhánh trên điện thoại: mỗi bậc có một ô chọn nhiều
   * "bậc có thể lên tiếp", thay vì phải vẽ đồ thị.
   */
  async setRungNextRungs(
    storeId: string,
    rungId: string,
    nextRungIds: string[],
  ) {
    const { rung, ladder } = await this.ownedRung(storeId, rungId);

    const targets = nextRungIds.length
      ? await this.rungRepository.find({ where: { id: In(nextRungIds) } })
      : [];
    if (targets.length !== nextRungIds.length) {
      throw new NotFoundException('Có bậc không tồn tại');
    }
    if (targets.some((t) => t.ladderId !== ladder.id)) {
      throw new BadRequestException('Chỉ nối được các bậc trong cùng lộ trình');
    }
    if (nextRungIds.includes(rung.id)) {
      throw new BadRequestException('Bậc không thể nối vào chính nó');
    }

    const existing = await this.edgeRepository.find({
      where: { ladderId: ladder.id },
    });
    const proposed = existing
      .filter((e) => e.fromRungId !== rung.id)
      .map((e) => ({ from: e.fromRungId, to: e.toRungId }))
      .concat(nextRungIds.map((to) => ({ from: rung.id, to })));

    if (this.hasCycle(proposed)) {
      throw new BadRequestException(
        'Cấu hình này tạo thành vòng lặp trên lộ trình',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(StoreLadderEdge, {
        ladderId: ladder.id,
        fromRungId: rung.id,
      });
      if (nextRungIds.length === 0) return;
      await manager.save(
        StoreLadderEdge,
        nextRungIds.map((toRungId) =>
          manager.create(StoreLadderEdge, {
            ladderId: ladder.id,
            fromRungId: rung.id,
            toRungId,
          }),
        ),
      );
    });

    return this.describeLadder(ladder);
  }

  /**
   * Lộ trình phải là đồ thị không chu trình: một vòng lặp sẽ khiến nhân viên
   * quay lại bậc cũ mãi và khiến `days_in_rung` không bao giờ ổn định.
   */
  private hasCycle(edges: Array<{ from: string | null; to: string }>): boolean {
    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
      if (!e.from) continue;
      adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e.to]);
    }

    const VISITING = 1;
    const DONE = 2;
    const state = new Map<string, number>();

    const walk = (node: string): boolean => {
      const current = state.get(node);
      if (current === VISITING) return true;
      if (current === DONE) return false;
      state.set(node, VISITING);
      for (const next of adjacency.get(node) ?? []) {
        if (walk(next)) return true;
      }
      state.set(node, DONE);
      return false;
    };

    return [...adjacency.keys()].some((node) => walk(node));
  }

  // ---------------------------------------------------------------------
  // Vị trí hiện tại của nhân viên trên một lộ trình
  // ---------------------------------------------------------------------

  /**
   * Bậc nhân viên đang đứng, suy từ giá trị trên hồ sơ chứ không lưu riêng —
   * hồ sơ đã giữ giá trị, lịch sử giữ mốc thời gian, nên một bảng "bậc hiện
   * tại" sẽ là nguồn thứ ba có thể lệch với hai nguồn kia.
   */
  async currentRung(
    profile: EmployeeProfile,
    ladder: StoreLadder,
  ): Promise<StoreLadderRung | null> {
    const targetId = profile[this.profileColumn(ladder.dimension)];
    if (!targetId) return null;
    return this.rungRepository.findOne({
      where: { ladderId: ladder.id, targetId },
    });
  }

  /** Thời điểm vào bậc hiện tại — nguồn duy nhất cho điều kiện days_in_rung. */
  private async rungEnteredAt(
    profileId: string,
    ladderId: string,
  ): Promise<Date | null> {
    const latest = await this.eventRepository.findOne({
      where: { employeeProfileId: profileId, ladderId },
      order: { effectiveAt: 'DESC' },
    });
    return latest?.effectiveAt ?? null;
  }

  /** Các bậc đi tới được từ bậc hiện tại, kèm tiến độ của từng bậc. */
  /**
   * Chủ cửa hàng của hồ sơ, hoặc chính nhân viên đó khi còn đang làm.
   *
   * Các route lộ trình khác chỉ cho chủ. Route tóm tắt dành cho app nhân viên
   * cần cho chính người đó xem — nhưng không được cho đồng nghiệp xem, việc mà
   * guard "thuộc cửa hàng" vẫn cho qua.
   */
  async assertCanViewOwnCareer(profileId: string, accountId: string) {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      select: ['id', 'storeId', 'accountId', 'employmentStatus'],
    });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');

    const store = await this.dataSource.manager.query(
      'SELECT owner_account_id FROM stores WHERE id = $1 LIMIT 1',
      [profile.storeId],
    );
    if (store?.[0]?.owner_account_id === accountId) return profile;

    if (profile.accountId === accountId && isEmployedStatus(profile.employmentStatus)) {
      return profile;
    }
    throw new ForbiddenException('Bạn chỉ có thể xem lộ trình của chính mình');
  }

  /**
   * Tóm tắt lộ trình cho app nhân viên: mỗi lộ trình một dòng, gồm bậc đang
   * giữ và bậc kế tiếp gần nhất kèm tiến độ và điều kiện thật.
   *
   * Với lộ trình phân nhánh, bậc kế là bậc đi tới được có tiến độ cao nhất —
   * đó là bước nhân viên gần đạt nhất, thứ đáng hiện trên trang chủ.
   */
  async getCareerSummary(profileId: string) {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
    });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');

    const ladders = await this.ladderRepository.find({
      where: { storeId: profile.storeId, isActive: true },
      order: { dimension: 'ASC' },
    });

    const result: Array<{
      ladderId: string;
      ladderName: string;
      dimension: LadderDimension;
      currentName: string | null;
      next: {
        rungId: string;
        name: string | null;
        progress: number;
        passed: boolean;
        items: Array<{
          label: string;
          kind: string;
          met: boolean;
          isRequired: boolean;
        }>;
      } | null;
    }> = [];

    for (const ladder of ladders) {
      const current = await this.currentRung(profile, ladder);
      const currentNames = current
        ? await this.targetNames(ladder.dimension, [current.targetId])
        : new Map<string, string>();
      const candidates = await this.nextRungs(profile.id, ladder.id);
      const best =
        [...candidates].sort(
          (a, b) => b.progress - a.progress || a.level - b.level,
        )[0] ?? null;

      result.push({
        ladderId: ladder.id,
        ladderName: ladder.name,
        dimension: ladder.dimension,
        currentName: current ? (currentNames.get(current.targetId) ?? null) : null,
        next: best
          ? {
              rungId: best.rungId,
              name: best.targetName,
              progress: best.progress,
              passed: best.passed,
              // Chỉ nhãn và trạng thái: số đo thô của chỉ số không cần cho
              // trang chủ, và bớt lộ dữ liệu không dùng.
              items: best.items.map((item) => ({
                label: item.label,
                kind: item.kind,
                met: item.met,
                isRequired: item.isRequired,
              })),
            }
          : null,
      });
    }

    return { ladders: result };
  }

  async nextRungs(profileId: string, ladderId: string) {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
    });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');

    const ladder = await this.ladderRepository.findOne({
      where: { id: ladderId, storeId: profile.storeId },
    });
    if (!ladder) throw new NotFoundException('Không tìm thấy lộ trình');

    const current = await this.currentRung(profile, ladder);
    const edges = await this.edgeRepository.find({
      where: { ladderId, fromRungId: current ? current.id : (null as any) },
    });

    const rungIds = edges.map((e) => e.toRungId);
    if (rungIds.length === 0) return [];

    const rungs = await this.rungRepository.find({
      where: { id: In(rungIds) },
      order: { level: 'ASC' },
    });
    const names = await this.targetNames(
      ladder.dimension,
      rungs.map((r) => r.targetId),
    );

    return Promise.all(
      rungs.map(async (rung) => {
        const evaluation = await this.evaluateRung(profile, rung, ladder);
        return {
          targetId: rung.targetId,
          targetName: names.get(rung.targetId) ?? null,
          level: rung.level,
          approval: rung.approval,
          suggestedSalary:
            rung.suggestedSalary === null ? null : Number(rung.suggestedSalary),
          ...evaluation,
        };
      }),
    );
  }

  // ---------------------------------------------------------------------
  // Máy đánh giá — một phép đo dùng cho mọi tác nhân
  // ---------------------------------------------------------------------

  /**
   * Đo một bộ điều kiện cho một nhân viên.
   *
   * Dùng ở cả bốn chỗ: màn lộ trình của nhân viên, màn đánh giá thử việc của
   * chủ, cron nhắc hằng ngày, và lúc bấm duyệt. Trước đây mỗi chỗ tự nối chuỗi
   * điều kiện theo cách riêng nên chúng có thể nói khác nhau về cùng một người.
   */
  async evaluateRung(
    profile: EmployeeProfile,
    rung: StoreLadderRung,
    ladder: StoreLadder,
    checklistResults?: Record<string, boolean>,
  ): Promise<RungEvaluation> {
    const criteria = await this.criteriaRepository.find({
      where: { rungId: rung.id },
      order: { sortOrder: 'ASC' },
    });

    const items: EvaluatedCriteria[] = [];
    for (const c of criteria) {
      items.push(await this.measure(profile, ladder, c, checklistResults));
    }

    const required = items.filter((i) => i.isRequired);
    const metRequired = required.filter((i) => i.met);

    return {
      rungId: rung.id,
      passed: required.length === 0 || metRequired.length === required.length,
      progress:
        required.length === 0
          ? 100
          : Math.round((metRequired.length / required.length) * 100),
      items,
    };
  }

  private compare(
    current: number | null,
    operator: CriteriaOperator | null,
    target: number | null,
  ): boolean {
    if (current === null || target === null) return false;
    return operator === CriteriaOperator.LTE
      ? current <= target
      : current >= target;
  }

  /**
   * Đo một điều kiện. Thêm một loại điều kiện mới là thêm một nhánh ở đây và
   * một mã trong CriteriaCode — không phải dựng thêm cơ chế.
   */
  private async measure(
    profile: EmployeeProfile,
    ladder: StoreLadder,
    c: StoreRungCriteria,
    checklistResults?: Record<string, boolean>,
  ): Promise<EvaluatedCriteria> {
    const target = c.value === null ? null : Number(c.value);
    const base = {
      id: c.id,
      label: c.label,
      kind: c.kind,
      code: c.code,
      operator: c.operator,
      target,
      unit: c.unit,
      isRequired: c.isRequired,
    };

    if (c.kind === CriteriaKind.CHECKLIST) {
      // Chủ tick tay. Chưa chấm thì chưa đạt, chứ không mặc định là đạt.
      const met = checklistResults?.[c.id] === true;
      return { ...base, current: met ? 1 : 0, met };
    }

    if (c.kind === CriteriaKind.LADDER) {
      const met = await this.hasReachedLadderLevel(profile, c.code, target);
      return { ...base, current: met ? 1 : 0, met };
    }

    if (c.kind === CriteriaKind.TENURE) {
      const enteredAt = await this.rungEnteredAt(profile.id, ladder.id);
      const days = enteredAt
        ? Math.floor((Date.now() - enteredAt.getTime()) / 86_400_000)
        : 0;
      return {
        ...base,
        current: days,
        met: this.compare(days, c.operator, target),
      };
    }

    const current = await this.metricValue(profile, ladder, c.code);
    return { ...base, current, met: this.compare(current, c.operator, target) };
  }

  /** Điều kiện chéo: đã đạt tới một mức nào đó trên một lộ trình khác. */
  private async hasReachedLadderLevel(
    profile: EmployeeProfile,
    ladderId: string | null,
    minLevel: number | null,
  ): Promise<boolean> {
    if (!ladderId) return false;
    const other = await this.ladderRepository.findOne({
      where: { id: ladderId, storeId: profile.storeId },
    });
    if (!other) return false;
    const rung = await this.currentRung(profile, other);
    if (!rung) return false;
    return minLevel === null ? true : rung.level >= minLevel;
  }

  /**
   * Chỉ số đo được. Phần lớn lấy từ employee_monthly_summaries, thứ đã chạy
   * sẵn — không phải thu thập thêm gì để bật lộ trình.
   */
  private async metricValue(
    profile: EmployeeProfile,
    ladder: StoreLadder,
    code: string | null,
  ): Promise<number | null> {
    if (code === CriteriaCode.CAPABILITY_POINTS) {
      return Number(profile.capabilityPoints) || 0;
    }

    // Chỉ số cộng dồn thì cộng từ lúc vào bậc, không phải từ đầu tháng: một
    // người vào bậc giữa tháng không nên được tính công của bậc trước.
    // Computed from the KPI tasks themselves: nothing writes the monthly
    // summary's kpiTotalCount / kpiCompletedCount (deprecated), so it was 0.
    if (code === CriteriaCode.KPI_COMPLETION) {
      return this.kpiCompletionPercent(profile.id, stintFloor(profile.joinedAt));
    }

    const cumulative: string[] = [
      CriteriaCode.COMPLETED_SHIFTS,
      CriteriaCode.WORK_HOURS,
    ];
    const enteredAt = await this.rungEnteredAt(profile.id, ladder.id);
    const summaries = await this.monthlySummaries(
      profile.id,
      cumulative.includes(code ?? '') ? enteredAt : null,
    );
    if (summaries.length === 0) return 0;

    const sum = (pick: (s: EmployeeMonthlySummary) => unknown) =>
      summaries.reduce((acc, s) => acc + (Number(pick(s)) || 0), 0);

    switch (code) {
      case CriteriaCode.COMPLETED_SHIFTS:
        return sum((s) => s.completedShifts);
      case CriteriaCode.WORK_HOURS:
        return sum((s) => s.totalWorkHours);
      case CriteriaCode.UNAUTHORIZED_LEAVES:
        return sum((s) => s.unauthorizedLeavesCount);
      case CriteriaCode.ON_TIME_PERCENT: {
        const total = sum((s) => s.totalShifts);
        if (total === 0) return 0;
        return Math.round((sum((s) => s.onTimeArrivalsCount) / total) * 100);
      }
      case CriteriaCode.PERFORMANCE_SCORE:
        return Number(summaries[0].performanceScore) || 0;
      default:
        // Mã lạ không được coi là đã đạt; nó sẽ hiện ra là chưa đạt để chủ
        // nhìn thấy có gì đó sai trong cấu hình.
        return null;
    }
  }

  /**
   * % of this Vietnam month's KPI tasks done (completion rate ≥ 100), over
   * the employee's KPIs the owner has confirmed as 'Hoàn thành', ignoring
   * hidden and deleted tasks and deleted KPIs. 0 when there are none.
   *
   * Only owner-confirmed KPIs count: task progress on an active KPI is
   * self-reported by the employee and must not move career eligibility.
   */
  private async kpiCompletionPercent(
    profileId: string,
    stint: Date | null = null,
  ): Promise<number> {
    const month = vnDateString().slice(0, 7);
    const query = this.dataSource
      .getRepository(KpiTask)
      .createQueryBuilder('task')
      .innerJoin('task.employeeKpi', 'kpi')
      .select('COUNT(task.id)', 'total')
      .addSelect(
        'COUNT(task.id) FILTER (WHERE task.completion_rate >= 100)',
        'done',
      )
      .where('kpi.employee_profile_id = :profileId', { profileId })
      .andWhere("to_char(kpi.month, 'YYYY-MM') = :month", { month })
      .andWhere('kpi.status = :status', { status: KpiStatus.COMPLETED })
      .andWhere('kpi.deleted_at IS NULL')
      .andWhere('task.is_hidden = false');
    // A rehired employee's KPIs from the previous stint do not count.
    if (stint) query.andWhere('kpi.created_at >= :stint', { stint });
    const row = await query.getRawOne();
    const total = Number(row?.total) || 0;
    if (total === 0) return 0;
    return Math.round(((Number(row?.done) || 0) / total) * 100);
  }

  /** Tháng hiện tại, hoặc từ lúc vào bậc tới nay với chỉ số cộng dồn. */
  private async monthlySummaries(profileId: string, since: Date | null) {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    if (!since) {
      const one = await this.summaryRepository.findOne({
        where: { employeeProfileId: profileId, month: thisMonth },
      });
      return one ? [one] : [];
    }

    const fromMonth = new Date(since.getFullYear(), since.getMonth(), 1);
    return this.summaryRepository
      .createQueryBuilder('summary')
      .where('summary.employeeProfileId = :profileId', { profileId })
      .andWhere('summary.month >= :fromMonth', { fromMonth })
      .orderBy('summary.month', 'DESC')
      .getMany();
  }

  // ---------------------------------------------------------------------
  // Đi qua một bậc
  // ---------------------------------------------------------------------

  /**
   * Nâng nhân viên lên một bậc, trong một transaction.
   *
   * Đây là đường duy nhất được phép đổi loại nhân viên, vị trí hay kỹ năng của
   * hồ sơ. Trước đây vị trí sửa được rời rạc ở một màn khác, nên nó và lộ
   * trình lệch nhau mà không ai biết.
   */
  async advance(
    profileId: string,
    rungId: string,
    decidedByAccountId: string | null,
    options: {
      note?: string | null;
      checklistResults?: Record<string, boolean>;
      /** Bỏ qua việc kiểm điều kiện. Dành cho chủ quyết định ngoại lệ. */
      force?: boolean;
    } = {},
  ) {
    const result = await this.dataSource.transaction(async (manager) => {
      // Khoá dòng hồ sơ tới hết transaction. Không có khoá, hai lần bấm duyệt
      // gần nhau cùng đọc thấy bậc cũ, cùng qua kiểm tra "đã ở bậc này chưa",
      // và cùng ghi một sự kiện — lịch sử có hai dòng cho một lần lên bậc, hoặc
      // nói người đó lên cả hai nhánh cùng lúc.
      const profile = await manager.findOne(EmployeeProfile, {
        where: { id: profileId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');

      const rung = await manager.findOne(StoreLadderRung, {
        where: { id: rungId },
      });
      if (!rung) throw new NotFoundException('Không tìm thấy bậc');

      const ladder = await manager.findOne(StoreLadder, {
        where: { id: rung.ladderId, storeId: profile.storeId },
      });
      if (!ladder) {
        throw new NotFoundException(
          'Bậc không thuộc lộ trình của cửa hàng này',
        );
      }

      const fromRung = await this.currentRung(profile, ladder);
      if (fromRung?.id === rung.id) {
        throw new BadRequestException('Nhân viên đã ở bậc này');
      }

      // Chỉ đi được theo cạnh đã khai. Không có cạnh nào nghĩa là bậc đó
      // không nối vào lộ trình, kể cả khi chủ ép.
      const edge = await manager.findOne(StoreLadderEdge, {
        where: {
          ladderId: ladder.id,
          fromRungId: fromRung ? fromRung.id : (null as any),
          toRungId: rung.id,
        },
      });
      if (!edge) {
        throw new BadRequestException(
          'Không có đường đi từ bậc hiện tại sang bậc này',
        );
      }

      const evaluation = await this.evaluateRung(
        profile,
        rung,
        ladder,
        options.checklistResults,
      );
      if (!evaluation.passed && !options.force) {
        throw new BadRequestException({
          code: 'CAREER_RUNG_CRITERIA_NOT_MET',
          message: 'Nhân viên chưa đủ điều kiện lên bậc này',
          items: evaluation.items,
        });
      }

      // Đây là phép map: tác nhân của lộ trình quyết định trường nào được ghi.
      const column = this.profileColumn(ladder.dimension);
      (profile as any)[column] = rung.targetId;

      if (ladder.dimension === LadderDimension.EMPLOYMENT_TYPE) {
        const type = await manager.findOne(StoreEmployeeType, {
          where: { id: rung.targetId },
        });
        if (type?.isProbation) {
          profile.employmentStatus = EmploymentStatus.PROBATION;
          profile.probationEndsAt = await this.probationDeadline(
            manager,
            rung.id,
          );
        } else {
          profile.employmentStatus = EmploymentStatus.ACTIVE;
          profile.probationEndsAt = null;
        }
      }

      await manager.save(EmployeeProfile, profile);

      const snapshot: CriteriaSnapshotItem[] = evaluation.items.map((i) => ({
        label: i.label,
        kind: i.kind,
        code: i.code,
        operator: i.operator,
        target: i.target,
        current: i.current,
        met: i.met,
        isRequired: i.isRequired,
      }));

      const event = await manager.save(
        EmployeeCareerEvent,
        manager.create(EmployeeCareerEvent, {
          employeeProfileId: profile.id,
          ladderId: ladder.id,
          fromRungId: fromRung?.id ?? null,
          toRungId: rung.id,
          effectiveAt: new Date(),
          decidedByAccountId,
          criteriaSnapshot: snapshot,
          note: options.note ?? null,
        }),
      );

      // Lên bậc này có thể đẩy một lộ trình khác về điểm xuất phát — dùng cho
      // "thăng vị trí thì phải thử việc lại".
      if (rung.resetsLadderId) {
        await this.resetLadder(
          manager,
          profile,
          rung.resetsLadderId,
          decidedByAccountId,
        );
      }

      return { event, evaluation, profile, ladder, rung };
    });

    // Gửi sau khi transaction đã commit. Gửi bên trong thì một lần lên bậc bị
    // rollback vẫn kịp đẩy thông báo tới điện thoại nhân viên — thông báo cho
    // một việc không hề xảy ra.
    await this.notifyAdvanced(result.profile, result.ladder, result.rung);

    return { event: result.event, evaluation: result.evaluation };
  }

  /**
   * Hạn thử việc: days_in_rung nhỏ nhất (bắt buộc) trên các bậc kế tiếp, nếu
   * không có thì của chính bậc thử việc. Same rule as hiring.
   */
  private async probationDeadline(
    manager: EntityManager,
    rungId: string,
  ): Promise<Date | null> {
    return computeProbationEndsAt(manager, rungId, new Date());
  }

  /** Đưa nhân viên về bậc điểm-vào của một lộ trình khác. */
  private async resetLadder(
    manager: EntityManager,
    profile: EmployeeProfile,
    ladderId: string,
    decidedByAccountId: string | null,
  ) {
    const ladder = await manager.findOne(StoreLadder, {
      where: { id: ladderId, storeId: profile.storeId },
    });
    if (!ladder) return;

    const entryEdge = await manager.findOne(StoreLadderEdge, {
      where: { ladderId, fromRungId: null as any },
    });
    if (!entryEdge) return;

    const entryRung = await manager.findOne(StoreLadderRung, {
      where: { id: entryEdge.toRungId },
    });
    if (!entryRung) return;

    const fromRung = await this.currentRung(profile, ladder);
    if (fromRung?.id === entryRung.id) return;

    (profile as any)[this.profileColumn(ladder.dimension)] = entryRung.targetId;

    if (ladder.dimension === LadderDimension.EMPLOYMENT_TYPE) {
      const type = await manager.findOne(StoreEmployeeType, {
        where: { id: entryRung.targetId },
      });
      if (type?.isProbation) {
        profile.employmentStatus = EmploymentStatus.PROBATION;
        profile.probationEndsAt = await this.probationDeadline(
          manager,
          entryRung.id,
        );
      }
    }

    await manager.save(EmployeeProfile, profile);
    await manager.save(
      EmployeeCareerEvent,
      manager.create(EmployeeCareerEvent, {
        employeeProfileId: profile.id,
        ladderId: ladder.id,
        fromRungId: fromRung?.id ?? null,
        toRungId: entryRung.id,
        effectiveAt: new Date(),
        decidedByAccountId,
        criteriaSnapshot: null,
        note: 'Đặt lại theo bậc vừa đạt trên lộ trình khác',
      }),
    );
  }

  private async notifyAdvanced(
    profile: EmployeeProfile,
    ladder: StoreLadder,
    rung: StoreLadderRung,
  ) {
    try {
      const setting = await this.probationSettingRepository.findOne({
        where: { storeId: profile.storeId },
      });
      if (
        ladder.dimension === LadderDimension.EMPLOYMENT_TYPE &&
        setting &&
        !setting.notifyResultToEmployee
      ) {
        return;
      }

      const names = await this.targetNames(ladder.dimension, [rung.targetId]);
      await this.notificationsService.create({
        accountId: profile.accountId,
        // Enum `type` là kiểu enum trong Postgres; thêm giá trị mới cần
        // ALTER TYPE chạy ngoài transaction, nên dùng lại SYSTEM và để chi
        // tiết trong tiêu đề và metadata.
        type: NotificationType.SYSTEM,
        title: 'Bạn đã lên bậc mới',
        content: `${ladder.name}: ${names.get(rung.targetId) ?? 'bậc mới'}`,
        // App nhân viên: trang chủ có mục Lộ trình.
        actionUrl: '/',
        metadata: {
          ladderId: ladder.id,
          rungId: rung.id,
          dimension: ladder.dimension,
        },
      } as any);
    } catch (error) {
      // Thông báo hỏng không được làm hỏng việc lên bậc.
      this.logger.warn(
        `Không gửi được thông báo lên bậc cho hồ sơ ${profile.id}: ${error}`,
      );
    }
  }

  // ---------------------------------------------------------------------
  // Điểm năng lực
  // ---------------------------------------------------------------------

  /**
   * Chủ cộng hoặc trừ điểm kèm lý do. `capability_points` trên hồ sơ là tổng
   * được duy trì ở đây để điều kiện không phải cộng dồn mỗi lần đánh giá.
   */
  async awardCapabilityPoints(
    profileId: string,
    points: number,
    reason: string | null,
    awardedByAccountId: string | null,
  ) {
    if (!Number.isInteger(points) || points === 0) {
      throw new BadRequestException('Điểm phải là số nguyên khác 0');
    }
    // Chặn một lần chấm vô lý. Cột là int, và một con số khổng lồ gửi nhầm sẽ
    // làm mọi điều kiện điểm năng lực của người đó mất ý nghĩa vĩnh viễn.
    if (Math.abs(points) > CareerLadderService.MAX_POINTS_PER_ENTRY) {
      throw new BadRequestException(
        `Mỗi lần chấm tối đa ${CareerLadderService.MAX_POINTS_PER_ENTRY} điểm`,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      // Khoá dòng: đọc tổng rồi ghi tổng + điểm là kiểu cập nhật bị mất kinh
      // điển — hai lần chấm +10 cùng lúc cho ra +10 thay vì +20.
      const profile = await manager.findOne(EmployeeProfile, {
        where: { id: profileId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');

      const entry = await manager.save(
        EmployeeCapabilityEntry,
        manager.create(EmployeeCapabilityEntry, {
          employeeProfileId: profileId,
          points,
          reason,
          awardedByAccountId,
          awardedAt: new Date(),
        }),
      );

      profile.capabilityPoints =
        (Number(profile.capabilityPoints) || 0) + points;
      await manager.save(EmployeeProfile, profile);

      return { entry, capabilityPoints: profile.capabilityPoints };
    });
  }

  /**
   * Floor for the current employment stint (see employment-stint.utils): a
   * rehired employee's entries and events from the previous stint are kept
   * but not shown. Null means no filter.
   */
  private async currentStintFloor(profileId: string): Promise<Date | null> {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      select: ['id', 'joinedAt'],
    });
    return stintFloor(profile?.joinedAt);
  }

  async getCapabilityEntries(profileId: string) {
    const floor = await this.currentStintFloor(profileId);
    return this.capabilityRepository.find({
      where: {
        employeeProfileId: profileId,
        ...(floor ? { awardedAt: MoreThanOrEqual(floor) } : {}),
      },
      order: { awardedAt: 'DESC' },
      take: 100,
    });
  }

  // ---------------------------------------------------------------------
  // Lịch sử
  // ---------------------------------------------------------------------

  async getCareerHistory(profileId: string) {
    const floor = await this.currentStintFloor(profileId);
    const events = await this.eventRepository.find({
      where: {
        employeeProfileId: profileId,
        ...(floor ? { effectiveAt: MoreThanOrEqual(floor) } : {}),
      },
      order: { effectiveAt: 'DESC' },
      relations: ['ladder', 'decidedByAccount'],
      take: 200,
    });

    const byDimension = new Map<LadderDimension, string[]>();
    for (const e of events) {
      const list = byDimension.get(e.ladder.dimension) ?? [];
      list.push(e.fromRungId ?? '', e.toRungId);
      byDimension.set(e.ladder.dimension, list);
    }

    const rungIds = events.flatMap((e) =>
      e.fromRungId ? [e.fromRungId, e.toRungId] : [e.toRungId],
    );
    const rungs = rungIds.length
      ? // Bậc đã gỡ vẫn phải đọc được tên, nếu không một lần lên bậc thật
        // sẽ hiện thành "Vào X" như thể người đó mới được tuyển.
        await this.rungRepository.find({
          where: { id: In(rungIds) },
          withDeleted: true,
        })
      : [];
    const rungById = new Map(rungs.map((r) => [r.id, r]));

    const names = new Map<string, string>();
    for (const [dimension, _ids] of byDimension) {
      const targets = rungs
        .filter((r) =>
          events.some(
            (e) =>
              e.ladder.dimension === dimension &&
              (e.toRungId === r.id || e.fromRungId === r.id),
          ),
        )
        .map((r) => r.targetId);
      const resolved = await this.targetNames(dimension, targets, true);
      resolved.forEach((v, k) => names.set(k, v));
    }

    const nameOf = (rungId: string | null) => {
      if (!rungId) return null;
      const rung = rungById.get(rungId);
      return rung ? (names.get(rung.targetId) ?? null) : null;
    };

    return events.map((e) => ({
      id: e.id,
      ladderId: e.ladderId,
      ladderName: e.ladder.name,
      dimension: e.ladder.dimension,
      fromRungId: e.fromRungId,
      fromName: nameOf(e.fromRungId),
      toRungId: e.toRungId,
      toName: nameOf(e.toRungId),
      effectiveAt: e.effectiveAt,
      decidedBy: e.decidedByAccount?.fullName ?? null,
      note: e.note,
      criteriaSnapshot: e.criteriaSnapshot,
    }));
  }

  // ---------------------------------------------------------------------
  // Quét hằng ngày
  // ---------------------------------------------------------------------

  /**
   * Tìm những người đã đủ điều kiện lên bậc kế.
   *
   * Bậc đặt `approval: auto` thì thăng luôn — dành cho thử việc sang chính
   * thức, thứ chủ thường không muốn phải bấm. Còn lại chỉ báo cho chủ, và chỉ
   * khi cửa hàng bật `notifyEvaluation`, đúng cái cờ đã có sẵn từ trước mà
   * chưa có gì đọc tới.
   */
  async sweepEligibleEmployees(): Promise<{
    checked: number;
    autoAdvanced: number;
    notified: number;
  }> {
    const ladders = await this.ladderRepository.find({
      where: { isActive: true },
    });
    let checked = 0;
    let autoAdvanced = 0;
    let notified = 0;

    for (const ladder of ladders) {
      const profiles = await this.profileRepository.find({
        where: [
          {
            storeId: ladder.storeId,
            employmentStatus: EmploymentStatus.ACTIVE,
          },
          {
            storeId: ladder.storeId,
            employmentStatus: EmploymentStatus.PROBATION,
          },
        ],
      });

      for (const profile of profiles) {
        checked += 1;
        let candidates: Awaited<ReturnType<typeof this.nextRungs>>;
        try {
          candidates = await this.nextRungs(profile.id, ladder.id);
        } catch (error) {
          this.logger.warn(
            `Bỏ qua hồ sơ ${profile.id} trên lộ trình ${ladder.id}: ${error}`,
          );
          continue;
        }

        for (const candidate of candidates) {
          if (!candidate.passed) continue;

          // Checklist cần chủ tick tay, nên một bậc có checklist không bao giờ
          // tự thăng được — `passed` ở đây chỉ đúng khi không còn mục nào chờ
          // người chấm.
          if (candidate.approval === RungApproval.AUTO) {
            try {
              await this.advance(profile.id, candidate.rungId, null, {
                note: 'Tự động theo cấu hình của bậc',
              });
              autoAdvanced += 1;
            } catch (error) {
              this.logger.warn(
                `Không tự thăng được hồ sơ ${profile.id}: ${error}`,
              );
            }
            // Dừng ở một bậc cho mỗi lượt quét. Lộ trình phân nhánh có thể có
            // nhiều bậc kế cùng đủ điều kiện, và `candidates` được tính trước
            // khi thăng — đi tiếp là thăng thêm bậc dựa trên đánh giá đã cũ,
            // hoặc chọn nhánh chỉ vì nó đứng trước trong danh sách.
            break;
          }

          if (await this.notifyOwnerOfEligibility(profile, ladder, candidate)) {
            notified += 1;
          }
        }
      }
    }

    return { checked, autoAdvanced, notified };
  }

  private async notifyOwnerOfEligibility(
    profile: EmployeeProfile,
    ladder: StoreLadder,
    candidate: { targetName: string | null },
  ): Promise<boolean> {
    const setting = await this.probationSettingRepository.findOne({
      where: { storeId: profile.storeId },
    });
    if (!setting?.notifyEvaluation) return false;

    const store = await this.dataSource
      .getRepository(StoreLadder)
      .manager.query(
        'SELECT owner_account_id FROM stores WHERE id = $1 LIMIT 1',
        [profile.storeId],
      );
    const ownerAccountId = store?.[0]?.owner_account_id;
    if (!ownerAccountId) return false;

    try {
      await this.notificationsService.create({
        accountId: ownerAccountId,
        type: NotificationType.SYSTEM,
        title: 'Có nhân viên đủ điều kiện lên bậc',
        content: `${ladder.name}: một nhân viên đã đủ điều kiện lên ${candidate.targetName ?? 'bậc kế'}.`,
        // App chủ: mở thẳng màn xét lên bậc của nhân viên này.
        actionUrl: `/(employee)/${profile.id}/promotion-detail`,
        metadata: { storeId: profile.storeId, profileId: profile.id },
      } as any);
      return true;
    } catch (error) {
      this.logger.warn(`Không gửi được thông báo cho chủ: ${error}`);
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Hình dạng cũ cho app đang chạy
  // ---------------------------------------------------------------------

  /**
   * Danh sách bậc theo đúng hình dạng mà app chủ đang đọc.
   *
   * `GET /stores/employees/:profileId/progression` trả về một mảng trần và
   * client nhận thẳng bằng `setStages(res)`. Hai app phát hành độc lập với
   * backend, nên hình dạng này được giữ nguyên; chỉ nguồn tính đổi sang máy
   * đánh giá, cộng thêm vài trường mới ở dạng tuỳ chọn.
   */
  async getProgressionStages(profileId: string) {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
    });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');

    const ladders = await this.ladderRepository.find({
      where: { storeId: profile.storeId, isActive: true },
      order: { dimension: 'ASC' },
    });
    const stint = stintFloor(profile.joinedAt);

    const stages: any[] = [];
    for (const ladder of ladders) {
      const rungs = await this.rungRepository.find({
        where: { ladderId: ladder.id },
        order: { level: 'ASC' },
      });
      if (rungs.length === 0) continue;

      const current = await this.currentRung(profile, ladder);
      const names = await this.targetNames(
        ladder.dimension,
        rungs.map((r) => r.targetId),
      );
      const reachable = new Set(
        (
          await this.edgeRepository.find({
            where: {
              ladderId: ladder.id,
              fromRungId: current ? current.id : (null as any),
            },
          })
        ).map((e) => e.toRungId),
      );

      // Bậc "đã qua" là bậc có trong lịch sử thật, không phải bậc có `level`
      // thấp hơn. Lộ trình phân nhánh làm `level` chỉ còn là thứ tự hiển thị:
      // người lên Ca trưởng qua nhánh Bánh tráng chưa từng làm Thu ngân, dù
      // Thu ngân đứng cùng hàng.
      // Only events of the current employment stint: a rehired employee
      // starts the ladder again (see getCareerHistory).
      const traversed = new Set(
        (
          await this.eventRepository.find({
            where: {
              employeeProfileId: profile.id,
              ladderId: ladder.id,
              ...(stint ? { effectiveAt: MoreThanOrEqual(stint) } : {}),
            },
            select: ['id', 'fromRungId', 'toRungId'],
          })
        ).flatMap((e) =>
          e.fromRungId ? [e.fromRungId, e.toRungId] : [e.toRungId],
        ),
      );

      for (const rung of rungs) {
        const isCurrent = current?.id === rung.id;
        const isPast = !isCurrent && traversed.has(rung.id);

        let progress = 0;
        let requirements: { text: string; completed: boolean }[] = [];

        if (isPast || isCurrent) {
          progress = 100;
        } else if (reachable.has(rung.id)) {
          const evaluation = await this.evaluateRung(profile, rung, ladder);
          progress = evaluation.progress;
          requirements = evaluation.items.map((i) => ({
            text: i.label,
            completed: i.met,
          }));
        }

        stages.push({
          title: names.get(rung.targetId) ?? 'Bậc',
          progress,
          requirements,
          suggestion: undefined,
          // Trường mới, app cũ bỏ qua vì nó chỉ đọc bốn trường trên.
          ladderId: ladder.id,
          ladderName: ladder.name,
          dimension: ladder.dimension,
          rungId: rung.id,
          isCurrent,
          isReachable: reachable.has(rung.id),
        });
      }
    }

    return stages;
  }

  /** Bản theo id, cho controller khỏi phải tự nạp hồ sơ. */
  async getProgressionSummaryByProfileId(profileId: string) {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
    });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');
    return this.getProgressionSummary(profile);
  }

  /**
   * Khối `progression` nhúng trong phản hồi hiệu suất, giữ đúng các trường mà
   * màn chi tiết nhân viên đang đọc.
   */
  async getProgressionSummary(profile: EmployeeProfile) {
    const ladders = await this.ladderRepository.find({
      where: { storeId: profile.storeId, isActive: true },
    });

    const position =
      ladders.find((l) => l.dimension === LadderDimension.POSITION) ??
      ladders[0] ??
      null;

    if (!position) {
      return {
        currentPosition: 'Chưa có lộ trình',
        nextTarget: 'Chưa có lộ trình',
        rankInPosition: '1/1',
        suggestion: 'Chủ cửa hàng chưa thiết lập lộ trình cho cửa hàng này.',
        requirements: [] as { label: string; isMet: boolean }[],
        skills: 'N/A',
      };
    }

    const current = await this.currentRung(profile, position);
    const next = await this.nextRungs(profile.id, position.id);
    const best = next[0] ?? null;
    const names = current
      ? await this.targetNames(position.dimension, [current.targetId])
      : new Map<string, string>();

    const total = await this.rungRepository.count({
      where: { ladderId: position.id },
    });

    return {
      currentPosition: current
        ? (names.get(current.targetId) ?? 'Chưa xếp bậc')
        : 'Chưa xếp bậc',
      nextTarget: best?.targetName ?? 'Cấp tối đa',
      rankInPosition: `${current?.level ?? 0}/${total}`,
      suggestion: best
        ? `Còn ${best.items.filter((i: EvaluatedCriteria) => i.isRequired && !i.met).length} điều kiện để lên ${best.targetName}.`
        : 'Bạn đang hoàn thành tốt công việc!',
      requirements: (best?.items ?? []).map((i: EvaluatedCriteria) => ({
        label: i.label,
        isMet: i.met,
        currentValue: i.current,
        requiredValue: i.target,
      })),
      skills: 'N/A',
    };
  }
}
