/**
 * Contract: isOriginAllowed, getCorsHeaders, handleCorsPreFlight
 * Source: lib/utils/cors.ts
 * Style: pure-function tests with real NextRequest inputs; no mocks of the function under test.
 *        process.env.NODE_ENV is mutated per-test and restored afterwards. Because the
 *        module's ALLOWED_ORIGINS list is built at import time, we use jest.isolateModules
 *        to load a fresh copy of the module under each NODE_ENV scenario.
 * Pairs every happy-path case with a failure-path or edge case.
 */

import type { NextRequest as NextRequestType } from "next/server"

const originalEnv = { ...process.env }

beforeEach(() => {
  // Ensure no NGROK_URL leaks into the import-time-frozen ALLOWED_ORIGINS list.
  delete process.env.NGROK_URL
})

afterEach(() => {
  // Restore env state.
  if (originalEnv.NODE_ENV === undefined) {
    delete (process.env as Record<string, string | undefined>).NODE_ENV
  } else {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = originalEnv.NODE_ENV
  }
  if (originalEnv.NGROK_URL === undefined) {
    delete process.env.NGROK_URL
  } else {
    process.env.NGROK_URL = originalEnv.NGROK_URL
  }
  jest.resetModules()
})

function loadCorsModuleAs(env: "development" | "production" | "test") {
  ;(process.env as Record<string, string | undefined>).NODE_ENV = env
  let mod: typeof import("@/lib/utils/cors") | undefined
  jest.isolateModules(() => {
    mod = require("@/lib/utils/cors")
  })
  if (!mod) throw new Error("failed to load cors module")
  return mod
}

function makeRequest(origin: string | null, url = "https://chainreact.app/api/foo"): NextRequestType {
  const headers: Record<string, string> = {}
  if (origin !== null) headers.origin = origin
  // NextRequest is structurally compatible with the parts of `Request` the cors
  // helpers use (`request.headers.get`).
  return new Request(url, { headers }) as unknown as NextRequestType
}

// Bug class: look-alike origin acceptance — wrong scheme, trailing slash,
// or look-alike subdomain must NOT match the whitelist.
describe("isOriginAllowed — production whitelist", () => {
  test("allows the apex chainreact.app HTTPS origin", () => {
    const { isOriginAllowed } = loadCorsModuleAs("production")
    expect(isOriginAllowed("https://chainreact.app")).toBe(true)
  })

  test("allows the www.chainreact.app HTTPS origin", () => {
    const { isOriginAllowed } = loadCorsModuleAs("production")
    expect(isOriginAllowed("https://www.chainreact.app")).toBe(true)
  })

  test("rejects null origin", () => {
    const { isOriginAllowed } = loadCorsModuleAs("production")
    expect(isOriginAllowed(null)).toBe(false)
  })

  test("rejects http://chainreact.app (wrong scheme)", () => {
    const { isOriginAllowed } = loadCorsModuleAs("production")
    expect(isOriginAllowed("http://chainreact.app")).toBe(false)
  })

  test("rejects trailing-slash variant of allowed origin", () => {
    const { isOriginAllowed } = loadCorsModuleAs("production")
    expect(isOriginAllowed("https://chainreact.app/")).toBe(false)
  })

  test("rejects look-alike subdomain", () => {
    const { isOriginAllowed } = loadCorsModuleAs("production")
    expect(isOriginAllowed("https://evil.chainreact.app")).toBe(false)
  })

  test("rejects http://localhost:3000 in production", () => {
    const { isOriginAllowed } = loadCorsModuleAs("production")
    expect(isOriginAllowed("http://localhost:3000")).toBe(false)
  })

  test("rejects ngrok origins in production", () => {
    const { isOriginAllowed } = loadCorsModuleAs("production")
    expect(isOriginAllowed("https://abc-123.ngrok-free.app")).toBe(false)
  })
})

