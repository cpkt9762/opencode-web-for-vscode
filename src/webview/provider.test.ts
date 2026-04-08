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

  it("webview script contains navigate handler", () => {
    const provider = new OpenCodeWebviewProvider({ url: "http://localhost:4096/L1Rlc3Q" })
    const item = view()

    provider.resolveWebviewView(item)

    expect(item.webview.html).toContain("opencode-web.navigate")
    expect(item.webview.html).toContain("sessionId")
    expect(item.webview.html).toContain("/session/")
  })
})
