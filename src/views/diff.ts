import * as vscode from "vscode"

export const scheme = "opencode-diff"

type Row = {
  file: string
  before?: string
  after?: string
}

type Client = {
  session?: {
    diff?: (input: { sessionID: string }) => Promise<unknown>
  }
}

type Ready = {
  session: {
    diff: (input: { sessionID: string }) => Promise<unknown>
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function row(value: unknown): value is Row {
  if (!record(value)) return false
  if (typeof value.file !== "string") return false
  if (value.before !== undefined && typeof value.before !== "string") return false
  if (value.after !== undefined && typeof value.after !== "string") return false
  return true
}

function ready(value: unknown): value is Ready {
  if (!record(value)) return false
  if (!record(value.session)) return false
  return typeof value.session.diff === "function"
}

function body(value: unknown) {
  if (!record(value)) return
  return value.data
}

function item(list: unknown, file: string) {
  if (!Array.isArray(list)) return undefined
  return list.find((x): x is Row => row(x) && x.file === file)
}

function text(row: Row | undefined, side: string, value: string) {
  if (side === "before") {
    if (typeof row?.before === "string") return row.before
    return value
  }

  if (side === "after") {
    if (typeof row?.after === "string") return row.after
    return value
  }

  return value
}

function doc(session: string, file: string, side: string, value: string) {
  return vscode.Uri.from({
    scheme,
    path: file.startsWith("/") ? file : `/${file}`,
    query: new URLSearchParams({
      session,
      path: file,
      side,
      value,
    }).toString(),
  })
}

export class DiffProvider implements vscode.TextDocumentContentProvider {
  constructor(private getClient: () => Client | null) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const query = new URLSearchParams(uri.query)
    const session = query.get("session") ?? ""
    const file = query.get("path") ?? ""
    const side = query.get("side") ?? "after"
    const value = query.get("value") ?? ""

    if (!session || !file) return value

    const client = this.getClient()
    if (!ready(client)) return value

    const data = await client.session
      .diff({ sessionID: session })
      .then(body)
      .catch(() => undefined)
    return text(item(data, file), side, value)
  }
}

export async function showDiff(session: string, file: string, original: string, modified: string): Promise<void> {
  const left = doc(session, file, "before", original)
  const right = doc(session, file, "after", modified)
  await vscode.commands.executeCommand("vscode.diff", left, right, `OpenCode: ${file}`)
}
