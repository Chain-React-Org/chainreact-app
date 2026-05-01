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

// ─── PR-C3 — token refresh + health engine fixtures ────────────────────────
//
// `refreshAndRetry` calls these two boundaries on a 401. Mock them at the
// module level so per-test hooks can drive both behaviors uniformly:
//   - `setMockTokenRefreshOutcome('success' | 'permanent_401')` controls
//     what `tokenRefreshService.refresh` returns when the wrapper invokes it.
//   - `getHealthEngineCalls()` returns the captured signal payloads passed
//     to `computeTransitionAndNotify` (so tests can assert
//     `classifiedError.requiresUserAction`, etc.).
//
// Both default to "success" / silent capture. Tests opt in.

let mockRefreshOutcome: "success" | "permanent_401" = "success"

jest.mock("@/lib/integrations/tokenRefreshService", () => ({
  refresh: jest.fn(async (provider: string, _userId: string) => {
    if (mockRefreshOutcome === "permanent_401") {
      return {
        success: false,
        error: "invalid_grant",
        statusCode: 400,
        needsReauthorization: true,
        classifiedError: {
          code: "invalid_grant",
          isRecoverable: false,
          requiresUserAction: true,
          userActionType: "reconnect",
          message: "Authentication expired. Please reconnect your account.",
        },
      }
    }
    return {
      success: true,
      accessToken: `mock-refreshed-token-for-${provider}`,
      accessTokenExpiresIn: 3600,
    }
  }),
  // The wrapper in `tokenRefreshService.ts` also re-exports the lower-level
  // helpers; nothing else in the harness uses them, so stub minimally.
  refreshTokenForProvider: jest.fn(),
  shouldRefreshToken: jest.fn(),
  TokenRefreshService: {},
}))

const healthEngineCallLog: Array<{
  integration: any
  signal: any
}> = []

jest.mock("@/lib/integrations/healthTransitionEngine", () => ({
  computeTransitionAndNotify: jest.fn(async (_supabase: any, integration: any, signal: any) => {
    healthEngineCallLog.push({ integration, signal })
    return { stateChanged: true }
  }),
}))

// ─── PR-C4 — session_side_effects idempotency fixtures ─────────────────
//
// Mock `checkReplay` / `recordFired` at the module level so handlers can
// be exercised under the three Q4 outcomes without touching the DB.
//
//   - `seedSessionFired({ executionSessionId, nodeId, actionType,
//      payloadHash, result, externalId? })` registers a stored row. The
//      next `checkReplay` matching that key returns either `cached`
//      (matching incoming payloadHash) or `mismatch` (different).
//   - `setSessionReplayOutcome(key, 'fresh' | 'mismatch')` overrides
//      the next call to `checkReplay` matching `key`, independent of
//      seeded rows. Useful for force-mismatch tests that don't want to
//      construct a full snapshot.
//   - `getSessionRecordCalls()` returns the captured `recordFired`
//      payloads in invocation order so tests can assert that the
//      handler wrote the marker.
//
// All state lives in module-scoped maps; `resetHarness()` clears them.

interface SessionSideEffectFixture {
  result: any
  payloadHash: string
  externalId?: string | null
}

const sessionSideEffectStore = new Map<string, SessionSideEffectFixture>()
const sessionForcedOutcomes = new Map<string, "fresh" | "mismatch">()
const sessionRecordCalls: Array<{
  key: any
  result: any
  payloadHash: string
  options?: any
}> = []

function sessionKeyString(key: {
  executionSessionId: string
  nodeId: string
  actionType: string
}): string {
  return `${key.executionSessionId}:${key.nodeId}:${key.actionType}`
}

