/**
 * Contract: createAirtableRecord
 * Source: lib/workflows/actions/airtable/createRecord.ts
 * Style: real handler invocation; raw fetch mocked. Asserts the POST body
 *        shape Airtable receives and that base/table info reaches the URL.
 *
 * Bug class: data lands in the wrong base/table or with the wrong field
 * names. The handler accepts user fields keyed `airtable_field_<name>`,
 * strips the prefix, and re-adds spaces. A regression in that decoding
 * produces a 422 "Unknown field name" or — worse — silently writes to a
 * different field that happens to share a partial name.
 */

import {
  resetHarness,
  setMockToken,
  fetchMock,
  getFetchCalls,
  assertFetchCalled,
} from "../helpers/actionTestHarness"

import { createAirtableRecord } from "@/lib/workflows/actions/airtable/createRecord"

afterEach(() => {
  resetHarness()
})

const SCHEMA_RESPONSE = {
  tables: [
    {
      id: "tbl-1",
      name: "Tasks",
      fields: [
        { id: "fld-1", name: "Name", type: "singleLineText" },
        { id: "fld-2", name: "Tasks labels", type: "multipleSelects" },
        { id: "fld-3", name: "Due Date", type: "date" },
      ],
    },
  ],
}

// The handler makes a variable number of GETs to /meta/bases/.../tables
// (resolveTableId + outer schema + cached field-validator). Use a single
// default response for every GET, and `Once` for the POST that comes last.
function mockAirtableHappyPath(createResponse: any = {
  id: "rec-1",
  fields: { Name: "Alice" },
  createdTime: "2026-04-30T10:00:00.000Z",
}, schema: any = SCHEMA_RESPONSE) {
  fetchMock.mockResponse(async (req: any) => {
    if (req.method === "POST") {
      return { body: JSON.stringify(createResponse), status: 200 }
    }
    return { body: JSON.stringify(schema), status: 200 }
  })
}

