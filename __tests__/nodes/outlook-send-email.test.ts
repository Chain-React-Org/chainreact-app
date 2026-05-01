/**
 * Contract: sendOutlookEmail
 * Source: lib/workflows/actions/microsoft-outlook/sendEmail.ts
 * Style: real handler invocation; raw fetch mocked to capture the
 *        Microsoft Graph API request shape.
 *
 * Bug class: wrong recipient shape (Graph rejects), wrong importance flag,
 * silent send failure. Outlook's Graph API expects recipients in a
 * specific nested shape (`{emailAddress: {address: ...}}`); a regression
 * that drops the wrapper produces a 400 in production with no preview signal.
 *
 * NOTE: sendOutlookEmail throws on send failure rather than returning
 * { success: false }. Tests pin both happy-path return shape and the
 * throw-on-failure contract.
 */

import {
  resetHarness,
  setMockToken,
  fetchMock,
  getFetchCalls,
  assertFetchCalled,
  setMockTokenRefreshOutcome,
  getHealthEngineCalls,
  setSessionReplayOutcome,
  getSessionRecordCalls,
} from "../helpers/actionTestHarness"

import { sendOutlookEmail } from "@/lib/workflows/actions/microsoft-outlook/sendEmail"

afterEach(() => {
  resetHarness()
})

