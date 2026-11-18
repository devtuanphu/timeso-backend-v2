import { EntityManager } from 'typeorm';

const SHIFT_AVAILABILITY_LOCK_NAMESPACE = 'timeso:shift-availability:store:';

/**
 * Serializes transactions that can change the point-in-time predicates used
 * while creating a shift schedule. The lock is owned by PostgreSQL and is
 * released automatically with the surrounding transaction.
 */
export async function lockStoreShiftAvailability(
  manager: EntityManager,
  storeId: string,
): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `${SHIFT_AVAILABILITY_LOCK_NAMESPACE}${storeId}`,
  ]);
}

const WORK_SUPPLEMENT_LOCK_NAMESPACE = 'work-supplement:';

/**
 * Serializes "Bổ sung công" approvals for ONE employee. Two owners (or two
 * taps) approving supplements for the same person at once must not both create
 * an ad-hoc shift or both credit the same assignment, so the whole candidate
 * search + crediting runs under this lock. PostgreSQL releases it with the
 * surrounding transaction.
 *
 * Lock order: acquire this employee lock FIRST, then any store lock, so two
 * flows that take both never deadlock.
 */
export async function lockEmployeeWorkSupplement(
  manager: EntityManager,
  employeeProfileId: string,
): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `${WORK_SUPPLEMENT_LOCK_NAMESPACE}${employeeProfileId}`,
  ]);
}
