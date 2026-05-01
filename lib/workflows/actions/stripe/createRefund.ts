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
 * Create a refund in Stripe
 * API VERIFICATION: Uses Stripe API POST /v1/refunds
 * Docs: https://stripe.com/docs/api/refunds/create
 *
 * Requires either charge ID OR payment_intent ID.
 * Amount is optional - if not provided, refunds the full amount.
 */
export async function stripeCreateRefund(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  // Q8d — testMode interception. Refunds are particularly dangerous in
  // testMode — a real refund issued from a "test" session double-credits
  // the customer.
  if ((context as any).testMode) {
    return {
      success: true,
      output: { simulated: true, provider: 'stripe' },
      message: 'Simulated in test mode — no provider call made',
    }
  }

  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "stripe")

    // Resolve required fields - must have either charge or payment_intent
    const chargeId = context.dataFlowManager.resolveVariable(config.chargeId)
    const paymentIntentId = context.dataFlowManager.resolveVariable(config.paymentIntentId)

    if (!chargeId && !paymentIntentId) {
      throw new Error('Either Charge ID or Payment Intent ID is required')
    }

    // Build request body
    const body: any = {}

    // Stripe only accepts one of these - prefer payment_intent over charge
    if (paymentIntentId) {
      body.payment_intent = paymentIntentId
    } else if (chargeId) {
      body.charge = chargeId
    }

    // Amount is optional - if not provided, refunds full amount
    if (config.amount) {
      const amount = context.dataFlowManager.resolveVariable(config.amount)
      if (amount) {
        body.amount = Math.round(parseFloat(amount.toString()) * 100)
      }
    }

    // Reason is optional
    if (config.reason) {
      body.reason = context.dataFlowManager.resolveVariable(config.reason)
    }

    // Metadata is optional
    if (config.metadata) {
      const metadata = context.dataFlowManager.resolveVariable(config.metadata)
      if (typeof metadata === 'object') {
        body.metadata = metadata
      } else if (typeof metadata === 'string') {
        try {
          body.metadata = JSON.parse(metadata)
        } catch (e) {
          logger.error('[Stripe Create Refund] Failed to parse metadata JSON', { metadata })
          throw new Error('Invalid metadata format - must be valid JSON object')
        }
      }
    }

    // Q4 — within-session idempotency. Refunds are particularly
    // important to dedup — a duplicate refund silently double-credits
    // the customer.
    const idempotencyKey = buildIdempotencyKey({
      executionSessionId: (context as any).executionSessionId ?? (context as any).executionId,
      nodeId: (context as any).nodeId,
      actionType: (context as any).actionType ?? 'stripe_action_create_refund',
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

    // Make API call to create refund
    const response = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers,
      body: new URLSearchParams(flattenForStripe(body)).toString()
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Stripe API error: ${response.status} - ${errorText}`)
    }

    const refund = await response.json()

    const actionResult: ActionResult = {
      success: true,
      output: {
        refundId: refund.id,
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status,
        charge: refund.charge,
        paymentIntent: refund.payment_intent,
        reason: refund.reason,
        receiptNumber: refund.receipt_number,
        created: refund.created,
        metadata: refund.metadata
      },
      message: `Successfully created refund ${refund.id} for ${refund.amount / 100} ${refund.currency.toUpperCase()}`
    }

    if (idempotencyKey) {
      await recordFired(idempotencyKey, actionResult, payloadHash, {
        provider: 'stripe',
        externalId: refund.id ?? null,
      })
    }

    return actionResult
  } catch (error: any) {
    logger.error('[Stripe Create Refund] Error:', error)
    return {
      success: false,
      output: {},
      message: error.message || 'Failed to create refund in Stripe'
    }
  }
}
