import { describe, expect, it, vi } from "vitest"

vi.mock("vscode", () => ({
  window: {
    createStatusBarItem: vi.fn(() => ({
      text: "",
      tooltip: "",
      command: "",
      show: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  StatusBarAlignment: {
    Left: 1,
  },
}))

import type { ProcessManager } from "../process/manager.js"
import { createStatusBar } from "./statusbar.js"

describe("createStatusBar", () => {
  it("shows connected state correctly", () => {
    const manager = {
      getStatus: () => "running",
      getUrl: () => "http://127.0.0.1:4096",
      onStatusChange: () => ({
        dispose: vi.fn(),
      }),
    } as unknown as ProcessManager

    const bar = createStatusBar(manager)

    expect(bar.text).toBe("$(plug) Connected")
    expect(bar.tooltip).toBe("OpenCode is connected\nhttp://127.0.0.1:4096")
    expect(bar.command).toBe("opencode-web.openChat")
  })

  it("shows disconnected state correctly", () => {
    const manager = {
      getStatus: () => "stopped",
      getUrl: () => null,
      onStatusChange: () => ({
        dispose: vi.fn(),
      }),
    } as unknown as ProcessManager

    const bar = createStatusBar(manager)

    expect(bar.text).toBe("$(debug-disconnect) Disconnected")
    expect(bar.tooltip).toBe("OpenCode is disconnected")
    expect(bar.command).toBe("opencode-web.restart")
  })

  it("responds to status change events", () => {
    let url: string | null = null
    let listener: ((status: string) => void) | null = null
    const manager = {
      getStatus: () => "stopped",
      getUrl: () => url,
      onStatusChange: (cb: (status: string) => void) => {
        listener = cb
        return { dispose: vi.fn() }
      },
    } as unknown as ProcessManager

    const bar = createStatusBar(manager)

    const fn = listener as unknown as (status: string) => void
    url = "http://127.0.0.1:4096"
    fn("running")
    expect(bar.text).toBe("$(plug) Connected")
    expect(bar.tooltip).toBe("OpenCode is connected\nhttp://127.0.0.1:4096")
    expect(bar.command).toBe("opencode-web.openChat")

    fn("stopped")
    expect(bar.text).toBe("$(debug-disconnect) Disconnected")
    expect(bar.command).toBe("opencode-web.restart")
  })
})
