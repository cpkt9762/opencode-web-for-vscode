import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { setTimeout as wait } from "node:timers/promises"

import { expect, type Frame } from "@playwright/test"
import { downloadAndUnzipVSCode } from "@vscode/test-electron"

import { ProcessManager } from "../../process/manager.js"
import { bin, port } from "../e2e/env.js"
import { auth, type Cfg, home, open, reveal, shut, slug, spa, swap, url } from "./shared.js"

async function free() {
  const raw = process.env.E2E_PORT?.trim()
  const num = raw ? Number(raw) : Number.NaN
  if (Number.isInteger(num) && num > 0) return num

  return new Promise<number>((done, fail) => {
    const srv = createServer()
    srv.unref()
    srv.once("error", fail)
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address()
      if (!addr || typeof addr === "string") {
        srv.close(() => fail(new Error("Failed to allocate capture port")))
        return
      }

      srv.close((err) => {
        if (err) {
          fail(err)
          return
        }

        done(addr.port)
      })
    })
  })
}

function init(dir: string) {
  execSync("git init", { cwd: dir, stdio: "ignore" })
}

function seed(dir: string) {
  execSync('git -c user.name="Smoke" -c user.email="smoke@example.com" commit --allow-empty -m "smoke"', {
    cwd: dir,
    stdio: "ignore",
  })
}

async function register(base: string, pwd: string, dir: string) {
  const target = new URL(`/project/current?directory=${encodeURIComponent(dir)}`, base)
  const res = await fetch(target, {
    headers: {
      Authorization: auth(pwd),
    },
  })
  if (res.ok) return
  throw new Error(`Failed to register project ${dir}: ${res.status} ${await res.text()}`)
}

async function shot(
  cfg: Cfg,
  file: string,
  check: (frame: Frame) => Promise<void>,
  win?: Awaited<ReturnType<typeof open>>,
) {
  const item = win ?? (await open(cfg, cfg.fresh))

  await item.page.setViewportSize({ width: 1400, height: 900 })
  await item.page.waitForSelector(".monaco-workbench", { timeout: 60000 })

  const frame = await reveal(item.page, 120000)
  await expect(item.page.locator("iframe.webview").first()).toBeVisible({
    timeout: 60000,
  })
  await check(frame)
  await wait(3000)
  await item.page.screenshot({ fullPage: false, path: file })
  console.log(file)
  return item
}

async function welcome(cfg: Cfg, file: string) {
  return shot(cfg, file, async (frame) => {
    await expect(frame.locator("body")).toHaveAttribute("data-state", "ready", {
      timeout: 60000,
    })
    await expect(frame.locator("#shell")).toBeHidden()
    await expect(frame.locator("#opencode-frame")).toBeVisible()

    const item = await url(frame, (item) => item.pathname === "/")
    assert.equal(item.pathname, "/")
    assert.equal(item.hostname, "127.0.0.1")
    await home(frame)
  })
}

async function project(cfg: Cfg, file: string, win: Awaited<ReturnType<typeof open>>) {
  swap(cfg, win, cfg.ready)
  await win.page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => null)
  await win.page.waitForSelector(".monaco-workbench", { timeout: 60000 })

  await shot(
    cfg,
    file,
    async (frame) => {
      await expect(frame.locator("body")).toHaveAttribute("data-state", "ready", {
        timeout: 60000,
      })
      await expect(frame.locator("#shell")).toBeHidden()
      await expect(frame.locator("#opencode-frame")).toBeVisible()

      const item = await url(frame, (item) => item.pathname === `/${slug(cfg.ready)}`)
      assert.equal(item.pathname, `/${slug(cfg.ready)}`)
      assert.equal(item.hostname, "127.0.0.1")

      const app = spa(frame)
      await expect(app.locator("body")).toContainText(/\S/, { timeout: 30000 })
    },
    win,
  )
}

async function main() {
  const dev = resolve(__dirname, "../../..")
  execSync("node esbuild.config.js --production", {
    cwd: dev,
    stdio: "inherit",
  })

  process.env.E2E_PORT ??= String(await free())
  const num = port()
  const file = bin()
  if (!file) throw new Error("Failed to find opencode-cli for smoke capture")

  const root = mkdtempSync(resolve(tmpdir(), "oc-vscode-capture-"))
  const ext = resolve(root, "ext")
  const homeDir = resolve(root, "home")
  const data = resolve(root, "data")
  const rawFresh = resolve(root, "fresh")
  const rawReady = resolve(root, "ready")
  const user = resolve(homeDir, "User")
  const out = resolve(dev, "captures")

  mkdirSync(ext)
  mkdirSync(user, { recursive: true })
  mkdirSync(data)
  mkdirSync(rawFresh)
  mkdirSync(rawReady)
  mkdirSync(out, { recursive: true })

  const fresh = realpathSync(rawFresh)
  const ready = realpathSync(rawReady)
  init(ready)
  seed(ready)

  symlinkSync(dev, resolve(ext, "opencode.opencode-web-for-vscode"), "dir")

  const mgr = new ProcessManager({
    port: num,
    password: "smoke-secret",
    find: () => ({
      compatible: true,
      path: file,
      version: "1.3.0",
    }),
  })

  let keep = false

  try {
    const srv = await mgr.start()
    const pid = (Reflect.get(mgr, "proc") as { pid?: number } | null)?.pid
    if (!pid) throw new Error("Failed to capture smoke server pid")
    await register(srv.url, srv.password, ready)

    writeFileSync(
      resolve(user, "settings.json"),
      JSON.stringify(
        {
          "editor.accessibilitySupport": "off",
          "extensions.autoCheckUpdates": false,
          "extensions.autoUpdate": false,
          "opencode.autoStart": true,
          "opencode.port": num,
          "opencode.serverPassword": srv.password,
          "security.workspace.trust.enabled": false,
          "telemetry.telemetryLevel": "off",
          "window.restoreWindows": "none",
          "workbench.startupEditor": "none",
        },
        null,
        2,
      ),
    )

    const code = await downloadAndUnzipVSCode({
      cachePath: resolve(dev, ".vscode-test"),
      extensionDevelopmentPath: dev,
    })

    const cfg: Cfg = {
      code,
      ext,
      fresh,
      password: srv.password,
      pid,
      port: num,
      ready,
      root: data,
    }

    const win = await welcome(cfg, resolve(out, "01-welcome.png"))

    try {
      await project(cfg, resolve(out, "02-project.png"), win)
    } finally {
      await shut(win)
    }
  } catch (err) {
    keep = true
    console.error(`Capture temp root kept at ${root}`)
    throw err
  } finally {
    await mgr.stop().catch(() => null)
    if (!keep) rmSync(root, { force: true, recursive: true })
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to capture smoke screenshots:", err)
    process.exit(1)
  })
