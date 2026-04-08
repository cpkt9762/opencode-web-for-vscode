import { type ChildProcess, exec as execChild, spawn as run, type SpawnOptions } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createConnection, type Socket } from "node:net"
import { promisify } from "node:util"
import type * as vscode from "vscode"
import { retry, withTimeout } from "../utils/retry.js"
import { type BinaryInfo, findBinary } from "./discover.js"

const HOST = "127.0.0.1"
const SDK_VERSION = "1.3.0"
const TIMEOUT = 5000
const GRACE = 2000

const exec = promisify(execChild)
const spawn: Runner = (file, args, opts) => {
  const list = [...(args ?? [])]
  if (!opts) return run(file, list)
  return run(file, list, opts)
}

export type ProcessStatus = "starting" | "running" | "stopped" | "error"

export type StartResult = {
  url: string
  password: string
}

type Event<T> = (listener: (event: T) => unknown) => vscode.Disposable

type Fetcher = (input: string | URL | globalThis.Request, init?: RequestInit) => Promise<Response>

export type Runner = (file: string, args?: readonly string[], opts?: SpawnOptions) => ChildProcess

type Exec = (command: string, opts?: { timeout?: number; shell?: boolean }) => Promise<unknown>

type Connect = (port: number, host: string) => Socket

export type ProcessManagerOptions = {
  port: number
  dir?: string
  host?: string
  timeout?: number
  grace?: number
  spawn?: Runner
  fetch?: Fetcher
  exec?: Exec
  connect?: Connect
  find?: () => BinaryInfo | null
  sleep?: (ms: number) => Promise<void>
  platform?: NodeJS.Platform
}

class Emitter<T> implements vscode.Disposable {
  private listeners = new Set<(event: T) => unknown>()

  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener)
    return {
      dispose: () => {
        this.listeners.delete(listener)
      },
    }
  }

  fire(event: T) {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  dispose() {
    this.listeners.clear()
  }
}

export class ProcessManager implements vscode.Disposable {
  private readonly port: number
  private readonly host: string
  private readonly timeout: number
  private readonly grace: number
  private readonly spawn: Runner
  private readonly fetch: Fetcher
  private readonly exec: Exec
  private readonly connect: Connect
  private readonly find: () => BinaryInfo | null
  private readonly sleep: (ms: number) => Promise<void>
  private readonly platform: NodeJS.Platform
  private readonly dir: string | null
  private readonly status = new Emitter<ProcessStatus>()

  private proc: ChildProcess | null = null
  private url: string | null = null
  private password: string | null = null
  private state: ProcessStatus = "stopped"
  private task: Promise<StartResult> | null = null

  readonly onStatusChange = this.status.event

  constructor(port: number, opts?: Omit<ProcessManagerOptions, "port">)
  constructor(opts: ProcessManagerOptions)
  constructor(input: number | ProcessManagerOptions, opts?: Omit<ProcessManagerOptions, "port">) {
    const cfg = typeof input === "number" ? { port: input, ...(opts ?? {}) } : input

    this.port = cfg.port
    this.host = cfg.host ?? HOST
    this.timeout = cfg.timeout ?? TIMEOUT
    this.grace = cfg.grace ?? GRACE
    this.spawn = cfg.spawn ?? spawn
    this.fetch = cfg.fetch ?? fetch
    this.exec = cfg.exec ?? exec
    this.connect = cfg.connect ?? createConnection
    this.find = cfg.find ?? findBinary
    this.sleep = cfg.sleep ?? wait
    this.platform = cfg.platform ?? process.platform
    this.dir = cfg.dir ?? null
  }

  async start(): Promise<StartResult> {
    if (this.task) return this.task
    if (this.state === "running" && this.url && this.password) {
      return { url: this.url, password: this.password }
    }

    const password = randomBytes(16).toString("hex")
    const task = this.boot(password)
    this.task = task.finally(() => {
      if (this.task === task) {
        this.task = null
      }
    })
    return this.task
  }

  async stop(): Promise<void> {
    const proc = this.proc

    if (!proc && !this.url) {
      this.clear()
      this.setStatus("stopped")
      return
    }

    if (proc) {
      const exit = this.waitExit(proc)
      if (this.platform === "win32") proc.kill()
      else proc.kill("SIGTERM")

      const done = await Promise.race([exit.then(() => true), this.sleep(this.grace).then(() => false)])
      if (!done) {
        this.kill(proc, "SIGKILL")
        await exit
      }
    } else {
      await this.killPort()
    }

    this.clear()
    this.setStatus("stopped")
  }

  dispose() {
    return this.stop().finally(() => {
      this.status.dispose()
    })
  }

  getUrl() {
    return this.url
  }

  getPassword() {
    return this.password
  }

  getStatus() {
    return this.state
  }

