import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
const executeCommand = vi.fn(async (..._args: unknown[]) => undefined)
const getExtension = vi.fn((..._args: unknown[]) => undefined as unknown)
const showWarningMessage = vi.fn()
const showInformationMessage = vi.fn()
const showTextDocument = vi.fn(async () => undefined)
const onDidChangeWorkspaceFolders = vi.fn((cb: () => unknown) => {
  state.work = cb
  return { dispose: vi.fn() }
})
const onDidChangeActiveTextEditor = vi.fn((_cb: (editor: vscode.TextEditor | undefined) => unknown) => {
  return { dispose: vi.fn() }
})
function config(values: Record<string, unknown> = {}) {
  return {
    get: vi.fn((key: string, value: unknown) => {
      if (Object.hasOwn(values, key)) return values[key]
      if (key === "port") return 4096
      if (key === "autoStart") return true
      if (key === "webUrl") return "http://localhost:4096"
      if (key === "notifications.sessionComplete") return true
      return value
    }),
  }
}

const getConfiguration = vi.fn(() => config())

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

function outputLines() {
  const channel = createOutputChannel.mock.results[0]?.value as { appendLine: ReturnType<typeof vi.fn> } | undefined
  return channel?.appendLine.mock.calls.map((call) => String(call[0])) ?? []
}

function expectNoGitRefresh() {
  expect(executeCommand.mock.calls.some((call) => call[0] === "git.refresh")).toBe(false)
}

type GitResource = { uri: { fsPath: string } }
type GitRepository = {
  rootUri: { fsPath: string }
  state: { untrackedChanges: readonly GitResource[] }
  status: () => Promise<void>
}
type GitApi = {
  repositories: readonly GitRepository[]
  getRepository: (uri: { fsPath: string }) => GitRepository | null
}

function mockGitApi(repos: Map<string, { untracked: string[]; statusError?: Error }>): GitApi {
  const repoMap = new Map<string, GitRepository>()
  for (const [root, cfg] of repos) {
    repoMap.set(root, {
      rootUri: { fsPath: root },
      state: {
        untrackedChanges: cfg.untracked.map((file) => ({ uri: { fsPath: file } })),
      },
      status: vi.fn(async () => {
        if (cfg.statusError) throw cfg.statusError
      }),
    })
  }
  return {
    repositories: Array.from(repoMap.values()),
    getRepository: vi.fn((uri: { fsPath: string }) => {
      for (const [root, repo] of repoMap) {
        if (uri.fsPath.startsWith(root)) return repo
      }
      return null
    }),
  }
}

function useGitApi(api: GitApi) {
  const getAPI = vi.fn(() => api)
  getExtension.mockReturnValue({
    exports: { getAPI },
    isActive: true,
  })
  return { getAPI }
}

