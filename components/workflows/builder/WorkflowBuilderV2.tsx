"use client"

/**
 * WorkflowBuilderV2
 *
 * This component provides the legacy builder UI look and feel while using
 * the Flow V2 backend infrastructure. It reuses as much visual structure
 * from NewWorkflowBuilderContent as possible while connecting to v2 APIs.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import "@xyflow/react/dist/style.css"
import "@/components/workflows/ai-agent/agent-flow.css"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { WorkflowLoadingScreen } from "@/components/ui/loading-screen"
import { useToast } from "@/hooks/use-toast"
import { BuilderLayout } from "./BuilderLayout"
import { useFlowV2LegacyAdapter } from "@/src/lib/workflows/builder/useFlowV2LegacyAdapter"
import {
  BuildState,
  type BuildStateMachine,
  type PlanNode,
  getInitialState,
  getBadgeForState,
} from "@/src/lib/workflows/builder/BuildState"
import { actionTestService } from "@/lib/workflows/testing/ActionTestService"
import { ALL_NODE_COMPONENTS } from "@/lib/workflows/nodes"
import { validateWorkflowNodes } from "@/lib/workflows/validation/workflow"
import type { NodeComponent } from "@/lib/workflows/nodes/types"
import { getNodeByType } from "@/lib/workflows/nodes/registry"
import { ConfigurationModal } from "@/components/workflows/configuration"
import { usePrefetchConfig } from "@/components/workflows/configuration/hooks/usePrefetchConfig"
import "./styles/FlowBuilder.anim.css"
import { Sparkles } from "lucide-react"
import { FlowV2BuilderContent } from "./FlowV2BuilderContent"
import { FlowV2AgentPanel } from "./FlowV2AgentPanel"
import { NodeStateTestPanel } from "./NodeStateTestPanel"
import { ActivationReviewDialog } from "./ActivationReviewDialog"
import { PathLabelsOverlay } from "./PathLabelsOverlay"
import { ProviderSelectionUI } from "../ai-agent/ProviderSelectionUI"
import { ProviderBadge } from "../ai-agent/ProviderBadge"
import {
  detectVagueTerms,
  detectAllVagueTerms,
  detectSpecificApps,
  getProviderOptions,
  replaceVagueTermWithProvider,
  getProviderDisplayName,
  PROVIDER_CATEGORIES,
  type ProviderCategory,
  type DetectedApp,
  type VagueTermDetection,
} from "@/lib/workflows/ai-agent/providerDisambiguation"
import { loadWorkflowPreferences } from "@/stores/workflowPreferencesStore"
import { useIntegrationStore } from "@/stores/integrationStore"
import { useWorkspaceContext } from "@/hooks/useWorkspaceContext"
import {
  applyDagreLayout,
  needsLayout,
  fitCanvasToFlow,
  panToNode,
  setAllNodesGrey,
  setNodeActive,
  setNodeDone,
  calculateHorizontalLayout,
  calculateSafeZoom,
  setNodeState,
} from "./layout"
import { BuildChoreographer } from "@/lib/workflows/ai-agent/build-choreography"
import { ChatService, type ChatMessage } from "@/lib/workflows/ai-agent/chat-service"
import { CostTracker, estimateWorkflowCost } from "@/lib/workflows/ai-agent/cost-tracker"
import { TaskBalanceWidget } from "./TaskBalanceWidget"
import { DisconnectedIntegrationsDialog, getDisconnectedIntegrations } from "./DisconnectedIntegrationsDialog"
import { getNodeTaskCost } from "@/lib/workflows/cost-calculator"
import { estimateWorkflowCost as estimateWorkflowTaskCost } from "@/lib/workflows/loop-cost-estimator"
import { useWorkflowCostStore } from "@/stores/workflowCostStore"
import { WorkflowStatusBar } from "./WorkflowStatusBar"
import { TestModeDialog } from "@/components/workflows/TestModeDialog"
import { ExecutionCostConfirmDialog, shouldSkipCostConfirmation } from "@/components/workflows/builder/ExecutionCostConfirmDialog"
import { useWorkflowTestStore } from "@/stores/workflowTestStore"
import { TestModeConfig, TriggerTestMode, ActionTestMode } from "@/lib/services/testMode/types"
import { useAuthStore } from "@/stores/authStore"
import { useIntegrationSelection } from "@/hooks/workflows/useIntegrationSelection"
import { swapProviderInPlan, canSwapProviders, getProviderCategory } from "@/lib/workflows/ai-agent/providerSwapping"
import { matchTemplate, logTemplateMatch, logTemplateMiss } from "@/lib/workflows/ai-agent/templateMatching"
import { logPrompt, updatePrompt } from "@/lib/workflows/ai-agent/promptAnalytics"
import { logger } from '@/lib/utils/logger'
import { agentEvalTracker } from '@/lib/eval/agentEvalTracker'
import { AGENT_EVAL_EVENTS, classifyFailure, classifyPromptComplexity } from '@/lib/eval/agentEvalTypes'
import { safeLocalStorageSet } from '@/lib/utils/storage-cleanup'
import { useAppContext } from "@/lib/contexts/AppContext"
import { useChatPersistence } from "@/hooks/workflows/builder/useChatPersistence"
import {
  useWorkflowDraftAutoSave,
  createDraftState,
  restoreProviderSelections,
  type WorkflowDraftState,
} from "@/hooks/workflows/builder/useWorkflowDraftAutoSave"
import { optionsPrefetchService } from "@/lib/workflows/configuration/optionsPrefetchService"
import { addNodeEdit, oldConnectToEdge, generateId } from "@/src/lib/workflows/compat/v2Adapter"
import {
  updateDraftingContext as _updateDraftingContextRaw,
  type DraftingContext,
  type ProviderMeta as DraftingProviderMeta,
  type VagueTermInfo,
} from "@/src/lib/workflows/builder/agent/draftingContext"
import { trackableDraftingUpdate as updateDraftingContext } from "@/lib/eval/trackableDraftingUpdate"

type PendingChatMessage = {
  localId: string
  role: ChatMessage['role']
  text: string
  subtext?: string
  meta?: Record<string, any>
  createdAt?: string
}

type NodeTestCacheEntry = {
  data: Record<string, any>
  result: {
    success: boolean
    executionTime?: number
    timestamp?: string
    error?: string
    message?: string
    rawResponse?: any
  }
}

// Agent panel dimensions - Responsive to screen size
// Mobile (< 640px): 100% width - margin
// Tablet (640-1024px): 400px
// Desktop (1024-1600px): 420px (design spec)
// Large Desktop (≥ 1600px): 25% of viewport, max 600px
const AGENT_PANEL_MARGIN = 16 // Margin on each side
const AGENT_PANEL_MIN_WIDTH = 300 // Mobile minimum
const AGENT_PANEL_MAX_WIDTH = 600 // Large desktop maximum
const LINEAR_STACK_X = 400
const LINEAR_NODE_VERTICAL_GAP = 180

type MoveNodeResult = { newOrder: string[]; changed: boolean } | null

// Kadabra-style node display name mapping
const NODE_DISPLAY_NAME_MAP: Record<string, string> = {
  // Gmail
  'gmail_trigger_new_email': 'Gmail.Trigger',
  'gmail_action_send_email': 'Gmail.SendEmail',

  // Slack
  'slack_action_send_message': 'Slack.Post',
  'slack_action_create_channel': 'Slack.CreateChannel',

  // Discord
  'discord_action_send_message': 'Discord.SendMessage',

  // AI
  'ai_agent': 'AI.Agent',
  'ai.generate': 'AI.Generate',

  // Utility
  'transformer': 'Transformer',
  'format_transformer': 'Formatter.HTMLtoMarkdown',

  // Notion
  'notion_action_create_page': 'Notion.CreatePage',
  'notion_action_update_page': 'Notion.UpdatePage',

  // Monday.com (for when nodes are added)
  'monday_action_get_board_tasks': 'Monday.GetBoardTasks',
  'monday_trigger_new_item': 'Monday.NewItem',

  // Gmail actions
  'gmail_action_send_email_to_me': 'SendEmailToMe',

  // Generic/Legacy
  'http.trigger': 'HTTP.Trigger',
  'http.request': 'HTTP.Request',
  'notify.dispatch': 'Notify.Dispatch',
  'mapper.node': 'Mapper',
  'logic.ifSwitch': 'Logic.IfSwitch',
}

/**
 * Runs planning stage animations in parallel with the API call.
 * Each stage has a minimum display time but advances early when the API responds.
 * If the API is slow, DESIGNING holds with animated dots until the response arrives,
 * and the badge text escalates after a few seconds to avoid feeling static.
 */
async function runPlanningStages<T>(
  transitionTo: (state: BuildState) => void,
  apiCall: () => Promise<T>,
): Promise<T> {
  let apiResult: { value: T } | undefined
  let apiError: any

  const apiPromise = apiCall().then(
    r => { apiResult = { value: r }; return r },
    e => { apiError = e; throw e }
  )

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  // Stage 1: UNDERSTANDING (min 600ms, advances early if API already done)
  transitionTo(BuildState.UNDERSTANDING)
  await delay(600)

  // Stage 2: DESIGNING (min 600ms, then holds until API resolves)
  transitionTo(BuildState.DESIGNING)
  if (!apiResult && !apiError) {
    await delay(600)
  }

  // If API still pending, wait for it (DESIGNING badge stays visible with dots)
  if (!apiResult && !apiError) {
    try {
      await apiPromise
    } catch {
      // Error will be re-thrown below
    }
  }

  if (apiError) {
    throw apiError
  }

  return apiResult!.value
}

function getKadabraStyleNodeName(nodeType: string, providerId?: string, title?: string): string {
  // Check explicit mapping first
  if (NODE_DISPLAY_NAME_MAP[nodeType]) {
    return NODE_DISPLAY_NAME_MAP[nodeType]
  }

  // Fallback to Provider.Action format
  if (providerId && title) {
    const provider = providerId.charAt(0).toUpperCase() + providerId.slice(1)
    const action = title.replace(/\s+/g, '')
    return `${provider}.${action}`
  }

  return title || nodeType
}

const isReorderableNode = (node: any) => {
  if (!node || node.type !== 'custom') return false
  const data = node.data || {}
  if (data.isTrigger) return false
  if (data.isPlaceholder) return false
  if (data.type === 'chain_placeholder') return false
  return true
}

const isTriggerNode = (node: any) => {
  if (!node || node.type !== 'custom') return false
  const data = node.data || {}
  if (data.isPlaceholder) return false
  const type = data.type || data.nodeType || data.dataType || ''
  return Boolean(data.isTrigger || (typeof type === 'string' && type.includes('_trigger_')))
}

/**
 * Compute responsive agent panel width based on viewport size
 * Mobile (< 640px): Full width minus margins
 * Tablet (640-1024px): 400px
 * Desktop (1024-1600px): 420px (design spec)
 * Large Desktop (>= 1600px): 25% of viewport, max 600px
 */
function computeReactAgentPanelWidth(win?: { innerWidth: number }) {
  if (!win) {
    return AGENT_PANEL_MAX_WIDTH // Default to desktop size during SSR
  }

  const viewportWidth = win.innerWidth

  // Mobile: Use full width minus margins
  if (viewportWidth < 640) {
    const availableWidth = viewportWidth - (AGENT_PANEL_MARGIN * 2)
    return Math.max(AGENT_PANEL_MIN_WIDTH, availableWidth)
  }

  // Tablet: Fixed 400px
  if (viewportWidth < 1024) {
    return 400
  }

  // Desktop standard: 420px (design spec)
  if (viewportWidth < 1600) {
    return 420
  }

  // Large Desktop: Scale to 25% of viewport, max 600px
  const scaledWidth = Math.floor(viewportWidth * 0.25)
  return Math.min(scaledWidth, 600)
}

/**
 * Try template matching first, fallback to LLM if no match
 * Cost: $0.00 for template match, ~$0.03 for LLM fallback
 */
async function planWorkflowWithTemplates(
  actions: any,
  prompt: string,
  providerId?: string,
  userId?: string,
  workflowId?: string,
  agentContext?: { draftingContext?: DraftingContext | null; conversationHistory?: any[] }
): Promise<{ result: any; usedTemplate: boolean; promptId?: string }> {
  logger.debug('[planWorkflowWithTemplates] Starting...', { prompt, providerId })

  // Try template matching first (now async)
  logger.debug('[planWorkflowWithTemplates] Checking templates...')
  const match = await matchTemplate(prompt, providerId)
  logger.debug('[planWorkflowWithTemplates] Template match result:', match ? match.template.id : 'no match')

  if (match) {
    // Template match! Create fake "result" object that looks like askAgent response
    logger.debug('[planWorkflowWithTemplates] 🎯 Template matched! Generating plan...')
    logTemplateMatch(match.template.id, prompt)

    // Log prompt analytics (non-blocking with timeout - don't let it block workflow creation)
    logger.debug('[planWorkflowWithTemplates] Logging prompt analytics (non-blocking)...')
    Promise.race([
      logPrompt({
        userId: userId || '',
        workflowId,
        prompt,
        templateId: match.template.id,
        usedTemplate: true,
        templateSource: match.template.id.startsWith('dynamic-') ? 'dynamic' : 'built_in',
        usedLlm: false,
        llmCost: 0.0,
        detectedProvider: providerId,
        planNodes: match.plan.length,
        planGenerated: true,
      }),
      new Promise<null>((resolve) => setTimeout(() => {
        logger.warn('[planWorkflowWithTemplates] Template analytics logging timed out after 3s')
        resolve(null)
      }, 3000))
    ]).then(promptId => {
      if (promptId) logger.debug('[planWorkflowWithTemplates] Prompt logged:', promptId)
    }).catch(logError => {
      logger.warn('[planWorkflowWithTemplates] ⚠️ Failed to log prompt (continuing anyway):', logError)
    })

    // Convert template plan to edits format
    // IMPORTANT: Generate UUIDs for node IDs instead of using template IDs like "action-1"
    // The database expects UUID format for workflow_nodes.id and workflow_edges.source_node_id/target_node_id
    // Also ensure node structure matches what handleBuild expects (providerId in metadata)
    logger.debug('[planWorkflowWithTemplates] Creating edits from template plan...', { planLength: match.plan.length })
    const plan = match.plan
    logger.debug('[planWorkflowWithTemplates] Plan nodes:', plan.map(n => n.nodeType))

    const edits = plan.map((node) => {
      // Look up the node in the catalog to get isTrigger and other metadata
      const catalogNode = ALL_NODE_COMPONENTS.find(c => c.type === node.nodeType)
      const isTrigger = catalogNode?.isTrigger ?? node.nodeType.includes('_trigger_')

      return {
        op: 'addNode',
        node: {
          id: crypto.randomUUID(),
          type: node.nodeType,
          label: node.title,
          metadata: {
            providerId: node.providerId || catalogNode?.providerId,
            isTrigger,
          },
        },
      }
    })

    logger.debug('[planWorkflowWithTemplates] ✅ Returning template result with', edits.length, 'edits')
    return {
      result: {
        workflowName: match.template.description,
        edits,
        rationale: `Created from template: ${match.template.description}`,
      },
      usedTemplate: true,
      promptId: undefined, // No analytics for template matches
    }
  }

  // No template match - use LLM (costs money)
  logger.debug('[planWorkflowWithTemplates] No template match, falling back to LLM...')
  logTemplateMiss(prompt)

  // Log prompt analytics (LLM usage) - non-blocking with timeout
  // Don't let analytics block the workflow creation
  logger.debug('[planWorkflowWithTemplates] Logging prompt analytics (non-blocking)...')
  let promptId: string | null = null
  const analyticsPromise = Promise.race([
    logPrompt({
      userId: userId || '',
      workflowId,
      prompt,
      usedTemplate: false,
      usedLlm: true,
      llmCost: 0.03,
      detectedProvider: providerId,
      planGenerated: false,
    }),
    new Promise<null>((resolve) => setTimeout(() => {
      logger.warn('[planWorkflowWithTemplates] Analytics logging timed out after 3s')
      resolve(null)
    }, 3000))
  ]).then(id => {
    promptId = id
    if (id) logger.debug('[planWorkflowWithTemplates] Prompt logged:', id)
  }).catch(err => {
    logger.warn('[planWorkflowWithTemplates] Analytics logging failed:', err?.message)
  })

  // Don't wait for analytics - proceed with askAgent immediately
  logger.debug('[planWorkflowWithTemplates] Calling askAgent...')

  let result
  try {
    result = await actions.askAgent(prompt, {
      draftingContext: agentContext?.draftingContext ?? undefined,
      conversationHistory: agentContext?.conversationHistory,
    })
    logger.debug('[planWorkflowWithTemplates] ✅ askAgent returned:', { hasEdits: !!result?.edits })
  } catch (askError: any) {
    logger.error('[planWorkflowWithTemplates] ❌ askAgent FAILED:', askError?.message || askError)
    throw askError // Re-throw to be caught by the caller
  }

  // Update prompt with plan details (non-blocking)
  // Wait for analytics promise to complete first, then update
  analyticsPromise.then(() => {
    if (promptId && result.edits) {
      updatePrompt({
        promptId,
        planBuilt: false, // Not built yet, just planned
      }).catch(err => {
        logger.warn('[planWorkflowWithTemplates] Failed to update prompt analytics:', err?.message)
      })
    }
  })

  return {
    result,
    usedTemplate: false,
    promptId: promptId || undefined,
  }
}

interface WorkflowBuilderV2Props {
  flowId: string
  initialRevision?: any
  initialStatus?: 'draft' | 'active' | 'inactive'
}

