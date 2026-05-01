/**
 * Contract: executeNotionCreatePage (delegates to notionCreatePage)
 * Source: lib/workflows/actions/notion/pageActions.ts
 *         lib/workflows/actions/notion/handlers.ts
 * Style: real handler invocation. The harness mocks token retrieval; the
 *        Notion handler uses raw `fetch`, so jest-fetch-mock captures the
 *        outbound POST and lets us assert on URL, headers, and body shape.
 *
 * Bug class: wrong parent / wrong content / silent failure. The Notion
 * Create Page action needs to land in the correct database OR under the
 * correct parent page, with the title attached to the right property
 * ("Name" or "title"). A regression that swaps the parent shape, sends to
 * the wrong endpoint, or omits required headers (Notion-Version) produces
 * 400s in production with no preview/staging signal.
 */

import {
  resetHarness,
  setMockToken,
  fetchMock,
  assertFetchCalled,
  getFetchCalls,
  setMockTokenRefreshOutcome,
  getHealthEngineCalls,
  setSessionReplayOutcome,
  getSessionRecordCalls,
} from "../helpers/actionTestHarness"
import { runSafetyFloorChecks } from "../helpers/safetyFloors"

import { executeNotionCreatePage } from "@/lib/workflows/actions/notion/pageActions"

afterEach(() => {
  resetHarness()
})

