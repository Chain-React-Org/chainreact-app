/**
 * Contract: requireCronAuth
 * Source: lib/utils/cron-auth.ts
 * Style: pure-function tests with real Request inputs; no mocks of the function under test.
 *        Only true external boundaries (process.env, logger) are replaced.
 * Pairs every happy-path case with a failure-path or edge case.
 */

// NextResponse.json() (used by errorResponse) calls the static Response.json()
// web API. The Jest Node environment may not expose it depending on the runtime,
// so polyfill before importing the module under test.
if (typeof (Response as any).json !== "function") {
  ;(Response as any).json = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), {
      ...init,
      headers: {
        "content-type": "application/json",
        ...((init?.headers ?? {}) as Record<string, string>),
      },
    })
}

jest.mock("@/lib/utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

import { requireCronAuth } from "@/lib/utils/cron-auth"

const SECRET_ENV_KEYS = ["ADMIN_SECRET", "CRON_SECRET", "ADMIN_API_KEY"] as const

const originalEnv = { ...process.env }

beforeEach(() => {
  // Reset every secret env to undefined so each test starts from a known baseline.
  for (const key of SECRET_ENV_KEYS) {
    delete process.env[key]
  }
})

afterEach(() => {
  // Restore every secret env after the test runs.
  for (const key of SECRET_ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalEnv[key]
    }
  }
})

function makeRequest(
  init: { headers?: Record<string, string>; query?: string } = {},
): Request {
  const url = `https://chainreact.app/api/cron/test${init.query ?? ""}`
  return new Request(url, { headers: init.headers ?? {} })
}

// Bug class: cron transport regression — dropping any of x-admin-key /
// Authorization / ?secret breaks Vercel cron, GitHub Actions, or manual
// trigger flows respectively.
describe("requireCronAuth — accepted transports", () => {
  test("authorizes via x-admin-key header when value matches ADMIN_SECRET", () => {
    process.env.ADMIN_SECRET = "admin-secret-1"
    const req = makeRequest({ headers: { "x-admin-key": "admin-secret-1" } })
    const result = requireCronAuth(req)
    expect(result.authorized).toBe(true)
  })

  test("authorizes via Authorization Bearer token", () => {
    process.env.CRON_SECRET = "cron-secret-2"
    const req = makeRequest({
      headers: { authorization: "Bearer cron-secret-2" },
    })
    const result = requireCronAuth(req)
    expect(result.authorized).toBe(true)
  })

  test("authorizes via ?secret query param", () => {
    process.env.ADMIN_API_KEY = "api-key-3"
    const req = makeRequest({ query: "?secret=api-key-3" })
    const result = requireCronAuth(req)
    expect(result.authorized).toBe(true)
  })

  test("Bearer prefix is case-insensitive (lower-case bearer works)", () => {
    process.env.CRON_SECRET = "cron-secret-2"
    const req = makeRequest({
      headers: { authorization: "bearer cron-secret-2" },
    })
    const result = requireCronAuth(req)
    expect(result.authorized).toBe(true)
  })

  test("Bearer prefix is case-insensitive (mixed-case BeArEr works)", () => {
    process.env.CRON_SECRET = "cron-secret-2"
    const req = makeRequest({
      headers: { authorization: "BeArEr cron-secret-2" },
    })
    const result = requireCronAuth(req)
    expect(result.authorized).toBe(true)
  })
})

// Bug class: deployment lockout — each of ADMIN_SECRET / CRON_SECRET /
// ADMIN_API_KEY must be independently sufficient so partial-rotation
// deployments don't lock out cron.
describe("requireCronAuth — each env var is independently accepted", () => {
  test("ADMIN_SECRET alone is sufficient", () => {
    process.env.ADMIN_SECRET = "only-admin-secret"
    const req = makeRequest({ headers: { "x-admin-key": "only-admin-secret" } })
    expect(requireCronAuth(req).authorized).toBe(true)
  })

  test("CRON_SECRET alone is sufficient", () => {
    process.env.CRON_SECRET = "only-cron-secret"
    const req = makeRequest({ headers: { "x-admin-key": "only-cron-secret" } })
    expect(requireCronAuth(req).authorized).toBe(true)
  })

  test("ADMIN_API_KEY alone is sufficient", () => {
    process.env.ADMIN_API_KEY = "only-api-key"
    const req = makeRequest({ headers: { "x-admin-key": "only-api-key" } })
    expect(requireCronAuth(req).authorized).toBe(true)
  })
})

