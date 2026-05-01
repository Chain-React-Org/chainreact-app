import { Buffer } from 'buffer'
import { getDecryptedAccessToken, resolveValue, ActionResult } from '@/lib/workflows/actions/core'
import { refreshAndRetry } from '@/lib/workflows/actions/core/refreshAndRetry'
import { buildIdempotencyKey, type HandlerExecutionMeta } from '@/lib/workflows/actions/core/idempotencyKey'
import { hashPayload } from '@/lib/workflows/actions/core/hashPayload'
import { checkReplay, recordFired } from '@/lib/workflows/actions/core/sessionSideEffects'
import {
  deleteTempAttachments,
  scheduleTempAttachmentCleanup,
  uploadTempAttachmentToSupabase
} from './supabaseAttachment'
import { logger } from '@/lib/utils/logger'

const TABLE_SCHEMA_CACHE = new Map<string, { fetchedAt: number; fields: Set<string> }>()
const TABLE_SCHEMA_TTL = 5 * 60 * 1000

export interface UploadContext {
  accessToken: string
  baseId: string
  tableId: string
  tableName: string
}

interface ParsedDataUrl {
  mimeType: string
  base64Data: string
}

export type AirtableAttachment = Record<string, any>

async function getAirtableTableFieldNames(
  accessToken: string,
  baseId: string,
  tableName: string
): Promise<Set<string> | null> {
  const normalizedTableName = (tableName || '').trim()
  const cacheKey = `${baseId}:${normalizedTableName}`.toLowerCase()
  const cached = TABLE_SCHEMA_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < TABLE_SCHEMA_TTL) {
    return cached.fields
  }

  try {
    const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText)
      logger.info(`⚠️ [Airtable] Failed to fetch table schema (${res.status}): ${errText}`)
      return null
    }

    const payload = await res.json().catch(() => null)
    const tables: Array<{ id: string; name: string; fields?: Array<{ name: string }> }> = payload?.tables || []
    const loweredName = normalizedTableName.toLowerCase()
    const table = tables.find((t) => {
      if (!normalizedTableName) return false
      if (t.id === normalizedTableName) return true
      return t.name?.toLowerCase() === loweredName
    })

    if (!table?.fields) {
      logger.info('[Airtable] Table schema response did not include fields for', normalizedTableName)
      return null
    }

    const fieldSet = new Set<string>(table.fields.map((field) => field.name))
    TABLE_SCHEMA_CACHE.set(cacheKey, { fetchedAt: Date.now(), fields: fieldSet })
    return fieldSet
  } catch (error) {
    logger.error('[Airtable] Error fetching table schema:', error)
    return null
  }
}

function parseDataUrl(value: string): ParsedDataUrl | null {
  const dataUrlPattern = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/i
  const match = value.match(dataUrlPattern)
  if (!match) return null

  return {
    mimeType: match[1] || 'application/octet-stream',
    base64Data: match[2]
  }
}

function guessFileExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase()
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg'
  if (normalized.includes('png')) return 'png'
  if (normalized.includes('gif')) return 'gif'
  if (normalized.includes('webp')) return 'webp'
  if (normalized.includes('svg')) return 'svg'
  if (normalized.includes('pdf')) return 'pdf'
  if (normalized.includes('json')) return 'json'
  if (normalized.includes('plain')) return 'txt'
  return 'bin'
}

function buildDefaultFilename(fieldName: string, index: number, extension: string): string {
  const safeField = fieldName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_.]/g, '')
    .replace(/-{2,}/g, '-') || 'attachment'
  return `${safeField}-${Date.now()}-${index}.${extension}`
}

export function ensureArray<T>(value: T | T[]): T[] {
  if (Array.isArray(value)) return value
  return [value]
}

function tryParseJson(value: string): any {
  try {
    return JSON.parse(value)
  } catch (err) {
    return null
  }
}

