/**
 * Contract: stripeCreatePaymentIntent
 * Source: lib/workflows/actions/stripe/createPaymentIntent.ts
 * Style: real handler invocation; raw `fetch` mocked. The handler takes
 *        `(config, ExecutionContext)` rather than the positional
 *        `(config, userId, input)` shape — its idempotency metadata is
 *        threaded onto `context` (see registry.ts createExecutionContextWrapper).
 *
 * Bug class: double-charge / billing fraud surface. Stripe charges,
 * payment intents, and subscriptions are the highest-stakes action type;
 * a regression that fires the POST twice within a session can charge the
 * customer twice. PR-C4 protects against this with both:
 *   - Internal session_side_effects marker (checkReplay short-circuits)
 *   - Provider-side `Idempotency-Key` header (defense in depth)
 *
 * See learning/docs/handler-contracts.md Q4 and
 * learning/docs/session-side-effects-design.md §3.4.
 */

import {
  resetHarness,
  fetchMock,
  getFetchCalls,
  setSessionReplayOutcome,
  getSessionRecordCalls,
} from "../helpers/actionTestHarness"
import { runSafetyFloorChecks } from "../helpers/safetyFloors"

import { stripeCreatePaymentIntent } from "@/lib/workflows/actions/stripe/createPaymentIntent"

afterEach(() => {
  resetHarness()
})

function makeContext(overrides: any = {}): any {
  return {
    userId: "user-1",
    workflowId: "wf-1",
    executionId: "session-1",
    executionSessionId: "session-1",
    nodeId: "node-A",
    actionType: "stripe_action_create_payment_intent",
    testMode: false,
    dataFlowManager: {
      // Treat values literally; the test passes already-resolved primitives.
      resolveVariable: (v: any) => v,
    },
    ...overrides,
  }
}

const SAMPLE_RESPONSE = {
  id: "pi_test_123",
  client_secret: "pi_test_123_secret",
  amount: 2099,
  currency: "usd",
  status: "requires_payment_method",
  customer: null,
  description: null,
  created: 1714478400,
  metadata: {},
  next_action: null,
}

// Q4 — within-session idempotency.
describe("stripeCreatePaymentIntent — Q4 — idempotency within session", () => {
  const config = { amount: "20.99", currency: "USD" }

  test("first invocation fires Stripe with the Idempotency-Key header and records the marker", async () => {
    fetchMock.mockResponseOnce(JSON.stringify(SAMPLE_RESPONSE))
    const ctx = makeContext()

    const result = await stripeCreatePaymentIntent(config, ctx)
    expect(result.success).toBe(true)
    expect(result.output?.paymentIntentId).toBe("pi_test_123")

    const calls = getFetchCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe("POST")
    expect(calls[0].url).toBe("https://api.stripe.com/v1/payment_intents")
    // Defense-in-depth: Stripe gets the same key our internal marker uses.
    expect(calls[0].headers["idempotency-key"]).toBe(
      "session-1:node-A:stripe_action_create_payment_intent",
    )

    const records = getSessionRecordCalls()
    expect(records).toHaveLength(1)
    expect(records[0].options?.provider).toBe("stripe")
    expect(records[0].options?.externalId).toBe("pi_test_123")
  })

  test("replay with matching payload returns cached, NO Stripe call", async () => {
    fetchMock.mockResponseOnce(JSON.stringify(SAMPLE_RESPONSE))
    const ctx = makeContext()

    const first = await stripeCreatePaymentIntent(config, ctx)
    expect(first.success).toBe(true)

    fetchMock.resetMocks()
    const second = await stripeCreatePaymentIntent(config, ctx)
    expect(second.success).toBe(true)
    expect(getFetchCalls()).toHaveLength(0)
    expect(second.output?.paymentIntentId).toBe(first.output?.paymentIntentId)
  })

  test("DIFFERENT payload returns PAYLOAD_MISMATCH, no Stripe call", async () => {
    setSessionReplayOutcome(
      {
        executionSessionId: "session-1",
        nodeId: "node-A",
        actionType: "stripe_action_create_payment_intent",
      },
      "mismatch",
    )
    const result = await stripeCreatePaymentIntent(config, makeContext())
    expect(result.success).toBe(false)
    expect(result.error).toBe("PAYLOAD_MISMATCH")
    expect(getFetchCalls()).toHaveLength(0)
  })

  test("different sessionId fires Stripe again with a new Idempotency-Key (rerun)", async () => {
    fetchMock.mockResponseOnce(JSON.stringify(SAMPLE_RESPONSE))
    await stripeCreatePaymentIntent(config, makeContext())
    fetchMock.resetMocks()

    fetchMock.mockResponseOnce(JSON.stringify({ ...SAMPLE_RESPONSE, id: "pi_test_456" }))
    await stripeCreatePaymentIntent(
      config,
      makeContext({ executionId: "session-2", executionSessionId: "session-2" }),
    )

    const calls = getFetchCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].headers["idempotency-key"]).toBe(
      "session-2:node-A:stripe_action_create_payment_intent",
    )
  })

  test("absent meta (no executionSessionId) makes idempotency a no-op — no header set, no recordFired", async () => {
    fetchMock.mockResponseOnce(JSON.stringify(SAMPLE_RESPONSE))

    await stripeCreatePaymentIntent(
      config,
      makeContext({ executionSessionId: undefined, executionId: undefined }),
    )

    const calls = getFetchCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].headers["idempotency-key"]).toBeUndefined()
    expect(getSessionRecordCalls()).toHaveLength(0)
  })
})

// Bug class: missing required config silently accepted.
describe("stripeCreatePaymentIntent — required-config validation", () => {
  test("returns failure when amount is missing", async () => {
    const result = await stripeCreatePaymentIntent(
      { currency: "USD" },
      makeContext(),
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/amount.*required|required.*amount/i)
    expect(getFetchCalls()).toHaveLength(0)
  })

  test("returns failure when currency is missing", async () => {
    const result = await stripeCreatePaymentIntent(
      { amount: "10.00" },
      makeContext(),
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/currency/i)
    expect(getFetchCalls()).toHaveLength(0)
  })
})

// Bug class: provider error surfaced as success.
describe("stripeCreatePaymentIntent — provider API error", () => {
  test("returns failure when Stripe responds with non-2xx", async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ error: { message: "Invalid amount" } }),
      { status: 400 },
    )
    const result = await stripeCreatePaymentIntent(
      { amount: "10.00", currency: "USD" },
      makeContext(),
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/stripe api error|400/i)
  })
})

// Q8 — safety floors. See learning/docs/handler-contracts.md.
describe("stripeCreatePaymentIntent — Q8 — safety floors", () => {
  runSafetyFloorChecks({
    handlerKind: "context",
    handler: stripeCreatePaymentIntent as any,
    baseConfig: { amount: "20.99", currency: "USD" },
    knownSecrets: ["mock-token-12345"],
    knownPii: ["alice@example.com"],
    isBillingImpacting: true,
    primeOutboundMocks: () => {
      fetchMock.mockResponseOnce(JSON.stringify(SAMPLE_RESPONSE))
    },
    resetOutboundMocks: () => {
      fetchMock.resetMocks()
    },
    assertNoOutboundCalls: () => {
      expect(getFetchCalls()).toHaveLength(0)
    },
    expectedProvider: "stripe",
  })
})
