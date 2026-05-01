/**
 * Contract: sendGmailEmail
 * Source: lib/workflows/actions/gmail/sendEmail.ts
 * Style: real handler invocation; the harness mocks the googleapis SDK so
 *        the test asserts on the SDK call shape (the same shape Gmail's REST
 *        API would receive). No mocks of the function under test.
 *
 * Bug class: silent email failure / wrong recipients / wrong subject. The
 * handler MIME-encodes the message into a base64url payload — a regression
 * that mangles headers, CC/BCC routing, or attachment encoding ships the
 * email to the wrong person or with the wrong content.
 */

import {
  resetHarness,
  setMockToken,
  mockGmailApi,
  setMockTokenRefreshOutcome,
  getHealthEngineCalls,
  seedSessionFired,
  setSessionReplayOutcome,
  getSessionRecordCalls,
} from "../helpers/actionTestHarness"
import { runSafetyFloorChecks } from "../helpers/safetyFloors"

import { sendGmailEmail } from "@/lib/workflows/actions/gmail/sendEmail"

afterEach(() => {
  resetHarness()
})

function decodeRawMessage(raw: string): string {
  // Gmail uses base64url encoding (- and _ replace + and /, padding stripped).
  const base64 = raw.replace(/-/g, "+").replace(/_/g, "/")
  return Buffer.from(base64, "base64").toString("utf-8")
}

// Bug class: wrong recipient — a refactor that mishandles the To header
// or the array form of `to` would silently send the email to the wrong
// inbox, or to no one at all.
describe("sendGmailEmail — happy path", () => {
  test("encodes recipient, subject, and body into the Gmail send request", async () => {
    mockGmailApi.users.messages.send.mockResolvedValue({
      data: { id: "msg-123", threadId: "thr-1", labelIds: ["INBOX", "SENT"] },
    })

    const result = await sendGmailEmail({
      config: {
        to: "alice@example.com",
        subject: "Welcome",
        body: "Hi Alice",
      },
      userId: "user-1",
      input: {},
    })

    expect(result.success).toBe(true)
    expect(result.output.messageId).toBe("msg-123")
    expect(result.output.threadId).toBe("thr-1")

    expect(mockGmailApi.users.messages.send).toHaveBeenCalledTimes(1)
    const callArg = mockGmailApi.users.messages.send.mock.calls[0][0]
    expect(callArg.userId).toBe("me")
    const decoded = decodeRawMessage(callArg.requestBody.raw)
    expect(decoded).toContain("To: alice@example.com")
    expect(decoded).toContain("Subject: Welcome")
    expect(decoded).toContain("Hi Alice")
  })

  test("joins an array of recipients with comma+space in the To header", async () => {
    mockGmailApi.users.messages.send.mockResolvedValue({
      data: { id: "msg-2" },
    })

    await sendGmailEmail({
      config: {
        to: ["a@x.com", "b@x.com", "c@x.com"],
        subject: "S",
        body: "B",
      },
      userId: "user-1",
      input: {},
    })

    const callArg = mockGmailApi.users.messages.send.mock.calls[0][0]
    const decoded = decodeRawMessage(callArg.requestBody.raw)
    expect(decoded).toContain("To: a@x.com, b@x.com, c@x.com")
  })

  test("sets a Cc header when cc is supplied", async () => {
    mockGmailApi.users.messages.send.mockResolvedValue({ data: { id: "m" } })

    await sendGmailEmail({
      config: {
        to: "primary@x.com",
        cc: "cc1@x.com",
        subject: "s",
        body: "b",
      },
      userId: "user-1",
      input: {},
    })

    const decoded = decodeRawMessage(
      mockGmailApi.users.messages.send.mock.calls[0][0].requestBody.raw,
    )
    expect(decoded).toContain("Cc: cc1@x.com")
  })

  test("does NOT set a Cc header when cc is empty/whitespace (regression: empty Cc would be invalid SMTP)", async () => {
    mockGmailApi.users.messages.send.mockResolvedValue({ data: { id: "m" } })

    await sendGmailEmail({
      config: { to: "to@x.com", cc: "", subject: "s", body: "b" },
      userId: "user-1",
      input: {},
    })

    const decoded = decodeRawMessage(
      mockGmailApi.users.messages.send.mock.calls[0][0].requestBody.raw,
    )
    expect(decoded).not.toMatch(/^Cc: /m)
  })
})

