"use client"

import React from "react"
import { ExternalLink, FileText, Mail, Globe, StickyNote } from "lucide-react"
import { cn } from "@/lib/utils"

interface Source {
  index: number
  title: string
  provider?: string
  url: string
  snippet?: string
}

interface SourceCitationRendererProps {
  sources: Source[]
  className?: string
}

function getProviderIcon(provider?: string) {
  switch (provider?.toLowerCase()) {
    case "google drive":
      return <FileText className="w-4 h-4 text-blue-500" />
    case "notion":
      return <StickyNote className="w-4 h-4 text-foreground" />
    case "gmail":
      return <Mail className="w-4 h-4 text-red-500" />
    default:
      return <Globe className="w-4 h-4 text-muted-foreground" />
  }
}

export function SourceCitationRenderer({ sources, className }: SourceCitationRendererProps) {
  if (!sources || sources.length === 0) return null

  return (
    <div className={cn("mt-4 pt-3 border-t border-border/50", className)}>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        Sources
      </p>
      <div className="flex flex-wrap gap-2">
        {sources.map((source) => (
          <a
            key={source.index}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/30 hover:bg-muted/60 hover:border-primary/30 transition-all text-sm max-w-[280px]"
          >
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex-shrink-0">
              {source.index}
            </span>
            {getProviderIcon(source.provider)}
            <span className="truncate text-foreground font-medium text-xs">
              {source.title}
            </span>
            <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
          </a>
        ))}
      </div>
    </div>
  )
}