export function extractAttachmentCandidates(value: any): any[] | null {
  if (!value && value !== 0) return null

  if (Array.isArray(value)) {
    const attachmentLikeEntries = value.filter((entry) => {
      if (!entry && entry !== 0) return false

      if (typeof entry === 'string') {
        const trimmed = entry.trim()
        return (
          trimmed.startsWith('http://') ||
          trimmed.startsWith('https://') ||
          trimmed.startsWith('data:') ||
          trimmed.startsWith('{') ||
          trimmed.startsWith('[')
        )
      }

      if (typeof entry === 'object') {
        if (Array.isArray(entry)) {
          return extractAttachmentCandidates(entry) !== null
        }

        return Boolean(
          entry?.url ||
            entry?.dataUrl ||
            entry?.dataURL ||
            entry?.data ||
            entry?.base64 ||
            entry?.base64Data
        )
      }

      return false
    })

    return attachmentLikeEntries.length > 0 ? attachmentLikeEntries : null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
      return [trimmed]
    }

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const parsed = tryParseJson(trimmed)
      if (parsed !== null && parsed !== undefined) {
        return extractAttachmentCandidates(parsed) || ensureArray(parsed)
      }
    }

    return null
  }

  if (typeof value === 'object') {
    if (value === null) return null

    if (Array.isArray(value.attachments)) {
      return value.attachments
    }

    if (
      value.url ||
      value.dataUrl ||
      value.dataURL ||
      value.data ||
      value.base64 ||
      value.base64Data
    ) {
      return [value]
    }
  }

  return null
}

export async function uploadAirtableAttachment(
  dataUrl: string,
  fieldName: string,
  index: number,
  _context: UploadContext,
  cleanupPaths: string[],
  explicitFilename?: string,
  fieldId?: string
): Promise<AirtableAttachment> {
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) {
    throw new Error(`Invalid data URL provided for field "${fieldName}"`)
  }

  const { mimeType, base64Data } = parsed
  const buffer = Buffer.from(base64Data, 'base64')

  if (!buffer.length) {
    throw new Error(`No attachment data found for field "${fieldName}"`)
  }

  const extension = guessFileExtension(mimeType)
  const fileName = explicitFilename || buildDefaultFilename(fieldName, index, extension)

  logger.info(`📎 [Airtable] Uploading temporary attachment for "${fieldName}" via Supabase`)

  const { url: fileUrl, filePath } = await uploadTempAttachmentToSupabase(buffer, fileName, mimeType)
  cleanupPaths.push(filePath)

  logger.info(
    `📎 [Airtable] Supabase temporary attachment ready for "${fieldName}" at ${filePath}`
  )

  return {
    url: fileUrl,
    filename: fileName.replace(/\s+/g, '_')
  }
}

export async function resolveTableId(
  baseId: string,
  tableName: string,
  explicitTableId: string | undefined,
  accessToken: string
): Promise<string | null> {
  if (explicitTableId) {
    return explicitTableId
  }

  if (!tableName) {
    return null
  }

  const normalized = tableName.trim()
  const isLikelyId = normalized.toLowerCase().startsWith('tbl')

  try {
    const response = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}))
      logger.warn(
        `⚠️ [Airtable] Failed to resolve table ID for ${tableName}: ${response.status} - ${errorPayload.error?.message || response.statusText}`
      )
      return null
    }

    const data = await response.json()
    const tables: Array<{ id: string; name: string }> = data?.tables || []
    const lowered = normalized.toLowerCase()
    const match = tables.find((table) => {
      if (table.name?.toLowerCase() === lowered) return true
      if (table.id === normalized) return true
      return false
    })

    if (match?.id) {
      return match.id
    }

    if (isLikelyId) {
      return normalized
    }

    logger.warn(`⚠️ [Airtable] Unable to locate table ID for name "${tableName}" in base ${baseId}`)
  } catch (error) {
    logger.error(`❌ [Airtable] Error resolving table ID for ${tableName}:`, error)
  }

  return null
}

