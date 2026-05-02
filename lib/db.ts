import { createClient } from "@supabase/supabase-js"

import { logger } from '@/lib/utils/logger'
import type { Database } from "../types/database.types"

// Helper to create db client inside handlers (avoids module-level initialization)
const getDb = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing required Supabase environment variables")
  }

  return createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

// Lazy-init proxy. Each property access calls `getDb()` so importers can
// write `db.from(...)` directly without manually invoking the factory,
// while still deferring Supabase client construction until first use
// (avoids module-level init failures at build time when env vars aren't
// set — see CLAUDE.md "Lazy Client Initialization — MANDATORY").
export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_, prop) {
    return (getDb() as any)[prop]
  }
})

// Helper functions for database operations
export async function getIntegration(userId: string, provider: string) {
  try {
    const { data, error } = await db
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", provider)
      .single()

    if (error && error.code !== "PGRST116") {
      throw error
    }

    return data
  } catch (error) {
    logger.error("Error getting integration:", error)
    return null
  }
}

export async function upsertIntegration(integration: any) {
  try {
    const { data, error } = await db
      .from("integrations")
      .upsert(integration, {
        onConflict: "user_id,provider",
      })
      .select()
      .single()

    if (error) {
      throw error
    }

    return data
  } catch (error) {
    logger.error("Error upserting integration:", error)
    throw error
  }
}

export async function getUserIntegrations(userId: string) {
  try {
    const { data, error } = await db.from("integrations").select("*").eq("user_id", userId)

    if (error) {
      throw error
    }

    return data || []
  } catch (error) {
    logger.error("Error getting user integrations:", error)
    return []
  }
}
