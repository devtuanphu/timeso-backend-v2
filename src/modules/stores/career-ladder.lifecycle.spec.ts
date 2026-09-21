import { In, MoreThanOrEqual } from 'typeorm';

import {
  computeProbationEndsAt,
  ladderProfileColumn,
  recordEntryCareerEvents,
} from './career-ladder.lifecycle';
import { EmployeeCareerEvent } from './entities/employee-career-event.entity';
import { LadderDimension, StoreLadder } from './entities/store-ladder.entity';
import { StoreLadderEdge } from './entities/store-ladder-edge.entity';
import { StoreLadderRung } from './entities/store-ladder-rung.entity';
import {
  CriteriaCode,
  CriteriaKind,
  StoreRungCriteria,
} from './entities/store-rung-criteria.entity';

const DAY = 86_400_000;
const HIRED = new Date('2026-09-01T00:00:00.000Z');

describe('computeProbationEndsAt', () => {
  const manager = (opts: {
    edges?: Array<{ toRungId: string }>;
    nextCriteria?: Array<{ value: unknown }>;
    own?: { value: unknown } | null;
  }) => ({
    find: jest.fn(async (entity: any) => {
      if (entity === StoreLadderEdge) return opts.edges ?? [];
      if (entity === StoreRungCriteria) return opts.nextCriteria ?? [];
      return [];
    }),
    findOne: jest.fn(async () => opts.own ?? null),
  });

  it('uses the smallest required days_in_rung on the next rungs', async () => {
    const m = manager({
      edges: [{ toRungId: 'official' }, { toRungId: 'senior' }],
      nextCriteria: [{ value: '60.00' }, { value: 45 }],
      own: { value: 7 },
    });
    await expect(computeProbationEndsAt(m as any, 'probation', HIRED)).resolves.toEqual(
      new Date(HIRED.getTime() + 45 * DAY),
    );
    expect(m.find).toHaveBeenCalledWith(StoreRungCriteria, {
      where: {
        rungId: In(['official', 'senior']),
        kind: CriteriaKind.TENURE,
        code: CriteriaCode.DAYS_IN_RUNG,
        isRequired: true,
      },
    });
    expect(m.findOne).not.toHaveBeenCalled();
  });

  it("falls back to the probation rung's own value", async () => {
    const m = manager({ edges: [{ toRungId: 'official' }], own: { value: 30 } });
    await expect(computeProbationEndsAt(m as any, 'probation', HIRED)).resolves.toEqual(
      new Date(HIRED.getTime() + 30 * DAY),
    );
  });

  it('gives no deadline without a positive value', async () => {
    await expect(
      computeProbationEndsAt(manager({}) as any, 'probation', HIRED),
    ).resolves.toBeNull();
    await expect(
      computeProbationEndsAt(
        manager({ edges: [{ toRungId: 'official' }], nextCriteria: [{ value: 0 }] }) as any,
        'probation',
        HIRED,
      ),
    ).resolves.toBeNull();
  });
});

describe('recordEntryCareerEvents', () => {
  const profile = {
    id: 'profile-1',
    storeId: 'store-1',
    employeeTypeId: 'type-probation',
    storeRoleId: 'role-barista',
    skillId: null,
  };
  const ladders = [
    { id: 'ladder-type', dimension: LadderDimension.EMPLOYMENT_TYPE },
    { id: 'ladder-role', dimension: LadderDimension.POSITION },
    { id: 'ladder-skill', dimension: LadderDimension.SKILL },
  ];
  const rungs: Record<string, string> = {
    'ladder-type:type-probation': 'rung-probation',
    'ladder-role:role-barista': 'rung-barista',
  };

  const manager = (existingFor: string[] = []) => ({
    find: jest.fn(async (entity: any) => (entity === StoreLadder ? ladders : [])),
    findOne: jest.fn(async (entity: any, { where }: any) => {
      if (entity === StoreLadderRung) {
        const id = rungs[`${where.ladderId}:${where.targetId}`];
        return id ? { id } : null;
      }
      if (entity === EmployeeCareerEvent) {
        return existingFor.includes(where.ladderId) ? { id: 'event' } : null;
      }
      return null;
    }),
    create: jest.fn((_entity: unknown, value: any) => value),
    save: jest.fn(async (_entity: unknown, value: any) => value),
  });

  it('writes one event per active ladder where the person sits on a rung', async () => {
    const m = manager();
    await expect(
      recordEntryCareerEvents(m as any, profile, {
        decidedByAccountId: null,
        note: 'Vào làm',
        effectiveAt: HIRED,
      }),
    ).resolves.toBe(2);
    expect(m.find).toHaveBeenCalledWith(StoreLadder, {
      where: { storeId: 'store-1', isActive: true },
    });
    expect(m.save.mock.calls.map(([, value]: any[]) => value)).toEqual([
      {
        employeeProfileId: 'profile-1',
        ladderId: 'ladder-type',
        fromRungId: null,
        toRungId: 'rung-probation',
        effectiveAt: HIRED,
        decidedByAccountId: null,
        criteriaSnapshot: null,
        note: 'Vào làm',
      },
      expect.objectContaining({ ladderId: 'ladder-role', toRungId: 'rung-barista' }),
    ]);
  });

  it('does not duplicate when an event at or after the hire exists', async () => {
    const m = manager(['ladder-type']);
    await expect(
      recordEntryCareerEvents(m as any, profile, {
        decidedByAccountId: null,
        note: 'Vào làm',
        effectiveAt: HIRED,
      }),
    ).resolves.toBe(1);
    expect(m.findOne).toHaveBeenCalledWith(EmployeeCareerEvent, {
      where: {
        employeeProfileId: 'profile-1',
        ladderId: 'ladder-type',
        effectiveAt: MoreThanOrEqual(HIRED),
      },
      select: ['id'],
    });
  });

  it('gives a rehire a fresh event even with events from the previous stint', async () => {
    // Older events do not match `effectiveAt >= rehire date`.
    const m = manager();
    const rehired = new Date('2027-01-10T00:00:00.000Z');
    await recordEntryCareerEvents(m as any, profile, {
      decidedByAccountId: null,
      note: 'Vào làm',
      effectiveAt: rehired,
    });
    expect(m.save).toHaveBeenCalledWith(
      EmployeeCareerEvent,
      expect.objectContaining({ ladderId: 'ladder-type', effectiveAt: rehired }),
    );
  });

  it('maps each dimension to its profile column', () => {
    expect(ladderProfileColumn(LadderDimension.EMPLOYMENT_TYPE)).toBe('employeeTypeId');
    expect(ladderProfileColumn(LadderDimension.POSITION)).toBe('storeRoleId');
    expect(ladderProfileColumn(LadderDimension.SKILL)).toBe('skillId');
    expect(ladderProfileColumn('other' as LadderDimension)).toBeNull();
  });
});
