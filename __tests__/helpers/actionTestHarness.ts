/**
 * Shared test harness for workflow action handlers (Phase 2).
 *
 * Contract:
 * - This module applies infrastructure-level jest.mock() calls as side effects
 *   when imported. It MUST be the first import in any test file that uses it,
 *   so the mocks are registered before the handler module loads.
 * - Mocks only stop at external boundaries: token decryption, Supabase client
 *   construction, AES decryption, the `googleapis` SDK, and `node-fetch`.
 *   The handler under test runs unmocked.
 * - Outbound HTTP for handlers that use `fetch` directly is captured by
 *   jest-fetch-mock; the harness re-exports `fetchMock` and the assertion
 *   helpers `getFetchCalls()` / `assertFetchCalled()`.
 * - Handlers that use the `googleapis` SDK (Gmail, Calendar, Drive) get a
 *   mocked SDK whose method jests can be configured per-test via the exported
 *   `mockGmailApi` / `mockCalendarApi` / `mockDriveApi` objects.
 *
 * Style:
 * - Tests built on this harness invoke the real handler with realistic config
 *   and input. They assert on the ActionResult shape AND on the outbound
 *   network call (method / URL / body). They do NOT mock the function under
 *   test, and they do NOT assert on internal helper invocations.
 */

// ─── Env defaults (must come before any handler imports) ───────────────────

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-openai-key"
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-anthropic-key"
process.env.GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || "test-google-ai-key"
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://test.supabase.co"
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "test-anon-key"
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key"
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "test-secret-key"
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "test-resend-key"

import fetchMock from "jest-fetch-mock"

// ─── googleapis SDK mock objects ───────────────────────────────────────────
// These are returned by `google.gmail()` / `google.calendar()` / `google.drive()`.
// Tests configure per-method behaviour via .mockResolvedValue / .mockRejectedValue.

export const mockGmailApi = {
  users: {
    messages: {
      send: jest.fn(),
      modify: jest.fn(),
      get: jest.fn(),
    },
    drafts: {
      create: jest.fn(),
    },
    labels: {
      list: jest.fn(),
    },
  },
}

export const mockCalendarApi = {
  events: {
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
  },
  calendarList: {
    list: jest.fn(),
  },
}

export const mockDriveApi = {
  files: {
    create: jest.fn(),
    update: jest.fn(),
    get: jest.fn(),
    list: jest.fn(),
  },
  permissions: {
    create: jest.fn(),
  },
}

const mockOAuth2Client = {
  setCredentials: jest.fn(),
}

jest.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: jest.fn(() => mockOAuth2Client),
    },
    gmail: jest.fn(() => mockGmailApi),
    calendar: jest.fn(() => mockCalendarApi),
    drive: jest.fn(() => mockDriveApi),
  },
}))

// node-fetch is used by some Google handlers (e.g., Drive). Route it through
// the same jest-fetch-mock so all outbound HTTP shows up in one place.
jest.mock("node-fetch", () => ({
  __esModule: true,
  default: (...args: any[]) => (globalThis.fetch as any)(...args),
}))

// ─── Infrastructure mocks (auth, DB, encryption, secrets, logger) ─────────

let mockTokenValue = "mock-token-12345"

jest.mock("@/lib/workflows/actions/core/getDecryptedAccessToken", () => ({
  getDecryptedAccessToken: jest.fn(async () => mockTokenValue),
}))

let mockIntegrationValue: any = {
  id: "integration-1",
  user_id: "user-1",
  provider: "shopify",
  status: "connected",
  access_token: "mock-token-12345",
  shop_domain: "test-shop.myshopify.com",
  metadata: { shop: "test-shop.myshopify.com" },
}

jest.mock("@/lib/workflows/integrationHelpers", () => ({
  getIntegrationById: jest.fn(async () => mockIntegrationValue),
}))

// Some handlers import getIntegrationById via executeNode's re-export
// (the path resolves to `lib/workflows/executeNode.ts` from a handler under
//  `lib/workflows/actions/<provider>/<file>.ts` via `../../executeNode`).
jest.mock("@/lib/workflows/executeNode", () => ({
  getIntegrationById: jest.fn(async () => mockIntegrationValue),
  executeNode: jest.fn(),
}))

