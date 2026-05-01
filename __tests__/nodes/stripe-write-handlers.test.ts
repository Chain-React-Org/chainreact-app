/**
 * Contract: PR-C4 follow-up — within-session idempotency for the
 * remaining Stripe write handlers (createSubscription /
 * createCheckoutSession / createRefund). The createPaymentIntent
 * handler has its own per-test file; this file covers the three
 * other billing-impacting handlers with the same Q4 contract.
 *
 * Source files:
 *   - lib/workflows/actions/stripe/createSubscription.ts
 *   - lib/workflows/actions/stripe/createCheckoutSession.ts
 *   - lib/workflows/actions/stripe/createRefund.ts
 *
 * Each handler:
 *   - first fire → POST + Idempotency-Key header + record marker
 *   - same key + same payload → cached, no Stripe call
 *   - same key + different payload → PAYLOAD_MISMATCH, no Stripe call
 *   - different sessionId → fires again with a fresh Idempotency-Key
 *
 * Bug class: double-charge / double-refund / duplicate subscription —
 * the highest-stakes provider in the catalog. PR-C4 protects against
 * this with internal session_side_effects markers + Stripe's own
 * Idempotency-Key cache (defense in depth).
 *
 * See learning/docs/handler-contracts.md Q4.
 */

import {
  resetHarness,
  fetchMock,
  getFetchCalls,
  setSessionReplayOutcome,
  getSessionRecordCalls,
} from "../helpers/actionTestHarness"
import { runSafetyFloorChecks } from "../helpers/safetyFloors"

import { stripeCreateSubscription } from "@/lib/workflows/actions/stripe/createSubscription"
import { stripeCreateCheckoutSession } from "@/lib/workflows/actions/stripe/createCheckoutSession"
import { stripeCreateRefund } from "@/lib/workflows/actions/stripe/createRefund"

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
    actionType: overrides.actionType,
    testMode: false,
    dataFlowManager: {
      resolveVariable: (v: any) => v,
    },
    ...overrides,
  }
}

// ─── createSubscription ────────────────────────────────────────────────

describe("stripeCreateSubscription — Q4 — idempotency within session", () => {
  const config = { customerId: "cus_1", priceId: "price_1" }
  const SAMPLE = {
    id: "sub_test_1",
    customer: "cus_1",
    status: "active",
    items: { data: [{ price: { id: "price_1" }, quantity: 1 }] },
    created: 1714478400,
    metadata: {},
  }

  test("first fire posts with Idempotency-Key and records the marker", async () => {
    fetchMock.mockResponseOnce(JSON.stringify(SAMPLE))
    const result = await stripeCreateSubscription(
      config,
      makeContext({ actionType: "stripe_action_create_subscription" }),
    )
    expect(result.success).toBe(true)
    expect(result.output?.subscriptionId).toBe("sub_test_1")
    const calls = getFetchCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("https://api.stripe.com/v1/subscriptions")
    expect(calls[0].headers["idempotency-key"]).toBe(
      "session-1:node-A:stripe_action_create_subscription",
    )
    const records = getSessionRecordCalls()
    expect(records).toHaveLength(1)
    expect(records[0].options?.externalId).toBe("sub_test_1")
  })

  test("replay with matching payload returns cached, no Stripe call", async () => {
    fetchMock.mockResponseOnce(JSON.stringify(SAMPLE))
    const ctx = makeContext({ actionType: "stripe_action_create_subscription" })
    const first = await stripeCreateSubscription(config, ctx)
    expect(first.success).toBe(true)

    fetchMock.resetMocks()
    const second = await stripeCreateSubscription(config, ctx)
    expect(second.success).toBe(true)
    expect(getFetchCalls()).toHaveLength(0)
    expect(second.output?.subscriptionId).toBe(first.output?.subscriptionId)
  })

  test("DIFFERENT payload returns PAYLOAD_MISMATCH, no Stripe call", async () => {
    setSessionReplayOutcome(
      {
        executionSessionId: "session-1",
        nodeId: "node-A",
        actionType: "stripe_action_create_subscription",
      },
      "mismatch",
    )
    const result = await stripeCreateSubscription(
      config,
      makeContext({ actionType: "stripe_action_create_subscription" }),
    )
    expect(result.success).toBe(false)
    expect(result.error).toBe("PAYLOAD_MISMATCH")
    expect(getFetchCalls()).toHaveLength(0)
  })
})

// ─── createCheckoutSession ─────────────────────────────────────────────