async function flushEditedFiles(files: string[]) {
  files.forEach((file) => {
    events[0]?.onEvent?.("file.edited", { file })
  })
  await vi.advanceTimersByTimeAsync(2000)
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
const bridges: unknown[] = []
const msgs: Array<Map<string, (payload: unknown) => unknown>> = []
const events: Array<{
  dispose: ReturnType<typeof vi.fn>
  onEvent?: (type: string, payload?: unknown) => void
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

const EventListener = vi.fn((opts?: { onEvent?: (type: string, payload?: unknown) => void }) => {
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
  const item = {
    dispose: vi.fn(),
    onMessage: vi.fn((type: string, cb: (payload: unknown) => unknown) => {
      map.set(type, cb)
      return { dispose: vi.fn(() => map.delete(type)) }
    }),
    post: vi.fn(async () => true),
  }
  bridges.push(item)
  return item
})

const state = {
  dir: "/workspace",
  work: undefined as (() => unknown) | undefined,
}

vi.mock("vscode", () => ({
  commands: {
    executeCommand,
  },
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
    parse: vi.fn((value: string) => ({ toString: () => value })),
    joinPath: vi.fn((base: { fsPath: string }, ...parts: string[]) => ({ fsPath: join(base.fsPath, ...parts) })),
  },
  extensions: {
    getExtension,
  },
  window: {
    createOutputChannel,
    onDidChangeActiveTextEditor,
    registerTreeDataProvider,
    registerWebviewViewProvider,
    showErrorMessage,
    showInformationMessage,
    showWarningMessage,
    showTextDocument,
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
    navigate: "opencode-web.navigate",
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
  afterEach(() => {
    vi.useRealTimers()
    expectNoGitRefresh()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    getConfiguration.mockReturnValue(config())
    getExtension.mockReset()
    getExtension.mockReturnValue(undefined)
    made.length = 0
    projs.length = 0
    managers.length = 0
    views.length = 0
    sessions.length = 0
    providers.length = 0
    bridges.length = 0
    events.length = 0
    msgs.length = 0
    showWarningMessage.mockReset()
    showInformationMessage.mockReset()
    executeCommand.mockReset()
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

  it("debounces file edit notifications and opens the most recent file", async () => {
    vi.useFakeTimers()
    showInformationMessage.mockResolvedValue("Open File")
    const { activate } = await import("./extension.js")

    await activate(ctx())

    events[0]?.onEvent?.("file.edited", { file: "/workspace/first.ts" })
    await vi.advanceTimersByTimeAsync(1000)
    events[0]?.onEvent?.("file.edited", { file: "/workspace/second.ts" })
    await vi.advanceTimersByTimeAsync(2000)

    expect(showInformationMessage).toHaveBeenCalledTimes(1)
    expect(showInformationMessage).toHaveBeenCalledWith("OpenCode edited 2 files", "Open File")
    expect(showTextDocument).toHaveBeenCalledWith({ fsPath: "/workspace/second.ts" })
  })

  it("shows the basename when a single file was edited", async () => {
    vi.useFakeTimers()
    showInformationMessage.mockResolvedValue(undefined)
    const { activate } = await import("./extension.js")

    await activate(ctx())

    events[0]?.onEvent?.("file.edited", { file: "/workspace/nested/note.ts" })
    await vi.advanceTimersByTimeAsync(2000)

    expect(showInformationMessage).toHaveBeenCalledWith("OpenCode edited: note.ts", "Open File")
    expect(showTextDocument).not.toHaveBeenCalled()
  })

  it("skips file edit notifications when disabled", async () => {
    vi.useFakeTimers()
    getConfiguration.mockReturnValue(config({ "notifications.fileEdits": false }))
    const { activate } = await import("./extension.js")

    await activate(ctx())

    events[0]?.onEvent?.("file.edited", { file: "/workspace/nested/note.ts" })
    await vi.advanceTimersByTimeAsync(2000)

    expect(showInformationMessage).not.toHaveBeenCalled()
    expect(showTextDocument).not.toHaveBeenCalled()
  })

  it("filePayload guard accepts valid and rejects invalid payloads", async () => {
    vi.useFakeTimers()
    const { activate } = await import("./extension.js")

    await activate(ctx())

    events[0]?.onEvent?.("file.edited", { file: "/workspace/valid.ts" })
    await vi.advanceTimersByTimeAsync(2000)

    expect(showInformationMessage).toHaveBeenCalledWith("OpenCode edited: valid.ts", "Open File")

    showInformationMessage.mockClear()
    showTextDocument.mockClear()

    events[0]?.onEvent?.("file.edited", { notFile: 123 })
    await vi.advanceTimersByTimeAsync(2000)

    expect(showInformationMessage).not.toHaveBeenCalled()
    expect(showTextDocument).not.toHaveBeenCalled()
  })

  it("preserves recency when the same file is edited again", async () => {
    vi.useFakeTimers()
    showInformationMessage.mockResolvedValue("Open File")
    const { activate } = await import("./extension.js")

    await activate(ctx())

    events[0]?.onEvent?.("file.edited", { file: "/workspace/a.ts" })
    await vi.advanceTimersByTimeAsync(250)
    events[0]?.onEvent?.("file.edited", { file: "/workspace/b.ts" })
    await vi.advanceTimersByTimeAsync(250)
    events[0]?.onEvent?.("file.edited", { file: "/workspace/a.ts" })
    await vi.advanceTimersByTimeAsync(2000)

    expect(showInformationMessage).toHaveBeenCalledTimes(1)
    expect(showInformationMessage).toHaveBeenCalledWith("OpenCode edited 2 files", "Open File")
    expect(showTextDocument).toHaveBeenCalledWith({ fsPath: "/workspace/a.ts" })
  })

  it("flushes a snapshot before starting the next file batch", async () => {
    vi.useFakeTimers()
    let resolveFirst: ((value: string | undefined) => void) | undefined
    showInformationMessage.mockImplementationOnce(
      () =>
        new Promise<string | undefined>((resolve) => {
          resolveFirst = resolve
        }),
    )
    showInformationMessage.mockResolvedValue(undefined)
    const { activate } = await import("./extension.js")

    await activate(ctx())

    events[0]?.onEvent?.("file.edited", { file: "/workspace/one.ts" })
    events[0]?.onEvent?.("file.edited", { file: "/workspace/two.ts" })

    await vi.advanceTimersByTimeAsync(2000)

    expect(showInformationMessage).toHaveBeenNthCalledWith(1, "OpenCode edited 2 files", "Open File")

    events[0]?.onEvent?.("file.edited", { file: "/workspace/three.ts" })
    resolveFirst?.(undefined)
    await vi.advanceTimersByTimeAsync(2000)

    expect(showInformationMessage).toHaveBeenNthCalledWith(2, "OpenCode edited: three.ts", "Open File")
  })

  it("skips git integration when autoDiff is disabled", async () => {
    vi.useFakeTimers()
    const { activate } = await import("./extension.js")

    await activate(ctx())
    await flushEditedFiles(["/workspace/off.ts"])

    expect(getExtension).not.toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it("logs and skips when the git extension is inactive", async () => {
    vi.useFakeTimers()
    getConfiguration.mockReturnValue(config({ autoDiff: true }))
    getExtension.mockReturnValue({ isActive: false })
    const { activate } = await import("./extension.js")

    await activate(ctx())
    await flushEditedFiles(["/workspace/inactive.ts"])

    expect(getExtension).toHaveBeenCalledWith("vscode.git")
    expect(executeCommand).not.toHaveBeenCalled()
    expect(outputLines().some((line) => line.includes("autoDiff: git extension not active, skipping"))).toBe(true)
  })

  it("logs and skips when git.getAPI throws", async () => {
    vi.useFakeTimers()
    getConfiguration.mockReturnValue(config({ autoDiff: true }))
    getExtension.mockReturnValue({
      exports: {
        getAPI: vi.fn(() => {
          throw new Error("git api unavailable")
        }),
      },
      isActive: true,
    })
    const { activate } = await import("./extension.js")

    await activate(ctx())
    await flushEditedFiles(["/workspace/api-throw.ts"])

    expect(executeCommand).not.toHaveBeenCalled()
    expect(
      outputLines().some((line) =>
        line.includes("autoDiff: git.getAPI(1) threw, skipping: Error: git api unavailable"),
      ),
    ).toBe(true)
  })

  it("opens tracked modifications with git.openChange after priming repo status", async () => {
    vi.useFakeTimers()
    getConfiguration.mockReturnValue(config({ autoDiff: true }))
    const gitApi = mockGitApi(new Map([["/workspace", { untracked: [] }]]))
    const repo = gitApi.repositories[0]
    const status = repo?.status as ReturnType<typeof vi.fn> | undefined
    useGitApi(gitApi)
    const { activate } = await import("./extension.js")

    await activate(ctx())
    await flushEditedFiles(["/workspace/tracked.ts"])

    expect(status).toHaveBeenCalledTimes(1)
    expect(executeCommand).toHaveBeenCalledTimes(1)
    expect(executeCommand).toHaveBeenCalledWith("git.openChange", { fsPath: "/workspace/tracked.ts" })
    expect(status?.mock.invocationCallOrder[0]).toBeLessThan(executeCommand.mock.invocationCallOrder[0] ?? Infinity)
  })

  it("opens untracked files with vscode.diff and an empty left uri", async () => {
    vi.useFakeTimers()
    getConfiguration.mockReturnValue(config({ autoDiff: true }))
    const gitApi = mockGitApi(new Map([["/workspace", { untracked: ["/workspace/new-file.ts"] }]]))
    const repo = gitApi.repositories[0]
    useGitApi(gitApi)
    const { activate } = await import("./extension.js")

    await activate(ctx())
    await flushEditedFiles(["/workspace/new-file.ts"])

    const left = executeCommand.mock.calls[0]?.[1] as { toString: () => string }
    expect(repo?.status).toHaveBeenCalledTimes(1)
    expect(executeCommand).toHaveBeenCalledTimes(1)
    expect(executeCommand).toHaveBeenCalledWith(
      "vscode.diff",
      expect.anything(),
      { fsPath: "/workspace/new-file.ts" },
      "new-file.ts (New File)",
    )
    expect(left.toString()).toBe("untitled:new-file.ts.empty")
  })

  it("primes each repository only once for multi-repo snapshots", async () => {
    vi.useFakeTimers()
    getConfiguration.mockReturnValue(config({ autoDiff: true }))
    const gitApi = mockGitApi(
      new Map([
        ["/repo-a", { untracked: [] }],
        ["/repo-b", { untracked: [] }],
      ]),
    )
    useGitApi(gitApi)
    const { activate } = await import("./extension.js")

    await activate(ctx())
    await flushEditedFiles(["/repo-a/one.ts", "/repo-a/two.ts", "/repo-b/three.ts", "/repo-b/four.ts"])

    expect(gitApi.repositories[0]?.status).toHaveBeenCalledTimes(1)
    expect(gitApi.repositories[1]?.status).toHaveBeenCalledTimes(1)
    expect(executeCommand).toHaveBeenCalledTimes(4)
  })

  it("continues processing when some files are outside a git repo", async () => {
    vi.useFakeTimers()
    getConfiguration.mockReturnValue(config({ autoDiff: true }))
    const gitApi = mockGitApi(new Map([["/workspace", { untracked: [] }]]))
    const repo = gitApi.repositories[0]
    useGitApi(gitApi)
    const { activate } = await import("./extension.js")

    await activate(ctx())
    await flushEditedFiles(["/workspace/in-repo.ts", "/outside/no-repo.ts"])

    expect(repo?.status).toHaveBeenCalledTimes(1)
    expect(executeCommand).toHaveBeenCalledTimes(1)
    expect(executeCommand).toHaveBeenCalledWith("git.openChange", { fsPath: "/workspace/in-repo.ts" })
    expect(outputLines().some((line) => line.includes("autoDiff: no git repo for /outside/no-repo.ts"))).toBe(true)
  })

  it("logs repo.status failures and still opens tracked changes", async () => {
    vi.useFakeTimers()
    getConfiguration.mockReturnValue(config({ autoDiff: true }))
    const gitApi = mockGitApi(new Map([["/workspace", { statusError: new Error("status failed"), untracked: [] }]]))
    const repo = gitApi.repositories[0]
    useGitApi(gitApi)
    const { activate } = await import("./extension.js")

    await activate(ctx())
    await flushEditedFiles(["/workspace/status-error.ts"])

    expect(repo?.status).toHaveBeenCalledTimes(1)
    expect(executeCommand).toHaveBeenCalledWith("git.openChange", { fsPath: "/workspace/status-error.ts" })
    expect(
      outputLines().some((line) =>
        line.includes("autoDiff: repo.status() failed for /workspace: Error: status failed"),
      ),
    ).toBe(true)
  })

  it("logs git.openChange failures and continues with later files", async () => {
    vi.useFakeTimers()
    getConfiguration.mockReturnValue(config({ autoDiff: true }))
    const gitApi = mockGitApi(new Map([["/workspace", { untracked: [] }]]))
    useGitApi(gitApi)
    executeCommand.mockImplementation(async (...args: unknown[]) => {
      const command = args[0]
      const uri = args[1] as { fsPath: string } | undefined
      if (command === "git.openChange" && uri?.fsPath === "/workspace/first.ts") {
        throw new Error("openChange failed")
      }
      return undefined
    })
    const { activate } = await import("./extension.js")

    await activate(ctx())
    await flushEditedFiles(["/workspace/first.ts", "/workspace/second.ts"])

    expect(executeCommand).toHaveBeenCalledTimes(2)
    expect(executeCommand).toHaveBeenNthCalledWith(1, "git.openChange", { fsPath: "/workspace/first.ts" })
    expect(executeCommand).toHaveBeenNthCalledWith(2, "git.openChange", { fsPath: "/workspace/second.ts" })
    expect(
      outputLines().some((line) => line.includes("autoDiff: failed for /workspace/first.ts: Error: openChange failed")),
    ).toBe(true)
  })

  it("file.watcher.updated triggers both sessions and providers refresh", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())

    const sessionTree = sessions[0] as { refresh: ReturnType<typeof vi.fn> }
    const providerTree = providers[0] as { refresh: ReturnType<typeof vi.fn> }
    sessionTree.refresh.mockClear()
    providerTree.refresh.mockClear()

    events[0]?.onEvent?.("file.watcher.updated", { event: "change", file: "/workspace/a.ts" })

    expect(sessionTree.refresh).toHaveBeenCalledOnce()
    expect(providerTree.refresh).toHaveBeenCalledOnce()
  })

  it("shows a session complete notification on busy to idle transition", async () => {
    showInformationMessage.mockResolvedValue("View Session")
    const { activate } = await import("./extension.js")

    await activate(ctx())

    const view = views[0] as {
      resolveWebviewView: (view: vscode.WebviewView) => void
    }
    view.resolveWebviewView({} as vscode.WebviewView)

    events[0]?.onEvent?.("session.status", { sessionID: "ses_1", status: { type: "busy" } })
    events[0]?.onEvent?.("session.idle", { sessionID: "ses_1" })
    await tick()

    expect(showInformationMessage).toHaveBeenCalledWith("OpenCode: Agent completed", "View Session")
    expect(executeCommand).toHaveBeenNthCalledWith(1, "workbench.view.extension.opencode-web")
    expect(executeCommand).toHaveBeenNthCalledWith(2, "opencode-web.chatView.focus")
    expect((bridges[0] as { post: ReturnType<typeof vi.fn> } | undefined)?.post).toHaveBeenCalledWith(
      "opencode-web.navigate",
      { sessionId: "ses_1" },
    )
  })

  it("does not notify when the session was already idle", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())

    events[0]?.onEvent?.("session.status", { sessionID: "ses_1", status: { type: "idle" } })
    events[0]?.onEvent?.("session.idle", { sessionID: "ses_1" })
    await tick()

    expect(showInformationMessage).not.toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it("does not notify when no prior session status was tracked", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())

    events[0]?.onEvent?.("session.idle", { sessionID: "ses_new" })
    await tick()

    expect(showInformationMessage).not.toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it("sessionIdlePayload guard rejects invalid payload shape", async () => {
    const { activate } = await import("./extension.js")

    await activate(ctx())

    events[0]?.onEvent?.("session.status", { sessionID: "ses_1", status: { type: "busy" } })
    events[0]?.onEvent?.("session.idle", { id: "ses_1" })
    await tick()

    expect(showInformationMessage).not.toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it("skips session complete notifications when disabled", async () => {
    getConfiguration.mockReturnValue(config({ "notifications.sessionComplete": false }))
    const { activate } = await import("./extension.js")

    await activate(ctx())

    events[0]?.onEvent?.("session.status", { sessionID: "ses_1", status: { type: "busy" } })
    events[0]?.onEvent?.("session.idle", { sessionID: "ses_1" })
    await tick()

    expect(showInformationMessage).not.toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalled()
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
