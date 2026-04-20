"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef } from "react"

/**
 * Hook for intelligently prefetching routes based on user behavior
 * Prefetches routes when user hovers or focuses on navigation elements
 */
export function useRoutePrefetch() {
  const router = useRouter()
  const prefetchedRoutes = useRef<Set<string>>(new Set())

  const prefetchRoute = useCallback((href: string) => {
    // Only prefetch once per route
    if (prefetchedRoutes.current.has(href)) {
      return
    }

    try {
      router.prefetch(href)
      prefetchedRoutes.current.add(href)
      console.log(`[Prefetch] Prefetched route: ${href}`)
    } catch (error) {
      console.error(`[Prefetch] Failed to prefetch ${href}:`, error)
    }
  }, [router])

  return { prefetchRoute }
}

/**
 * Hook for prefetching likely next routes based on current page
 * Automatically prefetches common navigation paths
 */
export function useSmartPrefetch(currentPath: string) {
  const { prefetchRoute } = useRoutePrefetch()
  const hasPrefetched = useRef(false)

  useEffect(() => {
    if (hasPrefetched.current) return
    hasPrefetched.current = true

    // Define likely next pages based on current location
    const prefetchMap: Record<string, string[]> = {
      "/workflows": ["/workflows/ai-agent", "/workflows/builder", "/templates", "/connections"],
      "/templates": ["/workflows", "/connections", "/workflows/ai-agent"],
      "/connections": ["/workflows", "/templates"],
      "/ai-assistant": ["/workflows", "/workflows/ai-agent"],
      "/analytics": ["/workflows"],
      "/teams": ["/organization", "/settings"],
      "/organization": ["/teams"],
      "/settings": ["/workflows", "/connections"],
      "/": ["/workflows", "/templates", "/connections"], // Home page
    }

    // Get routes to prefetch for current path
    const routesToPrefetch = prefetchMap[currentPath] || []

    // Prefetch with delay to avoid impacting current page load
    const timeoutId = setTimeout(() => {
      routesToPrefetch.forEach(route => {
        prefetchRoute(route)
      })
    }, 1000) // Wait 1 second after page load

    return () => clearTimeout(timeoutId)
  }, [currentPath, prefetchRoute])
}
