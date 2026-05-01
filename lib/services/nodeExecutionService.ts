import { ALL_NODE_COMPONENTS } from "@/lib/workflows/nodes"
import { TriggerNodeHandlers } from "./executionHandlers/triggerHandlers"
import { ActionNodeHandlers } from "./executionHandlers/actionHandlers"
import { IntegrationNodeHandlers } from "./executionHandlers/integrationHandlers"
import { ExecutionContext } from "./workflowExecutionService"
import { executionHistoryService } from "./executionHistoryService"
import { ActionTestMode } from "./testMode/types"
import { MissingVariableError } from "@/lib/workflows/actions/core/resolveValue"

import { logger } from '@/lib/utils/logger'
import { filterConnectionsForNode } from './utils/connectionRouting'

export class NodeExecutionService {
  // Force recompilation - Gmail actions added
  private triggerHandlers: TriggerNodeHandlers
  private actionHandlers: ActionNodeHandlers
  private integrationHandlers: IntegrationNodeHandlers

  constructor() {
    this.triggerHandlers = new TriggerNodeHandlers()
    this.actionHandlers = new ActionNodeHandlers()
    this.integrationHandlers = new IntegrationNodeHandlers()
  }

  async executeNode(
    node: any,
    allNodes: any[],
    connections: any[],
    context: ExecutionContext
  ): Promise<any> {
    const startTime = Date.now()
    logger.info(`🔧 Executing node: ${node.id} (${node.data.type})`)

    // Log node configuration for debugging
    if (node.data.type.includes('discord')) {
      logger.info(`   Discord node config:`, {
        providerId: node.data.providerId,
        hasConfig: !!node.data.config,
        configKeys: node.data.config ? Object.keys(node.data.config) : []
      })
    }

    // Record step start in history
    let stepRecorded = false
    if (context.executionHistoryId) {
      try {
        // Prepare test mode preview if in test mode
        let testModePreview = undefined
        if (context.testMode && this.isExternalAction(node.data.type)) {
          testModePreview = {
            action: node.data.type,
            config: node.data.config,
            wouldSend: this.getTestModePreview(node.data.type, node.data.config)
          }
        }

        await executionHistoryService.recordStep(
          context.executionHistoryId,
          node.id,
          node.data.type,
          node.data.title || node.data.type,
          node.data.config,
          testModePreview
        )
        stepRecorded = true
      } catch (error) {
        logger.error('Failed to record execution step:', error)
      }
    }

    try {
      // Set current node in data flow manager and store metadata
      if (context.dataFlowManager) {
        context.dataFlowManager.setCurrentNode(node.id)
        
        // Get the outputSchema from availableNodes definition
        const nodeDefinition = ALL_NODE_COMPONENTS.find(def => def.type === node.data.type)
        const outputSchema = nodeDefinition?.outputSchema || []
        
        context.dataFlowManager.setNodeMetadata(node.id, {
          title: node.data.title || node.data.type || 'Unknown Node',
          type: node.data.type,
          outputSchema: outputSchema
        })
      }
      
      let nodeResult = await this.executeNodeByType(node, allNodes, connections, context)

      // Enhanced test mode action interception
      if (context.testMode && context.testModeConfig) {
        const actionMode = context.testModeConfig.actionMode

        // INTERCEPT_WRITES: Execute reads normally, intercept sends/creates/updates
        if (actionMode === ActionTestMode.INTERCEPT_WRITES && this.isExternalAction(node.data.type)) {
          logger.info(`🛡️ Intercepting write action: ${node.data.type}`)
          nodeResult = {
            ...nodeResult,
            intercepted: {
              type: node.data.type,
              config: node.data.config || {},
              wouldHaveSent: nodeResult,
              nodeId: node.id,
              nodeName: node.data.title || node.data.type,
              destination: this.getActionDestination(node.data.type, node.data.config)
            }
          }
        }

        // SKIP_ALL: Skip all external actions entirely, use mock responses
        if (actionMode === ActionTestMode.SKIP_ALL && this.isIntegrationNode(node.data.type)) {
          logger.info(`⏭️ Skipping external action: ${node.data.type}`)
          nodeResult = {
            success: true,
            output: {
              skipped: true,
              message: `Test mode: ${node.data.type} would execute here`,
              mockData: true
            }
          }
        }
      } else if (context.testMode && this.isExternalAction(node.data.type) && nodeResult) {
        // Fallback to legacy test mode behavior for backwards compatibility
        nodeResult = {
          ...nodeResult,
          intercepted: {
            type: node.data.type,
            config: node.data.config || {},
            wouldHaveSent: nodeResult,
            nodeId: node.id,
            nodeName: node.data.title || node.data.type
          }
        }
      }

      // Store result in data flow manager
      if (context.dataFlowManager && nodeResult) {
        // Convert the result to the format expected by DataFlowManager
        // Actions return { success, output, message } but DataFlowManager expects { success, data }
        const nodeOutput = {
          success: nodeResult.success !== undefined ? nodeResult.success : true,
          data: nodeResult.output || nodeResult.data || nodeResult,
          metadata: {
            timestamp: new Date(),
            nodeType: node.data.type,
            executionTime: Date.now() - startTime
          }
        }
        context.dataFlowManager.setNodeOutput(node.id, nodeOutput)
        logger.info(`💾 Stored output for node ${node.id}:`, {
          success: nodeOutput.success,
          dataKeys: nodeOutput.data ? Object.keys(nodeOutput.data) : 'no data'
        })
      }
      
      // For integration nodes that return an output object, pass the output directly
      // This ensures the next node receives the actual data, not the wrapper
      const dataToPass = nodeResult?.output || nodeResult

      // Check if this node is requesting workflow pause (HITL)
      // If so, DO NOT execute connected nodes - the workflow should pause here
      if (nodeResult?.pauseExecution) {
        logger.info(`⏸️  Node ${node.id} requesting workflow pause (HITL)`)
        logger.info(`   Will NOT execute connected nodes - workflow is pausing`)
        // Don't execute connected nodes, but don't fail either
        // The workflowExecutionService will handle the pause
      }
      // Execute connected nodes ONLY if this node succeeded AND is not pausing
      else if (nodeResult?.success !== false) {
        const childResult = await this.executeConnectedNodes(node, allNodes, connections, context, dataToPass)
        // If a child node requested pause (HITL), propagate it up
        if (childResult?.pauseExecution) {
          logger.info(`⏸️  Child node requested workflow pause, propagating up from ${node.id}`)

          // Mark THIS node as completed before propagating the child's pause
          // (This node executed successfully, only the child is paused)
          const executionTime = Date.now() - startTime
          if (stepRecorded && context.executionHistoryId) {
            try {
              await executionHistoryService.completeStep(
                context.executionHistoryId,
                node.id,
                'completed',
                nodeResult?.output || nodeResult,
                undefined,
                undefined
              )
            } catch (error) {
              logger.error('Failed to complete parent step before pause:', error)
            }
          }

          return childResult
        }
      } else {
        logger.warn(`⚠️ Node ${node.id} failed, stopping execution of connected nodes`, {
          error: nodeResult?.error,
          message: nodeResult?.message
        })
      }

      const executionTime = Date.now() - startTime
      logger.info(`✅ Node ${node.id} completed in ${executionTime}ms`)

      // Record step completion - but NOT if the workflow is pausing (HITL)
      // When pauseExecution is true, the node is actually waiting for input, not completed
      if (stepRecorded && context.executionHistoryId && !nodeResult?.pauseExecution) {
        try {
          await executionHistoryService.completeStep(
            context.executionHistoryId,
            node.id,
            'completed',
            nodeResult?.output || nodeResult,
            undefined,
            undefined
          )
        } catch (error) {
          logger.error('Failed to complete execution step:', error)
        }
      } else if (stepRecorded && context.executionHistoryId && nodeResult?.pauseExecution) {
        // For HITL/pause nodes, mark as paused instead of completed
        try {
          await executionHistoryService.pauseStep(
            context.executionHistoryId,
            node.id,
            nodeResult?.output || nodeResult
          )
        } catch (error) {
          logger.error('Failed to mark step as paused:', error)
        }
      }

      return nodeResult

    } catch (error: any) {
      const executionTime = Date.now() - startTime
      logger.error(`❌ Node ${node.id} failed after ${executionTime}ms:`, error.message)

      // Record failed step
      if (stepRecorded && context.executionHistoryId) {
        try {
          await executionHistoryService.completeStep(
            context.executionHistoryId,
            node.id,
            'failed',
            undefined,
            error.message,
            { stack: error.stack, details: error }
          )
        } catch (recordError) {
          logger.error('Failed to record failed step:', recordError)
        }
      }

      // Store error in context
      if (!context.results.errors) {
        context.results.errors = []
      }
      context.results.errors.push({
        nodeId: node.id,
        nodeType: node.data.type,
        error: error.message,
        timestamp: new Date().toISOString()
      })

      throw error
    }
  }

