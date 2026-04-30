/**
 * Contract: flattenForStripe
 * Source: lib/workflows/actions/stripe/utils.ts
 * Style: pure-function tests with real inputs; no mocks of the function under test.
 *        Pairs every happy-path case with a failure-path or edge case.
 *
 * Background: Stripe's API expects nested data in form-encoded bracket notation
 * (`line_items[0][price]=p_1`). URLSearchParams cannot serialise nested objects
 * — passing them produces literal `[object Object]` strings, which historically
 * caused production payments to fail. flattenForStripe converts a nested input
 * to flat string keys before URLSearchParams gets it.
 */

import { flattenForStripe } from "@/lib/workflows/actions/stripe/utils"

// Bug class: billing payload corruption — wrong-type serialization (e.g.
// boolean → "1"/"0" instead of "true"/"false") makes Stripe reject or, worse,
// silently misread the field.
describe("flattenForStripe — flat inputs", () => {
  test("returns an empty object for an empty input", () => {
    expect(flattenForStripe({})).toEqual({})
  })

  test("passes flat string values through unchanged", () => {
    expect(flattenForStripe({ a: "1", b: "two" })).toEqual({ a: "1", b: "two" })
  })

  test("stringifies number values", () => {
    expect(flattenForStripe({ amount: 2099 })).toEqual({ amount: "2099" })
  })

  test("serialises booleans to literal 'true'/'false' strings", () => {
    // Stripe (and several other form-encoded APIs) accept the strings 'true'
    // and 'false'. A regression that swaps to '1'/'0' or to JSON.stringify
    // would silently break boolean fields like `automatic_tax[enabled]`.
    expect(flattenForStripe({ enabled: true, disabled: false })).toEqual({
      enabled: "true",
      disabled: "false",
    })
  })
})

// Bug class: Stripe API rejection or mis-charging — null serialised to the
// literal string "null" makes Stripe reject the request, or worse, treat it
// as a valid value.
describe("flattenForStripe — null/undefined handling", () => {
  test("drops null values entirely (does NOT stringify to 'null')", () => {
    expect(flattenForStripe({ a: "x", b: null })).toEqual({ a: "x" })
  })

  test("drops undefined values entirely", () => {
    expect(flattenForStripe({ a: "x", b: undefined })).toEqual({ a: "x" })
  })

  test("drops null even from deeply nested positions", () => {
    expect(
      flattenForStripe({ customer: { email: "a@b.com", phone: null } }),
    ).toEqual({ "customer[email]": "a@b.com" })
  })
})

// Bug class: billing payload corruption — Stripe expects bracket notation
// (`customer[email]`); raw nested objects serialize as "[object Object]".
describe("flattenForStripe — nested objects", () => {
  test("flattens a single level of nesting with bracket notation", () => {
    expect(flattenForStripe({ customer: { email: "x@y.com" } })).toEqual({
      "customer[email]": "x@y.com",
    })
  })

  test("flattens deeply nested objects", () => {
    expect(flattenForStripe({ a: { b: { c: "deep" } } })).toEqual({
      "a[b][c]": "deep",
    })
  })

  test("merges multiple sibling nested keys", () => {
    expect(
      flattenForStripe({
        billing_details: { email: "a@b.com", name: "Jane" },
      }),
    ).toEqual({
      "billing_details[email]": "a@b.com",
      "billing_details[name]": "Jane",
    })
  })
})

// Bug class: regression to the original line_items production incident —
// arrays of objects must serialise to indexed bracket notation, not as
// stringified objects.
describe("flattenForStripe — arrays", () => {
  test("flattens an array of primitives with numeric indices", () => {
    expect(flattenForStripe({ tags: ["a", "b"] })).toEqual({
      "tags[0]": "a",
      "tags[1]": "b",
    })
  })

  test("flattens line_items (array of objects) with full bracket notation", () => {
    // This is the canonical Stripe Checkout payload that triggered the original
    // production bug — verify it serialises exactly as Stripe expects.
    expect(
      flattenForStripe({
        line_items: [
          { price: "price_1", quantity: 2 },
          { price: "price_2", quantity: 1 },
        ],
      }),
    ).toEqual({
      "line_items[0][price]": "price_1",
      "line_items[0][quantity]": "2",
      "line_items[1][price]": "price_2",
      "line_items[1][quantity]": "1",
    })
  })

  test("handles mixed-type arrays (primitive + object)", () => {
    expect(flattenForStripe({ mix: [1, { x: 2 }] })).toEqual({
      "mix[0]": "1",
      "mix[1][x]": "2",
    })
  })

  test("omits empty arrays entirely", () => {
    // The implementation iterates the array; an empty array yields no keys.
    // This is the desired behaviour — no `tags[]=` entry leaks into the body.
    expect(flattenForStripe({ tags: [] })).toEqual({})
  })

  test("flattens deeply nested arrays inside objects", () => {
    expect(flattenForStripe({ a: { b: { c: [1, 2] } } })).toEqual({
      "a[b][c][0]": "1",
      "a[b][c][1]": "2",
    })
  })
})

