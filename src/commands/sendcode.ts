import * as vscode from "vscode"

type Client = {
  client?: {
    tui?: {
      appendPrompt?: (opts: { text?: string }) => Promise<unknown>
    }
  }
}

export type GetClient = () => Client | null

type Data = {
  end: number
  lang: string
  path: string
  start: number
  text: string
}

function pack(document: vscode.TextDocument, range?: vscode.Range): Data {
  return {
    end: range ? range.end.line + 1 : document.lineCount,
    lang: document.languageId || "text",
    path: vscode.workspace.asRelativePath(document.uri, false),
    start: range ? range.start.line + 1 : 1,
    text: range ? document.getText(range) : document.getText(),
  }
}

async function load(uri?: vscode.Uri, range?: vscode.Range) {
  if (uri && range) return pack(await vscode.workspace.openTextDocument(uri), range)

  const editor = vscode.window.activeTextEditor
  if (!editor) return
  return pack(editor.document, editor.selection.isEmpty ? undefined : editor.selection)
}

export function sendCode(getClient: GetClient) {
  return async (uri?: vscode.Uri, range?: vscode.Range) => {
    const data = await load(uri, range)
    if (!data) {
      await vscode.window.showWarningMessage("OpenCode: No active editor")
      return
    }

    const cfg = getClient()
    if (!cfg?.client?.tui?.appendPrompt) {
      await vscode.window.showWarningMessage("OpenCode: Client not available")
      return
    }

    try {
      await cfg.client.tui.appendPrompt({
        text: `@${data.path}#L${data.start}-L${data.end}\n\`\`\`${data.lang}\n${data.text}\n\`\`\``,
      })
      await vscode.window.showInformationMessage("OpenCode: Code sent to chat")
    } catch {
      await vscode.window.showWarningMessage("OpenCode: Failed to send code")
    }
  }
}
