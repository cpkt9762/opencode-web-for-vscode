import { describe, expect, it, vi } from "vitest"

vi.mock("vscode", () => ({
  TreeItem: class {
    description?: string
    tooltip?: string
    iconPath?: unknown
    contextValue?: string

    constructor(
      public label: string,
      public collapsibleState: number,
    ) {}
  },
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
  },
  EventEmitter: class {
    event = vi.fn()
    fire = vi.fn()
  },
  ThemeIcon: class {
    constructor(public id: string) {}
  },
}))

import { ProviderItem, ProvidersProvider } from "./providers.js"

describe("ProvidersProvider", () => {
  it("returns empty array when no client", async () => {
    const provider = new ProvidersProvider(() => null)
    const items = await provider.getChildren()

    expect(items).toEqual([])
  })

  it("returns provider items when client available", async () => {
    const client = {
      config: {
        get: vi.fn().mockResolvedValue({
          data: {
            enabled_providers: ["openai"],
            mcp: {
              jira: { enabled: true },
              docs: { enabled: false },
            },
          },
        }),
        providers: vi.fn().mockResolvedValue({
          data: {
            default: {
              openai: "gpt-5.4",
              anthropic: "claude-sonnet-4-6",
            },
            providers: [
              {
                id: "openai",
                name: "OpenAI",
                models: {
                  "gpt-5.4": {
                    id: "gpt-5.4",
                    name: "GPT-5.4",
                  },
                },
              },
              {
                id: "anthropic",
                name: "Anthropic",
                models: {
                  "claude-sonnet-4-6": {
                    id: "claude-sonnet-4-6",
                    name: "Claude Sonnet 4.6",
                  },
                },
              },
            ],
          },
        }),
      },
      provider: {
        list: vi.fn().mockResolvedValue({
          data: {
            connected: ["openai"],
            all: [
              {
                id: "openai",
                name: "OpenAI",
                models: {
                  "gpt-5.4": {
                    id: "gpt-5.4",
                    name: "GPT-5.4",
                  },
                },
              },
              {
                id: "anthropic",
                name: "Anthropic",
                models: {
                  "claude-sonnet-4-6": {
                    id: "claude-sonnet-4-6",
                    name: "Claude Sonnet 4.6",
                  },
                },
              },
            ],
          },
        }),
      },
    }

    const provider = new ProvidersProvider(() => client)
    const groups = await provider.getChildren()
    const items = await provider.getChildren(groups[0])
    const mcp = await provider.getChildren(groups[1])

    expect(groups).toHaveLength(2)
    expect(groups[0].label).toBe("Providers")
    expect(groups[1].label).toBe("MCP")
    expect(items).toHaveLength(2)
    expect(items[0].label).toBe("OpenAI")
    expect(items[0].description).toBe("Enabled • GPT-5.4")
    expect(items[0].tooltip).toBe("✅ OpenAI")
    expect(items[1].label).toBe("Anthropic")
    expect(items[1].description).toBe("Disabled • Claude Sonnet 4.6")
    expect(items[1].tooltip).toBe("❌ Anthropic")
    expect(mcp).toHaveLength(2)
    expect(mcp[0].label).toBe("jira")
    expect(mcp[0].description).toBe("Enabled")
    expect(mcp[1].label).toBe("docs")
    expect(mcp[1].description).toBe("Disabled")
    expect(provider.getTreeItem(items[0])).toBe(items[0])
  })

  it("shows MCP placeholder without config access", async () => {
    const client = {
      provider: {
        list: vi.fn().mockResolvedValue({
          data: {
            connected: [],
            all: [],
          },
        }),
      },
    }

    const provider = new ProvidersProvider(() => client)
    const groups = await provider.getChildren()
    const items = await provider.getChildren(groups[1])

    expect(items).toHaveLength(1)
    expect(items[0].label).toBe("MCP status requires server connection")
  })

  it("fires change event on refresh", () => {
    const provider = new ProvidersProvider(() => null)
    const spy = vi.spyOn(Reflect.get(provider, "_onDidChangeTreeData"), "fire")

    provider.refresh()

    expect(spy).toHaveBeenCalled()
  })

  it("creates provider item with status icon", () => {
    const item = new ProviderItem("OpenAI", "GPT-5.4", true)

    expect(item.label).toBe("OpenAI")
    expect(item.description).toBe("Enabled • GPT-5.4")
    expect(item.tooltip).toBe("✅ OpenAI")
  })

  it("works with SDK-style client that uses this binding", async () => {
    class ProviderService {
      _client = {
        get: () =>
          Promise.resolve({
            data: {
              connected: ["openai"],
              all: [{ id: "openai", name: "OpenAI", models: {} }],
            },
          }),
      }
      list() {
        return this._client.get()
      }
    }

    class ConfigService {
      _client = {
        get: () =>
          Promise.resolve({
            data: { enabled_providers: ["openai"], mcp: {} },
          }),
      }
      get() {
        return this._client.get()
      }
      providers() {
        return Promise.resolve({
          data: {
            default: { openai: "gpt-5.4" },
            providers: [
              {
                id: "openai",
                name: "OpenAI",
                models: { "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4" } },
              },
            ],
          },
        })
      }
    }

    const client = {
      provider: new ProviderService(),
      config: new ConfigService(),
    }

    const provider = new ProvidersProvider(() => client)
    const groups = await provider.getChildren()
    const items = await provider.getChildren(groups[0])

    expect(items.length).toBeGreaterThan(0)
    expect(items[0].label).toBe("OpenAI")
  })
})
