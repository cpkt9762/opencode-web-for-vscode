import * as vscode from "vscode"
import { registerCommands } from "./commands/registry.js"
import { EventListener } from "./events/listener.js"
import { findBinary } from "./process/discover.js"
import { ProcessManager } from "./process/manager.js"
import { createClient, updateDirectory } from "./sdk/client.js"
import { start as startSpa } from "./spa/server.js"
import { getDirectory, onDirectoryChange } from "./utils/workspace.js"
import { OpenCodeLensProvider } from "./views/codelens.js"
import { showPermission, showQuestion } from "./views/dialogs.js"
import { DiffProvider, scheme } from "./views/diff.js"
import { ProvidersProvider } from "./views/providers.js"
import { SessionsProvider } from "./views/sessions.js"
import { createStatusBar } from "./views/statusbar.js"
import { MessageBridge, MSG } from "./webview/bridge.js"
import { OpenCodeWebviewProvider, VIEW_ID } from "./webview/provider.js"

const WAIT = 1500

type Sdk = Awaited<ReturnType<typeof createClient>>
type Reply = Awaited<ReturnType<typeof showPermission>>

type Opt = string | { label?: string }

type Ask = {
  id: string
  questions?: Array<{
    options?: Opt[]
    question?: string
  }>
}

type Model = {
  id?: string
  name?: string
}

