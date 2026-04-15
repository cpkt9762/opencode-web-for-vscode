import { type ChildProcess, spawn as run, type SpawnOptions } from "node:child_process"
import { EventEmitter } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"

type Bin = {
  path: string
  version: string
  compatible: boolean
} | null

const state = {
  bin: {
    path: "/tmp/opencode",
    version: "1.3.0",
    compatible: true,
  } as Bin,
}

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(() => ""),
    })),
  },
}))

import { ProcessManager, type ProcessStatus, type Runner } from "./manager.js"

type Call = {
  file: string
  args: string[]
  env: NodeJS.ProcessEnv
}

const dir = mkdtempSync(join(tmpdir(), "opencode-manager-"))
const script = join(dir, "fake-opencode.cjs")

writeFileSync(
  script,
  `const http = require("node:http")

function pick(name) {
  const eq = process.argv.find((arg) => arg.startsWith("--" + name + "="))
  if (eq) return eq.slice(name.length + 3)
  const ix = process.argv.indexOf("--" + name)
  if (ix !== -1) return process.argv[ix + 1]
  return undefined
}

const host = pick("hostname") || "127.0.0.1"
const port = Number(pick("port") || 0)

const server = http.createServer((req, res) => {
  if (req.url === "/global/health") {
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ healthy: true, version: process.env.OPENCODE_TEST_VERSION || "1.3.0" }))
    return
  }

  res.statusCode = 404
  res.end("missing")
})

server.listen(port, host, () => {
  console.log("opencode server listening on http://" + host + ":" + port)
})

process.on("SIGTERM", () => {
  if (process.env.OPENCODE_TEST_IGNORE_TERM === "1") return
  server.close(() => process.exit(0))
})

process.on("SIGINT", () => {
  server.close(() => process.exit(0))
})
`,
)

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function port() {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const addr = server.address()
  const value = typeof addr === "object" && addr ? addr.port : 0
  await close(server)
  return value
}

function fake(env?: NodeJS.ProcessEnv) {
  const calls: Call[] = []
  const sigs: Array<NodeJS.Signals | number | undefined> = []

  const spawn: Runner = (file, args, opts) => {
    const list = Array.isArray(args) ? [...args] : []
    const cfg = opts as SpawnOptions | undefined
    calls.push({
      file,
      args: list,
      env: { ...(cfg?.env ?? {}) },
    })

    const child = run(process.execPath, [script, ...list], {
      ...cfg,
      env: {
        ...(cfg?.env ?? {}),
        ...(env ?? {}),
      },
    })

    const kill = child.kill.bind(child)
    child.kill = (sig?: NodeJS.Signals | number) => {
      sigs.push(sig)
      return kill(sig)
    }

    return child
  }

  return { spawn, calls, sigs }
}

function health(port: number, version = "1.3.0") {
  const server = createServer((req, res) => {
    if (req.url !== "/global/health") {
      res.statusCode = 404
      res.end("missing")
      return
    }

    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ healthy: true, version }))
  })

  return new Promise<Server>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server))
  })
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function child() {
  return Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    stdout: new EventEmitter(),
  }) as unknown as ChildProcess &
    EventEmitter & {
      stderr: EventEmitter
      stdout: EventEmitter
    }
}

