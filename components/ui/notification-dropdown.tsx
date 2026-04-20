"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, Users, Check, X, Loader2, AlertCircle, Share2, AlertTriangle, Unplug, Zap } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { logger } from "@/lib/utils/logger"
import { cn } from "@/lib/utils"

interface Notification {
  id: string
  type: string
  title: string
  message: string
  action_url?: string
  action_label?: string
  metadata?: any
  is_read: boolean
  created_at: string
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffSec < 60) return "now"
  if (diffMin < 60) return `${diffMin}m`
  if (diffHr < 24) return `${diffHr}h`
  if (diffDay < 7) return `${diffDay}d`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function getTypeConfig(type: string) {
  switch (type) {
    case 'team_invitation':
      return {
        icon: <Users className="w-4 h-4" />,
        accent: 'border-l-blue-500',
        iconBg: 'bg-blue-500/10 dark:bg-blue-500/20',
        iconColor: 'text-blue-600 dark:text-blue-400',
      }
    case 'workflow_shared':
      return {
        icon: <Share2 className="w-4 h-4" />,
        accent: 'border-l-violet-500',
        iconBg: 'bg-violet-500/10 dark:bg-violet-500/20',
        iconColor: 'text-violet-600 dark:text-violet-400',
      }
    case 'execution_failed':
      return {
        icon: <AlertCircle className="w-4 h-4" />,
        accent: 'border-l-red-500',
        iconBg: 'bg-red-500/10 dark:bg-red-500/20',
        iconColor: 'text-red-600 dark:text-red-400',
      }
    case 'integration_disconnected':
      return {
        icon: <Unplug className="w-4 h-4" />,
        accent: 'border-l-amber-500',
        iconBg: 'bg-amber-500/10 dark:bg-amber-500/20',
        iconColor: 'text-amber-600 dark:text-amber-400',
      }
    case 'integration_warning':
      return {
        icon: <AlertTriangle className="w-4 h-4 translate-y-[1.5px]" />,
        accent: 'border-l-amber-500',
        iconBg: 'bg-amber-500/10 dark:bg-amber-500/20',
        iconColor: 'text-amber-600 dark:text-amber-400',
      }
    default:
      return {
        icon: <Zap className="w-4 h-4" />,
        accent: 'border-l-gray-400',
        iconBg: 'bg-gray-500/10 dark:bg-gray-500/20',
        iconColor: 'text-gray-500 dark:text-gray-400',
      }
  }
}

