"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { Workflow, WorkflowConnection, WorkflowNode } from "@/stores/workflowStore"
import type { Flow, Node as FlowNode, Edge as FlowEdge, FlowInterface } from "@/src/lib/workflows/builder/schema"
import { FlowSchema } from "@/src/lib/workflows/builder/schema"
import { ALL_NODE_COMPONENTS } from "@/lib/workflows/nodes"

type PlannerEdit =
  | { op: "addNode"; node: FlowNode }
  | { op: "connect"; edge: FlowEdge }
  | { op: "setConfig"; nodeId: string; patch: Record<string, any> }
  | { op: "setInterface"; inputs: FlowInterface["inputs"]; outputs: FlowInterface["outputs"] }

export type OldFlow = Workflow
export type OldNode = WorkflowNode
export type OldEdge = WorkflowConnection
export type OldConfigPatch = Record<string, any>

export interface AdapterFlowState {
  flowId: string
  name?: string
  nodes: OldNode[]
  edges: OldEdge[]
  revisionId?: string
  version: number
  isDirty: boolean
  lastRunId?: string
}

interface FlowFetchResult {
  flow: Flow
  revisionId?: string
}

interface RevisionSummary {
  id: string
  version: number
  createdAt: string
  published?: boolean
  publishedAt?: string | null
}

interface RunSummaryPayload {
  ok: boolean
  run: {
    id: string
    status: string
    nodes: Array<{
      node_id: string
      status: string
      input: any
      output: any
      error: any
      attempts: number
      duration_ms: number | null
      cost: number | null
      estimated_cost: number | null
      token_count: number | null
      created_at: string
    }>
    logs: Array<any>
    summary: {
      totalDurationMs: number
      totalCost: number
      successCount: number
      errorCount: number
      pendingCount: number
      startedAt: string | null
      finishedAt: string | null
    }
  }
}

const JSON_HEADERS = { "Content-Type": "application/json" }

export function generateId(): string {
  // Pure UUIDs for database compatibility (workflow_nodes.id is uuid type).
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID
  // Generate a UUID v4-like string
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText)
    throw new Error(`Request failed (${response.status}): ${message}`)
  }

  return (await response.json()) as T
}

function fallbackPosition(index: number): { x: number; y: number } {
  return { x: 120 + index * 280, y: 120 }
}

export function v2ToOldFlow(flow: Flow): { nodes: OldNode[]; edges: OldEdge[]; meta: { name?: string } } {
  const nodes: OldNode[] = flow.nodes.map((node, index) => {
    const metadata = (node.metadata ?? {}) as any
    const position = metadata.position ?? fallbackPosition(index)

    // If providerId is missing from metadata, look it up from ALL_NODE_COMPONENTS
    let providerId = metadata.providerId
    let isTrigger = metadata.isTrigger ?? false
    let icon = metadata.icon
    let category = metadata.category

    if (!providerId) {
      const nodeComponent = ALL_NODE_COMPONENTS.find(c => c.type === node.type)
      if (nodeComponent) {
        providerId = nodeComponent.providerId
        isTrigger = nodeComponent.isTrigger ?? false
        icon = nodeComponent.icon
        category = nodeComponent.category
      }
    }

    return {
      id: node.id,
      type: metadata.reactFlowType ?? "custom",
      position,
      data: {
        label: node.label ?? node.type,
        title: node.label ?? node.type,
        type: node.type,
        config: node.config ?? {},
        providerId,
        isTrigger,
        description: node.description,
        costHint: node.costHint ?? 0,
        icon,
        category,
      },
    }
  })

  const edges: OldEdge[] = flow.edges.map((edge) => ({
    id: edge.id,
    source: edge.from.nodeId,
    target: edge.to.nodeId,
    sourceHandle: edge.from.portId,
    targetHandle: edge.to.portId,
  }))

  return {
    nodes,
    edges,
    meta: { name: flow.name },
  }
}

export function oldConfigPatchToEdits(nodeId: string, patch: OldConfigPatch): { edits: PlannerEdit[] } {
  return {
    edits: [
      {
        op: "setConfig",
        nodeId,
        patch,
      },
    ],
  }
}