// Bug class: missing/invalid auth — a regression that swallows the token
// failure and returns success would let workflows appear healthy while
// silently dropping outbound mail.
describe("sendGmailEmail — auth failure", () => {
  test("returns failure when the access token cannot be retrieved", async () => {
    setMockToken(null) // next call to getDecryptedAccessToken rejects

    const result = await sendGmailEmail({
      config: { to: "x@y.com", subject: "s", body: "b" },
      userId: "user-1",
      input: {},
    })

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/token|auth/i)
    // The SDK should NEVER be invoked when auth fails.
    expect(mockGmailApi.users.messages.send).not.toHaveBeenCalled()
  })
})

// Bug class: provider API error masked as success.
describe("sendGmailEmail — provider API error", () => {
  test("returns failure when the Gmail API rejects the request", async () => {
    mockGmailApi.users.messages.send.mockRejectedValueOnce(
      Object.assign(new Error("Invalid message format"), { code: 400 }),
    )

    const result = await sendGmailEmail({
      config: { to: "x@y.com", subject: "s", body: "b" },
      userId: "user-1",
      input: {},
    })

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/invalid message format/i)
  })

  // 401 handling moved to the Q3 block below — pre-PR-C3 the handler simply
  // surfaced the SDK error message; post-PR-C3 the handler wraps the send
  // call in `refreshAndRetry`, so a 401 SDK error triggers refresh+retry
  // with structured auth-failure on permanent failure.
})

// Bug class: variable mapping miscoded — config values that arrive as
// runtime template strings (`{{trigger.email}}`) must be resolved against
// the input map before encoding into MIME headers. Otherwise the literal
// "{{trigger.email}}" string ships as the recipient.
describe("sendGmailEmail — input/variable resolution", () => {
  test("resolves a {{...}} template in the To field against the input map", async () => {
    mockGmailApi.users.messages.send.mockResolvedValue({ data: { id: "m" } })

    await sendGmailEmail({
      config: {
        to: "{{trigger.email}}",
        subject: "Hi {{trigger.name}}",
        body: "Hello {{trigger.name}}",
      },
      userId: "user-1",
      input: { trigger: { email: "resolved@example.com", name: "Resolved Name" } },
    })

    const decoded = decodeRawMessage(
      mockGmailApi.users.messages.send.mock.calls[0][0].requestBody.raw,
    )
    expect(decoded).toContain("To: resolved@example.com")
    expect(decoded).toContain("Subject: Hi Resolved Name")
    expect(decoded).toContain("Hello Resolved Name")
  })
})

// Q7 — recipient parsing.
// `to` / `cc` / `bcc` are schema-declared multi-recipient fields, so the
// handler routes them through `parseRecipients`: CSV strings split, arrays
// pass through, mixed inputs flatten. See learning/docs/handler-contracts.md.
describe("sendGmailEmail — Q7 — recipient parsing", () => {
  test("CSV string in `to` is split and joined back with comma+space in the To header", async () => {
    mockGmailApi.users.messages.send.mockResolvedValue({ data: { id: "m" } })

    await sendGmailEmail({
      config: {
        to: "a@x.com, b@x.com,c@x.com",
        subject: "S",
        body: "B",
      },
      userId: "user-1",
      input: {},
    })

    const decoded = decodeRawMessage(
      mockGmailApi.users.messages.send.mock.calls[0][0].requestBody.raw,
    )
    expect(decoded).toContain("To: a@x.com, b@x.com, c@x.com")
  })

  test("CSV string in `cc` produces a Cc header with each address joined", async () => {
    mockGmailApi.users.messages.send.mockResolvedValue({ data: { id: "m" } })

    await sendGmailEmail({
      config: {
        to: "to@x.com",
        cc: "x@x.com,  y@x.com",
        subject: "S",
        body: "B",
      },
      userId: "user-1",
      input: {},
    })

    const decoded = decodeRawMessage(
      mockGmailApi.users.messages.send.mock.calls[0][0].requestBody.raw,
    )
    expect(decoded).toContain("Cc: x@x.com, y@x.com")
  })

  test("array form is preserved (one entry per address)", async () => {
    mockGmailApi.users.messages.send.mockResolvedValue({ data: { id: "m" } })

    await sendGmailEmail({
      config: {
        to: ["a@x.com", "b@x.com"],
        subject: "S",
        body: "B",
      },
      userId: "user-1",
      input: {},
    })

    const decoded = decodeRawMessage(
      mockGmailApi.users.messages.send.mock.calls[0][0].requestBody.raw,
    )
    expect(decoded).toContain("To: a@x.com, b@x.com")
  })

  test("mixed input — array containing CSV strings — flattens to a single recipient list", async () => {
    mockGmailApi.users.messages.send.mockResolvedValue({ data: { id: "m" } })

    await sendGmailEmail({
      config: {
        to: ["a@x.com, b@x.com", "c@x.com"],
        subject: "S",
        body: "B",
      },
      userId: "user-1",
      input: {},
    })

    const decoded = decodeRawMessage(
      mockGmailApi.users.messages.send.mock.calls[0][0].requestBody.raw,
    )
    expect(decoded).toContain("To: a@x.com, b@x.com, c@x.com")
  })

  test("empty/undefined recipient fields drop the corresponding header (no empty Cc:)", async () => {
    mockGmailApi.users.messages.send.mockResolvedValue({ data: { id: "m" } })

    await sendGmailEmail({
      config: {
        to: "a@x.com",
        cc: "",
        bcc: undefined,
        subject: "S",
        body: "B",
      },
      userId: "user-1",
      input: {},
    })

    const decoded = decodeRawMessage(
      mockGmailApi.users.messages.send.mock.calls[0][0].requestBody.raw,
    )
    expect(decoded).not.toContain("Cc:")
    expect(decoded).not.toContain("Bcc:")
  })
})


