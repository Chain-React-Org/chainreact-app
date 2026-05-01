/**
 * Contract: PR-C1b strict-mode missing-variable hard-fail.
 *
 * Source files exercised:
 *   - lib/workflows/actions/core/resolveValue.ts
 *       (resolveValueStrict, MissingVariableError)
 *   - lib/workflows/dataFlowContext.ts
 *       (DataFlowManager.resolveVariableStrict / resolveObjectStrict)
 *
 * Contract: see learning/docs/handler-contracts.md Q2.
 *
 * What this file proves (pure-function level):
 *   - `resolveValueStrict` throws `MissingVariableError` on full-template miss
 *   - `resolveValueStrict` throws on embedded miss (any unresolved {{...}})
 *   - successful resolution still returns the resolved value
 *   - recursion through arrays / objects propagates the throw
 *   - DataFlowManager strict methods throw for stateful-only paths too
 *     (`{{var.x}}`, `{{global.x}}`, `{{Node Title.Field Label}}`)
 *
 * The engine-layer wrap that converts `MissingVariableError` to the
 * standardized config-failure shape lives in `engine-missing-variable.test.ts`.
 */

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}))

import {
  resolveValue,
  resolveValueStrict,
  MissingVariableError,
} from '@/lib/workflows/actions/core/resolveValue'
import { DataFlowManager } from '@/lib/workflows/dataFlowContext'

// ─────────────────────────────────────────────────────────────────────────────
// MissingVariableError shape (Q2)
// ─────────────────────────────────────────────────────────────────────────────

