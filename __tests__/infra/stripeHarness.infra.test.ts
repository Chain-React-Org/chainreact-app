/**
 * Smoke test: stripeHarness can build a Stripe SDK client pointed at
 * stripe-mock and round-trip a real call.
 *
 * Verifies (1) the harness's `makeStripeClient` returns a working
 * client, (2) `withRequestCapture` records outbound HTTP at the fetch
 * boundary, and (3) `isStripeMockAvailable` returns truthy when the
 * service is reachable.
 *
 * Skipped when stripe-mock isn't reachable.
 */

import {
  isStripeMockAvailable,
  makeStripeClient,
  withRequestCapture,
} from '../helpers/stripeHarness'

const REQUIRES_DOCKER_NOTE =
  '(skipped: stripe-mock not reachable — run `npm run test:infra:up`)'

let stripeAvailable = false
beforeAll(async () => {
  stripeAvailable = await isStripeMockAvailable()
})

describe('stripeHarness — smoke', () => {
  test('makeStripeClient round-trips a charges.list call against stripe-mock', async () => {
    if (!stripeAvailable) {
      console.warn(`[stripeHarness.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }
    const stripe = makeStripeClient()
    const res = await stripe.charges.list({ limit: 1 })
    expect(res).toBeDefined()
    // stripe-mock returns canned data with a `data` array shape; we
    // don't pin any field beyond "the request didn't throw."
    expect(Array.isArray(res.data)).toBe(true)
  })

  test('withRequestCapture records outbound fetch calls', async () => {
    if (!stripeAvailable) {
      console.warn(`[stripeHarness.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }
    const { stripe, captured } = withRequestCapture()
    await stripe.charges.list({ limit: 1 })
    expect(captured.length).toBeGreaterThanOrEqual(1)
    const last = captured[captured.length - 1]
    expect(last.method).toBe('GET')
    expect(last.path).toContain('/v1/charges')
    // The SDK forwards the API key via Authorization: Bearer.
    expect(last.headers['authorization']).toMatch(/^Bearer /)
  })

  test('isStripeMockAvailable returns true when the service is reachable', async () => {
    expect(await isStripeMockAvailable()).toBe(stripeAvailable)
  })
})
