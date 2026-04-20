"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ProfessionalSearch } from "@/components/ui/professional-search"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ArrowUpDown, Search } from "lucide-react"
import { useTemplateLibrary } from "./useTemplateLibrary"
import { TemplateCategoryPills } from "./TemplateCategoryPills"
import { TemplateCard } from "./TemplateCard"
import { TemplateDetailModal } from "./TemplateDetailModal"

export function LibraryContent() {
  const {
    loading,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    sortBy,
    setSortBy,
    filteredTemplates,
    categories,
    categoryCounts,
    totalCount,
    connectedIntegrations,
    getTemplateIntegrations,
    copying,
    handleUseTemplate,
    previewTemplate,
    previewModalOpen,
    openPreview,
    closePreview,
  } = useTemplateLibrary()

  const previewIntegrations = previewTemplate
    ? getTemplateIntegrations(previewTemplate)
    : []

  return (
    <div className="space-y-5">
      {/* Hero — clean text, no container */}
      <div className="space-y-1 animate-fade-in-down">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Template Library
        </h1>
        <p className="text-sm text-muted-foreground">
          Start with professionally designed workflows. Customize and deploy in minutes.
        </p>
      </div>

      {/* Search + Sort row */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <ProfessionalSearch
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery('')}
          />
        </div>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[160px] h-10">
            <ArrowUpDown className="w-3.5 h-3.5 mr-1.5 text-muted-foreground shrink-0" />
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default</SelectItem>
            <SelectItem value="easiest">Easiest First</SelectItem>
            <SelectItem value="advanced">Most Advanced</SelectItem>
            <SelectItem value="newest">Newest</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Category pills with counts */}
      <TemplateCategoryPills
        categories={categories}
        categoryCounts={categoryCounts}
        selected={selectedCategory}
        onSelect={setSelectedCategory}
        totalCount={totalCount}
      />

      {/* Result count */}
      {!loading && (
        <p className="text-xs text-muted-foreground">
          Showing {filteredTemplates.length} {filteredTemplates.length === 1 ? 'template' : 'templates'}
          {selectedCategory !== "all" && ` in ${selectedCategory}`}
        </p>
      )}

      {/* Templates Grid */}
      {loading ? (
        <div
          className="grid grid-cols-1 gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <CardContent className="p-4 space-y-3">
                {/* Icon row skeleton */}
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-muted animate-pulse" />
                  <div className="w-3 h-3 rounded bg-muted animate-pulse" />
                  <div className="w-8 h-8 rounded-lg bg-muted animate-pulse" />
                  <div className="w-3 h-3 rounded bg-muted animate-pulse" />
                  <div className="w-8 h-8 rounded-lg bg-muted animate-pulse" />
                </div>
                {/* Title skeleton */}
                <div className="h-5 bg-muted animate-pulse rounded w-3/4" />
                {/* Description skeleton */}
                <div className="space-y-1.5">
                  <div className="h-4 bg-muted animate-pulse rounded w-full" />
                  <div className="h-4 bg-muted animate-pulse rounded w-2/3" />
                </div>
                {/* Meta skeleton */}
                <div className="flex items-center gap-2 pt-1">
                  <div className="h-5 bg-muted animate-pulse rounded-full w-20" />
                  <div className="h-4 bg-muted animate-pulse rounded w-12" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredTemplates.length === 0 ? (
        /* Empty State */
        <div className="text-center py-20 animate-fade-in">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <Search className="w-6 h-6 text-muted-foreground" />
          </div>
          <h3 className="text-base font-semibold mb-1">No templates found</h3>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto mb-5">
            Try adjusting your search or filters.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setSearchQuery(''); setSelectedCategory('all') }}
          >
            Clear Filters
          </Button>
        </div>
      ) : (
        <div
          className="grid grid-cols-1 gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}
        >
          {filteredTemplates.map((template, index) => (
            <TemplateCard
              key={template.id}
              template={template}
              index={index}
              connectedIntegrations={connectedIntegrations}
              templateIntegrations={getTemplateIntegrations(template)}
              onPreview={openPreview}
            />
          ))}
        </div>
      )}

      {/* Detail Modal */}
      <TemplateDetailModal
        template={previewTemplate}
        open={previewModalOpen}
        onOpenChange={(open) => { if (!open) closePreview() }}
        onUseTemplate={handleUseTemplate}
        copying={copying}
        connectedIntegrations={connectedIntegrations}
        templateIntegrations={previewIntegrations}
      />
    </div>
  )
}
