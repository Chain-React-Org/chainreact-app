import { ActionResult } from '../core/executeWait'
import { getDecryptedAccessToken } from '../core/getDecryptedAccessToken'
import { ExecutionContext } from '../../execution/types'

import { logger } from '@/lib/utils/logger'

const NOTION_API_VERSION = "2022-06-28"
const NOTION_TIMEOUT_MS = 30000
const NOTION_RETRY_BASE_DELAY_MS = 1000
const NOTION_RETRY_MAX_ATTEMPTS = 3
const NOTION_RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504])

function normalizeNotionId(id?: string | null) {
  if (!id || typeof id !== 'string') {
    return id
  }
  return id.replace(/-/g, '')
}

function parseBoolean(value: any) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true
    if (['false', '0', 'no', 'n'].includes(normalized)) return false
  }
  return Boolean(value)
}

function parseMultiSelect(value: any) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((v) => (typeof v === 'string' ? v : String(v)))
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  }
  return []
}

function formatNotionPropertyValue(propertyType: string, value: any) {
  switch (propertyType) {
    case 'title':
      return { title: [{ type: 'text', text: { content: value ?? '' } }] }
    case 'rich_text':
      return { rich_text: [{ type: 'text', text: { content: value ?? '' } }] }
    case 'number': {
      const num = value === '' || value === null || value === undefined ? null : Number(value)
      if (num !== null && Number.isNaN(num)) {
        throw new Error('Search value must be a number for this property')
      }
      return { number: num }
    }
    case 'checkbox':
      return { checkbox: parseBoolean(value) }
    case 'select':
      return { select: value ? { name: value } : null }
    case 'status':
      return { status: value ? { name: value } : null }
    case 'multi_select': {
      const values = parseMultiSelect(value)
      return { multi_select: values.map((name) => ({ name })) }
    }
    case 'date':
      return value ? { date: { start: value } } : { date: null }
    case 'email':
      return { email: value || null }
    case 'phone_number':
      return { phone_number: value || null }
    case 'url':
      return { url: value || null }
    case 'people':
      // People property requires array of objects with 'id' field
      // Value might be array of user objects (with id/name), user IDs, or names
      if (!value || (Array.isArray(value) && value.length === 0)) {
        return { people: [] }
      }
      const peopleArray = Array.isArray(value) ? value : [value]
      // Process each person entry
      const peopleObjects = peopleArray.map((person: any) => {
        if (typeof person === 'object' && person.id) {
          // Already has id - use it directly
          return { object: 'user', id: person.id }
        }
        // If it's a string that looks like a UUID, treat it as an ID
        if (typeof person === 'string' && /^[0-9a-f-]{32,36}$/i.test(person)) {
          return { object: 'user', id: person }
        }
        // For plain names, we can't resolve without user lookup
        // This shouldn't happen if pageBlocks returns proper objects
        logger.warn(`People property received name instead of ID: ${person}. This entry will be skipped.`)
        return null
      }).filter(Boolean)
      return { people: peopleObjects }
    case 'relation':
      // Relation property requires array of objects with 'id' field
      if (!value || (Array.isArray(value) && value.length === 0)) {
        return { relation: [] }
      }
      const relationArray = Array.isArray(value) ? value : [value]
      const relationObjects = relationArray.map((item: any) => {
        if (typeof item === 'object' && item.id) {
          return { id: item.id }
        }
        if (typeof item === 'string') {
          return { id: item }
        }
        return null
      }).filter(Boolean)
      return { relation: relationObjects }
    case 'files':
      // Files property - typically read-only from UI
      return { files: [] }
    default:
      return { rich_text: [{ type: 'text', text: { content: value ?? '' } }] }
  }
}

function buildFilterForProperty(propertyType: string, propertyName: string, searchValue: any) {
  const filter: any = { property: propertyName }

  switch (propertyType) {
    case 'title':
      filter.title = { equals: searchValue ?? '' }
      break
    case 'rich_text':
      filter.rich_text = { equals: searchValue ?? '' }
      break
    case 'number': {
      const num = Number(searchValue)
      if (Number.isNaN(num)) {
        throw new Error('Search value must be a number for this property')
      }
      filter.number = { equals: num }
      break
    }
    case 'checkbox':
      filter.checkbox = { equals: parseBoolean(searchValue) }
      break
    case 'select':
      filter.select = { equals: searchValue ?? '' }
      break
    case 'status':
      filter.status = { equals: searchValue ?? '' }
      break
    case 'multi_select':
      filter.multi_select = { contains: searchValue ?? '' }
      break
    case 'date':
      filter.date = { equals: searchValue ?? '' }
      break
    case 'email':
      filter.email = { equals: searchValue ?? '' }
      break
    case 'phone_number':
      filter.phone_number = { equals: searchValue ?? '' }
      break
    case 'url':
      filter.url = { equals: searchValue ?? '' }
      break
    default:
      filter.rich_text = { equals: searchValue ?? '' }
      break
  }

  return filter
}

function resolveDatabaseProperty(database: any, identifier: string) {
  if (!database?.properties || !identifier) return null

  // Try to decode the identifier in case it's URL-encoded
  let decodedIdentifier = identifier
  try {
    decodedIdentifier = decodeURIComponent(identifier)
  } catch (e) {
    // Ignore decode errors
  }

  logger.info('[Notion resolveDatabaseProperty] Looking up property', {
    identifier,
    decodedIdentifier,
    availableProperties: Object.entries(database.properties).map(([name, prop]: [string, any]) => ({
      name,
      id: prop.id
    }))
  })

  for (const [name, property] of Object.entries<any>(database.properties)) {
    // Check both raw and decoded identifier against property id and name
    // Also do case-insensitive name matching
    if (property.id === identifier ||
        property.id === decodedIdentifier ||
        name === identifier ||
        name === decodedIdentifier ||
        name.toLowerCase() === identifier.toLowerCase() ||
        name.toLowerCase() === decodedIdentifier.toLowerCase()) {
      return { name, property }
    }
  }
  return null
}

/**
 * Output Schema Type Definition
 * Defines the structure of outputs from action handlers
 */
export interface OutputField {
  name: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description?: string
}

/**
 * Helper function to make Notion API requests
 */
async function notionApiRequest(
  endpoint: string,
  method: string,
  accessToken: string,
  body?: any
) {
  const upperMethod = method.toUpperCase()
  const maxAttempts = ["GET", "PATCH"].includes(upperMethod) ? NOTION_RETRY_MAX_ATTEMPTS : 1

  let lastError: any = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), NOTION_TIMEOUT_MS)

    try {
      const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Notion-Version": NOTION_API_VERSION,
          "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const error: any = new Error(`Notion API error: ${response.status} - ${errorData.message || response.statusText}`)
        error.status = response.status
        if (attempt < maxAttempts && NOTION_RETRYABLE_STATUS.has(response.status)) {
          lastError = error
        } else {
          throw error
        }
      } else {
        return response.json()
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        lastError = new Error(`Notion API timeout: ${method} ${endpoint} did not respond within ${NOTION_TIMEOUT_MS / 1000} seconds`)
      } else if (error?.status && NOTION_RETRYABLE_STATUS.has(error.status)) {
        lastError = error
      } else {
        throw error
      }
    } finally {
      clearTimeout(timeout)
    }

    if (attempt < maxAttempts) {
      const jitter = Math.floor(Math.random() * 500)
      const delay = NOTION_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1) + jitter
      logger.warn('[Notion API] Retrying request', {
        endpoint,
        method: upperMethod,
        attempt,
        nextDelayMs: delay,
        error: lastError?.message || 'unknown'
      })
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError || new Error(`Notion API request failed: ${method} ${endpoint}`)
}

/**
 * Create a new page in Notion
 */
