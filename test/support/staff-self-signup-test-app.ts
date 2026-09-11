import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { join } from 'path';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { Observable } from 'rxjs';
import { isDeepStrictEqual } from 'util';

import { AccountsController } from '../../src/modules/accounts/accounts.controller';
import { AccountsService } from '../../src/modules/accounts/accounts.service';
import { AccountFinance } from '../../src/modules/accounts/entities/account-finance.entity';
import { AccountIdentityDocument } from '../../src/modules/accounts/entities/account-identity-document.entity';
import { AccountOtp } from '../../src/modules/accounts/entities/account-otp.entity';
import { AccountRefreshToken } from '../../src/modules/accounts/entities/account-refresh-token.entity';
import {
  Account,
  AccountStatus,
} from '../../src/modules/accounts/entities/account.entity';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { AuthService } from '../../src/modules/auth/auth.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import { MailService } from '../../src/modules/mail/mail.service';
import { Asset } from '../../src/modules/stores/entities/asset.entity';
import { EmployeeAssetAssignment } from '../../src/modules/stores/entities/employee-asset-assignment.entity';
import { EmployeeContract } from '../../src/modules/stores/entities/employee-contract.entity';
import { EmployeeMonthlySummary } from '../../src/modules/stores/entities/employee-monthly-summary.entity';
import {
  EmployeeProfile,
  EmploymentStatus,
} from '../../src/modules/stores/entities/employee-profile.entity';
import { EmployeeSalary } from '../../src/modules/stores/entities/employee-salary.entity';
import { MonthlyPayroll } from '../../src/modules/stores/entities/monthly-payroll.entity';
import { ShiftAssignment } from '../../src/modules/stores/entities/shift-management.entity';
import { StoreEmployeeType } from '../../src/modules/stores/entities/store-employee-type.entity';
import { StoreRole } from '../../src/modules/stores/entities/store-role.entity';
import { StoreSkill } from '../../src/modules/stores/entities/store-skill.entity';
import {
  Store,
  StoreStatus,
} from '../../src/modules/stores/entities/store.entity';
import { WorkShift } from '../../src/modules/stores/entities/work-shift.entity';
import { ShiftEndWorkflowService } from '../../src/modules/stores/shift-end-workflow.service';
import { StoresController } from '../../src/modules/stores/stores.controller';
import { StoreAccessGuard } from '../../src/modules/stores/guards/store-access.guard';
import { StoreResourceAccessGuard } from '../../src/modules/stores/guards/store-resource-access.guard';
import { StoresService } from '../../src/modules/stores/stores.service';

export const STAFF_SIGNUP_STORE_ID = '11111111-1111-4111-8111-111111111111';
export const STAFF_SIGNUP_ROLE_ID = '21111111-1111-4111-8111-111111111111';
export const STAFF_SIGNUP_EMPLOYEE_TYPE_ID =
  '31111111-1111-4111-8111-111111111111';
export const STAFF_SIGNUP_WORK_SHIFT_ID =
  '41111111-1111-4111-8111-111111111111';
export const STAFF_SIGNUP_SKILL_ID = '51111111-1111-4111-8111-111111111111';
export const STAFF_SIGNUP_OWNER = {
  fullName: 'Owner E2E',
  email: 'owner@isolated.test',
  phone: '0910000000',
  password: 'password',
} as const;
export const STAFF_SIGNUP_STAFF = {
  fullName: 'Nhan vien E2E',
  email: 'staff.e2e@isolated.test',
  phone: '0900000003',
  password: 'password',
} as const;
export const STAFF_SIGNUP_OTP = '123456';
export const STAFF_SIGNUP_PROXY_PORT = 14321;
export const STAFF_SIGNUP_NEST_PORT = 14322;

export interface StaffSignupDatabaseConfig {
  host: '127.0.0.1' | 'localhost' | '::1';
  port: number;
  username: string;
  password?: string;
  database: string;
}

