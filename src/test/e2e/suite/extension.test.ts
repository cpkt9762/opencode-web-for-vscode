import assert from "node:assert/strict"
import { existsSync, realpathSync } from "node:fs"
import { setTimeout as wait } from "node:timers/promises"
import { glob } from "glob"
import { describe, it } from "mocha"
import * as vscode from "vscode"

const BIN = "/Applications/OpenCode.app/Contents/MacOS/opencode-cli"
const ID = "opencode.opencode-web-for-vscode"
const PORT = 57777
const TIMEOUT = 30000
const CMDS = [
  "opencode-web.sendCode",
  "opencode-web.newSession",
  "opencode-web.openChat",
  "opencode-web.openInBrowser",
  "opencode-web.restart",
  "opencode-web.stop",
  "opencode-web.showOutput",
  "opencode-web.searchFiles",
  "opencode-web.searchText",
  "opencode-web.searchSymbols",
  "opencode-web.openTerminal",
  "opencode-web.forkSession",
  "opencode-web.revertSession",
  "opencode-web.shareSession",
  "opencode-web.summarizeSession",
  "opencode-web.deleteSession",
  "opencode-web.showDiff",
  "opencode-web.selectSession",
]

async function ext() {
  const item = vscode.extensions.getExtension(ID)
  assert.ok(item)

  const stop = Date.now() + TIMEOUT

  while (Date.now() < stop) {
    if (item.isActive) return item
    await wait(250)
  }

  throw new Error("Extension did not activate in time")
}

async function ping(ms: number) {
  const stop = Date.now() + ms
  const url = `http://127.0.0.1:${PORT}/global/health`

  while (Date.now() < stop) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 401 || res.status === 403) return
    } catch {}

    await wait(500)
  }

  throw new Error(`Timed out waiting for ${url}`)
}

