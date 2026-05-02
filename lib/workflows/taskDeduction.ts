/**
 * Task Deduction Service
 *
 * CANONICAL CHARGING POLICY (v1) — Conservative Upfront Reservation
 *
 * 1. Workflow execution is charged upfront using conservative pre-execution cost estimation.
 * 2. No refunds in v1 — if actual usage is lower than estimate, accept overcharge.
 * 3. Retries are new charges — each execution attempt is independent.
 * 4. Loops are estimated conservatively — inner node cost x configured max iterations.
 * 5. AI workflow creation is charged atomically at request time (1-3 tasks).
 * 6. Cached AI workflows are free — template already paid for.
 * 7. Test/sandbox mode and node testing (ActionTester) are free.
 * 8. Enterprise (limit = -1) — unlimited bypass, but ledger rows are still written.
 * 9. Partial failure — no refund; the upfront reservation stands.
 * 10. Billing period: monthly (30 days free, Stripe period for paid).
 * 11. Period reset: automatic on next deduction if period expired; cron as safety net.
 *
 * Uses the atomic deduct_tasks_if_available RPC:
 * - SELECT ... FOR UPDATE serializes concurrent deductions
 * - Idempotency via (user_id, execution_id, event_type) unique constraint
 * - Auto-resets expired billing periods inline
 * - Returns result_type for callers to distinguish failure reasons
 */

import { logger } from '@/lib/utils/logger'
import { FEATURE_FLAGS } from '@/lib/featureFlags'
import { computeCostPreview } from '@/lib/workflows/cost-preview'
import type { CostPreview } from '@/lib/workflows/cost-preview'

export type TaskDeductionResultType =
  | 'deducted'
  | 'idempotent_replay'
  | 'insufficient_balance'
  | 'subscription_inactive'
  | 'billing_unavailable'

export interface TaskDeductionResult {
  tasksDeducted: number
  newBalance: number | null
  breakdown: Record<string, number>
  /** true = fresh charge applied, false = idempotent replay of prior charge or no charge */
  applied: boolean
  /** Distinguishes failure reasons for caller error mapping */
  resultType: TaskDeductionResultType
  error?: string
  /** Full cost preview for callers that need it (e.g. returning to client) */
  costPreview?: CostPreview
}

/**
 * Atomically deduct tasks from user's balance before workflow execution.
 * Uses the deduct_tasks_if_available RPC for serialized, idempotent billing.
 *
 * FAIL-CLOSED: if the RPC errors, execution is blocked (not silently allowed).
 *
 * Caller behavior for result:
 * - success=TRUE, applied=TRUE  (deducted)          → proceed with execution
 * - success=TRUE, applied=FALSE (idempotent_replay)  → proceed (already authorized)
 * - success=FALSE (insufficient_balance/subscription_inactive/billing_unavailable) → block
 *
 * @param userId - The user who owns the workflow
 * @param estimatedNodes - Nodes from workflow definition (for cost estimation, not executed nodes)
 * @param edges - Workflow edges (source → target), used for loop inner-node detection
 * @param executionSessionId - The execution session ID (idempotency key)
 * @param isTestMode - If true, no tasks are deducted
 * @param options - Optional workflow_id, source, and metadata for ledger tracking
 */
