import { getDecryptedAccessToken, resolveValue, ActionResult } from '@/lib/workflows/actions/core'

import { logger } from '@/lib/utils/logger'

/**
 * Finds record(s) in an Airtable table based on search criteria
 */
export async function findAirtableRecord(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(userId, "airtable")

    const baseId = resolveValue(config.baseId, input)
    const tableName = resolveValue(config.tableName, input)
    const searchMode = resolveValue(config.searchMode, input) || 'field_match'
    const searchField = resolveValue(config.searchField, input)
    const searchValue = resolveValue(config.searchValue, input)
    const matchType = resolveValue(config.matchType, input) || 'any'
    const caseSensitive = resolveValue(config.caseSensitive, input) || false
    const filterFormula = resolveValue(config.filterFormula, input)
    const returnFirst = resolveValue(config.returnFirst, input) || 'first'

    if (!baseId || !tableName) {
      const missingFields = []
      if (!baseId) missingFields.push("Base ID")
      if (!tableName) missingFields.push("Table Name")

      const message = `Missing required fields for finding record: ${missingFields.join(", ")}`
      logger.error(message)
      return { success: false, message }
    }

    // Build filter formula based on search mode
    let finalFormula = ''

    if (searchMode === 'formula') {
      // Use the provided filter formula directly
      if (!filterFormula || !filterFormula.trim()) {
        return { success: false, message: "Filter formula is required when using formula search mode" }
      }
      finalFormula = filterFormula.trim()
    } else if (searchMode === 'field_match') {
      // Build formula based on field value match
      if (!searchField) {
        return { success: false, message: "Search field is required when using field match mode" }
      }
      if (!searchValue || (Array.isArray(searchValue) && searchValue.length === 0)) {
        return { success: false, message: "Search value is required when using field match mode" }
      }

      // Handle search value as array (from tags input) or single value
      const keywords = Array.isArray(searchValue) ? searchValue : [searchValue]

      if (keywords.length === 0) {
        return { success: false, message: "At least one search keyword is required" }
      }

      // Build search conditions based on match type
      const searchConditions: string[] = []

      if (matchType === 'exact') {
        // Exact phrase match - join all keywords into one phrase
        const phrase = keywords.join(' ')
        const searchFunc = caseSensitive ? '' : 'LOWER'
        const fieldRef = caseSensitive ? `{${searchField}}` : `${searchFunc}({${searchField}})`
        const value = caseSensitive ? phrase : phrase.toLowerCase()
        searchConditions.push(`${fieldRef} = "${value}"`)
      } else {
        // For 'any' or 'all' - search for each keyword
        // Use FIND() which returns position (>0) when found, 0 when not found
        // We need to explicitly check > 0 for proper boolean evaluation
        keywords.forEach(keyword => {
          if (caseSensitive) {
            // Case-sensitive: use FIND directly and check > 0
            searchConditions.push(`FIND("${keyword}", {${searchField}}) > 0`)
          } else {
            // Case-insensitive: convert both to lowercase, use FIND, and check > 0
            const lowerKeyword = keyword.toLowerCase()
            searchConditions.push(`FIND("${lowerKeyword}", LOWER({${searchField}})) > 0`)
          }
        })
      }

      // Combine conditions based on match type
      if (matchType === 'all' || matchType === 'exact') {
        finalFormula = searchConditions.length === 1
          ? searchConditions[0]
          : `AND(${searchConditions.join(', ')})`
      } else { // 'any'
        finalFormula = searchConditions.length === 1
          ? searchConditions[0]
          : `OR(${searchConditions.join(', ')})`
      }
    } else {
      return { success: false, message: `Unknown search mode: ${searchMode}` }
    }

    // Build the URL with query parameters
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`)

    // Fetch more records when returning all matches
    const maxRecords = returnFirst === 'all' ? 100 : 10
    url.searchParams.append('maxRecords', maxRecords.toString())

    if (finalFormula) {
      url.searchParams.append('filterByFormula', finalFormula)
    }

    // Note: Sorting by creation time requires a "Created time" field in the table
    // Airtable's REST API does not support sorting by system fields (createdTime)
    // Skipping sort for newest/oldest to avoid 422 errors
    // Users should add a "Created time" field type to their table if they want time-based sorting
    if (returnFirst === 'newest' || returnFirst === 'oldest') {
      // Sorting disabled - would cause 422 error "Unknown field name"
      // TODO: Add config option for users to specify their created time field name
      logger.info('[findAirtableRecord] Skipping time-based sort - not supported by Airtable REST API')
    }

    logger.info('[findAirtableRecord] Searching with formula:', {
      baseId,
      tableName,
      formula: finalFormula,
      returnFirst,
      maxRecords
    })

    // Fetch the records from Airtable
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Failed to find record: ${response.status} - ${errorData.error?.message || response.statusText}`)
    }

    const result = await response.json()
    const records = result.records || []

    // Handle the case where no records were found
    if (records.length === 0) {
      return {
        success: true,
        output: {
          found: false,
          matchCount: 0,
          recordId: null,
          fields: null,
          createdTime: null,
          records: []
        },
        message: `No records found matching the search criteria`
      }
    }

    // Return all matches if requested
    if (returnFirst === 'all') {
      // Transform records to include id and createdTime at root level for easier access
      const transformedRecords = records.map((record: any) => ({
        id: record.id,
        fields: record.fields,
        createdTime: record.createdTime
      }))

      // Even in 'all' mode the schema documents recordId/fields/createdTime
      // as "(or first record if multiple)" — hoist the first record so
      // simple downstream consumers can read it without indexing into records[].
      return {
        success: true,
        output: {
          found: true,
          matchCount: records.length,
          recordId: records[0].id,
          fields: records[0].fields,
          createdTime: records[0].createdTime,
          records: transformedRecords
        },
        message: `Found ${records.length} matching record${records.length === 1 ? '' : 's'}`
      }
    }

    // Return single record (first, newest, or oldest based on config)
    const selectedRecord = records[0] // Already sorted by Airtable if needed

    return {
      success: true,
      output: {
        found: true,
        matchCount: records.length,
        recordId: selectedRecord.id,
        fields: selectedRecord.fields,
        createdTime: selectedRecord.createdTime,
        records: [{ // Include single record in array for consistency
          id: selectedRecord.id,
          fields: selectedRecord.fields,
          createdTime: selectedRecord.createdTime
        }]
      },
      message: `Found record${records.length > 1 ? ` (${records.length} matches, returned ${returnFirst})` : ''}`
    }

  } catch (error: any) {
    logger.error("Airtable find record error:", error)
    return {
      success: false,
      error: error.message || "An unexpected error occurred while finding record"
    }
  }
}
