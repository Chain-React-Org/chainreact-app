import React from 'react'
import { Card, CardContent } from "@/components/ui/card"
import { CheckCircle2, ExternalLink } from "lucide-react"
import Link from "next/link"

interface AppItem {
  id: string
  name: string
  connected: boolean
  status?: string
  connectedDate?: string
  expiresDate?: string
}

interface AppsGridRendererProps {
  apps: AppItem[]
  maxDisplay?: number
}

export function AppsGridRenderer({ apps, maxDisplay = 4 }: AppsGridRendererProps) {
  // Sort: connected apps first
  const sortedApps = [...apps].sort((a, b) => {
    if (a.connected && !b.connected) return -1
    if (!a.connected && b.connected) return 1
    return 0
  })

  const displayedApps = sortedApps.slice(0, maxDisplay)
  const hasMore = apps.length > maxDisplay

  return (
    <div className="mt-4">
      {/* Apps Grid */}
      <div className="grid sm:grid-cols-2 gap-4">
        {displayedApps.map((app) => {
          const isExpired = app.status === 'expired' || app.status === 'needs_reauthorization'

          return (
            <Card key={app.id} className="bg-card border-border hover:shadow-md transition-all">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  {/* App Icon */}
                  <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 bg-background">
                    <img
                      src={`/integrations/${app.id}.svg`}
                      alt={app.name}
                      className="w-8 h-8 object-contain"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  </div>

                  {/* App Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-base">{app.name}</h3>
                      {app.connected && !isExpired && (
                        <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                      )}
                    </div>

                    {app.connected ? (
                      <>
                        <div className="text-sm font-medium mb-1">
                          {isExpired ? (
                            <span className="text-destructive">Expired</span>
                          ) : (
                            <span className="text-foreground">Connected</span>
                          )}
                        </div>
                        {app.connectedDate && (
                          <div className="text-xs text-muted-foreground">
                            Connected {app.connectedDate}
                          </div>
                        )}
                        {app.expiresDate && (
                          <div className="text-xs text-muted-foreground">
                            Expires {app.expiresDate}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        Available to connect
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Link to Apps Page */}
      {hasMore && (
        <div className="mt-4 text-center">
          <Link
            href="/connections"
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <span>and many more on the apps page</span>
            <ExternalLink className="w-4 h-4" />
          </Link>
        </div>
      )}
    </div>
  )
}
