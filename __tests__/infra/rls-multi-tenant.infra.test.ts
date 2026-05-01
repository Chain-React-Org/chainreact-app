/**
 * Infra test (PR-F item 3): RLS multi-tenant isolation.
 *
 * Two real users each own one row; the RLS policy "user can SELECT
 * their own row" must:
 *   - allow each user to see exactly their own row
 *   - deny each user the other user's row
 *   - apply identically on UPDATE / DELETE
 *
 * To exercise RLS without standing up the full Supabase stack, we
 * mimic the production auth shape:
 *   - A `auth` schema with a `uid()` function that reads
 *     `current_setting('chainreact.test_user_id', true)`.
 *   - A non-superuser role `app_user` that the policies actually
 *     evaluate against. (Postgres bypasses RLS for superuser /
 *     table owners — running queries as the `test` role would skip
 *     every policy and silently pass.)
 *
 * This is the real RLS path, not a simulation: when the test sets
 * `current_setting`, `auth.uid()` returns it, and policies that
 * compare against `auth.uid()` evaluate exactly as they would in
 * production against a Supabase `authenticated` role.
 *
 * Skips cleanly when Docker isn't running.
 */

import {
  connect,
  isTestDbAvailable,
  withTestDb,
} from '../helpers/dbHarness'

const REQUIRES_DOCKER_NOTE =
  '(skipped: docker postgres not reachable — run `npm run test:infra:up`)'

let dbAvailable = false
beforeAll(async () => {
  dbAvailable = await isTestDbAvailable()
})

/**
 * Bootstrap the auth schema + a non-superuser `app_user` role + RLS-
 * enforced `workflows` table. Mirrors the production shape: only
 * the row owner sees it. Test isolates this in a per-test schema so
 * concurrent runs don't trip on the role.
 */
async function bootstrapRlsHarness(client: any, schema: string): Promise<void> {
  await client.query(`
    -- auth.uid() reads from current_setting; tests SET that GUC.
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('chainreact.test_user_id', true), '')::uuid
    $$;
  `)

  await client.query(`
    CREATE TABLE workflows (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      name text NOT NULL
    );

    ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

    -- Production-shape policies: own-row SELECT/UPDATE/DELETE.
    CREATE POLICY "users select own workflows"
      ON workflows FOR SELECT
      USING (user_id = auth.uid());
    CREATE POLICY "users update own workflows"
      ON workflows FOR UPDATE
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
    CREATE POLICY "users delete own workflows"
      ON workflows FOR DELETE
      USING (user_id = auth.uid());
  `)
}

/**
 * Open a connection scoped to the supplied schema, switch to a
 * non-superuser role so RLS actually evaluates, and stamp the
 * `auth.uid()` value via the test GUC.
 */
async function connectAsUser(opts: {
  schema: string
  userId: string
}): Promise<any> {
  const c = await connect()
  await c.query(`SET search_path TO "${opts.schema}", auth, public`)

  // The harness's `test` role is a superuser, so policies are bypassed.
  // Switch to a fresh non-superuser role per test.
  // CREATE ROLE may already exist from another concurrent test; ignore
  // duplicates so we don't fight the race.
  try {
    await c.query(`CREATE ROLE app_user_runtime NOLOGIN`)
  } catch (err: any) {
    if (!/already exists/.test(err.message)) throw err
  }
  await c.query(`GRANT USAGE ON SCHEMA "${opts.schema}" TO app_user_runtime`)
  await c.query(`GRANT USAGE ON SCHEMA auth TO app_user_runtime`)
  await c.query(`GRANT EXECUTE ON FUNCTION auth.uid() TO app_user_runtime`)
  await c.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${opts.schema}" TO app_user_runtime`,
  )
  await c.query(`SET ROLE app_user_runtime`)

  // Stamp auth.uid() for this connection.
  await c.query(`SELECT set_config('chainreact.test_user_id', $1, false)`, [
    opts.userId,
  ])
  return c
}

const USER_A = '00000000-0000-0000-0000-00000000aaaa'
const USER_B = '00000000-0000-0000-0000-00000000bbbb'
const ROW_A = '11111111-1111-1111-1111-111111111111'
const ROW_B = '22222222-2222-2222-2222-222222222222'

