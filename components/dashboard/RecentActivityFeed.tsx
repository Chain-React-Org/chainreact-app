"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { formatDistanceToNow } from "date-fns"

interface RecentExecution {
  id: string
  workflowId: string
  workflowName: string
  status: string
  startedAt: string
  completedAt: string | null
  durationMs: number | null
}

interface RecentActivityFeedProps {
  executions: RecentExecution[]
  maxItems?: number
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function getStatusDotClass(status: string): string {
  switch (status) {
    case 'completed': return 'bg-emerald-500'
    case 'failed': return 'bg-red-500'
    case 'running': return 'bg-blue-500 animate-pulse'
    case 'cancelled': return 'bg-gray-400'
    default: return 'bg-gray-400'
  }
}

export function RecentActivityFeed({ executions, maxItems = 6 }: RecentActivityFeedProps) {
  const router = useRouter()

  if (executions.length === 0) return null

  return (
    <div className="animate-fade-in-up rounded-xl border bg-card" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="text-sm font-semibold">Recent Activity</h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={() => router.push('/analytics')}
        >
          View all
        </Button>
      </div>
      <div className="divide-y">
        {executions.slice(0, maxItems).map((exec) => (
          <div key={exec.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors">
            <div className={`w-2 h-2 rounded-full shrink-0 ${getStatusDotClass(exec.status)}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{exec.workflowName}</p>
            </div>
            {exec.durationMs !== null && (
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {formatDuration(exec.durationMs)}
              </span>
            )}
            <span className="text-xs text-muted-foreground shrink-0">
              {formatDistanceToNow(new Date(exec.startedAt), { addSuffix: true })}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