// Bug class: missing/invalid required selection silently accepted — the
// node author must explicitly choose where the page goes; missing parentType
// or parentDatabase must surface a clear error, not POST garbage to Notion.
describe("executeNotionCreatePage — required-config validation", () => {
  test("returns failure when parentType is omitted entirely", async () => {
    const result = await executeNotionCreatePage(
      { title: "My Page" },
      "user-1",
      {},
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/where to create/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("returns failure when parentType=database but parentDatabase is missing", async () => {
    const result = await executeNotionCreatePage(
      { parentType: "database", title: "My Page" },
      "user-1",
      {},
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/database/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("returns failure when parentType=page but parentPage is missing", async () => {
    const result = await executeNotionCreatePage(
      { parentType: "page", title: "My Page" },
      "user-1",
      {},
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/parent page/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// Bug class: wrong parent shape — Notion's API distinguishes
// `parent: { database_id }` from `parent: { page_id }`. A regression that
// sends the wrong shape causes 400 validation failures.
describe("executeNotionCreatePage — happy path: database parent", () => {
  test("POSTs to /v1/pages with database parent and a Name title property", async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: "page-123",
        url: "https://www.notion.so/page-123",
        created_time: "2026-04-30T10:00:00.000Z",
        last_edited_time: "2026-04-30T10:00:00.000Z",
      }),
    )

    const result = await executeNotionCreatePage(
      {
        parentType: "database",
        parentDatabase: "db-xyz",
        title: "My New Page",
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(true)
    expect(result.output.page_id).toBe("page-123")
    expect(result.output.url).toBe("https://www.notion.so/page-123")

    const call = assertFetchCalled({
      method: "POST",
      url: "https://api.notion.com/v1/pages",
    })
    expect(call.headers["authorization"]).toBe("Bearer mock-token-12345")
    expect(call.headers["notion-version"]).toBeTruthy()
    expect(call.headers["content-type"]).toContain("application/json")
    expect(call.body.parent).toEqual({ database_id: "db-xyz" })
    expect(call.body.properties.Name.title[0].text.content).toBe("My New Page")
  })

  test("attaches an emoji icon when iconType=emoji and iconEmoji is set", async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ id: "p", url: "u" }))

    await executeNotionCreatePage(
      {
        parentType: "database",
        parentDatabase: "db-xyz",
        title: "Iconic",
        iconType: "emoji",
        iconEmoji: "🚀",
      },
      "user-1",
      {},
    )

    const call = assertFetchCalled({ method: "POST", url: "/v1/pages" })
    expect(call.body.icon).toEqual({ type: "emoji", emoji: "🚀" })
  })
})

// Bug class: same as above but for the page-parent variant.
describe("executeNotionCreatePage — happy path: page parent", () => {
  test("POSTs with page_id parent and a 'title' property (not 'Name')", async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ id: "p1", url: "u" }))

    const result = await executeNotionCreatePage(
      {
        parentType: "page",
        parentPage: "parent-abc",
        title: "Subpage",
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(true)
    const call = assertFetchCalled({ method: "POST", url: "/v1/pages" })
    expect(call.body.parent).toEqual({ page_id: "parent-abc" })
    // Page-parent uses the lowercased "title" property key (Notion contract).
    expect(call.body.properties.title.title[0].text.content).toBe("Subpage")
  })
})

// Bug class: missing/invalid auth — must NOT silently send the create
// request without a token, and must NOT mark the workflow successful.
describe("executeNotionCreatePage — auth failure", () => {
  test("returns failure when the access token cannot be retrieved", async () => {
    setMockToken(null)

    const result = await executeNotionCreatePage(
      {
        parentType: "database",
        parentDatabase: "db-xyz",
        title: "My Page",
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/token|auth/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// Bug class: provider API error masked as success.
describe("executeNotionCreatePage — provider API error", () => {
  test("returns failure when Notion responds with 400 (validation error)", async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ message: "body failed validation: properties.Name should be defined" }),
      { status: 400 },
    )

    const result = await executeNotionCreatePage(
      {
        parentType: "database",
        parentDatabase: "db-xyz",
        title: "Bad",
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/400|validation/i)
  })

  // 401 handling moved to the Q3 block below — pre-PR-C3 the handler
  // surfaced the raw Notion error message; post-PR-C3 the create-page POST
  // is wrapped in `refreshAndRetry`.
})

// Q3 — 401 handling.
// Notion is OAuth-with-refresh; raw fetch returns Response objects. The
// create-page POST is wrapped in `refreshAndRetry`. Transient 401 → refresh
// + retry; permanent 401 → ActionResult auth failure with token_revoked
// signal. See learning/docs/handler-contracts.md.
describe("executeNotionCreatePage — Q3 — 401 handling", () => {
  test("transient 401 → refresh succeeds → retry succeeds → success", async () => {
    setMockTokenRefreshOutcome("success")
    fetchMock
      .mockResponseOnce(
        JSON.stringify({ message: "Unauthorized" }),
        { status: 401 },
      )
      .mockResponseOnce(JSON.stringify({ id: "page-after-refresh", url: "u" }))

    const result = await executeNotionCreatePage(
      {
        parentType: "database",
        parentDatabase: "db-xyz",
        title: "T",
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(true)
    expect(result.output.page_id).toBe("page-after-refresh")
    expect(getHealthEngineCalls()).toHaveLength(0)
  })

  test("permanent 401 → ActionResult auth failure + token_revoked signal", async () => {
    setMockTokenRefreshOutcome("success")
    fetchMock
      .mockResponseOnce(
        JSON.stringify({ message: "Unauthorized" }),
        { status: 401 },
      )
      .mockResponseOnce(
        JSON.stringify({ message: "Unauthorized" }),
        { status: 401 },
      )

    const result = await executeNotionCreatePage(
      {
        parentType: "database",
        parentDatabase: "db-xyz",
        title: "T",
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/reconnect|token|refresh/i)
    const signals = getHealthEngineCalls()
    expect(signals).toHaveLength(1)
    expect(signals[0].signal.classifiedError.requiresUserAction).toBe(true)
  })

  test("permanent 401 with refresh failing immediately → no retry, ActionResult auth failure", async () => {
    setMockTokenRefreshOutcome("permanent_401")
    fetchMock.mockResponseOnce(
      JSON.stringify({ message: "Unauthorized" }),
      { status: 401 },
    )

    const result = await executeNotionCreatePage(
      {
        parentType: "database",
        parentDatabase: "db-xyz",
        title: "T",
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(getHealthEngineCalls()).toHaveLength(1)
  })
})

// Q4 — within-session idempotency.
describe("executeNotionCreatePage — Q4 — idempotency within session", () => {
  const meta = {
    executionSessionId: "session-1",
    nodeId: "node-A",
    actionType: "notion_action_create_page",
    provider: "notion",
  }
  const config = {
    parentType: "database",
    parentDatabase: "db-1",
    title: "T",
  }

  test("first invocation fires the POST and records the marker", async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ id: "p1", url: "u" }))
    const result = await executeNotionCreatePage(config, "user-1", {}, meta)
    expect(result.success).toBe(true)
    const records = getSessionRecordCalls()
    expect(records).toHaveLength(1)
    expect(records[0].options?.provider).toBe("notion")
    expect(records[0].options?.externalId).toBe("p1")
  })

  test("replay with matching payload returns cached, no Notion POST", async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ id: "p1", url: "u" }))
    const first = await executeNotionCreatePage(config, "user-1", {}, meta)
    expect(first.success).toBe(true)

    fetchMock.resetMocks()
    const second = await executeNotionCreatePage(config, "user-1", {}, meta)
    expect(second.success).toBe(true)
    expect(getFetchCalls()).toHaveLength(0)
    expect(second.output?.page_id).toBe(first.output?.page_id)
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
    const result = await executeNotionCreatePage(config, "user-1", {}, meta)
    expect(result.success).toBe(false)
    expect(result.error).toBe("PAYLOAD_MISMATCH")
    expect(getFetchCalls()).toHaveLength(0)
  })

  test("different sessionId fires the POST again (rerun)", async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ id: "p1", url: "u" }))
    await executeNotionCreatePage(config, "user-1", {}, meta)
    fetchMock.resetMocks()

    fetchMock.mockResponseOnce(JSON.stringify({ id: "p2", url: "u" }))
    await executeNotionCreatePage(config, "user-1", {}, {
      ...meta,
      executionSessionId: "session-2",
    })
    expect(getFetchCalls()).toHaveLength(1)
  })
})

// Q8 — safety floors. See learning/docs/handler-contracts.md.
describe("executeNotionCreatePage — Q8 — safety floors", () => {
  runSafetyFloorChecks({
    handlerKind: "positional",
    handler: executeNotionCreatePage as any,
    baseConfig: {
      parentType: "database",
      parentDatabase: "db-1",
      title: "Page about alice@example.com",
    },
    knownSecrets: ["mock-token-12345"],
    knownPii: ["alice@example.com"],
    primeOutboundMocks: () => {
      fetchMock.mockResponseOnce(JSON.stringify({ id: "p1", url: "u" }))
    },
    resetOutboundMocks: () => {
      fetchMock.resetMocks()
    },
    assertNoOutboundCalls: () => {
      expect(getFetchCalls()).toHaveLength(0)
    },
    expectedProvider: "notion",
  })
})
