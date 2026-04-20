"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Clock, Check } from "lucide-react"
import { IntegrationIconRow } from "./IntegrationIconRow"
import { cn } from "@/lib/utils"

interface TemplateCardProps {
  template: any
  index: number
  connectedIntegrations: string[]
  templateIntegrations: string[]
  onPreview: (template: any) => void
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

export function TemplateCard({
  template,
  index,
  connectedIntegrations,
  templateIntegrations,
  onPreview,
}: TemplateCardProps) {
  const hasAllConnected = templateIntegrations.length > 0 &&
    templateIntegrations.every(p => connectedIntegrations.includes(p))

  return (
    <Card
      className={cn(
        "group relative overflow-hidden cursor-pointer",
        "border border-border/50 hover:border-orange-300/50 dark:hover:border-orange-700/40",
        "shadow-sm hover:shadow-md",
        "transition-all duration-200",
        "animate-fade-in-up"
      )}
      style={{ animationDelay: `${index * 40}ms`, animationFillMode: 'both' }}
      onClick={() => onPreview(template)}
    >
      <CardContent className="p-4 space-y-3">
        {/* Top row: Integration icons + difficulty */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <IntegrationIconRow
              integrations={templateIntegrations}
              connectedIntegrations={connectedIntegrations}
            />
          </div>
          {template.difficulty && (
            <span className={cn(
              "text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0",
              getDifficultyStyle(template.difficulty)
            )}>
              {template.difficulty}
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="font-semibold text-[15px] leading-snug line-clamp-1 group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">
          {template.name}
        </h3>

        {/* Description */}
        <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
          {template.description}
        </p>

        {/* Meta row */}
        <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-[11px] font-normal px-2 py-0">
            {template.category}
          </Badge>
          {template.estimatedTime && (
            <>
              <span className="text-muted-foreground/30">·</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {template.estimatedTime}
              </span>
            </>
          )}
          {hasAllConnected && (
            <>
              <span className="text-muted-foreground/30">·</span>
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <Check className="w-3 h-3" />
                Ready
              </span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
