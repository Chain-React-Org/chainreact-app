# Session Side Effects — Schema + API Design (PR-C4-DESIGN)

**Status:** Draft, awaiting review. **No code changes in this PR** — implementation lands in PR-C4 after the design is approved.

**Scope statement:** This document designs the `session_side_effects` table and its read/write API. The table is the persistence layer for **within-session idempotency** of action handlers (Q4 in [`learning/docs/handler-contracts.md`](handler-contracts.md)). PR-C4 implements the migration + helpers; per-handler integration ships alongside or in a follow-up.

---

## 1. Why this exists

Without session-level idempotency, any execution-engine restart, transient retry, or explicit replay during the same execution session can re-fire side-effecting handlers — sending the same email twice, charging the same Stripe customer twice, creating duplicate Notion pages, etc.

The Q4 contract:

- **Within the same execution session** (engine restart, transient retry, explicit replay): re-invoking a handler must NOT duplicate its side effect. Replay returns the cached `ActionResult` from the first successful fire.
- **Different session** (manual user rerun, scheduled re-trigger): the action fires again. A user clicking "Run again" expects another email.

The table records "this side effect already fired" markers keyed on the session + node, so handlers can short-circuit on replay.

---

## 2. Schema

### 2.1 Columns

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK, default `gen_random_uuid()` | row identity, opaque to handlers |
| `execution_session_id` | text | NOT NULL, FK → `workflow_execution_sessions.id` ON DELETE CASCADE | the session this side effect belongs to. Cascade ensures cleanup when a session row is hard-deleted. |
| `node_id` | text | NOT NULL | the workflow node that fired the side effect. Matches `node.id` from the workflow graph. |
| `action_type` | text | NOT NULL | the node's action-type identifier (`gmail_action_send_email`, `stripe_action_create_charge`, etc.) — same string as `node.data.type`. |
| `provider` | text | NOT NULL | the integration provider (`gmail`, `stripe`, `notion`, etc.). Derived from `action_type`'s prefix at write time; stored explicitly so retention / per-provider analytics queries don't have to re-parse strings. |
| `external_id` | text | NULL | provider-returned identifier on first successful fire (Stripe charge `ch_...`, Gmail `messageId`, Notion `page_id`, etc.). NULL when the provider returns no useful ID. Used by support tooling to correlate our records with the provider's. |
| `result_snapshot` | jsonb | NOT NULL | the **full `ActionResult`** returned on the first successful fire (`{success, output, message}`). Replay loads this and returns it verbatim so downstream nodes see the same `output` shape they would have on the original run. |
| `payload_hash` | text | **NOT NULL** | SHA-256 (hex) of the input payload that produced this side effect. Required on every `recordFired`. On replay the incoming payload's hash MUST match the stored hash; mismatch returns `PAYLOAD_MISMATCH` per §6.2. |
| `fired_at` | timestamptz | NOT NULL, default `now()` | when the side effect was recorded. Indexed for retention sweeps. |

### 2.2 Constraints

- **Primary key:** `id`.
- **Unique constraint:** `UNIQUE (execution_session_id, node_id, action_type)`. This is the lookup key the API uses; the unique index is the enforcement mechanism that prevents a concurrent re-fire from inserting a second row.
- **Foreign key:** `execution_session_id REFERENCES workflow_execution_sessions(id) ON DELETE CASCADE`.

### 2.3 Why three columns in the unique key?

- The default and recommended pattern is **one node = one side-effecting action**. Under that pattern, `(execution_session_id, node_id)` would suffice.
- However, some nodes today (and likely more in the future) perform multiple distinct side effects in a single execution. Examples:
  - **Drive upload-with-share** calls `drive.files.create` AND `drive.permissions.create`. Each is a separately-recoverable side effect on retry.
  - **Stripe charge-and-refund** in a single node would record both a charge and a refund.
- Including `action_type` lets one node row record multiple markers, one per distinct action type, without conflating them.
- If the team formally commits to "one node = one side-effecting action" as a hard invariant in a future RFC, the constraint can be tightened to `UNIQUE (execution_session_id, node_id)` and `action_type` dropped. For now the wider key is the safer default.

### 2.4 Indexes

| Index | Purpose |
|---|---|
| `UNIQUE (execution_session_id, node_id, action_type)` | enforcement + read path (`hasFired`, `loadFired`) |
| `(fired_at)` | retention cleanup query (`DELETE FROM session_side_effects WHERE fired_at < now() - interval '<retention>'`) |
| `(provider, fired_at)` | per-provider analytics / monitoring (e.g., "how many Stripe replays happened last hour?") |