// Bug class: auth bypass via empty-string match, and silent allow on server
// misconfiguration. Both must fail closed.
describe("requireCronAuth — rejection paths", () => {
  test("returns 500 when no secrets are configured (server misconfiguration)", async () => {
    // All three env vars are deleted by beforeEach.
    const req = makeRequest({ headers: { "x-admin-key": "anything" } })
    const result = requireCronAuth(req)
    expect(result.authorized).toBe(false)
    if (result.authorized) throw new Error("expected unauthorized")
    expect(result.response.status).toBe(500)
  })

  test("returns 401 when valid secret is configured but no header is supplied", async () => {
    process.env.ADMIN_SECRET = "real-secret"
    const req = makeRequest()
    const result = requireCronAuth(req)
    expect(result.authorized).toBe(false)
    if (result.authorized) throw new Error("expected unauthorized")
    expect(result.response.status).toBe(401)
  })

  test("returns 401 when wrong secret is supplied in x-admin-key", async () => {
    process.env.ADMIN_SECRET = "real-secret"
    const req = makeRequest({ headers: { "x-admin-key": "wrong-secret" } })
    const result = requireCronAuth(req)
    expect(result.authorized).toBe(false)
    if (result.authorized) throw new Error("expected unauthorized")
    expect(result.response.status).toBe(401)
  })

  test("returns 401 when wrong secret is supplied in Authorization Bearer", async () => {
    process.env.CRON_SECRET = "real-secret"
    const req = makeRequest({ headers: { authorization: "Bearer wrong" } })
    const result = requireCronAuth(req)
    expect(result.authorized).toBe(false)
    if (result.authorized) throw new Error("expected unauthorized")
    expect(result.response.status).toBe(401)
  })

  test("returns 401 when wrong secret is supplied in ?secret query param", async () => {
    process.env.ADMIN_API_KEY = "real-secret"
    const req = makeRequest({ query: "?secret=wrong" })
    const result = requireCronAuth(req)
    expect(result.authorized).toBe(false)
    if (result.authorized) throw new Error("expected unauthorized")
    expect(result.response.status).toBe(401)
  })

  test("empty x-admin-key value does NOT match an undefined env var", async () => {
    // Critical guard: if validSecrets ever contained "" via a buggy filter,
    // an attacker could send `x-admin-key: ""` and pass auth.
    process.env.ADMIN_SECRET = "real-secret"
    const req = makeRequest({ headers: { "x-admin-key": "" } })
    const result = requireCronAuth(req)
    expect(result.authorized).toBe(false)
    if (result.authorized) throw new Error("expected unauthorized")
    expect(result.response.status).toBe(401)
  })

  test("empty Bearer token does NOT match an undefined env var", async () => {
    process.env.ADMIN_SECRET = "real-secret"
    const req = makeRequest({ headers: { authorization: "Bearer " } })
    const result = requireCronAuth(req)
    expect(result.authorized).toBe(false)
    if (result.authorized) throw new Error("expected unauthorized")
    expect(result.response.status).toBe(401)
  })

  test("Bearer prefix with extra whitespace is tolerated", async () => {
    // Real-world clients sometimes emit `Bearer\t<token>` or double-space.
    // The current implementation uses /^Bearer\s+/i which handles this; pin
    // it as the contract so a refactor to a literal " " split doesn't silently
    // start rejecting valid clients.
    process.env.CRON_SECRET = "spaced-token"
    const req = makeRequest({
      headers: { authorization: "Bearer   spaced-token" },
    })
    const result = requireCronAuth(req)
    expect(result.authorized).toBe(true)
  })

  test("a configured-but-empty env var does not match an empty header", async () => {
    // An operator setting ADMIN_SECRET="" would normally be filtered out by
    // .filter(Boolean). Confirm that an empty header still 401s in that scenario.
    process.env.ADMIN_SECRET = ""
    process.env.CRON_SECRET = "real-cron"
    const req = makeRequest({ headers: { "x-admin-key": "" } })
    const result = requireCronAuth(req)
    expect(result.authorized).toBe(false)
    if (result.authorized) throw new Error("expected unauthorized")
    expect(result.response.status).toBe(401)
  })
})
