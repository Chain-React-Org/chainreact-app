/**
 * Infra test (PR-F item 8): email delivery capture.
 *
 * The production email sender (`lib/notifications/email.ts`) uses
 * Resend exclusively — there is no SMTP path today, so MailHog can't
 * directly capture production code's outbound mail without changing
 * `sendEmail`. Per PR-F guardrails ("Do not change handler defaults"
 * and "Keep mocks only at external network boundaries not covered by
 * Docker services"), this file pins two complementary contracts:
 *
 *   A. Production `sendEmail` constructs the right Resend payload —
 *      verified by mocking ONLY the Resend HTTP boundary. The
 *      payload-shape contract (from, to, subject, text, html) is
 *      what downstream notification reliability depends on.
 *
 *   B. The mailHarness correctly captures complex SMTP messages
 *      (multi-recipient, custom headers, body content). This proves
 *      the harness is ready when an SMTP-based code path lands —
 *      e.g., a future workflow action that emits SMTP, or a Resend
 *      replacement.
 *
 * The MailHog tests skip cleanly when Docker isn't running. The
 * Resend payload tests have no infra dependency.
 */

import * as net from 'net'
import {
  clearMessages,
  getMessages,
  isMailHogAvailable,
} from '../helpers/mailHarness'

const REQUIRES_DOCKER_NOTE =
  '(skipped: mailhog not reachable — run `npm run test:infra:up`)'

const SMTP_HOST = process.env.TEST_MAILHOG_SMTP_HOST || '127.0.0.1'
const SMTP_PORT = Number(process.env.TEST_MAILHOG_SMTP_PORT || 1025)

let mailAvailable = false
beforeAll(async () => {
  mailAvailable = await isMailHogAvailable()
  if (mailAvailable) await clearMessages()
})

// ─── A. Production sendEmail Resend-payload contract ────────────────

describe('lib/notifications/email — Resend payload construction', () => {
  // Mock Resend at the HTTP boundary so we can inspect the payload
  // sendEmail builds without making a real Resend API call.
  let capturedPayload: any = null
  let resendCallCount = 0

  jest.mock('resend', () => ({
    Resend: jest.fn().mockImplementation(() => ({
      emails: {
        send: jest.fn(async (payload: any) => {
          capturedPayload = payload
          resendCallCount += 1
          return { data: { id: 'mock-resend-msg-id' }, error: null }
        }),
      },
    })),
  }))

  beforeAll(() => {
    process.env.RESEND_API_KEY = 'test-resend-key'
  })

  beforeEach(() => {
    capturedPayload = null
    resendCallCount = 0
  })

  test('sendEmail builds a Resend payload with from / to / subject / text / html', async () => {
    const { sendEmail } = await import('@/lib/notifications/email')

    const ok = await sendEmail(
      'recipient@chainreact.test',
      'Workflow alert',
      'Plain text body',
      '<p>HTML body</p>',
    )

    expect(ok).toBe(true)
    expect(resendCallCount).toBe(1)
    expect(capturedPayload).toBeTruthy()
    expect(capturedPayload.to).toEqual(['recipient@chainreact.test'])
    expect(capturedPayload.subject).toBe('Workflow alert')
    expect(capturedPayload.text).toBe('Plain text body')
    expect(capturedPayload.html).toBe('<p>HTML body</p>')
    expect(capturedPayload.from).toMatch(/chainreact/i)
  })

  test('sendEmail rejects an invalid recipient before calling Resend', async () => {
    const { sendEmail } = await import('@/lib/notifications/email')

    const ok = await sendEmail('not-an-email', 'subj', 'body')
    expect(ok).toBe(false)
    expect(resendCallCount).toBe(0)
  })

  test('sendEmail returns false (does NOT throw) when RESEND_API_KEY is missing', async () => {
    const original = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY
    try {
      // Force a fresh module load so the early check in sendEmail
      // (line 37 of source) re-reads the env.
      jest.resetModules()
      const { sendEmail } = await import('@/lib/notifications/email')
      const ok = await sendEmail('alice@chainreact.test', 'subj', 'body')
      expect(ok).toBe(false)
    } finally {
      process.env.RESEND_API_KEY = original
    }
  })

  test('sendEmail auto-generates HTML from text body when html is omitted', async () => {
    jest.resetModules()
    process.env.RESEND_API_KEY = 'test-resend-key'
    const { sendEmail } = await import('@/lib/notifications/email')

    await sendEmail('alice@chainreact.test', 'Issue', 'plain alert text')
    expect(capturedPayload.html).toBeTruthy()
    // Default template wraps the message in a styled HTML doc.
    expect(capturedPayload.html).toContain('plain alert text')
    expect(capturedPayload.html).toContain('<!DOCTYPE html>')
  })
})

