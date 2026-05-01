/**
 * Infra test (PR-F item 4): deductTasksAtomic idempotency at the
 * Postgres constraint level.
 *
 * `deductTasksAtomic` calls the production RPC
 * `deduct_tasks_if_available`, which lives in Supabase only — its SQL
 * isn't tracked in this repo's migrations, so we can't load the exact
 * function. Instead this file pins the contract `deductTasksAtomic`
 * RELIES ON: a UNIQUE constraint on
 * `(user_id, execution_id, event_type)` in the billing-events ledger,
 * which is what makes a retry under the same execution_id a no-op
 * even under concurrent calls.
 *
 * If the production RPC ever changes shape, the contract still holds
 * because the wider `deductTasksAtomic` flow depends on this exact
 * uniqueness guarantee:
 *   - First fire: INSERT succeeds, balance debited.
 *   - Retry of the same execution: INSERT raises 23505, caller
 *     surfaces as `idempotent_replay`.
 *   - Concurrent fire of the same execution: exactly one wins; the
 *     loser sees 23505 and treats as `idempotent_replay`.
 *   - Different execution_id: separate INSERT succeeds.
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
 * Build the minimal billing schema used by `deductTasksAtomic`. Two
 * tables:
 *   - `user_profiles` carries the per-user balance + cap
 *   - `task_billing_events` is the idempotency ledger; the unique
 *     constraint on `(user_id, execution_id, event_type)` is the
 *     specific guard `deductTasksAtomic` depends on.
 */
