# Pre-Launch Cleanup Tracker

**Purpose:** ChainReact has not launched. Every "legacy", "deprecated", "backwards-compat", or "kept for older callers" entry currently in the codebase is by definition unjustified — there are no external users to be backwards-compatible with. This doc enumerates every such item so they can be cut before launch instead of becoming permanent technical debt.

**How to use:**
- Each row has a status: `OPEN`, `IN PROGRESS`, `DONE`, or `KEEP — JUSTIFIED`
- `KEEP — JUSTIFIED` requires a recorded reason (e.g., load-bearing for a real internal pre-launch dependency that's still in flight)
- "Pre-launch removal" is the default expected action; items that should survive launch must be explicitly justified
- This is a living doc — append new items as they're created, mark items done as they're removed

**Discovery method:** grep for `@deprecated`, `legacy`, `backwards.compat`, `backward.compat`, `TODO.*remove` across `*.ts`. Re-run periodically to catch items added since the last sweep.

---

## A. Items created during the contract refactor (Phase 2)

### A1. Resolver consolidation — legacy wrapper

| Field | Value |
|---|---|
| Status | OPEN |
| File | [`lib/integrations/resolveValue.ts`](../../lib/integrations/resolveValue.ts) |
| What | `@deprecated` thin wrapper that delegates to `lib/workflows/actions/core/resolveValue.ts`. Created in PR-C1a. |
| Why deferred | 15 callers still import from this path. Wrapping kept them compiling without forcing a migration in the same PR. |
| Pre-launch action | Migrate the 15 callers to import directly from `@/lib/workflows/actions/core/resolveValue`, then delete `lib/integrations/resolveValue.ts`. Lands after PR-C1b. |
| Tracking | [`learning/docs/resolver-consolidation-design.md`](resolver-consolidation-design.md) §7 |

### A2. Resolver consolidation — `parseVariableReference` fallback in DataFlowManager

| Field | Value |
|---|---|
| Status | OPEN |
| File | [`lib/workflows/dataFlowContext.ts`](../../lib/workflows/dataFlowContext.ts) (post-process block in `resolveVariable`) |
| What | The `normalizeVariableReference` / `parseVariableReference` post-process block kept as a "safety net" if canonical doesn't recognize a node ref. |
| Why deferred | Conservative fallback during PR-C1a so we couldn't accidentally regress a node-reference edge case. Parity tests pass without it. |
| Pre-launch action | Once parity tests have proven it's redundant against real workflow runs, delete the post-process block. |

### A3. AI hardcoded defaults

| Field | Value |
|---|---|
| Status | IN PROGRESS — scheduled tracking issue fires 2026-05-01 09:00 America/Chicago |
| File | [`lib/workflows/actions/aiAgentAction.ts:1112-1114`](../../lib/workflows/actions/aiAgentAction.ts#L1112) |
| What | `model = 'gpt-4o-mini'`, `temperature = 0.7`, `maxTokens = 1500` hardcoded at handler call site. |
| Why | Violates CLAUDE.md "never hardcode model strings — use `AI_MODELS`." |
| Pre-launch action | Route `model` through `AI_MODELS` from `lib/ai/models.ts`. Decide whether `temperature` / `maxTokens` belong in centralized AI defaults, schema defaults, or required workflow config. Add regression test preventing future hardcoded model literals. |
| Tracking | Routine `trig_01WLq9mqbEmgmUUpfKrwCoh9`; documented in [`learning/docs/handler-defaults-audit.md`](handler-defaults-audit.md) §"ai" |

### A4. Handler defaults audit decisions

| Field | Value |
|---|---|
| Status | OPEN — input to PR-G |
| Files | Various — see [`learning/docs/handler-defaults-audit.md`](handler-defaults-audit.md) |
| What | 38 handler defaults marked `Require` (must be removed; field becomes required). 21 marked `Change` (e.g., timezone resolution, AI prompt removal, end-time-as-start+1h). |
| Why deferred | Audit captured decisions; PR-G applies them after the contract refactors (C1–C5/D/E/F) land. |
| Pre-launch action | Ship PR-G to apply all `Require` and `Change` decisions before launch. |

---

## B. Trigger lifecycle migration — old per-provider webhook setup

A `TriggerLifecycleManager` + per-provider `*TriggerLifecycle` pattern superseded direct webhook-setup files. The old files are still present and `@deprecated`.

| Status | File:Line | What |
|---|---|---|
| OPEN | [`lib/integrations/airtable/webhooks.ts:42`](../../lib/integrations/airtable/webhooks.ts#L42) | `@deprecated Use AirtableTriggerLifecycle instead` |
| OPEN | [`lib/integrations/airtable/webhooks.ts:74`](../../lib/integrations/airtable/webhooks.ts#L74) | same |
| OPEN | [`lib/integrations/airtable/webhooks.ts:546`](../../lib/integrations/airtable/webhooks.ts#L546) | same |
| OPEN | [`lib/integrations/airtable/webhooks.ts:646`](../../lib/integrations/airtable/webhooks.ts#L646) | same |
| OPEN | [`lib/integrations/airtable/webhooks.ts:702`](../../lib/integrations/airtable/webhooks.ts#L702) | same |
| OPEN | [`lib/webhooks/google-drive-watch-setup.ts:57`](../../lib/webhooks/google-drive-watch-setup.ts#L57) | `@deprecated Use GoogleApisTriggerLifecycle instead` |
| OPEN | [`lib/webhooks/google-drive-watch-setup.ts:196`](../../lib/webhooks/google-drive-watch-setup.ts#L196) | same |
| OPEN | [`lib/webhooks/google-calendar-watch-setup.ts:69`](../../lib/webhooks/google-calendar-watch-setup.ts#L69) | same |
| OPEN | [`lib/webhooks/google-calendar-watch-setup.ts:224`](../../lib/webhooks/google-calendar-watch-setup.ts#L224) | same |
| OPEN | [`lib/webhooks/gmail-watch-setup.ts:49`](../../lib/webhooks/gmail-watch-setup.ts#L49) | same |
| OPEN | [`lib/triggers/providers/NotionTriggerLifecycle.ts:298`](../../lib/triggers/providers/NotionTriggerLifecycle.ts#L298) | `@deprecated Use getNotionEventTypes for actual API calls` |
| OPEN | [`lib/microsoft-graph/subscriptionManager.ts:523`](../../lib/microsoft-graph/subscriptionManager.ts#L523) | `// DEPRECATED: Subscription saving is now handled by TriggerLifecycleManager` |

**Pre-launch action:** verify each file's exports have zero remaining callers (grep for the symbol name). Delete the deprecated functions or the whole file as appropriate. The active path is the `TriggerLifecycleManager` + per-provider lifecycle classes per CLAUDE.md Section 4 "Trigger Lifecycle Pattern."

---

## C. Task deduction — non-atomic legacy paths (BILLING-ADJACENT)

Higher-priority because billing correctness depends on the atomic path being the only one used.

| Status | File:Line | What |
|---|---|---|
| OPEN | [`lib/workflows/taskDeduction.ts:323`](../../lib/workflows/taskDeduction.ts#L323) | `@deprecated Use deductTasksAtomic() instead. This function uses a non-atomic` (full reason in source) |
| OPEN | [`lib/workflows/taskDeduction.ts:341`](../../lib/workflows/taskDeduction.ts#L341) | `@deprecated Use deductTasksAtomic() instead. The atomic RPC handles both` |
| OPEN | [`lib/workflows/ai-agent/aiWorkflowCostTracking.ts:73`](../../lib/workflows/ai-agent/aiWorkflowCostTracking.ts#L73) | `@deprecated Use the atomic deductAIWorkflowTasks() instead.` |

**Pre-launch action:** confirm zero callers of the deprecated functions, then delete. Any remaining caller is a billing-correctness bug — non-atomic deduction can double-charge or under-charge under concurrent execution.

---

## D. Notification service — superseded by `healthTransitionEngine`

| Status | File:Line | What |
|---|---|---|
| OPEN | [`lib/integrations/notificationService.ts:302`](../../lib/integrations/notificationService.ts#L302) | `@deprecated Use healthTransitionEngine.computeTransitionAndNotify() instead.` |

**Pre-launch action:** per CLAUDE.md Section 4 "Proactive OAuth Token Management," the transition engine is the only system that decides whether to notify. Delete the deprecated function and confirm no callers in cron routes or callbacks.

---

## E. Other per-provider deprecations

| Status | File:Line | What | Pre-launch action |
|---|---|---|---|
| OPEN | [`lib/workflows/actions/slack.ts:111`](../../lib/workflows/actions/slack.ts#L111) | `@deprecated Use the wrapper above which calls the new implementation` | Verify the new implementation is in use everywhere; delete the deprecated wrappee |
| OPEN | [`app/api/integrations/shopify/data/utils.ts:133`](../../app/api/integrations/shopify/data/utils.ts#L133) | `@deprecated Use makeShopifyGraphQLRequest instead` | Migrate any REST callers to GraphQL; delete the deprecated function |
| OPEN | [`components/workflows/configuration/hooks/useFieldChangeHandler.ts:191`](../../components/workflows/configuration/hooks/useFieldChangeHandler.ts#L191) | `@deprecated Use handleDiscordField from useDiscordFieldHandler instead` | Migrate Discord field-change paths to the new hook; delete the deprecated handler |

---

## F. Backwards-compat exports / aliases (no real users yet)

These exist "for callers that may still reference the old name." Pre-launch, there ARE no such callers outside this repo. Each one is a migration that can be completed instead of indefinitely supported.

| Status | File:Line | What |
|---|---|---|
| OPEN | [`lib/db.ts:23`](../../lib/db.ts#L23) | `// Export db as a getter for backwards compatibility` |
| OPEN | [`lib/db/schema.ts:28`](../../lib/db/schema.ts#L28) | `// Legacy compatibility - keep existing exports that code may still reference` |
| OPEN | [`lib/db/schema.ts:55`](../../lib/db/schema.ts#L55) | `// Legacy type aliases for backwards compatibility` |
| OPEN | [`stores/analyticsStore.ts:74`](../../stores/analyticsStore.ts#L74) | `// Legacy types for backward compatibility` |
| OPEN | [`stores/analyticsStore.ts:104`](../../stores/analyticsStore.ts#L104) | `// Legacy data for backward compatibility` |
| OPEN | [`stores/analyticsStore.ts:115`](../../stores/analyticsStore.ts#L115) | `// Legacy actions` |
| OPEN | [`stores/analyticsStore.ts:163`](../../stores/analyticsStore.ts#L163) | `// Legacy state` |
| OPEN | [`stores/analyticsStore.ts:221`](../../stores/analyticsStore.ts#L221) | `// Legacy methods for backward compatibility` |
| OPEN | [`hooks/use-integrations.ts:33`](../../hooks/use-integrations.ts#L33) | `// Legacy fields (backward compatibility)` |
| OPEN | [`src/lib/workflows/compat/v2Adapter.ts:80`](../../src/lib/workflows/compat/v2Adapter.ts#L80) | `// The prefix parameter is kept for backwards compatibility but ignored` (entire `compat/` folder is suspect) |
| OPEN | [`src/lib/workflows/builder/featureFlag.ts:20`](../../src/lib/workflows/builder/featureFlag.ts#L20) | `@deprecated Flow V2 is always enabled. This function is kept for backward compatibility.` — function should be deleted; callers cleaned up |
| OPEN | [`src/lib/workflows/builder/agent/planner.ts:94`](../../src/lib/workflows/builder/agent/planner.ts#L94) | `// Legacy allow-list kept for backward compatibility with generic nodes` |
| OPEN | [`src/lib/workflows/builder/agent/planner.ts:811`](../../src/lib/workflows/builder/agent/planner.ts#L811) | `// The type parameter is kept for backwards compatibility but ignored` |
| OPEN | [`src/lib/workflows/builder/agent/planner.ts:1217`](../../src/lib/workflows/builder/agent/planner.ts#L1217) | `// Legacy node - use provided config hints` |

**Pre-launch action:** for each, identify the callers that would have to change if the legacy export is removed. Migrate them. Remove the legacy alias.

---

## G. Legacy data formats / fallback paths

These accept multiple input shapes "for backwards compatibility" with older data that may exist somewhere. Pre-launch there is no older data — pick one shape.

| Status | File:Line | What |
|---|---|---|
| OPEN | [`lib/workflows/validation/validateWorkflow.ts:44`](../../lib/workflows/validation/validateWorkflow.ts#L44) | `// Legacy format: type string contains _trigger_` |
| OPEN | [`lib/services/nodeExecutionService.ts:121`](../../lib/services/nodeExecutionService.ts#L121) | `// Fallback to legacy test mode behavior for backwards compatibility` |
| OPEN | [`lib/services/integrations/gmailIntegrationService.ts:67`](../../lib/services/integrations/gmailIntegrationService.ts#L67) | `// Legacy support` |
| OPEN | [`app/api/integrations/fetch-user-data/route.ts:1292`](../../app/api/integrations/fetch-user-data/route.ts#L1292) | `// Legacy data fetchers - should be empty as all requests are routed to dedicated APIs` (the comment itself says this should be empty — confirm and delete) |
| OPEN | [`lib/workflows/fields/visibility.ts:218`](../../lib/workflows/fields/visibility.ts#L218) | `// Legacy patterns (will be removed in future)` — promised removal; do it now |
| OPEN | [`lib/workflows/aiFieldGeneration.ts:377`](../../lib/workflows/aiFieldGeneration.ts#L377) | `// Fallback to hardcoded templates for backwards compatibility` |
| OPEN | [`components/workflows/configuration/config/fieldMappings.ts:720`](../../components/workflows/configuration/config/fieldMappings.ts#L720) | `// Legacy mappings (may be deprecated)` — confirm "may be" and resolve |
| OPEN | [`components/workflows/configuration/config/fieldMappings.ts:1454`](../../components/workflows/configuration/config/fieldMappings.ts#L1454) | `// Simple create page action (for backwards compatibility with templates)` |
| OPEN | [`components/workflows/configuration/config/fieldMappings.ts:1474`](../../components/workflows/configuration/config/fieldMappings.ts#L1474) | `// Deprecated - replaced by notion_action_manage_database` |
| OPEN | [`app/api/integrations/shopify/data/utils.ts:38`](../../app/api/integrations/shopify/data/utils.ts#L38) | `// Legacy: Try single shop field` |
| OPEN | [`app/api/integrations/shopify/data/utils.ts:43`](../../app/api/integrations/shopify/data/utils.ts#L43) | `// Legacy: Try top-level shop_domain` |
| OPEN | [`app/api/integrations/shopify/data/types.ts:21`](../../app/api/integrations/shopify/data/types.ts#L21) | `shop?: string // Legacy: single shop domain (for backwards compatibility)` |
| OPEN | [`app/api/integrations/route.ts:216`](../../app/api/integrations/route.ts#L216) | `// Prefer top-level fields, fallback to metadata for backwards compatibility` |

**Pre-launch action:** for each, identify whether any actual data in the dev/staging databases is in the legacy shape. If not (the common case pre-launch), delete the legacy branch and pin tests to the canonical shape only. If yes, write a one-shot migration to normalize the data, then delete.

---

## H. Real TODOs

| Status | File:Line | What |
|---|---|---|
| OPEN | [`app/api/integrations/facebook/data-deletion.ts:34`](../../app/api/integrations/facebook/data-deletion.ts#L34) | `// TODO: Delete all Facebook-related data for the authenticated user` — Facebook compliance requirement, must be implemented before any Facebook integration goes live |

---

## I. Cleanup of this doc itself

This doc enumerates items as of the date of last grep sweep. Re-run the discovery before each major release candidate:

```bash
# All @deprecated markers
grep -rn "@deprecated" --include="*.ts" .

# Common legacy/backward-compat comment patterns
grep -rinE "//.*\b(LEGACY|legacy|deprecated|backward.?compat|backwards.?compat)" --include="*.ts" .

# TODO removal markers
grep -rinE "TODO:?\s*(remove|delete|cleanup|deprecate)" --include="*.ts" .
```

Append any new hits to the appropriate section above. Mark items DONE as their PRs land.

---

## J. Definition of "ready to launch"

Every row in §A–§G is either DONE or KEEP — JUSTIFIED. No row is OPEN. §H's TODO is closed. The grep commands in §I return only items already in this doc.

If a "legacy" item is genuinely worth keeping (e.g., a database schema alias that supports a real internal team's external integration), the row's status changes to KEEP — JUSTIFIED with a one-line reason on the same row. Items without a recorded reason default to OPEN and block launch.

---

## References

- [`CLAUDE.md`](../../CLAUDE.md) — particularly Section 3 "Critical Execution Rules" ("Remove Means DELETE") and Section 4 "Architecture & Patterns" (Single Source of Truth)
- [`learning/docs/handler-defaults-audit.md`](handler-defaults-audit.md) — A4
- [`learning/docs/handler-contracts.md`](handler-contracts.md) — Phase 2 contract source of truth
- [`learning/docs/resolver-consolidation-design.md`](resolver-consolidation-design.md) — A1, A2
