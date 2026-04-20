"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuthStore } from "@/stores/authStore"
import { useDebugStore } from "@/stores/debugStore"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Building2,
  Trash2,
  Save,
  Loader2,
  Crown,
  CreditCard,
  Settings,
  Users,
  ArrowLeft,
  Plug,
  Share2,
  MoreVertical,
  RefreshCw,
  Unplug,
  Plus,
  CheckCircle2,
  ExternalLink,
  Shield
} from "lucide-react"
import { toast } from "sonner"
import { TeamContent } from "./TeamContent"
import { OrganizationMembersManager } from "@/components/organizations/OrganizationMembersManager"
import { useIntegrationStore } from "@/stores/integrationStore"
import { ShareConnectionDialog } from "@/components/workflows/configuration/ShareConnectionDialog"
import { getIntegrationLogoClasses, getIntegrationLogoPath } from "@/lib/integrations/logoStyles"
import { useTheme } from "next-themes"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { IntegrationService } from "@/services/integration-service"
import { SSOConfiguration } from "@/components/organizations/SSOConfiguration"

interface Organization {
  id: string
  name: string
  slug: string
  description?: string
  logo_url?: string
  billing_email?: string
  owner_id: string
  user_role: string
  member_count: number
  team_count: number
  created_at: string
  is_workspace?: boolean
  billing?: {
    plan?: string
    tasksRemaining?: number
    billing_source?: 'owner' | 'organization'
  }
}

type SettingsSection = 'general' | 'integrations' | 'teams' | 'members' | 'billing' | 'sso'

interface OrganizationSettingsContentProps {
  slugParam?: string
  sectionParam?: string
}

