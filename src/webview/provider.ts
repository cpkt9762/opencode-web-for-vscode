import * as vscode from "vscode"

export const VIEW_ID = "opencode-web.chatView"

type State = "loading" | "ready" | "error"

const WAIT = 8000

const MSG = {
  frame_ready: "opencode-web.frame-ready",
  retry: "opencode-web.retry",
  set_state: "opencode-web.setState",
  set_url: "opencode-web.setUrl",
} as const

function nonce() {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(36)).join("")
}

function attr(input: string) {
  return input.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")
}

function init(url: string): State {
  if (url === "about:blank") return "error"
  return "loading"
}

function kind(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  if (typeof (input as { type?: unknown }).type !== "string") return
  return (input as { type: string }).type
}

function page(url: string, state: State) {
  const n = nonce()
  const src = attr(url)
  const raw = JSON.stringify(url)
  const seed = JSON.stringify(state)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://localhost:* http://127.0.0.1:*; script-src 'nonce-${n}'; style-src 'unsafe-inline';">
  <title>OpenCode</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: #111827;
      color: #f9fafb;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    #shell {
      position: absolute;
      inset: 0;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(180deg, #111827 0%, #030712 100%);
    }

    #box {
      width: min(320px, calc(100vw - 48px));
      padding: 24px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      background: rgba(17, 24, 39, 0.92);
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
      text-align: center;
    }

    #spin {
      width: 28px;
      height: 28px;
      margin: 0 auto 14px;
      border: 3px solid rgba(255, 255, 255, 0.2);
      border-top-color: #60a5fa;
      border-radius: 999px;
      animation: spin 0.9s linear infinite;
    }

    #text,
    #fail p {
      margin: 0;
      font-size: 13px;
      line-height: 1.5;
      color: rgba(249, 250, 251, 0.82);
    }

    #fail h2 {
      margin: 0 0 8px;
      font-size: 15px;
    }

    #fail p {
      margin-bottom: 16px;
    }

    #retry {
      border: 0;
      border-radius: 999px;
      padding: 10px 16px;
      background: #2563eb;
      color: #fff;
      font: inherit;
      cursor: pointer;
    }

    #retry:hover {
      background: #1d4ed8;
    }

    #fail[hidden],
    #spin[hidden],
    #text[hidden],
    #shell[hidden] {
      display: none;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  </style>
</head>
<body data-state="${state}">
  <div id="shell">
    <div id="box">
      <div id="spin" aria-hidden="true"></div>
      <p id="text">Connecting to OpenCode…</p>
      <div id="fail" hidden>
        <h2>OpenCode unavailable</h2>
        <p>Start the local server, then try again.</p>
        <button id="retry" type="button">Retry</button>
      </div>
    </div>
  </div>
  <iframe id="opencode-frame" src="${src}" title="OpenCode" allow="clipboard-read; clipboard-write; autoplay" style="width:100%;height:100vh;border:none;visibility:hidden;"></iframe>
  <script nonce="${n}">
    const vscode = acquireVsCodeApi()
    const body = document.body
    const frame = document.getElementById("opencode-frame")
    const shell = document.getElementById("shell")
    const spin = document.getElementById("spin")
    const text = document.getElementById("text")
    const fail = document.getElementById("fail")
    const retry = document.getElementById("retry")
    const data = vscode.getState()
    const raw = ${raw}
    const seed = ${seed}
    const keep = data && typeof data.url === "string" && data.url === raw
    let url = keep ? data.url : raw
    let state = keep && (data.state === "loading" || data.state === "ready" || data.state === "error") ? data.state : seed

    /* --- DIAG --- */
    const diag = (label, detail) => {
      vscode.postMessage({ type: "opencode-web.diag", label, detail })
    }
    diag("init", JSON.stringify({ url, state, keep: !!keep, seed }))

    if (frame instanceof HTMLIFrameElement) {
      new MutationObserver((list) => {
        for (const m of list) if (m.attributeName === "src") diag("src-changed", frame.src)
      }).observe(frame, { attributes: true, attributeFilter: ["src"] })
    }
    const snap = (tag) => diag(tag, JSON.stringify({ state, src: frame?.src, vis: frame?.style?.visibility, shell: shell?.hidden }))
    setTimeout(() => snap("t+3s"), 3000)
    setTimeout(() => snap("t+8s"), 8000)
    setTimeout(() => snap("t+15s"), 15000)
    /* --- END DIAG --- */

    const save = () => {
      vscode.setState({ state, url })
    }

    const paint = (next) => {
      diag("paint", next)
      state = next
      body.dataset.state = next
      if (shell instanceof HTMLElement) shell.hidden = next === "ready"
      if (spin instanceof HTMLElement) spin.hidden = next === "error"
      if (text instanceof HTMLElement) text.hidden = next === "error"
      if (fail instanceof HTMLElement) fail.hidden = next !== "error"
      if (frame instanceof HTMLIFrameElement) frame.style.visibility = next === "ready" ? "visible" : "hidden"
      save()
    }

    window.addEventListener("message", (event) => {
      if (event.data?.type === "opencode-web.spa-log") {
        vscode.postMessage({ type: "opencode-web.spa-log", msg: event.data.msg })
        return
      }
      if (event.data?.type === "opencode-web.session-changed") {
        vscode.postMessage({ type: "opencode-web.session-changed", sessionId: event.data.sessionId })
        return
      }
      if (event.data?.type === "opencode-web.clipboard-write") {
        vscode.postMessage({ type: "opencode-web.clipboard-write", text: event.data.text })
        return
      }
      if (event.data?.type === "opencode-web.clipboard-read") {
        vscode.postMessage({ type: "opencode-web.clipboard-read" })
        return
      }
      if (event.data?.type === "opencode-web.clipboard-text") {
        if (frame instanceof HTMLIFrameElement && frame.contentWindow) {
          frame.contentWindow.postMessage(event.data, "*")
        }
        return
      }
      if (event.data?.type?.startsWith("opencode-web.")) {
        diag("msg-recv", event.data.type)
      }
      if (event.data?.type === "opencode-web.setUrl") {
        if (!(frame instanceof HTMLIFrameElement)) return
        if (typeof event.data.url !== "string") return
        diag("setUrl", JSON.stringify({ old: url, next: event.data.url, same: event.data.url === url }))
        if (event.data.url === url) return
        url = event.data.url
        frame.src = event.data.url
        save()
        return
      }
      if (event.data?.type === "opencode-web.navigate") {
        if (!(frame instanceof HTMLIFrameElement)) return
        var sid = event.data.sessionId
        if (typeof sid !== "string") return
        var base = new URL(url)
        var slug = base.pathname.split("/").filter(Boolean)[0] || ""
        var target = base.origin + "/" + slug + "/session/" + sid
        diag("navigate", JSON.stringify({ sessionId: sid, target: target }))
        try { frame.contentWindow.location.href = target } catch(e) { frame.src = target }
        return
      }
      if (event.data?.type !== "opencode-web.setState") return
      if (event.data.state !== "loading" && event.data.state !== "ready" && event.data.state !== "error") return
      paint(event.data.state)
    })

    retry?.addEventListener("click", () => {
      vscode.postMessage({ type: "opencode-web.retry" })
    })

    frame?.addEventListener("load", () => {
      if (!(frame instanceof HTMLIFrameElement)) return
      diag("iframe-load", JSON.stringify({ src: frame.src, blank: url === "about:blank" }))
      if (url === "about:blank") return
      vscode.postMessage({
        type: "opencode-web.frame-ready",
        url: frame.src,
      })
    })

    paint(state)
  </script>
