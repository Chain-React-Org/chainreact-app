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
 *
 * Optionally pass a custom `fetchFn` so `withRequestCapture` can hand
 * the SDK an intercepting fetch at construction time. Without that,
 * the SDK captures its own `fetch` reference and global-fetch
 * monkey-patches don't work.
 */
export function makeStripeClient(
  config: Partial<StripeMockConfig> = {},
  fetchFn?: typeof fetch,
): any {
  const merged = { ...DEFAULT_STRIPE_MOCK_CONFIG, ...config }
  const Stripe = getStripeCtor()
  const StripeCtor = Stripe.default ?? Stripe
  // The Stripe SDK takes `host` / `port` / `protocol` separately
  // rather than a base URL string. stripe-mock listens on plain HTTP.
  const url = new URL(merged.baseUrl)
  return new StripeCtor(merged.apiKey, {
    apiVersion: '2024-10-28.acacia' as any,
    host: url.hostname,
    port: Number(url.port || 80),
    protocol: url.protocol.replace(':', '') as 'http' | 'https',
    // Use fetch-based HTTP client (rather than the default Node http
    // module) so callers can swap in an intercepting fetch.
    httpClient: StripeCtor.createFetchHttpClient(fetchFn),
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
 * Build a Stripe client whose outbound HTTP is captured for
 * assertions. Useful for verifying that the Idempotency-Key header
 * was set correctly, that the request body carries the right
 * `flattenForStripe` output, etc.
 *
 * Returns a fresh client + captured array. The captured array is
 * mutated as requests fire — read it after each `await stripe.x.y()`.
 *
 * Implementation: hands a custom fetch to the Stripe SDK at
 * construction time (via `Stripe.createFetchHttpClient(fetchFn)`),
 * because the SDK captures its fetch reference internally — patching
 * global fetch AFTER construction has no effect.
 */
export function withRequestCapture(
  config: Partial<StripeMockConfig> = {},
): {
  stripe: any
  captured: CapturedStripeRequest[]
} {
  const captured: CapturedStripeRequest[] = []
  const interceptingFetch: typeof fetch = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input)
    const headers: Record<string, string> = {}
    const rawHeaders = init?.headers
    // Stripe's fetch http client passes headers as Array<[key, value]>.
    // Other callers may pass `Headers` instances or plain objects. Handle
    // all three shapes.
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((v: string, k: string) => {
        headers[k.toLowerCase()] = v
      })
    } else if (Array.isArray(rawHeaders)) {
      for (const entry of rawHeaders) {
        if (Array.isArray(entry) && entry.length >= 2) {
          headers[String(entry[0]).toLowerCase()] = String(entry[1])
        }
      }
    } else if (rawHeaders && typeof rawHeaders === 'object') {
      for (const [k, v] of Object.entries(rawHeaders as Record<string, string>)) {
        headers[k.toLowerCase()] = String(v)
      }
    }
    captured.push({
      method: (init?.method || 'GET').toUpperCase(),
      path: typeof url === 'string' ? url : String(url),
      headers,
      body: typeof init?.body === 'string' ? init.body : '',
    })
    return globalThis.fetch(input, init)
  }
  const stripe = makeStripeClient(config, interceptingFetch as any)
  return { stripe, captured }
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
