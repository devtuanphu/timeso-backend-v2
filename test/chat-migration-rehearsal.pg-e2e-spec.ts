import { execFileSync, spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { join } from 'path';

import {
  guardedChatDatabaseUrl,
  IsolatedChatPgHarness,
} from './chat-isolated-pg-harness';

const rehearsalEnabled =
  guardedChatDatabaseUrl !== null &&
  process.env.TIMESO_RUN_CHAT_MIGRATION_REHEARSAL === 'true';
const describeMigrationRehearsal = rehearsalEnabled ? describe : describe.skip;

describeMigrationRehearsal('Chat reliability migration rehearsal', () => {
  let harness: IsolatedChatPgHarness;
  const ownerId = randomUUID();
  const storeId = randomUUID();
  const groupId = randomUUID();

  beforeAll(async () => {
    harness = new IsolatedChatPgHarness();
    await harness.createSchema();
    await harness.query(`
      CREATE TABLE accounts(id uuid PRIMARY KEY);
      CREATE TABLE stores(id uuid PRIMARY KEY);
      CREATE TABLE chat_groups(
        id uuid PRIMARY KEY,
        store_id uuid NOT NULL,
        created_by uuid NOT NULL
      );
      CREATE TABLE chat_group_members(
        id uuid PRIMARY KEY,
        group_id uuid NOT NULL,
        account_id uuid NOT NULL,
        status text NOT NULL,
        last_read_at timestamptz,
        deleted_at timestamptz
      );
      CREATE TABLE chat_messages(
        id uuid PRIMARY KEY,
        group_id uuid NOT NULL,
        sender_id uuid NOT NULL,
        content text NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        deleted_at timestamptz
      );
    `);
    await harness.query('INSERT INTO accounts(id) VALUES($1)', [ownerId]);
    await harness.query('INSERT INTO stores(id) VALUES($1)', [storeId]);
    await harness.query(
      'INSERT INTO chat_groups(id,store_id,created_by) VALUES($1,$2,$3)',
      [groupId, storeId, ownerId],
    );
    await harness.query(
      `INSERT INTO chat_group_members(id,group_id,account_id,status,last_read_at)
       VALUES($1,$2,$3,'active',now())`,
      [randomUUID(), groupId, ownerId],
    );
    for (let index = 0; index < 8; index += 1) {
      await harness.query(
        `INSERT INTO chat_messages(id,group_id,sender_id,content,created_at,updated_at)
         VALUES($1,$2,$3,$4,now()+($5*interval '1 millisecond'),now())`,
        [randomUUID(), groupId, ownerId, `legacy-${index}`, index],
      );
    }
  });

  afterAll(async () => harness?.cleanup());

  it('returns non-zero from plain psql -f when legacy source data is unsafe', async () => {
    const duplicateId = randomUUID();
    await harness.query(
      `INSERT INTO chat_group_members(id,group_id,account_id,status,last_read_at)
       VALUES($1,$2,$3,'active',now())`,
      [duplicateId, groupId, ownerId],
    );
    try {
      const result = spawnSync(
        'psql',
        scriptArguments('migration_chat_reliability_v2_preflight.sql'),
        scriptOptions(harness),
      );
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'chat preflight: duplicate active memberships',
      );
    } finally {
      await harness.query('DELETE FROM chat_group_members WHERE id=$1', [
        duplicateId,
      ]);
    }
  });

  it('rehearses legacy expand/backfill/contract, live inserts, and retry-safe phases', async () => {
    runScript(harness, 'migration_chat_reliability_v2_preflight.sql');
    runScript(harness, 'migration_chat_reliability_v2_expand.sql');
    runScript(harness, 'migration_chat_reliability_v2_indexes.sql');

    await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        harness.query(
          `INSERT INTO chat_messages(id,group_id,sender_id,content,created_at,updated_at,client_message_id)
           VALUES($1,$2,$3,$4,now(),now(),$5)`,
          [randomUUID(), groupId, ownerId, `live-${index}`, randomUUID()],
        ),
      ),
    );

    runScript(harness, 'migration_chat_reliability_v2_freeze_driver.sql');
    runScript(harness, 'migration_chat_reliability_v2_backfill.sql');
    let updated = 1;
    while (updated > 0) {
      const batch = await harness.query<{ updated: number }>(
        'SELECT chat_backfill_message_sequence_batch($1,2) updated',
        [groupId],
      );
      updated = batch.rows[0].updated;
    }
    await harness.query('SELECT chat_backfill_read_cursor($1)', [groupId]);

    runScript(harness, 'verify_chat_reliability_v2.sql');
    runScript(harness, 'migration_chat_reliability_v2_contract_prepare.sql');
    runScript(harness, 'migration_chat_reliability_v2_contract_validate.sql');
    runScript(harness, 'migration_chat_reliability_v2_contract.sql');

    // Simulate an ambiguous disconnect after contract by replaying each
    // independently retryable phase. The temporary proof may be absent.
    runScript(harness, 'migration_chat_reliability_v2_contract_prepare.sql');
    runScript(harness, 'migration_chat_reliability_v2_contract_validate.sql');
    runScript(harness, 'migration_chat_reliability_v2_contract.sql');

    const result = await harness.query<{
      total: string;
      null_sequences: string;
      distinct_sequences: string;
    }>(
      `SELECT COUNT(*)::text total,
              COUNT(*) FILTER (WHERE sequence IS NULL)::text null_sequences,
              COUNT(DISTINCT sequence)::text distinct_sequences
         FROM chat_messages WHERE group_id=$1`,
      [groupId],
    );
    expect(result.rows[0]).toEqual({
      total: '12',
      null_sequences: '0',
      distinct_sequences: '12',
    });
  });
});

function runScript(harness: IsolatedChatPgHarness, name: string): void {
  if (!guardedChatDatabaseUrl) {
    throw new Error('CHAT_MIGRATION_REHEARSAL_GUARD_NOT_ENABLED');
  }
  execFileSync('psql', scriptArguments(name), scriptOptions(harness));
}

function scriptArguments(name: string): string[] {
  if (!guardedChatDatabaseUrl) {
    throw new Error('CHAT_MIGRATION_REHEARSAL_GUARD_NOT_ENABLED');
  }
  return [
    '-X',
    '--no-psqlrc',
    '--dbname',
    guardedChatDatabaseUrl,
    '--file',
    join(process.cwd(), 'scripts', name),
  ];
}

function scriptOptions(harness: IsolatedChatPgHarness) {
  return {
    env: {
      ...process.env,
      PGOPTIONS: `-c search_path=${harness.schema},public`,
    },
    stdio: 'pipe' as const,
    encoding: 'utf8' as const,
  };
}
