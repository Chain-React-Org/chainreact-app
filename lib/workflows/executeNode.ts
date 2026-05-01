import { TokenRefreshService } from "../integrations/tokenRefreshService"
import type { Integration } from "@/types/integration"
import { createSupabaseServerClient } from "@/utils/supabase/server"
import { decrypt } from "@/lib/security/encryption"
import { getSecret } from "@/lib/secrets"
import { createClient } from "@supabase/supabase-js"
import { FileStorageService } from "@/lib/storage/fileStorage"
import { google } from 'googleapis'

// Import from the new registry system
import { actionHandlerRegistry, getWaitForTimeHandler } from './actions/registry'
import { executeGenericAction } from './actions/generic'
import { ActionResult } from './actions'
import { createExecutionLogEntry, storeExecutionLog, formatExecutionLogEntry } from './execution/executionLogger'
import { logInfo, logError, logSuccess } from '@/lib/logging/backendLogger'

// Import AI-related functionality
import {
  summarizeContent,
  extractInformation,
  analyzeSentiment,
  translateText,
  generateContent,
  classifyContent,
} from './actions/aiDataProcessing'
import { executeAIAgent } from './aiAgent'
import { processAIFields as processAIFieldsForChains, ProcessingContext } from './ai/fieldProcessor'
import { processAIFields, hasAIPlaceholders } from './ai/aiFieldProcessor'
import { resolveValue, resolveValueWithTracking } from './actions/core/resolveValue'

import { logger } from '@/lib/utils/logger'
import { validateIntegrationAccess } from '@/lib/workflows/security/integrationAccessValidator'
// Re-export getIntegrationById for backward compatibility
export { getIntegrationById } from './integrationHelpers'

/**
 * Generate mock output for sandbox mode based on action type
 */
function generateMockOutput(type: string, config: any): any {
  // Generate realistic mock data based on action type
  switch(type) {
    case 'gmail_send':
    case 'gmail_action_send_email':
      return {
        id: `mock_email_${Date.now()}`,
        threadId: `mock_thread_${Date.now()}`,
        labelIds: ['SENT'],
        message: 'Email sent successfully (sandbox mode)'
      }
    
    case 'slack_send_message':
      return {
        ok: true,
        channel: config.channel || 'mock_channel',
        ts: String(Date.now() / 1000),
        message: { text: config.text || 'Mock message' }
      }
    
    case 'discord_send_message':
      return {
        id: `mock_discord_${Date.now()}`,
        content: config.content || 'Mock Discord message',
        channel_id: config.channelId || 'mock_channel',
        author: { id: 'mock_bot', username: 'Workflow Bot' }
      }
    
    case 'airtable_create_record':
      return {
        id: `rec_mock_${Date.now()}`,
        fields: config.fields || {},
        createdTime: new Date().toISOString()
      }
    
    default:
      return {
        success: true,
        mockData: true,
        timestamp: new Date().toISOString(),
        action: type
      }
  }
}

/**
 * Generate preview of what would be sent in sandbox mode
 */
function getMockPreview(type: string, config: any): any {
  // Return a preview of what would have been sent to external services
  switch(type) {
    case 'gmail_send':
    case 'gmail_action_send_email':
      return {
        to: config.to || 'recipient@example.com',
        subject: config.subject || 'Test Email',
        body: config.body || 'This email would have been sent.',
        cc: config.cc,
        bcc: config.bcc
      }
    
    case 'slack_send_message':
      return {
        channel: config.channel || '#general',
        text: config.text || 'Test message',
        blocks: config.blocks
      }
    
    case 'discord_send_message':
      return {
        channelId: config.channelId,
        content: config.content || 'Test message',
        embeds: config.embeds
      }
    
    default:
      return config
  }
}

/**
 * Wrapper function for AI agent execution that adapts to the executeAction signature
 */
