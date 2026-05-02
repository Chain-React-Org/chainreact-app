/**
 * OAuth Callback Handler Utility
 *
 * Centralized OAuth callback logic with workspace context support.
 * Handles token exchange, integration storage, and permission granting.
 *
 * Created: 2025-10-28
 *
 * Usage:
 * ```typescript
 * export async function GET(request: NextRequest) {
 *   return handleOAuthCallback(request, {
 *     provider: 'gmail',
 *     tokenEndpoint: 'https://oauth2.googleapis.com/token',
 *     clientId: process.env.GOOGLE_CLIENT_ID!,
 *     clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
 *     getRedirectUri: (baseUrl) => `${baseUrl}/api/integrations/gmail/callback`,
 *     transformTokenData: (tokenData) => ({
 *       access_token: tokenData.access_token,
 *       refresh_token: tokenData.refresh_token,
 *       scopes: tokenData.scope?.split(' ') || [],
 *       expires_at: tokenData.expires_in
 *         ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
 *         : null
 *     })
 *   })
 * }
 * ```
 */

import { type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createPopupResponse } from '@/lib/utils/createPopupResponse'
import { getBaseUrl } from '@/lib/utils/getBaseUrl'
import { encrypt } from '@/lib/security/encryption'
import { logger } from '@/lib/utils/logger'
import { autoGrantPermissionsForIntegration } from '@/lib/services/integration-permissions'
import {
  computeTransitionAndNotify,
  buildRecoverySignal,
  type Integration as HealthIntegration,
} from '@/lib/integrations/healthTransitionEngine'

// ================================================================
// TYPES
// ================================================================

export interface OAuthState {
  userId: string
  provider: string
  reconnect?: boolean
  integrationId?: string
  // NEW: Workspace context
  workspaceType?: 'personal' | 'organization' | 'team'
  workspaceId?: string
}

export interface TokenData {
  access_token: string
  refresh_token?: string | null
  scopes: string[]
  expires_at: string | null
  [key: string]: any // Allow provider-specific fields
}

export interface OAuthCallbackConfig {
  provider: string
  tokenEndpoint: string
  clientId: string
  clientSecret: string
  getRedirectUri: (baseUrl: string) => string
  transformTokenData: (tokenData: any) => TokenData
  additionalIntegrationData?: (tokenData: any, state: OAuthState) => Record<string, any>
  onSuccess?: (integrationId: string, state: OAuthState) => Promise<void>
  // GitHub returns URL-encoded by default, needs JSON Accept header
  useJsonResponse?: boolean

  // --- Extensions for providers with non-standard OAuth flows ---

  /**
   * PKCE support: if true, looks up code_verifier from pkce_flow table using raw state param.
   * The code_verifier is passed to the token exchange and the pkce_flow record is cleaned up after.
   */
  requiresPkce?: boolean

  /**
   * Custom token exchange for providers that deviate from standard form-urlencoded POST.
   * Examples: Notion (JSON body + Basic auth), Shopify (dynamic URL), Facebook (GET-based),
   * Instagram (two-step short-to-long), PayPal (Basic auth + sandbox).
   * When provided, replaces the default exchangeCodeForToken call entirely.
   */
  customTokenExchange?: (params: {
    code: string
    redirectUri: string
    clientId: string
    clientSecret: string
    codeVerifier?: string
    request: NextRequest
    state: OAuthState
  }) => Promise<any>

  /**
   * Custom state parser for providers that don't use base64-encoded JSON state.
   * Example: Trello passes userId as a query param, not in state.
   * When provided, replaces the default parseOAuthState call.
   */
  parseState?: (request: NextRequest) => OAuthState

  /**
   * Custom save logic for providers that deviate from standard integration storage.
   * Examples: Notion (multi-workspace merge), Shopify (multi-store merge).
   * When provided, replaces the default saveIntegration call entirely.
   * Must return the integration ID.
   */
  customSave?: (params: {
    state: OAuthState
    provider: string
    tokenData: TokenData
    additionalData?: Record<string, any>
    rawTokenResponse: any
  }) => Promise<string>

  /**
   * Custom response builder for providers that don't use createPopupResponse.
   * Example: Trello returns jsonResponse instead of popup HTML.
   */
  customResponse?: (params: {
    type: 'success' | 'error'
    provider: string
    message: string
    baseUrl: string
    integrationId?: string
  }) => Response

