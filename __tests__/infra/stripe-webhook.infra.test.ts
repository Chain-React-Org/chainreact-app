/**
 * Infra test (PR-F item 7): Stripe webhook signature → handler → DB row.
 *
 * The Stripe billing webhook (app/api/webhooks/stripe-billing/route.ts)
 * has two correctness boundaries the rest of the codebase trusts:
 *
 *   1. Signature verification — `stripe.webhooks.constructEvent` MUST
 *      reject any payload whose signature isn't HMAC-valid against the
 *      configured webhook secret. A regression that loosens this would
 *      let anyone post a fake webhook and trigger billing changes.
 *
 *   2. Idempotency — `isEventProcessed` / `markEventProcessed`
 *      (lib/entitlements/entitlement-service.ts) read/write
 *      `stripe_processed_events` so a Stripe retry of the same event
 *      doesn't double-apply. The contract: first observation returns
 *      false, then `markEventProcessed` writes, then any later
 *      observation returns true.
 *
 * Both boundaries are tested here against the REAL stripe SDK and the
 * REAL Postgres (no mocks of either). Synthesizing the full Next.js
 * Route handler request is out of scope — the route is a thin wrapper
 * that just calls these two functions plus business-logic dispatchers
 * (covered by their own tests). This file pins the hard contracts the
 * route's correctness depends on.
 *
 * Skips cleanly when Docker isn't running.
 */

import { isTestDbAvailable, withTestDb } from '../helpers/dbHarness'
import {
  isEventProcessed,
  markEventProcessed,
} from '@/lib/entitlements/entitlement-service'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Stripe = require('stripe')

const REQUIRES_DOCKER_NOTE =
  '(skipped: docker postgres not reachable — run `npm run test:infra:up`)'

let dbAvailable = false
beforeAll(async () => {
  dbAvailable = await isTestDbAvailable()
})

const TEST_WEBHOOK_SECRET = 'whsec_test_for_pr_f_item_7'

/**
 * Construct a real Stripe webhook payload + valid signature using the
 * SDK's own helpers. This is exactly the path Stripe's servers use,
 * so verifying it against `stripe.webhooks.constructEvent` exercises
 * the production signature path.
 */
function makeSignedEvent(opts: {
  eventId: string
  eventType: string
  payload: Record<string, any>
  secret?: string
  timestamp?: number
}): { body: string; signature: string } {
  const stripe = new Stripe('sk_test_irrelevant_for_signing', {
    apiVersion: '2024-10-28.acacia',
  })
  const ts = opts.timestamp ?? Math.floor(Date.now() / 1000)
  const event = {
    id: opts.eventId,
    object: 'event',
    api_version: '2024-10-28.acacia',
    created: ts,
    type: opts.eventType,
    data: { object: opts.payload },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  }
  const body = JSON.stringify(event)
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: opts.secret ?? TEST_WEBHOOK_SECRET,
    timestamp: ts,
  })
  return { body, signature }
}

/**
 * Verify with the real Stripe SDK — same call the production route
 * makes (`stripe.webhooks.constructEvent`).
 */
function verifyWithSdk(body: string, signature: string, secret: string): any {
  const stripe = new Stripe('sk_test_irrelevant', {
    apiVersion: '2024-10-28.acacia',
  })
  return stripe.webhooks.constructEvent(body, signature, secret)
}

/**
 * Schema for the idempotency ledger. Mirrors the columns
 * `markEventProcessed` writes.
 */
