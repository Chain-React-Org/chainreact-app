import { ActionResult } from './index'
import { executeAIAgentAction } from './aiAgentAction'

// AI Data Processing actions
import {
  summarizeContent,
  extractInformation,
  analyzeSentiment,
  translateText,
  generateContent,
  classifyContent,
} from './aiDataProcessing'

// Gmail actions
import { sendGmailEmail } from './gmail/sendEmail'
import { applyGmailLabels } from './gmail/applyLabels'
import { searchGmailEmails } from './gmail'
import { advancedGmailSearch } from './gmail/advancedSearch'
import { fetchGmailTriggerEmail } from './gmail/fetchTriggerEmail'
import { markGmailAsRead } from './gmail/markAsRead'
import { markGmailAsUnread } from './gmail/markAsUnread'
import { archiveGmailEmail } from './gmail/archiveEmail'
import { deleteGmailEmail } from './gmail/deleteEmail'
import { removeGmailLabel } from './gmail/removeLabel'
import { createGmailDraft } from './gmail/createDraft'
import { createGmailDraftReply } from './gmail/createDraftReply'
import { createGmailLabel } from './gmail/createLabel'
import { replyToGmailEmail } from './gmail/replyToEmail'
import { getGmailAttachment } from './gmail/getAttachment'
import { downloadGmailAttachment } from './gmail/downloadAttachment'

// Google Sheets actions
import {
  exportGoogleSheetsData,
  createGoogleSheetsRow,
  updateGoogleSheetsRow,
  deleteGoogleSheetsRow,
  findGoogleSheetsRow,
  clearGoogleSheetsRange,
  formatGoogleSheetsRange,
  batchUpdateGoogleSheets,
  updateGoogleSheetsCell,
  getGoogleSheetsCellValue,
  createGoogleSpreadsheet
} from './googleSheets'

// Microsoft Excel actions
import {
  createMicrosoftExcelRow,
  updateMicrosoftExcelRow,
  deleteMicrosoftExcelRow,
  exportMicrosoftExcelSheet,
  createMicrosoftExcelWorkbook,
  addMicrosoftExcelTableRow,
  createMicrosoftExcelWorksheet,
  renameMicrosoftExcelWorksheet,
  deleteMicrosoftExcelWorksheet,
  addMicrosoftExcelMultipleRows
} from './microsoft-excel'

// Google Calendar actions
import { createGoogleCalendarEvent } from './google-calendar/createEvent'
import { updateGoogleCalendarEvent } from './google-calendar/updateEvent'
import { deleteGoogleCalendarEvent } from './google-calendar/deleteEvent'
import { getGoogleCalendarEvent } from './google-calendar/getEvent'
import { listGoogleCalendarEvents } from './google-calendar/listEvents'
import { quickAddGoogleCalendarEvent } from './google-calendar/quickAddEvent'
import { addGoogleCalendarAttendees } from './google-calendar/addAttendees'
import { removeGoogleCalendarAttendees } from './google-calendar/removeAttendees'
import { moveGoogleCalendarEvent } from './google-calendar/moveEvent'
import { getGoogleCalendarFreeBusy } from './google-calendar/getFreeBusy'

// Google Drive actions
import { uploadGoogleDriveFile } from './googleDrive/uploadFile'
import { getGoogleDriveFile } from './googleDrive/getFile'
import { shareGoogleDriveFile } from './googleDrive/shareFile'
import { copyGoogleDriveFile } from './googleDrive/copyFile'
import { moveGoogleDriveFile } from './googleDrive/moveFile'
import { deleteGoogleDriveFile } from './googleDrive/deleteFile'
import { createGoogleDriveFolder } from './googleDrive/createFolder'
import { searchGoogleDriveFiles } from './googleDrive/searchFiles'
import { listGoogleDriveFiles } from './googleDrive/listFiles'
import { getGoogleDriveFileMetadata } from './googleDrive/getFileMetadata'

// Google Docs actions
import {
  createGoogleDocument,
  updateGoogleDocument,
  shareGoogleDocument,
  getGoogleDocument,
  exportGoogleDocument
} from './googleDocs'

// Google Analytics actions
import {
  sendGoogleAnalyticsEvent,
  runGoogleAnalyticsReport,
  createGoogleAnalyticsMeasurementSecret,
  findGoogleAnalyticsConversion,
  createGoogleAnalyticsConversionEvent,
  runGoogleAnalyticsPivotReport
} from './google-analytics'

// Airtable actions
import {
  addAirtableAttachment,
  createAirtableRecord,
  createMultipleAirtableRecords,
  deleteAirtableRecord,
  duplicateAirtableRecord,
  findAirtableRecord,
  getAirtableBaseSchema,
  getAirtableRecord,
  getAirtableTableSchema,
  listAirtableRecords,
  updateAirtableRecord,
  updateMultipleAirtableRecords
} from './airtable'

// Monday.com actions
import {
  createMondayItem,
  updateMondayItem,
  createMondayUpdate,
  createMondaySubitem,
  deleteMondayItem,
  archiveMondayItem,
  moveMondayItem,
  createMondayBoard,
  createMondayGroup,
  getMondayItem,
  searchMondayItems,
  listMondayItems,
  addMondayFile,
  duplicateMondayItem,
  duplicateMondayBoard,
  addMondayColumn,
  listMondayUpdates,
  downloadMondayFile,
  getMondayUser,
  listMondayUsers,
  listMondayBoards,
  getMondayBoard,
  listMondayGroups,
  listMondaySubitems
} from './monday'

// Slack actions
import {
  createSlackChannel,
  slackActionSendMessage,
  slackActionDeleteMessage,
  slackActionAddReaction,
  slackActionAddReminder,
  slackActionInviteUsersToChannel,
  slackActionArchiveChannel,
  slackActionUnarchiveChannel,
  slackActionJoinChannel,
  slackActionLeaveChannel,
  slackActionRenameChannel,
  slackActionSetChannelTopic,
  slackActionSetChannelPurpose,
  slackActionGetChannelInfo,
  slackActionListChannels,
  slackActionRemoveUserFromChannel,
  slackActionGetUserInfo,
  slackActionListUsers,
  slackActionSendDirectMessage,
  slackActionUpdateMessage,
  slackActionRemoveReaction,
  slackActionPinMessage,
  slackActionUnpinMessage,
  slackActionScheduleMessage,
  slackActionCancelScheduledMessage,
  slackActionListScheduledMessages,
  slackActionGetThreadMessages,
  slackActionUploadFile,
  slackActionDownloadFile,
  slackActionGetFileInfo,
  slackActionPostInteractive,
  slackActionSetUserPresence,
  slackActionUpdateUserStatus
} from './slack'

// Trello actions
import {
  createTrelloList,
  createTrelloCard,
  moveTrelloCard,
  createTrelloBoard,
  updateTrelloCard,
  archiveTrelloCard,
  addTrelloComment,
  addTrelloLabelToCard,
  addTrelloChecklist,
  createTrelloChecklistItem
} from './trello'

// Discord actions
import {
  sendDiscordMessage,
  addDiscordRole,
  editDiscordMessage,
  fetchDiscordMessages,
  deleteDiscordMessage,
} from './discord'

// ManyChat actions
import {
  sendManyChatMessage,
  sendManyChatFlow,
  sendManyChatContent,
  sendManyChatDynamicMessage,
  setManyChatCustomField,
  getManyChatSubscriber,
  addManyChatTag,
  removeManyChatTag,
  subscribeManyChatSequence,
  unsubscribeManyChatSequence,
  findManyChatUser,
  findByManyChatCustomField,
  createManyChatSubscriber,
} from './manychat'

// Notion unified action handlers
import { executeNotionManageDatabase } from './notion/manageDatabase'
import { executeNotionManagePage } from './notion/managePage'
import { executeNotionManageUsers } from './notion/manageUsers'
import { executeNotionManageComments } from './notion/manageComments'
import { executeNotionAdvancedQuery } from './notion/advancedQuery'
import { executeNotionGetPageProperty } from './notion/getPageProperty'
import { executeNotionUpdateDatabaseSchema } from './notion/updateDatabaseSchema'

// Notion actions - comprehensive new handlers
import {
  notionCreatePage,
  notionUpdatePage,
  notionCreateDatabase,
  notionUpdateDatabase,
  notionDeleteBlock,
  notionRetrieveBlockChildren,
  notionListUsers,
  notionRetrieveUser,
  notionCreateComment,
  notionRetrieveComments,
  notionSearch,
  notionDuplicatePage,
  notionAddBlock,
  notionGetBlock,
  notionGetBlockChildren,
  notionGetPageWithChildren,
  notionFindOrCreateDatabaseItem,
  notionUpdateDatabaseItem,
  notionArchiveDatabaseItem,
  notionRestoreDatabaseItem,
  notionGetPageProperty,
  notionMakeApiCall
} from './notion/handlers'

// Notion get page details action
import { notionGetPageDetails } from './notion/getPageDetails'

// Notion separate page actions
import {
  executeNotionCreatePage,
  executeNotionUpdatePage,
  executeNotionAppendToPage,
  executeNotionGetPageDetailsAction,
  executeNotionDuplicatePageAction
} from './notion/pageActions'

// GitHub actions
import {
  createGitHubIssue,
  createGitHubRepository,
  createGitHubPullRequest,
  createGitHubBranch,
  createGitHubGist,
  addGitHubComment,
} from './github'

// Outlook actions
import {
  sendOutlookEmail,
  replyToOutlookEmail,
  forwardOutlookEmail,
  createOutlookDraftEmail,
  moveOutlookEmail,
  deleteOutlookEmail,
  addOutlookCategories,
  getOutlookEmails,
  createOutlookCalendarEvent,
  updateOutlookCalendarEvent,
  deleteOutlookCalendarEvent,
  addOutlookAttendees,
  getOutlookCalendarEvents,
  createOutlookContact,
  updateOutlookContact,
  deleteOutlookContact,
  findOutlookContact,
  downloadOutlookAttachment
} from './microsoft-outlook'