describe('MissingVariableError shape', () => {
  test('is an Error subclass with code and path', () => {
    const err = new MissingVariableError('trigger.email')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(MissingVariableError)
    expect(err.code).toBe('MISSING_VARIABLE')
    expect(err.path).toBe('trigger.email')
    expect(err.name).toBe('MissingVariableError')
  })

  test('message names the missing path', () => {
    const err = new MissingVariableError('order.customer.email')
    expect(err.message).toContain('order.customer.email')
  })

  test('survives a thrown-and-caught roundtrip with instanceof check', () => {
    try {
      throw new MissingVariableError('x.y')
    } catch (err) {
      expect(err instanceof MissingVariableError).toBe(true)
      if (err instanceof MissingVariableError) {
        expect(err.code).toBe('MISSING_VARIABLE')
        expect(err.path).toBe('x.y')
      }
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// resolveValueStrict — full-template miss
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveValueStrict — full-template miss', () => {
  test('throws MissingVariableError when {{trigger.x}} not in input', () => {
    expect(() =>
      resolveValueStrict('{{trigger.email}}', {})
    ).toThrow(MissingVariableError)
  })

  test('thrown error carries the missing path', () => {
    try {
      resolveValueStrict('{{trigger.email}}', {})
      fail('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MissingVariableError)
      if (err instanceof MissingVariableError) {
        expect(err.code).toBe('MISSING_VARIABLE')
        expect(err.path).toBe('trigger.email')
      }
    }
  })

  test('throws on missing nodeId reference', () => {
    expect(() =>
      resolveValueStrict('{{action-123.subject}}', {})
    ).toThrow(MissingVariableError)
  })

  test('throws on missing single-part {{varName}}', () => {
    expect(() =>
      resolveValueStrict('{{noSuchVar}}', {})
    ).toThrow(MissingVariableError)
  })

  test('does NOT throw when the reference resolves', () => {
    expect(
      resolveValueStrict('{{trigger.email}}', { trigger: { email: 'a@b.c' } })
    ).toBe('a@b.c')
  })

  test('soft path (resolveValue) still returns undefined on the same input — strict is opt-in', () => {
    expect(resolveValue('{{trigger.email}}', {})).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// resolveValueStrict — embedded miss
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveValueStrict — embedded miss', () => {
  test('throws when an embedded {{...}} cannot be resolved', () => {
    expect(() =>
      resolveValueStrict('Hello {{trigger.name}}!', { trigger: {} })
    ).toThrow(MissingVariableError)
  })

  test('thrown error carries the missing path from the embedded reference', () => {
    try {
      resolveValueStrict('Hello {{trigger.name}}!', { trigger: {} })
      fail('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MissingVariableError)
      if (err instanceof MissingVariableError) {
        expect(err.path).toBe('trigger.name')
      }
    }
  })

  test('throws even when one of two embedded refs resolves and the other does not', () => {
    expect(() =>
      resolveValueStrict(
        '{{trigger.first}} and {{trigger.last}}',
        { trigger: { first: 'Alice' } }
      )
    ).toThrow(MissingVariableError)
  })

  test('does NOT throw when all embedded refs resolve', () => {
    expect(
      resolveValueStrict(
        'Hi {{trigger.name}}, your order is {{trigger.id}}',
        { trigger: { name: 'Bob', id: '42' } }
      )
    ).toBe('Hi Bob, your order is 42')
  })

  test('soft path (resolveValue) still preserves the literal — strict is opt-in', () => {
    expect(
      resolveValue('Hello {{trigger.name}}!', { trigger: {} })
    ).toBe('Hello {{trigger.name}}!')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// resolveValueStrict — pass-through cases (no template, primitives)
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveValueStrict — pass-through', () => {
  test('plain strings without templates pass through', () => {
    expect(resolveValueStrict('hello world', {})).toBe('hello world')
    expect(resolveValueStrict('', {})).toBe('')
  })

  test('numbers, booleans, null, undefined pass through unchanged', () => {
    expect(resolveValueStrict(42, {})).toBe(42)
    expect(resolveValueStrict(true, {})).toBe(true)
    expect(resolveValueStrict(false, {})).toBe(false)
    expect(resolveValueStrict(null, {})).toBeNull()
    expect(resolveValueStrict(undefined, {})).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// resolveValueStrict — recursion
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveValueStrict — recursion through arrays and objects', () => {
  test('throws when a missing ref hides inside an array element', () => {
    expect(() =>
      resolveValueStrict(['{{trigger.x}}', 'static'], {})
    ).toThrow(MissingVariableError)
  })

  test('throws when a missing ref hides inside an object property', () => {
    expect(() =>
      resolveValueStrict({ a: 'static', b: '{{trigger.x}}' }, {})
    ).toThrow(MissingVariableError)
  })

  test('throws when a missing ref hides inside a nested object', () => {
    expect(() =>
      resolveValueStrict({ outer: { inner: '{{trigger.x}}' } }, {})
    ).toThrow(MissingVariableError)
  })

  test('resolves all nested templates when each one is found', () => {
    const input = { trigger: { name: 'Alice', email: 'a@b.c' } }
    const config = {
      to: '{{trigger.email}}',
      subject: 'Hi {{trigger.name}}',
      attachments: ['file-1', '{{trigger.name}}-report.pdf'],
    }
    expect(resolveValueStrict(config, input)).toEqual({
      to: 'a@b.c',
      subject: 'Hi Alice',
      attachments: ['file-1', 'Alice-report.pdf'],
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DataFlowManager strict — stateful-only paths
// ─────────────────────────────────────────────────────────────────────────────

function newDfm() {
  return new DataFlowManager('exec-1', 'wf-1', 'user-1')
}

describe('DataFlowManager.resolveVariableStrict — stateful paths', () => {
  test('{{var.x}} throws when the variable is unset', () => {
    const dfm = newDfm()
    expect(() => dfm.resolveVariableStrict('{{var.missing}}')).toThrow(MissingVariableError)
    try {
      dfm.resolveVariableStrict('{{var.missing}}')
    } catch (err) {
      if (err instanceof MissingVariableError) {
        expect(err.path).toBe('var.missing')
      }
    }
  })

  test('{{var.x}} returns the value when set', () => {
    const dfm = newDfm()
    dfm.setVariable('color', 'blue')
    expect(dfm.resolveVariableStrict('{{var.color}}')).toBe('blue')
  })

  test('{{global.x}} throws when unset', () => {
    const dfm = newDfm()
    expect(() => dfm.resolveVariableStrict('{{global.workflowKey}}')).toThrow(MissingVariableError)
    try {
      dfm.resolveVariableStrict('{{global.workflowKey}}')
    } catch (err) {
      if (err instanceof MissingVariableError) {
        expect(err.path).toBe('global.workflowKey')
      }
    }
  })

  test('{{global.x}} returns the value when set', () => {
    const dfm = newDfm()
    dfm.setGlobalData('workflowKey', 'shared-state')
    expect(dfm.resolveVariableStrict('{{global.workflowKey}}')).toBe('shared-state')
  })

  test('{{nodeId.field}} throws when the node has no such field', () => {
    const dfm = newDfm()
    dfm.setNodeOutput('action-1', { success: true, data: { other: 'x' } } as any)
    expect(() =>
      dfm.resolveVariableStrict('{{action-1.email}}')
    ).toThrow(MissingVariableError)
  })

  test('{{nodeId.field}} returns the value when present', () => {
    const dfm = newDfm()
    dfm.setNodeOutput('action-1', { success: true, data: { email: 'a@b.c' } } as any)
    expect(dfm.resolveVariableStrict('{{action-1.email}}')).toBe('a@b.c')
  })

  test('{{Node Title.Field Label}} (schema-aware) throws when unresolvable', () => {
    const dfm = newDfm()
    expect(() =>
      dfm.resolveVariableStrict('{{Get Email.Body}}')
    ).toThrow(MissingVariableError)
  })

  test('{{Node Title.Field Label}} returns the value via schema lookup', () => {
    const dfm = newDfm()
    dfm.setNodeOutput('gmail-1', { success: true, data: { body: 'Hello world' } } as any)
    dfm.setNodeMetadata('gmail-1', {
      title: 'Get Email',
      type: 'gmail_get_email',
      outputSchema: [{ name: 'body', label: 'Email Body', type: 'string' }],
    })
    expect(dfm.resolveVariableStrict('{{Get Email.Email Body}}')).toBe('Hello world')
  })

  test('embedded {{var.x}} miss inside a longer string still throws', () => {
    const dfm = newDfm()
    expect(() =>
      dfm.resolveVariableStrict('Hi {{action-1.name}}!')
    ).toThrow(MissingVariableError)
  })
})

describe('DataFlowManager.resolveObjectStrict — recursion', () => {
  test('throws on the first missing reference anywhere in the tree', () => {
    const dfm = newDfm()
    dfm.setNodeOutput('action-1', { success: true, data: { name: 'Alice' } } as any)
    expect(() =>
      dfm.resolveObjectStrict({
        to: '{{action-1.name}}',         // resolves
        subject: '{{action-1.missing}}', // throws here
      })
    ).toThrow(MissingVariableError)
  })

  test('resolves the entire tree when every reference is satisfied', () => {
    const dfm = newDfm()
    dfm.setNodeOutput('action-1', {
      success: true,
      data: { name: 'Alice', email: 'a@b.c' },
    } as any)
    expect(
      dfm.resolveObjectStrict({
        to: '{{action-1.email}}',
        cc: ['{{action-1.email}}', 'static@x.com'],
        subject: 'Hi {{action-1.name}}',
        nested: { tag: '{{action-1.name}}' },
      })
    ).toEqual({
      to: 'a@b.c',
      cc: ['a@b.c', 'static@x.com'],
      subject: 'Hi Alice',
      nested: { tag: 'Alice' },
    })
  })

  test('non-string primitives (numbers, booleans, null) pass through unchanged', () => {
    const dfm = newDfm()
    expect(
      dfm.resolveObjectStrict({
        amount: 42,
        active: true,
        cancelled: false,
        deleted: null,
      })
    ).toEqual({
      amount: 42,
      active: true,
      cancelled: false,
      deleted: null,
    })
  })
})
