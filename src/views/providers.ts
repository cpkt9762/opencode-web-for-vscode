import * as vscode from "vscode"

type Model = {
  id?: string
  name?: string
}

type Provider = {
  id: string
  name?: string
  models?: Record<string, Model>
}

type Mcp = {
  id: string
  ok: boolean
}

type Group = "providers" | "mcp"

type Client = {
  config?: {
    get?: () => Promise<unknown>
    providers?: () => Promise<unknown>
  }
  provider?: {
    list?: () => Promise<unknown>
  }
}

type Node = GroupItem | ProviderItem | StatusItem

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function entry(value: unknown): Model | null {
  if (!record(value)) return null

  const id = value.id === undefined ? undefined : typeof value.id === "string" ? value.id : null
  if (id === null) return null

  const name = value.name === undefined ? undefined : typeof value.name === "string" ? value.name : null
  if (name === null) return null

  return { id, name }
}

function pack(value: unknown): Record<string, Model> | undefined {
  if (!record(value)) return

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const row = entry(item)
      if (!row) return []
      return [[key, row] as const]
    }),
  )
}

function provider(value: unknown): Provider | null {
  if (!record(value) || typeof value.id !== "string") return null

  const name = value.name === undefined ? undefined : typeof value.name === "string" ? value.name : null
  if (name === null) return null

  const models = value.models === undefined ? undefined : pack(value.models)
  if (value.models !== undefined && !models) return null

  return {
    id: value.id,
    name,
    models,
  }
}

function body(value: unknown) {
  const data = pick(value)
  if (!data) {
    return { all: [], connected: [] }
  }

  return {
    all: Array.isArray(data.all)
      ? data.all.flatMap((item) => {
          const row = provider(item)
          if (!row) return []
          return [row]
        })
      : [],
    connected: Array.isArray(data.connected)
      ? data.connected.filter((item): item is string => typeof item === "string")
      : [],
  }
}

function pick(value: unknown) {
  if (!record(value)) return null
  if (record(value.data)) return value.data
  return value
}

function config(value: unknown) {
  const data = pick(value)
  if (!data) {
    return {
      disabled: new Set<string>(),
      enabled: undefined as Set<string> | undefined,
      mcp: undefined as Mcp[] | undefined,
    }
  }

  return {
    disabled: new Set(
      Array.isArray(data.disabled_providers)
        ? data.disabled_providers.filter((item): item is string => typeof item === "string")
        : [],
    ),
    enabled: Array.isArray(data.enabled_providers)
      ? new Set(data.enabled_providers.filter((item): item is string => typeof item === "string"))
      : undefined,
    mcp: record(data.mcp)
      ? Object.entries(data.mcp).map(([id, item]) => ({
          id,
          ok: !record(item) || item.enabled !== false,
        }))
      : undefined,
  }
}

function configured(value: unknown) {
  const data = pick(value)
  if (!data) {
    return {
      all: [] as Provider[],
      default: {} as Record<string, string>,
    }
  }

  return {
    all: Array.isArray(data.providers)
      ? data.providers.flatMap((item) => {
          const row = provider(item)
          if (!row) return []
          return [row]
        })
      : [],
    default: record(data.default)
      ? Object.fromEntries(
          Object.entries(data.default).flatMap(([key, item]) => {
            if (typeof item !== "string") return []
            return [[key, item] as const]
          }),
        )
      : {},
  }
}

function enabled(id: string, value: { disabled: Set<string>; enabled?: Set<string> }) {
  if (value.enabled) return value.enabled.has(id) && !value.disabled.has(id)
  return !value.disabled.has(id)
}

function label(value: Provider, defaultModel?: string) {
  if (defaultModel) {
    const item = value.models?.[defaultModel]
    if (item) return item.name ?? item.id ?? defaultModel
    return defaultModel
  }
  return model(value)
}

export class GroupItem extends vscode.TreeItem {
  constructor(
    public id: Group,
    name: string,
  ) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed)
    this.contextValue = `group.${id}`
  }
}

export class ProviderItem extends vscode.TreeItem {
  constructor(
    public name: string,
    public model: string,
    public ok: boolean,
  ) {
    super(name, vscode.TreeItemCollapsibleState.None)
    this.description = `${ok ? "Enabled" : "Disabled"} • ${model}`
    this.iconPath = new vscode.ThemeIcon(ok ? "check" : "close")
    this.tooltip = `${ok ? "✅" : "❌"} ${name}`
    this.contextValue = ok ? "provider.enabled" : "provider.disabled"
  }
}

export class StatusItem extends vscode.TreeItem {
  constructor(
    public name: string,
    public ok: boolean,
    detail?: string,
  ) {
    super(name, vscode.TreeItemCollapsibleState.None)
    this.description = detail ?? (ok ? "Enabled" : "Disabled")
    this.iconPath = new vscode.ThemeIcon(ok ? "check" : "close")
    this.tooltip = `${ok ? "✅" : "❌"} ${name}`
    this.contextValue = ok ? "status.enabled" : "status.disabled"
  }
}

export class ProvidersProvider implements vscode.TreeDataProvider<Node> {
  private _onDidChangeTreeData = new vscode.EventEmitter<Node | null | undefined>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  constructor(private getClient: () => Client | null | undefined) {}

  async getChildren(item?: Node): Promise<Node[]> {
    if (!this.getClient()) return []
    if (!item) return [new GroupItem("providers", "Providers"), new GroupItem("mcp", "MCP")]
    if (item instanceof GroupItem && item.id === "providers") return this.providers()
    if (item instanceof GroupItem && item.id === "mcp") return this.mcp()
    return []
  }

  getTreeItem(item: Node): vscode.TreeItem {
    return item
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined)
  }

  private async providers() {
    const client = this.getClient()
    if (!client) return []

    const [cfg, list, raw] = await Promise.all([
      Promise.resolve(client.config?.providers?.()).catch(() => null),
      Promise.resolve(client.provider?.list?.()).catch(() => null),
      Promise.resolve(client.config?.get?.()).catch(() => null),
    ])

    const data = configured(cfg)
    const all = data.all.length > 0 ? data.all : body(list).all
    const state = config(raw)
    const live = new Set(body(list).connected)
    return all.map(
      (item) =>
        new ProviderItem(
          item.name ?? item.id,
          label(item, data.default[item.id]),
          raw ? enabled(item.id, state) : live.has(item.id),
        ),
    )
  }

  private async mcp() {
    const raw = await Promise.resolve(this.getClient()?.config?.get?.()).catch(() => null)
    if (!raw) return [new StatusItem("MCP status requires server connection", false)]

    const list = config(raw).mcp
    if (!list || list.length === 0) return [new StatusItem("No MCP servers configured", false, "Unavailable")]
    return list.map((item) => new StatusItem(item.id, item.ok))
  }
}

function model(item: Provider): string {
  const all = Object.values(item.models ?? {})
  const first = all[0]
  if (!first) return "No models"
  if (all.length === 1) return first.name ?? first.id ?? "Unknown model"
  return `${first.name ?? first.id ?? "Unknown model"} +${all.length - 1}`
}
