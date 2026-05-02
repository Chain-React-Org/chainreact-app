import { generateObject } from "ai"
import { openai as aiOpenAI } from "@ai-sdk/openai"
import { z } from "zod"
import { ALL_NODE_COMPONENTS } from "@/lib/workflows/nodes"
import { loadPromptOverrides } from "@/lib/ai/promptOverrides"
import { NodeComponent } from "@/lib/workflows/nodes/types"
import { nodeRegistry, getAllNodes, getNodeByType } from "@/lib/workflows/nodes/registry"
import { getOpenAIClient } from '@/lib/ai/openai-client'

import { logger } from '@/lib/utils/logger'

export interface WorkflowGenerationRequest {
  prompt: string
  userId: string
  model?: 'gpt-4o' | 'gpt-4o-mini' // Optional model selection, defaults to gpt-4o-mini for cost
  debug?: boolean
  strict?: boolean
  extraSystemPrefix?: string
  extraUserSuffix?: string
}

export interface WorkflowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label: string
    title: string
    type: string
    config: Record<string, any>
    isTrigger?: boolean
    providerId?: string
  }
}

export interface WorkflowConnection {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export interface GeneratedWorkflow {
  name: string
  description: string
  nodes: WorkflowNode[]
  connections: WorkflowConnection[]
  isAIGenerated?: boolean // Flag to indicate this was AI-generated
}

export interface GeneratedWorkflowResult {
  workflow: GeneratedWorkflow
  debug?: {
    model: 'gpt-4o' | 'gpt-4o-mini'
    detectedScenarios: string[]
    systemPrompt: string
    userPrompt: string
    rawResponse: string
    errors?: string[]
    rejected?: boolean
  }
}

// Build a registry-constrained Zod schema at runtime
export function buildWorkflowSchema(options?: { prefersDiscord?: boolean }) {
  if (getAllNodes().length === 0) {
    nodeRegistry.registerNodes(ALL_NODE_COMPONENTS)
  }

  const all = getAllNodes()
  const triggerTypes = all.filter(n => n.isTrigger).map(n => n.type)
  const actionTypes = all.filter(n => !n.isTrigger && n.type !== 'ai_agent').map(n => n.type)

  const ZWorkflowNode = z.object({
    id: z.string(),
    type: z.string(),
    position: z.object({ x: z.number(), y: z.number() }),
    data: z.object({
      label: z.string(),
      title: z.string(),
      type: z.string(), // validated in superRefine per node role
      isTrigger: z.boolean().optional(),
      providerId: z.string().optional(),
      config: z.record(z.any()),
    })
  })

  const ZWorkflowConnection = z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    sourceHandle: z.string().optional(),
    targetHandle: z.string().optional(),
  })

  const ZGeneratedWorkflow = z.object({
    name: z.string(),
    description: z.string(),
    nodes: z.array(ZWorkflowNode).min(2).superRefine((nodes, ctx) => {
      // Exactly one trigger and one AI Agent node
      const triggers = nodes.filter(n => n.data.isTrigger === true)
      const aiAgents = nodes.filter(n => n.data.type === 'ai_agent')
      if (triggers.length !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Must include exactly one trigger node, found ${triggers.length}` })
      }
      if (aiAgents.length !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Must include exactly one AI Agent node, found ${aiAgents.length}` })
      }

      // Validate node types against registry
      nodes.forEach((node, idx) => {
        const t = node.data.type
        if (node.data.isTrigger) {
          if (!triggerTypes.includes(t)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [idx, 'data', 'type'],
              message: `Invalid trigger type '${t}'.`
            })
          }
        } else if (t !== 'ai_agent') {
          if (!actionTypes.includes(t)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [idx, 'data', 'type'],
              message: `Invalid action type '${t}'.`
            })
          }
        }
      })

      // If Discord flow, validate AI Agent chains exist with reasonable structure
      if (options?.prefersDiscord && aiAgents.length === 1) {
        const agent = aiAgents[0]
        const cfg: any = (agent as any).data?.config || {}
        const chains: any[] = Array.isArray(cfg.chains) ? cfg.chains : []
        if (chains.length !== 4) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Discord support workflows must include exactly 4 chains (bug, support, urgent, feature). Found ${chains.length}.` })
        } else {
          // Light enforcement: each chain must have 2-4 valid actions from registry
          chains.forEach((chain, cidx) => {
            const actions: any[] = Array.isArray(chain?.actions) ? chain.actions : []
            if (actions.length < 2 || actions.length > 6) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Chain ${cidx + 1} should have between 2 and 6 actions.` })
            }
            actions.forEach((a, aidx) => {
              const at = a?.type
              if (!at || !actionTypes.includes(at)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Chain ${cidx + 1}, action ${aidx + 1} has invalid type '${at}'.` })
              }
            })
          })

          // Scenario-level enforcement using chain names
          const lowerNames = chains.map((c: any) => (c?.name || '').toLowerCase())
          const hasBug = lowerNames.some(n => n.includes('bug') || n.includes('ticket'))
          const hasSupport = lowerNames.some(n => n.includes('support') || n.includes('question'))
          const hasUrgent = lowerNames.some(n => n.includes('urgent') || n.includes('emergency'))
          const hasFeature = lowerNames.some(n => n.includes('feature') || n.includes('request'))
          if (!(hasBug && hasSupport && hasUrgent && hasFeature)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Chains must cover bug, support, urgent, and feature scenarios.' })
          }

          // Per-scenario required actions (by best-effort chain match)
          chains.forEach((chain, cidx) => {
            const name = (chain?.name || '').toLowerCase()
            const acts: string[] = (Array.isArray(chain?.actions) ? chain.actions : []).map((a: any) => a?.type)
            const firstAct: string | undefined = acts[0]
            const lastAct: string | undefined = acts[acts.length - 1]
            const hasDiscord = acts.includes('discord_action_send_message')
            const hasSlack = acts.includes('slack_action_send_message')
            const hasTicket = acts.includes('trello_action_create_card') || acts.includes('github_action_create_issue')
            const hasNotionSearch = acts.includes('notion_action_search_pages')
            const hasStorage = acts.includes('notion_action_create_page') || acts.includes('airtable_action_create_record')

            if (name.includes('bug') || name.includes('ticket')) {
              if (!hasTicket) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Bug chain must include a ticket action (GitHub/Trello).` })
              if (!hasSlack) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Bug chain must notify team via Slack.` })
              if (hasDiscord && lastAct !== 'discord_action_send_message') ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Bug chain should end with a Discord confirmation.` })
            } else if (name.includes('support') || name.includes('question') || name.includes('help')) {
              if (firstAct !== 'notion_action_search_pages') ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Support chain must start with notion_action_search_pages.` })
              if (!hasDiscord) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Support chain must reply in Discord.` })
              if (lastAct && lastAct !== 'discord_action_send_message') ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Support chain should end with Discord reply.` })
            } else if (name.includes('urgent') || name.includes('emergency') || name.includes('critical')) {
              if (firstAct !== 'slack_action_send_message') ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Urgent chain must start with Slack alert.` })
              if (!hasTicket) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Urgent chain must include a ticket action.` })
              if (hasDiscord && lastAct !== 'discord_action_send_message') ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Urgent chain should end with Discord acknowledgement.` })
            } else if (name.includes('feature') || name.includes('request') || name.includes('suggestion')) {
              if (!hasStorage) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Feature chain must include Notion or Airtable storage action.` })
              if (hasDiscord && lastAct !== 'discord_action_send_message') ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Feature chain should end with Discord thank-you.` })
            }
          })
        }
      }
    }),
    connections: z.array(ZWorkflowConnection).min(1),
  })

  return ZGeneratedWorkflow
}

