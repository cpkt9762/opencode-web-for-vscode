import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type * as vscode from "vscode"

const extDir = mkdtempSync(join(tmpdir(), "oc-ext-test-"))
afterAll(() => rmSync(extDir, { recursive: true, force: true }))

const createOutputChannel = vi.fn(() => ({
  appendLine: vi.fn(),
  dispose: vi.fn(),
}))

const registerWebviewViewProvider = vi.fn(() => ({ dispose: vi.fn() }))
const registerTreeDataProvider = vi.fn(() => ({ dispose: vi.fn() }))
const registerTextDocumentContentProvider = vi.fn(() => ({ dispose: vi.fn() }))
const registerCodeLensProvider = vi.fn(() => ({ dispose: vi.fn() }))
const onDidChangeConfiguration = vi.fn(() => ({ dispose: vi.fn() }))
const onDidChangeActiveTextEditor = vi.fn((cb: (editor: vscode.TextEditor | undefined) => unknown) => {
  state.editor = cb
  return { dispose: vi.fn() }
})
const getConfiguration = vi.fn(() => ({
  get: vi.fn((key: string, value: unknown) => {
    if (key === "port") return 4096
    if (key === "autoStart") return true
    return value
  }),
}))

const made: Array<{ auth: string; client: Record<string, unknown>; dir: string; url: string }> = []

function sdk(dir: string) {
  const item = {
    auth: "Basic test",
    client: {
      event: {
        subscribe: vi.fn(async () => ({
          stream: (async function* () {})(),
        })),
      },
      permission: {
        list: vi.fn(async () => ({ data: [] })),
        reply: vi.fn(async () => ({})),
      },
      provider: {
        list: vi.fn(async () => ({ data: { all: [], connected: [] } })),
      },
      question: {
        list: vi.fn(async () => ({ data: [] })),
        reject: vi.fn(async () => ({})),
        reply: vi.fn(async () => ({})),
      },
      session: {
        diff: vi.fn(async () => ({ data: [] })),
        list: vi.fn(async () => ({ data: [] })),
      },
      tui: {
        appendPrompt: vi.fn(async () => ({})),
      },
    },
    dir,
    url: "http://localhost:4096",
  }
  made.push(item)
  return item
}

const createClient = vi.fn(async (opts: { directory: string }) => sdk(opts.directory))
const updateDirectory = vi.fn(async (_cfg: unknown, dir: string) => sdk(dir))

const findBinary = vi.fn(() => ({
  compatible: true,
  path: "/usr/local/bin/opencode",
  version: "1.3.0",
}))

const createStatusBar = vi.fn(() => ({ dispose: vi.fn() }))
const registerCommands = vi.fn()
const getDirectory = vi.fn(async () => "/workspace")
const onDirectoryChange = vi.fn(() => ({ dispose: vi.fn() }))
const showPermission = vi.fn(async () => "once")
const showQuestion = vi.fn(async () => null)

const managers: unknown[] = []
const views: unknown[] = []
const sessions: unknown[] = []
const providers: unknown[] = []
const events: Array<{
  dispose: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}> = []

const ProcessManager = vi.fn(() => {
  const item = {
    dispose: vi.fn(),
    getPassword: vi.fn(() => "secret"),
    getStatus: vi.fn(() => "running"),
    getUrl: vi.fn(() => "http://localhost:4096"),
    onStatusChange: vi.fn(() => ({ dispose: vi.fn() })),
    start: vi.fn(async () => ({ password: "secret", url: "http://localhost:4096" })),
  }
  managers.push(item)
  return item
})

const OpenCodeWebviewProvider = vi.fn(() => {
  const item = {
    resolveWebviewView: vi.fn(),
    setUrl: vi.fn(),
  }
  views.push(item)
  return item
})

const SessionsProvider = vi.fn(() => {
  const item = {
    refresh: vi.fn(),
    setLog: vi.fn(),
  }
  sessions.push(item)
  return item
})

const ProvidersProvider = vi.fn(() => {
  const item = {
    refresh: vi.fn(),
  }
  providers.push(item)
  return item
})

const DiffProvider = vi.fn(() => ({}))
const OpenCodeLensProvider = vi.fn(() => ({}))

const EventListener = vi.fn(() => {
  const item = {
    dispose: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }
  events.push(item)
  return item
})

const MessageBridge = vi.fn(() => ({
  dispose: vi.fn(),
  onMessage: vi.fn(() => ({ dispose: vi.fn() })),
  post: vi.fn(async () => true),
}))

const state = {
  dir: "/workspace",
  editor: undefined as ((editor: vscode.TextEditor | undefined) => unknown) | undefined,
}

