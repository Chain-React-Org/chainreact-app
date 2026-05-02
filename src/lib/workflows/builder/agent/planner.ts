import { Flow, Node, Edge, FlowInterface } from "../schema"
import { NODES } from "../nodes"
import { isSecretPlaceholder } from "../secrets"
import { createHash } from "crypto"
// Import the full node catalog for integration-specific nodes
import { ALL_NODE_COMPONENTS } from "../../../../../lib/workflows/nodes"
import type { NodeComponent } from "../../../../../lib/workflows/nodes/types"
import { logger } from "../../../../../lib/utils/logger"
import { callLLMWithRetry, parseLLMJson } from "../../../../../lib/ai/llm-retry"
import { AI_MODELS } from "../../../../../lib/ai/models"
import { getCachedPlan, cachePlan } from "../../../../../lib/ai/plan-cache"
import { getTemplateCatalog, formatTemplateCatalogForLLM } from "../../../../../lib/ai/template-catalog"
// Import LLM planner and types
import { planWithLLM, llmOutputToPlannerResult } from "./llmPlanner"
import { parseRefinementIntent, looksLikeRefinement, applyRefinement } from "./refinementParser"
import type {
  ReasoningStep,
  NodeConfiguration,
  ConversationMessage,
  LLMPlannerInput,
  ExtendedPlannerResult,
} from "./types"
import type { DraftingContext } from "./draftingContext"

export interface PlannerInput {
  prompt: string
  flow: Flow
  /** Connected integrations for context */
  connectedIntegrations?: string[]
  /** Conversation history for refinement context */
  conversationHistory?: ConversationMessage[]
  /** Structured drafting state accumulated across conversation turns */
  draftingContext?: DraftingContext
  /** Whether to prefer LLM planner (default: true) */
  useLLM?: boolean
  /** Formatted business context block for LLM injection */
  businessContext?: string
}

export type Edit =
  | { op: "addNode"; node: Node }
  | { op: "connect"; edge: Edge }
  | { op: "setConfig"; nodeId: string; patch: Record<string, any> }
  | { op: "setInterface"; inputs: FlowInterface["inputs"]; outputs: FlowInterface["outputs"] }
  // Extended edit operations for branching support
  | { op: "addBranch"; afterNodeId: string; condition: { field: string; operator: string; value?: any }; truePath: Node[]; falsePath?: Node[] }
  | { op: "mergeBranches"; sourceNodeIds: string[]; mergeNodeId: string }
  | { op: "removeNode"; nodeId: string; reconnect: boolean }

export interface PlannerResult {
  edits: Edit[]
  prerequisites: string[]
  rationale: string
  deterministicHash: string
  workflowName?: string
  /** Reasoning steps from LLM planner (if used) */
  reasoning?: ReasoningStep[]
  /** Partial configuration metadata from LLM planner */
  partialConfigs?: Record<string, NodeConfiguration>
  /** Plan version for refinement tracking */
  planVersion?: number
  /** Method used for planning */
  planningMethod?: 'llm' | 'pattern'
  /** Unsupported features detected in the prompt */
  unsupportedFeatures?: {
    hasUnsupported: boolean
    features: Array<{ feature: string; alternative?: string }>
    message: string
  }
  /** Clarifying questions to ask user when plan is empty */
  clarifyingQuestions?: string[]
}


// Create a lookup map for quick node access
const NODE_CATALOG_MAP = new Map<string, NodeComponent>(
  ALL_NODE_COMPONENTS.map((node) => [node.type, node])
)

// Helper to find node in catalog by type
function findNodeInCatalog(type: string): NodeComponent | undefined {
  return NODE_CATALOG_MAP.get(type)
}

// Helper to find node in catalog by provider and action/trigger type
function findNodeByProvider(providerId: string, action: string, isTrigger: boolean = false): NodeComponent | undefined {
  return ALL_NODE_COMPONENTS.find((node) =>
    node.providerId === providerId &&
    node.isTrigger === isTrigger &&
    (node.title.toLowerCase().includes(action.toLowerCase()) || node.type.includes(action.toLowerCase()))
  )
}

// Legacy allow-list kept for backward compatibility with generic nodes
const ALLOWED_NODE_TYPES = [
  "http.trigger",
  "http.request",
  "ai.generate",
  "mapper.node",
  "logic.ifSwitch",
  "notify.dispatch",
] as const

type AllowedNodeType = typeof ALLOWED_NODE_TYPES[number]

interface ValidationResult {
  ok: boolean
  errors: string[]
}

// Get node schema from catalog
function getNodeSchema(type: string) {
  return NODES[type]
}

// Validate that draft flow only contains valid node types
function validateDraft(flow: Flow): ValidationResult {
  const errors: string[] = []

  for (const node of flow.nodes) {
    // Check if node exists in either legacy allow-list OR full catalog
    const isLegacyNode = ALLOWED_NODE_TYPES.includes(node.type as any)
    const isIntegrationNode = findNodeInCatalog(node.type) !== undefined

    if (!isLegacyNode && !isIntegrationNode) {
      errors.push(`Invalid node type: "${node.type}" (node id: ${node.id}) - not found in catalog`)
    }

    // For legacy nodes, check NODES registry; for integration nodes, check catalog
    const legacySchema = getNodeSchema(node.type)
    const catalogNode = findNodeInCatalog(node.type)

    if (!legacySchema && !catalogNode) {
      errors.push(`No schema found for node type: "${node.type}" (node id: ${node.id})`)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  }
}

// ============================================================================
// UNDO / REVERT HELPERS
// ============================================================================

const UNDO_PATTERNS = [
  /\b(undo|undo that|undo the last change)\b/i,
  /\b(revert|revert that|revert the last change)\b/i,
  /\b(change it back|put it back|go back)\b/i,
  /\b(never ?mind|nevermind)\b/i,
  /\brestore (?:the )?previous\b/i,
]

/** Quick check if prompt is an undo/revert request */
export function looksLikeUndoRequest(prompt: string): boolean {
  return UNDO_PATTERNS.some(p => p.test(prompt))
}

/** Walk conversation history in reverse to find the previous workflow snapshot */
export function findPreviousSnapshot(
  conversationHistory?: ConversationMessage[]
): { nodes: Array<{ id: string; type: string; label: string }>; edges: Array<{ from: string; to: string }> } | null {
  if (!conversationHistory || conversationHistory.length === 0) return null

  // Collect all assistant messages with snapshots (most recent first)
  const snapshots: string[] = []
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const msg = conversationHistory[i]
    if (msg.role === 'assistant' && msg.metadata?.workflowSnapshot) {
      snapshots.push(msg.metadata.workflowSnapshot)
    }
  }

  // We want the second-most-recent snapshot (the state BEFORE the last change)
  // If only one snapshot exists, use it (better than nothing)
  const snapshotStr = snapshots.length >= 2 ? snapshots[1] : snapshots[0]
  if (!snapshotStr) return null

  try {
    return JSON.parse(snapshotStr)
  } catch {
    logger.error('[Planner] Failed to parse workflow snapshot for undo')
    return null
  }
}

