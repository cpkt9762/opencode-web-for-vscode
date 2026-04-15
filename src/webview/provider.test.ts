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

  it('T4: setState("no-project") renders create-project UI', () => {
    const provider = new OpenCodeWebviewProvider({ url: "http://localhost:4096" })
    const item = view()

    provider.resolveWebviewView(item)
    set(provider, "no-project")

    expect(item.webview.html).toContain('data-state="no-project"')
    expect(item.webview.html).toContain("Create OpenCode Project")
  })

  it('T5: setState("no-project") hides iframe', () => {
    const provider = new OpenCodeWebviewProvider({ url: "http://localhost:4096" })
    const item = view()

    provider.resolveWebviewView(item)
    set(provider, "no-project")

    expect(item.webview.html).toContain('data-state="no-project"')
    expect(item.webview.html).toContain("visibility:hidden")
  })

  it('T6: setState("no-project") shows folder path', () => {
    const provider = new OpenCodeWebviewProvider({ url: "http://localhost:4096" })
    const item = view()

    provider.resolveWebviewView(item)
    set(provider, "no-project", { folder: "/test/dir" })

    expect(item.webview.html).toContain("/test/dir")
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
})
