/**
 * Contract: PR-C1b engine-layer missing-variable hard-fail.
 *
 * Source files exercised:
 *   - lib/services/nodeExecutionService.ts
 *       (executeNodeByType pre-resolves node config strictly via
 *        DataFlowManager.resolveObjectStrict, catches MissingVariableError,
 *        returns the standardized config-failure shape)
 *
 * Contract: see learning/docs/handler-contracts.md Q2.
 *
 * What this file proves:
 *   - Action dispatch (line 297): pre-resolution failure produces the
 *     standardized shape and `actionHandlers.execute` is NOT invoked.
 *   - Integration dispatch (line 301): same — pre-resolution failure
 *     short-circuits and `integrationHandlers.execute` is NOT invoked.
 *   - Trigger nodes are NOT pre-resolved (triggers source data; they don't
 *     consume {{...}} references) — `triggerHandlers.execute` runs even
 *     when config has unresolvable templates.
 *   - When `context.dataFlowManager` is absent, pre-resolution is skipped —
 *     the handler runs with the raw, unresolved config.
 *   - Happy path: when all variables resolve, the resolved config is passed
 *     to the handler.
 *
 * The handler classes are mocked at the constructor level so this test
 * exercises ONLY engine-layer logic without pulling in the full
 * integration / handler import graph (which transitively loads
 * `server-only` and other Next.js / Supabase modules).
 */

jest.mock('server-only', () => ({}))

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}))

jest.mock('@/lib/services/executionHistoryService', () => ({
  executionHistoryService: {
    recordStep: jest.fn().mockResolvedValue(undefined),
    completeStep: jest.fn().mockResolvedValue(undefined),
    pauseStep: jest.fn().mockResolvedValue(undefined),
  },
}))

// Replace the three handler dispatchers with thin mocks. The engine logic
// under test happens BEFORE these are called; the test asserts on:
//   1. Pre-resolution failure: the mock is NOT invoked, the engine returned
//      the standardized config-failure shape.
//   2. Pre-resolution success: the mock IS invoked with the resolved config,
//      and the engine returned whatever the mock returned.
const mockActionExecute = jest.fn()
const mockIntegrationExecute = jest.fn()
const mockTriggerExecute = jest.fn()

jest.mock('@/lib/services/executionHandlers/actionHandlers', () => ({
  ActionNodeHandlers: jest.fn().mockImplementation(() => ({
    execute: mockActionExecute,
  })),
}))

jest.mock('@/lib/services/executionHandlers/integrationHandlers', () => ({
  IntegrationNodeHandlers: jest.fn().mockImplementation(() => ({
    execute: mockIntegrationExecute,
  })),
}))

jest.mock('@/lib/services/executionHandlers/triggerHandlers', () => ({
  TriggerNodeHandlers: jest.fn().mockImplementation(() => ({
    execute: mockTriggerExecute,
  })),
}))

// Lightweight mock for the node registry so executeNode's setNodeMetadata
// call doesn't load the entire provider graph.
jest.mock('@/lib/workflows/nodes', () => ({
  ALL_NODE_COMPONENTS: [],
}))

import { NodeExecutionService } from '@/lib/services/nodeExecutionService'
import { createDataFlowManager } from '@/lib/workflows/dataFlowContext'
import type { ExecutionContext } from '@/lib/services/workflowExecutionService'

function buildContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  const dfm = createDataFlowManager('exec-test', 'wf-test', 'user-test')
  return {
    userId: 'user-test',
    workflowId: 'wf-test',
    testMode: false,
    data: {},
    variables: {},
    results: {},
    dataFlowManager: dfm,
    ...overrides,
  } as ExecutionContext
}

beforeEach(() => {
  mockActionExecute.mockReset().mockResolvedValue({ success: true, output: { ran: 'action' } })
  mockIntegrationExecute.mockReset().mockResolvedValue({ success: true, output: { ran: 'integration' } })
  mockTriggerExecute.mockReset().mockResolvedValue({ success: true, output: { ran: 'trigger' } })
})

// ─────────────────────────────────────────────────────────────────────────────
// Action dispatch (line 297) — `filter` is a representative action node type
// ─────────────────────────────────────────────────────────────────────────────

