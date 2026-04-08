import { beforeEach, describe, expect, it, vi } from "vitest"

async function load() {
  vi.doMock("vscode", () => {
    class Uri {
      scheme: string
      path: string
      query: string

      constructor(parts: { scheme: string; path: string; query?: string }) {
        this.scheme = parts.scheme
        this.path = parts.path
        this.query = parts.query ?? ""
      }

      static from(parts: { scheme: string; path: string; query?: string }) {
        return new Uri(parts)
      }

      static parse(value: string) {
        const [scheme = "", rest = ""] = value.split(":")
        const [path = "", query = ""] = rest.split("?")
        return new Uri({ scheme, path, query })
      }
    }

    return {
      Uri,
      commands: {
        executeCommand: async () => undefined,
      },
    }
  })

  const vscode = await import("vscode")
  const mod = await import("./diff.js")
  return { vscode, ...mod }
}

describe("diff", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it("provideTextDocumentContent returns content", async () => {
    const { vscode, DiffProvider, scheme } = await load()
    const diff = vi.fn().mockResolvedValue({
      data: [
        {
          file: "src/app.ts",
          before: "old",
          after: "new",
        },
      ],
    })

    const provider = new DiffProvider(() => ({
      session: {
        diff,
      },
    }))

    const uri = vscode.Uri.parse(
      `${scheme}:/src/app.ts?session=s-1&path=${encodeURIComponent("src/app.ts")}&side=after`,
    )

    const text = await provider.provideTextDocumentContent(uri)

    expect(diff).toHaveBeenCalledWith({ sessionID: "s-1" })
    expect(text).toBe("new")
  })

  it("showDiff opens diff editor", async () => {
    const { vscode, showDiff, scheme } = await load()
    const spy = vi.spyOn(vscode.commands, "executeCommand")

    await showDiff("s-1", "src/app.ts", "old", "new")

    expect(spy).toHaveBeenCalledTimes(1)
    const [cmd, left, right, title] = spy.mock.calls[0]

    expect(cmd).toBe("vscode.diff")
    expect(left.scheme).toBe(scheme)
    expect(right.scheme).toBe(scheme)
    expect(left.query).toContain("session=s-1")
    expect(left.query).toContain(`path=${encodeURIComponent("src/app.ts")}`)
    expect(left.query).toContain("side=before")
    expect(left.query).toContain("value=old")
    expect(right.query).toContain("side=after")
    expect(right.query).toContain("value=new")
    expect(title).toBe("OpenCode: src/app.ts")
  })

  it("handles missing data gracefully", async () => {
    const { vscode, DiffProvider, scheme } = await load()
    const provider = new DiffProvider(() => null)
    const uri = vscode.Uri.parse(
      `${scheme}:/src/app.ts?path=${encodeURIComponent("src/app.ts")}&value=${encodeURIComponent("old")}`,
    )

    const text = await provider.provideTextDocumentContent(uri)

    expect(text).toBe("old")
  })
})