async function executeAIAgentWrapper(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Resolve any variable references in the config using the enhanced resolveValue function
    const resolvedConfig = resolveValue(config, input)
    
    const result = await executeAIAgent({
      userId,
      config: resolvedConfig,
      input,
      workflowContext: {
        nodes: [],
        previousResults: input.nodeOutputs || {}
      }
    })
    
    return {
      success: result.success,
      output: {
        output: result.output || "" // Structure matches outputSchema: { output: "AI response text" }
      },
      message: result.message || "AI Agent execution completed"
    }
  } catch (error: any) {
    logger.error("AI Agent execution error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "AI Agent execution failed"
    }
  }
}

/**
 * Interface for action execution parameters
 */
export interface ExecuteActionParams {
  node: any
  input: Record<string, any>
  userId: string
  workflowId: string
  testMode?: boolean
  executionMode?: 'sandbox' | 'live' | 'production'
}

/**
 * Get decrypted access token by integration ID.
 *
 * Security: Requires either `userId` for permission validation or
 * `trustedServerContext: true` for server-internal operations.
 * Calls with neither will throw (fail closed).
 */
export async function getDecryptedAccessTokenById(
  integrationId: string,
  options?: { userId?: string; trustedServerContext?: boolean }
): Promise<string> {
  try {
    const userId = options?.userId
    const isTrusted = options?.trustedServerContext === true

    // Fail closed: missing execution context is an error
    if (!userId && !isTrusted) {
      logger.error(`[getDecryptedAccessTokenById] Called without userId or trustedServerContext for integration ${integrationId}`)
      throw new Error('Access denied: you do not have permission to use this integration. Contact the integration admin to request access.')
    }

    // Validate permission before fetching credentials
    if (userId && !isTrusted) {
      await validateIntegrationAccess(userId, integrationId)
    }

    const supabase = await createSupabaseServerClient()

    // Get the integration by ID
    const { data: integration, error } = await supabase
      .from("integrations")
      .select("*")
      .eq("id", integrationId)
      .single()

    if (error || !integration) {
      // Same generic error as permission denial — no information leakage
      logger.error(`[getDecryptedAccessTokenById] Integration ${integrationId} not found or DB error:`, error)
      throw new Error('Access denied: you do not have permission to use this integration. Contact the integration admin to request access.')
    }

    return decryptIntegrationToken(integration)
  } catch (error: any) {
    logger.error(`Error in getDecryptedAccessTokenById:`, {
      message: error.message,
      integrationId
    })
    throw error
  }
}

/**
 * Get integration record by ID (useful for getting provider info, tokens, etc.)
 */

/**
 * Internal function to decrypt an integration's access token
 */
async function decryptIntegrationToken(integration: any): Promise<string> {
  // Cast the integration to the proper type
  const typedIntegration = integration as unknown as Integration

  // Check if token needs refresh
  const shouldRefresh = TokenRefreshService.shouldRefreshToken(typedIntegration, {
    accessTokenExpiryThreshold: 5 // Refresh if expiring within 5 minutes
  })

  let accessToken = integration.access_token

  if (shouldRefresh.shouldRefresh && integration.refresh_token) {
    logger.info(`Refreshing token for ${integration.provider}: ${shouldRefresh.reason}`)

    const refreshResult = await TokenRefreshService.refreshTokenForProvider(
      integration.provider,
      integration.refresh_token,
      typedIntegration
    )

    if (refreshResult.success && refreshResult.accessToken) {
      accessToken = refreshResult.accessToken
      logger.info(`Token refresh successful for ${integration.provider}`)
    } else {
      logger.error(`Token refresh failed for ${integration.provider}:`, refreshResult.error)
      throw new Error(`Failed to refresh ${integration.provider} token: ${refreshResult.error}`)
    }
  }

  if (!accessToken) {
    throw new Error(`No valid access token for ${integration.provider}`)
  }

  const secret = await getSecret("encryption_key")
  if (!secret) {
    logger.error("Encryption key not found in environment")
    throw new Error("Encryption secret not configured. Please set ENCRYPTION_KEY environment variable.")
  }

  logger.info(`Attempting to decrypt access token for ${integration.provider}`)

  try {
    const decryptedToken = decrypt(accessToken, secret)
    logger.info(`Successfully decrypted access token for ${integration.provider}`)
    return decryptedToken
  } catch (decryptError: any) {
    logger.error(`Decryption failed for ${integration.provider}:`, {
      error: decryptError.message,
      tokenFormat: accessToken.includes(':') ? 'encrypted' : 'plain',
      tokenLength: accessToken.length
    })

    // If the token doesn't have the expected format, it might be stored as plain text
    if (!accessToken.includes(':')) {
      logger.info(`Token for ${integration.provider} appears to be stored as plain text, returning as-is`)
      return accessToken
    }

    throw new Error(`Failed to decrypt ${integration.provider} access token: ${decryptError.message}`)
  }
}

