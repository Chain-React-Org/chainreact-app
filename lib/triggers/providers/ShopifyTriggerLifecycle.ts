/**
 * Shopify Trigger Lifecycle
 *
 * Manages Shopify webhooks
 * Implements proper lifecycle: create on activate, delete on deactivate/delete
 */

import { createClient } from '@supabase/supabase-js'
import { safeDecrypt } from '@/lib/security/encryption'
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

export class ShopifyTriggerLifecycle implements TriggerLifecycle {

  /**
   * Activate Shopify trigger
   * Creates a webhook subscription
   */
  async onActivate(context: TriggerActivationContext): Promise<void> {
    const { workflowId, userId, nodeId, triggerType, config } = context

    logger.info(`🔔 Activating Shopify trigger for workflow ${workflowId}`, {
      triggerType,
      config
    })

    // Get selected shop from config (set by shopify_store field)
    const selectedShop = config?.shopify_store
    if (!selectedShop) {
      throw new Error('No Shopify store selected. Please configure the trigger with a store.')
    }

    // Find integration that has this shop in metadata.stores
    const { data: integrations, error: intError } = await getSupabase()
      .from('integrations')
      .select('id, access_token, metadata')
      .eq('provider', 'shopify')
      .eq('user_id', userId)

    if (intError) {
      logger.error(`❌ Failed to query Shopify integrations:`, intError)
      throw new Error(`Failed to query Shopify integrations: ${intError.message}`)
    }

    // Find the integration containing this shop
    const integration = integrations?.find(i => {
      const metadata = i.metadata as any
      const stores = metadata?.stores || []
      return stores.some((s: any) => s.shop === selectedShop) ||
             metadata?.shop === selectedShop ||
             metadata?.active_store === selectedShop
    })

    if (!integration) {
      throw new Error(`Shopify integration not found for store: ${selectedShop}`)
    }

    logger.info(`🔍 Found Shopify integration ${integration.id} for shop ${selectedShop}`)

    // Decrypt access token
    const accessToken = typeof integration.access_token === 'string'
      ? safeDecrypt(integration.access_token)
      : null

    if (!accessToken) {
      throw new Error('Failed to decrypt Shopify access token')
    }

    // Use the selected shop as the domain
    const shopDomain = selectedShop

    // Get webhook callback URL
    const webhookUrl = this.getWebhookUrl()

    // Get topic for this trigger type
    const topic = this.getTopicForTrigger(triggerType)

    logger.info(`📤 Creating Shopify webhook`, {
      shopDomain,
      topic,
      webhookUrl
    })

    // Create webhook via Shopify Admin API
    const response = await fetch(`https://${shopDomain}/admin/api/2024-10/webhooks.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        webhook: {
          topic,
          address: `${webhookUrl}?workflowId=${workflowId}`,
          format: 'json'
        }
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to create Shopify webhook: ${response.status} ${errorText}`)
    }

    const data = await response.json()
    const webhook = data.webhook

    // Store in trigger_resources table
    const { error: insertError } = await getSupabase().from('trigger_resources').insert({
      workflow_id: workflowId,
      user_id: userId,
      provider: 'shopify',
      provider_id: 'shopify',
      trigger_type: triggerType,
      node_id: nodeId,
      resource_type: 'webhook',
      resource_id: webhook.id.toString(),
      external_id: webhook.id.toString(),
      config: {
        ...config,
        integrationId: integration.id, // Store integration ID for deactivation
        shopDomain,
        topic,
        webhookUrl: webhook.address
      },
      status: 'active'
    })

    if (insertError) {
      // Check if this is a FK constraint violation (code 23503) - happens for unsaved workflows in test mode
      // The webhook was already created successfully with Shopify, so we can continue
      if (insertError.code === '23503') {
        logger.warn(`⚠️ Could not store trigger resource (workflow may be unsaved): ${insertError.message}`)
        logger.info(`✅ Shopify webhook created (without local record): ${webhook.id}`)
        return
      }
      logger.error(`❌ Failed to store trigger resource:`, insertError)
      throw new Error(`Failed to store trigger resource: ${insertError.message}`)
    }

