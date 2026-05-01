import { getDecryptedAccessToken } from '../core/getDecryptedAccessToken'
import { parseRecipients } from '../core/parseRecipients'
import { refreshAndRetry } from '../core/refreshAndRetry'
import { resolveValue } from '../core/resolveValue'
import { ActionResult } from '../core/executeWait'
import { buildIdempotencyKey, type HandlerExecutionMeta } from '../core/idempotencyKey'
import { hashPayload } from '../core/hashPayload'
import { checkReplay, recordFired } from '../core/sessionSideEffects'
import { FileStorageService } from "@/lib/storage/fileStorage"
import { deleteWorkflowTempFiles } from '@/lib/utils/workflowFileCleanup'
import { applyEmailMetaVariables } from './resolveEmailMetaVariables'
import { google } from 'googleapis'

import { logger } from '@/lib/utils/logger'

/**
 * Enhanced Gmail send email with all field support
 */
export async function sendGmailEmail(
  params: {
    config: any
    userId: string
    input: Record<string, any>
    meta?: HandlerExecutionMeta
  }
): Promise<ActionResult> {
  const { config, userId, input, meta } = params
  const cleanupPaths = new Set<string>()

  // Q8d — testMode interception. When the engine signals testMode, the
  // handler must NOT contact the provider; return a deterministic
  // simulated ActionResult so downstream nodes see a consistent shape.
  if (meta?.testMode) {
    return {
      success: true,
      output: { simulated: true, provider: 'gmail' },
      message: 'Simulated in test mode — no provider call made',
    }
  }

  try {
    logger.debug('📧 [sendGmailEmail] Processing email', { fieldCount: Object.keys(config).length })
    logger.debug('📧 [sendGmailEmail] Input keys:', Object.keys(input || {}))

    // Config is already resolved if coming from GmailIntegrationService
    // Only resolve if it contains template variables
    const needsResolution = typeof config === 'object' &&
      Object.values(config).some(v =>
        typeof v === 'string' && v.includes('{{') && v.includes('}}')
      )

    logger.info('📧 [sendGmailEmail] Needs resolution:', needsResolution)

    // Resolve each field individually (like createDraft does) to ensure all fields are properly resolved
    const from = resolveValue(config.from, input)
    // Q7 — schema-declared multi-recipient fields are normalized through
    // `parseRecipients` so CSV strings, arrays, and mixed shapes all produce
    // a clean array of trimmed addresses. See learning/docs/handler-contracts.md.
    const to = parseRecipients(resolveValue(config.to, input))
    const cc = parseRecipients(resolveValue(config.cc, input))
    const bcc = parseRecipients(resolveValue(config.bcc, input))
    const rawSubject = resolveValue(config.subject, input)
    const rawBody = resolveValue(config.body, input)
    const signature = resolveValue(config.signature, input)
    const attachments = resolveValue(config.attachments, input)
    const sourceType = resolveValue(config.sourceType, input)
    const uploadedFiles = resolveValue(config.uploadedFiles, input)
    const fileUrl = resolveValue(config.fileUrl, input)
    const fileFromNode = resolveValue(config.fileFromNode, input)
    const replyTo = resolveValue(config.replyTo, input)
    const priority = resolveValue(config.priority, input) || 'normal'
    const readReceipt = resolveValue(config.readReceipt, input) || false
    const labels = resolveValue(config.labels, input) || []
    const scheduleSend = resolveValue(config.scheduleSend, input)
    const trackOpens = resolveValue(config.trackOpens, input) || false
    const trackClicks = resolveValue(config.trackClicks, input) || false
    const isHtml = resolveValue(config.isHtml, input) || false

    logger.debug('📧 [sendGmailEmail] Resolved recipients', { toCount: to.length, ccCount: cc.length, bccCount: bcc.length })
    logger.debug('📧 [sendGmailEmail] Body field', { hasBody: !!rawBody, length: rawBody?.length })

    // Apply meta-variable resolution to subject and body
    // This resolves {{recipient_name}}, {{sender_email}}, etc. based on To/From fields
    const { subject: resolvedSubject, body: resolvedBody } = await applyEmailMetaVariables(
      {
        to,
        from,
        cc,
        bcc,
        subject: rawSubject,
        body: rawBody
      },
      userId
    )

    // Use the meta-variable resolved subject and body
    const subject = resolvedSubject
    const body = resolvedBody

    // Auto-detect HTML if not explicitly set
    const bodyIsHtml = isHtml || (body && typeof body === 'string' && 
      (body.includes('<div') || body.includes('<p>') || body.includes('<br') || 
       body.includes('<span') || body.includes('<table')))

    const accessToken = await getDecryptedAccessToken(userId, "gmail")

    // Build a Gmail SDK client for the given access token. The send call is
    // wrapped in `refreshAndRetry` (Q3) so a 401 from the SDK triggers one
    // refresh-and-retry attempt with the new token. Building the client
    // inside the closure means the retry uses the refreshed token end-to-end
    // (the OAuth2 client carries the credentials).
    const buildGmailClient = (token: string) => {
      const oauth2Client = new google.auth.OAuth2()
      oauth2Client.setCredentials({ access_token: token })
      return google.gmail({ version: 'v1', auth: oauth2Client })
    }
    const gmail = buildGmailClient(accessToken)

    // Build email headers. After Q7 normalization the recipient fields are
    // always arrays, so header assembly is a single .join().
    logger.debug('📧 [sendGmailEmail] Building headers', { ccCount: cc.length })

    const headers: Record<string, string> = {
      'To': to.join(', '),
      'Subject': subject,
      'From': from || 'me', // Use specified sender or default to authenticated user
    }

    if (cc.length > 0) {
      headers['Cc'] = cc.join(', ')
      logger.debug('📧 [sendGmailEmail] CC header set')
    } else {
      logger.debug('📧 [sendGmailEmail] CC field empty, skipping header')
    }

    if (bcc.length > 0) {
      headers['Bcc'] = bcc.join(', ')
    }

    if (replyTo) {
      headers['Reply-To'] = replyTo
    }

    // Set priority headers
    if (priority === 'high') {
      headers['X-Priority'] = '1'
      headers['Importance'] = 'High'
    } else if (priority === 'low') {
      headers['X-Priority'] = '5'
      headers['Importance'] = 'Low'
    }

    // Request read receipt
    if (readReceipt) {
      headers['Disposition-Notification-To'] = 'me'
      headers['Return-Receipt-To'] = 'me'
    }

    // Add tracking pixels if requested (basic implementation)
    let finalBody = body
    if (signature) {
      finalBody = bodyIsHtml 
        ? `${body}<br><br>${signature}`
        : `${body}\n\n${signature}`
    }

    if (trackOpens && bodyIsHtml) {
      // Open tracking requires a dedicated tracking endpoint — not yet available
      logger.warn('📧 [sendGmailEmail] trackOpens requested but tracking endpoint is not configured — skipping')
    }

    // Build MIME message
    const boundary = `boundary_${Date.now()}`
    const messageParts = []

    // Add headers
    logger.debug('📧 [sendGmailEmail] Headers prepared', { headerNames: Object.keys(headers) })
    for (const [key, value] of Object.entries(headers)) {
      messageParts.push(`${key}: ${value}`)
    }
    logger.debug('📧 [sendGmailEmail] Message parts built', { partCount: messageParts.length })
    messageParts.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
    messageParts.push('')
    messageParts.push(`--${boundary}`)

    // Add body
    if (bodyIsHtml) {
      messageParts.push('Content-Type: text/html; charset=utf-8')
    } else {
      messageParts.push('Content-Type: text/plain; charset=utf-8')
    }
    messageParts.push('')
    messageParts.push(finalBody)

    
    // Handle attachments based on sourceType
    let attachmentList: any[] = [];
    
    // Determine attachment source based on sourceType or legacy attachments field
    
    // Check both uploadedFiles and attachments field (for compatibility with GmailAttachmentField)
    if (sourceType === 'file' && (uploadedFiles || attachments)) {
      const fileData = uploadedFiles || attachments;
      // Handle uploaded files from the file field
      
      if (typeof fileData === 'string') {
        // It's a file ID from storage
        attachmentList = [fileData];
      } else if (Array.isArray(fileData)) {
        // It's an array of uploaded files
        attachmentList = fileData;
      } else if (fileData && typeof fileData === 'object') {
        // It's a single file object - check if it has content directly (from GmailAttachmentField)
        if (fileData.content && fileData.fileName) {
          // The file already has base64 content, use it directly
          attachmentList = [fileData];
        } else {
          attachmentList = [fileData];
        }
      }
    } else if (sourceType === 'url' && fileUrl) {
      // Download file from URL and attach
      try {
        const response = await fetch(fileUrl)
        if (!response.ok) {
          logger.warn('📧 [sendGmailEmail] Failed to download file from URL', { fileUrl, status: response.status })
        } else {
          const arrayBuffer = await response.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)
          const contentType = response.headers.get('content-type') || 'application/octet-stream'
          // Extract filename from URL or Content-Disposition header
          const disposition = response.headers.get('content-disposition')
          let urlFilename = 'attachment'
          if (disposition) {
            const filenameMatch = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
            if (filenameMatch) urlFilename = filenameMatch[1].replace(/['"]/g, '')
          } else {
            const urlPath = new URL(fileUrl).pathname
            urlFilename = urlPath.split('/').pop() || 'attachment'
          }
          attachmentList = [{
            data: buffer.toString('base64'),
            fileName: urlFilename,
            mimeType: contentType
          }]
        }
      } catch (urlError: any) {
        logger.warn('📧 [sendGmailEmail] Error downloading file from URL', { fileUrl, error: urlError.message })
      }
    } else if (sourceType === 'node' && fileFromNode) {
      // Handle file from previous node (variable reference)
      
      // Check if fileFromNode is already a file object from Google Drive
      if (fileFromNode && typeof fileFromNode === 'object') {
        // Check for Google Drive Get File structure: {file: {content, filename, mimeType}}
        if (fileFromNode.file && fileFromNode.file.content) {
          attachmentList = [fileFromNode.file]; // Use the file object directly
        } else if (fileFromNode.file && fileFromNode.file.filePath && !fileFromNode.file.content) {
          // Storage reference from Google Drive (file too large for inline base64)
          attachmentList = [fileFromNode.file]; // Has filePath, name, mimeType - handled by filePath download logic below
        } else if (fileFromNode.content) {
          // Direct file object with content
          attachmentList = [fileFromNode];
        } else if (fileFromNode.uploadedFiles && Array.isArray(fileFromNode.uploadedFiles)) {
          // Google Drive Upload File result structure
          // Each uploaded file has: {fileId, fileName, mimeType, webViewLink, webContentLink}
          // We need to fetch these files' content
          for (const uploadedFile of fileFromNode.uploadedFiles) {
            if (uploadedFile.fileId) {
              // This is just metadata, we'd need to fetch the actual file content
              // For now, log a warning
              // Google Drive Upload result contains file metadata only. Use Google Drive Get File action to retrieve file content.
            }
          }
          attachmentList = []; // Can't attach without content
        } else if (fileFromNode.fileId || fileFromNode.id) {
          // It might be a reference object with just the ID
          attachmentList = [fileFromNode];
        } else if (Array.isArray(fileFromNode)) {
          attachmentList = fileFromNode;
        } else {
          // Unknown structure, try to use it as is
          attachmentList = [fileFromNode];
        }
      } else if (typeof fileFromNode === 'string') {
        // It's a file ID string
        attachmentList = [fileFromNode];
      } else if (Array.isArray(fileFromNode)) {
        attachmentList = fileFromNode;
      }
    } else if (uploadedFiles && sourceType === 'file') {
      // Handle uploaded files from Gmail attachment upload
      attachmentList = Array.isArray(uploadedFiles) ? uploadedFiles : [uploadedFiles];
    } else if (attachments) {
      // Legacy support for existing workflows using attachments field
      attachmentList = Array.isArray(attachments) ? attachments : [attachments];
    }
    
    // Process attachments
    for (const attachment of attachmentList) {
      try {
        let fileData: any = null;

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
          // File uploaded via the standard workflow file upload
          try {
            const storedFile = await FileStorageService.getFile(attachment.id, userId);
            if (storedFile) {
              const arrayBuffer = await storedFile.file.arrayBuffer();
              const base64Content = Buffer.from(arrayBuffer).toString('base64');
              
              fileData = {
                data: base64Content,
                fileName: attachment.fileName || storedFile.fileName || 'attachment',
                mimeType: attachment.fileType || storedFile.fileType || 'application/octet-stream'
              };
            }
          } catch (error) {
            logger.error('📎 [sendGmailEmail] Error fetching file from storage:', error);
          }
        } else if (attachment && typeof attachment === 'object' && attachment.content && attachment.fileName) {
          // File with inline content (for backwards compatibility)
          fileData = {
            data: attachment.content, // Already base64 encoded
            fileName: attachment.fileName || attachment.name || 'attachment',
            mimeType: attachment.mimeType || attachment.fileType || attachment.type || 'application/octet-stream'
          };
        } else if (attachment && typeof attachment === 'object' && attachment.name && !attachment.content && !attachment.file) {
          // This is a file metadata object from the upload field
          // Check if it's a Google Drive file that we can fetch
          if (attachment.id && attachment.id.startsWith('google-drive-')) {
            
            try {
              // Extract the actual file ID from the Google Drive ID format
              const fileId = attachment.id.replace('google-drive-', '');
              
              // Import and use the Google Drive get file function
              const { getGoogleDriveFile } = await import('../googleDrive/getFile');
              
              // Fetch the file content from Google Drive
              const driveResult = await getGoogleDriveFile(
                { fileId },
                userId,
                input
              );
              
              if (driveResult.success && driveResult.output?.file) {
                fileData = {
                  data: driveResult.output.file.content,
                  fileName: driveResult.output.file.filename || attachment.name,
                  mimeType: driveResult.output.file.mimeType || attachment.type || 'application/octet-stream'
                };
              } else {
                continue;
              }
            } catch (error) {
              // Error fetching Google Drive file
              continue;
            }
          } else if (attachment.filePath) {
            // File uploaded to storage but content not included inline
            
            try {
              const { createClient } = await import('@supabase/supabase-js');
              const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
              const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY!;
              const supabase = createClient(supabaseUrl, supabaseServiceKey);
              
              const { data: storageFile, error } = await supabase.storage
                .from('workflow-files')
                .download(attachment.filePath);
              
              if (error) {
                logger.error('📎 [sendGmailEmail] Error downloading file from storage:', error);
                continue;
              }
              
              if (storageFile) {
                const arrayBuffer = await storageFile.arrayBuffer();
                const base64Content = Buffer.from(arrayBuffer).toString('base64');
                
                fileData = {
                  data: base64Content,
                  fileName: attachment.fileName || attachment.name || 'attachment',
                  mimeType: attachment.mimeType || attachment.fileType || attachment.type || 'application/octet-stream'
                };
                }
            } catch (error) {
              logger.error('📎 [sendGmailEmail] Error fetching file from storage:', error);
              continue;
            }
          } else {
            // Regular file upload without content - skip
            // Skipping file attachment - file content not available
            continue;
          }
        } else if (attachment && typeof attachment === 'object' && attachment.content) {
          // Direct file object with content (e.g., from Google Drive Get File)
          fileData = {
            data: attachment.content, // Already base64 encoded
            fileName: attachment.filename || attachment.fileName || attachment.name || 'attachment',
            mimeType: attachment.mimeType || attachment.type || 'application/octet-stream'
          };
        } else if (attachment && typeof attachment === 'object' && attachment.file && attachment.file.content) {
          // Nested file object (e.g., {{nodeId.file}})
          fileData = {
            data: attachment.file.content, // Already base64 encoded
            fileName: attachment.file.filename || attachment.file.fileName || attachment.file.name || attachment.fileName || 'attachment',
            mimeType: attachment.file.mimeType || attachment.file.type || 'application/octet-stream'
          };
        } else if (typeof attachment === 'string') {
          // File ID from FileStorageService
          // Fetching file from storage with ID
          fileData = await FileStorageService.getFile(attachment, userId);
        } else {
          // Unknown attachment structure, skipping
        }
        
        if (fileData) {
          
          messageParts.push(`--${boundary}`)
          messageParts.push(`Content-Type: ${fileData.mimeType || 'application/octet-stream'}`)
          messageParts.push(`Content-Transfer-Encoding: base64`)
          messageParts.push(`Content-Disposition: attachment; filename="${fileData.fileName}"`)
          messageParts.push('')
          messageParts.push(fileData.data)
        } else {
          // No fileData for attachment, skipping
        }
      } catch (error) {
        logger.error(`Failed to attach file:`, error)
      }
    }

    messageParts.push(`--${boundary}--`)

    // Encode message
    const message = messageParts.join('\r\n')
    const encodedMessage = Buffer.from(message).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    // Handle scheduled send
    if (scheduleSend) {
      logger.warn('📧 [sendGmailEmail] Scheduled send requested but Gmail API does not support native scheduling — sending immediately', { scheduleSend })
    }

    // Q4 — within-session idempotency. Build the key from engine-thread
    // metadata; absent meta (test-only paths) → no-op. The canonical input
    // for hashing is the resolved-and-normalized values that determine the
    // side effect — the encoded MIME bytes — so a re-resolved template
    // that produces the same recipients/subject/body still hashes equal.
    const idempotencyKey = buildIdempotencyKey(meta)
    const payloadHash = idempotencyKey
      ? hashPayload({
          to,
          cc,
          bcc,
          from,
          subject,
          body: finalBody,
          replyTo,
          priority,
          encodedMessageLength: encodedMessage.length,
        })
      : ''

    if (idempotencyKey) {
      const replay = await checkReplay(idempotencyKey, payloadHash)
      if (replay.kind === 'cached') return replay.result
      if (replay.kind === 'mismatch') {
        return {
          success: false,
          output: {},
          message: 'This action was already executed for this session with different input.',
          error: 'PAYLOAD_MISMATCH',
        }
      }
    }

    // Send the email — wrapped in `refreshAndRetry` (Q3). On a 401 from the
    // googleapis SDK, the wrapper refreshes the token once and retries. A
    // permanent 401 surfaces as a structured auth failure; everything else
    // throws / returns normally.
    const sendResult = await refreshAndRetry({
      provider: 'gmail',
      userId,
      accessToken,
      call: async (token) => {
        const client = buildGmailClient(token)
        return client.users.messages.send({
          userId: 'me',
          requestBody: {
            raw: encodedMessage,
            labelIds: labels.length > 0 ? labels : undefined,
          },
        })
      },
    })

    if (!sendResult.success) {
      return {
        success: false,
        output: {},
        message: sendResult.message,
      }
    }

    const result = sendResult.data

    // Apply labels if specified. Best-effort; uses the original Gmail client
    // (token may have been refreshed during the send retry — but `gmail.users
    // .messages.modify` is rare enough that a stale-token failure here is
    // logged-and-swallowed rather than failing the email).
    if (labels.length > 0 && result.data.id) {
      try {
        await gmail.users.messages.modify({
          userId: 'me',
          id: result.data.id,
          requestBody: {
            addLabelIds: labels
          }
        })
      } catch (labelError) {
        logger.error('Failed to apply labels:', labelError)
      }
    }

    const actionResult: ActionResult = {
      success: true,
      output: {
        messageId: result.data.id,
        threadId: result.data.threadId,
        to,
        subject,
        labelIds: result.data.labelIds
      },
      message: `Email sent successfully to ${to.join(', ')}`
    }

    // Q4 — record the marker so a retry within this session short-circuits
    // to the cached result. Best-effort: failures here are logged but
    // don't fail the handler (the email already sent).
    if (idempotencyKey) {
      await recordFired(idempotencyKey, actionResult, payloadHash, {
        provider: 'gmail',
        externalId: result.data.id ?? null,
      })
    }

    return actionResult

  } catch (error: any) {
    logger.error('Send Gmail error:', error)
    return {
      success: false,
      output: {},
      message: error.message || 'Failed to send email'
    }
  } finally {
    if (cleanupPaths.size > 0) {
      await deleteWorkflowTempFiles(cleanupPaths)
    }
  }
}
