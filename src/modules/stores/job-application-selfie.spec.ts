import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AccountStatus } from '../accounts/entities/account.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JobApplicationStatus } from './entities/job-application.entity';
import { StoreStatus } from './entities/store.entity';
import {
  JOB_APPLICATION_SELFIE_DIR,
  JobApplicationSelfieCleanupInterceptor,
  JobApplicationSelfieStorage,
} from './job-application-selfie.storage';
import { JobApplicationController } from './job-application.controller';
import { JobApplicationService } from './job-application.service';

/**
 * Real multer → cleanup interceptor → global ValidationPipe → real service →
 * real selfie storage on a throwaway directory. Only the repositories are
 * faked, so these tests prove where the file lands and when it is removed.
 */

const STORE = '11111111-1111-4111-8111-111111111111';
const OTHER_STORE = '22222222-2222-4222-8222-222222222222';
const APPLICATION = '33333333-3333-4333-8333-333333333333';
const OWNER = 'owner-account';
const OTHER_OWNER = 'other-owner-account';
const APPLICANT = 'applicant-account';
const MEMBER = 'employee-account';

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF-test-body'),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png-test-body'),
]);

const form = {
  fullName: 'Nguyễn Văn A',
  phone: '0900000000',
  address: '12 Lê Lợi, Quận 1',
};