/** Build Edit operations to restore a previous workflow snapshot */
export function buildUndoEdits(
  snapshot: { nodes: Array<{ id: string; type: string; label: string }>; edges: Array<{ from: string; to: string }> },
  currentNodes: Node[]
): Edit[] {
  const edits: Edit[] = []

  // Remove all current nodes
  for (const node of currentNodes) {
    edits.push({ op: 'removeNode', nodeId: node.id, reconnect: false })
  }

  // Add back snapshot nodes
  for (let i = 0; i < snapshot.nodes.length; i++) {
    const sNode = snapshot.nodes[i]
    const restoredNode: Node = {
      id: sNode.id,
      type: sNode.type,
      label: sNode.label || sNode.type,
      config: {},
      inPorts: [],
      outPorts: [],
      io: { inputSchema: undefined, outputSchema: undefined },
      policy: { timeoutMs: 60000, retries: 0 },
      costHint: 0,
      metadata: {
        position: { x: 400, y: 100 + i * 160 },
        lane: 0,
        branchIndex: i,
      },
    }
    edits.push({ op: 'addNode', node: restoredNode })
  }

  // Reconnect edges from snapshot
  for (const edge of snapshot.edges) {
    edits.push({
      op: 'connect',
      edge: {
        id: crypto.randomUUID(),
        from: { nodeId: edge.from },
        to: { nodeId: edge.to },
        mappings: [],
      },
    })
  }

  return edits
}

// Enhanced intent → plan mapping with real integration nodes
interface PlanTemplate {
  nodeTypes: (AllowedNodeType | string)[]  // Now supports both legacy and integration node types
  description: string
  fallbackNote?: string
  // Optional configuration hints for each node
  configHints?: Record<string, Record<string, any>>
}

/**
 * FAST-PATH PATTERN TEMPLATES
 *
 * Only the most common workflow patterns are kept here as a zero-cost
 * fast path (no LLM call needed). All other requests fall through to
 * a lightweight GPT-4o-mini call that can handle any prompt.
 *
 * Previously this was 60+ templates with 12-tier heuristic matching.
 * Now it's ~10 templates with simple keyword matching.
 */
const INTENT_TO_PLAN: Record<string, PlanTemplate> = {
  // Email → Slack (most common pattern)
  "email to slack": {
    nodeTypes: ["gmail_trigger_new_email", "slack_action_send_message"],
    description: "Gmail trigger → Slack",
    configHints: {
      "slack_action_send_message": {
        message: "New email from {{trigger.from}}:\n\n*Subject:* {{trigger.subject}}\n\n{{trigger.snippet}}",
      },
    },
  },

  // Webhook → Slack
  "webhook to slack": {
    nodeTypes: ["http.trigger", "slack_action_send_message"],
    description: "HTTP trigger → Slack",
    configHints: {
      "slack_action_send_message": {
        message: "Webhook received:\n```{{trigger.body}}```",
      },
    },
  },

  // Google Sheets → Slack
  "sheets to slack": {
    nodeTypes: ["google_sheets_trigger_new_row", "slack_action_send_message"],
    description: "Google Sheets new row → Slack",
    configHints: {
      "slack_action_send_message": {
        message: "New row added to Google Sheets:\n{{trigger.values}}",
      },
    },
  },

  // Email → Summarize → Slack
  "email summarize slack": {
    nodeTypes: ["gmail_trigger_new_email", "ai_summarize", "slack_action_send_message"],
    description: "Gmail → Summarize → Slack",
    configHints: {
      "ai_summarize": { text: "{{trigger.body}}", format: "bullets" },
      "slack_action_send_message": {
        message: "Email Summary from {{trigger.from}}:\n{{ai_summarize.summary}}",
      },
    },
  },

  // Email with HTML formatting → Slack
  "email formatted slack": {
    nodeTypes: ["gmail_trigger_new_email", "format_transformer", "slack_action_send_message"],
    description: "Gmail trigger → Format HTML → Slack",
    configHints: {
      "format_transformer": { content: "{{trigger.body}}", targetFormat: "slack_markdown" },
      "slack_action_send_message": {
        message: "Email from {{trigger.from}}:\n\n*{{trigger.subject}}*\n\n{{format_transformer.transformedContent}}",
      },
    },
  },

  // Webhook → Discord
  "webhook to discord": {
    nodeTypes: ["http.trigger", "discord_action_send_message"],
    description: "HTTP trigger → Discord",
    configHints: {
      "discord_action_send_message": { content: "{{trigger.body}}" },
    },
  },

  // Google Sheets → Discord
  "sheets to discord": {
    nodeTypes: ["google_sheets_trigger_new_row", "discord_action_send_message"],
    description: "Google Sheets new row → Discord",
    configHints: {
      "discord_action_send_message": {
        content: "New row added to Google Sheets:\n{{trigger.values}}",
      },
    },
  },

  // Airtable → Slack
  "airtable to slack": {
    nodeTypes: ["airtable_trigger_new_record", "slack_action_send_message"],
    description: "Airtable new record → Slack",
    configHints: {
      "slack_action_send_message": {
        message: "New record added to Airtable:\n{{trigger.fields}}",
      },
    },
  },

  // Notion → Slack
  "notion to slack": {
    nodeTypes: ["notion_trigger_database_item_created", "slack_action_send_message"],
    description: "Notion new database item → Slack",
    configHints: {
      "slack_action_send_message": {
        message: "New Notion page created: {{trigger.title}}",
      },
    },
  },

  // Extract from email → Sheets
  "extract email sheets": {
    nodeTypes: ["gmail_trigger_new_email", "ai_extract", "google_sheets_action_append_row"],
    description: "Gmail → Extract Data → Google Sheets",
    configHints: {
      "ai_extract": {
        text: "{{trigger.body}}",
        fieldsToExtract: "name\nemail\nphone\ncompany",
      },
    },
  },
}

