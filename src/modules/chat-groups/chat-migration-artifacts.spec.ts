import { readFileSync } from 'fs';
import { join } from 'path';

const script = (name: string) =>
  readFileSync(join(process.cwd(), 'scripts', name), 'utf8');

describe('chat reliability migration artifacts', () => {
  it('keeps expand trigger-safe without a whole-database locking loop', () => {
    const expand = script('migration_chat_reliability_v2_expand.sql');
    expect(expand).toContain('trg_chat_assign_message_sequence');
    expect(expand).not.toMatch(
      /FOR\s+r\s+IN\s+SELECT\s+id\s+FROM\s+chat_groups/i,
    );
    expect(expand).not.toMatch(/^\s*CREATE\s+(UNIQUE\s+)?INDEX/im);
  });

  it('keeps chat push rollout additive, cutoff-gated, and token-private', () => {
    const preflight = script('migration_chat_push_delivery_preflight.sql');
    const expand = script('migration_chat_push_delivery_expand.sql');
    const verify = script('verify_chat_push_delivery.sql');
    const readme = script('README_chat_push_delivery.md');

    expect(preflight).toContain('\\set ON_ERROR_STOP on');
    expect(preflight).not.toMatch(/SELECT\s+expo_push_token/i);
    expect(expand).toContain('push_token_fingerprint char(64)');
    expect(expand).toContain('registration_version bigint NOT NULL DEFAULT 0');
    expect(expand).toContain('CREATE TABLE IF NOT EXISTS chat_push_deliveries');
    expect(expand).toContain('\\set AUTOCOMMIT on');
    expect(expand).toContain('CREATE UNIQUE INDEX CONCURRENTLY');
    expect(expand).toContain('CREATE INDEX CONCURRENTLY');
    expect(expand).toContain("SET lock_timeout = '3s'");
    expect(expand).toContain('NOT VALID');
    expect(expand).toContain(
      'VALIDATE CONSTRAINT ck_chat_outbox_push_intent_status',
    );
    expect(expand).toContain('schema_row.nspname = current_schema()');
    expect(expand).not.toMatch(
      /UPDATE\s+user_devices\s+SET\s+push_token_fingerprint/i,
    );
    expect(verify).not.toContain('expo_push_token');
    expect(readme).toContain('CHAT_PUSH_ACTIVATION_STARTED_AT');
    expect(readme).toContain('does not backfill old chat messages');
  });

  it('keeps direct-chat expand additive and index-safe', () => {
    const expand = script('migration_chat_direct_expand.sql');
    const verify = script('verify_chat_direct.sql');
    expect(expand).toContain('\\set ON_ERROR_STOP on');
    expect(expand).toContain("SET lock_timeout = '3s'");
    expect(expand).toContain(
      'ADD COLUMN IF NOT EXISTS direct_key varchar(200)',
    );
    expect(expand).toContain(
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_chat_groups_direct_key',
    );
    expect(expand).toContain(
      'WHERE direct_key IS NOT NULL AND deleted_at IS NULL',
    );
    expect(expand).toContain('indisvalid');
    expect(expand).toContain('\\set AUTOCOMMIT on');
    expect(expand).not.toMatch(/^\s*ALTER TABLE[^;]*DROP COLUMN/im);
    expect(verify).toContain('\\set ON_ERROR_STOP on');
    expect(verify).toContain('uq_chat_groups_direct_key');
    expect(verify).toContain('indisvalid = true');
    expect(verify).toContain('HAVING COUNT(*) > 2');
  });

  it('keeps preflight safe before additive sequence columns exist', () => {
    const preflight = script('migration_chat_reliability_v2_preflight.sql');
    expect(preflight).toContain('\\set ON_ERROR_STOP on');
    expect(preflight).toContain("attrelid = to_regclass('chat_messages')");
    expect(preflight).toContain("attname = 'sequence'");
    expect(preflight).toContain('EXECUTE $query$');
    expect(preflight).not.toContain("table_name = 'chat_messages'");
  });

  it('builds large indexes concurrently in a separate autocommit phase', () => {
    const indexes = script('migration_chat_reliability_v2_indexes.sql');
    expect(indexes).toContain('\\set AUTOCOMMIT on');
    expect(indexes).toContain('CREATE UNIQUE INDEX CONCURRENTLY');
    expect(indexes).toContain('ux_chat_group_message_sequence');
    expect(indexes).toContain('ix_chat_group_member_account_active');
    expect(indexes).toContain('ON chat_group_members(account_id, group_id)');
    expect(indexes).not.toMatch(
      /ux_chat_group_message_sequence[\s\S]{0,160}deleted_at/i,
    );
    expect(script('verify_chat_reliability_v2.sql')).toContain(
      'required concurrent indexes missing or invalid',
    );
  });

  it('fails fast and bounds every psql-operated contract phase', () => {
    const prepare = script(
      'migration_chat_reliability_v2_contract_prepare.sql',
    );
    const validate = script(
      'migration_chat_reliability_v2_contract_validate.sql',
    );
    const contract = script('migration_chat_reliability_v2_contract.sql');
    for (const phase of [prepare, validate, contract]) {
      expect(phase).toContain('\\set ON_ERROR_STOP on');
      expect(phase).toContain("SET lock_timeout = '3s'");
      expect(phase).toMatch(/SET statement_timeout = '[^']+';/);
    }
    expect(prepare).toContain('CHECK (sequence IS NOT NULL) NOT VALID');
    expect(validate).toContain(
      'VALIDATE CONSTRAINT ck_chat_message_sequence_not_null',
    );
    expect(validate).toContain("SET statement_timeout = '10min'");
  });

  it('attests every proof and supports an already-contracted retry', () => {
    const validate = script(
      'migration_chat_reliability_v2_contract_validate.sql',
    );
    const contract = script('migration_chat_reliability_v2_contract.sql');
    const proofs = [
      'ck_chat_message_sequence_not_null',
      'ck_chat_message_sequence_positive',
      'ck_chat_member_read_sequence_nonnegative',
    ];
    for (const proof of proofs) {
      expect(validate).toContain(`VALIDATE CONSTRAINT ${proof}`);
      expect(contract).toContain(proof);
    }
    expect(contract.match(/convalidated/g)).toHaveLength(3);
    expect(contract).toContain('message_sequence_is_not_null');
    expect(contract).toContain(
      'IF NOT message_sequence_is_not_null AND NOT EXISTS',
    );
    expect(contract).toContain('ALTER COLUMN sequence SET NOT NULL');
    expect(contract).toContain(
      'DROP CONSTRAINT IF EXISTS ck_chat_message_sequence_not_null',
    );
  });

  it('freezes bounded groups in separate psql autocommit statements', () => {
    const driver = script('migration_chat_reliability_v2_freeze_driver.sql');
    expect(driver).toContain('\\set AUTOCOMMIT on');
    expect(driver).toContain("SET lock_timeout = '3s'");
    expect(driver).toContain("SET statement_timeout = '15s'");
    expect(driver).toContain('LIMIT 250');
    expect(driver).toContain('\\gexec');
  });
});
