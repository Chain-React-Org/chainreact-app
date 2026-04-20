"use client"

import React from 'react'
import { ReactFlow, Node, Edge, Handle, Position, Background, BackgroundVariant } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ALL_NODE_COMPONENTS } from '@/lib/workflows/availableNodes'
import { getIntegrationLogoClasses } from '@/lib/integrations/logoStyles'
import { Zap, Bot, GitBranch, Webhook } from 'lucide-react'

interface TemplateWorkflowPreviewProps {
  nodes: any[]
  edges: any[]
  className?: string
}

// Extract provider ID from node type (e.g. "gmail_trigger_new_email" → "gmail")
function getProviderId(node: any): string {
  if (node.data?.providerId) return node.data.providerId
  const nodeType = node.data?.type || node.type || ''
  if (nodeType.startsWith('google_calendar')) return 'google-calendar'
  if (nodeType.startsWith('google_sheets')) return 'google-sheets'
  if (nodeType.startsWith('google_drive')) return 'google-drive'
  if (nodeType.startsWith('google_docs')) return 'google-docs'
  if (nodeType.startsWith('google_analytics')) return 'google-analytics'
  if (nodeType.startsWith('microsoft_excel')) return 'microsoft-excel'
  if (nodeType.startsWith('ai_router') || nodeType.startsWith('ai_agent') || nodeType.startsWith('ai_message')) return 'ai'
  if (nodeType.startsWith('logic_') || nodeType.startsWith('schedule_') || nodeType.startsWith('manual_')) return 'logic'
  if (nodeType.startsWith('webhook_')) return 'webhook'
  return nodeType.split('_')[0] || ''
}

const INTERNAL_PROVIDERS = new Set(['ai', 'logic', 'webhook', 'custom', 'automation', 'utility', ''])

function getInternalIcon(providerId: string) {
  switch (providerId) {
    case 'ai': return <Bot className="w-3.5 h-3.5 text-violet-500" />
    case 'logic': return <GitBranch className="w-3.5 h-3.5 text-amber-500" />
    case 'webhook': return <Webhook className="w-3.5 h-3.5 text-blue-500" />
    default: return <Zap className="w-3.5 h-3.5 text-gray-400" />
  }
}

export function TemplateWorkflowPreview({ nodes, edges, className }: TemplateWorkflowPreviewProps) {
  const flowNodes: Node[] = (nodes || []).map(node => {
    const nodeDefinition = ALL_NODE_COMPONENTS.find(n => n.type === (node.data?.type || node.type))
    const providerId = getProviderId(node)
    const isTrigger = node.data?.isTrigger || (node.data?.type || node.type || '').includes('trigger')

    return {
      id: node.id,
      type: 'miniNode',
      position: node.position || { x: 0, y: 0 },
      data: {
        label: node.data?.title || node.data?.name || nodeDefinition?.title || 'Node',
        providerId,
        isTrigger,
      }
    }
  })

  const flowEdges: Edge[] = (edges || []).map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle || undefined,
    targetHandle: edge.targetHandle || undefined,
    type: 'smoothstep',
    style: { stroke: '#d0d6e0', strokeWidth: 1.5 },
    animated: false,
  }))

  return (
    <div className={className} style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnDrag={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.2}
        maxZoom={1}
        nodeTypes={{ miniNode: MiniNode }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="rgba(0,0,0,0.06)" />
      </ReactFlow>
    </div>
  )
}

function MiniNode({ data }: { data: { label: string; providerId: string; isTrigger: boolean } }) {
  const { label, providerId, isTrigger } = data
  const isInternal = INTERNAL_PROVIDERS.has(providerId)

  return (
    <div className={`
      relative flex items-center gap-2 px-2.5 py-2 rounded-lg border bg-white dark:bg-gray-950 shadow-sm
      ${isTrigger
        ? 'border-amber-300 dark:border-amber-700'
        : 'border-gray-200 dark:border-gray-700'
      }
    `}
      style={{ minWidth: 120, maxWidth: 180 }}
    >
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-1.5 !h-1.5 !bg-gray-300 dark:!bg-gray-600 !border-0 !-left-1"
      />

      {/* Provider logo or internal icon */}
      <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
        {isInternal ? (
          getInternalIcon(providerId)
        ) : (
          <img
            src={`/integrations/${providerId}.svg`}
            alt=""
            className={getIntegrationLogoClasses(providerId, "w-4 h-4 object-contain")}
            onError={(e) => {
              const target = e.target as HTMLImageElement
              target.style.display = 'none'
              // Show fallback icon
              const parent = target.parentElement
              if (parent) {
                const fallback = document.createElement('span')
                fallback.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'
                parent.appendChild(fallback)
              }
            }}
          />
        )}
      </div>

      {/* Label */}
      <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate leading-tight">
        {label}
      </span>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-1.5 !h-1.5 !bg-gray-300 dark:!bg-gray-600 !border-0 !-right-1"
      />
    </div>
  )
}
