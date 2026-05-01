/**
 * Infra test (PR-F item 5): ensureUserProfile race condition.
 *
 * `ensureUserProfile` (lib/auth/ensureUserProfile.ts) must:
 *   1. SELECT first; if row exists, return it.
 *   2. INSERT; if it succeeds, return the new row.
 *   3. If INSERT raises a unique-violation (23505) — meaning another
 *      caller raced ahead and inserted the same id between our SELECT
 *      and our INSERT — fall back to a SELECT and return the winner's
 *      row instead of failing the request.
 *
 * The branch that matters is step 3. This test pins the contract at
 * the PG-constraint level: two concurrent INSERTs for the same id
 * must produce exactly one winner row + one 23505 caller, and the
 * 23505 caller can read the winner's row.
 *
 * Why test the constraint directly instead of `ensureUserProfile`
 * itself: the function uses `supabase.auth.admin.getUserById` and
 * `syncAccessClaims`, both of which talk to Supabase Auth. The race
 * is at the `user_profiles` PRIMARY KEY layer — Supabase's
 * `.insert().select().single()` translates a 23505 into the
 * `insertError.code === '23505'` branch the production code matches
 * on. This file proves the underlying PG behaviour our code expects.
 *
 * Skips cleanly when Docker isn't running.
 */

import {
  isTestDbAvailable,
  withTestDb,
  connect,
} from '../helpers/dbHarness'

const REQUIRES_DOCKER_NOTE =
  '(skipped: docker postgres not reachable — run `npm run test:infra:up`)'

let dbAvailable = false
beforeAll(async () => {
  dbAvailable = await isTestDbAvailable()
})

/**
 * Minimal `user_profiles` shape — only the columns the production
 * INSERT uses are needed for the race test. The PRIMARY KEY on `id`
 * is the constraint that makes the second INSERT raise 23505.
 */
async function bootstrapProfilesSchema(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE user_profiles (
      id uuid PRIMARY KEY,
      email text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

const USER = '00000000-0000-0000-0000-cccccccccccc'

describe('ensureUserProfile — concurrent insert race condition', () => {
  test('two concurrent INSERTs for the same id: exactly one wins, the other gets 23505', async () => {
    if (!dbAvailable) {
      console.warn(`[ensureUserProfile.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client, schema }) => {
      await bootstrapProfilesSchema(client)

      // Independent connections so the two inserts genuinely race.
      const [c1, c2] = await Promise.all([connect(), connect()])
      await c1.query(`SET search_path TO "${schema}", public`)
      await c2.query(`SET search_path TO "${schema}", public`)

      try {
        const settled = await Promise.allSettled([
          c1.query(
            `INSERT INTO user_profiles (id, email) VALUES ($1, $2) RETURNING id`,
            [USER, 'first@example.com'],
          ),
          c2.query(
            `INSERT INTO user_profiles (id, email) VALUES ($1, $2) RETURNING id`,
            [USER, 'second@example.com'],
          ),
        ])

        const winners = settled.filter((s) => s.status === 'fulfilled')
        const losers = settled.filter((s) => s.status === 'rejected') as PromiseRejectedResult[]
        expect(winners).toHaveLength(1)
        expect(losers).toHaveLength(1)

        // The losing INSERT raised SQLSTATE 23505 — exactly the code
        // ensureUserProfile.ts:208 matches on.
        const loserError: any = losers[0].reason
        expect(loserError?.code).toBe('23505')

        // Exactly one row exists.
        const verify = await client.query(
          `SELECT count(*)::int AS n FROM user_profiles WHERE id = $1`,
          [USER],
        )
        expect(verify.rows[0].n).toBe(1)
      } finally {
        await c1.end()
        await c2.end()
      }
    })
  })

  test("loser's fallback SELECT returns the winner's row", async () => {
    if (!dbAvailable) {
      console.warn(`[ensureUserProfile.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client, schema }) => {
      await bootstrapProfilesSchema(client)

      const [c1, c2] = await Promise.all([connect(), connect()])
      await c1.query(`SET search_path TO "${schema}", public`)
      await c2.query(`SET search_path TO "${schema}", public`)

      try {
        // Mimic the production sequence:
        //   c1 reaches INSERT first (the winner)
        //   c2 issues INSERT, hits 23505, runs the fallback SELECT
        await c1.query(
          `INSERT INTO user_profiles (id, email) VALUES ($1, $2)`,
          [USER, 'winner@example.com'],
        )

        let raised23505 = false
        try {
          await c2.query(
            `INSERT INTO user_profiles (id, email) VALUES ($1, $2)`,
            [USER, 'loser@example.com'],
          )
        } catch (err: any) {
          if (err.code === '23505') raised23505 = true
          else throw err
        }
        expect(raised23505).toBe(true)

        // Fallback SELECT — same shape ensureUserProfile uses (line 211).
        const fallback = await c2.query(
          `SELECT id, email FROM user_profiles WHERE id = $1`,
          [USER],
        )
        expect(fallback.rowCount).toBe(1)
        expect(fallback.rows[0].email).toBe('winner@example.com')
      } finally {
        await c1.end()
        await c2.end()
      }
    })
  })

  test('non-conflicting INSERTs (different ids) both succeed concurrently', async () => {
    if (!dbAvailable) {
      console.warn(`[ensureUserProfile.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client, schema }) => {
      await bootstrapProfilesSchema(client)

      const [c1, c2] = await Promise.all([connect(), connect()])
      await c1.query(`SET search_path TO "${schema}", public`)
      await c2.query(`SET search_path TO "${schema}", public`)

      try {
        const u1 = '00000000-0000-0000-0000-c11111111111'
        const u2 = '00000000-0000-0000-0000-c22222222222'

        await Promise.all([
          c1.query(
            `INSERT INTO user_profiles (id, email) VALUES ($1, $2)`,
            [u1, 'a@example.com'],
          ),
          c2.query(
            `INSERT INTO user_profiles (id, email) VALUES ($1, $2)`,
            [u2, 'b@example.com'],
          ),
        ])

        const verify = await client.query(
          `SELECT count(*)::int AS n FROM user_profiles`,
        )
        expect(verify.rows[0].n).toBe(2)
      } finally {
        await c1.end()
        await c2.end()
      }
    })
  })
})