describe("extension", function () {
  this.timeout(TIMEOUT)

  it("should be present", async () => {
    const item = vscode.extensions.getExtension(ID)
    assert.ok(item)
  })

  it("should activate", async () => {
    const item = await ext()
    assert.equal(item.isActive, true)
  })

  it("should register all commands", async () => {
    await ext()
    const list = await vscode.commands.getCommands(true)

    CMDS.forEach((cmd) => {
      assert.equal(list.includes(cmd), true, `Missing command: ${cmd}`)
    })
  })

  it("should register the OpenCode view container", async () => {
    await ext()
    await vscode.commands.executeCommand("workbench.view.extension.opencode-web")
    await vscode.commands.executeCommand("opencode-web.chatView.focus")
    await wait(2000)
  })

  it("should reach the server after activation", async function () {
    if (!existsSync(BIN)) {
      this.skip()
      return
    }

    await ext()
    await ping(20000)
  })

  it("should create the OpenCode output channel log", async () => {
    await ext()
    const root = process.env.E2E_LOG_DIR

    assert.ok(root)
    assert.equal((await glob("**/*-OpenCode.log", { cwd: root })).length > 0, true)
  })

  it("should serve with current workspace directory", async function () {
    if (!existsSync(BIN)) {
      this.skip()
      return
    }

    await ext()
    await ping(20000)

    const folders = vscode.workspace.workspaceFolders
    assert.ok(folders && folders.length > 0, "No workspace folder open")

    const dir = realpathSync(folders[0].uri.fsPath)
    const url = `http://127.0.0.1:${PORT}/path?directory=${encodeURIComponent(dir)}`
    const res = await fetch(url)
    assert.equal(res.ok, true, `GET /path failed: ${res.status}`)

    const body = (await res.json()) as { directory?: string }
    assert.ok(body.directory, "Server returned no directory")
    assert.equal(realpathSync(body.directory), dir, `Expected ${dir}, got ${body.directory}`)
  })

  it("should log workspace directory in output", async function () {
    if (!existsSync(BIN)) {
      this.skip()
      return
    }

    await ext()
    await ping(20000)

    const root = process.env.E2E_LOG_DIR
    assert.ok(root)

    const logs = await glob("**/*-OpenCode.log", { cwd: root })
    assert.ok(logs.length > 0, "No OpenCode log file found")

    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const content = readFileSync(resolve(root, logs[0]), "utf-8")

    assert.ok(content.includes("OpenCode dir:"), "Log missing 'OpenCode dir:' line")
    assert.ok(!content.includes("OpenCode dir: (empty)"), "Directory is empty - workspace folder not detected")

    const folders = vscode.workspace.workspaceFolders
    if (folders && folders.length > 0) {
      const raw = folders[0].uri.fsPath
      const real = realpathSync(raw)
      assert.ok(
        content.includes(raw) || content.includes(real),
        `Log missing workspace path.\nExpected: ${raw} or ${real}\nLog content:\n${content}`,
      )
    }

    assert.ok(content.includes("OpenCode server: http"), "Log missing server URL")
  })

  it("should have current project matching workspace absolute path", async function () {
    if (!existsSync(BIN)) {
      this.skip()
      return
    }

    await ext()
    await ping(20000)

    const folders = vscode.workspace.workspaceFolders
    assert.ok(folders && folders.length > 0, "No workspace folder")

    const dir = realpathSync(folders[0].uri.fsPath)

    assert.ok(dir.startsWith("/"), `Not absolute path: ${dir}`)
    assert.ok(existsSync(dir), `Path does not exist: ${dir}`)

    const path = await fetch(`http://127.0.0.1:${PORT}/path?directory=${encodeURIComponent(dir)}`)
    assert.equal(path.ok, true)
    const pathBody = (await path.json()) as { directory?: string }
    assert.equal(realpathSync(pathBody.directory!), dir, `/path directory: ${pathBody.directory} != ${dir}`)

    const proj = await fetch(`http://127.0.0.1:${PORT}/project/current?directory=${encodeURIComponent(dir)}`)
    assert.equal(proj.ok, true, `GET /project/current failed: ${proj.status}`)
    const projBody = (await proj.json()) as { worktree?: string; id?: string }
    assert.ok(projBody.id, `No project id: ${JSON.stringify(projBody)}`)
    assert.ok(projBody.worktree, `No worktree: ${JSON.stringify(projBody)}`)
    assert.equal(realpathSync(projBody.worktree), dir, `worktree ${projBody.worktree} != ${dir}`)

    console.log(`    → VSCode workspace: ${dir}`)
    console.log(`    → Server /path:     ${pathBody.directory}`)
    console.log(`    → Project worktree: ${projBody.worktree}`)
    console.log(`    → Project ID:       ${projBody.id}`)
  })

  it("should list sessions for current project", async function () {
    if (!existsSync(BIN)) {
      this.skip()
      return
    }

    await ext()
    await ping(20000)

    const folders = vscode.workspace.workspaceFolders
    assert.ok(folders && folders.length > 0)

    const dir = realpathSync(folders[0].uri.fsPath)
    const url = `http://127.0.0.1:${PORT}/session?directory=${encodeURIComponent(dir)}`
    const res = await fetch(url)
    assert.equal(res.ok, true, `GET /session failed: ${res.status}`)

    const body = await res.json()
    assert.ok(Array.isArray(body), `Expected array, got ${typeof body}`)
  })

  it("should create and retrieve a session in current project", async function () {
    if (!existsSync(BIN)) {
      this.skip()
      return
    }

    await ext()
    await ping(20000)

    const folders = vscode.workspace.workspaceFolders
    assert.ok(folders && folders.length > 0)

    const dir = realpathSync(folders[0].uri.fsPath)
    const base = `http://127.0.0.1:${PORT}`

    const create = await fetch(`${base}/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencode-directory": dir,
      },
      body: JSON.stringify({}),
    })

    const text = await create.text()
    assert.equal(create.ok, true, `POST /session failed: ${create.status} ${text}`)

    const session = JSON.parse(text) as { id?: string; title?: string }
    assert.ok(session.id, `No session id: ${JSON.stringify(session)}`)

    const get = await fetch(`${base}/session/${session.id}?directory=${encodeURIComponent(dir)}`)
    assert.equal(get.ok, true, `GET /session/${session.id} failed: ${get.status}`)

    const detail = (await get.json()) as { id?: string }
    assert.equal(detail.id, session.id, "Session ID mismatch")
  })

  it("should list projects including current workspace", async function () {
    if (!existsSync(BIN)) {
      this.skip()
      return
    }

    await ext()
    await ping(20000)

    const folders = vscode.workspace.workspaceFolders
    assert.ok(folders && folders.length > 0)

    const dir = realpathSync(folders[0].uri.fsPath)
    const base = `http://127.0.0.1:${PORT}`

    await fetch(`${base}/project/current?directory=${encodeURIComponent(dir)}`)

    const res = await fetch(`${base}/project?directory=${encodeURIComponent(dir)}`)
    assert.equal(res.ok, true, `GET /project failed: ${res.status}`)

    const list = (await res.json()) as Array<{ id?: string; worktree?: string }>
    assert.ok(Array.isArray(list), "Expected array")
    assert.ok(list.length > 0, "Project list is empty")

    const match = list.find((p) => p.worktree && realpathSync(p.worktree) === dir)
    assert.ok(match, `Workspace ${dir} not in project list: ${list.map((p) => p.worktree).join(", ")}`)
    assert.ok(match.id, "Project has no id")

    console.log(`    → Projects: ${list.length}`)
    console.log(`    → Match: ${match.worktree} (${match.id})`)
  })

  it("should create project idempotently via project.current", async function () {
    if (!existsSync(BIN)) {
      this.skip()
      return
    }

    await ext()
    await ping(20000)

    const folders = vscode.workspace.workspaceFolders
    assert.ok(folders && folders.length > 0)

    const dir = realpathSync(folders[0].uri.fsPath)
    const url = `http://127.0.0.1:${PORT}/project/current?directory=${encodeURIComponent(dir)}`

    const first = await fetch(url)
    assert.equal(first.ok, true, `1st call failed: ${first.status}`)
    const a = (await first.json()) as { id?: string; worktree?: string }
    assert.ok(a.id, "1st call: no id")

    const second = await fetch(url)
    assert.equal(second.ok, true, `2nd call failed: ${second.status}`)
    const b = (await second.json()) as { id?: string; worktree?: string }

    assert.equal(a.id, b.id, `ID changed: ${a.id} → ${b.id}`)
    assert.equal(realpathSync(a.worktree!), realpathSync(b.worktree!), "worktree changed")

    console.log(`    → Idempotent: ${a.id} == ${b.id}`)
  })

  it("should serve SPA HTML at base64 dir route", async function () {
    if (!existsSync(BIN)) {
      this.skip()
      return
    }

    await ext()
    await ping(20000)

    const folders = vscode.workspace.workspaceFolders
    assert.ok(folders && folders.length > 0)

    const dir = realpathSync(folders[0].uri.fsPath)
    const slug = Buffer.from(dir).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")

    const res = await fetch(`http://127.0.0.1:${PORT}/${slug}`)
    assert.equal(res.ok, true, `GET /${slug.slice(0, 20)}... failed: ${res.status}`)

    const html = await res.text()
    assert.ok(html.includes("<!doctype html>") || html.includes("<!DOCTYPE html>"), "Not HTML")
    assert.ok(html.length > 500, `HTML too small: ${html.length}`)

    console.log(`    → /${slug.slice(0, 30)}... → ${html.length} bytes HTML`)
  })

  it("should return HTML from web UI root", async function () {
    if (!existsSync(BIN)) {
      this.skip()
      return
    }

    await ext()
    await ping(20000)

    const res = await fetch(`http://127.0.0.1:${PORT}/`)
    assert.equal(res.ok, true, `GET / failed: ${res.status}`)

    const html = await res.text()
    assert.ok(html.includes("<!doctype html>") || html.includes("<!DOCTYPE html>"), "Root does not serve HTML")
    assert.ok(html.length > 500, `HTML too small: ${html.length} bytes`)
  })
})
