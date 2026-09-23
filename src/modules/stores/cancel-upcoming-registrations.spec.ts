import { ForbiddenException } from '@nestjs/common';
import { Brackets } from 'typeorm';

import { StoresService } from './stores.service';
import { ShiftAssignmentStatus } from './entities/shift-management.entity';

/**
 * A "fixed" registration fans out into one ShiftAssignment per matching slot
 * with nothing linking them, so switching the fixed schedule off cannot delete
 * a registration record — there isn't one. It withdraws the caller's own
 * self-registered shifts that have not started yet (PENDING, or APPROVED by
 * the owner later), never an owner assignment, and never anything worked.
 */
const STORE = 'store-1';
const PROFILE = 'profile-1';
const ACCOUNT = 'account-1';
// 2026-09-22 10:00 in Vietnam (03:00 UTC).
const NOW = new Date('2026-09-22T03:00:00Z');

type Row = {
  id: string;
  status: ShiftAssignmentStatus;
  workDate: string;
  slotStartTime: string | null;
  shiftStartTime: string | null;
};

/** Flattens nested Brackets into the SQL fragments and parameters used. */
function collect(sink: { clauses: string[]; params: Record<string, unknown> }) {
  const qb: any = {};
  const add = (clause: unknown, params?: Record<string, unknown>) => {
    if (clause instanceof Brackets) {
      clause.whereFactory(collect(sink));
    } else {
      sink.clauses.push(String(clause));
    }
    Object.assign(sink.params, params ?? {});
    return qb;
  };
  qb.where = jest.fn(add);
  qb.andWhere = jest.fn(add);
  qb.orWhere = jest.fn(add);
  return qb;
}

function build(profile: unknown, rows: Row[] = []) {
  const service = Object.create(StoresService.prototype) as any;
  const sink = { clauses: [] as string[], params: {} as Record<string, unknown> };
  const builder = collect(sink);
  for (const m of ['innerJoin', 'leftJoin', 'select', 'addSelect']) {
    builder[m] = jest.fn(() => builder);
  }
  builder.getRawMany = jest.fn().mockResolvedValue(rows);
  service.logger = { error: jest.fn() };
  service.profileRepository = { findOne: jest.fn().mockResolvedValue(profile) };
  service.shiftAssignmentRepository = {
    createQueryBuilder: jest.fn(() => builder),
    update: jest.fn().mockResolvedValue({ affected: rows.length }),
  };
  service.shiftReminderService = {
    cancelAssignmentReminders: jest.fn().mockResolvedValue(undefined),
  };
  return { service, sink };
}

const row = (over: Partial<Row>): Row => ({
  id: 'a1',
  status: ShiftAssignmentStatus.PENDING,
  workDate: '2026-09-23',
  slotStartTime: null,
  shiftStartTime: '08:00:00',
  ...over,
});

describe('cancelUpcomingShiftRegistrations', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it('cancels the caller’s pending and later-approved self-registrations', async () => {
    const { service } = build({ id: PROFILE }, [
      row({ id: 'pending' }),
      row({ id: 'approved', status: ShiftAssignmentStatus.APPROVED }),
    ]);

    const result = await service.cancelUpcomingShiftRegistrations(
      STORE,
      PROFILE,
      ACCOUNT,
    );

    expect(result).toEqual({ cancelled: 2 });
    const [criteria, changes] = service.shiftAssignmentRepository.update.mock.calls[0];
    expect(criteria.id.value).toEqual(['pending', 'approved']);
    // Guarded: rows checked in or decided meanwhile are not touched.
    expect(criteria.status.value).toEqual([
      ShiftAssignmentStatus.PENDING,
      ShiftAssignmentStatus.APPROVED,
    ]);
    expect(criteria.checkInTime.type).toBe('isNull');
    expect(changes).toEqual({ status: ShiftAssignmentStatus.CANCELLED });
    // Only approved rows had reminders.
    expect(service.shiftReminderService.cancelAssignmentReminders).toHaveBeenCalledWith([
      'approved',
    ]);
  });

  it('selects only self-registrations: PENDING, or APPROVED after insert and not owner notes', async () => {
    const { service, sink } = build({ id: PROFILE }, []);

    await service.cancelUpcomingShiftRegistrations(STORE, PROFILE, ACCOUNT);

    expect(sink.clauses).toEqual(
      expect.arrayContaining([
        'a.employeeId = :employeeProfileId',
        'cycle.storeId = :storeId',
        'a.checkInTime IS NULL',
        'slot.workDate >= :today',
        'a.status = :pending',
        'a.status = :approved',
        "a.updated_at > a.created_at + interval '2 seconds'",
        '(a.note IS NULL OR a.note NOT IN (:...ownerNotes))',
      ]),
    );
    expect(sink.params).toMatchObject({
      pending: ShiftAssignmentStatus.PENDING,
      approved: ShiftAssignmentStatus.APPROVED,
      ownerNotes: ['Owner assigned during shift creation', 'Auto-assigned from cycle'],
      // Vietnam day, not the server's.
      today: '2026-09-22',
    });
    // The old broad "every APPROVED row" filter is gone.
    expect(sink.clauses).not.toContain('a.status = :status');
  });

  it('uses the Vietnam date just after midnight VN (still yesterday in UTC)', async () => {
    jest.setSystemTime(new Date('2026-09-21T17:30:00Z')); // 00:30 VN on 22/09
    const { service, sink } = build({ id: PROFILE }, []);

    await service.cancelUpcomingShiftRegistrations(STORE, PROFILE, ACCOUNT);

    expect(sink.params.today).toBe('2026-09-22');
  });

  it('keeps shifts that already started today (VN time)', async () => {
    const { service } = build({ id: PROFILE }, [
      // 08:00 VN today: started at 10:00 VN.
      row({ id: 'started', workDate: '2026-09-22', shiftStartTime: '08:00:00' }),
      // Slot override 18:00 today: not started.
      row({ id: 'tonight', workDate: '2026-09-22', slotStartTime: '18:00' }),
    ]);

    const result = await service.cancelUpcomingShiftRegistrations(
      STORE,
      PROFILE,
      ACCOUNT,
    );

    expect(result).toEqual({ cancelled: 1 });
    const [criteria] = service.shiftAssignmentRepository.update.mock.calls[0];
    expect(criteria.id.value).toEqual(['tonight']);
  });

  it('narrows to one work shift when asked', async () => {
    const { service, sink } = build({ id: PROFILE }, []);

    await service.cancelUpcomingShiftRegistrations(
      STORE,
      PROFILE,
      ACCOUNT,
      'workshift-9',
    );

    expect(sink.params.workShiftId).toBe('workshift-9');
  });

  it('writes nothing when there is nothing upcoming', async () => {
    const { service } = build({ id: PROFILE }, []);

    const result = await service.cancelUpcomingShiftRegistrations(
      STORE,
      PROFILE,
      ACCOUNT,
    );

    expect(result).toEqual({ cancelled: 0 });
    expect(service.shiftAssignmentRepository.update).not.toHaveBeenCalled();
  });

  // Self-service only: the profile must belong to the authenticated account.
  it('refuses to cancel someone else’s shifts', async () => {
    const { service } = build(null);

    await expect(
      service.cancelUpcomingShiftRegistrations(STORE, PROFILE, 'another-account'),
    ).rejects.toThrow(ForbiddenException);
    expect(service.shiftAssignmentRepository.update).not.toHaveBeenCalled();
  });
});
