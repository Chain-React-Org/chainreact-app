/**
 * Shared safety-floor compliance helper for action-handler tests
 * (PR-D, Q8 — see learning/docs/handler-contracts.md).
 *
 * Each handler test invokes `runSafetyFloorChecks(...)` once. The helper
 * runs the four documented Q8 checks against the handler with a known
 * config / input / known-secret / known-PII fixture. Centralizing the
 * assertions here means a contract change propagates to every handler
 * test in one edit — no per-handler drift.
 *
 * ─── What's checked ──────────────────────────────────────────────────
 *   Q8a — No secrets / tokens in any logger call (debug, info, warn, error).
 *         The harness stubs the logger; this helper greps captured calls
 *         for the supplied `knownSecrets` values.
 *
 *   Q8b — No customer PII at info or warn level. PII is allowed at debug
 *         (developer-only). The helper greps info/warn calls only.
 *
 *   Q8d — testMode interception. Invokes the handler with the testMode
 *         flag set, asserts no outbound provider call fires AND the
 *         result carries `output.simulated === true`.
 *
 * ─── Q8c (intentionally not enforced per-handler here) ───────────────
 *   The Q8 contract calls for a per-handler cost-check helper. ChainReact
 *   already enforces task budget at the WORKFLOW layer via
 *   `deductTasksAtomic` (lib/workflows/taskDeduction.ts) — it runs before
 *   any handler fires and is fail-closed on insufficient_balance,
 *   subscription_inactive, or billing_unavailable. Adding a per-handler
 *   duplicate would not catch a case the upstream check misses.
 *
 *   The `isBillingImpacting` flag is accepted on the helper API for
 *   forward compatibility — if a future RFC introduces a per-handler
 *   cost shim, the helper can wire it in without per-test churn.
 *
 * ─── Usage ───────────────────────────────────────────────────────────
 *   describe('Q8 — safety floors', () => {
 *     runSafetyFloorChecks({
 *       handlerKind: 'positional',
 *       handler: createGoogleCalendarEvent,
 *       baseConfig: { ... },
 *       baseInput: { ... },
 *       knownSecrets: ['mock-token-12345'],
 *       knownPii: ['alice@example.com', '+1-555-0100'],
 *       resetOutboundMocks: () => { mockCalendarApi.events.insert.mockClear() },
 *       assertNoOutboundCalls: () => {
 *         expect(mockCalendarApi.events.insert).not.toHaveBeenCalled()
 *       },
 *     })
 *   })
 *
 * The handler-shape variations:
 *   - `positional` — `(config, userId, input, meta?)`. Most handlers.
 *   - `object`     — `({ config, userId, input, meta })`. Gmail.
 *   - `context`    — `(config, ExecutionContext)`. Stripe handlers.
 *
 * The caller supplies `resetOutboundMocks` and `assertNoOutboundCalls`
 * since outbound shapes vary by handler (googleapis SDK vs raw fetch
 * vs Notion client).
 */

import type { ActionResult } from '@/lib/workflows/actions/core/executeWait'
import { fetchMock } from './actionTestHarness'

type PositionalHandler = (
  config: any,
  userId: string,
  input: Record<string, any>,
  meta?: any,
) => Promise<ActionResult>

type ObjectHandler = (params: {
  config: any
  userId: string
  input: Record<string, any>
  meta?: any
}) => Promise<ActionResult>

type ContextHandler = (config: any, context: any) => Promise<ActionResult>

export type HandlerKind = 'positional' | 'object' | 'context'

export interface SafetyFloorParams {
  /** Selects which handler invocation shape to use (see types above). */
  handlerKind: HandlerKind
  handler: PositionalHandler | ObjectHandler | ContextHandler
  baseConfig: any
  baseInput?: Record<string, any>
  /** Known token/secret values to grep for in logger calls (Q8a). */
  knownSecrets: string[]
  /** Known PII to grep for in info/warn calls (Q8b). */
  knownPii: string[]
  /**
   * Clear outbound-mock call history before the testMode invocation so
   * `assertNoOutboundCalls` runs against a clean slate. Required because
   * the Q8a/b runs perform a normal handler invocation first, which may
   * register outbound calls.
   */
  resetOutboundMocks: () => void
  /** Assert that no outbound provider call has been made (Q8d). */
  assertNoOutboundCalls: () => void
  /**
   * Optional: a secondary outbound mock primer so the Q8a/b normal-path
   * invocation succeeds. Tests with simple happy-path mocks can skip
   * this; tests whose handler needs specific mock responses pass a
   * setup callback.
   */
  primeOutboundMocks?: () => void
  /**
   * Optional: provider name surfaced in the handler's simulated output.
   * Used by the Q8d assertion to pin `output.provider` if the handler
   * sets it.
   */
  expectedProvider?: string
  /** Reserved for a future per-handler cost shim. Currently unused. */
  isBillingImpacting?: boolean
}

