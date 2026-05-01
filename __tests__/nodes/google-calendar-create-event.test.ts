/**
 * Contract: createGoogleCalendarEvent
 * Source: lib/workflows/actions/google-calendar/createEvent.ts
 * Style: real handler invocation; the harness mocks the googleapis SDK so
 *        we assert on the exact `calendar.events.insert` request shape.
 *
 * Bug class: wrong event time / wrong calendar / silent meeting drop. The
 * handler distinguishes all-day events (uses `start.date`) from timed events
 * (uses `start.dateTime` + `timeZone`). A regression that swaps these would
 * silently move events to the wrong day across timezones, drop attendee
 * lists, or fail to attach Google Meet links.
 *
 * NOTE: createGoogleCalendarEvent THROWS on error rather than returning
 * { success: false }. Tests assert on rejection messages, not result.success.
 */

import {
  resetHarness,
  setMockToken,
  mockCalendarApi,
  setMockTokenRefreshOutcome,
  getHealthEngineCalls,
  setSessionReplayOutcome,
  getSessionRecordCalls,
} from "../helpers/actionTestHarness"
import { runSafetyFloorChecks } from "../helpers/safetyFloors"

import { createGoogleCalendarEvent } from "@/lib/workflows/actions/google-calendar/createEvent"

afterEach(() => {
  resetHarness()
})