export function oldConnectToEdge(
  sourceId: string,
  targetId: string,
  sourceHandle?: string,
  targetHandle?: string
): { op: "connect"; edge: FlowEdge } {
  return {
    op: "connect",
    edge: {
      id: generateId(), // Use UUID for database compatibility (workflow_edges.id is uuid type)
      from: { nodeId: sourceId, portId: sourceHandle },
      to: { nodeId: targetId, portId: targetHandle },
      mappings: [],
    },
  }
}

export function addNodeEdit(type: string, position?: { x: number; y: number }, nodeId?: string): { op: "addNode"; node: FlowNode } {
  const id = nodeId ?? generateId(type.replace(/\W+/g, "-") || "node")

  // Look up node definition from ALL_NODE_COMPONENTS
  const nodeDefinition = ALL_NODE_COMPONENTS.find(n => n.type === type)
  const title = nodeDefinition?.title || type
  const description = nodeDefinition?.description
  const providerId = nodeDefinition?.providerId
  const isTrigger = nodeDefinition?.isTrigger || false
  const icon = nodeDefinition?.icon
  const category = nodeDefinition?.category

  // Default to LINEAR_STACK_X (400) to keep nodes aligned vertically
  const finalPosition = position ?? { x: 400, y: 120 }
  console.log(`📍 [addNodeEdit] Creating node ${id} with position:`, finalPosition)

  return {
    op: "addNode",
    node: {
      id,
      type,
      label: title,
      description: description,
      config: {},
      inPorts: [],
      outPorts: [],
      io: { inputSchema: undefined, outputSchema: undefined },
      policy: { timeoutMs: 60_000, retries: 0 },
      costHint: 0,
      metadata: {
        position: finalPosition,
        reactFlowType: "custom",
        providerId,
        isTrigger,
        icon,
        category,
      },
    },
  }
}

function applyEdits(current: Flow, edits: PlannerEdit[]): Flow {
  const next: Flow = JSON.parse(JSON.stringify(current))

  for (const edit of edits) {
    switch (edit.op) {
      case "addNode": {
        const exists = next.nodes.find((node) => node.id === edit.node.id)
        if (!exists) {
          next.nodes.push(edit.node)
        }
        break
      }
      case "connect": {
        const key = `${edit.edge.from.nodeId}->${edit.edge.to.nodeId}`
        const exists = next.edges.find((edge) => `${edge.from.nodeId}->${edge.to.nodeId}` === key)
        if (!exists) {
          next.edges.push(edit.edge)
        }
        break
      }
      case "setConfig": {
        const target = next.nodes.find((node) => node.id === edit.nodeId)
        if (target) {
          target.config = {
            ...(target.config ?? {}),
            ...edit.patch,
          }
          const metadata = (target.metadata ?? {}) as any
          const highlights = new Set<string>(metadata.agentHighlights ?? [])
          Object.keys(edit.patch ?? {}).forEach((key) => highlights.add(key))
          metadata.agentHighlights = Array.from(highlights)
          target.metadata = metadata
        }
        break
      }
      case "setInterface": {
        const existing = next.interface ?? { inputs: [], outputs: [] }
        next.interface = {
          ...existing,
          inputs: edit.inputs ?? existing.inputs,
          outputs: edit.outputs ?? existing.outputs,
        }
        break
      }
      default: {
        const exhaustive: never = edit
        throw new Error(`Unsupported edit operation: ${(exhaustive as any)?.op}`)
      }
    }
  }

  next.version = (next.version ?? 0) + 1
  return next
}

