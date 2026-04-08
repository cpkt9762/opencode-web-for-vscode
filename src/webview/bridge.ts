import type * as vscode from "vscode"

export const MSG = {
  set_url: "opencode-web.setUrl",
  navigate: "opencode-web.navigate",
  theme: "opencode-web.theme",
  frame_ready: "opencode-web.frame-ready",
  request_permission: "opencode-web.request-permission",
  request_question: "opencode-web.request-question",
  open_file: "opencode-web.open-file",
  copy_code: "opencode-web.copy-code",
} as const

function pack(type: string, payload?: unknown) {
  if (payload === undefined) return { type }
  if (typeof payload === "object" && payload && !Array.isArray(payload)) {
    return { type, ...payload }
  }
  return { type, payload }
}

function unpack(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  if (typeof (input as { type?: unknown }).type !== "string") return

  const msg = input as Record<string, unknown> & { type: string }
  const rest = Object.fromEntries(Object.entries(msg).filter(([key]) => key !== "type"))
  const keys = Object.keys(rest)

  if (keys.length === 0) {
    return {
      type: msg.type,
      payload: undefined,
    }
  }

  if (keys.length === 1 && "payload" in rest) {
    return {
      type: msg.type,
      payload: rest.payload,
    }
  }

  return {
    type: msg.type,
    payload: rest,
  }
}

export class MessageBridge {
  private map = new Map<string, Set<(payload: unknown) => void>>()
  private off: vscode.Disposable
  private view: vscode.WebviewView

  constructor(view: vscode.WebviewView) {
    this.view = view
    this.off = view.webview.onDidReceiveMessage((input) => {
      const msg = unpack(input)
      if (!msg) return

      const set = this.map.get(msg.type)
      if (!set) return

      set.forEach((fn) => {
        fn(msg.payload)
      })
    })
  }

  onMessage(type: string, handler: (payload: unknown) => void) {
    const set = this.map.get(type) ?? new Set<(payload: unknown) => void>()
    set.add(handler)
    this.map.set(type, set)

    return {
      dispose: () => {
        const next = this.map.get(type)
        if (!next) return
        next.delete(handler)
        if (next.size > 0) return
        this.map.delete(type)
      },
    }
  }

  post(type: string, payload?: unknown) {
    return this.view.webview.postMessage(pack(type, payload))
  }

  dispose() {
    this.off.dispose()
    this.map.clear()
  }
}
