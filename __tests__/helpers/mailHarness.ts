/**
 * MailHog test harness (PR-E).
 *
 * The Docker stack runs MailHog as an SMTP capture proxy. Code under
 * test sends mail to localhost:1025 (configured via env vars in
 * infra-bound tests); MailHog stores every message in memory and
 * exposes them on its HTTP API at http://localhost:8025.
 *
 * This harness wraps the HTTP API so tests can:
 *   - clear captured messages between tests (`clearMessages()`)
 *   - fetch captured messages and inspect headers/body
 *     (`getMessages()`, `getLastMessage()`)
 *   - decode the (possibly quoted-printable) body to plain text
 *
 * MailHog API docs: https://github.com/mailhog/MailHog/blob/master/docs/APIv2/swagger-2.0.yaml
 */

export interface MailHogConfig {
  /** Base URL for the MailHog HTTP API (no trailing slash). */
  baseUrl: string
}

export const DEFAULT_MAILHOG_CONFIG: MailHogConfig = {
  baseUrl: process.env.TEST_MAILHOG_URL || 'http://127.0.0.1:8025',
}

/** Subset of MailHog's v2 message shape that tests typically care about. */
export interface CapturedMessage {
  id: string
  from: string
  to: string[]
  subject: string
  /** Raw body (may be quoted-printable / base64 encoded). */
  rawBody: string
  /** Decoded text body (best-effort QP decoding). */
  body: string
  /** Header map (lowercased keys). */
  headers: Record<string, string[]>
}

/**
 * Best-effort quoted-printable decoder. Sufficient for assertion of
 * common headers and ASCII-ish bodies that the existing email handlers
 * emit. Tests that need full MIME parsing should use the raw body.
 */
function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, '') // soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
}

function normalizeHeaders(raw: Record<string, string[]> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!raw) return out
  for (const [k, v] of Object.entries(raw)) {
    out[k.toLowerCase()] = v
  }
  return out
}

function extractAddresses(raw: any[] | undefined): string[] {
  if (!raw) return []
  return raw
    .map((p) => {
      if (!p) return null
      if (typeof p === 'string') return p
      if (p.Mailbox && p.Domain) return `${p.Mailbox}@${p.Domain}`
      return null
    })
    .filter((x): x is string => Boolean(x))
}

/** Convert a MailHog v2 message envelope to our flatter shape. */
function toCapturedMessage(raw: any): CapturedMessage {
  const headers = normalizeHeaders(raw?.Content?.Headers)
  const subject = headers['subject']?.[0] ?? ''
  const from = extractAddresses(raw?.From ? [raw.From] : [])[0] ?? ''
  const to = extractAddresses(raw?.To)
  const rawBody = String(raw?.Content?.Body ?? '')
  const isQp = (headers['content-transfer-encoding']?.[0] ?? '').toLowerCase() === 'quoted-printable'
  const body = isQp ? decodeQuotedPrintable(rawBody) : rawBody

  return {
    id: String(raw?.ID ?? ''),
    from,
    to,
    subject,
    rawBody,
    body,
    headers,
  }
}

/**
 * Return all captured messages in oldest-first order.
 *
 * MailHog's `/api/v2/messages` returns newest-first under `items`.
 * We reverse it so test assertions read naturally
 * ("the first email sent looks like…").
 */
export async function getMessages(
  config: Partial<MailHogConfig> = {},
): Promise<CapturedMessage[]> {
  const baseUrl = config.baseUrl ?? DEFAULT_MAILHOG_CONFIG.baseUrl
  const res = await fetch(`${baseUrl}/api/v2/messages`)
  if (!res.ok) {
    throw new Error(`MailHog GET messages returned ${res.status}`)
  }
  const data = (await res.json()) as { items?: any[] }
  return (data.items ?? []).slice().reverse().map(toCapturedMessage)
}

/** Convenience: fetch the most recently captured message, or null. */
export async function getLastMessage(
  config: Partial<MailHogConfig> = {},
): Promise<CapturedMessage | null> {
  const all = await getMessages(config)
  return all.length > 0 ? all[all.length - 1] : null
}

/** Drop every captured message. Call in `beforeEach` for clean state. */
export async function clearMessages(
  config: Partial<MailHogConfig> = {},
): Promise<void> {
  const baseUrl = config.baseUrl ?? DEFAULT_MAILHOG_CONFIG.baseUrl
  const res = await fetch(`${baseUrl}/api/v1/messages`, { method: 'DELETE' })
  if (!res.ok) {
    throw new Error(`MailHog DELETE messages returned ${res.status}`)
  }
}

/**
 * Truthy iff the MailHog HTTP API responds. Used by infra smoke tests
 * as a precondition gate.
 */
export async function isMailHogAvailable(
  config: Partial<MailHogConfig> = {},
): Promise<boolean> {
  const baseUrl = config.baseUrl ?? DEFAULT_MAILHOG_CONFIG.baseUrl
  try {
    const res = await fetch(`${baseUrl}/api/v2/messages`)
    return res.ok
  } catch {
    return false
  }
}