export function WorkflowBuilderV2({ flowId, initialRevision, initialStatus }: WorkflowBuilderV2Props) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const promptParam = searchParams?.get("prompt") ?? searchParams?.get("initialPrompt") ?? null
  const openPanelParam = searchParams?.get("openPanel") === "true"

  // Store router and searchParams in refs to avoid useEffect dependency loops
  // These hooks return new object instances every render, causing infinite loops
  // when used directly in dependency arrays
  const routerRef = useRef(router)
  const searchParamsRef = useRef(searchParams)
  useEffect(() => {
    routerRef.current = router
    searchParamsRef.current = searchParams
  }, [router, searchParams])

  // Use unified app context
  const appContext = useAppContext()
  const { isReady: appReady } = appContext

  const adapter = useFlowV2LegacyAdapter(flowId, { initialRevision, initialStatus })
  const { integrations, fetchIntegrations, setWorkspaceContext: setIntegrationWorkspaceContext } = useIntegrationStore()
  const { workspaceContext } = useWorkspaceContext()
  const builder = adapter.flowState
  const actions = adapter.actions
  const flowState = builder?.flowState
  const { toast } = useToast()
  const { phase: authPhase, user } = useAuthStore()
  const authInitialized = authPhase === 'ready'
  const { isIntegrationConnected } = useIntegrationSelection()
  const { prefetchNodeConfig } = usePrefetchConfig()

  // Initialize agent eval tracker
  useEffect(() => {
    if (user?.id) {
      agentEvalTracker.init(user.id)
      agentEvalTracker.setFlowId(flowId)
    }
    return () => agentEvalTracker.destroy()
  }, [user?.id, flowId])

  // Debug: Log when key initialization states change (helps diagnose stuck builds after restart)
  // Using derived booleans as deps instead of object refs to prevent infinite loops
  const hasActions = !!actions
  const hasBuilder = !!builder
  const hasFlowState = !!flowState
  useEffect(() => {
    // Only log on actual state transitions, not every render
    logger.debug('[WorkflowBuilder Init] Key states:', {
      hasActions,
      hasBuilder,
      hasFlowState,
      authInitialized,
      flowId,
      timestamp: new Date().toISOString(),
    })
  }, [hasActions, hasBuilder, hasFlowState, authInitialized, flowId])

  // State management
  const [workflowName, setWorkflowName] = useState(adapter.state.flowName)
  const [nameDirty, setNameDirty] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [addingAfterNodeId, setAddingAfterNodeId] = useState<string | null>(null) // Persists while integrations panel is open
  const [changingNodeId, setChangingNodeId] = useState<string | null>(null) // Set when user wants to replace a node's type
  const [isFlowTesting, setIsFlowTesting] = useState(false) // True while testing flow from a node
  const [flowTestStatus, setFlowTestStatus] = useState<{ total: number; currentIndex: number; currentNodeLabel?: string } | null>(null)
  const [isFlowTestPaused, setIsFlowTestPaused] = useState(false) // True when flow test is paused
  const [isNodeTesting, setIsNodeTesting] = useState(false) // True while testing a single node
  const [nodeTestingName, setNodeTestingName] = useState<string | null>(null) // Name of node being tested
  const [isTestModeDialogOpen, setIsTestModeDialogOpen] = useState(false) // Test/Live mode dialog
  const [isCostConfirmOpen, setIsCostConfirmOpen] = useState(false) // Pre-execution cost confirmation
  const [pendingTestConfig, setPendingTestConfig] = useState<{ config: any; mockVariation?: string } | null>(null) // Stored config while cost confirm is shown
  const [isDisconnectedDialogOpen, setIsDisconnectedDialogOpen] = useState(false) // Disconnected integrations dialog
  const [showActivationReview, setShowActivationReview] = useState(false) // Pre-activation review dialog
  const [isActivatingAfterReview, setIsActivatingAfterReview] = useState(false) // True during activation after review
  const [disconnectedIntegrations, setDisconnectedIntegrations] = useState<any[]>([]) // List of disconnected integrations

  // Ref to track if test is in progress and abort controller for cleanup
  const testAbortControllerRef = useRef<AbortController | null>(null)
  const testSessionIdRef = useRef<string | null>(null)
  const isMountedRef = useRef(true)

  // Refs for polling execution status after HITL pause
  const pausedExecutionIdRef = useRef<string | null>(null)
  const executionPollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastSyncedProgressRef = useRef<{
    currentNodeId: string | null
    completedNodes: string[]
  }>({ currentNodeId: null, completedNodes: [] })

  // CRITICAL FIX: Cache the last valid reactFlowProps to prevent nodes from disappearing
  // during production re-renders when builder temporarily has no nodes
  const lastValidReactFlowPropsRef = useRef<{
    nodes: any[]
    edges: any[]
    onNodesChange: any
    onEdgesChange: any
    onConnect: any
    nodeTypes: any
    edgeTypes: any
  } | null>(null)

  // Cleanup function to deactivate webhooks when test ends
  const cleanupTestTrigger = useCallback(async () => {
    const sessionId = testSessionIdRef.current
    if (!sessionId || !flowId) {
      logger.debug('[TEST] No test session to cleanup')
      return
    }

    logger.debug('[TEST] Cleaning up test trigger...', { sessionId, workflowId: flowId })
    try {
      await fetch('/api/workflows/test-trigger', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: flowId,
          testSessionId: sessionId,
        }),
      })
      logger.debug('[TEST] Test trigger cleaned up successfully')
    } catch (error) {
      logger.error('[TEST] Failed to cleanup test trigger:', error)
    } finally {
      testSessionIdRef.current = null
    }
  }, [flowId])

  // CONSOLIDATED: Mount/unmount + resize handler + AI infrastructure init
  // Combined for better performance (fewer effect registrations)
  useEffect(() => {
    isMountedRef.current = true

    // Window resize handler
    const handleResize = () => {
      if (typeof window === "undefined") return
      const newWidth = computeReactAgentPanelWidth(window)
      setAgentPanelWidth(newWidth)
    }
    if (typeof window !== "undefined") {
      window.addEventListener('resize', handleResize)
    }

    // Initialize AI Agent infrastructure
    if (typeof window !== "undefined") {
      const preferReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      choreographerRef.current = new BuildChoreographer(preferReducedMotion)
      costTrackerRef.current = new CostTracker()

      // Restore agent panel state from localStorage (unless openPanel param is set)
      if (openPanelParam) {
        // URL explicitly requests panel to be open (new workflow creation)
        setAgentOpen(true)
      } else {
        const stored = window.localStorage.getItem("reactAgentPanelOpen")
        if (stored) {
          setAgentOpen(stored === "true")
        }
      }
    }

    return () => {
      isMountedRef.current = false
      // Abort any ongoing test when unmounting
      if (testAbortControllerRef.current) {
        testAbortControllerRef.current.abort()
      }
      // Stop execution polling on unmount
      if (executionPollIntervalRef.current) {
        clearInterval(executionPollIntervalRef.current)
        executionPollIntervalRef.current = null
      }
      // Cleanup test trigger on unmount
      cleanupTestTrigger()
      // Remove resize listener
      if (typeof window !== "undefined") {
        window.removeEventListener('resize', handleResize)
      }
    }
  }, [cleanupTestTrigger])

  // Auto-deactivate workflow when leaving page if it's active but incomplete (has placeholders)
  // This ensures workflows without triggers cannot remain in active state
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Check if workflow is active and has placeholders
      const isActive = flowState?.workflowStatus === 'active'
      const hasPlaceholderNodes = builder?.nodes?.some((n: any) => n.data?.isPlaceholder) ?? false

      if (isActive && hasPlaceholderNodes && flowId) {
        logger.debug('[WorkflowBuilder] Auto-deactivating incomplete workflow on page leave')
        // Use sendBeacon for reliable delivery on page unload
        navigator.sendBeacon(
          `/api/workflows/${flowId}/deactivate`,
          new Blob([JSON.stringify({})], { type: 'application/json' })
        )
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [flowId, flowState?.workflowStatus, builder?.nodes])

  // Show toast when trigger activation fails on an active workflow (e.g., trigger switch failed)
  useEffect(() => {
    if (flowState?.triggerActivationError) {
      const details = flowState.triggerActivationError.details
      const errorDetail = Array.isArray(details) ? details.join(', ') : details

      toast({
        title: "Trigger Activation Failed",
        description: `${flowState.triggerActivationError.message}. Your workflow has been deactivated.${errorDetail ? ' Details: ' + errorDetail : ''}`,
        variant: "destructive",
      })
    }
  }, [flowState?.triggerActivationError, toast])

  const [isIntegrationsPanelOpen, setIsIntegrationsPanelOpen] = useState(false)
  const [integrationsPanelMode, setIntegrationsPanelMode] = useState<'trigger' | 'action'>('action')
  const [configuringNode, setConfiguringNode] = useState<any>(null)

  // Derived configuringNodeId for lightweight dependency in reactFlowProps useMemo
  // This prevents the entire useMemo from recalculating when the full node object changes
  const configuringNodeId = configuringNode?.id ?? null

  // Agent panel state
  const [agentPanelWidth, setAgentPanelWidth] = useState(() =>
    computeReactAgentPanelWidth(typeof window === "undefined" ? undefined : window)
  )

  const [agentOpen, setAgentOpen] = useState(true)
  const [agentInput, setAgentInput] = useState("")
  const [agentMessages, setAgentMessages] = useState<ChatMessage[]>([])
  const [draftingContext, setDraftingContext] = useState<DraftingContext | null>(null)
  const [isAgentLoading, setIsAgentLoading] = useState(false)
  const [agentStatus, setAgentStatus] = useState("")
  const lastConfigNodeIdRef = useRef<string | null>(null)
  const [isViewLocked, setIsViewLocked] = useState(false)
  const hasInitialCenterRef = useRef(false)

  const getConfigPanelWidth = useCallback(() => {
    if (typeof window === 'undefined') return 600
    const viewportWidth = window.innerWidth
    return viewportWidth < 640 ? viewportWidth : 600
  }, [])

  const getIntegrationsPanelWidth = useCallback(() => {
    if (typeof window === 'undefined') return 600
    const viewportWidth = window.innerWidth
    return viewportWidth < 640 ? viewportWidth : 600
  }, [])

  const getViewportMetrics = useCallback((rightPanelWidth: number) => {
    const headerHeight = 48
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080
    const leftOffset = agentOpen ? agentPanelWidth : 0
    const rightOffset = rightPanelWidth
    let availableWidth = viewportWidth - leftOffset - rightOffset
    const availableHeight = viewportHeight - headerHeight

    if (availableWidth < 200) {
      availableWidth = viewportWidth
    }

    return {
      headerHeight,
      viewportWidth,
      viewportHeight,
      leftOffset,
      rightOffset,
      availableWidth,
      availableHeight,
    }
  }, [agentOpen, agentPanelWidth])

  const focusConfigNode = useCallback((nodeId: string) => {
    if (isViewLocked) return
    const instance = reactFlowInstanceRef.current
    if (!instance || !nodeId) return
    const node = instance.getNode(nodeId)
    if (!node) return

    const {
      headerHeight,
      leftOffset,
      availableWidth,
      availableHeight,
    } = getViewportMetrics(getConfigPanelWidth())

    const currentZoom = instance.getViewport?.().zoom ?? 1
    const zoom = Math.min(1.2, Math.max(currentZoom, 1.05))
    const nodeWidth = node.width ?? 360
    const nodeHeight = node.height ?? 100
    const nodeCenterX = node.position.x + nodeWidth / 2
    const nodeCenterY = node.position.y + nodeHeight / 2
    const screenCenterX = leftOffset + (availableWidth / 2)
    const screenCenterY = headerHeight + (availableHeight / 2)
    const viewportX = screenCenterX - (nodeCenterX * zoom)
    const viewportY = screenCenterY - (nodeCenterY * zoom)

    instance.setViewport({ x: viewportX, y: viewportY, zoom }, { duration: 450 })
  }, [getViewportMetrics, getConfigPanelWidth, isViewLocked])

  const fitWorkflowToViewport = useCallback((options: { force?: boolean; rightPanelWidth?: number } = {}) => {
    if (isViewLocked && !options.force) return
    const instance = reactFlowInstanceRef.current
    if (!instance) return
    const nodes = instance.getNodes?.() ?? []
    if (nodes.length === 0) return

    const {
      headerHeight,
      leftOffset,
      availableWidth,
      availableHeight,
    } = getViewportMetrics(options.rightPanelWidth ?? 0)

    const bounds = nodes.reduce((acc, node) => {
      const width = node.width ?? 360
      const height = node.height ?? 100
      acc.minX = Math.min(acc.minX, node.position.x)
      acc.minY = Math.min(acc.minY, node.position.y)
      acc.maxX = Math.max(acc.maxX, node.position.x + width)
      acc.maxY = Math.max(acc.maxY, node.position.y + height)
      return acc
    }, {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    })

    const padding = 120
    const boundsWidth = Math.max(1, bounds.maxX - bounds.minX + (padding * 2))
    const boundsHeight = Math.max(1, bounds.maxY - bounds.minY + (padding * 2))
    const zoomX = availableWidth / boundsWidth
    const zoomY = availableHeight / boundsHeight
    const zoom = Math.max(0.3, Math.min(1, zoomX, zoomY))
    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerY = (bounds.minY + bounds.maxY) / 2
    const screenCenterX = leftOffset + (availableWidth / 2)
    const screenCenterY = headerHeight + (availableHeight / 2)
    const viewportX = screenCenterX - (centerX * zoom)
    const viewportY = screenCenterY - (centerY * zoom)

    // Guard against NaN values before setting viewport
    if (!isFinite(viewportX) || !isFinite(viewportY) || !isFinite(zoom)) {
      logger.warn('[fitWorkflowToViewport] Skipping - invalid viewport values:', { viewportX, viewportY, zoom, bounds })
      return
    }

    instance.setViewport({ x: viewportX, y: viewportY, zoom }, { duration: 500 })
  }, [getViewportMetrics, isViewLocked])

  // Provider disambiguation state
  const [awaitingProviderSelection, setAwaitingProviderSelection] = useState(false)
  const [pendingPrompt, setPendingPrompt] = useState<string>("")
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [providerCategory, setProviderCategory] = useState<any>(null)
  // Multi-provider disambiguation state (for prompts with multiple vague terms)
  const [pendingVagueTerms, setPendingVagueTerms] = useState<VagueTermDetection[]>([])
  const [providerSelections, setProviderSelections] = useState<Map<string, string>>(new Map())

  // Enhanced chat flow state
  const [pendingConnectionProvider, setPendingConnectionProvider] = useState<string | null>(null)
  const [pendingNodeConfigType, setPendingNodeConfigType] = useState<string | null>(null)
  const [collectedPreferences, setCollectedPreferences] = useState<Array<{
    id: string
    category: string
    provider: string
    providerName: string
    channel?: {
      providerId: string
      channelId: string
      channelName: string
    }
    nodeConfig?: {
      nodeType: string
      nodeDisplayName: string
      config: Record<string, any>
    }
  }>>([])

  // Build state machine (Kadabra-style animated build)
  const [buildMachine, setBuildMachine] = useState<BuildStateMachine>(getInitialState())

  // Node configuration state (for user input during build)
  const [nodeConfigs, setNodeConfigs] = useState<Record<string, Record<string, any>>>({})
  const [nodeTestCache, setNodeTestCache] = useState<Record<string, NodeTestCacheEntry>>({})
  const [activeReorderDrag, setActiveReorderDrag] = useState<{
    nodeId: string
    pointerId: number
    release?: () => void
  } | null>(null)
  const [reorderDragOffset, setReorderDragOffset] = useState(0)
  const reorderDragOffsetRef = useRef(0)
  const [reorderPreviewIndex, setReorderPreviewIndex] = useState<number | null>(null)
  const [reorderDragStartIndex, setReorderDragStartIndex] = useState<number | null>(null)
  const suppressNodeClickRef = useRef<string | null>(null)
  const suppressNodeClickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragStartRef = useRef<number | null>(null)
  const dragVisualStateRef = useRef<{ offset: number; slot: number | null }>({ offset: 0, slot: null })
  const dragRafRef = useRef<number | null>(null)

  // AI Agent Infrastructure (Spec-Compliant)
  const choreographerRef = useRef<BuildChoreographer | null>(null)
  const costTrackerRef = useRef<CostTracker | null>(null)
  const [costEstimate, setCostEstimate] = useState<number | undefined>(undefined)
  const [costActual, setCostActual] = useState<number | undefined>(undefined)

  // Chat persistence - extracted to useChatPersistence hook
  const {
    chatPersistenceEnabled,
    isChatLoading,
    chatHistoryLoaded,
    generateLocalId,
    replaceMessageByLocalId,
    enqueuePendingMessage,
    persistOrQueueStatus,
    createWorkflowSnapshot,
  } = useChatPersistence({
    flowId,
    flowState: flowState ? {
      flow: flowState.flow,
      revisionId: flowState.revisionId,
      revisionCount: flowState.revisionCount,
    } : null,
    authInitialized,
    hasUnsavedChanges: builder?.hasUnsavedChanges,
    agentMessages,
    setAgentMessages,
  })

  // Path router state
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set())
  const [pathLabels, setPathLabels] = useState<Record<string, string>>({})
  // NOTE: lastHasUnsavedChangesRef moved to useChatPersistence hook

  // Workflow draft auto-save - persists building state to localStorage
  const {
    restoredDraft,
    hasDraft,
    isDraftLoaded,
    saveDraft,
    saveImmediately,
    clearDraft,
    addPendingRequest,
    updatePendingRequest,
    completePendingRequest,
    getPendingRequests,
    hasIncompleteRequests,
  } = useWorkflowDraftAutoSave({
    flowId,
    enabled: true, // Always enabled - saves build state (provider selection, node configs) for both saved & unsaved workflows
  })

  // Track if we've restored from draft to avoid re-restoring
  const hasRestoredFromDraftRef = useRef(false)

  // Restore state from draft on load
  // For UNSAVED workflows: restore everything including chat messages
  // For SAVED workflows: restore build state (questions, progress) but NOT chat messages (they come from DB)
  useEffect(() => {
    if (
      !isDraftLoaded ||
      hasRestoredFromDraftRef.current ||
      !restoredDraft
    ) {
      return
    }

    hasRestoredFromDraftRef.current = true
    logger.debug('[DraftRestore] Restoring workflow draft state...', { chatPersistenceEnabled })

    // Restore agent messages ONLY for unsaved workflows
    // For saved workflows, messages come from the database via useChatPersistence
    if (!chatPersistenceEnabled && restoredDraft.agentMessages?.length > 0) {
      setAgentMessages(restoredDraft.agentMessages)
      logger.debug('[DraftRestore] Restored agent messages from localStorage (unsaved workflow)')
    }

    // ALWAYS restore build machine state - this tracks guided setup progress
    // Even for saved workflows, we need to resume from where the user left off
    if (restoredDraft.buildMachine) {
      logger.debug('[DraftRestore] Restoring build machine state:', {
        state: restoredDraft.buildMachine.state,
        planLength: restoredDraft.buildMachine.plan?.length,
        progress: restoredDraft.buildMachine.progress,
        editsCount: restoredDraft.buildMachine.edits?.length,
      })
      setBuildMachine(restoredDraft.buildMachine)
    } else {
      logger.debug('[DraftRestore] No buildMachine in draft to restore')
    }

    // ALWAYS restore node configs - user's configuration choices
    if (restoredDraft.nodeConfigs && Object.keys(restoredDraft.nodeConfigs).length > 0) {
      setNodeConfigs(restoredDraft.nodeConfigs)
      logger.debug('[DraftRestore] Restored node configs:', Object.keys(restoredDraft.nodeConfigs).length, 'nodes')
    }

    // ALWAYS restore collected preferences
    if (restoredDraft.collectedPreferences?.length > 0) {
      setCollectedPreferences(restoredDraft.collectedPreferences)
      logger.debug('[DraftRestore] Restored collected preferences:', restoredDraft.collectedPreferences.length)
    }

    // ALWAYS restore provider selections
    if (restoredDraft.providerSelections) {
      const selections = restoreProviderSelections(restoredDraft.providerSelections)
      setProviderSelections(selections)
      logger.debug('[DraftRestore] Restored provider selections:', Object.fromEntries(selections))
    }

    // ALWAYS restore pending prompt
    if (restoredDraft.pendingPrompt) {
      setPendingPrompt(restoredDraft.pendingPrompt)
      logger.debug('[DraftRestore] Restored pending prompt:', restoredDraft.pendingPrompt.substring(0, 50))
    }

    // ALWAYS restore selected provider
    if (restoredDraft.selectedProviderId) {
      setSelectedProviderId(restoredDraft.selectedProviderId)
    }

    // ALWAYS restore provider disambiguation state (for dropdown flow)
    if (restoredDraft.awaitingProviderSelection) {
      setAwaitingProviderSelection(restoredDraft.awaitingProviderSelection)
      logger.debug('[DraftRestore] Restored awaitingProviderSelection:', restoredDraft.awaitingProviderSelection)
    }
    if (restoredDraft.providerCategory) {
      setProviderCategory(restoredDraft.providerCategory)
      logger.debug('[DraftRestore] Restored providerCategory:', restoredDraft.providerCategory?.vagueTerm)
    }
    if (restoredDraft.pendingVagueTerms?.length > 0) {
      setPendingVagueTerms(restoredDraft.pendingVagueTerms)
      logger.debug('[DraftRestore] Restored pendingVagueTerms:', restoredDraft.pendingVagueTerms.length)
    }

    // Restore drafting context
    if (restoredDraft.draftingContext) {
      setDraftingContext(restoredDraft.draftingContext)
      logger.debug('[DraftRestore] Restored drafting context:', restoredDraft.draftingContext.phase)
    }

    // Open the agent panel if we're in the middle of provider selection
    if (restoredDraft.awaitingProviderSelection || restoredDraft.pendingPrompt) {
      setAgentOpen(true)
      logger.debug('[DraftRestore] Opened agent panel (provider selection in progress)')
    }

    logger.debug('[DraftRestore] Draft restored successfully')
    logger.debug('[DraftRestore] Draft restored successfully')
  }, [isDraftLoaded, restoredDraft, chatPersistenceEnabled])

  // Auto-save draft when relevant state changes (debounced via hook)
  // IMPORTANT: Continue saving build state even after workflow is saved to DB
  // This allows users to resume guided setup after page refresh
  useEffect(() => {
    if (!isDraftLoaded) {
      return
    }

    // Save current state as draft
    // For saved workflows (chatPersistenceEnabled=true), we still save build state
    // but can skip agentMessages since they're persisted to DB
    saveDraft(createDraftState({
      agentMessages: chatPersistenceEnabled ? [] : agentMessages, // Skip if persisted to DB
      buildMachine,
      nodeConfigs,
      collectedPreferences,
      providerSelections,
      pendingPrompt,
      selectedProviderId,
      workflowName,
      // Provider disambiguation state (for restoring dropdown flow)
      awaitingProviderSelection,
      providerCategory,
      pendingVagueTerms,
      // Drafting context (structured conversation state)
      draftingContext,
    }))
  }, [
    chatPersistenceEnabled,
    isDraftLoaded,
    agentMessages,
    buildMachine,
    nodeConfigs,
    collectedPreferences,
    providerSelections,
    pendingPrompt,
    selectedProviderId,
    workflowName,
    saveDraft,
    // Provider disambiguation state
    awaitingProviderSelection,
    providerCategory,
    pendingVagueTerms,
    // Drafting context
    draftingContext,
  ])

  // Clear draft only when guided setup is COMPLETE (all nodes configured, flow ready)
  // Don't clear just because workflow is saved - user may still be configuring
  useEffect(() => {
    // Only clear draft when build is complete (IDLE state with no pending work)
    const isSetupComplete = buildMachine.state === BuildState.IDLE &&
      buildMachine.plan.length > 0 &&
      buildMachine.progress.done === buildMachine.progress.total

    if (isSetupComplete && hasDraft) {
      logger.debug('[DraftAutoSave] Guided setup complete, clearing local draft')
      clearDraft()
    }
  }, [buildMachine.state, buildMachine.plan.length, buildMachine.progress.done, buildMachine.progress.total, hasDraft, clearDraft])

  // Recreate dropdown message when restoring from draft after page refresh
  // This is needed because dropdown messages are ephemeral (not saved to DB)
  // The draft saves awaitingProviderSelection, providerCategory, etc. but not the message itself
  const hasRecreatedDropdownRef = useRef(false)
  useEffect(() => {
    // Only run once per session
    if (hasRecreatedDropdownRef.current) return

    // Need: awaitingProviderSelection, providerCategory, integrations loaded, no existing dropdown message
    if (!awaitingProviderSelection || !providerCategory || integrations.length === 0) {
      return
    }

    // Check if there's already a dropdown message in agentMessages
    const hasDropdownMessage = agentMessages.some(
      msg => msg.role === 'assistant' && msg.meta?.providerDropdown
    )
    if (hasDropdownMessage) {
      hasRecreatedDropdownRef.current = true
      return
    }

    // Recreate the dropdown message
    logger.debug('[DropdownRecreate] Recreating dropdown message after page refresh:', {
      category: providerCategory?.vagueTerm,
      pendingPrompt: pendingPrompt?.substring(0, 50),
    })

    const providerOptions = getProviderOptions(
      providerCategory,
      integrations.map(i => ({ provider: i.provider, id: i.id, status: i.status }))
    )
    const connectedProviders = providerOptions.filter(p => p.isConnected)
    const preSelectedProvider = connectedProviders.length > 0 ? connectedProviders[0] : null

    const localId = generateLocalId()
    const createdAt = new Date().toISOString()
    const dropdownMeta = {
      providerDropdown: {
        category: providerCategory,
        providers: providerOptions,
        preSelectedProviderId: preSelectedProvider?.id,
      },
      pendingPrompt: pendingPrompt,
      remainingTerms: pendingVagueTerms,
    }
    const dropdownMessage: ChatMessage = {
      id: localId,
      flowId,
      role: 'assistant',
      text: '',
      meta: dropdownMeta,
      createdAt,
      ephemeral: true,
    }

    setAgentMessages(prev => [...prev, dropdownMessage])
    hasRecreatedDropdownRef.current = true
    logger.debug('[DropdownRecreate] Dropdown message recreated successfully')
  }, [awaitingProviderSelection, providerCategory, integrations, agentMessages, pendingPrompt, pendingVagueTerms, flowId, generateLocalId])

  // Restore provider selection state from chat history when loaded from database
  const hasRestoredFromChatHistoryRef = useRef(false)
  useEffect(() => {
    logger.debug('[ChatRestore] Effect triggered:', {
      chatPersistenceEnabled,
      hasRestoredAlready: hasRestoredFromChatHistoryRef.current,
      messagesCount: agentMessages.length,
    })

    // Only restore when chat persistence is enabled (meaning we're loading from DB)
    // and we haven't already restored
    if (!chatPersistenceEnabled || hasRestoredFromChatHistoryRef.current || agentMessages.length === 0) {
      logger.debug('[ChatRestore] Skipping restoration:', {
        reason: !chatPersistenceEnabled ? 'persistence not enabled' :
          hasRestoredFromChatHistoryRef.current ? 'already restored' : 'no messages'
      })
      return
    }

    // Find the most recent provider dropdown message that hasn't been resolved
    const dropdownMessages = agentMessages.filter(
      (msg) => msg.role === 'assistant' && msg.meta?.providerDropdown
    )

    logger.debug('[ChatRestore] Found dropdown messages:', dropdownMessages.length)
    if (dropdownMessages.length > 0) {
      const lastMeta = dropdownMessages[dropdownMessages.length - 1]?.meta
      logger.debug('[ChatRestore] Last dropdown full meta keys:', Object.keys(lastMeta || {}))
      logger.debug('[ChatRestore] Last dropdown meta.pendingPrompt:', lastMeta?.pendingPrompt)
      logger.debug('[ChatRestore] Last dropdown meta.providerDropdown keys:', Object.keys(lastMeta?.providerDropdown || {}))
    }

    if (dropdownMessages.length === 0) {
      logger.debug('[ChatRestore] No dropdown messages found, marking as restored')
      hasRestoredFromChatHistoryRef.current = true
      return
    }

    // Check if the dropdown was already resolved (there's a subsequent non-dropdown message)
    const lastDropdown = dropdownMessages[dropdownMessages.length - 1]
    const lastDropdownIndex = agentMessages.findIndex((msg) => msg.id === lastDropdown.id)
    const subsequentMessages = agentMessages.slice(lastDropdownIndex + 1)
    const hasSubsequentMessages = subsequentMessages.some(
      (msg) => msg.role !== 'status' && !(msg.role === 'assistant' && msg.meta?.providerDropdown)
    )

    logger.debug('[ChatRestore] Subsequent messages check:', {
      lastDropdownIndex,
      subsequentMessagesCount: subsequentMessages.length,
      hasSubsequentMessages,
    })

    if (hasSubsequentMessages) {
      // Dropdown was already resolved, don't restore
      logger.debug('[ChatRestore] Dropdown already resolved, skipping restoration')
      hasRestoredFromChatHistoryRef.current = true
      return
    }

    // Restore the provider selection state from the dropdown message
    const meta = lastDropdown.meta
    logger.debug('[ChatRestore] Attempting to restore from meta:', {
      hasCategory: !!meta?.providerDropdown?.category,
      hasPendingPrompt: !!meta?.pendingPrompt,
      pendingPrompt: meta?.pendingPrompt?.substring(0, 50),
    })

    if (meta?.providerDropdown?.category && meta?.pendingPrompt) {
      logger.debug('[ChatRestore] ✅ Restoring provider selection state from chat history')
      logger.debug('[ChatRestore] Setting state:', {
        pendingPrompt: meta.pendingPrompt,
        providerCategory: meta.providerDropdown.category?.vagueTerm,
        remainingTerms: meta.remainingTerms?.length || 0,
      })
      setAwaitingProviderSelection(true)
      setPendingPrompt(meta.pendingPrompt)
      setProviderCategory(meta.providerDropdown.category)
      if (meta.remainingTerms) {
        setPendingVagueTerms(meta.remainingTerms)
      }
      // Open the agent panel to show the dropdown
      setAgentOpen(true)
    } else {
      logger.debug('[ChatRestore] ❌ Missing required meta fields for restoration:', {
        hasCategory: !!meta?.providerDropdown?.category,
        hasPendingPrompt: !!meta?.pendingPrompt,
      })
    }

    hasRestoredFromChatHistoryRef.current = true
  }, [chatPersistenceEnabled, agentMessages])

  // Restore buildMachine state from chat message metadata when loaded from DB
  // This handles the case where the draft wasn't saved but the messages were persisted
  const hasRestoredBuildStateRef = useRef(false)
  useEffect(() => {
    // Only restore when chat persistence is enabled and we haven't already restored
    if (!chatPersistenceEnabled || hasRestoredBuildStateRef.current || agentMessages.length === 0) {
      return
    }

    // Only restore if current state is IDLE (meaning draft wasn't loaded)
    if (buildMachine.state !== BuildState.IDLE) {
      hasRestoredBuildStateRef.current = true
      return
    }

    // Find the last assistant message with plan metadata
    const assistantMessages = agentMessages.filter(m => m && m.role === 'assistant')
    const lastAssistantMsg = assistantMessages[assistantMessages.length - 1]
    const meta = (lastAssistantMsg as any)?.meta

    logger.debug('[BuildStateRestore] Checking for plan metadata:', {
      hasLastAssistantMsg: !!lastAssistantMsg,
      hasMeta: !!meta,
      hasPlan: !!meta?.plan,
      hasAllSelectedProviders: !!meta?.allSelectedProviders,
      allSelectedProvidersLength: meta?.allSelectedProviders?.length,
      currentState: buildMachine.state,
    })

    // If the message has plan metadata, restore to PLAN_READY state
    if (meta?.plan && (meta?.allSelectedProviders?.length > 0 || meta?.autoSelectedProvider)) {
      logger.debug('[BuildStateRestore] ✅ Restoring to PLAN_READY from chat message metadata')

      // Reconstruct the plan from the edits
      const plan: PlanNode[] = (meta.plan.edits || [])
        .filter((edit: any) => edit.op === 'addNode')
        .map((edit: any, index: number) => {
          const nodeType = edit.node?.type || 'unknown'
          const nodeComponent = ALL_NODE_COMPONENTS.find(n => n.type === nodeType)
          return {
            id: `node-${index}`,
            title: nodeComponent?.title || nodeType,
            description: nodeComponent?.description || `${nodeComponent?.title || nodeType} node`,
            nodeType,
            providerId: nodeComponent?.providerId,
            icon: nodeComponent?.icon,
            requires: { secretNames: [], params: [] },
          }
        })

      logger.debug('[BuildStateRestore] Reconstructed plan:', plan.map(p => p.title))

      setBuildMachine(prev => ({
        ...prev,
        state: BuildState.PLAN_READY,
        plan,
        edits: meta.plan.edits,
        progress: { currentIndex: -1, done: 0, total: plan.length },
      }))

      // Open the agent panel
      setAgentOpen(true)
    }

    hasRestoredBuildStateRef.current = true
  }, [chatPersistenceEnabled, agentMessages, buildMachine.state])

  // Show recovery notification for incomplete requests
  // GRACE_PERIOD_MS: Only show "interrupted" notification if request has been pending
  // for more than this duration. This prevents false positives during normal operation
  // when requests are actively being processed.
  const GRACE_PERIOD_MS = 30 * 1000 // 30 seconds
  const hasShownRecoveryRef = useRef(false)
  useEffect(() => {
    if (
      !isDraftLoaded ||
      hasShownRecoveryRef.current ||
      !hasIncompleteRequests
    ) {
      return
    }

    const pendingRequests = getPendingRequests()
    const failedRequests = pendingRequests.filter(r => r.status === 'failed')

    // Only consider requests as "interrupted" if they've been pending/processing
    // for longer than the grace period. This prevents showing the notification
    // for requests that are actively in progress.
    const now = Date.now()
    const interruptedRequests = pendingRequests.filter(r => {
      if (r.status !== 'processing' && r.status !== 'pending') return false
      const sentAt = new Date(r.sentAt).getTime()
      const elapsed = now - sentAt
      return elapsed > GRACE_PERIOD_MS
    })

    // Only show recovery notification if there's actually something to recover
    if (failedRequests.length === 0 && interruptedRequests.length === 0) {
      // No recovery needed - requests are either still in progress (within grace period)
      // or have already completed successfully
      return
    }

    hasShownRecoveryRef.current = true

    if (failedRequests.length > 0) {
      // Show toast for failed requests
      toast({
        title: "Previous request failed",
        description: `Your message "${failedRequests[0].userMessage.substring(0, 50)}..." wasn't processed. Would you like to try again?`,
        action: (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Re-submit the failed request
              setAgentInput(failedRequests[0].userMessage)
              // Clear the failed request
              completePendingRequest(failedRequests[0].id)
            }}
          >
            Retry
          </Button>
        ),
      })
    } else if (interruptedRequests.length > 0) {
      // Show toast for interrupted requests (pending for more than grace period)
      toast({
        title: "Message was interrupted",
        description: `Your message "${interruptedRequests[0].userMessage.substring(0, 50)}..." was interrupted. Would you like to resend it?`,
        action: (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Re-submit the interrupted request
              setAgentInput(interruptedRequests[0].userMessage)
              // Clear the interrupted request
              completePendingRequest(interruptedRequests[0].id)
            }}
          >
            Resend
          </Button>
        ),
      })
    }
  }, [isDraftLoaded, hasIncompleteRequests, getPendingRequests, toast, completePendingRequest])

  // NOTE: AI infrastructure init moved to consolidated mount effect (line ~414)

  // CONSOLIDATED: App ready init + workspace context sync
  // Previously these were 2 separate effects that both called fetchIntegrations,
  // causing double-fetch on initial load. Now combined into one effect.
  const hasInitializedRef = useRef(false)
  const lastWorkspaceIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!appReady) {
      return
    }

    // Track if this is the first run or a workspace change
    const isFirstRun = !hasInitializedRef.current
    const workspaceChanged = workspaceContext?.id !== lastWorkspaceIdRef.current

    if (!isFirstRun && !workspaceChanged) {
      return // Nothing to do
    }

    // Update refs
    hasInitializedRef.current = true
    lastWorkspaceIdRef.current = workspaceContext?.id ?? null

    logger.debug('[WorkflowBuilder] App context ready, initializing...', {
      isFirstRun,
      workspaceChanged,
      workspaceType: workspaceContext?.type,
      workspaceId: workspaceContext?.id,
    })

    // Set workspace context first (this clears integrations)
    if (workspaceContext) {
      setIntegrationWorkspaceContext(workspaceContext.type, workspaceContext.id)
    }

    // Single fetch with workspace context (avoids double-fetch)
    fetchIntegrations(
      false,
      workspaceContext?.type,
      workspaceContext?.id || undefined
    ).catch(error => {
      logger.error('[WorkflowBuilder] Failed to fetch integrations:', error)
    })

    // Load workflow preferences only on first run
    if (isFirstRun) {
      loadWorkflowPreferences().then(prefs => {
        if (prefs) {
          logger.debug('[WorkflowBuilder] Loaded workflow preferences:', {
            email: prefs.default_email_provider,
            calendar: prefs.default_calendar_provider,
            notification: prefs.default_notification_provider,
          })
        }
      }).catch(error => {
        logger.warn('[WorkflowBuilder] Failed to load workflow preferences:', error)
      })
    }
  }, [appReady, workspaceContext, setIntegrationWorkspaceContext, fetchIntegrations])

  // NOTE: Chat persistence useEffects moved to useChatPersistence hook

  const nodeComponentMap = useMemo(() => {
    const map = new Map<string, NodeComponent>()
    ALL_NODE_COMPONENTS.forEach((component) => {
      map.set(component.type, component)
    })
    return map
  }, [])

  const saveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const promptProcessedRef = useRef(false)
  const reactFlowInstanceRef = useRef<any>(null)

  // NOTE: Duplicate window resize useEffect removed - kept the one at line ~440

  // Sync workflow name
  useEffect(() => {
    if (!nameDirty) {
      setWorkflowName(adapter.state.flowName)
    }
  }, [adapter.state.flowName, nameDirty])

  // NOTE: localStorage restore moved to consolidated mount effect (line ~433)

  // Persist agent panel state to localStorage
  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem("reactAgentPanelOpen", String(agentOpen))
  }, [agentOpen])

  const handleRecenterView = useCallback(() => {
    fitWorkflowToViewport({ force: true })
  }, [fitWorkflowToViewport])

  const handleToggleViewLock = useCallback(() => {
    setIsViewLocked(prev => !prev)
  }, [])

  useEffect(() => {
    if (!configuringNode?.id) return
    lastConfigNodeIdRef.current = configuringNode.id
    const timer = setTimeout(() => {
      focusConfigNode(configuringNode.id)
    }, 200)
    return () => clearTimeout(timer)
  }, [configuringNode?.id, agentOpen, agentPanelWidth, focusConfigNode])

  // Debug logging for config modal open - runs once per node ID change
  useEffect(() => {
    if (!configuringNode?.id) return
    const nodeType = configuringNode?.data?.type || configuringNode?.type
    const nodeInfo = nodeType ? getNodeByType(nodeType) : null
    logger.debug('🔧 [WorkflowBuilder] Opening config for node:', {
      nodeId: configuringNode?.id,
      nodeType,
      nodeInfo: nodeInfo ? { type: nodeInfo.type, title: (nodeInfo as any).title, label: (nodeInfo as any).label } : null,
      nodeData: configuringNode?.data,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally only log when node ID changes, not on data changes
  }, [configuringNode?.id])

  useEffect(() => {
    if (configuringNode) return
    if (!lastConfigNodeIdRef.current) return
    const timer = setTimeout(() => {
      fitWorkflowToViewport({
        rightPanelWidth: isIntegrationsPanelOpen ? getIntegrationsPanelWidth() : 0
      })
      lastConfigNodeIdRef.current = null
    }, 150)
    return () => clearTimeout(timer)
  }, [configuringNode, agentOpen, agentPanelWidth, isIntegrationsPanelOpen, getIntegrationsPanelWidth, fitWorkflowToViewport])

  useEffect(() => {
    if (configuringNode || isViewLocked) return
    const timer = setTimeout(() => {
      fitWorkflowToViewport({
        rightPanelWidth: isIntegrationsPanelOpen ? getIntegrationsPanelWidth() : 0
      })
    }, 200)
    return () => clearTimeout(timer)
  }, [agentOpen, agentPanelWidth, configuringNode, isIntegrationsPanelOpen, getIntegrationsPanelWidth, isViewLocked, fitWorkflowToViewport])

  useEffect(() => {
    if (configuringNode || isViewLocked) return
    const timer = setTimeout(() => {
      fitWorkflowToViewport({
        rightPanelWidth: isIntegrationsPanelOpen ? getIntegrationsPanelWidth() : 0
      })
    }, 200)
    return () => clearTimeout(timer)
  }, [isIntegrationsPanelOpen, configuringNode, isViewLocked, getIntegrationsPanelWidth, fitWorkflowToViewport])

  useEffect(() => {
    if (isViewLocked) return
    if (!reactFlowInstanceRef.current) return
    const nodes = reactFlowInstanceRef.current.getNodes?.() ?? []
    if (nodes.length === 0) return
    if (hasInitialCenterRef.current) return
    hasInitialCenterRef.current = true
    const timer = setTimeout(() => {
      fitWorkflowToViewport({
        rightPanelWidth: isIntegrationsPanelOpen ? getIntegrationsPanelWidth() : 0
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [builder?.nodes?.length, isIntegrationsPanelOpen, getIntegrationsPanelWidth, isViewLocked, fitWorkflowToViewport])

  // Build state machine handlers (defined early for use in URL prompt handler)
  const stateEnteredAtRef = useRef<number>(performance.now())
  const transitionTo = useCallback((nextState: BuildState) => {
    setBuildMachine(prev => {
      const now = performance.now()
      const duration = Math.round(now - stateEnteredAtRef.current)
      stateEnteredAtRef.current = now

      // Agent eval: track state transition
      agentEvalTracker.trackEvent(AGENT_EVAL_EVENTS.STATE_TRANSITION, {
        from_state: prev.state,
        to_state: nextState,
        duration_in_prev_state_ms: duration,
      })

      const badge = getBadgeForState(
        nextState,
        prev.plan[prev.progress.currentIndex]?.title
      )
      return { ...prev, state: nextState, badge }
    })
  }, [])

  // Helper function for plan generation (extracted to avoid duplication)
  const continueWithPlanGeneration = useCallback(async (
    result: any,
    originalPrompt: string,
    providerMeta?: { category: any; provider: any; allProviders: any[] } | Array<{ category: any; provider: any; allProviders: any[] }>
  ) => {
    logger.debug('🎯 [continueWithPlanGeneration] CALLED with:', {
      hasResult: !!result,
      editsCount: result?.edits?.length,
      originalPrompt: originalPrompt?.substring(0, 50),
      hasProviderMeta: !!providerMeta,
      chatPersistenceEnabled,
      hasFlowState: !!flowState?.flow,
      hasUnsupportedFeatures: !!result?.unsupportedFeatures?.hasUnsupported,
    })

    // Handle unsupported features warning
    if (result?.unsupportedFeatures?.hasUnsupported) {
      logger.debug('[continueWithPlanGeneration] Detected unsupported features:', result.unsupportedFeatures.features)

      // Show warning message in chat
      const warningMessage: ChatMessage = {
        id: generateLocalId(),
        flowId,
        role: 'assistant',
        text: result.unsupportedFeatures.message,
        meta: {
          isWarning: true,
          unsupportedFeatures: result.unsupportedFeatures.features,
        },
        createdAt: new Date().toISOString(),
      }
      setAgentMessages(prev => [...prev, warningMessage])

      // Save warning message to chat history
      if (chatPersistenceEnabled && flowState?.flow) {
        void ChatService.addMessage(flowId, {
          role: 'assistant',
          text: result.unsupportedFeatures.message,
          meta: {
            isWarning: true,
            unsupportedFeatures: result.unsupportedFeatures.features,
          },
        })
      }
    }

    // Generate plan from edits
    const plan: PlanNode[] = (result.edits || [])
      .filter((edit: any) => edit.op === 'addNode')
      .map((edit: any, index: number) => {
        const nodeType = edit.node?.type || 'unknown'
        const nodeComponent = ALL_NODE_COMPONENTS.find(n => n.type === nodeType)

        // Use actual node title instead of Kadabra-style names
        const displayTitle = nodeComponent?.title || nodeType

        return {
          id: `node-${index}`,
          title: displayTitle,
          description: nodeComponent?.description || `${nodeComponent?.title || nodeType} node`,
          nodeType,
          providerId: nodeComponent?.providerId,
          icon: nodeComponent?.icon,
          requires: {
            secretNames: [],
            params: [],
          },
        }
      })

    // Generate plan summary text for chat persistence
    const planSummary = plan.map(p => p.title).join(' → ')
    let assistantText: string
    if (plan.length > 0) {
      assistantText = `Here's your workflow: ${planSummary}`
    } else if (result.clarifyingQuestions?.length > 0) {
      // Agent eval: track clarification asked
      agentEvalTracker.trackEvent(AGENT_EVAL_EVENTS.CLARIFICATION_ASKED, {
        question_count: result.clarifyingQuestions.length,
        clarification_types: ['goal'],
      })
      assistantText = `I'd love to help build that workflow! To make sure I create the right one, I have a few questions:\n\n${
        result.clarifyingQuestions.map((q: string, i: number) => `${i + 1}. ${q}`).join('\n')
      }\n\nJust answer these and I'll design the perfect workflow for you.`
    } else {
      assistantText = 'I wasn\'t able to build a workflow for that request. Could you describe what you want to automate more specifically? For example:\n\n\u2022 "When I get an email, summarize it and send to Slack"\n\u2022 "Every day, check for inactive users and send a reminder"\n\nOr tell me what apps you use and what you want to automate.'
    }

    // Add task cost info if present
    if (result.taskCost && result.taskCost.tasksUsed > 0) {
      assistantText += `\n\n_Used ${result.taskCost.tasksUsed} task${result.taskCost.tasksUsed > 1 ? 's' : ''} • ${result.taskCost.remainingBalance ?? 'N/A'} remaining_`

      // Sync the balance widget with the fresh value from the API response
      // Without this, the widget shows stale tasks_used from page load
      if (result.taskCost.remainingBalance != null) {
        const authState = useAuthStore.getState()
        if (authState.profile?.tasks_limit != null) {
          const newTasksUsed = authState.profile.tasks_limit - result.taskCost.remainingBalance
          useAuthStore.setState({
            profile: { ...authState.profile, tasks_used: newTasksUsed }
          })
        }
      }
    } else if (result.fromCache) {
      assistantText += '\n\n_Template reused - no tasks used_'
    }

    // Reorder providerMeta to match plan order (trigger first, then actions)
    // This ensures the provider dropdowns display in workflow sequence
    let orderedProviderMeta = providerMeta
    if (Array.isArray(providerMeta) && providerMeta.length > 1 && plan.length > 0) {
      // Get unique provider IDs from plan in order
      const planProviderOrder: string[] = []
      for (const planNode of plan) {
        if (planNode.providerId && !planProviderOrder.includes(planNode.providerId)) {
          planProviderOrder.push(planNode.providerId)
        }
      }

      // Sort providerMeta based on the plan order
      orderedProviderMeta = [...providerMeta].sort((a, b) => {
        const aIndex = planProviderOrder.indexOf(a.provider?.id)
        const bIndex = planProviderOrder.indexOf(b.provider?.id)
        // If provider not found in plan, keep at end
        if (aIndex === -1) return 1
        if (bIndex === -1) return -1
        return aIndex - bIndex
      })

      logger.debug('[Provider Order] Reordered providers:', {
        original: providerMeta.map(p => p.provider?.id),
        planOrder: planProviderOrder,
        reordered: orderedProviderMeta.map((p: any) => p.provider?.id)
      })
    }

    // Supplement: ensure ALL providers from plan nodes are in metadata
    // This fixes refinement flows where only the new provider is detected from the follow-up prompt
    // (e.g., "use teams instead" only detects Teams, but Gmail is still in the plan)
    if (plan.length > 0) {
      const metaArray: Array<{ category: any; provider: any; allProviders: any[] }> = Array.isArray(orderedProviderMeta)
        ? orderedProviderMeta
        : (orderedProviderMeta ? [orderedProviderMeta] : [])
      const coveredProviderIds = new Set(metaArray.map(m => m.provider?.id).filter(Boolean))
      const freshIntegrations = useIntegrationStore.getState().integrations
      const supplemented = [...metaArray]

      // Collect unique provider IDs from plan in order (for consistent badge ordering)
      const planProviderIds: string[] = []
      for (const planNode of plan) {
        if (planNode.providerId && !planProviderIds.includes(planNode.providerId)) {
          planProviderIds.push(planNode.providerId)
        }
      }

      for (const pid of planProviderIds) {
        if (coveredProviderIds.has(pid)) continue
        coveredProviderIds.add(pid)

        const category = PROVIDER_CATEGORIES.find(c => c.providers.includes(pid))
        if (!category) continue

        const providerOptions = getProviderOptions(
          category,
          freshIntegrations.map(i => ({ provider: i.provider, id: i.id, status: i.status }))
        )
        const selectedProvider = providerOptions.find(p => p.id === pid)
        if (selectedProvider) {
          supplemented.push({ category, provider: selectedProvider, allProviders: providerOptions })
        }
      }

      if (supplemented.length > metaArray.length) {
        // Re-sort supplemented list to match plan node order (trigger first, then actions)
        orderedProviderMeta = supplemented.sort((a, b) => {
          const aIdx = planProviderIds.indexOf(a.provider?.id)
          const bIdx = planProviderIds.indexOf(b.provider?.id)
          if (aIdx === -1) return 1
          if (bIdx === -1) return -1
          return aIdx - bIdx
        })
        logger.debug('[Provider Supplement] Added missing plan providers:', {
          original: metaArray.map(m => m.provider?.id),
          supplemented: (orderedProviderMeta as any[]).map(m => m.provider?.id),
        })
      }
    }

    const assistantMeta: Record<string, any> = {
      plan: { edits: result.edits, nodeCount: plan.length },
      taskCost: result.taskCost,
      workflowSnapshot: flowState?.flow ? createWorkflowSnapshot(flowState.flow) : undefined,
    }

    // Include provider metadata if selected
    // Support both single object (backward compat) and array (multi-provider)
    if (orderedProviderMeta) {
      if (Array.isArray(orderedProviderMeta)) {
        // Multiple providers selected - now in workflow order
        assistantMeta.allSelectedProviders = orderedProviderMeta
        // Keep first one as autoSelectedProvider for backward compatibility
        if (orderedProviderMeta.length > 0) {
          assistantMeta.autoSelectedProvider = orderedProviderMeta[0]
        }
      } else {
        // Single provider (backward compatibility)
        assistantMeta.autoSelectedProvider = orderedProviderMeta
      }
    }

    setBuildMachine(prev => ({
      ...prev,
      plan,
      edits: result.edits,
      stagedText: {
        purpose: result.rationale || `Create a workflow to ${originalPrompt}`,
        subtasks: plan.map(p => p.title),
        relevantNodes: plan.map(p => ({
          title: p.title,
          description: `${p.providerId || 'Generic'} node`,
          providerId: p.providerId,
        })),
      },
      progress: { currentIndex: -1, done: 0, total: plan.length },
    }))

    // Prefetch dropdown options for all nodes in the plan
    // This runs in the background so options are ready when user opens config modals
    const nodesToPrefetch = plan.map(p => ({
      nodeType: p.nodeType,
      providerId: p.providerId,
    }))

    // Check if provider is connected using the integration store
    const isProviderConnected = (providerId: string) => {
      const currentIntegrations = useIntegrationStore.getState().integrations
      return currentIntegrations.some(
        i => i.provider === providerId && i.status === 'connected'
      )
    }

    // Define loader function that uses the existing dynamic options API
    const loadOptionsFn = async (optionType: string, providerId?: string) => {
      // This would call the same API that useDynamicOptions uses
      // For now, we'll use a placeholder - the actual implementation
      // will be handled by the configuration components
      logger.debug('[Prefetch] Would prefetch:', { optionType, providerId })
      return []
    }

    // Start prefetching in background (don't await)
    optionsPrefetchService.prefetchForNodes(nodesToPrefetch, loadOptionsFn, isProviderConnected)
      .then(() => logger.debug('[Prefetch] Background prefetch complete for plan'))
      .catch(err => logger.warn('[Prefetch] Background prefetch failed:', err))

    const assistantLocalId = generateLocalId()
    const assistantCreatedAt = new Date().toISOString()
    const localAssistantMessage: ChatMessage = {
      id: assistantLocalId,
      flowId,
      role: 'assistant',
      text: assistantText,
      meta: assistantMeta,
      createdAt: assistantCreatedAt,
    }

    setAgentMessages(prev => [...prev, localAssistantMessage])

    logger.debug('[continueWithPlanGeneration] Saving assistant message:', {
      chatPersistenceEnabled,
      hasFlowState: !!flowState?.flow,
      assistantTextLength: assistantText?.length,
      assistantText: assistantText?.substring(0, 50),
    })

    if (!chatPersistenceEnabled || !flowState?.flow) {
      logger.debug('[continueWithPlanGeneration] Enqueueing message (persistence not enabled)')
      enqueuePendingMessage({
        localId: assistantLocalId,
        role: 'assistant',
        text: assistantText,
        meta: assistantMeta,
        createdAt: assistantCreatedAt,
      })
    } else {
      logger.debug('[continueWithPlanGeneration] Saving directly to database via ChatService')
      ChatService.addAssistantResponse(flowId, assistantText, assistantMeta)
        .then((saved) => {
          logger.debug('[continueWithPlanGeneration] ChatService response:', {
            saved: !!saved,
            savedId: saved?.id,
          })
          if (saved) {
            replaceMessageByLocalId(assistantLocalId, saved)
          }
        })
        .catch((error) => {
          logger.error("[continueWithPlanGeneration] Failed to save assistant response:", error)
        })
    }

    // Calculate cost estimate
    if (builder?.nodes) {
      try {
        const estimate = await estimateWorkflowCost(builder.nodes)
        setCostEstimate(estimate)
      } catch (error) {
        logger.error("Failed to estimate cost:", error)
      }
    }

    // Update workflow name if AI generated one
    logger.debug('[WorkflowBuilderV2] Checking if we should update workflow name:', {
      hasWorkflowName: !!result.workflowName,
      workflowName: result.workflowName,
      hasUpdateFunction: !!actions?.updateFlowName
    })

    if (result.workflowName && actions?.updateFlowName) {
      logger.debug('[WorkflowBuilderV2] Updating workflow name from "New Workflow" to:', result.workflowName)
      try {
        await actions.updateFlowName(result.workflowName)
        logger.debug('[WorkflowBuilderV2] ✅ updateFlowName API call succeeded')

        // Update local UI state to show the new name immediately
        setWorkflowName(result.workflowName)
        setNameDirty(false)
        logger.debug('[WorkflowBuilderV2] ✅ Local state updated - workflowName:', result.workflowName, 'nameDirty:', false)
      } catch (error) {
        logger.error('[WorkflowBuilderV2] ❌ Failed to update workflow name:', error)
        // Non-critical, continue anyway
      }
    } else {
      logger.debug('[WorkflowBuilderV2] ❌ Skipping workflow name update - missing workflowName or updateFlowName function')
    }

    await new Promise(resolve => setTimeout(resolve, 500))
    if (plan.length > 0) {
      // Update drafting context: plan was generated
      setDraftingContext(prev => updateDraftingContext(prev, {
        type: 'plan_generated',
        planNodeCount: plan.length,
      }))
      // Agent eval: track plan generation
      agentEvalTracker.trackEvent(AGENT_EVAL_EVENTS.PLAN_GENERATED, {
        node_count: plan.length,
        plan_version: 1,
      })

      // Agent eval: detect duplicate nodes in plan
      const nodeTypeCounts = new Map<string, number>()
      for (const p of plan) {
        const key = p.nodeType
        nodeTypeCounts.set(key, (nodeTypeCounts.get(key) || 0) + 1)
      }
      for (const [nodeType, count] of nodeTypeCounts) {
        if (count > 1) {
          agentEvalTracker.trackEvent(AGENT_EVAL_EVENTS.DUPLICATE_NODE, {
            node_type: nodeType,
            duplicate_count: count,
            failure_labels: ['structure_failure'],
          })
        }
      }
      transitionTo(BuildState.PLAN_READY)
    } else {
      // No plan generated - go back to IDLE so the conversational message is visible
      transitionTo(BuildState.IDLE)
      setBuildMachine(getInitialState())
    }
    setIsAgentLoading(false)
  }, [actions, builder, chatPersistenceEnabled, enqueuePendingMessage, flowId, flowState?.flow, generateLocalId, replaceMessageByLocalId, transitionTo])

  // Helper to show next provider dropdown
  const showNextProviderDropdown = useCallback((
    nextTerm: VagueTermDetection,
    prompt: string,
    remainingTerms: VagueTermDetection[]
  ) => {
    const freshIntegrations = useIntegrationStore.getState().integrations
    const providerOptions = getProviderOptions(
      nextTerm.category!,
      freshIntegrations.map(i => ({ provider: i.provider, id: i.id, status: i.status }))
    )
    const connectedProviders = providerOptions.filter(p => p.isConnected)
    const preSelectedProvider = connectedProviders.length > 0 ? connectedProviders[0] : null

    setAwaitingProviderSelection(true)
    setPendingPrompt(prompt)
    setProviderCategory(nextTerm.category)
    setPendingVagueTerms(remainingTerms)

    // Add assistant message with provider dropdown
    const localId = generateLocalId()
    const createdAt = new Date().toISOString()
    const dropdownMeta = {
      providerDropdown: {
        category: nextTerm.category,
        providers: providerOptions,
        preSelectedProviderId: preSelectedProvider?.id,
      },
      // Store remaining state for restoration on refresh
      pendingPrompt: prompt,
      remainingTerms: remainingTerms,
    }
    const dropdownMessage: ChatMessage = {
      id: localId,
      flowId,
      role: 'assistant',
      text: '',
      meta: dropdownMeta,
      createdAt,
      ephemeral: true,  // UI state only - should NOT be persisted to database
    }
    setAgentMessages(prev => [...prev, dropdownMessage])

    // Queue the ephemeral message - it will be skipped during persistence flush
    logger.debug('[showNextProviderDropdown] Adding ephemeral dropdown message (will not be persisted)')
    enqueuePendingMessage({
      localId,
      role: 'assistant',
      text: '',
      meta: dropdownMeta,
      createdAt,
      ephemeral: true,
    })
  }, [flowId, generateLocalId, enqueuePendingMessage])

  // Provider selection handlers
  const handleProviderSelect = useCallback(async (
    providerId: string,
    effectivePrompt?: string,
    effectiveCategory?: any,
    effectiveRemainingTerms?: any[]
  ) => {
    // Use effective values if passed, otherwise fall back to state
    // This fixes a race condition where state may not have been restored yet after page refresh
    const promptToUse = effectivePrompt || pendingPrompt
    const categoryToUse = effectiveCategory || providerCategory
    const remainingTermsToUse = effectiveRemainingTerms ?? pendingVagueTerms

    if (!promptToUse || !categoryToUse || !actions) {
      logger.debug('[Provider Selection] Missing required state:', {
        promptToUse: !!promptToUse,
        categoryToUse: !!categoryToUse,
        actions: !!actions
      })
      return
    }

    logger.debug('[Provider Selection] User selected provider:', providerId)
    logger.debug('[Provider Selection] Using prompt:', promptToUse?.substring(0, 50))
    logger.debug('[Provider Selection] Current vague term:', categoryToUse.vagueTerm)
    logger.debug('[Provider Selection] Remaining pending terms:', remainingTermsToUse.length)

    // Store the selection
    const newSelections = new Map(providerSelections)
    newSelections.set(categoryToUse.vagueTerm, providerId)
    setProviderSelections(newSelections)

    // Update drafting context with the provider selection
    setDraftingContext(prev => updateDraftingContext(prev, {
      type: 'provider_selected',
      key: `${categoryToUse.vagueTerm}_provider`,
      label: `${categoryToUse.vagueTerm} provider`,
      value: providerId,
    }))

    // Replace vague term with specific provider in prompt
    const modifiedPrompt = replaceVagueTermWithProvider(
      promptToUse,
      categoryToUse.vagueTerm,
      providerId
    )

    logger.debug('[Provider Selection] Modified prompt:', modifiedPrompt)

    // Check if there are more pending vague terms to resolve
    if (remainingTermsToUse.length > 0) {
      const [nextTerm, ...remainingTerms] = remainingTermsToUse
      logger.debug('[Provider Selection] More terms to resolve:', nextTerm.category?.displayName)

      // Show next provider dropdown
      setAwaitingProviderSelection(false)
      showNextProviderDropdown(nextTerm, modifiedPrompt, remainingTerms)
      return
    }

    // All vague terms resolved - proceed with workflow generation
    logger.debug('[Provider Selection] All terms resolved, proceeding with workflow generation')

    // Capture all selections before clearing state
    const allSelections = new Map(newSelections)
    allSelections.set(categoryToUse.vagueTerm, providerId)
    logger.debug('[Provider Selection] All provider selections:', Object.fromEntries(allSelections))

    // Reset selection state
    setAwaitingProviderSelection(false)
    setIsAgentLoading(true)

    // Build provider metadata for ALL selected providers
    const allProviderMetadata: Array<{ category: any; provider: any; allProviders: any[] }> = []
    const freshIntegrations = useIntegrationStore.getState().integrations

    for (const [vagueTerm, selectedProviderId] of allSelections) {
      // Find the category for this vague term
      const category = PROVIDER_CATEGORIES.find(c => c.vagueTerm === vagueTerm)
      if (category) {
        const providerOptions = getProviderOptions(
          category,
          freshIntegrations.map(i => ({ provider: i.provider, id: i.id, status: i.status }))
        )
        const selectedProvider = providerOptions.find(p => p.id === selectedProviderId)
        if (selectedProvider) {
          allProviderMetadata.push({
            category,
            provider: selectedProvider,
            allProviders: providerOptions
          })
        }
      }
    }

    // Find the email provider for template matching (templates typically need the trigger provider)
    const emailProviderId = allSelections.get('email') || providerId
    logger.debug('[Provider Selection] Email provider for template:', emailProviderId)

    // Clear pending state
    setPendingPrompt("")
    setProviderCategory(null)
    setPendingVagueTerms([])
    setProviderSelections(new Map())

    // Start planning with modified prompt
    logger.debug('[Provider Selection] Starting planning sequence...')
    transitionTo(BuildState.THINKING)

    try {
      // Pass the EMAIL provider for template matching (not notification)
      const providerConvoHistory = agentMessages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.text, timestamp: m.createdAt || '' }))

      const { result, usedTemplate, promptId } = await runPlanningStages(
        transitionTo,
        () => planWorkflowWithTemplates(
          actions, modifiedPrompt, emailProviderId, user?.id, flowId,
          { draftingContext, conversationHistory: providerConvoHistory }
        )
      )
      logger.debug('[Provider Selection] ✅ Received result from askAgent:', {
        workflowName: result.workflowName,
        editsCount: result.edits?.length,
        usedTemplate,
        cost: usedTemplate ? '$0.00 (template)' : '~$0.03 (LLM)',
        promptId
      })

      // Pass ALL provider metadata to include in plan message
      logger.debug('[Provider Selection] Calling continueWithPlanGeneration with all providers:', allProviderMetadata.length)
      await continueWithPlanGeneration(result, modifiedPrompt, allProviderMetadata.length > 0 ? allProviderMetadata : undefined)
      logger.debug('[Provider Selection] ✅ Plan generation complete')
    } catch (error: any) {
      logger.error('[Provider Selection] ❌ Error:', error)
      toast({
        title: "Failed to create plan",
        description: error?.message || "Unable to generate workflow plan",
        variant: "destructive",
      })
      transitionTo(BuildState.IDLE)
      setIsAgentLoading(false)
    }
  }, [actions, continueWithPlanGeneration, flowId, generateLocalId, integrations, pendingPrompt, pendingVagueTerms, providerCategory, providerSelections, showNextProviderDropdown, toast, transitionTo])

  const handleProviderConnect = useCallback(async (providerId: string) => {
    logger.debug('[Provider Connect] User clicked connect for:', providerId)

    // Track CTA click
    agentEvalTracker.trackEvent(AGENT_EVAL_EVENTS.PROVIDER_CONNECT_CTA_CLICKED, {
      provider_id: providerId,
      build_state: buildMachine.state,
    })

    try {
      // Use integration store's connect function which opens OAuth popup
      await useIntegrationStore.getState().connectIntegration(providerId)

      // Integration store will refresh integrations automatically on success
      logger.debug('[Provider Connect] Connection successful')

      // Only call handleProviderSelect during the initial disambiguation flow
      // (when user is picking providers before a plan exists).
      // In PLAN_READY state, the ProviderBadge auto-updates via
      // 'integration-connected' events and the build button re-evaluates
      // from the integration store - no need to re-run provider selection.
      if (buildMachine.state !== BuildState.PLAN_READY) {
        setTimeout(() => {
          handleProviderSelect(providerId)
        }, 500)
      }

    } catch (error: any) {
      logger.error('[Provider Connect] Connection failed:', error)
      // Agent eval: track provider connection blocker
      agentEvalTracker.trackEvent(AGENT_EVAL_EVENTS.PROVIDER_CONNECT_BLOCKER, {
        provider_id: providerId,
        was_connected: false,
      })
      toast({
        title: "Connection Failed",
        description: error?.message || `Failed to connect ${providerId}`,
        variant: "destructive",
      })
    }
  }, [toast, handleProviderSelect, buildMachine.state])

  const handleProviderChange = useCallback(async (newProviderId: string) => {
    logger.debug('[Provider Change] User changed provider to:', newProviderId)

    // Find current provider from chat messages
    const assistantMessages = agentMessages.filter(m => m && m.role === 'assistant')
    const lastMessage = assistantMessages[assistantMessages.length - 1]
    const meta = (lastMessage as any)?.meta ?? {}

    // Support both single provider (autoSelectedProvider) and multiple providers (allSelectedProviders)
    const allSelectedProviders = meta.allSelectedProviders || []
    const singleProvider = meta.autoSelectedProvider?.provider

    // Find which provider is being changed by matching the new provider's category
    const newProviderCategory = getProviderCategory(newProviderId)

    let oldProviderId: string | null = null
    let providerIndex = -1

    // First try allSelectedProviders array
    if (allSelectedProviders.length > 0) {
      providerIndex = allSelectedProviders.findIndex((p: any) => {
        const currentCategory = getProviderCategory(p.provider.id)
        return currentCategory === newProviderCategory
      })

      if (providerIndex >= 0) {
        oldProviderId = allSelectedProviders[providerIndex].provider.id
      }
    }

    // Fallback to single provider
    if (!oldProviderId && singleProvider) {
      const singleCategory = getProviderCategory(singleProvider.id)
      if (singleCategory === newProviderCategory) {
        oldProviderId = singleProvider.id
      }
    }

    if (!oldProviderId) {
      logger.warn('[Provider Change] No matching provider found for category:', newProviderCategory)
      toast({
        title: "Cannot Change Provider",
        description: "No matching provider found",
        variant: "destructive",
      })
      return
    }

    // Validate swap (same category check)
    if (!canSwapProviders(oldProviderId, newProviderId)) {
      toast({
        title: "Cannot Change Provider",
        description: "These providers are not compatible",
        variant: "destructive",
      })
      return
    }

    // Show updating toast (instant feedback)
    toast({
      title: "Provider Updated",
      description: `Switched to ${getProviderDisplayName(newProviderId)}`,
    })

    // Swap providers in plan (instant, no API call)
    const updatedPlan = swapProviderInPlan(buildMachine.plan, oldProviderId, newProviderId)

    // Update build machine with new plan
    setBuildMachine(prev => ({
      ...prev,
      plan: updatedPlan,
    }))

    // Update provider metadata in chat message
    const updatedMessages = agentMessages.map((msg, idx) => {
      if (msg.role !== 'assistant') return msg

      const msgMeta = (msg as any)?.meta ?? {}

      // Check if this message has allSelectedProviders
      if (msgMeta.allSelectedProviders && msgMeta.allSelectedProviders.length > 0) {
        const updatedAllProviders = [...msgMeta.allSelectedProviders]

        // Find and update the provider that matches the category
        const matchIdx = updatedAllProviders.findIndex((p: any) => {
          const cat = getProviderCategory(p.provider.id)
          return cat === newProviderCategory
        })

        if (matchIdx >= 0) {
          const providerOptions = updatedAllProviders[matchIdx].allProviders || []
          const newProvider = providerOptions.find((p: any) => p.id === newProviderId)

          updatedAllProviders[matchIdx] = {
            ...updatedAllProviders[matchIdx],
            provider: newProvider || { id: newProviderId, displayName: getProviderDisplayName(newProviderId), isConnected: false },
          }

          return {
            ...msg,
            meta: {
              ...msgMeta,
              allSelectedProviders: updatedAllProviders,
            },
          }
        }
      }

      // Fallback: Update single autoSelectedProvider
      if (msgMeta.autoSelectedProvider) {
        const providerOptions = msgMeta.autoSelectedProvider?.allProviders || []
        const newProvider = providerOptions.find((p: any) => p.id === newProviderId)

        return {
          ...msg,
          meta: {
            ...msgMeta,
            autoSelectedProvider: {
              ...msgMeta.autoSelectedProvider,
              provider: newProvider || { id: newProviderId, displayName: getProviderDisplayName(newProviderId), isConnected: false },
            },
          },
        }
      }

      return msg
    })

    setAgentMessages(updatedMessages)

    logger.debug('[Provider Change] ✅ Provider swapped instantly (no LLM call, cost: $0.00)')
  }, [agentMessages, buildMachine.plan, toast])

  // Enhanced chat flow handlers
  const handleProviderDropdownSelect = useCallback(async (
    providerId: string,
    isConnected: boolean,
    metaContext?: {
      pendingPrompt?: string
      category?: any
      remainingTerms?: any[]
    }
  ) => {
    // Use metaContext values if available (passed from message meta), fallback to state
    // This fixes a race condition where state may not have been restored yet after page refresh
    const effectivePendingPrompt = metaContext?.pendingPrompt || pendingPrompt
    const effectiveCategory = metaContext?.category || providerCategory
    const effectiveRemainingTerms = metaContext?.remainingTerms || pendingVagueTerms

    logger.debug('[Provider Dropdown] User selected:', providerId, 'isConnected:', isConnected)
    logger.debug('[Provider Dropdown] Current state:', {
      promptFromMeta: metaContext?.pendingPrompt ? metaContext.pendingPrompt.substring(0, 50) : null,
      promptFromState: pendingPrompt ? pendingPrompt.substring(0, 50) : null,
      effectivePrompt: effectivePendingPrompt ? effectivePendingPrompt.substring(0, 50) : null,
      categoryFromMeta: metaContext?.category?.vagueTerm,
      categoryFromState: providerCategory?.vagueTerm,
      effectiveCategory: effectiveCategory?.vagueTerm,
      remainingTermsFromMeta: metaContext?.remainingTerms?.length,
      remainingTermsFromState: pendingVagueTerms.length,
      awaitingProviderSelection,
    })

    // Track selected provider
    setSelectedProviderId(providerId)

    // Add preference to collection (will be offered to save at end)
    const categoryName = effectiveCategory?.vagueTerm || 'unknown'
    const newPreference = {
      id: `provider-${providerId}`,
      category: categoryName,
      provider: providerId,
      providerName: getProviderDisplayName(providerId),
    }
    setCollectedPreferences(prev => [...prev, newPreference])

    // Update provider selections Map
    const newSelections = new Map(providerSelections)
    newSelections.set(categoryName, providerId)
    setProviderSelections(newSelections)

    // CRITICAL: Save immediately to localStorage (bypasses debounce)
    // This ensures selections survive page refresh even if build gets stuck
    saveImmediately({
      providerSelections: Object.fromEntries(newSelections),
      collectedPreferences: [...collectedPreferences, newPreference],
      pendingPrompt: effectivePendingPrompt || '',
      selectedProviderId: providerId,
    })
    logger.debug('[Provider Dropdown] ✅ Saved provider selection immediately:', categoryName, '->', providerId)

    // Always proceed with workflow building
    // Connection check happens later during WAITING_USER (node configuration)
    // This lets users see the full workflow plan before connecting accounts
    if (effectivePendingPrompt && effectiveCategory) {
      logger.debug('[Provider Dropdown] ✅ Calling handleProviderSelect with context')
      // Update state with values from meta if not already set (ensures subsequent calls have them)
      if (metaContext?.pendingPrompt && !pendingPrompt) {
        setPendingPrompt(metaContext.pendingPrompt)
      }
      if (metaContext?.category && !providerCategory) {
        setProviderCategory(metaContext.category)
      }
      if (metaContext?.remainingTerms && pendingVagueTerms.length === 0) {
        setPendingVagueTerms(metaContext.remainingTerms)
      }
      handleProviderSelect(providerId, effectivePendingPrompt, effectiveCategory, effectiveRemainingTerms)
    } else {
      logger.debug('[Provider Dropdown] ⚠️ Missing required context:', {
        hasPendingPrompt: !!effectivePendingPrompt,
        hasCategory: !!effectiveCategory
      })
      logger.debug('[Provider Dropdown] This may happen if state was not properly restored after page refresh')
    }
  }, [pendingPrompt, providerCategory, pendingVagueTerms, awaitingProviderSelection, handleProviderSelect, providerSelections, collectedPreferences, saveImmediately])

  const handleConnectionComplete = useCallback(async (providerId: string, email?: string) => {
    logger.debug('[Connection Complete]', providerId, 'email:', email)

    // Clear pending connection
    setPendingConnectionProvider(null)

    // Add to collected preferences
    const category = providerCategory?.vagueTerm || 'unknown'
    setCollectedPreferences(prev => [...prev, {
      id: `provider-${providerId}`,
      category,
      provider: providerId,
      providerName: getProviderDisplayName(providerId),
    }])

    // Update the last message to show connected status
    setAgentMessages(prev => {
      const updated = [...prev]
      const lastIndex = updated.findIndex(m =>
        m.meta?.connectionStatus?.providerId === providerId
      )
      if (lastIndex !== -1) {
        updated[lastIndex] = {
          ...updated[lastIndex],
          text: `Connected to ${getProviderDisplayName(providerId)}${email ? ` (${email})` : ''}!`,
          meta: {
            ...updated[lastIndex].meta,
            connectionStatus: {
              providerId,
              isConnected: true,
              email,
            }
          }
        }
      }
      return updated
    })

    // Continue with the flow
    if (pendingPrompt) {
      setTimeout(() => {
        handleProviderSelect(providerId)
      }, 500)
    }
  }, [providerCategory, pendingPrompt, handleProviderSelect])

  const handleConnectionSkip = useCallback((providerId: string) => {
    logger.debug('[Connection Skip]', providerId)

    // Clear pending connection
    setPendingConnectionProvider(null)

    // Remove the connection card message and add skip note
    setAgentMessages(prev => {
      const filtered = prev.filter(m =>
        !m.meta?.connectionStatus || m.meta?.connectionStatus?.providerId !== providerId
      )
      return [...filtered, {
        id: generateLocalId(),
        role: 'assistant',
        text: `Skipped connecting ${getProviderDisplayName(providerId)}. You'll need to connect it later to use this workflow.`,
      }]
    })

    // Still proceed with the flow, but the workflow won't work until connected
    if (pendingPrompt) {
      handleProviderSelect(providerId)
    }
  }, [generateLocalId, pendingPrompt, handleProviderSelect])

  const handleNodeConfigComplete = useCallback((nodeType: string, config: Record<string, any>) => {
    logger.debug('[Node Config Complete]', nodeType, config)

    // Clear pending config
    setPendingNodeConfigType(null)

    // Store the config
    setNodeConfigs(prev => ({
      ...prev,
      [nodeType]: { ...prev[nodeType], ...config }
    }))

    // Add to preferences if there's a channel or significant config
    if (config.channel || config.channelId) {
      const displayName = NODE_DISPLAY_NAME_MAP[nodeType] || nodeType
      setCollectedPreferences(prev => [...prev, {
        id: `config-${nodeType}`,
        category: 'configuration',
        provider: nodeType.split('_')[0],
        providerName: displayName,
        nodeConfig: {
          nodeType,
          nodeDisplayName: displayName,
          config,
        }
      }])
    }

    // Update the chat to show config was applied
    setAgentMessages(prev => {
      const updated = [...prev]
      const lastIndex = updated.findIndex(m =>
        m.meta?.nodeConfig?.nodeType === nodeType
      )
      if (lastIndex !== -1) {
        updated[lastIndex] = {
          ...updated[lastIndex],
          text: `Configuration applied for ${NODE_DISPLAY_NAME_MAP[nodeType] || nodeType}.`,
          meta: {
            ...updated[lastIndex].meta,
            nodeConfig: {
              ...updated[lastIndex].meta?.nodeConfig,
              completed: true,
            }
          }
        }
      }
      return updated
    })
  }, [])

  const handleNodeConfigSkip = useCallback((nodeType: string) => {
    logger.debug('[Node Config Skip]', nodeType)

    // Clear pending config
    setPendingNodeConfigType(null)

    // Update the chat to show config was skipped
    setAgentMessages(prev => {
      const updated = [...prev]
      const lastIndex = updated.findIndex(m =>
        m.meta?.nodeConfig?.nodeType === nodeType
      )
      if (lastIndex !== -1) {
        updated[lastIndex] = {
          ...updated[lastIndex],
          text: `Using default configuration for ${NODE_DISPLAY_NAME_MAP[nodeType] || nodeType}.`,
          meta: {
            ...updated[lastIndex].meta,
            nodeConfig: {
              ...updated[lastIndex].meta?.nodeConfig,
              skipped: true,
            }
          }
        }
      }
      return updated
    })
  }, [])

  const handlePreferencesSave = useCallback(async (selectedIds: string[]) => {
    logger.debug('[Preferences Save]', selectedIds)

    // This is handled by the PreferencesSaveCard component internally
    // using saveSelectedPreferences from the store

    // Clear collected preferences
    setCollectedPreferences([])

    toast({
      title: "Preferences Saved",
      description: `${selectedIds.length} preference${selectedIds.length !== 1 ? 's' : ''} saved as defaults.`,
    })
  }, [toast])

  const handlePreferencesSkip = useCallback(() => {
    // Clear collected preferences without saving
    setCollectedPreferences([])

    // Remove the preferences save card from agent messages by clearing meta.preferencesSave
    setAgentMessages(prev => prev.map(msg => {
      if ((msg as any).meta?.preferencesSave) {
        const { preferencesSave, ...restMeta } = (msg as any).meta
        return {
          ...msg,
          meta: restMeta
        }
      }
      return msg
    }))
  }, [])

  const handlePreferencesComplete = useCallback(() => {
    // Clear collected preferences after confirmed save
    setCollectedPreferences([])

    // Remove the preferences save card from agent messages
    setAgentMessages(prev => prev.map(msg => {
      if ((msg as any).meta?.preferencesSave) {
        const { preferencesSave, ...restMeta } = (msg as any).meta
        return {
          ...msg,
          meta: restMeta
        }
      }
      return msg
    }))

    toast({
      title: "Preferences Saved",
      description: "Your choices have been saved as defaults for future workflows.",
    })
  }, [toast])

  // Handle prompt parameter from URL (e.g., from AI agent page)
  useEffect(() => {
    if (!actions) {
      return
    }
    if (promptProcessedRef.current) {
      return
    }

    // Wait for chat history to be fully loaded before processing URL prompts
    // This prevents duplicate messages when refreshing a page with existing chat history
    // chatHistoryLoaded is set AFTER setAgentMessages completes, avoiding the race condition
    // where isChatLoading is false but agentMessages hasn't been updated yet
    if (isChatLoading || !chatHistoryLoaded) {
      return
    }

    // Skip if there's already chat history (workflow was previously used)
    if (agentMessages.length > 0) {
      promptProcessedRef.current = true

      // Clear the URL prompt parameter to prevent any future reprocessing
      // This is critical for page refreshes - without this, the URL still has ?prompt=...
      // and could cause issues on subsequent re-renders or navigation
      if ((promptParam || searchParamsRef.current?.get('initialPrompt')) && pathname) {
        const newParams = new URLSearchParams(searchParamsRef.current?.toString() || '')
        newParams.delete('prompt')
        newParams.delete('initialPrompt')
        const newUrl = newParams.toString() ? `${pathname}?${newParams.toString()}` : pathname
        routerRef.current.replace(newUrl, { scroll: false })
      }
      return
    }

    let prompt: string | null = null

    if (typeof window !== "undefined") {
      prompt = window.sessionStorage.getItem("flowv2:pendingPrompt")
      if (prompt) {
        window.sessionStorage.removeItem("flowv2:pendingPrompt")
      }
    }

    if (!prompt && promptParam) {
      prompt = decodeURIComponent(promptParam)
    }

    if (!prompt || prompt.trim().length === 0) {
      // No prompt to process - mark as processed to prevent infinite re-runs
      // This is safe because:
      // 1. sessionStorage prompt is consumed/removed when read
      // 2. URL prompt param won't appear after initial mount without navigation
      // 3. If user navigates here again with a prompt, component remounts fresh
      promptProcessedRef.current = true
      return
    }

    promptProcessedRef.current = true
    setAgentInput(prompt)
    setAgentOpen(true)

    // Clear the prompt and openPanel params from URL to prevent duplicate processing on refresh
    // This ensures the prompt is only processed once, and subsequent refreshes
    // will load chat history from the database instead of re-creating messages
    if ((promptParam || openPanelParam) && pathname) {
      const newParams = new URLSearchParams(searchParamsRef.current?.toString() || '')
      newParams.delete('prompt')
      newParams.delete('initialPrompt')
      newParams.delete('openPanel')
      const newUrl = newParams.toString() ? `${pathname}?${newParams.toString()}` : pathname
      routerRef.current.replace(newUrl, { scroll: false })
    }

    // Auto-submit the prompt after a short delay to ensure UI is ready
    setTimeout(() => {
      if (prompt) {
        const initialLocalId = generateLocalId()
        const createdAtIso = new Date().toISOString()
        const initialMessage: ChatMessage = {
          id: initialLocalId,
          flowId,
          role: 'user',
          text: prompt,
          createdAt: createdAtIso,
        }

        setAgentMessages(prev => [...prev, initialMessage])

        if (!chatPersistenceEnabled || !flowState?.flow) {
          enqueuePendingMessage({
            localId: initialLocalId,
            role: 'user',
            text: prompt,
            createdAt: createdAtIso,
          })
        } else {
          ChatService.addUserPrompt(flowId, prompt)
            .then((saved) => {
              if (saved) {
                replaceMessageByLocalId(initialLocalId, saved)
              }
            })
            .catch((error) => {
              logger.error("Failed to save user prompt:", error)
            })
        }

        setAgentInput("")
        setIsAgentLoading(true)

        // Run the agent query
        ;(async () => {
          try {
            // STEP 0: Check if user mentioned specific apps (e.g., "Gmail", "Outlook", "Slack")
            const specificApps = detectSpecificApps(prompt)

            // Check for ALL vague provider terms (not just the first one)
            const allVagueTerms = detectAllVagueTerms(prompt)

            let finalPrompt = prompt
            // Collect ALL explicitly mentioned providers (not just the first one)
            const allProviderMetadata: Array<{ category: any; provider: any; allProviders: any[] }> = []

            // Filter out vague terms where user already specified a specific app
            const vagueTermsNeedingSelection: VagueTermDetection[] = []
            for (const vagueTermResult of allVagueTerms) {
              if (!vagueTermResult.category) continue

              // Check if user already specified an app for this category
              const matchingSpecificApp = specificApps.find(app => {
                // Match by category or by checking if providers overlap
                const categoryMatch = app.category === vagueTermResult.category!.vagueTerm
                // Also check notification/chat categories which share providers
                const notificationCategories = ['notification', 'message', 'alert', 'chat']
                const isNotificationCategory = notificationCategories.includes(vagueTermResult.category!.vagueTerm)
                const appIsNotification = notificationCategories.includes(app.category)
                return categoryMatch || (isNotificationCategory && appIsNotification)
              })

              if (matchingSpecificApp) {
                // User mentioned a specific app - DON'T replace the vague term
                // The prompt is already correct (e.g., "send a message to Discord" should stay as-is)
                // Store metadata for ALL explicitly mentioned providers
                const freshIntegrations = useIntegrationStore.getState().integrations
                const providerOptions = getProviderOptions(
                  vagueTermResult.category,
                  freshIntegrations.map(i => ({ provider: i.provider, id: i.id, status: i.status }))
                )
                const selectedProvider = providerOptions.find(p => p.id === matchingSpecificApp.provider)

                if (selectedProvider) {
                  allProviderMetadata.push({
                    category: vagueTermResult.category,
                    provider: selectedProvider,
                    allProviders: providerOptions
                  })
                }
              } else {
                // This term needs user selection
                vagueTermsNeedingSelection.push(vagueTermResult)
              }
            }

            // Also collect metadata for specific apps that were mentioned but didn't match any vague term
            // (e.g., "post to Slack" has no vague term like "notification" but Slack should still show with CHANGE option)
            const freshIntegrations = useIntegrationStore.getState().integrations
            for (const app of specificApps) {
              // Check if we already have metadata for this provider
              const alreadyHasMetadata = allProviderMetadata.some(m => m.provider?.id === app.provider)
              if (!alreadyHasMetadata) {
                // Find the category for this provider
                const category = PROVIDER_CATEGORIES.find(c => c.providers.includes(app.provider))
                if (category) {
                  const providerOptions = getProviderOptions(
                    category,
                    freshIntegrations.map(i => ({ provider: i.provider, id: i.id, status: i.status }))
                  )
                  const selectedProvider = providerOptions.find(p => p.id === app.provider)
                  if (selectedProvider) {
                    allProviderMetadata.push({
                      category,
                      provider: selectedProvider,
                      allProviders: providerOptions
                    })
                  }
                }
              }
            }

            // If there are vague terms that need selection, show provider dropdown
            if (vagueTermsNeedingSelection.length > 0) {
              const [firstTerm, ...remainingTerms] = vagueTermsNeedingSelection

              const freshIntegrations = useIntegrationStore.getState().integrations
              const providerOptions = getProviderOptions(
                firstTerm.category!,
                freshIntegrations.map(i => ({ provider: i.provider, id: i.id, status: i.status }))
              )
              const connectedProviders = providerOptions.filter(p => p.isConnected)

              // Set up multi-term disambiguation state
              setAwaitingProviderSelection(true)
              setPendingPrompt(finalPrompt) // Use modified prompt with any auto-resolved terms
              setProviderCategory(firstTerm.category)
              setPendingVagueTerms(remainingTerms) // Store remaining terms for later
              setProviderSelections(new Map()) // Reset selections
              setIsAgentLoading(false)

              // Add assistant message with provider dropdown
              const preSelectedProvider = connectedProviders.length > 0 ? connectedProviders[0] : null
              const localId = generateLocalId()
              const createdAt = new Date().toISOString()
              const dropdownMeta = {
                providerDropdown: {
                  category: firstTerm.category,
                  providers: providerOptions,
                  preSelectedProviderId: preSelectedProvider?.id,
                },
                // Store state for restoration on refresh
                pendingPrompt: finalPrompt,
                remainingTerms: remainingTerms,
              }
              const dropdownMessage: ChatMessage = {
                id: localId,
                flowId,
                role: 'assistant',
                text: '',
                meta: dropdownMeta,
                createdAt,
                ephemeral: true,  // UI state only - should NOT be persisted to database
              }
              setAgentMessages(prev => [...prev, dropdownMessage])

              // Queue the ephemeral message - it will be skipped during persistence flush
              enqueuePendingMessage({
                localId,
                role: 'assistant',
                text: '',
                meta: dropdownMeta,
                createdAt,
                ephemeral: true,
              })
              return
            }

            // Start the animated build process
            transitionTo(BuildState.THINKING)

            // For template matching, we need the EMAIL provider specifically (templates like email-to-slack require it)
            // Extract email provider from specificApps (not allProviderMetadata which might be notification/slack)
            const emailApp = specificApps.find(app => app.category === 'email')
            const emailProviderMeta = allProviderMetadata.find(m => m.category?.vagueTerm === 'email')
            const emailProviderId = emailApp?.provider || emailProviderMeta?.provider?.id

            const urlConvoHistory = agentMessages
              .filter(m => m.role === 'user' || m.role === 'assistant')
              .map(m => ({ role: m.role as 'user' | 'assistant', content: m.text, timestamp: m.createdAt || '' }))

            const { result, usedTemplate, promptId } = await runPlanningStages(
              transitionTo,
              () => planWorkflowWithTemplates(
                actions, finalPrompt, emailProviderId, user?.id, flowId,
                { draftingContext, conversationHistory: urlConvoHistory }
              )
            )

            // Use helper function to generate plan and update UI (with ALL provider metadata if auto-selected)
            await continueWithPlanGeneration(result, finalPrompt, allProviderMetadata.length > 0 ? allProviderMetadata : undefined)
          } catch (error: any) {
            logger.error('[URL Prompt Handler] Error:', error)
            toast({
              title: "Failed to create plan",
              description: error?.message || "Unable to generate workflow plan",
              variant: "destructive",
            })
            transitionTo(BuildState.IDLE)
            setIsAgentLoading(false)
          }
        })()
      }
    }, 300)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    actions,
    agentMessages.length, // Check if messages exist (from DB or local)
    chatHistoryLoaded, // Wait for chat history state to be populated
    chatPersistenceEnabled,
    continueWithPlanGeneration,
    enqueuePendingMessage,
    flowId,
    flowState?.flow,
    generateLocalId,
    // NOTE: integrations removed from deps - it changes on every fetch/refresh causing
    // excessive re-runs. The effect uses useIntegrationStore.getState() internally instead.
    isChatLoading, // Wait for chat loading to complete
    pathname,
    promptParam,
    replaceMessageByLocalId,
    // NOTE: router and searchParams removed from deps - they create new instances
    // on every render causing infinite loops. Using refs (routerRef, searchParamsRef) instead.
    toast,
    transitionTo,
  ])

  // Handler for adding a node after a specific node (Zapier-style)
  const handleAddNodeAfter = useCallback(async (afterNodeId: string, nodeType: string, component: NodeComponent, sourceHandle?: string) => {
    if (!actions || !builder) return

    const afterNode = builder.nodes.find((n: any) => n.id === afterNodeId)
    if (!afterNode) return

    // Use same X position as the node we're adding after to maintain alignment
    const position = {
      x: afterNode.position.x,
      y: afterNode.position.y + LINEAR_NODE_VERTICAL_GAP
    }

    try {
      // Use atomic batch: addNode + disconnect old edge (if inserting) + connect new edges
      const nodeId = generateId()
      const addEdit = addNodeEdit(nodeType, position, nodeId)
      const edits: any[] = [addEdit]

      // Check if inserting between two nodes (afterNode has an outgoing edge)
      const existingEdge = builder.edges.find((e: any) => e.source === afterNodeId)
      if (existingEdge) {
        // Remove old edge, create two new ones
        const nextNodeId = existingEdge.target
        edits.push({ op: "disconnectEdge", sourceId: afterNodeId, targetId: nextNodeId })
        edits.push(oldConnectToEdge(afterNodeId, nodeId, sourceHandle || 'source'))
        edits.push(oldConnectToEdge(nodeId, nextNodeId, 'source', existingEdge.targetHandle || undefined))
      } else {
        // Adding at end - just connect
        edits.push(oldConnectToEdge(afterNodeId, nodeId, sourceHandle || 'source'))
      }

      await actions.applyEdits(edits)

      toast({
        title: "Node added",
        description: `${component.title} has been added to your workflow.`,
      })
    } catch (error: any) {
      toast({
        title: "Failed to add node",
        description: error?.message ?? "Unable to add node",
        variant: "destructive",
      })
    }
  }, [actions, builder, toast])

  // React Flow props with last-node detection
  // Handle test node from context menu
  const getReorderableData = useCallback(() => {
    if (!builder?.nodes) {
      return null
    }
    const reorderableNodes = builder.nodes
      .filter(isReorderableNode)
      .sort((a: any, b: any) => (a.position?.y ?? 0) - (b.position?.y ?? 0))
    if (reorderableNodes.length === 0) {
      return null
    }
    const ids = reorderableNodes.map((node: any) => node.id)
    const positions = reorderableNodes.map((node: any) => node.position?.y ?? 0)
    const spacing =
      positions.length > 1
        ? (positions[positions.length - 1] - positions[0]) / (positions.length - 1 || 1)
        : 160
    const boundaries = new Array(ids.length + 1)
    boundaries[0] = positions[0] - spacing / 2
    for (let i = 1; i < ids.length; i++) {
      boundaries[i] = (positions[i - 1] + positions[i]) / 2
    }
    boundaries[ids.length] = positions[positions.length - 1] + spacing / 2
    return { reorderableNodes, ids, positions, spacing, boundaries }
  }, [builder?.nodes])

  const syncReorderEdges = useCallback((orderedNodeIds: string[]) => {
    if (!builder?.setEdges || !Array.isArray(orderedNodeIds) || orderedNodeIds.length === 0) {
      return
    }

    const triggerNodeId = builder.nodes?.find((node: any) => node.data?.isTrigger)?.id ?? null

    builder.setEdges((currentEdges: any[]) => {
      if (!Array.isArray(currentEdges) || currentEdges.length === 0) {
        return currentEdges
      }

      const reorderSet = new Set(orderedNodeIds)
      if (reorderSet.size < 2) {
        return currentEdges
      }

      const preservedEdges: any[] = []
      // Map internal edges by source→target for metadata-safe lookup
      // (at most one logical edge per node pair in V2 linear model)
      const internalEdgeMap = new Map<string, any>()
      const incomingEdgeMap = new Map<string, any>()
      const outgoingEdgeMap = new Map<string, any>()

      for (const edge of currentEdges) {
        const fromInSet = reorderSet.has(edge.source)
        const toInSet = reorderSet.has(edge.target)

        if (fromInSet && toInSet) {
          internalEdgeMap.set(`${edge.source}->${edge.target}`, edge)
          continue
        }

        if (!fromInSet && toInSet) {
          incomingEdgeMap.set(`${edge.source}->${edge.target}`, edge)
          continue
        }

        if (fromInSet && !toInSet) {
          outgoingEdgeMap.set(`${edge.source}->${edge.target}`, edge)
          continue
        }

        preservedEdges.push(edge)
      }

      const internalEdges = Array.from(internalEdgeMap.values())
      const incomingEdges = Array.from(incomingEdgeMap.values())
      const outgoingEdges = Array.from(outgoingEdgeMap.values())

      if (
        internalEdges.length === 0 &&
        incomingEdges.length === 0 &&
        outgoingEdges.length === 0
      ) {
        return currentEdges
      }

      const baseEdgeTemplate =
        internalEdges[0] ??
        incomingEdges[0] ??
        outgoingEdges[0] ??
        currentEdges.find((edge) => edge?.type === 'custom') ??
        null

      const defaultTemplate = {
        id: 'synthetic-linear-edge',
        type: 'custom',
        sourceHandle: 'source',
        targetHandle: 'target',
        style: { stroke: '#d0d6e0' },
        data: {},
      }

      const makeLinearEdge = (sourceId: string, targetId: string, template?: any) => {
        const base = template ?? baseEdgeTemplate ?? defaultTemplate
        return {
          ...defaultTemplate,
          ...base,
          id: `${sourceId}-${targetId}`,
          source: sourceId,
          target: targetId,
          sourceHandle: base?.sourceHandle ?? defaultTemplate.sourceHandle,
          targetHandle: base?.targetHandle ?? defaultTemplate.targetHandle,
          data: {
            ...(base?.data ?? {}),
          },
          style: {
            ...(base?.style ?? defaultTemplate.style),
          },
        }
      }

      const nextEdges = [...preservedEdges]
      const firstNodeId = orderedNodeIds[0]
      if (firstNodeId) {
        if (incomingEdges.length > 0) {
          for (const incoming of incomingEdges) {
            nextEdges.push({
              ...incoming,
              target: firstNodeId,
            })
          }
        } else if (triggerNodeId) {
          nextEdges.push(makeLinearEdge(triggerNodeId, firstNodeId))
        }
      }

      for (let i = 0; i < orderedNodeIds.length - 1; i++) {
        const sourceId = orderedNodeIds[i]
        const targetId = orderedNodeIds[i + 1]
        // Look up by source→target pair to preserve metadata for semantically surviving edges.
        // New adjacencies (nodes not previously connected) get the default template.
        const existingEdge = internalEdgeMap.get(`${sourceId}->${targetId}`)
        nextEdges.push(makeLinearEdge(sourceId, targetId, existingEdge ?? undefined))
      }

      const lastNodeId = orderedNodeIds[orderedNodeIds.length - 1]
      if (lastNodeId) {
        for (const outgoing of outgoingEdges) {
          nextEdges.push({
            ...outgoing,
            source: lastNodeId,
          })
        }
      }

      return nextEdges
    })
  }, [builder?.nodes, builder?.setEdges])

  const moveNodeToIndex = useCallback((nodeId: string, targetSlot: number) => {
    const data = getReorderableData()
    if (!data || !builder?.setNodes) {
      logger.warn('[Reorder] moveNodeToIndex: no data or setNodes', { hasData: !!data, hasSetNodes: !!builder?.setNodes })
      return
    }
    const { ids, positions, spacing } = data
    let slot = Math.max(0, Math.min(ids.length, targetSlot))

    const currentIndex = ids.indexOf(nodeId)
    if (currentIndex === -1) {
      logger.warn('[Reorder] moveNodeToIndex: node not found in reorderable list', { nodeId, ids })
      return
    }

    const newOrder = ids.slice()
    newOrder.splice(currentIndex, 1)
    if (slot > currentIndex) {
      slot -= 1
    }
    slot = Math.max(0, Math.min(newOrder.length, slot))
    newOrder.splice(slot, 0, nodeId)

    const anchorY = positions[0] ?? 0
    const stackSpacing = Math.max(spacing, LINEAR_NODE_VERTICAL_GAP)

    const positionMap = new Map<string, number>()
    newOrder.forEach((id, index) => {
      const y = anchorY + index * stackSpacing
      positionMap.set(id, y)
    })

    const orderChanged = slot !== currentIndex

    builder.setNodes(
      builder.nodes.map((node: any) => {
        const newY = positionMap.get(node.id)
        if (newY === undefined) {
          return node
        }
        const newPosition = {
          x: node.position?.x ?? LINEAR_STACK_X,
          y: newY,
        }
        return {
          ...node,
          position: newPosition,
          positionAbsolute: newPosition,
        }
      })
    )

    if (orderChanged) {
      syncReorderEdges(newOrder)
    }

    return {
      newOrder,
      changed: orderChanged,
    }
  }, [builder?.nodes, builder?.setNodes, getReorderableData, syncReorderEdges])

  const commitReorderChanges = useCallback(async (orderedIds: string[]) => {
    if (!actions?.applyEdits || orderedIds.length < 2) {
      logger.warn('[Reorder] Skipping commit - no applyEdits or insufficient nodes', { hasApplyEdits: !!actions?.applyEdits, count: orderedIds.length })
      return
    }
    logger.debug('[Reorder] Committing order', orderedIds)
    try {
      await actions.applyEdits([{ op: "reorderNodes", nodeIds: orderedIds }])
      logger.debug('[Reorder] Successfully saved reorder')
    } catch (error: any) {
      logger.error("[WorkflowBuilderV2] Failed to persist reorder", error)
      toast({
        title: "Unable to reorder nodes",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      })
    }
  }, [actions, toast])

  const flushDragVisualState = useCallback(() => {
    dragRafRef.current = null
    const { offset, slot } = dragVisualStateRef.current
    setReorderDragOffset((prev) => (prev === offset ? prev : offset))
    setReorderPreviewIndex((prev) => (prev === slot ? prev : slot))
  }, [])

  const scheduleVisualUpdate = useCallback(() => {
    if (dragRafRef.current !== null) return
    dragRafRef.current = requestAnimationFrame(flushDragVisualState)
  }, [flushDragVisualState])

  const handleReorderPointerDown = useCallback((nodeId: string, event: React.PointerEvent) => {
    const data = getReorderableData()
    if (!data || !builder?.nodes) {
      return
    }
    const startIndex = data.ids.indexOf(nodeId)
    if (startIndex === -1) {
      return
    }

    const handleElement = event.currentTarget
    handleElement.setPointerCapture?.(event.pointerId)
    dragStartRef.current = event.clientY
    setActiveReorderDrag({
      nodeId,
      pointerId: event.pointerId,
      release: () => handleElement.releasePointerCapture?.(event.pointerId),
    })
    setReorderDragStartIndex(startIndex)
    dragVisualStateRef.current = { offset: 0, slot: startIndex }
    reorderDragOffsetRef.current = 0
    setReorderPreviewIndex(startIndex)
    setReorderDragOffset(0)
    scheduleVisualUpdate()
    if (suppressNodeClickTimeoutRef.current) {
      clearTimeout(suppressNodeClickTimeoutRef.current)
      suppressNodeClickTimeoutRef.current = null
    }
    suppressNodeClickRef.current = nodeId
  }, [builder?.nodes, getReorderableData, scheduleVisualUpdate])

  useEffect(() => {
    if (!activeReorderDrag) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== activeReorderDrag.pointerId) {
        return
      }
      const startY = dragStartRef.current
      if (startY === null) return
      const nextOffset = event.clientY - startY
      const instance = reactFlowInstanceRef.current
      if (!instance || !builder?.nodes) {
        return
      }

      const flowPoint = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      if (!flowPoint) {
        return
      }

      const data = getReorderableData()
      if (!data) {
        return
      }

      const { ids, positions, spacing, boundaries } = data
      const viewport = instance.getViewport?.()
      const zoom = viewport?.zoom ?? 1

      const getSlotForY = (y: number) => {
        let slot = ids.length
        if (Array.isArray(boundaries) && boundaries.length > 1) {
          slot = boundaries.length - 1
          for (let i = 1; i < boundaries.length; i++) {
            if (y < boundaries[i]) {
              slot = i - 1
              break
            }
          }
        } else {
          const estimatedHeight = Math.max(spacing, 80)
          for (let i = 0; i < ids.length; i++) {
            const nodeTop = positions[i]
            const nodeBottom = nodeTop + estimatedHeight
            if (y < nodeTop) {
              slot = i
              break
            }
            if (y < nodeBottom) {
              slot = i + 1
              break
            }
          }
        }
        return Math.max(0, Math.min(ids.length, slot))
      }

      const scaledOffset = zoom !== 0 ? nextOffset / zoom : nextOffset
      const pointerSlot = getSlotForY(flowPoint.y)
      const draggedIndex = reorderDragStartIndex ?? ids.indexOf(activeReorderDrag.nodeId)
      let targetSlot = pointerSlot

      if (draggedIndex !== -1) {
        const baseY = positions[draggedIndex] ?? flowPoint.y
        const estimatedHeight = Math.max(spacing, LINEAR_NODE_VERTICAL_GAP)
        const draggedCenterY = baseY + scaledOffset + estimatedHeight / 2
        const centerSlot = getSlotForY(draggedCenterY)

        if (scaledOffset > 0) {
          targetSlot = Math.max(pointerSlot, centerSlot)
        } else if (scaledOffset < 0) {
          targetSlot = Math.min(pointerSlot, centerSlot)
        } else {
          targetSlot = centerSlot
        }
      }

      reorderDragOffsetRef.current = scaledOffset
      dragVisualStateRef.current = {
        offset: scaledOffset,
        slot: targetSlot,
      }
      scheduleVisualUpdate()
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== activeReorderDrag.pointerId) {
        return
      }
      activeReorderDrag.release?.()
      if (dragRafRef.current !== null) {
        cancelAnimationFrame(dragRafRef.current)
        dragRafRef.current = null
      }
      const finalSlot = dragVisualStateRef.current.slot ?? reorderDragStartIndex ?? 0
      const finishedNodeId = activeReorderDrag.nodeId
      logger.debug('[Reorder] Pointer up', { nodeId: finishedNodeId, finalSlot, startIndex: reorderDragStartIndex })
      const reorderResult = moveNodeToIndex(finishedNodeId, finalSlot)
      logger.debug('[Reorder] moveNodeToIndex result', { changed: reorderResult?.changed, newOrder: reorderResult?.newOrder })
      setActiveReorderDrag(null)
      dragStartRef.current = null
      setReorderDragStartIndex(null)
      setReorderPreviewIndex(null)
      dragVisualStateRef.current = { offset: 0, slot: null }
      reorderDragOffsetRef.current = 0
      setReorderDragOffset(0)
      if (reorderResult?.changed) {
        commitReorderChanges(reorderResult.newOrder)
      } else {
        logger.debug('[Reorder] No change detected, skipping save')
      }
      if (suppressNodeClickTimeoutRef.current) {
        clearTimeout(suppressNodeClickTimeoutRef.current)
      }
      suppressNodeClickRef.current = finishedNodeId
      suppressNodeClickTimeoutRef.current = setTimeout(() => {
        if (suppressNodeClickRef.current === finishedNodeId) {
          suppressNodeClickRef.current = null
        }
      }, 250)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      if (dragRafRef.current !== null) {
        cancelAnimationFrame(dragRafRef.current)
        dragRafRef.current = null
      }
    }
  }, [activeReorderDrag, builder?.nodes, commitReorderChanges, getReorderableData, moveNodeToIndex, reorderPreviewIndex, reorderDragStartIndex, scheduleVisualUpdate])

  useEffect(() => {
    return () => {
      if (suppressNodeClickTimeoutRef.current) {
        clearTimeout(suppressNodeClickTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!activeReorderDrag) {
      dragStartRef.current = null
      setReorderDragOffset(0)
      return
    }
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
    }
  }, [activeReorderDrag])

  const handleTestNode = useCallback(async (nodeId: string) => {
    const node = builder?.nodes?.find((n: any) => n.id === nodeId)
    if (!node || !reactFlowInstanceRef.current) {
      logger.error('[WorkflowBuilder] Cannot test node - node or ReactFlow instance not found')
      return
    }

    const reactFlowNode = reactFlowInstanceRef.current.getNode(nodeId)
    if (!reactFlowNode) {
      logger.error('[WorkflowBuilder] Cannot find ReactFlow node:', nodeId)
      return
    }

    const config = node.data?.config || {}

    try {
      logger.debug('[WorkflowBuilder] Testing node:', { nodeId, nodeType: node.data?.type })

      // Set node to running state
      setNodeState(reactFlowInstanceRef.current, nodeId, 'running')

      // Strip test metadata from config
      const cleanConfig = Object.keys(config).reduce((acc, key) => {
        if (!key.startsWith('__test') && !key.startsWith('__validation')) {
          acc[key] = config[key]
        }
        return acc
      }, {} as Record<string, any>)

      // Collect test data from all previous nodes to enable variable resolution
      const testData: Record<string, any> = {}

      // Get all upstream nodes (nodes that come before this one)
      const getUpstreamNodes = (targetNodeId: string, visited = new Set<string>()): string[] => {
        if (visited.has(targetNodeId) || !builder?.edges) return []
        visited.add(targetNodeId)

        const upstreamIds: string[] = []
        const incomingEdges = builder.edges.filter((edge: any) => edge.target === targetNodeId)

        for (const edge of incomingEdges) {
          upstreamIds.push(edge.source)
          const parentNodes = getUpstreamNodes(edge.source, visited)
          upstreamIds.push(...parentNodes)
        }

        return upstreamIds
      }

      const upstreamNodeIds = getUpstreamNodes(nodeId)

      // Collect test results from upstream nodes and add them to testData
      for (const upstreamId of upstreamNodeIds) {
        const upstreamNode = builder.nodes.find((n: any) => n.id === upstreamId)
        if (upstreamNode?.data?.config?.__testData) {
          // Add the upstream node's test data using the node ID as the key
          testData[upstreamId] = upstreamNode.data.config.__testData

          // Also merge the test data fields directly for backward compatibility
          Object.assign(testData, upstreamNode.data.config.__testData)
        }
      }

      logger.debug('[WorkflowBuilder] Collected test data from upstream nodes:', {
        upstreamNodeCount: upstreamNodeIds.length,
        testDataKeys: Object.keys(testData)
      })

      // Call test-node API
      const response = await fetch('/api/workflows/test-node', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nodeType: node.data?.type,
          config: cleanConfig,
          testData: testData
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to test node')
      }

      logger.debug('[WorkflowBuilder] Test completed:', result)

      // Update node with test results
      const testMetadata = {
        __testData: result.testResult?.output || {},
        __testResult: {
          success: result.testResult?.success !== false,
          executionTime: result.testResult?.executionTime,
          timestamp: new Date().toISOString(),
          error: result.testResult?.error,
          message: result.testResult?.message,
          rawResponse: result.testResult?.output
        }
      }

      setNodeTestCache(prev => ({
        ...prev,
        [nodeId]: {
          data: testMetadata.__testData,
          result: testMetadata.__testResult
        }
      }))

      if (actions?.updateConfig) {
        actions.updateConfig(nodeId, testMetadata)

        if (builder?.setNodes) {
          builder.setNodes((nodes: any[]) =>
            nodes.map((n: any) => {
              if (n.id !== nodeId) return n
              return {
                ...n,
                data: {
                  ...n.data,
                  config: {
                    ...(n.data?.config || {}),
                    ...testMetadata,
                  }
                }
              }
            })
          )
        }
      }

      // Agent eval: track node test result
      const testPassed = result.testResult?.success !== false
      agentEvalTracker.trackEvent(AGENT_EVAL_EVENTS.NODE_TEST_RESULT, {
        node_id: nodeId,
        node_type: node?.data?.type,
        passed: testPassed,
        duration_ms: result.testResult?.executionTime,
      })

      // Set node to passed or failed state
      if (testPassed) {
        setNodeState(reactFlowInstanceRef.current, nodeId, 'passed')
        toast({
          title: "Test passed",
          description: result.testResult?.message || "Node executed successfully",
        })
      } else {
        setNodeState(reactFlowInstanceRef.current, nodeId, 'failed')
        toast({
          title: "Test failed",
          description: result.testResult?.error || result.testResult?.message || "Node test failed",
          variant: "destructive"
        })
      }

      persistNodeTestResult('success', testMetadata, node).catch((error) =>
        logger.error('[WorkflowBuilder] Failed to persist node test result', error)
      )

    } catch (error: any) {
      logger.error('[WorkflowBuilder] Test failed:', error)
      setNodeState(reactFlowInstanceRef.current, nodeId, 'failed')
      const errorMetadata = {
        __testData: {},
        __testResult: {
          success: false,
          timestamp: new Date().toISOString(),
          error: error.message || 'Test execution failed',
          message: error.message || 'Test execution failed'
        }
      }

      setNodeTestCache(prev => ({
        ...prev,
        [nodeId]: {
          data: errorMetadata.__testData,
          result: errorMetadata.__testResult
        }
      }))

      if (actions?.updateConfig) {
        actions.updateConfig(nodeId, errorMetadata)

        if (builder?.setNodes) {
          builder.setNodes((nodes: any[]) =>
            nodes.map((n: any) => {
              if (n.id !== nodeId) return n
              return {
                ...n,
                data: {
                  ...n.data,
                  config: {
                    ...(n.data?.config || {}),
                    ...errorMetadata,
                  }
                }
              }
            })
          )
        }
      }
      persistNodeTestResult('error', errorMetadata, node, error.message).catch((persistError) =>
        logger.error('[WorkflowBuilder] Failed to persist failed node test', persistError)
      )
      toast({
        title: "Test failed",
        description: error.message || "Failed to execute test",
        variant: "destructive"
      })
    }
    async function persistNodeTestResult(
      status: 'success' | 'error',
      payload: { __testData: Record<string, any>; __testResult: any },
      nodeData: any,
      errorMessage?: string
    ) {
      try {
        const response = await fetch(`/workflows/v2/api/flows/${flowId}/nodes/${nodeId}/tests`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status,
            executionTime: payload.__testResult.executionTime,
            output: payload.__testData,
            rawResponse: payload.__testResult.rawResponse,
            error: status === 'error' ? { message: errorMessage || payload.__testResult.error } : null,
            message: payload.__testResult.message,
            nodeType: nodeData.data?.type,
            nodeLabel: nodeData.data?.title || nodeData.data?.label || nodeId,
          }),
        })

        if (!response.ok) {
          const errorPayload = await response.json().catch(() => ({}))
          logger.error('[WorkflowBuilder] Failed to persist node test:', errorPayload)
          return
        }

        const responseBody = await response.json()
        if (responseBody?.runId && actions?.refreshRun) {
          await actions.refreshRun(responseBody.runId)
        }
      } catch (persistError) {
        logger.error('[WorkflowBuilder] Persist node test error:', persistError)
      }
    }
  }, [builder?.nodes, builder?.setNodes, actions, flowId, toast])

  const handleTestFlowFromHere = useCallback(async (nodeId: string) => {
    if (!builder?.nodes || !builder?.edges || !reactFlowInstanceRef.current) {
      logger.error('[WorkflowBuilder] Cannot test flow - builder not ready')
      return
    }

    const startNode = builder.nodes.find((n: any) => n.id === nodeId)
    if (!startNode) {
      logger.error('[WorkflowBuilder] Start node not found:', nodeId)
      return
    }

    // Get all downstream nodes
    const getDownstreamNodes = (fromNodeId: string, visited = new Set<string>()): string[] => {
      if (visited.has(fromNodeId)) return []
      visited.add(fromNodeId)

      const downstreamIds: string[] = [fromNodeId]
      const outgoingEdges = builder.edges.filter((edge: any) => edge.source === fromNodeId)

      for (const edge of outgoingEdges) {
        const childNodes = getDownstreamNodes(edge.target, visited)
        downstreamIds.push(...childNodes)
      }

      return downstreamIds
    }

    const nodesToTest = getDownstreamNodes(nodeId)
    logger.debug('[WorkflowBuilder] Testing flow from node:', nodeId, 'Total nodes:', nodesToTest.length)

    // Sort nodes in execution order (topological sort)
    const sortedNodeIds: string[] = []
    const visited = new Set<string>()

    const topologicalSort = (nId: string) => {
      if (visited.has(nId)) return
      visited.add(nId)

      const incomingEdges = builder.edges.filter((edge: any) =>
        edge.target === nId && nodesToTest.includes(edge.source)
      )
      for (const edge of incomingEdges) {
        topologicalSort(edge.source)
      }

      sortedNodeIds.push(nId)
    }

    for (const nId of nodesToTest) {
      topologicalSort(nId)
    }

    // Test nodes sequentially, passing output from one to the next
    let currentTestData: Record<string, any> = {}

    for (const nId of sortedNodeIds) {
      const node = builder.nodes.find((n: any) => n.id === nId)
      if (!node) continue

      logger.debug('[WorkflowBuilder] Testing node in flow:', node.data?.title || node.data?.type)

      // Set node to running state
      setNodeState(reactFlowInstanceRef.current, nId, 'running')

      try {
        // Strip test metadata from config
        const config = node.data?.config || {}
        const cleanConfig = Object.keys(config).reduce((acc, key) => {
          if (!key.startsWith('__test') && !key.startsWith('__validation')) {
            acc[key] = config[key]
          }
          return acc
        }, {} as Record<string, any>)

        // Call test-node API with accumulated test data
        const response = await fetch('/api/workflows/test-node', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            nodeType: node.data?.type,
            config: cleanConfig,
            testData: currentTestData,
          }),
        })

        const result = await response.json()

        if (!response.ok || result.testResult?.success === false) {
          throw new Error(result.error || result.testResult?.error || 'Test failed')
        }

        // Merge the output into currentTestData for the next node
        currentTestData = {
          ...currentTestData,
          ...(result.testResult?.output || {}),
        }

        // Update node with test results and set to passed state
        if (actions?.updateConfig) {
          const updatedConfig = {
            ...config,
            __testData: result.testResult?.output || {},
            __testResult: {
              success: true,
              executionTime: result.testResult?.executionTime,
              timestamp: new Date().toISOString(),
              message: result.testResult?.message,
              rawResponse: result.testResult?.output
            }
          }
          actions.updateConfig(nId, updatedConfig)
        }

        // Wait for debounced config save to complete (600ms debounce + 100ms buffer)
        // This ensures the database update and graph refresh complete before setting state
        await new Promise(resolve => setTimeout(resolve, 700))
        setNodeState(reactFlowInstanceRef.current, nId, 'passed')

      } catch (error: any) {
        logger.error('[WorkflowBuilder] Flow test failed at node:', node.data?.title, error)

        // Set node to failed state
        setNodeState(reactFlowInstanceRef.current, nId, 'failed')

        // Update node with error
        if (actions?.updateConfig) {
          const config = node.data?.config || {}
          const updatedConfig = {
            ...config,
            __testResult: {
              success: false,
              error: error.message,
              timestamp: new Date().toISOString(),
            }
          }
          actions.updateConfig(nId, updatedConfig)
        }

        toast({
          title: "Flow test failed",
          description: `Failed at node: ${node.data?.title || node.data?.type}. ${error.message}`,
          variant: "destructive"
        })

        // Stop testing on error
        return
      }
    }

    toast({
      title: "Flow test completed",
      description: `Successfully tested ${sortedNodeIds.length} node(s)`,
    })
  }, [builder?.nodes, builder?.edges, actions, toast])

  const reactFlowProps = useMemo(() => {
    // CRITICAL FIX: In production, builder can temporarily have no nodes during re-renders
    // When this happens, we preserve the last valid props to prevent nodes from disappearing
    if (!builder) {
      // Return cached value if available, otherwise null
      return lastValidReactFlowPropsRef.current
    }

    // If builder exists but has no nodes yet (still loading), preserve last valid state
    // This prevents the flash where nodes disappear during initial load race conditions
    if (!builder.nodes || builder.nodes.length === 0) {
      // Only return cached if we have nodes cached - otherwise let it proceed
      // (new workflows genuinely have 0 nodes initially)
      if (lastValidReactFlowPropsRef.current && lastValidReactFlowPropsRef.current.nodes.length > 0) {
        return lastValidReactFlowPropsRef.current
      }
    }

    // Detect last nodes (nodes with no outgoing edges)
    const lastNodeIds = new Set<string>()
    const nodesWithOutgoing = new Set<string>()

    builder.edges.forEach((edge: any) => {
      nodesWithOutgoing.add(edge.source)
    })

    builder.nodes.forEach((node: any) => {
      if (!node.data?.isTrigger && !nodesWithOutgoing.has(node.id)) {
        lastNodeIds.add(node.id)
      }
    })

    const previewOffsets = new Map<string, number>()
    const reorderData = getReorderableData()
    const orderMap = new Map<string, number>()
    const reorderableNodes = reorderData?.reorderableNodes ?? []

    if (reorderData) {
      reorderData.ids.forEach((id, index) => orderMap.set(id, index))

      if (activeReorderDrag && reorderPreviewIndex !== null) {
        const draggedId = activeReorderDrag.nodeId
        const draggedIndex = reorderData.ids.indexOf(draggedId)
        if (draggedIndex !== -1) {
          const simulated = reorderData.ids.slice()
          simulated.splice(draggedIndex, 1)
          let insertSlot = Math.max(0, Math.min(reorderData.ids.length, reorderPreviewIndex))
          if (insertSlot > draggedIndex) {
            insertSlot -= 1
          }
          insertSlot = Math.max(0, Math.min(simulated.length, insertSlot))
          simulated.splice(insertSlot, 0, draggedId)

          const simulatedMap = new Map<string, number>()
          simulated.forEach((id, idx) => simulatedMap.set(id, idx))

          reorderData.ids.forEach((id, index) => {
            if (id === draggedId) return
            const simulatedIdx = simulatedMap.get(id)
            if (simulatedIdx === undefined) return
            const currentY = reorderData.positions[index]
            const targetY = reorderData.positions[simulatedIdx]
            if (currentY === undefined || targetY === undefined) return
            previewOffsets.set(id, targetY - currentY)
          })
        }
      }
    }

    // Enhance nodes with isLastNode, onAddNodeAfter, onTestNode, onTestFlowFromHere, isBeingConfigured, and nodeCost
    const enhancedNodes = builder.nodes.map((node: any) => {
      const orderIndex = orderMap.get(node.id)
      const canMoveUp = typeof orderIndex === 'number' && orderIndex > 0
      const canMoveDown = typeof orderIndex === 'number' && orderIndex < reorderableNodes.length - 1

      // Calculate task cost for this node
      const nodeCost = getNodeTaskCost(node)

      return {
        ...node,
        data: {
          ...node.data,
          isLastNode: lastNodeIds.has(node.id),
          onAddNodeAfter: handleAddNodeAfter,
          onTestNode: handleTestNode,
          onTestFlowFromHere: handleTestFlowFromHere,
          isBeingConfigured: configuringNodeId === node.id,
          isBeingReordered: activeReorderDrag?.nodeId === node.id,
          reorderDragOffset:
            activeReorderDrag?.nodeId === node.id ? reorderDragOffset : 0,
          previewOffset: previewOffsets.get(node.id) ?? 0,
          onStartReorder: isReorderableNode(node) ? handleReorderPointerDown : undefined,
          isReorderable: isReorderableNode(node),
          nodeCost, // Task cost for this node
          shouldSuppressConfigureClick: () => {
            if (suppressNodeClickRef.current === node.id) {
              suppressNodeClickRef.current = null
              return true
            }
            return false
          },
        }
      }
    })

    // Handler for inserting a node in the middle of an edge
    const handleInsertNodeOnEdge = (edgeId: string, position: { x: number; y: number }) => {
      // Close config modal if open (unconditional - no-op if already null)
      setConfiguringNode(null)

      // Find the edge to get the source node
      const edge = builder.edges.find((e: any) => e.id === edgeId)
      if (!edge) return

      // Store the source node ID and open integrations panel
      setSelectedNodeId(edge.source)
      openIntegrationsPanel('action')
    }

    // Enhance edges with onInsertNode handler and deduplicate by ID
    const seenEdgeIds = new Set<string>()
    const enhancedEdges = builder.edges
      .filter((edge: any) => {
        if (seenEdgeIds.has(edge.id)) {
          logger.warn(`[reactFlowProps] Skipping duplicate edge ID: ${edge.id}`)
          return false
        }
        seenEdgeIds.add(edge.id)
        return true
      })
      .map((edge: any) => ({
        ...edge,
        data: {
          ...edge.data,
          onInsertNode: handleInsertNodeOnEdge,
          isReordering: !!activeReorderDrag,
        }
      }))

    const result = {
      nodes: enhancedNodes,
      edges: enhancedEdges,
      onNodesChange: builder.optimizedOnNodesChange ?? builder.onNodesChange,
      onEdgesChange: builder.onEdgesChange,
      onConnect: builder.onConnect,
      nodeTypes: builder.nodeTypes,
      edgeTypes: builder.edgeTypes,
    }

    // Cache the valid result for future use during transitional states
    // Only cache if we have actual nodes (not during initial empty state)
    if (enhancedNodes.length > 0) {
      lastValidReactFlowPropsRef.current = result
    }

    return result
  }, [builder, handleAddNodeAfter, handleTestNode, handleTestFlowFromHere, handleReorderPointerDown, configuringNodeId, activeReorderDrag, getReorderableData, reorderDragOffset, reorderPreviewIndex])

  // Name update handler
  const persistName = useCallback(
    async (name: string) => {
      if (!actions) return
      try {
        await actions.updateFlowName(name)
        setNameDirty(false)
      } catch (error: any) {
        toast({
          title: "Rename failed",
          description: error?.message ?? "Unable to save the workflow name.",
          variant: "destructive",
        })
      }
    },
    [actions, toast]
  )

  const handleNameChange = useCallback(
    (name: string) => {
      setWorkflowName(name)
      setNameDirty(true)
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
      saveTimerRef.current = setTimeout(() => {
        persistName(name.trim())
      }, 600)
    },
    [persistName]
  )

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  // Selection handler
  const handleSelectionChange = useCallback((params: any) => {
    const first = params?.nodes?.[0]
    setSelectedNodeId(first?.id ?? null)
  }, [])

  // Helper to open integrations panel with the correct mode (trigger vs action)
  const openIntegrationsPanel = useCallback((forceMode?: 'trigger' | 'action') => {
    let mode: 'trigger' | 'action'

    if (forceMode) {
      // If a specific mode is requested (e.g., when clicking a trigger node to change it), use that
      mode = forceMode
    } else {
      // Otherwise, determine automatically based on whether a trigger already exists
      const hasTrigger = builder.nodes.some((node: any) => {
        const component = ALL_NODE_COMPONENTS.find(c => c.type === node.data?.type)
        return component?.isTrigger
      })
      mode = hasTrigger ? 'action' : 'trigger'
    }

    // Lazy load integrations when panel opens (only if not already loaded)
    // Use workspace context to filter integrations to this workflow's workspace
    if (integrations.length === 0 && workspaceContext) {
      logger.debug('[WorkflowBuilder] Lazy-loading workspace-filtered integrations:', {
        workspaceType: workspaceContext.type,
        workspaceId: workspaceContext.id
      })
      fetchIntegrations(false, workspaceContext.type, workspaceContext.id || undefined).catch(error => {
        logger.error('[WorkflowBuilder] Failed to lazy-load integrations on panel open:', error)
      })
    }

    setIntegrationsPanelMode(mode)
    setIsIntegrationsPanelOpen(true)
  }, [builder.nodes, integrations.length, fetchIntegrations, workspaceContext])

  // Handler for adding node after another (from plus button)
  const handleAddNodeAfterClick = useCallback((afterNodeId: string | null) => {
    // Close config modal if open
    if (configuringNode) {
      setConfiguringNode(null)
    }
    // Store the node to add after
    if (afterNodeId) {
      setSelectedNodeId(afterNodeId)
    }
    // Open integrations panel in action mode
    openIntegrationsPanel('action')
  }, [configuringNode, openIntegrationsPanel])

  // Node selection from panel
  const handleNodeSelectFromPanel = useCallback(async (nodeData: any) => {
    logger.debug('🎯 [WorkflowBuilder] handleNodeSelectFromPanel called:', {
      nodeData: nodeData?.type || nodeData,
      selectedNodeId,
      changingNodeId,
      hasActions: !!actions,
      hasBuilder: !!builder
    })

    if (!actions || !builder) {
      logger.debug('⚠️ [WorkflowBuilder] Returning early - actions or builder missing')
      return
    }

    const currentNodes = builder.nodes ?? []

    // Check if we're changing an existing node (replacing its type)
    const nodeBeingChanged = changingNodeId
      ? currentNodes.find((n: any) => n.id === changingNodeId)
      : null

    // Check if we're replacing a placeholder node
    const replacingPlaceholder = currentNodes.find((n: any) =>
      n.id === selectedNodeId && n.data?.isPlaceholder
    )

    // Default position - use existing node's X to maintain alignment, or fallback to 400
    const existingNodeX = currentNodes[0]?.position?.x ?? 400
    let position = nodeData.position || { x: existingNodeX, y: 300 }

    // If changing an existing node, use its position
    if (nodeBeingChanged) {
      position = nodeBeingChanged.position
      logger.debug('📌 [WorkflowBuilder] Changing node:', changingNodeId, 'to:', nodeData.type)
    }
    // If replacing placeholder, use its position
    else if (replacingPlaceholder) {
      position = replacingPlaceholder.position
      logger.debug('📌 [WorkflowBuilder] Replacing placeholder:', selectedNodeId, 'with:', nodeData.type)
    }
    // If adding after a specific node (from plus button), calculate position after that node
    else if (selectedNodeId) {
      const afterNode = currentNodes.find((n: any) => n.id === selectedNodeId)
      if (afterNode) {
        position = {
          x: afterNode.position.x,
          y: afterNode.position.y + LINEAR_NODE_VERTICAL_GAP
        }
        logger.debug('📌 [WorkflowBuilder] Adding node after:', selectedNodeId, 'at position:', position)
      }
    }

    const nodeComponent = nodeComponentMap.get(nodeData.type)
    const providerId = nodeComponent?.providerId ?? nodeData.providerId

    // Generate a temporary ID for the config modal
    const tempId = `temp-${Date.now()}`

    // Create optimistic node for config modal only
    const optimisticNode = {
      id: tempId,
      type: "custom",
      position,
      data: {
        label: nodeComponent?.title ?? nodeData.title ?? nodeData.type,
        title: nodeComponent?.title ?? nodeData.title ?? nodeData.type,
        type: nodeData.type,
        description: nodeComponent?.description ?? "",
        providerId,
        icon: nodeComponent?.icon,
        config: {},
        isTrigger: nodeComponent?.isTrigger ?? false,
        _optimistic: true,
      },
    }

    // Close panel immediately for better UX
    setIsIntegrationsPanelOpen(false)

    // Check if this node needs configuration (has configSchema fields)
    logger.debug('🔧 [WorkflowBuilder] Config check:', {
      nodeType: nodeData.type,
      nodeComponentFound: !!nodeComponent,
      configSchema: nodeComponent?.configSchema,
      configSchemaLength: nodeComponent?.configSchema?.length,
    })
    const needsConfiguration = nodeComponent?.configSchema && nodeComponent.configSchema.length > 0
    logger.debug('🔧 [WorkflowBuilder] needsConfiguration:', needsConfiguration)

    // Add optimistic node to canvas immediately for instant feedback
    builder.setNodes((nodes: any[]) => {
      let newNodes = [...nodes]

      // If changing an existing node, remove it first (we'll replace with new type)
      if (nodeBeingChanged) {
        newNodes = newNodes.filter(n => n.id !== changingNodeId)
        // No shifting needed - just replace in place
        newNodes.push(optimisticNode)
        return newNodes
      }

      // If replacing a placeholder, remove it first
      if (replacingPlaceholder) {
        newNodes = newNodes.filter(n => n.id !== selectedNodeId)
      }

      // Use >= to catch nodes at the same Y position (prevents overlap)
      const insertIndex = newNodes.findIndex(n => n.position.y >= position.y)
      if (insertIndex === -1) {
        // Adding at the end - no shift needed
        newNodes.push(optimisticNode)
      } else {
        // Inserting between nodes - shift all nodes at or below down to make room
        const verticalShift = LINEAR_NODE_VERTICAL_GAP
        newNodes = newNodes.map((node) => {
          if (node.position && node.position.y >= position.y) {
            return {
              ...node,
              position: {
                ...node.position,
                y: node.position.y + verticalShift
              }
            }
          }
          return node
        })
        // Now insert the new node (all shifted nodes are now > position.y)
        const newInsertIndex = newNodes.findIndex(n => n.position.y > position.y)
        if (newInsertIndex === -1) {
          newNodes.push(optimisticNode)
        } else {
          newNodes.splice(newInsertIndex, 0, optimisticNode)
        }
      }
      return newNodes
    })

    // Add optimistic edges immediately
    if (nodeBeingChanged) {
      // When changing an existing node, update edges to reference the new temp ID
      builder.setEdges((edges: any[]) => {
        return edges.map(edge => {
          // Update edges pointing TO the changed node
          if (edge.target === changingNodeId) {
            return { ...edge, target: tempId }
          }
          // Update edges FROM the changed node
          if (edge.source === changingNodeId) {
            return { ...edge, source: tempId }
          }
          return edge
        })
      })
    } else if (replacingPlaceholder) {
      // When replacing a placeholder, update edges that reference the placeholder
      builder.setEdges((edges: any[]) => {
        return edges.map(edge => {
          // Update edges pointing TO the placeholder
          if (edge.target === selectedNodeId) {
            return { ...edge, target: tempId }
          }
          // Update edges FROM the placeholder
          if (edge.source === selectedNodeId) {
            return { ...edge, source: tempId }
          }
          return edge
        })
      })
    } else if (selectedNodeId) {
      builder.setEdges((edges: any[]) => {
        const oldEdge = edges.find((e: any) => e.source === selectedNodeId)
        if (oldEdge) {
          // Inserting between two nodes
          const nextNodeId = oldEdge.target
          return [
            ...edges.filter(e => e.id !== oldEdge.id),
            {
              id: `${selectedNodeId}-${tempId}`,
              source: selectedNodeId,
              target: tempId,
              sourceHandle: oldEdge.sourceHandle || 'source',
              type: 'custom'
            },
            {
              id: `${tempId}-${nextNodeId}`,
              source: tempId,
              target: nextNodeId,
              sourceHandle: 'source',
              targetHandle: oldEdge.targetHandle,
              type: 'custom'
            }
          ]
        } else {
          // Adding at the end
          return [
            ...edges,
            {
              id: `${selectedNodeId}-${tempId}`,
              source: selectedNodeId,
              target: tempId,
              sourceHandle: 'source',
              type: 'custom'
            }
          ]
        }
      })
    }

    // Open config modal immediately (only if node needs configuration)
    if (needsConfiguration) {
      setConfiguringNode(optimisticNode)
    }

    // Save state before clearing (needed for edge creation and node replacement later)
    const previousNodeId = selectedNodeId
    const isReplacingPlaceholder = !!replacingPlaceholder
    const nodeIdBeingChanged = changingNodeId
    const isChangingNode = !!nodeBeingChanged

    // Get edges connected to the node being changed before we modify anything
    const edgesConnectedToChangedNode = isChangingNode ? builder.edges.filter((e: any) =>
      e.source === nodeIdBeingChanged || e.target === nodeIdBeingChanged
    ) : []

    // Clear selected/changing node IDs
    setSelectedNodeId(null)
    setChangingNodeId(null)

    try {
      let newNodeId: string

      // If changing an existing node, use atomic replaceNode to avoid intermediate states
      if (isChangingNode && nodeIdBeingChanged) {
        logger.debug('📌 [WorkflowBuilder] Replacing node atomically:', nodeIdBeingChanged, '→', nodeData.type)
        // replaceNode handles: delete old, add new, preserve integration_id, update edges in place
        newNodeId = await actions.replaceNode(
          nodeIdBeingChanged,
          nodeData.type,
          position,
          ['integration_id'] // Preserve integration connection when switching same provider
        )
        logger.debug('📌 [WorkflowBuilder] Node replaced successfully:', newNodeId)

        // Only update configuring node if we opened the config modal
        if (needsConfiguration) {
          setConfiguringNode((current: any) => {
            if (current && current.id === tempId) {
              return { ...current, id: newNodeId, data: { ...current.data, _optimistic: false } }
            }
            return current
          })
        }
        // Note: Edges are automatically updated by replaceNode - no manual reconnection needed
      } else {
        // Not changing an existing node - use atomic batch operation
        // This ensures addNode + edge changes happen in a single applyEdits call,
        // preventing stale edges and double plus buttons
        const nodeId = generateId()
        const addEdit = addNodeEdit(nodeData.type, position, nodeId)

        const edits: any[] = [addEdit]

        // If adding after a node (not replacing placeholder), include edge operations
        if (previousNodeId && !isReplacingPlaceholder) {
          logger.debug('🔗 [WorkflowBuilder] Building atomic insert after:', previousNodeId)

          const oldEdge = builder.edges.find((e: any) => e.source === previousNodeId)

          if (oldEdge) {
            // Inserting between two nodes: remove old edge, add two new ones
            const nextNodeId = oldEdge.target
            edits.push({ op: "disconnectEdge", sourceId: previousNodeId, targetId: nextNodeId })
            edits.push(oldConnectToEdge(previousNodeId, nodeId, oldEdge.sourceHandle || 'source'))
            edits.push(oldConnectToEdge(nodeId, nextNodeId, 'source', oldEdge.targetHandle))
            logger.debug('🔗 [WorkflowBuilder] Atomic insert between', previousNodeId, 'and', nextNodeId)
          } else {
            // Adding at the end
            edits.push(oldConnectToEdge(previousNodeId, nodeId, 'source'))
            logger.debug('🔗 [WorkflowBuilder] Atomic add at end after', previousNodeId)
          }
        }

        logger.debug('📌 [WorkflowBuilder] Applying atomic edits:', edits.length, 'ops for', nodeData.type)
        await actions.applyEdits(edits)
        newNodeId = nodeId

        logger.debug('📌 [WorkflowBuilder] Node saved successfully via atomic batch')

        // Only update configuring node if we opened the config modal
        if (needsConfiguration) {
          setConfiguringNode((current: any) => {
            if (current && current.id === tempId) {
              return { ...current, id: newNodeId, data: { ...current.data, _optimistic: false } }
            }
            return current
          })
        }
      }
    } catch (error: any) {
      if (needsConfiguration) {
        setConfiguringNode(null)
      }
      toast({
        title: "Failed to add node",
        description: error?.message ?? "Unable to add node",
        variant: "destructive",
      })
      openIntegrationsPanel()
    }
  }, [actions, builder, nodeComponentMap, toast, selectedNodeId, changingNodeId, openIntegrationsPanel])

  // Node deletion with optimistic update for instant feedback
  const handleDeleteNodes = useCallback(async (nodeIds: string[]) => {
    if (!actions || !builder || nodeIds.length === 0) return

    const nodeIdSet = new Set(nodeIds)

    // Store current nodes/edges for rollback if delete fails
    const currentNodes = builder.nodes
    const currentEdges = builder.edges

    // Record history snapshot for undo
    builder.pushHistorySnapshot?.(currentNodes, currentEdges)

    // Find the Y position of the deleted node(s) - use the highest (smallest Y) deleted node
    let deletedNodeY: number | null = null
    nodeIds.forEach(nodeId => {
      const node = currentNodes.find((n: any) => n.id === nodeId)
      if (node && node.position) {
        if (deletedNodeY === null || node.position.y < deletedNodeY) {
          deletedNodeY = node.position.y
        }
      }
    })

    // Optimistically remove nodes from UI immediately
    let updatedNodes = currentNodes.filter((node: any) => !nodeIdSet.has(node.id))

    // Shift nodes up if we have a deleted position
    if (deletedNodeY !== null) {
      // Calculate the vertical gap (node height + spacing)
      // Typical node height is ~100-200px, gap between nodes is ~180px
      const verticalShift = LINEAR_NODE_VERTICAL_GAP

      // Shift all nodes that were below the deleted node(s)
      updatedNodes = updatedNodes.map((node: any) => {
        if (node.position && node.position.y > deletedNodeY!) {
          return {
            ...node,
            position: {
              ...node.position,
              y: node.position.y - verticalShift
            }
          }
        }
        return node
      })
    }

    // For each deleted node, find incoming and outgoing edges and reconnect them
    const newEdges: any[] = []
    nodeIds.forEach(nodeId => {
      const incomingEdge = currentEdges.find((e: any) => e.target === nodeId)
      const outgoingEdge = currentEdges.find((e: any) => e.source === nodeId)

      // If the deleted node was in the middle of a chain, reconnect the edges
      if (incomingEdge && outgoingEdge) {
        newEdges.push({
          id: `${incomingEdge.source}-${outgoingEdge.target}`,
          source: incomingEdge.source,
          target: outgoingEdge.target,
          sourceHandle: incomingEdge.sourceHandle || 'source',
          targetHandle: outgoingEdge.targetHandle || 'target',
          type: 'custom',
        })
      }
    })

    // Remove edges connected to deleted nodes and add reconnection edges
    const updatedEdges = [
      ...currentEdges.filter(
        (edge: any) => !nodeIdSet.has(edge.source) && !nodeIdSet.has(edge.target)
      ),
      ...newEdges
    ]

    // Check if all real (non-placeholder) nodes are being deleted
    const realNodes = updatedNodes.filter((n: any) => !n.data?.isPlaceholder)
    const shouldResetToPlaceholders = realNodes.length === 0

    // Calculate center position based on viewport and agent panel
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080
    const panelWidthRaw = agentOpen ? agentPanelWidth : 0
    const panelWidth = isFinite(panelWidthRaw) ? panelWidthRaw : 0
    const availableWidth = viewportWidth - panelWidth
    const centerXRaw = panelWidth + (availableWidth / 2) - 180 // 180 = half of 360px node width
    const centerYRaw = (viewportHeight / 2) - 150
    // Guard against NaN values
    const centerX = isFinite(centerXRaw) ? centerXRaw : 600
    const centerY = isFinite(centerYRaw) ? centerYRaw : 200

    if (shouldResetToPlaceholders) {
      logger.debug('🔄 [WorkflowBuilder] All nodes deleted, resetting to placeholder state')

      // Reset to placeholder state (Zapier-style, centered)
      const placeholderNodes = [
        {
          id: 'trigger-placeholder',
          type: 'trigger_placeholder',
          position: { x: centerX, y: centerY },
          data: {
            type: 'trigger_placeholder',
            isPlaceholder: true,
            title: 'Trigger',
          },
        },
        {
          id: 'action-placeholder',
          type: 'action_placeholder',
          position: { x: centerX, y: centerY + 180 },
          data: {
            type: 'action_placeholder',
            isPlaceholder: true,
            title: 'Action',
          },
        },
      ]

      const placeholderEdge = {
        id: 'placeholder-edge',
        source: 'trigger-placeholder',
        target: 'action-placeholder',
        type: 'default',
        style: {
          strokeDasharray: '5,5',
          stroke: '#9CA3AF',
        },
      }

      builder.setNodes(placeholderNodes as any)
      builder.setEdges([placeholderEdge] as any)

      // Center view on placeholders after a brief delay
      setTimeout(() => {
        if (reactFlowInstanceRef.current) {
          reactFlowInstanceRef.current.fitView({
            padding: 0.2,
            duration: 400,
            maxZoom: 1,
          })
        }
      }, 100)
    } else {
      // Simple check: is there a real trigger node (isTrigger=true AND NOT a placeholder)?
      const hasRealTrigger = updatedNodes.some((n: any) => {
        const nodeComponent = ALL_NODE_COMPONENTS.find(c => c.type === n.data?.type)
        const isTrigger = n.data?.isTrigger || nodeComponent?.isTrigger
        return isTrigger && !n.data?.isPlaceholder
      })

      // If no real trigger, add a trigger placeholder (unless one already exists)
      const hasTriggerPlaceholder = updatedNodes.some((n: any) =>
        n.type === 'trigger_placeholder' || n.id === 'trigger-placeholder'
      )

      if (!hasRealTrigger && !hasTriggerPlaceholder && updatedNodes.length > 0) {
        logger.debug('🔄 [WorkflowBuilder] No trigger found, adding trigger placeholder')

        // Find the topmost node to place trigger placeholder above it
        const sortedNodes = [...updatedNodes].sort((a: any, b: any) => a.position.y - b.position.y)
        const topNode = sortedNodes[0]

        if (topNode) {
          const triggerPlaceholder = {
            id: 'trigger-placeholder',
            type: 'trigger_placeholder',
            position: {
              x: topNode.position.x,
              y: topNode.position.y - LINEAR_NODE_VERTICAL_GAP
            },
            data: {
              type: 'trigger_placeholder',
              isPlaceholder: true,
              title: 'Trigger',
            },
          }

          updatedNodes = [triggerPlaceholder, ...updatedNodes]

          updatedEdges.push({
            id: `trigger-placeholder-${topNode.id}`,
            source: 'trigger-placeholder',
            target: topNode.id,
            sourceHandle: 'source',
            targetHandle: 'target',
            type: 'custom',
            style: { stroke: '#d0d6e0' },
          })
        }
      }

      builder.setNodes(updatedNodes)
      builder.setEdges(updatedEdges)
    }

    // Clear selection when deleting current node(s)
    setSelectedNodeId(prev => (prev && nodeIdSet.has(prev) ? null : prev))

    // Close config modal if the deleted node is currently being configured
    if (configuringNode && nodeIdSet.has(configuringNode.id)) {
      setConfiguringNode(null)
    }

    // Persist to backend without waiting for response
    // The UI is already updated optimistically above - don't let backend response overwrite it
    const deleteEdits = nodeIds.map(nodeId => ({ op: "deleteNode", nodeId }))
    actions.applyEdits(deleteEdits, { skipGraphUpdate: true }).catch((error: any) => {
      // Rollback on error
      builder.setNodes(currentNodes)
      builder.setEdges(currentEdges)

      toast({
        title: "Failed to delete node",
        description: error?.message ?? "Unable to delete node(s)",
        variant: "destructive",
      })
    })

    // Auto-deactivate workflow if trigger was deleted and workflow was active
    const deletedTrigger = nodeIds.some(nodeId => {
      const node = currentNodes.find((n: any) => n.id === nodeId)
      if (!node) return false
      const nodeComponent = ALL_NODE_COMPONENTS.find(c => c.type === node.data?.type)
      return node.data?.isTrigger || nodeComponent?.isTrigger
    })

    if (deletedTrigger && flowState?.workflowStatus === 'active') {
      logger.debug('[WorkflowBuilder] Trigger deleted from active workflow, auto-deactivating')
      actions.deactivateWorkflow().then((result) => {
        toast({
          title: "Workflow Deactivated",
          description: "Workflow was deactivated because the trigger was removed.",
          variant: "default",
        })
      }).catch((error: any) => {
        logger.error('[WorkflowBuilder] Failed to auto-deactivate workflow:', error)
      })
    }
  }, [actions, builder, toast, agentOpen, agentPanelWidth, configuringNode, flowState?.workflowStatus])

  const handleNodeDelete = useCallback(async (nodeId: string) => {
    // Agent eval: track node removal as manual correction
    if (buildMachine.state !== BuildState.IDLE) {
      const node = builder?.nodes?.find((n: any) => n.id === nodeId)
      agentEvalTracker.trackEvent(AGENT_EVAL_EVENTS.MANUAL_CORRECTION, {
        node_id: nodeId,
        correction_type: 'node_remove',
        severity: 'major',
        node_type: node?.data?.type,
        failure_labels: classifyFailure(AGENT_EVAL_EVENTS.MANUAL_CORRECTION, { correction_type: 'node_remove' }),
      })
    }
    await handleDeleteNodes([nodeId])
  }, [handleDeleteNodes, buildMachine.state, builder?.nodes])

  // Handle node rename
  const handleNodeRename = useCallback(async (nodeId: string, newTitle: string) => {
    if (!actions || !builder) return

    const currentNodes = builder.nodes
    const updatedNodes = currentNodes.map((node: any) =>
      node.id === nodeId
        ? { ...node, data: { ...node.data, title: newTitle } }
        : node
    )

    // Optimistically update UI
    builder.setNodes(updatedNodes)

    try {
      // Persist the rename to backend
      await actions.applyEdits([{
        op: "updateNode",
        nodeId,
        updates: { title: newTitle }
      }])
    } catch (error: any) {
      // Rollback on error
      builder.setNodes(currentNodes)
      toast({
        title: "Failed to rename node",
        description: error?.message ?? "Unable to rename node",
        variant: "destructive",
      })
    }
  }, [actions, builder, toast])

  // Handle changing a node's type (opens integrations panel to select new type)
  const handleChangeNode = useCallback((nodeId: string) => {
    if (!builder?.nodes) return

    const node = builder.nodes.find((n: any) => n.id === nodeId)
    if (!node) return

    // Agent eval: track node swap as manual correction
    if (buildMachine.state !== BuildState.IDLE) {
      agentEvalTracker.trackEvent(AGENT_EVAL_EVENTS.MANUAL_CORRECTION, {
        node_id: nodeId,
        correction_type: 'node_swap',
        severity: 'major',
        node_type: node?.data?.type,
        failure_labels: classifyFailure(AGENT_EVAL_EVENTS.MANUAL_CORRECTION, { correction_type: 'node_swap' }),
      })
    }

    // Determine if this is a trigger or action
    const nodeComponent = ALL_NODE_COMPONENTS.find(c => c.type === node.data?.type)
    const isTrigger = node.data?.isTrigger || nodeComponent?.isTrigger

    // Store the node ID we're changing (so when user selects from panel, we know to replace)
    setChangingNodeId(nodeId)
    setSelectedNodeId(null)
    setAddingAfterNodeId(null)
    setConfiguringNode(null)

    // Open integrations panel with correct mode
    openIntegrationsPanel(isTrigger ? 'trigger' : 'action')

    logger.debug(`[WorkflowBuilder] Opening integrations panel to change ${isTrigger ? 'trigger' : 'action'} node:`, nodeId)
  }, [builder?.nodes, openIntegrationsPanel])

  const handleBackToIntegrations = useCallback(() => {
    if (!configuringNode) return
    const node = configuringNode
    const nodeComponent = ALL_NODE_COMPONENTS.find(c => c.type === node.data?.type)
    const isTrigger = node.data?.isTrigger || nodeComponent?.isTrigger

    setChangingNodeId(node.id)
    setSelectedNodeId(null)
    setAddingAfterNodeId(null)
    setConfiguringNode(null)

    openIntegrationsPanel(isTrigger ? 'trigger' : 'action')
  }, [configuringNode, openIntegrationsPanel])

  // Handle node duplication
  const handleNodeDuplicate = useCallback(async (nodeId: string) => {
    if (!actions || !builder) return

    const currentNodes = builder.nodes
    const currentEdges = builder.edges

    // Find the node to duplicate
    const nodeToDuplicate = currentNodes.find((n: any) => n.id === nodeId)
    if (!nodeToDuplicate) {
      toast({
        title: "Cannot duplicate node",
        description: "Node not found",
        variant: "destructive",
      })
      return
    }

    // Generate a temporary ID for the duplicate
    const tempId = `node-${Date.now()}`

    // Use same X position as the original node to maintain alignment
    const newPosition = {
      x: nodeToDuplicate.position.x,
      y: nodeToDuplicate.position.y + LINEAR_NODE_VERTICAL_GAP,
    }

    // Create duplicate with "(Copy)" suffix
    const originalTitle = nodeToDuplicate.data?.title || 'Node'
    const duplicateTitle = `${originalTitle} (Copy)`

    // Create optimistic duplicate node
    const duplicateNode = {
      ...nodeToDuplicate,
      id: tempId,
      position: newPosition,
      data: {
        ...nodeToDuplicate.data,
        title: duplicateTitle,
        _optimistic: true,
      },
    }

    // Update UI optimistically
    const updatedNodes = [...currentNodes, duplicateNode]
    builder.setNodes(updatedNodes)

    try {
      // Add the node to backend
      // Note: actions.addNode returns a string (the node ID), not an object
      const newNodeId = await actions.addNode(nodeToDuplicate.data?.type, newPosition)

      if (newNodeId) {
        // Update with real ID from backend
        const finalNodes = builder.nodes.map((n: any) =>
          n.id === tempId
            ? { ...n, id: newNodeId, data: { ...n.data, _optimistic: false } }
            : n
        )
        builder.setNodes(finalNodes)

        // Apply configuration if the original node had config
        if (nodeToDuplicate.data?.config && Object.keys(nodeToDuplicate.data.config).length > 0) {
          await actions.updateConfig(newNodeId, nodeToDuplicate.data.config)
        }

        // Apply the title
        await actions.applyEdits([{
          op: "updateNode",
          nodeId: newNodeId,
          updates: { title: duplicateTitle }
        }])

        toast({
          title: "Node duplicated",
          description: `Created duplicate: ${duplicateTitle}`,
        })
      }
    } catch (error: any) {
      // Rollback on error
      builder.setNodes(currentNodes)
      builder.setEdges(currentEdges)
      toast({
        title: "Failed to duplicate node",
        description: error?.message ?? "Unable to duplicate node",
        variant: "destructive",
      })
    }
  }, [actions, builder, toast])

  // Handle add note to node
  const handleAddNote = useCallback(async (nodeId: string) => {
    if (!actions || !builder) return

    const currentNodes = builder.nodes
    const node = currentNodes.find((n: any) => n.id === nodeId)

    if (!node) {
      toast({
        title: "Cannot add note",
        description: "Node not found",
        variant: "destructive",
      })
      return
    }

    // Prompt for note text
    const currentNote = node.data?.note || ''
    const noteText = prompt(
      currentNote ? 'Edit note:' : 'Add a note to this node:',
      currentNote
    )

    // If user cancelled or entered empty string, don't update
    if (noteText === null) return

    // Update node with note
    const updatedNodes = currentNodes.map((n: any) =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, note: noteText.trim() || undefined } }
        : n
    )

    // Optimistically update UI
    builder.setNodes(updatedNodes)

    try {
      // Persist the note to backend
      await actions.applyEdits([{
        op: "updateNode",
        nodeId,
        updates: { note: noteText.trim() || null }
      }])

      if (noteText.trim()) {
        toast({
          title: "Note added",
          description: "Node note has been saved",
        })
      } else {
        toast({
          title: "Note removed",
          description: "Node note has been cleared",
        })
      }
    } catch (error: any) {
      // Rollback on error
      builder.setNodes(currentNodes)
      toast({
        title: "Failed to save note",
        description: error?.message ?? "Unable to save node note",
        variant: "destructive",
      })
    }
  }, [actions, builder, toast])

  // Handle node configuration (click or manual trigger)
  const handleNodeConfigure = useCallback(async (nodeId: string) => {
    // Toggle behavior: if clicking the same node that's already being configured, close it
    if (configuringNode?.id === nodeId) {
      setConfiguringNode(null)
      return
    }

    const node = reactFlowProps?.nodes?.find((n: any) => n.id === nodeId)
    if (node) {
      logger.debug('🔧 [WorkflowBuilder] Opening configuration for node:', nodeId, node)

      // Check if this is a placeholder node
      if (node.data?.isPlaceholder) {
        logger.debug('📌 [WorkflowBuilder] Placeholder node clicked, opening integrations panel')

        // Check if this is the first node in the workflow (trigger position)
        // First node has no incoming edges
        const isFirstNode = !reactFlowProps?.edges?.some((edge: any) => edge.target === nodeId)

        // First node always opens trigger menu, all others open action menu
        const mode = isFirstNode ? 'trigger' : 'action'

        // Open integrations panel with the correct mode
        openIntegrationsPanel(mode)
        // Store which placeholder we're replacing
        setSelectedNodeId(nodeId)
        return
      }

      // For regular (configured) nodes, open their configuration modal
      // Prefetch config data before opening modal for instant UX
      // Note: node type can be in node.data.type, node.data.nodeType, or extracted from node id
      const nodeType = node.data?.type || node.data?.nodeType || nodeId.split('-')[0]
      const nodeInfo = getNodeByType(nodeType)

      logger.debug('🔧 [WorkflowBuilder] Looking up node info:', { nodeType, found: !!nodeInfo, configSchemaLength: nodeInfo?.configSchema?.length })

      if (nodeInfo && nodeInfo.configSchema && nodeInfo.configSchema.length > 0) {
        logger.debug('🚀 [WorkflowBuilder] Prefetching config data for:', nodeType)
        // Don't await - let it load in parallel with modal opening
        prefetchNodeConfig(
          nodeType,
          nodeInfo.providerId || '',
          nodeInfo.configSchema
        ).catch(err => {
          logger.warn('⚠️ [WorkflowBuilder] Prefetch failed (non-critical):', err)
        })
      }

      // Close integrations panel when opening configuration modal
      setIsIntegrationsPanelOpen(false)

      setConfiguringNode(node)
    } else {
      logger.warn('🔧 [WorkflowBuilder] Node not found in reactFlowProps for configuration:', nodeId, 'total nodes:', reactFlowProps?.nodes?.length)
      // Graceful fallback: never silently swallow clicks - tell the user something happened
      toast({
        title: "Couldn't open configuration",
        description: "Please try clicking the node again.",
        variant: "destructive"
      })
    }
  }, [reactFlowProps?.nodes, reactFlowProps?.edges, prefetchNodeConfig, openIntegrationsPanel, setSelectedNodeId, configuringNode, toast])

  // Handle saving node configuration
  const handleSaveNodeConfig = useCallback(async (nodeId: string, config: Record<string, any>) => {
    logger.debug('💾 [WorkflowBuilder] Saving configuration for node:', nodeId, config)
    logger.debug('💾 [WorkflowBuilder] __validationState in config:', config.__validationState)

    if (!actions || !builder) {
      logger.warn('💾 [WorkflowBuilder] No actions or builder available to save config')
      return
    }

    try {
      // INSTANT UPDATE: Update the config in localStorage immediately for instant reopen
      if (typeof window !== 'undefined' && flowId) {
        const cacheKey = `workflow_${flowId}_node_${nodeId}_config`;
        const stored = safeLocalStorageSet(cacheKey, {
          config: config,
          timestamp: Date.now()
        });
        if (stored) {
          logger.debug('💾 [WorkflowBuilder] Cached config locally for instant reopen');
        }
      }

      // INSTANT VALIDATION UPDATE: Update node data immediately with validation state
      // This ensures the incomplete badge is removed instantly before the debounced API call
      const currentNodes = builder.nodes || []
      const updatedNodes = currentNodes.map((node: any) => {
        if (node.id === nodeId) {
          return {
            ...node,
            data: {
              ...node.data,
              config,
              validationState: config.__validationState,
              // Clear needsSetup if validation is now complete
              needsSetup: config.__validationState?.isValid === false || (config.__validationState?.missingRequired?.length ?? 0) > 0
            }
          }
        }
        return node
      })
      builder.setNodes(updatedNodes)
      logger.debug('✅ [WorkflowBuilder] Updated node validation state instantly')

      // Update the node with the new config (debounced 600ms for API persistence)
      actions.updateConfig(nodeId, config)
    } catch (error: any) {
      logger.error('💾 [WorkflowBuilder] Error saving config:', error)
      toast({
        title: "Failed to save configuration",
        description: error?.message ?? "Unable to save node configuration",
        variant: "destructive",
      })
    }
  }, [actions, builder, toast, flowId])

  // Validation: Check if workflow has placeholders
  const hasPlaceholders = useCallback(() => {
    if (!builder?.nodes) return false
    return builder.nodes.some((n: any) => n.data?.isPlaceholder)
  }, [builder?.nodes])

  // Handle workflow activation with placeholder validation
  const handleToggleLiveWithValidation = useCallback(async () => {
    // Check for placeholders - button should be disabled, but just in case
    if (hasPlaceholders()) {
      return
    }

    const isCurrentlyActive = flowState?.workflowStatus === 'active'

    if (isCurrentlyActive) {
      // Deactivate workflow
      const result = await actions?.deactivateWorkflow()
      toast({
        title: result?.success ? "Workflow Deactivated" : "Deactivation Failed",
        description: result?.message || (result?.success
          ? "Your workflow has been deactivated."
          : "Please try again."),
        variant: result?.success ? "default" : "destructive",
      })
    } else {
      // Validate node configurations before activation
      if (builder?.nodes) {
        const workflowForValidation = {
          id: flowId || '',
          name: '',
          nodes: builder.nodes as any,
          connections: [],
        } as any

        const validationResult = validateWorkflowNodes(workflowForValidation, ALL_NODE_COMPONENTS)

        if (validationResult.invalidNodeIds.length > 0) {
          // Build descriptive error messages from the validation result
          const invalidNodeNames = validationResult.nodes
            .filter(n => validationResult.invalidNodeIds.includes(n.id))
            .map(n => {
              const title = n.data?.title || n.data?.label || n.data?.type || 'Unknown node'
              const missing = n.data?.validationState?.missingRequired || []
              return missing.length > 0
                ? `${title} (missing: ${missing.join(', ')})`
                : title
            })

          toast({
            title: "Cannot publish workflow",
            description: `${invalidNodeNames.length} node${invalidNodeNames.length > 1 ? 's have' : ' has'} missing required fields: ${invalidNodeNames.join('; ')}`,
            variant: "destructive",
          })
          return
        }
      }

      // Show activation review dialog before activating
      setShowActivationReview(true)
    }
  }, [hasPlaceholders, flowState?.workflowStatus, actions, toast, builder?.nodes, flowId])

  // Handle confirmed activation after review dialog approval
  const handleConfirmActivation = useCallback(async () => {
    setIsActivatingAfterReview(true)
    // Agent eval: track activation attempt
    agentEvalTracker.trackEvent(AGENT_EVAL_EVENTS.ACTIVATION_ATTEMPTED, {
      trigger_count: builder?.nodes?.filter((n: any) => n.data?.nodeType === 'trigger').length || 0,
      action_count: builder?.nodes?.filter((n: any) => n.data?.nodeType === 'action').length || 0,
    })
    try {
      const result = await actions?.activateWorkflow()
      // Agent eval: track activation outcome
      if (result?.success) {
        agentEvalTracker.setSessionOutcome('activated')
        agentEvalTracker.trackEvent(AGENT_EVAL_EVENTS.ACTIVATION_SUCCEEDED, {
          turns_to_success: agentEvalTracker.getConversationId() ? undefined : undefined,
        })
      } else {
        agentEvalTracker.setSessionOutcome('blocked')
        agentEvalTracker.trackEvent(AGENT_EVAL_EVENTS.ACTIVATION_BLOCKED, {
          reasons: [result?.message || 'unknown'],
        })
      }
      setShowActivationReview(false)
      toast({
        title: result?.success ? "Workflow Published" : "Activation Failed",
        description: result?.message || (result?.success
          ? "Your workflow is now active!"
          : "Please try again."),
        variant: result?.success ? "default" : "destructive",
      })
    } catch (error: any) {
      toast({
        title: "Activation Failed",
        description: error?.message || "Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsActivatingAfterReview(false)
    }
  }, [actions, toast])

  // Get test store actions
  const {
    testFlowStatus,
    listeningTimeRemaining,
    interceptedActions,
    startListening,
    updateListeningTime,
    startExecution,
    setNodeCompleted,
    setNodeFailed,
    addInterceptedAction,
    finishTestFlow,
    cancelTestFlow,
    resetTestFlow,
    // NEW: Enhanced node execution methods
    setNodeRunning,
    setNodePaused,
    setNodeCompletedWithDetails,
    setNodeFailedWithDetails,
  } = useWorkflowTestStore()

  // Stop execution polling
  const stopExecutionPolling = useCallback(() => {
    if (executionPollIntervalRef.current) {
      clearInterval(executionPollIntervalRef.current)
      executionPollIntervalRef.current = null
    }
    pausedExecutionIdRef.current = null
    lastSyncedProgressRef.current = { currentNodeId: null, completedNodes: [] }
  }, [])

  // Start polling for execution status (after HITL pause resumes via external webhook)
  const startExecutionPolling = useCallback((executionId: string) => {
    if (executionPollIntervalRef.current) return // Already polling

    logger.debug('[POLL] Starting execution polling for:', executionId)

    const pollExecution = async () => {
      try {
        const response = await fetch(`/api/workflows/${flowId}/execution-status/${executionId}`)
        if (!response.ok) {
          logger.debug('[POLL] Response not ok:', response.status)
          return
        }

        const data = await response.json()
        const progress = data.progress
        logger.debug('[POLL] Got progress:', progress)

        if (!progress) return

        // Sync with workflow test store for node visual states
        const lastSynced = lastSyncedProgressRef.current

        // Sync current running/paused node
        if (progress.currentNodeId && progress.currentNodeId !== lastSynced.currentNodeId) {
          if (progress.status === 'paused') {
            logger.debug('[POLL] Setting node paused:', progress.currentNodeId)
            setNodePaused(progress.currentNodeId, undefined, progress.currentNodeName)
          } else {
            logger.debug('[POLL] Setting node running:', progress.currentNodeId)
            setNodeRunning(progress.currentNodeId, undefined, progress.currentNodeName)
          }
          lastSyncedProgressRef.current.currentNodeId = progress.currentNodeId
        } else if (progress.status === 'paused' && progress.currentNodeId) {
          // If status changed to paused for the same node, update it
          setNodePaused(progress.currentNodeId, undefined, progress.currentNodeName)
        }

        // Sync completed nodes
        if (progress.completedNodes) {
          const newlyCompleted = progress.completedNodes.filter(
            (nodeId: string) => !lastSynced.completedNodes.includes(nodeId)
          )
          const nodeOutputs = progress.nodeOutputs || {}
          newlyCompleted.forEach((nodeId: string) => {
            const nodeOutput = nodeOutputs[nodeId] || {}
            // Get execution time from output - could be 'duration' (HITL) or 'executionTime' or from metadata
            const executionTimeMs = nodeOutput.metadata?.executionTime ||
                                    (nodeOutput.duration ? nodeOutput.duration * 1000 : 0) ||
                                    nodeOutput.executionTime ||
                                    0
            const preview = nodeOutput.conversationSummary ||
                           nodeOutput.message ||
                           nodeOutput.preview ||
                           'Completed'
            logger.debug('[POLL] Setting node completed:', nodeId, { executionTimeMs, preview })
            setNodeCompletedWithDetails(nodeId, nodeOutput, preview, executionTimeMs)
          })
          lastSyncedProgressRef.current.completedNodes = [...progress.completedNodes]
        }

        // Sync failed nodes
        if (progress.failedNodes) {
          const nodeOutputs = progress.nodeOutputs || {}
          progress.failedNodes.forEach((failed: { nodeId: string; error: string }) => {
            const nodeOutput = nodeOutputs[failed.nodeId] || {}
            const executionTimeMs = nodeOutput.metadata?.executionTime || 0
            logger.debug('[POLL] Setting node failed:', failed.nodeId)
            setNodeFailedWithDetails(failed.nodeId, failed.error, executionTimeMs)
          })
        }

        // Check if execution completed or failed
        if (progress.status === 'completed' || progress.status === 'failed') {
          logger.debug('[POLL] Execution finished:', progress.status)
          stopExecutionPolling()
          finishTestFlow(progress.status === 'completed' ? 'completed' : 'error', progress.errorMessage)
          toast({
            title: progress.status === 'completed' ? 'Workflow completed' : 'Workflow failed',
            description: progress.errorMessage || (progress.status === 'completed' ? 'All steps executed successfully' : 'An error occurred'),
            variant: progress.status === 'completed' ? 'default' : 'destructive'
          })
        }
        // Note: Don't stop polling when paused - we want to detect when it resumes
      } catch (error) {
        logger.error('[POLL] Error polling execution status:', error)
      }
    }

    // Poll immediately and then every 1 second
    pollExecution()
    executionPollIntervalRef.current = setInterval(pollExecution, 1000)
  }, [flowId, setNodeRunning, setNodePaused, setNodeCompletedWithDetails, setNodeFailedWithDetails, finishTestFlow, toast])

  // Get trigger type for the TestModeDialog
  const triggerNode = builder?.nodes?.find((n: any) => isTriggerNode(n))
  const triggerType = triggerNode?.data?.type

  // Handler to open the Test Mode Dialog
  const handleOpenTestDialog = useCallback(() => {
    if (!builder?.nodes || hasPlaceholders()) {
      toast({
        title: "Cannot test",
        description: "Please configure all nodes before testing.",
        variant: "destructive",
      })
      return
    }

    // Check for disconnected integrations
    const currentIntegrations = useIntegrationStore.getState().integrations
    const disconnected = getDisconnectedIntegrations(builder.nodes, currentIntegrations)

    if (disconnected.length > 0) {
      // Show the disconnected integrations dialog first
      setDisconnectedIntegrations(disconnected)
      setIsDisconnectedDialogOpen(true)
      return
    }

    // All integrations connected, open test dialog
    setIsTestModeDialogOpen(true)
  }, [builder?.nodes, hasPlaceholders, toast])

  // Check if workflow has a published revision (required for API key generation)
  const hasPublishedRevision = Boolean(flowState?.revisionId)

  // Handler to generate API key for published workflow
  const handleGenerateApiKey = useCallback(() => {
    toast({
      title: "API Key",
      description: "API key generation coming soon!",
    })
  }, [toast])

  // Inner handler - separated so cost confirm can re-invoke without looping
  const handleRunTestFromDialogInner = useCallback(async (config: TestModeConfig, mockVariation?: string) => {
    logger.debug('[TEST] handleRunTestFromDialog called', { config, mockVariation })

    if (!builder?.nodes) {
      logger.debug('[TEST] No builder nodes, returning early')
      return
    }

    // Create an abort controller for this test run
    if (testAbortControllerRef.current) {
      testAbortControllerRef.current.abort()
    }
    const abortController = new AbortController()
    testAbortControllerRef.current = abortController

    const nodes = builder.nodes
    const edges = builder.edges || []
    const triggerNode = nodes.find((n: any) => isTriggerNode(n))

    const isLiveMode = config.actionMode === ActionTestMode.EXECUTE_ALL
    const waitForTrigger = config.triggerMode === TriggerTestMode.WAIT_FOR_REAL

    // Store trigger data when received
    let triggerEventData: any = null
    let timerInterval: NodeJS.Timeout | null = null

    try {
      logger.debug('[TEST] Starting test execution', {
        waitForTrigger,
        hasTriggerNode: !!triggerNode,
        nodeCount: nodes.length,
      })

      if (!nodes.length) {
        toast({
          title: "Cannot test",
          description: "No nodes available to test yet.",
          variant: "destructive",
        })
        return
      }

      if (waitForTrigger && !triggerNode) {
        toast({
          title: "Cannot wait for trigger",
          description: "No trigger node found in the workflow.",
          variant: "destructive",
        })
        return
      }

      // If waiting for real trigger, start listening
      if (waitForTrigger && triggerNode) {
        logger.debug('[TEST] Waiting for real trigger')
        startListening(config)

        toast({
          title: isLiveMode ? "Live Mode" : "Test Mode",
          description: "Listening for trigger event... Perform the action to trigger your workflow.",
        })

        // Start countdown timer
        const startTime = Date.now()
        const timeout = config.triggerTimeout || 60000

        timerInterval = setInterval(() => {
          if (abortController.signal.aborted) {
            if (timerInterval) clearInterval(timerInterval)
            return
          }
          const elapsed = Date.now() - startTime
          const remaining = Math.max(0, Math.ceil((timeout - elapsed) / 1000))
          updateListeningTime(remaining)

          if (remaining <= 0) {
            if (timerInterval) clearInterval(timerInterval)
          }
        }, 1000)

        // Call the test-trigger API with abort signal
        const triggerResponse = await fetch('/api/workflows/test-trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflowId: flowId,
            nodeId: triggerNode.id,
            nodes: builder?.nodes,
            connections: builder?.edges,
          }),
          signal: abortController.signal,
        })

        if (timerInterval) clearInterval(timerInterval)

        // Check if aborted
        if (abortController.signal.aborted) {
          logger.debug('[TEST] Test was aborted')
          return
        }

        logger.debug('[TEST] Trigger API response status:', triggerResponse.status)

        if (!triggerResponse.ok) {
          throw new Error('Failed to activate trigger')
        }

        const triggerResult = await triggerResponse.json()
        logger.debug('[TEST] Trigger result:', triggerResult)

        if (!triggerResult.testSessionId) {
          throw new Error('Missing test session ID')
        }

        testSessionIdRef.current = triggerResult.testSessionId

        // Restart the countdown timer for the streaming phase (actual waiting for trigger)
        // The previous interval was cleared after the first API call, so we need a fresh timer
        const streamStartTime = Date.now()
        timerInterval = setInterval(() => {
          if (abortController.signal.aborted) {
            if (timerInterval) clearInterval(timerInterval)
            return
          }
          const elapsed = Date.now() - streamStartTime
          const remaining = Math.max(0, Math.ceil((timeout - elapsed) / 1000))
          updateListeningTime(remaining)

          if (remaining <= 0) {
            if (timerInterval) clearInterval(timerInterval)
          }
        }, 1000)

        const streamUrl = `/api/workflows/test-trigger/stream?sessionId=${encodeURIComponent(triggerResult.testSessionId)}&workflowId=${encodeURIComponent(flowId)}&timeoutMs=${timeout}`
        const streamResponse = await fetch(streamUrl, { signal: abortController.signal })

        if (!streamResponse.ok) {
          throw new Error('Failed to open trigger stream')
        }

        const reader = streamResponse.body?.getReader()
        const decoder = new TextDecoder()

        if (!reader) {
          throw new Error('No trigger stream available')
        }

        let buffer = ''
        let triggerReceived = false

        while (true) {
          if (abortController.signal.aborted) {
            reader.cancel()
            break
          }

          const { done, value } = await reader.read()
          if (done) {
            break
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6))
              logger.debug('[TEST] Trigger stream event:', event)

              if (event.type === 'trigger_received') {
                triggerEventData = event.data
                triggerReceived = true
                break
              }

              if (event.type === 'timeout') {
                // Clean up the timer interval
                if (timerInterval) {
                  clearInterval(timerInterval)
                  timerInterval = null
                }
                if (isMountedRef.current) {
                  finishTestFlow('cancelled', 'No event received within timeout')
                  cleanupTestTrigger()
                  toast({
                    title: "Timeout",
                    description: "No trigger event received. Try again or use mock data.",
                    variant: "destructive",
                  })
                }
                return
              }

              if (event.type === 'error') {
                throw new Error(event.message || 'Trigger stream error')
              }
            } catch (parseError) {
              logger.debug('[TEST] Trigger stream parse error:', parseError, 'Line:', line)
            }
          }

          if (triggerReceived) {
            break
          }
        }

        // Clean up the timer now that trigger listening is done
        if (timerInterval) {
          clearInterval(timerInterval)
          timerInterval = null
        }

        if (!triggerReceived) {
          return
        }

        logger.debug('[SSE] Trigger event received:', { triggerEventData, testSessionId: triggerResult.testSessionId })

        if (isMountedRef.current) {
          toast({
            title: "Trigger received!",
            description: "Executing workflow...",
          })
        }
      }

      // Check if aborted before continuing
      if (abortController.signal.aborted) {
        logger.debug('[TEST] Test was aborted before SSE execution')
        return
      }

      logger.debug('[SSE] Starting workflow execution phase')

      // Execute the workflow with SSE streaming for real-time updates
      setIsFlowTesting(true)

      // Reset test flow state for execution phase
      resetTestFlow()

      logger.debug('[SSE] Starting SSE execution stream', {
        workflowId: flowId,
        hasTriggerData: !!triggerEventData,
        skipTrigger: !waitForTrigger
      })

      const response = await fetch('/api/workflows/execute-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: flowId,
          nodes: builder?.nodes,
          connections: builder?.edges,
          inputData: {
            trigger: triggerEventData,
            ...(triggerEventData || {})
          },
          options: {
            testMode: !isLiveMode,
            skipTrigger: !waitForTrigger,
            mockVariation,
          }
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.debug('[SSE] Response not OK:', response.status, errorText)
        throw new Error(`Workflow execution failed: ${response.status}`)
      }

      logger.debug('[SSE] Response received, status:', response.status)

      // Read SSE stream for real-time node updates
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        logger.debug('[SSE] No reader available')
        throw new Error('No response stream available')
      }

      logger.debug('[SSE] Starting to read stream...')
      let buffer = ''

      while (true) {
        // Check if aborted
        if (abortController.signal.aborted) {
          logger.debug('[SSE] Stream reading aborted')
          reader.cancel()
          break
        }

        const { done, value } = await reader.read()

        if (done) {
          logger.debug('[SSE] Stream done')
          break
        }

        const chunk = decoder.decode(value, { stream: true })
        logger.debug('[SSE] Received chunk:', chunk.length, 'chars')
        buffer += chunk

        // Parse SSE events from buffer
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6))
              logger.debug('[SSE] Event received:', event)

              switch (event.type) {
                case 'workflow_started':
                  logger.debug('[SSE] Workflow started, executionId:', event.executionId)
                  // Store executionId for potential polling after HITL pause
                  pausedExecutionIdRef.current = event.executionId
                  break

                case 'node_started':
                  logger.debug('[SSE] Setting node running:', event.nodeId)
                  setNodeRunning(
                    event.nodeId,
                    event.nodeType,
                    event.nodeTitle,
                    event.preview
                  )
                  break

                case 'node_completed':
                  logger.debug('[SSE] Setting node completed:', event.nodeId)
                  setNodeCompletedWithDetails(
                    event.nodeId,
                    event.output,
                    event.preview || 'Completed',
                    event.executionTime || 0,
                    event.nodeType,
                    event.nodeTitle
                  )
                  break

                case 'node_failed':
                  logger.debug('[SSE] Setting node failed:', event.nodeId, event.error)
                  setNodeFailedWithDetails(
                    event.nodeId,
                    event.error || 'Unknown error',
                    event.executionTime || 0,
                    event.nodeType,
                    event.nodeTitle
                  )
                  break

                case 'node_paused':
                  logger.debug('[SSE] Setting node paused:', event.nodeId)
                  setNodePaused(
                    event.nodeId,
                    event.nodeType,
                    event.nodeTitle,
                    event.preview || 'Waiting for human input...'
                  )
                  break

                case 'workflow_paused':
                  logger.debug('[SSE] Workflow paused at:', event.pausedAt)
                  // Note: setNodePaused already sets testFlowStatus to 'paused'
                  // Show toast notification
                  toast({
                    title: "Workflow paused",
                    description: event.reason || "Waiting for human input...",
                  })
                  // Start polling for execution status to detect when workflow resumes
                  if (pausedExecutionIdRef.current) {
                    logger.debug('[SSE] Starting polling for resumed execution:', pausedExecutionIdRef.current)
                    startExecutionPolling(pausedExecutionIdRef.current)
                  }
                  break

                case 'workflow_completed':
                  logger.debug('[SSE] Workflow completed')
                  stopExecutionPolling() // Stop polling if it was running
                  finishTestFlow('completed')
                  // Deactivate the test webhook now that workflow is complete
                  cleanupTestTrigger()
                  toast({
                    title: isLiveMode ? "Workflow executed" : "Test completed",
                    description: "Workflow executed successfully.",
                  })
                  break

                case 'workflow_failed':
                  logger.debug('[SSE] Workflow failed:', event.error)
                  stopExecutionPolling() // Stop polling if it was running
                  finishTestFlow('error', event.error)
                  // Deactivate the test webhook even on failure
                  cleanupTestTrigger()
                  toast({
                    title: "Execution failed",
                    description: event.error || "Workflow execution failed",
                    variant: "destructive",
                  })
                  break

                default:
                  logger.debug('[SSE] Unknown event type:', event.type)
              }
            } catch (parseError) {
              logger.debug('[SSE] Parse error:', parseError, 'Line:', line)
            }
          }
        }
      }

    } catch (error: any) {
      // Don't show error for aborted requests
      if (error.name === 'AbortError' || abortController.signal.aborted) {
        logger.debug('[TEST] Test was aborted')
        return
      }
      logger.debug('[TEST] Error in test execution:', error)
      if (isMountedRef.current) {
        finishTestFlow('error', error.message)
        toast({
          title: "Execution failed",
          description: error.message || "Failed to execute workflow",
          variant: "destructive",
        })
      }
    } finally {
      // Clean up timer if it's still running
      if (timerInterval) {
        clearInterval(timerInterval)
      }
      if (isMountedRef.current) {
        setIsFlowTesting(false)
      }
    }
  }, [builder?.nodes, builder?.edges, flowId, toast, startListening, updateListeningTime, finishTestFlow, resetTestFlow, setNodeRunning, setNodeCompletedWithDetails, setNodeFailedWithDetails, cleanupTestTrigger])

  // Handle test workflow - run from start to finish
  const handleTestWorkflow = useCallback(async () => {
    if (!builder?.nodes || hasPlaceholders()) {
      return
    }

    const nodes = builder.nodes
    const triggerNode = nodes.find((n: any) => isTriggerNode(n))
    const hasTrigger = Boolean(triggerNode)

    // If there's a trigger, ask user if they want to include it
    let includeTrigger = false
    if (hasTrigger) {
      const userChoice = window.confirm(
        "Do you want to test the trigger?\n\n" +
        "• Yes: Wait for trigger event (webhook/scheduled)\n" +
        "• No: Skip trigger and test actions only"
      )
      includeTrigger = userChoice
    }

    try {
      // Find the first action node if we're skipping trigger
      let startNodeId: string | undefined
      if (!includeTrigger && hasTrigger) {
        const firstActionNode = nodes.find((n: any) =>
          !n.data?.isPlaceholder && n.data?.nodeType && !n.data?.isTrigger
        )

        if (!firstActionNode) {
          toast({
            title: "No action nodes",
            description: "Add at least one action node to test the workflow.",
            variant: "destructive",
          })
          return
        }
        startNodeId = firstActionNode.id
      }

      // Set all nodes to running state
      const updatedNodes = nodes.map((n: any) => ({
        ...n,
        data: {
          ...n.data,
          state: 'running',
        }
      }))
      builder.setNodes(updatedNodes)

      const testingMessage = includeTrigger
        ? "Waiting for trigger event..."
        : "Testing workflow actions..."

      toast({
        title: "Testing workflow",
        description: testingMessage,
      })

      // If testing with trigger, we need to register webhook/wait for event
      let triggerData = {}
      if (includeTrigger && triggerNode) {
        try {
          // Call test-trigger API to activate trigger and wait for event
          const triggerResponse = await fetch('/api/workflows/test-trigger', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              workflowId: flowId,
              nodeId: triggerNode.id,
              nodes: builder?.nodes, // Pass nodes for unsaved workflows
              connections: builder?.edges, // Pass edges/connections for unsaved workflows
            }),
          })

          if (!triggerResponse.ok) {
            throw new Error(`Trigger test failed: ${triggerResponse.statusText}`)
          }

          const triggerResult = await triggerResponse.json()

          if (!triggerResult.testSessionId) {
            throw new Error('Missing test session ID')
          }

          testSessionIdRef.current = triggerResult.testSessionId

          const streamUrl = `/api/workflows/test-trigger/stream?sessionId=${encodeURIComponent(triggerResult.testSessionId)}&workflowId=${encodeURIComponent(flowId)}&timeoutMs=60000`
          const streamResponse = await fetch(streamUrl)

          if (!streamResponse.ok) {
            throw new Error('Failed to open trigger stream')
          }

          const reader = streamResponse.body?.getReader()
          const decoder = new TextDecoder()

          if (!reader) {
            throw new Error('No trigger stream available')
          }

          let buffer = ''
          let triggerReceived = false

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              try {
                const event = JSON.parse(line.slice(6))
                logger.debug('[TEST] Trigger stream event:', event)

                if (event.type === 'trigger_received') {
                  triggerData = event.data
                  triggerReceived = true
                  break
                }

                if (event.type === 'timeout') {
                  break
                }

                if (event.type === 'error') {
                  throw new Error(event.message || 'Trigger stream error')
                }
              } catch (parseError) {
                logger.debug('[TEST] Trigger stream parse error:', parseError, 'Line:', line)
              }
            }

            if (triggerReceived) {
              break
            }
          }

          if (triggerReceived) {
            toast({
              title: "Trigger event received",
              description: "Now executing workflow with trigger data...",
            })
          } else {
            // Timeout - show webhook URL and give option to continue
            const shouldContinue = window.confirm(
              `No trigger event received within 60 seconds.\n\n` +
              `Webhook URL: ${triggerResult.webhookUrl || 'N/A'}\n\n` +
              `Do you want to continue testing without trigger data?`
            )

            cleanupTestTrigger()

            if (!shouldContinue) {
              // User cancelled - clear running states
              const clearedNodes = nodes.map((n: any) => ({
                ...n,
                data: {
                  ...n.data,
                  state: undefined,
                }
              }))
              builder.setNodes(clearedNodes)
              return
            }

            // User wants to continue - skip trigger
            const firstActionNode = nodes.find((n: any) =>
              !n.data?.isPlaceholder && n.data?.nodeType && !n.data?.isTrigger
            )
            if (firstActionNode) {
              startNodeId = firstActionNode.id
            }
          }
        } catch (error: any) {
          logger.error('Trigger test failed:', error)
          toast({
            title: "Trigger test failed",
            description: error.message || "Unable to test trigger. Testing actions only...",
            variant: "destructive",
          })

          // Fall back to testing without trigger
          const firstActionNode = nodes.find((n: any) =>
            !n.data?.isPlaceholder && n.data?.nodeType && !n.data?.isTrigger
          )
          if (firstActionNode) {
            startNodeId = firstActionNode.id
          }
        }
      }

      // Call the execute-advanced API
      const response = await fetch('/api/workflows/execute-advanced', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowId: flowId,
          inputData: triggerData, // Use trigger data if available, empty object otherwise
          options: {
            mode: 'test', // Test mode
            startNodeId, // undefined = start from trigger, nodeId = start from that node
          }
        }),
      })

      if (!response.ok) {
        throw new Error(`Test failed: ${response.statusText}`)
      }

      const result = await response.json()

      // Result structure: { success: true, sessionId, result: { mainResult: { nodeId: data, ... } } }
      const nodeResults = result.result?.mainResult || {}

      // Update nodes based on test results
      const finalNodes = nodes.map((n: any) => {
        // Find result for this node in the mainResult
        const nodeOutput = nodeResults[n.id]

        if (!nodeOutput) {
          return {
            ...n,
            data: {
              ...n.data,
              state: undefined, // Clear running state for nodes that didn't execute
            }
          }
        }

        // Node executed successfully if it has output
        const hasError = nodeOutput?.error || nodeOutput?.success === false

        return {
          ...n,
          data: {
            ...n.data,
            state: hasError ? 'failed' : 'passed',
            testResult: nodeOutput,
          }
        }
      })

      builder.setNodes(finalNodes)

      // Check if any nodes failed
      const failedNodes = finalNodes.filter((n: any) => n.data?.state === 'failed')

      if (failedNodes.length > 0) {
        toast({
          title: "Test completed with errors",
          description: `${failedNodes.length} node(s) failed during execution.`,
          variant: "destructive",
        })
      } else {
        toast({
          title: "Test completed",
          description: "Workflow executed successfully!",
        })
      }

    } catch (error: any) {
      logger.error('❌ [WorkflowBuilder] Test workflow error:', error)

      // Clear running states
      const clearedNodes = builder.nodes.map((n: any) => ({
        ...n,
        data: {
          ...n.data,
          state: undefined,
        }
      }))
      builder.setNodes(clearedNodes)

      toast({
        title: "Test failed",
        description: error?.message ?? "Unable to test workflow",
        variant: "destructive",
      })
    }
  }, [builder, cleanupTestTrigger, flowId, hasPlaceholders, toast])

  // Gating wrapper: intercepts live-run to show cost confirmation
  const handleRunTestFromDialog = useCallback((config: TestModeConfig, mockVariation?: string) => {
    setIsTestModeDialogOpen(false)
    const isLiveMode = config.actionMode === ActionTestMode.EXECUTE_ALL

    // Only gate live-mode runs; test mode is free
    if (isLiveMode && !shouldSkipCostConfirmation()) {
      setPendingTestConfig({ config, mockVariation })
      setIsCostConfirmOpen(true)
      return
    }

    // Test mode or user opted out - proceed directly
    handleRunTestFromDialogInner(config, mockVariation)
  }, [handleRunTestFromDialogInner])

  // Callback after cost confirmation: proceed with the pending test config
  const handleCostConfirmed = useCallback(() => {
    setIsCostConfirmOpen(false)
    const pending = pendingTestConfig
    if (pending) {
      setPendingTestConfig(null)
      handleRunTestFromDialogInner(pending.config, pending.mockVariation)
    }
  }, [pendingTestConfig, handleRunTestFromDialogInner])

  // Handler to stop flow testing
  const handleStopFlowTest = useCallback(() => {
    setIsFlowTesting(false)
    setFlowTestStatus(null)
    setIsFlowTestPaused(false)
    cancelTestFlow()
    // Deactivate the test webhook when user clicks stop
    cleanupTestTrigger()
    toast({
      title: "Test stopped",
      description: "Flow test has been stopped.",
    })
  }, [cancelTestFlow, cleanupTestTrigger, toast])

  // Handler to stop single node testing
  const handleStopNodeTest = useCallback(() => {
    setIsNodeTesting(false)
    setNodeTestingName(null)
    toast({
      title: "Test stopped",
      description: "Node test has been stopped.",
    })
  }, [toast])

  // Handler to pause flow testing
  const handlePauseFlowTest = useCallback(() => {
    setIsFlowTestPaused(true)
    toast({
      title: "Test paused",
      description: "Flow test has been paused.",
    })
  }, [toast])

  // Handler to resume flow testing
  const handleResumeFlowTest = useCallback(() => {
    setIsFlowTestPaused(false)
    toast({
      title: "Test resumed",
      description: "Flow test has been resumed.",
    })
  }, [toast])

  // Handler to stop live execution (placeholder - falls back to cancelTestFlow)
  const stopLiveExecutionHandler = undefined

  // Placeholder handlers (to be implemented)
  const comingSoon = useCallback(
    () =>
      toast({
        title: "Coming soon",
        description: "This action is not yet wired to the Flow v2 backend.",
      }),
    [toast]
  )

  const handleAgentSubmit = useCallback(async () => {
    if (!agentInput.trim()) return
    if (!actions) return

    const userPrompt = agentInput.trim()
    setAgentInput("")
    setIsAgentLoading(true)

    // Agent eval: track prompt submission
    const isFirstTurn = agentMessages.filter(m => m.role === 'user').length === 0
    if (isFirstTurn) {
      agentEvalTracker.startConversation()
    }
    const connectedProviders = integrations.filter(i => i.status === 'connected').map(i => i.provider)
    const promptType = classifyPromptComplexity(userPrompt.length, connectedProviders)
    agentEvalTracker.setPromptType(promptType)

    // Determine context type:
    // - 'auto+drafting': draftingContext exists with resolved decisions
    // - 'auto': existing workflow nodes provide implicit context (refinement)
    // - 'none': fresh prompt with no prior context
    const existingNodes = builder?.nodes?.length || 0
    let contextType: 'none' | 'manual' | 'auto' | 'auto+drafting' = 'none'
    if (draftingContext && draftingContext.resolved.length > 0) {
      contextType = 'auto+drafting'
    } else if (existingNodes > 0 || !isFirstTurn) {
      contextType = 'auto'
    }

    const contextRoles: string[] = []
    if (draftingContext) contextRoles.push('drafting_state')
    if (existingNodes > 0) contextRoles.push('existing_workflow')
    if (connectedProviders.length > 0) contextRoles.push('connected_integrations')

    agentEvalTracker.trackEvent(AGENT_EVAL_EVENTS.PROMPT_SUBMITTED, {
      prompt_length: userPrompt.length,
      context_type: contextType,
      context_node_count: existingNodes,
      context_roles: contextRoles,
      connected_integrations: connectedProviders,
      turn_number: agentMessages.filter(m => m.role === 'user').length + 1,
      prompt_text: agentEvalTracker.isSampled() ? userPrompt.substring(0, 500) : undefined,
    })

    const userLocalId = generateLocalId()
    const createdAtIso = new Date().toISOString()
    const localUserMessage: ChatMessage = {
      id: userLocalId,
      flowId,
      role: 'user',
      text: userPrompt,
      createdAt: createdAtIso,
    }

    // Generate unique request ID for tracking in-flight requests
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    setAgentMessages(prev => [...prev, localUserMessage])

    // Track this as a pending request (for recovery if page crashes)
    addPendingRequest({
      id: requestId,
      userMessage: userPrompt,
    })

    if (!chatPersistenceEnabled || !flowState?.flow) {
      enqueuePendingMessage({
        localId: userLocalId,
        role: 'user',
        text: userPrompt,
        createdAt: createdAtIso,
      })
    } else {
      ChatService.addUserPrompt(flowId, userPrompt)
        .then((saved) => {
          if (saved) {
            replaceMessageByLocalId(userLocalId, saved)
          }
        })
        .catch((error) => {
          logger.error("Failed to save user prompt:", error)
        })
    }

    // STEP 0: Check if user mentioned specific apps (e.g., "Gmail", "Outlook", "Slack")
    // If they did, we should NOT ask which provider to use for that category
    const specificApps = detectSpecificApps(userPrompt)

    // STEP 1: Check for ALL vague provider terms
    const allVagueTerms = detectAllVagueTerms(userPrompt)

    let finalPrompt = userPrompt
    // Collect ALL explicitly mentioned providers (not just the first one)
    const allProviderMetadata: Array<{ category: any; provider: any; allProviders: any[] }> = []

    // Filter out vague terms where user already specified a specific app
    const vagueTermsNeedingSelection: VagueTermDetection[] = []
    for (const vagueTermResult of allVagueTerms) {
      if (!vagueTermResult.category) continue

      // Check if user already specified an app for this category
      const matchingSpecificApp = specificApps.find(app => {
        const categoryMatch = app.category === vagueTermResult.category!.vagueTerm
        // Also check notification/chat categories which share providers
        const notificationCategories = ['notification', 'message', 'alert', 'chat']
        const isNotificationCategory = notificationCategories.includes(vagueTermResult.category!.vagueTerm)
        const appIsNotification = notificationCategories.includes(app.category)
        return categoryMatch || (isNotificationCategory && appIsNotification)
      })

      if (matchingSpecificApp) {
        // User mentioned a specific app - DON'T replace the vague term
        // The prompt is already correct (e.g., "send a message to Discord" should stay as-is)
        // We only need to collect metadata, not modify the prompt
        // Store metadata for ALL explicitly mentioned providers
        const freshIntegrations = useIntegrationStore.getState().integrations
        const providerOptions = getProviderOptions(
          vagueTermResult.category,
          freshIntegrations.map(i => ({ provider: i.provider, id: i.id, status: i.status }))
        )
        const selectedProvider = providerOptions.find(p => p.id === matchingSpecificApp.provider)

        if (selectedProvider) {
          allProviderMetadata.push({
            category: vagueTermResult.category,
            provider: selectedProvider,
            allProviders: providerOptions
          })
        }
      } else {
        // This term needs user selection
        vagueTermsNeedingSelection.push(vagueTermResult)
      }
    }

    // Also collect metadata for specific apps that were mentioned but didn't match any vague term
    // (e.g., "post to Slack" has no vague term like "notification" but Slack should still show with CHANGE option)
    const freshIntegrations = useIntegrationStore.getState().integrations
    for (const app of specificApps) {
      // Check if we already have metadata for this provider
      const alreadyHasMetadata = allProviderMetadata.some(m => m.provider?.id === app.provider)
      if (!alreadyHasMetadata) {
        // Find the category for this provider
        const category = PROVIDER_CATEGORIES.find(c => c.providers.includes(app.provider))
        if (category) {
          const providerOptions = getProviderOptions(
            category,
            freshIntegrations.map(i => ({ provider: i.provider, id: i.id, status: i.status }))
          )
          const selectedProvider = providerOptions.find(p => p.id === app.provider)
          if (selectedProvider) {
            allProviderMetadata.push({
              category,
              provider: selectedProvider,
              allProviders: providerOptions
            })
          }
        }
      }
    }

    // If there are vague terms that need selection, show provider dropdown
    if (vagueTermsNeedingSelection.length > 0) {
      const [firstTerm, ...remainingTerms] = vagueTermsNeedingSelection

      const freshIntegrations = useIntegrationStore.getState().integrations
      const providerOptions = getProviderOptions(
        firstTerm.category!,
        freshIntegrations.map(i => ({ provider: i.provider, id: i.id, status: i.status }))
      )
      const connectedProviders = providerOptions.filter(p => p.isConnected)

      // Set up multi-term disambiguation state
      setAwaitingProviderSelection(true)
      setPendingPrompt(finalPrompt) // Use modified prompt with any auto-resolved terms
      setProviderCategory(firstTerm.category)
      setPendingVagueTerms(remainingTerms) // Store remaining terms for later
      setProviderSelections(new Map()) // Reset selections
      setIsAgentLoading(false)

      // Add assistant message with provider dropdown
      const preSelectedProvider = connectedProviders.length > 0 ? connectedProviders[0] : null
      const localId = generateLocalId()
      const createdAt = new Date().toISOString()
      const dropdownMeta = {
        providerDropdown: {
          category: firstTerm.category,
          providers: providerOptions,
          preSelectedProviderId: preSelectedProvider?.id,
        },
        // Store state for restoration on refresh
        pendingPrompt: finalPrompt,
        remainingTerms: remainingTerms,
      }
      const dropdownMessage: ChatMessage = {
        id: localId,
        flowId,
        role: 'assistant',
        text: '',
        meta: dropdownMeta,
        createdAt,
        ephemeral: true,  // UI state only - should NOT be persisted to database
      }
      setAgentMessages(prev => [...prev, dropdownMessage])

      // Queue the ephemeral message - it will be skipped during persistence flush
      enqueuePendingMessage({
        localId,
        role: 'assistant',
        text: '',
        meta: dropdownMeta,
        createdAt,
        ephemeral: true,
      })
      return
    }

    // No vague terms needing selection - proceed with workflow generation
    // (finalPrompt may have auto-resolved specific apps like "Gmail" or "Slack")

    // Initialize or update drafting context with provider info from this turn
    const draftProviders: DraftingProviderMeta[] = allProviderMetadata.map(m => ({
      category: m.category?.vagueTerm || 'unknown',
      provider: m.provider?.id || '',
      providerName: m.provider?.label || m.provider?.id || '',
      isAutoSelected: false, // User explicitly mentioned these
    }))
    const updatedCtx = updateDraftingContext(draftingContext, {
      type: 'init',
      prompt: finalPrompt,
      providers: draftProviders,
    })
    setDraftingContext(updatedCtx)

    transitionTo(BuildState.THINKING)

    try {
      // For template matching, we need the EMAIL provider specifically (templates like email-to-slack require it)
      // Extract email provider from specificApps (not allProviderMetadata which might be notification/slack)
      const emailApp = specificApps.find(app => app.category === 'email')
      const emailProviderMeta = allProviderMetadata.find(m => m.category?.vagueTerm === 'email')
      const emailProviderId = emailApp?.provider || emailProviderMeta?.provider?.id

      // Mark request as processing before API call
      updatePendingRequest(requestId, { status: 'processing' })

      // Build conversation history from current messages for LLM context
      const conversationHistoryForLLM = agentMessages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.text, timestamp: m.createdAt || '' }))

      const { result, usedTemplate, promptId } = await runPlanningStages(
        transitionTo,
        () => planWorkflowWithTemplates(
          actions, finalPrompt, emailProviderId, user?.id, flowId,
          { draftingContext: updatedCtx, conversationHistory: conversationHistoryForLLM }
        )
      )

      // Request completed successfully - remove from pending
      completePendingRequest(requestId)

      // Use helper function to generate plan and update UI
      // Pass ALL explicitly mentioned providers so user can see/change them
      await continueWithPlanGeneration(result, finalPrompt, allProviderMetadata.length > 0 ? allProviderMetadata : undefined)

    } catch (error: any) {
      logger.error('[WorkflowBuilderV2] Error in handleSubmitUserMessage:', error)
      // Mark request as failed for potential retry
      updatePendingRequest(requestId, { status: 'failed' })

      toast({
        title: "Failed to create plan",
        description: error?.message || "Unable to generate workflow plan",
        variant: "destructive",
      })
      transitionTo(BuildState.IDLE)
      setIsAgentLoading(false)
    }
  }, [
    agentInput,
    actions,
    addPendingRequest,
    builder,
    chatPersistenceEnabled,
    completePendingRequest,
    continueWithPlanGeneration,
    enqueuePendingMessage,
    flowId,
    flowState?.flow,
    generateLocalId,
    integrations,
    replaceMessageByLocalId,
    toast,
    transitionTo,
    updatePendingRequest,
    user,
  ])

  const handleBuild = useCallback(async () => {
    if (!actions || !buildMachine.edits || buildMachine.state !== BuildState.PLAN_READY) return

    // Update drafting context: plan approved by user
    setDraftingContext(prev => updateDraftingContext(prev, { type: 'plan_approved' }))

    // Agent eval: track plan approval + build start
    agentEvalTracker.trackEvent(AGENT_EVAL_EVENTS.PLAN_APPROVED, {
      was_first_plan: true,
      turns_to_approve: 1,
    })
    agentEvalTracker.trackEvent(AGENT_EVAL_EVENTS.BUILD_STARTED, {
      node_count: buildMachine.plan.length,
    })

    try {
      transitionTo(BuildState.BUILDING_SKELETON)
      await persistOrQueueStatus("Building workflow...")

      // STEP 1: Create mapping of plan nodes to ReactFlow node IDs AND cache the nodes
      const addNodeEdits = buildMachine.edits.filter(e => e.op === 'addNode')
      const nodeMapping: Record<string, string> = {}
      const nodesCache: any[] = []
      addNodeEdits.forEach((edit, index) => {
        if (edit.op === 'addNode' && edit.node && buildMachine.plan[index]) {
          // Map planNode.id -> reactFlowNode.id
          nodeMapping[buildMachine.plan[index].id] = edit.node.id
          // Cache the actual node object
          nodesCache.push(edit.node)
          logger.debug(`[handleBuild] Mapped plan node "${buildMachine.plan[index].id}" -> ReactFlow node "${edit.node.id}"`)
        }
      })

      // Store mapping AND nodes cache in build machine
      setBuildMachine(prev => ({
        ...prev,
        nodeMapping,
        nodesCache,
      }))

      logger.debug('[handleBuild] Cached nodes count:', nodesCache.length)

      // STEP 2: Add nodes ONE AT A TIME with animation
      // Extract node edits (connect edges will be created sequentially)
      const nodeEdits = buildMachine.edits.filter((e: any) => e.op === 'addNode')

      logger.debug('[handleBuild] Adding', nodeEdits.length, 'nodes sequentially with animation')

      // STEP 3: Animate nodes appearing one by one
      setTimeout(async () => {
        if (!reactFlowInstanceRef.current || !builder?.setNodes || !builder?.setEdges) {
          logger.error('[handleBuild Animation] Missing required refs')
          return
        }

        // Clear canvas (including any placeholder nodes if present)
        builder.setNodes([])
        builder.setEdges([])

        // Positioning - VERTICAL layout matching placeholder node positions
        // Calculate centerX and centerY same as placeholder nodes do
        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080
        // Guard against NaN panel width
        const panelWidth = isFinite(agentPanelWidth) ? agentPanelWidth : 420
        const availableWidth = viewportWidth - panelWidth
        const centerX = panelWidth + (availableWidth / 2) - 180 // 180 = half of 360px node width
        const centerY = (viewportHeight / 2) - 150
        const V_SPACING = 180 // Vertical spacing between nodes (same as placeholders)

        // Validate calculated positions - use fallback if NaN
        const safeCenterX = isFinite(centerX) ? centerX : 600
        const safeCenterY = isFinite(centerY) ? centerY : 200

        logger.debug('[handleBuild] Node positioning (vertical layout like placeholders):', {
          agentPanelWidth,
          panelWidth,
          centerX: safeCenterX,
          centerY: safeCenterY,
          V_SPACING
        })

        // Create all nodes at once (simpler, more reliable)
        const allNodes = nodeEdits.map((nodeEdit, i) => {
          const plannerNode = nodeEdit.node
          const metadata = (plannerNode?.metadata ?? {}) as any
          const catalogNode = ALL_NODE_COMPONENTS.find(c => c.type === plannerNode.type)

          // Vertical layout: same X, increasing Y with 180px spacing
          const nodePosition = {
            x: safeCenterX,
            y: safeCenterY + (i * V_SPACING),
          }

          // Use catalog node's human-readable title, not the type with underscores
          const nodeTitle = catalogNode?.title ?? plannerNode.label ?? plannerNode.type

          return {
            id: plannerNode.id,
            type: 'custom',
            position: nodePosition,
            positionAbsolute: nodePosition, // Force absolute positioning
            selected: false,
            draggable: false, // Prevent any dragging/repositioning
            connectable: true,
            data: {
              label: nodeTitle,
              title: nodeTitle,
              type: plannerNode.type,
              config: { ...(plannerNode.config ?? {}), ...(nodeConfigs[plannerNode.id] ?? {}) },
              description: plannerNode.description ?? catalogNode?.description,
              providerId: metadata.providerId ?? catalogNode?.providerId,
              icon: catalogNode?.icon,
              isTrigger: metadata.isTrigger ?? catalogNode?.isTrigger ?? false,
              state: 'skeleton',
              aiStatus: 'skeleton',
              agentHighlights: metadata.agentHighlights ?? [],
              costHint: plannerNode.costHint ?? 0,
            },
            className: 'node-skeleton',
            style: {
              // Force exact alignment - override any CSS causing offset
              margin: 0,
              marginTop: 0,
              marginBottom: 0,
              verticalAlign: 'top',
              alignSelf: 'flex-start',
              top: 0,
            },
          }
        }).filter(Boolean)

        // Create all edges - connect half-moon to half-moon directly
        const allEdges = []
        for (let i = 1; i < allNodes.length; i++) {
          allEdges.push({
            id: `${allNodes[i-1].id}-${allNodes[i].id}`,
            source: allNodes[i-1].id,
            target: allNodes[i].id,
            sourceHandle: 'source',
            targetHandle: 'target',
            type: 'custom', // Align with FlowEdge styling used in ready state
            style: {
              stroke: '#94a3b8',
              strokeWidth: 2,
            },
          })
        }

        logger.debug('[handleBuild] Preparing to add nodes one at a time:', {
          count: allNodes.length,
          positions: allNodes.map(n => ({ id: n.id, x: n.position.x, y: n.position.y })),
          edges: allEdges.map(e => ({ id: e.id, source: e.source, target: e.target }))
        })

        // STEP 4: Add nodes one at a time with animation
        const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

        // Start with empty nodes and edges
        builder.setNodes([])
        builder.setEdges([])

        // Add nodes one at a time
        for (let i = 0; i < allNodes.length; i++) {
          const node = allNodes[i]
          logger.debug(`[handleBuild] Adding node ${i + 1}/${allNodes.length}:`, node.id)

          // Add the node
          builder.setNodes(prev => [...prev, node])

          // Add edge if this isn't the first node
          if (i > 0) {
            const edge = allEdges[i - 1]
            builder.setEdges(prev => [...prev, edge])
          }

          // Wait 700ms before adding next node (slower, more visible)
          await wait(700)
        }

        logger.debug('[handleBuild] All nodes added, waiting before zoom animation')

        // Force positions to stay fixed - check multiple times
        // React Flow sometimes repositions nodes after initial render
        const fixPositions = () => {
          const currentNodes = reactFlowInstanceRef.current?.getNodes()
          if (!currentNodes) return false

          logger.debug('[handleBuild] Position check:',
            currentNodes.map(n => ({ id: n.id, x: n.position.x, y: n.position.y }))
          )

          // Check if any Y positions changed
          const needsFixing = currentNodes.some(node => {
            const originalNode = allNodes.find(n => n.id === node.id)
            return originalNode && Math.abs(node.position.y - originalNode.position.y) > 5
          })

          if (needsFixing) {
            logger.debug('[handleBuild] ⚠️ Positions changed! Forcing back to original Y positions')
            const fixedNodes = currentNodes.map(node => {
              const originalNode = allNodes.find(n => n.id === node.id)
              if (originalNode) {
                return {
                  ...node,
                  position: {
                    ...node.position,
                    y: originalNode.position.y, // Force back to original Y
                  }
                }
              }
              return node
            })
            builder.setNodes(fixedNodes)
            return true
          }
          return false
        }

        // Check positions at 100ms, 300ms, 600ms, and 1000ms
        setTimeout(() => fixPositions(), 100)
        setTimeout(() => fixPositions(), 300)
        setTimeout(() => fixPositions(), 600)
        setTimeout(() => fixPositions(), 1000)

        setBuildMachine(prev => ({
          ...prev,
          nodesCache: allNodes,
        }))

        // STEP 5: Wait longer after all nodes added so user sees them all in skeleton state
        await wait(1000)

        // Log actual node positions after render
        if (reactFlowInstanceRef.current) {
          const currentNodes = reactFlowInstanceRef.current.getNodes()
          logger.debug('[handleBuild] Actual node positions after render:',
            currentNodes.map(n => ({ id: n.id, x: n.position.x, y: n.position.y }))
          )
        }

        const firstNode = allNodes[0]

        // STEP 6: Transition first node to ready state after all nodes visible
        logger.debug('[handleBuild] Transitioning first node to ready state')
        const firstPlanNode = buildMachine.plan[0]
        // Use allNodes[0].id directly instead of relying on state mapping
        const firstReactNodeId = allNodes[0]?.id

        logger.debug('[handleBuild] First node transition:', {
          firstPlanNode: firstPlanNode?.id,
          firstReactNodeId,
          firstNodeFromArray: allNodes[0]?.id,
          hasBuilder: !!builder,
          hasInstance: !!reactFlowInstanceRef.current
        })

        if (firstReactNodeId && reactFlowInstanceRef.current) {
          logger.debug('[handleBuild] ✨ TRANSITIONING NODE FROM SKELETON TO READY:', firstReactNodeId)

          setNodeState(reactFlowInstanceRef.current, firstReactNodeId, 'ready')
          builder.setNodes((current: any[]) => {
            const working = current && current.length > 0 ? current : (buildMachine.nodesCache ?? [])
            const updated = working.map(node => {
              if (node.id === firstReactNodeId) {
                logger.debug('[handleBuild] 🎯 Updating node data:', {
                  nodeId: node.id,
                  oldState: node.data?.state,
                  newState: 'ready',
                  oldAiStatus: node.data?.aiStatus,
                  newAiStatus: 'awaiting_user'
                })
                return {
                  ...node,
                  data: {
                    ...node.data,
                    state: 'ready',
                    aiStatus: 'awaiting_user',
                  },
                  className: 'node-ready',
                }
              }
              return node
            })
            logger.debug('[handleBuild] Updated nodes count:', updated.length)
            return updated
          })

          // Wait longer for state transition to be visible before zoom
          await wait(600)
        } else {
          logger.debug('[handleBuild] ⚠️ Cannot transition first node - missing ID or instance')
        }

        // STEP 7: Fit view to show ALL nodes, accounting for agent panel
        logger.debug('[handleBuild] Starting fitView animation to show all nodes')
        if (reactFlowInstanceRef.current && allNodes.length > 0) {
          const instance = reactFlowInstanceRef.current

          // Calculate the bounding box of all nodes
          const minX = Math.min(...allNodes.map(n => n.position.x))
          const maxX = Math.max(...allNodes.map(n => n.position.x)) + 360 // Add node width
          const minY = Math.min(...allNodes.map(n => n.position.y))
          const maxY = Math.max(...allNodes.map(n => n.position.y)) + 100 // Add node height
          const centerX = (minX + maxX) / 2
          const centerY = (minY + maxY) / 2

          // Guard against NaN values
          if (!isFinite(centerX) || !isFinite(centerY)) {
            logger.warn('[handleBuild] Skipping fitView - invalid center values:', { centerX, centerY, minX, maxX, minY, maxY })
          } else {
            logger.debug('[handleBuild] Fitting view to show all nodes:', {
              nodeCount: allNodes.length,
              nodePositions: allNodes.map(n => ({ id: n.id, x: n.position.x, y: n.position.y })),
              boundingBox: { minX, maxX, minY, maxY },
              center: { x: centerX, y: centerY }
            })

            // Calculate zoom to fit all nodes with padding
            // Account for agent panel by shifting center to the right
            const panelWidthSafe = isFinite(agentPanelWidth) ? agentPanelWidth : 420
            const panelOffset = panelWidthSafe / 2 // Offset to account for panel
            const adjustedCenterX = centerX - panelOffset // Shift left in flow coords = shift right in view

            // Use setCenter to position view, accounting for panel
            instance.setCenter(adjustedCenterX, centerY, {
              zoom: 0.85, // Zoom out slightly to ensure both nodes are visible
              duration: 1200, // 1.2 second animation (smooth)
            })

            // Wait for zoom animation to complete
            await wait(1400)
          }
        }

        // STEP 8: Update status and transition to WAITING_USER
        await persistOrQueueStatus("Flow ready ✅")

        // STEP 9: Save nodes and edges to database
        // This prevents the workflow from being reset when updateConfig is called later
        try {
          logger.debug('[handleBuild] Saving nodes to database...')

          // Convert React Flow nodes to Flow schema format for applyEdits
          const saveNodeEdits = allNodes.map((node) => ({
            op: 'addNode' as const,
            node: {
              id: node.id,
              type: node.data.type || node.type,
              label: node.data.label || node.data.title || node.id,
              description: node.data.description,
              config: node.data.config ?? {},
              inPorts: [],
              outPorts: [],
              io: {},
              policy: { timeoutMs: 60000, retries: 0 },
              costHint: node.data.costHint ?? 0,
              metadata: {
                position: node.position,
                isTrigger: node.data.isTrigger ?? false,
                providerId: node.data.providerId,
                agentHighlights: node.data.agentHighlights ?? [],
              },
            },
          }))

          // Convert edges to Flow schema format
          const saveEdgeEdits = allEdges.map((edge) => ({
            op: 'connect' as const,
            edge: {
              id: edge.id,
              from: { nodeId: edge.source },
              to: { nodeId: edge.target },
              mappings: [],
            },
          }))

          const allSaveEdits = [...saveNodeEdits, ...saveEdgeEdits]
          logger.debug('[handleBuild] Saving', allSaveEdits.length, 'edits to database (', saveNodeEdits.length, 'nodes,', saveEdgeEdits.length, 'edges)')

          // Save to database but skip updating React Flow graph (we already have the correct state)
          await actions.applyEdits(allSaveEdits, { skipGraphUpdate: true })
          logger.debug('[handleBuild] ✅ Nodes and edges saved to database successfully')
        } catch (saveError: any) {
          logger.error('[handleBuild] Failed to save nodes to database:', saveError)
          // Don't fail the whole build - the nodes are still displayed, just not persisted
          // User can try saving again or the next config update will attempt to save
        }

        setBuildMachine(prev => ({
          ...prev,
          progress: { ...prev.progress, currentIndex: 0, total: buildMachine.plan.length },
        }))

        transitionTo(BuildState.WAITING_USER)
      }, 100) // Small delay to let React update

    } catch (error: any) {
      toast({
        title: "Build failed",
        description: error?.message || "Unable to build workflow skeleton",
        variant: "destructive",
      })
      transitionTo(BuildState.PLAN_READY)
      await persistOrQueueStatus("Build failed ❌")
    }
  }, [actions, agentPanelWidth, buildMachine, builder?.nodes, builder?.setNodes, isIntegrationConnected, persistOrQueueStatus, toast, transitionTo, setBuildMachine])

  const handleContinueNode = useCallback(async () => {
    logger.debug('[handleContinueNode] Starting...')
    const currentIndex = buildMachine.progress.currentIndex
    logger.debug('[handleContinueNode] currentIndex:', currentIndex)
    logger.debug('[handleContinueNode] buildMachine.nodeMapping:', buildMachine.nodeMapping)
    logger.debug('[handleContinueNode] buildMachine.nodesCache:', buildMachine.nodesCache)

    if (currentIndex < 0 || !buildMachine.plan[currentIndex]) {
      logger.debug('[handleContinueNode] Invalid index or no plan node')
      return
    }
    if (!builder?.setNodes) {
      logger.debug('[handleContinueNode] No builder setNodes')
      return
    }

    const planNode = buildMachine.plan[currentIndex]
    logger.debug('[handleContinueNode] planNode:', planNode)

    // Use the mapping to find the ReactFlow node ID
    const reactFlowNodeId = buildMachine.nodeMapping?.[planNode.id]
    logger.debug('[handleContinueNode] Looking for ReactFlow node ID:', reactFlowNodeId)

    if (!reactFlowNodeId) {
      logger.debug('[handleContinueNode] No mapping found for plan node:', planNode.id)
      toast({
        title: "Node mapping error",
        description: "Could not find the workflow node mapping. Please try rebuilding.",
        variant: "destructive",
      })
      return
    }

    // Try to find node in cached nodes first, then fall back to builder.nodes
    let reactFlowNode = buildMachine.nodesCache?.find(n => n.id === reactFlowNodeId)

    if (!reactFlowNode) {
      logger.debug('[handleContinueNode] Node not in cache, checking builder.nodes...')
      reactFlowNode = builder.nodes?.find(n => n.id === reactFlowNodeId)
    }

    logger.debug('[handleContinueNode] reactFlowNode:', reactFlowNode)

    if (!reactFlowNode) {
      logger.debug('[handleContinueNode] No reactFlowNode found with ID:', reactFlowNodeId)
      logger.debug('[handleContinueNode] builder.nodes:', builder.nodes)
      logger.debug('[handleContinueNode] nodesCache:', buildMachine.nodesCache)
      toast({
        title: "Node not found",
        description: "Could not find the workflow node. Please try rebuilding.",
        variant: "destructive",
      })
      return
    }

    logger.debug('[handleContinueNode] Transitioning to PREPARING_NODE')
    transitionTo(BuildState.PREPARING_NODE)

    try {
      const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
      const userConfig = nodeConfigs[planNode.id] || {}
      const nodeComponent = ALL_NODE_COMPONENTS.find(component => component.type === planNode.nodeType)
      const configSchema = nodeComponent?.configSchema ?? []

      const prioritizedFields = [
        ...configSchema.filter(field => field?.required && !field?.hidden),
        ...configSchema.filter(field => !field?.required && !field?.hidden),
      ]

      const seenFieldNames = new Set<string>()
      const uniqueFields = prioritizedFields.filter(field => {
        if (!field?.name || seenFieldNames.has(field.name)) return false
        seenFieldNames.add(field.name)
        return true
      })

      const existingConfig = (reactFlowNode?.data?.config ?? {}) as Record<string, any>
      const fieldsToPopulate = uniqueFields
        .filter(field => existingConfig[field.name] === undefined && userConfig[field.name] === undefined)
        .slice(0, 6)

      const progressEntries: Array<{ key: string; value: any; displayValue?: string }> = []

      const generateAIValue = (field: any, index: number) => {
        const label = (field?.label || field?.name || `Field ${index + 1}`).trim()
        const normalizedName = (field?.name || '').toLowerCase()

        // Check if this is an action node (not a trigger) - should use variable references
        const isActionNode = !planNode.nodeType?.includes('_trigger_')

        // For action nodes, use variable references to pull data from trigger
        if (isActionNode) {
          // Message/body fields - use a formatted template with trigger data
          if (normalizedName.includes('message') || normalizedName.includes('body') || field?.type === 'textarea' || field?.type === 'slack-rich-text') {
            return `New {{trigger.subject}} from {{trigger.from}}\n\n{{trigger.snippet}}`
          }
          // Subject fields - reference trigger subject
          if (normalizedName.includes('subject')) {
            return `{{trigger.subject}}`
          }
          // Title fields - reference trigger subject
          if (normalizedName.includes('title')) {
            return `{{trigger.subject}}`
          }
          // Name fields
          if (normalizedName.includes('name')) {
            return `{{trigger.subject}}`
          }
          // Email/recipient fields - reference trigger sender
          if (normalizedName.includes('email') || normalizedName.includes('recipient') || normalizedName.includes('to')) {
            return `{{trigger.from}}`
          }
        }

        // For trigger nodes: use schema defaults where available, leave user-choice fields empty
        if (!isActionNode) {
          // Use schema default if available
          if (field.defaultValue !== undefined) {
            return field.defaultValue
          }
          // Boolean fields default to false
          if (field.type === 'boolean' || field.type === 'checkbox') {
            return false
          }
          // Dynamic fields (combobox, select with dynamic options) - leave empty for user
          // Text/textarea fields - leave empty for user to configure
          return ''
        }

        // Fallback for unknown action patterns
        return ''
      }

      const applyNodeUpdate = (transform: (node: any) => any) => {
        let updatedNode = reactFlowNode
        builder.setNodes((current: any[]) => {
          const working = current && current.length > 0 ? current : (buildMachine.nodesCache ?? [])
          const nextNodes = working.map(node => {
            if (node.id !== reactFlowNode.id) return node
            updatedNode = transform(node)
            return updatedNode
          })
          return nextNodes
        })
        reactFlowNode = updatedNode
      }

      if (reactFlowInstanceRef.current) {
        // Extract savedDynamicOptions from userConfig (special key set by FlowV2AgentPanel)
        const { __savedDynamicOptions__, ...regularConfig } = userConfig

        // Apply schema defaults for trigger fields that aren't already configured
        if (nodeComponent?.isTrigger && configSchema.length > 0) {
          configSchema.forEach((field: any) => {
            if (field?.defaultValue !== undefined && regularConfig[field.name] === undefined) {
              regularConfig[field.name] = field.defaultValue
            }
          })
        }

        applyNodeUpdate(node => ({
          ...node,
          data: {
            ...node.data,
            config: {
              ...(node.data?.config ?? {}),
              ...regularConfig, // Apply regular config (without __savedDynamicOptions__)
            },
            savedDynamicOptions: __savedDynamicOptions__ || node.data?.savedDynamicOptions, // Add savedDynamicOptions to node data
            aiStatus: 'preparing',
            state: 'ready',
            aiProgressConfig: progressEntries,
          },
          className: 'node-ready',
        }))

        await wait(150)
        setNodeState(reactFlowInstanceRef.current, reactFlowNode.id, 'ready')
        await wait(250)

        if (fieldsToPopulate.length > 0) {
          applyNodeUpdate(node => ({
            ...node,
            data: {
              ...node.data,
              aiStatus: 'configuring',
              aiProgressConfig: [...progressEntries],
            },
          }))

          for (let index = 0; index < fieldsToPopulate.length; index++) {
            const field = fieldsToPopulate[index]
            const aiValue = generateAIValue(field, index)
            const displayValue = typeof aiValue === 'string' ? aiValue : JSON.stringify(aiValue)
            progressEntries.push({
              key: field.name,
              value: aiValue,
              displayValue,
            })

            // Extract savedDynamicOptions from userConfig
            const { __savedDynamicOptions__, ...regularConfig } = userConfig

            applyNodeUpdate(node => ({
              ...node,
              data: {
                ...node.data,
                aiStatus: 'configuring',
                aiProgressConfig: [...progressEntries],
                config: {
                  ...(node.data?.config ?? {}),
                  ...regularConfig,
                  [field.name]: aiValue,
                },
                savedDynamicOptions: __savedDynamicOptions__ || node.data?.savedDynamicOptions,
              },
            }))

            await wait(350)
          }
        } else {
          applyNodeUpdate(node => ({
            ...node,
            data: {
              ...node.data,
              aiStatus: 'configuring',
              aiProgressConfig: [],
            },
          }))
          await wait(300)
        }

        transitionTo(BuildState.TESTING_NODE)

        applyNodeUpdate(node => ({
          ...node,
          data: {
            ...node.data,
            aiStatus: 'testing',
          },
        }))
        setNodeState(reactFlowInstanceRef.current, reactFlowNode.id, 'running')
        await wait(500)

        // Execute REAL test for actions, validate for triggers
        let testResult
        const catalog = ALL_NODE_COMPONENTS.find(c => c.type === planNode.nodeType)
        const isTrigger = catalog?.isTrigger || false

        try {
          if (isTrigger) {
            // For triggers: validate configuration and check required fields
            // Webhooks are created on workflow activation, not during testing
            logger.debug('[WorkflowBuilderV2] 📋 Validating trigger configuration:', planNode.nodeId)

            // Check if connection exists
            const connectionId = userConfig.connection
            if (!connectionId) {
              throw new Error('No integration connected')
            }

            // Check for missing required fields from schema
            const triggerSchema = catalog?.configSchema || []
            const currentConfig = reactFlowNode.data?.config || {}
            const missingRequired = triggerSchema
              .filter((f: any) => f.required && !f.hidden && f.name !== 'connection')
              .filter((f: any) => {
                const val = currentConfig[f.name] ?? userConfig[f.name]
                return val === undefined || val === null || val === ''
              })

            if (missingRequired.length > 0) {
              const firstMissing = missingRequired[0]
              const missingNames = missingRequired.map((f: any) => f.label || f.name).join(', ')
              logger.debug('[WorkflowBuilderV2] Trigger has missing required fields:', missingNames)

              testResult = {
                success: true, // Don't fail - let user complete manually
                message: `Trigger configured. Missing required: ${missingNames}`,
                testData: {
                  validated: true,
                  trigger: true,
                  needsSetup: true,
                  firstMissingField: firstMissing?.name,
                  missingFields: missingRequired.map((f: any) => f.label || f.name)
                }
              }
            } else {
              testResult = {
                success: true,
                message: '✅ Trigger configuration validated',
                testData: { validated: true, trigger: true }
              }
            }

            await wait(600) // Brief pause to show testing state
          } else {
            // For actions: execute REAL API call
            logger.debug('[WorkflowBuilderV2] 🧪 Executing real action test:', planNode.nodeId)

            // Use the complete config from the node, which includes both user config and AI-generated values
            const completeConfig = reactFlowNode.data.config || userConfig

            testResult = await actionTestService.testAction({
              userId: builder.userId!,
              workflowId: builder.id!,
              nodeId: planNode.nodeId,
              nodeType: planNode.nodeType,
              providerId: planNode.providerId || '',
              config: completeConfig,
              integrationId: completeConfig.connection || userConfig.__savedDynamicOptions__?.integrationId || ''
            })
          }

          logger.debug('[WorkflowBuilderV2] Test result:', testResult)

        } catch (error: any) {
          logger.error('[WorkflowBuilderV2] Test failed:', error)
          testResult = {
            success: false,
            message: error.message || 'Test failed',
            error: {
              code: error.code || 'TEST_FAILED',
              message: error.message,
              details: error
            }
          }
        }

        if (testResult.success) {
          const triggerNeedsSetup = testResult.testData?.needsSetup === true
          setNodeState(reactFlowInstanceRef.current, reactFlowNode.id, triggerNeedsSetup ? 'ready' : 'passed')
          applyNodeUpdate(node => ({
            ...node,
            data: {
              ...node.data,
              aiStatus: triggerNeedsSetup ? 'ready' : 'ready',
              state: triggerNeedsSetup ? 'ready' : 'passed',
              needsSetup: triggerNeedsSetup,
              firstMissingField: testResult.testData?.firstMissingField || null,
              aiBadgeText: triggerNeedsSetup ? 'Review Settings' : undefined,
              aiBadgeVariant: triggerNeedsSetup ? 'warning' : undefined,
              validationMessage: triggerNeedsSetup
                ? `Missing required: ${testResult.testData?.missingFields?.join(', ')}`
                : undefined,
              testResult: testResult.testData // Store test data
            },
          }))
        } else {
          setNodeState(reactFlowInstanceRef.current, reactFlowNode.id, 'failed')
          applyNodeUpdate(node => ({
            ...node,
            data: {
              ...node.data,
              aiStatus: 'error',
              state: 'failed',
              testError: testResult.error // Store error for display
            },
          }))

          // Show error to user
          toast({
            title: "Test Failed",
            description: testResult.message,
            variant: "destructive"
          })

          throw new Error(testResult.message)
        }
      }

      setBuildMachine(prev => ({
        ...prev,
        nodesCache: builder.nodes ?? prev.nodesCache,
      }))

      // STEP 8: Move to next node or complete
      const nextIndex = currentIndex + 1
      if (nextIndex >= buildMachine.plan.length) {
        setBuildMachine(prev => ({
          ...prev,
          progress: { ...prev.progress, currentIndex: nextIndex, done: nextIndex },
        }))
        // Agent eval: track build completion
        agentEvalTracker.trackEvent(AGENT_EVAL_EVENTS.BUILD_COMPLETED, {
          node_count: buildMachine.plan.length,
          nodes_configured: nextIndex,
        })
        transitionTo(BuildState.COMPLETE)

        // Add preferences save message if we collected any preferences during the build
        // This is UI-only (ephemeral) - should not be persisted to database
        if (collectedPreferences.length > 0) {
          setAgentMessages(prev => [...prev, {
            id: generateLocalId(),
            flowId,
            role: 'assistant',
            text: 'Your workflow is ready! Would you like to save these preferences for future workflows?',
            meta: {
              preferencesSave: {
                selections: collectedPreferences
              }
            },
            createdAt: new Date().toISOString(),
            ephemeral: true,  // UI state only - should NOT be persisted
          }])
        }
      } else {
        setBuildMachine(prev => ({
          ...prev,
          progress: { ...prev.progress, currentIndex: nextIndex, done: nextIndex },
        }))
        transitionTo(BuildState.WAITING_USER)

        const nextPlanNode = buildMachine.plan[nextIndex]
        const nextReactNodeId = nextPlanNode ? buildMachine.nodeMapping?.[nextPlanNode.id] : null

        if (nextReactNodeId && reactFlowInstanceRef.current) {
          setNodeState(reactFlowInstanceRef.current, nextReactNodeId, 'ready')
          builder.setNodes((current: any[]) => {
            const working = current && current.length > 0 ? current : (buildMachine.nodesCache ?? [])
            return working.map(node => {
              if (node.id !== nextReactNodeId) return node
              return {
                ...node,
                data: {
                  ...node.data,
                  state: 'ready',
                  aiStatus: 'awaiting_user',
                },
                className: 'node-ready',
              }
            })
          })
        }

        // STEP 9: No camera panning - keep viewport where user positioned it
        // Camera was positioned perfectly after "Build", so we maintain that view
        // during the guided setup flow
      }
    } catch (error: any) {
      toast({
        title: "Node configuration failed",
        description: error?.message || "Unable to configure node",
        variant: "destructive",
      })

      // Mark node as failed
      if (reactFlowInstanceRef.current && reactFlowNode) {
        setNodeState(reactFlowInstanceRef.current, reactFlowNode.id, 'failed')
      }

      transitionTo(BuildState.WAITING_USER)
    }
  }, [buildMachine, builder?.nodes, builder?.setNodes, collectedPreferences, flowId, generateLocalId, nodeConfigs, toast, transitionTo, setBuildMachine])

  const handleSkipNode = useCallback(() => {
    const nextIndex = buildMachine.progress.currentIndex + 1
    if (nextIndex >= buildMachine.plan.length) {
      setBuildMachine(prev => ({
        ...prev,
        progress: { ...prev.progress, currentIndex: nextIndex, done: nextIndex },
      }))
      // Agent eval: track build completion (via skip)
      agentEvalTracker.trackEvent(AGENT_EVAL_EVENTS.BUILD_COMPLETED, {
        node_count: buildMachine.plan.length,
        nodes_configured: nextIndex,
      })
      transitionTo(BuildState.COMPLETE)

      // Add preferences save message if we collected any preferences during the build
      // This is UI-only (ephemeral) - should not be persisted to database
      if (collectedPreferences.length > 0) {
        setAgentMessages(prev => [...prev, {
          id: generateLocalId(),
          flowId,
          role: 'assistant',
          text: 'Your workflow is ready! Would you like to save these preferences for future workflows?',
          meta: {
            preferencesSave: {
              selections: collectedPreferences
            }
          },
          createdAt: new Date().toISOString(),
          ephemeral: true,  // UI state only - should NOT be persisted
        }])
      }
    } else {
      setBuildMachine(prev => ({
        ...prev,
        progress: { ...prev.progress, currentIndex: nextIndex },
      }))
      transitionTo(BuildState.WAITING_USER)
    }
  }, [buildMachine.plan.length, buildMachine.progress.currentIndex, collectedPreferences, flowId, generateLocalId, transitionTo])

  const handleNodeConfigChange = useCallback((nodeId: string, fieldName: string, value: any) => {
    // Agent eval: track manual correction when user changes a field during guided setup
    if (buildMachine.state !== BuildState.IDLE) {
      const isVarRef = typeof value === 'string' && value.includes('{{')
      agentEvalTracker.trackEvent(AGENT_EVAL_EVENTS.MANUAL_CORRECTION, {
        node_id: nodeId,
        field_name: fieldName,
        correction_type: 'field_change',
        severity: 'minor',
        variable_ref: isVarRef ? value : undefined,
        failure_labels: classifyFailure(AGENT_EVAL_EVENTS.MANUAL_CORRECTION, {
          correction_type: 'field_change',
          variable_ref: isVarRef ? value : undefined,
        }),
      })
    }
    setNodeConfigs(prev => ({
      ...prev,
      [nodeId]: {
        ...prev[nodeId],
        [fieldName]: value
      }
    }))
  }, [buildMachine.state])

  const handleCancelBuild = useCallback(() => {
    transitionTo(BuildState.PLAN_READY)
  }, [transitionTo])

  const handleUndoToPreviousStage = useCallback(() => {
    transitionTo(BuildState.PLAN_READY)
  }, [transitionTo])

  // Path menu handlers for PathLabelsOverlay
  const handleTogglePathCollapse = useCallback((pathId: string) => {
    if (!builder?.nodes || !builder?.edges || !builder.setNodes) return

    const isCurrentlyCollapsed = collapsedPaths.has(pathId)

    // Find the edge that represents this path
    const pathEdge = builder.edges.find((e: any) => e.id === pathId)
    if (!pathEdge) return

    // Find the target node (Path Condition node)
    const pathConditionNode = builder.nodes.find((n: any) => n.id === pathEdge.target)
    if (!pathConditionNode) return

    // Helper function to find all descendant nodes in a path
    const findDescendantNodes = (startNodeId: string): string[] => {
      const descendants: string[] = []
      const toVisit = [startNodeId]
      const visited = new Set<string>()

      while (toVisit.length > 0) {
        const currentId = toVisit.shift()!
        if (visited.has(currentId)) continue
        visited.add(currentId)
        descendants.push(currentId)

        // Find all edges from this node
        const outgoingEdges = builder.edges.filter((e: any) => e.source === currentId)
        for (const edge of outgoingEdges) {
          if (!visited.has(edge.target)) {
            toVisit.push(edge.target)
          }
        }
      }

      return descendants
    }

    // Get all nodes in this path (including the path condition node)
    const pathNodeIds = findDescendantNodes(pathConditionNode.id)

    // Toggle visibility of all nodes in this path
    const updatedNodes = builder.nodes.map((node: any) => {
      if (pathNodeIds.includes(node.id)) {
        return {
          ...node,
          hidden: !isCurrentlyCollapsed, // Toggle: if currently collapsed, show; if shown, hide
        }
      }
      return node
    })

    builder.setNodes(updatedNodes)

    // Update collapsed state
    setCollapsedPaths((prev) => {
      const next = new Set(prev)
      if (isCurrentlyCollapsed) {
        next.delete(pathId)
      } else {
        next.add(pathId)
      }
      return next
    })
  }, [builder, collapsedPaths])

  const handleRenamePath = useCallback((pathId: string) => {
    // TODO: Open rename dialog
    const newName = prompt('Enter new path name:')
    if (newName) {
      setPathLabels((prev) => ({ ...prev, [pathId]: newName }))
      // Also update the node config
      const edge = builder?.edges?.find((e: any) => e.id === pathId)
      if (edge && builder?.nodes) {
        const targetNode = builder.nodes.find((n: any) => n.id === edge.target)
        if (targetNode && builder.updateNodeData) {
          builder.updateNodeData(targetNode.id, {
            ...targetNode.data,
            config: {
              ...targetNode.data.config,
              pathName: newName,
            },
          })
        }
      }
    }
  }, [builder])

  const handleDuplicatePath = useCallback(async (pathId: string) => {
    // TODO: Implement path duplication
    toast({ title: 'Duplicate Path', description: 'Path duplication coming soon!' })
  }, [toast])

  const handleCopyPath = useCallback((pathId: string) => {
    // TODO: Implement path copy to clipboard
    toast({ title: 'Copy Path', description: 'Path copied to clipboard!' })
  }, [toast])

  const handleAddPathNote = useCallback((pathId: string) => {
    // TODO: Implement path note
    toast({ title: 'Add Note', description: 'Path notes coming soon!' })
  }, [toast])

  const handleDeletePath = useCallback(async (pathId: string) => {
    if (!confirm('Are you sure you want to delete this path?')) return

    // Find the edge and target node
    const edge = builder?.edges?.find((e: any) => e.id === pathId)
    if (edge && builder?.nodes) {
      const targetNode = builder.nodes.find((n: any) => n.id === edge.target)
      if (targetNode) {
        // Delete all nodes in this path
        await handleDeleteNodes([targetNode.id])
        // Remove from collapsed paths if present
        setCollapsedPaths((prev) => {
          const next = new Set(prev)
          next.delete(pathId)
          return next
        })
        // Remove from path labels
        setPathLabels((prev) => {
          const next = { ...prev }
          delete next[pathId]
          return next
        })
      }
    }
  }, [builder, handleDeleteNodes])

  // Auto-create 2 paths when Path Router is added (Zapier-style)
  // Track which routers are currently being processed to prevent race conditions
  const processingRoutersRef = useRef<Set<string>>(new Set())
  const autoCreateTimeoutRef = useRef<NodeJS.Timeout>()

  useEffect(() => {
    if (!builder?.nodes || !builder?.edges || !actions) return

    // Debounce to prevent multiple simultaneous executions
    if (autoCreateTimeoutRef.current) {
      clearTimeout(autoCreateTimeoutRef.current)
    }

    autoCreateTimeoutRef.current = setTimeout(async () => {
      // Find Path Router nodes that don't have any connected Path Condition nodes
      const routerNodes = builder.nodes.filter((node: any) => node.data?.type === 'path')

      for (const routerNode of routerNodes) {
        // Skip if already processing this router
        if (processingRoutersRef.current.has(routerNode.id)) {
          logger.debug('[Path Router] Already processing router:', routerNode.id)
          continue
        }

        // Check if this router already has path condition nodes
        const connectedEdges = builder.edges.filter((e: any) => e.source === routerNode.id)
        const hasPathConditions = connectedEdges.some((edge: any) => {
          const targetNode = builder.nodes.find((n: any) => n.id === edge.target)
          return targetNode?.data?.type === 'path_condition'
        })

        // If no paths exist, auto-create 2 paths
        if (!hasPathConditions) {
          // Mark as processing
          processingRoutersRef.current.add(routerNode.id)
          logger.debug('[Path Router] Auto-creating 2 paths for router:', routerNode.id)

          try {
            // Create Path A (left) - 250px to the left
            const pathAPosition = {
              x: routerNode.position.x - 250,
              y: routerNode.position.y + 200
            }
            await actions.addNode('path_condition', pathAPosition)

            // Wait a moment for the node to be added to the state
            await new Promise(resolve => setTimeout(resolve, 150))

            // Find the newly created Path A node
            const pathANode = builder.nodes.find((n: any) =>
              n.data?.type === 'path_condition' &&
              Math.abs(n.position.x - pathAPosition.x) < 10 &&
              Math.abs(n.position.y - pathAPosition.y) < 10
            )

            // Create Path B (right) - 250px to the right
            const pathBPosition = {
              x: routerNode.position.x + 250,
              y: routerNode.position.y + 200
            }
            await actions.addNode('path_condition', pathBPosition)

            // Wait a moment for the node to be added
            await new Promise(resolve => setTimeout(resolve, 150))

            // Find the newly created Path B node
            const pathBNode = builder.nodes.find((n: any) =>
              n.data?.type === 'path_condition' &&
              Math.abs(n.position.x - pathBPosition.x) < 10 &&
              Math.abs(n.position.y - pathBPosition.y) < 10
            )

            // Connect router to both paths
            if (pathANode) {
              await actions.connectEdge({
                sourceId: routerNode.id,
                targetId: pathANode.id,
                sourceHandle: 'path_0'
              })
            }

            if (pathBNode) {
              await actions.connectEdge({
                sourceId: routerNode.id,
                targetId: pathBNode.id,
                sourceHandle: 'path_1'
              })
            }

            logger.debug('[Path Router] Successfully created 2 paths')
          } catch (error) {
            logger.error('[Path Router] Failed to auto-create paths:', error)
          } finally {
            // Always remove from processing set
            processingRoutersRef.current.delete(routerNode.id)
          }
        }
      }
    }, 300) // 300ms debounce

    // Cleanup timeout on unmount
    return () => {
      if (autoCreateTimeoutRef.current) {
        clearTimeout(autoCreateTimeoutRef.current)
      }
    }
  }, [builder?.nodes, builder?.edges, actions])

  // NOTE: Auto-position useEffect removed - was already disabled via ENABLE_AUTO_STACK = false
  // Nodes now use positions from metadata or stable fallback calculated in flowToReactFlowNodes

  // CONSOLIDATED: Apply node styling AND clear selection during build
  // These were previously 2 separate effects that both called setNodes() on the same
  // state change, causing race conditions where one would overwrite the other.
  useEffect(() => {
    // CRITICAL: Wait for initial load to complete before modifying nodes
    // This prevents race conditions where this effect calls setNodes while
    // the initial load is still populating nodes, causing nodes to disappear
    if (!builder?.isInitialLoadCompleteRef?.current) {
      return
    }
    if (!builder?.nodes || !builder.setNodes) {
      return
    }

    const { state, progress } = buildMachine

    // Determine if we're in an active build state (for selection clearing)
    const isBuildActive =
      state === BuildState.BUILDING_SKELETON ||
      state === BuildState.WAITING_USER ||
      state === BuildState.PREPARING_NODE ||
      state === BuildState.CONFIGURING_NODE ||
      state === BuildState.TESTING_NODE

    // Track if any changes are needed
    let hasChanges = false

    // Apply CSS classes AND clear selection in a SINGLE pass
    const updatedNodes = builder.nodes.map((node, index) => {
      let nodeUpdates: Record<string, any> = {}

      // 1. Apply CSS classes based on build state
      if (state !== BuildState.IDLE) {
        const nodeState = node.data?.state || 'ready'
        let className = ''

        if (state === BuildState.BUILDING_SKELETON) {
          className = 'node-skeleton node-grey'
        } else {
          if (nodeState === 'skeleton') {
            className = 'node-skeleton node-grey'
          } else if (nodeState === 'ready') {
            className = 'node-ready'
          } else if (nodeState === 'running') {
            className = 'node-active'
          } else if (nodeState === 'passed' || nodeState === 'failed') {
            className = 'node-done'
          }
        }

        if (node.className !== className) {
          nodeUpdates.className = className
          hasChanges = true
        }
      }

      // 2. Clear selection during active build states
      if (isBuildActive && node.selected === true) {
        nodeUpdates.selected = false
        hasChanges = true
      }

      // Return updated node if changes, otherwise return original
      if (Object.keys(nodeUpdates).length > 0) {
        return { ...node, ...nodeUpdates }
      }
      return node
    })

    // Only call setNodes if something actually changed
    if (hasChanges) {
      builder.setNodes(updatedNodes)
    }
  }, [buildMachine.state, buildMachine.progress, builder])

  // Real-time workflow task cost calculation (passive, non-authoritative)
  const { setWorkflowCostDetailed, clearWorkflowCost } = useWorkflowCostStore()
  const workflowTaskCost = useMemo(() => {
    const nodes = builder?.nodes ?? []
    const edges = (builder?.edges ?? []).map((e: any) => ({ source: e.source, target: e.target }))
    if (nodes.length === 0) {
      return { estimatedTasks: 0, worstCaseTasks: 0, hasLoops: false, loopDetails: [], byNode: {}, byProvider: {} }
    }
    return estimateWorkflowTaskCost(nodes, edges)
  }, [builder?.nodes, builder?.edges])

  // Update the workflow cost store for sidebar/widget access
  useEffect(() => {
    if (flowId && workflowTaskCost.estimatedTasks >= 0) {
      setWorkflowCostDetailed(flowId, workflowTaskCost)
    }
    return () => {
      clearWorkflowCost()
    }
  }, [flowId, workflowTaskCost, setWorkflowCostDetailed, clearWorkflowCost])

  // Header props matching legacy structure
  const headerProps = useMemo(() => ({
    workflowName,
    setWorkflowName: handleNameChange,
    hasUnsavedChanges: nameDirty || Boolean(flowState?.hasUnsavedChanges),
    isSaving: flowState?.isSaving ?? false,
    isExecuting: false,
    handleSave: nameDirty
      ? () => persistName(workflowName.trim())
      : async () => {},
    handleToggleLive: handleToggleLiveWithValidation,
    isUpdatingStatus: flowState?.isUpdatingStatus ?? false,
    hasPlaceholders: hasPlaceholders(),
    currentWorkflow: flowState?.workflowStatus
      ? { status: flowState.workflowStatus, is_active: flowState.workflowStatus === 'active' }
      : null,
    workflowId: flowId,
    editTemplateId: null,
    isTemplateEditing: false,
    onOpenTemplateSettings: undefined,
    templateSettingsLabel: undefined,
    handleTestSandbox: handleOpenTestDialog,
    handleExecuteLive: handleOpenTestDialog,
    handleExecuteLiveSequential: comingSoon,
    handleRunPreflight: comingSoon,
    isRunningPreflight: false,
    isStepMode: false,
    listeningMode: false,
    handleUndo: builder?.handleUndo ?? comingSoon,
    handleRedo: builder?.handleRedo ?? comingSoon,
    canUndo: builder?.canUndo ?? false,
    canRedo: builder?.canRedo ?? false,
    setShowExecutionHistory: () => {},
    onSelectHistoryRun: actions?.refreshRun
      ? (runId: string) => actions.refreshRun(runId)
      : undefined,
    activeRunId: flowState?.lastRunId,
    onGenerateApiKey: hasPublishedRevision ? handleGenerateApiKey : undefined,
    canGenerateApiKey: hasPublishedRevision,
    onRecenterView: handleRecenterView,
    onToggleViewLock: handleToggleViewLock,
    isViewLocked,
  }), [actions, builder, comingSoon, flowId, flowState?.hasUnsavedChanges, flowState?.isSaving, flowState?.isUpdatingStatus, flowState?.lastRunId, flowState?.revisionId, flowState?.workflowStatus, handleGenerateApiKey, handleNameChange, handleOpenTestDialog, handleToggleLiveWithValidation, handleRecenterView, handleToggleViewLock, hasPlaceholders, hasPublishedRevision, isViewLocked, nameDirty, persistName, workflowName])

  // Derive active execution node name from flow test status
  const activeExecutionNodeName = flowTestStatus?.currentNodeLabel ?? null

  if (!builder || !actions || flowState?.isLoading) {
    return <WorkflowLoadingScreen />
  }

  return (
    <TooltipProvider>
      <BuilderLayout headerProps={headerProps} workflowId={flowId}>
        {/* Main Canvas Area - Matching legacy structure */}
        <div
          style={{ height: "100%", width: "100%", position: "relative" }}
        >
          {/* Task Balance Widget in Top Right - z-10 so it goes behind config panels */}
          <div className="absolute top-4 right-4 z-10">
            <TaskBalanceWidget />
          </div>

          <FlowV2BuilderContent
            nodes={reactFlowProps?.nodes ?? []}
            edges={reactFlowProps?.edges ?? []}
            onNodesChange={reactFlowProps?.onNodesChange}
            onEdgesChange={reactFlowProps?.onEdgesChange}
            onConnect={reactFlowProps?.onConnect}
            nodeTypes={reactFlowProps?.nodeTypes}
            edgeTypes={reactFlowProps?.edgeTypes}
            onSelectionChange={handleSelectionChange}
            onNodeDelete={handleNodeDelete}
            onDeleteNodes={handleDeleteNodes}
            onNodeRename={handleNodeRename}
            onNodeDuplicate={handleNodeDuplicate}
            onAddNote={handleAddNote}
            onInit={(instance) => {
              reactFlowInstanceRef.current = instance
              // Center view accounting for agent panel - single calculation, no animation
              // This eliminates the "adjust then adjust again" visual glitch
              requestAnimationFrame(() => {
                if (instance && builder?.nodes && builder.nodes.length > 0) {
                  const nodes = builder.nodes

                  // Calculate bounds of all nodes
                  let minX = Infinity, minY = Infinity
                  let maxX = -Infinity, maxY = -Infinity

                  nodes.forEach((node: any) => {
                    const x = node.position?.x ?? 0
                    const y = node.position?.y ?? 0
                    const width = 360
                    const height = 140

                    minX = Math.min(minX, x)
                    minY = Math.min(minY, y)
                    maxX = Math.max(maxX, x + width)
                    maxY = Math.max(maxY, y + height)
                  })

                  // Calculate center of all nodes
                  const nodesCenterX = (minX + maxX) / 2
                  const nodesCenterY = (minY + maxY) / 2

                  // Guard against NaN values - skip viewport adjustment if calculations are invalid
                  if (!isFinite(nodesCenterX) || !isFinite(nodesCenterY) || !isFinite(minX) || !isFinite(maxX)) {
                    logger.warn('[Viewport Init] Skipping viewport adjustment - invalid node bounds:', { minX, maxX, minY, maxY, nodesCenterX, nodesCenterY })
                    return
                  }

                  // Calculate available viewport (excluding agent panel)
                  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920
                  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080
                  const panelWidthSafe = isFinite(agentPanelWidth) ? agentPanelWidth : 420
                  const availableWidth = viewportWidth - panelWidthSafe

                  // Calculate the center of the available canvas area (right of agent panel)
                  const availableCenterX = panelWidthSafe + (availableWidth / 2)
                  const availableCenterY = viewportHeight / 2

                  // Calculate viewport position to center nodes in available space
                  // viewport.x = screenX - (nodeX * zoom), so to put nodesCenterX at availableCenterX:
                  const zoom = 1
                  const viewportX = availableCenterX - (nodesCenterX * zoom)
                  const viewportY = availableCenterY - (nodesCenterY * zoom)

                  // Final NaN guard before setting viewport
                  if (!isFinite(viewportX) || !isFinite(viewportY)) {
                    logger.warn('[Viewport Init] Skipping viewport adjustment - invalid viewport position:', { viewportX, viewportY })
                    return
                  }

                  // Set viewport directly - no animation, instant positioning
                  instance.setViewport({ x: viewportX, y: viewportY, zoom }, { duration: 0 })
                }
              })
            }}
            agentPanelWidth={agentPanelWidth}
            isAgentPanelOpen={agentOpen}
            buildState={buildMachine.state}
            badge={buildMachine.badge}
            isIntegrationsPanelOpen={isIntegrationsPanelOpen}
            setIsIntegrationsPanelOpen={setIsIntegrationsPanelOpen}
            integrationsPanelMode={integrationsPanelMode}
            onNodeSelect={handleNodeSelectFromPanel}
            onNodeConfigure={handleNodeConfigure}
            onChangeNode={handleChangeNode}
            onUndoToPreviousStage={handleUndoToPreviousStage}
            onCancelBuild={handleCancelBuild}
            onAddNodeAfter={handleAddNodeAfterClick}
            disablePhantomOverlay={Boolean(activeReorderDrag)}
            isReordering={!!activeReorderDrag}
          >
            {/* Path Labels Overlay - Zapier-style floating pills */}
            <PathLabelsOverlay
              collapsedPaths={collapsedPaths}
              pathLabels={pathLabels}
              onToggleCollapse={handleTogglePathCollapse}
              onRename={handleRenamePath}
              onDuplicate={handleDuplicatePath}
              onCopy={handleCopyPath}
              onAddNote={handleAddPathNote}
              onDelete={handleDeletePath}
            />
          </FlowV2BuilderContent>

          <WorkflowStatusBar
            isFlowTesting={isFlowTesting}
            flowTestStatus={flowTestStatus}
            onStopFlowTest={handleStopFlowTest}
            isExecuting={Boolean(builder?.isExecuting)}
            isPaused={Boolean(builder?.isPaused)}
            isListeningForWebhook={Boolean(builder?.isListeningForWebhook) || testFlowStatus === 'listening'}
            listeningTimeRemaining={listeningTimeRemaining}
            activeExecutionNodeName={activeExecutionNodeName}
            onStopExecution={stopLiveExecutionHandler || cancelTestFlow}
            isNodeTesting={isNodeTesting}
            nodeTestingName={nodeTestingName}
            onStopNodeTest={handleStopNodeTest}
            isFlowTestPaused={isFlowTestPaused}
            onPauseFlowTest={handlePauseFlowTest}
            onResumeFlowTest={handleResumeFlowTest}
          />

          <FlowV2AgentPanel
            layout={{
              isOpen: agentOpen,
              width: agentPanelWidth,
              onClose: () => setAgentOpen(false),
            }}
            state={{
              buildMachine,
              agentInput,
              isAgentLoading,
              agentMessages,
              nodeConfigs,
              awaitingProviderSelection,
              providerCategory,
              providerSelections: Object.fromEntries(providerSelections),
            }}
            actions={{
              onInputChange: value => setAgentInput(value),
              onSubmit: handleAgentSubmit,
              onBuild: handleBuild,
              onContinueNode: handleContinueNode,
              onSkipNode: handleSkipNode,
              onUndoToPreviousStage: handleUndoToPreviousStage,
              onCancelBuild: handleCancelBuild,
              onNodeConfigChange: handleNodeConfigChange,
              onProviderSelect: handleProviderSelect,
              onProviderConnect: handleProviderConnect,
              onProviderChange: handleProviderChange,
              // Enhanced chat flow handlers
              onProviderDropdownSelect: handleProviderDropdownSelect,
              onConnectionComplete: handleConnectionComplete,
              onConnectionSkip: handleConnectionSkip,
              onNodeConfigComplete: handleNodeConfigComplete,
              onNodeConfigSkip: handleNodeConfigSkip,
              onPreferencesSave: handlePreferencesSave,
              onPreferencesComplete: handlePreferencesComplete,
              onPreferencesSkip: handlePreferencesSkip,
            }}
          />

          {/* Agent Toggle Button (when closed) */}
          {!agentOpen && (
            <Button
              onClick={() => setAgentOpen(true)}
              className="fixed left-0 top-1/2 -translate-y-1/2 z-40 rounded-l-none rounded-r-lg shadow-lg px-3 py-2 flex-col gap-1 h-auto"
              variant="default"
              style={{ marginTop: '32px' }}
            >
              <Sparkles className="w-4 h-4" />
              <span className="text-[10px]">Agent</span>
            </Button>
          )}

          {/* Node State Test Panel - Phase 1 Testing - Removed for cleaner UI */}
          {/* <NodeStateTestPanel /> */}
        </div>
      </BuilderLayout>

      {/* Pre-Activation Review Dialog */}
      <ActivationReviewDialog
        open={showActivationReview}
        onOpenChange={setShowActivationReview}
        onConfirm={handleConfirmActivation}
        isActivating={isActivatingAfterReview}
        nodes={builder?.nodes ?? []}
        edges={(builder?.edges ?? []).map((e: any) => ({ source: e.source, target: e.target }))}
      />

      {/* Test Mode Dialog */}
      <TestModeDialog
        open={isTestModeDialogOpen}
        onOpenChange={setIsTestModeDialogOpen}
        workflowId={flowId}
        triggerType={triggerType}
        onRunTest={handleRunTestFromDialog}
        isExecuting={isFlowTesting}
        isListening={testFlowStatus === 'listening'}
        listeningTimeRemaining={listeningTimeRemaining ?? undefined}
      />

      {/* Pre-execution Cost Confirmation Dialog */}
      <ExecutionCostConfirmDialog
        open={isCostConfirmOpen}
        onOpenChange={(open) => {
          setIsCostConfirmOpen(open)
          if (!open) setPendingTestConfig(null)
        }}
        onConfirm={handleCostConfirmed}
        workflowId={flowId}
        nodeLabels={
          builder?.nodes?.reduce((acc: Record<string, string>, n: any) => {
            if (n?.id && n?.data?.label) acc[n.id] = n.data.label
            return acc
          }, {}) ?? {}
        }
      />

      {/* Disconnected Integrations Dialog */}
      <DisconnectedIntegrationsDialog
        open={isDisconnectedDialogOpen}
        onOpenChange={setIsDisconnectedDialogOpen}
        disconnectedIntegrations={disconnectedIntegrations}
        onAllConnected={() => {
          setIsDisconnectedDialogOpen(false)
          setIsTestModeDialogOpen(true)
        }}
      />

      {configuringNode && (() => {
        const nodeType = configuringNode?.data?.type || configuringNode?.type
        const nodeInfo = nodeType ? getNodeByType(nodeType) : null

        // NOTE: Debug logging moved to useEffect to prevent logging on every render
        // See useEffect near line 1220 that logs once per configuringNode?.id change

        // INSTANT REOPEN: Calculate initial data with stable reference
        // NOTE: We rely on ConfigurationModal's internal effectiveInitialData useMemo
        // to maintain stable reference, not on this calculation
        let initialData: Record<string, any> = { ...(configuringNode?.data?.config || {}) }

        // If we don't have config from the node, try localStorage cache
        if (Object.keys(initialData).length === 0) {
          if (typeof window !== 'undefined' && flowId && configuringNode?.id) {
            try {
              const cacheKey = `workflow_${flowId}_node_${configuringNode.id}_config`;
              const cached = localStorage.getItem(cacheKey);
              if (cached) {
                const { config, timestamp } = JSON.parse(cached);
                const age = Date.now() - timestamp;
                // Use cache if less than 5 minutes old
                if (age < 5 * 60 * 1000) {
                  logger.debug('⚡ [WorkflowBuilder] Loaded config from cache for instant reopen');
                  initialData = { ...config };
                }
              }
            } catch (e) {
              logger.warn('Failed to load cached config:', e);
            }
          }
        }

        if (configuringNode?.id) {
          const cachedTest = nodeTestCache[configuringNode.id];
          if (cachedTest) {
            initialData.__testData = cachedTest.data;
            initialData.__testResult = cachedTest.result;
          }
        }

        return (
          <ConfigurationModal
            isOpen={!!configuringNode}
            onClose={() => setConfiguringNode(null)}
            onSave={(config) => {
              handleSaveNodeConfig(configuringNode.id, config)
              setConfiguringNode(null)
            }}
            onBack={handleBackToIntegrations}
            nodeInfo={nodeInfo}
            integrationName={configuringNode?.data?.providerId || nodeType || 'Unknown'}
            initialData={initialData}
            workflowData={{
              nodes: reactFlowProps?.nodes ?? [],
              edges: reactFlowProps?.edges ?? [],
              id: flowId,
              name: workflowName,
            }}
            currentNodeId={configuringNode?.id}
            nodeTitle={configuringNode?.data?.title || null}
            focusField={configuringNode?.data?.firstMissingField || undefined}
          />
        )
      })()}
    </TooltipProvider>
  )
}
