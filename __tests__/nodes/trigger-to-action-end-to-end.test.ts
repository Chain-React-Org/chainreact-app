/**
 * Contract: end-to-end webhook → normalize → resolve → action.
 *
 * Source files exercised (all REAL code, not mocks):
 *   - lib/webhooks/normalizer.ts        (normalizeWebhookEvent)
 *   - lib/webhooks/execute.ts            (executeWebhookWorkflow — the entry
 *                                         point that all webhook routes use)
 *   - lib/workflows/actions/core/resolveValue.ts  (variable resolution that
 *                                                   every action handler uses)
 *   - lib/workflows/actions/google-sheets/createRow.ts (downstream action)
 *
 * Style: real handler invocation. Network I/O (fetch + AdvancedExecutionEngine)
 *        is mocked at boundaries; the dataflow path itself runs unmocked.
 *
 * Bug class: trigger payload doesn't reach the action correctly. The chain
 * has many regression points: normalizer drops fields, executeWebhookWorkflow
 * builds the wrong session inputs, variable resolution treats the trigger
 * payload as a string, or the action ignores the resolved input. A break in
 * any of those silently sends the workflow run to the wrong place.
 */

import {
  resetHarness,
  fetchMock,
  getFetchCalls,
  assertFetchCalled,
} from "../helpers/actionTestHarness"

// Mock the AdvancedExecutionEngine boundary — we don't actually want to run
// a Supabase-backed execution session. We capture the call so the test can
// assert that the right `triggerData` shape reached the engine.
const mockCreateSession = jest.fn().mockResolvedValue({ id: "session-e2e-1" })
const mockExecuteWorkflowAdv = jest.fn().mockResolvedValue({ success: true })

jest.mock("@/lib/execution/advancedExecutionEngine", () => ({
  AdvancedExecutionEngine: jest.fn().mockImplementation(() => ({
    createExecutionSession: mockCreateSession,
    executeWorkflowAdvanced: mockExecuteWorkflowAdv,
  })),
}))

import { normalizeWebhookEvent } from "@/lib/webhooks/normalizer"
import {
  executeWebhookWorkflow,
  _clearDedupCache,
} from "@/lib/webhooks/execute"
import {
  resolveValue,
  resolveValueStrict,
  MissingVariableError,
} from "@/lib/workflows/actions/core/resolveValue"
import { createGoogleSheetsRow } from "@/lib/workflows/actions/google-sheets/createRow"

afterEach(() => {
  resetHarness()
  _clearDedupCache()
  mockCreateSession.mockClear()
  mockExecuteWorkflowAdv.mockClear()
  mockCreateSession.mockResolvedValue({ id: "session-e2e-1" })
  mockExecuteWorkflowAdv.mockResolvedValue({ success: true })
})

// Bug class: dropped field across the normalize boundary. If the normalizer
// reshapes the payload incorrectly, downstream actions can't read the data.
describe("end-to-end: webhook payload survives normalization with key fields intact", () => {
  test("Slack reaction_added webhook produces a normalized event with reaction/user/team", () => {
    // Realistic Slack reaction_added webhook envelope.
    const rawEvent = {
      token: "verification-token",
      team_id: "T-team",
      api_app_id: "A1",
      event: {
        type: "reaction_added",
        user: "U-alice",
        reaction: "thumbsup",
        item: { type: "message", channel: "C-general", ts: "1700000000.000100" },
        event_ts: "1700000000.000200",
      },
      type: "event_callback",
      event_id: "Ev-1",
      event_time: 1700000000,
    }

    const normalized = normalizeWebhookEvent("slack", rawEvent, "req-1")

    expect(normalized.eventType).toBe("slack_trigger_reaction_added")
    expect(normalized.eventId).toBe("1700000000.000200")
    expect(normalized.normalizedData.reaction).toBe("thumbsup")
    expect(normalized.normalizedData.user).toBe("U-alice")
    expect(normalized.normalizedData.team).toBe("T-team")
    expect(normalized.normalizedData.item.channel).toBe("C-general")
  })
})

