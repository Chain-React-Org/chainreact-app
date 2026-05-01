/**
 * Smoke test: dbHarness can talk to the Docker Postgres.
 *
 * Verifies (1) the harness connects with the configured creds,
 * (2) `withTestDb` creates an isolated schema and runs SQL inside it,
 * and (3) the schema is dropped on teardown even when the callback
 * throws.
 *
 * Skipped when the harness can't reach the configured DB — protects
 * developer machines that haven't run `npm run test:infra:up` yet.
 */

import {
  connect,
  isTestDbAvailable,
  withTestDb,
} from '../helpers/dbHarness'

const REQUIRES_DOCKER_NOTE =
  '(skipped: docker postgres not reachable — run `npm run test:infra:up`)'

// `describe.skip` clarifies in the reporter why a smoke test was skipped.
let dbAvailable = false
beforeAll(async () => {
  dbAvailable = await isTestDbAvailable()
})

describe('dbHarness — smoke', () => {
  test('can connect, run SELECT 1, and disconnect cleanly', async () => {
    if (!dbAvailable) {
      console.warn(`[dbHarness.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }
    const client = await connect()
    try {
      const res = await client.query('SELECT 1 AS one')
      expect(res.rows[0]).toEqual({ one: 1 })
    } finally {
      await client.end()
    }
  })

  test('withTestDb creates an isolated schema, runs SQL in it, drops it on success', async () => {
    if (!dbAvailable) {
      console.warn(`[dbHarness.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    let observedSchema = ''
    await withTestDb(async ({ client, schema }) => {
      observedSchema = schema
      // Create a table inside the schema; it should land on the
      // search_path the harness set.
      await client.query('CREATE TABLE smoke_t (id int)')
      await client.query('INSERT INTO smoke_t (id) VALUES (42)')
      const res = await client.query('SELECT id FROM smoke_t')
      expect(res.rows[0].id).toBe(42)
    })

    // Verify the schema is gone after the wrapper exits.
    const verifier = await connect()
    try {
      const res = await verifier.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
        [observedSchema],
      )
      expect(res.rowCount).toBe(0)
    } finally {
      await verifier.end()
    }
  })

  test('withTestDb drops the schema even when the callback throws', async () => {
    if (!dbAvailable) {
      console.warn(`[dbHarness.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    let leakedSchema = ''
    await expect(
      withTestDb(async ({ schema, client }) => {
        leakedSchema = schema
        await client.query('CREATE TABLE will_be_dropped (x int)')
        throw new Error('test failure inside withTestDb')
      }),
    ).rejects.toThrow(/test failure inside withTestDb/)

    const verifier = await connect()
    try {
      const res = await verifier.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
        [leakedSchema],
      )
      expect(res.rowCount).toBe(0)
    } finally {
      await verifier.end()
    }
  })
})
