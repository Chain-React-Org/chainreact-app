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
} from "../helpers/actionTestHarness"

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

// Bug class: auth/provider error masked. The contract here is unusual:
// the handler THROWS, where most others return { success: false }. Tests
// pin the throw behavior so a refactor doesn't accidentally silence errors.
describe("createGoogleCalendarEvent — failure paths", () => {
  test("throws when token retrieval fails (no SDK call fired)", async () => {
    setMockToken(null)

    await expect(
      createGoogleCalendarEvent(
        { title: "T", startDate: "2026-05-01", startTime: "09:00" },
        "user-1",
        {},
      ),
    ).rejects.toThrow()

    expect(mockCalendarApi.events.insert).not.toHaveBeenCalled()
  })

  test("throws a reconnect-prompt error when the API returns 401", async () => {
    mockCalendarApi.events.insert.mockRejectedValueOnce(
      Object.assign(new Error("Unauthorized"), { code: 401 }),
    )

    await expect(
      createGoogleCalendarEvent(
        { title: "T", startDate: "2026-05-01", startTime: "09:00" },
        "user-1",
        {},
      ),
    ).rejects.toThrow(/authentication failed.*reconnect/i)
  })

  test("surfaces the Google API error message verbatim on generic failure", async () => {
    mockCalendarApi.events.insert.mockRejectedValueOnce({
      response: { data: { error: { message: "Calendar usage limits exceeded" } } },
    })

    await expect(
      createGoogleCalendarEvent(
        { title: "T", startDate: "2026-05-01", startTime: "09:00" },
        "user-1",
        {},
      ),
    ).rejects.toThrow(/Calendar usage limits exceeded/i)
  })
})