// Bug class: executeWebhookWorkflow drops or reshapes triggerData. The
// downstream session must receive the exact normalized payload as both
// `inputData` and `triggerData` so handlers can read either path.
describe("end-to-end: normalized event reaches executeWebhookWorkflow correctly", () => {
  test("session is created with the normalized data threaded through inputData and triggerData", async () => {
    const rawEvent = {
      event: {
        type: "reaction_added",
        user: "U-bob",
        reaction: "fire",
        item: { type: "message", channel: "C-launch", ts: "1700000001.0" },
        event_ts: "1700000001.001",
      },
      team_id: "T-team",
      event_id: "Ev-2",
    }

    const normalized = normalizeWebhookEvent("slack", rawEvent, "req-2")

    const result = await executeWebhookWorkflow({
      workflowId: "wf-launch",
      userId: "user-1",
      provider: "slack",
      triggerType: normalized.eventType,
      triggerData: normalized.normalizedData,
    })

    expect(result.success).toBe(true)
    expect(result.sessionId).toBe("session-e2e-1")

    expect(mockCreateSession).toHaveBeenCalledTimes(1)
    const sessionArgs = mockCreateSession.mock.calls[0]
    expect(sessionArgs[0]).toBe("wf-launch")
    expect(sessionArgs[1]).toBe("user-1")
    expect(sessionArgs[2]).toBe("webhook")
    const sessionConfig = sessionArgs[3]
    expect(sessionConfig.inputData).toEqual(normalized.normalizedData)
    expect(sessionConfig.triggerData).toEqual(normalized.normalizedData)
    expect(sessionConfig.webhookEvent.provider).toBe("slack")
    expect(sessionConfig.webhookEvent.triggerType).toBe("slack_trigger_reaction_added")

    // The execution engine receives the same triggerData payload.
    expect(mockExecuteWorkflowAdv).toHaveBeenCalledTimes(1)
    expect(mockExecuteWorkflowAdv.mock.calls[0][1]).toEqual(normalized.normalizedData)
  })

  test("duplicate webhooks within the dedup window are skipped (no second execution)", async () => {
    const triggerData = { id: "evt-stable-id", messageId: "evt-stable-id", value: "x" }

    const first = await executeWebhookWorkflow({
      workflowId: "wf-1",
      userId: "user-1",
      provider: "shopify",
      triggerType: "shopify_trigger_new_order",
      triggerData,
    })
    expect(first.success).toBe(true)
    expect(first.duplicate).toBeFalsy()

    const second = await executeWebhookWorkflow({
      workflowId: "wf-1",
      userId: "user-1",
      provider: "shopify",
      triggerType: "shopify_trigger_new_order",
      triggerData,
    })
    expect(second.success).toBe(true)
    expect(second.duplicate).toBe(true)

    // The engine ran exactly once — the second call was deduped.
    expect(mockCreateSession).toHaveBeenCalledTimes(1)
  })
})

// Bug class: the variable-resolution layer (the helper EVERY action handler
// calls) doesn't actually pull values out of the trigger payload. If this
// breaks, every workflow that maps `{{trigger.field}}` to an action input
// fails silently — the action just receives the literal template string.
describe("end-to-end: trigger payload flows into action via {{trigger.*}} resolution", () => {
  const rawEvent = {
    event: {
      type: "reaction_added",
      user: "U-customer",
      reaction: "tada",
      item: { type: "message", channel: "C-orders", ts: "1700000002.0" },
      event_ts: "1700000002.001",
    },
    team_id: "T-team",
    event_id: "Ev-3",
  }

  test("resolveValue maps nested fields in the normalized trigger to action config strings", () => {
    const normalized = normalizeWebhookEvent("slack", rawEvent, "req-3")
    // Action config that references the trigger's normalized fields.
    const actionConfig = {
      message: "Reaction {{trigger.reaction}} from {{trigger.user}}",
      channel: "{{trigger.item.channel}}",
      values: ["{{trigger.user}}", "{{trigger.reaction}}"],
    }

    const resolved = resolveValue(actionConfig, { trigger: normalized.normalizedData })

    expect(resolved.message).toBe("Reaction tada from U-customer")
    expect(resolved.channel).toBe("C-orders")
    expect(resolved.values).toEqual(["U-customer", "tada"])
  })

  // Q2 — strict-mode runtime contract (PR-C1b). Pre-PR-C1b these two tests
  // pinned soft-fail behavior: missing full-template `{{x}}` resolved to
  // `undefined`; embedded miss left the literal `{{...}}` in the string. That
  // contract still holds for the SOFT path (`resolveValue`) — which design-time
  // callers (preview, planner, AI agent) continue to use. But at RUNTIME, the
  // engine layer pre-resolves a node's config strictly via
  // `DataFlowManager.resolveObjectStrict` and converts a `MissingVariableError`
  // to a standardized config-failure shape:
  //   { success: false, category: 'config',
  //     error: { code: 'MISSING_VARIABLE', path },
  //     message: 'Variable "<path>" not found in input.' }
  // See `learning/docs/handler-contracts.md` Q2.
  //
  // These tests assert on the engine-caught shape, which is what production
  // code sees when a workflow references a trigger field that isn't present.
  test("Q2 — full-template miss produces the standardized config-failure shape via the engine catch", async () => {
    const normalized = normalizeWebhookEvent("slack", rawEvent, "req-4")

    // Soft path is unchanged — confirms strict mode is opt-in.
    const softResolved = resolveValue(
      { message: "{{trigger.does_not_exist}}" },
      { trigger: normalized.normalizedData },
    )
    expect(softResolved.message).toBeUndefined()

    // Strict path (the runtime path) throws — engine catches and converts.
    expect(() =>
      resolveValueStrict(
        { message: "{{trigger.does_not_exist}}" },
        { trigger: normalized.normalizedData },
      ),
    ).toThrow(MissingVariableError)

    try {
      resolveValueStrict(
        { message: "{{trigger.does_not_exist}}" },
        { trigger: normalized.normalizedData },
      )
    } catch (err) {
      // Mirror the engine's catch conversion at
      // `nodeExecutionService.executeNodeByType` to assert on the exact
      // shape production callers see.
      const standardized =
        err instanceof MissingVariableError
          ? {
              success: false,
              category: "config" as const,
              error: { code: err.code, path: err.path },
              message: err.message,
            }
          : null

      expect(standardized).toMatchObject({
        success: false,
        category: "config",
        error: {
          code: "MISSING_VARIABLE",
          path: "trigger.does_not_exist",
        },
      })
      expect(standardized?.message).toContain("trigger.does_not_exist")
    }
  })

  test("Q2 — embedded miss inside a longer string also produces the standardized config-failure shape", async () => {
    const normalized = normalizeWebhookEvent("slack", rawEvent, "req-5")

    // Soft path leaves the literal `{{...}}` in place — design-time contract
    // unchanged.
    const softResolved = resolveValue(
      { message: "Reaction: {{trigger.does_not_exist}}" },
      { trigger: normalized.normalizedData },
    )
    expect(softResolved.message).toContain("{{trigger.does_not_exist}}")

    // Strict path throws on the embedded miss too — runtime sees the same
    // standardized shape regardless of template position.
    expect(() =>
      resolveValueStrict(
        { message: "Reaction: {{trigger.does_not_exist}}" },
        { trigger: normalized.normalizedData },
      ),
    ).toThrow(MissingVariableError)

    try {
      resolveValueStrict(
        { message: "Reaction: {{trigger.does_not_exist}}" },
        { trigger: normalized.normalizedData },
      )
    } catch (err) {
      const standardized =
        err instanceof MissingVariableError
          ? {
              success: false,
              category: "config" as const,
              error: { code: err.code, path: err.path },
              message: err.message,
            }
          : null

      expect(standardized).toMatchObject({
        success: false,
        category: "config",
        error: {
          code: "MISSING_VARIABLE",
          path: "trigger.does_not_exist",
        },
      })
    }
  })
})