export async function notionCreatePage(
  config: any,
  context: ExecutionContext,
  meta?: import('../core/idempotencyKey').HandlerExecutionMeta,
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")
    
    // Resolve dynamic values
    const parentType = context.dataFlowManager.resolveVariable(config.parent_type)
    const databaseId = context.dataFlowManager.resolveVariable(config.database_id)
    const parentPageId = context.dataFlowManager.resolveVariable(config.parent_page_id)
    const title = context.dataFlowManager.resolveVariable(config.title)
    const properties = context.dataFlowManager.resolveVariable(config.properties) || {}
    
    // Build page payload
    const payload: any = {
      properties: {
        ...properties
      }
    }

    // Set parent
    if (parentType === "database" && databaseId) {
      payload.parent = { database_id: databaseId }
      // For database pages, title goes in the Name property or the title property
      const titleProperty = Object.keys(properties).find(key =>
        properties[key].type === "title" || key.toLowerCase() === "name" || key.toLowerCase() === "title"
      ) || "Name"

      payload.properties[titleProperty] = {
        title: [{ type: "text", text: { content: title } }]
      }
    } else if (parentType === "page" && parentPageId) {
      payload.parent = { page_id: parentPageId }
      payload.properties = {
        title: {
          title: [{ type: "text", text: { content: title } }]
        }
      }
    } else {
      throw new Error("Parent location is required. Please select either a database or a parent page.")
    }

    // Add icon if provided
    if (config.icon_type === "emoji" && config.icon_emoji) {
      payload.icon = { type: "emoji", emoji: config.icon_emoji }
    } else if (config.icon_type === "external" && config.icon_url) {
      payload.icon = { type: "external", external: { url: config.icon_url } }
    }

    // Add cover if provided
    if (config.cover_type === "external" && config.cover_url) {
      payload.cover = { type: "external", external: { url: config.cover_url } }
    }

    // Add content blocks if provided
    if (config.content_blocks) {
      payload.children = config.content_blocks
    }

    // Q4 — within-session idempotency. Hash the resolved Notion page
    // payload (parent + properties + content blocks). Bracketed
    // around the principal create-page POST.
    const { buildIdempotencyKey } = await import('../core/idempotencyKey')
    const { hashPayload } = await import('../core/hashPayload')
    const { checkReplay, recordFired } = await import('../core/sessionSideEffects')
    const idempotencyKey = buildIdempotencyKey(meta)
    const payloadHash = idempotencyKey ? hashPayload(payload) : ''

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

    // Q3 — wrap the create-page call in `refreshAndRetry`. Notion is
    // OAuth-with-refresh; on 401 the wrapper refreshes once, retries, and
    // surfaces a structured auth failure on permanent failure.
    const { refreshAndRetry: notionRefreshAndRetry } = await import('@/lib/workflows/actions/core/refreshAndRetry')
    const wrapped = await notionRefreshAndRetry({
      provider: 'notion',
      userId: context.userId,
      accessToken,
      call: async (token) => notionApiRequest("/pages", "POST", token, payload),
    })
    if (!wrapped.success) {
      return {
        success: false,
        output: {},
        message: wrapped.message,
      }
    }
    const result = wrapped.data

    const actionResult: ActionResult = {
      success: true,
      output: {
        page_id: result.id,
        url: result.url,
        created_time: result.created_time,
        last_edited_time: result.last_edited_time
      }
    }

    if (idempotencyKey) {
      await recordFired(idempotencyKey, actionResult, payloadHash, {
        provider: 'notion',
        externalId: result.id ?? null,
      })
    }

    return actionResult
  } catch (error: any) {
    logger.error("Notion create page error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to create Notion page"
    }
  }
}

/**
 * Update page properties
 */
export async function notionUpdatePage(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")

    const pageId = context.dataFlowManager.resolveVariable(config.page_id)
    let properties = context.dataFlowManager.resolveVariable(config.properties) || {}
    const archived = context.dataFlowManager.resolveVariable(config.archived)
    const title = context.dataFlowManager.resolveVariable(config.title)

    logger.info('[Notion Update] Resolved config', {
      pageId: pageId || 'MISSING',
      hasTitle: !!title,
      propertyCount: Object.keys(properties).length,
      propertyKeys: Object.keys(properties),
      hasArchived: archived !== undefined,
    })

    if (!pageId) {
      logger.error('[Notion Update] No page_id resolved from config', { rawPageId: config.page_id })
      return {
        success: false,
        output: {},
        message: 'No page ID provided for Notion update'
      }
    }

    // Fetch the page to determine if it's a database page and get property schema
    let propertySchema: Record<string, { type: string; name: string }> = {}
    try {
      const getPageStart = Date.now()
      const pageData = await notionApiRequest(`/pages/${pageId}`, "GET", accessToken)
      logger.info('[Notion Update] GET page completed', {
        pageId,
        durationMs: Date.now() - getPageStart,
        parentType: pageData.parent?.type,
      })

      // If this is a database page, fetch the database schema to get property types
      if (pageData.parent?.type === 'database_id') {
        const databaseId = pageData.parent.database_id
        logger.info('Fetching database schema for property types:', databaseId)

        const getSchemaStart = Date.now()
        const dbData = await notionApiRequest(`/databases/${databaseId}`, "GET", accessToken)
        logger.info('[Notion Update] GET database schema completed', {
          databaseId,
          durationMs: Date.now() - getSchemaStart,
          propertyCount: dbData.properties ? Object.keys(dbData.properties).length : 0,
        })
        if (dbData.properties) {
          // Build a map of property ID/name to type (with name for ID-to-name conversion)
          // Store both decoded and URL-encoded forms of IDs since pageFields uses encoded IDs
          for (const [propName, propConfig] of Object.entries(dbData.properties) as any) {
            propertySchema[propName] = { type: propConfig.type, name: propName }
            if (propConfig.id) {
              propertySchema[propConfig.id] = { type: propConfig.type, name: propName }
              // Also store URL-encoded form (pageFields stores IDs like "%7BZs%40" but API returns "{Zs@")
              const encodedId = encodeURIComponent(propConfig.id)
              if (encodedId !== propConfig.id) {
                propertySchema[encodedId] = { type: propConfig.type, name: propName }
              }
            }
          }
          logger.info('Property schema loaded:', Object.keys(propertySchema))
        }
      }
    } catch (error) {
      logger.warn('Could not fetch property schema, will use heuristics:', error)
    }

    // Process properties to ensure proper format
    const processedProperties: any = {}

    // Find the actual title property name from the database schema
    // For database pages, the title property can have any name (e.g., "Title", "Name", etc.)
    let titlePropertyName = 'title' // Default for regular pages
    for (const [propName, propConfig] of Object.entries(propertySchema)) {
      if ((propConfig as any).type === 'title') {
        titlePropertyName = propName
        logger.info(`Found title property name in schema: "${titlePropertyName}"`)
        break
      }
    }

    // Handle title property - it might come from config.title or be in properties
    let titleHandled = false

    // Check if title is provided as a separate config field
    if (title && title !== '') {
      processedProperties[titlePropertyName] = formatNotionPropertyValue('title', title)
      titleHandled = true
      logger.info(`Set title using property name: "${titlePropertyName}"`)
    }

    for (const [key, value] of Object.entries(properties)) {
      // Handle title property specially - check both 'title' key and the actual property name
      if (key === 'title' || key === titlePropertyName || key.toLowerCase() === 'title') {
        if (titleHandled) {
          // Skip if we already handled title from config
          continue
        }
        // Check if title needs formatting
        if (typeof value === 'string' && value !== '') {
          processedProperties[titlePropertyName] = formatNotionPropertyValue('title', value)
        } else if (typeof value === 'object' && value !== null && (value as any).title) {
          // Already formatted, use as-is
          processedProperties[titlePropertyName] = value
        }
        // Skip if empty or invalid
        continue
      }

      // List of keys that are block content, not page properties
      const blockContentKeys = [
        'todo-items',
        'toggle-content',
        'document-embed',
        'code-block',
        'callout-content'
      ]

      // Skip block content fields - these should be handled through blocks API
      if (blockContentKeys.some(blockKey => key.includes(blockKey))) {
        logger.info(`Skipping block content field: ${key}`)
        continue
      }

      // Skip properties that contain '-content' suffix as they're usually block content
      if (key.includes('-content')) {
        logger.info(`Skipping content field: ${key}`)
        continue
      }

      // Skip undefined values (not set), but allow null/empty to clear properties
      if (value === undefined) {
        continue
      }

      // For explicitly cleared values (null or empty string), use type-aware clearing
      if (value === null || value === '') {
        let clearPropInfo = propertySchema[key]
        // Try URL-decoding if direct lookup fails
        if (!clearPropInfo?.type) {
          try {
            const decodedKey = decodeURIComponent(key)
            if (decodedKey !== key) clearPropInfo = propertySchema[decodedKey]
          } catch { /* ignore malformed sequences */ }
        }
        if (clearPropInfo?.type) {
          const propertyKey = clearPropInfo.name || key
          processedProperties[propertyKey] = formatNotionPropertyValue(clearPropInfo.type, value)
          logger.info(`Clearing property ${key} (resolved to "${propertyKey}") as type ${clearPropInfo.type}`)
        } else {
          // Without schema type, skip the property entirely rather than sending raw null
          logger.info(`Skipping empty property ${key} - no schema type found, cannot safely clear`)
        }
        continue
      }

      // Check if this property is already in Notion API format
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const valueObj = value as any
        // Check if this looks like a Notion property (has a type-specific key like 'title', 'rich_text', 'select', etc.)
        const notionPropertyKeys = ['title', 'rich_text', 'number', 'select', 'multi_select', 'date',
                                     'people', 'files', 'checkbox', 'url', 'email', 'phone_number',
                                     'status', 'relation', 'rollup', 'formula', 'created_time',
                                     'created_by', 'last_edited_time', 'last_edited_by']
        const hasNotionKey = notionPropertyKeys.some(nk => nk in valueObj)

        if (hasNotionKey) {
          // Already formatted - resolve property name from schema before using as-is
          let resolvedKey = propertySchema[key]?.name || key
          if (resolvedKey === key) {
            try {
              const decoded = decodeURIComponent(key)
              if (decoded !== key && propertySchema[decoded]?.name) {
                resolvedKey = propertySchema[decoded].name
              }
            } catch { /* ignore */ }
          }
          processedProperties[resolvedKey] = value
          continue
        }

        if (valueObj.items || valueObj.blocks || valueObj.children) {
          // This looks like block content, skip it
          logger.info(`Skipping property ${key} - appears to be block content`)
          continue
        }
      }

      // Look up property type from schema
      const propInfo = propertySchema[key]
      if (propInfo?.type) {
        const propertyKey = propInfo.name || key
        logger.info(`Formatting property ${key} (resolved to "${propertyKey}") as type ${propInfo.type}`)

        // Special handling for people properties - skip if value can't be resolved to IDs
        if (propInfo.type === 'people') {
          const peopleValue = Array.isArray(value) ? value : [value]
          const hasValidIds = peopleValue.some((p: any) =>
            (typeof p === 'object' && p.id) ||
            (typeof p === 'string' && /^[0-9a-f-]{32,36}$/i.test(p))
          )
          if (!hasValidIds && peopleValue.length > 0) {
            logger.info(`Skipping people property ${key} - values are names without IDs, cannot resolve`)
            continue
          }
        }

        processedProperties[propertyKey] = formatNotionPropertyValue(propInfo.type, value)
        continue
      }

      // Try URL-decoding the key and looking it up in the schema
      // (pageFields stores URL-encoded IDs like "%7BZs%40" but schema has decoded IDs like "{Zs@")
      let decodedPropInfo = null
      try {
        const decodedKey = decodeURIComponent(key)
        if (decodedKey !== key) {
          decodedPropInfo = propertySchema[decodedKey]
          if (decodedPropInfo?.type) {
            const propertyKey = decodedPropInfo.name || decodedKey
            logger.info(`Formatting property ${key} (URL-decoded to "${decodedKey}", resolved to "${propertyKey}") as type ${decodedPropInfo.type}`)
            processedProperties[propertyKey] = formatNotionPropertyValue(decodedPropInfo.type, value)
            continue
          }
        }
      } catch {
        // decodeURIComponent can throw on malformed sequences, ignore
      }

      // If property not found in schema even after URL-decoding, skip it
      // Sending unknown property IDs to the Notion API will cause 400 errors
      logger.warn(`Skipping property ${key} - not found in database schema, cannot determine property name`)
    }

    // Debug logging
    logger.debug('Processed properties for Notion update, count:', Object.keys(processedProperties || {}).length)

    // Only include properties in payload if we have any to update
    const payload: any = {}
    if (Object.keys(processedProperties).length > 0) {
      payload.properties = processedProperties
    }

    if (archived !== undefined) {
      payload.archived = archived
    }

    // Handle icon update
    if (config.icon_type === "emoji" && config.icon_emoji) {
      payload.icon = { type: "emoji", emoji: config.icon_emoji }
    } else if (config.icon_type === "external" && config.icon_url) {
      payload.icon = { type: "external", external: { url: config.icon_url } }
    } else if (config.icon_type === "remove") {
      payload.icon = null
    }

    // Handle cover update
    if (config.cover_type === "external" && config.cover_url) {
      payload.cover = { type: "external", external: { url: config.cover_url } }
    } else if (config.cover_type === "remove") {
      payload.cover = null
    }

    // Check if we have anything to update
    if (Object.keys(payload).length === 0) {
      logger.info('[Notion Update] Empty payload — no fields to update', {
        pageId,
        processedPropertyCount: Object.keys(processedProperties).length,
        rawPropertyCount: Object.keys(properties).length,
        rawPropertyKeys: Object.keys(properties),
      })
      return {
        success: true,
        output: {
          page_id: pageId,
          message: 'No changes to apply'
        }
      }
    }

    logger.info('[Notion Update] Sending update to Notion API', {
      pageId,
      propertyKeys: Object.keys(payload.properties || {}),
      propertyCount: Object.keys(payload.properties || {}).length,
      hasIcon: !!payload.icon,
      hasCover: !!payload.cover,
      hasArchived: payload.archived !== undefined,
    })

    const patchStart = Date.now()
    const result = await notionApiRequest(`/pages/${pageId}`, "PATCH", accessToken, payload)
    logger.info('[Notion Update] PATCH update completed', {
      pageId: result.id,
      url: result.url,
      durationMs: Date.now() - patchStart,
    })

    return {
      success: true,
      output: {
        page_id: result.id,
        url: result.url,
        last_edited_time: result.last_edited_time
      }
    }
  } catch (error: any) {
    logger.error('[Notion Update] notionUpdatePage failed', {
      error: error.message || String(error),
      pageId: config.page_id || 'unknown',
      stack: error.stack?.split('\n').slice(0, 3).join('\n'),
    })
    return {
      success: false,
      output: {},
      message: error.message || "Failed to update Notion page"
    }
  }
}

