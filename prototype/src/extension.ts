import * as vscode from "vscode"

import { Provider, url, view } from "./provider"

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      view,
      new Provider(() => url(vscode.workspace.getConfiguration("cspPrototype").get<string>("serverUrl"))),
    ),
  )
}

export function deactivate() {}
