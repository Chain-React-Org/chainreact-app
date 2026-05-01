# Handler Contracts

This document is the single source of truth for the **intended behavior** of workflow action handlers. It exists because tests are only as good as the behavior they verify — without documented intent, tests calcify whatever the code currently does, even when current behavior is a bug or a stopgap.

Every handler test under [`__tests__/nodes/`](../../__tests__/nodes/) cites the relevant contract by its Q-number (e.g., `// Q3 — 401 refresh+retry`). When changing a handler, change the contract here first, then update the tests, then update the source.

---

## Q1 — Failure-mode contract

**Decision:** Expected failures return `ActionResult { success: false, message }`. Unexpected failures may throw — the execution layer catches them.

### What counts as "expected"

- Provider 4xx/5xx responses (auth expired, rate limit, validation error, not found)
- Missing required config (no `to:` field on a send-email node)
- Variable-resolution failures (covered separately in Q2)
- Validation errors raised by the handler itself ("amount must be positive")
- Auth that exists but is rejected by the provider (token revoked)

These all return:
```ts
{
  success: false,
  category: 'provider' | 'config' | 'auth' | 'validation',
  message: '<clear human-readable explanation>',
  // optional: error.code, error.path, error.providerStatus, etc.
}
```

### What counts as "unexpected"

- Programmer errors (`undefined.foo`)
- Invariant violations (`if (this should never happen) throw`)
- System faults (DB connection lost mid-call, OOM)

Handlers do **not** have to wrap every line in try/catch. The execution layer (handler-invocation site) catches every uncaught throw and converts it to:
```ts
{ success: false, category: 'internal', message: '<sanitized error>' }
```
The original error is logged at error level (with the safety-floor rules from Q8 applied — no token / PII leak).

### Why this split

Forcing handlers to catch every conceivable error makes handler code defensive and noisy. A clean handler describes the happy path and the named failure paths it knows about; everything else is "should never happen" and the engine treats it as a bug surface.

### Implementation files

- Execution layer: [`lib/services/nodeExecutionService.ts`](../../lib/services/nodeExecutionService.ts) (or equivalent — confirm during PR-C1)
- Action result types: [`lib/workflows/actions/core/`](../../lib/workflows/actions/core/)

---

## Q2 — Variable resolution semantics

**Decision:** A `{{...}}` reference to a variable that doesn't exist at runtime hard-fails the run with a typed `MissingVariableError`. The execution layer converts it to a standardized failure shape.

### Standardized failure shape

```ts
{
  success: false,
  category: 'config',
  error: {
    code: 'MISSING_VARIABLE',
    path: '<the missing path, e.g. "trigger.email">',
  },
  message: 'Variable "trigger.email" not found in input',
}
```

### Coverage

Both template positions hard-fail:
- Full-template: `{ to: "{{trigger.email}}" }` — currently returns `undefined`, must throw.
- Embedded-template: `{ subject: "Hi {{trigger.name}}" }` — currently leaves the literal `{{...}}`, must throw.

### Why hard-fail rather than empty/undefined

Silent missing variables produce broken downstream calls (an empty `to:` field, an email that says "Hi " with no name). Hard-fail gives the user a clear error message naming the missing path. Tests can then assert on the error shape rather than chasing inconsistent silent-failure behavior across handlers.

### Future: optional fields

A future RFC may add an `optional: true` flag on individual workflow-config field references (e.g., `{{trigger.cc | optional}}`). When that lands, the resolver returns `undefined` for explicitly-optional refs and only hard-fails on required ones. Out of scope for the first contract pass.

### Implementation files

- Resolver: [`lib/workflows/actions/core/resolveValue.ts`](../../lib/workflows/actions/core/resolveValue.ts)
- Execution layer (catches `MissingVariableError`): same location as Q1

---

## Q3 — 401 handling (provider-aware)

**Decision:** Provider response of 401 triggers different recovery paths depending on the integration's auth scheme.

### OAuth-with-refresh providers

Examples: Google, Microsoft, Notion, Shopify-offline, HubSpot, Mailchimp.