/**
 * Retrieve page details
 */
export async function notionRetrievePage(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")
    const pageId = context.dataFlowManager.resolveVariable(config.page_id)
    
    const result = await notionApiRequest(`/pages/${pageId}`, "GET", accessToken)

    return {
      success: true,
      output: {
        page_id: result.id,
        url: result.url,
        properties: result.properties,
        parent: result.parent,
        created_time: result.created_time,
        last_edited_time: result.last_edited_time,
        archived: result.archived
      }
    }
  } catch (error: any) {
    logger.error("Notion retrieve page error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to retrieve Notion page"
    }
  }
}

/**
 * Archive or unarchive a page
 */
export async function notionArchivePage(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")
    const pageId = context.dataFlowManager.resolveVariable(config.page_id)
    const archived = config.archived === "true"
    
    const result = await notionApiRequest(`/pages/${pageId}`, "PATCH", accessToken, { archived })

    return {
      success: true,
      output: {
        page_id: result.id,
        archived: result.archived
      }
    }
  } catch (error: any) {
    logger.error("Notion archive page error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to archive/unarchive Notion page"
    }
  }
}

/**
 * Create a new database
 */
export async function notionCreateDatabase(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")
    
    const parentType = context.dataFlowManager.resolveVariable(config.parent_type)
    const parentPageId = context.dataFlowManager.resolveVariable(config.parent_page_id)
    const title = context.dataFlowManager.resolveVariable(config.title)
    const description = context.dataFlowManager.resolveVariable(config.description)
    const isInline = config.is_inline === "true"
    const propertiesConfig = context.dataFlowManager.resolveVariable(config.properties_config) || {}
    
    const payload: any = {
      title: [{ type: "text", text: { content: title } }],
      properties: propertiesConfig,
      is_inline: isInline
    }

    // Set parent - Notion API requires type to be explicitly set
    if (parentType === "page" && parentPageId) {
      payload.parent = { type: "page_id", page_id: parentPageId }
    } else {
      payload.parent = { type: "workspace", workspace: true }
    }

    if (description) {
      payload.description = [{ type: "text", text: { content: description } }]
    }

    const result = await notionApiRequest("/databases", "POST", accessToken, payload)

    return {
      success: true,
      output: {
        database_id: result.id,
        url: result.url,
        title: title,
        properties: result.properties
      }
    }
  } catch (error: any) {
    logger.error("Notion create database error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to create Notion database"
    }
  }
}

/**
 * Query a database
 */
export async function notionQueryDatabase(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")
    
    const databaseId = context.dataFlowManager.resolveVariable(config.database_id)
    const filterType = context.dataFlowManager.resolveVariable(config.filter_type)
    const pageSize = parseInt(config.page_size) || 100
    const startCursor = context.dataFlowManager.resolveVariable(config.start_cursor)
    
    const payload: any = {
      page_size: pageSize
    }

    if (startCursor) {
      payload.start_cursor = startCursor
    }

    // Add filter if specified
    if (filterType === "property" && config.filter_condition) {
      payload.filter = config.filter_condition
    }

    // Add sorts if specified
    if (config.sorts) {
      payload.sorts = config.sorts
    }

    const result = await notionApiRequest(`/databases/${databaseId}/query`, "POST", accessToken, payload)

    return {
      success: true,
      output: {
        results: result.results,
        has_more: result.has_more,
        next_cursor: result.next_cursor,
        total_results: result.results.length
      }
    }
  } catch (error: any) {
    logger.error("Notion query database error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to query Notion database"
    }
  }
}

/**
 * Update a database
 */
export async function notionUpdateDatabase(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")

    // Support both 'database' (from schema) and 'database_id' (legacy)
    const rawDatabaseId = context.dataFlowManager.resolveVariable(config.database_id || config.database)
    const databaseId = normalizeNotionId(rawDatabaseId)

    if (!databaseId) {
      throw new Error('Database is required')
    }

    const title = context.dataFlowManager.resolveVariable(config.title)
    const description = context.dataFlowManager.resolveVariable(config.description)
    const propertiesUpdate = context.dataFlowManager.resolveVariable(config.properties_update)
    const archived = config.archived
    
    const payload: any = {}

    if (title) {
      payload.title = [{ type: "text", text: { content: title } }]
    }

    if (description) {
      payload.description = [{ type: "text", text: { content: description } }]
    }

    if (propertiesUpdate) {
      payload.properties = propertiesUpdate
    }

    if (archived !== undefined) {
      payload.archived = archived
    }

    const result = await notionApiRequest(`/databases/${databaseId}`, "PATCH", accessToken, payload)

    return {
      success: true,
      output: {
        database_id: result.id,
        url: result.url,
        last_edited_time: result.last_edited_time
      }
    }
  } catch (error: any) {
    logger.error("Notion update database error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to update Notion database"
    }
  }
}

