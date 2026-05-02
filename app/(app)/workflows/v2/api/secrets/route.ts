import { NextResponse } from "next/server"
import { z } from "zod"

import { createSecret, listSecrets } from "@/src/lib/workflows/builder/secrets"
import { getRouteClient } from "@/src/lib/workflows/builder/api/helpers"
import { ensureWorkspaceRole } from "@/src/lib/workflows/builder/workspace"

const CreateSecretSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  workspaceId: z.string().uuid().optional(),
})

export async function GET(request: Request) {
  const supabase = await getRouteClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const workspaceId = searchParams.get("workspaceId") ?? undefined

  if (workspaceId) {
    try {
      await ensureWorkspaceRole(supabase, workspaceId, user.id, "viewer")
    } catch (error: any) {
      const status = error?.status === 403 ? 403 : 500
      const message = status === 403 ? "Forbidden" : error?.message ?? "Unable to list secrets"
      return NextResponse.json({ ok: false, error: message }, { status })
    }
  }

  const secrets = await listSecrets(workspaceId, supabase)
  return NextResponse.json({ ok: true, secrets })
}

export async function POST(request: Request) {
  const supabase = await getRouteClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = CreateSecretSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.format() }, { status: 400 })
  }

  const workspaceId = parsed.data.workspaceId

  if (workspaceId) {
    try {
      await ensureWorkspaceRole(supabase, workspaceId, user.id, "editor")
    } catch (error: any) {
      const status = error?.status === 403 ? 403 : 500
      const message = status === 403 ? "Forbidden" : error?.message ?? "Unable to save secret"
      return NextResponse.json({ ok: false, error: message }, { status })
    }
  }

  const secret = await createSecret({
    name: parsed.data.name,
    value: parsed.data.value,
    workspaceId,
    createdBy: user.id,
    client: supabase,
  })
  return NextResponse.json({ ok: true, secret })
}