export async function getDecryptedAccessToken(userId: string, provider: string, integrationId?: string): Promise<string> {
  try {
    // If integrationId is provided, use it directly (multi-account support)
    if (integrationId) {
      return getDecryptedAccessTokenById(integrationId, { userId })
    }

    const supabase = await createSupabaseServerClient()

    // Get the user's integration (fallback: first account for backward compatibility)
    const { data: integration, error } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", provider)
      .order("created_at", { ascending: true }) // Use oldest (first connected) for backward compatibility
      .limit(1)
      .single()

    if (error) {
      logger.error(`Database error fetching integration for ${provider}:`, error)
      throw new Error(`Database error: ${error.message}`)
    }

    if (!integration) {
      throw new Error(`No integration found for ${provider}`)
    }

    // Use shared decryption function
    return decryptIntegrationToken(integration)
  } catch (error: any) {
    logger.error(`Error in getDecryptedAccessToken for ${provider}:`, {
      message: error.message,
      stack: error.stack,
      userId,
      provider
    })
    throw error
  }
}

/**
 * Execute a single workflow node
 * This is a simplified wrapper for use in chain execution
 */
export async function executeNode(
  node: any,
  context: any,
  userId: string
): Promise<any> {
  // Build the ExecuteActionParams from the simplified inputs
  const params: ExecuteActionParams = {
    node,
    input: context.data || context,
    userId,
    workflowId: context.workflowId,
    testMode: context.testMode || false,
    executionMode: context.testMode ? 'sandbox' : 'live'
  }

  try {
    const result = await executeAction(params)
    return result
  } catch (error) {
    logger.error(`Failed to execute node ${node.id}:`, error)
    throw error
  }
}

/**
 * Main function to execute a workflow action node
 * Routes to the appropriate handler based on node type
 */
