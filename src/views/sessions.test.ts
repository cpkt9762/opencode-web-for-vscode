import { describe, it, expect, vi } from "vitest"

vi.mock("vscode", () => ({
  TreeItem: class {
    constructor(
      public label: string,
      public collapsibleState: number,
    ) {}
  },
  TreeItemCollapsibleState: {
    None: 0,
  },
  EventEmitter: class {
    event = vi.fn()
    fire = vi.fn()
  },
}))

import { SessionsProvider, SessionItem } from "./sessions.js"

describe("SessionsProvider", () => {
  it("returns empty array when no client", async () => {
    const provider = new SessionsProvider(() => null)
    const items = await provider.getChildren()
    expect(items).toEqual([])
  })

  it("returns SessionItems when client available", async () => {
    const client = {
      session: {
        list: vi.fn().mockResolvedValue({
          data: [
            {
              id: "sess-1",
              title: "Session 1",
              time: { created: 1000, updated: 2000 },
            },
            {
              id: "sess-2",
              title: "Session 2",
              time: { created: 1500, updated: 2500 },
            },
          ],
        }),
      },
    }

    const provider = new SessionsProvider(() => client)
    const items = await provider.getChildren()

    expect(items).toHaveLength(2)
    expect(items[0].id).toBe("sess-1")
    expect(items[0].title).toBe("Session 1")
    expect(items[1].id).toBe("sess-2")
    expect(items[1].title).toBe("Session 2")
  })

  it("returns empty array on error", async () => {
    const client = {
      session: {
        list: vi.fn().mockRejectedValue(new Error("API error")),
      },
    }

    const provider = new SessionsProvider(() => client)
    const items = await provider.getChildren()

    expect(items).toEqual([])
  })

  it("fires change event on refresh", () => {
    const provider = new SessionsProvider(() => null)
    const spy = vi.spyOn(provider["_onDidChangeTreeData"], "fire")

    provider.refresh()

    expect(spy).toHaveBeenCalled()
  })

  it("returns SessionItem from getTreeItem", () => {
    const item = new SessionItem("id-1", "Test", 1000, 2000)
    const provider = new SessionsProvider(() => null)

    const result = provider.getTreeItem(item)

    expect(result).toBe(item)
  })

  it("works with SDK-style client that uses this binding", async () => {
    class SessionService {
      _client = {
        get: () =>
          Promise.resolve({
            data: [
              {
                id: "sess-sdk-1",
                title: "SDK Session",
                time: { created: 1000, updated: 2000 },
              },
            ],
          }),
      }
      list() {
        return this._client.get()
      }
    }

    const client = { session: new SessionService() }
    const provider = new SessionsProvider(() => client)
    const items = await provider.getChildren()

    expect(items).toHaveLength(1)
    expect(items[0].id).toBe("sess-sdk-1")
    expect(items[0].title).toBe("SDK Session")
  })

  it("SessionItem click triggers selectSession with correct id", () => {
    const item = new SessionItem("ses_abc123", "My Session", 1000, 2000)

    expect(item.command).toEqual({
      command: "opencode-web.selectSession",
      title: "Select Session",
      arguments: ["ses_abc123"],
    })
    expect(item.contextValue).toBe("session")
  })

  it("handles missing session data fields gracefully", async () => {
    const client = {
      session: {
        list: vi.fn().mockResolvedValue({
          data: [
            { id: "s1", time: { created: 1, updated: 2 } },
            { id: "s2", title: "Good", time: { created: 1, updated: 2 } },
            { title: "No ID", time: { created: 1, updated: 2 } },
          ],
        }),
      },
    }

    const provider = new SessionsProvider(() => client)
    const items = await provider.getChildren()

    expect(items).toHaveLength(1)
    expect(items[0].id).toBe("s2")
  })
})
