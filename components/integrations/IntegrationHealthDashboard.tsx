"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Clock,
  Activity,
  Shield,
  Zap,
  ExternalLink,
  ChevronRight,
  Info,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { cn } from "@/lib/utils"
import { useIntegrationStore } from "@/stores/integrationStore"
import { getIntegrationLogoPath, getIntegrationLogoClasses } from "@/lib/integrations/logoStyles"
import { useTheme } from "next-themes"
import { useToast } from "@/hooks/use-toast"

interface IntegrationHealth {
  id: string
  provider: string
  providerName: string
  status: "healthy" | "warning" | "error" | "expired"
  healthCheckStatus: string | null
  lastHealthCheck: string | null
  nextHealthCheck: string | null
  expiresAt: string | null
  requiresUserAction: boolean
  userActionType: string | null
  userActionDeadline: string | null
  lastErrorCode: string | null
  consecutiveFailures: number
  email?: string
  accountName?: string
}

interface HealthStats {
  total: number
  healthy: number
  warning: number
  error: number
  expired: number
  healthScore: number
}

interface IntegrationHealthDashboardProps {
  className?: string
  compact?: boolean
}

/**
 * Integration Health Dashboard
 * Shows proactive health status of all connected integrations
 */
export function IntegrationHealthDashboard({ className, compact = false }: IntegrationHealthDashboardProps) {
  const router = useRouter()
  const { theme } = useTheme()
  const { toast } = useToast()
  const { integrations, providers, fetchAllIntegrations, connectIntegration } = useIntegrationStore()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedIntegration, setSelectedIntegration] = useState<IntegrationHealth | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [reconnecting, setReconnecting] = useState<string | null>(null)

  useEffect(() => {
    loadHealthData()
  }, [integrations])

  const loadHealthData = () => {
    setLoading(false)
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await fetchAllIntegrations()
      toast({
        title: "Health Status Refreshed",
        description: "Integration health data has been updated.",
      })
    } catch (error) {
      toast({
        title: "Refresh Failed",
        description: "Failed to refresh health status.",
        variant: "destructive",
      })
    } finally {
      setRefreshing(false)
    }
  }

  const handleReconnect = async (providerId: string) => {
    setReconnecting(providerId)
    try {
      await connectIntegration(providerId, 'personal', null)
      toast({
        title: "Reconnected",
        description: "Integration has been successfully reconnected.",
      })
      setDetailsOpen(false)
    } catch (error) {
      toast({
        title: "Reconnection Failed",
        description: "Failed to reconnect integration. Please try again.",
        variant: "destructive",
      })
    } finally {
      setReconnecting(null)
    }
  }

  // Calculate health status for each integration
  const integrationHealthData: IntegrationHealth[] = integrations
    .filter(i => i.status !== 'disconnected')
    .map(integration => {
      const provider = providers.find(p => p.id === integration.provider)

      // Determine health status
      let status: IntegrationHealth["status"] = "healthy"

      if (integration.status === 'expired' || integration.status === 'needs_reauthorization') {
        status = "expired"
      } else if (integration.requires_user_action || (integration as any).health_check_status === 'revoked') {
        status = "error"
      } else if (
        (integration as any).consecutive_failures > 0 ||
        (integration as any).health_check_status === 'degraded' ||
        (integration as any).health_check_status === 'expired'
      ) {
        status = "warning"
      }

      return {
        id: integration.id,
        provider: integration.provider,
        providerName: provider?.name || integration.provider,
        status,
        healthCheckStatus: (integration as any).health_check_status || null,
        lastHealthCheck: (integration as any).last_health_check_at || null,
        nextHealthCheck: (integration as any).next_health_check_at || null,
        expiresAt: integration.expires_at || null,
        requiresUserAction: (integration as any).requires_user_action || false,
        userActionType: (integration as any).user_action_type || null,
        userActionDeadline: (integration as any).user_action_deadline || null,
        lastErrorCode: (integration as any).last_error_code || null,
        consecutiveFailures: (integration as any).consecutive_failures || 0,
        email: integration.email,
        accountName: (integration as any).account_name,
      }
    })

  // Calculate stats
  const stats: HealthStats = {
    total: integrationHealthData.length,
    healthy: integrationHealthData.filter(i => i.status === "healthy").length,
    warning: integrationHealthData.filter(i => i.status === "warning").length,
    error: integrationHealthData.filter(i => i.status === "error").length,
    expired: integrationHealthData.filter(i => i.status === "expired").length,
    healthScore: integrationHealthData.length > 0
      ? Math.round(
          (integrationHealthData.filter(i => i.status === "healthy").length / integrationHealthData.length) * 100
        )
      : 100,
  }

  const getStatusConfig = (status: IntegrationHealth["status"]) => {
    switch (status) {
      case "healthy":
        return {
          icon: CheckCircle2,
          color: "text-green-500",
          bgColor: "bg-green-100 dark:bg-green-900/30",
          label: "Healthy",
          badgeClass: "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800",
        }
      case "warning":
        return {
          icon: AlertTriangle,
          color: "text-yellow-500",
          bgColor: "bg-yellow-100 dark:bg-yellow-900/30",
          label: "Warning",
          badgeClass: "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800",
        }
      case "error":
        return {
          icon: XCircle,
          color: "text-red-500",
          bgColor: "bg-red-100 dark:bg-red-900/30",
          label: "Error",
          badgeClass: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800",
        }
      case "expired":
        return {
          icon: Clock,
          color: "text-orange-500",
          bgColor: "bg-orange-100 dark:bg-orange-900/30",
          label: "Expired",
          badgeClass: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800",
        }
    }
  }

  // Sort integrations: errors first, then warnings, then healthy
  const sortedIntegrations = [...integrationHealthData].sort((a, b) => {
    const order = { error: 0, expired: 1, warning: 2, healthy: 3 }
    return order[a.status] - order[b.status]
  })

  // Show issues first
  const integrationIssues = sortedIntegrations.filter(i => i.status !== "healthy")
  const healthyIntegrations = sortedIntegrations.filter(i => i.status === "healthy")

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center py-8", className)}>
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (integrations.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="pt-6">
          <div className="text-center py-6">
            <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No integrations connected</p>
            <Button
              variant="link"
              className="mt-2"
              onClick={() => router.push('/connections')}
            >
              Connect your first app
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (compact) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Integration Health
            </CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={handleRefresh}
                    disabled={refreshing}
                  >
                    <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh health status</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {/* Health Score */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Health Score</span>
              <span className={cn(
                "font-medium",
                stats.healthScore >= 80 ? "text-green-600 dark:text-green-400" :
                stats.healthScore >= 50 ? "text-yellow-600 dark:text-yellow-400" :
                "text-red-600 dark:text-red-400"
              )}>
                {stats.healthScore}%
              </span>
            </div>
            <Progress
              value={stats.healthScore}
              className={cn(
                "h-2",
                stats.healthScore >= 80 ? "[&>div]:bg-green-500" :
                stats.healthScore >= 50 ? "[&>div]:bg-yellow-500" :
                "[&>div]:bg-red-500"
              )}
            />
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-muted-foreground">{stats.healthy} healthy</span>
            </div>
            {stats.warning > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-yellow-500" />
                <span className="text-muted-foreground">{stats.warning} warning</span>
              </div>
            )}
            {stats.error > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-muted-foreground">{stats.error} error</span>
              </div>
            )}
            {stats.expired > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-orange-500" />
                <span className="text-muted-foreground">{stats.expired} expired</span>
              </div>
            )}
          </div>

          {/* Issues List */}
          {integrationIssues.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase">Needs Attention</p>
              {integrationIssues.slice(0, 3).map((integration) => {
                const statusConfig = getStatusConfig(integration.status)
                const StatusIcon = statusConfig.icon
                return (
                  <div
                    key={integration.id}
                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
                    onClick={() => {
                      setSelectedIntegration(integration)
                      setDetailsOpen(true)
                    }}
                  >
                    <div className="w-6 h-6 flex items-center justify-center">
                      <img
                        src={getIntegrationLogoPath(integration.provider, theme)}
                        alt={integration.providerName}
                        className={getIntegrationLogoClasses(integration.provider, "w-5 h-5")}
                      />
                    </div>
                    <span className="text-sm font-medium flex-1 truncate">{integration.providerName}</span>
                    <StatusIcon className={cn("w-4 h-4", statusConfig.color)} />
                  </div>
                )
              })}
              {integrationIssues.length > 3 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => router.push('/connections')}
                >
                  View all {integrationIssues.length} issues
                </Button>
              )}
            </div>
          )}

          {/* All Healthy */}
          {integrationIssues.length === 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <p className="text-sm text-green-700 dark:text-green-400">
                All {stats.total} integrations are healthy
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  // Full dashboard view
  return (
    <>
      <div className={cn("space-y-6", className)}>
        {/* Header with Stats */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Integration Health
            </h2>
            <p className="text-sm text-muted-foreground">
              Monitor the health of your connected integrations
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.healthy}</p>
                  <p className="text-xs text-muted-foreground">Healthy</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-yellow-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.warning}</p>
                  <p className="text-xs text-muted-foreground">Warnings</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <XCircle className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.error}</p>
                  <p className="text-xs text-muted-foreground">Errors</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.expired}</p>
                  <p className="text-xs text-muted-foreground">Expired</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Health Score Card */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center",
                  stats.healthScore >= 80 ? "bg-green-100 dark:bg-green-900/30" :
                  stats.healthScore >= 50 ? "bg-yellow-100 dark:bg-yellow-900/30" :
                  "bg-red-100 dark:bg-red-900/30"
                )}>
                  <Shield className={cn(
                    "w-6 h-6",
                    stats.healthScore >= 80 ? "text-green-500" :
                    stats.healthScore >= 50 ? "text-yellow-500" :
                    "text-red-500"
                  )} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Overall Health Score</p>
                  <p className={cn(
                    "text-3xl font-bold",
                    stats.healthScore >= 80 ? "text-green-600 dark:text-green-400" :
                    stats.healthScore >= 50 ? "text-yellow-600 dark:text-yellow-400" :
                    "text-red-600 dark:text-red-400"
                  )}>
                    {stats.healthScore}%
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">
                  {stats.healthy} of {stats.total} integrations healthy
                </p>
              </div>
            </div>
            <Progress
              value={stats.healthScore}
              className={cn(
                "h-3",
                stats.healthScore >= 80 ? "[&>div]:bg-green-500" :
                stats.healthScore >= 50 ? "[&>div]:bg-yellow-500" :
                "[&>div]:bg-red-500"
              )}
            />
          </CardContent>
        </Card>

        {/* Issues Section */}
        {integrationIssues.length > 0 && (
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-destructive" />
                Needs Attention ({integrationIssues.length})
              </CardTitle>
              <CardDescription>
                These integrations require your attention to continue working properly
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {integrationIssues.map((integration) => {
                  const statusConfig = getStatusConfig(integration.status)
                  const StatusIcon = statusConfig.icon
                  return (
                    <div
                      key={integration.id}
                      className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => {
                        setSelectedIntegration(integration)
                        setDetailsOpen(true)
                      }}
                    >
                      <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
                        <img
                          src={getIntegrationLogoPath(integration.provider, theme)}
                          alt={integration.providerName}
                          className={getIntegrationLogoClasses(integration.provider, "w-8 h-8")}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{integration.providerName}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {integration.email || integration.accountName || "No account info"}
                        </p>
                      </div>
                      <Badge variant="outline" className={statusConfig.badgeClass}>
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {statusConfig.label}
                      </Badge>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Healthy Integrations */}
        {healthyIntegrations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                Healthy Integrations ({healthyIntegrations.length})
              </CardTitle>
              <CardDescription>
                These integrations are working properly
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {healthyIntegrations.map((integration) => (
                  <div
                    key={integration.id}
                    className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => {
                      setSelectedIntegration(integration)
                      setDetailsOpen(true)
                    }}
                  >
                    <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                      <img
                        src={getIntegrationLogoPath(integration.provider, theme)}
                        alt={integration.providerName}
                        className={getIntegrationLogoClasses(integration.provider, "w-6 h-6")}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{integration.providerName}</p>
                      {integration.lastHealthCheck && (
                        <p className="text-xs text-muted-foreground">
                          Checked {formatDistanceToNow(new Date(integration.lastHealthCheck), { addSuffix: true })}
                        </p>
                      )}
                    </div>
                    <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Integration Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {selectedIntegration && (
                <>
                  <img
                    src={getIntegrationLogoPath(selectedIntegration.provider, theme)}
                    alt={selectedIntegration.providerName}
                    className={getIntegrationLogoClasses(selectedIntegration.provider, "w-8 h-8")}
                  />
                  {selectedIntegration.providerName}
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              Integration health details
            </DialogDescription>
          </DialogHeader>

          {selectedIntegration && (
            <div className="space-y-6">
              {/* Status Badge */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant="outline" className={getStatusConfig(selectedIntegration.status).badgeClass}>
                  {(() => {
                    const StatusIcon = getStatusConfig(selectedIntegration.status).icon
                    return <StatusIcon className="w-3 h-3 mr-1" />
                  })()}
                  {getStatusConfig(selectedIntegration.status).label}
                </Badge>
              </div>

              {/* Account Info */}
              {(selectedIntegration.email || selectedIntegration.accountName) && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Account</span>
                  <span className="text-sm font-medium">
                    {selectedIntegration.email || selectedIntegration.accountName}
                  </span>
                </div>
              )}

              {/* Last Health Check */}
              {selectedIntegration.lastHealthCheck && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Last Check</span>
                  <span className="text-sm">
                    {formatDistanceToNow(new Date(selectedIntegration.lastHealthCheck), { addSuffix: true })}
                  </span>
                </div>
              )}

              {/* Next Health Check */}
              {selectedIntegration.nextHealthCheck && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Next Check</span>
                  <span className="text-sm">
                    {formatDistanceToNow(new Date(selectedIntegration.nextHealthCheck), { addSuffix: true })}
                  </span>
                </div>
              )}

              {/* Error Info */}
              {selectedIntegration.lastErrorCode && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <p className="text-sm font-medium text-red-700 dark:text-red-400 flex items-center gap-2">
                    <XCircle className="w-4 h-4" />
                    Error: {selectedIntegration.lastErrorCode}
                  </p>
                  {selectedIntegration.consecutiveFailures > 0 && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                      {selectedIntegration.consecutiveFailures} consecutive failures
                    </p>
                  )}
                </div>
              )}

              {/* User Action Required */}
              {selectedIntegration.requiresUserAction && (
                <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                  <p className="text-sm font-medium text-orange-700 dark:text-orange-400 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Action Required: {selectedIntegration.userActionType || "Reconnect"}
                  </p>
                  {selectedIntegration.userActionDeadline && (
                    <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                      Deadline: {formatDistanceToNow(new Date(selectedIntegration.userActionDeadline), { addSuffix: true })}
                    </p>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                {(selectedIntegration.status !== "healthy") && (
                  <Button
                    className="flex-1"
                    onClick={() => handleReconnect(selectedIntegration.provider)}
                    disabled={reconnecting === selectedIntegration.provider}
                  >
                    {reconnecting === selectedIntegration.provider ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Zap className="w-4 h-4 mr-2" />
                    )}
                    Reconnect
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    setDetailsOpen(false)
                    router.push('/connections')
                  }}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Manage
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Compact widget for dashboard sidebar
 */
export function IntegrationHealthWidget({ className }: { className?: string }) {
  return <IntegrationHealthDashboard className={className} compact />
}
