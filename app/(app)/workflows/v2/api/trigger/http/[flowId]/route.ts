import { NextResponse } from "next/server"

import { executeRun } from "@/src/lib/workflows/builder/runner/execute"
import { FlowSchema } from "@/src/lib/workflows/builder/schema"
import {
  ensureNodeRegistry,
  getServiceClient,
  getFlowRepository,
  uuid,
  createRunStore,
} from "@/src/lib/workflows/builder/api/helpers"

export async function POST(request: Request, context: { params: Promise<{ flowId: string }> }) {
  const { flowId } = await context.params

  const payload = await request.json().catch(() => null)
  if (payload === null) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const serviceClient = await getServiceClient()
  const repository = await getFlowRepository(serviceClient)

  const revision = await repository.loadRevision({ flowId })
  if (!revision) {
    return NextResponse.json({ ok: false, error: "Flow not found" }, { status: 404 })
  }

  ensureNodeRegistry()

  const runId = uuid()
  const store = createRunStore(serviceClient)

  await executeRun({
    flow: FlowSchema.parse(revision.graph),
    revisionId: revision.id,
    runId,
    inputs: { payload },
    globals: revision.graph.globals ?? {},
    store,
  })

  return NextResponse.json({ ok: true, runId })
}
