import { ExecutionContext } from "../workflowExecutionService"
import { GmailIntegrationService } from "../integrations/gmailIntegrationService"
import { SlackIntegrationService } from "../integrations/slackIntegrationService"
import { GoogleIntegrationService } from "../integrations/googleIntegrationService"

import { logger } from '@/lib/utils/logger'

export class IntegrationNodeHandlers {
  private gmailService: GmailIntegrationService
  private slackService: SlackIntegrationService
  private googleService: GoogleIntegrationService

  constructor() {
    this.gmailService = new GmailIntegrationService()
    this.slackService = new SlackIntegrationService()
    this.googleService = new GoogleIntegrationService()
  }

  async execute(node: any, context: ExecutionContext): Promise<any> {
    const nodeType = node.data.type
    logger.info(`🔌 Executing integration node: ${nodeType}`)
    logger.info(`📌 IntegrationHandlers - Context userId: ${context.userId}`)

    // Gmail integrations
    if (nodeType.startsWith('gmail_')) {
      return await this.gmailService.execute(node, context)
    }

    // Slack integrations
    if (nodeType.startsWith('slack_')) {
      // Use the new action handlers for specific actions
      if (nodeType === 'slack_action_send_message') {
        const { slackActionSendMessage } = await import('@/lib/workflows/actions/slack')
        const config = node.data.config || {}
        const result = await slackActionSendMessage(config, context.userId, context.data || {})

        if (!result.success) {
          throw new Error(result.message || 'Failed to send Slack message')
        }

        return result.output
      }

      if (nodeType === 'slack_action_create_channel') {
        const { createSlackChannel } = await import('@/lib/workflows/actions/slack')
        const config = node.data.config || {}
        const result = await createSlackChannel(config, context.userId, context.data || {})

        if (!result.success) {
          throw new Error(result.message || 'Failed to create Slack channel')
        }

        return result.output
      }

      // Fall back to the service for other Slack actions
      return await this.slackService.execute(node, context)
    }

    // Google integrations (Drive, Sheets, Docs, Calendar)
    if (nodeType.startsWith('google_') || nodeType.startsWith('google-') || nodeType.startsWith('sheets_') || nodeType.startsWith('calendar_')) {
      return await this.googleService.execute(node, context)
    }

    // Microsoft Outlook integrations
    if (nodeType.startsWith('microsoft-outlook_') || nodeType.startsWith('outlook_')) {
      const config = node.data.config || {}
      switch (nodeType) {
        case 'microsoft-outlook_trigger_new_email':
        case 'microsoft-outlook_trigger_email_sent':
        case 'microsoft-outlook_trigger_email_flagged':
          // Email triggers - in production, webhooks provide real data
          logger.info(`📧 Outlook email trigger (${nodeType}) executing in mode:`, context.testMode ? 'test' : 'live')
          logger.debug('[Outlook] Email trigger context', { source: context.data?.source, hasResourceData: !!context.data?.resourceData })

          // Check if we have real email data from webhook
          if (context.data?.source === 'microsoft-graph-webhook' && context.data?.resourceData?.id) {
            logger.info('📧 Fetching real email from Microsoft Graph API')

            try {
              // Fetch the actual email using Microsoft Graph API
              const { getDecryptedAccessToken } = await import('@/lib/workflows/actions/core/getDecryptedAccessToken')
              const accessToken = await getDecryptedAccessToken(context.userId, 'microsoft')

              const messageId = context.data.resourceData.id
              const apiUrl = `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$expand=attachments`

              const response = await fetch(apiUrl, {
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json'
                }
              })

              if (!response.ok) {
                throw new Error(`Failed to fetch email: ${response.statusText}`)
              }

              const email = await response.json()
              logger.info('📧 Fetched email:', {
                subjectLength: email.subject?.length || 0,
                hasFrom: !!email.from?.emailAddress?.address
              })

              return {
                id: email.id,
                conversationId: email.conversationId,
                subject: email.subject,
                from: {
                  name: email.from?.emailAddress?.name || '',
                  email: email.from?.emailAddress?.address || ''
                },
                to: email.toRecipients?.map((r: any) => ({
                  name: r.emailAddress?.name || '',
                  email: r.emailAddress?.address || ''
                })) || [],
                cc: email.ccRecipients?.map((r: any) => ({
                  name: r.emailAddress?.name || '',
                  email: r.emailAddress?.address || ''
                })) || [],
                bcc: email.bccRecipients?.map((r: any) => ({
                  name: r.emailAddress?.name || '',
                  email: r.emailAddress?.address || ''
                })) || [],
                body: email.body?.content || '',
                bodyPreview: email.bodyPreview || '',
                attachments: email.attachments?.map((a: any) => ({
                  id: a.id,
                  name: a.name,
                  contentType: a.contentType,
                  size: a.size,
                  isInline: a.isInline
                })) || [],
                receivedDateTime: email.receivedDateTime,
                sentDateTime: email.sentDateTime,
                importance: email.importance,
                isRead: email.isRead,
                hasAttachments: email.hasAttachments,
                flagStatus: email.flag?.flagStatus || 'notFlagged',
                folder: email.parentFolderId
              }
            } catch (error) {
              logger.error('❌ Error fetching email from Microsoft Graph:', error)
              // Fall through to sample data
            }
          }

          // For manual workflow execution (Run Once), return sample data
          return {
            id: context.testMode ? 'test-email-123' : `email-${Date.now()}`,
            conversationId: `conv-${Date.now()}`,
            subject: 'Sample Email for Workflow Testing',
            from: {
              name: 'Workflow Test Sender',
              email: 'test@example.com'
            },
            to: [{
              name: 'Workflow Test Recipient',
              email: 'recipient@example.com'
            }],
            cc: [],
            bcc: [],
            body: 'This is sample email content used for testing your workflow execution.',
            bodyPreview: 'This is sample email content...',
            attachments: [],
            receivedDateTime: new Date().toISOString(),
            sentDateTime: new Date().toISOString(),
            importance: 'normal',
            isRead: false,
            hasAttachments: false,
            flagStatus: 'notFlagged',
            folder: 'inbox'
          }

        case 'microsoft-outlook_trigger_new_calendar_event':
        case 'microsoft-outlook_trigger_updated_calendar_event':
        case 'microsoft-outlook_trigger_deleted_calendar_event':
        case 'microsoft-outlook_trigger_calendar_event_start':
          // Calendar triggers - in production, webhooks provide real data
          logger.info(`📅 Outlook calendar trigger (${nodeType}) executing in mode:`, context.testMode ? 'test' : 'live')
          logger.debug('[Outlook] Calendar trigger context', { source: context.data?.source, hasResourceData: !!context.data?.resourceData })

          // Check if we have real calendar data from webhook
          if (context.data?.source === 'microsoft-graph-webhook' && context.data?.resourceData?.id) {
            logger.info('📅 Fetching real calendar event from Microsoft Graph API')

            try {
              const { getDecryptedAccessToken } = await import('@/lib/workflows/actions/core/getDecryptedAccessToken')
              const accessToken = await getDecryptedAccessToken(context.userId, 'microsoft')

              const eventId = context.data.resourceData.id
              const apiUrl = `https://graph.microsoft.com/v1.0/me/events/${eventId}`

              const response = await fetch(apiUrl, {
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json'
                }
              })

              if (!response.ok) {
                // For deleted events, the event may no longer exist
                if (nodeType === 'microsoft-outlook_trigger_deleted_calendar_event') {
                  return {
                    id: eventId,
                    subject: context.data.resourceData.subject || 'Deleted Event',
                    start: context.data.resourceData.start || null,
                    end: context.data.resourceData.end || null,
                    isCancelled: true
                  }
                }
                throw new Error(`Failed to fetch calendar event: ${response.statusText}`)
              }

              const event = await response.json()
              logger.info('📅 Fetched calendar event:', {
                subjectLength: event.subject?.length || 0,
                hasStart: !!event.start
              })

              return {
                id: event.id,
                subject: event.subject,
                body: event.body?.content || '',
                start: event.start,
                end: event.end,
                location: event.location?.displayName || '',
                attendees: event.attendees?.map((a: any) => ({
                  name: a.emailAddress?.name || '',
                  email: a.emailAddress?.address || '',
                  status: a.status?.response || 'none'
                })) || [],
                organizer: {
                  name: event.organizer?.emailAddress?.name || '',
                  email: event.organizer?.emailAddress?.address || ''
                },
                isOnlineMeeting: event.isOnlineMeeting || false,
                onlineMeetingUrl: event.onlineMeeting?.joinUrl || event.onlineMeetingUrl || '',
                createdDateTime: event.createdDateTime,
                lastModifiedDateTime: event.lastModifiedDateTime,
                isCancelled: event.isCancelled || false
              }
            } catch (error) {
              logger.error('❌ Error fetching calendar event from Microsoft Graph:', error)
              // Fall through to sample data
            }
          }

          // For manual workflow execution (Run Once), return sample data
          return {
            id: context.testMode ? 'test-event-123' : `event-${Date.now()}`,
            subject: 'Sample Calendar Event for Workflow Testing',
            body: 'This is a sample calendar event description.',
            start: {
              dateTime: new Date().toISOString(),
              timeZone: 'UTC'
            },
            end: {
              dateTime: new Date(Date.now() + 3600000).toISOString(),
              timeZone: 'UTC'
            },
            location: 'Sample Location',
            attendees: [{
              name: 'Sample Attendee',
              email: 'attendee@example.com',
              status: 'none'
            }],
            organizer: {
              name: 'Workflow Test Organizer',
              email: 'organizer@example.com'
            },
            isOnlineMeeting: false,
            onlineMeetingUrl: '',
            createdDateTime: new Date().toISOString(),
            lastModifiedDateTime: new Date().toISOString(),
            isCancelled: false,
            minutesUntilStart: nodeType === 'microsoft-outlook_trigger_calendar_event_start' ? 15 : undefined
          }

        case 'microsoft-outlook_trigger_new_contact':
        case 'microsoft-outlook_trigger_updated_contact':
          // Contact triggers - in production, webhooks provide real data
          logger.info(`👤 Outlook contact trigger (${nodeType}) executing in mode:`, context.testMode ? 'test' : 'live')
          logger.debug('[Outlook] Contact trigger context', { source: context.data?.source, hasResourceData: !!context.data?.resourceData })

          // Check if we have real contact data from webhook
          if (context.data?.source === 'microsoft-graph-webhook' && context.data?.resourceData?.id) {
            logger.info('👤 Fetching real contact from Microsoft Graph API')

            try {
              const { getDecryptedAccessToken } = await import('@/lib/workflows/actions/core/getDecryptedAccessToken')
              const accessToken = await getDecryptedAccessToken(context.userId, 'microsoft')

              const contactId = context.data.resourceData.id
              const apiUrl = `https://graph.microsoft.com/v1.0/me/contacts/${contactId}`

              const response = await fetch(apiUrl, {
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json'
                }
              })

              if (!response.ok) {
                throw new Error(`Failed to fetch contact: ${response.statusText}`)
              }

              const contact = await response.json()
              logger.info('👤 Fetched contact:', {
                hasDisplayName: !!contact.displayName
              })

              return {
                id: contact.id,
                displayName: contact.displayName || '',
                emailAddresses: contact.emailAddresses?.map((e: any) => ({
                  name: e.name || '',
                  address: e.address || ''
                })) || [],
                businessPhones: contact.businessPhones || [],
                mobilePhone: contact.mobilePhone || '',
                jobTitle: contact.jobTitle || '',
                companyName: contact.companyName || '',
                createdDateTime: contact.createdDateTime,
                lastModifiedDateTime: contact.lastModifiedDateTime
              }
            } catch (error) {
              logger.error('❌ Error fetching contact from Microsoft Graph:', error)
              // Fall through to sample data
            }
          }

