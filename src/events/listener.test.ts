import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { EVENT_TYPES, EventListener } from "./listener.js"

function feed() {
  const end = Symbol("end")
  const list: Array<unknown | typeof end> = []
  let wake: ((item: IteratorResult<unknown>) => void) | undefined
  let shut = false

  const next = () => {
    const item = list.shift()
    if (item !== undefined) {
      if (item === end) return Promise.resolve({ done: true, value: undefined })
      return Promise.resolve({ done: false, value: item })
    }

    return new Promise<IteratorResult<unknown>>((resolve) => {
      wake = resolve
    })
  }

  return {
    stream: {
      [Symbol.asyncIterator]() {
        return this
      },
      next,
      return() {
        shut = true
        if (wake) {
          const fn = wake
          wake = undefined
          fn({ done: true, value: undefined })
        }
        return Promise.resolve({ done: true, value: undefined })
      },
    },
    push(item: unknown) {
      if (shut) return
      if (wake) {
        const fn = wake
        wake = undefined
        fn({ done: false, value: item })
        return
      }
      list.push(item)
    },
    close() {
      if (shut) return
      shut = true
      if (wake) {
        const fn = wake
        wake = undefined
        fn({ done: true, value: undefined })
        return
      }
      list.push(end)
    },
    closed() {
      return shut
    },
  }
}

function make() {
  const calls: Array<{
    item: ReturnType<typeof feed>
    opts: {
      signal?: AbortSignal
      onSseEvent?: (event: unknown) => void
    }
  }> = []
  const sub = vi.fn(async (_: unknown, opts?: { signal?: AbortSignal; onSseEvent?: (event: unknown) => void }) => {
    const item = feed()
    const box = {
      item,
      opts: opts ?? {},
    }
    box.opts.signal?.addEventListener("abort", () => {
      item.close()
    })
    calls.push(box)
    return {
      stream: item.stream,
    }
  })

  return {
    calls,
    sub,
    client: {
      event: {
        subscribe: sub,
      },
    },
  }
}