// HubSpot actions
import {
  createHubSpotContact,
  createHubSpotCompany,
  createHubSpotDeal,
  addContactToHubSpotList,
  updateHubSpotDeal,
  hubspotUpdateContact,
  hubspotUpdateCompany,
  hubspotCreateTicket,
  hubspotUpdateTicket,
  hubspotGetTickets,
  hubspotCreateNote,
  hubspotCreateTask,
  hubspotCreateCall,
  hubspotCreateMeeting,
  hubspotGetContacts,
  hubspotGetCompanies,
  hubspotGetDeals,
  // Phase 2 actions
  hubspotAddToWorkflow,
  hubspotRemoveFromWorkflow,
  hubspotCreateProduct,
  hubspotUpdateProduct,
  hubspotGetProducts,
  hubspotRemoveFromList,
  hubspotGetOwners,
  hubspotGetForms,
  hubspotGetDealPipelines,
  // Phase 3 actions
  hubspotCreateLineItem,
  hubspotUpdateLineItem,
  hubspotRemoveLineItem,
  hubspotGetLineItems,
} from './hubspot'

// Microsoft OneNote actions
// NOTE: deleteSection and deleteNotebook are NOT supported by Microsoft Graph API
import {
  onenoteCreatePage,
  onenoteCreateNotebook,
  onenoteCreateSection,
  onenoteUpdatePage,
  onenoteGetPageContent,
  onenoteGetPages,
  onenoteCopyPage,
  onenoteDeletePage,
  onenoteListNotebooks,
  onenoteListSections,
  onenoteGetNotebookDetails,
  onenoteGetSectionDetails,
} from './microsoft-onenote'

// OneDrive actions
import { uploadFileToOneDrive } from './onedrive'
import { createOnedriveFolder } from './onedrive/createFolder'
import { deleteOnedriveItem } from './onedrive/deleteItem'
import { copyOnedriveItem } from './onedrive/copyItem'
import { moveOnedriveItem } from './onedrive/moveItem'
import { renameOnedriveItem } from './onedrive/renameItem'
import { createOnedriveSharingLink } from './onedrive/createSharingLink'
import { sendOnedriveSharingInvitation } from './onedrive/sendSharingInvitation'
import { searchOnedriveFiles } from './onedrive/searchFiles'
import { findOnedriveItemById } from './onedrive/findItemById'
import { listOnedriveDrives } from './onedrive/listDrives'

// Microsoft Teams actions
import {
  sendTeamsMessage,
  replyToTeamsMessage,
  editTeamsMessage,
  findTeamsMessage,
  deleteTeamsMessage,
  sendTeamsChatMessage,
  createTeamsGroupChat,
  getTeamsChannelDetails,
  sendTeamsAdaptiveCard,
  addTeamsReaction,
  removeTeamsReaction,
  scheduleTeamsMeeting,
  endTeamsMeeting,
  updateTeamsMeeting,
  createTeamsChannel,
  addTeamsMemberToTeam,
  getTeamsTeamMembers,
  createTeamsTeam
} from './teams'

// Facebook actions
import {
  createFacebookPost,
  getFacebookPageInsights,
  sendFacebookMessage,
  commentOnFacebookPost,
  deleteFacebookPost,
  updateFacebookPost,
  uploadFacebookPhoto,
  uploadFacebookVideo,
} from './facebook'

// Twitter actions - now imported from the new module
import {
  postTweetHandler,
  replyTweetHandler,
  retweetHandler,
  unretweetHandler,
  likeTweetHandler,
  unlikeTweetHandler,
  sendDMHandler,
  followUserHandler,
  unfollowUserHandler,
  searchTweetsHandler,
  getUserTimelineHandler,
  getMentionsHandler
} from './twitter/handlers'

// Dropbox actions
import { uploadDropboxFile, findDropboxFiles } from './dropbox'

// Shopify actions
import { createShopifyOrder } from './shopify/createOrder'
import { createShopifyProduct } from './shopify/createProduct'
import { updateShopifyProduct } from './shopify/updateProduct'
import { createShopifyCustomer } from './shopify/createCustomer'
import { updateShopifyCustomer } from './shopify/updateCustomer'
import { updateShopifyInventory } from './shopify/updateInventory'
import { updateShopifyOrderStatus } from './shopify/updateOrderStatus'
import { addShopifyOrderNote } from './shopify/addOrderNote'
import { createShopifyFulfillment } from './shopify/createFulfillment'
import { createShopifyProductVariant } from './shopify/createProductVariant'
import { updateShopifyProductVariant } from './shopify/updateProductVariant'

// Gumroad actions
import {
  getGumroadProduct,
  listGumroadProducts,
  enableGumroadProduct,
  disableGumroadProduct,
  deleteGumroadProduct,
  createGumroadVariantCategory,
  createGumroadOfferCode,
  getGumroadSalesAnalytics,
  listGumroadSales,
  markGumroadAsShipped,
  refundGumroadSale,
  getGumroadSubscriber,
  listGumroadSubscribers,
  resendGumroadReceipt,
  verifyGumroadLicense,
  enableGumroadLicense,
  disableGumroadLicense,
} from './gumroad'

// Utility actions
import {
  formatTransformer,
  executeExtractWebsiteData,
  executeTavilySearch,
  executeParseFile
} from './utility'

// Workflow control actions
import {
  executeIfThenCondition,
  executeWaitForTime
} from './core'
import { executeWaitForEvent } from './automation/waitForEvent'

// Logic control actions
import { executeRouter } from './logic/executeRouter'
import { executeHttpRequest } from './logic/executeHttpRequest'
import { executeLoop } from './logic/loop'

// HITL (Human-in-the-Loop) action
import { executeHITL } from './hitl'

// Generic actions
import {
  executeDelayAction,
  executeGenericAction
} from './generic'

// AI Agent action
import { executeAIAgent } from '../aiAgent'

// New "Get" actions with ExecutionContext pattern
import { getTrelloCards } from './trello/getCards'
import { getSlackMessages } from './slack/getMessages'
import { getOnedriveFile } from './onedrive/getFile'
import { getDropboxFile } from './dropbox/getFile'
// HubSpot Get actions now imported from index.ts above
import { mailchimpGetSubscribers } from './mailchimp/getSubscribers'
import { mailchimpAddSubscriber } from './mailchimp/addSubscriber'
import { mailchimpUpdateSubscriber } from './mailchimp/updateSubscriber'
import { mailchimpRemoveSubscriber } from './mailchimp/removeSubscriber'
import { mailchimpAddTag } from './mailchimp/addTag'
import { mailchimpRemoveTag } from './mailchimp/removeTag'
import { mailchimpSendCampaign } from './mailchimp/sendCampaign'
import { mailchimpCreateCampaign } from './mailchimp/createCampaign'
import { mailchimpCreateAudience } from './mailchimp/createAudience'
import { mailchimpCreateEvent } from './mailchimp/createEvent'
import { mailchimpAddNote } from './mailchimp/addNote'
import { mailchimpGetSubscriber } from './mailchimp/getSubscriber'
import { mailchimpGetCampaign } from './mailchimp/getCampaign'
import { mailchimpGetCampaignStats } from './mailchimp/getCampaignStats'
import { mailchimpScheduleCampaign } from './mailchimp/scheduleCampaign'
import { mailchimpUnsubscribeSubscriber } from './mailchimp/unsubscribeSubscriber'
import { mailchimpCreateSegment } from './mailchimp/createSegment'
import { stripeGetPayments } from './stripe/getPayments'
import { stripeCreateCustomer } from './stripe/createCustomer'
import { stripeUpdateCustomer } from './stripe/updateCustomer'
import { stripeCreatePaymentIntent } from './stripe/createPaymentIntent'
import { stripeCreateInvoice } from './stripe/createInvoice'
import { stripeCreateSubscription } from './stripe/createSubscription'
import { stripeCreateRefund } from './stripe/createRefund'
import { stripeCancelSubscription } from './stripe/cancelSubscription'
import { stripeUpdateSubscription } from './stripe/updateSubscription'
import { stripeCreateCheckoutSession } from './stripe/createCheckoutSession'
import { stripeCreatePaymentLink } from './stripe/createPaymentLink'
import { stripeFindCustomer } from './stripe/findCustomer'
import { stripeFindSubscription } from './stripe/findSubscription'
import { stripeFindPaymentIntent } from './stripe/findPaymentIntent'
import { handleStripeTriggerEvent } from './stripe/handleTriggerEvent'

// Import resolveValue for wrapper functions
import { resolveValue as resolveValueCore } from './core/resolveValue'

import { logger } from '@/lib/utils/logger'

/**
 * Helper to create ExecutionContext wrapper for actions using that pattern
 */
function createExecutionContextWrapper(handler: Function) {
  return async (params: {
    config: any
    userId: string
    input: Record<string, any>
    meta?: import('./core/idempotencyKey').HandlerExecutionMeta
  }): Promise<ActionResult> => {
    // Import getIntegrationById helper (from separate file to avoid circular dependency)
    const { getIntegrationById } = await import('../integrationHelpers')

    // PR-C4 — thread the engine-supplied execution metadata onto the
    // synthesized context so context-style handlers (Stripe et al) can
    // build their idempotency key without an extra param.
    const executionSessionId =
      params.meta?.executionSessionId ?? params.input?.executionId ?? params.input?.sessionId
    const nodeId = params.meta?.nodeId ?? params.input?.nodeId
    const actionType = params.meta?.actionType ?? params.input?.actionType

    // Create a mock ExecutionContext with a dataFlowManager that uses resolveValue
    const context = {
      config: params.config,
      userId: params.userId,
      workflowId: params.input?.workflowId || 'unknown',
      executionId: executionSessionId,
      executionSessionId,
      nodeId,
      actionType,
      meta: params.meta,
      testMode: params.input?.testMode || false,
      dataFlowManager: {
        resolveVariable: (value: any) => resolveValueCore(value, params.input)
      },
      getIntegration: async (provider: string) => {
        // Check if integrationId is provided in input or config
        const integrationId = params.input?.integrationId || params.config?.integrationId
        if (integrationId) {
          logger.info(`[Registry] Looking up integration by ID: ${integrationId} for user: ${params.userId}`)
          try {
            const integration = await getIntegrationById(integrationId, { userId: params.userId })
            logger.info(`[Registry] Found integration: ${integration?.provider}, status: ${integration?.status}`)
            return integration
          } catch (error: any) {
            logger.error(`[Registry] Failed to get integration by ID ${integrationId}:`, error)
            throw error // Re-throw instead of returning null to preserve the error message
          }
        }

        // Otherwise, look up by provider and userId
        const { createClient } = await import('@/utils/supabaseClient')
        const supabase = createClient()
        const { data, error } = await supabase
          .from('integrations')
          .select('*')
          .eq('user_id', params.userId)
          .eq('provider', provider)
          .eq('status', 'connected')
          .single()

        if (error || !data) return null
        return data
      }
    }

    try {
      // Call handler - detect signature based on handler.length (number of expected parameters)
      // If handler expects 1 param: (context) where context.config has the config
      // If handler expects 2 params: (config, context) as separate arguments
      const result = handler.length === 1
        ? await handler(context)
        : await handler(params.config, context)

      // If the handler already returns an ActionResult format, use it
      if (result && typeof result === 'object' && 'success' in result) {
        return result
      }

      // Otherwise, wrap the result in ActionResult format
      return {
        success: true,
        output: result,
        message: 'Action executed successfully'
      }
    } catch (error: any) {
      logger.error('Action execution error:', error)
      return {
        success: false,
        output: {},
        message: error.message || 'Action execution failed'
      }
    }
  }
}