export function NotificationDropdown() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [processingNotification, setProcessingNotification] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchNotifications = async () => {
    try {
      const response = await fetch('/api/notifications?unread=true')
      if (response.ok) {
        const { notifications: data } = await response.json()
        logger.info('Fetched notifications:', { count: data?.length || 0, notifications: data })
        setNotifications(data || [])
      } else {
        logger.error('Failed to fetch notifications:', { status: response.status })
      }
    } catch (error) {
      logger.error('Error fetching notifications:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 30000)
    return () => clearInterval(interval)
  }, [])

  const handleAcceptInvitation = async (notification: Notification, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    try {
      setProcessingNotification(notification.id)
      const invitationId = notification.metadata?.invitation_id

      const response = await fetch(`/api/teams/invitations/${invitationId}`, {
        method: 'POST'
      })

      if (!response.ok) {
        const error = await response.json()
        if (response.status === 403 && error.error?.includes('upgrade')) {
          toast.error('You need to upgrade to a Pro plan or higher to join teams')
          router.push('/subscription')
          return
        }
        throw new Error(error.error || 'Failed to accept invitation')
      }

      const { team } = await response.json()
      toast.success(`Welcome to ${team.name}!`)
      fetchNotifications()
      router.push(`/teams`)
    } catch (error) {
      logger.error('Error accepting invitation:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to accept invitation')
    } finally {
      setProcessingNotification(null)
    }
  }

  const handleDeclineInvitation = async (notification: Notification, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    try {
      setProcessingNotification(notification.id)
      const invitationId = notification.metadata?.invitation_id

      const response = await fetch(`/api/teams/invitations/${invitationId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to decline invitation')
      }

      toast.success('Invitation declined')
      fetchNotifications()
    } catch (error) {
      logger.error('Error declining invitation:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to decline invitation')
    } finally {
      setProcessingNotification(null)
    }
  }

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_ids: [notificationId] })
      })
      if (response.ok) {
        fetchNotifications()
      }
    } catch (error) {
      logger.error('Error marking notification as read:', error)
    }
  }

  const handleMarkAllAsRead = async () => {
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mark_all: true })
      })
      fetchNotifications()
      toast.success('All notifications marked as read')
    } catch (error) {
      logger.error('Error marking all as read:', error)
    }
  }

  const totalCount = notifications.length
  const hasNotifications = totalCount > 0

  const renderNotificationItem = (notification: Notification) => {
    const config = getTypeConfig(notification.type)
    const isInvitation = notification.type === 'team_invitation'

    return (
      <div
        key={notification.id}
        className={cn(
          "relative border-l-2 transition-colors",
          config.accent,
          isInvitation ? "" : "cursor-pointer",
          "hover:bg-gray-50/80 dark:hover:bg-white/[0.03]",
        )}
        onClick={() => {
          if (!isInvitation && notification.action_url) {
            handleMarkAsRead(notification.id)
            router.push(notification.action_url)
          }
        }}
      >
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Icon */}
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
              config.iconBg, config.iconColor,
            )}>
              {config.icon}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2 mb-0.5">
                <p className="text-[13px] font-semibold text-gray-900 dark:text-gray-50 truncate">{notification.title}</p>
                <span className="text-[11px] text-gray-400 dark:text-gray-500 flex-shrink-0 tabular-nums">
                  {formatRelativeTime(notification.created_at)}
                </span>
              </div>
              <p className="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">{notification.message}</p>

              {/* Action link for non-invitation notifications */}
              {!isInvitation && notification.action_label && (
                <button className="mt-2 text-[12px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors">
                  {notification.action_label} &rarr;
                </button>
              )}

              {/* Invitation actions */}
              {isInvitation && (
                <div className="flex items-center gap-2 mt-2.5">
                  <Button
                    size="sm"
                    className="h-[26px] text-[11px] font-medium px-2.5 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                    onClick={(e) => handleAcceptInvitation(notification, e)}
                    disabled={processingNotification === notification.id}
                  >
                    {processingNotification === notification.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <>
                        <Check className="w-3 h-3 mr-1" />
                        Accept
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-[26px] text-[11px] font-medium px-2.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                    onClick={(e) => handleDeclineInvitation(notification, e)}
                    disabled={processingNotification === notification.id}
                  >
                    <X className="w-3 h-3 mr-1" />
                    Decline
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative flex items-center justify-center h-8 w-8 rounded-md text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          <Bell className="h-[18px] w-[18px]" strokeWidth={2} />
          {hasNotifications && (
            <span className="absolute top-0 right-0 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-red-500 ring-2 ring-white dark:ring-gray-950 px-0.5 text-[9px] font-bold text-white leading-none">
              {totalCount > 9 ? '9+' : totalCount}
            </span>
          )}
          <span className="sr-only">Notifications</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-[360px] p-0 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-xl shadow-black/8 dark:shadow-black/30 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-800/80">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">Notifications</h3>
            {hasNotifications && (
              <span className="flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded-full bg-gray-100 dark:bg-gray-800 text-[10px] font-semibold text-gray-600 dark:text-gray-300">
                {totalCount}
              </span>
            )}
          </div>
          {hasNotifications && (
            <button
              onClick={handleMarkAllAsRead}
              className="text-[11px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              Mark all read
            </button>
          )}
        </div>

        {/* Notification List */}
        <div className="max-h-[420px] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800/60">
          {/* Empty State */}
          {totalCount === 0 && !loading && (
            <div className="px-4 py-14 text-center">
              <div className="w-10 h-10 rounded-full bg-gray-50 dark:bg-gray-900 flex items-center justify-center mx-auto mb-3">
                <Bell className="w-[18px] h-[18px] text-gray-300 dark:text-gray-600" />
              </div>
              <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400">No new notifications</p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">You're all caught up</p>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="px-4 py-14 text-center">
              <Loader2 className="w-5 h-5 text-gray-300 dark:text-gray-600 mx-auto animate-spin" />
            </div>
          )}

          {/* All notifications rendered in order */}
          {notifications.map(renderNotificationItem)}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