### 2.5 RLS

Match the existing `workflow_execution_sessions` policies:

- **Service role:** full access. Cron jobs and the engine read/write via service role.
- **Authenticated user:** SELECT-only on rows belonging to the user, via JOIN through `workflow_execution_sessions.user_id = auth.uid()`. INSERT / UPDATE / DELETE only for service role.

Rationale: handlers run server-side via service role; users have no legitimate reason to write idempotency records, only to read them through admin debug tooling.

---

## 3. Read / write API

All three functions live in [`lib/workflows/actions/core/sessionSideEffects.ts`](../../lib/workflows/actions/core/sessionSideEffects.ts) (created in PR-C4).

### 3.1 Key shape

```ts
export interface SideEffectKey {
  executionSessionId: string
  nodeId: string
  actionType: string
}
```

Constructed by [`buildIdempotencyKey(meta)`](../../lib/workflows/actions/core/idempotencyKey.ts) from `HandlerExecutionMeta` — the engine-thread metadata threaded through alongside `(config, userId, input)` to every action handler:

```ts
export interface HandlerExecutionMeta {
  executionSessionId?: string
  nodeId?: string
  actionType?: string
  provider?: string
  testMode?: boolean
}
```

`buildIdempotencyKey` returns `null` if any of `executionSessionId` / `nodeId` / `actionType` is missing — handlers MUST treat the null return as a no-op idempotency case (test-only paths and non-engine callers). The shape passes the already-derived primitives rather than the full ExecutionContext + node objects so handlers don't have to dig into engine internals.

### 3.2 Functions

The API is a single `checkReplay` helper plus a `recordFired` writer. The three replay outcomes (`fresh` / `cached` / `mismatch`) are exhaustive and exclusive — handlers branch on them with no further DB calls.

```ts
export type ReplayOutcome =
  | { kind: 'fresh' }                            // no prior row — fire normally
  | { kind: 'cached'; result: ActionResult }     // matching hash — return cached result
  | { kind: 'mismatch'; storedHash: string }     // different hash — return PAYLOAD_MISMATCH

/**
 * Atomically read the row for `key` and compare the incoming payload hash
 * against the stored hash. Returns `fresh` (no row), `cached` (matching
 * hash — replay safe), or `mismatch` (different hash — Q4 PAYLOAD_MISMATCH).
 *
 * Failed previous fires (rows where `result_snapshot.success === false`)
 * count as `fresh` — a retry SHOULD attempt the provider call again.
 */
export async function checkReplay(
  key: SideEffectKey,
  payloadHash: string
): Promise<ReplayOutcome>

/**
 * Record a successful fire. Stores the full ActionResult in
 * `result_snapshot` along with the required `payloadHash` and an optional
 * provider-returned `externalId`.
 *
 * Idempotent on its own: if the row already exists for this key, a UNIQUE
 * violation is caught and treated as "already recorded — fine."
 *
 * `payloadHash` is required (NOT NULL on the column). Callers must compute
 * it from the same canonical-input shape they passed to the provider.
 */
export async function recordFired(
  key: SideEffectKey,
  result: ActionResult,
  payloadHash: string,
  options?: { externalId?: string }
): Promise<void>
```

### 3.3 Handler integration pattern

```ts
const key = buildIdempotencyKey(meta)
if (!key) {
  // No idempotency — fire normally (test-only path / non-engine caller).
} else {
  const payloadHash = hashPayload(canonicalInput)
  const replay = await checkReplay(key, payloadHash)
  // … see switch below
}
```

Inside the `if (key)` branch:

```ts
switch (replay.kind) {
  case 'cached':
    return replay.result   // replay path — no provider call

  case 'mismatch':
    return {
      success: false,
      category: 'idempotency',
      error: { code: 'PAYLOAD_MISMATCH' },
      message: 'This action was already executed for this session with different input.',
    }

  case 'fresh':
    // fall through and perform the side effect
    break
}

const actionResult = await callProvider(...)
await recordFired(key, actionResult, payloadHash, {
  externalId: actionResult.output?.id,
})
return actionResult
```

The two-call pattern (`checkReplay` then `recordFired`) is intentional — it keeps each call focused, makes the test surface obvious, and lets handlers branch on the outcome without nested conditionals. A single combined `checkOrRecord` would conflate the read and write paths and complicate testing.

