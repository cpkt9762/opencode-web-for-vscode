import { describe, expect, it } from "vitest"

import { html, nonce } from "../src/provider"

describe("provider html", () => {
  it("adds frame-src localhost to the CSP meta tag", () => {
    const out = html({
      csp: "vscode-webview://test",
      url: "http://localhost:57777",
      nonce: "abc123",
    })

    expect(out).toContain('<meta http-equiv="Content-Security-Policy"')
    expect(out).toContain("default-src 'none';")
    expect(out).toContain("frame-src http://localhost:*;")
  })

  it("injects the iframe with the requested localhost url", () => {
    const out = html({
      csp: "vscode-webview://test",
      url: "http://localhost:57777/app",
      nonce: "abc123",
    })

    expect(out).toContain("<iframe")
    expect(out).toContain('id="opencode-frame"')
    expect(out).toContain('src="http://localhost:57777/app"')
  })

  it("uses a nonce-based script policy and script tag", () => {
    const out = html({
      csp: "vscode-webview://test",
      url: "http://localhost:57777",
      nonce: "nonce-42",
    })

    expect(out).toContain("script-src 'nonce-nonce-42';")
    expect(out).toContain('<script nonce="nonce-42">')
    expect(out).not.toContain("script-src 'unsafe-inline'")
  })
})

describe("nonce", () => {
  it("returns a fresh random nonce", () => {
    const a = nonce()
    const b = nonce()

    expect(a).toMatch(/^[A-Za-z0-9]+$/)
    expect(b).toMatch(/^[A-Za-z0-9]+$/)
    expect(a).not.toBe(b)
  })
})