// Normalize natural language input for deterministic matching
function normalizePrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// ==========================================
// UNSUPPORTED FEATURE DETECTION
// ==========================================

// Supported providers for reference
const SUPPORTED_PROVIDERS = new Set([
  'gmail', 'slack', 'discord', 'notion', 'airtable', 'github',
  'google-sheets', 'google-docs', 'google-drive', 'google-calendar',
  'dropbox', 'onedrive', 'microsoft-outlook', 'microsoft-excel', 'microsoft-onenote',
  'hubspot', 'mailchimp', 'stripe', 'shopify', 'gumroad',
  'trello', 'monday', 'teams', 'twitter', 'facebook', 'manychat',
  'webhook', 'http'
])

// Unsupported features with helpful alternatives
interface UnsupportedFeature {
  patterns: RegExp[]
  feature: string
  alternative?: string
}

const UNSUPPORTED_FEATURES: UnsupportedFeature[] = [
  // Unsupported integrations
  {
    patterns: [/\b(linkedin)\b/i],
    feature: 'LinkedIn integration',
    alternative: 'Consider using our HTTP Request node to call LinkedIn API directly if you have API access, or post to Twitter instead.',
  },
  {
    patterns: [/\b(salesforce|sfdc)\b/i],
    feature: 'Salesforce integration',
    alternative: 'Consider using HubSpot for CRM functionality, or use our HTTP Request node to call Salesforce API directly.',
  },
  {
    patterns: [/\b(jira|atlassian)\b/i],
    feature: 'Jira integration',
    alternative: 'Consider using Trello or Monday for project management, or use our HTTP Request node to call Jira API directly.',
  },
  {
    patterns: [/\b(asana)\b/i],
    feature: 'Asana integration',
    alternative: 'Consider using Trello or Monday for project management, or use our HTTP Request node to call Asana API directly.',
  },
  {
    patterns: [/\b(zendesk)\b/i],
    feature: 'Zendesk integration',
    alternative: 'Consider using our HTTP Request node to call Zendesk API directly, or use Slack for support notifications.',
  },
  {
    patterns: [/\b(zoom)\b/i],
    feature: 'Zoom integration',
    alternative: 'Consider using Google Calendar for meeting scheduling, or use our HTTP Request node to call Zoom API directly.',
  },
  {
    patterns: [/\b(calendly)\b/i],
    feature: 'Calendly integration',
    alternative: 'Consider using Google Calendar for scheduling, or use our HTTP Request node with a Calendly webhook.',
  },
  {
    patterns: [/\b(twilio|sms|text message)\b/i],
    feature: 'SMS/Twilio integration',
    alternative: 'Consider sending notifications via Slack, Discord, or email instead.',
  },
  {
    patterns: [/\b(whatsapp)\b/i],
    feature: 'WhatsApp integration',
    alternative: 'Consider sending notifications via Slack, Discord, or email instead.',
  },
  {
    patterns: [/\b(telegram)\b/i],
    feature: 'Telegram integration',
    alternative: 'Consider using Discord or Slack for chat notifications instead.',
  },
  {
    patterns: [/\b(quickbooks|xero|freshbooks)\b/i],
    feature: 'Accounting software integration',
    alternative: 'Consider using our HTTP Request node to call their APIs directly, or use Google Sheets for financial tracking.',
  },
  {
    patterns: [/\b(intercom)\b/i],
    feature: 'Intercom integration',
    alternative: 'Consider using Slack for customer notifications, or use our HTTP Request node to call Intercom API directly.',
  },
  {
    patterns: [/\b(pipedrive)\b/i],
    feature: 'Pipedrive integration',
    alternative: 'Consider using HubSpot for CRM functionality instead.',
  },
  {
    patterns: [/\b(clickup)\b/i],
    feature: 'ClickUp integration',
    alternative: 'Consider using Trello, Monday, or Notion for project management instead.',
  },

  // Unsupported features
  {
    patterns: [/\b(rss|rss feed|atom feed|feed reader)\b/i],
    feature: 'RSS feed triggers',
    alternative: 'Use our HTTP Request node to fetch RSS/Atom feeds periodically with an external cron trigger, then parse with our Format Transformer.',
  },
  {
    patterns: [/\b(cron|schedule|scheduled trigger|every hour|every day|daily at|hourly at|weekly at)\b/i],
    feature: 'Built-in scheduled triggers',
    alternative: 'Use an external cron service (like cron-job.org) to call your workflow\'s HTTP trigger at scheduled intervals. We\'ll set up an HTTP trigger for you to receive these calls.',
  },
  {
    patterns: [/\b(ftp|sftp|file transfer)\b/i],
    feature: 'FTP/SFTP file transfers',
    alternative: 'Consider using Dropbox, Google Drive, or OneDrive for file storage and transfers.',
  },
  {
    patterns: [/\b(database|mysql|postgres|mongodb|sql server)\b/i],
    feature: 'Direct database connections',
    alternative: 'Consider using Airtable or Google Sheets as a database alternative, or use HTTP Request to call your own API that handles database operations.',
  },
  {
    patterns: [/\b(scrape|web scraping|crawl|crawler)\b/i],
    feature: 'Web scraping',
    alternative: 'Use our "Extract Website Data" utility node for basic data extraction, or use Tavily Search for research.',
  },
]

/**
 * Check if the prompt requests unsupported features
 * Returns an object with detection results and helpful messaging
 */
function detectUnsupportedFeatures(prompt: string): {
  hasUnsupported: boolean
  unsupportedList: Array<{ feature: string; alternative?: string }>
  message: string
} {
  const normalized = normalizePrompt(prompt)
  const detected: Array<{ feature: string; alternative?: string }> = []

  for (const unsupported of UNSUPPORTED_FEATURES) {
    for (const pattern of unsupported.patterns) {
      if (pattern.test(normalized) || pattern.test(prompt)) {
        detected.push({
          feature: unsupported.feature,
          alternative: unsupported.alternative,
        })
        break // Don't add the same feature multiple times
      }
    }
  }

  if (detected.length === 0) {
    return {
      hasUnsupported: false,
      unsupportedList: [],
      message: '',
    }
  }

  // Build helpful message
  const featureNames = detected.map(d => d.feature).join(', ')
  let message = `I noticed your request includes ${featureNames}, which we don't currently support directly.\n\n`

  for (const item of detected) {
    if (item.alternative) {
      message += `**${item.feature}:** ${item.alternative}\n\n`
    }
  }

  message += 'Would you like me to suggest an alternative workflow using our available integrations?'

  return {
    hasUnsupported: true,
    unsupportedList: detected,
    message,
  }
}