// Bug class: timed event encoded as all-day (or vice versa) — produces an
// event on the wrong day across timezones, with the wrong duration.
describe("createGoogleCalendarEvent — timed event", () => {
  test("inserts a timed event with start/end dateTime + timeZone", async () => {
    mockCalendarApi.events.insert.mockResolvedValue({
      data: {
        id: "evt-123",
        htmlLink: "https://calendar.google.com/evt-123",
        status: "confirmed",
        start: { dateTime: "2026-05-01T09:00:00", timeZone: "America/New_York" },
        end: { dateTime: "2026-05-01T10:00:00", timeZone: "America/New_York" },
        summary: "Standup",
      },
    })

    const result = await createGoogleCalendarEvent(
      {
        title: "Standup",
        startDate: "2026-05-01",
        startTime: "09:00",
        endDate: "2026-05-01",
        endTime: "10:00",
        startTimeZone: "America/New_York",
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(true)
    expect(result.output.eventId).toBe("evt-123")

    expect(mockCalendarApi.events.insert).toHaveBeenCalledTimes(1)
    const call = mockCalendarApi.events.insert.mock.calls[0][0]
    expect(call.calendarId).toBe("primary")
    expect(call.conferenceDataVersion).toBe(0)
    expect(call.requestBody.summary).toBe("Standup")
    expect(call.requestBody.start).toEqual({
      dateTime: "2026-05-01T09:00:00",
      timeZone: "America/New_York",
    })
    expect(call.requestBody.end).toEqual({
      dateTime: "2026-05-01T10:00:00",
      timeZone: "America/New_York",
    })
  })

  test("falls back to a default end time of 10:00 when endTime is omitted", async () => {
    mockCalendarApi.events.insert.mockResolvedValue({ data: { id: "x" } })

    await createGoogleCalendarEvent(
      {
        title: "T",
        startDate: "2026-05-01",
        startTime: "09:00",
        startTimeZone: "America/New_York",
      },
      "user-1",
      {},
    )

    const call = mockCalendarApi.events.insert.mock.calls[0][0]
    expect(call.requestBody.end.dateTime).toBe("2026-05-01T10:00:00")
  })
})

// Bug class: all-day events shifting across timezones if encoded with
// dateTime. The contract is that all-day events use `date` only.
describe("createGoogleCalendarEvent — all-day event", () => {
  test("uses {date} (not {dateTime, timeZone}) when allDay=true", async () => {
    mockCalendarApi.events.insert.mockResolvedValue({ data: { id: "ad-1" } })

    await createGoogleCalendarEvent(
      {
        title: "Holiday",
        allDay: true,
        startDate: "2026-12-25",
        endDate: "2026-12-25",
      },
      "user-1",
      {},
    )

    const call = mockCalendarApi.events.insert.mock.calls[0][0]
    expect(call.requestBody.start).toEqual({ date: "2026-12-25" })
    expect(call.requestBody.end).toEqual({ date: "2026-12-25" })
    expect(call.requestBody.start.timeZone).toBeUndefined()
    expect(call.requestBody.end.timeZone).toBeUndefined()
  })
})

// Bug class: invalid attendee email silently included → API rejection or
// (worse) an invitation sent to the wrong inbox.
describe("createGoogleCalendarEvent — attendees", () => {
  test("filters out malformed entries and keeps the rest", async () => {
    mockCalendarApi.events.insert.mockResolvedValue({ data: { id: "e" } })

    await createGoogleCalendarEvent(
      {
        title: "T",
        startDate: "2026-05-01",
        startTime: "09:00",
        attendees: "alice@x.com, not-an-email, bob@x.com",
      },
      "user-1",
      {},
    )

    const call = mockCalendarApi.events.insert.mock.calls[0][0]
    expect(call.requestBody.attendees).toEqual([
      { email: "alice@x.com" },
      { email: "bob@x.com" },
    ])
  })

  test("omits attendees entirely when none are valid", async () => {
    mockCalendarApi.events.insert.mockResolvedValue({ data: { id: "e" } })

    await createGoogleCalendarEvent(
      {
        title: "T",
        startDate: "2026-05-01",
        startTime: "09:00",
        attendees: "invalid",
      },
      "user-1",
      {},
    )

    const call = mockCalendarApi.events.insert.mock.calls[0][0]
    expect(call.requestBody.attendees).toBeUndefined()
  })
})

// Q7 — recipient parsing.
// `attendees` is a schema-declared multi-value field; the handler routes it
// through `parseRecipients` (consolidated with Gmail / Outlook in PR-C2).
// See learning/docs/handler-contracts.md.
describe("createGoogleCalendarEvent — Q7 — recipient parsing", () => {
  test("CSV string of attendees is split and trimmed", async () => {
    mockCalendarApi.events.insert.mockResolvedValue({ data: { id: "e" } })

    await createGoogleCalendarEvent(
      {
        title: "T",
        startDate: "2026-05-01",
        startTime: "09:00",
        attendees: " alice@x.com,bob@x.com  , carol@x.com",
      },
      "user-1",
      {},
    )

    const call = mockCalendarApi.events.insert.mock.calls[0][0]
    expect(call.requestBody.attendees).toEqual([
      { email: "alice@x.com" },
      { email: "bob@x.com" },
      { email: "carol@x.com" },
    ])
  })

  test("array form passes through unchanged", async () => {
    mockCalendarApi.events.insert.mockResolvedValue({ data: { id: "e" } })

    await createGoogleCalendarEvent(
      {
        title: "T",
        startDate: "2026-05-01",
        startTime: "09:00",
        attendees: ["alice@x.com", "bob@x.com"],
      },
      "user-1",
      {},
    )

    const call = mockCalendarApi.events.insert.mock.calls[0][0]
    expect(call.requestBody.attendees).toEqual([
      { email: "alice@x.com" },
      { email: "bob@x.com" },
    ])
  })

  test("array containing a CSV string flattens to a single attendee list", async () => {
    mockCalendarApi.events.insert.mockResolvedValue({ data: { id: "e" } })

    await createGoogleCalendarEvent(
      {
        title: "T",
        startDate: "2026-05-01",
        startTime: "09:00",
        attendees: ["alice@x.com, bob@x.com", "carol@x.com"],
      },
      "user-1",
      {},
    )

    const call = mockCalendarApi.events.insert.mock.calls[0][0]
    expect(call.requestBody.attendees).toEqual([
      { email: "alice@x.com" },
      { email: "bob@x.com" },
      { email: "carol@x.com" },
    ])
  })
})

// Bug class: Google Meet link silently dropped — the user toggled the
// "Add Meet link" option, but the event arrived without one. Customer-
// visible because they expected a join URL.
describe("createGoogleCalendarEvent — Google Meet", () => {
  test("requests a Meet link when googleMeet=true (conferenceDataVersion=1)", async () => {
    mockCalendarApi.events.insert.mockResolvedValue({
      data: {
        id: "evt-meet",
        conferenceData: {
          entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc" }],
        },
      },
    })

    const result = await createGoogleCalendarEvent(
      {
        title: "T",
        startDate: "2026-05-01",
        startTime: "09:00",
        googleMeet: true,
      },
      "user-1",
      {},
    )

    expect(result.output.meetLink).toBe("https://meet.google.com/abc")
    const call = mockCalendarApi.events.insert.mock.calls[0][0]
    expect(call.conferenceDataVersion).toBe(1)
    expect(call.requestBody.conferenceData.createRequest.conferenceSolutionKey.type).toBe(
      "hangoutsMeet",
    )
  })

  test("does NOT add conferenceData when googleMeet is false/absent", async () => {
    mockCalendarApi.events.insert.mockResolvedValue({ data: { id: "e" } })

    await createGoogleCalendarEvent(
      { title: "T", startDate: "2026-05-01", startTime: "09:00" },
      "user-1",
      {},
    )

    const call = mockCalendarApi.events.insert.mock.calls[0][0]
    expect(call.requestBody.conferenceData).toBeUndefined()
    expect(call.conferenceDataVersion).toBe(0)
  })
})

// Bug class: auth/provider error masked. PR-C5 (Q1) — handler returns a
// typed ActionResult with `category: 'provider' | 'auth' | ...` instead of
// throwing. The execution layer catches *unexpected* throws; expected
// failures must surface as ActionResult so downstream nodes / logs see a
// consistent shape.
describe("createGoogleCalendarEvent — failure paths", () => {
  test("returns auth failure when token retrieval fails (no SDK call fired)", async () => {
    setMockToken(null)

    const result = await createGoogleCalendarEvent(
      { title: "T", startDate: "2026-05-01", startTime: "09:00" },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(mockCalendarApi.events.insert).not.toHaveBeenCalled()
  })

  // 401 handling moved to the Q3 block below — pre-PR-C3 the handler's
  // outer catch threw a reconnect-prompt; post-PR-C3 the insert call is
  // wrapped in `refreshAndRetry`, so transient 401s are recovered and
  // permanent 401s return a structured ActionResult auth failure.

  test("surfaces the Google API error message verbatim on generic failure (provider category)", async () => {
    mockCalendarApi.events.insert.mockRejectedValueOnce({
      response: { data: { error: { message: "Calendar usage limits exceeded" } } },
    })

    const result = await createGoogleCalendarEvent(
      { title: "T", startDate: "2026-05-01", startTime: "09:00" },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(result.category).toBe("provider")
    expect(result.message).toMatch(/Calendar usage limits exceeded/i)
  })
})

// Q3 — 401 handling.
// Calendar is OAuth-with-refresh; the googleapis SDK throws 401 errors with
// `code: 401`. `createGoogleCalendarEvent` wraps `calendar.events.insert` in
// `refreshAndRetry`, so a transient 401 is recovered transparently and a
// permanent 401 returns an ActionResult auth failure with a `token_revoked`
// health signal. See learning/docs/handler-contracts.md.
describe("createGoogleCalendarEvent — Q3 — 401 handling", () => {
  test("transient SDK 401 → refresh succeeds → retry succeeds → caller sees success", async () => {
    setMockTokenRefreshOutcome("success")
    mockCalendarApi.events.insert
      .mockRejectedValueOnce(
        Object.assign(new Error("Unauthorized"), { code: 401 }),
      )
      .mockResolvedValueOnce({ data: { id: "evt-after-refresh" } })

    const result = await createGoogleCalendarEvent(
      { title: "T", startDate: "2026-05-01", startTime: "09:00" },
      "user-1",
      {},
    )

    expect(result.success).toBe(true)
    expect((result.output as any).eventId).toBe("evt-after-refresh")
    expect(mockCalendarApi.events.insert).toHaveBeenCalledTimes(2)
    expect(getHealthEngineCalls()).toHaveLength(0)
  })

  test("permanent SDK 401 → ActionResult auth failure + token_revoked signal", async () => {
    setMockTokenRefreshOutcome("success")
    mockCalendarApi.events.insert.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { code: 401 }),
    )

    const result = await createGoogleCalendarEvent(
      { title: "T", startDate: "2026-05-01", startTime: "09:00" },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/reconnect|token|refresh/i)
    expect(mockCalendarApi.events.insert).toHaveBeenCalledTimes(2)
    const signals = getHealthEngineCalls()
    expect(signals).toHaveLength(1)
    expect(signals[0].signal.classifiedError.requiresUserAction).toBe(true)
  })

  test("permanent 401 with refresh failing immediately → no retry, ActionResult auth failure", async () => {
    setMockTokenRefreshOutcome("permanent_401")
    mockCalendarApi.events.insert.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { code: 401 }),
    )

    const result = await createGoogleCalendarEvent(
      { title: "T", startDate: "2026-05-01", startTime: "09:00" },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(mockCalendarApi.events.insert).toHaveBeenCalledTimes(1)
    expect(getHealthEngineCalls()).toHaveLength(1)
  })
})

// Q4 — within-session idempotency.
// Calendar's hash excludes conferenceData.requestId (Date.now()) so a
// re-resolved template producing the same event content hashes equal.
// See learning/docs/handler-contracts.md Q4.
describe("createGoogleCalendarEvent — Q4 — idempotency within session", () => {
  const meta = {
    executionSessionId: "session-1",
    nodeId: "node-A",
    actionType: "google_calendar_action_create_event",
    provider: "google-calendar",
  }
  const config = {
    title: "Sync",
    startDate: "2026-05-10",
    startTime: "09:00",
    endDate: "2026-05-10",
    endTime: "10:00",
    attendees: ["a@x.com"],
  }

  test("first invocation fires the SDK and records the marker", async () => {
    mockCalendarApi.events.insert.mockResolvedValue({
      data: { id: "evt-1", htmlLink: "https://link" },
    })

    const result = await createGoogleCalendarEvent(config, "user-1", {}, meta)
    expect(result.success).toBe(true)
    expect(mockCalendarApi.events.insert).toHaveBeenCalledTimes(1)
    const records = getSessionRecordCalls()
    expect(records).toHaveLength(1)
    expect(records[0].options?.provider).toBe("google-calendar")
    expect(records[0].options?.externalId).toBe("evt-1")
  })

  test("replay with matching payload returns cached, no SDK call", async () => {
    mockCalendarApi.events.insert.mockResolvedValue({ data: { id: "evt-1" } })
    const first = await createGoogleCalendarEvent(config, "user-1", {}, meta)

    mockCalendarApi.events.insert.mockClear()
    const second = await createGoogleCalendarEvent(config, "user-1", {}, meta)
    expect(second.success).toBe(true)
    expect(mockCalendarApi.events.insert).not.toHaveBeenCalled()
    expect(second.output?.eventId).toBe(first.output?.eventId)
  })

  test("DIFFERENT payload returns PAYLOAD_MISMATCH, no SDK call", async () => {
    setSessionReplayOutcome(
      {
        executionSessionId: meta.executionSessionId,
        nodeId: meta.nodeId,
        actionType: meta.actionType,
      },
      "mismatch",
    )

    const result = await createGoogleCalendarEvent(config, "user-1", {}, meta)
    expect(result.success).toBe(false)
    expect(result.error).toBe("PAYLOAD_MISMATCH")
    expect(mockCalendarApi.events.insert).not.toHaveBeenCalled()
  })

  test("different sessionId fires the SDK again (rerun)", async () => {
    mockCalendarApi.events.insert.mockResolvedValue({ data: { id: "evt-1" } })
    await createGoogleCalendarEvent(config, "user-1", {}, meta)
    mockCalendarApi.events.insert.mockClear()

    mockCalendarApi.events.insert.mockResolvedValue({ data: { id: "evt-2" } })
    await createGoogleCalendarEvent(config, "user-1", {}, {
      ...meta,
      executionSessionId: "session-2",
    })
    expect(mockCalendarApi.events.insert).toHaveBeenCalledTimes(1)
  })
})

// Q8 — safety floors. See learning/docs/handler-contracts.md.
describe("createGoogleCalendarEvent — Q8 — safety floors", () => {
  runSafetyFloorChecks({
    handlerKind: "positional",
    handler: createGoogleCalendarEvent as any,
    baseConfig: {
      title: "Sync",
      startDate: "2026-05-10",
      startTime: "09:00",
      attendees: ["alice@example.com"],
    },
    knownSecrets: ["mock-token-12345"],
    knownPii: ["alice@example.com"],
    primeOutboundMocks: () => {
      mockCalendarApi.events.insert.mockResolvedValue({
        data: { id: "evt-q8" },
      })
    },
    resetOutboundMocks: () => {
      mockCalendarApi.events.insert.mockClear()
    },
    assertNoOutboundCalls: () => {
      expect(mockCalendarApi.events.insert).not.toHaveBeenCalled()
    },
    expectedProvider: "google-calendar",
  })
})