export async function resolveAttachmentEntry(
  entry: any,
  fieldName: string,
  index: number,
  context: UploadContext,
  cleanupPaths: string[]
): Promise<AirtableAttachment | null> {
  if (!entry) return null

  // Handle strings (URL, data URL, or JSON string)
  if (typeof entry === 'string') {
    const trimmed = entry.trim()

    if (!trimmed) return null

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const filename = trimmed.split('/').pop() || 'attachment'
      return { url: trimmed, filename }
    }

    if (trimmed.startsWith('data:')) {
      return uploadAirtableAttachment(trimmed, fieldName, index, context, cleanupPaths)
    }

    if ((trimmed.startsWith('{') || trimmed.startsWith('['))) {
      const parsed = tryParseJson(trimmed)
      if (parsed) {
        return resolveAttachmentEntry(parsed, fieldName, index, context, cleanupPaths)
      }
    }

    return null
  }

  // Handle plain objects
  if (typeof entry === 'object') {
    if (Array.isArray(entry)) {
      // Flatten nested arrays
      for (const nested of entry) {
        const resolved = await resolveAttachmentEntry(nested, fieldName, index, context, cleanupPaths)
        if (resolved) return resolved
      }
      return null
    }

    if (entry.url) {
      const urlString = String(entry.url).trim()

      if (urlString.startsWith('data:')) {
        return uploadAirtableAttachment(
          urlString,
          fieldName,
          index,
          context,
          cleanupPaths,
          entry.filename || entry.name,
          entry.fieldId
        )
      }

      const attachment: AirtableAttachment = {
        url: urlString,
        filename: entry.filename || entry.name || entry.title || urlString.split('/').pop() || 'attachment'
      }

      if (entry.type) attachment.type = entry.type
      if (entry.size) attachment.size = entry.size
      if (entry.id) attachment.id = entry.id
      if (entry.thumbnails) attachment.thumbnails = entry.thumbnails
      if (entry.expirationTime) attachment.expirationTime = entry.expirationTime
      if (entry.expiration_time) attachment.expirationTime = entry.expiration_time

      return attachment
    }

    const dataUrl = entry.dataUrl || entry.dataURL || entry.data || entry.base64 || entry.base64Data
    if (typeof dataUrl === 'string') {
      if (dataUrl.startsWith('data:')) {
        return uploadAirtableAttachment(
          dataUrl,
          fieldName,
          index,
          context,
          cleanupPaths,
          entry.filename || entry.name,
          entry.fieldId
        )
      }

      const mime = entry.contentType || entry.mimeType || entry.type
      const trimmed = dataUrl.trim()
      if (mime && /^[a-z0-9+/=]+$/i.test(trimmed.replace(/\s+/g, ''))) {
        const normalized = trimmed.replace(/\s+/g, '')
        const constructedDataUrl = `data:${mime};base64,${normalized}`
        return uploadAirtableAttachment(
          constructedDataUrl,
          fieldName,
          index,
          context,
          cleanupPaths,
          entry.filename || entry.name,
          entry.fieldId
        )
      }
    }

    // If object already looks like an Airtable attachment, return as-is
    if (entry.id && entry.type && entry.size && entry.url) {
      return entry
    }
  }

  return null
}

/**
 * Creates a new record in an Airtable table
 *
 * For attachment fields (images, files, etc.):
 * - Supports direct URLs to hosted files
 * - Supports data URLs/base64 strings via Airtable's attachment upload endpoint
 *
 * Attachment field format:
 * - URL string: "https://example.com/file.pdf"
 * - Base64/data URL string: "data:image/png;base64,iVBOR..."
 * - Object with url/filename or dataUrl/base64 fields
 * - Pre-formatted array: [{ url: "https://...", filename: "file.pdf" }]
 */