async function getFlow(flowId: string): Promise<FlowFetchResult> {
  const revisionsPayload = await fetchJson<{ revisions?: RevisionSummary[] }>(
    `/workflows/v2/api/flows/${flowId}/revisions`
  )

  const revisions = (revisionsPayload.revisions ?? []).slice().sort((a, b) => b.version - a.version)
  if (revisions.length === 0) {
    throw new Error("Flow revision not found")
  }

  const latest = revisions[0]

  const revisionPayload = await fetchJson<{ revision: { id: string; flowId: string; graph: Flow } }>(
    `/workflows/v2/api/flows/${flowId}/revisions/${latest.id}`
  )

  const parsedFlow = FlowSchema.parse(revisionPayload.revision.graph)

  return {
    flow: parsedFlow,
    revisionId: revisionPayload.revision.id,
  }
}

async function postEdits(flowId: string, baseFlow: Flow, edits: PlannerEdit[]): Promise<FlowFetchResult> {
  const nextFlow = applyEdits(baseFlow, edits)

  const payload = await fetchJson<{ flow: Flow; revisionId?: string }>(
    `/workflows/v2/api/flows/${flowId}/apply-edits`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ flow: nextFlow, version: nextFlow.version }),
    }
  )

  return {
    flow: FlowSchema.parse(payload.flow),
    revisionId: payload.revisionId,
  }
}

export async function getRevisions(flowId: string): Promise<RevisionSummary[]> {
  const payload = await fetchJson<{ revisions?: RevisionSummary[] }>(
    `/workflows/v2/api/flows/${flowId}/revisions`
  )
  return payload.revisions ?? []
}

export async function applyAgentPrompt(flowId: string, promptText: string): Promise<FlowFetchResult> {
  const { flow } = await getFlow(flowId)
  const plannerResult = await fetchJson<{ edits?: PlannerEdit[]; flow?: Flow; errors?: any }>(
    `/workflows/v2/api/flows/${flowId}/edits`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        prompt: promptText,
        flow,
      }),
    }
  )

  const edits = plannerResult.edits ?? []
  if (edits.length === 0) {
    return { flow, revisionId: undefined }
  }

  return postEdits(flowId, flow, edits)
}

export async function startRun(flowId: string, inputs: any): Promise<{ runId: string }> {
  const payload = await fetchJson<{ runId: string }>(`/workflows/v2/api/flows/${flowId}/runs`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ inputs }),
  })
  return { runId: payload.runId }
}

export async function getRun(runId: string): Promise<RunSummaryPayload["run"]> {
  const payload = await fetchJson<RunSummaryPayload>(`/workflows/v2/api/runs/${runId}`)
  return payload.run
}

export async function getNodeSnapshot(runId: string, nodeId: string) {
  const payload = await fetchJson<{ snapshot?: any; lineage?: any[] }>(
    `/workflows/v2/api/runs/${runId}/nodes/${nodeId}`
  )
  return {
    snapshot: payload.snapshot,
    lineage: payload.lineage ?? [],
  }
}

export async function runFromHere(runId: string, nodeId: string): Promise<{ runId: string }> {
  const payload = await fetchJson<{ runId: string }>(
    `/workflows/v2/api/runs/${runId}/nodes/${nodeId}/run-from-here`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    }
  )
  return { runId: payload.runId }
}

export async function getEstimate(flowId: string): Promise<any | null> {
  try {
    return await fetchJson<any>(`/workflows/v2/api/flows/${flowId}/estimate`)
  } catch (error: any) {
    console.warn("[FlowV2Adapter] Estimate unavailable", error)
    return null
  }
}

export async function publish(flowId: string): Promise<{ revisionId: string }> {
  const payload = await fetchJson<{ revisionId: string }>(
    `/workflows/v2/api/flows/${flowId}/publish`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    }
  )
  return payload
}

export async function listTemplates(): Promise<any[]> {
  const payload = await fetchJson<{ templates?: any[] }>(`/workflows/v2/api/templates`)
  return payload.templates ?? []
}

export async function createTemplate(flowId: string, options?: { name?: string; description?: string }) {
  await fetchJson(`/workflows/v2/api/templates`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      flowId,
      name: options?.name ?? "Untitled Template",
      description: options?.description,
    }),
  })
}

export async function useTemplate(templateId: string, name?: string): Promise<{ flowId: string; revisionId: string }> {
  const payload = await fetchJson<{ flowId: string; revisionId: string }>(
    `/workflows/v2/api/templates/${templateId}/use`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name }),
    }
  )
  return payload
}

