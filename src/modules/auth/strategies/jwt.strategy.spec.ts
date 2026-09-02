import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { Account, AccountStatus } from '../../accounts/entities/account.entity';
import { JWT_ACCESS_TOKEN_USE, JWT_REFRESH_TOKEN_USE } from '../jwt.config';
import { JwtStrategy } from './jwt.strategy';

const createStrategy = (
  account: Pick<Account, 'id'> | null,
  values: Record<string, string> = {},
) => {
  const findOne = jest.fn().mockResolvedValue(account);
  const repository = {
    findOne,
  } as unknown as Repository<Account>;
  const config = {
    get: jest.fn((key: string) =>
      key === 'JWT_SECRET' ? 'test-only-secret' : values[key],
    ),
  } as unknown as ConfigService;
  return { strategy: new JwtStrategy(config, repository), findOne };
};

describe('JwtStrategy account revocation', () => {
  it('accepts only a non-deleted active account resolved by the repository', async () => {
    const { strategy, findOne } = createStrategy({ id: 'account-id' });
    await expect(
      strategy.validate({
        sub: 'account-id',
        email: 'ignored@example.test',
        tokenUse: JWT_ACCESS_TOKEN_USE,
      }),
    ).resolves.toEqual({ userId: 'account-id', email: 'ignored@example.test' });
    expect(findOne).toHaveBeenCalledWith({
      where: { id: 'account-id', status: AccountStatus.ACTIVE },
      select: { id: true },
    });
  });

  it.each(['blocked', 'deleted', 'missing-sub'])('rejects %s tokens', async (kind) => {
    const { strategy } = createStrategy(null);
    await expect(
      strategy.validate(
        kind === 'missing-sub'
          ? {}
          : { sub: 'account-id', tokenUse: JWT_ACCESS_TOKEN_USE },
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects refresh and legacy undiscriminated tokens before account lookup', async () => {
    const { strategy, findOne } = createStrategy({ id: 'account-id' });
    await expect(
      strategy.validate({ sub: 'account-id', tokenUse: JWT_REFRESH_TOKEN_USE }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(strategy.validate({ sub: 'account-id' })).rejects.toMatchObject({
      status: 401,
    });
    expect(findOne).not.toHaveBeenCalled();
  });

  it('accepts a legacy untyped access token only inside the configured window', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-30T00:00:00Z'));
    const { strategy } = createStrategy({ id: 'account-id' }, {
      JWT_LEGACY_UNTYPED_WINDOW_STARTED_AT: '2026-08-29T00:00:00Z',
      JWT_LEGACY_UNTYPED_CUTOFF_AT: '2026-09-05T00:00:00Z',
      JWT_LEGACY_UNTYPED_ACCESS_ATTESTED: 'true',
    });
    await expect(strategy.validate({ sub: 'account-id' })).resolves.toEqual({
      userId: 'account-id',
      email: undefined,
    });
    jest.useRealTimers();
  });
});
