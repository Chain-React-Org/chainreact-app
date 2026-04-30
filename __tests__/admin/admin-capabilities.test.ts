/**
 * Contract: hasCapability, hasAnyCapability, validateCapabilities, isProfileAdmin
 * Source: lib/types/admin.ts
 * Style: pure-function tests with real inputs; no mocks of the function under test.
 * Pairs every happy-path case with a failure-path or edge case.
 */

import {
  hasCapability,
  hasAnyCapability,
  validateCapabilities,
  isProfileAdmin,
  type AdminCapabilities,
} from "@/lib/types/admin"

// Explicit expected list (NOT imported from the source). If the source's
// ADMIN_CAPABILITIES drifts away from these four keys, this test fails — that
// is the signal we want, not a passive mirror of whatever the source declares.
const EXPECTED_CAPABILITIES = [
  "super_admin",
  "user_admin",
  "support_admin",
  "billing_admin",
] as const

// Bug class: permission escalation — a refactor that drops the super_admin
// short-circuit, or treats absent keys as granted, would silently change who
// can do what.
describe("hasCapability", () => {
  test("returns true when the exact capability is granted", () => {
    expect(hasCapability({ user_admin: true }, "user_admin")).toBe(true)
  })

  test("returns false when the capability is explicitly false", () => {
    expect(hasCapability({ user_admin: false }, "user_admin")).toBe(false)
  })

  test("returns false when the capability key is absent", () => {
    expect(hasCapability({ billing_admin: true }, "user_admin")).toBe(false)
  })

  test("super_admin grants user_admin even when user_admin is absent", () => {
    expect(hasCapability({ super_admin: true }, "user_admin")).toBe(true)
  })

  test("super_admin grants support_admin even when support_admin is explicitly false", () => {
    expect(
      hasCapability({ super_admin: true, support_admin: false }, "support_admin"),
    ).toBe(true)
  })

  test("super_admin grants billing_admin", () => {
    expect(hasCapability({ super_admin: true }, "billing_admin")).toBe(true)
  })

  test("explicitly-false super_admin does not short-circuit other capabilities", () => {
    expect(
      hasCapability({ super_admin: false, user_admin: true }, "user_admin"),
    ).toBe(true)
  })

  test("explicitly-false super_admin does not silently grant other capabilities", () => {
    expect(hasCapability({ super_admin: false }, "user_admin")).toBe(false)
  })

  test("returns false for null capabilities", () => {
    expect(hasCapability(null, "user_admin")).toBe(false)
  })

  test("returns false for undefined capabilities", () => {
    expect(hasCapability(undefined, "user_admin")).toBe(false)
  })

  test("returns false for empty capabilities object", () => {
    expect(hasCapability({}, "user_admin")).toBe(false)
  })
})

// Bug class: permission escalation via list-quantifier inversion (some/every).
describe("hasAnyCapability", () => {
  test("returns true when at least one capability matches", () => {
    expect(
      hasAnyCapability({ billing_admin: true }, ["user_admin", "billing_admin"]),
    ).toBe(true)
  })

  test("returns false when no capability matches", () => {
    expect(
      hasAnyCapability({ billing_admin: true }, ["user_admin", "support_admin"]),
    ).toBe(false)
  })

  test("returns false when required list is empty", () => {
    expect(hasAnyCapability({ super_admin: true }, [])).toBe(false)
  })

  test("super_admin satisfies any non-empty required list", () => {
    expect(
      hasAnyCapability({ super_admin: true }, ["user_admin", "support_admin", "billing_admin"]),
    ).toBe(true)
  })

  test("returns false for null capabilities even with non-empty required list", () => {
    expect(hasAnyCapability(null, ["user_admin"])).toBe(false)
  })
})