// Bug class: required-config silently accepted — without baseId or
// tableName we'd POST to malformed URLs and get 404. The handler must
// stop before any HTTP fires.
describe("createAirtableRecord — required-config validation", () => {
  test("returns failure when baseId is missing (no fetch fired)", async () => {
    const result = await createAirtableRecord(
      { tableName: "Tasks", airtable_field_Name: "Alice" },
      "user-1",
      {},
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/base id/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("returns failure when tableName is missing", async () => {
    const result = await createAirtableRecord(
      { baseId: "app1", airtable_field_Name: "Alice" },
      "user-1",
      {},
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/table name/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// Bug class: field-name decoding bug — the airtable_field_ prefix encoding
// turns spaces into underscores. A regression in the inverse mapping would
// either trigger 422 errors at Airtable or write to the wrong field.
describe("createAirtableRecord — field-name decoding", () => {
  test("strips airtable_field_ prefix and converts underscores back to spaces", async () => {
    mockAirtableHappyPath()

    await createAirtableRecord(
      {
        baseId: "app1",
        tableName: "Tasks",
        airtable_field_Name: "Alice",
        airtable_field_Tasks_labels: ["urgent"],
      },
      "user-1",
      {},
    )

    const postCall = assertFetchCalled({
      method: "POST",
      url: "/v0/app1/Tasks",
    })
    // Critical contract: the underscore-encoded key `airtable_field_Tasks_labels`
    // must decode to the SPACED field name `Tasks labels`. We don't pin the
    // exact value-coercion of the multiselect (Airtable accepts either form).
    expect(Object.keys(postCall.body.fields)).toEqual(
      expect.arrayContaining(["Name", "Tasks labels"]),
    )
    expect(postCall.body.fields.Name).toBe("Alice")
  })

  test("filters out fields that are NOT in the live table schema", async () => {
    // Airtable's API rejects unknown fields; the handler proactively drops
    // them so a stale workflow config doesn't fail the whole record write.
    mockAirtableHappyPath()

    await createAirtableRecord(
      {
        baseId: "app1",
        tableName: "Tasks",
        airtable_field_Name: "Alice",
        airtable_field_NonexistentField: "garbage",
      },
      "user-1",
      {},
    )

    const postCall = assertFetchCalled({ method: "POST", url: "/v0/app1/" })
    expect(postCall.body.fields).toEqual({ Name: "Alice" })
    expect(postCall.body.fields).not.toHaveProperty("NonexistentField")
  })
})

// Bug class: tableName encoding — table names with spaces or special
// characters must be URL-encoded; a regression here POSTs to a 404 URL.
describe("createAirtableRecord — URL encoding", () => {
  test("URL-encodes the table name in the POST URL", async () => {
    mockAirtableHappyPath(
      { id: "rec", fields: {}, createdTime: "" },
      {
        tables: [
          {
            id: "tbl-2",
            name: "My Tasks",
            fields: [{ id: "f", name: "Name", type: "singleLineText" }],
          },
        ],
      },
    )

    await createAirtableRecord(
      {
        baseId: "app1",
        tableName: "My Tasks",
        airtable_field_Name: "Alice",
      },
      "user-1",
      {},
    )

    const calls = getFetchCalls()
    const postCall = calls.find((c) => c.method === "POST")!
    expect(postCall.url).toContain("/v0/app1/My%20Tasks")
  })
})

// Bug class: silent success on Airtable rejection — must surface 422
// "Unknown field name" with a helpful message so the user knows which
// field is wrong.
describe("createAirtableRecord — provider error handling", () => {
  test("returns failure with field-mismatch guidance when Airtable returns Unknown field name", async () => {
    // Schema includes "Status" so the proactive filter doesn't drop it; the
    // POST then comes back with Airtable's 422.
    const schemaWithStatus = {
      tables: [
        {
          id: "tbl-1",
          name: "Tasks",
          fields: [
            { id: "fld-1", name: "Name", type: "singleLineText" },
            { id: "fld-99", name: "Status", type: "singleSelect" },
          ],
        },
      ],
    }
    fetchMock.mockResponse(async (req: any) => {
      if (req.method === "POST") {
        return {
          body: JSON.stringify({
            error: { message: 'Unknown field name: "Status"' },
          }),
          status: 422,
        }
      }
      return { body: JSON.stringify(schemaWithStatus), status: 200 }
    })

    const result = await createAirtableRecord(
      {
        baseId: "app1",
        tableName: "Tasks",
        airtable_field_Status: "Active",
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Status/)
    expect(result.error).toMatch(/does not exist|field mismatch/i)
  })

  test("returns failure on a generic 401 from Airtable", async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ error: { message: "Invalid token" } }),
      { status: 401 },
    )

    const result = await createAirtableRecord(
      {
        baseId: "app1",
        tableName: "Tasks",
        airtable_field_Name: "Alice",
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
  })

  test("returns failure when token retrieval fails (no fetch fired)", async () => {
    setMockToken(null)

    const result = await createAirtableRecord(
      {
        baseId: "app1",
        tableName: "Tasks",
        airtable_field_Name: "Alice",
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// Bug class: variable mapping miscoded — a baseId or tableName arriving
// from a {{...}} template must resolve before being put into the URL.
describe("createAirtableRecord — input/variable resolution", () => {
  test("resolves baseId and tableName from the input map", async () => {
    mockAirtableHappyPath()

    await createAirtableRecord(
      {
        baseId: "{{trigger.base}}",
        tableName: "{{trigger.table}}",
        airtable_field_Name: "Alice",
      },
      "user-1",
      { trigger: { base: "app1", table: "Tasks" } },
    )

    // Confirm the resolved baseId reached BOTH the schema endpoint and the
    // create POST URL — we don't depend on the exact call index because
    // the handler's caching makes the schema-fetch count vary across runs.
    const calls = getFetchCalls()
    expect(calls.some((c) => c.url.includes("/meta/bases/app1/tables"))).toBe(true)
    const postCall = calls.find((c) => c.method === "POST")
    expect(postCall).toBeDefined()
    expect(postCall!.url).toContain("/v0/app1/Tasks")
  })
})
