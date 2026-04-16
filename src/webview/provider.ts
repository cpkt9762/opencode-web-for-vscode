import type * as vscode from "vscode"

export const VIEW_ID = "opencode-web.chatView"

type VS = typeof import("vscode")

type State = "loading" | "ready" | "error" | "no-project"

const WAIT = 8000

const MSG = {
  frame_ready: "opencode-web.frame-ready",
  retry: "opencode-web.retry",
  set_state: "opencode-web.setState",
  set_url: "opencode-web.setUrl",
} as const

function api(): VS {
  const mod = Reflect.get(globalThis, "__opencode_vscode") as VS | undefined
  if (mod) return mod
  return require("vscode") as VS
}

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

function note(url: string) {
  if (url === "about:blank") return "Open a folder in VSCode to get started."
  return "Start the local server, then try again."
}

function kind(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  if (typeof (input as { type?: unknown }).type !== "string") return
  return (input as { type: string }).type
}

function brief(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return `payload=${typeof input}`

  const data = input as Record<string, unknown>
  const list = Object.entries(data)
    .filter(([key]) => key !== "type")
    .flatMap(([key, value]) => {
      if (typeof value === "string") {
        if (key === "detail" || key === "msg" || key === "text") return [`${key}=${value.length} chars`]
        if (key === "url") return [`${key}=${value ? "set" : "empty"}`]
        return [`${key}=${value}`]
      }
      if (typeof value === "boolean") return [`${key}=${value}`]
      if (typeof value === "number") return [`${key}=${value}`]
      if (Array.isArray(value)) return [`${key}[${value.length}]`]
      if (!value) return [`${key}=null`]
      return [`${key}=object`]
    })

  if (list.length > 0) return list.join(" ")
  return "payload=none"
}