/**
 * Step 1: Dynamically generate prompt with actual available nodes
 */
function generateDynamicPrompt(): string {
  // Register all nodes if not already registered
  if (getAllNodes().length === 0) {
    nodeRegistry.registerNodes(ALL_NODE_COMPONENTS)
  }

  const allNodes = getAllNodes()
  // Filter out coming soon nodes - IMPORTANT: Must check comingSoon flag
  const availableNodes = allNodes.filter(node => !node.comingSoon && node.comingSoon !== true)
  const triggerNodes = availableNodes.filter(node => node.isTrigger)
  const actionNodes = availableNodes.filter(node => !node.isTrigger && node.type !== 'ai_agent')
  
  // Group triggers by provider for better organization
  const triggersByProvider = new Map<string, NodeComponent[]>()
  triggerNodes.forEach(node => {
    const providerId = node.providerId || 'generic'
    const nodes = triggersByProvider.get(providerId) || []
    nodes.push(node)
    triggersByProvider.set(providerId, nodes)
  })

  // Group actions by provider
  const actionsByProvider = new Map<string, NodeComponent[]>()
  actionNodes.forEach(node => {
    const providerId = node.providerId || 'generic'
    const nodes = actionsByProvider.get(providerId) || []
    nodes.push(node)
    actionsByProvider.set(providerId, nodes)
  })

  // Build trigger list
  let triggerList = "AVAILABLE TRIGGERS (use ONLY these exact types):\n"
  for (const [provider, nodes] of triggersByProvider) {
    triggerList += `\n${provider.toUpperCase()}:\n`
    nodes.forEach(node => {
      triggerList += `- ${node.type}: ${node.title} - ${node.description || 'No description'}\n`
    })
  }

  // Build action list
  let actionList = "AVAILABLE ACTIONS FOR CHAINS (use ONLY these exact types):\n"
  for (const [provider, nodes] of actionsByProvider) {
    actionList += `\n${provider.toUpperCase()}:\n`
    nodes.forEach(node => {
      // Only include actions that can be used in AI chains
      if (!node.type.includes('trigger') && !node.type.includes('webhook')) {
        actionList += `- ${node.type}: ${node.title} - ${node.description || 'No description'}\n`
      }
    })
  }

  return `
You are an expert workflow automation architect for ChainReact. Create sophisticated workflows with AI Agent chains.

CRITICAL UNDERSTANDING - AI AGENT CHAINS:
The AI Agent is a DECISION-MAKING HUB that analyzes input and executes different chains based on SCENARIOS:
- Each chain represents a DIFFERENT SCENARIO or USE CASE (e.g., "Customer Support", "Bug Report", "Feature Request")
- The AI Agent decides WHICH chain(s) to execute based on the input content
- Chains can run in parallel for complex workflows
- Each chain should have DIFFERENT actions appropriate for that scenario

CHAIN DESIGN PRINCIPLES:
1. Each chain must have a UNIQUE PURPOSE describing a specific scenario
2. Chain names should describe WHAT TRIGGERS that chain (e.g., "Handle Support Questions", "Process Bug Reports")
3. Actions within a chain should be RELEVANT to that scenario
4. Use DIVERSE actions across chains - don't repeat the same action in every chain
5. Think about REAL BUSINESS WORKFLOWS - what would actually happen in each scenario?

WORKFLOW STRUCTURE:
1. ALWAYS start with a trigger
2. Connect trigger to AI Agent 
3. AI Agent contains multiple scenario-based chains
4. Each chain handles a DIFFERENT type of input or situation

COMPLETE DISCORD TRIAGE EXAMPLE:
{
  "trigger": "discord_trigger_new_message",
  "ai_agent_chains": [
    {
      "name": "Bug Ticket Creation",
      "triggers_on": "Messages containing: bug, error, broken, crash",
      "actions": [
        "github_action_create_issue - Creates GitHub issue with bug details",
        "slack_action_send_message - Notifies dev team in #bugs channel",
        "discord_action_send_message - Confirms ticket created to user"
      ]
    },
    {
      "name": "General Question Support",
      "triggers_on": "Messages containing: how, what, help, question",
      "actions": [
        "notion_action_search_pages - Searches documentation",
        "discord_action_send_message - Sends helpful answer"
      ]
    },
    {
      "name": "Urgent Alert Handler",
      "triggers_on": "Messages containing: urgent, critical, down, emergency",
      "actions": [
        "slack_action_send_message - Immediate alert to #urgent with @here",
        "github_action_create_issue or trello_action_create_card - Create urgent ticket",
        "discord_action_send_message - Acknowledge urgency to user"
      ]
    },
    {
      "name": "Feature Request Logging",
      "triggers_on": "Messages containing: feature, request, would be nice, suggestion",
      "actions": [
        "notion_action_create_page - Log in feature requests database",
        "discord_action_send_message - Thank user for suggestion"
      ]
    }
  ]
}

The AI Agent analyzes Discord message content and branches to the appropriate chain!

${triggerList}

${actionList}

CONCRETE CHAIN EXAMPLES WITH ACTUAL ACTIONS:

1. Customer Support Chain:
   - Name: "Handle Customer Support Questions"
   - When it runs: User asks a general question or needs help
   - Actions: 
     * notion_action_search_pages (search knowledge base)
     * slack_action_send_message OR discord_action_send_message (reply to user)

2. Bug Report Chain:
   - Name: "Process Bug Reports"  
   - When it runs: User reports a bug, error, or something broken
   - Actions:
     * github_action_create_issue OR trello_action_create_card (create bug ticket)
     * slack_action_send_message (notify dev team)
     * discord_action_send_message (confirm to user)

3. Feature Request Chain:
   - Name: "Handle Feature Requests"
   - When it runs: User suggests new feature or improvement
   - Actions:
     * notion_action_create_page OR airtable_action_create_record (log request)
     * discord_action_send_message (thank user and confirm receipt)

4. Urgent/Emergency Chain:
   - Name: "Emergency Response"
   - When it runs: Keywords like "urgent", "critical", "emergency", "down", "broken"
   - Actions:
     * slack_action_send_message (alert on-call team IMMEDIATELY) 
     * gmail_action_send_email (send urgent email to team)
     * discord_action_send_message (acknowledge urgency to user)

5. FAQ/Simple Query Chain:
   - Name: "Answer Common Questions"
   - When it runs: Common questions about pricing, features, hours, etc.
   - Actions:
     * discord_action_send_message (send instant answer)

CRITICAL: Each chain must have DIFFERENT actions that make sense for that scenario!

RESPONSE FORMAT:
{
  "name": "Workflow Name",
  "description": "Brief description",
  "nodes": [
    {
      "id": "trigger-[timestamp]",
      "type": "custom",
      "position": {"x": 400, "y": 100},
      "data": {
        "label": "Trigger Label",
        "title": "Provider: Trigger Name",
        "type": "[exact_trigger_type]",
        "isTrigger": true,
        "providerId": "[provider]",
        "config": {
          "_allFieldsAI": true
        }
      }
    },
    {
      "id": "node-[timestamp]",
      "type": "custom", 
      "position": {"x": 400, "y": 300},
      "data": {
        "label": "AI Agent",
        "title": "AI Agent",
        "type": "ai_agent",
        "isTrigger": false,
        "providerId": "ai",
        "config": {
          "model": "gpt-4o-mini",
          "chains": [
            {
              "id": "chain-1",
              "name": "Scenario 1 Name (e.g., Handle Customer Support)",
              "description": "Detailed description of when this chain runs and what it does",
              "actions": [
                {
                  "type": "[action1_for_this_scenario]",
                  "providerId": "[provider]",
                  "aiConfigured": true,
                  "label": "Action Label"
                },
                {
                  "type": "[action2_for_this_scenario]",
                  "providerId": "[provider]",
                  "aiConfigured": true,
                  "label": "Action Label"
                }
              ]
            },
            {
              "id": "chain-2", 
              "name": "Scenario 2 Name (e.g., Process Bug Reports)",
              "description": "Different scenario with different actions",
              "actions": [
                {
                  "type": "[different_action1]",
                  "providerId": "[provider]",
                  "aiConfigured": true,
                  "label": "Action Label"
                },
                {
                  "type": "[different_action2]",
                  "providerId": "[provider]",
                  "aiConfigured": true,
                  "label": "Action Label"
                }
              ]
            }
          ]
        }
      }
    }
  ],
  "connections": [
    {
      "id": "edge-1",
      "source": "trigger-[timestamp]",
      "target": "node-[timestamp]"
    }
  ]
}

IMPORTANT RULES:
1. Use timestamps for IDs (e.g., trigger-1234567890, node-1234567891)
2. Create EXACTLY 4 scenario-based chains: Bug Report, General Support, Urgent, Feature Request
3. Each chain must have a DESCRIPTIVE name and description explaining WHEN it runs
4. NEVER use only discord_action_send_message in a chain - ALWAYS combine with other actions
5. All actions MUST use EXACT types from the lists above
6. Every action must have aiConfigured: true and a descriptive label
7. FOLLOW THE EXACT ACTION COMBINATIONS specified in CRITICAL REQUIREMENTS
8. First action in chain should NOT be Discord (except for FAQ chain)
9. Set AI Agent "config.model" to "gpt-4o-mini"
10. Return ONLY valid JSON without any markdown or explanation

FINAL CHECK before responding:
- Does EVERY Bug Report chain have github_action_create_issue or trello_action_create_card?
- Does EVERY Support chain have notion_action_search_pages?
- Does EVERY Urgent chain have slack_action_send_message as FIRST action?
- Does EVERY Feature Request chain have notion_action_create_page or airtable_action_create_record?
- Are there NO chains with only Discord actions?

Generate the workflow now.
`
}

