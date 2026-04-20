"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ProfessionalSearch } from "@/components/ui/professional-search"
import { Plug, Search, AlertTriangle } from "lucide-react"
import { useConnections, StatusFilter } from "./useConnections"
import { ConnectionRow } from "./ConnectionRow"
import { cn } from "@/lib/utils"

const STATUS_TABS: { value: StatusFilter; label: string; countKey: keyof ReturnType<typeof useConnections>['statusCounts'] }[] = [
  { value: "all", label: "All", countKey: "all" },
  { value: "connected", label: "Connected", countKey: "connected" },
  { value: "attention", label: "Needs Attention", countKey: "attention" },
]

export function ConnectionsContent() {
  const {
    loading,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    connections,
    statusCounts,
    disconnecting,
    reconnecting,
    handleReconnect,
    handleDisconnect,
  } = useConnections()

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="space-y-1 animate-fade-in-down">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Connections
          </h1>
          {!loading && statusCounts.all > 0 && (
            <Badge variant="secondary" className="text-xs font-normal">
              {statusCounts.all} connected
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Manage your connected accounts. Connect new integrations from the workflow builder.
        </p>
      </div>

      {/* Search + Status tabs */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex-1 w-full sm:w-auto">
          <ProfessionalSearch
            placeholder="Search connections..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery('')}
          />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {STATUS_TABS.map(tab => {
            const count = statusCounts[tab.countKey]
            // Hide "Needs Attention" tab if count is 0
            if (tab.value === "attention" && count === 0) return null

            return (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-sm font-medium transition-all duration-200 cursor-pointer",
                  statusFilter === tab.value
                    ? tab.value === "attention"
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30"
                      : "bg-orange-500/10 text-orange-700 dark:text-orange-300 ring-1 ring-orange-500/30"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                )}
              >
                {tab.label}
                <span className={cn(
                  "text-[11px] tabular-nums",
                  statusFilter === tab.value
                    ? tab.value === "attention"
                      ? "text-amber-600/70 dark:text-amber-400/70"
                      : "text-orange-600/70 dark:text-orange-400/70"
                    : "text-muted-foreground/60"
                )}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Connections List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 px-4 py-3.5 rounded-xl border border-border/50"
            >
              <div className="w-10 h-10 rounded-lg bg-muted animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-muted animate-pulse rounded w-32" />
                <div className="h-3 bg-muted animate-pulse rounded w-48" />
              </div>
              <div className="h-6 bg-muted animate-pulse rounded-full w-20" />
              <div className="h-8 bg-muted animate-pulse rounded w-8" />
            </div>
          ))}
        </div>
      ) : connections.length === 0 ? (
        <div className="text-center py-20 animate-fade-in">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
            {statusFilter === "attention" ? (
              <AlertTriangle className="w-6 h-6 text-muted-foreground" />
            ) : searchQuery ? (
              <Search className="w-6 h-6 text-muted-foreground" />
            ) : (
              <Plug className="w-6 h-6 text-muted-foreground" />
            )}
          </div>
          <h3 className="text-base font-semibold mb-1">
            {statusFilter === "attention"
              ? "All connections are healthy"
              : searchQuery
                ? "No connections found"
                : "No connections yet"
            }
          </h3>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto mb-5">
            {statusFilter === "attention"
              ? "All your integrations are working properly."
              : searchQuery
                ? "Try adjusting your search."
                : "Connect integrations when you build your first workflow."
            }
          </p>
          {searchQuery && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setSearchQuery(''); setStatusFilter('all') }}
            >
              Clear Filters
            </Button>
          )}
          {statusFilter === "attention" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStatusFilter('all')}
            >
              View All Connections
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {connections.map((connection, index) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              index={index}
              reconnecting={reconnecting}
              disconnecting={disconnecting}
              onReconnect={handleReconnect}
              onDisconnect={handleDisconnect}
            />
          ))}
        </div>
      )}
    </div>
  )
}
