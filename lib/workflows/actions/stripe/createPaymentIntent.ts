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
 * Create a new payment intent in Stripe
 * API VERIFICATION: Uses Stripe API POST /v1/payment_intents
 * Docs: https://stripe.com/docs/api/payment_intents/create
 */
export async function stripeCreatePaymentIntent(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "stripe")

    // Resolve required fields
    const amount = context.dataFlowManager.resolveVariable(config.amount)
    const currency = context.dataFlowManager.resolveVariable(config.currency)

    if (!amount || !currency) {
      throw new Error('Amount and currency are required to create a payment intent')
    }

    // Build request body
    const body: any = {
      amount: Math.round(parseFloat(amount) * 100),
      currency: currency.toLowerCase()
    }

    // Optional customer ID
    if (config.customerId) {
      body.customer = context.dataFlowManager.resolveVariable(config.customerId)
    }

    // Optional description
    if (config.description) {
      body.description = context.dataFlowManager.resolveVariable(config.description)
    }

    // Optional metadata
    if (config.metadata) {
      const metadata = context.dataFlowManager.resolveVariable(config.metadata)
      if (typeof metadata === 'object') {
        body.metadata = metadata
      } else if (typeof metadata === 'string') {
        try {
          body.metadata = JSON.parse(metadata)
        } catch (e) {
          logger.error('[Stripe Create Payment Intent] Failed to parse metadata JSON', { metadata })
          throw new Error('Invalid metadata format - must be valid JSON object')
        }
      }
    }

    // Q4 — within-session idempotency. Check the registry first; on a
    // matching replay return the cached ActionResult without ever
    // touching Stripe. On a fresh fire, set Stripe's `Idempotency-Key`
    // header (defense in depth — even if our local marker is missing,
    // Stripe's own idempotency cache prevents a double-charge).
    const idempotencyKey = buildIdempotencyKey({
      executionSessionId: (context as any).executionSessionId ?? (context as any).executionId,
      nodeId: (context as any).nodeId,
      actionType: (context as any).actionType ?? 'stripe_action_create_payment_intent',
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

    // Make API call to create payment intent
    const response = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers,
      body: new URLSearchParams(flattenForStripe(body)).toString()
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Stripe API error: ${response.status} - ${errorText}`)
    }

    const paymentIntent = await response.json()

    const actionResult: ActionResult = {
      success: true,
      output: {
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
        customerId: paymentIntent.customer,
        description: paymentIntent.description,
        created: paymentIntent.created,
        metadata: paymentIntent.metadata,
        nextAction: paymentIntent.next_action
      },
      message: `Successfully created payment intent ${paymentIntent.id}`
    }

    if (idempotencyKey) {
      await recordFired(idempotencyKey, actionResult, payloadHash, {
        provider: 'stripe',
        externalId: paymentIntent.id ?? null,
      })
    }

    return actionResult
  } catch (error: any) {
    logger.error('[Stripe Create Payment Intent] Error:', error)
    return {
      success: false,
      output: {},
      message: error.message || 'Failed to create payment intent in Stripe'
    }
  }
}
