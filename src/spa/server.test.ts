import { createServer, request, type Server } from "node:http"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { start, API } from "./server.js"

const tmp = mkdtempSync(join(tmpdir(), "spa-server-"))
const html = `<!doctype html><html><head><title>Test</title></head><body></body></html>`

writeFileSync(join(tmp, "index.html"), html)
mkdirSync(join(tmp, "assets"), { recursive: true })
writeFileSync(join(tmp, "assets", "app.js"), "console.log(1)")

let backend: Server
let backendPort: number
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

beforeAll(async () => {
  backend = createServer((req, res) => {
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ proxied: true, path: req.url }))
  })
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve))
  const addr = backend.address()
  backendPort = typeof addr === "object" && addr ? addr.port : 0

  spa = await start({
    dist: tmp,
    backend: `http://127.0.0.1:${backendPort}`,
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
