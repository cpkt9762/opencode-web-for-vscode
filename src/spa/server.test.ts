import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, request, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runInNewContext } from "node:vm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { API, start } from "./server.js"

const tmp = mkdtempSync(join(tmpdir(), "spa-server-"))
const html = `<!doctype html><html><head><title>Test</title></head><body></body></html>`

writeFileSync(join(tmp, "index.html"), html)
mkdirSync(join(tmp, "assets"), { recursive: true })
writeFileSync(join(tmp, "assets", "app.js"), "console.log(1)")

let backend: Server
let backendPort: number
let backendUrl: string
let spa: { server: Server; port: number }

function get(port: number, path: string): Promise<{ status: number; body: string; type: string }> {
  return new Promise((resolve, reject) => {
    const r = request(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = ""
      res.on("data", (c: Buffer) => (body += c.toString()))
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          body,
          type: res.headers["content-type"] ?? "",
        }),
      )
    })
    r.on("error", reject)
    r.end()
  })
}

function boot(body: string) {
  const m = body.match(/<script>([\s\S]*?)<\/script>/)
  if (!m) throw new Error("missing bootstrap")
  return m[1]
}

function slug(dir: string) {
  return Buffer.from(dir, "binary").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function runStorage(script: string, dir: string, seed: Record<string, string> = {}) {
  const map = new Map<string, string>()
  for (const [key, value] of Object.entries(seed)) map.set(key, value)
  const localStorage = {
    getItem(key: string) {
      const value = map.get(key)
      return value ?? null
    },
    setItem(key: string, value: string) {
      map.set(key, value)
    },
  }
  const document = {
    activeElement: null,
    addEventListener() {},
    body: { appendChild() {}, removeChild() {} },
    createElement() {
      return {
        style: { cssText: "" },
        appendChild() {},
        addEventListener() {},
        getBoundingClientRect() {
          return { width: 0, height: 0 }
        },
        parentNode: { removeChild() {} },
        textContent: "",
      }
    },
    createTextNode(text: string) {
      return { textContent: text }
    },
    createRange() {
      return { selectNodeContents() {} }
    },
    execCommand() {
      return false
    },
  }
  const window = {
    addEventListener() {},
    getSelection() {
      return {
        rangeCount: 0,
        toString() {
          return ""
        },
      }
    },
    innerHeight: 768,
    innerWidth: 1024,
    parent: { postMessage() {} },
  }
  class XHR {
    status = 200
    responseText = "[]"

    open() {}

    send() {}
  }
  const ctx = {
    JSON,
    Object,
    XMLHttpRequest: XHR,
    atob(value: string) {
      const pad = (4 - (value.length % 4 || 4)) % 4
      return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad), "base64").toString("binary")
    },
    decodeURIComponent,
    document,
    escape(value: string) {
      return value
    },
    localStorage,
    location: {
      hostname: "localhost",
      origin: "http://localhost:1",
      pathname: `/${slug(dir)}`,
    },
    navigator: { platform: "Mac" },
    window,
  }

  ;(window as typeof window & { document: typeof document }).document = document
  runInNewContext(script, ctx)
  return map
}

function run(script: string, dir: string, data: unknown) {
  const map = runStorage(script, dir, data === undefined ? {} : { "opencode.global.dat:server": JSON.stringify(data) })
  return JSON.parse(map.get("opencode.global.dat:server") ?? "null")
}

