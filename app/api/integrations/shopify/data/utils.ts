/**
 * Shopify Integration Utilities
 */

import { ShopifyIntegration, ShopifyApiError } from './types'
import { decrypt } from '@/lib/security/encryption'
import { logger } from '@/lib/utils/logger'

/**
 * Get Shopify shop domain from integration metadata
 * @param integration - The integration object
 * @param selectedShop - Optional: specific shop domain to use (for multi-store support)
 */
export function getShopDomain(integration: ShopifyIntegration, selectedShop?: string): string {
  const metadata = integration.metadata as any

  // If a specific shop is requested, use that
  if (selectedShop) {
    // Verify it's in the stores list
    const stores = metadata?.stores || []
    const storeExists = stores.some((s: any) => s.shop === selectedShop)
    if (storeExists) {
      return selectedShop
    }
    logger.info(`Requested shop ${selectedShop} not found in stores list, falling back to default`)
  }

  // Try active_store from metadata
  if (metadata?.active_store) {
    return metadata.active_store
  }

  // Try stores array (use first store)
  if (metadata?.stores && metadata.stores.length > 0) {
    return metadata.stores[0].shop
  }

  // Legacy: Try single shop field
  if (metadata?.shop) {
    return metadata.shop
  }

  // Legacy: Try top-level shop_domain
  if (integration.shop_domain) {
    return integration.shop_domain
  }

  throw new Error('Shop domain not found in integration. Please reconnect your Shopify account.')
}

/**
 * Create Shopify API request headers
 */
export async function getShopifyHeaders(integration: ShopifyIntegration): Promise<Record<string, string>> {
  if (!integration.access_token) {
    throw new Error('No access token available')
  }

  const decryptedToken = await decrypt(integration.access_token)

  return {
    'X-Shopify-Access-Token': decryptedToken,
    'Content-Type': 'application/json',
  }
}

/**
 * Make authenticated GraphQL request to Shopify Admin API
 */
export async function makeShopifyGraphQLRequest(
  integration: ShopifyIntegration,
  query: string,
  variables?: Record<string, any>,
  selectedStore?: string
): Promise<any> {
  const shopDomain = getShopDomain(integration, selectedStore)
  const headers = await getShopifyHeaders(integration)

  const url = `https://${shopDomain}/admin/api/2024-10/graphql.json`

  // Q8b — `variables` may contain customer PII (emails, names, addresses);
  // debug-only.
  logger.debug('[Shopify GraphQL] Making request:', {
    url,
    query: query.substring(0, 100) + '...',
    variables
  })

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('[Shopify GraphQL] HTTP error:', {
      status: response.status,
      error: errorText
    })
    throw createShopifyApiError(
      `Shopify GraphQL HTTP error: ${response.status} - ${errorText}`,
      response.status
    )
  }

  const result = await response.json()

  // GraphQL returns 200 even with errors, check for GraphQL errors
  if (result.errors && result.errors.length > 0) {
    const errorMessages = result.errors.map((e: any) => e.message).join(', ')
    logger.error('[Shopify GraphQL] Query errors:', { errors: result.errors })
    throw new Error(`Shopify GraphQL error: ${errorMessages}`)
  }

  // Check for userErrors in the mutation response
  if (result.data) {
    const mutationKey = Object.keys(result.data)[0]
    const mutationData = result.data[mutationKey]

    if (mutationData?.userErrors && mutationData.userErrors.length > 0) {
      const userErrorMessages = mutationData.userErrors
        .map((e: any) => `${e.field ? e.field.join('.') + ': ' : ''}${e.message}`)
        .join(', ')
      logger.error('[Shopify GraphQL] User errors:', { userErrors: mutationData.userErrors })
      throw new Error(`Shopify validation error: ${userErrorMessages}`)
    }
  }

  return result.data
}

/**
 * Make authenticated request to Shopify Admin API (REST - Legacy)
 * @deprecated Use makeShopifyGraphQLRequest instead
 */
export async function makeShopifyRequest(
  integration: ShopifyIntegration,
  endpoint: string,
  options: RequestInit = {},
  selectedStore?: string
): Promise<any> {
  const shopDomain = getShopDomain(integration, selectedStore)
  const headers = await getShopifyHeaders(integration)

  const url = `https://${shopDomain}/admin/api/2024-01/${endpoint}`

  logger.info('[Shopify REST] Making request:', { url, method: options.method || 'GET' })

  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    let errorData: any = null
    try {
      errorData = JSON.parse(errorText)
    } catch (err) {
      // ignore parse errors; keep raw text
    }
    logger.error('[Shopify REST] API error:', {
      status: response.status,
      error: errorText
    })
    throw createShopifyApiError(
      `Shopify API error: ${response.status} - ${errorText}`,
      response.status,
      errorData
    )
  }

  return response.json()
}

/**
 * Create Shopify API error with proper context
 */
export function createShopifyApiError(message: string, status?: number, errorData?: any): ShopifyApiError {
  const error = new Error(message) as ShopifyApiError
  error.status = status
  error.name = 'ShopifyApiError'

  if (status === 401) {
    error.message = 'Shopify authentication expired. Please reconnect your account.'
  } else if (status === 403) {
    error.message = 'Shopify API access forbidden. Check your app permissions.'
  } else if (status === 429) {
    error.message = 'Shopify API rate limit exceeded. Please try again later.'
  } else if (status === 404) {
    error.message = 'Shopify resource not found.'
  } else if (status === 422) {
    const validationMessage = extractShopifyValidationMessage(errorData)
    error.message = validationMessage || 'Shopify rejected the data you sent. Please double‑check required fields.'
  }

  return error
}

function extractShopifyValidationMessage(errorData?: any): string | null {
  if (!errorData) return null

  // Shopify commonly returns { errors: { field: ['message'] } } or { errors: ['message'] }
  const errors = errorData.errors
  if (!errors) return null

  if (Array.isArray(errors)) {
    return errors[0]
  }

  if (typeof errors === 'object') {
    for (const [field, value] of Object.entries(errors)) {
      if (Array.isArray(value) && value.length > 0) {
        return `Shopify validation error for "${field}": ${value[0]}`
      }
      if (typeof value === 'string') {
        return `Shopify validation error for "${field}": ${value}`
      }
    }
  }

  return null
}

/**
 * Validate Shopify integration has required access token
 */
export function validateShopifyIntegration(integration: ShopifyIntegration): void {
  if (!integration) {
    throw new Error('Shopify integration not found')
  }

  if (!integration.access_token) {
    throw new Error('Shopify authentication required. Please reconnect your account.')
  }

  if (integration.provider !== 'shopify') {
    throw new Error('Invalid integration provider. Expected Shopify.')
  }

  // Check for shop domain in either top-level field or metadata
  const metadata = integration.metadata as any
  const hasShopInMetadata =
    Boolean(metadata?.shop) ||
    Boolean(metadata?.active_store) ||
    (Array.isArray(metadata?.stores) && metadata.stores.length > 0)

  if (!integration.shop_domain && !hasShopInMetadata) {
    throw new Error('Shop domain not found. Please reconnect your Shopify account.')
  }
}
