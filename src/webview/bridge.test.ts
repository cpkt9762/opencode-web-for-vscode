import { describe, expect, it, vi } from "vitest"
import type * as vscode from "vscode"

import { MessageBridge, MSG } from "./bridge.js"

function view() {
  const set = new Set<(message: unknown) => void>()
  const post = vi.fn(async () => true)

  return {
    item: {
      webview: {
        onDidReceiveMessage(fn: (message: unknown) => void) {
          set.add(fn)
          return {
            dispose() {
              set.delete(fn)
            },
          }
        },
        postMessage: post,
      },
    } as unknown as vscode.WebviewView,
    emit(message: unknown) {
      set.forEach((fn) => {
        fn(message)
      })
    },
    post,
    size() {
      return set.size
    },
  }
}

describe("MessageBridge", () => {
  it("onMessage registers handler for specific type", () => {
    const item = view()
    const bridge = new MessageBridge(item.item)
    const fn = vi.fn()

    bridge.onMessage(MSG.frame_ready, fn)
    item.emit({ type: MSG.frame_ready, url: "http://localhost:4096" })

    expect(fn).toHaveBeenCalledOnce()
    expect(fn).toHaveBeenCalledWith({ url: "http://localhost:4096" })
  })

  it("post sends message to webview", async () => {
    const item = view()
    const bridge = new MessageBridge(item.item)

    await bridge.post(MSG.set_url, { url: "http://localhost:4096" })

    expect(item.post).toHaveBeenCalledWith({
      type: MSG.set_url,
      url: "http://localhost:4096",
    })
  })

  it("handler not called for wrong message type", () => {
    const item = view()
    const bridge = new MessageBridge(item.item)
    const fn = vi.fn()

    bridge.onMessage(MSG.frame_ready, fn)
    item.emit({ type: MSG.set_url, url: "http://localhost:4096" })

    expect(fn).not.toHaveBeenCalled()
  })

  it("dispose removes all listeners", () => {
    const item = view()
    const bridge = new MessageBridge(item.item)
    const a = vi.fn()
    const b = vi.fn()

    bridge.onMessage(MSG.frame_ready, a)
    bridge.onMessage(MSG.request_permission, b)
    bridge.dispose()
    item.emit({ type: MSG.frame_ready })
    item.emit({ type: MSG.request_permission })

    expect(a).not.toHaveBeenCalled()
    expect(b).not.toHaveBeenCalled()
    expect(item.size()).toBe(0)
  })

  it("MSG constants are correct strings", () => {
    expect(MSG).toEqual({
      set_url: "opencode-web.setUrl",
      navigate: "opencode-web.navigate",
      theme: "opencode-web.theme",
      frame_ready: "opencode-web.frame-ready",
      request_permission: "opencode-web.request-permission",
      request_question: "opencode-web.request-question",
      open_file: "opencode-web.open-file",
      copy_code: "opencode-web.copy-code",
    })
  })

  it("post navigate packs sessionId into message", () => {
    const item = view()
    const bridge = new MessageBridge(item.item)

    bridge.post(MSG.navigate, { sessionId: "ses_abc123" })

    expect(item.post).toHaveBeenCalledWith({
      type: "opencode-web.navigate",
      sessionId: "ses_abc123",
    })
  })
})
