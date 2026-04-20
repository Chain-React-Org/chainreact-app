import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logger } from "@/lib/utils/logger"

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: NextRequest) {
  try {
    // Auth check
    const authHeader = request.headers.get("authorization")
    const token = authHeader?.replace("Bearer ", "")

    const supabase = getSupabaseAdmin()
    const { data: { user }, error: authError } = await supabase.auth.getUser(token || "")

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Check for 7-day trial status
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("created_at")
      .eq("id", user.id)
      .single()

    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("plans(name)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .single()

    const planName = (subscription?.plans as any)?.name || "free"
    const daysSinceCreation = profile?.created_at
      ? (Date.now() - new Date(profile.created_at).getTime()) / (1000 * 60 * 60 * 24)
      : 999

    const isOnTrial = planName === "free" && daysSinceCreation <= 7
    const trialDaysLeft = isOnTrial ? Math.max(0, Math.ceil(7 - daysSinceCreation)) : 0

    // Fetch data in parallel
    const [integrationsResult, workflowsResult, executionsResult] = await Promise.all([
      // Integration health
      supabase
        .from("integrations")
        .select("id, provider, status, health_check_status, expires_at")
        .eq("user_id", user.id),

      // Active workflows count
      supabase
        .from("workflows")
        .select("id, is_active")
        .eq("user_id", user.id),

      // Recent executions (last 24h)
      supabase
        .from("workflow_execution_sessions")
        .select("id, status, created_at")
        .eq("user_id", user.id)
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(50)
    ])

    const integrations = integrationsResult.data || []
    const workflows = workflowsResult.data || []
    const executions = executionsResult.data || []

    // Build insights
    const insights: Array<{ type: string; icon: string; text: string; priority: "info" | "warning" | "success" }> = []

    // Integration health
    const connected = integrations.filter(i => i.status === "connected")
    const expiring = integrations.filter(i => {
      if (!i.expires_at) return false
      const expiresIn = new Date(i.expires_at).getTime() - Date.now()
      return expiresIn > 0 && expiresIn < 3 * 24 * 60 * 60 * 1000 // Within 3 days
    })
    const unhealthy = integrations.filter(i =>
      i.health_check_status === "action_required" || i.health_check_status === "warning" ||
      i.status === "expired" || i.status === "needs_reauthorization"
    )

    if (unhealthy.length > 0) {
      const names = unhealthy.map(i => i.provider).join(", ")
      insights.push({
        type: "integration_health",
        icon: "alert",
        text: `${unhealthy.length} integration${unhealthy.length > 1 ? "s" : ""} need attention: ${names}`,
        priority: "warning"
      })
    } else if (expiring.length > 0) {
      const names = expiring.map(i => i.provider).join(", ")
      insights.push({
        type: "integration_expiring",
        icon: "clock",
        text: `${names} token${expiring.length > 1 ? "s" : ""} expiring soon — reconnect to avoid disruption`,
        priority: "warning"
      })
    } else if (connected.length > 0) {
      insights.push({
        type: "integration_healthy",
        icon: "check",
        text: `All ${connected.length} integration${connected.length > 1 ? "s" : ""} healthy`,
        priority: "success"
      })
    }

    // Workflow activity
    const activeWorkflows = workflows.filter(w => w.is_active)
    const failedExecutions = executions.filter(e => e.status === "failed")
    const totalExecutions = executions.length

    if (totalExecutions > 0) {
      if (failedExecutions.length > 0) {
        insights.push({
          type: "workflow_failures",
          icon: "alert",
          text: `${failedExecutions.length} of ${totalExecutions} workflow run${totalExecutions > 1 ? "s" : ""} failed in the last 24h`,
          priority: "warning"
        })
      } else {
        insights.push({
          type: "workflow_activity",
          icon: "zap",
          text: `${totalExecutions} successful workflow run${totalExecutions > 1 ? "s" : ""} in the last 24h`,
          priority: "success"
        })
      }
    } else if (activeWorkflows.length > 0) {
      insights.push({
        type: "workflow_idle",
        icon: "info",
        text: `${activeWorkflows.length} active workflow${activeWorkflows.length > 1 ? "s" : ""}, no runs in the last 24h`,
        priority: "info"
      })
    }

    // Trial status insight
    if (isOnTrial) {
      insights.unshift({
        type: "trial_active",
        icon: "zap",
        text: `You have ${trialDaysLeft} day${trialDaysLeft !== 1 ? "s" : ""} left on your free Pro trial — document Q&A, web search, and more included`,
        priority: "info"
      })
    }

    return NextResponse.json({
      insights,
      trial: isOnTrial ? { active: true, daysLeft: trialDaysLeft } : undefined,
      summary: {
        connectedIntegrations: connected.length,
        activeWorkflows: activeWorkflows.length,
        recentExecutions: totalExecutions,
        failedExecutions: failedExecutions.length
      }
    })
  } catch (error: any) {
    logger.error("Insights API error:", error)
    return NextResponse.json({ insights: [], summary: {} })
  }
}