export async function executeAction({ node, input, userId, workflowId, testMode, executionMode }: ExecuteActionParams): Promise<ActionResult> {
  logger.info(`📌 executeAction received userId: ${userId}, workflowId: ${workflowId}`)
  
  const { type, config } = node.data
  const startTime = Date.now()
  
  // Determine if we're in sandbox mode
  const isSandboxMode = executionMode === 'sandbox' || (testMode === true && executionMode !== 'live')
  
  // Create initial log entry for started status
  const startLogEntry = createExecutionLogEntry(
    node,
    'started',
    {
      trigger: node.data.isTrigger ? input?.trigger : undefined,
      input: { config, previousOutputs: input?.previousResults }
    }
  )
  
  // Store and log the start
  if (workflowId) {
    storeExecutionLog(workflowId, startLogEntry)
    const formattedLog = formatExecutionLogEntry(startLogEntry)
    logger.info('[Execution Started]', formattedLog)
    // Add to backend logger for debug modal
    if (input?.executionId) {
      logInfo(input.executionId, '[Execution Started]', formattedLog)
    }
  }
  
  // Process AI fields if needed
  const aiProcessedConfig = await processAIFieldsIfNeeded(type, config, {
    userId,
    workflowId: workflowId || 'unknown',
    executionId: input?.executionId || 'unknown',
    nodeId: node.id || 'unknown',
    trigger: input?.trigger,
    previousResults: input?.previousResults
  })

  // Resolve template variables ({{trigger.subject}}, {{nodeId.field}}, etc.)
  // This is CRITICAL for variable substitution to work in action configs
  // When testing actions without real trigger data, provide sample values so the message is readable
  const mockTriggerOutputs = !input?.trigger ? {
    // Gmail trigger variables
    from: { value: 'sender@example.com' },
    to: { value: 'you@company.com' },
    subject: { value: 'Sample Email Subject' },
    body: { value: 'This is a sample email body from the trigger.' },
    snippet: { value: 'This is a sample email snippet...' },
    date: { value: new Date().toLocaleDateString() },
    id: { value: 'msg_sample_12345' },
    threadId: { value: 'thread_sample_67890' },
    messageId: { value: '<sample@example.com>' },
    receivedAt: { value: new Date().toISOString() },
    attachments: { value: '[]' },
    // Slack trigger variables
    user: { value: '@sampleuser' },
    username: { value: 'Sample User' },
    text: { value: 'Sample message text from trigger' },
    channel: { value: '#sample-channel' },
    channelId: { value: 'C12345678' },
    ts: { value: Date.now().toString() },
    // Discord trigger variables
    author: { value: 'SampleUser#1234' },
    content: { value: 'Sample Discord message content' },
    channelName: { value: '#general' },
    // Generic variables
    name: { value: 'Sample Name' },
    email: { value: 'sample@example.com' },
    message: { value: 'Sample message content' },
    title: { value: 'Sample Title' },
    description: { value: 'Sample description text' },
  } : undefined

  const { resolved: processedConfig, unresolvedRefs } = resolveValueWithTracking(aiProcessedConfig, input, mockTriggerOutputs)

  // Log unresolved variable references as warnings
  if (unresolvedRefs.length > 0) {
    logger.warn(`⚠️ [executeNode] ${type}: ${unresolvedRefs.length} unresolved variable reference(s):`,
      unresolvedRefs.map(r => r.reference).join(', ')
    )
  }

  // Check if environment is properly configured
  const hasSupabaseConfig = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const hasEncryptionKey = process.env.ENCRYPTION_KEY

  if (!hasSupabaseConfig) {
    logger.warn("Supabase configuration missing, running in test mode")
    return { 
      success: true, 
      output: { test: true, mockResult: true }, 
      message: `Test mode: ${type} executed successfully (missing Supabase config)` 
    }
  }

  // Special handling for wait_for_time action that needs workflow context
  if (type === "wait_for_time") {
    const handler = getWaitForTimeHandler(workflowId, node.id)
    try {
      const result = await handler(processedConfig, userId, input)
      const executionTime = Date.now() - startTime

      // Check if the action actually succeeded
      if (result.success === false) {
        const errorMessage = result.message || result.error || 'Wait action failed'
        const error = new Error(errorMessage)

        const errorEntry = createExecutionLogEntry(node, 'error', {
          input: { config: processedConfig, previousOutputs: input?.previousResults },
          error: { message: errorMessage, details: result.error, output: result.output },
          executionTime
        })

        if (workflowId) {
          storeExecutionLog(workflowId, errorEntry)
          logger.error('[Wait Failed]', formatExecutionLogEntry(errorEntry))
        }

        throw error
      }

      const logEntry = createExecutionLogEntry(node, 'completed', {
        input: { config: processedConfig, previousOutputs: input?.previousResults },
        output: result.output || result,
        executionTime
      })

      if (workflowId) {
        storeExecutionLog(workflowId, logEntry)
        logger.info('[Wait Completed]', formatExecutionLogEntry(logEntry))
      }

      return result
    } catch (error: any) {
      const executionTime = Date.now() - startTime
      const errorEntry = createExecutionLogEntry(node, 'error', {
        input: { config: processedConfig, previousOutputs: input?.previousResults },
        error: { message: error.message, stack: error.stack },
        executionTime
      })
      
      if (workflowId) {
        storeExecutionLog(workflowId, errorEntry)
        logger.info('[Wait Error]', formatExecutionLogEntry(errorEntry))
      }
      throw error
    }
  }

  // Special handling for AI-driven nodes so we can keep detailed logging
  if (type === "ai_agent" || type === "ai_message") {
    const aiHandler = actionHandlerRegistry[type]
    if (!aiHandler) {
      throw new Error(`No handler registered for ${type}`)
    }

    try {
      const result = await aiHandler({ config: processedConfig, userId, input })
      const executionTime = Date.now() - startTime

      // Check if the action actually succeeded
      if (result.success === false) {
        const errorMessage = result.message || result.error || `${type} failed`
        const error = new Error(errorMessage)

        const errorEntry = createExecutionLogEntry(node, 'error', {
          input: { config: processedConfig, previousOutputs: input?.previousResults },
          error: { message: errorMessage, details: result.error, output: result.output },
          executionTime
        })

        if (workflowId) {
          storeExecutionLog(workflowId, errorEntry)
          logger.error(`[${type === "ai_agent" ? "AI Agent" : "AI Message"} Failed]`, formatExecutionLogEntry(errorEntry))
        }

        throw error
      }

      const logEntry = createExecutionLogEntry(node, 'completed', {
        input: { config: processedConfig, previousOutputs: input?.previousResults },
        output: result.output || result,
        executionTime
      })

      if (workflowId) {
        storeExecutionLog(workflowId, logEntry)
        logger.info(`[${type === "ai_agent" ? "AI Agent" : "AI Message"} Completed]`, formatExecutionLogEntry(logEntry))
      }

      return result
    } catch (error: any) {
      const executionTime = Date.now() - startTime
      const errorEntry = createExecutionLogEntry(node, 'error', {
        input: { config: processedConfig, previousOutputs: input?.previousResults },
        error: { message: error.message, stack: error.stack },
        executionTime
      })
      
      if (workflowId) {
        storeExecutionLog(workflowId, errorEntry)
        logger.info(`[${type === "ai_agent" ? "AI Agent" : "AI Message"} Error]`, formatExecutionLogEntry(errorEntry))
      }
      throw error
    }
  }

  // SANDBOX MODE INTERCEPTION
  // If we're in sandbox mode, return mock data instead of executing real actions
  if (isSandboxMode) {
    logger.info(`[SANDBOX MODE] Intercepting ${type} action - no external calls will be made`)
    
    // Generate mock response based on action type
    const mockOutput = generateMockOutput(type, processedConfig)
    
    const logEntry = createExecutionLogEntry(node, 'completed', {
      input: { config: processedConfig, previousOutputs: input?.previousResults },
      output: mockOutput,
      executionTime: Date.now() - startTime,
      sandboxMode: true
    })
    
    if (workflowId) {
      storeExecutionLog(workflowId, logEntry)
      logger.info('[SANDBOX Completed]', formatExecutionLogEntry(logEntry))
    }
    
    return {
      success: true,
      output: mockOutput,
      message: `[SANDBOX] ${type} executed successfully (no external calls made)`,
      sandbox: true,
      intercepted: {
        type,
        config: processedConfig,
        wouldHaveSent: getMockPreview(type, processedConfig)
      }
    }
  }

  // Get the appropriate handler from the registry
  const handler = actionHandlerRegistry[type]

  // If there's no handler for this node type, try the generic handler
  if (!handler) {
    logger.info(`Using generic handler for node type: ${type}`)
    try {
      const result = await executeGenericAction(
        { ...processedConfig, actionType: type },
        userId,
        input
      )
      const executionTime = Date.now() - startTime

      // Check if the action actually succeeded
      if (result.success === false) {
        const errorMessage = result.message || result.error || 'Generic action failed'
        const error = new Error(errorMessage)

        const errorEntry = createExecutionLogEntry(node, 'error', {
          input: { config: processedConfig, previousOutputs: input?.previousResults },
          error: { message: errorMessage, details: result.error, output: result.output },
          executionTime
        })

        if (workflowId) {
          storeExecutionLog(workflowId, errorEntry)
          logger.error('[Generic Action Failed]', formatExecutionLogEntry(errorEntry))
        }

        throw error
      }

      const logEntry = createExecutionLogEntry(node, 'completed', {
        input: { config: processedConfig, previousOutputs: input?.previousResults },
        output: result.output || result,
        executionTime
      })

      if (workflowId) {
        storeExecutionLog(workflowId, logEntry)
        logger.info('[Generic Action Completed]', formatExecutionLogEntry(logEntry))
      }

      return result
    } catch (error: any) {
      const executionTime = Date.now() - startTime
      const errorEntry = createExecutionLogEntry(node, 'error', {
        input: { config: processedConfig, previousOutputs: input?.previousResults },
        error: { message: error.message, stack: error.stack },
        executionTime
      })
      
      if (workflowId) {
        storeExecutionLog(workflowId, errorEntry)
        logger.info('[Generic Action Error]', formatExecutionLogEntry(errorEntry))
      }
      throw error
    }
  }

  // For encryption-dependent handlers, check if encryption key is available
  if (!hasEncryptionKey &&
      (type.startsWith('gmail_') ||
       type.startsWith('google_sheets_') ||
       type.startsWith('google_drive_') ||
       type.startsWith('google-drive:') ||
       type.startsWith('airtable_'))) {
    logger.warn(`Encryption key missing, running ${type} in test mode`)
    return { 
      success: true, 
      output: { 
        test: true,
        mockResult: true,
        mockType: type
      }, 
      message: `Test mode: ${type} executed successfully (missing encryption key)` 
    }
  }

  // Execute the handler with the processed parameters
  // Build context for actions that need workflowId, nodeId, executionId (like HITL)
  const executionContext = {
    workflowId,
    nodeId: node.id,
    executionId: input?.executionId,
    testMode,
    executionMode,
    userId
  }

  // PR-C4 — engine-thread metadata for within-session idempotency. Handlers
  // that opt in (those updated under PR-C4) read `params.meta` to build
  // their `(executionSessionId, nodeId, actionType)` idempotency key. Older
  // handlers that don't read `meta` ignore this field.
  const handlerMeta = {
    executionSessionId: input?.executionId,
    nodeId: node.id,
    actionType: type,
    testMode,
  }

  try {
    const result = await handler({
      config: processedConfig,
      userId,
      input,
      context: executionContext,
      meta: handlerMeta,
    })
    const executionTime = Date.now() - startTime

    // CRITICAL: Check if the action actually succeeded
    // Some actions return {success: false} instead of throwing errors
    // This check ensures ALL failures are caught and properly reported
    if (result.success === false) {
      const errorMessage = result.message || result.error || 'Action failed without error message'
      const error = new Error(errorMessage)
      ;(error as any).details = result.output

      // Create error log entry
      const errorLogEntry = createExecutionLogEntry(
        node,
        'error',
        {
          trigger: node.data.isTrigger ? input?.trigger : undefined,
          input: { config: processedConfig, previousOutputs: input?.previousResults },
          error: {
            message: errorMessage,
            details: result.error || result.details,
            output: result.output
          },
          executionTime
        }
      )

      // Store and log the error
      if (workflowId) {
        storeExecutionLog(workflowId, errorLogEntry)
        const formattedLog = formatExecutionLogEntry(errorLogEntry)
        logger.error('[Execution Failed]', formattedLog)
        // Add to backend logger for debug modal
        if (input?.executionId) {
          logError(input.executionId, '[Execution Failed]', formattedLog)
        }
      }

      throw error
    }

    // Create success log entry
    const successLogEntry = createExecutionLogEntry(
      node,
      'completed',
      {
        trigger: node.data.isTrigger ? input?.trigger : undefined,
        input: { config: processedConfig, previousOutputs: input?.previousResults },
        output: result.output || result,
        executionTime
      }
    )

    // Store and log the success
    if (workflowId) {
      storeExecutionLog(workflowId, successLogEntry)
      const formattedLog = formatExecutionLogEntry(successLogEntry)
      logger.info('[Execution Completed]', formattedLog)
      // Add to backend logger for debug modal
      if (input?.executionId) {
        logSuccess(input.executionId, '[Execution Completed]', formattedLog)
      }
    }

    return result
  } catch (error: any) {
    const executionTime = Date.now() - startTime
    
    // Create error log entry
    const errorLogEntry = createExecutionLogEntry(
      node,
      'error',
      {
        trigger: node.data.isTrigger ? input?.trigger : undefined,
        input: { config: processedConfig, previousOutputs: input?.previousResults },
        error: {
          message: error.message || 'Unknown error',
          details: error.details,
          stack: error.stack
        },
        executionTime
      }
    )
    
    // Store and log the error
    if (workflowId) {
      storeExecutionLog(workflowId, errorLogEntry)
      const formattedLog = formatExecutionLogEntry(errorLogEntry)
      logger.error('[Execution Error]', formattedLog)
      // Add to backend logger for debug modal
      if (input?.executionId) {
        logError(input.executionId, '[Execution Error]', formattedLog)
      }
    }
    
    throw error
  }
}

