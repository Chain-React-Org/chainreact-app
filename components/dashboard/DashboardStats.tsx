"use client"

import { PlayCircle, Layers, Zap, CheckCircle2 } from "lucide-react"

interface DashboardStatsProps {
  active: number
  total: number
  todayExecutions: number
  successRate: number
}

export function DashboardStats({ active, total, todayExecutions, successRate }: DashboardStatsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="animate-fade-in-up flex items-center gap-4 p-4 rounded-xl border bg-card hover:shadow-md transition-all duration-200" style={{ animationDelay: '0ms', animationFillMode: 'both' }}>
        <div className="w-11 h-11 rounded-xl bg-green-500 flex items-center justify-center shrink-0">
          <PlayCircle className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight">{active}</span>
            {total > 0 && (
              <span className="text-xs text-muted-foreground">of {total}</span>
            )}
          </div>
        </div>
      </div>

      <div className="animate-fade-in-up flex items-center gap-4 p-4 rounded-xl border bg-card hover:shadow-md transition-all duration-200" style={{ animationDelay: '50ms', animationFillMode: 'both' }}>
        <div className="w-11 h-11 rounded-xl bg-orange-500 flex items-center justify-center shrink-0">
          <Layers className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Workflows</p>
          <span className="text-2xl font-bold tracking-tight">{total}</span>
        </div>
      </div>

      <div className="animate-fade-in-up flex items-center gap-4 p-4 rounded-xl border bg-card hover:shadow-md transition-all duration-200" style={{ animationDelay: '100ms', animationFillMode: 'both' }}>
        <div className="w-11 h-11 rounded-xl bg-blue-500 flex items-center justify-center shrink-0">
          <Zap className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Today</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight">{todayExecutions}</span>
            <span className="text-xs text-muted-foreground">runs</span>
          </div>
        </div>
      </div>

      <div className="animate-fade-in-up flex items-center gap-4 p-4 rounded-xl border bg-card hover:shadow-md transition-all duration-200" style={{ animationDelay: '150ms', animationFillMode: 'both' }}>
        <div className="w-11 h-11 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Success</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight">{successRate}%</span>
            {successRate >= 90 && (
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Healthy</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
