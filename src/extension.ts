import * as vscode from "vscode"
import { registerCommands } from "./commands/registry.js"
import { EventListener } from "./events/listener.js"
import { findBinary } from "./process/discover.js"
import { ProcessManager } from "./process/manager.js"
import { createClient, updateDirectory } from "./sdk/client.js"
import { start as startSpa } from "./spa/server.js"
import { currentFolder } from "./utils/workspace.js"
import { OpenCodeLensProvider } from "./views/codelens.js"
import { DiffProvider, scheme } from "./views/diff.js"
import { ProvidersProvider } from "./views/providers.js"
import { SessionsProvider } from "./views/sessions.js"
import { createStatusBar } from "./views/statusbar.js"
import { MessageBridge, MSG } from "./webview/bridge.js"
import { OpenCodeWebviewProvider, VIEW_ID } from "./webview/provider.js"

let dump: ((msg: string) => void) | undefined

type Sdk = Awaited<ReturnType<typeof createClient>>

type Model = {
  id?: string
  name?: string
}

type Provider = {
  id: string
  models?: Record<string, Model>
  name?: string
}

type ProviderList = {
  data?: {
    all?: Provider[]
    connected?: string[]
  }
}

type Session = {
  id: string
  time: {
    created: number
    updated: number
  }
  title: string
}

type SessionList = {
  data?: Session[]
}

type Raw = {
  event?: {
    subscribe?: (
      input?: {
        directory?: string
        workspace?: string
      },
      opts?: {
        signal?: AbortSignal
        onSseError?: (error: unknown) => void
        onSseEvent?: (event: unknown) => void
        sseMaxRetryAttempts?: number
      },
    ) => Promise<{
      stream: AsyncIterable<unknown>
    }>
  }
  provider?: {
    list?: () => Promise<ProviderList>
  }
  session?: {
    diff?: (input: { sessionID: string }) => Promise<{ data?: unknown }>
    list?: () => Promise<SessionList>
  }
  tui?: {
    appendPrompt?: (input: { text?: string }) => Promise<unknown>
  }
}

