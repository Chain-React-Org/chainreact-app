import { NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"
import { cookies } from "next/headers"
import { predefinedTemplates } from '@/lib/templates/predefinedTemplates'

import { logger } from '@/lib/utils/logger'

// Convert a predefined template from the TS file into the API response format
function formatPredefinedTemplate(template: typeof predefinedTemplates[number]) {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    tags: template.tags,
    integrations: template.integrations,
    difficulty: template.difficulty,
    estimatedTime: template.estimatedTime,
    nodes: template.workflow_json.nodes,
    connections: template.workflow_json.edges,
    workflow_json: template.workflow_json,
    is_predefined: true,
    is_public: true,
    status: "published",
    airtableSetup: (template as any).airtableSetup || null,
    integrationSetup: (template as any).integrationSetups || null,
    creator: { email: "templates@chainreact.com" },
  }
}

export async function GET(request: Request) {
  try {
    await cookies()
    const supabase = await createSupabaseRouteHandlerClient()

    const { searchParams } = new URL(request.url)
    const category = searchParams.get("category")
    const search = searchParams.get("search")

    // Try to fetch from database first
    let dbTemplates: any[] = []
    try {
      const { data: checkTable, error: checkError } = await supabase
        .from("templates")
        .select("*")
        .limit(1)

      if (!checkError || checkError.code !== '42P01') {
        let query = supabase
          .from("templates")
          .select("*")
          .eq("is_public", true)

        if (!checkError || checkError.code !== '42703') {
          query = query.eq("is_predefined", true)
        }

        if (category && category !== "all") {
          query = query.eq("category", category)
        }

        if (search) {
          query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`)
        }

        const { data: templates, error } = await query

        if (!error && templates) {
          dbTemplates = templates
        }
      }
    } catch (dbError) {
      logger.error("DB query failed, falling back to predefined templates:", dbError)
    }

    // If DB has templates, format and return them
    if (dbTemplates.length > 0) {
      const formattedTemplates = dbTemplates.map(template => {
        const parseJsonField = (field: any) => {
          if (typeof field === 'string') {
            try { return JSON.parse(field) } catch { return null }
          }
          return field || null
        }

        return {
          ...template,
          airtable_setup: parseJsonField(template.airtable_setup),
          airtableSetup: parseJsonField(template.airtable_setup),
          integration_setup: parseJsonField(template.integration_setup),
          integrationSetup: parseJsonField(template.integration_setup),
          setup_overview: parseJsonField(template.setup_overview),
          setupOverview: parseJsonField(template.setup_overview),
          default_field_values: parseJsonField(template.default_field_values),
          defaultFieldValues: parseJsonField(template.default_field_values),
          creator: { email: "templates@chainreact.com" },
          ...(!(template as any).workflow_json && (template.nodes || template.connections)
            ? { workflow_json: { nodes: template.nodes || [], edges: template.connections || [] } }
            : {}),
        }
      })

      return jsonResponse({ templates: formattedTemplates, count: formattedTemplates.length })
    }

    // Fallback: serve from TypeScript predefined templates
    let fallbackTemplates = predefinedTemplates.map(formatPredefinedTemplate)

    if (category && category !== "all") {
      fallbackTemplates = fallbackTemplates.filter(t => t.category === category)
    }

    if (search) {
      const lowerSearch = search.toLowerCase()
      fallbackTemplates = fallbackTemplates.filter(t =>
        t.name.toLowerCase().includes(lowerSearch) ||
        t.description.toLowerCase().includes(lowerSearch)
      )
    }

    return jsonResponse({ templates: fallbackTemplates, count: fallbackTemplates.length })
  } catch (error) {
    logger.error("Error fetching predefined templates:", error)
    return errorResponse("Failed to fetch templates", 500)
  }
}