describe('RLS multi-tenant isolation', () => {
  test('SELECT: user A sees only their own row; user B sees only theirs', async () => {
    if (!dbAvailable) {
      console.warn(`[rls.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client, schema }) => {
      await bootstrapRlsHarness(client, schema)

      // Insert as superuser (which bypasses RLS on its own table).
      await client.query(
        `INSERT INTO workflows (id, user_id, name) VALUES
           ($1, $2, 'A wf'),
           ($3, $4, 'B wf')`,
        [ROW_A, USER_A, ROW_B, USER_B],
      )

      const aClient = await connectAsUser({ schema, userId: USER_A })
      try {
        const visibleToA = await aClient.query('SELECT id FROM workflows ORDER BY id')
        expect(visibleToA.rows.map((r: any) => r.id)).toEqual([ROW_A])
      } finally {
        await aClient.end()
      }

      const bClient = await connectAsUser({ schema, userId: USER_B })
      try {
        const visibleToB = await bClient.query('SELECT id FROM workflows ORDER BY id')
        expect(visibleToB.rows.map((r: any) => r.id)).toEqual([ROW_B])
      } finally {
        await bClient.end()
      }
    })
  })

  test('UPDATE: user B cannot update user A\'s row (zero rows affected)', async () => {
    if (!dbAvailable) {
      console.warn(`[rls.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client, schema }) => {
      await bootstrapRlsHarness(client, schema)
      await client.query(
        `INSERT INTO workflows (id, user_id, name) VALUES ($1, $2, 'original')`,
        [ROW_A, USER_A],
      )

      const bClient = await connectAsUser({ schema, userId: USER_B })
      try {
        const res = await bClient.query(
          `UPDATE workflows SET name = 'pwned' WHERE id = $1 RETURNING id`,
          [ROW_A],
        )
        expect(res.rowCount).toBe(0)
      } finally {
        await bClient.end()
      }

      // Confirm the row name didn't change.
      const verify = await client.query(
        `SELECT name FROM workflows WHERE id = $1`,
        [ROW_A],
      )
      expect(verify.rows[0].name).toBe('original')
    })
  })

  test('DELETE: user B cannot delete user A\'s row (zero rows affected)', async () => {
    if (!dbAvailable) {
      console.warn(`[rls.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client, schema }) => {
      await bootstrapRlsHarness(client, schema)
      await client.query(
        `INSERT INTO workflows (id, user_id, name) VALUES ($1, $2, 'A')`,
        [ROW_A, USER_A],
      )

      const bClient = await connectAsUser({ schema, userId: USER_B })
      try {
        const res = await bClient.query(
          `DELETE FROM workflows WHERE id = $1 RETURNING id`,
          [ROW_A],
        )
        expect(res.rowCount).toBe(0)
      } finally {
        await bClient.end()
      }

      const verify = await client.query(
        `SELECT count(*)::int AS n FROM workflows WHERE id = $1`,
        [ROW_A],
      )
      expect(verify.rows[0].n).toBe(1)
    })
  })

  test('UPDATE WITH CHECK: user A cannot reassign user_id to user B (RLS rejects)', async () => {
    if (!dbAvailable) {
      console.warn(`[rls.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client, schema }) => {
      await bootstrapRlsHarness(client, schema)
      await client.query(
        `INSERT INTO workflows (id, user_id, name) VALUES ($1, $2, 'A')`,
        [ROW_A, USER_A],
      )

      const aClient = await connectAsUser({ schema, userId: USER_A })
      try {
        await expect(
          aClient.query(
            `UPDATE workflows SET user_id = $2 WHERE id = $1`,
            [ROW_A, USER_B],
          ),
        ).rejects.toThrow(/violates row-level security/i)
      } finally {
        await aClient.end()
      }
    })
  })

  test('No auth.uid() set: user sees zero rows (RLS denies on null)', async () => {
    if (!dbAvailable) {
      console.warn(`[rls.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client, schema }) => {
      await bootstrapRlsHarness(client, schema)
      await client.query(
        `INSERT INTO workflows (id, user_id, name) VALUES
           ($1, $2, 'A wf'),
           ($3, $4, 'B wf')`,
        [ROW_A, USER_A, ROW_B, USER_B],
      )

      // Connect without setting the GUC.
      const anonClient = await connect()
      try {
        await anonClient.query(`SET search_path TO "${schema}", auth, public`)
        try {
          await anonClient.query(`CREATE ROLE app_user_runtime NOLOGIN`)
        } catch (err: any) {
          if (!/already exists/.test(err.message)) throw err
        }
        await anonClient.query(`GRANT USAGE ON SCHEMA "${schema}" TO app_user_runtime`)
        await anonClient.query(`GRANT USAGE ON SCHEMA auth TO app_user_runtime`)
        await anonClient.query(`GRANT EXECUTE ON FUNCTION auth.uid() TO app_user_runtime`)
        await anonClient.query(
          `GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO app_user_runtime`,
        )
        await anonClient.query(`SET ROLE app_user_runtime`)
        // No SET current_setting for chainreact.test_user_id.

        const res = await anonClient.query('SELECT count(*)::int AS n FROM workflows')
        expect(res.rows[0].n).toBe(0)
      } finally {
        await anonClient.end()
      }
    })
  })
})