// ─── B. MailHog harness richer-capture contract ─────────────────────

/**
 * Send an SMTP message via raw socket. Used to exercise the harness's
 * capture surface beyond what the PR-E smoke test covered. Production
 * code does NOT emit SMTP today — this verifies the harness is ready
 * for when one lands.
 */
async function sendSmtpMessage(opts: {
  from: string
  to: string[]
  subject: string
  body: string
  customHeaders?: Record<string, string>
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SMTP_PORT, SMTP_HOST)
    let step = 0
    const send = (line: string) => {
      socket.write(line + '\r\n')
    }
    const greetingHandled = () => {
      step++
      send('HELO chainreact-test')
    }
    socket.on('data', () => {
      if (step === 0) {
        greetingHandled()
      } else if (step === 1) {
        send(`MAIL FROM:<${opts.from}>`)
        step++
      } else if (step >= 2 && step < 2 + opts.to.length) {
        send(`RCPT TO:<${opts.to[step - 2]}>`)
        step++
      } else if (step === 2 + opts.to.length) {
        send('DATA')
        step++
      } else if (step === 3 + opts.to.length) {
        send(`From: ${opts.from}`)
        send(`To: ${opts.to.join(', ')}`)
        send(`Subject: ${opts.subject}`)
        for (const [k, v] of Object.entries(opts.customHeaders ?? {})) {
          send(`${k}: ${v}`)
        }
        send('')
        send(opts.body)
        send('.')
        step++
      } else if (step === 4 + opts.to.length) {
        send('QUIT')
        step++
      } else {
        socket.end()
      }
    })
    socket.on('end', () => resolve())
    socket.on('error', reject)
  })
}

async function waitForMessages(n: number, timeoutMs = 1500): Promise<any[]> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const msgs = await getMessages()
    if (msgs.length >= n) return msgs
    await new Promise((r) => setTimeout(r, 50))
  }
  return getMessages()
}

describe('mailHarness — richer captures', () => {
  test('captures a multi-recipient message with all addresses on the To line', async () => {
    if (!mailAvailable) {
      console.warn(`[email-delivery.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await clearMessages()
    await sendSmtpMessage({
      from: 'sender@chainreact.test',
      to: ['alice@chainreact.test', 'bob@chainreact.test'],
      subject: 'Multi recipient',
      body: 'hello team',
    })

    const msgs = await waitForMessages(1)
    expect(msgs).toHaveLength(1)
    const m = msgs[0]
    expect(m.subject).toBe('Multi recipient')
    expect(m.to).toEqual(
      expect.arrayContaining(['alice@chainreact.test', 'bob@chainreact.test']),
    )
    expect(m.body).toContain('hello team')
  })

  test('captures custom headers (e.g. X-Workflow-Id) for downstream assertions', async () => {
    if (!mailAvailable) {
      console.warn(`[email-delivery.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await clearMessages()
    await sendSmtpMessage({
      from: 'sender@chainreact.test',
      to: ['inspector@chainreact.test'],
      subject: 'Custom headers',
      body: 'check the headers',
      customHeaders: {
        'X-Workflow-Id': 'wf-abc-123',
        'X-Trace-Id': 'trace-xyz',
      },
    })

    const msgs = await waitForMessages(1)
    expect(msgs).toHaveLength(1)
    const headers = msgs[0].headers
    // MailHog lower-cases header keys via the harness's normalizer.
    expect(headers['x-workflow-id']?.[0]).toBe('wf-abc-123')
    expect(headers['x-trace-id']?.[0]).toBe('trace-xyz')
  })

  test('clearMessages drops every captured message between runs', async () => {
    if (!mailAvailable) {
      console.warn(`[email-delivery.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await clearMessages()
    expect(await getMessages()).toHaveLength(0)

    await sendSmtpMessage({
      from: 's@x.test',
      to: ['r@x.test'],
      subject: 'before clear',
      body: 'b',
    })
    await waitForMessages(1)

    await clearMessages()
    expect(await getMessages()).toHaveLength(0)
  })
})
