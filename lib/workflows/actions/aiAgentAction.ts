/**
 * Autonomous AI Agent Action Handler
 *
 * This AI agent is fully autonomous - it automatically:
 * 1. Detects connected output paths and workflow chains
 * 2. Analyzes input data and user prompt
 * 3. Decides if it needs to generate content for downstream nodes
 * 4. Determines which path to route to (if multiple paths exist)
 * 5. Executes intelligently without requiring mode selection
 */

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { logger } from '@/lib/utils/logger'
import type { ActionResult } from './core/executeWait'
import type { ExecutionContext } from '../core/executeWorkflow'
import { resolveValue } from './core/resolveValue'
import { missingRequiredFieldAsResult } from './core/requireExplicitField'
import { AI_MODELS } from '@/lib/ai/models'
import {
  getOpenAIClient,
  getOpenAIClientWithKey,
} from '@/lib/ai/openai-client'
import {
  getAnthropicClient,
  getAnthropicClientWithKey,
} from '@/lib/ai/anthropic-client'

/**
 * Default AI agent generation parameters.
 *
 * §A3 — these used to be hardcoded inline at the call site
 * (`config.model || 'gpt-4o-mini'`, `config.temperature ?? 0.7`,
 * `config.maxTokens || 1500`). The model literal violated the
 * CLAUDE.md rule "never hardcode model strings — use AI_MODELS."
 *
 * Resolution: `model` routes through `AI_MODELS.fast` (centralized
 * registry, single source of truth for model identifiers).
 * `temperature` and `maxTokens` stay as named constants in this file
 * because they're behavioral defaults specific to the AI agent action,
 * not application-wide tuning knobs. The schema in `aiAgentNode.ts`
 * declares the same defaults at the field level, and these constants
 * are the engine-side fallback when a config row predates the schema's
 * defaultValue (e.g., legacy workflow rows).
 */
const AI_AGENT_DEFAULT_TEMPERATURE = 0.7
const AI_AGENT_DEFAULT_MAX_TOKENS = 1500

// Helper to create supabase client for fetching user profile
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

/**
 * User profile context for signature
 */
interface UserProfileContext {
  fullName?: string
  firstName?: string
  lastName?: string
  company?: string
  jobTitle?: string
  email?: string
  username?: string
}

/**
 * Fetches user profile for signature
 */
async function fetchUserProfile(userId: string): Promise<UserProfileContext> {
  try {
    const { data: profile, error } = await getSupabase()
      .from('user_profiles')
      .select('full_name, first_name, last_name, company, job_title, username')
      .eq('user_id', userId)
      .single()

    if (error || !profile) {
      logger.info(`[AI Agent] Could not fetch user profile: ${error?.message || 'not found'}`)
      return {}
    }

    const { data: authUser } = await getSupabase().auth.admin.getUserById(userId)

    return {
      fullName: profile.full_name || undefined,
      firstName: profile.first_name || undefined,
      lastName: profile.last_name || undefined,
      company: profile.company || undefined,
      jobTitle: profile.job_title || undefined,
      username: profile.username || undefined,
      email: authUser?.user?.email || undefined
    }
  } catch (error) {
    logger.error('[AI Agent] Error fetching user profile:', error)
    return {}
  }
}

/**
 * Build signature based on config and user profile
 */
function buildSignature(
  config: {
    includeSignature?: string
    customSignature?: string
    signaturePrefix?: string
  },
  userProfile: UserProfileContext
): string {
  const signatureType = config.includeSignature || 'none'

  if (signatureType === 'none') {
    return ''
  }

  // Get sign-off prefix
  const prefixMap: Record<string, string> = {
    'best': 'Best regards,',
    'thanks': 'Thanks,',
    'sincerely': 'Sincerely,',
    'cheers': 'Cheers,',
    'regards': 'Regards,',
    'none': ''
  }
  const signOff = prefixMap[config.signaturePrefix || 'best'] || 'Best regards,'

  if (signatureType === 'custom' && config.customSignature) {
    // Custom signature - use as-is (already includes sign-off)
    return `\n\n${config.customSignature}`
  }

  // Build from user profile
  const userName = userProfile.fullName || userProfile.firstName || userProfile.username || ''

  if (!userName) {
    return '' // No name available, skip signature
  }

  if (signatureType === 'name_only') {
    return signOff ? `\n\n${signOff}\n${userName}` : `\n\n${userName}`
  }

  if (signatureType === 'full') {
    const parts = [userName]
    if (userProfile.jobTitle) parts.push(userProfile.jobTitle)
    if (userProfile.company) parts.push(userProfile.company)
    if (userProfile.email) parts.push(userProfile.email)

    return signOff
      ? `\n\n${signOff}\n${parts.join('\n')}`
      : `\n\n${parts.join('\n')}`
  }

  return ''
}

/**
 * Clean up AI-generated text by removing placeholders and unnecessary sign-offs
 */
function cleanAIOutput(text: string): string {
  if (!text) return text

  return text
    // Remove common placeholder patterns
    .replace(/\[Your Name\]/gi, '')
    .replace(/\[Your Title\]/gi, '')
    .replace(/\[Your Position\]/gi, '')
    .replace(/\[Your Company\]/gi, '')
    .replace(/\[Company Name\]/gi, '')
    .replace(/\[Your Email\]/gi, '')
    .replace(/\[Your Phone\]/gi, '')
    .replace(/\[Date\]/gi, '')
    .replace(/\[Time\]/gi, '')
    .replace(/\[Your Organization\]/gi, '')
    .replace(/\[Organization Name\]/gi, '')
    .replace(/\[Your Signature\]/gi, '')
    .replace(/\[Insert .*?\]/gi, '')
    .replace(/\[Add .*?\]/gi, '')
    .replace(/\[.*? Name\]/gi, '')
    .replace(/\[.*? Title\]/gi, '')
    .replace(/\[.*? Information\]/gi, '')

    // Remove sign-off patterns at the end of messages (with or without names following)
    .replace(/\n\n?(Best regards|Sincerely|Kind regards|Regards|Best|Thank you|Thanks|Cheers|Warm regards|With regards|Respectfully),?\s*\n*[A-Z][a-zA-Z]*(\s+[A-Z][a-zA-Z]*)*\s*$/i, '')
    .replace(/\n\n?(Best regards|Sincerely|Kind regards|Regards|Best|Thank you|Thanks|Cheers|Warm regards|With regards|Respectfully),?\s*\n?$/i, '')
    .replace(/\n\n?(Best regards|Sincerely|Kind regards|Regards|Best|Thank you|Thanks|Cheers|Warm regards|With regards|Respectfully),?\s*$/i, '')

    // Remove trailing empty lines and spaces
    .replace(/\n+$/, '')
    .trim()
}