jest.mock("@/lib/workflows/actions/core/sessionSideEffects", () => ({
  checkReplay: jest.fn(async (key: any, payloadHash: string) => {
    const k = sessionKeyString(key)
    const forced = sessionForcedOutcomes.get(k)
    if (forced) {
      sessionForcedOutcomes.delete(k)
      if (forced === "mismatch") {
        return { kind: "mismatch", storedHash: "forced-mismatch" }
      }
      return { kind: "fresh" }
    }
    const fixture = sessionSideEffectStore.get(k)
    if (!fixture) return { kind: "fresh" }
    if (fixture.payloadHash !== payloadHash) {
      return { kind: "mismatch", storedHash: fixture.payloadHash }
    }
    return { kind: "cached", result: fixture.result }
  }),
  recordFired: jest.fn(
    async (key: any, result: any, payloadHash: string, options?: any) => {
      sessionRecordCalls.push({ key, result, payloadHash, options })
      // Mirror real behaviour: subsequent checkReplay sees the recorded row.
      sessionSideEffectStore.set(sessionKeyString(key), {
        result,
        payloadHash,
        externalId: options?.externalId ?? null,
      })
    },
  ),
}))

// Stub admin Supabase client so `refreshAndRetry`'s default integration
// lookup returns a row matching the harness's mock integration. Tests that
// override the integration via `setMockIntegration` are reflected here too.
jest.mock("@/lib/supabase/admin", () => ({
  createAdminClient: jest.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({ data: mockIntegrationValue, error: null }),
          }),
          single: async () => ({ data: mockIntegrationValue, error: null }),
        }),
      }),
    }),
  })),
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
 * PR-C3 — control what `tokenRefreshService.refresh` returns when
 * `refreshAndRetry` invokes it during a 401 recovery attempt.
 *
 *   - `'success'` (default): refresh returns a new access token; the
 *     wrapper retries the original call once with the refreshed token.
 *   - `'permanent_401'`: refresh returns a classified `invalid_grant`
 *     failure; the wrapper does NOT retry and emits a `token_revoked`
 *     health signal.
 */
export function setMockTokenRefreshOutcome(outcome: "success" | "permanent_401"): void {
  mockRefreshOutcome = outcome
}

/**
 * PR-C3 — return the captured `computeTransitionAndNotify` invocations in
 * call order. Each entry holds the `integration` row + `signal` payload
 * (`{ classifiedError, source, isRecovery }`). Tests assert on
 * `signal.classifiedError.requiresUserAction`, etc.
 */
export function getHealthEngineCalls(): Array<{
  integration: any
  signal: any
}> {
  return [...healthEngineCallLog]
}

// ─── PR-C4 — session_side_effects public API ───────────────────────────

export interface SessionSideEffectKey {
  executionSessionId: string
  nodeId: string
  actionType: string
}

/**
 * PR-C4 — pre-populate the in-memory session_side_effects store with a
 * stored marker. The next `checkReplay` invoked by the handler under
 * test for the matching `(executionSessionId, nodeId, actionType)`
 * tuple returns:
 *   - `{kind: 'cached', result}` when the handler computes the same
 *     `payloadHash` (Q4 — replay path; no provider call should fire),
 *   - `{kind: 'mismatch', storedHash}` when the handler computes a
 *     different `payloadHash` (Q4 — PAYLOAD_MISMATCH; no provider
 *     call should fire).
 */
export function seedSessionFired(opts: {
  executionSessionId: string
  nodeId: string
  actionType: string
  payloadHash: string
  result: any
  externalId?: string | null
}): void {
  const key: SessionSideEffectKey = {
    executionSessionId: opts.executionSessionId,
    nodeId: opts.nodeId,
    actionType: opts.actionType,
  }
  sessionSideEffectStore.set(sessionKeyString(key), {
    result: opts.result,
    payloadHash: opts.payloadHash,
    externalId: opts.externalId ?? null,
  })
}

/**
 * PR-C4 — force the next `checkReplay` for the supplied key to return
 * the given outcome, regardless of any seeded row. Useful for tests
 * that want to assert PAYLOAD_MISMATCH branching without computing a
 * full mismatching hash.
 */