vi.mock("vscode", () => ({
  env: {
    clipboard: {
      writeText: vi.fn(async () => undefined),
    },
  },
  languages: {
    registerCodeLensProvider,
  },
  Uri: {
    file: vi.fn((path: string) => ({ fsPath: path })),
  },
  window: {
    createOutputChannel,
    onDidChangeActiveTextEditor,
    registerTreeDataProvider,
    registerWebviewViewProvider,
    showWarningMessage: vi.fn(),
    showTextDocument: vi.fn(async () => undefined),
  },
  workspace: {
    getConfiguration,
    getWorkspaceFolder: vi.fn(() => ({ uri: { fsPath: state.dir } })),
    onDidChangeConfiguration,
    openTextDocument: vi.fn(async () => ({})),
    registerTextDocumentContentProvider,
  },
}))

vi.mock("./process/manager.js", () => ({ ProcessManager }))
vi.mock("./sdk/client.js", () => ({ createClient, updateDirectory }))
vi.mock("./process/discover.js", () => ({ findBinary }))
vi.mock("./webview/provider.js", () => ({
  OpenCodeWebviewProvider,
  VIEW_ID: "opencode-web.chatView",
}))
vi.mock("./views/statusbar.js", () => ({ createStatusBar }))
vi.mock("./commands/registry.js", () => ({ registerCommands }))
vi.mock("./views/sessions.js", () => ({ SessionsProvider }))
vi.mock("./views/providers.js", () => ({ ProvidersProvider }))
vi.mock("./views/diff.js", () => ({ DiffProvider, scheme: "opencode-diff" }))
vi.mock("./views/codelens.js", () => ({ OpenCodeLensProvider }))
vi.mock("./events/listener.js", () => ({ EventListener }))
vi.mock("./webview/bridge.js", () => ({
  MessageBridge,
  MSG: {
    copy_code: "opencode-web.copy-code",
    frame_ready: "opencode-web.frame-ready",
    open_file: "opencode-web.open-file",
    request_permission: "opencode-web.request-permission",
    request_question: "opencode-web.request-question",
    set_url: "opencode-web.setUrl",
  },
}))
vi.mock("./views/dialogs.js", () => ({ showPermission, showQuestion }))
vi.mock("./utils/workspace.js", () => ({ getDirectory, onDirectoryChange }))

function ctx() {
  return {
    subscriptions: [] as vscode.Disposable[],
    extensionPath: extDir,
    extensionUri: { fsPath: extDir },
  } as unknown as vscode.ExtensionContext
}

describe("extension", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    made.length = 0
    managers.length = 0
    views.length = 0
    sessions.length = 0
    providers.length = 0
    events.length = 0
    state.dir = "/workspace"
    onDidChangeActiveTextEditor.mockImplementation((cb: (editor: vscode.TextEditor | undefined) => unknown) => {
      state.editor = cb
      return { dispose: vi.fn() }
    })
  })

  it("activate registers webview provider", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())

    expect(registerWebviewViewProvider).toHaveBeenCalledOnce()
    expect(registerWebviewViewProvider).toHaveBeenCalledWith("opencode-web.chatView", expect.any(Object))
  })

  it("activate registers tree data providers", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())

    expect(registerTreeDataProvider).toHaveBeenCalledTimes(2)
    expect(registerTreeDataProvider).toHaveBeenNthCalledWith(1, "opencode-web.sessions", expect.any(Object))
    expect(registerTreeDataProvider).toHaveBeenNthCalledWith(2, "opencode-web.providers", expect.any(Object))
  })

  it("activate registers code lens provider", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())

    expect(registerCodeLensProvider).toHaveBeenCalledOnce()
    expect(registerCodeLensProvider).toHaveBeenCalledWith({ scheme: "file" }, expect.any(Object))
  })

  it("activate creates event listener", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())

    expect(EventListener).toHaveBeenCalledOnce()
    expect(events[0]?.start).toHaveBeenCalledOnce()
  })

  it("activate creates status bar", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())

    expect(createStatusBar).toHaveBeenCalledOnce()
  })

  it("updates sdk directory when active editor changes workspace", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())

    expect(onDirectoryChange).toHaveBeenCalledOnce()

    state.dir = "/next"
    await state.editor?.({ document: { uri: { fsPath: "/next/file.ts" } } } as vscode.TextEditor)
    await Promise.resolve()

    expect(updateDirectory).toHaveBeenCalledTimes(1)
    expect(updateDirectory).toHaveBeenNthCalledWith(1, made[0], "/next")

    await state.editor?.({ document: { uri: { fsPath: "/next/other.ts" } } } as vscode.TextEditor)
    await Promise.resolve()

    expect(updateDirectory).toHaveBeenCalledTimes(1)

    state.dir = "/other"
    await state.editor?.({ document: { uri: { fsPath: "/other/file.ts" } } } as vscode.TextEditor)
    await Promise.resolve()

    expect(updateDirectory).toHaveBeenCalledTimes(2)
    expect(updateDirectory).toHaveBeenNthCalledWith(2, made[1], "/other")
  })

  it("deactivate is callable", async () => {
    const { deactivate } = await import("./extension.js")

    await deactivate()

    expect(true).toBe(true)
  })
})
