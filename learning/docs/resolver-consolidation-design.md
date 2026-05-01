# Resolver Consolidation Design (PR-C1a)

**Status:** Draft, awaiting review. **No code changes in this PR** — implementation lands in PR-C1a after the design is approved.

**Scope statement:** This document designs the path from three independent variable-resolution implementations to a single canonical template parser, with stateful and schema-aware lookup preserved as a separate concern. **PR-C1a is consolidation only.** It does NOT change runtime missing-variable behavior. Hard-fail on missing variables (Q2) is the responsibility of [PR-C1b](#pr-c1b-out-of-scope-here), not this PR.

---

## 1. Resolver inventory

### 1.1 Three resolver implementations

| # | File | Size | Shape | Public API |
|---|---|---|---|---|
| 1 | [`lib/workflows/actions/core/resolveValue.ts`](../../lib/workflows/actions/core/resolveValue.ts) | 700 lines | Pure function (recursive over arrays/objects/strings) | `resolveValue(value, input, mockTriggerOutputs?, unresolvedCollector?)` + `resolveValueWithTracking(...)` |
| 2 | [`lib/integrations/resolveValue.ts`](../../lib/integrations/resolveValue.ts) | 141 lines | Pure function (recursive). Legacy. | `resolveValue<T>(template, context, dataFlowManager?)` |
| 3 | [`lib/workflows/dataFlowContext.ts`](../../lib/workflows/dataFlowContext.ts) | ~400 lines | Method on `DataFlowManager` class — stateful, schema-aware | `dataFlowManager.resolveVariable(reference)` + `dataFlowManager.resolveObject(obj)` |

### 1.2 Callers

#### Path 1 — `core/resolveValue.ts` (canonical candidate)

~100 files import `resolveValue` from this path, including handlers under `lib/workflows/actions/{gmail,googleDrive,google-sheets,google-calendar,microsoft-outlook,microsoft-excel,airtable,shopify,monday,gumroad,...}`. Used in:

- **Runtime** (the dominant case): all action handlers under `lib/workflows/actions/` that call `resolveValue` directly.
- **Design-time / non-runtime callers**:
  - `lib/workflows/aiAgent.ts` — AI planner / agent reasoning
  - `lib/workflows/executeNode.ts` — node execution shell (calls into runtime)
  - `lib/workflows/actions/registry.ts` — handler registry resolution
  - `__tests__/workflows/actions/resolveValue.test.ts` (250 lines) — existing unit tests
  - `__tests__/nodes/trigger-to-action-end-to-end.test.ts` — webhook-to-action E2E

#### Path 2 — `integrations/resolveValue.ts` (legacy, 15 callers)

All 15 imports of `@/lib/integrations/resolveValue`:

**Active under `lib/workflows/actions/`** (3 files, runtime-relevant):
- [`lib/workflows/actions/hubspot.ts`](../../lib/workflows/actions/hubspot.ts)
- [`lib/workflows/actions/hubspotDynamic.ts`](../../lib/workflows/actions/hubspotDynamic.ts)
- [`lib/workflows/actions/slack/createChannel.ts`](../../lib/workflows/actions/slack/createChannel.ts)

**Legacy `integrations/` directory** (12 files, status unclear — assumed runtime-relevant until proven otherwise):
- [`integrations/__template__/actionTemplate.ts`](../../integrations/__template__/actionTemplate.ts) — canonical "new integration" template; **propagates the legacy import to every new integration written from this template**
- `integrations/airtable/createRecord.ts`
- `integrations/github/createIssue.ts`
- `integrations/gmail/{sendEmail,searchEmails,addLabel}.ts`
- `integrations/google-sheets/createRow.ts`
- `integrations/hubspot/createContact.ts`
- `integrations/notion/{createPage,createDatabase}.ts`
- `integrations/slack/{sendMessage,createChannel}.ts`

#### Path 3 — `DataFlowContext.resolveVariable`

~94 files reference `dataFlowManager.resolveVariable` — predominantly handlers that receive `context.dataFlowManager` and call its method. Used in:

- **Runtime**: handlers under `lib/workflows/actions/{stripe,mailchimp,onedrive,notion,hubspot,trello,slack,...}` that prefer the stateful, schema-aware lookup
- **Engine internals**:
  - `lib/services/integrations/{gmailIntegrationService,googleIntegrationService,slackIntegrationService}.ts`
  - `lib/services/workflowExecutionService.ts`
  - `lib/workflows/aiAgent.ts`, `lib/workflows/executeNode.ts`
  - `lib/workflows/actions/registry.ts`
  - `lib/workflows/actions/notion/handlers.ts`
  - `app/api/webhooks/discord/hitl/route.ts`
- **Test infrastructure**:
  - `__tests__/helpers/actionTestHarness.ts`

---

## 2. Feature matrix

What each resolver actually supports, derived from reading source:

| Feature | `core/resolveValue` | `integrations/resolveValue` | `DataFlowContext.resolveVariable` |
|---|---|---|---|
| Single-template `{{x}}` (whole value is one ref) | ✅ | ✅ (via `.replace`) | ✅ |
| Embedded templates `prefix {{x}} suffix` | ✅ | ✅ | partial — first match only for some formats |
| Recursion over arrays / objects | ✅ | ✅ | ✅ via `resolveObject` |
| `{{trigger.field}}` with `mockTriggerOutputs` fallback | ✅ | ❌ | ❌ |
| `{{data.field}}` direct dot lookup | ✅ | ✅ | ✅ |
| `{{nodeId.field}}` direct ID lookup | ✅ | ✅ | ✅ |
| `{{nodeId.output.x}}` / nested `output.output` | ✅ | ❌ | ✅ |
| Prefix matching (`{{ai_agent}}` → `ai_agent-<uuid>`) | ✅ | ❌ | ❌ |
| `{{NOW}}` / `{{now}}` ISO timestamp | ✅ | ❌ | ❌ |
| `{{*}}` wildcard (formats all input data) | ✅ | ❌ | ❌ |
| `{{Action: Provider: Name.Field}}` format | ✅ | ❌ | ❌ |
| `{{Node Title.Field Label}}` human-readable, schema-driven | ❌ | ❌ | ✅ (5 fallback strategies) |
| `{{var.varName}}` custom variables | ❌ | ❌ | ✅ |
| `{{global.key}}` workflow-level data | ❌ | ❌ | ✅ |
| `{{varName}}` (single-part, falls back to direct variable) | ✅ via input lookup | ❌ | ✅ via stored variables |
| Stateful (`nodeOutputs`, `variables`, `globalData`, `nodeMetadata`) | ❌ (input dict only) | ❌ | ✅ owns mutable state |
| Soft unresolved tracking (`unresolvedCollector`) | ✅ | ❌ | ❌ |
| Delegates to `dataFlowManager` if available | ✅ via `input.dataFlowManager.resolveVariable` | ✅ explicit 3rd arg | n/a (it IS the dataFlowManager) |
| Miss behavior (full-template) | returns `undefined` | returns literal `{{...}}` (when no `dataFlowManager` arg) | **returns `undefined`** via unanchored `directVarMatch` → `getVariable` chain (the apparent `return reference` at the bottom is dead code for any `{{...}}` input) |
| Miss behavior (embedded) | leaves literal `{{...}}` | leaves literal `{{...}}` | **returns `undefined`** for the same reason — the unanchored matcher fires on the first `{{...}}` and drops prefix/suffix |

**Key observations:**
- **Path 1 owns the richest *template-parsing* logic** — wildcards, NOW, prefix-matching, Action-format. None of these exist in path 3.
- **Path 3 owns the only *stateful and schema-aware* logic** — human-readable node-title-by-label resolution, `{{var.}}`, `{{global.}}`. None of these exist in path 1.
- **Path 2 is a strict subset of path 1's lookup features** plus an explicit `dataFlowManager` delegation arg. It is the simplest of the three and the easiest to retire.
- The three paths have **non-overlapping unique features**. Neither path 1 nor path 3 is a superset of the other. Consolidation cannot mean "kill two paths" — it must mean "reorganize the responsibilities cleanly between two retained paths, with one delegating to the other for the parts they share."

---

## 3. Canonical direction

### Proposed architecture

```
                                     ┌────────────────────────────────────────┐
       call from handler             │ Canonical template engine              │
       (any caller)                  │ lib/workflows/actions/core/            │
                                     │   resolveValue.ts                      │
                                     │                                        │
            ┌───────────────────────▶│ Owns: regex parsing, {{NOW}}, {{*}},   │
            │                        │       Action-format, prefix matching,  │
            │                        │       embedded templates, recursion,   │
            │ direct call            │       unresolvedCollector tracking     │
            │ (most handlers)        │                                        │
            │                        │ Inputs: a plain `input` dict,          │
            │                        │   `mockTriggerOutputs` for tests       │
            │                        └────────────▲───────────────────────────┘
            │                                     │ delegates template parsing
            │                                     │
   ┌────────┴───────────────────┐    ┌────────────┴───────────────────────────┐
   │ DataFlowManager            │    │ lib/integrations/resolveValue.ts       │
   │ (lib/workflows/            │    │ (deprecated — compatibility wrapper)   │
   │  dataFlowContext.ts)       │    │                                        │
   │                            │    │ - Re-exports `resolveValue` shape from │
   │ Owns: stateful storage     │    │   the canonical engine                 │
   │   (nodeOutputs, variables, │    │ - Same signature for caller compat     │
   │    globalData, metadata),  │    │ - Marked @deprecated, points to        │
   │   schema-driven by-label   │    │   the canonical import                 │
   │   resolution               │    └────────────────────────────────────────┘
   │                            │
   │ resolveVariable(ref):      │
   │  1. Handle stateful-only   │
   │     features (var./global./│
   │     human-readable schema) │
   │  2. Else build an `input`  │
   │     dict from internal     │
   │     state and DELEGATE to  │
   │     canonical engine       │
   │  3. Same public API,       │
   │     same return shape      │
   └────────────────────────────┘
```

### Rules of the consolidation

1. **`core/resolveValue.ts` is the canonical template parser.** It owns the regex, the literals (`{{NOW}}`, `{{*}}`), prefix matching, the Action-format syntax, embedded substitution, recursion, and the `unresolvedCollector` mechanism. It does NOT own state.

2. **`DataFlowManager` keeps its public API and its state.** Internally it composes the canonical engine: `resolveVariable(ref)` builds an `input` dict from `this.context.{nodeOutputs, variables, globalData}` and calls the canonical resolver. The unique stateful features (`{{var.x}}`, `{{global.x}}`, `{{Node Title.Field Label}}`-by-schema) are handled as **pre-processing** before delegation, or **post-processing** when the canonical resolver returns undefined and a stateful fallback can fill in.

3. **`integrations/resolveValue.ts` becomes a deprecated compatibility wrapper.** It re-exports the canonical `resolveValue` under the legacy signature so existing imports keep compiling. A `@deprecated` JSDoc points new code at `@/lib/workflows/actions/core/resolveValue`. Removal is queued for a follow-up PR after all 15 callers have migrated.

4. **No feature is dropped during PR-C1a.** Every successful-resolution case that worked before must work after. The parity test plan (§6) is the gate.

5. **Soft tracking stays where it already is.** `unresolvedCollector` and `resolveValueWithTracking` remain; they're the design-time / preview / planner-friendly entry point. Strict mode is not introduced in this PR.

### Why not collapse `DataFlowManager` into the canonical engine?

The stateful and schema-aware features in `DataFlowManager` are real product behaviors (HITL workflows, AI-agent output-by-label resolution, user-defined `{{var.x}}`). Folding them into a pure function would either bloat the canonical engine with state-management code or push the state into a side-channel (a global, a parameter), both worse than keeping the class. The clean separation is: canonical engine is **stateless and pure**, DataFlowManager is **stateful and policy-aware**, DataFlowManager calls into the canonical engine for the parts they share.

---

## 4. Runtime vs design-time behavior

### Runtime (workflow execution)

Today: every handler resolves variables via one of the three paths. PR-C1a unifies the underlying template engine but **keeps the current miss behavior** — full-template `{{x}}` returns `undefined`, embedded leaves the literal in place, soft tracking populates the collector if provided.

After PR-C1a: same observable behavior, single source of truth for template parsing.

After PR-C1b (NOT this PR): runtime resolution becomes strict. Missing variables throw `MissingVariableError`; the handler-invocation site catches it and returns the standardized `{success:false, category:'config', error:{code:'MISSING_VARIABLE', path}}` shape.

### Design-time (preview, planner, builder, AI agent suggestions)

Today: callers can use `resolveValueWithTracking` or pass an `unresolvedCollector` to gather missing references without crashing. The AI planner needs this — it surfaces "the workflow references `{{trigger.cc}}` but the trigger doesn't expose `cc`" to the user as a config warning, not as a hard failure.

After PR-C1a: unchanged. Soft tracking is preserved exactly.

After PR-C1b: design-time callers continue to use the soft path. Strict mode is opt-in (`resolveValueStrict` or a flag) and only the runtime invocation site uses it. Design-time callers must NOT use strict mode.

This boundary is the entire point of choosing option (B) over (A) in the strict-mode discussion.

---

## 5. Migration plan

PR-C1a executes these steps in order. Each step is independently revertable.

### Step 1 — `integrations/resolveValue.ts` becomes a wrapper

The legacy file is the easiest to retire. After this step, the file still exists (so the 15 imports keep working) but its body just delegates to the canonical engine.

- Replace the body with a thin compatibility shim:
  ```ts
  import { resolveValue as canonicalResolveValue } from '@/lib/workflows/actions/core/resolveValue'

  /**
   * @deprecated Use `@/lib/workflows/actions/core/resolveValue` directly.
   * This file is a compatibility wrapper kept so legacy callers keep compiling.
   * Removal is tracked in a follow-up PR after all callers migrate.
   */
  export function resolveValue<T>(template: T, context: Record<string, any>, dataFlowManager?: any): T {
    // The legacy `dataFlowManager` arg is honored by passing it through input,
    // since the canonical engine looks for `input.dataFlowManager` and uses it.
    const input = dataFlowManager
      ? { ...context, dataFlowManager }
      : context
    return canonicalResolveValue(template, input) as T
  }
  ```
- The `getValueByPath` helper inside the legacy file is no longer needed; remove it.
- Verify the 15 callers compile and their tests pass. Specifically the three active handlers under `lib/workflows/actions/`:
  - `hubspot.ts`, `hubspotDynamic.ts`, `slack/createChannel.ts`
- The legacy `integrations/` directory's 12 files are exercised by their own integration tests if any exist; if not, document the gap.
- Update [`integrations/__template__/actionTemplate.ts`](../../integrations/__template__/actionTemplate.ts) to import from the canonical path. New integrations created from this template will use the canonical resolver.

### Step 2 — `DataFlowManager.resolveVariable` delegates internally

This is the larger and more delicate step.

- Add a private helper `private buildInputFromState(): Record<string, any>` that snapshots `nodeOutputs`, `variables`, `globalData` into the shape the canonical engine expects:
  ```ts
  return {
    ...this.context.nodeOutputs,        // gives canonical {{nodeId.field}} access
    trigger: this.context.nodeOutputs.trigger?.data ?? null,  // canonical trigger lookup
    nodeOutputs: this.context.nodeOutputs,                    // path 1 also reads input.nodeOutputs
    // var./global. handled by pre-processing — not via canonical engine
  }
  ```
- Refactor `resolveVariable(ref)` into three phases:
  1. **Pre-process — stateful-only features.** If `ref` matches `{{var.X}}`, `{{global.X}}`, or the human-readable `{{Node Title.Field Label}}` schema-driven format, handle it in-class with the existing logic. These have no canonical-engine equivalent; preserve them exactly.
  2. **Delegate — canonical engine.** Otherwise call `canonicalResolveValue(ref, this.buildInputFromState())`. This handles `{{trigger.field}}`, `{{nodeId.field}}`, `{{NOW}}`, `{{*}}`, prefix matching, the Action-format, and embedded templates uniformly with how every direct caller of the canonical engine sees them.
  3. **Post-process — last-resort lookups.** If the canonical engine returned undefined / the literal `{{...}}` AND the reference is single-part `{{varName}}`, fall back to `this.getVariable(varName)` to preserve the current "single-part `{{x}}` may also be a custom variable" behavior. This is rare but documented in the existing code.
- `resolveObject(obj)` keeps its current shape (recurse + call `resolveVariable` on strings). No behavior change.

### Step 3 — Mark legacy file `@deprecated` formally

After Step 1's wrapper lands and Step 2's delegation lands:

- Add a TODO with a tracking issue ID at the top of `lib/integrations/resolveValue.ts`:
  ```ts
  /**
   * @deprecated Use `@/lib/workflows/actions/core/resolveValue` directly.
   * Tracked for removal in a follow-up cleanup after all 15 callers migrate.
   * See: <issue link>
   */
  ```
- Open a follow-up cleanup ticket (no rush — can land any time after PR-C1b ships) to migrate the 15 imports and delete the file.

### Step 4 — Canonical engine: minor hardening

No feature changes. But while we're touching the resolver:

- Document the existing `unresolvedCollector` mechanism more prominently in JSDoc on `resolveValue` so callers know it exists.
- Document the existing `mockTriggerOutputs` parameter's intended use (test-only vs. fallback) — this is currently ambiguous.
- Confirm via test that passing `dataFlowManager` inside the input dict still works — this is how the legacy wrapper's third arg gets honored.

**Out of scope for Step 4:** any change to miss behavior, any change to template parsing, any new feature.

---

## 6. Parity test plan

New file: [`__tests__/workflows/resolver-parity.test.ts`](../../__tests__/workflows/resolver-parity.test.ts) (created in PR-C1a alongside the implementation).

The test asserts that for the **shared feature set**, all three public entry points produce the same output for the same input. The matrix in §2 defines what's "shared" — features marked ✅ on multiple paths.

### Test categories

For each category below, run the same input through all three entry points and assert agreement. Where a feature is supported by only one or two paths, the test only runs against those.

**Shared by all three:**
- Single-template `{{x}}` resolving to a value present in input
- Embedded template `prefix {{x}} suffix`
- Recursion: `{{x}}` inside an array, inside an object, inside a nested object
- `{{nodeId.field}}` direct ID lookup with field present
- `{{data.field}}` direct dot lookup
- Plain string passthrough (no `{{}}`)
- Non-string passthrough (numbers, booleans, null, undefined)

**Shared by paths 1 and 3** (path 2 is a wrapper over path 1, so it inherits these):
- `{{nodeId.output.field}}` — node output property access
- `{{nodeId.output.output.field}}` — double-nested

**Path 1 only** (no parity expectation, but validate behavior persists):
- `{{NOW}}` / `{{now}}`
- `{{*}}`
- `{{Action: Provider: Name.Field}}`
- Prefix matching `{{ai_agent}}` → `ai_agent-<uuid>`

**Path 3 only** (no parity expectation, but validate behavior persists):
- `{{var.customName}}`
- `{{global.workflowKey}}`
- `{{Node Title.Field Label}}` resolved by output schema

### Miss-behavior parity (current, soft)

After implementation reading, the actual pre-PR-C1a path-3 miss behavior is `undefined`, not the reference string — the apparent `return reference` at the bottom of `resolveVariable` is dead code because the unanchored `directVarMatch` fires for any `{{...}}` input and returns `getVariable(...)` (which is `undefined` for unset names). The design originally claimed path 3 returned the reference on miss; that was wrong.

After PR-C1a, all three paths converge:
- Single-template miss → `undefined` (all three)
- Embedded miss → literal-preserved string (all three)

The PR-C1a-specific change for path 3 is that **embedded miss now correctly preserves prefix/suffix**, where pre-PR-C1a the unanchored matcher dropped them. This is an intentional improvement, not a regression. Documented in the test file's contract header.

### Existing tests that must keep passing

- `__tests__/workflows/actions/resolveValue.test.ts` (250 lines) — all 30+ tests
- `__tests__/nodes/trigger-to-action-end-to-end.test.ts` — particularly the two missing-variable tests at lines ~198 and ~217 (these continue to pin soft-fail behavior; they're the ones PR-C1b will rewrite)
- All handler tests under `__tests__/nodes/` that exercise variable resolution

A green run of the full suite is the parity gate before PR-C1a ships.

---

## 7. Out of scope for PR-C1a

The following are explicitly NOT done in this PR. Each is queued for a later PR.

| Out-of-scope item | Lands in |
|---|---|
| Add `MissingVariableError` class | PR-C1b |
| Add `resolveValueStrict` / `strict: true` mode | PR-C1b |
| Make runtime hard-fail on missing variables | PR-C1b |
| Standardize `{success:false, category:'config', ...}` shape at handler-invocation site | PR-C1b |
| Migrate the 15 legacy callers off `lib/integrations/resolveValue.ts` (rewrite their imports) | Follow-up cleanup |
| Delete `lib/integrations/resolveValue.ts` | Follow-up cleanup |
| Unify path 3 with paths 1 & 2 on full-template miss (now: all return undefined; PR-C1b: all throw) | PR-C1b |
| Add new template features (no new `{{...}}` syntaxes) | Out of scope entirely |
| Rewrite handlers that currently use `dataFlowManager.resolveVariable` to use the canonical engine directly | Out of scope (the delegation makes this unnecessary) |

---

## 8. PR-C1a deliverables checklist

When PR-C1a (the implementation PR following this design) lands, it must include:

- [ ] `lib/integrations/resolveValue.ts` body replaced with a `@deprecated` wrapper that delegates to the canonical engine
- [ ] `lib/workflows/dataFlowContext.ts` `resolveVariable` refactored to pre-process stateful-only features, delegate template parsing to the canonical engine, and post-process single-part variable fallbacks
- [ ] [`integrations/__template__/actionTemplate.ts`](../../integrations/__template__/actionTemplate.ts) updated to import from the canonical path so future integrations don't propagate the legacy import
- [ ] New `__tests__/workflows/resolver-parity.test.ts` covering the shared-feature parity matrix in §6
- [ ] Existing tests pass unchanged (no test rewrites — that's PR-C1b's domain)
- [ ] JSDoc improvements on the canonical engine documenting `unresolvedCollector` and `mockTriggerOutputs`
- [ ] No change in observable miss behavior (full-template returns undefined where it did before, literals preserved where they were before, path 3 still returns the reference string from its public API)

---

## PR-C1b — out of scope here

Once PR-C1a lands, PR-C1b owns:

- `MissingVariableError` class
- Strict-mode entry point on the canonical engine
- Switching the runtime handler-invocation site at [`lib/services/nodeExecutionService.ts`](../../lib/services/nodeExecutionService.ts) (~line 297) to strict mode
- Switching `DataFlowManager.resolveVariable` to strict mode for the runtime call path while keeping the soft path available for design-time callers
- Standardized `{success:false, category:'config', error:{code:'MISSING_VARIABLE', path}}` shape at the catch site
- Updating the two `trigger-to-action-end-to-end.test.ts` tests at ~lines 198 and 217 to assert the strict shape
- Adding per-handler missing-variable tests across `__tests__/nodes/`

That's a separate review.

---

## References

- [`learning/docs/handler-contracts.md`](handler-contracts.md) — Q2 contract being implemented (eventually) by PR-C1b
- [`take-a-look-at-shimmering-galaxy.md`](../../C:/Users/marcu/.claude/plans/take-a-look-at-shimmering-galaxy.md) — original Phase 2 plan; PR-C1 split is described under "PR-C1 · Missing-variable hard-fail (Q2 + Q1 clarification)"
- [`lib/workflows/actions/core/resolveValue.ts`](../../lib/workflows/actions/core/resolveValue.ts)
- [`lib/integrations/resolveValue.ts`](../../lib/integrations/resolveValue.ts)
- [`lib/workflows/dataFlowContext.ts`](../../lib/workflows/dataFlowContext.ts)
