import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import {
  DataSource,
  EntityManager,
  In,
  QueryFailedError,
  QueryRunner,
  Repository,
} from 'typeorm';
import { UserDevice } from './entities/user-device.entity';
import { RegisterDeviceDto } from './dto/register-device.dto';

class DeviceRegistrationRetryError extends Error {}
export const DEVICE_BINDING_OPERATION_TIMEOUT_MS = 12_000;

export interface RegisteredDevice {
  deviceId: string;
  platform: 'android' | 'ios';
  appVersion: string | null;
  registrationVersion: string;
  isActive: boolean;
}

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(UserDevice)
    private readonly deviceRepository: Repository<UserDevice>,
    private readonly dataSource: DataSource,
  ) {}

  async register(
    userId: string,
    dto: RegisterDeviceDto,
  ): Promise<RegisteredDevice> {
    const fingerprint = this.fingerprint(dto.expoPushToken);
    return this.toResponse(
      await this.runBindingOperation((manager) =>
        this.registerInTransaction(manager, userId, dto, fingerprint),
      ),
    );
  }

  private async runBindingOperation<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const deadline = performance.now() + DEVICE_BINDING_OPERATION_TIMEOUT_MS;
    const remaining = () => {
      const ms = Math.floor(deadline - performance.now());
      if (ms <= 0) throw new ServiceUnavailableException('DEVICE_BINDING_BUSY');
      return ms;
    };
    for (;;) {
      remaining();
      const runner = this.dataSource.createQueryRunner();
      let connected = false;
      const rawQuery = runner.query.bind(runner);
      let connectTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const connection = runner.connect();
        let acquisitionExpired = false;
        void connection.then(
          () => {
            if (acquisitionExpired)
              void runner.release().catch(() => undefined);
          },
          () => undefined,
        );
        await Promise.race([
          connection,
          new Promise<never>((_, reject) => {
            connectTimer = setTimeout(() => {
              acquisitionExpired = true;
              reject(new ServiceUnavailableException('DEVICE_BINDING_BUSY'));
            }, remaining());
          }),
        ]);
        clearTimeout(connectTimer);
        connected = true;
        remaining();
        await runner.startTransaction();
        // Intercept ORM-generated statements too (including save's internal reads).
        // Each SQL receives the remaining aggregate budget, not a fresh 12 seconds.
        runner.query = (async (...args: Parameters<QueryRunner['query']>) => {
          const ms = remaining();
          await rawQuery(
            "SELECT set_config('lock_timeout', $1, true), set_config('statement_timeout', $1, true)",
            [`${ms}ms`],
          );
          remaining();
          const result = await rawQuery(...args);
          remaining();
          return result;
        }) as QueryRunner['query'];
        const result = await work(runner.manager);
        remaining();
        await runner.commitTransaction();
        return result;
      } catch (error) {
        if (!this.isRetryableRegistrationRace(error)) throw error;
        remaining();
      } finally {
        if (connectTimer) clearTimeout(connectTimer);
        runner.query = rawQuery;
        if (connected) {
          if (runner.isTransactionActive)
            await runner.rollbackTransaction().catch(() => undefined);
          await runner.release().catch(() => undefined);
        }
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(50, remaining())),
      );
    }
  }

  async getActiveDevicesByUser(userId: string): Promise<UserDevice[]> {
    return this.deviceRepository.find({
      where: { userId, isActive: true },
    });
  }

  async disableOwnedDevice(userId: string, deviceId: string): Promise<void> {
    await this.runBindingOperation(async (manager) => {
      const repository = manager.getRepository(UserDevice);
      const current = await repository.findOne({
        where: { deviceId, userId, isActive: true },
      });
      if (!current) return;
      const keys = [
        `device:${deviceId}`,
        ...(current.pushTokenFingerprint
          ? [`push:${current.pushTokenFingerprint}`]
          : []),
      ].sort();
      for (const key of keys)
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [key],
        );
      const locked = await repository.findOne({
        where: { deviceId, userId, isActive: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) return;
      if (locked.pushTokenFingerprint !== current.pushTokenFingerprint)
        throw new DeviceRegistrationRetryError();
      await repository.update(
        { id: locked.id, userId, deviceId, isActive: true },
        { isActive: false, pushTokenFingerprint: null },
      );
    });
  }

  async disableInvalidDevice(expected: {
    id: string;
    userId: string;
    deviceId: string;
    pushTokenFingerprint: string;
    registrationVersion: string;
  }): Promise<boolean> {
    const result = await this.deviceRepository.update(
      {
        id: expected.id,
        userId: expected.userId,
        deviceId: expected.deviceId,
        pushTokenFingerprint: expected.pushTokenFingerprint,
        registrationVersion: expected.registrationVersion,
        isActive: true,
      },
      { isActive: false, pushTokenFingerprint: null },
    );
    return result.affected === 1;
  }

  private async registerInTransaction(
    manager: EntityManager,
    userId: string,
    dto: RegisterDeviceDto,
    fingerprint: string,
  ): Promise<UserDevice> {
    const discovered = (await manager.query(
      `SELECT push_token_fingerprint AS "pushTokenFingerprint"
       FROM user_devices
       WHERE device_id = $1 OR expo_push_token = $2`,
      [dto.deviceId, dto.expoPushToken],
    )) as Array<{ pushTokenFingerprint: string | null }>;
    const discoveredFingerprints = discovered
      .map((row) => row.pushTokenFingerprint)
      .filter((value): value is string => Boolean(value));
    const lockKeys = [
      ...new Set([
        `device:${dto.deviceId}`,
        `push:${fingerprint}`,
        ...discoveredFingerprints.map((value) => `push:${value}`),
      ]),
    ].sort();
    for (const key of lockKeys) {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [key],
      );
    }

    const repository = manager.getRepository(UserDevice);
    const candidates = await repository
      .createQueryBuilder('device')
      .withDeleted()
      .where('device.deviceId = :deviceId', { deviceId: dto.deviceId })
      .orWhere('device.expoPushToken = :token', { token: dto.expoPushToken })
      .orderBy('device.lastSeenAt', 'DESC', 'NULLS LAST')
      .addOrderBy('device.updatedAt', 'DESC')
      .addOrderBy('device.id', 'DESC')
      .setLock('pessimistic_write')
      .getMany();

    const currentFingerprints = [
      ...new Set(
        candidates
          .map((device) => device.pushTokenFingerprint)
          .filter(
            (value): value is string => Boolean(value) && value !== fingerprint,
          ),
      ),
    ];
    const heldKeys = new Set(lockKeys);
    if (currentFingerprints.some((value) => !heldKeys.has(`push:${value}`))) {
      throw new DeviceRegistrationRetryError();
    }

    let winner = candidates.find((device) => device.deviceId === dto.deviceId);
    winner ||= candidates[0];

    const loserIds = candidates
      .filter((device) => device.id !== winner?.id)
      .map((device) => device.id);
    if (loserIds.length > 0) {
      await repository.update(
        { id: In(loserIds) },
        { isActive: false, pushTokenFingerprint: null },
      );
    }

    const bindingChanged =
      !winner ||
      winner.userId !== userId ||
      winner.deviceId !== dto.deviceId ||
      winner.pushTokenFingerprint !== fingerprint ||
      !winner.isActive ||
      winner.deletedAt !== null;

    if (!winner) {
      winner = repository.create({
        userId,
        deviceId: dto.deviceId,
        expoPushToken: dto.expoPushToken,
        pushTokenFingerprint: fingerprint,
        registrationVersion: '1',
        platform: dto.platform,
        appVersion: dto.appVersion || null,
        isActive: true,
        lastSeenAt: new Date(),
      });
    } else {
      winner.userId = userId;
      winner.deviceId = dto.deviceId;
      winner.expoPushToken = dto.expoPushToken;
      winner.pushTokenFingerprint = fingerprint;
      winner.registrationVersion = bindingChanged
        ? (BigInt(winner.registrationVersion || '0') + 1n).toString()
        : winner.registrationVersion;
      winner.platform = dto.platform;
      winner.appVersion = dto.appVersion || null;
      winner.isActive = true;
      winner.lastSeenAt = new Date();
      winner.deletedAt = null;
    }

    return repository.save(winner);
  }

  private fingerprint(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private isRetryableRegistrationRace(error: unknown): boolean {
    if (error instanceof DeviceRegistrationRetryError) return true;
    if (!(error instanceof QueryFailedError)) return false;
    const code = (
      error as QueryFailedError & { driverError?: { code?: string } }
    ).driverError?.code;
    return ['23505', '40P01', '40001', '55P03', '57014'].includes(code || '');
  }

  private toResponse(device: UserDevice): RegisteredDevice {
    return {
      deviceId: device.deviceId,
      platform: device.platform,
      appVersion: device.appVersion || null,
      registrationVersion: device.registrationVersion,
      isActive: device.isActive,
    };
  }
}