/**
 * Append blocks to a page
 */
export async function notionAppendBlocks(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")

    const pageId = context.dataFlowManager.resolveVariable(config.page_id)
    const blocks = context.dataFlowManager.resolveVariable(config.blocks)
    const after = context.dataFlowManager.resolveVariable(config.after)

    logger.info('📝 notionAppendBlocks - config:', config)
    logger.info('📝 notionAppendBlocks - resolved blocks:', blocks)

    // Ensure blocks is an array
    const blocksArray = Array.isArray(blocks) ? blocks : []

    // Don't make API call if there are no blocks to append
    if (blocksArray.length === 0) {
      logger.info('📝 notionAppendBlocks - No blocks to append, skipping')
      return {
        success: true,
        output: {
          message: 'No blocks to append',
          page_id: pageId
        }
      }
    }

    const payload: any = {
      children: blocksArray
    }

    if (after) {
      payload.after = after
    }

    const result = await notionApiRequest(`/blocks/${pageId}/children`, "PATCH", accessToken, payload)

    return {
      success: true,
      output: {
        blocks: result.results,
        page_id: pageId
      }
    }
  } catch (error: any) {
    logger.error("Notion append blocks error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to append blocks to Notion page"
    }
  }
}

/**
 * Update a block
 */
export async function notionUpdateBlock(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")
    
    const blockId = context.dataFlowManager.resolveVariable(config.block_id)
    const blockContent = context.dataFlowManager.resolveVariable(config.block_content)
    const archived = config.archived

    logger.info('📝 notionUpdateBlock - Updating block:', {
      blockId,
      blockContent
    })

    const payload: any = blockContent

    if (archived !== undefined) {
      payload.archived = archived
    }

    const result = await notionApiRequest(`/blocks/${blockId}`, "PATCH", accessToken, payload)

    return {
      success: true,
      output: {
        block_id: result.id,
        type: result.type,
        last_edited_time: result.last_edited_time
      }
    }
  } catch (error: any) {
    logger.error("Notion update block error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to update Notion block"
    }
  }
}

/**
 * Delete a block
 */
export async function notionDeleteBlock(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")
    const blockId = context.dataFlowManager.resolveVariable(config.block_id)
    
    const result = await notionApiRequest(`/blocks/${blockId}`, "DELETE", accessToken)

    return {
      success: true,
      output: {
        block_id: result.id,
        archived: true
      }
    }
  } catch (error: any) {
    logger.error("Notion delete block error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to delete Notion block"
    }
  }
}

/**
 * Get block children
 */
export async function notionRetrieveBlockChildren(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")

    const blockId = context.dataFlowManager.resolveVariable(config.block_id)
    const pageSize = parseInt(config.page_size || config.maxBlocks) || 100
    const filterType = context.dataFlowManager.resolveVariable(config.filterType)

    const params = new URLSearchParams({ page_size: pageSize.toString() })
    const result = await notionApiRequest(`/blocks/${blockId}/children?${params}`, "GET", accessToken)

    let children = result.results || []

    // Apply client-side filtering by block type if specified
    // Notion API doesn't support server-side filtering of block children
    if (filterType && Array.isArray(filterType) && filterType.length > 0) {
      children = children.filter((block: any) => filterType.includes(block.type))
      logger.info("[Notion] Filtered blocks by type:", {
        filterType,
        originalCount: result.results?.length || 0,
        filteredCount: children.length
      })
    }

    return {
      success: true,
      output: {
        children,
        blocks: children, // Alias for schema compatibility
        blockCount: children.length,
        pageId: blockId,
        has_more: result.has_more,
        hasMore: result.has_more,
        next_cursor: result.next_cursor
      }
    }
  } catch (error: any) {
    logger.error("Notion retrieve block children error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to retrieve block children"
    }
  }
}

/**
 * List all users
 */
export async function notionListUsers(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")
    const pageSize = parseInt(config.page_size) || 100
    
    const params = new URLSearchParams({ page_size: pageSize.toString() })
    const result = await notionApiRequest(`/users?${params}`, "GET", accessToken)

    return {
      success: true,
      output: {
        users: result.results,
        has_more: result.has_more,
        next_cursor: result.next_cursor
      }
    }
  } catch (error: any) {
    logger.error("Notion list users error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to list Notion users"
    }
  }
}

/**
 * Retrieve user details
 */
export async function notionRetrieveUser(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")
    const userId = context.dataFlowManager.resolveVariable(config.user_id)
    
    const result = await notionApiRequest(`/users/${userId}`, "GET", accessToken)

    return {
      success: true,
      output: {
        user_id: result.id,
        name: result.name,
        email: result.person?.email,
        type: result.type,
        avatar_url: result.avatar_url
      }
    }
  } catch (error: any) {
    logger.error("Notion retrieve user error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to retrieve Notion user"
    }
  }
}

/**
 * Create a comment
 */
export async function notionCreateComment(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")
    
    const parentType = context.dataFlowManager.resolveVariable(config.parent_type)
    const pageId = context.dataFlowManager.resolveVariable(config.page_id)
    const discussionId = context.dataFlowManager.resolveVariable(config.discussion_id)
    const richText = context.dataFlowManager.resolveVariable(config.rich_text)
    
    const payload: any = {
      rich_text: typeof richText === "string" 
        ? [{ type: "text", text: { content: richText } }]
        : richText
    }

    if (parentType === "page" && pageId) {
      payload.parent = { page_id: pageId }
    } else if (parentType === "discussion" && discussionId) {
      payload.discussion_id = discussionId
    }

    const result = await notionApiRequest("/comments", "POST", accessToken, payload)

    return {
      success: true,
      output: {
        comment_id: result.id,
        created_time: result.created_time,
        parent: result.parent
      }
    }
  } catch (error: any) {
    logger.error("Notion create comment error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to create Notion comment"
    }
  }
}

/**
 * Retrieve comments
 */
export async function notionRetrieveComments(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")
    
    const blockId = context.dataFlowManager.resolveVariable(config.block_id)
    const pageSize = parseInt(config.page_size) || 100
    
    const params = new URLSearchParams({ 
      block_id: blockId,
      page_size: pageSize.toString() 
    })
    
    const result = await notionApiRequest(`/comments?${params}`, "GET", accessToken)

    return {
      success: true,
      output: {
        comments: result.results,
        has_more: result.has_more,
        next_cursor: result.next_cursor
      }
    }
  } catch (error: any) {
    logger.error("Notion retrieve comments error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to retrieve Notion comments"
    }
  }
}

/**
 * Search workspace
 */
export async function notionSearch(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")
    
    const query = context.dataFlowManager.resolveVariable(config.query) || ""
    const filterType = context.dataFlowManager.resolveVariable(config.filter_type) || "all"
    const sortDirection = context.dataFlowManager.resolveVariable(config.sort_direction) || "descending"
    const sortTimestamp = context.dataFlowManager.resolveVariable(config.sort_timestamp) || "last_edited_time"
    const pageSize = parseInt(config.page_size) || 100
    
    const payload: any = {
      query,
      page_size: pageSize,
      sort: {
        direction: sortDirection,
        timestamp: sortTimestamp
      }
    }

    if (filterType !== "all") {
      payload.filter = {
        property: "object",
        value: filterType
      }
    }

    const result = await notionApiRequest("/search", "POST", accessToken, payload)

    return {
      success: true,
      output: {
        results: result.results,
        has_more: result.has_more,
        next_cursor: result.next_cursor,
        object: result.object
      }
    }
  } catch (error: any) {
    logger.error("Notion search error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to search Notion workspace"
    }
  }
}

/**
 * Duplicate a page
 */
