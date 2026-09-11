import { DataSource, Repository } from 'typeorm';
import { DevicesService } from './devices.service';
import { UserDevice } from './entities/user-device.entity';

describe('device binding aggregate deadline', () => {
  afterEach(() => jest.useRealTimers());
  const harness = () => {
    const runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: true,
      query: jest.fn(async (_sql: string, _params?: unknown[]) => []),
      manager: {} as { query: (sql: string) => Promise<unknown> },
    };
    runner.manager.query = (sql) => runner.query(sql);
    const service = new DevicesService(
      {} as Repository<UserDevice>,
      { createQueryRunner: () => runner } as unknown as DataSource,
    );
    return { runner, service };
  };

  it('recomputes the remaining SQL budget and never starts another mutation after expiry', async () => {
    jest.useFakeTimers();
    const { runner, service } = harness();
    const raw = runner.query;
    raw.mockImplementation(async (sql) => {
      if (sql === 'first') jest.advanceTimersByTime(7_000);
      if (sql === 'second') jest.advanceTimersByTime(6_000);
      return [];
    });
    await expect(
      (service as any).runBindingOperation(
        async (manager: typeof runner.manager) => {
          await manager.query('first');
          await manager.query('second');
          await manager.query('forbidden');
        },
      ),
    ).rejects.toThrow('DEVICE_BINDING_BUSY');
    expect(
      raw.mock.calls
        .filter(([sql]) => sql.includes('set_config'))
        .map(([, params]) => params),
    ).toEqual([['12000ms'], ['5000ms']]);
    expect(raw.mock.calls.some(([sql]) => sql === 'forbidden')).toBe(false);
    expect(runner.commitTransaction).not.toHaveBeenCalled();
    expect(runner.rollbackTransaction).toHaveBeenCalled();
  });

  it('bounds connection acquisition and releases a late connection without mutating', async () => {
    jest.useFakeTimers();
    const { runner, service } = harness();
    let connect!: () => void;
    runner.connect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          connect = resolve;
        }),
    );
    const work = jest.fn();
    const result = expect(
      (service as any).runBindingOperation(work),
    ).rejects.toThrow('DEVICE_BINDING_BUSY');
    await jest.advanceTimersByTimeAsync(12_000);
    await result;
    connect();
    await Promise.resolve();
    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(runner.startTransaction).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });
});
