/**
 * Infra test (PR-F item 6): healthTransitionEngine end-to-end against
 * a real `integrations` row in Postgres.
 *
 * The engine is the only place in the system that writes the
 * notification-state fields (`health_check_status`,
 * `last_notification_milestone`, `requires_user_action`, etc.) per
 * CLAUDE.md "transition engine owns notification-state fields". This
 * test drives signals through the engine and verifies the persisted
 * row matches the documented state machine:
 *
 *   - NULL + proactive_health_check → baseline silently established
 *     (state written, milestone NOT updated, no notification)
 *   - healthy → action_required (token_revoked) → milestone =
 *     'action_required_initial' + user_action fields populated
 *   - action_required → healthy (recovery) → milestone = 'recovered'
 *     + user_action fields cleared
 *   - same-state signal twice → second is a no-op (no double-notify)
 *
 * Notifications themselves go through `notificationService` (slack,
 * email, etc.); this test mocks delivery at that boundary so we can
 * assert "notify was called with the right milestone" without setting
 * up a separate Slack/email side. The DB writes are real.
 *
 * Skips cleanly when Docker isn't running.
 */

import {
  isTestDbAvailable,
  withTestDb,
} from '../helpers/dbHarness'

const REQUIRES_DOCKER_NOTE =
  '(skipped: docker postgres not reachable — run `npm run test:infra:up`)'

// Mock the notification delivery layer so our tests don't try to send
// real Slack messages / emails. The engine still calls these — we just
// observe the calls.
const deliverWarning = jest.fn(async () => undefined)
const deliverDisconnection = jest.fn(async () => undefined)
const deliverRecovered = jest.fn(async () => undefined)
const deliverRateLimit = jest.fn(async () => undefined)

jest.mock('@/lib/integrations/notificationService', () => ({
  deliverWarningNotification: (...args: any[]) => deliverWarning(...args),
  deliverDisconnectionNotification: (...args: any[]) => deliverDisconnection(...args),
  deliverRateLimitNotification: (...args: any[]) => deliverRateLimit(...args),
  deliverRecoveredNotification: (...args: any[]) => deliverRecovered(...args),
}))

import {
  buildFailureSignal,
  buildHealthySignal,
  computeTransitionAndNotify,
  type Integration,
} from '@/lib/integrations/healthTransitionEngine'

let dbAvailable = false
beforeAll(async () => {
  dbAvailable = await isTestDbAvailable()
})

afterEach(() => {
  deliverWarning.mockClear()
  deliverDisconnection.mockClear()
  deliverRecovered.mockClear()
  deliverRateLimit.mockClear()
})

