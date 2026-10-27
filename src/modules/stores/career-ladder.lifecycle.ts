import { EntityManager, In, MoreThanOrEqual } from 'typeorm';

import { EmployeeCareerEvent } from './entities/employee-career-event.entity';
import { EmployeeProfile, EmploymentStatus } from './entities/employee-profile.entity';
import { StoreEmployeeType } from './entities/store-employee-type.entity';
import { StoreLadder, LadderDimension } from './entities/store-ladder.entity';
import { StoreLadderEdge } from './entities/store-ladder-edge.entity';
import { StoreLadderRung } from './entities/store-ladder-rung.entity';
import {
  CriteriaCode,
  CriteriaKind,
  StoreRungCriteria,
} from './entities/store-rung-criteria.entity';

/**
 * Career-ladder steps shared by hiring (`StoresService`) and advancement
 * (`CareerLadderService`). They take the caller's `EntityManager`, so they
 * run inside the caller's transaction without a new service dependency.
 */

const DAY_MS = 86_400_000;

/** The profile column a ladder dimension writes (mirrors CareerLadderService). */
export function ladderProfileColumn(
  dimension: LadderDimension,
): 'employeeTypeId' | 'storeRoleId' | 'skillId' | null {
  switch (dimension) {
    case LadderDimension.EMPLOYMENT_TYPE:
      return 'employeeTypeId';
    case LadderDimension.POSITION:
      return 'storeRoleId';
    case LadderDimension.SKILL:
      return 'skillId';
    default:
      return null;
  }
}

/**
 * When probation on `probationRungId` ends for someone who entered it at
 * `enteredAt`.
 *
 * Điều kiện của lộ trình giai đoạn là của chính giai đoạn đang đứng
 * (CareerLadderService.criteriaSourceId), nên hạn thử việc là `days_in_rung`
 * bắt buộc của chính bậc thử việc. Dữ liệu cũ đặt "số ngày" trên bậc người ta
 * đi tới (Chính thức); migration_career_stages.sql dời chúng về, còn ở đây
 * vẫn đọc các bậc kế như phương án dự phòng khi bậc chưa có giá trị riêng.
 * Không có giá trị dương thì không có hạn.
 */
export async function computeProbationEndsAt(
  manager: EntityManager,
  probationRungId: string,
  enteredAt: Date,
): Promise<Date | null> {
  const own = await manager.findOne(StoreRungCriteria, {
    where: {
      rungId: probationRungId,
      kind: CriteriaKind.TENURE,
      code: CriteriaCode.DAYS_IN_RUNG,
      isRequired: true,
    },
  });
  let days: number | null =
    own && Number.isFinite(Number(own.value)) ? Number(own.value) : null;

  if (days === null) {
    const edges = await manager.find(StoreLadderEdge, {
      where: { fromRungId: probationRungId },
      select: ['id', 'toRungId'],
    });
    const nextRungIds = [
      ...new Set(
        edges
          .map((edge) => edge.toRungId)
          .filter((id) => id && id !== probationRungId),
      ),
    ];
    if (nextRungIds.length) {
      const required = await manager.find(StoreRungCriteria, {
        where: {
          rungId: In(nextRungIds),
          kind: CriteriaKind.TENURE,
          code: CriteriaCode.DAYS_IN_RUNG,
          isRequired: true,
        },
      });
      const values = required
        .map((criteria) => Number(criteria.value))
        .filter((value) => Number.isFinite(value));
      if (values.length) days = Math.min(...values);
    }
  }
  return days !== null && days > 0 ? new Date(enteredAt.getTime() + days * DAY_MS) : null;
}

/**
 * Cột chủ thể v2 cho sự kiện của lộ trình vị trí / kỹ năng cũ, để lộ trình v2
 * đọc "vào vị trí hiện tại từ lúc nào" từ một nguồn duy nhất (kể cả sự kiện
 * ghi trong khoảng giữa migration và lúc cửa hàng bật v2).
 */
export function legacyEventSubject(
  dimension: LadderDimension,
  fromTargetId: string | null,
  toTargetId: string,
): Pick<EmployeeCareerEvent, 'subjectType' | 'fromTargetId' | 'toTargetId'> {
  if (dimension === LadderDimension.POSITION || dimension === LadderDimension.SKILL) {
    return {
      subjectType: dimension === LadderDimension.POSITION ? 'position' : 'skill',
      fromTargetId,
      toTargetId,
    };
  }
  return { subjectType: null, fromTargetId: null, toTargetId: null };
}

/**
 * Records where a newly hired (or rehired) employee enters each active ladder
 * of their store: one event per ladder on whose rung they sit, unless an
 * event at or after `effectiveAt` already exists. Tenure ("days in rung")
 * counts from these events; without them it measured 0 forever, and a
 * rehire counted from the previous stint.
 *
 * Returns the number of events written.
 */
