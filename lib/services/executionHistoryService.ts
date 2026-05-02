import { createClient } from '@supabase/supabase-js'

import { logger } from '@/lib/utils/logger'

export interface ExecutionHistoryEntry {
  id: string
  workflow_id: string
  user_id: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  test_mode: boolean
  started_at: string
  completed_at?: string
  error_message?: string
  trigger_data?: any
  final_output?: any
}

export interface ExecutionStepEntry {
  id?: string
  execution_id: string
  node_id: string
  node_type: string
  node_name?: string
  step_number: number
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'paused'
  started_at?: string
  completed_at?: string
  duration_ms?: number
  input_data?: any
  output_data?: any
  error_message?: string
  error_details?: any
  test_mode_preview?: any // What would have been sent in test mode
}

export class ExecutionHistoryService {
  private supabase: any
  private currentExecutionId?: string
  private stepCounter = 0

  constructor() {
    // Initialize with service role client to bypass RLS
    // This is needed for webhook-triggered executions
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )
  }

  private async getSupabase() {
    return this.supabase
  }

  /**
   * Start a new execution history entry
   */
  async startExecution(
    executionId: string,
    testMode: boolean,
    triggerData?: any
  ): Promise<string> {
    try {
      const supabase = await this.getSupabase()

      // Store additional metadata on the execution session when available.
      const { error } = await supabase
        .from('workflow_execution_sessions')
        .update({
          test_mode: testMode,
          trigger_data: triggerData ?? undefined,
          updated_at: new Date().toISOString()
        })
        .eq('id', executionId)

      if (error) {
        logger.error('Error creating execution history:', error)
        throw error
      }

      this.currentExecutionId = executionId
      this.stepCounter = 0

      logger.info(`📝 Started execution history tracking: ${executionId}`)
      return executionId
    } catch (error) {
      logger.error('Failed to start execution history:', error)
      throw error
    }
  }

  /**
   * Record a step execution
   */
  async recordStep(
    executionId: string,
    nodeId: string,
    nodeType: string,
    nodeName?: string,
    inputData?: any,
    testModePreview?: any
  ): Promise<string> {
    try {
      const supabase = await this.getSupabase()

      this.stepCounter++

      const { data, error } = await supabase
        .from('execution_steps')
        .insert({
          execution_id: executionId,
          node_id: nodeId,
          node_type: nodeType,
          node_name: nodeName,
          step_number: this.stepCounter,
          status: 'running',
          started_at: new Date().toISOString(),
          input_data: inputData,
          test_mode_preview: testModePreview
        })
        .select()
        .single()

      if (error) {
        logger.error('Error recording execution step:', error)
        throw error
      }

      logger.info(`📝 Recorded step ${this.stepCounter}: ${nodeType} (${nodeId})`)
      return data.id
    } catch (error) {
      logger.error('Failed to record execution step:', error)
      throw error
    }
  }

  /**
   * Update a step with completion status
   */
  async completeStep(
    executionId: string,
    nodeId: string,
    status: 'completed' | 'failed' | 'skipped',
    outputData?: any,
    errorMessage?: string,
    errorDetails?: any
  ): Promise<void> {
    try {
      const supabase = await this.getSupabase()

      const completedAt = new Date()

      // First get the started_at time to calculate duration
      const { data: existingStep } = await supabase
        .from('execution_steps')
        .select('started_at')
        .eq('execution_id', executionId)
        .eq('node_id', nodeId)
        .single()

      let duration_ms = null
      if (existingStep?.started_at) {
        const startTime = new Date(existingStep.started_at)
        duration_ms = completedAt.getTime() - startTime.getTime()
      }

      const { error } = await supabase
        .from('execution_steps')
        .update({
          status,
          completed_at: completedAt.toISOString(),
          duration_ms,
          output_data: outputData,
          error_message: errorMessage,
          error_details: errorDetails
        })
        .eq('execution_id', executionId)
        .eq('node_id', nodeId)

      if (error) {
        logger.error('Error updating execution step:', error)
        throw error
      }

      const statusIcon = status === 'completed' ? '✅' : status === 'failed' ? '❌' : '⏭️'
      logger.info(`${statusIcon} Step ${nodeId} ${status}${duration_ms ? ` (${duration_ms}ms)` : ''}`)
    } catch (error) {
      logger.error('Failed to complete execution step:', error)
    }
  }

  /**
   * Mark a step as paused (for HITL nodes)
   * This sets the step status to 'paused' to indicate it's waiting for user input
   */
  async pauseStep(
    executionId: string,
    nodeId: string,
    pauseData?: any
  ): Promise<void> {
    try {
      const supabase = await this.getSupabase()

      const { error } = await supabase
        .from('execution_steps')
        .update({
          status: 'paused',
          output_data: pauseData
        })
        .eq('execution_id', executionId)
        .eq('node_id', nodeId)

      if (error) {
        logger.error('Error pausing execution step:', error)
        throw error
      }

      logger.info(`⏸️  Step ${nodeId} paused for user input`)
    } catch (error) {
      logger.error('Failed to pause execution step:', error)
    }
  }

  /**
   * Pause execution (for HITL)
   */
  async pauseExecution(
    executionId: string,
    pausedNodeId: string,
    pauseData?: any
  ): Promise<void> {
    try {
      const supabase = await this.getSupabase()

      const { error } = await supabase
        .from('workflow_execution_sessions')
        .update({
          status: 'running', // Keep as running but store pause info
          output_data: {
            paused: true,
            pausedNodeId,
            pauseData
          },
          updated_at: new Date().toISOString()
        })
        .eq('id', executionId)

      if (error) {
        logger.error('Error pausing execution history:', error)
        throw error
      }

      logger.info(`⏸️  Execution ${executionId} paused at node ${pausedNodeId}`)
    } catch (error) {
      logger.error('Failed to pause execution history:', error)
    }
  }

  /**
   * Complete the entire execution
   */
  async completeExecution(
    executionId: string,
    status: 'completed' | 'failed' | 'cancelled',
    finalOutput?: any,
    errorMessage?: string
  ): Promise<void> {
    try {
      const supabase = await this.getSupabase()

      const { error } = await supabase
        .from('workflow_execution_sessions')
        .update({
          status,
          completed_at: new Date().toISOString(),
          output_data: finalOutput,
          error_message: errorMessage,
          updated_at: new Date().toISOString()
        })
        .eq('id', executionId)

      if (error) {
        logger.error('Error completing execution history:', error)
        throw error
      }

      const statusIcon = status === 'completed' ? '✅' : status === 'failed' ? '❌' : '⚠️'
      logger.info(`${statusIcon} Execution ${executionId} ${status}`)
    } catch (error) {
      logger.error('Failed to complete execution history:', error)
    }
  }

  /**
   * Get execution history for a workflow
   */
  async getWorkflowHistory(
    workflowId: string,
    limit: number = 50
  ): Promise<ExecutionHistoryEntry[]> {
    try {
      const supabase = await this.getSupabase()

      const { data, error } = await supabase
        .from('workflow_execution_sessions')
        .select('*')
        .eq('workflow_id', workflowId)
        .order('started_at', { ascending: false })
        .limit(limit)

      if (error) {
        logger.error('Error fetching execution history:', error)
        throw error
      }

      return data || []
    } catch (error) {
      logger.error('Failed to fetch execution history:', error)
      return []
    }
  }

  /**
   * Get detailed steps for an execution
   */
  async getExecutionSteps(
    executionId: string
  ): Promise<ExecutionStepEntry[]> {
    try {
      const supabase = await this.getSupabase()

      const { data, error } = await supabase
        .from('execution_steps')
        .select('*')
        .eq('execution_id', executionId)
        .order('step_number', { ascending: true })

      if (error) {
        logger.error('Error fetching execution steps:', error)
        throw error
      }

      return data || []
    } catch (error) {
      logger.error('Failed to fetch execution steps:', error)
      return []
    }
  }

  /**
   * Delete execution history when workflow is deleted
   */
  async deleteWorkflowHistory(workflowId: string): Promise<void> {
    try {
      const supabase = await this.getSupabase()

      // Delete sessions; steps should cascade if FK exists.
      const { error } = await supabase
        .from('workflow_execution_sessions')
        .delete()
        .eq('workflow_id', workflowId)

      if (error) {
        logger.error('Error deleting execution history:', error)
        throw error
      }

      logger.info(`🗑️ Deleted execution history for workflow ${workflowId}`)
    } catch (error) {
      logger.error('Failed to delete execution history:', error)
    }
  }

}

// Export singleton instance
export const executionHistoryService = new ExecutionHistoryService()
