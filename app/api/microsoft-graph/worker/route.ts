import { NextRequest, NextResponse } from 'next/server'
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createClient } from '@supabase/supabase-js'
import { MicrosoftGraphSubscriptionManager } from '@/lib/microsoft-graph/subscriptionManager'
import { MicrosoftGraphClient } from '@/lib/microsoft-graph/client'
import { safeDecrypt, encrypt } from '@/lib/security/encryption'
import { flagIntegrationWorkflows } from '@/lib/integrations/integrationWorkflowManager'

import { logger } from '@/lib/utils/logger'

// Helper to create supabase client inside handlers
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const subscriptionManager = new MicrosoftGraphSubscriptionManager()

// Track processed events to prevent duplicate processing
const recentlyProcessedEvents = new Map<string, number>()
const EVENT_DEDUPE_WINDOW = 60000 // 60 seconds

let workerCallCount = 0

export async function POST(_req: NextRequest) {
  workerCallCount++
  const startTime = Date.now()
  logger.info(`\n🏃 Worker called (call #${workerCallCount}) at ${new Date().toISOString()}`)

  // Check total queue count first
  const { count: totalCount } = await getSupabase()
    .from('microsoft_webhook_queue')
    .select('id', { count: 'exact', head: true })

  logger.info(`📊 Total items in queue: ${totalCount || 0}`)

  // Get status breakdown
  const { data: statusBreakdown } = await getSupabase()
    .from('microsoft_webhook_queue')
    .select('status')
    .limit(100)

  const statusCounts = (statusBreakdown || []).reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  logger.info('📈 Queue status breakdown:', statusCounts)

  // Simple pull worker: process oldest pending items
  const { data: rows, error: queryError } = await getSupabase()
    .from('microsoft_webhook_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(25)

  if (queryError) {
    logger.error('❌ Error querying queue:', queryError)
  }

  logger.info('🔍 Worker queue check:', {
    pendingItems: rows?.length || 0,
    totalInQueue: totalCount || 0,
    recentItems: rows?.slice(0, 3).map(r => ({
      id: r.id,
      resource: r.resource,
      changeType: r.change_type,
      status: r.status,
      createdAt: r.created_at,
      userId: r.user_id
    })) || []
  })

  if (!rows || rows.length === 0) {
    logger.info('⚠️ No pending events to process')
    logger.info(`⏱️ Worker completed in ${Date.now() - startTime}ms`)
    return jsonResponse({
      processed: 0,
      total_in_queue: totalCount || 0,
      status_breakdown: statusCounts
    })
  }

  let processed = 0
  for (const row of rows) {
    try {
      await getSupabase()
        .from('microsoft_webhook_queue')
        .update({ status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', row.id)

      // Get subscription owner for API calls from trigger_resources
      const { data: resource } = await getSupabase()
        .from('trigger_resources')
        .select('user_id, workflow_id')
        .eq('external_id', row.subscription_id)
        .eq('resource_type', 'subscription')
        .like('provider_id', 'microsoft%')
        .single()

      if (!resource?.user_id) {
        logger.error('❌ Could not determine user_id for subscription:', row.subscription_id)
        continue
      }

      const actualUserId = resource.user_id

      // Process based on resource type
      const payload = row.payload
      const resourceType = getResourceType(payload.resource)
      logger.info('🔍 Processing webhook for resource type:', resourceType, 'from resource:', payload.resource)
      logger.info('📋 Webhook payload details:', {
        resource: payload.resource,
        changeType: payload.changeType,
        subscriptionId: payload.subscriptionId,
        resourceData: payload.resourceData
      })

      let events: any[] = []

      // Check if this is an individual resource (not a collection)
      const isIndividualMessage = isIndividualMessageResource(payload.resource)
      const isIndividualDrive = isIndividualDriveResource(payload.resource)
      const isIndividualEvent = isIndividualEventResource(payload.resource)
      const isIndividualResource = isIndividualMessage || isIndividualDrive || isIndividualEvent

      logger.info('🔍 Individual resource detection:', {
        resource: payload.resource,
        isIndividualMessage,
        isIndividualDrive,
        isIndividualEvent,
        isIndividualResource,
        resourceLength: payload.resource?.length,
        resourceStartsWith: payload.resource?.substring(0, 20),
        resourceEndsWith: payload.resource?.substring(payload.resource.length - 20)
      })

      // Force individual resource detection for mail if it contains a message ID
      const isMailWithMessageId = resourceType === 'mail' && 
        (payload.resource.includes('/messages/') || payload.resource.includes('/Messages/'))
      
      if (isIndividualResource || isMailWithMessageId) {
        logger.info('🎯 Individual resource detected, fetching directly', { 
          isIndividualResource, 
          isMailWithMessageId,
          resourceType 
        })
        // For individual resources, get fresh token from integrations table
        const { accessToken } = await resolveProviderTokens(actualUserId, resourceType)
        events = await fetchIndividualResource(payload, accessToken)
      } else if (resourceType === 'onedrive') {
        events = await fetchOneDriveChanges(payload, actualUserId)
      } else if (resourceType === 'mail' || resourceType === 'calendar') {
        // Use fresh tokens from integrations table for mail and calendar
        events = await fetchOutlookChanges(payload, actualUserId, resourceType)
      } else {
        // Fallback to generic handler for other resource types
        logger.info('🔄 Using generic handler for resource type:', resourceType)
        const { accessToken } = await resolveProviderTokens(actualUserId, resourceType)
        events = await fetchResourceChanges(resourceType, payload, accessToken)
      }

      logger.info('📊 Fetched events:', {
        count: events?.length || 0,
        eventTypes: events?.map(e => ({ type: e.type, action: e.action, name: e.name })),
        resourceType,
        resource: payload.resource
      })

      // Store normalized events
      if (events && events.length > 0) {
        await storeNormalizedEvents(events, actualUserId)

        // Emit workflow triggers for each event
        for (const event of events) {
          // Deduplicate events - use more fields for uniqueness
          const eventKey = `${event.id}-${event.type}-${event.action}-${event.name || ''}`
          const now = Date.now()

          // Clean old entries
          for (const [key, timestamp] of recentlyProcessedEvents.entries()) {
            if (now - timestamp > EVENT_DEDUPE_WINDOW) {
              recentlyProcessedEvents.delete(key)
            }
          }

          // Skip if recently processed
          if (recentlyProcessedEvents.has(eventKey)) {
            logger.info(`⏭️ Skipping duplicate event: ${event.id} (${event.type}/${event.action})`)
            continue
          }
          recentlyProcessedEvents.set(eventKey, now)

          logger.info('🎯 Emitting workflow trigger for event:', {
            type: event.type,
            action: event.action,
            name: event.name,
            id: event.id
          })
          await emitWorkflowTrigger(event, actualUserId)
        }
      } else {
        logger.info('⚠️ No events to process from webhook')
      }

      // Mark as done
      await getSupabase()
        .from('microsoft_webhook_queue')
        .update({
          status: 'done',
          processed_count: events?.length || 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', row.id)

      processed++
    } catch (e: any) {
      logger.error('Error processing webhook queue item:', e)
      try {
        const msg = typeof e?.message === 'string' ? e.message : ''
        if (msg.includes('InvalidAuthenticationToken') || msg.includes('No valid Microsoft Graph')) {
          await flagIntegrationWorkflows({
            integrationId: undefined,
            provider: 'onedrive',
            userId: row?.user_id || undefined,
            reason: 'Microsoft authentication expired while processing OneDrive webhook'
          })
        }
      } catch {}
      await getSupabase()
        .from('microsoft_webhook_queue')
        .update({
          status: 'error',
          error_message: e.message,
          updated_at: new Date().toISOString()
        })
        .eq('id', row.id)
    }
  }

  return jsonResponse({ processed })
}

// Helper functions
function getResourceType(resource: string): string {
  logger.info('🔍 Determining resource type for:', resource)

  const resourceLower = resource.toLowerCase()

  if (resourceLower.includes('/drive/') || resourceLower.includes('/drives/')) {
    logger.info('📁 Detected OneDrive resource')
    return 'onedrive'
  } else if (resourceLower.includes('/messages')) {
    logger.info('📧 Detected mail resource')
    return 'mail'
  } else if (resourceLower.includes('/events')) {
    logger.info('📅 Detected calendar resource')
    return 'calendar'
  } else if (resourceLower.includes('/teams/') || resourceLower.includes('/channels/')) {
    logger.info('💬 Detected Teams resource')
    return 'teams'
  } else if (resourceLower.includes('/chats/')) {
    logger.info('💬 Detected chat resource')
    return 'chat'
  } else if (resourceLower.includes('/onenote/')) {
    logger.info('📝 Detected OneNote resource')
    return 'onenote'
  }

  logger.info('❓ Unknown resource type')
  return 'unknown'
}

function isIndividualMessageResource(resource: string): boolean {
  // Check if it's a specific message ID (not the collection)
  const messageIdMatch = resource.match(/\/me\/messages\/([^\/]+)$/i)
  const folderMessageMatch = resource.match(/\/me\/mailFolders\/[^\/]+\/messages\/([^\/]+)$/i)
  const userMessageMatch = resource.match(/\/users\/[^\/]+\/messages\/([^\/]+)$/i)
  const userFolderMessageMatch = resource.match(/\/users\/[^\/]+\/mailFolders\/[^\/]+\/messages\/([^\/]+)$/i)
  
  const isIndividual = !!(messageIdMatch || folderMessageMatch || userMessageMatch || userFolderMessageMatch)
  
  logger.info('📧 Message resource check:', {
    resource,
    messageIdMatch: !!messageIdMatch,
    folderMessageMatch: !!folderMessageMatch,
    userMessageMatch: !!userMessageMatch,
    userFolderMessageMatch: !!userFolderMessageMatch,
    isIndividual
  })
  
  return isIndividual
}

function isIndividualDriveResource(resource: string): boolean {
  // Check if it's a specific drive item ID (not the collection)
  const driveItemMatch = resource.match(/\/me\/drive\/items\/([^\/]+)$/)
  const driveItemPathMatch = resource.match(/\/drives\/[^\/]+\/items\/([^\/]+)$/)
  return !!(driveItemMatch || driveItemPathMatch)
}

function isIndividualEventResource(resource: string): boolean {
  // Check if it's a specific event ID (not the collection)
  const eventMatch = resource.match(/\/me\/events\/([^\/]+)$/)
  const calendarEventMatch = resource.match(/\/me\/calendars\/[^\/]+\/events\/([^\/]+)$/)
  return !!(eventMatch || calendarEventMatch)
}

async function fetchIndividualResource(payload: any, accessToken: string): Promise<any[]> {
  const client = new MicrosoftGraphClient({ accessToken })
  const resource = payload.resource
  const changeType = payload.changeType
  const requestPathBase = resource.startsWith('/') ? resource : `/${resource}`
  const requestPath = requestPathBase
    .replace(/^\/Users\//i, '/users/')
    .replace(/\/Messages\//g, '/messages/')
    .replace(/\/MailFolders\//g, '/mailFolders/')
  const resourceLower = requestPath.toLowerCase()
  
  logger.info('🎯 Fetching individual resource:', resource, 'changeType:', changeType)
  
  try {
    // For individual resources, fetch the specific item directly
    const item: any = await client.request(requestPath)
    
    if (!item) {
      logger.info('⚠️ No item found for resource:', resource)
      return []
    }
    
    // Normalize based on resource type
    let normalizedEvent: any = null
    
    if (resourceLower.includes('/messages')) {
      // Mail message
      normalizedEvent = {
        id: item.id,
        type: 'outlook_mail',
        action: changeType === 'deleted' ? 'deleted' : (item.isDraft ? 'draft' : 'created'),
        subject: item.subject,
        from: item.from?.emailAddress?.address,
        receivedDateTime: item.receivedDateTime,
        sentDateTime: item.sentDateTime,
        importance: item.importance,
        hasAttachments: item.hasAttachments,
        isRead: item.isRead,
        isDraft: item.isDraft,
        webLink: item.webLink,
        originalPayload: item
      }
    } else if (resourceLower.includes('/drive/items') || resourceLower.includes('/drives/')) {
      // OneDrive item
      normalizedEvent = {
        id: item.id,
        type: 'onedrive_item',
        action: item.deleted ? 'deleted' : (item.file ? 'file_updated' : 'folder_updated'),
        name: item.name,
        path: item.parentReference?.path ? `${item.parentReference.path}/${item.name}` : item.name,
        lastModified: item.lastModifiedDateTime,
        createdBy: item.createdBy?.user?.displayName,
        size: item.size,
        webUrl: item.webUrl,
        originalPayload: item
      }
    } else if (resourceLower.includes('/events')) {
      // Calendar event
      normalizedEvent = {
        id: item.id,
        type: 'outlook_calendar',
        action: item.isCancelled ? 'cancelled' : (changeType === 'deleted' ? 'deleted' : (item.isNewEvent ? 'created' : 'updated')),
        subject: item.subject,
        start: item.start?.dateTime,
        end: item.end?.dateTime,
        organizer: item.organizer?.emailAddress?.address,
        location: item.location?.displayName,
        webLink: item.webLink,
        originalPayload: item
      }
    }
    
    if (normalizedEvent) {
      logger.info('✅ Individual resource normalized:', {
        type: normalizedEvent.type,
        action: normalizedEvent.action,
        id: normalizedEvent.id
      })
      return [normalizedEvent]
    }
    
    return []
  } catch (error) {
    logger.error('❌ Error fetching individual resource:', error)
    return []
  }
}

function resolveMailMessagesBasePath(resource?: string): string {

  if (!resource) return '/me/messages'



  let normalized = resource.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0\//i, '')

  normalized = normalized.replace(/^\/+/, '')



  if (!normalized) return '/me/messages'



  normalized = normalized.replace(/\/messages\([^)]*\)$/i, '/messages')

  normalized = normalized.replace(/\/messages\/[^/]+$/i, '/messages')

  if (normalized.includes('/messages(')) {

    normalized = `${normalized.split('/messages(')[0] }/messages`

  } else if (normalized.includes('/messages/')) {

    normalized = `${normalized.split('/messages/')[0] }/messages`

  } else if (!normalized.endsWith('/messages')) {

    normalized = `${normalized.replace(/\/+$/, '') }/messages`

  }



  return `/${ normalized.replace(/^\/+/, '').replace(/\/+$/, '')}`

}



async function fetchResourceChanges(
  resourceType: string, 
  payload: any, 
  accessToken: string
): Promise<any[]> {
  const client = new MicrosoftGraphClient({
    accessToken,
    decryptionKey: process.env.MICROSOFT_TEAMS_PRIVATE_KEY,
    decryptionCert: process.env.MICROSOFT_TEAMS_CERTIFICATE
  })

  // Get delta token from database or use default
  const { data: deltaToken } = await getSupabase()
    .from('microsoft_graph_delta_tokens')
    .select('token')
    .eq('resource_type', resourceType)
    .eq('resource_id', payload.resource)
    .maybeSingle()

  let events: any[] = []
  let newDeltaToken: string | undefined

  try {
    logger.info('🔄 Processing resource type:', resourceType, 'with delta token:', deltaToken?.token ? 'present' : 'none')
    
    switch (resourceType) {
      case 'onedrive': {
        // Extract drive ID if present
        const driveIdMatch = payload.resource.match(/drives\/([^/]+)/)
        const driveId = driveIdMatch ? driveIdMatch[1] : undefined
        
        logger.info('📁 OneDrive delta query for drive:', driveId)
        const response = await client.getOneDriveDelta(driveId, deltaToken?.token)
        events = response.value.filter(item => item._normalized).map(item => item._normalized!)
        newDeltaToken = response['@odata.deltaLink']?.split('token=')[1]
        logger.info('📁 OneDrive events found:', events.length)
        break
      }
      
      case 'mail': {

        logger.info('dY" Mail delta query starting...')

        const mailBasePath = resolveMailMessagesBasePath(payload.resource)

        logger.info('dY" Mail delta path:', mailBasePath)

        const response = await client.getMailDelta(deltaToken?.token, { basePath: mailBasePath })

        logger.info('dY" Mail delta response:', {

          totalMessages: response.value.length,

          hasDeltaLink: !!response['@odata.deltaLink'],

          hasNextLink: !!response['@odata.nextLink']

        })



        events = response.value.filter(item => item._normalized).map(item => item._normalized!)



        // If no events from delta query, try to get recent messages as fallback

        if (events.length === 0 && !deltaToken?.token) {

          logger.info('dY" No events from delta query, trying recent messages fallback...')

          try {

            const recentResponse: any = await client.request(`${mailBasePath}?$top=10&$orderby=receivedDateTime desc`)

            if (recentResponse.value && recentResponse.value.length > 0) {

              logger.info('dY" Found recent messages:', recentResponse.value.length)

              // Normalize recent messages

              const normalizedRecent = recentResponse.value.map((message: any) => ({

                id: message.id,

                type: 'outlook_mail',

                action: message.isDraft ? 'draft' : 'created',

                subject: message.subject,

                from: message.from?.emailAddress?.address,

                receivedDateTime: message.receivedDateTime,

                sentDateTime: message.sentDateTime,

                importance: message.importance,

                hasAttachments: message.hasAttachments,

                isRead: message.isRead,

                isDraft: message.isDraft,

                webLink: message.webLink,

                originalPayload: message

              }))

              events = normalizedRecent

            }

          } catch (fallbackError) {

            logger.info('dY" Recent messages fallback failed:', fallbackError)

          }

        }



        // Parse delta token from the delta link

        const deltaLink = response['@odata.deltaLink']

        if (deltaLink) {

          const tokenMatch = deltaLink.match(/\$deltatoken=([^&]+)/)

          newDeltaToken = tokenMatch ? tokenMatch[1] : undefined

        }

        logger.info('dY" Mail events found:', events.length)

        logger.info('dY" New delta token:', newDeltaToken ? 'present' : 'none')

        if (events.length > 0) {

          logger.info('dY" Sample mail event:', {

            type: events[0].type,

            action: events[0].action,

            subject: events[0].subject,

            from: events[0].from

          })

        }

        break

      }



      case 'calendar': {
        const response = await client.getCalendarDelta(deltaToken?.token)
        events = response.value.filter(item => item._normalized).map(item => item._normalized!)
        newDeltaToken = response['@odata.deltaLink']?.split('$deltatoken=')[1]
        break
      }
      
      case 'teams': {
        // Extract team and channel IDs
        const teamMatch = payload.resource.match(/teams\/([^/]+)/)
        const channelMatch = payload.resource.match(/channels\/([^/]+)/)
        
        if (teamMatch && channelMatch) {
          const teamId = teamMatch[1]
          const channelId = channelMatch[1]
          
          // Get last processed date or default to 24h ago
          const lastProcessed = deltaToken?.token 
            ? new Date(deltaToken.token) 
            : new Date(Date.now() - 24 * 60 * 60 * 1000)
          
          const response = await client.getTeamsMessages(teamId, channelId, lastProcessed)
          events = response.value.filter(item => item._normalized).map(item => item._normalized!)
          newDeltaToken = new Date().toISOString() // Use current time as token for teams
        }
        break
      }
      
      case 'chat': {
        // Extract chat ID
        const chatMatch = payload.resource.match(/chats\/([^/]+)/)
        
        if (chatMatch) {
          const chatId = chatMatch[1]
          
          // Get last processed date or default to 24h ago
          const lastProcessed = deltaToken?.token 
            ? new Date(deltaToken.token) 
            : new Date(Date.now() - 24 * 60 * 60 * 1000)
          
          const response = await client.getChatMessages(chatId, lastProcessed)
          events = response.value.filter(item => item._normalized).map(item => item._normalized!)
          newDeltaToken = new Date().toISOString() // Use current time as token for chats
        }
        break
      }
      
      case 'onenote': {
        // For OneNote, we use OneDrive delta for change tracking
        // Get notebooks to find corresponding OneDrive items
        const notebooks = await client.getOneNoteNotebooks()
        
        // For each notebook, get pages
        for (const notebook of notebooks.value) {
          const pages = await client.getOneNotePagesDelta(notebook.id, deltaToken?.token)
          
          // Add normalized events
          const normalizedPages = pages.value.map(page => ({
            id: page.id,
            type: 'onenote_page' as const,
            action: 'updated',
            title: page.title,
            lastModified: page.lastModifiedDateTime,
            webUrl: page.links.oneNoteWebUrl.href,
            originalPayload: page
          }))
          
          events.push(...normalizedPages)
        }
        
        // Use current time as token for OneNote
        newDeltaToken = new Date().toISOString()
        break
      }
    }

    // Store new delta token if available
    if (newDeltaToken) {
      await getSupabase()
        .from('microsoft_graph_delta_tokens')
        .upsert({
          resource_type: resourceType,
          resource_id: payload.resource,
          token: newDeltaToken,
          updated_at: new Date().toISOString()
        }, { onConflict: 'resource_type,resource_id' })
    }

    return events
  } catch (error) {
    logger.error(`Error fetching ${resourceType} changes:`, error)
    throw error
  }
}

async function storeNormalizedEvents(events: any[], userId: string): Promise<void> {
  if (!events.length) return

  // Batch insert events
  const eventsToInsert = events.map(event => ({
    user_id: userId,
    event_type: event.type,
    event_action: event.action,
    event_id: event.id,
    resource_id: event.id,
    payload: event,
    created_at: new Date().toISOString()
  }))

  await getSupabase().from('microsoft_graph_events').insert(eventsToInsert)
}

// Track recently executed workflows to prevent duplicates
const recentWorkflowExecutions = new Map<string, number>()

async function emitWorkflowTrigger(event: any, userId: string, accessToken?: string): Promise<void> {
  // Deduplicate at the workflow trigger level
  const triggerKey = `${userId}-${event.id}-${event.type}-${event.action}`
  const now = Date.now()

  logger.info('🔑 Workflow trigger key:', {
    key: triggerKey,
    eventId: event.id,
    type: event.type,
    action: event.action,
    name: event.name,
    timestamp: now
  })

  // Check if we've recently processed this exact trigger
  if (recentWorkflowExecutions.has(triggerKey)) {
    const lastRun = recentWorkflowExecutions.get(triggerKey)!
    const timeSince = now - lastRun
    logger.info(`⚠️ Duplicate trigger detected:`, {
      triggerKey,
      lastRun,
      timeSince,
      willSkip: timeSince < 30000
    })
    if (timeSince < 30000) { // 30 second window
      logger.info(`⏭️ SKIPPING duplicate workflow trigger (${timeSince}ms since last run)`)
      return
    }
  }
  recentWorkflowExecutions.set(triggerKey, now)

  // Clean old entries
  for (const [key, timestamp] of recentWorkflowExecutions.entries()) {
    if (now - timestamp > 60000) {
      recentWorkflowExecutions.delete(key)
    }
  }

  logger.info('✅ Proceeding with workflow trigger (not a duplicate)')

  // First, check if user has any workflows at all
  const { data: allWorkflows, error: allError } = await getSupabase()
    .from('workflows')
    .select('id, name, status, user_id')
    .eq('user_id', userId)

  if (allError) {
    logger.error('❌ Error querying workflows:', allError)
  }

  // Also check without the OR condition to see if it's a query issue
  const { data: directWorkflows } = await getSupabase()
    .from('workflows')
    .select('id, name, status, user_id')
    .eq('user_id', userId)

  // Find workflows that should be triggered by this event
  const { data: workflows, error: workflowError } = await getSupabase()
    .from('workflows')
    .select('id, name, status, user_id')
    .eq('status', 'active')
    .eq('user_id', userId)

  if (workflowError) {
    logger.error('❌ Error fetching workflows:', workflowError)
  }

  if (!workflows || workflows.length === 0) {
    logger.info('❌ No active workflows found for user. Please ensure your workflows are activated (status = "active")')

    // Additional debug: Check what workflows exist in DB for this user
    const { data: allUserWorkflows } = await getSupabase()
      .from('workflows')
      .select('id, name, status, user_id')
      .eq('user_id', userId)

    logger.info('📊 All workflows for this user (regardless of status):', {
      userId,
      totalCount: allUserWorkflows?.length || 0,
      workflows: allUserWorkflows?.map(w => ({
        id: w.id,
        name: w.name,
        status: w.status,
        userId: w.user_id
      })) || []
    })

    return
  }

  // Load all nodes for these workflows from normalized table
  const workflowIds = workflows.map(w => w.id)
  const { data: allNodes, error: nodesError } = await getSupabase()
    .from('workflow_nodes')
    .select('id, workflow_id, node_type, label, config, is_trigger, provider_id, position_x, position_y')
    .in('workflow_id', workflowIds)

  if (nodesError) {
    logger.error('❌ Error fetching workflow nodes:', nodesError)
  }

  // Group nodes by workflow
  const nodesByWorkflow = new Map<string, any[]>()
  for (const node of allNodes || []) {
    const list = nodesByWorkflow.get(node.workflow_id) || []
    list.push({
      id: node.id,
      type: node.node_type,
      data: {
        type: node.node_type,
        label: node.label,
        config: node.config || {},
        isTrigger: node.is_trigger,
        providerId: node.provider_id
      },
      position: { x: node.position_x, y: node.position_y }
    })
    nodesByWorkflow.set(node.workflow_id, list)
  }

  // Debug: Check for OneDrive workflows
  const onedriveWorkflows = workflows.filter(w => {
    const nodes = nodesByWorkflow.get(w.id) || []
    return nodes.some((n: any) =>
      n?.data?.type?.includes('onedrive') ||
      n?.data?.providerId === 'onedrive'
    )
  })

  logger.info('📊 User workflows overview:', {
    userId,
    totalWorkflows: allWorkflows?.length || 0,
    directWorkflows: directWorkflows?.length || 0,
    totalActiveInDb: workflows?.length || 0,
    onedriveWorkflowsInDb: onedriveWorkflows.map(w => ({
      id: w.id,
      name: w.name,
      userId: w.user_id,
      matchesUser: w.user_id === userId
    })),
    workflowStatuses: allWorkflows?.map(w => ({ name: w.name, status: w.status, userId: w.user_id })) || [],
    queryError: allError
  })

  logger.info('🔎 Checking workflows for trigger match:', {
    workflowCount: workflows?.length || 0,
    eventType: event.type,
    eventAction: event.action,
    userId,
    activeWorkflows: workflows?.map(w => ({ name: w.name, userId: w.user_id })) || [],
    error: workflowError
  })

  const folderPathCache = new Map<string, string>()
  const client = accessToken ? new MicrosoftGraphClient({ accessToken }) : null

  // Check each workflow for matching triggers
  for (const workflow of workflows) {
    try {
      // Get nodes from pre-loaded map
      const nodes = nodesByWorkflow.get(workflow.id) || []

      // Debug node structure
      if (nodes.length > 0) {
        logger.info('🔍 First node structure sample:', {
          type: nodes[0]?.type,
          dataType: nodes[0]?.data?.type,
          isTrigger: nodes[0]?.data?.isTrigger,
          providerId: nodes[0]?.data?.providerId,
          fullNode: JSON.stringify(nodes[0]).substring(0, 200)
        })
      }

      logger.info(`📋 Checking workflow ${workflow.id}:`, {
        nodeCount: nodes.length,
        triggerNodes: nodes.filter((n: any) => {
          // Check both possible locations for trigger type
          const nodeType = n?.data?.type || n?.type
          const isTrigger = n?.data?.isTrigger ||
            nodeType?.includes('trigger') ||
            nodeType?.startsWith('microsoft_graph_')
          return isTrigger
        }).map((n: any) => ({
          type: n?.data?.type || n?.type,
          providerId: n?.data?.providerId,
          isTrigger: n?.data?.isTrigger
        }))
      })

      // Find trigger nodes that match this event type
      const triggerNodes = nodes.filter((node: any) => {
        const nodeType = node?.data?.type || node?.type

        // Log each node being checked
        if (nodeType?.includes('onedrive') || nodeType?.includes('trigger')) {
          logger.info('🔎 Checking node:', {
            nodeType,
            eventType: event.type,
            dataType: node?.data?.type,
            isTrigger: node?.data?.isTrigger
          })
        }

        // Support existing microsoft_graph_* matching
        if (nodeType?.startsWith('microsoft_graph_')) {
          switch (event.type) {
            case 'onedrive_item':
              return nodeType.includes('onedrive') && (!node.data?.actions || node.data.actions.includes(event.action))
            case 'outlook_mail':
              return nodeType.includes('mail') && (!node.data?.actions || node.data.actions.includes(event.action))
            case 'outlook_calendar':
              return nodeType.includes('calendar') && (!node.data?.actions || node.data.actions.includes(event.action))
            case 'teams_message':
              return (nodeType.includes('teams') || nodeType.includes('chat')) && (!node.data?.actions || node.data.actions.includes(event.action))
            case 'onenote_page':
              return nodeType.includes('onenote') && (!node.data?.actions || node.data.actions.includes(event.action))
            default:
              return false
          }
        }

        // ChainReact OneDrive trigger support - check both locations
        if (nodeType === 'onedrive_trigger_new_file' ||
            nodeType === 'onedrive_trigger_file_modified') {
          logger.info('✅ Found matching OneDrive trigger node:', nodeType)
          // Only trigger for actual file changes, not folder updates
          const isFileEvent = event.action === 'file_created' ||
                             event.action === 'file_updated' ||
                             event.action === 'deleted'
          if (event.type === 'onedrive_item' && !isFileEvent) {
            logger.info('⏭️ Skipping folder update event for file trigger')
            return false
          }
          return event.type === 'onedrive_item'
        }

        // ChainReact Outlook email trigger support
        if (nodeType === 'microsoft-outlook_trigger_new_email') {
          logger.info('✅ Found matching Outlook email trigger node:', nodeType)
          return event.type === 'outlook_mail' && (event.action === 'created' || event.action === 'draft')
        }

        if (nodeType === 'microsoft-outlook_trigger_email_sent') {
          logger.info('✅ Found matching Outlook email sent trigger node:', nodeType)
          return event.type === 'outlook_mail' && (event.action === 'sent' || event.action === 'created')
        }

        return false
      })
      
      logger.info(`✅ Found ${triggerNodes.length} matching trigger nodes`)

      // If we found matching triggers, execute the workflow
      if (triggerNodes.length > 0) {
        // For OneDrive triggers, apply per-node config filters before executing
        const onedriveNodes = triggerNodes.filter((n: any) =>

          n?.data?.type === 'onedrive_trigger_new_file' ||

          n?.data?.type === 'onedrive_trigger_file_modified'

        )

        const outlookNodes = triggerNodes.filter((n: any) => {

          const nodeType = n?.data?.type || n?.type

          return nodeType === 'microsoft-outlook_trigger_new_email' ||

                 nodeType === 'microsoft-outlook_trigger_email_sent'

        })

        const otherNodes = triggerNodes.filter((n: any) => {

          const nodeType = n?.data?.type || n?.type

          return nodeType !== 'onedrive_trigger_new_file' &&

                 nodeType !== 'onedrive_trigger_file_modified' &&

                 nodeType !== 'microsoft-outlook_trigger_new_email' &&

                 nodeType !== 'microsoft-outlook_trigger_email_sent'

        })



        logger.info('dY"? Trigger type distribution:', {

          onedriveNodeCount: onedriveNodes.length,

          outlookNodeCount: outlookNodes.length,

          otherNodeCount: otherNodes.length,

          eventType: event.type,

          eventAction: event.action

        })



        const shouldTriggerFromOneDrive = async (): Promise<boolean> => {

          if (onedriveNodes.length === 0) return false

          if (event.type !== 'onedrive_item') return false



          const payload = event.originalPayload || {}

          const itemPath: string | null = payload?.parentReference?.path && payload?.name

            ? `${payload.parentReference.path}/${payload.name}`

            : null



          logger.info('dY"? Checking OneDrive item:', {

            itemPath,

            isFile: Boolean(payload?.file),

            isFolder: Boolean(payload?.folder),

            createdAt: payload?.createdDateTime,

            modifiedAt: payload?.lastModifiedDateTime

          })



          for (const node of onedriveNodes) {

            const cfg = node?.data?.config || {}

            const folderId: string | undefined = cfg.folderId

            const includeSubfolders: boolean = cfg.includeSubfolders !== false

            const watchType: string = cfg.watchType || 'any'

            const fileType: string = cfg.fileType || 'any'

            const triggerOnUpdates: boolean = cfg.triggerOnUpdates === true



            let folderPath: string | null = null

            if (folderId && client) {

              if (folderPathCache.has(folderId)) {

                folderPath = folderPathCache.get(folderId)!

              } else {

                try {

                  const folderInfo: any = await client.request(`/me/drive/items/${folderId}`)

                  const basePath: string | null = folderInfo?.parentReference?.path || null

                  folderPath = basePath && folderInfo?.name ? `${basePath}/${folderInfo.name}` : null

                  if (folderPath) folderPathCache.set(folderId, folderPath)

                } catch {

                  folderPath = null

                }

              }

            }



            if (folderPath && itemPath) {

              const withinFolder = includeSubfolders ? itemPath.startsWith(folderPath) : itemPath === folderPath

              if (!withinFolder) continue

            } else if (folderPath && !itemPath) {

              continue

            }



            const isFile = Boolean(payload?.file)

            const isFolder = Boolean(payload?.folder)

            if (watchType === 'files' && !isFile) continue

            if (watchType === 'folders' && !isFolder) continue



            if (isFile && fileType && fileType !== 'any') {

              const mime: string = payload?.file?.mimeType || ''

              const matches =

                (fileType === 'images' && mime.startsWith('image/')) ||

                (fileType === 'audio' && mime.startsWith('audio/')) ||

                (fileType === 'video' && mime.startsWith('video/')) ||

                (fileType === 'pdf' && mime === 'application/pdf') ||

                (fileType === 'documents' && (mime.startsWith('text/') || mime.includes('word') || mime.includes('pdf'))) ||

                (fileType === 'spreadsheets' && mime.includes('sheet')) ||

                (fileType === 'presentations' && mime.includes('presentation')) ||

                (fileType === 'archives' && (mime.includes('zip') || mime.includes('x-tar') || mime.includes('rar')))

              if (!matches) continue

            }



            // No node emits onedrive_trigger_file_created (OneDrive provider
            // defines onedrive_trigger_new_file / _file_modified only); the
            // dead match-branch was removed alongside the lifecycle alias.

            return true

          }



          return false

        }



        const matchesOutlookConfig = shouldTriggerFromOutlook(outlookNodes, event)

        logger.info('dY"? Outlook trigger evaluation:', {

          matchesOutlookConfig,

          outlookNodeCount: outlookNodes.length

        })



        const shouldTrigger = otherNodes.length > 0 || matchesOutlookConfig || (await shouldTriggerFromOneDrive())

        if (!shouldTrigger) {

          logger.info('?s??,? Skipping workflow execution after applying provider-specific filters')

          continue

        }

        // Check if this workflow has already been triggered for this event (prevent race condition duplicates)
        const eventUniqueKey = `${workflow.id}-${event.id}-${event.type}-${event.action}`
        const recentExecutionWindow = 60000 // 60 seconds

        const { data: recentExecutions } = await getSupabase()
          .from('workflow_execution_sessions')
          .select('id, created_at')
          .eq('workflow_id', workflow.id)
          .eq('user_id', userId)
          .gte('created_at', new Date(Date.now() - recentExecutionWindow).toISOString())
          .order('created_at', { ascending: false })
          .limit(5)

        // Check if any recent execution has the same event in its context
        const isDuplicate = recentExecutions?.some(session => {
          // Check created_at to ensure it's very recent (within last 60 seconds)
          const sessionAge = Date.now() - new Date(session.created_at).getTime()
          return sessionAge < recentExecutionWindow
        })

        if (isDuplicate) {
          logger.info(`⏭️ Skipping duplicate workflow execution for event ${event.id} on workflow ${workflow.id}`)
          continue
        }

        const executionEngine = new (await import('@/lib/execution/advancedExecutionEngine')).AdvancedExecutionEngine()

        logger.info('🚀 Creating execution session for workflow:', workflow.id, 'userId:', userId)

        // Create execution session properly
        const executionSession = await executionEngine.createExecutionSession(
          workflow.id,
          userId, // Pass the correct userId
          'webhook',
          {
            inputData: {
              ...event,
              source: 'microsoft-graph-worker',
              timestamp: new Date().toISOString()
            },
            eventUniqueKey // Store this for future deduplication
          }
        )

        logger.info('📤 Executing workflow with session:', executionSession.id)

        // Execute the workflow with the session
        await executionEngine.executeWorkflowAdvanced(executionSession.id, {
          ...event,
          source: 'microsoft-graph-worker',
          timestamp: new Date().toISOString()
        })
      }
    } catch (error) {
      logger.error(`Error processing workflow ${workflow.id} for event:`, error)
    }
  }
}



function shouldTriggerFromOutlook(nodes: any[], event: any): boolean {

  if (!Array.isArray(nodes) || nodes.length === 0) return false

  if (!event || event.type !== 'outlook_mail') return false



  const payload = event.originalPayload || {}

  const eventFrom = normalizeOutlookEmail(event.from || payload?.from?.emailAddress?.address)

  const eventSubjectSource = event.subject ?? payload?.subject

  const eventSubject = typeof eventSubjectSource === 'string' ? eventSubjectSource.trim().toLowerCase() : ''

  const eventHasAttachments = typeof event.hasAttachments === 'boolean'

    ? event.hasAttachments

    : Boolean(payload?.hasAttachments || (Array.isArray(payload?.attachments) && payload.attachments.length > 0))

  const eventImportanceSource = event.importance ?? payload?.importance

  const eventImportance = typeof eventImportanceSource === 'string' ? eventImportanceSource.trim().toLowerCase() : ''

  const eventFolderId = typeof payload?.parentFolderId === 'string' ? payload.parentFolderId.trim().toLowerCase() : ''



  for (const node of nodes) {

    const nodeType = node?.data?.type || node?.type

    if (nodeType === 'microsoft-outlook_trigger_new_email') {

      if (!(event.action === 'created' || event.action === 'draft')) continue

    } else if (nodeType === 'microsoft-outlook_trigger_email_sent') {

      if (!(event.action === 'sent' || event.action === 'created')) continue

    } else {

      continue

    }



    const config = node?.data?.config || node?.data?.triggerConfig || {}

    const fromFilters = normalizeOutlookEmailList(config.from)

    if (fromFilters.length > 0) {

      if (!eventFrom || !fromFilters.includes(eventFrom)) {

        logger.info('dY"? Outlook trigger skipped (sender filter mismatch)', {

          nodeType,

          expected: fromFilters,

          actual: eventFrom

        })

        continue

      }

    }



    const subjectFilter = typeof config.subject === 'string' ? config.subject.trim().toLowerCase() : ''

    if (subjectFilter) {

      if (!eventSubject || !eventSubject.includes(subjectFilter)) {

        logger.info('dY"? Outlook trigger skipped (subject filter mismatch)', {

          nodeType,

          subjectFilter,

          eventSubject

        })

        continue

      }

    }



    const attachmentConfig = config.hasAttachment ?? config.hasAttachments ?? 'any'

    const attachmentFilter = typeof attachmentConfig === 'string' ? attachmentConfig.trim().toLowerCase() : 'any'

    if (attachmentFilter === 'yes' && !eventHasAttachments) {

      logger.info('dY"? Outlook trigger skipped (attachment filter requires attachments)', {

        nodeType

      })

      continue

    }

    if (attachmentFilter === 'no' && eventHasAttachments) {

      logger.info('dY"? Outlook trigger skipped (attachment filter excludes attachments)', {

        nodeType

      })

      continue

    }



    const importanceFilter = typeof config.importance === 'string' ? config.importance.trim().toLowerCase() : 'any'

    if (importanceFilter && importanceFilter !== 'any') {

      if (!eventImportance || eventImportance !== importanceFilter) {

        logger.info('dY"? Outlook trigger skipped (importance filter mismatch)', {

          nodeType,

          importanceFilter,

          eventImportance

        })

        continue

      }

    }



    const folderConfig = typeof config.folder === 'string' ? config.folder.trim().toLowerCase() : ''

    if (folderConfig && folderConfig !== 'inbox' && folderConfig !== 'default' && folderConfig !== 'any') {

      if (!eventFolderId || eventFolderId !== folderConfig) {

        logger.info('dY"? Outlook trigger skipped (folder filter mismatch)', {

          nodeType,

          folderConfig,

          eventFolderId

        })

        continue

      }

    }



    logger.info('dY"? Outlook trigger matched node configuration', {

      nodeType,

      fromFilters,

      subjectFilter,

      attachmentFilter,

      importanceFilter,

      eventFrom,

      eventSubject

    })

    return true

  }



  return false

}



function normalizeOutlookEmailList(value: any): string[] {

  if (!value) return []

  if (Array.isArray(value)) {

    return value.map(normalizeOutlookEmail).filter(Boolean)

  }

  if (typeof value === 'string') {

    const trimmed = value.trim()

    if (!trimmed) return []

    if (trimmed.startsWith('[')) {

      try {

        const parsed = JSON.parse(trimmed)

        if (Array.isArray(parsed)) {

          return parsed.map(normalizeOutlookEmail).filter(Boolean)

        }

      } catch {

        // ignore JSON parse issues

      }

    }

    return trimmed.split(',').map(normalizeOutlookEmail).filter(Boolean)

  }

  if (typeof value === 'object') {

    const candidate = value?.value ?? value?.email ?? value?.address

    if (candidate) {

      return normalizeOutlookEmailList(candidate)

    }

  }

  return []

}



function normalizeOutlookEmail(value: any): string {

  if (!value) return ''

  if (typeof value === 'string') {

    let trimmed = value.trim()

    const angleStart = trimmed.lastIndexOf('<')

    const angleEnd = trimmed.lastIndexOf('>')

    if (angleStart !== -1 && angleEnd !== -1 && angleEnd > angleStart) {

      trimmed = trimmed.slice(angleStart + 1, angleEnd)

    }

    return trimmed.trim().toLowerCase()

  }

  if (typeof value === 'object') {

    if (typeof value.address === 'string') return normalizeOutlookEmail(value.address)

    if (typeof value.email === 'string') return normalizeOutlookEmail(value.email)

    if (typeof value.value === 'string') return normalizeOutlookEmail(value.value)

  }

  return ''

}



async function fetchOneDriveChanges(payload: any, userId: string): Promise<any[]> {
  const { accessToken, refreshToken, integrationId } = await resolveOneDriveTokens(userId)

  try {
    return await fetchResourceChanges('onedrive', payload, accessToken)
  } catch (error: any) {
    const message = error?.message || ''
    if (!refreshToken || (!message.includes('InvalidAuthenticationToken') && !message.includes('expired'))) {
      throw error
    }

    // Attempt refresh
    const refreshed = await refreshOneDriveAccessToken(refreshToken)
    if (!refreshed?.accessToken) {
      throw error
    }

    await updateOneDriveTokens(integrationId, refreshed)
    return await fetchResourceChanges('onedrive', payload, refreshed.accessToken)
  }
}

async function resolveOneDriveTokens(userId: string): Promise<{ accessToken: string; refreshToken?: string; integrationId: string }> {
  const { data: integration } = await getSupabase()
    .from('integrations')
    .select('id, access_token, refresh_token, status')
    .eq('user_id', userId)
    .eq('provider', 'onedrive')
    .eq('status', 'connected')
    .maybeSingle()

  if (!integration) {
    throw new Error('OneDrive integration not found or not connected')
  }

  const decryptedAccess = integration.access_token ? safeDecrypt(integration.access_token) : null
  const decryptedRefresh = integration.refresh_token ? safeDecrypt(integration.refresh_token) : undefined

  if (decryptedAccess && decryptedAccess.includes('.')) {
    return {
      accessToken: decryptedAccess,
      refreshToken: decryptedRefresh,
      integrationId: integration.id
    }
  }

  if (decryptedRefresh) {
    const refreshed = await refreshOneDriveAccessToken(decryptedRefresh)
    if (refreshed?.accessToken) {
      await updateOneDriveTokens(integration.id, refreshed)
      return {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || decryptedRefresh,
        integrationId: integration.id
      }
    }
  }

  throw new Error('No valid Microsoft Graph access token available for OneDrive delta')
}

async function refreshOneDriveAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number; tokenType?: string }> {
  const clientId = process.env.ONEDRIVE_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Microsoft OAuth credentials not configured')
  }

  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'https://graph.microsoft.com/.default'
    })
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Failed to refresh Microsoft token: ${errorText}`)
  }

  const tokenJson = await response.json()
  return {
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    expiresIn: tokenJson.expires_in,
    tokenType: tokenJson.token_type
  }
}

async function updateOneDriveTokens(
  integrationId: string,
  tokens: { accessToken: string; refreshToken?: string; expiresIn?: number; tokenType?: string }
): Promise<void> {
  const updateData: Record<string, any> = {
    access_token: encrypt(tokens.accessToken),
    updated_at: new Date().toISOString()
  }

  if (tokens.refreshToken) {
    updateData.refresh_token = encrypt(tokens.refreshToken)
  }

  if (typeof tokens.expiresIn === 'number') {
    updateData.expires_at = new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
  }

  // Note: token_type field doesn't exist in integrations table
  // Store it in metadata if needed
  if (tokens.tokenType) {
    const { data: existing } = await getSupabase()
      .from('integrations')
      .select('metadata')
      .eq('id', integrationId)
      .single()

    const metadata = existing?.metadata || {}
    updateData.metadata = { ...metadata, token_type: tokens.tokenType }
  }

  const { error } = await getSupabase()
    .from('integrations')
    .update(updateData)
    .eq('id', integrationId)

  if (error) {
    logger.error('Failed to update OneDrive integration tokens:', error)
  }
}

// Outlook/Mail token resolution (similar to OneDrive)
async function fetchOutlookChanges(payload: any, userId: string, resourceType: string): Promise<any[]> {
  const { accessToken, refreshToken, integrationId } = await resolveProviderTokens(userId, resourceType)

  try {
    return await fetchResourceChanges(resourceType, payload, accessToken)
  } catch (error: any) {
    const message = error?.message || ''
    if (!refreshToken || (!message.includes('InvalidAuthenticationToken') && !message.includes('expired'))) {
      throw error
    }

    // Attempt refresh
    const refreshed = await refreshMicrosoftAccessToken(refreshToken)
    if (!refreshed?.accessToken) {
      throw error
    }

    await updateMicrosoftTokens(integrationId, refreshed)
    return await fetchResourceChanges(resourceType, payload, refreshed.accessToken)
  }
}

// Generic token resolver for any Microsoft provider
async function resolveProviderTokens(userId: string, resourceType: string): Promise<{ accessToken: string; refreshToken?: string; integrationId: string }> {
  // Map resource type to provider name
  const providerMap: Record<string, string> = {
    'onedrive': 'onedrive',
    'mail': 'microsoft-outlook',
    'calendar': 'microsoft-outlook',
    'teams': 'microsoft-teams',
    'chat': 'microsoft-teams',
    'onenote': 'microsoft-onenote'
  }

  const provider = providerMap[resourceType] || 'microsoft'

  logger.info('🔑 Resolving tokens for resource type:', resourceType, '→ provider:', provider)

  const { data: integration } = await getSupabase()
    .from('integrations')
    .select('id, access_token, refresh_token, status')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('status', 'connected')
    .maybeSingle()

  if (!integration) {
    throw new Error(`${provider} integration not found or not connected`)
  }

  const decryptedAccess = integration.access_token ? safeDecrypt(integration.access_token) : null
  const decryptedRefresh = integration.refresh_token ? safeDecrypt(integration.refresh_token) : undefined

  if (decryptedAccess && decryptedAccess.includes('.')) {
    logger.info('✅ Found valid access token for provider:', provider)
    return {
      accessToken: decryptedAccess,
      refreshToken: decryptedRefresh,
      integrationId: integration.id
    }
  }

  if (decryptedRefresh) {
    logger.info('🔄 Access token invalid, refreshing for provider:', provider)
    const refreshed = await refreshMicrosoftAccessToken(decryptedRefresh)
    if (refreshed?.accessToken) {
      await updateMicrosoftTokens(integration.id, refreshed)
      return {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || decryptedRefresh,
        integrationId: integration.id
      }
    }
  }

  throw new Error(`No valid Microsoft Graph access token available for ${provider}`)
}

async function refreshMicrosoftAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number; tokenType?: string }> {
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Microsoft OAuth credentials not configured')
  }

  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'https://graph.microsoft.com/.default'
    })
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Failed to refresh Microsoft token: ${errorText}`)
  }

  const tokenJson = await response.json()
  return {
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    expiresIn: tokenJson.expires_in,
    tokenType: tokenJson.token_type
  }
}

async function updateMicrosoftTokens(
  integrationId: string,
  tokens: { accessToken: string; refreshToken?: string; expiresIn?: number; tokenType?: string }
): Promise<void> {
  const updateData: Record<string, any> = {
    access_token: encrypt(tokens.accessToken),
    updated_at: new Date().toISOString()
  }

  if (tokens.refreshToken) {
    updateData.refresh_token = encrypt(tokens.refreshToken)
  }

  if (typeof tokens.expiresIn === 'number') {
    updateData.expires_at = new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
  }

  if (tokens.tokenType) {
    const { data: existing } = await getSupabase()
      .from('integrations')
      .select('metadata')
      .eq('id', integrationId)
      .single()

    const metadata = existing?.metadata || {}
    updateData.metadata = { ...metadata, token_type: tokens.tokenType }
  }

  const { error } = await getSupabase()
    .from('integrations')
    .update(updateData)
    .eq('id', integrationId)

  if (error) {
    logger.error('Failed to update Microsoft integration tokens:', error)
  }
}