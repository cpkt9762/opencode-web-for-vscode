import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("vscode", () => {
  const executeCommand = vi.fn()
  const showInputBox = vi.fn()
  const showQuickPick = vi.fn()
  const showTextDocument = vi.fn()
  const openTextDocument = vi.fn()

  class Position {
    line: number
    character: number

    constructor(line: number, character: number) {
      this.line = line
      this.character = character
    }
  }

  class Range {
    start: Position
    end: Position

    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
      this.start = new Position(startLine, startCharacter)
      this.end = new Position(endLine, endCharacter)
    }
  }

  return {
    window: {
      showInputBox,
      showQuickPick,
      showTextDocument,
    },
    commands: {
      executeCommand,
    },
    workspace: {
      openTextDocument,
    },
    Position,
    Range,
    __mocks: {
      executeCommand,
      showInputBox,
      showQuickPick,
      showTextDocument,
      openTextDocument,
    },
  }
})

import * as vscode from "vscode"

const mocks = (
  vscode as unknown as {
    __mocks: {
      executeCommand: ReturnType<typeof vi.fn>
      showInputBox: ReturnType<typeof vi.fn>
      showQuickPick: ReturnType<typeof vi.fn>
      showTextDocument: ReturnType<typeof vi.fn>
      openTextDocument: ReturnType<typeof vi.fn>
    }
  }
).__mocks

function doc(path: string) {
  return { uri: path }
}

describe("search", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("searchFiles calls find.files and opens selection", async () => {
    const path = "/tmp/src/sendcode.ts"
    const file = doc(path)
    const files = vi.fn().mockResolvedValue({ data: [path, "/tmp/src/registry.ts"] })

    mocks.showInputBox.mockResolvedValue("send")
    mocks.showQuickPick.mockResolvedValue(path)
    mocks.openTextDocument.mockResolvedValue(file)

    const { searchFiles } = await import("./search.js")
    await searchFiles(() => ({ client: { find: { files } } }))()

    expect(mocks.showInputBox).toHaveBeenCalledWith({
      prompt: "Search files",
    })
    expect(files).toHaveBeenCalledWith({ query: "send" })
    expect(mocks.showQuickPick).toHaveBeenCalledWith([path, "/tmp/src/registry.ts"], {
      placeHolder: "Select file",
    })
    expect(mocks.openTextDocument).toHaveBeenCalledWith(path)
    expect(mocks.showTextDocument).toHaveBeenCalledWith(file)
  })

  it("searchText calls find.text and opens at line", async () => {
    const path = "/tmp/src/search.ts"
    const file = doc(path)
    const text = vi.fn().mockResolvedValue({
      data: [
        {
          path: { text: path },
          lines: { text: "const hit = true" },
          line_number: 5,
          absolute_offset: 0,
          submatches: [],
        },
      ],
    })

    mocks.showInputBox.mockResolvedValue("hit")
    mocks.showQuickPick.mockImplementation(async (items: Array<unknown>) => items[0])
    mocks.openTextDocument.mockResolvedValue(file)

    const { searchText } = await import("./search.js")
    await searchText(() => ({ client: { find: { text } } }))()

    expect(mocks.showInputBox).toHaveBeenCalledWith({
      prompt: "Search text",
    })
    expect(text).toHaveBeenCalledWith({ pattern: "hit" })
    expect(mocks.showQuickPick).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          label: `${path}:5`,
          description: "const hit = true",
        }),
      ],
      {
        placeHolder: "Select match",
      },
    )
    expect(mocks.openTextDocument).toHaveBeenCalledWith(path)
    expect(mocks.showTextDocument).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        selection: expect.objectContaining({
          start: expect.objectContaining({ line: 4, character: 0 }),
          end: expect.objectContaining({ line: 4, character: 0 }),
        }),
      }),
    )
  })

  it("searchSymbols uses workspace symbol provider and opens selection", async () => {
    const path = "/tmp/src/client.ts"
    const file = doc(path)

    mocks.showInputBox.mockResolvedValue("Client")
    mocks.executeCommand.mockResolvedValue([
      {
        location: {
          uri: { fsPath: path },
          range: new vscode.Range(2, 0, 2, 0),
        },
        name: "ClientWithConfig",
      },
    ])
    mocks.showQuickPick.mockImplementation(async (items: Array<unknown>) => items[0])
    mocks.openTextDocument.mockResolvedValue(file)

    const { searchSymbols } = await import("./search.js")
    await searchSymbols(() => null)()

    expect(mocks.showInputBox).toHaveBeenCalledWith({
      prompt: "Search symbols",
    })
    expect(mocks.executeCommand).toHaveBeenCalledWith("vscode.executeWorkspaceSymbolProvider", "Client")
    expect(mocks.showQuickPick).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          label: "ClientWithConfig",
          path,
          line: 3,
        }),
      ],
      {
        placeHolder: "Select symbol",
      },
    )
    expect(mocks.openTextDocument).toHaveBeenCalledWith(path)
    expect(mocks.showTextDocument).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        selection: expect.objectContaining({
          start: expect.objectContaining({ line: 2, character: 0 }),
          end: expect.objectContaining({ line: 2, character: 0 }),
        }),
      }),
    )
  })

  it("returns gracefully when input is cancelled", async () => {
    const files = vi.fn()

    mocks.showInputBox.mockResolvedValue(undefined)

    const { searchFiles } = await import("./search.js")
    await searchFiles(() => ({ client: { find: { files } } }))()

    expect(files).not.toHaveBeenCalled()
    expect(mocks.showQuickPick).not.toHaveBeenCalled()
    expect(mocks.openTextDocument).not.toHaveBeenCalled()
    expect(mocks.showTextDocument).not.toHaveBeenCalled()
  })

  it("returns gracefully when match selection is cancelled", async () => {
    const text = vi.fn().mockResolvedValue({
      data: [
        {
          path: { text: "/tmp/src/search.ts" },
          lines: { text: "const hit = true" },
          line_number: 5,
          absolute_offset: 0,
          submatches: [],
        },
      ],
    })

    mocks.showInputBox.mockResolvedValue("hit")
    mocks.showQuickPick.mockResolvedValue(undefined)

    const { searchText } = await import("./search.js")
    await searchText(() => ({ client: { find: { text } } }))()

    expect(text).toHaveBeenCalledWith({ pattern: "hit" })
    expect(mocks.openTextDocument).not.toHaveBeenCalled()
    expect(mocks.showTextDocument).not.toHaveBeenCalled()
  })
})
