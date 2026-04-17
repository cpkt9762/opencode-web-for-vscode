import { existsSync, readFileSync } from "node:fs"
import { createServer, type IncomingMessage, request as req, type Server, type ServerResponse } from "node:http"
import { request as httpsReq } from "node:https"
import { extname, join } from "node:path"

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".aac": "audio/aac",
  ".png": "image/png",
}

const HEALTH = "/opencode-spa-health"

export const API = [
  // server.ts (control plane)
  "/global",
  "/auth",
  "/doc",
  "/log",
  // instance.ts (.route)
  "/project",
  "/session",
  "/permission",
  "/question",
  "/provider",
  "/config",
  "/pty",
  "/mcp",
  "/experimental",
  "/tui",
  // instance.ts (FileRoutes at /)
  "/find",
  "/file",
  // instance.ts (EventRoutes at /)
  "/event",
  // instance.ts (standalone)
  "/path",
  "/vcs",
  "/command",
  "/agent",
  "/skill",
  "/lsp",
  "/formatter",
  "/instance",
]

const BOOTSTRAP = `<script>
;(function(){
  function blog(m){ try { window.parent && window.parent.postMessage({type:"opencode-web.spa-log",msg:"[bootstrap] "+m},"*") } catch(e){} }
  var p = location.pathname.split("/").filter(Boolean)[0]
  if (!p) { blog("no slug in path"); return }
  try {
    var dir = decodeURIComponent(escape(atob(p.replace(/-/g,"+").replace(/_/g,"/"))))
  } catch(e) { blog("decode failed: " + e.message); return }
  blog("dir=" + dir)
  var key = "opencode.global.dat:server"
  var host = location.hostname
  var sk = (host === "localhost" || host === "127.0.0.1") ? "local" : location.origin
  blog("storage key=" + sk)
  function load(){
    var raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : {list:[],projects:{},lastProject:{}}
  }
  var store = load()
  store.projects = store.projects || {}
  store.lastProject = store.lastProject || {}
  if (dir) {
    store.projects[sk] = [{worktree: dir, expanded: true}]
    store.lastProject[sk] = dir
    blog("reset to current project only: " + dir)
  } else {
    blog("no directory, skipping project seed")
  }
  localStorage.setItem(key, JSON.stringify(store))
  blog("verify: " + (store.projects[sk] || []).length + " projects under key '" + sk + "'")
  var lk = "opencode.global.dat:layout"
  if (!localStorage.getItem(lk)) {
    localStorage.setItem(lk, JSON.stringify({review:{diffStyle:"split",panelOpened:false}}))
    blog("seeded layout (review panel closed)")
  }
  var skey = "settings.v3"
  var s = {}
  var sraw = localStorage.getItem(skey)
  if (sraw) {
    try {
      s = JSON.parse(sraw) || {}
    } catch(e) {
      blog("settings parse failed: " + e.message)
      s = {}
    }
  }
  s.general = s.general || {}
  var seeded = false
  if (typeof s.general.shellToolPartsExpanded !== "boolean") {
    s.general.shellToolPartsExpanded = true
    seeded = true
  }
  if (typeof s.general.editToolPartsExpanded !== "boolean") {
    s.general.editToolPartsExpanded = true
    seeded = true
  }
  if (seeded) {
    localStorage.setItem(skey, JSON.stringify(s))
    blog("seeded shellToolPartsExpanded=true editToolPartsExpanded=true")
  }
  ;(function() {
    if (typeof navigator === "undefined") return
    var origWrite = null
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        origWrite = navigator.clipboard.writeText.bind(navigator.clipboard)
      }
    } catch(e) {
      blog("clipboard native probe failed: " + e.message)
    }
    function getVscodeApi() {
      if (typeof window === "undefined") return null
      if (window.__opencodeVscodeApi) return window.__opencodeVscodeApi
      if (typeof acquireVsCodeApi !== "function") return null
      try {
        window.__opencodeVscodeApi = acquireVsCodeApi()
      } catch(e) {
        blog("acquireVsCodeApi failed: " + e.message)
        return null
      }
      return window.__opencodeVscodeApi
    }
    function removeNode(node) {
      if (!node) return
      try {
        if (node.parentNode && typeof node.parentNode.removeChild === "function") {
          node.parentNode.removeChild(node)
          return
        }
        if (document.body && typeof document.body.removeChild === "function") {
          document.body.removeChild(node)
        }
      } catch(e) {
        blog("textarea cleanup failed: " + e.message)
      }
    }
    function execCommandCopy(text) {
      if (typeof document === "undefined") return false
      if (!document.body || typeof document.createElement !== "function") return false
      var ta = null
      try {
        ta = document.createElement("textarea")
        ta.value = text
        if (typeof ta.setAttribute === "function") ta.setAttribute("readonly", "")
        if (ta.style) {
          ta.style.position = "fixed"
          ta.style.left = "-9999px"
          ta.style.top = "0"
        }
        document.body.appendChild(ta)
        if (typeof ta.focus === "function") ta.focus()
        if (typeof ta.select === "function") ta.select()
        var ok = typeof document.execCommand === "function" ? document.execCommand("copy") : false
        removeNode(ta)
        return ok === true
      } catch(e) {
        blog("execCommand copy failed: " + e.message)
        removeNode(ta)
        return false
      }
    }
    function postMessageCopy(text) {
      var api = getVscodeApi()
      if (api && typeof api.postMessage === "function") {
        try {
          api.postMessage({ type: "opencode.clipboard.write", text: text })
          return true
        } catch(e) {
          blog("vscode api postMessage failed: " + e.message)
        }
      }
      if (typeof window === "undefined" || !window.parent || typeof window.parent.postMessage !== "function") return false
      try {
        window.parent.postMessage({ type: "opencode.clipboard.write", text: text }, "*")
        return true
      } catch(e) {
        blog("postMessage copy failed: " + e.message)
        return false
      }
    }
    function fallbackWriteText(text) {
      if (execCommandCopy(text)) return Promise.resolve()
      if (postMessageCopy(text)) return Promise.resolve()
      return Promise.reject(new Error("clipboard unavailable in webview"))
    }
    try {
      if (!navigator.clipboard) navigator.clipboard = {}
      navigator.clipboard.writeText = function(text) {
        if (origWrite) {
          return origWrite(text).catch(function() {
            return fallbackWriteText(text)
          })
        }
        return fallbackWriteText(text)
      }
      blog("clipboard polyfill installed")
    } catch(e) {
      blog("clipboard polyfill install failed: " + e.message)
    }
  })()
  ;(function() {
    if (typeof document === "undefined") return
    try {
      var style = document.createElement("style")
      style.id = "opencode-ext-toolbar-hide"
      style.textContent =
        'button[aria-controls="terminal-panel"],' +
        'button[aria-controls="file-tree-panel"],' +
        'button[aria-controls="review-panel"] { display: none !important; }'
      if (document.head) {
        document.head.appendChild(style)
      } else {
        document.addEventListener("DOMContentLoaded", function() {
          if (document.head) document.head.appendChild(style)
        })
      }
      blog("toolbar-hide CSS injected")
    } catch(e) {
      blog("toolbar-hide CSS inject failed: " + e.message)
    }
  })()
  ;(function() {
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") return

    var COMMANDS = {
      explorer: "workbench.view.explorer",
      terminal: "workbench.action.terminal.toggleTerminal",
    }
    var BACKSLASH = String.fromCharCode(92)
    var BACKTICK = String.fromCharCode(96)

    function forwardCommand(command) {
      var api = (typeof window !== "undefined" && window.__opencodeVscodeApi) || null
      if (!api && typeof acquireVsCodeApi === "function") {
        try {
          api = acquireVsCodeApi()
          window.__opencodeVscodeApi = api
        } catch(e) {}
      }
      var payload = { type: "opencode.vscode.command", command: command }
      if (api && typeof api.postMessage === "function") {
        try {
          api.postMessage(payload)
          return true
        } catch(e) {
          blog("vscode api forward failed: " + e.message)
        }
      }
      if (typeof window === "undefined" || !window.parent || typeof window.parent.postMessage !== "function") return false
      try {
        window.parent.postMessage(payload, "*")
        return true
      } catch(e) {
        blog("parent forward failed: " + e.message)
        return false
      }
    }

    document.addEventListener(
      "keydown",
      function(e) {
        if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === BACKTICK) {
          if (forwardCommand(COMMANDS.terminal)) {
            e.preventDefault()
            e.stopImmediatePropagation()
            blog("forwarded ctrl+backtick to VSCode terminal")
          }
          return
        }
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === BACKSLASH) {
          if (forwardCommand(COMMANDS.explorer)) {
            e.preventDefault()
            e.stopImmediatePropagation()
            blog("forwarded mod+backslash to VSCode explorer")
          }
        }
      },
      true,
    )
    blog("keydown-forward listener installed")
  })()
  var lps = (store.lastProject && store.lastProject[sk]) || "none"
  var lpsKey = "opencode.global.dat:layout"
  var lpsRaw = localStorage.getItem(lpsKey)
  var lpSession = "none"
  try {
    if (lpsRaw) {
      var lp = JSON.parse(lpsRaw)
      if (lp && lp.lastProjectSession) {
        var keys = Object.keys(lp.lastProjectSession)
        lpSession = keys.length ? JSON.stringify(lp.lastProjectSession) : "empty"
      }
    }
  } catch(e) {}
  blog("lastProject=" + lps + " lastProjectSession=" + lpSession)
  function send(type, data) { try { window.parent.postMessage(Object.assign({type:type}, data), "*") } catch(e) {} }
  function insertAtCaret(text) {
    if (document.execCommand && document.execCommand("insertText", false, text)) return true
    var sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return false
    var range = sel.getRangeAt(0)
    range.deleteContents()
    range.insertNode(document.createTextNode(text))
    range.collapse(false)
    return true
  }
  document.addEventListener("keydown", function(e) {
    if (!(e.metaKey || e.ctrlKey)) return
    if (e.key === "c" || e.key === "x") {
      var sel = window.getSelection()
      var text = sel ? sel.toString() : ""
      if (text) {
        e.preventDefault()
        e.stopPropagation()
        send("opencode-web.clipboard-write", {text: text})
        if (e.key === "x" && document.activeElement && document.activeElement.isContentEditable) {
          var range = sel.getRangeAt(0)
          range.deleteContents()
        }
        blog("clipboard-write " + text.length + " chars")
      }
    } else if (e.key === "v") {
      var active = document.activeElement
      if (!(active && (active.isContentEditable || active.tagName === "INPUT" || active.tagName === "TEXTAREA"))) return
      e.preventDefault()
      e.stopPropagation()
      send("opencode-web.clipboard-read", {})
      blog("clipboard-read requested")
    }
  }, true)
  var pendingPaste = false
  window.addEventListener("message", function(e) {
    if (e.data && e.data.type === "opencode-web.clipboard-text") {
      var text = e.data.text || ""
      blog("clipboard-text received " + text.length + " chars")
      if (text) insertAtCaret(text)
      pendingPaste = false
    }
  })
  var menuStyle = "position:fixed;z-index:2147483647;background:#252526;border:1px solid #454545;border-radius:6px;padding:4px 0;min-width:160px;box-shadow:0 4px 16px rgba(0,0,0,0.5);font-family:-apple-system,BlinkMacSystemFont,\\"Segoe UI\\",sans-serif;font-size:13px;color:#cccccc;user-select:none;"
  var itemStyle = "padding:5px 14px;cursor:pointer;display:flex;justify-content:space-between;gap:24px;"
  var itemHover = "background:#094771;color:#fff;"
  var dividerStyle = "height:1px;background:#454545;margin:4px 0;"
  var disabledStyle = "opacity:0.4;cursor:default;"
  var menu = null
  function closeMenu() { if (menu && menu.parentNode) menu.parentNode.removeChild(menu); menu = null }
  function makeItem(label, shortcut, action, disabled) {
    var item = document.createElement("div")
    item.style.cssText = itemStyle + (disabled ? disabledStyle : "")
    var l = document.createElement("span")
    l.textContent = label
    var s = document.createElement("span")
    s.textContent = shortcut || ""
    s.style.cssText = "opacity:0.6;"
    item.appendChild(l)
    item.appendChild(s)
    if (!disabled) {
      item.addEventListener("mouseenter", function() { item.style.cssText = itemStyle + itemHover })
      item.addEventListener("mouseleave", function() { item.style.cssText = itemStyle })
      item.addEventListener("click", function() { closeMenu(); action() })
    }
    return item
  }
  function makeDivider() {
    var d = document.createElement("div")
    d.style.cssText = dividerStyle
    return d
  }
  document.addEventListener("contextmenu", function(e) {
    e.preventDefault()
    e.stopPropagation()
    closeMenu()
    var sel = window.getSelection()
    var selText = sel ? sel.toString() : ""
    var hasSel = selText.length > 0
    var active = document.activeElement
    var editable = !!(active && (active.isContentEditable || active.tagName === "INPUT" || active.tagName === "TEXTAREA"))
    var isMac = (navigator.platform || "").toLowerCase().indexOf("mac") >= 0
    var mod = isMac ? "\\u2318" : "Ctrl+"
    menu = document.createElement("div")
    menu.style.cssText = menuStyle
    menu.appendChild(makeItem("Cut", mod + "X", function() {
      send("opencode-web.clipboard-write", {text: selText})
      if (editable && sel.rangeCount > 0) sel.getRangeAt(0).deleteContents()
    }, !hasSel || !editable))
    menu.appendChild(makeItem("Copy", mod + "C", function() {
      send("opencode-web.clipboard-write", {text: selText})
    }, !hasSel))
    menu.appendChild(makeItem("Paste", mod + "V", function() {
      pendingPaste = true
      send("opencode-web.clipboard-read", {})
    }, !editable))
    menu.appendChild(makeDivider())
    menu.appendChild(makeItem("Select All", mod + "A", function() {
      if (editable && active) {
        var range = document.createRange()
        range.selectNodeContents(active)
        var s2 = window.getSelection()
        s2.removeAllRanges()
        s2.addRange(range)
      } else {
        document.execCommand && document.execCommand("selectAll", false)
      }
    }))
    document.body.appendChild(menu)
    var rect = menu.getBoundingClientRect()
    var x = e.clientX
    var y = e.clientY
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 4
    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 4
    menu.style.left = x + "px"
    menu.style.top = y + "px"
    blog("contextmenu shown hasSel=" + hasSel + " editable=" + editable)
  }, true)
  document.addEventListener("click", function() { closeMenu() }, true)
  document.addEventListener("keydown", function(e) { if (e.key === "Escape") closeMenu() }, true)
})()
</script>`

