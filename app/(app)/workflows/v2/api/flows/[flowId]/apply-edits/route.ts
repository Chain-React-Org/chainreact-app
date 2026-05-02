import { NextResponse } from "next/server"
import { z } from "zod"

import { FlowSchema } from "@/src/lib/workflows/builder/schema"
import { getRouteClient, getFlowRepository, getServiceClient, checkWorkflowAccess } from "@/src/lib/workflows/builder/api/helpers"
import { triggerLifecycleManager } from "@/lib/triggers"
import { logger } from "@/lib/utils/logger"

/**
 * Detect if any trigger TYPE changed between existing resources and new nodes.
 * Config changes within the same type do NOT trigger this - only actual type changes.
 *
 * @param existingResources - Current trigger_resources from database
 * @param newTriggerNodes - New trigger nodes from the flow
 * @returns true if any trigger TYPE changed
 */
function detectTriggerTypeChange(
  existingResources: Array<{ node_id: string; trigger_type: string }>,
  newTriggerNodes: Array<{ id: string; type: string }>
): boolean {
  // Build a map of existing trigger types by node ID
  const existingTypeByNodeId = new Map(
    existingResources.map(r => [r.node_id, r.trigger_type])
  )

  // Check each new trigger node
  for (const newNode of newTriggerNodes) {
    const existingType = existingTypeByNodeId.get(newNode.id)

    // If this node has an existing resource with a different type, it's a type change
    if (existingType && existingType !== newNode.type) {
      logger.info(`[apply-edits] Detected trigger type change for node ${newNode.id}: ${existingType} → ${newNode.type}`)
      return true
    }
  }

  return false
}

/**
 * Check if a trigger node has meaningful configuration beyond just the preserved
 * keys from replaceNode (e.g., integration_id).
 *
 * When a user replaces a trigger on an active workflow, the new node starts with
 * config {} or { integration_id: "..." }. Attempting to activate such a trigger
 * will always fail (missing channel, folder, workspace, etc.) and should be skipped.
 * The trigger will be activated later when the user saves real configuration.
 */
function isTriggerConfigured(config: Record<string, any> | undefined | null): boolean {
  if (!config) return false
  const nonConfigKeys = new Set(['integration_id'])
  const meaningfulKeys = Object.keys(config).filter(key => !nonConfigKeys.has(key))
  return meaningfulKeys.length > 0
}

const ApplyEditsSchema = z.object({
  flow: FlowSchema,
  expectedVersion: z.number().optional(),
})

