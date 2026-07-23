import { DistributedLockService } from './distributed-lock.service';

describe('DistributedLockService read-only startup', () => {
  const repository = { create: jest.fn() };
  const dataSource = { query: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    dataSource.query.mockResolvedValue(undefined);
  });

  it('skips cron lock table creation in read-only mode', async () => {
    const service = new DistributedLockService(
      repository as any,
      dataSource as any,
      { get: jest.fn().mockReturnValue('true') } as any,
    );

    await service.onModuleInit();

    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('keeps the existing table ensure behavior by default', async () => {
    const service = new DistributedLockService(
      repository as any,
      dataSource as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
    );

    await service.onModuleInit();

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS cron_locks'),
    );
  });
});