function runClipboard(
  script: string,
  opts: {
    acquireVsCodeApi?: () => { postMessage: (input: { command?: string; text?: string; type: string }) => void }
    execCommand?: (command: string) => boolean
    nativeWriteText?: (text: string) => Promise<void>
    useParentPostMessage?: boolean
  } = {},
) {
  const map = new Map<string, string>()
  map.set("opencode.global.dat:server", JSON.stringify({ lastProject: {}, list: [], projects: {} }))
  const commands: string[] = []
  const documentListeners: Array<{
    capture: boolean
    handler: (input: Record<string, unknown>) => void
    type: string
  }> = []
  const messages: Array<{ command?: string; text?: string; type: string }> = []
  const styles: string[] = []
  const textareas: Array<{ value: string }> = []
  const localStorage = {
    getItem(key: string) {
      const value = map.get(key)
      return value ?? null
    },
    setItem(key: string, value: string) {
      map.set(key, value)
    },
  }
  const document = {
    activeElement: null,
    addEventListener(
      type: string,
      handler: (input: Record<string, unknown>) => void,
      options?: boolean | AddEventListenerOptions,
    ) {
      documentListeners.push({
        capture: options === true || (typeof options === "object" && options.capture === true),
        handler,
        type,
      })
    },
    body: {
      appendChild() {},
      removeChild() {},
    },
    head: {
      appendChild(node: { textContent?: string }) {
        styles.push(node.textContent ?? "")
      },
    },
    createElement(tag?: string) {
      if (tag === "textarea") {
        const item = {
          focus() {},
          parentNode: { removeChild() {} },
          select() {},
          setAttribute() {},
          style: {} as Record<string, string>,
          value: "",
        }
        textareas.push(item)
        return item
      }

      return {
        id: "",
        style: { cssText: "" },
        appendChild() {},
        addEventListener() {},
        getBoundingClientRect() {
          return { height: 0, width: 0 }
        },
        parentNode: { removeChild() {} },
        textContent: "",
      }
    },
    createRange() {
      return { selectNodeContents() {} }
    },
    createTextNode(text: string) {
      return { textContent: text }
    },
    execCommand(command: string) {
      commands.push(command)
      return opts.execCommand?.(command) ?? false
    },
  }
  const window = {
    __opencodeVscodeApi: undefined as ReturnType<NonNullable<typeof opts.acquireVsCodeApi>> | undefined,
    addEventListener() {},
    getSelection() {
      return {
        rangeCount: 0,
        toString() {
          return ""
        },
      }
    },
    innerHeight: 768,
    innerWidth: 1024,
    parent:
      opts.useParentPostMessage === false
        ? undefined
        : {
            postMessage(input: { command?: string; text?: string; type: string }) {
              messages.push(input)
            },
          },
  }
  const navigator = {
    clipboard: opts.nativeWriteText ? { writeText: opts.nativeWriteText } : undefined,
    platform: "Mac",
  }
  class XHR {
    status = 200
    responseText = "[]"

    open() {}

    send() {}
  }
  const ctx = {
    Error,
    JSON,
    Object,
    Promise,
    XMLHttpRequest: XHR,
    acquireVsCodeApi: opts.acquireVsCodeApi,
    atob(value: string) {
      const pad = (4 - (value.length % 4 || 4)) % 4
      return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad), "base64").toString("binary")
    },
    decodeURIComponent,
    document,
    escape(value: string) {
      return value
    },
    localStorage,
    location: {
      hostname: "localhost",
      origin: "http://localhost:1",
      pathname: `/${slug("/tmp/current")}`,
    },
    navigator,
    window,
  }

  ;(window as typeof window & { document: typeof document }).document = document
  runInNewContext(script, ctx)
  return {
    commands,
    ctx: ctx as typeof ctx & {
      navigator: {
        clipboard: {
          writeText: (text: string) => Promise<void>
        }
      }
    },
    documentListeners,
    messages,
    styles,
    textareas,
  }
}

beforeAll(async () => {
  backend = createServer((req, res) => {
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ proxied: true, path: req.url }))
  })
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve))
  const addr = backend.address()
  backendPort = typeof addr === "object" && addr ? addr.port : 0
  backendUrl = `http://127.0.0.1:${backendPort}`

  spa = await start({
    dist: tmp,
    backend: backendUrl,
  })
})

afterAll(() => {
  spa?.server.close()
  backend?.close()
  rmSync(tmp, { recursive: true, force: true })
})

describe("spa proxy routes", () => {
  const routes = [
    "/global/health",
    "/auth/openai",
    "/doc",
    "/log",
    "/project/current",
    "/session",
    "/session/status",
    "/permission",
    "/question",
    "/provider",
    "/config",
    "/pty/spawn",
    "/mcp/status",
    "/experimental/workspace",
    "/tui/control",
    "/find?query=test",
    "/find/file?query=test",
    "/file?path=/tmp",
    "/file/content?path=/tmp/x",
    "/event",
    "/path",
    "/vcs",
    "/vcs/diff?mode=default",
    "/command",
    "/agent",
    "/skill",
    "/lsp",
    "/formatter",
    "/instance/dispose",
  ]

  for (const path of routes) {
    it(`proxies ${path.split("?")[0]}`, async () => {
      const res = await get(spa.port, path)
      expect(res.type).toContain("application/json")
      const body = JSON.parse(res.body)
      expect(body.proxied).toBe(true)
    })
  }
})

