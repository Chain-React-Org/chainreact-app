/**
 * Contract: createGoogleSheetsRow
 * Source: lib/workflows/actions/google-sheets/createRow.ts
 * Style: real handler invocation with raw `fetch` mocked. Asserts the exact
 *        API request shape Sheets receives (header GET → values POST).
 *
 * Bug class: data corruption / wrong column. The handler maps user inputs
 * to column positions based on the live header row of the spreadsheet. A
 * regression that mis-orders the values array, swallows missing headers,
 * or POSTs to the wrong range writes user data to the wrong column or
 * silently drops it.
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

import { createGoogleSheetsRow } from "@/lib/workflows/actions/google-sheets/createRow"

afterEach(() => {
  resetHarness()
})

// Bug class: missing required selection — without spreadsheetId or sheetName
// the handler must NOT fire any HTTP request. A regression that proceeds
// with empty strings would 404 against `/spreadsheets//values//1:1`.
describe("createGoogleSheetsRow — required-config validation", () => {
  test("returns failure when spreadsheetId is missing (no fetch fired)", async () => {
    const result = await createGoogleSheetsRow(
      { sheetName: "Sheet1", values: ["a"] },
      "user-1",
      {},
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/spreadsheet id/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("returns failure when sheetName is missing (no fetch fired)", async () => {
    const result = await createGoogleSheetsRow(
      { spreadsheetId: "ss-1", values: ["a"] },
      "user-1",
      {},
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/sheet name/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// Bug class: column mis-mapping — the contract is that newRow_<HeaderName>
// fields land in the column whose header matches that name. A regression
// that uses object iteration order (instead of header order) would put the
// user's value in the wrong column.
describe("createGoogleSheetsRow — newRow_ field mapping", () => {
  test("orders values by the live header row, not by the order of newRow_ keys", async () => {
    // Live header row: [Email, Name, Age]. User passes Name, Email, Age in
    // a different order — the resulting values array MUST follow header order.
    fetchMock
      .mockResponseOnce(JSON.stringify({ values: [["Email", "Name", "Age"]] }))
      .mockResponseOnce(
        JSON.stringify({ updates: { updatedRange: "Sheet1!A2:C2", updatedRows: 1 } }),
      )

    const result = await createGoogleSheetsRow(
      {
        spreadsheetId: "ss-1",
        sheetName: "Sheet1",
        newRow_Name: "Alice",
        newRow_Email: "alice@x.com",
        newRow_Age: 30,
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(true)

    const calls = getFetchCalls()
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toContain("/values/Sheet1!1:1")
    expect(calls[1].method).toBe("POST")
    expect(calls[1].url).toContain(":append")
    expect(calls[1].url).toContain("valueInputOption=USER_ENTERED")
    // Critical: order matches headers, not the order keys were passed.
    expect(calls[1].body.values).toEqual([["alice@x.com", "Alice", 30]])
  })

  test("substitutes empty string for headers that have no matching newRow_ field", async () => {
    fetchMock
      .mockResponseOnce(JSON.stringify({ values: [["A", "B", "C"]] }))
      .mockResponseOnce(JSON.stringify({ updates: { updatedRows: 1 } }))

    await createGoogleSheetsRow(
      {
        spreadsheetId: "ss-1",
        sheetName: "Sheet1",
        newRow_A: "x",
        // B and C deliberately missing
      },
      "user-1",
      {},
    )

    const post = getFetchCalls()[1]
    expect(post.body.values).toEqual([["x", "", ""]])
  })
})

// Bug class: values-array path — user supplies a literal array. A regression
// that fails to pad to header length corrupts the row layout downstream.
describe("createGoogleSheetsRow — values-array path", () => {
  test("pads values shorter than header row with empty strings", async () => {
    fetchMock
      .mockResponseOnce(JSON.stringify({ values: [["A", "B", "C", "D"]] }))
      .mockResponseOnce(JSON.stringify({ updates: { updatedRows: 1 } }))

    await createGoogleSheetsRow(
      {
        spreadsheetId: "ss-1",
        sheetName: "Sheet1",
        values: ["one", "two"],
      },
      "user-1",
      {},
    )

    const post = getFetchCalls()[1]
    expect(post.body.values).toEqual([["one", "two", "", ""]])
  })

  test("parses a JSON-string values config and writes it", async () => {
    fetchMock
      .mockResponseOnce(JSON.stringify({ values: [["A", "B"]] }))
      .mockResponseOnce(JSON.stringify({ updates: { updatedRows: 1 } }))

    await createGoogleSheetsRow(
      {
        spreadsheetId: "ss-1",
        sheetName: "Sheet1",
        values: '["one","two"]',
      },
      "user-1",
      {},
    )

    const post = getFetchCalls()[1]
    expect(post.body.values).toEqual([["one", "two"]])
  })

  test("rejects a values config that parses to a non-array", async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ values: [["A"]] }))

    const result = await createGoogleSheetsRow(
      {
        spreadsheetId: "ss-1",
        sheetName: "Sheet1",
        values: '{"key":"value"}',
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(result.error || result.message).toMatch(/array/i)
  })
})

// Bug class: provider/auth error masked as success.
describe("createGoogleSheetsRow — failure paths", () => {
  test("returns failure when token retrieval fails (no fetch fired)", async () => {
    setMockToken(null)

    const result = await createGoogleSheetsRow(
      { spreadsheetId: "ss-1", sheetName: "Sheet1", values: ["x"] },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("returns failure when the header-row GET responds non-200", async () => {
    fetchMock.mockResponseOnce("", { status: 403 })

    const result = await createGoogleSheetsRow(
      { spreadsheetId: "ss-1", sheetName: "Sheet1", values: ["x"] },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(result.error || result.message).toMatch(/403|fetch headers/i)
  })

  test("returns failure when the append POST is rejected with 400 (e.g., quota)", async () => {
    fetchMock
      .mockResponseOnce(JSON.stringify({ values: [["A"]] }))
      .mockResponseOnce(
        JSON.stringify({ error: { message: "Invalid range" } }),
        { status: 400 },
      )

    const result = await createGoogleSheetsRow(
      { spreadsheetId: "ss-1", sheetName: "Sheet1", values: ["x"] },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(result.error || result.message).toMatch(/400|invalid range/i)
  })
})

// Bug class: variable resolution — a {{...}} template in the spreadsheetId
// field must be resolved against the input map before being interpolated
// into the URL, otherwise we'd POST to literal "/spreadsheets/{{trigger.id}}/...".
describe("createGoogleSheetsRow — input/variable resolution", () => {
  test("resolves spreadsheetId from a {{...}} template", async () => {
    fetchMock
      .mockResponseOnce(JSON.stringify({ values: [["A"]] }))
      .mockResponseOnce(JSON.stringify({ updates: { updatedRows: 1 } }))

    await createGoogleSheetsRow(
      {
        spreadsheetId: "{{trigger.spreadsheet_id}}",
        sheetName: "Sheet1",
        values: ["x"],
      },
      "user-1",
      { trigger: { spreadsheet_id: "ss-resolved" } },
    )

    const headerCall = assertFetchCalled({ method: "GET", url: "/ss-resolved/values/" })
    expect(headerCall.url).toContain("/spreadsheets/ss-resolved/")
  })
})

// Q3 — 401 handling.
// Sheets is OAuth-with-refresh; raw-fetch returns Response objects. The
// handler wraps the principal write call (append POST) in `refreshAndRetry`,
// so a transient 401 on the write triggers refresh+retry, and a permanent
// 401 surfaces as a structured ActionResult auth failure with a token_revoked
// signal. See learning/docs/handler-contracts.md.
describe("createGoogleSheetsRow — Q3 — 401 handling", () => {
  test("transient 401 on write → refresh succeeds → retry succeeds → success", async () => {
    setMockTokenRefreshOutcome("success")
    fetchMock
      // Header GET (read-only, not wrapped — succeeds with original token).
      .mockResponseOnce(JSON.stringify({ values: [["Email"]] }))
      // First write POST returns 401.
      .mockResponseOnce("", { status: 401 })
      // Retry POST after refresh succeeds.
      .mockResponseOnce(
        JSON.stringify({ updates: { updatedRange: "Sheet1!A2:A2", updatedRows: 1 } }),
      )

    const result = await createGoogleSheetsRow(
      {
        spreadsheetId: "ss-1",
        sheetName: "Sheet1",
        newRow_Email: "alice@x.com",
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(true)
    // 1 GET + 2 POSTs (initial + retry).
    expect(getFetchCalls().filter((c) => c.method === "POST")).toHaveLength(2)
    expect(getHealthEngineCalls()).toHaveLength(0)
  })

  test("permanent 401 on write → ActionResult auth failure + token_revoked signal", async () => {
    setMockTokenRefreshOutcome("success")
    fetchMock
      .mockResponseOnce(JSON.stringify({ values: [["Email"]] }))
      // Both write attempts return 401.
      .mockResponseOnce("", { status: 401 })
      .mockResponseOnce("", { status: 401 })

    const result = await createGoogleSheetsRow(
      {
        spreadsheetId: "ss-1",
        sheetName: "Sheet1",
        newRow_Email: "alice@x.com",
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/reconnect|token|refresh/i)
    expect(getFetchCalls().filter((c) => c.method === "POST")).toHaveLength(2)
    const signals = getHealthEngineCalls()
    expect(signals).toHaveLength(1)
    expect(signals[0].signal.classifiedError.requiresUserAction).toBe(true)
  })

  test("permanent 401 with refresh failing immediately → no retry, ActionResult auth failure", async () => {
    setMockTokenRefreshOutcome("permanent_401")
    fetchMock
      .mockResponseOnce(JSON.stringify({ values: [["Email"]] }))
      .mockResponseOnce("", { status: 401 })

    const result = await createGoogleSheetsRow(
      {
        spreadsheetId: "ss-1",
        sheetName: "Sheet1",
        newRow_Email: "alice@x.com",
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    // Only one POST attempt because refresh failed (no retry).
    expect(getFetchCalls().filter((c) => c.method === "POST")).toHaveLength(1)
    expect(getHealthEngineCalls()).toHaveLength(1)
  })
})

// Q4 — within-session idempotency.
describe("createGoogleSheetsRow — Q4 — idempotency within session", () => {
  const meta = {
    executionSessionId: "session-1",
    nodeId: "node-A",
    actionType: "google_sheets_action_create_row",
    provider: "google-sheets",
  }
  const config = {
    spreadsheetId: "ss-1",
    sheetName: "Sheet1",
    values: ["a", "b"],
  }

  function mockHeadersAndAppend() {
    fetchMock
      .mockResponseOnce(JSON.stringify({ values: [["A", "B"]] })) // header read
      .mockResponseOnce(
        JSON.stringify({
          updates: { updatedRows: 1, updatedRange: "Sheet1!A2:B2" },
        }),
      )
  }

  test("first invocation fires the append and records the marker", async () => {
    mockHeadersAndAppend()
    const result = await createGoogleSheetsRow(config, "user-1", {}, meta)
    expect(result.success).toBe(true)
    const records = getSessionRecordCalls()
    expect(records).toHaveLength(1)
    expect(records[0].options?.provider).toBe("google-sheets")
  })

  test("replay with matching payload returns cached, no append fired", async () => {
    mockHeadersAndAppend()
    const first = await createGoogleSheetsRow(config, "user-1", {}, meta)
    expect(first.success).toBe(true)

    fetchMock.resetMocks()
    // Header read may still happen (read-only, outside the gate); allow it.
    fetchMock.mockResponseOnce(JSON.stringify({ values: [["A", "B"]] }))
    const second = await createGoogleSheetsRow(config, "user-1", {}, meta)
    expect(second.success).toBe(true)
    // No append/update POST/PUT — cached path.
    const writeCalls = getFetchCalls().filter(
      (c) => c.method === "POST" || c.method === "PUT",
    )
    expect(writeCalls).toHaveLength(0)
  })

  test("DIFFERENT payload returns PAYLOAD_MISMATCH, no append", async () => {
    setSessionReplayOutcome(
      {
        executionSessionId: meta.executionSessionId,
        nodeId: meta.nodeId,
        actionType: meta.actionType,
      },
      "mismatch",
    )
    fetchMock.mockResponseOnce(JSON.stringify({ values: [["A", "B"]] }))
    const result = await createGoogleSheetsRow(config, "user-1", {}, meta)
    expect(result.success).toBe(false)
    expect(result.error).toBe("PAYLOAD_MISMATCH")
    const writeCalls = getFetchCalls().filter(
      (c) => c.method === "POST" || c.method === "PUT",
    )
    expect(writeCalls).toHaveLength(0)
  })

  test("different sessionId fires the append again (rerun)", async () => {
    mockHeadersAndAppend()
    await createGoogleSheetsRow(config, "user-1", {}, meta)
    fetchMock.resetMocks()

    mockHeadersAndAppend()
    await createGoogleSheetsRow(config, "user-1", {}, {
      ...meta,
      executionSessionId: "session-2",
    })
    const writeCalls = getFetchCalls().filter(
      (c) => c.method === "POST" || c.method === "PUT",
    )
    expect(writeCalls.length).toBeGreaterThanOrEqual(1)
  })
})

// Q8 — safety floors. See learning/docs/handler-contracts.md.
describe("createGoogleSheetsRow — Q8 — safety floors", () => {
  runSafetyFloorChecks({
    handlerKind: "positional",
    handler: createGoogleSheetsRow as any,
    baseConfig: {
      spreadsheetId: "ss-1",
      sheetName: "Sheet1",
      values: ["alice@example.com", "Alice"],
    },
    knownSecrets: ["mock-token-12345"],
    knownPii: ["alice@example.com"],
    primeOutboundMocks: () => {
      fetchMock
        .mockResponseOnce(JSON.stringify({ values: [["Email", "Name"]] }))
        .mockResponseOnce(JSON.stringify({ updates: { updatedRows: 1 } }))
    },
    resetOutboundMocks: () => {
      fetchMock.resetMocks()
    },
    assertNoOutboundCalls: () => {
      const writes = getFetchCalls().filter(
        (c) => c.method === "POST" || c.method === "PUT",
      )
      expect(writes).toHaveLength(0)
    },
    expectedProvider: "google-sheets",
  })
})