### 3.4 Stripe-specific (defense in depth)

For providers that support it (Stripe `Idempotency-Key` header), the handler ALSO sets the provider header to `<sessionId>:<nodeId>:<action_type>` even on replay. If our internal `session_side_effects` record is somehow missing (DB outage at write time, partition split, etc.), Stripe's own idempotency mechanism still prevents a double-charge.

The handler's first call writes the Stripe header AND records to `session_side_effects` on success. Replay reads the cached result; if for some reason replay does reach Stripe (e.g., our record was lost), Stripe returns the cached charge response from its own idempotency cache.

---

## 4. Replay contract

### 4.1 What "replay" means

A replay is any second invocation of the same `(executionSessionId, nodeId, actionType)` triple — typically caused by:

- Engine crash + auto-recovery
- Transient retry from `refreshAndRetry` or other resilience layers (rare; refreshAndRetry retries within a single handler invocation, not across full re-execution)
- Manual replay from the admin debug panel

### 4.2 Replay output shape

`loadFired(key)` returns the **full `ActionResult` from the first fire** stored in `result_snapshot`. This means:

- Downstream nodes that read `result.output.messageId` get the same value they would have on the original run.
- `result.success` is preserved (always `true` because failed runs aren't recorded).
- `result.message` is preserved verbatim — log readers see the original "Sent successfully" message, not "Skipped — already fired."

This is **deliberate**: downstream node behavior must not branch on "is this a replay" because that would make replay non-deterministic. The whole point is for replay to be transparent.

### 4.3 What `recordFired` does NOT do

- **Doesn't touch the side effect.** The handler runs the provider call; `recordFired` is the post-success bookkeeping.
- **Doesn't unwind on failure.** If the row insert fails after a successful provider call, the next replay can re-fire — the handler must accept that risk because the alternative (rolling back the provider call) is impossible. We log loudly so an operator can hand-fix.

---

## 5. Lifecycle and ownership

| Phase | Responsibility |
|---|---|
| **Schema migration** | PR-C4. Standard Supabase migration via `supabase migration new session_side_effects`. |
| **Read/write API** | PR-C4. All three functions in `lib/workflows/actions/core/sessionSideEffects.ts`. |
| **Per-handler integration** | PR-C4 for the 8 already-tested handlers (Gmail / Outlook / Calendar / Drive / Sheets / Notion / Airtable / Shopify) plus Stripe. Other handlers migrated as they're touched. |
| **Test harness** | PR-C4. `seedSessionFired({sessionId, nodeId, actionType, externalId, result})` pre-populates the registry for replay tests. |
| **Retention cleanup** | A periodic cron job — see §7.1. Implementation deferred until retention policy is decided. |

---

## 6. Policy decisions

Both policy decisions below are **locked**. PR-C4 implements them as described.

### 6.1 Retention period — locked

- **Default:** 30 days.
- **Env var:** `SESSION_SIDE_EFFECTS_RETENTION_DAYS` (operator-tunable without a migration).
- **Cleanup:** daily cron at `/api/cron/clean-session-side-effects` issuing a single `DELETE FROM session_side_effects WHERE fired_at < now() - interval '<n> days'`.
- **FK behavior:** `ON DELETE CASCADE` on the parent `workflow_execution_sessions(id)` — hard-deleted sessions clean up their idempotency rows automatically, no separate sweep needed.

### 6.2 Hash-mismatch policy — locked: HARD-FAIL

- `payload_hash` is **NOT NULL** in the schema.
- `recordFired` requires the caller to provide `payloadHash` on every call.
- `checkReplay(key, incomingPayloadHash)` returns `{kind: 'mismatch'}` when the incoming hash differs from the stored hash.
- The handler converts a `mismatch` outcome into the standardized `PAYLOAD_MISMATCH` shape:

```ts
{
  success: false,
  category: 'idempotency',
  error: { code: 'PAYLOAD_MISMATCH' },
  message: 'This action was already executed for this session with different input.',
}
```

**Rationale:** a different payload means this is not a safe replay. Returning the old result would hide a mutated-input bug and could make downstream behavior misleading. Hard-fail forces the caller to acknowledge the divergence explicitly — either by re-running with the original input, or by treating this as a separate execution.

**Hash construction:** SHA-256 of a canonical-form serialization of the resolved input passed to the provider (after PR-C1b's strict resolution). PR-C4 picks a single canonicalizer (e.g., stable-stringify with sorted keys); the same input that produces side effect X must always hash to the same value across engine restarts.

---

## 7. Migration plan

PR-C4 executes these steps in order. Each is independently revertable.

### Step 1 — Migration file

```bash
supabase migration new session_side_effects
```

Migration body creates the table per §2, the indexes per §2.4, the RLS policies per §2.5. Tested locally first per CLAUDE.md Section 9.

### Step 2 — Helpers

Two files under `lib/workflows/actions/core/`:

- `idempotencyKey.ts` — `buildIdempotencyKey(meta?: HandlerExecutionMeta): SideEffectKey | null`. Reads `meta.executionSessionId`, `meta.nodeId`, `meta.actionType`. Returns `null` if `meta` is undefined or any of the three fields is missing/empty (test-mode path or non-engine caller). Also exports `formatProviderIdempotencyKey(key)` → `${executionSessionId}:${nodeId}:${actionType}` for the Stripe header.
- `sessionSideEffects.ts` — `hasFired`, `loadFired`, `recordFired` per §3.2.

### Step 3 — Per-handler integration

Following the §3.3 pattern. Each handler gains a `Q4 — idempotency within session` describe block in its existing test file:

- First invocation fires + records.
- Second invocation with same `(sessionId, nodeId, actionType)` AND same payload hash returns the cached result with no second outbound call.
- Second invocation with same key but **different** payload hash returns the standardized `PAYLOAD_MISMATCH` failure with no second outbound call.
- Manual rerun (different `sessionId`) does fire — confirms scope.
- Stripe-specific: assert `Idempotency-Key` header matches `<sessionId>:<nodeId>:<action_type>`.

### Step 4 — Retention cron

Daily cron at `/api/cron/clean-session-side-effects`:

```sql
DELETE FROM session_side_effects
WHERE fired_at < now() - (
  COALESCE(current_setting('app.session_side_effects_retention_days', true), '30')::int
  || ' days'
)::interval;
```

Or simpler: read `SESSION_SIDE_EFFECTS_RETENTION_DAYS` from `process.env` in the cron route, default 30, and string-interpolate the number into the SQL — server-controlled, not user-controlled, so injection isn't a concern.

The route uses `requireCronAuth` per CLAUDE.md Section 7 (Admin Authorization Architecture).

---

## 8. Out of scope for PR-C4

- **Cross-session idempotency.** Manual user reruns deliberately re-fire (Q4). If the team decides cross-session idempotency is needed for a specific use case, it's a separate feature with its own table or a new column on this one.
- **Distributed-transaction-style "exactly once" semantics.** This is at-least-once + idempotent-on-replay. A single-flight network partition mid-side-effect can still result in the side effect firing twice across two sessions — the cross-session boundary is intentionally not protected.
- **Per-action-type custom replay logic.** Every handler uses the same `loadFired` → `recordFired` pattern. Specialized handlers (e.g., a polling action that maintains its own cursor) live outside this contract.
- **UI for inspecting / replaying / undoing recorded side effects.** Admin tooling can query the table directly; a UI is a follow-up feature.

---

## 9. References

- [`learning/docs/handler-contracts.md`](handler-contracts.md) Q4 — the contract this design implements
- [`take-a-look-at-shimmering-galaxy.md`](../../C:/Users/marcu/.claude/plans/take-a-look-at-shimmering-galaxy.md) — Phase 2 master plan; PR-C4 is described under "PR-C4 · Idempotency / session-side-effects registry"
- [`supabase/migrations/20251128062000_fix_execution_sessions_table.sql`](../../supabase/migrations/20251128062000_fix_execution_sessions_table.sql) — `workflow_execution_sessions.id` is the FK target
- [`lib/services/workflowExecutionService.ts`](../../lib/services/workflowExecutionService.ts) — `ExecutionContext.executionId` is the session ID

---

## 10. PR-C4-DESIGN deliverables checklist

- [x] Schema designed (§2)
- [x] Read/write API designed (§3)
- [x] Replay contract documented (§4)
- [x] Migration plan documented (§7)
- [x] §6.1 retention period decided: 30 days, env-var tunable, daily cron, FK ON DELETE CASCADE
- [x] §6.2 hash-mismatch policy decided: hard-fail with `PAYLOAD_MISMATCH`; `payload_hash` NOT NULL
- [ ] User approval to proceed to PR-C4 implementation