export async function notionDuplicatePage(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")
    
    const sourcePageId = context.dataFlowManager.resolveVariable(config.source_page_id)
    const destinationType = context.dataFlowManager.resolveVariable(config.destination_type)
    const destinationDatabaseId = context.dataFlowManager.resolveVariable(config.destination_database_id)
    const destinationPageId = context.dataFlowManager.resolveVariable(config.destination_page_id)
    const titleSuffix = context.dataFlowManager.resolveVariable(config.title_suffix) || " (Copy)"
    const includeContent = config.include_content !== false
    const includeChildren = config.include_children === true

    // First, retrieve the source page
    const sourcePage = await notionApiRequest(`/pages/${sourcePageId}`, "GET", accessToken)
    
    // Extract title from properties
    let originalTitle = ""
    const titleProp = Object.values(sourcePage.properties).find((prop: any) => prop.type === "title") as any
    if (titleProp?.title?.[0]?.text?.content) {
      originalTitle = titleProp.title[0].text.content
    }

    // Create new page with copied properties
    const newPagePayload: any = {
      properties: { ...sourcePage.properties }
    }

    // Update title with suffix
    if (titleProp) {
      const titleKey = Object.keys(sourcePage.properties).find(key => 
        sourcePage.properties[key].type === "title"
      )
      if (titleKey) {
        newPagePayload.properties[titleKey] = {
          title: [{ type: "text", text: { content: originalTitle + titleSuffix } }]
        }
      }
    }

    // Set parent based on destination type
    if (destinationType === "same_parent") {
      newPagePayload.parent = sourcePage.parent
    } else if (destinationType === "database" && destinationDatabaseId) {
      newPagePayload.parent = { database_id: destinationDatabaseId }
    } else if (destinationType === "page" && destinationPageId) {
      newPagePayload.parent = { page_id: destinationPageId }
    }

    // Copy icon and cover
    if (sourcePage.icon) {
      newPagePayload.icon = sourcePage.icon
    }
    if (sourcePage.cover) {
      newPagePayload.cover = sourcePage.cover
    }

    // Copy content blocks if requested
    if (includeContent) {
      const blocksResponse = await notionApiRequest(`/blocks/${sourcePageId}/children`, "GET", accessToken)
      if (blocksResponse.results?.length > 0) {
        newPagePayload.children = blocksResponse.results
      }
    }

    // Create the new page
    const newPage = await notionApiRequest("/pages", "POST", accessToken, newPagePayload)

    // TODO: If includeChildren is true, recursively duplicate child pages

    return {
      success: true,
      output: {
        new_page_id: newPage.id,
        url: newPage.url,
        title: originalTitle + titleSuffix
      }
    }
  } catch (error: any) {
    logger.error("Notion duplicate page error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to duplicate Notion page"
    }
  }
}

/**
 * Sync database entries
 */
export async function notionSyncDatabaseEntries(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")
    
    const databaseId = context.dataFlowManager.resolveVariable(config.database_id)
    const lastSyncTime = context.dataFlowManager.resolveVariable(config.last_sync_time)
    const filterChanged = config.filter_changed !== false
    
    const payload: any = {
      page_size: 100
    }

    // If filtering by changes, add timestamp filter
    if (filterChanged && lastSyncTime) {
      payload.filter = {
        timestamp: "last_edited_time",
        last_edited_time: {
          after: lastSyncTime
        }
      }
    }

    const result = await notionApiRequest(`/databases/${databaseId}/query`, "POST", accessToken, payload)
    
    // Categorize results
    const added: any[] = []
    const modified: any[] = []
    
    if (lastSyncTime) {
      const syncDate = new Date(lastSyncTime)
      result.results.forEach((entry: any) => {
        const createdDate = new Date(entry.created_time)
        if (createdDate > syncDate) {
          added.push(entry)
        } else {
          modified.push(entry)
        }
      })
    } else {
      // If no last sync time, all are considered added
      added.push(...result.results)
    }

    return {
      success: true,
      output: {
        added,
        modified,
        deleted: [], // Notion API doesn't provide deleted items directly
        sync_timestamp: new Date().toISOString()
      }
    }
  } catch (error: any) {
    logger.error("Notion sync database entries error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to sync Notion database entries"
    }
  }
}

/**
 * Find or Create Database Item (Upsert pattern)
 * Searches for an item in a database by a property value
 * If found, returns the existing item
 * If not found and createIfNotFound is true, creates a new item
 */
export async function notionFindOrCreateDatabaseItem(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    logger.info("[Notion Find or Create] Received config:", {
      configKeys: Object.keys(config),
      database: config.database,
      database_id: config.database_id,
      searchProperty: config.searchProperty,
      search_property: config.search_property,
      searchValue: config.searchValue,
      search_value: config.search_value,
    })

    const accessToken = await getDecryptedAccessToken(context.userId, "notion")

    // Resolve variables - support both camelCase (from schema) and snake_case
    const rawDatabaseId = context.dataFlowManager.resolveVariable(config.database_id || config.database)
    const databaseId = normalizeNotionId(rawDatabaseId)
    const searchPropertyInput = context.dataFlowManager.resolveVariable(config.search_property || config.searchProperty)
    const searchValue = context.dataFlowManager.resolveVariable(config.search_value || config.searchValue)
    const createIfNotFound = context.dataFlowManager.resolveVariable(config.create_if_not_found ?? config.createIfNotFound) !== 'false'
    let createProperties = context.dataFlowManager.resolveVariable(config.create_properties || config.createProperties) || {}

    if (!databaseId) {
      throw new Error('Database is required')
    }

    if (!searchPropertyInput) {
      throw new Error('Search property is required')
    }

    if (searchValue === undefined || searchValue === null || searchValue === '') {
      throw new Error('Search value is required')
    }

    logger.info("[Notion Find or Create] Starting search", {
      databaseId,
      rawDatabaseId,
      searchProperty: searchPropertyInput,
      searchValue,
      createIfNotFound
    })

    const database = await notionApiRequest(`/databases/${databaseId}`, "GET", accessToken)

    const propertyInfo = resolveDatabaseProperty(database, searchPropertyInput)
    if (!propertyInfo) {
      throw new Error(`Property "${searchPropertyInput}" not found in selected database`)
    }

    const propertyName = propertyInfo.name
    const propertyType = propertyInfo.property?.type || 'rich_text'

    // Step 1: Search for existing item using database query
    const filter = buildFilterForProperty(propertyType, propertyName, searchValue)

    const searchPayload = {
      filter,
      page_size: 1 // We only need to know if one exists
    }

    logger.info("[Notion Find or Create] Searching database", { searchPayload })

    const searchResult = await notionApiRequest(
      `/databases/${databaseId}/query`,
      "POST",
      accessToken,
      searchPayload
    )

    // Step 2: If found, return existing item
    if (searchResult.results && searchResult.results.length > 0) {
      const existingItem = searchResult.results[0]
      logger.info("[Notion Find or Create] Found existing item", { id: existingItem.id })

      return {
        success: true,
        output: {
          found: true,
          created: false,
          page_id: existingItem.id,
          url: existingItem.url,
          properties: existingItem.properties,
          item: existingItem
        },
        message: "Found existing item"
      }
    }

    // Step 3: If not found and createIfNotFound is false, return not found
    if (!createIfNotFound) {
      logger.info("[Notion Find or Create] Item not found, create disabled")
      return {
        success: true,
        output: {
          found: false,
          created: false,
          page_id: null,
          properties: null
        },
        message: "Item not found and creation is disabled"
      }
    }

    // Step 4: Create new item
    logger.info("[Notion Find or Create] Creating new item")

    // Merge search property/value into create properties
    if (typeof createProperties === 'string') {
      if (createProperties.trim() === '') {
        createProperties = {}
      } else {
        try {
          createProperties = JSON.parse(createProperties)
        } catch (error: any) {
          throw new Error(`Invalid JSON for create properties: ${error.message}`)
        }
      }
    }

    if (typeof createProperties !== 'object' || createProperties === null) {
      createProperties = {}
    }

    const finalProperties = {
      ...createProperties,
      [propertyName]: formatNotionPropertyValue(propertyType, searchValue)
    }

    const createPayload = {
      parent: { database_id: databaseId },
      properties: finalProperties
    }

    const newItem = await notionApiRequest("/pages", "POST", accessToken, createPayload)

    logger.info("[Notion Find or Create] Created new item", { id: newItem.id })

    return {
      success: true,
      output: {
        found: false,
        created: true,
        page_id: newItem.id,
        url: newItem.url,
        properties: newItem.properties,
        item: newItem
      },
      message: "Created new item"
    }

  } catch (error: any) {
    logger.error("[Notion Find or Create] Error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to find or create database item"
    }
  }
}

/**
 * Update a database item's properties
 * Allows updating checkboxes, text, status, and other properties on database items
 */
