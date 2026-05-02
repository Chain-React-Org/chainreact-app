/**
 * Airtable Trigger Lifecycle
 *
 * Manages webhooks for Airtable triggers
 * Implements proper lifecycle: create on activate, delete on deactivate/delete
 */

import { createClient } from '@supabase/supabase-js'
import { safeDecrypt } from '@/lib/security/encryption'
import { getWebhookUrl } from '@/lib/webhooks/utils'
import {
  TriggerLifecycle,
  TriggerActivationContext,
  TriggerDeactivationContext,
  TriggerHealthStatus
} from '../types'

import { logger } from '@/lib/utils/logger'

// Helper to create supabase client inside handlers
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

export class AirtableTriggerLifecycle implements TriggerLifecycle {

  /**
   * Activate Airtable trigger
   * Creates a webhook for the specified base/table
   */
  async onActivate(context: TriggerActivationContext): Promise<void> {
    const { workflowId, userId, nodeId, triggerType, config } = context

    logger.info(`🔔 Activating Airtable trigger for workflow ${workflowId}`, {
      triggerType,
      baseId: config.baseId,
      tableName: config.tableName
    })

    // baseId can arrive in two shapes:
    //   1. Compound "integrationId:baseId" — emitted by the UI dropdown
    //      (components/workflows/configuration/providers/airtable/airtableOptionsLoader.ts).
    //      This is what production user-created workflows look like.
    //   2. Bare "baseId" — used by tests, AI-generated configs that haven't
    //      been re-saved through the UI, and predefined-template imports
    //      where the user has just typed an ID. Falls back to user_id lookup.
    const baseIdValue = config?.baseId
    if (!baseIdValue) {
      throw new Error('Base ID is required for Airtable trigger')
    }

    let integrationId: string | null = null
    let baseId: string
    let integration: any

    if (baseIdValue.includes(':')) {
      // Compound shape from the UI dropdown.
      [integrationId, baseId] = baseIdValue.split(':')

      // Look up by integration ID
      const { data: foundIntegration } = await getSupabase()
        .from('integrations')
        .select('id, access_token')
        .eq('id', integrationId)
        .eq('provider', 'airtable')
        .single()

      integration = foundIntegration

      if (!integration) {
        throw new Error(`Airtable integration not found (ID: ${integrationId})`)
      }
    } else {
      // Bare-baseId shape — fall back to user_id lookup.
      baseId = baseIdValue

      const { data: foundIntegration } = await getSupabase()
        .from('integrations')
        .select('id, access_token')
        .eq('user_id', userId)
        .eq('provider', 'airtable')
        .single()

      integration = foundIntegration
      integrationId = integration?.id

      if (!integration) {
        throw new Error('Airtable integration not found for user')
      }
    }

    // Decrypt access token
    const accessToken = typeof integration.access_token === 'string'
      ? safeDecrypt(integration.access_token)
      : null

    if (!accessToken) {
      throw new Error('Failed to decrypt Airtable access token')
    }

    const { tableName } = config

    // Get webhook callback URL
    const webhookUrl = this.getWebhookUrl()

    logger.info(`📤 Creating Airtable webhook`, {
      baseId,
      tableName: tableName || 'all tables',
      webhookUrl
    })

    // Create webhook specification
    const spec: any = {}

    // Filter by table if specified
    if (tableName) {
      spec.options = {
        filters: {
          dataTypes: ['tableData'],
          recordChangeScope: tableName
        }
      }
    }

    // Create webhook in Airtable
    const response = await fetch(`https://api.airtable.com/v0/bases/${baseId}/webhooks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        notificationUrl: `${webhookUrl}?workflowId=${workflowId}`,
        specification: spec
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to create Airtable webhook: ${response.status} ${errorText}`)
    }

    const webhook = await response.json()

    // Store in trigger_resources table
    const { error: insertError } = await getSupabase().from('trigger_resources').insert({
      workflow_id: workflowId,
      user_id: userId,
      provider: 'airtable',
      provider_id: 'airtable',
      trigger_type: triggerType,
      node_id: nodeId,
      resource_type: 'webhook',
      resource_id: webhook.id,
      external_id: webhook.id,
      config: {
        integrationId, // Store integration ID for deactivation
        baseId,
        tableName,
        webhookUrl: webhook.notificationUrl,
        macSecretBase64: webhook.macSecretBase64
      },
      status: 'active',
      expires_at: webhook.expirationTime ? new Date(webhook.expirationTime).toISOString() : null
    })

    if (insertError) {
      // Check if this is a FK constraint violation (code 23503) - happens for unsaved workflows in test mode
      // The webhook was already created successfully with Airtable, so we can continue
      if (insertError.code === '23503') {
        logger.warn(`⚠️ Could not store trigger resource (workflow may be unsaved): ${insertError.message}`)
        logger.info(`✅ Airtable webhook created (without local record): ${webhook.id}`)
        return
      }
      logger.error(`❌ Failed to store trigger resource:`, insertError)
      throw new Error(`Failed to store trigger resource: ${insertError.message}`)
    }