/**
 * Extract email subject from input data for reply context
 */
function extractEmailSubject(input: Record<string, any>): string | null {
  // Try various paths where email subject might be stored
  const possiblePaths = [
    input.subject,
    input.email?.subject,
    input.message?.subject,
    input.trigger?.subject,
    input.data?.subject,
    input.originalEmail?.subject,
    input.incomingEmail?.subject
  ]

  for (const subject of possiblePaths) {
    if (subject && typeof subject === 'string' && subject.trim()) {
      return subject.trim()
    }
  }

  return null
}

/**
 * ========================================
 * INTELLIGENT CONTEXT DETECTION
 * ========================================
 * These functions analyze the workflow to automatically determine
 * what the AI should do without requiring manual configuration.
 */

/**
 * Task types the AI can perform
 */
type TaskType = 'respond' | 'extract' | 'summarize' | 'classify' | 'translate' | 'generate' | 'analyze' | 'custom' | 'unknown'

/**
 * Build prompt from action type configuration (like Zapier's pre-built actions)
 * This converts the structured config into an effective prompt.
 *
 * Q11 — when `actionType === 'respond'`, `respondInstructions` is required.
 * The prior silent fallback ('Respond helpfully to the incoming message')
 * is removed: AI behavior is too central to workflow output to silently
 * substitute. Returns `{ ok: false, missingField }` so the caller can
 * surface MISSING_REQUIRED_FIELD without firing the LLM call.
 */
type BuildPromptResult =
  | { ok: true; prompt: string; taskType: TaskType }
  | { ok: false; missingField: string }

function buildPromptFromActionType(config: any): BuildPromptResult {
  const actionType = config.actionType || 'custom'

  switch (actionType) {
    case 'respond': {
      const instructions = config.respondInstructions
      if (instructions === undefined || instructions === null || instructions === '') {
        return { ok: false, missingField: 'respondInstructions' }
      }
      return {
        ok: true,
        prompt: instructions,
        taskType: 'respond',
      }
    }

    case 'extract': {
      const fields = config.extractFields || ''
      // Parse fields - could be a list or a description
      const fieldLines = fields.split('\n').filter((l: string) => l.trim())
      const isFieldList = fieldLines.every((l: string) => /^[a-z_]+$/i.test(l.trim()))

      if (isFieldList && fieldLines.length > 0) {
        return {
          ok: true,
          prompt: `Extract the following fields from the input:\n${fieldLines.map((f: string) => `- ${f.trim()}`).join('\n')}\n\nReturn ONLY a JSON object with these exact field names.`,
          taskType: 'extract',
        }
      }
      return {
        ok: true,
        prompt: `${fields}\n\nExtract the requested information and return it as structured data.`,
        taskType: 'extract',
      }
    }

    case 'summarize': {
      const format = config.summarizeFormat || 'bullets'
      const focus = config.summarizeFocus || ''
      const formatInstructions: Record<string, string> = {
        bullets: 'Summarize in 3-5 bullet points',
        paragraph: 'Summarize in a short paragraph (2-3 sentences)',
        oneliner: 'Summarize in one sentence',
        detailed: 'Provide a detailed summary with clear sections'
      }
      return {
        ok: true,
        prompt: `${formatInstructions[format]}${focus ? `. Focus on: ${focus}` : ''}`,
        taskType: 'summarize',
      }
    }

    case 'classify': {
      const categories = config.classifyCategories || ''
      const allowMultiple = config.classifyMultiple === 'multiple'

      // Check for preset keywords
      const lowerCats = categories.toLowerCase()
      let categoryList: string[]

      if (lowerCats.includes('sentiment')) {
        categoryList = ['positive', 'negative', 'neutral']
      } else if (lowerCats.includes('priority')) {
        categoryList = ['high', 'medium', 'low']
      } else if (lowerCats.includes('urgency')) {
        categoryList = ['urgent', 'normal', 'low']
      } else {
        categoryList = categories.split('\n').map((c: string) => c.trim()).filter((c: string) => c && !c.startsWith('"'))
      }

      return {
        ok: true,
        prompt: `Classify the input into ${allowMultiple ? 'one or more of' : 'exactly one of'} these categories:\n${categoryList.map(c => `- ${c}`).join('\n')}\n\nReturn JSON with "category"${allowMultiple ? ' (array)' : ''}, "confidence" (0-1), and "reasoning".`,
        taskType: 'classify',
      }
    }

    case 'translate': {
      const targetLang = config.translateTo === 'other' ? config.translateToCustom : config.translateTo
      const preserveFormatting = config.translatePreserve !== 'no'
      const langNames: Record<string, string> = {
        spanish: 'Spanish', french: 'French', german: 'German', italian: 'Italian',
        portuguese: 'Portuguese', chinese: 'Chinese (Simplified)', japanese: 'Japanese',
        korean: 'Korean', arabic: 'Arabic', hindi: 'Hindi', russian: 'Russian', dutch: 'Dutch'
      }
      const langName = langNames[targetLang] || targetLang || 'Spanish'

      return {
        ok: true,
        prompt: `Translate the input to ${langName}.${preserveFormatting ? ' Preserve any formatting (markdown, HTML, etc.).' : ''} Return ONLY the translated text, nothing else.`,
        taskType: 'translate',
      }
    }

    case 'generate': {
      const genType = config.generateType || 'email'
      const instructions = config.generateInstructions || ''
      const typeContext: Record<string, string> = {
        email: 'Generate an email',
        message: 'Generate a chat message',
        social: 'Generate a social media post',
        document: 'Generate a document',
        description: 'Generate a product description',
        other: 'Generate content'
      }

      return {
        ok: true,
        prompt: `${typeContext[genType]}:\n${instructions}`,
        taskType: 'generate',
      }
    }

    case 'custom':
    default:
      return {
        ok: true,
        prompt: config.prompt || '',
        taskType: 'custom',
      }
  }
}

/**
 * Detected input context
 */