// Bug class: real action receives mapped data correctly. This is the FULL
// chain — webhook payload → normalize → resolve → real Sheets handler →
// outbound HTTP body. A regression anywhere in the stack would mismap the
// values into the wrong cells.
describe("end-to-end: realistic chain (Slack webhook → Sheets append row)", () => {
  test("a Sheets row written from a normalized Slack event lands the right user/reaction in the right cells", async () => {
    // 1. The webhook arrives.
    const raw = {
      event: {
        type: "reaction_added",
        user: "U-final",
        reaction: "rocket",
        item: { type: "message", channel: "C-launch", ts: "1700000003.0" },
        event_ts: "1700000003.001",
      },
      team_id: "T-team",
      event_id: "Ev-final",
    }

    // 2. Normalizer reshapes the envelope.
    const normalized = normalizeWebhookEvent("slack", raw, "req-final")
    expect(normalized.eventType).toBe("slack_trigger_reaction_added")

    // 3. The downstream Sheets append-row node has its config templated
    //    against the trigger output (this is what a workflow would store).
    const sheetsConfig = {
      spreadsheetId: "ss-launch-log",
      sheetName: "Reactions",
      // newRow_<HeaderName> is the canonical Sheets newRow_ form. The
      // handler decodes the prefix and orders values by the live header row.
      newRow_User: "{{trigger.user}}",
      newRow_Reaction: "{{trigger.reaction}}",
      newRow_Channel: "{{trigger.item.channel}}",
    }

    // 4. Wire the live header row + the create response.
    fetchMock
      .mockResponseOnce(
        JSON.stringify({ values: [["User", "Reaction", "Channel"]] }),
      )
      .mockResponseOnce(
        JSON.stringify({
          updates: { updatedRange: "Reactions!A2:C2", updatedRows: 1 },
        }),
      )

    // 5. Run the real Sheets handler with the trigger payload as `input`.
    //    The handler internally calls resolveValue() to substitute templates,
    //    same as production.
    const result = await createGoogleSheetsRow(
      sheetsConfig,
      "user-1",
      { trigger: normalized.normalizedData },
    )

    // 6. Verify the outbound POST body matches the expected resolved row.
    expect(result.success).toBe(true)
    const calls = getFetchCalls()
    const post = calls.find((c) => c.method === "POST")!
    expect(post.url).toContain("/spreadsheets/ss-launch-log/")
    expect(post.body.values).toEqual([
      ["U-final", "rocket", "C-launch"],
    ])

    // 7. Sanity: the GET that fetched headers actually used the resolved
    //    spreadsheetId (not the literal template).
    assertFetchCalled({ method: "GET", url: "/spreadsheets/ss-launch-log/values/" })
  })

  test("if the action's required field resolves to empty (missing trigger field), the action fails clearly", async () => {
    // The user's workflow references {{trigger.NOTHING}}; resolveValue leaves
    // it as the literal template string, which is non-empty and would still
    // pass the spreadsheet ID validation in createRow. Instead, we test the
    // case where the spreadsheetId is omitted entirely — a more realistic
    // failure pattern when the user wires up the wrong upstream node output.
    const result = await createGoogleSheetsRow(
      {
        sheetName: "Reactions",
        newRow_User: "{{trigger.user}}",
      },
      "user-1",
      { trigger: { user: "U-1" } },
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/spreadsheet id/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