          // For manual workflow execution (Run Once), return sample data
          return {
            id: context.testMode ? 'test-contact-123' : `contact-${Date.now()}`,
            displayName: 'Sample Contact for Workflow Testing',
            emailAddresses: [{
              name: 'Sample Contact',
              address: 'sample.contact@example.com'
            }],
            businessPhones: ['+1 (555) 123-4567'],
            mobilePhone: '+1 (555) 987-6543',
            jobTitle: 'Software Engineer',
            companyName: 'Sample Company',
            createdDateTime: new Date().toISOString(),
            lastModifiedDateTime: new Date().toISOString()
          }

        case 'microsoft-outlook_action_send_email': {
          const { sendOutlookEmail } = await import('@/lib/workflows/actions/microsoft-outlook')
          // PR-C4 — engine metadata for within-session idempotency.
          const meta = {
            executionSessionId: context.executionId,
            nodeId: node.id,
            actionType: node.data?.type ?? nodeType,
            provider: 'microsoft-outlook',
            testMode: context.testMode,
            workspaceId: context.workspaceId,
          }
          const result = await sendOutlookEmail(config, context.userId, context.data || {}, meta)
          if (!result?.success) {
            throw new Error(result?.message || 'Failed to send Outlook email')
          }
          return result.output
        }
        case 'microsoft-outlook_action_create_calendar_event': {
          const { createOutlookCalendarEvent } = await import('@/lib/workflows/actions/microsoft-outlook')
          const result = await createOutlookCalendarEvent(config, context.userId, context.data || {})
          if (!result?.success) {
            throw new Error(result?.message || 'Failed to create Outlook calendar event')
          }
          return result.output
        }
        default:
          throw new Error(`Unsupported Microsoft Outlook action: ${nodeType}`)
      }
    }

    // Microsoft OneNote integrations
    if (nodeType.startsWith('microsoft-onenote_') || nodeType.startsWith('onenote_')) {
      const config = node.data.config || {}
      switch (nodeType) {
        case 'microsoft-onenote_action_create_notebook': {
          const { onenoteCreateNotebook } = await import('@/lib/workflows/actions/microsoft-onenote')
          const result = await onenoteCreateNotebook({
            displayName: config.displayName,
            userRole: config.userRole,
            overwriteIfExists: config.overwriteIfExists
          }, context as any)
          if (!result?.success) {
            throw new Error(result?.error || result?.message || 'Failed to create OneNote notebook')
          }
          return result
        }
        case 'microsoft-onenote_action_create_section': {
          const { onenoteCreateSection } = await import('@/lib/workflows/actions/microsoft-onenote')
          const result = await onenoteCreateSection({
            notebookId: config.notebookId,
            displayName: config.displayName
          }, context as any)
          if (!result?.success) {
            throw new Error(result?.error || result?.message || 'Failed to create OneNote section')
          }
          return result
        }
        case 'microsoft-onenote_action_create_page': {
          const { onenoteCreatePage } = await import('@/lib/workflows/actions/microsoft-onenote')
          const result = await onenoteCreatePage({
            notebookId: config.notebookId,
            sectionId: config.sectionId,
            title: config.title,
            content: config.content,
            contentType: config.contentType
          }, context as any)
          if (!result?.success) {
            throw new Error(result?.error || result?.message || 'Failed to create OneNote page')
          }
          return result
        }
        case 'microsoft-onenote_action_update_page': {
          const { onenoteUpdatePage } = await import('@/lib/workflows/actions/microsoft-onenote')
          const result = await onenoteUpdatePage({
            notebookId: config.notebookId,
            sectionId: config.sectionId,
            pageId: config.pageId,
            content: config.content,
            updateMode: config.updateMode,
            target: config.target,
            position: config.position
          }, context as any)
          if (!result?.success) {
            throw new Error(result?.error || result?.message || 'Failed to update OneNote page')
          }
          return result
        }
        case 'microsoft-onenote_action_get_page_content': {
          const { onenoteGetPageContent } = await import('@/lib/workflows/actions/microsoft-onenote')
          const result = await onenoteGetPageContent({
            notebookId: config.notebookId,
            sectionId: config.sectionId,
            pageId: config.pageId,
            includeIDs: config.includeIDs
          }, context as any)
          if (!result?.success) {
            throw new Error(result?.error || result?.message || 'Failed to get OneNote page content')
          }
          return result
        }
        case 'microsoft-onenote_action_list_pages': {
          const { onenoteGetPages } = await import('@/lib/workflows/actions/microsoft-onenote')
          const result = await onenoteGetPages({
            notebookId: config.notebookId,
            sectionId: config.sectionId
          }, context as any)
          if (!result?.success) {
            throw new Error(result?.error || result?.message || 'Failed to list OneNote pages')
          }
          return result
        }
        case 'microsoft-onenote_action_copy_page': {
          const { onenoteCopyPage } = await import('@/lib/workflows/actions/microsoft-onenote')
          const result = await onenoteCopyPage({
            pageId: config.pageId,
            destinationSectionId: config.destinationSectionId
          }, context as any)
          if (!result?.success) {
            throw new Error(result?.error || result?.message || 'Failed to copy OneNote page')
          }
          return result
        }
        case 'microsoft-onenote_action_delete_page': {
          const { onenoteDeletePage } = await import('@/lib/workflows/actions/microsoft-onenote')
          const result = await onenoteDeletePage({
            pageId: config.pageId
          }, context as any)
          if (!result?.success) {
            throw new Error(result?.error || result?.message || 'Failed to delete OneNote page')
          }
          return result
        }
        default:
          throw new Error(`Unknown OneNote action type: ${nodeType}`)
      }
    }

    // Discord integrations
    if (nodeType.startsWith('discord_')) {
      return await this.executeDiscordAction(node, context)
    }

    // Airtable integrations
    if (nodeType.startsWith('airtable_')) {
      return await this.executeAirtableAction(node, context)
    }

    // Notion integrations
    if (nodeType.startsWith('notion_')) {
      return await this.executeNotionAction(node, context)
    }

    // HubSpot integrations
    if (nodeType.startsWith('hubspot_')) {
      return await this.executeHubSpotAction(node, context)
    }

    // Trello integrations
    if (nodeType.startsWith('trello_')) {
      return await this.executeTrelloAction(node, context)
    }

    // Microsoft Excel integrations
    if (nodeType.startsWith('microsoft_excel_') || nodeType.startsWith('microsoft-excel_')) {
      return await this.executeMicrosoftExcelAction(node, context)
    }

    // Other integrations - route to specific handlers
    switch (nodeType) {
      case "webhook_call":
        return await this.executeWebhookCall(node, context)
      case "send_email":
        return await this.executeSendEmail(node, context)
      case "onedrive_upload_file":
      case "onedrive_action_upload_file":
        return await this.executeOneDriveUpload(node, context)
      case "dropbox_upload_file":
      case "dropbox_action_upload_file":
        return await this.executeDropboxUpload(node, context)
      default:
        // For unknown integrations, return a descriptive error
        throw new Error(`Integration type '${nodeType}' is not yet implemented. Please check if this action is available.`)
    }
  }

  private async executeWebhookCall(node: any, context: ExecutionContext) {
    logger.info("🌐 Executing webhook call")
    
    const url = node.data.config?.url
    const method = node.data.config?.method || 'POST'
    const headers = node.data.config?.headers || {}
    const body = node.data.config?.body || context.data

    if (!url) {
      throw new Error("Webhook URL is required")
    }

    if (context.testMode) {
      return {
        type: "webhook_call",
        url,
        method,
        status: "success (test mode)",
        response: { message: "Test webhook response" }
      }
    }

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: method !== 'GET' ? JSON.stringify(body) : undefined
      })

      const responseData = await response.json().catch(() => ({}))

      return {
        type: "webhook_call",
        url,
        method,
        status: response.status,
        response: responseData
      }
    } catch (error: any) {
      throw new Error(`Webhook call failed: ${error.message}`)
    }
  }

  private async executeSendEmail(node: any, context: ExecutionContext) {
    logger.info("📧 Executing send email")
    
    const to = node.data.config?.to
    const subject = node.data.config?.subject
    const body = node.data.config?.body

    if (!to || !subject) {
      throw new Error("Email recipient and subject are required")
    }

    if (context.testMode) {
      return {
        type: "send_email",
        to,
        subject,
        status: "sent (test mode)"
      }
    }

    // TODO: Implement actual email sending logic
    return {
      type: "send_email",
      to,
      subject,
      body,
      status: "sent"
    }
  }

  private async executeOneDriveUpload(node: any, context: ExecutionContext) {
    logger.info("☁️ Executing OneDrive upload")

    const config = node.data.config || {}

    logger.debug('[OneDrive] Config received', { fields: Object.keys(config) })
    logger.debug('[OneDrive] Node type:', node.data?.type)

    // Process OneDrive file upload

    // If in test mode, return mock data
    if (context.testMode) {
      return {
        type: "onedrive_action_upload_file",
        fileName: config.fileName || "test.txt",
        folder: config.folderId || "/",
        status: "uploaded (test mode)",
        fileId: "test-onedrive-file-id"
      }
    }

    try {
      // Import the OneDrive action handler directly
      const { uploadFileToOneDrive } = await import('@/lib/workflows/actions/onedrive')

      // Get node outputs from context
      const nodeOutputs = {}
      if (context.dataFlowManager && typeof context.dataFlowManager.getNodeOutput === 'function') {
        // Get outputs from all previous nodes
        const allNodes = context.dataFlowManager.nodeOutputs || {}
        Object.assign(nodeOutputs, allNodes)
      }

      // Call the handler
      const result = await uploadFileToOneDrive(
        config,
        context.userId,
        {
          nodeOutputs,
          ...context.data
        }
      )

      // Check if the action failed
      if (!result.success) {
        throw new Error(result.message || "OneDrive upload failed")
      }

      return result.output || result
    } catch (error: any) {
      logger.error("❌ OneDrive upload error:", error)
      throw error
    }
  }

  private async executeDiscordAction(node: any, context: ExecutionContext) {
    logger.info("💬 Executing Discord action")
    logger.debug(`[Discord] Node type: "${node.data.type}"`)
    logger.debug('[Discord] Context', { dataKeys: Object.keys(context.data || {}) })

    const nodeType = node.data.type
    const config = node.data.config || {}

    logger.debug('[Discord] Config fields', { fields: Object.keys(config) })

    // Import the actual Discord action handlers
    const { sendDiscordMessage } = await import("@/lib/workflows/actions/discord")

    // Handle different Discord action types
    switch (nodeType) {
      case "discord_action_send_message":
      case "discord_action_send_channel_message": // This is the actual type used
      case "discord_send_channel_message":
        logger.info("📤 Sending Discord channel message...")
        logger.info(`   Channel ID: ${config.channelId || 'not set'}`)
        logger.info(`   Has message: ${!!config.message}`)
        logger.info(`🔍 [INTEGRATION DEBUG] About to call sendDiscordMessage with userId: ${context.userId}`)

        // Use the actual Discord message sending function
        const result = await sendDiscordMessage(
          config,
          context.userId,
          context.data || {}
        )

        logger.info(`   Discord send result: ${result.success ? '✅ Success' : '❌ Failed'}`)
        if (!result.success) {
          logger.info(`   Error: ${result.message}`)
          throw new Error(result.message || "Failed to send Discord message")
        }

        return result.output
      
      case "discord_action_send_dm":
      case "discord_send_dm":
        const { sendDiscordDirectMessage } = await import("@/lib/workflows/actions/discord")
        const dmResult = await sendDiscordDirectMessage(
          config,
          context.userId,
          context.data || {}
        )
        if (!dmResult.success) {
          throw new Error(dmResult.message || "Failed to send Discord DM")
        }
        return dmResult.output

      case "discord_action_edit_message":
        const { editDiscordMessage } = await import("@/lib/workflows/actions/discord")
        const editResult = await editDiscordMessage(
          config,
          context.userId,
          context.data || {}
        )
        if (!editResult.success) {
          throw new Error(editResult.message || "Failed to edit Discord message")
        }
        return editResult.output

      case "discord_action_delete_message":
        const { deleteDiscordMessage } = await import("@/lib/workflows/actions/discord")
        const deleteResult = await deleteDiscordMessage(
          config,
          context.userId,
          context.data || {}
        )
        if (!deleteResult.success) {
          throw new Error(deleteResult.message || "Failed to delete Discord message")
        }
        return deleteResult.output

      case "discord_action_fetch_messages":
        const { fetchDiscordMessages } = await import("@/lib/workflows/actions/discord")
        const fetchResult = await fetchDiscordMessages(
          config,
          context.userId,
          context.data || {}
        )
        if (!fetchResult.success) {
          throw new Error(fetchResult.message || "Failed to fetch Discord messages")
        }
        return fetchResult.output

      default:
        throw new Error(`Unknown Discord action type: ${nodeType}`)
    }
  }

  private async executeAirtableAction(node: any, context: ExecutionContext) {
    logger.info("📊 Executing Airtable action")

    const nodeType = node.data.type
    const config = node.data.config || {}

    // Handle different Airtable action types
    switch (nodeType) {
      case "airtable_create_record":
      case "airtable_action_create_record": // Handle both naming conventions
        // Import and use the actual Airtable create record handler
        const { createAirtableRecord } = await import("@/lib/workflows/actions/airtable/createRecord")

        // PR-C4 — engine metadata for within-session idempotency.
        const airtableMeta = {
          executionSessionId: context.executionId,
          nodeId: node.id,
          actionType: node.data?.type ?? nodeType,
          provider: 'airtable',
          testMode: context.testMode,
          workspaceId: context.workspaceId,
        }
        const createResult = await createAirtableRecord(
          config,
          context.userId,
          context.data || {},
          airtableMeta
        )

        if (!createResult.success) {
          throw new Error(createResult.error || createResult.message || "Failed to create Airtable record")
        }

        return createResult.output

      case "airtable_update_record":
      case "airtable_action_update_record": // Handle both naming conventions
        // Import and use the actual Airtable update record handler
        const { updateAirtableRecord } = await import("@/lib/workflows/actions/airtable/updateRecord")

        const updateResult = await updateAirtableRecord(
          config,
          context.userId,
          context.data || {}
        )

        if (!updateResult.success) {
          throw new Error(updateResult.error || updateResult.message || "Failed to update Airtable record")
        }

        return updateResult.output

      case "airtable_delete_record":
      case "airtable_action_delete_record": { // Handle both naming conventions
        const { deleteAirtableRecord } = await import("@/lib/workflows/actions/airtable/deleteRecord")
        const deleteResult = await deleteAirtableRecord(
          config,
          context.userId,
          context.data || {}
        )
        if (!deleteResult.success) {
          throw new Error(deleteResult.error || deleteResult.message || "Failed to delete Airtable record")
        }
        return deleteResult.output
      }

      case "airtable_list_records":
      case "airtable_action_list_records": // Handle both naming conventions
        // Import and use the actual Airtable list records handler
        const { listAirtableRecords } = await import("@/lib/workflows/actions/airtable/listRecords")

        const listResult = await listAirtableRecords(
          config,
          context.userId,
          context.data || {}
        )

        if (!listResult.success) {
          throw new Error(listResult.error || listResult.message || "Failed to list Airtable records")
        }

        return listResult.output

      default:
        throw new Error(`Unknown Airtable action type: ${nodeType}`)
    }
  }

  private async executeNotionAction(node: any, context: ExecutionContext) {
    logger.info("📝 Executing Notion action")

    const nodeType = node.data.type
    const config = node.data.config || {}

    // Handle different Notion action types
    switch (nodeType) {
      case "notion_action_create_page":
        // Map create_page to manage_page with operation: 'create'
        const { executeNotionManagePage: executeCreatePage } = await import("@/lib/workflows/actions/registry")

        const createPageResult = await executeCreatePage(
          { ...config, operation: 'create' },
          context.userId,
          context.data || {}
        )

        if (!createPageResult.success) {
          throw new Error(createPageResult.message || "Failed to create Notion page")
        }

        return createPageResult.output

      case "notion_action_update_page": {
        // Use the dedicated update page handler
        const { executeNotionUpdatePage } = await import("@/lib/workflows/actions/notion/pageActions")

        const updatePageResult = await executeNotionUpdatePage(
          config,
          context.userId,
          context.data || {}
        )

        if (!updatePageResult.success) {
          throw new Error(updatePageResult.message || "Failed to update Notion page")
        }

        return updatePageResult.output
      }

      case "notion_action_append_to_page": {
        // Use the dedicated append to page handler
        const { executeNotionAppendToPage } = await import("@/lib/workflows/actions/notion/pageActions")

        const appendResult = await executeNotionAppendToPage(
          config,
          context.userId,
          context.data || {}
        )

        if (!appendResult.success) {
          throw new Error(appendResult.message || "Failed to append to Notion page")
        }

        return appendResult.output
      }

      case "notion_action_manage_page":
        // Import and use the actual Notion manage page handler
        const { executeNotionManagePage } = await import("@/lib/workflows/actions/registry")

        const managePageResult = await executeNotionManagePage(
          config,
          context.userId,
          context.data || {}
        )

        if (!managePageResult.success) {
          throw new Error(managePageResult.message || "Failed to execute Notion manage page action")
        }

        return managePageResult.output

      case "notion_action_manage_database":
        // Import and use the actual Notion manage database handler
        const { executeNotionManageDatabase } = await import("@/lib/workflows/actions/registry")

        const manageDatabaseResult = await executeNotionManageDatabase(
          config,
          context.userId,
          context.data || {}
        )

        if (!manageDatabaseResult.success) {
          throw new Error(manageDatabaseResult.message || "Failed to execute Notion manage database action")
        }

        return manageDatabaseResult.output

      case "notion_action_manage_comments":
        // Import and use the actual Notion manage comments handler
        const { executeNotionManageComments } = await import("@/lib/workflows/actions/registry")

        const manageCommentsResult = await executeNotionManageComments(
          config,
          context.userId,
          context.data || {}
        )

        if (!manageCommentsResult.success) {
          throw new Error(manageCommentsResult.message || "Failed to execute Notion manage comments action")
        }

        return manageCommentsResult.output

      case "notion_action_manage_users":
        // Import and use the actual Notion manage users handler
        const { executeNotionManageUsers } = await import("@/lib/workflows/actions/registry")

        const manageUsersResult = await executeNotionManageUsers(
          config,
          context.userId,
          context.data || {}
        )

        if (!manageUsersResult.success) {
          throw new Error(manageUsersResult.message || "Failed to execute Notion manage users action")
        }

        return manageUsersResult.output

      case "notion_action_get_page_details":
        // Import and use the actual Notion get page details handler
        const { executeNotionGetPageDetails } = await import("@/lib/workflows/actions/registry")

        const getPageDetailsResult = await executeNotionGetPageDetails(
          config,
          context.userId,
          context.data || {}
        )

        if (!getPageDetailsResult.success) {
          throw new Error(getPageDetailsResult.message || "Failed to execute Notion get page details action")
        }

        return getPageDetailsResult.output

      case "notion_action_search":
        // Import and use the actual Notion search handler
        const { executeNotionSearch } = await import("@/lib/workflows/actions/registry")

        const searchResult = await executeNotionSearch(
          config,
          context.userId,
          context.data || {}
        )

        if (!searchResult.success) {
          throw new Error(searchResult.message || "Failed to execute Notion search action")
        }

        return searchResult.output

      default:
        throw new Error(`Unknown Notion action type: ${nodeType}`)
    }
  }

  private async executeDropboxUpload(node: any, context: ExecutionContext) {
    logger.info("📦 Executing Dropbox upload")

    const config = node.data.config || {}

    // Import the actual Dropbox upload handler
    const { uploadDropboxFile } = await import('@/lib/workflows/actions/dropbox/uploadFile')

    // Call the handler with the proper config and context
    const result = await uploadDropboxFile(config, context)

    if (!result.success) {
      throw new Error(result.error || "Dropbox upload failed")
    }

    return result.output
  }

  private async executeTrelloAction(node: any, context: ExecutionContext) {
    logger.info("📋 Executing Trello action")
    const nodeType = node.data.type
    const config = node.data.config || {}

    // Handle different Trello action types
    switch (nodeType) {
      case "trello_action_create_card":
        // Import and use the actual Trello create card handler
        const { createTrelloCard } = await import("@/lib/workflows/actions/trello")
        const createCardResult = await createTrelloCard(
          config,
          context.userId,
          context.data || {}
        )

        if (!createCardResult.success) {
          throw new Error(createCardResult.message || "Failed to create Trello card")
        }

        return createCardResult.output

      case "trello_action_create_list":
        // Import and use the actual Trello create list handler
        const { createTrelloList } = await import("@/lib/workflows/actions/trello")
        const createListResult = await createTrelloList(
          config,
          context.userId,
          context.data || {}
        )

        if (!createListResult.success) {
          throw new Error(createListResult.message || "Failed to create Trello list")
        }

        return createListResult.output

      case "trello_action_move_card":
        // Import and use the actual Trello move card handler
        const { moveTrelloCard } = await import("@/lib/workflows/actions/trello")
        const moveCardResult = await moveTrelloCard(
          config,
          context.userId,
          context.data || {}
        )

        if (!moveCardResult.success) {
          throw new Error(moveCardResult.message || "Failed to move Trello card")
        }

        return moveCardResult.output

      case "trello_action_create_board":
        // Import and use the actual Trello create board handler
        const { createTrelloBoard } = await import("@/lib/workflows/actions/trello")
        const createBoardResult = await createTrelloBoard(
          config,
          context.userId,
          context.data || {}
        )

        if (!createBoardResult.success) {
          throw new Error(createBoardResult.message || "Failed to create Trello board")
        }

        return createBoardResult.output

      default:
        throw new Error(`Unknown Trello action type: ${nodeType}`)
    }
  }

  private async executeHubSpotAction(node: any, context: ExecutionContext) {
    logger.info("🎯 Executing HubSpot action")
    const nodeType = node.data.type
    const config = node.data.config || {}

    // Resolve any variable references in the configuration
    // Note: We'll use the config as-is since variable resolution happens in the action handlers
    const resolvedConfig = config

    // Handle different HubSpot action types
    switch (nodeType) {
      case "hubspot_action_create_contact":
      case "hubspot_action_create_contact_dynamic": // Handle dynamic version too
        // Import and use the actual HubSpot create contact handler
        const { createHubSpotContact } = await import("@/lib/workflows/actions/hubspot")
        const createContactResult = await createHubSpotContact(
          resolvedConfig,
          context.userId,
          context.data || {}
        )

        if (!createContactResult.success) {
          throw new Error(createContactResult.message || "Failed to create HubSpot contact")
        }

        return createContactResult.output

      case "hubspot_action_create_company":
        // Import and use the actual HubSpot create company handler
        const { createHubSpotCompany } = await import("@/lib/workflows/actions/hubspot")
        const createCompanyResult = await createHubSpotCompany(
          resolvedConfig,
          context.userId,
          context.data || {}
        )

        if (!createCompanyResult.success) {
          throw new Error(createCompanyResult.message || "Failed to create HubSpot company")
        }

        return createCompanyResult.output

      case "hubspot_action_create_deal":
        // Import and use the actual HubSpot create deal handler
        const { createHubSpotDeal } = await import("@/lib/workflows/actions/hubspot")
        const createDealResult = await createHubSpotDeal(
          resolvedConfig,
          context.userId,
          context.data || {}
        )

        if (!createDealResult.success) {
          throw new Error(createDealResult.message || "Failed to create HubSpot deal")
        }

        return createDealResult.output

      case "hubspot_action_add_contact_to_list":
        // Import and use the actual HubSpot add contact to list handler
        const { addContactToHubSpotList } = await import("@/lib/workflows/actions/hubspot")
        const addToListResult = await addContactToHubSpotList(
          resolvedConfig,
          context.userId,
          context.data || {}
        )

        if (!addToListResult.success) {
          throw new Error(addToListResult.message || "Failed to add contact to HubSpot list")
        }

        return addToListResult.output

      case "hubspot_action_update_deal":
        // Import and use the actual HubSpot update deal handler
        const { updateHubSpotDeal } = await import("@/lib/workflows/actions/hubspot")
        const updateDealResult = await updateHubSpotDeal(
          resolvedConfig,
          context.userId,
          context.data || {}
        )

        if (!updateDealResult.success) {
          throw new Error(updateDealResult.message || "Failed to update HubSpot deal")
        }

        return updateDealResult.output

      default:
        throw new Error(`Unknown HubSpot action type: ${nodeType}`)
    }
  }

  private async executeMicrosoftExcelAction(node: any, context: ExecutionContext) {
    logger.info("📊 Executing Microsoft Excel action")
    const nodeType = node.data.type
    const config = node.data.config || {}

    logger.debug(`[Excel] Action type: ${nodeType}`)
    logger.debug('[Excel] Config fields', { fields: Object.keys(config) })

    // Handle different Microsoft Excel action types
    switch (nodeType) {
      case "microsoft_excel_action_create_workbook":
      case "microsoft-excel_action_create_workbook":
        // Import and use the actual Excel create workbook handler
        const { createMicrosoftExcelWorkbook } = await import("@/lib/workflows/actions/microsoft-excel")
        const createWorkbookResult = await createMicrosoftExcelWorkbook(
          config,
          context.userId,
          context.data || {}
        )

        if (!createWorkbookResult.success) {
          throw new Error(createWorkbookResult.message || "Failed to create Excel workbook")
        }

        return createWorkbookResult.output

      case "microsoft_excel_action_create_row":
      case "microsoft-excel_action_create_row":
        // Import and use the actual Excel create row handler
        const { createMicrosoftExcelRow } = await import("@/lib/workflows/actions/microsoft-excel")
        const createRowResult = await createMicrosoftExcelRow(
          config,
          context.userId,
          context.data || {}
        )

        if (!createRowResult.success) {
          throw new Error(createRowResult.message || "Failed to create Excel row")
        }

        return createRowResult.output

      case "microsoft_excel_action_update_row":
      case "microsoft-excel_action_update_row":
        // Import and use the actual Excel update row handler
        const { updateMicrosoftExcelRow } = await import("@/lib/workflows/actions/microsoft-excel")
        const updateRowResult = await updateMicrosoftExcelRow(
          config,
          context.userId,
          context.data || {}
        )

        if (!updateRowResult.success) {
          throw new Error(updateRowResult.message || "Failed to update Excel row")
        }

        return updateRowResult.output

      case "microsoft_excel_action_delete_row":
      case "microsoft-excel_action_delete_row":
        // Import and use the actual Excel delete row handler
        const { deleteMicrosoftExcelRow } = await import("@/lib/workflows/actions/microsoft-excel")
        const deleteRowResult = await deleteMicrosoftExcelRow(
          config,
          context.userId,
          context.data || {}
        )

        if (!deleteRowResult.success) {
          throw new Error(deleteRowResult.message || "Failed to delete Excel row")
        }

        return deleteRowResult.output

      case "microsoft_excel_action_export_sheet":
      case "microsoft-excel_action_export_sheet":
        // Import and use the actual Excel export sheet handler
        const { exportMicrosoftExcelSheet } = await import("@/lib/workflows/actions/microsoft-excel")
        const exportSheetResult = await exportMicrosoftExcelSheet(
          config,
          context.userId,
          context.data || {}
        )

        if (!exportSheetResult.success) {
          throw new Error(exportSheetResult.message || "Failed to export Excel sheet")
        }

        return exportSheetResult.output

      case "microsoft_excel_action_manage_data":
      case "microsoft-excel_action_manage_data":
      case "microsoft_excel_unified_action":
      case "microsoft-excel_unified_action":
        // Use the unified action handler for manage data
        const { executeMicrosoftExcelUnifiedAction } = await import("@/lib/workflows/actions/microsoft-excel")
        const manageDataResult = await executeMicrosoftExcelUnifiedAction(
          config,
          context.userId,
          context.data || {}
        )

        if (!manageDataResult.success) {
          throw new Error(manageDataResult.message || "Failed to manage Excel data")
        }

        return manageDataResult.output

      default:
        throw new Error(`Unknown Microsoft Excel action type: ${nodeType}`)
    }
  }

}
