import { DataSource, Repository } from 'typeorm';

import { DevicesService } from './devices.service';
import { UserDevice } from './entities/user-device.entity';

const dto = {
  deviceId: 'ios-installation-1',
  expoPushToken: 'ExpoPushToken[token_1]',
  platform: 'ios' as const,
  appVersion: '18.0.8',
};

const createHarness = (candidate?: Partial<UserDevice>) => {
  const entity = candidate
    ? ({
        id: '11111111-1111-4111-8111-111111111111',
        userId: 'account-1',
        deviceId: dto.deviceId,
        expoPushToken: dto.expoPushToken,
        pushTokenFingerprint: null,
        registrationVersion: '0',
        platform: 'ios',
        appVersion: 'old',
        isActive: true,
        lastSeenAt: new Date(),
        deletedAt: null,
        ...candidate,
      } as UserDevice)
    : undefined;
  const builder = {
    withDeleted: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(entity ? [entity] : []),
  };
  const transactionUpdate = jest.fn().mockResolvedValue({ affected: 1 });
  const transactionRepository = {
    createQueryBuilder: jest.fn(() => builder),
    create: jest.fn((value) => value),
    findOne: jest.fn().mockResolvedValue(entity || null),
    update: transactionUpdate,
    save: jest.fn(async (value) => ({ id: entity?.id || 'new-id', ...value })),
  };
  const manager = {
    query: jest.fn(async (query: string) => {
      if (query.includes('push_token_fingerprint AS')) {
        return entity?.pushTokenFingerprint
          ? [{ pushTokenFingerprint: entity.pushTokenFingerprint }]
          : [];
      }
      if (query.includes('pg_try_advisory_xact_lock'))
        return [{ acquired: true }];
      return [];
    }),
    getRepository: jest.fn(() => transactionRepository),
  };
  const repositoryUpdate = jest.fn().mockResolvedValue({ affected: 1 });
  const repository = {
    find: jest.fn(),
    update: repositoryUpdate,
  } as unknown as Repository<UserDevice>;
  const dataSource = {
    createQueryRunner: jest.fn(() => ({
      manager,
      query: manager.query,
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    })),
  } as unknown as DataSource;
  return {
    service: new DevicesService(repository, dataSource),
    manager,
    repository,
    repositoryUpdate,
    transactionRepository,
    transactionUpdate,
  };
};

describe('DevicesService', () => {
  it('locks device and token ownership before registering and enrolls legacy rows', async () => {
    const { service, manager } = createHarness();
    const result = await service.register('account-1', dto);
    expect(manager.query).toHaveBeenCalledTimes(3);
    expect(manager.query.mock.calls[0][0]).toContain(
      'push_token_fingerprint AS',
    );
    for (const call of manager.query.mock.calls.slice(1)) {
      expect(call[0]).toContain('pg_advisory_xact_lock');
    }
    expect(result).toMatchObject({
      deviceId: dto.deviceId,
      registrationVersion: '1',
      isActive: true,
    });
    expect(result).not.toHaveProperty('expoPushToken');
  });

  it('does not increment the security binding version on an unchanged resume', async () => {
    const crypto = await import('crypto');
    const fingerprint = crypto
      .createHash('sha256')
      .update(dto.expoPushToken)
      .digest('hex');
    const { service } = createHarness({
      pushTokenFingerprint: fingerprint,
      registrationVersion: '7',
      appVersion: '17.0.0',
    });
    await expect(service.register('account-1', dto)).resolves.toMatchObject({
      registrationVersion: '7',
      appVersion: '18.0.8',
    });
  });

  it('scopes logout and invalid-token deactivation to the expected owner binding', async () => {
    const { service, repositoryUpdate, transactionUpdate } = createHarness({
      pushTokenFingerprint: 'a'.repeat(64),
      registrationVersion: '2',
    });
    await service.disableOwnedDevice('account-1', dto.deviceId);
    await service.disableInvalidDevice({
      id: 'device-row',
      userId: 'account-1',
      deviceId: dto.deviceId,
      pushTokenFingerprint: 'a'.repeat(64),
      registrationVersion: '2',
    });
    expect(transactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'account-1', deviceId: dto.deviceId }),
      { isActive: false, pushTokenFingerprint: null },
    );
    expect(repositoryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'account-1',
        registrationVersion: '2',
      }),
      { isActive: false, pushTokenFingerprint: null },
    );
  });
});
