/**
 * Contract: uploadGoogleDriveFile
 * Source: lib/workflows/actions/googleDrive/uploadFile.ts
 * Style: real handler invocation; the harness mocks the googleapis SDK.
 *        Tests use the inline-base64 `sourceType: 'node'` path so we exercise
 *        the upload pipeline without touching FileStorageService or storage.
 *
 * Bug class: wrong file destination, wrong MIME conversion, silent share
 * drop. Drive uploads can quietly land in the wrong folder, fail to
 * convert to a Google Doc when the user asked, or skip sharing — none of
 * which produce a workflow-level error.
 */

import {
  resetHarness,
  setMockToken,
  mockDriveApi,
  setMockTokenRefreshOutcome,
  getHealthEngineCalls,
  setSessionReplayOutcome,
  getSessionRecordCalls,
} from "../helpers/actionTestHarness"

import { uploadGoogleDriveFile } from "@/lib/workflows/actions/googleDrive/uploadFile"

afterEach(() => {
  resetHarness()
})

function makeInlineFile(content: string, filename = "doc.txt", mimeType = "text/plain") {
  return {
    file: {
      content: Buffer.from(content).toString("base64"),
      filename,
      mimeType,
    },
  }
}

// Bug class: wrong destination — uploading to root instead of the user's
// chosen folder, or naming the file incorrectly.
describe("uploadGoogleDriveFile — happy path", () => {
  test("creates a file with name + parent folder + mimeType from inline node input", async () => {
    mockDriveApi.files.create.mockResolvedValue({
      data: {
        id: "file-123",
        name: "doc.txt",
        mimeType: "text/plain",
        webViewLink: "https://drive.google.com/file/d/file-123/view",
        webContentLink: "https://drive.google.com/dl/file-123",
        parents: ["folder-x"],
        size: "5",
      },
    })

    const result = await uploadGoogleDriveFile(
      {
        sourceType: "node",
        fileFromNode: makeInlineFile("hello"),
        folderId: "folder-x",
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(true)
    expect(mockDriveApi.files.create).toHaveBeenCalledTimes(1)
    const call = mockDriveApi.files.create.mock.calls[0][0]
    expect(call.requestBody.name).toBe("doc.txt")
    expect(call.requestBody.parents).toEqual(["folder-x"])
    expect(call.media.mimeType).toBe("text/plain")
  })

  test("does NOT set parents when folderId is omitted (file lands in My Drive root)", async () => {
    mockDriveApi.files.create.mockResolvedValue({
      data: { id: "f", name: "doc.txt" },
    })

    await uploadGoogleDriveFile(
      { sourceType: "node", fileFromNode: makeInlineFile("hi") },
      "user-1",
      {},
    )

    const call = mockDriveApi.files.create.mock.calls[0][0]
    expect(call.requestBody.parents).toBeUndefined()
  })
})

// Bug class: convertToGoogleDocs silently ignored — user asked Drive to
// convert their .docx to a Google Doc but the upload landed as a raw
// .docx blob, breaking downstream "edit in Docs" workflows.
describe("uploadGoogleDriveFile — Google Docs conversion", () => {
  test("rewrites mimeType to Google Doc when convertToGoogleDocs=true and source is text/plain", async () => {
    mockDriveApi.files.create.mockResolvedValue({ data: { id: "f" } })

    await uploadGoogleDriveFile(
      {
        sourceType: "node",
        fileFromNode: makeInlineFile("hi", "notes.txt", "text/plain"),
        convertToGoogleDocs: true,
      },
      "user-1",
      {},
    )

    const call = mockDriveApi.files.create.mock.calls[0][0]
    // The requestBody mimeType becomes the Google Doc MIME so Drive performs
    // the conversion server-side; the upload-stream mimeType stays text/plain.
    expect(call.requestBody.mimeType).toBe("application/vnd.google-apps.document")
    expect(call.media.mimeType).toBe("text/plain")
  })

  test("rewrites mimeType to Google Sheet when source is text/csv", async () => {
    mockDriveApi.files.create.mockResolvedValue({ data: { id: "f" } })

    await uploadGoogleDriveFile(
      {
        sourceType: "node",
        fileFromNode: makeInlineFile("a,b\n1,2", "data.csv", "text/csv"),
        convertToGoogleDocs: true,
      },
      "user-1",
      {},
    )

    const call = mockDriveApi.files.create.mock.calls[0][0]
    expect(call.requestBody.mimeType).toBe("application/vnd.google-apps.spreadsheet")
  })

  test("does NOT rewrite mimeType when convertToGoogleDocs is false", async () => {
    mockDriveApi.files.create.mockResolvedValue({ data: { id: "f" } })

    await uploadGoogleDriveFile(
      {
        sourceType: "node",
        fileFromNode: makeInlineFile("hi", "notes.txt", "text/plain"),
        convertToGoogleDocs: false,
      },
      "user-1",
      {},
    )

    const call = mockDriveApi.files.create.mock.calls[0][0]
    expect(call.requestBody.mimeType).toBeUndefined()
  })
})

// Bug class: share silently dropped — the user asked Drive to share with
// teammates, but the file was uploaded private and the workflow reported
// success. This is one of the most user-visible Drive bugs.
describe("uploadGoogleDriveFile — sharing", () => {
  test("creates a permission for each shareWith email after upload", async () => {
    mockDriveApi.files.create.mockResolvedValue({
      data: { id: "shared-1", name: "doc.txt" },
    })
    mockDriveApi.permissions.create.mockResolvedValue({ data: { id: "perm-1" } })

    const result = await uploadGoogleDriveFile(
      {
        sourceType: "node",
        fileFromNode: makeInlineFile("hi"),
        shareWith: ["alice@x.com", "bob@x.com"],
        sharePermission: "writer",
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(true)
    expect(mockDriveApi.permissions.create).toHaveBeenCalledTimes(2)
    const firstShare = mockDriveApi.permissions.create.mock.calls[0][0]
    expect(firstShare.fileId).toBe("shared-1")
    expect(firstShare.requestBody).toEqual({
      type: "user",
      role: "writer",
      emailAddress: "alice@x.com",
    })
    expect(firstShare.sendNotificationEmail).toBe(true)
  })

  test("upload still succeeds when one share fails (per-email best effort)", async () => {
    mockDriveApi.files.create.mockResolvedValue({
      data: { id: "x", name: "doc.txt" },
    })
    mockDriveApi.permissions.create
      .mockRejectedValueOnce(new Error("Bad email"))
      .mockResolvedValueOnce({ data: { id: "p" } })

    const result = await uploadGoogleDriveFile(
      {
        sourceType: "node",
        fileFromNode: makeInlineFile("hi"),
        shareWith: ["bad@x.com", "good@x.com"],
      },
      "user-1",
      {},
    )

    expect(result.success).toBe(true)
    expect(mockDriveApi.permissions.create).toHaveBeenCalledTimes(2)
  })
})

// Bug class: silent no-op upload — handler proceeds with empty uploads
// and reports success with no file. This must surface as failure.
describe("uploadGoogleDriveFile — failure paths", () => {
  test("returns failure when no source is provided (no Drive call fired)", async () => {
    const result = await uploadGoogleDriveFile(
      { sourceType: "file" }, // uploadedFiles is undefined
      "user-1",
      {},
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/no files to upload/i)
    expect(mockDriveApi.files.create).not.toHaveBeenCalled()
  })

  test("returns failure when token retrieval fails (no Drive call fired)", async () => {
    // Note: the handler throws internally on token failure but the outer
    // try/catch converts it to a returned ActionResult. Pin both halves of
    // that contract so a refactor that lets the throw escape would break
    // this test.
    setMockToken(null)
    const result = await uploadGoogleDriveFile(
      { sourceType: "node", fileFromNode: makeInlineFile("hi") },
      "user-1",
      {},
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/access token/i)
    expect(mockDriveApi.files.create).not.toHaveBeenCalled()
  })
})

// Q3 — 401 handling.
// Drive is OAuth-with-refresh; the googleapis SDK throws 401 errors with
// `code: 401`. `uploadGoogleDriveFile` wraps `drive.files.create` in
// `refreshAndRetry`. See learning/docs/handler-contracts.md.
describe("uploadGoogleDriveFile — Q3 — 401 handling", () => {
  test("transient SDK 401 → refresh succeeds → retry succeeds → success", async () => {
    setMockTokenRefreshOutcome("success")
    mockDriveApi.files.create
      .mockRejectedValueOnce(
        Object.assign(new Error("Unauthorized"), { code: 401 }),
      )
      .mockResolvedValueOnce({ data: { id: "file-after-refresh", name: "doc.txt" } })

    const result = await uploadGoogleDriveFile(
      { sourceType: "node", fileFromNode: makeInlineFile("hi") },
      "user-1",
      {},
    )

    expect(result.success).toBe(true)
    expect(mockDriveApi.files.create).toHaveBeenCalledTimes(2)
    expect(getHealthEngineCalls()).toHaveLength(0)
  })

  test("permanent SDK 401 → per-file auth failure recorded + token_revoked signal", async () => {
    setMockTokenRefreshOutcome("success")
    mockDriveApi.files.create.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { code: 401 }),
    )

    const result = await uploadGoogleDriveFile(
      { sourceType: "node", fileFromNode: makeInlineFile("hi") },
      "user-1",
      {},
    )

    // Drive aggregates per-file results; the overall result is failure
    // because the only file failed. The per-file error carries the
    // standardized auth-failure message from `refreshAndRetry`.
    expect(result.success).toBe(false)
    const uploaded = (result.output as any)?.uploadedFiles ?? []
    expect(uploaded).toHaveLength(1)
    expect(uploaded[0].success).toBe(false)
    expect(uploaded[0].error).toMatch(/reconnect|token|refresh/i)
    expect(mockDriveApi.files.create).toHaveBeenCalledTimes(2)
    const signals = getHealthEngineCalls()
    expect(signals).toHaveLength(1)
    expect(signals[0].signal.classifiedError.requiresUserAction).toBe(true)
  })

  test("permanent 401 with refresh failing immediately → no retry, ActionResult auth failure", async () => {
    setMockTokenRefreshOutcome("permanent_401")
    mockDriveApi.files.create.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { code: 401 }),
    )

    const result = await uploadGoogleDriveFile(
      { sourceType: "node", fileFromNode: makeInlineFile("hi") },
      "user-1",
      {},
    )

    expect(result.success).toBe(false)
    expect(mockDriveApi.files.create).toHaveBeenCalledTimes(1)
    expect(getHealthEngineCalls()).toHaveLength(1)
  })
})

