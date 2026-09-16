import { ForbiddenException } from '@nestjs/common';

import { StoresService } from './stores.service';
import { ShiftAssignmentStatus } from './entities/shift-management.entity';

/**
 * A "fixed" registration fans out into one ShiftAssignment per matching slot
 * with nothing linking them, so switching the fixed schedule off cannot delete
 * a registration record — there isn't one. It withdraws the shifts that have
 * not started yet, and must not touch anything already worked.
 */
const STORE = 'store-1';
const PROFILE = 'profile-1';
const ACCOUNT = 'account-1';

function build(profile: unknown, doomed: { id: string }[] = []) {
  const service = Object.create(StoresService.prototype) as any;
  const conditions: Record<string, unknown> = {};
  const builder: any = {
    leftJoin: jest.fn(() => builder),
    where: jest.fn((clause: string, params: any) => {
      Object.assign(conditions, params ?? {});
      conditions[clause] = true;
      return builder;
    }),
    andWhere: jest.fn((clause: string, params: any) => {
      Object.assign(conditions, params ?? {});
      conditions[clause] = true;
      return builder;
    }),
    select: jest.fn(() => builder),
    getMany: jest.fn().mockResolvedValue(doomed),
  };
  service.profileRepository = { findOne: jest.fn().mockResolvedValue(profile) };
  service.shiftAssignmentRepository = {
    createQueryBuilder: jest.fn(() => builder),
    update: jest.fn().mockResolvedValue({ affected: doomed.length }),
  };
  return { service, builder, conditions };
}

describe('cancelUpcomingShiftRegistrations', () => {
  it('cancels the caller’s upcoming approved shifts', async () => {
    const { service } = build({ id: PROFILE }, [{ id: 'a1' }, { id: 'a2' }]);

    const result = await service.cancelUpcomingShiftRegistrations(
      STORE,
      PROFILE,
      ACCOUNT,
    );

    expect(result).toEqual({ cancelled: 2 });
    expect(service.shiftAssignmentRepository.update).toHaveBeenCalledWith(
      expect.anything(),
      { status: ShiftAssignmentStatus.CANCELLED },
    );
  });

  // The whole point of the narrow scope: history stays intact.
  it('only targets approved, not-checked-in shifts from today onward', async () => {
    const { service, conditions } = build({ id: PROFILE }, [{ id: 'a1' }]);

    await service.cancelUpcomingShiftRegistrations(STORE, PROFILE, ACCOUNT);

    expect(conditions['a.status = :status']).toBe(true);
    expect(conditions.status).toBe(ShiftAssignmentStatus.APPROVED);
    expect(conditions['a.checkInTime IS NULL']).toBe(true);
    expect(conditions['slot.workDate >= :today']).toBe(true);
    // A local-date string, never a UTC one: at UTC+7 an ISO date is still
    // yesterday for the first seven hours and would cancel today's shift.
    expect(conditions.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('narrows to one work shift when asked', async () => {
    const { service, conditions } = build({ id: PROFILE }, [{ id: 'a1' }]);

    await service.cancelUpcomingShiftRegistrations(
      STORE,
      PROFILE,
      ACCOUNT,
      'workshift-9',
    );

    expect(conditions.workShiftId).toBe('workshift-9');
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
