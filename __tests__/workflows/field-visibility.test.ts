/**
 * Contract: isFieldCurrentlyVisible, getMissingRequiredFields
 * Source: lib/workflows/validation/fieldVisibility.ts
 * Style: pure-function tests with real field/value inputs; no mocks of the
 *        function under test. Pairs every happy-path case with a failure-path
 *        or edge case.
 *
 * These two functions decide which config fields are required at save/publish.
 * A regression in either direction is user-visible: false-positive missing
 * fields block legitimate publishes; false-negatives let invalid configs ship.
 */

import {
  isFieldCurrentlyVisible,
  getMissingRequiredFields,
} from "@/lib/workflows/validation/fieldVisibility"

// Minimal field-shape helper. ValidationField is internal to fieldVisibility,
// so we build fields with the exact shape the code reads and cast at the call.
const f = (overrides: Record<string, any>): any => ({
  name: "field",
  type: "text",
  label: "Field",
  ...overrides,
})

// Bug class: hidden required field blocks publish — if a `type: "hidden"`
// field is ever marked visible, getMissingRequiredFields can demand a value
// the user can't enter, blocking the entire publish flow.
describe("isFieldCurrentlyVisible — type=hidden", () => {
  test("a field whose type is 'hidden' is never visible, regardless of values", () => {
    expect(isFieldCurrentlyVisible(f({ type: "hidden" }), {})).toBe(false)
    expect(isFieldCurrentlyVisible(f({ type: "hidden" }), { anything: "set" })).toBe(false)
  })

  test("a field whose type is 'text' (default) is visible without other rules", () => {
    expect(isFieldCurrentlyVisible(f({}), {})).toBe(true)
  })
})

// Bug class: always-visible fields silently hidden — a refactor that misses
// the "always" sentinel would hide fields that the node author explicitly
// declared unconditional.
describe("isFieldCurrentlyVisible — visibilityCondition=always", () => {
  test("'always' makes the field visible regardless of values", () => {
    const field = f({ visibilityCondition: "always" })
    expect(isFieldCurrentlyVisible(field, {})).toBe(true)
    expect(isFieldCurrentlyVisible(field, { other: "x" })).toBe(true)
  })
})

// Bug class: 0/false treated as empty — a numeric 0 or boolean false in a
// parent field would falsely hide its dependents, so users can't configure
// "minimum: 0" or boolean toggles.
describe("isFieldCurrentlyVisible — isNotEmpty / isEmpty", () => {
  const isNotEmpty = (depField: string) =>
    f({
      visibilityCondition: { field: depField, operator: "isNotEmpty" },
    })

  test("isNotEmpty: visible when parent has a non-empty string", () => {
    expect(isFieldCurrentlyVisible(isNotEmpty("parent"), { parent: "x" })).toBe(true)
  })

  test("isNotEmpty: hidden when parent is empty string", () => {
    expect(isFieldCurrentlyVisible(isNotEmpty("parent"), { parent: "" })).toBe(false)
  })

  test("isNotEmpty: hidden when parent is whitespace-only string", () => {
    expect(isFieldCurrentlyVisible(isNotEmpty("parent"), { parent: "   " })).toBe(false)
  })

  test("isNotEmpty: hidden when parent is null", () => {
    expect(isFieldCurrentlyVisible(isNotEmpty("parent"), { parent: null })).toBe(false)
  })

  test("isNotEmpty: hidden when parent is undefined (key missing)", () => {
    expect(isFieldCurrentlyVisible(isNotEmpty("parent"), {})).toBe(false)
  })

  test("isNotEmpty: hidden when parent is empty array", () => {
    expect(isFieldCurrentlyVisible(isNotEmpty("parent"), { parent: [] })).toBe(false)
  })

  test("isNotEmpty: hidden when parent is empty object", () => {
    expect(isFieldCurrentlyVisible(isNotEmpty("parent"), { parent: {} })).toBe(false)
  })

  test("isNotEmpty: visible when parent is the literal number 0 (0 is NOT empty)", () => {
    // Critical: a numeric field with value 0 must not be treated as empty,
    // otherwise a user setting "minimum: 0" can never reveal dependent fields.
    expect(isFieldCurrentlyVisible(isNotEmpty("parent"), { parent: 0 })).toBe(true)
  })

  test("isNotEmpty: visible when parent is the literal boolean false (false is NOT empty)", () => {
    expect(isFieldCurrentlyVisible(isNotEmpty("parent"), { parent: false })).toBe(true)
  })

  test("isEmpty: visible when parent is empty, hidden when populated", () => {
    const field = f({ visibilityCondition: { field: "parent", operator: "isEmpty" } })
    expect(isFieldCurrentlyVisible(field, { parent: "" })).toBe(true)
    expect(isFieldCurrentlyVisible(field, { parent: "x" })).toBe(false)
  })
})