    logger.info(`✅ Shopify webhook created: ${webhook.id}`)
  }

  /**
   * Deactivate Shopify trigger
   * Deletes the webhook subscription
   */
  async onDeactivate(context: TriggerDeactivationContext): Promise<void> {
    const { workflowId } = context

    logger.info(`🛑 Deactivating Shopify triggers for workflow ${workflowId}`)

    // Get all Shopify webhooks for this workflow
    const { data: resources } = await getSupabase()
      .from('trigger_resources')
      .select('*')
      .eq('workflow_id', workflowId)
      .eq('provider_id', 'shopify')
      .eq('status', 'active')

    if (!resources || resources.length === 0) {
      logger.info(`ℹ️ No active Shopify webhooks for workflow ${workflowId}`)
      return
    }

    // Delete each webhook using the stored integrationId and shopDomain from config
    for (const resource of resources) {
      if (!resource.external_id) {
        // No external ID, just delete the record
        await getSupabase()
          .from('trigger_resources')
          .delete()
          .eq('id', resource.id)
        continue
      }

      // Get integration ID and shop domain from stored config
      const integrationId = resource.config?.integrationId
      const shopDomain = resource.config?.shopDomain

      if (!integrationId || !shopDomain) {
        logger.warn(`⚠️ Missing integrationId or shopDomain in resource config, deleting record`)
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
        .eq('provider', 'shopify')
        .single()

      if (!integration) {
        logger.warn(`⚠️ Shopify integration ${integrationId} not found, deleting record`)
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
          `https://${shopDomain}/admin/api/2024-10/webhooks/${resource.external_id}.json`,
          {
            method: 'DELETE',
            headers: {
              'X-Shopify-Access-Token': accessToken
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

        logger.info(`✅ Deleted Shopify webhook: ${resource.external_id}`)
      } catch (error) {
        logger.error(`❌ Failed to delete webhook ${resource.external_id}:`, error)
        await getSupabase()
          .from('trigger_resources')
          .update({ status: 'error', updated_at: new Date().toISOString() })
          .eq('id', resource.id)
      }
    }
  }

  /**
   * Delete Shopify trigger (same as deactivate)
   */
  async onDelete(context: TriggerDeactivationContext): Promise<void> {
    return this.onDeactivate(context)
  }

  /**
   * Check health of Shopify webhooks
   */
  async checkHealth(workflowId: string, userId: string): Promise<TriggerHealthStatus> {
    const { data: resources } = await getSupabase()
      .from('trigger_resources')
      .select('*')
      .eq('workflow_id', workflowId)
      .eq('provider_id', 'shopify')
      .eq('status', 'active')

    if (!resources || resources.length === 0) {
      return {
        healthy: false,
        details: 'No active webhooks found',
        lastChecked: new Date().toISOString()
      }
    }

    // Shopify webhooks don't expire, so healthy if they exist
    return {
      healthy: true,
      details: `All Shopify webhooks healthy (${resources.length} active)`,
      lastChecked: new Date().toISOString()
    }
  }

  /**
   * Map trigger type to Shopify webhook topic
   */
  private getTopicForTrigger(triggerType: string): string {
    const topicMap: Record<string, string> = {
      // Current trigger types (matching shopify/index.ts)
      'shopify_trigger_new_order': 'orders/create',
      'shopify_trigger_new_paid_order': 'orders/paid',
      'shopify_trigger_order_fulfilled': 'orders/fulfilled',
      'shopify_trigger_abandoned_cart': 'checkouts/create',
      'shopify_trigger_order_updated': 'orders/updated',
      'shopify_trigger_new_customer': 'customers/create',
      'shopify_trigger_product_updated': 'products/update',
      'shopify_trigger_inventory_low': 'inventory_levels/update'
    }

    const topic = topicMap[triggerType]
    if (!topic) {
      throw new Error(`Unknown Shopify trigger type: ${triggerType}`)
    }

    return topic
  }

  /**
   * Get webhook callback URL
   */
  private getWebhookUrl(): string {
    const baseUrl = process.env.NEXT_PUBLIC_WEBHOOK_BASE_URL ||
                    process.env.NEXT_PUBLIC_WEBHOOK_HTTPS_URL ||
                    process.env.PUBLIC_WEBHOOK_BASE_URL

    if (!baseUrl) {
      throw new Error('Webhook base URL not configured')
    }

    return `${baseUrl.replace(/\/$/, '')}/api/webhooks/shopify`
  }
}
