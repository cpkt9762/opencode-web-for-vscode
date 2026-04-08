import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Disposable, ExtensionContext } from "vscode"
import type { GetClient } from "./sendcode.js"

const mock = vi.hoisted(() => {
  const show = vi.fn()
  return {
    createTerminal: vi.fn(() => ({ show })),
    post: vi.fn().mockResolvedValue(true),
    forkSession: vi.fn().mockResolvedValue(undefined),
    revertSession: vi.fn().mockResolvedValue(undefined),
    searchFiles: vi.fn(() => vi.fn()),
    searchSymbols: vi.fn(() => vi.fn()),
    searchText: vi.fn(() => vi.fn()),
    shareSession: vi.fn().mockResolvedValue(undefined),
    show,
    showDiff: vi.fn().mockResolvedValue(undefined),
    summarizeSession: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock("./search.js", () => ({
  searchFiles: mock.searchFiles,
  searchSymbols: mock.searchSymbols,
  searchText: mock.searchText,
}))

vi.mock("./session.js", () => ({
  forkSession: mock.forkSession,
  revertSession: mock.revertSession,
  shareSession: mock.shareSession,
  summarizeSession: mock.summarizeSession,
}))

vi.mock("../terminal/pty.js", () => ({
  createTerminal: mock.createTerminal,
}))

vi.mock("../views/diff.js", () => ({
  showDiff: mock.showDiff,
}))

vi.mock("../webview/bridge.js", () => ({
  MSG: {
    navigate: "opencode-web.navigate",
  },
}))

vi.mock("vscode", () => ({
  commands: {
    executeCommand: vi.fn(),
    registerCommand: vi.fn(),
  },
  window: {
    activeTextEditor: undefined,
    showInformationMessage: vi.fn(),
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
    showWarningMessage: vi.fn(),
  },
  workspace: {
    asRelativePath: vi.fn((uri: { fsPath: string }) => uri.fsPath),
    openTextDocument: vi.fn(),
    workspaceFolders: [],
  },
}))

type Ctx = {
  subscriptions: Disposable[]
}

type Cmd = (...args: unknown[]) => unknown

const ids = [
  "opencode-web.sendCode",
  "opencode-web.newSession",
  "opencode-web.openChat",
  "opencode-web.openInBrowser",
  "opencode-web.restart",
  "opencode-web.stop",
  "opencode-web.showOutput",
  "opencode-web.searchFiles",
  "opencode-web.searchText",
  "opencode-web.searchSymbols",
  "opencode-web.openTerminal",
  "opencode-web.forkSession",
  "opencode-web.revertSession",
  "opencode-web.shareSession",
  "opencode-web.summarizeSession",
  "opencode-web.deleteSession",
  "opencode-web.showDiff",
  "opencode-web.selectSession",
] as const

function disposable(): Disposable {
  return {
    dispose: vi.fn(),
  }
}

async function setup(context: Ctx, getClient: () => ReturnType<GetClient>, opts?: unknown) {
  const handlers = new Map<string, Cmd>()
  const vscode = await import("vscode")
  const spy = vi.mocked(vscode.commands.registerCommand)
  spy.mockImplementation((id, cmd) => {
    handlers.set(id, cmd as Cmd)
    return disposable()
  })

  const { registerCommands } = await import("./registry.js")
  registerCommands(context as ExtensionContext, getClient, opts as Parameters<typeof registerCommands>[2])
  return { handlers, spy, vscode }
}

describe("registerCommands", () => {
  let context: Ctx
  let cfg: unknown
  const getClient = vi.fn(() => cfg as ReturnType<GetClient>)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    context = {
      subscriptions: [],
    }
    cfg = null
  })

  it("registers all commands", async () => {
    const { spy } = await setup(context, getClient)

    expect(spy).toHaveBeenCalledTimes(ids.length)
    expect(spy.mock.calls.map(([id]) => id)).toEqual(ids)
  })

  it("adds all disposables to context", async () => {
    await setup(context, getClient)

    expect(context.subscriptions).toHaveLength(ids.length)
  })

  it("wires search commands with client getter", async () => {
    await setup(context, getClient)

    expect(mock.searchFiles).toHaveBeenCalledWith(getClient)
    expect(mock.searchText).toHaveBeenCalledWith(getClient)
    expect(mock.searchSymbols).toHaveBeenCalledWith(getClient)
  })

  it("forwards sendCode command arguments", async () => {
    const { handlers, vscode } = await setup(context, getClient)
    const uri = { fsPath: "/tmp/sendcode.ts" }
    const range = {
      start: { line: 1 },
      end: { line: 2 },
    }
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue({
      languageId: "typescript",
      uri,
      getText: vi.fn(() => "const a = 1"),
    } as never)
    cfg = {
      client: {
        tui: {
          appendPrompt: vi.fn().mockResolvedValue(undefined),
        },
      },
    }

    await handlers.get("opencode-web.sendCode")?.(uri, range)

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(uri)
    expect(getClient).toHaveBeenCalledTimes(1)
  })

  it("opens a terminal from the command", async () => {
    const { handlers } = await setup(context, getClient)

    await handlers.get("opencode-web.openTerminal")?.()

    expect(mock.createTerminal).toHaveBeenCalledWith("OpenCode", getClient)
    expect(mock.show).toHaveBeenCalledTimes(1)
  })

  it("prompts for a session id before forking", async () => {
    const { handlers, vscode } = await setup(context, getClient)
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce("ses_123")

    await handlers.get("opencode-web.forkSession")?.()

    expect(mock.forkSession).toHaveBeenCalledWith(getClient, "ses_123")
  })

  it("prompts for a session id and message id before reverting", async () => {
    const { handlers, vscode } = await setup(context, getClient)
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce("ses_123").mockResolvedValueOnce("msg_456")

    await handlers.get("opencode-web.revertSession")?.()

    expect(mock.revertSession).toHaveBeenCalledWith(getClient, "ses_123", "msg_456")
  })

  it("prompts for a session id before sharing", async () => {
    const { handlers, vscode } = await setup(context, getClient)
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce("ses_123")

    await handlers.get("opencode-web.shareSession")?.()

    expect(mock.shareSession).toHaveBeenCalledWith(getClient, "ses_123")
  })

  it("prompts for a session id before summarizing", async () => {
    const { handlers, vscode } = await setup(context, getClient)
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce("ses_123")

    await handlers.get("opencode-web.summarizeSession")?.()

    expect(mock.summarizeSession).toHaveBeenCalledWith(getClient, "ses_123")
  })

  it("deletes selected session and refreshes tree", async () => {
    const drop = vi.fn().mockResolvedValue(undefined)
    const refresh = vi.fn()
    cfg = {
      client: {
        session: {
          delete: drop,
        },
      },
    }
    const { handlers } = await setup(context, getClient, {
      sessions: { refresh },
    })

    await handlers.get("opencode-web.deleteSession")?.({ id: "ses_123" })

    expect(drop).toHaveBeenCalledWith({ sessionID: "ses_123" })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("forwards diff arguments", async () => {
    const { handlers } = await setup(context, getClient)

    await handlers.get("opencode-web.showDiff")?.("ses_123", "src/app.ts", "old", "new")

    expect(mock.showDiff).toHaveBeenCalledWith("ses_123", "src/app.ts", "old", "new")
  })

  it("selects session and posts navigate message", async () => {
    const execute = vi.fn()
    const { handlers, vscode } = await setup(context, getClient, {
      bridge: () => ({ post: mock.post }),
    })
    vi.mocked(vscode.commands.executeCommand).mockImplementation(execute)

    await handlers.get("opencode-web.selectSession")?.({ id: "ses_123" })

    expect(execute).toHaveBeenNthCalledWith(1, "workbench.view.extension.opencode-web")
    expect(execute).toHaveBeenNthCalledWith(2, "opencode-web.chatView.focus")
    expect(mock.post).toHaveBeenCalledWith("opencode-web.navigate", { sessionId: "ses_123" })
  })
})