// Bug class: malformed origin acceptance — a non-browser client can put
// anything in the header. The whitelist must reject every non-canonical
// shape (port, userinfo, path, wildcard, padding).
describe("isOriginAllowed — adversarial origin shapes", () => {
  // Origins are required by the spec to be exactly `scheme://host[:port]` —
  // no userinfo, no path, no query. Browsers send well-formed origins, but a
  // malicious client (or a non-browser HTTP library) can put anything in the
  // header. The whitelist must reject everything that isn't an exact match.

  test("rejects origin with non-matching port (https://chainreact.app:8080)", () => {
    const { isOriginAllowed } = loadCorsModuleAs("production")
    expect(isOriginAllowed("https://chainreact.app:8080")).toBe(false)
  })

  test("rejects origin containing userinfo (https://user@chainreact.app)", () => {
    const { isOriginAllowed } = loadCorsModuleAs("production")
    expect(isOriginAllowed("https://user@chainreact.app")).toBe(false)
    expect(isOriginAllowed("https://user:pass@chainreact.app")).toBe(false)
  })

  test("rejects origin containing a path (https://chainreact.app/login)", () => {
    const { isOriginAllowed } = loadCorsModuleAs("production")
    expect(isOriginAllowed("https://chainreact.app/login")).toBe(false)
  })

  test("rejects literal '*' (must never wildcard with credentials)", () => {
    const { isOriginAllowed } = loadCorsModuleAs("production")
    expect(isOriginAllowed("*")).toBe(false)
  })

  test("rejects empty-string origin", () => {
    const { isOriginAllowed } = loadCorsModuleAs("production")
    expect(isOriginAllowed("")).toBe(false)
  })

  test("rejects origin with whitespace padding", () => {
    const { isOriginAllowed } = loadCorsModuleAs("production")
    expect(isOriginAllowed(" https://chainreact.app")).toBe(false)
    expect(isOriginAllowed("https://chainreact.app ")).toBe(false)
  })
})

// Bug class: ngrok regex injection — an unanchored regex would let an
// attacker register a domain whose name contains `.ngrok-free.app` and
// pass the dev-only allowlist.
describe("isOriginAllowed — development additions", () => {
  test("allows http://localhost:3000 in development", () => {
    const { isOriginAllowed } = loadCorsModuleAs("development")
    expect(isOriginAllowed("http://localhost:3000")).toBe(true)
  })

  test("allows http://127.0.0.1:3000 in development", () => {
    const { isOriginAllowed } = loadCorsModuleAs("development")
    expect(isOriginAllowed("http://127.0.0.1:3000")).toBe(true)
  })

  test("allows ngrok-free.app subdomains in development", () => {
    const { isOriginAllowed } = loadCorsModuleAs("development")
    expect(isOriginAllowed("https://abc-123.ngrok-free.app")).toBe(true)
  })

  test("rejects ngrok suffix-injection (regex must be anchored at end)", () => {
    // If an attacker registers `evil.com` and points a subdomain at our app, the
    // regex must NOT match `https://valid.ngrok-free.app.evil.com`.
    const { isOriginAllowed } = loadCorsModuleAs("development")
    expect(isOriginAllowed("https://valid.ngrok-free.app.evil.com")).toBe(false)
  })

  test("rejects ngrok prefix-injection (regex must be anchored at start)", () => {
    const { isOriginAllowed } = loadCorsModuleAs("development")
    expect(isOriginAllowed("https://attacker.com#https://abc.ngrok-free.app")).toBe(false)
  })

  test("rejects http (not https) ngrok URL", () => {
    const { isOriginAllowed } = loadCorsModuleAs("development")
    expect(isOriginAllowed("http://abc.ngrok-free.app")).toBe(false)
  })
})

// Bug class: CORS misconfiguration — credentials must only be set when
// caller asks AND the origin is trusted. Custom method/maxAge options
// must not silently drop the contract.
describe("getCorsHeaders — trusted origins", () => {
  test("sets Access-Control-Allow-Origin for trusted origin", () => {
    const { getCorsHeaders } = loadCorsModuleAs("production")
    const headers = getCorsHeaders(makeRequest("https://chainreact.app"))
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://chainreact.app")
  })

  test("sets Allow-Credentials only when allowCredentials option is true", () => {
    const { getCorsHeaders } = loadCorsModuleAs("production")
    const withCreds = getCorsHeaders(makeRequest("https://chainreact.app"), {
      allowCredentials: true,
    })
    const withoutCreds = getCorsHeaders(makeRequest("https://chainreact.app"))
    expect(withCreds["Access-Control-Allow-Credentials"]).toBe("true")
    expect(withoutCreds["Access-Control-Allow-Credentials"]).toBeUndefined()
  })

  test("respects custom allowedMethods option", () => {
    const { getCorsHeaders } = loadCorsModuleAs("production")
    const headers = getCorsHeaders(makeRequest("https://chainreact.app"), {
      allowedMethods: ["GET", "POST"],
    })
    expect(headers["Access-Control-Allow-Methods"]).toBe("GET, POST")
  })

  test("respects custom maxAge option", () => {
    const { getCorsHeaders } = loadCorsModuleAs("production")
    const headers = getCorsHeaders(makeRequest("https://chainreact.app"), {
      maxAge: 60,
    })
    expect(headers["Access-Control-Max-Age"]).toBe("60")
  })
})