// Bug class: wrong recipient shape. Graph wants
// `{toRecipients: [{emailAddress: {address: "x"}}]}`, NOT a flat string array.
describe("sendOutlookEmail — happy path: recipient shape", () => {
  test("POSTs to Graph /me/sendMail with toRecipients in the {emailAddress: {address}} shape", async () => {
    fetchMock
      // Send mail
      .mockResponseOnce("", { status: 202 })
      // Sent-items lookup for messageId
      .mockResponseOnce(
        JSON.stringify({ value: [{ id: "msg-1", subject: "Welcome" }] }),
      )

    const result = await sendOutlookEmail(
      {
        to: "alice@example.com",
        subject: "Welcome",
        body: "Hi Alice",
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(true)
    expect(result.output.sent).toBe(true)
    expect(result.output.messageId).toBe("msg-1")
    expect(result.output.recipients.to).toEqual(["alice@example.com"])

    const sendCall = assertFetchCalled({
      method: "POST",
      url: "https://graph.microsoft.com/v1.0/me/sendMail",
    })
    expect(sendCall.headers["authorization"]).toBe("Bearer mock-token-12345")
    expect(sendCall.headers["content-type"]).toContain("application/json")
    expect(sendCall.body.message.subject).toBe("Welcome")
    expect(sendCall.body.message.toRecipients).toEqual([
      { emailAddress: { address: "alice@example.com" } },
    ])
    expect(sendCall.body.message.body.content).toBe("Hi Alice")
    expect(sendCall.body.message.body.contentType).toBe("Text")
  })

  test("supports an array of recipients (one entry per address)", async () => {
    // Q7 — the handler splits CSV per the multi-recipient contract; an
    // explicit array also produces one entry per address. Both shapes are
    // accepted because the schema declares `to`/`cc`/`bcc` as multi-value
    // and routes through `parseRecipients`.
    fetchMock.mockResponse("", { status: 202 })

    await sendOutlookEmail(
      {
        to: ["a@x.com", "b@x.com", "c@x.com"],
        subject: "S",
        body: "B",
      },
      "user-1",
      {},
    )

    const sendCall = getFetchCalls()[0]
    expect(sendCall.body.message.toRecipients).toEqual([
      { emailAddress: { address: "a@x.com" } },
      { emailAddress: { address: "b@x.com" } },
      { emailAddress: { address: "c@x.com" } },
    ])
  })

  test("Q7 — splits a CSV recipient string into multiple toRecipients (deliberate UX change vs. pre-PR-C2)", async () => {
    // Pre-PR-C2 the handler treated a CSV string as a single address (which
    // Microsoft Graph would have rejected). Post-PR-C2 the handler routes
    // recipient fields through `parseRecipients`, splitting CSVs into one
    // entry per address. See learning/docs/handler-contracts.md Q7.
    fetchMock.mockResponse("", { status: 202 })

    await sendOutlookEmail(
      {
        to: "a@x.com, b@x.com,c@x.com",
        subject: "S",
        body: "B",
      },
      "user-1",
      {},
    )

    const sendCall = getFetchCalls()[0]
    expect(sendCall.body.message.toRecipients).toEqual([
      { emailAddress: { address: "a@x.com" } },
      { emailAddress: { address: "b@x.com" } },
      { emailAddress: { address: "c@x.com" } },
    ])
  })

  test("returns failure when no recipients are provided in to/cc/bcc", async () => {
    // The handler throws on no recipients. Pin the throw contract.
    await expect(
      sendOutlookEmail({ subject: "S", body: "B" }, "user-1", {}),
    ).rejects.toThrow(/at least one recipient/i)
  })

  test("populates ccRecipients and bccRecipients when provided", async () => {
    fetchMock.mockResponse("", { status: 202 })

    await sendOutlookEmail(
      {
        to: "to@x.com",
        cc: "cc@x.com",
        bcc: "bcc@x.com",
        subject: "S",
        body: "B",
      },
      "user-1",
      {},
    )

    const sendCall = getFetchCalls()[0]
    expect(sendCall.body.message.ccRecipients).toEqual([
      { emailAddress: { address: "cc@x.com" } },
    ])
    expect(sendCall.body.message.bccRecipients).toEqual([
      { emailAddress: { address: "bcc@x.com" } },
    ])
  })
})

// Q7 — recipient parsing.
// Pre-PR-C2 the handler treated CSV as a single address. Post-PR-C2 the
// `to`/`cc`/`bcc` fields route through `parseRecipients` and split CSVs.
// See learning/docs/handler-contracts.md.
describe("sendOutlookEmail — Q7 — recipient parsing", () => {
  test("CSV string in `cc` is split into multiple ccRecipients", async () => {
    fetchMock.mockResponse("", { status: 202 })

    await sendOutlookEmail(
      {
        to: "to@x.com",
        cc: "x@x.com, y@x.com,z@x.com",
        subject: "S",
        body: "B",
      },
      "user-1",
      {},
    )

    const sendCall = getFetchCalls()[0]
    expect(sendCall.body.message.ccRecipients).toEqual([
      { emailAddress: { address: "x@x.com" } },
      { emailAddress: { address: "y@x.com" } },
      { emailAddress: { address: "z@x.com" } },
    ])
  })

  test("CSV string in `bcc` is split into multiple bccRecipients", async () => {
    fetchMock.mockResponse("", { status: 202 })

    await sendOutlookEmail(
      {
        to: "to@x.com",
        bcc: "p@x.com,q@x.com",
        subject: "S",
        body: "B",
      },
      "user-1",
      {},
    )

    const sendCall = getFetchCalls()[0]
    expect(sendCall.body.message.bccRecipients).toEqual([
      { emailAddress: { address: "p@x.com" } },
      { emailAddress: { address: "q@x.com" } },
    ])
  })

  test("array form passes through; addresses are individually trimmed", async () => {
    fetchMock.mockResponse("", { status: 202 })

    await sendOutlookEmail(
      {
        to: ["  alice@x.com  ", "bob@x.com"],
        subject: "S",
        body: "B",
      },
      "user-1",
      {},
    )

    const sendCall = getFetchCalls()[0]
    expect(sendCall.body.message.toRecipients).toEqual([
      { emailAddress: { address: "alice@x.com" } },
      { emailAddress: { address: "bob@x.com" } },
    ])
  })

  test("empty CSV (just commas / whitespace) produces no recipients on that field", async () => {
    fetchMock.mockResponse("", { status: 202 })

    await sendOutlookEmail(
      {
        to: "to@x.com",
        cc: " , , ",
        subject: "S",
        body: "B",
      },
      "user-1",
      {},
    )

    const sendCall = getFetchCalls()[0]
    expect(sendCall.body.message.ccRecipients).toEqual([])
  })
})

// Bug class: wrong content-type flag — sending HTML as Text leaks the raw
// markup into the recipient inbox.
describe("sendOutlookEmail — body content type", () => {
  test("encodes contentType=HTML when isHtml=true", async () => {
    fetchMock.mockResponse("", { status: 202 })

    await sendOutlookEmail(
      {
        to: "x@y.com",
        subject: "S",
        body: "<p>Hi</p>",
        isHtml: true,
      },
      "user-1",
      {},
    )

    const sendCall = getFetchCalls()[0]
    expect(sendCall.body.message.body.contentType).toBe("HTML")
  })

  test("defaults to contentType=Text when isHtml is omitted", async () => {
    fetchMock.mockResponse("", { status: 202 })

    await sendOutlookEmail(
      { to: "x@y.com", subject: "S", body: "hi" },
      "user-1",
      {},
    )

    const sendCall = getFetchCalls()[0]
    expect(sendCall.body.message.body.contentType).toBe("Text")
  })
})

// Bug class: importance flag swap — a high-importance email demoted to
// normal could miss SLA-driven email rules at the recipient.
describe("sendOutlookEmail — importance flag", () => {
  test("lowercases the importance value (Graph contract)", async () => {
    fetchMock.mockResponse("", { status: 202 })

    await sendOutlookEmail(
      { to: "x@y.com", subject: "S", body: "B", importance: "High" },
      "user-1",
      {},
    )

    const sendCall = getFetchCalls()[0]
    expect(sendCall.body.message.importance).toBe("high")
  })

  test("defaults to importance=normal when omitted", async () => {
    fetchMock.mockResponse("", { status: 202 })

    await sendOutlookEmail(
      { to: "x@y.com", subject: "S", body: "B" },
      "user-1",
      {},
    )

    const sendCall = getFetchCalls()[0]
    expect(sendCall.body.message.importance).toBe("normal")
  })
})

// Bug class: error masked. The handler throws on send failure so the
// surrounding execution engine sees a real error, not a silent success.
describe("sendOutlookEmail — failure paths", () => {
  test("throws when token retrieval fails (no Graph call fired)", async () => {
    setMockToken(null)

    await expect(
      sendOutlookEmail(
        { to: "x@y.com", subject: "S", body: "B" },
        "user-1",
        {},
      ),
    ).rejects.toThrow()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  // 401 handling moved to the Q3 block below — pre-PR-C3 the handler's
  // outer catch threw "authentication failed; reconnect"; post-PR-C3 the
  // sendMail POST is wrapped in `refreshAndRetry`, so transient 401s are
  // recovered and permanent 401s throw the structured auth-failure message.

  test("surfaces the Graph error message verbatim on a generic 400", async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        error: { message: "Recipient address is invalid" },
      }),
      { status: 400 },
    )

    await expect(
      sendOutlookEmail(
        { to: "bogus", subject: "S", body: "B" },
        "user-1",
        {},
      ),
    ).rejects.toThrow(/Recipient address is invalid/i)
  })
})