/**
 * Unified AI Agent Wrapper
 * Handles message generation, routing, and hybrid modes
 */
async function executeAIAgentWrapper(params: { config: any; userId: string; input: Record<string, any>; context?: any }): Promise<ActionResult> {
  const { config, userId, input, context } = params

  try {
    const workflowId = input.workflowId || input.workflow?.id || 'unknown'
    const executionId = input.executionId || input.sessionId || 'unknown'

    const executionContext: any = context || {
      userId,
      workflowId,
      executionId,
      testMode: false,
      data: input,
      variables: {},
      results: {}
    }

    const result = await executeAIAgentAction(config, input, executionContext)

    return {
      success: result.success,
      data: result.data || {},
      output: result.data || {},
      nextNodeId: result.nextNodeId,
      message: result.success ? 'AI Agent completed successfully' : 'AI Agent failed'
    }
  } catch (error: any) {
    logger.error('AI Agent execution error:', error)
    return {
      success: false,
      output: {},
      data: {},
      message: error?.message || 'AI Agent execution failed',
      error: error?.message || 'AI Agent execution failed'
    }
  }
}

/**
 * Central registry of all action handlers
 */
export const actionHandlerRegistry: Record<string, Function> = {
  // Unified AI Agent (replaces ai_router and ai_message)
  "ai_agent": executeAIAgentWrapper,

  // AI Data Processing actions - wrapped to handle new calling convention

  // AI node schema aliases — schema types use ai_* but handlers are registered as ai_action_*
  "ai_prompt": (params: { config: any; userId: string; input: Record<string, any> }) =>
    generateContent(params.config, params.userId, params.input),
  "ai_summarize": (params: { config: any; userId: string; input: Record<string, any> }) =>
    summarizeContent(params.config, params.userId, params.input),
  "ai_extract": (params: { config: any; userId: string; input: Record<string, any> }) =>
    extractInformation(params.config, params.userId, params.input),
  "ai_classify": (params: { config: any; userId: string; input: Record<string, any> }) =>
    classifyContent(params.config, params.userId, params.input),
  "ai_sentiment": (params: { config: any; userId: string; input: Record<string, any> }) =>
    analyzeSentiment(params.config, params.userId, params.input),
  "ai_translate": (params: { config: any; userId: string; input: Record<string, any> }) =>
    translateText(params.config, params.userId, params.input),
  "ai_generate": (params: { config: any; userId: string; input: Record<string, any> }) =>
    generateContent(params.config, params.userId, params.input),
  
  // Gmail actions - mixed signatures (sendGmailEmail already uses params)
  "gmail_action_send_email": sendGmailEmail,
  "gmail_action_add_label": (params: { config: any; userId: string; input: Record<string, any> }) =>
    applyGmailLabels(params.config, params.userId, params.input),
  "gmail_action_search_email": (params: { config: any; userId: string; input: Record<string, any> }) =>
    searchGmailEmails(params.config, params.userId, params.input),
  "gmail_action_advanced_search": (params: { config: any; userId: string; input: Record<string, any> }) =>
    advancedGmailSearch(params.config, params.userId, params.input),
  "gmail_action_mark_as_read": (params: { config: any; userId: string; input: Record<string, any> }) =>
    markGmailAsRead(params.config, params.userId, params.input),
  "gmail_action_mark_as_unread": (params: { config: any; userId: string; input: Record<string, any> }) =>
    markGmailAsUnread(params.config, params.userId, params.input),
  "gmail_action_archive_email": (params: { config: any; userId: string; input: Record<string, any> }) =>
    archiveGmailEmail(params.config, params.userId, params.input),
  "gmail_action_delete_email": (params: { config: any; userId: string; input: Record<string, any> }) =>
    deleteGmailEmail(params.config, params.userId, params.input),
  "gmail_action_remove_label": (params: { config: any; userId: string; input: Record<string, any> }) =>
    removeGmailLabel(params.config, params.userId, params.input),
  "gmail_action_create_draft": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createGmailDraft(params.config, params.userId, params.input),
  "gmail_action_create_draft_reply": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createGmailDraftReply(params.config, params.userId, params.input),
  "gmail_action_create_label": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createGmailLabel(params.config, params.userId, params.input),
  "gmail_action_reply_to_email": (params: { config: any; userId: string; input: Record<string, any> }) =>
    replyToGmailEmail(params.config, params.userId, params.input),
  "gmail_action_get_attachment": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getGmailAttachment(params.config, params.userId, params.input),
  "gmail_action_download_attachment": (params: { config: any; userId: string; input: Record<string, any> }) =>
    downloadGmailAttachment(params.config, params.userId, params.input),

  // Gmail trigger handler - fetches real email data for testing
  "gmail_trigger_new_email": (params: { config: any; userId: string; input: Record<string, any> }) =>
    fetchGmailTriggerEmail(params.config, params.userId, params.input),
  
  // Google Sheets actions - wrapped to handle new calling convention
  "google_sheets_action_append_row": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createGoogleSheetsRow(params.config, params.userId, params.input),
  "google_sheets_action_update_row": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateGoogleSheetsRow(params.config, params.userId, params.input),
  "google_sheets_action_delete_row": (params: { config: any; userId: string; input: Record<string, any> }) =>
    deleteGoogleSheetsRow(params.config, params.userId, params.input),
  "google_sheets_action_clear_range": (params: { config: any; userId: string; input: Record<string, any> }) =>
    clearGoogleSheetsRange(params.config, params.userId, params.input),
  "google_sheets_action_format_range": (params: { config: any; userId: string; input: Record<string, any> }) =>
    formatGoogleSheetsRange(params.config, params.userId, params.input),
  "google_sheets_action_batch_update": (params: { config: any; userId: string; input: Record<string, any> }) =>
    batchUpdateGoogleSheets(params.config, params.userId, params.input),
  "google_sheets_action_find_row": (params: { config: any; userId: string; input: Record<string, any> }) =>
    findGoogleSheetsRow(params.config, params.userId, params.input),
  "google-sheets_action_export_sheet": (params: { config: any; userId: string; input: Record<string, any> }) =>
    exportGoogleSheetsData(params.config, params.userId, params.input),
  "google_sheets_action_update_cell": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateGoogleSheetsCell(params.config, params.userId, params.input),
  "google_sheets_action_get_cell_value": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getGoogleSheetsCellValue(params.config, params.userId, params.input),
  "google_sheets_action_create_spreadsheet": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createGoogleSpreadsheet(params.config, params.userId, params.input),

  // Microsoft Excel actions - wrapped to handle new calling convention
  "microsoft_excel_action_add_row": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createMicrosoftExcelRow(params.config, params.userId, params.input),
  "microsoft_excel_action_update_row": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateMicrosoftExcelRow(params.config, params.userId, params.input),
  "microsoft_excel_action_delete_row": (params: { config: any; userId: string; input: Record<string, any> }) =>
    deleteMicrosoftExcelRow(params.config, params.userId, params.input),
  "microsoft-excel_action_export_sheet": (params: { config: any; userId: string; input: Record<string, any> }) =>
    exportMicrosoftExcelSheet(params.config, params.userId, params.input),
  "microsoft_excel_action_create_workbook": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createMicrosoftExcelWorkbook(params.config, params.userId, params.input),
  "microsoft_excel_action_add_table_row": (params: { config: any; userId: string; input: Record<string, any> }) =>
    addMicrosoftExcelTableRow(params.config, { userId: params.userId }),
  "microsoft_excel_action_create_worksheet": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createMicrosoftExcelWorksheet(params.config, { userId: params.userId }),
  "microsoft_excel_action_rename_worksheet": (params: { config: any; userId: string; input: Record<string, any> }) =>
    renameMicrosoftExcelWorksheet(params.config, { userId: params.userId }),
  "microsoft_excel_action_delete_worksheet": (params: { config: any; userId: string; input: Record<string, any> }) =>
    deleteMicrosoftExcelWorksheet(params.config, { userId: params.userId }),
  "microsoft_excel_action_add_multiple_rows": (params: { config: any; userId: string; input: Record<string, any> }) =>
    addMicrosoftExcelMultipleRows(params.config, params.userId, params.input),

  // Google Calendar actions - wrapped to handle new calling convention
  "google_calendar_action_create_event": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createGoogleCalendarEvent(params.config, params.userId, params.input),
  "google_calendar_action_update_event": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateGoogleCalendarEvent(params.config, params.userId, params.input),
  "google_calendar_action_delete_event": (params: { config: any; userId: string; input: Record<string, any> }) =>
    deleteGoogleCalendarEvent(params.config, params.userId, params.input),
  "google_calendar_action_get_event": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getGoogleCalendarEvent(params.config, params.userId, params.input),
  "google_calendar_action_list_events": (params: { config: any; userId: string; input: Record<string, any> }) =>
    listGoogleCalendarEvents(params.config, params.userId, params.input),
  "google_calendar_action_quick_add_event": (params: { config: any; userId: string; input: Record<string, any> }) =>
    quickAddGoogleCalendarEvent(params.config, params.userId, params.input),
  "google_calendar_action_add_attendees": (params: { config: any; userId: string; input: Record<string, any> }) =>
    addGoogleCalendarAttendees(params.config, params.userId, params.input),
  "google_calendar_action_remove_attendees": (params: { config: any; userId: string; input: Record<string, any> }) =>
    removeGoogleCalendarAttendees(params.config, params.userId, params.input),
  "google_calendar_action_move_event": (params: { config: any; userId: string; input: Record<string, any> }) =>
    moveGoogleCalendarEvent(params.config, params.userId, params.input),
  "google_calendar_action_get_free_busy": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getGoogleCalendarFreeBusy(params.config, params.userId, params.input),

  // Google Drive actions - wrapped to handle new calling convention

  // Google Drive actions - new colon-style IDs (match node schema types)
  "google-drive:create_file": (params: { config: any; userId: string; input: Record<string, any> }) =>
    uploadGoogleDriveFile(params.config, params.userId, params.input),
  "google-drive:get_file": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getGoogleDriveFile(params.config, params.userId, params.input),
  "google-drive:share_file": (params: { config: any; userId: string; input: Record<string, any> }) =>
    shareGoogleDriveFile(params.config, params.userId, params.input),
  "google-drive:copy_file": (params: { config: any; userId: string; input: Record<string, any> }) =>
    copyGoogleDriveFile(params.config, params.userId, params.input),
  "google-drive:move_file": (params: { config: any; userId: string; input: Record<string, any> }) =>
    moveGoogleDriveFile(params.config, params.userId, params.input),
  "google-drive:delete_file": (params: { config: any; userId: string; input: Record<string, any> }) =>
    deleteGoogleDriveFile(params.config, params.userId, params.input),
  "google-drive:create_folder": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createGoogleDriveFolder(params.config, params.userId, params.input),
  "google-drive:search_files": (params: { config: any; userId: string; input: Record<string, any> }) =>
    searchGoogleDriveFiles(params.config, params.userId, params.input),
  "google-drive:list_files": (params: { config: any; userId: string; input: Record<string, any> }) =>
    listGoogleDriveFiles(params.config, params.userId, params.input),
  "google-drive:get_file_metadata": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getGoogleDriveFileMetadata(params.config, params.userId, params.input),

  // Google Docs actions - wrapped to handle new calling convention
  "google_docs_action_create_document": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createGoogleDocument(params.config, params.userId, params.input),
  "google_docs_action_update_document": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateGoogleDocument(params.config, params.userId, params.input),
  "google_docs_action_share_document": (params: { config: any; userId: string; input: Record<string, any> }) =>
    shareGoogleDocument(params.config, params.userId, params.input),
  "google_docs_action_get_document": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getGoogleDocument(params.config, params.userId, params.input),
  "google_docs_action_export_document": (params: { config: any; userId: string; input: Record<string, any> }) =>
    exportGoogleDocument(params.config, params.userId, params.input),

  // Google Analytics actions - wrapped with ExecutionContext pattern
  "google_analytics_action_send_event": createExecutionContextWrapper(sendGoogleAnalyticsEvent),
  "google_analytics_action_run_report": createExecutionContextWrapper(runGoogleAnalyticsReport),
  "google_analytics_action_create_measurement_secret": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createGoogleAnalyticsMeasurementSecret(params.config, params.userId, params.input),
  "google_analytics_action_find_conversion": (params: { config: any; userId: string; input: Record<string, any> }) =>
    findGoogleAnalyticsConversion(params.config, params.userId, params.input),
  "google_analytics_action_create_conversion_event": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createGoogleAnalyticsConversionEvent(params.config, params.userId, params.input),
  "google_analytics_action_run_pivot_report": createExecutionContextWrapper(runGoogleAnalyticsPivotReport),

  // Airtable actions - wrapped to handle new calling convention
  "airtable_action_create_record": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createAirtableRecord(params.config, params.userId, params.input),
  "airtable_action_update_record": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateAirtableRecord(params.config, params.userId, params.input),
  "airtable_action_list_records": (params: { config: any; userId: string; input: Record<string, any> }) =>
    listAirtableRecords(params.config, params.userId, params.input),
  "airtable_action_find_record": (params: { config: any; userId: string; input: Record<string, any> }) =>
    findAirtableRecord(params.config, params.userId, params.input),
  "airtable_action_delete_record": (params: { config: any; userId: string; input: Record<string, any> }) =>
    deleteAirtableRecord(params.config, params.userId, params.input),
  "airtable_action_add_attachment": (params: { config: any; userId: string; input: Record<string, any> }) =>
    addAirtableAttachment(params.config, params.userId, params.input),
  "airtable_action_duplicate_record": (params: { config: any; userId: string; input: Record<string, any> }) =>
    duplicateAirtableRecord(params.config, params.userId, params.input),
  "airtable_action_get_table_schema": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getAirtableTableSchema(params.config, params.userId, params.input),
  "airtable_action_get_base_schema": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getAirtableBaseSchema(params.config, params.userId, params.input),
  "airtable_action_get_record": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getAirtableRecord(params.config, params.userId, params.input),
  "airtable_action_create_multiple_records": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createMultipleAirtableRecords(params.config, params.userId, params.input),
  "airtable_action_update_multiple_records": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateMultipleAirtableRecords(params.config, params.userId, params.input),

  // Monday.com actions - wrapped to handle new calling convention
  // CRUD Operations
  "monday_action_create_item": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createMondayItem(params.config, params.userId, params.input),
  "monday_action_update_item": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateMondayItem(params.config, params.userId, params.input),
  "monday_action_create_update": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createMondayUpdate(params.config, params.userId, params.input),
  "monday_action_create_subitem": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createMondaySubitem(params.config, params.userId, params.input),
  "monday_action_delete_item": (params: { config: any; userId: string; input: Record<string, any> }) =>
    deleteMondayItem(params.config, params.userId, params.input),
  "monday_action_archive_item": (params: { config: any; userId: string; input: Record<string, any> }) =>
    archiveMondayItem(params.config, params.userId, params.input),
  "monday_action_move_item": (params: { config: any; userId: string; input: Record<string, any> }) =>
    moveMondayItem(params.config, params.userId, params.input),
  "monday_action_duplicate_item": (params: { config: any; userId: string; input: Record<string, any> }) =>
    duplicateMondayItem(params.config, params.userId, params.input),

  // Board & Group Management
  "monday_action_create_board": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createMondayBoard(params.config, params.userId, params.input),
  "monday_action_create_group": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createMondayGroup(params.config, params.userId, params.input),
  "monday_action_duplicate_board": (params: { config: any; userId: string; input: Record<string, any> }) =>
    duplicateMondayBoard(params.config, params.userId, params.input),
  "monday_action_add_column": (params: { config: any; userId: string; input: Record<string, any> }) =>
    addMondayColumn(params.config, params.userId, params.input),

  // Search & Retrieval
  "monday_action_get_item": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getMondayItem(params.config, params.userId, params.input),
  "monday_action_search_items": (params: { config: any; userId: string; input: Record<string, any> }) =>
    searchMondayItems(params.config, params.userId, params.input),
  "monday_action_list_items": (params: { config: any; userId: string; input: Record<string, any> }) =>
    listMondayItems(params.config, params.userId, params.input),
  "monday_action_list_subitems": (params: { config: any; userId: string; input: Record<string, any> }) =>
    listMondaySubitems(params.config, params.userId, params.input),
  "monday_action_list_updates": (params: { config: any; userId: string; input: Record<string, any> }) =>
    listMondayUpdates(params.config, params.userId, params.input),
  "monday_action_get_board": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getMondayBoard(params.config, params.userId, params.input),
  "monday_action_list_boards": (params: { config: any; userId: string; input: Record<string, any> }) =>
    listMondayBoards(params.config, params.userId, params.input),
  "monday_action_list_groups": (params: { config: any; userId: string; input: Record<string, any> }) =>
    listMondayGroups(params.config, params.userId, params.input),
  "monday_action_get_user": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getMondayUser(params.config, params.userId, params.input),
  "monday_action_list_users": (params: { config: any; userId: string; input: Record<string, any> }) =>
    listMondayUsers(params.config, params.userId, params.input),

  // File Operations
  "monday_action_add_file": (params: { config: any; userId: string; input: Record<string, any> }) =>
    addMondayFile(params.config, params.userId, params.input),
  "monday_action_download_file": (params: { config: any; userId: string; input: Record<string, any> }) =>
    downloadMondayFile(params.config, params.userId, params.input),

  // Slack actions - wrapped to handle new calling convention
  "slack_action_create_channel": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createSlackChannel(params.config, params.userId, params.input),
  "slack_action_send_message": (params: { config: any; userId: string; input: Record<string, any> }) =>
    slackActionSendMessage(params.config, params.userId, params.input),
  "slack_action_delete_message": slackActionDeleteMessage,
  "slack_action_add_reaction": slackActionAddReaction,
  "slack_action_add_reminder": slackActionAddReminder,
  "slack_action_invite_users_to_channel": slackActionInviteUsersToChannel,
  "slack_action_archive_channel": slackActionArchiveChannel,
  "slack_action_unarchive_channel": slackActionUnarchiveChannel,
  "slack_action_join_channel": slackActionJoinChannel,
  "slack_action_leave_channel": slackActionLeaveChannel,
  "slack_action_rename_channel": slackActionRenameChannel,
  "slack_action_set_channel_topic": slackActionSetChannelTopic,
  "slack_action_set_channel_purpose": slackActionSetChannelPurpose,
  "slack_action_get_channel_info": slackActionGetChannelInfo,
  "slack_action_list_channels": slackActionListChannels,
  "slack_action_remove_user_from_channel": slackActionRemoveUserFromChannel,
  "slack_action_get_user_info": slackActionGetUserInfo,
  "slack_action_list_users": slackActionListUsers,
  "slack_action_send_direct_message": slackActionSendDirectMessage,
  "slack_action_update_message": slackActionUpdateMessage,
  "slack_action_remove_reaction": slackActionRemoveReaction,
  "slack_action_pin_message": slackActionPinMessage,
  "slack_action_unpin_message": slackActionUnpinMessage,
  "slack_action_schedule_message": slackActionScheduleMessage,
  "slack_action_cancel_scheduled_message": slackActionCancelScheduledMessage,
  "slack_action_list_scheduled_messages": slackActionListScheduledMessages,
  "slack_action_get_thread_messages": slackActionGetThreadMessages,
  "slack_action_upload_file": slackActionUploadFile,
  "slack_action_download_file": slackActionDownloadFile,
  "slack_action_get_file_info": slackActionGetFileInfo,
  "slack_action_post_interactive": slackActionPostInteractive,
  "slack_action_set_user_presence": slackActionSetUserPresence,
  "slack_action_update_user_status": slackActionUpdateUserStatus,

  // Trello actions - wrapped to handle new calling convention
  "trello_action_create_list": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createTrelloList(params.config, params.userId, params.input),
  "trello_action_create_card": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createTrelloCard(params.config, params.userId, params.input),
  "trello_action_move_card": (params: { config: any; userId: string; input: Record<string, any> }) =>
    moveTrelloCard(params.config, params.userId, params.input),
  "trello_action_create_board": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createTrelloBoard(params.config, params.userId, params.input),
  "trello_action_update_card": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateTrelloCard(params.config, params.userId, params.input),
  "trello_action_archive_card": (params: { config: any; userId: string; input: Record<string, any> }) =>
    archiveTrelloCard(params.config, params.userId, params.input),
  "trello_action_add_comment": (params: { config: any; userId: string; input: Record<string, any> }) =>
    addTrelloComment(params.config, params.userId, params.input),
  "trello_action_add_label_to_card": (params: { config: any; userId: string; input: Record<string, any> }) =>
    addTrelloLabelToCard(params.config, params.userId, params.input),
  "trello_action_add_checklist": (params: { config: any; userId: string; input: Record<string, any> }) =>
    addTrelloChecklist(params.config, params.userId, params.input),
  "trello_action_create_checklist_item": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createTrelloChecklistItem(params.config, params.userId, params.input),

  // Discord actions - wrapped to handle new calling convention
  "discord_action_send_message": (params: { config: any; userId: string; input: Record<string, any> }) =>
    sendDiscordMessage(params.config, params.userId, params.input),
  "discord_action_edit_message": (params: { config: any; userId: string; input: Record<string, any> }) =>
    editDiscordMessage(params.config, params.userId, params.input),
  "discord_action_fetch_messages": (params: { config: any; userId: string; input: Record<string, any> }) =>
    fetchDiscordMessages(params.config, params.userId, params.input),
  "discord_action_delete_message": (params: { config: any; userId: string; input: Record<string, any> }) =>
    deleteDiscordMessage(params.config, params.userId, params.input),
  "discord_action_assign_role": (params: { config: any; userId: string; input: Record<string, any> }) =>
    addDiscordRole(params.config, params.userId, params.input),

  // ManyChat actions - wrapped to handle new calling convention
  "manychat_action_send_message": (params: { config: any; userId: string; input: Record<string, any> }) =>
    sendManyChatMessage(params.config, params.userId, params.input),
  "manychat_action_send_flow": (params: { config: any; userId: string; input: Record<string, any> }) =>
    sendManyChatFlow(params.config, params.userId, params.input),
  "manychat_action_set_custom_field": (params: { config: any; userId: string; input: Record<string, any> }) =>
    setManyChatCustomField(params.config, params.userId, params.input),
  "manychat_action_get_subscriber": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getManyChatSubscriber(params.config, params.userId, params.input),
  "manychat_action_tag_subscriber": (params: { config: any; userId: string; input: Record<string, any> }) =>
    addManyChatTag(params.config, params.userId, params.input),
  "manychat_action_remove_tag": (params: { config: any; userId: string; input: Record<string, any> }) =>
    removeManyChatTag(params.config, params.userId, params.input),
  "manychat_action_subscribe_sequence": (params: { config: any; userId: string; input: Record<string, any> }) =>
    subscribeManyChatSequence(params.config, params.userId, params.input),
  "manychat_action_unsubscribe_sequence": (params: { config: any; userId: string; input: Record<string, any> }) =>
    unsubscribeManyChatSequence(params.config, params.userId, params.input),
  "manychat_action_find_user": (params: { config: any; userId: string; input: Record<string, any> }) =>
    findManyChatUser(params.config, params.userId, params.input),
  "manychat_action_find_by_custom_field": (params: { config: any; userId: string; input: Record<string, any> }) =>
    findByManyChatCustomField(params.config, params.userId, params.input),
  "manychat_action_create_subscriber": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createManyChatSubscriber(params.config, params.userId, params.input),
  "manychat_action_send_content": (params: { config: any; userId: string; input: Record<string, any> }) =>
    sendManyChatContent(params.config, params.userId, params.input),
  "manychat_action_send_dynamic_message": (params: { config: any; userId: string; input: Record<string, any> }) =>
    sendManyChatDynamicMessage(params.config, params.userId, params.input),

  // Notion actions - search kept for backward compatibility

  // Notion separate page actions - each operation is now its own action
  "notion_action_create_page": (params: { config: any; userId: string; input: Record<string, any> }) =>
    executeNotionCreatePage(params.config, params.userId, params.input),
  "notion_action_update_page": (params: { config: any; userId: string; input: Record<string, any> }) =>
    executeNotionUpdatePage(params.config, params.userId, params.input),
  "notion_action_append_to_page": (params: { config: any; userId: string; input: Record<string, any> }) =>
    executeNotionAppendToPage(params.config, params.userId, params.input),

  // Notion unified actions (primary handlers) - wrapped to handle new calling convention
  // DEPRECATED: notion_action_manage_page - replaced by separate actions above
  "notion_action_advanced_query": (params: { config: any; userId: string; input: Record<string, any> }) =>
    executeNotionAdvancedQuery(params.config, params.userId, params.input),
  "notion_action_get_page_property": (params: { config: any; userId: string; input: Record<string, any> }) =>
    executeNotionGetPageProperty(params.config, params.userId, params.input),
  "notion_action_update_database_schema": (params: { config: any; userId: string; input: Record<string, any> }) =>
    executeNotionUpdateDatabaseSchema(params.config, params.userId, params.input),

  // Notion actions - comprehensive API v2 actions - wrapped with ExecutionContext pattern
  // Note: All handlers in handlers.ts expect (config, context: ExecutionContext)
  // "notion_action_retrieve_page": Removed - using notion_action_get_page_details instead
  // "notion_action_archive_page": Removed - use notion_action_archive_database_item instead
  "notion_action_list_users": createExecutionContextWrapper(notionListUsers),
  "notion_action_create_comment": createExecutionContextWrapper((config: any, context: any) =>
    notionCreateComment({
      ...config,
      // Map UI field names to handler expected fields
      page_id: config.page || config.page_id,
      rich_text: config.commentText || config.rich_text,
      parent_type: config.commentTarget || config.parent_type || 'page',
      discussion_id: config.discussionId || config.discussion_id,
    }, context)),
  "notion_action_search": createExecutionContextWrapper(notionSearch),
  "notion_action_duplicate_page": (params: { config: any; userId: string; input: Record<string, any> }) =>
    executeNotionDuplicatePageAction(params.config, params.userId, params.input),
  "notion_action_get_page_details": (params: { config: any; userId: string; input: Record<string, any> }) =>
    executeNotionGetPageDetailsAction(params.config, params.userId, params.input),

  // Notion Append Page Content action (new schema)
  "notion_action_append_page_content": (params: { config: any; userId: string; input: Record<string, any> }) =>
    executeNotionAppendToPage({
      ...params.config,
      page: params.config.pageId || params.config.page, // Map pageId to page
    }, params.userId, params.input),

  // Notion Block actions
  "notion_action_add_block": createExecutionContextWrapper(notionAddBlock),
  "notion_action_get_block": createExecutionContextWrapper(notionGetBlock),
  "notion_action_get_block_children": createExecutionContextWrapper(notionGetBlockChildren),
  "notion_action_get_page_with_children": createExecutionContextWrapper((config: any, context: any) =>
    notionGetPageWithChildren({
      ...config,
      page_id: config.page || config.page_id,
    }, context)),

  // Notion Database actions (new separate actions)
  "notion_action_create_database": createExecutionContextWrapper((config: any, context: any) =>
    notionCreateDatabase({
      ...config,
      // Map UI field names to handler expected fields
      parent_type: "page",
      parent_page_id: config.parentPage || config.parent_page_id,
      is_inline: config.databaseType === "Inline" ? "true" : "false",
      properties_config: config.properties || config.properties_config || {
        // Default Name/Title property if none specified
        "Name": { title: {} }
      }
    }, context)),
  "notion_action_update_database_info": createExecutionContextWrapper(notionUpdateDatabase),
  "notion_action_find_or_create_item": createExecutionContextWrapper((config: any, context: any) =>
    notionFindOrCreateDatabaseItem({
      ...config,
      database_id: config.database || config.database_id,
      search_property: config.searchProperty || config.search_property,
      search_value: config.searchValue || config.search_value,
      create_if_not_found: config.createIfNotFound || config.create_if_not_found,
      create_properties: config.createProperties || config.create_properties,
    }, context)),
  "notion_action_update_database_item": createExecutionContextWrapper((config: any, context: any) =>
    notionUpdateDatabaseItem({
      ...config,
      item: config.item || config.itemToUpdate,
      database: config.database,
      properties: config.properties,
    }, context)),
  "notion_action_archive_database_item": createExecutionContextWrapper((config: any, context: any) =>
    notionArchiveDatabaseItem({
      ...config,
      item_id: config.itemToArchive || config.item_id, // Map itemToArchive to item_id
    }, context)),
  "notion_action_restore_database_item": createExecutionContextWrapper((config: any, context: any) =>
    notionRestoreDatabaseItem({
      ...config,
      item_id: config.itemToRestore || config.item_id, // Map itemToRestore to item_id
    }, context)),

  // Notion User actions aliases
  "notion_action_get_user": createExecutionContextWrapper((config: any, context: any) =>
    notionRetrieveUser({
      ...config,
      user_id: config.userId || config.user_id, // Map userId to user_id
    }, context)),

  // Notion Comment actions aliases
  "notion_action_list_comments": createExecutionContextWrapper((config: any, context: any) =>
    notionRetrieveComments({
      ...config,
      // Map UI field names to handler expected fields (listTarget determines source)
      block_id: config.listTarget === 'block'
        ? (config.blockIdForList || config.blockId || config.block_id)
        : (config.pageForList || config.page || config.block_id),
    }, context)),

  // Notion Page Content actions (new schema actions)
  "notion_action_list_page_content": createExecutionContextWrapper((config: any, context: any) =>
    notionRetrieveBlockChildren({
      ...config,
      block_id: config.pageId || config.page || config.block_id,
    }, context)),
  // NOTE: notion_action_update_page_content removed - redundant with Update Page action
  "notion_action_delete_page_content": createExecutionContextWrapper(async (config: any, context: any) => {
    // Handle both selection modes: manual blockId or selected blocks from page
    const blockIds: string[] = []

    if (config.selectionMode === 'manual' && config.blockId) {
      // Manual mode: single block ID
      blockIds.push(config.blockId)
    } else if (config.selectionMode === 'fromPage' && config.blocksToDelete) {
      // From page mode: extract selected block IDs
      const blocksData = config.blocksToDelete
      if (blocksData.selectedBlockIds && Array.isArray(blocksData.selectedBlockIds)) {
        blockIds.push(...blocksData.selectedBlockIds)
      } else {
        // Fallback: check for any truthy values in the object (block IDs with true value)
        Object.entries(blocksData).forEach(([key, value]) => {
          if (key !== 'selectedBlockIds' && value === true) {
            blockIds.push(key)
          }
        })
      }
    } else if (config.blockId) {
      // Legacy support: direct blockId
      blockIds.push(config.blockId)
    }

    if (blockIds.length === 0) {
      return {
        success: false,
        output: {},
        message: 'No blocks selected for deletion'
      }
    }

    // Delete each block
    const deletedBlocks: string[] = []
    const errors: string[] = []

    for (const blockId of blockIds) {
      try {
        const result = await notionDeleteBlock({ block_id: blockId }, context)
        if (result.success) {
          deletedBlocks.push(blockId)
        } else {
          errors.push(`${blockId}: ${result.message}`)
        }
      } catch (error: any) {
        errors.push(`${blockId}: ${error.message}`)
      }
    }

    return {
      success: deletedBlocks.length > 0,
      output: {
        blockIds: deletedBlocks,
        deletedCount: deletedBlocks.length,
        archived: deletedBlocks.length > 0,
        deletedAt: new Date().toISOString(),
        errors: errors.length > 0 ? errors : undefined
      },
      message: errors.length > 0
        ? `Deleted ${deletedBlocks.length} blocks, ${errors.length} failed`
        : `Successfully deleted ${deletedBlocks.length} block${deletedBlocks.length > 1 ? 's' : ''}`
    }
  }),

  // Notion Make API Call action (this one already expects userId, input pattern)
  "notion_action_api_call": (params: { config: any; userId: string; input: Record<string, any> }) =>
    notionMakeApiCall(params.config, params.userId, params.input),

  // GitHub actions - wrapped to handle new calling convention
  "github_action_create_issue": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createGitHubIssue(params.config, params.userId, params.input),
  "github_action_create_repository": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createGitHubRepository(params.config, params.userId, params.input),
  "github_action_create_pull_request": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createGitHubPullRequest(params.config, params.userId, params.input),
  "github_action_create_branch": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createGitHubBranch(params.config, params.userId, params.input),
  "github_action_create_gist": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createGitHubGist(params.config, params.userId, params.input),
  "github_action_add_comment": (params: { config: any; userId: string; input: Record<string, any> }) =>
    addGitHubComment(params.config, params.userId, params.input),

  // Outlook actions - wrapped to handle new calling convention
  "microsoft-outlook_action_send_email": (params: { config: any; userId: string; input: Record<string, any> }) =>
    sendOutlookEmail(params.config, params.userId, params.input),
  "microsoft-outlook_action_reply_to_email": (params: { config: any; userId: string; input: Record<string, any> }) =>
    replyToOutlookEmail(params.config, params.userId, params.input),
  "microsoft-outlook_action_forward_email": (params: { config: any; userId: string; input: Record<string, any> }) =>
    forwardOutlookEmail(params.config, params.userId, params.input),
  "microsoft-outlook_action_create_draft_email": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createOutlookDraftEmail(params.config, params.userId, params.input),
  "microsoft-outlook_action_move_email": (params: { config: any; userId: string; input: Record<string, any> }) =>
    moveOutlookEmail(params.config, params.userId, params.input),
  "microsoft-outlook_action_delete_email": (params: { config: any; userId: string; input: Record<string, any> }) =>
    deleteOutlookEmail(params.config, params.userId, params.input),
  "microsoft-outlook_action_add_categories": (params: { config: any; userId: string; input: Record<string, any> }) =>
    addOutlookCategories(params.config, params.userId, params.input),
  "microsoft-outlook_action_fetch_emails": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getOutlookEmails(params.config, params.userId, params.input),
  "microsoft-outlook_action_create_calendar_event": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createOutlookCalendarEvent(params.config, params.userId, params.input),
  "microsoft-outlook_action_update_calendar_event": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateOutlookCalendarEvent(params.config, params.userId, params.input),
  "microsoft-outlook_action_delete_calendar_event": (params: { config: any; userId: string; input: Record<string, any> }) =>
    deleteOutlookCalendarEvent(params.config, params.userId, params.input),
  "microsoft-outlook_action_add_attendees": (params: { config: any; userId: string; input: Record<string, any> }) =>
    addOutlookAttendees(params.config, params.userId, params.input),
  "microsoft-outlook_action_get_calendar_events": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getOutlookCalendarEvents(params.config, params.userId, params.input),
  "microsoft-outlook_action_create_contact": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createOutlookContact(params.config, params.userId, params.input),
  "microsoft-outlook_action_update_contact": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateOutlookContact(params.config, params.userId, params.input),
  "microsoft-outlook_action_delete_contact": (params: { config: any; userId: string; input: Record<string, any> }) =>
    deleteOutlookContact(params.config, params.userId, params.input),
  "microsoft-outlook_action_find_contact": (params: { config: any; userId: string; input: Record<string, any> }) =>
    findOutlookContact(params.config, params.userId, params.input),
  "microsoft-outlook_action_get_attachment": (params: { config: any; userId: string; input: Record<string, any> }) =>
    downloadOutlookAttachment(params.config, params.userId, params.input),

  // Microsoft Teams actions - wrapped to handle new calling convention
  "teams_action_send_message": (params: { config: any; userId: string; input: Record<string, any> }) =>
    sendTeamsMessage(params.config, params.userId, params.input),
  "teams_action_reply_to_message": (params: { config: any; userId: string; input: Record<string, any> }) =>
    replyToTeamsMessage(params.config, params.userId, params.input),
  "teams_action_edit_message": (params: { config: any; userId: string; input: Record<string, any> }) =>
    editTeamsMessage(params.config, params.userId, params.input),
  "teams_action_find_message": (params: { config: any; userId: string; input: Record<string, any> }) =>
    findTeamsMessage(params.config, params.userId, params.input),
  "teams_action_delete_message": (params: { config: any; userId: string; input: Record<string, any> }) =>
    deleteTeamsMessage(params.config, params.userId, params.input),
  "teams_action_send_chat_message": (params: { config: any; userId: string; input: Record<string, any> }) =>
    sendTeamsChatMessage(params.config, params.userId, params.input),
  "teams_action_create_group_chat": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createTeamsGroupChat(params.config, params.userId, params.input),
  "teams_action_get_channel_details": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getTeamsChannelDetails(params.config, params.userId, params.input),
  "teams_action_send_adaptive_card": (params: { config: any; userId: string; input: Record<string, any> }) =>
    sendTeamsAdaptiveCard(params.config, params.userId, params.input),
  "teams_action_add_reaction": (params: { config: any; userId: string; input: Record<string, any> }) =>
    addTeamsReaction(params.config, params.userId, params.input),
  "teams_action_remove_reaction": (params: { config: any; userId: string; input: Record<string, any> }) =>
    removeTeamsReaction(params.config, params.userId, params.input),
  "teams_action_schedule_meeting": (params: { config: any; userId: string; input: Record<string, any> }) =>
    scheduleTeamsMeeting(params.config, params.userId, params.input),
  "teams_action_end_meeting": (params: { config: any; userId: string; input: Record<string, any> }) =>
    endTeamsMeeting(params.config, params.userId, params.input),
  "teams_action_update_meeting": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateTeamsMeeting(params.config, params.userId, params.input),
  "teams_action_create_channel": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createTeamsChannel(params.config, params.userId, params.input),
  "teams_action_add_member_to_team": (params: { config: any; userId: string; input: Record<string, any> }) =>
    addTeamsMemberToTeam(params.config, params.userId, params.input),
  "teams_action_get_team_members": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getTeamsTeamMembers(params.config, params.userId, params.input),
  "teams_action_create_team": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createTeamsTeam(params.config, params.userId, params.input),

  // HubSpot actions - wrapped to handle new calling convention
  "hubspot_action_create_contact": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createHubSpotContact(params.config, params.userId, params.input),
  "hubspot_action_create_company": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createHubSpotCompany(params.config, params.userId, params.input),
  "hubspot_action_create_deal": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createHubSpotDeal(params.config, params.userId, params.input),
  "hubspot_action_add_contact_to_list": (params: { config: any; userId: string; input: Record<string, any> }) =>
    addContactToHubSpotList(params.config, params.userId, params.input),
  "hubspot_action_update_deal": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateHubSpotDeal(params.config, params.userId, params.input),

  // HubSpot dynamic actions - wrapped to handle new calling convention

  // HubSpot Get actions
  "hubspot_action_get_contacts": createExecutionContextWrapper(hubspotGetContacts),
  "hubspot_action_get_companies": createExecutionContextWrapper(hubspotGetCompanies),
  "hubspot_action_get_deals": createExecutionContextWrapper(hubspotGetDeals),
  "hubspot_action_get_tickets": createExecutionContextWrapper(hubspotGetTickets),

  // HubSpot Update actions
  "hubspot_action_update_contact": createExecutionContextWrapper(hubspotUpdateContact),
  "hubspot_action_update_company": createExecutionContextWrapper(hubspotUpdateCompany),
  "hubspot_action_update_ticket": createExecutionContextWrapper(hubspotUpdateTicket),

  // HubSpot Ticket actions
  "hubspot_action_create_ticket": createExecutionContextWrapper(hubspotCreateTicket),

  // HubSpot Engagement actions
  "hubspot_action_create_note": createExecutionContextWrapper(hubspotCreateNote),
  "hubspot_action_create_task": createExecutionContextWrapper(hubspotCreateTask),
  "hubspot_action_create_call": createExecutionContextWrapper(hubspotCreateCall),
  "hubspot_action_create_meeting": createExecutionContextWrapper(hubspotCreateMeeting),

  // HubSpot Phase 2: Workflow Management
  "hubspot_action_add_to_workflow": createExecutionContextWrapper(hubspotAddToWorkflow),
  "hubspot_action_remove_from_workflow": createExecutionContextWrapper(hubspotRemoveFromWorkflow),

  // HubSpot Phase 2: Product Management
  "hubspot_action_create_product": createExecutionContextWrapper(hubspotCreateProduct),
  "hubspot_action_update_product": createExecutionContextWrapper(hubspotUpdateProduct),
  "hubspot_action_get_products": createExecutionContextWrapper(hubspotGetProducts),

  // HubSpot Phase 2: List Management
  "hubspot_action_remove_from_list": createExecutionContextWrapper(hubspotRemoveFromList),

  // HubSpot Phase 2: Utility Actions
  "hubspot_action_get_owners": createExecutionContextWrapper(hubspotGetOwners),
  "hubspot_action_get_forms": createExecutionContextWrapper(hubspotGetForms),
  "hubspot_action_get_deal_pipelines": createExecutionContextWrapper(hubspotGetDealPipelines),

  // HubSpot Phase 3: Line Items
  "hubspot_action_create_line_item": createExecutionContextWrapper(hubspotCreateLineItem),
  "hubspot_action_update_line_item": createExecutionContextWrapper(hubspotUpdateLineItem),
  "hubspot_action_remove_line_item": createExecutionContextWrapper(hubspotRemoveLineItem),
  "hubspot_action_get_line_items": createExecutionContextWrapper(hubspotGetLineItems),

  // Microsoft OneNote actions - wrapped with ExecutionContext
  "microsoft-onenote_action_create_page": createExecutionContextWrapper(onenoteCreatePage),
  "microsoft-onenote_action_create_notebook": createExecutionContextWrapper(onenoteCreateNotebook),
  "microsoft-onenote_action_create_section": createExecutionContextWrapper(onenoteCreateSection),
  "microsoft-onenote_action_update_page": createExecutionContextWrapper(onenoteUpdatePage),
  "microsoft-onenote_action_get_page_content": createExecutionContextWrapper(onenoteGetPageContent),
  "microsoft-onenote_action_list_pages": createExecutionContextWrapper(onenoteGetPages),
  "microsoft-onenote_action_copy_page": createExecutionContextWrapper(onenoteCopyPage),
  "microsoft-onenote_action_delete_page": createExecutionContextWrapper(onenoteDeletePage),
  // NOTE: delete_section and delete_notebook are NOT supported by Microsoft Graph API
  "microsoft-onenote_action_list_notebooks": createExecutionContextWrapper(onenoteListNotebooks),
  "microsoft-onenote_action_list_sections": createExecutionContextWrapper(onenoteListSections),
  "microsoft-onenote_action_get_notebook_details": createExecutionContextWrapper(onenoteGetNotebookDetails),
  "microsoft-onenote_action_get_section_details": createExecutionContextWrapper(onenoteGetSectionDetails),

  // OneDrive actions - wrapped to handle new calling convention
  "onedrive_action_upload_file": (params: { config: any; userId: string; input: Record<string, any> }) =>
    uploadFileToOneDrive(params.config, params.userId, params.input),
  "onedrive_action_get_file": createExecutionContextWrapper(getOnedriveFile),
  "onedrive_action_create_folder": createExecutionContextWrapper(createOnedriveFolder),
  "onedrive_action_delete_item": createExecutionContextWrapper(deleteOnedriveItem),
  "onedrive_action_copy_item": createExecutionContextWrapper(copyOnedriveItem),
  "onedrive_action_move_item": createExecutionContextWrapper(moveOnedriveItem),
  "onedrive_action_rename_item": createExecutionContextWrapper(renameOnedriveItem),
  "onedrive_action_create_sharing_link": createExecutionContextWrapper(createOnedriveSharingLink),
  "onedrive_action_send_sharing_invitation": createExecutionContextWrapper(sendOnedriveSharingInvitation),
  "onedrive_action_search_files": createExecutionContextWrapper(searchOnedriveFiles),
  "onedrive_action_find_item_by_id": createExecutionContextWrapper(findOnedriveItemById),
  "onedrive_action_list_drives": createExecutionContextWrapper(listOnedriveDrives),

  // Facebook actions - wrapped to handle new calling convention
  "facebook_action_create_post": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createFacebookPost(params.config, params.userId, params.input),
  "facebook_action_get_page_insights": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getFacebookPageInsights(params.config, params.userId, params.input),
  "facebook_action_send_message": (params: { config: any; userId: string; input: Record<string, any> }) =>
    sendFacebookMessage(params.config, params.userId, params.input),
  "facebook_action_comment_on_post": (params: { config: any; userId: string; input: Record<string, any> }) =>
    commentOnFacebookPost(params.config, params.userId, params.input),
  "facebook_action_delete_post": (params: { config: any; userId: string; input: Record<string, any> }) =>
    deleteFacebookPost(params.config, params.userId, params.input),
  "facebook_action_update_post": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateFacebookPost(params.config, params.userId, params.input),
  "facebook_action_upload_photo": (params: { config: any; userId: string; input: Record<string, any> }) =>
    uploadFacebookPhoto(params.config, params.userId, params.input),
  "facebook_action_upload_video": (params: { config: any; userId: string; input: Record<string, any> }) =>
    uploadFacebookVideo(params.config, params.userId, params.input),

  // Dropbox actions - wrapped to handle new calling convention
  "dropbox_action_upload_file": (params: { config: any; userId: string; input: Record<string, any> }) =>
    uploadDropboxFile(params.config, { userId: params.userId, ...params.input }),
  "dropbox_action_get_file": createExecutionContextWrapper(getDropboxFile),
  "dropbox_action_find_files": createExecutionContextWrapper(findDropboxFiles),

  // Slack Get actions
  "slack_action_get_messages": createExecutionContextWrapper(getSlackMessages),

  // Trello Get actions
  "trello_action_get_cards": createExecutionContextWrapper(getTrelloCards),

  // Mailchimp actions
  "mailchimp_action_get_subscribers": createExecutionContextWrapper(mailchimpGetSubscribers),
  "mailchimp_action_add_subscriber": createExecutionContextWrapper(mailchimpAddSubscriber),
  "mailchimp_action_update_subscriber": createExecutionContextWrapper(mailchimpUpdateSubscriber),
  "mailchimp_action_remove_subscriber": createExecutionContextWrapper(mailchimpRemoveSubscriber),
  "mailchimp_action_add_tag": createExecutionContextWrapper(mailchimpAddTag),
  "mailchimp_action_remove_tag": createExecutionContextWrapper(mailchimpRemoveTag),
  "mailchimp_action_send_campaign": createExecutionContextWrapper(mailchimpSendCampaign),
  "mailchimp_action_create_campaign": createExecutionContextWrapper(mailchimpCreateCampaign),
  "mailchimp_action_create_audience": createExecutionContextWrapper(mailchimpCreateAudience),
  "mailchimp_action_create_event": createExecutionContextWrapper(mailchimpCreateEvent),
  "mailchimp_action_add_note": createExecutionContextWrapper(mailchimpAddNote),
  "mailchimp_action_get_subscriber": createExecutionContextWrapper(mailchimpGetSubscriber),
  "mailchimp_action_get_campaign": createExecutionContextWrapper(mailchimpGetCampaign),
  "mailchimp_action_get_campaign_stats": createExecutionContextWrapper(mailchimpGetCampaignStats),
  "mailchimp_action_schedule_campaign": createExecutionContextWrapper(mailchimpScheduleCampaign),
  "mailchimp_action_unsubscribe_subscriber": createExecutionContextWrapper(mailchimpUnsubscribeSubscriber),
  "mailchimp_action_create_segment": createExecutionContextWrapper(mailchimpCreateSegment),

  // Stripe actions
  "stripe_action_create_customer": createExecutionContextWrapper(stripeCreateCustomer),
  "stripe_action_update_customer": createExecutionContextWrapper(stripeUpdateCustomer),
  "stripe_action_create_payment_intent": createExecutionContextWrapper(stripeCreatePaymentIntent),
  "stripe_action_create_invoice": createExecutionContextWrapper(stripeCreateInvoice),
  "stripe_action_create_subscription": createExecutionContextWrapper(stripeCreateSubscription),
  "stripe_action_get_payments": createExecutionContextWrapper(stripeGetPayments),
  "stripe_action_create_refund": createExecutionContextWrapper(stripeCreateRefund),
  "stripe_action_cancel_subscription": createExecutionContextWrapper(stripeCancelSubscription),
  "stripe_action_update_subscription": createExecutionContextWrapper(stripeUpdateSubscription),
  "stripe_action_create_checkout_session": createExecutionContextWrapper(stripeCreateCheckoutSession),
  "stripe_action_create_payment_link": createExecutionContextWrapper(stripeCreatePaymentLink),
  "stripe_action_find_customer": createExecutionContextWrapper(stripeFindCustomer),
  "stripe_action_find_subscription": createExecutionContextWrapper(stripeFindSubscription),
  "stripe_action_find_payment_intent": createExecutionContextWrapper(stripeFindPaymentIntent),

  // Stripe trigger handlers - extract event data from webhook payload
  "stripe_trigger_new_payment": (params: { config: any; userId: string; input: Record<string, any> }) =>
    handleStripeTriggerEvent(params.config, params.userId, params.input),
  "stripe_trigger_refunded_charge": (params: { config: any; userId: string; input: Record<string, any> }) =>
    handleStripeTriggerEvent(params.config, params.userId, params.input),
  "stripe_trigger_subscription_created": (params: { config: any; userId: string; input: Record<string, any> }) =>
    handleStripeTriggerEvent(params.config, params.userId, params.input),
  "stripe_trigger_subscription_updated": (params: { config: any; userId: string; input: Record<string, any> }) =>
    handleStripeTriggerEvent(params.config, params.userId, params.input),
  "stripe_trigger_subscription_deleted": (params: { config: any; userId: string; input: Record<string, any> }) =>
    handleStripeTriggerEvent(params.config, params.userId, params.input),
  "stripe_trigger_invoice_payment_failed": (params: { config: any; userId: string; input: Record<string, any> }) =>
    handleStripeTriggerEvent(params.config, params.userId, params.input),
  "stripe_trigger_customer_created": (params: { config: any; userId: string; input: Record<string, any> }) =>
    handleStripeTriggerEvent(params.config, params.userId, params.input),
  "stripe_trigger_new_dispute": (params: { config: any; userId: string; input: Record<string, any> }) =>
    handleStripeTriggerEvent(params.config, params.userId, params.input),
  "stripe_trigger_checkout_session_completed": (params: { config: any; userId: string; input: Record<string, any> }) =>
    handleStripeTriggerEvent(params.config, params.userId, params.input),

  // Shopify actions - wrapped to handle new calling convention
  "shopify_action_create_order": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createShopifyOrder(params.config, params.userId, params.input),
  "shopify_action_create_product": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createShopifyProduct(params.config, params.userId, params.input),
  "shopify_action_update_product": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateShopifyProduct(params.config, params.userId, params.input),
  "shopify_action_create_customer": (params: {
    config: any
    userId: string
    input: Record<string, any>
    meta?: import('./core/idempotencyKey').HandlerExecutionMeta
  }) => createShopifyCustomer(params.config, params.userId, params.input, params.meta),
  "shopify_action_update_customer": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateShopifyCustomer(params.config, params.userId, params.input),
  "shopify_action_update_inventory": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateShopifyInventory(params.config, params.userId, params.input),
  "shopify_action_update_order_status": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateShopifyOrderStatus(params.config, params.userId, params.input),
  "shopify_action_add_order_note": (params: { config: any; userId: string; input: Record<string, any> }) =>
    addShopifyOrderNote(params.config, params.userId, params.input),
  "shopify_action_create_fulfillment": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createShopifyFulfillment(params.config, params.userId, params.input),
  "shopify_action_create_product_variant": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createShopifyProductVariant(params.config, params.userId, params.input),
  "shopify_action_update_product_variant": (params: { config: any; userId: string; input: Record<string, any> }) =>
    updateShopifyProductVariant(params.config, params.userId, params.input),

  // Twitter actions - wrapped to handle new calling convention
  "twitter_action_post_tweet": (params: { config: any; userId: string; input: Record<string, any> }) =>
    postTweetHandler(params.config, params.userId, params.input),
  "twitter_action_reply_tweet": (params: { config: any; userId: string; input: Record<string, any> }) =>
    replyTweetHandler(params.config, params.userId, params.input),
  "twitter_action_retweet": (params: { config: any; userId: string; input: Record<string, any> }) =>
    retweetHandler(params.config, params.userId, params.input),
  "twitter_action_unretweet": (params: { config: any; userId: string; input: Record<string, any> }) =>
    unretweetHandler(params.config, params.userId, params.input),
  "twitter_action_like_tweet": (params: { config: any; userId: string; input: Record<string, any> }) =>
    likeTweetHandler(params.config, params.userId, params.input),
  "twitter_action_unlike_tweet": (params: { config: any; userId: string; input: Record<string, any> }) =>
    unlikeTweetHandler(params.config, params.userId, params.input),
  "twitter_action_send_dm": (params: { config: any; userId: string; input: Record<string, any> }) =>
    sendDMHandler(params.config, params.userId, params.input),
  "twitter_action_follow_user": (params: { config: any; userId: string; input: Record<string, any> }) =>
    followUserHandler(params.config, params.userId, params.input),
  "twitter_action_unfollow_user": (params: { config: any; userId: string; input: Record<string, any> }) =>
    unfollowUserHandler(params.config, params.userId, params.input),
  "twitter_action_search_tweets": (params: { config: any; userId: string; input: Record<string, any> }) =>
    searchTweetsHandler(params.config, params.userId, params.input),
  "twitter_action_get_user_timeline": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getUserTimelineHandler(params.config, params.userId, params.input),
  "twitter_action_get_mentions": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getMentionsHandler(params.config, params.userId, params.input),

  // Gumroad actions - wrapped to handle new calling convention
  "gumroad_action_get_product": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getGumroadProduct(params.config, params.userId, params.input),
  "gumroad_action_list_products": (params: { config: any; userId: string; input: Record<string, any> }) =>
    listGumroadProducts(params.config, params.userId, params.input),
  "gumroad_action_enable_product": (params: { config: any; userId: string; input: Record<string, any> }) =>
    enableGumroadProduct(params.config, params.userId, params.input),
  "gumroad_action_disable_product": (params: { config: any; userId: string; input: Record<string, any> }) =>
    disableGumroadProduct(params.config, params.userId, params.input),
  "gumroad_action_delete_product": (params: { config: any; userId: string; input: Record<string, any> }) =>
    deleteGumroadProduct(params.config, params.userId, params.input),
  "gumroad_action_create_variant_category": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createGumroadVariantCategory(params.config, params.userId, params.input),
  "gumroad_action_create_offer_code": (params: { config: any; userId: string; input: Record<string, any> }) =>
    createGumroadOfferCode(params.config, params.userId, params.input),
  "gumroad_action_get_sales_analytics": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getGumroadSalesAnalytics(params.config, params.userId, params.input),
  "gumroad_action_list_sales": (params: { config: any; userId: string; input: Record<string, any> }) =>
    listGumroadSales(params.config, params.userId, params.input),
  "gumroad_action_mark_as_shipped": (params: { config: any; userId: string; input: Record<string, any> }) =>
    markGumroadAsShipped(params.config, params.userId, params.input),
  "gumroad_action_refund_sale": (params: { config: any; userId: string; input: Record<string, any> }) =>
    refundGumroadSale(params.config, params.userId, params.input),
  "gumroad_action_get_subscriber": (params: { config: any; userId: string; input: Record<string, any> }) =>
    getGumroadSubscriber(params.config, params.userId, params.input),
  "gumroad_action_list_subscribers": (params: { config: any; userId: string; input: Record<string, any> }) =>
    listGumroadSubscribers(params.config, params.userId, params.input),
  "gumroad_action_resend_receipt": (params: { config: any; userId: string; input: Record<string, any> }) =>
    resendGumroadReceipt(params.config, params.userId, params.input),
  "gumroad_action_verify_license": (params: { config: any; userId: string; input: Record<string, any> }) =>
    verifyGumroadLicense(params.config, params.userId, params.input),
  "gumroad_action_enable_license": (params: { config: any; userId: string; input: Record<string, any> }) =>
    enableGumroadLicense(params.config, params.userId, params.input),
  "gumroad_action_disable_license": (params: { config: any; userId: string; input: Record<string, any> }) =>
    disableGumroadLicense(params.config, params.userId, params.input),

  // Utility actions - data transformation, web scraping, search, etc.
  "format_transformer": (params: { config: any; userId: string; input: Record<string, any> }) =>
    formatTransformer(params.config, params.userId, params.input),
  "extract_website_data": (params: { config: any; userId: string; input: Record<string, any> }) =>
    executeExtractWebsiteData(params.config, params.userId, params.input),
  "tavily_search": (params: { config: any; userId: string; input: Record<string, any> }) =>
    executeTavilySearch(params.config, params.userId, params.input),
  "parse_file": (params: { config: any; userId: string; input: Record<string, any> }) =>
    executeParseFile(params.config, params.userId, params.input),

  // Workflow control actions - special handling needed for wait_for_time - wrapped to handle new calling convention
  "if_then_condition": (params: { config: any; userId: string; input: Record<string, any> }) =>
    executeIfThenCondition(params.config, params.userId, params.input),
  "delay": (params: { config: any; userId: string; input: Record<string, any> }) =>
    executeDelayAction(params.config, params.userId, params.input),

  // Logic control actions - Path, Router (filter + multi-path), HTTP Request
  "router": (params: { config: any; userId: string; input: Record<string, any> }) =>
    executeRouter({
      config: params.config,
      previousOutputs: params.input,
      trigger: params.input.trigger
    }),
  "http_request": (params: { config: any; userId: string; input: Record<string, any> }) =>
    executeHttpRequest({
      config: params.config,
      previousOutputs: params.input,
      trigger: params.input.trigger
    }),
  "loop": createExecutionContextWrapper(executeLoop),

  // HITL (Human-in-the-Loop) - needs execution context for pausing
  "hitl_conversation": (params: { config: any; userId: string; input: Record<string, any>; context?: any }) =>
    executeHITL(params.config, params.userId, params.input, params.context)
}

/**
 * Special handler for wait_for_time that needs workflow context
 */
export function getWaitForTimeHandler(workflowId: string, nodeId: string) {
  return (cfg: any, uid: string, inp: any) =>
    executeWaitForTime(cfg, uid, inp, { workflowId, nodeId })
}

/**
 * Special handler for wait_for_event that needs workflow and execution context
 */
export function getWaitForEventHandler(workflowId: string, nodeId: string, executionId?: string) {
  return (cfg: any, uid: string, inp: any, context?: any) =>
    executeWaitForEvent(cfg, uid, inp, {
      workflowId,
      nodeId,
      executionId: executionId || context?.executionId,
      allPreviousData: context?.allPreviousData
    })
}

// Export Notion unified handlers for use in IntegrationHandlers
export {
  executeNotionManagePage,
  executeNotionManageDatabase,
  executeNotionManageUsers,
  executeNotionManageComments,
  notionGetPageDetails as executeNotionGetPageDetails,
  notionSearch as executeNotionSearch
}