// Expose current master system prompt (includes any admin overrides)
export function getCurrentMasterSystemPrompt(): string {
  // Ensure registry is populated so the prompt lists actual available nodes
  if (getAllNodes().length === 0) {
    nodeRegistry.registerNodes(ALL_NODE_COMPONENTS)
  }
  const base = generateDynamicPrompt()
  const overrides = loadPromptOverrides()
  const prefix = overrides.additionalSystem ? `${overrides.additionalSystem }\n\n` : ''
  return `${prefix}${base}`
}

/**
 * Step 2: Validate and fix generated nodes with proper titles
 */
function validateAndFixNodes(workflow: GeneratedWorkflow): { valid: boolean; workflow: GeneratedWorkflow; errors: string[] } {
  const errors: string[] = []
  
  // Register nodes if not already done
  if (getAllNodes().length === 0) {
    nodeRegistry.registerNodes(ALL_NODE_COMPONENTS)
  }

  // Check if this is likely a Discord support workflow
  const isDiscordSupport = workflow.nodes.some(n => 
    n.data.type?.includes('discord') || 
    n.data.providerId === 'discord'
  )
  
  // Process each node
  workflow.nodes = workflow.nodes.map(node => {
    // Skip AI Agent nodes as they're special
    if (node.data.type === 'ai_agent') {
      node.data.label = "AI Agent"
      node.data.title = "AI Agent"
      
      // Validate and fix actions in chains
      if (node.data.config?.chains) {
        // Fix each chain to ensure it has the right actions
        node.data.config.chains = node.data.config.chains.map((chain: any) => {
          const chainNameLower = chain.name?.toLowerCase() || ''
          const chainDescLower = chain.description?.toLowerCase() || ''
          
          // Detect chain type and fix actions if needed
          if (chainNameLower.includes('bug') || chainNameLower.includes('ticket') || 
              chainDescLower.includes('bug') || chainDescLower.includes('error')) {
            // Bug Report Chain - ensure it has ticket creation
            const hasTicketAction = chain.actions?.some((a: any) => 
              a.type?.includes('github') || a.type?.includes('trello')
            )
            if (!hasTicketAction) {
              logger.warn(`Fixing Bug Report chain - adding ticket creation`)
              chain.actions = [
                { type: "github_action_create_issue", providerId: "github", aiConfigured: true, label: "Create Issue" },
                { type: "slack_action_send_message", providerId: "slack", aiConfigured: true, label: "Notify Team" },
                ...(chain.actions || [])
              ]
            }
          } else if (chainNameLower.includes('support') || chainNameLower.includes('question') ||
                     chainDescLower.includes('help') || chainDescLower.includes('answer')) {
            // Support Chain - ensure it has search action
            const hasSearchAction = chain.actions?.some((a: any) => 
              a.type === 'notion_action_search_pages'
            )
            if (!hasSearchAction) {
              logger.warn(`Fixing Support chain - adding search action`)
              chain.actions = [
                { type: "notion_action_search_pages", providerId: "notion", aiConfigured: true, label: "Search Knowledge Base" },
                ...(chain.actions || [])
              ]
            }
          } else if (chainNameLower.includes('urgent') || chainNameLower.includes('emergency') ||
                     chainDescLower.includes('critical') || chainDescLower.includes('alert')) {
            // Urgent Chain - ensure it has Slack alert first
            const firstAction = chain.actions?.[0]
            if (!firstAction || !firstAction.type?.includes('slack')) {
              logger.warn(`Fixing Urgent chain - adding Slack alert`)
              chain.actions = [
                { type: "slack_action_send_message", providerId: "slack", aiConfigured: true, label: "Alert Team" },
                { type: "github_action_create_issue", providerId: "github", aiConfigured: true, label: "Create Urgent Ticket" },
                ...(chain.actions || [])
              ]
            }
          } else if (chainNameLower.includes('feature') || chainNameLower.includes('request') ||
                     chainDescLower.includes('suggestion') || chainDescLower.includes('idea')) {
            // Feature Request Chain - ensure it has storage action
            const hasStorageAction = chain.actions?.some((a: any) => 
              a.type?.includes('notion') || a.type?.includes('airtable')
            )
            if (!hasStorageAction) {
              logger.warn(`Fixing Feature Request chain - adding storage action`)
              chain.actions = [
                { type: "notion_action_create_page", providerId: "notion", aiConfigured: true, label: "Log Request" },
                ...(chain.actions || [])
              ]
            }
          }
          
          // Remove duplicate Discord messages (keep only last one)
          const discordActions = chain.actions?.filter((a: any) => a.type === 'discord_action_send_message') || []
          if (discordActions.length > 1) {
            // Keep only non-Discord actions and add one Discord at the end
            chain.actions = [
              ...(chain.actions?.filter((a: any) => a.type !== 'discord_action_send_message') || []),
              discordActions[0]
            ]
          }
          
          // Normalize search-like action types the AI sometimes picks: rewrite
          // hallucinated google_drive_action_search and the parallel notion_action_search
          // to the preferred notion_action_search_pages.
          chain.actions = (chain.actions || []).map((a: any) => {
            if (a.type === 'google_drive_action_search' || a.type === 'notion_action_search') {
              return { type: 'notion_action_search_pages', providerId: 'notion', aiConfigured: true, label: 'Search Knowledge Base' }
            }
            return a
          })
          
          return chain
        })
        
        // Check for expected chains if this is a Discord support workflow
        if (isDiscordSupport) {
          const chainNames = node.data.config.chains.map((c: any) => c.name?.toLowerCase() || '')
          const hasBugChain = chainNames.some((n: string) => n.includes('bug') || n.includes('ticket'))
          const hasQuestionChain = chainNames.some((n: string) => n.includes('question') || n.includes('support'))
          const hasUrgentChain = chainNames.some((n: string) => n.includes('urgent') || n.includes('emergency'))
          const hasFeatureChain = chainNames.some((n: string) => n.includes('feature') || n.includes('request'))
          
          // Add fallback chains if missing critical ones
          if (!hasBugChain) {
            logger.warn('Discord support workflow missing bug report chain - adding fallback')
            node.data.config.chains.push({
              id: `chain-fallback-bug-${Date.now()}`,
              name: "Bug Report Handler",
              description: "Handles bug reports and creates tickets",
              actions: [
                { type: "github_action_create_issue", providerId: "github", aiConfigured: true, label: "Create Issue" },
                { type: "slack_action_send_message", providerId: "slack", aiConfigured: true, label: "Notify Team" },
                { type: "discord_action_send_message", providerId: "discord", aiConfigured: true, label: "Confirm to User" }
              ]
            })
          }
          
          if (!hasQuestionChain) {
            logger.warn('Discord support workflow missing question chain - adding fallback')
            node.data.config.chains.push({
              id: `chain-fallback-support-${Date.now()}`,
              name: "General Support",
              description: "Answers general questions",
              actions: [
                { type: "notion_action_search_pages", providerId: "notion", aiConfigured: true, label: "Search Knowledge Base" },
                { type: "discord_action_send_message", providerId: "discord", aiConfigured: true, label: "Send Answer" }
              ]
            })
          }

          if (!hasUrgentChain) {
            logger.warn('Discord support workflow missing urgent chain - adding fallback')
            node.data.config.chains.push({
              id: `chain-fallback-urgent-${Date.now()}`,
              name: "Urgent Alert Handler",
              description: "Alerts team immediately and creates high-priority ticket",
              actions: [
                { type: "slack_action_send_message", providerId: "slack", aiConfigured: true, label: "Send Message" },
                { type: "trello_action_create_card", providerId: "trello", aiConfigured: true, label: "Create Card" },
                { type: "discord_action_send_message", providerId: "discord", aiConfigured: true, label: "Send Channel Message" }
              ]
            })
          }

          if (!hasFeatureChain) {
            logger.warn('Discord support workflow missing feature request chain - adding fallback')
            node.data.config.chains.push({
              id: `chain-fallback-feature-${Date.now()}`,
              name: "Feature Request Logging",
              description: "Logs feature requests and acknowledges the user",
              actions: [
                { type: "notion_action_create_page", providerId: "notion", aiConfigured: true, label: "Create Page" },
                { type: "discord_action_send_message", providerId: "discord", aiConfigured: true, label: "Send Channel Message" }
              ]
            })
          }
        }
        
        // Filter out invalid chains
        node.data.config.chains = node.data.config.chains.map((chain: any, chainIdx: number) => {
          if (chain.actions) {
            // Filter out invalid or coming soon actions
            const validActions = chain.actions.map((action: any, actionIdx: number) => {
              let actionComponent = getNodeByType(action.type)
              if (!actionComponent) {
                errors.push(`Chain ${chainIdx + 1}, Action ${actionIdx + 1}: Unknown action type '${action.type}'`)
                return null
              }
              // Substitute coming soon actions with supported equivalents when possible
              if (actionComponent.comingSoon) {
                if (action.type === 'github_action_create_issue') {
                  const trelloAlt = getNodeByType('trello_action_create_card')
                  if (trelloAlt && !trelloAlt.comingSoon) {
                    action = { type: trelloAlt.type, providerId: trelloAlt.providerId, aiConfigured: true, label: trelloAlt.title }
                    actionComponent = trelloAlt
                  } else {
                    errors.push(`Chain ${chainIdx + 1}, Action ${actionIdx + 1}: Action '${action.type}' is coming soon and no fallback available`)
                    return null
                  }
                } else {
                  errors.push(`Chain ${chainIdx + 1}, Action ${actionIdx + 1}: Action '${action.type}' is coming soon`)
                  return null
                }
              }
              // Use the actual title from the component
              action.label = actionComponent.title
              action.providerId = actionComponent.providerId || action.providerId
              return action
            }).filter(Boolean)
            chain.actions = validActions
          }
          return chain
        }).filter((chain: any) => chain.actions && chain.actions.length > 0) // Remove empty chains

        // Enforce exactly four scenario chains (Bug, Support, Urgent, Feature) for Discord support
        if (isDiscordSupport) {
          const desiredOrder = [
            { key: 'bug', match: (n: string) => n.includes('bug') || n.includes('ticket') },
            { key: 'support', match: (n: string) => n.includes('question') || n.includes('support') },
            { key: 'urgent', match: (n: string) => n.includes('urgent') || n.includes('emergency') },
            { key: 'feature', match: (n: string) => n.includes('feature') || n.includes('request') },
          ]
          const chainsByType = new Map<string, any>()
          node.data.config.chains.forEach((c: any) => {
            const name = (c.name || '').toLowerCase()
            const found = desiredOrder.find(d => d.match(name))
            if (found && !chainsByType.has(found.key)) chainsByType.set(found.key, c)
          })
          // If missing any, fallbacks were added above; re-check to include them
          const finalChains: any[] = []
          desiredOrder.forEach(d => {
            const existing = [...node.data.config.chains].find((c: any) => d.match((c.name || '').toLowerCase()))
            if (existing) finalChains.push(existing)
          })
          node.data.config.chains = finalChains.slice(0, 4)
        }
      }
      return node
    }

    // Look up the node component
    const nodeComponent = getNodeByType(node.data.type)
    
    if (!nodeComponent) {
      errors.push(`Unknown node type: ${node.data.type}`)
      return null // Mark for removal
    }
    
    if (nodeComponent.comingSoon) {
      errors.push(`Node type '${node.data.type}' is coming soon and not available`)
      return null // Mark for removal
    }

    // Step 2: Overwrite label and title with component's actual title
    node.data.label = nodeComponent.title
    node.data.title = nodeComponent.title
    node.data.providerId = nodeComponent.providerId || node.data.providerId
    node.data.isTrigger = nodeComponent.isTrigger
    
    // Ensure all fields are set to AI-defined mode for AI-generated workflows
    if (!node.data.config) {
      node.data.config = {}
    }
    node.data.config._allFieldsAI = true

    return node
  }).filter(node => node !== null) // Remove invalid nodes

  return {
    valid: errors.length === 0,
    workflow: {
      ...workflow,
      nodes: workflow.nodes
    },
    errors
  }
}