// Q4 — within-session idempotency.
// Drive's hash covers the upload set (file names + sizes + mimeType +
// folder + share config). Bytes themselves are excluded — see source for
// rationale.
describe("uploadGoogleDriveFile — Q4 — idempotency within session", () => {
  const meta = {
    executionSessionId: "session-1",
    nodeId: "node-A",
    actionType: "google_drive_action_upload_file",
    provider: "google-drive",
  }
  const config = {
    sourceType: "node",
    fileFromNode: makeInlineFile("hello world", "doc.txt"),
  }

  test("first invocation fires Drive and records the marker", async () => {
    mockDriveApi.files.create.mockResolvedValue({
      data: { id: "f1", name: "doc.txt", webViewLink: "v" },
    })

    const result = await uploadGoogleDriveFile(config, "user-1", {}, meta)
    expect(result.success).toBe(true)
    const records = getSessionRecordCalls()
    expect(records).toHaveLength(1)
    expect(records[0].options?.provider).toBe("google-drive")
    expect(records[0].options?.externalId).toBe("f1")
  })

  test("replay with matching payload returns cached, no Drive call", async () => {
    mockDriveApi.files.create.mockResolvedValue({ data: { id: "f1" } })
    const first = await uploadGoogleDriveFile(config, "user-1", {}, meta)

    mockDriveApi.files.create.mockClear()
    const second = await uploadGoogleDriveFile(config, "user-1", {}, meta)
    expect(second.success).toBe(true)
    expect(mockDriveApi.files.create).not.toHaveBeenCalled()
    expect(second.output?.uploadedFiles?.[0]?.fileId).toBe(first.output?.uploadedFiles?.[0]?.fileId)
  })

  test("DIFFERENT payload returns PAYLOAD_MISMATCH, no Drive call", async () => {
    setSessionReplayOutcome(
      {
        executionSessionId: meta.executionSessionId,
        nodeId: meta.nodeId,
        actionType: meta.actionType,
      },
      "mismatch",
    )
    const result = await uploadGoogleDriveFile(config, "user-1", {}, meta)
    expect(result.success).toBe(false)
    expect(result.error).toBe("PAYLOAD_MISMATCH")
    expect(mockDriveApi.files.create).not.toHaveBeenCalled()
  })

  test("different sessionId fires Drive again (rerun)", async () => {
    mockDriveApi.files.create.mockResolvedValue({ data: { id: "f1" } })
    await uploadGoogleDriveFile(config, "user-1", {}, meta)
    mockDriveApi.files.create.mockClear()

    mockDriveApi.files.create.mockResolvedValue({ data: { id: "f2" } })
    await uploadGoogleDriveFile(config, "user-1", {}, {
      ...meta,
      executionSessionId: "session-2",
    })
    expect(mockDriveApi.files.create).toHaveBeenCalledTimes(1)
  })
})
