import { ActionResult } from '../index'
import { createSupabaseServerClient } from "@/utils/supabase/server"
import { decrypt } from "@/lib/security/encryption"
import { FileStorageService } from "@/lib/storage/fileStorage"

import { logger } from '@/lib/utils/logger'

interface DropboxUploadConfig {
  fileName: string
  sourceType: 'file' | 'url' | 'text' | 'node'
  path?: string // Destination folder path
  uploadedFiles?: any
  fileUrl?: string
  fileContent?: string
  fileFromNode?: any
}

export async function uploadDropboxFile(
  config: DropboxUploadConfig,
  context: any
): Promise<ActionResult> {
  try {
    logger.info('[Dropbox Upload] Starting upload with config:', {
      fileName: config.fileName,
      sourceType: config.sourceType,
      path: config.path
    })

    // Get the user ID from context
    const userId = context.userId
    if (!userId) {
      throw new Error('User ID not found in context')
    }

    // Get Dropbox integration
    const supabase = await createSupabaseServerClient()
    const { data: integration, error: integrationError } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'dropbox')
      .eq('status', 'connected')
      .single()

    if (integrationError || !integration) {
      throw new Error('Dropbox integration not found or not connected')
    }

    // Decrypt the access token
    const decryptedToken = await decrypt(integration.access_token)
    if (!decryptedToken) {
      throw new Error('Failed to decrypt Dropbox access token')
    }

    // Prepare file data based on source type
    let fileData: Buffer
    let actualFileName = config.fileName

    switch (config.sourceType) {
      case 'file':
        if (!config.uploadedFiles) {
          throw new Error('No file uploaded')
        }

        // Handle both single file object and array
        const fileInfo = Array.isArray(config.uploadedFiles) ? config.uploadedFiles[0] : config.uploadedFiles

        if (!fileInfo) {
          throw new Error('No file uploaded')
        }

        logger.info('[Dropbox Upload] Processing uploaded file:', {
          type: typeof fileInfo,
          hasFilePath: !!fileInfo.filePath,
          hasContent: !!fileInfo.content,
          fileName: fileInfo.fileName || fileInfo.name
        })

        // If it's a file with a storage path (uploaded to Supabase)
        if (fileInfo.filePath) {
          // Fetch the file from Supabase storage
          const supabase = await createSupabaseServerClient()
          const { data: downloadedFile, error: downloadError } = await supabase.storage
            .from('workflow-files')
            .download(fileInfo.filePath)

          if (downloadError || !downloadedFile) {
            throw new Error(`Failed to download file from storage: ${downloadError?.message || 'Unknown error'}`)
          }

          // Convert blob to buffer
          const arrayBuffer = await downloadedFile.arrayBuffer()
          fileData = Buffer.from(arrayBuffer)
          actualFileName = fileInfo.fileName || fileInfo.name || config.fileName
        }
        // If it's a file ID string, fetch from storage service
        else if (typeof fileInfo === 'string') {
          const fileStorage = new FileStorageService()
          const storedFile = await fileStorage.getFile(fileInfo, userId)
          if (!storedFile) {
            throw new Error('File not found in storage')
          }
          fileData = Buffer.from(storedFile.content, 'base64')
          actualFileName = storedFile.name || config.fileName
        }
        // If it has content directly (base64 encoded)
        else if (fileInfo.content) {
          fileData = Buffer.from(fileInfo.content, 'base64')
          actualFileName = fileInfo.fileName || fileInfo.name || config.fileName
        }
        // Slack-style attachment shape — FieldRenderer.tsx writes the
        // base64 payload onto `data` (with `data:mime;base64,` prefix) when
        // building Slack attachment objects. Allow that shape too.
        else if (fileInfo.data) {
          fileData = Buffer.from(fileInfo.data, 'base64')
          actualFileName = fileInfo.fileName || fileInfo.name || config.fileName
        } else {
          throw new Error('Invalid file format - no content or path available')
        }
        break

      case 'url':
        if (!config.fileUrl) {
          throw new Error('File URL is required')
        }
        const response = await fetch(config.fileUrl)
        if (!response.ok) {
          throw new Error(`Failed to fetch file from URL: ${response.statusText}`)
        }
        const arrayBuffer = await response.arrayBuffer()
        fileData = Buffer.from(arrayBuffer)
        // Try to extract filename from URL or use provided one
        const urlPath = new URL(config.fileUrl).pathname
        const urlFileName = urlPath.split('/').pop()
        if (urlFileName && !config.fileName) {
          actualFileName = urlFileName
        }
        break

      case 'text':
        if (!config.fileContent) {
          throw new Error('File content is required')
        }
        fileData = Buffer.from(config.fileContent, 'utf-8')
        // Ensure text files have .txt extension if not specified
        if (!actualFileName.includes('.')) {
          actualFileName = `${actualFileName}.txt`
        }
        break

      case 'node':
        if (!config.fileFromNode) {
          throw new Error('File data from node is required')
        }
        // Handle different formats of node data
        if (typeof config.fileFromNode === 'string') {
          // Base64 encoded data
          fileData = Buffer.from(config.fileFromNode, 'base64')
        } else if (config.fileFromNode.content) {
          // Object with content property
          fileData = Buffer.from(config.fileFromNode.content, 'base64')
          actualFileName = config.fileFromNode.name || config.fileName
        } else {
          throw new Error('Invalid file data from node')
        }
        break

      default:
        throw new Error(`Unknown source type: ${config.sourceType}`)
    }

    // Prepare the destination path
    let destinationPath = config.path || ''

    // Ensure path starts with / if not empty
    if (destinationPath && !destinationPath.startsWith('/')) {
      destinationPath = `/${ destinationPath}`
    }

    // Add filename to path
    const fullPath = destinationPath ? `${destinationPath}/${actualFileName}` : `/${actualFileName}`

    logger.info('[Dropbox Upload] Uploading to path:', fullPath)

    // Check if folder exists, create if it doesn't and path is specified
    if (destinationPath && destinationPath !== '') {
      try {
        // First, try to get folder metadata
        const checkFolderResponse = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${decryptedToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            path: destinationPath
          })
        })

        if (!checkFolderResponse.ok) {
          // Folder doesn't exist, create it
          logger.info('[Dropbox Upload] Folder does not exist, creating:', destinationPath)

          const createFolderResponse = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${decryptedToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              path: destinationPath,
              autorename: false
            })
          })

          if (!createFolderResponse.ok) {
            const errorData = await createFolderResponse.json()
            logger.error('[Dropbox Upload] Failed to create folder:', errorData)
            // Continue with upload anyway - folder might exist but we can't access metadata
          } else {
            logger.info('[Dropbox Upload] Folder created successfully')
          }
        }
      } catch (error) {
        logger.warn('[Dropbox Upload] Error checking/creating folder, continuing with upload:', error)
      }
    }

    // Upload the file to Dropbox
    const uploadResponse = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${decryptedToken}`,
        'Dropbox-API-Arg': JSON.stringify({
          path: fullPath,
          mode: 'add',
          autorename: true,
          mute: false
        }),
        'Content-Type': 'application/octet-stream'
      },
      body: fileData
    })

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text()
      throw new Error(`Failed to upload file to Dropbox: ${errorText}`)
    }

    const uploadResult = await uploadResponse.json()

    logger.info('[Dropbox Upload] File uploaded successfully:', uploadResult)

    return {
      success: true,
      output: {
        fileId: uploadResult.id,
        fileName: uploadResult.name,
        path: uploadResult.path_display,
        size: uploadResult.size,
        clientModified: uploadResult.client_modified,
        serverModified: uploadResult.server_modified,
        rev: uploadResult.rev,
        contentHash: uploadResult.content_hash,
        isDownloadable: uploadResult.is_downloadable,
        message: `File uploaded successfully to Dropbox: ${uploadResult.path_display}`
      }
    }
  } catch (error: any) {
    logger.error('[Dropbox Upload] Error:', error)
    return {
      success: false,
      error: error.message || 'Failed to upload file to Dropbox'
    }
  }
}