/**
 * Invoke the handler under test using the kind-specific calling
 * convention. `metaExtras` lets callers fold extra fields onto the
 * meta/context payload (e.g., testMode for Q8d).
 */
async function invokeHandler(
  params: SafetyFloorParams,
  metaExtras: Record<string, any> = {},
): Promise<ActionResult> {
  const baseInput = params.baseInput ?? {}
  const meta = {
    executionSessionId: 'session-q8-test',
    nodeId: 'node-q8-test',
    actionType: 'q8_safety_floor_test',
    ...metaExtras,
  }

  switch (params.handlerKind) {
    case 'positional': {
      const fn = params.handler as PositionalHandler
      return fn(params.baseConfig, 'user-1', baseInput, meta)
    }
    case 'object': {
      const fn = params.handler as ObjectHandler
      return fn({
        config: params.baseConfig,
        userId: 'user-1',
        input: baseInput,
        meta,
      })
    }
    case 'context': {
      const fn = params.handler as ContextHandler
      const context = {
        userId: 'user-1',
        workflowId: 'wf-1',
        executionId: meta.executionSessionId,
        executionSessionId: meta.executionSessionId,
        nodeId: meta.nodeId,
        actionType: meta.actionType,
        testMode: !!metaExtras.testMode,
        dataFlowManager: {
          resolveVariable: (v: any) => v,
        },
      }
      return fn(params.baseConfig, context)
    }
  }
}

function loggerMock() {
  // The harness mocks `@/lib/utils/logger`. Resolve the mock at call
  // time (not import time) so re-establishment on resetHarness is
  // honored.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { logger } = require('@/lib/utils/logger')
  return logger as {
    debug: jest.Mock
    info: jest.Mock
    warn: jest.Mock
    error: jest.Mock
  }
}

function stringifyArgs(args: any[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

/**
 * Append the four Q8 describe-blocks to the calling handler test file.
 * Must be called from inside an outer `describe('Q8 — safety floors',
 * () => { ... })` block so the test names group cleanly.
 */
export function runSafetyFloorChecks(params: SafetyFloorParams): void {
  // Q8a — no secrets in logs.
  test('Q8a — no tokens / secrets appear in any logger call', async () => {
    if (params.primeOutboundMocks) params.primeOutboundMocks()

    await invokeHandler(params)

    const logger = loggerMock()
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      const calls = logger[level].mock.calls as any[][]
      for (const call of calls) {
        const text = stringifyArgs(call)
        for (const secret of params.knownSecrets) {
          if (!secret) continue
          expect(text).not.toContain(secret)
        }
      }
    }
  })

  // Q8b — no customer PII at info/warn level.
  test('Q8b — no customer PII appears at info or warn level', async () => {
    if (params.primeOutboundMocks) params.primeOutboundMocks()

    await invokeHandler(params)

    const logger = loggerMock()
    for (const level of ['info', 'warn'] as const) {
      const calls = logger[level].mock.calls as any[][]
      for (const call of calls) {
        const text = stringifyArgs(call)
        for (const pii of params.knownPii) {
          if (!pii) continue
          expect(text).not.toContain(pii)
        }
      }
    }
  })

  // Q8d — testMode interception.
  test('Q8d — testMode=true returns a simulated ActionResult with no outbound call', async () => {
    params.resetOutboundMocks()
    fetchMock.resetMocks()

    const result = await invokeHandler(params, { testMode: true })

    expect(result.success).toBe(true)
    expect(result.output?.simulated).toBe(true)
    if (params.expectedProvider) {
      expect(result.output?.provider).toBe(params.expectedProvider)
    }
    expect(result.message).toMatch(/test mode/i)

    // Outbound channel: handler-specific (SDK or fetch).
    params.assertNoOutboundCalls()
    // Universal: nothing went through the fetch boundary.
    expect(fetchMock).not.toHaveBeenCalled()
  })
}
