/**
 * Contract: createShopifyCustomer
 * Source: lib/workflows/actions/shopify/createCustomer.ts
 * Style: real handler invocation; raw fetch mocked to capture the GraphQL
 *        mutation payload Shopify receives.
 *
 * Bug class: customer-data corruption / silent userError. Shopify GraphQL
 * returns 200 even on validation failures (the failure lives inside
 * `data.customerCreate.userErrors`). A regression that ignores those would
 * mark the workflow successful with no customer actually created.
 */

import {
  resetHarness,
  setMockIntegration,
  fetchMock,
  assertFetchCalled,
  getFetchCalls,
  setMockTokenRefreshOutcome,
  getHealthEngineCalls,
  setSessionReplayOutcome,
  getSessionRecordCalls,
} from "../helpers/actionTestHarness"
import { runSafetyFloorChecks } from "../helpers/safetyFloors"

import { createShopifyCustomer } from "@/lib/workflows/actions/shopify/createCustomer"

afterEach(() => {
  resetHarness()
})

const SUCCESSFUL_GQL_RESPONSE = {
  data: {
    customerCreate: {
      customer: {
        id: "gid://shopify/Customer/12345",
        email: "alice@example.com",
        firstName: "Alice",
        lastName: "Smith",
        phone: null,
        tags: [],
        createdAt: "2026-04-30T10:00:00Z",
      },
      userErrors: [],
    },
  },
}

// Bug class: GraphQL mutation shape — the input variables must use
// camelCase Shopify GraphQL field names (firstName, not first_name).
describe("createShopifyCustomer — GraphQL mutation shape", () => {
  test("POSTs to /admin/api/.../graphql.json with the customerCreate mutation", async () => {
    fetchMock.mockResponseOnce(JSON.stringify(SUCCESSFUL_GQL_RESPONSE))

    const result = await createShopifyCustomer(
      {
        integration_id: "integration-1",
        email: "alice@example.com",
        first_name: "Alice",
        last_name: "Smith",
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(true)
    expect(result.output.customer_id).toBe("12345")
    expect(result.output.customer_gid).toBe("gid://shopify/Customer/12345")
    expect(result.output.email).toBe("alice@example.com")
    expect(result.output.admin_url).toContain("test-shop.myshopify.com")
    expect(result.output.admin_url).toContain("/admin/customers/12345")

    const call = assertFetchCalled({
      method: "POST",
      url: "/admin/api/",
    })
    expect(call.url).toContain("test-shop.myshopify.com")
    expect(call.url).toContain("/graphql.json")
    expect(call.headers["x-shopify-access-token"]).toBe("mock-token-12345")
    expect(call.body.query).toContain("mutation customerCreate")
    expect(call.body.variables.input).toEqual({
      email: "alice@example.com",
      firstName: "Alice",
      lastName: "Smith",
    })
  })

  test("splits comma-separated tags into an array", async () => {
    fetchMock.mockResponseOnce(JSON.stringify(SUCCESSFUL_GQL_RESPONSE))

    await createShopifyCustomer(
      {
        integration_id: "integration-1",
        email: "alice@x.com",
        tags: "vip, beta, newsletter",
      },
      "user-1",
      {},
    )

    const call = assertFetchCalled({ method: "POST", url: "/graphql.json" })
    expect(call.body.variables.input.tags).toEqual(["vip", "beta", "newsletter"])
  })

  test("adds emailMarketingConsent when send_welcome_email=true", async () => {
    fetchMock.mockResponseOnce(JSON.stringify(SUCCESSFUL_GQL_RESPONSE))

    await createShopifyCustomer(
      {
        integration_id: "integration-1",
        email: "alice@x.com",
        send_welcome_email: true,
      },
      "user-1",
      {},
    )

    const call = assertFetchCalled({ method: "POST", url: "/graphql.json" })
    expect(call.body.variables.input.emailMarketingConsent).toEqual({
      marketingState: "SUBSCRIBED",
    })
  })

  test("does NOT include optional fields when omitted (lean payload)", async () => {
    fetchMock.mockResponseOnce(JSON.stringify(SUCCESSFUL_GQL_RESPONSE))

    await createShopifyCustomer(
      { integration_id: "integration-1", email: "alice@x.com" },
      "user-1",
      {},
    )

    const call = assertFetchCalled({ method: "POST", url: "/graphql.json" })
    expect(call.body.variables.input).toEqual({ email: "alice@x.com" })
    expect(call.body.variables.input.firstName).toBeUndefined()
    expect(call.body.variables.input.tags).toBeUndefined()
  })
})

// Bug class: silent userError — Shopify returns 200 with userErrors. A
// regression that doesn't surface them ships an unsuccessful workflow as
// successful.
describe("createShopifyCustomer — userErrors handling", () => {
  test("returns failure when Shopify reports userErrors (200 OK with errors inside)", async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        data: {
          customerCreate: {
            customer: null,
            userErrors: [
              { field: ["email"], message: "Email has already been taken" },
            ],
          },
        },
      }),
    )

    const result = await createShopifyCustomer(
      { integration_id: "integration-1", email: "duplicate@x.com" },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/email/i)
    expect(result.message).toMatch(/already been taken/i)
  })

  test("returns failure on GraphQL `errors` (top-level)", async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        errors: [{ message: "Field 'customerCreate' doesn't exist" }],
      }),
    )

    const result = await createShopifyCustomer(
      { integration_id: "integration-1", email: "x@y.com" },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/customerCreate/)
  })
})

