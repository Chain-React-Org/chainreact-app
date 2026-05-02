/**
 * Microsoft Graph Trigger Lifecycle
 *
 * Manages subscriptions for Microsoft Graph triggers (Outlook, Teams, OneDrive, Excel)
 * Implements proper lifecycle: create on activate, delete on deactivate/delete
 */

import { createClient } from '@supabase/supabase-js'
import { MicrosoftGraphSubscriptionManager } from '@/lib/microsoft-graph/subscriptionManager'
import { MicrosoftGraphAuth } from '@/lib/microsoft-graph/auth'
import { safeDecrypt } from '@/lib/security/encryption'
import crypto from 'crypto'
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

export class MicrosoftGraphTriggerLifecycle implements TriggerLifecycle {
  private subscriptionManager = new MicrosoftGraphSubscriptionManager()
  private graphAuth = new MicrosoftGraphAuth()

  /**
   * Activate Microsoft Graph trigger
   * Creates a subscription for the specific resource
   */
  async onActivate(context: TriggerActivationContext): Promise<void> {
    const { workflowId, userId, nodeId, triggerType, config, testMode } = context

    const modeLabel = testMode ? '🧪 TEST' : '🔔 PRODUCTION'
    logger.info(`${modeLabel} Activating Microsoft Graph trigger for workflow ${workflowId}`, {
      triggerType,
      configKeys: Object.keys(config || {}),
      testSessionId: testMode?.testSessionId
    })

    // Get valid access token (automatically refreshes if expired)
    // Determine the provider based on trigger type
    const provider = this.getProviderFromTriggerType(triggerType)

    let accessToken: string
    try {
      accessToken = await this.graphAuth.getValidAccessToken(userId, provider)
      logger.info(`✅ Retrieved valid Microsoft Graph access token for provider: ${provider}`)
    } catch (error) {
      logger.error('❌ Failed to get valid Microsoft Graph token:', error)
      throw new Error(`Microsoft ${provider} integration not connected or token expired. Please reconnect your Microsoft ${provider} account.`)
    }

    // Determine resource based on trigger type
    if (triggerType.startsWith('microsoft_excel_')) {
      await this.ensureExcelDriveId(config, accessToken)
    }
    if (triggerType.startsWith('microsoft_excel_')) {
      config.pollingEnabled = true
    }
    const resource = this.getResourceForTrigger(triggerType, config)
    const changeType = this.getChangeTypeForTrigger(triggerType)

    if (!resource) {
      throw new Error(`Unknown Microsoft Graph trigger type: ${triggerType}`)
    }

    // Test the token by calling appropriate endpoint to verify permissions
    logger.info('🧪 Testing token permissions...')
    try {
      const meResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      })

      if (!meResponse.ok) {
        logger.error('❌ /me call failed:', meResponse.status, meResponse.statusText)
      } else {
        logger.info('✅ /me call succeeded')
      }

