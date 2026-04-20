'use client'

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useAuthStore } from '@/stores/authStore'
import { useIntegrationStore } from '@/stores/integrationStore'
import { usePlanRestrictions } from '@/hooks/use-plan-restrictions'
import { useSignedAvatarUrl } from '@/hooks/useSignedAvatarUrl'
import { UpgradePlanModal } from '@/components/plan-restrictions'
import ShareWorkflowDialog from '@/components/workflows/ShareWorkflowDialog'
import { WorkspaceGroupView } from '@/components/workflows/WorkspaceGroupView'
import { useWorkflowCreation } from '@/hooks/useWorkflowCreation'
import { useCreateAndOpenWorkflow } from '@/hooks/useCreateAndOpenWorkflow'
import { WorkspaceSelectionModal } from '@/components/workflows/WorkspaceSelectionModal'
import { ConnectedNodesDisplay } from '@/components/workflows/ConnectedNodesDisplay'
import { validateWorkflow } from '@/components/workflows/WorkflowStatusBadge'
import { useKeyboardShortcuts, getWorkflowShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useKeyboardShortcutsHelp } from '@/components/common/KeyboardShortcutsHelp'
import { WorkflowFloatingActionBar } from '@/components/common/FloatingActionBar'
import { AdvancedFilters, defaultFilters, matchesFilters, type WorkflowFilters, type SavedFilter } from '@/components/workflows/AdvancedFilters'
import { FavoriteButton } from '@/components/workflows/RecentFavorites'
import { useWorkflowFavorites } from '@/hooks/useWorkflowFavorites'
import { Button } from '@/components/ui/button'
import { ProfessionalSearch } from '@/components/ui/professional-search'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Plus,
  MoreHorizontal,
  Edit,
  Copy,
  Trash2,
  Folder,
  FolderPlus,
  RefreshCw,
  AlertTriangle,
  Workflow,
  FolderInput,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Share2,
  Lock,
  LayoutGrid,
  List,
  Shield,
  Settings,
  Eye,
  Users,
  Building2,
  User,
  Home,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { useToast } from '@/hooks/use-toast'
import { logger } from '@/lib/utils/logger'
import { fetchWithTimeout, retryWithBackoff } from '@/lib/utils/fetch-with-timeout'
import { PagePreloader } from '@/components/common/PagePreloader'
import { ListPageSkeleton } from '@/components/common/PageSkeleton'
import { DashboardStats } from '@/components/dashboard/DashboardStats'
import { RecentActivityFeed } from '@/components/dashboard/RecentActivityFeed'
import type { Workflow as WorkflowRecord, WorkflowNode } from '@/stores/workflowStore'

type ViewTab = 'workflows' | 'folders'
type ViewMode = 'grid' | 'list'
type OwnershipFilter = 'all' | 'owned' | 'shared'
type SortField = 'name' | 'updated_at' | 'status'
type SortOrder = 'asc' | 'desc'

interface WorkflowFolder {
  id: string
  name: string
  description: string | null
  user_id: string
  organization_id: string | null
  parent_folder_id: string | null
  color: string
  icon: string
  is_default?: boolean
  is_trash?: boolean
  is_system?: boolean
  created_at: string
  updated_at: string
  workflow_count?: number
}

// Helper component for avatar with signed URL support
function WorkflowAvatar({ avatarUrl, name, initials, className }: { avatarUrl: string | null, name: string, initials: string, className?: string }) {
  const { signedUrl } = useSignedAvatarUrl(avatarUrl || undefined)

  return (
    <Avatar className={className}>
      {signedUrl && (
        <AvatarImage src={signedUrl} alt={name} />
      )}
      <AvatarFallback className="text-xs bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100">
        {initials}
      </AvatarFallback>
    </Avatar>
  )
}

