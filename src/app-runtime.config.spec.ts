import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BullModule, BullRegistrar, getQueueToken } from '@nestjs/bullmq';
import { Cron, Interval, ScheduleModule, SchedulerRegistry, Timeout } from '@nestjs/schedule';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  getAppBullExtraOptions,
  getAppScheduleOptions,
  resolveLocalApiOnly,
} from './app-runtime.config';

@Injectable()
class ScheduledProbe {
  @Cron('0 0 1 1 *', { name: 'probe-cron' })
  cron() {}

  @Interval('probe-interval', 60_000)
  interval() {}

  @Timeout('probe-timeout', 60_000)
  timeout() {}
}

describe('local API-only runtime configuration', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([undefined, '', 'false'])('preserves full runtime for flag %s', (value) => {
    expect(resolveLocalApiOnly({ TIMESO_LOCAL_API_ONLY: value })).toBe(false);
  });

  it('requires explicit development mode', () => {
    expect(resolveLocalApiOnly({ NODE_ENV: 'development', TIMESO_LOCAL_API_ONLY: 'true' })).toBe(true);
    for (const environment of [undefined, 'test', 'production']) {
      expect(() => resolveLocalApiOnly({ NODE_ENV: environment, TIMESO_LOCAL_API_ONLY: 'true' })).toThrow('requires NODE_ENV=development');
    }
    expect(() => resolveLocalApiOnly({ NODE_ENV: 'development', TIMESO_LOCAL_API_ONLY: 'yes' })).toThrow('must be true or false');
  });

  it('keeps one mode even if configuration loads later', async () => {
    jest.replaceProperty(process, 'env', { ...process.env, NODE_ENV: 'development', TIMESO_LOCAL_API_ONLY: 'true' });
    await jest.isolateModulesAsync(async () => {
      const runtime = await import('./app-runtime.config');
      process.env.TIMESO_LOCAL_API_ONLY = 'false';
      expect(runtime.isLocalApiOnly()).toBe(true);
      expect(runtime.getAppScheduleOptions().cronJobs).toBe(false);
      expect(runtime.getAppBullExtraOptions().manualRegistration).toBe(true);
    });
  });

  it.each([true, false])('registers schedules/workers only for full mode (API-only=%s)', async (apiOnly) => {
    // Stub registration before Nest init, and replace the queue provider: this
    // test never creates a Redis connection or consumes any existing jobs.
    const register = jest.spyOn(BullRegistrar.prototype, 'register').mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      imports: [
        ScheduleModule.forRoot(getAppScheduleOptions(apiOnly)),
        ScheduleModule.forRoot(getAppScheduleOptions(apiOnly)),
        BullModule.forRootAsync({
          extraOptions: getAppBullExtraOptions(apiOnly),
          useFactory: () => ({ connection: { host: 'unused.invalid' } }),
        }),
        BullModule.registerQueue({ name: 'probe-queue' }),
      ],
      providers: [ScheduledProbe],
    }).overrideProvider(getQueueToken('probe-queue')).useValue({}).compile();
    const app = moduleRef.createNestApplication();
    try {
      await app.init();
      const registry = app.get(SchedulerRegistry);
      expect(registry.getCronJobs().size).toBe(apiOnly ? 0 : 1);
      expect(registry.getIntervals()).toHaveLength(apiOnly ? 0 : 1);
      expect(registry.getTimeouts()).toHaveLength(apiOnly ? 0 : 1);
      expect(register).toHaveBeenCalledTimes(apiOnly ? 0 : 1);
    } finally {
      await app.close();
    }
  });

  it('wires the policy to both existing scheduler roots and the global Bull root', () => {
    for (const file of ['app.module.ts', 'modules/stores/stores.module.ts']) {
      expect(readFileSync(join(__dirname, file), 'utf8')).toContain('ScheduleModule.forRoot(getAppScheduleOptions())');
    }
    expect(readFileSync(join(__dirname, 'app.module.ts'), 'utf8')).toContain('extraOptions: getAppBullExtraOptions()');
  });
});
