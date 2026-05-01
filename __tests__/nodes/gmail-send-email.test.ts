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
} from "../helpers/actionTestHarness"

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

  test("returns failure when the Gmail API rejects with a 401 (token revoked)", async () => {
    mockGmailApi.users.messages.send.mockRejectedValueOnce(
      Object.assign(new Error("Request had invalid authentication credentials"), {
        code: 401,
      }),
    )

    const result = await sendGmailEmail({
      config: { to: "x@y.com", subject: "s", body: "b" },
      userId: "user-1",
      input: {},
    })

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/invalid authentication/i)
  })
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