export function setSessionReplayOutcome(
  key: SessionSideEffectKey,
  outcome: "fresh" | "mismatch",
): void {
  sessionForcedOutcomes.set(sessionKeyString(key), outcome)
}

/**
 * PR-C4 — return the captured `recordFired` invocations in call order
 * so tests can assert the handler persisted the side-effect marker
 * with the expected key, payloadHash, externalId, and result snapshot.
 */
export function getSessionRecordCalls(): Array<{
  key: any
  result: any
  payloadHash: string
  options?: any
}> {
  return [...sessionRecordCalls]
}

/**
 * PR-C4 — convenience builder for the meta param every test passes to
 * a handler. Returns the canonical `HandlerExecutionMeta` shape so
 * call-sites stay tidy.
 */
export function makeMeta(overrides: Partial<{
  executionSessionId: string
  nodeId: string
  actionType: string
  provider: string
  testMode: boolean
}> = {}): {
  executionSessionId: string
  nodeId: string
  actionType: string
  provider?: string
  testMode?: boolean
} {
  return {
    executionSessionId: overrides.executionSessionId ?? "session-test-1",
    nodeId: overrides.nodeId ?? "node-test-1",
    actionType: overrides.actionType ?? "unspecified_action_type",
    provider: overrides.provider,
    testMode: overrides.testMode,
  }
}

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
  mockRefreshOutcome = "success"
  healthEngineCallLog.length = 0
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

  // PR-C4 — clear session_side_effects fixtures.
  sessionSideEffectStore.clear()
  sessionForcedOutcomes.clear()
  sessionRecordCalls.length = 0
  const sseMod = require("@/lib/workflows/actions/core/sessionSideEffects")
  ;(sseMod.checkReplay as jest.Mock).mockImplementation(
    async (key: any, payloadHash: string) => {
      const k = sessionKeyString(key)
      const forced = sessionForcedOutcomes.get(k)
      if (forced) {
        sessionForcedOutcomes.delete(k)
        if (forced === "mismatch") {
          return { kind: "mismatch", storedHash: "forced-mismatch" }
        }
        return { kind: "fresh" }
      }
      const fixture = sessionSideEffectStore.get(k)
      if (!fixture) return { kind: "fresh" }
      if (fixture.payloadHash !== payloadHash) {
        return { kind: "mismatch", storedHash: fixture.payloadHash }
      }
      return { kind: "cached", result: fixture.result }
    },
  )
  ;(sseMod.recordFired as jest.Mock).mockImplementation(
    async (key: any, result: any, payloadHash: string, options?: any) => {
      sessionRecordCalls.push({ key, result, payloadHash, options })
      sessionSideEffectStore.set(sessionKeyString(key), {
        result,
        payloadHash,
        externalId: options?.externalId ?? null,
      })
    },
  )

  // Re-establish refresh / health-engine mock implementations cleared by
  // jest.clearAllMocks().
  const tokenRefreshMod = require("@/lib/integrations/tokenRefreshService")
  ;(tokenRefreshMod.refresh as jest.Mock).mockImplementation(
    async (provider: string, _userId: string) => {
      if (mockRefreshOutcome === "permanent_401") {
        return {
          success: false,
          error: "invalid_grant",
          statusCode: 400,
          needsReauthorization: true,
          classifiedError: {
            code: "invalid_grant",
            isRecoverable: false,
            requiresUserAction: true,
            userActionType: "reconnect",
            message: "Authentication expired. Please reconnect your account.",
          },
        }
      }
      return {
        success: true,
        accessToken: `mock-refreshed-token-for-${provider}`,
        accessTokenExpiresIn: 3600,
      }
    },
  )
  const healthMod = require("@/lib/integrations/healthTransitionEngine")
  ;(healthMod.computeTransitionAndNotify as jest.Mock).mockImplementation(
    async (_supabase: any, integration: any, signal: any) => {
      healthEngineCallLog.push({ integration, signal })
      return { stateChanged: true }
    },
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