export interface OwnedStaffSignupSchema {
  schema: string;
  runId: string;
  ownershipToken: string;
}

export interface StaffSignupFixtureState {
  owner: Account;
  store: Store;
  deliveredOtps: Map<string, string>;
  failingOtpDeliveries: Set<string>;
  zaloSendCount: number;
}

export interface StaffSignupTestApplication {
  app: INestApplication;
  dataSource: DataSource;
  accountsService: AccountsService;
  jwtService: JwtService;
  fixture: StaffSignupFixtureState;
  reservation: OwnedStaffSignupSchema;
  getSanitizedStatus(): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

export interface CreateStaffSignupTestAppOptions {
  runId: string;
  environment?: NodeJS.ProcessEnv;
  seedVerifiedStaff?: boolean;
}

const TEST_CONTROL = Symbol('STAFF_SIGNUP_TEST_CONTROL');

@Controller('__fixture')
class StaffSignupTestControlController {
  constructor(
    @Inject(TEST_CONTROL)
    private readonly control: {
      runId: string;
      getStatus: () => Promise<Record<string, unknown>>;
    },
  ) {}

  @Get('status')
  async status(@Headers('x-timeso-fixture-run-id') runId?: string) {
    if (runId !== this.control.runId) {
      throw new ForbiddenException('STAFF_SIGNUP_TEST_RUN_MISMATCH');
    }
    return this.control.getStatus();
  }
}

export function assertStaffSignupIsolatedDatabaseEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): StaffSignupDatabaseConfig {
  if (
    environment.TIMESO_STAFF_SIGNUP_NEST_E2E !== 'true' ||
    environment.TIMESO_ISOLATED_DB !== 'true'
  ) {
    throw new Error('STAFF_SIGNUP_TEST_EXPLICIT_OPT_IN_REQUIRED');
  }
  if (environment.DATABASE_URL) {
    throw new Error('STAFF_SIGNUP_TEST_DATABASE_URL_NOT_ALLOWED');
  }
  const host = environment.PGHOST;
  if (!host || !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('STAFF_SIGNUP_TEST_LOOPBACK_DATABASE_REQUIRED');
  }
  const database = environment.PGDATABASE;
  if (!database || !database.endsWith('_test')) {
    throw new Error('STAFF_SIGNUP_TEST_DATABASE_NAME_REQUIRED');
  }
  const port = Number(environment.PGPORT || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('STAFF_SIGNUP_TEST_DATABASE_PORT_INVALID');
  }
  return {
    host: host as StaffSignupDatabaseConfig['host'],
    port,
    username: environment.PGUSER || 'postgres',
    password: environment.PGPASSWORD,
    database,
  };
}

function schemaForRunId(runId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(runId)) {
    throw new Error('STAFF_SIGNUP_TEST_RUN_ID_INVALID');
  }
  return `timeso_signup_${createHash('sha256').update(runId).digest('hex').slice(0, 24)}`;
}

function createClient(config: StaffSignupDatabaseConfig): Client {
  return new Client({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database,
  });
}

