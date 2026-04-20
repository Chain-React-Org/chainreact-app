"use client"

import { useState } from "react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  RefreshCw,
  MoreHorizontal,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Workflow,
} from "lucide-react"
import { getIntegrationLogoPath, getIntegrationLogoClasses } from "@/lib/integrations/logoStyles"
import { cn } from "@/lib/utils"
import { ConnectionWithMeta } from "./useConnections"

interface ConnectionRowProps {
  connection: ConnectionWithMeta
  index: number
  reconnecting: string | null
  disconnecting: string | null
  onReconnect: (integrationId: string) => void
  onDisconnect: (integrationId: string, providerName: string) => void
}

function getStatusConfig(status: string) {
  switch (status) {
    case 'connected':
      return {
        label: 'Connected',
        icon: CheckCircle2,
        className: 'text-emerald-600 dark:text-emerald-400',
        badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border-emerald-200/50 dark:border-emerald-700/50',
      }
    case 'expired':
    case 'needs_reauthorization':
      return {
        label: status === 'expired' ? 'Expired' : 'Needs Reconnection',
        icon: AlertTriangle,
        className: 'text-amber-600 dark:text-amber-400',
        badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200/50 dark:border-amber-700/50',
      }
    default:
      return {
        label: status,
        icon: CheckCircle2,
        className: 'text-muted-foreground',
        badgeClass: 'bg-muted text-muted-foreground border-border',
      }
  }
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getAccountDisplay(connection: ConnectionWithMeta): string {
  return connection.email || connection.username || connection.account_name || ''
}

export function ConnectionRow({
  connection,
  index,
  reconnecting,
  disconnecting,
  onReconnect,
  onDisconnect,
}: ConnectionRowProps) {
  const { resolvedTheme } = useTheme()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)

  const providerName = connection.config?.name || connection.provider
  const accountDisplay = getAccountDisplay(connection)
  const statusConfig = getStatusConfig(connection.status)
  const StatusIcon = statusConfig.icon
  const needsAttention = connection.status === 'expired' || connection.status === 'needs_reauthorization'
  const isReconnecting = reconnecting === connection.id
  const isDisconnecting = disconnecting === connection.id
  const categoryLabel = connection.config?.category
    ? connection.config.category.charAt(0).toUpperCase() + connection.config.category.slice(1)
    : null

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all duration-200 animate-fade-in-up",
          needsAttention
            ? "border-amber-200/60 dark:border-amber-800/40 bg-amber-50/30 dark:bg-amber-500/5"
            : "border-border/50 hover:border-border bg-card hover:shadow-sm"
        )}
        style={{ animationDelay: `${index * 30}ms`, animationFillMode: 'both' }}
      >
        {/* Logo */}
        <div className={cn(
          "w-10 h-10 rounded-lg border flex items-center justify-center shrink-0 bg-background",
          needsAttention ? "border-amber-300/50 dark:border-amber-700/50" : "border-border/60"
        )}>
          {logoFailed ? (
            <span className="text-sm font-semibold text-muted-foreground uppercase">
              {connection.provider.charAt(0)}
            </span>
          ) : (
            <img
              src={getIntegrationLogoPath(connection.provider, resolvedTheme)}
              alt=""
              className={getIntegrationLogoClasses(connection.provider, "w-6 h-6 object-contain")}
              onError={() => setLogoFailed(true)}
            />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-foreground truncate">
              {providerName}
            </span>
            {categoryLabel && (
              <Badge variant="secondary" className="text-[10px] font-normal px-1.5 py-0 shrink-0 hidden sm:inline-flex">
                {categoryLabel}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {accountDisplay && (
              <span className="text-xs text-muted-foreground truncate">
                {accountDisplay}
              </span>
            )}
            {accountDisplay && connection.created_at && (
              <span className="text-muted-foreground/30 hidden sm:inline">·</span>
            )}
            {connection.created_at && (
              <span className="text-xs text-muted-foreground/60 hidden sm:inline">
                Connected {formatDate(connection.created_at)}
              </span>
            )}
          </div>
        </div>

        {/* Workflow usage */}
        {connection.workflowCount > 0 && (
          <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground shrink-0" title={connection.workflowNames.join(', ')}>
            <Workflow className="w-3.5 h-3.5" />
            <span>{connection.workflowCount} workflow{connection.workflowCount !== 1 ? 's' : ''}</span>
          </div>
        )}

        {/* Status badge */}
        <Badge
          variant="outline"
          className={cn("text-[11px] gap-1 shrink-0", statusConfig.badgeClass)}
        >
          <StatusIcon className="w-3 h-3" />
          {statusConfig.label}
        </Badge>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {needsAttention && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10"
              onClick={() => onReconnect(connection.id)}
              disabled={isReconnecting}
            >
              {isReconnecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  Reconnect
                </>
              )}
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!needsAttention && (
                <DropdownMenuItem onClick={() => onReconnect(connection.id)}>
                  <RefreshCw className="w-3.5 h-3.5 mr-2" />
                  Reconnect
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" />
                Disconnect
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Disconnect confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {providerName}?</AlertDialogTitle>
            <AlertDialogDescription>
              {connection.workflowCount > 0 ? (
                <>
                  This connection is used by <strong>{connection.workflowCount} workflow{connection.workflowCount !== 1 ? 's' : ''}</strong>.
                  Disconnecting will break those workflows until a new connection is added.
                </>
              ) : (
                "This will remove the connection. You can reconnect at any time."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onDisconnect(connection.id, providerName)}
              disabled={isDisconnecting}
            >
              {isDisconnecting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
