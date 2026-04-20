"use client"

import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Clock, ArrowRight, Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { TemplateWorkflowPreview } from "@/components/templates/TemplateWorkflowPreview"
import { getIntegrationLogoPath, getIntegrationLogoClasses } from "@/lib/integrations/logoStyles"
import { cn } from "@/lib/utils"

interface TemplateDetailModalProps {
  template: any | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUseTemplate: (template: any) => void
  copying: boolean
  connectedIntegrations: string[]
  templateIntegrations: string[]
}

function getDifficultyStyle(difficulty: string) {
  switch (difficulty) {
    case 'beginner':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
    case 'intermediate':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
    case 'advanced':
      return 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400'
    default:
      return ''
  }
}

export function TemplateDetailModal({
  template,
  open,
  onOpenChange,
  onUseTemplate,
  copying,
  connectedIntegrations,
  templateIntegrations,
}: TemplateDetailModalProps) {
  const { resolvedTheme } = useTheme()

  if (!template) return null

  // Normalize provider IDs: template data uses underscores but SVGs use hyphens
  const normalizeId = (id: string) => id.replace(/_/g, '-')

  const isConnected = (providerId: string) =>
    connectedIntegrations.includes(providerId) || connectedIntegrations.includes(normalizeId(providerId))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-0">
        {/* Workflow Preview */}
        <div className="h-56 bg-muted/30 border-b relative">
          {template.nodes && template.nodes.length > 0 ? (
            <TemplateWorkflowPreview
              nodes={template.nodes}
              edges={template.connections || template.edges || []}
              className="w-full h-full"
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-muted-foreground/30 text-sm">No preview available</div>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          <DialogHeader className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <DialogTitle className="text-xl font-semibold tracking-tight">
                {template.name}
              </DialogTitle>
              <div className="flex items-center gap-2 shrink-0">
                {template.difficulty && (
                  <span className={cn(
                    "text-[11px] font-medium px-2.5 py-1 rounded-full",
                    getDifficultyStyle(template.difficulty)
                  )}>
                    {template.difficulty}
                  </span>
                )}
                {template.estimatedTime && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground bg-secondary px-2.5 py-1 rounded-full">
                    <Clock className="w-3 h-3" />
                    {template.estimatedTime}
                  </span>
                )}
              </div>
            </div>
            <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
              {template.description}
            </DialogDescription>
          </DialogHeader>

          {/* Integration Requirements */}
          {templateIntegrations.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-foreground">Required Integrations</h4>
              <div className="grid gap-2">
                {templateIntegrations.map((providerId: string) => {
                  const logoId = normalizeId(providerId)
                  const connected = isConnected(providerId)
                  return (
                    <div
                      key={providerId}
                      className={cn(
                        "flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm",
                        connected
                          ? "border-emerald-200/60 dark:border-emerald-800/40 bg-emerald-50/30 dark:bg-emerald-500/5"
                          : "border-border bg-muted/30"
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <img
                          src={getIntegrationLogoPath(logoId, resolvedTheme)}
                          alt=""
                          className={getIntegrationLogoClasses(logoId, "w-5 h-5 object-contain")}
                        />
                        <span className="capitalize font-medium">
                          {providerId.replace(/[-_]/g, ' ')}
                        </span>
                      </div>
                      {connected ? (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Connected
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-muted-foreground text-xs font-medium">
                          <AlertCircle className="w-3.5 h-3.5" />
                          Not connected
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              {templateIntegrations.some((p: string) => !isConnected(p)) && (
                <p className="text-xs text-muted-foreground">
                  You can connect integrations after creating the workflow.
                </p>
              )}
            </div>
          )}

          {/* Category & Tags */}
          {template.category && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="text-xs">{template.category}</Badge>
              {template.tags?.slice(0, 4).map((tag: string) => (
                <Badge key={tag} variant="outline" className="text-[11px]">{tag}</Badge>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2 border-t">
            <Button
              className="flex-1 bg-orange-600 hover:bg-orange-700 text-white h-10"
              onClick={() => onUseTemplate(template)}
              disabled={copying}
            >
              {copying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  Use This Template
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
            <Button
              variant="outline"
              className="h-10"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
