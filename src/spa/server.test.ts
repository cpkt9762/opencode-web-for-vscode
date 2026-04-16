import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, request, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runInNewContext } from "node:vm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
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

function run(script: string, dir: string, data: unknown) {
  const map = new Map<string, string>()
  if (data !== undefined) map.set("opencode.global.dat:server", JSON.stringify(data))
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
  return JSON.parse(map.get("opencode.global.dat:server") ?? "null")
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
