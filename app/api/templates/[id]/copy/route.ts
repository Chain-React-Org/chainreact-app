import { createSupabaseRouteHandlerClient, createSupabaseServiceClient } from "@/utils/supabase/server"
import { cookies } from "next/headers"
import { type NextRequest, NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { randomUUID } from "crypto"
import { getTemplateById } from '@/lib/templates/predefinedTemplates'

import { logger } from '@/lib/utils/logger'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await cookies()
    const supabase = await createSupabaseRouteHandlerClient()
    const serviceClient = await createSupabaseServiceClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return errorResponse("Not authenticated" , 401)
    }

    // Await params before using
    const resolvedParams = await params

    // Get the template from database
    const { data: template, error: templateError } = await supabase
      .from("templates")
      .select("*")
      .eq("id", resolvedParams.id)
      .eq("is_public", true)
      .single()

    // Extract nodes and connections from the appropriate fields
    // Handle potential string JSONB fields that need parsing
    let nodes: any[] = []
    let connections: any[] = []
    let templateName = ''
    let templateDescription = ''

    // Parse JSONB fields if they come as strings
    const parseField = (field: any) => {
      if (typeof field === 'string') {
        try {
          return JSON.parse(field)
        } catch (e) {
          logger.error("Failed to parse field:", e)
          return null
        }
      }
      return field
    }

    if (template && !templateError) {
      // Found in database
      templateName = template.name || ''
      templateDescription = template.description || ''

      const templateNodes = parseField(template.nodes)
      const templateConnections = parseField(template.connections)
      const templateWorkflowJson = parseField((template as any).workflow_json)

      if (templateNodes && Array.isArray(templateNodes) && templateNodes.length > 0) {
        nodes = templateNodes
        connections = templateConnections || []
      } else if (templateWorkflowJson && templateWorkflowJson.nodes && templateWorkflowJson.nodes.length > 0) {
        nodes = templateWorkflowJson.nodes || []
        connections = templateWorkflowJson.edges || templateWorkflowJson.connections || []
      } else {
        nodes = templateNodes || templateWorkflowJson?.nodes || []
        connections = templateConnections || templateWorkflowJson?.edges || templateWorkflowJson?.connections || []
      }
    } else {
      // Fallback: check predefined templates (not always synced to DB)
      const predefined = getTemplateById(resolvedParams.id)
      if (!predefined) {
        logger.error("Template not found in DB or predefined:", resolvedParams.id)
        return errorResponse("Template not found", 404)
      }

      logger.info("Using predefined template fallback:", predefined.id)
      templateName = predefined.name
      templateDescription = predefined.description
      nodes = predefined.workflow_json.nodes || []
      connections = predefined.workflow_json.edges || []
    }

    logger.info('Copying template:', {
      templateName,
      nodeCount: nodes.length,
      connectionCount: connections.length,
      firstNode: nodes[0] ? {
        id: nodes[0].id,
        type: nodes[0].type,
        hasData: !!nodes[0].data,
        dataType: nodes[0].data?.type,
        title: nodes[0].data?.title
      } : null
    })

    // Validate we have nodes to copy
    if (!nodes || nodes.length === 0) {
      logger.error("No nodes found in template to copy")
      return jsonResponse({
        error: "Template has no nodes to copy",
        debug: {
          templateId: resolvedParams.id,
          templateName,
        }
      }, { status: 400 })
    }

    logger.info(`Creating workflow with ${nodes.length} nodes and ${connections.length} connections`)

    // Filter out UI-only placeholder nodes (Add Action buttons, etc.)
    const filteredNodes = nodes.filter(node => {
      const nodeType = node.data?.type || node.type
      const hasAddButton = node.data?.hasAddButton
      const isPlaceholder = node.data?.isPlaceholder

      // Remove addAction, insertAction, and chain placeholder nodes
      return nodeType !== 'addAction'
        && nodeType !== 'insertAction'
        && nodeType !== 'chain_placeholder'
        && !hasAddButton
        && !isPlaceholder
    })

    logger.info(`Filtered ${nodes.length - filteredNodes.length} placeholder nodes, ${filteredNodes.length} nodes remaining`)

    // Keep ALL remaining nodes in the main workflow (including chain nodes)
    // Chain nodes should be visible on the canvas with their metadata intact
    const processedNodes = filteredNodes.map(node => {
      // Ensure all nodes use type: "custom" for React Flow compatibility
      return {
        ...node,
        type: 'custom'
      };
    });

    logger.info('Template processing:', {
      totalNodes: processedNodes.length,
      totalConnections: connections.length,
      chainNodes: processedNodes.filter(n => n.data?.isAIAgentChild).length,
      aiAgentNodes: processedNodes.filter(n => n.data?.type === 'ai_agent').length
    });

    // Find the next available name by checking for existing copies
    const baseName = `${templateName} (Copy)`
    let finalName = baseName
    let copyNumber = 0

    // Fetch all workflows for this user that might match our naming pattern
    // We'll filter in JavaScript for more reliable matching
    const { data: existingWorkflows } = await supabase
      .from("workflows")
      .select("name")
      .eq("user_id", user.id)
      .ilike("name", `${templateName}%`)

    console.log('Checking for existing copies:', {
      templateName,
      baseName,
      existingCount: existingWorkflows?.length || 0,
      existingNames: existingWorkflows?.map(w => w.name) || []
    })

    if (existingWorkflows && existingWorkflows.length > 0) {
      // Extract existing copy numbers (0 = base name, 1+ = numbered copies)
      const existingNumbers = new Set<number>()

      existingWorkflows.forEach(workflow => {
        // Check if it's exactly the base name (first copy = 0)
        if (workflow.name === baseName) {
          existingNumbers.add(0)
        }
        // Check if it matches "Template (Copy) (N)" pattern
        else if (workflow.name.startsWith(baseName)) {
          const match = workflow.name.match(/\(Copy\) \((\d+)\)$/)
          if (match) {
            existingNumbers.add(parseInt(match[1], 10))
          }
        }
      })

      console.log('Found existing copy numbers:', Array.from(existingNumbers).sort((a, b) => a - b))

      // Find the next available number starting from 0
      while (existingNumbers.has(copyNumber)) {
        copyNumber++
      }

      // Generate the final name
      if (copyNumber === 0) {
        finalName = baseName  // "Template (Copy)" - no number suffix
      } else {
        finalName = `${baseName} (${copyNumber})`  // "Template (Copy) (1)", "Template (Copy) (2)", etc.
      }
    }

    console.log(`Creating workflow with name: ${finalName}`)

    // Generate new workflow ID
    const newWorkflowId = randomUUID()

    // Create a new workflow from the template (without nodes/connections - they go to normalized tables)
    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .insert({
        id: newWorkflowId,
        name: finalName,
        description: templateDescription,
        user_id: user.id,
        status: "draft",
        source_template_id: resolvedParams.id,
      })
      .select()
      .single()

    if (workflowError) {
      logger.error("Error creating workflow from template:", workflowError)
      return errorResponse("Failed to create workflow", 500, {
        details: workflowError.message,
        code: workflowError.code
      })
    }

    if (!workflow) {
      logger.error("Workflow created but no data returned")
      return errorResponse("Workflow creation succeeded but no data returned" , 500)
    }

    // Insert nodes into normalized table
    if (processedNodes && processedNodes.length > 0) {
      // Create ID mapping for nodes (old ID -> new ID)
      const nodeIdMap = new Map<string, string>()
      const nodeRecords = processedNodes.map((node: any, index: number) => {
        const newNodeId = randomUUID()
        nodeIdMap.set(node.id, newNodeId)
        return {
          id: newNodeId,
          workflow_id: newWorkflowId,
          user_id: user.id,
          node_type: node.data?.type || node.type || 'unknown',
          label: node.data?.label || node.data?.title || node.data?.type || 'Unnamed Node',
          description: node.data?.description || null,
          config: node.data?.config || node.data || {},
          position_x: node.position?.x ?? 400,
          position_y: node.position?.y ?? (100 + index * 180),
          is_trigger: node.data?.isTrigger ?? false,
          provider_id: (node.data?.type || '').split(':')[0] || null,
          display_order: index,
          in_ports: [],
          out_ports: [],
          metadata: { position: node.position },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      })

      const { error: nodesError } = await serviceClient
        .from('workflow_nodes')
        .insert(nodeRecords)

      if (nodesError) {
        logger.error("Error inserting workflow nodes:", nodesError)
      }

      // Insert edges into normalized table
      if (connections && connections.length > 0) {
        const edgeRecords = connections
          .filter((conn: any) => conn && (conn.source || conn.from) && (conn.target || conn.to))
          .map((conn: any) => {
            const sourceId = conn.source || conn.from
            const targetId = conn.target || conn.to
            return {
              id: randomUUID(),
              workflow_id: newWorkflowId,
              user_id: user.id,
              source_node_id: nodeIdMap.get(sourceId) || sourceId,
              target_node_id: nodeIdMap.get(targetId) || targetId,
              source_port_id: conn.sourceHandle || 'source',
              target_port_id: conn.targetHandle || 'target',
              mappings: [],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }
          })

        if (edgeRecords.length > 0) {
          const { error: edgesError } = await serviceClient
            .from('workflow_edges')
            .insert(edgeRecords)

          if (edgesError) {
            logger.error("Error inserting workflow edges:", edgesError)
          }
        }
      }
    }

    logger.info(`Successfully created workflow ${workflow.id} from template`)
    return jsonResponse({ workflow })
  } catch (error) {
    logger.error("Unexpected error copying template:", error)
    return errorResponse("Internal server error", 500, { details: error instanceof Error ? error.message : "Unknown error"
     })
  }
}