    logger.info(`✅ Airtable webhook created: ${webhook.id}`)
  }

  /**
   * Deactivate Airtable trigger
   * Deletes the webhook
   */
  async onDeactivate(context: TriggerDeactivationContext): Promise<void> {
    const { workflowId } = context

    logger.info(`🛑 Deactivating Airtable triggers for workflow ${workflowId}`)

    // Get all Airtable webhooks for this workflow
    const { data: resources } = await getSupabase()
      .from('trigger_resources')
      .select('*')
      .eq('workflow_id', workflowId)
      .eq('provider_id', 'airtable')
      .eq('status', 'active')

    if (!resources || resources.length === 0) {
      logger.info(`ℹ️ No active Airtable webhooks for workflow ${workflowId}`)
      return
    }

    // Delete each webhook using the stored integrationId and baseId from config
    for (const resource of resources) {
      if (!resource.external_id || !resource.config?.baseId) {
        // No external ID or baseId, just delete the record
        await getSupabase()
          .from('trigger_resources')
          .delete()
          .eq('id', resource.id)
        continue
      }

      // Get integration ID from stored config
      const integrationId = resource.config?.integrationId
      const baseId = resource.config.baseId
      const webhookId = resource.external_id

      if (!integrationId) {
        logger.warn(`⚠️ Missing integrationId in resource config, deleting record`)
        await getSupabase()
          .from('trigger_resources')
          .delete()
          .eq('id', resource.id)
        continue
      }

      // Get access token for this specific integration
      const { data: integration } = await getSupabase()
        .from('integrations')
        .select('access_token')
        .eq('id', integrationId)
        .eq('provider', 'airtable')
        .single()

      if (!integration) {
        logger.warn(`⚠️ Airtable integration ${integrationId} not found, deleting record`)
        await getSupabase()
          .from('trigger_resources')
          .delete()
          .eq('id', resource.id)
        continue
      }

      // Decrypt access token
      const accessToken = typeof integration.access_token === 'string'
        ? safeDecrypt(integration.access_token)
        : null

      if (!accessToken) {
        logger.warn(`⚠️ Failed to decrypt access token for integration ${integrationId}, deleting record`)
        await getSupabase()
          .from('trigger_resources')
          .delete()
          .eq('id', resource.id)
        continue
      }

      try {
        const response = await fetch(
          `https://api.airtable.com/v0/bases/${baseId}/webhooks/${webhookId}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          }
        )

        if (!response.ok && response.status !== 404) {
          throw new Error(`Failed to delete webhook: ${response.status}`)
        }

        // Mark as deleted in trigger_resources
        await getSupabase()
          .from('trigger_resources')
          .delete()
          .eq('id', resource.id)

        logger.info(`✅ Deleted Airtable webhook: ${webhookId}`)
      } catch (error) {
        logger.error(`❌ Failed to delete webhook ${resource.external_id}:`, error)
        // Mark as error but continue with others
        await getSupabase()
          .from('trigger_resources')
          .update({ status: 'error', updated_at: new Date().toISOString() })
          .eq('id', resource.id)
      }
    }
  }

  /**
   * Delete Airtable trigger (same as deactivate)
   */
  async onDelete(context: TriggerDeactivationContext): Promise<void> {
    return this.onDeactivate(context)
  }

  /**
   * Check health of Airtable webhooks
   */
  async checkHealth(workflowId: string, userId: string): Promise<TriggerHealthStatus> {
    const { data: resources } = await getSupabase()
      .from('trigger_resources')
      .select('*')
      .eq('workflow_id', workflowId)
      .eq('provider_id', 'airtable')
      .eq('status', 'active')

    if (!resources || resources.length === 0) {
      return {
        healthy: false,
        details: 'No active webhooks found',
        lastChecked: new Date().toISOString()
      }
    }

    // Check if any webhooks are expiring soon (within 7 days)
    const now = new Date()
    const expiringThreshold = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    const expiringSoon = resources.some(r => {
      if (!r.expires_at) return false
      return new Date(r.expires_at) < expiringThreshold
    })

    const nearestExpiration = resources
      .filter(r => r.expires_at)
      .map(r => new Date(r.expires_at!))
      .sort((a, b) => a.getTime() - b.getTime())[0]

    return {
      healthy: !expiringSoon,
      details: expiringSoon
        ? `Webhook expiring soon: ${nearestExpiration?.toISOString()}`
        : `All webhooks healthy (${resources.length} active)`,
      expiresAt: nearestExpiration?.toISOString(),
      lastChecked: new Date().toISOString()
    }
  }

  /**
   * Get webhook callback URL
   */
  private getWebhookUrl(): string {
    return getWebhookUrl('/api/workflow/airtable')
  }
}
