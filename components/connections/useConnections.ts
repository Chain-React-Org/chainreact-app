"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useIntegrationStore, Integration } from "@/stores/integrationStore"
import { useWorkflowStore } from "@/stores/workflowStore"
import { INTEGRATION_CONFIGS } from "@/lib/integrations/availableIntegrations"
import { useToast } from "@/hooks/use-toast"

export type StatusFilter = "all" | "connected" | "attention"

export interface ConnectionWithMeta extends Integration {
  config: (typeof INTEGRATION_CONFIGS)[string] | undefined
  workflowCount: number
  workflowNames: string[]
}

export function useConnections() {
  const { toast } = useToast()
  const { integrations, loading, fetchIntegrations, reconnectIntegration, deleteIntegration } = useIntegrationStore()
  const { workflows } = useWorkflowStore()

  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [reconnecting, setReconnecting] = useState<string | null>(null)

  // Prevent double-fetch
  const hasFetchedRef = useRef(false)
  useEffect(() => {
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true
      fetchIntegrations(true)
    }
  }, [fetchIntegrations])

  // Build connections with metadata
  const connections: ConnectionWithMeta[] = useMemo(() => {
    return integrations
      .filter(i => i.status !== 'disconnected')
      .map(integration => {
        const config = INTEGRATION_CONFIGS[integration.provider]

        // Count workflows using this integration's provider
        const usingWorkflows = (workflows || []).filter(workflow =>
          Array.isArray(workflow.nodes) && workflow.nodes.some(node => {
            const nodeProvider = node.data?.providerId || node.data?.config?.providerId
            return nodeProvider === integration.provider
          })
        )

        return {
          ...integration,
          config,
          workflowCount: usingWorkflows.length,
          workflowNames: usingWorkflows.slice(0, 3).map(w => w.name),
        }
      })
  }, [integrations, workflows])

  // Status counts
  const statusCounts = useMemo(() => {
    const connected = connections.filter(c => c.status === 'connected').length
    const attention = connections.filter(c =>
      c.status === 'expired' || c.status === 'needs_reauthorization'
    ).length
    return { all: connections.length, connected, attention }
  }, [connections])

  // Filtered connections
  const filteredConnections = useMemo(() => {
    return connections
      .filter(connection => {
        const matchesSearch = searchQuery === "" ||
          (connection.config?.name || connection.provider).toLowerCase().includes(searchQuery.toLowerCase()) ||
          (connection.email || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
          (connection.username || "").toLowerCase().includes(searchQuery.toLowerCase())

        const matchesStatus = statusFilter === "all" ||
          (statusFilter === "connected" && connection.status === "connected") ||
          (statusFilter === "attention" && (connection.status === "expired" || connection.status === "needs_reauthorization"))

        return matchesSearch && matchesStatus
      })
      .sort((a, b) => {
        // Attention items first, then alphabetical
        const aNeeds = a.status === 'expired' || a.status === 'needs_reauthorization' ? 0 : 1
        const bNeeds = b.status === 'expired' || b.status === 'needs_reauthorization' ? 0 : 1
        if (aNeeds !== bNeeds) return aNeeds - bNeeds
        const aName = a.config?.name || a.provider
        const bName = b.config?.name || b.provider
        return aName.localeCompare(bName)
      })
  }, [connections, searchQuery, statusFilter])

  const handleReconnect = useCallback(async (integrationId: string) => {
    try {
      setReconnecting(integrationId)
      await reconnectIntegration(integrationId)
      toast({ title: "Reconnecting...", description: "Please complete the authentication in the popup window." })
    } catch (error) {
      toast({
        title: "Reconnection failed",
        description: error instanceof Error ? error.message : "Could not reconnect. Please try again.",
        variant: "destructive",
      })
    } finally {
      setReconnecting(null)
    }
  }, [reconnectIntegration, toast])

  const handleDisconnect = useCallback(async (integrationId: string, providerName: string) => {
    try {
      setDisconnecting(integrationId)
      await deleteIntegration(integrationId)
      toast({ title: "Disconnected", description: `${providerName} has been disconnected.` })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to disconnect.",
        variant: "destructive",
      })
    } finally {
      setDisconnecting(null)
    }
  }, [deleteIntegration, toast])

  return {
    loading,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    connections: filteredConnections,
    statusCounts,
    disconnecting,
    reconnecting,
    handleReconnect,
    handleDisconnect,
  }
}
