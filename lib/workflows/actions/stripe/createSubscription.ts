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
 * Create a new subscription in Stripe
 * API VERIFICATION: Uses Stripe API POST /v1/subscriptions
 * Docs: https://stripe.com/docs/api/subscriptions/create
 */
export async function stripeCreateSubscription(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  // Q8d — testMode interception (defense in depth — a Stripe charge that
  // bypasses upstream test gates would charge real customers).
  if ((context as any).testMode) {
    return {
      success: true,
      output: { simulated: true, provider: 'stripe' },
      message: 'Simulated in test mode — no provider call made',
    }
  }

  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "stripe")

    // Resolve required fields
    const customerId = context.dataFlowManager.resolveVariable(config.customerId)
    const priceId = context.dataFlowManager.resolveVariable(config.priceId)

    if (!customerId || !priceId) {
      throw new Error('Customer ID and Price ID are required to create a subscription')
    }

    // Build request body
    const body: any = {
      customer: customerId,
      items: [{ price: priceId }]
    }

    // Optional default payment method
    if (config.default_payment_method) {
      const paymentMethod = context.dataFlowManager.resolveVariable(config.default_payment_method)
      if (paymentMethod) {
        body.default_payment_method = paymentMethod
      }
    }

    // Optional payment behavior (controls what happens when no payment method exists)
    if (config.payment_behavior) {
      const behavior = context.dataFlowManager.resolveVariable(config.payment_behavior)
      if (behavior) {
        body.payment_behavior = behavior
      }
    }

    // Optional trial period
    if (config.trialPeriodDays) {
      const trialDays = context.dataFlowManager.resolveVariable(config.trialPeriodDays)
      if (trialDays) {
        body.trial_period_days = parseInt(trialDays)
      }
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
          logger.error('[Stripe Create Subscription] Failed to parse metadata JSON', { metadata })
          throw new Error('Invalid metadata format - must be valid JSON object')
        }
      }
    }

    // Q4 — within-session idempotency (see learning/docs/handler-contracts.md).
    const idempotencyKey = buildIdempotencyKey({
      executionSessionId: (context as any).executionSessionId ?? (context as any).executionId,
      nodeId: (context as any).nodeId,
      actionType: (context as any).actionType ?? 'stripe_action_create_subscription',
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

    // Make API call to create subscription
    const response = await fetch('https://api.stripe.com/v1/subscriptions', {
      method: 'POST',
      headers,
      body: new URLSearchParams(flattenForStripe(body)).toString()
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Stripe API error: ${response.status} - ${errorText}`)
    }

    const subscription = await response.json()

    const actionResult: ActionResult = {
      success: true,
      output: {
        subscriptionId: subscription.id,
        customerId: subscription.customer,
        status: subscription.status,
        currentPeriodStart: subscription.current_period_start
          ? new Date(subscription.current_period_start * 1000).toISOString()
          : null,
        currentPeriodEnd: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        trialStart: subscription.trial_start
          ? new Date(subscription.trial_start * 1000).toISOString()
          : null,
        trialEnd: subscription.trial_end
          ? new Date(subscription.trial_end * 1000).toISOString()
          : null,
        priceId: subscription.items?.data?.[0]?.price?.id,
        quantity: subscription.items?.data?.[0]?.quantity || 1,
        created: subscription.created,
        metadata: subscription.metadata
      },
      message: `Successfully created subscription ${subscription.id}`
    }

    if (idempotencyKey) {
      await recordFired(idempotencyKey, actionResult, payloadHash, {
        provider: 'stripe',
        externalId: subscription.id ?? null,
      })
    }

    return actionResult
  } catch (error: any) {
    logger.error('[Stripe Create Subscription] Error:', error)
    return {
      success: false,
      output: {},
      message: error.message || 'Failed to create subscription in Stripe'
    }
  }
}
