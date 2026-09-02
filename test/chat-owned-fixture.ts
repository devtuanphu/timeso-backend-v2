import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { JWT_ACCESS_TOKEN_USE } from '../src/modules/auth/jwt.config';
import {
  guardedChatDatabaseUrl,
  IsolatedChatPgHarness,
} from './chat-isolated-pg-harness';

export const CHAT_E2E_ACCESS_SECRET =
  'chat-e2e-access-secret-owned-fixture-only';
export const CHAT_E2E_REFRESH_SECRET =
  'chat-e2e-refresh-secret-owned-fixture-only';

export interface ReservedChatFixture {
  schema: string;
  runTag: string;
}

export interface SeededChatFixture extends ReservedChatFixture {
  storeId: string;
  groupId: string;
  ownerId: string;
  staffId: string;
  crossStoreId: string;
  terminatedId: string;
  removedId: string;
  blockedId: string;
  ownerPhone: string;
  staffPhone: string;
  password: string;
  ownerAccessToken: string;
  staffAccessToken: string;
  crossStoreAccessToken: string;
  terminatedAccessToken: string;
  removedAccessToken: string;
  blockedAccessToken: string;
  ownerMessage: string;
  staffMessage: string;
  attachmentMessageId: string;
  attachmentName: string;
}

