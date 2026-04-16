import { describe, expect, it, vi } from "vitest"
import type * as vscode from "vscode"

vi.mock("vscode", () => ({
  env: { clipboard: { readText: vi.fn(() => Promise.resolve("")), writeText: vi.fn() } },
}))

import { OpenCodeWebviewProvider } from "./provider.js"

function view() {
  return {
    webview: {
      html: "",
      options: undefined,
    },
  } as unknown as vscode.WebviewView
}

function live() {
  return {
    webview: {
      html: "",
      onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      options: undefined,
      postMessage: vi.fn(),
    },
  } as unknown as vscode.WebviewView
}

function hook() {
  const state = {
    die: undefined as (() => void) | undefined,
    msg: undefined as ((input: unknown) => void) | undefined,
    vis: undefined as (() => void) | undefined,
  }

  const item = {
    viewType: "opencode-web.chatView",
    visible: true,
    onDidChangeVisibility: vi.fn((cb: () => void) => {
      state.vis = cb
      return { dispose: vi.fn() }
    }),
    onDidDispose: vi.fn((cb: () => void) => {
      state.die = cb
      return { dispose: vi.fn() }
    }),
    webview: {
      html: "",
      onDidReceiveMessage: vi.fn((cb: (input: unknown) => void) => {
        state.msg = cb
        return { dispose: vi.fn() }
      }),
      options: undefined,
      postMessage: vi.fn(),
    },
  } as unknown as vscode.WebviewView

  return { item, state }
}

function set(provider: OpenCodeWebviewProvider, state: string, opts?: { folder?: string }) {
  const fn = Reflect.get(provider, "setState") as (state: string, opts?: { folder?: string }) => void
  fn.call(provider, state, opts)
}