const supabaseChain: any = {
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  neq: jest.fn().mockReturnThis(),
  is: jest.fn().mockReturnThis(),
  in: jest.fn().mockReturnThis(),
  or: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  range: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: null, error: null }),
  maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
  upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
  insert: jest.fn().mockResolvedValue({ data: null, error: null }),
  update: jest.fn().mockResolvedValue({ data: null, error: null }),
  delete: jest.fn().mockResolvedValue({ data: null, error: null }),
}

jest.mock("@/utils/supabase/server", () => ({
  createSupabaseServerClient: jest.fn(async () => ({
    from: () => ({ ...supabaseChain }),
  })),
  createSupabaseServiceClient: jest.fn(async () => ({
    from: () => ({ ...supabaseChain }),
  })),
}))

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({ from: () => ({ ...supabaseChain }) })),
}))

jest.mock("@/lib/security/encryption", () => ({
  decrypt: jest.fn((val: string) => val),
  encrypt: jest.fn((val: string) => val),
  safeDecrypt: jest.fn((val: string) => val),
}))

jest.mock("@/lib/secrets", () => ({
  getSecret: jest.fn().mockResolvedValue(null),
}))

jest.mock("@/lib/utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// File storage — used by Gmail / Outlook for attachments. Some handlers
// call static methods (FileStorageService.getFile); some instantiate the
// class (new FileStorageService()). Make the mock support both.
jest.mock("@/lib/storage/fileStorage", () => {
  class FileStorageService {
    static getFile = jest.fn()
    static uploadFile = jest.fn()
    static deleteFile = jest.fn()
    getFile = jest.fn()
    uploadFile = jest.fn()
    deleteFile = jest.fn()
    getFileById = jest.fn()
  }
  return { FileStorageService }
})

jest.mock("@/lib/utils/workflowFileCleanup", () => ({
  deleteWorkflowTempFiles: jest.fn(async () => undefined),
}))

// Enable fetch-mock once at module load.
fetchMock.enableMocks()

// ─── Public API ────────────────────────────────────────────────────────────

export { fetchMock }

/**
 * Configure the value returned by `getDecryptedAccessToken`. Pass `null`
 * to make subsequent calls reject (simulating an expired/missing token).
 */
export function setMockToken(token: string | null): void {
  if (token === null) {
    const { getDecryptedAccessToken } = require("@/lib/workflows/actions/core/getDecryptedAccessToken")
    ;(getDecryptedAccessToken as jest.Mock).mockRejectedValueOnce(
      new Error("Failed to retrieve access token"),
    )
  } else {
    mockTokenValue = token
  }
}

/**
 * Configure the integration record returned by `getIntegrationById`. Pass
 * `null` to simulate a missing/disconnected integration.
 */
export function setMockIntegration(integration: any): void {
  mockIntegrationValue = integration
  const helpers = require("@/lib/workflows/integrationHelpers")
  ;(helpers.getIntegrationById as jest.Mock).mockResolvedValue(integration)
  const exec = require("@/lib/workflows/executeNode")
  ;(exec.getIntegrationById as jest.Mock).mockResolvedValue(integration)
}

const DEFAULT_INTEGRATION = {
  id: "integration-1",
  user_id: "user-1",
  provider: "shopify",
  status: "connected",
  access_token: "mock-token-12345",
  shop_domain: "test-shop.myshopify.com",
  metadata: { shop: "test-shop.myshopify.com" },
}
const DEFAULT_TOKEN = "mock-token-12345"

/**
 * Reset all harness state between tests. Call this in `afterEach`.
 *
 * Note: jest.clearAllMocks() clears call history but does NOT reset mock
 * implementations. Tests can override the integration/token mock per-test
 * (e.g., via setMockIntegration), so we explicitly re-establish the default
 * implementation here to keep tests isolated.
 */
export function resetHarness(): void {
  fetchMock.resetMocks()
  jest.clearAllMocks()
  mockTokenValue = DEFAULT_TOKEN
  mockIntegrationValue = DEFAULT_INTEGRATION
  const tokenMod = require("@/lib/workflows/actions/core/getDecryptedAccessToken")
  ;(tokenMod.getDecryptedAccessToken as jest.Mock).mockImplementation(
    async () => mockTokenValue,
  )
  const helpers = require("@/lib/workflows/integrationHelpers")
  ;(helpers.getIntegrationById as jest.Mock).mockImplementation(
    async () => mockIntegrationValue,
  )
  const exec = require("@/lib/workflows/executeNode")
  ;(exec.getIntegrationById as jest.Mock).mockImplementation(
    async () => mockIntegrationValue,
  )
}

export interface CapturedFetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body: any
}

