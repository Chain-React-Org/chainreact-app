import { resolveValue as canonicalResolveValue } from '@/lib/workflows/actions/core/resolveValue'

/**
 * @deprecated Use `@/lib/workflows/actions/core/resolveValue` directly.
 *
 * This file is a compatibility wrapper kept so legacy callers keep compiling.
 * Body delegates to the canonical resolver in
 * `lib/workflows/actions/core/resolveValue.ts`. The legacy `dataFlowManager`
 * third argument is honored by passing it through the input dict — the
 * canonical resolver looks for `input.dataFlowManager.resolveVariable` and
 * delegates to it for node-output references.
 *
 * Removal is queued for a follow-up cleanup PR after the 15 callers migrate.
 * See: `learning/docs/resolver-consolidation-design.md`.
 */
export function resolveValue<T>(
  template: T,
  context: Record<string, any>,
  dataFlowManager?: any
): T {
  const input = dataFlowManager
    ? { ...context, dataFlowManager }
    : context
  return canonicalResolveValue(template, input) as T
}
