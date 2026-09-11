import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

// `uuid` ships ESM only and is reached through AppModule -> multer-config.
// Without this the file fails to parse, which is why the guard below never
// had a chance to run. The other database-backed e2e files do the same.
jest.mock('uuid', () => ({ v4: () => 'test-upload-id' }));

/**
 * This boots the whole AppModule, which reads the repository `.env` and opens
 * TypeORM and Redis connections, and registers every `@Cron` handler because
 * `NODE_ENV` is unset under `test:e2e`. Unguarded it pointed at whatever the
 * developer's `.env` names — which is neither loopback nor a `_test` database.
 *
 * It now follows the same opt-in contract as the other database-backed e2e
 * files: explicit `TIMESO_ISOLATED_DB=true` plus a database name ending in
 * `_test`. Without both it skips rather than connecting.
 */
const isIsolatedTestDatabase =
  process.env.TIMESO_ISOLATED_DB === 'true' &&
  /(_test|_local)$/.test(process.env.DATABASE_NAME ?? '');

const describeWithIsolatedDatabase = isIsolatedTestDatabase
  ? describe
  : describe.skip;

describeWithIsolatedDatabase('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  // The module graph holds database and Redis connections; without this they
  // were never released.
  afterAll(async () => {
    await app?.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
