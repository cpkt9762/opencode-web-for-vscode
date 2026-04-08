import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("vscode", () => ({
  env: {
    clipboard: {
      writeText: vi.fn(),
    },
  },
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
  },
}))

function client() {
  return {
    fork: vi.fn().mockResolvedValue({ data: {} }),
    revert: vi.fn().mockResolvedValue({
      data: {},
    }),
    share: vi.fn().mockResolvedValue({
      data: {
        share: {
          url: "https://opencode.ai/share/abc",
        },
      },
    }),
    summarize: vi.fn().mockResolvedValue({
      data: {
        summary: "Session summary",
      },
    }),
  }
}

describe("session commands", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("forkSession calls session.fork and shows notification", async () => {
    const sdk = client()
    const vscode = await import("vscode")
    const { forkSession } = await import("./session.js")

    await forkSession(() => ({ client: { session: { fork: sdk.fork } } }), "ses_123")

    expect(sdk.fork).toHaveBeenCalledWith({ sessionID: "ses_123" })
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("OpenCode: Session forked")
  })

  it("forkSession shows error notification on failure", async () => {
    const sdk = client()
    const vscode = await import("vscode")
    sdk.fork.mockRejectedValue(new Error("boom"))
    const { forkSession } = await import("./session.js")

    await forkSession(() => ({ client: { session: { fork: sdk.fork } } }), "ses_123")

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("OpenCode: Failed to fork session")
  })

  it("revertSession calls session.revert and shows notification", async () => {
    const sdk = client()
    const vscode = await import("vscode")
    const { revertSession } = await import("./session.js")

    await revertSession(() => ({ client: { session: { revert: sdk.revert } } }), "ses_123", "msg_456")

    expect(sdk.revert).toHaveBeenCalledWith({
      sessionID: "ses_123",
      messageID: "msg_456",
    })
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("OpenCode: Session reverted")
  })

  it("revertSession shows error notification on failure", async () => {
    const sdk = client()
    const vscode = await import("vscode")
    sdk.revert.mockRejectedValue(new Error("boom"))
    const { revertSession } = await import("./session.js")

    await revertSession(() => ({ client: { session: { revert: sdk.revert } } }), "ses_123", "msg_456")

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("OpenCode: Failed to revert session")
  })

  it("shareSession calls session.share, copies url, and shows notification", async () => {
    const sdk = client()
    const vscode = await import("vscode")
    const { shareSession } = await import("./session.js")

    await shareSession(() => ({ client: { session: { share: sdk.share } } }), "ses_123")

    expect(sdk.share).toHaveBeenCalledWith({ sessionID: "ses_123" })
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith("https://opencode.ai/share/abc")
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("OpenCode: Share URL copied")
  })

  it("shareSession shows error notification on failure", async () => {
    const sdk = client()
    const vscode = await import("vscode")
    sdk.share.mockRejectedValue(new Error("boom"))
    const { shareSession } = await import("./session.js")

    await shareSession(() => ({ client: { session: { share: sdk.share } } }), "ses_123")

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("OpenCode: Failed to share session")
  })

  it("summarizeSession calls session.summarize and shows summary", async () => {
    const sdk = client()
    const vscode = await import("vscode")
    const { summarizeSession } = await import("./session.js")

    await summarizeSession(() => ({ client: { session: { summarize: sdk.summarize } } }), "ses_123")

    expect(sdk.summarize).toHaveBeenCalledWith({ sessionID: "ses_123" })
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("Session summary")
  })

  it("summarizeSession shows error notification on failure", async () => {
    const sdk = client()
    const vscode = await import("vscode")
    sdk.summarize.mockRejectedValue(new Error("boom"))
    const { summarizeSession } = await import("./session.js")

    await summarizeSession(() => ({ client: { session: { summarize: sdk.summarize } } }), "ses_123")

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("OpenCode: Failed to summarize session")
  })
})
