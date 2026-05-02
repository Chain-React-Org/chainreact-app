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
| Status | DONE — 2026-05-02 |
| File | [`lib/workflows/actions/aiAgentAction.ts`](../../lib/workflows/actions/aiAgentAction.ts) (`generateWithAI` call site, formerly L1112-1114) |
| What | `model = 'gpt-4o-mini'`, `temperature = 0.7`, `maxTokens = 1500` hardcoded at handler call site. Plus inline `getOpenAIClient` / `getAnthropicClient` helpers duplicating the shared `lib/ai/{openai,anthropic}-client.ts` infrastructure. |
| Resolution | (1) `model` fallback now routes through `AI_MODELS.fast` from `@/lib/ai/models`. (2) `temperature` / `maxTokens` fall back to named constants `AI_AGENT_DEFAULT_TEMPERATURE` (0.7) and `AI_AGENT_DEFAULT_MAX_TOKENS` (1500) defined at the top of the handler — same values declared at the schema level in `aiAgentNode.ts`. The named constants make the engine-side fallback discoverable and prevent drift from the schema defaults. (3) Inline client helpers removed; handler now imports `getOpenAIClient` / `getOpenAIClientWithKey` and `getAnthropicClient` / `getAnthropicClientWithKey` from the shared modules. New `getAnthropicClientWithKey` added to `lib/ai/anthropic-client.ts` mirroring the OpenAI parallel. |
| Regression test | [`__tests__/workflows/a3-ai-defaults-no-hardcoded-models.test.ts`](../../__tests__/workflows/a3-ai-defaults-no-hardcoded-models.test.ts) reads the handler source and pins (a) the `config.model \|\| ...` line uses `AI_MODELS.*`, (b) temperature / maxTokens fallbacks use the named constants, (c) no `new OpenAI()` / `new Anthropic()` outside comment lines, (d) shared-client imports are present. 5 tests, all passing. |
| Out of scope (kept as literals intentionally) | `calculateCost`'s `costPer1kTokens` price book — uses literal model identifiers as KEYS for a per-token rate lookup. Includes `gpt-4-turbo`, `gpt-3.5-turbo`, `claude-3-{opus,sonnet,haiku}` which are not in `AI_MODELS` (back-compat for older workflow rows). The schema's `options` array in `aiAgentNode.ts` also uses literals — those are user-facing dropdown values, not runtime selection. |
| Tracking | Routine `trig_01WLq9mqbEmgmUUpfKrwCoh9` can be deactivated; documented in [`learning/docs/handler-defaults-audit.md`](handler-defaults-audit.md) §"ai" |

### A4. Handler defaults audit decisions

| Field | Value |
|---|---|
| Status | OPEN — input to PR-G |
| Files | Various — see [`learning/docs/handler-defaults-audit.md`](handler-defaults-audit.md) |
| What | 38 handler defaults marked `Require` (must be removed; field becomes required). 21 marked `Change` (e.g., timezone resolution, AI prompt removal, end-time-as-start+1h). |
| Why deferred | Audit captured decisions; PR-G applies them after the contract refactors (C1–C5/D/E/F) land. |
| Pre-launch action | Ship PR-G to apply all `Require` and `Change` decisions before launch. |

### A6. Q8c per-handler cost-check — RESOLVED (option (a) locked, no per-handler shim)

| Field | Value |
|---|---|
| Status | CLOSED — option (a) chosen: workflow-level deduction is the sole billing safeguard. |
| Decision | Task-budget enforcement is an execution-layer responsibility. `deductTasksAtomic` (in [`lib/workflows/taskDeduction.ts`](../../lib/workflows/taskDeduction.ts)) runs before any handler fires; both production execute routes invoke it and fail closed on `insufficient_balance` / `subscription_inactive` / `billing_unavailable`. Per-handler budget checks risk duplicating billing logic and creating inconsistent behavior. |
| Contract test | [`__tests__/workflows/billing-gate.test.ts`](../../__tests__/workflows/billing-gate.test.ts) pins the upstream-only contract: documented resultType shapes, fail-closed on RPC error, structural assertion that both execute routes call the gate before invoking the workflow execution service. If a future refactor reorders or removes the gate, this test fires. |
| Reopen condition | Only if a real bypass path is discovered (a handler reachable without `deductTasksAtomic`). Fix the route, not the handler. |
| Tracking | [`learning/docs/handler-contracts.md`](handler-contracts.md) Q8c |

---

### A5. Auxiliary provider calls not covered by `refreshAndRetry`