// Bug class: 0/false miscoding — same as above for explicit equals checks.
// A field with `equals: 0` against a value of 0 must match.
describe("isFieldCurrentlyVisible — equals / notEquals", () => {
  test("equals: matches the literal number 0 (0 must not be treated as empty)", () => {
    const field = f({
      visibilityCondition: { field: "n", operator: "equals", value: 0 },
    })
    expect(isFieldCurrentlyVisible(field, { n: 0 })).toBe(true)
  })

  test("equals: matches the literal boolean false (false must not be treated as empty)", () => {
    const field = f({
      visibilityCondition: { field: "b", operator: "equals", value: false },
    })
    expect(isFieldCurrentlyVisible(field, { b: false })).toBe(true)
  })

  test("equals: hides when parent is null, even if the expected value is null", () => {
    // Empty values short-circuit to hidden — a null parent means "not set yet",
    // and dependent fields should stay hidden until the user makes a choice.
    const field = f({
      visibilityCondition: { field: "p", operator: "equals", value: null },
    })
    expect(isFieldCurrentlyVisible(field, { p: null })).toBe(false)
  })

  test("equals: matches strings exactly", () => {
    const field = f({
      visibilityCondition: { field: "p", operator: "equals", value: "yes" },
    })
    expect(isFieldCurrentlyVisible(field, { p: "yes" })).toBe(true)
    expect(isFieldCurrentlyVisible(field, { p: "no" })).toBe(false)
  })

  test("notEquals: matches when value differs", () => {
    const field = f({
      visibilityCondition: { field: "p", operator: "notEquals", value: "x" },
    })
    expect(isFieldCurrentlyVisible(field, { p: "y" })).toBe(true)
    expect(isFieldCurrentlyVisible(field, { p: "x" })).toBe(false)
  })
})

// Bug class: enum-based visibility broken — same 0/false trap, plus null
// must not be silently treated as a valid match against an array containing
// null.
describe("isFieldCurrentlyVisible — in", () => {
  test("in: visible when value is in the array", () => {
    const field = f({
      visibilityCondition: {
        field: "status",
        operator: "in",
        value: ["draft", "published"],
      },
    })
    expect(isFieldCurrentlyVisible(field, { status: "draft" })).toBe(true)
    expect(isFieldCurrentlyVisible(field, { status: "archived" })).toBe(false)
  })

  test("in: hidden when value is null even if null is technically in the array", () => {
    const field = f({
      visibilityCondition: {
        field: "p",
        operator: "in",
        value: [null, "x"],
      },
    })
    expect(isFieldCurrentlyVisible(field, { p: null })).toBe(false)
  })

  test("in: visible when value is 0 and 0 is in the array (0 must not be treated as empty)", () => {
    const field = f({
      visibilityCondition: {
        field: "n",
        operator: "in",
        value: [0, 1, 2],
      },
    })
    expect(isFieldCurrentlyVisible(field, { n: 0 })).toBe(true)
  })
})

