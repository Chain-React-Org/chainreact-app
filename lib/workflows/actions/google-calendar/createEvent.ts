import { getDecryptedAccessToken } from '../core/getDecryptedAccessToken'
import { resolveValue } from '../core/resolveValue'
import { parseRecipients } from '../core/parseRecipients'
import { refreshAndRetry } from '../core/refreshAndRetry'
import { ActionResult } from '../core/executeWait'
import { buildIdempotencyKey, type HandlerExecutionMeta } from '../core/idempotencyKey'
import { hashPayload } from '../core/hashPayload'
import { checkReplay, recordFired } from '../core/sessionSideEffects'
import { google } from 'googleapis'

import { logger } from '@/lib/utils/logger'

/**
 * Google Calendar create event handler with timezone auto-detection
 */
export async function createGoogleCalendarEvent(
  config: any,
  userId: string,
  input: Record<string, any>,
  meta?: HandlerExecutionMeta,
): Promise<ActionResult> {
  // Q8d — testMode interception.
  if (meta?.testMode) {
    return {
      success: true,
      output: { simulated: true, provider: 'google-calendar' },
      message: 'Simulated in test mode — no provider call made',
    }
  }

  try {
    // Resolve config values if they contain template variables
    const needsResolution = typeof config === 'object' &&
      Object.values(config).some(v =>
        typeof v === 'string' && v.includes('{{') && v.includes('}}')
      )

    const resolvedConfig = needsResolution ? resolveValue(config, input) : config

    // Extract all config fields with new structure
    const {
      calendarId = 'primary',
      title,
      description,
      allDay = false,
      startDate,
      startTime,
      endDate,
      endTime,
      separateTimezones = false,
      startTimeZone,
      endTimeZone,
      location,
      attendees,
      notifications = [],
      googleMeet = null,
      sendNotifications = 'all',
      guestsCanInviteOthers = true,
      guestsCanSeeOtherGuests = true,
      guestsCanModify = false,
      visibility = 'default',
      transparency = 'opaque',
      colorId,
      recurrence
    } = resolvedConfig

    // Get the decrypted access token for Google
    const accessToken = await getDecryptedAccessToken(userId, "google-calendar")

    // Handle timezone - auto-detect if not specified
    const getUserTimezone = () => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone
      } catch {
        return 'America/New_York' // fallback
      }
    }

    // Use startTimeZone for both start and end unless separateTimezones is enabled
    let eventStartTimeZone = startTimeZone || getUserTimezone()
    let eventEndTimeZone = separateTimezones && endTimeZone ? endTimeZone : eventStartTimeZone

    // Auto-detect timezone if not set or set to 'auto'
    if (!eventStartTimeZone || eventStartTimeZone === 'auto') {
      eventStartTimeZone = getUserTimezone()
      logger.info(`🌍 [Google Calendar] Auto-detected start timezone: ${eventStartTimeZone}`)
    }

    if (separateTimezones && (!eventEndTimeZone || eventEndTimeZone === 'auto')) {
      eventEndTimeZone = getUserTimezone()
      logger.info(`🌍 [Google Calendar] Auto-detected end timezone: ${eventEndTimeZone}`)
    }

    // Build a Calendar SDK client for the given access token. The insert
    // call below is wrapped in `refreshAndRetry` (Q3) so a 401 from the SDK
    // triggers a single refresh-and-retry attempt.
    const buildCalendarClient = (token: string) => {
      const oauth2Client = new google.auth.OAuth2()
      oauth2Client.setCredentials({ access_token: token })
      return google.calendar({ version: 'v3', auth: oauth2Client })
    }
    const calendar = buildCalendarClient(accessToken)

    // Parse dates and times with proper validation
    const parseDateTime = (date: string, time: string) => {
      // Handle special date values or use defaults
      if (!date || date === 'today') {
        date = new Date().toISOString().split('T')[0]
      }

      // Handle special time values or use defaults
      if (!time || time === 'current') {
        time = new Date().toTimeString().slice(0, 5)
      }

      // Validate time format (HH:MM)
      if (!/^\d{2}:\d{2}$/.test(time)) {
        time = '09:00' // Default to 9 AM if invalid format
      }

      // Combine date and time
      return `${date}T${time}:00`
    }

    // Parse date for all-day events
    const parseDate = (date: string) => {
      if (!date || date === 'today') {
        // Use local date, not UTC date
        const now = new Date()
        const year = now.getFullYear()
        const month = String(now.getMonth() + 1).padStart(2, '0')
        const day = String(now.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
      }
      // If date contains time component (T or space), extract just the date part
      // But convert from UTC to local date if it's an ISO string
      if (typeof date === 'string' && date.includes('T') && date.includes('Z')) {
        // This is a UTC ISO string from {{NOW}}, convert to local date
        const dateObj = new Date(date)
        const year = dateObj.getFullYear()
        const month = String(dateObj.getMonth() + 1).padStart(2, '0')
        const day = String(dateObj.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
      }
      if (typeof date === 'string' && (date.includes('T') || date.includes(' '))) {
        return date.split('T')[0].split(' ')[0]
      }
      return date
    }

    // Prepare the event data for Google Calendar API
    const eventData: any = {
      summary: title || 'Untitled Event',
      location: location,
      description: description
    }

    // Handle all-day events
    if (allDay) {
      // For all-day events, only use date (no timeZone field)
      eventData.start = {
        date: parseDate(startDate)
      }
      eventData.end = {
        date: parseDate(endDate || startDate)
      }
    } else {
      // Regular timed event
      eventData.start = {
        dateTime: parseDateTime(startDate, startTime),
        timeZone: eventStartTimeZone
      }
      eventData.end = {
        dateTime: parseDateTime(endDate || startDate, endTime || '10:00'),
        timeZone: eventEndTimeZone
      }
    }

    // Process attendees via the shared Q7 normalizer. Calendar already split
    // CSVs inline; routing through `parseRecipients` keeps behavior identical
    // and consolidates the splitting logic with Gmail/Outlook. See
    // learning/docs/handler-contracts.md Q7.
    const parsedAttendees = parseRecipients(attendees)
    const validAttendees = parsedAttendees
      .filter(email => email.includes('@'))
      .map(email => ({ email }))
    if (validAttendees.length > 0) {
      eventData.attendees = validAttendees
    }

    // Add reminders from notifications array
    // For all-day events with a time specified (e.g., "1 day before at 9:00 AM"):
    // - We need to calculate the exact minutes from midnight on the event day
    // - For example: 1 day before at 9:00 AM = (1440 - 540) = 900 minutes from event midnight
    //   (Because 9:00 AM is 540 minutes from midnight, and we want it 1 day before)
    // For timed events, minutes count backward from the event start time
    if (notifications && Array.isArray(notifications) && notifications.length > 0) {
      const processedNotifications = notifications.map((notif: any) => {
        let finalMinutes = notif.minutes

        // If this is an all-day event and a specific time is specified
        if (allDay && notif.time) {
          // Parse the time (format: "HH:mm")
          const [hours, minutes] = notif.time.split(':').map(Number)
          const timeInMinutes = (hours * 60) + minutes

          // Calculate: if user wants "1 day before at 9:00 AM"
          // We need to convert to minutes from midnight on event day
          // Google API: minutes value = when to trigger relative to event start (midnight for all-day)
          // So: 1 day (1440 min) before at 9:00 AM (540 min from midnight) = 1440 - 540 = 900 minutes
          const daysBeforeInMinutes = notif.minutes // e.g., 1440 for 1 day
          finalMinutes = daysBeforeInMinutes - timeInMinutes
        }

        return {
          method: notif.method,
          minutes: finalMinutes
        }
      })

      logger.info('📣 [Google Calendar] Processing notifications:', {
        allDay,
        rawNotifications: notifications,
        processedNotifications
      })

      eventData.reminders = {
        useDefault: false,
        overrides: processedNotifications
      }
    } else {
      eventData.reminders = {
        useDefault: false,
        overrides: []
      }
    }

    // Handle Google Meet conference
    // googleMeet is now a boolean (true/false) instead of an object
    const createMeetLink = googleMeet === true

    if (createMeetLink) {
      // Create conference data for new event
      // Each workflow execution creates a fresh event with a unique Meet link
      const conferenceRequest: any = {
        requestId: `meet_${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' }
      }

      eventData.conferenceData = {
        createRequest: conferenceRequest
      }
    }

    // Set visibility (handle default, public, private)
    if (visibility && visibility !== 'default') {
      eventData.visibility = visibility
    }

    // Set transparency (opaque = busy, transparent = free)
    eventData.transparency = transparency === 'opaque' ? 'opaque' : 'transparent'

    // Set color if specified
    if (colorId && colorId !== 'default') {
      eventData.colorId = colorId
    }

    // Handle recurrence
    if (recurrence && recurrence !== 'none') {
      eventData.recurrence = [recurrence]
    }

    // Guest permissions — only set when there are valid attendees on the event.
    if (validAttendees.length > 0) {
      eventData.guestsCanInviteOthers = guestsCanInviteOthers
      eventData.guestsCanSeeOtherGuests = guestsCanSeeOtherGuests
      eventData.guestsCanModify = guestsCanModify
    }

    // Determine send notifications parameter
    let sendUpdates = 'none'
    if (sendNotifications === 'all') {
      sendUpdates = 'all'
    } else if (sendNotifications === 'externalOnly') {
      sendUpdates = 'externalOnly'
    }

    // Q8b — eventData contains attendee emails (customer PII), so this
    // log line is debug-only. Use debug for diagnostic-rich output;
    // info / warn / error must NOT carry PII.
    logger.debug('📤 [Google Calendar] Event data being sent:', {
      allDay,
      eventData: JSON.stringify(eventData, null, 2)
    })

    // Q4 — within-session idempotency. Hash the semantic event content
    // (start/end/attendees/summary/location/description/visibility/etc.) —
    // the conferenceData.requestId carries Date.now() and is excluded so a
    // re-resolved template hashes equal across replays.
    const idempotencyKey = buildIdempotencyKey(meta)
    const payloadHash = idempotencyKey
      ? hashPayload({
          calendarId,
          summary: eventData.summary,
          location: eventData.location ?? null,
          description: eventData.description ?? null,
          start: eventData.start,
          end: eventData.end,
          attendees: eventData.attendees ?? [],
          visibility: eventData.visibility ?? 'default',
          transparency: eventData.transparency,
          colorId: eventData.colorId ?? null,
          recurrence: eventData.recurrence ?? null,
          reminders: eventData.reminders ?? null,
          guestsCanInviteOthers: eventData.guestsCanInviteOthers ?? null,
          guestsCanSeeOtherGuests: eventData.guestsCanSeeOtherGuests ?? null,
          guestsCanModify: eventData.guestsCanModify ?? null,
          createMeetLink,
          sendUpdates,
        })
      : ''

    if (idempotencyKey) {
      const replay = await checkReplay(idempotencyKey, payloadHash)
      if (replay.kind === 'cached') return replay.result
      if (replay.kind === 'mismatch') {
        return {
          success: false,
          output: {},
          message: 'This action was already executed for this session with different input.',
          error: 'PAYLOAD_MISMATCH',
        }
      }
    }

    // Always create a new event (each workflow execution creates a fresh event).
    // Wrapped in `refreshAndRetry` per Q3 — a 401 from googleapis triggers
    // one refresh+retry attempt; permanent failure returns a structured auth
    // failure that the outer mapping converts to ActionResult.
    const insertResult = await refreshAndRetry({
      provider: 'google-calendar',
      userId,
      accessToken,
      call: async (token) => {
        const client = buildCalendarClient(token)
        return client.events.insert({
          calendarId: calendarId,
          requestBody: eventData,
          sendUpdates: sendUpdates,
          conferenceDataVersion: createMeetLink ? 1 : 0,
        })
      },
    })

    if (!insertResult.success) {
      return {
        success: false,
        output: {},
        message: insertResult.message,
      }
    }

    const response = insertResult.data
    const createdEvent = response.data

    // Extract Google Meet link from conference data
    const meetLink = createdEvent.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri

    logger.info('✅ [Google Calendar] Created new event', {
      eventId: createdEvent.id,
      hasMeet: createMeetLink,
      hangoutLink: createdEvent.hangoutLink,
      meetLink: meetLink,
      conferenceData: createdEvent.conferenceData ? 'present' : 'absent'
    })

    const actionResult: ActionResult = {
      success: true,
      output: {
        eventId: createdEvent.id,
        htmlLink: createdEvent.htmlLink,
        start: createdEvent.start,
        end: createdEvent.end,
        meetLink: meetLink || createdEvent.hangoutLink, // Use meetLink preferentially, fallback to hangoutLink
        attendees: createdEvent.attendees,
        status: createdEvent.status,
        created: createdEvent.created,
        summary: createdEvent.summary,
        location: createdEvent.location,
        startTimezone: eventStartTimeZone,
        endTimezone: eventEndTimeZone
      }
    }

    if (idempotencyKey) {
      await recordFired(idempotencyKey, actionResult, payloadHash, {
        provider: 'google-calendar',
        externalId: createdEvent.id ?? null,
      })
    }

    return actionResult
  } catch (error: any) {
    logger.error('❌ [Google Calendar] Error creating event:', {
      message: error.message,
      code: error.code,
      errors: error.errors,
      response: error.response?.data,
      status: error.response?.status,
      statusText: error.response?.statusText
    })

    // PR-C5 (Q1) — expected provider failures return ActionResult instead of
    // throwing. The execution layer's outer catch is for *unexpected*
    // throws only (programmer errors, invariants); a rejected create-event
    // request is a documented failure path and should be a typed failure.

    // Auth failure path. `refreshAndRetry` already converts SDK 401s into a
    // structured auth failure ActionResult earlier in the function, so this
    // branch fires only for 401-shaped errors that bubble up from outside
    // the principal call (e.g., the `getDecryptedAccessToken` call).
    if (error.message?.includes('401') || error.message?.includes('Unauthorized') || error.code === 401) {
      return {
        success: false,
        output: {},
        category: 'auth',
        message: 'Google Calendar authentication failed. Please reconnect your account.',
      }
    }

    // Provider-side error message — surface the underlying API error verbatim.
    if (error.response?.data?.error?.message) {
      return {
        success: false,
        output: {},
        category: 'provider',
        message: `Google Calendar API Error: ${error.response.data.error.message}`,
      }
    }

    return {
      success: false,
      output: {},
      category: 'provider',
      message: error.message || 'Google Calendar create event failed',
    }
  }
}