/**
 * Detect if a prompt is too vague to produce a useful workflow plan.
 *
 * Returns true if the prompt lacks specific apps AND specific actions,
 * which means the LLM would have to guess everything — producing
 * generic, unhelpful plans.
 *
 * $0 cost — pure heuristic, no LLM call.
 */
function isPromptTooVague(prompt: string, connectedIntegrations: string[]): boolean {
  const n = prompt.toLowerCase()

  // If user explicitly references their connected apps — not vague
  if (/based on what i have|with my (connected|current)|using my apps|what i have connected/.test(n) && connectedIntegrations.length > 0) {
    return false
  }

  // Goal-oriented keywords that signal the user wants a workflow built
  const hasGoalKeyword = /\b(retention|engage|onboard|marketing|sales|support|follow[- ]?up|automate|workflow|automation|process|monitor|track|alert|report|digest|backup|sync|integrat|pipeline|funnel|churn|lead|customer|order|invoice|payment|subscri|notify|remind|check|review|approve|escalat|assign|route|random|something|suggest|recommend|build|make|help)\b/.test(n)

  // If user has 2+ connected integrations AND expresses a goal or automation intent,
  // we have enough context to propose a concrete workflow — not vague
  if (connectedIntegrations.length >= 2 && hasGoalKeyword) {
    return false
  }

  // Check for specific app/integration mentions
  const hasSpecificApp = /\b(gmail|emails?|slack|discord|notion|airtable|sheets|spreadsheet|stripe|hubspot|trello|github|webhook|teams|outlook|calendar|drive|dropbox|shopify|mailchimp|monday|twitter|facebook)\b/.test(n)

  // Check for specific trigger/action verbs
  const hasSpecificAction = /\b(send|create|update|delete|post|notify|forward|summarize|extract|classify|translate|fetch|schedule|when|every|new row|new record|new page|trigger|webhook|receive|incoming)\b/.test(n)

  // Specific app + specific action = not vague
  if (hasSpecificApp && hasSpecificAction) return false

  // Connected integrations + action verb = not vague (we know what apps to use)
  if (connectedIntegrations.length > 0 && hasSpecificAction) return false

  // Specific app mention alone is enough (we can infer a reasonable trigger)
  if (hasSpecificApp) return false

  // Everything else is too vague — goal-oriented prompts without specifics
  // Examples: "user retention", "improve engagement", "automate onboarding",
  //           "help me with marketing", "create a workflow"
  return true
}

/**
 * Simple keyword-based pattern matching for fast-path templates.
 *
 * Only matches the ~10 most common patterns. Everything else falls through
 * to the LLM fallback in planEditsWithPatterns.
 */
function matchIntentToPlan(prompt: string): PlanTemplate | null {
  const n = normalizePrompt(prompt)

  // Detect mentioned apps
  const hasEmail = /\b(emails?|gmail)\b/.test(n)
  const hasSlack = /\b(slack)\b/.test(n)
  const hasDiscord = /\b(discord)\b/.test(n)
  const hasSheets = /\b(google sheets?|gsheets?|spreadsheet)\b/.test(n)
  const hasAirtable = /\b(airtable)\b/.test(n)
  const hasNotion = /\b(notion)\b/.test(n)
  const hasWebhook = /\b(webhook)\b/.test(n)

  // Detect desired actions
  const wantsSummarize = /\b(summarize|summarise|summary|tldr|digest)\b/.test(n)
  const wantsExtract = /\b(extract|pull out|parse data)\b/.test(n)
  const wantsFormat = /\b(format|transform|convert)\b/.test(n)

  // Default destination
  const dest = hasSlack ? 'slack' : hasDiscord ? 'discord' : null

  // Email + Summarize + Slack
  if (hasEmail && wantsSummarize && dest === 'slack') {
    return INTENT_TO_PLAN["email summarize slack"]
  }

  // Email + Extract → sheets
  if (hasEmail && wantsExtract) {
    return INTENT_TO_PLAN["extract email sheets"]
  }

  // Email + Format + Slack
  if (hasEmail && wantsFormat && dest === 'slack') {
    return INTENT_TO_PLAN["email formatted slack"]
  }

  // Email + Slack
  if (hasEmail && dest === 'slack') {
    return INTENT_TO_PLAN["email to slack"]
  }

  // Google Sheets → Slack/Discord
  if (hasSheets && dest === 'slack') return INTENT_TO_PLAN["sheets to slack"]
  if (hasSheets && dest === 'discord') return INTENT_TO_PLAN["sheets to discord"]

  // Airtable → Slack
  if (hasAirtable && dest === 'slack') return INTENT_TO_PLAN["airtable to slack"]

  // Notion → Slack
  if (hasNotion && dest === 'slack') return INTENT_TO_PLAN["notion to slack"]

  // Webhook → Slack/Discord
  if (hasWebhook && dest === 'slack') return INTENT_TO_PLAN["webhook to slack"]
  if (hasWebhook && dest === 'discord') return INTENT_TO_PLAN["webhook to discord"]

  // No fast-path match — return null to trigger LLM fallback
  return null
}

/**
 * Match user prompt against published DB templates by keyword overlap.
 *
 * $0 cost — no LLM call. Checks if the prompt mentions words from
 * a template's name, description, tags, or integration list.
 * Requires at least 2 keyword matches to avoid false positives.
 */