  /**
   * Use Basic auth header instead of client credentials in POST body.
   * Used by: Notion, Airtable, Twitter, PayPal.
   * Only applies when customTokenExchange is NOT provided.
   */
  useBasicAuth?: boolean
}

// ================================================================
// MAIN HANDLER
// ================================================================

/**
 * Centralized OAuth callback handler
 * Handles the complete OAuth flow with workspace context
 */
export async function handleOAuthCallback(
  request: NextRequest,
  config: OAuthCallbackConfig
) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const stateParam = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const baseUrl = getBaseUrl()
  const startTime = Date.now()

  // Helper to build response (supports custom response builders like Trello's jsonResponse)
  const respond = (type: 'success' | 'error', message: string, integrationId?: string) => {
    const duration = Date.now() - startTime
    if (type === 'error') {
      logger.error(`[IntegrationRoute] Callback failed`, { provider: config.provider, error: message, duration })
    } else {
      logger.info(`[IntegrationRoute] Callback success`, { provider: config.provider, duration })
    }
    if (config.customResponse) {
      return config.customResponse({ type, provider: config.provider, message, baseUrl, integrationId })
    }
    return createPopupResponse(type, config.provider, message, baseUrl)
  }

  logger.info(`[IntegrationRoute] Callback called`, {
    provider: config.provider,
    hasCode: !!code,
    hasState: !!stateParam,
    error,
  })

  // Handle OAuth errors
  if (error) {
    return respond('error', `OAuth Error: ${error}`)
  }

  // Validate required params (unless custom state parser handles it differently)
  if (!code && !config.parseState) {
    return respond('error', `No code provided for ${config.provider} OAuth.`)
  }

  if (!stateParam && !config.parseState) {
    return respond('error', `No state provided for ${config.provider} OAuth.`)
  }

  try {
    // Parse state (custom parser for non-standard flows like Trello)
    const stateObject = config.parseState
      ? config.parseState(request)
      : parseOAuthState(stateParam!)

    if (!stateObject.userId) {
      return respond('error', `Missing userId in ${config.provider} state.`)
    }

    logger.info(`[IntegrationRoute] Callback state`, {
      provider: config.provider,
      userId: stateObject.userId,
      reconnect: stateObject.reconnect,
      workspaceType: stateObject.workspaceType,
    })

    // PKCE: look up code_verifier from pkce_flow table
    let codeVerifier: string | undefined
    if (config.requiresPkce && stateParam) {
      codeVerifier = await lookupPkceCodeVerifier(stateParam, config.provider)
    }

    // Exchange code for tokens
    let rawTokenResponse: any
    if (config.customTokenExchange) {
      rawTokenResponse = await config.customTokenExchange({
        code: code!,
        redirectUri: config.getRedirectUri(baseUrl),
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        codeVerifier,
        request,
        state: stateObject,
      })
    } else {
      rawTokenResponse = await exchangeCodeForToken(
        code!,
        config.tokenEndpoint,
        config.clientId,
        config.clientSecret,
        config.getRedirectUri(baseUrl),
        config.useJsonResponse,
        config.useBasicAuth,
        codeVerifier
      )
    }

    // Transform token data to standard format
    const standardTokenData = config.transformTokenData(rawTokenResponse)

    // Fetch additional integration data (e.g., email, avatar) if provided
    const additionalData = config.additionalIntegrationData
      ? await config.additionalIntegrationData(rawTokenResponse, stateObject)
      : undefined

    // Save integration to database (custom save for Notion/Shopify multi-account)
    let integrationId: string
    if (config.customSave) {
      integrationId = await config.customSave({
        state: stateObject,
        provider: config.provider,
        tokenData: standardTokenData,
        additionalData,
        rawTokenResponse,
      })
    } else {
      integrationId = await saveIntegration(
        stateObject,
        config.provider,
        standardTokenData,
        additionalData
      )
    }

    // Auto-grant permissions based on workspace context
    await grantWorkspacePermissions(
      integrationId,
      stateObject
    )

    // Call custom success handler if provided
    if (config.onSuccess) {
      await config.onSuccess(integrationId, stateObject)
    }

    // Clean up PKCE record after successful flow
    if (config.requiresPkce && stateParam) {
      await cleanupPkceRecord(stateParam, config.provider)
    }

    return respond('success', `${config.provider} connected successfully!`, integrationId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    return respond('error', message)
  }
}

