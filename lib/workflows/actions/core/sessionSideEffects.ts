/**
 * Within-session idempotency registry (PR-C4, Q4).
 *
 * Two functions, both keyed on `SideEffectKey`
 * `(executionSessionId, nodeId, actionType)`:
 *
 *   - `checkReplay(key, payloadHash)` — atomic read of any prior row.
 *     Returns `{kind: 'fresh'}` (no row, fire normally),
 *     `{kind: 'cached', result}` (matching hash, return cached
 *     ActionResult and skip the provider call), or
 *     `{kind: 'mismatch', storedHash}` (different hash, handler must
 *     return PAYLOAD_MISMATCH).
 *
 *   - `recordFired(key, result, payloadHash, options?)` — write the
 *     marker after a successful first fire. Idempotent on its own:
 *     a UNIQUE-violation is caught and treated as already-recorded,
 *     so a concurrent fire that loses the unique-constraint race
 *     doesn't error.
 *
 * Both calls go through the service-role admin client. Failures are
 * conservative:
 *   - `checkReplay` failure → returns `{kind: 'fresh'}` (fire
 *     normally — better to risk a duplicate than to wedge the run).
 *     Logged at error level.
 *   - `recordFired` failure → swallowed with an error log, NOT
 *     re-thrown. The provider call already succeeded; rolling it
 *     back is impossible (design doc §4.3).
 *
 * Failed previous fires (rows where `result_snapshot.success === false`)
 * are NOT written by `recordFired` — handlers only call it on success.
 * A retry after a failed first attempt therefore sees `{kind: 'fresh'}`
 * and re-attempts the provider call, as intended.
 *
 * Contract: see `learning/docs/handler-contracts.md` Q4 and
 * `learning/docs/session-side-effects-design.md` §3.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/utils/logger'
import type { ActionResult } from './executeWait'
import type { SideEffectKey } from './idempotencyKey'

const TABLE = 'session_side_effects'

export type ReplayOutcome =
  | { kind: 'fresh' }
  | { kind: 'cached'; result: ActionResult }
  | { kind: 'mismatch'; storedHash: string }

export interface RecordFiredOptions {
  externalId?: string | null
  provider?: string
  /**
   * Optional Supabase client. Defaults to the admin client. Tests
   * inject a stub.
   */
  supabase?: any
}

export interface CheckReplayOptions {
  supabase?: any
}

/**
 * Atomically read the existing marker for `key` and compare its
 * stored hash to `payloadHash`. See `ReplayOutcome` for the three
 * exhaustive return shapes.
 */
export async function checkReplay(
  key: SideEffectKey,
  payloadHash: string,
  options: CheckReplayOptions = {},
): Promise<ReplayOutcome> {
  try {
    const supabase = options.supabase ?? createAdminClient()
    const { data, error } = await supabase
      .from(TABLE)
      .select('payload_hash, result_snapshot')
      .eq('execution_session_id', key.executionSessionId)
      .eq('node_id', key.nodeId)
      .eq('action_type', key.actionType)
      .maybeSingle()

    if (error) {
      logger.error(
        '[sessionSideEffects.checkReplay] DB read failed; falling back to fresh',
        { error: error.message, key },
      )
      return { kind: 'fresh' }
    }

    if (!data) return { kind: 'fresh' }

    if (data.payload_hash !== payloadHash) {
      return { kind: 'mismatch', storedHash: data.payload_hash }
    }

    return { kind: 'cached', result: data.result_snapshot as ActionResult }
  } catch (err: any) {
    logger.error(
      '[sessionSideEffects.checkReplay] threw; falling back to fresh',
      { error: err?.message, key },
    )
    return { kind: 'fresh' }
  }
}

/**
 * Record a successful side effect. UNIQUE-violation on the
 * (executionSessionId, nodeId, actionType) tuple is treated as
 * already-recorded — the row from the first fire wins, this call is
 * a no-op. All other DB errors are logged but NOT re-thrown: the
 * provider call already succeeded, so failing the handler here would
 * cause the next replay to re-fire the side effect (worse than the
 * lost record).
 */
export async function recordFired(
  key: SideEffectKey,
  result: ActionResult,
  payloadHash: string,
  options: RecordFiredOptions = {},
): Promise<void> {
  try {
    const supabase = options.supabase ?? createAdminClient()
    const provider =
      options.provider ?? deriveProviderFromActionType(key.actionType)

    const row = {
      execution_session_id: key.executionSessionId,
      node_id: key.nodeId,
      action_type: key.actionType,
      provider,
      external_id: options.externalId ?? null,
      result_snapshot: result,
      payload_hash: payloadHash,
    }

    const { error } = await supabase.from(TABLE).insert(row)

    if (error) {
      // Postgres UNIQUE-violation: SQLSTATE 23505. Supabase surfaces this
      // as `code: '23505'` on the error object. Treat as already-recorded.
      const code = (error as any)?.code
      if (code === '23505') {
        logger.debug(
          '[sessionSideEffects.recordFired] row already exists (UNIQUE) — treating as no-op',
          { key },
        )
        return
      }
      logger.error('[sessionSideEffects.recordFired] DB write failed', {
        error: error.message,
        code,
        key,
      })
    }
  } catch (err: any) {
    logger.error('[sessionSideEffects.recordFired] threw', {
      error: err?.message,
      key,
    })
  }
}

/**
 * Best-effort provider extraction from an action type identifier.
 * `gmail_action_send_email` → `gmail`, `stripe_action_create_payment_intent`
 * → `stripe`, etc. Falls back to `'unknown'` for unrecognized shapes.
 *
 * Callers can override via `options.provider` when they have direct
 * knowledge (e.g. the handler already loaded the integration row).
 */
function deriveProviderFromActionType(actionType: string): string {
  const idx = actionType.indexOf('_')
  if (idx <= 0) return actionType || 'unknown'
  return actionType.slice(0, idx)
}