describe("spa sse proxy", () => {
  it("flushes headers early and streams each event before the next write", async () => {
    const sent: number[] = []
    const got: number[] = []
    const head: number[] = []
    const log: string[] = []
    const body = ["data: 1\n\n", "data: 2\n\n", "data: 3\n\n"]
    const live = createServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      })
      res.flushHeaders()

      const step = (i: number) => {
        if (i >= body.length) {
          res.end()
          return
        }

        setTimeout(
          () => {
            sent.push(Date.now())
            res.write(body[i])
            step(i + 1)
          },
          i === 0 ? 200 : 120,
        )
      }

      step(0)
    })
    await new Promise<void>((resolve) => live.listen(0, "127.0.0.1", resolve))
    const addr = live.address()
    const port = typeof addr === "object" && addr ? addr.port : 0
    const site = await start({
      dist: tmp,
      backend: `http://127.0.0.1:${port}`,
      log: (item) => log.push(item),
    })

    try {
      const t0 = Date.now()
      await new Promise<void>((resolve, reject) => {
        const out = request(
          `http://127.0.0.1:${site.port}/event`,
          { headers: { accept: "text/event-stream" } },
          (res) => {
            head.push(Date.now() - t0)
            res.on("data", () => got.push(Date.now() - t0))
            res.on("end", resolve)
          },
        )
        out.on("error", reject)
        out.end()
      })

      expect(head).toHaveLength(1)
      expect(got).toHaveLength(body.length)
      expect(log).toContain("[SSE] proxy streaming /event")
      expect(head[0]).toBeLessThan(sent[0] - t0 - 50)
      expect(got[0]).toBeLessThan(sent[1] - t0 - 40)
      expect(got[1]).toBeLessThan(sent[2] - t0 - 40)
    } finally {
      site.server.close()
      live.close()
    }
  })
})