export async function deductTasksAtomic(
  userId: string,
  estimatedNodes: any[],
  edges: Array<{ source: string; target: string }>,
  executionSessionId: string,
  isTestMode: boolean,
  options?: {
    workflowId?: string
    source?: string
    metadata?: Record<string, unknown>
  }
): Promise<TaskDeductionResult> {
  if (isTestMode) {
    return { tasksDeducted: 0, newBalance: null, breakdown: {}, applied: false, resultType: 'deducted' }
  }

  // Compute cost using the authoritative server utility
  const preview = computeCostPreview(estimatedNodes, edges)
  const chargedCost = FEATURE_FLAGS.LOOP_COST_EXPANSION
    ? preview.totalCost
    : preview.flatCost
  const breakdown = preview.breakdown
  const totalCost = chargedCost

  // Audit: log both flat and charged cost for reconciliation
  logger.info('[TaskDeduction] Cost computed', {
    userId,
    executionSessionId,
    flatCost: preview.flatCost,
    chargedCost,
    hasLoops: preview.hasLoops,
    loopExpansionEnabled: FEATURE_FLAGS.LOOP_COST_EXPANSION,
    loopDetails: preview.loopDetails,
  })

  if (totalCost === 0) {
    return { tasksDeducted: 0, newBalance: null, breakdown, applied: false, resultType: 'deducted' }
  }

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const supabase = createAdminClient()

    // Atomic deduction: check balance + deduct + write ledger in one transaction
    const { data: rpcResult, error: rpcError } = await supabase.rpc('deduct_tasks_if_available', {
      p_user_id: userId,
      p_amount: totalCost,
      p_execution_id: executionSessionId,
      p_event_type: 'workflow_execution',
      p_node_breakdown: breakdown,
      p_workflow_id: options?.workflowId,
      p_source: options?.source ?? 'execute_route'
    })

    if (rpcError) {
      logger.error('[TaskDeduction] Atomic deduction RPC failed', {
        userId,
        executionSessionId,
        error: rpcError.message
      })
      // FAIL CLOSED — do not silently allow execution
      return {
        tasksDeducted: 0,
        newBalance: null,
        breakdown,
        applied: false,
        resultType: 'billing_unavailable',
        error: 'Billing system temporarily unavailable. Please retry.'
      }
    }

    const result = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult

    if (!result) {
      logger.error('[TaskDeduction] RPC returned empty result', { userId, executionSessionId })
      return {
        tasksDeducted: 0,
        newBalance: null,
        breakdown,
        applied: false,
        resultType: 'billing_unavailable',
        error: 'Billing system temporarily unavailable. Please retry.'
      }
    }

    const resultType = (result.result_type ?? 'billing_unavailable') as TaskDeductionResultType

    if (!result.success) {
      // Structured failure — caller maps result_type to HTTP status
      const errorMessages: Record<string, string> = {
        insufficient_balance: `Task limit reached. You need ${totalCost} task${totalCost !== 1 ? 's' : ''} but have ${result.remaining ?? 0} remaining. Upgrade your plan for more tasks.`,
        subscription_inactive: 'Your subscription is inactive. Please update your billing to continue.',
        billing_unavailable: 'Billing system temporarily unavailable. Please retry.',
      }

      logger.warn('[TaskDeduction] Deduction rejected', {
        userId,
        executionSessionId,
        resultType,
        tasksNeeded: totalCost,
        remaining: result.remaining
      })

      return {
        tasksDeducted: 0,
        newBalance: result.remaining ?? 0,
        breakdown,
        applied: false,
        resultType,
        error: errorMessages[resultType] ?? 'Billing error. Please retry.'
      }
    }

    // Success path
    const newBalance = result.current_tasks_limit === -1 ? null : (result.remaining ?? 0)

    if (result.applied) {
      logger.info('[TaskDeduction] Tasks deducted', {
        userId,
        executionSessionId,
        tasksDeducted: totalCost,
        newTasksUsed: result.new_tasks_used,
        remaining: newBalance ?? 'unlimited'
      })
    } else {
      logger.info('[TaskDeduction] Idempotent replay for execution', {
        userId,
        executionSessionId,
        tasksDeducted: totalCost
      })
    }

    // Non-blocking: update execution session for backward compatibility
    supabase
      .from('workflow_execution_sessions')
      .update({ tasks_used: totalCost })
      .eq('id', executionSessionId)
      .then(({ error }) => {
        if (error) {
          logger.warn('[TaskDeduction] Failed to update session tasks_used (non-blocking)', {
            executionSessionId,
            error: error.message
          })
        }
      })

    // Phase 1 parallel write: also deduct from user_entitlements via deduct_tasks_v2
    if (process.env.ENTITLEMENTS_V2 === 'true' && result.applied) {
      (supabase as any).rpc('deduct_tasks_v2', {
        p_user_id: userId,
        p_amount: totalCost,
        p_execution_id: executionSessionId,
        p_event_type: 'workflow_execution',
        p_node_breakdown: breakdown,
        p_workflow_id: options?.workflowId ?? null,
        p_source: options?.source ?? 'execute_route'
      }).then(({ error: v2Error }: { error: any }) => {
        if (v2Error) {
          logger.warn('[TaskDeduction] deduct_tasks_v2 parallel write failed (non-blocking)', {
            userId,
            executionSessionId,
            error: v2Error.message,
          })
        } else {
          logger.debug('[TaskDeduction] deduct_tasks_v2 parallel write succeeded', {
            userId,
            executionSessionId,
          })
        }
      })
    }

    // Awaited: persist structured metadata on billing event for Phase 2 history UI
    const metadataStartTime = Date.now()
    const billingMetadata = {
      flat_cost: preview.flatCost,
      charged_cost: chargedCost,
      is_retry: Boolean(options?.metadata?.is_retry),
      original_execution_id: (options?.metadata?.original_execution_id as string) ?? null,
      loop_details: preview.loopDetails.map((d) => ({
        loopNodeId: d.loopNodeId,
        innerNodeIds: d.innerNodeIds,
        innerCost: d.innerCost,
        maxIterations: d.maxIterations,
        expandedCost: d.expandedCost,
      })),
      mode: 'live' as const,
      loop_expansion_enabled: FEATURE_FLAGS.LOOP_COST_EXPANSION,
      preview_version: 1,
    }

    const { error: metaError } = await supabase
      .from('task_billing_events')
      .update({ metadata: JSON.parse(JSON.stringify(billingMetadata)) })
      .eq('execution_id', executionSessionId)
      .eq('user_id', userId)

    const metadataDuration = Date.now() - metadataStartTime
    if (metaError) {
      logger.error('[TaskDeduction] Metadata update failed', {
        userId,
        executionSessionId,
        error: metaError.message,
        durationMs: metadataDuration,
      })
    } else {
      logger.debug('[TaskDeduction] Metadata persisted', {
        executionSessionId,
        durationMs: metadataDuration,
      })
    }

    // Non-blocking: update monthly_usage for billing page display
    try {
      const currentDate = new Date()
      await supabase.rpc('increment_monthly_usage', {
        p_user_id: userId,
        p_year: currentDate.getFullYear(),
        p_month: currentDate.getMonth() + 1,
        p_field: 'execution_count',
        p_increment: totalCost
      })
    } catch (usageErr) {
      logger.warn('[TaskDeduction] monthly_usage update failed (non-blocking)', {
        error: usageErr instanceof Error ? usageErr.message : String(usageErr)
      })
    }

    return {
      tasksDeducted: totalCost,
      newBalance,
      breakdown,
      applied: result.applied ?? true,
      resultType,
      costPreview: preview,
    }
  } catch (error: any) {
    logger.error('[TaskDeduction] Unexpected error', {
      userId,
      executionSessionId,
      error: error.message
    })
    // FAIL CLOSED
    return {
      tasksDeducted: 0,
      newBalance: null,
      breakdown,
      applied: false,
      resultType: 'billing_unavailable',
      error: 'Billing system temporarily unavailable. Please retry.'
    }
  }
}

// `deductExecutionTasks` and `checkTaskBalance` were @deprecated wrappers
// over the atomic deduction path; both removed in §C cleanup
// (zero remaining callers verified at deletion time). The single source of
// truth is `deductTasksAtomic` above. AI-workflow read-only balance checks
// live in `aiWorkflowCostTracking.ts:checkAIWorkflowTaskBalance`.