  private async boot(password: string): Promise<StartResult> {
    this.password = password
    this.setStatus("starting")

    try {
      const url = `http://${this.host}:${this.port}`
      if (await this.busy()) {
        const health = await this.health(url, password)
        if (health && compatible(health.version)) {
          this.url = url
          this.setStatus("running")
          return { url, password }
        }

        await this.killPort()
        await this.sleep(100)
        if (await this.busy()) {
          throw new Error(`Port ${this.port} is still in use`)
        }
      }

      const bin = this.find()
      if (!bin) {
        throw new Error("Failed to find opencode binary")
      }
      if (!bin.compatible) {
        throw new Error(`Incompatible opencode version: ${bin.version}`)
      }

      const env = { ...process.env }
      delete env.OPENCODE_SERVER_PASSWORD
      const proc = this.spawn(bin.path, ["serve", "--port", String(this.port)], {
        env,
        cwd: this.dir ?? undefined,
        shell: this.platform === "win32" && bin.path.endsWith(".cmd"),
      })

      this.proc = proc
      this.watch(proc)
      this.url = await this.waitUrl(proc)
      this.setStatus("running")
      return { url: this.url, password }
    } catch (err) {
      const proc = this.proc
      if (proc) {
        this.kill(proc, this.platform === "win32" ? undefined : "SIGKILL")
      }
      this.clear()
      this.setStatus("error")
      throw normalize(err)
    }
  }

  private async busy() {
    return new Promise<boolean>((resolve) => {
      const sock = this.connect(this.port, this.host)

      const done = (value: boolean) => {
        sock.removeAllListeners()
        sock.destroy()
        resolve(value)
      }

      sock.once("connect", () => done(true))
      sock.once("error", () => done(false))
      sock.setTimeout(250, () => done(false))
    })
  }

  private async health(url: string, _password: string) {
    const res = await retry(
      () =>
        this.fetch(new URL("/global/health", url), {
          method: "GET",
          signal: AbortSignal.timeout(2000),
        }),
      { max: 3, delay: 500 },
    ).catch(() => null)

    if (!res?.ok) return null

    const body = (await res.json().catch(() => null)) as {
      healthy?: unknown
      version?: unknown
    } | null
    if (!body || body.healthy !== true || typeof body.version !== "string") {
      return null
    }

    return { version: body.version }
  }

  private async killPort() {
    if (this.platform !== "win32") {
      await this.exec(`lsof -ti:${this.port} | xargs kill -9`, {
        timeout: 5000,
      }).catch(() => null)
      return
    }

    const list = [
      {
        command: `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${this.port}') do taskkill /F /PID %a`,
        shell: false,
      },
      {
        command: `powershell -Command "$pids = (Get-NetTCPConnection -LocalPort ${this.port} -ErrorAction SilentlyContinue).OwningProcess; if ($pids) { Stop-Process -Id $pids -Force -ErrorAction SilentlyContinue }"`,
        shell: true,
      },
      {
        command: `pid=$(netstat -aon | findstr :${this.port} | awk '{print $5}' | head -1 | cut -d: -f2); if [ -n "$pid" ]; then taskkill //F //PID $pid 2>/dev/null; fi`,
        shell: true,
      },
    ]

    for (const item of list) {
      const ok = await this.exec(item.command, {
        timeout: 5000,
        shell: item.shell,
      })
        .then(() => true)
        .catch(() => false)
      if (ok) return
    }
  }

  private waitUrl(proc: ChildProcess) {
    let stop = () => {}
    const task = new Promise<string>((resolve, reject) => {
      let out = ""
      let live = true

      const done = (fn?: () => void) => {
        if (!live) return
        live = false
        proc.stdout?.off("data", onOut)
        proc.stderr?.off("data", onErr)
        proc.off("exit", onExit)
        proc.off("error", onError)
        fn?.()
      }

      stop = () => done()

      const onOut = (chunk: Buffer | string) => {
        out += chunk.toString()
        const match = out.match(/(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+)/)
        if (!match) return
        const url = match[1]
        if (!url) return
        done(() => resolve(url))
      }

      const onErr = (chunk: Buffer | string) => {
        out += chunk.toString()
      }

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        done(() =>
          reject(
            new Error(
              `Server exited before ready (code=${code ?? "unknown"} signal=${signal ?? "unknown"})${out ? `\n${out}` : ""}`,
            ),
          ),
        )
      }

      const onError = (err: Error) => {
        done(() => reject(err))
      }

      proc.stdout?.on("data", onOut)
      proc.stderr?.on("data", onErr)
      proc.on("exit", onExit)
      proc.on("error", onError)
    })

    return withTimeout(() => task, this.timeout).catch((err) => {
      stop()
      throw err
    })
  }

  private waitExit(proc: ChildProcess) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      return Promise.resolve()
    }

    return new Promise<void>((resolve) => {
      const done = () => {
        proc.off("exit", done)
        resolve()
      }

      proc.on("exit", done)
    })
  }

  private watch(proc: ChildProcess) {
    proc.on("exit", () => {
      if (this.proc !== proc) return

      this.clear()
      if (this.state === "starting") return
      this.setStatus("stopped")
    })
  }

  private clear() {
    this.proc = null
    this.url = null
    this.password = null
  }

  private setStatus(next: ProcessStatus) {
    if (this.state === next) return
    this.state = next
    this.status.fire(next)
  }

  private kill(proc: ChildProcess, signal?: NodeJS.Signals) {
    if (this.platform === "win32") {
      proc.kill()
      return
    }

    proc.kill(signal)
  }
}

function auth(password: string) {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
}

function compatible(version: string) {
  const [major, minor] = version.split(".").map(Number)
  const [sdkMajor, sdkMinor] = SDK_VERSION.split(".").map(Number)
  return major === sdkMajor && minor >= sdkMinor
}

function normalize(err: unknown) {
  if (err instanceof Error) return err
  return new Error(String(err))
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