// ================================================================
// HELPER FUNCTIONS
// ================================================================

/**
 * Parse OAuth state parameter
 */
function parseOAuthState(state: string): OAuthState {
  try {
    return JSON.parse(atob(state))
  } catch (error) {
    throw new Error('Invalid state parameter')
  }
}

/**
 * Exchange authorization code for access token
 */
async function exchangeCodeForToken(
  code: string,
  tokenEndpoint: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  useJsonResponse?: boolean,
  useBasicAuth?: boolean,
  codeVerifier?: string
): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }

  // GitHub needs Accept: application/json to return JSON instead of URL-encoded
  if (useJsonResponse) {
    headers['Accept'] = 'application/json'
  }

  // Basic auth: send credentials in Authorization header instead of body
  // Used by: Notion, Airtable, Twitter, PayPal
  if (useBasicAuth) {
    headers['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
  }

  const bodyParams: Record<string, string> = {
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  }

  // Only include client credentials in body when NOT using Basic auth
  if (!useBasicAuth) {
    bodyParams.client_id = clientId
    bodyParams.client_secret = clientSecret
  }

  // PKCE: include code_verifier when available
  if (codeVerifier) {
    bodyParams.code_verifier = codeVerifier
  }

  const tokenResponse = await fetch(tokenEndpoint, {
    method: 'POST',
    headers,
    body: new URLSearchParams(bodyParams),
  })

  if (!tokenResponse.ok) {
    const errorData = await tokenResponse.json()
    logger.error('Failed to exchange code for token:', errorData)
    throw new Error(errorData.error_description || 'Failed to get access token')
  }

  return tokenResponse.json()
}

/**
 * Look up PKCE code_verifier from pkce_flow table
 */
async function lookupPkceCodeVerifier(rawState: string, provider: string): Promise<string | undefined> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('pkce_flow')
    .select('code_verifier')
    .eq('state', rawState)
    .single()

  if (error || !data?.code_verifier) {
    logger.error(`[IntegrationRoute] PKCE lookup failed for ${provider}`, { error: error?.message })
    return undefined
  }

  return data.code_verifier
}

/**
 * Clean up PKCE record after successful OAuth flow
 */
async function cleanupPkceRecord(rawState: string, provider: string): Promise<void> {
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('pkce_flow')
    .delete()
    .eq('state', rawState)

  if (error) {
    // Non-fatal: log but don't throw
    logger.error(`[IntegrationRoute] PKCE cleanup failed for ${provider}`, { error: error.message })
  }
}

/**
 * Save integration to database with workspace context
 */