/**
 * Step 3: Enhanced chain expansion with vertical layout
 */
function expandAIAgentChainsVertical(workflow: GeneratedWorkflow): GeneratedWorkflow {
  const expandedNodes: WorkflowNode[] = []
  const expandedConnections: WorkflowConnection[] = []
  
  // Process each node
  workflow.nodes.forEach(node => {
    expandedNodes.push(node)
    
    // Check if this is an AI Agent node with chains
    if (node.data.type === 'ai_agent' && node.data.config?.chains?.length > 0) {
      const aiAgentId = node.id
      const aiAgentNode = node
      const chains = node.data.config.chains
      
      // Step 3: Generate visual nodes for each chain with vertical layout
      // Position chains evenly spaced around the AI Agent
      const aiAgentX = aiAgentNode.position.x
      const chainSpacing = 450 // Horizontal space between chain centers (increased to prevent overlaps)
      const totalChains = chains.length
      
      // Calculate starting X position to center all chains around AI Agent
      // For 3 chains: positions would be at -450, 0, +450 relative to center
      const startOffset = -((totalChains - 1) * chainSpacing) / 2
      
      chains.forEach((chain: any, chainIndex: number) => {
        // Each chain is evenly spaced from the AI Agent center
        const chainX = aiAgentX + startOffset + (chainIndex * chainSpacing)
        // Start position for first action in chain - below the AI Agent
        const yPosition = aiAgentNode.position.y + 200 // Start below AI Agent
        const ySpacing = 150 // Vertical space between actions
        
        let previousNodeId: string | null = null
        
        // Create action nodes for this chain
        if (chain.actions && Array.isArray(chain.actions)) {
          chain.actions.forEach((action: any, actionIndex: number) => {
            const timestamp = Date.now() + chainIndex * 1000 + actionIndex
            const actionNodeId = `${aiAgentId}-chain${chainIndex + 1}-action${actionIndex + 1}-${timestamp}`
            
            // Look up the actual node component for proper title
            const nodeComponent = getNodeByType(action.type)
            const nodeTitle = nodeComponent?.title || action.label || action.type
            
            // Create the action node with vertical positioning
            expandedNodes.push({
              id: actionNodeId,
              type: "custom",
              position: { 
                x: chainX, // Fixed x per chain
                y: yPosition + (actionIndex * ySpacing) // Increment y for each action
              },
              data: {
                label: nodeTitle,
                title: nodeTitle,
                type: action.type,
                providerId: action.providerId,
                isTrigger: false,
                config: action.aiConfigured ? { 
                  aiConfigured: true,
                  _allFieldsAI: true 
                } : (action.config || {}),
                parentAIAgentId: aiAgentId
              }
            })
            
            // Step 3.3: Create edges following vertical order
            if (actionIndex === 0) {
              // Connect AI Agent to first action
              expandedConnections.push({
                id: `edge-${aiAgentId}-to-${actionNodeId}`,
                source: aiAgentId,
                target: actionNodeId
              })
            } else if (previousNodeId) {
              // Connect previous action to current action (vertical flow)
              expandedConnections.push({
                id: `edge-${previousNodeId}-to-${actionNodeId}`,
                source: previousNodeId,
                target: actionNodeId
              })
            }
            
            previousNodeId = actionNodeId
          })
          
          // Add an "Add Action" node at the end of each chain to allow quick edits
          if (previousNodeId) {
            const addActionNodeId = `add-action-${aiAgentId}-chain${chainIndex + 1}-${Date.now()}`
            expandedNodes.push({
              id: addActionNodeId,
              type: "addAction",
              position: { x: chainX, y: yPosition + (chain.actions.length * ySpacing) },
              data: {
                parentId: previousNodeId,
                parentAIAgentId: aiAgentId,
              } as any
            })
            expandedConnections.push({
              id: `edge-${previousNodeId}-to-${addActionNodeId}`,
              source: previousNodeId,
              target: addActionNodeId
            })
          }
        }
      })
    }
  })
  
  // Copy original connections (except ones that might conflict)
  workflow.connections.forEach(conn => {
    // Only add connections that aren't duplicates
    if (!expandedConnections.find(c => c.source === conn.source && c.target === conn.target)) {
      expandedConnections.push(conn)
    }
  })
  
  return {
    ...workflow,
    nodes: expandedNodes,
    connections: expandedConnections,
    isAIGenerated: true // Mark as AI-generated to prevent Add Action nodes
  }
}

