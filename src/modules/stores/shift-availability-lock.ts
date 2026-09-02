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