1. On 401, call `tokenRefreshService.refresh(provider, userId)`.
2. Re-issue the same call once with the refreshed token.
3. If the retry returns 200, return success. The user sees no failure.
4. If the retry also returns 401, return `success: false` (`category: 'auth'`) AND signal `computeTransitionAndNotify({signal: 'token_revoked'})` so the user is notified the integration needs reconnection.

### Non-refreshable auth schemes

Examples: Slack bot tokens, Discord bot tokens, GitHub PAT, plain API keys.

1. On 401, do NOT attempt a refresh — there is nothing to refresh against.
2. Return `success: false` (`category: 'auth'`) immediately.
3. Signal `computeTransitionAndNotify({signal: 'action_required'})` so the user is notified.

### SDK vs raw fetch

Some providers surface 401s as raw `Response { status: 401 }` (Stripe REST, Notion). Others surface them as thrown SDK errors with `code: 401` (Google `googleapis`, Microsoft Graph SDK in some cases). The `refreshAndRetry` helper normalizes both paths to the same recovery flow — handlers don't have to care which form their provider uses.

### Implementation files

- Helper: [`lib/workflows/actions/core/refreshAndRetry.ts`](../../lib/workflows/actions/core/refreshAndRetry.ts) (created in PR-C3)
- Auth-scheme registry: [`lib/integrations/authSchemes.ts`](../../lib/integrations/authSchemes.ts) (created in PR-C3)
- Health engine: [`lib/integrations/healthTransitionEngine.ts`](../../lib/integrations/healthTransitionEngine.ts)

---

## Q4 — Idempotency (within-session)

**Decision:** Every action is idempotent on `(execution_session_id, node_id, action_type)` within the same execution session. Manual reruns create a NEW session — side effects fire again.

### Scope

- **Within the same session** (engine restart, transient retry, explicit replay): re-invoking a handler must NOT duplicate its side effect. Replay returns the cached `ActionResult` from the first successful fire.
- **Different session** (manual user rerun, scheduled re-trigger): the action fires again. That's intentional — a user who clicks "Run again" expects to send another email.

### Persistence

A dedicated `session_side_effects` table with `UNIQUE (execution_session_id, node_id, action_type)`. Schema and full design in [`session-side-effects-design.md`](session-side-effects-design.md). Hash mismatch on replay is **hard-fail** — `checkReplay` returns `{kind: 'mismatch'}` and the handler returns a standardized `PAYLOAD_MISMATCH` failure rather than firing the side effect with mutated input.

### Provider-side idempotency

Where the provider supports it (Stripe `Idempotency-Key`), the handler ALSO sets the provider header to `<sessionId>:<nodeId>:<actionType>` even on replay. Defense in depth — if our internal record is somehow missing, the provider's own idempotency mechanism still prevents a double-charge.

### How handlers receive the key

The engine threads `HandlerExecutionMeta` alongside `(config, userId, input)` to every action handler:

```ts
export interface HandlerExecutionMeta {
  executionSessionId?: string
  nodeId?: string
  actionType?: string
  provider?: string
  testMode?: boolean
}
```

Positional handlers take `(config, userId, input, meta?)`. Object-style handlers (Gmail) take `({ config, userId, input, meta })`. `meta` is optional and absent in test-only paths — `buildIdempotencyKey` returns `null` in that case and handlers fire without idempotency.

### Replay contract

```ts
const key = buildIdempotencyKey(meta)
if (key) {
  const payloadHash = hashPayload(canonicalInput)
  const replay = await checkReplay(key, payloadHash)
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
      break  // fall through and perform the side effect
  }
}
// … perform the side effect …
const result = await callProvider(...)
if (key) {
  await recordFired(key, result, payloadHash, { externalId, provider })
}
return result
```

`checkReplay` returns the stored `ActionResult` from `result_snapshot` verbatim on the cached path. Downstream nodes see the same `output` they would have on the original run.

### Implementation files