// Q3 — 401 handling.
// Gmail is OAuth-with-refresh; the SDK throws 401 errors with `code: 401`.
// `sendGmailEmail` wraps `gmail.users.messages.send` in `refreshAndRetry`,
// so a transient 401 is recovered transparently and a permanent 401 yields
// a structured auth failure with a `token_revoked` health signal.
// See learning/docs/handler-contracts.md.
describe("sendGmailEmail — Q3 — 401 handling", () => {
  test("transient SDK 401 → refresh succeeds → retry succeeds → caller sees success", async () => {
    setMockTokenRefreshOutcome("success")
    mockGmailApi.users.messages.send
      .mockRejectedValueOnce(
        Object.assign(new Error("Unauthorized"), { code: 401 }),
      )
      .mockResolvedValueOnce({ data: { id: "msg-after-refresh" } })

    const result = await sendGmailEmail({
      config: { to: "alice@x.com", subject: "S", body: "B" },
      userId: "user-1",
      input: {},
    })

    expect(result.success).toBe(true)
    expect(result.output.messageId).toBe("msg-after-refresh")
    // SDK called twice — once with the original token, once after refresh.
    expect(mockGmailApi.users.messages.send).toHaveBeenCalledTimes(2)
    // No health signal — the user shouldn't see a "reconnect" notification
    // for a transient 401 the system recovered from.
    expect(getHealthEngineCalls()).toHaveLength(0)
  })

  test("permanent SDK 401 (refresh succeeds but retry still 401) → structured auth failure + token_revoked signal", async () => {
    setMockTokenRefreshOutcome("success")
    mockGmailApi.users.messages.send.mockRejectedValue(
      Object.assign(new Error("Request had invalid authentication credentials"), {
        code: 401,
      }),
    )

    const result = await sendGmailEmail({
      config: { to: "alice@x.com", subject: "S", body: "B" },
      userId: "user-1",
      input: {},
    })

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/reconnect|token|refresh/i)
    expect(mockGmailApi.users.messages.send).toHaveBeenCalledTimes(2)

    const signals = getHealthEngineCalls()
    expect(signals).toHaveLength(1)
    expect(signals[0].signal.classifiedError.requiresUserAction).toBe(true)
    expect(signals[0].signal.isRecovery).toBe(false)
  })

  test("permanent 401 with refresh failing immediately → no retry, structured auth failure", async () => {
    setMockTokenRefreshOutcome("permanent_401")
    mockGmailApi.users.messages.send.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { code: 401 }),
    )

    const result = await sendGmailEmail({
      config: { to: "alice@x.com", subject: "S", body: "B" },
      userId: "user-1",
      input: {},
    })

    expect(result.success).toBe(false)
    // The SDK was only invoked once because refresh failed immediately.
    expect(mockGmailApi.users.messages.send).toHaveBeenCalledTimes(1)
    const signals = getHealthEngineCalls()
    expect(signals).toHaveLength(1)
    expect(signals[0].signal.classifiedError.requiresUserAction).toBe(true)
  })
})

