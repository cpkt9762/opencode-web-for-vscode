import * as vscode from "vscode"

type Row = {
  id: string
  title: string
  time: {
    created: number
    updated: number
  }
}

type Client = {
  session?: {
    list?: () => Promise<unknown>
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function row(value: unknown): value is Row {
  if (!record(value)) return false
  if (typeof value.id !== "string") return false
  if (typeof value.title !== "string") return false
  if (!record(value.time)) return false
  if (typeof value.time.created !== "number") return false
  if (typeof value.time.updated !== "number") return false
  return true
}

function data(value: unknown): Row[] {
  if (!record(value) || !Array.isArray(value.data)) return []
  return value.data.filter(row)
}

export class SessionItem extends vscode.TreeItem {
  constructor(
    public id: string,
    public title: string,
    public created: number,
    public updated: number,
  ) {
    super(title, vscode.TreeItemCollapsibleState.None)
    this.description = formatTime(updated)
    this.contextValue = "session"
    this.command = {
      command: "opencode-web.selectSession",
      title: "Select Session",
      arguments: [id],
    }
  }
}

export class SessionsProvider implements vscode.TreeDataProvider<SessionItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionItem | undefined | null>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event
  private log: (msg: string) => void = () => {}

  constructor(private getClient: () => Client | null) {}

  setLog(fn: (msg: string) => void) {
    this.log = fn
  }

  async getChildren(): Promise<SessionItem[]> {
    const session = this.getClient()?.session
    if (!session?.list) {
      this.log("[sessions] no client or session.list")
      return []
    }

    try {
      const raw = await session.list()
      const rows = data(raw)
      this.log(`[sessions] raw keys=${record(raw) ? Object.keys(raw).join(",") : typeof raw} rows=${rows.length}`)
      return rows.map((item) => new SessionItem(item.id, item.title, item.time.created, item.time.updated))
    } catch (err) {
      this.log(`[sessions] error: ${err instanceof Error ? err.stack : err}`)
      return []
    }
  }

  getTreeItem(item: SessionItem): vscode.TreeItem {
    return item
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined)
  }
}

function formatTime(ts: number): string {
  const now = Date.now()
  const diff = now - ts
  const sec = Math.floor(diff / 1000)
  const min = Math.floor(sec / 60)
  const hr = Math.floor(min / 60)
  const day = Math.floor(hr / 24)

  if (day > 0) return `${day}d ago`
  if (hr > 0) return `${hr}h ago`
  if (min > 0) return `${min}m ago`
  return "now"
}