function inject(html: string) {
  return html.replace("<head>", `<head>${BOOTSTRAP}`)
}

function sse(value: string | string[] | undefined) {
  return Array.isArray(value)
    ? value.some((item) => item.includes("text/event-stream"))
    : (value?.includes("text/event-stream") ?? false)
}

function proxy(incoming: IncomingMessage, res: ServerResponse, backend: URL, log: (msg: string) => void) {
  const want = sse(incoming.headers.accept)
  const out = req(
    {
      hostname: backend.hostname,
      port: backend.port,
      path: incoming.url,
      method: incoming.method,
      headers: { ...incoming.headers, host: `${backend.hostname}:${backend.port}` },
    },
    (upstream) => {
      const live = want || sse(upstream.headers["content-type"])
      res.writeHead(upstream.statusCode ?? 502, upstream.headers)
      if (!live) {
        upstream.pipe(res)
        return
      }

      log(`[SSE] proxy streaming ${incoming.url ?? "/"}`)
      res.flushHeaders()
      res.socket?.setNoDelay(true)
      res.socket?.setKeepAlive(true)
      res.socket?.setTimeout(0)
      upstream.on("data", (chunk) => res.write(chunk))
      upstream.on("end", () => res.end())
      upstream.on("error", () => res.end())
    },
  )
  out.on("error", () => {
    res.writeHead(502)
    res.end("backend unavailable")
  })
  incoming.pipe(out)
}