async function saveIntegration(
  state: OAuthState,
  provider: string,
  tokenData: TokenData,
  additionalData?: Record<string, any>
): Promise<string> {
  const supabase = createAdminClient()

  // Get encryption key
  const encryptionKey = process.env.ENCRYPTION_KEY
  if (!encryptionKey) {
    throw new Error('Encryption key not configured')
  }

  // Determine workspace context (default to personal)
  const workspaceType = state.workspaceType || 'personal'
  const workspaceId = state.workspaceId || null

  // Build integration data
  const integrationData: any = {
    provider,
    access_token: encrypt(tokenData.access_token, encryptionKey),
    refresh_token: tokenData.refresh_token
      ? encrypt(tokenData.refresh_token, encryptionKey)
      : null,
    scopes: tokenData.scopes,
    status: 'connected',
    expires_at: tokenData.expires_at,
    updated_at: new Date().toISOString(),
    // Clear disconnect fields on successful connection
    disconnect_reason: null,
    disconnected_at: null,
    // NEW: Workspace context
    workspace_type: workspaceType,
    workspace_id: workspaceId,
    connected_by: state.userId,
  }

  // user_id is the canonical owner column for personal integrations and is
  // queried by getDecryptedAccessToken / refreshToken / per-provider handlers.
  // For team/workspace integrations the connection is workspace-scoped, so
  // user_id is null and lookups go through workspace_id + connected_by.
  if (workspaceType === 'personal') {
    integrationData.user_id = state.userId
  } else {
    integrationData.user_id = null
  }

  // Extract account identity fields from additionalData and store as top-level fields
  // This makes them easier to query and display in the UI
  if (additionalData) {
    // Extract email (try multiple common field names)
    const email = additionalData.email || additionalData.userEmail || null
    if (email) {
      integrationData.email = email
    }

    // Extract username (try multiple common field names)
    const username = additionalData.username || additionalData.name || additionalData.user_name || null
    if (username) {
      integrationData.username = username
    }

    // Extract account_name (try multiple common field names)
    const accountName = additionalData.account_name || additionalData.accountName ||
                        additionalData.name || additionalData.real_name || email || null
    if (accountName) {
      integrationData.account_name = accountName
    }

    // Extract avatar_url (try multiple common field names)
    const avatarUrl = additionalData.avatar_url || additionalData.avatarUrl ||
                      additionalData.avatar || additionalData.picture ||
                      additionalData.profile_image || additionalData.profile_picture ||
                      additionalData.photo || null
    if (avatarUrl) {
      integrationData.avatar_url = avatarUrl
    }

    // Extract provider_user_id (try multiple common field names)
    const providerUserId = additionalData.provider_user_id || additionalData.providerUserId ||
                           additionalData.user_id || additionalData.userId ||
                           additionalData.id || null
    if (providerUserId) {
      integrationData.provider_user_id = providerUserId
    }

    // Extract team_id for Slack workspace identification (enables webhook filtering)
    // This allows webhook events to be routed to the correct integration by team ID
    const teamId = additionalData.team_id || additionalData.teamId || null
    if (teamId) {
      integrationData.team_id = teamId
    }

    // NEW: Set provider_account_id for multi-account deduplication (non-email accounts)
    // This is used when email is not available (e.g., Airtable, Trello)
    const providerAccountId = additionalData.provider_account_id || additionalData.account_id ||
                              additionalData.workspace_id || providerUserId || null
    if (providerAccountId) {
      integrationData.provider_account_id = String(providerAccountId)
    }

    // NEW: Set display_name for account selector UI
    // This is shown in dropdowns when user has multiple accounts
    const displayName = email || accountName || username ||
                        additionalData.display_name || additionalData.team_name ||
                        `${provider} Account`
    integrationData.display_name = displayName

    // Store all provider-specific data in metadata JSONB column for additional info
    if (Object.keys(additionalData).length > 0) {
      integrationData.metadata = {
        ...(integrationData.metadata || {}),
        ...additionalData
      }
    }
  }

  // Handle reconnect vs new connection
  if (state.reconnect && state.integrationId) {
    // Read current health state before updating (needed for transition engine)
    const { data: currentIntegration } = await supabase
      .from('integrations')
      .select('health_check_status, last_notification_milestone, requires_user_action, user_action_type, user_action_deadline')
      .eq('id', state.integrationId)
      .single()

    // Reset diagnostic counters on reconnect
    integrationData.consecutive_failures = 0
    integrationData.consecutive_transient_failures = 0

    // Update existing integration
    const { error } = await supabase
      .from('integrations')
      .update(integrationData)
      .eq('id', state.integrationId)

    if (error) {
      logger.error('Error updating integration:', error)
      throw new Error(`Database Error: ${error.message}`)
    }

    // Emit recovery signal through shared transition engine
    // The engine handles: state reset to healthy, milestone to 'recovered',
    // clearing error/deadline fields, and sending recovered notification.
    if (currentIntegration) {
      try {
        const healthIntegration: HealthIntegration = {
          id: state.integrationId,
          user_id: state.userId,
          provider,
          health_check_status: currentIntegration.health_check_status ?? null,
          last_notification_milestone: currentIntegration.last_notification_milestone ?? null,
          requires_user_action: currentIntegration.requires_user_action ?? false,
          user_action_type: currentIntegration.user_action_type ?? null,
          user_action_deadline: currentIntegration.user_action_deadline ?? null,
        }
        await computeTransitionAndNotify(supabase, healthIntegration, buildRecoverySignal())
      } catch (transitionError) {
        logger.error('Failed to process recovery transition:', transitionError)
        // Don't fail the reconnect if transition engine errors
      }
    }

    logger.info(`✅ Updated existing integration: ${state.integrationId}`)
    return state.integrationId
  } else {
    // ACCOUNT-BASED DEDUPLICATION: Check if this account already exists
    // This allows multiple accounts per provider (different emails/account_ids = different integrations)
    const email = integrationData.email
    const providerAccountId = integrationData.provider_account_id

    if (workspaceType === 'personal') {
      let existingIntegration = null

      // First, try to find by email if available
      if (email) {
        const { data } = await supabase
          .from('integrations')
          .select('id')
          .eq('user_id', state.userId)
          .eq('provider', provider)
          .eq('email', email)
          .eq('workspace_type', 'personal')
          .single()
        existingIntegration = data
      }

      // If no email match, try provider_account_id (for non-email providers like Airtable)
      if (!existingIntegration && providerAccountId) {
        const { data } = await supabase
          .from('integrations')
          .select('id')
          .eq('user_id', state.userId)
          .eq('provider', provider)
          .eq('provider_account_id', providerAccountId)
          .eq('workspace_type', 'personal')
          .single()
        existingIntegration = data
      }

      if (existingIntegration) {
        // Update existing integration (refresh tokens for same account)
        const { error } = await supabase
          .from('integrations')
          .update(integrationData)
          .eq('id', existingIntegration.id)

        if (error) {
          logger.error('Error updating integration by account:', error)
          throw new Error(`Database Error: ${error.message}`)
        }

        logger.info(`✅ Updated existing integration by account: ${existingIntegration.id}`)
        return existingIntegration.id
      }
    }

    // If email is different or doesn't exist, insert as new integration
    // This allows multiple accounts per provider
    if (workspaceType === 'personal') {
      const { data, error } = await supabase
        .from('integrations')
        .insert(integrationData)
        .select('id')
        .single()

      if (error) {
        logger.error('Error inserting integration:', error)
        throw new Error(`Database Error: ${error.message}`)
      }

      logger.info(`✅ Created new integration: ${data.id}`)
      return data.id
    } else {
      // For team/org, check by email if available
      if (email) {
        const { data: existingIntegration } = await supabase
          .from('integrations')
          .select('id')
          .eq('provider', provider)
          .eq('email', email)
          .eq('workspace_type', workspaceType)
          .eq('workspace_id', workspaceId)
          .single()

        if (existingIntegration) {
          // Update existing team/org integration
          const { error } = await supabase
            .from('integrations')
            .update(integrationData)
            .eq('id', existingIntegration.id)

          if (error) {
            logger.error('Error updating team/org integration:', error)
            throw new Error(`Database Error: ${error.message}`)
          }

          logger.info(`✅ Updated existing team/org integration: ${existingIntegration.id}`)
          return existingIntegration.id
        }
      }

      // Insert new team/org integration
      const { data, error } = await supabase
        .from('integrations')
        .insert(integrationData)
        .select('id')
        .single()

      if (error) {
        logger.error('Error inserting integration:', error)
        throw new Error(`Database Error: ${error.message}`)
      }

      logger.info(`✅ Created new team/org integration: ${data.id}`)
      return data.id
    }
  }
}