describe("stripeCreateCheckoutSession — Q4 — idempotency within session", () => {
  const config = {
    priceId: "price_1",
    quantity: "1",
    success_url: "https://x.com/ok",
    cancel_url: "https://x.com/no",
  }
  // Stripe price-fetch (line 59 of source) probes for recurring vs one-time
  // before posting. Mock both the price GET + the session POST.
  const PRICE_GET = { id: "price_1", type: "one_time" }
  const SESSION = {
    id: "cs_test_1",
    url: "https://checkout.stripe.com/c/pay/cs_test_1",
    customer: null,
    payment_intent: null,
    subscription: null,
    amount_total: 2099,
    currency: "usd",
    payment_status: "unpaid",
    status: "open",
    expires_at: 1714478400,
    metadata: {},
  }

  function mockHappyPath() {
    fetchMock
      .mockResponseOnce(JSON.stringify(PRICE_GET))
      .mockResponseOnce(JSON.stringify(SESSION))
  }

  test("first fire posts with Idempotency-Key and records the marker", async () => {
    mockHappyPath()
    const result = await stripeCreateCheckoutSession(
      config,
      makeContext({ actionType: "stripe_action_create_checkout_session" }),
    )
    expect(result.success).toBe(true)
    expect(result.output?.sessionId).toBe("cs_test_1")

    const postCall = getFetchCalls().find((c) =>
      c.url.includes("/checkout/sessions") && c.method === "POST",
    )
    expect(postCall).toBeDefined()
    expect(postCall!.headers["idempotency-key"]).toBe(
      "session-1:node-A:stripe_action_create_checkout_session",
    )
    const records = getSessionRecordCalls()
    expect(records).toHaveLength(1)
    expect(records[0].options?.externalId).toBe("cs_test_1")
  })

  test("replay returns cached, no Stripe POST (price GET may still fire — outside the gate)", async () => {
    mockHappyPath()
    const ctx = makeContext({ actionType: "stripe_action_create_checkout_session" })
    const first = await stripeCreateCheckoutSession(config, ctx)
    expect(first.success).toBe(true)

    fetchMock.resetMocks()
    fetchMock.mockResponse(JSON.stringify(PRICE_GET)) // any GETs allowed
    const second = await stripeCreateCheckoutSession(config, ctx)
    expect(second.success).toBe(true)
    const writes = getFetchCalls().filter((c) => c.method === "POST")
    expect(writes).toHaveLength(0)
    expect(second.output?.sessionId).toBe(first.output?.sessionId)
  })

  test("DIFFERENT payload returns PAYLOAD_MISMATCH, no POST", async () => {
    setSessionReplayOutcome(
      {
        executionSessionId: "session-1",
        nodeId: "node-A",
        actionType: "stripe_action_create_checkout_session",
      },
      "mismatch",
    )
    fetchMock.mockResponse(JSON.stringify(PRICE_GET))
    const result = await stripeCreateCheckoutSession(
      config,
      makeContext({ actionType: "stripe_action_create_checkout_session" }),
    )
    expect(result.success).toBe(false)
    expect(result.error).toBe("PAYLOAD_MISMATCH")
    const writes = getFetchCalls().filter((c) => c.method === "POST")
    expect(writes).toHaveLength(0)
  })
})

// ─── createRefund ──────────────────────────────────────────────────────