| Field | Value |
|---|---|
| Status | DONE — 2026-05-02 |
| Files | Sheets, Notion, Drive, Outlook, Gmail, Airtable handlers (see below) |
| What | PR-C3b wrapped each handler's **principal** outbound write call in `refreshAndRetry` (Q3). This entry tracked the **auxiliary** calls — secondary reads / permission / revision / sentitems lookups — so a 401 anywhere in a handler produces the standardized auth-failure shape. |
| Resolution | All sub-items below migrated. Auxiliary calls now route through `refreshAndRetry({ provider, userId, accessToken, call: ... })`. Non-401 errors in best-effort aux calls are still logged-and-swallowed; 401s now drive a refresh+retry attempt and emit the appropriate health signal on permanent failure. |
| Sub-items resolution | (a) **Sheets** — DONE (createRow.ts header GET, metadata GET, batchUpdate POSTs for prepend/specific_row). (b) **Notion** — DONE (`notionApiRequest` helper extended with optional `userId`; ~38 call sites in handlers.ts updated to pass `context.userId`; helper internally wraps the underlying `fetch` in `refreshAndRetry` when `userId` is provided). (c) **Drive** — DONE (uploadFile.ts: revisions.list/update + per-share permissions.create; shareFile.ts: about.get + permissions.create + files.get; createFolder.ts: about.get + permissions.create). (d) **Outlook** — DONE (sendEmail.ts post-send sentitems GET). (e) **Gmail** — DONE (sendEmail.ts post-send labels.modify). (f) **Airtable** — DONE (createRecord.ts × 3 schema GETs + `getAirtableTableFieldNames` and `resolveTableId` helpers extended with `userId`; updateRecord.ts schema GET; duplicateRecord.ts schema GET; getBaseSchema.ts; getTableSchema.ts). |
| §A5 follow-up Q3 principal-call gaps | DONE — 2026-05-02 (Tier 3 sweep). Resolved: (1) Drive `createFolder.ts` `drive.files.create` wrapped. (2) Gmail `applyLabels.ts` — labels.list / labels.create / messages.list / threads.get / messages.modify all wrapped. (3) Gmail `fetchMessage.ts` — messages.list / messages.get / messages.modify (markAsRead) wrapped. (4) Notion `manageDatabase.ts` — all 5 raw `fetch` calls wrapped (create database POST, delete row PATCH, add row POST, update row PATCH, update database PATCH). (5) Notion `manageUsers.ts` — all 3 raw `fetch` calls wrapped (users list, user get, search activity). (6) Notion `getPageDetails.ts` — all 4 raw `fetch` calls wrapped (pages GET, blocks GET, search POST, comments GET). (7) `notionMakeApiCall` — generic principal `fetch` wrapped. (8) Drive `googleDocs.ts` — principal calls wrapped per handler: `createGoogleDocument` (drive.files.create + docs.documents.create), `updateGoogleDocument` (docs.documents.batchUpdate), `shareGoogleDocument` (per-share drive.permissions.create with ownership-transfer branch), `exportGoogleDocument` (drive.files.export), `getGoogleDocument` (docs.documents.get). (9) Dead code `lib/workflows/actions/notion/getPages.ts` deleted (zero importers verified). |
| Out-of-scope follow-ups (still open) | `googleDocs.ts` auxiliary calls (post-create batchUpdate, file moves, additional public-permission writes inside the create/share branches, post-export drive.files.create destination upload). Same §A5 pattern would apply; tracked as a future incremental sweep when the file is touched again. |
| Tests | §A5 cases added to outlook-send-email.test.ts (sentitems aux GET 401 → refresh+retry) and sheets-create-row.test.ts (header GET 401 → refresh+retry, header GET permanent 401 → auth failure). The Tier 3 follow-up wave was verified by the existing handler test suites which exercise the wrapped paths via the actionTestHarness. 1785 / 1785 tests pass across 97 suites. |
| Tracking | [`learning/docs/handler-contracts.md`](handler-contracts.md) Q3 |

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

| Status | File:Line | What | Resolution |
|---|---|---|---|
| DONE — 2026-05-02 | `lib/workflows/taskDeduction.ts:327` | `deductExecutionTasks` — `@deprecated` wrapper that delegated to `deductTasksAtomic`. | Deleted. Zero callers verified via grep at deletion time. |
| DONE — 2026-05-02 | `lib/workflows/taskDeduction.ts:345` | `checkTaskBalance` — `@deprecated` non-atomic balance read. | Deleted. Only caller was the `'execution'` branch in `usageTracking.ts:checkUsageLimit`, which itself had zero callers (no `checkUsageLimit('execution', ...)` exists in the codebase). Branch removed. |
| KEEP — JUSTIFIED — 2026-05-02 | `lib/workflows/ai-agent/aiWorkflowCostTracking.ts:checkAIWorkflowTaskBalance` | Misleadingly tagged `@deprecated`. Actively used by `/edits` route (workflows/v2/api/flows/[flowId]/edits/route.ts:206) for early 402 short-circuit before incurring LLM cost. | The atomic RPC deducts; this function reads. Two distinct responsibilities. The `@deprecated` notice was wrong — it's been replaced with a JSDoc that explains the read-vs-deduct split and the deduct-then-fail-is-too-late rationale. |

**Verification:** 1785 / 1785 tests pass across 97 suites after the deletions. Billing-gate test suite (`__tests__/workflows/billing-gate.test.ts`) continues to pin the upstream-only contract per A6.

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