export async function POST(request: Request, context: { params: Promise<{ flowId: string }> }) {
  const { flowId } = await context.params

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = ApplyEditsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.format() }, { status: 400 })
  }

  const rawFlow = { ...parsed.data.flow, id: flowId }

  // Log original size
  const originalSize = JSON.stringify(rawFlow).length
  console.log(`[apply-edits] Original flow size: ${originalSize} bytes (${(originalSize / 1024).toFixed(2)} KB)`)

  // Sanitize flow: remove test data and validation results from node configs
  const sanitizedFlow = {
    ...rawFlow,
    nodes: rawFlow.nodes?.map((node: any) => {
      const sanitizedConfig = { ...node.config }
      // Remove test-related fields that start with __test or __validation
      Object.keys(sanitizedConfig).forEach(key => {
        if (key.startsWith('__test') || key.startsWith('__validation') || key.startsWith('__options')) {
          delete sanitizedConfig[key]
        }
      })
      return {
        ...node,
        config: sanitizedConfig
      }
    }) || []
  }

  const sanitizedSize = JSON.stringify(sanitizedFlow).length
  console.log(`[apply-edits] Sanitized flow size: ${sanitizedSize} bytes (${(sanitizedSize / 1024).toFixed(2)} KB), saved ${originalSize - sanitizedSize} bytes`)

  const flow = FlowSchema.parse(sanitizedFlow)

  const supabase = await getRouteClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  // Check workflow access using service client (bypasses RLS) with explicit authorization
  // Requires 'editor' role for modifying workflows
  const accessCheck = await checkWorkflowAccess(flowId, user.id, 'editor')

  if (!accessCheck.hasAccess) {
    const status = accessCheck.error === "Flow not found" ? 404 : 403
    return NextResponse.json({ ok: false, error: accessCheck.error }, { status })
  }

  const existingWorkflow = accessCheck.workflow!

  // Use service client to bypass RLS on workflows and workflows_revisions tables
  const serviceClient = await getServiceClient()
  const repository = await getFlowRepository(serviceClient)

  // Use service client for update since we've already verified access
  const { error: definitionError } = await serviceClient
    .from("workflows")
    .update({ name: flow.name, updated_at: new Date().toISOString() })
    .eq("id", flowId)

  if (definitionError) {
    return NextResponse.json({ ok: false, error: definitionError.message }, { status: 500 })
  }

  try {
    // Concurrency check: reject stale writes before any graph persistence.
    // If the client sends expectedVersion and it doesn't match the current version,
    // return 409 Conflict with the current flow so the client can reconcile.
    if (typeof parsed.data.expectedVersion === 'number') {
      const currentRevision = await repository.getLatestRevision(flowId)
      const currentVersion = currentRevision?.version ?? 0
      if (parsed.data.expectedVersion !== currentVersion) {
        logger.info(`[apply-edits] Version conflict: client=${parsed.data.expectedVersion}, server=${currentVersion}`)
        return NextResponse.json({
          ok: false,
          error: 'Version conflict',
          currentVersion,
          flow: currentRevision?.graph ?? null,
        }, { status: 409 })
      }
    }

    // Save to normalized tables (workflow_nodes, workflow_edges)
    // AND create a revision snapshot for history
    const revision = await repository.saveGraph(flowId, flow, user.id)

    // Track trigger activation errors - if activation fails on an active workflow,
    // we need to deactivate the workflow and inform the user
    let triggerActivationError: { message: string; details: string[] } | null = null

    // Clean up orphaned trigger resources for nodes that were removed
    // This runs after revision is saved to ensure we don't lose trigger data on failed saves
    try {
      const currentNodeIds = flow.nodes?.map((node: any) => node.id) || []
      const cleanupResult = await triggerLifecycleManager.cleanupRemovedTriggerNodes(
        flowId,
        user.id,
        currentNodeIds
      )
      if (cleanupResult.deletedCount > 0) {
        logger.info(`[apply-edits] Cleaned up ${cleanupResult.deletedCount} orphaned trigger resources for workflow ${flowId}`)
      }
      if (cleanupResult.errors.length > 0) {
        logger.warn(`[apply-edits] Trigger cleanup had errors: ${cleanupResult.errors.join(', ')}`)
      }
    } catch (cleanupError) {
      // Don't fail the entire request if cleanup fails - log and continue
      logger.error('[apply-edits] Failed to cleanup orphaned triggers:', cleanupError)
    }

    // For active workflows, activate any NEW trigger nodes that don't have resources yet
    // This handles the case where a trigger node is REPLACED (old node removed, new node added)
    // The cleanup above removes old trigger resources, but we need to create new ones
    const triggerNodes = (flow.nodes || []).filter((n: any) => n.metadata?.isTrigger)
    if (existingWorkflow.status === 'active' && triggerNodes.length > 0) {
      try {
        // Get existing trigger resources (after cleanup)
        const { data: existingResources } = await serviceClient
          .from('trigger_resources')
          .select('node_id')
          .eq('workflow_id', flowId)
          .or('is_test.is.null,is_test.eq.false')

        const existingNodeIds = new Set((existingResources || []).map((r: any) => r.node_id))

        // Find trigger nodes that don't have resources yet
        const newTriggerNodesAll = triggerNodes.filter((n: any) => !existingNodeIds.has(n.id))

        // Skip unconfigured triggers - these are freshly replaced nodes the user
        // hasn't configured yet. They'll be activated when the user saves config.
        const newTriggerNodes = newTriggerNodesAll.filter((n: any) => isTriggerConfigured(n.config))
        if (newTriggerNodesAll.length > newTriggerNodes.length) {
          logger.info(`[apply-edits] Skipping ${newTriggerNodesAll.length - newTriggerNodes.length} unconfigured trigger(s) - will activate when configured`)
        }

        if (newTriggerNodes.length > 0) {
          logger.info(`[apply-edits] Found ${newTriggerNodes.length} new trigger(s) in active workflow - activating`)

          const legacyNodes = newTriggerNodes.map((n: any) => ({
            id: n.id,
            data: {
              type: n.type,
              isTrigger: true,
              providerId: n.metadata?.providerId,
              config: n.config
            }
          }))

          const activationResult = await triggerLifecycleManager.activateWorkflowTriggers(
            flowId,
            user.id,
            legacyNodes
          )

          if (activationResult.errors.length > 0) {
            logger.error(`[apply-edits] New trigger activation failed: ${activationResult.errors.join(', ')}`)
            triggerActivationError = {
              message: 'Failed to activate new trigger',
              details: activationResult.errors
            }
            // Roll back workflow to inactive since trigger is broken
            try {
              await serviceClient
                .from('workflows')
                .update({ status: 'inactive', updated_at: new Date().toISOString() })
                .eq('id', flowId)
              logger.info(`[apply-edits] Rolled back workflow ${flowId} to inactive due to trigger activation failure`)
            } catch (rollbackErr) {
              logger.error('[apply-edits] Failed to roll back workflow status:', rollbackErr)
            }
          } else {
            logger.info(`[apply-edits] Successfully activated ${newTriggerNodes.length} new trigger(s)`)
          }
        }
      } catch (activationError) {
        logger.error('[apply-edits] Failed to activate new triggers:', activationError)
        triggerActivationError = {
          message: 'Failed to activate new trigger',
          details: [activationError instanceof Error ? activationError.message : 'Unknown error']
        }
        // Roll back workflow to inactive since trigger is broken
        try {
          await serviceClient
            .from('workflows')
            .update({ status: 'inactive', updated_at: new Date().toISOString() })
            .eq('id', flowId)
          logger.info(`[apply-edits] Rolled back workflow ${flowId} to inactive due to trigger activation failure`)
        } catch (rollbackErr) {
          logger.error('[apply-edits] Failed to roll back workflow status:', rollbackErr)
        }
      }
    }

    // Auto-deactivate workflow if it's active but no longer has any triggers
    // A workflow without triggers can't run, so it should be deactivated
    // Note: triggerNodes is already defined above
    if (existingWorkflow.status === 'active' && triggerNodes.length === 0) {
      try {
        logger.info(`[apply-edits] Auto-deactivating workflow ${flowId} - no triggers remaining`)

        // Deactivate any remaining trigger resources
        await triggerLifecycleManager.deactivateWorkflowTriggers(flowId, user.id)

        // Update workflow status to draft
        const { error: deactivateError } = await serviceClient
          .from('workflows')
          .update({
            status: 'draft',
            updated_at: new Date().toISOString()
          })
          .eq('id', flowId)

        if (deactivateError) {
          logger.error('[apply-edits] Failed to auto-deactivate workflow:', deactivateError)
        } else {
          logger.info(`[apply-edits] Successfully auto-deactivated workflow ${flowId}`)
        }
      } catch (deactivateError) {
        logger.error('[apply-edits] Failed to auto-deactivate workflow:', deactivateError)
      }
    }

    // Handle trigger TYPE changes in active workflows
    // When trigger type changes, do full deactivate + reactivate to ensure clean state
    // Skip if we already have a trigger activation error from the new-trigger path above
    if (existingWorkflow.status === 'active' && !triggerActivationError) {
      try {
        // Get existing trigger resources
        const { data: existingResources } = await serviceClient
          .from('trigger_resources')
          .select('node_id, trigger_type')
          .eq('workflow_id', flowId)
          .or('is_test.is.null,is_test.eq.false')

        // Get new trigger nodes from the flow
        const newTriggerNodes = (flow.nodes || []).filter((n: any) => n.metadata?.isTrigger)

        // Check if any trigger TYPE changed
        const triggerTypeChanged = detectTriggerTypeChange(existingResources || [], newTriggerNodes)

        if (triggerTypeChanged) {
          logger.info(`[apply-edits] Trigger TYPE changed in active workflow ${flowId} - doing full deactivate + reactivate`)

          // Deactivate all existing triggers
          await triggerLifecycleManager.deactivateWorkflowTriggers(flowId, user.id)

          // Skip reactivation for unconfigured triggers (freshly replaced nodes)
          const configuredTriggerNodes = newTriggerNodes.filter((n: any) => isTriggerConfigured(n.config))

          if (configuredTriggerNodes.length === 0) {
            logger.info(`[apply-edits] All triggers unconfigured after type change - skipping reactivation, will activate when configured`)
          } else {
            // Reactivate with new trigger configuration. activateWorkflowTriggers
            // expects ReactFlow node shape ({ id, data: { type, isTrigger, ... } }),
            // so reshape from the Flow v2 shape ({ id, type, config, metadata }).
            const reactFlowNodes = configuredTriggerNodes.map((n: any) => ({
              id: n.id,
              data: {
                type: n.type,
                isTrigger: true,
                providerId: n.metadata?.providerId,
                config: n.config
              }
            }))

            const activationResult = await triggerLifecycleManager.activateWorkflowTriggers(
              flowId,
              user.id,
              reactFlowNodes
            )

            if (activationResult.errors.length > 0) {
              logger.error(`[apply-edits] Trigger reactivation failed: ${activationResult.errors.join(', ')}`)
              triggerActivationError = {
                message: 'Failed to reactivate trigger after type change',
                details: activationResult.errors
              }
              // Roll back workflow to inactive since trigger is broken
              try {
                await serviceClient
                  .from('workflows')
                  .update({ status: 'inactive', updated_at: new Date().toISOString() })
                  .eq('id', flowId)
                logger.info(`[apply-edits] Rolled back workflow ${flowId} to inactive due to trigger reactivation failure`)
              } catch (rollbackErr) {
                logger.error('[apply-edits] Failed to roll back workflow status:', rollbackErr)
              }
            } else {
              logger.info(`[apply-edits] Successfully reactivated ${configuredTriggerNodes.length} triggers`)
            }
          }
        }
      } catch (triggerError) {
        logger.error('[apply-edits] Failed to handle trigger type change:', triggerError)
        triggerActivationError = {
          message: 'Failed to reactivate trigger after type change',
          details: [triggerError instanceof Error ? triggerError.message : 'Unknown error']
        }
        // Roll back workflow to inactive since trigger is broken
        try {
          await serviceClient
            .from('workflows')
            .update({ status: 'inactive', updated_at: new Date().toISOString() })
            .eq('id', flowId)
          logger.info(`[apply-edits] Rolled back workflow ${flowId} to inactive due to trigger reactivation failure`)
        } catch (rollbackErr) {
          logger.error('[apply-edits] Failed to roll back workflow status:', rollbackErr)
        }
      }
    }

    // Fetch the current workflow status to return to the client
    // This is important because the status may have been auto-updated (e.g., auto-deactivation)
    const { data: updatedWorkflow } = await serviceClient
      .from('workflows')
      .select('status')
      .eq('id', flowId)
      .single()

    return NextResponse.json({
      ok: true,
      flow: revision.graph,
      revisionId: revision.id,
      version: revision.version,
      workflowStatus: updatedWorkflow?.status || existingWorkflow.status,
      ...(triggerActivationError ? { triggerActivationError } : {}),
    })
  } catch (error: any) {
    console.error('[apply-edits] Failed to create revision:', error)
    return NextResponse.json({
      ok: false,
      error: error.message || 'Failed to create revision',
      details: error.toString()
    }, { status: 500 })
  }
}
