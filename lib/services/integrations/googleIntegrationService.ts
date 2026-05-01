import { ExecutionContext } from "../workflowExecutionService"

import { logger } from '@/lib/utils/logger'

export class GoogleIntegrationService {
  constructor() {
    // No legacy service needed - we use direct implementations
  }

  async execute(node: any, context: ExecutionContext): Promise<any> {
    const nodeType = node.data.type

    // Google Drive actions (handle both google_drive_ and google-drive: prefixes)
    if (nodeType.startsWith('google_drive_') || nodeType.startsWith('google-drive:')) {
      return await this.executeGoogleDriveAction(node, context)
    }

    // Google Sheets actions
    if (nodeType.startsWith('sheets_') || nodeType.includes('sheets')) {
      return await this.executeGoogleSheetsAction(node, context)
    }

    // Google Docs actions
    if (nodeType.startsWith('google_docs_') || nodeType.startsWith('google-docs:')) {
      return await this.executeGoogleDocsAction(node, context)
    }

    // Google Calendar actions
    if (nodeType.startsWith('calendar_') || nodeType.startsWith('google_calendar_') || nodeType.startsWith('google-calendar:')) {
      return await this.executeGoogleCalendarAction(node, context)
    }

    throw new Error(`Unknown Google action: ${nodeType}`)
  }

  private async executeGoogleDriveAction(node: any, context: ExecutionContext) {
    const nodeType = node.data.type
    const config = node.data.config || {}

    logger.info(`📁 Executing Google Drive action: ${nodeType}`)

    switch (nodeType) {
      case "google_drive_create_file":
      case "google-drive:create_file": // New format from nodes
        return await this.executeCreateFile(node, context)
      case "google_drive_upload_file":
      case "google_drive_action_upload_file":
      case "google-drive:upload_file": // If we add this in future
        return await this.executeUploadFile(node, context)
      case "google_drive_create_folder":
      case "google-drive:create_folder":
        return await this.executeCreateFolder(node, context)
      case "google_drive_delete_file":
      case "google-drive:delete_file":
        return await this.executeDeleteFile(node, context)
      case "google_drive_share_file":
      case "google-drive:share_file":
        return await this.executeShareFile(node, context)
      case "google-drive:get_file": // From nodes definition
        return await this.executeGetFile(node, context)
      default:
        throw new Error(`Google Drive action '${nodeType}' is not yet implemented`)
    }
  }

  private async executeGoogleSheetsAction(node: any, context: ExecutionContext) {
    const nodeType = node.data.type
    const config = node.data.config || {}

    logger.info(`📊 Executing Google Sheets action: ${nodeType}`)

    if (context.testMode) {
      return {
        type: nodeType,
        status: "success (test mode)",
        data: []
      }
    }

    // PR-C4 — engine metadata for within-session idempotency.
    const meta = {
      executionSessionId: context.executionId,
      nodeId: node.id,
      actionType: node.data?.type ?? nodeType,
      provider: 'google-sheets',
      testMode: context.testMode,
    }

    // Import actual implementations
    switch (nodeType) {
      case "sheets_append":
      case "google_sheets_action_append":
        const { createGoogleSheetsRow } = await import('@/lib/workflows/actions/googleSheets')
        return await createGoogleSheetsRow(config, context.userId, context.data || {}, meta)
        
      case "sheets_read":
      case "google_sheets_action_read":
        const { readGoogleSheetsData } = await import('@/lib/workflows/actions/googleSheets')
        return await readGoogleSheetsData(config, context.userId, context.data || {})
        
      case "sheets_update":
      case "google_sheets_action_update":
        const { updateGoogleSheetsRow } = await import('@/lib/workflows/actions/googleSheets')
        return await updateGoogleSheetsRow(config, context.userId, context.data || {})
        
      case "sheets_delete":
      case "google_sheets_action_delete":
        const { deleteGoogleSheetsRow } = await import('@/lib/workflows/actions/googleSheets')
        return await deleteGoogleSheetsRow(config, context.userId, context.data || {})
        
      case "google_sheets_unified":
      case "google_sheets_unified_action":
        const { executeGoogleSheetsUnifiedAction } = await import('@/lib/workflows/actions/googleSheets')
        return await executeGoogleSheetsUnifiedAction(config, context.userId, context.data || {})
        
      case "google_sheets_action_create_spreadsheet":
        const { createGoogleSpreadsheet } = await import('@/lib/workflows/actions/googleSheets')
        return await createGoogleSpreadsheet(config, context.userId, context.data || {})
        
      default:
        throw new Error(`Google Sheets action '${nodeType}' is not yet implemented`)
    }
  }

