/**
 * Idempotency key construction for within-session side-effect dedup
 * (PR-C4, Q4).
 *
 * The handler-execution metadata threaded through the engine into each
 * action handler is the source of truth — `executionSessionId`,
 * `nodeId`, and `actionType` together identify a single side effect
 * within a single execution session.
 *
 * `buildIdempotencyKey(meta)` returns:
 *   - a populated `SideEffectKey` when all three pieces are present,
 *   - `null` when any piece is missing (test-only paths or non-engine
 *     callers — handlers MUST treat this as a no-op idempotency case
 *     and skip the replay/record dance entirely).
 *
 * Stripe's `Idempotency-Key` header uses the same key, formatted as
 * `${executionSessionId}:${nodeId}:${actionType}` — see
 * `formatProviderIdempotencyKey`.
 *
 * Contract: see `learning/docs/handler-contracts.md` Q4 and
 * `learning/docs/session-side-effects-design.md` §3.
 */

/**
 * Engine-thread metadata passed alongside `(config, userId, input)` to
 * every action handler. All fields optional — handlers run normally
 * when meta is absent (test-only paths) but skip the idempotency
 * checks.
 */
export interface HandlerExecutionMeta {
  executionSessionId?: string
  nodeId?: string
  actionType?: string
  provider?: string
  testMode?: boolean
}

export interface SideEffectKey {
  executionSessionId: string
  nodeId: string
  actionType: string
}

/**
 * Build a `SideEffectKey` from handler execution metadata. Returns
 * `null` when the metadata can't identify a unique side effect (any
 * of executionSessionId / nodeId / actionType missing or empty).
 *
 * Handlers branch on the null return:
 *   const key = buildIdempotencyKey(meta)
 *   if (!key) {
 *     // No idempotency — fire normally.
 *   } else {
 *     // checkReplay → fire/cached/mismatch → recordFired
 *   }
 */
export function buildIdempotencyKey(
  meta: HandlerExecutionMeta | undefined,
): SideEffectKey | null {
  if (!meta) return null
  const { executionSessionId, nodeId, actionType } = meta
  if (!executionSessionId || !nodeId || !actionType) return null
  return { executionSessionId, nodeId, actionType }
}

/**
 * Render a `SideEffectKey` as the colon-joined string used for
 * provider-side idempotency headers (Stripe `Idempotency-Key`,
 * etc.).
 */
export function formatProviderIdempotencyKey(key: SideEffectKey): string {
  return `${key.executionSessionId}:${key.nodeId}:${key.actionType}`
}
