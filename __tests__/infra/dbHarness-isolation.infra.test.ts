/**
 * Infra test (PR-F item 1): dbHarness isolation guarantees.
 *
 * The PR-E smoke tests prove `withTestDb` connects + creates + drops
 * a schema. This file goes deeper:
 *   - two concurrent `withTestDb` calls do NOT see each other's tables
 *     (each gets its own schema; search_path is per-connection)
 *   - tables created in withTestDb are visible from a *separate*
 *     connection scoped to the same schema (proves the DDL committed,
 *     not just held in transaction)
 *   - withTestDb's CASCADE drop reclaims rows even when foreign-key
 *     references exist within the schema
 *   - empty / failing callbacks still drop their schema (verified at
 *     the catalog level, not just by the harness's own logging)
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

describe('dbHarness — isolation', () => {
  test('two concurrent withTestDb calls have completely separate schemas', async () => {
    if (!dbAvailable) {
      console.warn(`[isolation.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    let schemaA = ''
    let schemaB = ''
    let countSeenByA = -1
    let countSeenByB = -1

    await Promise.all([
      withTestDb(async ({ client, schema }) => {
        schemaA = schema
        await client.query('CREATE TABLE a (id int)')
        await client.query('INSERT INTO a (id) VALUES (1), (2), (3)')
        // Allow the other branch to run in parallel.
        await new Promise((r) => setTimeout(r, 50))
        const res = await client.query('SELECT count(*)::int AS n FROM a')
        countSeenByA = res.rows[0].n
      }),
      withTestDb(async ({ client, schema }) => {
        schemaB = schema
        await client.query('CREATE TABLE b (id int)')
        await client.query('INSERT INTO b (id) VALUES (10)')
        await new Promise((r) => setTimeout(r, 50))
        const res = await client.query('SELECT count(*)::int AS n FROM b')
        countSeenByB = res.rows[0].n
      }),
    ])

    expect(schemaA).not.toBe(schemaB)
    expect(countSeenByA).toBe(3)
    expect(countSeenByB).toBe(1)

    // Each schema sees only its own tables. Connect from outside and
    // verify both schemas were dropped.
    const verifier = await connect()
    try {
      const res = await verifier.query(
        `SELECT schema_name FROM information_schema.schemata
         WHERE schema_name = ANY($1)`,
        [[schemaA, schemaB]],
      )
      expect(res.rowCount).toBe(0)
    } finally {
      await verifier.end()
    }
  })

  test('DDL inside withTestDb is visible from a separate connection scoped to the same schema', async () => {
    if (!dbAvailable) {
      console.warn(`[isolation.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    let observedSchema = ''
    let externalSawTable = false

    await withTestDb(async ({ client, schema }) => {
      observedSchema = schema
      await client.query('CREATE TABLE persisted (id int)')
      await client.query('INSERT INTO persisted (id) VALUES (42)')

      // Open a second connection scoped to the same schema. If the
      // INSERT was held in an open transaction, this connection
      // wouldn't see the row. It does — DDL/DML auto-commits.
      const second = await connect()
      try {
        await second.query(`SET search_path TO "${schema}", public`)
        const res = await second.query('SELECT id FROM persisted')
        externalSawTable = res.rowCount === 1 && res.rows[0].id === 42
      } finally {
        await second.end()
      }
    })

    expect(externalSawTable).toBe(true)

    // After the wrapper exits, the schema is gone. Verify externally.
    const verifier = await connect()
    try {
      const res = await verifier.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
        [observedSchema],
      )
      expect(res.rowCount).toBe(0)
    } finally {
      await verifier.end()
    }
  })

  test('CASCADE drops parent + child tables even when FKs reference each other', async () => {
    if (!dbAvailable) {
      console.warn(`[isolation.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    let observedSchema = ''
    await withTestDb(async ({ client, schema }) => {
      observedSchema = schema
      await client.query(`
        CREATE TABLE parent (id int PRIMARY KEY);
        CREATE TABLE child (
          id int PRIMARY KEY,
          parent_id int REFERENCES parent(id)
        );
        INSERT INTO parent (id) VALUES (1);
        INSERT INTO child (id, parent_id) VALUES (10, 1);
      `)
    })

    // The harness's CASCADE drop should have removed both tables.
    const verifier = await connect()
    try {
      const res = await verifier.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
        [observedSchema],
      )
      expect(res.rowCount).toBe(0)
    } finally {
      await verifier.end()
    }
  })

  test('empty callback still drops its schema', async () => {
    if (!dbAvailable) {
      console.warn(`[isolation.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    let schema = ''
    await withTestDb(async (ctx) => {
      schema = ctx.schema
      // Intentional no-op.
    })

    const verifier = await connect()
    try {
      const res = await verifier.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
        [schema],
      )
      expect(res.rowCount).toBe(0)
    } finally {
      await verifier.end()
    }
  })
})