  private async executeNodeByType(
    node: any, 
    allNodes: any[], 
    connections: any[], 
    context: ExecutionContext
  ): Promise<any> {
    // Validate node structure
    if (!node || !node.data) {
      logger.error('Invalid node structure:', node)
      throw new Error(`Invalid node structure: missing data property`)
    }

    const nodeType = node.data.type

    // Check if node type is defined
    if (!nodeType) {
      logger.error('Node missing type:', {
        nodeId: node.id,
        nodeData: node.data
      })
      throw new Error(`Node ${node.id} is missing a type. Please configure the node properly.`)
    }

    // Route to appropriate handler based on node type
    if (this.isTriggerNode(nodeType)) {
      // Triggers source data — they don't consume `{{...}}` references.
      // Skip strict pre-resolution for them.
      return await this.triggerHandlers.execute(node, context)
    }

    // Action and integration nodes consume variables via `node.data.config`.
    // Strictly pre-resolve every `{{...}}` reference at the engine boundary
    // so missing variables fail loudly (Q2) — the standardized config-failure
    // shape replaces silent `undefined` propagation into provider calls.
    //
    // Handlers continue to call the soft `resolveValue(...)` internally; on
    // a pre-resolved (concrete) value those calls are no-ops, so this layer
    // adds strict semantics without touching handler code.
    const dispatchNode = this.preResolveConfigStrict(node, context)
    if (this.isMissingVariableFailure(dispatchNode)) {
      return dispatchNode
    }

    if (this.isActionNode(nodeType)) {
      return await this.actionHandlers.execute(dispatchNode, allNodes, connections, context)
    }

    if (this.isIntegrationNode(nodeType)) {
      return await this.integrationHandlers.execute(dispatchNode, context)
    }

    throw new Error(`Unknown node type: ${nodeType}`)
  }