function cdnAsset(res: ServerResponse, path: string) {
  const out = httpsReq(
    `https://app.opencode.ai${path}`,
    { headers: { host: "app.opencode.ai", "accept-encoding": "identity" } },
    (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers)
      upstream.pipe(res)
    },
  )
  out.on("error", () => {
    res.writeHead(502)
    res.end("cdn unavailable")
  })
  out.end()
}

function cdnHtml(res: ServerResponse, path: string) {
  const out = httpsReq(
    `https://app.opencode.ai${path}`,
    { headers: { host: "app.opencode.ai", "accept-encoding": "identity" } },
    (upstream) => {
      let body = ""
      upstream.on("data", (c: Buffer) => (body += c.toString()))
      upstream.on("end", () => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" })
        res.end(inject(body))
      })
    },
  )
  out.on("error", () => {
    res.writeHead(502)
    res.end("cdn unavailable")
  })
  out.end()
}

function stablePort(backend: string): number {
  let h = 0
  for (let i = 0; i < backend.length; i++) h = ((h << 5) - h + backend.charCodeAt(i)) | 0
  return 49152 + (Math.abs(h) % 16384)
}

function shared() {
  return {
    close(done?: (err?: Error) => void) {
      done?.()
      return this as unknown as Server
    },
  } as unknown as Server
}