// Bug class: legacy pattern overrides modern visibilityCondition — a
// reordering of the visibility checks would let a legacy `dependsOn` hide
// a field that the modern `visibilityCondition: "always"` says is visible.
describe("isFieldCurrentlyVisible — visibilityCondition precedence over legacy patterns", () => {
  // When a field has BOTH a modern visibilityCondition AND a legacy hint
  // (dependsOn / conditional / showWhen), modern wins. This protects against
  // a regression where someone refactors the order of checks.

  test("modern visibilityCondition takes precedence over legacy dependsOn", () => {
    // visibilityCondition: always → visible, even though legacy dependsOn parent is empty.
    const field = f({
      visibilityCondition: "always",
      dependsOn: "parent",
    })
    expect(isFieldCurrentlyVisible(field, { parent: "" })).toBe(true)
  })

  test("modern visibilityCondition with isNotEmpty hides regardless of legacy `hidden: false`", () => {
    const field = f({
      visibilityCondition: { field: "p", operator: "isNotEmpty" },
      hidden: false,
    })
    expect(isFieldCurrentlyVisible(field, { p: "" })).toBe(false)
  })
})

// Bug class: future-feature trap — a partially-implemented `or` shape or
// unknown operator must not crash and must not silently misclaim semantics.
// A regression here would either error during save/publish or silently hide
// a required field.
describe("isFieldCurrentlyVisible — unsupported visibilityCondition shapes", () => {
  test("the `or` shape is NOT silently supported (only `and` is documented)", () => {
    // Trap-detector: if someone adds `or` support to the type but forgets the
    // matching code branch, this test must fail so reviewers notice. The
    // current contract is: `and` exists, `or` does not.
    const field = f({
      visibilityCondition: {
        or: [
          { field: "a", operator: "equals", value: "x" },
          { field: "b", operator: "equals", value: "y" },
        ],
      } as any,
    })
    // With neither field set, an `or` reading would still return false for
    // both clauses; we don't care about the exact result, only that the
    // function doesn't crash AND doesn't claim "or" semantics by accident.
    // Current behaviour: falls through past visibilityCondition (no recognised
    // shape) and returns true — i.e., visible by default, which is the safer
    // failure mode (don't silently hide fields).
    expect(() => isFieldCurrentlyVisible(field, {})).not.toThrow()
    expect(isFieldCurrentlyVisible(field, {})).toBe(true)
  })

  test("an unknown operator inside a visibilityCondition does not crash", () => {
    const field = f({
      visibilityCondition: { field: "p", operator: "matchesRegex" as any, value: "x" },
    })
    expect(() => isFieldCurrentlyVisible(field, { p: "x" })).not.toThrow()
  })
})

// Bug class: AND/OR inversion — a refactor that swaps `every` for `some`
// would silently weaken visibility gates so dependent fields appear too
// early, before all required parents are set.
describe("isFieldCurrentlyVisible — visibilityCondition.and", () => {
  test("visible only when ALL conditions in the array pass", () => {
    const field = f({
      visibilityCondition: {
        and: [
          { field: "a", operator: "isNotEmpty" },
          { field: "b", operator: "equals", value: "yes" },
        ],
      },
    })
    expect(isFieldCurrentlyVisible(field, { a: "x", b: "yes" })).toBe(true)
  })

  test("hidden if any single condition fails", () => {
    const field = f({
      visibilityCondition: {
        and: [
          { field: "a", operator: "isNotEmpty" },
          { field: "b", operator: "equals", value: "yes" },
        ],
      },
    })
    expect(isFieldCurrentlyVisible(field, { a: "x", b: "no" })).toBe(false)
    expect(isFieldCurrentlyVisible(field, { a: "", b: "yes" })).toBe(false)
  })
})