/** Schema mirrors the columns the engine reads + writes on `integrations`. */
async function bootstrapIntegrationsSchema(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE integrations (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      provider text NOT NULL,
      health_check_status text,
      last_notification_milestone text,
      last_notified_at timestamptz,
      requires_user_action boolean DEFAULT false,
      user_action_type text,
      user_action_deadline timestamptz,
      last_error_code text,
      last_error_details jsonb
    )
  `)
}

/**
 * Thin Supabase-shape adapter pointed at the real PG client. The
 * engine uses `.from('integrations').update(data).eq('id', x).eq(...)`
 * and reads `error` + `count` from the result. We translate that into
 * raw UPDATE SQL.
 */
function makeSupabaseAdapter(client: any) {
  return {
    from(table: string) {
      const builder: any = {
        _table: table,
        _action: '' as 'update' | 'select' | 'insert',
        _data: null as any,
        _conditions: [] as Array<{ op: string; col: string; val: any }>,

        update(data: any) {
          this._action = 'update'
          this._data = data
          return this
        },
        eq(col: string, val: any) {
          this._conditions.push({ op: 'eq', col, val })
          return this
        },
        is(col: string, val: any) {
          this._conditions.push({ op: 'is', col, val })
          return this
        },
        async then(onFulfilled: any) {
          if (this._action !== 'update') {
            return onFulfilled({ data: null, error: { message: 'unsupported' }, count: null })
          }
          const setClauses: string[] = []
          const params: any[] = []
          let i = 1
          for (const [k, v] of Object.entries(this._data)) {
            setClauses.push(`"${k}" = $${i++}`)
            params.push(v)
          }
          const whereClauses: string[] = []
          for (const c of this._conditions) {
            if (c.op === 'eq') {
              whereClauses.push(`"${c.col}" = $${i++}`)
              params.push(c.val)
            } else if (c.op === 'is' && c.val === null) {
              whereClauses.push(`"${c.col}" IS NULL`)
            } else if (c.op === 'is') {
              whereClauses.push(`"${c.col}" = $${i++}`)
              params.push(c.val)
            }
          }
          const sql = `UPDATE "${this._table}" SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`
          try {
            const res = await client.query(sql, params)
            return onFulfilled({ data: null, error: null, count: res.rowCount })
          } catch (err: any) {
            return onFulfilled({ data: null, error: { message: err.message }, count: null })
          }
        },
      }
      return builder
    },
  }
}

async function readIntegration(client: any, id: string): Promise<Integration | null> {
  const res = await client.query(
    `SELECT id, user_id, provider, health_check_status, last_notification_milestone,
            requires_user_action, user_action_type, user_action_deadline
     FROM integrations WHERE id = $1`,
    [id],
  )
  if (res.rowCount === 0) return null
  return res.rows[0] as Integration
}

const INT_ID = 'int-test-1'
const USER_ID = 'user-test-1'

async function insertIntegration(client: any, overrides: Partial<Integration> = {}): Promise<void> {
  const row = {
    id: INT_ID,
    user_id: USER_ID,
    provider: 'gmail',
    health_check_status: null,
    last_notification_milestone: null,
    requires_user_action: false,
    ...overrides,
  }
  await client.query(
    `INSERT INTO integrations
       (id, user_id, provider, health_check_status, last_notification_milestone, requires_user_action)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      row.id,
      row.user_id,
      row.provider,
      row.health_check_status,
      row.last_notification_milestone,
      row.requires_user_action,
    ],
  )
}

