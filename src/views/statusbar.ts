import * as vscode from "vscode"
import type { ProcessManager } from "../process/manager.js"

export function createStatusBar(manager: ProcessManager): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)

  const update = (status: string) => {
    const connected = status === "running"
    const url = connected ? manager.getUrl() : null
    item.text = connected ? "$(plug) Connected" : "$(debug-disconnect) Disconnected"
    item.tooltip = connected
      ? url
        ? `OpenCode is connected\n${url}`
        : "OpenCode is connected"
      : "OpenCode is disconnected"
    item.command = connected ? "opencode-web.openChat" : "opencode-web.restart"
  }

  update(manager.getStatus())
  item.show()

  const sub = manager.onStatusChange((status) => {
    update(status)
  })

  const dispose = item.dispose
  item.dispose = () => {
    sub.dispose()
    dispose()
  }

  return item
}