// Apply notification policy: after each primary action, append Gmail + Slack notifications
function applyNotificationPolicy(workflow: GeneratedWorkflow): GeneratedWorkflow {
  if (!workflow?.nodes) return workflow
  // Ensure registry
  if (getAllNodes().length === 0) nodeRegistry.registerNodes(ALL_NODE_COMPONENTS)
  const gmail = getNodeByType('gmail_action_send_email')
  const slack = getNodeByType('slack_action_send_message')
  if (!gmail || !slack) return workflow

  const cloned: GeneratedWorkflow = JSON.parse(JSON.stringify(workflow))
  const agent = cloned.nodes.find(n => n.data?.type === 'ai_agent')
  if (!agent) return workflow
  const cfg = (agent as any).data.config || {}
  if (!Array.isArray(cfg.chains)) return workflow

  cfg.chains = cfg.chains.map((chain: any) => {
    const actions: any[] = Array.isArray(chain.actions) ? chain.actions : []
    const expanded: any[] = []
    actions.forEach((a: any) => {
      expanded.push(a)
      const t = a?.type
      // Skip if this is already a notification action
      if (t === gmail.type || t === slack.type) return
      // Append Gmail + Slack after the primary action, avoid duplicates
      const lastTwo = expanded.slice(-2).map(x => x.type)
      if (!lastTwo.includes(gmail.type)) {
        expanded.push({ type: gmail.type, providerId: gmail.providerId, aiConfigured: true, label: gmail.title })
      }
      if (!lastTwo.includes(slack.type)) {
        expanded.push({ type: slack.type, providerId: slack.providerId, aiConfigured: true, label: slack.title })
      }
    })
    return { ...chain, actions: expanded }
  })
  ;(agent as any).data.config = cfg
  return cloned
}

