"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useIntegrationStore } from "@/stores/integrationStore"
import { useToast } from "@/hooks/use-toast"

export function useTemplateLibrary() {
  const router = useRouter()
  const { toast } = useToast()
  const { integrations } = useIntegrationStore()

  const [templates, setTemplates] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("all")
  const [sortBy, setSortBy] = useState("default")
  const [copying, setCopying] = useState(false)

  // Preview modal state
  const [previewTemplate, setPreviewTemplate] = useState<any>(null)
  const [previewModalOpen, setPreviewModalOpen] = useState(false)

  // Prevent React 18 Strict Mode double-fetch
  const hasFetchedRef = useRef(false)

  useEffect(() => {
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true
      fetchTemplates()
    }
  }, [])

  const fetchTemplates = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/templates/predefined')
      const data = await response.json()
      if (data.templates) {
        const unavailableIntegrations = ['twitter', 'x', 'shopify', 'github']
        const filteredTemplates = data.templates.filter((template: any) =>
          !template.integrations?.some((integration: string) =>
            unavailableIntegrations.includes(integration.toLowerCase())
          )
        )
        setTemplates(filteredTemplates)
      }
    } catch (error) {
      console.error('Error fetching templates:', error)
    } finally {
      setLoading(false)
    }
  }

  const connectedIntegrations = useMemo(
    () => integrations.filter(i => i.status === 'connected').map(i => i.provider),
    [integrations]
  )

  const getTemplateIntegrations = useCallback((template: any): string[] => {
    // Start with the explicit integrations list
    const integrations = new Set<string>(template.integrations || [])

    // Also extract from nodes to catch internal providers (AI, logic, webhook)
    const nodes = template.nodes || template.workflow_json?.nodes || []
    nodes.forEach((node: any) => {
      const nodeType = node.type || node.data?.type || ''
      if (nodeType.startsWith('ai_router') || nodeType.startsWith('ai_agent') || nodeType.startsWith('ai_message') || nodeType.startsWith('ai_')) {
        integrations.add('ai')
      } else if (nodeType.startsWith('logic_') || nodeType.startsWith('schedule_') || nodeType.startsWith('manual_')) {
        integrations.add('logic')
      } else if (nodeType.startsWith('webhook_')) {
        integrations.add('webhook')
      } else if (!template.integrations && node.data?.providerId) {
        integrations.add(node.data.providerId)
      }
    })

    return Array.from(integrations)
  }, [])

  // Categories derived from templates
  const categories = useMemo(
    () => ["all", ...Array.from(new Set(templates.map(t => t.category))).sort()],
    [templates]
  )

  // Category counts — computed against search-filtered but NOT category-filtered templates
  // so selecting a category doesn't zero out other category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    const searchFiltered = templates.filter(t =>
      searchQuery === "" ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase())
    )
    searchFiltered.forEach(t => {
      counts[t.category] = (counts[t.category] || 0) + 1
    })
    return counts
  }, [templates, searchQuery])

  const totalCount = useMemo(
    () => Object.values(categoryCounts).reduce((sum, c) => sum + c, 0),
    [categoryCounts]
  )

  // Filtered and sorted templates
  const filteredTemplates = useMemo(() => {
    return templates
      .filter(template => {
        const matchesSearch = searchQuery === "" ||
          template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          template.description.toLowerCase().includes(searchQuery.toLowerCase())
        const matchesCategory = selectedCategory === "all" || template.category === selectedCategory
        return matchesSearch && matchesCategory
      })
      .sort((a, b) => {
        const diffOrder: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 }
        switch (sortBy) {
          case "easiest":
            return (diffOrder[a.difficulty] ?? 1) - (diffOrder[b.difficulty] ?? 1)
          case "advanced":
            return (diffOrder[b.difficulty] ?? 1) - (diffOrder[a.difficulty] ?? 1)
          case "newest":
            return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
          default:
            return 0
        }
      })
  }, [templates, searchQuery, selectedCategory, sortBy])

  const openPreview = useCallback((template: any) => {
    setPreviewTemplate(template)
    setPreviewModalOpen(true)
  }, [])

  const closePreview = useCallback(() => {
    setPreviewModalOpen(false)
    setPreviewTemplate(null)
  }, [])

  const handleUseTemplate = useCallback(async (template: any) => {
    try {
      setCopying(true)
      const response = await fetch(`/api/templates/${template.id}/copy`, {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create workflow from template')
      }

      const { workflow } = await response.json()

      toast({
        title: "Workflow created!",
        description: `"${workflow.name}" is ready to configure.`,
      })

      setPreviewModalOpen(false)
      router.push(`/workflows/builder/${workflow.id}`)
    } catch (error) {
      console.error('Error creating workflow from template:', error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create workflow from template.",
        variant: "destructive",
      })
    } finally {
      setCopying(false)
    }
  }, [router, toast])

  return {
    templates,
    loading,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    sortBy,
    setSortBy,
    filteredTemplates,
    categories,
    categoryCounts,
    totalCount,
    connectedIntegrations,
    getTemplateIntegrations,
    copying,
    handleUseTemplate,
    previewTemplate,
    previewModalOpen,
    openPreview,
    closePreview,
  }
}