  /**
   * Strictly pre-resolve a node's config via `dataFlowManager.resolveObjectStrict`.
   * On a `MissingVariableError`, returns the standardized config-failure shape
   * (Q2) so the caller can short-circuit dispatch. On success, returns a
   * shallow-cloned node with the resolved config (the original node object is
   * left intact for any caller that holds a reference to it).
   *
   * If `context.dataFlowManager` is absent (e.g., test-only paths that don't
   * spin up a full DataFlowManager) or the node has no config, the original
   * node is returned unchanged — strict semantics require state to compare
   * against, so without a DataFlowManager we fall back to whatever resolution
   * the handler does internally.
   *
   * Other thrown errors propagate up to `executeNode`'s outer catch, which
   * preserves the existing internal-error path (Q1).
   */
  private preResolveConfigStrict(node: any, context: ExecutionContext): any {
    const config = node?.data?.config
    if (!context.dataFlowManager || !config || typeof config !== 'object') {
      return node
    }

    try {
      const resolvedConfig = context.dataFlowManager.resolveObjectStrict(config)
      return {
        ...node,
        data: {
          ...node.data,
          config: resolvedConfig,
        },
      }
    } catch (err) {
      if (err instanceof MissingVariableError) {
        logger.warn(`⚠️ Node ${node.id} blocked by missing variable: ${err.path}`)
        return {
          success: false,
          category: 'config' as const,
          error: {
            code: err.code,
            path: err.path,
          },
          message: err.message,
        }
      }
      throw err
    }
  }

