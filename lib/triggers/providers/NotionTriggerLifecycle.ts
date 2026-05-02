import { TriggerLifecycle, TriggerActivationContext, TriggerDeactivationContext, TriggerHealthStatus } from '../types'
import { createSupabaseServerClient } from '@/utils/supabase/server'
import { decrypt } from '@/lib/security/encryption'
import { getWebhookUrl } from '@/lib/webhooks/utils'

import { logger } from '@/lib/utils/logger'

/**
 * Notion Trigger Lifecycle Manager
 *
 * Manages webhook subscriptions for Notion triggers.
 *
 * IMPORTANT: Notion webhooks must be created manually through the integration UI at
 * https://www.notion.so/my-integrations - there is no API endpoint for programmatic creation.
 *
 * This lifecycle manager stores the necessary configuration in the database and provides
 * setup instructions to the user.
 */
export class NotionTriggerLifecycle implements TriggerLifecycle {

  async onActivate(context: TriggerActivationContext): Promise<void> {
    const { workflowId, userId, nodeId, triggerType, config } = context

    logger.info('[Notion Trigger] Activating trigger')

    // Get Notion integration
    const supabase = await createSupabaseServerClient()
    const { data: integration } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'notion')
      .eq('status', 'connected')
      .single()

    if (!integration) {
      throw new Error('Notion integration not found or not connected')
    }

    // Get workspace access token
    const workspaceId = config?.workspace
    if (!workspaceId) {
      throw new Error('Workspace ID is required for Notion triggers')
    }

