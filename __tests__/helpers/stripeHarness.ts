/**
 * stripe-mock test harness (PR-E).
 *
 * Points the Stripe SDK at the local stripe-mock service started by
 * docker-compose.test.yml, so infra-bound tests can exercise:
 *   - the SDK's signature verification path
 *   - real Stripe error class shapes (StripeAuthenticationError, etc.)
 *   - the real-but-deterministic API surface (charges, payment intents,
 *     subscriptions, refunds — stripe-mock returns canned valid
 *     responses for every endpoint).
 *
 * Why a harness rather than letting tests configure Stripe themselves:
 *   - Tests never mention the local URL — the harness owns that.
 *   - Captured-request introspection is centralized: tests assert
 *     `getCapturedRequests()` instead of digging through fetchMock.
 *   - Skip-when-unavailable logic lives in one place
 *     (`isStripeMockAvailable`).
 *
 * Note: stripe-mock returns canned data; it does NOT remember calls
 * across requests (e.g. you can't create a customer and then retrieve
 * that exact customer). For idempotency / replay flows, infra tests
 * should bracket calls with `getCapturedRequests()` snapshotting.
 */

export interface StripeMockConfig {
  /** Base URL for stripe-mock's HTTP endpoint (no trailing slash). */
  baseUrl: string
  /**
   * API key the SDK will send. stripe-mock accepts any non-empty
   * value — `sk_test_mock` is conventional and shows up in logs as
   * obviously fake.
   */
  apiKey: string
}

export const DEFAULT_STRIPE_MOCK_CONFIG: StripeMockConfig = {
  baseUrl: process.env.TEST_STRIPE_MOCK_URL || 'http://127.0.0.1:12111',
  apiKey: process.env.TEST_STRIPE_MOCK_KEY || 'sk_test_mock',
}

/** Lazy require so the rest of the test suite doesn't load `stripe`. */
function getStripeCtor(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('stripe')
}

/**
 * Build a Stripe SDK client pointed at stripe-mock. Use the returned
 * client exactly as you would the real SDK — it sends real HTTP, but
 * to the local container.
 */
export function makeStripeClient(
  config: Partial<StripeMockConfig> = {},
): any {
  const merged = { ...DEFAULT_STRIPE_MOCK_CONFIG, ...config }
  const Stripe = getStripeCtor()
  // The Stripe SDK takes `host` / `port` / `protocol` separately
  // rather than a base URL string. stripe-mock listens on plain HTTP.
  const url = new URL(merged.baseUrl)
  return new Stripe(merged.apiKey, {
    apiVersion: '2024-10-28.acacia' as any,
    host: url.hostname,
    port: Number(url.port || 80),
    protocol: url.protocol.replace(':', '') as 'http' | 'https',
    // Disable SDK retries so test assertions on call counts are deterministic.
    maxNetworkRetries: 0,
    timeout: 5_000,
  })
}

/**
 * Captured outbound HTTP shape for assertions. Produced by the
 * `withRequestCapture` wrapper.
 */
export interface CapturedStripeRequest {
  method: string
  path: string
  headers: Record<string, string>
  body: string
}

/**
 * Wrap a Stripe SDK client so every outbound request is logged in
 * the returned `captured` array. Useful for asserting that the
 * Idempotency-Key header was set correctly, that the request body
 * carries the right `flattenForStripe` output, etc.
 *
 * Implementation note: we monkey-patch `stripe._requestSender` indirectly
 * by intercepting at the `fetch` level. The Stripe SDK uses the global
 * `fetch` when configured with `httpClient: 'fetch'`; otherwise it uses
 * Node's `http` module. We default to fetch-based capture since infra
 * tests run under jest with native `fetch` available.
 */
export function withRequestCapture(stripe: any): {
  stripe: any
  captured: CapturedStripeRequest[]
  restore: () => void
} {
  const captured: CapturedStripeRequest[] = []
  const originalFetch = globalThis.fetch
  const interceptingFetch: typeof fetch = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url
    captured.push({
      method: (init?.method || 'GET').toUpperCase(),
      path: typeof url === 'string' ? url : String(url),
      headers: Object.fromEntries(
        Object.entries((init?.headers || {}) as Record<string, string>).map(
          ([k, v]) => [k.toLowerCase(), String(v)],
        ),
      ),
      body: typeof init?.body === 'string' ? init.body : '',
    })
    return originalFetch(input, init)
  }
  globalThis.fetch = interceptingFetch as any
  return {
    stripe,
    captured,
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}

/**
 * Truthy iff stripe-mock answers an unauthenticated probe. Used by
 * infra smoke tests as a precondition gate.
 *
 * stripe-mock returns 401 for unauthenticated GETs, which is
 * "alive but rejecting" — exactly the signal we want.
 */
export async function isStripeMockAvailable(
  config: Partial<StripeMockConfig> = {},
): Promise<boolean> {
  const baseUrl = config.baseUrl ?? DEFAULT_STRIPE_MOCK_CONFIG.baseUrl
  try {
    const res = await fetch(`${baseUrl}/v1/charges`)
    // 200 (mock returned canned list) or 401 (Bearer required) both
    // indicate "the service is up and responding to HTTP".
    return res.status === 200 || res.status === 401
  } catch {
    return false
  }
}
