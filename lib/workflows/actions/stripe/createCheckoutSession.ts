import { ActionResult } from '../index'
import { getDecryptedAccessToken } from '../core/getDecryptedAccessToken'
import { ExecutionContext } from '../../execution/types'
import { logger } from '@/lib/utils/logger'
import { flattenForStripe } from './utils'
import {
  buildIdempotencyKey,
  formatProviderIdempotencyKey,
} from '../core/idempotencyKey'
import { hashPayload } from '../core/hashPayload'
import { checkReplay, recordFired } from '../core/sessionSideEffects'

/**
 * Create a Checkout Session in Stripe
 * API VERIFICATION: Uses Stripe API POST /v1/checkout/sessions
 * Docs: https://stripe.com/docs/api/checkout/sessions/create
 *
 * Creates a Stripe Checkout session - the modern payment flow that redirects
 * customers to a Stripe-hosted payment page.
 */
export async function stripeCreateCheckoutSession(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  // Q8d — testMode interception.
  if ((context as any).testMode) {
    return {
      success: true,
      output: { simulated: true, provider: 'stripe' },
      message: 'Simulated in test mode — no provider call made',
    }
  }

  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "stripe")

    // Build request body
    const body: any = {}

    // Line items - built from priceId multiselect + quantity, or raw line_items for backward compat
    if (config.priceId) {
      const priceIds = context.dataFlowManager.resolveVariable(config.priceId)
      const qty = parseInt(context.dataFlowManager.resolveVariable(config.quantity) || '1') || 1
      const priceArray = Array.isArray(priceIds) ? priceIds : [priceIds]
      if (priceArray.length === 0) {
        throw new Error('At least one price must be selected')
      }
      body.line_items = priceArray.map((id: string) => ({ price: id, quantity: qty }))
    } else if (config.line_items) {
      const lineItems = context.dataFlowManager.resolveVariable(config.line_items)
      if (typeof lineItems === 'string') {
        try {
          body.line_items = JSON.parse(lineItems)
        } catch (e) {
          throw new Error('Line items must be a valid JSON array')
        }
      } else if (Array.isArray(lineItems)) {
        body.line_items = lineItems
      } else {
        throw new Error('Line items must be an array')
      }
    } else {
      throw new Error('At least one price must be selected')
    }

    // Mode: auto-detect from price types if not explicitly set to "setup"
    const configuredMode = context.dataFlowManager.resolveVariable(config.mode) || 'payment'

    if (configuredMode === 'setup') {
      body.mode = 'setup'
    } else if (body.line_items?.length > 0) {
      // Fetch first price to check if recurring or one-time
      const firstPriceId = body.line_items[0].price
      const priceResponse = await fetch(`https://api.stripe.com/v1/prices/${firstPriceId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      })
      if (priceResponse.ok) {
        const priceData = await priceResponse.json()
        body.mode = priceData.type === 'recurring' ? 'subscription' : 'payment'
      } else {
        body.mode = configuredMode
      }
    } else {
      body.mode = configuredMode
    }

    // Success URL (required)
    const successUrl = context.dataFlowManager.resolveVariable(config.success_url)
    if (!successUrl) {
      throw new Error('Success URL is required')
    }
    body.success_url = successUrl

    // Cancel URL (required)
    const cancelUrl = context.dataFlowManager.resolveVariable(config.cancel_url)
    if (!cancelUrl) {
      throw new Error('Cancel URL is required')
    }
    body.cancel_url = cancelUrl

    // Optional: Customer ID or email
    if (config.customer) {
      body.customer = context.dataFlowManager.resolveVariable(config.customer)
    }
    if (config.customer_email) {
      body.customer_email = context.dataFlowManager.resolveVariable(config.customer_email)
    }

    // Optional: Payment method types
    if (config.payment_method_types) {
      const paymentMethodTypes = context.dataFlowManager.resolveVariable(config.payment_method_types)
      if (Array.isArray(paymentMethodTypes)) {
        body.payment_method_types = paymentMethodTypes
      } else if (typeof paymentMethodTypes === 'string') {
        try {
          body.payment_method_types = JSON.parse(paymentMethodTypes)
        } catch (e) {
          // Single value
          body.payment_method_types = [paymentMethodTypes]
        }
      }
    }

    // Optional: Allow promotion codes
    if (config.allow_promotion_codes !== undefined) {
      const allowPromo = context.dataFlowManager.resolveVariable(config.allow_promotion_codes)
      body.allow_promotion_codes = allowPromo === true || allowPromo === 'true'
    }

    // Optional: Billing address collection
    if (config.billing_address_collection) {
      body.billing_address_collection = context.dataFlowManager.resolveVariable(config.billing_address_collection)
    }

    // Optional: Shipping address collection - from country multiselect or raw object
    if (config.shipping_countries) {
      const countries = context.dataFlowManager.resolveVariable(config.shipping_countries)
      const countryArray = Array.isArray(countries) ? countries : [countries]
      if (countryArray.length > 0) {
        body.shipping_address_collection = { allowed_countries: countryArray }
      }
    } else if (config.shipping_address_collection) {
      const shippingConfig = context.dataFlowManager.resolveVariable(config.shipping_address_collection)
      if (typeof shippingConfig === 'string') {
        try {
          body.shipping_address_collection = JSON.parse(shippingConfig)
        } catch (e) {
          logger.error('[Stripe Create Checkout Session] Failed to parse shipping_address_collection', { shippingConfig })
        }
      } else if (typeof shippingConfig === 'object') {
        body.shipping_address_collection = shippingConfig
      }
    }

    // Optional: Metadata
    if (config.metadata) {
      const metadata = context.dataFlowManager.resolveVariable(config.metadata)
      if (typeof metadata === 'object') {
        body.metadata = metadata
      } else if (typeof metadata === 'string') {
        try {
          body.metadata = JSON.parse(metadata)
        } catch (e) {
          logger.error('[Stripe Create Checkout Session] Failed to parse metadata', { metadata })
          throw new Error('Invalid metadata format - must be valid JSON object')
        }
      }
    }

    // Optional: Client reference ID
    if (config.client_reference_id) {
      body.client_reference_id = context.dataFlowManager.resolveVariable(config.client_reference_id)
    }

    // Optional: Locale
    if (config.locale) {
      body.locale = context.dataFlowManager.resolveVariable(config.locale)
    }

    // Q4 — within-session idempotency.
    const idempotencyKey = buildIdempotencyKey({
      executionSessionId: (context as any).executionSessionId ?? (context as any).executionId,
      nodeId: (context as any).nodeId,
      actionType: (context as any).actionType ?? 'stripe_action_create_checkout_session',
      provider: 'stripe',
    })
    const payloadHash = idempotencyKey ? hashPayload(body) : ''

    if (idempotencyKey) {
      const replay = await checkReplay(idempotencyKey, payloadHash)
      if (replay.kind === 'cached') return replay.result
      if (replay.kind === 'mismatch') {
        return {
          success: false,
          output: {},
          message: 'This action was already executed for this session with different input.',
          error: 'PAYLOAD_MISMATCH',
        }
      }
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }
    if (idempotencyKey) {
      headers['Idempotency-Key'] = formatProviderIdempotencyKey(idempotencyKey)
    }

    // Make API call to create checkout session
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers,
      body: new URLSearchParams(flattenForStripe(body)).toString()
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Stripe API error: ${response.status} - ${errorText}`)
    }

    const session = await response.json()

    const actionResult: ActionResult = {
      success: true,
      output: {
        sessionId: session.id,
        url: session.url,
        customerId: session.customer,
        paymentIntentId: session.payment_intent,
        subscriptionId: session.subscription,
        amountTotal: session.amount_total,
        currency: session.currency,
        paymentStatus: session.payment_status,
        status: session.status,
        expiresAt: session.expires_at,
        metadata: session.metadata
      },
      message: `Successfully created checkout session ${session.id}. Redirect customer to: ${session.url}`
    }

    if (idempotencyKey) {
      await recordFired(idempotencyKey, actionResult, payloadHash, {
        provider: 'stripe',
        externalId: session.id ?? null,
      })
    }

    return actionResult
  } catch (error: any) {
    logger.error('[Stripe Create Checkout Session] Error:', error)
    return {
      success: false,
      output: {},
      message: error.message || 'Failed to create checkout session in Stripe'
    }
  }
}
