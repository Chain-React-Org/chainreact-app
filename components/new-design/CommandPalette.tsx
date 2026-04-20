"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Command } from "cmdk"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { VisuallyHidden } from "@/components/ui/visually-hidden"
import { useWorkflowStore } from "@/stores/workflowStore"
import { useIntegrationStore } from "@/stores/integrationStore"
import { useCreateAndOpenWorkflow } from "@/hooks/useCreateAndOpenWorkflow"
import { ShortcutBadge } from "@/components/common/GlobalKeyboardShortcuts"
import {
  Home,
  Layout,
  Layers,
  Sparkles,
  BarChart3,
  Settings,
  Plus,
  Search,
  Zap,
  Loader2,
  Users,
  Building,
  CreditCard,
  LifeBuoy,
  User,
  Receipt,
} from "lucide-react"

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Template {
  id: string
  name: string
  description: string
  category: string
}

// Template cache with TTL (5 minutes)
const TEMPLATE_CACHE_TTL = 5 * 60 * 1000
let templateCache: { data: Template[]; timestamp: number } | null = null

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingText, setLoadingText] = useState("")
  const { workflows, fetchWorkflows } = useWorkflowStore()
  const { providers, integrations, fetchIntegrations } = useIntegrationStore()
  const { createAndOpen } = useCreateAndOpenWorkflow()

  // Fetch data when palette opens
  useEffect(() => {
    if (open) {
      fetchWorkflows()
      fetchIntegrations(false)
      fetchTemplates()
    }
  }, [open, fetchWorkflows, fetchIntegrations])

  const fetchTemplates = useCallback(async () => {
    // Check cache first
    const now = Date.now()
    if (templateCache && now - templateCache.timestamp < TEMPLATE_CACHE_TTL) {
      setTemplates(templateCache.data)
      return
    }

    try {
      const response = await fetch("/api/templates/predefined")
      const data = await response.json()
      if (data.templates) {
        // Update cache
        templateCache = { data: data.templates, timestamp: now }
        setTemplates(data.templates)
      }
    } catch (error) {
      console.error("Error fetching templates:", error)
    }
  }, [])

  // Reset loading state when dialog closes
  useEffect(() => {
    if (!open) {
      setLoading(false)
      setLoadingText("")
    }
  }, [open])

  const handleSelect = useCallback(
    (callback: () => void, loadingMessage?: string) => {
      if (loadingMessage) {
        setLoading(true)
        setLoadingText(loadingMessage)
      }
      // Small delay to show the loading state before closing
      setTimeout(() => {
        if (!loadingMessage) {
          onOpenChange(false)
        }
        callback()
      }, loadingMessage ? 100 : 0)
    },
    [onOpenChange]
  )

  // Filter workflows based on search
  const filteredWorkflows = workflows.filter((workflow) =>
    workflow.name.toLowerCase().includes(search.toLowerCase())
  )

  // Filter templates based on search
  const filteredTemplates = templates.filter(
    (template) =>
      template.name.toLowerCase().includes(search.toLowerCase()) ||
      template.description.toLowerCase().includes(search.toLowerCase())
  )

  // Filter integrations based on search
  const connectedApps = integrations.filter((integration) => {
    const provider = providers.find((p) => p.id === integration.provider)
    return provider?.name.toLowerCase().includes(search.toLowerCase())
  })

  const availableApps = providers
    .filter((provider) => {
      const isConnected = integrations.some((i) => i.provider === provider.id)
      return (
        !isConnected &&
        !["ai", "logic", "control"].includes(provider.id) &&
        provider.name.toLowerCase().includes(search.toLowerCase())
      )
    })
    .slice(0, 5) // Limit to 5 results

  // Navigation options with keyword aliases for search
  const pages = [
    { name: "Workflows", href: "/workflows", icon: Home, keywords: ["home", "dashboard", "flows"] },
    { name: "Templates", href: "/templates", icon: Layers, keywords: ["library", "prebuilt"] },
    { name: "Connections", href: "/connections", icon: Layout, keywords: ["connections", "connect", "integrations", "apps"] },
    { name: "Assistant", href: "/ai-assistant", icon: Sparkles, keywords: ["ai", "chat", "assistant", "help", "chainreact"] },
    { name: "Analytics", href: "/analytics", icon: BarChart3, keywords: ["stats", "metrics", "usage", "reports"] },
    { name: "Teams", href: "/teams", icon: Users, keywords: ["members", "team", "invite"] },
    { name: "Organization", href: "/org", icon: Building, keywords: ["org", "company"] },
    { name: "Subscription", href: "/subscription", icon: CreditCard, keywords: ["plan", "billing", "pricing", "upgrade", "my plan"] },
    { name: "Payments", href: "/payments", icon: Receipt, keywords: ["invoices", "billing history", "payment"] },
    { name: "Settings", href: "/settings", icon: Settings, keywords: ["preferences", "config", "account", "profile", "notifications", "appearance", "theme", "security", "2fa", "password", "workspace", "ai context"] },
    { name: "Help & Support", href: "/support", icon: LifeBuoy, keywords: ["help", "support", "faq", "ticket", "contact"] },
  ]

  const filteredPages = pages.filter((page) => {
    const q = search.toLowerCase()
    return (
      page.name.toLowerCase().includes(q) ||
      page.keywords.some((kw) => kw.includes(q))
    )
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 max-w-2xl overflow-hidden">
        <VisuallyHidden>
          <DialogTitle>Command Palette</DialogTitle>
        </VisuallyHidden>
        <Command className="rounded-lg border-none relative">
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <Command.Input
              placeholder="Search workflows, templates, apps, or type a command..."
              value={search}
              onValueChange={setSearch}
              className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <Command.List className="max-h-[400px] overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No results found.
            </Command.Empty>

            {/* Quick Actions */}
            {!search && (
              <Command.Group heading="Quick Actions">
                <Command.Item
                  onSelect={() => handleSelect(() => createAndOpen(), "Creating workflow...")}
                  className="flex items-center justify-between px-2 py-2 cursor-pointer rounded-sm hover:bg-accent"
                >
                  <div className="flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    <span>Create New Workflow</span>
                  </div>
                  <ShortcutBadge shortcut={{ key: "n", ctrl: true }} />
                </Command.Item>
                <Command.Item
                  onSelect={() => handleSelect(() => router.push("/connections"))}
                  className="flex items-center justify-between px-2 py-2 cursor-pointer rounded-sm hover:bg-accent"
                >
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    <span>Connect New App</span>
                  </div>
                  <span className="text-xs text-muted-foreground">g i</span>
                </Command.Item>
                <Command.Item
                  onSelect={() => handleSelect(() => router.push("/templates"))}
                  className="flex items-center justify-between px-2 py-2 cursor-pointer rounded-sm hover:bg-accent"
                >
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    <span>Browse Templates</span>
                  </div>
                  <span className="text-xs text-muted-foreground">g t</span>
                </Command.Item>
              </Command.Group>
            )}

            {/* Pages/Navigation */}
            {filteredPages.length > 0 && (
              <Command.Group heading="Pages">
                {filteredPages.map((page) => (
                  <Command.Item
                    key={page.href}
                    onSelect={() => handleSelect(() => router.push(page.href))}
                    className="flex items-center gap-2 px-2 py-2 cursor-pointer rounded-sm hover:bg-accent"
                  >
                    <page.icon className="h-4 w-4" />
                    <span>{page.name}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Workflows */}
            {filteredWorkflows.length > 0 && (
              <Command.Group heading="Workflows">
                {filteredWorkflows.slice(0, 5).map((workflow) => (
                  <Command.Item
                    key={workflow.id}
                    onSelect={() =>
                      handleSelect(
                        () => router.push(`/workflows/builder/${workflow.id}`),
                        `Opening ${workflow.name}...`
                      )
                    }
                    className="flex items-center gap-2 px-2 py-2 cursor-pointer rounded-sm hover:bg-accent"
                  >
                    <Zap className="h-4 w-4" />
                    <div className="flex flex-col">
                      <span>{workflow.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {workflow.status === "active" ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Templates */}
            {filteredTemplates.length > 0 && (
              <Command.Group heading="Templates">
                {filteredTemplates.slice(0, 5).map((template) => (
                  <Command.Item
                    key={template.id}
                    onSelect={() => handleSelect(() => router.push("/templates"))}
                    className="flex items-center gap-2 px-2 py-2 cursor-pointer rounded-sm hover:bg-accent"
                  >
                    <Layers className="h-4 w-4" />
                    <div className="flex flex-col">
                      <span>{template.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {template.category}
                      </span>
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Connected Apps */}
            {connectedApps.length > 0 && (
              <Command.Group heading="Connected Apps">
                {connectedApps.slice(0, 5).map((integration) => {
                  const provider = providers.find((p) => p.id === integration.provider)
                  return (
                    <Command.Item
                      key={integration.id}
                      onSelect={() => handleSelect(() => router.push("/connections"))}
                      className="flex items-center gap-2 px-2 py-2 cursor-pointer rounded-sm hover:bg-accent"
                    >
                      <div className="w-4 h-4 rounded flex items-center justify-center bg-white dark:bg-slate-900 border">
                        <img
                          src={`/integrations/${integration.provider}.svg`}
                          alt={provider?.name}
                          className="w-3 h-3 object-contain"
                          onError={(e) => {
                            e.currentTarget.style.display = "none"
                          }}
                        />
                      </div>
                      <span>{provider?.name}</span>
                    </Command.Item>
                  )
                })}
              </Command.Group>
            )}

            {/* Available Apps */}
            {availableApps.length > 0 && search && (
              <Command.Group heading="Available Apps">
                {availableApps.map((provider) => (
                  <Command.Item
                    key={provider.id}
                    onSelect={() => handleSelect(() => router.push("/connections"))}
                    className="flex items-center gap-2 px-2 py-2 cursor-pointer rounded-sm hover:bg-accent"
                  >
                    <div className="w-4 h-4 rounded flex items-center justify-center bg-white dark:bg-slate-900 border">
                      <img
                        src={`/integrations/${provider.id}.svg`}
                        alt={provider.name}
                        className="w-3 h-3 object-contain"
                        onError={(e) => {
                          e.currentTarget.style.display = "none"
                        }}
                      />
                    </div>
                    <div className="flex flex-col">
                      <span>{provider.name}</span>
                      <span className="text-xs text-muted-foreground">Not connected</span>
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>

          {/* Loading Overlay */}
          {loading && (
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 rounded-lg">
              <div className="flex flex-col items-center gap-3 p-6 bg-card border rounded-xl shadow-lg">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm font-medium">{loadingText}</p>
              </div>
            </div>
          )}
        </Command>
      </DialogContent>
    </Dialog>
  )
}