// Bug class: credential leak to attacker origin — the OWASP-classic CORS
// bug. A refactor that moves the credentials line outside the trusted-origin
// guard would let an attacker page send authenticated requests with cookies.
describe("getCorsHeaders — untrusted origins are NOT given CORS access", () => {
  test("omits Access-Control-Allow-Origin for untrusted origin", () => {
    const { getCorsHeaders } = loadCorsModuleAs("production")
    const headers = getCorsHeaders(makeRequest("https://attacker.com"))
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined()
  })

  test("omits Allow-Credentials even when explicitly requested by caller", () => {
    // Critical regression guard: a refactor that moves the credentials line out
    // of the `if (isOriginAllowed)` branch would let an attacker origin send
    // cookies. This test fails if that happens.
    const { getCorsHeaders } = loadCorsModuleAs("production")
    const headers = getCorsHeaders(makeRequest("https://attacker.com"), {
      allowCredentials: true,
    })
    expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined()
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined()
  })

  test("omits Access-Control-* when origin header is missing entirely", () => {
    const { getCorsHeaders } = loadCorsModuleAs("production")
    const headers = getCorsHeaders(makeRequest(null))
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined()
    expect(headers["Access-Control-Allow-Methods"]).toBeUndefined()
    expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined()
  })
})

// Bug class: silent CSP/HSTS regression — security headers must NOT be
// gated behind the CORS origin check. Browsers honour them on every
// response, so a regression here weakens defenses without any visible
// failure mode in normal use.
describe("getCorsHeaders — security headers always present", () => {
  // These tests catch regressions where security headers get gated behind the
  // CORS origin check. Browsers honour HSTS, CSP, X-Frame-Options, etc. on every
  // response — they must NOT depend on whether the origin is whitelisted.

  test("emits HSTS, CSP, nosniff, and frame protections for trusted origin", () => {
    const { getCorsHeaders } = loadCorsModuleAs("production")
    const headers = getCorsHeaders(makeRequest("https://chainreact.app"))
    expect(headers["Strict-Transport-Security"]).toContain("max-age=")
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'")
    expect(headers["X-Content-Type-Options"]).toBe("nosniff")
    expect(headers["X-Frame-Options"]).toBe("DENY")
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin")
  })

  test("emits the same security headers even for an untrusted origin", () => {
    const { getCorsHeaders } = loadCorsModuleAs("production")
    const headers = getCorsHeaders(makeRequest("https://attacker.com"))
    expect(headers["Strict-Transport-Security"]).toContain("max-age=")
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'")
    expect(headers["X-Content-Type-Options"]).toBe("nosniff")
    expect(headers["X-Frame-Options"]).toBe("DENY")
  })

  test("emits the same security headers when origin is missing", () => {
    const { getCorsHeaders } = loadCorsModuleAs("production")
    const headers = getCorsHeaders(makeRequest(null))
    expect(headers["X-Content-Type-Options"]).toBe("nosniff")
    expect(headers["X-Frame-Options"]).toBe("DENY")
    expect(headers["Strict-Transport-Security"]).toContain("max-age=")
  })

  test("forbids caching of API responses (sensitive/user data)", () => {
    const { getCorsHeaders } = loadCorsModuleAs("production")
    const headers = getCorsHeaders(makeRequest("https://chainreact.app"))
    expect(headers["Cache-Control"]).toContain("no-store")
    expect(headers["Pragma"]).toBe("no-cache")
  })
})

// Bug class: preflight credential leak — the OPTIONS preflight must apply
// the same trusted-origin rules as the main response.
describe("handleCorsPreFlight", () => {
  test("returns 204 for a trusted origin", () => {
    const { handleCorsPreFlight } = loadCorsModuleAs("production")
    const response = handleCorsPreFlight(makeRequest("https://chainreact.app"))
    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://chainreact.app",
    )
  })

  test("returns 204 for an untrusted origin but withholds CORS headers", () => {
    // Returning 204 without Access-Control-Allow-Origin causes the browser's
    // preflight to fail (which is the correct behaviour), but importantly we
    // must still NOT leak credentials or trust to an attacker origin.
    const { handleCorsPreFlight } = loadCorsModuleAs("production")
    const response = handleCorsPreFlight(makeRequest("https://attacker.com"), {
      allowCredentials: true,
    })
    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull()
  })

  test("emits security headers on the preflight response itself", () => {
    const { handleCorsPreFlight } = loadCorsModuleAs("production")
    const response = handleCorsPreFlight(makeRequest("https://chainreact.app"))
    expect(response.headers.get("X-Frame-Options")).toBe("DENY")
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'")
  })
})
