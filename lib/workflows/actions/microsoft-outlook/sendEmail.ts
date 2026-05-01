import { getDecryptedAccessToken } from '../core/getDecryptedAccessToken'
import { resolveValue } from '../core/resolveValue'
import { parseRecipients } from '../core/parseRecipients'
import { refreshAndRetry } from '../core/refreshAndRetry'
import { ActionResult } from '../core/executeWait'
import { buildIdempotencyKey, type HandlerExecutionMeta } from '../core/idempotencyKey'
import { hashPayload } from '../core/hashPayload'
import { checkReplay, recordFired } from '../core/sessionSideEffects'
import { FileStorageService } from "@/lib/storage/fileStorage"
import { deleteWorkflowTempFiles } from '@/lib/utils/workflowFileCleanup'
import { applyEmailMetaVariables } from '../gmail/resolveEmailMetaVariables'

import { logger } from '@/lib/utils/logger'

/**
 * Microsoft Outlook send email handler with attachment support
 */
export async function sendOutlookEmail(
  config: any,
  userId: string,
  input: Record<string, any>,
  meta?: HandlerExecutionMeta,
): Promise<ActionResult> {
  const cleanupPaths = new Set<string>()

  // Q8d — testMode interception (see learning/docs/handler-contracts.md).
  if (meta?.testMode) {
    return {
      success: true,
      output: { simulated: true, provider: 'microsoft-outlook' },
      message: 'Simulated in test mode — no provider call made',
    }
  }

  try {
    // Resolve config values if they contain template variables
    const needsResolution = typeof config === 'object' &&
      Object.values(config).some(v =>
        typeof v === 'string' && v.includes('{{') && v.includes('}}')
      )

    const resolvedConfig = needsResolution ? resolveValue(config, input) : config

    // Apply meta-variable resolution to subject and body
    // This resolves {{recipient_name}}, {{sender_email}}, etc. based on To/From fields
    const { subject: resolvedSubject, body: resolvedBody } = await applyEmailMetaVariables(
      {
        to: resolvedConfig.to,
        from: undefined, // Outlook sends as authenticated user
        cc: resolvedConfig.cc,
        bcc: resolvedConfig.bcc,
        subject: resolvedConfig.subject,
        body: resolvedConfig.body
      },
      userId
    )

    const {
      to,
      cc,
      bcc,
      importance = 'normal',
      isHtml = false,
      attachments,
      sourceType,
      uploadedFiles,
      fileUrl,
      fileFromNode
    } = resolvedConfig

    // Use the meta-variable resolved subject and body
    const subject = resolvedSubject
    const body = resolvedBody

    // Get the decrypted access token for Microsoft Outlook
    const accessToken = await getDecryptedAccessToken(userId, "microsoft-outlook")

    // Prepare email data for Microsoft Graph API
    const emailData: any = {
      message: {
        subject: subject || '',
        body: {
          contentType: isHtml ? 'HTML' : 'Text',
          content: body || ''
        },
        toRecipients: [],
        ccRecipients: [],
        bccRecipients: [],
        importance: importance.toLowerCase(),
        attachments: [] // Will be populated if there are attachments
      }
    }

    // Process recipients via the shared Q7 normalizer. CSV strings split into
    // individual addresses (Outlook UX change per Q7 — pre-PR-C2 the entire
    // CSV was sent as ONE address). See learning/docs/handler-contracts.md.
    const toGraphAddress = (recipients: string | string[] | undefined) =>
      parseRecipients(recipients).map(address => ({
        emailAddress: { address },
      }))

    emailData.message.toRecipients = toGraphAddress(to)
    emailData.message.ccRecipients = toGraphAddress(cc)
    emailData.message.bccRecipients = toGraphAddress(bcc)

    // Validate that we have at least one recipient
    if (emailData.message.toRecipients.length === 0 &&
        emailData.message.ccRecipients.length === 0 &&
        emailData.message.bccRecipients.length === 0) {
      throw new Error('At least one recipient (to, cc, or bcc) is required')
    }

    // Handle attachments (following Gmail's comprehensive approach)
    let attachmentList: any[] = []

    // Determine attachment source based on sourceType or legacy attachments field
    // Check both uploadedFiles and attachments field (for compatibility)
    if (sourceType === 'file' && (uploadedFiles || attachments)) {
      const fileData = uploadedFiles || attachments

      if (typeof fileData === 'string') {
        // It's a file ID from storage
        attachmentList = [fileData]
      } else if (Array.isArray(fileData)) {
        // It's an array of uploaded files
        attachmentList = fileData
      } else if (fileData && typeof fileData === 'object') {
        // It's a single file object - check if it has content directly
        if (fileData.content && fileData.fileName) {
          // The file already has base64 content, use it directly
          attachmentList = [fileData]
        } else {
          attachmentList = [fileData]
        }
      }
    } else if (sourceType === 'url' && fileUrl) {
      // Handle file from URL
      attachmentList = [{ url: fileUrl }]
    } else if (sourceType === 'node' && fileFromNode) {
      // Handle file from previous node (variable reference)
      if (fileFromNode && typeof fileFromNode === 'object') {
        // Check for various file structures from other nodes
        if (fileFromNode.file && fileFromNode.file.content) {
          attachmentList = [fileFromNode.file]
        } else if (fileFromNode.content) {
          attachmentList = [fileFromNode]
        } else if (fileFromNode.uploadedFiles && Array.isArray(fileFromNode.uploadedFiles)) {
          attachmentList = fileFromNode.uploadedFiles
        } else if (fileFromNode.fileId || fileFromNode.id) {
          attachmentList = [fileFromNode]
        } else if (Array.isArray(fileFromNode)) {
          attachmentList = fileFromNode
        } else {
          attachmentList = [fileFromNode]
        }
      } else if (typeof fileFromNode === 'string') {
        attachmentList = [fileFromNode]
      } else if (Array.isArray(fileFromNode)) {
        attachmentList = fileFromNode
      }
    } else if (uploadedFiles && sourceType === 'file') {
      // Handle uploaded files from attachment upload
      attachmentList = Array.isArray(uploadedFiles) ? uploadedFiles : [uploadedFiles]
    } else if (attachments) {
      // Legacy support for existing workflows using attachments field
      attachmentList = Array.isArray(attachments) ? attachments : [attachments]
    }

    // Process attachments for Microsoft Graph API
    const outlookAttachments: any[] = []
    const fileService = new FileStorageService()

    for (const attachment of attachmentList) {
      try {
        let fileData: any = null

        // Track temporary file paths for cleanup
        if (
          attachment &&
          typeof attachment === 'object' &&
          attachment.isTemporary &&
          typeof attachment.filePath === 'string'
        ) {
          cleanupPaths.add(attachment.filePath)
        }

        // Check if it's an uploaded file object with id (from file upload field)
        if (attachment && typeof attachment === 'object' && attachment.id) {
          try {
            const storedFile = await FileStorageService.getFile(attachment.id, userId)
            if (storedFile) {
              const arrayBuffer = await storedFile.file.arrayBuffer()
              const base64Content = Buffer.from(arrayBuffer).toString('base64')

              fileData = {
                data: base64Content,
                fileName: attachment.fileName || storedFile.fileName || 'attachment',
                mimeType: attachment.fileType || storedFile.fileType || 'application/octet-stream'
              }
            }
          } catch (error) {
            logger.error('📎 [Outlook] Error fetching file from storage:', error)
          }
        } else if (attachment && typeof attachment === 'object' && attachment.content && attachment.fileName) {
          // File with inline content
          fileData = {
            data: attachment.content, // Already base64 encoded
            fileName: attachment.fileName || attachment.name || 'attachment',
            mimeType: attachment.mimeType || attachment.fileType || attachment.type || 'application/octet-stream'
          }
        } else if (attachment && typeof attachment === 'object' && attachment.url) {
          // File from URL
          try {
            const filePath = await fileService.downloadTempFile(attachment.url)
            if (filePath) {
              cleanupPaths.add(filePath)
              const fs = await import('fs')
              const path = await import('path')
              const fileContent = await fs.promises.readFile(filePath)
              const base64Content = fileContent.toString('base64')
              const fileName = path.basename(attachment.url) || 'attachment'

              fileData = {
                data: base64Content,
                fileName: fileName,
                mimeType: 'application/octet-stream'
              }
            }
          } catch (error) {
            logger.error(`Failed to download file from URL: ${error}`)
          }
        } else if (attachment && typeof attachment === 'object' && attachment.name && attachment.filePath) {
          // File uploaded to storage but content not included inline
          try {
            const { createClient } = await import('@supabase/supabase-js')
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
            const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY!
            const supabase = createClient(supabaseUrl, supabaseServiceKey)

            const { data: storageFile, error } = await supabase.storage
              .from('workflow-files')
              .download(attachment.filePath)

            if (error) {
              logger.error('📎 [Outlook] Error downloading file from storage:', error)
              continue
            }

            if (storageFile) {
              const arrayBuffer = await storageFile.arrayBuffer()
              const base64Content = Buffer.from(arrayBuffer).toString('base64')

              fileData = {
                data: base64Content,
                fileName: attachment.fileName || attachment.name || 'attachment',
                mimeType: attachment.mimeType || attachment.fileType || attachment.type || 'application/octet-stream'
              }
            }
          } catch (error) {
            logger.error('📎 [Outlook] Error fetching file from storage:', error)
            continue
          }
        } else if (attachment && typeof attachment === 'object' && attachment.content) {
          // Direct file object with content
          fileData = {
            data: attachment.content, // Already base64 encoded
            fileName: attachment.filename || attachment.fileName || attachment.name || 'attachment',
            mimeType: attachment.mimeType || attachment.type || 'application/octet-stream'
          }
        } else if (attachment && typeof attachment === 'object' && attachment.file && attachment.file.content) {
          // Nested file object
          fileData = {
            data: attachment.file.content,
            fileName: attachment.file.filename || attachment.file.fileName || attachment.file.name || attachment.fileName || 'attachment',
            mimeType: attachment.file.mimeType || attachment.file.type || 'application/octet-stream'
          }
        } else if (typeof attachment === 'string') {
          // File ID from FileStorageService
          try {
            const storedFile = await FileStorageService.getFile(attachment, userId)
            if (storedFile) {
              const arrayBuffer = await storedFile.file.arrayBuffer()
              const base64Content = Buffer.from(arrayBuffer).toString('base64')

              fileData = {
                data: base64Content,
                fileName: storedFile.fileName || 'attachment',
                mimeType: storedFile.fileType || 'application/octet-stream'
              }
            }
          } catch (error) {
            logger.error('📎 [Outlook] Error fetching file by ID:', error)
          }
        }

        // Add to Outlook attachments if we have file data
        if (fileData) {
          outlookAttachments.push({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: fileData.fileName,
            contentBytes: fileData.data,
            contentType: fileData.mimeType
          })
        }
      } catch (error) {
        logger.error(`Failed to attach file:`, error)
      }
    }

    // Add attachments to email if any
    if (outlookAttachments.length > 0) {
      emailData.message.attachments = outlookAttachments
    }

    // Q4 — within-session idempotency. Hash the resolved Graph payload
    // (recipients + subject + body + attachment names/sizes) so that a
    // re-resolved template producing the same effective send hashes equal.
    const idempotencyKey = buildIdempotencyKey(meta)
    const payloadHash = idempotencyKey
      ? hashPayload({
          to: emailData.message.toRecipients.map((r: any) => r.emailAddress.address),
          cc: emailData.message.ccRecipients.map((r: any) => r.emailAddress.address),
          bcc: emailData.message.bccRecipients.map((r: any) => r.emailAddress.address),
          subject: subject ?? '',
          body: body ?? '',
          isHtml: !!isHtml,
          importance,
          attachments: outlookAttachments.map((a: any) => ({
            name: a.name,
            size: typeof a.contentBytes === 'string' ? a.contentBytes.length : 0,
            contentType: a.contentType,
          })),
        })
      : ''

    if (idempotencyKey) {
      const replay = await checkReplay(idempotencyKey, payloadHash)
      if (replay.kind === 'cached') return replay.result
      if (replay.kind === 'mismatch') {
        if (cleanupPaths.size > 0) {
          await deleteWorkflowTempFiles(Array.from(cleanupPaths))
        }
        return {
          success: false,
          output: {},
          message: 'This action was already executed for this session with different input.',
          error: 'PAYLOAD_MISMATCH',
        }
      }
    }

    // Send the email using Microsoft Graph API. Wrapped in `refreshAndRetry`
    // (Q3) — a 401 from Graph triggers one refresh+retry attempt.
    const sendResult = await refreshAndRetry({
      provider: 'microsoft-outlook',
      userId,
      accessToken,
      call: async (token) =>
        fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(emailData),
        }),
    })

    if (!sendResult.success) {
      // PR-C5 (Q1) — Q3 standardized auth failure becomes a typed
      // ActionResult; the outer catch is now reserved for unexpected throws.
      if (cleanupPaths.size > 0) {
        await deleteWorkflowTempFiles(Array.from(cleanupPaths))
      }
      return {
        success: false,
        output: {},
        category: 'auth',
        message: sendResult.message,
      }
    }

    const response = sendResult.data

    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = `Failed to send email: ${response.statusText}`

      try {
        const errorJson = JSON.parse(errorText)
        if (errorJson.error?.message) {
          errorMessage = `Failed to send email: ${errorJson.error.message}`
        }
      } catch {
        // If error text is not JSON, use the default message
      }

      if (cleanupPaths.size > 0) {
        await deleteWorkflowTempFiles(Array.from(cleanupPaths))
      }
      return {
        success: false,
        output: {},
        category: 'provider',
        message: errorMessage,
      }
    }

    // Clean up temporary files
    if (cleanupPaths.size > 0) {
      await deleteWorkflowTempFiles(Array.from(cleanupPaths))
    }

    // Try to retrieve the sent message ID from Sent Items
    let messageId: string | undefined
    try {
      const sentRes = await fetch(
        'https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$top=1&$orderby=sentDateTime desc&$select=id,subject',
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      )
      if (sentRes.ok) {
        const sentData = await sentRes.json()
        if (sentData.value?.length > 0) {
          messageId = sentData.value[0].id
        }
      }
    } catch (e) {
      // Non-critical — messageId is optional
      logger.debug('[Outlook] Could not retrieve sent message ID:', e)
    }

    const actionResult: ActionResult = {
      success: true,
      output: {
        sent: true,
        messageId,
        recipients: {
          to: emailData.message.toRecipients.map((r: any) => r.emailAddress.address),
          cc: emailData.message.ccRecipients.map((r: any) => r.emailAddress.address),
          bcc: emailData.message.bccRecipients.map((r: any) => r.emailAddress.address)
        },
        subject: subject,
        timestamp: new Date().toISOString(),
        attachmentCount: outlookAttachments.length
      }
    }

    // Q4 — record the marker on first successful fire.
    if (idempotencyKey) {
      await recordFired(idempotencyKey, actionResult, payloadHash, {
        provider: 'microsoft-outlook',
        externalId: messageId ?? null,
      })
    }

    return actionResult
  } catch (error: any) {
    logger.error('❌ [Outlook] Error sending email:', error)

    // Clean up temporary files on error
    if (cleanupPaths.size > 0) {
      await deleteWorkflowTempFiles(Array.from(cleanupPaths))
    }

    // PR-C5 (Q1) — return ActionResult instead of throwing. The
    // execution-layer catch is reserved for unexpected programmer / system
    // throws; expected provider / config / auth failures are typed.
    if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
      return {
        success: false,
        output: {},
        category: 'auth',
        message: 'Microsoft Outlook authentication failed. Please reconnect your account.',
      }
    }

    return {
      success: false,
      output: {},
      category: 'provider',
      message: error.message || 'Microsoft Outlook send email failed',
    }
  }
}