      // Test provider-specific permissions
      if (provider === 'microsoft-outlook') {
        const messagesResponse = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=1', {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        })

        if (!messagesResponse.ok) {
          const errorText = await messagesResponse.text()
          logger.error('❌ /me/messages call failed:', messagesResponse.status, messagesResponse.statusText)
          logger.error('   Error details:', errorText)
          throw new Error(`Token lacks Mail.Read permission. Status: ${messagesResponse.status}. Please reconnect Microsoft Outlook integration.`)
        } else {
          logger.info('✅ /me/messages call succeeded - token has mail read permission')
        }
      }
      if (provider === 'onedrive') {
        const driveResponse = await fetch('https://graph.microsoft.com/v1.0/me/drive?$select=id,name', {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        })

        if (!driveResponse.ok) {
          const errorText = await driveResponse.text()
          logger.error('❌ /me/drive call failed:', driveResponse.status, driveResponse.statusText)
          logger.error('   Error details:', errorText)
          throw new Error(`Token lacks OneDrive permissions. Status: ${driveResponse.status}. Please reconnect Microsoft OneDrive integration.`)
        } else {
          logger.info('✅ /me/drive call succeeded - token has OneDrive permissions')
        }
      }
      // Add other providers (Teams) here as needed
    } catch (testError) {
      logger.error('❌ Token permission test failed:', testError)
      throw testError
    }

    logger.info(`📤 Creating Microsoft Graph subscription`, {
      resource,
      changeType,
      workflowId
    })

    // Create subscription - use test URL if in test mode
    const subscription = await this.subscriptionManager.createSubscription({
      resource,
      changeType,
      userId,
      accessToken: accessToken,
      testSessionId: testMode?.testSessionId // Pass test session for URL isolation
    })

    // Store in trigger_resources table with test mode fields
    const { error: insertError } = await getSupabase().from('trigger_resources').insert({
      workflow_id: workflowId,
      user_id: userId,
      provider: 'microsoft',
      provider_id: 'microsoft',
      trigger_type: triggerType,
      node_id: nodeId,
      resource_type: 'subscription',
      resource_id: subscription.id,
      external_id: subscription.id,
      config: {
        resource,
        changeType,
        clientState: subscription.clientState, // Store for webhook verification
        notificationUrl: subscription.notificationUrl,
        ...config
      },
      status: 'active',
      expires_at: subscription.expirationDateTime,
      // Test mode isolation fields
      is_test: testMode?.isTest ?? false,
      test_session_id: testMode?.testSessionId ?? null
    })

    if (insertError) {
      // Check if this is a FK constraint violation (code 23503) - happens for unsaved workflows in test mode
      // The subscription was already created successfully with Microsoft Graph, so we can continue
      if (insertError.code === '23503') {
        logger.warn(`⚠️ Could not store trigger resource (workflow may be unsaved): ${insertError.message}`)
        logger.info(`✅ Microsoft Graph subscription created (without local record): ${subscription.id}`)
        return
      }
      logger.error(`❌ Failed to store trigger resource:`, insertError)
      throw new Error(`Failed to store trigger resource: ${insertError.message}`)
    }

    logger.info(`✅ Microsoft Graph subscription created and saved to trigger_resources: ${subscription.id}`)

    if (triggerType.startsWith('microsoft_excel_') && config?.workbookId && config?.tableName) {
      try {
        const snapshot = await this.fetchExcelTableSnapshot(accessToken, config.workbookId, config.tableName)
        await getSupabase()
          .from('trigger_resources')
          .update({
            config: {
              ...config,
              excelRowSnapshot: snapshot
            },
            updated_at: new Date().toISOString()
          })
          .eq('external_id', subscription.id)
          .eq('resource_type', 'subscription')
      } catch (snapshotError) {
        logger.warn('⚠️ Failed to seed Excel snapshot on activation:', snapshotError)
      }
    }

    if (triggerType.startsWith('microsoft_excel_') && config?.workbookId && config?.worksheetName) {
      try {
        const hasHeaders = config.hasHeaders === true || config.hasHeaders === 'yes'
        const snapshot = await this.fetchExcelWorksheetSnapshot(accessToken, config.workbookId, config.worksheetName, hasHeaders)
        await getSupabase()
          .from('trigger_resources')
          .update({
            config: {
              ...config,
              excelRowSnapshot: snapshot
            },
            updated_at: new Date().toISOString()
          })
          .eq('external_id', subscription.id)
          .eq('resource_type', 'subscription')
      } catch (snapshotError) {
        logger.warn('⚠️ Failed to seed Excel worksheet snapshot on activation:', snapshotError)
      }
    }

    if (triggerType === 'microsoft-outlook_trigger_calendar_event_start' && !testMode?.isTest) {
      try {
        await this.seedCalendarStartSchedules(workflowId, userId, nodeId, config, accessToken)
      } catch (seedError) {
        logger.error('??O Failed to seed calendar start schedules:', seedError)
      }
    }
  }

  /**
   * Deactivate Microsoft Graph trigger
   * Deletes the subscription
   */
  async onDeactivate(context: TriggerDeactivationContext): Promise<void> {
    const { workflowId, userId, nodeId, testSessionId } = context

    const modeLabel = testSessionId ? '🧪 TEST' : nodeId ? '🗑️ NODE' : '🛑 PRODUCTION'
    logger.info(`${modeLabel} Deactivating Microsoft Graph triggers for workflow ${workflowId}${nodeId ? ` node ${nodeId}` : ''}`)

    // Build query based on whether we're deactivating test or production triggers
    let query = getSupabase()
      .from('trigger_resources')
      .select('*')
      .eq('workflow_id', workflowId)
      .eq('provider_id', 'microsoft')
      .eq('status', 'active')

    // Filter by specific node if provided (for node deletion)
    if (nodeId) {
      query = query.eq('node_id', nodeId)
    } else if (testSessionId) {
      // Only deactivate test subscriptions for this specific session
      query = query.eq('test_session_id', testSessionId)
    } else {
      // Deactivate production subscriptions only
      query = query.or('is_test.is.null,is_test.eq.false')
    }

    const { data: resources } = await query

    if (!resources || resources.length === 0) {
      const suffix = nodeId ? ` (node ${nodeId})` : testSessionId ? ` (session ${testSessionId})` : ''
      logger.info(`ℹ️ No active Microsoft Graph subscriptions for workflow ${workflowId}${suffix}`)
      return
    }

    // Get valid access token (automatically refreshes if expired)
    let accessToken: string
    try {
      accessToken = await this.graphAuth.getValidAccessToken(userId)
      logger.info('✅ Retrieved valid Microsoft Graph access token for deactivation')
    } catch (error) {
      logger.warn(`⚠️ Failed to get valid Microsoft Graph token, deleting subscription records without API cleanup`, error)
      // Delete even if we can't clean up in Microsoft Graph
      await getSupabase()
        .from('trigger_resources')
        .delete()
        .eq('workflow_id', workflowId)
        .eq('provider_id', 'microsoft')
      return
    }

    // Delete each subscription
    for (const resource of resources) {
      if (!resource.external_id) continue

      try {
        await this.subscriptionManager.deleteSubscription(
          resource.external_id,
          accessToken
        )
        logger.info(`✅ Deleted Microsoft Graph subscription from API: ${resource.external_id}`)
      } catch (error) {
        logger.warn(`⚠️ Failed to delete subscription from Microsoft Graph API (will delete from DB anyway): ${resource.external_id}`, error)
        // Continue to delete from database even if API call fails
      }

      // ALWAYS delete from trigger_resources, even if Microsoft Graph API call failed
      // This ensures we don't have orphaned records
      try {
        await getSupabase()
          .from('trigger_resources')
          .delete()
          .eq('id', resource.id)

        logger.info(`✅ Deleted trigger resource from database: ${resource.id}`)
      } catch (dbError) {
        logger.error(`❌ Failed to delete from database: ${resource.id}`, dbError)
        // If we can't delete from DB, mark as error as last resort
        await getSupabase()
          .from('trigger_resources')
          .update({ status: 'deleted', deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', resource.id)
      }
    }
    // Clean up scheduled triggers for calendar event start
    if (nodeId) {
      await getSupabase()
        .from('workflows_schedules')
        .update({ status: 'cancelled', enabled: false, updated_at: new Date().toISOString() })
        .eq('workflow_id', workflowId)
        .eq('node_id', nodeId)
        .eq('trigger_type', 'microsoft-outlook_trigger_calendar_event_start')
    } else {
      await getSupabase()
        .from('workflows_schedules')
        .update({ status: 'cancelled', enabled: false, updated_at: new Date().toISOString() })
        .eq('workflow_id', workflowId)
        .eq('trigger_type', 'microsoft-outlook_trigger_calendar_event_start')
    }

  }

  /**
   * Delete Microsoft Graph trigger (same as deactivate)
   */
  async onDelete(context: TriggerDeactivationContext): Promise<void> {
    return this.onDeactivate(context)
  }

  /**
   * Check health of Microsoft Graph subscriptions
   */
  async checkHealth(workflowId: string, userId: string): Promise<TriggerHealthStatus> {
    const { data: resources } = await getSupabase()
      .from('trigger_resources')
      .select('*')
      .eq('workflow_id', workflowId)
      .eq('provider_id', 'microsoft')
      .eq('status', 'active')

    if (!resources || resources.length === 0) {
      return {
        healthy: false,
        details: 'No active subscriptions found',
        lastChecked: new Date().toISOString()
      }
    }

    // Check if any subscriptions are expiring soon (within 12 hours)
    const now = new Date()
    const expiringThreshold = new Date(now.getTime() + 12 * 60 * 60 * 1000)

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
        ? `Subscription expiring soon: ${nearestExpiration?.toISOString()}`
        : `All subscriptions healthy (${resources.length} active)`,
      expiresAt: nearestExpiration?.toISOString(),
      lastChecked: new Date().toISOString()
    }
  }

  /**
   * Define resource identity keys for Microsoft Graph triggers
   * These keys identify what resource is being monitored
   */
  getResourceIdentityKeys(): string[] {
    return [
      // Excel identifiers
      'workbookId',
      'worksheetName',
      'tableName',

      // Calendar identifiers
      'calendarId',

      // Outlook email identifiers
      'folder',

      // OneDrive identifiers
      'driveId',
      'folderId',
      'fileId',

      // Teams identifiers
      'teamId',
      'channelId'
    ]
  }

  private parseGraphDateTime(value: any): Date | null {
    const raw = value?.dateTime
    if (!raw || typeof raw !== 'string') return null
    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) return null
    return parsed
  }

  private getMinutesBefore(config: Record<string, any> | undefined): number {
    const raw = config?.minutesBefore ?? config?.minutes_before
    const parsed = Number.parseInt(String(raw), 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
    return 15
  }

  private async seedCalendarStartSchedules(
    workflowId: string,
    userId: string,
    nodeId: string,
    config: Record<string, any> | undefined,
    accessToken: string
  ): Promise<void> {
    const now = new Date()
    const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    const startIso = now.toISOString()
    const endIso = horizon.toISOString()

    const baseUrl = config?.calendarId
      ? `https://graph.microsoft.com/v1.0/me/calendars/${config.calendarId}/events`
      : 'https://graph.microsoft.com/v1.0/me/events'

    const url = `${baseUrl}?$select=id,subject,start,end,calendar,organizer,location&$filter=start/dateTime ge '${startIso}' and start/dateTime le '${endIso}'&$orderby=start/dateTime&$top=50`

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.warn('?s??,? Failed to seed calendar start schedules:', {
        status: response.status,
        error: errorText
      })
      return
    }

    const data = await response.json()
    const events = Array.isArray(data?.value) ? data.value : []
    if (events.length === 0) return

    const minutesBefore = this.getMinutesBefore(config)

    for (const event of events) {
      const startTime = this.parseGraphDateTime(event.start)
      if (!startTime) continue
      const scheduledFor = new Date(startTime.getTime() - minutesBefore * 60 * 1000).toISOString()
      const payload = {
        trigger: {
          type: 'microsoft-outlook_trigger_calendar_event_start',
          eventId: event?.id,
          subject: event?.subject || '',
          start: event?.start || null,
          end: event?.end || null,
          location: event?.location || null,
          organizer: event?.organizer || null,
          scheduledFor,
          minutesBefore,
        },
        event,
        scheduledFor,
        minutesBefore,
      }

      await getSupabase()
        .from('workflows_schedules')
        .upsert({
          workflow_id: workflowId,
          revision_id: null,
          workspace_id: null,
          cron_expression: 'event',
          timezone: 'UTC',
          enabled: true,
          last_run_at: null,
          next_run_at: scheduledFor,
          created_by: userId,
          trigger_type: 'microsoft-outlook_trigger_calendar_event_start',
          provider_id: 'microsoft-outlook',
          node_id: nodeId,
          event_id: event.id,
          scheduled_for: scheduledFor,
          status: 'pending',
          payload,
          updated_at: new Date().toISOString()
        }, { onConflict: 'workflow_id,node_id,trigger_type,event_id' })
    }
  }

  /**
   * Extract the provider from trigger type
   * e.g., "microsoft-outlook_trigger_new_email" -> "microsoft-outlook"
   * e.g., "microsoft_excel_trigger_new_row" -> "microsoft-excel"
   */
  private getProviderFromTriggerType(triggerType: string): string {
    // Extract provider prefix from trigger type
    if (triggerType.startsWith('microsoft-outlook_')) return 'microsoft-outlook'
    if (triggerType.startsWith('microsoft_excel_')) return 'microsoft-excel'
    if (triggerType.startsWith('teams_')) return 'teams'
    if (triggerType.startsWith('onedrive_')) return 'onedrive'

    // Default to microsoft-outlook for generic microsoft triggers
    return 'microsoft-outlook'
  }

  /**
   * Map trigger type to Microsoft Graph resource
   * Handles both formats: "microsoft-outlook_trigger_new_email" and "trigger_new_email"
   */
  private getResourceForTrigger(triggerType: string, config?: Record<string, any>): string | null {
    // Strip provider prefix if present (e.g., "microsoft-outlook_trigger_new_email" -> "trigger_new_email")
    const simplifiedType = triggerType.replace(/^(microsoft-outlook|microsoft_excel|teams|onedrive)_/, '')

    const resourceMap: Record<string, string | ((config?: Record<string, any>) => string)> = {
      // Email triggers
      'trigger_new_email': (config?: Record<string, any>) => {
        // Watch specific folder if configured, otherwise watch all messages
        if (config?.folder) {
          return `/me/mailFolders/${config.folder}/messages`
        }
        return '/me/messages'
      },
      'trigger_email_received': '/me/messages',
      'trigger_email_sent': '/me/mailFolders/SentItems/messages',
      'trigger_email_flagged': '/me/messages', // Flag changes come as 'updated' events
      'trigger_new_attachment': '/me/messages', // Attachment emails are new messages with hasAttachments=true

      // Calendar triggers
      'trigger_calendar_event': '/me/events',
      'trigger_event_created': '/me/events',
      'trigger_event_updated': '/me/events',
      'trigger_new_calendar_event': (config?: Record<string, any>) => {
        if (config?.calendarId) {
          return `/me/calendars/${config.calendarId}/events`
        }
        return '/me/events'
      },
      'trigger_updated_calendar_event': (config?: Record<string, any>) => {
        if (config?.calendarId) {
          return `/me/calendars/${config.calendarId}/events`
        }
        return '/me/events'
      },
      'trigger_deleted_calendar_event': (config?: Record<string, any>) => {
        if (config?.calendarId) {
          return `/me/calendars/${config.calendarId}/events`
        }
        return '/me/events'
      },
      'trigger_calendar_event_start': (config?: Record<string, any>) => {
        // Calendar event start uses calendar event webhooks for scheduling
        if (config?.calendarId) {
          return `/me/calendars/${config.calendarId}/events`
        }
        return '/me/events'
      },

      // Contact triggers
      'trigger_new_contact': '/me/contacts',
      'trigger_updated_contact': '/me/contacts',

      // Teams triggers
      'trigger_new_message': (config?: Record<string, any>) => {
        if (config?.teamId && config?.channelId) {
          return `/teams/${config.teamId}/channels/${config.channelId}/messages`
        }
        return '/me/chats/getAllMessages'
      },
      'trigger_message_sent': '/me/chats/getAllMessages',
      'trigger_channel_message': '/teams/{teamId}/channels/{channelId}/messages',
      'trigger_user_joins_team': (config?: Record<string, any>) => {
        if (config?.teamId) {
          return `/teams/${config.teamId}/members`
        }
        throw new Error('teamId is required for user joins team trigger')
      },

      // OneDrive triggers (schema uses trigger_new_file and trigger_file_modified)
      'trigger_new_file': (config?: Record<string, any>) => {
        // OneDrive subscriptions reject /me/drive/items/{id}; prefer drive root unless driveId is known.
        if (config?.driveId && config?.folderId) {
          return `/drives/${config.driveId}/items/${config.folderId}`
        }
        return '/me/drive/root'
      },
      'trigger_file_modified': (config?: Record<string, any>) => {
        if (config?.driveId && config?.folderId) {
          return `/drives/${config.driveId}/items/${config.folderId}`
        }
        if (config?.driveId && config?.fileId) {
          return `/drives/${config.driveId}/items/${config.fileId}`
        }
        return '/me/drive/root'
      },
      'trigger_file_shared': '/me/drive/root',

      // Microsoft Excel triggers (use OneDrive file change notifications)
      // Excel workbook files are stored in OneDrive, so we watch the drive root for changes
      'trigger_new_row': (config?: Record<string, any>) => {
        // Watch the specific workbook file for changes if workbookId is provided
        if (config?.workbookId) {
          if (config?.driveId) {
            return `/drives/${config.driveId}/root`
          }
        }
        return '/me/drive/root'
      },
      'trigger_new_worksheet': (config?: Record<string, any>) => {
        if (config?.workbookId) {
          if (config?.driveId) {
            return `/drives/${config.driveId}/root`
          }
        }
        return '/me/drive/root'
      },
      'trigger_updated_row': (config?: Record<string, any>) => {
        if (config?.workbookId) {
          if (config?.driveId) {
            return `/drives/${config.driveId}/root`
          }
        }
        return '/me/drive/root'
      },
      'trigger_new_table_row': (config?: Record<string, any>) => {
        if (config?.workbookId) {
          if (config?.driveId) {
            return `/drives/${config.driveId}/root`
          }
        }
        return '/me/drive/root'
      },
      'trigger_updated_table_row': (config?: Record<string, any>) => {
        if (config?.workbookId) {
          if (config?.driveId) {
            return `/drives/${config.driveId}/root`
          }
        }
        return '/me/drive/root'
      }
    }

    const resource = resourceMap[simplifiedType]

    // If resource is a function, call it with config
    if (typeof resource === 'function') {
      return resource(config)
    }

    return resource || null
  }

  /**
   * Map trigger type to change type
   */
  private getChangeTypeForTrigger(triggerType: string): string {
    // Strip provider prefix if present
    const simplifiedType = triggerType.replace(/^(microsoft-outlook|microsoft_excel|teams|onedrive)_/, '')

    // Email flagged trigger needs to watch for updates (flag changes are updates)
    if (simplifiedType === 'trigger_email_flagged') {
      return 'updated'
    }

    // Deleted calendar event trigger
    if (simplifiedType === 'trigger_deleted_calendar_event') {
      return 'deleted'
    }

    // Calendar event start uses event create/update webhooks to schedule delayed runs
    if (simplifiedType === 'trigger_calendar_event_start') {
      return 'created,updated'
    }

    // OneDrive only supports "updated" changeType - it doesn't support "created" or "deleted" separately
    // All changes (new files, modified files, etc.) are reported as "updated" via delta queries
    if (triggerType.startsWith('onedrive_')) {
      return 'updated'
    }

    // Microsoft Excel triggers use OneDrive subscriptions, which only support "updated"
    if (triggerType.startsWith('microsoft_excel_')) {
      return 'updated'
    }

    // For new/created/sent triggers, only watch 'created' to avoid duplicate notifications
    // Microsoft Graph sends both 'created' and 'updated' for new items, causing duplicates
    if (triggerType.includes('new') || triggerType.includes('created') || triggerType.includes('sent')) {
      return 'created'
    }

    if (triggerType.includes('modified') || triggerType.includes('updated')) {
      return 'updated'
    }

    // Default to watching all changes
    return 'created,updated,deleted'
  }

  private async ensureExcelDriveId(
    config: Record<string, any> | undefined,
    accessToken: string
  ): Promise<void> {
    if (!config?.workbookId || config?.driveId) return

    try {
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${config.workbookId}?$select=id,driveId,parentReference`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        logger.warn('[MicrosoftGraphTriggerLifecycle] Failed to resolve Excel driveId', {
          status: response.status,
          error: errorText
        })
        return
      }

      const item = await response.json()
      const driveId = item?.driveId || item?.parentReference?.driveId
      if (driveId) {
        config.driveId = driveId
      } else {
        logger.warn('[MicrosoftGraphTriggerLifecycle] driveId missing in Excel workbook response', {
          workbookId: config.workbookId
        })
      }
    } catch (error) {
      logger.warn('[MicrosoftGraphTriggerLifecycle] Error resolving Excel driveId', error)
    }
  }

  private async fetchExcelTableSnapshot(
    accessToken: string,
    workbookId: string,
    tableName: string
  ): Promise<{ rowHashes: Record<string, string>; rowCount: number; updatedAt: string }> {
    const baseUrl = 'https://graph.microsoft.com/v1.0'
    const encodedTableName = encodeURIComponent(tableName)
    const rowsUrl = `${baseUrl}/me/drive/items/${workbookId}/workbook/tables/${encodedTableName}/rows?$top=200`

    const rowsResponse = await fetch(rowsUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!rowsResponse.ok) {
      const errorText = await rowsResponse.text()
      throw new Error(`Excel rows fetch failed: ${rowsResponse.status} ${errorText}`)
    }

    const rowsPayload = await rowsResponse.json()
    const rows = Array.isArray(rowsPayload?.value) ? rowsPayload.value : []
    const rowHashes: Record<string, string> = {}
    rows.forEach((row: any, index: number) => {
      // Use index-based fallback to match webhook handler's ID generation
      const rowId = row?.id || `row_${index}`
      const values = Array.isArray(row?.values?.[0]) ? row.values[0] : row?.values
      if (!Array.isArray(values)) return
      const hash = crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex')
      rowHashes[rowId] = hash
    })

    return {
      rowHashes,
      rowCount: rows.length,
      updatedAt: new Date().toISOString()
    }
  }

  private async fetchExcelWorksheetSnapshot(
    accessToken: string,
    workbookId: string,
    worksheetName: string,
    hasHeaders: boolean
  ): Promise<{ rowHashes: Record<string, string>; rowCount: number; updatedAt: string }> {
    const baseUrl = 'https://graph.microsoft.com/v1.0'
    const encodedName = encodeURIComponent(worksheetName.replace(/'/g, "''"))
    const usedRangeUrl = `${baseUrl}/me/drive/items/${workbookId}/workbook/worksheets('${encodedName}')/usedRange?valuesOnly=true`

    const response = await fetch(usedRangeUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Excel usedRange fetch failed: ${response.status} ${errorText}`)
    }

    const payload = await response.json()
    const rows = Array.isArray(payload?.values) ? payload.values : []
    const rowHashes: Record<string, string> = {}

    rows.forEach((values: any[], index: number) => {
      if (!Array.isArray(values)) return
      const rowIndex = index + 1
      if (hasHeaders && rowIndex === 1) return
      // Use worksheet_row_ format to match webhook handler's ID generation
      const rowId = `worksheet_row_${rowIndex}`
      const hash = crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex')
      rowHashes[rowId] = hash
    })

    const rowCount = hasHeaders ? Math.max(rows.length - 1, 0) : rows.length

    return {
      rowHashes,
      rowCount,
      updatedAt: new Date().toISOString()
    }
  }
}
