import { createClient as createBrowserClient } from "@/utils/supabase/client"

export function createClient() {
  return createBrowserClient()
}

// Lazily get the client instance - avoid module-level initialization for build compatibility
export function getSupabase() {
  return createClient()
}

// Lazy-init Proxy so importers can write `import { supabase } from ...`
// and call `supabase.from(...)` directly without manually invoking
// createClient(). The Proxy defers client construction until first
// property access — this keeps the module safe to import at build time
// when the Supabase env vars may not be present (mirrors lib/db.ts).
export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(_, prop) {
    return (createClient() as any)[prop]
  }
})

export default createClient