function reuse(port: number, backend: string) {
  return new Promise<boolean>((resolve) => {
    let live = true
    const done = (ok: boolean) => {
      if (!live) return
      live = false
      resolve(ok)
    }

    const out = req(
      {
        hostname: "127.0.0.1",
        port,
        path: HEALTH,
        method: "GET",
      },
      (res) => {
        let body = ""
        res.on("data", (chunk: Buffer) => (body += chunk.toString()))
        res.on("end", () => {
          if (res.statusCode !== 200) {
            done(false)
            return
          }

          void Promise.resolve(body)
            .then(
              (item) =>
                JSON.parse(item) as {
                  backend?: unknown
                  ok?: unknown
                },
            )
            .then((item) => done(item.ok === true && item.backend === new URL(backend).href))
            .catch(() => done(false))
        })
      },
    )

    out.on("error", () => done(false))
    out.setTimeout(1000, () => {
      out.destroy()
      done(false)
    })
    out.end()
  })
}

export function start(opts: {
  dist: string
  backend: string
  log?: (msg: string) => void
}): Promise<{ server: Server; port: number }> {
  const backend = new URL(opts.backend)
  const index = join(opts.dist, "index.html")
  const has = existsSync(index)
  const preferred = stablePort(opts.backend)
  const log = opts.log ?? (() => {})

  return reuse(preferred, backend.href).then((ok) => {
    if (ok) {
      log(`[SPA] reusing compatible proxy on port ${preferred}`)
      return { server: shared(), port: preferred }
    }

    const server = createServer((incoming, res) => {
      const url = new URL(incoming.url ?? "/", "http://localhost")

      if (url.pathname === HEALTH) {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ backend: backend.href, ok: true }))
        return
      }

      if (API.some((p) => url.pathname.startsWith(p))) {
        proxy(incoming, res, backend, log)
        return
      }

      if (!has) {
        const ext = extname(url.pathname)
        if (ext && ext !== ".html") {
          cdnAsset(res, url.pathname)
          return
        }
        cdnHtml(res, url.pathname || "/")
        return
      }

      const file = url.pathname === "/" ? "/index.html" : url.pathname
      const local = join(opts.dist, file)

      if (existsSync(local)) {
        const ext = extname(local)
        if (ext === ".html") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" })
          res.end(inject(readFileSync(local, "utf-8")))
          return
        }
        res.writeHead(200, {
          "Content-Type": MIME[ext] ?? "application/octet-stream",
          "Access-Control-Allow-Origin": "*",
        })
        res.end(readFileSync(local))
        return
      }

      const ext = extname(file)
      if (ext && ext !== ".html") {
        cdnAsset(res, file)
        return
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" })
      res.end(inject(readFileSync(index, "utf-8")))
    })

    return new Promise((resolve, reject) => {
      server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "EADDRINUSE") {
          reject(err)
          return
        }

        void reuse(preferred, backend.href)
          .then((ok) => {
            if (ok) {
              log(`[SPA] reusing compatible proxy on port ${preferred}`)
              resolve({ server: shared(), port: preferred })
              return
            }

            log(`[SPA] port ${preferred} in use, falling back to random`)
            server.listen(0, "127.0.0.1")
          })
          .catch(reject)
      })
      server.listen(preferred, "127.0.0.1", () => {
        const addr = server.address()
        const port = typeof addr === "object" && addr ? addr.port : 0
        log(`[SPA] preferred=${preferred} actual=${port} stable=${port === preferred}`)
        resolve({ server, port })
      })
    })
  })
}
