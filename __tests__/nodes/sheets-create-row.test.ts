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
} from "../helpers/actionTestHarness"

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