export async function notionUpdateDatabaseItem(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")

    // Get the item ID (this is actually a page ID since database items are pages)
    const rawItemId = context.dataFlowManager.resolveVariable(config.item || config.itemToUpdate)
    const itemId = normalizeNotionId(rawItemId)

    // Get the database ID to fetch schema for property types
    const rawDatabaseId = context.dataFlowManager.resolveVariable(config.database)
    const databaseId = normalizeNotionId(rawDatabaseId)

    // Get properties to update
    let properties = context.dataFlowManager.resolveVariable(config.properties) || {}

    if (!itemId) {
      throw new Error('Item to update is required')
    }

    logger.info("[Notion Update Database Item] Starting update", {
      itemId,
      databaseId,
      propertiesKeys: Object.keys(properties)
    })

    // Fetch database schema to get property types
    let propertySchema: Record<string, { type: string; name: string }> = {}
    if (databaseId) {
      try {
        const dbData = await notionApiRequest(`/databases/${databaseId}`, "GET", accessToken)
        if (dbData.properties) {
          for (const [propName, propConfig] of Object.entries(dbData.properties) as any) {
            propertySchema[propName] = { type: propConfig.type, name: propName }
            // Also map by ID for encoded property names
            if (propConfig.id) {
              propertySchema[propConfig.id] = { type: propConfig.type, name: propName }
            }
          }
          logger.info('[Notion Update Database Item] Property schema loaded:', Object.keys(propertySchema))
        }
      } catch (error) {
        logger.warn('[Notion Update Database Item] Could not fetch database schema, will use heuristics:', error)
      }
    }

    // Process properties to ensure proper Notion API format
    const processedProperties: any = {}

    for (const [key, value] of Object.entries(properties)) {
      // Skip undefined/null values (these mean "don't update this property")
      // Allow empty strings through - they mean "clear this property"
      // Also allow false for checkboxes and 0 for numbers
      if (value === undefined || value === null) {
        continue
      }

      // Check if this property is already in Notion API format
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const valueObj = value as any
        const notionPropertyKeys = ['title', 'rich_text', 'number', 'select', 'multi_select', 'date',
                                     'people', 'files', 'checkbox', 'url', 'email', 'phone_number',
                                     'status', 'relation']
        const hasNotionKey = notionPropertyKeys.some(nk => nk in valueObj)

        if (hasNotionKey) {
          // Already formatted, use as-is
          processedProperties[key] = value
          continue
        }
      }

      // Look up property type from schema
      const propInfo = propertySchema[key]
      if (propInfo?.type) {
        logger.info(`[Notion Update Database Item] Formatting property ${key} as type ${propInfo.type}`)
        processedProperties[propInfo.name || key] = formatNotionPropertyValue(propInfo.type, value)
        continue
      }

      // Fallback: Use heuristics to determine property type
      let inferredType = 'rich_text'

      if (typeof value === 'boolean') {
        inferredType = 'checkbox'
      } else if (typeof value === 'number') {
        inferredType = 'number'
      } else if (Array.isArray(value)) {
        inferredType = 'multi_select'
      } else if (typeof value === 'string') {
        // Check for common patterns
        if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
          inferredType = 'date'
        } else if (value.includes('@') && value.includes('.')) {
          inferredType = 'email'
        } else if (/^https?:\/\//.test(value)) {
          inferredType = 'url'
        } else if (value === 'true' || value === 'false') {
          inferredType = 'checkbox'
        }
      }

      logger.info(`[Notion Update Database Item] Inferred property ${key} as type ${inferredType}`)
      processedProperties[key] = formatNotionPropertyValue(inferredType, value)
    }

    // Check if we have anything to update
    if (Object.keys(processedProperties).length === 0) {
      logger.info('[Notion Update Database Item] No properties to update')
      return {
        success: true,
        output: {
          page_id: itemId,
          message: 'No properties to update'
        }
      }
    }

    logger.debug('[Notion Update Database Item] Sending update for item:', itemId)

    // Make the update request
    const result = await notionApiRequest(`/pages/${itemId}`, "PATCH", accessToken, {
      properties: processedProperties
    })

    logger.info("[Notion Update Database Item] Item updated successfully:", { itemId })

    return {
      success: true,
      output: {
        page_id: result.id,
        url: result.url,
        properties: result.properties,
        last_edited_time: result.last_edited_time
      },
      message: "Database item updated successfully"
    }

  } catch (error: any) {
    logger.error("[Notion Update Database Item] Error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to update database item"
    }
  }
}

/**
 * Archive a database item
 * Sets the archived property to true on a page
 */
export async function notionArchiveDatabaseItem(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    // Get access token
    const { getDecryptedAccessToken } = await import('@/lib/integrations/getDecryptedAccessToken')
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")

    if (!accessToken) {
      return {
        success: false,
        output: {},
        message: "Notion integration not connected. Please connect your Notion account."
      }
    }

    // Resolve variables
    const itemId = context.dataFlowManager.resolveVariable(config.item_id)

    if (!itemId) {
      return {
        success: false,
        output: {},
        message: "Item ID is required to archive a database item"
      }
    }

    logger.info("[Notion Archive Item] Archiving database item:", { itemId })

    // Archive the page by setting archived to true
    const payload = {
      archived: true
    }

    const result = await notionApiRequest(
      `/pages/${itemId}`,
      "PATCH",
      accessToken,
      payload
    )

    logger.info("[Notion Archive Item] Item archived successfully:", { itemId })

    return {
      success: true,
      output: {
        page_id: result.id,
        url: result.url,
        archived: result.archived,
        archived_time: new Date().toISOString(),
        properties: result.properties,
        item: result
      },
      message: "Database item archived successfully"
    }
  } catch (error: any) {
    logger.error("[Notion Archive Item] Error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to archive database item"
    }
  }
}

/**
 * Restore an archived database item
 * Sets the archived property to false on a page
 */
export async function notionRestoreDatabaseItem(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    // Get access token
    const { getDecryptedAccessToken } = await import('@/lib/integrations/getDecryptedAccessToken')
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")

    if (!accessToken) {
      return {
        success: false,
        output: {},
        message: "Notion integration not connected. Please connect your Notion account."
      }
    }

    // Resolve variables
    const itemId = context.dataFlowManager.resolveVariable(config.item_id)

    if (!itemId) {
      return {
        success: false,
        output: {},
        message: "Item ID is required to restore a database item"
      }
    }

    logger.info("[Notion Restore Item] Restoring database item:", { itemId })

    // Restore the page by setting archived to false
    const payload = {
      archived: false
    }

    const result = await notionApiRequest(
      `/pages/${itemId}`,
      "PATCH",
      accessToken,
      payload
    )

    logger.info("[Notion Restore Item] Item restored successfully:", { itemId })

    return {
      success: true,
      output: {
        page_id: result.id,
        url: result.url,
        archived: result.archived,
        restored_time: new Date().toISOString(),
        properties: result.properties,
        item: result
      },
      message: "Database item restored successfully"
    }
  } catch (error: any) {
    logger.error("[Notion Restore Item] Error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to restore database item"
    }
  }
}

/**
 * Add a block to a page
 */
export async function notionAddBlock(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const { getDecryptedAccessToken } = await import("@/lib/integrations/getDecryptedAccessToken")
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")

    if (!accessToken) {
      return {
        success: false,
        output: {},
        message: "Notion integration not connected. Please connect your Notion account."
      }
    }

    // Support both 'page' (from schema) and 'page_id' (legacy)
    const pageId = context.dataFlowManager.resolveVariable(config.page) ||
                   context.dataFlowManager.resolveVariable(config.page_id)
    // Support both 'blockType' (from schema) and 'block_type' (legacy)
    const blockType = context.dataFlowManager.resolveVariable(config.blockType) ||
                      context.dataFlowManager.resolveVariable(config.block_type)
    // Support both 'blockContent' (from schema) and 'content' (legacy)
    const content = context.dataFlowManager.resolveVariable(config.blockContent) ||
                    context.dataFlowManager.resolveVariable(config.content)

    if (!pageId) {
      return {
        success: false,
        output: {},
        message: "Page is required"
      }
    }

    if (!blockType) {
      return {
        success: false,
        output: {},
        message: "Block type is required"
      }
    }

    logger.info("[Notion Add Block] Adding block to page:", { pageId, blockType, content })

    // Build block object based on type
    let blockObject: any = {
      type: blockType
    }

    // Add content for text-based blocks
    if (content && ["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item", "to_do", "toggle", "quote", "callout"].includes(blockType)) {
      blockObject[blockType] = {
        rich_text: [
          {
            type: "text",
            text: { content: content }
          }
        ]
      }

      // Add checked property for to-do blocks
      if (blockType === "to_do") {
        const checked = context.dataFlowManager.resolveVariable(config.checked)
        blockObject[blockType].checked = checked === true || checked === "true"
      }
    } else if (blockType === "code" && content) {
      // Code blocks need language - support both 'codeLanguage' (from schema) and 'language' (legacy)
      const language = context.dataFlowManager.resolveVariable(config.codeLanguage) ||
                       context.dataFlowManager.resolveVariable(config.language) ||
                       "plain text"
      blockObject.code = {
        rich_text: [
          {
            type: "text",
            text: { content: content }
          }
        ],
        language
      }
    } else if (blockType === "divider") {
      // Divider blocks have no content
      blockObject.divider = {}
    } else if (!content && blockType !== "divider") {
      // For text-based blocks without content, still need to create the block structure
      blockObject[blockType] = {
        rich_text: []
      }
    }

    const payload = {
      children: [blockObject]
    }

    logger.debug("[Notion Add Block] Adding block to page:", pageId)

    const result = await notionApiRequest(
      `/blocks/${pageId}/children`,
      "PATCH",
      accessToken,
      payload
    )

    logger.info("[Notion Add Block] Block added successfully")

    const addedBlock = result.results?.[0] || result

    return {
      success: true,
      output: {
        block_id: addedBlock.id,
        type: addedBlock.type,
        content: addedBlock[addedBlock.type] || {},
        block: addedBlock
      },
      message: "Block added successfully"
    }
  } catch (error: any) {
    logger.error("[Notion Add Block] Error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to add block"
    }
  }
}

/**
 * Get a specific block by ID
 */