export async function reserveStaffSignupSchema(
  config: StaffSignupDatabaseConfig,
  runId: string,
): Promise<OwnedStaffSignupSchema> {
  const schema = schemaForRunId(runId);
  const ownershipToken = randomUUID();
  const client = createClient(config);
  await client.connect();
  let created = false;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await client.query(`
      CREATE TABLE "${schema}".staff_signup_fixture_ownership(
        run_id text PRIMARY KEY,
        ownership_token text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(
      `INSERT INTO "${schema}".staff_signup_fixture_ownership(run_id, ownership_token)
       VALUES($1, $2)`,
      [runId, ownershipToken],
    );
    return { schema, runId, ownershipToken };
  } catch (error) {
    if (created) {
      await client.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => undefined);
    }
    if ((error as { code?: string }).code === '42P06') {
      throw new Error('STAFF_SIGNUP_TEST_SCHEMA_ALREADY_OWNED');
    }
    throw error;
  } finally {
    await client.end();
  }
}

export async function cleanupOwnedStaffSignupSchema(
  config: StaffSignupDatabaseConfig,
  reservation: OwnedStaffSignupSchema,
): Promise<void> {
  const client = createClient(config);
  await client.connect();
  try {
    const result = await client.query<{ ownership_token: string }>(
      `SELECT ownership_token
         FROM "${reservation.schema}".staff_signup_fixture_ownership
        WHERE run_id=$1`,
      [reservation.runId],
    );
    if (
      result.rows.length !== 1 ||
      result.rows[0].ownership_token !== reservation.ownershipToken
    ) {
      throw new Error('STAFF_SIGNUP_TEST_SCHEMA_NOT_OWNED');
    }
    await client.query(`DROP SCHEMA "${reservation.schema}" CASCADE`);
  } finally {
    await client.end();
  }
}

export async function createStaffSignupTestApp(
  options: CreateStaffSignupTestAppOptions,
): Promise<StaffSignupTestApplication> {
  const config = assertStaffSignupIsolatedDatabaseEnvironment(
    options.environment,
  );
  const reservation = await reserveStaffSignupSchema(config, options.runId);
  let app: INestApplication | undefined;
  let dataSource: DataSource | undefined;
  let appClosed = false;
  let dataSourceClosed = false;
  let schemaCleaned = false;
  let closing: Promise<void> | undefined;
  try {
    dataSource = new DataSource({
      type: 'postgres',
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      database: config.database,
      schema: reservation.schema,
      entities: [join(__dirname, '../../src/**/*.entity.{ts,js}')],
      synchronize: true,
      dropSchema: false,
    });
    await dataSource.initialize();

    const accountRepository = dataSource.getRepository(Account);
    const profileRepository = dataSource.getRepository(EmployeeProfile);
    const accountsService = new AccountsService(
      accountRepository,
      dataSource.getRepository(AccountIdentityDocument),
      dataSource.getRepository(AccountFinance),
      profileRepository,
    );
    const deliveredOtps = new Map<string, string>();
    const failingOtpDeliveries = new Set<string>();
    let zaloSendCount = 0;
    let lastSuccessfulAttachBody: Record<string, unknown> | null = null;
    const refreshTokenRepository = dataSource.getRepository(AccountRefreshToken);
    const configService = {
      get: (key: string) => {
        if (key === 'JWT_SECRET') return 'isolated-test-access-secret';
        if (key === 'JWT_REFRESH_SECRET') return 'isolated-test-refresh-secret';
        if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
        return undefined;
      },
    };
    const jwtService = new JwtService({ secret: 'isolated-test-access-secret' });
    const authService = new AuthService(
      accountsService,
      jwtService,
      configService as never,
      refreshTokenRepository,
      dataSource.getRepository(AccountOtp),
      profileRepository,
      {} as never,
      {
        sendOtp: async (phone: string, otp: string) => {
          zaloSendCount += 1;
          if (failingOtpDeliveries.has(phone)) {
            throw new Error('isolated provider failure');
          }
          deliveredOtps.set(phone, otp);
        },
      } as never,
      {
        ensureDailyReportForStore: async () => undefined,
        ensureDailyReportsForOwner: async () => undefined,
      } as never,
      dataSource,
    );
    (authService as unknown as { generateOtp: () => string }).generateOtp =
      () => STAFF_SIGNUP_OTP;

    const storesService = Object.create(StoresService.prototype) as StoresService;
    Object.assign(storesService as object, {
      accountsService,
      dataSource,
      profileRepository,
      storeRepository: dataSource.getRepository(Store),
      monthlySummaryRepository: dataSource.getRepository(EmployeeMonthlySummary),
      shiftAssignmentRepository: dataSource.getRepository(ShiftAssignment),
    });

    const fixture = {} as StaffSignupFixtureState;
    const getSanitizedStatus = async (): Promise<Record<string, unknown>> => {
      const account = await accountRepository
        .createQueryBuilder('account')
        .addSelect('account.passwordHash')
        .where('account.phone = :phone', { phone: STAFF_SIGNUP_STAFF.phone })
        .getOne();
      const profiles = account
        ? await profileRepository.find({
            where: { accountId: account.id },
            withDeleted: true,
          })
        : [];
      const activeProfiles = profiles.filter(
        (item) => item.employmentStatus !== EmploymentStatus.TERMINATED,
      );
      const profile = activeProfiles.length === 1 ? activeProfiles[0] : null;
      const contract = profile
        ? await dataSource!.getRepository(EmployeeContract).findOne({
            where: { employeeProfileId: profile.id },
          })
        : null;
      const assignmentCount = profile
        ? await dataSource!.getRepository(EmployeeAssetAssignment).count({
            where: { employeeProfileId: profile.id },
          })
        : 0;
      const assignmentAssetIds = profile
        ? (
            await dataSource!.getRepository(EmployeeAssetAssignment).find({
              where: { employeeProfileId: profile.id },
            })
          )
            .map((assignment) => assignment.assetId)
            .sort()
        : [];
      const submittedAssetIds = Array.isArray(lastSuccessfulAttachBody?.assetIds)
        ? [...new Set(lastSuccessfulAttachBody.assetIds as string[])].sort()
        : [];
      const submittedContract =
        lastSuccessfulAttachBody?.contract &&
        typeof lastSuccessfulAttachBody.contract === 'object'
          ? (lastSuccessfulAttachBody.contract as Record<string, unknown>)
          : null;
      const valuesEqual = (
        actual: unknown,
        expected: unknown,
        key: string,
      ): boolean => {
        if (
          (key === 'startDate' || key === 'endDate') &&
          expected === ''
        ) {
          return actual == null || actual === '';
        }
        if (typeof expected === 'number') return Number(actual) === expected;
        if (
          Array.isArray(expected) ||
          (expected !== null && typeof expected === 'object')
        ) {
          return isDeepStrictEqual(actual, expected);
        }
        if (
          typeof expected === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(expected)
        ) {
          return String(actual).slice(0, 10) === expected;
        }
        return actual === expected;
      };
      const submittedReferencesMatch =
        !!profile &&
        !!lastSuccessfulAttachBody &&
        ['storeRoleId', 'employeeTypeId', 'workShiftId', 'skillId'].every(
          (key) =>
            (profile[key as keyof EmployeeProfile] ?? null) ===
            (lastSuccessfulAttachBody![key] ?? null),
        );
      const submittedContractMatches = submittedContract
        ? !!contract &&
          Object.entries(submittedContract).every(
            ([key, expected]) =>
              expected == null ||
              valuesEqual(
                contract[key as keyof EmployeeContract],
                expected,
                key,
              ),
          )
        : !contract;
      return {
        runId: options.runId,
        accountCount: account ? 1 : 0,
        accountStatus: account?.status ?? null,
        identityMatchesExpected:
          !!account &&
          account.fullName === STAFF_SIGNUP_STAFF.fullName &&
          account.email === STAFF_SIGNUP_STAFF.email &&
          account.phone === STAFF_SIGNUP_STAFF.phone &&
          (await bcrypt.compare(
            STAFF_SIGNUP_STAFF.password,
            account.passwordHash,
          )),
        profileCount: profiles.length,
        activeProfileCount: activeProfiles.length,
        profileStoreMatches: profile?.storeId === STAFF_SIGNUP_STORE_ID,
        profileReferencesMatch:
          !!profile &&
          profile.storeRoleId === STAFF_SIGNUP_ROLE_ID &&
          profile.workShiftId === STAFF_SIGNUP_WORK_SHIFT_ID &&
          (!profile.employeeTypeId ||
            profile.employeeTypeId === STAFF_SIGNUP_EMPLOYEE_TYPE_ID) &&
          (!profile.skillId || profile.skillId === STAFF_SIGNUP_SKILL_ID),
        profileReferencesMatchSubmitted: submittedReferencesMatch,
        contractCount: profile
          ? await dataSource!.getRepository(EmployeeContract).count({
              where: { employeeProfileId: profile.id },
            })
          : 0,
        contractMatchesSubmitted: submittedContractMatches,
        monthlySummaryCount: profile
          ? await dataSource!.getRepository(EmployeeMonthlySummary).count({
              where: { employeeProfileId: profile.id },
            })
          : 0,
        monthlyPayrollCount: await dataSource!.getRepository(MonthlyPayroll).count({
          where: { storeId: STAFF_SIGNUP_STORE_ID },
        }),
        employeeSalaryCount: profile
          ? await dataSource!.getRepository(EmployeeSalary).count({
              where: { employeeProfileId: profile.id },
            })
          : 0,
        assetAssignmentCount: assignmentCount,
        assetAssignmentsMatchSubmitted:
          JSON.stringify(assignmentAssetIds) === JSON.stringify(submittedAssetIds),
        zaloSendCount,
        fixedOtpDelivered: deliveredOtps.get(STAFF_SIGNUP_STAFF.phone) === STAFF_SIGNUP_OTP,
      };
    };

    const control = { runId: options.runId, getStatus: getSanitizedStatus };
    const module = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [
        AuthController,
        AccountsController,
        StoresController,
        StaffSignupTestControlController,
      ],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: AccountsService, useValue: accountsService },
        { provide: StoresService, useValue: storesService },
        { provide: TEST_CONTROL, useValue: control },
        {
          provide: getRepositoryToken(AccountRefreshToken),
          useValue: refreshTokenRepository,
        },
        {
          provide: getRepositoryToken(AccountIdentityDocument),
          useValue: dataSource.getRepository(AccountIdentityDocument),
        },
        {
          provide: getRepositoryToken(AccountFinance),
          useValue: dataSource.getRepository(AccountFinance),
        },
        { provide: MailService, useValue: {} },
        { provide: getQueueToken('attendance-background'), useValue: {} },
        { provide: ShiftEndWorkflowService, useValue: {} },
        { provide: ConfigService, useValue: configService },
        { provide: getRepositoryToken(Account), useValue: accountRepository },
        JwtStrategy,
        JwtAuthGuard,
      ],
    })
      // StoresController declares two tenancy guards that resolve a store from
      // the database. This suite predates them and asserts a different concern,
      // so the tenancy boundary is stubbed open to preserve its prior scope;
      // the guards carry their own unit tests.
      .overrideGuard(StoreAccessGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(StoreResourceAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalInterceptors({
      intercept(context, next): Observable<unknown> {
        const request = context.switchToHttp().getRequest<{
          method?: string;
          path?: string;
          body?: Record<string, unknown>;
        }>();
        if (
          request.method === 'POST' &&
          /^\/stores\/[^/]+\/employees\/from-account$/.test(
            request.path || '',
          )
        ) {
          const body = request.body || {};
          return new Observable((subscriber) => {
            const subscription = next.handle().subscribe({
              next(value) {
                lastSuccessfulAttachBody = {
                  storeRoleId: body.storeRoleId ?? null,
                  employeeTypeId: body.employeeTypeId ?? null,
                  workShiftId: body.workShiftId ?? null,
                  skillId: body.skillId ?? null,
                  assetIds: Array.isArray(body.assetIds) ? [...body.assetIds] : [],
                  contract:
                    body.contract && typeof body.contract === 'object'
                      ? { ...(body.contract as Record<string, unknown>) }
                      : null,
                };
                subscriber.next(value);
              },
              error(error) {
                subscriber.error(error);
              },
              complete() {
                subscriber.complete();
              },
            });
            return () => subscription.unsubscribe();
          });
        }
        return next.handle();
      },
    });
    await app.init();

    const owner = await accountsService.create({
      fullName: STAFF_SIGNUP_OWNER.fullName,
      email: STAFF_SIGNUP_OWNER.email,
      phone: STAFF_SIGNUP_OWNER.phone,
      passwordHash: STAFF_SIGNUP_OWNER.password,
      status: AccountStatus.ACTIVE,
    });
    const store = await dataSource.getRepository(Store).save({
      id: STAFF_SIGNUP_STORE_ID,
      ownerAccountId: owner.id,
      name: 'Cà phê Đặng Văn',
      addressLine: '125 Nguyễn Huệ',
      ward: 'Bến Nghé',
      city: 'Hồ Chí Minh',
      status: StoreStatus.ACTIVE,
    });
    await dataSource.getRepository(StoreRole).save({
      id: STAFF_SIGNUP_ROLE_ID,
      storeId: store.id,
      code: 'E2E_ROLE',
      name: 'Nhân viên E2E',
    });
    await dataSource.getRepository(StoreEmployeeType).save({
      id: STAFF_SIGNUP_EMPLOYEE_TYPE_ID,
      storeId: store.id,
      code: 'E2E_EMPLOYEE_TYPE',
      name: 'Chính thức E2E',
      level: 1,
    });
    await dataSource.getRepository(WorkShift).save({
      id: STAFF_SIGNUP_WORK_SHIFT_ID,
      storeId: store.id,
      shiftName: 'Ca sáng E2E',
      startTime: '08:00:00',
      endTime: '12:00:00',
    });
    await dataSource.getRepository(StoreSkill).save({
      id: STAFF_SIGNUP_SKILL_ID,
      storeId: store.id,
      name: 'Pha chế E2E',
    });
    if (options.seedVerifiedStaff) {
      await accountsService.create({
        fullName: STAFF_SIGNUP_STAFF.fullName,
        email: STAFF_SIGNUP_STAFF.email,
        phone: STAFF_SIGNUP_STAFF.phone,
        passwordHash: STAFF_SIGNUP_STAFF.password,
        status: AccountStatus.ACTIVE,
      });
    }
    Object.assign(fixture, {
      owner,
      store,
      deliveredOtps,
      failingOtpDeliveries,
      get zaloSendCount() {
        return zaloSendCount;
      },
    });

    const close = async () => {
      if (appClosed && dataSourceClosed && schemaCleaned) return;
      if (closing) return closing;
      closing = (async () => {
        let firstError: unknown;
        try {
          if (!appClosed) {
            await app?.close();
            appClosed = true;
          }
        } catch (error) {
          firstError ??= error;
        } finally {
          try {
            if (!dataSourceClosed) {
              if (dataSource?.isInitialized) await dataSource.destroy();
              dataSourceClosed = true;
            }
          } catch (error) {
            firstError ??= error;
          } finally {
            try {
              if (!schemaCleaned) {
                await cleanupOwnedStaffSignupSchema(config, reservation);
                schemaCleaned = true;
              }
            } catch (error) {
              firstError ??= error;
            }
          }
        }
        if (firstError) {
          throw firstError instanceof Error
            ? firstError
            : new Error('STAFF_SIGNUP_TEST_CLEANUP_FAILED');
        }
      })();
      try {
        await closing;
      } finally {
        closing = undefined;
      }
    };
    return {
      app,
      dataSource,
      accountsService,
      jwtService,
      fixture,
      reservation,
      getSanitizedStatus,
      close,
    };
  } catch (error) {
    await app?.close().catch(() => undefined);
    if (dataSource?.isInitialized) await dataSource.destroy().catch(() => undefined);
    await cleanupOwnedStaffSignupSchema(config, reservation).catch(() => undefined);
    throw error;
  }
}