interface InputContext {
  type: 'email' | 'message' | 'form' | 'document' | 'data' | 'unknown'
  hasSubject: boolean
  hasSender: boolean
  hasBody: boolean
  senderName?: string
  senderEmail?: string
  subject?: string
  isReply: boolean
}

/**
 * Detected output requirements
 */
interface OutputRequirements {
  type: 'email' | 'message' | 'structured_data' | 'document' | 'text' | 'unknown'
  needsSubject: boolean
  needsBody: boolean
  needsStructuredFields: boolean
  needsSignature: boolean
  targetApp?: string
}

/**
 * Detect task type from user's prompt
 */
function detectTaskType(prompt: string): TaskType {
  const lowerPrompt = prompt.toLowerCase()

  // Response/Reply patterns
  if (/\b(respond|reply|answer|write back|get back to|draft a response|draft response|compose a reply)\b/.test(lowerPrompt)) {
    return 'respond'
  }

  // Extraction patterns
  if (/\b(extract|pull out|get the|find the|parse|identify|capture)\b.*\b(from|in|out of)\b/.test(lowerPrompt) ||
      /\b(name|email|phone|address|date|number|amount|price)\b.*\b(from|in)\b/.test(lowerPrompt)) {
    return 'extract'
  }

  // Summarization patterns
  if (/\b(summarize|summary|summarise|tldr|brief|shorten|condense|key points|main points|highlights)\b/.test(lowerPrompt)) {
    return 'summarize'
  }

  // Classification patterns
  if (/\b(classify|categorize|categorise|label|tag|sort into|determine if|is this|sentiment|positive|negative|neutral|urgent|priority)\b/.test(lowerPrompt)) {
    return 'classify'
  }

  // Translation patterns
  if (/\b(translate|translation|convert to|in spanish|in french|in german|in chinese|in japanese|to english)\b/.test(lowerPrompt)) {
    return 'translate'
  }

  // Analysis patterns
  if (/\b(analyze|analyse|review|evaluate|assess|examine|check|look at)\b/.test(lowerPrompt)) {
    return 'analyze'
  }

  // Generation patterns (write, create, draft, generate)
  if (/\b(write|create|draft|generate|compose|make|build|produce)\b/.test(lowerPrompt)) {
    return 'generate'
  }

  return 'unknown'
}

/**
 * Analyze input data to understand what we're working with
 */
function analyzeInputContext(input: Record<string, any>): InputContext {
  const context: InputContext = {
    type: 'unknown',
    hasSubject: false,
    hasSender: false,
    hasBody: false,
    isReply: false
  }

  // Check for email indicators
  const emailIndicators = ['subject', 'from', 'to', 'cc', 'bcc', 'body', 'snippet', 'threadId', 'labelIds']
  const hasEmailFields = emailIndicators.some(field =>
    input[field] !== undefined || input.email?.[field] !== undefined || input.message?.[field] !== undefined
  )

  if (hasEmailFields) {
    context.type = 'email'
    context.hasSubject = !!(input.subject || input.email?.subject || input.message?.subject)
    context.hasSender = !!(input.from || input.sender || input.email?.from)
    context.hasBody = !!(input.body || input.snippet || input.email?.body || input.message?.body || input.content)
    context.subject = input.subject || input.email?.subject || input.message?.subject
    context.isReply = true // If we have email input, we're likely replying

    // Extract sender info
    const fromField = input.from || input.sender || input.email?.from
    if (fromField) {
      if (typeof fromField === 'string') {
        const emailMatch = fromField.match(/<(.+?)>/)
        const nameMatch = fromField.match(/^([^<]+)/)
        context.senderEmail = emailMatch?.[1] || fromField
        context.senderName = nameMatch?.[1]?.trim()
      } else if (typeof fromField === 'object') {
        context.senderEmail = fromField.email || fromField.address
        context.senderName = fromField.name
      }
    }
    return context
  }

  // Check for message/chat indicators (Discord, Slack, etc.)
  const messageIndicators = ['content', 'author', 'channel', 'guild', 'timestamp', 'user', 'text']
  const hasMessageFields = messageIndicators.some(field => input[field] !== undefined || input.message?.[field] !== undefined)

  if (hasMessageFields) {
    context.type = 'message'
    context.hasBody = !!(input.content || input.text || input.message?.content)
    context.hasSender = !!(input.author || input.user || input.sender)

    const authorField = input.author || input.user || input.sender
    if (authorField) {
      context.senderName = typeof authorField === 'string' ? authorField : (authorField.username || authorField.name)
    }
    return context
  }

  // Check for form submission indicators
  const formIndicators = ['formId', 'fields', 'responses', 'submission', 'answers']
  if (formIndicators.some(field => input[field] !== undefined)) {
    context.type = 'form'
    return context
  }

  // Check for document indicators
  const docIndicators = ['title', 'content', 'text', 'document', 'page', 'html']
  if (docIndicators.some(field => input[field] !== undefined)) {
    context.type = 'document'
    context.hasBody = !!(input.content || input.text || input.body)
    return context
  }

  // Default to data if we have any structured input
  if (Object.keys(input).length > 0) {
    context.type = 'data'
  }

  return context
}

/**
 * Analyze downstream nodes to determine output requirements
 */
