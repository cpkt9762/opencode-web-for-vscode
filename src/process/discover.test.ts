import { beforeEach, describe, expect, it, vi } from "vitest"

const mock = vi.hoisted(() => ({
  cfg: vi.fn(),
  exec: vi.fn(),
  exists: vi.fn(),
  platform: vi.fn(),
}))

vi.mock("node:child_process", () => ({
  execSync: mock.exec,
}))

vi.mock("node:fs", () => ({
  existsSync: mock.exists,
}))

vi.mock("node:os", () => ({
  homedir: () => "/home/test",
  platform: mock.platform,
}))

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: mock.cfg,
    })),
  },
}))

import { checkVersion, findBinary } from "./discover.js"

describe("discover", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock.cfg.mockReturnValue("")
    mock.exists.mockReturnValue(false)
    mock.platform.mockReturnValue("darwin")
  })

  describe("checkVersion", () => {
    it("parses version from opencode --version output", () => {
      mock.exec.mockReturnValue("opencode 1.3.1")

      const version = checkVersion("opencode")

      expect(version).toBe("1.3.1")
    })

    it("returns unknown for invalid binary", () => {
      mock.exec.mockImplementation(() => {
        throw new Error("missing")
      })

      const version = checkVersion("/nonexistent/opencode")

      expect(version).toBe("unknown")
    })
  })

  describe("findBinary", () => {
    it("checks configured binary path before PATH", () => {
      mock.cfg.mockReturnValue("/custom/opencode")
      mock.exists.mockImplementation((path: string) => path === "/custom/opencode")
      mock.exec.mockImplementation((cmd: string) => {
        if (cmd === '"/custom/opencode" --version') return "opencode 1.3.1"
        throw new Error(`unexpected command: ${cmd}`)
      })

      const bin = findBinary()

      expect(bin).toEqual({
        path: "/custom/opencode",
        version: "1.3.1",
        compatible: true,
      })
      expect(mock.exec).not.toHaveBeenCalledWith("which opencode", expect.anything())
    })
  })
})
