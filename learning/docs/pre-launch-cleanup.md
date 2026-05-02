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
| Status | DONE — 2026-05-02 |
| File | `lib/integrations/resolveValue.ts` (deleted) |
| What | `@deprecated` thin wrapper that delegated to `lib/workflows/actions/core/resolveValue.ts`. |
| Resolution | Discovered during the §A1 closure pass that the wrapper's only remaining production callers (after the broader audit) were 3 files: `lib/workflows/actions/hubspot.ts`, `lib/workflows/actions/hubspotDynamic.ts`, `lib/workflows/actions/slack/createChannel.ts`. The 11 other callers listed in the §A1 design lived under the **top-level orphan `/integrations/` directory** (not `/lib/integrations/`) plus its `/actions/index.ts` dispatcher and `/examples/gmail-send-email-example.ts`, which were verified to have ZERO production importers (only example-file consumption + one type-only import in `aiDataProcessing.ts`). Migrated the 3 production callers to import directly from `./core/resolveValue` and DELETED the entire orphan stack: top-level `/integrations/` (7 provider directories), `/actions/`, `/examples/`, `lib/integrations/resolveValue.ts`, and `__tests__/workflows/resolver-parity.test.ts` (its purpose was comparing the wrapper to the canonical — moot once the wrapper is gone). The only redirect needed was `aiDataProcessing.ts` for the `ActionResult` type, now imported from `lib/workflows/actions/core/executeWait.ts`. |
| Verification | 96 suites / 1723 tests pass (down from 97/1785 — the parity test contributed 62 tests across one suite; that's the only delta). |
| Tracking | [`learning/docs/resolver-consolidation-design.md`](resolver-consolidation-design.md) §7 — closure noted. |

### A2. Resolver consolidation — `parseVariableReference` fallback in DataFlowManager

| Field | Value |
|---|---|
| Status | KEEP — JUSTIFIED — 2026-05-02 |
| File | [`lib/workflows/dataFlowContext.ts`](../../lib/workflows/dataFlowContext.ts) (post-process block in `resolveVariable` at L214 and the parallel strict-path block at L458) |
| What | The `normalizeVariableReference` / `parseVariableReference` post-process block. |
| Why load-bearing | `normalizeVariableReference` (in `lib/workflows/variableReferences.ts`) rewrites two input shapes the canonical resolver doesn't natively recognize: `{{node.<id>.output.<path>}}` → `{{<id>.<path>}}` and `{{<id>.output.<path>}}` → `{{<id>.<path>}}`. The canonical sees `node.X.output.field` as a literal `node` key, finds nothing, and returns undefined. The post-process intercepts that miss, normalizes the reference, and re-resolves via `getNodeOutput`. These prefixed shapes are emitted by some planner/template paths, so the fallback is the actual handler for them. |
| Pre-launch action | Extend the canonical resolver in `lib/workflows/actions/core/resolveValue.ts` to recognize `node.<id>.output.<path>` and `<id>.output.<path>` prefixes natively (or run them through `normalizeVariableReference` upstream of canonical recognition). Once the canonical handles those shapes, both post-process blocks can be deleted. |

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
| Status | DONE — 2026-05-02 |
| Files | Various — see [`learning/docs/handler-defaults-audit.md`](handler-defaults-audit.md) |
| What | 38 handler defaults marked `Require` (must be removed; field becomes required). 21 marked `Change` (e.g., timezone resolution, AI prompt removal, end-time-as-start+1h). |
| Resolution | PR-G shipped in commit `3075fb409` — "PR-G + §A5: handler defaults migration + auxiliary 401 wrapping". 21 backfill registry entries, 12 schemas marked required, +199 tests. Q11 (no hidden high-risk defaults) and Q12 (workspace → user → UTC/en_US tz/locale resolution) contracts pinned. The audit doc remains the authoritative row-by-row record. |
| Tier-1 follow-up (user-only — not closeable by the agent) | Run `tsx scripts/migrate-handler-defaults.ts --pr=PR-G2,PR-G3,PR-G4,PR-G5` against the production DB before merging PR-G to a populated DB; plus `supabase db push` for `20260501000000_add_timezone_locale_to_workspaces_and_user_profiles.sql`. |

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

A `TriggerLifecycleManager` + per-provider `*TriggerLifecycle` pattern superseded direct webhook-setup files. Sweep performed 2026-05-02 — partial closure: 3 truly-dead exports deleted, 10 retained as KEEP — JUSTIFIED because they're load-bearing for legacy paths still wired into production cron / API routes.

### Deleted 2026-05-02 (zero callers verified)

| Symbol | File | Why safe |
|---|---|---|
| `cleanupInactiveAirtableWebhooks` | `lib/integrations/airtable/webhooks.ts` | Zero importers. Lifecycle owns inactive cleanup via `AirtableTriggerLifecycle.onDeactivate`/`onDelete`. |
| `getSupportedEventsForTrigger` | `lib/triggers/providers/NotionTriggerLifecycle.ts` | Private method with zero internal references. `getNotionEventTypes` is the authoritative version. |
| `saveSubscription` | `lib/microsoft-graph/subscriptionManager.ts` | Deprecated empty stub (logged-and-returned). Zero callers. Lifecycle owns persistence. |

### KEEP — JUSTIFIED 2026-05-02 (load-bearing for legacy paths)

| Symbol | File | Caller | Migration path required before deletion |
|---|---|---|---|
| `ensureAirtableWebhooksForUser` | `lib/integrations/airtable/webhooks.ts` | `app/api/integrations/airtable/register-webhooks/route.ts` | Delete the route OR migrate it to call `TriggerLifecycleManager.activate(workflow)`. |
| `ensureAirtableWebhookForBase` | same | `lib/webhooks/triggerWebhookManager.ts:registerAirtableWebhook` (unreachable: gated by `lifecycleManagedProviders` early-return at line 929 — but the wrapper hasn't been pruned) | Delete `registerAirtableWebhook` private method + the `case 'airtable':` in `registerWithExternalService`, then this dependency disappears. |
| `unregisterAirtableWebhook` | same | `lib/webhooks/triggerWebhookManager.ts:unregisterAirtableWebhook` (still reachable from `unregisterFromExternalService('airtable')` — legacy cleanup path, no lifecycle guard) | Add the `'airtable'` provider to a lifecycle-managed early-return in `unregisterFromExternalService`, then delete this. |
| `refreshAirtableWebhook` | same | `app/api/webhooks/refresh-airtable/route.ts` (not in `vercel.json` crons but route is publicly hit-able) | Delete the route OR redirect renewal traffic to `/api/cron/renew-webhook-subscriptions`. |
| `setupGmailWatch` / `stopGmailWatch` / `setupGoogleDriveWatch` / `stopGoogleDriveWatch` / `setupGoogleCalendarWatch` / `stopGoogleCalendarWatch` | `lib/webhooks/{gmail,google-drive,google-calendar}-watch-setup.ts` | `lib/webhooks/google-watch-renewal.ts:renewExpiringGoogleWatches` → `app/api/webhooks/google/renew/route.ts` (vercel.json: daily 7am cron) | Migrate `google-watch-renewal.ts` to query `trigger_resources` (lifecycle-managed) instead of the legacy `google_watch_subscriptions` table, and call `GoogleApisTriggerLifecycle.checkHealth()` for renewal. Then remove the daily cron entry, delete the route, delete `google-watch-renewal.ts`, delete the watch-setup files. |
| `triggerWebhookManager.ts` legacy file | `lib/webhooks/triggerWebhookManager.ts` | Listed itself as "PARTIALLY DEPRECATED — STILL ACTIVE PROVIDERS: Trello / Dropbox / GitHub / Notion / HubSpot" | Migrate the 5 still-active providers to per-provider `TriggerLifecycle` classes, remove the `lifecycleManagedProviders` early-return (no longer needed), then delete the file entirely. Will retire the airtable wrapper deletion path above as a side effect. |

### Pre-launch action

Three concrete migrations, each landed in their own PR before launch:
1. **Airtable legacy cleanup PR** — delete `app/api/integrations/airtable/register-webhooks/route.ts` + `app/api/webhooks/refresh-airtable/route.ts` after confirming no external callers (frontend + integrations + customer docs). Add Airtable to `unregisterFromExternalService` early-return. Delete the 4 KEEP entries above.
2. **Google watch renewal migration PR** — rewrite `google-watch-renewal.ts` to use `GoogleApisTriggerLifecycle.checkHealth()`, drop `google_watch_subscriptions` table query in favor of `trigger_resources`, remove daily cron, delete the 3 watch-setup files (gmail/drive/calendar). Run a one-shot data migration script if any rows exist in `google_watch_subscriptions` that aren't in `trigger_resources`.
3. **`triggerWebhookManager.ts` retirement PR** — migrate Trello / Dropbox / GitHub / Notion / HubSpot triggers to per-provider lifecycle classes, then delete the file.

Until all three PRs ship, the KEEP entries above remain — they're not dead code, they're load-bearing for production cron paths.

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

| Status | Symbol | Resolution |
|---|---|---|
| DONE — 2026-05-02 | `shouldSendNotification` in `lib/integrations/notificationService.ts` | Deleted. Zero callers verified at deletion time. Notification decisions are owned exclusively by `healthTransitionEngine.computeTransitionAndNotify` per CLAUDE.md Section 4. |

---

## E. Other per-provider deprecations

| Status | Symbol | Resolution |
|---|---|---|
| DONE — 2026-05-02 | `slackActionSendMessageLegacy` in `lib/workflows/actions/slack.ts` | Deleted (319-line legacy implementation). Zero callers; the active `slackActionSendMessage` wrapper delegates to `sendSlackMessageNew`. |
| KEEP — JUSTIFIED — 2026-05-02 | `makeShopifyRequest` (REST) in `app/api/integrations/shopify/data/utils.ts` | 8 active callers across `handlers/{collections,customers,inventory-items,locations,orders,products,variants}.ts`. REST→GraphQL migration is a separate per-handler PR (different query shapes, different response shapes); not a deletion sweep. The `@deprecated` notice stands as a TODO marker. |
| DONE — 2026-05-02 | `handleDiscordFieldChange` in `components/workflows/configuration/hooks/useFieldChangeHandler.ts` | Deleted (159-line useCallback) plus its return-object export. Zero external callers; the active path uses `handleDiscordField` from `useDiscordFieldHandler` (declared at line 153, dispatched at the previous line 946). |

---

## F. Backwards-compat exports / aliases

| Status | Symbol / Comment | Resolution |
|---|---|---|
| RECLASSIFIED — 2026-05-02 | `lib/db.ts:23` `db` proxy | Comment was misleading ("backwards compatibility"). The proxy is a legitimate **lazy-init helper** — it defers Supabase client construction until first property access so importers can write `db.from(...)` directly without manually invoking `getDb()`, while avoiding module-level env-var failures at build time. Comment rewritten to clarify this. KEEP. |
| DONE — 2026-05-02 | Entire `lib/db/schema.ts` file | Deleted. Zero importers anywhere in the codebase (verified via grep on `@/lib/db/schema` — no matches). The file was a stale set of legacy type aliases (`Account`, `OAuthAccount`, `Session`, `accounts`, `integrationTable`, etc.) that nothing imported. |
| KEEP — JUSTIFIED — 2026-05-02 | `stores/analyticsStore.ts` legacy state/methods (`metrics`, `chartData`, `executions`, `fetchMetrics`, `fetchChartData`, `fetchExecutions`, `clearAllData`) | Active callers in `components/dashboard/DashboardContent.tsx` (uses `metrics, chartData, fetchMetrics, fetchChartData`) and `stores/authStore.ts` (uses `clearAllData` for sign-out cleanup). Migration requires rewriting `DashboardContent.tsx` to use the new `dashboard` state + `fetchDashboard`. Separate UI-refactor PR. |
| KEEP — JUSTIFIED — 2026-05-02 | `hooks/use-integrations.ts:33` `email` / `account_name` legacy fields on `Integration` interface | Active consumers: `components/integrations/IntegrationHealthDashboard.tsx`, `components/new-design/AppsContent.tsx`. Migration would require renaming fields across the UI surface — non-trivial. |
| DONE — 2026-05-02 | `src/lib/workflows/compat/v2Adapter.ts:generateId` `_prefix` parameter | Removed the unused parameter (was annotated "kept for backwards compatibility but ignored"). Updated the 2 callers in `WorkflowBuilderV2.tsx` that were passing a prefix. The prefix was a remnant of the pre-UUID schema; `workflow_nodes.id` is `uuid` type and accepts only pure UUIDs. |
| DONE — 2026-05-02 | `src/lib/workflows/builder/featureFlag.ts` (entire file) + `src/lib/workflows/builder/api/guards.ts` | Both files deleted. `isFlowV2Enabled` always returned `true` ("Flow V2 is always enabled"), making `guardFlowV2Enabled` a no-op gate. Bonus finding: the 3 routes that called `guardFlowV2Enabled()` (`/api/secrets` GET+POST, `/api/trigger/http/[flowId]`) **never imported it** — the calls were broken at runtime but the bug was dormant since the gate would have returned `null` anyway. Removed the dead calls + deleted both files. |
| KEEP — JUSTIFIED — 2026-05-02 | `src/lib/workflows/builder/agent/planner.ts:ALLOWED_NODE_TYPES` legacy allow-list | Used by `validateDraft` as a fallback for legacy node types (http.trigger / http.request / ai.generate / mapper.node / logic.ifSwitch / notify.dispatch). Removing it would lose validation for those types. Migration requires moving these into the main catalog or a new "first-party" registry. |
| DONE — 2026-05-02 | `src/lib/workflows/builder/agent/planner.ts:generateNodeId` `_type` parameter | Removed the unused parameter (same pattern as `generateId` above). Updated the single caller. |
| KEEP — JUSTIFIED — 2026-05-02 | `src/lib/workflows/builder/agent/planner.ts:1217` "Legacy node - use provided config hints" branch | Active fallback for nodes that aren't in the new catalog but are in the legacy `ALLOWED_NODE_TYPES`. Falls out as part of the same migration as the `ALLOWED_NODE_TYPES` cleanup above. |

---

## G. Legacy data formats / fallback paths

These accept multiple input shapes "for backwards compatibility" with older data that may exist somewhere. Pre-launch there is no older data — pick one shape. Sweep performed 2026-05-02. Outcomes below.

### Deleted / inlined 2026-05-02 (truly-dead branches)

| File | What | Why safe |
|---|---|---|
| `lib/workflows/aiFieldGeneration.ts` (entire file) | `AIFieldGenerator` class + `AI_FIELD_TEMPLATES` registry + `supportsAIGeneration` / `getAIGenerateableFields` / `getFieldTemplate` helpers + singleton `aiFieldGenerator`. | Zero importers anywhere. Verified via grep on `aiFieldGeneration` and `aiFieldGenerator` — only matches were inside the file itself. The singleton, helpers, and template registry were never wired up. |
| `lib/services/integrations/gmailIntegrationService.ts:17` (alt case) | `case "gmail_send"` (alt type name) → `executeSendEmail`. | Zero rows / nodes use `type: 'gmail_send'`. The 5 case labels for it (`gmailIntegrationService.ts:17`, `nodeExecutionService.ts:518/542`, `executeNode.ts:42/90`) all deleted. Stale comment example references at `validateDataFlow.ts:138` and `useWorkflowBuilder.ts:1632` updated to the canonical `gmail_action_send_email`. |
| `app/api/integrations/fetch-user-data/route.ts:1228-1272 + 1286-1293` | Legacy `dataFetchers` lookup (always-empty `{}`) + `fallbackFetcher` (never called) + `DataFetcher` interface. | Every provider routes through its dedicated `/api/integrations/<provider>/data` endpoint. The legacy generic-fetcher map was always empty so the lookup always returned 400. Replaced with a direct 400 + comment explaining the history. |
| `components/workflows/configuration/config/fieldMappings.ts:720-736` (5 outlook mappings) | Mappings for `microsoft-outlook_action_create_meeting` / `_add_folder` / `_archive_email` / `_mark_as_read` / `_mark_as_unread`. | None of these node types exist in the catalog (zero `type:` matches in `lib/workflows/nodes/providers/outlook/index.ts` for any of them). Mappings were orphan. Bonus: deleted 4 matching prompt lines from `lib/ai/workflowAI.ts:219-223` that listed these as available actions (would have caused planner hallucinations). |
| `components/workflows/configuration/config/fieldMappings.ts:1456-1460` | Commented-out `notion_action_create_database` block + "Deprecated - replaced by notion_action_manage_database" comment. | Already commented out. The active mapping at `notion_action_manage_database` (line 1472) plus the **new** active `notion_action_create_database` mapping (line 1477) supersede this dead block. |
| `app/api/integrations/route.ts:216-230` | `metadata.email` / `metadata.userEmail` / `metadata.username` / `metadata.name` / `metadata.account_name` / `metadata.accountName` fallbacks for top-level fields. | No OAuth callback in `lib/integrations/provider-registry.ts` writes any of these to metadata — every callback writes the canonical fields directly to the top-level integration row columns. The `||` fallbacks were unreachable. |

### Comment-rewrites 2026-05-02 (load-bearing branches with misleading "legacy" labels)

| File | Was labeled | Reality |
|---|---|---|
| `lib/workflows/validation/validateWorkflow.ts:44` | `// Legacy format: type string contains _trigger_` | Flow shape (top-level `node.type` IS the type string) is actively used by v2/system code and tested at `__tests__/workflows/v2/system/validate-workflow.test.ts:219`. Not legacy. |
| `lib/services/nodeExecutionService.ts:121` | `// Fallback to legacy test mode behavior for backwards compatibility` | Live fallback for HITL / resume routes (`app/api/webhooks/discord/hitl`, `app/api/workflows/[id]/resume`, `app/api/workflows/events`) that pass `testMode: true` without reconstructing `testModeConfig`. Migration path: read `workflow_execution_sessions.test_mode_config` when resuming a test-mode session. |
| `lib/services/integrations/gmailIntegrationService.ts:67` | `// Legacy support` for `attachments` | Active alternate input shape, parallel to `sourceType` / `uploadedFiles` / `fileUrl` / `fileFromNode`. The handler `lib/workflows/actions/gmail/sendEmail.ts:65` resolves `config.attachments` directly. Not legacy. |
| `lib/workflows/fields/visibility.ts:218` | `// Legacy patterns (will be removed in future)` | ~130 occurrences of `conditional` / `conditionalVisibility` / `visibleWhen` / `showWhen` across 25+ schema files. Migration to the canonical `visibilityCondition` shape is tracked in `learning/docs/visibility-migration-progress.md`. Removal is gated on completing that migration, not "the future". |
| `components/workflows/configuration/config/fieldMappings.ts:1436` | `// Simple create page action (for backwards compatibility with templates)` | `notion_action_create_page` is actively used by 8+ predefined templates (`lib/templates/predefinedTemplates.ts`) and 4 AI workflow generators. Parallel to (not superseded by) `notion_action_manage_page`. Not legacy. |
| `app/api/integrations/shopify/data/utils.ts:38` | `// Legacy: Try single shop field` (`metadata.shop`) | Test-fixture key — populated by `__tests__/helpers/actionTestHarness.ts`. Production OAuth doesn't write it, but tests do. KEEP until tests migrate to top-level `shop_domain`. |
| `app/api/integrations/shopify/data/utils.ts:43` | `// Legacy: Try top-level shop_domain` | The top-level `shop_domain` column **is** the canonical write target — populated by `lib/integrations/provider-registry.ts:1493` (`additionalIntegrationData` for shopify). Mislabeled as legacy; this is current production. |
| `app/api/integrations/shopify/data/types.ts:17,21` | `shop_domain?: string // Legacy field` + `shop?: string // Legacy: single shop domain` | Same correction. Plus added comment that `metadata.stores` / `metadata.active_store` are forward-compat reads with no writers yet (multi-store is aspirational). |
| `app/api/integrations/shopify/data/handlers/stores.ts:18-30` | `legacy single shop format` | Same — single-store domain via `shop_domain` is canonical, not legacy. Also reworded the log line. |

### Pre-launch action remaining

For the comment-rewrite items above, full removal lands when:
- `nodeExecutionService.ts:121` — when HITL/resume routes thread `testModeConfig` through, drop the fallback.
- `visibility.ts:218` — when the visibility-migration tracking doc reports zero remaining `conditional` / `conditionalVisibility` / `visibleWhen` / `showWhen` callers, drop the four pattern branches.
- Shopify multi-store — when multi-store gets a real OAuth flow that writes `metadata.stores[]`, the read code becomes load-bearing for production (not aspirational).
- Test fixture — migrate `__tests__/helpers/actionTestHarness.ts` and `__tests__/nodes/shopify-create-customer.test.ts` to use top-level `shop_domain` instead of `metadata.shop`, then drop the `metadata?.shop` branch.

### Verification

1785 / 1785 tests pass across 97 suites after the §G changes. No new tests added — all changes are deletions of dead branches or comment rewrites of misleading labels. The deleted dataFetchers/fallbackFetcher path was already unreachable (always-empty registry); its 400-on-unknown behavior is preserved.

---

## H. Real TODOs

| Status | File:Line | What |
|---|---|---|
| DONE — 2026-05-02 | `app/api/integrations/facebook/data-deletion/route.ts` (was `app/api/integrations/facebook/data-deletion.ts`) | Implemented Facebook data-deletion callback per Meta's spec. Two findings during the audit: (1) the original file was at `data-deletion.ts` (not `data-deletion/route.ts`), so it wasn't actually exposed as a Next.js route — the endpoint was completely unreachable. Moved to the correct path. (2) The original file was a stub with 4 TODOs that never deleted anything. Replaced with a full implementation: HMAC-SHA256 signature verification using `FACEBOOK_CLIENT_SECRET`, base64url decode of the signed_request, constant-time signature compare; Facebook-initiated path looks up the integration by `provider = 'facebook'` AND `provider_user_id = signed.user_id`; user-initiated path authenticates via Supabase Bearer token and finds the user's facebook integrations. Both paths use the same cleanup pattern as `/api/integrations/[id]` DELETE: revoke OAuth token (fire-and-forget via `revokeOAuthTokenAsync`), explicitly clear `integration_permissions` and `integration_shares`, then delete the integration row (cascade handles trigger_resources et al.). Returns `{ url, confirmation_code }` per Meta's required shape for Facebook-initiated calls. |

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

## K. Items found during the 2026-05-02 §I re-discovery sweep — closed 2026-05-02

Triaged the 26 items the §I sweep surfaced. Pattern matched §G — actual greps for callers, deletions where dead, comment rewrites where load-bearing. Test suite stayed at 1785 / 1785 across 97 suites throughout.

### K.1 Trigger lifecycle alt names / legacy formats — DONE

| File | Outcome |
|---|---|
| `lib/triggers/providers/MicrosoftGraphTriggerLifecycle.ts:601` | DELETED `'trigger_file_created'` map entry. No node emits this type — OneDrive provider only declares `onedrive_trigger_new_file` and `onedrive_trigger_file_modified`. Also deleted the matching dead branch in `app/api/microsoft-graph/worker/route.ts:1159` that gated on `nodeType === 'onedrive_trigger_file_created'`. |
| `lib/triggers/providers/AirtableTriggerLifecycle.ts:41,69` | KEEP — JUSTIFIED. The "legacy" label was wrong. Compound `integrationId:baseId` is what the UI dropdown emits; bare `baseId` is reachable from tests, AI-generated configs, and predefined-template imports that haven't been re-saved through the UI. Reworded the comments to drop "legacy" and explain the two real input shapes. |
| `lib/triggers/providers/GoogleApisTriggerLifecycle.ts:718` | DELETED 3 dead map entries (`google_drive_trigger_file_created` / `_file_modified` / `_file_shared`). Google Drive provider only emits colon-prefix types (`google-drive:new_file_in_folder`, `:file_updated`, etc.) — verified via grep on `type:` declarations. |
| `lib/triggers/providers/StripeTriggerLifecycle.ts:72` | DELETED legacy user_id fallback. Pre-launch no workflows exist without `stripe_account`. The Stripe provider node defines `stripe_account` as a required-shaped multi-account selector; the trigger now throws an explicit error if it's missing. |
| `lib/triggers/providers/ShopifyTriggerLifecycle.ts:314` | DELETED 11 dead map entries (`shopify_trigger_order_created`, `_order_cancelled`, `_product_created`, `_product_deleted`, `_customer_created`, `_customer_updated`, `_inventory_updated`, `_cart_created`, `_cart_updated`, `_checkout_created`, `_checkout_updated`). Shopify provider only emits the 8 canonical types listed above. The only external reference was the dead `WebhookManager.tsx` component. |
| `components/webhooks/WebhookManager.tsx` (bonus) | DELETED. Zero importers. Unused dead-code component. |

### K.2 Per-provider deprecations — DONE

| File | Outcome |
|---|---|
| `lib/services/integrations/slackIntegrationService.ts` (5 sites) | Reworded all 5 misleading "Use legacy service" comments. The "legacy service" was `LegacyIntegrationService.executeFallbackAction`, a thin wrapper around `executeAction` from `lib/workflows/executeNode.ts` (the registry-backed dispatcher). Inlined the wrapper as a private `dispatch` method on `SlackIntegrationService` and DELETED `lib/services/legacyIntegrationService.ts` entirely (the only consumer was Slack; its `executeOneDriveUpload` / `executeDropboxUpload` stub methods had zero callers). |

### K.3 Backwards-compat exports / aliases — DONE

| File | Outcome |
|---|---|
| `utils/supabaseClient.ts:12` | KEEP — JUSTIFIED. Same lazy-init Proxy pattern as `lib/db.ts:23` (reclassified in §F). Rewrote the comment to describe what the Proxy actually does (defers Supabase client construction to first property access for build-time env-var safety). |
| `lib/services/workflowExecutionService.ts:311` | DELETED the no-op `deductTasksForExecutedNodes` function plus its 3 `await` call sites. Tasks are deducted upfront by the calling route per the v1 reservation model; the function had been a stub since the deduction was moved upstream. |
| `lib/services/executionHistoryService.ts:380` | DELETED the entire `cleanupOldHistory` method. Zero callers (verified via grep). The body was a no-op log line — the underlying RPC targeted removed tables. |
| `lib/workflows/actions/aiAgentAction.ts:1395` | Reworded the misleading comment. The code doesn't actually emit an `extracted` field — it sets `result.data.data = parsedContent` and hoists each top-level key from the parsed JSON onto `result.data`. The "backwards compat" claim was stale documentation. |
| `lib/workflows/actions/airtable/findRecord.ts:177-178` | KEEP — JUSTIFIED. The schema's `outputSchema` documents `recordId` / `fields` / `createdTime` as "(or first record if multiple)" — this is intentional UX, not backwards-compat. Reworded the comments to match the schema. |
| `stores/workflowCostStore.ts:60` | DELETED `setWorkflowCost` (the Map-conversion compat method) and its interface declaration. Zero callers — only `setWorkflowCostDetailed` is used (single caller in `WorkflowBuilderV2.tsx:7637-7650`). |

### K.4 Legacy data shapes / fallback paths — DONE

| File | Outcome |
|---|---|
| `app/(app)/workflows/v2/api/flows/[flowId]/apply-edits/route.ts:327` | KEEP — JUSTIFIED. Misleadingly labeled "legacy". This is a Flow v2 → ReactFlow shape conversion at the call site of `activateWorkflowTriggers`, which expects ReactFlow `{ id, data: { type, ... } }`. Both shapes are active. Renamed the local `legacyNodes` → `reactFlowNodes`; reworded the comment. |
| `components/workflows/configuration/utils/validation.ts:224` | KEEP — JUSTIFIED. Same pre-migration `dependsOn` + `showIf` shape as `lib/workflows/fields/visibility.ts:218` (§G.5). Tracked alongside `learning/docs/visibility-migration-progress.md`; deletion gated on completing that migration. Reworded the comment. |
| `lib/integrations/oauth-callback-handler.ts:78` | KEEP — JUSTIFIED. The "legacy provider support" header was wrong. The fields below it (`requiresPkce`, `customTokenExchange`, etc.) are extensions for providers with non-standard OAuth flows — Notion / Shopify / Facebook / Instagram / PayPal — all current. Renamed the section header. |
| `lib/integrations/oauth-callback-handler.ts:448` | KEEP — JUSTIFIED. Misleading "backward compatibility" label. `user_id` is the canonical owner column for personal integrations and is queried by every handler's token-fetch path (`getDecryptedAccessToken`, `refreshToken`, ~15 per-provider helpers). Reworded the comment. |
| `components/workflows/configuration/providers/registry.ts:57` | KEEP — JUSTIFIED. Both HubSpot loaders are active with distinct field coverage — base loader handles fixed lookups (listId, ownerId), dynamic loader handles the dynamic-object schema (objectType / properties / recordId / identifierProperty) plus a few overlapping shared fields. Reworded the comment to drop "legacy". |
| `components/workflows/configuration/providers/hubspot/hubspotDynamicOptionsLoader.ts:267` | Reworded matching comment in the dynamic loader to "shared field" instead of "legacy fields". |
| `lib/integrations/scope-validator.ts:213` | KEEP. False positive in the §I grep — the `// Check for deprecated scopes` comment describes a real defensive facility (`config.deprecated` warnings when providers mark scopes deprecated). No actual cleanup needed. |
| `lib/workflows/actions/dropbox/uploadFile.ts:111` | KEEP — JUSTIFIED. The `fileInfo.data` branch handles the Slack-style attachment shape that `FieldRenderer.tsx:911` produces (writes base64 onto `data` with `data:mime;base64,` prefix). Reworded the comment. |
| `lib/workflows/actions/discord.ts:987` | DELETED single-`userId` fallback. The `delete_messages` action's schema only declares `userIds` (multi-select). The `filterUserId` destructure and its fallback array conversion were dead. |
| `lib/workflows/actions/core/executeIfThen.ts:106` | DELETED the entire `conditionGroups` branch (lines 106-143) plus the destructure default at line 25. No node schema declares `conditionGroups`; nothing in production input ever has it. |
| `lib/services/discordInviteTracker.ts:293` | KEEP. The config-spread-onto-data pattern is a common ReactFlow handler-compatibility move. Reworded the comment to drop "legacy compatibility" and explain what the spread actually enables. |
| `stores/integrationStore.ts:1080` | KEEP. Oldest-first sort is meaningful — callers that take `result[0]` for multi-account providers get the originally-connected account, which is the predictable default. Reworded the comment. |
| `lib/ai/dynamicWorkflowAI.ts:583` | KEEP. Misleadingly labeled "legacy/invalid". The branch is AI-hallucination correction — `google_drive_action_search` doesn't exist; `notion_action_search` is parallel to (not legacy versus) `notion_action_search_pages`. Reworded the comment. |

### K.5 Real TODOs — DONE

| File | Outcome |
|---|---|
| `lib/services/integrations/googleIntegrationService.ts:328,350,376` | Replaced 3 `"not yet implemented"` stubs with delegation to the registry-backed handlers `createGoogleDriveFolder` / `deleteGoogleDriveFile` / `shareGoogleDriveFile` (which already existed in `lib/workflows/actions/googleDrive/`). Same pattern the file already used for `executeUploadFile`. |
| `lib/services/executionHandlers/integrationHandlers.ts:811` | Replaced `"Airtable delete record is not yet implemented"` stub with delegation to `deleteAirtableRecord` from `lib/workflows/actions/airtable/deleteRecord.ts`. Same pattern the file uses for the other Airtable cases. |

### Verification

1785 / 1785 tests pass across 97 suites after the §K closure. Net change: 6 deletions of dead code (file deletes + map entry deletes + dead-branch deletes) plus 4 wrappers replaced with direct delegation; 13 misleading "legacy" / "backwards compat" comments rewrote to describe what the code actually does.

---

## J. Definition of "ready to launch"

Every row in §A–§K is either DONE or KEEP — JUSTIFIED. No row is OPEN. §H's TODO is closed. The grep commands in §I return only items already in this doc.

If a "legacy" item is genuinely worth keeping (e.g., a database schema alias that supports a real internal team's external integration), the row's status changes to KEEP — JUSTIFIED with a one-line reason on the same row. Items without a recorded reason default to OPEN and block launch.

---

## References

- [`CLAUDE.md`](../../CLAUDE.md) — particularly Section 3 "Critical Execution Rules" ("Remove Means DELETE") and Section 4 "Architecture & Patterns" (Single Source of Truth)
- [`learning/docs/handler-defaults-audit.md`](handler-defaults-audit.md) — A4
- [`learning/docs/handler-contracts.md`](handler-contracts.md) — Phase 2 contract source of truth
- [`learning/docs/resolver-consolidation-design.md`](resolver-consolidation-design.md) — A1, A2