// Bug class: direct regression of the original prod incident — if anyone
// bypasses flattenForStripe and feeds a nested object straight into
// URLSearchParams, the body contains literal "[object Object]" and Stripe
// returns parameter_invalid_string. This block guards that regression.
describe("flattenForStripe — round-trip with URLSearchParams", () => {
  test("output round-trips through URLSearchParams to the exact bracket-notation Stripe wants", () => {
    // Critical regression guard: this is the body Stripe actually receives. If
    // someone reverts to passing the raw nested object straight to
    // URLSearchParams, the value becomes `[object Object]` and the request
    // fails with `parameter_invalid_string`.
    const flat = flattenForStripe({
      line_items: [{ price: "price_1", quantity: 2 }],
      mode: "payment",
    })
    const body = new URLSearchParams(flat).toString()
    expect(body).toContain("line_items%5B0%5D%5Bprice%5D=price_1")
    expect(body).toContain("line_items%5B0%5D%5Bquantity%5D=2")
    expect(body).toContain("mode=payment")
    // Negative assertion: the dreaded `[object Object]` substring must NOT appear.
    expect(body).not.toContain("object+Object")
    expect(body).not.toContain("%5Bobject")
  })

  test("naive URLSearchParams without flattening produces the broken output", () => {
    // This is documentation of the bug the function exists to prevent.
    const broken = new URLSearchParams({
      // @ts-expect-error — passing a non-string value is exactly the bug
      line_items: [{ price: "price_1", quantity: 2 }],
    } as Record<string, string>).toString()
    expect(broken).toContain("object")
  })
})

// Bug class: billing payload corruption on real-world shapes — special
// characters double-encoded, type coercion mismatch between numbers and
// numeric strings, and full Checkout Session payloads.
describe("flattenForStripe — adversarial / realistic inputs", () => {
  test("special characters in values are preserved (URL-encoding is URLSearchParams' job)", () => {
    // The flattener must NOT pre-encode values — that would double-encode when
    // URLSearchParams serialises. Stripe receives "a&b" as the literal string
    // value of a parameter, which URLSearchParams emits as "a%26b" in the body.
    const flat = flattenForStripe({
      "metadata": { note: "a&b=c d+e" },
    })
    expect(flat["metadata[note]"]).toBe("a&b=c d+e")
    const body = new URLSearchParams(flat).toString()
    // URLSearchParams emits `+` for spaces and percent-encodes the rest.
    expect(body).toMatch(/metadata%5Bnote%5D=a%26b%3Dc(\+|%20)d%2Be/)
  })

  test("numbers and numeric strings serialise identically (Stripe sees the same body)", () => {
    expect(flattenForStripe({ amount: 2099 })).toEqual(
      flattenForStripe({ amount: "2099" }),
    )
  })

  test("realistic Stripe Checkout subscription payload flattens correctly", () => {
    // This is shaped like a real Stripe Checkout Session creation payload —
    // mode + line_items + subscription_data with metadata + automatic_tax.
    const payload = {
      mode: "subscription",
      success_url: "https://chainreact.app/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://chainreact.app/cancel",
      line_items: [{ price: "price_pro_monthly", quantity: 1 }],
      automatic_tax: { enabled: true },
      subscription_data: {
        metadata: { workspace_id: "ws_123", plan_tier: "pro" },
      },
    }
    const flat = flattenForStripe(payload)
    expect(flat).toMatchObject({
      mode: "subscription",
      "line_items[0][price]": "price_pro_monthly",
      "line_items[0][quantity]": "1",
      "automatic_tax[enabled]": "true",
      "subscription_data[metadata][workspace_id]": "ws_123",
      "subscription_data[metadata][plan_tier]": "pro",
    })
    // Body round-trip must not contain `[object Object]`.
    const body = new URLSearchParams(flat).toString()
    expect(body).not.toContain("object")
  })
})