type Perm = {
  id: string
  patterns?: string[]
  permission?: string
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
  permission?: {
    list?: () => Promise<{ data?: Perm[] }>
    reply?: (input: { requestID: string; reply: Reply }) => Promise<unknown>
  }
  provider?: {
    list?: () => Promise<ProviderList>
  }
  question?: {
    list?: () => Promise<{ data?: Ask[] }>
    reject?: (input: { requestID: string }) => Promise<unknown>
    reply?: (input: { answers?: string[][]; requestID: string }) => Promise<unknown>
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

function opts(list: Opt[] | undefined) {
  return (list ?? []).flatMap((item) => {
    if (typeof item === "string") return [item]
    if (!obj(item) || typeof item.label !== "string") return []
    return [item.label]
  })
}

function desc(item: Perm) {
  const head = item.permission ?? "Permission request"
  const tail = (item.patterns ?? []).filter((item) => typeof item === "string")
  if (tail.length === 0) return head
  return `${head}\n${tail.join("\n")}`
}

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("OpenCode")
  context.subscriptions.push(output)

  const { writeFileSync, appendFileSync } = await import("node:fs")
  const { join } = await import("node:path")
  const log = join(context.extensionPath, "debug.log")
  writeFileSync(log, `=== OpenCode Debug Log ===\n${new Date().toISOString()}\n\n`)
  const trace = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`
    output.appendLine(line)
    appendFileSync(log, line + "\n")
  }

  const folders = vscode.workspace.workspaceFolders
  trace(`workspaceFolders count: ${folders?.length ?? 0}`)
  if (folders) for (let i = 0; i < folders.length; i++) trace(`  folder[${i}]: ${folders[i].uri.fsPath}`)

  const cfg = vscode.workspace.getConfiguration("opencode")
  const port = cfg.get<number>("port", 57777)
  const auto = cfg.get<boolean>("autoStart", true)
  const bin = findBinary()

  trace(`binary: ${bin ? `${bin.path} (${bin.version})` : "NOT FOUND"}`)
  trace(`port: ${port}, autoStart: ${auto}`)

  const cwd = folders?.[0]?.uri.fsPath
  trace(`spawn cwd: ${cwd ?? "(none)"}`)

  const manager = new ProcessManager(port, { dir: cwd })
  context.subscriptions.push(manager)

  let sdk: Sdk | null = null
  let dir = ""
  let bridge: MessageBridge | null = null
  let loop: ReturnType<typeof setInterval> | undefined
  let busy = false
  let subs: vscode.Disposable[] = []

  const seen = new Set<string>()
  const getSdk = () => sdk
  const getRaw = (): Raw | null => {
    const item = sdk?.client
    if (!item || typeof item !== "object") return null
    return item as Raw
  }
  const workspace = (item: vscode.TextEditor | undefined) => {
    const uri = item?.document.uri
    if (!uri) return
    return vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath
  }

  const webview = new OpenCodeWebviewProvider({
    url: manager.getUrl() ?? "about:blank",
  })
  webview.log = trace
  webview.onSession = (id) => {
    context.workspaceState.update("lastSessionId", id)
    trace(`[session-persist] saved=${id ?? "cleared"}`)
  }

  const sessions = new SessionsProvider(getRaw)
  sessions.setLog(trace)
  const providers = new ProvidersProvider(getRaw)
  const diff = new DiffProvider(getRaw)
  const lens = new OpenCodeLensProvider()
  const events = new EventListener({
    getClient: getSdk,
    onEvent: (type) => {
      output.appendLine(`[SSE] ${type}`)

      if (type.startsWith("session.")) sessions.refresh()
      if (type.startsWith("provider.")) providers.refresh()
      if (type.includes("permission") || type.includes("question")) {
        void pull()
      }
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
    if (loop) {
      clearInterval(loop)
      loop = undefined
    }
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

  const ask = async (api: NonNullable<Raw["question"]>, item: Ask) => {
    const list = item.questions ?? []
    if (list.length === 0) {
      await api.reject?.({ requestID: item.id })
      return
    }

    const answers: string[][] = []

    for (const row of list) {
      const answer = await showQuestion({
        options: opts(row.options).length > 0 ? opts(row.options) : undefined,
        question: row.question ?? "Question",
        requestID: item.id,
      }).catch(() => null)

      if (answer === null) {
        await api.reject?.({ requestID: item.id })
        return
      }

      answers.push([answer])
    }

    await api.reply?.({ answers, requestID: item.id })
  }

  const pollPerm = async () => {
    const api = getRaw()?.permission
    if (!api?.list || !api.reply) return

    const list = await api
      .list()
      .then((item) => item.data ?? [])
      .catch(() => [])
    for (const item of list) {
      const id = `perm:${item.id}`
      if (seen.has(id)) continue

      seen.add(id)
      await showPermission({
        description: desc(item),
        requestID: item.id,
        type: item.permission ?? "permission",
      })
        .catch(() => "reject" as const)
        .then((reply) => api.reply?.({ reply, requestID: item.id }))
        .catch((err) => {
          output.appendLine(`Permission reply failed: ${msg(err)}`)
        })
        .finally(() => {
          seen.delete(id)
        })
    }
  }

  const pollAsk = async () => {
    const api = getRaw()?.question
    if (!api?.list || !api.reply || !api.reject) return

    const list = await api
      .list()
      .then((item) => item.data ?? [])
      .catch(() => [])
    for (const item of list) {
      const id = `ask:${item.id}`
      if (seen.has(id)) continue

      seen.add(id)
      await ask(api, item)
        .catch((err) => {
          output.appendLine(`Question reply failed: ${msg(err)}`)
        })
        .finally(() => {
          seen.delete(id)
        })
    }
  }

  const pull = async () => {
    if (busy) return
    busy = true

    try {
      await pollPerm()
      await pollAsk()
    } finally {
      busy = false
    }
  }

  const watch = () => {
    if (loop) return
    loop = setInterval(() => {
      void pull()
    }, WAIT)
    loop.unref?.()
  }

  const sync = async (next: string | undefined) => {
    if (!next || next === dir) return
    dir = next

    const cfg = sdk
    if (!cfg) return

    await updateDirectory(cfg, next)
      .then((item) => {
        sdk = item
        sessions.refresh()
        providers.refresh()
      })
      .catch((err) => {
        output.appendLine(`Directory update failed: ${msg(err)}`)
      })
  }

  const link = async (url: string, password: string) => {
    dir = dir || ((await getDirectory()) ?? "")
    trace(`link() dir: ${dir || "(empty)"}`)
    trace(`link() url: ${url}`)
    trace(`link() password: ${password ? "(set)" : "(none)"}`)
    sdk = await createClient({
      directory: dir,
      password,
      url,
    })
    trace(`SDK client created with directory: ${dir}`)

    if (dir) {
      const raw = sdk.client as unknown as Record<string, unknown>
      const project = raw.project as
        | {
            current?: (opts?: Record<string, unknown>) => Promise<unknown>
            initGit?: (opts?: Record<string, unknown>) => Promise<unknown>
          }
        | undefined
      if (project?.current) {
        const result = (await project.current().catch((e: unknown) => {
          trace(`project.current() ERROR: ${e}`)
          return null
        })) as { data?: { id?: string } } | null
        trace(`project.current() result: ${JSON.stringify(result).slice(0, 200)}`)

        if (result?.data?.id === "global" && project.initGit) {
          trace(`project is global, calling initGit...`)
          const git = await project.initGit().catch((e: unknown) => {
            trace(`project.initGit() ERROR: ${e}`)
            return null
          })
          trace(`project.initGit() result: ${JSON.stringify(git).slice(0, 200)}`)
        }
      }
    }

    events.stop()
    await events.start()
    watch()
    trace("[link] calling sessions.refresh()")
    sessions.refresh()
    providers.refresh()
    const slug = dir
      ? Buffer.from(dir).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
      : ""

    let base = vscode.workspace.getConfiguration("opencode").get<string>("webUrl")?.trim()
    if (!base) {
      const dist = vscode.Uri.joinPath(context.extensionUri, "spa").fsPath
      trace(`SPA dist path: ${dist}`)
      trace(`SPA stable port target: ${url}`)
      const spa = await startSpa({ dist, backend: url, log: trace }).catch((e: unknown) => {
        trace(`SPA server failed: ${e}`)
        return null
      })
      if (spa) {
        base = `http://127.0.0.1:${spa.port}`
        trace(`SPA server on port ${spa.port}`)
        context.subscriptions.push({ dispose: () => spa.server.close() })
      }
    }

    const last = context.workspaceState.get<string>("lastSessionId")
    const session = last ? `/session/${last}` : ""
    const target = slug ? `${base || url}/${slug}${session}` : base || url
    trace(`iframe URL: ${target} (lastSession=${last ?? "none"})`)
    trace(`base64 slug: ${slug || "(empty)"}`)
    webview.setUrl(target)
    webview.setState("ready")
    trace(`webview setState: ready`)
    void pull()
  }

  const raw = webview.resolveWebviewView.bind(webview)
  webview.resolveWebviewView = (view) => {
    raw(view)
    clear()

    bridge = new MessageBridge(view)
    subs = [
      bridge,
      bridge.onMessage("opencode-web.diag" as any, (data: any) => {
        const label = data?.label ?? "?"
        const detail = data?.detail ?? ""
        trace(`[DIAG:${label}] ${detail}`)
      }),
      bridge.onMessage(MSG.frame_ready, () => {
        void pull()
      }),
      bridge.onMessage(MSG.request_permission, () => {
        void pull()
      }),
      bridge.onMessage(MSG.request_question, () => {
        void pull()
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
    await manager
      .start()
      .then((item) => link(item.url, item.password))
      .catch((err) => {
        output.appendLine(`Failed: ${msg(err)}`)
        void vscode.window.showWarningMessage("OpenCode: Failed to start server")
      })
  }

  const bar = createStatusBar(manager)
  context.subscriptions.push(bar)

  registerCommands(context, getSdk, {
    bridge: () => bridge,
    sessions,
  })

  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, webview))
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
  context.subscriptions.push(onDirectoryChange((next) => void sync(next)))
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((item) => void sync(workspace(item))))
  context.subscriptions.push(
    manager.onStatusChange((status) => {
      output.appendLine(`OpenCode status: ${status}`)

      if (status === "running") {
        const url = manager.getUrl()
        const password = manager.getPassword()

        const slug = dir
          ? Buffer.from(dir).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
          : ""
        const web = vscode.workspace.getConfiguration("opencode").get<string>("webUrl")?.trim()
        const base = web || url
        if (base) webview.setUrl(slug ? `${base}/${slug}` : base)
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

export function deactivate() {}