// Q3 — 401 handling.
// Outlook is OAuth-with-refresh; raw-fetch returns Response objects. The
// handler wraps the sendMail POST in `refreshAndRetry`. Transient 401s are
// recovered; permanent 401s throw the standardized auth-failure message.
// See learning/docs/handler-contracts.md.
describe("sendOutlookEmail — Q3 — 401 handling", () => {
  test("transient 401 → refresh succeeds → retry succeeds → success", async () => {
    setMockTokenRefreshOutcome("success")
    fetchMock
      .mockResponseOnce("", { status: 401 })
      .mockResponseOnce("", { status: 202 })

    const result = await sendOutlookEmail(
      { to: "x@y.com", subject: "S", body: "B" },
      "user-1",
      {},
    )

    expect(result.success).toBe(true)
    expect(getFetchCalls().filter((c) => c.method === "POST")).toHaveLength(2)
    expect(getHealthEngineCalls()).toHaveLength(0)
  })

  test("permanent 401 (refresh succeeds but retry still 401) → throws structured auth-failure message + token_revoked signal", async () => {
    setMockTokenRefreshOutcome("success")
    fetchMock
      .mockResponseOnce("", { status: 401 })
      .mockResponseOnce("", { status: 401 })

    await expect(
      sendOutlookEmail(
        { to: "x@y.com", subject: "S", body: "B" },
        "user-1",
        {},
      ),
    ).rejects.toThrow(/reconnect|token|refresh/i)

    expect(getFetchCalls().filter((c) => c.method === "POST")).toHaveLength(2)
    const signals = getHealthEngineCalls()
    expect(signals).toHaveLength(1)
    expect(signals[0].signal.classifiedError.requiresUserAction).toBe(true)
  })

  test("permanent 401 with refresh failing immediately → no retry, throws auth failure", async () => {
    setMockTokenRefreshOutcome("permanent_401")
    fetchMock.mockResponseOnce("", { status: 401 })

    await expect(
      sendOutlookEmail(
        { to: "x@y.com", subject: "S", body: "B" },
        "user-1",
        {},
      ),
    ).rejects.toThrow(/reconnect|token|refresh/i)

    expect(getFetchCalls().filter((c) => c.method === "POST")).toHaveLength(1)
    expect(getHealthEngineCalls()).toHaveLength(1)
  })
})