async function matchDBTemplate(prompt: string): Promise<PlanTemplate | null> {
  try {
    const templates = await getTemplateCatalog()
    if (templates.length === 0) return null

    const promptWords = new Set(
      prompt.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3)
    )

    let bestMatch: { entry: typeof templates[0]; score: number } | null = null

    for (const entry of templates) {
      // Build searchable words from template metadata
      const templateText = [
        entry.name,
        entry.description,
        ...(entry.tags || []),
        ...(entry.integrations || []),
        entry.category || '',
      ].join(' ').toLowerCase().replace(/[^\w\s]/g, ' ')

      const templateWords = new Set(templateText.split(/\s+/).filter(w => w.length >= 3))

      // Count overlapping words
      let score = 0
      for (const word of promptWords) {
        if (templateWords.has(word)) score++
      }

      // Require at least 2 keyword matches to avoid false positives
      if (score >= 2 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { entry, score }
      }
    }

    if (bestMatch && bestMatch.entry.nodeTypes.length >= 2) {
      logger.info('[Planner] DB template match found', {
        templateName: bestMatch.entry.name,
        score: bestMatch.score,
        nodeCount: bestMatch.entry.nodeTypes.length,
      })
      return {
        nodeTypes: bestMatch.entry.nodeTypes,
        description: bestMatch.entry.description || bestMatch.entry.name,
      }
    }

    return null
  } catch (error: any) {
    logger.warn('[Planner] DB template matching failed', { error: error?.message })
    return null
  }
}

/**
 * Lightweight LLM fallback for pattern planning.
 *
 * When fast-path patterns don't match, this uses a cheap GPT-4o-mini call
 * to select node types from the catalog. The LLM also receives published
 * workflow templates from the DB — so as users create templates, the pool
 * of reference patterns grows organically.
 *
 * Returns a PlanTemplate or null.
 */
async function lightweightLLMPlan(prompt: string): Promise<PlanTemplate | null> {
  try {
    // Build a compact list of available node types
    const nodeList = ALL_NODE_COMPONENTS
      .map(n => `${n.type}: ${n.description || n.title}`)
      .join('\n')

    // Load published templates from DB for additional context
    let templateContext = ''
    try {
      const dbTemplates = await getTemplateCatalog()
      templateContext = formatTemplateCatalogForLLM(dbTemplates)
    } catch {
      // Non-critical — proceed without template context
    }

    const result = await callLLMWithRetry({
      messages: [
        {
          role: 'system',
          content: `You are a workflow automation planner. Given a user request, select 2-5 node types from the catalog to build a workflow. Return JSON: { "nodeTypes": ["type1", "type2"], "description": "brief description" }. ONLY use types from the catalog. Start with a trigger node.${templateContext ? '\n\nYou can also reference existing templates below for inspiration — reuse their node patterns when they match the user\'s intent.' : ''}`
        },
        {
          role: 'user',
          content: `Catalog:\n${nodeList}\n\n${templateContext ? `${templateContext}\n\n` : ''}Request: "${prompt}"`
        }
      ],
      model: AI_MODELS.fast,
      temperature: 0.3,
      maxTokens: 500,
      jsonMode: true,
      maxRetries: 1,
      fallbackModel: null,
      timeoutMs: 15000,
      label: 'Planner:lightweightFallback',
    })

    const parsed = parseLLMJson(result.content, 'Planner:lightweightFallback')

    if (Array.isArray(parsed.nodeTypes) && parsed.nodeTypes.length >= 2) {
      // Validate that all node types exist in the catalog
      const validTypes = parsed.nodeTypes.filter((type: string) =>
        ALL_NODE_COMPONENTS.some(n => n.type === type) ||
        NODES[type] !== undefined
      )

      if (validTypes.length >= 2) {
        logger.info('[Planner] Lightweight LLM fallback succeeded', {
          nodeCount: validTypes.length,
          types: validTypes,
        })
        return {
          nodeTypes: validTypes,
          description: parsed.description || 'AI-generated workflow plan',
        }
      }
    }

    logger.info('[Planner] Lightweight LLM fallback returned insufficient valid nodes')
    return null
  } catch (error: any) {
    logger.warn('[Planner] Lightweight LLM fallback failed', {
      error: error?.message || String(error),
    })
    return null
  }
}

// Compute deterministic hash of edits
function computeDeterministicHash(edits: Edit[]): string {
  const canonicalJson = JSON.stringify(edits, Object.keys(edits).sort())
  return createHash("sha256").update(canonicalJson).digest("hex").slice(0, 16)
}

function generateNodeId(existing: Set<string>): string {
  // Pure UUIDs for database compatibility (workflow_nodes.id is uuid type).
  let candidate: string
  do {
    candidate = crypto.randomUUID()
  } while (existing.has(candidate)) // Extremely unlikely collision, but be safe
  existing.add(candidate)
  return candidate
}

function cloneFlow(flow: Flow): Flow {
  return JSON.parse(JSON.stringify(flow))
}

export function checkPrerequisites(flow: Flow): string[] {
  const requirements: string[] = []
  for (const node of flow.nodes) {
    if (node.type === "notify.dispatch") {
      const webhook = (node.config as any)?.webhookUrl
      if (!webhook || webhook === "https://hooks.slack.com/services/REPLACE_ME") {
        requirements.push("secret:SLACK_WEBHOOK")
      } else if (!isSecretPlaceholder(webhook) && webhook.includes("REPLACE_ME")) {
        requirements.push("secret:SLACK_WEBHOOK")
      }
    }
  }
  return Array.from(new Set(requirements))
}

/**
 * Generate clarifying questions when the planner can't produce a workflow.
 * Uses GPT-4o-mini for contextual questions, with template-based fallback.
 */
async function generateClarifyingQuestions(prompt: string): Promise<string[]> {
  try {
    const result = await callLLMWithRetry({
      messages: [
        {
          role: 'system',
          content: `You are a workflow automation consultant at ChainReact. The user wants to automate something but their request needs more detail to build a specific workflow.

Ask 2-3 short, specific clarifying questions. Your questions MUST:
1. Reference the user's specific goal (e.g., "For your user retention workflow...")
2. Ask what apps/tools they currently use for this process (email, CRM, messaging, etc.)
3. Ask what should trigger this automation (schedule, new event, manual, etc.)
4. Suggest concrete options they can pick from (e.g., "Do you use Gmail or Outlook for email?")

Keep each question under 120 characters. Make questions specific to THEIR request — not generic.
Return a JSON object with a "questions" key containing an array of question strings.`
        },
        { role: 'user', content: prompt }
      ],
      model: AI_MODELS.utility,
      jsonMode: true,
      temperature: 0.5,
      maxTokens: 300,
      maxRetries: 1,
      fallbackModel: null,
      label: 'Planner:clarifyingQuestions',
    })
    const parsed = parseLLMJson(result.content, 'Planner:clarifyingQuestions')
    if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
      return parsed.questions.slice(0, 3)
    }
  } catch (error: any) {
    logger.warn('[Planner] Failed to generate clarifying questions via LLM', {
      error: error?.message || String(error),
    })
  }

  // Fallback: template-based questions based on what's missing from the prompt
  const lowerPrompt = prompt.toLowerCase()
  const questions: string[] = []

  if (!lowerPrompt.match(/gmail|outlook|email|slack|discord|teams|hubspot|notion|trello|asana|jira|salesforce|stripe/)) {
    questions.push("What apps or tools do you currently use? (e.g., Gmail, Slack, HubSpot, Notion)")
  }
  if (!lowerPrompt.match(/when|trigger|every|schedule|new|receive|daily|weekly|monthly|incoming/)) {
    questions.push("What should trigger this workflow? (e.g., on a schedule, when a new event happens)")
  }
  if (!lowerPrompt.match(/send|create|update|notify|post|add|move|assign|tag|score|delete/)) {
    questions.push("What actions should happen? (e.g., send a notification, update a record, create a task)")
  }

  return questions.length > 0 ? questions : [
    "What apps or tools do you use for this process today?",
    "What should trigger this automation?",
    "What's the most important action that should happen?",
  ]
}