describe("spa static fallback", () => {
  it("serves index.html for root", async () => {
    const res = await get(spa.port, "/")
    expect(res.type).toContain("text/html")
    expect(res.body).toContain("<title>Test</title>")
  })

  it("injects bootstrap script into html", async () => {
    const res = await get(spa.port, "/")
    expect(res.body).toContain("opencode.global.dat:server")
  })

  it("resets bootstrap projects to the current workspace only", async () => {
    const res = await get(spa.port, "/")
    expect(boot(res.body)).toContain("store.projects[sk] = [{worktree: dir, expanded: true}]")
  })

  it("removes the bootstrap project fetch xhr", async () => {
    const res = await get(spa.port, "/")
    expect(boot(res.body)).not.toContain('xhr.open("GET", "/project')
  })

  it("drops stale projects and keeps only the current workspace at runtime", async () => {
    const dir = "/tmp/current"
    const res = await get(spa.port, "/")
    const data = run(boot(res.body), dir, {
      lastProject: { local: "/tmp/stale" },
      list: [],
      projects: {
        local: [
          { worktree: "/tmp/stale-a", expanded: false },
          { worktree: "/tmp/stale-b", expanded: false },
        ],
      },
    })

    expect(data.projects.local).toEqual([{ worktree: dir, expanded: true }])
    expect(data.lastProject.local).toBe(dir)
  })

  // Use vm to execute the real injected bootstrap so these tests verify runtime seeding behavior,
  // not fragile string fragments inside the embedded script.
  describe("settings.v3 bootstrap seeding", () => {
    function seededSettings(script: string, seed?: string) {
      const map = runStorage(script, "/tmp/current", {
        "opencode.global.dat:server": JSON.stringify({ list: [], projects: {}, lastProject: {} }),
        ...(seed === undefined ? {} : { "settings.v3": seed }),
      })

      return JSON.parse(map.get("settings.v3") ?? "null")
    }

    it("seeds both tool expansion flags when settings.v3 is missing", async () => {
      const res = await get(spa.port, "/")

      expect(seededSettings(boot(res.body))).toEqual({
        general: {
          editToolPartsExpanded: true,
          shellToolPartsExpanded: true,
        },
      })
    })

    it("preserves explicit shellToolPartsExpanded=false", async () => {
      const res = await get(spa.port, "/")

      expect(
        seededSettings(
          boot(res.body),
          JSON.stringify({
            general: { shellToolPartsExpanded: false },
          }),
        ),
      ).toEqual({
        general: {
          editToolPartsExpanded: true,
          shellToolPartsExpanded: false,
        },
      })
    })

    it("injects only missing editToolPartsExpanded when shellToolPartsExpanded already exists", async () => {
      const res = await get(spa.port, "/")

      expect(
        seededSettings(
          boot(res.body),
          JSON.stringify({
            general: { shellToolPartsExpanded: true },
          }),
        ),
      ).toEqual({
        general: {
          editToolPartsExpanded: true,
          shellToolPartsExpanded: true,
        },
      })
    })

    it("tolerates corrupt settings.v3 JSON and reseeds fresh defaults", async () => {
      const res = await get(spa.port, "/")

      expect(seededSettings(boot(res.body), "{")).toEqual({
        general: {
          editToolPartsExpanded: true,
          shellToolPartsExpanded: true,
        },
      })
    })

    it("preserves unrelated top-level settings keys while seeding missing flags", async () => {
      const res = await get(spa.port, "/")

      expect(
        seededSettings(
          boot(res.body),
          JSON.stringify({
            appearance: { fontSize: 18 },
            general: {},
          }),
        ),
      ).toEqual({
        appearance: { fontSize: 18 },
        general: {
          editToolPartsExpanded: true,
          shellToolPartsExpanded: true,
        },
      })
    })
  })

  describe("clipboard polyfill bootstrap", () => {
    it("passes through successful native navigator.clipboard.writeText calls", async () => {
      const res = await get(spa.port, "/")
      const host: Array<{ command?: string; text?: string; type: string }> = []
      const native: string[] = []
      const env = runClipboard(boot(res.body), {
        acquireVsCodeApi() {
          return {
            postMessage(input) {
              host.push(input)
            },
          }
        },
        execCommand() {
          return true
        },
        nativeWriteText(text) {
          native.push(text)
          return Promise.resolve()
        },
      })

      await expect(env.ctx.navigator.clipboard.writeText("hello")).resolves.toBeUndefined()
      expect(native).toEqual(["hello"])
      expect(env.commands).toEqual([])
      expect(host).toEqual([])
    })

    it("falls back to document.execCommand when native clipboard write rejects", async () => {
      const res = await get(spa.port, "/")
      const env = runClipboard(boot(res.body), {
        execCommand(command) {
          return command === "copy"
        },
        nativeWriteText() {
          return Promise.reject(new Error("denied"))
        },
      })

      await expect(env.ctx.navigator.clipboard.writeText("hello")).resolves.toBeUndefined()
      expect(env.commands).toEqual(["copy"])
      expect(env.messages.filter((item) => item.type === "opencode.clipboard.write")).toEqual([])
      expect(env.textareas[0]?.value).toBe("hello")
    })

    it("posts a vscode host clipboard message when native and execCommand copy both fail", async () => {
      const res = await get(spa.port, "/")
      const host: Array<{ command?: string; text?: string; type: string }> = []
      const env = runClipboard(boot(res.body), {
        acquireVsCodeApi() {
          return {
            postMessage(input) {
              host.push(input)
            },
          }
        },
        execCommand() {
          return false
        },
        nativeWriteText() {
          return Promise.reject(new Error("denied"))
        },
        useParentPostMessage: false,
      })

      await expect(env.ctx.navigator.clipboard.writeText("hello")).resolves.toBeUndefined()
      expect(env.commands).toEqual(["copy"])
      expect(host).toEqual([{ text: "hello", type: "opencode.clipboard.write" }])
    })
  })

  describe("toolbar hide + shortcut forward bootstrap", () => {
    it("ships CSS selectors for all three toolbar buttons", async () => {
      const res = await get(spa.port, "/")
      const script = boot(res.body)

      expect(script).toContain('button[aria-controls="terminal-panel"]')
      expect(script).toContain('button[aria-controls="file-tree-panel"]')
      expect(script).toContain('button[aria-controls="review-panel"]')
    })

    it("ships CSS selector to hide Changes tab (data-value='changes')", async () => {
      const res = await get(spa.port, "/")
      const script = boot(res.body)

      expect(script).toContain('[data-slot="tabs-trigger-wrapper"][data-value="changes"]')
    })

    it("ships CSS selector to hide mobile tab bar via :has() when a Session trigger is present", async () => {
      const res = await get(spa.port, "/")
      const script = boot(res.body)

      expect(script).toContain('[data-slot="tabs-list"]:has([data-slot="tabs-trigger-wrapper"][data-value="session"])')
    })

    it("registers a capture keydown handler and forwards ctrl+` to the VSCode terminal command", async () => {
      const res = await get(spa.port, "/")
      const env = runClipboard(boot(res.body))
      const keydown = env.documentListeners.find((item) => item.type === "keydown" && item.capture)

      expect(keydown).toBeDefined()
      expect(env.styles).toEqual([
        'button[aria-controls="terminal-panel"],' +
          'button[aria-controls="file-tree-panel"],' +
          'button[aria-controls="review-panel"] { display: none !important; }' +
          '[data-slot="tabs-trigger-wrapper"][data-value="changes"] { display: none !important; }' +
          ' [data-slot="tabs-list"]:has([data-slot="tabs-trigger-wrapper"][data-value="session"]) { display: none !important; }',
      ])

      const preventDefault = vi.fn()
      const stopImmediatePropagation = vi.fn()
      keydown?.handler({
        altKey: false,
        ctrlKey: true,
        key: "`",
        metaKey: false,
        preventDefault,
        shiftKey: false,
        stopImmediatePropagation,
      })

      expect(env.messages).toContainEqual({
        command: "workbench.action.terminal.toggleTerminal",
        type: "opencode.vscode.command",
      })
      expect(preventDefault).toHaveBeenCalledOnce()
      expect(stopImmediatePropagation).toHaveBeenCalledOnce()
    })

    it("forwards mod+\\ to the VSCode explorer command", async () => {
      const res = await get(spa.port, "/")
      const env = runClipboard(boot(res.body))
      const keydown = env.documentListeners.find((item) => item.type === "keydown" && item.capture)

      keydown?.handler({
        altKey: false,
        ctrlKey: false,
        key: "\\",
        metaKey: true,
        preventDefault() {},
        shiftKey: false,
        stopImmediatePropagation() {},
      })

      expect(env.messages).toContainEqual({
        command: "workbench.view.explorer",
        type: "opencode.vscode.command",
      })
    })

    it("does not forward unrelated keys", async () => {
      const res = await get(spa.port, "/")
      const env = runClipboard(boot(res.body))
      const keydown = env.documentListeners.find((item) => item.type === "keydown" && item.capture)

      keydown?.handler({
        altKey: false,
        ctrlKey: true,
        key: "a",
        metaKey: false,
        preventDefault() {},
        shiftKey: false,
        stopImmediatePropagation() {},
      })

      expect(env.messages.filter((item) => item.type === "opencode.vscode.command")).toEqual([])
    })

    it("requires an exact ctrl+` modifier match", async () => {
      const res = await get(spa.port, "/")
      const env = runClipboard(boot(res.body))
      const keydown = env.documentListeners.find((item) => item.type === "keydown" && item.capture)

      keydown?.handler({
        altKey: false,
        ctrlKey: true,
        key: "`",
        metaKey: false,
        preventDefault() {},
        shiftKey: true,
        stopImmediatePropagation() {},
      })

      expect(env.messages.filter((item) => item.type === "opencode.vscode.command")).toEqual([])
    })
  })

  it("falls back to index.html for SPA routes", async () => {
    const res = await get(spa.port, "/L1VzZXJzL3Bpbmd6aQ")
    expect(res.type).toContain("text/html")
    expect(res.body).toContain("opencode.global.dat:server")
  })

  it("serves local static assets", async () => {
    const res = await get(spa.port, "/assets/app.js")
    expect(res.type).toContain("application/javascript")
    expect(res.body).toBe("console.log(1)")
  })

  it("serves a health route for compatible reuse", async () => {
    const res = await get(spa.port, "/opencode-spa-health")
    expect(res.type).toContain("application/json")
    expect(JSON.parse(res.body)).toEqual({ backend: `${backendUrl}/`, ok: true })
  })

  it("reuses the stable port when a compatible proxy already exists", async () => {
    const extra = await start({
      dist: tmp,
      backend: backendUrl,
    })

    try {
      expect(extra.port).toBe(spa.port)
    } finally {
      extra.server.close()
    }
  })
})

describe("api list completeness", () => {
  const required = [
    "/global",
    "/auth",
    "/doc",
    "/log",
    "/project",
    "/session",
    "/permission",
    "/question",
    "/provider",
    "/config",
    "/pty",
    "/mcp",
    "/experimental",
    "/tui",
    "/find",
    "/file",
    "/event",
    "/path",
    "/vcs",
    "/command",
    "/agent",
    "/skill",
    "/lsp",
    "/formatter",
    "/instance",
  ]

  for (const prefix of required) {
    it(`API list includes ${prefix}`, () => {
      expect(API).toContain(prefix)
    })
  }
})