// Bug class: backwards-compat removal breaks old node configs — these
// branches exist for nodes that pre-date the modern visibilityCondition
// API. Dropping support without migrating the configs would silently
// change which fields are required on existing user workflows.
describe("isFieldCurrentlyVisible — compatibility (legacy patterns, frozen for backwards-compat)", () => {
  // The branches below exist for backwards-compat with older node configs.
  // They should remain frozen — new nodes should use `visibilityCondition`
  // instead. These tests pin current behaviour so a refactor doesn't drop
  // legacy support without a deliberate decision.

  describe("legacy: dependsOn", () => {
    test("hides when the parent field is empty", () => {
      expect(
        isFieldCurrentlyVisible(f({ dependsOn: "parent" }), { parent: "" }),
      ).toBe(false)
    })

    test("shows when the parent field is populated", () => {
      expect(
        isFieldCurrentlyVisible(f({ dependsOn: "parent" }), { parent: "x" }),
      ).toBe(true)
    })
  })

  describe("legacy: conditional", () => {
    test("shows only on exact value match", () => {
      const field = f({ conditional: { field: "mode", value: "advanced" } })
      expect(isFieldCurrentlyVisible(field, { mode: "advanced" })).toBe(true)
      expect(isFieldCurrentlyVisible(field, { mode: "basic" })).toBe(false)
    })
  })

  describe("legacy: showWhen with operator object", () => {
    test("$eq operator", () => {
      const field = f({ showWhen: { mode: { $eq: "x" } } })
      expect(isFieldCurrentlyVisible(field, { mode: "x" })).toBe(true)
      expect(isFieldCurrentlyVisible(field, { mode: "y" })).toBe(false)
    })

    test("$ne operator", () => {
      const field = f({ showWhen: { mode: { $ne: "x" } } })
      expect(isFieldCurrentlyVisible(field, { mode: "y" })).toBe(true)
      expect(isFieldCurrentlyVisible(field, { mode: "x" })).toBe(false)
    })

    test("$exists: true", () => {
      const field = f({ showWhen: { p: { $exists: true } } })
      expect(isFieldCurrentlyVisible(field, { p: "x" })).toBe(true)
      expect(isFieldCurrentlyVisible(field, { p: "" })).toBe(false)
    })

    test("$exists: false", () => {
      const field = f({ showWhen: { p: { $exists: false } } })
      expect(isFieldCurrentlyVisible(field, {})).toBe(true)
      expect(isFieldCurrentlyVisible(field, { p: "x" })).toBe(false)
    })

    test("$gt and $lt operators", () => {
      const gtField = f({ showWhen: { n: { $gt: 5 } } })
      expect(isFieldCurrentlyVisible(gtField, { n: 6 })).toBe(true)
      expect(isFieldCurrentlyVisible(gtField, { n: 5 })).toBe(false)

      const ltField = f({ showWhen: { n: { $lt: 5 } } })
      expect(isFieldCurrentlyVisible(ltField, { n: 4 })).toBe(true)
      expect(isFieldCurrentlyVisible(ltField, { n: 5 })).toBe(false)
    })
  })

  describe("legacy: hidden.$condition with $or", () => {
    test("hides when ANY orCondition matches (uses .some, not .every)", () => {
      // Critical: a refactor swapping .some -> .every would invert the logic
      // and the field would become permanently visible — silently relaxing
      // the hide rule.
      const field = f({
        hidden: {
          $condition: {
            $or: [{ a: { $eq: "hide" } }, { b: { $eq: "hide" } }],
          },
        },
      })
      expect(isFieldCurrentlyVisible(field, { a: "hide", b: "ok" })).toBe(false)
      expect(isFieldCurrentlyVisible(field, { a: "ok", b: "hide" })).toBe(false)
      expect(isFieldCurrentlyVisible(field, { a: "ok", b: "ok" })).toBe(true)
    })
  })

  describe("legacy: hidden as a literal boolean true", () => {
    test("`hidden: true` always hides the field", () => {
      expect(isFieldCurrentlyVisible(f({ hidden: true }), {})).toBe(false)
    })
  })

  describe("legacy: showIf function", () => {
    test("visible when the function returns true", () => {
      const field = f({ showIf: (v: any) => v.flag === "on" })
      expect(isFieldCurrentlyVisible(field, { flag: "on" })).toBe(true)
    })

    test("hidden when the function returns false", () => {
      const field = f({ showIf: (v: any) => v.flag === "on" })
      expect(isFieldCurrentlyVisible(field, { flag: "off" })).toBe(false)
    })

    test("visible (defensive default) when the function throws", () => {
      // Better to show a maybe-irrelevant field than silently hide a relevant
      // one. A regression that defaults to hidden could make required fields
      // disappear and break workflow saves.
      const field = f({
        showIf: () => {
          throw new Error("boom")
        },
      })
      expect(isFieldCurrentlyVisible(field, {})).toBe(true)
    })

    test("hidden when the function returns a truthy non-true value (must equal === true)", () => {
      const field = f({ showIf: () => "yes" })
      expect(isFieldCurrentlyVisible(field, {})).toBe(false)
    })
  })
})

