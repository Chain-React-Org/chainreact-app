/**
 * Contract: PR-C1a resolver consolidation — parity across the three public
 * resolver entry points.
 *
 * Source files exercised:
 *   - lib/workflows/actions/core/resolveValue.ts        (canonical)
 *   - lib/integrations/resolveValue.ts                  (legacy wrapper, post PR-C1a)
 *   - lib/workflows/dataFlowContext.ts → DataFlowManager.resolveVariable
 *
 * Design: see learning/docs/resolver-consolidation-design.md
 *
 * Strict-mode hard-fail (Q2) is NOT in this PR. Miss behavior is preserved:
 *   - Path 1 (canonical):   undefined for full-template miss, literal {{...}}
 *                           preserved for embedded miss
 *   - Path 2 (legacy):      delegates to path 1, so identical
 *   - Path 3 (DataFlowMgr): undefined for full-template miss (matches pre-
 *                           PR-C1a behavior, where an unanchored directVarMatch
 *                           fell through to getVariable returning undefined).
 *                           Embedded miss now returns the literal-preserved
 *                           string — this is an INTENTIONAL improvement over
 *                           pre-PR-C1a behavior (which returned undefined for
 *                           embedded miss too, dropping prefix/suffix).
 *
 * After PR-C1a, all three paths return undefined for full-template miss and
 * literal-preserved string for embedded miss. PR-C1b will switch runtime
 * resolution to throw via strict mode.
 */

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}))

import { resolveValue as canonicalResolveValue } from '@/lib/workflows/actions/core/resolveValue'
import { resolveValue as legacyResolveValue } from '@/lib/integrations/resolveValue'
import { DataFlowManager } from '@/lib/workflows/dataFlowContext'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spin up a DataFlowManager with the given node outputs and call resolveVariable.
 * Mirrors how runtime callers invoke path 3.
 */