function analyzeDownstreamRequirements(context: ExecutionContext): OutputRequirements {
  const requirements: OutputRequirements = {
    type: 'text',
    needsSubject: false,
    needsBody: false,
    needsStructuredFields: false,
    needsSignature: false
  }

  // Check if we have workflow context with nodes
  const nodes = context.workflowContext?.nodes || context.nodes || []
  const connections = context.workflowContext?.connections || context.connections || []
  const currentNodeId = context.nodeId

  if (!currentNodeId || nodes.length === 0) {
    return requirements
  }

  // Find downstream nodes (nodes that this node connects to)
  const downstreamNodeIds = connections
    .filter((conn: any) => conn.source === currentNodeId || conn.sourceHandle?.startsWith(currentNodeId))
    .map((conn: any) => conn.target)

  const downstreamNodes = nodes.filter((node: any) => downstreamNodeIds.includes(node.id))

  for (const node of downstreamNodes) {
    const nodeType = node.data?.type || node.type || ''
    const nodeTypeLower = nodeType.toLowerCase()

    // Email actions
    if (nodeTypeLower.includes('gmail') || nodeTypeLower.includes('outlook') || nodeTypeLower.includes('email') || nodeTypeLower.includes('send_email')) {
      requirements.type = 'email'
      requirements.needsSubject = true
      requirements.needsBody = true
      requirements.needsSignature = true
      requirements.targetApp = 'email'
      break
    }

    // Messaging actions
    if (nodeTypeLower.includes('slack') || nodeTypeLower.includes('discord') || nodeTypeLower.includes('teams') || nodeTypeLower.includes('message')) {
      requirements.type = 'message'
      requirements.needsBody = true
      requirements.needsSignature = false // Messages typically don't need signatures
      requirements.targetApp = nodeTypeLower.includes('slack') ? 'slack' :
                              nodeTypeLower.includes('discord') ? 'discord' :
                              nodeTypeLower.includes('teams') ? 'teams' : 'message'
      break
    }

    // Database/CRM actions
    if (nodeTypeLower.includes('notion') || nodeTypeLower.includes('airtable') || nodeTypeLower.includes('sheets') ||
        nodeTypeLower.includes('hubspot') || nodeTypeLower.includes('salesforce') || nodeTypeLower.includes('database')) {
      requirements.type = 'structured_data'
      requirements.needsStructuredFields = true
      requirements.targetApp = nodeTypeLower.split('_')[0]
      break
    }

    // Document actions
    if (nodeTypeLower.includes('docs') || nodeTypeLower.includes('document') || nodeTypeLower.includes('drive')) {
      requirements.type = 'document'
      requirements.needsBody = true
      break
    }
  }

  return requirements
}

/**
 * Combined smart context for AI generation
 */
interface SmartContext {
  taskType: TaskType
  inputContext: InputContext
  outputRequirements: OutputRequirements
}

/**
 * Build complete smart context from all sources
 */
function buildSmartContext(
  prompt: string,
  input: Record<string, any>,
  context: ExecutionContext
): SmartContext {
  return {
    taskType: detectTaskType(prompt),
    inputContext: analyzeInputContext(input),
    outputRequirements: analyzeDownstreamRequirements(context)
  }
}

/**
 * §A3 — the inline `getOpenAIClient` / `getAnthropicClient` and their
 * module-level cached singletons used to live here. Removed in favor of
 * the shared clients in `lib/ai/{openai,anthropic}-client.ts`, which
 * already implement the same lazy-init + custom-key pattern. See
 * CLAUDE.md "import { getOpenAIClient } from '@/lib/ai/openai-client'
 * — never new OpenAI()" for the canonical rule.
 *
 * Call sites use `apiKey ? getOpenAIClientWithKey(apiKey) : getOpenAIClient()`
 * (and the parallel Anthropic helpers) to choose between the user's
 * custom key and the app-managed default.
 */

/**
 * Main Autonomous AI Agent Handler
 *
 * This agent automatically decides what to do based on:
 * - Connected output paths (single vs multiple)
 * - Downstream node requirements
 * - Input data and user prompt
 * - Output format hints
 */
export async function executeAIAgentAction(
  config: any,
  input: Record<string, any>,
  context: ExecutionContext
): Promise<ActionResult> {
  const startTime = Date.now()

  logger.info('[AI Agent] Starting autonomous execution', {
    model: config.model,
    nodeId: context.nodeId,
    hasMultipleOutputs: context.hasMultipleOutputs
  })

  try {
    // Step 1: Analyze workflow context
    const workflowContext = analyzeWorkflowContext(context, config)

    logger.info('[AI Agent] Workflow context analyzed', {
      needsContentGeneration: workflowContext.needsContentGeneration,
      needsRouting: workflowContext.needsRouting,
      outputPathCount: workflowContext.outputPaths?.length || 0
    })

    // Step 1.5: Fetch user profile for signature
    const userProfile = await fetchUserProfile(context.userId)
    logger.info('[AI Agent] User profile fetched', {
      hasName: !!(userProfile.fullName || userProfile.firstName),
      hasSignatureConfig: !!config.includeSignature
    })

    // Step 2: Build prompt from action type OR use custom prompt.
    // This converts structured config (like Zapier's UI) into an effective
    // prompt. Q11 — when actionType='respond' lacks an explicit
    // respondInstructions, the builder returns ok:false and the handler
    // surfaces MISSING_REQUIRED_FIELD without firing the LLM call.
    const promptResult = buildPromptFromActionType(config)
    if (!promptResult.ok) {
      return missingRequiredFieldAsResult(promptResult.missingField)
    }
    const { prompt: builtPrompt, taskType: configuredTaskType } = promptResult
    const userPrompt = await resolveValue(builtPrompt, input, context.userId, context)

    logger.info('[AI Agent] Action type processed', {
      actionType: config.actionType || 'custom',
      configuredTaskType,
      promptLength: userPrompt.length
    })

    // Step 2.5: Build SMART context - use configured task type if explicit, otherwise detect
    const detectedContext = buildSmartContext(userPrompt, input, context)
    // Override detected task type with configured type (unless custom/unknown)
    const smartContext: SmartContext = {
      ...detectedContext,
      taskType: configuredTaskType !== 'custom' && configuredTaskType !== 'unknown'
        ? configuredTaskType
        : detectedContext.taskType
    }
    logger.info('[AI Agent] Smart context detected', {
      taskType: smartContext.taskType,
      inputType: smartContext.inputContext.type,
      outputType: smartContext.outputRequirements.type,
      targetApp: smartContext.outputRequirements.targetApp,
      needsSignature: smartContext.outputRequirements.needsSignature
    })

    // Step 3: Build additional context from previous steps
    let additionalContext = ''
    if (config.includeContextFrom && config.includeContextFrom.length > 0) {
      additionalContext = buildAdditionalContext(config.includeContextFrom, context)
    }

    // Step 3.5: Extract email subject for reply context
    const originalEmailSubject = extractEmailSubject(input) || smartContext.inputContext.subject || null
    logger.info('[AI Agent] Email subject extracted', { originalEmailSubject })

    // Step 4: Build intelligent system prompt based on context
    const systemPrompt = buildAutonomousSystemPrompt(workflowContext, config, userProfile, smartContext)

    // Step 5: Build enhanced user prompt with all context
    const enhancedPrompt = buildEnhancedUserPrompt(
      userPrompt,
      additionalContext,
      workflowContext,
      input,
      config,
      originalEmailSubject,
      smartContext
    )

    // Step 6: Execute AI with autonomous decision-making
    const response = await generateWithAI(
      config,
      systemPrompt,
      enhancedPrompt,
      workflowContext
    )

    // Step 7: Parse and structure the response
    const result = parseAutonomousResponse(response, workflowContext, config, userProfile, originalEmailSubject, smartContext)

    // Step 8: Add execution metadata
    const executionTime = Date.now() - startTime
    result.data = {
      ...result.data,
      executionTime,
      modelUsed: config.model,
      autonomous: true,
      context: {
        needsContentGeneration: workflowContext.needsContentGeneration,
        needsRouting: workflowContext.needsRouting
      }
    }

    logger.info('[AI Agent] Autonomous execution completed', {
      executionTime,
      success: result.success,
      hasOutput: !!result.data.output,
      selectedPath: result.data.selectedPath
    })

    return result

  } catch (error: any) {
    logger.error('[AI Agent] Autonomous execution failed', {
      error: error.message,
      nodeId: context.nodeId
    })

    return {
      success: false,
      data: {
        error: error.message,
        executionTime: Date.now() - startTime
      }
    }
  }
}

