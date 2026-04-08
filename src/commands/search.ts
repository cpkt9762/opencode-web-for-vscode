import * as vscode from "vscode"

type Match = {
  path: {
    text: string
  }
  lines: {
    text: string
  }
  line_number: number
}

type Client = {
  client?: {
    find?: {
      files?: (opts: { query: string }) => Promise<unknown>
      text?: (opts: { pattern: string }) => Promise<unknown>
    }
  }
}

type Item = vscode.QuickPickItem & {
  path: string
  line: number
}

export type GetClient = () => Client | null

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function match(value: unknown): value is Match {
  if (!record(value)) return false
  if (!record(value.path) || typeof value.path.text !== "string") return false
  if (!record(value.lines) || typeof value.lines.text !== "string") return false
  return typeof value.line_number === "number"
}

function files(value: unknown): string[] {
  if (!record(value) || !Array.isArray(value.data)) return []
  return value.data.filter((item): item is string => typeof item === "string")
}

function rows(value: unknown): Match[] {
  if (!record(value) || !Array.isArray(value.data)) return []
  return value.data.filter(match)
}

async function open(path: string, line?: number) {
  const doc = await vscode.workspace.openTextDocument(path)
  if (line === undefined) {
    await vscode.window.showTextDocument(doc)
    return
  }

  const row = line > 0 ? line - 1 : 0
  await vscode.window.showTextDocument(doc, {
    selection: new vscode.Range(row, 0, row, 0),
  })
}

export function searchFiles(getClient: GetClient) {
  return async () => {
    const query = await vscode.window.showInputBox({
      prompt: "Search files",
    })
    if (!query) return

    const find = getClient()?.client?.find?.files
    if (!find) return

    const pick = await vscode.window.showQuickPick(files(await find({ query })), {
      placeHolder: "Select file",
    })
    if (!pick) return

    await open(pick)
  }
}

export function searchText(getClient: GetClient) {
  return async () => {
    const pattern = await vscode.window.showInputBox({
      prompt: "Search text",
    })
    if (!pattern) return

    const find = getClient()?.client?.find?.text
    if (!find) return

    const items = rows(await find({ pattern })).map((item) => ({
      label: `${item.path.text}:${item.line_number}`,
      description: item.lines.text,
      path: item.path.text,
      line: item.line_number,
    })) satisfies Item[]
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: "Select match",
    })
    if (!pick) return

    await open(pick.path, pick.line)
  }
}

export function searchSymbols(getClient: GetClient) {
  void getClient

  return async () => {
    const query = await vscode.window.showInputBox({
      prompt: "Search symbols",
    })
    if (!query) return

    const res = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      query,
    )
    const items = (res ?? []).map((item) => ({
      label: item.name,
      description: item.location.uri.fsPath,
      path: item.location.uri.fsPath,
      line: item.location.range.start.line + 1,
    })) satisfies Item[]
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: "Select symbol",
    })
    if (!pick) return

    await open(pick.path, pick.line)
  }
}