// Q4 — within-session idempotency.
// `meta` carries the engine-thread (executionSessionId, nodeId, actionType).
// First fire records a marker; same key + same payload returns the cached
// result with no second SDK call; same key + DIFFERENT payload returns
// PAYLOAD_MISMATCH; different sessionId fires again.
// See learning/docs/handler-contracts.md Q4.
describe("sendGmailEmail — Q4 — idempotency within session", () => {
  const meta = {
    executionSessionId: "session-1",
    nodeId: "node-A",
    actionType: "gmail_action_send_email",
    provider: "gmail",
  }

  test("first invocation fires the SDK and records the side-effect marker", async () => {
    mockGmailApi.users.messages.send.mockResolvedValue({
      data: { id: "msg-fresh-1", threadId: "thr" },
    })

    const result = await sendGmailEmail({
      config: { to: "alice@x.com", subject: "S", body: "B" },
      userId: "user-1",
      input: {},
      meta,
    })

    expect(result.success).toBe(true)
    expect(mockGmailApi.users.messages.send).toHaveBeenCalledTimes(1)
    const records = getSessionRecordCalls()
    expect(records).toHaveLength(1)
    expect(records[0].key).toEqual({
      executionSessionId: "session-1",
      nodeId: "node-A",
      actionType: "gmail_action_send_email",
    })
    expect(records[0].options?.provider).toBe("gmail")
    expect(records[0].options?.externalId).toBe("msg-fresh-1")
  })

  test("replay with same key + matching payload returns cached result, no SDK call", async () => {
    // First fire populates the store via the real recordFired path (the
    // harness mirrors recordFired into the in-memory map). The second
    // invocation with identical config hashes equal and returns cached.
    mockGmailApi.users.messages.send.mockResolvedValue({
      data: { id: "msg-first", threadId: "thr-first" },
    })
    const config = { to: "alice@x.com", subject: "S", body: "B" }
    const first = await sendGmailEmail({ config, userId: "user-1", input: {}, meta })
    expect(first.success).toBe(true)

    mockGmailApi.users.messages.send.mockClear()
    const second = await sendGmailEmail({ config, userId: "user-1", input: {}, meta })
    expect(second.success).toBe(true)
    // No second SDK call — cached path.
    expect(mockGmailApi.users.messages.send).not.toHaveBeenCalled()
    // Output preserved verbatim from the first fire.
    expect(second.output?.messageId).toBe(first.output?.messageId)
  })

  test("same key + DIFFERENT payload returns PAYLOAD_MISMATCH, no SDK call", async () => {
    // Force the next checkReplay for this key to return mismatch.
    setSessionReplayOutcome(
      {
        executionSessionId: meta.executionSessionId,
        nodeId: meta.nodeId,
        actionType: meta.actionType,
      },
      "mismatch",
    )

    const result = await sendGmailEmail({
      config: { to: "alice@x.com", subject: "S", body: "B" },
      userId: "user-1",
      input: {},
      meta,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe("PAYLOAD_MISMATCH")
    expect(result.message).toMatch(/already executed.*different input/i)
    expect(mockGmailApi.users.messages.send).not.toHaveBeenCalled()
  })

  test("different sessionId fires the SDK again (manual rerun is a new session)", async () => {
    mockGmailApi.users.messages.send.mockResolvedValue({ data: { id: "msg-1" } })

    const config = { to: "alice@x.com", subject: "S", body: "B" }
    await sendGmailEmail({ config, userId: "user-1", input: {}, meta })
    mockGmailApi.users.messages.send.mockClear()

    // Different executionSessionId — this is a rerun; the action MUST fire.
    mockGmailApi.users.messages.send.mockResolvedValue({ data: { id: "msg-rerun" } })
    await sendGmailEmail({
      config,
      userId: "user-1",
      input: {},
      meta: { ...meta, executionSessionId: "session-2" },
    })
    expect(mockGmailApi.users.messages.send).toHaveBeenCalledTimes(1)
  })

  test("absent meta makes idempotency a no-op (test/non-engine paths) — no recordFired", async () => {
    mockGmailApi.users.messages.send.mockResolvedValue({ data: { id: "msg-no-meta" } })

    await sendGmailEmail({
      config: { to: "alice@x.com", subject: "S", body: "B" },
      userId: "user-1",
      input: {},
      // no meta
    })

    expect(getSessionRecordCalls()).toHaveLength(0)
  })
})

// Q8 — safety floors. See learning/docs/handler-contracts.md.
describe("sendGmailEmail — Q8 — safety floors", () => {
  runSafetyFloorChecks({
    handlerKind: "object",
    handler: sendGmailEmail as any,
    baseConfig: {
      to: "alice@example.com",
      subject: "Hello Alice",
      body: "Body",
    },
    baseInput: {},
    knownSecrets: ["mock-token-12345"],
    knownPii: ["alice@example.com"],
    primeOutboundMocks: () => {
      mockGmailApi.users.messages.send.mockResolvedValue({
        data: { id: "msg-q8", threadId: "thr" },
      })
    },
    resetOutboundMocks: () => {
      mockGmailApi.users.messages.send.mockClear()
    },
    assertNoOutboundCalls: () => {
      expect(mockGmailApi.users.messages.send).not.toHaveBeenCalled()
    },
    expectedProvider: "gmail",
  })
})