/**
 * Main entry point for workflow planning
 *
 * Uses LLM-first approach with pattern matching fallback:
 * 1. Try LLM planner for complex workflows (10+ nodes, branching, refinements)
 * 2. Fall back to pattern matching if LLM fails or returns low confidence
 * 3. Pattern matching is also used directly for simple, well-known patterns
 */
export async function planEdits({
  prompt,
  flow,
  connectedIntegrations = [],
  conversationHistory = [],
  draftingContext,
  useLLM = true,
  businessContext,
}: PlannerInput): Promise<PlannerResult> {
  const existingNodeIds = new Set(flow.nodes.map((node) => node.id))

  // Check for unsupported features first
  const unsupportedCheck = detectUnsupportedFeatures(prompt)
  if (unsupportedCheck.hasUnsupported) {
    logger.info('[Planner] Detected unsupported features', {
      features: unsupportedCheck.unsupportedList.map(f => f.feature),
    })

    // Still try to create a workflow with available integrations, but include the warning
    // The unsupported info will be passed through to let the UI decide how to handle it
  }

  // Check for undo/revert intent first (works even with 0 nodes)
  if (looksLikeUndoRequest(prompt)) {
    logger.info('[Planner] Detected undo request', { prompt })
    const previousSnapshot = findPreviousSnapshot(conversationHistory)
    if (previousSnapshot) {
      const undoEdits = buildUndoEdits(previousSnapshot, flow.nodes)
      return {
        edits: undoEdits,
        prerequisites: [],
        rationale: 'Restored workflow to previous state',
        deterministicHash: computeDeterministicHash(undoEdits),
        reasoning: [{
          step: 1,
          phase: 'understanding',
          thought: 'User requested undo — restoring previous workflow snapshot',
          decision: 'Restoring from saved snapshot without LLM call',
          confidence: 'high',
        }],
        planVersion: 1,
        planningMethod: 'pattern',
        ...(unsupportedCheck.hasUnsupported && {
          unsupportedFeatures: {
            hasUnsupported: true,
            features: unsupportedCheck.unsupportedList,
            message: unsupportedCheck.message,
          },
        }),
      }
    } else {
      logger.info('[Planner] No previous snapshot available for undo')
      return {
        edits: [],
        prerequisites: [],
        rationale: "I don't have a previous version to restore. I can only undo changes made during this conversation.",
        deterministicHash: computeDeterministicHash([]),
        reasoning: [{
          step: 1,
          phase: 'understanding',
          thought: 'User requested undo but no previous snapshot exists in conversation history',
          confidence: 'medium',
        }],
        planVersion: 1,
        planningMethod: 'pattern',
      }
    }
  }

  // Check if this is a refinement request
  if (looksLikeRefinement(prompt) && flow.nodes.length > 0) {
    logger.info('[Planner] Detected refinement request', { prompt })
    const refinementIntent = parseRefinementIntent(prompt, flow.nodes)

    if (refinementIntent && refinementIntent.confidence !== 'low') {
      logger.info('[Planner] Applying refinement', { intent: refinementIntent })
      const edges = flow.edges.map(e => ({ id: e.id, from: e.from, to: e.to }))
      const result = applyRefinement(refinementIntent, flow.nodes, edges, 1)

      if (result.success) {
        return {
          edits: result.edits,
          prerequisites: [],
          rationale: `Refinement: ${refinementIntent.matchedText}`,
          deterministicHash: computeDeterministicHash(result.edits),
          reasoning: result.reasoning,
          planVersion: result.newPlanVersion,
          planningMethod: 'llm',
          ...(unsupportedCheck.hasUnsupported && {
            unsupportedFeatures: {
              hasUnsupported: true,
              features: unsupportedCheck.unsupportedList,
              message: unsupportedCheck.message,
            },
          }),
        }
      }
    }
  }

  // Check if prompt is too vague to produce a useful plan
  // Ask clarifying questions instead of generating a garbage workflow
  if (isPromptTooVague(prompt, connectedIntegrations)) {
    logger.info('[Planner] Prompt too vague, asking clarifying questions', { prompt })
    const questions = await generateClarifyingQuestions(prompt)
    return {
      edits: [],
      prerequisites: [],
      rationale: "",
      deterministicHash: computeDeterministicHash([]),
      clarifyingQuestions: questions,
      planningMethod: 'pattern',
      ...(unsupportedCheck.hasUnsupported && {
        unsupportedFeatures: {
          hasUnsupported: true,
          features: unsupportedCheck.unsupportedList,
          message: unsupportedCheck.message,
        },
      }),
    }
  }

  // Try LLM planner first (for complex requests)
  if (useLLM) {
    try {
      logger.info('[Planner] Attempting LLM-based planning', { prompt })

      // Check cache first (only for new plans, not refinements)
      const cachedResult = getCachedPlan<import("./types").LLMPlannerOutput>(
        prompt,
        connectedIntegrations
      )

      const llmInput: LLMPlannerInput = {
        prompt,
        flow: { nodes: flow.nodes, edges: flow.edges },
        connectedIntegrations,
        conversationHistory,
        draftingContext,
        businessContext,
      }

      const llmResult = cachedResult || await planWithLLM(llmInput)

      // Cache the result for future identical prompts
      if (!cachedResult && llmResult.nodes.length > 0) {
        cachePlan(prompt, connectedIntegrations, llmResult)
      }

      // Check if LLM result is usable - accept any result that has nodes
      // A low-confidence workflow is better than the pattern matcher returning nothing
      if (llmResult.nodes.length > 0) {
        const plannerResult = llmOutputToPlannerResult(llmResult, existingNodeIds)

        logger.info('[Planner] LLM planning successful', {
          nodeCount: llmResult.nodes.length,
          confidence: llmResult.confidence,
        })

        return {
          ...plannerResult,
          planningMethod: 'llm',
          planVersion: llmResult.planVersion,
          ...(unsupportedCheck.hasUnsupported && {
            unsupportedFeatures: {
              hasUnsupported: true,
              features: unsupportedCheck.unsupportedList,
              message: unsupportedCheck.message,
            },
          }),
        }
      }

      logger.info('[Planner] LLM result low confidence, falling back to patterns', {
        confidence: llmResult.confidence,
        nodeCount: llmResult.nodes.length,
      })
    } catch (error: any) {
      logger.warn('[Planner] LLM planner failed, falling back to patterns', {
        error: error?.message || String(error),
        isZodError: error?.name === 'ZodError',
        zodIssues: error?.issues?.map((i: any) => i.message),
        prompt: prompt?.substring(0, 80),
      })
    }
  }

  // Fall back to pattern matching
  logger.info('[Planner] Using pattern-based planning', { prompt })
  const patternResult = await planEditsWithPatterns({ prompt, flow })

  // Add unsupported features info if detected
  if (unsupportedCheck.hasUnsupported) {
    return {
      ...patternResult,
      unsupportedFeatures: {
        hasUnsupported: true,
        features: unsupportedCheck.unsupportedList,
        message: unsupportedCheck.message,
      },
    }
  }

  return patternResult
}

