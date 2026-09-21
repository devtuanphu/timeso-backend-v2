import { EntityManager, In, MoreThanOrEqual } from 'typeorm';

import { EmployeeCareerEvent } from './entities/employee-career-event.entity';
import { EmployeeProfile } from './entities/employee-profile.entity';
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
 * The migrated ladders put "days in rung" on the rung people move *to*
 * (Chính thức), not on the probation rung, so reading only the probation
 * rung gave no deadline and probation never ended. The deadline is the
 * smallest required `days_in_rung` among the rungs reachable from it, else
 * the probation rung's own value. No positive value means no deadline.
 */
export async function computeProbationEndsAt(
  manager: EntityManager,
  probationRungId: string,
  enteredAt: Date,
): Promise<Date | null> {
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

  let days: number | null = null;
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
  if (days === null) {
    const own = await manager.findOne(StoreRungCriteria, {
      where: {
        rungId: probationRungId,
        kind: CriteriaKind.TENURE,
        code: CriteriaCode.DAYS_IN_RUNG,
      },
    });
    const value = Number(own?.value ?? 0);
    days = Number.isFinite(value) ? value : 0;
  }
  return days > 0 ? new Date(enteredAt.getTime() + days * DAY_MS) : null;
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
