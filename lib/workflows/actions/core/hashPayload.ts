/**
 * Canonical payload hashing for within-session idempotency (PR-C4, Q4).
 *
 * `hashPayload` SHA-256s a stable-stringified canonical form of an
 * action handler's resolved input. Two payloads with the same logical
 * content — independent of object-key insertion order — must hash to
 * the same value.
 *
 * Used by:
 *   - `checkReplay(key, payloadHash)` → compare incoming payload vs
 *     the stored hash on a prior `recordFired`.
 *   - `recordFired(key, result, payloadHash, ...)` → persisted in
 *     `session_side_effects.payload_hash` (NOT NULL).
 *
 * Canonicalization rules:
 *   - Object keys are sorted alphabetically (recursively).
 *   - Array order is PRESERVED — order matters semantically (e.g.
 *     `to: ["a@x", "b@x"]` is a different recipient list from
 *     `to: ["b@x", "a@x"]` in some providers' delivery semantics).
 *   - `undefined` values inside objects are dropped (matches JSON.stringify).
 *   - `null`, `0`, `false`, `""` are preserved (Q5 contract).
 *   - Non-finite numbers (NaN / Infinity) are coerced to null (matches
 *     JSON.stringify behavior).
 *   - Cyclic structures throw — handler input should never contain cycles.
 *
 * Contract: see `learning/docs/handler-contracts.md` Q4 and
 * `learning/docs/session-side-effects-design.md` §6.2.
 */

import { createHash } from 'crypto'

/**
 * Stable-stringify with recursively sorted object keys. Mirrors the
 * canonical-form contract above.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(toCanonical(value))
}

function toCanonical(value: unknown): unknown {
  if (value === null) return null
  if (typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return null
    return value
  }
  if (Array.isArray(value)) {
    return value.map(toCanonical)
  }
  // Plain object — sort keys.
  const obj = value as Record<string, unknown>
  const sortedKeys = Object.keys(obj).sort()
  const out: Record<string, unknown> = {}
  for (const k of sortedKeys) {
    const v = obj[k]
    if (v === undefined) continue
    out[k] = toCanonical(v)
  }
  return out
}

/**
 * SHA-256 (hex) of the canonical-form serialization of `input`.
 * Stable across engine restarts — the same input always hashes to the
 * same value, regardless of property-insertion order.
 */
export function hashPayload(input: unknown): string {
  const canonical = canonicalize(input)
  return createHash('sha256').update(canonical).digest('hex')
}
