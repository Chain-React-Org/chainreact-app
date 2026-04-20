"use client"

import { useState } from "react"
import { ChevronRight } from "lucide-react"
import { useTheme } from "next-themes"
import { getIntegrationLogoPath, getIntegrationLogoClasses } from "@/lib/integrations/logoStyles"
import { cn } from "@/lib/utils"

// Internal ChainReact node types — use existing SVGs from /integrations/
// These have their own distinct icons rather than the platform logo
const INTERNAL_PROVIDERS = new Set(['ai', 'logic', 'webhook', 'custom', 'utility', 'chainreact'])

interface IntegrationIconRowProps {
  integrations: string[]
  connectedIntegrations: string[]
  maxVisible?: number
}

export function IntegrationIconRow({
  integrations,
  connectedIntegrations,
  maxVisible = 3,
}: IntegrationIconRowProps) {
  const { resolvedTheme } = useTheme()
  const [failedLogos, setFailedLogos] = useState<Set<string>>(new Set())

  // Normalize provider IDs: template data uses underscores (google_calendar)
  // but SVG files use hyphens (google-calendar.svg)
  const normalizeId = (id: string) => id.replace(/_/g, '-')

  const visible = integrations.slice(0, maxVisible)
  const overflow = integrations.length - maxVisible

  const handleImgError = (providerId: string) => {
    setFailedLogos(prev => new Set(prev).add(providerId))
  }

  const isConnected = (providerId: string) =>
    connectedIntegrations.includes(providerId) || connectedIntegrations.includes(normalizeId(providerId))

  if (integrations.length === 0) return null

  return (
    <div className="flex items-center gap-1.5">
      {visible.map((providerId, i) => {
        const logoId = normalizeId(providerId)
        const isInternal = INTERNAL_PROVIDERS.has(providerId)

        return (
          <div key={providerId} className="flex items-center gap-1.5">
            {i > 0 && (
              <ChevronRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
            )}
            <div
              className={cn(
                "w-8 h-8 rounded-lg border bg-background flex items-center justify-center shrink-0",
                "transition-colors duration-200",
                isInternal
                  ? "border-orange-200 dark:border-orange-700/50"
                  : isConnected(providerId)
                    ? "border-emerald-300/50 dark:border-emerald-700/50"
                    : "border-border/60"
              )}
            >
              {failedLogos.has(logoId) ? (
                <span className="text-[11px] font-semibold text-muted-foreground uppercase">
                  {providerId.charAt(0)}
                </span>
              ) : (
                <img
                  src={getIntegrationLogoPath(logoId, resolvedTheme)}
                  alt={providerId}
                  className={getIntegrationLogoClasses(logoId, "w-5 h-5 object-contain")}
                  onError={() => handleImgError(logoId)}
                />
              )}
            </div>
          </div>
        )
      })}
      {overflow > 0 && (
        <span className="text-xs text-muted-foreground font-medium ml-0.5">
          +{overflow}
        </span>
      )}
    </div>
  )
}
