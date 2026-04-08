import { beforeEach, describe, expect, it, vi } from "vitest"

const fx = vi.hoisted(() => {
  class Emitter<T> {
    private set = new Set<(event: T) => unknown>()

    readonly event = (fn: (event: T) => unknown) => {
      this.set.add(fn)
      return {
        dispose: () => {
          this.set.delete(fn)
        },
      }
    }

    fire(event: T) {
      for (const fn of this.set) {
        fn(event)
      }
    }

    dispose() {
      this.set.clear()
    }
  }

  return {
    Emitter,
    createTerminal: vi.fn((opts: { name: string; pty: unknown }) => ({
      name: opts.name,
      pty: opts.pty,
      show: vi.fn(),
      dispose: vi.fn(),
      sendText: vi.fn(),
    })),
  }
})

vi.mock("vscode", () => ({
  EventEmitter: fx.Emitter,
  window: {
    createTerminal: fx.createTerminal,
  },
}))

type Kind = "close" | "error" | "message"
type Fn = (event: unknown) => void

class MockSocket {
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static all: MockSocket[] = []

  readonly url: string
  readonly init: WebSocketInit | undefined
  readonly send = vi.fn()
  readonly close = vi.fn(() => {
    this.readyState = MockSocket.CLOSED
    this.emit("close", {})
  })
  readonly map = {
    close: new Set<Fn>(),
    error: new Set<Fn>(),
    message: new Set<Fn>(),
  }
  readyState = MockSocket.OPEN
  binaryType: "blob" | "arraybuffer" = "arraybuffer"

  constructor(url: string | URL, init?: WebSocketInit) {
    this.url = String(url)
    this.init = init
    MockSocket.all.push(this)
  }

  addEventListener(type: Kind, fn: Fn) {
    this.map[type].add(fn)
  }

  emit(type: Kind, event: unknown) {
    for (const fn of this.map[type]) {
      fn(event)
    }
  }
}

type Client = {
  url: string
  auth: string
  client: {
    pty: {
      create: (input?: { title?: string }) => Promise<{ data: { id: string } }>
      remove: (input: { ptyID: string }) => Promise<{ data: boolean }>
      update: (input: { ptyID: string; size?: { cols: number; rows: number } }) => Promise<{ data: { id: string } }>
    }
  }
}

function make() {
  const create = vi.fn(async () => ({ data: { id: "pty-1" } }))
  const remove = vi.fn(async () => ({ data: true }))
  const update = vi.fn(async () => ({ data: { id: "pty-1" } }))
  const cfg: Client = {
    url: "http://127.0.0.1:4096",
    auth: "Basic test",
    client: {
      pty: { create, remove, update },
    },
  }
  return { cfg, create, remove, update }
}

async function load() {
  return import("./pty.js")
}

async function tick() {
  await Promise.resolve()
  await Promise.resolve()
}

describe("OpenCodeTerminal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockSocket.all = []
    vi.stubGlobal("WebSocket", MockSocket)
  })

  it("open creates PTY via SDK", async () => {
    const mod = await load()
    expect(mod?.OpenCodeTerminal).toBeTypeOf("function")
    if (!mod) return

    const { cfg, create } = make()
    const pty = new mod.OpenCodeTerminal("Shell", () => cfg)

    pty.open({ columns: 80, rows: 24 })
    await tick()
    await vi.waitFor(() => {
      expect(MockSocket.all).toHaveLength(1)
    })

    expect(create).toHaveBeenCalledWith({ title: "Shell" })
    expect(MockSocket.all[0]?.url).toBe("ws://127.0.0.1:4096/pty/pty-1/connect?cursor=0")
    expect(MockSocket.all[0]?.init?.headers).toEqual({ Authorization: "Basic test" })
  })

  it("handleInput sends data to WebSocket", async () => {
    const mod = await load()
    expect(mod?.OpenCodeTerminal).toBeTypeOf("function")
    if (!mod) return

    const { cfg } = make()
    const pty = new mod.OpenCodeTerminal("Shell", () => cfg)

    pty.open(undefined)
    await tick()
    await vi.waitFor(() => {
      expect(MockSocket.all).toHaveLength(1)
    })
    pty.handleInput("pwd\r")

    expect(MockSocket.all[0]?.send).toHaveBeenCalledWith("pwd\r")
  })

  it("close cleans up PTY and WebSocket", async () => {
    const mod = await load()
    expect(mod?.OpenCodeTerminal).toBeTypeOf("function")
    if (!mod) return

    const { cfg, remove } = make()
    const seen: number[] = []
    const pty = new mod.OpenCodeTerminal("Shell", () => cfg)
    pty.onDidClose?.(() => {
      seen.push(1)
    })

    pty.open(undefined)
    await tick()
    await vi.waitFor(() => {
      expect(MockSocket.all).toHaveLength(1)
    })
    pty.close()
    await tick()
    await vi.waitFor(() => {
      expect(seen).toHaveLength(1)
    })

    expect(MockSocket.all[0]?.close).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith({ ptyID: "pty-1" })
  })

  it("setDimensions updates PTY size", async () => {
    const mod = await load()
    expect(mod?.OpenCodeTerminal).toBeTypeOf("function")
    if (!mod) return

    const { cfg, update } = make()
    const pty = new mod.OpenCodeTerminal("Shell", () => cfg)

    pty.open(undefined)
    await tick()
    await vi.waitFor(() => {
      expect(MockSocket.all).toHaveLength(1)
    })
    pty.setDimensions?.({ columns: 120, rows: 40 })
    await tick()

    expect(update).toHaveBeenCalledWith({
      ptyID: "pty-1",
      size: { cols: 120, rows: 40 },
    })
  })
})
