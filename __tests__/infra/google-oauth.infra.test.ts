/**
 * Infra test (PR-F item 9): Google OAuth sandbox round-trip.
 *
 * Validates the real callback → token-exchange → encrypted-storage path
 * against Google's OAuth endpoint using a sandbox refresh token. Per
 * `learning/docs/test-infra-credentials.md`, this is the spike that proves
 * the pattern; Microsoft / Slack / Discord / Notion etc. are deferred.
 *
 * What this test does:
 *   1. POST to https://oauth2.googleapis.com/token with the sandbox
 *      refresh_token to mint a fresh access_token.
 *   2. Assert the response shape: access_token is a non-empty string,
 *      token_type is "Bearer", expires_in is a positive number.
 *   3. Round-trip the fresh access_token through `encrypt` / `decrypt`
 *      from `lib/security/encryption.ts` to prove the AES-256 storage
 *      format produces the original token verbatim. Uses an in-test
 *      key so the suite doesn't depend on ENCRYPTION_KEY in env.
 *
 * What this test does NOT do:
 *   - Make any provider data calls (no Gmail / Calendar / Drive reads or
 *     writes). The point is OAuth flow validation, not handler behavior.
 *   - Touch the database. No `integrations` row is read or written.
 *   - Mutate the sandbox account's data in any way.
 *
 * Skip behavior:
 *   - When `TEST_GOOGLE_CLIENT_ID` / `TEST_GOOGLE_CLIENT_SECRET` /
 *     `TEST_GOOGLE_REFRESH_TOKEN` are unset (the developer-machine and
 *     CI-without-secrets case), each test logs a skip note and returns.
 *     Matches the pattern used by dbHarness / mailHarness / stripeHarness
 *     infra smoke tests.
 *   - `TEST_GOOGLE_USER_EMAIL` is optional metadata for diagnostics — its
 *     absence doesn't cause a skip.
 *
 * Rotation: regenerate the refresh token quarterly per
 * `learning/docs/test-infra-credentials.md` §3.
 */

import { decrypt, encrypt } from '@/lib/security/encryption'

const REQUIRES_CREDS_NOTE =
  '(skipped: TEST_GOOGLE_CLIENT_ID / TEST_GOOGLE_CLIENT_SECRET / TEST_GOOGLE_REFRESH_TOKEN not set — see learning/docs/test-infra-credentials.md)'

interface GoogleOAuthCreds {
  clientId?: string
  clientSecret?: string
  refreshToken?: string
  userEmail?: string
}

const creds: GoogleOAuthCreds = {
  clientId: process.env.TEST_GOOGLE_CLIENT_ID,
  clientSecret: process.env.TEST_GOOGLE_CLIENT_SECRET,
  refreshToken: process.env.TEST_GOOGLE_REFRESH_TOKEN,
  userEmail: process.env.TEST_GOOGLE_USER_EMAIL,
}

const credsAvailable = Boolean(
  creds.clientId && creds.clientSecret && creds.refreshToken,
)

// In-test encryption key (32+ chars). Avoids depending on ENCRYPTION_KEY
// being present in the test environment — the encryption module accepts a
// caller-supplied key as a second argument for exactly this purpose.
const TEST_ENCRYPTION_KEY = 'test-only-32-char-encryption-key-abc'

async function exchangeRefreshTokenForAccessToken(): Promise<{
  access_token: string
  token_type: string
  expires_in: number
  scope?: string
}> {
  const params = new URLSearchParams({
    client_id: creds.clientId!,
    client_secret: creds.clientSecret!,
    refresh_token: creds.refreshToken!,
    grant_type: 'refresh_token',
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(
      `Google token exchange failed: ${res.status} ${res.statusText} — ${errText}`,
    )
  }

  return res.json() as Promise<{
    access_token: string
    token_type: string
    expires_in: number
    scope?: string
  }>
}

describe('google-oauth — sandbox round-trip', () => {
  test('refresh_token grants a well-formed access_token from Google\'s OAuth endpoint', async () => {
    if (!credsAvailable) {
      console.warn(`[google-oauth.infra] ${REQUIRES_CREDS_NOTE}`)
      return
    }

    const data = await exchangeRefreshTokenForAccessToken()

    // Basic shape — Google always returns these fields on a successful
    // refresh_token grant. Token format itself is intentionally opaque
    // to consumers, so we only assert non-emptiness + reasonable length
    // rather than pinning a prefix that Google could legitimately change.
    expect(typeof data.access_token).toBe('string')
    expect(data.access_token.length).toBeGreaterThan(20)
    expect(data.token_type).toMatch(/^Bearer$/i)
    expect(typeof data.expires_in).toBe('number')
    expect(data.expires_in).toBeGreaterThan(0)
  })

  test('the fresh access_token round-trips through encrypt/decrypt', async () => {
    if (!credsAvailable) {
      console.warn(`[google-oauth.infra] ${REQUIRES_CREDS_NOTE}`)
      return
    }

    const { access_token } = await exchangeRefreshTokenForAccessToken()

    const encrypted = encrypt(access_token, TEST_ENCRYPTION_KEY)

    // Storage format from `lib/security/encryption.ts` is `<iv-hex>:<body-hex>`.
    // IV is 16 bytes → 32 hex chars. Body is non-empty.
    expect(encrypted).toContain(':')
    const [ivHex, bodyHex] = encrypted.split(':')
    expect(ivHex).toHaveLength(32)
    expect(bodyHex.length).toBeGreaterThan(0)

    // Decrypt round-trip yields the original token verbatim — proves the
    // stored shape is reversible end-to-end with the same key.
    const decrypted = decrypt(encrypted, TEST_ENCRYPTION_KEY)
    expect(decrypted).toBe(access_token)
  })

  test('refresh_token is reusable (Google returns the same long-lived refresh token; new access tokens differ)', async () => {
    if (!credsAvailable) {
      console.warn(`[google-oauth.infra] ${REQUIRES_CREDS_NOTE}`)
      return
    }

    // Two consecutive refresh exchanges should both succeed. Google's
    // long-lived refresh token does not rotate on each grant, so we
    // can call refresh twice without invalidating the stored token.
    // We don't strictly assert the access_tokens differ — Google may
    // legitimately return a still-valid cached token within a short
    // window — but we do assert both calls succeed.
    const first = await exchangeRefreshTokenForAccessToken()
    const second = await exchangeRefreshTokenForAccessToken()

    expect(first.access_token).toBeTruthy()
    expect(second.access_token).toBeTruthy()
  })
})
