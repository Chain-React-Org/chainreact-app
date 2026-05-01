/**
 * Infra test (PR-F item 9): Publish route end-to-end against real DB.
 *
 * The publish route (`app/(app)/workflows/v2/api/flows/[flowId]/publish/route.ts`)
 * delegates to `publishRevision()` in
 * `src/lib/workflows/builder/publish.ts`. The route layer adds:
 *   - auth (route handler client → user.id)
 *   - access check (`checkWorkflowAccess` requires editor role)
 *   - schema validation (Zod)
 *
 * Those route-level concerns are platform/Next.js plumbing. The
 * substantive contract — "publish ONE revision, mark all others
 * unpublished, write the audit row" — lives in `publishRevision`.
 * That's what this test pins, against a real Postgres.
 *
 * Specifically:
 *   - publishRevision(rev1) on a fresh flow:
 *       - rev1 ends with published=true
 *       - workflows_published_revisions has one row
 *   - publishRevision(rev2) right after:
 *       - rev1 ends with published=false (only-one-published invariant)
 *       - rev2 ends with published=true
 *       - audit log accumulates a second row (history preserved)
 *   - getLatestPublishedRevision returns rev2's id
 *
 * Skips cleanly when Docker isn't running.
 */

import { isTestDbAvailable, withTestDb } from '../helpers/dbHarness'
import {
  publishRevision,
  getLatestPublishedRevision,
} from '@/src/lib/workflows/builder/publish'

const REQUIRES_DOCKER_NOTE =
  '(skipped: docker postgres not reachable — run `npm run test:infra:up`)'

let dbAvailable = false
beforeAll(async () => {
  dbAvailable = await isTestDbAvailable()
})

/**
 * Schema mirroring the columns `publishRevision` reads + writes. The
 * column set is small enough to recreate inline without loading the
 * full migration suite.
 */
async function bootstrapPublishSchema(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE workflows_revisions (
      id uuid PRIMARY KEY,
      workflow_id uuid NOT NULL,
      published boolean NOT NULL DEFAULT false,
      published_at timestamptz,
      published_by uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE workflows_published_revisions (
      id uuid PRIMARY KEY,
      workflow_id uuid NOT NULL,
      revision_id uuid NOT NULL,
      published_by uuid,
      published_at timestamptz NOT NULL,
      notes text
    );
  `)
}

/**
 * Supabase-shape adapter sufficient for `publishRevision` and
 * `getLatestPublishedRevision`. Supports:
 *   .from(t).update(o).eq(c, v)
 *   .from(t).insert(row)
 *   .from(t).select(c).eq(c, v).order(c, opts).limit(n).maybeSingle()
 */
function makeSupabaseAdapter(client: any) {
  return {
    from(table: string) {
      const builder: any = {
        _table: table,
        _action: '' as 'select' | 'update' | 'insert',
        _selectCols: '*',
        _data: null as any,
        _conditions: [] as Array<{ col: string; val: any }>,
        _order: null as { col: string; ascending: boolean } | null,
        _limit: null as number | null,
        _maybeSingle: false,

        update(data: any) {
          this._action = 'update'
          this._data = data
          return this
        },
        insert(row: any) {
          this._action = 'insert'
          this._data = row
          return this._execute()
        },
        select(cols: string = '*') {
          this._action = 'select'
          this._selectCols = cols
          return this
        },
        eq(col: string, val: any) {
          this._conditions.push({ col, val })
          return this._action === 'update' ? this._executeUpdate() : this
        },
        order(col: string, opts?: { ascending?: boolean }) {
          this._order = { col, ascending: opts?.ascending !== false }
          return this
        },
        limit(n: number) {
          this._limit = n
          return this
        },
        maybeSingle() {
          this._maybeSingle = true
          return this._execute()
        },
        single() {
          this._maybeSingle = false
          return this._execute()
        },

        async _executeUpdate(): Promise<any> {
          const setClauses: string[] = []
          const params: any[] = []
          let i = 1
          for (const [k, v] of Object.entries(this._data)) {
            setClauses.push(`"${k}" = $${i++}`)
            params.push(v)
          }
          const whereClauses: string[] = []
          for (const c of this._conditions) {
            whereClauses.push(`"${c.col}" = $${i++}`)
            params.push(c.val)
          }
          const sql = `UPDATE "${this._table}" SET ${setClauses.join(', ')}${whereClauses.length ? ` WHERE ${whereClauses.join(' AND ')}` : ''}`
          try {
            await client.query(sql, params)
            return { data: null, error: null }
          } catch (err: any) {
            return { data: null, error: { message: err.message } }
          }
        },
        async _execute(): Promise<any> {
          if (this._action === 'select') {
            const where = this._conditions
              .map((c, i) => `"${c.col}" = $${i + 1}`)
              .join(' AND ')
            let sql = `SELECT ${this._selectCols} FROM "${this._table}"`
            if (where) sql += ` WHERE ${where}`
            if (this._order) {
              sql += ` ORDER BY "${this._order.col}" ${this._order.ascending ? 'ASC' : 'DESC'}`
            }
            if (this._limit !== null) sql += ` LIMIT ${this._limit}`
            try {
              const res = await client.query(
                sql,
                this._conditions.map((c) => c.val),
              )
              return {
                data: this._maybeSingle ? res.rows[0] ?? null : res.rows,
                error: null,
              }
            } catch (err: any) {
              return { data: null, error: { message: err.message } }
            }
          }
          if (this._action === 'insert') {
            const row = this._data
            const cols = Object.keys(row)
            const params = cols.map((_, i) => `$${i + 1}`)
            const sql = `INSERT INTO "${this._table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${params.join(', ')})`
            try {
              await client.query(sql, cols.map((c) => row[c]))
              return { data: null, error: null }
            } catch (err: any) {
              return { data: null, error: { message: err.message, code: err.code } }
            }
          }
          return { data: null, error: { message: 'unknown action' } }
        },
      }
      return builder
    },
  }
}