    const workspaces = integration.metadata?.workspaces || {}
    const workspace = workspaces[workspaceId]

    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found in integration`)
    }

    // Decrypt access token
    const encryptionKey = process.env.ENCRYPTION_KEY!
    const accessToken = decrypt(workspace.access_token, encryptionKey)

    // Get database and data source info using new API (2025-09-03)
    const databaseId = config?.database
    let dataSourceId = config?.dataSource // New field for data source

    if (databaseId && !dataSourceId) {
      // Fetch data source ID from database
      try {
        // Add timeout to prevent hanging on slow API responses
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout

        const dbResponse = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (dbResponse.ok) {
          const dbData = await dbResponse.json()
          // Get the first (or default) data source
          if (dbData.data_sources && dbData.data_sources.length > 0) {
            dataSourceId = dbData.data_sources[0].id
            logger.info('[Notion Trigger] Auto-detected data source for trigger activation')
          }
        }
      } catch (err) {
        // Log error without sensitive details
        logger.warn('[Notion Trigger] Failed to fetch data source metadata, using database ID fallback')
      }
    }

    // Store configuration for manual webhook setup
    // Generate workflow-specific webhook URL with routing parameters
    const webhookUrl = `${getWebhookUrl('/api/webhooks/notion')}?workflowId=${workflowId}&nodeId=${nodeId}`
    const eventTypes = this.getNotionEventTypes(triggerType)

    logger.info('[Notion Trigger] Preparing webhook configuration')
    logger.info('[Notion Trigger] Webhook URL:', webhookUrl)
    logger.info('[Notion Trigger] Event types:', eventTypes)
    logger.info('[Notion Trigger] Target:', dataSourceId ? `data_source ${dataSourceId}` : `database ${databaseId}`)

    // Generate a unique identifier for this trigger to match with incoming webhooks
    const triggerId = `${workflowId}-${nodeId}`

    // Store trigger configuration for webhook processing
    // Note: Notion webhook is configured once at the integration level, not per-user
    const { data: resource, error } = await supabase
      .from('trigger_resources')
      .insert({
        workflow_id: workflowId,
        user_id: userId,
        node_id: nodeId,
        provider: 'notion',
        provider_id: 'notion',
        trigger_type: triggerType,
        resource_type: 'webhook',
        resource_id: triggerId,
        external_id: triggerId,
        status: 'active', // Webhook is configured at integration level, so trigger is immediately active
        config: {
          workspace: workspaceId,
          database: databaseId,
          dataSourceId: dataSourceId // Store data source ID for filtering (matches processor expectations)
        },
        metadata: {
          apiVersion: '2022-06-28',
          eventTypes: eventTypes,
          targetResource: dataSourceId || databaseId,
          targetType: dataSourceId ? 'data_source' : 'database'
        }
      })
      .select()
      .single()

    if (error) {
      // Check if this is a FK constraint violation (code 23503) - happens for unsaved workflows in test mode
      if (error.code === '23503') {
        logger.warn(`[Notion Trigger] Could not store trigger resource (workflow may be unsaved): ${error.message}`)
        logger.info('[Notion Trigger] Trigger configured (without local record)')
        return
      }
      logger.error('[Notion Trigger] Failed to store trigger resource')
      throw new Error(`Failed to activate Notion trigger: ${error.message}`)
    }

    logger.info('[Notion Trigger] Trigger activated successfully')
  }

  async onDeactivate(context: TriggerDeactivationContext): Promise<void> {
    const { workflowId } = context

    logger.info('[Notion Trigger] Deactivating triggers')

    const supabase = await createSupabaseServerClient()

    // Delete trigger resources from database
    // Note: Webhook subscription remains at the integration level and continues to work for other workflows
    const { error } = await supabase
      .from('trigger_resources')
      .delete()
      .eq('workflow_id', workflowId)
      .eq('provider_id', 'notion')

    if (error) {
      logger.error('[Notion Trigger] Failed to delete trigger resources')
      throw new Error(`Failed to deactivate Notion triggers: ${error.message}`)
    }

    logger.info('[Notion Trigger] Triggers deactivated')
  }

  async onDelete(context: TriggerDeactivationContext): Promise<void> {
    // Same as deactivate for Notion
    await this.onDeactivate(context)
  }

  async checkHealth(workflowId: string, userId: string): Promise<TriggerHealthStatus> {
    const supabase = await createSupabaseServerClient()

    // Check if trigger resources exist
    const { data: resources, error } = await supabase
      .from('trigger_resources')
      .select('*')
      .eq('workflow_id', workflowId)
      .eq('provider_id', 'notion')

    if (error) {
      return {
        healthy: false,
        details: `Health check failed: ${error.message}`,
        lastChecked: new Date().toISOString()
      }
    }

    if (!resources || resources.length === 0) {
      return {
        healthy: false,
        details: 'No Notion trigger resources found',
        lastChecked: new Date().toISOString()
      }
    }

    // Check if Notion integration is still connected
    const { data: integration } = await supabase
      .from('integrations')
      .select('status')
      .eq('user_id', userId)
      .eq('provider', 'notion')
      .single()

    if (!integration || integration.status !== 'connected') {
      return {
        healthy: false,
        details: 'Notion integration is not connected - please reconnect',
        lastChecked: new Date().toISOString()
      }
    }

    // Check trigger status
    const resource = resources[0]
    const status = resource.status

    if (status !== 'active') {
      return {
        healthy: false,
        details: `Trigger is not active (status: ${status})`,
        lastChecked: new Date().toISOString()
      }
    }

    return {
      healthy: true,
      details: 'Notion trigger is active',
      lastChecked: new Date().toISOString()
    }
  }

  /**
   * Get Notion API event types for webhook subscription
   * These are the actual event types Notion API expects
   * Supports both legacy event names and new data source API (2025-09-03) event names
   */
  private getNotionEventTypes(triggerType: string): string[] {
    switch (triggerType) {
      // Comment triggers
      case 'notion_trigger_comment_added':
      case 'notion_trigger_new_comment':
        return ['comment.created']

      // Database item triggers - includes new data_source.row events
      case 'notion_trigger_database_item_created':
        return [
          'page.created',
          'data_source.row_created'  // New API event
        ]
      case 'notion_trigger_database_item_updated':
        return [
          'page.updated',
          'page.content_updated',
          'page.property_values_updated',
          'page.properties_updated',
          'data_source.row_updated'  // New API event
        ]

      // Granular page triggers - includes new data_source events
      case 'notion_trigger_page_content_updated':
        return [
          'page.content_updated',
          'block.created',
          'block.updated',
          'block.deleted',
          'data_source.row_content_updated'  // New API event (if exists)
        ]
      case 'notion_trigger_page_properties_updated':
        return [
          'page.property_values_updated',
          'page.properties_updated',
          'data_source.row_updated',  // New API - property value changes
          'data_source.row_property_updated',  // New API - specific property change
          'data_source.schema_updated'  // When properties are added/removed/modified
        ]

      // Database schema trigger
      case 'notion_trigger_database_schema_updated':
        return [
          'database.updated',
          'data_source.schema_updated'
        ]

      default:
        return []
    }
  }

  // `getSupportedEventsForTrigger` was @deprecated and had zero callers
  // (the method was private with no internal references either). Removed
  // in §B sweep — 2026-05-02. Use `getNotionEventTypes` directly.
}
