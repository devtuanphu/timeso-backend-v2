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