/**
 * Pattern-based planning with LLM fallback
 *
 * 1. Try fast-path pattern matching (~10 common templates, $0 cost)
 * 2. If no match, use a lightweight GPT-4o-mini call to select nodes
 * 3. If LLM also fails, generate clarifying questions
 */
async function planEditsWithPatterns({ prompt, flow }: { prompt: string; flow: Flow }): Promise<PlannerResult> {
  const edits: Edit[] = []
  const prerequisites: string[] = []
  const rationaleParts: string[] = []

  // Try fast-path pattern matching first
  let planTemplate = matchIntentToPlan(prompt)

  // If no fast-path match, try DB template keyword match ($0 cost)
  if (!planTemplate) {
    planTemplate = await matchDBTemplate(prompt)
  }

  // If still no match, try lightweight LLM fallback (~$0.001)
  if (!planTemplate) {
    logger.info('[Planner] No pattern/template match, trying lightweight LLM fallback', { prompt })
    planTemplate = await lightweightLLMPlan(prompt)
  }

  if (!planTemplate) {
    const clarifyingQuestions = await generateClarifyingQuestions(prompt)
    return {
      edits: [],
      prerequisites: [],
      rationale: "",
      deterministicHash: computeDeterministicHash([]),
      clarifyingQuestions,
    }
  }

  const existingNodeIds = new Set(flow.nodes.map((node) => node.id))
  const workingFlow = cloneFlow(flow)

  // Track created nodes for connecting
  const createdNodes: Node[] = []

  // Enhanced ensureNode to support both legacy and integration nodes
  const ensureNode = (type: string, configHints: Record<string, any> = {}) => {
    // Check if existing node of this type exists
    const existing = workingFlow.nodes.find((node) => node.type === type)
    if (existing) {
      return existing
    }

    // Try to find node in legacy registry first, then catalog
    const legacyDefinition = NODES[type]
    const catalogNode = findNodeInCatalog(type)

    if (!legacyDefinition && !catalogNode) {
      logger.warn(`[Planner] Node definition not found for type: ${type}`)
      return null
    }

    // Populate default config based on node schema
    let defaultConfig: Record<string, any> = {}

    if (catalogNode) {
      // Integration node - populate fields from configSchema
      if (catalogNode.configSchema && Array.isArray(catalogNode.configSchema)) {
        for (const field of catalogNode.configSchema) {
          const fieldName = field.name

          // Priority 1: Use config hint if provided
          if (configHints[fieldName] !== undefined) {
            defaultConfig[fieldName] = configHints[fieldName]
          }
          // Priority 2: Use field default value
          else if (field.defaultValue !== undefined) {
            defaultConfig[fieldName] = field.defaultValue
          }
          // Priority 3: Required fields get placeholder based on type
          else if (field.required) {
            switch (field.type) {
              case "text":
              case "email":
              case "rich-text":
                defaultConfig[fieldName] = field.placeholder || ""
                break
              case "select":
                // Don't set empty value for dynamic selects - let user choose
                if (!field.dynamic) {
                  defaultConfig[fieldName] = field.options?.[0] || ""
                }
                break
              case "boolean":
                defaultConfig[fieldName] = false
                break
              default:
                // Leave undefined for user to fill
                break
            }
          }
        }
      }
    } else if (legacyDefinition) {
      // Legacy node - use provided config hints
      defaultConfig = configHints
    }

    const nodeId = generateNodeId(existingNodeIds)
    const nodeTitle = catalogNode?.title || legacyDefinition?.title || type
    const nodeCostHint = legacyDefinition?.costHint || 0
    const nodeDescription = catalogNode?.description || legacyDefinition?.description

    // Build preview metadata from outputSchema
    const previewFields = catalogNode?.outputSchema?.slice(0, 3).map(field => ({
      name: field.name,
      label: field.label,
      type: field.type,
      example: field.example,
    })) || []

    const newNode: Node = {
      id: nodeId,
      type,
      label: nodeTitle,
      description: nodeDescription,
      config: defaultConfig,
      inPorts: [],
      outPorts: [],
      io: { inputSchema: undefined, outputSchema: undefined },
      policy: { timeoutMs: 60000, retries: 0 },
      costHint: nodeCostHint,
      metadata: {
        position: { x: workingFlow.nodes.length * 280, y: 120 },
        agentHighlights: Object.keys(defaultConfig),
        ...(catalogNode?.providerId && { providerId: catalogNode.providerId }),
        ...(catalogNode?.isTrigger !== undefined && { isTrigger: catalogNode.isTrigger }),
        // Preview block metadata - top 3 output fields for UI display
        ...(previewFields.length > 0 && { previewFields }),
        // Branch/lane positioning hints
        lane: 0, // Default to main lane, can be overridden for parallel branches
        branchIndex: workingFlow.nodes.length, // Sequential index for ordering
      },
    }
    workingFlow.nodes.push(newNode)
    edits.push({ op: "addNode", node: newNode })
    createdNodes.push(newNode)
    return newNode
  }

  // Build nodes according to plan template
  const nodes: (Node | null)[] = []

  for (const nodeType of planTemplate.nodeTypes) {
    // Get config hints for this specific node from the plan template
    const nodeConfigHints = planTemplate.configHints?.[nodeType] || {}

    // Create the node using ensureNode with config hints
    const node = ensureNode(nodeType, nodeConfigHints)

    if (node) {
      nodes.push(node)

      // Add rationale based on node type
      const catalogNode = findNodeInCatalog(nodeType)
      const legacyNode = NODES[nodeType]

      if (catalogNode) {
        const action = catalogNode.isTrigger ? "triggers when" : "performs"
        rationaleParts.push(`${catalogNode.title} ${action} ${catalogNode.description?.toLowerCase() || "action"}`)

        // Check for required fields that need user input
        if (catalogNode.configSchema) {
          const requiredFields = catalogNode.configSchema.filter(f => f.required && f.dynamic)
          if (requiredFields.length > 0) {
            const fieldNames = requiredFields.map(f => f.label).join(", ")
            prerequisites.push(`config:${nodeType}:${fieldNames}`)
          }
        }

        // Check if integration needs to be connected
        if (catalogNode.providerId && catalogNode.providerId !== "automation" && catalogNode.providerId !== "logic") {
          prerequisites.push(`integration:${catalogNode.providerId}`)
        }
      } else if (legacyNode) {
        rationaleParts.push(`${legacyNode.title}`)
      }

      // Special handling for specific legacy nodes
      if (nodeType === "notify.dispatch") {
        prerequisites.push("secret:SLACK_WEBHOOK")
      }
    }
  }

  // Connect nodes in sequence
  const existingEdgeKeys = new Set(flow.edges.map((edge) => `${edge.from.nodeId}->${edge.to.nodeId}`))

  for (let i = 0; i < nodes.length - 1; i++) {
    const from = nodes[i]
    const to = nodes[i + 1]

    if (!from || !to) continue

    const key = `${from.id}->${to.id}`
    if (existingEdgeKeys.has(key)) continue

    const edge: Edge = {
      id: crypto.randomUUID(), // Use UUID for database compatibility (workflow_edges.id is uuid type)
      from: { nodeId: from.id },
      to: { nodeId: to.id },
      mappings: [],
    }
    edits.push({ op: "connect", edge })
    existingEdgeKeys.add(key)
  }

  // Validate draft before returning
  const validation = validateDraft(workingFlow)
  if (!validation.ok) {
    logger.error("[Planner] Produced invalid flow", { errors: validation.errors })
    return {
      edits: [],
      prerequisites: [],
      rationale: `Planner error: ${validation.errors.join("; ")}`,
      deterministicHash: computeDeterministicHash([]),
    }
  }

  // Add fallback note to rationale if present
  let finalRationale = rationaleParts.join(" → ") || "No changes suggested"
  if (planTemplate.fallbackNote) {
    finalRationale += ` [Note: ${planTemplate.fallbackNote}]`
  }

  const combinedPrereqs = Array.from(new Set([...prerequisites, ...checkPrerequisites(workingFlow)]))
  const deterministicHash = computeDeterministicHash(edits)

  // Generate workflow name from prompt using AI
  const workflowName = await generateWorkflowNameWithAI(prompt, planTemplate)
  logger.info('[Planner] Generated workflow name', { workflowName, prompt })

  return {
    edits,
    prerequisites: combinedPrereqs,
    rationale: finalRationale,
    deterministicHash,
    workflowName,
    planningMethod: 'pattern',
  }
}

