'use client'

import { useEffect, useState } from 'react'
import { useIntegrationStore } from '@/stores/integrationStore'
import { useAuthStore } from '@/stores/authStore'
import { AlertTriangle, X, RefreshCw, Minus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { AnimatePresence, motion } from 'framer-motion'

import { logger } from '@/lib/utils/logger'

interface ReAuthNotificationProps {
  className?: string
}

const DISMISSAL_KEY = 'reauth-notification-dismissed'

export function ReAuthNotification({ className }: ReAuthNotificationProps) {
  const { integrations } = useIntegrationStore()
  const { user } = useAuthStore()
  const [isVisible, setIsVisible] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [needsReAuthCount, setNeedsReAuthCount] = useState(0)
  const [expiredIntegrations, setExpiredIntegrations] = useState<string[]>([])
  const [dismissedUntil, setDismissedUntil] = useState<number | null>(null)

  // Load dismissal state from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(DISMISSAL_KEY)
      if (stored) {
        const timestamp = parseInt(stored, 10)
        if (!isNaN(timestamp)) {
          setDismissedUntil(timestamp)
        }
      }
    }
  }, [])

  useEffect(() => {
    if (!user || !integrations.length) {
      setIsVisible(false)
      return
    }

    // Check if notification was dismissed
    const now = new Date()
    if (dismissedUntil && now.getTime() < dismissedUntil) {
      setIsVisible(false)
      return
    }

    // Use the same logic as the UI to determine expired integrations
    const reAuthIntegrations = integrations.filter(integration => {
      // Check database status first
      if (integration.status === 'needs_reauthorization' || integration.status === 'expired') {
        logger.info(`🔴 Integration ${integration.provider} needs re-auth (status: ${integration.status})`)
        return true
      }
      
      // Check if connected integration has expired based on expires_at timestamp
      if (integration.status === 'connected' && integration.expires_at) {
        const expiresAt = new Date(integration.expires_at)
        // Use the same approach as UI: UTC timestamps for comparison to avoid timezone issues
        const expiryTimestamp = expiresAt.getTime()
        const nowTimestamp = now.getTime()
        
        // If expired (past the expiry time)
        if (expiryTimestamp <= nowTimestamp) {
          logger.info(`🔴 Integration ${integration.provider} needs re-auth (expired at ${expiresAt.toISOString()}, now: ${now.toISOString()})`)
          return true
        }
      }
      
      return false
    })

    const reAuthCount = reAuthIntegrations.length
    logger.info(`📊 Re-auth notification: ${reAuthCount} integrations need re-authorization`)

    // Format integration names for display
    const formatProviderName = (provider: string) => {
      // Handle special cases
      const specialCases: Record<string, string> = {
        'google-calendar': 'Google Calendar',
        'google-drive': 'Google Drive',
        'google-sheets': 'Google Sheets',
        'google-docs': 'Google Docs',
        'microsoft-outlook': 'Microsoft Outlook',
        'microsoft-onenote': 'Microsoft OneNote',
        'microsoft-excel': 'Microsoft Excel',
        'youtube-studio': 'YouTube Studio',
      }

      if (specialCases[provider]) {
        return specialCases[provider]
      }

      // Capitalize first letter for other providers
      return provider.charAt(0).toUpperCase() + provider.slice(1)
    }

    const expiredNames = reAuthIntegrations.map(int => formatProviderName(int.provider))
    setExpiredIntegrations(expiredNames)
    setNeedsReAuthCount(reAuthCount)
    setIsVisible(reAuthCount > 0)
  }, [user, integrations, dismissedUntil])

  const handleDismiss = () => {
    // Dismiss for 1 hour
    const oneHourFromNow = Date.now() + (60 * 60 * 1000)
    setDismissedUntil(oneHourFromNow)
    setIsVisible(false)
    setIsExpanded(false)
    
    // Store in localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem(DISMISSAL_KEY, oneHourFromNow.toString())
    }
  }

  const handleMinimize = () => {
    setIsExpanded(false)
  }

  const handleExpand = () => {
    setIsExpanded(true)
  }

  const handleGoToIntegrations = () => {
    window.location.href = '/connections'
  }

  if (!isVisible) return null

  return (
    <>
      {/* Small circle notification in bottom right */}
      <AnimatePresence>
        {!isExpanded && (
          <motion.div
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0 }}
            className={cn(
              "fixed bottom-6 right-6 z-[100] cursor-pointer",
              className
            )}
            onClick={handleExpand}
          >
            <div className="relative">
              <div className="w-12 h-12 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-lg transition-colors duration-200">
                <AlertTriangle className="h-6 w-6 text-white" />
              </div>
              {/* Badge with count */}
              {needsReAuthCount > 0 && (
                <div className="absolute -top-1 -right-1 bg-red-700 text-white text-xs rounded-full min-w-[20px] h-5 flex items-center justify-center px-1 font-medium">
                  {needsReAuthCount}
                </div>
              )}
              {/* Pulse animation */}
              <div className="absolute inset-0 w-12 h-12 bg-red-500 rounded-full animate-ping opacity-20"></div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded popup in center */}
      <AnimatePresence>
        {isExpanded && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-[90]"
              onClick={handleMinimize}
            />
            
            {/* Popup */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            >
              <Alert className="border-red-200 bg-red-50 shadow-xl border-l-4 w-full max-w-lg">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <span className="font-medium text-base">
                        {needsReAuthCount} integration{needsReAuthCount !== 1 ? 's' : ''} need{needsReAuthCount !== 1 ? '' : 's'} re-authorization
                      </span>
                      <p className="text-sm mt-2 opacity-90">
                        The following integration{needsReAuthCount !== 1 ? 's have' : ' has'} expired:
                      </p>
                      <ul className="text-sm mt-2 space-y-1 pl-4">
                        {expiredIntegrations.map((integration, index) => (
                          <li key={index} className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-600 flex-shrink-0"></span>
                            <span className="font-medium">{integration}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="text-sm mt-2 opacity-90">
                        Please reconnect {needsReAuthCount !== 1 ? 'them' : 'it'} to continue using {needsReAuthCount !== 1 ? 'them' : 'it'} in your workflows.
                      </p>
                      <div className="flex items-center gap-2 mt-4">
                        <Button
                          onClick={handleGoToIntegrations}
                          size="sm"
                          className="bg-red-600 hover:bg-red-700 text-white"
                        >
                          <RefreshCw className="h-3 w-3 mr-2" />
                          Reconnect Now
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <Button
                        onClick={handleMinimize}
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:bg-red-100 p-1 h-8 w-8"
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Button
                        onClick={handleDismiss}
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:bg-red-100 p-1 h-8 w-8"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