export function WorkflowsContentInner() {
  const router = useRouter()
  const { workflows, loadingList, loadedOnce, fetchWorkflows, updateWorkflow, deleteWorkflow, moveWorkflowToTrash, restoreWorkflowFromTrash, emptyTrash, invalidateCache, duplicateWorkflow, shareWorkflow, batchMoveToFolder, batchTrash, batchDelete, batchRestore, createFolder: storeCreateFolder, updateFolder: storeUpdateFolder, deleteFolder: storeDeleteFolder, setDefaultFolder: storeSetDefaultFolder, activateWorkflow, deactivateWorkflow } = useWorkflowStore()
  const { user, profile } = useAuthStore()
  const { getConnectedProviders } = useIntegrationStore()
  const { checkActionLimit } = usePlanRestrictions()
  const { toast } = useToast()
  const {
    initiateWorkflowCreation,
    showWorkspaceModal,
    handleWorkspaceSelected,
    handleCancelWorkspaceSelection
  } = useWorkflowCreation()
  const { createAndOpen, isCreating: isCreatingWorkflow } = useCreateAndOpenWorkflow()
  const { trackAccess } = useWorkflowFavorites()

  // Version update: No dropdowns, tabs properly aligned - v4
  const statsLastFetchRef = useRef<number>(0)
  const foldersLastFetchRef = useRef<number>(0)
  const CACHE_DURATION = 30000 // 30 seconds cache

  useEffect(() => {
    logger.info('🎯 [WorkflowsContent] Component mounted - v4')
  }, [])

  // REMOVED: Duplicate fetchWorkflows call on mount
  // PagePreloader already fetches workflows before this component renders
  // This was causing unnecessary duplicate API calls and slowing down page load

  const [activeTab, setActiveTab] = useState<ViewTab>('workflows')
  const [workflowsViewMode, setWorkflowsViewMode] = useState<ViewMode>('list')
  const [foldersViewMode, setFoldersViewMode] = useState<ViewMode>('grid')
  const [showWorkspaceGroups, setShowWorkspaceGroups] = useState(false) // NEW: Toggle for workspace grouping
  const [searchQuery, setSearchQuery] = useState('')
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>('all')
  const [ownershipMenuOpen, setOwnershipMenuOpen] = useState(false)
  const [advancedFilters, setAdvancedFilters] = useState<WorkflowFilters>(defaultFilters)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([])

  // Load saved filters from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('workflow_saved_filters')
    if (saved) {
      try {
        setSavedFilters(JSON.parse(saved))
      } catch (e) {
        // Invalid JSON, ignore
      }
    }
  }, [])

  // Save filters to localStorage
  const handleSaveFilter = useCallback((name: string, filters: WorkflowFilters) => {
    const newFilter: SavedFilter = {
      id: Date.now().toString(),
      name,
      filters,
      createdAt: new Date().toISOString()
    }
    const updated = [...savedFilters, newFilter]
    setSavedFilters(updated)
    localStorage.setItem('workflow_saved_filters', JSON.stringify(updated))
  }, [savedFilters])

  const handleDeleteSavedFilter = useCallback((id: string) => {
    const updated = savedFilters.filter(f => f.id !== id)
    setSavedFilters(updated)
    localStorage.setItem('workflow_saved_filters', JSON.stringify(updated))
  }, [savedFilters])

  const handleApplySavedFilter = useCallback((savedFilter: SavedFilter) => {
    setAdvancedFilters(savedFilter.filters)
    // Also sync ownership filter for backwards compatibility
    setOwnershipFilter(savedFilter.filters.ownership)
  }, [])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedFolderFilter, setSelectedFolderFilter] = useState<string | null>(null)
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null) // For nested folder navigation
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; workflowIds: string[]; contextLabel: string }>({
    open: false,
    workflowIds: [],
    contextLabel: ''
  })
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [executionStats, setExecutionStats] = useState<Record<string, { total: number; today: number; success: number; failed: number }>>({})
  const [recentExecutions, setRecentExecutions] = useState<Array<{ id: string; workflowId: string; workflowName: string; status: string; startedAt: string; completedAt: string | null; durationMs: number | null }>>([])
  // Create workflow - now opens builder directly with AI panel visible
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false)
  const [requiredPlan, setRequiredPlan] = useState<string | undefined>()
  const [emptyTrashDialog, setEmptyTrashDialog] = useState(false)
  const [emptyingTrash, setEmptyingTrash] = useState(false)

  // Rename workflow state
  const [renameDialog, setRenameDialog] = useState<{ open: boolean; workflowId: string | null; currentName: string }>({
    open: false,
    workflowId: null,
    currentName: ''
  })
  const [renameValue, setRenameValue] = useState('')

  // Move to folder state
  const [moveFolderDialog, setMoveFolderDialog] = useState<{ open: boolean; workflowIds: string[] }>({
    open: false,
    workflowIds: []
  })
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)

  // Folder state
  const [folders, setFolders] = useState<WorkflowFolder[]>([])
  const [createFolderDialog, setCreateFolderDialog] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderDescription, setNewFolderDescription] = useState('')
  const [deleteFolderDialog, setDeleteFolderDialog] = useState<{ open: boolean; folderId: string | null; folderName: string }>({
    open: false,
    folderId: null,
    folderName: ''
  })
  const [deleteFolderWithWorkflows, setDeleteFolderWithWorkflows] = useState<{
    open: boolean
    folderId: string | null
    folderName: string
    workflowCount: number
    action: 'delete' | 'move' | null
    targetFolderId: string | null
  }>({
    open: false,
    folderId: null,
    folderName: '',
    workflowCount: 0,
    action: null,
    targetFolderId: null
  })
  const [renameFolderDialog, setRenameFolderDialog] = useState<{ open: boolean; folderId: string | null; currentName: string }>({
    open: false,
    folderId: null,
    currentName: ''
  })
  const [renameFolderValue, setRenameFolderValue] = useState('')

  // Sorting state
  const [sortField, setSortField] = useState<SortField>('updated_at')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [shareDialog, setShareDialog] = useState<{ open: boolean; workflowIds: string[] }>({
    open: false,
    workflowIds: []
  })
  const [availableTeams, setAvailableTeams] = useState<any[]>([])
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([])
  const [shareLoading, setShareLoading] = useState(false)

  // Permission management dialog state
  const [permissionDialog, setPermissionDialog] = useState<{ open: boolean; workflowId: string; workflowName: string }>({
    open: false,
    workflowId: '',
    workflowName: ''
  })

  const updateLoadingState = (key: string, value: boolean) => {
    setLoading(prev => {
      const next = { ...prev }
      if (value) {
        next[key] = true
      } else {
        delete next[key]
      }
      return next
    })
  }

  useEffect(() => {
    if (user) {
      // Don't fetch workflows here - PagePreloader already did it
      // This prevents race conditions and duplicate fetches

      // Defer non-critical data fetching to after initial render
      // This makes page navigation feel instant
      const deferredFetchTimer = setTimeout(() => {
        const now = Date.now()
        const promises: Promise<any>[] = []

        // Only fetch stats if cache is stale
        if (now - statsLastFetchRef.current > CACHE_DURATION) {
          promises.push(fetchExecutionStats())
          promises.push(fetchRecentExecutions())
        } else {
          logger.info('[WorkflowsPageContent] Using cached execution stats')
        }

        // Only fetch folders if cache is stale
        if (now - foldersLastFetchRef.current > CACHE_DURATION) {
          promises.push(fetchFolders())
        } else {
          logger.info('[WorkflowsPageContent] Using cached folders')
        }

        // Only fetch if we have uncached data
        if (promises.length > 0) {
          // Fetch stats and folders in parallel for faster loading
          // Using Promise.allSettled to allow partial success
          Promise.allSettled(promises).then((results) => {
            const failures = results.filter(r => r.status === 'rejected')
            if (failures.length > 0) {
              logger.warn('[WorkflowsPageContent] Some initial data fetches failed:', {
                failureCount: failures.length,
                totalCount: results.length
              })
            }
          })
        }
      }, 100) // Defer by 100ms to let the page render first

      return () => clearTimeout(deferredFetchTimer)
    }
  }, [user])

  useEffect(() => {
    if (activeTab !== 'workflows') {
      setOwnershipMenuOpen(false)
    }
  }, [activeTab])

  useEffect(() => {
    if (shareDialog.open && availableTeams.length === 0 && !loadingTeams) {
      fetchTeamsList()
    }
    if (!shareDialog.open) {
      setSelectedTeamIds([])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchTeamsList is not memoized, shareDialog.open is the trigger
  }, [shareDialog.open, availableTeams.length, loadingTeams])

  const fetchExecutionStats = async () => {
    try {
      const response = await fetchWithTimeout('/api/analytics/workflow-stats', {}, 8000)
      if (!response.ok) {
        throw new Error(`Failed to fetch stats: ${response.status}`)
      }
      const data = await response.json()
      if (data.success) {
        setExecutionStats(data.stats || {})
        statsLastFetchRef.current = Date.now()
      }
    } catch (error: any) {
      // Downgrade to debug level since this is non-critical and may happen during prefetch
      logger.info('Failed to fetch execution stats (non-critical):', error)
      // Don't throw - allow page to load without stats
    }
  }

  const fetchRecentExecutions = async () => {
    try {
      const response = await fetchWithTimeout('/api/analytics/dashboard?days=7', {}, 8000)
      if (response.ok) {
        const data = await response.json()
        if (data.recentExecutions) {
          setRecentExecutions(data.recentExecutions)
        }
      }
    } catch (error: any) {
      logger.info('Failed to fetch recent executions (non-critical):', error)
    }
  }

  const fetchFolders = async () => {
    try {
      // First ensure the user has a default folder (non-blocking)
      await fetchWithTimeout('/api/workflows/folders/ensure-default', { method: 'POST' }, 5000).catch(() => {
        // Silently fail - folder creation is not critical
      })

      // Then fetch all folders with timeout protection
      const response = await fetchWithTimeout('/api/workflows/folders', {}, 8000)
      if (!response.ok) {
        throw new Error(`Failed to fetch folders: ${response.status}`)
      }
      const data = await response.json()
      if (data.success) {
        setFolders(data.folders || [])
        foldersLastFetchRef.current = Date.now()
      }
    } catch (error: any) {
      logger.error('Failed to fetch folders:', error)
      // Don't throw - allow page to load without folders
    }
  }

  const fetchTeamsList = async () => {
    setLoadingTeams(true)
    try {
      const response = await fetchWithTimeout('/api/teams', {}, 8000)
      if (!response.ok) {
        throw new Error(`Failed to fetch teams: ${response.status}`)
      }
      const data = await response.json()
      if (data?.teams) {
        setAvailableTeams(data.teams)
      } else if (data?.success === false) {
        toast({
          title: 'Unable to load teams',
          description: data.error || 'An unexpected error occurred.',
          variant: 'destructive'
        })
      }
    } catch (error: any) {
      logger.error('Failed to fetch teams:', error)
      toast({
        title: 'Unable to load teams',
        description: 'Please try again later.',
        variant: 'destructive'
      })
    } finally {
      setLoadingTeams(false)
    }
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  // Get trash folder for current user
  const trashFolder = folders.find(f => f.is_trash === true)

  // Get workflows in trash (those with deleted_at set)
  const trashedWorkflows = workflows.filter(w => w.deleted_at !== null && w.deleted_at !== undefined)

  // Get non-trashed workflows
  const activeWorkflows = workflows.filter(w => !w.deleted_at)

  // Check if user is viewing the trash folder
  const isViewingTrash = selectedFolderFilter === trashFolder?.id

  // Build folder path for breadcrumb (from root to current folder)
  const buildFolderPath = (folderId: string | null): WorkflowFolder[] => {
    if (!folderId) return []

    const path: WorkflowFolder[] = []
    let currentId: string | null = folderId

    // Traverse up the folder tree
    while (currentId) {
      const folder = folders.find(f => f.id === currentId)
      if (!folder) break
      path.unshift(folder) // Add to beginning of array
      currentId = folder.parent_folder_id
    }

    return path
  }

  // Get current folder path for breadcrumb display
  const folderPath = buildFolderPath(currentFolderId)

  // Filter folders to show only children of current folder (for Folders tab)
  const visibleFolders = folders.filter(f => f.parent_folder_id === currentFolderId)

  const filteredAndSortedWorkflows = useMemo(() => {
    const sourceWorkflows = isViewingTrash ? trashedWorkflows : activeWorkflows
    const searchLower = searchQuery.toLowerCase()
    const trashFolderId = trashFolder?.id

    return sourceWorkflows
      .filter((w) => {
        const workflowName = (w.name ?? '').toLowerCase()
        const matchesSearch = workflowName.includes(searchLower)

        // Use advanced filters if any are active, otherwise fall back to simple ownership
        const hasAdvancedFilters = advancedFilters.status.length > 0 ||
          advancedFilters.ownership !== 'all' ||
          advancedFilters.dateRange !== 'all'

        let matchesAdvanced = true
        if (hasAdvancedFilters) {
          matchesAdvanced = matchesFilters(w, advancedFilters, user?.id, validateWorkflow)
        } else {
          // Fall back to simple ownership filter for backwards compatibility
          if (ownershipFilter === 'owned') {
            matchesAdvanced = w.user_id === user?.id
          } else if (ownershipFilter === 'shared') {
            matchesAdvanced = w.user_id !== user?.id
          }
        }

        let matchesFolder = true
        if (selectedFolderFilter && !isViewingTrash) {
          matchesFolder = w.folder_id === selectedFolderFilter
        } else if (!selectedFolderFilter && !isViewingTrash) {
          matchesFolder = !trashFolderId || w.folder_id !== trashFolderId
        }

        return matchesSearch && matchesAdvanced && matchesFolder
      })
      .sort((a, b) => {
        let comparison = 0

        switch (sortField) {
          case 'name':
            comparison = (a.name ?? '').localeCompare(b.name ?? '')
            break
          case 'updated_at':
            comparison =
              new Date(a.updated_at || a.created_at || 0).getTime() -
              new Date(b.updated_at || b.created_at || 0).getTime()
            break
          case 'status':
            comparison = (a.status || 'draft').localeCompare(b.status || 'draft')
            break
          default:
            comparison = 0
        }

        return sortOrder === 'asc' ? comparison : -comparison
      })
  }, [isViewingTrash, trashedWorkflows, activeWorkflows, searchQuery, ownershipFilter, advancedFilters, user?.id, selectedFolderFilter, trashFolder?.id, sortField, sortOrder])

  // Memoize validation results to avoid re-computing on every render
  const workflowValidations = useMemo(() => {
    const validations = new Map<string, ReturnType<typeof validateWorkflow>>()
    for (const workflow of filteredAndSortedWorkflows) {
      validations.set(workflow.id, validateWorkflow(workflow))
    }
    return validations
  }, [filteredAndSortedWorkflows])

  // Helper to get cached validation result
  const getValidation = useCallback((workflowId: string) => {
    return workflowValidations.get(workflowId) || { isValid: false, issues: [] }
  }, [workflowValidations])

  // Filter folders based on search query
  const filteredFolders = visibleFolders.filter((folder) => {
    if (!searchQuery) return true
    return folder.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
           (folder.description && folder.description.toLowerCase().includes(searchQuery.toLowerCase()))
  })

  const stats = useMemo(() => {
    const totalExecs = Object.values(executionStats).reduce((sum, stat) => sum + stat.total, 0)
    const successExecs = Object.values(executionStats).reduce((sum, stat) => sum + stat.success, 0)
    const todayExecs = Object.values(executionStats).reduce((sum, stat) => sum + stat.today, 0)
    return {
      total: activeWorkflows.length,
      active: activeWorkflows.filter(w => w.status === 'active').length,
      totalExecutions: totalExecs,
      todayExecutions: todayExecs,
      successRate: totalExecs > 0 ? Math.round((successExecs / totalExecs) * 100) : 0
    }
  }, [activeWorkflows, executionStats])
  const moveDialogLoading = moveFolderDialog.workflowIds.length > 1
    ? !!loading['move-multi']
    : !!(moveFolderDialog.workflowIds[0] && loading[`move-${moveFolderDialog.workflowIds[0]}`])
  const deleteDialogLabel = deleteDialog.workflowIds.length > 1
    ? `${deleteDialog.workflowIds.length} workflows`
    : deleteDialog.contextLabel
      ? `"${deleteDialog.contextLabel}"`
      : 'this workflow'
  const bulkDuplicateLoading = selectedIds.length > 1
    ? !!loading['duplicate-multi']
    : selectedIds.length === 1
      ? !!loading[`duplicate-${selectedIds[0]}`]
      : false

  const toggleTeamSelection = (teamId: string) => {
    setSelectedTeamIds(prev =>
      prev.includes(teamId) ? prev.filter(id => id !== teamId) : [...prev, teamId]
    )
  }

  const handleShareWorkflows = async () => {
    if (selectedTeamIds.length === 0 || shareDialog.workflowIds.length === 0) {
      toast({
        title: 'Select teams',
        description: 'Choose at least one team to share with.',
        variant: 'destructive'
      })
      return
    }

    setShareLoading(true)
    const failures: string[] = []

    for (const workflowId of shareDialog.workflowIds) {
      try {
        await shareWorkflow(workflowId, selectedTeamIds)
      } catch (error) {
        logger.error('Failed to share workflow', error)
        failures.push(workflowId)
      }
    }

    setShareLoading(false)

    if (failures.length === shareDialog.workflowIds.length) {
      toast({
        title: 'Share failed',
        description: 'Unable to share the selected workflows. Please try again later.',
        variant: 'destructive'
      })
      return
    }

    if (failures.length > 0) {
      toast({
        title: 'Partially shared',
        description: `${shareDialog.workflowIds.length - failures.length} workflows shared successfully. ${failures.length} failed.`,
        variant: 'destructive'
      })
    } else {
      toast({
        title: 'Workflows shared',
        description: shareDialog.workflowIds.length > 1
          ? 'All selected workflows are now shared with the selected teams.'
          : 'Workflow shared successfully.',
      })
    }

    setShareDialog({ open: false, workflowIds: [] })
    setSelectedTeamIds([])
  }

  const duplicateWorkflowRequest = async (workflowId: string) => {
    await duplicateWorkflow(workflowId)
  }

  const handleBulkDuplicate = async (workflowIds: string[]) => {
    if (workflowIds.length === 0) return

    const loadingKey = workflowIds.length > 1 ? 'duplicate-multi' : `duplicate-${workflowIds[0]}`
    updateLoadingState(loadingKey, true)

    let failures = 0
    let successes = 0
    for (const workflowId of workflowIds) {
      try {
        await duplicateWorkflowRequest(workflowId)
        successes += 1
      } catch (error) {
        failures += 1
        logger.error('Bulk duplicate failed', error)
      }
    }

    updateLoadingState(loadingKey, false)
    if (successes > 0) {
      fetchWorkflows(true)
    }

    if (failures === workflowIds.length) {
      toast({
        title: 'Duplicate failed',
        description: 'Unable to duplicate the selected workflows.',
        variant: 'destructive'
      })
    } else if (failures > 0) {
      toast({
        title: 'Partial duplicate',
        description: `${successes} workflows duplicated successfully. ${failures} failed.`,
        variant: 'destructive'
      })
    } else {
      toast({
        title: successes > 1 ? 'Workflows duplicated' : 'Workflow duplicated',
        description: successes > 1
          ? 'All selected workflows were duplicated successfully.'
          : 'A copy of the workflow has been created.',
      })
    }
  }

  const handleBulkMove = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    const firstWorkflow = workflows.find(w => w.id === ids[0])
    openMoveDialogForWorkflows(ids, ids.length === 1 ? firstWorkflow?.folder_id ?? null : null)
  }, [workflows])

  const handleBulkShare = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    openShareDialogForWorkflows(ids)
  }, [])

  const handleBulkDelete = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    openDeleteDialogForWorkflows(ids)
  }, [])

  // Pre-compute workflow IDs for fast select all
  const allVisibleWorkflowIds = useMemo(() =>
    filteredAndSortedWorkflows.map((w) => w.id),
    [filteredAndSortedWorkflows]
  )

  const handleSelectAll = useCallback(() => {
    if (activeTab === 'workflows') {
      setSelectedIds(prev =>
        prev.length === allVisibleWorkflowIds.length ? [] : allVisibleWorkflowIds
      )
    }
  }, [activeTab, allVisibleWorkflowIds])

  const handleSelectOne = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    )
  }, [])

  const openRenameDialogForWorkflow = (workflow: any) => {
    setOpenDropdownId(null) // Close any open dropdown
    setRenameDialog({ open: true, workflowId: workflow.id, currentName: workflow.name })
    setRenameValue(workflow.name)
  }

  const openMoveDialogForWorkflows = (workflowIds: string[], defaultFolderId?: string | null) => {
    if (workflowIds.length === 0) return
    setOpenDropdownId(null) // Close any open dropdown
    setMoveFolderDialog({ open: true, workflowIds })
    // If no folder is specified, default to the default folder
    const targetFolderId = defaultFolderId ?? folders.find(f => f.is_default)?.id ?? null
    setSelectedFolderId(targetFolderId)
  }

  const openShareDialogForWorkflows = (workflowIds: string[]) => {
    if (workflowIds.length === 0) return
    setOpenDropdownId(null) // Close any open dropdown
    setSelectedTeamIds([])
    setShareDialog({ open: true, workflowIds })
  }

  const openPermissionDialogForWorkflow = (workflowId: string) => {
    const workflow = workflows.find(w => w.id === workflowId)
    if (!workflow) return
    setOpenDropdownId(null) // Close any open dropdown
    setPermissionDialog({
      open: true,
      workflowId: workflow.id,
      workflowName: workflow.name
    })
  }

  const openDeleteDialogForWorkflows = (workflowIds: string[]) => {
    if (workflowIds.length === 0) return
    setOpenDropdownId(null) // Close any open dropdown
    const label = workflowIds.length === 1
      ? (workflows.find(w => w.id === workflowIds[0])?.name || 'this workflow')
      : `${workflowIds.length} workflows`
    setDeleteDialog({ open: true, workflowIds, contextLabel: label })
  }


  const getCreatorInfo = (workflow: any) => {
    const enrichedCreator = workflow.creator ?? (workflow.user_id === user?.id ? {
      full_name: profile?.full_name,
      email: profile?.email,
      avatar_url: profile?.avatar_url
    } : null)

    if (enrichedCreator) {
      const { full_name, email, secondary_email, avatar_url } = enrichedCreator
      const rawEmail = email || secondary_email || ''
      const fallbackEmail = rawEmail ? rawEmail.split('@')[0] : ''
      const displayName = full_name || fallbackEmail || 'Team Member'
      const name = workflow.user_id === user?.id ? 'You' : displayName
      const initialsSource = displayName || 'TM'

      return {
        name,
        initials: initialsSource.substring(0, 2).toUpperCase() || 'TM',
        avatar: avatar_url || null
      }
    }

    return {
      name: 'Unknown',
      initials: 'UN',
      avatar: null
    }
  }

  const getFolderName = (workflow: any) => {
    if (workflow.folder_id) {
      const folder = folders.find(f => f.id === workflow.folder_id)
      return folder?.name || 'Unknown Folder'
    }
    if (workflow.organization_id) {
      return 'Team Workflows'
    }
    return 'My Workflows'
  }

  const handleToggleStatus = async (workflow: any, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation()
    }

    const isCurrentlyActive = workflow.status === 'active'
    setLoading(prev => ({ ...prev, [`status-${workflow.id}`]: true }))

    try {
      const endpoint = isCurrentlyActive
        ? `/api/workflows/${workflow.id}/deactivate`
        : `/api/workflows/${workflow.id}/activate`

      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || `Failed to ${isCurrentlyActive ? 'deactivate' : 'activate'} workflow`)
      }

      toast({
        title: isCurrentlyActive ? "Workflow Deactivated" : "Workflow Activated",
        description: data.activation?.message || data.deactivation?.message ||
          `"${workflow.name}" is now ${isCurrentlyActive ? 'inactive' : 'active'}.`,
      })
      fetchWorkflows(true)
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update workflow status",
        variant: "destructive"
      })
    } finally {
      setLoading(prev => ({ ...prev, [`status-${workflow.id}`]: false }))
    }
  }

  const handleRenameWorkflow = async () => {
    if (!renameDialog.workflowId || !renameValue.trim()) {
      toast({
        title: "Name Required",
        description: "Please enter a workflow name.",
        variant: "destructive"
      })
      return
    }

    setLoading(prev => ({ ...prev, [`rename-${renameDialog.workflowId}`]: true }))

    try {
      await updateWorkflow(renameDialog.workflowId, { name: renameValue.trim() })
      toast({
        title: "Workflow Renamed",
        description: `Workflow renamed to "${renameValue}".`,
      })
      setRenameDialog({ open: false, workflowId: null, currentName: '' })
      setRenameValue('')
      fetchWorkflows(true)
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to rename workflow",
        variant: "destructive"
      })
    } finally {
      setLoading(prev => ({ ...prev, [`rename-${renameDialog.workflowId}`]: false }))
    }
  }

  const handleMoveToFolder = async () => {
    if (moveFolderDialog.workflowIds.length === 0) return

    // If no folder selected, require user to select one
    if (!selectedFolderId) {
      toast({
        title: "No folder selected",
        description: "Please select a folder to move the workflow(s) to.",
        variant: "destructive"
      })
      return
    }

    const workflowIds = moveFolderDialog.workflowIds
    const loadingKey = workflowIds.length > 1 ? 'move-multi' : `move-${workflowIds[0]}`
    updateLoadingState(loadingKey, true)

    try {
      const targetFolder = folders.find(f => f.id === selectedFolderId)
      const folderName = targetFolder?.name || 'the selected folder'

      // Use store batch operation for all cases
      await batchMoveToFolder(workflowIds, selectedFolderId!)

      // Close dialog and clear selection first
      setMoveFolderDialog({ open: false, workflowIds: [] })
      setSelectedFolderId(null)
      setSelectedIds([])

      // Refresh folders to update counts
      await fetchFolders()

      // Show success message after UI updates
      toast({
        title: workflowIds.length > 1 ? "Workflows moved" : "Workflow moved",
        description: workflowIds.length > 1
          ? `${workflowIds.length} workflows moved to "${folderName}".`
          : `Workflow moved to "${folderName}".`,
      })
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to move workflow",
        variant: "destructive"
      })
    } finally {
      updateLoadingState(loadingKey, false)
    }
  }

  const handleDuplicate = async (workflow: any) => {
    const loadingKey = `duplicate-${workflow.id}`
    updateLoadingState(loadingKey, true)

    try {
      await duplicateWorkflowRequest(workflow.id)
      toast({
        title: "Workflow duplicated",
        description: `Created a copy of "${workflow.name}"`,
      })
      fetchWorkflows(true)
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to duplicate workflow",
        variant: "destructive"
      })
    } finally {
      updateLoadingState(loadingKey, false)
    }
  }

  const handleDelete = async () => {
    // Capture workflowIds immediately before any state changes
    const workflowIds = [...deleteDialog.workflowIds]

    if (workflowIds.length === 0) {
      logger.warn('handleDelete called with no workflow IDs')
      return
    }

    const loadingKey = workflowIds.length > 1 ? 'delete-multi' : `delete-${workflowIds[0]}`

    logger.info('Starting delete operation for workflows:', workflowIds)

    // Clear dialog state after capturing IDs
    setDeleteDialog({ open: false, workflowIds: [], contextLabel: '' })
    setSelectedIds(prev => prev.filter(id => !workflowIds.includes(id)))
    updateLoadingState(loadingKey, true)

    try {
      if (isViewingTrash) {
        // Permanent delete
        if (workflowIds.length > 1) {
          await batchDelete(workflowIds)
        } else {
          await deleteWorkflow(workflowIds[0])
        }
        toast({
          title: 'Permanently Deleted',
          description: workflowIds.length > 1
            ? `${workflowIds.length} workflows permanently deleted.`
            : 'Workflow permanently deleted.',
        })
      } else {
        // Move to trash
        if (workflowIds.length > 1) {
          await batchTrash(workflowIds)
        } else {
          await moveWorkflowToTrash(workflowIds[0])
        }
        toast({
          title: 'Moved to Trash',
          description: workflowIds.length > 1
            ? `${workflowIds.length} workflows moved to trash. They will be permanently deleted after 7 days.`
            : 'Workflow moved to trash. It will be permanently deleted after 7 days.',
        })
      }

      // Refresh folders to update counts
      await fetchFolders()
    } catch (error: any) {
      logger.error('Delete operation failed:', error)
      toast({
        title: 'Error',
        description: error?.message || 'Failed to process workflows',
        variant: 'destructive'
      })
    } finally {
      updateLoadingState(loadingKey, false)
    }
  }

  // handleCreateWorkflow removed - now opens builder directly with AI panel visible

  const handleEmptyTrash = async () => {
    if (trashedWorkflows.length === 0) return

    setEmptyTrashDialog(false)
    setEmptyingTrash(true)

    try {
      await emptyTrash()

      toast({
        title: 'Trash Emptied',
        description: `${trashedWorkflows.length} workflow${trashedWorkflows.length !== 1 ? 's' : ''} permanently deleted.`,
      })
    } catch (error: any) {
      toast({
        title: 'Failed to empty trash',
        description: error?.message || 'Unable to empty trash. Please try again.',
        variant: 'destructive'
      })
    } finally {
      setEmptyingTrash(false)
    }
  }

  const handleRestoreWorkflow = async (workflowId: string) => {
    const workflow = workflows.find(w => w.id === workflowId)
    if (!workflow) return

    const loadingKey = `restore-${workflowId}`
    updateLoadingState(loadingKey, true)

    // Close the dropdown menu
    setOpenDropdownId(null)

    try {
      await restoreWorkflowFromTrash(workflowId)

      const originalFolder = workflow.original_folder_id
        ? folders.find(f => f.id === workflow.original_folder_id)
        : null

      toast({
        title: 'Workflow Restored',
        description: originalFolder
          ? `"${workflow.name}" has been restored to "${originalFolder.name}".`
          : `"${workflow.name}" has been restored.`,
      })
    } catch (error: any) {
      toast({
        title: 'Restore failed',
        description: error?.message || 'Unable to restore workflow. Please try again.',
        variant: 'destructive'
      })
    } finally {
      updateLoadingState(loadingKey, false)
    }
  }

  const handleBulkRestore = async (workflowIds: string[]) => {
    if (workflowIds.length === 0) return

    const loadingKey = workflowIds.length > 1 ? 'restore-multi' : `restore-${workflowIds[0]}`
    updateLoadingState(loadingKey, true)
    setSelectedIds([])

    try {
      if (workflowIds.length > 1) {
        await batchRestore(workflowIds)
        toast({
          title: 'Workflows Restored',
          description: `${workflowIds.length} workflows restored successfully.`,
        })
      } else {
        await restoreWorkflowFromTrash(workflowIds[0])
        const workflow = workflows.find(w => w.id === workflowIds[0])
        const originalFolder = workflow?.original_folder_id
          ? folders.find(f => f.id === workflow.original_folder_id)
          : null

        toast({
          title: 'Workflow Restored',
          description: originalFolder
            ? `"${workflow?.name}" has been restored to "${originalFolder.name}".`
            : `Workflow restored successfully.`,
        })
      }

      await fetchFolders()
    } catch (error: any) {
      logger.error('Restore operation failed:', error)
      toast({
        title: 'Error',
        description: error?.message || 'Failed to restore workflows',
        variant: 'destructive'
      })
    } finally {
      updateLoadingState(loadingKey, false)
    }
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      toast({
        title: "Name Required",
        description: "Please enter a name for your folder.",
        variant: "destructive"
      })
      return
    }

    setLoading(prev => ({ ...prev, 'create-folder': true }))

    try {
      await storeCreateFolder(newFolderName.trim(), newFolderDescription.trim() || undefined)

      toast({
        title: "Folder Created",
        description: `"${newFolderName}" has been created successfully.`,
      })

      setNewFolderName("")
      setNewFolderDescription("")
      setCreateFolderDialog(false)
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create folder",
        variant: "destructive"
      })
    } finally {
      setLoading(prev => ({ ...prev, 'create-folder': false }))
    }
  }

  const handleRenameFolder = async () => {
    if (!renameFolderDialog.folderId || !renameFolderValue.trim()) return

    const folderId = renameFolderDialog.folderId

    setLoading(prev => ({ ...prev, [`rename-folder-${folderId}`]: true }))

    try {
      await storeUpdateFolder(folderId, { name: renameFolderValue.trim() })

      toast({
        title: "Folder Renamed",
        description: `Folder renamed to "${renameFolderValue}".`,
      })

      setRenameFolderDialog({ open: false, folderId: null, currentName: '' })
      setRenameFolderValue('')
    } catch (error: any) {
      toast({
        title: "Failed to Rename",
        description: error.message || "Failed to rename folder.",
        variant: "destructive"
      })
    } finally {
      setLoading(prev => ({ ...prev, [`rename-folder-${folderId}`]: false }))
    }
  }

  const handleSetDefaultFolder = async (folderId: string, folderName: string) => {
    try {
      await storeSetDefaultFolder(folderId)

      toast({
        title: "Default Folder Updated",
        description: `"${folderName}" is now your default folder.`,
      })
    } catch (error: any) {
      toast({
        title: "Failed to Update",
        description: error.message || "Failed to set default folder.",
        variant: "destructive"
      })
    }
  }

  const handleDeleteFolderClick = (folderId: string, folderName: string) => {
    // Count workflows in this folder
    const workflowsInFolder = workflows.filter(w => w.folder_id === folderId && !w.deleted_at)
    const workflowCount = workflowsInFolder.length

    if (workflowCount === 0) {
      // No workflows, show simple delete dialog
      setDeleteFolderDialog({
        open: true,
        folderId,
        folderName
      })
    } else {
      // Has workflows, show choice dialog
      setDeleteFolderWithWorkflows({
        open: true,
        folderId,
        folderName,
        workflowCount,
        action: null,
        targetFolderId: null
      })
    }
  }

  const handleDeleteFolder = async () => {
    if (!deleteFolderDialog.folderId) return

    const folderId = deleteFolderDialog.folderId
    const folderName = deleteFolderDialog.folderName

    setDeleteFolderDialog({ open: false, folderId: null, folderName: '' })

    try {
      await storeDeleteFolder(folderId)

      toast({
        title: "Folder Deleted",
        description: `"${folderName}" has been deleted.`,
      })
    } catch (error: any) {
      toast({
        title: "Failed to Delete",
        description: error.message || "Failed to delete folder.",
        variant: "destructive"
      })
    }
  }

  const handleDeleteFolderWithWorkflows = async () => {
    const { folderId, folderName, action, targetFolderId } = deleteFolderWithWorkflows

    if (!folderId || !action) return

    setDeleteFolderWithWorkflows({
      open: false,
      folderId: null,
      folderName: '',
      workflowCount: 0,
      action: null,
      targetFolderId: null
    })

    try {
      await storeDeleteFolder(folderId, { action, targetFolderId })

      toast({
        title: "Folder Deleted",
        description: action === 'delete'
          ? `"${folderName}" and all workflows inside have been deleted.`
          : `"${folderName}" has been deleted. Workflows moved to selected folder.`,
      })
    } catch (error: any) {
      toast({
        title: "Failed to Delete",
        description: error.message || "Failed to delete folder.",
        variant: "destructive"
      })
    }
  }

  const ownershipOptions: Array<{ value: OwnershipFilter; label: string }> = [
    { value: 'all', label: 'All Workflows' },
    { value: 'owned', label: 'Owned by Me' },
    { value: 'shared', label: 'Shared with Me' }
  ]

  const handleFolderClick = (folderId: string | null | undefined, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedFolderFilter(folderId ?? null)
    setOwnershipFilter('all') // Reset ownership filter when selecting a folder
    setActiveTab('workflows')
  }

  const handleOwnershipFilterChange = (value: OwnershipFilter) => {
    setOwnershipFilter(value)
    setSelectedFolderFilter(null) // Clear folder filter when changing ownership
  }

  // Get the current filter display label
  const getCurrentFilterLabel = () => {
    if (selectedFolderFilter) {
      const folder = folders.find(f => f.id === selectedFolderFilter)
      return folder?.name || 'Unknown Folder'
    }
    return ownershipOptions.find(option => option.value === ownershipFilter)?.label || 'All Workflows'
  }

  // Search input ref for focus shortcut
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Keyboard shortcuts
  const shortcuts = getWorkflowShortcuts({
    onNew: () => {
      if (!isCreatingWorkflow) {
        createAndOpen()
      }
    },
    onDuplicate: () => {
      if (selectedIds.length === 1) {
        const workflow = workflows.find(w => w.id === selectedIds[0])
        if (workflow) {
          handleDuplicate(workflow)
        }
      }
    },
    onDelete: () => {
      if (selectedIds.length > 0) {
        openDeleteDialogForWorkflows(selectedIds)
      }
    },
    onEdit: () => {
      if (selectedIds.length === 1) {
        router.push(`/workflows/builder/${selectedIds[0]}`)
      }
    },
    onSelectAll: handleSelectAll,
    onDeselectAll: () => setSelectedIds([]),
    onToggleStatus: () => {
      if (selectedIds.length === 1) {
        const workflow = workflows.find(w => w.id === selectedIds[0])
        if (workflow) {
          handleToggleStatus(workflow)
        }
      }
    },
    onSearch: () => {
      searchInputRef.current?.focus()
    }
  })

  useKeyboardShortcuts({ shortcuts })
  const { HelpDialog, isOpen: helpOpen, setIsOpen: setHelpOpen } = useKeyboardShortcutsHelp(shortcuts)

  // Show skeleton until workflows have loaded at least once
  if (!loadedOnce && loadingList) {
    return <ListPageSkeleton />
  }

  return (
    <>
      <div className="h-full flex flex-col">
          {/* Stats + Activity */}
          <div className="px-6 pt-5 pb-3 space-y-4 border-b border-slate-200 dark:border-slate-700">
            <DashboardStats
              active={stats.active}
              total={stats.total}
              todayExecutions={stats.todayExecutions}
              successRate={stats.successRate}
            />
            <RecentActivityFeed executions={recentExecutions} maxItems={4} />
          </div>

          {/* Command Bar */}
          <div className="h-14 border-b border-slate-200 dark:border-slate-700 flex items-center px-6 animate-fade-in-up">
            <div className="flex items-center gap-3 w-full">
              {/* Tabs - aligned with table checkbox */}
              <div className="flex items-center gap-1 p-1 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800/50">
                <button
                  onClick={() => setActiveTab('workflows')}
                  className={cn(
                    'px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200',
                    activeTab === 'workflows'
                    ? 'bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700/50'
                )}
              >
                Workflows
              </button>
              <button
                onClick={() => setActiveTab('folders')}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200',
                  activeTab === 'folders'
                    ? 'bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700/50'
                )}
              >
                Folders
              </button>
            </div>

            {/* Search Bar - expandable */}
            <div className="flex-1 px-3">
              <ProfessionalSearch
                ref={searchInputRef}
                placeholder={activeTab === 'workflows' ? "Search workflows..." : "Search folders..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onClear={() => setSearchQuery('')}
                className="h-9 w-full rounded-xl"
              />
            </div>

            {/* View Toggle */}
            <div className="flex items-center gap-1 p-1 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800/50">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (activeTab === 'workflows') {
                    setWorkflowsViewMode('list')
                  } else {
                    setFoldersViewMode('list')
                  }
                }}
                className={cn(
                  'h-7 w-7 p-0 transition-colors',
                  (activeTab === 'workflows' && workflowsViewMode === 'list') || (activeTab === 'folders' && foldersViewMode === 'list')
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                )}
                title="List View"
              >
                <List className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (activeTab === 'workflows') {
                    setWorkflowsViewMode('grid')
                  } else {
                    setFoldersViewMode('grid')
                  }
                }}
                className={cn(
                  'h-7 w-7 p-0 transition-colors',
                  (activeTab === 'workflows' && workflowsViewMode === 'grid') || (activeTab === 'folders' && foldersViewMode === 'grid')
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                )}
                title="Grid View"
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
            </div>

            {/* Workspace Grouping Toggle */}
            {activeTab === 'workflows' && (
              <Button
                variant={showWorkspaceGroups ? "default" : "outline"}
                size="sm"
                onClick={() => setShowWorkspaceGroups(!showWorkspaceGroups)}
                className="h-9 gap-2"
                title={showWorkspaceGroups ? "Show all workflows" : "Group by workspace"}
              >
                <Folder className="w-4 h-4" />
                <span className="text-sm">
                  {showWorkspaceGroups ? 'Grouped' : 'Group by Workspace'}
                </span>
              </Button>
            )}

            {/* Advanced Filters */}
            {activeTab === 'workflows' && (
              <AdvancedFilters
                filters={advancedFilters}
                onFiltersChange={(filters) => {
                  setAdvancedFilters(filters)
                  // Sync ownership filter for backwards compatibility
                  setOwnershipFilter(filters.ownership)
                }}
                savedFilters={savedFilters}
                onSaveFilter={handleSaveFilter}
                onDeleteSavedFilter={handleDeleteSavedFilter}
                onApplySavedFilter={handleApplySavedFilter}
              />
            )}

            {/* Create Button - hide "Create folder" when viewing trash */}
            {!(activeTab === 'folders' && isViewingTrash) && (
              <Button
                size="sm"
                className={cn(
                  "h-9 gap-2 whitespace-nowrap",
                  activeTab === 'workflows'
                    ? "bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white shadow-lg shadow-orange-500/20 border-0"
                    : ""
                )}
                disabled={activeTab === 'workflows' && isCreatingWorkflow}
                onClick={() => {
                  if (activeTab === 'workflows') {
                    initiateWorkflowCreation(() => createAndOpen())
                  } else {
                    setCreateFolderDialog(true)
                  }
                }}
              >
                <Plus className="w-4 h-4" />
                {activeTab === 'workflows'
                  ? (isCreatingWorkflow ? 'Creating...' : 'Create workflow')
                  : 'Create folder'}
              </Button>
            )}
            </div>
          </div>

          {/* Folder Breadcrumb Navigation */}
          <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-3">
            <div className="flex items-center gap-2 text-sm">
              <button
                onClick={() => {
                  setCurrentFolderId(null)
                  setSelectedFolderFilter(null)
                }}
                className="flex items-center gap-1.5 text-orange-600 hover:underline transition-all font-medium group"
              >
                <Home className="w-4 h-4" />
                {profile?.full_name || 'My'}'s {activeTab === 'workflows' ? 'Workflows' : 'Folders'}
              </button>
              {folderPath.map((folder, index) => (
                <div key={folder.id} className="flex items-center gap-2">
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                  <button
                    onClick={() => {
                      setCurrentFolderId(folder.id)
                      setSelectedFolderFilter(folder.id)
                    }}
                    className={cn(
                      "group/breadcrumb flex items-center gap-1.5 transition-all",
                      index === folderPath.length - 1
                        ? "text-slate-900 font-semibold cursor-default" // Current folder
                        : "text-orange-600 hover:underline font-medium" // Parent folders
                    )}
                  >
                    <Folder className={cn(
                      "w-4 h-4 transition-transform",
                      index !== folderPath.length - 1 && "group-hover/breadcrumb:scale-110 group-hover/breadcrumb:rotate-12"
                    )} />
                    {folder.name}
                    {folder.is_default && ' (default)'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Batch Actions Bar */}
          {selectedIds.length > 0 && activeTab === 'workflows' && (
            <div className="border-b border-slate-200 bg-orange-50 px-6 py-2 flex items-center justify-between">
              <div className="text-sm font-medium text-orange-900">
                {selectedIds.length} selected
              </div>
              <div className="flex items-center gap-2">
                {isViewingTrash ? (
                  <>
                    {/* Trash view: Show Restore and Permanent Delete */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-green-600 hover:bg-green-50 h-8"
                      onClick={() => handleBulkRestore(selectedIds)}
                      disabled={!!loading['restore-multi']}
                    >
                      {loading['restore-multi'] ? (
                        <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-4 h-4 mr-1.5" />
                      )}
                      Restore
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:bg-red-50 h-8"
                      onClick={() => handleBulkDelete(selectedIds)}
                    >
                      <Trash2 className="w-4 h-4 mr-1.5" />
                      Delete Forever
                    </Button>
                  </>
                ) : (
                  <>
                    {/* Normal view: Show Duplicate, Move, Share, Delete */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-orange-700 hover:bg-orange-100 h-8"
                      onClick={() => handleBulkDuplicate(selectedIds)}
                      disabled={bulkDuplicateLoading}
                    >
                      {bulkDuplicateLoading ? (
                        <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                      ) : (
                        <Copy className="w-4 h-4 mr-1.5" />
                      )}
                      Duplicate
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-orange-700 hover:bg-orange-100 h-8"
                      onClick={() => handleBulkMove(selectedIds)}
                    >
                      <FolderInput className="w-4 h-4 mr-1.5" />
                      Move
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-orange-700 hover:bg-orange-100 h-8"
                      onClick={() => handleBulkShare(selectedIds)}
                    >
                      <Share2 className="w-4 h-4 mr-1.5" />
                      Share
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:bg-red-50 h-8"
                      onClick={() => handleBulkDelete(selectedIds)}
                    >
                      <Trash2 className="w-4 h-4 mr-1.5" />
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Content Area */}
          <div className="flex-1 overflow-auto">
            {activeTab === 'workflows' ? (
              showWorkspaceGroups ? (
                // Workspace Grouped View
                <div className="px-6 py-4">
                  <WorkspaceGroupView
                    workflows={filteredAndSortedWorkflows}
                    renderWorkflowCard={(workflow) => (
                      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4 hover:shadow-md hover:border-primary/20 transition-all duration-200">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-slate-900 truncate">{workflow.name}</h3>
                            <p className="text-sm text-slate-500 truncate">{workflow.description || 'No description'}</p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => router.push(`/workflows/builder/${workflow.id}`)}
                          >
                            Open
                          </Button>
                        </div>
                      </div>
                    )}
                  />
                </div>
              ) : workflowsViewMode === 'list' ? (
              <table className="w-full">
                <thead className="sticky top-0 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700 z-10">
                  <tr>
                    <th className="w-12 px-6 py-3 text-left">
                      <Checkbox
                        checked={selectedIds.length === allVisibleWorkflowIds.length && allVisibleWorkflowIds.length > 0}
                        onCheckedChange={handleSelectAll}
                      />
                    </th>
                    <th className="px-3 py-3 text-left">
                      <button
                        onClick={() => handleSort('name')}
                        className="flex items-center gap-1 text-xs font-semibold text-slate-600 uppercase tracking-wider hover:text-slate-900 transition-colors"
                      >
                        Name
                        {sortField === 'name' ? (
                          sortOrder === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-40" />
                        )}
                      </button>
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Connected Nodes
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Folder
                    </th>
                    <th className="px-3 py-3 text-left">
                      <button
                        onClick={() => handleSort('updated_at')}
                        className="flex items-center gap-1 text-xs font-semibold text-slate-600 uppercase tracking-wider hover:text-slate-900 transition-colors"
                      >
                        Last Modified
                        {sortField === 'updated_at' ? (
                          sortOrder === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-40" />
                        )}
                      </button>
                    </th>
                    <th className="px-3 py-3 text-left">
                      <button
                        onClick={() => handleSort('status')}
                        className="flex items-center gap-1 text-xs font-semibold text-slate-600 uppercase tracking-wider hover:text-slate-900 transition-colors"
                      >
                        Status
                        {sortField === 'status' ? (
                          sortOrder === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-40" />
                        )}
                      </button>
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Owner
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Runs
                    </th>
                    <th className="w-12 px-3 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAndSortedWorkflows.map((workflow, index) => {
                    const creatorInfo = getCreatorInfo(workflow)
                    const folderName = getFolderName(workflow)
                    const stats = executionStats[workflow.id] || { total: 0, today: 0, success: 0, failed: 0 }

                    return (
                      <tr
                        key={workflow.id}
                        className={cn(
                          'group hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-all duration-200 animate-fade-in-up',
                          selectedIds.includes(workflow.id) && 'bg-orange-50 hover:bg-orange-100 [&>td]:!text-slate-900 [&>td>*]:!text-slate-900 [&>td>div]:!text-slate-700 [&>td>span]:!text-slate-900'
                        )}
                        style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}
                      >
                        <td className="px-6 py-4">
                          <Checkbox
                            checked={selectedIds.includes(workflow.id)}
                            onCheckedChange={() => handleSelectOne(workflow.id)}
                          />
                        </td>
                        <td className="px-3 py-4">
                          <div className="flex items-center gap-2">
                            <span
                              onClick={() => {
                                trackAccess({ id: workflow.id, name: workflow.name })
                                router.push(`/workflows/builder/${workflow.id}`)
                              }}
                              className="font-medium text-sm cursor-pointer hover:underline"
                            >
                              {workflow.name}
                            </span>
                            <FavoriteButton workflowId={workflow.id} size="sm" />
                            <div className="flex items-center gap-1 flex-wrap">
                              {/* Permission Badge */}
                              {workflow.user_permission && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge
                                        variant="outline"
                                        className={`text-xs px-1.5 py-0.5 flex items-center gap-0.5 ${
                                          workflow.user_permission === 'admin'
                                            ? 'bg-rose-100 text-rose-800'
                                            : workflow.user_permission === 'manage'
                                            ? 'bg-orange-100 text-orange-800'
                                            : 'bg-gray-100 text-gray-800'
                                        }`}
                                      >
                                        {workflow.user_permission === 'admin' ? (
                                          <Shield className="w-3 h-3" />
                                        ) : workflow.user_permission === 'manage' ? (
                                          <Settings className="w-3 h-3" />
                                        ) : (
                                          <Eye className="w-3 h-3" />
                                        )}
                                        <span className="hidden sm:inline">
                                          {workflow.user_permission === 'admin' ? 'Admin' : workflow.user_permission === 'manage' ? 'Manage' : 'Use'}
                                        </span>
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="text-xs">
                                        {workflow.user_permission === 'admin'
                                          ? 'Full control: edit, manage permissions, delete'
                                          : workflow.user_permission === 'manage'
                                          ? 'Can edit and execute workflow'
                                          : 'Can execute workflow (read-only)'}
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                              {/* Workspace Context Badge */}
                              {workflow.workspace_type && workflow.workspace_type !== 'personal' && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge
                                        variant="outline"
                                        className={`text-xs px-1.5 py-0.5 flex items-center gap-0.5 ${
                                          workflow.workspace_type === 'organization'
                                            ? 'bg-orange-100 text-orange-800'
                                            : 'bg-green-100 text-green-800'
                                        }`}
                                      >
                                        {workflow.workspace_type === 'organization' ? (
                                          <Building2 className="w-3 h-3" />
                                        ) : (
                                          <Users className="w-3 h-3" />
                                        )}
                                        <span className="hidden sm:inline">
                                          {workflow.workspace_type === 'organization' ? 'Org' : 'Team'}
                                        </span>
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="text-xs">
                                        {workflow.workspace_type === 'organization'
                                          ? 'Organization workspace'
                                          : 'Team workspace'}
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-4">
                          <ConnectedNodesDisplay nodes={workflow.nodes || []} />
                        </td>
                        <td className="px-3 py-4">
                          <div
                            onClick={(e) => handleFolderClick(workflow.folder_id, e)}
                            className="flex items-center gap-1.5 text-xs cursor-pointer hover:underline w-fit"
                          >
                            <Folder className="w-3.5 h-3.5" />
                            {folderName}
                          </div>
                        </td>
                        <td className="px-3 py-4">
                          <div className="flex flex-col gap-1">
                            <span className="text-sm text-muted-foreground">
                              {formatDistanceToNow(new Date(workflow.updated_at || workflow.created_at), { addSuffix: true })}
                            </span>
                            {workflow.last_modified_by && workflow.last_modified_by !== user?.id && (
                              <span className="text-xs text-muted-foreground/70">
                                by {workflow.last_modified_by === workflow.user_id ? 'owner' : 'collaborator'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-4">
                          <div className="flex items-center gap-2">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center">
                                    <Switch
                                      checked={workflow.status === 'active'}
                                      onCheckedChange={() => handleToggleStatus(workflow)}
                                      disabled={loading[`status-${workflow.id}`]}
                                      className="scale-90"
                                    />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <p className="text-xs">
                                    {workflow.status === 'active' ? 'Deactivate workflow' : 'Activate workflow'}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            {(() => {
                              const validation = getValidation(workflow.id)
                              if (validation && !validation.isValid && workflow.status !== 'active') {
                                return (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger>
                                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-xs">
                                        <p className="text-xs font-medium mb-1">Incomplete</p>
                                        {validation.issues?.slice(0, 3).map((issue: string, i: number) => (
                                          <p key={i} className="text-xs text-muted-foreground">• {issue}</p>
                                        ))}
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )
                              }
                              return null
                            })()}
                          </div>
                        </td>
                        <td className="px-3 py-4">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center">
                                  <WorkflowAvatar
                                    avatarUrl={creatorInfo.avatar}
                                    name={creatorInfo.name}
                                    initials={creatorInfo.initials}
                                    className="h-7 w-7"
                                  />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                <p className="text-xs">{creatorInfo.name}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </td>
                        <td className="px-3 py-4 text-right text-sm font-medium">
                          {stats.total.toLocaleString()}
                        </td>
                        <td className="px-3 py-4 text-right">
                          <DropdownMenu open={openDropdownId === workflow.id} onOpenChange={(open) => setOpenDropdownId(open ? workflow.id : null)}>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-slate-500 hover:text-slate-800"
                                onClick={(event) => event.stopPropagation()}
                                aria-label={`Workflow options for ${workflow.name}`}
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              {isViewingTrash ? (
                                <>
                                  <DropdownMenuItem
                                    onSelect={(event) => {
                                      event.preventDefault()
                                      handleRestoreWorkflow(workflow.id)
                                    }}
                                    disabled={!!loading[`restore-${workflow.id}`]}
                                  >
                                    {loading[`restore-${workflow.id}`] ? (
                                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                    ) : (
                                      <RotateCcw className="w-4 h-4 mr-2" />
                                    )}
                                    Restore
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onSelect={(event) => {
                                      event.preventDefault()
                                      openDeleteDialogForWorkflows([workflow.id])
                                    }}
                                    className="text-destructive focus:bg-destructive/10"
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Delete Forever
                                  </DropdownMenuItem>
                                </>
                              ) : (
                                <>
                                  <DropdownMenuItem
                                    onSelect={(event) => {
                                      event.preventDefault()
                                      handleDuplicate(workflow)
                                    }}
                                    disabled={!!loading[`duplicate-${workflow.id}`]}
                                  >
                                    {loading[`duplicate-${workflow.id}`] ? (
                                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                    ) : (
                                      <Copy className="w-4 h-4 mr-2" />
                                    )}
                                    Duplicate
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={(event) => {
                                      event.preventDefault()
                                      openRenameDialogForWorkflow(workflow)
                                    }}
                                  >
                                    <Edit className="w-4 h-4 mr-2" />
                                    Rename
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={(event) => {
                                      event.preventDefault()
                                      openMoveDialogForWorkflows([workflow.id], workflow.folder_id ?? null)
                                    }}
                                  >
                                    <FolderInput className="w-4 h-4 mr-2" />
                                    Move to folder
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={(event) => {
                                      event.preventDefault()
                                      openPermissionDialogForWorkflow(workflow.id)
                                    }}
                                  >
                                    <Share2 className="w-4 h-4 mr-2" />
                                    Manage permissions
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onSelect={(event) => {
                                      event.preventDefault()
                                      openDeleteDialogForWorkflows([workflow.id])
                                    }}
                                    className="text-destructive focus:bg-destructive/10"
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Delete
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              ) : (
                /* Workflows Grid View */
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {filteredAndSortedWorkflows.map((workflow, index) => {
                      const creatorInfo = getCreatorInfo(workflow)
                      const folderName = getFolderName(workflow)
                      const stats = executionStats[workflow.id] || { total: 0, today: 0, success: 0, failed: 0 }

                      return (
                        <div
                          key={workflow.id}
                          className={cn(
                            "group relative bg-white dark:bg-slate-900 rounded-xl border-2 p-5 hover:shadow-lg hover:shadow-orange-500/5 hover:border-primary/20 transition-all duration-200 cursor-pointer animate-fade-in-up",
                            selectedIds.includes(workflow.id) ? "border-orange-400 bg-orange-50" : "border-slate-200 dark:border-slate-700"
                          )}
                          style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}
                          onClick={() => {
                            trackAccess({ id: workflow.id, name: workflow.name })
                            router.push(`/workflows/builder/${workflow.id}`)
                          }}
                        >
                          {/* Checkbox */}
                          <div className="absolute top-3 left-3">
                            <Checkbox
                              checked={selectedIds.includes(workflow.id)}
                              onCheckedChange={() => handleSelectOne(workflow.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>

                          {/* Favorite Button */}
                          <div className="absolute top-3 left-10" onClick={(e) => e.stopPropagation()}>
                            <FavoriteButton workflowId={workflow.id} size="sm" />
                          </div>

                          {/* Actions Dropdown */}
                          <div className="absolute top-3 right-3">
                            <DropdownMenu open={openDropdownId === workflow.id} onOpenChange={(open) => setOpenDropdownId(open ? workflow.id : null)}>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                {isViewingTrash ? (
                                  <>
                                    <DropdownMenuItem
                                      onSelect={(event) => {
                                        event.preventDefault()
                                        handleRestoreWorkflow(workflow.id)
                                      }}
                                      disabled={!!loading[`restore-${workflow.id}`]}
                                    >
                                      {loading[`restore-${workflow.id}`] ? (
                                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                      ) : (
                                        <RotateCcw className="w-4 h-4 mr-2" />
                                      )}
                                      Restore
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onSelect={(event) => {
                                        event.preventDefault()
                                        openDeleteDialogForWorkflows([workflow.id])
                                      }}
                                      className="text-destructive focus:bg-destructive/10"
                                    >
                                      <Trash2 className="w-4 h-4 mr-2" />
                                      Delete Forever
                                    </DropdownMenuItem>
                                  </>
                                ) : (
                                  <>
                                    <DropdownMenuItem
                                      onSelect={(event) => {
                                        event.preventDefault()
                                        handleDuplicate(workflow)
                                      }}
                                      disabled={!!loading[`duplicate-${workflow.id}`]}
                                    >
                                      {loading[`duplicate-${workflow.id}`] ? (
                                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                      ) : (
                                        <Copy className="w-4 h-4 mr-2" />
                                      )}
                                      Duplicate
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={(event) => {
                                        event.preventDefault()
                                        openRenameDialogForWorkflow(workflow)
                                      }}
                                    >
                                      <Edit className="w-4 h-4 mr-2" />
                                      Rename
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={(event) => {
                                        event.preventDefault()
                                        openMoveDialogForWorkflows([workflow.id], workflow.folder_id ?? null)
                                      }}
                                    >
                                      <FolderInput className="w-4 h-4 mr-2" />
                                      Move to folder
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={(event) => {
                                        event.preventDefault()
                                        openPermissionDialogForWorkflow(workflow.id)
                                      }}
                                    >
                                      <Share2 className="w-4 h-4 mr-2" />
                                      Manage permissions
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onSelect={(event) => {
                                        event.preventDefault()
                                        openDeleteDialogForWorkflows([workflow.id])
                                      }}
                                      className="text-destructive focus:bg-destructive/10"
                                    >
                                      <Trash2 className="w-4 h-4 mr-2" />
                                      Delete
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          {/* Workflow Name */}
                          <h3 className="font-semibold text-slate-900 text-center mb-3 mt-4 line-clamp-1">
                            {workflow.name}
                          </h3>

                          {/* Badges */}
                          <div className="flex items-center justify-center gap-1 flex-wrap mb-3">
                            {/* Permission Badge */}
                            {workflow.user_permission && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge
                                      variant="outline"
                                      className={`text-xs px-1.5 py-0.5 flex items-center gap-0.5 ${
                                        workflow.user_permission === 'admin'
                                          ? 'bg-rose-100 text-rose-800'
                                          : workflow.user_permission === 'manage'
                                          ? 'bg-orange-100 text-orange-800'
                                          : 'bg-gray-100 text-gray-800'
                                      }`}
                                    >
                                      {workflow.user_permission === 'admin' ? (
                                        <Shield className="w-3 h-3" />
                                      ) : workflow.user_permission === 'manage' ? (
                                        <Settings className="w-3 h-3" />
                                      ) : (
                                        <Eye className="w-3 h-3" />
                                      )}
                                      <span>
                                        {workflow.user_permission === 'admin' ? 'Admin' : workflow.user_permission === 'manage' ? 'Manage' : 'Use'}
                                      </span>
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="text-xs">
                                      {workflow.user_permission === 'admin'
                                        ? 'Full control: edit, manage permissions, delete'
                                        : workflow.user_permission === 'manage'
                                        ? 'Can edit and execute workflow'
                                        : 'Can execute workflow (read-only)'}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                            {/* Workspace Context Badge */}
                            {workflow.workspace_type && workflow.workspace_type !== 'personal' && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge
                                      variant="outline"
                                      className={`text-xs px-1.5 py-0.5 flex items-center gap-0.5 ${
                                        workflow.workspace_type === 'organization'
                                          ? 'bg-orange-100 text-orange-800'
                                          : 'bg-green-100 text-green-800'
                                      }`}
                                    >
                                      {workflow.workspace_type === 'organization' ? (
                                        <Building2 className="w-3 h-3" />
                                      ) : (
                                        <Users className="w-3 h-3" />
                                      )}
                                      <span>
                                        {workflow.workspace_type === 'organization' ? 'Org' : 'Team'}
                                      </span>
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="text-xs">
                                      {workflow.workspace_type === 'organization'
                                        ? 'Organization workspace'
                                        : 'Team workspace'}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>

                          {/* Folder */}
                          <div
                            onClick={(e) => {
                              e.stopPropagation()
                              handleFolderClick(workflow.folder_id, e)
                            }}
                            className="flex items-center justify-center gap-1.5 text-xs text-slate-600 hover:underline mb-3"
                          >
                            <Folder className="w-3.5 h-3.5" />
                            {folderName}
                          </div>

                          {/* Footer Info */}
                          <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center">
                                    <WorkflowAvatar
                                      avatarUrl={creatorInfo.avatar}
                                      name={creatorInfo.name}
                                      initials={creatorInfo.initials}
                                      className="h-6 w-6"
                                    />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <p className="text-xs">{creatorInfo.name}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>

                            {/* Status Toggle */}
                            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              {(() => {
                                const validation = getValidation(workflow.id)
                                if (validation && !validation.isValid && workflow.status !== 'active') {
                                  return (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger>
                                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-xs">
                                          <p className="text-xs font-medium mb-1">Incomplete</p>
                                          {validation.issues?.slice(0, 3).map((issue: string, i: number) => (
                                            <p key={i} className="text-xs text-muted-foreground">• {issue}</p>
                                          ))}
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )
                                }
                                return null
                              })()}
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex items-center">
                                      <Switch
                                        checked={workflow.status === 'active'}
                                        onCheckedChange={() => handleToggleStatus(workflow)}
                                        disabled={loading[`status-${workflow.id}`]}
                                        className="scale-75"
                                      />
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    <p className="text-xs">
                                      {workflow.status === 'active' ? 'Deactivate workflow' : 'Activate workflow'}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>

                            <div className="text-xs text-slate-600">
                              {stats.total} runs
                            </div>
                          </div>

                          {/* Last Modified */}
                          <div className="flex flex-col items-center gap-0.5 text-xs text-slate-500 mt-2">
                            <span>
                              {formatDistanceToNow(new Date(workflow.updated_at || workflow.created_at), { addSuffix: true })}
                            </span>
                            {workflow.last_modified_by && workflow.last_modified_by !== user?.id && (
                              <span className="text-[10px] text-slate-400">
                                by {workflow.last_modified_by === workflow.user_id ? 'owner' : 'collaborator'}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            ) : (
              /* Folders View */
              foldersViewMode === 'grid' ? (
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filteredFolders.map((folder) => {
                    // For trash folder, count trashed workflows. For others, count active workflows
                    const workflowCount = folder.is_trash
                      ? trashedWorkflows.length
                      : activeWorkflows.filter(w => w.folder_id === folder.id).length
                    // Count subfolders within this folder
                    const subfolderCount = folders.filter(f => f.parent_folder_id === folder.id).length
                    const isDefaultFolder = folder.is_default === true
                    const isTrashFolder = folder.is_trash === true
                    return (
                      <div
                        key={folder.id}
                        className="group relative bg-white rounded-xl border-2 border-slate-200 p-5 hover:shadow-lg hover:border-orange-300 transition-all cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation()
                          // Single click: navigate into folder
                          logger.info('[Folders] Clicking folder:', folder.name, folder.id)
                          setCurrentFolderId(folder.id)
                          setSelectedFolderFilter(folder.id)
                          // If clicking trash folder, switch to workflows tab to show trashed workflows
                          if (folder.is_trash) {
                            setActiveTab('workflows')
                          }
                          // Otherwise stay on Folders tab so users can create subfolders
                        }}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3 flex-1">
                            <div
                              className="w-10 h-10 rounded-lg flex items-center justify-center relative transition-all duration-200 group-hover:scale-110"
                              style={{ backgroundColor: `${folder.color}20` }}
                            >
                              {isTrashFolder ? (
                                <Trash2
                                  className="w-5 h-5 transition-transform group-hover:rotate-12"
                                  style={{ color: folder.color }}
                                />
                              ) : (
                                <Folder
                                  className="w-5 h-5 transition-transform group-hover:rotate-12"
                                  style={{ color: folder.color }}
                                />
                              )}
                              {isDefaultFolder && (
                                <div className="absolute -top-1 -right-1 bg-slate-700 rounded-full p-0.5">
                                  <Lock className="w-2.5 h-2.5 text-white" />
                                </div>
                              )}
                            </div>
                            <div className="flex-1">
                              <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                                {folder.name}
                              </h3>
                              <div className="flex items-center gap-2 text-xs text-slate-600">
                                <span>{workflowCount} workflow{workflowCount !== 1 ? 's' : ''}</span>
                                {subfolderCount > 0 && (
                                  <>
                                    <span>•</span>
                                    <span>{subfolderCount} folder{subfolderCount !== 1 ? 's' : ''}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {isTrashFolder ? (
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setEmptyTrashDialog(true)
                                  }}
                                  disabled={trashedWorkflows.length === 0 || emptyingTrash}
                                  className="text-red-600 focus:text-red-600"
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Empty Trash
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setRenameFolderDialog({
                                      open: true,
                                      folderId: folder.id,
                                      currentName: folder.name
                                    })
                                    setRenameFolderValue(folder.name)
                                  }}
                                >
                                  <Edit className="w-4 h-4 mr-2" />
                                  Rename
                                </DropdownMenuItem>
                              )}
                              {!isDefaultFolder && !isTrashFolder && (
                                <>
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleSetDefaultFolder(folder.id, folder.name)
                                    }}
                                  >
                                    <Lock className="w-4 h-4 mr-2" />
                                    Set as Default
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleDeleteFolderClick(folder.id, folder.name)
                                    }}
                                    className="text-red-600 focus:text-red-600"
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Delete Folder
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        {folder.description && (
                          <p className="text-sm text-slate-600 line-clamp-2">{folder.description}</p>
                        )}
                      </div>
                    )
                  })}
                </div>

                {filteredFolders.length === 0 && !isViewingTrash && (
                  <div className="flex items-center justify-center py-16 px-6 animate-fade-in">
                    <div className="text-center max-w-md mx-auto border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl p-10">
                      <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-5">
                        <Folder className="w-8 h-8 text-slate-400 dark:text-slate-500" />
                      </div>
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
                        {searchQuery ? 'No folders found' : 'No folders yet'}
                      </h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
                        {searchQuery
                          ? 'Try adjusting your search or clearing filters'
                          : 'Create folders to organize your workflows'}
                      </p>
                      {!searchQuery && (
                        <Button onClick={() => setCreateFolderDialog(true)}>
                          <FolderPlus className="w-4 h-4 mr-2" />
                          Create Folder
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
              ) : (
                /* Folders List View */
                <>
                  <table className="w-full">
                    <thead className="sticky top-0 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700 z-10">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                          Name
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                          Description
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                          Workflows
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                          Last Modified
                        </th>
                        <th className="w-12 px-3 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredFolders.map((folder) => {
                      // For trash folder, count trashed workflows. For others, count active workflows
                      const workflowCount = folder.is_trash
                        ? trashedWorkflows.length
                        : activeWorkflows.filter(w => w.folder_id === folder.id).length
                      // Count subfolders within this folder
                      const subfolderCount = folders.filter(f => f.parent_folder_id === folder.id).length
                      const isDefaultFolder = folder.is_default === true
                      const isTrashFolder = folder.is_trash === true

                      return (
                        <tr
                          key={folder.id}
                          className="group hover:bg-slate-50 transition-colors cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation()
                            // Single click: navigate into folder
                            logger.info('[Folders List] Clicking folder:', folder.name, folder.id)
                            setCurrentFolderId(folder.id)
                            setSelectedFolderFilter(folder.id)
                            // If clicking trash folder, switch to workflows tab to show trashed workflows
                            if (folder.is_trash) {
                              setActiveTab('workflows')
                            }
                            // Otherwise stay on Folders tab so users can create subfolders
                          }}
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div
                                className="w-8 h-8 rounded-lg flex items-center justify-center relative flex-shrink-0 transition-all duration-200 group-hover:scale-110"
                                style={{ backgroundColor: `${folder.color}20` }}
                              >
                                {isTrashFolder ? (
                                  <Trash2
                                    className="w-4 h-4 transition-transform group-hover:rotate-12"
                                    style={{ color: folder.color }}
                                  />
                                ) : (
                                  <Folder
                                    className="w-4 h-4 transition-transform group-hover:rotate-12"
                                    style={{ color: folder.color }}
                                  />
                                )}
                                {isDefaultFolder && (
                                  <div className="absolute -top-1 -right-1 bg-slate-700 rounded-full p-0.5">
                                    <Lock className="w-2 h-2 text-white" />
                                  </div>
                                )}
                              </div>
                              <span className="font-medium text-sm">{folder.name}</span>
                            </div>
                          </td>
                          <td className="px-3 py-4">
                            <span className="text-sm text-slate-600">
                              {folder.description || '-'}
                            </span>
                          </td>
                          <td className="px-3 py-4">
                            <div className="flex items-center gap-2 text-sm">
                              <span>{workflowCount} workflow{workflowCount !== 1 ? 's' : ''}</span>
                              {subfolderCount > 0 && (
                                <>
                                  <span className="text-slate-400">•</span>
                                  <span className="text-slate-600">{subfolderCount} folder{subfolderCount !== 1 ? 's' : ''}</span>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-4">
                            <span className="text-sm">
                              {formatDistanceToNow(new Date(folder.updated_at || folder.created_at), { addSuffix: true })}
                            </span>
                          </td>
                          <td className="px-3 py-4 text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-slate-500 hover:text-slate-800"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MoreHorizontal className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {isTrashFolder ? (
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setEmptyTrashDialog(true)
                                    }}
                                    disabled={trashedWorkflows.length === 0 || emptyingTrash}
                                    className="text-red-600 focus:text-red-600"
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Empty Trash
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setRenameFolderDialog({
                                        open: true,
                                        folderId: folder.id,
                                        currentName: folder.name
                                      })
                                      setRenameFolderValue(folder.name)
                                    }}
                                  >
                                    <Edit className="w-4 h-4 mr-2" />
                                    Rename
                                  </DropdownMenuItem>
                                )}
                                {!isDefaultFolder && !isTrashFolder && (
                                  <>
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleSetDefaultFolder(folder.id, folder.name)
                                      }}
                                    >
                                      <Lock className="w-4 h-4 mr-2" />
                                      Set as Default
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleDeleteFolderClick(folder.id, folder.name)
                                      }}
                                      className="text-red-600 focus:text-red-600"
                                    >
                                      <Trash2 className="w-4 h-4 mr-2" />
                                      Delete Folder
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {filteredFolders.length === 0 && !isViewingTrash && (
                    <div className="flex items-center justify-center py-16 px-6 animate-fade-in">
                      <div className="text-center max-w-md mx-auto border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl p-10">
                        <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-5">
                          <Folder className="w-8 h-8 text-slate-400 dark:text-slate-500" />
                        </div>
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
                          {searchQuery ? 'No folders found' : 'No folders yet'}
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
                          {searchQuery
                            ? 'Try adjusting your search or clearing filters'
                            : 'Create folders to organize your workflows'}
                        </p>
                        {!searchQuery && (
                          <Button onClick={() => setCreateFolderDialog(true)}>
                            <FolderPlus className="w-4 h-4 mr-2" />
                            Create Folder
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )
            )}

            {activeTab === 'workflows' && filteredAndSortedWorkflows.length === 0 && (
              <div className="flex items-center justify-center py-16 px-6 animate-fade-in">
                <div className="text-center max-w-md mx-auto p-10">
                  <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-5">
                    <Workflow className="w-8 h-8 text-slate-400 dark:text-slate-500" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No workflows found</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                    {searchQuery
                      ? 'Try adjusting your search or clearing filters'
                      : 'Create your first workflow to get started with automation'}
                  </p>
                  {!searchQuery && (
                    <Button
                      className="mt-6 bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white shadow-lg shadow-orange-500/20 border-0"
                      disabled={isCreatingWorkflow}
                      onClick={() => initiateWorkflowCreation(() => createAndOpen())}
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      {isCreatingWorkflow ? 'Creating...' : 'Create Workflow'}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

      {/* Create Workflow - now opens builder directly with AI panel */}

      {/* Rename Workflow Dialog */}
      <Dialog
        open={renameDialog.open}
        onOpenChange={(open) => {
          setRenameDialog({ open, workflowId: null, currentName: '' })
          if (!open) {
            setRenameValue('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Workflow</DialogTitle>
            <DialogDescription>
              Enter a new name for your workflow.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rename-workflow">Workflow Name *</Label>
              <Input
                id="rename-workflow"
                placeholder="Enter workflow name"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRenameWorkflow()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRenameDialog({ open: false, workflowId: null, currentName: '' })
                setRenameValue('')
              }}
              disabled={loading[`rename-${renameDialog.workflowId}`]}
            >
              Cancel
            </Button>
            <Button onClick={handleRenameWorkflow} disabled={loading[`rename-${renameDialog.workflowId}`]}>
              {loading[`rename-${renameDialog.workflowId}`] ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Edit className="w-4 h-4 mr-2" />
              )}
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to Folder Dialog */}
      <Dialog
        open={moveFolderDialog.open}
        onOpenChange={(open) => {
          setMoveFolderDialog({ open, workflowIds: [] })
          if (!open) {
            setSelectedFolderId(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Move {moveFolderDialog.workflowIds.length > 1 ? `${moveFolderDialog.workflowIds.length} workflows` : 'workflow'}
            </DialogTitle>
            <DialogDescription>
              Select a folder to move {moveFolderDialog.workflowIds.length > 1 ? 'these workflows' : 'this workflow'} to.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Select Folder</Label>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {folders
                  .filter(folder => !folder.is_trash) // Don't allow moving to trash folder
                  .map((folder) => (
                    <div
                      key={folder.id}
                      className={cn(
                        "p-3 border rounded-lg cursor-pointer transition-colors",
                        selectedFolderId === folder.id
                          ? "border-primary bg-primary/5"
                          : "border-slate-200 hover:bg-slate-50"
                      )}
                      onClick={() => setSelectedFolderId(folder.id)}
                    >
                      <div className="flex items-center gap-2">
                        <Folder className="w-4 h-4" style={{ color: folder.color }} />
                        <span className="text-sm font-medium">{folder.name}</span>
                        {folder.is_default && (
                          <Lock className="w-3 h-3 text-slate-500 ml-1" />
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setMoveFolderDialog({ open: false, workflowIds: [] })
                setSelectedFolderId(null)
              }}
              disabled={moveDialogLoading}
            >
              Cancel
            </Button>
            <Button onClick={handleMoveToFolder} disabled={moveDialogLoading}>
              {moveDialogLoading ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <FolderInput className="w-4 h-4 mr-2" />
              )}
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Workflows Dialog */}
      <Dialog
        open={shareDialog.open}
        onOpenChange={(open) => {
          setShareDialog({ open, workflowIds: [] })
          if (!open) {
            setSelectedTeamIds([])
            setShareLoading(false)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Share {shareDialog.workflowIds.length > 1 ? `${shareDialog.workflowIds.length} workflows` : 'workflow'}
            </DialogTitle>
            <DialogDescription>
              Choose the teams that should have access. Sharing will add each workflow to the selected teams.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {loadingTeams ? (
              <div className="flex items-center justify-center py-8 text-sm text-slate-600">
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Loading teams…
              </div>
            ) : availableTeams.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
                You’re not a member of any teams yet. Create or join a team to share workflows.
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                {availableTeams.map((team) => (
                  <label
                    key={team.id}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                      selectedTeamIds.includes(team.id)
                        ? "border-orange-500 bg-orange-50"
                        : "border-slate-200 hover:bg-slate-50"
                    )}
                  >
                    <Checkbox
                      checked={selectedTeamIds.includes(team.id)}
                      onCheckedChange={() => toggleTeamSelection(team.id)}
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-900">{team.name}</p>
                      {team.description && (
                        <p className="text-xs text-slate-600 mt-0.5">{team.description}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
            {shareDialog.workflowIds.length > 1 && (
              <p className="text-xs text-slate-500">
                These workflows will be shared with the selected teams. Existing permissions will be kept.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShareDialog({ open: false, workflowIds: [] })
                setSelectedTeamIds([])
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleShareWorkflows}
              disabled={shareLoading || selectedTeamIds.length === 0 || availableTeams.length === 0}
            >
              {shareLoading ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Share2 className="w-4 h-4 mr-2" />
              )}
              Share
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Folder Dialog */}
      <Dialog open={createFolderDialog} onOpenChange={setCreateFolderDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription>
              Organize your workflows with folders.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name">Folder Name *</Label>
              <Input
                id="folder-name"
                placeholder="e.g., Marketing Automations"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="folder-description">Description</Label>
              <Textarea
                id="folder-description"
                placeholder="What's this folder for?"
                value={newFolderDescription}
                onChange={(e) => setNewFolderDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateFolderDialog(false)
                setNewFolderName("")
                setNewFolderDescription("")
              }}
              disabled={loading['create-folder']}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateFolder} disabled={loading['create-folder']}>
              {loading['create-folder'] ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <FolderPlus className="w-4 h-4 mr-2" />
              )}
              Create Folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Workflow Dialog */}
      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(open) => {
          // Only clear workflowIds when canceling (closing without action)
          // handleDelete will clear them after capturing the IDs
          if (!open) {
            setDeleteDialog(prev => ({ ...prev, open: false }))
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isViewingTrash ? 'Permanently Delete?' : 'Move to Trash?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {isViewingTrash
                ? `This will permanently delete ${deleteDialogLabel}. This action cannot be undone.`
                : `This will move ${deleteDialogLabel} to trash. ${deleteDialog.workflowIds.length === 1 ? 'It' : 'They'} will be permanently deleted after 7 days.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialog({ open: false, workflowIds: [], contextLabel: '' })}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {isViewingTrash ? 'Delete Forever' : 'Move to Trash'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename Folder Dialog */}
      <Dialog
        open={renameFolderDialog.open}
        onOpenChange={(open) => {
          setRenameFolderDialog({ open, folderId: null, currentName: '' })
          if (!open) {
            setRenameFolderValue('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
            <DialogDescription>
              Enter a new name for your folder.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rename-folder">Folder Name *</Label>
              <Input
                id="rename-folder"
                placeholder="Enter folder name"
                value={renameFolderValue}
                onChange={(e) => setRenameFolderValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRenameFolder()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRenameFolderDialog({ open: false, folderId: null, currentName: '' })
                setRenameFolderValue('')
              }}
              disabled={loading[`rename-folder-${renameFolderDialog.folderId}`]}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRenameFolder}
              disabled={loading[`rename-folder-${renameFolderDialog.folderId}`] || !renameFolderValue.trim()}
            >
              {loading[`rename-folder-${renameFolderDialog.folderId}`] ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Edit className="w-4 h-4 mr-2" />
              )}
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Folder Dialog */}
      <AlertDialog open={deleteFolderDialog.open} onOpenChange={(open) => setDeleteFolderDialog({ open, folderId: null, folderName: '' })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{deleteFolderDialog.folderName}". Workflows in this folder will be moved to "My Workflows".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteFolder}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Folder with Workflows Dialog */}
      <Dialog
        open={deleteFolderWithWorkflows.open}
        onOpenChange={(open) => !open && setDeleteFolderWithWorkflows({
          open: false,
          folderId: null,
          folderName: '',
          workflowCount: 0,
          action: null,
          targetFolderId: null
        })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{deleteFolderWithWorkflows.folderName}"?</DialogTitle>
            <DialogDescription>
              This folder contains {deleteFolderWithWorkflows.workflowCount} workflow{deleteFolderWithWorkflows.workflowCount !== 1 ? 's' : ''}. What would you like to do with them?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Option 1: Delete all workflows */}
            <div
              className={cn(
                "border-2 rounded-lg p-4 cursor-pointer transition-all",
                deleteFolderWithWorkflows.action === 'delete'
                  ? "border-red-500 bg-red-50 shadow-sm"
                  : "border-slate-200 hover:bg-slate-50 hover:border-slate-300"
              )}
              onClick={(e) => {
                e.stopPropagation()
                setDeleteFolderWithWorkflows(prev => ({ ...prev, action: 'delete', targetFolderId: null }))
              }}
            >
              <div className="flex items-start gap-3">
                <div className={cn(
                  "w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 transition-all",
                  deleteFolderWithWorkflows.action === 'delete'
                    ? "border-red-500 bg-red-500"
                    : "border-slate-300 bg-white"
                )}>
                  {deleteFolderWithWorkflows.action === 'delete' && (
                    <div className="w-2.5 h-2.5 rounded-full bg-white" />
                  )}
                </div>
                <div className="flex-1">
                  <h4 className={cn(
                    "font-medium mb-1",
                    deleteFolderWithWorkflows.action === 'delete' ? "text-red-900" : "text-slate-900"
                  )}>
                    Delete all workflows
                  </h4>
                  <p className="text-sm text-slate-600">
                    Permanently delete the folder and all {deleteFolderWithWorkflows.workflowCount} workflow{deleteFolderWithWorkflows.workflowCount !== 1 ? 's' : ''} inside. This action cannot be undone.
                  </p>
                </div>
              </div>
            </div>

            {/* Option 2: Move workflows to another folder */}
            <div
              className={cn(
                "border-2 rounded-lg p-4 cursor-pointer transition-all",
                deleteFolderWithWorkflows.action === 'move'
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-slate-200 hover:bg-slate-50 hover:border-slate-300"
              )}
              onClick={(e) => {
                e.stopPropagation()
                setDeleteFolderWithWorkflows(prev => ({
                  ...prev,
                  action: 'move',
                  targetFolderId: prev.targetFolderId || folders.find(f => f.is_default && f.id !== prev.folderId)?.id || folders.find(f => f.id !== prev.folderId && !f.is_trash)?.id || null
                }))
              }}
            >
              <div className="flex items-start gap-3">
                <div className={cn(
                  "w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 transition-all",
                  deleteFolderWithWorkflows.action === 'move'
                    ? "border-primary bg-primary"
                    : "border-slate-300 bg-white"
                )}>
                  {deleteFolderWithWorkflows.action === 'move' && (
                    <div className="w-2.5 h-2.5 rounded-full bg-white" />
                  )}
                </div>
                <div className="flex-1">
                  <h4 className={cn(
                    "font-medium mb-1",
                    deleteFolderWithWorkflows.action === 'move' ? "text-primary" : "text-slate-900"
                  )}>
                    Move workflows to another folder
                  </h4>
                  <p className="text-sm text-slate-600 mb-3">
                    Keep the workflows and move them to a different folder before deleting this one.
                  </p>

                  {deleteFolderWithWorkflows.action === 'move' && (
                    <div className="space-y-2 mt-3">
                      <label className="text-sm font-medium text-slate-700">Select destination folder:</label>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {folders
                          .filter(f => f.id !== deleteFolderWithWorkflows.folderId && !f.is_trash)
                          .map(folder => (
                            <div
                              key={folder.id}
                              className={cn(
                                "flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-all",
                                deleteFolderWithWorkflows.targetFolderId === folder.id
                                  ? "border-primary bg-primary/10 shadow-sm"
                                  : "border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                              )}
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeleteFolderWithWorkflows(prev => ({ ...prev, targetFolderId: folder.id }))
                              }}
                            >
                              <div className={cn(
                                "w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                                deleteFolderWithWorkflows.targetFolderId === folder.id
                                  ? "border-primary bg-primary"
                                  : "border-slate-300 bg-white"
                              )}>
                                {deleteFolderWithWorkflows.targetFolderId === folder.id && (
                                  <div className="w-2 h-2 rounded-full bg-white" />
                                )}
                              </div>
                              <Folder className="w-4 h-4 flex-shrink-0" style={{ color: folder.color }} />
                              <span className={cn(
                                "text-sm flex-1",
                                deleteFolderWithWorkflows.targetFolderId === folder.id ? "font-medium text-primary" : "text-slate-700"
                              )}>
                                {folder.name}
                              </span>
                              {folder.is_default && (
                                <span className="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">Default</span>
                              )}
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteFolderWithWorkflows({
                open: false,
                folderId: null,
                folderName: '',
                workflowCount: 0,
                action: null,
                targetFolderId: null
              })}
            >
              Cancel
            </Button>
            <Button
              variant={deleteFolderWithWorkflows.action === 'delete' ? 'destructive' : 'default'}
              onClick={handleDeleteFolderWithWorkflows}
              disabled={!deleteFolderWithWorkflows.action || (deleteFolderWithWorkflows.action === 'move' && !deleteFolderWithWorkflows.targetFolderId)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Empty Trash Dialog */}
      <AlertDialog open={emptyTrashDialog} onOpenChange={setEmptyTrashDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty Trash?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {trashedWorkflows.length} workflow{trashedWorkflows.length !== 1 ? 's' : ''} in the trash. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleEmptyTrash}
              disabled={emptyingTrash}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {emptyingTrash ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Empty Trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Share Workflow Dialog */}
      <ShareWorkflowDialog
        open={permissionDialog.open}
        onOpenChange={(open) => setPermissionDialog({ ...permissionDialog, open })}
        workflowId={permissionDialog.workflowId}
        workflowName={permissionDialog.workflowName}
      />

      {/* Upgrade Plan Modal */}
      <UpgradePlanModal
        open={upgradeModalOpen}
        onOpenChange={setUpgradeModalOpen}
        requiredPlan={requiredPlan as any}
      />

      {/* Workspace Selection Modal - Pre-flight before AI Agent Builder */}
      <WorkspaceSelectionModal
        open={showWorkspaceModal}
        onOpenChange={(open) => !open && handleCancelWorkspaceSelection()}
        onWorkspaceSelected={handleWorkspaceSelected}
        onCancel={handleCancelWorkspaceSelection}
      />

      {/* Keyboard Shortcuts Help Dialog */}
      <HelpDialog />

      {/* Floating Action Bar - more discoverable than inline bar */}
      {activeTab === 'workflows' && (
        <WorkflowFloatingActionBar
          selectedIds={selectedIds}
          onDeselect={() => setSelectedIds([])}
          onDuplicate={() => handleBulkDuplicate(selectedIds)}
          onMove={() => handleBulkMove(selectedIds)}
          onShare={() => handleBulkShare(selectedIds)}
          onDelete={() => handleBulkDelete(selectedIds)}
          onRestore={() => handleBulkRestore(selectedIds)}
          onToggleStatus={selectedIds.length === 1 ? () => {
            const workflow = workflows.find(w => w.id === selectedIds[0])
            if (workflow) handleToggleStatus(workflow)
          } : undefined}
          isTrashView={isViewingTrash}
          loading={loading}
        />
      )}
    </>
  )
}

export function WorkflowsPageContent() {
  return (
    <PagePreloader
      pageType="workflows"
      loadingTitle="Loading Workflows"
      loadingDescription="Fetching your workflows and execution stats..."
      skipIntegrations={true}
    >
      <WorkflowsContentInner />
    </PagePreloader>
  )
}