describe("EventListener", () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("start calls event.subscribe", async () => {
    const sdk = make()
    const onEvent = vi.fn()
    const item = new EventListener({
      getClient: () => sdk.client,
      onEvent,
    })

    await item.start()

    expect(sdk.sub).toHaveBeenCalledOnce()
    expect(sdk.sub).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        onSseEvent: expect.any(Function),
      }),
    )

    item.stop()
  })

  it("routes events to onEvent callback", async () => {
    const sdk = make()
    const onEvent = vi.fn()
    const item = new EventListener({
      getClient: () => sdk.client,
      onEvent,
    })

    await item.start()
    sdk.calls[0]?.item.push({
      type: EVENT_TYPES.session_updated,
      properties: { id: "ses_1" },
    })

    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith(EVENT_TYPES.session_updated, { id: "ses_1" })
    })

    item.stop()
  })

  it("routes file.edited events to onEvent callback", async () => {
    const sdk = make()
    const onEvent = vi.fn()
    const item = new EventListener({
      getClient: () => sdk.client,
      onEvent,
    })

    await item.start()
    sdk.calls[0]?.item.push({
      type: EVENT_TYPES.file_edited,
      properties: { file: "/foo.ts" },
    })

    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith(EVENT_TYPES.file_edited, { file: "/foo.ts" })
    })

    item.stop()
  })

  it("routes file.watcher.updated events to onEvent callback", async () => {
    const sdk = make()
    const onEvent = vi.fn()
    const item = new EventListener({
      getClient: () => sdk.client,
      onEvent,
    })

    await item.start()
    sdk.calls[0]?.item.push({
      type: EVENT_TYPES.file_watcher_updated,
      properties: { file: "/bar.ts", event: "change" },
    })

    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith(EVENT_TYPES.file_watcher_updated, { file: "/bar.ts", event: "change" })
    })

    item.stop()
  })

  it("routes session.status events to onEvent callback", async () => {
    const sdk = make()
    const onEvent = vi.fn()
    const item = new EventListener({
      getClient: () => sdk.client,
      onEvent,
    })

    await item.start()
    sdk.calls[0]?.item.push({
      type: EVENT_TYPES.session_status,
      properties: {
        sessionID: "ses_1",
        status: { type: "busy" },
      },
    })

    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith(EVENT_TYPES.session_status, {
        sessionID: "ses_1",
        status: { type: "busy" },
      })
    })

    item.stop()
  })

  it("routes session.diff events to onEvent callback", async () => {
    const sdk = make()
    const onEvent = vi.fn()
    const item = new EventListener({
      getClient: () => sdk.client,
      onEvent,
    })

    await item.start()
    sdk.calls[0]?.item.push({
      type: EVENT_TYPES.session_diff,
      properties: {
        sessionID: "ses_1",
        diff: [],
      },
    })

    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith(EVENT_TYPES.session_diff, {
        sessionID: "ses_1",
        diff: [],
      })
    })

    item.stop()
  })

  it("routes session.idle events to onEvent callback", async () => {
    const sdk = make()
    const onEvent = vi.fn()
    const item = new EventListener({
      getClient: () => sdk.client,
      onEvent,
    })

    await item.start()
    sdk.calls[0]?.item.push({
      type: EVENT_TYPES.session_idle,
      properties: { sessionID: "ses_1" },
    })

    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith(EVENT_TYPES.session_idle, { sessionID: "ses_1" })
    })

    item.stop()
  })

  it("routes unknown future events to onEvent callback", async () => {
    const sdk = make()
    const onEvent = vi.fn()
    const item = new EventListener({
      getClient: () => sdk.client,
      onEvent,
    })

    await item.start()
    sdk.calls[0]?.item.push({
      type: "some.unknown.future.event",
      properties: { x: 1 },
    })

    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith("some.unknown.future.event", { x: 1 })
    })

    item.stop()
  })

  it("stop closes connection", async () => {
    const sdk = make()
    const item = new EventListener({
      getClient: () => sdk.client,
      onEvent: vi.fn(),
    })

    await item.start()
    item.stop()

    expect(sdk.calls[0]?.opts.signal?.aborted).toBe(true)
    expect(sdk.calls[0]?.item.closed()).toBe(true)
  })

  it("reconnects after disconnect", async () => {
    vi.useFakeTimers()

    const sdk = make()
    const item = new EventListener({
      getClient: () => sdk.client,
      onEvent: vi.fn(),
    })

    await item.start()
    sdk.calls[0]?.item.close()
    await vi.advanceTimersByTimeAsync(250)

    expect(sdk.sub).toHaveBeenCalledTimes(2)

    item.stop()
  })

  it("reconnects when heartbeat is missed", async () => {
    vi.useFakeTimers()

    const sdk = make()
    const item = new EventListener({
      getClient: () => sdk.client,
      onEvent: vi.fn(),
    })

    await item.start()
    await vi.advanceTimersByTimeAsync(15_000)
    await vi.advanceTimersByTimeAsync(250)

    expect(sdk.calls[0]?.opts.signal?.aborted).toBe(true)
    expect(sdk.sub).toHaveBeenCalledTimes(2)

    item.stop()
  })

  it("stops after five retries", async () => {
    vi.useFakeTimers()

    const sdk = make()
    const item = new EventListener({
      getClient: () => sdk.client,
      onEvent: vi.fn(),
    })

    await item.start()

    for (let i = 0; i < 6; i += 1) {
      sdk.calls.at(-1)?.item.close()
      await vi.advanceTimersByTimeAsync(250)
    }

    expect(sdk.sub).toHaveBeenCalledTimes(6)
  })

  it("EVENT_TYPES has expected values", () => {
    expect(EVENT_TYPES).toEqual({
      server_connected: "server.connected",
      server_heartbeat: "server.heartbeat",
      file_edited: "file.edited",
      file_watcher_updated: "file.watcher.updated",
      session_created: "session.created",
      session_updated: "session.updated",
      session_deleted: "session.deleted",
      session_status: "session.status",
      session_diff: "session.diff",
      session_idle: "session.idle",
      message_created: "message.created",
      message_updated: "message.updated",
      message_completed: "message.completed",
      permission_created: "permission.created",
      question_created: "question.created",
      provider_updated: "provider.updated",
    })
  })
})