async function bootstrapStripeEventsSchema(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE stripe_processed_events (
      event_id text PRIMARY KEY,
      event_type text NOT NULL,
      event_created timestamptz NOT NULL,
      stripe_customer_id text,
      stripe_subscription_id text,
      processed_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

/**
 * Supabase-shape adapter pointed at the real PG client. The
 * entitlement-service functions use `.from('table').select().eq().single()`
 * and `.from('table').insert(row)`. We translate those into raw SQL.
 */
function makeSupabaseAdapter(client: any) {
  return {
    from(table: string) {
      const builder: any = {
        _table: table,
        _action: '' as 'select' | 'insert',
        _selectCols: '*',
        _insertRow: null as any,
        _conditions: [] as Array<{ col: string; val: any }>,
        _wantSingle: false,

        select(cols: string) {
          this._action = 'select'
          this._selectCols = cols
          return this
        },
        eq(col: string, val: any) {
          this._conditions.push({ col, val })
          return this
        },
        single() {
          this._wantSingle = true
          return this._execute()
        },
        insert(row: any) {
          this._action = 'insert'
          this._insertRow = row
          return this._execute()
        },
        async _execute(): Promise<any> {
          if (this._action === 'select') {
            const where = this._conditions
              .map((c, i) => `"${c.col}" = $${i + 1}`)
              .join(' AND ')
            const sql = `SELECT ${this._selectCols} FROM "${this._table}"${where ? ` WHERE ${where}` : ''}${this._wantSingle ? ' LIMIT 1' : ''}`
            try {
              const res = await client.query(
                sql,
                this._conditions.map((c) => c.val),
              )
              return {
                data: this._wantSingle ? res.rows[0] ?? null : res.rows,
                error: null,
              }
            } catch (err: any) {
              return { data: null, error: { message: err.message } }
            }
          }
          if (this._action === 'insert') {
            const row = this._insertRow
            const cols = Object.keys(row)
            const params = cols.map((_, i) => `$${i + 1}`)
            const sql = `INSERT INTO "${this._table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${params.join(', ')})`
            try {
              await client.query(
                sql,
                cols.map((c) => row[c]),
              )
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

describe('Stripe webhook signature verification (real SDK)', () => {
  test('a properly-signed payload is accepted and the event reconstructs correctly', () => {
    const { body, signature } = makeSignedEvent({
      eventId: 'evt_test_sig_ok',
      eventType: 'invoice.payment_succeeded',
      payload: { id: 'in_1', amount_paid: 1000 },
    })

    const event = verifyWithSdk(body, signature, TEST_WEBHOOK_SECRET)
    expect(event.id).toBe('evt_test_sig_ok')
    expect(event.type).toBe('invoice.payment_succeeded')
    expect(event.data.object.amount_paid).toBe(1000)
  })

  test('a payload signed with the wrong secret is REJECTED with a clear error', () => {
    const { body, signature } = makeSignedEvent({
      eventId: 'evt_test_sig_wrong_secret',
      eventType: 'invoice.payment_succeeded',
      payload: { id: 'in_1' },
      secret: 'whsec_attacker_guess',
    })

    expect(() =>
      verifyWithSdk(body, signature, TEST_WEBHOOK_SECRET),
    ).toThrow(/signature/i)
  })

  test('a tampered payload (body mutated after signing) is REJECTED', () => {
    const { body, signature } = makeSignedEvent({
      eventId: 'evt_test_sig_tampered',
      eventType: 'invoice.payment_succeeded',
      payload: { id: 'in_1', amount_paid: 1000 },
    })

    const tampered = body.replace('"amount_paid":1000', '"amount_paid":99999')
    expect(() =>
      verifyWithSdk(tampered, signature, TEST_WEBHOOK_SECRET),
    ).toThrow(/signature|verification/i)
  })

  test('a missing signature header is REJECTED', () => {
    const { body } = makeSignedEvent({
      eventId: 'evt_test_no_sig',
      eventType: 'invoice.payment_succeeded',
      payload: { id: 'in_1' },
    })

    expect(() =>
      verifyWithSdk(body, '', TEST_WEBHOOK_SECRET),
    ).toThrow()
  })
})

describe('Stripe webhook idempotency ledger against real Postgres', () => {
  test('isEventProcessed returns false for unseen event; markEventProcessed writes the row; isEventProcessed returns true', async () => {
    if (!dbAvailable) {
      console.warn(`[stripe-webhook.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapStripeEventsSchema(client)
      const supabase = makeSupabaseAdapter(client)

      const before = await isEventProcessed(supabase as any, 'evt_idem_001')
      expect(before).toBe(false)

      await markEventProcessed(supabase as any, {
        eventId: 'evt_idem_001',
        eventType: 'invoice.payment_succeeded',
        eventCreated: new Date('2026-04-30T10:00:00Z'),
        customerId: 'cus_001',
        subscriptionId: null,
      })

      const after = await isEventProcessed(supabase as any, 'evt_idem_001')
      expect(after).toBe(true)

      const row = await client.query(
        `SELECT event_id, event_type, stripe_customer_id, stripe_subscription_id
         FROM stripe_processed_events WHERE event_id = $1`,
        ['evt_idem_001'],
      )
      expect(row.rows[0].event_id).toBe('evt_idem_001')
      expect(row.rows[0].event_type).toBe('invoice.payment_succeeded')
      expect(row.rows[0].stripe_customer_id).toBe('cus_001')
      expect(row.rows[0].stripe_subscription_id).toBeNull()
    })
  })

  test('full path: real signed payload → SDK verify → mark processed → idempotent on retry', async () => {
    if (!dbAvailable) {
      console.warn(`[stripe-webhook.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapStripeEventsSchema(client)
      const supabase = makeSupabaseAdapter(client)

      // Sign + verify a real event using the SDK.
      const { body, signature } = makeSignedEvent({
        eventId: 'evt_full_path',
        eventType: 'invoice.payment_succeeded',
        payload: { id: 'in_full', amount_paid: 5000 },
      })
      const event = verifyWithSdk(body, signature, TEST_WEBHOOK_SECRET)
      expect(event.id).toBe('evt_full_path')

      // First observation: not yet processed → process it.
      expect(await isEventProcessed(supabase as any, event.id)).toBe(false)
      await markEventProcessed(supabase as any, {
        eventId: event.id,
        eventType: event.type,
        eventCreated: new Date(event.created * 1000),
        customerId: 'cus_full',
        subscriptionId: 'sub_full',
      })

      // Stripe retry of the same event: must short-circuit.
      expect(await isEventProcessed(supabase as any, event.id)).toBe(true)

      // Exactly one row exists.
      const count = await client.query(
        `SELECT count(*)::int AS n FROM stripe_processed_events WHERE event_id = $1`,
        [event.id],
      )
      expect(count.rows[0].n).toBe(1)
    })
  })
})