function page(url: string, state: State, folder?: string) {
  const n = nonce()
  const src = attr(url)
  const raw = JSON.stringify(url)
  const seed = JSON.stringify(state)
  const dir = attr(folder ?? "")
  const rawdir = JSON.stringify(folder ?? "")
  const msg = attr(note(url))

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
    #fail p,
    #noproj p {
      margin: 0;
      font-size: 13px;
      line-height: 1.5;
      color: rgba(249, 250, 251, 0.82);
    }

    #fail h2,
    #noproj h2 {
      margin: 0 0 8px;
      font-size: 15px;
    }

    #fail p,
    #noproj p {
      margin-bottom: 16px;
    }

    #mark {
      width: 40px;
      height: 40px;
      margin: 0 auto 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      background: rgba(37, 99, 235, 0.16);
      color: #93c5fd;
    }

    #mark svg {
      width: 22px;
      height: 22px;
    }

    #dir {
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.06);
      color: #dbeafe;
      font-size: 12px;
      word-break: break-all;
    }

    #retry,
    #create {
      border: 0;
      border-radius: 999px;
      padding: 10px 16px;
      background: #2563eb;
      color: #fff;
      font: inherit;
      cursor: pointer;
    }

    #retry:hover,
    #create:hover {
      background: #1d4ed8;
    }

    #fail[hidden],
    #noproj[hidden],
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
        <p id="warn">${msg}</p>
        <button id="retry" type="button">Retry</button>
      </div>
      <div id="noproj" hidden>
        <div id="mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6.75A1.75 1.75 0 0 1 4.75 5h4.38c.46 0 .9.18 1.23.51l1.4 1.4c.33.33.77.51 1.23.51h6.26A1.75 1.75 0 0 1 21 9.17v8.08A1.75 1.75 0 0 1 19.25 19H4.75A1.75 1.75 0 0 1 3 17.25z"/>
          </svg>
        </div>
        <h2>Create Project</h2>
        <p id="dir">${dir}</p>
        <p>This folder is not an OpenCode project.</p>
        <button id="create" type="button">Create OpenCode Project</button>
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
    const noproj = document.getElementById("noproj")
    const warn = document.getElementById("warn")
    const dir = document.getElementById("dir")
    const retry = document.getElementById("retry")
    const create = document.getElementById("create")
    const data = vscode.getState()
    const raw = ${raw}
    const seed = ${seed}
    const rawdir = ${rawdir}
    const keep = data && typeof data.url === "string" && data.url === raw
    let url = keep ? data.url : raw
    let state = keep && (data.state === "loading" || data.state === "ready" || data.state === "error" || data.state === "no-project") ? data.state : seed
    let folder = keep && typeof data.folder === "string" ? data.folder : rawdir

    /* --- DIAG --- */
    const diag = (label, detail) => {
      vscode.postMessage({ type: "opencode-web.diag", label, detail })
    }
    diag("init", JSON.stringify({ url, state, folder, keep: !!keep, seed }))

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
      vscode.setState(state === "no-project" ? { state, url, folder } : { state, url })
    }

    const sync = () => {
      if (warn instanceof HTMLElement) warn.textContent = url === "about:blank" ? "Open a folder in VSCode to get started." : "Start the local server, then try again."
      if (dir instanceof HTMLElement) dir.textContent = folder
    }

    const paint = (next) => {
      diag("paint", JSON.stringify({ next, folder }))
      state = next
      body.dataset.state = next
      sync()
      if (shell instanceof HTMLElement) shell.hidden = next === "ready"
      if (spin instanceof HTMLElement) spin.hidden = next !== "loading"
      if (text instanceof HTMLElement) text.hidden = next !== "loading"
      if (fail instanceof HTMLElement) fail.hidden = next !== "error"
      if (noproj instanceof HTMLElement) noproj.hidden = next !== "no-project"
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
        sync()
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
      if (event.data.state !== "loading" && event.data.state !== "ready" && event.data.state !== "error" && event.data.state !== "no-project") return
      folder = event.data.state === "no-project" && typeof event.data.folder === "string" ? event.data.folder : ""
      paint(event.data.state)
    })

    retry?.addEventListener("click", () => {
      vscode.postMessage({ type: "opencode-web.retry" })
    })

    create?.addEventListener("click", () => {
      vscode.postMessage({ type: "opencode-web.create-project" })
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
  private sub: vscode.Disposable[] = []
  private view?: vscode.WebviewView
  private url: string
  private state: State
  private folder?: string
  private seen = 0
  private timer?: ReturnType<typeof setTimeout>
  log?: (msg: string) => void
  onSession?: (id: string | null) => void

  constructor(input: { url: string }) {
    this.url = input.url
    this.state = init(input.url)
  }

  resolveWebviewView(view: vscode.WebviewView) {
    const mode = this.view ? "reresolve" : "create"
    this.seen += 1
    this.view = view
    view.webview.options = {
      enableScripts: true,
      enableForms: true,
      enableCommandUris: true,
      localResourceRoots: [],
    }
    this.log?.(
      `[webview:resolve] view=${view.viewType} mode=${mode} count=${this.seen} visible=${view.visible} opts=${JSON.stringify(view.webview.options)}`,
    )
    this.watch()
    if (this.url !== "about:blank" && this.state === "error") {
      this.state = "loading"
    }
    view.webview.html = page(this.url, this.state, this.folder)
    if (this.state === "loading") this.arm()
  }

  setUrl(url: string) {
    const same = url === this.url
    this.url = url
    this.setState(init(url))
    if (!this.view) return
    if (!same && this.post(MSG.set_url, { url })) return
    this.view.webview.html = page(url, this.state, this.folder)
  }

  setState(state: State, opts?: { folder?: string }) {
    const folder = state === "no-project" ? opts?.folder : undefined
    if (state === "loading") this.arm()
    if (state !== "loading") this.stop()
    if (this.state === state && this.folder === folder) return
    this.state = state
    this.folder = folder
    if (!this.view) return
    if (this.post(MSG.set_state, { state })) return
    this.view.webview.html = page(this.url, state, folder)
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
    const data =
      type === MSG.set_state && payload.state === "no-project" ? { ...payload, folder: this.folder } : payload
    void post.call(this.view.webview, { type, ...data })
    return true
  }

  private drop() {
    this.sub.forEach((item) => {
      item.dispose()
    })
    this.sub = []
  }

  private watch() {
    this.drop()
    if (!this.view) return
    const view = this.view
    const on = Reflect.get(view.webview, "onDidReceiveMessage")
    if (typeof on !== "function") return

    this.sub.push(
      on.call(view.webview, (input: unknown) => {
        const type = kind(input)
        this.log?.(`[webview:msg] type=${type ?? "unknown"} ${brief(input)}`)
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
          void api().env.clipboard.writeText(text)
          if (this.log) this.log(`[clipboard] write ${text.length} chars`)
          return
        }
        if (type === "opencode-web.clipboard-read") {
          void api()
            .env.clipboard.readText()
            .then((text) => {
              if (this.log) this.log(`[clipboard] read ${text.length} chars`)
              this.post("opencode-web.clipboard-text", { text })
            })
          return
        }
        if (type === MSG.retry) {
          this.setUrl(this.url)
          return
        }
        if (type === MSG.frame_ready) {
          const url = (input as { url?: string }).url
          if (this.log) this.log(`[SPA] frame-ready: ${url ?? "unknown"}`)
        }
        if (type !== MSG.frame_ready || this.url === "about:blank") return
        this.setState("ready")
      }) as vscode.Disposable,
    )

    const vis = Reflect.get(view, "onDidChangeVisibility")
    if (typeof vis === "function") {
      this.sub.push(
        vis.call(view, () => {
          const active = Reflect.get(view, "active")
          this.log?.(`[webview:state] visible=${view.visible} active=${typeof active === "boolean" ? active : "n/a"}`)
        }) as vscode.Disposable,
      )
    }

    const die = Reflect.get(view, "onDidDispose")
    if (typeof die === "function") {
      this.sub.push(
        die.call(view, () => {
          this.log?.(`[webview:dispose] view=${view.viewType} visible=${view.visible}`)
          if (this.view === view) this.view = undefined
          this.stop()
          this.drop()
        }) as vscode.Disposable,
      )
    }
  }
}