export async function listSecrets(): Promise<Array<{ id: string; name: string }>> {
  const payload = await fetchJson<{ secrets?: Array<{ id: string; name: string }> }>(
    `/workflows/v2/api/secrets`
  )
  return (payload.secrets ?? []).map((secret) => ({
    id: secret.id,
    name: secret.name,
  }))
}

export async function createSecret(name: string, value: string): Promise<void> {
  await fetchJson(`/workflows/v2/api/secrets`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, value }),
  })
}

export async function listSchedules(flowId: string): Promise<any[]> {
  const payload = await fetchJson<{ schedules?: any[] }>(`/workflows/v2/api/schedules?flowId=${flowId}`)
  return payload.schedules ?? []
}

export async function createSchedule(flowId: string, cron: string, timezone = "UTC"): Promise<void> {
  await fetchJson(`/workflows/v2/api/schedules`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      flowId,
      cronExpression: cron,
      timezone,
    }),
  })
}

export async function updateSchedule(
  scheduleId: string,
  updates: { cronExpression?: string; timezone?: string; enabled?: boolean }
): Promise<void> {
  await fetchJson(`/workflows/v2/api/schedules/${scheduleId}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(updates),
  })
}

export async function deleteSchedule(scheduleId: string): Promise<void> {
  await fetchJson(`/workflows/v2/api/schedules/${scheduleId}`, {
    method: "DELETE",
  })
}

interface UseFlowV2Actions {
  refresh: () => Promise<void>
  addNode: (type: string, pos?: { x: number; y: number }) => Promise<void>
  connectEdge: (link: { sourceId: string; targetId: string; sourceHandle?: string; targetHandle?: string }) => Promise<void>
  updateConfig: (nodeId: string, patch: OldConfigPatch) => Promise<void>
  applyAgentPrompt: (promptText: string) => Promise<void>
  run: (inputs: any) => Promise<{ runId: string }>
  runFromHere: (nodeId: string) => Promise<void>
  refreshRun: (runId?: string) => Promise<RunSummaryPayload["run"] | null>
  estimate: () => Promise<any | null>
  publish: () => Promise<void>
  createSecret: (name: string, value: string) => Promise<void>
  listSecrets: () => Promise<Array<{ id: string; name: string }>>
  listSchedules: () => Promise<any[]>
  createSchedule: (cron: string) => Promise<void>
}

interface UseFlowV2Result {
  state: AdapterFlowState
  flow: Flow | null
  actions: UseFlowV2Actions
}

export function useFlowV2(flowId: string): UseFlowV2Result {
  const [state, setState] = useState<AdapterFlowState>({
    flowId,
    nodes: [],
    edges: [],
    version: 0,
    isDirty: false,
  })
  const [flow, setFlow] = useState<Flow | null>(null)
  const flowIdRef = useRef(flowId)
  const revisionIdRef = useRef<string | undefined>(undefined)

  const syncStateFromFlow = useCallback((nextFlow: Flow, revisionId?: string) => {
    const mapped = v2ToOldFlow(nextFlow)
    setFlow(nextFlow)
    setState((prev) => ({
      flowId: nextFlow.id,
      name: mapped.meta.name,
      nodes: mapped.nodes,
      edges: mapped.edges,
      revisionId: revisionId ?? prev.revisionId,
      version: nextFlow.version ?? prev.version,
      isDirty: false,
      lastRunId: prev.lastRunId,
    }))
    revisionIdRef.current = revisionId ?? revisionIdRef.current
  }, [])

  const refresh = useCallback(async () => {
    const { flow: latestFlow, revisionId } = await getFlow(flowIdRef.current)
    syncStateFromFlow(latestFlow, revisionId)
  }, [syncStateFromFlow])

  useEffect(() => {
    flowIdRef.current = flowId
    refresh().catch((error) => {
      console.error("[FlowV2Adapter] Failed to load flow", error)
    })
  }, [flowId, refresh])

  const addNode = useCallback(
    async (type: string, pos?: { x: number; y: number }) => {
      const base = flow ?? (await getFlow(flowIdRef.current)).flow
      const edit = addNodeEdit(type, pos)
      const { flow: updated, revisionId } = await postEdits(flowIdRef.current, base, [edit])
      syncStateFromFlow(updated, revisionId)
    },
    [flow, syncStateFromFlow]
  )

  const connectEdge = useCallback(
    async (link: { sourceId: string; targetId: string; sourceHandle?: string; targetHandle?: string }) => {
      const base = flow ?? (await getFlow(flowIdRef.current)).flow
      const { flow: updated, revisionId } = await postEdits(flowIdRef.current, base, [
        oldConnectToEdge(link.sourceId, link.targetId, link.sourceHandle, link.targetHandle),
      ])
      syncStateFromFlow(updated, revisionId)
    },
    [flow, syncStateFromFlow]
  )

  const updateConfigAction = useCallback(
    async (nodeId: string, patch: OldConfigPatch) => {
      const base = flow ?? (await getFlow(flowIdRef.current)).flow
      const { flow: updated, revisionId } = await postEdits(flowIdRef.current, base, oldConfigPatchToEdits(nodeId, patch).edits)
      syncStateFromFlow(updated, revisionId)
    },
    [flow, syncStateFromFlow]
  )

  const applyAgentPromptAction = useCallback(
    async (promptText: string) => {
      const result = await applyAgentPrompt(flowIdRef.current, promptText)
      syncStateFromFlow(result.flow, result.revisionId)
    },
    [syncStateFromFlow]
  )

  const runAction = useCallback(
    async (inputs: any) => {
      const { runId } = await startRun(flowIdRef.current, inputs)
      setState((prev) => ({ ...prev, lastRunId: runId }))
      return { runId }
    },
    []
  )

  const runFromHereAction = useCallback(
    async (nodeId: string) => {
      const currentRun = state.lastRunId
      if (!currentRun) {
        throw new Error("No run available to resume")
      }
      const { runId } = await runFromHere(currentRun, nodeId)
      setState((prev) => ({ ...prev, lastRunId: runId }))
    },
    [state.lastRunId]
  )

  const refreshRunAction = useCallback(
    async (runId?: string) => {
      const targetRun = runId ?? state.lastRunId
      if (!targetRun) {
        return null
      }
      const run = await getRun(targetRun)
      setState((prev) => ({ ...prev, lastRunId: run.id }))
      return run
    },
    [state.lastRunId]
  )

  const estimateAction = useCallback(async () => {
    return getEstimate(flowIdRef.current)
  }, [])

  const publishAction = useCallback(async () => {
    await publish(flowIdRef.current)
  }, [])

  const createSecretAction = useCallback(async (name: string, value: string) => {
    await createSecret(name, value)
  }, [])

  const listSecretsAction = useCallback(async () => {
    return listSecrets()
  }, [])

  const listSchedulesAction = useCallback(async () => {
    return listSchedules(flowIdRef.current)
  }, [])

  const createScheduleAction = useCallback(async (cron: string) => {
    await createSchedule(flowIdRef.current, cron)
  }, [])

  const actions = useMemo<UseFlowV2Actions>(
    () => ({
      refresh,
      addNode,
      connectEdge,
      updateConfig: updateConfigAction,
      applyAgentPrompt: applyAgentPromptAction,
      run: runAction,
      runFromHere: runFromHereAction,
      refreshRun: refreshRunAction,
      estimate: estimateAction,
      publish: publishAction,
      createSecret: createSecretAction,
      listSecrets: listSecretsAction,
      listSchedules: listSchedulesAction,
      createSchedule: createScheduleAction,
    }),
    [
      refresh,
      addNode,
      connectEdge,
      updateConfigAction,
      applyAgentPromptAction,
      runAction,
      runFromHereAction,
      refreshRunAction,
      estimateAction,
      publishAction,
      createSecretAction,
      listSecretsAction,
      listSchedulesAction,
      createScheduleAction,
    ]
  )

  return { state, flow, actions }
}