export async function reserveOwnedChatFixture(): Promise<ReservedChatFixture> {
  const harness = new IsolatedChatPgHarness();
  const runTag = `chat-e2e-${randomUUID()}`;
  let created = false;
  try {
    await harness.createSchema();
    created = true;
    await harness.query(`
      CREATE TABLE chat_e2e_fixture_ownership(
        run_tag text PRIMARY KEY,
        schema_name text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await harness.query(
      'INSERT INTO chat_e2e_fixture_ownership(run_tag,schema_name) VALUES($1,$2)',
      [runTag, harness.schema],
    );
    await harness.pool.end();
    return { schema: harness.schema, runTag };
  } catch (error) {
    if (created) {
      await harness.cleanup().catch(() => undefined);
    } else {
      await harness.pool.end().catch(() => undefined);
    }
    throw error;
  }
}

export async function seedOwnedChatFixture(
  reservation: ReservedChatFixture,
): Promise<SeededChatFixture> {
  const harness = new IsolatedChatPgHarness(reservation.schema);
  try {
    await assertOwnership(harness, reservation.runTag);
    const expand = readFileSync(
      join(
        process.cwd(),
        'scripts',
        'migration_chat_reliability_v2_expand.sql',
      ),
      'utf8',
    );
    await harness.query(expand);

    const ownerId = randomUUID();
    const staffId = randomUUID();
    const crossStoreId = randomUUID();
    const terminatedId = randomUUID();
    const removedId = randomUUID();
    const blockedId = randomUUID();
    const storeId = randomUUID();
    const otherStoreId = randomUUID();
    const groupId = randomUUID();
    const password = `Chat-${reservation.runTag.slice(-8)}!`;
    const digits = reservation.runTag
      .replace(/\D/g, '')
      .slice(-7)
      .padStart(7, '0');
    const ownerPhone = `091${digits}`.slice(0, 10);
    const staffPhone = `092${digits}`.slice(0, 10);
    const passwordHash = await bcrypt.hash(password, 4);
    const exactName = `TIMESO_CHAT_FIXTURE:${reservation.runTag}`;

    const accounts: Array<[string, string, string]> = [
      [ownerId, 'Chat E2E Owner', 'active'],
      [staffId, 'Chat E2E Staff', 'active'],
      [crossStoreId, 'Chat E2E Cross Store', 'active'],
      [terminatedId, 'Chat E2E Terminated', 'active'],
      [removedId, 'Chat E2E Removed', 'active'],
      [blockedId, 'Chat E2E Blocked', 'blocked'],
    ];
    for (const [index, [accountId, fullName, status]] of accounts.entries()) {
      await harness.query(
        `INSERT INTO accounts(id,full_name,phone,password_hash,status,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,now(),now())`,
        [
          accountId,
          fullName,
          index === 0
            ? ownerPhone
            : index === 1
              ? staffPhone
              : `099${index}${digits}`.slice(0, 10),
          passwordHash,
          status,
        ],
      );
    }
    await harness.query(
      `INSERT INTO stores(id,owner_account_id,name,status,created_at,updated_at)
     VALUES($1,$2,$3,'active',now(),now())`,
      [storeId, ownerId, exactName],
    );
    await harness.query(
      `INSERT INTO stores(id,owner_account_id,name,status,created_at,updated_at)
     VALUES($1,$2,$3,'active',now(),now())`,
      [otherStoreId, crossStoreId, `${exactName}:other`],
    );
    await harness.query(
      `INSERT INTO employee_profiles(
       id,store_id,account_id,employment_status,working_status,created_at,updated_at
     ) VALUES($1,$2,$3,'active','off',now(),now())`,
      [randomUUID(), storeId, staffId],
    );
    for (const [accountId, employmentStatus] of [
      [terminatedId, 'terminated'],
      [removedId, 'active'],
      [blockedId, 'active'],
    ] as const) {
      await harness.query(
        `INSERT INTO employee_profiles(
         id,store_id,account_id,employment_status,working_status,created_at,updated_at
       ) VALUES($1,$2,$3,$4,'off',now(),now())`,
        [randomUUID(), storeId, accountId, employmentStatus],
      );
    }
    await harness.query(
      `INSERT INTO chat_groups(
       id,name,store_id,created_by,message_permission,next_message_sequence,created_at,updated_at
     ) VALUES($1,$2,$3,$4,'everyone',1,now(),now())`,
      [groupId, exactName, storeId, ownerId],
    );
    for (const accountId of [ownerId, staffId]) {
      await harness.query(
        `INSERT INTO chat_group_members(
         id,group_id,account_id,status,created_at,updated_at
       ) VALUES($1,$2,$3,'active',now(),now())`,
        [randomUUID(), groupId, accountId],
      );
    }
    for (const [accountId, memberStatus] of [
      [terminatedId, 'active'],
      [removedId, 'removed'],
      [blockedId, 'active'],
    ] as const) {
      await harness.query(
        `INSERT INTO chat_group_members(
         id,group_id,account_id,status,created_at,updated_at
       ) VALUES($1,$2,$3,$4,now(),now())`,
        [randomUUID(), groupId, accountId, memberStatus],
      );
    }
    const attachmentMessageId = randomUUID();
    const attachmentName = `fixture-${reservation.runTag.slice(-8)}.pdf`;
    await harness.query(
      `INSERT INTO chat_messages(
       id,group_id,sender_id,content,message_type,attachment_url,attachment_name,
       attachment_size,read_by,created_at,updated_at
     ) VALUES($1,$2,$3,'','file','fixture://read-only',$4,2048,$5,now(),now())`,
      [attachmentMessageId, groupId, ownerId, attachmentName, ownerId],
    );

    const jwt = new JwtService({ secret: CHAT_E2E_ACCESS_SECRET });
    const sign = (accountId: string) =>
      jwt.sign(
        { sub: accountId, tokenUse: JWT_ACCESS_TOKEN_USE },
        { expiresIn: '30m' },
      );
    const fixture: SeededChatFixture = {
      ...reservation,
      storeId,
      groupId,
      ownerId,
      staffId,
      crossStoreId,
      terminatedId,
      removedId,
      blockedId,
      ownerPhone,
      staffPhone,
      password,
      ownerAccessToken: sign(ownerId),
      staffAccessToken: sign(staffId),
      crossStoreAccessToken: sign(crossStoreId),
      terminatedAccessToken: sign(terminatedId),
      removedAccessToken: sign(removedId),
      blockedAccessToken: sign(blockedId),
      ownerMessage: `owner-${reservation.runTag}`,
      staffMessage: `staff-${reservation.runTag}`,
      attachmentMessageId,
      attachmentName,
    };
    await verifyOwnedChatFixture(fixture);
    return fixture;
  } finally {
    await harness.pool.end();
  }
}

export async function verifyOwnedChatFixture(
  fixture: Pick<
    SeededChatFixture,
    'schema' | 'runTag' | 'storeId' | 'groupId'
  > &
    Partial<
      Pick<
        SeededChatFixture,
        | 'ownerId'
        | 'staffId'
        | 'ownerAccessToken'
        | 'staffAccessToken'
        | 'attachmentMessageId'
        | 'attachmentName'
      >
    >,
): Promise<void> {
  const harness = new IsolatedChatPgHarness(fixture.schema);
  try {
    await assertOwnership(harness, fixture.runTag);
    const expected = `TIMESO_CHAT_FIXTURE:${fixture.runTag}`;
    const result = await harness.query<{
      store_name: string;
      group_name: string;
      owner_account_id: string;
    }>(
      `SELECT store.name store_name, chat_group.name group_name,
              store.owner_account_id
         FROM stores store JOIN chat_groups chat_group ON chat_group.store_id=store.id
        WHERE store.id=$1 AND chat_group.id=$2`,
      [fixture.storeId, fixture.groupId],
    );
    if (
      result.rows.length !== 1 ||
      result.rows[0].store_name !== expected ||
      result.rows[0].group_name !== expected ||
      (fixture.ownerId && result.rows[0].owner_account_id !== fixture.ownerId)
    ) {
      throw new Error('CHAT_E2E_FIXTURE_TAG_MISMATCH');
    }

    if (fixture.ownerId && fixture.staffId) {
      const actors = await harness.query<{ account_id: string }>(
        `SELECT member.account_id
           FROM chat_group_members member
           JOIN accounts account ON account.id=member.account_id
           LEFT JOIN employee_profiles employee
             ON employee.store_id=$2 AND employee.account_id=member.account_id
          WHERE member.group_id=$1 AND member.status='active'
            AND account.status='active' AND account.deleted_at IS NULL
            AND (member.account_id=$3 OR employee.employment_status!='terminated')`,
        [fixture.groupId, fixture.storeId, fixture.ownerId],
      );
      const actorIds = new Set(actors.rows.map((row) => row.account_id));
      if (!actorIds.has(fixture.ownerId) || !actorIds.has(fixture.staffId)) {
        throw new Error('CHAT_E2E_FIXTURE_ACTOR_MISMATCH');
      }
    }

    if (fixture.ownerAccessToken && fixture.ownerId) {
      assertAccessToken(fixture.ownerAccessToken, fixture.ownerId);
    }
    if (fixture.staffAccessToken && fixture.staffId) {
      assertAccessToken(fixture.staffAccessToken, fixture.staffId);
    }
    if (fixture.attachmentMessageId || fixture.attachmentName) {
      if (!fixture.attachmentMessageId || !fixture.attachmentName) {
        throw new Error('CHAT_E2E_FIXTURE_ATTACHMENT_MISMATCH');
      }
      const attachment = await harness.query<{ id: string }>(
        `SELECT id FROM chat_messages
          WHERE id=$1 AND group_id=$2 AND attachment_name=$3`,
        [fixture.attachmentMessageId, fixture.groupId, fixture.attachmentName],
      );
      if (attachment.rows.length !== 1) {
        throw new Error('CHAT_E2E_FIXTURE_ATTACHMENT_MISMATCH');
      }
    }
  } finally {
    await harness.pool.end();
  }
}

function assertAccessToken(token: string, expectedAccountId: string): void {
  const payload = new JwtService({ secret: CHAT_E2E_ACCESS_SECRET }).verify<{
    sub?: string;
    tokenUse?: string;
  }>(token);
  if (
    payload.sub !== expectedAccountId ||
    payload.tokenUse !== JWT_ACCESS_TOKEN_USE
  ) {
    throw new Error('CHAT_E2E_FIXTURE_TOKEN_MISMATCH');
  }
}

export async function teardownOwnedChatFixture(
  reservation: ReservedChatFixture,
): Promise<void> {
  const harness = new IsolatedChatPgHarness(reservation.schema);
  try {
    await assertOwnership(harness, reservation.runTag);
  } catch (error) {
    await harness.pool.end();
    throw error;
  }
  await harness.cleanup();
}

async function assertOwnership(
  harness: IsolatedChatPgHarness,
  runTag: string,
): Promise<void> {
  const result = await harness.query<{ run_tag: string; schema_name: string }>(
    `SELECT run_tag,schema_name FROM chat_e2e_fixture_ownership
      WHERE run_tag=$1 AND schema_name=$2`,
    [runTag, harness.schema],
  );
  if (result.rows.length !== 1) {
    throw new Error('CHAT_E2E_FIXTURE_OWNERSHIP_MISMATCH');
  }
}

export function isolatedBackendEnvironment(
  reservation: ReservedChatFixture,
  port: number,
): NodeJS.ProcessEnv {
  if (!guardedChatDatabaseUrl)
    throw new Error('CHAT_E2E_DATABASE_GUARD_NOT_ENABLED');
  const url = new URL(guardedChatDatabaseUrl);
  return {
    ...process.env,
    NODE_ENV: 'test',
    TIMESO_ISOLATED_DB: 'true',
    DATABASE_SCHEMA_MODE: 'bootstrap',
    DATABASE_HOST: url.hostname,
    DATABASE_PORT: url.port || '5432',
    DATABASE_USER: decodeURIComponent(url.username),
    DATABASE_PASSWORD: decodeURIComponent(url.password),
    DATABASE_NAME: decodeURIComponent(url.pathname.slice(1)),
    PGOPTIONS: `-c search_path=${reservation.schema},public`,
    JWT_SECRET: CHAT_E2E_ACCESS_SECRET,
    JWT_REFRESH_SECRET: CHAT_E2E_REFRESH_SECRET,
    CHAT_SINGLETON_GUARD_MODE: 'required',
    PORT: String(port),
  };
}
