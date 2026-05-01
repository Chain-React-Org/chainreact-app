/**
 * Postgres test harness (PR-E).
 *
 * Connects to the local Postgres started by docker-compose.test.yml.
 * Used by infra-bound tests (PR-F) that need real DB behaviour:
 * unique-constraint violations, RLS enforcement, atomic RPCs, race
 * conditions, etc. Default unit tests do NOT import this — they keep
 * mocking the Supabase client.
 *
 * Style:
 *   - Lazy import of `pg` so any test file that doesn't actually call
 *     into this harness pays no dep cost.
 *   - `withTestDb(fn)` creates a fresh schema for the test, runs the
 *     callback against a `pg` Client scoped to that schema, and drops
 *     the schema in `finally`. Guarantees isolation even if the test
 *     throws.
 *   - Connection details come from env vars (`TEST_POSTGRES_*`) with
 *     defaults that match docker-compose.test.yml. CI overrides the
 *     host when running against the service container.
 *
 * Smoke verification:
 *   __tests__/infra/dbHarness.infra.test.ts proves the harness can
 *   connect, create a schema, run a query, and clean up.
 */

import { randomUUID } from 'crypto'

export interface TestDbConnectionConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
}

export const DEFAULT_TEST_DB_CONFIG: TestDbConnectionConfig = {
  host: process.env.TEST_POSTGRES_HOST || '127.0.0.1',
  port: Number(process.env.TEST_POSTGRES_PORT || 54329),
  user: process.env.TEST_POSTGRES_USER || 'test',
  password: process.env.TEST_POSTGRES_PASSWORD || 'test',
  database: process.env.TEST_POSTGRES_DB || 'chainreact_test',
}

/** Lazy require so the rest of the test suite doesn't need `pg`. */
function getPgClientCtor(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pg = require('pg')
  return pg.Client
}

/**
 * Open a single short-lived `pg` Client. Caller is responsible for
 * `client.end()`. Useful for top-level beforeAll setup that needs DB
 * access without the schema-isolation overhead of `withTestDb`.
 */
export async function connect(
  config: Partial<TestDbConnectionConfig> = {},
): Promise<any> {
  const Client = getPgClientCtor()
  const client = new Client({ ...DEFAULT_TEST_DB_CONFIG, ...config })
  await client.connect()
  return client
}

/**
 * The harness API tests interact with: a `pg.Client` plus the
 * generated schema name (so tests can build qualified table names).
 */
export interface TestDbContext {
  client: any
  schema: string
}

/**
 * Run `fn` against a fresh, isolated schema in the test database.
 * Lifecycle:
 *   1. Connect with the configured creds.
 *   2. CREATE SCHEMA test_<uuid> + SET search_path = test_<uuid>, public.
 *   3. Pass `{client, schema}` to `fn`.
 *   4. DROP SCHEMA <schema> CASCADE in `finally`, regardless of whether
 *      `fn` threw.
 *
 * Tests that need cross-schema setup (e.g. exercising `auth.uid()`)
 * should add the necessary GRANT/CREATE statements explicitly inside
 * the callback before exercising production SQL.
 */
export async function withTestDb<T>(
  fn: (ctx: TestDbContext) => Promise<T>,
  config: Partial<TestDbConnectionConfig> = {},
): Promise<T> {
  const client = await connect(config)
  const schema = `test_${randomUUID().replace(/-/g, '').slice(0, 24)}`

  try {
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}", public`)
    return await fn({ client, schema })
  } finally {
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    } catch (err: any) {
      // Best-effort cleanup; surface for diagnostic but don't mask the
      // original test failure.
      // eslint-disable-next-line no-console
      console.error(`[dbHarness] Failed to drop schema ${schema}:`, err?.message)
    }
    await client.end()
  }
}

/**
 * Truthy iff a connection to the configured test database succeeds.
 * Used by infra smoke tests as a precondition gate — if this is
 * false, the surrounding test should be skipped with a clear message.
 */
export async function isTestDbAvailable(
  config: Partial<TestDbConnectionConfig> = {},
): Promise<boolean> {
  let client: any
  try {
    client = await connect(config)
    await client.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    try {
      await client?.end()
    } catch {
      /* ignore */
    }
  }
}