describe('engine-layer missing variable — action dispatch (line 297)', () => {
  test('full-template miss in action config returns the standardized shape; actionHandlers.execute is NOT invoked', async () => {
    const service = new NodeExecutionService()
    const node = {
      id: 'filter-1',
      data: {
        type: 'filter',
        config: { condition: '{{trigger.email}}' },
      },
    }
    const context = buildContext()

    const result = await service.executeNode(node, [node], [], context)

    expect(result).toMatchObject({
      success: false,
      category: 'config',
      error: { code: 'MISSING_VARIABLE', path: 'trigger.email' },
    })
    expect(typeof result.message).toBe('string')
    expect(result.message).toContain('trigger.email')
    expect(mockActionExecute).not.toHaveBeenCalled()
  })

  test('embedded miss in action config produces the standardized shape; handler still NOT invoked', async () => {
    const service = new NodeExecutionService()
    const node = {
      id: 'filter-2',
      data: {
        type: 'filter',
        config: { condition: 'value is {{trigger.email}}' },
      },
    }
    const context = buildContext()

    const result = await service.executeNode(node, [node], [], context)

    expect(result.success).toBe(false)
    expect(result.category).toBe('config')
    expect(result.error?.code).toBe('MISSING_VARIABLE')
    expect(result.error?.path).toBe('trigger.email')
    expect(mockActionExecute).not.toHaveBeenCalled()
  })

  test('happy path — all refs resolve; handler receives the resolved config', async () => {
    const service = new NodeExecutionService()
    const node = {
      id: 'filter-3',
      data: {
        type: 'filter',
        config: { condition: 'Hello {{trigger.name}}' },
      },
    }
    const context = buildContext()
    context.dataFlowManager.setNodeOutput('trigger', {
      success: true,
      data: { name: 'Alice' },
    } as any)

    const result = await service.executeNode(node, [node], [], context)

    // Engine returned the handler's mock result, not a config failure.
    expect(result.success).toBe(true)
    expect(result.output?.ran).toBe('action')

    // Handler was invoked exactly once with the RESOLVED config.
    expect(mockActionExecute).toHaveBeenCalledTimes(1)
    const passedNode = mockActionExecute.mock.calls[0][0]
    expect(passedNode.data.config.condition).toBe('Hello Alice')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Integration dispatch (line 301) — gmail_action_send_email matches the
// `gmail_` prefix in `isIntegrationNode`. Most production handlers flow
// through this dispatch path.
// ─────────────────────────────────────────────────────────────────────────────

describe('engine-layer missing variable — integration dispatch (line 301)', () => {
  test('full-template miss in integration config returns the standardized shape; integrationHandlers.execute is NOT invoked', async () => {
    const service = new NodeExecutionService()
    const node = {
      id: 'gmail-1',
      data: {
        type: 'gmail_action_send_email',
        config: {
          to: '{{trigger.email}}',
          subject: 'hi',
          body: 'hello',
        },
      },
    }
    const context = buildContext()

    const result = await service.executeNode(node, [node], [], context)

    expect(result).toMatchObject({
      success: false,
      category: 'config',
      error: { code: 'MISSING_VARIABLE', path: 'trigger.email' },
    })
    expect(mockIntegrationExecute).not.toHaveBeenCalled()
  })

  test('embedded miss in integration config (body) also short-circuits with the standardized shape', async () => {
    const service = new NodeExecutionService()
    const node = {
      id: 'gmail-2',
      data: {
        type: 'gmail_action_send_email',
        config: {
          to: 'static@example.com',
          subject: 'hi',
          body: 'Hello {{trigger.firstName}}',
        },
      },
    }
    const context = buildContext()

    const result = await service.executeNode(node, [node], [], context)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('MISSING_VARIABLE')
    expect(result.error?.path).toBe('trigger.firstName')
    expect(mockIntegrationExecute).not.toHaveBeenCalled()
  })

  test('happy path — all refs resolve; handler receives the resolved config', async () => {
    const service = new NodeExecutionService()
    const node = {
      id: 'gmail-3',
      data: {
        type: 'gmail_action_send_email',
        config: {
          to: '{{trigger.email}}',
          subject: 'Hi {{trigger.firstName}}',
          body: 'hello',
        },
      },
    }
    const context = buildContext()
    context.dataFlowManager.setNodeOutput('trigger', {
      success: true,
      data: { email: 'a@b.c', firstName: 'Alice' },
    } as any)

    const result = await service.executeNode(node, [node], [], context)

    expect(result.success).toBe(true)
    expect(mockIntegrationExecute).toHaveBeenCalledTimes(1)
    const passedNode = mockIntegrationExecute.mock.calls[0][0]
    expect(passedNode.data.config.to).toBe('a@b.c')
    expect(passedNode.data.config.subject).toBe('Hi Alice')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// What is NOT pre-resolved
// ─────────────────────────────────────────────────────────────────────────────

describe('engine-layer missing variable — paths that bypass pre-resolution', () => {
  test('trigger nodes are not strictly pre-resolved; the trigger handler runs even with unresolvable templates in config', async () => {
    const service = new NodeExecutionService()
    const node = {
      id: 'trigger-1',
      data: {
        type: 'manual',
        config: { someField: '{{trigger.email}}' },
      },
    }
    const context = buildContext()

    const result = await service.executeNode(node, [node], [], context)

    // Trigger handler ran — engine did NOT short-circuit with config-failure.
    expect(mockTriggerExecute).toHaveBeenCalledTimes(1)
    expect(result?.error?.code).not.toBe('MISSING_VARIABLE')
  })

  test('with no dataFlowManager, pre-resolution is skipped; handler runs with the raw, unresolved config', async () => {
    const service = new NodeExecutionService()
    const node = {
      id: 'filter-no-dfm',
      data: {
        type: 'filter',
        config: { condition: '{{trigger.email}}' },
      },
    }
    const context = buildContext({ dataFlowManager: undefined as any })

    const result = await service.executeNode(node, [node], [], context)

    // Engine did NOT emit a missing-variable failure. Handler was invoked.
    expect(mockActionExecute).toHaveBeenCalledTimes(1)
    expect(result?.error?.code).not.toBe('MISSING_VARIABLE')

    // Config was passed through unchanged because pre-resolution was skipped.
    const passedNode = mockActionExecute.mock.calls[0][0]
    expect(passedNode.data.config.condition).toBe('{{trigger.email}}')
  })
})
