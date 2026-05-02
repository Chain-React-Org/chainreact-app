/**
 * AI Workflow Creation Cost Tracking
 *
 * Tracks the cost of AI-generated workflows and deducts tasks from user balance
 * using the atomic deduct_tasks_if_available RPC.
 *
 * Cost Calculation:
 * - Base cost for AI planning: 1 task
 * - Additional cost based on complexity (nodes generated):
 *   - 1-3 nodes: 0 additional tasks
 *   - 4-6 nodes: 1 additional task
 *   - 7+ nodes: 2 additional tasks
 * - LLM usage: Included in base cost
 * - Cache hits: Free (template already paid for)
 *
 * Total range: 1-3 tasks per AI workflow creation
 *
 * Idempotency: Each planning request generates a unique planning_charge_id (UUID).
 * This ensures that internal LLM retries (same charge ID) are idempotent,
 * while genuine new requests (new charge ID) are billed separately.
 */

import { logger } from '@/lib/utils/logger'

// Cost configuration
const AI_WORKFLOW_COST = {
  BASE_TASK_COST: 1,       // Base cost for any AI planning
  MEDIUM_COMPLEXITY: 4,    // Threshold for medium complexity (4-6 nodes)
  HIGH_COMPLEXITY: 7,      // Threshold for high complexity (7+ nodes)
  MEDIUM_ADDITIONAL: 1,    // Additional tasks for medium complexity
  HIGH_ADDITIONAL: 2,      // Additional tasks for high complexity
}

export interface AIWorkflowCostResult {
  tasksUsed: number
  breakdown: {
    base: number
    complexity: number
    total: number
  }
  newBalance: number | null
  limitExceeded: boolean
  applied: boolean
  resultType: string
  errorMessage?: string
}

/**
 * Calculate the task cost based on workflow complexity
 */
export function calculateAIWorkflowTaskCost(nodeCount: number): number {
  let cost = AI_WORKFLOW_COST.BASE_TASK_COST

  if (nodeCount >= AI_WORKFLOW_COST.HIGH_COMPLEXITY) {
    cost += AI_WORKFLOW_COST.HIGH_ADDITIONAL
  } else if (nodeCount >= AI_WORKFLOW_COST.MEDIUM_COMPLEXITY) {
    cost += AI_WORKFLOW_COST.MEDIUM_ADDITIONAL
  }

  return cost
}

/**
 * Generate a unique charge ID for a planning request.
 * Each call to the /edits route should generate a new charge ID.
 * Internal retries within the same request reuse the same charge ID (idempotent).
 */
export function generatePlanningChargeId(): string {
  return `plan_${crypto.randomUUID()}`
}

/**
 * Read-only balance check used by the `/edits` route to short-circuit with
 * 402 Payment Required *before* incurring LLM cost. Distinct from
 * `deductAIWorkflowTasks` (which atomically deducts) — this function only
 * reads. Both responsibilities are valid: deduct-then-fail is too late
 * because the LLM call has already burned compute and dollars by the time
 * the deduction RPC runs. Keep — JUSTIFIED per pre-launch-cleanup.md §C.
 */
export async function checkAIWorkflowTaskBalance(
  userId: string
): Promise<{ hasBalance: boolean; tasksUsed: number; tasksLimit: number }> {
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const supabase = createAdminClient()

    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('tasks_used, tasks_limit')
      .eq('id', userId)
      .single()

    if (error || !profile) {
      logger.warn('[AIWorkflowCost] Could not fetch user profile', { userId, error: error?.message })
      // Fail closed
      return { hasBalance: false, tasksUsed: 0, tasksLimit: 0 }
    }

    const tasksUsed = profile.tasks_used ?? 0
    const tasksLimit = profile.tasks_limit ?? 100

    // Enterprise unlimited
    if (tasksLimit === -1) {
      return { hasBalance: true, tasksUsed, tasksLimit }
    }

    return {
      hasBalance: tasksUsed < tasksLimit,
      tasksUsed,
      tasksLimit
    }
  } catch (error) {
    logger.error('[AIWorkflowCost] Error checking task balance', { userId, error })
    // Fail closed
    return { hasBalance: false, tasksUsed: 0, tasksLimit: 0 }
  }
}

/**
 * Atomically deduct tasks from user's balance for AI workflow creation.
 * Uses the deduct_tasks_if_available RPC for serialized, idempotent billing.
 *
 * @param userId - User who owns the workflow
 * @param nodeCount - Number of nodes generated (determines complexity cost)
 * @param planningChargeId - Unique charge ID for this planning request (from generatePlanningChargeId)
 * @param flowId - The workflow UUID (for analytics tracking)
 * @param planningMethod - How the plan was generated
 */