  private async executeGoogleDocsAction(node: any, context: ExecutionContext) {
    const nodeType = node.data.type
    const config = node.data.config || {}

    logger.info(`📝 Executing Google Docs action: ${nodeType}`)

    if (context.testMode) {
      return {
        type: nodeType,
        status: "success (test mode)",
        documentId: "test-doc-id"
      }
    }

    // Import actual implementations
    switch (nodeType) {
      case "google_docs_create":
      case "google_docs_action_create_document":
        const { createGoogleDocument } = await import('@/lib/workflows/actions/googleDocs')
        return await createGoogleDocument(config, context.userId, context.data || {})
        
      case "google_docs_update":
      case "google_docs_action_update_document":
        const { updateGoogleDocument } = await import('@/lib/workflows/actions/googleDocs')
        return await updateGoogleDocument(config, context.userId, context.data || {})
        
      case "google_docs_share":
      case "google_docs_action_share_document":
        const { shareGoogleDocument } = await import('@/lib/workflows/actions/googleDocs')
        return await shareGoogleDocument(config, context.userId, context.data || {})
        
      case "google_docs_export":
      case "google_docs_action_export_document":
        const { exportGoogleDocument } = await import('@/lib/workflows/actions/googleDocs')
        return await exportGoogleDocument(config, context.userId, context.data || {})
        
      case "google_docs_read":
      case "google_docs_action_get_document":
        // Use the get function from googleDocs
        const googleDocs = await import('@/lib/workflows/actions/googleDocs')
        if ('getGoogleDocument' in googleDocs) {
          return await googleDocs.getGoogleDocument(config, context.userId, context.data || {})
        }
        throw new Error("Google Docs read/get action is not yet implemented")
        
      default:
        throw new Error(`Google Docs action '${nodeType}' is not yet implemented`)
    }
  }

  private async executeGoogleCalendarAction(node: any, context: ExecutionContext) {
    const nodeType = node.data.type
    const config = node.data.config || {}

    logger.info(`📅 Executing Google Calendar action: ${nodeType}`)
    logger.info('🔍 Node config at integration service:', {
      nodeId: node.id,
      hasConfig: !!config,
      configKeys: Object.keys(config),
      title: config.title,
      startDate: config.startDate,
      allDay: config.allDay
    })

    if (context.testMode) {
      return {
        type: nodeType,
        status: "success (test mode)",
        eventId: "test-event-id"
      }
    }

    // PR-C4 — engine metadata for within-session idempotency.
    const meta = {
      executionSessionId: context.executionId,
      nodeId: node.id,
      actionType: node.data?.type ?? nodeType,
      provider: 'google-calendar',
      testMode: context.testMode,
    }

    switch (nodeType) {
      case "calendar_create_event":
      case "google_calendar_action_create_event":
        const { createGoogleCalendarEvent } = await import('@/lib/workflows/actions/google-calendar/createEvent')
        return await createGoogleCalendarEvent(config, context.userId, context.data || {}, meta)
        
      case "calendar_update_event":
      case "google_calendar_action_update_event":
        // TODO: Implement when action is available
        throw new Error("Google Calendar update event is not yet implemented")
        
      case "calendar_delete_event":
      case "google_calendar_action_delete_event":
        // TODO: Implement when action is available
        throw new Error("Google Calendar delete event is not yet implemented")
        
      default:
        throw new Error(`Google Calendar action '${nodeType}' is not yet implemented`)
    }
  }

