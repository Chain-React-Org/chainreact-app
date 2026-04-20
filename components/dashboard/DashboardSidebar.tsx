"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Plug, BarChart3, Layers } from "lucide-react"
import { OnboardingChecklist } from "@/components/dashboard/OnboardingChecklist"
import { RecentFavorites } from "@/components/workflows/RecentFavorites"

export function DashboardSidebar() {
  const router = useRouter()

  return (
    <div className="xl:col-span-1 space-y-6">
      {/* Onboarding Checklist */}
      <OnboardingChecklist />

      {/* Recent & Favorites */}
      <RecentFavorites maxItems={5} />

      {/* Quick Actions Card */}
      <div className="animate-fade-in-up rounded-xl border bg-card p-5 shadow-sm" style={{ animationDelay: '300ms', animationFillMode: 'both' }}>
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Quick Actions</h3>
        <div className="space-y-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start h-9"
            onClick={() => router.push('/connections')}
          >
            <Plug className="w-4 h-4 mr-2 text-muted-foreground" />
            Connections
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start h-9"
            onClick={() => router.push('/analytics')}
          >
            <BarChart3 className="w-4 h-4 mr-2 text-muted-foreground" />
            Analytics
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start h-9"
            onClick={() => router.push('/templates')}
          >
            <Layers className="w-4 h-4 mr-2 text-muted-foreground" />
            Templates
          </Button>
        </div>
      </div>
    </div>
  )
}