  private isMissingVariableFailure(value: any): boolean {
    return !!(value && value.success === false && value.category === 'config' && value.error?.code === 'MISSING_VARIABLE')
  }

  private async executeConnectedNodes(
    sourceNode: any,
    allNodes: any[],
    connections: any[],
    context: ExecutionContext,
    result: any
  ): Promise<any> {
    const outgoingConnections = connections.filter((conn: any) => conn.source === sourceNode.id)
    const routedConnections = filterConnectionsForNode(sourceNode, outgoingConnections, result)

    logger.info(`🔗 Node ${sourceNode.id} has ${routedConnections.length} routed connection(s) (total outgoing: ${outgoingConnections.length})`, {
      nodeType: sourceNode?.data?.type,
      pathTaken: result?.pathTaken ?? result?.data?.pathTaken,
      nextNodeId: result?.nextNodeId,
      selectedPaths: result?.data?.selectedPaths
    })
    logger.info(`📌 Original context userId: ${context.userId}`)

    for (const connection of routedConnections) {
      const connectedNode = allNodes.find((node: any) => node.id === connection.target)
      if (!connectedNode) {
        logger.warn(`⚠️ Connection targets missing node ${connection.target} from ${sourceNode.id}`)
        continue
      }

      const updatedContext: ExecutionContext = {
        ...context,
        data: { ...context.data, ...result }
      }

      logger.info(`📌 Updated context userId for node ${connectedNode.id}: ${updatedContext.userId}`, {
        viaHandle: connection.sourceHandle || 'default'
      })

      if (!updatedContext.userId) {
        logger.error('❌ userId lost when creating updatedContext!')
        logger.error('Original context userId:', context.userId)
      }

      const childResult = await this.executeNode(connectedNode, allNodes, connections, updatedContext)

      // If a child node requested pause (HITL), return it immediately to propagate up
      if (childResult?.pauseExecution) {
        logger.info(`⏸️  Child node ${connectedNode.id} requested pause, stopping further execution`)
        return childResult
      }
    }

    return null
  }

  private isTriggerNode(nodeType: string): boolean {
    const triggerTypes = [
      'webhook', 'schedule', 'manual', 'gmail_trigger_new_email', 
      'gmail_trigger_new_attachment', 'gmail_trigger_new_label',
      'google_calendar_trigger_new_event', 'google_calendar_trigger_event_updated',
      'google_calendar_trigger_event_canceled', 'google-drive:new_file_in_folder',
      'google-drive:new_folder_in_folder', 'google-drive:file_updated'
    ]
    return triggerTypes.includes(nodeType)
  }

  private isActionNode(nodeType: string): boolean {
    const actionTypes = [
      'filter', 'delay', 'conditional', 'custom_script', 'loop',
      'ai_action_summarize', 'ai_action_extract', 'ai_action_sentiment',
      'ai_action_translate', 'ai_action_generate', 'ai_action_classify',
      'ai_agent', 'ai_router', 'variable_set', 'variable_get', 'if_condition',
      'switch_case', 'data_transform', 'template', 'javascript',
      'try_catch', 'retry', 'hitl_conversation'
    ]
    return actionTypes.includes(nodeType)
  }

  private isIntegrationNode(nodeType: string): boolean {
    // Check for integration prefixes (more flexible than exact matches)
    const integrationPrefixes = [
      'gmail_', 'slack_', 'discord_', 'teams_',
      'google_', 'google-', // Handle both google_ and google- formats
      'sheets_', 'calendar_', 'docs_',
      'onedrive_', 'dropbox_', 'notion_',
      'airtable_', 'hubspot_', 'stripe_',
      'twitter_', 'facebook_', 'linkedin_',
      'instagram_', 'youtube_', 'trello_',
      'microsoft_', 'outlook_', 'onenote_',
      'microsoft-onenote_', 'microsoft-outlook_'
    ]
    
    // Check if node type starts with any integration prefix
    if (integrationPrefixes.some(prefix => nodeType.startsWith(prefix))) {
      return true
    }
    
    // Also check for specific integration types that don't follow prefix pattern
    const specificTypes = [
      'webhook_call', 'send_email', 'webhook', 'email'
    ]
    
    return specificTypes.includes(nodeType)
  }

