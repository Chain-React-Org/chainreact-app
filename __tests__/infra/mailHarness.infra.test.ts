/**
 * Smoke test: mailHarness can talk to MailHog over its HTTP API.
 *
 * Verifies the harness can clear messages, then send one over SMTP,
 * then read it back via the JSON API with headers + body intact.
 * The actual SMTP send goes through nodemailer — using the `net`
 * module to speak the protocol manually keeps this test from adding
 * a runtime dependency on nodemailer just for a smoke test.
 *
 * Skipped when MailHog isn't reachable — same pattern as dbHarness.
 */

import * as net from 'net'
import {
  clearMessages,
  getLastMessage,
  getMessages,
  isMailHogAvailable,
} from '../helpers/mailHarness'

const SMTP_HOST = process.env.TEST_MAILHOG_SMTP_HOST || '127.0.0.1'
const SMTP_PORT = Number(process.env.TEST_MAILHOG_SMTP_PORT || 1025)

const REQUIRES_DOCKER_NOTE =
  '(skipped: mailhog not reachable — run `npm run test:infra:up`)'

/**
 * Send a tiny RFC 5321 SMTP transaction directly. MailHog accepts any
 * envelope without authentication. We use raw sockets because we're
 * smoke-testing the *capture* layer, not the production send path.
 */
async function sendTinySmtp(opts: {
  from: string
  to: string
  subject: string
  body: string
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SMTP_PORT, SMTP_HOST)
    const lines: string[] = []
    let step = 0

    const send = (line: string) => {
      socket.write(line + '\r\n')
    }

    socket.on('data', (chunk) => {
      lines.push(chunk.toString())
      // Each line below corresponds to a server response we wait for.
      if (step === 0) {
        send('HELO test')
        step++
      } else if (step === 1) {
        send(`MAIL FROM:<${opts.from}>`)
        step++
      } else if (step === 2) {
        send(`RCPT TO:<${opts.to}>`)
        step++
      } else if (step === 3) {
        send('DATA')
        step++
      } else if (step === 4) {
        // Now actually send headers + body, terminated with \r\n.\r\n.
        send(`From: ${opts.from}`)
        send(`To: ${opts.to}`)
        send(`Subject: ${opts.subject}`)
        send('')
        send(opts.body)
        send('.')
        step++
      } else if (step === 5) {
        send('QUIT')
        step++
      } else if (step === 6) {
        socket.end()
      }
    })

    socket.on('end', () => resolve())
    socket.on('error', (err) => reject(err))
  })
}

let mailAvailable = false
beforeAll(async () => {
  mailAvailable = await isMailHogAvailable()
  if (mailAvailable) await clearMessages()
})

describe('mailHarness — smoke', () => {
  test('clear → send → getMessages returns exactly the captured message', async () => {
    if (!mailAvailable) {
      console.warn(`[mailHarness.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await clearMessages()
    expect(await getMessages()).toHaveLength(0)

    await sendTinySmtp({
      from: 'sender@chainreact.test',
      to: 'recipient@chainreact.test',
      subject: 'Smoke',
      body: 'hello mailhog',
    })

    // MailHog stores asynchronously; brief wait for the message to land.
    let messages = await getMessages()
    let attempts = 0
    while (messages.length === 0 && attempts < 10) {
      await new Promise((r) => setTimeout(r, 100))
      messages = await getMessages()
      attempts++
    }

    expect(messages).toHaveLength(1)
    const last = (await getLastMessage())!
    expect(last.subject).toBe('Smoke')
    expect(last.to).toContain('recipient@chainreact.test')
    expect(last.from).toBe('sender@chainreact.test')
    expect(last.body).toContain('hello mailhog')
  })

  test('clearMessages drops every captured message', async () => {
    if (!mailAvailable) {
      console.warn(`[mailHarness.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }
    // Previous test may have left a message; this asserts a clean slate.
    await clearMessages()
    expect(await getMessages()).toHaveLength(0)
  })
})
