"use client"

import { cn } from "@/lib/utils"

interface TemplateCategoryPillsProps {
  categories: string[]
  categoryCounts: Record<string, number>
  selected: string
  onSelect: (category: string) => void
  totalCount: number
}

export function TemplateCategoryPills({
  categories,
  categoryCounts,
  selected,
  onSelect,
  totalCount,
}: TemplateCategoryPillsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((category) => {
        const count = category === "all" ? totalCount : (categoryCounts[category] || 0)
        const isActive = selected === category

        return (
          <button
            key={category}
            onClick={() => onSelect(category)}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-sm font-medium transition-all duration-200 cursor-pointer",
              isActive
                ? "bg-orange-500/10 text-orange-700 dark:text-orange-300 ring-1 ring-orange-500/30"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            )}
          >
            {category === "all" ? "All" : category}
            <span
              className={cn(
                "text-[11px] tabular-nums",
                isActive
                  ? "text-orange-600/70 dark:text-orange-400/70"
                  : "text-muted-foreground/60"
              )}
            >
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
