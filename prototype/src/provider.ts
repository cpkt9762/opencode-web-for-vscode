import type * as vscode from "vscode"

export const view = "cspPrototype.view"

export function nonce() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(36)).join("")
}

export function html(input: { csp: string; nonce: string; url: string }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://localhost:*; script-src 'nonce-${input.nonce}'; style-src ${input.csp} 'unsafe-inline';">
  <title>Iframe CSP Prototype</title>
</head>
<body style="margin:0;padding:0;overflow:hidden;">
  <iframe id="opencode-frame" src="${input.url}" style="width:100%;height:100vh;border:none;"></iframe>
  <script nonce="${input.nonce}">
    const vscode = acquireVsCodeApi()
    const frame = document.getElementById("opencode-frame")

    window.addEventListener("message", (event) => {
      if (event.data?.type !== "cspPrototype.ping") return
      vscode.postMessage({ type: "cspPrototype.pong" })
    })

    frame?.addEventListener("load", () => {
      vscode.postMessage({ type: "cspPrototype.frame-ready", url: frame.src })
    })
  </script>
</body>
</html>`
}

export function url(raw?: string) {
  if (raw?.startsWith("http://localhost:") || raw?.startsWith("http://127.0.0.1:")) return raw
  return "http://localhost:57777"
}

export class Provider implements vscode.WebviewViewProvider {
  constructor(private get = () => url()) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    }
    webviewView.webview.html = html({
      csp: webviewView.webview.cspSource,
      nonce: nonce(),
      url: this.get(),
    })
  }
}