export function OrganizationSettingsContent({ slugParam, sectionParam: sectionProp }: OrganizationSettingsContentProps = {}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuthStore()
  const { logEvent } = useDebugStore()
  const { theme } = useTheme()
  const { providers, integrations, fetchAllIntegrations, connectIntegration } = useIntegrationStore()
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [openingPortal, setOpeningPortal] = useState(false)

  // Support both new slug-based route and legacy ?org= query param
  const legacySectionParam = searchParams.get('section') as SettingsSection | null
  const legacyOrgIdParam = searchParams.get('org')
  const orgIdParam = legacyOrgIdParam // slug is resolved to ID via fetch
  const [activeSection, setActiveSection] = useState<SettingsSection>((sectionProp || legacySectionParam || 'general') as SettingsSection)

  // Form state
  const [orgName, setOrgName] = useState("")
  const [orgDescription, setOrgDescription] = useState("")
  const [billingEmail, setBillingEmail] = useState("")

  // Integration sharing state
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [integrationToShare, setIntegrationToShare] = useState<{ id: string; provider: string; email?: string; displayName?: string } | null>(null)
  const [integrationLoading, setIntegrationLoading] = useState<Record<string, boolean>>({})

  // Prevent double-fetch in React 18 Strict Mode
  const hasFetchedRef = useRef(false)
  const fetchingRef = useRef(false)

  // Reset fetch guards on unmount
  useEffect(() => {
    return () => {
      hasFetchedRef.current = false
      fetchingRef.current = false
    }
  }, [])

  // Update active section when URL parameter changes
  const resolvedSection = sectionProp || legacySectionParam
  useEffect(() => {
    if (resolvedSection && ['general', 'integrations', 'teams', 'members', 'billing', 'sso'].includes(resolvedSection)) {
      setActiveSection(resolvedSection as SettingsSection)
    }
  }, [resolvedSection])

  // Fetch integrations when viewing integrations section
  useEffect(() => {
    if (activeSection === 'integrations' && user) {
      fetchAllIntegrations()
    }
  }, [activeSection, user, fetchAllIntegrations])

  // Helper to build settings URL for this org
  const buildSettingsUrl = (section?: string) => {
    const slug = organization?.slug || slugParam
    if (slug) {
      return `/org/${slug}/settings${section && section !== 'general' ? `/${section}` : ''}`
    }
    // Fallback to legacy URL
    const orgParam = organization?.id ? `&org=${organization.id}` : ''
    return `/org/settings${orgParam}`
  }

  // Fetch current organization
  useEffect(() => {
    if (user && (orgIdParam || slugParam)) {
      const identifier = orgIdParam || slugParam!
      if (!hasFetchedRef.current && !fetchingRef.current) {
        hasFetchedRef.current = true
        fetchOrganization(identifier)
      } else if (organization && organization.id !== identifier && organization.slug !== identifier) {
        hasFetchedRef.current = false
        fetchingRef.current = false
        fetchOrganization(identifier)
      }
    } else if (user && !orgIdParam && !slugParam) {
      // No org ID or slug — try to auto-select the user's org
      const autoSelect = async () => {
        try {
          const res = await fetch('/api/organizations')
          if (!res.ok) { setLoading(false); return }
          const data = await res.json()
          const orgs = Array.isArray(data) ? data : data.organizations || []
          if (orgs.length === 1) {
            router.replace(`/organization/${orgs[0].slug}/settings`)
          } else {
            setLoading(false)
          }
        } catch {
          setLoading(false)
        }
      }
      autoSelect()
    }
  }, [user, orgIdParam, slugParam])

  // Listen for organization changes
  useEffect(() => {
    const handleOrgChange = (event: CustomEvent) => {
      const org = event.detail
      fetchOrganization(org.id)
    }

    window.addEventListener('organization-changed', handleOrgChange as EventListener)
    return () => {
      window.removeEventListener('organization-changed', handleOrgChange as EventListener)
    }
  }, [])

  const fetchOrganization = async (identifier: string) => {
    if (fetchingRef.current) return

    try {
      fetchingRef.current = true
      setLoading(true)
      logEvent('info', 'OrgSettings', 'Fetching organization...', { identifier })

      // If identifier looks like a UUID, fetch directly. Otherwise resolve slug first.
      let orgId = identifier
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)

      if (!isUUID) {
        // Resolve slug to org ID via the list endpoint
        const listRes = await fetch('/api/organizations')
        if (!listRes.ok) throw new Error('Failed to fetch organizations')
        const listData = await listRes.json()
        const allOrgs = Array.isArray(listData) ? listData : listData.organizations || []
        const match = allOrgs.find((o: any) => o.slug === identifier)
        if (!match) throw new Error('Organization not found')
        orgId = match.id
      }

      const response = await fetch(`/api/organizations/${orgId}`)
      if (!response.ok) throw new Error('Failed to fetch organization')

      const data = await response.json()
      const org = Array.isArray(data) ? data[0] : data

      // Debug logging to Admin Debug Panel
      logEvent('info', 'OrgSettings', 'Organization data received', {
        name: org.name,
        hasBilling: !!org.billing,
        billingPlan: org.billing?.plan,
        billingTasksRemaining: org.billing?.tasksRemaining,
        billingSource: org.billing?.billing_source
      })

      setOrganization(org)

      // Populate form
      setOrgName(org.name || "")
      setOrgDescription(org.description || "")
      setBillingEmail(org.billing_email || "")
    } catch (error) {
      logEvent('error', 'OrgSettings', 'Failed to fetch organization', { error })
      toast.error('Failed to load organization')
    } finally {
      setLoading(false)
      fetchingRef.current = false
    }
  }

  const handleSaveSettings = async () => {
    if (!organization) return

    if (!orgName.trim()) {
      toast.error('Organization name is required')
      return
    }

    try {
      setSaving(true)
      const response = await fetch(`/api/organizations/${organization.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: orgName.trim(),
          description: orgDescription.trim() || null,
          billing_email: billingEmail.trim() || null,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update organization')
      }

      toast.success('Organization updated successfully')

      // Refresh organization data
      fetchOrganization(organization.id)

      // Dispatch event so other components can update
      window.dispatchEvent(new CustomEvent('organization-updated'))
    } catch (error: any) {
      console.error('Error updating organization:', error)
      toast.error(error.message || 'Failed to update organization')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteOrganization = async () => {
    if (!organization) return

    try {
      const response = await fetch(`/api/organizations/${organization.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete organization')
      }

      toast.success('Organization deleted successfully')

      // Clear from localStorage
      localStorage.removeItem('current_workspace_id')

      // Redirect to home or refresh
      router.push('/workflows')
      router.refresh()
    } catch (error: any) {
      console.error('Error deleting organization:', error)
      toast.error(error.message || 'Failed to delete organization')
    }
  }

  const handleOpenBillingPortal = async () => {
    try {
      setOpeningPortal(true)
      const response = await fetch('/api/billing/portal', {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()

        // If no subscription exists, redirect to billing page to upgrade
        if (error.error === 'No subscription found') {
          toast.error('Please upgrade to a paid plan first')
          router.push('/settings?section=billing')
          return
        }

        throw new Error(error.error || 'Failed to open billing portal')
      }

      const { url } = await response.json()
      if (url) {
        window.location.href = url
      }
    } catch (error: any) {
      console.error('Error opening billing portal:', error)
      toast.error(error.message || 'Failed to open billing portal')
    } finally {
      setOpeningPortal(false)
    }
  }

  const isOwner = organization?.owner_id === user?.id
  const isAdmin = organization?.user_role === 'admin' || isOwner

  // Check if current selection is a personal workspace
  const isPersonalWorkspace = organization?.is_workspace || (organization?.team_count === 0 && organization?.member_count === 1)

  // Navigation items
  const navigationItems = [
    { id: 'general' as const, label: 'General', icon: Settings, description: 'Organization details and settings' },
    { id: 'integrations' as const, label: 'Apps', icon: Plug, description: 'Connected apps and sharing' },
    { id: 'teams' as const, label: 'Teams', icon: Users, description: 'Manage organization teams' },
    { id: 'members' as const, label: 'Members', icon: Crown, description: 'Manage team members' },
    { id: 'billing' as const, label: 'Billing', icon: CreditCard, description: 'Manage subscription' },
    { id: 'sso' as const, label: 'SSO', icon: Shield, description: 'Single Sign-On settings' },
  ]

  // Filter integrations for this organization
  const orgIntegrations = integrations.filter(i =>
    i.workspace_type === 'organization' && i.workspace_id === organization?.id && i.status === 'connected'
  )

  // Get integrations shared with this organization (from members)
  const sharedWithOrg = integrations.filter(i =>
    i.workspace_type === 'personal' &&
    (i as any).sharing_scope === 'organization' &&
    i.status === 'connected' &&
    i.user_id !== user?.id // Not owned by current user
  )

  // Integration handlers
  const handleConnectToOrg = async (providerId: string) => {
    if (!organization) return
    setIntegrationLoading(prev => ({ ...prev, [providerId]: true }))
    try {
      await connectIntegration(providerId, 'organization', organization.id)
    } catch (error: any) {
      if (!error?.message?.toLowerCase().includes('cancel')) {
        toast.error(error?.message || 'Failed to connect integration')
      }
    } finally {
      setIntegrationLoading(prev => ({ ...prev, [providerId]: false }))
    }
  }

  const handleDisconnectIntegration = async (integrationId: string, providerName: string) => {
    setIntegrationLoading(prev => ({ ...prev, [integrationId]: true }))
    try {
      await IntegrationService.disconnectIntegration(integrationId)
      toast.success(`${providerName} has been disconnected.`)
      fetchAllIntegrations()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to disconnect integration')
    } finally {
      setIntegrationLoading(prev => ({ ...prev, [integrationId]: false }))
    }
  }

  if (loading && !organization) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!organization && !loading) {
    return <OrganizationPicker onSelect={(slug) => {
      router.push(`/org/${slug}/settings`)
    }} />
  }

  // Show special UI for personal workspaces
  if (isPersonalWorkspace) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <Card className="max-w-2xl w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Building2 className="w-6 h-6 text-muted-foreground" />
            </div>
            <CardTitle>No Organization</CardTitle>
            <CardDescription>
              You're currently in your personal workspace. Create an organization to collaborate with teams.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              size="lg"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('create-organization'))
              }}
            >
              <Building2 className="w-4 h-4 mr-2" />
              Create Organization
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // At this point organization is guaranteed non-null by the guards above
  const org = organization!

  return (
    <div className="w-full">
      <div className="w-full">
        {/* General Settings */}
        {activeSection === 'general' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold">General Settings</h2>
              <p className="text-muted-foreground mt-2">Update your organization's basic information</p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Organization Details</CardTitle>
                <CardDescription>Update your organization's basic information</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="org-name">Organization Name *</Label>
                  <Input
                    id="org-name"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    disabled={!isAdmin}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="org-slug">URL Slug</Label>
                  <Input
                    id="org-slug"
                    value={org.slug}
                    disabled
                    className="bg-muted"
                  />
                  <p className="text-xs text-muted-foreground">
                    The URL slug cannot be changed
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="org-description">Description</Label>
                  <Textarea
                    id="org-description"
                    value={orgDescription}
                    onChange={(e) => setOrgDescription(e.target.value)}
                    rows={3}
                    disabled={!isAdmin}
                    placeholder="What does your organization do?"
                  />
                </div>

                {isAdmin && (
                  <Button onClick={handleSaveSettings} disabled={saving} className="bg-orange-500 hover:bg-orange-600 text-white">
                    {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {!saving && <Save className="w-4 h-4 mr-2" />}
                    Save Changes
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Danger Zone */}
            {isOwner && (
              <Card className="border-destructive">
                <CardHeader>
                  <CardTitle className="text-destructive">Danger Zone</CardTitle>
                  <CardDescription>
                    Irreversible and destructive actions
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold">Delete Organization</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Permanently delete this organization and all its data. This action cannot be undone.
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      onClick={() => setDeleteDialogOpen(true)}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Integrations Section */}
        {activeSection === 'integrations' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold">Integrations</h2>
              <p className="text-muted-foreground mt-2">Manage connected apps for your organization</p>
            </div>

            {/* Organization Connected Apps */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Organization Connections</CardTitle>
                    <CardDescription>Apps connected directly to {org.name}</CardDescription>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button>
                        <Plus className="w-4 h-4 mr-2" />
                        Connect App
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-y-auto">
                      {providers
                        .filter(p => !["ai", "logic", "control"].includes(p.id))
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(provider => (
                          <DropdownMenuItem
                            key={provider.id}
                            onClick={() => handleConnectToOrg(provider.id)}
                            disabled={integrationLoading[provider.id]}
                          >
                            <div className="flex items-center gap-2 w-full">
                              <img
                                src={getIntegrationLogoPath(provider.id, theme)}
                                alt={provider.name}
                                className={getIntegrationLogoClasses(provider.id, "w-5 h-5 object-contain")}
                                onError={(e) => { e.currentTarget.style.display = 'none' }}
                              />
                              <span>{provider.name}</span>
                              {integrationLoading[provider.id] && (
                                <Loader2 className="w-4 h-4 animate-spin ml-auto" />
                              )}
                            </div>
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                {orgIntegrations.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Plug className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No apps connected to this organization yet</p>
                    <p className="text-sm mt-1">Connect an app to make it available to all organization members</p>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {orgIntegrations.map(integration => {
                      const provider = providers.find(p => p.id === integration.provider)
                      if (!provider) return null

                      return (
                        <div
                          key={integration.id}
                          className="group flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-lg border flex items-center justify-center flex-shrink-0 bg-white dark:bg-slate-900">
                              <img
                                src={getIntegrationLogoPath(provider.id, theme)}
                                alt={provider.name}
                                className={getIntegrationLogoClasses(provider.id)}
                                onError={(e) => { e.currentTarget.style.display = 'none' }}
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium truncate">{provider.name}</span>
                                <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                              </div>
                              {integration.email && (
                                <p className="text-xs text-muted-foreground truncate">{integration.email}</p>
                              )}
                            </div>
                          </div>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setIntegrationToShare({
                                    id: integration.id,
                                    provider: provider.id,
                                    email: integration.email,
                                    displayName: integration.account_name || integration.email || provider.name
                                  })
                                  setShareDialogOpen(true)
                                }}
                              >
                                <Share2 className="w-4 h-4 mr-2" />
                                Share
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleConnectToOrg(provider.id)}
                                disabled={integrationLoading[provider.id]}
                              >
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Reconnect
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => handleDisconnectIntegration(integration.id, provider.name)}
                                disabled={integrationLoading[integration.id]}
                              >
                                <Unplug className="w-4 h-4 mr-2" />
                                Disconnect
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Shared with Organization */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Share2 className="w-5 h-5" />
                  Shared with Organization
                </CardTitle>
                <CardDescription>
                  Personal connections that members have shared with everyone in the organization
                </CardDescription>
              </CardHeader>
              <CardContent>
                {sharedWithOrg.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Share2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No shared connections yet</p>
                    <p className="text-sm mt-1">Members can share their personal connections with the organization</p>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {sharedWithOrg.map(integration => {
                      const provider = providers.find(p => p.id === integration.provider)
                      if (!provider) return null

                      return (
                        <div
                          key={integration.id}
                          className="flex items-center justify-between p-4 border rounded-lg bg-muted/30"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-lg border flex items-center justify-center flex-shrink-0 bg-white dark:bg-slate-900">
                              <img
                                src={getIntegrationLogoPath(provider.id, theme)}
                                alt={provider.name}
                                className={getIntegrationLogoClasses(provider.id)}
                                onError={(e) => { e.currentTarget.style.display = 'none' }}
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium truncate">{provider.name}</span>
                                <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-400 dark:border-orange-800/50">
                                  Shared
                                </Badge>
                              </div>
                              {integration.email && (
                                <p className="text-xs text-muted-foreground truncate">{integration.email}</p>
                              )}
                            </div>
                          </div>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="secondary" className="text-xs">
                                  Use Only
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>You can use this connection in workflows but cannot manage it</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Help Section */}
            <Card className="border-dashed">
              <CardContent className="py-6">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <ExternalLink className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-semibold">How sharing works</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      Organization connections are available to all members. Members can also share their
                      personal connections with the organization - shared connections can be used in workflows
                      but credentials remain private to the owner.
                    </p>
                    <Button variant="link" className="px-0 h-auto mt-2" onClick={() => router.push('/connections')}>
                      Manage all your connections →
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Teams Section */}
        {activeSection === 'teams' && (
          <TeamContent organizationId={org.id} />
        )}

        {/* Members Section */}
        {activeSection === 'members' && (
          <OrganizationMembersManager
            organizationId={org.id}
            currentUserRole={org.user_role as any}
          />
        )}

        {/* Billing Section */}
        {activeSection === 'billing' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold">Billing & Subscription</h2>
              <p className="text-muted-foreground mt-2">Manage your organization's subscription through Stripe</p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Current Plan</CardTitle>
                <CardDescription>
                  {organization?.billing?.billing_source === 'owner'
                    ? 'Organization inherits billing from the owner\'s personal account'
                    : 'Your organization\'s subscription is managed through Stripe'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between p-6 border rounded-lg bg-muted/50">
                  <div>
                    <h3 className="font-semibold text-lg">
                      {organization?.billing?.plan
                        ? `${organization.billing.plan.charAt(0).toUpperCase() + organization.billing.plan.slice(1)} Plan`
                        : 'Free Plan'}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {organization?.billing?.billing_source === 'owner'
                        ? 'Managed by organization owner'
                        : organization?.billing?.plan === 'pro'
                        ? 'Advanced features for growing teams'
                        : organization?.billing?.plan === 'enterprise'
                        ? 'Full platform access with premium support'
                        : 'Basic features for small teams'}
                    </p>
                    {organization?.billing?.tasksRemaining !== undefined && organization?.billing?.tasksRemaining !== null && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {organization.billing.tasksRemaining.toLocaleString()} tasks remaining
                      </p>
                    )}
                  </div>
                  <Button
                    onClick={() => router.push('/settings?section=billing')}
                    className="gap-2 bg-orange-500 hover:bg-orange-600 text-white"
                  >
                    <CreditCard className="w-4 h-4" />
                    {organization?.billing?.plan === 'free' || !organization?.billing?.plan ? 'Upgrade Plan' : 'Manage Plan'}
                  </Button>
                </div>

                <div className="pt-4 border-t">
                  <h4 className="font-semibold mb-3">Plan Includes</h4>
                  <div className="grid gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <div className="w-2 h-2 rounded-full bg-green-500"></div>
                      <span>Unlimited workflows</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <div className="w-2 h-2 rounded-full bg-green-500"></div>
                      <span>{organization?.billing?.plan === 'enterprise' ? 'Unlimited' : organization?.billing?.plan === 'pro' ? 'Up to 25' : 'Up to 5'} team members</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <div className="w-2 h-2 rounded-full bg-green-500"></div>
                      <span>{organization?.billing?.plan === 'enterprise' ? 'Priority support' : organization?.billing?.plan === 'pro' ? 'Email support' : 'Community support'}</span>
                    </div>
                  </div>
                </div>

                {organization?.billing?.billing_source === 'owner' && (
                  <div className="p-4 border rounded-lg bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900">
                    <p className="text-sm text-orange-900 dark:text-orange-200">
                      <strong>Note:</strong> This organization uses the owner's personal plan and quota.
                      To upgrade, the organization owner should manage their plan in personal settings.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Billing Management</CardTitle>
                <CardDescription>
                  All billing information is securely managed through Stripe
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  To view invoices, update payment methods, or manage your subscription, use the Stripe Customer Portal.
                </p>
                <Button
                  variant="outline"
                  className="w-full sm:w-auto gap-2"
                  onClick={handleOpenBillingPortal}
                  disabled={openingPortal}
                >
                  {openingPortal ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Opening Portal...
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4" />
                      Open Billing Portal
                    </>
                  )}
                </Button>

                <div className="pt-4 border-t space-y-2">
                  <h4 className="font-semibold text-sm">What you can do in the portal:</h4>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                    <li>Update payment methods</li>
                    <li>View billing history and invoices</li>
                    <li>Update billing address</li>
                    <li>Cancel or modify your subscription</li>
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Billing Contact</CardTitle>
                <CardDescription>
                  Email address for billing-related communications
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="billing-email">Billing Email</Label>
                  <Input
                    id="billing-email"
                    type="email"
                    value={billingEmail}
                    onChange={(e) => setBillingEmail(e.target.value)}
                    disabled={!isAdmin}
                    placeholder="billing@example.com"
                  />
                </div>

                {isAdmin && (
                  <Button onClick={handleSaveSettings} disabled={saving} className="bg-orange-500 hover:bg-orange-600 text-white">
                    {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {!saving && <Save className="w-4 h-4 mr-2" />}
                    Save Changes
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* SSO Section */}
        {activeSection === 'sso' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold">Single Sign-On</h2>
              <p className="text-muted-foreground mt-2">Configure SAML or OIDC authentication for your organization</p>
            </div>

            <SSOConfiguration
              organizationId={org.id}
              isOwner={isOwner}
            />
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{org.name}</strong> and remove all
              associated data including teams, workflows, and member access. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteOrganization}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Organization
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Share Connection Dialog */}
      {integrationToShare && (
        <ShareConnectionDialog
          open={shareDialogOpen}
          onOpenChange={(open) => {
            setShareDialogOpen(open)
            if (!open) {
              setIntegrationToShare(null)
            }
          }}
          integrationId={integrationToShare.id}
          providerId={integrationToShare.provider}
          providerName={providers.find(p => p.id === integrationToShare.provider)?.name || integrationToShare.provider}
          email={integrationToShare.email}
          displayName={integrationToShare.displayName}
          onShareUpdated={() => {
            toast.success('Sharing settings updated')
            setShareDialogOpen(false)
            setIntegrationToShare(null)
            fetchAllIntegrations()
          }}
        />
      )}
    </div>
  )
}

function OrganizationPicker({ onSelect }: { onSelect: (orgSlug: string) => void }) {
  const [orgs, setOrgs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  useEffect(() => {
    fetch('/api/organizations')
      .then(res => res.ok ? res.json() : { organizations: [] })
      .then(data => setOrgs(Array.isArray(data) ? data : data.organizations || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (orgs.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <Building2 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <h2 className="text-lg font-semibold mb-1">No organization yet</h2>
        <p className="text-sm text-muted-foreground mb-4">Create an organization to collaborate with your team.</p>
        <Button onClick={() => window.dispatchEvent(new CustomEvent('create-organization'))}>
          <Plus className="w-4 h-4 mr-1.5" />
          Create Organization
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto py-8">
      <h2 className="text-lg font-semibold mb-1">Select an organization</h2>
      <p className="text-sm text-muted-foreground mb-4">Choose which organization to manage.</p>
      <div className="space-y-2">
        {orgs.map((org: any) => (
          <button
            key={org.id}
            onClick={() => onSelect(org.slug || org.id)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left hover:bg-muted transition-colors"
          >
            <Building2 className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{org.name}</p>
              {org.description && <p className="text-xs text-muted-foreground truncate">{org.description}</p>}
            </div>
            <span className="text-xs text-muted-foreground">{org.member_count || 0} members</span>
          </button>
        ))}
      </div>
    </div>
  )
}