/**
 * Process AI fields in configuration if needed
 */
async function processAIFieldsIfNeeded(
  nodeType: string,
  config: any,
  context: {
    userId: string
    workflowId: string
    executionId: string
    nodeId: string
    trigger?: any
    previousResults?: any
  }
): Promise<any> {
  // Check if any fields need AI placeholder processing ({{AI_FIELD:fieldName}})
  const hasAIPlaceholders = Object.values(config).some(value =>
    typeof value === 'string' && value.includes('{{AI_FIELD:')
  )

  // Check if any fields need chain-based AI processing
  const needsChainProcessing = Object.values(config).some(value =>
    typeof value === 'string' && (
      value.includes('[') ||
      value.includes('{{AI:')
    )
  )

  // If no processing needed and not AI router, return original config
  if (!hasAIPlaceholders && !needsChainProcessing && nodeType !== 'ai_router') {
    return config
  }

  let processedConfig = config

  // First, process AI placeholders ({{AI_FIELD:fieldName}})
  if (hasAIPlaceholders) {
    try {
      processedConfig = await processAIFields(processedConfig, {
        nodeType,
        workflowContext: context.workflowId,
        triggerData: context.trigger,
        previousOutputs: context.previousResults,
        apiKey: config.customApiKey || config.apiKey
      })
    } catch (error) {
      logger.error('AI placeholder processing failed:', error)
      // Continue with original config if AI processing fails
    }
  }

  // Then, process chain-based AI fields if needed
  if (needsChainProcessing || nodeType === 'ai_router') {
    // Build processing context for chain processing
    const processingContext: ProcessingContext = {
      userId: context.userId,
      workflowId: context.workflowId,
      executionId: context.executionId,
      nodeId: context.nodeId,
      nodeType,
      triggerData: context.trigger,
      previousNodes: context.previousResults ? new Map(Object.entries(context.previousResults)) : undefined,
      config: processedConfig,
      availableActions: nodeType === 'ai_router' ? getAvailableActions(processedConfig) : undefined,
      apiKey: processedConfig.customApiKey || processedConfig.apiKey,
      model: processedConfig.model
    }

    try {
      const result = await processAIFieldsForChains(processingContext)

      // For AI Router, handle routing decision
      if (nodeType === 'ai_router' && result.routing) {
        return {
          ...processedConfig,
          ...result.fields,
          _aiRouting: result.routing // Special field for routing decision
        }
      }

      // Return config with processed fields
      return {
        ...processedConfig,
        ...result.fields
      }
    } catch (error) {
      logger.error('AI chain processing failed:', error)
      // Continue with processed config if chain processing fails
    }
  }

  return processedConfig
}

/**
 * Get available actions from AI Router config
 */
function getAvailableActions(config: any): string[] {
  if (!config.outputPaths) return []
  
  return config.outputPaths
    .filter((path: any) => path.actionId)
    .map((path: any) => path.actionId)
}
