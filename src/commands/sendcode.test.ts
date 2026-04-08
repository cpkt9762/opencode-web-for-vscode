import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TextEditor } from "vscode"

vi.mock("vscode", () => ({
  window: {
    activeTextEditor: undefined,
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
  },
  workspace: {
    asRelativePath: vi.fn((uri: { fsPath: string }) => uri.fsPath.replace("/repo/", "")),
    openTextDocument: vi.fn(),
  },
}))

function editor(opts: {
  full: string
  text: string
  lang: string
  path: string
  empty?: boolean
  lines?: number
  start?: number
  end?: number
}): TextEditor {
  return {
    selection: {
      isEmpty: opts.empty ?? false,
      start: { line: opts.start ?? 1 },
      end: { line: opts.end ?? 1 },
    },
    document: {
      languageId: opts.lang,
      lineCount: opts.lines ?? 2,
      uri: { fsPath: opts.path },
      getText: vi.fn((value?: unknown) => {
        if (!value) return opts.full
        return opts.text
      }),
    },
  } as unknown as TextEditor
}

function setEditor(vscode: typeof import("vscode"), value?: TextEditor) {
  Object.defineProperty(vscode.window, "activeTextEditor", {
    value,
    writable: true,
    configurable: true,
  })
}

describe("sendCode", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    setEditor(await import("vscode"))
  })

  it("sends selected text formatted with language id", async () => {
    const appendPrompt = vi.fn().mockResolvedValue(undefined)
    const vscode = await import("vscode")
    setEditor(
      vscode,
      editor({
        full: "const a = 1\nconst b = 2",
        text: "const b = 2",
        lang: "typescript",
        path: "/repo/src/sendcode.ts",
        start: 1,
        end: 1,
      }),
    )

    const { sendCode } = await import("./sendcode.js")
    await sendCode(() => ({ client: { tui: { appendPrompt } } }))()

    expect(appendPrompt).toHaveBeenCalledWith({
      text: "@src/sendcode.ts#L2-L2\n```typescript\nconst b = 2\n```",
    })
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("OpenCode: Code sent to chat")
  })

  it("sends symbol range passed by command arguments", async () => {
    const appendPrompt = vi.fn().mockResolvedValue(undefined)
    const vscode = await import("vscode")
    const uri = { fsPath: "/repo/src/lens.ts" }
    const range = {
      start: { line: 2 },
      end: { line: 4 },
    }
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue({
      languageId: "typescript",
      uri,
      getText: vi.fn((value?: unknown) => {
        expect(value).toBe(range)
        return "function lens() {}"
      }),
    } as never)

    const { sendCode } = await import("./sendcode.js")
    await sendCode(() => ({ client: { tui: { appendPrompt } } }))(uri as never, range as never)

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(uri)
    expect(appendPrompt).toHaveBeenCalledWith({
      text: "@src/lens.ts#L3-L5\n```typescript\nfunction lens() {}\n```",
    })
  })

  it("sends entire file when selection is empty", async () => {
    const appendPrompt = vi.fn().mockResolvedValue(undefined)
    const vscode = await import("vscode")
    setEditor(
      vscode,
      editor({
        full: "fn main() {}",
        text: "",
        lang: "rust",
        path: "/repo/src/main.rs",
        empty: true,
        lines: 1,
        start: 0,
        end: 0,
      }),
    )

    const { sendCode } = await import("./sendcode.js")
    await sendCode(() => ({ client: { tui: { appendPrompt } } }))()

    expect(appendPrompt).toHaveBeenCalledWith({
      text: "@src/main.rs#L1-L1\n```rust\nfn main() {}\n```",
    })
  })

  it("shows error when no editor", async () => {
    const vscode = await import("vscode")
    const { sendCode } = await import("./sendcode.js")
    await sendCode(() => ({ client: { tui: { appendPrompt: vi.fn() } } }))()

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("OpenCode: No active editor")
  })

  it("shows error when no client", async () => {
    const vscode = await import("vscode")
    setEditor(
      vscode,
      editor({
        full: "print('hi')",
        text: "print('hi')",
        lang: "python",
        path: "/repo/src/app.py",
      }),
    )

    const { sendCode } = await import("./sendcode.js")
    await sendCode(() => null)()

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("OpenCode: Client not available")
  })
})
