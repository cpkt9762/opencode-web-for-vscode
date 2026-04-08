import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

type Cmd = {
  command?: string
  title?: string
}

type Menu = {
  command?: string
  when?: string
  group?: string
}

type Pkg = {
  contributes?: {
    commands?: Cmd[]
    menus?: {
      "view/item/context"?: Menu[]
    }
  }
}

function pkg() {
  return JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as Pkg
}

describe("package.json", () => {
  it("declares deleteSession command", () => {
    const list = pkg().contributes?.commands ?? []

    expect(list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "opencode-web.deleteSession",
          title: "OpenCode: Delete Session",
        }),
      ]),
    )
  })

  it("adds session tree context menu entries", () => {
    const list = pkg().contributes?.menus?.["view/item/context"] ?? []

    expect(list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "opencode-web.forkSession",
          when: "viewItem == session",
          group: "session@1",
        }),
        expect.objectContaining({
          command: "opencode-web.shareSession",
          when: "viewItem == session",
          group: "session@2",
        }),
        expect.objectContaining({
          command: "opencode-web.summarizeSession",
          when: "viewItem == session",
          group: "session@3",
        }),
        expect.objectContaining({
          command: "opencode-web.deleteSession",
          when: "viewItem == session",
          group: "session@4",
        }),
      ]),
    )
  })
})
