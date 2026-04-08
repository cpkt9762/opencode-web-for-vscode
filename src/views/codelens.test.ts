import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TextDocument } from "vscode"

vi.mock("vscode", () => {
  class EventEmitter<T> {
    event = vi.fn()
    fire = vi.fn((value?: T) => value)
  }

  class CodeLens {
    constructor(
      public range: unknown,
      public command?: unknown,
    ) {}
  }

  return {
    EventEmitter,
    CodeLens,
    SymbolKind: {
      Class: 4,
      Method: 5,
      Function: 12,
    },
    commands: {
      executeCommand: vi.fn(),
    },
  }
})

import * as vscode from "vscode"
import { OpenCodeLensProvider } from "./codelens.js"

type Symbol = {
  kind: number
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  selectionRange: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  children: Symbol[]
}

function range(line: number) {
  return {
    start: { line, character: 0 },
    end: { line, character: 1 },
  }
}

function symbol(kind: number, line: number, children: Symbol[] = []): Symbol {
  return {
    kind,
    range: range(line),
    selectionRange: range(line),
    children,
  }
}

function doc(): TextDocument {
  return {
    uri: { path: "/tmp/test.ts" },
  } as unknown as TextDocument
}

describe("OpenCodeLensProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("provides CodeLenses for functions, classes, and methods", async () => {
    const run = vi.mocked(vscode.commands.executeCommand)
    const text = doc()
    run.mockResolvedValue([
      symbol(vscode.SymbolKind.Function, 1),
      symbol(vscode.SymbolKind.Class, 5, [symbol(vscode.SymbolKind.Method, 6)]),
    ])

    const provider = new OpenCodeLensProvider()
    const items = await provider.provideCodeLenses(text)

    expect(run).toHaveBeenCalledWith("vscode.executeDocumentSymbolProvider", text.uri)
    expect(items).toHaveLength(3)
    expect(items.map((item) => item.range.start.line)).toEqual([1, 5, 6])
  })

  it("creates Ask OpenCode command lenses", async () => {
    const run = vi.mocked(vscode.commands.executeCommand)
    const text = doc()
    const body = symbol(vscode.SymbolKind.Function, 2)
    run.mockResolvedValue([body])

    const provider = new OpenCodeLensProvider()
    const [item] = await provider.provideCodeLenses(text)

    expect(item.command).toEqual({
      command: "opencode-web.sendCode",
      title: "$(comment-discussion) Ask OpenCode",
      arguments: [text.uri, body.range],
    })
  })

  it("handles empty document", async () => {
    const run = vi.mocked(vscode.commands.executeCommand)
    run.mockResolvedValue(undefined)

    const provider = new OpenCodeLensProvider()
    const items = await provider.provideCodeLenses(doc())

    expect(items).toEqual([])
  })
})