  // Google Drive implementations
  private async executeCreateFile(node: any, context: ExecutionContext) {
    logger.info("📄 Executing Google Drive create/upload file")
    
    const config = node.data.config || {}
    
    logger.info("🔍 [GoogleIntegrationService] Google Drive config:", {
      nodeId: node.id,
      nodeType: node.data.type,
      config: config,
      hasUploadedFiles: !!config.uploadedFiles,
      uploadedFiles: config.uploadedFiles,
      sourceType: config.sourceType,
      fileName: config.fileName,
      userId: context.userId
    })
    
    // Pass the workflow ID if available for file storage context
    const enrichedConfig = {
      ...config,
      workflowId: context.workflowId
    }

    if (context.testMode) {
      return {
        type: "google_drive_create_file",
        fileName: config.fileName,
        sourceType: config.sourceType,
        status: "uploaded (test mode)",
        fileId: "test-file-id"
      }
    }

    try {
      // Use the uploadGoogleDriveFile function we already have
      const { uploadGoogleDriveFile } = await import('@/lib/workflows/actions/googleDrive/uploadFile')
      const meta = {
        executionSessionId: context.executionId,
        nodeId: node.id,
        actionType: node.data?.type,
        provider: 'google-drive',
        testMode: context.testMode,
      }
      return await uploadGoogleDriveFile(enrichedConfig, context.userId, context.data || {}, meta)
    } catch (error: any) {
      logger.error("❌ [GoogleIntegrationService] Error executing Google Drive upload:", error)
      throw new Error(`Google Drive upload failed: ${error.message}`)
    }
  }

  private async executeUploadFile(node: any, context: ExecutionContext) {
    logger.info("⬆️ Executing Google Drive upload file")
    
    const config = node.data.config || {}

    if (context.testMode) {
      return {
        type: "google_drive_upload_file",
        status: "uploaded (test mode)",
        fileId: "test-file-id"
      }
    }

    // Import and use actual implementation
    const { uploadGoogleDriveFile } = await import('@/lib/workflows/actions/googleDrive/uploadFile')
    const meta = {
      executionSessionId: context.executionId,
      nodeId: node.id,
      actionType: node.data?.type,
      provider: 'google-drive',
      testMode: context.testMode,
    }
    return await uploadGoogleDriveFile(config, context.userId, context.data || {}, meta)
  }

  private async executeCreateFolder(node: any, context: ExecutionContext) {
    logger.info("📁 Executing Google Drive create folder")
    
    const config = node.data.config || {}
    const folderName = this.resolveValue(config.folderName || config.name, context)
    const parentId = this.resolveValue(config.parentId || config.parent_id, context)

    if (!folderName) {
      throw new Error("Google Drive create folder requires 'folderName' field")
    }

    if (context.testMode) {
      return {
        type: "google_drive_create_folder",
        folderName,
        parentId,
        status: "created (test mode)",
        folderId: "test-folder-id"
      }
    }

    // TODO: Implement actual Google Drive create folder
    throw new Error("Google Drive create folder is not yet implemented")
  }

  private async executeDeleteFile(node: any, context: ExecutionContext) {
    logger.info("🗑️ Executing Google Drive delete file")
    
    const config = node.data.config || {}
    const fileId = this.resolveValue(config.fileId || config.file_id, context)

    if (!fileId) {
      throw new Error("Google Drive delete file requires 'fileId' field")
    }

    if (context.testMode) {
      return {
        type: "google_drive_delete_file",
        fileId,
        status: "deleted (test mode)"
      }
    }

    // TODO: Implement actual Google Drive delete file
    throw new Error("Google Drive delete file is not yet implemented")
  }

  private async executeShareFile(node: any, context: ExecutionContext) {
    logger.info("🔗 Executing Google Drive share file")
    
    const config = node.data.config || {}
    const fileId = this.resolveValue(config.fileId || config.file_id, context)
    const email = this.resolveValue(config.email, context)
    const role = this.resolveValue(config.role, context) || 'reader'

    if (!fileId || !email) {
      throw new Error("Google Drive share file requires 'fileId' and 'email' fields")
    }

    if (context.testMode) {
      return {
        type: "google_drive_share_file",
        fileId,
        email,
        role,
        status: "shared (test mode)"
      }
    }

    // TODO: Implement actual Google Drive share file
    throw new Error("Google Drive share file is not yet implemented")
  }

  private async executeGetFile(node: any, context: ExecutionContext) {
    logger.info("📥 Executing Google Drive get file")
    
    const config = node.data.config || {}

    if (context.testMode) {
      return {
        type: "google_drive_get_file",
        fileId: config.fileId,
        status: "retrieved (test mode)",
        fileName: "test-file.txt",
        content: "Test file content"
      }
    }

    // Import and use actual implementation
    const { getGoogleDriveFile } = await import('@/lib/workflows/actions/googleDrive/getFile')
    return await getGoogleDriveFile(config, context.userId, context.data || {})
  }

  private resolveValue(value: any, context: ExecutionContext): any {
    if (typeof value === 'string' && context.dataFlowManager) {
      return context.dataFlowManager.resolveVariable(value)
    }
    return value
  }
}