// Generate a professional, concise workflow name using AI
async function generateWorkflowNameWithAI(prompt: string, planTemplate: PlanTemplate | null): Promise<string> {
  logger.debug('[generateWorkflowNameWithAI] Input prompt', { prompt })
  const maxLength = 50

  try {
    const result = await callLLMWithRetry({
      messages: [
        {
          role: "system",
          content: `You are a professional workflow naming assistant. Create a concise, professional workflow name based on the user's request.

Rules:
- Maximum ${maxLength} characters
- Use title case (e.g., "Send Email to Slack")
- Be descriptive but brief
- Focus on the action/outcome
- No quotes, no periods, no extra punctuation
- Return ONLY the name, nothing else`
        },
        {
          role: "user",
          content: `Create a workflow name for this request: "${prompt}"`
        }
      ],
      model: AI_MODELS.utility,
      temperature: 0.3,
      maxTokens: 20,
      maxRetries: 1,
      fallbackModel: null,
      label: 'Planner:workflowName',
    })

    let name = result.content?.trim() || ''
    logger.debug('[generateWorkflowNameWithAI] AI generated name', { name })

    // Remove any quotes that might have been added
    name = name.replace(/^["']|["']$/g, '')

    // Ensure it's not too long
    if (name.length > maxLength) {
      name = name.substring(0, maxLength).trim() + '...'
      logger.debug('[generateWorkflowNameWithAI] Truncated to', { name })
    }

    // Fallback if AI returned empty or very short
    if (name.length < 3) {
      const fallback = planTemplate?.description || 'New Workflow'
      logger.debug('[generateWorkflowNameWithAI] AI name too short, using fallback', { fallback })
      return fallback
    }

    logger.debug('[generateWorkflowNameWithAI] Final name', { name })
    return name
  } catch (error) {
    logger.error('[generateWorkflowNameWithAI] Error generating name with AI', { error })

    // Fallback to simple text manipulation if AI fails
    let name = prompt.trim()
    name = name.replace(/^(create|build|make|setup|set up|i want to|i need to|please|can you|help me)\s+/i, '')
    name = name.replace(/\s+(workflow|automation|flow|please|for me|thanks?)$/i, '')
    name = name.charAt(0).toUpperCase() + name.slice(1)

    if (name.length > maxLength) {
      name = name.substring(0, maxLength).trim() + '...'
    }

    if (name.length < 5) {
      return planTemplate?.description || 'New Workflow'
    }

    logger.debug('[generateWorkflowNameWithAI] Using fallback name', { name })
    return name
  }
}