/**
 * ========================================
 * AUTONOMOUS WORKFLOW ANALYSIS
 * ========================================
 */

interface WorkflowContext {
  needsContentGeneration: boolean
  needsRouting: boolean
  outputPaths?: Array<{ id: string; name: string; description?: string }>
  downstreamNodeTypes?: string[]
  hasMultipleOutputs: boolean
}

/**
 * Analyze the workflow to determine what the AI needs to do
 */
function analyzeWorkflowContext(context: ExecutionContext, config: any): WorkflowContext {
  const workflowContext: WorkflowContext = {
    needsContentGeneration: false,
    needsRouting: false,
    hasMultipleOutputs: false
  }

  // Check if there are multiple output paths
  // This would come from the workflow graph analysis
  // For now, we'll use a simple heuristic based on config
  const hasOutputPaths = config.outputPaths && config.outputPaths.length > 1

  if (hasOutputPaths) {
    workflowContext.needsRouting = true
    workflowContext.hasMultipleOutputs = true
    workflowContext.outputPaths = config.outputPaths
  }

  // Check if output format hint suggests content generation is needed
  const hasOutputFormat = config.outputFormat && config.outputFormat.trim().length > 0

  // Always assume content generation is needed unless we're ONLY routing
  // The AI can decide not to generate if it's purely a routing decision
  workflowContext.needsContentGeneration = true

  return workflowContext
}

/**
 * Build an intelligent system prompt based on workflow context
 */