- Key builder: [`lib/workflows/actions/core/idempotencyKey.ts`](../../lib/workflows/actions/core/idempotencyKey.ts) (created in PR-C4)
- Hash helper: [`lib/workflows/actions/core/hashPayload.ts`](../../lib/workflows/actions/core/hashPayload.ts) (created in PR-C4)
- Side-effects API: [`lib/workflows/actions/core/sessionSideEffects.ts`](../../lib/workflows/actions/core/sessionSideEffects.ts) (created in PR-C4)
- Retention sweep: [`app/api/cron/clean-session-side-effects/route.ts`](../../app/api/cron/clean-session-side-effects/route.ts) — daily, env var `SESSION_SIDE_EFFECTS_RETENTION_DAYS` (default 30)

---

## Q5 — 0 / false / null / "" semantics

**Decision:**

| Value | Treatment |
|---|---|
| `0` | Always valid. A user who supplies `amount: 0` means $0. The handler does not coerce. (The provider may still reject — that's a Q1 expected failure.) |
| `false` | Always valid. A user who supplies `active: false` means false. |
| `null` | Missing. Required-field validation flags it. |
| `undefined` | Missing. Required-field validation flags it. |
| `""` (empty string) | Missing **only when the field schema disallows blank strings**. Schemas that explicitly accept empty strings keep them. |

### Why

Treating `0` or `false` as "missing" breaks legitimate user inputs — a "minimum: 0" config, a boolean toggle defaulting to false, a free-tier $0 plan. Treating `""` consistently as "missing" breaks fields that legitimately accept blank input (some text fields, optional notes). The schema decides per-field for the empty-string case.

### Implementation files

- Field-visibility / required-field check: [`lib/workflows/validation/fieldVisibility.ts`](../../lib/workflows/validation/fieldVisibility.ts) (already aligned with this contract — see existing tests)
- Per-handler required-field validation: each handler

---

## Q6 — Defaults

**Decision:** Audit all currently-pinned defaults; user reviews each before any default change ships.

The audit is in [`handler-defaults-audit.md`](handler-defaults-audit.md) (created in PR-B). Until the user fills in the `User decision` column for a row, no PR may change that default. Tests continue to pin **current** defaults until decisions land in PR-G (defaults migration).

Highest-concern defaults (flagged by the user during contract review):
- Calendar `sendNotifications = "all"` — auto-emails attendees on event creation. Real spam risk.
- Drive `sharePermission = "reader"` — applied only when a `shareWith` list is supplied; verify intent.
- Calendar `endTime = "10:00"` (when omitted) — arbitrary 1-hour fallback if user supplies no end time.

---

## Q7 — Multi-recipient parsing

**Decision:** CSV splitting applies only to schema-declared multi-recipient / multi-value fields. Single-value schema-typed fields pass through unchanged.

### Where it applies

- Gmail `to`, `cc`, `bcc`
- Outlook `to`, `cc`, `bcc` (this is a **deliberate UX change** from the current Outlook behavior of treating CSV as one address)
- Calendar `attendees`
- Discord mentions
- Any future field whose schema declares it as multi-value

### What the parser does

```ts
parseRecipients("alice@x.com, bob@x.com,carol@x.com")
// → ["alice@x.com", "bob@x.com", "carol@x.com"]

parseRecipients(["alice@x.com", "bob@x.com"])
// → ["alice@x.com", "bob@x.com"]

parseRecipients(undefined)
// → []
```

Simple comma split with whitespace trim and empty filtering. **Not full RFC 5322 display-name parsing** — display-name addresses like `"Last, First" <x@y.com>` are out of scope. Users supply plain emails/IDs separated by commas, or arrays.

### Implementation files

- Helper: [`lib/workflows/actions/core/parseRecipients.ts`](../../lib/workflows/actions/core/parseRecipients.ts) (created in PR-C2)

---

## Q8 — Safety floors (all four mandatory)

Every action handler must satisfy all four. These are enforced via the shared compliance helper [`__tests__/helpers/safetyFloors.ts`](../../__tests__/helpers/safetyFloors.ts) (created in PR-D), invoked once per handler test file.

### Q8a — No tokens / secrets in logs

Tokens, API keys, and other secrets must never appear in any logger call (debug, info, warn, error). Tests assert this by capturing the logger mock and grep-ing call arguments for known-secret values.

### Q8b — No customer PII at info level

Customer PII (email addresses, phone numbers, full names) must not appear at `info` or `warn` level. PII at `debug` level is OK (developer-only). Tests assert by capturing the logger mock and checking info/warn call arguments against known-PII values from the test input.

### Q8c — Billing-impacting actions require pre-execution cost check

Stripe charges, paid AI calls, and any other billing-impacting handler must call the cost-check helper before firing. If the cost check returns `insufficient_balance`, the handler returns `success: false` (`category: 'billing'`) without making the outbound call.

Applies to:
- Stripe (charges, payment intents, subscriptions)
- AI handlers calling paid models
- Any future handler that has monetary impact

Does NOT apply to:
- Free actions (logic nodes, mappers)
- Calls to user's own integrations where cost is the user's, not ours (Gmail send, Slack post — already covered by per-action task budget which is a different accounting layer)

### Q8d — `testMode` intercepts all outbound writes

When `context.testMode === true`, the handler must NOT contact the provider. Instead it returns a deterministic simulated `ActionResult` marked as simulated/skipped:

```ts
{
  success: true,
  output: {
    simulated: true,
    // optional: synthetic IDs ("test_msg_<sessionId>") that downstream nodes can use
  },
  message: 'Simulated in test mode — no provider call made',
}
```

Tests assert that `testMode=true` produces zero outbound API calls AND a result with the simulated/skipped flag.

---

## Q9 — Where this doc lives

This file: [`learning/docs/handler-contracts.md`](handler-contracts.md). Referenced from [`CLAUDE.md`](../../CLAUDE.md).

When you change a contract here, also update:
1. The `Q#` table at the top of [`take-a-look-at-shimmering-galaxy.md`](../../C:/Users/marcu/.claude/plans/take-a-look-at-shimmering-galaxy.md) plan file (if still active).
2. Every test file under `__tests__/nodes/` that cites the changed Q-number.
3. The corresponding source helper / handler.

Order matters: contract first, then tests, then source. Reverse order calcifies whatever the source happens to do.

---

## Q10 — Test infrastructure path

**Decision:** Hybrid approach.

- **Local Docker stack** for tests that need a real database (Supabase Postgres image), email capture (MailHog), or Stripe-mock. Stack defined in [`docker-compose.test.yml`](../../docker-compose.test.yml) (created in PR-E).
- **Hosted sandbox accounts** for OAuth providers (Google / Microsoft / Slack) where faking OAuth is non-trivial and a real token-exchange round-trip is the only way to verify the integration.

CI runs the Docker stack on every push. OAuth sandbox tests sequenced last (PR-F item 9, after credentials are provisioned by the team).

### Implementation files

- Stack: [`docker-compose.test.yml`](../../docker-compose.test.yml)
- Test harnesses: [`__tests__/helpers/dbHarness.ts`](../../__tests__/helpers/dbHarness.ts), [`mailHarness.ts`](../../__tests__/helpers/mailHarness.ts), [`stripeHarness.ts`](../../__tests__/helpers/stripeHarness.ts) (all PR-E)
- Credential setup: [`learning/docs/test-infra-credentials.md`](test-infra-credentials.md) (created in PR-E)

---

## How to use this doc

1. **Writing a new test for a handler:** find the relevant Q-number(s) above, cite them in the test file's contract header, and assert against the documented behavior — not whatever the handler currently does.
2. **Reviewing a handler PR:** check that the diff aligns with the documented contracts. If a contract needs to change, that's a separate PR amending this doc — not a "while we're in there" tweak.
3. **Adding a new provider handler:** every contract above applies. There are no per-provider exemptions; the auth-scheme registry (Q3) handles legitimate provider differences.
4. **Disagreeing with a contract:** open an RFC, get team buy-in, then update this doc + the tests + the source. Don't unilaterally change behavior.