const FLOW = '00000000-0000-0000-0000-fffffffffff1'
const REV1 = '00000000-0000-0000-0000-1aaaaaaaaaa1'
const REV2 = '00000000-0000-0000-0000-2bbbbbbbbbb2'
const USER = '00000000-0000-0000-0000-eeeeeeeeeeee'

async function seedRevisions(client: any): Promise<void> {
  await client.query(
    `INSERT INTO workflows_revisions (id, workflow_id, published) VALUES
       ($1, $3, false),
       ($2, $3, false)`,
    [REV1, REV2, FLOW],
  )
}

describe('publishRevision — end-to-end against real DB', () => {
  test('publishing rev1 marks it published + writes one audit row', async () => {
    if (!dbAvailable) {
      console.warn(`[publish.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapPublishSchema(client)
      await seedRevisions(client)
      const supabase = makeSupabaseAdapter(client) as any

      await publishRevision({
        flowId: FLOW,
        revisionId: REV1,
        publishedBy: USER,
        notes: 'initial publish',
        client: supabase,
      })

      // rev1 is published; rev2 stays unpublished.
      const rev1 = await client.query(
        `SELECT published, published_by FROM workflows_revisions WHERE id = $1`,
        [REV1],
      )
      expect(rev1.rows[0].published).toBe(true)
      expect(rev1.rows[0].published_by).toBe(USER)

      const rev2 = await client.query(
        `SELECT published FROM workflows_revisions WHERE id = $1`,
        [REV2],
      )
      expect(rev2.rows[0].published).toBe(false)

      // Audit log has one entry.
      const audit = await client.query(
        `SELECT revision_id, published_by, notes FROM workflows_published_revisions`,
      )
      expect(audit.rows).toHaveLength(1)
      expect(audit.rows[0].revision_id).toBe(REV1)
      expect(audit.rows[0].notes).toBe('initial publish')
    })
  })

  test('publishing rev2 unpublishes rev1 (only-one-published invariant) + audit history grows', async () => {
    if (!dbAvailable) {
      console.warn(`[publish.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapPublishSchema(client)
      await seedRevisions(client)
      const supabase = makeSupabaseAdapter(client) as any

      await publishRevision({
        flowId: FLOW,
        revisionId: REV1,
        publishedBy: USER,
        client: supabase,
      })
      await publishRevision({
        flowId: FLOW,
        revisionId: REV2,
        publishedBy: USER,
        notes: 'second',
        client: supabase,
      })

      // Critical invariant: only one revision of a flow is published
      // at a time.
      const rev1 = await client.query(
        `SELECT published FROM workflows_revisions WHERE id = $1`,
        [REV1],
      )
      expect(rev1.rows[0].published).toBe(false)

      const rev2 = await client.query(
        `SELECT published FROM workflows_revisions WHERE id = $1`,
        [REV2],
      )
      expect(rev2.rows[0].published).toBe(true)

      // Audit log preserves both publishes — history isn't overwritten.
      const audit = await client.query(
        `SELECT revision_id FROM workflows_published_revisions
         ORDER BY published_at ASC`,
      )
      expect(audit.rows.map((r: any) => r.revision_id)).toEqual([REV1, REV2])
    })
  })

  test('getLatestPublishedRevision returns the most recent revision_id', async () => {
    if (!dbAvailable) {
      console.warn(`[publish.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapPublishSchema(client)
      await seedRevisions(client)
      const supabase = makeSupabaseAdapter(client) as any

      await publishRevision({ flowId: FLOW, revisionId: REV1, client: supabase })
      // Force a deterministic later timestamp so ORDER BY published_at
      // DESC is unambiguous on fast local Postgres.
      await new Promise((r) => setTimeout(r, 5))
      await publishRevision({ flowId: FLOW, revisionId: REV2, client: supabase })

      const latest = await getLatestPublishedRevision(FLOW, supabase)
      expect(latest).toBe(REV2)
    })
  })

  test('publishing only affects the target flow (other flows are untouched)', async () => {
    if (!dbAvailable) {
      console.warn(`[publish.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapPublishSchema(client)

      const otherFlow = '00000000-0000-0000-0000-fffffffffff2'
      const otherRev = '00000000-0000-0000-0000-9cccccccccc9'
      await client.query(
        `INSERT INTO workflows_revisions (id, workflow_id, published) VALUES
           ($1, $5, false),
           ($2, $5, false),
           ($3, $4, true)`,
        [REV1, REV2, otherRev, otherFlow, FLOW],
      )

      const supabase = makeSupabaseAdapter(client) as any
      await publishRevision({ flowId: FLOW, revisionId: REV1, client: supabase })

      // The other flow's published revision is unaffected.
      const other = await client.query(
        `SELECT published FROM workflows_revisions WHERE id = $1`,
        [otherRev],
      )
      expect(other.rows[0].published).toBe(true)
    })
  })
})
