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
    // The handler does NOT split a comma-separated string into multiple
    // recipients. The contract is: pass an array for multi-recipient.
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

  test("throws a reconnect-prompt error when Graph returns 401", async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ error: { message: "401 Unauthorized" } }),
      { status: 401 },
    )

    await expect(
      sendOutlookEmail(
        { to: "x@y.com", subject: "S", body: "B" },
        "user-1",
        {},
      ),
    ).rejects.toThrow(/authentication failed.*reconnect/i)
  })

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