describe("ProcessManager", () => {
  it("start spawns process and returns url/password", async () => {
    const value = await port()
    const fakebin = fake()
    const mgr = new ProcessManager({
      port: value,
      find: () => state.bin,
      spawn: fakebin.spawn,
      timeout: 2000,
      grace: 50,
    })

    const result = await mgr.start()

    expect(result.url).toBe(`http://127.0.0.1:${value}`)
    expect(result.password).toMatch(/^[0-9a-f]{32}$/)
    expect(fakebin.calls).toHaveLength(1)
    expect(fakebin.calls[0]?.args).toEqual(["serve", "--port", String(value)])
    expect(fakebin.calls[0]?.env.OPENCODE_SERVER_PASSWORD).toBeUndefined()
    expect(mgr.getUrl()).toBe(result.url)
    expect(mgr.getPassword()).toBe(result.password)

    await mgr.stop()
  })

  it("start with configured password uses it instead of random", async () => {
    const value = await port()
    const fakebin = fake()
    const mgr = new ProcessManager({
      port: value,
      find: () => state.bin,
      password: "my-secret",
      spawn: fakebin.spawn,
      timeout: 2000,
      grace: 50,
    })

    const result = await mgr.start()

    expect(result.url).toBe(`http://127.0.0.1:${value}`)
    expect(result.password).toBe("my-secret")
    expect(fakebin.calls[0]?.env.OPENCODE_SERVER_PASSWORD).toBe("my-secret")

    await mgr.stop()
  })

  it("stop sends SIGTERM then SIGKILL after timeout", async () => {
    const value = await port()
    const fakebin = fake({ OPENCODE_TEST_IGNORE_TERM: "1" })
    const mgr = new ProcessManager({
      port: value,
      find: () => state.bin,
      spawn: fakebin.spawn,
      timeout: 2000,
      grace: 50,
    })

    await mgr.start()
    await mgr.stop()

    expect(fakebin.sigs[0]).toBe("SIGTERM")
    expect(fakebin.sigs.at(-1)).toBe("SIGKILL")
  })

  it("dispose calls stop", async () => {
    const mgr = new ProcessManager(4096)
    const spy = vi.spyOn(mgr, "stop").mockResolvedValue()

    await mgr.dispose()

    expect(spy).toHaveBeenCalledOnce()
  })

  it("getStatus transitions correctly", async () => {
    const value = await port()
    const fakebin = fake()
    const seen: ProcessStatus[] = []
    const mgr = new ProcessManager({
      port: value,
      find: () => state.bin,
      spawn: fakebin.spawn,
      timeout: 2000,
      grace: 50,
    })
    const sub = mgr.onStatusChange((status) => seen.push(status))

    expect(mgr.getStatus()).toBe("stopped")
    const task = mgr.start()
    expect(mgr.getStatus()).toBe("starting")
    await task
    expect(mgr.getStatus()).toBe("running")
    await mgr.stop()
    expect(mgr.getStatus()).toBe("stopped")
    expect(seen).toEqual(["starting", "running", "stopped"])

    sub.dispose()
  })

  it("password is random hex", async () => {
    const left = new ProcessManager({
      port: await port(),
      find: () => state.bin,
      spawn: fake().spawn,
      timeout: 2000,
      grace: 50,
    })
    const right = new ProcessManager({
      port: await port(),
      find: () => state.bin,
      spawn: fake().spawn,
      timeout: 2000,
      grace: 50,
    })

    const a = await left.start()
    const b = await right.start()

    expect(a.password).toMatch(/^[0-9a-f]{32}$/)
    expect(b.password).toMatch(/^[0-9a-f]{32}$/)
    expect(a.password).not.toBe(b.password)

    await left.stop()
    await right.stop()
  })

  it("adopts healthy orphan before spawning", async () => {
    const value = await port()
    const server = await health(value)
    const spawn = vi.fn((file: string, args?: readonly string[], opts?: SpawnOptions) => {
      const list = [...(args ?? [])]
      if (!opts) return run(file, list)
      return run(file, list, opts)
    })
    const mgr = new ProcessManager({
      port: value,
      spawn,
      timeout: 500,
      grace: 50,
    })

    const result = await mgr.start()

    expect(result.url).toBe(`http://127.0.0.1:${value}`)
    expect(result.password).toMatch(/^[0-9a-f]{32}$/)
    expect(mgr.getStatus()).toBe("running")
    expect(spawn).not.toHaveBeenCalled()

    await close(server)
  })

  it("reusing existing server returns configured password", async () => {
    const value = await port()
    const server = await health(value)
    const spawn = vi.fn((file: string, args?: readonly string[], opts?: SpawnOptions) => {
      const list = [...(args ?? [])]
      if (!opts) return run(file, list)
      return run(file, list, opts)
    })
    const mgr = new ProcessManager({
      port: value,
      find: () => state.bin,
      password: "shared-secret",
      spawn,
      timeout: 500,
      grace: 50,
    })

    const result = await mgr.start()

    expect(result.url).toBe(`http://127.0.0.1:${value}`)
    expect(result.password).toBe("shared-secret")
    expect(mgr.getStatus()).toBe("running")
    expect(spawn).not.toHaveBeenCalled()

    await close(server)
  })

  it("retries transient health check failures", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom-1"))
      .mockRejectedValueOnce(new Error("boom-2"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ healthy: true, version: "1.3.0" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      )
    const mgr = new ProcessManager({ port: 4096, fetch })

    const res = await (
      mgr as unknown as {
        health: (url: string, password: string) => Promise<unknown>
      }
    ).health("http://127.0.0.1:4096", "secret")

    expect(res).toEqual({ version: "1.3.0" })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it("times out waiting for startup url with TimeoutError", async () => {
    const mgr = new ProcessManager({ port: 4096, timeout: 20 })
    const proc = child()

    await expect(
      (
        mgr as unknown as {
          waitUrl: (proc: ChildProcess) => Promise<string>
        }
      ).waitUrl(proc),
    ).rejects.toMatchObject({ name: "TimeoutError" })

    expect(proc.stdout.listenerCount("data")).toBe(0)
    expect(proc.stderr.listenerCount("data")).toBe(0)
    expect(proc.listenerCount("exit")).toBe(0)
    expect(proc.listenerCount("error")).toBe(0)
  })
})
