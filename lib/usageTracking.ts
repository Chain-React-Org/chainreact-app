import { createClient } from "@/utils/supabaseClient"

import { logger } from '@/lib/utils/logger'

export async function trackUsage(userId: string, resourceType: string, action: string, quantity = 1, metadata?: any) {
  const supabase = createClient()

  try {
    // Log the usage
    await supabase.from("usage_logs").insert({
      user_id: userId,
      resource_type: resourceType,
      action,
      quantity,
      metadata,
    })

    // Update monthly usage
    const currentDate = new Date()
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth() + 1

    const updateField = getUsageField(resourceType)
    if (updateField) {
      await supabase.rpc("increment_monthly_usage", {
        p_user_id: userId,
        p_year: year,
        p_month: month,
        p_field: updateField,
        p_increment: quantity,
      })
    }
  } catch (error) {
    logger.error("Usage tracking error:", error)
  }
}

export async function checkUsageLimit(
  userId: string,
  resourceType: string,
): Promise<{ allowed: boolean; limit: number; current: number }> {
  // §C cleanup — the `'execution'` branch that called the deprecated
  // `checkTaskBalance` was removed; no caller passed `'execution'` here
  // (verified via grep). Task-based execution gating goes through
  // `deductTasksAtomic` at the workflow execution boundary — see
  // `lib/workflows/taskDeduction.ts` and CLAUDE.md "Task Cost Visibility
  // & Billing."
  const supabase = createClient()

  try {
    // Get current subscription and plan
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select(`
        *,
        plans (*)
      `)
      .eq("user_id", userId)
      .eq("status", "active")
      .single()

    let plan: any = subscription?.plans ?? null

    if (!plan) {
      // No active subscription row — fall back to the plan named on user_profiles.plan
      // (which is the canonical source for free-tier and admin/test-set plans).
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("plan")
        .eq("id", userId)
        .single()

      const planName = (profile?.plan as string | undefined)?.toLowerCase() || "free"
      const { data: planRow } = await supabase
        .from("plans")
        .select("*")
        .eq("name", planName)
        .eq("is_active", true)
        .single()

      plan = planRow ?? null
    }

    if (!plan) {
      // No plan resolvable — definitely not allowed
      return { allowed: false, limit: 0, current: 0 }
    }

    let limit = getPlanLimit(plan, resourceType)

    // 7-day trial: free plan users get Pro-level assistant access for first 7 days
    if (resourceType === "ai_assistant" && plan.name === "free" && limit < 200) {
      try {
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("created_at")
          .eq("id", userId)
          .single()

        if (profile?.created_at) {
          const daysSinceCreation = (Date.now() - new Date(profile.created_at).getTime()) / (1000 * 60 * 60 * 24)
          if (daysSinceCreation <= 7) {
            limit = 200 // Grant Pro-level access during trial
          }
        }
      } catch {
        // Fail open — don't block trial check
      }
    }

    if (limit === -1) {
      // Unlimited
      return { allowed: true, limit: -1, current: 0 }
    }

    // Get current usage
    const currentDate = new Date()
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth() + 1

    const { data: usage } = await supabase
      .from("monthly_usage")
      .select("*")
      .eq("user_id", userId)
      .eq("year", year)
      .eq("month", month)
      .single()

    const current = getCurrentUsage(usage, resourceType)
    const allowed = current < limit

    return { allowed, limit, current }
  } catch (error) {
    logger.error("Usage limit check error:", error)
    // Fail open - don't block users if usage check fails
    return { allowed: true, limit: 999999, current: 0 }
  }
}

function getUsageField(resourceType: string): string | null {
  const fieldMap: Record<string, string> = {
    workflow: "workflow_count",
    execution: "execution_count",
    integration: "integration_count",
    storage: "storage_used_mb",
    team_member: "team_member_count",
    ai_assistant: "ai_assistant_calls",
    ai_compose: "ai_compose_uses",
    ai_agent: "ai_agent_executions",
  }
  return fieldMap[resourceType] || null
}

function getPlanLimit(plan: any, resourceType: string): number {
  const limitMap: Record<string, string> = {
    workflow: "max_workflows",
    execution: "max_executions_per_month",
    integration: "max_integrations",
    storage: "max_storage_mb",
    team_member: "max_team_members",
    ai_assistant: "max_ai_assistant_calls",
    ai_compose: "max_ai_compose_uses",
    ai_agent: "max_ai_agent_executions",
  }
  const field = limitMap[resourceType]
  return field ? plan[field] : 0
}

function getCurrentUsage(usage: any, resourceType: string): number {
  if (!usage) return 0

  const usageMap: Record<string, string> = {
    workflow: "workflow_count",
    execution: "execution_count",
    integration: "integration_count",
    storage: "storage_used_mb",
    team_member: "team_member_count",
    ai_assistant: "ai_assistant_calls",
    ai_compose: "ai_compose_uses",
    ai_agent: "ai_agent_executions",
  }
  const field = usageMap[resourceType]
  return field ? usage[field] || 0 : 0
}
