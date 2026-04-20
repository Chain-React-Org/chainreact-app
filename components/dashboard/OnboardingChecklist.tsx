"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useWorkflowStore } from "@/stores/workflowStore"
import { useIntegrationStore } from "@/stores/integrationStore"
import { useAuthStore } from "@/stores/authStore"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  Plug,
  Workflow,
  Play,
  Zap,
  X,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface ChecklistItem {
  id: string
  title: string
  description: string
  icon: React.ElementType
  action: () => void
  actionLabel: string
  isComplete: boolean
}

export function OnboardingChecklist() {
  const router = useRouter()
  const { workflows } = useWorkflowStore()
  const { integrations } = useIntegrationStore()
  const { profile, user } = useAuthStore()
  const [isExpanded, setIsExpanded] = useState(true)
  const [isDismissed, setIsDismissed] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Check localStorage for dismissed state on mount
  useEffect(() => {
    setMounted(true)
    const dismissed = localStorage.getItem("onboarding_checklist_dismissed")
    if (dismissed === "true") {
      setIsDismissed(true)
    }
  }, [])

  // Calculate completion status
  const hasConnectedApp = integrations.length > 0
  const hasCreatedWorkflow = workflows.length > 0
  const hasActiveWorkflow = workflows.some((w) => w.status === "active")
  const hasTestedWorkflow = workflows.some((w) => {
    // Check if workflow has any execution history
    // For now, we consider a workflow "tested" if it has been activated at least once
    // or if the user has run a test (indicated by last_run_at or similar)
    return w.status === "active" || (w as any).last_run_at
  })

  const checklistItems: ChecklistItem[] = [
    {
      id: "connect-app",
      title: "Connect your first app",
      description: "Link an app like Gmail, Slack, or Notion to start automating",
      icon: Plug,
      action: () => router.push("/connections"),
      actionLabel: "Connect App",
      isComplete: hasConnectedApp,
    },
    {
      id: "create-workflow",
      title: "Create a workflow",
      description: "Build your first automation from scratch or use a template",
      icon: Workflow,
      action: () => router.push("/workflows"),
      actionLabel: "Create Workflow",
      isComplete: hasCreatedWorkflow,
    },
    {
      id: "test-workflow",
      title: "Test your workflow",
      description: "Run a test to make sure everything works correctly",
      icon: Play,
      action: () => {
        // Navigate to the most recent workflow builder
        const recentWorkflow = workflows[0]
        if (recentWorkflow) {
          router.push(`/workflows/builder/${recentWorkflow.id}`)
        } else {
          router.push("/workflows")
        }
      },
      actionLabel: "Test Now",
      isComplete: hasTestedWorkflow,
    },
    {
      id: "activate-workflow",
      title: "Activate your workflow",
      description: "Turn on your workflow to start automating tasks",
      icon: Zap,
      action: () => {
        const draftWorkflow = workflows.find((w) => w.status !== "active")
        if (draftWorkflow) {
          router.push(`/workflows/builder/${draftWorkflow.id}`)
        } else {
          router.push("/workflows")
        }
      },
      actionLabel: "Activate",
      isComplete: hasActiveWorkflow,
    },
  ]

  const completedCount = checklistItems.filter((item) => item.isComplete).length
  const totalCount = checklistItems.length
  const progress = (completedCount / totalCount) * 100
  const isAllComplete = completedCount === totalCount

  const handleDismiss = useCallback(() => {
    setIsDismissed(true)
    localStorage.setItem("onboarding_checklist_dismissed", "true")
  }, [])

  const handleRestore = useCallback(() => {
    setIsDismissed(false)
    localStorage.removeItem("onboarding_checklist_dismissed")
  }, [])

  // Don't render until mounted to avoid hydration mismatch
  if (!mounted) return null

  // If all complete or dismissed, show a minimal "completed" state or nothing
  if (isDismissed) {
    return null
  }

  // If all complete, show celebration state
  if (isAllComplete) {
    return (
      <div className="rounded-xl border bg-gradient-to-br from-green-500/10 to-emerald-500/10 p-6 shadow-sm relative overflow-hidden">
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h3 className="font-semibold text-green-700 dark:text-green-400">
              Setup Complete!
            </h3>
            <p className="text-sm text-muted-foreground">
              You've finished setting up ChainReact
            </p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          Great job! You're now ready to create powerful automations.
          Check out our templates for inspiration.
        </p>

        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/templates")}
          className="w-full"
        >
          <Sparkles className="w-4 h-4 mr-2" />
          Explore Templates
        </Button>
      </div>
    )
  }

  return (
    <div data-tour="onboarding-checklist" className="rounded-xl border bg-card p-6 shadow-sm relative">
      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss onboarding checklist"
      >
        <X className="w-4 h-4" />
      </button>

      {/* Header */}
      <div
        className="flex items-center justify-between cursor-pointer pr-6"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">Get Started</h3>
            <p className="text-sm text-muted-foreground">
              {completedCount} of {totalCount} complete
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          {isExpanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </Button>
      </div>

      {/* Progress Bar */}
      <div className="mt-4">
        <Progress value={progress} className="h-2" />
      </div>

      {/* Checklist Items */}
      {isExpanded && (
        <div className="mt-4 space-y-3">
          {checklistItems.map((item, index) => {
            const Icon = item.icon
            const isNextStep =
              !item.isComplete &&
              checklistItems.slice(0, index).every((i) => i.isComplete)

            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg transition-all",
                  item.isComplete
                    ? "bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900"
                    : isNextStep
                    ? "bg-primary/5 border border-primary/20"
                    : "bg-muted/30 border border-transparent"
                )}
              >
                {/* Status Icon */}
                <div className="flex-shrink-0 mt-0.5">
                  {item.isComplete ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-500" />
                  ) : (
                    <Circle
                      className={cn(
                        "w-5 h-5",
                        isNextStep
                          ? "text-primary"
                          : "text-muted-foreground/50"
                      )}
                    />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon
                      className={cn(
                        "w-4 h-4 flex-shrink-0",
                        item.isComplete
                          ? "text-green-600 dark:text-green-500"
                          : isNextStep
                          ? "text-primary"
                          : "text-muted-foreground"
                      )}
                    />
                    <span
                      className={cn(
                        "font-medium text-sm",
                        item.isComplete && "text-green-700 dark:text-green-400"
                      )}
                    >
                      {item.title}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {item.description}
                  </p>
                </div>

                {/* Action Button */}
                {!item.isComplete && (
                  <Button
                    variant={isNextStep ? "default" : "outline"}
                    size="sm"
                    className="flex-shrink-0 h-7 text-xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      item.action()
                    }}
                  >
                    {item.actionLabel}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