export async function deductAIWorkflowTasks(
  userId: string,
  nodeCount: number,
  planningChargeId: string,
  flowId: string,
  planningMethod: 'llm' | 'pattern' | 'cache'
): Promise<AIWorkflowCostResult> {
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const supabase = createAdminClient()

    // Calculate cost based on complexity
    const baseCost = AI_WORKFLOW_COST.BASE_TASK_COST
    let complexityCost = 0

    if (nodeCount >= AI_WORKFLOW_COST.HIGH_COMPLEXITY) {
      complexityCost = AI_WORKFLOW_COST.HIGH_ADDITIONAL
    } else if (nodeCount >= AI_WORKFLOW_COST.MEDIUM_COMPLEXITY) {
      complexityCost = AI_WORKFLOW_COST.MEDIUM_ADDITIONAL
    }

    // Cache hits are free (template already paid for)
    if (planningMethod === 'cache') {
      logger.info('[AIWorkflowCost] Template cache hit - no cost', { userId, flowId })
      return {
        tasksUsed: 0,
        breakdown: { base: 0, complexity: 0, total: 0 },
        newBalance: null,
        limitExceeded: false,
        applied: false,
        resultType: 'deducted'
      }
    }

    const totalCost = baseCost + complexityCost

    // Atomic deduction via RPC
    const { data: rpcResult, error: rpcError } = await supabase.rpc('deduct_tasks_if_available', {
      p_user_id: userId,
      p_amount: totalCost,
      p_execution_id: planningChargeId,
      p_event_type: 'ai_workflow_creation',
      p_node_breakdown: { base: baseCost, complexity: complexityCost, nodeCount, flowId },
      p_workflow_id: flowId,
      p_source: 'ai_planner'
    })

    if (rpcError) {
      logger.error('[AIWorkflowCost] Atomic deduction RPC failed', { userId, flowId, error: rpcError.message })
      return {
        tasksUsed: 0,
        breakdown: { base: baseCost, complexity: complexityCost, total: totalCost },
        newBalance: null,
        limitExceeded: false,
        applied: false,
        resultType: 'billing_unavailable',
        errorMessage: 'Billing system temporarily unavailable. Please retry.'
      }
    }

    const result = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult

    if (!result?.success) {
      const isLimitExceeded = result?.result_type === 'insufficient_balance'
      logger.warn('[AIWorkflowCost] Deduction rejected', {
        userId,
        flowId,
        resultType: result?.result_type,
        remaining: result?.remaining
      })
      return {
        tasksUsed: 0,
        breakdown: { base: baseCost, complexity: complexityCost, total: totalCost },
        newBalance: result?.remaining ?? 0,
        limitExceeded: isLimitExceeded,
        applied: false,
        resultType: result?.result_type ?? 'billing_unavailable',
        errorMessage: isLimitExceeded
          ? `Task limit exceeded. You need ${totalCost} tasks but have ${result?.remaining ?? 0} remaining.`
          : result?.result_type === 'subscription_inactive'
            ? 'Your subscription is inactive. Please update your billing to continue.'
            : 'Billing error. Please retry.'
      }
    }

    // Log the cost for analytics (non-blocking, separate from billing ledger)
    supabase.from('ai_workflow_cost_logs').insert({
      user_id: userId,
      flow_id: flowId,
      tasks_used: totalCost,
      node_count: nodeCount,
      planning_method: planningMethod,
      breakdown: { base: baseCost, complexity: complexityCost },
      created_at: new Date().toISOString()
    }).then(({ error }) => {
      if (error) {
        logger.warn('[AIWorkflowCost] Failed to log cost (non-blocking)', { error: error.message })
      }
    })

    logger.info('[AIWorkflowCost] Tasks deducted successfully', {
      userId,
      flowId,
      planningChargeId,
      tasksDeducted: totalCost,
      nodeCount,
      planningMethod,
      applied: result.applied,
      newBalance: result.remaining
    })

    return {
      tasksUsed: result.applied ? totalCost : 0,
      breakdown: { base: baseCost, complexity: complexityCost, total: totalCost },
      newBalance: result.current_tasks_limit === -1 ? null : (result.remaining ?? 0),
      limitExceeded: false,
      applied: result.applied ?? true,
      resultType: result.result_type ?? 'deducted'
    }

  } catch (error: any) {
    logger.error('[AIWorkflowCost] Unexpected error', { userId, flowId, error: error.message })
    return {
      tasksUsed: 0,
      breakdown: { base: 0, complexity: 0, total: 0 },
      newBalance: null,
      limitExceeded: false,
      applied: false,
      resultType: 'billing_unavailable',
      errorMessage: 'Billing system temporarily unavailable. Please retry.'
    }
  }
}

/**
 * Track AI workflow creation for usage analytics
 */
export async function trackAIWorkflowUsage(
  userId: string,
  flowId: string,
  nodeCount: number,
  planningMethod: string,
  durationMs: number
): Promise<void> {
  try {
    const { trackUsage } = await import('@/lib/usageTracking')

    await trackUsage(userId, 'ai_agent', 'workflow_created', 1, {
      flow_id: flowId,
      node_count: nodeCount,
      planning_method: planningMethod,
      duration_ms: durationMs
    })
  } catch (error) {
    logger.warn('[AIWorkflowCost] Failed to track usage (non-blocking)', { error })
  }
}
