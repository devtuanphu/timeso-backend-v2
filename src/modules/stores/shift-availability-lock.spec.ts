import { EntityManager } from 'typeorm';
import { lockStoreShiftAvailability } from './shift-availability-lock';

describe('lockStoreShiftAvailability', () => {
  it('uses a transaction-scoped parameterized PostgreSQL advisory lock', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([{ pg_advisory_xact_lock: null }]);

    await lockStoreShiftAvailability(
      { query } as unknown as EntityManager,
      'store-1',
    );

    expect(query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      ['timeso:shift-availability:store:store-1'],
    );
  });
});
