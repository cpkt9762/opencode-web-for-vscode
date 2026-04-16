import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import type * as vscode from "vscode"

const extDir = mkdtempSync(join(tmpdir(), "oc-ext-test-"))
const nativeFetch = globalThis.fetch
afterAll(() => rmSync(extDir, { recursive: true, force: true }))
afterAll(() => {
  if (nativeFetch) globalThis.fetch = nativeFetch
})

const createOutputChannel = vi.fn(() => ({
  appendLine: vi.fn(),
  dispose: vi.fn(),
}))

const registerWebviewViewProvider = vi.fn(() => ({ dispose: vi.fn() }))
const registerTreeDataProvider = vi.fn(() => ({ dispose: vi.fn() }))
const registerTextDocumentContentProvider = vi.fn(() => ({ dispose: vi.fn() }))
const registerCodeLensProvider = vi.fn(() => ({ dispose: vi.fn() }))
const onDidChangeConfiguration = vi.fn(() => ({ dispose: vi.fn() }))
const showWarningMessage = vi.fn()
const onDidChangeWorkspaceFolders = vi.fn((cb: () => unknown) => {
  state.work = cb
  return { dispose: vi.fn() }
})
const onDidChangeActiveTextEditor = vi.fn((_cb: (editor: vscode.TextEditor | undefined) => unknown) => {
  return { dispose: vi.fn() }
})
const getConfiguration = vi.fn(() => ({
  get: vi.fn((key: string, value: unknown) => {
    if (key === "port") return 4096
    if (key === "autoStart") return true
    if (key === "webUrl") return "http://localhost:4096"
    return value
  }),
}))

const made: Array<{ auth: string; client: Record<string, unknown>; dir: string; url: string }> = []
const projs: Array<{ initGit: { mock: { calls: unknown[][] } } }> = []

function res(data: unknown) {
  return {
    json: vi.fn(async () => data),
  }
}

function slug(dir: string) {
  return Buffer.from(dir).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

async function tick() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function sdk(dir: string) {
  const project = {
    current: vi.fn(async () => ({ data: { id: "global" } })),
    initGit: vi.fn(async () => ({})),
  }
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
      project,
      tui: {
        appendPrompt: vi.fn(async () => ({})),
      },
    },
    dir,
    url: "http://localhost:4096",
  }
  projs.push({ initGit: project.initGit })
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
const currentFolder = vi.fn((): string | undefined => "/workspace")
const getDirectory = vi.fn(async () => "/workspace")
const onDirectoryChange = vi.fn((_cb: (dir: string | undefined) => unknown) => {
  return { dispose: vi.fn() }
})
const showErrorMessage = vi.fn()
const fetchMock = vi.fn(async () => res([{ worktree: "/workspace" }]))