export async function recordEntryCareerEvents(
  manager: EntityManager,
  profile: Pick<
    EmployeeProfile,
    'id' | 'storeId' | 'employeeTypeId' | 'storeRoleId' | 'skillId'
  >,
  options: {
    decidedByAccountId: string | null;
    note: string;
    effectiveAt: Date;
  },
): Promise<number> {
  const ladders = await manager.find(StoreLadder, {
    where: { storeId: profile.storeId, isActive: true },
  });
  let written = 0;
  for (const ladder of ladders) {
    const column = ladderProfileColumn(ladder.dimension);
    const targetId = column ? profile[column] : null;
    if (!targetId) continue;

    const rung = await manager.findOne(StoreLadderRung, {
      where: { ladderId: ladder.id, targetId },
      select: ['id'],
    });
    if (!rung) continue;

    const existing = await manager.findOne(EmployeeCareerEvent, {
      where: {
        employeeProfileId: profile.id,
        ladderId: ladder.id,
        effectiveAt: MoreThanOrEqual(options.effectiveAt),
      },
      select: ['id'],
    });
    if (existing) continue;

    await manager.save(
      EmployeeCareerEvent,
      manager.create(EmployeeCareerEvent, {
        employeeProfileId: profile.id,
        ladderId: ladder.id,
        fromRungId: null,
        toRungId: rung.id,
        ...legacyEventSubject(ladder.dimension, null, targetId),
        effectiveAt: options.effectiveAt,
        decidedByAccountId: options.decidedByAccountId,
        criteriaSnapshot: null,
        note: options.note,
      }),
    );
    written += 1;
  }
  return written;
}

/**
 * Chủ cửa hàng đổi tay hình thức làm việc (loại nhân viên) của một hồ sơ —
 * sửa thông tin nhân viên, không phải "lên bậc": không xét điều kiện, không
 * bắt đi theo cạnh của lộ trình (sửa nhầm Chính thức → Thử việc cũng được).
 *
 * Ghi giống CareerLadderService.advance() cho lộ trình employment_type để hai
 * đường không lệch nhau: thử việc ↔ trạng thái PROBATION / ACTIVE và hạn thử
 * việc tính lại từ bây giờ; có lộ trình đang bật và loại mới là một bậc của
 * nó thì ghi một sự kiện (bậc cũ → bậc mới), để "thời gian ở bậc" đếm từ lúc
 * đổi. Chỉ đổi trạng thái khi đang Thử việc / Chính thức — người đang nghỉ
 * phép, đã nghỉ việc hay chờ duyệt giữ nguyên trạng thái.
 *
 * Gọi trong transaction của người gọi, với hồ sơ đã khoá; người gọi lưu hồ sơ.
 * Trả về sự kiện đã ghi (nếu có).
 */
export async function changeEmploymentType(
  manager: EntityManager,
  profile: EmployeeProfile,
  nextTypeId: string | null,
  options: { decidedByAccountId: string | null; note: string },
): Promise<EmployeeCareerEvent | null> {
  const previousTypeId = profile.employeeTypeId ?? null;
  if (previousTypeId === nextTypeId) return null;

  const ladder = await manager.findOne(StoreLadder, {
    where: {
      storeId: profile.storeId,
      dimension: LadderDimension.EMPLOYMENT_TYPE,
      isActive: true,
    },
  });
  const rungOf = (targetId: string | null) =>
    ladder && targetId
      ? manager.findOne(StoreLadderRung, { where: { ladderId: ladder.id, targetId } })
      : Promise.resolve(null);
  const [fromRung, toRung] = await Promise.all([rungOf(previousTypeId), rungOf(nextTypeId)]);

  // Cột nullable trong DB nhưng khai `string` trên entity.
  profile.employeeTypeId = nextTypeId as any;

  const employed =
    profile.employmentStatus === EmploymentStatus.ACTIVE ||
    profile.employmentStatus === EmploymentStatus.PROBATION;
  if (employed) {
    const type = nextTypeId
      ? await manager.findOne(StoreEmployeeType, { where: { id: nextTypeId } })
      : null;
    if (type?.isProbation) {
      profile.employmentStatus = EmploymentStatus.PROBATION;
      profile.probationEndsAt = toRung
        ? await computeProbationEndsAt(manager, toRung.id, new Date())
        : null;
    } else {
      profile.employmentStatus = EmploymentStatus.ACTIVE;
      profile.probationEndsAt = null;
    }
  }

  if (!ladder || !toRung || !nextTypeId) return null;
  return manager.save(
    EmployeeCareerEvent,
    manager.create(EmployeeCareerEvent, {
      employeeProfileId: profile.id,
      ladderId: ladder.id,
      fromRungId: fromRung?.id ?? null,
      toRungId: toRung.id,
      ...legacyEventSubject(ladder.dimension, previousTypeId, nextTypeId),
      effectiveAt: new Date(),
      decidedByAccountId: options.decidedByAccountId,
      criteriaSnapshot: null,
      note: options.note,
    }),
  );
}