// Bug class: publish blocked incorrectly OR invalid workflow published.
// If `getMissingRequiredFields` reports a hidden field as missing, the user
// can't publish at all. If it fails to report a visible empty required field,
// invalid configs ship.
describe("getMissingRequiredFields", () => {
  test("reports a required, visible, empty field", () => {
    const nodeInfo = {
      configSchema: [f({ name: "title", required: true })],
    }
    expect(getMissingRequiredFields(nodeInfo, {})).toEqual(["Field"])
  })

  test("does NOT report a required field that is hidden", () => {
    // The single most user-visible regression class: if a hidden field counts
    // as required, the user can't publish at all.
    const nodeInfo = {
      configSchema: [f({ name: "secret", required: true, type: "hidden" })],
    }
    expect(getMissingRequiredFields(nodeInfo, {})).toEqual([])
  })

  test("does NOT report a required field whose dependsOn parent is unset", () => {
    const nodeInfo = {
      configSchema: [
        f({ name: "child", required: true, dependsOn: "parent" }),
      ],
    }
    expect(getMissingRequiredFields(nodeInfo, {})).toEqual([])
  })

  test("does NOT report a required field that has a defaultValue", () => {
    const nodeInfo = {
      configSchema: [
        f({ name: "title", required: true, defaultValue: "Untitled" }),
      ],
    }
    expect(getMissingRequiredFields(nodeInfo, {})).toEqual([])
  })

  test("does NOT report a required field that the user has filled in", () => {
    const nodeInfo = {
      configSchema: [f({ name: "title", required: true })],
    }
    expect(getMissingRequiredFields(nodeInfo, { title: "Hello" })).toEqual([])
  })

  test("supports the validation.required style of marking a field required", () => {
    const nodeInfo = {
      configSchema: [
        f({ name: "title", validation: { required: true } }),
      ],
    }
    expect(getMissingRequiredFields(nodeInfo, {})).toEqual(["Field"])
  })

  test("falls back to field.name when label is absent", () => {
    const nodeInfo = {
      configSchema: [
        { name: "title", type: "text", required: true },
      ],
    }
    expect(getMissingRequiredFields(nodeInfo as any, {})).toEqual(["title"])
  })

  test("returns [] when nodeInfo or configSchema is undefined", () => {
    expect(getMissingRequiredFields(undefined, {})).toEqual([])
    expect(getMissingRequiredFields({}, {})).toEqual([])
  })

  test("reports multiple missing fields in schema order", () => {
    const nodeInfo = {
      configSchema: [
        f({ name: "title", label: "Title", required: true }),
        f({ name: "body", label: "Body", required: true }),
        f({ name: "optional", label: "Optional" }),
      ],
    }
    expect(getMissingRequiredFields(nodeInfo, {})).toEqual(["Title", "Body"])
  })
})
