import { ActionResult } from '../index'
import { makeShopifyGraphQLRequest, validateShopifyIntegration, getShopDomain } from '@/app/api/integrations/shopify/data/utils'
import { getIntegrationById } from '../../executeNode'
import { resolveValue } from '../core/resolveValue'
import { refreshAndRetry } from '../core/refreshAndRetry'
import { buildIdempotencyKey, type HandlerExecutionMeta } from '../core/idempotencyKey'
import { hashPayload } from '../core/hashPayload'
import { checkReplay, recordFired } from '../core/sessionSideEffects'
import { logger } from '@/lib/utils/logger'

/**
 * Extract numeric ID from Shopify GID
 */
function extractNumericId(gid: string): string {
  if (gid.includes('gid://shopify/')) {
    return gid.split('/').pop() || gid
  }
  return gid
}

/**
 * Create Shopify Customer (GraphQL)
 * Creates a new customer in Shopify with email, name, phone, tags, and marketing preferences
 */
export async function createShopifyCustomer(
  config: any,
  userId: string,
  input: Record<string, any>,
  meta?: HandlerExecutionMeta,
): Promise<ActionResult> {
  // Q8d — testMode interception.
  if (meta?.testMode) {
    return {
      success: true,
      output: { simulated: true, provider: 'shopify' },
      message: 'Simulated in test mode — no provider call made',
    }
  }

  try {
    // 1. Get and validate integration
    const integrationId = await resolveValue(config.integration_id || config.integrationId, input)
    const integration = await getIntegrationById(integrationId, { userId })
    validateShopifyIntegration(integration)

    // 2. Resolve all config values (including shopify_store for multi-store support)
    const selectedStore = config.shopify_store ? await resolveValue(config.shopify_store, input) : undefined
    const email = await resolveValue(config.email, input)
    const firstName = config.first_name ? await resolveValue(config.first_name, input) : undefined
    const lastName = config.last_name ? await resolveValue(config.last_name, input) : undefined
    const phone = config.phone ? await resolveValue(config.phone, input) : undefined
    const tags = config.tags ? await resolveValue(config.tags, input) : undefined
    const sendWelcomeEmail = config.send_welcome_email ?? false

    // Q8b — email is customer PII; debug-only.
    logger.debug('[Shopify GraphQL] Creating customer:', { email, selectedStore })

    // 3. Build GraphQL mutation
    const mutation = `
      mutation customerCreate($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer {
            id
            email
            firstName
            lastName
            phone
            tags
            createdAt
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const variables: any = {
      input: {
        email
      }
    }

    if (firstName) variables.input.firstName = firstName
    if (lastName) variables.input.lastName = lastName
    if (phone) variables.input.phone = phone
    if (tags) variables.input.tags = tags.split(',').map((t: string) => t.trim())
    if (sendWelcomeEmail) variables.input.emailMarketingConsent = { marketingState: 'SUBSCRIBED' }

    // Q4 — within-session idempotency. Hash the resolved customer input
    // (email + name + phone + tags + marketing). Shopify customer-create
    // is non-idempotent on its own, so the marker is the only protection
    // against duplicate customers on a session retry.
    const idempotencyKey = buildIdempotencyKey(meta)
    const payloadHash = idempotencyKey
      ? hashPayload({
          shopDomain: getShopDomain(integration, selectedStore),
          input: variables.input,
        })
      : ''

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

    // 4. Make GraphQL request. Wrapped in `refreshAndRetry` (Q3) — Shopify
    // is non_refreshable in our authSchemes registry (offline tokens have
    // no refresh grant), so a 401 short-circuits to a structured
    // action_required auth failure with no refresh attempt.
    const wrapped = await refreshAndRetry({
      provider: 'shopify',
      userId,
      // Shopify auth is the encrypted token on the integration row; we pass
      // a placeholder here because makeShopifyGraphQLRequest reads the token
      // from `integration.access_token` directly via getShopifyHeaders.
      accessToken: integration.access_token ?? '',
      call: async () =>
        makeShopifyGraphQLRequest(integration, mutation, variables, selectedStore),
    })

    if (!wrapped.success) {
      return {
        success: false,
        output: {},
        message: wrapped.message,
      }
    }

    const result = wrapped.data
    const customer = result.customerCreate.customer
    const shopDomain = getShopDomain(integration, selectedStore)
    const customerId = extractNumericId(customer.id)

    const actionResult: ActionResult = {
      success: true,
      output: {
        customer_id: customerId,
        customer_gid: customer.id,
        email: customer.email,
        admin_url: `https://${shopDomain}/admin/customers/${customerId}`,
        created_at: customer.createdAt
      },
      message: 'Customer created successfully'
    }

    if (idempotencyKey) {
      await recordFired(idempotencyKey, actionResult, payloadHash, {
        provider: 'shopify',
        externalId: customerId ?? null,
      })
    }

    return actionResult
  } catch (error: any) {
    logger.error('[Shopify GraphQL] Create customer error:', error)
    return {
      success: false,
      output: {},
      message: error.message || 'Failed to create customer'
    }
  }
}