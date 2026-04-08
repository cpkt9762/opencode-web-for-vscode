import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("vscode", () => {
  const mockShowWarningMessage = vi.fn()
  const mockShowQuickPick = vi.fn()
  const mockShowInputBox = vi.fn()

  return {
    window: {
      showInputBox: mockShowInputBox,
      showQuickPick: mockShowQuickPick,
      showWarningMessage: mockShowWarningMessage,
    },
    __mocks: {
      mockShowWarningMessage,
      mockShowQuickPick,
      mockShowInputBox,
    },
  }
})

import * as vscode from "vscode"
import { showPermission, showQuestion } from "./dialogs.js"

const mocks = (vscode as any).__mocks

describe("dialogs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("showPermission", () => {
    it("returns 'once' when user selects 'Allow Once'", async () => {
      mocks.mockShowWarningMessage.mockResolvedValue("Allow Once")

      const result = await showPermission({
        requestID: "req-1",
        description: "Allow file access?",
        type: "file.read",
      })

      expect(result).toBe("once")
      expect(mocks.mockShowWarningMessage).toHaveBeenCalledWith(
        "Allow file access?",
        "Allow Once",
        "Always Allow",
        "Deny",
      )
    })

    it("returns 'always' when user selects 'Always Allow'", async () => {
      mocks.mockShowWarningMessage.mockResolvedValue("Always Allow")

      const result = await showPermission({
        requestID: "req-2",
        description: "Allow terminal access?",
        type: "terminal.run",
      })

      expect(result).toBe("always")
    })

    it("returns 'reject' when user selects 'Deny'", async () => {
      mocks.mockShowWarningMessage.mockResolvedValue("Deny")

      const result = await showPermission({
        requestID: "req-3",
        description: "Allow network access?",
        type: "network.request",
      })

      expect(result).toBe("reject")
    })

    it("returns 'reject' when user cancels", async () => {
      mocks.mockShowWarningMessage.mockResolvedValue(undefined)

      const result = await showPermission({
        requestID: "req-4",
        description: "Allow something?",
        type: "test",
      })

      expect(result).toBe("reject")
    })
  })

  describe("showQuestion", () => {
    it("uses quickPick when options are provided", async () => {
      mocks.mockShowQuickPick.mockResolvedValue("option-1")

      const result = await showQuestion({
        requestID: "q-1",
        question: "Choose one:",
        options: ["option-1", "option-2", "option-3"],
      })

      expect(result).toBe("option-1")
      expect(mocks.mockShowQuickPick).toHaveBeenCalledWith(["option-1", "option-2", "option-3"], {
        placeHolder: "Choose one:",
      })
      expect(mocks.mockShowInputBox).not.toHaveBeenCalled()
    })

    it("uses inputBox when no options provided", async () => {
      mocks.mockShowInputBox.mockResolvedValue("user input")

      const result = await showQuestion({
        requestID: "q-2",
        question: "Enter your name:",
      })

      expect(result).toBe("user input")
      expect(mocks.mockShowInputBox).toHaveBeenCalledWith({
        prompt: "Enter your name:",
      })
      expect(mocks.mockShowQuickPick).not.toHaveBeenCalled()
    })

    it("returns null when quickPick is cancelled", async () => {
      mocks.mockShowQuickPick.mockResolvedValue(undefined)

      const result = await showQuestion({
        requestID: "q-3",
        question: "Choose:",
        options: ["a", "b"],
      })

      expect(result).toBeNull()
    })

    it("returns null when inputBox is cancelled", async () => {
      mocks.mockShowInputBox.mockResolvedValue(undefined)

      const result = await showQuestion({
        requestID: "q-4",
        question: "Enter text:",
      })

      expect(result).toBeNull()
    })

    it("uses inputBox when options array is empty", async () => {
      mocks.mockShowInputBox.mockResolvedValue("answer")

      const result = await showQuestion({
        requestID: "q-5",
        question: "What?",
        options: [],
      })

      expect(result).toBe("answer")
      expect(mocks.mockShowInputBox).toHaveBeenCalled()
      expect(mocks.mockShowQuickPick).not.toHaveBeenCalled()
    })
  })
})