describe('job application selfie (HTTP + filesystem)', () => {
  let app: INestApplication;
  let workdir: string;
  let originalCwd: string;
  let selfieDir: string;
  let storage: JobApplicationSelfieStorage;
  let rows: Map<string, any>;
  let applicationRepository: any;

  const listSelfies = () =>
    existsSync(selfieDir) ? readdirSync(selfieDir) : [];

  beforeAll(async () => {
    originalCwd = process.cwd();
    workdir = mkdtempSync(join(tmpdir(), 'job-app-selfie-'));
    process.chdir(workdir);
    selfieDir = join(workdir, JOB_APPLICATION_SELFIE_DIR);

    storage = new JobApplicationSelfieStorage();

    rows = new Map();
    applicationRepository = {
      findOne: jest.fn(async ({ where }: any) => {
        if (where.id) return rows.get(where.id) ?? null;
        // apply: "already has a pending application here?"
        return (
          [...rows.values()].find(
            (row) =>
              row.storeId === where.storeId &&
              row.accountId === where.accountId &&
              row.status === where.status,
          ) ?? null
        );
      }),
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((value: any) => value),
      save: jest.fn(async (value: any) => {
        const saved = {
          id: APPLICATION,
          createdAt: new Date('2026-09-01T00:00:00Z'),
          reviewedAt: null,
          rejectionReason: null,
          ...value,
        };
        rows.set(saved.id, saved);
        return saved;
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const storeRepository = {
      findOne: jest.fn(async ({ where }: any) =>
        where.id === STORE
          ? { id: STORE, name: 'Cửa hàng A', status: StoreStatus.ACTIVE, ownerAccountId: OWNER }
          : where.id === OTHER_STORE
            ? { id: OTHER_STORE, name: 'Cửa hàng B', status: StoreStatus.ACTIVE, ownerAccountId: OTHER_OWNER }
            : null,
      ),
    };
    const builder: any = {
      where: () => builder,
      andWhere: () => builder,
      getExists: async () => false,
      getOne: async () => null,
    };
    const profileRepository = {
      createQueryBuilder: () => builder,
      create: (row: any) => row,
      save: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const accountsService = {
      findById: jest.fn().mockResolvedValue({
        id: APPLICANT,
        status: AccountStatus.ACTIVE,
        fullName: 'A',
        gender: 'Nam',
        birthday: '2000-01-01',
      }),
      update: jest.fn(),
    };
    const service = new JobApplicationService(
      applicationRepository,
      storeRepository as any,
      profileRepository as any,
      accountsService as any,
      { create: jest.fn().mockResolvedValue({}) } as any,
      {} as any,
      storage,
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [JobApplicationController],
      providers: [
        { provide: JobApplicationService, useValue: service },
        { provide: JobApplicationSelfieStorage, useValue: storage },
        JobApplicationSelfieCleanupInterceptor,
        {
          provide: DataSource,
          useValue: {
            getRepository: () => ({
              find: jest.fn(async () => [{ id: STORE, ownerAccountId: OWNER }]),
            }),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          const user = req.headers['x-test-user'];
          if (!user) throw new UnauthorizedException();
          req.user = { userId: user };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    // Same options as main.ts.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    process.chdir(originalCwd);
    rmSync(workdir, { recursive: true, force: true });
  });

  beforeEach(() => {
    rows.clear();
    rmSync(selfieDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  const multipart = (as = APPLICANT) => {
    const req = request(app.getHttpServer())
      .post(`/stores/${STORE}/job-applications`)
      .set('x-test-user', as);
    for (const [key, value] of Object.entries(form)) req.field(key, value);
    return req;
  };

  describe('POST /stores/:storeId/job-applications', () => {
    it('multipart: stores the selfie privately and records only its filename', async () => {
      const res = await multipart()
        .attach('selfie', JPEG, { filename: '../../evil.php', contentType: 'image/jpeg' })
        .expect(201);

      const files = listSelfies();
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^[0-9a-f-]{36}\.jpg$/);
      // Nothing was written to the public static directory.
      expect(existsSync(join(workdir, 'uploads'))).toBe(false);

      const saved = rows.get(APPLICATION);
      expect(saved.selfiePath).toBe(files[0]);
      expect(saved.address).toBe(form.address);
      expect(res.body).toEqual(
        expect.objectContaining({
          address: form.address,
          selfieUrl: `/api/stores/${STORE}/job-applications/${APPLICATION}/selfie`,
          avatarUrl: null,
        }),
      );
    });

    it('multipart without a selfie works and stores nothing', async () => {
      const res = await multipart().expect(201);
      expect(res.body.selfieUrl).toBeNull();
      expect(listSelfies()).toEqual([]);
    });

    it('JSON is unchanged', async () => {
      const res = await request(app.getHttpServer())
        .post(`/stores/${STORE}/job-applications`)
        .set('x-test-user', APPLICANT)
        .send({ fullName: form.fullName, phone: form.phone })
        .expect(201);
      expect(res.body).toEqual(
        expect.objectContaining({ address: null, selfieUrl: null }),
      );
      expect(rows.get(APPLICATION).selfiePath).toBeNull();
    });

    it('rejects a non-image mimetype before writing anything', async () => {
      const res = await multipart()
        .attach('selfie', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' })
        .expect(400);
      expect(res.body.code).toBe('JOB_APPLICATION_SELFIE_INVALID');
      expect(listSelfies()).toEqual([]);
      expect(rows.size).toBe(0);
    });

    it('rejects fake magic bytes and removes the stored file', async () => {
      const res = await multipart()
        .attach('selfie', Buffer.from('<?php echo 1; ?>'), {
          filename: 'a.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);
      expect(res.body.code).toBe('JOB_APPLICATION_SELFIE_INVALID');
      expect(listSelfies()).toEqual([]);
      expect(rows.size).toBe(0);
    });

    it('rejects PNG bytes declared as JPEG', async () => {
      await multipart()
        .attach('selfie', PNG, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(400);
      expect(listSelfies()).toEqual([]);
    });

    it('removes the file when DTO validation fails after the upload', async () => {
      await request(app.getHttpServer())
        .post(`/stores/${STORE}/job-applications`)
        .set('x-test-user', APPLICANT)
        .field('fullName', form.fullName)
        .field('phone', 'not-a-phone')
        .attach('selfie', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(400);
      expect(listSelfies()).toEqual([]);
    });

    it('removes the file when a business rule refuses the application', async () => {
      rows.set('existing', {
        id: 'existing',
        storeId: STORE,
        accountId: APPLICANT,
        status: JobApplicationStatus.PENDING,
      });
      await multipart()
        .attach('selfie', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(409);
      expect(listSelfies()).toEqual([]);
    });

    it('refuses files over 5 MB', async () => {
      const big = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
      await multipart()
        .attach('selfie', big, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(413);
      expect(listSelfies()).toEqual([]);
      expect(rows.size).toBe(0);
    });

    it('refuses more than one file', async () => {
      await multipart()
        .attach('selfie', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .attach('selfie', JPEG, { filename: 'b.jpg', contentType: 'image/jpeg' })
        .expect(400);
      expect(listSelfies()).toEqual([]);
      expect(rows.size).toBe(0);
    });
  });

  describe('GET /stores/:storeId/job-applications/:applicationId/selfie', () => {
    beforeEach(async () => {
      await multipart()
        .attach('selfie', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(201);
    });

    const get = (as: string, storeId = STORE) =>
      request(app.getHttpServer())
        .get(`/stores/${storeId}/job-applications/${APPLICATION}/selfie`)
        .set('x-test-user', as)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });

    it('streams it to the store owner, uncached', async () => {
      const res = await get(OWNER).expect(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(Buffer.compare(res.body, JPEG)).toBe(0);
    });

    it('streams it to the applicant', async () => {
      await get(APPLICANT).expect(200);
    });

    it('is 404 for a member of the store who is not the owner', async () => {
      await get(MEMBER).expect(404);
    });

    it('is 404 for the owner of another store, via either store id', async () => {
      await get(OTHER_OWNER).expect(404);
      await get(OTHER_OWNER, OTHER_STORE).expect(404);
    });

    it('is 404 when the stored name tries to traverse', async () => {
      writeFileSync(join(workdir, 'secret.jpg'), JPEG);
      rows.get(APPLICATION).selfiePath = '../../secret.jpg';
      await get(OWNER).expect(404);
    });

    it('is 404 when the file is gone', async () => {
      rmSync(selfieDir, { recursive: true, force: true });
      await get(OWNER).expect(404);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .get(`/stores/${STORE}/job-applications/${APPLICATION}/selfie`)
        .expect(401);
    });
  });

  describe('withdraw and retention delete the file', () => {
    beforeEach(async () => {
      await multipart()
        .attach('selfie', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(201);
      expect(listSelfies()).toHaveLength(1);
    });

    it('withdraw nulls the columns and deletes the file', async () => {
      await request(app.getHttpServer())
        .post(`/stores/${STORE}/job-applications/${APPLICATION}/withdraw`)
        .set('x-test-user', APPLICANT)
        .expect(201);

      const [, changes] = applicationRepository.update.mock.calls[0];
      expect(changes).toEqual(
        expect.objectContaining({ selfiePath: null, address: null }),
      );
      expect(listSelfies()).toEqual([]);
    });

    it('the retention sweep deletes stale selfie files', async () => {
      const stored = rows.get(APPLICATION);
      applicationRepository.find.mockResolvedValueOnce([
        { id: APPLICATION, selfiePath: stored.selfiePath, reviewedAt: null },
      ]);
      const service = app.get(JobApplicationService);
      await service.redactStaleContactDetails(new Date('2027-06-01T00:00:00Z'));
      expect(listSelfies()).toEqual([]);
    });
  });
});

describe('JobApplicationSelfieStorage', () => {
  let dir: string;
  let storage: JobApplicationSelfieStorage;
  const NAME = '0b7c6a52-6a0e-4c47-9d3e-3f1c2b8e5a11.jpg';
  const PNG_NAME = '0b7c6a52-6a0e-4c47-9d3e-3f1c2b8e5a11.png';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'selfie-storage-'));
    storage = new JobApplicationSelfieStorage();
    storage.directory = dir;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('accepts real JPEG and PNG headers matching the declared type', async () => {
    writeFileSync(join(dir, NAME), JPEG);
    writeFileSync(join(dir, PNG_NAME), PNG);
    await expect(storage.verify({ filename: NAME, mimetype: 'image/jpeg' })).resolves.toBe(true);
    await expect(storage.verify({ filename: PNG_NAME, mimetype: 'image/png' })).resolves.toBe(true);
  });

  it('refuses fake magic bytes, mismatched types, and short files', async () => {
    writeFileSync(join(dir, NAME), Buffer.from('GIF89a....'));
    await expect(storage.verify({ filename: NAME, mimetype: 'image/jpeg' })).resolves.toBe(false);
    writeFileSync(join(dir, NAME), JPEG);
    await expect(storage.verify({ filename: NAME, mimetype: 'image/png' })).resolves.toBe(false);
    writeFileSync(join(dir, NAME), Buffer.from([0xff]));
    await expect(storage.verify({ filename: NAME, mimetype: 'image/jpeg' })).resolves.toBe(false);
  });

  it('never resolves a name outside the directory', () => {
    for (const bad of ['../x.jpg', '/etc/passwd', 'a/b.jpg', '..', '', null, 'x.jpg', `${NAME}.php`]) {
      expect(storage.resolve(bad)).toBeNull();
    }
    expect(storage.resolve(NAME)).toBe(join(dir, NAME));
  });

  it('remove is best-effort and idempotent', async () => {
    writeFileSync(join(dir, NAME), JPEG);
    await expect(storage.remove(NAME)).resolves.toBe(true);
    await expect(storage.remove(NAME)).resolves.toBe(false);
    await expect(storage.remove('../../etc/passwd')).resolves.toBe(false);
  });
});
