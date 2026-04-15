import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = {
  showQuickPick: vi.fn(),
  showWarningMessage: vi.fn(),
  state: {
    cb: undefined as ((e: unknown) => unknown) | undefined,
    folders: undefined as Array<{ name: string; uri: { fsPath: string } }> | undefined,
  },
  onDidChangeWorkspaceFolders: vi.fn((cb: (e: unknown) => unknown) => {
    mocks.state.cb = cb
    return { dispose: vi.fn() }
  }),
}

vi.mock("vscode", () => {
  return {
    window: {
      showQuickPick: mocks.showQuickPick,
      showWarningMessage: mocks.showWarningMessage,
    },
    workspace: {
      get workspaceFolders() {
        return mocks.state.folders
      },
      onDidChangeWorkspaceFolders: mocks.onDidChangeWorkspaceFolders,
    },
    __mocks: {
      onDidChangeWorkspaceFolders: mocks.onDidChangeWorkspaceFolders,
      showQuickPick: mocks.showQuickPick,
      showWarningMessage: mocks.showWarningMessage,
      state: mocks.state,
    },
  }
})

function folder(name: string, fsPath: string) {
  return { name, uri: { fsPath } }
}

describe("workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.cb = undefined
    mocks.state.folders = undefined
  })

  it("returns single folder directly", async () => {
    mocks.state.folders = [folder("app", "/app")]

    const { getDirectory } = await import("./workspace.js")

    await expect(getDirectory()).resolves.toBe("/app")
    expect(mocks.showQuickPick).not.toHaveBeenCalled()
    expect(mocks.showWarningMessage).not.toHaveBeenCalled()
  })

  it("shows QuickPick for multiple folders", async () => {
    mocks.state.folders = [folder("app", "/app"), folder("lib", "/lib")]
    mocks.showQuickPick.mockImplementation(async (items: Array<unknown>) => items[1])

    const { getDirectory } = await import("./workspace.js")

    await expect(getDirectory()).resolves.toBe("/lib")
    expect(mocks.showQuickPick).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          description: "/app",
          label: "app",
        }),
        expect.objectContaining({
          description: "/lib",
          label: "lib",
        }),
      ],
      {
        placeHolder: "Select workspace folder",
      },
    )
  })

  it("shows warning when no folders are open", async () => {
    const { getDirectory } = await import("./workspace.js")

    await expect(getDirectory()).resolves.toBeUndefined()
    expect(mocks.showWarningMessage).toHaveBeenCalledWith("OpenCode: No workspace folder open")
    expect(mocks.showQuickPick).not.toHaveBeenCalled()
  })

  it("currentFolder returns path when single folder open", async () => {
    mocks.state.folders = [folder("app", "/app")]

    const { currentFolder } = await import("./workspace.js")

    expect(currentFolder()).toBe("/app")
    expect(mocks.showQuickPick).not.toHaveBeenCalled()
    expect(mocks.showWarningMessage).not.toHaveBeenCalled()
  })

  it("currentFolder returns first folder when multiple folders open", async () => {
    mocks.state.folders = [folder("app", "/app"), folder("lib", "/lib")]

    const { currentFolder } = await import("./workspace.js")

    expect(currentFolder()).toBe("/app")
    expect(mocks.showQuickPick).not.toHaveBeenCalled()
  })

  it("currentFolder returns undefined when no folders open", async () => {
    const { currentFolder } = await import("./workspace.js")

    expect(currentFolder()).toBeUndefined()
    expect(mocks.showWarningMessage).not.toHaveBeenCalled()
  })

  it("calls callback when workspace folders change", async () => {
    const cb = vi.fn()
    const { onDirectoryChange } = await import("./workspace.js")
    const out = onDirectoryChange(cb)

    mocks.state.folders = [folder("next", "/next")]
    await mocks.state.cb?.({})

    expect(mocks.onDidChangeWorkspaceFolders).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith("/next")
    expect(out).toEqual(
      expect.objectContaining({
        dispose: expect.any(Function),
      }),
    )
  })
})
