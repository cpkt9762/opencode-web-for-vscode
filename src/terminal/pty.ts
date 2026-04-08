import * as vscode from "vscode"

type Pty = {
  id: string
}

type Client = {
  url: string
  auth: string
  client: {
    pty: {
      create: (input?: { title?: string }) => Promise<{ data?: Pty }>
      remove: (input: { ptyID: string }) => Promise<unknown>
      update: (input: { ptyID: string; size?: { cols: number; rows: number } }) => Promise<unknown>
    }
  }
}

type GetClient = () => Client | Promise<Client | null> | null

const text = new TextDecoder()

function addr(url: string, id: string) {
  const out = new URL(`/pty/${id}/connect`, url)
  out.protocol = out.protocol === "https:" ? "wss:" : "ws:"
  out.searchParams.set("cursor", "0")
  return out.toString()
}

function data(input: ArrayBuffer | ArrayBufferView) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
}

export class OpenCodeTerminal implements vscode.Pseudoterminal {
  private readonly out = new vscode.EventEmitter<string>()
  private readonly end = new vscode.EventEmitter<void>()
  private readonly name: string
  private readonly getClient: GetClient
  private ws: WebSocket | null = null
  private cfg: Client | null = null
  private id: string | null = null
  private dim: vscode.TerminalDimensions | null = null
  private dead = false
  private task: Promise<void> | null = null

  readonly onDidWrite = this.out.event
  readonly onDidClose = this.end.event

  constructor(name: string, getClient: GetClient) {
    this.name = name
    this.getClient = getClient
  }

  open(dim: vscode.TerminalDimensions | undefined) {
    if (dim) this.dim = dim
    if (this.dead || this.task) return
    const task = this.start().finally(() => {
      if (this.task === task) {
        this.task = null
      }
    })
    this.task = task
  }

  close() {
    void this.stop(true)
  }

  handleInput(data: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(data)
  }

  setDimensions(dim: vscode.TerminalDimensions) {
    this.dim = dim
    void this.resize(dim)
  }

  private async start() {
    const cfg = await this.getClient()
    if (!cfg) {
      await this.fail("OpenCode: Client not available")
      return
    }

    if (this.dead) return
    this.cfg = cfg

    const created = await cfg.client.pty.create({ title: this.name })
    const info = created.data
    if (!info?.id) {
      await this.fail("OpenCode: Failed to create PTY")
      return
    }

    if (this.dead) {
      await cfg.client.pty.remove({ ptyID: info.id }).catch(() => undefined)
      return
    }

    this.id = info.id
    const ws = new WebSocket(addr(cfg.url, info.id), {
      headers: {
        Authorization: cfg.auth,
      },
    })
    ws.binaryType = "arraybuffer"
    ws.addEventListener("message", (event) => {
      void this.read(event.data)
    })
    ws.addEventListener("close", () => {
      void this.stop(false)
    })
    ws.addEventListener("error", () => {
      void this.stop(false)
    })
    this.ws = ws

    if (!this.dim) return
    await this.resize(this.dim)
  }

  private async read(input: unknown) {
    if (typeof input === "string") {
      this.out.fire(input)
      return
    }

    if (input instanceof Blob) {
      await this.read(await input.arrayBuffer())
      return
    }

    if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
      const bytes = data(input)
      if (bytes[0] === 0) return
      this.out.fire(text.decode(bytes))
    }
  }

  private async resize(dim: vscode.TerminalDimensions) {
    if (!this.cfg || !this.id || this.dead) return
    await this.cfg.client.pty.update({
      ptyID: this.id,
      size: {
        cols: dim.columns,
        rows: dim.rows,
      },
    })
  }

  private async fail(msg: string) {
    this.out.fire(`\r\n${msg}\r\n`)
    await this.stop(true)
  }

  private async stop(remove: boolean) {
    if (this.dead) return
    this.dead = true

    const ws = this.ws
    const cfg = this.cfg
    const id = this.id

    this.ws = null
    this.cfg = null
    this.id = null

    if (ws && ws.readyState < WebSocket.CLOSING) {
      ws.close()
    }

    if (remove && cfg && id) {
      await cfg.client.pty.remove({ ptyID: id }).catch(() => undefined)
    }

    this.end.fire()
  }
}

export function createTerminal(name: string, getClient: GetClient) {
  const pty = new OpenCodeTerminal(name, getClient)
  return vscode.window.createTerminal({ name, pty })
}