export async function notionGetBlock(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const { getDecryptedAccessToken } = await import('@/lib/integrations/getDecryptedAccessToken')
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")

    if (!accessToken) {
      return {
        success: false,
        output: {},
        message: "Notion integration not connected. Please connect your Notion account."
      }
    }

    // Support both selection modes:
    // - "fromPage" mode: uses selectedBlock (selected from dropdown)
    // - "manual" mode: uses blockId (entered manually)
    const selectedBlock = context.dataFlowManager.resolveVariable(config.selectedBlock)
    const manualBlockId = context.dataFlowManager.resolveVariable(config.blockId)
    const blockId = selectedBlock || manualBlockId

    if (!blockId) {
      return {
        success: false,
        output: {},
        message: "Block ID is required. Select a block from a page or enter a block ID manually."
      }
    }

    logger.info("[Notion Get Block] Retrieving block:", { blockId })

    const result = await notionApiRequest(
      `/blocks/${blockId}`,
      "GET",
      accessToken
    )

    logger.info("[Notion Get Block] Block retrieved successfully")

    return {
      success: true,
      output: {
        block_id: result.id,
        type: result.type,
        content: result[result.type] || {},
        has_children: result.has_children,
        block: result
      },
      message: "Block retrieved successfully"
    }
  } catch (error: any) {
    logger.error("[Notion Get Block] Error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to get block"
    }
  }
}

/**
 * Get children of a block
 */
export async function notionGetBlockChildren(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const { getDecryptedAccessToken } = await import('@/lib/integrations/getDecryptedAccessToken')
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")

    if (!accessToken) {
      return {
        success: false,
        output: {},
        message: "Notion integration not connected. Please connect your Notion account."
      }
    }

    // Support both selection modes:
    // - "fromPage" mode: uses selectedBlock (selected from dropdown)
    // - "manual" mode: uses blockId (entered manually)
    const selectedBlock = context.dataFlowManager.resolveVariable(config.selectedBlock)
    const manualBlockId = context.dataFlowManager.resolveVariable(config.blockId)
    const blockId = selectedBlock || manualBlockId
    const pageSize = context.dataFlowManager.resolveVariable(config.pageSize) || 100
    const startCursor = context.dataFlowManager.resolveVariable(config.startCursor)

    if (!blockId) {
      return {
        success: false,
        output: {},
        message: "Block ID is required. Select a block from a page or enter a block ID manually."
      }
    }

    logger.info("[Notion Get Block Children] Retrieving children:", { blockId, pageSize, startCursor })

    // Build query params
    let queryParams = `page_size=${pageSize}`
    if (startCursor) {
      queryParams += `&start_cursor=${startCursor}`
    }

    const result = await notionApiRequest(
      `/blocks/${blockId}/children?${queryParams}`,
      "GET",
      accessToken
    )

    logger.info("[Notion Get Block Children] Children retrieved successfully")

    return {
      success: true,
      output: {
        children: result.results || [],
        has_more: result.has_more || false,
        next_cursor: result.next_cursor || null,
        count: result.results?.length || 0
      },
      message: "Block children retrieved successfully"
    }
  } catch (error: any) {
    logger.error("[Notion Get Block Children] Error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to get block children"
    }
  }
}

/**
 * Get page with all children (recursive)
 */
export async function notionGetPageWithChildren(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const { getDecryptedAccessToken } = await import('@/lib/integrations/getDecryptedAccessToken')
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")

    if (!accessToken) {
      return {
        success: false,
        output: {},
        message: "Notion integration not connected. Please connect your Notion account."
      }
    }

    const pageId = context.dataFlowManager.resolveVariable(config.page_id)
    const depth = context.dataFlowManager.resolveVariable(config.depth) || '1'

    if (!pageId) {
      return {
        success: false,
        output: {},
        message: "Page ID is required"
      }
    }

    logger.info("[Notion Get Page with Children] Retrieving page:", { pageId, depth })

    // Get the page first
    const page = await notionApiRequest(
      `/pages/${pageId}`,
      "GET",
      accessToken
    )

    // Get children blocks
    const childrenResult = await notionApiRequest(
      `/blocks/${pageId}/children?page_size=100`,
      "GET",
      accessToken
    )

    let children = childrenResult.results || []

    // If depth is 'all', recursively get nested children
    if (depth === 'all') {
      const getNestedChildren = async (blocks: any[]): Promise<any[]> => {
        const blocksWithChildren = await Promise.all(
          blocks.map(async (block) => {
            if (block.has_children) {
              const nestedResult = await notionApiRequest(
                `/blocks/${block.id}/children?page_size=100`,
                "GET",
                accessToken
              )
              const nestedChildren = await getNestedChildren(nestedResult.results || [])
              return { ...block, children: nestedChildren }
            }
            return block
          })
        )
        return blocksWithChildren
      }

      children = await getNestedChildren(children)
    }

    logger.info("[Notion Get Page with Children] Page retrieved successfully")

    return {
      success: true,
      output: {
        page_id: page.id,
        url: page.url,
        properties: page.properties,
        children: children,
        child_count: children.length,
        page: page
      },
      message: "Page with children retrieved successfully"
    }
  } catch (error: any) {
    logger.error("[Notion Get Page with Children] Error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to get page with children"
    }
  }
}

/**
 * Advanced database query with JSON filters
 */
export async function notionAdvancedDatabaseQuery(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const { getDecryptedAccessToken } = await import('@/lib/integrations/getDecryptedAccessToken')
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")

    if (!accessToken) {
      return {
        success: false,
        output: {},
        message: "Notion integration not connected. Please connect your Notion account."
      }
    }

    const rawDatabaseId = context.dataFlowManager.resolveVariable(config.database_id || config.database)
    const databaseId = normalizeNotionId(rawDatabaseId)
    let filter = context.dataFlowManager.resolveVariable(config.filter)
    let sorts = context.dataFlowManager.resolveVariable(config.sorts)
    const pageSize = context.dataFlowManager.resolveVariable(config.page_size) || 100

    if (!databaseId) {
      return {
        success: false,
        output: {},
        message: "Database ID is required"
      }
    }

    if (typeof filter === 'string') {
      const trimmed = filter.trim()
      if (trimmed === '') {
        filter = undefined
      } else {
        try {
          filter = JSON.parse(trimmed)
        } catch (error: any) {
          return {
            success: false,
            output: {},
            message: `Invalid JSON for filter: ${error.message}`
          }
        }
      }
    }

    if (typeof sorts === 'string') {
      const trimmed = sorts.trim()
      if (trimmed === '') {
        sorts = undefined
      } else {
        try {
          sorts = JSON.parse(trimmed)
          if (!Array.isArray(sorts)) {
            throw new Error('Sorts must be an array')
          }
        } catch (error: any) {
          return {
            success: false,
            output: {},
            message: `Invalid JSON for sorts: ${error.message}`
          }
        }
      }
    }

    logger.info("[Notion Advanced Query] Querying database:", { databaseId, rawDatabaseId, hasFilter: !!filter, hasSorts: !!sorts })

    // Build query payload
    const payload: any = {
      page_size: pageSize
    }

    if (filter) {
      payload.filter = filter
    }

    if (sorts) {
      payload.sorts = sorts
    }

    const result = await notionApiRequest(
      `/databases/${databaseId}/query`,
      "POST",
      accessToken,
      payload
    )

    logger.info("[Notion Advanced Query] Query completed successfully")

    return {
      success: true,
      output: {
        results: result.results || [],
        has_more: result.has_more || false,
        next_cursor: result.next_cursor || null,
        result_count: result.results?.length || 0
      },
      message: "Database query completed successfully"
    }
  } catch (error: any) {
    logger.error("[Notion Advanced Query] Error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to query database"
    }
  }
}

/**
 * Get a specific property from a Notion page
 * GET /pages/{page_id}/properties/{property_id}
 */
