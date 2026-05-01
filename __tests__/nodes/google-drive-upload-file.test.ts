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