// Q4 — within-session idempotency.
// Same shape as Gmail's Q4 block — same key + same payload → cached;
// same key + different payload → PAYLOAD_MISMATCH; different sessionId →
// fires. See learning/docs/handler-contracts.md Q4.
describe("sendOutlookEmail — Q4 — idempotency within session", () => {
  const meta = {
    executionSessionId: "session-1",
    nodeId: "node-A",
    actionType: "outlook_action_send_email",
    provider: "microsoft-outlook",
  }
  const config = {
    to: "alice@x.com",
    subject: "S",
    body: "B",
  }

  function mockSendOk() {
    fetchMock
      .mockResponseOnce("", { status: 202 })
      .mockResponseOnce(JSON.stringify({ value: [{ id: "msg-1", subject: "S" }] }))
  }

  test("first invocation fires Graph and records the side-effect marker", async () => {
    mockSendOk()
    const result = await sendOutlookEmail(config, "user-1", {}, meta)
    expect(result.success).toBe(true)
    const records = getSessionRecordCalls()
    expect(records).toHaveLength(1)
    expect(records[0].key).toEqual({
      executionSessionId: "session-1",
      nodeId: "node-A",
      actionType: "outlook_action_send_email",
    })
    expect(records[0].options?.provider).toBe("microsoft-outlook")
  })

  test("replay with same key + matching payload returns cached result, no Graph call", async () => {
    mockSendOk()
    const first = await sendOutlookEmail(config, "user-1", {}, meta)
    expect(first.success).toBe(true)

    fetchMock.resetMocks() // Drop fetch history; if a second send fires, the next call will reject.
    const second = await sendOutlookEmail(config, "user-1", {}, meta)
    expect(second.success).toBe(true)
    // No Graph fetches at all — fully cached.
    expect(getFetchCalls()).toHaveLength(0)
    // Output preserved verbatim.
    expect(second.output?.messageId).toBe(first.output?.messageId)
  })

  test("same key + DIFFERENT payload returns PAYLOAD_MISMATCH, no Graph call", async () => {
    setSessionReplayOutcome(
      {
        executionSessionId: meta.executionSessionId,
        nodeId: meta.nodeId,
        actionType: meta.actionType,
      },
      "mismatch",
    )

    const result = await sendOutlookEmail(config, "user-1", {}, meta)
    expect(result.success).toBe(false)
    expect(result.error).toBe("PAYLOAD_MISMATCH")
    expect(getFetchCalls()).toHaveLength(0)
  })

  test("different sessionId fires Graph again (manual rerun is a new session)", async () => {
    mockSendOk()
    await sendOutlookEmail(config, "user-1", {}, meta)
    fetchMock.resetMocks()
    mockSendOk()
    await sendOutlookEmail(config, "user-1", {}, { ...meta, executionSessionId: "session-2" })
    expect(
      getFetchCalls().some((c) => c.url.includes("/me/sendMail")),
    ).toBe(true)
  })
})