  private isExternalAction(nodeType: string): boolean {
    // Actions that would send data externally (should be intercepted in sandbox mode)
    
    // Check for action keywords that indicate external operations
    const externalKeywords = [
      'send', 'create', 'upload', 'update', 'delete', 'append',
      'write', 'post', 'publish', 'share', 'export', 'archive'
    ]
    
    // Check if the node type contains any external action keyword
    const hasExternalKeyword = externalKeywords.some(keyword => 
      nodeType.toLowerCase().includes(keyword)
    )
    
    // Also check specific prefixes that are always external
    const externalPrefixes = [
      'gmail_action_', 'slack_', 'discord_', 'teams_',
      'google-drive:', 'google_drive_', 'google-docs:', 'google_docs_',
      'google-calendar:', 'google_calendar_', 'google-sheets:', 'google_sheets_',
      'onedrive_', 'dropbox_', 'webhook'
    ]
    
    const hasExternalPrefix = externalPrefixes.some(prefix => 
      nodeType.startsWith(prefix)
    )
    
    // Exclude certain read-only operations
    const readOnlyKeywords = ['fetch', 'get', 'read', 'list', 'search', 'find']
    const isReadOnly = readOnlyKeywords.some(keyword => 
      nodeType.toLowerCase().includes(keyword)
    )
    
    return (hasExternalKeyword || hasExternalPrefix) && !isReadOnly
  }

  private getActionDestination(nodeType: string, config: any): string {
    // Determine where this action would send data
    switch (nodeType) {
      case 'gmail_action_send_email':
      case 'gmail_send':
        return config.to || 'unknown recipient'
      case 'slack_send_message':
      case 'slack_action_send_message':
        return `Slack channel: ${config.channel || config.channelId || 'unknown'}`
      case 'discord_action_send_message':
        return `Discord channel: ${config.channelId || 'unknown'}`
      case 'google_sheets_append_row':
      case 'google-sheets:append_row':
        return `Google Sheets: ${config.spreadsheetId || 'unknown spreadsheet'}`
      case 'airtable_create_record':
        return `Airtable: ${config.tableId || 'unknown table'}`
      case 'webhook':
      case 'webhook_call':
        return config.url || 'unknown webhook URL'
      default:
        return 'external service'
    }
  }

  private getTestModePreview(nodeType: string, config: any): any {
    // Generate a preview of what would be sent in test mode
    switch (nodeType) {
      case 'gmail_action_send_email':
      case 'gmail_send':
        return {
          to: config.to || 'recipient@example.com',
          subject: config.subject || 'Test Email',
          body: config.body || 'Email content',
          cc: config.cc,
          bcc: config.bcc
        }

      case 'slack_send_message':
        return {
          channel: config.channel || '#general',
          text: config.text || 'Test message',
          blocks: config.blocks
        }

      case 'discord_action_send_message':
        return {
          channelId: config.channelId,
          message: config.message || 'Test message',
          embeds: config.embeds
        }

      case 'google_sheets_append_row':
      case 'google-sheets:append_row':
        return {
          spreadsheetId: config.spreadsheetId,
          sheetName: config.sheetName || 'Sheet1',
          values: config.values || ['Test', 'Data']
        }

      case 'airtable_create_record':
        return {
          baseId: config.baseId,
          tableId: config.tableId,
          fields: config.fields || {}
        }

      case 'webhook':
      case 'webhook_call':
        return {
          url: config.url,
          method: config.method || 'POST',
          headers: config.headers,
          body: config.body
        }

      default:
        return {
          action: nodeType,
          config: config,
          message: 'Would execute this action with the provided configuration'
        }

    }
  }
}