function obj(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function msg(err: unknown) {
  if (err instanceof Error) return err.message
  return String(err)
}

function code(input: unknown) {
  if (!obj(input)) return
  if (typeof input.text === "string") return input.text
  if (typeof input.code === "string") return input.code
}

function file(input: unknown) {
  if (!obj(input)) return
  if (typeof input.path === "string") return input.path
  if (typeof input.file === "string") return input.file
}

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("OpenCode")
  context.subscriptions.push(output)

  const { writeFileSync, appendFileSync } = await import("node:fs")
  const { join, basename } = await import("node:path")
  const log = join(context.extensionPath, "debug.log")
  writeFileSync(log, `=== OpenCode Debug Log ===\n${new Date().toISOString()}\n\n`)
  dump = (msg: string) => {
    appendFileSync(log, `[${new Date().toISOString()}] ${msg}\n`)
  }
  const trace = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`
    output.appendLine(line)
    appendFileSync(log, `${line}\n`)
  }
  function filePayload(v: unknown): v is { file: string } {
    return obj(v) && typeof (v as Record<string, unknown>).file === "string"
  }
  function sessionStatusPayload(v: unknown): v is { sessionID: string; status: { type: string } } {
    if (!obj(v)) return false
    const r = v as Record<string, unknown>
    if (typeof r.sessionID !== "string") return false
    if (!obj(r.status)) return false
    return typeof (r.status as Record<string, unknown>).type === "string"
  }
  function sessionIdlePayload(v: unknown): v is { sessionID: string } {
    return obj(v) && typeof (v as Record<string, unknown>).sessionID === "string"
  }
  const pendingFiles = new Map<string, number>()
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  const DEBOUNCE_MS = 2000

  function handleFileEdited(filePath: string) {
    pendingFiles.delete(filePath)
    pendingFiles.set(filePath, Date.now())
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(flushPendingFiles, DEBOUNCE_MS)
    debounceTimer.unref?.()
  }
  async function flushPendingFiles() {
    debounceTimer = undefined
    if (pendingFiles.size === 0) return
    const snapshot = new Map(pendingFiles)
    pendingFiles.clear()
    await notifyFileEdits(snapshot)
    await openDiffsForSnapshot(snapshot)
  }
  async function notifyFileEdits(snapshot: Map<string, number>) {
    const cfg = vscode.workspace.getConfiguration("opencode")
    if (!cfg.get<boolean>("notifications.fileEdits", true)) return

    let lastFile: string | undefined
    for (const key of snapshot.keys()) lastFile = key
    if (!lastFile) return

    const message =
      snapshot.size === 1 ? `OpenCode edited: ${basename(lastFile)}` : `OpenCode edited ${snapshot.size} files`

    const action = await vscode.window.showInformationMessage(message, "Open File")
    if (action === "Open File") {
      await vscode.window.showTextDocument(vscode.Uri.file(lastFile))
    }
  }
  type GitResource = { uri: vscode.Uri }
  type GitRepository = {
    rootUri: vscode.Uri
    state: { untrackedChanges: readonly GitResource[] }
    status: () => Thenable<void>
  }
  type GitApi = {
    repositories: readonly GitRepository[]
    getRepository: (uri: vscode.Uri) => GitRepository | null
  }
  async function openDiffsForSnapshot(snapshot: Map<string, number>) {
    const cfg = vscode.workspace.getConfiguration("opencode")
    if (!cfg.get<boolean>("autoDiff", false)) return

    const gitExt = vscode.extensions.getExtension("vscode.git")
    if (!gitExt || !gitExt.isActive) {
      trace("autoDiff: git extension not active, skipping")
      return
    }

    let gitApi: GitApi
    try {
      gitApi = (gitExt.exports as { getAPI: (v: number) => GitApi }).getAPI(1)
    } catch (err) {
      trace(`autoDiff: git.getAPI(1) threw, skipping: ${String(err)}`)
      return
    }

    const fileToRepo = new Map<string, GitRepository>()
    const uniqueRepos = new Map<string, GitRepository>()
    for (const filePath of snapshot.keys()) {
      const repo = gitApi.getRepository(vscode.Uri.file(filePath))
      if (!repo) {
        trace(`autoDiff: no git repo for ${filePath}`)
        continue
      }
      fileToRepo.set(filePath, repo)
      uniqueRepos.set(repo.rootUri.fsPath, repo)
    }

    await Promise.all(
      Array.from(uniqueRepos.values()).map(async (repo) => {
        try {
          await repo.status()
        } catch (err) {
          trace(`autoDiff: repo.status() failed for ${repo.rootUri.fsPath}: ${String(err)}`)
        }
      }),
    )

    for (const [filePath, repo] of fileToRepo) {
      const uri = vscode.Uri.file(filePath)
      const isUntracked = repo.state.untrackedChanges.some((resource) => resource.uri.fsPath === filePath)

      try {
        if (isUntracked) {
          const emptyUri = vscode.Uri.parse(`untitled:${basename(filePath)}.empty`)
          const title = `${basename(filePath)} (New File)`
          await vscode.commands.executeCommand("vscode.diff", emptyUri, uri, title)
        } else {
          await vscode.commands.executeCommand("git.openChange", uri)
        }
      } catch (err) {
        trace(`autoDiff: failed for ${filePath}: ${String(err)}`)
      }
    }
  }
  const statusMap = new Map<string, string>()
  async function handleSessionIdle(sessionID: string) {
    const cfg = vscode.workspace.getConfiguration("opencode")
    if (!cfg.get<boolean>("notifications.sessionComplete", true)) return

    const last = statusMap.get(sessionID)
    if (last !== "busy") return

    statusMap.set(sessionID, "idle")

    const action = await vscode.window.showInformationMessage("OpenCode: Agent completed", "View Session")
    if (action === "View Session") {
      await vscode.commands.executeCommand("workbench.view.extension.opencode-web")
      await vscode.commands.executeCommand("opencode-web.chatView.focus")
      bridge?.post(MSG.navigate, { sessionId: sessionID })
    }
  }
  function handleSessionStatus(sessionID: string, statusType: string) {
    statusMap.set(sessionID, statusType)
  }
  trace("[ext] activate")

  const folders = vscode.workspace.workspaceFolders
  trace(`workspaceFolders count: ${folders?.length ?? 0}`)
  if (folders) for (let i = 0; i < folders.length; i++) trace(`  folder[${i}]: ${folders[i].uri.fsPath}`)

  const cfg = vscode.workspace.getConfiguration("opencode")
  const port = cfg.get<number>("port", 57777)
  const auto = cfg.get<boolean>("autoStart", true)
  const pwd = cfg.get<string>("serverPassword", "")
  const bin = findBinary()

  trace(`binary: ${bin ? `${bin.path} (${bin.version})` : "NOT FOUND"}`)
  trace(`port: ${port}, autoStart: ${auto}`)

  const cwd = folders?.[0]?.uri.fsPath
  trace(`spawn cwd: ${cwd ?? "(none)"}`)

  const manager = new ProcessManager(port, { dir: cwd, password: pwd || undefined })
  context.subscriptions.push(manager)

  let sdk: Sdk | null = null
  let dir = ""
  let bridge: MessageBridge | null = null
  let root = ""
  let subs: vscode.Disposable[] = []

  const getSdk = () => sdk
  const getRaw = (): Raw | null => {
    const item = sdk?.client
    if (!item || typeof item !== "object") return null
    return item as Raw
  }
  const slug = (input: string) =>
    Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
  const check = async (dir: string) => {
    const url = manager.getUrl()
    if (!url || !sdk) return { has: false, url }

    const res = await fetch(new URL("/project", url), {
      headers: { Authorization: sdk.auth },
    }).catch(() => null)
    const list = (await res?.json().catch(() => [])) as Array<{ worktree?: string }> | null
    return {
      has: Array.isArray(list) && list.some((item) => item.worktree === dir),
      url,
    }
  }
  const home = async (url: string) => {
    const web = vscode.workspace.getConfiguration("opencode").get<string>("webUrl")?.trim()
    if (web) return web
    if (root) return root

    const dist = vscode.Uri.joinPath(context.extensionUri, "spa").fsPath
    trace(`SPA dist path: ${dist}`)
    trace(`SPA stable port target: ${url}`)
    const spa = await startSpa({ dist, backend: url, log: trace }).catch((err: unknown) => {
      trace(`SPA server failed: ${err}`)
      return null
    })
    if (!spa) return url

    root = `http://127.0.0.1:${spa.port}`
    trace(`SPA server on port ${spa.port}`)
    context.subscriptions.push({ dispose: () => spa.server.close() })
    return root
  }

  const webview = new OpenCodeWebviewProvider({
    url: manager.getUrl() ?? "about:blank",
  })
  webview.log = trace
  webview.onSession = (id) => {
    context.workspaceState.update("lastSessionId", id)
    trace(`[session-persist] saved=${id ?? "cleared"}`)
  }
  context.subscriptions.push({ dispose: () => trace("[ext] dispose") })

  const sessions = new SessionsProvider(getRaw)
  sessions.setLog(trace)
  const providers = new ProvidersProvider(getRaw)
  const diff = new DiffProvider(getRaw)
  const lens = new OpenCodeLensProvider()
  const events = new EventListener({
    getClient: getSdk,
    onEvent: (type, payload) => {
      output.appendLine(`[SSE] ${type}`)

      if (type === "file.edited" && filePayload(payload)) handleFileEdited(payload.file)
      if (type === "session.idle" && sessionIdlePayload(payload)) handleSessionIdle(payload.sessionID)
      if (type === "session.status" && sessionStatusPayload(payload))
        handleSessionStatus(payload.sessionID, payload.status.type)

      if (type === "file.watcher.updated") {
        sessions.refresh()
        providers.refresh()
      }

      if (type.startsWith("session.")) sessions.refresh()
      if (type.startsWith("provider.")) providers.refresh()
    },
  })

  const clear = () => {
    subs.forEach((item) => {
      item.dispose()
    })
    subs = []
    bridge?.dispose()
    bridge = null
  }

  const stop = () => {
    events.stop()
    sdk = null
    sessions.refresh()
    providers.refresh()
  }

  const open = async (input: unknown) => {
    const path = file(input)
    if (!path) return

    const doc = await Promise.resolve(vscode.workspace.openTextDocument(vscode.Uri.file(path))).then(
      (item) => item,
      () => null,
    )
    if (!doc) return

    await Promise.resolve(vscode.window.showTextDocument(doc)).then(
      () => null,
      () => null,
    )
  }

  const copy = async (input: unknown) => {
    const text = code(input)
    if (!text) return
    await Promise.resolve(vscode.env.clipboard.writeText(text)).then(
      () => null,
      () => null,
    )
  }

  const sync = async (next: string | undefined, force?: boolean) => {
    const target = next ?? ""
    if (!force && target === dir) return
    dir = target

    if (!sdk) return

    sessions.refresh()
    providers.refresh()

    if (!dir) {
      webview.setUrl("about:blank")
      return
    }

    webview.setState("loading")

    const item = await check(dir)
    if (!item.url) return

    if (item.has) {
      const cfg = await updateDirectory(sdk, dir).catch((err) => {
        output.appendLine(`Directory update failed: ${msg(err)}`)
        return null
      })
      if (!cfg) return

      sdk = cfg
      const base = await home(item.url)
      if (base) webview.setUrl(`${base}/${slug(dir)}`)
      return
    }

    webview.setUrl(await home(item.url))
  }

  const link = async (url: string, password: string) => {
    dir = currentFolder() ?? ""
    trace(`link() dir: ${dir || "(empty)"}`)
    trace(`link() url: ${url}`)
    trace(`link() password: ${password ? "(set)" : "(none)"}`)
    sdk = await createClient({
      directory: "",
      password,
      url,
    })
    trace(`SDK client created with directory: (empty)`)

    events.stop()
    await events.start()
    trace("[link] calling sessions.refresh()")
    sessions.refresh()
    providers.refresh()

    if (!dir) {
      root = ""
      webview.setUrl("about:blank")
      return
    }

    webview.setState("loading")

    const item = await check(dir)
    if (!item.url) return

    if (!item.has) {
      webview.setUrl(await home(item.url))
      return
    }

    const cfg = await updateDirectory(sdk, dir).catch((err) => {
      output.appendLine(`Directory update failed: ${msg(err)}`)
      return null
    })
    if (!cfg) return

    sdk = cfg
    const base = await home(url)

    const last = context.workspaceState.get<string>("lastSessionId")
    const session = last ? `/session/${last}` : ""
    const target = `${base}/${slug(dir)}${session}`
    trace(`iframe URL: ${target} (lastSession=${last ?? "none"})`)
    trace(`base64 slug: ${slug(dir)}`)
    webview.setUrl(target)
  }

  const create = async () => {
    if (!manager.getStatus() || !sdk) {
      void vscode.window.showErrorMessage("OpenCode server is not running")
      return
    }

    const raw = sdk.client as unknown as Record<string, unknown>
    const proj = raw.project as { initGit?: () => Promise<unknown> } | undefined

    try {
      await proj?.initGit?.()
      await sync(dir, true)
    } catch {
      void vscode.window.showErrorMessage("Failed to create project")
    }
  }

  const raw = webview.resolveWebviewView.bind(webview)
  webview.resolveWebviewView = (view) => {
    raw(view)
    clear()

    bridge = new MessageBridge(view)
    subs = [
      bridge,
      bridge.onMessage("opencode-web.diag", (data: unknown) => {
        const label = obj(data) && typeof data.label === "string" ? data.label : "?"
        const detail = obj(data) && typeof data.detail === "string" ? data.detail : ""
        trace(`[DIAG:${label}] ${detail}`)
      }),
      bridge.onMessage("opencode-web.create-project", () => {
        void create()
      }),
      bridge.onMessage(MSG.open_file, (input) => {
        void open(input)
      }),
      bridge.onMessage(MSG.copy_code, (input) => {
        void copy(input)
      }),
    ]
  }

  context.subscriptions.push({ dispose: clear })
  context.subscriptions.push({ dispose: stop })

  if (auto) {
    trace("Starting ProcessManager...")
    await manager
      .start()
      .then((item) => {
        trace(`ProcessManager started: url=${item.url}`)
        return link(item.url, item.password)
      })
      .catch((err) => {
        trace(`ProcessManager failed: ${msg(err)}`)
        output.appendLine(`Failed: ${msg(err)}`)
        void vscode.window.showWarningMessage("OpenCode: Failed to start server")
      })
    trace("ProcessManager start sequence complete")
  }

  const bar = createStatusBar(manager)
  context.subscriptions.push(bar)

  registerCommands(context, getSdk, {
    bridge: () => bridge,
    sessions,
  })

  const retain = { webviewOptions: { retainContextWhenHidden: true } } as const
  trace(`[retain] register view=${VIEW_ID} retainContextWhenHidden=${retain.webviewOptions.retainContextWhenHidden}`)
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, webview, retain))
  context.subscriptions.push(vscode.window.registerTreeDataProvider("opencode-web.sessions", sessions))
  context.subscriptions.push(vscode.window.registerTreeDataProvider("opencode-web.providers", providers))
  if (sdk) {
    trace("[post-register] sdk ready, refreshing trees")
    sessions.refresh()
    providers.refresh()
  }
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(scheme, diff))
  context.subscriptions.push(vscode.languages.registerCodeLensProvider({ scheme: "file" }, lens))
  context.subscriptions.push(events)
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void sync(currentFolder())
    }),
  )
  context.subscriptions.push(
    manager.onStatusChange((status) => {
      output.appendLine(`OpenCode status: ${status}`)

      if (status === "running") {
        const url = manager.getUrl()
        const password = manager.getPassword()

        const web = vscode.workspace.getConfiguration("opencode").get<string>("webUrl")?.trim()
        const base = web || root || url
        if (base) webview.setUrl(dir ? `${base}/${slug(dir)}` : base)
        if (!url || !password) return

        void link(url, password)
        return
      }

      if (status === "stopped") {
        webview.setUrl("about:blank")
      }

      if (status === "stopped" || status === "error") {
        stop()
      }
    }),
  )
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("opencode")) return
      output.appendLine("OpenCode configuration changed, restart required")
    }),
  )
}

export function deactivate() {
  dump?.("[ext] deactivate")
}