describe("stripeCreateRefund — Q4 — idempotency within session", () => {
  const config = { paymentIntentId: "pi_1", amount: "10.00" }
  const SAMPLE = {
    id: "re_test_1",
    amount: 1000,
    currency: "usd",
    status: "succeeded",
    charge: "ch_1",
    payment_intent: "pi_1",
    reason: null,
    receipt_number: null,
    created: 1714478400,
    metadata: {},
  }

  test("first fire posts with Idempotency-Key and records the marker", async () => {
    fetchMock.mockResponseOnce(JSON.stringify(SAMPLE))
    const result = await stripeCreateRefund(
      config,
      makeContext({ actionType: "stripe_action_create_refund" }),
    )
    expect(result.success).toBe(true)
    expect(result.output?.refundId).toBe("re_test_1")
    const calls = getFetchCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("https://api.stripe.com/v1/refunds")
    expect(calls[0].headers["idempotency-key"]).toBe(
      "session-1:node-A:stripe_action_create_refund",
    )
    const records = getSessionRecordCalls()
    expect(records).toHaveLength(1)
    expect(records[0].options?.externalId).toBe("re_test_1")
  })

  test("replay with matching payload returns cached, no Stripe call (no double-refund)", async () => {
    fetchMock.mockResponseOnce(JSON.stringify(SAMPLE))
    const ctx = makeContext({ actionType: "stripe_action_create_refund" })
    const first = await stripeCreateRefund(config, ctx)
    expect(first.success).toBe(true)

    fetchMock.resetMocks()
    const second = await stripeCreateRefund(config, ctx)
    expect(second.success).toBe(true)
    expect(getFetchCalls()).toHaveLength(0)
    expect(second.output?.refundId).toBe(first.output?.refundId)
  })

  test("DIFFERENT payload returns PAYLOAD_MISMATCH, no POST", async () => {
    setSessionReplayOutcome(
      {
        executionSessionId: "session-1",
        nodeId: "node-A",
        actionType: "stripe_action_create_refund",
      },
      "mismatch",
    )
    const result = await stripeCreateRefund(
      config,
      makeContext({ actionType: "stripe_action_create_refund" }),
    )
    expect(result.success).toBe(false)
    expect(result.error).toBe("PAYLOAD_MISMATCH")
    expect(getFetchCalls()).toHaveLength(0)
  })

  test("different sessionId fires again with a fresh Idempotency-Key", async () => {
    fetchMock.mockResponseOnce(JSON.stringify(SAMPLE))
    await stripeCreateRefund(
      config,
      makeContext({ actionType: "stripe_action_create_refund" }),
    )
    fetchMock.resetMocks()

    fetchMock.mockResponseOnce(JSON.stringify({ ...SAMPLE, id: "re_test_2" }))
    await stripeCreateRefund(
      config,
      makeContext({
        actionType: "stripe_action_create_refund",
        executionId: "session-2",
        executionSessionId: "session-2",
      }),
    )
    const calls = getFetchCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].headers["idempotency-key"]).toBe(
      "session-2:node-A:stripe_action_create_refund",
    )
  })
})

// ─── Q8 — safety floors ────────────────────────────────────────────────
//
// Each Stripe write handler gets the full Q8 panel. See
// learning/docs/handler-contracts.md.

describe("stripeCreateSubscription — Q8 — safety floors", () => {
  const SAMPLE = {
    id: "sub_q8",
    customer: "cus_1",
    status: "active",
    items: { data: [{ price: { id: "price_1" }, quantity: 1 }] },
    created: 1714478400,
    metadata: {},
  }
  runSafetyFloorChecks({
    handlerKind: "context",
    handler: stripeCreateSubscription as any,
    baseConfig: { customerId: "cus_1", priceId: "price_1" },
    knownSecrets: ["mock-token-12345"],
    knownPii: ["alice@example.com"],
    isBillingImpacting: true,
    primeOutboundMocks: () => {
      fetchMock.mockResponseOnce(JSON.stringify(SAMPLE))
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

describe("stripeCreateCheckoutSession — Q8 — safety floors", () => {
  runSafetyFloorChecks({
    handlerKind: "context",
    handler: stripeCreateCheckoutSession as any,
    baseConfig: {
      priceId: "price_1",
      quantity: "1",
      success_url: "https://x.com/ok",
      cancel_url: "https://x.com/no",
    },
    knownSecrets: ["mock-token-12345"],
    knownPii: ["alice@example.com"],
    isBillingImpacting: true,
    primeOutboundMocks: () => {
      // Pre-flight price GET (recurring detection) + the session POST.
      fetchMock
        .mockResponseOnce(JSON.stringify({ id: "price_1", type: "one_time" }))
        .mockResponseOnce(JSON.stringify({
          id: "cs_q8",
          url: "https://checkout.stripe.com/c/pay/cs_q8",
          customer: null,
          payment_intent: null,
          subscription: null,
          amount_total: 0,
          currency: "usd",
          payment_status: "unpaid",
          status: "open",
          expires_at: 1714478400,
          metadata: {},
        }))
    },
    resetOutboundMocks: () => {
      fetchMock.resetMocks()
    },
    assertNoOutboundCalls: () => {
      const writes = getFetchCalls().filter((c) => c.method === "POST")
      expect(writes).toHaveLength(0)
    },
    expectedProvider: "stripe",
  })
})

describe("stripeCreateRefund — Q8 — safety floors", () => {
  const SAMPLE = {
    id: "re_q8",
    amount: 1000,
    currency: "usd",
    status: "succeeded",
    charge: "ch_1",
    payment_intent: "pi_1",
    reason: null,
    receipt_number: null,
    created: 1714478400,
    metadata: {},
  }
  runSafetyFloorChecks({
    handlerKind: "context",
    handler: stripeCreateRefund as any,
    baseConfig: { paymentIntentId: "pi_1", amount: "10.00" },
    knownSecrets: ["mock-token-12345"],
    knownPii: ["alice@example.com"],
    isBillingImpacting: true,
    primeOutboundMocks: () => {
      fetchMock.mockResponseOnce(JSON.stringify(SAMPLE))
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
