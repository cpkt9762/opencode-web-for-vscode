import type * as vscode from "vscode"
import { safe } from "../utils/retry.js"

export const EVENT_TYPES = {
  server_connected: "server.connected",
  server_heartbeat: "server.heartbeat",
  session_created: "session.created",
  session_updated: "session.updated",
  session_deleted: "session.deleted",
  message_created: "message.created",
  message_updated: "message.updated",
  message_completed: "message.completed",
  permission_created: "permission.created",
  question_created: "question.created",
  provider_updated: "provider.updated",
} as const

const TYPES = new Set<string>(Object.values(EVENT_TYPES))
const RETRY_MS = 250
const HEART_MS = 15_000
const MAX_RETRY = 5

type Input = {
  getClient: () => unknown
  onEvent: (type: string, payload: unknown) => void
}

type Event = {
  type: string
  properties?: unknown
}

type Sdk = {
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
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function aborted(error: unknown) {
  return record(error) && error.name === "AbortError"
}

function parse(input: unknown) {
  if (!record(input) || typeof input.type !== "string") return
  if (!TYPES.has(input.type)) return
  return {
    type: input.type,
    properties: input.properties,
  } satisfies Event
}

export class EventListener implements vscode.Disposable {
  private input: Input
  private live = false
  private run = 0
  private tries = 0
  private ctrl?: AbortController
  private beat?: ReturnType<typeof setTimeout>

  constructor(input: Input) {
    this.input = input
  }

  async start() {
    if (this.live) return
    this.live = true
    this.run += 1
    this.tries = 0
    await this.open(this.run)
  }

  stop() {
    this.live = false
    this.run += 1
    this.tries = 0
    this.clear()
    this.ctrl?.abort()
    this.ctrl = undefined
  }

  dispose() {
    this.stop()
  }

  private client() {
    const item = this.input.getClient()
    if (!item || typeof item !== "object") return
    if ("event" in item) return item as Sdk
    if ("client" in item && item.client && typeof item.client === "object") {
      return item.client as Sdk
    }
  }

  private touch(run: number, reset = false) {
    if (!this.live || run !== this.run) return
    if (reset) {
      this.tries = 0
    }
    this.clear()
    this.beat = setTimeout(() => {
      if (!this.live || run !== this.run) return
      this.ctrl?.abort()
    }, HEART_MS)
  }

  private clear() {
    if (!this.beat) return
    clearTimeout(this.beat)
    this.beat = undefined
  }

  private async retry(run: number) {
    if (!this.live || run !== this.run) return
    if (this.tries >= MAX_RETRY) {
      this.stop()
      return
    }

    this.tries += 1
    await wait(RETRY_MS)

    if (!this.live || run !== this.run) return
    await this.open(run)
  }

  private async open(run: number) {
    const sdk = this.client()
    const sub = sdk?.event?.subscribe
    if (!sub) return

    const ctrl = new AbortController()
    this.ctrl = ctrl
    this.touch(run)

    const data = await safe(() =>
      sub(
        {},
        {
          signal: ctrl.signal,
          onSseEvent: () => {
            this.touch(run, true)
          },
          sseMaxRetryAttempts: 0,
        },
      ),
    )

    if (!data.ok) {
      if (this.ctrl === ctrl) {
        this.ctrl = undefined
      }
      this.clear()
      if (aborted(data.error)) return
      await this.retry(run)
      return
    }

    if (!this.live || run !== this.run || ctrl.signal.aborted) return

    this.touch(run)
    void this.read(run, ctrl, data.data.stream)
  }

  private async read(run: number, ctrl: AbortController, stream: AsyncIterable<unknown>) {
    try {
      for await (const input of stream) {
        if (!this.live || run !== this.run || ctrl.signal.aborted) return
        this.touch(run, true)

        const event = parse(input)
        if (!event) continue
        this.input.onEvent(event.type, event.properties ?? {})
      }
    } catch (error) {
      if (!aborted(error)) {
        await this.retry(run)
        return
      }
    } finally {
      if (this.ctrl === ctrl) {
        this.ctrl = undefined
      }
      this.clear()
    }

    await this.retry(run)
  }
}