export async function createAirtableRecord(
  config: any,
  userId: string,
  input: Record<string, any>,
  meta?: HandlerExecutionMeta,
): Promise<ActionResult> {
  // Q8d — testMode interception.
  if (meta?.testMode) {
    return {
      success: true,
      output: { simulated: true, provider: 'airtable' },
      message: 'Simulated in test mode — no provider call made',
    }
  }

  const cleanupPaths: string[] = []
  let recordCreated = false

  try {
    // Only log essential info, not the entire config
    logger.info("📊 [Airtable] Creating record...")

    // Validate config object
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid configuration provided')
    }

    const accessToken = await getDecryptedAccessToken(userId, "airtable")

    const baseId = resolveValue(config.baseId, input)
    const tableName = resolveValue(config.tableName, input)
    const tableId = resolveValue(config.tableId, input)

    // Extract fields from config - they may be stored as airtable_field_* keys
    const fields: Record<string, any> = {}
    let fieldCount = 0

    try {
      for (const [key, value] of Object.entries(config)) {
        if (key.startsWith('airtable_field_')) {
          // Remove the airtable_field_ prefix and convert underscores back to spaces
          // Field names like "Tasks labels" become "Tasks_labels" in form keys, so we need to restore spaces
          let fieldName = key.replace('airtable_field_', '')
          fieldName = fieldName.replace(/_/g, ' ')

          // Only store primitive values or simple objects, not functions or complex objects
          if (value !== undefined && typeof value !== 'function') {
            fields[fieldName] = value
            fieldCount++
          }
        }
      }
    } catch (err) {
      logger.error("Error extracting fields from config:", err)
    }

    // Also check for a direct fields object (fallback to old structure)
    const directFields = config.fields || {}
    if (Object.keys(directFields).length > 0) {
      Object.assign(fields, directFields)
      fieldCount += Object.keys(directFields).length
    }

    logger.info(`📊 [Airtable] Found ${fieldCount} fields to process`)

    if (!baseId || !tableName) {
      const missingFields = []
      if (!baseId) missingFields.push("Base ID")
      if (!tableName) missingFields.push("Table Name")

      const message = `Missing required fields for creating record: ${missingFields.join(", ")}`
      logger.error(message)
      return { success: false, message }
    }

    const resolvedTableId = await resolveTableId(baseId, tableName, tableId, accessToken)

    if (resolvedTableId) {
      logger.info(
        `📎 [Airtable] Using tableId ${resolvedTableId} for table "${tableName}" in base ${baseId}`
      )
    } else {
      logger.info('📎 [Airtable] Proceeding without resolved tableId for attachment upload context')
    }

    // Fetch table schema to get field types and date formats
    let tableSchema: any = null
    try {
      const schemaUrl = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`
      const schemaResponse = await fetch(schemaUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      })

      if (schemaResponse.ok) {
        const schemaResult = await schemaResponse.json()
        tableSchema = schemaResult.tables?.find((t: any) => t.name === tableName)
        if (tableSchema) {
          logger.info(`📊 [Airtable] Retrieved table schema with ${tableSchema.fields?.length || 0} fields`)
        }
      }
    } catch (error) {
      logger.info('📊 [Airtable] Could not fetch table schema, proceeding without field type information')
    }

    // Resolve field values using template variables
    const resolvedFields: Record<string, any> = {}
    const attachmentFields: string[] = []
    const attachmentErrors: string[] = []
    const skippedFields: string[] = []

    const uploadContext: UploadContext = {
      accessToken,
      baseId,
      tableId: resolvedTableId || tableId || tableName,
      tableName: tableName
    }

    // Helper function to format date/datetime values based on field schema
    const formatDateForAirtable = (value: any, fieldInfo: any): any => {
      if (!fieldInfo || !value) return value

      const fieldType = fieldInfo.type

      // Only process date and dateTime fields
      if (fieldType !== 'date' && fieldType !== 'dateTime') {
        return value
      }

      // Convert to Date object if it's a string
      let date: Date
      if (typeof value === 'string') {
        // Handle ISO strings like "2025-11-13T20:59:23.844Z"
        date = new Date(value)
        if (isNaN(date.getTime())) {
          logger.info(`📊 [Airtable] Invalid date value for field "${fieldInfo.name}": ${value}`)
          return value
        }
      } else if (value instanceof Date) {
        date = value
      } else {
        return value
      }

      // Format based on field type
      if (fieldType === 'date') {
        // Date-only field: format as YYYY-MM-DD
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        const formatted = `${year}-${month}-${day}`
        logger.info(`📊 [Airtable] Formatted date field "${fieldInfo.name}": ${formatted}`)
        return formatted
      } else if (fieldType === 'dateTime') {
        // DateTime field: format as ISO 8601 string
        // Airtable accepts ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
        const formatted = date.toISOString()
        logger.info(`📊 [Airtable] Formatted datetime field "${fieldInfo.name}": ${formatted}`)
        return formatted
      }

      return value
    }

    for (const [fieldName, fieldValue] of Object.entries(fields)) {
      if (fieldValue !== undefined && fieldValue !== null && fieldValue !== '') {
        let resolved = resolveValue(fieldValue, input)

        // IMPORTANT: Clean up linked record fields FIRST, before any other processing
        // Strip display values (format: "recXXX::Display Name" -> "recXXX")
        if (Array.isArray(resolved)) {
          resolved = resolved.map((v: any) => {
            if (typeof v === 'string' && v.includes('::')) {
              const cleaned = v.split('::')[0]
              logger.info(`📊 [Airtable] Cleaned linked record for "${fieldName}": "${v}" -> "${cleaned}"`)
              return cleaned
            }
            return v
          })
        } else if (typeof resolved === 'string' && resolved.includes('::')) {
          const original = resolved
          resolved = resolved.split('::')[0]
          logger.info(`📊 [Airtable] Cleaned linked record for "${fieldName}": "${original}" -> "${resolved}"`)
        }

        // Check if we have schema information for this field
        const fieldInfo = tableSchema?.fields?.find((f: any) => f.id === fieldName || f.name === fieldName)

        // Format date/datetime fields based on schema
        if (fieldInfo && (fieldInfo.type === 'date' || fieldInfo.type === 'dateTime')) {
          resolved = formatDateForAirtable(resolved, fieldInfo)
        }

        // Check if this is likely an attachment field
        // Need to handle field names with spaces properly
        const normalizedFieldName = fieldName.replace(/_/g, ' ').toLowerCase()
        const isLikelyAttachment =
          normalizedFieldName.includes('image') ||
          normalizedFieldName.includes('photo') ||
          normalizedFieldName.includes('attachment') ||
          normalizedFieldName.includes('file') ||
          normalizedFieldName.includes('document') ||
          normalizedFieldName.includes('picture') ||
          normalizedFieldName.includes('media')

        // Handle attachment fields
        const candidateEntries = extractAttachmentCandidates(resolved)

        if ((isLikelyAttachment || candidateEntries) && resolved) {
          logger.info(
            `📊 [Airtable] Processing attachment field "${fieldName}" (${Array.isArray(candidateEntries) ? candidateEntries.length : 1} value(s))`
          )

          const entries = candidateEntries ?? ensureArray(resolved)
          const attachments: AirtableAttachment[] = []
          let hadAttachmentIssue = false

          for (let index = 0; index < entries.length; index++) {
            const entry = entries[index]
            try {
              const attachment = await resolveAttachmentEntry(
                entry,
                fieldName,
                index,
                uploadContext,
                cleanupPaths
              )
              if (attachment) {
                attachments.push(attachment)
              } else {
                logger.info(`📊 [Airtable] Ignored attachment entry ${index + 1} for field "${fieldName}" (unrecognized format)`)
              }
            } catch (attachmentError) {
              hadAttachmentIssue = true
              attachmentErrors.push(fieldName)
              logger.error(`❌ [Airtable] Error processing attachment for field "${fieldName}":`, attachmentError)
            }
          }

          if (attachments.length > 0) {
            resolvedFields[fieldName] = attachments
            attachmentFields.push(fieldName)
            logger.info(
              `📊 [Airtable] Prepared ${attachments.length} attachment(s) for field "${fieldName}"`
            )
            continue
          }

          if (hadAttachmentIssue) {
            skippedFields.push(fieldName)
            logger.info(`📊 [Airtable] Skipping field "${fieldName}" due to attachment processing errors`)
            continue
          }

        }

        // Regular fields - add non-empty resolved values
        if (resolved !== undefined && resolved !== null && resolved !== '') {
          // Unwrap single-element arrays for non-attachment fields
          // EXCEPT for linked record fields and multiselect fields which MUST be arrays
          // This handles cases where the config stores values as arrays but the field expects a single value
          let finalValue = resolved

          // Check if field name suggests it should remain an array (linked records, multiselects)
          const shouldStayArray = Array.isArray(resolved) && (
            // Don't unwrap if it's already multiple elements
            resolved.length > 1 ||
            // Don't unwrap if every element starts with "rec" (likely Airtable record IDs)
            (resolved.length > 0 && resolved.every((v: any) => typeof v === 'string' && v.startsWith('rec')))
          )

          if (Array.isArray(resolved) && resolved.length === 1 && !shouldStayArray) {
            finalValue = resolved[0]
            logger.info(`📊 [Airtable] Unwrapped single-element array for field "${fieldName}"`)
          }

          // Final safety check: if this is base64 data that wasn't detected as an attachment field,
          // skip it to prevent API errors
          if (typeof finalValue === 'string' && finalValue.startsWith('data:') && finalValue.includes('base64,')) {
            logger.info(`📊 [Airtable] Field "${fieldName}" contains base64 data but was not recognized as attachment`)
            logger.info(`📊 [Airtable] Skipping to prevent invalid payload. Please rename field or verify configuration.`)
            skippedFields.push(fieldName)
            continue
          }

          // Additional check for very large string data that might cause issues
          if (typeof finalValue === 'string' && finalValue.length > 100000) {
            logger.info(`📊 [Airtable] Field "${fieldName}" contains very large data (${(finalValue.length / 1024).toFixed(1)}KB) - skipping`)
            skippedFields.push(fieldName)
            continue
          }

          // Use the value as-is without any case transformation
          resolvedFields[fieldName] = finalValue
        }
      }
    }

    if (attachmentFields.length > 0) {
      logger.info(`📊 [Airtable] Prepared attachment fields: ${attachmentFields.join(', ')}`)
    }
    if (attachmentErrors.length > 0) {
      logger.info(`📊 [Airtable] Encountered attachment issues with: ${[...new Set(attachmentErrors)].join(', ')}`)
    }

    // Remove any fields that do not exist in the Airtable schema to avoid 422 errors
    const validFieldNames = await getAirtableTableFieldNames(accessToken, baseId, tableName)
    if (validFieldNames) {
      for (const fieldName of Object.keys(resolvedFields)) {
        if (!validFieldNames.has(fieldName)) {
          skippedFields.push(fieldName)
          delete resolvedFields[fieldName]
        }
      }
    }

    if (skippedFields.length > 0) {
      logger.info(`📊 [Airtable] Skipped fields: ${skippedFields.join(', ')}`)
    }
    logger.info(`📊 [Airtable] Sending ${Object.keys(resolvedFields).length} fields to API`)
    logger.info(`📊 [Airtable] Field names being sent: ${Object.keys(resolvedFields).join(', ')}`)


    // Create the record in Airtable
    const requestBody = {
      fields: resolvedFields,
    }

    logger.info(`📊 [Airtable] Sending request to table: ${tableName}`)

    // Q4 — within-session idempotency. Hash the resolved record body +
    // table identifiers. Done AFTER attachment uploads complete so the
    // hash reflects the final attachment-resolved field values.
    const idempotencyKey = buildIdempotencyKey(meta)
    const payloadHash = idempotencyKey
      ? hashPayload({
          baseId,
          tableName,
          tableId: resolvedTableId ?? null,
          fields: resolvedFields,
        })
      : ''

    if (idempotencyKey) {
      const replay = await checkReplay(idempotencyKey, payloadHash)
      if (replay.kind === 'cached') return replay.result
      if (replay.kind === 'mismatch') {
        return {
          success: false,
          message: 'This action was already executed for this session with different input.',
          error: 'PAYLOAD_MISMATCH',
        }
      }
    }

    // Q3 — wrap the create-record POST in refreshAndRetry. Airtable is
    // OAuth-with-refresh; on 401 the wrapper refreshes once and retries.
    const writeResult = await refreshAndRetry({
      provider: 'airtable',
      userId,
      accessToken,
      call: async (token) =>
        fetch(
          `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
          }
        ),
    })

    if (!writeResult.success) {
      throw new Error(writeResult.message)
    }

    const response = writeResult.data

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage = errorData.error?.message || response.statusText

      // Enhanced error message for unknown field errors
      if (errorMessage.includes('Unknown field name')) {
        const fieldMatch = errorMessage.match(/Unknown field name: "([^"]+)"/)
        const unknownField = fieldMatch ? fieldMatch[1] : 'unknown'
        logger.error(`❌ [Airtable] Field "${unknownField}" does not exist in table "${tableName}"`)
        logger.error(`📊 [Airtable] Available fields being sent: ${Object.keys(resolvedFields).join(', ')}`)
        throw new Error(
          `Airtable field mismatch: The field "${unknownField}" does not exist in your Airtable table "${tableName}". ` +
          `Please either add this field to your Airtable table or remove it from the workflow configuration.`
        )
      }

      throw new Error(`Failed to create record: ${response.status} - ${errorMessage}`)
    }

    const result = await response.json()
    logger.info(`📊 [Airtable] Record created successfully with ID: ${result.id}`)
    recordCreated = true

    const actionResult: ActionResult = {
      success: true,
      output: {
        recordId: result.id,
        fields: result.fields,
        createdTime: result.createdTime,
        tableName: tableName,
        baseId: baseId
      },
      message: `Successfully created record in ${tableName}`
    }

    if (idempotencyKey) {
      await recordFired(idempotencyKey, actionResult, payloadHash, {
        provider: 'airtable',
        externalId: result.id ?? null,
      })
    }

    return actionResult

  } catch (error: any) {
    logger.error("Airtable create record error:", error)
    return {
      success: false,
      error: error.message || "An unexpected error occurred while creating the record"
    }
  } finally {
    if (cleanupPaths.length > 0) {
      if (recordCreated) {
        logger.info(
          `🧹 [Airtable] Scheduling cleanup for ${cleanupPaths.length} temporary attachment(s)`
        )
        scheduleTempAttachmentCleanup(cleanupPaths)
      } else {
        try {
          await deleteTempAttachments(cleanupPaths)
          logger.info(
            `🧹 [Airtable] Removed ${cleanupPaths.length} temporary attachment(s) after failure`
          )
        } catch (cleanupError) {
          logger.error('❌ [Airtable] Failed to remove temporary attachments:', cleanupError)
        }
      }
    }
  }
}