// Bug class: JSONB drift — a typo'd or wrong-type capability silently stored
// becomes a dead permission no `hasCapability` check will ever match.
describe("validateCapabilities", () => {
  test("accepts an object with only known capability keys", () => {
    const input = { super_admin: true, user_admin: false, billing_admin: true }
    expect(validateCapabilities(input)).toEqual(input)
  })

  test("accepts each of the four expected capabilities (drift detector)", () => {
    // Iterate the LITERAL expected list, not the source constant. This catches
    // a regression where a capability is renamed or removed from the source.
    for (const cap of EXPECTED_CAPABILITIES) {
      const input = { [cap]: true }
      expect(validateCapabilities(input)).toEqual(input)
    }
  })

  test("returns an empty object for an empty input (round-trip)", () => {
    expect(validateCapabilities({})).toEqual({})
  })

  test("throws when an unknown key is present, naming the offending key", () => {
    // Contract: error must identify which key was bad so operators can fix it.
    // We assert the key name appears, not the exact prose.
    expect(() =>
      validateCapabilities({ god_mode: true } as Record<string, unknown>),
    ).toThrow(/god_mode/)
  })

  test("throws when a typo'd known-looking key is present (catches JSONB drift)", () => {
    expect(() =>
      validateCapabilities({ super_amdin: true } as Record<string, unknown>),
    ).toThrow(/super_amdin/)
  })

  test("throws when a known key has a string value instead of boolean", () => {
    // Contract: must identify which key was bad. Loosened regex so the test
    // doesn't pin the exact error phrasing.
    expect(() =>
      validateCapabilities({ user_admin: "true" } as Record<string, unknown>),
    ).toThrow(/user_admin/)
  })

  test("throws when a known key has a numeric value instead of boolean", () => {
    expect(() =>
      validateCapabilities({ billing_admin: 1 } as Record<string, unknown>),
    ).toThrow(/billing_admin/)
  })

  test("throws when a known key has null value (null is not a boolean)", () => {
    expect(() =>
      validateCapabilities({ support_admin: null } as Record<string, unknown>),
    ).toThrow(/support_admin/)
  })

  test("capability keys are case-sensitive (USER_ADMIN is not user_admin)", () => {
    // Adversarial: an attacker / fat-finger that smuggles in a SHOUTY key
    // must not bypass the key check.
    expect(() =>
      validateCapabilities({ USER_ADMIN: true } as Record<string, unknown>),
    ).toThrow(/USER_ADMIN/)
  })
})

// Bug class: legacy auth bypass — re-enabling the deprecated `admin: true`
// boolean as a source of admin truth would let stale legacy accounts in.
describe("isProfileAdmin", () => {
  test("returns false for null profile", () => {
    expect(isProfileAdmin(null)).toBe(false)
  })

  test("returns false for undefined profile", () => {
    expect(isProfileAdmin(undefined)).toBe(false)
  })

  test("returns false for profile without admin_capabilities", () => {
    expect(isProfileAdmin({})).toBe(false)
  })

  test("returns false for profile with null admin_capabilities", () => {
    expect(isProfileAdmin({ admin_capabilities: null })).toBe(false)
  })

  test("returns false for profile with all-false capabilities", () => {
    const caps: AdminCapabilities = {
      super_admin: false,
      user_admin: false,
      support_admin: false,
      billing_admin: false,
    }
    expect(isProfileAdmin({ admin_capabilities: caps })).toBe(false)
  })

  test("returns true for profile with super_admin", () => {
    expect(isProfileAdmin({ admin_capabilities: { super_admin: true } })).toBe(true)
  })

  test("returns true for profile with any single true capability", () => {
    expect(isProfileAdmin({ admin_capabilities: { billing_admin: true } })).toBe(true)
  })

  test("legacy `admin: true` boolean WITHOUT capabilities does not confer admin", () => {
    // Per the type's source-of-truth comment: admin_capabilities is authoritative,
    // the legacy `admin` boolean is intentionally ignored by isProfileAdmin.
    const profile = { admin: true } as { admin_capabilities?: AdminCapabilities | null }
    expect(isProfileAdmin(profile)).toBe(false)
  })
})