describe('healthTransitionEngine — state machine end-to-end', () => {
  test('NULL + proactive_health_check → baseline silently set, NO notification', async () => {
    if (!dbAvailable) {
      console.warn(`[healthEngine.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapIntegrationsSchema(client)
      await insertIntegration(client) // health_check_status = NULL
      const supabase = makeSupabaseAdapter(client)
      const integration = (await readIntegration(client, INT_ID))!

      const result = await computeTransitionAndNotify(
        supabase,
        integration,
        buildHealthySignal('proactive_health_check'),
      )

      expect(result.stateChanged).toBe(true)
      expect(result.newState).toBe('healthy')
      expect(result.notified).toBe(false)

      const after = await readIntegration(client, INT_ID)
      expect(after?.health_check_status).toBe('healthy')
      // Baseline rule: milestone NOT updated.
      expect(after?.last_notification_milestone).toBeNull()
      expect(deliverDisconnection).not.toHaveBeenCalled()
      expect(deliverRecovered).not.toHaveBeenCalled()
      expect(deliverWarning).not.toHaveBeenCalled()
    })
  })

  test('healthy → action_required (token_revoked): writes user_action fields + sends disconnection notification', async () => {
    if (!dbAvailable) {
      console.warn(`[healthEngine.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapIntegrationsSchema(client)
      await insertIntegration(client, { health_check_status: 'healthy' })
      const supabase = makeSupabaseAdapter(client)
      const integration = (await readIntegration(client, INT_ID))!

      const tokenRevokedError = {
        code: 'invalid_grant',
        isRecoverable: false,
        requiresUserAction: true,
        userActionType: 'reconnect',
        message: 'Token revoked. Please reconnect.',
      } as any

      const signal = buildFailureSignal(tokenRevokedError, 'token_refresh')
      const result = await computeTransitionAndNotify(supabase, integration, signal)

      expect(result.stateChanged).toBe(true)
      expect(result.newState).toBe('action_required')
      expect(result.milestone).toBe('action_required_initial')
      expect(result.notified).toBe(true)

      const after = await readIntegration(client, INT_ID)
      expect(after?.health_check_status).toBe('action_required')
      expect(after?.last_notification_milestone).toBe('action_required_initial')
      expect(after?.requires_user_action).toBe(true)
      expect(after?.user_action_type).toBe('reconnect')
      expect(after?.user_action_deadline).not.toBeNull()

      expect(deliverDisconnection).toHaveBeenCalledTimes(1)
    })
  })

  test('action_required → healthy (recovery): clears user_action fields + sends recovered notification', async () => {
    if (!dbAvailable) {
      console.warn(`[healthEngine.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapIntegrationsSchema(client)
      await insertIntegration(client, {
        health_check_status: 'action_required',
        last_notification_milestone: 'action_required_initial',
        requires_user_action: true,
        user_action_type: 'reconnect',
      })
      // Set a deadline so the column is non-null going in.
      await client.query(
        `UPDATE integrations SET user_action_deadline = now() + interval '5 days' WHERE id = $1`,
        [INT_ID],
      )

      const supabase = makeSupabaseAdapter(client)
      const integration = (await readIntegration(client, INT_ID))!

      const result = await computeTransitionAndNotify(
        supabase,
        integration,
        buildHealthySignal('reconnect'),
      )

      expect(result.stateChanged).toBe(true)
      expect(result.newState).toBe('healthy')
      expect(result.milestone).toBe('recovered')
      expect(result.notified).toBe(true)

      const after = await readIntegration(client, INT_ID)
      expect(after?.health_check_status).toBe('healthy')
      expect(after?.last_notification_milestone).toBe('recovered')
      // Critical: action fields cleared on recovery.
      expect(after?.requires_user_action).toBe(false)
      expect(after?.user_action_type).toBeNull()
      expect(after?.user_action_deadline).toBeNull()

      expect(deliverRecovered).toHaveBeenCalledTimes(1)
      expect(deliverDisconnection).not.toHaveBeenCalled()
    })
  })

  test('same-state signal twice: second is a no-op (no double-notify)', async () => {
    if (!dbAvailable) {
      console.warn(`[healthEngine.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapIntegrationsSchema(client)
      await insertIntegration(client, {
        health_check_status: 'action_required',
        last_notification_milestone: 'action_required_initial',
      })
      const supabase = makeSupabaseAdapter(client)
      const integration = (await readIntegration(client, INT_ID))!

      const tokenRevokedError = {
        code: 'invalid_grant',
        isRecoverable: false,
        requiresUserAction: true,
        userActionType: 'reconnect',
        message: 'Token revoked.',
      } as any
      const signal = buildFailureSignal(tokenRevokedError, 'token_refresh')

      // First call: state already action_required, target also action_required
      // → no-op (no duplicate notification). Engine returns stateChanged=false.
      const result = await computeTransitionAndNotify(supabase, integration, signal)
      expect(result.stateChanged).toBe(false)
      expect(result.notified).toBe(false)

      expect(deliverDisconnection).not.toHaveBeenCalled()
    })
  })

  test('warning state transition emits warning notification (not disconnection)', async () => {
    if (!dbAvailable) {
      console.warn(`[healthEngine.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapIntegrationsSchema(client)
      await insertIntegration(client, { health_check_status: 'healthy' })
      const supabase = makeSupabaseAdapter(client)
      const integration = (await readIntegration(client, INT_ID))!

      const transientError = {
        code: 'rate_limit_exceeded',
        isRecoverable: true,
        requiresUserAction: false,
        message: 'Rate limited; system will retry.',
      } as any

      const result = await computeTransitionAndNotify(
        supabase,
        integration,
        buildFailureSignal(transientError, 'proactive_health_check'),
      )

      expect(result.newState).toBe('warning')
      expect(result.milestone).toBe('warning')
      expect(result.notified).toBe(true)
      expect(deliverWarning).toHaveBeenCalledTimes(1)
      expect(deliverDisconnection).not.toHaveBeenCalled()
    })
  })
})