/**
 * Main function to generate workflow with dynamic nodes
 */
/**
 * Analyze user prompt to detect scenarios
 */
function analyzeUserPrompt(prompt: string): string[] {
  const promptLower = prompt.toLowerCase()
  const detectedScenarios = []
  
  // Check for bug report scenario
  if (promptLower.includes('bug') || promptLower.includes('error') || 
      promptLower.includes('broken') || promptLower.includes('issue') ||
      promptLower.includes('problem') || promptLower.includes('fix')) {
    detectedScenarios.push('BUG_REPORT')
  }
  
  // Check for support scenario
  if (promptLower.includes('question') || promptLower.includes('help') || 
      promptLower.includes('support') || promptLower.includes('answer') ||
      promptLower.includes('regular question') || promptLower.includes('general')) {
    detectedScenarios.push('CUSTOMER_SUPPORT')
  }
  
  // Check for urgent scenario
  if (promptLower.includes('urgent') || promptLower.includes('emergency') || 
      promptLower.includes('critical') || promptLower.includes('asap') ||
      promptLower.includes('immediately') || promptLower.includes('alert')) {
    detectedScenarios.push('URGENT')
  }
  
  // Check for feature request scenario
  if (promptLower.includes('feature') || promptLower.includes('request') || 
      promptLower.includes('suggestion') || promptLower.includes('idea') ||
      promptLower.includes('improvement') || promptLower.includes('enhance')) {
    detectedScenarios.push('FEATURE_REQUEST')
  }
  
  // Check for FAQ scenario
  if (promptLower.includes('faq') || promptLower.includes('common') || 
      promptLower.includes('frequently') || promptLower.includes('simple')) {
    detectedScenarios.push('FAQ')
  }
  
  // If user mentions handling different types/scenarios but doesn't specify
  if ((promptLower.includes('different') && promptLower.includes('type')) ||
      (promptLower.includes('different') && promptLower.includes('message')) ||
      promptLower.includes('figure out') || promptLower.includes('smart') ||
      promptLower.includes('depending on')) {
    // Add common scenarios if none were explicitly detected
    if (detectedScenarios.length === 0) {
      detectedScenarios.push('CUSTOMER_SUPPORT', 'BUG_REPORT', 'FEATURE_REQUEST', 'URGENT')
    }
  }
  
  // Default to common scenarios if nothing detected
  if (detectedScenarios.length === 0) {
    detectedScenarios.push('CUSTOMER_SUPPORT', 'BUG_REPORT', 'URGENT')
  }
  
  return detectedScenarios
}