describe("OpenCodeWebviewProvider", () => {
  it("resolveWebviewView sets enableScripts", () => {
    const provider = new OpenCodeWebviewProvider({ url: "http://localhost:4096" })
    const item = view()

    provider.resolveWebviewView(item)

    expect(item.webview.options).toEqual({
      enableScripts: true,
      enableForms: true,
      enableCommandUris: true,
      localResourceRoots: [],
    })
  })

  it("renders CSP with localhost frame-src", () => {
    const provider = new OpenCodeWebviewProvider({ url: "http://localhost:4096" })
    const item = view()

    provider.resolveWebviewView(item)

    expect(item.webview.html).toContain("frame-src http://localhost:* http://127.0.0.1:*")
  })

  it("renders iframe with the current url", () => {
    const provider = new OpenCodeWebviewProvider({ url: "http://localhost:4096" })
    const item = view()

    provider.resolveWebviewView(item)

    expect(item.webview.html).toContain('iframe id="opencode-frame" src="http://localhost:4096"')
  })

  it("iframe grants clipboard permissions for SPA", () => {
    const provider = new OpenCodeWebviewProvider({ url: "http://localhost:4096" })
    const item = view()

    provider.resolveWebviewView(item)

    expect(item.webview.html).toContain("clipboard-read")
    expect(item.webview.html).toContain("clipboard-write")
  })

  it("webview options enable forms for clipboard support", () => {
    const provider = new OpenCodeWebviewProvider({ url: "http://localhost:4096" })
    const item = view()

    provider.resolveWebviewView(item)

    expect(item.webview.options).toMatchObject({
      enableScripts: true,
      enableForms: true,
    })
  })

  it("renders a nonce on the inline script", () => {
    const provider = new OpenCodeWebviewProvider({ url: "http://localhost:4096" })
    const item = view()

    provider.resolveWebviewView(item)

    expect(item.webview.html).toMatch(/<script nonce="[^"]+">/)
  })

  it("setUrl updates the current view html", () => {
    const provider = new OpenCodeWebviewProvider({ url: "http://localhost:4096" })
    const item = view()

    provider.resolveWebviewView(item)
    const prev = item.webview.html

    provider.setUrl("http://localhost:4097")

    expect(item.webview.html).not.toBe(prev)
    expect(item.webview.html).toContain('iframe id="opencode-frame" src="http://localhost:4097"')
  })

  it("T4: setUrl(root) returns webview to loading state", () => {
    const provider = new OpenCodeWebviewProvider({ url: "http://localhost:4096" })
    const item = view()

    provider.resolveWebviewView(item)
    set(provider, "no-project", { folder: "/test/dir" })
    provider.setUrl("http://localhost:4096")

    expect(item.webview.html).toContain('data-state="loading"')
    expect(item.webview.html).toContain('iframe id="opencode-frame" src="http://localhost:4096"')
  })

  it("T5: setUrl(root) clears no-project folder metadata", () => {
    const provider = new OpenCodeWebviewProvider({ url: "http://localhost:4096" })
    const item = view()

    provider.resolveWebviewView(item)
    set(provider, "no-project", { folder: "/test/dir" })
    provider.setUrl("http://localhost:4096")

    expect(item.webview.html).not.toContain("/test/dir")
  })

  it("T6: setUrl(same) re-renders when postMessage transport is active", () => {
    const provider = new OpenCodeWebviewProvider({ url: "http://localhost:4096" })
    const item = live()

    provider.resolveWebviewView(item)
    const prev = item.webview.html
    provider.setUrl("http://localhost:4096")

    expect(item.webview.html).not.toBe(prev)
    expect(item.webview.html).toContain('data-state="loading"')
  })

  it('T7: setState from "no-project" to "loading" re-renders correctly', () => {
    const provider = new OpenCodeWebviewProvider({ url: "http://localhost:4096" })
    const item = view()

    provider.resolveWebviewView(item)
    set(provider, "no-project")
    set(provider, "loading")

    expect(item.webview.html).toContain('data-state="loading"')
    expect(item.webview.html).toContain('id="spin" aria-hidden="true"></div>')
    expect(item.webview.html).toContain('id="noproj" hidden')
  })

  it('T8: setUrl("about:blank") shows "open a folder" message', () => {
    const provider = new OpenCodeWebviewProvider({ url: "http://localhost:4096" })
    const item = view()

    provider.resolveWebviewView(item)
    provider.setUrl("about:blank")

    expect(item.webview.html).toContain("Open a folder in VSCode to get started")
  })

  it("webview script contains navigate handler", () => {
    const provider = new OpenCodeWebviewProvider({ url: "http://localhost:4096/L1Rlc3Q" })
    const item = view()

    provider.resolveWebviewView(item)

    expect(item.webview.html).toContain("opencode-web.navigate")
    expect(item.webview.html).toContain("sessionId")
    expect(item.webview.html).toContain("/session/")
  })

  it("logs lifecycle and bridge events with minimal payloads", () => {
    const provider = new OpenCodeWebviewProvider({ url: "http://localhost:4096" })
    const log = vi.fn()
    const { item, state } = hook()
    provider.log = log

    provider.resolveWebviewView(item)
    state.vis?.()
    state.msg?.({ type: "opencode-web.frame-ready", url: "http://localhost:4096" })
    state.msg?.({ type: "opencode-web.session-changed", sessionId: "ses_123" })
    state.msg?.({ type: "opencode-web.spa-log", msg: "[bootstrap] ready" })
    state.die?.()

    expect(log).toHaveBeenCalledWith(expect.stringContaining("[webview:resolve]"))
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[webview:state] visible=true"))
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[webview:msg] type=opencode-web.frame-ready url=set"))
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[SPA] frame-ready: http://localhost:4096"))
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("[webview:msg] type=opencode-web.session-changed sessionId=ses_123"),
    )
    expect(log).toHaveBeenCalledWith("[SPA] session-changed: ses_123")
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[webview:msg] type=opencode-web.spa-log msg=17 chars"))
    expect(log).toHaveBeenCalledWith("[SPA] [bootstrap] ready")
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[webview:dispose]"))
  })
})