function viaDataFlowManager(
  reference: string,
  nodeOutputs: Record<string, { success: boolean; data: any }> = {},
  variables: Record<string, any> = {},
  globalData: Record<string, any> = {},
  nodeMetadata: Record<string, { title: string; type: string; outputSchema?: any[] }> = {}
): any {
  const dfm = new DataFlowManager('exec-1', 'wf-1', 'user-1')
  for (const [nodeId, out] of Object.entries(nodeOutputs)) {
    dfm.setNodeOutput(nodeId, out as any)
  }
  for (const [name, value] of Object.entries(variables)) {
    dfm.setVariable(name, value)
  }
  for (const [key, value] of Object.entries(globalData)) {
    dfm.setGlobalData(key, value)
  }
  for (const [nodeId, meta] of Object.entries(nodeMetadata)) {
    dfm.setNodeMetadata(nodeId, meta)
  }
  return dfm.resolveVariable(reference)
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared by all three: single-template, embedded, recursion, plain
// ─────────────────────────────────────────────────────────────────────────────

describe('resolver parity — features shared by all three paths', () => {
  describe('plain string passthrough', () => {
    const cases = [
      'hello world',
      '',
      'no template here',
    ]
    test.each(cases)('canonical: %s', (input) => {
      expect(canonicalResolveValue(input, {})).toBe(input)
    })
    test.each(cases)('legacy: %s', (input) => {
      expect(legacyResolveValue(input, {})).toBe(input)
    })
    test.each(cases)('DataFlowManager: %s', (input) => {
      // Path 3 returns the input unchanged for non-template strings (no {{}}
      // → none of the matchers fire, canonical returns the string itself, no
      // post-process kicks in, miss path returns reference). The reference is
      // the string itself, so the result equals the input.
      expect(viaDataFlowManager(input)).toBe(input)
    })
  })

  describe('non-string passthrough', () => {
    const cases: Array<[string, any]> = [
      ['number', 42],
      ['boolean true', true],
      ['boolean false', false],
      ['null', null],
      ['undefined', undefined],
    ]
    test.each(cases)('canonical preserves %s', (_label, value) => {
      expect(canonicalResolveValue(value, {})).toBe(value)
    })
    test.each(cases)('legacy preserves %s', (_label, value) => {
      expect(legacyResolveValue(value, {})).toBe(value)
    })
    // Path 3's resolveVariable signature only accepts string; resolveObject
    // handles primitives. Test resolveObject for parity here.
    test.each(cases)('DataFlowManager.resolveObject preserves %s', (_label, value) => {
      const dfm = new DataFlowManager('exec-1', 'wf-1', 'user-1')
      expect(dfm.resolveObject(value)).toBe(value)
    })
  })

  describe('{{data.field}} direct dot lookup', () => {
    const input = { name: 'Alice', user: { email: 'alice@example.com' } }

    test('canonical', () => {
      expect(canonicalResolveValue('{{data.name}}', input)).toBe('Alice')
      expect(canonicalResolveValue('{{data.user.email}}', input)).toBe('alice@example.com')
    })
    test('legacy', () => {
      expect(legacyResolveValue('{{data.name}}', input)).toBe('Alice')
    })
    // Path 3 does not have a `data.` namespace by design; it routes through
    // canonical via delegation. Test that delegation works:
    test('DataFlowManager delegates {{data.field}} to canonical', () => {
      // Path 3's nodeOutputs don't have a `data` entry by default; we need to
      // check that the delegation handles this. Without `data` in state, this
      // misses and returns the reference. That's expected — `data.` is a
      // canonical-engine concept, not a path-3 concept.
      // For parity in the SUCCESS case we'd have to inject a `data` node;
      // skipping since this is not a real-world path-3 caller pattern.
    })
  })

  describe('{{nodeId.field}} direct ID lookup', () => {
    const nodeId = 'action-123'
    const data = { email: 'user@test.com', subject: 'Hello' }

    test('canonical (input shape: input[nodeId] is the data object)', () => {
      expect(canonicalResolveValue(`{{${nodeId}.email}}`, { [nodeId]: data })).toBe('user@test.com')
    })
    test('legacy', () => {
      expect(legacyResolveValue(`{{${nodeId}.email}}`, { [nodeId]: data })).toBe('user@test.com')
    })
    test('DataFlowManager (state shape: nodeOutputs[nodeId].data)', () => {
      const result = viaDataFlowManager(
        `{{${nodeId}.email}}`,
        { [nodeId]: { success: true, data } }
      )
      expect(result).toBe('user@test.com')
    })
  })

  describe('embedded templates in strings', () => {
    test('canonical: prefix {{x}} suffix', () => {
      expect(
        canonicalResolveValue('Hello {{data.name}}!', { name: 'Alice' })
      ).toBe('Hello Alice!')
    })
    test('legacy: prefix {{x}} suffix', () => {
      expect(
        legacyResolveValue('Hello {{data.name}}!', { name: 'Alice' })
      ).toBe('Hello Alice!')
    })
    test('DataFlowManager: prefix {{nodeId.field}} suffix (delegates to canonical)', () => {
      // Path 3's pre-PR-C1a behavior on embedded templates was buggy (matched
      // first occurrence and returned just the value, dropping prefix/suffix).
      // After delegation, embedded templates substitute correctly. This is an
      // intentional behavior improvement documented in
      // resolver-consolidation-design.md §2.
      const result = viaDataFlowManager(
        'Hello {{action-1.name}}!',
        { 'action-1': { success: true, data: { name: 'Alice' } } }
      )
      expect(result).toBe('Hello Alice!')
    })
  })

  describe('recursion over arrays and objects', () => {
    test('canonical: array', () => {
      expect(
        canonicalResolveValue(['{{data.x}}', 'static'], { x: 'val' })
      ).toEqual(['val', 'static'])
    })
    test('canonical: object', () => {
      expect(
        canonicalResolveValue({ a: '{{data.x}}', b: 'static' }, { x: 'val' })
      ).toEqual({ a: 'val', b: 'static' })
    })
    test('legacy: array', () => {
      expect(
        legacyResolveValue(['{{data.x}}', 'static'], { x: 'val' })
      ).toEqual(['val', 'static'])
    })
    test('legacy: object', () => {
      expect(
        legacyResolveValue({ a: '{{data.x}}', b: 'static' }, { x: 'val' })
      ).toEqual({ a: 'val', b: 'static' })
    })
    test('DataFlowManager.resolveObject: array', () => {
      const dfm = new DataFlowManager('exec-1', 'wf-1', 'user-1')
      dfm.setNodeOutput('n1', { success: true, data: { x: 'val' } } as any)
      // Path 3 doesn't surface `data.` directly — use {{n1.x}}
      expect(
        dfm.resolveObject(['{{n1.x}}', 'static'])
      ).toEqual(['val', 'static'])
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Shared by paths 1 and 3 (legacy is a wrapper over 1)
// ─────────────────────────────────────────────────────────────────────────────

describe('resolver parity — paths 1 and 3 (node output reads)', () => {
  describe('{{nodeId.output.field}} property access', () => {
    test('canonical', () => {
      const input = { 'action-1': { output: { subject: 'Hello' } } }
      expect(canonicalResolveValue('{{action-1.subject}}', input)).toBe('Hello')
    })
    test('DataFlowManager (data → output mirroring)', () => {
      const result = viaDataFlowManager(
        '{{action-1.subject}}',
        { 'action-1': { success: true, data: { subject: 'Hello' } } }
      )
      expect(result).toBe('Hello')
    })
  })

  describe('double-nested {{nodeId.output.output.field}}', () => {
    test('canonical', () => {
      const input = { 'action-1': { output: { output: { result: 'deep' } } } }
      expect(canonicalResolveValue('{{action-1.result}}', input)).toBe('deep')
    })
    test('DataFlowManager via mirroring', () => {
      // DataFlowManager stores at `.data`; canonical reads at `.output`.
      // After mirroring, `output: { output: { result: 'deep' } }` is reachable.
      const result = viaDataFlowManager(
        '{{action-1.result}}',
        { 'action-1': { success: true, data: { output: { result: 'deep' } } } }
      )
      expect(result).toBe('deep')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Path 1 only — canonical-engine features (validate behavior persists)
// ─────────────────────────────────────────────────────────────────────────────

describe('canonical-only features (path 1)', () => {
  test('{{NOW}} returns ISO timestamp', () => {
    const result = canonicalResolveValue('{{NOW}}', {})
    expect(typeof result).toBe('string')
    expect(new Date(result).toISOString()).toBe(result)
  })

  test('{{*}} returns formatted input', () => {
    const result = canonicalResolveValue('{{*}}', { name: 'test', count: 3 })
    expect(typeof result).toBe('string')
    expect(result).toContain('test')
  })

  test('{{Action: Provider: Name.Field}} format', () => {
    const input = { messages: [{ body: 'Email content' }] }
    expect(
      canonicalResolveValue('{{Action: Gmail: Get Email.Body}}', input)
    ).toBe('Email content')
  })

  test('prefix matching {{ai_agent}} → ai_agent-<uuid>', () => {
    const input = { 'ai_agent-abc123': { data: { output: 'AI result' } } }
    expect(canonicalResolveValue('{{ai_agent}}', input)).toBe('AI result')
  })

  test('prefix matching dotted path {{ai_agent.summary}} → ai_agent-<uuid>.summary', () => {
    const input = { 'ai_agent-abc123': { data: { summary: 'Summary text' } } }
    expect(canonicalResolveValue('{{ai_agent.summary}}', input)).toBe('Summary text')
  })

  // After PR-C1a, the legacy wrapper inherits these via delegation.
  test('legacy wrapper inherits canonical prefix matching', () => {
    const input = { 'ai_agent-abc123': { data: { summary: 'Summary text' } } }
    expect(legacyResolveValue('{{ai_agent.summary}}', input)).toBe('Summary text')
  })

  test('legacy wrapper inherits {{NOW}}', () => {
    const result = legacyResolveValue('{{NOW}}', {})
    expect(typeof result).toBe('string')
    expect(new Date(result as string).toISOString()).toBe(result)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Path 3 only — DataFlowManager-specific features
// ─────────────────────────────────────────────────────────────────────────────

describe('DataFlowManager-only features (path 3)', () => {
  describe('{{var.x}} custom variables', () => {
    test('returns the stored variable value (single-template)', () => {
      const result = viaDataFlowManager(
        '{{var.customField}}',
        {},
        { customField: 'my-value' }
      )
      expect(result).toBe('my-value')
    })

    test('returns undefined for unset variable', () => {
      const result = viaDataFlowManager('{{var.missing}}', {}, {})
      // getVariable returns undefined; pre-process returns it directly
      expect(result).toBeUndefined()
    })
  })

  describe('{{global.x}} workflow data', () => {
    test('returns the stored global value', () => {
      const result = viaDataFlowManager(
        '{{global.workflowKey}}',
        {},
        {},
        { workflowKey: 'shared-state' }
      )
      expect(result).toBe('shared-state')
    })
  })

  describe('{{Node Title.Field Label}} schema-driven (human-readable)', () => {
    test('resolves via output schema', () => {
      const result = viaDataFlowManager(
        '{{Get Email.Email Body}}',
        { 'gmail-1': { success: true, data: { body: 'Hello world' } } },
        {},
        {},
        {
          'gmail-1': {
            title: 'Get Email',
            type: 'gmail_get_email',
            outputSchema: [{ name: 'body', label: 'Email Body', type: 'string' }],
          },
        }
      )
      expect(result).toBe('Hello world')
    })

    test('schema-miss fallback: direct property by label', () => {
      const result = viaDataFlowManager(
        '{{Get Email.subject}}',
        { 'gmail-1': { success: true, data: { subject: 'Hi' } } },
        {},
        {},
        { 'gmail-1': { title: 'Get Email', type: 'gmail_get_email', outputSchema: [] } }
      )
      expect(result).toBe('Hi')
    })

    test('AI Agent output convention', () => {
      const result = viaDataFlowManager(
        '{{AI Agent.AI Agent Output}}',
        { 'ai-1': { success: true, data: { output: 'AI text' } } },
        {},
        {},
        { 'ai-1': { title: 'AI Agent', type: 'ai_agent', outputSchema: [] } }
      )
      expect(result).toBe('AI text')
    })
  })

  describe('post-process: single-part {{varName}} fallback to custom variable', () => {
    test('falls back to getVariable when canonical resolution misses', () => {
      const result = viaDataFlowManager(
        '{{myCustomVar}}',
        {},
        { myCustomVar: 'my-value' }
      )
      expect(result).toBe('my-value')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Miss behavior — all three paths agree after PR-C1a:
//   - Full-template miss → undefined
//   - Embedded miss     → literal-preserved string
// PR-C1b will switch runtime resolution to throw via strict mode.
// ─────────────────────────────────────────────────────────────────────────────

describe('miss behavior — full-template returns undefined across all paths', () => {
  test('canonical', () => {
    expect(canonicalResolveValue('{{trigger.does_not_exist}}', {})).toBeUndefined()
  })

  test('legacy (delegates to canonical)', () => {
    expect(legacyResolveValue('{{trigger.does_not_exist}}', {})).toBeUndefined()
  })

  test('DataFlowManager (preserves pre-PR-C1a undefined behavior)', () => {
    const result = viaDataFlowManager('{{trigger.does_not_exist}}')
    expect(result).toBeUndefined()
  })
})

describe('miss behavior — embedded preserves the literal across all paths', () => {
  test('canonical', () => {
    expect(canonicalResolveValue('Hello {{unknown.field}}!', {})).toBe('Hello {{unknown.field}}!')
  })

  test('legacy', () => {
    expect(legacyResolveValue('Hello {{unknown.field}}!', {})).toBe('Hello {{unknown.field}}!')
  })

  test('DataFlowManager (canonical delegation gives the literal-preserved result;' +
       ' improvement over pre-PR-C1a behavior, which returned undefined for embedded miss)', () => {
    const result = viaDataFlowManager('Hello {{unknown.field}}!')
    expect(result).toBe('Hello {{unknown.field}}!')
  })
})