/**
 * Grant permissions based on workspace context
 */
async function grantWorkspacePermissions(
  integrationId: string,
  state: OAuthState
): Promise<void> {
  // Skip permission granting for reconnects (permissions already exist)
  if (state.reconnect) {
    logger.info('Skipping permission grant for reconnect')
    return
  }

  const workspaceType = state.workspaceType || 'personal'
  const workspaceId = state.workspaceId || undefined

  const workspaceContext = {
    type: workspaceType,
    id: workspaceId,
  }

  logger.info('Granting permissions for workspace context:', workspaceContext)

  const result = await autoGrantPermissionsForIntegration(
    integrationId,
    workspaceContext,
    state.userId
  )

  if (!result.success) {
    logger.error('Failed to grant permissions:', result.error)
    throw new Error(`Failed to grant permissions: ${result.error}`)
  }

  logger.info('✅ Permissions granted successfully')
}

// ================================================================
// STATE BUILDER UTILITY
// ================================================================

/**
 * Build OAuth state parameter with workspace context
 * Use this when initiating OAuth flow
 */
export function buildOAuthState(params: {
  userId: string
  provider: string
  reconnect?: boolean
  integrationId?: string
  workspaceType?: 'personal' | 'organization' | 'team'
  workspaceId?: string
}): string {
  const state: OAuthState = {
    userId: params.userId,
    provider: params.provider,
    reconnect: params.reconnect,
    integrationId: params.integrationId,
    workspaceType: params.workspaceType || 'personal',
    workspaceId: params.workspaceId,
  }

  return btoa(JSON.stringify(state))
}