function buildAutonomousSystemPrompt(
  workflowContext: WorkflowContext,
  config: any,
  userProfile?: UserProfileContext,
  smartContext?: SmartContext
): string {
  const hasOutputFormat = config.outputFormat && config.outputFormat.trim().length > 0

  // Build user identity for personalization
  const userName = userProfile?.fullName || userProfile?.firstName || userProfile?.username || ''
  const userIdentity = userName ? `You are responding on behalf of ${userName}.` : ''

  // Determine tone from config or default based on task type
  const tone = config.tone || 'professional'
  const toneMap: Record<string, string> = {
    professional: 'professional and business-appropriate',
    friendly: 'warm and approachable',
    casual: 'relaxed and conversational',
    formal: 'polished and traditional',
    concise: 'brief and to the point'
  }
  const toneDescription = toneMap[tone] || toneMap.professional

  let systemPrompt = `You are an intelligent workflow automation agent. You analyze inputs and generate appropriate responses.
${userIdentity}

COMMUNICATION STYLE: Be ${toneDescription}.

YOUR TASK:`

  // Add task-specific instructions based on smart context
  if (smartContext) {
    const { taskType, inputContext, outputRequirements } = smartContext

    // Task-specific guidance
    switch (taskType) {
      case 'respond':
        systemPrompt += `
You are responding to a ${inputContext.type === 'email' ? 'email' : inputContext.type === 'message' ? 'message' : 'communication'}.
${inputContext.senderName ? `The sender's name is ${inputContext.senderName}.` : ''}
Write a helpful, natural response that directly addresses their message.`
        break

      case 'extract':
        systemPrompt += `
You are extracting specific data from the input.
Return ONLY the extracted values in a clean, structured format.
Do not include explanatory text or commentary.`
        break

      case 'summarize':
        systemPrompt += `
You are summarizing content.
Provide a clear, concise summary that captures the key points.
Use bullet points for multiple items when appropriate.`
        break

      case 'classify':
        systemPrompt += `
You are classifying/categorizing content.
Analyze the input and provide a clear classification.
Include a confidence level when appropriate.`
        break

      case 'translate':
        systemPrompt += `
You are translating content.
Provide an accurate translation that preserves the original meaning and tone.
Do not include the original text unless requested.`
        break

      case 'analyze':
        systemPrompt += `
You are analyzing content.
Provide clear insights and observations.
Be objective and thorough.`
        break

      case 'generate':
      default:
        systemPrompt += `
Generate appropriate content based on the user's request.
Provide ONLY the requested content, clean and ready to use.`
        break
    }

    // Output format guidance based on downstream needs
    if (outputRequirements.type === 'email') {
      systemPrompt += `

OUTPUT FORMAT: You are generating content for an EMAIL.
- The response will be sent as an email
- Write the email body naturally, as if writing to a real person
- Be appropriately ${toneDescription}
- Do NOT include "Subject:" or email headers in your response`
    } else if (outputRequirements.type === 'message') {
      const platform = outputRequirements.targetApp || 'messaging platform'
      systemPrompt += `

OUTPUT FORMAT: You are generating content for ${platform.toUpperCase()}.
- Keep messages appropriate for ${platform}
- ${platform === 'slack' ? 'You can use Slack markdown formatting' : ''}
- ${platform === 'discord' ? 'You can use Discord markdown formatting' : ''}
- Be conversational and direct`
    } else if (outputRequirements.type === 'structured_data') {
      systemPrompt += `

OUTPUT FORMAT: You are generating structured data.
- Return clean, well-formatted data
- Use consistent field naming
- Ensure data types are appropriate (strings, numbers, booleans)`
    }
  } else {
    // Fallback for when smart context is not available
    if (workflowContext.needsContentGeneration && workflowContext.needsRouting) {
      systemPrompt += `
You need to BOTH generate content AND decide which path to route to.

ROUTING OPTIONS:
${workflowContext.outputPaths?.map(path =>
  `- ${path.name} (id: ${path.id})${path.description ? ': ' + path.description : ''}`
).join('\n') || 'No paths defined'}

Your response should include:
1. Generated content for downstream nodes
2. Routing decision with reasoning`
    } else if (workflowContext.needsRouting) {
      systemPrompt += `
You need to analyze the input and decide which workflow path to take.

ROUTING OPTIONS:
${workflowContext.outputPaths?.map(path =>
  `- ${path.name} (id: ${path.id})${path.description ? ': ' + path.description : ''}`
).join('\n') || 'No paths defined'}

Your response should include:
1. Routing decision (selectedPath)
2. Confidence score (0-1)
3. Reasoning for your decision`
    } else {
      systemPrompt += `
Generate appropriate content based on the user's request.
Provide ONLY the requested content, clean and ready to use.`
    }
  }

  // Add routing context if needed
  if (workflowContext.needsRouting && workflowContext.outputPaths) {
    systemPrompt += `

ROUTING OPTIONS:
${workflowContext.outputPaths.map(path =>
  `- ${path.name} (id: ${path.id})${path.description ? ': ' + path.description : ''}`
).join('\n')}

Include routing decision in your response with selectedPath, confidence, and reasoning.`
  }

  // Add user's custom instructions if provided
  if (config.systemInstructions) {
    systemPrompt += `\n\nADDITIONAL INSTRUCTIONS:\n${config.systemInstructions}`
  }

  // Only add output format guidance if explicitly configured
  if (hasOutputFormat) {
    systemPrompt += `\n\nSTRUCTURED OUTPUT REQUIRED:
Extract or generate the following structured data:
${config.outputFormat}

Provide these as structured fields in your response.`
  }

  systemPrompt += `\n\nCRITICAL RULES:
- NEVER use placeholder text like [Your Name], [Your Title], [Company Name], [Date], etc.
- NEVER add a signature or sign-off (like "Best regards," "Sincerely," "Thanks,", etc.) - signatures are added automatically when configured
- End your response with the actual content - NO closing salutation or name
- Be ${toneDescription}
- Generate content that is ready to use directly`

  return systemPrompt
}

/**
 * Build enhanced user prompt with all context
 */
function buildEnhancedUserPrompt(
  userPrompt: string,
  additionalContext: string,
  workflowContext: WorkflowContext,
  input: Record<string, any>,
  config: any,
  originalEmailSubject?: string | null,
  smartContext?: SmartContext
): string {
  let prompt = `USER REQUEST:\n${userPrompt}\n`

  // Add smart context summary for the AI
  if (smartContext) {
    const { taskType, inputContext, outputRequirements } = smartContext

    // Add context about what we detected
    if (inputContext.type !== 'unknown') {
      prompt += `\nDETECTED INPUT: ${inputContext.type.toUpperCase()}`
      if (inputContext.senderName) {
        prompt += ` from ${inputContext.senderName}`
      }
      prompt += '\n'
    }

    if (outputRequirements.targetApp) {
      prompt += `TARGET OUTPUT: ${outputRequirements.targetApp.toUpperCase()}\n`
    }
  }

  // Add email context if this is a reply
  if (originalEmailSubject) {
    prompt += `\nEMAIL CONTEXT:\nThis is a reply to an email with subject: "${originalEmailSubject}"\nIMPORTANT: Do NOT include the subject line in your response - only write the email body content. The subject line will be handled separately.\n`
  }

  // Add input data - but make it more readable
  if (Object.keys(input).length > 0) {
    // For email input, format it nicely
    if (smartContext?.inputContext.type === 'email') {
      const emailInfo: string[] = []
      if (input.from || input.sender) emailInfo.push(`From: ${input.from || input.sender}`)
      if (input.subject) emailInfo.push(`Subject: ${input.subject}`)
      if (input.date || input.timestamp) emailInfo.push(`Date: ${input.date || input.timestamp}`)
      if (input.body || input.snippet || input.content) {
        emailInfo.push(`\nMessage:\n${input.body || input.snippet || input.content}`)
      }
      prompt += `\nEMAIL RECEIVED:\n${emailInfo.join('\n')}\n`
    }
    // For message input, format it nicely
    else if (smartContext?.inputContext.type === 'message') {
      const msgInfo: string[] = []
      const author = input.author?.username || input.author?.name || input.user?.username || input.sender
      if (author) msgInfo.push(`From: ${author}`)
      if (input.channel?.name) msgInfo.push(`Channel: ${input.channel.name}`)
      if (input.content || input.text || input.message?.content) {
        msgInfo.push(`\nMessage:\n${input.content || input.text || input.message?.content}`)
      }
      prompt += `\nMESSAGE RECEIVED:\n${msgInfo.join('\n')}\n`
    }
    // For other data, use JSON but truncate large values
    else {
      const cleanInput = truncateLargeValues(input)
      prompt += `\nINPUT DATA:\n${JSON.stringify(cleanInput, null, 2)}\n`
    }
  }

  // Add additional context from previous steps
  if (additionalContext) {
    prompt += `\nCONTEXT FROM PREVIOUS STEPS:\n${additionalContext}\n`
  }

  // Add routing context if needed
  if (workflowContext.needsRouting && workflowContext.outputPaths) {
    prompt += `\nAVAILABLE PATHS:\n${workflowContext.outputPaths.map((path, idx) =>
      `${idx + 1}. ${path.name}${path.description ? ' - ' + path.description : ''}`
    ).join('\n')}\n`
  }

  // Add instructions for response format
  prompt += `\nRESPONSE INSTRUCTIONS:`

  if (workflowContext.needsContentGeneration && workflowContext.needsRouting) {
    prompt += `
Provide your response as JSON with:
{
  "output": "your generated content here",
  "data": { structured fields based on output format },
  "selectedPath": "path_id",
  "confidence": 0.8,
  "reasoning": "why you chose this path"
}`
  } else if (workflowContext.needsRouting) {
    prompt += `
Provide your response as JSON with:
{
  "selectedPath": "path_id",
  "confidence": 0.8,
  "reasoning": "why you chose this path",
  "classification": "category",
  "sentiment": "positive/neutral/negative"
}`
  } else {
    // Provide format guidance based on task type
    if (smartContext?.taskType === 'extract') {
      prompt += `
Return the extracted data in a clean format. Just the values requested, nothing else.`
    } else if (smartContext?.taskType === 'summarize') {
      prompt += `
Provide a clear, concise summary. Use bullet points if appropriate.`
    } else if (smartContext?.taskType === 'classify') {
      prompt += `
Provide your classification with a brief explanation.`
    } else {
      prompt += `
Write your response naturally and directly. Do NOT add any signature, sign-off, or closing - just end with your actual message content.`
    }
  }

  return prompt
}

/**
 * Truncate large values in input for cleaner prompts
 */
function truncateLargeValues(obj: Record<string, any>, maxLength = 500): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && value.length > maxLength) {
      result[key] = value.substring(0, maxLength) + '...[truncated]'
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = truncateLargeValues(value, maxLength)
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * ========================================
 * AI GENERATION
 * ========================================
 */

/**
 * Generate content with AI (OpenAI or Anthropic)
 * Handles both generation and routing decisions autonomously
 */
async function generateWithAI(
  config: any,
  systemPrompt: string,
  userPrompt: string,
  workflowContext: WorkflowContext
): Promise<{ content: string; tokensUsed: number; costIncurred: number }> {
  // §A3 — model routes through `AI_MODELS.fast` (centralized registry).
  // temperature / maxTokens fall back to named constants defined at the
  // top of this file; the same values are also declared as schema-level
  // defaults in `aiAgentNode.ts`.
  const model = config.model || AI_MODELS.fast
  const temperature = config.temperature ?? AI_AGENT_DEFAULT_TEMPERATURE
  const maxTokens = config.maxTokens || AI_AGENT_DEFAULT_MAX_TOKENS

  // Determine API source
  const apiKey = config.apiSource === 'custom' ? config.customApiKey : undefined

  // Force JSON for routing or hybrid modes
  const needsJson = workflowContext.needsRouting

  // Use OpenAI for GPT models
  if (model.startsWith('gpt-')) {
    const client = apiKey ? getOpenAIClientWithKey(apiKey) : getOpenAIClient()

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
    messages.push({ role: 'system', content: systemPrompt })
    messages.push({ role: 'user', content: userPrompt })

    const params: any = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens
    }

    if (needsJson) {
      params.response_format = { type: 'json_object' }
    }

    const response = await client.chat.completions.create(params)

    const content = response.choices[0]?.message?.content || ''
    const tokensUsed = response.usage?.total_tokens || 0
    const costIncurred = calculateCost(model, tokensUsed)

    return { content, tokensUsed, costIncurred }
  }

  // Use Anthropic for Claude models
  if (model.startsWith('claude-')) {
    const client = apiKey ? getAnthropicClientWithKey(apiKey) : getAnthropicClient()

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })

    const content = response.content[0].type === 'text' ? response.content[0].text : ''
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens
    const costIncurred = calculateCost(model, tokensUsed)

    return { content, tokensUsed, costIncurred }
  }

  throw new Error(`Unsupported model: ${model}`)
}

/**
 * Parse autonomous AI response based on workflow context
 */
function parseAutonomousResponse(
  response: { content: string; tokensUsed: number; costIncurred: number },
  workflowContext: WorkflowContext,
  config: any,
  userProfile?: UserProfileContext,
  originalEmailSubject?: string | null,
  smartContext?: SmartContext
): ActionResult {
  const { content, tokensUsed, costIncurred } = response

  // Determine if we should add a signature based on smart context
  // Only add signatures for email output, NOT for:
  // - Data extraction tasks
  // - Summarization tasks
  // - Classification tasks
  // - Messaging platforms (Discord, Slack, Teams) - they don't use traditional signatures
  const shouldAddSignature = (() => {
    // Check config first - if explicitly set to 'none', don't add
    if (config.includeSignature === 'none') return false

    // Use smart context if available
    if (smartContext) {
      const { taskType, outputRequirements } = smartContext

      // Don't add signatures for data-oriented tasks
      if (['extract', 'summarize', 'classify', 'analyze'].includes(taskType)) {
        return false
      }

      // Don't add signatures for messaging platforms
      if (outputRequirements.type === 'message') {
        return false
      }

      // Don't add signatures for structured data output
      if (outputRequirements.type === 'structured_data') {
        return false
      }

      // Add signatures for email output when configured
      if (outputRequirements.type === 'email' && config.includeSignature && config.includeSignature !== 'none') {
        return true
      }
    }

    // Default: respect config setting
    return config.includeSignature && config.includeSignature !== 'none'
  })()

  // Build signature only if needed
  const signature = shouldAddSignature ? buildSignature(config, userProfile || {}) : ''
  logger.info('[AI Agent] Signature decision', {
    shouldAddSignature,
    hasSignature: !!signature,
    signatureType: config.includeSignature,
    taskType: smartContext?.taskType,
    outputType: smartContext?.outputRequirements.type
  })

  // Try to parse as JSON first (for routing or hybrid modes)
  let parsedContent: any = null
  try {
    parsedContent = JSON.parse(content)
  } catch {
    // Not JSON, treat as plain text
  }

  const result: ActionResult = {
    success: true,
    data: {
      tokensUsed,
      costIncurred
    }
  }

  // If we have structured JSON response
  if (parsedContent && typeof parsedContent === 'object') {
    // Extract content generation outputs
    if (parsedContent.output) {
      // Clean and apply signature to output
      const cleanedOutput = cleanAIOutput(parsedContent.output)
      result.data.output = signature ? cleanedOutput + signature : cleanedOutput
    }

    if (parsedContent.data) {
      result.data.structured_output = parsedContent.data
    } else if (parsedContent.structured_output) {
      result.data.structured_output = parsedContent.structured_output
    }

    // Extract routing outputs
    if (parsedContent.selectedPath) {
      result.data.selectedPath = parsedContent.selectedPath
      result.data.selectedPaths = [parsedContent.selectedPath]
      result.nextNodeId = parsedContent.selectedPath
    }

    if (parsedContent.confidence !== undefined) {
      result.data.confidence = parsedContent.confidence
    }

    if (parsedContent.reasoning) {
      result.data.reasoning = parsedContent.reasoning
    }

    if (parsedContent.classification) {
      result.data.classification = parsedContent.classification
    }

    if (parsedContent.sentiment) {
      result.data.sentiment = parsedContent.sentiment
    }

    if (parsedContent.urgency) {
      result.data.urgency = parsedContent.urgency
    }
  } else {
    // Plain text response - treat as generated content
    // Clean the output and apply signature
    const cleanedOutput = cleanAIOutput(content)
    result.data.output = signature ? cleanedOutput + signature : cleanedOutput

    // Try to extract structured fields if output format is specified
    if (config.outputFormat) {
      const outputFields = parseOutputFields(config.outputFormat)
      if (outputFields.length > 0) {
        result.data.structured_output = extractStructuredFields(content, outputFields)
      }
    }
  }

  // Generate proper email subject for replies and formatted output
  if (originalEmailSubject) {
    // Use "Re: original subject" format for email replies
    const replySubject = originalEmailSubject.toLowerCase().startsWith('re:')
      ? originalEmailSubject
      : `Re: ${originalEmailSubject}`
    result.data.email_subject = replySubject

    // Create formatted_output with subject header for Discord/Slack/Teams
    result.data.formatted_output = `**${replySubject}**\n\n${result.data.output}`

    logger.info('[AI Agent] Email reply subject set', { email_subject: replySubject })
  } else {
    // No email context - formatted_output is same as output
    result.data.formatted_output = result.data.output
  }

  // ========================================
  // POPULATE TYPE-SPECIFIC OUTPUT FIELDS
  // This makes outputs predictable like Zapier
  // ========================================
  const taskType = smartContext?.taskType || 'unknown'
  result.data.actionType = config.actionType || 'custom'

  switch (taskType) {
    case 'respond':
      // For respond: set response and email_body
      result.data.response = result.data.output
      result.data.email_body = result.data.output
      break

    case 'extract':
      // For extract: parse JSON, store the full object on data.data, and also
      // hoist each top-level key from the parsed JSON onto result.data for
      // direct {{nodeId.fieldName}} access by downstream nodes.
      if (parsedContent && typeof parsedContent === 'object') {
        result.data.data = parsedContent  // Primary field
        // Also set individual fields at top level for easy access
        Object.entries(parsedContent).forEach(([key, value]) => {
          if (!['output', 'data', 'tokensUsed', 'costIncurred'].includes(key)) {
            result.data[key] = value
          }
        })
      } else {
        // Try to parse the output as JSON
        try {
          const extracted = JSON.parse(result.data.output || '{}')
          result.data.data = extracted  // Primary field
          Object.entries(extracted).forEach(([key, value]) => {
            if (!['output', 'data', 'tokensUsed', 'costIncurred'].includes(key)) {
              result.data[key] = value
            }
          })
        } catch {
          result.data.data = { raw: result.data.output }
        }
      }
      break

    case 'summarize':
      // For summarize: set summary field
      result.data.summary = result.data.output
      break

    case 'classify':
      // For classify: extract category, confidence, reasoning
      if (parsedContent) {
        result.data.category = parsedContent.category || parsedContent.classification
        result.data.categories = parsedContent.categories || (parsedContent.category ? [parsedContent.category] : [])
        result.data.sentiment = parsedContent.sentiment
        result.data.confidence = parsedContent.confidence
        result.data.reasoning = parsedContent.reasoning || parsedContent.explanation
      }
      break

    case 'translate':
      // For translate: set translation and target_language
      result.data.translation = result.data.output
      result.data.target_language = config.translateTo === 'other' ? config.translateToCustom : config.translateTo
      break

    case 'generate':
      // For generate: output is already set, also set email fields if generating email
      if (config.generateType === 'email') {
        result.data.email_body = result.data.output
      }
      break
  }

  // Validate routing if needed
  if (workflowContext.needsRouting && !result.data.selectedPath) {
    // AI didn't provide a routing decision - use fallback
    const fallbackPath = workflowContext.outputPaths?.[0]
    if (fallbackPath) {
      result.data.selectedPath = fallbackPath.id
      result.data.selectedPaths = [fallbackPath.id]
      result.nextNodeId = fallbackPath.id
      result.data.confidence = 0.5
      result.data.reasoning = 'Fallback: AI did not provide explicit routing decision'
    }
  }

  return result
}

/**
 * ========================================
 * HELPER FUNCTIONS
 * ========================================
 */

function parseOutputFields(fieldsText: string | undefined): Array<{ name: string; description: string }> {
  if (!fieldsText) return []

  return fieldsText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && line.includes('|'))
    .map(line => {
      const [name, description] = line.split('|').map(s => s.trim())
      return { name, description }
    })
}

function extractStructuredFields(
  content: string,
  fields: Array<{ name: string; description: string }>
): Record<string, any> {
  const result: Record<string, any> = {}

  // Try to parse as JSON first
  try {
    const parsed = JSON.parse(content)
    fields.forEach(field => {
      if (parsed[field.name] !== undefined) {
        result[field.name] = parsed[field.name]
      }
    })
    return result
  } catch {
    // Not JSON, try text extraction
  }

  // Extract from markdown-style format
  fields.forEach(field => {
    const regex = new RegExp(`${field.name}:\\s*(.+?)(?=\\n\\w+:|$)`, 'is')
    const match = content.match(regex)
    if (match) {
      result[field.name] = match[1].trim()
    }
  })

  return result
}

/**
 * Build context from previous workflow nodes
 */
function buildAdditionalContext(nodeIds: string[], context: ExecutionContext): string {
  if (!nodeIds || nodeIds.length === 0) return ''

  const contextParts: string[] = []

  for (const nodeId of nodeIds) {
    const nodeResult = context.results?.[nodeId]
    if (nodeResult) {
      contextParts.push(`[${nodeId}]: ${JSON.stringify(nodeResult, null, 2)}`)
    }
  }

  return contextParts.join('\n\n')
}

function calculateCost(model: string, tokens: number): number {
  // Simplified cost calculation (update with actual pricing)
  const costPer1kTokens: Record<string, number> = {
    'gpt-4o': 0.005,
    'gpt-4o-mini': 0.0002,
    'gpt-4-turbo': 0.01,
    'gpt-3.5-turbo': 0.0015,
    'claude-3-opus': 0.015,
    'claude-3-sonnet': 0.003,
    'claude-3-haiku': 0.00025
  }

  const rate = costPer1kTokens[model] || 0.002
  return (tokens / 1000) * rate
}