/**
 * Return the captured outbound fetch calls in invocation order, with body
 * parsed as JSON when possible (falling back to the raw string).
 */
export function getFetchCalls(): CapturedFetchCall[] {
  return fetchMock.mock.calls.map(([url, init]) => {
    const opts = (init || {}) as RequestInit
    const rawHeaders = (opts.headers || {}) as Record<string, string> | Headers
    const headers: Record<string, string> = {}
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((v, k) => {
        headers[k.toLowerCase()] = v
      })
    } else {
      for (const [k, v] of Object.entries(rawHeaders)) {
        headers[k.toLowerCase()] = String(v)
      }
    }

    let body: any = opts.body
    if (typeof body === "string") {
      try {
        body = JSON.parse(body)
      } catch {
        // not JSON — leave as string (e.g. URL-encoded Stripe body)
      }
    }

    return {
      url: String(url),
      method: (opts.method || "GET").toUpperCase(),
      headers,
      body,
    }
  })
}

/**
 * Assert that a fetch call matching the given criteria was made. Returns the
 * matching call so the test can do follow-up assertions on its body shape.
 */
export function assertFetchCalled(criteria: {
  method?: string
  url?: string | RegExp
  bodyContains?: Record<string, any>
  headerContains?: Record<string, string>
}): CapturedFetchCall {
  const calls = getFetchCalls()
  const matches = calls.filter((call) => {
    if (criteria.method && call.method !== criteria.method.toUpperCase()) return false
    if (criteria.url) {
      if (typeof criteria.url === "string" && !call.url.includes(criteria.url)) return false
      if (criteria.url instanceof RegExp && !criteria.url.test(call.url)) return false
    }
    if (criteria.bodyContains) {
      for (const [key, expected] of Object.entries(criteria.bodyContains)) {
        const actual = typeof call.body === "object" ? call.body?.[key] : undefined
        if (JSON.stringify(actual) !== JSON.stringify(expected)) return false
      }
    }
    if (criteria.headerContains) {
      for (const [key, expected] of Object.entries(criteria.headerContains)) {
        if (!call.headers[key.toLowerCase()]?.includes(expected)) return false
      }
    }
    return true
  })

  if (matches.length === 0) {
    throw new Error(
      `Expected a fetch call matching ${JSON.stringify(criteria)}, but got:\n` +
        calls
          .map((c, i) => `  [${i}] ${c.method} ${c.url}`)
          .join("\n") || "  (no fetch calls)",
    )
  }
  return matches[0]
}

/**
 * Build a minimal ExecutionContext for handlers that take `(config, context)`
 * (e.g., the loop handler).
 */
export function makeContext(overrides: Partial<{
  userId: string
  workflowId: string
  testMode: boolean
  data: Record<string, any>
  variables: Record<string, any>
  results: Record<string, any>
}> = {}): any {
  return {
    userId: overrides.userId ?? "user-1",
    workflowId: overrides.workflowId ?? "wf-1",
    testMode: overrides.testMode ?? false,
    data: overrides.data ?? {},
    variables: overrides.variables ?? {},
    results: overrides.results ?? {},
    dataFlowManager: {
      resolveVariable: (v: any) => v,
      getNodeOutput: () => ({}),
      setNodeOutput: () => {},
      getTriggerData: () => ({}),
    },
  }
}