export async function generateDynamicWorkflow(request: WorkflowGenerationRequest): Promise<GeneratedWorkflowResult> {
  try {
    // Use UUIDs for database compatibility (workflow_nodes.id is uuid type)
    const triggerId = crypto.randomUUID()
    const aiAgentId = crypto.randomUUID()

    // Analyze user prompt to detect scenarios
    const detectedScenarios = analyzeUserPrompt(request.prompt)
    
    // Step 1: Generate dynamic prompt with actual available nodes and prepend admin overrides
    const dynamicPrompt = generateDynamicPrompt()
    const overrides = loadPromptOverrides()

    // Use the model from request, default to gpt-4o-mini for cost efficiency
    const model = request.model || 'gpt-4o-mini'

    // Detect if the user's prompt clearly targets Discord workflows
    const promptLower = request.prompt.toLowerCase()
    const prefersDiscord = promptLower.includes('discord')
    const mentionsForm = ['form', 'submission', 'inputs', 'submit', 'survey'].some(k => promptLower.includes(k))

    try {
      const systemContent = `${request.extraSystemPrefix || ''}${overrides.additionalSystem ? `${overrides.additionalSystem }\n\n` : ''}${dynamicPrompt}`
      const userContent = `Create a workflow for: ${request.prompt}

${prefersDiscord ? 'TRIGGER REQUIREMENT: Use discord_trigger_new_message as the trigger for new messages in a Discord channel.' : ''}
${(!prefersDiscord && mentionsForm) ? 'TRIGGER REQUIREMENT: Use webhook as the trigger to receive form inputs when a specific form provider is not named.' : ''}

DETECTED SCENARIOS TO IMPLEMENT:
${detectedScenarios.map(scenario => {
  switch(scenario) {
    case 'BUG_REPORT':
      return '- BUG REPORT CHAIN: Create ticket (GitHub/Trello) → Notify team (Slack) → Confirm to user (Discord)'
    case 'CUSTOMER_SUPPORT':
      return '- SUPPORT CHAIN: Search docs (Google Drive/Notion) → Send helpful response (Discord)'
    case 'URGENT':
      return '- URGENT CHAIN: Alert team immediately (Slack) → Create high-priority ticket → Acknowledge (Discord)'
    case 'FEATURE_REQUEST':
      return '- FEATURE REQUEST CHAIN: Store request (Notion/Airtable) → Thank user (Discord)'
    case 'FAQ':
      return '- FAQ CHAIN: Send instant answer (Discord)'
    default:
      return ''
  }
}).filter(Boolean).join('\n')}

CRITICAL REQUIREMENTS - YOU MUST FOLLOW EXACTLY:
1. Create EXACTLY these chains with the EXACT action types specified below
2. Each chain MUST have AT LEAST 2-3 different action types (not just Discord messages)
3. YOU ARE FORBIDDEN from creating chains with only discord_action_send_message
4. USE THESE EXACT ACTION COMBINATIONS:

For BUG REPORT chain - MUST include:
- github_action_create_issue OR trello_action_create_card (REQUIRED)
- slack_action_send_message (REQUIRED for team notification)
- discord_action_send_message (only as LAST action for confirmation)

For SUPPORT chain - MUST include:
- notion_action_search_pages (REQUIRED FIRST)
- discord_action_send_message (ONLY after search action)

For URGENT chain - MUST include:
- slack_action_send_message (REQUIRED FIRST for immediate alert)
- github_action_create_issue OR trello_action_create_card (REQUIRED for ticket)
- discord_action_send_message (only as LAST action)

For FEATURE REQUEST chain - MUST include:
- notion_action_create_page OR airtable_action_create_record (REQUIRED)
- discord_action_send_message (only for thank you)

VALIDATION: I will reject your response if any chain has only Discord actions!

Use these exact IDs:
- Trigger ID: ${triggerId}
- AI Agent ID: ${aiAgentId}

Respond with ONLY valid JSON that creates chains for the detected scenarios.${ request.extraUserSuffix ? `\n\n${request.extraUserSuffix}` : ''}`

      const ZGeneratedWorkflow = buildWorkflowSchema({ prefersDiscord })
      const { object } = await generateObject({
        model: aiOpenAI(model),
        schema: ZGeneratedWorkflow,
        prompt: `${systemContent}\n\n${userContent}`,
        temperature: 0.2,
      })

      const generatedWorkflow = object as unknown as GeneratedWorkflow
      
      // If prompt prefers Discord, ensure the trigger is Discord new message
      if (prefersDiscord) {
        // Ensure registry is ready
        if (getAllNodes().length === 0) {
          nodeRegistry.registerNodes(ALL_NODE_COMPONENTS)
        }
        const discordTrigger = getNodeByType('discord_trigger_new_message')
        if (discordTrigger) {
          // Find an existing trigger node
          const triggerIndex = generatedWorkflow.nodes.findIndex(n => n.data?.isTrigger)
          if (triggerIndex >= 0) {
            generatedWorkflow.nodes[triggerIndex].data.type = discordTrigger.type
            generatedWorkflow.nodes[triggerIndex].data.providerId = discordTrigger.providerId
            generatedWorkflow.nodes[triggerIndex].data.title = discordTrigger.title
            generatedWorkflow.nodes[triggerIndex].data.label = discordTrigger.title
            generatedWorkflow.nodes[triggerIndex].data.isTrigger = true
            generatedWorkflow.nodes[triggerIndex].data.config = {
              ...(generatedWorkflow.nodes[triggerIndex].data.config || {}),
              _allFieldsAI: true
            }
          } else {
            // No trigger present, create one
            // Use UUID for database compatibility
            generatedWorkflow.nodes.unshift({
              id: crypto.randomUUID(),
              type: 'custom',
              position: { x: 400, y: 100 },
              data: {
                label: discordTrigger.title,
                title: discordTrigger.title,
                type: discordTrigger.type,
                isTrigger: true,
                providerId: discordTrigger.providerId,
                config: { _allFieldsAI: true }
              }
            })
            // Ensure a basic edge to AI Agent exists will be handled in expansion
          }
        }
      }
      // If prompt mentions form inputs (and not Discord), force Webhook trigger
      if (!prefersDiscord && mentionsForm) {
        if (getAllNodes().length === 0) nodeRegistry.registerNodes(ALL_NODE_COMPONENTS)
        const webhookTrigger = getNodeByType('webhook')
        if (webhookTrigger) {
          const triggerIndex = generatedWorkflow.nodes.findIndex(n => n.data?.isTrigger)
          if (triggerIndex >= 0) {
            generatedWorkflow.nodes[triggerIndex].data.type = webhookTrigger.type
            generatedWorkflow.nodes[triggerIndex].data.providerId = webhookTrigger.providerId
            generatedWorkflow.nodes[triggerIndex].data.title = webhookTrigger.title
            generatedWorkflow.nodes[triggerIndex].data.label = webhookTrigger.title
            generatedWorkflow.nodes[triggerIndex].data.isTrigger = true
            generatedWorkflow.nodes[triggerIndex].data.config = {
              ...(generatedWorkflow.nodes[triggerIndex].data.config || {}),
              _allFieldsAI: true
            }
          }
        }
      }
      
      // Step 2: Validate and fix nodes with proper titles
      const { valid, workflow, errors } = validateAndFixNodes(generatedWorkflow)
      
      if (!valid) {
        logger.error("Workflow validation errors:", errors)
      }

      // Step 3a: If user refers to updating an existing Notion page (e.g., "customer support page"),
      // transform Notion actions to use search + update rather than create.
      const wantsUpdateExistingNotion = promptLower.includes('customer support page') || promptLower.includes('support page') || promptLower.includes('existing page')
      let workflowForPolicy = workflow
      if (wantsUpdateExistingNotion) {
        if (getAllNodes().length === 0) nodeRegistry.registerNodes(ALL_NODE_COMPONENTS)
        const notionSearch = getNodeByType('notion_action_search_pages')
        const notionUpdate = getNodeByType('notion_action_update_page')
        const notionCreate = getNodeByType('notion_action_create_page')
        if (notionSearch && notionUpdate) {
          const cloned: GeneratedWorkflow = JSON.parse(JSON.stringify(workflowForPolicy))
          const agent = cloned.nodes.find(n => n.data?.type === 'ai_agent')
          if (agent) {
            const cfg = (agent as any).data.config || {}
            if (Array.isArray(cfg.chains)) {
              cfg.chains = cfg.chains.map((chain: any) => {
                let actions: any[] = Array.isArray(chain.actions) ? chain.actions : []
                // Insert search at start if not present
                const hasSearch = actions.some(a => a.type === notionSearch.type)
                if (!hasSearch) {
                  actions = [{ type: notionSearch.type, providerId: notionSearch.providerId, aiConfigured: true, label: notionSearch.title }, ...actions]
                }
                // Replace any create_page with update_page
                actions = actions.map(a => {
                  if (notionCreate && a.type === notionCreate.type) {
                    return { type: notionUpdate.type, providerId: notionUpdate.providerId, aiConfigured: true, label: notionUpdate.title }
                  }
                  return a
                })
                return { ...chain, actions }
              })
              ;(agent as any).data.config = cfg
              workflowForPolicy = cloned
            }
          }
        }
      }

      // Step 3b: Apply notification policy (email + slack after each step) if requested in prompt
      const wantsNotifyEveryStep = (promptLower.includes('every step') || promptLower.includes('each step')) && promptLower.includes('email') && promptLower.includes('slack')
      const finalBeforeExpand = wantsNotifyEveryStep ? applyNotificationPolicy(workflowForPolicy) : workflowForPolicy

      // Step 3c: Expand chains with vertical layout
      const finalWorkflow = expandAIAgentChainsVertical(finalBeforeExpand)

      // Step 4: Ensure AI Agent node uses the selected model in config
      finalWorkflow.nodes = finalWorkflow.nodes.map(n => {
        if (n.data?.type === 'ai_agent') {
          n.data.config = {
            ...(n.data.config || {}),
            model: model
          }
        }
        return n
      })

      const rejected = !!(request.strict && errors && errors.length > 0)

      // If strict mode requested and validation errors exist, hard-fail (no fallback)
      if (rejected) {
        const err = new Error(`VALIDATION_FAILED: ${JSON.stringify(errors)}`)
        throw err
      }

      if (request.debug) {
        return {
          workflow: finalWorkflow,
          debug: {
            model,
            detectedScenarios,
            systemPrompt: systemContent,
            userPrompt: userContent,
            rawResponse: JSON.stringify(object),
            errors,
            rejected
          }
        }
      }
      return { workflow: finalWorkflow }
      
    } catch (aiError: any) {
      logger.error("AI generation failed:", aiError?.message || aiError)
      throw aiError
    }
  } catch (error) {
    logger.error("Error generating dynamic workflow:", error)
    throw error
  }
}

