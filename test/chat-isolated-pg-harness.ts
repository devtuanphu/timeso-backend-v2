import { randomUUID } from 'crypto';
import { Pool, PoolClient, QueryResult } from 'pg';

const isolatedFlag = process.env.TIMESO_ISOLATED_DB;
const connectionString = process.env.TIMESO_TEST_DATABASE_URL;

const resolveGuardedDatabaseUrl = (): string | null => {
  if (isolatedFlag !== 'true') return null;
  if (!connectionString) {
    throw new Error('CHAT_E2E_DATABASE_URL_REQUIRED');
  }
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(
      new URL(connectionString).pathname.slice(1),
    );
  } catch {
    throw new Error('CHAT_E2E_DATABASE_URL_INVALID');
  }
  if (!databaseName.endsWith('_test')) {
    throw new Error('CHAT_E2E_DATABASE_MUST_END_IN_TEST');
  }
  return connectionString;
};

export const guardedChatDatabaseUrl = resolveGuardedDatabaseUrl();
export const describeWithIsolatedChatDatabase = ((
  ...args: Parameters<typeof describe>
) => {
  const runtimeDescribe = (globalThis as { describe?: typeof describe })
    .describe;
  if (!runtimeDescribe) {
    throw new Error('CHAT_E2E_JEST_DESCRIBE_REQUIRED');
  }
  const selected = guardedChatDatabaseUrl
    ? runtimeDescribe
    : runtimeDescribe.skip;
  return selected(...args);
}) as typeof describe;

export class IsolatedChatPgHarness {
  readonly schema: string;
  readonly pool: Pool;

  constructor(schema = `chat_e2e_${randomUUID().replace(/-/g, '')}`) {
    if (!guardedChatDatabaseUrl) {
      throw new Error('CHAT_E2E_DATABASE_GUARD_NOT_ENABLED');
    }
    this.schema = schema;
    this.assertOwnedSchema();
    this.pool = new Pool({ connectionString: guardedChatDatabaseUrl, max: 12 });
  }

  async createSchema(): Promise<void> {
    this.assertOwnedSchema();
    await this.pool.query(`CREATE SCHEMA "${this.schema}"`);
  }

  async connect(): Promise<PoolClient> {
    const client = await this.pool.connect();
    await client.query(`SET search_path TO "${this.schema}", public`);
    return client;
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const client = await this.connect();
    try {
      return await client.query<T>(sql, values);
    } finally {
      client.release();
    }
  }

  async cleanup(): Promise<void> {
    this.assertOwnedSchema();
    const client = await this.pool.connect();
    try {
      await client.query(`DROP SCHEMA "${this.schema}" CASCADE`);
    } finally {
      client.release();
      await this.pool.end();
    }
  }

  private assertOwnedSchema(): void {
    if (!/^chat_e2e_[0-9a-f]{32}$/.test(this.schema)) {
      throw new Error('CHAT_E2E_SCHEMA_OWNERSHIP_INVALID');
    }
  }
}