// Bug class: missing/invalid integration silently accepted. The
// validateShopifyIntegration step must reject before any HTTP fires.
describe("createShopifyCustomer — integration validation", () => {
  test("returns failure when integration is missing", async () => {
    setMockIntegration(null)

    const result = await createShopifyCustomer(
      { integration_id: "missing", email: "x@y.com" },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/integration not found/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("returns failure when integration is missing access_token", async () => {
    setMockIntegration({
      id: "integration-1",
      provider: "shopify",
      status: "connected",
      shop_domain: "test-shop.myshopify.com",
      metadata: { shop: "test-shop.myshopify.com" },
      access_token: null,
    })

    const result = await createShopifyCustomer(
      { integration_id: "integration-1", email: "x@y.com" },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/authentication required|reconnect/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("returns failure when integration provider is not shopify", async () => {
    setMockIntegration({
      id: "integration-1",
      provider: "stripe", // wrong provider
      status: "connected",
      access_token: "mock-token",
      shop_domain: "test-shop.myshopify.com",
      metadata: { shop: "test-shop.myshopify.com" },
    })

    const result = await createShopifyCustomer(
      { integration_id: "integration-1", email: "x@y.com" },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/invalid integration provider/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// Bug class: HTTP error masked.
describe("createShopifyCustomer — HTTP error paths", () => {
  // 401 handling moved to the Q3 block below — pre-PR-C3 the handler
  // surfaced the underlying makeShopifyGraphQLRequest 401 message; post-
  // PR-C3 the GraphQL call is wrapped in `refreshAndRetry`. Shopify is
  // non_refreshable in our authSchemes registry — a 401 short-circuits to
  // the standardized auth-failure shape with no refresh attempt.

  test("returns failure when Shopify responds with 429 rate limit", async () => {
    fetchMock.mockResponseOnce("Too Many Requests", { status: 429 })

    const result = await createShopifyCustomer(
      { integration_id: "integration-1", email: "x@y.com" },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/rate limit/i)
  })
})

// Q3 — 401 handling.
// Shopify is **non_refreshable** in our authSchemes registry. Offline access
// tokens have no refresh-token grant; a 401 means the merchant uninstalled
// or the token was revoked, so we surface a structured action_required
// failure with no refresh attempt. See learning/docs/handler-contracts.md.
describe("createShopifyCustomer — Q3 — 401 handling (non_refreshable)", () => {
  test("401 from Shopify → structured auth failure, NO refresh attempted", async () => {
    fetchMock.mockResponseOnce("Unauthorized", { status: 401 })

    const result = await createShopifyCustomer(
      { integration_id: "integration-1", email: "x@y.com" },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    // Non-refreshable path goes straight to action_required.
    const signals = getHealthEngineCalls()
    expect(signals).toHaveLength(1)
    expect(signals[0].signal.classifiedError.requiresUserAction).toBe(true)
    // Only ONE outbound POST — no retry, refresh was never invoked.
    const calls = fetchMock.mock.calls.filter((c) => (c[1] as any)?.method === "POST")
    expect(calls).toHaveLength(1)
  })

  test("setMockTokenRefreshOutcome is irrelevant on non_refreshable providers — refresh is never called", async () => {
    setMockTokenRefreshOutcome("success") // would normally refresh — but Shopify is non_refreshable
    fetchMock.mockResponseOnce("Unauthorized", { status: 401 })

    const result = await createShopifyCustomer(
      { integration_id: "integration-1", email: "x@y.com" },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(getHealthEngineCalls()).toHaveLength(1)
    // Confirm refresh was not attempted — only one POST happened.
    const calls = fetchMock.mock.calls.filter((c) => (c[1] as any)?.method === "POST")
    expect(calls).toHaveLength(1)
  })
})

// Q4 — within-session idempotency.
describe("createShopifyCustomer — Q4 — idempotency within session", () => {
  const meta = {
    executionSessionId: "session-1",
    nodeId: "node-A",
    actionType: "shopify_action_create_customer",
    provider: "shopify",
  }
  const config = {
    integration_id: "integration-1",
    email: "alice@example.com",
    first_name: "Alice",
  }

  test("first invocation fires the GraphQL POST and records the marker", async () => {
    fetchMock.mockResponseOnce(JSON.stringify(SUCCESSFUL_GQL_RESPONSE))
    const result = await createShopifyCustomer(config, "user-1", {}, meta)
    expect(result.success).toBe(true)
    const records = getSessionRecordCalls()
    expect(records).toHaveLength(1)
    expect(records[0].options?.provider).toBe("shopify")
    expect(records[0].options?.externalId).toBe("12345")
  })

  test("replay with matching payload returns cached, no GraphQL POST", async () => {
    fetchMock.mockResponseOnce(JSON.stringify(SUCCESSFUL_GQL_RESPONSE))
    const first = await createShopifyCustomer(config, "user-1", {}, meta)
    expect(first.success).toBe(true)

    fetchMock.resetMocks()
    const second = await createShopifyCustomer(config, "user-1", {}, meta)
    expect(second.success).toBe(true)
    expect(getFetchCalls()).toHaveLength(0)
    expect(second.output?.customer_id).toBe(first.output?.customer_id)
  })

  test("DIFFERENT payload returns PAYLOAD_MISMATCH, no POST", async () => {
    setSessionReplayOutcome(
      {
        executionSessionId: meta.executionSessionId,
        nodeId: meta.nodeId,
        actionType: meta.actionType,
      },
      "mismatch",
    )
    const result = await createShopifyCustomer(config, "user-1", {}, meta)
    expect(result.success).toBe(false)
    expect(result.error).toBe("PAYLOAD_MISMATCH")
    expect(getFetchCalls()).toHaveLength(0)
  })

  test("different sessionId fires the POST again (rerun)", async () => {
    fetchMock.mockResponseOnce(JSON.stringify(SUCCESSFUL_GQL_RESPONSE))
    await createShopifyCustomer(config, "user-1", {}, meta)
    fetchMock.resetMocks()

    fetchMock.mockResponseOnce(JSON.stringify(SUCCESSFUL_GQL_RESPONSE))
    await createShopifyCustomer(config, "user-1", {}, {
      ...meta,
      executionSessionId: "session-2",
    })
    expect(getFetchCalls()).toHaveLength(1)
  })
})

// Q8 — safety floors. See learning/docs/handler-contracts.md.
describe("createShopifyCustomer — Q8 — safety floors", () => {
  runSafetyFloorChecks({
    handlerKind: "positional",
    handler: createShopifyCustomer as any,
    baseConfig: {
      integration_id: "integration-1",
      email: "alice@example.com",
      first_name: "Alice",
    },
    knownSecrets: ["mock-token-12345"],
    knownPii: ["alice@example.com"],
    primeOutboundMocks: () => {
      fetchMock.mockResponseOnce(JSON.stringify(SUCCESSFUL_GQL_RESPONSE))
    },
    resetOutboundMocks: () => {
      fetchMock.resetMocks()
    },
    assertNoOutboundCalls: () => {
      expect(getFetchCalls()).toHaveLength(0)
    },
    expectedProvider: "shopify",
  })
})