const managers: unknown[] = []
const views: unknown[] = []
const sessions: unknown[] = []
const providers: unknown[] = []
const msgs: Array<Map<string, (payload: unknown) => unknown>> = []
const events: Array<{
  dispose: ReturnType<typeof vi.fn>
  onEvent?: (type: string) => void
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
    setState: vi.fn(),
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

const EventListener = vi.fn((opts?: { onEvent?: (type: string) => void }) => {
  const item = {
    dispose: vi.fn(),
    onEvent: opts?.onEvent,
    start: vi.fn(),
    stop: vi.fn(),
  }
  events.push(item)
  return item
})

const MessageBridge = vi.fn(() => {
  const map = new Map<string, (payload: unknown) => unknown>()
  msgs.push(map)
  return {
    dispose: vi.fn(),
    onMessage: vi.fn((type: string, cb: (payload: unknown) => unknown) => {
      map.set(type, cb)
      return { dispose: vi.fn(() => map.delete(type)) }
    }),
    post: vi.fn(async () => true),
  }
})

const state = {
  dir: "/workspace",
  work: undefined as (() => unknown) | undefined,
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
    joinPath: vi.fn((base: { fsPath: string }, ...parts: string[]) => ({ fsPath: join(base.fsPath, ...parts) })),
  },
  window: {
    createOutputChannel,
    onDidChangeActiveTextEditor,
    registerTreeDataProvider,
    registerWebviewViewProvider,
    showErrorMessage,
    showWarningMessage,
    showTextDocument: vi.fn(async () => undefined),
  },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration,
    getWorkspaceFolder: vi.fn(() => ({ uri: { fsPath: state.dir } })),
    onDidChangeConfiguration,
    onDidChangeWorkspaceFolders,
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
vi.mock("./utils/workspace.js", () => ({ currentFolder, getDirectory, onDirectoryChange }))

function ctx() {
  return {
    subscriptions: [] as vscode.Disposable[],
    extensionPath: extDir,
    extensionUri: { fsPath: extDir },
    workspaceState: {
      get: vi.fn(() => undefined),
      update: vi.fn(async () => undefined),
    },
  } as unknown as vscode.ExtensionContext
}

describe("extension", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    made.length = 0
    projs.length = 0
    managers.length = 0
    views.length = 0
    sessions.length = 0
    providers.length = 0
    events.length = 0
    msgs.length = 0
    showWarningMessage.mockReset()
    state.dir = "/workspace"
    state.work = undefined
    currentFolder.mockReturnValue("/workspace")
    getDirectory.mockResolvedValue("/workspace")
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => res([{ worktree: "/workspace" }]))
    Reflect.set(globalThis, "fetch", fetchMock)
    onDidChangeWorkspaceFolders.mockImplementation((cb: () => unknown) => {
      state.work = cb
      return { dispose: vi.fn() }
    })
    onDidChangeActiveTextEditor.mockImplementation((_cb: (editor: vscode.TextEditor | undefined) => unknown) => {
      return { dispose: vi.fn() }
    })
  })

  it("activate registers webview provider", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())

    expect(registerWebviewViewProvider).toHaveBeenCalledOnce()
    expect(registerWebviewViewProvider).toHaveBeenCalledWith("opencode-web.chatView", expect.any(Object), {
      webviewOptions: { retainContextWhenHidden: true },
    })
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

  it("reads serverPassword config and passes to ProcessManager", async () => {
    getConfiguration.mockReturnValueOnce({
      get: vi.fn((key: string, value: unknown) => {
        if (key === "port") return 4096
        if (key === "autoStart") return true
        if (key === "serverPassword") return "ext-secret"
        if (key === "webUrl") return "http://localhost:4096"
        return value
      }),
    })
    const { activate } = await import("./extension.js")

    await activate(ctx())

    expect(ProcessManager).toHaveBeenCalledWith(4096, {
      dir: undefined,
      password: "ext-secret",
    })
  })

  it("sync updates webview URL when folder changes to existing project", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())

    expect(onDidChangeWorkspaceFolders).toHaveBeenCalledOnce()

    const view = views[0] as { setState: ReturnType<typeof vi.fn>; setUrl: ReturnType<typeof vi.fn> }
    fetchMock.mockImplementationOnce(async () => res([{ worktree: "/next" }]))
    updateDirectory.mockClear()
    view.setState.mockClear()
    view.setUrl.mockClear()

    state.dir = "/next"
    currentFolder.mockReturnValue("/next")
    state.work?.()
    await tick()

    expect(updateDirectory).toHaveBeenCalledTimes(1)
    expect(updateDirectory).toHaveBeenNthCalledWith(1, expect.anything(), "/next")
    expect(view.setState).toHaveBeenNthCalledWith(1, "loading")
    expect(view.setUrl).toHaveBeenCalledWith(`http://localhost:4096/${slug("/next")}`)
  })

  it("sync loads SPA root when folder has no opencode project", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())

    const view = views[0] as { setState: ReturnType<typeof vi.fn>; setUrl: ReturnType<typeof vi.fn> }
    fetchMock.mockImplementationOnce(async () => res([]))
    updateDirectory.mockClear()
    view.setState.mockClear()
    view.setUrl.mockClear()

    state.dir = "/fresh"
    currentFolder.mockReturnValue("/fresh")
    state.work?.()
    await tick()

    expect(updateDirectory).not.toHaveBeenCalled()
    expect(view.setState).toHaveBeenNthCalledWith(1, "loading")
    expect(view.setUrl).toHaveBeenCalledWith("http://localhost:4096")
  })

  it("sync shows placeholder when no folder open", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())

    const view = views[0] as { setState: ReturnType<typeof vi.fn>; setUrl: ReturnType<typeof vi.fn> }
    fetchMock.mockClear()
    updateDirectory.mockClear()
    view.setState.mockClear()
    view.setUrl.mockClear()

    currentFolder.mockImplementation(() => undefined)
    state.work?.()
    await tick()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(updateDirectory).not.toHaveBeenCalled()
    expect(view.setState).not.toHaveBeenCalled()
    expect(view.setUrl).toHaveBeenCalledWith("about:blank")
  })

  it("sync skips when folder unchanged", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())

    const view = views[0] as { setState: ReturnType<typeof vi.fn>; setUrl: ReturnType<typeof vi.fn> }
    fetchMock.mockClear()
    updateDirectory.mockClear()
    view.setState.mockClear()
    view.setUrl.mockClear()

    currentFolder.mockReturnValue("/workspace")
    state.work?.()
    await tick()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(updateDirectory).not.toHaveBeenCalled()
    expect(view.setState).not.toHaveBeenCalled()
    expect(view.setUrl).not.toHaveBeenCalled()
  })

  it("link does not auto-call initGit", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())

    expect(projs.some((item) => item.initGit.mock.calls.length > 0)).toBe(false)
  })

  it("activate leaves question handling to the SPA", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())
    await tick()

    const item = made.at(-1)?.client.question as {
      list: ReturnType<typeof vi.fn>
      reject: ReturnType<typeof vi.fn>
      reply: ReturnType<typeof vi.fn>
    }

    expect(item.list).not.toHaveBeenCalled()
    expect(item.reject).not.toHaveBeenCalled()
    expect(item.reply).not.toHaveBeenCalled()
  })

  it("activate leaves permission handling to the SPA", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())
    await tick()

    events[0]?.onEvent?.("session.permission")
    await tick()

    const item = made.at(-1)?.client.permission as {
      list: ReturnType<typeof vi.fn>
      reply: ReturnType<typeof vi.fn>
    }

    expect(item.list).not.toHaveBeenCalled()
    expect(item.reply).not.toHaveBeenCalled()
    expect(showWarningMessage).not.toHaveBeenCalled()
  })

  it("link loads SPA root for unregistered folder", async () => {
    const { activate } = await import("./extension.js")

    currentFolder.mockReturnValue("/fresh")
    fetchMock.mockImplementation(async () => res([]))

    await activate(ctx())

    const view = views[0] as { setState: ReturnType<typeof vi.fn>; setUrl: ReturnType<typeof vi.fn> }

    expect(currentFolder).toHaveBeenCalled()
    expect(getDirectory).not.toHaveBeenCalled()
    expect(view.setState).toHaveBeenCalledWith("loading")
    expect(view.setUrl).toHaveBeenCalledWith("http://localhost:4096")
  })

  it("T15 create-project message calls initGit and forces reload", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())

    const view = views[0] as {
      resolveWebviewView: (view: vscode.WebviewView) => void
      setState: ReturnType<typeof vi.fn>
      setUrl: ReturnType<typeof vi.fn>
    }
    view.resolveWebviewView({} as vscode.WebviewView)
    updateDirectory.mockClear()
    view.setState.mockClear()
    view.setUrl.mockClear()
    const init = projs.at(-1)?.initGit

    await msgs[0]?.get("opencode-web.create-project")?.(undefined)
    await tick()

    expect(init).toHaveBeenCalledTimes(1)
    expect(updateDirectory).toHaveBeenCalledWith(expect.anything(), "/workspace")
    expect(view.setState).toHaveBeenCalledWith("loading")
    expect(view.setUrl).toHaveBeenCalledWith(`http://localhost:4096/${slug("/workspace")}`)
    expect(showErrorMessage).not.toHaveBeenCalled()
  })

  it("T16 workspace folder change uses currentFolder without interactive listeners", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())

    expect(onDidChangeWorkspaceFolders).toHaveBeenCalledOnce()
    expect(onDidChangeActiveTextEditor).not.toHaveBeenCalled()
    expect(onDirectoryChange).not.toHaveBeenCalled()

    currentFolder.mockClear()
    getDirectory.mockClear()
    currentFolder.mockReturnValue("/next")
    state.dir = "/next"
    state.work?.()
    await tick()

    expect(currentFolder).toHaveBeenCalledOnce()
    expect(getDirectory).not.toHaveBeenCalled()
  })

  it("deactivate is callable", async () => {
    const { deactivate } = await import("./extension.js")

    await deactivate()

    expect(true).toBe(true)
  })
})