export async function notionGetPageProperty(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const { getDecryptedAccessToken } = await import('@/lib/integrations/getDecryptedAccessToken')
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")

    if (!accessToken) {
      return {
        success: false,
        output: {},
        message: "Notion integration not connected. Please connect your Notion account."
      }
    }

    const pageId = context.dataFlowManager.resolveVariable(config.page_id)
    const propertyName = context.dataFlowManager.resolveVariable(config.property_name)

    if (!pageId || !propertyName) {
      return {
        success: false,
        output: {},
        message: "Page ID and property name are required"
      }
    }

    logger.info("[Notion Get Page Property] Retrieving property:", { pageId, propertyName })

    // First, get the page to find the property ID
    const page = await notionApiRequest(
      `/pages/${pageId}`,
      "GET",
      accessToken
    )

    if (!page.properties) {
      return {
        success: false,
        output: {},
        message: "Page has no properties"
      }
    }

    // Find the property by name
    const property = page.properties[propertyName]
    if (!property) {
      return {
        success: false,
        output: {},
        message: `Property "${propertyName}" not found on page`
      }
    }

    const propertyId = property.id
    const propertyType = property.type

    // Get the property value
    const propertyValue = await notionApiRequest(
      `/pages/${pageId}/properties/${propertyId}`,
      "GET",
      accessToken
    )

    // Format the value based on type
    let formattedValue = ""
    let rawValue: any = null

    switch (propertyType) {
      case "title":
      case "rich_text":
        rawValue = propertyValue.results?.[0]?.title?.plain_text || propertyValue.results?.[0]?.rich_text?.plain_text || ""
        formattedValue = rawValue
        break
      case "number":
        rawValue = propertyValue.number
        formattedValue = rawValue?.toString() || ""
        break
      case "select":
        rawValue = propertyValue.select
        formattedValue = propertyValue.select?.name || ""
        break
      case "multi_select":
        rawValue = propertyValue.multi_select
        formattedValue = propertyValue.multi_select?.map((s: any) => s.name).join(", ") || ""
        break
      case "date":
        rawValue = propertyValue.date
        formattedValue = propertyValue.date?.start || ""
        break
      case "checkbox":
        rawValue = propertyValue.checkbox
        formattedValue = propertyValue.checkbox ? "true" : "false"
        break
      case "url":
        rawValue = propertyValue.url
        formattedValue = propertyValue.url || ""
        break
      case "email":
        rawValue = propertyValue.email
        formattedValue = propertyValue.email || ""
        break
      case "phone_number":
        rawValue = propertyValue.phone_number
        formattedValue = propertyValue.phone_number || ""
        break
      case "people":
        rawValue = propertyValue.people
        formattedValue = propertyValue.people?.map((p: any) => p.name).join(", ") || ""
        break
      case "files":
        rawValue = propertyValue.files
        formattedValue = propertyValue.files?.map((f: any) => f.name).join(", ") || ""
        break
      default:
        rawValue = propertyValue
        formattedValue = JSON.stringify(propertyValue)
    }

    logger.info("[Notion Get Page Property] Property retrieved successfully")

    return {
      success: true,
      output: {
        property_id: propertyId,
        property_type: propertyType,
        value: rawValue,
        formatted_value: formattedValue,
        raw_property: propertyValue
      },
      message: `Retrieved property "${propertyName}" from page`
    }
  } catch (error: any) {
    logger.error("[Notion Get Page Property] Error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to get page property"
    }
  }
}

/**
 * Add a property to a Notion database
 * PATCH /databases/{database_id}
 */
export async function notionAddDatabaseProperty(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const { getDecryptedAccessToken } = await import('@/lib/integrations/getDecryptedAccessToken')
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")

    if (!accessToken) {
      return {
        success: false,
        output: {},
        message: "Notion integration not connected. Please connect your Notion account."
      }
    }

    const databaseId = context.dataFlowManager.resolveVariable(config.database_id)
    const propertyName = context.dataFlowManager.resolveVariable(config.property_name)
    const propertyType = context.dataFlowManager.resolveVariable(config.property_type)
    const selectOptions = context.dataFlowManager.resolveVariable(config.select_options)

    if (!databaseId || !propertyName || !propertyType) {
      return {
        success: false,
        output: {},
        message: "Database ID, property name, and property type are required"
      }
    }

    logger.info("[Notion Add Database Property] Adding property:", { databaseId, propertyName, propertyType })

    // Notion only allows one title property per database (created automatically)
    if (propertyType === "title") {
      return {
        success: false,
        output: {},
        message: "Cannot add a title property. Notion databases can only have one title property, which is created automatically. Use 'Rich Text' for additional text properties."
      }
    }

    // Build property definition based on type
    let propertyDefinition: any = {}

    switch (propertyType) {
      case "title":
        // This case is kept for safety but should never be reached due to the check above
        propertyDefinition = { title: {} }
        break
      case "rich_text":
        propertyDefinition = { rich_text: {} }
        break
      case "number":
        propertyDefinition = { number: { format: "number" } }
        break
      case "select":
        propertyDefinition = {
          select: {
            options: selectOptions || []
          }
        }
        break
      case "multi_select":
        propertyDefinition = {
          multi_select: {
            options: selectOptions || []
          }
        }
        break
      case "date":
        propertyDefinition = { date: {} }
        break
      case "people":
        propertyDefinition = { people: {} }
        break
      case "files":
        propertyDefinition = { files: {} }
        break
      case "checkbox":
        propertyDefinition = { checkbox: {} }
        break
      case "url":
        propertyDefinition = { url: {} }
        break
      case "email":
        propertyDefinition = { email: {} }
        break
      case "phone_number":
        propertyDefinition = { phone_number: {} }
        break
      case "created_time":
        propertyDefinition = { created_time: {} }
        break
      case "created_by":
        propertyDefinition = { created_by: {} }
        break
      case "last_edited_time":
        propertyDefinition = { last_edited_time: {} }
        break
      case "last_edited_by":
        propertyDefinition = { last_edited_by: {} }
        break
      default:
        return {
          success: false,
          output: {},
          message: `Unsupported property type: ${propertyType}`
        }
    }

    const payload = {
      properties: {
        [propertyName]: propertyDefinition
      }
    }

    const result = await notionApiRequest(
      `/databases/${databaseId}`,
      "PATCH",
      accessToken,
      payload
    )

    logger.info("[Notion Add Database Property] Property added successfully")

    return {
      success: true,
      output: {
        database_id: result.id,
        url: result.url,
        title: result.title?.[0]?.plain_text || "",
        properties: result.properties,
        updated_property: propertyName
      },
      message: `Added property "${propertyName}" to database`
    }
  } catch (error: any) {
    logger.error("[Notion Add Database Property] Error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to add database property"
    }
  }
}

/**
 * Remove a property from a Notion database
 * PATCH /databases/{database_id}
 */
export async function notionRemoveDatabaseProperty(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    const { getDecryptedAccessToken } = await import('@/lib/integrations/getDecryptedAccessToken')
    const accessToken = await getDecryptedAccessToken(context.userId, "notion")

    if (!accessToken) {
      return {
        success: false,
        output: {},
        message: "Notion integration not connected. Please connect your Notion account."
      }
    }

    const databaseId = context.dataFlowManager.resolveVariable(config.database_id)
    const propertyName = context.dataFlowManager.resolveVariable(config.property_name)

    if (!databaseId || !propertyName) {
      return {
        success: false,
        output: {},
        message: "Database ID and property name are required"
      }
    }

    logger.info("[Notion Remove Database Property] Removing property:", { databaseId, propertyName })

    // To remove a property, set it to null
    const payload = {
      properties: {
        [propertyName]: null
      }
    }

    const result = await notionApiRequest(
      `/databases/${databaseId}`,
      "PATCH",
      accessToken,
      payload
    )

    logger.info("[Notion Remove Database Property] Property removed successfully")

    return {
      success: true,
      output: {
        database_id: result.id,
        url: result.url,
        title: result.title?.[0]?.plain_text || "",
        properties: result.properties,
        updated_property: propertyName
      },
      message: `Removed property "${propertyName}" from database`
    }
  } catch (error: any) {
    logger.error("[Notion Remove Database Property] Error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to remove database property"
    }
  }
}

/**
 * Make a custom API call to Notion's API
 * Supports any endpoint with any method
 */
export async function notionMakeApiCall(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const { getDecryptedAccessToken } = await import('@/lib/integrations/getDecryptedAccessToken')
    const accessToken = await getDecryptedAccessToken(userId, "notion")

    if (!accessToken) {
      return {
        success: false,
        output: {},
        message: "Notion integration not connected. Please connect your Notion account."
      }
    }

    const endpoint = config.endpoint
    const method = config.method || 'GET'
    let body = config.body
    let queryParams = config.queryParams
    const customHeaders = config.headers || {}

    if (!endpoint) {
      return {
        success: false,
        output: {},
        message: "API endpoint is required"
      }
    }

    // Parse body if it's a string
    if (typeof body === 'string' && body.trim()) {
      try {
        body = JSON.parse(body)
      } catch (e) {
        return {
          success: false,
          output: {},
          message: "Invalid JSON in request body"
        }
      }
    }

    // Parse query params if it's a string
    if (typeof queryParams === 'string' && queryParams.trim()) {
      try {
        queryParams = JSON.parse(queryParams)
      } catch (e) {
        return {
          success: false,
          output: {},
          message: "Invalid JSON in query parameters"
        }
      }
    }

    // Build the full URL
    let url = `https://api.notion.com${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`

    // Add query parameters
    if (queryParams && typeof queryParams === 'object' && Object.keys(queryParams).length > 0) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(queryParams)) {
        params.append(key, String(value))
      }
      url += `?${params.toString()}`
    }

    logger.info("[Notion Make API Call] Making request:", { method, url })

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      ...customHeaders
    }

    const fetchOptions: RequestInit = {
      method,
      headers
    }

    if (body && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
      fetchOptions.body = JSON.stringify(body)
    }

    const response = await fetch(url, fetchOptions)
    const data = await response.json()

    if (!response.ok) {
      logger.error("[Notion Make API Call] API error:", data)
      return {
        success: false,
        output: { status: response.status, error: data },
        message: data.message || `API call failed with status ${response.status}`
      }
    }

    logger.info("[Notion Make API Call] Request successful")

    return {
      success: true,
      output: {
        data,
        status: response.status
      },
      message: "API call successful"
    }
  } catch (error: any) {
    logger.error("[Notion Make API Call] Error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to make API call"
    }
  }
}