async function bootstrapBillingSchema(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE user_profiles (
      id uuid PRIMARY KEY,
      tasks_used int NOT NULL DEFAULT 0,
      tasks_limit int NOT NULL DEFAULT 100
    );

    CREATE TABLE task_billing_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      execution_id text NOT NULL,
      event_type text NOT NULL,
      amount int NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT task_billing_events_idempotent
        UNIQUE (user_id, execution_id, event_type)
    );
  `)
}

/**
 * Mimic the relevant slice of the production
 * `deduct_tasks_if_available` RPC: check balance, INSERT the
 * idempotency event, update the profile. ON CONFLICT (the
 * constraint we're testing) makes the second call a no-op replay.
 */
async function deduct(
  client: any,
  args: { userId: string; executionId: string; amount: number },
): Promise<{ resultType: 'deducted' | 'idempotent_replay' | 'insufficient_balance'; remaining: number }> {
  // Lock the profile row while we evaluate balance + write the event.
  await client.query('BEGIN')
  try {
    const profileRes = await client.query(
      `SELECT tasks_used, tasks_limit FROM user_profiles WHERE id = $1 FOR UPDATE`,
      [args.userId],
    )
    if (profileRes.rowCount === 0) {
      await client.query('ROLLBACK')
      return { resultType: 'insufficient_balance', remaining: 0 }
    }
    const { tasks_used, tasks_limit } = profileRes.rows[0]
    const remaining = tasks_limit - tasks_used

    // Try the INSERT first — if the same execution_id already exists,
    // it's a replay regardless of balance.
    const insertRes = await client.query(
      `INSERT INTO task_billing_events (user_id, execution_id, event_type, amount)
       VALUES ($1, $2, 'workflow_execution', $3)
       ON CONFLICT (user_id, execution_id, event_type) DO NOTHING
       RETURNING id`,
      [args.userId, args.executionId, args.amount],
    )

    if (insertRes.rowCount === 0) {
      // The unique key already had a row — replay.
      await client.query('COMMIT')
      return { resultType: 'idempotent_replay', remaining }
    }

    if (remaining < args.amount) {
      // Balance check has to happen AFTER the INSERT to get the
      // idempotency right: a retry of an over-budget call should
      // still classify as `idempotent_replay`, not flip to
      // `insufficient_balance`. Here on the first attempt we have
      // a fresh row but no balance — undo it.
      await client.query(
        `DELETE FROM task_billing_events WHERE user_id = $1 AND execution_id = $2 AND event_type = 'workflow_execution'`,
        [args.userId, args.executionId],
      )
      await client.query('COMMIT')
      return { resultType: 'insufficient_balance', remaining }
    }

    await client.query(
      `UPDATE user_profiles SET tasks_used = tasks_used + $2 WHERE id = $1`,
      [args.userId, args.amount],
    )
    await client.query('COMMIT')
    return { resultType: 'deducted', remaining: remaining - args.amount }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
}

const USER = '00000000-0000-0000-0000-aaaaaaaaaaaa'

describe('deductTasksAtomic — idempotency at the constraint level', () => {
  test('first deduction debits balance and writes a ledger row', async () => {
    if (!dbAvailable) {
      console.warn(`[deduct.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapBillingSchema(client)
      await client.query(`INSERT INTO user_profiles (id) VALUES ($1)`, [USER])

      const r = await deduct(client, { userId: USER, executionId: 'exec-A', amount: 5 })
      expect(r.resultType).toBe('deducted')
      expect(r.remaining).toBe(95)

      const profile = await client.query(
        `SELECT tasks_used FROM user_profiles WHERE id = $1`,
        [USER],
      )
      expect(profile.rows[0].tasks_used).toBe(5)

      const ledger = await client.query(
        `SELECT count(*)::int AS n FROM task_billing_events WHERE user_id = $1`,
        [USER],
      )
      expect(ledger.rows[0].n).toBe(1)
    })
  })

  test('retry of the same execution_id is idempotent (no double-charge)', async () => {
    if (!dbAvailable) {
      console.warn(`[deduct.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapBillingSchema(client)
      await client.query(`INSERT INTO user_profiles (id) VALUES ($1)`, [USER])

      const first = await deduct(client, { userId: USER, executionId: 'exec-B', amount: 5 })
      expect(first.resultType).toBe('deducted')

      const replay = await deduct(client, { userId: USER, executionId: 'exec-B', amount: 5 })
      expect(replay.resultType).toBe('idempotent_replay')

      // Balance is still 5, not 10 — proves no double-charge.
      const profile = await client.query(
        `SELECT tasks_used FROM user_profiles WHERE id = $1`,
        [USER],
      )
      expect(profile.rows[0].tasks_used).toBe(5)

      const ledger = await client.query(
        `SELECT count(*)::int AS n FROM task_billing_events WHERE user_id = $1`,
        [USER],
      )
      expect(ledger.rows[0].n).toBe(1)
    })
  })

  test('different execution_id deducts again (separate workflow runs)', async () => {
    if (!dbAvailable) {
      console.warn(`[deduct.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapBillingSchema(client)
      await client.query(`INSERT INTO user_profiles (id) VALUES ($1)`, [USER])

      await deduct(client, { userId: USER, executionId: 'exec-C1', amount: 3 })
      await deduct(client, { userId: USER, executionId: 'exec-C2', amount: 7 })

      const profile = await client.query(
        `SELECT tasks_used FROM user_profiles WHERE id = $1`,
        [USER],
      )
      expect(profile.rows[0].tasks_used).toBe(10)
    })
  })

  test('insufficient_balance: deduction over the cap is rejected and ledger stays clean', async () => {
    if (!dbAvailable) {
      console.warn(`[deduct.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapBillingSchema(client)
      await client.query(
        `INSERT INTO user_profiles (id, tasks_used, tasks_limit) VALUES ($1, 95, 100)`,
        [USER],
      )

      const r = await deduct(client, { userId: USER, executionId: 'exec-D', amount: 10 })
      expect(r.resultType).toBe('insufficient_balance')

      // Crucially: the ledger row was rolled back, so a future retry
      // with the SAME execution_id wouldn't see a stale event.
      const ledger = await client.query(
        `SELECT count(*)::int AS n FROM task_billing_events WHERE user_id = $1`,
        [USER],
      )
      expect(ledger.rows[0].n).toBe(0)
    })
  })

  test('concurrent deductions on same execution_id: exactly one wins, other is idempotent', async () => {
    if (!dbAvailable) {
      console.warn(`[deduct.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client, schema }) => {
      await bootstrapBillingSchema(client)
      await client.query(`INSERT INTO user_profiles (id) VALUES ($1)`, [USER])

      // Open two independent connections to race for the same execution_id.
      const [c1, c2] = await Promise.all([connect(), connect()])
      await c1.query(`SET search_path TO "${schema}", public`)
      await c2.query(`SET search_path TO "${schema}", public`)

      try {
        const [r1, r2] = await Promise.all([
          deduct(c1, { userId: USER, executionId: 'exec-RACE', amount: 5 }),
          deduct(c2, { userId: USER, executionId: 'exec-RACE', amount: 5 }),
        ])

        const winners = [r1, r2].filter((r) => r.resultType === 'deducted')
        const replays = [r1, r2].filter((r) => r.resultType === 'idempotent_replay')
        expect(winners).toHaveLength(1)
        expect(replays).toHaveLength(1)

        const profile = await client.query(
          `SELECT tasks_used FROM user_profiles WHERE id = $1`,
          [USER],
        )
        // Critical: only 5 charged total despite both threads firing.
        expect(profile.rows[0].tasks_used).toBe(5)

        const ledger = await client.query(
          `SELECT count(*)::int AS n FROM task_billing_events WHERE user_id = $1`,
          [USER],
        )
        expect(ledger.rows[0].n).toBe(1)
      } finally {
        await c1.end()
        await c2.end()
      }
    })
  })
})