/**
 * Create a default workflow as fallback
 */
function createDefaultWorkflow(triggerId: string, aiAgentId: string): GeneratedWorkflow {
  // Register nodes if not already done
  if (getAllNodes().length === 0) {
    nodeRegistry.registerNodes(ALL_NODE_COMPONENTS)
  }

  const nodes: WorkflowNode[] = []
  const connections: WorkflowConnection[] = []
  
  // Use actual registered nodes for the default workflow
  const gmailTrigger = getNodeByType("gmail_trigger_new_email")
  const slackAction = getNodeByType("slack_action_send_message")
  const notionAction = getNodeByType("notion_action_create_page")
  
  if (!gmailTrigger) {
    throw new Error("Gmail trigger not found in registry")
  }

  // Add trigger node with proper title
  nodes.push({
    id: triggerId,
    type: "custom",
    position: { x: 400, y: 100 },
    data: {
      label: gmailTrigger.title,
      title: gmailTrigger.title,
      type: gmailTrigger.type,
      isTrigger: true,
      providerId: gmailTrigger.providerId,
      config: {
        _allFieldsAI: true
      }
    }
  })
  
  // Build chains with available actions
  const chains = []
  
  if (notionAction && slackAction) {
    chains.push({
      id: "chain-1",
      name: "Process Email",
      description: "Handle incoming emails",
      actions: [
        { 
          type: notionAction.type, 
          providerId: notionAction.providerId, 
          aiConfigured: true, 
          label: notionAction.title 
        },
        { 
          type: slackAction.type, 
          providerId: slackAction.providerId, 
          aiConfigured: true, 
          label: slackAction.title 
        }
      ]
    })
  }

  // Add AI Agent node
  nodes.push({
    id: aiAgentId,
    type: "custom",
    position: { x: 400, y: 300 },
    data: {
      label: "AI Agent",
      title: "AI Agent",
      type: "ai_agent",
      isTrigger: false,
      providerId: "ai",
      config: {
        model: "gpt-4o-mini",
        chains: chains
      }
    }
  })
  
  // Connect trigger to AI Agent
  connections.push({
    id: "edge-1",
    source: triggerId,
    target: aiAgentId
  })
  
  // Expand the chains with vertical layout
  const workflow = {
    name: "Email Processing Workflow",
    description: "Process incoming emails with AI",
    nodes,
    connections,
    isAIGenerated: true
  }
  
  return expandAIAgentChainsVertical(workflow)
}
