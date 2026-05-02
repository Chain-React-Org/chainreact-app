import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"
import { createDataFlowManager } from "@/lib/workflows/dataFlowContext"
import { NodeExecutionService } from "./nodeExecutionService"
import { executionHistoryService } from "./executionHistoryService"
import { ExecutionProgressTracker } from "@/lib/execution/executionProgressTracker"
import { TestModeConfig, TriggerTestMode, ActionTestMode } from "./testMode/types"

import { logger } from '@/lib/utils/logger'
import {
  checkExecutionRateLimit,
  checkCircuitBreaker,
  pauseWorkflowForCircuitBreaker,
} from '@/lib/workflows/execution/rateLimiter'

export interface ExecutionContext {
  userId: string
  workflowId: string
  // PR-G1 — workspace tier of the Q12 timezone/locale resolution chain.
  // `undefined` is valid (workflow not associated with a workspace) and
  // means "fall through to user-level resolution."
  workspaceId?: string
  testMode: boolean
  testModeConfig?: TestModeConfig // Enhanced test mode configuration
  data: any
  variables: Record<string, any>
  results: Record<string, any>
  dataFlowManager: any
  interceptedActions?: any[]
  executionHistoryId?: string
  executionId?: string
}

export class WorkflowExecutionService {
  private nodeExecutionService: NodeExecutionService

  constructor() {
    this.nodeExecutionService = new NodeExecutionService()
  }