</body>
</html>`
}

export class OpenCodeWebviewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView
  private url: string
  private state: State
  private off?: vscode.Disposable
  private timer?: ReturnType<typeof setTimeout>
  log?: (msg: string) => void
  onSession?: (id: string | null) => void

  constructor(input: { url: string }) {
    this.url = input.url
    this.state = init(input.url)
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view
    view.webview.options = {
      enableScripts: true,
      enableForms: true,
      enableCommandUris: true,
      localResourceRoots: [],
    }
    this.watch()
    if (this.url !== "about:blank" && this.state === "error") {
      this.state = "loading"
    }
    view.webview.html = page(this.url, this.state)
    if (this.state === "loading") this.arm()
  }

  setUrl(url: string) {
    this.url = url
    this.setState(init(url))
    if (!this.view) return
    if (this.post(MSG.set_url, { url })) return
    this.view.webview.html = page(url, this.state)
  }

  setState(state: State) {
    if (state === "loading") this.arm()
    if (state !== "loading") this.stop()
    if (this.state === state) return
    this.state = state
    if (!this.view) return
    if (this.post(MSG.set_state, { state })) return
    this.view.webview.html = page(this.url, state)
  }

  private arm() {
    this.stop()
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.setState("error")
    }, WAIT)
    this.timer.unref?.()
  }

  private stop() {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private post(type: string, payload: Record<string, unknown>) {
    if (!this.view) return false
    const post = Reflect.get(this.view.webview, "postMessage")
    if (typeof post !== "function") return false
    void post.call(this.view.webview, { type, ...payload })
    return true
  }

  private watch() {
    this.off?.dispose()
    this.off = undefined
    if (!this.view) return
    const on = Reflect.get(this.view.webview, "onDidReceiveMessage")
    if (typeof on !== "function") return
    this.off = on.call(this.view.webview, (input: unknown) => {
      const type = kind(input)
      if (type === "opencode-web.spa-log") {
        const msg = (input as { msg?: string }).msg
        if (msg && this.log) this.log(`[SPA] ${msg}`)
        return
      }
      if (type === "opencode-web.session-changed") {
        const sid = (input as { sessionId?: string }).sessionId
        if (this.log) this.log(`[SPA] session-changed: ${sid ?? "none"}`)
        if (this.onSession) this.onSession(sid ?? null)
        return
      }
      if (type === "opencode-web.clipboard-write") {
        const text = (input as { text?: string }).text ?? ""
        void vscode.env.clipboard.writeText(text)
        if (this.log) this.log(`[clipboard] write ${text.length} chars`)
        return
      }
      if (type === "opencode-web.clipboard-read") {
        void vscode.env.clipboard.readText().then((text) => {
          if (this.log) this.log(`[clipboard] read ${text.length} chars`)
          this.post("opencode-web.clipboard-text", { text })
        })
        return
      }
      if (type === MSG.retry) {
        this.setUrl(this.url)
        return
      }
      if (type !== MSG.frame_ready || this.url === "about:blank") return
      this.setState("ready")
    }) as vscode.Disposable
  }
}