  async executeWorkflow(
    workflow: any,
    inputData: any,
    userId: string,
    testMode: boolean,
    workflowData?: any,
    skipTriggers: boolean = false,
    testModeConfig?: TestModeConfig,
    supabaseClient?: any
  ) {
    logger.info("🚀 Starting workflow execution service", {
      testMode,
      testModeConfig: testModeConfig ? {
        triggerMode: testModeConfig.triggerMode,
        actionMode: testModeConfig.actionMode
      } : 'none'
    })

    // If testMode is true but no config provided, create default config
    const finalTestConfig: TestModeConfig | undefined = testMode ? (testModeConfig || {
      triggerMode: TriggerTestMode.USE_MOCK_DATA,
      actionMode: ActionTestMode.INTERCEPT_WRITES,
      showDetailedSteps: true,
      captureStepData: true
    }) : undefined

    // Use provided client (e.g., service-role from webhook handlers) or fall back to cookie-based
    const supabase = supabaseClient || await createSupabaseRouteHandlerClient()

    // Rate limit and circuit breaker checks (skip for test mode)
    if (!testMode) {
      const [rateLimitResult, circuitBreakerResult] = await Promise.all([
        checkExecutionRateLimit(workflow.id, supabase),
        checkCircuitBreaker(workflow.id, supabase),
      ])

      if (!rateLimitResult.allowed) {
        logger.warn(`🚫 Workflow ${workflow.id} execution blocked by rate limit: ${rateLimitResult.reason}`)
        return {
          success: false,
          error: rateLimitResult.reason,
          rateLimited: true,
        }
      }

      if (circuitBreakerResult.tripped) {
        // Auto-pause the workflow
        await pauseWorkflowForCircuitBreaker(
          workflow.id,
          supabase,
          `${circuitBreakerResult.consecutiveFailures} consecutive failures`
        )
        return {
          success: false,
          error: `Workflow auto-paused: ${circuitBreakerResult.consecutiveFailures} consecutive failures. Please check your workflow configuration and reactivate.`,
          circuitBreakerTripped: true,
        }
      }
    }

    // Use workflowData if provided (current state), otherwise load from normalized tables
    let allNodes: any[] = []
    let connections: any[] = []

    if (workflowData?.nodes) {
      allNodes = workflowData.nodes
      // Handle both 'edges' (from UI) and 'connections' (from DB) naming
      connections = workflowData.edges || workflowData.connections || []
    } else {
      // Load from normalized tables
      const [nodesResult, edgesResult] = await Promise.all([
        supabase.from('workflow_nodes').select('*').eq('workflow_id', workflow.id).order('display_order'),
        supabase.from('workflow_edges').select('*').eq('workflow_id', workflow.id)
      ])

      allNodes = (nodesResult.data || []).map((n: any) => ({
        id: n.id,
        type: n.node_type,
        position: { x: n.position_x, y: n.position_y },
        data: {
          type: n.node_type,
          label: n.label,
          config: n.config || {},
          isTrigger: n.is_trigger,
          providerId: n.provider_id
        }
      }))

      connections = (edgesResult.data || []).map((e: any) => ({
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        sourceHandle: e.source_port_id || 'source',
        targetHandle: e.target_port_id || 'target'
      }))
    }

    // Filter out UI-only nodes and invalid nodes
    const validNodes = allNodes.filter((node: any) => {
      // Skip AddActionNodes - these are UI placeholders for adding new nodes
      if (node.type === 'addAction' || node.id?.startsWith('add-action-')) {
        logger.info(`Skipping UI placeholder node: ${node.id}`)
        return false
      }
      
      // Skip InsertActionNodes - these are also UI placeholders
      if (node.type === 'insertAction') {
        logger.info(`Skipping UI insert node: ${node.id}`)
        return false
      }
      
      // Skip nodes without proper data or type
      if (!node.data || !node.data.type) {
        logger.warn(`Skipping invalid node ${node.id}: missing type or data`, node)
        return false
      }
      
      return true
    })

    // Also filter connections to only include valid nodes
    const validConnections = connections.filter((conn: any) => {
      const sourceValid = validNodes.some((n: any) => n.id === conn.source)
      const targetValid = validNodes.some((n: any) => n.id === conn.target)
      return sourceValid && targetValid
    })

    const nodes = validNodes

    logger.info("Executing workflow with:", {
      originalNodesCount: allNodes.length,
      validNodesCount: nodes.length,
      skippedNodes: allNodes.length - nodes.length,
      connectionsCount: validConnections.length,
      usingWorkflowData: !!workflowData,
      nodeTypes: nodes.map((n: any) => n.data?.type).filter(Boolean)
    })

    if (nodes.length === 0) {
      throw new Error("Workflow has no valid nodes to execute")
    }

    // Find starting nodes based on skipTriggers flag
    let startingNodes: any[]

    if (skipTriggers) {
      // When skipping triggers (Run Once, or external trigger already fired), prefer nodes connected from trigger(s)
      const triggerNodes = nodes.filter((node: any) => node.data?.isTrigger === true)

      // Primary: nodes directly connected from any trigger
      startingNodes = nodes.filter((node: any) => {
        if (node.data?.isTrigger) return false
        return validConnections.some((conn: any) =>
          triggerNodes.some((trigger: any) => trigger.id === conn.source) &&
          conn.target === node.id
        )
      })

      if (startingNodes.length === 0) {
        // Fallback 1: if there are no triggers in the provided graph (e.g., triggers filtered out for Run Once),
        // start from root action nodes (those without incoming edges)
        if (triggerNodes.length === 0) {
          const hasIncoming = (nodeId: string) => validConnections.some((c: any) => c.target === nodeId)
          const rootActions = nodes.filter((n: any) => !n.data?.isTrigger && !hasIncoming(n.id))

          if (rootActions.length > 0) {
            logger.info(`⚙️ Fallback: starting from ${rootActions.length} root action node(s) (no triggers present)`)
            startingNodes = rootActions
          } else {
            // Fallback 2: as a last resort, start from the first non-trigger node
            const firstAction = nodes.find((n: any) => !n.data?.isTrigger)
            if (firstAction) {
              logger.info(`⚙️ Fallback: starting from first action node ${firstAction.id} (no roots found)`) 
              startingNodes = [firstAction]
            } else {
              logger.info('⚠️ No action nodes available to execute when skipping triggers')
              startingNodes = []
            }
          }
        } else {
          logger.info('No action nodes connected to triggers, workflow may be trigger-only')
          startingNodes = [] // Allow empty for trigger-only workflows
        }
      }
    } else {
      // Normal execution - start from trigger nodes
      startingNodes = nodes.filter((node: any) =>
        !validConnections.some((conn: any) => conn.target === node.id)
      )

      if (startingNodes.length === 0) {
        throw new Error("Workflow has no trigger nodes")
      }
    }

    // Create UUID-based execution record in workflow_execution_sessions table
    // This is required for HITL which references this table
    const { data: executionRecord, error: execError } = await supabase
      .from("workflow_execution_sessions")
      .insert({
        workflow_id: workflow.id,
        user_id: userId,
        status: "running",
        input_data: inputData ?? {},
        started_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (execError) {
      logger.error('Failed to create workflow execution record:', execError)
      throw new Error(`Failed to create execution record: ${execError.message}`)
    }

    const executionId = executionRecord.id // This is a UUID

    // Initialize progress tracker for live mode
    const progressTracker = new ExecutionProgressTracker()
    await progressTracker.initialize(executionId, workflow.id, userId, nodes.length)

    // Start execution history tracking (for detailed step tracking)
    let executionHistoryId: string | null = null
    try {
      executionHistoryId = await executionHistoryService.startExecution(
        executionId,
        testMode,
        inputData
      )
    } catch (error) {
      logger.error('Failed to start execution history tracking:', error)
      // Continue execution even if history tracking fails
    }

    // Initialize execution context
    const executionContext = await this.createExecutionContext(
      workflow,
      inputData,
      userId,
      testMode,
      supabase,
      finalTestConfig
    )

    // Add execution tracking to context
    executionContext.executionHistoryId = executionHistoryId || undefined
    executionContext.executionId = executionId

    // Execute from each starting node
    const results = []
    executionContext.interceptedActions = []
    const completedNodeIds: string[] = []
    const failedNodeIds: Array<{ nodeId: string; error: string }> = []

    logger.info(`📍 Starting execution with ${startingNodes.length} starting nodes`)
    if (startingNodes.length === 0 && skipTriggers) {
      logger.info('⚠️ No action nodes found connected to triggers')
      // Log the trigger nodes and connections for debugging
      const triggerNodes = nodes.filter((node: any) => node.data?.isTrigger === true)
      logger.info(`   Found ${triggerNodes.length} trigger nodes`)
      triggerNodes.forEach((t: any) => {
        const connectedNodes = validConnections
          .filter((c: any) => c.source === t.id)
          .map((c: any) => nodes.find((n: any) => n.id === c.target))
          .filter(Boolean)
        logger.info(`   Trigger ${t.id} connects to ${connectedNodes.length} nodes`)
      })
    }

    // Tasks are deducted upfront by the calling route before execution starts
    // (v1 conservative upfront reservation model). No post-execution deduction
    // happens here.

    try {
    for (const startNode of startingNodes) {
      logger.info(`🎯 Executing ${skipTriggers ? 'action' : 'trigger'} node: ${startNode.id} (${startNode.data.type})`)

      // Update progress: starting this node
      await progressTracker.update({
        currentNodeId: startNode.id,
        currentNodeName: startNode.data.title || startNode.data.type,
        progressPercentage: Math.round((completedNodeIds.length / nodes.length) * 100),
      })

      const result = await this.nodeExecutionService.executeNode(
        startNode,
        nodes,
        validConnections,
        executionContext
      )

      logger.info(`   Node ${startNode.id} execution result:`, {
        success: result?.success,
        hasError: !!result?.error,
        hasResults: !!result?.results,
        pauseExecution: result?.pauseExecution
      })

      // Check if this node is requesting workflow pause (HITL)
      if (result?.pauseExecution) {
        // Use the actual paused node ID from the result (for child nodes like HITL)
        // Falls back to startNode.id if not provided (for direct HITL triggers)
        const actualPausedNodeId = result.pausedNodeId || startNode.id
        const actualPausedNodeName = result.pausedNodeName || startNode.data.title || 'Human input required'

        logger.info(`⏸️  Workflow paused at node ${actualPausedNodeId} (HITL conversation initiated)`)

        // If the pause came from a child node, mark the parent (startNode) as completed
        // since it executed successfully before the child paused
        if (result.pausedNodeId && result.pausedNodeId !== startNode.id) {
          completedNodeIds.push(startNode.id)
          // Update progress to show parent as completed
          await progressTracker.update({
            completedNodes: completedNodeIds,
          })
        }

        // Update workflow_execution_sessions record to paused status
        const { error: pauseError } = await supabase
          .from("workflow_execution_sessions")
          .update({
            status: "paused",
            paused_node_id: actualPausedNodeId,
            paused_at: new Date().toISOString(),
            resume_data: result.output,
            updated_at: new Date().toISOString()
          })
          .eq("id", executionId)

        if (pauseError) {
          logger.error('Failed to update execution to paused status:', pauseError)
        }

        // Update progress tracker to paused state with the correct HITL node
        await progressTracker.pause(actualPausedNodeId, actualPausedNodeName)

        // Update execution history with pause info
        if (executionHistoryId) {
          await executionHistoryService.pauseExecution(
            executionHistoryId,
            actualPausedNodeId,
            result.output
          )
        }

        // Return immediately with pause status
        return {
          results: [result],
          paused: true,
          pausedNodeId: actualPausedNodeId,
          conversationId: result.output?.conversationId,
          executionId,
          executionHistoryId,
          success: true
        }
      }

      // Track completion or failure
      if (result?.error) {
        failedNodeIds.push({ nodeId: startNode.id, error: result.error })
      } else {
        completedNodeIds.push(startNode.id)
      }

      // Update progress after node completion
      await progressTracker.update({
        completedNodes: completedNodeIds,
        failedNodes: failedNodeIds,
        progressPercentage: Math.round((completedNodeIds.length / nodes.length) * 100),
      })

      // Collect intercepted actions from the result tree
      this.collectInterceptedActions(result, executionContext.interceptedActions)

      results.push(result)
    }
    } catch (executionError) {
      // Workflow crashed midway - still deduct for nodes that already executed
      logger.error('[WorkflowExecutionService] Execution loop crashed', {
        executionId,
        completedCount: completedNodeIds.length,
        failedCount: failedNodeIds.length,
        error: executionError instanceof Error ? executionError.message : String(executionError)
      })

      // Update session to failed status
      await supabase
        .from("workflow_execution_sessions")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          execution_time_ms: Date.now() - new Date(executionRecord.started_at).getTime(),
          error_message: executionError instanceof Error ? executionError.message : 'Unknown error',
          updated_at: new Date().toISOString()
        })
        .eq("id", executionId)

      await progressTracker.complete(false, executionError instanceof Error ? executionError.message : 'Unknown error')

      if (executionHistoryId) {
        try {
          await executionHistoryService.completeExecution(
            executionHistoryId,
            'failed',
            results,
            executionError instanceof Error ? executionError.message : 'Unknown error'
          )
        } catch (historyError) {
          logger.error('Failed to complete execution history on crash:', historyError)
        }
      }

      throw executionError
    }

    logger.info(`✅ Workflow execution completed with ${results.length} results`)

    // Complete progress tracking
    const hasErrors = failedNodeIds.length > 0
    await progressTracker.complete(!hasErrors, hasErrors ? 'Workflow execution completed with errors' : undefined)

    // Update workflow_execution_sessions record to completed status
    const finalStatus = hasErrors ? "failed" : "completed"
    const { error: completeError } = await supabase
      .from("workflow_execution_sessions")
      .update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
        execution_time_ms: Date.now() - new Date(executionRecord.started_at).getTime(),
        error_message: hasErrors
          ? `Workflow completed with ${failedNodeIds.length} error(s)`
          : null,
        updated_at: new Date().toISOString()
      })
      .eq("id", executionId)

    if (completeError) {
      logger.error('Failed to update execution to completed status:', completeError)
    }

    // Complete execution history tracking
    if (executionHistoryId) {
      try {
        await executionHistoryService.completeExecution(
          executionHistoryId,
          finalStatus,
          results,
          hasErrors ? `Workflow completed with ${failedNodeIds.length} error(s)` : undefined
        )
      } catch (error) {
        logger.error('Failed to complete execution history:', error)
      }
    }

    // If in test mode and we have intercepted actions, return them separately
    if (testMode && executionContext.interceptedActions.length > 0) {
      logger.info(`📦 Returning ${executionContext.interceptedActions.length} intercepted actions`)
      return {
        results,
        interceptedActions: executionContext.interceptedActions,
        executionHistoryId
      }
    }

    return {
      results,
      executionHistoryId,
      success: !hasErrors,
      executionId
    }
  }

  private async createExecutionContext(
    workflow: any,
    inputData: any,
    userId: string,
    testMode: boolean,
    supabase: any,
    testModeConfig?: TestModeConfig
  ): Promise<ExecutionContext> {
    logger.info(`🔧 Creating execution context with userId: ${userId}`)

    // Initialize data flow manager
    const dataFlowManager = createDataFlowManager(`exec_${Date.now()}`, workflow.id, userId)

    const executionContext: ExecutionContext = {
      data: inputData,
      variables: {},
      results: {},
      testMode,
      testModeConfig,
      userId,
      workflowId: workflow.id,
      // PR-G1 (Q12) — workspace tier of timezone/locale resolution.
      workspaceId: workflow.workspace_id ?? undefined,
      dataFlowManager
    }

    // Load workflow variables
    const { data: variables } = await supabase
      .from("workflow_variables")
      .select("*")
      .eq("workflow_id", workflow.id)

    if (variables) {
      variables.forEach((variable: any) => {
        executionContext.variables[variable.name] = variable.value
      })
    }

    logger.info(`📊 Loaded ${variables?.length || 0} workflow variables`)
    logger.info(`✅ Created execution context with userId: ${executionContext.userId}`)

    return executionContext
  }

  private collectInterceptedActions(result: any, interceptedActions: any[]) {
    if (!result) return
    
    // Check if this result has intercepted data
    if (result.intercepted) {
      interceptedActions.push({
        nodeId: result.intercepted.nodeId,
        nodeName: result.intercepted.nodeName,
        type: result.intercepted.type,
        timestamp: new Date().toISOString(),
        config: result.intercepted.config,
        wouldHaveSent: result.intercepted.wouldHaveSent,
        sandbox: true
      })
    }
    
    // Recursively check nested results
    if (result.results && Array.isArray(result.results)) {
      for (const nestedResult of result.results) {
        this.collectInterceptedActions(nestedResult, interceptedActions)
      }
    }
  }
}
